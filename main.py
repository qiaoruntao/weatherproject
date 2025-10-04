import xarray as xr
import pandas as pd

# Open dataset (adjust filters as needed)
ds = xr.open_dataset(
    "data/cfs/flxf2025100218.01.2025100218.grb2",
    engine="cfgrib",
    backend_kwargs={"filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 2}},
)

# Collect variable summaries
records = []
for var in ds.data_vars:
    attrs = ds[var].attrs
    records.append({
        "Variable": var,
        "Short Name": attrs.get("GRIB_shortName", ""),
        "Description": attrs.get("GRIB_name", ""),
        "Units": attrs.get("units", "")
    })

# Convert to DataFrame for nice display
df = pd.DataFrame(records)
print(df.to_string(index=False))
