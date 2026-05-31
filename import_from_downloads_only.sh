#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups/import-from-downloads-only-$STAMP"

echo "============================================================"
echo "CarryOkie import from downloads/mp4 only"
echo "Backup folder: $BACKUP_DIR"
echo "============================================================"

# 1) Safety checks
if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found."
  echo "Run this from the CarryOkie project folder:"
  echo "cd ~/PycharmProjects/CarryOkie"
  exit 1
fi

if [[ ! -d downloads/mp4 ]]; then
  echo "ERROR: downloads/mp4 does not exist."
  exit 1
fi

MP4_COUNT="$(find downloads/mp4 -maxdepth 1 -type f -name '*.mp4' | wc -l | tr -d ' ')"

if [[ "$MP4_COUNT" -eq 0 ]]; then
  echo "ERROR: No .mp4 files found in downloads/mp4"
  echo "Download videos first, then run this again."
  exit 1
fi

echo "Found $MP4_COUNT MP4 files in downloads/mp4"
echo "These will become the new app song library."

# 2) Back up old app song/catalog/cast files
mkdir -p "$BACKUP_DIR"

if [[ -d public/songs ]]; then
  mv public/songs "$BACKUP_DIR/public-songs"
  echo "Moved old public/songs to $BACKUP_DIR/public-songs"
else
  echo "No public/songs folder found."
fi

if [[ -d public/protected ]]; then
  mv public/protected "$BACKUP_DIR/public-protected"
  echo "Moved old public/protected to $BACKUP_DIR/public-protected"
fi

if [[ -d public/cast/media ]]; then
  mkdir -p "$BACKUP_DIR/public-cast"
  mv public/cast/media "$BACKUP_DIR/public-cast/media"
  echo "Moved old public/cast/media to $BACKUP_DIR/public-cast/media"
fi

mkdir -p public/cast

# 3) Install dependencies if needed
if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
else
  echo "node_modules exists. Skipping npm install."
fi

# 4) Import only downloads/mp4 into protected catalog + Cast cache
echo
echo "Importing MP4 files from downloads/mp4..."
npm run importMedia

# 5) Verify catalog only contains downloads/mp4 songs
echo
echo "Verifying catalog..."

node <<'NODE'
const fs = require("fs");

const catalogPath = "public/protected/catalog.json";
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const songs = catalog.songs || [];

console.log(`${songs.length} songs in public/protected/catalog.json`);

if (songs.length === 0) {
  console.error("ERROR: Catalog has zero songs.");
  process.exit(1);
}

const nonDownloadSongs = songs.filter((song) => song.source !== "downloads/mp4");

if (nonDownloadSongs.length > 0) {
  console.error("ERROR: Catalog still includes non-download songs:");
  for (const song of nonDownloadSongs.slice(0, 20)) {
    console.error(`- ${song.source}: ${song.artist} - ${song.title}`);
  }
  process.exit(1);
}

console.log("OK: Catalog contains only downloads/mp4 songs.");
console.log("");
console.log("First 25 songs:");
songs.slice(0, 25).forEach((song, index) => {
  console.log(`${index + 1}. ${song.artist} - ${song.title}`);
});
NODE

# 6) Build app
echo
echo "Building CarryOkie..."
npm run build

echo
echo "============================================================"
echo "DONE"
echo "Imported from:          downloads/mp4/"
echo "Protected catalog:      public/protected/catalog.json"
echo "Encrypted media:        public/protected/media/"
echo "Chromecast MP4 cache:   public/cast/media/"
echo "Backup saved at:        $BACKUP_DIR"
echo "============================================================"
echo
echo "Starting local preview..."
echo "Open this after server starts:"
echo "http://127.0.0.1:4174/host/"
echo

npm run serve:local
