#!/bin/bash
# Prepare screenshots for the Obsidian community directory.
#
#   ./resize.sh desktop shot1.png shot2.png ...   -> 1200x800  (3:2)
#   ./resize.sh mobile  phone1.png ...            -> 900x1600  (9:16)
#
# Scales each image so it covers the target box, then crops from the centre —
# so nothing is stretched and the aspect ratio is exact. Output goes to
# ./out/ and the originals are left untouched.
#
# Uses sips, which ships with macOS. No installation, no dependencies.

set -euo pipefail

case "${1:-}" in
  desktop) W=1200; H=800 ;;
  mobile)  W=900;  H=1600 ;;
  *) echo "usage: $0 {desktop|mobile} image ..." >&2; exit 1 ;;
esac
shift

[ $# -gt 0 ] || { echo "no images given" >&2; exit 1; }
mkdir -p out

for src in "$@"; do
  [ -f "$src" ] || { echo "skipping $src (not found)" >&2; continue; }

  read -r sw sh < <(sips -g pixelWidth -g pixelHeight "$src" \
    | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}')

  # Scale to cover, not fit: the larger of the two ratios wins, so the target
  # box is fully filled and the excess is cropped rather than letterboxed.
  scale=$(awk -v sw="$sw" -v sh="$sh" -v w="$W" -v h="$H" \
    'BEGIN { rw = w/sw; rh = h/sh; print (rw > rh ? rw : rh) }')
  nw=$(awk -v s="$scale" -v v="$sw" 'BEGIN { printf "%d", (v*s)+0.999 }')
  nh=$(awk -v s="$scale" -v v="$sh" 'BEGIN { printf "%d", (v*s)+0.999 }')

  out="out/$(basename "${src%.*}").png"
  cp "$src" "$out"
  sips -z "$nh" "$nw" "$out" >/dev/null   # sips takes height then width
  sips -c "$H" "$W" "$out" >/dev/null     # centre crop, height then width

  size=$(du -h "$out" | cut -f1)
  echo "  $(basename "$src")  ${sw}x${sh}  ->  ${W}x${H}  ($size)"
done

echo
echo "Ready in ./out/ — upload those."
