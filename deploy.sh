#!/bin/sh
# FPM Studio deploy — the ONLY way to ship (SPEC I1/I2). One command:
#   1. refuses to run with uncommitted changes (stamp first via fpm-stamp.sh, then commit)
#   2. pushes deploy AND main (GitHub Pages serves MAIN — pushing only deploy ships nothing)
#   3. syncs the mini's local overlay copies (OBS legacy inputs read ~/obs-overlays/*.html;
#      local files = robust if Pages is down, fork = single source of truth)
#   4. refreshes the OBS overlay sources + hard-reloads the host tab (build-sync then stamps
#      the Stage URL, forcing OBS's stage page onto the same build)
# Pages CDN takes 1-10 min; verify with:  curl -s https://matt-leftcurve.github.io/studio/ | grep fpm-build
set -e
cd "$(dirname "$0")"
REPO="$(pwd)"
MINI="carolyuan@100.116.51.32"

if ! git diff --quiet || ! git diff --cached --quiet; then
	echo "deploy.sh: uncommitted changes — run ./fpm-stamp.sh, commit, then deploy." >&2
	exit 1
fi

git push fpm deploy
git push fpm deploy:main

scp -q stage/retro-solo.html stage/retro-sbs.html stage/retro-trio.html stage/starting-soon.html "$MINI":obs-overlays/

cd "$HOME/.local/share/fpm-tools" && node --input-type=module -e "
import OBSWebSocket from 'obs-websocket-js';
const o=new OBSWebSocket();await o.connect('ws://100.116.51.32:4455','bender-mini-4k');
for(const n of ['Retro Overlay','Retro Solo Overlay','Retro SBS Overlay','Retro Trio Overlay','Live Ticker']){
  try{await o.call('PressInputPropertiesButton',{inputName:n,propertyName:'refreshnocache'});}catch(e){}
}
console.log('OBS overlay sources refreshed');
await o.disconnect();" || echo "deploy.sh: OBS refresh skipped (OBS not reachable — refresh at next preflight)" >&2

ssh "$MINI" 'osascript /tmp/hardreload2.scpt' >/dev/null 2>&1 \
	&& echo "host tab hard-reloaded (build-sync will restamp the Stage URL once Pages serves the new build)" \
	|| echo "deploy.sh: host tab reload skipped (reload it manually; it syncs OBS's stage page)" >&2

echo "deployed: $(grep -o 'fpm-build\" content=\"[^\"]*\"' "$REPO/index.html" | head -1)"
