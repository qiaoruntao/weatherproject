# file: grib_index_refactor.py
import re
from datetime import datetime, timezone

CFS_NAME = re.compile(
    r'(?P<product>[a-z]+)(?P<forecast>\d{10})\.\d{2}\.(?P<run>\d{10})\.grb2$'
)


def parse_cfs_filename(path: str):
    """
    Returns (product, forecast_dt_utc, run_dt_utc) or raises ValueError.
    """
    m = CFS_NAME.search(path)
    if not m:
        raise ValueError(f"Unrecognized CFS filename: {path}")
    product = m.group("product")

    def to_iso(s):
        # YYYYMMDDHH -> aware UTC dt
        return datetime.strptime(s, "%Y%m%d%H").replace(tzinfo=timezone.utc)

    return product, to_iso(m.group("forecast")), to_iso(m.group("run"))


# file: grib_index_refactor.py (continued)
import os
import sqlite3
from contextlib import closing
from datetime import timedelta

# Requires: pip install eccodes
from eccodes import (
    codes_grib_new_from_file, codes_get, codes_release,
)


def _get_int_or_none(h, key):
    try:
        return int(codes_get(h, key))
    except Exception:
        return None


def _get_str_or_none(h, key):
    try:
        return str(codes_get(h, key))
    except Exception:
        return None


def _compute_times_from_message(h):
    """
    Return (ref_time_utc, forecast_time_utc, lead_hours).
    GRIB2 messages typically have reference time (dataDate,dataTime) and step/forecast.
    """
    dataDate = _get_int_or_none(h, "dataDate")  # e.g., 20251003
    dataTime = _get_int_or_none(h, "dataTime")  # e.g., 1200
    if dataDate is None or dataTime is None:
        raise ValueError("Missing reference time in GRIB message")

    # dataTime can be HHmm or HH; normalize to HH
    HH = dataTime // 100 if dataTime >= 100 else dataTime
    ref = datetime.strptime(f"{dataDate:08d}{HH:02d}", "%Y%m%d%H").replace(tzinfo=timezone.utc)

    # Prefer 'forecastTime' in hours if present; else derive from stepRange
    ft = _get_int_or_none(h, "forecastTime")
    lead_hours = None
    if ft is not None:
        lead_hours = ft
    else:
        step_range = _get_str_or_none(h, "stepRange")  # e.g., "0-6" or "6"
        if step_range and "-" in step_range:
            # end of the range (hours) is common for accumulated fields
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
        # Fallback: some centers use 'endStep' or 'step'
        for k in ("endStep", "step"):
            v = _get_int_or_none(h, k)
            if v is not None:
                lead_hours = v
                break

    if lead_hours is None:
        raise ValueError("Unable to determine forecast lead time (hours)")

    forecast = ref + timedelta(hours=lead_hours)
    return ref, forecast, lead_hours


def scan_grib_messages(file_path: str):
    """
    Yields dicts for each message:
      {var, level_type, level_value, ref_time_utc, forecast_time_utc, lead_hours}
    """
    out = []
    with open(file_path, "rb") as f:
        while True:
            h = codes_grib_new_from_file(f)
            if h is None:
                break
            try:
                var = _get_str_or_none(h, "shortName") or _get_str_or_none(h, "name")
                level_type = _get_str_or_none(h, "typeOfLevel")
                level_value = _get_int_or_none(h, "level")
                ref, fcst, lead = _compute_times_from_message(h)
                out.append(dict(
                    var=var,
                    level_type=level_type,
                    level_value=level_value,
                    ref_time_utc=ref.isoformat(),
                    forecast_time_utc=fcst.isoformat(),
                    lead_hours=lead,
                ))
            finally:
                codes_release(h)
    return out


# file: grib_index_refactor.py (continued)
def ensure_schema(db_path: str):
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.executescript(open("schema.sql", "r", encoding="utf-8").read())


def index_file(db_path: str, file_path: str):
    product, fn_fcst, fn_run = parse_cfs_filename(file_path)
    messages = scan_grib_messages(file_path)

    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute("PRAGMA busy_timeout=5000;")
        sql = """
              INSERT INTO records
              (product, file_path, run_time_utc, forecast_time_utc, lead_hours, var, level_type, level_value)
              VALUES (?, ?, ?, ?, ?, ?, ?,
                      ?) ON CONFLICT(file_path, var, level_type, level_value, forecast_time_utc) DO NOTHING; \
              """
        for m in messages:
            # prefer message-times; filename times are a fallback sanity check (optional)
            run_time = m["ref_time_utc"]
            forecast_time = m["forecast_time_utc"]
            conn.execute(sql, (
                product, os.path.abspath(file_path), run_time, forecast_time,
                int(m["lead_hours"]), m["var"], m["level_type"], m["level_value"]
            ))


def bulk_index(db_path: str, file_paths: list[str]):
    ensure_schema(db_path)
    for fp in file_paths:
        try:
            index_file(db_path, fp)
        except Exception as e:
            print(f"[index] skip {fp}: {e}")


# file: grib_index_refactor.py (continued)
def query_nearest(
        target_iso: str,
        products: list[str],
        variables: list[str],
        level_type: str | None = None,
        level_value: float | None = None,
        max_delta_hours: int | None = None,
):
    """
    Returns the best row (dict) or None.
    """
    if not products or not variables:
        raise ValueError("products and variables must be non-empty")

    placeholders_p = ",".join("?" for _ in products)
    placeholders_v = ",".join("?" for _ in variables)

    base = f"""
      SELECT
        id, product, file_path, run_time_utc, forecast_time_utc,
        lead_hours, var, level_type, level_value,
        ABS(strftime('%s', forecast_time_utc) - strftime('%s', ?)) AS abs_delta
      FROM records
      WHERE product IN ({placeholders_p}) AND var IN ({placeholders_v})
    """

    params = [target_iso, *products, *variables]

    if level_type is not None:
        base += " AND level_type = ?"
        params.append(level_type)
    if level_value is not None:
        base += " AND level_value = ?"
        params.append(level_value)

    # Optional bounding by max_delta_hours
    if max_delta_hours is not None:
        # abs_delta is in seconds; compare to hours
        base += " AND ABS(strftime('%s', forecast_time_utc) - strftime('%s', ?)) <= ?"
        params.extend([target_iso, max_delta_hours * 3600])

    # nearest by abs_delta, tie-break by newest run_time_utc
    base += " ORDER BY abs_delta ASC, run_time_utc DESC LIMIT 1"

    with closing(sqlite3.connect("./grib_index.sqlite")) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(base, params).fetchone()
        return dict(row) if row else None


# file: api_query.py
from typing import Sequence


def query_data(
        start_iso: str, end_iso: str,
        lon_min_0_360: float, lon_max_0_360: float,  # ignored by design (global)
        lat_min: float, lat_max: float,  # ignored by design (global)
        vars_any: Sequence[str],
        require_all: bool,
        products: Sequence[str],
        level_type: str | None = None,
        level_value: float | None = None,
):
    """
    Returns a *single best* match (nearest forecast in window midpoint).
    If you need 'all' vs 'any' later, we can extend to return 1-per-variable.
    """
    # pick midpoint of requested window as target
    from datetime import timezone
    from dateutil.parser import isoparse

    t0 = isoparse(start_iso)
    t1 = isoparse(end_iso)
    target = t0 + (t1 - t0) / 2
    target_iso = target.astimezone(timezone.utc).isoformat()

    # choose ANY of vars_any (nearest overall). If require_all, you can call once per var.
    best = query_nearest(
        target_iso,
        list(products),
        list(vars_any),
        level_type=level_type,
        level_value=level_value,
        max_delta_hours=None,  # or a guard like 12
    )
    if not best:
        return {"items": []}

    # Minimal, consistent with your earlier “prediction_time/create time/type/min/max” shape.
    # Min/Max of the grid value itself requires reading data; here we return metadata only.
    # If you want value_min/value_max, plug in a lazy data reader for that single message.
    return {
        "items": [{
            "file_path": best["file_path"],
            "product": best["product"],
            "type": best["var"],
            "level_type": best["level_type"],
            "level_value": best["level_value"],
            "prediction_time": best["forecast_time_utc"],
            "create_time": best["run_time_utc"],
            "lead_hours": best["lead_hours"],
            # placeholders for later data extraction step
            "value_min": None,
            "value_max": None,
        }]
    }
