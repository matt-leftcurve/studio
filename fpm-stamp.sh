#!/bin/sh
# Stamp the build shown on guest/host/director pages and the join page. Run before every deploy commit.
B=$(date +"%m-%d %H:%M")
sed -i "s/<meta name=\"fpm-build\" content=\"[^\"]*\"/<meta name=\"fpm-build\" content=\"$B\"/" index.html join.html
echo "build $B"
