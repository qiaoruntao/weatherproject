# inspect_grib.py
from __future__ import annotations
import math
from typing import List
import numpy as np
import xarray as xr


def _fmt_range(a):
    try:
        vmin = float(np.nanmin(a.values))
        vmax = float(np.nanmax(a.values))
        return f"[{vmin:.6g}, {vmax:.6g}]"
    except Exception:
        return "n/a"


def _dtype_nbytes(dtype: np.dtype) -> int:
    try:
        return np.dtype(dtype).itemsize
    except Exception:
        return 0


def _approx_dataset_bytes(ds: xr.Dataset) -> int:
    # Sum over variables: number of elements * bytes per element (no compute)
    total = 0
    for v in ds.data_vars.values():
        n = math.prod(int(s) for s in v.shape) if v.shape else 0
        total += n * _dtype_nbytes(v.dtype)
    return total


def _print_dataset_summary(ds: xr.Dataset, title: str):
    print(f"\n=== {title} ===")
    # High-level attrs
    attrs = ds.attrs or {}
    grid = attrs.get("gridType", attrs.get("GRIB_gridType", ""))
    centre = attrs.get("centre", attrs.get("GRIB_centre", ""))
    tlv = attrs.get("typeOfLevel", "")
    lvl = attrs.get("level", "")
    hist = attrs.get("history", "")
    print(f"gridType: {grid} | centre: {centre} | typeOfLevel: {tlv} | level: {lvl}")
    if hist:
        print(f"history: {hist.splitlines()[0]}")

    # Dimensions
    print("\nDims:")
    for k, v in ds.sizes.items():
        print(f"  - {k}: {v}")

    # Coordinates
    print("\nCoords:")
    for name, c in ds.coords.items():
        extra = []
        if np.issubdtype(c.dtype, np.number):
            extra.append(f"range={_fmt_range(c)}")
        if hasattr(c, "chunks") and c.chunks:
            extra.append(f"chunks={tuple(len(ch) for ch in c.chunks[0:1])}")
        units = c.attrs.get("units")
        if units:
            extra.append(f"units={units}")
        print(f"  - {name}: shape={tuple(c.shape)} dtype={c.dtype} " + (" | " if extra else "") + ", ".join(extra))

    # Variables
    print("\nData variables:")
    for name, da in ds.data_vars.items():
        info = [f"shape={tuple(da.shape)}", f"dtype={da.dtype}"]
        if hasattr(da, "chunks") and da.chunks:
            # show chunk sizes per dimension (first chunk lengths)
            ch = []
            for chs in da.chunks:
                ch.append(len(chs) if isinstance(chs, tuple) else chs)
            info.append(f"chunks={[tuple(x for x in da.chunks)]}")
        units = da.attrs.get("units")
        long_name = da.attrs.get("long_name") or da.attrs.get("name")
        if long_name:
            info.append(f"long_name={long_name}")
        if units:
            info.append(f"units={units}")
        print(f"  - {name}: " + ", ".join(info))

    # Lon/Lat quick summary if present
    for lon_name in ["longitude", "lon", "x"]:
        if lon_name in ds.coords:
            print(f"\n{lon_name} range: {_fmt_range(ds.coords[lon_name])}")
            break
    for lat_name in ["latitude", "lat", "y"]:
        if lat_name in ds.coords:
            print(f"{lat_name} range: {_fmt_range(ds.coords[lat_name])}")
            break

    # Time-ish
    for tname in ["time", "valid_time", "forecast_reference_time", "step"]:
        if tname in ds.coords or tname in ds.dims:
            arr = ds.coords.get(tname, ds[tname])
            n = arr.shape[0] if arr.shape else 1
            print(f"{tname}: count={n}")

    # Approx size
    approx = _approx_dataset_bytes(ds)
    if approx:
        print(f"\nApprox data size (uncompressed): {approx / 1e6:.2f} MB")


def inspect_grib(path: str):
    """
    Print metadata, dims, coords, variables and approximate size for each cfgrib group.
    Works whether the file is single-group or multi-group.
    """
    print(f"File: {path}")
    # Try opening as a single dataset; if it fails due to multiple groups, open all groups.
    dsets: List[xr.Dataset] = []
    try:
        ds = xr.open_dataset(path, engine="cfgrib")
        dsets = [ds]
    except Exception:
        # Fallback: open all groups discovered by cfgrib
        from cfgrib import open_datasets as cfgrib_open_datasets
        dsets = cfgrib_open_datasets(path)  # returns a list

    for i, ds in enumerate(dsets, 1):
        title = f"GROUP {i}/{len(dsets)}"
        _print_dataset_summary(ds, title)
