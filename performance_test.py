import json
import logging
import os
import random
import time
from statistics import mean
from typing import Optional, Tuple, List

from tqdm import tqdm

from grib_index import query_data

# -------------------- Config --------------------
START_ISO = "2025-10-05T00:00:00"
END_ISO = "2025-10-05T01:00:00"
VARS_ANY = ["t2m", "prate"]  # keep small for speed
REQUIRE_ALL = False
PRODUCTS = ["flxf", "ocnf"]

# Full scan of all integer lon/lat pairs is ~64,800 queries (lon 0-359 × lat -90-89).
# Set SAMPLE_N to an integer to only test a random sample of that many points.
# Set to None to scan ALL.
SAMPLE_N: Optional[int] = 500  # change to None for full coverage
RANDOM_SEED = 42

# Progress reporting
REPORT_EVERY = 50  # emit progress every N queries
REPORT_EVERY_SECONDS = 2.0  # or at least every S seconds

# TDMQ (Pulsar-compatible) realtime publishing
# Set these env vars to enable publishing:
#   TDMQ_SERVICE_URL  e.g. pulsar+ssl://pulsar.tencenttdmq.com:6651
#   TDMQ_TOKEN        e.g. eyJhbGciOiJ... (token string)
#   TDMQ_TOPIC        e.g. persistent://public/default/weather-metrics
TDMQ_SERVICE_URL = os.getenv("TDMQ_SERVICE_URL")
TDMQ_TOKEN = os.getenv("TDMQ_TOKEN")
TDMQ_TOPIC = os.getenv("TDMQ_TOPIC", "persistent://public/default/query-metrics")

# ------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


# -------- Pulsar/TDMQ optional client ---------
class _TDMQPublisher:
    def __init__(self, service_url: Optional[str], token: Optional[str], topic: str):
        self.enabled = False
        self.client = None
        self.producer = None
        if not service_url or not topic:
            return
        try:
            import pulsar  # type: ignore
            auth = None
            if token:
                auth = pulsar.AuthenticationToken(token)
            self.client = pulsar.Client(service_url, authentication=auth, operation_timeout_seconds=5)
            self.producer = self.client.create_producer(topic, batching_enabled=True)
            self.enabled = True
            logging.info("TDMQ publisher enabled: %s -> %s", service_url, topic)
        except Exception as e:
            logging.warning("TDMQ disabled (pulsar not available or failed to connect): %s", e)
            self.enabled = False

    def send(self, payload: dict):
        if not self.enabled or self.producer is None:
            return
        try:
            self.producer.send(json.dumps(payload).encode("utf-8"))
        except Exception as e:
            logging.warning("TDMQ publish failed: %s", e)

    def close(self):
        try:
            if self.producer:
                self.producer.flush()
            if self.client:
                self.client.close()
        except Exception:
            pass


publisher = _TDMQPublisher(TDMQ_SERVICE_URL, TDMQ_TOKEN, TDMQ_TOPIC)


# --------------- Helpers ------------------
def iter_cells(sample_n: Optional[int]):
    """Yield (lon, lat) integer pairs. lon in [0, 359], lat in [-90, 89]."""
    lons = list(range(0, 360))
    lats = list(range(-90, 90))  # last is 89 so lat+1 <= 90
    if sample_n is None:
        for lon in lons:
            for lat in lats:
                yield lon, lat
    else:
        rng = random.Random(RANDOM_SEED)
        all_pairs = [(lon, lat) for lon in lons for lat in lats]
        sample_n = min(sample_n, len(all_pairs))
        for lon, lat in rng.sample(all_pairs, sample_n):
            yield lon, lat


def compute_latency_stats(times_ms: List[float]) -> Tuple[float, float, float, float, float]:
    if not times_ms:
        return (0.0, 0.0, 0.0, 0.0, 0.0)
    ts = sorted(times_ms)
    avg_ms = mean(ts)

    def pct(p: float) -> float:
        idx = int(p * (len(ts) - 1))
        return ts[idx]

    return (avg_ms, pct(0.50), pct(0.90), pct(0.95), pct(0.99))


# --------------- Main test ------------------
def test_query_grid():
    total = ok = empty = fail = 0
    times: List[float] = []
    examples = []  # store a few successes
    last_report_ts = time.time()

    # Progress bar (tqdm)
    planned_total = 360 * 180 if SAMPLE_N is None else SAMPLE_N
    pbar = tqdm(total=planned_total, desc="query_data scan", unit="cell")

    for i, (lon, lat) in enumerate(iter_cells(SAMPLE_N), start=1):
        lon_min = float(lon)
        lon_max = float(lon + 1)
        lat_min = float(lat)
        lat_max = float(lat + 1)

        t0 = time.perf_counter()
        status = ""
        nrows = -1
        try:
            rows = query_data(
                start_iso=START_ISO,
                end_iso=END_ISO,
                lon_min_0_360=lon_min,
                lon_max_0_360=lon_max,
                lat_min=lat_min,
                lat_max=lat_max,
                vars_any=VARS_ANY,
                require_all=REQUIRE_ALL,
                products=PRODUCTS,
            )
            elapsed = (time.perf_counter() - t0) * 1000.0
            times.append(elapsed)
            nrows = len(rows)
            if nrows > 0:
                ok += 1
                status = "OK"
                if len(examples) < 5:
                    examples.append({
                        "lon": lon,
                        "lat": lat,
                        "ms": round(elapsed, 2),
                        "rows": rows[:2],  # keep small
                    })
            else:
                empty += 1
                status = "EMPTY"
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000.0
            times.append(elapsed)
            fail += 1
            status = f"FAIL: {e.__class__.__name__}: {e}"
        finally:
            total += 1
            # logging.info(
            #     "query lon=[%s,%s] lat=[%s,%s] -> %s (%.2f ms, rows=%s)",
            #     lon_min, lon_max, lat_min, lat_max, status, elapsed, nrows if nrows >= 0 else "-",
            # )
            # tqdm progress + live avg latency
            avg_ms, p50_, p90_, p95_, p99_ = compute_latency_stats(times)
            pbar.update(1)
            pbar.set_postfix({
                "avg_ms": round(avg_ms, 2),
                "ok": ok,
                "empty": empty,
                "fail": fail,
            })

        # Periodic progress (console + TDMQ)
        now = time.time()
        if (i % REPORT_EVERY == 0) or (now - last_report_ts >= REPORT_EVERY_SECONDS):
            avg_ms, p50, p90, p95, p99 = compute_latency_stats(times)
            payload = {
                "ts": int(now * 1000),
                "window": {"start": START_ISO, "end": END_ISO},
                "vars_any": VARS_ANY,
                "require_all": REQUIRE_ALL,
                "products": PRODUCTS,
                "tested": total,
                "ok": ok,
                "empty": empty,
                "fail": fail,
                "latency_ms": {
                    "avg": round(avg_ms, 2),
                    "p50": round(p50, 2),
                    "p90": round(p90, 2),
                    "p95": round(p95, 2),
                    "p99": round(p99, 2),
                },
                "last_cell": {
                    "lon": lon,
                    "lat": lat,
                    "bbox": [lon_min, lon_max, lat_min, lat_max],
                    "last_ms": round(elapsed, 2),
                    "status": status,
                    "rows": nrows,
                },
            }
            logging.info(
                "PROGRESS tested=%s ok=%s empty=%s fail=%s avg=%.2fms p50=%.2f p90=%.2f p95=%.2f p99=%.2f",
                total, ok, empty, fail, payload["latency_ms"]["avg"], p50, p90, p95, p99,
            )
            publisher.send(payload)
            # keep tqdm in sync as well
            pbar.set_postfix({
                "avg_ms": round(avg_ms, 2),
                "ok": ok,
                "empty": empty,
                "fail": fail,
            })
            last_report_ts = now

    pbar.close()

    # Final summary
    print("\n===== QUERY SUMMARY =====")
    print(f"window: {START_ISO} -> {END_ISO}")
    print(f"vars_any={VARS_ANY} require_all={REQUIRE_ALL} products={PRODUCTS}")
    print(f"tested cells: {total}")
    print(f"success (rows>0): {ok}")
    print(f"empty: {empty}")
    print(f"fail: {fail}")
    avg_ms, p50, p90, p95, p99 = compute_latency_stats(times)
    print(
        "latency ms: avg=%.2f p50=%.2f p90=%.2f p95=%.2f p99=%.2f"
        % (avg_ms, p50, p90, p95, p99)
    )

    if examples:
        print("\nExample successes (up to 5):")
        for ex in examples:
            print(
                f"  lon={ex['lon']} lat={ex['lat']} took={ex['ms']} ms rows={len(ex['rows'])}\n    sample={ex['rows']}"
            )

    # Send one last summary to TDMQ
    publisher.send({
        "ts": int(time.time() * 1000),
        "type": "final",
        "tested": total,
        "ok": ok,
        "empty": empty,
        "fail": fail,
        "latency_ms": {
            "avg": round(avg_ms, 2),
            "p50": round(p50, 2),
            "p90": round(p90, 2),
            "p95": round(p95, 2),
            "p99": round(p99, 2),
        },
    })
    publisher.close()


if __name__ == "__main__":
    test_query_grid()
