#!/bin/sh
# Live graphics server (off-air prototype). On THE_EQUALIZER (WSL):
#   ./livegfx/run.sh            follow the caption bridge log + pre-load topics
#   ./livegfx/run.sh --replay livegfx/demo-transcript.txt   (no mic needed)
# Binds localhost + the tailnet IP (100.78.121.10) so the mini's OBS/Chrome can reach it.
cd "$(dirname "$0")"
TS=$(ip -4 addr show tailscale0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)
exec python3 server.py --host 127.0.0.1 ${TS:+--host $TS} --port "${LIVEGFX_PORT:-8790}" \
	--tail /tmp/live-subtitles.log --topics "${LIVEGFX_TOPICS:-topics.example.json}" "$@"
