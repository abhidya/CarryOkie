import fs from "node:fs";
import vm from "node:vm";
const checks = [];
const REPO_BASE = "/CarryOkie";
const GH_PAGES_HOSTNAME = "abhidya.github.io";
const REPO_BASE_NO_SLASH = REPO_BASE.replace(/^\//, "");
function loadBootstrap(page) {
  const html = fs.readFileSync(`${page}/index.html`, "utf8");
  const match = html.match(/<script data-gh-pages-bootstrap>(.*?)<\/script>/s);
  if (!match)
    throw new Error(`Missing gh-pages bootstrap script in ${page}/index.html`);
  return match[1];
}
function runBootstrap(
  page,
  {
    hostname = GH_PAGES_HOSTNAME,
    pathname = `${REPO_BASE}/${page}/`,
    search = "",
    hash = "",
  } = {},
) {
  const script = loadBootstrap(page);
  let redirectedTo = null;
  const location = {
    hostname,
    pathname,
    search,
    hash,
    origin: `https://${hostname}`,
    replace(url) {
      redirectedTo = url;
    },
  };
  vm.runInNewContext(script, { location });
  return redirectedTo;
}
const webrtc = fs.readFileSync("src/webrtc.ts", "utf8");
checks.push([
  "public STUN configured",
  webrtc.includes("stun:stun.l.google.com:19302"),
]);
checks.push([
  "manual waits complete ICE",
  webrtc.includes("waitForIceComplete") &&
    webrtc.includes("iceGatheringState") &&
    webrtc.includes("complete"),
]);
checks.push(["no TURN required", !webrtc.toLowerCase().includes("turn:")]);
const state = fs.readFileSync("src/state.ts", "utf8");
checks.push([
  "5 player cap",
  state.includes("MAX_PLAYERS = 5") &&
    state.includes("maxPlayers: MAX_PLAYERS"),
]);
checks.push(["5 singer cap", state.includes("MAX_SINGERS = 5")]);
checks.push(["queue cap 20", state.includes("MAX_QUEUE_ITEMS = 20")]);
checks.push(["crypto random UUID", state.includes("crypto.randomUUID")]);
const app = fs.readFileSync("src/app.ts", "utf8");
const appSources = [
  "src/app.ts",
  "src/app/catalog.ts",
  "src/app/dom.ts",
  "src/app/lyricsView.ts",
  "src/app/queueService.ts",
  "src/app/queueView.ts",
]
  .filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
const compactAppSources = appSources.replace(/\s+/g, "");
const hasAppSource = (needle) => appSources.includes(needle);
const hasCompactAppSource = (needle) => compactAppSources.includes(needle.replace(/\s+/g, ""));
checks.push([
  "phone offer creation has WebRTC/local HTTP guidance",
    webrtc.includes("assertWebRtcSupported") &&
    webrtc.includes("local HTTP hostnames may block offer creation") &&
    app.includes("Create phone pairing code") &&
    hasAppSource("GitHub Pages HTTPS URL"),
]);
checks.push([
  "host registers ROOM_HELLO players",
  hasCompactAppSource("msg.type === RPC.ROOM_HELLO") &&
    hasAppSource("registerRemotePlayer") &&
    hasAppSource("addPlayer(room"),
]);
checks.push([
  "host sends queue and singer Cast updates",
  app.includes("CAST_UPDATE_QUEUE_PREVIEW") && app.includes("CAST_SET_SINGERS"),
]);
checks.push([
  "host exposes progressive setup and tab-cast receiver link",
  app.includes("setupComplete") &&
    app.includes("Open TV receiver tab") &&
    app.includes("receiverUrl()") &&
    app.includes("setupReceiverBridge") &&
    app.includes("RECEIVER_PLAYBACK_SYNC") &&
    app.includes("publishReceiverCommand") &&
    app.includes("receiverPendingRenegotiate") &&
    hasCompactAppSource("song: currentSong()"),
]);
checks.push([
  "player only shows join controls before pairing",
  app.includes("playerIsJoined()") &&
    app.includes("joinRoomHtml") &&
    app.includes("After joining, queue and mic controls appear"),
]);
checks.push([
  "host exposes pause seek and remote mute controls",
  app.includes('id="castPause"') &&
    app.includes('id="castSeek"') &&
    app.includes('class="mutePlayer"') &&
    hasCompactAppSource("type: RPC.MIC_MUTED"),
]);
checks.push([
  "cast current song is one-click connect and load",
  app.includes("Cast current song to TV") &&
    app.includes("Connecting to Chromecast") &&
    app.includes("await cast.init()") &&
    app.includes("await loadCurrentSongOnTv()"),
]);
checks.push([
  "cast load autoplays TV media",
  fs.readFileSync("src/cast.ts", "utf8").includes("request.autoplay = true") &&
    fs.readFileSync("src/cast.ts", "utf8").includes("await this.play()") &&
    /media\.play\?\.|media\.play\(/.test(fs.readFileSync("src/cast.ts", "utf8")) &&
    fs
      .readFileSync("src/cast.ts", "utf8")
      .includes("Tap receiver once to start backing track/audio"),
]);
checks.push([
  "cast media origin override for Chromecast LAN access",
  app.includes('id="castOrigin"') &&
    app.includes("carryokie.castOrigin") &&
    fs
      .readFileSync("src/cast.ts", "utf8")
      .includes("rewriteCastUrlForReceiver"),
]);
checks.push([
  "phone lyric video syncs from Cast samples",
  app.includes("syncPhoneVideo") &&
    hasCompactAppSource("deriveTvMediaPositionMs(room.playbackState") &&
    app.includes("phoneVideo") &&
    app.includes("muted"),
]);
checks.push([
  "host exposes manual answer flow",
  app.includes('id="offer"') &&
    app.includes("Paste player offer/link/chunks") &&
    app.includes('id="scanOfferQr"') &&
    app.includes('id="answerOffer"') &&
    app.includes("acceptManualOffer") &&
    app.includes("Host answer"),
]);
checks.push([
  "player exposes manual answer import",
  app.includes('id="answer"') &&
    app.includes("Paste host answer/link/chunks") &&
    app.includes('id="scanAnswerQr"') &&
    app.includes('id="importAnswer"') &&
    app.includes("acceptManualAnswer"),
]);
checks.push([
  "player exposes singer slot request",
  app.includes('id="requestSinger"') &&
    hasCompactAppSource("type: RPC.SINGER_JOIN_REQUEST"),
]);
checks.push([
  "mic publishing requires singer assignment in UI",
  app.includes("Mic blocked: ask the host to assign you as a singer") &&
    app.includes("isSingerForCurrentSong"),
]);
checks.push([
  "host can start next queued song",
  app.includes("startQueueItem") &&
    app.includes('id="startNext"') &&
    (hasAppSource('item.status = "active"') ||
      hasAppSource("item.status = 'active'")) &&
    app.includes("currentQueueItemId"),
]);
checks.push([
  "queue can recover rejected items only by re-accepting before start",
  hasAppSource('class="acceptItem"') &&
    hasAppSource('class="startItem"') &&
    (hasCompactAppSource('["requested", "rejected"]') ||
      hasCompactAppSource("['requested','rejected']")) &&
    (hasCompactAppSource('queueItem.status === "queued"') ||
      hasCompactAppSource("q.status==='queued'")) &&
    app.includes("nextQueuedItem(room)"),
]);
checks.push([
  "queue start loads current song on connected Cast",
  app.includes("loadCurrentSongOnTv") &&
    app.includes("castController?.state?.().connected") &&
    app.includes("Loaded ${song.title || song.songId} on TV"),
]);
checks.push([
  "host handles PLAYER_LEFT on disconnect",
  app.includes("handlePlayerLeft") && app.includes("RPC.PLAYER_LEFT"),
]);
checks.push([
  "participant locks room on host disconnect",
  app.includes("handlePeerClosed") &&
    app.includes("lockHostLost(room)") &&
    app.includes("isHostEdge"),
]);
checks.push([
  "host tracks MIC_ENABLED from players",
  hasCompactAppSource("msg.type === RPC.MIC_ENABLED") && app.includes("micState"),
]);
checks.push([
  "host has reject/remove queue controls",
  app.includes("rejectQueue") &&
    app.includes("removeQueueItem") &&
    hasAppSource('class="rejectItem"'),
]);
checks.push([
  "phones can see and self-update titled queue",
  (hasCompactAppSource('queueHtml(room, "phone")') ||
    hasCompactAppSource("queueHtml(room,'phone')")) &&
    app.includes("QUEUE_UPDATE_REQUEST") &&
    hasAppSource("Add me as singer") &&
    (hasAppSource("songTitle(queueItem.songId)") ||
      hasAppSource("songTitle(q.songId)")),
]);
checks.push([
  "queue RPCs require paired peer identity and catalog songs",
  hasAppSource("pairedActor(remotePeerId") &&
    hasAppSource("handleQueueAddRequest") &&
    hasAppSource("Queue request song is not in this room catalog") &&
    hasAppSource('data-queue-id="${queueId}"'),
]);
checks.push([
  "phone mic exposes voice filter presets",
  app.includes('id="voicePreset"') &&
    app.includes("Autotune-style polish") &&
    fs.readFileSync("src/audio.ts", "utf8").includes("setVoicePreset") &&
    fs.readFileSync("src/audio.ts", "utf8").includes("DynamicsCompressor"),
]);
const styles = fs.readFileSync("src/styles.css", "utf8");
checks.push([
  "phone UI is mobile-first, touch sized, and non-overlapping",
  app.includes("phone-screen") &&
    app.includes("phone-hero") &&
    styles.includes("iPhone") === false &&
    /min-height:\s*var\(--tap\)/.test(styles) &&
    styles.includes("@media (max-width: 520px)") &&
    !/\.phone-hero\s*\{[^}]*position:\s*sticky/s.test(styles),
]);
checks.push([
  "player has reconnect UI",
  app.includes("Reconnect") &&
    app.includes("Forget room, start fresh") &&
    app.includes("forgetRoom"),
]);
checks.push([
  "debug page exposes connection diagnostics",
  app.includes("Connection diagnostics") &&
    app.includes("dataChannelPeerIds") &&
    app.includes("clockOffsetMs") &&
    app.includes("micPermission"),
]);
const cast = fs.readFileSync("src/cast.ts", "utf8");
checks.push([
  "Cast sync uses media status",
  cast.includes("currentTime") && cast.includes("RemotePlayerController"),
]);
checks.push([
  "protected catalog is primary media source",
  hasAppSource("loadProtectedCatalog") &&
    fs.existsSync("public/protected/catalog.json"),
]);
const protectedMediaCode = fs.readFileSync("src/protectedMedia.ts", "utf8");
checks.push([
  "local phone crypto fallback for protected media",
  protectedMediaCode.includes("hasWebCryptoAes") &&
    protectedMediaCode.includes("song.defaultCastMediaUrl") &&
    protectedMediaCode.includes("Use HTTPS/GitHub Pages"),
]);
checks.push([
  "Default Media Receiver skips custom namespace sends",
  cast.includes("DEFAULT_MEDIA_RECEIVER_APP_ID") &&
    cast.includes("usesDefaultMediaReceiver"),
]);
checks.push([
  "receiver renders join QR lyrics singers and tab-cast live mics",
  cast.includes("import { qrSvg }") &&
    cast.includes('id="joinQr"') &&
    cast.includes('id="liveMics"') &&
    cast.includes('id="receiverStatus"') &&
    cast.includes("receiverId") &&
    cast.includes("RECEIVER_OFFER") &&
    cast.includes("RECEIVER_PLAYBACK_SYNC") &&
    cast.includes("Playing all forwarded singer mics") &&
    cast.includes("liveMicStream.addTrack") &&
    cast.includes("getAudioTracks") &&
    cast.includes("CAST_SET_SINGERS") &&
    cast.includes("CAST_SYNC_PLAYBACK_STATE") &&
    cast.includes("loadLyrics") &&
    cast.includes("timeupdate"),
]);
const receiver = fs.readFileSync("receiver/index.html", "utf8");
checks.push([
  "no WebRTC in receiver page",
  !receiver.includes("RTCPeerConnection") && !receiver.includes("getUserMedia"),
]);
checks.push([
  "receiver loads CAF framework",
  receiver.includes("cast_receiver_framework.js") &&
    cast.includes("addCustomMessageListener"),
]);
const audio = fs.readFileSync("src/audio.ts", "utf8");
checks.push(["AEC warning copy", audio.includes("TV backing track")]);
checks.push(["push-to-sing support", audio.includes("pushToSing")]);
checks.push([
  "noise gate implemented",
  audio.includes("ScriptProcessor") &&
    audio.includes("gateThreshold") &&
    audio.includes("setGateEnabled"),
]);
const signaling = fs.readFileSync("src/signaling.ts", "utf8");
checks.push([
  "camera QR import exists",
  signaling.includes("BarcodeDetector") && app.includes("scanQrInto"),
]);
checks.push([
  "single visible QR constraint",
  signaling.includes("data-single-qr") &&
    !signaling.includes("map((chunk, i) => `<figure>"),
]);
checks.push([
  "ManualQrSignalingAdapter exists",
  signaling.includes("class ManualQrSignalingAdapter"),
]);
checks.push([
  "PeerRelaySignalingAdapter exists",
  signaling.includes("class PeerRelaySignalingAdapter"),
]);
const protectedCatalog = JSON.parse(
  fs.readFileSync("public/protected/catalog.json", "utf8"),
);
checks.push([
  "protected catalog has songs",
  protectedCatalog.songs?.length > 0,
]);
checks.push(["public songs folder removed", !fs.existsSync("public/songs")]);
for (const page of ["host", "player", "receiver", "debug"]) {
  checks.push([
    `${page} source redirects GitHub Pages traffic to dist`,
    runBootstrap(page, {
      pathname: `${REPO_BASE}/${page}/`,
      search: "?room=BLUECAT",
      hash: "#join",
    }) ===
      `https://${GH_PAGES_HOSTNAME}${REPO_BASE}/dist/${page}/?room=BLUECAT#join`,
  ]);
  checks.push([
    `${page} source redirects without trailing slash`,
    runBootstrap(page, {
      pathname: `${REPO_BASE}/${page}`,
      search: "?room=BLUECAT",
    }) ===
      `https://${GH_PAGES_HOSTNAME}${REPO_BASE}/dist/${page}/?room=BLUECAT`,
  ]);
  checks.push([
    `${page} source redirects with repeated slashes`,
    runBootstrap(page, { pathname: `//${REPO_BASE_NO_SLASH}///${page}//` }) ===
      `https://${GH_PAGES_HOSTNAME}${REPO_BASE}/dist/${page}/`,
  ]);
  checks.push([
    `${page} source does not redirect local dev`,
    runBootstrap(page, { hostname: "localhost", pathname: `/${page}/` }) ===
      null,
  ]);
  checks.push([
    `${page} dist path does not loop`,
    runBootstrap(page, { pathname: `${REPO_BASE}/dist/${page}/` }) === null,
  ]);
}
const distHtml = [
  "dist/host/index.html",
  "dist/player/index.html",
  "dist/receiver/index.html",
  "dist/debug/index.html",
]
  .map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""))
  .join("\n");
checks.push([
  "dist never serves TypeScript module scripts",
  !distHtml.includes("src/main.ts") && !distHtml.includes('.ts"'),
]);
let failed = 0;
for (const [name, ok] of checks) {
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log("All static checks passed");
