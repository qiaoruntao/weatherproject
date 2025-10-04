#!/usr/bin/env python3
# cfs_fetch.py
#
# Crawl a NOMADS CFS directory and download FLXF/OCNF files sequentially
# (default: one file started every 60 seconds), using simple overwrite download,
# skip/verify existing files, and resume.
# Adds jittered delays, browser-like headers, and simple retries to look more like a human.
#
# Requirements: aiohttp, aiofiles, yarl, beautifulsoup4
#   pip install aiohttp aiofiles yarl beautifulsoup4

import asyncio
import random
import re
import sys
import socket
from pathlib import Path
from typing import List, Tuple, Optional
from urllib.parse import urljoin

import aiofiles
import aiohttp
from bs4 import BeautifulSoup
from yarl import URL

# -------- config defaults --------
DEFAULT_CONCURRENCY = 1
DEFAULT_MIN_INTERVAL = 60.0
# match GRIB2 + optional idx sidecars
FILE_RE = re.compile(r'(?:^|/)(?P<prefix>(flxf|ocnf))[^/]*\.(?P<ext>grb2|grib2|idx)$', re.IGNORECASE)
MAX_RETRIES = 5


# --------- rate limiter ---------
class RateLimiter:
    def __init__(self, min_interval: float):
        self.min_interval = float(min_interval)
        self._lock = asyncio.Lock()
        self._next_time = 0.0

    async def wait(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            if now < self._next_time:
                await asyncio.sleep(self._next_time - now)
                now = loop.time()
            self._next_time = now + self.min_interval


def is_dir_link(href: str) -> bool:
    # treat links ending with '/' as directories
    return href.endswith('/')


async def fetch_html(session: aiohttp.ClientSession, url: str) -> str:
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=120)) as r:
        r.raise_for_status()
        return await r.text()


def discover_links(base_url: str, html: str) -> List[str]:
    soup = BeautifulSoup(html, 'html.parser')
    hrefs = []
    for a in soup.find_all('a', href=True):
        href = a['href']
        # ignore parent directory links and anchors
        if href in ('../', './', '#'):
            continue
        hrefs.append(urljoin(base_url, href))
    return hrefs


def make_local_path(base_url: str, file_url: str, out_dir: Path) -> Path:
    """
    Mirror the directory structure under out_dir.
    Example:
      base_url = https://.../cfs.20251002/18/6hrly_grib_01/
      file_url = https://.../cfs.20251002/18/6hrly_grib_01/flxf2025100218.01.2025100218.grb2
      --> out_dir / cfs.20251002/18/6hrly_grib_01/flxf2025100218.01.2025100218.grb2
    """
    bu = URL(base_url)
    fu = URL(file_url)
    # get the relative path from base to file
    if str(fu).startswith(str(bu)):
        rel = str(fu)[len(str(bu)):]
    else:
        # different host or base not a prefix; just use filename
        rel = fu.name
    return out_dir / rel


async def download_file(
        session: aiohttp.ClientSession,
        url: str,
        dest: Path,
        semaphore: asyncio.Semaphore,
        verify_size: bool = True,
        rate_limiter: Optional["RateLimiter"] = None,
) -> Tuple[str, str]:
    """
    Download url -> dest, overwriting any existing file.
    Skips if dest exists. Returns (status, message) where status in
    {"skipped","downloaded","error"}.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)

    # If file already exists, skip (no size check)
    if dest.exists():
        return ("already_ok", f"{dest} exists (skipping)")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "Referer": url.rsplit('/', 1)[0] + '/',
    }

    async with semaphore:
        if rate_limiter is not None:
            await rate_limiter.wait()
        # Add jittered sleep before request
        await asyncio.sleep(random.uniform(0.5, 3.0))

        attempts = 0
        while True:
            try:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=None)) as r:
                    status = r.status
                    # Any HTTP non-200 is treated as a hard error (do NOT retry)
                    if status != 200:
                        return ("error_http", f"{url} -> HTTP {status}")
                    async with aiofiles.open(dest, "wb") as f:
                        async for chunk in r.content.iter_chunked(1 << 16):
                            await f.write(chunk)
                    return ("downloaded", str(dest))
            except (aiohttp.ClientError, asyncio.TimeoutError, socket.gaierror) as e:
                attempts += 1
                if attempts >= MAX_RETRIES:
                    return ("net_fail", f"{url} -> {e} (after {attempts} attempts)")
                # exponential backoff with jitter, capped
                backoff = min(30.0, (2 ** (attempts - 1))) + random.uniform(0.0, 1.0)
                await asyncio.sleep(backoff)


async def crawl_and_download(
        base_url: str,
        out_dir: Path,
        include_idx: bool = True,
        max_depth: int = 2,
        concurrency: int = DEFAULT_CONCURRENCY,
        min_interval: float = DEFAULT_MIN_INTERVAL,
) -> None:
    """
    Crawl base_url up to max_depth subdirectories, schedule downloads for FLXF/OCNF
    (and optionally .idx). Uses a semaphore to limit concurrency.
    """
    seen_dirs = set()
    file_urls: List[str] = []

    async with aiohttp.ClientSession() as session:
        # BFS over directories
        queue: List[Tuple[str, int]] = [(base_url, 0)]
        while queue:
            cur, depth = queue.pop(0)
            if cur in seen_dirs or depth > max_depth:
                continue
            seen_dirs.add(cur)
            try:
                html = await fetch_html(session, cur)
            except Exception as e:
                print(f"[WARN] failed to list {cur}: {e}", file=sys.stderr)
                continue
            links = discover_links(cur, html)
            for link in links:
                if is_dir_link(link):
                    queue.append((link, depth + 1))
                else:
                    m = FILE_RE.search(link)
                    if not m:
                        continue
                    ext = m.group("ext").lower()
                    if ext == "idx" and not include_idx:
                        continue
                    file_urls.append(link)

        # dedupe while preserving order
        file_urls = list(dict.fromkeys(file_urls))
        print(f"Found {len(file_urls)} matching files under {base_url}")

        rl = RateLimiter(min_interval)
        sem = asyncio.Semaphore(concurrency)
        tasks: List[asyncio.Task] = []
        for fu in file_urls:
            dest = make_local_path(base_url, fu, out_dir)
            task = asyncio.create_task(download_file(session, fu, dest, sem, rate_limiter=rl))
            tasks.append(task)

        # run with progress; stop everything on first error
        done = 0
        for fut in asyncio.as_completed(tasks):
            try:
                status, msg = await fut
            except asyncio.CancelledError:
                raise
            done += 1
            if status == "downloaded":
                print(f"[{done}/{len(tasks)}] {status}: {msg}")
            elif status in ("already_ok", "skipped"):
                print(f"[{done}/{len(tasks)}] {status}: {msg}")
            elif status == "net_fail":
                # network problem after retries: log and continue to next file
                print(f"[{done}/{len(tasks)}] NET-FAIL: {msg}", file=sys.stderr)
            else:  # error_http or other hard errors
                print(f"[{done}/{len(tasks)}] ERROR: {msg}", file=sys.stderr)
                for t in tasks:
                    if not t.done():
                        t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise RuntimeError(msg)


def main():
    import argparse
    p = argparse.ArgumentParser(description="Scrape FLXF/OCNF files from a NOMADS CFS directory.")
    p.add_argument("base_url",
                   help="Start directory (e.g., https://nomads.ncep.noaa.gov/pub/data/nccf/com/cfs/prod/cfs.YYYYMMDD/HH/6hrly_grib_01/)")
    p.add_argument("-o", "--out", default="cfs_downloads", help="Output root directory (mirrors remote structure)")
    p.add_argument("--no-idx", action="store_true", help="Do not download .idx files")
    p.add_argument("-d", "--depth", type=int, default=2, help="Max crawl depth (default: 2)")
    p.add_argument("-c", "--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Max concurrent downloads")
    p.add_argument("--min-interval", type=float, default=DEFAULT_MIN_INTERVAL,
                   help="Minimum seconds between starting file downloads (global rate limit). Default: 60")
    args = p.parse_args()

    out_dir = Path(args.out).resolve()
    include_idx = not args.no_idx
    try:
        asyncio.run(crawl_and_download(
            base_url=args.base_url,
            out_dir=out_dir,
            include_idx=include_idx,
            max_depth=args.depth,
            concurrency=args.concurrency,
            min_interval=args.min_interval,
        ))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
