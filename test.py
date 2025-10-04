from grib_index import query_data

rows = query_data(
    start_iso="2025-11-05T00:00:00",
    end_iso="2025-11-05T01:00:00",
    lon_min_0_360=80, lon_max_0_360=81,
    lat_min=80, lat_max=81,
    vars_any=["t2m", "prate"],  # optional
    products=["flxf", "ocnf"],  # optional
)

for r in rows[:5]:
    print(r)
