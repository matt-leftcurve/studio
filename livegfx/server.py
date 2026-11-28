#!/usr/bin/env python3
"""Live graphics server (off-air prototype, 2026-11-27).

  transcript in  ->  detect.py (rules, <1 ms)  ->  market.py (real data)  ->  cards.py  ->  QUEUE
  Matt taps AIR on the queue page  ->  /onair (OBS browser source) shows it, host page reflows the stage.

Transcript sources (any combination):
  --tail /tmp/live-subtitles.log   READ-ONLY tail of the caption bridge's log (Bender's
                                   live-subtitles.py). Never touches /tmp/mic.fifo or OBS.
  POST /api/transcript             {"en": "...", "zh": "..."} (demo / manual / other feeds)
  --replay file.txt                one utterance per line, for dry runs without a mic

Nothing goes on air without a tap. Binds to localhost + the tailnet address only.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

from aiohttp import web

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cards as C  # noqa: E402
import detect as D  # noqa: E402
from market import Market  # noqa: E402

LOG_RE = re.compile(r"^\[(\d\d:\d\d:\d\d)\] \((final|partial|draft)\b[^)]*\) (.*)$")


class Hub:
    def __init__(self, market, dedup_s=600, max_queue=30, partials=False):
        self.market = market
        self.queue: list[dict] = []        # newest first
        self.onair: dict | None = None
        self.recent: dict[str, float] = {}  # key -> time last queued
        self.dedup_s = dedup_s
        self.max_queue = max_queue
        self.partials = partials
        self.listeners: set[asyncio.Queue] = set()
        self.heard: list[dict] = []          # last utterances (for the queue page ticker)
        self.status = {"tail": None, "tail_last": None, "lines": 0, "errors": []}
        self.preloaded: dict[str, dict] = {}  # key -> card (instant)
        self.latency: list[dict] = []

    # -------- state fan-out
    def snapshot(self):
        return {"queue": self.queue, "onair": self.onair, "heard": self.heard[-6:], "status": self.status,
                "latency": self.latency[-20:], "now": time.time()}

    def publish(self):
        snap = json.dumps(self.snapshot())
        for q in list(self.listeners):
            try:
                q.put_nowait(snap)
            except asyncio.QueueFull:
                pass

    # -------- ingest
    async def ingest(self, en: str, zh: str = "", origin: str = "api", t_heard: float | None = None) -> list[dict]:
        t_heard = t_heard or time.time()
        self.heard.append({"t": t_heard, "en": en, "zh": zh, "origin": origin})
        self.heard = self.heard[-50:]
        intents = D.detect(en, zh)
        made = []
        for it in intents:
            if self.recent.get(it.key, 0) > time.time() - self.dedup_s and it.key not in self.preloaded:
                continue
            self.recent[it.key] = time.time()
            if it.key in self.preloaded:
                card = dict(self.preloaded[it.key])
                card["heard"] = True
                card["quote"] = it.quote
                self.queue = [c for c in self.queue if c["key"] != it.key]
            else:
                try:
                    card = await C.build(it, self.market)
                except Exception as e:  # noqa: BLE001 — no data, no card
                    self.status["errors"] = (self.status["errors"] + [f"{it.key}: {e}"])[-5:]
                    continue
            card["t_heard"] = t_heard
            card["t_ready"] = time.time()
            card["origin"] = origin
            self.latency.append({"key": it.key, "ms": round((card["t_ready"] - t_heard) * 1000), "origin": origin,
                                 "preloaded": it.key in self.preloaded})
            self.queue.insert(0, card)
            made.append(card)
        if len(self.queue) > self.max_queue:
            self.queue = self.queue[: self.max_queue]
        self.publish()
        return made

    async def preload(self, phrases: list[str]):
        for p in phrases:
            for it in D.detect(p, ""):
                try:
                    card = await C.build(it, self.market)
                except Exception as e:  # noqa: BLE001
                    self.status["errors"] = (self.status["errors"] + [f"preload {p!r}: {e}"])[-5:]
                    continue
                card["preloaded"] = True
                card["quote"] = p
                self.preloaded[it.key] = card
                self.queue = [c for c in self.queue if c["key"] != it.key] + [card]
        self.publish()

    # -------- control
    def air(self, cid):
        for c in self.queue:
            if c["id"] == cid:
                self.onair = c
                self.onair["t_air"] = time.time()
                self.publish()
                return True
        return False

    def off(self):
        self.onair = None
        self.publish()

    def dismiss(self, cid):
        self.queue = [c for c in self.queue if c["id"] != cid]
        self.publish()


async def tail_log(hub: Hub, path: str):
    """Follow the caption bridge log like `tail -F`, from the END (no replay of old lines)."""
    hub.status["tail"] = path
    pos, ino = None, None
    while True:
        try:
            st = os.stat(path)
            if ino != st.st_ino or (pos is not None and st.st_size < pos):
                ino, pos = st.st_ino, (st.st_size if pos is None else 0)
            if st.st_size > pos:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(pos)
                    chunk = f.read()
                    pos = f.tell()
                for line in chunk.splitlines():
                    m = LOG_RE.match(line.strip())
                    if not m:
                        continue
                    tag, body = m.group(2), m.group(3)
                    if tag != "final" and not hub.partials:
                        continue
                    if "<empty" in body:
                        continue
                    zh, _, en = body.partition(" | ")
                    hub.status["lines"] += 1
                    hub.status["tail_last"] = time.time()
                    asyncio.create_task(hub.ingest(en.strip(), zh.strip(), origin="captions"))
        except FileNotFoundError:
            pos, ino = None, None
        except Exception as e:  # noqa: BLE001
            hub.status["errors"] = (hub.status["errors"] + [f"tail: {e!r}"])[-5:]
        await asyncio.sleep(0.25)


async def replay(hub: Hub, path: str, gap: float):
    await asyncio.sleep(1.0)
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        en, _, zh = line.partition("||")
        await hub.ingest(en.strip(), zh.strip(), origin="replay")
        await asyncio.sleep(gap)


def make_app(hub: Hub, repo_root: Path) -> web.Application:
    app = web.Application()
    static = HERE / "static"

    async def page(req):
        name = req.match_info.get("name") or "queue"
        f = static / f"{name}.html"
        if not f.exists():
            raise web.HTTPNotFound()
        return web.FileResponse(f, headers={"Cache-Control": "no-store"})

    async def layouts(req):
        return web.FileResponse(repo_root / "fpm-layouts.js", headers={"Cache-Control": "no-store"})

    async def state(req):
        return web.json_response(hub.snapshot(), headers={"Cache-Control": "no-store"})

    async def events(req):
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-store",
                                           "Access-Control-Allow-Origin": "*"})
        await resp.prepare(req)
        q: asyncio.Queue = asyncio.Queue(maxsize=20)
        hub.listeners.add(q)
        try:
            await resp.write(f"data: {json.dumps(hub.snapshot())}\n\n".encode())
            while True:
                try:
                    snap = await asyncio.wait_for(q.get(), 15)
                    await resp.write(f"data: {snap}\n\n".encode())
                except asyncio.TimeoutError:
                    await resp.write(b": ping\n\n")
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            hub.listeners.discard(q)
        return resp

    async def transcript(req):
        j = await req.json()
        made = await hub.ingest(j.get("en", "") or j.get("text", ""), j.get("zh", ""), origin=j.get("origin", "api"))
        return web.json_response({"made": [c["id"] for c in made], "cards": made})

    async def topic(req):  # Matt types a topic on the queue page
        j = await req.json()
        made = await hub.ingest(j.get("text", ""), "", origin="typed")
        return web.json_response({"made": [c["id"] for c in made]})

    async def air(req):
        j = await req.json()
        return web.json_response({"ok": hub.air(j.get("id"))})

    async def off(req):
        hub.off()
        return web.json_response({"ok": True})

    async def dismiss(req):
        j = await req.json()
        hub.dismiss(j.get("id"))
        return web.json_response({"ok": True})

    app.router.add_get("/", page)
    app.router.add_get("/fpm-layouts.js", layouts)
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/events", events)
    app.router.add_post("/api/transcript", transcript)
    app.router.add_post("/api/topic", topic)
    app.router.add_post("/api/air", air)
    app.router.add_post("/api/off", off)
    app.router.add_post("/api/dismiss", dismiss)
    app.router.add_static("/static/", static)
    app.router.add_static("/repo/stage/", repo_root / "stage")  # preview uses Matt's photo
    app.router.add_get("/{name}", page)
    return app


async def amain(args):
    market = Market(ttl=args.ttl)
    hub = Hub(market, dedup_s=args.dedup, partials=args.partials)
    app = make_app(hub, HERE.parent)
    runner = web.AppRunner(app)
    await runner.setup()
    for host in args.host:
        await web.TCPSite(runner, host, args.port).start()
        print(f"live-graphics: http://{host}:{args.port}/queue  ·  /onair  ·  /preview", flush=True)
    if args.topics and Path(args.topics).exists():
        j = json.loads(Path(args.topics).read_text(encoding="utf-8"))
        phrases = j.get("topics", j) if isinstance(j, dict) else j
        asyncio.create_task(hub.preload(phrases))

        async def refresh():  # keep pre-loaded cards' data fresh
            while True:
                await asyncio.sleep(300)
                await hub.preload(phrases)
        asyncio.create_task(refresh())
    if args.tail:
        asyncio.create_task(tail_log(hub, args.tail))
    if args.replay:
        asyncio.create_task(replay(hub, args.replay, args.replay_gap))
    try:
        await asyncio.Event().wait()
    finally:
        await market.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", action="append", default=None, help="bind address (repeatable)")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--tail", default=None, help="caption bridge log to follow read-only, e.g. /tmp/live-subtitles.log")
    ap.add_argument("--partials", action="store_true", help="also react to draft caption lines (faster, noisier)")
    ap.add_argument("--topics", default=None, help="JSON list of phrases to pre-build (instant cards)")
    ap.add_argument("--replay", default=None)
    ap.add_argument("--replay-gap", type=float, default=4.0)
    ap.add_argument("--dedup", type=float, default=600)
    ap.add_argument("--ttl", type=float, default=60)
    args = ap.parse_args()
    args.host = args.host or ["127.0.0.1"]
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
