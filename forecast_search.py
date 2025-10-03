# forecast_search.py
from __future__ import annotations

from typing import Optional, Tuple

import numpy as np
import pandas as pd
import xarray as xr


# --------- utilities ---------
def _to_utc_naive(ts) -> pd.Timestamp:
    """Return a pandas.Timestamp that is timezone-naive in UTC."""
    if ts is None:
        return None
    t = pd.to_datetime(ts)
    if t.tzinfo is None:
        # assume UTC (GRIB times are UTC) and make it tz-aware UTC
        t = t.tz_localize("UTC")
    else:
        # convert any tz to UTC
        t = t.tz_convert("UTC")
    # return as tz-naive in UTC
    return t.tz_localize(None)


def _coord_to_utc_naive(arr) -> pd.Timestamp:
    """Read a xarray/pandas time-like coord (scalar or 1D) as UTC-naive Timestamp."""
    t = pd.to_datetime(arr.values)
    # t may be numpy.datetime64 (naive); treat as UTC and strip tz
    if isinstance(t, np.ndarray):
        t = t[0] if t.ndim else t
    return _to_utc_naive(t)


def _lon_wrap_to_grid(lon: float, grid_lons: xr.DataArray) -> float:
    """Match user lon to dataset convention (0..360 vs -180..180)."""
    lo, hi = float(grid_lons.min()), float(grid_lons.max())
    if hi > 181:  # grid is [0,360)
        return lon % 360
    else:  # grid is [-180,180]
        return ((lon + 180) % 360) - 180


def _is_regular(coord: xr.DataArray, rtol=1e-6) -> Tuple[bool, float, float]:
    """Return (regular?, start, step) for 1D coordinate."""
    if coord.ndim != 1 or coord.size < 3:
        return False, np.nan, np.nan
    diffs = np.diff(coord.values.astype(float))
    step = np.median(diffs)
    ok = np.allclose(diffs, step, rtol=rtol, atol=0)
    return bool(ok), float(coord.values[0]), float(step)


def _nearest_index_regular(x0: float, start: float, step: float, n: int, descending=False) -> int:
    """Closed-form nearest index for regular axis."""
    if descending:
        # values ~ start, start-step, ...
        idx = int(round((start - x0) / step))
    else:
        idx = int(round((x0 - start) / step))
    return max(0, min(n - 1, idx))


def _nearest_index(coord: xr.DataArray, x0: float) -> int:
    """Nearest index for general monotonic axis."""
    arr = coord.values.astype(float)
    if arr[0] <= arr[-1]:
        i = np.searchsorted(arr, x0)
    else:
        # descending
        i = np.searchsorted(arr[::-1], x0)
        i = len(arr) - i
    if i <= 0:
        return 0
    if i >= len(arr):
        return len(arr) - 1
    # choose closer neighbor
    return i if abs(arr[i] - x0) < abs(arr[i - 1] - x0) else (i - 1)


def _select_timeish(da: xr.DataArray,
                    when: Optional[pd.Timestamp],
                    max_diff: Optional[pd.Timedelta]) -> xr.DataArray:
    """
    Select nearest available time/step, enforcing max_diff if provided.
    Works with time/step as dims or scalar coords. Compares as UTC-naive.
    """
    when_naive = _to_utc_naive(when) if when is not None else None

    # time dimension
    if "time" in da.dims:
        if when_naive is None:
            candidate = da.isel(time=0)
        else:
            # xarray will handle tz-naive comparison; give it naive
            candidate = da.sel(time=when_naive, method="nearest")
        if when_naive is not None and max_diff is not None:
            dt = _coord_to_utc_naive(candidate["time"])
            if abs(dt - when_naive) > max_diff:
                raise ValueError(f"No time within {max_diff} of {when_naive} (nearest is {dt})")
        return candidate

    # step dimension (lead time); treat 'when' as target valid_time if present, else pick index 0
    if "step" in da.dims:
        if when_naive is None or "valid_time" not in da.coords:
            return da.isel(step=0)
        # choose step with nearest valid_time
        vt = pd.to_datetime(da["valid_time"].values)
        vt = pd.DatetimeIndex(vt).tz_localize("UTC").tz_convert("UTC").tz_localize(None)
        # argmin over absolute difference
        idx = int(np.argmin(np.abs(vt - when_naive)))
        candidate = da.isel(step=idx)
        if max_diff is not None and abs(vt[idx] - when_naive) > max_diff:
            raise ValueError(f"No valid_time within {max_diff} of {when_naive} (nearest is {vt[idx]})")
        return candidate

    # scalar coords (analysis slice)
    if when_naive is not None and max_diff is not None:
        # prefer valid_time if present; else fall back to time
        if "valid_time" in da.coords:
            vt = _coord_to_utc_naive(da["valid_time"])
            if abs(vt - when_naive) > max_diff:
                raise ValueError(f"No time within {max_diff} of {when_naive} (valid_time is {vt})")
        elif "time" in da.coords:
            vt = _coord_to_utc_naive(da["time"])
            if abs(vt - when_naive) > max_diff:
                raise ValueError(f"No time within {max_diff} of {when_naive} (time is {vt})")
    return da


def _lon_lat_names(da: xr.DataArray) -> Tuple[str, str]:
    for ln in ("longitude", "lon", "x"):
        if ln in da.coords: lon_name = ln; break
    else:
        raise ValueError("No longitude coordinate found.")
    for lt in ("latitude", "lat", "y"):
        if lt in da.coords: lat_name = lt; break
    else:
        raise ValueError("No latitude coordinate found.")
    return lon_name, lat_name


# --------- main: nearest TOP-k ---------
def search_forecast_data(
        ds: xr.Dataset,
        var: str,
        when: Optional[pd.Timestamp],
        lon: float,
        lat: float,
        k: int = 4,
        max_time_diff: Optional[pd.Timedelta] = None,
        return_mode: str = "xarray",  # <- default changed
):
    """
    Return the k nearest grid points for `var` around (lon,lat) at `when`.

    return_mode:
      - "xarray": 1-D DataArray with dim 'point' and coords: lon, lat, i, j, distance_deg (+ scalar time coords)
      - "records": list of dicts (indices, lon/lat, distance_deg, value)
      - "values": list of floats
    """
    da = ds[var]
    da = _select_timeish(da, when, max_time_diff)

    lon_name, lat_name = _lon_lat_names(da)
    lon_grid = da[lon_name]
    lat_grid = da[lat_name]
    lon_wrapped = _lon_wrap_to_grid(float(lon), lon_grid)
    lat0 = float(lat)

    lon_reg, lon_start, dlon = _is_regular(lon_grid)
    lat_reg, lat_start, dlat = _is_regular(lat_grid)

    if lon_reg:
        j0 = _nearest_index_regular(lon_wrapped, lon_start, dlon, lon_grid.size, descending=False)
    else:
        j0 = _nearest_index(lon_grid, lon_wrapped)

    lat_desc = bool(lat_grid.values[0] > lat_grid.values[-1])
    if lat_reg:
        i0 = _nearest_index_regular(lat0, lat_start, abs(dlat), lat_grid.size, descending=lat_desc)
    else:
        i0 = _nearest_index(lat_grid, lat0)

    nlat, nlon = lat_grid.size, lon_grid.size
    hits = []
    visited = set()
    r = 0
    while len(hits) < k and r < max(nlat, nlon):
        imin, imax = max(0, i0 - r), min(nlat - 1, i0 + r)
        # left/right columns of the ring
        for i in range(imin, imax + 1):
            for j in ((j0 - r) % nlon, (j0 + r) % nlon):
                key = (i, j)
                if key in visited:
                    continue
                visited.add(key)
                glon = float(lon_grid[j])
                glat = float(lat_grid[i])
                dist = abs(glon - lon_wrapped) + abs(glat - lat0)
                val = float(da.isel({lat_name: i, lon_name: j}).values)
                hits.append((dist, i, j, glon, glat, val))
        # top/bottom rows of the ring (excluding corners we already did)
        for j in range((j0 - r + 1) % nlon, (j0 + r) % nlon):
            for i in (i0 - r, i0 + r):
                if 0 <= i < nlat:
                    jj = j % nlon
                    key = (i, jj)
                    if key in visited:
                        continue
                    visited.add(key)
                    glon = float(lon_grid[jj])
                    glat = float(lat_grid[i])
                    dist = abs(glon - lon_wrapped) + abs(glat - lat0)
                    val = float(da.isel({lat_name: i, lon_name: jj}).values)
                    hits.append((dist, i, jj, glon, glat, val))
        r += 1

    hits.sort(key=lambda t: t[0])
    hits = hits[:k]

    if return_mode == "values":
        return [h[5] for h in hits]

    if return_mode == "records":
        return [
            {"distance_deg": h[0], "i": int(h[1]), "j": int(h[2]),
             "lon": h[3], "lat": h[4], "value": h[5]}
            for h in hits
        ]

    # return_mode == "xarray"
    import numpy as np
    pts = np.arange(len(hits))
    vals = np.array([h[5] for h in hits], dtype=da.dtype)
    out = xr.DataArray(
        data=vals,
        dims=("point",),
        coords=dict(
            point=pts,
            lon=("point", [h[3] for h in hits]),
            lat=("point", [h[4] for h in hits]),
            i=("point", [int(h[1]) for h in hits]),
            j=("point", [int(h[2]) for h in hits]),
            distance_deg=("point", [h[0] for h in hits]),
        ),
        name=da.name,
        attrs=da.attrs,  # keep units, long_name, etc.
    )
    # copy scalar time-ish coords for context
    for cname in ("time", "valid_time", "step"):
        if cname in da.coords and da[cname].ndim == 0:
            out = out.assign_coords({cname: da[cname]})
    return out
