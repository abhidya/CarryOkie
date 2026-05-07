import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const keyText = fs.readFileSync('src/mediaKey.ts', 'utf8');
const key = Buffer.from(keyText.match(/MEDIA_KEY_B64\s*:\s*string\s*=\s*['"]([^'"]+)['"]/)[1], 'base64');
assert.equal(key.length, 32);

const catalog = JSON.parse(fs.readFileSync('public/protected/catalog.json', 'utf8'));
assert.ok(catalog.songs.length > 0, 'protected catalog imports downloads/mp4 files');
assert.equal(catalog.songs.length, fs.readdirSync('downloads/mp4').filter(f => f.endsWith('.mp4')).length);

for (const song of catalog.songs) {
  assert.match(song.songId, /^(yt_[A-Za-z0-9_-]+|song_00[12])$/);
  assert.equal(song.isLyricVideo, true);
  assert.ok(song.encryptedMedia.url.startsWith('/public/protected/media/'));
  assert.match(path.basename(song.encryptedMedia.url), /^[a-f0-9]{32}\.bin$/);
  assert.equal(song.encryptedMedia.algorithm, 'AES-256-GCM');
  assert.equal(song.encryptedMedia.mimeType, 'video/mp4');
  assert.ok(song.defaultCastMediaUrl?.startsWith('/public/cast/media/'), 'default Chromecast clear export required');
  assert.match(path.basename(song.defaultCastMediaUrl), /^[a-f0-9]{32}\.mp4$/);
  assert.equal(song.defaultCastMediaMimeType, 'video/mp4');
  assert.ok(fs.existsSync(path.join(process.cwd(), song.defaultCastMediaUrl.slice(1))), 'default cast MP4 file exists');
}


const first = catalog.songs[0];
const encryptedPath = path.join(process.cwd(), first.encryptedMedia.url.slice(1));
const encrypted = fs.readFileSync(encryptedPath);
assert.notEqual(encrypted.subarray(0, 8).toString('utf8'), 'ftypmp42', 'encrypted blob should not look like MP4');
assert.notEqual(encrypted.subarray(4, 8).toString('utf8'), 'ftyp', 'encrypted blob should not expose MP4 ftyp header');
const iv = Buffer.from(first.encryptedMedia.iv, 'base64');
const tagBytes = first.encryptedMedia.tagBytesAppended;
const ciphertext = encrypted.subarray(0, encrypted.length - tagBytes);
const tag = encrypted.subarray(encrypted.length - tagBytes);
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
assert.equal(crypto.createHash('sha256').update(plain).digest('hex'), first.encryptedMedia.plainSha256);
assert.equal(plain.subarray(4, 8).toString('utf8'), 'ftyp', 'decrypted media should be MP4');

const protectedMedia = fs.readFileSync('src/protectedMedia.ts', 'utf8');
assert.match(protectedMedia, /crypto\.subtle\.decrypt/);
assert.match(protectedMedia, /MEDIA_KEY_B64/);
const app = fs.readFileSync('src/app.ts', 'utf8');
assert.match(app, /loadProtectedCatalog/);
assert.match(app, /phoneVideo/);
assert.match(app, /Lyric video loaded above/);
const cast = fs.readFileSync('src/cast.ts', 'utf8');
assert.match(cast, /resolveDefaultCastMediaUrl/);
assert.doesNotMatch(cast, /Default Media Receiver cannot decrypt/);
assert.ok(catalog.songs.find(s => s.encryptedMedia?.url), 'at least one song has encrypted video media');
console.log(`PASS protected media obfuscation catalog (${catalog.songs.length} encrypted videos)`);
