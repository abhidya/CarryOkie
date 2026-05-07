import { MEDIA_KEY_B64 } from './mediaKey.ts';

interface EncryptedMedia {
  url: string;
  iv: string;
  tagBytesAppended: number;
  mimeType: string;
  plainSha256?: string;
}

interface ProtectedSong {
  songId: string;
  title?: string;
  artist?: string;
  encryptedMedia?: EncryptedMedia;
  encryptedAudio?: EncryptedMedia;
  castMediaUrl?: string | null;
  phoneBackingAudioUrl?: string | null;
  lyricsJsonUrl?: string | null;
  lyricsVttUrl?: string | null;
  thumbnailUrl?: string | null;
  defaultCastMediaUrl?: string | null;
  defaultCastMediaMimeType?: string;
  isLyricVideo?: boolean;
  durationMs?: number | null;
  needsClientDecrypt?: boolean;
  [key: string]: unknown;
}

const blobUrlCache = new Map<string, string>();
let keyPromise: Promise<CryptoKey> | undefined;

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}

function normalizeProtectedSong(song: ProtectedSong): ProtectedSong {
  if (!song.encryptedMedia) return song;
  return {
    ...song,
    castMediaUrl: null,
    phoneBackingAudioUrl: null,
    lyricsJsonUrl: null,
    lyricsVttUrl: null,
    thumbnailUrl: null,
    needsClientDecrypt: true
  };
}

async function importMediaKey(): Promise<CryptoKey> {
  keyPromise ||= crypto.subtle.importKey('raw', b64ToBytes(MEDIA_KEY_B64) as unknown as ArrayBufferSource, { name:'AES-GCM' }, false, ['decrypt']);
  return keyPromise;
}

export async function loadProtectedCatalog(catalogUrl: URL = new URL('../public/protected/catalog.json', import.meta.url)): Promise<ProtectedSong[]> {
  try {
    const response = await fetch(catalogUrl);
    if (!response.ok) return [];
    const catalog = await response.json() as { songs?: ProtectedSong[] };
    return (catalog.songs || []).map(normalizeProtectedSong);
  } catch {
    return [];
  }
}

export async function decryptProtectedMedia(song: ProtectedSong): Promise<string | null> {
  if (!song?.encryptedMedia) return null;
  const media = song.encryptedMedia;
  if (blobUrlCache.has(song.songId)) return blobUrlCache.get(song.songId)!;
  const response = await fetch(new URL('..' + media.url, import.meta.url));
  if (!response.ok) throw new Error(`Protected media fetch failed: ${response.status}`);
  const encrypted = new Uint8Array(await response.arrayBuffer());
  const key = await importMediaKey();
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64ToBytes(media.iv), tagLength:(media.tagBytesAppended || 16) * 8 }, key, encrypted as unknown as BufferSource);
  const blobUrl = URL.createObjectURL(new Blob([plain], { type: media.mimeType || 'video/mp4' }));
  blobUrlCache.set(song.songId, blobUrl);
  return blobUrl;
}

export async function resolvePlayableMediaUrl(song: ProtectedSong): Promise<string | null> {
  if (song?.encryptedMedia) return decryptProtectedMedia(song);
  return song?.castMediaUrl || song?.phoneBackingAudioUrl || null;
}

export function resolveDefaultCastMediaUrl(song: ProtectedSong): string | null {
  return song?.defaultCastMediaUrl || (!song?.encryptedMedia ? song?.castMediaUrl : null) || null;
}

export function resolveDefaultCastMediaType(song: ProtectedSong): string {
  return song?.defaultCastMediaMimeType || song?.encryptedMedia?.mimeType || 'video/mp4';
}

export function isProtectedMedia(song: ProtectedSong): boolean {
  return !!song?.encryptedMedia;
}

export function clearProtectedMediaCache(): void {
  for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
  blobUrlCache.clear();
}
