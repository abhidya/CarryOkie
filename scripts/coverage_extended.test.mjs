import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QR_MAX_TEXT_BYTES, qrMatrix, qrSvg } from '../src/qr.ts';
import { encodeSignalPayload, renderPayloadCard, scanQrInto } from '../src/signaling.ts';
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

test('QR encoder accepts larger near-capacity local chunks', () => {
  const text = 'x'.repeat(QR_MAX_TEXT_BYTES);
  const svg = qrSvg(text);
  assert.match(svg, /data-qr="true"/);
  assert.throws(() => qrSvg(text + 'x'), /QR chunk too large/);
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

test('phone mic publishes filtered WebAudio stream and PeerNode routes filtered track', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const oldNavigator = globalThis.navigator;
  const oldRtc = globalThis.RTCPeerConnection;
  const rawTrack = { id:'raw-mic', enabled:true };
  const filteredTrack = { id:'filtered-mic', enabled:true };
  const rawStream = { id:'raw-stream', getAudioTracks(){ return [rawTrack]; }, getTracks(){ return [rawTrack]; } };
  const filteredStream = { id:'filtered-stream', getAudioTracks(){ return [filteredTrack]; }, getTracks(){ return [filteredTrack]; } };
  const links = [];
  function node(name){ return { name, connect(target){ links.push([name, target.name || 'destination']); }, disconnect(){} }; }
  const created = { filters:[], compressors:[], gains:[] };
  globalThis.AudioContext = class {
    constructor(){ this.destination = { name:'speakers' }; }
    createGain(){ const n = node('gain'); n.gain = { value:0 }; created.gains.push(n); return n; }
    createMediaStreamSource(){ return node('rawSource'); }
    createMediaStreamDestination(){ return { name:'filteredDestination', stream:filteredStream }; }
    createBiquadFilter(){ const n = node('filter'); n.frequency = { value:0 }; n.gain = { value:0 }; n.Q = { value:0 }; created.filters.push(n); return n; }
    createDynamicsCompressor(){ const n = node('compressor'); n.threshold = { value:0 }; n.knee = { value:0 }; n.ratio = { value:0 }; n.attack = { value:0 }; n.release = { value:0 }; created.compressors.push(n); return n; }
    createScriptProcessor(){ return { name:'gate', connect(){}, onaudioprocess:null }; }
  };
  class FakePc extends EventTarget {
    constructor(){ super(); this.addedTracks = []; }
    createDataChannel(){ return { readyState:'open', send(){} }; }
    addTrack(track, stream){ this.addedTracks.push({ track, stream }); }
  }
  globalThis.RTCPeerConnection = FakePc;
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ mediaDevices:{ async getUserMedia(){ return rawStream; } } } });
  try {
    const audio = new PhoneAudio(() => {});
    const published = await audio.requestMic({ headphonesConfirmed:true });
    assert.equal(published, filteredStream, 'requestMic should return filtered publish stream when WebAudio routing is available');
    assert.deepEqual(links.map(([from, to]) => `${from}->${to}`), [
      'gain->gain', 'gain->gain', 'gain->speakers',
      'rawSource->filter', 'filter->filter', 'filter->filter', 'filter->compressor', 'compressor->gain', 'gain->filteredDestination'
    ]);
    audio.setVoicePreset('autotune');
    assert.equal(created.compressors[0].ratio.value, 8);
    assert.equal(created.filters[2].gain.value, 3);
    audio.setMicMuted(true);
    assert.equal(rawTrack.enabled, false);
    assert.equal(filteredTrack.enabled, false);

    const peer = new PeerNode('singer');
    const edge = peer.makeConnection('host', { initiator:true });
    peer.addLocalStream(published);
    assert.equal(edge.pc.addedTracks[0].track, filteredTrack);
    assert.equal(edge.pc.addedTracks[0].stream, filteredStream);
  } finally {
    globalThis.AudioContext = oldAudioContext;
    globalThis.RTCPeerConnection = oldRtc;
    Object.defineProperty(globalThis, 'navigator', { configurable:true, value:oldNavigator });
  }
});




test('remote singer audio resumes output graph and keeps source nodes alive', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const connected = [];
  let resumeCalls = 0;
  function node(name){ return { name, gain:{ value:0 }, connect(target){ connected.push([name, target?.name || 'dest']); } }; }
  globalThis.AudioContext = class {
    constructor(){ this.destination = { name:'speakers' }; this.state = 'suspended'; }
    createGain(){ return node('gain'); }
    createMediaStreamSource(){ return node('remoteSource'); }
    async resume(){ resumeCalls++; this.state = 'running'; }
  };
  try {
    const logs = [];
    const audio = new PhoneAudio(msg => logs.push(msg));
    const stream = { id:'remote-stream' };
    audio.addRemoteStream(stream, 'singer-1');
    audio.addRemoteStream(stream, 'singer-1 duplicate');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(resumeCalls, 1, 'listener audio should resume after a prior user gesture unlocked it');
    assert.equal(audio.remoteSources.length, 1, 'remote source node must stay referenced once without duplicate playback');
    assert.ok(connected.some(([from]) => from === 'remoteSource'));
    assert.ok(logs.includes('Receiving singer-1'));
  } finally {
    globalThis.AudioContext = oldAudioContext;
  }
});

test('phone backing monitor creates, reuses, retargets, and pauses audio element', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const oldAudio = globalThis.Audio;
  const played = [];
  const paused = [];
  const connected = [];
  globalThis.Audio = class {
    constructor(src){ this.src = src; this.loop = null; this.crossOrigin = null; played.push(['new', src]); }
    async play(){ played.push(['play', this.src]); }
    pause(){ paused.push(this.src); }
  };
  globalThis.AudioContext = class {
    constructor(){ this.destination = { name:'dest' }; }
    createGain(){ return { name:'gain', gain:{ value:0 }, connect(target){ connected.push(['gain', target?.name || 'dest']); } }; }
    createMediaStreamSource(){ return { connect(){} }; }
    createMediaElementSource(audio){ return { name:'mediaSource', connect(target){ connected.push([audio.src, target?.name || 'target']); } }; }
  };
  try {
    const audio = new PhoneAudio(() => {});
    await assert.rejects(() => audio.startBackingMonitor('/a.mp4'), /Use headphones/);
    const first = await audio.startBackingMonitor('/a.mp4', { headphonesConfirmed:true });
    assert.equal(first.src, '/a.mp4');
    assert.equal(first.crossOrigin, 'anonymous');
    assert.equal(audio.backingGain.gain.value, 0.35);
    const second = await audio.startBackingMonitor('/b.mp4', { headphonesConfirmed:true });
    assert.equal(second, first);
    assert.equal(first.src, '/b.mp4');
    audio.pauseBackingMonitor();
    assert.deepEqual(paused, ['/b.mp4']);
    assert.ok(connected.some(([from]) => from === '/a.mp4'));
  } finally {
    globalThis.AudioContext = oldAudioContext;
    globalThis.Audio = oldAudio;
  }
});

test('wake lock uses native API, video fallback, and cleanup paths', async () => {
  const oldNavigator = globalThis.navigator;
  const oldDocument = globalThis.document;
  const released = [];
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ wakeLock:{ async request(kind){ return { kind, release(){ released.push(kind); } }; } } } });
  try {
    const audio = new PhoneAudio(() => {});
    assert.equal(await audio.tryWakeLock(), 'active');
    audio.stopWakeLock();
    assert.deepEqual(released, ['screen']);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable:true, value:oldNavigator });
  }
  const video = { loop:false, muted:false, style:{ cssText:'' }, src:'', async play(){}, pause(){ this.paused = true; }, remove(){ this.removed = true; } };
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{} });
  globalThis.document = { createElement(tag){ assert.equal(tag, 'video'); return video; }, body:{ appendChild(el){ assert.equal(el, video); } } };
  try {
    const audio = new PhoneAudio(() => {});
    assert.equal(await audio.tryWakeLock(), 'video-fallback');
    assert.equal(video.loop, true);
    assert.equal(video.muted, true);
    audio.stopWakeLock();
    assert.equal(video.paused, true);
    assert.equal(video.removed, true);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable:true, value:oldNavigator });
    globalThis.document = oldDocument;
  }
});

test('noise gate mutes low RMS and passes loud input', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const oldNavigator = globalThis.navigator;
  const logs = [];
  const track = { enabled:true };
  const stream = { getAudioTracks(){ return [track]; }, getTracks(){ return [track]; } };
  let processor;
  globalThis.AudioContext = class {
    constructor(){ this.destination = {}; }
    createGain(){ return { gain:{ value:0 }, connect(){} }; }
    createMediaStreamSource(){ return { connect(){} }; }
    createScriptProcessor(){ processor = { connect(){}, onaudioprocess:null }; return processor; }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ mediaDevices:{ async getUserMedia(){ return stream; } } } });
  try {
    const audio = new PhoneAudio(m => logs.push(m));
    audio.setGateEnabled(true, 0.5);
    await audio.requestMic({ headphonesConfirmed:true });
    assert.ok(processor.onaudioprocess);
    const lowOut = [9,9,9];
    processor.onaudioprocess({ inputBuffer:{ getChannelData(){ return [0.01,0.01,0.01]; } }, outputBuffer:{ getChannelData(){ return lowOut; } } });
    assert.deepEqual(lowOut, [0,0,0]);
    const loudOut = [0,0,0];
    processor.onaudioprocess({ inputBuffer:{ getChannelData(){ return [1,0.5,-1]; } }, outputBuffer:{ getChannelData(){ return loudOut; } } });
    assert.deepEqual(loudOut, [1,0.5,-1]);
    assert.match(logs.join('\n'), /Noise gate enabled/);
  } finally {
    globalThis.AudioContext = oldAudioContext;
    Object.defineProperty(globalThis, 'navigator', { configurable:true, value:oldNavigator });
  }
});

test('duet monitoring connects and disconnects peer-specific gain', async () => {
  const oldAudioContext = globalThis.AudioContext;
  const links = [];
  const disconnects = [];
  globalThis.AudioContext = class {
    constructor(){ this.destination = { name:'dest' }; }
    createGain(){ return { name:'gain', gain:{ value:0 }, connect(target){ links.push(target?.name || 'target'); }, disconnect(){ disconnects.push('gain'); } }; }
    createMediaStreamSource(){ return { connect(target){ links.push(target?.name || 'duetGain'); } }; }
  };
  try {
    const audio = new PhoneAudio(() => {});
    await audio.init();
    audio.enableDuetMonitoring('p2', true);
    assert.equal(audio.duetMonitorGains.has('p2'), true);
    audio.connectDuetStream({}, 'p2');
    audio.enableDuetMonitoring('p2', false);
    assert.equal(audio.duetMonitorGains.has('p2'), false);
    assert.deepEqual(disconnects, ['gain']);
  } finally { globalThis.AudioContext = oldAudioContext; }
});

test('payload card buttons navigate QR chunks and copy/share link', async () => {
  const oldNavigator = globalThis.navigator;
  const copied = [];
  const shared = [];
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ clipboard:{ writeText(text){ copied.push(text); } }, async share(payload){ shared.push(payload); } } });
  try {
    const elements = new Map();
    const target = {
      set innerHTML(_html){ for (const key of ['[data-single-qr]','[data-qr-count]','[data-prev]','[data-next]','[data-copy]','[data-share]']) elements.set(key, { innerHTML:'', textContent:'', disabled:false, onclick:null }); },
      get innerHTML(){ return ''; },
      querySelector(selector){ return elements.get(selector) || null; }
    };
    renderPayloadCard(target, { url:'https://x/#signal=abc', token:'abc', chunks:['one','two'] }, 'Test payload');
    assert.equal(target.querySelector('[data-qr-count]').textContent, 'QR 1/2');
    target.querySelector('[data-next]').onclick();
    assert.equal(target.querySelector('[data-qr-count]').textContent, 'QR 2/2');
    target.querySelector('[data-prev]').onclick();
    assert.equal(target.querySelector('[data-qr-count]').textContent, 'QR 1/2');
    await target.querySelector('[data-copy]').onclick();
    await target.querySelector('[data-share]').onclick();
    assert.deepEqual(copied, ['https://x/#signal=abc']);
    assert.equal(shared[0].text, 'https://x/#signal=abc');
  } finally { Object.defineProperty(globalThis, 'navigator', { configurable:true, value:oldNavigator }); }
});

test('QR scanner reports unsupported browser and insecure media errors', async () => {
  const oldNavigator = globalThis.navigator;
  const oldDetector = globalThis.BarcodeDetector;
  try {
    delete globalThis.BarcodeDetector;
    await assert.rejects(() => scanQrInto({}), /BarcodeDetector/);
    globalThis.BarcodeDetector = class {};
    Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{} });
    await assert.rejects(() => scanQrInto({}), /camera permission and HTTPS/);
  } finally {
    if (oldDetector) globalThis.BarcodeDetector = oldDetector; else delete globalThis.BarcodeDetector;
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
