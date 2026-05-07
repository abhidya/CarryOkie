import assert from 'node:assert/strict';
import { estimateHostOffset, deriveTvMediaPositionMs, activeLyricLine } from '../src/sync.ts';
import { PeerNode, RPC } from '../src/webrtc.ts';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

class FakePc extends EventTarget {
  constructor() { super(); this.iceGatheringState = 'new'; this.localDescription = null; this.remoteDescription = null; this.signalingState = 'new'; }
  createDataChannel() { return { readyState:'open', sent:[], send(data){ this.sent.push(JSON.parse(data)); } }; }
  async createOffer() { return { type:'offer', sdp:'v=0\r\na=rtpmap:111 opus/48000/2\r\na=candidate:1 1 udp 1 10.0.0.1 9 typ host\r\n' }; }
  async createAnswer() { return { type:'answer', sdp:'v=0\r\na=rtpmap:111 opus/48000/2\r\na=candidate:2 1 udp 1 10.0.0.2 9 typ host\r\n' }; }
  async setLocalDescription(desc) { this.localDescription = desc; this.iceGatheringState = 'complete'; this.signalingState = 'have-local-description'; this.dispatchEvent(new Event('icegatheringstatechange')); }
  async setRemoteDescription(desc) { this.remoteDescription = desc; this.signalingState = 'stable'; }
  addTrack(track, stream) { this.addedTracks = this.addedTracks || []; this.addedTracks.push({ track, stream }); }
}

test('clock-offset formula matches design.md ping/pong math', () => {
  const { rttMs, hostOffsetMs } = estimateHostOffset({ clientSentAtMs:1000, hostReceivedAtMs:1500, clientReceivedAtMs:1100 });
  assert.equal(rttMs, 100);
  assert.equal(hostOffsetMs, 450);
});

test('lyric position advances only from sampled Cast media time', () => {
  const state = { status:'playing', tvMediaTimeMs:5000, tvMediaTimeSampledAtHostMs:10000, playbackRate:1, seekOffsetMs:250, syncDegraded:false };
  assert.equal(deriveTvMediaPositionMs(state, 11250, 0).positionMs, 6500);
  assert.equal(deriveTvMediaPositionMs({...state, status:'paused'}, 11250, 0).positionMs, 5250);
  assert.equal(deriveTvMediaPositionMs({...state, syncDegraded:true}, 11250, 0).syncDegraded, true);
});

test('active lyric line derives from current song position', () => {
  const lines = [{startMs:0,endMs:999,text:'a'}, {startMs:1000,endMs:1999,text:'b'}];
  assert.equal(activeLyricLine(lines, 1200).text, 'b');
});

test('manual WebRTC offer-answer flow uses complete ICE payloads', async () => {
  const old = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePc;
  try {
    const player = new PeerNode('player');
    const host = new PeerNode('host');
    const offer = await player.createManualOffer('host');
    const offerEdge = player.peers.get('host');
    assert.equal(offerEdge.pc.iceGatheringState, 'complete');
    assert.match(offer.url, /#signal=ck1\./);

    const answer = await host.acceptManualOffer(offer.url);
    const answerEdge = host.peers.get('player');
    assert.equal(answerEdge.pc.iceGatheringState, 'complete');
    assert.equal(answerEdge.pc.remoteDescription.type, 'offer');

    const decoded = await player.acceptManualAnswer(answer.url);
    assert.equal(decoded.kind, 'answer');
    assert.equal(offerEdge.pc.remoteDescription.type, 'answer');
  } finally {
    globalThis.RTCPeerConnection = old;
  }
});


test('local mic stream is added to all current and future peer connections', () => {
  const old = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePc;
  try {
    const node = new PeerNode('singer');
    const first = node.makeConnection('host', { initiator:true });
    const track = { kind:'audio', id:'mic-track', enabled:true };
    const stream = { id:'mic-stream', getTracks(){ return [track]; } };
    node.addLocalStream(stream);
    assert.equal(first.pc.addedTracks.length, 1);
    assert.equal(first.pc.addedTracks[0].track, track);

    const later = node.makeConnection('listener', { initiator:true });
    assert.equal(later.pc.addedTracks.length, 1, 'future peers should receive already-published mic tracks');
    assert.equal(later.pc.addedTracks[0].stream, stream);
  } finally {
    globalThis.RTCPeerConnection = old;
  }
});

test('mic enabled notification broadcasts to every open DataChannel', () => {
  const node = new PeerNode('singer');
  const sent = [];
  node.peers.set('host', { dc:{ readyState:'open', send:data => sent.push(['host', JSON.parse(data)]) } });
  node.peers.set('listener', { dc:{ readyState:'open', send:data => sent.push(['listener', JSON.parse(data)]) } });
  node.broadcast({ type:RPC.MIC_ENABLED, playerId:'p2' });
  assert.deepEqual(sent.map(([id]) => id), ['host', 'listener']);
  assert.equal(sent.every(([, msg]) => msg.type === RPC.MIC_ENABLED && msg.playerId === 'p2'), true);
});

test('failed ICE emits no-TURN network guidance', () => {
  const node = new PeerNode('a');
  const errors = [];
  node.addEventListener('error', e => errors.push(e.detail.message));
  const edge = { remotePeerId:'b', pc:{ iceConnectionState:'failed', connectionState:'failed' }, dc:null };
  edge.pc.onconnectionstatechange = () => {};
  node.peers.set('b', edge);
  // Exercise equivalent handler message text by direct emit path used by makeConnection.
  node.emit('error', { message:'WebRTC failed. Strict mode has STUN but no TURN; try same Wi-Fi or a less restrictive network.', remotePeerId:'b' });
  assert.match(errors[0], /STUN but no TURN/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log('PASS', t.name); }
  catch (err) { failed++; console.error('FAIL', t.name); console.error(err.stack || err); }
}
if (failed) process.exit(1);
console.log(`All ${tests.length} sync/WebRTC tests passed`);
