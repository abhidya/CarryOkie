import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const DOWNLOAD_MP4_DIR = path.join(ROOT, 'downloads', 'mp4');
const PUBLIC_SONGS_DIR = path.join(ROOT, 'public', 'songs');
const OUT_DIR = path.join(ROOT, 'public', 'protected');
const MEDIA_DIR = path.join(OUT_DIR, 'media');
const CATALOG_PATH = path.join(OUT_DIR, 'catalog.json');
const KEY_FILE = path.join(ROOT, 'src', 'mediaKey.ts');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readKey() {
  const text = fs.readFileSync(KEY_FILE, 'utf8');
  const match = text.match(/MEDIA_KEY_B64\s*:\s*string\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error(`Missing MEDIA_KEY_B64 in ${KEY_FILE}`);
  const key = Buffer.from(match[1], 'base64');
  if (key.length !== 32) throw new Error('MEDIA_KEY_B64 must decode to 32 bytes for AES-256-GCM');
  return key;
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function titleCaseFromFilename(file) {
  return path.basename(file, path.extname(file)).replace(/ \[[^\]]+\]$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseArtistTitle(baseTitle) {
  const cleaned = baseTitle.replace(/ Karaoke Version$/i, '').trim();
  const parts = cleaned.split(' - ');
  if (parts.length >= 2) return { artist: parts.shift(), title: parts.join(' - ') + ' (Karaoke Version)' };
  return { artist: 'Unknown', title: baseTitle };
}
function videoIdFromFilename(file) {
  const match = path.basename(file).match(/\[([A-Za-z0-9_-]{6,})\]\.mp4$/);
  return match?.[1] || null;
}
function localPathFromPublicUrl(url) {
  if (!url) return null;
  const decoded = decodeURIComponent(url);
  const relative = decoded.replace(/^\//, '');
  const local = path.join(ROOT, relative);
  return fs.existsSync(local) ? local : null;
}
function encryptFile(file, key) {
  const plain = fs.readFileSync(file);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted: Buffer.concat([ciphertext, tag]), iv, plainSha256: sha256(plain), byteLength: plain.length };
}
function writeEncrypted(file, key, mimeType) {
  const encryptedName = `${crypto.randomBytes(16).toString('hex')}.bin`;
  const outPath = path.join(MEDIA_DIR, encryptedName);
  const encrypted = encryptFile(file, key);
  fs.writeFileSync(outPath, encrypted.encrypted);
  return {
    url: `/public/protected/media/${encryptedName}`,
    mimeType,
    algorithm: 'AES-256-GCM',
    iv: encrypted.iv.toString('base64'),
    tagBytesAppended: 16,
    plainSha256: encrypted.plainSha256,
    plainByteLength: encrypted.byteLength
  };
}
function collectDownloadMp4() {
  if (!fs.existsSync(DOWNLOAD_MP4_DIR)) return [];
  return fs.readdirSync(DOWNLOAD_MP4_DIR).filter(f => f.endsWith('.mp4')).sort().map(name => {
    const file = path.join(DOWNLOAD_MP4_DIR, name);
    const videoId = videoIdFromFilename(file);
    if (!videoId) return null;
    const parsed = parseArtistTitle(titleCaseFromFilename(file));
    return { source:'downloads/mp4', songId:`yt_${videoId}`, title:parsed.title, artist:parsed.artist, sourceVideoId:videoId, videoFile:file, audioFile:null };
  }).filter(Boolean);
}
function collectPublicSongs() {
  if (!fs.existsSync(PUBLIC_SONGS_DIR)) return [];
  return fs.readdirSync(PUBLIC_SONGS_DIR, { withFileTypes:true }).filter(d => d.isDirectory()).map(d => {
    const dir = path.join(PUBLIC_SONGS_DIR, d.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJson(manifestPath);
    const videoFile = localPathFromPublicUrl(manifest.castMediaUrl);
    if (!videoFile || !videoFile.endsWith('.mp4')) return null;
    const audioFile = localPathFromPublicUrl(manifest.phoneBackingAudioUrl);
    return { source:'public/songs', songId:manifest.songId, title:manifest.title, artist:manifest.artist, sourceVideoId:manifest.songId, videoFile, audioFile:audioFile?.endsWith('.mp3') ? audioFile : null, durationMs:manifest.durationMs ?? null };
  }).filter(Boolean);
}

const sources = [...collectPublicSongs(), ...collectDownloadMp4()];
if (!sources.length) throw new Error('No MP4 files found in downloads/mp4 or public/songs manifests');

fs.rmSync(MEDIA_DIR, { recursive:true, force:true });
fs.mkdirSync(MEDIA_DIR, { recursive:true });
const key = readKey();
const songs = [];
const failures = [];

for (const source of sources) {
  try {
    const song = {
      songId: source.songId,
      title: source.title,
      artist: source.artist,
      durationMs: source.durationMs ?? null,
      isLyricVideo: true,
      source: source.source,
      sourceVideoId: source.sourceVideoId,
      licenseInfo: 'user-provided/locally imported media; verify rights before deployment',
      encryptedMedia: writeEncrypted(source.videoFile, key, 'video/mp4')
    };
    if (source.audioFile) song.encryptedAudio = writeEncrypted(source.audioFile, key, 'audio/mpeg');
    songs.push(song);
  } catch (err) {
    const reason = err?.message || `${err}`;
    console.error(`SKIP ${source.songId}: ${reason} (file: ${source.videoFile})`);
    failures.push({ songId: source.songId, file: source.videoFile, reason });
  }
}
fs.mkdirSync(OUT_DIR, { recursive:true });
fs.writeFileSync(CATALOG_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), sources: ['public/songs', 'downloads/mp4'], songs }, null, 2) + '\n');
console.log(`Imported ${songs.length} encrypted lyric videos into ${MEDIA_DIR}`);
if (failures.length) {
  console.error(`${failures.length} skipped (see above): ${failures.map(f => f.songId).join(', ')}`);
  process.exitCode = 1;
}
console.log(`Wrote ${CATALOG_PATH}`);
