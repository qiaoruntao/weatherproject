from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional
from eccodes import (  # type: ignore
    codes_grib_new_from_file,
    codes_get, codes_get_long, codes_get_double,
    codes_release,
)


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


def _get_int_or_none(h, key: str) -> Optional[int]:
    try:
        return int(codes_get(h, key))
    except Exception:
        return None


def _get_str_or_none(h, key: str) -> Optional[str]:
    try:
        v = codes_get(h, key)
        if v is None:
            return None
        return str(v)
    except Exception:
        return None


def _compute_times_from_message(h) -> tuple[datetime, datetime, int]:
    """
    Return (ref_time_utc, forecast_time_utc, lead_hours).
    """
    dataDate = _get_int_or_none(h, "dataDate")  # e.g., 20251003
    dataTime = _get_int_or_none(h, "dataTime")  # e.g., 1200 or 12
    if dataDate is None or dataTime is None:
        raise ValueError("Missing reference time (dataDate/dataTime) in GRIB message")

    HH = dataTime // 100 if dataTime >= 100 else dataTime
    ref = datetime.strptime(f"{dataDate:08d}{HH:02d}", "%Y%m%d%H").replace(tzinfo=timezone.utc)

    lead_hours = _get_int_or_none(h, "forecastTime")
    if lead_hours is None:
        raise ValueError("Unable to determine forecast lead time (hours)")
    forecast = ref + timedelta(hours=lead_hours)
    return ref, forecast, int(lead_hours)


GRIB_INDEX_SQLITE = "grib_index.sqlite"
