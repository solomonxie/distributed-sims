#!/bin/sh
# Resize portrait iPhone shots to the App Store Connect slots as JPEG (no alpha).
# Usage: scripts/store-screenshots.sh <dir-of-pngs-or-jpgs> [out-dir]
set -e
IN=${1:?usage: $0 <input-dir> [out-dir]}
OUT=${2:-docs/release/screenshots}
mkdir -p "$OUT"

for f in "$IN"/*.png "$IN"/*.PNG "$IN"/*.jpg "$IN"/*.jpeg "$IN"/*.JPG "$IN"/*.HEIC; do
  [ -f "$f" ] || continue
  name=$(basename "${f%.*}")
  sips -s format jpeg -s formatOptions 80 -z 2868 1320 "$f" --out "$OUT/$name.jpg" >/dev/null
  echo "$name"
done
