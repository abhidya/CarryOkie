//#region \0vite/modulepreload-polyfill.js
(function polyfill() {
	const relList = document.createElement("link").relList;
	if (relList && relList.supports && relList.supports("modulepreload")) return;
	for (const link of document.querySelectorAll("link[rel=\"modulepreload\"]")) processPreload(link);
	new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type !== "childList") continue;
			for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
		}
	}).observe(document, {
		childList: true,
		subtree: true
	});
	function getFetchOpts(link) {
		const fetchOpts = {};
		if (link.integrity) fetchOpts.integrity = link.integrity;
		if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
		if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
		else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
		else fetchOpts.credentials = "same-origin";
		return fetchOpts;
	}
	function processPreload(link) {
		if (link.ep) return;
		link.ep = true;
		const fetchOpts = getFetchOpts(link);
		fetch(link.href, fetchOpts);
	}
})();
function uuid() {
	return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : URL.createObjectURL(new Blob()).split("/").pop();
}
function nowMs() {
	return Date.now();
}
function makeRoomCode() {
	const words = [
		"BLUE",
		"CAT",
		"STAR",
		"MOON",
		"BIRD",
		"MINT",
		"GOLD",
		"ECHO",
		"KITE",
		"WAVE"
	];
	return words[Math.floor(Math.random() * words.length)] + words[Math.floor(Math.random() * words.length)];
}
function normalizeDisplayName(displayName, fallback = "Guest") {
	if (typeof displayName !== "string") return fallback;
	return displayName.trim().replace(/\s+/g, " ").slice(0, 32) || fallback;
}
function makePlayer(role = "participant", displayName = "Guest") {
	return {
		peerId: uuid(),
		playerId: uuid(),
		playerNumber: null,
		displayName: normalizeDisplayName(displayName, "Guest"),
		role,
		isHost: role === "host",
		isSingerForCurrentSong: false,
		micState: {
			permissionState: "prompt",
			enabled: false,
			muted: true,
			publishing: false,
			receivingPeerIds: [],
			remoteGain: 1,
			localMonitorGain: 0,
			backingGain: 0,
			masterGain: 1
		},
		monitorState: {
			headphonesConfirmed: false,
			phoneSpeakerOutputAck: false,
			keepAwake: "unknown"
		},
		connectionState: "new",
		lastSeenAt: nowMs()
	};
}
function makeRoom(hostPlayer) {
	return {
		roomId: uuid(),
		roomCode: makeRoomCode(),
		hostPeerId: hostPlayer.peerId,
		hostPlayerId: hostPlayer.playerId,
		createdAt: nowMs(),
		playerCount: 1,
		maxPlayers: 5,
		currentSongId: "song_002",
		currentQueueItemId: null,
		playbackState: {
			songId: "song_002",
			status: "idle",
			startedAtHostMs: null,
			pausedAtSongMs: 0,
			seekOffsetMs: 0,
			playbackRate: 1,
			lastUpdatedAtHostMs: nowMs(),
			tvMediaTimeMs: 0,
			tvMediaTimeSampledAtHostMs: null,
			syncDegraded: true
		},
		players: [hostPlayer],
		queue: [],
		castState: {
			available: false,
			connected: false,
			receiverReady: false,
			currentMediaLoaded: false,
			lastCommandAt: null,
			lastReceiverAckAt: null,
			error: null
		},
		meshState: {
			edges: {},
			failures: []
		},
		limits: {
			maxPlayers: 5,
			maxSingers: 5
		}
	};
}
function addPlayer(room, player) {
	if (room.players.length >= 5) throw new Error("Room full: MVP cap is 5 players.");
	const taken = new Set(room.players.map((p) => p.playerNumber).filter(Boolean));
	player.playerNumber = [
		1,
		2,
		3,
		4,
		5
	].find((n) => !taken.has(n)) ?? null;
	room.players.push(player);
	room.playerCount = room.players.length;
	return room;
}
function assignSingers(room, playerIds) {
	if (playerIds.length > 5) throw new Error(`Maximum 5 active singers.`);
	const chosen = new Set(playerIds);
	room.players.forEach((p) => {
		p.isSingerForCurrentSong = chosen.has(p.playerId);
		p.role = p.isHost ? "host" : p.isSingerForCurrentSong ? "singer" : "listener";
	});
	return room;
}
function queueRequest(songId, singerNumbers, requestedByPlayerId, currentQueueLength = 0) {
	if (singerNumbers.length > 5) throw new Error(`Queue item max 5 singers.`);
	const singers = [...new Set(singerNumbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 5))];
	if (!songId) throw new Error("Queue item needs a song.");
	if (!requestedByPlayerId) throw new Error("Queue item needs a requesting player.");
	if (singers.length === 0) throw new Error("Queue item needs at least one singer number.");
	if (currentQueueLength >= 20) throw new Error(`Queue full: MVP cap is 20 items.`);
	return {
		queueItemId: uuid(),
		songId,
		singerNumbers: singers,
		requestedByPlayerId,
		status: "requested",
		createdAt: nowMs(),
		acceptedAt: null
	};
}
function acceptQueue(room, queueItemId) {
	const item = room.queue.find((q) => q.queueItemId === queueItemId);
	if (!item || item.status === "active" || item.status === "ended") return room;
	item.status = "queued";
	item.acceptedAt = nowMs();
	return room;
}
function rejectQueue(room, queueItemId) {
	const item = room.queue.find((q) => q.queueItemId === queueItemId);
	if (!item || item.status === "active" || item.status === "ended") return room;
	item.status = "rejected";
	return room;
}
function removeQueueItem(room, queueItemId) {
	room.queue = room.queue.filter((q) => q.queueItemId !== queueItemId);
	if (room.currentQueueItemId === queueItemId) room.currentQueueItemId = null;
	return room;
}
function moveQueueItem(room, queueItemId, direction) {
	const index = room.queue.findIndex((q) => q.queueItemId === queueItemId);
	if (index < 0) return room;
	const nextIndex = index + direction;
	if (nextIndex < 0 || nextIndex >= room.queue.length) return room;
	const [item] = room.queue.splice(index, 1);
	room.queue.splice(nextIndex, 0, item);
	return room;
}
function safeClientQueueId(id) {
	return typeof id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(id);
}
function enqueueRequest(room, item) {
	if (room.queue.some((q) => q.queueItemId === item.queueItemId)) return room;
	const openLength = room.queue.filter((q) => !["ended", "rejected"].includes(q.status)).length;
	const normalized = queueRequest(item.songId, item.singerNumbers, item.requestedByPlayerId, openLength);
	normalized.queueItemId = safeClientQueueId(item.queueItemId) ? item.queueItemId : normalized.queueItemId;
	normalized.createdAt = item.createdAt || normalized.createdAt;
	room.queue.push(normalized);
	return room;
}
function nextQueuedItem(room) {
	return room.queue.find((q) => q.status === "queued");
}
function addSingerToQueueItem(room, queueItemId, singerNumber) {
	const item = room.queue.find((q) => q.queueItemId === queueItemId);
	if (!item || item.status === "active" || item.status === "ended") return room;
	if (!Number.isInteger(singerNumber) || singerNumber < 1 || singerNumber > 5) return room;
	if (!item.singerNumbers.includes(singerNumber)) {
		if (item.singerNumbers.length >= 5) throw new Error(`Queue item max 5 singers.`);
		item.singerNumbers.push(singerNumber);
	}
	if (item.status === "rejected") item.status = "requested";
	return room;
}
function removeSingerFromQueueItem(room, queueItemId, singerNumber) {
	const item = room.queue.find((q) => q.queueItemId === queueItemId);
	if (!item || item.status === "active" || item.status === "ended") return room;
	const next = item.singerNumbers.filter((n) => n !== singerNumber);
	if (next.length === 0) throw new Error("Queue item needs at least one singer number.");
	item.singerNumbers = next;
	return room;
}
function lockHostLost(room) {
	room.playbackState.status = "host_lost";
	room.hostLostMessage = "Host disconnected. Audio between already-connected phones may continue, but TV and queue controls are locked. Create a new room to continue.";
	return room;
}
function saveRoom(room) {
	localStorage.setItem("carryokie.room", JSON.stringify(room));
}
function loadRoom() {
	try {
		return JSON.parse(localStorage.getItem("carryokie.room") || "null");
	} catch {
		return null;
	}
}
//#endregion
//#region src/qr.ts
var VERSION = 10;
var SIZE = 17 + VERSION * 4;
var DATA_CODEWORDS = 274;
var EC_CODEWORDS_PER_BLOCK = 18;
var BLOCK_SIZES = [
	68,
	68,
	69,
	69
];
var ALIGN = [
	6,
	28,
	50
];
function pushBits(bits, value, length) {
	for (let i = length - 1; i >= 0; i--) bits.push(value >>> i & 1);
}
function bitsToBytes(bits) {
	const out = [];
	for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));
	return out;
}
function gfMul(x, y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1 ^ (z >>> 7) * 285) & 255;
		if (y >>> i & 1) z ^= x;
	}
	return z;
}
function rsGenerator(degree) {
	let poly = [1];
	let root = 1;
	for (let i = 0; i < degree; i++) {
		const next = Array(poly.length + 1).fill(0);
		for (let j = 0; j < poly.length; j++) {
			next[j] ^= gfMul(poly[j], root);
			next[j + 1] ^= poly[j];
		}
		poly = next;
		root = gfMul(root, 2);
	}
	return poly;
}
function rsRemainder(data, degree) {
	const gen = rsGenerator(degree);
	const rem = Array(degree).fill(0);
	for (const b of data) {
		const factor = b ^ rem.shift();
		rem.push(0);
		for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i], factor);
	}
	return rem;
}
function encodeData(text) {
	const bytes = [...new TextEncoder().encode(text)];
	if (bytes.length > 260) throw new Error(`QR chunk too large (${bytes.length} bytes). Use smaller chunks.`);
	const bits = [];
	pushBits(bits, 4, 4);
	pushBits(bits, bytes.length, 16);
	bytes.forEach((b) => pushBits(bits, b, 8));
	pushBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
	while (bits.length % 8) bits.push(0);
	const data = bitsToBytes(bits);
	for (let pad = 236; data.length < DATA_CODEWORDS; pad ^= 253) data.push(pad);
	return data;
}
function makeCodewords(text) {
	const data = encodeData(text);
	const blocks = [];
	let off = 0;
	for (const size of BLOCK_SIZES) {
		const dat = data.slice(off, off + size);
		off += size;
		blocks.push({
			data: dat,
			ec: rsRemainder(dat, EC_CODEWORDS_PER_BLOCK)
		});
	}
	const out = [];
	for (let i = 0; i < Math.max(...BLOCK_SIZES); i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
	for (let i = 0; i < EC_CODEWORDS_PER_BLOCK; i++) for (const b of blocks) out.push(b.ec[i]);
	return out;
}
function blankMatrix() {
	return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}
function set(m, r, c, v) {
	if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) m[r][c] = !!v;
}
function reserve(m, r, c, v = false) {
	set(m, r, c, v);
}
function addFinder(m, row, col) {
	for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
		const rr = row + r, cc = col + c;
		if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
		set(m, rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || r >= 2 && r <= 4 && c >= 2 && c <= 4));
	}
}
function addAlignment(m, row, col) {
	if (m[row][col] !== null) return;
	for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(m, row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
}
function bch(value, poly, shift) {
	let v = value << shift;
	1 << Math.floor(Math.log2(poly));
	for (let i = Math.floor(Math.log2(v)); i >= shift; i--) if (v >>> i & 1) v ^= poly << i - Math.floor(Math.log2(poly));
	return value << shift | v;
}
function addFunctionPatterns(m) {
	addFinder(m, 0, 0);
	addFinder(m, 0, SIZE - 7);
	addFinder(m, SIZE - 7, 0);
	for (let i = 8; i < SIZE - 8; i++) {
		set(m, 6, i, i % 2 === 0);
		set(m, i, 6, i % 2 === 0);
	}
	for (const r of ALIGN) for (const c of ALIGN) addAlignment(m, r, c);
	set(m, 4 * VERSION + 9, 8, true);
	for (let i = 0; i < 9; i++) {
		reserve(m, 8, i);
		reserve(m, i, 8);
	}
	for (let i = 0; i < 8; i++) {
		reserve(m, 8, SIZE - 1 - i);
		reserve(m, SIZE - 1 - i, 8);
	}
	const versionBits = bch(VERSION, 7973, 12);
	for (let i = 0; i < 18; i++) {
		const bit = (versionBits >>> i & 1) === 1;
		set(m, Math.floor(i / 3), SIZE - 11 + i % 3, bit);
		set(m, SIZE - 11 + i % 3, Math.floor(i / 3), bit);
	}
}
function placeData(m, codewords) {
	const bits = [];
	codewords.forEach((b) => pushBits(bits, b, 8));
	let idx = 0, upward = true;
	for (let col = SIZE - 1; col >= 1; col -= 2) {
		if (col === 6) col--;
		for (let i = 0; i < SIZE; i++) {
			const row = upward ? SIZE - 1 - i : i;
			for (let c = col; c >= col - 1; c--) if (m[row][c] === null) {
				const masked = ((bits[idx++] || 0) ^ ((row + c) % 2 === 0 ? 1 : 0)) === 1;
				set(m, row, c, masked);
			}
		}
		upward = !upward;
	}
}
function addFormat(m) {
	const format = bch(8, 1335, 10) ^ 21522;
	const bit = (i) => (format >>> i & 1) === 1;
	[
		[8, 0],
		[8, 1],
		[8, 2],
		[8, 3],
		[8, 4],
		[8, 5],
		[8, 7],
		[8, 8],
		[7, 8],
		[5, 8],
		[4, 8],
		[3, 8],
		[2, 8],
		[1, 8],
		[0, 8]
	].forEach(([r, c], i) => set(m, r, c, bit(i)));
	[
		[SIZE - 1, 8],
		[SIZE - 2, 8],
		[SIZE - 3, 8],
		[SIZE - 4, 8],
		[SIZE - 5, 8],
		[SIZE - 6, 8],
		[SIZE - 7, 8],
		[8, SIZE - 8],
		[8, SIZE - 7],
		[8, SIZE - 6],
		[8, SIZE - 5],
		[8, SIZE - 4],
		[8, SIZE - 3],
		[8, SIZE - 2],
		[8, SIZE - 1]
	].forEach(([r, c], i) => set(m, r, c, bit(i)));
}
function qrMatrix(text) {
	const m = blankMatrix();
	addFunctionPatterns(m);
	placeData(m, makeCodewords(text));
	addFormat(m);
	return m.map((row) => row.map((v) => !!v));
}
function qrSvg(text, { scale = 4, quiet = 4, title = "CarryOkie QR" } = {}) {
	const m = qrMatrix(text);
	const n = m.length + quiet * 2;
	const rects = [];
	m.forEach((row, r) => row.forEach((v, c) => {
		if (v) rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`);
	}));
	return `<svg class="qr" data-qr="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}
//#endregion
//#region src/signaling.ts
var enc = new TextEncoder();
var dec = new TextDecoder();
function b64url(bytes) {
	let s = "";
	bytes.forEach((b) => s += String.fromCharCode(b));
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
	s = s.replace(/-/g, "+").replace(/_/g, "/");
	while (s.length % 4) s += "=";
	const bin = atob(s);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function compress(bytes) {
	if (!("CompressionStream" in globalThis)) return {
		alg: "plain",
		bytes
	};
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
	return {
		alg: "deflate",
		bytes: new Uint8Array(await new Response(stream).arrayBuffer())
	};
}
async function decompress(alg, bytes) {
	if (alg === "plain") return bytes;
	if (!("DecompressionStream" in globalThis)) throw new Error("Deflate payload unsupported in this runtime. Use a modern browser.");
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
function stripSdpForManual(sdp) {
	const rawLines = sdp.replace(/\r?\n/g, "\r\n").trim().split("\r\n").filter(Boolean);
	const sessionLines = [];
	const sections = [];
	let current = null;
	for (const line of rawLines) if (line.startsWith("m=")) {
		current = [line];
		sections.push(current);
	} else if (current) current.push(line);
	else sessionLines.push(line);
	const keptSections = sections.map(minifyMediaSection).filter((section) => section.length > 0);
	const keptMids = keptSections.map((section) => section.find((line) => line.startsWith("a=mid:"))?.slice(6)).filter(Boolean);
	return [...sessionLines.map((line) => line.startsWith("a=group:BUNDLE") && keptMids.length ? `a=group:BUNDLE ${keptMids.join(" ")}` : line).filter((line) => isSessionLineKept(line)), ...keptSections.flat()].join("\r\n") + "\r\n";
}
function isSessionLineKept(line) {
	return /^(v=|o=|s=|t=|a=group:BUNDLE|a=msid-semantic:|a=ice-ufrag:|a=ice-pwd:|a=ice-options:|a=fingerprint:|a=setup:)/.test(line);
}
function minifyCandidate(line) {
	const parts = line.split(/\s+/);
	return parts.filter((part, index) => ![
		"generation",
		"network-id",
		"network-cost"
	].includes(part) && ![
		"generation",
		"network-id",
		"network-cost"
	].includes(parts[index - 1])).join(" ");
}
function minifyMediaSection(section) {
	const m = section[0];
	const kind = m.split(/\s+/)[0].slice(2);
	if (!["audio", "application"].includes(kind)) return [];
	const mid = section.find((line) => line.startsWith("a=mid:"));
	if (kind === "application") return section.filter((line) => line.startsWith("m=") || line === mid || /^(c=|a=ice-ufrag:|a=ice-pwd:|a=fingerprint:|a=setup:|a=sctp-port:|a=max-message-size:|a=candidate:|a=end-of-candidates)/.test(line)).map((line) => line.startsWith("a=candidate:") ? minifyCandidate(line) : line);
	const opusPayload = section.map((line) => line.match(/^a=rtpmap:(\d+) opus\/48000\/2/i)?.[1]).find(Boolean);
	const header = opusPayload ? m.split(/\s+/).slice(0, 3).concat(opusPayload).join(" ") : m;
	return section.map((line) => line === m ? header : line).filter((line) => {
		if (line.startsWith("a=rtpmap:") || line.startsWith("a=fmtp:") || line.startsWith("a=rtcp-fb:")) return !opusPayload || line.startsWith(`a=rtpmap:${opusPayload} `) || line.startsWith(`a=fmtp:${opusPayload} `);
		return line.startsWith("m=") || line === mid || /^(c=|a=ice-ufrag:|a=ice-pwd:|a=fingerprint:|a=setup:|a=rtcp-mux|a=sendrecv|a=recvonly|a=sendonly|a=inactive|a=msid:|a=ssrc:|a=candidate:|a=end-of-candidates)/.test(line);
	}).map((line) => line.startsWith("a=candidate:") ? minifyCandidate(line) : line);
}
async function encodeSignalPayload(payload) {
	const body = {
		v: 1,
		app: "carryokie",
		createdAt: Date.now(),
		...payload
	};
	if (typeof body.description === "object" && body.description !== null && "sdp" in body.description) {
		const description = body.description;
		body.description = {
			type: description.type,
			sdp: stripSdpForManual(description.sdp || "")
		};
	}
	const packed = await compress(enc.encode(JSON.stringify(body)));
	const token = `ck1.${packed.alg}.${b64url(packed.bytes)}`;
	const loc = globalThis.location || {
		origin: "http://localhost",
		pathname: "/player/"
	};
	return {
		token,
		url: `${loc.origin}${loc.pathname}#signal=${token}`,
		chunks: chunkToken(token)
	};
}
async function decodeSignalPayload(input) {
	const parts = extractToken(input).split(".");
	if (parts.length !== 3 || parts[0] !== "ck1") throw new Error("Signal import failed: unsupported CarryOkie payload.");
	const bytes = await decompress(parts[1], unb64url(parts[2]));
	const payload = JSON.parse(dec.decode(bytes));
	if (payload.app !== "carryokie") throw new Error("Signal import failed: not a CarryOkie payload.");
	return payload;
}
function extractToken(input) {
	input = (input || "").trim();
	if (input.startsWith("chunk:")) throw new Error("Paste all chunks into the multi-chunk field before import.");
	try {
		const u = new URL(input);
		const hash = new URLSearchParams(u.hash.slice(1));
		if (hash.get("signal")) return hash.get("signal");
	} catch {}
	const m = input.match(/ck1\.[a-z]+\.[A-Za-z0-9_-]+/);
	if (!m) throw new Error("Signal import failed: no payload found.");
	return m[0];
}
function chunkToken(token, size = 240) {
	let n = Math.ceil(token.length / size);
	const maxPrefix = `chunk:${n}/${n}:`.length;
	if (size + maxPrefix > 260) size = Math.max(1, 260 - maxPrefix);
	n = Math.ceil(token.length / size);
	return Array.from({ length: n }, (_, i) => `chunk:${i + 1}/${n}:${token.slice(i * size, (i + 1) * size)}`);
}
function joinChunks(text) {
	const parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((l) => {
		const m = l.match(/^chunk:(\d+)\/(\d+):(.+)$/);
		if (!m) return null;
		return {
			i: +m[1],
			n: +m[2],
			data: m[3]
		};
	});
	if (parts.some((p) => !p)) return text;
	const n = parts[0].n;
	if (parts.length !== n) throw new Error(`Need ${n} chunks, got ${parts.length}.`);
	return parts.sort((a, b) => a.i - b.i).map((p) => p.data).join("");
}
function renderPayloadCard(target, encoded, label = "Signal payload") {
	const urlField = () => target.querySelector("textarea");
	const flashButton = (selector, text) => {
		const button = target.querySelector(selector);
		if (!button) return;
		const originalText = button.textContent;
		button.textContent = text;
		setTimeout(() => button.textContent = originalText, 1500);
	};
	const selectLinkFallback = () => {
		const field = urlField();
		if (!field) return false;
		field.focus();
		field.select();
		field.setSelectionRange?.(0, field.value.length);
		return true;
	};
	const tryLegacyCopy = () => {
		if (!selectLinkFallback()) return false;
		try {
			return !!document.execCommand?.("copy");
		} catch {
			return false;
		}
	};
	let index = 0;
	const renderQr = () => {
		const qr = target.querySelector("[data-single-qr]");
		const count = target.querySelector("[data-qr-count]");
		if (qr) qr.innerHTML = qrSvg(encoded.chunks[index]);
		if (count) count.textContent = `QR ${index + 1}/${encoded.chunks.length}`;
	};
	target.innerHTML = `<div class="payload"><h3>${label}</h3><p>One QR code is shown at a time. Scan it, then use Next only if this payload needs another local chunk. Link/share/copy remains available.</p><figure><figcaption data-qr-count></figcaption><div data-single-qr></div></figure><div class="actions"><button data-prev>Prev QR</button><button data-next>Next QR</button><button data-copy>Copy link</button><button data-share>Share</button></div><textarea readonly>${encoded.url}</textarea><details><summary>Text fallback (${encoded.chunks.length} local chunk${encoded.chunks.length === 1 ? "" : "s"})</summary><textarea readonly>${encoded.chunks.join("\n")}</textarea></details></div>`;
	renderQr();
	const syncButtons = () => {
		target.querySelector("[data-prev]").disabled = index === 0;
		target.querySelector("[data-next]").disabled = index === encoded.chunks.length - 1;
	};
	syncButtons();
	target.querySelector("[data-prev]").onclick = () => {
		index = Math.max(0, index - 1);
		renderQr();
		syncButtons();
	};
	target.querySelector("[data-next]").onclick = () => {
		index = Math.min(encoded.chunks.length - 1, index + 1);
		renderQr();
		syncButtons();
	};
	target.querySelector("[data-copy]").onclick = async () => {
		try {
			await navigator.clipboard.writeText(encoded.url);
			flashButton("[data-copy]", "Copied!");
		} catch (err) {
			console.error("Copy failed:", err);
			if (tryLegacyCopy()) {
				flashButton("[data-copy]", "Copied!");
				return;
			}
			selectLinkFallback();
			flashButton("[data-copy]", "Press ⌘/Ctrl+C");
		}
	};
	target.querySelector("[data-share]").onclick = async () => {
		try {
			if (navigator.share) {
				await navigator.share({
					title: "CarryOkie signal",
					text: encoded.url
				});
				flashButton("[data-share]", "Shared!");
			} else {
				await navigator.clipboard.writeText(encoded.url);
				flashButton("[data-share]", "Copied!");
			}
		} catch (err) {
			console.error("Share failed:", err);
			if (tryLegacyCopy()) {
				flashButton("[data-share]", "Copied!");
				return;
			}
			selectLinkFallback();
			flashButton("[data-share]", "Press ⌘/Ctrl+C");
		}
	};
}
async function scanQrInto(target, log = () => {}) {
	const Detector = globalThis.BarcodeDetector;
	if (!Detector) throw new Error("Camera QR import needs Chrome/Android BarcodeDetector support. Use copy/paste fallback on this browser.");
	if (!navigator.mediaDevices) throw new Error("Camera QR import needs camera permission and HTTPS.");
	if (!navigator.mediaDevices.getUserMedia) throw new Error("Camera QR import needs camera permission and HTTPS.");
	const stream = await navigator.mediaDevices.getUserMedia({
		video: { facingMode: "environment" },
		audio: false
	});
	const video = document.createElement("video");
	video.playsInline = true;
	video.muted = true;
	video.autoplay = true;
	video.srcObject = stream;
	video.style.cssText = "width:100%;max-height:280px;background:#000;border-radius:12px;margin:.5rem 0";
	target.insertAdjacentElement("beforebegin", video);
	await video.play();
	const detector = new Detector({ formats: ["qr_code"] });
	log("Scanning QR with camera…");
	return new Promise((resolve, reject) => {
		const stop = () => {
			stream.getTracks().forEach((t) => t.stop());
			video.remove();
		};
		const timeout = window.setTimeout(() => {
			stop();
			reject(/* @__PURE__ */ new Error("No QR found. Try brighter light or paste the link/chunks."));
		}, 3e4);
		const tick = async () => {
			try {
				const raw = (await detector.detect(video))[0]?.rawValue?.trim();
				if (raw) {
					window.clearTimeout(timeout);
					stop();
					target.value = raw.startsWith("chunk:") && target.value.trim() ? `${target.value.trim()}\n${raw}` : raw;
					target.dispatchEvent(new Event("input", { bubbles: true }));
					log("QR imported.");
					resolve(raw);
					return;
				}
				requestAnimationFrame(tick);
			} catch (e) {
				window.clearTimeout(timeout);
				stop();
				reject(e);
			}
		};
		tick();
	});
}
//#endregion
//#region src/webrtc.ts
var rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
var RPC = {
	ROOM_HELLO: "ROOM_HELLO",
	ROOM_STATE_SNAPSHOT: "ROOM_STATE_SNAPSHOT",
	PLAYER_JOINED: "PLAYER_JOINED",
	PLAYER_LEFT: "PLAYER_LEFT",
	QUEUE_ADD_REQUEST: "QUEUE_ADD_REQUEST",
	QUEUE_UPDATE_REQUEST: "QUEUE_UPDATE_REQUEST",
	QUEUE_ACCEPTED: "QUEUE_ACCEPTED",
	QUEUE_REJECTED: "QUEUE_REJECTED",
	QUEUE_UPDATED: "QUEUE_UPDATED",
	SINGER_JOIN_REQUEST: "SINGER_JOIN_REQUEST",
	SINGER_ASSIGNED: "SINGER_ASSIGNED",
	SINGER_REMOVED: "SINGER_REMOVED",
	MIC_ENABLED: "MIC_ENABLED",
	MIC_MUTED: "MIC_MUTED",
	MIC_UNMUTED: "MIC_UNMUTED",
	PLAYBACK_STARTED: "PLAYBACK_STARTED",
	PLAYBACK_PAUSED: "PLAYBACK_PAUSED",
	PLAYBACK_SEEKED: "PLAYBACK_SEEKED",
	PLAYBACK_SYNC: "PLAYBACK_SYNC",
	LATENCY_PING: "LATENCY_PING",
	LATENCY_PONG: "LATENCY_PONG",
	SIGNAL_RELAY_OFFER: "SIGNAL_RELAY_OFFER",
	SIGNAL_RELAY_ANSWER: "SIGNAL_RELAY_ANSWER",
	SIGNAL_RELAY_ICE: "SIGNAL_RELAY_ICE",
	ERROR_NOTICE: "ERROR_NOTICE"
};
var fallbackTrackIds = /* @__PURE__ */ new WeakMap();
var fallbackTrackId = 0;
function mediaTrackKey(track) {
	if (track.id) return `${track.kind}:${track.id}`;
	let id = fallbackTrackIds.get(track);
	if (!id) {
		fallbackTrackId += 1;
		id = `anon-${fallbackTrackId}`;
		fallbackTrackIds.set(track, id);
	}
	return `${track.kind}:${id}`;
}
function streamTracks(stream) {
	return typeof stream.getTracks === "function" ? stream.getTracks() : [];
}
function streamTrackKeys(stream) {
	return streamTracks(stream).map(mediaTrackKey);
}
function assertWebRtcSupported() {
	if (typeof RTCPeerConnection === "undefined") throw new Error("WebRTC is unavailable in this browser/context. On phones, open the GitHub Pages HTTPS URL or serve local testing over HTTPS; local HTTP hostnames may block offer creation.");
}
var PeerNode = class extends EventTarget {
	localPeerId;
	peers;
	clockOffsetMs;
	localStreams;
	relayedStreams;
	constructor(localPeerId) {
		super();
		this.localPeerId = localPeerId;
		this.peers = /* @__PURE__ */ new Map();
		this.clockOffsetMs = 0;
		this.localStreams = [];
		this.relayedStreams = [];
	}
	makeConnection(remotePeerId, { manual = true, initiator = false, replace = false } = {}) {
		assertWebRtcSupported();
		const existing = this.peers.get(remotePeerId);
		if (existing && !replace) return existing;
		if (existing && replace) {
			existing.pc.close?.();
			this.peers.delete(remotePeerId);
		}
		const pc = new RTCPeerConnection(rtcConfig);
		const edge = {
			remotePeerId,
			pc,
			dc: null,
			streams: [],
			sentTrackKeys: /* @__PURE__ */ new Set(),
			manual,
			initiator
		};
		pc.oniceconnectionstatechange = () => this.emit("ice", {
			remotePeerId,
			state: pc.iceConnectionState
		});
		pc.onconnectionstatechange = () => {
			this.emit("connection", {
				remotePeerId,
				state: pc.connectionState
			});
			if (pc.connectionState === "failed") this.emit("error", {
				message: "WebRTC failed. Strict mode has STUN but no TURN; try same Wi-Fi or a less restrictive network.",
				remotePeerId
			});
		};
		pc.ontrack = (ev) => {
			const stream = ev.streams[0] || (ev.track ? new MediaStream([ev.track]) : void 0);
			this.emit("track", {
				remotePeerId,
				stream,
				track: ev.track
			});
			if (stream) this.emit("duet", {
				remotePeerId,
				stream
			});
		};
		pc.ondatachannel = (ev) => this.attachChannel(edge, ev.channel);
		pc.onnegotiationneeded = () => {
			if (edge.negotiating) {
				edge.needsNegotiation = true;
				return;
			}
			this.negotiate(edge).catch((e) => this.emit("error", {
				message: `Renegotiation failed: ${e.message}`,
				remotePeerId: edge.remotePeerId
			}));
		};
		if (initiator) this.attachChannel(edge, pc.createDataChannel("room-rpc", { ordered: true }));
		this.localStreams.forEach((stream) => this.addStreamToEdge(edge, stream));
		this.relayedStreams.filter((s) => s.sourcePeerId !== remotePeerId).forEach(({ stream }) => this.addStreamToEdge(edge, stream));
		this.peers.set(remotePeerId, edge);
		return edge;
	}
	addStreamToEdge(edge, stream) {
		const newTracks = streamTracks(stream).filter((track) => !edge.sentTrackKeys.has(mediaTrackKey(track)));
		if (!newTracks.length) return false;
		if (!edge.streams.includes(stream)) edge.streams.push(stream);
		newTracks.forEach((track) => {
			edge.sentTrackKeys.add(mediaTrackKey(track));
			edge.pc.addTrack(track, stream);
		});
		return true;
	}
	attachChannel(edge, dc) {
		edge.dc = dc;
		dc.onopen = () => {
			this.emit("open", { remotePeerId: edge.remotePeerId });
			if (edge.streams.length) this.requestNegotiation(edge);
		};
		dc.onclose = () => this.emit("close", { remotePeerId: edge.remotePeerId });
		dc.onmessage = (ev) => {
			try {
				this.handleMessage(edge.remotePeerId, JSON.parse(ev.data));
			} catch (e) {
				this.emit("error", { message: e.message });
			}
		};
	}
	handleMessage(remotePeerId, msg) {
		if (msg.type === RPC.LATENCY_PING) this.send(remotePeerId, {
			type: RPC.LATENCY_PONG,
			t0: msg.t0,
			h1: Date.now()
		});
		if (msg.type === RPC.LATENCY_PONG) {
			const t2 = Date.now();
			this.clockOffsetMs = msg.h1 + (t2 - msg.t0) / 2 - t2;
			this.emit("clock", { offsetMs: this.clockOffsetMs });
		}
		if ([
			RPC.SIGNAL_RELAY_OFFER,
			RPC.SIGNAL_RELAY_ANSWER,
			RPC.SIGNAL_RELAY_ICE
		].includes(msg.type) && msg.toPeerId && msg.toPeerId !== this.localPeerId) {
			this.send(msg.toPeerId, {
				...msg,
				relayedByPeerId: this.localPeerId
			});
			this.emit("relay", {
				fromPeerId: remotePeerId,
				toPeerId: msg.toPeerId,
				msg
			});
			return;
		}
		if (msg.type === RPC.SIGNAL_RELAY_OFFER && msg.toPeerId === this.localPeerId) {
			this.acceptRenegotiationOffer(remotePeerId, msg).catch((e) => this.emit("error", {
				message: e.message,
				remotePeerId
			}));
			return;
		}
		if (msg.type === RPC.SIGNAL_RELAY_ANSWER && msg.toPeerId === this.localPeerId) {
			this.acceptRenegotiationAnswer(remotePeerId, msg).catch((e) => this.emit("error", {
				message: e.message,
				remotePeerId
			}));
			return;
		}
		this.emit("message", {
			remotePeerId,
			msg
		});
	}
	signalDescription(msg) {
		const signal = msg.signal;
		return signal?.description || signal;
	}
	async acceptRenegotiationOffer(remotePeerId, msg) {
		const edge = this.peers.get(remotePeerId) || this.makeConnection(remotePeerId, {
			manual: false,
			initiator: false
		});
		if (edge.pc.signalingState === "have-local-offer") await edge.pc.setLocalDescription({ type: "rollback" });
		await edge.pc.setRemoteDescription(this.signalDescription(msg));
		const answer = await edge.pc.createAnswer();
		await edge.pc.setLocalDescription(answer);
		await waitForIceComplete(edge.pc);
		this.send(remotePeerId, {
			type: RPC.SIGNAL_RELAY_ANSWER,
			fromPeerId: this.localPeerId,
			toPeerId: remotePeerId,
			signal: edge.pc.localDescription
		});
	}
	async acceptRenegotiationAnswer(remotePeerId, msg) {
		const edge = this.peers.get(remotePeerId);
		if (!edge) throw new Error("No peer connection for renegotiation answer.");
		await edge.pc.setRemoteDescription(this.signalDescription(msg));
		clearTimeout(edge.negotiationTimer);
		edge.negotiating = false;
		if (edge.needsNegotiation) this.requestNegotiation(edge);
	}
	requestNegotiation(edge) {
		if (!edge.dc || edge.dc.readyState !== "open" || edge.negotiating || edge.pc.signalingState !== "stable") {
			edge.needsNegotiation = true;
			return;
		}
		this.negotiate(edge).catch((e) => this.emit("error", {
			message: `Renegotiation failed: ${e.message}`,
			remotePeerId: edge.remotePeerId
		}));
	}
	async negotiate(edge) {
		if (!edge.dc || edge.dc.readyState !== "open" || edge.negotiating || edge.pc.signalingState !== "stable") {
			edge.needsNegotiation = true;
			return;
		}
		edge.negotiating = true;
		edge.needsNegotiation = false;
		try {
			const offer = await edge.pc.createOffer({ offerToReceiveAudio: true });
			await edge.pc.setLocalDescription(offer);
			await waitForIceComplete(edge.pc);
			this.send(edge.remotePeerId, {
				type: RPC.SIGNAL_RELAY_OFFER,
				fromPeerId: this.localPeerId,
				toPeerId: edge.remotePeerId,
				signal: edge.pc.localDescription
			});
			clearTimeout(edge.negotiationTimer);
			edge.negotiationTimer = setTimeout(async () => {
				if (edge.negotiating) {
					edge.negotiating = false;
					try {
						if (edge.pc.signalingState === "have-local-offer") await edge.pc.setLocalDescription({ type: "rollback" });
					} catch {}
					if (edge.needsNegotiation) this.requestNegotiation(edge);
				}
			}, 15e3);
		} catch (err) {
			edge.negotiating = false;
			throw err;
		}
	}
	send(remotePeerId, msg) {
		const edge = this.peers.get(remotePeerId);
		if (edge?.dc?.readyState === "open") edge.dc.send(JSON.stringify(msg));
	}
	broadcast(msg) {
		for (const id of this.peers.keys()) this.send(id, msg);
	}
	pingAll() {
		this.broadcast({
			type: RPC.LATENCY_PING,
			t0: Date.now()
		});
	}
	relaySignal(type, fromPeerId, toPeerId, signal) {
		if (![
			RPC.SIGNAL_RELAY_OFFER,
			RPC.SIGNAL_RELAY_ANSWER,
			RPC.SIGNAL_RELAY_ICE
		].includes(type)) throw new Error(`Unsupported relay type ${type}`);
		this.send(toPeerId, {
			type,
			fromPeerId,
			toPeerId,
			signal,
			sentAt: Date.now()
		});
	}
	async createManualOffer(remotePeerId) {
		const edge = this.makeConnection(remotePeerId, {
			manual: true,
			initiator: true,
			replace: true
		});
		const offer = await edge.pc.createOffer({ offerToReceiveAudio: true });
		await edge.pc.setLocalDescription(offer);
		await waitForIceComplete(edge.pc);
		return encodeSignalPayload({
			kind: "offer",
			fromPeerId: this.localPeerId,
			toPeerId: remotePeerId,
			description: edge.pc.localDescription
		});
	}
	async acceptManualOffer(text) {
		const payload = await decodeSignalPayload(joinChunks(text));
		if (payload.kind !== "offer") throw new Error("Expected offer payload.");
		const edge = this.makeConnection(payload.fromPeerId, {
			manual: true,
			initiator: false,
			replace: true
		});
		await edge.pc.setRemoteDescription(payload.description);
		const answer = await edge.pc.createAnswer();
		await edge.pc.setLocalDescription(answer);
		await waitForIceComplete(edge.pc);
		return encodeSignalPayload({
			kind: "answer",
			fromPeerId: this.localPeerId,
			toPeerId: payload.fromPeerId,
			description: edge.pc.localDescription
		});
	}
	async acceptManualAnswer(text) {
		const payload = await decodeSignalPayload(joinChunks(text));
		if (payload.kind !== "answer") throw new Error("Expected answer payload.");
		const edge = (payload.fromPeerId ? this.peers.get(payload.fromPeerId) : void 0) || (payload.toPeerId ? this.peers.get(payload.toPeerId) : void 0) || [...this.peers.values()].find((e) => e.initiator && e.pc.signalingState !== "stable");
		if (!edge) throw new Error("No pending offer for this answer.");
		if (payload.fromPeerId && edge.remotePeerId !== payload.fromPeerId) {
			this.peers.delete(edge.remotePeerId);
			edge.remotePeerId = payload.fromPeerId;
			this.peers.set(edge.remotePeerId, edge);
		}
		await edge.pc.setRemoteDescription(payload.description);
		if (edge.streams.length) this.requestNegotiation(edge);
		return payload;
	}
	addLocalStream(stream) {
		if (streamTrackKeys(stream).filter((key) => !this.localStreams.some((localStream) => streamTrackKeys(localStream).includes(key))).length) this.localStreams.push(stream);
		for (const edge of this.peers.values()) if (this.addStreamToEdge(edge, stream)) this.requestNegotiation(edge);
	}
	relayRemoteStream(sourcePeerId, stream) {
		const newKeys = streamTrackKeys(stream).filter((key) => !this.relayedStreams.some((stream) => stream.sourcePeerId === sourcePeerId && stream.trackKeys.includes(key)));
		if (newKeys.length) this.relayedStreams.push({
			sourcePeerId,
			stream,
			trackKeys: newKeys
		});
		if (!newKeys.length) return;
		for (const edge of this.peers.values()) {
			if (edge.remotePeerId === sourcePeerId) continue;
			if (this.addStreamToEdge(edge, stream)) this.requestNegotiation(edge);
		}
	}
	emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}
};
function waitForIceComplete(pc, timeoutMs = 4e3, idleMs = 1e3) {
	if (pc.iceGatheringState === "complete") return Promise.resolve();
	return new Promise((resolve) => {
		let idleTimer = null;
		const done = () => {
			pc.removeEventListener("icegatheringstatechange", on);
			pc.removeEventListener("icecandidate", onCandidate);
			clearTimeout(timer);
			clearTimeout(idleTimer ?? void 0);
			resolve();
		};
		const on = () => {
			if (pc.iceGatheringState === "complete") done();
		};
		const onCandidate = (event) => {
			if (!event.candidate) return;
			clearTimeout(idleTimer ?? void 0);
			idleTimer = setTimeout(done, idleMs);
		};
		const timer = setTimeout(done, timeoutMs);
		pc.addEventListener("icegatheringstatechange", on);
		pc.addEventListener("icecandidate", onCandidate);
	});
}
//#endregion
//#region src/audio.ts
var PhoneAudio = class {
	log;
	ctx;
	master;
	remoteGain;
	backingGain;
	localStream;
	publishedStream;
	pendingMicRequest;
	micSource;
	micDestination;
	micFilters;
	voicePreset;
	localMonitorGain;
	backingAudio;
	backingSource;
	pushToSing;
	gateThreshold;
	gateEnabled;
	gateProcessor;
	wakeLock = null;
	remoteSources;
	remoteStreams;
	constructor(log = () => {}) {
		this.log = log;
		this.ctx = null;
		this.master = null;
		this.remoteGain = null;
		this.backingGain = null;
		this.localStream = null;
		this.publishedStream = null;
		this.pendingMicRequest = null;
		this.micSource = null;
		this.micDestination = null;
		this.micFilters = {};
		this.voicePreset = "clean";
		this.localMonitorGain = 0;
		this.backingAudio = null;
		this.backingSource = null;
		this.pushToSing = false;
		this.gateThreshold = .03;
		this.gateEnabled = false;
		this.gateProcessor = null;
		this.remoteSources = [];
		this.remoteStreams = /* @__PURE__ */ new Set();
	}
	async init() {
		this.ctx = this.ctx || new AudioContext();
		if (!this.master || !this.remoteGain || !this.backingGain) {
			this.master = this.ctx.createGain();
			this.remoteGain = this.ctx.createGain();
			this.backingGain = this.ctx.createGain();
			this.master.gain.value = 1;
			this.remoteGain.gain.value = 1;
			this.backingGain.gain.value = 0;
			this.localMonitorGain = 0;
			this.remoteGain.connect(this.master);
			this.backingGain.connect(this.master);
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state === "suspended") await this.ctx.resume?.().catch(() => {});
	}
	async requestMic({ pushToSing = false } = {}) {
		if (!navigator.mediaDevices) throw new Error("Mic requires HTTPS. Connect via GitHub Pages or localhost.");
		if (!navigator.mediaDevices.getUserMedia) throw new Error("Browser doesn't support getUserMedia API.");
		this.pushToSing = pushToSing;
		if (this.hasLiveMic()) {
			await this.init();
			this.setMicMuted(pushToSing);
			return this.publishedStream;
		}
		if (!this.pendingMicRequest) this.pendingMicRequest = this.openMic(pushToSing).finally(() => {
			this.pendingMicRequest = null;
		});
		const stream = await this.pendingMicRequest;
		this.pushToSing = pushToSing;
		this.setMicMuted(pushToSing);
		return stream;
	}
	async openMic(pushToSing) {
		await this.init();
		this.localStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true
			},
			video: false
		});
		this.applyGate();
		this.buildMicFilterStream(this.localStream);
		this.publishedStream = this.localStream;
		this.setMicMuted(pushToSing);
		return this.publishedStream;
	}
	hasLiveMic() {
		return this.streamHasLiveAudio(this.localStream) && this.streamHasLiveAudio(this.publishedStream);
	}
	streamHasLiveAudio(stream) {
		if (!stream) return false;
		return (typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : typeof stream.getTracks === "function" ? stream.getTracks().filter((track) => track.kind === "audio") : []).some((track) => track.readyState !== "ended");
	}
	setMicMuted(muted) {
		if (this.micFilters.muteGate && this.publishedStream !== this.localStream) {
			this.micFilters.muteGate.gain.value = muted ? 0 : 1;
			this.localStream?.getAudioTracks().forEach((t) => {
				t.enabled = true;
			});
			this.publishedStream?.getAudioTracks().forEach((t) => {
				t.enabled = true;
			});
			return;
		}
		this.localStream?.getAudioTracks().forEach((t) => {
			t.enabled = !muted;
		});
	}
	buildMicFilterStream(stream) {
		if (!this.ctx?.createMediaStreamDestination || !this.ctx.createBiquadFilter || !this.ctx.createDynamicsCompressor) return stream;
		try {
			this.micSource?.disconnect();
			this.micSource = this.ctx.createMediaStreamSource(stream);
			this.micDestination = this.ctx.createMediaStreamDestination();
			const highpass = this.ctx.createBiquadFilter();
			const tone = this.ctx.createBiquadFilter();
			const presence = this.ctx.createBiquadFilter();
			const compressor = this.ctx.createDynamicsCompressor();
			const output = this.ctx.createGain();
			const muteGate = this.ctx.createGain();
			const silentMonitor = this.ctx.createGain();
			muteGate.gain.value = 1;
			silentMonitor.gain.value = 0;
			highpass.type = "highpass";
			tone.type = "lowshelf";
			presence.type = "peaking";
			this.micSource.connect(highpass);
			highpass.connect(tone);
			tone.connect(presence);
			presence.connect(compressor);
			if (this.gateEnabled && this.ctx.createScriptProcessor) {
				const gateNode = this.ctx.createScriptProcessor(4096, 1, 1);
				gateNode.onaudioprocess = (e) => {
					const input = e.inputBuffer.getChannelData(0);
					const outputBuf = e.outputBuffer.getChannelData(0);
					let rms = 0;
					for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
					rms = Math.sqrt(rms / input.length);
					if (rms < this.gateThreshold) for (let i = 0; i < outputBuf.length; i++) outputBuf[i] = 0;
					else for (let i = 0; i < outputBuf.length; i++) outputBuf[i] = input[i];
				};
				compressor.connect(gateNode);
				gateNode.connect(output);
				this.gateProcessor = gateNode;
				this.log(`Noise gate enabled in mic filter chain (threshold: ${this.gateThreshold}).`);
			} else {
				compressor.connect(output);
				this.gateProcessor = null;
			}
			output.connect(muteGate);
			muteGate.connect(this.micDestination);
			muteGate.connect(silentMonitor);
			silentMonitor.connect(this.ctx.destination);
			this.micFilters = {
				highpass,
				tone,
				presence,
				compressor,
				output,
				muteGate,
				silentMonitor
			};
			this.applyVoicePreset();
			return this.micDestination.stream;
		} catch (err) {
			this.log(`Mic filters unavailable: ${err.message}. Using clean mic.`);
			return stream;
		}
	}
	setVoicePreset(preset) {
		this.voicePreset = [
			"clean",
			"alto",
			"bravo",
			"bass",
			"radio",
			"autotune"
		].includes(preset) ? preset : "clean";
		this.applyVoicePreset();
	}
	applyVoicePreset() {
		const { highpass, tone, presence, compressor, output } = this.micFilters;
		if (!highpass || !tone || !presence || !compressor || !output) return;
		const presets = {
			clean: {
				hp: 70,
				lowGain: 0,
				presenceFreq: 3200,
				presenceGain: 0,
				ratio: 2,
				threshold: -24,
				out: 1
			},
			alto: {
				hp: 95,
				lowGain: 2,
				presenceFreq: 2400,
				presenceGain: 1.5,
				ratio: 3,
				threshold: -26,
				out: 1.05
			},
			bravo: {
				hp: 120,
				lowGain: -1,
				presenceFreq: 4200,
				presenceGain: 4,
				ratio: 3.5,
				threshold: -28,
				out: 1.08
			},
			bass: {
				hp: 55,
				lowGain: 4,
				presenceFreq: 1800,
				presenceGain: -1,
				ratio: 3,
				threshold: -25,
				out: 1
			},
			radio: {
				hp: 180,
				lowGain: -6,
				presenceFreq: 2800,
				presenceGain: 5,
				ratio: 6,
				threshold: -32,
				out: 1.1
			},
			autotune: {
				hp: 100,
				lowGain: -1,
				presenceFreq: 3600,
				presenceGain: 3,
				ratio: 8,
				threshold: -34,
				out: 1.12
			}
		};
		const p = presets[this.voicePreset] || presets.clean;
		highpass.frequency.value = p.hp;
		tone.gain.value = p.lowGain;
		presence.frequency.value = p.presenceFreq;
		presence.Q.value = 1;
		presence.gain.value = p.presenceGain;
		compressor.threshold.value = p.threshold;
		compressor.knee.value = 12;
		compressor.ratio.value = p.ratio;
		compressor.attack.value = .003;
		compressor.release.value = .18;
		output.gain.value = p.out;
	}
	addRemoteStream(stream, label = "remote singer") {
		if (this.remoteStreams.has(stream)) return;
		this.remoteStreams.add(stream);
		this.init().then(() => {
			if (!this.ctx || !this.remoteGain) return;
			const src = this.ctx.createMediaStreamSource(stream);
			this.remoteSources.push(src);
			src.connect(this.remoteGain);
			this.log(`Receiving ${label}`);
		});
	}
	async startBackingMonitor(url) {
		await this.init();
		if (!this.backingAudio || !this.backingSource || !this.ctx || !this.backingGain) {
			this.backingAudio = new Audio(url);
			this.backingAudio.loop = false;
			this.backingAudio.crossOrigin = "anonymous";
			this.backingSource = this.ctx.createMediaElementSource(this.backingAudio);
			this.backingSource.connect(this.backingGain);
		} else if (this.backingAudio.src !== url) this.backingAudio.src = url;
		this.backingGain.gain.value = this.backingGain.gain.value || .35;
		await this.backingAudio.play();
		return this.backingAudio;
	}
	pauseBackingMonitor() {
		this.backingAudio?.pause();
	}
	setGain(kind, value) {
		if (kind === "remote" && this.remoteGain) this.remoteGain.gain.value = value;
		if (kind === "backing" && this.backingGain) this.backingGain.gain.value = value;
		if (kind === "master" && this.master) this.master.gain.value = value;
	}
	wakeLockVideo = null;
	async tryWakeLock() {
		try {
			if ("wakeLock" in navigator) {
				this.wakeLock = await navigator.wakeLock.request("screen");
				return "active";
			}
			if (!this.wakeLockVideo) {
				this.wakeLockVideo = document.createElement("video");
				this.wakeLockVideo.loop = true;
				this.wakeLockVideo.muted = true;
				this.wakeLockVideo.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
				document.body.appendChild(this.wakeLockVideo);
			}
			this.wakeLockVideo.src = new URL("" + new URL("../silent_loop.mp4", import.meta.url).href, "" + import.meta.url).toString();
			await this.wakeLockVideo.play().catch(() => {});
			return "video-fallback";
		} catch {
			return "failed";
		}
	}
	stopWakeLock() {
		if (this.wakeLock) {
			this.wakeLock.release();
			this.wakeLock = null;
		}
		if (this.wakeLockVideo) {
			this.wakeLockVideo.pause();
			this.wakeLockVideo.remove();
			this.wakeLockVideo = null;
		}
	}
	applyGate() {}
	setGateEnabled(enabled, threshold) {
		this.gateEnabled = enabled;
		if (threshold !== void 0) this.gateThreshold = threshold;
		if (this.localStream && this.publishedStream) this.publishedStream = this.buildMicFilterStream(this.localStream);
	}
	duetMonitorGains = /* @__PURE__ */ new Map();
	enableDuetMonitoring(peerId, enabled) {
		if (!this.ctx) return;
		if (enabled && !this.duetMonitorGains.has(peerId)) {
			const gain = this.ctx.createGain();
			gain.gain.value = .5;
			gain.connect(this.master);
			this.duetMonitorGains.set(peerId, gain);
			this.log(`Duet monitoring enabled for ${peerId}`);
		} else if (!enabled && this.duetMonitorGains.has(peerId)) {
			this.duetMonitorGains.get(peerId)?.disconnect();
			this.duetMonitorGains.delete(peerId);
			this.log(`Duet monitoring disabled for ${peerId}`);
		}
	}
	connectDuetStream(stream, peerId) {
		if (!this.ctx || !this.duetMonitorGains.has(peerId)) return;
		this.ctx.createMediaStreamSource(stream).connect(this.duetMonitorGains.get(peerId));
	}
};
var singerWarning = "TV backing track bleed risk: your phone mic can hear the TV backing track. Use headphones or push-to-sing to avoid sending backing track to everyone.";
//#endregion
//#region src/mediaKey.ts
var MEDIA_KEY_B64 = "NvV8BCkbvZNWft8N71lX+8pYS3/cqwjNcCz3N1zF5IE=";
//#endregion
//#region src/protectedMedia.ts
var blobUrlCache = /* @__PURE__ */ new Map();
var keyPromise;
function hasWebCryptoAes() {
	return !!globalThis.crypto?.subtle?.importKey && !!globalThis.crypto?.subtle?.decrypt;
}
function b64ToBytes(value) {
	const bin = atob(value);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}
function resolveAppAssetUrl(url) {
	if (!url) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
	const publicPath = url.startsWith("/public/") ? url.slice(7) : url;
	if (publicPath.startsWith("/")) return new URL(".." + publicPath, import.meta.url).toString();
	return new URL(publicPath, import.meta.url).toString();
}
function resolveEncryptedMedia(media) {
	return media ? {
		...media,
		url: resolveAppAssetUrl(media.url)
	} : void 0;
}
function normalizeProtectedSong(song) {
	const resolved = {
		...song,
		encryptedMedia: resolveEncryptedMedia(song.encryptedMedia),
		encryptedAudio: resolveEncryptedMedia(song.encryptedAudio),
		castMediaUrl: resolveAppAssetUrl(song.castMediaUrl),
		phoneBackingAudioUrl: resolveAppAssetUrl(song.phoneBackingAudioUrl),
		lyricsJsonUrl: resolveAppAssetUrl(song.lyricsJsonUrl),
		lyricsVttUrl: resolveAppAssetUrl(song.lyricsVttUrl),
		thumbnailUrl: resolveAppAssetUrl(song.thumbnailUrl),
		defaultCastMediaUrl: resolveAppAssetUrl(song.defaultCastMediaUrl)
	};
	if (!resolved.encryptedMedia) return resolved;
	return {
		...resolved,
		castMediaUrl: null,
		phoneBackingAudioUrl: null,
		lyricsJsonUrl: null,
		lyricsVttUrl: null,
		thumbnailUrl: null,
		needsClientDecrypt: true
	};
}
async function importMediaKey() {
	if (!hasWebCryptoAes()) throw new Error("Protected media decrypt needs Web Crypto. Use HTTPS/GitHub Pages, localhost, or the clear Cast export fallback for local phone testing.");
	keyPromise ||= globalThis.crypto.subtle.importKey("raw", b64ToBytes(MEDIA_KEY_B64), { name: "AES-GCM" }, false, ["decrypt"]);
	return keyPromise;
}
async function loadProtectedCatalog(catalogUrl = resolveAppAssetUrl("/protected/catalog.json")) {
	try {
		const response = await fetch(catalogUrl);
		if (!response.ok) return [];
		return ((await response.json()).songs || []).map(normalizeProtectedSong);
	} catch {
		return [];
	}
}
async function decryptProtectedMedia(song) {
	if (!song?.encryptedMedia) return null;
	const media = song.encryptedMedia;
	if (blobUrlCache.has(song.songId)) return blobUrlCache.get(song.songId);
	const response = await fetch(resolveAppAssetUrl(media.url));
	if (!response.ok) throw new Error(`Protected media fetch failed: ${response.status}`);
	const encrypted = new Uint8Array(await response.arrayBuffer());
	const key = await importMediaKey();
	const plain = await globalThis.crypto.subtle.decrypt({
		name: "AES-GCM",
		iv: b64ToBytes(media.iv),
		tagLength: (media.tagBytesAppended || 16) * 8
	}, key, encrypted);
	const blobUrl = URL.createObjectURL(new Blob([plain], { type: media.mimeType || "video/mp4" }));
	blobUrlCache.set(song.songId, blobUrl);
	return blobUrl;
}
async function resolvePlayableMediaUrl(song) {
	if (song?.encryptedMedia) {
		if (!hasWebCryptoAes() && song.defaultCastMediaUrl) return song.defaultCastMediaUrl;
		return decryptProtectedMedia(song);
	}
	return song?.castMediaUrl || song?.phoneBackingAudioUrl || null;
}
function resolveDefaultCastMediaUrl(song) {
	return song?.defaultCastMediaUrl || (!song?.encryptedMedia ? song?.castMediaUrl : null) || null;
}
function resolveDefaultCastMediaType(song) {
	return song?.defaultCastMediaMimeType || song?.encryptedMedia?.mimeType || "video/mp4";
}
function isProtectedMedia(song) {
	return !!song?.encryptedMedia;
}
//#endregion
//#region src/sync.ts
function deriveTvMediaPositionMs(playbackState, nowMs = Date.now(), hostOffsetMs = 0) {
	if (!playbackState || playbackState.syncDegraded || playbackState.tvMediaTimeSampledAtHostMs == null) return {
		positionMs: playbackState?.tvMediaTimeMs || 0,
		syncDegraded: true
	};
	const hostNowMs = nowMs + hostOffsetMs;
	const elapsedMs = Math.max(0, hostNowMs - playbackState.tvMediaTimeSampledAtHostMs);
	const status = playbackState.paused ? "paused" : playbackState.status || "playing";
	const shouldAdvance = !playbackState.paused && ![
		"paused",
		"idle",
		"ended",
		"host_lost",
		"error"
	].includes(status);
	const rate = playbackState.playbackRate ?? 1;
	const baseMs = playbackState.tvMediaTimeMs || 0;
	const offsetMs = playbackState.seekOffsetMs || 0;
	return {
		positionMs: Math.max(0, baseMs + offsetMs + (shouldAdvance ? elapsedMs * rate : 0)),
		syncDegraded: false
	};
}
//#endregion
//#region src/cast.ts
function escapeHtml$1(value) {
	return String(value ?? "").replace(/[&<>"']/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[c]);
}
function castGlobal() {
	return globalThis;
}
var CAST_NAMESPACE = "urn:x-cast:com.carryokie.room";
var DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";
var CAST_TYPES = [
	"CAST_LOAD_SONG",
	"CAST_PLAY",
	"CAST_PAUSE",
	"CAST_SEEK",
	"CAST_STOP",
	"CAST_SET_SINGERS",
	"CAST_UPDATE_QUEUE_PREVIEW",
	"CAST_SHOW_JOIN_QR",
	"CAST_SYNC_PLAYBACK_STATE",
	"CAST_SHOW_ERROR"
];
function castOriginOverride() {
	try {
		return new URLSearchParams(location.search).get("castOrigin") || localStorage.getItem("carryokie.castOrigin");
	} catch {
		return null;
	}
}
function rewriteCastUrlForReceiver(url) {
	const origin = castOriginOverride();
	if (!origin) return url;
	try {
		const u = new URL(url, location.href);
		return new URL(u.pathname + u.search + u.hash, origin).toString();
	} catch {
		return url;
	}
}
function shouldLoadCastReceiverFramework() {
	try {
		const params = new URLSearchParams(location.search);
		if (params.get("castReceiver") === "1") return true;
		if (params.has("room")) return false;
		return /\bCrKey\b|Chromecast/i.test(navigator.userAgent);
	} catch {
		return false;
	}
}
function loadCastReceiverFramework() {
	if (castGlobal().cast?.framework?.CastReceiverContext) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const existing = document.querySelector("script[src*=caf_receiver]");
		if (existing) {
			existing.addEventListener("load", () => resolve(), { once: true });
			existing.addEventListener("error", () => reject(/* @__PURE__ */ new Error("Cast Receiver SDK failed to load.")), { once: true });
			return;
		}
		const script = document.createElement("script");
		script.src = "https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js";
		script.onload = () => resolve();
		script.onerror = () => reject(/* @__PURE__ */ new Error("Cast Receiver SDK failed to load."));
		document.head.appendChild(script);
	});
}
var CastController = class extends EventTarget {
	appId;
	available = false;
	connected = false;
	remotePlayer = null;
	controller = null;
	session = null;
	currentMediaLoaded = false;
	constructor(appId = DEFAULT_MEDIA_RECEIVER_APP_ID) {
		super();
		this.appId = appId;
	}
	get usesDefaultMediaReceiver() {
		return this.appId === DEFAULT_MEDIA_RECEIVER_APP_ID;
	}
	async init() {
		if (castGlobal().cast?.framework) {
			if (!this.available) this.configure();
			return;
		}
		return new Promise((resolve, reject) => {
			const w = window;
			w.__onGCastApiAvailable = (ok) => {
				if (ok) {
					this.configure();
					resolve();
				} else {
					const error = /* @__PURE__ */ new Error("Cast Sender unavailable in this browser.");
					this.emit("error", { message: error.message });
					reject(error);
				}
			};
			if (!document.querySelector("script[src*=cast_sender]")) {
				const s = document.createElement("script");
				s.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
				document.head.appendChild(s);
			}
		});
	}
	configure() {
		cast.framework.CastContext.getInstance().setOptions({
			receiverApplicationId: this.appId,
			autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
		});
		this.remotePlayer = new cast.framework.RemotePlayer();
		this.controller = new cast.framework.RemotePlayerController(this.remotePlayer);
		this.controller.addEventListener(cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => this.sampleMediaStatus());
		this.controller.addEventListener(cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => this.sampleMediaStatus());
		this.available = true;
		this.emit("state", this.state());
	}
	async requestSession() {
		if (!castGlobal().cast?.framework) throw new Error("Cast SDK not ready. Use Chrome on macOS/Android, click Init Cast, then wait a moment. Safari/Firefox will not work.");
		const context = cast.framework.CastContext.getInstance();
		this.session = context.getCurrentSession?.() || await context.requestSession();
		this.connected = !!this.session;
		this.emit("state", this.state());
		return this.session;
	}
	async ensureSession() {
		if (this.session) return this.session;
		if (castGlobal().cast?.framework) {
			const current = cast.framework.CastContext.getInstance().getCurrentSession?.();
			if (current) {
				this.session = current;
				this.connected = true;
				this.emit("state", this.state());
				return current;
			}
		}
		return this.requestSession();
	}
	send(type, payload = {}) {
		if (!CAST_TYPES.includes(type)) throw new Error(`Unknown Cast message ${type}`);
		if (this.usesDefaultMediaReceiver) return Promise.resolve(false);
		if (!this.session) return Promise.resolve(false);
		return Promise.resolve(this.session.sendMessage(CAST_NAMESPACE, {
			type,
			payload,
			sentAt: Date.now()
		})).then(() => true);
	}
	sendSafe(type, payload = {}) {
		return Promise.resolve(this.send(type, payload)).catch((error) => {
			this.emit("error", { message: `Cast message ${type} failed: ${error?.message || error}` });
			return false;
		});
	}
	async loadSong(song, room) {
		await this.ensureSession();
		const rawMediaUrl = this.usesDefaultMediaReceiver ? resolveDefaultCastMediaUrl(song) : await resolvePlayableMediaUrl(song);
		if (!rawMediaUrl) throw new Error(this.usesDefaultMediaReceiver ? "Default Chromecast needs a clear cast export. Run npm run exportCastMedia." : "No playable media URL for song.");
		const mediaUrl = this.usesDefaultMediaReceiver ? rewriteCastUrlForReceiver(rawMediaUrl) : rawMediaUrl;
		const mediaInfo = new chrome.cast.media.MediaInfo(mediaUrl, resolveDefaultCastMediaType(song));
		mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
		mediaInfo.metadata.title = `${song.title} — ${song.artist}`;
		mediaInfo.customData = {
			roomCode: room.roomCode,
			note: "TV plays backing/lyrics only; no live mic."
		};
		const request = new chrome.cast.media.LoadRequest(mediaInfo);
		request.autoplay = true;
		await this.session.loadMedia(request);
		this.currentMediaLoaded = true;
		this.emit("state", this.state());
		this.sendSafe("CAST_LOAD_SONG", {
			song,
			roomCode: room.roomCode
		});
		await this.play();
		this.sampleMediaStatus();
	}
	async play() {
		await this.ensureSession();
		if (!this.remotePlayer || this.remotePlayer.isPaused) this.controller?.playOrPause();
		this.sendSafe("CAST_PLAY");
	}
	pause() {
		if (!this.remotePlayer || !this.remotePlayer.isPaused) this.controller?.playOrPause();
		this.sendSafe("CAST_PAUSE");
	}
	seek(seconds) {
		if (this.remotePlayer) {
			this.remotePlayer.currentTime = seconds;
			this.controller?.seek();
		}
		this.send("CAST_SEEK", { seconds });
	}
	sampleMediaStatus() {
		if (!this.remotePlayer) return;
		const paused = !!this.remotePlayer.isPaused;
		const sample = {
			tvMediaTimeMs: Math.round((this.remotePlayer.currentTime || 0) * 1e3),
			tvMediaTimeSampledAtHostMs: Date.now(),
			paused,
			status: paused ? "paused" : "playing",
			playbackRate: 1,
			source: "RemotePlayerController.currentTime"
		};
		this.emit("playbackSample", sample);
		this.sendSafe("CAST_SYNC_PLAYBACK_STATE", sample);
	}
	state() {
		return {
			available: this.available,
			connected: this.connected,
			receiverReady: this.connected,
			currentMediaLoaded: this.currentMediaLoaded,
			defaultMediaReceiver: this.usesDefaultMediaReceiver,
			error: null
		};
	}
	emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}
};
function receiverApp(root) {
	const initialRoomCode = new URLSearchParams(location.search).get("room") || "------";
	const state = {
		roomCode: initialRoomCode,
		song: null,
		singers: [],
		queue: [],
		mediaTimeMs: 0,
		lines: [],
		status: "Waiting for host tab…",
		liveMicStatus: "",
		playbackState: null,
		audioOutputUnlocked: false,
		audioDiagnostics: null
	};
	root.innerHTML = `<main class="tv"><section class="tv-info"><p class="eyebrow">CarryOkie receiver</p><h1>CarryOkie</h1><div class="stage-art receiver-stage" aria-hidden="true"><div class="stage-orb"></div><div class="stage-mic"></div><div class="soundwave"><span></span><span></span><span></span><span></span><span></span></div></div><div class="room" id="room">${escapeHtml$1(initialRoomCode)}</div><div id="joinQr"></div><p>Scan/open /player. Tab-cast receiver mirrors host room, queue, singers, backing track, and live singer mics.</p><section id="singers"></section><section id="receiverStatus"></section><section id="audioDiagnostics"></section><section id="liveMics"><h2>Live mics</h2><p>Waiting for host tab audio…</p><button id="startReceiverAudio">Start receiver audio</button><button id="retryLiveMics">Start / retry live mics</button></section></section><section class="tv-stage"><video id="media" class="castMediaElement" controls playsinline></video><section id="lyrics" class="lyrics big"></section><section id="queue"></section></section></main>`;
	const media = root.querySelector("#media");
	const liveMics = root.querySelector("#liveMics");
	const retryLiveMicsButton = root.querySelector("#retryLiveMics");
	const startReceiverAudioButton = root.querySelector("#startReceiverAudio");
	const receiverId = crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
	let loadedSongId = "";
	let pendingPlay = false;
	function activeLine() {
		const t = state.mediaTimeMs;
		return state.lines.findLast?.((l) => t >= l.startMs) || state.lines.filter((l) => t >= l.startMs).pop() || state.lines[0];
	}
	function singerMicSummary() {
		const singers = Array.isArray(state.singers) ? state.singers : [];
		return {
			singers,
			publishing: singers.filter((s) => s.micState?.publishing),
			audible: singers.filter((s) => s.micState?.publishing && !s.micState?.muted),
			muted: singers.filter((s) => s.micState?.publishing && s.micState?.muted)
		};
	}
	function liveMicStatus() {
		const { audible, muted, publishing } = singerMicSummary();
		if (liveMicTrackIds.size && audible.length) return `Playing ${audible.length} unmuted live mic${audible.length === 1 ? "" : "s"}.`;
		if (liveMicTrackIds.size && muted.length) return "Mic track connected, but singer is muted.";
		if (liveMicTrackIds.size && !publishing.length) return "Mic track connected, but room mic state is stale.";
		return "No live mic tracks connected.";
	}
	function renderAudioDiagnostics() {
		const diagEl = root.querySelector("#audioDiagnostics");
		if (!diagEl) return;
		const d = state.audioDiagnostics;
		const { audible, muted, publishing } = singerMicSummary();
		const liveOutput = `<p>${escapeHtml$1(liveMicPlaybackDiagnostics())}</p>`;
		if (d) diagEl.innerHTML = `<h2>Audio pipeline</h2><p>Host remote tracks: ${d.hostRemoteAudioTracks ?? "?"} · Relayed streams: ${d.hostRelayedStreams ?? "?"} · Receiver ready: ${d.receiverReady ? "yes" : "no"}</p><p>Receiver PC: ${d.receiverPcConnectionState ?? "?"} · ICE: ${d.receiverPcIceState ?? "?"} · Tracks added: ${d.receiverTracksAdded ?? 0}</p>${d.receiverOfferSentAt ? `<p>Offer sent: ${new Date(d.receiverOfferSentAt).toLocaleTimeString()}</p>` : ""}${d.receiverAnswerReceivedAt ? `<p>Answer received: ${new Date(d.receiverAnswerReceivedAt).toLocaleTimeString()}</p>` : ""}${d.receiverLastError ? `<p class="warn">Error: ${escapeHtml$1(String(d.receiverLastError))}</p>` : ""}<p>Autoplay unlocked: ${state.audioOutputUnlocked ? "yes" : "no"} · Live mic tracks: ${liveMicTrackIds.size}</p><p>Publishing singers: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p>${liveOutput}`;
		else diagEl.innerHTML = `<h2>Audio pipeline</h2><p>No diagnostics received yet. Waiting for host tab…</p><p>Autoplay unlocked: ${state.audioOutputUnlocked ? "yes" : "no"} · Live mic tracks: ${liveMicTrackIds.size}</p><p>Publishing singers: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p>${liveOutput}`;
	}
	function render() {
		root.querySelector("#room").textContent = state.roomCode;
		const playerUrl = new URL(`../player/?room=${encodeURIComponent(state.roomCode)}`, location.href).toString();
		root.querySelector("#joinQr").innerHTML = state.roomCode === "------" ? "" : qrSvg(playerUrl, {
			scale: 3,
			title: "Join CarryOkie room"
		});
		const queueSingerLabel = (queueItem) => (queueItem.singerNames?.length ? queueItem.singerNames : (queueItem.singerNumbers || []).map((singerNumber) => `#${singerNumber}`)).join(", ");
		root.querySelector("#queue").innerHTML = "<h2>Queue</h2><ol>" + state.queue.map((q) => `<li>${escapeHtml$1(q.title || q.songId)} singers ${escapeHtml$1(queueSingerLabel(q))}</li>`).join("") + "</ol>";
		root.querySelector("#singers").innerHTML = "<h2>Singers</h2>" + ((state.singers || []).map((p) => `<p>#${escapeHtml$1(p.playerNumber)} ${escapeHtml$1(p.displayName)}</p>`).join("") || "<p>No active singers</p>");
		const resolvedLiveMicStatus = state.liveMicStatus || (liveMicTrackIds.size ? liveMicStatus() : "");
		root.querySelector("#receiverStatus").innerHTML = `<p class="status-pill">${escapeHtml$1(state.status)}</p>` + (resolvedLiveMicStatus ? `<p class="status-pill live-status">${escapeHtml$1(resolvedLiveMicStatus)}</p>` : "");
		renderAudioDiagnostics();
		const active = activeLine();
		root.querySelector("#lyrics").innerHTML = state.lines.length ? state.lines.map((l) => `<p class="${l === active ? "active" : ""}">${escapeHtml$1(l.text)}</p>`).join("") : "<p>Waiting for lyrics…</p>";
	}
	async function loadLyrics(song) {
		if (isProtectedMedia(song)) {
			state.lines = [];
			render();
			return;
		}
		if (!song?.lyricsJsonUrl) return;
		try {
			state.lines = (await fetch(song.lyricsJsonUrl).then((r) => r.json())).lines || [];
		} catch {
			state.lines = [];
			state.status = "Lyrics unavailable; backing track still loaded.";
		}
		render();
	}
	function loadSong(song, roomCode) {
		if (!song) return;
		state.song = song;
		state.roomCode = roomCode || state.roomCode;
		if (song.songId === loadedSongId) {
			render();
			return;
		}
		loadedSongId = song.songId;
		if (!liveMicTrackIds.size) state.status = "Loading backing track…";
		resolvePlayableMediaUrl(song).then((url) => {
			if (!url) {
				if (!liveMicTrackIds.size) state.status = "No playable media for receiver tab.";
				render();
				return;
			}
			media.src = url;
			const attemptPlay = () => {
				if (pendingPlay) {
					pendingPlay = false;
					media.play().catch(() => {
						if (!liveMicTrackIds.size) state.status = "Tap receiver once to start backing track/audio.";
						render();
					});
				}
			};
			media.play().then(() => {
				if (!liveMicTrackIds.size) state.status = "Backing track playing.";
				attemptPlay();
				render();
			}).catch(() => {
				attemptPlay();
				if (!liveMicTrackIds.size) state.status = "Tap receiver once to start backing track/audio.";
				render();
			});
		}).catch((error) => {
			if (!liveMicTrackIds.size) state.status = error?.message || "Failed to load backing track.";
			render();
		});
		loadLyrics(song);
	}
	function unpack(data) {
		try {
			return typeof data === "string" ? JSON.parse(data) : data;
		} catch {
			return null;
		}
	}
	function handle(raw) {
		const msg = unpack(raw);
		if (!msg?.type) return;
		const payload = msg.payload;
		if (msg.type === "CAST_LOAD_SONG" && payload) loadSong(payload.song, payload.roomCode);
		if (msg.type === "CAST_PLAY") {
			if (!media.src && state.song) loadSong(state.song, state.roomCode);
			if (media.src) media.play().catch(() => {});
			else pendingPlay = true;
		}
		if (msg.type === "CAST_PAUSE" && media.src) media.pause();
		if (msg.type === "CAST_SEEK" && payload) media.currentTime = payload.seconds;
		if (msg.type === "CAST_SET_SINGERS" && payload) {
			state.singers = payload.players || payload.singers;
			if (liveMicTrackIds.size) tryPlayLiveMics();
		}
		if ((msg.type === "CAST_SYNC_PLAYBACK_STATE" || msg.type === "RECEIVER_PLAYBACK_SYNC") && payload) {
			state.playbackState = payload;
			state.mediaTimeMs = deriveTvMediaPositionMs(payload).positionMs;
		}
		if (msg.type === "CAST_SHOW_JOIN_QR" && payload) state.roomCode = payload.roomCode;
		if (msg.type === "CAST_UPDATE_QUEUE_PREVIEW" && payload) state.queue = payload.queue || [];
		if (msg.type === "RECEIVER_STATE" && payload) {
			state.roomCode = payload.roomCode || state.roomCode;
			state.queue = payload.queue || state.queue;
			state.singers = payload.singers || state.singers;
			if (payload.playbackState) {
				state.playbackState = payload.playbackState;
				state.mediaTimeMs = deriveTvMediaPositionMs(payload.playbackState).positionMs;
			}
			loadSong(payload.song, payload.roomCode);
			if (liveMicTrackIds.size) tryPlayLiveMics();
		}
		render();
	}
	const liveMicStream = new MediaStream();
	const liveMicTrackIds = /* @__PURE__ */ new Set();
	let liveMicAudio = null;
	let liveMicAudioContext = null;
	let liveMicSource = null;
	let liveMicGain = null;
	let liveMicOutputStatus = "not started";
	let liveMicLastPlayError = "";
	function liveMicPlaybackDiagnostics() {
		const elementState = liveMicAudio ? `${liveMicAudio.paused ? "paused" : "playing"} · ready ${liveMicAudio.readyState}` : "not created";
		const graphState = liveMicAudioContext ? liveMicAudioContext.state : "not created";
		const trackState = liveMicStream.getAudioTracks().map((track) => `${track.readyState}${track.enabled === false ? " disabled" : ""}${track.muted ? " muted" : ""}`).join(", ") || "none";
		return `Live mic output: element ${elementState} · graph ${graphState} (${liveMicOutputStatus}) · tracks ${trackState}${liveMicLastPlayError ? ` · last error ${liveMicLastPlayError}` : ""}`;
	}
	function liveMicSummaryHtml() {
		const status = state.liveMicStatus || (liveMicTrackIds.size ? liveMicStatus() : "");
		return status ? `<p class="subtle">${escapeHtml$1(status)}</p>` : "<p class=\"subtle\">Playing all forwarded singer mics.</p>";
	}
	function ensureLiveMicAudio() {
		if (liveMicAudio) {
			const subtitle = liveMics.querySelector("p.subtle");
			if (subtitle) subtitle.outerHTML = liveMicSummaryHtml();
			return liveMicAudio;
		}
		liveMics.innerHTML = `<h2>Live mics</h2>${liveMicSummaryHtml()}<button id="startReceiverAudio">Start receiver audio</button><button id="retryLiveMics">Start / retry live mics</button>`;
		liveMics.querySelector("#startReceiverAudio")?.addEventListener("click", () => {
			state.audioOutputUnlocked = true;
			tryPlayLiveMics();
		});
		liveMics.querySelector("#retryLiveMics")?.addEventListener("click", () => {
			tryPlayLiveMics();
		});
		liveMicAudio = document.createElement("audio");
		liveMicAudio.autoplay = true;
		liveMicAudio.controls = true;
		liveMicAudio.playsInline = true;
		liveMicAudio.muted = false;
		liveMicAudio.volume = 1;
		liveMicAudio.srcObject = liveMicStream;
		liveMics.appendChild(liveMicAudio);
		return liveMicAudio;
	}
	async function ensureLiveMicOutputGraph() {
		const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextCtor) {
			liveMicOutputStatus = "WebAudio unavailable; using media element";
			return;
		}
		if (!liveMicAudioContext) liveMicAudioContext = new AudioContextCtor();
		if (liveMicAudioContext.state === "suspended") await liveMicAudioContext.resume().catch((error) => {
			liveMicLastPlayError = error.message;
		});
		if (!liveMicStream.getAudioTracks().length) {
			liveMicOutputStatus = "waiting for live mic track";
			return;
		}
		if (!liveMicSource) {
			liveMicSource = liveMicAudioContext.createMediaStreamSource(liveMicStream);
			liveMicGain = liveMicAudioContext.createGain();
			liveMicGain.gain.value = 1;
			liveMicSource.connect(liveMicGain);
			liveMicGain.connect(liveMicAudioContext.destination);
		}
		liveMicOutputStatus = liveMicAudioContext.state === "running" ? "connected to receiver speakers" : "audio context not running";
	}
	async function tryPlayLiveMics() {
		if (!state.audioOutputUnlocked) {
			state.liveMicStatus = "Press 'Start receiver audio' to enable live mic audio.";
			render();
			return;
		}
		state.liveMicStatus = liveMicStatus();
		render();
		const audio = ensureLiveMicAudio();
		await ensureLiveMicOutputGraph();
		try {
			await audio.play();
			liveMicLastPlayError = "";
			state.liveMicStatus = liveMicStatus();
			render();
		} catch (error) {
			liveMicLastPlayError = error.message;
			state.liveMicStatus = "Tap receiver once or press Start / retry live mics.";
			render();
		}
	}
	function addLiveMic(stream) {
		const audioTracks = stream.getAudioTracks?.() || stream.getTracks().filter((track) => track.kind === "audio");
		for (const track of audioTracks) {
			if (liveMicTrackIds.has(track.id)) continue;
			liveMicTrackIds.add(track.id);
			liveMicStream.addTrack(track);
		}
		if (!audioTracks.length) return;
		if (state.audioOutputUnlocked) ensureLiveMicOutputGraph();
		tryPlayLiveMics();
	}
	function removeStaleLiveMicTracks() {
		const currentIds = /* @__PURE__ */ new Set();
		for (const track of liveMicStream.getTracks()) if (track.readyState === "ended") {
			liveMicStream.removeTrack(track);
			liveMicTrackIds.delete(track.id);
		} else currentIds.add(track.id);
	}
	function plainRtcDescription(description) {
		return description ? {
			type: description.type,
			sdp: description.sdp
		} : null;
	}
	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel("carryokie.receiver");
		let pc = null;
		channel.onmessage = async (ev) => {
			const msg = ev.data || {};
			if (msg.type === "RECEIVER_STATE") handle(msg);
			if (msg.type === "RECEIVER_AUDIO_STATUS" && msg.payload) {
				state.audioDiagnostics = msg.payload;
				renderAudioDiagnostics();
				if (liveMicTrackIds.size) tryPlayLiveMics();
			}
			if (msg.type === "RECEIVER_OFFER" && (!msg.receiverId || msg.receiverId === receiverId)) try {
				if (!pc || pc.signalingState === "closed") {
					pc?.close?.();
					pc = new RTCPeerConnection(rtcConfig);
					pc.ontrack = (event) => {
						const stream = event.streams[0];
						if (stream) addLiveMic(stream);
						else if (event.track) addLiveMic(new MediaStream([event.track]));
					};
				}
				if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
				removeStaleLiveMicTracks();
				await pc.setRemoteDescription(msg.description);
				const answer = await pc.createAnswer();
				await pc.setLocalDescription(answer);
				await waitForIceComplete(pc);
				channel.postMessage({
					type: "RECEIVER_ANSWER",
					receiverId,
					description: plainRtcDescription(pc.localDescription)
				});
			} catch (err) {
				state.status = `Receiver audio error: ${err.message}`;
				render();
				pc?.close?.();
				pc = null;
			}
		};
		channel.postMessage({
			type: "RECEIVER_READY",
			receiverId,
			roomCode: state.roomCode
		});
		setInterval(() => channel.postMessage({
			type: "RECEIVER_READY",
			receiverId,
			roomCode: state.roomCode
		}), 3e3);
	}
	retryLiveMicsButton.addEventListener("click", () => {
		tryPlayLiveMics();
	});
	startReceiverAudioButton.addEventListener("click", () => {
		state.audioOutputUnlocked = true;
		tryPlayLiveMics();
	});
	root.addEventListener("pointerdown", () => {
		if (!state.audioOutputUnlocked && liveMicTrackIds.size) state.audioOutputUnlocked = true;
		if (liveMicTrackIds.size) tryPlayLiveMics();
	});
	window.addEventListener("message", (ev) => handle(ev.data));
	function syncReceiverVideo() {
		if (!state.playbackState || !media.src || media.readyState < 1) return;
		const derived = deriveTvMediaPositionMs(state.playbackState);
		const seconds = Math.max(0, derived.positionMs / 1e3);
		if (Number.isFinite(seconds) && Math.abs((media.currentTime || 0) - seconds) > .75) media.currentTime = seconds;
		if (!(!!state.playbackState.paused || [
			"paused",
			"idle",
			"ended",
			"host_lost",
			"error"
		].includes(state.playbackState.status || ""))) media.play().catch(() => {});
		else media.pause();
	}
	setInterval(syncReceiverVideo, 500);
	media.addEventListener("timeupdate", () => {
		if (!state.playbackState) state.mediaTimeMs = Math.round(media.currentTime * 1e3);
		render();
	});
	async function startCastReceiverFramework() {
		if (!shouldLoadCastReceiverFramework()) return;
		try {
			await loadCastReceiverFramework();
		} catch (error) {
			state.status = error.message;
			render();
			return;
		}
		if (!castGlobal().cast?.framework?.CastReceiverContext) return;
		const context = cast.framework.CastReceiverContext.getInstance();
		context.addCustomMessageListener(CAST_NAMESPACE, (event) => handle(event.data));
		context.start();
	}
	startCastReceiverFramework();
	render();
}
//#endregion
//#region src/app/dom.ts
function $(selector, root = document) {
	return root.querySelector(selector);
}
function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[character]);
}
function localHttpWarning(locationLike = location) {
	const hostname = locationLike.hostname;
	return locationLike.protocol === "http:" && hostname !== "localhost" && hostname !== "127.0.0.1" ? "<p class=\"warn\">Phone browser is on local HTTP. If offer creation, camera QR, or protected video fails, use the GitHub Pages HTTPS URL for the full flow.</p>" : "";
}
function commonChrome(root, title) {
	root.innerHTML = `<main class="shell"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>${title}</h1>${localHttpWarning()}</div><div class="mini-stage" aria-hidden="true"><span></span><span></span><span></span></div></header><section id="main"></section><section class="activity-card"><h2>Log</h2><div id="log" class="log"></div></section></main>`;
}
function logToPage(message) {
	const logContainer = $("#log");
	if (!logContainer) return;
	logContainer.prepend(Object.assign(document.createElement("div"), { textContent: `${(/* @__PURE__ */ new Date()).toLocaleTimeString()} ${String(message)}` }));
}
//#endregion
//#region src/app/catalog.ts
function assetUrl(path, baseUrl = import.meta.url) {
	if (!path) return null;
	const publicPath = path.startsWith("/public/") ? path.slice(7) : path;
	return publicPath.startsWith("/") ? new URL(".." + publicPath, baseUrl).toString() : new URL(publicPath, baseUrl).toString();
}
function normalizeSong(song, baseUrl = import.meta.url) {
	return {
		...song,
		lyricsJsonUrl: assetUrl(song.lyricsJsonUrl, baseUrl),
		lyricsVttUrl: assetUrl(song.lyricsVttUrl, baseUrl),
		castMediaUrl: assetUrl(song.castMediaUrl, baseUrl),
		phoneBackingAudioUrl: assetUrl(song.phoneBackingAudioUrl, baseUrl),
		thumbnailUrl: assetUrl(song.thumbnailUrl, baseUrl)
	};
}
async function loadSongCatalog(baseUrl = import.meta.url) {
	const protectedSongs = await loadProtectedCatalog();
	let plainSongs = [];
	try {
		const plainUrl = assetUrl("/songs/catalog.json", baseUrl);
		const plainRes = plainUrl ? await fetch(plainUrl) : null;
		if (plainRes?.ok) plainSongs = ((await plainRes.json()).songs || []).map((song) => normalizeSong(song, baseUrl));
	} catch {
		plainSongs = [];
	}
	return [...protectedSongs, ...plainSongs];
}
function formatSongTitle(song, songId) {
	return song ? `${song.title || song.songId}${song.artist ? " — " + song.artist : ""}` : songId;
}
//#endregion
//#region src/app/lyricsView.ts
function lyricView(lines = [], positionMs) {
	const activeLine = lines.findLast?.((line) => positionMs >= line.startMs) || lines.filter((line) => positionMs >= line.startMs).pop() || lines[0];
	return `<div>${lines.map((line) => `<p class="${line === activeLine ? "active" : ""}">${escapeHtml(line.text)}</p>`).join("")}</div>`;
}
//#endregion
//#region src/app/queueService.ts
function pairedActor$1(room, remotePeerId, messagePlayerId) {
	return room?.players?.find((roomPlayer) => roomPlayer.playerId === messagePlayerId && roomPlayer.peerId === remotePeerId);
}
function validSingerNumbers(room, singerNumbers) {
	const playerNumbersInRoom = new Set(room?.players?.map((roomPlayer) => roomPlayer.playerNumber).filter(Boolean) || []);
	return [...new Set((Array.isArray(singerNumbers) ? singerNumbers : []).filter((singerNumber) => Number.isInteger(singerNumber) && playerNumbersInRoom.has(singerNumber)))];
}
function handleQueueAddRequest$1(room, catalog, remotePeerId, message) {
	const queueItem = message.item || {};
	const actor = pairedActor$1(room, remotePeerId, queueItem.requestedByPlayerId);
	if (!actor?.playerNumber) throw new Error("Queue request needs a paired requester.");
	if (!catalog.some((song) => song.songId === queueItem.songId)) throw new Error("Queue request song is not in this room catalog.");
	const singerNumbers = validSingerNumbers(room, queueItem.singerNumbers);
	enqueueRequest(room, {
		...queueItem,
		requestedByPlayerId: actor.playerId,
		singerNumbers: singerNumbers.length ? singerNumbers : [actor.playerNumber]
	});
}
function applyPhoneQueueUpdate$1(room, remotePeerId, message) {
	const actor = pairedActor$1(room, remotePeerId, message.playerId);
	if (!actor?.playerNumber) throw new Error("Queue update needs a paired player number.");
	const queueItem = room.queue.find((item) => item.queueItemId === message.queueItemId);
	if (!queueItem) throw new Error("Queue item not found.");
	if (message.action === "join") addSingerToQueueItem(room, queueItem.queueItemId, actor.playerNumber);
	else if (message.action === "leave") removeSingerFromQueueItem(room, queueItem.queueItemId, actor.playerNumber);
	else if (message.action === "remove" && queueItem.requestedByPlayerId === actor.playerId && !["active", "ended"].includes(queueItem.status)) removeQueueItem(room, queueItem.queueItemId);
	else throw new Error("Queue update not allowed.");
}
//#endregion
//#region src/app/queueView.ts
function singerNames(room, singerNumbers) {
	return singerNumbers.map((singerNumber) => room.players.find((roomPlayer) => roomPlayer.playerNumber === singerNumber)?.displayName || `#${singerNumber}`).join(", ");
}
function queueHtml$1(room, mode = "host", songTitle, player) {
	if (!room?.queue?.length) return "<p class=\"subtle\">No songs queued yet.</p>";
	return `<ul class="queue-items">${room.queue.map((queueItem) => {
		const queueId = escapeHtml(queueItem.queueItemId);
		const status = escapeHtml(queueItem.status);
		const requestedBy = room.players.find((roomPlayer) => roomPlayer.playerId === queueItem.requestedByPlayerId)?.displayName || "Guest";
		const hostControls = `${["requested", "rejected"].includes(queueItem.status) ? `<button class="acceptItem" data-queue-id="${queueId}" title="Accept/requeue">Approve</button>` : ""} ${queueItem.status === "queued" ? `<button class="startItem" data-queue-id="${queueId}" title="Start on TV">Start now</button>` : ""} ${queueItem.status === "requested" ? `<button class="rejectItem" data-queue-id="${queueId}" title="Reject">Not now</button>` : ""} <button class="moveUpItem" data-queue-id="${queueId}" title="Move earlier">↑</button> <button class="moveDownItem" data-queue-id="${queueId}" title="Move later">↓</button> <button class="removeItem" data-queue-id="${queueId}" title="Remove">Remove</button>`;
		const phoneControls = !["active", "ended"].includes(queueItem.status) ? `<button class="queueSelf" data-action="join" data-queue-id="${queueId}">Add me</button> <button class="queueSelf" data-action="leave" data-queue-id="${queueId}">Leave</button> ${queueItem.requestedByPlayerId === player?.playerId ? `<button class="queueSelf" data-action="remove" data-queue-id="${queueId}">Cancel request</button>` : ""}` : "";
		return `<li class="queue-item"><div class="queue-top"><strong>${escapeHtml(songTitle(queueItem.songId))}</strong><span class="queue-status queue-status-${status}">${status}</span></div><p class="subtle">Singers: ${escapeHtml(singerNames(room, queueItem.singerNumbers))} · requested by ${escapeHtml(requestedBy)}</p><div class="button-row queue-actions">${mode === "host" ? hostControls : phoneControls}</div></li>`;
	}).join("")}</ul>`;
}
//#endregion
//#region src/app.ts
var room = loadRoom();
var player = JSON.parse(localStorage.getItem("carryokie.player") || "null");
var peerNode;
var audio;
var catalog = [];
var castController;
var castListenersAttached = false;
var phoneSyncTimer = null;
var receiverChannel;
var receiverPc;
var receiverSessionId = null;
var receiverAudioDirty = false;
var receiverNegotiating = false;
var receiverPendingRenegotiate = false;
var receiverNegotiationTimer = null;
var receiverTrackKeys = /* @__PURE__ */ new Set();
var hostRemoteAudioSinks = /* @__PURE__ */ new WeakMap();
var audioPipeline = {
	hostRemoteAudioTracks: 0,
	hostRelayedStreams: 0,
	receiverReady: false,
	receiverPcConnectionState: "new",
	receiverPcIceState: "new",
	receiverTracksAdded: 0,
	receiverOfferSentAt: null,
	receiverAnswerReceivedAt: null,
	receiverLastError: null
};
function renderAudioPipelineStatus() {
	const el = $("#audioPipelineStatus");
	if (el) el.textContent = JSON.stringify(audioPipeline, null, 2);
}
function publishAudioPipelineStatus() {
	renderAudioPipelineStatus();
	receiverChannel?.postMessage?.({
		type: "RECEIVER_AUDIO_STATUS",
		payload: { ...audioPipeline }
	});
}
var peerCloseTimers = /* @__PURE__ */ new Map();
function persist() {
	if (room) saveRoom(room);
	if (player) localStorage.setItem("carryokie.player", JSON.stringify(player));
}
function log(msg) {
	logToPage(msg);
}
function sinkHostRemoteAudio(stream) {
	if (hostRemoteAudioSinks.has(stream)) return;
	const sink = document.createElement("audio");
	sink.autoplay = true;
	sink.muted = true;
	sink.playsInline = true;
	sink.srcObject = stream;
	sink.style.display = "none";
	document.body.appendChild(sink);
	hostRemoteAudioSinks.set(stream, sink);
	sink.play().catch(() => {
		log("Host remote mic sink is waiting for the next user gesture.");
	});
}
function currentMicStatusText() {
	if (!player?.micState?.enabled) return "Mic muted until enabled.";
	if (player.micState.muted) return "Mic muted.";
	return "Mic live.";
}
async function loadCatalog() {
	catalog = await loadSongCatalog(import.meta.url);
}
function unlockPhoneAudio() {
	audio?.init().catch((error) => {
		log(error?.message || "Phone audio unlock was ignored by the browser.");
	});
}
function setupPeer(localPeerId) {
	peerNode = new PeerNode(localPeerId);
	globalThis.__carryokiePeerNode = peerNode;
	peerNode.addEventListener("open", (e) => {
		clearPeerCloseTimer(e.detail.remotePeerId);
		log(`DataChannel open: ${e.detail.remotePeerId}`);
		peerNode.send(e.detail.remotePeerId, {
			type: RPC.ROOM_HELLO,
			peerId: localPeerId,
			player
		});
		if (player?.isHost) peerNode.send(e.detail.remotePeerId, {
			type: RPC.ROOM_STATE_SNAPSHOT,
			room
		});
	});
	peerNode.addEventListener("close", (e) => handlePeerClosed(e.detail.remotePeerId));
	peerNode.addEventListener("connection", (e) => {
		if (e.detail.state === "connected") clearPeerCloseTimer(e.detail.remotePeerId);
		if (e.detail.state === "disconnected") schedulePeerClosed(e.detail.remotePeerId);
		if (e.detail.state === "failed" || e.detail.state === "closed") handlePeerClosed(e.detail.remotePeerId);
	});
	peerNode.addEventListener("message", (e) => handleRpc(e.detail.remotePeerId, e.detail.msg));
	peerNode.addEventListener("error", (e) => log(e.detail.message));
	peerNode.addEventListener("track", (e) => {
		const remoteStream = e.detail.stream || (e.detail.track ? new MediaStream([e.detail.track]) : null);
		if (!remoteStream) return;
		(globalThis.__carryokieRemoteStreams ||= []).push(remoteStream);
		audio?.addRemoteStream(remoteStream, e.detail.remotePeerId);
		if (player?.isHost) {
			sinkHostRemoteAudio(remoteStream);
			peerNode.relayRemoteStream(e.detail.remotePeerId, remoteStream);
			audioPipeline.hostRemoteAudioTracks = (peerNode.relayedStreams || []).reduce((sum, r) => sum + (r.stream?.getAudioTracks?.()?.length || 0), 0);
			audioPipeline.hostRelayedStreams = (peerNode.relayedStreams || []).length;
			receiverAudioDirty = true;
			negotiateReceiverAudio().catch((err) => log(err.message));
			publishAudioPipelineStatus();
		}
	});
	setInterval(() => peerNode?.pingAll(), 5e3);
	setInterval(() => {
		if (player?.isHost && room?.playbackState && !room.playbackState.paused && receiverChannel) {
			const now = Date.now();
			const derived = deriveTvMediaPositionMs(room.playbackState, now, 0);
			room.playbackState = {
				...room.playbackState,
				tvMediaTimeMs: derived.positionMs,
				tvMediaTimeSampledAtHostMs: now,
				lastUpdatedAtHostMs: now
			};
			publishReceiverPlayback(room.playbackState);
		}
	}, 2e3);
	return peerNode;
}
function isHostEdge(remotePeerId) {
	return remotePeerId === "host" || !!room?.hostPeerId && remotePeerId === room.hostPeerId;
}
function handlePeerClosed(remotePeerId) {
	clearPeerCloseTimer(remotePeerId);
	if (player?.isHost) {
		handlePlayerLeft(remotePeerId);
		return;
	}
	if (room && isHostEdge(remotePeerId)) {
		lockHostLost(room);
		persist();
		log(room.hostLostMessage || "Host disconnected. TV and queue controls are locked. Create a new room to continue.");
		renderPlayer($("#main"));
	}
}
function clearPeerCloseTimer(remotePeerId) {
	clearTimeout(peerCloseTimers.get(remotePeerId));
	peerCloseTimers.delete(remotePeerId);
}
function schedulePeerClosed(remotePeerId) {
	if (peerCloseTimers.has(remotePeerId)) return;
	peerCloseTimers.set(remotePeerId, setTimeout(() => handlePeerClosed(remotePeerId), 1e4));
}
function handlePlayerLeft(remotePeerId) {
	if (!player?.isHost || !room) return;
	const target = room.players.find((p) => p.peerId === remotePeerId);
	if (!target || target.connectionState === "disconnected") return;
	target.connectionState = "disconnected";
	target.lastSeenAt = Date.now();
	peerNode.send(remotePeerId, {
		type: RPC.PLAYER_LEFT,
		peerId: remotePeerId
	});
	peerNode.broadcast({
		type: RPC.PLAYER_LEFT,
		peerId: remotePeerId,
		room
	});
	log(`Player #${target.playerNumber} ${target.displayName} disconnected.`);
	persist();
	renderHost($("#main"));
}
function broadcastRoom(type = RPC.ROOM_STATE_SNAPSHOT) {
	peerNode?.broadcast({
		type,
		room
	});
}
function receiverUrl() {
	return new URL(`../receiver/?room=${encodeURIComponent(room?.roomCode || "")}`, location.href).toString();
}
function receiverPayload() {
	return {
		roomCode: room?.roomCode,
		queue: queuePreview(),
		singers: room?.players?.filter((p) => p.isSingerForCurrentSong) || [],
		song: currentSong(),
		playbackState: room?.playbackState
	};
}
function publishReceiverState() {
	receiverChannel?.postMessage?.({
		type: "RECEIVER_STATE",
		payload: receiverPayload()
	});
}
function publishReceiverPlayback(sample = room?.playbackState) {
	receiverChannel?.postMessage?.({
		type: "RECEIVER_PLAYBACK_SYNC",
		payload: sample
	});
}
function publishReceiverCommand(type, payload = {}) {
	receiverChannel?.postMessage?.({
		type,
		payload
	});
}
function sendCastRoomUpdate(type, payload = {}) {
	castController?.sendSafe?.(type, payload);
	publishReceiverState();
}
function findRoomPlayerByMessage(remotePeerId, playerId) {
	if (!room?.players?.length) return null;
	return room.players.find((p) => p.playerId === playerId) || room.players.find((p) => p.peerId === remotePeerId) || null;
}
function updateRoomMicState(remotePeerId, playerId, patch) {
	const target = findRoomPlayerByMessage(remotePeerId, playerId);
	if (!target) return null;
	target.micState = {
		...target.micState,
		...patch
	};
	target.lastSeenAt = Date.now();
	if (player?.playerId === target.playerId) player = {
		...player,
		micState: target.micState
	};
	persist();
	return target;
}
function publishMicStateChange(target) {
	if (!target) return;
	broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
	publishReceiverState();
	renderHost($("#main"));
}
function plainRtcDescription(description) {
	return description ? {
		type: description.type,
		sdp: description.sdp
	} : null;
}
function resetReceiverAudio(receiverId) {
	receiverPc?.close?.();
	receiverPc = null;
	receiverTrackKeys.clear();
	receiverSessionId = receiverId;
	receiverAudioDirty = true;
	receiverPendingRenegotiate = false;
	clearTimeout(receiverNegotiationTimer ?? void 0);
	receiverNegotiationTimer = null;
	audioPipeline.receiverPcConnectionState = "new";
	audioPipeline.receiverPcIceState = "new";
	audioPipeline.receiverTracksAdded = 0;
	audioPipeline.receiverOfferSentAt = null;
	audioPipeline.receiverAnswerReceivedAt = null;
	audioPipeline.receiverLastError = null;
	publishAudioPipelineStatus();
}
async function negotiateReceiverAudio() {
	if (!player?.isHost || !receiverPc || !peerNode || !receiverAudioDirty) return;
	if (receiverNegotiating || receiverPc.signalingState !== "stable") {
		receiverPendingRenegotiate = true;
		return;
	}
	receiverNegotiating = true;
	receiverPendingRenegotiate = false;
	receiverAudioDirty = false;
	let offerSent = false;
	try {
		const senders = receiverPc.getSenders?.() || [];
		for (const sender of senders) if (sender.track?.readyState === "ended") {
			receiverTrackKeys.delete(mediaTrackKey(sender.track));
			try {
				receiverPc.removeTrack(sender);
			} catch {}
		}
		const receiverStreams = [...(peerNode.localStreams || []).map((stream) => ({
			sourcePeerId: peerNode.localPeerId,
			stream
		})), ...peerNode.relayedStreams || []].filter(({ stream }) => stream?.getAudioTracks?.().length);
		for (const { stream } of receiverStreams) stream.getAudioTracks().filter((track) => !receiverTrackKeys.has(mediaTrackKey(track))).forEach((track) => {
			receiverTrackKeys.add(mediaTrackKey(track));
			audioPipeline.receiverTracksAdded++;
			receiverPc.addTrack(track, stream);
		});
		if (!receiverTrackKeys.size) return;
		const offer = await receiverPc.createOffer({ offerToReceiveAudio: true });
		await receiverPc.setLocalDescription(offer);
		await waitForIceComplete(receiverPc);
		receiverChannel?.postMessage({
			type: "RECEIVER_OFFER",
			receiverId: receiverSessionId,
			description: plainRtcDescription(receiverPc.localDescription)
		});
		offerSent = true;
		audioPipeline.receiverOfferSentAt = Date.now();
		audioPipeline.receiverLastError = null;
		publishAudioPipelineStatus();
		clearTimeout(receiverNegotiationTimer ?? void 0);
		receiverNegotiationTimer = setTimeout(async () => {
			if (receiverNegotiating) {
				receiverNegotiating = false;
				audioPipeline.receiverLastError = "Receiver answer timeout (15s)";
				publishAudioPipelineStatus();
				try {
					if (receiverPc?.signalingState === "have-local-offer") await receiverPc.setLocalDescription({ type: "rollback" });
				} catch {}
				if (receiverPendingRenegotiate || receiverAudioDirty) negotiateReceiverAudio().catch((e) => log(e.message));
			}
		}, 15e3);
	} finally {
		if (!offerSent) receiverNegotiating = false;
	}
}
function setupReceiverBridge() {
	if (receiverChannel || typeof BroadcastChannel === "undefined") return;
	receiverChannel = new BroadcastChannel("carryokie.receiver");
	receiverChannel.onmessage = async (ev) => {
		const msg = ev.data || {};
		if (msg.type === "RECEIVER_READY") {
			const receiverId = msg.receiverId || "receiver";
			publishReceiverState();
			audioPipeline.receiverReady = true;
			if (receiverSessionId !== receiverId) resetReceiverAudio(receiverId);
			if (!receiverPc) {
				receiverPc = new RTCPeerConnection(rtcConfig);
				receiverPc.oniceconnectionstatechange = () => {
					audioPipeline.receiverPcIceState = receiverPc.iceConnectionState;
					publishAudioPipelineStatus();
					log(`Receiver tab audio ${receiverPc.iceConnectionState}`);
				};
				receiverPc.onconnectionstatechange = () => {
					audioPipeline.receiverPcConnectionState = receiverPc.connectionState;
					publishAudioPipelineStatus();
				};
			}
			negotiateReceiverAudio().catch((e) => log(e.message));
			publishAudioPipelineStatus();
		}
		if (msg.type === "RECEIVER_ANSWER" && receiverPc && (!msg.receiverId || msg.receiverId === receiverSessionId)) {
			await receiverPc.setRemoteDescription(msg.description).catch(async (e) => {
				log(e.message);
				audioPipeline.receiverLastError = e.message;
				publishAudioPipelineStatus();
				try {
					if (receiverPc?.signalingState === "have-local-offer") await receiverPc.setLocalDescription({ type: "rollback" });
				} catch {}
				receiverNegotiating = false;
			});
			clearTimeout(receiverNegotiationTimer ?? void 0);
			receiverNegotiating = false;
			audioPipeline.receiverAnswerReceivedAt = Date.now();
			audioPipeline.receiverLastError = null;
			publishAudioPipelineStatus();
			if (receiverPendingRenegotiate || receiverAudioDirty) negotiateReceiverAudio().catch((e) => log(e.message));
		}
	};
}
function songTitle(songId) {
	return formatSongTitle(catalog.find((s) => s.songId === songId), songId);
}
function queueSingerNames(queueItem) {
	return queueItem.singerNumbers.map((singerNumber) => room?.players?.find((p) => p.playerNumber === singerNumber)?.displayName || `#${singerNumber}`);
}
function queuePreview() {
	return room.queue.map((q) => ({
		...q,
		title: songTitle(q.songId),
		singerNames: queueSingerNames(q)
	}));
}
function queueHtml(r, mode = "host") {
	return queueHtml$1(r, mode, songTitle, player);
}
function publishQueueUpdate() {
	broadcastRoom(RPC.QUEUE_UPDATED);
	sendCastRoomUpdate("CAST_UPDATE_QUEUE_PREVIEW", { queue: queuePreview() });
	persist();
}
function attachCastListeners(cast) {
	if (castListenersAttached) return;
	castListenersAttached = true;
	cast.addEventListener("state", (e) => {
		const s = e.detail;
		const el = $("#castStatus");
		if (el) el.textContent = s.connected ? "Connected to TV" : s.available ? "Available, click to connect" : "Chromecast not available";
	});
	cast.addEventListener("error", (e) => log(e.detail.message));
	cast.addEventListener("playbackSample", (e) => {
		room.playbackState = {
			...room.playbackState,
			...e.detail,
			syncDegraded: false,
			lastUpdatedAtHostMs: Date.now()
		};
		peerNode?.broadcast({
			type: RPC.PLAYBACK_SYNC,
			sample: room.playbackState
		});
		publishReceiverPlayback(room.playbackState);
		persist();
	});
}
function setOwnMicMuted(muted) {
	audio?.setMicMuted(muted);
	if (player?.micState) player.micState = {
		...player.micState,
		enabled: true,
		publishing: true,
		muted
	};
	if (room?.players?.length && player?.playerId) {
		const target = findRoomPlayerByMessage(player.peerId, player.playerId);
		if (target) {
			target.micState = {
				...target.micState,
				enabled: true,
				publishing: true,
				muted
			};
			target.lastSeenAt = Date.now();
		}
	}
	persist();
	const status = $("#micStatus");
	if (status) status.textContent = muted ? "Mic muted." : "Mic live.";
	peerNode?.broadcast({
		type: muted ? RPC.MIC_MUTED : RPC.MIC_UNMUTED,
		playerId: player?.playerId,
		muted
	});
}
function registerRemotePlayer(remotePeerId, remotePlayer) {
	if (!player?.isHost || !remotePlayer || !room) return false;
	const existing = room.players.find((p) => p.peerId === remotePlayer.peerId || p.playerId === remotePlayer.playerId);
	if (existing) {
		const nextDisplayName = normalizeDisplayName(remotePlayer.displayName, existing.displayName || "Guest");
		const changed = existing.displayName !== nextDisplayName || existing.connectionState !== "connected" || existing.peerId !== (remotePlayer.peerId || remotePeerId);
		existing.displayName = nextDisplayName;
		existing.peerId = remotePlayer.peerId || remotePeerId;
		existing.connectionState = "connected";
		existing.lastSeenAt = Date.now();
		return changed;
	}
	addPlayer(room, {
		...remotePlayer,
		peerId: remotePlayer.peerId || remotePeerId,
		displayName: normalizeDisplayName(remotePlayer.displayName, "Guest"),
		role: "participant",
		isHost: false,
		connectionState: "connected",
		lastSeenAt: Date.now()
	});
	return true;
}
function currentSong() {
	return catalog.find((s) => s.songId === room?.currentSongId) || catalog[0];
}
function castOrigin() {
	return localStorage.getItem("carryokie.castOrigin") || location.origin;
}
function saveCastOrigin() {
	const input = $("#castOrigin");
	if (input?.value) localStorage.setItem("carryokie.castOrigin", input.value.replace(/\/$/, ""));
}
function showCastControls() {
	[
		"castLoadBtn",
		"castPlayBtn",
		"castPause",
		"castSeek"
	].forEach((id) => {
		const el = $("#" + id);
		if (el) el.style.display = "inline";
	});
}
async function loadCurrentSongOnTv() {
	const song = currentSong();
	if (!castController || !song) return false;
	try {
		await castController.loadSong(song, room);
		castController.sendSafe("CAST_SHOW_JOIN_QR", { roomCode: room.roomCode });
		publishReceiverState();
		showCastControls();
		$("#castStatus") && ($("#castStatus").textContent = `Loaded ${song.title || song.songId} on TV`);
		log(`TV media loaded: ${song.title || song.songId}`);
		return true;
	} catch (e) {
		log(e.message);
		return false;
	}
}
function pauseCurrentPlayback() {
	if (!room?.playbackState) return;
	const derived = deriveTvMediaPositionMs(room.playbackState, Date.now(), 0);
	room.playbackState = {
		...room.playbackState,
		paused: true,
		status: "paused",
		pausedAtSongMs: derived.positionMs,
		tvMediaTimeMs: derived.positionMs,
		lastUpdatedAtHostMs: Date.now()
	};
	publishReceiverPlayback(room.playbackState);
	broadcastRoom(RPC.PLAYBACK_PAUSED);
	persist();
}
function resumeCurrentPlayback() {
	if (!room?.playbackState) return;
	const now = Date.now();
	const wasAt = room.playbackState.pausedAtSongMs || 0;
	room.playbackState = {
		...room.playbackState,
		paused: false,
		status: "playing",
		startedAtHostMs: now,
		tvMediaTimeMs: wasAt,
		tvMediaTimeSampledAtHostMs: now,
		pausedAtSongMs: 0,
		syncDegraded: false,
		lastUpdatedAtHostMs: now
	};
	publishReceiverPlayback(room.playbackState);
	broadcastRoom(RPC.PLAYBACK_STARTED);
	persist();
}
function startQueueItem(item) {
	if (!item) {
		log("Queue is empty. Add or accept a song first.");
		return;
	}
	if (item.status !== "queued") {
		log("Accept the queue item before starting it.");
		return;
	}
	room.currentSongId = item.songId;
	room.currentQueueItemId = item.queueItemId;
	room.queue.forEach((q) => {
		if (q.status === "active" && q.queueItemId !== item.queueItemId) q.status = "ended";
	});
	item.status = "active";
	if (!item.acceptedAt) item.acceptedAt = Date.now();
	const singerIds = item.singerNumbers.map((n) => room.players.find((p) => p.playerNumber === n)?.playerId).filter(Boolean);
	assignSingers(room, singerIds);
	room.playbackState = {
		...room.playbackState,
		songId: item.songId,
		status: "loading",
		startedAtHostMs: null,
		pausedAtSongMs: 0,
		seekOffsetMs: 0,
		tvMediaTimeMs: 0,
		tvMediaTimeSampledAtHostMs: null,
		paused: true,
		syncDegraded: true,
		lastUpdatedAtHostMs: Date.now()
	};
	broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
	sendCastRoomUpdate("CAST_UPDATE_QUEUE_PREVIEW", { queue: queuePreview() });
	sendCastRoomUpdate("CAST_SET_SINGERS", { players: room.players.filter((p) => p.isSingerForCurrentSong) });
	persist();
	publishReceiverState();
	if (castController?.state?.().connected) loadCurrentSongOnTv();
	resumeCurrentPlayback();
}
function pairedActor(remotePeerId, msgPlayerId) {
	return pairedActor$1(room, remotePeerId, msgPlayerId);
}
function handleQueueAddRequest(remotePeerId, msg) {
	handleQueueAddRequest$1(room, catalog, remotePeerId, msg);
}
function applyPhoneQueueUpdate(remotePeerId, msg) {
	applyPhoneQueueUpdate$1(room, remotePeerId, msg);
}
function handleRpc(remotePeerId, msg) {
	log(`${msg.type} from ${remotePeerId}`);
	if (msg.type === RPC.ROOM_HELLO && player?.isHost) {
		const changed = registerRemotePlayer(remotePeerId, msg.player);
		peerNode.send(remotePeerId, {
			type: RPC.ROOM_STATE_SNAPSHOT,
			room
		});
		if (changed) {
			broadcastRoom();
			persist();
			renderHost($("#main"));
		}
	}
	if (msg.type === RPC.ROOM_STATE_SNAPSHOT && !player?.isHost) {
		room = msg.room;
		const self = room.players.find((p) => p.peerId === player.peerId || p.playerId === player.playerId);
		if (self) player = {
			...player,
			...self
		};
		persist();
		renderPlayer($("#main"));
	}
	if (msg.type === RPC.QUEUE_ADD_REQUEST && player?.isHost) try {
		handleQueueAddRequest(remotePeerId, msg);
		publishQueueUpdate();
		renderHost($("#main"));
	} catch (e) {
		peerNode.send(remotePeerId, {
			type: RPC.ERROR_NOTICE,
			message: e.message
		});
		log(e.message);
	}
	if (msg.type === RPC.QUEUE_UPDATE_REQUEST && player?.isHost) try {
		applyPhoneQueueUpdate(remotePeerId, msg);
		publishQueueUpdate();
		renderHost($("#main"));
	} catch (e) {
		peerNode.send(remotePeerId, {
			type: RPC.ERROR_NOTICE,
			message: e.message
		});
		log(e.message);
	}
	if (msg.type === RPC.QUEUE_UPDATED && !player?.isHost) {
		room = msg.room;
		persist();
		renderPlayer($("#main"));
	}
	if (msg.type === RPC.PLAYBACK_SYNC) {
		room.playbackState = {
			...room.playbackState,
			...msg.sample,
			syncDegraded: false
		};
		persist();
		renderLyricsPanel();
		syncPhoneVideo();
	}
	if (msg.type === RPC.SINGER_JOIN_REQUEST && player?.isHost) {
		const actor = pairedActor(remotePeerId, msg.playerId);
		if (actor) {
			const singers = [...new Set([...room.players.filter((p) => p.isSingerForCurrentSong).map((p) => p.playerId), actor.playerId])].slice(0, 5);
			assignSingers(room, singers);
			broadcastRoom(RPC.SINGER_ASSIGNED);
			sendCastRoomUpdate("CAST_SET_SINGERS", { players: room.players.filter((p) => p.isSingerForCurrentSong) });
			persist();
			renderHost($("#main"));
		} else peerNode.send(remotePeerId, {
			type: RPC.ERROR_NOTICE,
			message: "Singer request needs a paired player."
		});
	}
	if (msg.type === RPC.SINGER_ASSIGNED && !player?.isHost) {
		room = msg.room;
		const self = room.players.find((p) => p.peerId === player.peerId || p.playerId === player.playerId);
		if (self) player = {
			...player,
			...self
		};
		persist();
		renderPlayer($("#main"));
	}
	if (msg.type === RPC.PLAYER_LEFT && !player?.isHost) {
		room = msg.room;
		if (room?.playbackState?.status === "host_lost") log("Host disconnected. TV and queue controls are locked. Create a new room to continue.");
		else log(`Player ${msg.peerId} left the room.`);
		persist();
		renderPlayer($("#main"));
	}
	if (!player?.isHost && msg.playerId === player?.playerId && (msg.type === RPC.MIC_MUTED || msg.type === RPC.MIC_UNMUTED)) {
		setOwnMicMuted(msg.type === RPC.MIC_MUTED || !!msg.muted);
		log(msg.type === RPC.MIC_MUTED ? "Host muted your mic." : "Host unmuted your mic.");
	}
	if (player?.isHost && msg.type === RPC.MIC_ENABLED) {
		const target = updateRoomMicState(remotePeerId, msg.playerId, {
			enabled: true,
			publishing: true,
			muted: !!msg.muted
		});
		if (target) {
			publishMicStateChange(target);
			log(`#${target.playerNumber} ${target.displayName} enabled mic${target.micState?.muted ? " muted" : " live"}.`);
		}
	}
	if (player?.isHost && msg.type === RPC.MIC_MUTED) {
		const target = updateRoomMicState(remotePeerId, msg.playerId, {
			enabled: true,
			publishing: true,
			muted: true
		});
		if (target) {
			publishMicStateChange(target);
			log(`#${target.playerNumber} ${target.displayName} muted mic.`);
		}
	}
	if (player?.isHost && msg.type === RPC.MIC_UNMUTED) {
		const target = updateRoomMicState(remotePeerId, msg.playerId, {
			enabled: true,
			publishing: true,
			muted: false
		});
		if (target) {
			publishMicStateChange(target);
			log(`#${target.playerNumber} ${target.displayName} unmuted mic.`);
		}
	}
}
async function hostPage(root) {
	await loadCatalog();
	if (!player?.isHost) {
		player = makePlayer("host", "Host");
		player.playerNumber = 1;
		room = makeRoom(player);
		persist();
	}
	setupPeer(player.peerId);
	setupReceiverBridge();
	commonChrome(root, "Host Controller");
	renderHost($("#main"));
}
function renderHost(main) {
	const setupComplete = room.players.length > 1 && room.queue.length > 0;
	const tvBleedWarn = room.players.some((p) => p.isSingerForCurrentSong) ? "<p class=\"warn\">TV bleed risk: singers should use headphones. Lyrics/video on TV only.</p>" : "";
	const activeSingers = room.players.filter((p) => p.isSingerForCurrentSong).length;
	main.innerHTML = `<section class="host-dashboard"><div class="room-spotlight card"><div><p class="eyebrow">Host room</p><h2>Room ${escapeHtml(room.roomCode)}</h2><p class="subtle">${room.players.length}/5 players · ${activeSingers} active singer(s) · ${room.queue.length} queue item(s)</p><ol class="quickstart"><li><strong>Share room:</strong> singers open the player join link.</li><li><strong>Pair one phone:</strong> player makes a code, host answers once.</li><li><strong>Start room:</strong> approve queue, connect TV, pick singer.</li></ol></div><div class="stage-art compact" aria-hidden="true"><div class="stage-orb"></div><div class="soundwave"><span></span><span></span><span></span><span></span><span></span></div></div></div><section class="grid"><details class="card" open><summary>1. Share this room</summary><p><a href="../player/?room=${escapeHtml(room.roomCode)}">Open player join link</a></p><p><a href="${escapeHtml(receiverUrl())}" target="_blank" rel="noreferrer">Open TV receiver tab</a></p><p class="hint">Chrome tab cast path: open the receiver tab first, then cast that tab.</p><button id="newRoom">Start over with a new room</button>${tvBleedWarn}</details><details class="card"${setupComplete ? "" : " open"}><summary>2. Pair a phone</summary><p>Player creates a join code. Paste or scan it here, then send back the host answer.</p><textarea id="offer" placeholder="Paste player offer/link/chunks"></textarea><div class="button-row"><button id="scanOfferQr">Scan player QR</button><button id="answerOffer" class="primary">Create host answer</button></div><div id="answerOut"></div></details><div class="card queue-card"><h2>3. Run the room</h2><div class="button-row"><button id="acceptAll">Approve waiting songs</button><button id="startNext" class="primary">Start next song</button><button id="pauseSong">Pause song</button><button id="resumeSong">Resume song</button></div>${queueHtml(room, "host")}</div><details class="card"><summary>TV controls</summary><p id="castStatus" class="status-pill live-status">Click to connect to Chromecast</p><button id="castBtn" class="primary">Connect TV / cast current song</button><button id="castLoadBtn" style="display:none">Reload current song on TV</button><div class="button-row"><button id="castPlayBtn" style="display:none">Play</button><button id="castPause" style="display:none">Pause</button></div><label>Seek seconds <input id="castSeekSeconds" type="number" min="0" value="0"></label><button id="castSeek" style="display:none">Seek</button><label>Cast media origin <input id="castOrigin" value="${escapeHtml(castOrigin())}" placeholder="http://192.168.x.x:4174"></label><p class="hint">Default Chromecast receiver plays media only. For room UI and live mics, cast the receiver tab link above.</p><pre id="castState"></pre></details><details class="card singer-card"><summary>Singers / mic control</summary><p class="subtle">Check who should be live on this song.</p>${room.players.map((p) => `<div class="inline-choice"><label><input type="checkbox" class="singer" value="${escapeHtml(p.playerId)}" ${p.isSingerForCurrentSong ? "checked" : ""}> #${p.playerNumber} ${escapeHtml(p.displayName)}</label><button class="mutePlayer" data-player-id="${escapeHtml(p.playerId)}">Mute #${p.playerNumber}</button></div>`).join("")}<button id="setSingers" class="primary">Save singer list</button></details><details class="card"><summary>Audio pipeline</summary><pre id="audioPipelineStatus">${escapeHtml(JSON.stringify(audioPipeline, null, 2))}</pre></details></section></section>`;
	$("#newRoom").onclick = () => {
		player = makePlayer("host", "Host");
		player.playerNumber = 1;
		room = makeRoom(player);
		persist();
		location.reload();
	};
	$("#scanOfferQr").onclick = async () => {
		try {
			await scanQrInto($("#offer"), log);
		} catch (e) {
			log(e.message);
		}
	};
	$("#answerOffer").onclick = async () => {
		try {
			const encoded = await peerNode.acceptManualOffer($("#offer").value);
			renderPayloadCard($("#answerOut"), encoded, "Host answer");
		} catch (e) {
			log(e.message);
		}
	};
	$("#acceptAll").onclick = () => {
		room.queue.filter((q) => q.status === "requested").forEach((q) => acceptQueue(room, q.queueItemId));
		publishQueueUpdate();
		renderHost(main);
	};
	$("#startNext").onclick = () => {
		startQueueItem(nextQueuedItem(room));
		renderHost(main);
	};
	$("#pauseSong").onclick = () => {
		publishReceiverCommand("CAST_PAUSE");
		castController?.pause?.();
		pauseCurrentPlayback();
		renderHost(main);
	};
	$("#resumeSong").onclick = () => {
		publishReceiverCommand("CAST_PLAY");
		castController?.play?.().catch((e) => log(e.message));
		resumeCurrentPlayback();
		renderHost(main);
	};
	$("#setSingers").onclick = () => {
		assignSingers(room, [...document.querySelectorAll(".singer:checked")].map((i) => i.value));
		broadcastRoom(RPC.SINGER_ASSIGNED);
		sendCastRoomUpdate("CAST_SET_SINGERS", { players: room.players.filter((p) => p.isSingerForCurrentSong) });
		persist();
		renderHost(main);
	};
	document.querySelectorAll(".acceptItem").forEach((b) => b.onclick = () => {
		acceptQueue(room, b.dataset.queueId);
		publishQueueUpdate();
		renderHost(main);
	});
	document.querySelectorAll(".startItem").forEach((b) => b.onclick = () => {
		startQueueItem(room.queue.find((q) => q.queueItemId === b.dataset.queueId));
		renderHost(main);
	});
	document.querySelectorAll(".rejectItem").forEach((b) => b.onclick = () => {
		rejectQueue(room, b.dataset.queueId);
		publishQueueUpdate();
		renderHost(main);
	});
	document.querySelectorAll(".removeItem").forEach((b) => b.onclick = () => {
		removeQueueItem(room, b.dataset.queueId);
		publishQueueUpdate();
		renderHost(main);
	});
	document.querySelectorAll(".moveUpItem").forEach((b) => b.onclick = () => {
		moveQueueItem(room, b.dataset.queueId, -1);
		publishQueueUpdate();
		renderHost(main);
	});
	document.querySelectorAll(".moveDownItem").forEach((b) => b.onclick = () => {
		moveQueueItem(room, b.dataset.queueId, 1);
		publishQueueUpdate();
		renderHost(main);
	});
	document.querySelectorAll(".mutePlayer").forEach((b) => b.onclick = () => {
		const playerId = b.dataset.playerId;
		const target = room.players.find((p) => p.playerId === playerId);
		if (target) peerNode.send(target.peerId, {
			type: RPC.MIC_MUTED,
			playerId
		});
		log(`Mute sent to #${target?.playerNumber || "?"}`);
	});
	$("#castStatus").textContent = "Click to connect to Chromecast";
	const cast = castController || (castController = new CastController("CC1AD845"));
	$("#castStatus").textContent = "Click to connect to Chromecast";
	attachCastListeners(cast);
	$("#castBtn").onclick = async () => {
		try {
			saveCastOrigin();
			$("#castBtn").disabled = true;
			$("#castStatus").textContent = "Connecting to Chromecast…";
			await cast.init();
			await cast.requestSession();
			$("#castBtn").style.display = "none";
			showCastControls();
			$("#castStatus").textContent = "Connected to TV";
			publishReceiverState();
			log("Cast connected");
			await loadCurrentSongOnTv();
		} catch (e) {
			$("#castBtn").disabled = false;
			log(e.message);
		}
	};
	$("#castLoadBtn").onclick = () => {
		saveCastOrigin();
		loadCurrentSongOnTv();
	};
	$("#castPlayBtn").onclick = () => {
		publishReceiverCommand("CAST_PLAY");
		cast.play().catch((e) => log(e.message));
	};
	$("#castPause").onclick = () => {
		publishReceiverCommand("CAST_PAUSE");
		cast.pause();
	};
	$("#castSeek").onclick = () => {
		const seconds = +$("#castSeekSeconds").value || 0;
		publishReceiverCommand("CAST_SEEK", { seconds });
		cast.seek(seconds);
		if (room?.playbackState) {
			const now = Date.now();
			room.playbackState = {
				...room.playbackState,
				tvMediaTimeMs: seconds * 1e3,
				tvMediaTimeSampledAtHostMs: now,
				seekOffsetMs: 0,
				lastUpdatedAtHostMs: now
			};
			publishReceiverPlayback(room.playbackState);
			persist();
		}
	};
}
async function playerPage(root) {
	await loadCatalog();
	if (!player?.playerId || player.isHost) {
		player = makePlayer("participant", "Player");
		persist();
	}
	player.displayName = normalizeDisplayName(player.displayName, "Player");
	persist();
	setupPeer(player.peerId);
	audio = new PhoneAudio(log);
	globalThis.__carryokieAudio = audio;
	commonChrome(root, "Player Phone");
	renderPlayer($("#main"));
}
function playerIsJoined() {
	return !!(room?.hostPeerId && player?.playerNumber && room.players?.some((p) => p.playerId === player.playerId || p.peerId === player.peerId));
}
function joinRoomHtml(roomCode) {
	const reconnect = room?.hostPeerId ? `<div class="card"><h2>Reconnect</h2><p>Previously in room <strong>${escapeHtml(room.roomCode)}</strong>. Make a fresh join code, then ask the host for a new answer.</p><button id="forgetRoom">Forget room, start fresh</button></div>` : "";
	return `<section class="phone-screen"><div class="phone-hero card"><p class="eyebrow">Player pairing</p><h2>Join room ${escapeHtml(roomCode || "")}</h2><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><p class="subtle">Two steps: make a join code, then import the host answer. After joining, queue and mic controls appear.</p></div><details class="card" open><summary>Join room</summary><label>Your name<input id="displayName" value="${escapeHtml(player?.displayName || "Player")}" placeholder="Your name"></label><p class="subtle">Room code from link: <strong>${escapeHtml(roomCode || "not set")}</strong></p><button id="makeOffer" class="primary">1. Create phone pairing code</button><div id="offerOut"></div><label>Host answer<textarea id="answer" placeholder="Paste host answer/link/chunks"></textarea></label><div class="button-row"><button id="scanAnswerQr">Scan host answer QR</button><button id="importAnswer" class="primary">2. Finish pairing</button></div></details>${reconnect}</section>`;
}
function updatePlayerDisplayName() {
	if (!player) return;
	const input = $("#displayName");
	const nextDisplayName = normalizeDisplayName(input?.value, "Player");
	if (input) input.value = nextDisplayName;
	const changed = player.displayName !== nextDisplayName;
	player = {
		...player,
		displayName: nextDisplayName
	};
	persist();
	if (changed && playerIsJoined() && room?.hostPeerId) peerNode?.send(room.hostPeerId, {
		type: RPC.ROOM_HELLO,
		peerId: player.peerId,
		player
	});
}
function attachJoinHandlers() {
	document.querySelectorAll("button").forEach((b) => b.addEventListener("click", unlockPhoneAudio));
	$("#makeOffer").onclick = async () => {
		const button = $("#makeOffer");
		try {
			if (button) {
				button.disabled = true;
				button.textContent = "Creating code...";
			}
			const offerOut = $("#offerOut");
			if (offerOut) offerOut.textContent = "Creating phone pairing code...";
			log("Creating phone pairing code...");
			updatePlayerDisplayName();
			assertWebRtcSupported();
			const encoded = await peerNode.createManualOffer("host");
			renderPayloadCard($("#offerOut"), encoded, "Player offer");
			log("Phone pairing code ready.");
		} catch (e) {
			const offerOut = $("#offerOut");
			if (offerOut) offerOut.textContent = e.message;
			log(e.message);
		} finally {
			if (button) {
				button.disabled = false;
				button.textContent = "Create phone pairing code";
			}
		}
	};
	$("#scanAnswerQr").onclick = async () => {
		try {
			await scanQrInto($("#answer"), log);
		} catch (e) {
			log(e.message);
		}
	};
	$("#importAnswer").onclick = async () => {
		try {
			updatePlayerDisplayName();
			await peerNode.acceptManualAnswer($("#answer").value);
			log("Answer imported. Waiting for DataChannel open.");
		} catch (e) {
			log(e.message);
		}
	};
	$("#forgetRoom")?.addEventListener("click", () => {
		localStorage.removeItem("carryokie.room");
		localStorage.removeItem("carryokie.player");
		location.reload();
	});
	$("#displayName")?.addEventListener("change", updatePlayerDisplayName);
}
function renderPlayer(main) {
	const song = catalog.find((s) => s.songId === (room?.currentSongId || "song_002")) || catalog[0];
	const roomCode = new URLSearchParams(location.search).get("room") || room?.roomCode || "";
	const currentTitle = song ? `${escapeHtml(song.title || song.songId)}${song.artist ? " — " + escapeHtml(song.artist) : ""}` : "Pick a song";
	if (!playerIsJoined()) {
		main.innerHTML = joinRoomHtml(roomCode);
		attachJoinHandlers();
		return;
	}
	main.innerHTML = `<section class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie phone</p><h2>${currentTitle}</h2><p class="subtle">${escapeHtml(player.displayName || "Player")} · Room ${escapeHtml(roomCode || "joined")} · Player #${escapeHtml(player.playerNumber || "?")}</p><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><p id="micStatus" class="status-pill live-status">${escapeHtml(currentMicStatusText())}</p><div class="primary-actions"><button id="enableMic" class="primary">Enable my mic</button><button id="holdSing" class="hold-button">Hold to sing</button><button id="toggleSing">Live / mute</button><button id="muteMic" class="danger">Mute mic</button></div></div>
<details class="card" open><summary>1. Queue this phone</summary><label>Your name<input id="displayName" value="${escapeHtml(player.displayName || "Player")}" placeholder="Your name"></label><label>Song<select id="song">${catalog.map((s) => `<option value="${s.songId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`).join("")}</select></label><label>Singers<input id="singers" value="${player.playerNumber || 2}" placeholder="Singer numbers comma separated"></label><p class="subtle">Default singer is you. Add more numbers only for duets/groups.</p><div class="button-row"><button id="requestSong" class="primary">Queue selected song</button><button id="requestSinger">Singer only</button></div><div class="queue-list">${queueHtml(room, "phone")}</div></details>
<details class="card" open><summary>2. Sing</summary><p class="warn compact">${escapeHtml(singerWarning)}</p><label class="check"><input type="checkbox" id="pushToSing"> Push-to-sing</label><label>Mic filter<select id="voicePreset"><option value="clean">Clean</option><option value="alto">Alto warm</option><option value="bravo">Bravo bright</option><option value="bass">Bass low</option><option value="radio">Radio</option><option value="autotune">Autotune-style polish</option></select></label><p id="wake" class="subtle"></p></details>
<details class="card"><summary>Advanced audio</summary><div class="button-row"><button id="startBacking">Start backing monitor</button><button id="pauseBacking">Pause backing monitor</button></div><label>Remote gain <input id="remoteGain" type="range" min="0" max="2" value="1" step=".05"></label><label>Backing monitor gain <input id="backingGain" type="range" min="0" max="1" value="0.35" step=".05"></label><label>Master gain <input id="masterGain" type="range" min="0" max="2" value="1" step=".05"></label></details>
<details class="card"><summary>4. Lyrics / sync</summary><video id="phoneVideo" controls playsinline muted></video><div id="lyricsPanel"></div><div class="button-row"><button id="earlier">Lyrics earlier</button><button id="later">Lyrics later</button><button id="resetSync">Reset sync</button></div></details>
<details class="card"><summary>Debug room state</summary><pre id="playerDebugState"></pre></details></section>`;
	document.querySelectorAll("button").forEach((b) => b.addEventListener("click", unlockPhoneAudio));
	$("#playerDebugState").textContent = JSON.stringify(room || { status: "not paired" }, null, 2);
	$("#displayName").addEventListener("change", updatePlayerDisplayName);
	$("#requestSong").onclick = () => {
		const item = queueRequest($("#song").value, $("#singers").value.split(",").map((s) => +s.trim()).filter(Boolean), player.playerId, room?.queue?.length || 0);
		peerNode.broadcast({
			type: RPC.QUEUE_ADD_REQUEST,
			item
		});
		log("Queue request sent.");
	};
	$("#requestSinger").onclick = () => {
		peerNode.broadcast({
			type: RPC.SINGER_JOIN_REQUEST,
			playerId: player.playerId
		});
		log("Singer slot requested.");
	};
	document.querySelectorAll(".queueSelf").forEach((b) => b.onclick = () => {
		peerNode.broadcast({
			type: RPC.QUEUE_UPDATE_REQUEST,
			action: b.dataset.action,
			queueItemId: b.dataset.queueId,
			playerId: player.playerId
		});
		log("Queue update sent.");
	});
	$("#voicePreset").onchange = (e) => {
		const target = e.target;
		audio?.setVoicePreset(target.value);
		const status = $("#micStatus");
		if (status) status.textContent = `Mic filter: ${target.selectedOptions?.[0]?.textContent || target.value}`;
	};
	$("#enableMic").onclick = async () => {
		const enableButton = $("#enableMic");
		if (enableButton?.disabled) return;
		if (enableButton) enableButton.disabled = true;
		try {
			const pushToSing = $("#pushToSing").checked;
			const status = await audio.tryWakeLock();
			$("#wake").textContent = status === "active" ? "Wake lock active" : "Keep this phone unlocked and tab open during song. Wake lock: " + status;
			const stream = await audio.requestMic({ pushToSing });
			const alreadyPublishing = !!player.micState?.publishing;
			const previousMuted = !!player.micState?.muted;
			const isNewMicStream = !peerNode.localStreams?.includes(stream);
			if (isNewMicStream) peerNode.addLocalStream(stream);
			player.micState = {
				...player.micState,
				enabled: true,
				publishing: true,
				muted: pushToSing
			};
			persist();
			if (isNewMicStream || !alreadyPublishing) peerNode.broadcast({
				type: RPC.MIC_ENABLED,
				playerId: player.playerId,
				muted: pushToSing
			});
			else if (previousMuted !== pushToSing) peerNode.broadcast({
				type: pushToSing ? RPC.MIC_MUTED : RPC.MIC_UNMUTED,
				playerId: player.playerId,
				muted: pushToSing
			});
			$("#micStatus").textContent = pushToSing ? "Mic ready. Hold to sing." : "Mic live.";
			log(isNewMicStream ? "Mic publishing. Own mic not locally monitored." : "Mic already publishing. Own mic not locally monitored.");
		} catch (e) {
			$("#micStatus").textContent = e.message;
			log(e.message);
		} finally {
			if (enableButton) enableButton.disabled = false;
		}
	};
	const hold = $("#holdSing");
	let holding = false;
	hold.onpointerdown = (e) => {
		e.preventDefault();
		holding = true;
		try {
			hold.setPointerCapture?.(e.pointerId);
		} catch (error) {
			log(error?.message || "Pointer capture unavailable for hold-to-sing.");
		}
		setOwnMicMuted(false);
	};
	hold.onpointerup = () => {
		holding = false;
		setOwnMicMuted(true);
	};
	hold.onpointercancel = () => {
		holding = false;
		setOwnMicMuted(true);
	};
	hold.onpointerleave = () => {
		if (holding) {
			holding = false;
			setOwnMicMuted(true);
		}
	};
	$("#toggleSing").onclick = () => setOwnMicMuted(!player?.micState?.muted);
	$("#muteMic").onclick = () => setOwnMicMuted(true);
	$("#startBacking").onclick = async () => audio?.startBackingMonitor(await resolvePlayableMediaUrl(song)).catch((e) => {
		$("#micStatus").textContent = e.message;
		log(e.message);
	});
	$("#pauseBacking").onclick = () => audio?.pauseBackingMonitor();
	$("#remoteGain").oninput = (e) => audio?.setGain("remote", +e.target.value);
	$("#backingGain").oninput = (e) => audio?.setGain("backing", +e.target.value);
	$("#masterGain").oninput = (e) => audio?.setGain("master", +e.target.value);
	$("#earlier").onclick = () => {
		room.playbackState.seekOffsetMs -= 250;
		persist();
		renderLyricsPanel();
	};
	$("#later").onclick = () => {
		room.playbackState.seekOffsetMs += 250;
		persist();
		renderLyricsPanel();
	};
	$("#resetSync").onclick = () => {
		room.playbackState.seekOffsetMs = 0;
		persist();
		renderLyricsPanel();
	};
	renderLyricsPanel();
	renderPhoneVideo(song);
}
async function renderPhoneVideo(song) {
	const video = $("#phoneVideo");
	if (!video) return;
	if (!isProtectedMedia(song)) {
		video.style.display = "none";
		video.removeAttribute("src");
		return;
	}
	video.style.display = "block";
	video.poster = "";
	video.muted = true;
	video.playsInline = true;
	try {
		const url = await resolvePlayableMediaUrl(song);
		if (video.src !== url) video.src = url;
		if (!phoneSyncTimer) phoneSyncTimer = setInterval(syncPhoneVideo, 500);
		syncPhoneVideo();
	} catch (e) {
		log(e.message);
	}
}
function syncPhoneVideo() {
	const video = $("#phoneVideo");
	if (!video || video.style.display === "none" || !room?.playbackState) return;
	const derived = deriveTvMediaPositionMs(room.playbackState, Date.now(), peerNode?.clockOffsetMs || 0);
	const seconds = Math.max(0, derived.positionMs / 1e3);
	if (Number.isFinite(seconds) && Math.abs((video.currentTime || 0) - seconds) > .75) video.currentTime = seconds;
	if (!room.playbackState.paused && room.playbackState.status !== "paused") video.play?.().catch(() => log("Tap the lyric video once if this browser blocks autoplay."));
	if (room.playbackState.paused || room.playbackState.status === "paused") video.pause?.();
}
async function renderLyricsPanel() {
	const panel = $("#lyricsPanel");
	if (!panel || !catalog.length) return;
	const song = catalog.find((s) => s.songId === (room?.currentSongId || "song_002")) || catalog[0];
	if (isProtectedMedia(song)) {
		panel.innerHTML = "<p>Lyric video loaded above. No separate lyric file needed.</p>";
		return;
	}
	const lyrics = await fetch(song.lyricsJsonUrl).then((r) => r.json()).catch(() => ({ lines: [] }));
	const ps = room?.playbackState;
	const derived = deriveTvMediaPositionMs(ps, Date.now(), peerNode?.clockOffsetMs || 0);
	let t = derived.positionMs;
	panel.innerHTML = (derived.syncDegraded ? "<p class=\"warn\">Sync degraded: waiting for actual TV Cast media status.</p>" : "") + lyricView(lyrics.lines, t);
}
async function debugPage(root) {
	commonChrome(root, "Debug");
	const savedRoom = loadRoom();
	const savedPlayer = JSON.parse(localStorage.getItem("carryokie.player") || "null");
	$("#main").innerHTML = `<section class="card"><h2>Local state</h2><button id="refresh">Refresh</button><pre id="debugLocalState"></pre><h2>Connection diagnostics</h2><pre id="debugConnectionState"></pre><p>ICE failures mean network may require TURN/different Wi-Fi. Strict MVP uses STUN only.</p><p>Keep phone unlocked and tab open; mobile browsers may suspend audio/WebRTC.</p></section><section class="card"><h2>Manual offer/answer</h2><p>Use these for manual pairing when WebRTC signaling fails.</p><div id="debugRole"></div><button id="debugOffer">Create offer</button><div id="offerOut"></div><textarea id="debugAnswer" placeholder="Paste answer/link/chunks"></textarea><button id="debugImport">Import answer</button><div id="answerOut"></div></section>`;
	$("#debugLocalState").textContent = JSON.stringify({
		room: savedRoom,
		player: savedPlayer
	}, null, 2);
	$("#debugConnectionState").textContent = JSON.stringify({
		peerId: savedPlayer?.peerId,
		hostPeerId: savedRoom?.hostPeerId,
		dataChannelPeerIds: peerNode ? [...peerNode.peers.keys()] : [],
		clockOffsetMs: peerNode?.clockOffsetMs ?? null,
		castState: castController?.state?.() ?? savedRoom?.castState ?? null,
		micPermission: savedPlayer?.micState?.permissionState ?? "unknown"
	}, null, 2);
	$("#refresh").onclick = () => location.reload();
	$("#debugOffer").onclick = async () => {
		try {
			const encoded = await peerNode.createManualOffer("host");
			renderPayloadCard($("#offerOut"), encoded, "Offer");
		} catch (e) {
			log(e.message);
		}
	};
	$("#debugImport").onclick = async () => {
		try {
			const encoded = await peerNode.acceptManualOffer($("#debugAnswer").value);
			renderPayloadCard($("#answerOut"), encoded, "Answer");
		} catch (e) {
			log(e.message);
		}
	};
}
function receiverPage(root) {
	receiverApp(root);
}
//#endregion
//#region src/main.ts
var root = document.getElementById("app");
var page = root?.dataset.page || location.pathname.split("/").filter(Boolean)[0] || "home";
if (page === "host") hostPage(root);
if (page === "player") playerPage(root);
if (page === "receiver") receiverPage(root);
if (page === "debug") debugPage(root);
//#endregion
