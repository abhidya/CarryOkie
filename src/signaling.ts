import { qrSvg } from './qr.ts';
const enc = new TextEncoder(); const dec = new TextDecoder();

interface SignalPayload {
  kind?: string;
  fromPeerId: string;
  toPeerId?: string;
  description?: RTCSessionDescriptionInit;
  [key: string]: unknown;
}

interface EncodedPayload {
  token: string;
  url: string;
  chunks: string[];
}

export class ManualQrSignalingAdapter {
  localPeerId: string;
  constructor(localPeerId: string) { this.localPeerId = localPeerId; }
  get name(): string { return 'manual-qr'; }
  async createOffer(remotePeerId: string, pc: RTCPeerConnection): Promise<EncodedPayload> {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    return waitForIceAndEncode('offer', this.localPeerId, remotePeerId, pc);
  }
  async acceptOffer(text: string, pc: RTCPeerConnection): Promise<EncodedPayload> {
    const payload = await decodeSignalPayload(joinChunks(text));
    if (payload.kind !== 'offer') throw new Error('Expected offer payload.');
    await pc.setRemoteDescription(payload.description as RTCSessionDescriptionInit);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return waitForIceAndEncode('answer', this.localPeerId, payload.fromPeerId, pc);
  }
  async acceptAnswer(text: string, pc: RTCPeerConnection): Promise<SignalPayload> {
    const payload = await decodeSignalPayload(joinChunks(text));
    if (payload.kind !== 'answer') throw new Error('Expected answer payload.');
    await pc.setRemoteDescription(payload.description as RTCSessionDescriptionInit);
    return payload;
  }
}

async function waitForIceAndEncode(kind: string, fromPeerId: string, toPeerId: string, pc: RTCPeerConnection): Promise<EncodedPayload> {
  return new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') return encodeSignalPayload({ kind, fromPeerId, toPeerId, description: pc.localDescription }).then(resolve, reject);
    const done = () => { pc.removeEventListener('icegatheringstatechange', on); clearTimeout(timer); encodeSignalPayload({ kind, fromPeerId, toPeerId, description: pc.localDescription }).then(resolve, reject); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, 12000);
    pc.addEventListener('icegatheringstatechange', on);
  });
}

export class PeerRelaySignalingAdapter {
  localPeerId: string;
  sendFn: (remotePeerId: string, msg: object) => void;
  constructor(localPeerId: string, sendFn: (remotePeerId: string, msg: object) => void) { this.localPeerId = localPeerId; this.sendFn = sendFn; }
  get name(): string { return 'peer-relay'; }
  createOffer(remotePeerId: string, pc: RTCPeerConnection): Promise<{kind: string; fromPeerId: string; toPeerId: string; description: RTCSessionDescriptionInit | null}> {
    return this._createAndSend('offer', remotePeerId, pc, () => pc.createOffer({ offerToReceiveAudio: true }));
  }
  acceptOffer(_text: string, _pc: RTCPeerConnection): Promise<never> { return Promise.reject(new Error('Relay adapter uses DataChannel, not manual text import.')); }
  acceptAnswer(_text: string, _pc: RTCPeerConnection): Promise<never> { return Promise.reject(new Error('Relay adapter uses DataChannel, not manual text import.')); }
  async _createAndSend(kind: string, remotePeerId: string, pc: RTCPeerConnection, createFn: () => Promise<RTCSessionDescriptionInit>): Promise<{kind: string; fromPeerId: string; toPeerId: string; description: RTCSessionDescriptionInit | null}> {
    const desc = await createFn();
    await pc.setLocalDescription(desc);
    return { kind, fromPeerId: this.localPeerId, toPeerId: remotePeerId, description: pc.localDescription };
  }
  relaySignal(type: string, fromPeerId: string, toPeerId: string, signal: unknown): void { this.sendFn(toPeerId, { type, fromPeerId, toPeerId, signal, sentAt: Date.now() }); }
}

export interface SignalingAdapter {
  name: string;
  createOffer(remotePeerId: string, pc: RTCPeerConnection): Promise<EncodedPayload>;
  acceptOffer(text: string, pc: RTCPeerConnection): Promise<EncodedPayload>;
  acceptAnswer(text: string, pc: RTCPeerConnection): Promise<EncodedPayload>;
  relaySignal(type: string, fromPeerId: string, toPeerId: string, signal: unknown): void;
}

export class OptionalRemoteSignalingAdapter implements SignalingAdapter {
  localPeerId: string;
  apiBaseUrl: string;
  constructor(localPeerId: string, apiBaseUrl: string) { this.localPeerId = localPeerId; this.apiBaseUrl = apiBaseUrl; }
  get name(): string { return 'optional-remote'; }
  async createOffer(remotePeerId: string, pc: RTCPeerConnection): Promise<EncodedPayload> {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    const payload = await waitForIceAndEncode('offer', this.localPeerId, remotePeerId, pc);
    await fetch(`${this.apiBaseUrl}/rooms/${encodeURIComponent(remotePeerId)}/offer`, {
      method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }
    });
    return payload;
  }
  async acceptOffer(text: string, pc: RTCPeerConnection): Promise<EncodedPayload> {
    const payload = await decodeSignalPayload(text);
    if (payload.kind !== 'offer') throw new Error('Expected offer payload.');
    await pc.setRemoteDescription(payload.description as RTCSessionDescriptionInit);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const answerPayload = await waitForIceAndEncode('answer', this.localPeerId, payload.fromPeerId, pc);
    await fetch(`${this.apiBaseUrl}/rooms/${encodeURIComponent(payload.fromPeerId)}/answer`, {
      method: 'POST', body: JSON.stringify(answerPayload), headers: { 'Content-Type': 'application/json' }
    });
    return answerPayload;
  }
  async acceptAnswer(_text: string, _pc: RTCPeerConnection): Promise<EncodedPayload> {
    throw new Error('Remote adapter uses server relay; poll for answer instead.');
  }
  relaySignal(type: string, fromPeerId: string, toPeerId: string, signal: unknown): void {
    fetch(`${this.apiBaseUrl}/rooms/${encodeURIComponent(toPeerId)}/signal`, {
      method: 'POST',
      body: JSON.stringify({ type, fromPeerId, toPeerId, signal, sentAt: Date.now() }),
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
  }
}

function b64url(bytes: Uint8Array): string {
  let s = ''; bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64url(s: string): Uint8Array {
  s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length % 4) s += '=';
  const bin = atob(s); return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function compress(bytes: Uint8Array): Promise<{alg: string; bytes: Uint8Array}> {
  if (!('CompressionStream' in globalThis)) return { alg:'plain', bytes };
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return { alg:'deflate', bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
}
async function decompress(alg: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (alg === 'plain') return bytes;
  if (!('DecompressionStream' in globalThis)) throw new Error('Deflate payload unsupported in this runtime. Use a modern browser.');
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export function stripSdpForManual(sdp: string): string {
  return sdp;
}
export async function encodeSignalPayload(payload: Record<string, unknown>): Promise<EncodedPayload> {
  const body = { v:1, app:'carryokie', createdAt:Date.now(), ...payload };
  if (typeof body.description === 'object' && body.description !== null && 'sdp' in (body.description as object)) (body.description as {sdp: string}).sdp = stripSdpForManual((body.description as {sdp: string}).sdp);
  const packed = await compress(enc.encode(JSON.stringify(body)));
  const token = `ck1.${packed.alg}.${b64url(packed.bytes)}`;
  const loc = globalThis.location || { origin: 'http://localhost', pathname: '/player/' };
  return { token, url: `${loc.origin}${loc.pathname}#signal=${token}`, chunks: chunkToken(token) };
}
export async function decodeSignalPayload(input: string): Promise<SignalPayload> {
  const token = extractToken(input);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'ck1') throw new Error('Signal import failed: unsupported CarryOkie payload.');
  const bytes = await decompress(parts[1], unb64url(parts[2]));
  const payload = JSON.parse(dec.decode(bytes)) as SignalPayload;
  if (payload.app !== 'carryokie') throw new Error('Signal import failed: not a CarryOkie payload.');
  return payload;
}
export function extractToken(input: string): string {
  input = (input || '').trim();
  if (input.startsWith('chunk:')) throw new Error('Paste all chunks into the multi-chunk field before import.');
  try { const u = new URL(input); const hash = new URLSearchParams(u.hash.slice(1)); if (hash.get('signal')) return hash.get('signal')!; } catch {}
  const m = input.match(/ck1\.[a-z]+\.[A-Za-z0-9_-]+/); if (!m) throw new Error('Signal import failed: no payload found.');
  return m[0];
}
export function chunkToken(token: string, size = 150): string[] {
  const n = Math.ceil(token.length / size);
  return Array.from({length:n}, (_,i) => `chunk:${i+1}/${n}:${token.slice(i*size,(i+1)*size)}`);
}
export function joinChunks(text: string): string {
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const parts = lines.map(l => { const m = l.match(/^chunk:(\d+)\/(\d+):(.+)$/); if (!m) return null; return {i:+m[1], n:+m[2], data:m[3]}; });
  if (parts.some(p => !p)) return text;
  const n = parts[0]!.n; if (parts.length !== n) throw new Error(`Need ${n} chunks, got ${parts.length}.`);
  return parts.sort((a,b) => a!.i - b!.i).map(p => p!.data).join('');
}
export function renderPayloadCard(target: HTMLElement, encoded: EncodedPayload, label = 'Signal payload'): void {
  const qrItems = encoded.chunks.map((chunk, i) => `<figure><figcaption>QR chunk ${i+1}/${encoded.chunks.length}</figcaption>${qrSvg(chunk)}</figure>`).join('');
  target.innerHTML = `<div class="payload"><h3>${label}</h3><p>Scan QR chunks in order, or use link/share/copy. Chunk fallback keeps payload local; no QR server used.</p>${qrItems}<textarea readonly>${encoded.url}</textarea><div class="actions"><button data-copy>Copy</button><button data-share>Share</button></div><details><summary>Chunk text (${encoded.chunks.length})</summary><textarea readonly>${encoded.chunks.join('\n')}</textarea></details></div>`;
  target.querySelector('[data-copy]')!.onclick = () => navigator.clipboard.writeText(encoded.url);
  target.querySelector('[data-share]')!.onclick = async () => navigator.share ? await navigator.share({title:'CarryOkie signal', text:encoded.url}) : navigator.clipboard.writeText(encoded.url);
}
