import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "public", "protected", "catalog.json");
const CAST_DIR = path.join(ROOT, "public", "cast", "media");
const KEY_FILE = path.join(ROOT, "src", "mediaKey.ts");

function readKey() {
  const text = fs.readFileSync(KEY_FILE, "utf8");
  const match = text.match(/MEDIA_KEY_B64\s*:\s*string\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error(`Missing MEDIA_KEY_B64 in ${KEY_FILE}`);
  const key = Buffer.from(match[1], "base64");
  if (key.length !== 32)
    throw new Error("MEDIA_KEY_B64 must decode to 32 bytes");
  return key;
}
function localPathFromPublicUrl(url) {
  return path.join(ROOT, url.replace(/^\//, ""));
}
function decryptMedia(media, key) {
  const encrypted = fs.readFileSync(localPathFromPublicUrl(media.url));
  const tagBytes = media.tagBytesAppended || 16;
  const ciphertext = encrypted.subarray(0, encrypted.length - tagBytes);
  const tag = encrypted.subarray(encrypted.length - tagBytes);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(media.iv, "base64"),
  );
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const digest = crypto.createHash("sha256").update(plain).digest("hex");
  if (media.plainSha256 && digest !== media.plainSha256)
    throw new Error(`SHA mismatch for ${media.url}`);
  return plain;
}
function stableCastName(song, index) {
  const seed = `${song.songId}:${song.encryptedMedia?.plainSha256 || index}`;
  return `${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}.mp4`;
}

if (!fs.existsSync(CATALOG_PATH)) throw new Error(`Missing ${CATALOG_PATH}`);
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const key = readKey();
fs.rmSync(CAST_DIR, { recursive: true, force: true });
fs.mkdirSync(CAST_DIR, { recursive: true });

let exported = 0;
for (const [index, song] of (catalog.songs || []).entries()) {
  if (!song.encryptedMedia) continue;
  const fileName = stableCastName(song, index);
  const outPath = path.join(CAST_DIR, fileName);
  const plain = decryptMedia(song.encryptedMedia, key);
  fs.writeFileSync(outPath, plain);
  song.defaultCastMediaUrl = `/public/cast/media/${fileName}`;
  song.defaultCastMediaMimeType = song.encryptedMedia.mimeType || "video/mp4";
  exported++;
}

catalog.generatedAt = new Date().toISOString();
catalog.defaultCastExport = {
  generatedAt: catalog.generatedAt,
  note: "Clear MP4 compatibility cache for Chromecast Default Media Receiver. Encrypted browser path remains in public/protected/media.",
};
fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Exported ${exported} Default Cast MP4 files into ${CAST_DIR}`);
console.log(`Updated ${CATALOG_PATH}`);
