import { qrSvg } from "./qr.ts";
import { PeerJsRoomTransport } from "./peer/PeerJsRoomTransport.ts";
import {
  type ProtectedSong,
  resolvePlayableMediaUrl,
  resolveDefaultCastMediaUrl,
  resolveDefaultCastMediaType,
  isProtectedMedia,
} from "./protectedMedia.ts";
import { rtcConfig, waitForIceComplete } from "./webrtc.ts";
import { deriveTvMediaPositionMs } from "./sync.ts";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

declare namespace chrome.cast {
  class AutoJoinPolicy {
    static ORIGIN_SCOPED: string;
  }
  namespace media {
    class MediaInfo {
      constructor(contentId: string, contentType: string);
      contentId: string;
      contentType: string;
      metadata: GenericMediaMetadata;
      customData: Record<string, unknown>;
    }
    class GenericMediaMetadata {
      title: string;
    }
    class LoadRequest {
      constructor(mediaInfo: MediaInfo);
      media: MediaInfo;
      autoplay: boolean;
    }
  }
  namespace framework {
    class RemotePlayer {
      currentTime: number;
      isPaused: boolean;
    }
    class RemotePlayerController {
      constructor(player: RemotePlayer);
      addEventListener(type: string, fn: () => void): void;
      playOrPause(): void;
      seek(): void;
    }
  }
}
declare namespace cast.framework {
  class CastContext {
    static getInstance(): CastContext;
    setOptions(opts: {
      receiverApplicationId: string;
      autoJoinPolicy: string;
    }): void;
    getCurrentSession(): CastSession | undefined;
    requestSession(): Promise<CastSession>;
  }
  class RemotePlayer {
    currentTime: number;
    isPaused: boolean;
  }
  class RemotePlayerController {
    constructor(player: RemotePlayer);
    addEventListener(type: string, fn: () => void): void;
    playOrPause(): void;
    seek(): void;
  }
  const RemotePlayerEventType: {
    CURRENT_TIME_CHANGED: string;
    IS_PAUSED_CHANGED: string;
  };
  class CastReceiverContext {
    static getInstance(): CastReceiverContext;
    addCustomMessageListener(
      namespace: string,
      handler: (event: { data: unknown }) => void,
    ): void;
    start(): void;
  }
}

interface CastSession {
  loadMedia(request: chrome.cast.media.LoadRequest): Promise<unknown>;
  sendMessage(namespace: string, message: unknown): Promise<void>;
}

interface Song {
  songId: string;
  title: string;
  artist: string;
  castMediaUrl?: string | null;
  phoneBackingAudioUrl?: string | null;
  encryptedMedia?: ProtectedSong["encryptedMedia"];
  defaultCastMediaUrl?: string | null;
  defaultCastMediaMimeType?: string;
  lyricsJsonUrl?: string | null;
  [key: string]: unknown;
}

interface Room {
  roomCode: string;
  players: Array<{
    playerNumber: number | null;
    displayName: string;
    isSingerForCurrentSong: boolean;
    playerId: string;
    peerId: string;
  }>;
}

interface CastState {
  available: boolean;
  connected: boolean;
  receiverReady: boolean;
  currentMediaLoaded: boolean;
  defaultMediaReceiver: boolean;
  error: string | null;
}

type CastGlobal = typeof globalThis & {
  cast?: typeof cast;
};

function castGlobal(): CastGlobal {
  return globalThis as CastGlobal;
}

export const CAST_NAMESPACE = "urn:x-cast:com.carryokie.room";
export const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";
export const CAST_TYPES = [
  "CAST_LOAD_SONG",
  "CAST_PLAY",
  "CAST_PAUSE",
  "CAST_SEEK",
  "CAST_STOP",
  "CAST_SET_SINGERS",
  "CAST_UPDATE_QUEUE_PREVIEW",
  "CAST_SHOW_JOIN_QR",
  "CAST_SYNC_PLAYBACK_STATE",
  "CAST_SHOW_ERROR",
];

function castOriginOverride(): string | null {
  try {
    const params = new URLSearchParams(location.search);
    return (
      params.get("castOrigin") || localStorage.getItem("carryokie.castOrigin")
    );
  } catch {
    return null;
  }
}
function rewriteCastUrlForReceiver(url: string): string {
  const origin = castOriginOverride();
  if (!origin) return url;
  try {
    const u = new URL(url, location.href);
    return new URL(u.pathname + u.search + u.hash, origin).toString();
  } catch {
    return url;
  }
}

function shouldLoadCastReceiverFramework(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("castReceiver") === "1") return true;
    if (params.has("room")) return false;
    return /\bCrKey\b|Chromecast/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function loadCastReceiverFramework(): Promise<void> {
  if (castGlobal().cast?.framework?.CastReceiverContext)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[src*=caf_receiver]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Cast Receiver SDK failed to load.")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Cast Receiver SDK failed to load."));
    document.head.appendChild(script);
  });
}

export class CastController extends EventTarget {
  appId: string;
  available = false;
  connected = false;
  remotePlayer: chrome.cast.framework.RemotePlayer | null = null;
  controller: chrome.cast.framework.RemotePlayerController | null = null;
  session: CastSession | null = null;
  currentMediaLoaded = false;

  constructor(appId = DEFAULT_MEDIA_RECEIVER_APP_ID) {
    super();
    this.appId = appId;
  }
  get usesDefaultMediaReceiver(): boolean {
    return this.appId === DEFAULT_MEDIA_RECEIVER_APP_ID;
  }
  async init(): Promise<void> {
    if (castGlobal().cast?.framework) {
      if (!this.available) this.configure();
      return;
    }
    return new Promise((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      w.__onGCastApiAvailable = (ok: boolean) => {
        if (ok) {
          this.configure();
          resolve();
        } else {
          const error = new Error("Cast Sender unavailable in this browser.");
          this.emit("error", { message: error.message });
          reject(error);
        }
      };
      if (!document.querySelector("script[src*=cast_sender]")) {
        const s = document.createElement("script");
        s.src =
          "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
        document.head.appendChild(s);
      }
    });
  }
  configure(): void {
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: this.appId,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    this.remotePlayer = new cast.framework.RemotePlayer();
    this.controller = new cast.framework.RemotePlayerController(
      this.remotePlayer,
    );
    this.controller.addEventListener(
      cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
      () => this.sampleMediaStatus(),
    );
    this.controller.addEventListener(
      cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
      () => this.sampleMediaStatus(),
    );
    this.available = true;
    this.emit("state", this.state());
  }
  async requestSession(): Promise<CastSession> {
    if (!castGlobal().cast?.framework)
      throw new Error(
        "Cast SDK not ready. Use Chrome on macOS/Android, click Init Cast, then wait a moment. Safari/Firefox will not work.",
      );
    const context = cast.framework.CastContext.getInstance();
    this.session =
      context.getCurrentSession?.() || (await context.requestSession());
    this.connected = !!this.session;
    this.emit("state", this.state());
    return this.session;
  }
  async ensureSession(): Promise<CastSession> {
    if (this.session) return this.session;
    if (castGlobal().cast?.framework) {
      const current =
        cast.framework.CastContext.getInstance().getCurrentSession?.();
      if (current) {
        this.session = current;
        this.connected = true;
        this.emit("state", this.state());
        return current;
      }
    }
    return this.requestSession();
  }
  send(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    if (!CAST_TYPES.includes(type))
      throw new Error(`Unknown Cast message ${type}`);
    if (this.usesDefaultMediaReceiver) return Promise.resolve(false);
    if (!this.session) return Promise.resolve(false);
    return Promise.resolve(
      this.session.sendMessage(CAST_NAMESPACE, {
        type,
        payload,
        sentAt: Date.now(),
      }),
    ).then(() => true);
  }
  sendSafe(
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<boolean> {
    return Promise.resolve(this.send(type, payload)).catch((error) => {
      this.emit("error", {
        message: `Cast message ${type} failed: ${error?.message || error}`,
      });
      return false;
    });
  }
  async loadSong(song: Song, room: Room): Promise<void> {
    await this.ensureSession();
    const rawMediaUrl = this.usesDefaultMediaReceiver
      ? resolveDefaultCastMediaUrl(song)
      : await resolvePlayableMediaUrl(song);
    if (!rawMediaUrl)
      throw new Error(
        this.usesDefaultMediaReceiver
          ? "Default Chromecast needs a clear cast export. Run npm run exportCastMedia."
          : "No playable media URL for song.",
      );
    const mediaUrl = this.usesDefaultMediaReceiver
      ? rewriteCastUrlForReceiver(rawMediaUrl)
      : rawMediaUrl;
    const mediaInfo = new chrome.cast.media.MediaInfo(
      mediaUrl,
      resolveDefaultCastMediaType(song),
    );
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = `${song.title} — ${song.artist}`;
    mediaInfo.customData = {
      roomCode: room.roomCode,
      note: "TV plays backing/lyrics only; no live mic.",
    };
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    await this.session!.loadMedia(request);
    this.currentMediaLoaded = true;
    this.emit("state", this.state());
    this.sendSafe("CAST_LOAD_SONG", { song, roomCode: room.roomCode });
    await this.play();
    this.sampleMediaStatus();
  }
  async play(): Promise<void> {
    await this.ensureSession();
    if (!this.remotePlayer || this.remotePlayer.isPaused)
      this.controller?.playOrPause();
    this.sendSafe("CAST_PLAY");
  }
  pause(): void {
    if (!this.remotePlayer || !this.remotePlayer.isPaused)
      this.controller?.playOrPause();
    this.sendSafe("CAST_PAUSE");
  }
  seek(seconds: number): void {
    if (this.remotePlayer) {
      this.remotePlayer.currentTime = seconds;
      this.controller?.seek();
    }
    this.send("CAST_SEEK", { seconds });
  }
  sampleMediaStatus(): void {
    if (!this.remotePlayer) return;
    const paused = !!this.remotePlayer.isPaused;
    const sample = {
      tvMediaTimeMs: Math.round((this.remotePlayer.currentTime || 0) * 1000),
      tvMediaTimeSampledAtHostMs: Date.now(),
      paused,
      status: paused ? "paused" : "playing",
      playbackRate: 1,
      source: "RemotePlayerController.currentTime",
    };
    this.emit("playbackSample", sample);
    this.sendSafe("CAST_SYNC_PLAYBACK_STATE", sample);
  }
  state(): CastState {
    return {
      available: this.available,
      connected: this.connected,
      receiverReady: this.connected,
      currentMediaLoaded: this.currentMediaLoaded,
      defaultMediaReceiver: this.usesDefaultMediaReceiver,
      error: null,
    };
  }
  emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export function receiverApp(root: HTMLElement): void {
  const initialRoomCode = (
    PeerJsRoomTransport.readRoomCodeFromUrl() || "------"
  ).toUpperCase();
  const lockedRoomCode = initialRoomCode === "------" ? "" : initialRoomCode;
  const state: {
    roomCode: string;
    song: Song | null;
    singers: Array<{
      playerNumber: number | null;
      displayName: string;
      micState?: {
        publishing?: boolean;
        muted?: boolean;
      };
    }>;
    queue: Array<{
      songId: string;
      title?: string;
      singerNumbers: number[];
      singerNames?: string[];
    }>;
    mediaTimeMs: number;
    lines: Array<{ startMs: number; endMs: number; text: string }>;
    status: string;
    liveMicStatus: string;
    playbackState: Record<string, unknown> | null;
    audioOutputUnlocked: boolean;
    audioDiagnostics: Record<string, unknown> | null;
    receiverMicLatencyStats: Record<string, unknown> | null;
  } = {
    roomCode: initialRoomCode,
    song: null,
    singers: [],
    queue: [],
    mediaTimeMs: 0,
    lines: [],
    status: "Waiting for host tab…",
    liveMicStatus: "",
    playbackState: null,
    audioOutputUnlocked: false,
    audioDiagnostics: null,
    receiverMicLatencyStats: null,
  };
  root.innerHTML = `<section id="receiverJoinHero" aria-labelledby="receiverJoinTitle"><div class="receiver-code-block"><p class="eyebrow" id="receiverJoinTitle">Scan with any camera app</p><div id="receiverRoomCode" class="room">${escapeHtml(initialRoomCode)}</div><p class="receiver-join-help">No app install. No host approval. Scan, enter your name, queue a song, or go live.</p><a id="receiverJoinLink" href="#">Open singer join link</a></div><div id="receiverJoinQr" aria-label="Singer join QR"></div></section><div id="receiverStageStatus"><p class="status-pill">${escapeHtml("Waiting for host tab…")}</p></div><section id="receiverActiveSingers"><h2>Singers</h2><p>No active singers</p></section><section id="receiverNowPlaying"><h2>Now Playing</h2><p>Waiting for song…</p></section><section id="receiverMediaRegion"><video id="media" class="castMediaElement" controls playsinline></video><section id="receiverLyricsRegion" class="lyrics big"></section></section><section id="receiverQueuePreview"><h2>Queue</h2><ol></ol></section><section id="receiverLiveMicStatus"><h2>TV Audio</h2><p>Click once after opening/casting this tab so browser audio can play.</p><button id="startReceiverAudio" class="primary">Start TV audio</button><button id="retryLiveMics">Retry live mics</button></section>`;
  const media = root.querySelector<HTMLVideoElement>("#media")!;
  const retryLiveMicsButton = root.querySelector<HTMLButtonElement>("#retryLiveMics")!;
  const startReceiverAudioButton = root.querySelector<HTMLButtonElement>("#startReceiverAudio")!;
  const receiverId = crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let loadedSongId = "";
  let mediaReady = false;
  let pendingPlay = false;
  async function startReceiverAudio(): Promise<void> {
    state.audioOutputUnlocked = true;
    if (media.src) {
      try {
        await media.play();
        if (!liveMicTrackIds.size) state.status = "Backing track playing.";
      } catch (error) {
        state.status = `Tap the video play button if audio is still blocked: ${(error as Error).message}`;
      }
    } else {
      pendingPlay = true;
      state.status = state.song
        ? "Audio unlocked. Loading backing track…"
        : "Audio unlocked. Waiting for host to start a song.";
    }
    if (liveMicTrackIds.size) await tryPlayLiveMics();
    render();
  }
  function activeLine(): (typeof state.lines)[0] | undefined {
    const t = state.mediaTimeMs;
    return (
      state.lines.findLast?.((l) => t >= l.startMs) ||
      state.lines.filter((l) => t >= l.startMs).pop() ||
      state.lines[0]
    );
  }
  function singerMicSummary() {
    const singers = Array.isArray(state.singers) ? state.singers : [];
    const publishing = singers.filter((s) => s.micState?.publishing);
    const audible = singers.filter(
      (s) => s.micState?.publishing && !s.micState?.muted,
    );
    const muted = singers.filter(
      (s) => s.micState?.publishing && s.micState?.muted,
    );
    return { singers, publishing, audible, muted };
  }
  function liveMicStatus(): string {
    const { audible, muted, publishing } = singerMicSummary();
    if (liveMicTrackIds.size && audible.length) {
      return `Playing ${audible.length} unmuted live mic${audible.length === 1 ? "" : "s"}.`;
    }
  if (liveMicTrackIds.size && muted.length) {
    return "Muted.";
    }
    if (liveMicTrackIds.size && !publishing.length) {
	return "Muted.";
    }
    return "No live mic tracks connected.";
  }
  function renderAudioDiagnostics(): void {
    const diagEl = root.querySelector("#receiverDiagnosticsPanel");
    if (!diagEl) return;
    const d = state.audioDiagnostics;
    const { audible, muted, publishing } = singerMicSummary();
    const hostLatency = d?.micLatencyStats as Record<string, unknown> | null;
    const receiverLatency = state.receiverMicLatencyStats;
    const receiverBufferMs =
      typeof receiverLatency?.receiverInboundJitterBufferMs === "number"
        ? (receiverLatency.receiverInboundJitterBufferMs as number)
        : 0;
    const outputLatencyMs =
      typeof receiverLatency?.receiverOutputLatencyMs === "number"
        ? (receiverLatency.receiverOutputLatencyMs as number)
        : 0;
    const estimatedTotalMs =
      typeof hostLatency?.estimatedPlayerToHostMs === "number"
        ? Math.round(
            (hostLatency.estimatedPlayerToHostMs as number) +
              receiverBufferMs +
              outputLatencyMs,
          )
        : null;
    const latencyOutput = `<p>Estimated live mic latency: ${
      estimatedTotalMs == null ? "collecting…" : `~${estimatedTotalMs} ms`
    }</p><p>Player→host: RTT ${hostLatency?.playerHostRttMs ?? "?"} ms · host jitter buffer ${hostLatency?.hostInboundJitterBufferMs ?? "?"} ms · host jitter ${hostLatency?.hostInboundJitterMs ?? "?"} ms</p><p>Host→receiver: jitter buffer ${receiverLatency?.receiverInboundJitterBufferMs ?? "?"} ms · jitter ${receiverLatency?.receiverInboundJitterMs ?? "?"} ms · lost ${receiverLatency?.receiverInboundPacketsLost ?? "?"} · level ${receiverLatency?.receiverInboundAudioLevel ?? "?"}</p><p>Receiver AudioContext: base ${receiverLatency?.receiverBaseLatencyMs ?? "?"} ms · output ${receiverLatency?.receiverOutputLatencyMs ?? "?"} ms</p>`;
    const liveOutput = `<p>${escapeHtml(liveMicPlaybackDiagnostics())}</p>`;
    if (d) {
      diagEl.innerHTML = `<h2>Audio pipeline</h2><p>Host remote tracks: ${d.hostRemoteAudioTracks ?? "?"} · Relayed streams: ${d.hostRelayedStreams ?? "?"} · Receiver ready: ${d.receiverReady ? "yes" : "no"}</p><p>Receiver PC: ${d.receiverPcConnectionState ?? "?"} · ICE: ${d.receiverPcIceState ?? "?"} · Tracks added: ${d.receiverTracksAdded ?? 0}</p>${d.receiverOfferSentAt ? `<p>Offer sent: ${new Date(d.receiverOfferSentAt as number).toLocaleTimeString()}</p>` : ""}${d.receiverAnswerReceivedAt ? `<p>Answer received: ${new Date(d.receiverAnswerReceivedAt as number).toLocaleTimeString()}</p>` : ""}${d.receiverLastError ? `<p class="warn">Error: ${escapeHtml(String(d.receiverLastError))}</p>` : ""}<p>Autoplay unlocked: ${state.audioOutputUnlocked ? "yes" : "no"} · Live mic tracks: ${liveMicTrackIds.size}</p><p>Publishing singers: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p>${latencyOutput}${liveOutput}`;
    } else {
      diagEl.innerHTML = `<h2>Audio pipeline</h2><p>No diagnostics received yet. Waiting for host tab…</p><p>Autoplay unlocked: ${state.audioOutputUnlocked ? "yes" : "no"} · Live mic tracks: ${liveMicTrackIds.size}</p><p>Publishing singers: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p>${latencyOutput}${liveOutput}`;
    }
  }
  function render(): void {
    const roomEl = root.querySelector("#receiverRoomCode");
    if (roomEl) roomEl.textContent = state.roomCode;

    const playerUrl = PeerJsRoomTransport
      ? PeerJsRoomTransport.playerJoinUrl(state.roomCode)
      : new URL(`../player/?room=${encodeURIComponent(state.roomCode)}`, location.href).toString();
    const joinLink = root.querySelector<HTMLAnchorElement>("#receiverJoinLink");
    if (joinLink) { joinLink.href = playerUrl; joinLink.textContent = playerUrl; }
    const joinQr = root.querySelector("#receiverJoinQr");
    if (joinQr) joinQr.innerHTML = state.roomCode === "------" ? "" : qrSvg(playerUrl, { scale: 8, quiet: 6, title: "Join CarryOkie room" });

    const queueSingerLabel = (queueItem: (typeof state.queue)[number]): string =>
      (queueItem.singerNames?.length ? queueItem.singerNames : (queueItem.singerNumbers || []).map(singerNumber => `#${singerNumber}`)).join(", ");
    const queuePreview = root.querySelector("#receiverQueuePreview");
    if (queuePreview) queuePreview.innerHTML = `<h2>Queue</h2><ol>` + state.queue.map(q => `<li>${escapeHtml(q.title || q.songId)} singers ${escapeHtml(queueSingerLabel(q))}</li>`).join("") + `</ol>`;

    const singers = root.querySelector("#receiverActiveSingers");
    if (singers) singers.innerHTML = "<h2>Singers</h2>" + ((state.singers || []).map(p => `<p>#${escapeHtml(p.playerNumber)} ${escapeHtml(p.displayName)}</p>`).join("") || "<p>No active singers</p>");

    const nowPlaying = root.querySelector("#receiverNowPlaying");
    if (nowPlaying) nowPlaying.innerHTML = `<h2>Now Playing</h2><p>${state.song ? `${escapeHtml(state.song.title)} — ${escapeHtml(state.song.artist)}` : "Waiting for song…"}</p>`;

    const resolvedLiveMicStatus = state.liveMicStatus || (liveMicTrackIds.size ? liveMicStatus() : "");
    const stageStatus = root.querySelector("#receiverStageStatus");
    if (stageStatus) stageStatus.innerHTML = `<p class="status-pill">${escapeHtml(state.status)}</p>` + (resolvedLiveMicStatus ? `<p class="status-pill live-status">${escapeHtml(resolvedLiveMicStatus)}</p>` : "");

    const liveMicStatusEl = root.querySelector("#receiverLiveMicStatus");
    if (liveMicStatusEl) {
      const { audible, muted, publishing } = singerMicSummary();
      liveMicStatusEl.innerHTML = `<h2>TV Audio</h2><p class="subtle">${state.audioOutputUnlocked ? "Receiver audio is unlocked for backing track and live mics." : "Click once after opening/casting this tab so browser audio can play."}</p><p class="subtle">${audible.length ? `Playing ${audible.length} unmuted live mic${audible.length === 1 ? "" : "s"}.` : muted.length ? "Live mic muted." : "Waiting for singer mic…"}</p><p class="subtle">Publishing: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p><button id="startReceiverAudio" class="primary">Start TV audio</button><button id="retryLiveMics">Retry live mics</button>`;
      liveMicStatusEl.querySelector("#startReceiverAudio")?.addEventListener("click", () => { void startReceiverAudio(); });
      liveMicStatusEl.querySelector("#retryLiveMics")?.addEventListener("click", () => { void tryPlayLiveMics(); });
    }

    const active = activeLine();
    const lyricsRegion = root.querySelector("#receiverLyricsRegion");
    if (lyricsRegion) lyricsRegion.innerHTML = state.lines.length ? state.lines.map(l => `<p class="${l === active ? "active" : ""}">${escapeHtml(l.text)}</p>`).join("") : "<p>Waiting for lyrics…</p>";
  }
  async function loadLyrics(song: Song | null): Promise<void> {
    if (isProtectedMedia(song as Parameters<typeof isProtectedMedia>[0])) {
      state.lines = [];
      render();
      return;
    }
    if (!song?.lyricsJsonUrl) return;
    try {
      state.lines =
        (
          (await fetch(song.lyricsJsonUrl).then((r) => r.json())) as {
            lines: typeof state.lines;
          }
        ).lines || [];
    } catch {
      state.lines = [];
      state.status = "Lyrics unavailable; backing track still loaded.";
    }
    render();
  }
  function loadSong(song: Song | null, roomCode?: string): void {
    if (!song) return;
    state.song = song;
    state.roomCode = roomCode || state.roomCode;
    if ((song as Song).songId === loadedSongId) {
      render();
      return;
    }
    loadedSongId = (song as Song).songId;
    mediaReady = false;
    if (!liveMicTrackIds.size) state.status = "Loading backing track…";
    resolvePlayableMediaUrl(
      song as Parameters<typeof resolvePlayableMediaUrl>[0],
    )
      .then((url) => {
        if (!url) {
          if (!liveMicTrackIds.size)
            state.status = "No playable media for receiver tab.";
          render();
          return;
        }
        media.src = url;
        const attemptPlay = () => {
          mediaReady = true;
          if (pendingPlay) {
            pendingPlay = false;
            media.play().catch(() => {
              if (!liveMicTrackIds.size)
                state.status =
                  "Tap receiver once to start backing track/audio.";
              render();
            });
          }
        };
        media
          .play()
          .then(() => {
            if (!liveMicTrackIds.size) state.status = "Backing track playing.";
            attemptPlay();
            render();
          })
          .catch(() => {
            pendingPlay = true;
            attemptPlay();
            if (!liveMicTrackIds.size)
              state.status = "Tap receiver once to start backing track/audio.";
            render();
          });
      })
      .catch((error) => {
        if (!liveMicTrackIds.size)
          state.status = error?.message || "Failed to load backing track.";
        render();
      });
    loadLyrics(song);
  }
  function unpack(data: unknown): Record<string, unknown> | null {
    try {
      return typeof data === "string"
        ? JSON.parse(data)
        : (data as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  function payloadRoomCode(payload?: Record<string, unknown>): string {
    return String(payload?.roomCode || "").toUpperCase();
  }
  function payloadMatchesReceiverRoom(payload?: Record<string, unknown>): boolean {
    if (!lockedRoomCode) return true;
    return payloadRoomCode(payload) === lockedRoomCode;
  }
  function handle(raw: unknown): void {
    const msg = unpack(raw);
    if (!msg?.type) return;
    const payload = (msg as Record<string, unknown>).payload as
      | Record<string, unknown>
      | undefined;
    if (!payloadMatchesReceiverRoom(payload)) return;
    if (msg.type === "CAST_LOAD_SONG" && payload)
      loadSong(payload.song as Song, payload.roomCode as string);
    if (msg.type === "CAST_PLAY") {
      if (!media.src && state.song) loadSong(state.song, state.roomCode);
      if (media.src) media.play().catch(() => {});
      else pendingPlay = true;
    }
    if (msg.type === "CAST_PAUSE" && media.src) media.pause();
    if (msg.type === "CAST_SEEK" && payload)
      media.currentTime = payload.seconds as number;
    if (msg.type === "CAST_SET_SINGERS" && payload) {
      state.singers = (payload.players ||
        payload.singers) as typeof state.singers;
      if (liveMicTrackIds.size) void tryPlayLiveMics();
    }
    if (
      (msg.type === "CAST_SYNC_PLAYBACK_STATE" ||
        msg.type === "RECEIVER_PLAYBACK_SYNC") &&
      payload
    ) {
      state.playbackState = payload as Record<string, unknown>;
      const derived = deriveTvMediaPositionMs(
        payload as Parameters<typeof deriveTvMediaPositionMs>[0],
      );
      state.mediaTimeMs = derived.positionMs;
    }
    if (msg.type === "CAST_SHOW_JOIN_QR" && payload)
      state.roomCode = lockedRoomCode || (payload.roomCode as string);
    if (msg.type === "CAST_UPDATE_QUEUE_PREVIEW" && payload)
      state.queue = (payload.queue as typeof state.queue) || [];
    if (msg.type === "RECEIVER_STATE" && payload) {
      state.roomCode = lockedRoomCode || (payload.roomCode as string) || state.roomCode;
      state.queue = (payload.queue as typeof state.queue) || state.queue;
      state.singers =
        (payload.singers as typeof state.singers) || state.singers;
      if (payload.playbackState) {
        state.playbackState = payload.playbackState as Record<string, unknown>;
        const derived = deriveTvMediaPositionMs(
          payload.playbackState as Parameters<
            typeof deriveTvMediaPositionMs
          >[0],
        );
        state.mediaTimeMs = derived.positionMs;
      }
      loadSong(payload.song as Song | null, state.roomCode);
      if (liveMicTrackIds.size) void tryPlayLiveMics();
    }
    render();
  }
  const liveMicStream = new MediaStream();
  const liveMicTrackIds = new Set<string>();
  let liveMicAudio: HTMLAudioElement | null = null;
  let liveMicAudioContext: AudioContext | null = null;
  let liveMicSource: MediaStreamAudioSourceNode | null = null;
  let liveMicGain: GainNode | null = null;
  let liveMicOutputStatus = "not started";
  let liveMicLastPlayError = "";
  function liveMicPlaybackDiagnostics(): string {
    const elementState = liveMicAudio
      ? `${liveMicAudio.paused ? "paused" : "playing"} · ready ${liveMicAudio.readyState}`
      : "not created";
    const graphState = liveMicAudioContext
      ? liveMicAudioContext.state
      : "not created";
    const trackState =
      liveMicStream
        .getAudioTracks()
        .map(
          (track) =>
            `${track.readyState}${track.enabled === false ? " disabled" : ""}${track.muted ? " muted" : ""}`,
        )
        .join(", ") || "none";
    return `Live mic output: element ${elementState} · graph ${graphState} (${liveMicOutputStatus}) · tracks ${trackState}${
      liveMicLastPlayError ? ` · last error ${liveMicLastPlayError}` : ""
    }`;
  }
  function liveMicSummaryHtml(): string {
    const status =
      state.liveMicStatus || (liveMicTrackIds.size ? liveMicStatus() : "");
    return status
      ? `<p class="subtle">${escapeHtml(status)}</p>`
      : '<p class="subtle">Playing all forwarded singer mics.</p>';
  }
  function ensureLiveMicAudio(): HTMLAudioElement {
    if (liveMicAudio) {
      const liveMicSection = root.querySelector<HTMLElement>("#receiverLiveMicStatus");
      if (liveMicSection) {
        const subtitle = liveMicSection.querySelector("p.subtle");
        if (subtitle) subtitle.outerHTML = liveMicSummaryHtml();
        if (!liveMicSection.contains(liveMicAudio)) {
          liveMicSection.appendChild(liveMicAudio);
        }
      }
      return liveMicAudio;
    }
    const liveMicSection = root.querySelector<HTMLElement>("#receiverLiveMicStatus");
    if (liveMicSection) {
      liveMicSection.innerHTML = `<h2>TV Audio</h2>${liveMicSummaryHtml()}<button id="startReceiverAudio" class="primary">Start TV audio</button><button id="retryLiveMics">Retry live mics</button>`;
      liveMicSection
        .querySelector("#startReceiverAudio")
        ?.addEventListener("click", () => {
          void startReceiverAudio();
        });
      liveMicSection.querySelector("#retryLiveMics")?.addEventListener("click", () => {
        void tryPlayLiveMics();
      });
    }
    liveMicAudio = document.createElement("audio");
    liveMicAudio.autoplay = true;
    liveMicAudio.controls = true;
    liveMicAudio.playsInline = true;
    /* The audible path is the WebAudio graph below, which has lower latency
       than relying on HTMLMediaElement buffering. Keep the element muted so
       it can expose/debug the MediaStream without double-playing with an
       offset. */
    liveMicAudio.muted = true;
    liveMicAudio.volume = 1;
    liveMicAudio.srcObject = liveMicStream;
    const targetSection = root.querySelector<HTMLElement>("#receiverLiveMicStatus");
    if (targetSection) targetSection.appendChild(liveMicAudio);
    return liveMicAudio;
  }
  async function ensureLiveMicOutputGraph(): Promise<void> {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) {
      liveMicOutputStatus = "WebAudio unavailable; using media element";
      return;
    }
    if (!liveMicAudioContext)
      liveMicAudioContext = new AudioContextCtor({
        latencyHint: "interactive",
      });
    if (liveMicAudioContext.state === "suspended")
      await liveMicAudioContext.resume().catch((error: Error) => {
        liveMicLastPlayError = error.message;
      });
    if (!liveMicStream.getAudioTracks().length) {
      liveMicOutputStatus = "waiting for live mic track";
      return;
    }
    if (!liveMicSource) {
      liveMicSource =
        liveMicAudioContext.createMediaStreamSource(liveMicStream);
      liveMicGain = liveMicAudioContext.createGain();
      liveMicGain.gain.value = 1;
      liveMicSource.connect(liveMicGain);
      liveMicGain.connect(liveMicAudioContext.destination);
    }
    liveMicOutputStatus =
      liveMicAudioContext.state === "running"
        ? "connected to receiver speakers"
        : "audio context not running";
  }
  async function tryPlayLiveMics(): Promise<void> {
    if (!state.audioOutputUnlocked) {
      state.liveMicStatus =
        "Press 'Start TV audio' to enable live mic audio.";
      render();
      return;
    }
    state.liveMicStatus = liveMicStatus();
    render();
    const audio = ensureLiveMicAudio();
    await ensureLiveMicOutputGraph();
    try {
      await audio.play();
      liveMicLastPlayError = "";
      state.liveMicStatus = liveMicStatus();
      render();
      ensureLiveMicAudio();
    } catch (error) {
      liveMicLastPlayError = (error as Error).message;
      state.liveMicStatus =
        "Tap receiver once or press Retry live mics.";
      render();
    }
  }
  function addLiveMic(stream: MediaStream): void {
    const audioTracks =
      stream.getAudioTracks?.() ||
      stream.getTracks().filter((track) => track.kind === "audio");
    for (const track of audioTracks) {
      if (liveMicTrackIds.has(track.id)) continue;
      liveMicTrackIds.add(track.id);
      liveMicStream.addTrack(track);
    }
    if (!audioTracks.length) return;
    if (state.audioOutputUnlocked) void ensureLiveMicOutputGraph();
    void tryPlayLiveMics();
  }
  function removeStaleLiveMicTracks(): void {
    const currentIds = new Set<string>();
    for (const track of liveMicStream.getTracks()) {
      if (track.readyState === "ended") {
        liveMicStream.removeTrack(track);
        liveMicTrackIds.delete(track.id);
      } else {
        currentIds.add(track.id);
      }
    }
  }
  function plainRtcDescription(description: RTCSessionDescription | null) {
    return description
      ? { type: description.type, sdp: description.sdp }
      : null;
  }
  async function updateReceiverMicLatencyStats(
    pc: RTCPeerConnection | null,
  ): Promise<void> {
    if (!pc?.getStats) return;
    const inbound: RTCStats[] = [];
    (await pc.getStats()).forEach((stat) => {
      if (
        stat.type === "inbound-rtp" &&
        ((stat as Record<string, unknown>).kind === "audio" ||
          (stat as Record<string, unknown>).mediaType === "audio")
      )
        inbound.push(stat);
    });
    if (!inbound.length) return;
    const stats = inbound[inbound.length - 1] as unknown as Record<string, number>;
    const jitterBufferMs =
      stats.jitterBufferDelay && stats.jitterBufferEmittedCount
        ? (stats.jitterBufferDelay / stats.jitterBufferEmittedCount) * 1000
        : null;
    state.receiverMicLatencyStats = {
      receiverInboundJitterMs:
        typeof stats.jitter === "number"
          ? Math.round(stats.jitter * 1000)
          : null,
      receiverInboundJitterBufferMs:
        typeof jitterBufferMs === "number" ? Math.round(jitterBufferMs) : null,
      receiverInboundPacketsLost:
        typeof stats.packetsLost === "number" ? stats.packetsLost : null,
      receiverInboundPacketsReceived:
        typeof stats.packetsReceived === "number"
          ? stats.packetsReceived
          : null,
      receiverInboundAudioLevel:
        typeof stats.audioLevel === "number" ? stats.audioLevel : null,
      receiverBaseLatencyMs: liveMicAudioContext?.baseLatency
        ? Math.round(liveMicAudioContext.baseLatency * 1000)
        : null,
      receiverOutputLatencyMs: liveMicAudioContext?.outputLatency
        ? Math.round(liveMicAudioContext.outputLatency * 1000)
        : 0,
      updatedAt: Date.now(),
    };
    renderAudioDiagnostics();
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("carryokie.receiver");
    let pc: RTCPeerConnection | null = null;
    channel.onmessage = async (ev) => {
      const msg = ev.data || {};
      if (msg.type === "RECEIVER_STATE") handle(msg);
      if (
        msg.type === "RECEIVER_AUDIO_STATUS" &&
        msg.payload &&
        payloadMatchesReceiverRoom(msg.payload as Record<string, unknown>)
      ) {
        state.audioDiagnostics = msg.payload as Record<string, unknown>;
        renderAudioDiagnostics();
        if (liveMicTrackIds.size) void tryPlayLiveMics();
      }
      if (
        msg.type === "RECEIVER_OFFER" &&
        (!msg.receiverId || msg.receiverId === receiverId)
      ) {
        try {
          if (!pc || pc.signalingState === "closed") {
            pc?.close?.();
            pc = new RTCPeerConnection(rtcConfig);
            pc.ontrack = (event) => {
              const stream = event.streams[0];
              if (stream) addLiveMic(stream);
              else if (event.track) addLiveMic(new MediaStream([event.track]));
            };
          }
          /* Rollback any leftover local offer so setRemoteDescription can
             succeed when the host sends a fresh offer (renegotiation). */
          if (pc.signalingState === "have-local-offer") {
            await pc.setLocalDescription({ type: "rollback" });
          }
          removeStaleLiveMicTracks();
          await pc.setRemoteDescription(msg.description);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceComplete(pc);
          channel.postMessage({
            type: "RECEIVER_ANSWER",
            receiverId,
            description: plainRtcDescription(pc.localDescription),
          });
        } catch (err: unknown) {
          state.status = `Receiver audio error: ${(err as Error).message}`;
          render();
          pc?.close?.();
          pc = null;
        }
      }
    };
    setInterval(() => {
      updateReceiverMicLatencyStats(pc).catch(() => {});
    }, 2000);
    channel.postMessage({
      type: "RECEIVER_READY",
      receiverId,
      roomCode: state.roomCode,
    });
    setInterval(
      () =>
        channel.postMessage({
          type: "RECEIVER_READY",
          receiverId,
          roomCode: state.roomCode,
        }),
      3000,
    );
  }
  retryLiveMicsButton.addEventListener("click", () => {
    void tryPlayLiveMics();
  });
  startReceiverAudioButton.addEventListener("click", () => {
    void startReceiverAudio();
  });
  root.addEventListener("pointerdown", () => {
    if (!state.audioOutputUnlocked) {
      state.audioOutputUnlocked = true;
    }
    if (media.src) void media.play().catch(() => {});
    if (liveMicTrackIds.size) void tryPlayLiveMics();
  });
  window.addEventListener("message", (ev) => handle(ev.data));
  function syncReceiverVideo() {
    if (!state.playbackState || !media.src || media.readyState < 1) return;
    const derived = deriveTvMediaPositionMs(
      state.playbackState as Parameters<typeof deriveTvMediaPositionMs>[0],
    );
    const seconds = Math.max(0, derived.positionMs / 1000);
    if (
      Number.isFinite(seconds) &&
      Math.abs((media.currentTime || 0) - seconds) > 0.75
    )
      media.currentTime = seconds;
    const paused =
      !!state.playbackState.paused ||
      ["paused", "idle", "ended", "host_lost", "error"].includes(
        (state.playbackState.status as string) || "",
      );
    if (!paused) media.play().catch(() => {});
    else media.pause();
  }
  setInterval(syncReceiverVideo, 500);
  media.addEventListener("timeupdate", () => {
    if (!state.playbackState)
      state.mediaTimeMs = Math.round(media.currentTime * 1000);
    render();
  });
  async function startCastReceiverFramework(): Promise<void> {
    if (!shouldLoadCastReceiverFramework()) return;
    try {
      await loadCastReceiverFramework();
    } catch (error) {
      state.status = (error as Error).message;
      render();
      return;
    }
    if (!castGlobal().cast?.framework?.CastReceiverContext) return;
    const context = cast.framework.CastReceiverContext.getInstance();
    context.addCustomMessageListener(
      CAST_NAMESPACE,
      (event: { data: unknown }) => handle(event.data),
    );
    context.start();
  }
  void startCastReceiverFramework();
  render();
}
