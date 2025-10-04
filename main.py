import xarray as xr
import pandas as pd

# Open dataset (load all variables)
ds = xr.open_dataset(
    "data/cfs/flxf2025100218.01.2025100218.grb2",
    engine="cfgrib",
)

# Collect variable summaries
records = []
for var in ds.data_vars:
    attrs = ds[var].attrs
    record = {"Variable": var}
    record.update(attrs)
    records.append(record)

# Convert to DataFrame for nice display
df = pd.DataFrame.from_records(records)
pd.set_option("display.max_columns", None)
pd.set_option("display.width", 2000)
print(df)
