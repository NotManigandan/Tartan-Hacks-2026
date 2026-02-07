#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="$1"
OUT_DIR="extracted"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

ls -lh "$ARCHIVE"

case "$ARCHIVE" in
  *.tar.gz)
    tar -xzf "$ARCHIVE" -C "$OUT_DIR"
    ;;
  *.tar.br)
    brotli -d "$ARCHIVE" -o "${ARCHIVE%.br}"
    tar -xf "${ARCHIVE%.br}" -C "$OUT_DIR"
    rm "${ARCHIVE%.br}"
    ;;
  *.tar.zst)
    zstd -d "$ARCHIVE" -o "${ARCHIVE%.zst}"
    tar -xf "${ARCHIVE%.zst}" -C "$OUT_DIR"
    rm "${ARCHIVE%.zst}"
    ;;
  *)
    echo "Unsupported archive format"
    exit 1
    ;;
esac

echo "Extraction successful"

echo "Starting HTTP server on port 8000..."
cd "$OUT_DIR"
python3 -m http.server 8000
