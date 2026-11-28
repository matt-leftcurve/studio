"""Live graphics: real market data only. Every series carries its source and as-of time.

Crypto: Binance public market-data mirror (data-api.binance.vision; api.binance.com is
geo-blocked from the US, 451), falling back to Coinbase Exchange public candles.
Everything else: Yahoo Finance chart API, falling back to Stooq daily CSV.
No keys, no accounts. A failed fetch raises; the caller drops the card rather than invent data.
"""
from __future__ import annotations

import asyncio
import csv
import datetime as dt
import io
import time

import aiohttp

UA = {"User-Agent": "Mozilla/5.0 (longshortmatt live-graphics)"}
TIMEOUT = aiohttp.ClientTimeout(total=6)


class DataError(Exception):
    pass


def pick_interval(days: float) -> tuple[str, str, str]:
    """(binance interval, yahoo interval, coinbase granularity seconds)"""
    if days <= 2:
        return "15m", "15m", "900"
    if days <= 12:
        return "1h", "60m", "3600"
    if days <= 60:
        return "4h", "60m", "21600"
    if days <= 900:
        return "1d", "1d", "86400"
    return "1w", "1wk", "86400"


class Market:
    def __init__(self, session: aiohttp.ClientSession | None = None, ttl: float = 60.0):
        self._session = session
        self.ttl = ttl
        self._cache: dict[tuple, tuple[float, dict]] = {}
        self._inflight: dict[tuple, asyncio.Future] = {}

    async def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(headers=UA, timeout=TIMEOUT)
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def series(self, asset: dict, start: dt.datetime, days: float) -> dict:
        """{'points': [[ms, close], ...], 'source': str, 'asof': ms, 'symbol': str}"""
        # cache key buckets start to the minute so repeated phrases share one fetch
        key = (asset["key"], int(start.timestamp() // 60), pick_interval(days)[0])
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < self.ttl:
            return hit[1]
        if key in self._inflight:
            return await self._inflight[key]
        fut = asyncio.get_event_loop().create_future()
        self._inflight[key] = fut
        try:
            if asset["kind"] == "crypto":
                res = await self._first_ok([self._binance, self._coinbase], asset, start, days)
            else:
                res = await self._first_ok([self._yahoo, self._stooq], asset, start, days)
            if len(res["points"]) < 2:
                raise DataError(f"{asset['key']}: too few points")
            self._cache[key] = (time.time(), res)
            fut.set_result(res)
            return res
        except Exception as e:
            fut.set_exception(e)
            fut.exception()  # mark retrieved
            raise
        finally:
            self._inflight.pop(key, None)

    async def _first_ok(self, fns, asset, start, days):
        errs = []
        for fn in fns:
            try:
                return await fn(asset, start, days)
            except Exception as e:  # noqa: BLE001 — try the next provider
                errs.append(f"{fn.__name__}: {e!r}")
        raise DataError("; ".join(errs))

    async def _get_json(self, url, params=None):
        s = await self.session()
        async with s.get(url, params=params) as r:
            if r.status != 200:
                raise DataError(f"HTTP {r.status} {url}")
            return await r.json(content_type=None)

    async def _binance(self, asset, start, days):
        iv = pick_interval(days)[0]
        params = {"symbol": asset["sym"] + "USDT", "interval": iv, "startTime": int(start.timestamp() * 1000), "limit": 1000}
        rows = await self._get_json("https://data-api.binance.vision/api/v3/klines", params)
        pts = [[int(r[0]), float(r[4])] for r in rows]
        # last kline's close is the live price
        return {"points": pts, "source": "Binance", "asof": int(time.time() * 1000), "symbol": asset["sym"] + "/USDT"}

    async def _coinbase(self, asset, start, days):
        gran = int(pick_interval(days)[2])
        end = dt.datetime.now(dt.timezone.utc)
        st = max(start, end - dt.timedelta(seconds=gran * 299))
        rows = await self._get_json(
            f"https://api.exchange.coinbase.com/products/{asset['sym']}-USD/candles",
            {"granularity": gran, "start": st.isoformat(), "end": end.isoformat()})
        pts = sorted([[int(r[0]) * 1000, float(r[4])] for r in rows])
        return {"points": pts, "source": "Coinbase", "asof": int(time.time() * 1000), "symbol": asset["sym"] + "-USD"}

    async def _yahoo(self, asset, start, days):
        iv = pick_interval(days)[1]
        if iv in ("15m", "60m") and days > 59:
            iv = "1d"
        end = int(time.time())
        j = await self._get_json(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{asset['sym']}",
            {"period1": int(start.timestamp()), "period2": end, "interval": iv, "includePrePost": "false"})
        res = (j.get("chart") or {}).get("result") or []
        if not res:
            raise DataError(f"yahoo: no result for {asset['sym']}")
        r = res[0]
        ts = r.get("timestamp") or []
        closes = ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
        pts = [[t * 1000, c] for t, c in zip(ts, closes) if c is not None]
        meta = r.get("meta") or {}
        live = meta.get("regularMarketPrice")
        mt = meta.get("regularMarketTime")
        if live and mt and pts and mt * 1000 > pts[-1][0]:
            pts.append([mt * 1000, float(live)])
        return {"points": pts, "source": "Yahoo Finance", "asof": (mt or end) * 1000, "symbol": asset["sym"]}

    async def _stooq(self, asset, start, days):
        sym = {"GC=F": "xauusd", "SI=F": "xagusd", "CL=F": "cl.f", "^GSPC": "^spx", "^NDX": "^ndx", "^DJI": "^dji",
               "DX-Y.NYB": "dx.f", "^VIX": "^vix"}.get(asset["sym"], asset["sym"].lower() + ".us")
        s = await self.session()
        async with s.get("https://stooq.com/q/d/l/", params={"s": sym, "i": "d", "d1": start.strftime("%Y%m%d")}) as r:
            txt = await r.text()
        rows = list(csv.DictReader(io.StringIO(txt)))
        pts = []
        for row in rows:
            try:
                d = dt.datetime.strptime(row["Date"], "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
                if d >= start:
                    pts.append([int(d.timestamp() * 1000), float(row["Close"])])
            except (KeyError, ValueError):
                continue
        if not pts:
            raise DataError(f"stooq: no rows for {sym}")
        return {"points": pts, "source": "Stooq", "asof": pts[-1][0], "symbol": sym}
