#!/usr/bin/env bash
set -euo pipefail

LINKS_SOURCE="${1:-linksnew.txt}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups/replace-songs-$STAMP"

echo "============================================================"
echo "CarryOkie song replacement"
echo "Using links file: $LINKS_SOURCE"
echo "Backup folder: $BACKUP_DIR"
echo "============================================================"

# Make sure we are in the CarryOkie project root.
if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found."
  echo "Run this from your CarryOkie project folder:"
  echo "cd ~/PycharmProjects/CarryOkie"
  exit 1
fi

if ! grep -q '"name": "carryokie"' package.json; then
  echo "ERROR: This does not look like the CarryOkie project."
  exit 1
fi

# Make sure the new links file exists.
if [[ ! -f "$LINKS_SOURCE" ]]; then
  echo "ERROR: Missing $LINKS_SOURCE"
  echo "Create it first, for example:"
  echo "vim linksnew.txt"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo
echo "1) Cleaning YouTube links from $LINKS_SOURCE..."

grep -Eo 'https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}' "$LINKS_SOURCE" \
  | awk '!seen[$0]++' \
  > links-clean.txt

sed -E 's#.*v=([A-Za-z0-9_-]{11}).*#\1#' links-clean.txt > .new-video-ids.txt

NEW_LINK_COUNT="$(wc -l < links-clean.txt | tr -d ' ')"

if [[ "$NEW_LINK_COUNT" -eq 0 ]]; then
  echo "ERROR: No YouTube watch URLs found in $LINKS_SOURCE"
  exit 1
fi

echo "Found $NEW_LINK_COUNT unique new YouTube links."
echo "Clean links written to: links-clean.txt"

echo
echo "2) Backing up old app song sources and generated media..."

# Move old built-in/local songs away so they do not get re-imported.
if [[ -d public/songs ]]; then
  mv public/songs "$BACKUP_DIR/public-songs"
  echo "Moved old public/songs to $BACKUP_DIR/public-songs"
else
  echo "No public/songs folder found."
fi

# Move old protected generated media/catalog away.
if [[ -d public/protected ]]; then
  mv public/protected "$BACKUP_DIR/public-protected"
  echo "Moved old public/protected to $BACKUP_DIR/public-protected"
fi

# Move old Chromecast clear MP4 cache away.
if [[ -d public/cast/media ]]; then
  mkdir -p "$BACKUP_DIR/public-cast"
  mv public/cast/media "$BACKUP_DIR/public-cast/media"
  echo "Moved old public/cast/media to $BACKUP_DIR/public-cast/media"
fi

mkdir -p public/cast
mkdir -p downloads/mp4 downloads/mp3 downloads/logs

echo
echo "3) Removing old downloaded MP4s that are NOT in linksnew.txt..."

OLD_MP4_BACKUP="$BACKUP_DIR/old-downloads-mp4-not-in-new-list"
mkdir -p "$OLD_MP4_BACKUP"

shopt -s nullglob
MOVED_OLD_MP4=0

for f in downloads/mp4/*.mp4; do
  base="$(basename "$f")"
  id=""

  if [[ "$base" =~ \[([A-Za-z0-9_-]{6,})\]\.mp4$ ]]; then
    id="${BASH_REMATCH[1]}"
  fi

  if [[ -z "$id" ]] || ! grep -qx "$id" .new-video-ids.txt; then
    mv "$f" "$OLD_MP4_BACKUP/"
    MOVED_OLD_MP4=$((MOVED_OLD_MP4 + 1))
  fi
done

echo "Moved $MOVED_OLD_MP4 old/unmatched MP4 files to $OLD_MP4_BACKUP"

CURRENT_NEW_MP4_COUNT="$(find downloads/mp4 -maxdepth 1 -type f -name '*.mp4' | wc -l | tr -d ' ')"

echo
echo "New matching MP4 files currently in downloads/mp4: $CURRENT_NEW_MP4_COUNT"
echo "Expected links from links-clean.txt: $NEW_LINK_COUNT"

echo
echo "4) Downloading missing/new songs if needed..."

if [[ "$CURRENT_NEW_MP4_COUNT" -lt "$NEW_LINK_COUNT" ]]; then
  echo "Some MP4s are missing, so the downloader will run now."
  echo "Clearing yt-dlp archives so missing files do not get skipped."
  rm -f downloads/archive-mp4.txt downloads/archive-mp3.txt

  ./scripts/download_youtube_karaoke.sh links-clean.txt
else
  echo "downloads/mp4 already has at least as many MP4s as the new link list."
  echo "Skipping download step."
fi

echo
echo "5) Final cleanup: keep only MP4s whose video IDs are in linksnew.txt..."

mkdir -p "$OLD_MP4_BACKUP"

for f in downloads/mp4/*.mp4; do
  base="$(basename "$f")"
  id=""

  if [[ "$base" =~ \[([A-Za-z0-9_-]{6,})\]\.mp4$ ]]; then
    id="${BASH_REMATCH[1]}"
  fi

  if [[ -z "$id" ]] || ! grep -qx "$id" .new-video-ids.txt; then
    mv "$f" "$OLD_MP4_BACKUP/"
  fi
done

FINAL_MP4_COUNT="$(find downloads/mp4 -maxdepth 1 -type f -name '*.mp4' | wc -l | tr -d ' ')"

if [[ "$FINAL_MP4_COUNT" -eq 0 ]]; then
  echo "ERROR: No MP4 files remain in downloads/mp4."
  echo "Check downloads/logs for yt-dlp errors."
  exit 1
fi

echo "Final MP4 count to import: $FINAL_MP4_COUNT"

echo
echo "6) Installing npm dependencies if needed..."

if [[ ! -d node_modules ]]; then
  npm install
else
  echo "node_modules already exists. Skipping npm install."
fi

echo
echo "7) Importing new songs into protected media and Chromecast cache..."

npm run importMedia

echo
echo "8) Verifying catalog..."

node <<'NODE'
const fs = require("fs");

const catalogPath = "public/protected/catalog.json";
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const songs = catalog.songs || [];
const nonDownloadSongs = songs.filter((song) => song.source !== "downloads/mp4");

console.log(`${songs.length} songs in public/protected/catalog.json`);

if (songs.length === 0) {
  console.error("ERROR: Catalog has zero songs.");
  process.exit(1);
}

if (nonDownloadSongs.length > 0) {
  console.error("ERROR: Catalog still includes songs not imported from downloads/mp4:");
  for (const song of nonDownloadSongs.slice(0, 20)) {
    console.error(`- ${song.source}: ${song.artist} - ${song.title}`);
  }
  process.exit(1);
}

console.log("OK: Catalog contains only new downloads/mp4 songs.");
console.log("");
console.log("First 20 songs:");
songs.slice(0, 20).forEach((song, index) => {
  console.log(`${index + 1}. ${song.artist} - ${song.title}`);
});
NODE

echo
echo "9) Building CarryOkie..."

npm run build

echo
echo "============================================================"
echo "DONE"
echo "Old files backed up at: $BACKUP_DIR"
echo "New protected catalog: public/protected/catalog.json"
echo "New encrypted media:   public/protected/media/"
echo "New Cast media cache:  public/cast/media/"
echo "============================================================"
echo
echo "Starting local preview..."
echo "Open: http://127.0.0.1:4174/host/"
echo

npm run serve:local
