import cfgrib
import pandas as pd

datasets = cfgrib.open_datasets("data/cfs/flxf2025110500.01.2025100312.grb2")
# Open dataset (load all variables)
# ds = xr.open_dataset(
#     "data/cfs/flxf2025100218.01.2025100218.grb2",
#     engine="cfgrib",
# )

# Collect variable summaries
records = []
for ds in datasets:
    for var in ds.data_vars:
        attrs = ds[var].attrs
        if var in ["v10"]:
            print(ds[var].values.shape)
        record = {"Variable": var}
        record.update(attrs)
        records.append(record)

# Convert to DataFrame for nice display
df = pd.DataFrame.from_records(records)
pd.set_option("display.max_columns", None)
pd.set_option("display.width", 2000)
df.to_excel('definitions.xlsx', index=False)
print(df)
