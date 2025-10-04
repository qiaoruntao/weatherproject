#!/usr/bin/env python3
"""
bunk_index.py
-------------
Build a SQLite index for GRIB2 datasets that cover the whole globe.

Design:
  - One DB row per (file, variable, level, forecast_time).
  - Drop spatial indexing entirely (global coverage).
  - Support nearest-by-forecast-time queries later by indexing:
      (product, var, forecast_time_utc) and (var, level_type, level_value, forecast_time_utc).

Usage:
    python bunk_index.py --db grib_index.sqlite --roots data/cfs
    python bunk_index.py --db grib_index.sqlite --files data/cfs/ocnf2026040800.01.2025100312.grb2
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator, Optional

# Optional: cfgrib/xarray for variable enumeration
try:
    import cfgrib  # type: ignore
except Exception:
    cfgrib = None

# Requires: pip install eccodes
try:
    from eccodes import (
        codes_grib_new_from_file,
        codes_get,
        codes_release,
    )
except Exception as e:
    raise SystemExit("eccodes is required. Install via `pip install eccodes` and ensure ecCodes is available.") from e

LOG = logging.getLogger("bunk_index")

# ---------------------------------------------
# Filename parsing (CFS/NCEP style)
# Examples:
#   ocnf2026040800.01.2025100312.grb2
#   flxf2025100218.01.2025100218.grb2
CFS_NAME = re.compile(
    r'(?P<product>[a-z]+)(?P<forecast>\d{10})\.\d{2}\.(?P<run>\d{10})\.grb2$'
)


@dataclass(frozen=True)
class FileMeta:
    product: str
    forecast_dt: datetime  # from filename (fallback/sanity)
    run_dt: datetime  # from filename (fallback/sanity)
    path: str


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


def parse_cfs_filename(path: str) -> FileMeta:
    name = os.path.basename(path)
    m = CFS_NAME.search(name)
    if not m:
        raise ValueError(f"Unrecognized CFS filename: {name}")

    def to_dt(s: str) -> datetime:
        # YYYYMMDDHH -> aware UTC dt
        return datetime.strptime(s, "%Y%m%d%H").replace(tzinfo=timezone.utc)

    product = m.group("product")
    forecast_dt = to_dt(m.group("forecast"))
    run_dt = to_dt(m.group("run"))
    return FileMeta(product=product, forecast_dt=forecast_dt, run_dt=run_dt, path=os.path.abspath(path))


# ---------------------------------------------
# GRIB message scan (metadata only)
def _get_int_or_none(h, key: str) -> Optional[int]:
    try:
        return int(codes_get(h, key))
    except Exception:
        return None


def _get_str_or_none(h, key: str) -> Optional[str]:
    try:
        v = codes_get(h, key)
        if v is None:
            return None
        return str(v)
    except Exception:
        return None


@dataclass(frozen=True)
class MsgMeta:
    var: str
    level_type: Optional[str]
    level_value: Optional[float]
    ref_time_iso: str
    forecast_time_iso: str
    lead_hours: int


def _compute_times_from_message(h) -> tuple[datetime, datetime, int]:
    """
    Return (ref_time_utc, forecast_time_utc, lead_hours).
    """
    dataDate = _get_int_or_none(h, "dataDate")  # e.g., 20251003
    dataTime = _get_int_or_none(h, "dataTime")  # e.g., 1200 or 12
    if dataDate is None or dataTime is None:
        raise ValueError("Missing reference time (dataDate/dataTime) in GRIB message")

    HH = dataTime // 100 if dataTime >= 100 else dataTime
    ref = datetime.strptime(f"{dataDate:08d}{HH:02d}", "%Y%m%d%H").replace(tzinfo=timezone.utc)

    lead_hours: Optional[int] = _get_int_or_none(h, "forecastTime")
    if lead_hours is None:
        step_range = _get_str_or_none(h, "stepRange")
        if step_range and "-" in step_range:
            try:
                lead_hours = int(step_range.split("-")[-1])
            except Exception:
                pass
        elif step_range:
            try:
                lead_hours = int(step_range)
            except Exception:
                pass
    if lead_hours is None:
        for k in ("endStep", "step"):
            v = _get_int_or_none(h, k)
            if v is not None:
                lead_hours = v
                break
    if lead_hours is None:
        raise ValueError("Unable to determine forecast lead time (hours)")

    forecast = ref + timedelta(hours=lead_hours)
    return ref, forecast, int(lead_hours)


def scan_grib_messages(file_path: str) -> list[MsgMeta]:
    """
    Collect per-message metadata without reading field data.
    """
    out: list[MsgMeta] = []
    with open(file_path, "rb") as f:
        while True:
            h = codes_grib_new_from_file(f)
            if h is None:
                break
            try:
                var = _get_str_or_none(h, "shortName") or _get_str_or_none(h, "name") or "unknown"
                level_type = _get_str_or_none(h, "typeOfLevel")
                # Some products may use non-integer level (keep as int if provided)
                level_value_i = _get_int_or_none(h, "level")
                level_value = float(level_value_i) if level_value_i is not None else None
                ref_dt, fcst_dt, lead = _compute_times_from_message(h)
                out.append(MsgMeta(
                    var=var,
                    level_type=level_type,
                    level_value=level_value,
                    ref_time_iso=_to_utc_iso(ref_dt),
                    forecast_time_iso=_to_utc_iso(fcst_dt),
                    lead_hours=lead,
                ))
            finally:
                codes_release(h)
    return out


# ---------------------------------------------
# cfgrib/xarray variable enumeration helper
def list_vars_from_cfgrib(file_path: str) -> set[str]:
    """Return the set of variable short names present in the GRIB file using cfgrib groups.
    Falls back to an empty set if cfgrib is unavailable or fails.
    """
    vars_set: set[str] = set()
    if cfgrib is None:
        return vars_set
    try:
        # Disable on-disk index files to avoid incompatible .idx warnings
        datasets = cfgrib.open_datasets(file_path, indexpath="")  # multiple groups
        try:
            for ds in datasets:
                for var in ds.data_vars:
                    vars_set.add(var)
        finally:
            for ds in datasets:
                try:
                    ds.close()
                except Exception:
                    pass
    except Exception as e:
        LOG.warning("cfgrib.open_datasets failed for %s: %s", file_path, e)
    return vars_set


# ---------------------------------------------
# SQLite schema and writes
SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS records (
  id               INTEGER PRIMARY KEY,
  product          TEXT NOT NULL,
  file_path        TEXT NOT NULL,
  run_time_utc     TEXT NOT NULL,            -- message ref time (analysis/init)
  forecast_time_utc TEXT NOT NULL,           -- target prediction time
  lead_hours       INTEGER NOT NULL,
  var              TEXT NOT NULL,
  level_type       TEXT,
  level_value      REAL,
  UNIQUE(file_path, var, level_type, level_value, forecast_time_utc)
);

CREATE INDEX IF NOT EXISTS idx_records_core
  ON records(product, var, forecast_time_utc);

CREATE INDEX IF NOT EXISTS idx_records_level
  ON records(var, level_type, level_value, forecast_time_utc);

CREATE INDEX IF NOT EXISTS idx_records_run
  ON records(var, product, run_time_utc);
"""


def ensure_schema(db_path: str) -> None:
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.executescript(SCHEMA_SQL)


def index_file(db_path: str, file_path: str) -> int:
    """
    Index a single GRIB2 file. Returns number of rows inserted.
    """
    meta = parse_cfs_filename(file_path)
    msgs = scan_grib_messages(file_path)
    # Prefer cfgrib groups to enumerate variables at the dataset level
    var_names = list_vars_from_cfgrib(file_path)
    if not var_names and msgs:
        # Fallback: derive variables from scanned messages
        var_names = {m.var for m in msgs}
    if not var_names:
        LOG.warning("No GRIB variables found: %s", file_path)
        return 0

    inserted = 0
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute("PRAGMA busy_timeout=8000;")
        sql = """
              INSERT INTO records
              (product, file_path, run_time_utc, forecast_time_utc, lead_hours, var, level_type, level_value)
              VALUES (?, ?, ?, ?, ?, ?, ?,
                      ?) ON CONFLICT(file_path, var, level_type, level_value, forecast_time_utc) DO NOTHING; \
              """
        abs_path = os.path.abspath(meta.path)
        # Insert exactly one row per variable for this file.
        # Use filename-derived run/forecast times to avoid per-message duplication.
        run_time = _to_utc_iso(meta.run_dt)
        forecast_time = _to_utc_iso(meta.forecast_dt)
        lead = int((meta.forecast_dt - meta.run_dt).total_seconds() // 3600)

        for var in sorted(var_names):
            try:
                conn.execute(sql, (
                    meta.product,
                    abs_path,
                    run_time,
                    forecast_time,
                    lead,
                    var,
                    None,  # level_type unknown at var-summary level
                    None  # level_value unknown at var-summary level
                ))
                inserted += 1
            except sqlite3.DatabaseError as e:
                LOG.error("DB insert failed for %s (%s): %s", abs_path, var, e)
        LOG.debug("[vars] %s -> %d variables inserted", os.path.basename(file_path), inserted)
    return inserted


def iter_grib_files(roots: Iterable[str], files: Iterable[str]) -> Iterator[str]:
    if files:
        for fp in files:
            if os.path.isfile(fp) and fp.endswith(".grb2"):
                yield fp
            else:
                LOG.debug("Skip non-GRIB2 file: %s", fp)
    for root in roots:
        for dirpath, _, filenames in os.walk(root):
            for name in filenames:
                if name.endswith(".grb2"):
                    yield os.path.join(dirpath, name)


# ---------------------------------------------
# CLI
def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Build SQLite index for global GRIB2 datasets.")
    ap.add_argument("--db", default="./grib_index.sqlite",
                    help="Path to SQLite database file to create/update.")
    ap.add_argument("--roots", nargs="*", default=["data"], help="Directories to recursively scan for .grb2 files.")
    ap.add_argument("--files", nargs="*", default=[], help="Explicit .grb2 file paths to index.")
    ap.add_argument("--log", default="INFO", help="Logging level (DEBUG, INFO, WARNING, ERROR).")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log.upper(), logging.INFO),
        format="%(levelname)s: %(message)s"
    )
    if not args.roots and not args.files:
        LOG.error("No input specified. Use --roots or --files.")
        raise SystemExit(2)

    ensure_schema(args.db)

    total_files = 0
    total_rows = 0
    for fp in iter_grib_files(args.roots, args.files):
        total_files += 1
        try:
            rows = index_file(args.db, fp)
            total_rows += rows
            LOG.info("[indexed] +%d rows from %s", rows, os.path.basename(fp))
        except ValueError as ve:
            # filename not matching our pattern or message time issues
            LOG.warning("Skip %s: %s", fp, ve)
        except Exception as e:
            LOG.error("Error indexing %s: %s", fp, e)

    LOG.info("Done. Files processed: %d, rows inserted (new): %d", total_files, total_rows)


if __name__ == "__main__":
    main()
