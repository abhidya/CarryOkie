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

function hasWebCryptoAes(): boolean {
  return !!globalThis.crypto?.subtle?.importKey && !!globalThis.crypto?.subtle?.decrypt;
}

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}

function resolveAppAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const publicPath = url.startsWith('/public/') ? url.slice('/public'.length) : url;
  if (publicPath.startsWith('/')) return new URL('..' + publicPath, import.meta.url).toString();
  return new URL(publicPath, import.meta.url).toString();
}

function resolveEncryptedMedia(media: EncryptedMedia | undefined): EncryptedMedia | undefined {
  return media ? { ...media, url: resolveAppAssetUrl(media.url)! } : undefined;
}

function normalizeProtectedSong(song: ProtectedSong): ProtectedSong {
  const resolved: ProtectedSong = {
    ...song,
    encryptedMedia: resolveEncryptedMedia(song.encryptedMedia),
    encryptedAudio: resolveEncryptedMedia(song.encryptedAudio),
    castMediaUrl: resolveAppAssetUrl(song.castMediaUrl),
    phoneBackingAudioUrl: resolveAppAssetUrl(song.phoneBackingAudioUrl),
    lyricsJsonUrl: resolveAppAssetUrl(song.lyricsJsonUrl),
    lyricsVttUrl: resolveAppAssetUrl(song.lyricsVttUrl),
    thumbnailUrl: resolveAppAssetUrl(song.thumbnailUrl),
    defaultCastMediaUrl: resolveAppAssetUrl(song.defaultCastMediaUrl),
  };
  if (!resolved.encryptedMedia) return resolved;
  return {
    ...resolved,
    castMediaUrl: null,
    phoneBackingAudioUrl: null,
    lyricsJsonUrl: null,
    lyricsVttUrl: null,
    thumbnailUrl: null,
    needsClientDecrypt: true
  };
}

async function importMediaKey(): Promise<CryptoKey> {
  if (!hasWebCryptoAes()) throw new Error('Protected media decrypt needs Web Crypto. Use HTTPS/GitHub Pages, localhost, or the clear Cast export fallback for local phone testing.');
  keyPromise ||= globalThis.crypto.subtle.importKey('raw', b64ToBytes(MEDIA_KEY_B64) as unknown as ArrayBufferSource, { name:'AES-GCM' }, false, ['decrypt']);
  return keyPromise;
}

export async function loadProtectedCatalog(catalogUrl: string | URL = resolveAppAssetUrl('/protected/catalog.json')!): Promise<ProtectedSong[]> {
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
  const response = await fetch(resolveAppAssetUrl(media.url)!);
  if (!response.ok) throw new Error(`Protected media fetch failed: ${response.status}`);
  const encrypted = new Uint8Array(await response.arrayBuffer());
  const key = await importMediaKey();
  const plain = await globalThis.crypto.subtle.decrypt({ name:'AES-GCM', iv:b64ToBytes(media.iv), tagLength:(media.tagBytesAppended || 16) * 8 }, key, encrypted as unknown as BufferSource);
  const blobUrl = URL.createObjectURL(new Blob([plain], { type: media.mimeType || 'video/mp4' }));
  blobUrlCache.set(song.songId, blobUrl);
  return blobUrl;
}

export async function resolvePlayableMediaUrl(song: ProtectedSong): Promise<string | null> {
  if (song?.encryptedMedia) {
    if (!hasWebCryptoAes() && song.defaultCastMediaUrl) return song.defaultCastMediaUrl;
    return decryptProtectedMedia(song);
  }
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
