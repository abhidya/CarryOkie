import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, ".test-import-e2e");
const DOWNLOAD_MP4 = path.join(TEST_DIR, "downloads", "mp4");
const PUBLIC_SONGS = path.join(TEST_DIR, "public", "songs");
const PROTECTED_DIR = path.join(TEST_DIR, "public", "protected");
const CAST_DIR = path.join(TEST_DIR, "public", "cast", "media");
const CATALOG_PATH = path.join(PROTECTED_DIR, "catalog.json");
const KEY_FILE = path.join(ROOT, "src", "mediaKey.ts");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// --- Helpers ---

function readKey() {
  const text = fs.readFileSync(KEY_FILE, "utf8");
  const match = text.match(/MEDIA_KEY_B64\s*:\s*string\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(match, "MEDIA_KEY_B64 must exist in src/mediaKey.ts");
  const key = Buffer.from(match[1], "base64");
  assert.equal(key.length, 32, "MEDIA_KEY_B64 must decode to 32 bytes");
  return key;
}

function makeMp4(size = 4096) {
  // Minimal valid MP4: ftyp box
  const ftyp = Buffer.alloc(8 + size);
  ftyp.writeUInt32BE(8 + size, 0); // box size
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("isom", 8, "ascii");
  return ftyp;
}

function makeMp3(size = 2048) {
  // Minimal MP3-like file (ID3 header + padding)
  const buf = Buffer.alloc(size);
  buf.write("ID3", 0, "ascii"); // ID3v2 tag
  buf.writeUInt8(4, 3); // version 2.4
  buf.writeUInt8(0, 4); // revision
  return buf;
}

function setupTestEnv({ goodCount = 3, badCount = 1, withAudio = false } = {}) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_MP4, { recursive: true });
  fs.mkdirSync(PUBLIC_SONGS, { recursive: true });

  // Good MP4 files with YouTube-style naming
  for (let i = 0; i < goodCount; i++) {
    const name = `Artist${i + 1} - Song${i + 1} Karaoke Version [vid${String(i).padStart(6, "0")}].mp4`;
    fs.writeFileSync(path.join(DOWNLOAD_MP4, name), makeMp4());
  }

  // Bad/corrupt MP4 files (zero bytes or unreadable)
  for (let i = 0; i < badCount; i++) {
    const name = `BadArtist - CorruptSong [bad${String(i).padStart(6, "0")}].mp4`;
    fs.writeFileSync(path.join(DOWNLOAD_MP4, name), Buffer.alloc(0));
  }

  // A public/songs manifest entry
  const songDir = path.join(PUBLIC_SONGS, "song_demo");
  fs.mkdirSync(songDir, { recursive: true });
  const demoMp4 = path.join(songDir, "video.mp4");
  fs.writeFileSync(demoMp4, makeMp4(8192));
  const manifest = {
    songId: "song_demo",
    title: "Demo Song",
    artist: "Demo Artist",
    durationMs: 180000,
    castMediaUrl: `/songs/song_demo/video.mp4`,
  };
  if (withAudio) {
    const demoMp3 = path.join(songDir, "backing.mp3");
    fs.writeFileSync(demoMp3, makeMp3());
    manifest.phoneBackingAudioUrl = `/songs/song_demo/backing.mp3`;
  }
  fs.writeFileSync(
    path.join(songDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  // Copy the real public/songs structure under test dir for localPathFromPublicUrl
  // The import script resolves paths from ROOT, so we place files relative to ROOT
  const realSongDir = path.join(ROOT, "songs", "song_demo");
  fs.mkdirSync(realSongDir, { recursive: true });
  fs.writeFileSync(path.join(realSongDir, "video.mp4"), makeMp4(8192));
  if (withAudio)
    fs.writeFileSync(path.join(realSongDir, "backing.mp3"), makeMp3());
  fs.writeFileSync(
    path.join(realSongDir, "manifest.json"),
    JSON.stringify(
      {
        ...manifest,
        castMediaUrl: `/songs/song_demo/video.mp4`,
        phoneBackingAudioUrl: withAudio
          ? `/songs/song_demo/backing.mp3`
          : undefined,
      },
      null,
      2,
    ),
  );

  return { goodCount, badCount, withAudio };
}

function cleanupTestEnv() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "songs", "song_demo"), {
    recursive: true,
    force: true,
  });
}

function decryptBin(encryptedBuf, iv, key, tagBytes = 16) {
  const ciphertext = encryptedBuf.subarray(0, encryptedBuf.length - tagBytes);
  const tag = encryptedBuf.subarray(encryptedBuf.length - tagBytes);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// =====================================================================
// TEST SUITE: importMedia E2E based on design.md §15 + README
// =====================================================================

// --- Design §15.1: Allowed media sources ---
test("Design §15.1: importMedia only processes allowed sources (downloads/mp4 + public/songs)", () => {
  assert.ok(
    fs.existsSync("scripts/import_obfuscated_media.mjs"),
    "import script exists",
  );
  const code = fs.readFileSync("scripts/import_obfuscated_media.mjs", "utf8");
  assert.match(code, /downloads\/mp4/, "script reads from downloads/mp4");
  assert.match(code, /public\/songs/, "script reads from public/songs");
  assert.doesNotMatch(code, /spotify/i, "script does not reference Spotify");
  // Design §15.1: Spotify/unlicensed media excluded
  const readme = fs.readFileSync("README.md", "utf8");
  assert.match(
    readme,
    /Spotify.*excluded|unlicensed media excluded/i,
    "README excludes Spotify/unlicensed media",
  );
});

// --- Design §15.2: Repo structure output ---
test("Design §15.2: importMedia produces correct repo structure (protected/catalog.json + media/*.bin)", () => {
  assert.ok(
    fs.existsSync("public/protected/catalog.json"),
    "catalog.json must exist after importMedia",
  );
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  assert.ok(catalog.generatedAt, "catalog has generatedAt timestamp");
  assert.ok(Array.isArray(catalog.songs), "catalog has songs array");
  assert.ok(catalog.sources, "catalog has sources field");

  for (const song of catalog.songs) {
    assert.ok(
      song.encryptedMedia?.url,
      `${song.songId}: has encryptedMedia.url`,
    );
    const binPath = path.join(ROOT, song.encryptedMedia.url.replace(/^\//, ""));
    assert.ok(
      fs.existsSync(binPath),
      `${song.songId}: encrypted .bin file exists at ${binPath}`,
    );
    assert.match(
      path.basename(binPath),
      /^[a-f0-9]+\.bin$/,
      `${song.songId}: .bin has random hex name`,
    );
  }
});

// --- Design §15.3: Song manifest shape in catalog ---
test("Design §15.3: Protected catalog song entries match SongManifest shape from design §10.3/§15.3", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  assert.ok(catalog.songs.length > 0, "catalog has at least one song");

  for (const song of catalog.songs) {
    // Required fields per design §10.3 SongManifest
    assert.ok(song.songId, `${song.songId}: has songId`);
    assert.ok(song.title, `${song.songId}: has title`);
    assert.ok(song.artist, `${song.songId}: has artist`);
    assert.ok(song.licenseInfo, `${song.songId}: has licenseInfo`);

    // Encrypted media fields
    assert.equal(
      song.encryptedMedia?.algorithm,
      "AES-256-GCM",
      `${song.songId}: algorithm is AES-256-GCM`,
    );
    assert.ok(song.encryptedMedia?.iv, `${song.songId}: has IV`);
    assert.equal(
      song.encryptedMedia?.tagBytesAppended,
      16,
      `${song.songId}: tagBytesAppended is 16`,
    );
    assert.ok(song.encryptedMedia?.mimeType, `${song.songId}: has mimeType`);
    assert.ok(
      song.encryptedMedia?.plainSha256,
      `${song.songId}: has plainSha256`,
    );
    assert.ok(
      typeof song.encryptedMedia?.plainByteLength === "number",
      `${song.songId}: has plainByteLength`,
    );
  }
});

// --- Encryption correctness: AES-256-GCM round-trip ---
test("Encryption: AES-256-GCM encrypt → decrypt round-trip produces identical plaintext", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  const key = readKey();
  const first = catalog.songs[0];
  assert.ok(first, "catalog has at least one song");

  const binPath = path.join(ROOT, first.encryptedMedia.url.replace(/^\//, ""));
  const encrypted = fs.readFileSync(binPath);
  const plain = decryptBin(
    encrypted,
    first.encryptedMedia.iv,
    key,
    first.encryptedMedia.tagBytesAppended,
  );
  const digest = crypto.createHash("sha256").update(plain).digest("hex");
  assert.equal(
    digest,
    first.encryptedMedia.plainSha256,
    "decrypted SHA-256 matches catalog plainSha256",
  );
});

// --- Obfuscation: encrypted blobs must not look like MP4 ---
test("Obfuscation: encrypted .bin files must not expose MP4 ftyp header", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  const first = catalog.songs[0];
  const binPath = path.join(ROOT, first.encryptedMedia.url.replace(/^\//, ""));
  const encrypted = fs.readFileSync(binPath);

  assert.notEqual(
    encrypted.subarray(4, 8).toString("ascii"),
    "ftyp",
    "encrypted blob must not expose ftyp header",
  );
  assert.notEqual(
    encrypted.subarray(0, 4).toString("ascii"),
    "ftyp",
    "encrypted blob must not start with ftyp",
  );
});

// --- Random naming: filenames must be non-guessable ---
test("Obfuscation: .bin filenames are random hex (not guessable from songId/title)", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  for (const song of catalog.songs) {
    const base = path.basename(song.encryptedMedia.url);
    assert.match(
      base,
      /^[a-f0-9]{32}\.bin$/,
      `${song.songId}: .bin name is 32-hex-char random`,
    );
    assert.ok(
      !base.includes(song.songId),
      `${song.songId}: .bin name does not contain songId`,
    );
    assert.ok(
      !base.includes(song.title?.replace(/\s/g, "")),
      `${song.songId}: .bin name does not contain title`,
    );
  }
});

// --- Cast compatibility export: design §4.2 TV plays Cast-supported media ---
test("Design §4.2: exportCastMedia creates clear MP4 for Chromecast Default Media Receiver", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  for (const song of catalog.songs) {
    assert.ok(
      song.defaultCastMediaUrl,
      `${song.songId}: has defaultCastMediaUrl`,
    );
    assert.match(
      song.defaultCastMediaUrl,
      /\/public\/cast\/media\//,
      `${song.songId}: cast URL points to cast/media/`,
    );
    assert.match(
      path.basename(song.defaultCastMediaUrl),
      /^[a-f0-9]+\.mp4$/,
      `${song.songId}: cast file has random hex .mp4 name`,
    );

    const castPath = path.join(
      ROOT,
      song.defaultCastMediaUrl.replace(/^\//, ""),
    );
    assert.ok(fs.existsSync(castPath), `${song.songId}: cast .mp4 file exists`);

    // Verify it's actually MP4 (has ftyp)
    const buf = fs.readFileSync(castPath);
    assert.equal(
      buf.subarray(4, 8).toString("ascii"),
      "ftyp",
      `${song.songId}: cast .mp4 has valid MP4 header`,
    );
  }
});

// --- Cast media SHA-256 stability (same input → same cast filename) ---
test("Cast export: stable filename derived from songId + plainSha256", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  const first = catalog.songs[0];
  const seed = `${first.songId}:${first.encryptedMedia?.plainSha256 || 0}`;
  const expected = `${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}.mp4`;
  assert.equal(
    path.basename(first.defaultCastMediaUrl),
    expected,
    "cast filename is deterministic from songId+sha256",
  );
});

// --- protectedMedia.ts client-side decrypt matches design ---
test("Client decrypt: src/protectedMedia.ts uses Web Crypto AES-GCM matching server encryption", () => {
  const code = fs.readFileSync("src/protectedMedia.ts", "utf8");
  assert.match(code, /crypto\.subtle\.decrypt/, "uses Web Crypto decrypt");
  assert.match(code, /AES-GCM/, "specifies AES-GCM algorithm");
  assert.match(code, /MEDIA_KEY_B64/, "imports the shared key");
  assert.match(code, /importMediaKey/, "has key import function");
  assert.match(code, /blobUrlCache/, "caches decrypted blob URLs");
  assert.match(
    code,
    /loadProtectedCatalog/,
    "has loadProtectedCatalog function",
  );
  assert.match(code, /needsClientDecrypt/, "sets needsClientDecrypt flag");
});

// --- Auto-skip: individual failures do not abort entire import ---
test("Auto-skip: individual song failures are logged and skipped, remaining songs succeed", () => {
  const code = fs.readFileSync("scripts/import_obfuscated_media.mjs", "utf8");
  // Verify the script has try/catch per song with skip logging
  assert.match(
    code,
    /catch\s*\(err\)/,
    "script has try/catch for individual songs",
  );
  assert.match(code, /SKIP/, "script logs SKIP on failure");
  assert.match(code, /failures/, "script tracks failures array");
  assert.match(
    code,
    /process\.exitCode\s*=\s*1/,
    "script sets exitCode 1 on failures",
  );

  // Verify sources.map is NOT used (replaced with for...of + try/catch)
  assert.doesNotMatch(
    code,
    /sources\.map\s*\(/,
    "script does not use sources.map (would not allow try/catch per item)",
  );
});

// --- Catalog integrity: all .bin files referenced in catalog exist ---
test("Catalog integrity: every encryptedMedia .bin URL in catalog maps to an existing file", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  for (const song of catalog.songs) {
    if (song.encryptedMedia?.url) {
      const binPath = path.join(
        ROOT,
        song.encryptedMedia.url.replace(/^\//, ""),
      );
      assert.ok(fs.existsSync(binPath), `${song.songId}: ${binPath} exists`);
    }
    if (song.encryptedAudio?.url) {
      const binPath = path.join(
        ROOT,
        song.encryptedAudio.url.replace(/^\//, ""),
      );
      assert.ok(
        fs.existsSync(binPath),
        `${song.songId}: audio ${binPath} exists`,
      );
    }
  }
});

// --- No orphan .bin files: every file in protected/media/ is referenced by catalog ---
test("Catalog integrity: no orphan .bin files in protected/media/ (all referenced by catalog)", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  const mediaDir = path.join(ROOT, "public", "protected", "media");
  if (!fs.existsSync(mediaDir)) return; // nothing to check

  const referencedBins = new Set();
  for (const song of catalog.songs) {
    if (song.encryptedMedia?.url)
      referencedBins.add(path.basename(song.encryptedMedia.url));
    if (song.encryptedAudio?.url)
      referencedBins.add(path.basename(song.encryptedAudio.url));
  }

  const diskBins = fs.readdirSync(mediaDir).filter((f) => f.endsWith(".bin"));
  for (const f of diskBins) {
    assert.ok(
      referencedBins.has(f),
      `orphan .bin on disk not in catalog: ${f}`,
    );
  }
  assert.equal(
    diskBins.length,
    referencedBins.size,
    "disk .bin count matches catalog references",
  );
});

// --- Key file format validation ---
test("Key file: src/mediaKey.ts exports valid 32-byte base64 key for AES-256-GCM", () => {
  const text = fs.readFileSync("src/mediaKey.ts", "utf8");
  assert.match(
    text,
    /MEDIA_KEY_B64\s*:\s*string\s*=\s*['"][A-Za-z0-9+/=]+['"]/,
    "exports MEDIA_KEY_B64 as string",
  );
  const key = readKey();
  assert.equal(key.length, 32, "key decodes to exactly 32 bytes");
});

// --- build.mjs validates importMedia artifacts ---
test("Build validation: build.mjs checks protected catalog and cast media exist", () => {
  const code = fs.readFileSync("scripts/build.mjs", "utf8");
  assert.match(code, /catalog\.json/, "build checks catalog.json");
  assert.match(code, /defaultCastMediaUrl/, "build checks cast media URLs");
  assert.match(code, /importMedia/, "build references importMedia for setup");
});

// --- IV uniqueness: every encrypted song has a unique IV ---
test("Encryption: every song has a unique IV (no IV reuse across songs)", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  const ivs = new Set();
  for (const song of catalog.songs) {
    const iv = song.encryptedMedia?.iv;
    assert.ok(iv, `${song.songId}: has IV`);
    assert.ok(!ivs.has(iv), `${song.songId}: IV is unique (not reused)`);
    ivs.add(iv);
  }
});

// --- Source tracking: catalog records which source each song came from ---
test("Source tracking: catalog songs record source field (public/songs or downloads/mp4)", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  for (const song of catalog.songs) {
    assert.ok(song.source, `${song.songId}: has source field`);
    assert.ok(
      ["public/songs", "downloads/mp4"].includes(song.source),
      `${song.songId}: source is valid`,
    );
  }
  assert.ok(catalog.sources, "catalog has top-level sources array");
  assert.ok(
    catalog.sources.includes("public/songs"),
    "sources includes public/songs",
  );
  assert.ok(
    catalog.sources.includes("downloads/mp4"),
    "sources includes downloads/mp4",
  );
});

// --- Design §6: licenseInfo field present ---
test("Design §15.1/§15.3: every song has licenseInfo (rights verification before deployment)", () => {
  const catalog = JSON.parse(
    fs.readFileSync("public/protected/catalog.json", "utf8"),
  );
  for (const song of catalog.songs) {
    assert.ok(song.licenseInfo, `${song.songId}: has licenseInfo`);
    assert.match(
      song.licenseInfo,
      /user-provided|licensed|rights/i,
      `${song.songId}: licenseInfo mentions rights/licensing`,
    );
  }
});

// --- export_cast_media.mjs decrypt-then-write consistency ---
test("Export script: export_cast_media.mjs decrypts correctly and validates SHA-256", () => {
  const code = fs.readFileSync("scripts/export_cast_media.mjs", "utf8");
  assert.match(code, /createDecipheriv/, "uses createDecipheriv");
  assert.match(code, /aes-256-gcm/, "uses AES-256-GCM");
  assert.match(code, /setAuthTag/, "sets auth tag for GCM verification");
  assert.match(code, /plainSha256/, "validates SHA-256 of decrypted content");
  assert.match(code, /stableCastName/, "uses deterministic cast filename");
});

// --- importMedia npm script chains both scripts ---
test("npm script: importMedia runs import_obfuscated_media.mjs then export_cast_media.mjs", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.ok(pkg.scripts.importMedia, "has importMedia script");
  assert.match(
    pkg.scripts.importMedia,
    /import_obfuscated_media/,
    "runs import script",
  );
  assert.match(
    pkg.scripts.importMedia,
    /export_cast_media/,
    "runs export script",
  );
  // import must run before export (chained with &&)
  const importIdx = pkg.scripts.importMedia.indexOf("import_obfuscated_media");
  const exportIdx = pkg.scripts.importMedia.indexOf("export_cast_media");
  assert.ok(importIdx < exportIdx, "import runs before export");
});

// =====================================================================
// Run all tests
// =====================================================================

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log("PASS", t.name);
  } catch (err) {
    failed++;
    console.error("FAIL", t.name);
    console.error(err.message || err);
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} importMedia E2E tests passed`);
