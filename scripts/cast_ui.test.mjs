import assert from 'node:assert/strict';
import { CastController } from '../src/cast.ts';

const events = [];
class FakeRemotePlayer { constructor(){ this.currentTime = 0; this.isPaused = true; } }
class FakeRemotePlayerController { constructor(player){ this.player = player; } addEventListener(){} playOrPause(){ this.player.isPaused = !this.player.isPaused; } seek(){} }
class FakeMediaInfo { constructor(url, contentType){ this.contentId = url; this.contentType = contentType; } }
class FakeMetadata {}
class FakeLoadRequest { constructor(mediaInfo){ this.media = mediaInfo; } }
const fakeSession = {
  loaded: [],
  async loadMedia(req){ this.loaded.push(req); return { ok:true }; },
  sendMessage(){ events.push(['sendMessage', ...arguments]); }
};
let requested = 0;
const fakeContext = {
  current: null,
  setOptions(opts){ this.opts = opts; },
  getCurrentSession(){ return this.current; },
  async requestSession(){ requested++; this.current = fakeSession; return fakeSession; }
};

globalThis.chrome = { cast: { AutoJoinPolicy: { ORIGIN_SCOPED:'ORIGIN_SCOPED' }, media: { MediaInfo: FakeMediaInfo, GenericMediaMetadata: FakeMetadata, LoadRequest: FakeLoadRequest } } };
globalThis.cast = { framework: { CastContext: { getInstance(){ return fakeContext; } }, RemotePlayer: FakeRemotePlayer, RemotePlayerController: FakeRemotePlayerController, RemotePlayerEventType: { CURRENT_TIME_CHANGED:'CURRENT_TIME_CHANGED', IS_PAUSED_CHANGED:'IS_PAUSED_CHANGED' } } };

const song = { title:'Adele', artist:'Adele', castMediaUrl:'http://10.0.0.185:4173/public/songs/song_002/Adele.mp4' };
const room = { roomCode:'ECHOSTAR' };

const first = new CastController('CC1AD845');
first.configure();
await first.loadSong(song, room);
assert.equal(requested, 1, 'loadSong should auto-request Cast session');
assert.equal(fakeSession.loaded.length, 1, 'media should load');
assert.equal(fakeSession.loaded[0].media.contentType, 'video/mp4');
assert.equal(events.length, 0, 'Default Media Receiver should not receive unsupported CarryOkie namespace messages');

const second = new CastController('CC1AD845');
second.configure();
await second.loadSong(song, room);
assert.equal(requested, 1, 'new controller should reuse current Cast session after UI rerender');
assert.equal(fakeSession.loaded.length, 2, 'second load should still load media');
assert.equal(events.length, 0, 'Default Media Receiver reuse should still skip custom namespace messages');

const protectedSong = { title:'Protected', artist:'Local', encryptedMedia:{ mimeType:'video/mp4' }, defaultCastMediaUrl:'/public/cast/media/abc123.mp4', defaultCastMediaMimeType:'video/mp4' };
await second.loadSong(protectedSong, room);
assert.equal(fakeSession.loaded.at(-1).media.contentId, '/public/cast/media/abc123.mp4', 'Default Media Receiver should load clear cast export for protected songs');
assert.equal(events.length, 0, 'Default protected load should still skip custom namespace messages');

const custom = new CastController('CUSTOMAPP');
custom.configure();
await custom.loadSong(song, room);
assert.equal(events.length, 2, 'custom receiver should receive LOAD and sync namespace messages');
assert.equal(events[0][0], 'sendMessage');
assert.equal(events[0][1], 'urn:x-cast:com.carryokie.room');

console.log('PASS Cast UI lifecycle reuses session and load auto-starts Cast');
