#!/usr/bin/env python3
# grib_index_v2.py
#
# Build + query a GRIB2 index optimized for 0..360 longitudes, with
# one row per (file, variable) so you can filter directly by variable.
# python grib_index.py build data
# Requires: python-eccodes  (pip/conda: 'eccodes')

from __future__ import annotations

import json
import logging
import os
import pathlib
import re
import sqlite3
import sys
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple, Set

import cfgrib  # for open_datasets across groups
import numpy as np
import pandas as pd
# Additional imports for data access/subsetting
import xarray as xr
from eccodes import (  # type: ignore
    codes_grib_new_from_file,
    codes_get, codes_get_long, codes_get_double,
    codes_release,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

xr.set_options(use_new_combine_kwarg_defaults=True)

# ===================== Utilities =====================

FNAME_CYCLE_RE = re.compile(r"^(?P<prod>[a-z]+)(?P<cyc>\d{10})\.(?P<memb>\d{2})\.(?P<valid>\d{10})", re.IGNORECASE)


def _to_iso(date_int: int, time_int: int) -> str:
    """date_int=YYYYMMDD, time_int=HHMM -> 'YYYY-MM-DDTHH:MM:00Z'"""
    s = f"{date_int:08d}{time_int:04d}"
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:00Z"


def _minmax(a: float, b: float) -> Tuple[float, float]:
    return (a, b) if a <= b else (b, a)


def _lon_to_0_360(x: float) -> float:
    """Normalize longitude to [0, 360)."""
    return x % 360.0


def _rtree_available(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _rt USING rtree(id,minx,maxx,miny,maxy)")
        conn.execute("DROP TABLE _rt")
        return True
    except sqlite3.DatabaseError:
        return False


# ===================== Metadata extraction =====================

@dataclass
class FileMeta:
    path: str
    size: int
    mtime: float
    product: str
    cycle_time: str  # ISO
    time_start: str  # ISO
    time_end: str  # ISO
    lat_min: float
    lat_max: float
    lon_min_0_360: float
    lon_max_0_360: float
    variables: Set[str]


def _parse_filename_meta(path: str) -> Tuple[str, Optional[str]]:
    """
    Returns (product, cycle_time_iso or None) from filename if it matches common CFS style:
      flxfYYYYMMDDHH.xx.YYYYMMDDHH.grb2
      ocnfYYYYMMDDHH.xx.YYYYMMDDHH.grb2
    """
    bn = os.path.basename(path)
    m = FNAME_CYCLE_RE.match(bn)
    if not m:
        prod = bn[:4].lower()
        return prod, None
    prod = m.group("prod").lower()
    cyc = m.group("cyc")
    # 'YYYYMMDDHH' -> ISO
    cyc_iso = f"{cyc[0:4]}-{cyc[4:6]}-{cyc[6:8]}T{cyc[8:10]}:00:00Z"
    return prod, cyc_iso


def extract_file_metadata(path: str) -> FileMeta:
    """
    Scan GRIB headers only (no data) and compute:
      - product, cycle_time (from filename if possible)
      - time_start, time_end (min/max validity across messages)
      - lat/lon bbox (normalize lon to 0..360)
      - set of variables (shortName)
    """
    size = os.path.getsize(path)
    mtime = os.path.getmtime(path)
    product, cycle_time = _parse_filename_meta(path)

    tstart_iso: Optional[str] = None
    tend_iso: Optional[str] = None
    lat_min, lat_max = +1e9, -1e9
    lon_min, lon_max = +1e9, -1e9
    variables: Set[str] = set()

    with open(path, "rb") as f:
        while True:
            gid = codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                # variables
                try:
                    sn = codes_get(gid, "shortName")
                    if sn: variables.add(sn)
                except Exception:
                    pass

                # time range: prefer validityDate/Time
                vt_iso = None
                try:
                    vdate = int(codes_get_long(gid, "validityDate"))
                    vtime = int(codes_get_long(gid, "validityTime"))
                    vt_iso = _to_iso(vdate, vtime)
                except Exception:
                    try:
                        ddate = int(codes_get_long(gid, "dataDate"))
                        dtime = int(codes_get_long(gid, "dataTime"))
                        vt_iso = _to_iso(ddate, dtime)
                    except Exception:
                        pass
                if vt_iso:
                    tstart_iso = vt_iso if tstart_iso is None or vt_iso < tstart_iso else tstart_iso
                    tend_iso = vt_iso if tend_iso is None or vt_iso > tend_iso else tend_iso

                # spatial bbox (first/last grid point)
                try:
                    lo1 = float(codes_get_double(gid, "longitudeOfFirstGridPointInDegrees"))
                    lo2 = float(codes_get_double(gid, "longitudeOfLastGridPointInDegrees"))
                    la1 = float(codes_get_double(gid, "latitudeOfFirstGridPointInDegrees"))
                    la2 = float(codes_get_double(gid, "latitudeOfLastGridPointInDegrees"))
                    # normalize lon to [0,360)
                    lomin, lomax = _minmax(_lon_to_0_360(lo1), _lon_to_0_360(lo2))
                    lamin, lamax = _minmax(la1, la2)
                    lon_min = min(lon_min, lomin)
                    lon_max = max(lon_max, lomax)
                    lat_min = min(lat_min, lamin)
                    lat_max = max(lat_max, lamax)
                except Exception:
                    pass
            finally:
                codes_release(gid)

    if cycle_time is None:
        # fallback: use earliest message time as "cycle"
        cycle_time = tstart_iso or "1970-01-01T00:00:00Z"
    if tstart_iso is None or tend_iso is None:
        tstart_iso = tend_iso = "1970-01-01T00:00:00Z"
    if lat_min > lat_max:
        lat_min, lat_max = -90.0, 90.0
    if lon_min > lon_max:
        lon_min, lon_max = 0.0, 360.0

    # clamp to 0..360 just in case
    lon_min = max(0.0, min(360.0, lon_min))
    lon_max = max(0.0, min(360.0, lon_max))

    return FileMeta(
        path=path,
        size=size,
        mtime=mtime,
        product=product,
        cycle_time=cycle_time,
        time_start=tstart_iso,
        time_end=tend_iso,
        lat_min=float(lat_min),
        lat_max=float(lat_max),
        lon_min_0_360=float(lon_min),
        lon_max_0_360=float(lon_max),
        variables=variables,
    )


# ===================== SQLite schema =====================

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  product TEXT,
  cycle_time TEXT,
  time_start TEXT,
  time_end   TEXT,
  lat_min REAL,
  lat_max REAL,
  lon_min_0_360 REAL,
  lon_max_0_360 REAL,
  variables_json TEXT,
  size INTEGER,
  mtime REAL
);

-- One row per (file, variable)
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL,
  var TEXT NOT NULL,
  UNIQUE(file_id, var)
);

-- Spatial index keyed by record id, in 0..360 lon space
CREATE VIRTUAL TABLE IF NOT EXISTS spatial_index USING rtree(
  rec_id,
  min_lon, max_lon,
  min_lat, max_lat
);

CREATE INDEX IF NOT EXISTS idx_files_time ON files(time_start, time_end);
CREATE INDEX IF NOT EXISTS idx_records_var ON records(var);
"""


# ===================== Index builder =====================

def build_index(root: str, db_path: str, patterns=("*.grb2", "*.grib2")) -> None:
    rootp = pathlib.Path(root)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.executescript(SCHEMA)
    has_rtree = _rtree_available(conn)
    if not has_rtree:
        print("[WARN] SQLite R-Tree not available; spatial queries will be slower.", file=sys.stderr)

    cur = conn.cursor()
    existing = {row[0]: (row[1], row[2]) for row in cur.execute("SELECT path,size,mtime FROM files")}

    files = []
    for pat in patterns:
        files.extend(rootp.rglob(pat))
    files = sorted(set(map(str, files)))

    to_refresh: List[FileMeta] = []
    for fp in files:
        st = os.stat(fp)
        if fp in existing:
            sz, mt = existing[fp]
            if sz == st.st_size and abs(mt - st.st_mtime) < 0.5:
                continue  # up-to-date
        try:
            meta = extract_file_metadata(fp)
            to_refresh.append(meta)
            print(f"[indexed] {fp} vars={len(meta.variables)} time={meta.time_start}..{meta.time_end}")
        except Exception as e:
            print(f"[ERROR] {fp}: {e}", file=sys.stderr)

    for m in to_refresh:
        # upsert file
        cur.execute("""
                    INSERT INTO files(path, product, cycle_time, time_start, time_end,
                                      lat_min, lat_max, lon_min_0_360, lon_max_0_360,
                                      variables_json, size, mtime)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO
                    UPDATE SET
                        product=excluded.product,
                        cycle_time=excluded.cycle_time,
                        time_start=excluded.time_start,
                        time_end =excluded.time_end,
                        lat_min=excluded.lat_min, lat_max=excluded.lat_max,
                        lon_min_0_360=excluded.lon_min_0_360, lon_max_0_360=excluded.lon_max_0_360,
                        variables_json=excluded.variables_json,
                        size =excluded.size, mtime=excluded.mtime
                    """, (
                        m.path, m.product, m.cycle_time, m.time_start, m.time_end,
                        m.lat_min, m.lat_max, m.lon_min_0_360, m.lon_max_0_360,
                        json.dumps(sorted(m.variables)), m.size, m.mtime
                    ))

        file_id = cur.execute("SELECT id FROM files WHERE path=?", (m.path,)).fetchone()[0]

        # refresh records for this file
        cur.execute("DELETE FROM records WHERE file_id=?", (file_id,))
        cur.executemany(
            "INSERT INTO records(file_id, var) VALUES (?,?)",
            [(file_id, v) for v in sorted(m.variables)]
        )

        # refresh spatial index (one row per record; bbox shared by file)
        if has_rtree:
            # delete any prior rows for these records
            rec_ids = [r[0] for r in cur.execute("SELECT id FROM records WHERE file_id=?", (file_id,)).fetchall()]
            if rec_ids:
                qmarks = ",".join("?" * len(rec_ids))
                cur.execute(f"DELETE FROM spatial_index WHERE rec_id IN ({qmarks})", rec_ids)
            # insert rows
            bbox = (m.lon_min_0_360, m.lon_max_0_360, m.lat_min, m.lat_max)
            cur.executemany(
                "INSERT INTO spatial_index(rec_id, min_lon, max_lon, min_lat, max_lat) VALUES (?,?,?,?,?)",
                [(rid, bbox[0], bbox[1], bbox[2], bbox[3]) for rid in rec_ids]
            )

    conn.commit()
    conn.close()


# ===================== Query =====================

def query(
        start_iso: str,
        end_iso: str,
        vars_any: Optional[Iterable[str]] = None,  # match ANY of these variables
        products: Optional[Iterable[str]] = None,  # e.g., ["flxf","ocnf"]
) -> List[dict]:
    """
    Query using the global (non-spatial) index produced by bunk_index.py.
    Filters by time window, product, and variables.
    """
    # Ensure DB exists before opening
    if not os.path.exists("grib_index.sqlite"):
        logging.error("[query] SQLite DB not found: grib_index.sqlite")
        return []
    conn = sqlite3.connect("grib_index.sqlite")
    cur = conn.cursor()
    # Compose query
    where_clauses = []
    params = []
    where_clauses.append("forecast_time_utc >= ?")
    params.append(start_iso)
    where_clauses.append("forecast_time_utc <= ?")
    params.append(end_iso)
    if products:
        where_clauses.append("product IN ({})".format(",".join("?" * len(products))))
        params.extend([p.lower() for p in products])
    # if vars_any:
    #     where_clauses.append("var IN ({})".format(",".join("?" * len(vars_any))))
    #     params.extend(list(vars_any))

    base = f"""
        SELECT product, file_path,
               MAX(run_time_utc) as cycle_time,
               MIN(forecast_time_utc) as time_start,
               MAX(forecast_time_utc) as time_end,
               GROUP_CONCAT(DISTINCT var) as variables,
               COUNT(DISTINCT var) as nvars
        FROM records
        WHERE {" AND ".join(where_clauses)}
        GROUP BY product, file_path
    """
    order_clause = " ORDER BY cycle_time DESC"
    sql = base + order_clause
    logging.info(f"[query] SQL: {sql} {params}")
    rows = cur.execute(sql, params).fetchall()
    result = []
    for row in rows:
        product, path, cycle_time, time_start, time_end, variables_str, nvars = row
        variables = sorted(set(variables_str.split(","))) if variables_str else []
        result.append({
            "file_id": None,
            "path": path,
            "product": product,
            "cycle_time": cycle_time,
            "time_start": time_start,
            "time_end": time_end,
            "lat_min": -90.0,
            "lat_max": 90.0,
            "lon_min_0_360": 0.0,
            "lon_max_0_360": 360.0,
            "variables": variables,
        })
    conn.close()
    return result[:1]


# ===================== query_data: open/subset files with xarray/cfgrib =====================
def query_data(
        start_iso: str,
        end_iso: str,
        lon_min_0_360: float,
        lon_max_0_360: float,
        lat_min: float,
        lat_max: float,
        vars_any: Optional[Iterable[str]] = None,  # match ANY of these variables
        products: Optional[Iterable[str]] = None,  # e.g., ["flxf","ocnf"]
) -> List[dict]:
    """
    Runs `query()` to find candidate files, opens each file, subsets by time/space/vars
    and returns ONLY compact summaries per variable and prediction time:
        {
          'prediction_time': <ISO valid time>,
          'create_time': <file cycle/init ISO>,
          'type': <variable shortName>,
          'value_min': <float>,
          'value_max': <float>,
          'path': <source file>  # included for traceability
        }
    Notes:
      - Designed for CFS-style regular lat/lon grids with lon in 0..360.
      - If lon_min_0_360 > lon_max_0_360, selection wraps across 360.
      - Uses `cfgrib.open_datasets(..., indexpath=indexpath)` to read all groups.
      - By default `indexpath=""` disables writing sidecar .idx files.
    """
    # First, shortlist files using the existing index
    candidates = query(
        start_iso=start_iso,
        end_iso=end_iso,
        vars_any=vars_any,
        products=products,
    )
    logging.info(f"Found {len(candidates)} candidates")
    rows: List[dict] = []
    if not candidates:
        return rows

    # Helper to select indices respecting possible descending latitude
    def _select_indices(ds: xr.Dataset, lat_min: float, lat_max: float,
                        lon_min: float, lon_max: float) -> Tuple[np.ndarray, np.ndarray]:
        # Get coordinate names (prefer 'latitude'/'longitude')
        lat_name = "latitude" if "latitude" in ds.coords else ("lat" if "lat" in ds.coords else None)
        lon_name = "longitude" if "longitude" in ds.coords else ("lon" if "lon" in ds.coords else None)
        if lat_name is None or lon_name is None:
            raise ValueError("Dataset lacks latitude/longitude coordinates")

        lats = ds[lat_name].values
        lons = ds[lon_name].values

        # Ensure 1D coords
        if lats.ndim != 1 or lons.ndim != 1:
            # Some products may have 2D curvilinear coords; fall back to full domain
            return np.arange(lats.shape[-1]), np.arange(lons.shape[-1])

        # Latitude can be ascending or descending; construct mask based on values
        lat_mask = (lats >= min(lat_min, lat_max)) & (lats <= max(lat_min, lat_max))
        lat_idx = np.where(lat_mask)[0]

        # Longitudes are 0..360; handle wrap
        if lon_min <= lon_max:
            lon_mask = (lons >= lon_min) & (lons <= lon_max)
        else:
            lon_mask = (lons >= lon_min) | (lons <= lon_max)
        lon_idx = np.where(lon_mask)[0]
        return lat_idx, lon_idx

    # Time window parsing
    q_start = pd.to_datetime(start_iso)
    q_end = pd.to_datetime(end_iso)

    def _subset_time(ds: xr.Dataset) -> xr.Dataset | None:
        # Many CFS files have scalar time/valid_time. If a 1D time exists, slice it.
        # Prefer 'valid_time', else attempt 'time' and 'step' composition.
        if "valid_time" in ds.coords:
            vt = ds["valid_time"]
            if vt.ndim == 0:
                ts = pd.to_datetime(vt.values)
                if (ts >= q_start) and (ts <= q_end):
                    return ds
                return None
            else:
                vt_pd = pd.to_datetime(vt.values)
                mask = (vt_pd >= q_start) & (vt_pd <= q_end)
                if mask.any():
                    return ds.isel({vt.dims[0]: np.where(mask)[0]})
                return None
        # Fallback: scalar 'time' +/- 'step'
        if "time" in ds.coords:
            base_t = pd.to_datetime(ds["time"].values)
            if "step" in ds.coords:
                st = ds["step"]
                if st.ndim == 0:
                    vt = base_t + pd.to_timedelta(st.values)
                    return ds if (vt >= q_start) and (vt <= q_end) else None
                else:
                    vt_vals = base_t + pd.to_timedelta(st.values)
                    mask = (vt_vals >= q_start) & (vt_vals <= q_end)
                    if mask.any():
                        return ds.isel({st.dims[0]: np.where(mask)[0]})
                    return None
            else:
                return ds if (base_t >= q_start) and (base_t <= q_end) else None
        # If no recognizable time, keep the dataset (query already filtered at file level)
        return ds

    def _iter_prediction_times(ds: xr.Dataset, da: xr.DataArray):
        """
        Yield tuples: (prediction_time_iso: str, indexer: dict or None)
        indexer is used in .isel to select the time slice for this prediction time.
        """
        # 1) Prefer valid_time
        if "valid_time" in ds.coords:
            vt = ds["valid_time"]
            if vt.ndim == 0:
                yield (pd.to_datetime(vt.values).isoformat(), None)
                return
            # vt has a single dim, typically 'time' or 'step'
            tdim = vt.dims[0]
            # only iterate if the dataarray shares that dim
            if tdim in da.dims:
                vts = pd.to_datetime(vt.values)
                for i in range(vt.sizes[tdim]):
                    yield (pd.to_datetime(vts[i]).isoformat(), {tdim: i})
                return
            else:
                # data does not vary in time; single summary with first vt
                yield (pd.to_datetime(vt.values[0]).isoformat(), None)
                return
        # 2) Compose from time + step
        if "time" in ds.coords:
            base_t = pd.to_datetime(ds["time"].values)
            if "step" in ds.coords:
                st = ds["step"]
                if st.ndim == 0:
                    vt = base_t + pd.to_timedelta(st.values)
                    yield (pd.to_datetime(vt).isoformat(), None)
                    return
                else:
                    tdim = st.dims[0]
                    if tdim in da.dims:
                        steps = pd.to_timedelta(st.values)
                        for i in range(st.sizes[tdim]):
                            vt = base_t + steps[i]
                            yield (pd.to_datetime(vt).isoformat(), {tdim: i})
                        return
            # fallback to plain 'time'
            if np.ndim(ds["time"].values) == 0:
                yield (pd.to_datetime(base_t).isoformat(), None)
            else:
                tdim = ds["time"].dims[0]
                if tdim in da.dims:
                    tvals = pd.to_datetime(ds["time"].values)
                    for i in range(ds["time"].sizes[tdim]):
                        yield (pd.to_datetime(tvals[i]).isoformat(), {tdim: i})
                else:
                    yield (pd.to_datetime(ds["time"].values[0]).isoformat(), None)

    for cand in candidates:
        path = cand["path"]
        create_time = cand.get("cycle_time")
        try:
            # Open all groups for the GRIB file, then merge
            ds_list = cfgrib.open_datasets(path)
            if not ds_list:
                continue
            ds = xr.merge(ds_list, compat="override", join="outer")

            # Subset time window (if applicable)
            ds = _subset_time(ds)
            if ds is None:
                continue

            # Spatial subset indices (computed once per file)
            lat_idx, lon_idx = _select_indices(ds, lat_min, lat_max, lon_min_0_360, lon_max_0_360)
            if lat_idx.size == 0 or lon_idx.size == 0:
                continue

            # Build indexers we can reuse
            indexers = {}
            if "latitude" in ds.dims:
                indexers["latitude"] = lat_idx
            elif "lat" in ds.dims:
                indexers["lat"] = lat_idx
            if "longitude" in ds.dims:
                indexers["longitude"] = lon_idx
            elif "lon" in ds.dims:
                indexers["lon"] = lon_idx

            # Limit to requested variables (if any)
            var_names = list(ds.data_vars.keys())
            if vars_any:
                # Using default ANY behavior
                var_names = [v for v in var_names if v in set(vars_any)]

            # For each variable, iterate prediction times and compute min/max over non-time dims
            for v in var_names:
                da = ds[v]
                # Apply spatial subset where possible
                da_sel = da
                usable_indexers = {k: v for k, v in indexers.items() if k in da_sel.dims}
                if usable_indexers:
                    da_sel = da_sel.isel(**usable_indexers)

                # Iterate times
                had_time = False
                for vt_iso, t_indexer in _iter_prediction_times(ds, da_sel):
                    had_time = True
                    da_t = da_sel if t_indexer is None else da_sel.isel(
                        **{k: v for k, v in (t_indexer or {}).items() if k in da_sel.dims})
                    # Reduce across remaining dims
                    try:
                        vmin = float(da_t.min(skipna=True).values)
                        vmax = float(da_t.max(skipna=True).values)
                    except Exception:
                        # As a fallback, convert to numpy
                        arr = np.asarray(da_t.values)
                        vmin = float(np.nanmin(arr))
                        vmax = float(np.nanmax(arr))
                    rows.append({
                        "prediction_time": vt_iso,
                        "create_time": create_time,
                        "type": v,
                        "value_min": vmin,
                        "value_max": vmax,
                        "path": path,
                    })
                if not had_time:
                    # No explicit time axis; treat as single prediction at file's time_start
                    vt_iso = cand.get("time_start")
                    try:
                        vmin = float(da_sel.min(skipna=True).values)
                        vmax = float(da_sel.max(skipna=True).values)
                    except Exception:
                        arr = np.asarray(da_sel.values)
                        vmin = float(np.nanmin(arr))
                        vmax = float(np.nanmax(arr))
                    rows.append({
                        "prediction_time": vt_iso,
                        "create_time": create_time,
                        "type": v,
                        "value_min": vmin,
                        "value_max": vmax,
                        "path": path,
                    })

        except Exception as e:
            # Skip problematic files but keep going
            print(f"[WARN] query_data failed on {path}: {e}", file=sys.stderr)
            continue

    # Tie-break: for identical (variable, prediction_time), keep newest create_time
    if rows:
        best = {}
        for r in rows:
            key = (r.get("type"), r.get("prediction_time"))
            prev = best.get(key)
            # Compare ISO strings lexicographically; they are UTC ISO so lexical == chronological
            if prev is None or (r.get("create_time") or "") > (prev.get("create_time") or ""):
                best[key] = r
        rows = list(best.values())
    return rows
