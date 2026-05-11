import {
  makePlayer,
  makeRoom,
  addPlayer,
  saveRoom,
  loadRoom,
  type QueueItem,
  queueRequest,
  acceptQueue,
  rejectQueue,
  removeQueueItem,
  nextQueuedItem,
  assignSingers,
  MAX_SINGERS,
  lockHostLost,
  normalizeDisplayName,
  makePeerJsRoomCode,
  PEERJS_ROOM_ALPHABET,
  PEERJS_ROOM_LENGTH,
} from "./state.ts";
import {
  PeerNode,
  RPC,
  assertWebRtcSupported,
  rtcConfig,
  waitForIceComplete,
} from "./webrtc.ts";
import {
  renderPayloadCard,
  decodeSignalPayload,
  scanQrInto,
} from "./signaling.ts";
import { PhoneAudio, singerWarning } from "./audio.ts";
import { CastController, receiverApp } from "./cast.ts";
import { deriveTvMediaPositionMs } from "./sync.ts";
import {
  resolvePlayableMediaUrl,
  isProtectedMedia,
} from "./protectedMedia.ts";
import { $, commonChrome, escapeHtml, logToPage } from "./app/dom.ts";
import {
  formatSongTitle,
  loadSongCatalog,
} from "./app/catalog.ts";
import { lyricView } from "./app/lyricsView.ts";
import {
  applyPhoneQueueUpdate as applyPhoneQueueUpdateToRoom,
  handleQueueAddRequest as handleQueueAddRequestForRoom,
  pairedActor as findPairedActor,
} from "./app/queueService.ts";
import { queueHtml as renderQueueHtml } from "./app/queueView.ts";
import {
  PeerJsRoomTransport,
  type RoomMessage,
} from "./peer/PeerJsRoomTransport.ts";
let room = loadRoom();
let player = JSON.parse(localStorage.getItem("carryokie.player") || "null");
let peerNode;
let peerJsTransport: PeerJsRoomTransport | null = null;
let audio;
let catalog = [];
let castController;
let castListenersAttached = false;
let phoneSyncTimer = null;
let receiverChannel;
let receiverPc;
let receiverSessionId = null;
let receiverAudioDirty = false;
let receiverNegotiating = false;
let receiverPendingRenegotiate = false;
const receiverStreams = new Set();
function persist() {
  if (room) saveRoom(room);
  if (player) localStorage.setItem("carryokie.player", JSON.stringify(player));
}
function log(msg) {
  logToPage(msg);
}
async function loadCatalog() {
  catalog = await loadSongCatalog(import.meta.url);
}
function unlockPhoneAudio() {
  audio?.init().catch((error) => {
    log(error?.message || "Phone audio unlock was ignored by the browser.");
  });
}
function setupPeer(localPeerId) {
  peerNode = new PeerNode(localPeerId);
  peerNode.addEventListener("open", (e) => {
    log(`DataChannel open: ${e.detail.remotePeerId}`);
    peerNode.send(e.detail.remotePeerId, {
      type: RPC.ROOM_HELLO,
      peerId: localPeerId,
      player,
    });
    if (player?.isHost)
      peerNode.send(e.detail.remotePeerId, {
        type: RPC.ROOM_STATE_SNAPSHOT,
        room,
      });
  });
  peerNode.addEventListener("close", (e) =>
    handlePeerClosed(e.detail.remotePeerId),
  );
  peerNode.addEventListener("connection", (e) => {
    if (e.detail.state === "disconnected" || e.detail.state === "failed")
      handlePeerClosed(e.detail.remotePeerId);
  });
  peerNode.addEventListener("message", (e) =>
    handleRpc(e.detail.remotePeerId, e.detail.msg),
  );
  peerNode.addEventListener("error", (e) => log(e.detail.message));
  peerNode.addEventListener("track", (e) => {
    audio?.addRemoteStream(e.detail.stream, e.detail.remotePeerId);
    if (player?.isHost) {
      peerNode.relayRemoteStream(e.detail.remotePeerId, e.detail.stream);
      receiverAudioDirty = true;
      negotiateReceiverAudio().catch((err) => log(err.message));
    }
  });
  setInterval(() => peerNode?.pingAll(), 5000);
  return peerNode;
}
function isHostEdge(remotePeerId) {
  return (
    remotePeerId === "host" ||
    (!!room?.hostPeerId && remotePeerId === room.hostPeerId)
  );
}
function handlePeerClosed(remotePeerId) {
  if (player?.isHost) {
    handlePlayerLeft(remotePeerId);
    return;
  }
  if (room && isHostEdge(remotePeerId)) {
    lockHostLost(room);
    persist();
    log(
      room.hostLostMessage ||
        "Host disconnected. TV and queue controls are locked. Create a new room to continue.",
    );
    renderPlayer($("#main"));
  }
}
function handlePlayerLeft(remotePeerId) {
  if (!player?.isHost || !room) return;
  const target = room.players.find((p) => p.peerId === remotePeerId);
  if (!target) return;
  target.connectionState = "disconnected";
  target.lastSeenAt = Date.now();
  peerNode.send(remotePeerId, { type: RPC.PLAYER_LEFT, peerId: remotePeerId });
  peerNode.broadcast({ type: RPC.PLAYER_LEFT, peerId: remotePeerId, room });
  log(`Player #${target.playerNumber} ${target.displayName} disconnected.`);
  persist();
  renderHost($("#main"));
}
function broadcastRoom(type = RPC.ROOM_STATE_SNAPSHOT) {
  peerNode?.broadcast({ type, room });
}
function receiverUrl() {
  return new URL(
    `../receiver/?room=${encodeURIComponent(room?.roomCode || "")}`,
    location.href,
  ).toString();
}
function receiverPayload() {
  return {
    roomCode: room?.roomCode,
    queue: queuePreview(),
    singers: room?.players?.filter((p) => p.isSingerForCurrentSong) || [],
    song: currentSong(),
    playbackState: room?.playbackState,
  };
}
function publishReceiverState() {
  receiverChannel?.postMessage?.({
    type: "RECEIVER_STATE",
    payload: receiverPayload(),
  });
}
function publishReceiverPlayback(sample = room?.playbackState) {
  receiverChannel?.postMessage?.({
    type: "RECEIVER_PLAYBACK_SYNC",
    payload: sample,
  });
}
function publishReceiverCommand(type, payload = {}) {
  receiverChannel?.postMessage?.({ type, payload });
}
function sendCastRoomUpdate(type, payload = {}) {
  castController?.sendSafe?.(type, payload);
  publishReceiverState();
}
function resetReceiverAudio(receiverId) {
  receiverPc?.close?.();
  receiverPc = null;
  receiverStreams.clear();
  receiverSessionId = receiverId;
  receiverAudioDirty = true;
  receiverPendingRenegotiate = false;
}
async function negotiateReceiverAudio() {
  if (!player?.isHost || !receiverPc || !peerNode || !receiverAudioDirty)
    return;
  if (receiverNegotiating || receiverPc.signalingState !== "stable") {
    receiverPendingRenegotiate = true;
    return;
  }
  receiverNegotiating = true;
  receiverPendingRenegotiate = false;
  receiverAudioDirty = false;
  let offerSent = false;
  try {
    for (const { stream } of peerNode.relayedStreams || []) {
      if (receiverStreams.has(stream)) continue;
      receiverStreams.add(stream);
      stream.getTracks().forEach((t) => receiverPc.addTrack(t, stream));
    }
    if (!receiverStreams.size) return;
    const offer = await receiverPc.createOffer({ offerToReceiveAudio: false });
    await receiverPc.setLocalDescription(offer);
    await waitForIceComplete(receiverPc);
    receiverChannel?.postMessage({
      type: "RECEIVER_OFFER",
      receiverId: receiverSessionId,
      description: receiverPc.localDescription,
    });
    offerSent = true;
  } finally {
    if (!offerSent) receiverNegotiating = false;
  }
}
function setupReceiverBridge() {
  if (receiverChannel || typeof BroadcastChannel === "undefined") return;
  receiverChannel = new BroadcastChannel("carryokie.receiver");
  receiverChannel.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (msg.type === "RECEIVER_READY") {
      const receiverId = msg.receiverId || "receiver";
      publishReceiverState();
      if (receiverSessionId !== receiverId) resetReceiverAudio(receiverId);
      if (!receiverPc) {
        receiverPc = new RTCPeerConnection(rtcConfig);
        receiverPc.oniceconnectionstatechange = () =>
          log(`Receiver tab audio ${receiverPc.iceConnectionState}`);
      }
      negotiateReceiverAudio().catch((e) => log(e.message));
    }
    if (
      msg.type === "RECEIVER_ANSWER" &&
      receiverPc &&
      (!msg.receiverId || msg.receiverId === receiverSessionId)
    ) {
      await receiverPc
        .setRemoteDescription(msg.description)
        .catch((e) => log(e.message));
      receiverNegotiating = false;
      if (receiverPendingRenegotiate || receiverAudioDirty)
        negotiateReceiverAudio().catch((e) => log(e.message));
    }
  };
}
function songTitle(songId) {
  const song = catalog.find((s) => s.songId === songId);
  return formatSongTitle(song, songId);
}
function queueSingerNames(queueItem: QueueItem) {
  return queueItem.singerNumbers.map(
    (singerNumber) =>
      room?.players?.find((p) => p.playerNumber === singerNumber)?.displayName ||
      `#${singerNumber}`,
  );
}
function queuePreview() {
  return room.queue.map((q) => ({
    ...q,
    title: songTitle(q.songId),
    singerNames: queueSingerNames(q),
  }));
}
function queueHtml(r, mode = "host") {
  return renderQueueHtml(r, mode, songTitle, player);
}
function publishQueueUpdate() {
  broadcastRoom(RPC.QUEUE_UPDATED);
  sendCastRoomUpdate("CAST_UPDATE_QUEUE_PREVIEW", { queue: queuePreview() });
  persist();
}
function attachCastListeners(cast) {
  if (castListenersAttached) return;
  castListenersAttached = true;
  cast.addEventListener("state", (e) => {
    const s = e.detail;
    const el = $("#castStatus");
    if (el)
      el.textContent = s.connected
        ? "Connected to TV"
        : s.available
          ? "Available, click to connect"
          : "Chromecast not available";
  });
  cast.addEventListener("error", (e) => log(e.detail.message));
  cast.addEventListener("playbackSample", (e) => {
    room.playbackState = {
      ...room.playbackState,
      ...e.detail,
      syncDegraded: false,
      lastUpdatedAtHostMs: Date.now(),
    };
    peerNode?.broadcast({
      type: RPC.PLAYBACK_SYNC,
      sample: room.playbackState,
    });
    publishReceiverPlayback(room.playbackState);
    persist();
  });
}
function setOwnMicMuted(muted) {
  audio?.setMicMuted(muted);
  if (player?.micState) {
    player.micState = { ...player.micState, muted };
    persist();
  }
  const status = $("#micStatus");
  if (status) status.textContent = muted ? "Mic muted." : "Mic live.";
  peerNode?.broadcast({
    type: muted ? RPC.MIC_MUTED : RPC.MIC_UNMUTED,
    playerId: player?.playerId,
  });
}
function registerRemotePlayer(remotePeerId, remotePlayer) {
  if (!player?.isHost || !remotePlayer || !room) return false;
  const existing = room.players.find(
    (p) =>
      p.peerId === remotePlayer.peerId || p.playerId === remotePlayer.playerId,
  );
  if (existing) {
    const nextDisplayName = normalizeDisplayName(
      remotePlayer.displayName,
      existing.displayName || "Guest",
    );
    const changed =
      existing.displayName !== nextDisplayName ||
      existing.connectionState !== "connected" ||
      existing.peerId !== (remotePlayer.peerId || remotePeerId);
    existing.displayName = nextDisplayName;
    existing.peerId = remotePlayer.peerId || remotePeerId;
    existing.connectionState = "connected";
    existing.lastSeenAt = Date.now();
    return changed;
  }
  addPlayer(room, {
    ...remotePlayer,
    peerId: remotePlayer.peerId || remotePeerId,
    displayName: normalizeDisplayName(remotePlayer.displayName, "Guest"),
    role: "participant",
    isHost: false,
    connectionState: "connected",
    lastSeenAt: Date.now(),
  });
  return true;
}
function currentSong() {
  return catalog.find((s) => s.songId === room?.currentSongId) || catalog[0];
}
function castOrigin() {
  return localStorage.getItem("carryokie.castOrigin") || location.origin;
}
function saveCastOrigin() {
  const input = $("#castOrigin");
  if (input?.value)
    localStorage.setItem(
      "carryokie.castOrigin",
      input.value.replace(/\/$/, ""),
    );
}
function showCastControls() {
  ["castLoadBtn", "castPlayBtn", "castPause", "castSeek"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.style.display = "inline";
  });
}
async function loadCurrentSongOnTv() {
  const song = currentSong();
  if (!castController || !song) return false;
  try {
    await castController.loadSong(song, room);
    castController.sendSafe("CAST_SHOW_JOIN_QR", { roomCode: room.roomCode });
    publishReceiverState();
    showCastControls();
    $("#castStatus") &&
      ($("#castStatus").textContent =
        `Loaded ${song.title || song.songId} on TV`);
    log(`TV media loaded: ${song.title || song.songId}`);
    return true;
  } catch (e) {
    log(e.message);
    return false;
  }
}
function startQueueItem(item) {
  if (!item) {
    log("Queue is empty. Add or accept a song first.");
    return;
  }
  if (item.status !== "queued") {
    log("Accept the queue item before starting it.");
    return;
  }
  room.currentSongId = item.songId;
  room.currentQueueItemId = item.queueItemId;
  room.queue.forEach((q) => {
    if (q.status === "active" && q.queueItemId !== item.queueItemId)
      q.status = "ended";
  });
  item.status = "active";
  if (!item.acceptedAt) item.acceptedAt = Date.now();
  const singerIds = item.singerNumbers
    .map((n) => room.players.find((p) => p.playerNumber === n)?.playerId)
    .filter(Boolean);
  assignSingers(room, singerIds);
  room.playbackState = {
    ...room.playbackState,
    songId: item.songId,
    status: "loading",
    startedAtHostMs: null,
    pausedAtSongMs: 0,
    seekOffsetMs: 0,
    tvMediaTimeMs: 0,
    tvMediaTimeSampledAtHostMs: null,
    paused: true,
    syncDegraded: true,
    lastUpdatedAtHostMs: Date.now(),
  };
  broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
  sendCastRoomUpdate("CAST_UPDATE_QUEUE_PREVIEW", { queue: queuePreview() });
  sendCastRoomUpdate("CAST_SET_SINGERS", {
    players: room.players.filter((p) => p.isSingerForCurrentSong),
  });
  persist();
  publishReceiverState();
  if (castController?.state?.().connected) loadCurrentSongOnTv();
}
function pairedActor(remotePeerId, msgPlayerId) {
  return findPairedActor(room, remotePeerId, msgPlayerId);
}
function handleQueueAddRequest(remotePeerId, msg) {
  handleQueueAddRequestForRoom(room, catalog, remotePeerId, msg);
}
function applyPhoneQueueUpdate(remotePeerId, msg) {
  applyPhoneQueueUpdateToRoom(room, remotePeerId, msg);
}
function handleRpc(remotePeerId, msg) {
  log(`${msg.type} from ${remotePeerId}`);
  if (msg.type === RPC.ROOM_HELLO && player?.isHost) {
    const changed = registerRemotePlayer(remotePeerId, msg.player);
    peerNode.send(remotePeerId, { type: RPC.ROOM_STATE_SNAPSHOT, room });
    if (changed) {
      broadcastRoom();
      persist();
      renderHost($("#main"));
    }
  }
  if (msg.type === RPC.ROOM_STATE_SNAPSHOT && !player?.isHost) {
    room = msg.room;
    const self = room.players.find(
      (p) => p.peerId === player.peerId || p.playerId === player.playerId,
    );
    if (self) player = { ...player, ...self };
    persist();
    renderPlayer($("#main"));
  }
  if (msg.type === RPC.QUEUE_ADD_REQUEST && player?.isHost) {
    try {
      handleQueueAddRequest(remotePeerId, msg);
      publishQueueUpdate();
      renderHost($("#main"));
    } catch (e) {
      peerNode.send(remotePeerId, {
        type: RPC.ERROR_NOTICE,
        message: e.message,
      });
      log(e.message);
    }
  }
  if (msg.type === RPC.QUEUE_UPDATE_REQUEST && player?.isHost) {
    try {
      applyPhoneQueueUpdate(remotePeerId, msg);
      publishQueueUpdate();
      renderHost($("#main"));
    } catch (e) {
      peerNode.send(remotePeerId, {
        type: RPC.ERROR_NOTICE,
        message: e.message,
      });
      log(e.message);
    }
  }
  if (msg.type === RPC.QUEUE_UPDATED && !player?.isHost) {
    room = msg.room;
    persist();
    renderPlayer($("#main"));
  }
  if (msg.type === RPC.PLAYBACK_SYNC) {
    room.playbackState = {
      ...room.playbackState,
      ...msg.sample,
      syncDegraded: false,
    };
    persist();
    renderLyricsPanel();
    syncPhoneVideo();
  }
  if (msg.type === RPC.SINGER_JOIN_REQUEST && player?.isHost) {
    const actor = pairedActor(remotePeerId, msg.playerId);
    if (actor) {
      const singers = [
        ...new Set([
          ...room.players
            .filter((p) => p.isSingerForCurrentSong)
            .map((p) => p.playerId),
          actor.playerId,
        ]),
      ].slice(0, MAX_SINGERS);
      assignSingers(room, singers);
      broadcastRoom(RPC.SINGER_ASSIGNED);
      sendCastRoomUpdate("CAST_SET_SINGERS", {
        players: room.players.filter((p) => p.isSingerForCurrentSong),
      });
      persist();
      renderHost($("#main"));
    } else
      peerNode.send(remotePeerId, {
        type: RPC.ERROR_NOTICE,
        message: "Singer request needs a paired player.",
      });
  }
  if (msg.type === RPC.SINGER_ASSIGNED && !player?.isHost) {
    room = msg.room;
    const self = room.players.find(
      (p) => p.peerId === player.peerId || p.playerId === player.playerId,
    );
    if (self) player = { ...player, ...self };
    persist();
    renderPlayer($("#main"));
  }
  if (msg.type === RPC.PLAYER_LEFT && !player?.isHost) {
    room = msg.room;
    if (room?.playbackState?.status === "host_lost") {
      log(
        "Host disconnected. TV and queue controls are locked. Create a new room to continue.",
      );
    } else {
      log(`Player ${msg.peerId} left the room.`);
    }
    persist();
    renderPlayer($("#main"));
  }
  if (msg.type === RPC.MIC_MUTED && msg.playerId === player?.playerId) {
    setOwnMicMuted(true);
    log("Host muted your mic.");
  }
  if (msg.type === RPC.MIC_ENABLED && player?.isHost) {
    const target = room.players.find((p) => p.playerId === msg.playerId);
    if (target) {
      target.micState = { ...target.micState, enabled: true, publishing: true };
      persist();
      renderHost($("#main"));
      log(`#${target.playerNumber} ${target.displayName} enabled mic.`);
    }
  }
}
export async function hostPage(root) {
  await loadCatalog();
  if (!player?.isHost) {
    player = makePlayer("host", "Host");
    player.playerNumber = 1;
    room = makeRoom(player);
    persist();
  }
  setupPeer(player.peerId);
  setupReceiverBridge();
  commonChrome(root, "Host Controller");
  renderHost($("#main"));
}
function renderHost(main) {
  const song = currentSong();
  const setupComplete = room.players.length > 1 && room.queue.length > 0;
  const setupOpen = setupComplete ? "" : " open";
  const activeQueue = room.queue.some((q) => q.status === "active");
  const castOpen = setupComplete || activeQueue ? "" : " open";
  const tvBleedWarn = room.players.some((p) => p.isSingerForCurrentSong)
    ? '<p class="warn">TV bleed risk: singers should use headphones. Lyrics/video on TV only.</p>'
    : "";
  const roomSummary = `<strong>Room ${escapeHtml(room.roomCode)}</strong> · ${room.players.length}/5 players · ${room.queue.length} queue item(s)`;
  const activeSingers = room.players.filter((p) => p.isSingerForCurrentSong).length;
  main.innerHTML = `<section class="host-dashboard"><div class="room-spotlight card"><div><p class="eyebrow">Host room</p><h2>Room ${escapeHtml(room.roomCode)}</h2><p class="subtle">${room.players.length}/5 players · ${activeSingers} active singer(s) · ${room.queue.length} queue item(s)</p></div><div class="stage-art compact" aria-hidden="true"><div class="stage-orb"></div><div class="soundwave"><span></span><span></span><span></span><span></span><span></span></div></div></div><section class="grid"><details class="card"${setupOpen}><summary>${roomSummary}</summary><p>Share this with singers after opening the room.</p><p><a href="../player/?room=${escapeHtml(room.roomCode)}">Player join link</a></p><p><a href="${escapeHtml(receiverUrl())}" target="_blank" rel="noreferrer">Open TV receiver tab</a></p><p class="hint">For Chrome tab casting: open this receiver tab, then Cast tab. It will show this room, queue, singers, and live mic audio from the host tab.</p><button id="newRoom">New room</button>${tvBleedWarn}</details><details class="card"${setupOpen}><summary>Pair phones</summary><p>Only use this when adding another phone. Player creates an offer, host returns the answer.</p><textarea id="offer" placeholder="Paste player offer/link/chunks"></textarea><div class="button-row"><button id="scanOfferQr">Scan player QR</button><button id="answerOffer" class="primary">Create host answer</button></div><div id="answerOut"></div></details><details class="card"${castOpen}><summary>TV cast controls</summary><p id="castStatus" class="status-pill live-status">Click to connect to Chromecast</p><label>Cast media origin <input id="castOrigin" value="${escapeHtml(castOrigin())}" placeholder="http://192.168.x.x:4174"></label><p class="hint">Default Chromecast receiver plays media only. To show room/queue and hear live mics, open the TV receiver tab link above and Cast tab from Chrome.</p><button id="castBtn">Cast current song to TV</button><button id="castLoadBtn" style="display:none">Reload current song on TV</button><button id="castPlayBtn" style="display:none">Play</button><button id="castPause" style="display:none">Pause</button><label>Seek seconds <input id="castSeekSeconds" type="number" min="0" value="0"></label><button id="castSeek" style="display:none">Seek</button><pre id="castState"></pre></details><div class="card queue-card"><h2>Queue</h2>${queueHtml(room, "host")}<div class="button-row"><button id="acceptAll">Accept all</button><button id="startNext" class="primary">Start next queued</button></div></div><details class="card singer-card"${setupComplete ? "" : " open"}><summary>Singers / mic control</summary>${room.players.map((p) => `<label><input type="checkbox" class="singer" value="${escapeHtml(p.playerId)}" ${p.isSingerForCurrentSong ? "checked" : ""}> #${p.playerNumber} ${escapeHtml(p.displayName)}</label><button class="mutePlayer" data-player-id="${escapeHtml(p.playerId)}">Mute #${p.playerNumber}</button>`).join("")}<button id="setSingers" class="primary">Set singers</button></details></section></section>`;
  $("#newRoom").onclick = () => {
    player = makePlayer("host", "Host");
    player.playerNumber = 1;
    room = makeRoom(player);
    persist();
    location.reload();
  };
  $("#scanOfferQr").onclick = async () => {
    try {
      await scanQrInto($("#offer"), log);
    } catch (e) {
      log(e.message);
    }
  };
  $("#answerOffer").onclick = async () => {
    try {
      const encoded = await peerNode.acceptManualOffer($("#offer").value);
      renderPayloadCard($("#answerOut"), encoded, "Host answer");
    } catch (e) {
      log(e.message);
    }
  };
  $("#acceptAll").onclick = () => {
    room.queue
      .filter((q) => q.status === "requested")
      .forEach((q) => acceptQueue(room, q.queueItemId));
    publishQueueUpdate();
    renderHost(main);
  };
  $("#startNext").onclick = () => {
    startQueueItem(nextQueuedItem(room));
    renderHost(main);
  };
  $("#setSingers").onclick = () => {
    assignSingers(
      room,
      [...document.querySelectorAll(".singer:checked")].map((i) => i.value),
    );
    broadcastRoom(RPC.SINGER_ASSIGNED);
    sendCastRoomUpdate("CAST_SET_SINGERS", {
      players: room.players.filter((p) => p.isSingerForCurrentSong),
    });
    persist();
    renderHost(main);
  };
  document.querySelectorAll(".acceptItem").forEach(
    (b) =>
      (b.onclick = () => {
        acceptQueue(room, b.dataset.queueId);
        publishQueueUpdate();
        renderHost(main);
      }),
  );
  document.querySelectorAll(".startItem").forEach(
    (b) =>
      (b.onclick = () => {
        startQueueItem(
          room.queue.find((q) => q.queueItemId === b.dataset.queueId),
        );
        renderHost(main);
      }),
  );
  document.querySelectorAll(".rejectItem").forEach(
    (b) =>
      (b.onclick = () => {
        rejectQueue(room, b.dataset.queueId);
        publishQueueUpdate();
        renderHost(main);
      }),
  );
  document.querySelectorAll(".removeItem").forEach(
    (b) =>
      (b.onclick = () => {
        removeQueueItem(room, b.dataset.queueId);
        publishQueueUpdate();
        renderHost(main);
      }),
  );
  document.querySelectorAll(".mutePlayer").forEach(
    (b) =>
      (b.onclick = () => {
        const playerId = b.dataset.playerId;
        const target = room.players.find((p) => p.playerId === playerId);
        if (target)
          peerNode.send(target.peerId, { type: RPC.MIC_MUTED, playerId });
        log(`Mute sent to #${target?.playerNumber || "?"}`);
      }),
  );
  $("#castStatus").textContent = "Click to connect to Chromecast";
  const cast =
    castController || (castController = new CastController("CC1AD845"));
  $("#castStatus").textContent = "Click to connect to Chromecast";
  attachCastListeners(cast);
  $("#castBtn").onclick = async () => {
    try {
      saveCastOrigin();
      $("#castBtn").disabled = true;
      $("#castStatus").textContent = "Connecting to Chromecast…";
      await cast.init();
      await cast.requestSession();
      $("#castBtn").style.display = "none";
      showCastControls();
      $("#castStatus").textContent = "Connected to TV";
      publishReceiverState();
      log("Cast connected");
      await loadCurrentSongOnTv();
    } catch (e) {
      $("#castBtn").disabled = false;
      log(e.message);
    }
  };
  $("#castLoadBtn").onclick = () => {
    saveCastOrigin();
    loadCurrentSongOnTv();
  };
  $("#castPlayBtn").onclick = () => {
    publishReceiverCommand("CAST_PLAY");
    cast.play().catch((e) => log(e.message));
  };
  $("#castPause").onclick = () => {
    publishReceiverCommand("CAST_PAUSE");
    cast.pause();
  };
  $("#castSeek").onclick = () => {
    const seconds = +$("#castSeekSeconds").value || 0;
    publishReceiverCommand("CAST_SEEK", { seconds });
    cast.seek(seconds);
  };
}
export async function playerPage(root) {
  await loadCatalog();
  if (!player?.playerId || player.isHost) {
    player = makePlayer("participant", "Player");
    persist();
  }
  player.displayName = normalizeDisplayName(player.displayName, "Player");
  persist();
  setupPeer(player.peerId);
  audio = new PhoneAudio(log);
  commonChrome(root, "Player Phone");
  renderPlayer($("#main"));
}
function playerIsJoined() {
  return !!(
    room?.hostPeerId &&
    player?.playerNumber &&
    room.players?.some(
      (p) => p.playerId === player.playerId || p.peerId === player.peerId,
    )
  );
}
function joinRoomHtml(roomCode) {
  const reconnect = room?.hostPeerId
    ? `<div class="card"><h2>Reconnect</h2><p>Previously in room <strong>${escapeHtml(room.roomCode)}</strong>. Create a fresh phone pairing code and ask the host for a new answer.</p><button id="forgetRoom">Forget room, start fresh</button></div>`
    : "";
  return `<section class="phone-screen"><div class="phone-hero card"><p class="eyebrow">Player pairing</p><h2>Join room ${escapeHtml(roomCode || "")}</h2><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><p class="subtle">Pair this phone with the host. After joining, queue and mic controls appear.</p></div><details class="card" open><summary>Join room</summary><label>Your name<input id="displayName" value="${escapeHtml(player?.displayName || "Player")}" placeholder="Your name"></label><label>Room code<input id="roomCode" value="${escapeHtml(roomCode)}" placeholder="Room code"></label><button id="makeOffer" class="primary">Create phone pairing code</button><div id="offerOut"></div><label>Host answer<textarea id="answer" placeholder="Paste host answer/link/chunks"></textarea></label><div class="button-row"><button id="scanAnswerQr">Scan host answer QR</button><button id="importAnswer" class="primary">Finish pairing</button></div></details>${reconnect}</section>`;
}
function updatePlayerDisplayName() {
  if (!player) return;
  const input = $("#displayName");
  const nextDisplayName = normalizeDisplayName(input?.value, "Player");
  if (input) input.value = nextDisplayName;
  const changed = player.displayName !== nextDisplayName;
  player = { ...player, displayName: nextDisplayName };
  persist();
  if (changed && playerIsJoined() && room?.hostPeerId)
    peerNode?.send(room.hostPeerId, {
      type: RPC.ROOM_HELLO,
      peerId: player.peerId,
      player,
    });
}
function attachJoinHandlers() {
  document
    .querySelectorAll("button")
    .forEach((b) => b.addEventListener("click", unlockPhoneAudio));
  $("#makeOffer").onclick = async () => {
    try {
      updatePlayerDisplayName();
      assertWebRtcSupported();
      const encoded = await peerNode.createManualOffer("host");
      renderPayloadCard($("#offerOut"), encoded, "Player offer");
    } catch (e) {
      log(e.message);
    }
  };
  $("#scanAnswerQr").onclick = async () => {
    try {
      await scanQrInto($("#answer"), log);
    } catch (e) {
      log(e.message);
    }
  };
  $("#importAnswer").onclick = async () => {
    try {
      updatePlayerDisplayName();
      await peerNode.acceptManualAnswer($("#answer").value);
      log("Answer imported. Waiting for DataChannel open.");
    } catch (e) {
      log(e.message);
    }
  };
  $("#forgetRoom")?.addEventListener("click", () => {
    localStorage.removeItem("carryokie.room");
    localStorage.removeItem("carryokie.player");
    location.reload();
  });
  $("#displayName")?.addEventListener("change", updatePlayerDisplayName);
}
function renderPlayer(main) {
  const song =
    catalog.find((s) => s.songId === (room?.currentSongId || "song_002")) ||
    catalog[0];
  const roomCode =
    new URLSearchParams(location.search).get("room") || room?.roomCode || "";
  const currentTitle = song
    ? `${escapeHtml(song.title || song.songId)}${song.artist ? " — " + escapeHtml(song.artist) : ""}`
    : "Pick a song";
  if (!playerIsJoined()) {
    main.innerHTML = joinRoomHtml(roomCode);
    attachJoinHandlers();
    return;
  }
  main.innerHTML = `<section class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie phone</p><h2>${currentTitle}</h2><p class="subtle">${escapeHtml(player.displayName || "Player")} · Room ${escapeHtml(roomCode || "joined")} · Player #${escapeHtml(player.playerNumber || "?")}</p><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><div class="primary-actions"><button id="enableMic" class="primary">Enable my mic</button><button id="holdSing" class="hold-button">Hold to sing</button><button id="toggleSing">Live / mute</button><button id="muteMic" class="danger">Mute mic</button></div><p id="micStatus" class="status-pill live-status">Mic muted until enabled.</p></div>
<details class="card" open><summary>1. Profile</summary><label>Your name<input id="displayName" value="${escapeHtml(player.displayName || "Player")}" placeholder="Your name"></label></details>
<details class="card" open><summary>2. Queue songs</summary><label>Song<select id="song">${catalog.map((s) => `<option value="${s.songId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`).join("")}</select></label><label>Singers<input id="singers" value="${player.playerNumber || 2}" placeholder="Singer numbers comma separated"></label><div class="button-row"><button id="requestSong" class="primary">Add song to queue</button><button id="requestSinger">Make me a singer</button></div><div class="queue-list">${queueHtml(room, "phone")}</div></details>
<details class="card" open><summary>3. Mic setup</summary><p class="warn compact">${escapeHtml(singerWarning)}</p><label class="check"><input type="checkbox" id="pushToSing"> Push-to-sing</label><label>Mic filter<select id="voicePreset"><option value="clean">Clean</option><option value="alto">Alto warm</option><option value="bravo">Bravo bright</option><option value="bass">Bass low</option><option value="radio">Radio</option><option value="autotune">Autotune-style polish</option></select></label><div class="button-row"><button id="startBacking">Start backing monitor</button><button id="pauseBacking">Pause backing monitor</button></div><label>Remote gain <input id="remoteGain" type="range" min="0" max="2" value="1" step=".05"></label><label>Backing monitor gain <input id="backingGain" type="range" min="0" max="1" value="0.35" step=".05"></label><label>Master gain <input id="masterGain" type="range" min="0" max="2" value="1" step=".05"></label><p id="wake" class="subtle"></p></details>
<details class="card"><summary>4. Lyrics / sync</summary><video id="phoneVideo" controls playsinline muted></video><div id="lyricsPanel"></div><div class="button-row"><button id="earlier">Lyrics earlier</button><button id="later">Lyrics later</button><button id="resetSync">Reset sync</button></div></details>
<details class="card"><summary>Debug room state</summary><pre id="playerDebugState"></pre></details></section>`;
  document
    .querySelectorAll("button")
    .forEach((b) => b.addEventListener("click", unlockPhoneAudio));
  $("#playerDebugState").textContent = JSON.stringify(
    room || { status: "not paired" },
    null,
    2,
  );
  $("#displayName").addEventListener("change", updatePlayerDisplayName);
  $("#requestSong").onclick = () => {
    const item = queueRequest(
      $("#song").value,
      $("#singers")
        .value.split(",")
        .map((s) => +s.trim())
        .filter(Boolean),
      player.playerId,
      room?.queue?.length || 0,
    );
    peerNode.broadcast({ type: RPC.QUEUE_ADD_REQUEST, item });
    log("Queue request sent.");
  };
  $("#requestSinger").onclick = () => {
    peerNode.broadcast({
      type: RPC.SINGER_JOIN_REQUEST,
      playerId: player.playerId,
    });
    log("Singer slot requested.");
  };
  document.querySelectorAll(".queueSelf").forEach(
    (b) =>
      (b.onclick = () => {
        peerNode.broadcast({
          type: RPC.QUEUE_UPDATE_REQUEST,
          action: b.dataset.action,
          queueItemId: b.dataset.queueId,
          playerId: player.playerId,
        });
        log("Queue update sent.");
      }),
  );
  $("#voicePreset").onchange = (e) => {
    audio?.setVoicePreset(e.target.value);
    const status = $("#micStatus");
    if (status)
      status.textContent = `Mic filter: ${e.target.selectedOptions?.[0]?.textContent || e.target.value}`;
  };
  $("#enableMic").onclick = async () => {
    try {
      const pushToSing = $("#pushToSing").checked;
      const status = await audio.tryWakeLock();
      $("#wake").textContent =
        status === "active"
          ? "Wake lock active"
          : "Keep this phone unlocked and tab open during song. Wake lock: " +
            status;
      const stream = await audio.requestMic({ pushToSing });
      peerNode.addLocalStream(stream);
      player.micState = {
        ...player.micState,
        enabled: true,
        publishing: true,
        muted: pushToSing,
      };
      persist();
      peerNode.broadcast({ type: RPC.MIC_ENABLED, playerId: player.playerId });
      $("#micStatus").textContent = pushToSing
        ? "Mic ready. Hold to sing."
        : "Mic live.";
      log("Mic publishing. Own mic not locally monitored.");
    } catch (e) {
      $("#micStatus").textContent = e.message;
      log(e.message);
    }
  };
  const hold = $("#holdSing");
  let holding = false;
  hold.onpointerdown = (e) => {
    e.preventDefault();
    holding = true;
    try {
      hold.setPointerCapture?.(e.pointerId);
    } catch (error) {
      log(error?.message || "Pointer capture unavailable for hold-to-sing.");
    }
    setOwnMicMuted(false);
  };
  hold.onpointerup = () => { holding = false; setOwnMicMuted(true); };
  hold.onpointercancel = () => { holding = false; setOwnMicMuted(true); };
  hold.onpointerleave = () => { if (holding) { holding = false; setOwnMicMuted(true); } };
  $("#toggleSing").onclick = () =>
    setOwnMicMuted(!player?.micState?.muted);
  $("#muteMic").onclick = () => setOwnMicMuted(true);
  $("#startBacking").onclick = async () =>
    audio
      ?.startBackingMonitor(await resolvePlayableMediaUrl(song))
      .catch((e) => {
        $("#micStatus").textContent = e.message;
        log(e.message);
      });
  $("#pauseBacking").onclick = () => audio?.pauseBackingMonitor();
  $("#remoteGain").oninput = (e) => audio?.setGain("remote", +e.target.value);
  $("#backingGain").oninput = (e) => audio?.setGain("backing", +e.target.value);
  $("#masterGain").oninput = (e) => audio?.setGain("master", +e.target.value);
  $("#earlier").onclick = () => {
    room.playbackState.seekOffsetMs -= 250;
    persist();
    renderLyricsPanel();
  };
  $("#later").onclick = () => {
    room.playbackState.seekOffsetMs += 250;
    persist();
    renderLyricsPanel();
  };
  $("#resetSync").onclick = () => {
    room.playbackState.seekOffsetMs = 0;
    persist();
    renderLyricsPanel();
  };
  renderLyricsPanel();
  renderPhoneVideo(song);
}
async function renderPhoneVideo(song) {
  const video = $("#phoneVideo");
  if (!video) return;
  if (!isProtectedMedia(song)) {
    video.style.display = "none";
    video.removeAttribute("src");
    return;
  }
  video.style.display = "block";
  video.poster = "";
  video.muted = true;
  video.playsInline = true;
  try {
    const url = await resolvePlayableMediaUrl(song);
    if (video.src !== url) video.src = url;
    if (!phoneSyncTimer) phoneSyncTimer = setInterval(syncPhoneVideo, 500);
    syncPhoneVideo();
  } catch (e) {
    log(e.message);
  }
}
function syncPhoneVideo() {
  const video = $("#phoneVideo");
  if (!video || video.style.display === "none" || !room?.playbackState) return;
  const derived = deriveTvMediaPositionMs(
    room.playbackState,
    Date.now(),
    peerNode?.clockOffsetMs || 0,
  );
  const seconds = Math.max(0, derived.positionMs / 1000);
  if (
    Number.isFinite(seconds) &&
    Math.abs((video.currentTime || 0) - seconds) > 0.75
  )
    video.currentTime = seconds;
  if (!room.playbackState.paused && room.playbackState.status !== "paused")
    video
      .play?.()
      .catch(() =>
        log("Tap the lyric video once if this browser blocks autoplay."),
      );
  if (room.playbackState.paused || room.playbackState.status === "paused")
    video.pause?.();
}
async function renderLyricsPanel() {
  const panel = $("#lyricsPanel");
  if (!panel || !catalog.length) return;
  const song =
    catalog.find((s) => s.songId === (room?.currentSongId || "song_002")) ||
    catalog[0];
  if (isProtectedMedia(song)) {
    panel.innerHTML =
      "<p>Lyric video loaded above. No separate lyric file needed.</p>";
    return;
  }
  const lyrics = await fetch(song.lyricsJsonUrl)
    .then((r) => r.json())
    .catch(() => ({ lines: [] }));
  const ps = room?.playbackState;
  const derived = deriveTvMediaPositionMs(
    ps,
    Date.now(),
    peerNode?.clockOffsetMs || 0,
  );
  let t = derived.positionMs;
  panel.innerHTML =
    (derived.syncDegraded
      ? '<p class="warn">Sync degraded: waiting for actual TV Cast media status.</p>'
      : "") + lyricView(lyrics.lines, t);
}
export async function debugPage(root) {
  commonChrome(root, "Debug");
  const savedRoom = loadRoom();
  const savedPlayer = JSON.parse(
    localStorage.getItem("carryokie.player") || "null",
  );
  $("#main").innerHTML =
    `<section class="card"><h2>Local state</h2><button id="refresh">Refresh</button><pre id="debugLocalState"></pre><h2>Connection diagnostics</h2><pre id="debugConnectionState"></pre><p>ICE failures mean network may require TURN/different Wi-Fi. Strict MVP uses STUN only.</p><p>Keep phone unlocked and tab open; mobile browsers may suspend audio/WebRTC.</p></section><section class="card"><h2>Manual offer/answer</h2><p>Use these for manual pairing when WebRTC signaling fails.</p><div id="debugRole"></div><button id="debugOffer">Create offer</button><div id="offerOut"></div><textarea id="debugAnswer" placeholder="Paste answer/link/chunks"></textarea><button id="debugImport">Import answer</button><div id="answerOut"></div></section>`;
  $("#debugLocalState").textContent = JSON.stringify(
    { room: savedRoom, player: savedPlayer },
    null,
    2,
  );
  $("#debugConnectionState").textContent = JSON.stringify(
    {
      peerId: savedPlayer?.peerId,
      hostPeerId: savedRoom?.hostPeerId,
      dataChannelPeerIds: peerNode ? [...peerNode.peers.keys()] : [],
      clockOffsetMs: peerNode?.clockOffsetMs ?? null,
      castState: castController?.state?.() ?? savedRoom?.castState ?? null,
      micPermission: savedPlayer?.micState?.permissionState ?? "unknown",
    },
    null,
    2,
  );
  $("#refresh").onclick = () => location.reload();
  $("#debugOffer").onclick = async () => {
    try {
      const encoded = await peerNode.createManualOffer("host");
      renderPayloadCard($("#offerOut"), encoded, "Offer");
    } catch (e) {
      log(e.message);
    }
  };
  $("#debugImport").onclick = async () => {
    try {
      const encoded = await peerNode.acceptManualOffer($("#debugAnswer").value);
      renderPayloadCard($("#answerOut"), encoded, "Answer");
    } catch (e) {
      log(e.message);
    }
  };
}
export function receiverPage(root) {
  receiverApp(root);
}
