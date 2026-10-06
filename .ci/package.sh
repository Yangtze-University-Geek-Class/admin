#!/usr/bin/env bash
. "$(dirname "$0")/_node22.sh"
mkdir -p "$OUT_DIR/dist"
for app in server web console; do
  [ -d "app/$app/dist" ] || { echo "missing app/$app/dist" >&2; exit 1; }
  rm -rf "$OUT_DIR/dist/$app"
  cp -R "app/$app/dist" "$OUT_DIR/dist/$app"
done
du -sh "$OUT_DIR/dist"
