# CarryOkie

Static GitHub Pages karaoke room prototype for design.md Option 1.

- TV/Chromecast: lyrics/video/backing track only.
- Phones: WebRTC DataChannel room RPC + live singer mic streams.
- Strict mode: manual QR/link/copy-paste offer-answer signaling; public STUN; no TURN/server.
- Room caps: 5 players, 5 active singers.
- Spotify/unlicensed media excluded.

## Run

```bash
# Development (with live reload)
npm run dev
# Opens http://localhost:5173/

# Preview production build
npm run preview
# Opens http://localhost:4173/

# Then open:
# http://localhost:5173/host/ (or :4173 for preview)
# http://localhost:5173/player/
```

## Build

```bash
npm run build
# Output in dist/ - ready for GitHub Pages
```

## Verify

```bash
npm test
npm run build
```

## MVP caveats

Cast Sender needs supported Chrome/Android browser and real Cast App ID for production receiver. Demo media are placeholders; replace with licensed Cast-supported media before real use.

## YouTube karaoke downloader

Use this only for videos/audio you have rights to download and use. The tool is intentionally simple bash and shells out only to `yt-dlp` and FFmpeg.

### Setup

macOS with Homebrew:

```bash
brew install yt-dlp ffmpeg
```

Python/pip alternative for yt-dlp:

```bash
python3 -m pip install -U "yt-dlp[default]"
```

FFmpeg is still required on `PATH` for merging/conversion.

### Input

Edit `links.txt`, one YouTube URL per line. The included `links.txt` contains the requested sample URLs.

### Run

```bash
./scripts/download_youtube_karaoke.sh links.txt
```

Outputs:

```text
downloads/mp4/      merged .mp4 files
downloads/mp3/      extracted .mp3 files
downloads/logs/     timestamped run logs
downloads/archive-mp4.txt
downloads/archive-mp3.txt
```

Two archive files are used because yt-dlp archives by video ID; a single archive would make the MP3 pass skip videos already completed by the MP4 pass.

### Exact commands run per URL

MP4:

```bash
yt-dlp \
  --continue \
  --no-abort-on-error \
  --ignore-errors \
  --download-archive downloads/archive-mp4.txt \
  --restrict-filenames \
  --windows-filenames \
  --trim-filenames 180 \
  -f 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best' \
  --merge-output-format mp4 \
  -o 'downloads/mp4/%(title).180B [%(id)s].%(ext)s' \
  'YOUTUBE_URL'
```

MP3:

```bash
yt-dlp \
  --continue \
  --no-abort-on-error \
  --ignore-errors \
  --download-archive downloads/archive-mp3.txt \
  --restrict-filenames \
  --windows-filenames \
  --trim-filenames 180 \
  -x \
  --audio-format mp3 \
  --audio-quality 0 \
  --embed-metadata \
  --embed-thumbnail \
  --convert-thumbnails jpg \
  -o 'downloads/mp3/%(title).180B [%(id)s].%(ext)s' \
  'YOUTUBE_URL'
```

## Protected/obfuscated local media import

For media you own or are licensed to use, import completed lyric videos from `downloads/mp4/` into encrypted random-looking blobs:

```bash
npm run importMedia
```

This writes:

```text
public/protected/catalog.json
public/protected/media/<random>.bin
public/cast/media/<random>.mp4
```

The browser decrypts blobs client-side using `src/mediaKey.js` and Web Crypto, then plays the resulting Blob URL on host/player/custom receiver pages. This is obfuscation only, not DRM: the key is hardcoded in the client so a determined user can recover it.

Chromecast Default Media Receiver cannot run CarryOkie decrypt code or fetch sender Blob URLs, so `npm run importMedia` also creates a clear, random-named MP4 compatibility cache under `public/cast/media/` and stores `defaultCastMediaUrl` in the protected catalog. Use `npm run exportCastMedia` to rebuild only that cast cache from the encrypted catalog.
