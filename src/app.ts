import { makePlayer, makeRoom, addPlayer, saveRoom, loadRoom, queueRequest, acceptQueue, rejectQueue, removeQueueItem, enqueueRequest, nextQueuedItem, addSingerToQueueItem, removeSingerFromQueueItem, assignSingers, MAX_SINGERS, lockHostLost } from './state.ts';
import { PeerNode, RPC, assertWebRtcSupported } from './webrtc.ts';
import { renderPayloadCard, decodeSignalPayload, scanQrInto } from './signaling.ts';
import { PhoneAudio, singerWarning } from './audio.ts';
import { CastController, receiverApp } from './cast.ts';
import { deriveTvMediaPositionMs } from './sync.ts';
import { loadProtectedCatalog, resolvePlayableMediaUrl, isProtectedMedia } from './protectedMedia.ts';
let room = loadRoom(); let player = JSON.parse(localStorage.getItem('carryokie.player') || 'null'); let peerNode; let audio; let catalog=[]; let castController; let castListenersAttached = false; let phoneSyncTimer = null;
const $ = (s, el=document) => el.querySelector(s);
function persist(){ if(room) saveRoom(room); if(player) localStorage.setItem('carryokie.player', JSON.stringify(player)); }
function log(msg){ const el=$('#log'); if(el) el.prepend(Object.assign(document.createElement('div'),{textContent:`${new Date().toLocaleTimeString()} ${msg}`})); }
function assetUrl(path){ if(!path) return null; const publicPath = path.startsWith('/public/') ? path.slice('/public'.length) : path; return publicPath.startsWith('/') ? new URL('..' + publicPath, import.meta.url).toString() : new URL(publicPath, import.meta.url).toString(); }
function normalizeSong(song){ return {...song, lyricsJsonUrl:assetUrl(song.lyricsJsonUrl), lyricsVttUrl:assetUrl(song.lyricsVttUrl), castMediaUrl:assetUrl(song.castMediaUrl), phoneBackingAudioUrl:assetUrl(song.phoneBackingAudioUrl), thumbnailUrl:assetUrl(song.thumbnailUrl)}; }
async function loadCatalog(){
 const protectedSongs = await loadProtectedCatalog();
 let plainSongs = [];
 try {
  plainSongs = await fetch(assetUrl('/songs/catalog.json')).then(r=>r.ok ? r.json() : {songs:[]}).then(j=>(j.songs||[]).map(normalizeSong));
 } catch { plainSongs = []; }
 catalog = [...protectedSongs, ...plainSongs];
}
function lyricView(lines, tMs){ const active = lines.findLast?.(l=>tMs>=l.startMs) || lines.filter(l=>tMs>=l.startMs).pop() || lines[0]; return `<div>${lines.map(l=>`<p class="${l===active?'active':''}">${l.text}</p>`).join('')}</div>`; }
function localHttpWarning(){ const h=location.hostname; return location.protocol==='http:' && h !== 'localhost' && h !== '127.0.0.1' ? '<p class="warn">Phone browser is on local HTTP. If offer creation, camera QR, or protected video fails, use the GitHub Pages HTTPS URL for the full flow.</p>' : ''; }
function commonChrome(root, title){ root.innerHTML = `<main class="shell"><header><h1>${title}</h1>${localHttpWarning()}</header><section id="main"></section><section><h2>Log</h2><div id="log" class="log"></div></section></main>`; }
function unlockPhoneAudio(){ audio?.init().catch(()=>{}); }
function setupPeer(localPeerId){ peerNode = new PeerNode(localPeerId); peerNode.addEventListener('open', e=>{ log(`DataChannel open: ${e.detail.remotePeerId}`); peerNode.send(e.detail.remotePeerId,{type:RPC.ROOM_HELLO, peerId:localPeerId, player}); if(player?.isHost) peerNode.send(e.detail.remotePeerId,{type:RPC.ROOM_STATE_SNAPSHOT, room}); }); peerNode.addEventListener('close', e=>handlePeerClosed(e.detail.remotePeerId)); peerNode.addEventListener('connection', e=>{ if(e.detail.state==='disconnected'||e.detail.state==='failed') handlePeerClosed(e.detail.remotePeerId); }); peerNode.addEventListener('message', e=>handleRpc(e.detail.remotePeerId, e.detail.msg)); peerNode.addEventListener('error', e=>log(e.detail.message)); peerNode.addEventListener('track', e=>{ audio?.addRemoteStream(e.detail.stream, e.detail.remotePeerId); if(player?.isHost) peerNode.relayRemoteStream(e.detail.remotePeerId, e.detail.stream); }); setInterval(()=>peerNode?.pingAll(),5000); return peerNode; }
function isHostEdge(remotePeerId){ return remotePeerId === 'host' || (!!room?.hostPeerId && remotePeerId === room.hostPeerId); }
function handlePeerClosed(remotePeerId){
  if(player?.isHost){ handlePlayerLeft(remotePeerId); return; }
  if(room && isHostEdge(remotePeerId)){
    lockHostLost(room);
    persist();
    log(room.hostLostMessage || 'Host disconnected. TV and queue controls are locked. Create a new room to continue.');
    renderPlayer($('#main'));
  }
}
function handlePlayerLeft(remotePeerId){
  if(!player?.isHost||!room) return;
  const target=room.players.find(p=>p.peerId===remotePeerId);
  if(!target) return;
  target.connectionState='disconnected'; target.lastSeenAt=Date.now();
  peerNode.send(remotePeerId,{type:RPC.PLAYER_LEFT, peerId:remotePeerId});
  peerNode.broadcast({type:RPC.PLAYER_LEFT, peerId:remotePeerId, room});
  log(`Player #${target.playerNumber} ${target.displayName} disconnected.`);
  persist(); renderHost($('#main'));
}
function broadcastRoom(type=RPC.ROOM_STATE_SNAPSHOT){ peerNode?.broadcast({type, room}); }
function sendCastRoomUpdate(type, payload={}){ castController?.sendSafe?.(type, payload); }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function songTitle(songId){ const song=catalog.find(s=>s.songId===songId); return song ? `${song.title || song.songId}${song.artist ? ' — '+song.artist : ''}` : songId; }
function queuePreview(){ return room.queue.map(q=>({...q, title:songTitle(q.songId)})); }
function publishQueueUpdate(){ broadcastRoom(RPC.QUEUE_UPDATED); sendCastRoomUpdate('CAST_UPDATE_QUEUE_PREVIEW',{queue:queuePreview()}); persist(); }
function attachCastListeners(cast){
 if(castListenersAttached) return;
 castListenersAttached = true;
 cast.addEventListener('state',e=>{ const s=e.detail; const el=$('#castStatus'); if(el) el.textContent=s.connected?'Connected to TV':s.available?'Available, click to connect':'Chromecast not available'; });
 cast.addEventListener('error',e=>log(e.detail.message));
 cast.addEventListener('playbackSample',e=>{ room.playbackState={...room.playbackState,...e.detail,syncDegraded:false,lastUpdatedAtHostMs:Date.now()}; peerNode?.broadcast({type:RPC.PLAYBACK_SYNC, sample:room.playbackState}); persist(); });
}
function setOwnMicMuted(muted){ audio?.setMicMuted(muted); if(player?.micState){ player.micState={...player.micState, muted}; persist(); } const status=$('#micStatus'); if(status) status.textContent = muted ? 'Mic muted.' : 'Mic live.'; peerNode?.broadcast({type: muted ? RPC.MIC_MUTED : RPC.MIC_UNMUTED, playerId:player?.playerId}); }
function registerRemotePlayer(remotePeerId, remotePlayer){
 if(!player?.isHost || !remotePlayer || !room) return false;
 const existing = room.players.find(p=>p.peerId===remotePlayer.peerId || p.playerId===remotePlayer.playerId);
 if(existing){ existing.connectionState='connected'; existing.lastSeenAt=Date.now(); return false; }
 addPlayer(room, {...remotePlayer, peerId:remotePlayer.peerId || remotePeerId, role:'participant', isHost:false, connectionState:'connected', lastSeenAt:Date.now()});
 return true;
}
function currentSong(){ return catalog.find(s=>s.songId===room?.currentSongId) || catalog[0]; }
function castOrigin(){ return localStorage.getItem('carryokie.castOrigin') || location.origin; }
function saveCastOrigin(){ const input=$('#castOrigin'); if(input?.value) localStorage.setItem('carryokie.castOrigin', input.value.replace(/\/$/,'')); }
function showCastControls(){ ['castLoadBtn','castPlayBtn','castPause','castSeek'].forEach(id=>{ const el=$('#'+id); if(el) el.style.display='inline'; }); }
async function loadCurrentSongOnTv(){
 const song = currentSong();
 if(!castController || !song) return false;
 try{
  await castController.loadSong(song, room);
  castController.sendSafe('CAST_SHOW_JOIN_QR',{roomCode:room.roomCode});
  showCastControls();
  $('#castStatus') && ($('#castStatus').textContent=`Loaded ${song.title || song.songId} on TV`);
  log(`TV media loaded: ${song.title || song.songId}`);
  return true;
 } catch(e){ log(e.message); return false; }
}
function startQueueItem(item){
 if(!item) { log('Queue is empty. Add or accept a song first.'); return; }
 if(item.status !== 'queued') { log('Accept the queue item before starting it.'); return; }
 room.currentSongId = item.songId;
 room.currentQueueItemId = item.queueItemId;
 room.queue.forEach(q=>{ if(q.status==='active' && q.queueItemId!==item.queueItemId) q.status='ended'; });
 item.status = 'active';
 if(!item.acceptedAt) item.acceptedAt = Date.now();
 const singerIds = item.singerNumbers.map(n=>room.players.find(p=>p.playerNumber===n)?.playerId).filter(Boolean);
 assignSingers(room, singerIds);
 room.playbackState = {...room.playbackState, songId:item.songId, status:'loading', startedAtHostMs:null, pausedAtSongMs:0, seekOffsetMs:0, tvMediaTimeMs:0, tvMediaTimeSampledAtHostMs:null, paused:true, syncDegraded:true, lastUpdatedAtHostMs:Date.now()};
 broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
 sendCastRoomUpdate('CAST_UPDATE_QUEUE_PREVIEW',{queue:queuePreview()});
 sendCastRoomUpdate('CAST_SET_SINGERS',{players:room.players.filter(p=>p.isSingerForCurrentSong)});
 persist();
 if(castController?.state?.().connected) loadCurrentSongOnTv();
}
function pairedActor(remotePeerId,msgPlayerId){
 return room?.players?.find(p=>p.playerId===msgPlayerId && p.peerId===remotePeerId);
}
function validSingerNumbers(numbers){
 const inRoom = new Set(room?.players?.map(p=>p.playerNumber).filter(Boolean) || []);
 return [...new Set((numbers || []).filter(n=>Number.isInteger(n) && inRoom.has(n)))];
}
function handleQueueAddRequest(remotePeerId,msg){
 const item = msg.item || {};
 const actor = pairedActor(remotePeerId,item.requestedByPlayerId);
 if(!actor?.playerNumber) throw new Error('Queue request needs a paired requester.');
 if(!catalog.some(s=>s.songId===item.songId)) throw new Error('Queue request song is not in this room catalog.');
 const singerNumbers = validSingerNumbers(item.singerNumbers);
 enqueueRequest(room,{...item, requestedByPlayerId:actor.playerId, singerNumbers: singerNumbers.length ? singerNumbers : [actor.playerNumber]});
}
function applyPhoneQueueUpdate(remotePeerId,msg){
 const actor = pairedActor(remotePeerId,msg.playerId);
 if(!actor?.playerNumber) throw new Error('Queue update needs a paired player number.');
 const item = room.queue.find(q=>q.queueItemId===msg.queueItemId);
 if(!item) throw new Error('Queue item not found.');
 if(msg.action==='join') addSingerToQueueItem(room,item.queueItemId,actor.playerNumber);
 else if(msg.action==='leave') removeSingerFromQueueItem(room,item.queueItemId,actor.playerNumber);
 else if(msg.action==='remove' && item.requestedByPlayerId===actor.playerId && !['active','ended'].includes(item.status)) removeQueueItem(room,item.queueItemId);
 else throw new Error('Queue update not allowed.');
}
function handleRpc(remotePeerId,msg){
 log(`${msg.type} from ${remotePeerId}`);
 if(msg.type===RPC.ROOM_HELLO && player?.isHost){
  const changed = registerRemotePlayer(remotePeerId, msg.player);
  peerNode.send(remotePeerId,{type:RPC.ROOM_STATE_SNAPSHOT, room});
  if(changed){ broadcastRoom(RPC.PLAYER_JOINED); persist(); renderHost($('#main')); }
 }
 if(msg.type===RPC.ROOM_STATE_SNAPSHOT && !player?.isHost){ room=msg.room; const self=room.players.find(p=>p.peerId===player.peerId || p.playerId===player.playerId); if(self) player={...player, ...self}; persist(); renderPlayer($('#main')); }
 if(msg.type===RPC.QUEUE_ADD_REQUEST && player?.isHost){ try{ handleQueueAddRequest(remotePeerId,msg); publishQueueUpdate(); renderHost($('#main')); }catch(e){ peerNode.send(remotePeerId,{type:RPC.ERROR_NOTICE,message:e.message}); log(e.message); } }
 if(msg.type===RPC.QUEUE_UPDATE_REQUEST && player?.isHost){ try{ applyPhoneQueueUpdate(remotePeerId,msg); publishQueueUpdate(); renderHost($('#main')); }catch(e){ peerNode.send(remotePeerId,{type:RPC.ERROR_NOTICE,message:e.message}); log(e.message); } }
 if(msg.type===RPC.QUEUE_UPDATED && !player?.isHost){ room=msg.room; persist(); renderPlayer($('#main')); }
 if(msg.type===RPC.PLAYBACK_SYNC){ room.playbackState={...room.playbackState,...msg.sample,syncDegraded:false}; persist(); renderLyricsPanel(); syncPhoneVideo(); }
 if(msg.type===RPC.SINGER_JOIN_REQUEST && player?.isHost){ const actor=pairedActor(remotePeerId,msg.playerId); if(actor){ const singers=[...new Set([...room.players.filter(p=>p.isSingerForCurrentSong).map(p=>p.playerId), actor.playerId])].slice(0,MAX_SINGERS); assignSingers(room,singers); broadcastRoom(RPC.SINGER_ASSIGNED); sendCastRoomUpdate('CAST_SET_SINGERS',{players:room.players.filter(p=>p.isSingerForCurrentSong)}); persist(); renderHost($('#main')); } else peerNode.send(remotePeerId,{type:RPC.ERROR_NOTICE,message:'Singer request needs a paired player.'}); }
 if(msg.type===RPC.SINGER_ASSIGNED && !player?.isHost){ room=msg.room; const self=room.players.find(p=>p.peerId===player.peerId || p.playerId===player.playerId); if(self) player={...player, ...self}; persist(); renderPlayer($('#main')); }
  if(msg.type===RPC.PLAYER_LEFT && !player?.isHost){ room=msg.room; if(room?.playbackState?.status==='host_lost'){ log('Host disconnected. TV and queue controls are locked. Create a new room to continue.'); } else { log(`Player ${msg.peerId} left the room.`); } persist(); renderPlayer($('#main')); }
  if(msg.type===RPC.MIC_MUTED && msg.playerId===player?.playerId){ setOwnMicMuted(true); log('Host muted your mic.'); }
  if(msg.type===RPC.MIC_ENABLED && player?.isHost){
    const target=room.players.find(p=>p.playerId===msg.playerId);
    if(target){ target.micState={...target.micState, enabled:true, publishing:true}; persist(); renderHost($('#main')); log(`#${target.playerNumber} ${target.displayName} enabled mic.`); }
  }
}
export async function hostPage(root){ await loadCatalog(); if(!player?.isHost){ player=makePlayer('host','Host'); player.playerNumber=1; room=makeRoom(player); persist(); } setupPeer(player.peerId); commonChrome(root,'Host Controller'); renderHost($('#main')); }
function renderHost(main){
 const song = currentSong();
 const tvBleedWarn = room.players.some(p=>p.isSingerForCurrentSong) ? '<p class="warn">TV bleed risk: singers should use headphones. Lyrics/video on TV only.</p>' : '';
  main.innerHTML = `<section class="grid"><div class="card"><h2>Room ${room.roomCode}</h2><p>Players ${room.players.length}/5. Active singers max ${MAX_SINGERS}.</p><p><a href="../player/?room=${room.roomCode}">Player join link</a></p><button id="newRoom">New room</button>${tvBleedWarn}</div><div class="card"><h2>Manual pairing</h2><p>Player creates an offer, host pastes it here and returns the generated host answer.</p><textarea id="offer" placeholder="Paste player offer/link/chunks"></textarea><button id="scanOfferQr">Scan player QR</button><button id="answerOffer">Create host answer after complete ICE</button><div id="answerOut"></div></div><div class="card"><h2>Cast to TV</h2><p id="castStatus">Click to connect to Chromecast</p><label>Cast media origin <input id="castOrigin" value="${castOrigin()}" placeholder="http://192.168.x.x:4174"></label><p class="hint">If Chromecast will not start from a .local URL, use your Mac LAN IP here.</p><button id="castBtn">Cast current song to TV</button><button id="castLoadBtn" style="display:none">Reload current song on TV</button><button id="castPlayBtn" style="display:none">Play</button><button id="castPause" style="display:none">Pause</button><label>Seek seconds <input id="castSeekSeconds" type="number" min="0" value="0"></label><button id="castSeek" style="display:none">Seek</button><pre id="castState"></pre></div><div class="card"><h2>Queue</h2>${queueHtml(room,'host')}<button id="acceptAll">Accept all</button><button id="startNext">Start next queued</button></div><div class="card"><h2>Singers</h2>${room.players.map(p=>`<label><input type="checkbox" class="singer" value="${p.playerId}" ${p.isSingerForCurrentSong?'checked':''}> #${p.playerNumber} ${p.displayName}</label><button class="mutePlayer" data-player-id="${p.playerId}">Mute #${p.playerNumber}</button>`).join('')}<button id="setSingers">Set singers</button></div></section>`;
  $('#newRoom').onclick=()=>{ player=makePlayer('host','Host'); player.playerNumber=1; room=makeRoom(player); persist(); location.reload(); };
  $('#scanOfferQr').onclick=async()=>{ try{ await scanQrInto($('#offer'), log); }catch(e){log(e.message);} };
  $('#answerOffer').onclick=async()=>{ try{ const encoded=await peerNode.acceptManualOffer($('#offer').value); renderPayloadCard($('#answerOut'), encoded, 'Host answer'); }catch(e){log(e.message);} };
  $('#acceptAll').onclick=()=>{ room.queue.filter(q=>q.status==='requested').forEach(q=>acceptQueue(room,q.queueItemId)); publishQueueUpdate(); renderHost(main); };
  $('#startNext').onclick=()=>{ startQueueItem(nextQueuedItem(room)); renderHost(main); };
  $('#setSingers').onclick=()=>{ assignSingers(room,[...document.querySelectorAll('.singer:checked')].map(i=>i.value)); broadcastRoom(RPC.SINGER_ASSIGNED); sendCastRoomUpdate('CAST_SET_SINGERS',{players:room.players.filter(p=>p.isSingerForCurrentSong)}); persist(); renderHost(main); };
  document.querySelectorAll('.acceptItem').forEach(b=>b.onclick=()=>{ acceptQueue(room,b.dataset.queueId); publishQueueUpdate(); renderHost(main); });
  document.querySelectorAll('.startItem').forEach(b=>b.onclick=()=>{ startQueueItem(room.queue.find(q=>q.queueItemId===b.dataset.queueId)); renderHost(main); });
  document.querySelectorAll('.rejectItem').forEach(b=>b.onclick=()=>{ rejectQueue(room,b.dataset.queueId); publishQueueUpdate(); renderHost(main); });
  document.querySelectorAll('.removeItem').forEach(b=>b.onclick=()=>{ removeQueueItem(room,b.dataset.queueId); publishQueueUpdate(); renderHost(main); });
  document.querySelectorAll('.mutePlayer').forEach(b=>b.onclick=()=>{ const playerId=b.dataset.playerId; const target=room.players.find(p=>p.playerId===playerId); if(target) peerNode.send(target.peerId,{type:RPC.MIC_MUTED, playerId}); log(`Mute sent to #${target?.playerNumber || '?'}`); });
  $('#castStatus').textContent='Click to connect to Chromecast';
  const cast = castController || (castController = new CastController('CC1AD845'));
  $('#castStatus').textContent='Click to connect to Chromecast';
  attachCastListeners(cast);
  $('#castBtn').onclick=async()=>{ try{ saveCastOrigin(); $('#castBtn').disabled=true; $('#castStatus').textContent='Connecting to Chromecast…'; await cast.init(); await cast.requestSession(); $('#castBtn').style.display='none'; showCastControls(); $('#castStatus').textContent='Connected to TV'; log('Cast connected'); await loadCurrentSongOnTv(); }catch(e){ $('#castBtn').disabled=false; log(e.message); } };
  $('#castLoadBtn').onclick=()=>{ saveCastOrigin(); loadCurrentSongOnTv(); };
  $('#castPlayBtn').onclick=()=>cast.play().catch(e=>log(e.message));
  $('#castPause').onclick=()=>cast.pause();
  $('#castSeek').onclick=()=>cast.seek(+$('#castSeekSeconds').value || 0);
}
export async function playerPage(root){ await loadCatalog(); const storedRoom = loadRoom(); if(!player?.playerId || player.isHost){ player=makePlayer('participant','Player'); persist(); } setupPeer(player.peerId); audio = new PhoneAudio(log); commonChrome(root,'Player Phone'); if(storedRoom && !player?.isHost && storedRoom.hostPeerId){ const reconnectSection = document.createElement('div'); reconnectSection.className='card'; reconnectSection.innerHTML=`<h2>Reconnect</h2><p>Previously in room <strong>${storedRoom.roomCode}</strong> with ${storedRoom.players.length} player(s). Room may still be active.</p><button id="reconnectPair">Create new offer to reconnect</button><button id="forgetRoom">Forget room, start fresh</button>`; document.getElementById('main')?.prepend(reconnectSection); setTimeout(()=>{ document.getElementById('reconnectPair')?.addEventListener('click',()=>{ log('Reconnect: create a new offer below and have the host answer it.'); }); document.getElementById('forgetRoom')?.addEventListener('click',()=>{ localStorage.removeItem('carryokie.room'); localStorage.removeItem('carryokie.player'); location.reload(); }); },0); } renderPlayer($('#main')); }
function renderPlayer(main){
 const song = catalog.find(s=>s.songId===(room?.currentSongId || 'song_002')) || catalog[0];
 const roomCode = new URLSearchParams(location.search).get('room') || room?.roomCode || '';
 const currentTitle = song ? `${escapeHtml(song.title || song.songId)}${song.artist ? ' — '+escapeHtml(song.artist) : ''}` : 'Pick a song';
 main.innerHTML = `<section class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie phone</p><h2>${currentTitle}</h2><p class="subtle">Room ${escapeHtml(roomCode || 'not paired')} · Player #${escapeHtml(player.playerNumber || '?')}</p><div class="primary-actions"><button id="enableMic" class="primary">Enable my mic</button><button id="holdSing" class="hold-button">Hold to sing</button><button id="toggleSing">Live / mute</button><button id="muteMic" class="danger">Mute mic</button></div><p id="micStatus" class="status-pill">Mic muted until enabled.</p></div>
<details class="card" open><summary>1. Join room</summary><p class="subtle">Pair this phone with the host once, then keep this tab open.</p><label>Room code<input id="roomCode" value="${escapeHtml(roomCode)}" placeholder="Room code"></label><button id="makeOffer">Create phone pairing code</button><div id="offerOut"></div><label>Host answer<textarea id="answer" placeholder="Paste host answer/link/chunks"></textarea></label><div class="button-row"><button id="scanAnswerQr">Scan host answer QR</button><button id="importAnswer" class="primary">Finish pairing</button></div></details>
<details class="card" open><summary>2. Queue songs</summary><label>Song<select id="song">${catalog.map(s=>`<option value="${s.songId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`).join('')}</select></label><label>Singers<input id="singers" value="${player.playerNumber || 2}" placeholder="Singer numbers comma separated"></label><div class="button-row"><button id="requestSong" class="primary">Add song to queue</button><button id="requestSinger">Make me a singer</button></div><div class="queue-list">${queueHtml(room,'phone')}</div></details>
<details class="card" open><summary>3. Mic setup</summary><p class="warn compact">${singerWarning}</p><label class="check"><input type="checkbox" id="headphones"> Headphones confirmed</label><label class="check"><input type="checkbox" id="pushToSing"> Push-to-sing</label><label>Mic filter<select id="voicePreset"><option value="clean">Clean</option><option value="alto">Alto warm</option><option value="bravo">Bravo bright</option><option value="bass">Bass low</option><option value="radio">Radio</option><option value="autotune">Autotune-style polish</option></select></label><div class="button-row"><button id="startBacking">Start headphone backing monitor</button><button id="pauseBacking">Pause backing monitor</button></div><label>Remote gain <input id="remoteGain" type="range" min="0" max="2" value="1" step=".05"></label><label>Backing monitor gain <input id="backingGain" type="range" min="0" max="1" value="0.35" step=".05"></label><label>Master gain <input id="masterGain" type="range" min="0" max="2" value="1" step=".05"></label><p id="wake" class="subtle"></p></details>
<details class="card"><summary>4. Lyrics / sync</summary><video id="phoneVideo" controls playsinline muted></video><div id="lyricsPanel"></div><div class="button-row"><button id="earlier">Lyrics earlier</button><button id="later">Lyrics later</button><button id="resetSync">Reset sync</button></div></details>
<details class="card"><summary>Debug room state</summary><pre>${JSON.stringify(room || {status:'not paired'}, null, 2)}</pre></details></section>`;
 document.querySelectorAll('button').forEach(b=>b.addEventListener('click', unlockPhoneAudio));
 $('#makeOffer').onclick=async()=>{ try{ assertWebRtcSupported(); const encoded=await peerNode.createManualOffer('host'); renderPayloadCard($('#offerOut'), encoded, 'Player offer'); }catch(e){log(e.message);} };
 $('#scanAnswerQr').onclick=async()=>{ try{ await scanQrInto($('#answer'), log); }catch(e){log(e.message);} };
 $('#importAnswer').onclick=async()=>{ try{ await peerNode.acceptManualAnswer($('#answer').value); log('Answer imported. Waiting for DataChannel open.'); }catch(e){log(e.message);} };
 $('#requestSong').onclick=()=>{ const item=queueRequest($('#song').value, $('#singers').value.split(',').map(s=>+s.trim()).filter(Boolean), player.playerId, room?.queue?.length || 0); peerNode.broadcast({type:RPC.QUEUE_ADD_REQUEST,item}); log('Queue request sent. If not connected, copy request from debug state.'); };
 $('#requestSinger').onclick=()=>{ peerNode.broadcast({type:RPC.SINGER_JOIN_REQUEST, playerId:player.playerId}); log('Singer slot requested.'); };
 document.querySelectorAll('.queueSelf').forEach(b=>b.onclick=()=>{ peerNode.broadcast({type:RPC.QUEUE_UPDATE_REQUEST, action:b.dataset.action, queueItemId:b.dataset.queueId, playerId:player.playerId}); log('Queue update sent.'); });
 $('#voicePreset').onchange=e=>{ audio?.setVoicePreset(e.target.value); const status=$('#micStatus'); if(status) status.textContent=`Mic filter: ${e.target.selectedOptions?.[0]?.textContent || e.target.value}`; };
 $('#enableMic').onclick=async()=>{ try{ const self = room?.players?.find(p=>p.playerId===player.playerId); if(!self?.isSingerForCurrentSong){ $('#micStatus').textContent='Ask the host to assign you as a singer before publishing.'; log('Mic blocked: ask the host to assign you as a singer before publishing.'); return; } const pushToSing=$('#pushToSing').checked; const status=await audio.tryWakeLock(); $('#wake').textContent = status==='active'?'Wake lock active':'Keep this phone unlocked and tab open during song. Wake lock: '+status; const stream=await audio.requestMic({headphonesConfirmed:$('#headphones').checked,pushToSing}); peerNode.addLocalStream(stream); player.micState={...player.micState, enabled:true, publishing:true, muted:pushToSing}; persist(); peerNode.broadcast({type:RPC.MIC_ENABLED, playerId:player.playerId}); $('#micStatus').textContent = pushToSing ? 'Mic ready. Hold to sing.' : 'Mic live.'; log('Mic publishing. Own mic not locally monitored.'); }catch(e){ $('#micStatus').textContent=e.message; log(e.message);} };
 const hold=$('#holdSing'); hold.onpointerdown=e=>{ e.preventDefault(); try{ hold.setPointerCapture?.(e.pointerId); }catch{} setOwnMicMuted(false); }; hold.onpointerup=()=>setOwnMicMuted(true); hold.onpointercancel=()=>setOwnMicMuted(true); hold.onpointerleave=()=>setOwnMicMuted(true); $('#toggleSing').onclick=()=>setOwnMicMuted(!(player?.micState?.muted===false)); $('#muteMic').onclick=()=>setOwnMicMuted(true); $('#startBacking').onclick=async()=>audio?.startBackingMonitor(await resolvePlayableMediaUrl(song),{headphonesConfirmed:$('#headphones').checked}).catch(e=>{ $('#micStatus').textContent=e.message; log(e.message); }); $('#pauseBacking').onclick=()=>audio?.pauseBackingMonitor(); $('#remoteGain').oninput=e=>audio?.setGain('remote',+e.target.value); $('#backingGain').oninput=e=>audio?.setGain('backing',+e.target.value); $('#masterGain').oninput=e=>audio?.setGain('master',+e.target.value);
 $('#earlier').onclick=()=>{ room.playbackState.seekOffsetMs-=250; persist(); renderLyricsPanel(); }; $('#later').onclick=()=>{ room.playbackState.seekOffsetMs+=250; persist(); renderLyricsPanel(); }; $('#resetSync').onclick=()=>{ room.playbackState.seekOffsetMs=0; persist(); renderLyricsPanel(); };
 renderLyricsPanel();
 renderPhoneVideo(song);
}
async function renderPhoneVideo(song){
 const video = $('#phoneVideo'); if(!video) return;
 if(!isProtectedMedia(song)){ video.style.display='none'; video.removeAttribute('src'); return; }
 video.style.display='block'; video.poster=''; video.muted=true; video.playsInline=true;
 try { const url = await resolvePlayableMediaUrl(song); if(video.src !== url) video.src = url; if(!phoneSyncTimer) phoneSyncTimer = setInterval(syncPhoneVideo, 500); syncPhoneVideo(); } catch(e) { log(e.message); }
}
function syncPhoneVideo(){
 const video = $('#phoneVideo'); if(!video || video.style.display==='none' || !room?.playbackState) return;
 const derived = deriveTvMediaPositionMs(room.playbackState, Date.now(), peerNode?.clockOffsetMs || 0);
 const seconds = Math.max(0, derived.positionMs / 1000);
 if(Number.isFinite(seconds) && Math.abs((video.currentTime || 0) - seconds) > 0.75) video.currentTime = seconds;
 if(!room.playbackState.paused && room.playbackState.status !== 'paused') video.play?.().catch(()=>log('Tap the lyric video once if this browser blocks autoplay.'));
 if(room.playbackState.paused || room.playbackState.status === 'paused') video.pause?.();
}
async function renderLyricsPanel(){ const panel=$('#lyricsPanel'); if(!panel || !catalog.length) return; const song=catalog.find(s=>s.songId===(room?.currentSongId||'song_002'))||catalog[0]; if (isProtectedMedia(song)) { panel.innerHTML = '<p>Lyric video loaded above. No separate lyric file needed.</p>'; return; } const lyrics=await fetch(song.lyricsJsonUrl).then(r=>r.json()).catch(()=>({lines:[]})); const ps=room?.playbackState; const derived = deriveTvMediaPositionMs(ps, Date.now(), peerNode?.clockOffsetMs || 0); let t = derived.positionMs; panel.innerHTML = (derived.syncDegraded ? '<p class="warn">Sync degraded: waiting for actual TV Cast media status.</p>' : '') + lyricView(lyrics.lines,t); }
function queueHtml(r, mode='host'){
 if(!r?.queue?.length) return '<p>Queue is empty.</p>';
 return `<ul>${r.queue.map(q=>{
  const queueId = escapeHtml(q.queueItemId);
  const hostControls = `${['requested','rejected'].includes(q.status)?`<button class="acceptItem" data-queue-id="${queueId}" title="Accept/requeue">Accept</button>`:''} ${q.status==='queued'?`<button class="startItem" data-queue-id="${queueId}" title="Start on TV">Start</button>`:''} ${q.status==='requested'?`<button class="rejectItem" data-queue-id="${queueId}" title="Reject">Reject</button>`:''} <button class="removeItem" data-queue-id="${queueId}" title="Remove">Remove</button>`;
  const phoneControls = !['active','ended'].includes(q.status) ? `<button class="queueSelf" data-action="join" data-queue-id="${queueId}">Add me as singer</button> <button class="queueSelf" data-action="leave" data-queue-id="${queueId}">Remove me</button> ${q.requestedByPlayerId===player?.playerId?`<button class="queueSelf" data-action="remove" data-queue-id="${queueId}">Remove request</button>`:''}` : '';
  return `<li>${escapeHtml(q.status)}: ${escapeHtml(songTitle(q.songId))} singers ${escapeHtml(q.singerNumbers.join(','))} ${mode==='host'?hostControls:phoneControls}</li>`;
 }).join('')}</ul>`;
}
export async function debugPage(root){ commonChrome(root,'Debug'); const savedRoom = loadRoom(); const savedPlayer = JSON.parse(localStorage.getItem('carryokie.player')||'null'); $('#main').innerHTML = `<section class="card"><h2>Local state</h2><button id="refresh">Refresh</button><pre>${JSON.stringify({room:savedRoom, player:savedPlayer},null,2)}</pre><h2>Connection diagnostics</h2><pre>${JSON.stringify({peerId:savedPlayer?.peerId, hostPeerId:savedRoom?.hostPeerId, dataChannelPeerIds:peerNode ? [...peerNode.peers.keys()] : [], clockOffsetMs:peerNode?.clockOffsetMs ?? null, castState:castController?.state?.() ?? savedRoom?.castState ?? null, micPermission:savedPlayer?.micState?.permissionState ?? 'unknown'},null,2)}</pre><p>ICE failures mean network may require TURN/different Wi-Fi. Strict MVP uses STUN only.</p><p>Keep phone unlocked and tab open; mobile browsers may suspend audio/WebRTC.</p></section><section class="card"><h2>Manual offer/answer</h2><p>Use these for manual pairing when WebRTC signaling fails.</p><div id="debugRole"></div><button id="debugOffer">Create offer</button><div id="offerOut"></div><textarea id="debugAnswer" placeholder="Paste answer/link/chunks"></textarea><button id="debugImport">Import answer</button><div id="answerOut"></div></section>`; $('#refresh').onclick=()=>location.reload(); $('#debugOffer').onclick=async()=>{ try{ const encoded=await peerNode.createManualOffer('host'); renderPayloadCard($('#offerOut'), encoded, 'Offer'); }catch(e){log(e.message);} }; $('#debugImport').onclick=async()=>{ try{ const encoded=await peerNode.acceptManualOffer($('#debugAnswer').value); renderPayloadCard($('#answerOut'), encoded, 'Answer'); }catch(e){log(e.message);} }; }
export function receiverPage(root){ receiverApp(root); }
