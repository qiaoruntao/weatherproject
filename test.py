from grib_index import query_data

rows = query_data(
    db_path="grib_index.sqlite",
    start_iso="2025-10-04T00:00:00Z",
    end_iso="2025-10-04T01:00:00Z",
    lon_min_0_360=-79.3, lon_max_0_360=-79.4,
    lat_min=43.6, lat_max=43.7,
    vars_any=["t2m", "prate"],  # optional
    require_all=False,  # optional
    products=["flxf", "ocnf"],  # optional
    indexpath="",  # no .idx sidecars
)

for r in rows[:5]:
    print(r)
