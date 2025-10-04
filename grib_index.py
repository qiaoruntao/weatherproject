#!/usr/bin/env python3
# grib_index_v2.py
#
# Build + query a GRIB2 index optimized for 0..360 longitudes, with
# one row per (file, variable) so you can filter directly by variable.
#
# Requires: python-eccodes  (pip/conda: 'eccodes')

from __future__ import annotations
import os, sys, json, re, sqlite3, pathlib
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple, Set

from eccodes import (  # type: ignore
    codes_grib_new_from_file,
    codes_get, codes_get_long, codes_get_double,
    codes_release,
)

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
        db_path: str,
        start_iso: str,
        end_iso: str,
        lon_min_0_360: float,
        lon_max_0_360: float,
        lat_min: float,
        lat_max: float,
        vars_any: Optional[Iterable[str]] = None,  # match ANY of these variables
        require_all: bool = False,  # if True, require all listed variables
        products: Optional[Iterable[str]] = None,  # e.g., ["flxf","ocnf"]
) -> List[dict]:
    """
    Fast query in 0..360 lon space. Supports wrap (lon_min > lon_max) by
    running two sub-queries and unioning results.
    """
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    prods = tuple(p.lower() for p in products) if products else None
    vars_list = tuple(vars_any) if vars_any else None

    def _one_span(a: float, b: float) -> List[dict]:
        # R-Tree path
        rows: List[tuple] = []
        base = """
               SELECT DISTINCT f.id,
                               f.path,
                               f.product,
                               f.cycle_time,
                               f.time_start,
                               f.time_end,
                               f.lat_min,
                               f.lat_max,
                               f.lon_min_0_360,
                               f.lon_max_0_360,
                               f.variables_json
               FROM spatial_index s
                        JOIN records r ON r.id = s.rec_id
                        JOIN files f ON f.id = r.file_id
               WHERE s.max_lon >= ?
                 AND s.min_lon <= ?
                 AND s.max_lat >= ?
                 AND s.min_lat <= ?
                 AND f.time_end >= ?
                 AND f.time_start <= ? \
               """
        params = [a, b, lat_min, lat_max, start_iso, end_iso]
        if prods:
            base += " AND f.product IN ({})".format(",".join("?" * len(prods)))
            params.extend(list(prods))
        if vars_list and not require_all:
            base += " AND r.var IN ({})".format(",".join("?" * len(vars_list)))
            params.extend(list(vars_list))
        rows = cur.execute(base, params).fetchall()

        if vars_list and require_all:
            # require ALL variables -> group by file and check set inclusion
            file_ids = [r[0] for r in rows]
            if not file_ids:
                return []
            qmarks = ",".join("?" * len(file_ids))
            var_map = {}
            for fid, var in cur.execute(f"SELECT file_id,var FROM records WHERE file_id IN ({qmarks})", file_ids):
                var_map.setdefault(fid, set()).add(var)
            need = set(vars_list)
            rows = [r for r in rows if var_map.get(r[0], set()).issuperset(need)]

        # de-dup by file id; convert to dict
        seen, out = set(), []
        for r in rows:
            if r[0] in seen:
                continue
            seen.add(r[0])
            out.append({
                "file_id": r[0],
                "path": r[1],
                "product": r[2],
                "cycle_time": r[3],
                "time_start": r[4],
                "time_end": r[5],
                "lat_min": r[6],
                "lat_max": r[7],
                "lon_min_0_360": r[8],
                "lon_max_0_360": r[9],
                "variables": json.loads(r[10]),
            })
        return out

    results: List[dict] = []
    if lon_min_0_360 <= lon_max_0_360:
        results = _one_span(lon_min_0_360, lon_max_0_360)
    else:
        # wrap across 360 -> split into (a..360) and (0..b)
        results = _one_span(lon_min_0_360, 360.0) + _one_span(0.0, lon_max_0_360)

    conn.close()
    return results


# ===================== FastAPI service (moved) =====================
# The FastAPI app has been extracted to a separate module: grib_api.py
# This file intentionally contains no FastAPI code to keep core index/query pure.
# ===================== CLI =====================

def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="Index and query GRIB2 files (0..360 lon, per-variable).")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="Build/refresh the index from a directory")
    b.add_argument("root", help="Directory containing .grb2 files")
    b.add_argument("-d", "--db", default="grib_index.sqlite", help="SQLite DB path")
    b.add_argument("-p", "--pattern", action="append", default=None,
                   help="Glob patterns, default: *.grb2, *.grib2")

    q = sub.add_parser("query", help="Query by time range + bbox + variables")
    q.add_argument("-d", "--db", default="grib_index.sqlite")
    q.add_argument("--start", required=True, help="ISO start (UTC), e.g. 2025-10-02T00:00:00Z")
    q.add_argument("--end", required=True, help="ISO end (UTC)")
    q.add_argument("--lon-min", type=float, required=True, help="0..360; may be > lon-max to wrap")
    q.add_argument("--lon-max", type=float, required=True, help="0..360; may be < lon-min to wrap")
    q.add_argument("--lat-min", type=float, required=True)
    q.add_argument("--lat-max", type=float, required=True)
    q.add_argument("--var", dest="vars", action="append", default=None,
                   help="Variable shortName to require (repeatable). If multiple given, default is ANY; use --all to require ALL.")
    q.add_argument("--all", dest="require_all", action="store_true",
                   help="Require ALL listed variables (default is ANY).")
    q.add_argument("--product", dest="products", action="append", default=None,
                   help="Filter products, e.g. FLXF or OCNF; repeatable")

    args = ap.parse_args()
    if args.cmd == "build":
        pats = tuple(args.pattern) if args.pattern else ("*.grb2", "*.grib2")
        build_index(args.root, args.db, patterns=pats)
    else:
        rows = query(
            db_path=args.db,
            start_iso=args.start,
            end_iso=args.end,
            lon_min_0_360=args.lon_min,
            lon_max_0_360=args.lon_max,
            lat_min=args.lat_min,
            lat_max=args.lat_max,
            vars_any=[v for v in (args.vars or [])],
            require_all=args.require_all,
            products=[p.lower() for p in (args.products or [])] or None,
        )
        print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    _cli()
