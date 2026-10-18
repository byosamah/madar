#!/usr/bin/env bash
# scripts/map/build-basemap.sh [--upload]: builds the street map files of the R2 probe (fbk_017, Task 11, 2026-10-18).
# NOT RUN YET. The owner OKs the Cloudflare upload first. Without --upload, the script builds the files in a scratch folder only.
# With --upload, it copies the files to the R2 bucket MAP_BUCKET. The Pages project then needs a binding named MAP to that
# bucket (owner, Pages settings). No config file in this repo names the bucket.
#
# Needs: the pmtiles command line program, git, curl, and npx wrangler (only with --upload).
# PMTILES_SOURCE must name the newest Protomaps daily build (an https address of one .pmtiles file). The script never guesses it.
set -euo pipefail

UPLOAD=0
if [ "${1:-}" = "--upload" ]; then UPLOAD=1; fi

: "${PMTILES_SOURCE:?Set PMTILES_SOURCE to the newest Protomaps daily build (an https address of a .pmtiles file).}"
# Check the newest version of @mapbox/mapbox-gl-rtl-text before the run.
RTL_TEXT_VERSION="${RTL_TEXT_VERSION:-0.2.3}"
MAP_BUCKET="${MAP_BUCKET:-madar-map}"
OUT="${MAP_OUT:-${TMPDIR:-/tmp}/madar-map-build}"
# Saudi Arabia: minimum longitude, minimum latitude, maximum longitude, maximum latitude.
BBOX="34.4,16.3,55.7,32.2"

command -v pmtiles >/dev/null || { echo "The pmtiles command is missing. Install it first." >&2; exit 1; }
mkdir -p "$OUT/fonts"

echo "Extracting Saudi Arabia to $OUT/sa.pmtiles."
pmtiles extract "$PMTILES_SOURCE" "$OUT/sa.pmtiles" --bbox="$BBOX" --maxzoom=15

# The glyph files (Noto Sans, OFL licence) come from the Protomaps basemaps assets.
# The folder Noto Sans Regular holds the Arabic block too (range file 1536-1791). No folder Noto Sans Arabic Regular exists.
if [ ! -d "$OUT/assets-src/.git" ]; then
  git clone --depth 1 https://github.com/protomaps/basemaps-assets.git "$OUT/assets-src"
fi
for stack in "Noto Sans Regular"; do
  src="$OUT/assets-src/fonts/$stack"
  [ -d "$src" ] || { echo "The glyph folder is missing: $src" >&2; exit 1; }
  mkdir -p "$OUT/fonts/$stack"
  cp "$src"/*.pbf "$OUT/fonts/$stack/"
done

echo "Downloading the RTL text plugin, version $RTL_TEXT_VERSION."
curl -fsSL "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@${RTL_TEXT_VERSION}/mapbox-gl-rtl-text.min.js" -o "$OUT/rtl-text.js"

echo "Built files:"
echo "  sa.pmtiles: $(wc -c < "$OUT/sa.pmtiles" | tr -d ' ') bytes"
echo "  glyph files: $(find "$OUT/fonts" -name '*.pbf' | wc -l | tr -d ' ')"
echo "  rtl-text.js: $(wc -c < "$OUT/rtl-text.js" | tr -d ' ') bytes"

if [ "$UPLOAD" -eq 0 ]; then
  echo "No upload. Run again with --upload after the owner OKs the R2 upload."
  exit 0
fi

put() { npx wrangler r2 object put "$MAP_BUCKET/$1" --file "$2" --remote </dev/null; }
put sa.pmtiles "$OUT/sa.pmtiles"
put rtl-text.js "$OUT/rtl-text.js"
find "$OUT/fonts" -name '*.pbf' | while IFS= read -r file; do
  put "${file#"$OUT/"}" "$file"
done
echo "Uploaded to the bucket $MAP_BUCKET. Next: bind it as MAP in the Pages project, then measure (proof.md, Map basemap probe)."
