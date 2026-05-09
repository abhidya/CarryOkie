import assert from "node:assert/strict";
import { makePlayer, makeRoom, queueRequest, addPlayer } from "../src/state.ts";
import { normalizeSong, formatSongTitle } from "../src/app/catalog.ts";
import { lyricView } from "../src/app/lyricsView.ts";
import { queueHtml } from "../src/app/queueView.ts";
import {
  applyPhoneQueueUpdate,
  handleQueueAddRequest,
  validSingerNumbers,
} from "../src/app/queueService.ts";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function roomWithParticipant() {
  const host = makePlayer("host", "Host");
  host.playerNumber = 1;
  const room = makeRoom(host);
  const singer = makePlayer("participant", "Singer");
  singer.peerId = "phone-peer";
  singer.playerId = "phone-player";
  addPlayer(room, singer);
  return { room, singer };
}

test("catalog song normalization preserves ids and rewrites public paths", () => {
  const appModuleUrl = new URL("../src/app.ts", import.meta.url);
  const song = normalizeSong({
    songId: "song_1",
    title: "Title",
    artist: "Artist",
    lyricsJsonUrl: "/public/protected/song.lyrics.json",
    castMediaUrl: "media/song.mp4",
  }, appModuleUrl);
  assert.equal(song.songId, "song_1");
  assert.ok(song.lyricsJsonUrl.endsWith("/protected/song.lyrics.json"));
  assert.ok(song.castMediaUrl.endsWith("/media/song.mp4"));
  assert.equal(formatSongTitle(song, "song_1"), "Title — Artist");
  assert.equal(formatSongTitle(undefined, "missing"), "missing");
});

test("lyric view marks latest active line and escapes lyric text", () => {
  const html = lyricView(
    [
      { startMs: 0, text: "First" },
      { startMs: 5000, text: "<Second>" },
    ],
    6000,
  );
  assert.match(html, /<p class="">First<\/p>/);
  assert.match(html, /<p class="active">&lt;Second&gt;<\/p>/);
});

test("queue view keeps host and phone controls tied to queue status", () => {
  const { room, singer } = roomWithParticipant();
  const item = queueRequest("song_1", [2], singer.playerId, 0);
  item.queueItemId = "queue12345";
  room.queue.push(item);
  const hostHtml = queueHtml(room, "host", () => "Song One", singer);
  assert.match(hostHtml, /class="acceptItem"/);
  assert.match(hostHtml, /class="rejectItem"/);
  assert.doesNotMatch(hostHtml, /class="startItem"/);
  const phoneHtml = queueHtml(room, "phone", () => "Song One", singer);
  assert.match(phoneHtml, /data-action="join"/);
  assert.match(phoneHtml, /Remove request/);
});

test("queue service validates paired requester, catalog song, and singer numbers", () => {
  const { room, singer } = roomWithParticipant();
  assert.deepEqual(validSingerNumbers(room, [2, 2, 99, "2"]), [2]);
  handleQueueAddRequest(room, [{ songId: "song_1" }], "phone-peer", {
    item: {
      queueItemId: "queue12345",
      songId: "song_1",
      singerNumbers: [99],
      requestedByPlayerId: singer.playerId,
      status: "requested",
      createdAt: Date.now(),
      acceptedAt: null,
    },
  });
  assert.equal(room.queue.length, 1);
  assert.deepEqual(room.queue[0].singerNumbers, [singer.playerNumber]);
  assert.throws(
    () =>
      handleQueueAddRequest(room, [], "phone-peer", {
        item: { songId: "missing", requestedByPlayerId: singer.playerId },
      }),
    /not in this room catalog/,
  );
});

test("queue service allows phone actor to update only its own open item", () => {
  const { room, singer } = roomWithParticipant();
  const item = queueRequest("song_1", [1], singer.playerId, 0);
  item.queueItemId = "queue12345";
  room.queue.push(item);
  applyPhoneQueueUpdate(room, "phone-peer", {
    playerId: singer.playerId,
    queueItemId: item.queueItemId,
    action: "join",
  });
  assert.deepEqual(room.queue[0].singerNumbers, [1, singer.playerNumber]);
  applyPhoneQueueUpdate(room, "phone-peer", {
    playerId: singer.playerId,
    queueItemId: item.queueItemId,
    action: "leave",
  });
  assert.deepEqual(room.queue[0].singerNumbers, [1]);
  applyPhoneQueueUpdate(room, "phone-peer", {
    playerId: singer.playerId,
    queueItemId: item.queueItemId,
    action: "remove",
  });
  assert.equal(room.queue.length, 0);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (error) {
    failed++;
    console.error("FAIL", name);
    console.error(error.stack || error);
  }
}
if (failed) process.exit(1);
console.log(`All ${tests.length} app refactor tests passed`);
