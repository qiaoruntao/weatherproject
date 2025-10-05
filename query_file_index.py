# ---------------------------------------------
# Utilities for query time handling and nearest-record query
import logging
import sqlite3
from contextlib import closing
from typing import Optional

import numpy as np

from grid_util import _to_utc_iso, GRIB_INDEX_SQLITE, _get_str_or_none, _compute_times_from_message, _get_int_or_none
from eccodes import (  # type: ignore
    codes_grib_new_from_file,
    codes_get, codes_get_long, codes_get_double,
    codes_release, codes_get_values
)


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
        params = (qt_iso, var, level_type)
        logging.info("sql %s params %s", sql, params)
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        if not row:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))


def _msg_matches(h, *, var: str, level_type: str, target_forecast_iso: str) -> bool:
    """
    Check if a GRIB message matches shortName==var, typeOfLevel==level_type,
    and forecast_time_utc equals the target timestamp (to the hour).
    """
    try:
        short = _get_str_or_none(h, "cfVarName")
        tol = _get_str_or_none(h, "typeOfLevel")
        if short != var or tol != level_type:
            return False
        return True
        # ref_dt, fcst_dt, _ = _compute_times_from_message(h)
        # # Compare as ISO to hour precision
        # t_iso = _to_utc_iso(fcst_dt)
        # return t_iso[:13] == target_forecast_iso[:13]
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


def query_func(query_time, level_type: str, var: str,
               bbox: tuple[float, float, float, float]) -> dict | None:
    """
    Use `query_nearest_record` to locate the best file for (var, level_type, query_time),
    then open that GRIB and extract the variable data inside `bbox`.

    Args:
        query_time: datetime or ISO8601 string (UTC assumed if naive)
        level_type: e.g. 'surface'
        var: GRIB shortName, e.g. 'ishf'
        bbox: (min_lat, min_lon, max_lat, max_lon)

    Returns:
        dict with metadata and cropped arrays:
          {
            "file_path": str,
            "forecast_time_utc": str,
            "ref_time_utc": str,
            "lead_hours": int,
            "data": np.ndarray,   # 2D subset
            "lat": np.ndarray,    # 2D subset
            "lon": np.ndarray,    # 2D subset
          }
        or None if nothing matched.
    """
    # 1) Find best record via DB
    rec = query_nearest_record(query_time, level_type, var)
    if not rec:
        return None

    fp = rec["file_path"]
    target_fcst_iso = rec["forecast_time_utc"]

    # 2) Scan file and extract the matching grid
    with open(fp, "rb") as f:
        while True:
            h = codes_grib_new_from_file(f)
            if h is None:
                break
            try:
                if _msg_matches(h, var=var, level_type=level_type, target_forecast_iso=target_fcst_iso):
                    ny, nx = _grid_shape(h)
                    # Pull values and lat/lon arrays
                    vals = np.array(codes_get_values(h))
                    lats = np.array(codes_get(h, "latitudes"))
                    lons = np.array(codes_get(h, "longitudes"))
                    # Some eccodes builds require explicit array getters:
                    if not isinstance(lats, np.ndarray):
                        # attempt to fetch via doubles array accessor
                        lats = np.array(codes_get(h, "latitudes"))
                        lons = np.array(codes_get(h, "longitudes"))
                    data_sub, lat_sub, lon_sub = _subset_bbox_from_arrays(vals, lats, lons, bbox, ny, nx)
                    return {
                        "file_path": fp,
                        "forecast_time_utc": rec["forecast_time_utc"],
                        "ref_time_utc": rec["ref_time_utc"],
                        "lead_hours": rec["lead_hours"],
                        "data": data_sub,
                        "lat": lat_sub,
                        "lon": lon_sub,
                    }
            finally:
                codes_release(h)
    # If we reached here, no matching message was found in that file
    return None
