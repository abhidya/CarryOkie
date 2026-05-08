export const MAX_PLAYERS = 5;
export const MAX_SINGERS = 5;
export const MAX_QUEUE_ITEMS = 20;
export const ROOM_STATUSES = ['idle','loading','countdown','playing','paused','ended','error','host_lost'] as const;

export interface Player {
  peerId: string;
  playerId: string;
  playerNumber: number | null;
  displayName: string;
  role: 'host' | 'participant' | 'singer' | 'listener';
  isHost: boolean;
  isSingerForCurrentSong: boolean;
  micState: MicState;
  monitorState: MonitorState;
  connectionState: string;
  lastSeenAt: number;
}

export interface MicState {
  permissionState: string;
  enabled: boolean;
  muted: boolean;
  publishing: boolean;
  receivingPeerIds: string[];
  remoteGain: number;
  localMonitorGain: number;
  backingGain: number;
  masterGain: number;
}

export interface MonitorState {
  headphonesConfirmed: boolean;
  phoneSpeakerOutputAck: boolean;
  keepAwake: string;
}

export interface PlaybackState {
  songId: string;
  status: string;
  startedAtHostMs: number | null;
  pausedAtSongMs: number;
  seekOffsetMs: number;
  playbackRate: number;
  lastUpdatedAtHostMs: number;
  tvMediaTimeMs: number;
  tvMediaTimeSampledAtHostMs: number | null;
  syncDegraded: boolean;
  paused?: boolean;
  source?: string;
}

export interface QueueItem {
  queueItemId: string;
  songId: string;
  singerNumbers: number[];
  requestedByPlayerId: string;
  status: string;
  createdAt: number;
  acceptedAt: number | null;
}

export interface CastState {
  available: boolean;
  connected: boolean;
  receiverReady: boolean;
  currentMediaLoaded: boolean;
  lastCommandAt: number | null;
  lastReceiverAckAt: number | null;
  error: string | null;
  defaultMediaReceiver?: boolean;
}

export interface Room {
  roomId: string;
  roomCode: string;
  hostPeerId: string;
  hostPlayerId: string;
  createdAt: number;
  playerCount: number;
  maxPlayers: number;
  currentSongId: string;
  currentQueueItemId: string | null;
  playbackState: PlaybackState;
  players: Player[];
  queue: QueueItem[];
  castState: CastState;
  meshState: { edges: Record<string, unknown>; failures: unknown[] };
  limits: { maxPlayers: number; maxSingers: number };
  hostLostMessage?: string;
}

export function uuid(): string {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : URL.createObjectURL(new Blob()).split('/').pop()!;
}
export function nowMs(): number { return Date.now(); }
export function makeRoomCode(): string {
  const words = ['BLUE','CAT','STAR','MOON','BIRD','MINT','GOLD','ECHO','KITE','WAVE'];
  return words[Math.floor(Math.random()*words.length)] + words[Math.floor(Math.random()*words.length)];
}
export function makePlayer(role='participant', displayName='Guest'): Player {
  return {
    peerId: uuid(), playerId: uuid(), playerNumber: null, displayName, role: role as Player['role'],
    isHost: role === 'host', isSingerForCurrentSong: false,
    micState: { permissionState:'prompt', enabled:false, muted:true, publishing:false, receivingPeerIds:[], remoteGain:1, localMonitorGain:0, backingGain:0, masterGain:1 },
    monitorState: { headphonesConfirmed:false, phoneSpeakerOutputAck:false, keepAwake:'unknown' },
    connectionState: 'new', lastSeenAt: nowMs()
  };
}
export function makeRoom(hostPlayer: Player): Room {
  return {
    roomId: uuid(), roomCode: makeRoomCode(), hostPeerId: hostPlayer.peerId, hostPlayerId: hostPlayer.playerId,
    createdAt: nowMs(), playerCount: 1, maxPlayers: MAX_PLAYERS, currentSongId: 'song_002', currentQueueItemId: null,
    playbackState: { songId:'song_002', status:'idle', startedAtHostMs:null, pausedAtSongMs:0, seekOffsetMs:0, playbackRate:1, lastUpdatedAtHostMs:nowMs(), tvMediaTimeMs:0, tvMediaTimeSampledAtHostMs:null, syncDegraded:true },
    players: [hostPlayer], queue: [],
    castState: { available:false, connected:false, receiverReady:false, currentMediaLoaded:false, lastCommandAt:null, lastReceiverAckAt:null, error:null },
    meshState: { edges:{}, failures:[] }, limits: { maxPlayers: MAX_PLAYERS, maxSingers: MAX_SINGERS }
  };
}
export function addPlayer(room: Room, player: Player): Room {
  if (room.players.length >= MAX_PLAYERS) throw new Error('Room full: MVP cap is 5 players.');
  const taken = new Set(room.players.map(p => p.playerNumber).filter(Boolean));
  player.playerNumber = [1,2,3,4,5].find(n => !taken.has(n)) ?? null;
  room.players.push(player); room.playerCount = room.players.length; return room;
}
export function assignSingers(room: Room, playerIds: string[]): Room {
  if (playerIds.length > MAX_SINGERS) throw new Error(`Maximum ${MAX_SINGERS} active singers.`);
  const chosen = new Set(playerIds);
  room.players.forEach(p => { p.isSingerForCurrentSong = chosen.has(p.playerId); p.role = p.isHost ? 'host' : (p.isSingerForCurrentSong ? 'singer' : 'listener'); });
  return room;
}
export function queueRequest(songId: string, singerNumbers: number[], requestedByPlayerId: string, currentQueueLength=0): QueueItem {
  if (singerNumbers.length > MAX_SINGERS) throw new Error(`Queue item max ${MAX_SINGERS} singers.`);
  const singers = [...new Set(singerNumbers.filter(n => Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS))];
  if (!songId) throw new Error('Queue item needs a song.');
  if (!requestedByPlayerId) throw new Error('Queue item needs a requesting player.');
  if (singers.length === 0) throw new Error('Queue item needs at least one singer number.');
  if (currentQueueLength >= MAX_QUEUE_ITEMS) throw new Error(`Queue full: MVP cap is ${MAX_QUEUE_ITEMS} items.`);
  return { queueItemId: uuid(), songId, singerNumbers: singers, requestedByPlayerId, status:'requested', createdAt:nowMs(), acceptedAt:null };
}
export function acceptQueue(room: Room, queueItemId: string): Room {
  const item = room.queue.find(q => q.queueItemId === queueItemId); if (!item || item.status === 'active' || item.status === 'ended') return room;
  item.status = 'queued'; item.acceptedAt = nowMs(); return room;
}
export function rejectQueue(room: Room, queueItemId: string): Room {
  const item = room.queue.find(q => q.queueItemId === queueItemId); if (!item || item.status === 'active' || item.status === 'ended') return room;
  item.status = 'rejected'; return room;
}
export function removeQueueItem(room: Room, queueItemId: string): Room {
  room.queue = room.queue.filter(q => q.queueItemId !== queueItemId);
  if (room.currentQueueItemId === queueItemId) room.currentQueueItemId = null;
  return room;
}
function safeClientQueueId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id);
}
export function enqueueRequest(room: Room, item: QueueItem): Room {
  if (room.queue.some(q => q.queueItemId === item.queueItemId)) return room;
  const openLength = room.queue.filter(q => !['ended','rejected'].includes(q.status)).length;
  const normalized = queueRequest(item.songId, item.singerNumbers, item.requestedByPlayerId, openLength);
  normalized.queueItemId = safeClientQueueId(item.queueItemId) ? item.queueItemId : normalized.queueItemId;
  normalized.createdAt = item.createdAt || normalized.createdAt;
  room.queue.push(normalized);
  return room;
}
export function nextQueuedItem(room: Room): QueueItem | undefined {
  return room.queue.find(q => q.status === 'queued');
}

export function addSingerToQueueItem(room: Room, queueItemId: string, singerNumber: number): Room {
  const item = room.queue.find(q => q.queueItemId === queueItemId); if (!item || item.status === 'active' || item.status === 'ended') return room;
  if (!Number.isInteger(singerNumber) || singerNumber < 1 || singerNumber > MAX_PLAYERS) return room;
  if (!item.singerNumbers.includes(singerNumber)) {
    if (item.singerNumbers.length >= MAX_SINGERS) throw new Error(`Queue item max ${MAX_SINGERS} singers.`);
    item.singerNumbers.push(singerNumber);
  }
  if (item.status === 'rejected') item.status = 'requested';
  return room;
}
export function removeSingerFromQueueItem(room: Room, queueItemId: string, singerNumber: number): Room {
  const item = room.queue.find(q => q.queueItemId === queueItemId); if (!item || item.status === 'active' || item.status === 'ended') return room;
  const next = item.singerNumbers.filter(n => n !== singerNumber);
  if (next.length === 0) throw new Error('Queue item needs at least one singer number.');
  item.singerNumbers = next;
  return room;
}
export function lockHostLost(room: Room): Room {
  room.playbackState.status = 'host_lost';
  room.hostLostMessage = 'Host disconnected. Audio between already-connected phones may continue, but TV and queue controls are locked. Create a new room to continue.';
  return room;
}
export function saveRoom(room: Room): void { localStorage.setItem('carryokie.room', JSON.stringify(room)); }
export function loadRoom(): Room | null { try { return JSON.parse(localStorage.getItem('carryokie.room') || 'null'); } catch { return null; } }
