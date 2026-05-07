# FINAL OMX / Codex Build Spec: Chromecast Karaoke App — Option 1

## 0. Read This First

This is the final implementation handoff for **Option 1: Cast TV plays backing track/video; phones handle the live mic mix.** It incorporates the design-review fixes for manual WebRTC signaling, Chromecast-derived playback sync, acoustic echo limits, STUN/no-TURN behavior, and host-loss handling.

This document is for an AI coding agent such as OMX/Codex. Treat all **MUST**, **MUST NOT**, and **ACCEPTANCE** items as binding requirements.

The core product constraint is:

```text
TV / Chromecast = lyrics, video, backing track only
Phones = live singer mic mix
```

The app must not attempt to send live microphone streams into Chromecast for MVP.

---

## 1. Product Summary

Build a browser-based karaoke room app hosted from GitHub Pages.

A host device opens the host web app, starts a Chromecast session, and casts a custom Web Receiver to the TV. The TV displays karaoke lyrics/video and plays the backing track. Participant phones join the room by room code, QR code, or URL. Singer phones capture microphone audio. Phones exchange singer mic audio using WebRTC. Phones also show lyrics, queue, song requests, and singer status.

The strict GitHub Pages-only mode uses QR/link/manual WebRTC signaling plus peer-assisted signaling over WebRTC DataChannels after the first peer connects. An optional smoother mode may later use a tiny signaling service, but the baseline design must be possible without one.

---

## 2. Non-Negotiable Architecture Rules

1. **Chromecast is not a live mic receiver.**
   - No `RTCPeerConnection` requirement on Chromecast.
   - No phone mic streams sent to TV.
   - No attempt to make the Cast Receiver a media mixer.

2. **TV plays Cast-supported media only.**
   - Backing video/audio, lyric video, or static lyrics rendering.
   - Host controls TV through Cast Sender/Receiver messages.

3. **Phones own the live audio path.**
   - Singer phone captures mic.
   - Other phones receive mic streams through WebRTC.
   - Phones locally mix remote singer streams.

4. **GitHub Pages is the primary app host.**
   - Static app only: host page, player page, receiver page, song metadata, lyrics, small demo media.
   - No required server for strict mode.

5. **Signaling is required, but a signaling server is not required in strict mode.**
   - Strict mode: QR/link/manual offer-answer exchange + peer-assisted relay over DataChannels.
   - Optional smooth mode: tiny signaling service.

6. **Spotify must not be used as a playback/backing-track source.**
   - Use licensed, public-domain, or user-provided media only.

7. **Host is authoritative for queue and playback state.**
   - Participants request changes.
   - Host accepts/rejects and broadcasts state.

8. **MVP room size is hard-capped.**
   - Maximum 5 players.
   - Maximum 5 active singers (one per player in a full room).
   - Recommended default: 1 active singer.

9. **Manual WebRTC signaling must be non-trickle for QR/link exchange.**
   - The initial QR/link offer and answer MUST include gathered ICE candidates.
   - The app MUST wait for `iceGatheringState === "complete"` before encoding manual offer/answer payloads.

10. **Chromecast playback time is the source of truth for song position.**
   - The host MUST NOT assume playback starts when the host sends `CAST_PLAY` or `CAST_LOAD_SONG`.
   - The host MUST derive current media time from Cast Sender / Receiver media status updates and broadcast that state to phones.

11. **Active singers must prevent TV-audio bleed.**
   - Browser AEC cannot cancel backing audio played by the TV because that audio is not produced by the phone browser.
   - Active singers MUST use headphones OR the app MUST enforce push-to-sing / noise-gated capture to limit TV backing-track bleed into the mic stream.

---

## 3. Verified Platform Constraints

### 3.1 GitHub Pages

GitHub Pages is static site hosting for repository-hosted HTML, CSS, and JavaScript. It cannot run a WebSocket server, database, media server, or background process.

### 3.2 Chromecast

A browser-based Cast Sender launches and controls a Cast Receiver. Chromecast does not independently enter a room code. Browser sender support must be limited to supported Cast browsers/devices. Do not assume iPhone browser hosting/casting works.

### 3.3 WebRTC

WebRTC can exchange audio, video, and arbitrary data peer-to-peer. Initial peer setup still requires signaling: SDP offers, SDP answers, and ICE candidates must be exchanged somehow. The strict implementation uses QR/link/manual exchange and then DataChannel relay once peers are connected.

Strict mode MUST configure free public STUN servers, for example `stun:stun.l.google.com:19302`, so browsers can discover server-reflexive candidates. Strict mode MUST NOT require TURN for MVP. Connections behind symmetric NATs, restrictive cellular networks, or restrictive corporate/public Wi-Fi may fail without TURN; the UI MUST detect `RTCPeerConnection.iceConnectionState === "failed"` / `connectionState === "failed"` and show a clear network-incompatible error instead of pretending room-code join failed.

Manual QR/link pairing MUST use non-trickle ICE. Do not encode an SDP offer or answer until ICE gathering is complete and the local description contains candidates. Trickle ICE is allowed only after a real-time DataChannel relay already exists.

### 3.4 Browser Mic

Microphone capture requires user permission and a secure context. GitHub Pages HTTPS satisfies production secure-context requirements. Local development should use `localhost`.

---

## 4. Target Users and Devices

### 4.1 Host Device

Supported MVP host devices:

- Desktop Chrome / Chromium browser with Cast support.
- Android Chrome with Cast support.

Unsupported for MVP host casting:

- iOS Chrome browser.
- iOS Safari browser as a Cast Sender.

If host is on iPhone, the app may still work as a participant phone, but not as the browser Cast host.

### 4.2 Chromecast TV

The TV must run a custom Cast Receiver hosted from the static app.

TV responsibilities:

- Show room code / QR.
- Show song title / artist.
- Show lyrics/video.
- Show singer numbers/names.
- Play backing track/video.
- Receive host Cast messages.

TV non-responsibilities:

- No WebRTC mic receiving.
- No live singer mixing.
- No queue authority.
- No room discovery.

### 4.3 Participant Phones

Supported MVP participant devices:

- Android Chrome.
- iOS Safari where WebRTC/mic behavior passes tests.
- Desktop Chrome for debugging.

Participant responsibilities:

- Join room by QR/link/room code.
- Pair with host/peer using manual or peer-assisted signaling.
- Select or receive a player number.
- View lyrics.
- View queue.
- Request songs.
- Request singer slots.
- Capture mic if assigned singer.
- Receive remote singer mic streams.
- Play remote mic mix.
- Optionally play local backing track monitor when headphones are used.

---

## 5. Core Concepts and Inputs

These names are conceptual. Implement richer internal IDs where needed. All durable in-room IDs MUST be locally generated with `crypto.randomUUID()` or equivalent browser cryptographic randomness. The human room code is only a short UI validation / discovery label; it is not a secret, not an authority token, and not sufficient to connect peers by itself.

```text
roomCode
song
playerNumbers
singerNumbers
currentPlayerId
```

Example room:

```text
roomCode: BLUECAT
song: song_001
playerNumbers: 1,2,3,4,5
singerNumbers: 2,5
currentPlayerId: 2 on Player 2's phone
```

---

## 6. High-Level Architecture

```text
GitHub Pages Static Site
  /host       Host controller app
  /player     Participant phone app
  /receiver   Chromecast Web Receiver app
  /songs      Song manifests, lyrics, demo assets

Host Device
  - Owns room state
  - Owns queue
  - Controls playback
  - Starts Cast session
  - Sends Cast messages to TV
  - Participates in WebRTC mesh

Chromecast Receiver
  - Displays lyrics/video
  - Plays backing track/video
  - Shows room code / QR
  - Receives Cast commands

Participant Phones
  - Join room
  - Pair with peers using QR/link/manual signaling
  - Use WebRTC DataChannel for room RPC
  - Use WebRTC MediaStream for singer mic audio
  - Mix remote singer mic streams locally
```

---

## 7. Communication Layers

### 7.1 Host to Chromecast: Cast Control Layer

Transport:

```text
Google Cast Sender / Receiver messages
```

Purpose:

- Load song.
- Play/pause/seek TV media.
- Set singer display.
- Show queue preview.
- Show room code / QR.
- Sync visual playback state.

Required message types:

```text
CAST_LOAD_SONG
CAST_PLAY
CAST_PAUSE
CAST_SEEK
CAST_STOP
CAST_SET_SINGERS
CAST_UPDATE_QUEUE_PREVIEW
CAST_SHOW_JOIN_QR
CAST_SYNC_PLAYBACK_STATE
CAST_SHOW_ERROR
```

This layer is RPC-like command messaging.

### 7.2 Phone to Phone / Phone to Host: Room RPC Layer

Transport:

```text
WebRTC DataChannel
```

Purpose:

- Room state updates.
- Queue requests.
- Singer assignment updates.
- Mic state updates.
- Playback sync.
- Peer-assisted signaling relay.

Required message types:

```text
ROOM_HELLO
ROOM_STATE_SNAPSHOT
PLAYER_JOINED
PLAYER_LEFT
QUEUE_ADD_REQUEST
QUEUE_ACCEPTED
QUEUE_REJECTED
QUEUE_UPDATED
SINGER_JOIN_REQUEST
SINGER_ASSIGNED
SINGER_REMOVED
MIC_ENABLED
MIC_MUTED
MIC_UNMUTED
PLAYBACK_STARTED
PLAYBACK_PAUSED
PLAYBACK_SEEKED
PLAYBACK_SYNC
LATENCY_PING
LATENCY_PONG
SIGNAL_RELAY_OFFER
SIGNAL_RELAY_ANSWER
SIGNAL_RELAY_ICE
ERROR_NOTICE
```

This layer is RPC-like peer messaging.

### 7.3 Phone Mic Audio Layer

Transport:

```text
WebRTC MediaStream audio tracks
```

Purpose:

- Active singer phones send mic audio to listeners.
- Listener phones receive active singer streams.
- Phones locally mix remote streams.

Rules:

- Only active singers publish mic streams.
- Non-singers do not publish mic by default.
- A singer does not hear their own mic by default.
- Duet singers may hear each other if duet monitoring is enabled.
- Phone output is user-controlled and can be muted.

---

## 8. Strict GitHub Pages-Only Signaling Design

### 8.1 Goal

Support WebRTC pairing without any signaling server.

### 8.2 Core Idea

A server is not required for signaling if users transfer offers/answers/ICE through QR codes, URLs, copy/paste, Web Share, AirDrop, or similar out-of-band methods.

Once a peer is connected, its DataChannel can relay signaling messages for new peers.

### 8.3 Initial Pairing: Host A and Phone B

1. Host A creates room `BLUECAT`.
2. B opens `/player?room=BLUECAT` by scanning TV/host QR or manually entering code.
3. B creates a WebRTC offer intended for Host A.
4. B sets the offer as its local description.
5. B waits until `pc.iceGatheringState === "complete"`.
6. B encodes the complete offer payload, including bundled ICE candidates, as QR/link/share text.
7. Host A imports B's offer by scanning/opening/pasting.
8. Host A creates an answer.
9. Host A sets the answer as its local description.
10. Host A waits until `pc.iceGatheringState === "complete"`.
11. Host A encodes the complete answer payload, including bundled ICE candidates, as QR/link/share text.
12. B imports the answer.
13. A and B complete the peer connection.
14. A-B DataChannel opens.
15. Host sends `ROOM_STATE_SNAPSHOT` to B.

Implementation requirement: the manual QR/link path MUST NOT rely on trickle ICE. A normal `createOffer()` / `createAnswer()` result is not enough. The encoded payload MUST be based on the final `pc.localDescription` after ICE gathering is complete.

### 8.4 Adding Phone C After A-B Are Connected

1. C pairs with Host A using the same QR/link offer-answer flow.
2. A-C DataChannel opens.
3. A tells C about existing peer B.
4. C creates an offer for B and sends it to A using A-C DataChannel.
5. A relays `SIGNAL_RELAY_OFFER` to B using A-B DataChannel.
6. B creates answer and sends it back to A.
7. A relays answer to C.
8. ICE candidates are relayed over existing DataChannels.
9. B-C direct WebRTC connection forms.
10. Repeat for D/E until mesh is complete or maximum room size is reached.

For peer-assisted joins, trickle ICE MAY be used because an existing DataChannel can carry incremental `SIGNAL_RELAY_ICE` messages in real time. If a relayed peer connection fails, the UI MUST show which peer edge failed and allow retrying that edge.

### 8.5 Payload Requirements

The agent must implement signaling payload encoding with:

- JSON payload shape.
- Deflate or equivalent compression before QR/link encoding.
- Base64url or equivalent URL-safe binary encoding.
- URL fragment support so payload is not sent to any server.
- Copy/paste fallback.
- Web Share / AirDrop / text-message friendly fallback where available.
- Multi-QR or chunked payload fallback if payload is too large.
- Clear error when payload cannot be imported.
- SDP size reduction for manual payloads: strip unused video sections/codecs, prefer Opus-only audio, remove obviously redundant candidates when safe, and keep the final payload small enough to scan reliably.

Do not remove all viable candidates. If only host/local candidates exist, keep them; if server-reflexive STUN candidates exist, local candidates may be deprioritized or stripped only if testing confirms same-LAN pairing still works.

### 8.6 Strict Mode Limitations

The UI must disclose or handle:

- First pairing is manual.
- Room code alone does not create a WebRTC connection.
- A scanned room URL only opens the correct UI; it does not replace offer/answer exchange.
- Reconnect may require re-pairing.
- NAT/firewall failures may occur without TURN.
- Strict mode uses public STUN, but no TURN relay; some networks will still fail.
- QR payloads may be too large on some devices.
- Host leaving can break room authority.
- Phones may lose audio if the browser is backgrounded, the screen locks, or mobile power saving suspends Web Audio/WebRTC.

---

## 9. Optional Smooth Signaling Mode

This is not required for strict GitHub Pages-only MVP but should be architecturally pluggable.

Optional service responsibilities:

- Create/join room.
- Track temporary peer IDs.
- Relay WebRTC offers.
- Relay WebRTC answers.
- Relay ICE candidates.
- Expire inactive rooms.

The optional service must not:

- Carry audio.
- Mix audio.
- Store user accounts.
- Store songs.
- Own durable queue state.

The codebase should define a `SignalingAdapter` interface with implementations:

```text
ManualQrSignalingAdapter
PeerRelaySignalingAdapter
OptionalRemoteSignalingAdapter
```

---

## 10. State Model

### 10.1 RoomState

Fields:

```text
roomId
roomCode
hostPeerId
hostPlayerId
createdAt
playerCount
maxPlayers
currentSongId
currentQueueItemId
playbackState
players
queue
castState
meshState
```

### 10.2 PlayerState

Fields:

```text
peerId
playerId
playerNumber
displayName
role
isHost
isSingerForCurrentSong
micState
monitorState
connectionState
lastSeenAt
```

Roles:

```text
host
participant
singer
listener
```

### 10.3 SongManifest

Fields:

```text
songId
title
artist
durationMs
lyricsJsonUrl
lyricsVttUrl
castMediaUrl
phoneBackingAudioUrl
thumbnailUrl
licenseInfo
```

### 10.4 QueueItem

Fields:

```text
queueItemId
songId
singerNumbers
requestedByPlayerId
status
createdAt
acceptedAt
```

Statuses:

```text
requested
queued
playing
done
skipped
rejected
```

### 10.5 PlaybackState

Fields:

```text
songId
status
startedAtHostMs
pausedAtSongMs
seekOffsetMs
playbackRate
lastUpdatedAtHostMs
```

Statuses:

```text
idle
loading
countdown
playing
paused
ended
error
```

### 10.6 MicState

Fields:

```text
permissionState
enabled
muted
publishing
receivingPeerIds
remoteGain
localMonitorGain
backingGain
masterGain
```

### 10.7 CastState

Fields:

```text
available
connected
receiverReady
currentMediaLoaded
lastCommandAt
lastReceiverAckAt
error
```

---

## 11. Room Authority and Conflict Rules

Host is authoritative for:

- Queue acceptance.
- Playback state.
- Singer assignment.
- Current song.
- Cast commands.
- Room capacity.

Participants may request:

- Add song.
- Join as singer.
- Leave as singer.
- Enable mic if assigned.

Participants must not directly mutate shared room state. They send requests to host.

If host disconnects:

- MVP behavior: room enters `host_lost` state.
- Existing phone-to-phone WebRTC audio/data edges MAY remain active temporarily if the mesh is already established.
- All queue mutation, singer assignment, Cast controls, and playback authority MUST lock immediately.
- Display prompt: “Host disconnected. Audio between already-connected phones may continue, but TV and queue controls are locked. Create a new room to continue.”
- Host election is future work, not required for MVP.
- Do not silently elect a new host in MVP.

---

## 12. Queue Design

### 12.1 Normal Flow

1. Participant selects song.
2. Participant selects singer number(s).
3. Participant sends `QUEUE_ADD_REQUEST` to host.
4. Host UI shows pending request.
5. Host accepts or rejects.
6. Host broadcasts `QUEUE_UPDATED`.
7. Host sends `CAST_UPDATE_QUEUE_PREVIEW` to Chromecast.

### 12.2 QR Fallback Flow

If participant is not connected by DataChannel:

1. Participant creates queue request URL/QR.
2. Host scans/imports request.
3. Host accepts/rejects locally.
4. Host broadcasts once connected peers exist.

### 12.3 Queue Constraints

MVP queue constraints:

- Max 20 queue items.
- Max 5 singers per song (one per player).
- Host can delete/reorder/skip.
- Participant cannot reorder queue.

---

## 13. Lyrics and Playback Sync

### 13.1 Principle

Do not stream every lyric update.

Host broadcasts only:

```text
songId
startedAtHostMs
playbackStatus
seekOffsetMs
playbackRate
tvMediaTimeMs
tvMediaTimeSampledAtHostMs
```

`startedAtHostMs`, `seekOffsetMs`, and `tvMediaTimeMs` MUST be derived from actual Chromecast media status updates, not from the local time when the host clicked play.

Each device derives:

```text
current song position
current lyric line
next lyric line
progress percent
current line singer
```

### 13.2 Clock Offset Estimate

Phones estimate host clock offset using DataChannel ping/pong:

```text
client sends LATENCY_PING at client time t0
host responds with host time h1
client receives at client time t2
rtt = t2 - t0
estimatedHostNow = h1 + rtt / 2
hostOffset = estimatedHostNow - t2
```

Use this for lyric display and phone monitor alignment.

Critical Cast sync requirement:

- The host MUST NOT assume playback starts immediately when it sends a Cast command.
- The host MUST listen to Cast `RemotePlayerController` / media status update events, or receiver `MediaSession` status messages, and treat the reported current media time as the source of truth.
- The host MUST broadcast `PLAYBACK_SYNC` using the sampled TV media position and the host timestamp when that sample was observed.
- Phones derive lyric position from the host-clock-adjusted TV media sample.
- If Cast status is unavailable or stale, phones MUST show sync degraded / waiting for TV status rather than confidently advancing from a guessed start time.

### 13.3 Manual Sync Controls

Implement manual adjustment:

```text
lyrics earlier -250ms
lyrics later +250ms
reset sync
```

### 13.4 Acceptance Target

MVP target:

- Lyrics on phones within ~500 ms of TV display is acceptable.
- Phone mic latency is best effort; do not claim pro karaoke latency.

---

## 14. Audio Design

### 14.1 TV Audio

TV plays:

- Backing track audio.
- Karaoke video audio.

TV does not play:

- Live singer mic audio.

### 14.2 Phone Audio Defaults

Default phone audio behavior:

- Listener phones: remote singer mic mix only.
- Singer phones: remote other-singer mics only, no self-monitor by default.
- Backing track monitor disabled by default unless user enables headphone monitor.

### 14.3 Phone Headphone Monitor Mode

If user enables headphone monitor:

- Phone may play local backing track monitor.
- Phone may mix remote singer mic streams.
- UI must warn: “Use headphones to prevent echo.”
- The app MUST require an explicit tap acknowledgement before enabling any phone speaker output while mic publishing is active.
- The app SHOULD default to headphones-required copy for singers: “Your phone mic can hear the TV. Use headphones or push-to-sing to avoid sending the backing track to everyone.”

### 14.4 Audio Controls

Required controls:

```text
mute all phone audio
remote mic gain
backing monitor gain
master gain
mute own mic
push-to-sing toggle
headphone monitor toggle
```

### 14.5 Capture Constraints

When requesting mic, prefer constraints:

```text
echoCancellation: true
noiseSuppression: true
autoGainControl: true by default, configurable later
```

Important: these browser constraints are helpful for voice cleanup but do not solve TV backing-track bleed. AEC can only cancel audio that the local browser is rendering as a known reference, not unrelated audio physically playing from the TV.

### 14.6 Feedback Prevention

MUST:

- Do not play user’s own mic locally by default.
- Warn before enabling phone speaker output while mic is active.
- Allow host to mute active singer.
- Allow only assigned singers to publish mic by default.
- Require headphones OR push-to-sing OR an aggressive noise gate for active singers.
- Show a visible “TV bleed risk” warning whenever mic publishing is active and headphone mode is not confirmed.
- Provide a push-to-sing mode where the mic is transmitted only while a large on-screen button is held.
- Provide a configurable input gate for MVP hardening, even if it is simple.

MUST NOT:

- Claim browser AEC will cancel the Chromecast/TV backing track.
- Route local phone backing monitor to speaker while mic publishing without a warning and explicit user action.
- Auto-enable singer self-monitoring.

### 14.7 Mobile Browser Awake Requirement

Mobile browsers may suspend WebRTC, Web Audio, timers, or audio output when the device is locked, backgrounded, or power-saving. MVP MUST include one of these mitigations:

- A clear in-room warning: “Keep this phone unlocked and this tab open during the song.”
- A wake-lock attempt using the Screen Wake Lock API where supported.
- A fallback keep-awake strategy, such as a silent/hidden looping video element only where allowed by browser policy.

If wake lock fails or is unsupported, show a non-blocking warning in `/player` and `/debug`.

---

## 15. Song Asset Model

### 15.1 Allowed Media Sources

Allowed:

- Public-domain tracks.
- Licensed karaoke tracks.
- User-provided files where user has rights.
- Repo demo assets with clear license.

Not allowed for MVP:

- Spotify playback as backing track.
- Spotify synchronized with video/lyrics.
- Spotify mixed with mic audio.
- Unlicensed commercial songs committed to repo.

### 15.2 Repo Structure

Recommended static asset structure:

```text
/public/songs/catalog.json
/public/songs/song_001/manifest.json
/public/songs/song_001/lyrics.json
/public/songs/song_001/lyrics.vtt
/public/songs/song_001/video.mp4
/public/songs/song_001/backing.mp3
/public/songs/song_001/thumbnail.jpg
```

### 15.3 Song Manifest Example Shape

```json
{
  "songId": "song_001",
  "title": "Demo Song",
  "artist": "Demo Artist",
  "durationMs": 180000,
  "lyricsJsonUrl": "/songs/song_001/lyrics.json",
  "lyricsVttUrl": "/songs/song_001/lyrics.vtt",
  "castMediaUrl": "/songs/song_001/video.mp4",
  "phoneBackingAudioUrl": "/songs/song_001/backing.mp3",
  "thumbnailUrl": "/songs/song_001/thumbnail.jpg",
  "licenseInfo": "public-domain-or-project-owned-demo"
}
```

---

## 16. App Pages and Routes

### 16.1 `/host`

Host controller.

Responsibilities:

- Create room.
- Show room code.
- Start Cast.
- Manage queue.
- Manage singers.
- Start/pause/seek songs.
- Import QR/link offers.
- Generate answer QR/link.
- Display connected peers.
- Show debug state.

### 16.2 `/player`

Participant app.

Responsibilities:

- Join by room code.
- Select player number.
- Create offer QR/link.
- Import answer QR/link.
- Show lyrics.
- Show queue.
- Request song.
- Request singer slot.
- Capture mic if assigned.
- Play phone monitor mix.

### 16.3 `/receiver`

Custom Cast Receiver app.

Responsibilities:

- Render TV UI.
- Load Cast-supported media.
- Render lyrics/video.
- Show QR/room code.
- Show singers/queue preview.
- Send acknowledgements to host where supported.

### 16.4 `/debug`

Optional but strongly recommended.

Show:

- Peer IDs.
- DataChannel state.
- ICE state.
- Mic permission state.
- Cast state.
- Clock offset.
- Current room state JSON.

---

## 17. Recommended Tech Stack

Use this unless repository constraints require otherwise:

```text
Vite
TypeScript
React
Web Audio API
WebRTC browser APIs
Google Cast Web Sender SDK
Cast Application Framework for receiver
qrcode generation library
compression library for QR payloads
```

Do not introduce heavy backend frameworks for strict mode.

---

## 18. Implementation Milestones

### Milestone 1: Static App Shell

Deliver:

- Vite/TypeScript app.
- `/host`, `/player`, `/receiver` routes.
- GitHub Pages build config.
- Demo song catalog and lyrics.
- Basic lyric renderer.

Acceptance:

- App builds to static files.
- Routes work from GitHub Pages base path.
- Demo song loads from static manifest.
- Lyrics render against local time.

### Milestone 2: Chromecast TV Path

Deliver:

- Custom receiver page.
- Host Cast Sender integration.
- Configurable Cast App ID.
- TV can load and play demo media.
- Host can play/pause/seek.

Acceptance:

- Host on supported browser launches receiver.
- TV displays room code/QR.
- TV plays backing video/audio.
- TV does not require WebRTC.

### Milestone 3: Manual QR WebRTC Pairing

Deliver:

- Offer creation.
- Answer creation.
- Wait-for-complete ICE gathering before manual QR/link encoding.
- Public STUN configuration.
- QR/link/share import/export.
- Compression + base64url payload encoding.
- Copy/paste and chunked-payload fallback.
- DataChannel between host and one participant.
- Room state snapshot over DataChannel.
- ICE failure UI.

Acceptance:

- Player B pairs with Host A without any server.
- Manual QR/link payloads are generated only after `iceGatheringState === "complete"`.
- Host sees B connected.
- B receives room state.
- B can send a test RPC message.
- If ICE fails, the UI says the network may require TURN / different Wi-Fi instead of blaming the room code.

### Milestone 4: Peer-Assisted Mesh Expansion

Deliver:

- Add third peer C.
- Relay C↔B signaling over A’s existing DataChannels.
- Complete direct C↔B connection.
- Room mesh state UI.

Acceptance:

- A, B, C form direct DataChannels.
- A can relay signaling for new peers.
- No external signaling service is used.

### Milestone 5: Queue and Singer RPC

Deliver:

- Queue request UI.
- Host accept/reject.
- Queue broadcast.
- Singer assignment.
- Chromecast queue preview update.

Acceptance:

- Participant requests a song.
- Host accepts.
- All connected phones show updated queue.
- TV shows queue preview.

### Milestone 6: Mic Streaming

Deliver:

- Mic permission flow.
- Active singer mic publishing.
- Remote mic receiving.
- Local phone mixer.
- Mute/gain controls.

Acceptance:

- Player 2 publishes mic.
- Other phones hear Player 2.
- Player 2 does not hear self by default.
- Host can mute Player 2.

### Milestone 7: Five-Person Room

Deliver:

- Hard room cap.
- Five player slots.
- Up to five active singers (full room).
- Peer connection diagnostics.
- Reconnect UI.

Acceptance:

- Host + four participants can join.
- One or two singers can publish mic.
- Listener phones hear active singers.
- TV continues playing backing track/video only.

### Milestone 8: Sync and Hardening

Deliver:

- Playback sync messages.
- Clock offset estimate.
- Cast media status sampling from `RemotePlayerController` / receiver media status.
- Manual sync controls.
- Error handling.
- Debug panel.
- Wake-lock / keep-awake warning.

Acceptance:

- Host starts song.
- Phones derive lyric timing from actual TV media position, not guessed local start time.
- Phones show same lyric line within target tolerance.
- Refreshing a participant shows reconnect/re-pair UI.
- Cast disconnect shows useful host error.
- If Cast media status is stale, the UI indicates sync degradation.

---

## 19. Acceptance Criteria for MVP

MVP is accepted only when all of these pass:

1. Static app deploys to GitHub Pages.
2. Host opens `/host` on desktop/Android Chrome.
3. Host starts Cast session to Chromecast.
4. TV loads `/receiver` and plays a demo backing video/audio.
5. TV shows room code and QR.
6. Participant pairs with host using QR/link only, no server.
7. Manual offer/answer payloads wait for complete ICE gathering before QR/link generation.
8. Host and participant establish WebRTC DataChannel.
9. Third phone joins using peer-assisted signaling relay.
10. Queue request flows participant → host → all peers.
11. Host assigns singer.
12. Singer enables mic with explicit permission.
13. Listener phone hears singer mic over WebRTC.
14. Singer does not hear own mic by default.
15. TV never receives live mic audio.
16. TV continues to show lyrics/video/backing track.
17. Phones mirror lyrics from host playback state.
18. Spotify is not used.
19. Room is capped to 5 players and 5 active singers.
20. Strict mode configures public STUN and displays clear ICE failure errors when P2P cannot connect.
21. Phones derive lyric timing from actual Cast media status, not from guessed host click time.
22. Active singers get headphone / push-to-sing / TV-bleed warnings before publishing mic.
---

## 20. Known Limitations to Display or Document

- TV does not play singer vocals in Option 1.
- Phone monitor audio is best with headphones.
- Active singer phones can pick up TV backing audio unless headphones, push-to-sing, or gating is used.
- Pure GitHub Pages-only pairing is manual and not seamless.
- Some networks may block WebRTC direct connections without TURN.
- Public STUN helps NAT traversal but does not guarantee connectivity.
- QR payloads can become large when full ICE candidates are bundled.
- iPhone browser cannot be assumed to host Cast.
- Mobile browser audio behavior varies.
- Phones may disconnect or stop audio when locked/backgrounded.
- Existing phone mesh audio may survive host loss, but queue and TV control lock.
- Room dies or becomes limited if host disconnects.
- Not a commercial karaoke catalog.

---

## 21. Future Work Explicitly Out of MVP

- TURN server configuration for higher reliability.
- Optional remote signaling service for smoother room-code auto-join.
- SFU/media server.
- Server-side audio mixer.
- TV live vocal output.
- Native iOS/Android sender apps.
- Song upload pipeline.
- Vocal removal.
- Scoring.
- Recording.
- User accounts.
- Payments.
- Licensed song catalog integration.

---

## 22. Agent Implementation Instructions

When implementing, do the following:

1. Build the strict GitHub Pages-only path first.
2. Use QR/link/manual signaling first; do not add a server unless asked.
3. Make the signaling system pluggable for future remote signaling.
4. Keep Cast receiver separate from WebRTC code.
5. Keep all shared state serializable.
6. Keep room authority host-owned.
7. Add debug UI early.
8. Add explicit UI copy that TV vocals are not supported in MVP.
9. Add headphone warning before phone monitor backing track can play.
10. Refuse to wire mic streams to Chromecast in MVP.
11. For manual QR/link signaling, always wait for complete ICE gathering before encoding offers/answers.
12. Configure public STUN and handle no-TURN ICE failures explicitly.
13. Use Cast media status as the source of truth for playback position.
14. Do not rely on browser AEC to remove TV backing-track bleed.
15. Add push-to-sing, noise gate, or headphones-required UI for active singers.
16. Generate room/player/peer IDs with `crypto.randomUUID()`.

If implementation pressure appears to require Chromecast receiving live mic audio, stop and redesign. That violates Option 1.

---

## 23. Reference Notes for Agent

- GitHub Pages hosts static files only.
- Cast Web Sender/Receiver is the TV-control path.
- Cast receiver should play supported media formats, not arbitrary live WebRTC mic streams.
- WebRTC carries phone-to-phone mic audio and DataChannel messages.
- WebRTC requires signaling, but strict mode uses QR/link/manual and peer-assisted relay instead of a server.
- Manual QR/link WebRTC signaling must be non-trickle and must wait for ICE gathering completion before payload generation.
- Public STUN is required for practical NAT traversal; TURN is future work and not part of strict MVP.
- `getUserMedia()` requires user permission and secure context.
- `RTCDataChannel` carries arbitrary peer-to-peer room messages.
- Spotify is excluded because the required karaoke use case needs visual synchronization and overlapping/mixing with other audio.
