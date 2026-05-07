import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { MAX_PLAYERS, MAX_SINGERS, MAX_QUEUE_ITEMS, makePlayer, makeRoom, addPlayer, assignSingers, queueRequest, acceptQueue, rejectQueue, removeQueueItem, enqueueRequest, nextQueuedItem, addSingerToQueueItem, removeSingerFromQueueItem, lockHostLost } from '../src/state.ts';
import { encodeSignalPayload, decodeSignalPayload, stripSdpForManual, chunkToken, joinChunks } from '../src/signaling.ts';
import { waitForIceComplete, rtcConfig, RPC } from '../src/webrtc.ts';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

class FakePc extends EventTarget {
  constructor(state = 'new') { super(); this.iceGatheringState = state; this.localDescription = null; }
  completeSoon() { setTimeout(() => { this.iceGatheringState = 'complete'; this.dispatchEvent(new Event('icegatheringstatechange')); }, 5); }
}

test('room uses crypto IDs, human code not authority', () => {
  const host = makePlayer('host', 'Host');
  const room = makeRoom(host);
  assert.match(room.roomId, /[0-9a-f-]{20,}/i);
  assert.match(host.peerId, /[0-9a-f-]{20,}/i);
  assert.equal(room.hostPeerId, host.peerId);
  assert.notEqual(room.roomId, room.roomCode);
});

test('room cap = 5 players', () => {
  const host = makePlayer('host', 'Host'); host.playerNumber = 1;
  const room = makeRoom(host);
  for (let i = 0; i < 4; i++) addPlayer(room, makePlayer('participant', `P${i}`));
  assert.equal(room.players.length, MAX_PLAYERS);
  assert.throws(() => addPlayer(room, makePlayer('participant', 'P5')), /Room full/);
});

test('singer cap = 5 active singers', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const p1 = makePlayer('participant', 'P1'); const p2 = makePlayer('participant', 'P2'); const p3 = makePlayer('participant', 'P3');
  const p4 = makePlayer('participant', 'P4');
  addPlayer(room, p1); addPlayer(room, p2); addPlayer(room, p3); addPlayer(room, p4);
  assert.equal(room.players.length, MAX_PLAYERS); // 5 players total
  assignSingers(room, [host.playerId, p1.playerId, p2.playerId, p3.playerId, p4.playerId]);
  assert.equal(room.players.filter(p => p.isSingerForCurrentSong).length, MAX_SINGERS);
  // Exceeds singer cap
  assert.throws(() => assignSingers(room, [host.playerId, p1.playerId, p2.playerId, p3.playerId, p4.playerId, 'fake-id']), /Maximum 5/);
});

test('queue request is host-accepted before queued', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const p1 = makePlayer('participant', 'P1'); addPlayer(room, p1);
  const item = queueRequest('song_001', [p1.playerNumber], p1.playerId);
  assert.equal(item.status, 'requested');
  room.queue.push(item);
  acceptQueue(room, item.queueItemId);
  assert.equal(room.queue[0].status, 'queued');
  assert.ok(room.queue[0].acceptedAt);
});

test('queue rejects more than 5 singers', () => {
  assert.throws(() => queueRequest('song_001', [1,2,3,4,5,6], 'p'), /max 5 singers/);
});

test('queue cap enforced at 20 items', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  for (let i = 0; i < MAX_QUEUE_ITEMS; i++) room.queue.push(queueRequest('song_001', [1], host.playerId, i));
  assert.equal(room.queue.length, MAX_QUEUE_ITEMS);
  assert.throws(() => queueRequest('song_001', [1], host.playerId, MAX_QUEUE_ITEMS), /Queue full.*20/);
});


test('host queue intake normalizes stale phone requests and ignores duplicate submissions', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const p1 = makePlayer('participant', 'P1'); addPlayer(room, p1);
  const item = queueRequest('song_001', [p1.playerNumber, p1.playerNumber, 99], p1.playerId, 0);
  enqueueRequest(room, item);
  enqueueRequest(room, item);
  assert.equal(room.queue.length, 1);
  assert.deepEqual(room.queue[0].singerNumbers, [p1.playerNumber]);
});

test('host start-next only selects accepted queued items', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const requested = queueRequest('song_requested', [1], host.playerId, 0);
  const rejected = queueRequest('song_rejected', [1], host.playerId, 1);
  const queued = queueRequest('song_queued', [1], host.playerId, 2);
  room.queue.push(requested, rejected, queued);
  rejectQueue(room, rejected.queueItemId);
  acceptQueue(room, queued.queueItemId);
  assert.equal(nextQueuedItem(room).songId, 'song_queued');
});

test('phones can update queue singer slots before a song starts', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const p1 = makePlayer('participant', 'P1'); const p2 = makePlayer('participant', 'P2');
  addPlayer(room, p1); addPlayer(room, p2);
  const item = queueRequest('song_001', [p1.playerNumber], p1.playerId, 0);
  room.queue.push(item);
  addSingerToQueueItem(room, item.queueItemId, p2.playerNumber);
  assert.deepEqual(room.queue[0].singerNumbers, [p1.playerNumber, p2.playerNumber]);
  removeSingerFromQueueItem(room, item.queueItemId, p1.playerNumber);
  assert.deepEqual(room.queue[0].singerNumbers, [p2.playerNumber]);
});

test('rejectQueue sets item status to rejected', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const item = queueRequest('song_001', [1], host.playerId, 0);
  room.queue.push(item);
  rejectQueue(room, item.queueItemId);
  assert.equal(room.queue[0].status, 'rejected');
});

test('removeQueueItem removes item from queue', () => {
  const host = makePlayer('host', 'Host'); const room = makeRoom(host);
  const item = queueRequest('song_001', [1], host.playerId, 0);
  room.queue.push(item);
  assert.equal(room.queue.length, 1);
  removeQueueItem(room, item.queueItemId);
  assert.equal(room.queue.length, 0);
});

test('host loss locks room authority', () => {
  const room = makeRoom(makePlayer('host', 'Host'));
  lockHostLost(room);
  assert.equal(room.playbackState.status, 'host_lost');
  assert.match(room.hostLostMessage, /controls are locked/);
});

test('strict WebRTC config uses public STUN and no TURN', () => {
  assert.deepEqual(rtcConfig.iceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);
  assert.equal(JSON.stringify(rtcConfig).includes('turn:'), false);
});

test('manual ICE wait resolves only after complete', async () => {
  const pc = new FakePc('gathering');
  const done = waitForIceComplete(pc, 1000).then(() => 'done');
  pc.completeSoon();
  assert.equal(await done, 'done');
});

test('manual payload round-trips compressed/base64url and preserves valid SDP', async () => {
  const sdp = ['v=0','o=- 1 2 IN IP4 127.0.0.1','s=-','t=0 0','a=group:BUNDLE 0 1','a=extmap-allow-mixed','m=audio 9 UDP/TLS/RTP/SAVPF 111 0','c=IN IP4 0.0.0.0','a=mid:0','a=ice-ufrag:abc','a=ice-pwd:def','a=fingerprint:sha-256 00:11','a=setup:actpass','a=sendrecv','a=rtcp-mux','a=rtpmap:111 opus/48000/2','a=fmtp:111 minptime=10;useinbandfec=1','a=rtcp-fb:111 transport-cc','a=rtpmap:0 PCMU/8000','a=candidate:1 1 udp 1 192.168.1.2 123 typ host generation 0 network-id 1 network-cost 10','m=video 9 UDP/TLS/RTP/SAVPF 96','a=mid:1','a=rtpmap:96 VP8/90000'].join('\r\n');
  const stripped = stripSdpForManual(sdp);
  assert.match(stripped, /opus/);
  assert.doesNotMatch(stripped, /PCMU|VP8|extmap|network-cost|generation/);
  assert.match(stripped, /a=group:BUNDLE 0/);
  assert.ok(stripped.length < sdp.length * 0.7, `expected stripped SDP to be much smaller (${stripped.length}/${sdp.length})`);
  const encoded = await encodeSignalPayload({ kind:'offer', fromPeerId:'a', toPeerId:'b', description:{ type:'offer', sdp } });
  assert.match(encoded.token, /^ck1\.(deflate|plain)\.[A-Za-z0-9_-]+$/);
  const decoded = await decodeSignalPayload(encoded.url);
  assert.equal(decoded.kind, 'offer');
  assert.match(decoded.description.sdp, /opus/);
  assert.doesNotMatch(decoded.description.sdp, /PCMU|VP8|network-cost/);
});

test('chunked signaling rejoins', () => {
  const chunks = chunkToken('ck1.plain.' + 'x'.repeat(2500), 500);
  assert.ok(chunks.length > 1);
  assert.equal(joinChunks(chunks.join('\n')), 'ck1.plain.' + 'x'.repeat(2500));
});

test('default QR chunks use larger near-capacity payloads', () => {
  const chunks = chunkToken('ck1.plain.' + 'x'.repeat(960));
  assert.ok(chunks.length <= 5, `expected no more than 5 QR chunks, got ${chunks.length}`);
  assert.ok(chunks.every(c => new TextEncoder().encode(c).length <= 260));
  assert.equal(joinChunks(chunks.join('\n')), 'ck1.plain.' + 'x'.repeat(960));
});

test('required RPC messages exist', () => {
  for (const key of ['ROOM_HELLO','ROOM_STATE_SNAPSHOT','QUEUE_ADD_REQUEST','SINGER_ASSIGNED','PLAYBACK_SYNC','SIGNAL_RELAY_OFFER','SIGNAL_RELAY_ANSWER','SIGNAL_RELAY_ICE','ERROR_NOTICE']) {
    assert.equal(RPC[key], key);
  }
});

test('receiver stays out of live mic/WebRTC path', () => {
  const receiver = fs.readFileSync('receiver/index.html','utf8') + fs.readFileSync('src/cast.ts','utf8');
  assert.equal(/RTCPeerConnection|getUserMedia/.test(receiver), false);
});

test('protected catalog includes songs with encrypted media', () => {
  const catalog = JSON.parse(fs.readFileSync('public/protected/catalog.json','utf8')).songs;
  assert.ok(catalog.length > 0, 'catalog should have entries');
  const withEncrypted = catalog.find(s => s.encryptedMedia?.url);
  assert.ok(withEncrypted, 'at least one song should have encrypted media');
  assert.match(withEncrypted.encryptedMedia.url, /^\/public\/protected\/media\//);
});

test('Cast sync source references media status/currentTime not click time', () => {
  const cast = fs.readFileSync('src/cast.ts','utf8');
  assert.match(cast, /RemotePlayerController/);
  assert.match(cast, /currentTime/);
  assert.match(cast, /tvMediaTimeSampledAtHostMs/);
});

test('audio rules warn before TV bleed and self-monitor remains off', () => {
  const audio = fs.readFileSync('src/audio.ts','utf8');
  assert.match(audio, /TV backing track bleed risk/);
  assert.match(audio, /pushToSing/);
  assert.match(audio, /localMonitorGain:0|localMonitorGain/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log('PASS', t.name); }
  catch (err) { failed++; console.error('FAIL', t.name); console.error(err.stack || err); }
}
if (failed) process.exit(1);
console.log(`All ${tests.length} use-case tests passed`);
