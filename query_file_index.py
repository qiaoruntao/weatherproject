# ---------------------------------------------
# Utilities for query time handling and nearest-record query
import logging
import sqlite3
from collections.abc import Sequence, Mapping
from contextlib import closing
from typing import Optional
import sys
import multiprocessing as mp
from concurrent.futures import ThreadPoolExecutor

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
import numpy as np
from eccodes import (  # type: ignore
    codes_grib_new_from_file,
    codes_grib_get_data,
    codes_get, codes_get_long,
    codes_release, codes_get_values
)

from grid_util import _to_utc_iso, GRIB_INDEX_SQLITE, _get_str_or_none, _get_int_or_none

from concurrent.futures import ProcessPoolExecutor, as_completed


def _to_iso_str_or_passthrough(t) -> str:
    """
    Accepts a datetime (naive or tz-aware) or an ISO8601 string and returns an ISO8601 UTC string.
    """
    if isinstance(t, str):
        # Try to normalize strings that include an explicit timezone
        if "Z" in t or "+" in t or "-" in t[10:]:
            from datetime import datetime
            dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
            return _to_utc_iso(dt)
        return t
    else:
        return _to_utc_iso(t)


def query_nearest_record(query_time, level_type: str, var: str) -> Optional[dict]:
    """
    Return the single best-matching record for `var` and `level_type` whose forecast_time_utc is
    closest to `query_time`. In a tie on closeness, choose the newest by ref_time_utc.
    """
    qt_iso = _to_iso_str_or_passthrough(query_time)
    sql = """
          SELECT id,
                 file_path,
                 var,
                 level_type,
                 ref_time_utc,
                 forecast_time_utc,
                 lead_hours,
                 ABS((julianday(forecast_time_utc) - julianday(?)) * 24.0) AS delta_hours
          FROM records
          WHERE var = ?
            AND level_type = ?
          ORDER BY delta_hours ASC,
                   ref_time_utc DESC LIMIT 1; \
          """
    with closing(sqlite3.connect(GRIB_INDEX_SQLITE)) as conn:
        conn.execute("PRAGMA busy_timeout=8000;")
        cur = conn.execute(sql, (qt_iso, var, level_type))
        row = cur.fetchone()
        if not row:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))


def query_records_in_range(start_time, end_time, level_type: str, var: str) -> list[dict]:
    """
    Return newest-by-ref_time entries for each forecast_time_utc within [start_time, end_time] (inclusive),
    filtered by var and level_type, ordered by forecast_time_utc ASC.
    """
    start_iso = _to_iso_str_or_passthrough(start_time)
    end_iso = _to_iso_str_or_passthrough(end_time)
    sql = """
          WITH ranked AS (SELECT id,
                                 file_path,
                                 var,
                                 level_type,
                                 ref_time_utc,
                                 forecast_time_utc,
                                 lead_hours,
                                 ROW_NUMBER() OVER (
          PARTITION BY var, level_type, forecast_time_utc
          ORDER BY ref_time_utc DESC
        ) AS rn
                          FROM records
                          WHERE var = ?
                            AND level_type = ?
                            AND forecast_time_utc >= ?
                            AND forecast_time_utc <= ?)
          SELECT id, file_path, var, level_type, ref_time_utc, forecast_time_utc, lead_hours
          FROM ranked
          WHERE rn = 1
          ORDER BY forecast_time_utc ASC; \
          """
    with closing(sqlite3.connect(GRIB_INDEX_SQLITE)) as conn:
        conn.execute("PRAGMA busy_timeout=8000;")
        cur = conn.execute(sql, (var, level_type, start_iso, end_iso))
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in rows]


def _msg_matches(h, *, var: str, level_type: str) -> bool:
    """
    Check if a GRIB message matches shortName==var, typeOfLevel==level_type,
    and forecast_time_utc equals the target timestamp (to the hour).
    """
    try:
        var_name = _get_str_or_none(h, "cfVarName")
        short = _get_str_or_none(h, "shortName")
        tol = _get_str_or_none(h, "typeOfLevel")
        # logging.info("var=%s, level_type=%s, short=%s" % (var_name, tol, short))
        if (var_name != var and short != var) or tol != level_type:
            return False
        return True
    except Exception:
        return False


def _grid_shape(h) -> tuple[int, int]:
    """
    Infer grid shape (ny, nx) from common keys.
    """
    for nx_key, ny_key in (("Ni", "Nj"), ("nx", "ny")):
        nx = _get_int_or_none(h, nx_key)
        ny = _get_int_or_none(h, ny_key)
        if nx and ny:
            return int(ny), int(nx)
    # Fallback: try 'numberOfPoints' and a square-ish guess (rare)
    npts = _get_int_or_none(h, "numberOfPoints")
    if npts:
        side = int(round(npts ** 0.5))
        return side, max(1, npts // max(1, side))
    raise ValueError("Unable to determine grid shape (nx/ny).")


def _subset_bbox_from_arrays(vals: np.ndarray, lats: np.ndarray, lons: np.ndarray,
                             bbox: tuple[float, float, float, float],
                             ny: int, nx: int):
    """
    Reshape 1D arrays to (ny, nx), then mask to bbox and return cropped arrays.
    bbox = (min_lat, min_lon, max_lat, max_lon)
    """
    vals2 = vals.reshape(ny, nx)
    lat2 = lats.reshape(ny, nx)
    lon2 = lons.reshape(ny, nx)
    min_lat, min_lon, max_lat, max_lon = bbox
    mask = (lat2 >= min_lat) & (lat2 <= max_lat) & (lon2 >= min_lon) & (lon2 <= max_lon)
    if not mask.any():
        # Return empty slices to signal no overlap
        return vals2[0:0, 0:0], lat2[0:0, 0:0], lon2[0:0, 0:0]
    idx = np.where(mask)
    y0, y1 = idx[0].min(), idx[0].max()
    x0, x1 = idx[1].min(), idx[1].max()
    return vals2[y0:y1 + 1, x0:x1 + 1], lat2[y0:y1 + 1, x0:x1 + 1], lon2[y0:y1 + 1, x0:x1 + 1]


def _process_record_worker(rec: dict, var: str, level_type: str, bbox: tuple[float, float, float, float]) -> list[dict]:
    """
    Worker to extract all bbox points for a single record (newest per forecast) using ecCodes.
    Returns a list of rows in the same schema as query_func emits.
    """
    fp = rec["file_path"]
    out: list[dict] = []
    try:
        with open(fp, "rb") as f:
            while True:
                h = codes_grib_new_from_file(f)
                if h is None:
                    break
                try:
                    if _msg_matches(h, var=var, level_type=level_type):
                        raw = codes_grib_get_data(h)
                        if not (isinstance(raw, Sequence) and len(raw) > 0 and isinstance(raw[0], Mapping)
                                and all(k in raw[0] for k in ("lat", "lon", "value"))):
                            # Skip unsupported return types in worker (query_func enforces Case 1)
                            break
                        npts = len(raw)
                        lats = np.fromiter((item["lat"] for item in raw), dtype=float, count=npts)
                        lons = np.fromiter((item["lon"] for item in raw), dtype=float, count=npts)
                        vals = np.fromiter((item["value"] for item in raw), dtype=float, count=npts)
                        min_lat, min_lon, max_lat, max_lon = bbox
                        m = (lats >= min_lat) & (lats <= max_lat) & (lons >= min_lon) & (lons <= max_lon)
                        if m.any():
                            vt_iso = rec["forecast_time_utc"]
                            create_time = rec["ref_time_utc"]
                            path = fp
                            sel_vals = vals[m]
                            sel_lats = lats[m]
                            sel_lons = lons[m]
                            out.extend(
                                {
                                    "prediction_time": vt_iso,
                                    "create_time": create_time,
                                    "type": var,
                                    "level": level_type,
                                    "json_key": var + '_' + level_type,
                                    "value_min": float(val),
                                    "value_max": float(val),
                                    "path": path,
                                    "lat": float(la),
                                    "lon": float(lo),
                                }
                                for val, la, lo in zip(sel_vals, sel_lats, sel_lons)
                            )
                        break  # found the matching message in this file
                finally:
                    if 'h' in locals() and h is not None:
                        codes_release(h)
    except Exception as e:
        # Return empty list on error; main process can log if needed
        logging.warning("Worker failed for %s: %s", fp, e)
    return out


def query_func(start_query_time, end_query_time, level_type: str, var: str,
               bbox: tuple[float, float, float, float],
               max_workers: int = 8,
               prefer_processes: bool = True) -> list[dict]:
    """
    For all forecasts within [start_query_time, end_query_time] (inclusive) for (var, level_type),
    pick the newest record per forecast_time_utc, open its GRIB, and extract ALL points within `bbox`.

    Args:
        start_query_time: datetime or ISO8601 string (UTC assumed if naive)
        end_query_time: datetime or ISO8601 string (UTC assumed if naive)
        level_type: e.g. 'surface'
        var: GRIB shortName, e.g. 'ishf'
        bbox: (min_lat, min_lon, max_lat, max_lon)
        max_workers: degree of parallelism (default 8)
        prefer_processes: use process-based parallelism when safe; falls back to threads on failure

    Returns:
        List of dicts with all points inside the bbox for all matching forecasts:
          [
            {
              "prediction_time": str,
              "create_time": str,
              "type": str,
              "value_min": float,
              "value_max": float,
              "path": str,
              "lat": float,
              "lon": float,
            },
            ...
          ]
        Possibly empty list if nothing matched.
    """
    records = query_records_in_range(start_query_time, end_query_time, level_type, var)
    if not records:
        return []
    all_out: list[dict] = []

    def _run_with_executor(executor_cls):
        out_local: list[dict] = []
        with executor_cls(max_workers=max_workers) as ex:
            futures = [ex.submit(_process_record_worker, rec, var, level_type, bbox) for rec in records]
            for fut in as_completed(futures):
                try:
                    part = fut.result()
                    if part:
                        out_local.extend(part)
                except Exception as e:
                    logging.warning("Extraction future failed: %s", e)
        return out_local

    ran = False
    if prefer_processes:
        # Try to choose a safe start method on POSIX to reduce spawn/import issues.
        try:
            # Use 'fork' when available to avoid re-importing __main__; ignore if already set.
            if mp.get_start_method(allow_none=True) is None:
                try:
                    mp.set_start_method('fork')
                except Exception:
                    # Fall back silently; we'll still try processes
                    pass
            all_out = _run_with_executor(ProcessPoolExecutor)
            ran = True
        except RuntimeError as e:
            # Common when caller did not guard with if __name__ == '__main__'
            logging.warning("Process pool spawn failed (%s). Falling back to threads.", e)
        except Exception as e:
            logging.warning("Process pool failed (%s). Falling back to threads.", e)
    if not ran:
        # Thread fallback – ecCodes is C-heavy and releases the GIL on IO/decoding so this still scales.
        all_out = _run_with_executor(ThreadPoolExecutor)

    return all_out
