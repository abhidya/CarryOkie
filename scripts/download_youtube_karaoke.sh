#!/usr/bin/env bash
set -u -o pipefail

# Download each YouTube URL in links.txt as BOTH:
#   - downloads/mp4/<safe title> [video_id].mp4
#   - downloads/mp3/<safe title> [video_id].mp3
#
# Requirements: yt-dlp + ffmpeg on PATH.
# Usage: ./scripts/download_youtube_karaoke.sh [links.txt]

LINKS_FILE="${1:-links.txt}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="$ROOT_DIR/downloads"
MP4_DIR="$DOWNLOAD_DIR/mp4"
MP3_DIR="$DOWNLOAD_DIR/mp3"
LOG_DIR="$DOWNLOAD_DIR/logs"
MP4_ARCHIVE="$DOWNLOAD_DIR/archive-mp4.txt"
MP3_ARCHIVE="$DOWNLOAD_DIR/archive-mp3.txt"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/download-$RUN_ID.log"

mkdir -p "$MP4_DIR" "$MP3_DIR" "$LOG_DIR"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '[%s] %s\n' "$(ts)" "$*" | tee -a "$LOG_FILE"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: missing required command: $1"
    return 1
  fi
}

if ! need_cmd yt-dlp || ! need_cmd ffmpeg; then
  cat <<'MSG' | tee -a "$LOG_FILE"

Install options:
  macOS Homebrew:
    brew install yt-dlp ffmpeg

  Python/pip alternative for yt-dlp:
    python3 -m pip install -U "yt-dlp[default]"

  FFmpeg is still required on PATH for merging/conversion.
MSG
  exit 127
fi

if [[ ! -f "$LINKS_FILE" ]]; then
  log "ERROR: links file not found: $LINKS_FILE"
  exit 2
fi

URLS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  if printf '%s\n' "$line" | grep -Eq 'https?://(www\.)?(youtube\.com|youtu\.be)/'; then
    URLS+=("$line")
  fi
done < "$LINKS_FILE"
if [[ "${#URLS[@]}" -eq 0 ]]; then
  log "ERROR: no YouTube URLs found in $LINKS_FILE"
  exit 3
fi

log "Starting download run"
log "Links file: $LINKS_FILE"
log "MP4 output: $MP4_DIR"
log "MP3 output: $MP3_DIR"
log "MP4 archive: $MP4_ARCHIVE"
log "MP3 archive: $MP3_ARCHIVE"
log "Log file: $LOG_FILE"
log "Exact MP4 command template: yt-dlp --continue --no-abort-on-error --ignore-errors --download-archive '$MP4_ARCHIVE' --restrict-filenames --windows-filenames --trim-filenames 180 -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best' --merge-output-format mp4 -o '$MP4_DIR/%(title).180B [%(id)s].%(ext)s' URL"
log "Exact MP3 command template: yt-dlp --continue --no-abort-on-error --ignore-errors --download-archive '$MP3_ARCHIVE' --restrict-filenames --windows-filenames --trim-filenames 180 -x --audio-format mp3 --audio-quality 0 --embed-metadata --embed-thumbnail --convert-thumbnails jpg -o '$MP3_DIR/%(title).180B [%(id)s].%(ext)s' URL"

mp4_ok=0; mp4_fail=0; mp3_ok=0; mp3_fail=0

video_id_from_url() {
  case "$1" in
    *"watch?v="*) printf '%s\n' "$1" | sed -E 's/^.*[?&]v=([^&]+).*$/\1/' ;;
    *"youtu.be/"*) printf '%s\n' "$1" | sed -E 's#^.*/youtu\.be/([^?&/]+).*$#\1#' ;;
    *) printf '%s\n' "$1" ;;
  esac
}

has_downloaded_file() {
  local dir="$1"
  local ext="$2"
  local id="$3"
  find "$dir" -maxdepth 1 -type f -name "*.$ext" -print | grep -Fq "[$id].$ext"
}

archive_has_id() {
  local archive="$1"
  local id="$2"
  [[ -f "$archive" ]] && grep -Eq "^[^[:space:]]+[[:space:]]+$id$" "$archive"
}

for url in "${URLS[@]}"; do
  id="$(video_id_from_url "$url")"
  if has_downloaded_file "$MP4_DIR" mp4 "$id"; then
    log "MP4 SKIP existing file $url"
    if ! archive_has_id "$MP4_ARCHIVE" "$id"; then printf 'youtube %s\n' "$id" >> "$MP4_ARCHIVE"; fi
    mp4_ok=$((mp4_ok + 1))
  else
  log "MP4 START $url"
  if yt-dlp \
    --continue \
    --no-abort-on-error \
    --ignore-errors \
    --download-archive "$MP4_ARCHIVE" \
    --restrict-filenames \
    --windows-filenames \
    --trim-filenames 180 \
    -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best' \
    --merge-output-format mp4 \
    -o "$MP4_DIR/%(title).180B [%(id)s].%(ext)s" \
    "$url" 2>&1 | tee -a "$LOG_FILE"; then
    log "MP4 SUCCESS $url"
    mp4_ok=$((mp4_ok + 1))
  else
    log "MP4 FAILURE $url"
    mp4_fail=$((mp4_fail + 1))
  fi
  fi

  if has_downloaded_file "$MP3_DIR" mp3 "$id"; then
    log "MP3 SKIP existing file $url"
    if ! archive_has_id "$MP3_ARCHIVE" "$id"; then printf 'youtube %s\n' "$id" >> "$MP3_ARCHIVE"; fi
    mp3_ok=$((mp3_ok + 1))
  else
  log "MP3 START $url"
  if yt-dlp \
    --continue \
    --no-abort-on-error \
    --ignore-errors \
    --download-archive "$MP3_ARCHIVE" \
    --restrict-filenames \
    --windows-filenames \
    --trim-filenames 180 \
    -x \
    --audio-format mp3 \
    --audio-quality 0 \
    --embed-metadata \
    --embed-thumbnail \
    --convert-thumbnails jpg \
    -o "$MP3_DIR/%(title).180B [%(id)s].%(ext)s" \
    "$url" 2>&1 | tee -a "$LOG_FILE"; then
    log "MP3 SUCCESS $url"
    mp3_ok=$((mp3_ok + 1))
  else
    log "MP3 FAILURE $url"
    mp3_fail=$((mp3_fail + 1))
  fi
  fi

done

log "Run complete: MP4 success=$mp4_ok failure=$mp4_fail | MP3 success=$mp3_ok failure=$mp3_fail"
if [[ "$mp4_fail" -gt 0 || "$mp3_fail" -gt 0 ]]; then
  log "Completed with failures. See log above: $LOG_FILE"
  exit 1
fi
log "Completed successfully."
