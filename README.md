# CarryOkie

CarryOkie is a static GitHub Pages karaoke room prototype for `design.md` Option 1: the TV/Chromecast path plays backing track/video and displays room context, while participant phones carry room controls and live singer mic streams over WebRTC.

The implementation intentionally stays static: no backend, no TURN server, no required production runtime beyond built HTML/CSS/JS assets.

## High-level project overview

| Project fact | Code evidence |
| --- | --- |
| The app has four static app pages: `/host`, `/player`, `/receiver`, and `/debug`. | `host/index.html`, `player/index.html`, `receiver/index.html`, `debug/index.html`; `src/main.ts` routes `data-page` to `hostPage`, `playerPage`, `receiverPage`, and `debugPage` from `src/app.ts`. |
| The app is built for static deployment to GitHub Pages under `dist/`. | `scripts/build.mjs` runs Vite, checks `dist/index.html`, `dist/host/index.html`, `dist/player/index.html`, `dist/receiver/index.html`, and `dist/debug/index.html`, and rejects GitHub Pages-hostile source URLs. `.github/workflows/pages.yml` deploys Pages. |
| Strict signaling uses manual QR/link/copy-paste offer-answer payloads instead of a signaling server. | `src/signaling.ts` exports `ManualQrSignalingAdapter`, `encodeSignalPayload`, `decodeSignalPayload`, `chunkToken`, `joinChunks`, `renderPayloadCard`, and `scanQrInto`; `src/webrtc.ts` uses complete ICE payloads via `waitForIceComplete`. |
| WebRTC is STUN-only with no TURN configured. | `src/webrtc.ts` sets `rtcConfig` to `stun:stun.l.google.com:19302`; `scripts/static.test.mjs` checks public STUN and no `turn:` entry. |
| Room RPC messages travel over WebRTC DataChannels. | `src/webrtc.ts` exports `PeerNode` and the `RPC` message map; `src/app.ts` handles `ROOM_HELLO`, `ROOM_STATE_SNAPSHOT`, `QUEUE_ADD_REQUEST`, `QUEUE_UPDATE_REQUEST`, `SINGER_ASSIGNED`, `PLAYBACK_SYNC`, and mic messages. |
| Host authority owns room state, queue acceptance, singer assignment, and Cast commands. | `src/app.ts` creates the host room with `makeRoom`, registers remote players, handles queue RPC requests only when `player?.isHost`, calls `assignSingers`, and sends Cast room updates. |
| Rooms are capped at five players and five active singers. | `src/state.ts` exports `MAX_PLAYERS = 5` and `MAX_SINGERS = 5`; `addPlayer`, `assignSingers`, and `queueRequest` enforce these caps; `scripts/use_cases.test.mjs` and `scripts/static.test.mjs` verify them. |
| Queue items are requested by phones and accepted/started/rejected/removed by the host. | `src/state.ts` exports `queueRequest`, `enqueueRequest`, `acceptQueue`, `rejectQueue`, `removeQueueItem`, and `nextQueuedItem`; `src/app/queueService.ts` validates paired phone queue updates; `src/app/queueView.ts` renders host and phone queue controls. |
| Phone mic publishing is gated by singer assignment and safety warnings. | `src/app.ts` blocks mic publishing unless the player is assigned as singer; `src/audio.ts` exports `singerWarning`, checks headphones/push-to-sing, and starts mic capture through `PhoneAudio.requestMic`. |
| Singer audio is sent between phones over WebRTC and is not self-monitored by default. | `src/audio.ts` defaults `localMonitorGain` to `0`; `src/webrtc.ts` adds local/remote streams; `scripts/coverage_extended.test.mjs` and `scripts/e2e_mics_speakers_cast.test.mjs` verify no self-monitor and audio routing invariants. |
| The receiver tab mirrors room state, queue, singers, lyrics/video, and can receive host-forwarded live mic audio. | `src/cast.ts` exports `receiverApp`; it renders `#room`, `#joinQr`, `#singers`, `#receiverStatus`, `#liveMics`, `#media`, `#lyrics`, and `#queue`, listens on `BroadcastChannel("carryokie.receiver")`, and handles `RECEIVER_OFFER`/`RECEIVER_ANSWER`. |
| Chromecast control uses the Cast sender SDK and a Default Media Receiver compatibility path. | `src/cast.ts` exports `CastController`, `DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845"`, `CAST_NAMESPACE`, `loadSong`, `play`, `pause`, and `seek`; `scripts/cast_ui.test.mjs` verifies Cast load/control behavior with a fake Cast SDK. |
| Phones derive lyric/video sync from Cast media status samples, not local click time. | `src/cast.ts` emits playback samples from Cast media status/current time; `src/sync.ts` derives TV media position; `src/app.ts` calls `deriveTvMediaPositionMs` for phone video and lyrics; `scripts/sync_and_webrtc.test.mjs` verifies the math. |
| Local protected media is obfuscated, not DRM. | `src/protectedMedia.ts` decrypts AES-GCM media with Web Crypto using the client key from `src/mediaKey.ts`; `scripts/import_obfuscated_media.mjs` writes encrypted blobs and `scripts/export_cast_media.mjs` writes clear Cast-compatible MP4s. |
| Spotify and unlicensed streaming APIs are excluded. | `scripts/static.test.mjs` and `scripts/import_media_e2e.test.mjs` verify catalog/source constraints; `README.md` and `design.md` document licensed/local media only. |
| The UI is responsive and code-native, with no raster art dependency. | `src/styles.css`, `index.html`, `src/app.ts`, `src/app/dom.ts`, and `src/cast.ts` define the shell, cards, phone layout, receiver TV layout, stage/soundwave visuals, and reduced-motion behavior. |

## How the implementation compares to `design.md`

`design.md` is the build spec for “Chromecast Karaoke App — Option 1.” The current repo tracks that spec closely, with automated coverage summarized in `design-coverage.json`.

| Design area | Design intent | Current implementation | Evidence / status |
| --- | --- | --- | --- |
| Static deployment | Must run from GitHub Pages with no backend. | Implemented as static Vite build output under `dist/`; source pages redirect GitHub Pages traffic into `dist/`. | `scripts/build.mjs`, page bootstrap scripts, `scripts/static.test.mjs`; `design-coverage.json` criterion 1 is `automated_full`. |
| Pages and routes | `/host`, `/player`, `/receiver`, `/debug`. | All four routes exist and are routed by `src/main.ts`. | `host/`, `player/`, `receiver/`, `debug/`, `src/main.ts`; criteria 2 and route checks pass. |
| Strict signaling | QR/link/manual offer-answer only in MVP strict mode. | Implemented with local QR rendering, payload chunking, copy/share links, scanner import, and full ICE gathering. | `src/signaling.ts`, `src/qr.ts`, `src/webrtc.ts`; criteria 6-8 are automated or partially automated. |
| Optional smooth signaling | Design labels this as optional/outside strict MVP. | No backend signaling service was added; peer-assisted relay exists after initial connection. | `src/signaling.ts` has `PeerRelaySignalingAdapter`; no server package exists. |
| Room model | Host-authoritative `RoomState`, `PlayerState`, queue, playback, mic, and Cast state. | Implemented in TypeScript interfaces and mutation helpers. | `src/state.ts`; queue and cap tests in `scripts/use_cases.test.mjs`. |
| Room limits | 5 players, 5 active singers. | Enforced in state helpers and UI copy. | `MAX_PLAYERS`, `MAX_SINGERS`; criterion 19 is `automated_full`. |
| Queue design | Phone requests, host accepts/starts, host broadcasts updates. | Implemented with validated queue service and host/phone queue controls. | `src/state.ts`, `src/app/queueService.ts`, `src/app/queueView.ts`, `src/app.ts`; criterion 10 is `automated_full`. |
| Cast / TV path | TV should play backing video/audio and show room context. | Cast controller loads media; receiver tab shows room code, QR, queue, singers, lyrics/video, status, and live mic section. | `src/cast.ts`, `receiver/index.html`; criteria 3-5 and 16 are partial/manual where real Cast hardware is required. |
| Phone mic audio | Singers publish mic with feedback-prevention guidance. | `PhoneAudio` handles mic capture, filters, push-to-sing/headphone guardrails, gains, wake lock, and WebRTC stream publishing. | `src/audio.ts`, `src/app.ts`; criteria 12, 14, and 22 are `automated_full`; criterion 13 requires physical-device manual verification. |
| Playback sync | Phones derive lyrics/video timing from actual Cast media status. | Implemented via Cast playback samples and `deriveTvMediaPositionMs`. | `src/cast.ts`, `src/sync.ts`, `src/app.ts`; criteria 17 and 21 are `automated_full`. |
| Song asset model | Licensed/local media only; manifest-driven song metadata. | Protected catalog is generated from local/imported media, encrypted for browser playback and exported clear for Default Media Receiver compatibility. | `public/protected/catalog.json`, `src/protectedMedia.ts`, `scripts/import_obfuscated_media.mjs`, `scripts/export_cast_media.mjs`; import E2E tests pass. |
| Known limitations | Real Cast and real multi-device audio require hardware/manual validation. | Documented as caveats; automated tests simulate many paths but cannot prove hardware behavior. | `design-coverage.json` marks criteria 4 and 13 `manual_hardware_required`, and several Cast/QR criteria `automated_partial`. |
| Out-of-MVP items | Backend, TURN, Spotify, remote catalog service, DRM, and production auth are out of scope. | None of those were added. Media obfuscation is documented as non-DRM. | No backend dependency in `package.json`; STUN-only `rtcConfig`; protected media section below. |

### Acceptance coverage snapshot

From `design-coverage.json`:

- 22 total MVP acceptance criteria.
- 15 `automated_full`.
- 5 `automated_partial`.
- 2 `manual_hardware_required`.
- 0 `not_started`.

The manual/hardware-required areas are real Chromecast/TV playback and physical-device listener audio verification. The partial areas generally involve real Cast discovery/session, TV visual checks, QR/link pairing on real devices, and three-browser mesh behavior.

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
# http://localhost:5173/receiver/
# http://localhost:5173/debug/
```

## Build

```bash
npm run build
# Output in dist/ - ready for GitHub Pages
```

`npm run build` also validates that the protected catalog and Default Cast media exports exist.

## Verify

```bash
npm test
npm run build
```

The test suite includes static route checks, state/use-case tests, Cast UI tests with a fake SDK, WebRTC/sync tests with fakes, protected-media tests, design coverage checks, and import-media E2E checks.

## MVP caveats

- Real Cast behavior still needs a supported Chrome/Android browser, a real Chromecast/Google TV target, and same-network discovery.
- Real live mic listening still needs physical devices/headphones/speakers to validate latency and feedback behavior.
- Strict mode uses manual QR/link/copy-paste signaling and public STUN only; networks that require TURN may fail.
- Protected local media is obfuscation, not DRM: the browser has the key in `src/mediaKey.ts`, so a determined user can recover media.
- Use only media you own or are licensed to use.

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

The browser decrypts blobs client-side using `src/mediaKey.ts` and Web Crypto, then plays the resulting Blob URL on host/player/custom receiver pages. This is obfuscation only, not DRM: the key is hardcoded in the client so a determined user can recover it.

Chromecast Default Media Receiver cannot run CarryOkie decrypt code or fetch sender Blob URLs, so `npm run importMedia` also creates a clear, random-named MP4 compatibility cache under `public/cast/media/` and stores `defaultCastMediaUrl` in the protected catalog. Use `npm run exportCastMedia` to rebuild only that cast cache from the encrypted catalog.
