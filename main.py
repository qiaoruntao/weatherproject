import pandas as pd
import xarray as xr

from forecast_search import search_forecast_data

# 1) open the group you care about (example: 2 m temp forecasts)
ds_2m = xr.open_dataset(
    "flxf2025100218.01.2025100218.grb2",
    engine="cfgrib",
    backend_kwargs={"filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 2}},
)

# 2) find nearest 4 grid cells to Toronto at (analysis) time
when = pd.Timestamp("2025-10-02T18:00:00Z")  # or None for analysis slice
hits = search_forecast_data(
    ds_2m, var="t2m",
    when=pd.Timestamp("2025-10-02T18:00:00Z"),
    lon=-79.38, lat=43.65, k=4,
    max_time_diff=pd.Timedelta("6h")
)

for h in hits:
    print(h)
# [{'i':..., 'j':..., 'lon':..., 'lat':..., 'distance_deg':..., 'value':...}, ...]

# 3) same idea for 10 m winds
ds_10m = xr.open_dataset(
    "flxf2025100218.01.2025100218.grb2",
    engine="cfgrib",
    backend_kwargs={"filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 10}},
)
hits_u = search_forecast_data(ds_10m, "u10", when, -79.38, 43.65, k=4)
hits_v = search_forecast_data(ds_10m, "v10", when, -79.38, 43.65, k=4)
