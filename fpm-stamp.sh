#!/bin/sh
# Stamp the build shown on guest/host/director pages and the join page. Run before every deploy commit.
B=$(date +"%m-%d %H:%M")
sed -i "s/<meta name=\"fpm-build\" content=\"[^\"]*\"/<meta name=\"fpm-build\" content=\"$B\"/" index.html join.html
# the shared geometry (fpm-layouts.js) must NEVER be cache-stale (SPEC I2): stamp its query everywhere
V=$(printf %s "$B" | tr " :" "--")
sed -i "s|fpm-layouts.js?v=[^\"]*|fpm-layouts.js?v=$V|" index.html stage.html
echo "build $B"
