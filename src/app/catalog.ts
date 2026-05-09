import { loadProtectedCatalog } from "../protectedMedia.ts";

export interface SongCatalogItem {
  songId: string;
  title?: string;
  artist?: string;
  lyricsJsonUrl?: string | null;
  lyricsVttUrl?: string | null;
  castMediaUrl?: string | null;
  phoneBackingAudioUrl?: string | null;
  thumbnailUrl?: string | null;
  [key: string]: unknown;
}

export function assetUrl(
  path: string | null | undefined,
  baseUrl: string | URL = import.meta.url,
): string | null {
  if (!path) return null;
  const publicPath = path.startsWith("/public/")
    ? path.slice("/public".length)
    : path;
  return publicPath.startsWith("/")
    ? new URL(".." + publicPath, baseUrl).toString()
    : new URL(publicPath, baseUrl).toString();
}

export function normalizeSong(
  song: SongCatalogItem,
  baseUrl: string | URL = import.meta.url,
): SongCatalogItem {
  return {
    ...song,
    lyricsJsonUrl: assetUrl(song.lyricsJsonUrl, baseUrl),
    lyricsVttUrl: assetUrl(song.lyricsVttUrl, baseUrl),
    castMediaUrl: assetUrl(song.castMediaUrl, baseUrl),
    phoneBackingAudioUrl: assetUrl(song.phoneBackingAudioUrl, baseUrl),
    thumbnailUrl: assetUrl(song.thumbnailUrl, baseUrl),
  };
}

export async function loadSongCatalog(
  baseUrl: string | URL = import.meta.url,
): Promise<SongCatalogItem[]> {
  const protectedSongs = await loadProtectedCatalog();
  let plainSongs: SongCatalogItem[] = [];
  try {
    plainSongs = await fetch(assetUrl("/songs/catalog.json", baseUrl)!)
      .then((response) => (response.ok ? response.json() : { songs: [] }))
      .then((catalogJson) =>
        (catalogJson.songs || []).map((song: SongCatalogItem) =>
          normalizeSong(song, baseUrl),
        ),
      );
  } catch {
    // Plain imported songs are optional; protected catalog entries remain usable.
    plainSongs = [];
  }
  return [...protectedSongs, ...plainSongs];
}

export function formatSongTitle(song: SongCatalogItem | undefined, songId: string): string {
  return song
    ? `${song.title || song.songId}${song.artist ? " — " + song.artist : ""}`
    : songId;
}
