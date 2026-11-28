"""Live graphics: intent + real series -> a card spec the browser renders (static/card.js).

A card is plain JSON. Numbers on it are computed from the fetched series, never from the
transcript, except the level Matt said (shown as "the level you said", checked for sanity
against the live price so a mis-heard number can't produce a silly chart).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import time
import uuid

from detect import ASSETS, Intent, Window

DEFAULTS = {"compare": 365.25, "level": 14, "price": 90}  # days when no window was spoken
COLORS = ["#f2b84b", "#7fd4c1", "#e5484d", "#8ab4ff"]
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")  # card footers show ET (Matt's zone)


class CardRejected(Exception):
    pass


def window_for(it: Intent, now: dt.datetime | None = None) -> Window:
    if it.window:
        return it.window
    now = now or dt.datetime.now(dt.timezone.utc)
    d = DEFAULTS[it.kind]
    label = {14: "last 2 weeks", 90: "last 3 months", 365.25: "last year"}[d]
    return Window(now - dt.timedelta(days=d), label, d)


def fmt_price(v: float) -> str:
    if v >= 1000:
        return f"${v:,.0f}"
    if v >= 10:
        return f"${v:,.2f}"
    return f"${v:,.4f}".rstrip("0").rstrip(".")


def fmt_value(asset_key: str, v: float) -> str:
    if asset_key in ("US10Y",):
        return f"{v:.2f}%"
    if asset_key in ("DXY", "VIX", "SPX", "NDX", "DJI"):
        return f"{v:,.2f}"
    return fmt_price(v)


def _pct(a: float, b: float) -> float:
    return (b / a - 1.0) * 100.0


def _sources(series: list[dict]) -> str:
    seen = []
    for s in series:
        if s["source"] not in seen:
            seen.append(s["source"])
    return " · ".join(seen)


def _asof(series: list[dict]) -> str:
    t = max(s["asof"] for s in series) / 1000
    return dt.datetime.fromtimestamp(t, ET).strftime("%b %-d, %-I:%M %p ET")


async def build(it: Intent, market, now: dt.datetime | None = None) -> dict:
    t0 = time.monotonic()
    win = window_for(it, now)
    assets = [ASSETS[k] for k in it.assets]
    series = await asyncio.gather(*[market.series(a, win.start, win.days) for a in assets])
    card = {"id": uuid.uuid4().hex[:10], "kind": it.kind, "key": it.key, "quote": it.quote,
            "window": win.label, "start": int(win.start.timestamp() * 1000),
            "source": _sources(series), "asof": _asof(series), "created": time.time()}
    if it.kind == "compare":
        lines, stats = [], []
        for i, (a, s) in enumerate(zip(assets, series)):
            base = s["points"][0][1]
            pts = [[t, round(_pct(base, v), 3)] for t, v in s["points"]]
            lines.append({"label": a["name"], "key": a["key"], "color": COLORS[i % 4], "points": pts})
            stats.append({"label": a["name"], "value": f"{pts[-1][1]:+.1f}%", "color": COLORS[i % 4],
                          "sub": f"{fmt_value(a['key'], base)} → {fmt_value(a['key'], s['points'][-1][1])}"})
        names = " vs ".join(a["key"] if a["kind"] == "crypto" else a["name"] for a in assets)
        lead = max(stats, key=lambda x: float(x["value"].rstrip("%")))
        card.update(title=names, subtitle=win.label.capitalize(), yunit="%", lines=lines, stats=stats,
                    headline=(f"{lead['label']} leads, {lead['value']}" if float(lead["value"].rstrip("%")) >= 0
                              else f"All down; {lead['label']} fell least, {lead['value']}"))
    elif it.kind == "level":
        a, s = assets[0], series[0]
        last = s["points"][-1][1]
        lv = it.level
        if not lv or not (0.5 * last <= lv <= 2.0 * last):
            raise CardRejected(f"level {lv} not plausible vs {a['key']} at {last}")
        dist = _pct(lv, last)
        side = "above" if last >= lv else "below"
        card.update(title=f"{a['key'] if a['kind'] == 'crypto' else a['name']} · {fmt_value(a['key'], lv)}",
                    subtitle=f"{win.label.capitalize()}", yunit="$",
                    lines=[{"label": a["name"], "key": a["key"], "color": COLORS[0], "points": s["points"]}],
                    level={"value": lv, "label": fmt_value(a["key"], lv)},
                    stats=[{"label": "Now", "value": fmt_value(a["key"], last), "color": COLORS[0], "sub": s["symbol"]},
                           {"label": f"{side} level", "value": f"{dist:+.1f}%", "color": "#7fd4c1" if side == "above" else "#e5484d",
                            "sub": f"vs {fmt_value(a['key'], lv)}"}],
                    headline=f"{a['name']} {fmt_value(a['key'], last)}, {abs(dist):.1f}% {side} {fmt_value(a['key'], lv)}")
    else:
        a, s = assets[0], series[0]
        first, last = s["points"][0][1], s["points"][-1][1]
        hi = max(v for _, v in s["points"]); lo = min(v for _, v in s["points"])
        ch = _pct(first, last)
        card.update(title=a["key"] if a["kind"] == "crypto" else a["name"], subtitle=win.label.capitalize(), yunit="$",
                    lines=[{"label": a["name"], "key": a["key"], "color": COLORS[0], "points": s["points"]}],
                    stats=[{"label": "Now", "value": fmt_value(a["key"], last), "color": COLORS[0], "sub": s["symbol"]},
                           {"label": "Change", "value": f"{ch:+.1f}%", "color": "#7fd4c1" if ch >= 0 else "#e5484d",
                            "sub": f"range {fmt_value(a['key'], lo)}–{fmt_value(a['key'], hi)}"}],
                    headline=f"{a['name']} {ch:+.1f}% {win.label}")
    card["build_ms"] = round((time.monotonic() - t0) * 1000)
    return card
