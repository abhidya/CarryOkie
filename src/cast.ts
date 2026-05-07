import { qrSvg } from './qr.ts';
import { resolvePlayableMediaUrl, resolveDefaultCastMediaUrl, resolveDefaultCastMediaType, isProtectedMedia } from './protectedMedia.ts';

declare namespace chrome.cast {
  class AutoJoinPolicy { static ORIGIN_SCOPED: string; }
  namespace media {
    class MediaInfo { constructor(contentId: string, contentType: string); contentId: string; contentType: string; metadata: GenericMediaMetadata; customData: Record<string, unknown>; }
    class GenericMediaMetadata { title: string; }
    class LoadRequest { constructor(mediaInfo: MediaInfo); media: MediaInfo; autoplay: boolean; }
  }
}
declare namespace cast.framework {
  class CastContext {
    static getInstance(): CastContext;
    setOptions(opts: { receiverApplicationId: string; autoJoinPolicy: string }): void;
    getCurrentSession(): CastSession | undefined;
    requestSession(): Promise<CastSession>;
  }
  class RemotePlayer { currentTime: number; isPaused: boolean; }
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
    addCustomMessageListener(namespace: string, handler: (event: { data: unknown }) => void): void;
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
  encryptedMedia?: unknown;
  defaultCastMediaUrl?: string | null;
  defaultCastMediaMimeType?: string;
  lyricsJsonUrl?: string | null;
  [key: string]: unknown;
}

interface Room {
  roomCode: string;
  players: Array<{ playerNumber: number | null; displayName: string; isSingerForCurrentSong: boolean; playerId: string; peerId: string }>;
}

interface CastState {
  available: boolean;
  connected: boolean;
  receiverReady: boolean;
  currentMediaLoaded: boolean;
  defaultMediaReceiver: boolean;
  error: string | null;
}

export const CAST_NAMESPACE = 'urn:x-cast:com.carryokie.room';
export const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';
export const CAST_TYPES = ['CAST_LOAD_SONG','CAST_PLAY','CAST_PAUSE','CAST_SEEK','CAST_STOP','CAST_SET_SINGERS','CAST_UPDATE_QUEUE_PREVIEW','CAST_SHOW_JOIN_QR','CAST_SYNC_PLAYBACK_STATE','CAST_SHOW_ERROR'];

function castOriginOverride(): string | null {
  try {
    const params = new URLSearchParams(location.search);
    return params.get('castOrigin') || localStorage.getItem('carryokie.castOrigin');
  } catch { return null; }
}
function rewriteCastUrlForReceiver(url: string): string {
  const origin = castOriginOverride();
  if (!origin) return url;
  try { const u = new URL(url, location.href); return new URL(u.pathname + u.search + u.hash, origin).toString(); } catch { return url; }
}

export class CastController extends EventTarget {
  appId: string;
  available = false;
  connected = false;
  remotePlayer: chrome.cast.framework.RemotePlayer | null = null;
  controller: chrome.cast.framework.RemotePlayerController | null = null;
  session: CastSession | null = null;
  currentMediaLoaded = false;

  constructor(appId = DEFAULT_MEDIA_RECEIVER_APP_ID) { super(); this.appId = appId; }
  get usesDefaultMediaReceiver(): boolean { return this.appId === DEFAULT_MEDIA_RECEIVER_APP_ID; }
  async init(): Promise<void> {
    if (globalThis.cast?.framework) { if (!this.available) this.configure(); return; }
    return new Promise((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      w.__onGCastApiAvailable = (ok: boolean) => {
        if (ok) { this.configure(); resolve(); }
        else { const error = new Error('Cast Sender unavailable in this browser.'); this.emit('error', { message: error.message }); reject(error); }
      };
      if (!document.querySelector('script[src*=cast_sender]')) { const s = document.createElement('script'); s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'; document.head.appendChild(s); }
    });
  }
  configure(): void {
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({ receiverApplicationId: this.appId, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
    this.remotePlayer = new cast.framework.RemotePlayer();
    this.controller = new cast.framework.RemotePlayerController(this.remotePlayer);
    this.controller.addEventListener(cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => this.sampleMediaStatus());
    this.controller.addEventListener(cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => this.sampleMediaStatus());
    this.available = true; this.emit('state', this.state());
  }
  async requestSession(): Promise<CastSession> {
    if (!globalThis.cast?.framework) throw new Error('Cast SDK not ready. Use Chrome on macOS/Android, click Init Cast, then wait a moment. Safari/Firefox will not work.');
    const context = cast.framework.CastContext.getInstance();
    this.session = context.getCurrentSession?.() || await context.requestSession();
    this.connected = !!this.session; this.emit('state', this.state());
    return this.session;
  }
  async ensureSession(): Promise<CastSession> {
    if (this.session) return this.session;
    if (globalThis.cast?.framework) {
      const current = cast.framework.CastContext.getInstance().getCurrentSession?.();
      if (current) { this.session = current; this.connected = true; this.emit('state', this.state()); return current; }
    }
    return this.requestSession();
  }
  send(type: string, payload: Record<string, unknown> = {}): Promise<boolean> | undefined {
    if (!CAST_TYPES.includes(type)) throw new Error(`Unknown Cast message ${type}`);
    if (this.usesDefaultMediaReceiver) return Promise.resolve(false);
    return this.session?.sendMessage(CAST_NAMESPACE, { type, payload, sentAt: Date.now() });
  }
  sendSafe(type: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    return Promise.resolve(this.send(type, payload)).catch(error => {
      this.emit('error', { message: `Cast message ${type} failed: ${error?.message || error}` });
      return false;
    });
  }
  async loadSong(song: Song, room: Room): Promise<void> {
    await this.ensureSession();
    const rawMediaUrl = this.usesDefaultMediaReceiver ? resolveDefaultCastMediaUrl(song) : await resolvePlayableMediaUrl(song);
    if (!rawMediaUrl) throw new Error(this.usesDefaultMediaReceiver ? 'Default Chromecast needs a clear cast export. Run npm run exportCastMedia.' : 'No playable media URL for song.');
    const mediaUrl = this.usesDefaultMediaReceiver ? rewriteCastUrlForReceiver(rawMediaUrl) : rawMediaUrl;
    const mediaInfo = new chrome.cast.media.MediaInfo(mediaUrl, resolveDefaultCastMediaType(song));
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = `${song.title} — ${song.artist}`;
    mediaInfo.customData = { roomCode: room.roomCode, note: 'TV plays backing/lyrics only; no live mic.' };
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    await this.session.loadMedia(request);
    this.currentMediaLoaded = true; this.emit('state', this.state());
    this.sendSafe('CAST_LOAD_SONG', { song, roomCode: room.roomCode });
    await this.play();
    this.sampleMediaStatus();
  }
  async play(): Promise<void> { await this.ensureSession(); if (!this.remotePlayer || this.remotePlayer.isPaused) this.controller?.playOrPause(); this.sendSafe('CAST_PLAY'); }
  pause(): void { if (!this.remotePlayer || !this.remotePlayer.isPaused) this.controller?.playOrPause(); this.sendSafe('CAST_PAUSE'); }
  seek(seconds: number): void { if (this.remotePlayer) { this.remotePlayer.currentTime = seconds; this.controller?.seek(); } this.send('CAST_SEEK', { seconds }); }
  sampleMediaStatus(): void {
    if (!this.remotePlayer) return;
    const paused = !!this.remotePlayer.isPaused;
    const sample = { tvMediaTimeMs: Math.round((this.remotePlayer.currentTime || 0) * 1000), tvMediaTimeSampledAtHostMs: Date.now(), paused, status: paused ? 'paused' : 'playing', playbackRate: 1, source: 'RemotePlayerController.currentTime' };
    this.emit('playbackSample', sample); this.sendSafe('CAST_SYNC_PLAYBACK_STATE', sample);
  }
  state(): CastState { return { available: this.available, connected: this.connected, receiverReady: this.connected, currentMediaLoaded: this.currentMediaLoaded, defaultMediaReceiver: this.usesDefaultMediaReceiver, error: null }; }
  emit(type: string, detail: object): void { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

export function receiverApp(root: HTMLElement): void {
  const state: { roomCode: string; song: Song | null; singers: Array<{ playerNumber: number | null; displayName: string }>; queue: Array<{ songId: string; title?: string; singerNumbers: number[] }>; mediaTimeMs: number; lines: Array<{ startMs: number; endMs: number; text: string }> } = { roomCode: '------', song: null, singers: [], queue: [], mediaTimeMs: 0, lines: [] };
  root.innerHTML = `<main class="tv"><section><h1>CarryOkie</h1><div class="room" id="room">------</div><div id="joinQr"></div><p>Scan/open /player. TV plays backing track/video only — no live mic routed here.</p><section id="singers"></section></section><section><video id="media" class="castMediaElement" controls playsinline></video><section id="lyrics" class="lyrics big"></section><section id="queue"></section></section></main>`;
  const media = root.querySelector<HTMLVideoElement>('#media')!;
  function activeLine(): typeof state.lines[0] | undefined { const t = state.mediaTimeMs; return state.lines.findLast?.(l => t >= l.startMs) || state.lines.filter(l => t >= l.startMs).pop() || state.lines[0]; }
  function render(): void {
    root.querySelector('#room')!.textContent = state.roomCode;
    const playerUrl = new URL(`../player/?room=${encodeURIComponent(state.roomCode)}`, location.href).toString();
    root.querySelector('#joinQr')!.innerHTML = state.roomCode === '------' ? '' : qrSvg(playerUrl, { scale: 3, title: 'Join CarryOkie room' });
    root.querySelector('#queue')!.innerHTML = '<h2>Queue</h2><ol>' + state.queue.map(q => `<li>${q.title || q.songId} singers ${(q.singerNumbers || []).join(', ')}</li>`).join('') + '</ol>';
    root.querySelector('#singers')!.innerHTML = '<h2>Singers</h2>' + ((state.singers || []).map(p => `<p>#${p.playerNumber} ${p.displayName}</p>`).join('') || '<p>No active singers</p>');
    const active = activeLine();
    root.querySelector('#lyrics')!.innerHTML = state.lines.length ? state.lines.map(l => `<p class="${l === active ? 'active' : ''}">${l.text}</p>`).join('') : '<p>Waiting for lyrics…</p>';
  }
  async function loadLyrics(song: Song | null): Promise<void> {
    if (isProtectedMedia(song!)) { state.lines = []; render(); return; }
    if (!song?.lyricsJsonUrl) return;
    try { state.lines = (await fetch(song.lyricsJsonUrl).then(r => r.json()) as { lines: typeof state.lines[0] }).lines || []; } catch { state.lines = []; }
    render();
  }
  function unpack(data: unknown): Record<string, unknown> | null { try { return typeof data === 'string' ? JSON.parse(data) : data as Record<string, unknown>; } catch { return null; } }
  function handle(raw: unknown): void {
    const msg = unpack(raw); if (!msg?.type) return;
    const payload = (msg as Record<string, unknown>).payload as Record<string, unknown> | undefined;
    if (msg.type === 'CAST_LOAD_SONG' && payload) { state.song = payload.song as Song; state.roomCode = (payload.roomCode as string) ?? state.roomCode; resolvePlayableMediaUrl(state.song!).then(url => { if (url) { media.src = url; media.play().catch(() => {}); } }); loadLyrics(state.song); }
    if (msg.type === 'CAST_PLAY') media.play();
    if (msg.type === 'CAST_PAUSE') media.pause();
    if (msg.type === 'CAST_SEEK' && payload) media.currentTime = payload.seconds as number;
    if (msg.type === 'CAST_SET_SINGERS' && payload) state.singers = (payload.players || payload.singers) as typeof state.singers;
    if (msg.type === 'CAST_SYNC_PLAYBACK_STATE' && payload) state.mediaTimeMs = (payload.tvMediaTimeMs as number) || 0;
    if (msg.type === 'CAST_SHOW_JOIN_QR' && payload) state.roomCode = payload.roomCode as string;
    if (msg.type === 'CAST_UPDATE_QUEUE_PREVIEW' && payload) state.queue = (payload.queue as typeof state.queue) || [];
    render();
  }
  window.addEventListener('message', ev => handle(ev.data));
  media.addEventListener('timeupdate', () => { state.mediaTimeMs = Math.round(media.currentTime * 1000); render(); });
  if (globalThis.cast?.framework?.CastReceiverContext) {
    const context = cast.framework.CastReceiverContext.getInstance();
    context.addCustomMessageListener(CAST_NAMESPACE, (event: { data: unknown }) => handle(event.data));
    context.start();
  }
  render();
}
