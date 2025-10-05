#!/usr/bin/env python3
"""
FastAPI wrapper for the GRIB index query.

Run:
  export GRIB_API_USER='myuser'
  export GRIB_API_PASS='mypassword'
  uvicorn grib_api:app --host 0.0.0.0 --port 8000
"""

import logging
import os
import sys

from starlette.middleware.cors import CORSMiddleware

from query_file_index import query_func

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
# Fail fast with a clear log if FastAPI stack is missing
try:
    from fastapi import FastAPI, Depends, HTTPException
    from fastapi.security import HTTPBasic, HTTPBasicCredentials
    from starlette.status import HTTP_401_UNAUTHORIZED
    from pydantic import BaseModel, Field, validator
    import secrets
except Exception as e:
    logging.error("FastAPI stack not available: %s", e)
    sys.exit(2)

from typing import Optional


class QueryPayload(BaseModel):
    start_iso: str = Field(..., description="Start time ISO, e.g. 2025-10-02T00:00:00Z")
    end_iso: str = Field(..., description="End time ISO")
    lon_min_0_360: float = Field(..., description="Longitude min in [0,360]")
    lon_max_0_360: float = Field(..., description="Longitude max in [0,360] (can be less than min to wrap)")
    lat_min: float
    lat_max: float
    level: str
    variable: str


class DataQueryPayload(QueryPayload):
    indexpath: Optional[str] = Field(
        default="",
        description="cfgrib index path. Empty string disables sidecar .idx files."
    )


app = FastAPI(title="GRIB Index API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/api/query-data")
def api_query_data(payload: DataQueryPayload):
    print(payload)
    rows = query_func(payload.start_iso, payload.end_iso, payload.level, payload.variable,
                      (payload.lat_min, payload.lon_min_0_360, payload.lat_max, payload.lon_max_0_360))
    return {"count": len(rows), "results": rows}


# Main entrypoint for running FastAPI via uvicorn programmatically.
def main():
    """
    Launch the FastAPI server via uvicorn programmatically.

    Examples:
      python grib_api.py
      python grib_api.py --host 0.0.0.0 --port 8000 --reload
    """
    import argparse
    import logging

    parser = argparse.ArgumentParser(description="Run GRIB Index FastAPI server")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"), help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")), help="Bind port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Enable autoreload (dev only)")
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "info"), help="Logging level for uvicorn")
    parser.add_argument("--workers", type=int, default=int(os.getenv("WORKERS", "1")),
                        help="Number of worker processes")
    parser.add_argument("--proxy-headers", action="store_true",
                        help="Use X-Forwarded-For and X-Forwarded-Proto headers")

    args = parser.parse_args()

    # Check uvicorn availability and fail fast with a clear message.
    try:
        import uvicorn  # type: ignore
    except Exception as e:
        logging.error("uvicorn is required to run the API via `python grib_api.py`: %s", e)
        sys.exit(2)

    # Workers and reload are mutually exclusive in uvicorn; prefer reload if explicitly set.
    workers = 1 if args.reload else max(1, args.workers)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        reload=args.reload,
        workers=workers,
        proxy_headers=args.proxy_headers,
    )


if __name__ == "__main__":
    main()
