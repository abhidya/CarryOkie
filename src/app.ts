// @ts-nocheck
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
  moveQueueItem,
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
  mediaTrackKey,
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
import { resolvePlayableMediaUrl, isProtectedMedia } from "./protectedMedia.ts";
import { $, commonChrome, hostShell, playerShell, receiverShell, escapeHtml, logToPage } from "./app/dom.ts";
import { formatSongTitle, loadSongCatalog } from "./app/catalog.ts";
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
  AUTO_JOIN_WEBRTC_OFFER,
  AUTO_JOIN_WEBRTC_ANSWER,
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
let receiverNegotiationTimer: ReturnType<typeof setTimeout> | null = null;
const receiverTrackKeys = new Set<string>();
const hostRemoteAudioSinks = new WeakMap<MediaStream, HTMLAudioElement>();
const audioPipeline = {
  hostRemoteAudioTracks: 0,
  hostRelayedStreams: 0,
  receiverReady: false,
  receiverPcConnectionState: "new",
  receiverPcIceState: "new",
  receiverTracksAdded: 0,
  receiverOfferSentAt: null,
  receiverAnswerReceivedAt: null,
  receiverLastError: null,
  micLatencyStats: null,
};
function renderAudioPipelineStatus() {
  const el = $("#audioPipelineStatus");
  if (el) el.textContent = JSON.stringify(audioPipeline, null, 2);
}
function publishAudioPipelineStatus() {
  renderAudioPipelineStatus();
  receiverChannel?.postMessage?.({
    type: "RECEIVER_AUDIO_STATUS",
    payload: { ...audioPipeline, roomCode: room?.roomCode },
  });
}
function summarizeInboundAudioStats(report) {
  const inbound = [];
  report?.forEach?.((stat) => {
    if (
      stat.type === "inbound-rtp" &&
      (stat.kind === "audio" || stat.mediaType === "audio")
    )
      inbound.push(stat);
  });
  if (!inbound.length) return null;
  const stats = inbound[inbound.length - 1];
  const jitterBufferMs =
    stats.jitterBufferDelay && stats.jitterBufferEmittedCount
      ? (stats.jitterBufferDelay / stats.jitterBufferEmittedCount) * 1000
      : null;
  return {
    jitterMs:
      typeof stats.jitter === "number" ? Math.round(stats.jitter * 1000) : null,
    jitterBufferMs:
      typeof jitterBufferMs === "number" ? Math.round(jitterBufferMs) : null,
    packetsLost:
      typeof stats.packetsLost === "number" ? stats.packetsLost : null,
    packetsReceived:
      typeof stats.packetsReceived === "number"
        ? stats.packetsReceived
        : null,
    audioLevel:
      typeof stats.audioLevel === "number" ? stats.audioLevel : null,
    totalAudioEnergy:
      typeof stats.totalAudioEnergy === "number"
        ? stats.totalAudioEnergy
        : null,
  };
}
async function updateHostMicLatencyStats() {
  if (!player?.isHost || !peerNode?.peers?.size) return;
  for (const [remotePeerId, edge] of peerNode.peers) {
    const summary = summarizeInboundAudioStats(await edge.pc.getStats?.());
    if (!summary) continue;
    const halfRttMs =
      typeof peerNode.clockRttMs === "number"
        ? Math.round(peerNode.clockRttMs / 2)
        : null;
    audioPipeline.micLatencyStats = {
      sourcePeerId: remotePeerId,
      playerHostRttMs: peerNode.clockRttMs,
      playerHostClockOffsetMs: Math.round(peerNode.clockOffsetMs || 0),
      hostInboundJitterMs: summary.jitterMs,
      hostInboundJitterBufferMs: summary.jitterBufferMs,
      hostInboundPacketsLost: summary.packetsLost,
      hostInboundPacketsReceived: summary.packetsReceived,
      hostInboundAudioLevel: summary.audioLevel,
      estimatedPlayerToHostMs:
        halfRttMs == null && summary.jitterBufferMs == null
          ? null
          : (halfRttMs || 0) + (summary.jitterBufferMs || 0),
      updatedAt: Date.now(),
    };
    publishAudioPipelineStatus();
    return;
  }
}
const peerCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function deriveMicLabel(p) {
  if (!p?.isSingerForCurrentSong) return "Mic muted until enabled.";
  if (!audio?.localStream) return "Needs microphone permission.";
  if (p.micState?.muted) return "Ready, muted.";
  if (!audioPipeline.hostRemoteAudioTracks) return "Sending to host.";
  if (!audioPipeline.receiverReady) return "Host receiving.";
  if (!audioPipeline.receiverAnswerReceivedAt) return "Host receiving.";
  const receiverTracks = audioPipeline.receiverTracksAdded || 0;
  if (receiverTracks > 0) return "Live on TV.";
  return "Sending to host.";
}

function deriveShowReadiness() {
  const qrJoinState = peerJsTransport
    ? peerJsTransport.state === "ready" ? "ready"
    : peerJsTransport.state === "starting" ? "starting"
    : peerJsTransport.state === "failed" ? "failed"
    : "manual_only"
    : "manual_only";
  const tvState = audioPipeline.receiverReady
    ? audioPipeline.receiverPcConnectionState === "connected" ? "ready"
    : audioPipeline.receiverPcConnectionState === "connecting" ? "connecting"
    : audioPipeline.receiverPcConnectionState === "failed" ? "failed"
    : "needs_tap"
    : "not_open";
  const activeItem = room?.queue?.find(q => q.status === "active");
  return {
    room: room ? "ready" : "missing",
    qrJoin: qrJoinState,
    tv: tvState,
    queue: {
      requested: room?.queue?.filter(q => q.status === "requested").length || 0,
      queued: room?.queue?.filter(q => q.status === "queued").length || 0,
      activeTitle: activeItem ? songTitle(activeItem.songId) : undefined,
    },
    players: (room?.players || []).map(p => ({
      playerId: p.playerId,
      peerId: p.peerId,
      number: p.playerNumber,
      name: p.displayName,
      connection: p.connectionState === "connected" ? "connected"
        : p.connectionState === "disconnected" ? "lost" : "joining",
      singerForCurrentSong: !!p.isSingerForCurrentSong,
      mic: deriveMicLabelForPlayer(p),
    })),
  };
}

function deriveMicLabelForPlayer(p) {
  if (!p.isSingerForCurrentSong) return "off";
  const playerInRoom = room?.players?.find(rp => rp.playerId === p.playerId);
  if (!playerInRoom?.micState?.enabled) return "permission_needed";
  if (playerInRoom.micState.muted) return "muted";
  if (!audioPipeline.hostRemoteAudioTracks) return "sending";
  if (!audioPipeline.receiverReady || !audioPipeline.receiverAnswerReceivedAt) return "host_receiving";
  if (audioPipeline.receiverTracksAdded > 0) return "live_on_tv";
  return "sending";
}
function persist() {
  if (room) saveRoom(room);
  if (player) localStorage.setItem("carryokie.player", JSON.stringify(player));
}
function log(msg) {
  logToPage(msg);
}
function sinkHostRemoteAudio(stream: MediaStream) {
  if (hostRemoteAudioSinks.has(stream)) return;
  const sink = document.createElement("audio");
  sink.autoplay = true;
  sink.muted = true;
  sink.playsInline = true;
  sink.srcObject = stream;
  sink.style.display = "none";
  document.body.appendChild(sink);
  hostRemoteAudioSinks.set(stream, sink);
  sink.play().catch(() => {
    log("Host remote mic sink is waiting for the next user gesture.");
  });
}
function currentMicStatusText() {
  return deriveMicLabel(player);
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
  globalThis.__carryokiePeerNode = peerNode;
  peerNode.addEventListener("open", (e) => {
    clearPeerCloseTimer(e.detail.remotePeerId);
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
    if (e.detail.state === "connected")
      clearPeerCloseTimer(e.detail.remotePeerId);
    if (e.detail.state === "disconnected")
      schedulePeerClosed(e.detail.remotePeerId);
    if (e.detail.state === "failed" || e.detail.state === "closed")
      handlePeerClosed(e.detail.remotePeerId);
  });
  peerNode.addEventListener("message", (e) =>
    handleRpc(e.detail.remotePeerId, e.detail.msg),
  );
  peerNode.addEventListener("error", (e) => log(e.detail.message));
  peerNode.addEventListener("track", (e) => {
    const remoteStream =
      e.detail.stream ||
      (e.detail.track ? new MediaStream([e.detail.track]) : null);
    if (!remoteStream) return;
    (globalThis.__carryokieRemoteStreams ||= []).push(remoteStream);
    audio?.addRemoteStream(remoteStream, e.detail.remotePeerId);
    if (player?.isHost) {
      sinkHostRemoteAudio(remoteStream);
      peerNode.relayRemoteStream(e.detail.remotePeerId, remoteStream);
      audioPipeline.hostRemoteAudioTracks = (
        peerNode.relayedStreams || []
      ).reduce(
        (sum, r) => sum + (r.stream?.getAudioTracks?.()?.length || 0),
        0,
      );
      audioPipeline.hostRelayedStreams = (peerNode.relayedStreams || []).length;
      receiverAudioDirty = true;
      negotiateReceiverAudio().catch((err) => log(err.message));
      publishAudioPipelineStatus();
    }
  });
  setInterval(() => peerNode?.pingAll(), 5000);
  setInterval(() => {
    updateHostMicLatencyStats().catch((error) =>
      log(error?.message || "Mic latency stats unavailable."),
    );
  }, 2000);
  setInterval(() => {
    if (
      player?.isHost &&
      room?.playbackState &&
      !room.playbackState.paused &&
      receiverChannel
    ) {
      const now = Date.now();
      const derived = deriveTvMediaPositionMs(room.playbackState, now, 0);
      room.playbackState = {
        ...room.playbackState,
        tvMediaTimeMs: derived.positionMs,
        tvMediaTimeSampledAtHostMs: now,
        lastUpdatedAtHostMs: now,
      };
      publishReceiverPlayback(room.playbackState);
    }
  }, 2000);
  return peerNode;
}
function isHostEdge(remotePeerId) {
  return (
    remotePeerId === "host" ||
    (!!room?.hostPeerId && remotePeerId === room.hostPeerId)
  );
}
function handlePeerClosed(remotePeerId) {
  clearPeerCloseTimer(remotePeerId);
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
function clearPeerCloseTimer(remotePeerId) {
  clearTimeout(peerCloseTimers.get(remotePeerId));
  peerCloseTimers.delete(remotePeerId);
}
function schedulePeerClosed(remotePeerId) {
  if (peerCloseTimers.has(remotePeerId)) return;
  peerCloseTimers.set(
    remotePeerId,
    setTimeout(() => handlePeerClosed(remotePeerId), 10000),
  );
}
function handlePlayerLeft(remotePeerId) {
  if (!player?.isHost || !room) return;
  const target = room.players.find((p) => p.peerId === remotePeerId);
  if (!target || target.connectionState === "disconnected") return;
  target.connectionState = "disconnected";
  target.lastSeenAt = Date.now();
  peerNode.send(remotePeerId, { type: RPC.PLAYER_LEFT, peerId: remotePeerId });
  peerNode.broadcast({ type: RPC.PLAYER_LEFT, peerId: remotePeerId, room });
  log(`Player #${target.playerNumber} ${target.displayName} disconnected.`);
  persist();
  renderHost(document.body);
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
    payload: { ...(sample || {}), roomCode: room?.roomCode },
  });
}
function publishReceiverCommand(type, payload = {}) {
  receiverChannel?.postMessage?.({
    type,
    payload: { ...payload, roomCode: room?.roomCode },
  });
}
function sendCastRoomUpdate(type, payload = {}) {
  castController?.sendSafe?.(type, payload);
  publishReceiverState();
}
function findRoomPlayerByMessage(remotePeerId, playerId) {
  if (!room?.players?.length) return null;
  return (
    room.players.find((p) => p.playerId === playerId) ||
    room.players.find((p) => p.peerId === remotePeerId) ||
    null
  );
}
function updateRoomMicState(remotePeerId, playerId, patch) {
  const target = findRoomPlayerByMessage(remotePeerId, playerId);
  if (!target) return null;

  target.micState = {
    ...target.micState,
    ...patch,
  };
  target.lastSeenAt = Date.now();

  if (player?.playerId === target.playerId) {
    player = {
      ...player,
      micState: target.micState,
    };
  }

  persist();
  return target;
}
function publishMicStateChange(target) {
  if (!target) return;
  broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
  publishReceiverState();
  renderHost(document.body);
}
function plainRtcDescription(description: RTCSessionDescription | null) {
  return description ? { type: description.type, sdp: description.sdp } : null;
}
function resetReceiverAudio(receiverId) {
  receiverPc?.close?.();
  receiverPc = null;
  receiverTrackKeys.clear();
  receiverSessionId = receiverId;
  receiverAudioDirty = true;
  receiverPendingRenegotiate = false;
  clearTimeout(receiverNegotiationTimer ?? undefined);
  receiverNegotiationTimer = null;
  audioPipeline.receiverPcConnectionState = "new";
  audioPipeline.receiverPcIceState = "new";
  audioPipeline.receiverTracksAdded = 0;
  audioPipeline.receiverOfferSentAt = null;
  audioPipeline.receiverAnswerReceivedAt = null;
  audioPipeline.receiverLastError = null;
  publishAudioPipelineStatus();
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
    const senders = receiverPc.getSenders?.() || [];
    for (const sender of senders) {
      if (sender.track?.readyState === "ended") {
        receiverTrackKeys.delete(mediaTrackKey(sender.track));
        try {
          receiverPc.removeTrack(sender);
        } catch {}
      }
    }
    const receiverStreams = [
      ...(peerNode.localStreams || []).map((stream) => ({
        sourcePeerId: peerNode.localPeerId,
        stream,
      })),
      ...(peerNode.relayedStreams || []),
    ].filter(({ stream }) => stream?.getAudioTracks?.().length);
    for (const { stream } of receiverStreams) {
      const newTracks = stream
        .getAudioTracks()
        .filter((track) => !receiverTrackKeys.has(mediaTrackKey(track)));
      newTracks.forEach((track) => {
        receiverTrackKeys.add(mediaTrackKey(track));
        audioPipeline.receiverTracksAdded++;
        receiverPc.addTrack(track, stream);
      });
    }
    if (!receiverTrackKeys.size) return;
    const offer = await receiverPc.createOffer({ offerToReceiveAudio: true });
    await receiverPc.setLocalDescription(offer);
    await waitForIceComplete(receiverPc);
    receiverChannel?.postMessage({
      type: "RECEIVER_OFFER",
      receiverId: receiverSessionId,
      description: plainRtcDescription(receiverPc.localDescription),
    });
    offerSent = true;
    audioPipeline.receiverOfferSentAt = Date.now();
    audioPipeline.receiverLastError = null;
    publishAudioPipelineStatus();
    clearTimeout(receiverNegotiationTimer ?? undefined);
    receiverNegotiationTimer = setTimeout(async () => {
      if (receiverNegotiating) {
        receiverNegotiating = false;
        audioPipeline.receiverLastError = "Receiver answer timeout (15s)";
        publishAudioPipelineStatus();
        try {
          if (receiverPc?.signalingState === "have-local-offer")
            await receiverPc.setLocalDescription({ type: "rollback" });
        } catch {}
        if (receiverPendingRenegotiate || receiverAudioDirty)
          negotiateReceiverAudio().catch((e) => log(e.message));
      }
    }, 15000);
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
      audioPipeline.receiverReady = true;
      if (receiverSessionId !== receiverId) resetReceiverAudio(receiverId);
      if (!receiverPc) {
        receiverPc = new RTCPeerConnection(rtcConfig);
        receiverPc.oniceconnectionstatechange = () => {
          audioPipeline.receiverPcIceState = receiverPc.iceConnectionState;
          publishAudioPipelineStatus();
          log(`Receiver tab audio ${receiverPc.iceConnectionState}`);
        };
        receiverPc.onconnectionstatechange = () => {
          audioPipeline.receiverPcConnectionState = receiverPc.connectionState;
          publishAudioPipelineStatus();
        };
      }
      negotiateReceiverAudio().catch((e) => log(e.message));
      publishAudioPipelineStatus();
    }
    if (
      msg.type === "RECEIVER_ANSWER" &&
      receiverPc &&
      (!msg.receiverId || msg.receiverId === receiverSessionId)
    ) {
      await receiverPc
        .setRemoteDescription(msg.description)
        .catch(async (e) => {
          log(e.message);
          audioPipeline.receiverLastError = e.message;
          publishAudioPipelineStatus();
          try {
            if (receiverPc?.signalingState === "have-local-offer")
              await receiverPc.setLocalDescription({ type: "rollback" });
          } catch {}
          receiverNegotiating = false;
        });
      clearTimeout(receiverNegotiationTimer ?? undefined);
      receiverNegotiating = false;
      audioPipeline.receiverAnswerReceivedAt = Date.now();
      audioPipeline.receiverLastError = null;
      publishAudioPipelineStatus();
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
      room?.players?.find((p) => p.playerNumber === singerNumber)
        ?.displayName || `#${singerNumber}`,
  );
}
function queuePreview() {
  return room.queue.map((q) => ({
    ...q,
    title: songTitle(q.songId),
    singerNames: queueSingerNames(q),
  }));
}
function queueHtml(r, mode: "host" | "phone" = "host") {
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
    player.micState = {
      ...player.micState,
      enabled: true,
      publishing: true,
      muted,
    };
  }
  if (room?.players?.length && player?.playerId) {
    const target = findRoomPlayerByMessage(player.peerId, player.playerId);
    if (target) {
      target.micState = {
        ...target.micState,
        enabled: true,
        publishing: true,
        muted,
      };
      target.lastSeenAt = Date.now();
    }
  }
  persist();
  const status = $("#micStatus");
  if (status) status.textContent = deriveMicLabel(player);
  peerNode?.broadcast({
    type: muted ? RPC.MIC_MUTED : RPC.MIC_UNMUTED,
    playerId: player?.playerId,
    muted,
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
function pauseCurrentPlayback() {
  if (!room?.playbackState) return;
  const derived = deriveTvMediaPositionMs(room.playbackState, Date.now(), 0);
  room.playbackState = {
    ...room.playbackState,
    paused: true,
    status: "paused",
    pausedAtSongMs: derived.positionMs,
    tvMediaTimeMs: derived.positionMs,
    lastUpdatedAtHostMs: Date.now(),
  };
  publishReceiverPlayback(room.playbackState);
  broadcastRoom(RPC.PLAYBACK_PAUSED);
  persist();
}
function resumeCurrentPlayback() {
  if (!room?.playbackState) return;
  const now = Date.now();
  const wasAt = room.playbackState.pausedAtSongMs || 0;
  room.playbackState = {
    ...room.playbackState,
    paused: false,
    status: "playing",
    startedAtHostMs: now,
    tvMediaTimeMs: wasAt,
    tvMediaTimeSampledAtHostMs: now,
    pausedAtSongMs: 0,
    syncDegraded: false,
    lastUpdatedAtHostMs: now,
  };
  publishReceiverPlayback(room.playbackState);
  broadcastRoom(RPC.PLAYBACK_STARTED);
  persist();
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
  /* Auto-resume so receiver tab and phones start playing immediately.
     In Cast mode the playbackSample event will override this shortly. */
  resumeCurrentPlayback();
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
      renderHost(document.body);
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
      renderHost(document.body);
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
      renderHost(document.body);
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
      renderHost(document.body);
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
  if (
    !player?.isHost &&
    msg.playerId === player?.playerId &&
    (msg.type === RPC.MIC_MUTED || msg.type === RPC.MIC_UNMUTED)
  ) {
    setOwnMicMuted(msg.type === RPC.MIC_MUTED || !!msg.muted);
    log(
      msg.type === RPC.MIC_MUTED
        ? "Host muted your mic."
        : "Host unmuted your mic.",
    );
  }
  if (player?.isHost && msg.type === RPC.MIC_ENABLED) {
    const target = updateRoomMicState(remotePeerId, msg.playerId, {
      enabled: true,
      publishing: true,
      muted: !!msg.muted,
    });
    if (target) {
      publishMicStateChange(target);
      log(
        `#${target.playerNumber} ${target.displayName} enabled mic${target.micState?.muted ? " muted" : " live"}.`,
      );
    }
  }
  if (player?.isHost && msg.type === RPC.MIC_MUTED) {
    const target = updateRoomMicState(remotePeerId, msg.playerId, {
      enabled: true,
      publishing: true,
      muted: true,
    });
    if (target) {
      publishMicStateChange(target);
      log(`#${target.playerNumber} ${target.displayName} muted mic.`);
    }
  }
  if (player?.isHost && msg.type === RPC.MIC_UNMUTED) {
    const target = updateRoomMicState(remotePeerId, msg.playerId, {
      enabled: true,
      publishing: true,
      muted: false,
    });
    if (target) {
      publishMicStateChange(target);
      log(`#${target.playerNumber} ${target.displayName} unmuted mic.`);
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
  hostShell(root);
  await initPeerJsHost();
  renderHost(root);
}

async function initPeerJsHost() {
  if (!room?.roomCode) return;
  peerJsTransport = new PeerJsRoomTransport({
    onStateChange: (state) => {
      const el = $("#hostQrJoinStatus");
      if (el) {
        el.textContent = state === "ready" ? "QR Join Ready"
          : state === "starting" ? "QR Join starting..."
          : state === "failed" ? "Automatic join unavailable — manual fallback ready."
          : state;
      }
      renderHost(document.body);
    },
    onMessage: () => {},
    onPeerConnected: (peerId) => {
      log(`PeerJS player connected: ${peerId}`);
    },
    onPeerDisconnected: (peerId) => {
      log(`PeerJS player disconnected: ${peerId}`);
    },
    onError: (err) => {
      log(`PeerJS error: ${err.message}`);
    },
    onAutoJoinOffer: async (peerId, offerText) => {
      try {
        const answerPayload = await peerNode.acceptManualOffer(offerText);
        peerJsTransport.sendAutoJoinAnswer(peerId, answerPayload.token);
        log(`Auto-join: answered ${peerId}`);
      } catch (e) {
        log(`Auto-join failed for ${peerId}: ${e.message}`);
        peerJsTransport.sendAutoJoinFailed(peerId, e.message);
      }
    },
  });
  globalThis.__carryokiePeerJsTransport = peerJsTransport;
  try {
    await peerJsTransport.startHost(room.roomCode);
    log(`PeerJS host ready: room ${room.roomCode}`);
  } catch (e) {
    log(`PeerJS host failed: ${e.message}`);
  }
  renderHost(document.body);
}
function renderHost(main) {
  if (!main || !room) return;
  const activeSingers = room.players.filter(p => p.isSingerForCurrentSong).length;
  const liveMicCount = room.players.filter(p => p.isSingerForCurrentSong && p.micState?.enabled && !p.micState?.muted).length;
  const qrStatus = peerJsTransport
    ? peerJsTransport.state === "ready" ? "QR Join Ready"
    : peerJsTransport.state === "starting" ? "Starting..."
    : peerJsTransport.state === "failed" ? "Unavailable — manual fallback ready"
    : "Manual only"
    : "Manual only";
  const tvStatus = audioPipeline.receiverReady
    ? audioPipeline.receiverPcConnectionState === "connected" ? "TV Connected"
    : audioPipeline.receiverPcConnectionState === "failed" ? "TV Failed"
    : "TV Tab Open"
    : "TV Not Open";

  const topStatus = $("#hostTopStatus");
  if (topStatus) {
    topStatus.innerHTML = `<div class="host-status-grid">
      <div class="status-item"><span class="status-label">Room</span><span id="hostRoomCode" class="status-value">${escapeHtml(room.roomCode)}</span></div>
      <div class="status-item"><span class="status-label">TV</span><span id="hostTvStatus" class="status-value">${tvStatus}</span></div>
      <div class="status-item"><span class="status-label">QR Join</span><span id="hostQrJoinStatus" class="status-value">${qrStatus}</span></div>
      <div class="status-item"><span class="status-label">Singers</span><span id="hostSingerCount" class="status-value">${room.players.length}/5</span></div>
      <div class="status-item"><span class="status-label">Live Mics</span><span id="hostLiveMicCount" class="status-value">${liveMicCount}</span></div>
      <div class="status-item"><span class="status-label">Queue</span><span id="hostQueueCount" class="status-value">${room.queue.length}</span></div>
    </div>`;
  }

  const actions = $("#hostActions");
  if (actions) {
    actions.innerHTML = `<button id="copySingerLink" class="primary">Copy Singer Link</button><button id="openTvStage">Open TV Stage</button><button id="showJoinQr">Show QR</button><button id="newRoom">Start Over</button>`;
    $("#copySingerLink").onclick = async () => {
      const link = PeerJsRoomTransport.playerJoinUrl(room.roomCode);
      try { await navigator.clipboard.writeText(link); } catch {}
      log("Singer link copied.");
    };
    $("#openTvStage").onclick = () => window.open(receiverUrl(), "_blank");
    $("#showJoinQr").onclick = () => {
      const panel = $("#hostPanels");
      if (panel) {
        const playerUrl = new URL(`../player/?room=${encodeURIComponent(room.roomCode)}`, location.href).toString();
        const peerJsUrl = peerJsTransport ? PeerJsRoomTransport.playerJoinUrl(room.roomCode) : playerUrl;
        panel.innerHTML = `<div class="card"><h2>Singer Join QR</h2><div id="showQrContainer"></div><p><a href="${escapeHtml(peerJsUrl)}" id="singerJoinLink">${escapeHtml(peerJsUrl)}</a></p></div>`;
        const qrContainer = $("#showQrContainer");
        if (qrContainer) qrContainer.innerHTML = qrSvg(peerJsUrl, { scale: 4, title: "Join CarryOkie room" });
      }
    };
    $("#newRoom").onclick = () => {
      player = makePlayer("host", "Host");
      player.playerNumber = 1;
      room = makeRoom(player);
      persist();
      location.reload();
    };
  }

  const panels = $("#hostPanels");
  if (panels) {
    const setupComplete = room.players.length > 1 && room.queue.length > 0;
    panels.innerHTML = `<div class="host-panels">
      <details class="card" ${setupComplete ? "" : "open"}><summary>Setup</summary><p>Share the singer link or QR above. Singers scan and join automatically.</p><p class="hint">Chrome tab cast: open TV Stage first, then cast that tab.</p></details>
      <div class="card queue-card"><h2>Run the Room</h2><div class="button-row"><button id="acceptAll">Approve Waiting</button><button id="startNext" class="primary">Start Next</button><button id="pauseSong">Pause</button><button id="resumeSong">Resume</button></div>${queueHtml(room, "host")}</div>
      <details class="card"><summary>Singers (${activeSingers} active)</summary>${room.players.map(p => `<div class="singer-row"><label class="check"><input type="checkbox" class="singer" value="${p.playerId}" ${p.isSingerForCurrentSong ? "checked" : ""}> #${p.playerNumber || "?"} ${escapeHtml(p.displayName)} ${p.micState?.enabled ? (p.micState.muted ? "(muted)" : "(live)") : ""}</label></div>`).join("")}<div class="button-row"><button id="setSingers" class="primary">Update Singers</button></div></details>
      <details class="card"><summary>Now Playing</summary>${room.currentQueueItemId ? `<p>${escapeHtml(songTitle(room.currentSongId || ""))}</p>` : "<p>No song active</p>"}${room.players.some(p => p.isSingerForCurrentSong) ? '<p class="warn">TV bleed risk: singers should use headphones.</p>' : ""}</details>
    </div>`;
    $("#acceptAll").onclick = () => {
      room.queue.filter(q => q.status === "requested").forEach(q => acceptQueue(room, q.queueItemId));
      publishQueueUpdate();
      renderHost(main);
    };
    $("#startNext").onclick = () => { startQueueItem(nextQueuedItem(room)); renderHost(main); };
    $("#pauseSong").onclick = () => { publishReceiverCommand("CAST_PAUSE"); castController?.pause?.(); pauseCurrentPlayback(); renderHost(main); };
    $("#resumeSong").onclick = () => { publishReceiverCommand("CAST_PLAY"); castController?.play?.().catch(e => log(e.message)); resumeCurrentPlayback(); renderHost(main); };
    $("#setSingers").onclick = () => {
      assignSingers(room, [...document.querySelectorAll(".singer:checked")].map(i => i.value));
      broadcastRoom(RPC.SINGER_ASSIGNED);
      sendCastRoomUpdate("CAST_SET_SINGERS", { players: room.players.filter(p => p.isSingerForCurrentSong) });
      persist();
      renderHost(main);
    };
    document.querySelectorAll(".acceptItem").forEach(b => b.onclick = () => { acceptQueue(room, b.dataset.queueId); publishQueueUpdate(); renderHost(main); });
    document.querySelectorAll(".startItem").forEach(b => b.onclick = () => { startQueueItem(room.queue.find(q => q.queueItemId === b.dataset.queueId)); renderHost(main); });
    document.querySelectorAll(".rejectItem").forEach(b => b.onclick = () => { rejectQueue(room, b.dataset.queueId); publishQueueUpdate(); renderHost(main); });
    document.querySelectorAll(".removeItem").forEach(b => b.onclick = () => { removeQueueItem(room, b.dataset.queueId); publishQueueUpdate(); renderHost(main); });
    document.querySelectorAll(".moveUpItem").forEach(b => b.onclick = () => { moveQueueItem(room, b.dataset.queueId, -1); publishQueueUpdate(); renderHost(main); });
    document.querySelectorAll(".moveDownItem").forEach(b => b.onclick = () => { moveQueueItem(room, b.dataset.queueId, 1); publishQueueUpdate(); renderHost(main); });
    document.querySelectorAll(".mutePlayer").forEach(b => b.onclick = () => { const t = room.players.find(p => p.playerId === b.dataset.playerId); if (t) peerNode.send(t.peerId, { type: RPC.MIC_MUTED, playerId: t.playerId }); });
  }

  const manualPanel = $("#manualPairingPanel");
  if (manualPanel) {
    manualPanel.innerHTML = `<p>Player creates a join code. Paste or scan it here, then send back the host answer.</p><textarea id="offer" placeholder="Paste player offer/link/chunks"></textarea><div class="button-row"><button id="scanOfferQr">Scan player QR</button><button id="answerOffer" class="primary">Create host answer</button></div><div id="answerOut"></div>`;
    $("#scanOfferQr").onclick = async () => { try { await scanQrInto($("#offer"), log); } catch (e) { log(e.message); } };
    $("#answerOffer").onclick = async () => { try { const encoded = await peerNode.acceptManualOffer($("#offer").value); renderPayloadCard($("#answerOut"), encoded, "Host answer"); } catch (e) { log(e.message); } };
  }

  const cast = castController || (castController = new CastController("CC1AD845"));
  attachCastListeners(cast);
  const castStatus = $("#castStatus");
  const castButton = $("#castBtn");
  if (castStatus && castButton) {
    castStatus.textContent = "Click to connect to Chromecast";
    castButton.onclick = async () => {
      try {
        saveCastOrigin();
        castButton.disabled = true;
        castStatus.textContent = "Connecting to Chromecast…";
        await cast.init();
        await cast.requestSession();
        castButton.style.display = "none";
        showCastControls();
        castStatus.textContent = "Connected to TV";
        publishReceiverState();
        log("Cast connected");
        await loadCurrentSongOnTv();
      } catch (e) { castButton.disabled = false; log(e.message); }
    };
  }
  const castLoadButton = $("#castLoadBtn");
  if (castLoadButton) castLoadButton.onclick = () => { saveCastOrigin(); loadCurrentSongOnTv(); };
  const castPlayButton = $("#castPlayBtn");
  if (castPlayButton) castPlayButton.onclick = () => { publishReceiverCommand("CAST_PLAY"); cast.play().catch(e => log(e.message)); };
  const castPauseButton = $("#castPause");
  if (castPauseButton) castPauseButton.onclick = () => { publishReceiverCommand("CAST_PAUSE"); cast.pause(); };
  const castSeekButton = $("#castSeek");
  if (castSeekButton) castSeekButton.onclick = () => { const seconds = +$("#castSeekSeconds").value || 0; publishReceiverCommand("CAST_SEEK", { seconds }); cast.seek(seconds); if (room?.playbackState) { const now = Date.now(); room.playbackState = { ...room.playbackState, tvMediaTimeMs: seconds * 1000, tvMediaTimeSampledAtHostMs: now, seekOffsetMs: 0, lastUpdatedAtHostMs: now }; publishReceiverPlayback(room.playbackState); persist(); } };
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
  globalThis.__carryokieAudio = audio;
  playerShell(root);
  showManualFallbackPanel();
  renderPlayer($("#main"));
}
function roomCodeFromLocation() {
  return PeerJsRoomTransport.readRoomCodeFromUrl() || room?.roomCode || "";
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
  const roomCodeUpper = (roomCode || "").toUpperCase();
  return `<section id="playerJoinCard" class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie Singer Remote</p><h2>Join Room</h2><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div></div><div class="card"><label>Room Code<p id="playerRoomCode" class="status-pill">${escapeHtml(roomCodeUpper || "—")}</p></label><label>Your Name<input id="playerDisplayName" value="${escapeHtml(player?.displayName || "")}" placeholder="Your name"></label><button id="joinRoom" class="primary">Join Room</button></div></section>`;
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
  document.querySelectorAll("button").forEach(b => b.addEventListener("click", unlockPhoneAudio));

  $("#joinRoom").onclick = async () => {
    const roomCode = roomCodeFromLocation();
    const nameInput = $("#playerDisplayName");
    const displayName = normalizeDisplayName(nameInput?.value, "Player");
    player.displayName = displayName;
    persist();

    const button = $("#joinRoom");
    if (button) { button.disabled = true; button.textContent = "Joining..."; }

    try {
      await initPeerJsPlayer(roomCode);
    } catch (e) {
      log(`Auto-join failed: ${e.message}. Use manual fallback below.`);
      if (button) { button.disabled = false; button.textContent = "Join Room"; }
      const manualToggle = $("#playerManualFallbackToggle");
      if (manualToggle) manualToggle.open = true;
      showManualFallbackPanel();
    }
  };

  $("#displayName")?.addEventListener("change", updatePlayerDisplayName);
}

async function initPeerJsPlayer(roomCode) {
  if (!roomCode) throw new Error("No room code");

  peerJsTransport = new PeerJsRoomTransport({
    onStateChange: (state) => {
      log(`PeerJS state: ${state}`);
      const status = $("#playerConnectionStatus");
      if (status) status.textContent = state;
    },
    onMessage: () => {},
  onPeerConnected: () => {},
  onPeerDisconnected: () => {},
  onError: (err) => { log(`PeerJS error: ${err.message}`); },
});
  globalThis.__carryokiePeerJsTransport = peerJsTransport;

  await peerJsTransport.joinRoom(roomCode.toUpperCase(), { displayName: player.displayName, playerId: player.playerId });
  log(`PeerJS joined room ${roomCode}`);

  const offerPayload = await peerNode.createManualOffer("host");
  peerJsTransport.sendAutoJoinOffer(offerPayload.token);
  log("Auto-join: offer sent, waiting for answer...");

  const answerText = await peerJsTransport.waitForAutoJoinAnswer(30000);
  await peerNode.acceptManualAnswer(answerText);
  log("Auto-join: answer received, DataChannel opening...");
}

function showManualFallbackPanel() {
  const panel = $("#playerManualFallbackPanel");
  if (!panel) return;
  panel.innerHTML = `<p>Player creates a join code, then imports the host answer.</p><button id="makeOffer" class="primary">Create phone pairing code</button><div id="offerOut"></div><label>Host answer<textarea id="answer" placeholder="Paste host answer/link/chunks"></textarea></label><div class="button-row"><button id="scanAnswerQr">Scan host answer QR</button><button id="importAnswer" class="primary">Finish pairing</button></div>`;
  $("#makeOffer").onclick = async () => {
    const button = $("#makeOffer");
    try {
      if (button) { button.disabled = true; button.textContent = "Creating code..."; }
      updatePlayerDisplayName();
      assertWebRtcSupported();
      const encoded = await peerNode.createManualOffer("host");
      renderPayloadCard($("#offerOut"), encoded, "Player offer");
    } catch (e) { log(e.message); } finally { if (button) { button.disabled = false; button.textContent = "Create phone pairing code"; } }
  };
  $("#scanAnswerQr").onclick = async () => { try { await scanQrInto($("#answer"), log); } catch (e) { log(e.message); } };
  $("#importAnswer").onclick = async () => { try { updatePlayerDisplayName(); await peerNode.acceptManualAnswer($("#answer").value); log("Answer imported. Waiting for DataChannel open."); } catch (e) { log(e.message); } };
}
function renderPlayer(main) {
  if (!main) return;
  const song = catalog.find(s => s.songId === (room?.currentSongId || "song_002")) || catalog[0];
  const roomCode = roomCodeFromLocation();
  const currentTitle = song ? `${escapeHtml(song.title || song.songId)}${song.artist ? " — " + escapeHtml(song.artist) : ""}` : "Pick a song";
  const micLabel = deriveMicLabel(player);

  if (!playerIsJoined()) {
    main.innerHTML = joinRoomHtml(roomCode);
    attachJoinHandlers();
    return;
  }

  main.innerHTML = `<section id="playerSingerRemote" class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie Singer Remote</p><h2>${currentTitle}</h2><p class="subtle"><span id="playerRoomCode">Room ${escapeHtml(roomCode)}</span> · Player #${escapeHtml(player.playerNumber || "?")} · <span id="playerConnectionStatus">connected</span></p><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><p id="micStatus" class="status-pill ${micLabel.includes("Live") ? "live-status" : ""}">${escapeHtml(micLabel)}</p><div class="primary-actions"><button id="enableMic" class="primary">Enable My Mic</button><button id="holdSing" class="hold-button">Hold to Sing</button><button id="toggleSing">Live / Mute</button><button id="muteMic" class="danger">Mute Mic</button></div></div>
<details id="queueSongPanel" class="card"><summary>Queue Song</summary><label>Your Name<input id="displayName" value="${escapeHtml(player.displayName || "Player")}" placeholder="Your name"></label><label>Song<select id="song">${catalog.map(s => `<option value="${s.songId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`).join("")}</select></label><label>Singers<input id="singers" value="${player.playerNumber || 2}" placeholder="Singer numbers comma separated"></label><p class="subtle">Default singer is you. Add more numbers only for duets/groups.</p><div class="button-row"><button id="requestSong" class="primary">Queue Selected Song</button><button id="requestSinger">Singer Only</button></div><div class="queue-list">${queueHtml(room, "phone")}</div></details>
<details id="soundSettingsPanel" class="card"><summary>Sing</summary><p class="warn compact">${escapeHtml(singerWarning)}</p><label class="check"><input type="checkbox" id="pushToSing"> Push-to-sing</label><label>Mic Filter<select id="voicePreset"><option value="clean">Clean</option><option value="alto">Alto warm</option><option value="bravo">Bravo bright</option><option value="bass">Bass low</option><option value="radio">Radio</option><option value="autotune">Autotune-style polish</option></select></label><p id="wake" class="subtle"></p></details>
<details class="card"><summary>Advanced Audio</summary><div class="button-row"><button id="startBacking">Start backing monitor</button><button id="pauseBacking">Pause backing monitor</button></div><label>Remote gain <input id="remoteGain" type="range" min="0" max="2" value="1" step=".05"></label><label>Backing monitor gain <input id="backingGain" type="range" min="0" max="1" value="0.35" step=".05"></label><label>Master gain <input id="masterGain" type="range" min="0" max="2" value="1" step=".05"></label></details>
<details class="card"><summary>Lyrics / Sync</summary><video id="phoneVideo" controls playsinline muted></video><div id="lyricsPanel"></div><div class="button-row"><button id="earlier">Lyrics earlier</button><button id="later">Lyrics later</button><button id="resetSync">Reset sync</button></div></details></section>`;

  document.querySelectorAll("button").forEach(b => b.addEventListener("click", unlockPhoneAudio));
  $("#displayName").addEventListener("change", updatePlayerDisplayName);
  $("#requestSong").onclick = () => {
    const item = queueRequest($("#song").value, $("#singers").value.split(",").map(s => +s.trim()).filter(Boolean), player.playerId, room?.queue?.length || 0);
    peerNode.broadcast({ type: RPC.QUEUE_ADD_REQUEST, item });
    log("Queue request sent.");
  };
  $("#requestSinger").onclick = () => { peerNode.broadcast({ type: RPC.SINGER_JOIN_REQUEST, playerId: player.playerId }); log("Singer slot requested."); };
  document.querySelectorAll(".queueSelf").forEach(b => b.onclick = () => { peerNode.broadcast({ type: RPC.QUEUE_UPDATE_REQUEST, action: b.dataset.action, queueItemId: b.dataset.queueId, playerId: player.playerId }); log("Queue update sent."); });
  $("#voicePreset").onchange = (e) => { const target = e.target; audio?.setVoicePreset(target.value); const status = $("#micStatus"); if (status) status.textContent = `Mic filter: ${target.selectedOptions?.[0]?.textContent || target.value}`; };
  $("#enableMic").onclick = async () => {
    const enableButton = $("#enableMic");
    if (enableButton?.disabled) return;
    if (enableButton) enableButton.disabled = true;
    try {
      const pushToSing = $("#pushToSing").checked;
      const status = await audio.tryWakeLock();
      $("#wake").textContent = status === "active" ? "Wake lock active" : "Keep this phone unlocked and tab open during song. Wake lock: " + status;
      const stream = await audio.requestMic({ pushToSing });
      const alreadyPublishing = !!player.micState?.publishing;
      const previousMuted = !!player.micState?.muted;
      const isNewMicStream = !peerNode.localStreams?.includes(stream);
      if (isNewMicStream) peerNode.addLocalStream(stream);
      player.micState = { ...player.micState, enabled: true, publishing: true, muted: pushToSing };
      persist();
      if (isNewMicStream || !alreadyPublishing) { peerNode.broadcast({ type: RPC.MIC_ENABLED, playerId: player.playerId, muted: pushToSing }); } else if (previousMuted !== pushToSing) { peerNode.broadcast({ type: pushToSing ? RPC.MIC_MUTED : RPC.MIC_UNMUTED, playerId: player.playerId, muted: pushToSing }); }
      const label = deriveMicLabel(player);
      $("#micStatus").textContent = label;
      log(isNewMicStream ? "Mic publishing. Own mic not locally monitored." : "Mic already publishing. Own mic not locally monitored.");
    } catch (e) { $("#micStatus").textContent = e.message; log(e.message); } finally { if (enableButton) enableButton.disabled = false; }
  };
  const hold = $("#holdSing");
  let holding = false;
  hold.onpointerdown = (e) => { e.preventDefault(); holding = true; try { hold.setPointerCapture?.(e.pointerId); } catch (error) { log(error?.message || "Pointer capture unavailable for hold-to-sing."); } setOwnMicMuted(false); };
  hold.onpointerup = () => { holding = false; setOwnMicMuted(true); };
  hold.onpointercancel = () => { holding = false; setOwnMicMuted(true); };
  hold.onpointerleave = () => { if (holding) { holding = false; setOwnMicMuted(true); } };
  $("#toggleSing").onclick = () => setOwnMicMuted(!player?.micState?.muted);
  $("#muteMic").onclick = () => setOwnMicMuted(true);
  $("#startBacking").onclick = async () => audio?.startBackingMonitor(await resolvePlayableMediaUrl(song)).catch(e => { $("#micStatus").textContent = e.message; log(e.message); });
  $("#pauseBacking").onclick = () => audio?.pauseBackingMonitor();
  $("#remoteGain").oninput = (e) => audio?.setGain("remote", +e.target.value);
  $("#backingGain").oninput = (e) => audio?.setGain("backing", +e.target.value);
  $("#masterGain").oninput = (e) => audio?.setGain("master", +e.target.value);
  $("#earlier").onclick = () => { room.playbackState.seekOffsetMs -= 250; persist(); renderLyricsPanel(); };
  $("#later").onclick = () => { room.playbackState.seekOffsetMs += 250; persist(); renderLyricsPanel(); };
  $("#resetSync").onclick = () => { room.playbackState.seekOffsetMs = 0; persist(); renderLyricsPanel(); };
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
      renderPayloadCard($("#offerOut") as HTMLElement, encoded, "Offer");
    } catch (e) {
      log(e.message);
    }
  };
  $("#debugImport").onclick = async () => {
    try {
      const encoded = await peerNode.acceptManualOffer($("#debugAnswer").value);
      renderPayloadCard($("#answerOut") as HTMLElement, encoded, "Answer");
    } catch (e) {
      log(e.message);
    }
  };
}
export function receiverPage(root) {
  receiverShell(root);
  receiverApp($("#main"));
}
