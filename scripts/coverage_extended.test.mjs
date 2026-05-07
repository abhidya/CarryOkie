import assert from 'node:assert/strict';
import fs from 'node:fs';
import { qrMatrix, qrSvg } from '../src/qr.ts';
import { encodeSignalPayload } from '../src/signaling.ts';
import { PeerNode, RPC } from '../src/webrtc.ts';
import { PhoneAudio } from '../src/audio.ts';

const tests = [];
function test(name, fn){ tests.push({name, fn}); }

test('QR SVG renders locally with finder-like dark modules and no remote QR service', async () => {
  const payload = await encodeSignalPayload({ kind:'offer', fromPeerId:'a', toPeerId:'b', description:{ type:'offer', sdp:'v=0\r\n' } });
  assert.ok(payload.chunks.length >= 1);
  const svg = qrSvg(payload.chunks[0]);
  assert.match(svg, /data-qr="true"/);
  assert.doesNotMatch(svg, /qrserver|quickchart|api\.qr/i);
  const m = qrMatrix(payload.chunks[0]);
  assert.equal(m.length, 57);
  assert.equal(m[0][0], true);
  assert.equal(m[6][6], true);
});

test('manual payload card includes QR rendering code path', () => {
  const signaling = fs.readFileSync('src/signaling.ts','utf8');
  assert.match(signaling, /qrSvg\(encoded\.chunks\[index\]\)/);
  assert.match(signaling, /One QR code is shown at a time/);
});

test('peer-assisted signaling relay forwards non-local relay messages', () => {
  const node = new PeerNode('host');
  const sent = [];
  node.peers.set('b', { dc:{ readyState:'open', send: data => sent.push(JSON.parse(data)) } });
  node.handleMessage('c', { type:RPC.SIGNAL_RELAY_OFFER, fromPeerId:'c', toPeerId:'b', signal:{sdp:'offer'} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, RPC.SIGNAL_RELAY_OFFER);
  assert.equal(sent[0].relayedByPeerId, 'host');
});

test('relay helper rejects unsupported relay types', () => {
  const node = new PeerNode('host');
  assert.throws(() => node.relaySignal('ROOM_HELLO','a','b',{}), /Unsupported relay type/);
});


test('phone mic input requests echo-cancelled audio and mute toggles tracks', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const oldNavigator = globalThis.navigator;
  const calls = [];
  const track = { enabled:true };
  const stream = { getAudioTracks(){ return [track]; } };
  globalThis.AudioContext = class {
    constructor(){ this.destination = {}; }
    createGain(){ return { gain:{ value:0 }, connect(){} }; }
    createMediaStreamSource(){ return { connect(){} }; }
    createScriptProcessor(){ return { connect(){}, onaudioprocess:null }; }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ mediaDevices:{ async getUserMedia(constraints){ calls.push(constraints); return stream; } } } });
  try {
    const audio = new PhoneAudio(() => {});
    const got = await audio.requestMic({ headphonesConfirmed:true });
    assert.equal(got, stream);
    assert.deepEqual(calls[0], { audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
    audio.setMicMuted(true);
    assert.equal(track.enabled, false);
    audio.setMicMuted(false);
    assert.equal(track.enabled, true);
  } finally {
    globalThis.AudioContext = oldAudioContext;
    Object.defineProperty(globalThis, 'navigator', { configurable:true, value:oldNavigator });
  }
});

test('mic publishing requires headphones or push-to-sing before getUserMedia', async () => {
  const audio = new PhoneAudio(() => {});
  await assert.rejects(() => audio.requestMic(), /TV backing track bleed risk/);
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log('PASS', t.name); }
  catch (err) { failed++; console.error('FAIL', t.name); console.error(err.stack || err); }
}
if (failed) process.exit(1);
console.log(`All ${tests.length} extended coverage tests passed`);
