# Live graphics (off-air prototype, 2026-11-27)

While Matt talks, this listens to the live captions, spots what he's talking about and
builds a chart card from **real** market data. Cards wait in a queue; **nothing goes on air
until Matt taps AIR**.

```
caption bridge (Bender: live-subtitles.py, faster-whisper on the 5090)
   └─ /tmp/live-subtitles.log  ──(read-only tail, finals only)──┐
POST /api/transcript, typed topics, --replay file ──────────────┤
                                                                ▼
                    detect.py  rules: tickers (EN + 中文), levels, comparisons, timeframes   (<1 ms)
                    market.py  Binance public data / Coinbase · Yahoo Finance / Stooq       (~0.1-0.7 s)
                    cards.py   numbers computed from the series; implausible levels dropped
                                                                ▼
             /queue  (host popup: AIR / OFF / dismiss / type a topic)  ── postMessage ──► host page
             /onair  (OBS browser source, transparent except the graphic panel)        sets gfx=1 on Stage
             /preview?guests=N  (layout mock for review)
```

* Geometry: `fpmLayouts.graphicLayout(n)` — 744x930 panel on the left of the stage band, Matt + guests
  packed to the right as 16:9 tiles (same approach as the portrait iPhone share).
* Host page: `&livegfx=http://100.78.121.10:8790` adds the host-only **📊 graphics** button. Without the
  param nothing changes.
* The tail never reads `/tmp/mic.fifo`, never talks to OBS, never restarts the bridge.

Run: `./livegfx/run.sh` (add `--replay livegfx/demo-transcript.txt` to test without a mic).
Tests: `python3 -m unittest discover -s livegfx/tests` and `node livegfx/tests/fpm-livegfx-layout.test.mjs`.
