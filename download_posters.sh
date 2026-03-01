#!/usr/bin/env bash
# ============================================================
# download_posters.sh
# Downloads movie poster images from TMDB for every title
# in data/movies.json. Saves to posters/{tmdbId}.jpg
#
# Requirements: curl, jq
# Usage:  ./download_posters.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/data/config.json"
MOVIES_FILE="$SCRIPT_DIR/data/movies.json"
POSTERS_DIR="$SCRIPT_DIR/posters"

# ---- Read config ----
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌  Config file not found: $CONFIG_FILE"
  exit 1
fi

IMAGE_BASE=$(jq -r '.tmdbImageBase // "https://image.tmdb.org/t/p/w500"' "$CONFIG_FILE")

if [[ ! -f "$MOVIES_FILE" ]]; then
  echo "❌  Movies file not found: $MOVIES_FILE"
  exit 1
fi

mkdir -p "$POSTERS_DIR"

TOTAL=$(jq 'length' "$MOVIES_FILE")
echo "📥  Downloading posters for $TOTAL title(s)…"
echo ""

DOWNLOADED=0
SKIPPED=0
FAILED=0

jq -c '.[]' "$MOVIES_FILE" | while IFS= read -r movie; do
  TMDB_ID=$(echo "$movie" | jq -r '.tmdbId')
  TITLE=$(echo "$movie" | jq -r '.title')
  POSTER_PATH=$(echo "$movie" | jq -r '.posterPath')

  DEST="$POSTERS_DIR/${TMDB_ID}.jpg"

  # Skip if already downloaded
  if [[ -f "$DEST" ]]; then
    echo "  ⏭  [$TMDB_ID] $TITLE — already exists, skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [[ -z "$POSTER_PATH" || "$POSTER_PATH" == "null" ]]; then
    echo "  ⚠️  [$TMDB_ID] $TITLE — no poster path, skipping"
    FAILED=$((FAILED + 1))
    continue
  fi

  URL="${IMAGE_BASE}${POSTER_PATH}"
  echo "  ⬇️  [$TMDB_ID] $TITLE → $DEST"

  HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$DEST" "$URL")
  if [[ "$HTTP_CODE" -ne 200 ]]; then
    echo "     ❌ HTTP $HTTP_CODE — removing partial file"
    rm -f "$DEST"
    FAILED=$((FAILED + 1))
  else
    DOWNLOADED=$((DOWNLOADED + 1))
  fi

  # Be polite to the API
  sleep 0.25
done

echo ""
echo "✅  Done.  Downloaded: $DOWNLOADED  |  Skipped: $SKIPPED  |  Failed: $FAILED"
