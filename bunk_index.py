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
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from typing import Iterable, Iterator

import cfgrib  # type: ignore
from eccodes import (
    codes_grib_new_from_file,
    codes_get,
    codes_release,
)

from grid_util import _to_utc_iso, _compute_times_from_message, GRIB_INDEX_SQLITE

LOG = logging.getLogger("bunk_index")


# ---------------------------------------------
# GRIB message scan (metadata only)


@dataclass(frozen=True)
class MsgMeta:
    var: str
    level_type: str
    ref_time_iso: str
    forecast_time_iso: str
    lead_hours: int


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
                var = codes_get(h, "cfVarName")
                level_type = codes_get(h, "typeOfLevel")
                ref_dt, fcst_dt, lead = _compute_times_from_message(h)
                out.append(MsgMeta(
                    var=var,
                    level_type=level_type,
                    ref_time_iso=_to_utc_iso(ref_dt),
                    forecast_time_iso=_to_utc_iso(fcst_dt),
                    lead_hours=lead,
                ))
            finally:
                codes_release(h)
    return out


# ---------------------------------------------
# SQLite schema and writes
SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS records (
  id                   INTEGER PRIMARY KEY,
  file_path            TEXT NOT NULL,
  var                  TEXT NOT NULL,
  level_type           TEXT NOT NULL,
  ref_time_utc         TEXT NOT NULL,          -- message reference (analysis) time in UTC ISO8601
  forecast_time_utc    TEXT NOT NULL,          -- valid/target time in UTC ISO8601
  lead_hours           INTEGER NOT NULL,
  UNIQUE(level_type, var, file_path)
);

CREATE INDEX IF NOT EXISTS idx_records_time
  ON records(var, forecast_time_utc);

CREATE INDEX IF NOT EXISTS idx_records_var_level_time
  ON records(var, level_type, forecast_time_utc);

"""


def ensure_schema(db_path: str) -> None:
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.executescript(SCHEMA_SQL)


def index_file(db_path: str, file_path: str) -> int:
    """
    Index a single GRIB2 file. Returns number of rows inserted.
    """
    msgs = scan_grib_messages(file_path)
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute("PRAGMA busy_timeout=8000;")
        sql = """
              INSERT
              OR IGNORE INTO records
                (file_path, var, level_type, ref_time_utc, forecast_time_utc, lead_hours)
              VALUES (?, ?, ?, ?, ?, ?);
              """
        inserted = 0
        cur = conn.cursor()
        for m in msgs:
            cur.execute(
                sql,
                (
                    file_path,
                    m.var,
                    m.level_type,
                    m.ref_time_iso,
                    m.forecast_time_iso,
                    int(m.lead_hours),
                ),
            )
            # sqlite3 returns -1 for rowcount on some operations; treat any positive as insert
            if cur.rowcount and cur.rowcount > 0:
                inserted += cur.rowcount
        LOG.info("[index_file] inserted=%d rows for %s", inserted, os.path.basename(file_path))
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
    ap.add_argument("--db", default=GRIB_INDEX_SQLITE,
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
