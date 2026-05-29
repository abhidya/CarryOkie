//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
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
	const createdAt = nowMs();
	return {
		queueItemId: uuid(),
		songId,
		singerNumbers: singers,
		requestedByPlayerId,
		status: "queued",
		createdAt,
		acceptedAt: createdAt
	};
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
	if (item.status === "rejected") item.status = "queued";
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
//#region node_modules/qrcode-generator/dist/qrcode.mjs
/**
* qrcode
* @param typeNumber 1 to 40
* @param errorCorrectionLevel 'L','M','Q','H'
*/
var qrcode = function(typeNumber, errorCorrectionLevel) {
	const PAD0 = 236;
	const PAD1 = 17;
	let _typeNumber = typeNumber;
	const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
	let _modules = null;
	let _moduleCount = 0;
	let _dataCache = null;
	const _dataList = [];
	const _this = {};
	const makeImpl = function(test, maskPattern) {
		_moduleCount = _typeNumber * 4 + 17;
		_modules = function(moduleCount) {
			const modules = new Array(moduleCount);
			for (let row = 0; row < moduleCount; row += 1) {
				modules[row] = new Array(moduleCount);
				for (let col = 0; col < moduleCount; col += 1) modules[row][col] = null;
			}
			return modules;
		}(_moduleCount);
		setupPositionProbePattern(0, 0);
		setupPositionProbePattern(_moduleCount - 7, 0);
		setupPositionProbePattern(0, _moduleCount - 7);
		setupPositionAdjustPattern();
		setupTimingPattern();
		setupTypeInfo(test, maskPattern);
		if (_typeNumber >= 7) setupTypeNumber(test);
		if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
		mapData(_dataCache, maskPattern);
	};
	const setupPositionProbePattern = function(row, col) {
		for (let r = -1; r <= 7; r += 1) {
			if (row + r <= -1 || _moduleCount <= row + r) continue;
			for (let c = -1; c <= 7; c += 1) {
				if (col + c <= -1 || _moduleCount <= col + c) continue;
				if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) _modules[row + r][col + c] = true;
				else _modules[row + r][col + c] = false;
			}
		}
	};
	const getBestMaskPattern = function() {
		let minLostPoint = 0;
		let pattern = 0;
		for (let i = 0; i < 8; i += 1) {
			makeImpl(true, i);
			const lostPoint = QRUtil.getLostPoint(_this);
			if (i == 0 || minLostPoint > lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
		return pattern;
	};
	const setupTimingPattern = function() {
		for (let r = 8; r < _moduleCount - 8; r += 1) {
			if (_modules[r][6] != null) continue;
			_modules[r][6] = r % 2 == 0;
		}
		for (let c = 8; c < _moduleCount - 8; c += 1) {
			if (_modules[6][c] != null) continue;
			_modules[6][c] = c % 2 == 0;
		}
	};
	const setupPositionAdjustPattern = function() {
		const pos = QRUtil.getPatternPosition(_typeNumber);
		for (let i = 0; i < pos.length; i += 1) for (let j = 0; j < pos.length; j += 1) {
			const row = pos[i];
			const col = pos[j];
			if (_modules[row][col] != null) continue;
			for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) _modules[row + r][col + c] = true;
			else _modules[row + r][col + c] = false;
		}
	};
	const setupTypeNumber = function(test) {
		const bits = QRUtil.getBCHTypeNumber(_typeNumber);
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
		}
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
		}
	};
	const setupTypeInfo = function(test, maskPattern) {
		const data = _errorCorrectionLevel << 3 | maskPattern;
		const bits = QRUtil.getBCHTypeInfo(data);
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 6) _modules[i][8] = mod;
			else if (i < 8) _modules[i + 1][8] = mod;
			else _modules[_moduleCount - 15 + i][8] = mod;
		}
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
			else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
			else _modules[8][15 - i - 1] = mod;
		}
		_modules[_moduleCount - 8][8] = !test;
	};
	const mapData = function(data, maskPattern) {
		let inc = -1;
		let row = _moduleCount - 1;
		let bitIndex = 7;
		let byteIndex = 0;
		const maskFunc = QRUtil.getMaskFunction(maskPattern);
		for (let col = _moduleCount - 1; col > 0; col -= 2) {
			if (col == 6) col -= 1;
			while (true) {
				for (let c = 0; c < 2; c += 1) if (_modules[row][col - c] == null) {
					let dark = false;
					if (byteIndex < data.length) dark = (data[byteIndex] >>> bitIndex & 1) == 1;
					if (maskFunc(row, col - c)) dark = !dark;
					_modules[row][col - c] = dark;
					bitIndex -= 1;
					if (bitIndex == -1) {
						byteIndex += 1;
						bitIndex = 7;
					}
				}
				row += inc;
				if (row < 0 || _moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
	};
	const createBytes = function(buffer, rsBlocks) {
		let offset = 0;
		let maxDcCount = 0;
		let maxEcCount = 0;
		const dcdata = new Array(rsBlocks.length);
		const ecdata = new Array(rsBlocks.length);
		for (let r = 0; r < rsBlocks.length; r += 1) {
			const dcCount = rsBlocks[r].dataCount;
			const ecCount = rsBlocks[r].totalCount - dcCount;
			maxDcCount = Math.max(maxDcCount, dcCount);
			maxEcCount = Math.max(maxEcCount, ecCount);
			dcdata[r] = new Array(dcCount);
			for (let i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
			offset += dcCount;
			const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
			const modPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1).mod(rsPoly);
			ecdata[r] = new Array(rsPoly.getLength() - 1);
			for (let i = 0; i < ecdata[r].length; i += 1) {
				const modIndex = i + modPoly.getLength() - ecdata[r].length;
				ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
			}
		}
		let totalCodeCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalCodeCount += rsBlocks[i].totalCount;
		const data = new Array(totalCodeCount);
		let index = 0;
		for (let i = 0; i < maxDcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < dcdata[r].length) {
			data[index] = dcdata[r][i];
			index += 1;
		}
		for (let i = 0; i < maxEcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < ecdata[r].length) {
			data[index] = ecdata[r][i];
			index += 1;
		}
		return data;
	};
	const createData = function(typeNumber, errorCorrectionLevel, dataList) {
		const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
		const buffer = qrBitBuffer();
		for (let i = 0; i < dataList.length; i += 1) {
			const data = dataList[i];
			buffer.put(data.getMode(), 4);
			buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
			data.write(buffer);
		}
		let totalDataCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
		if (buffer.getLengthInBits() > totalDataCount * 8) throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
		if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
		while (buffer.getLengthInBits() % 8 != 0) buffer.putBit(false);
		while (true) {
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD0, 8);
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD1, 8);
		}
		return createBytes(buffer, rsBlocks);
	};
	_this.addData = function(data, mode) {
		mode = mode || "Byte";
		let newData = null;
		switch (mode) {
			case "Numeric":
				newData = qrNumber(data);
				break;
			case "Alphanumeric":
				newData = qrAlphaNum(data);
				break;
			case "Byte":
				newData = qr8BitByte(data);
				break;
			case "Kanji":
				newData = qrKanji(data);
				break;
			default: throw "mode:" + mode;
		}
		_dataList.push(newData);
		_dataCache = null;
	};
	_this.isDark = function(row, col) {
		if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw row + "," + col;
		return _modules[row][col];
	};
	_this.getModuleCount = function() {
		return _moduleCount;
	};
	_this.make = function() {
		if (_typeNumber < 1) {
			let typeNumber = 1;
			for (; typeNumber < 40; typeNumber++) {
				const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
				const buffer = qrBitBuffer();
				for (let i = 0; i < _dataList.length; i++) {
					const data = _dataList[i];
					buffer.put(data.getMode(), 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
					data.write(buffer);
				}
				let totalDataCount = 0;
				for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
				if (buffer.getLengthInBits() <= totalDataCount * 8) break;
			}
			_typeNumber = typeNumber;
		}
		makeImpl(false, getBestMaskPattern());
	};
	_this.createTableTag = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		let qrHtml = "";
		qrHtml += "<table style=\"";
		qrHtml += " border-width: 0px; border-style: none;";
		qrHtml += " border-collapse: collapse;";
		qrHtml += " padding: 0px; margin: " + margin + "px;";
		qrHtml += "\">";
		qrHtml += "<tbody>";
		for (let r = 0; r < _this.getModuleCount(); r += 1) {
			qrHtml += "<tr>";
			for (let c = 0; c < _this.getModuleCount(); c += 1) {
				qrHtml += "<td style=\"";
				qrHtml += " border-width: 0px; border-style: none;";
				qrHtml += " border-collapse: collapse;";
				qrHtml += " padding: 0px; margin: 0px;";
				qrHtml += " width: " + cellSize + "px;";
				qrHtml += " height: " + cellSize + "px;";
				qrHtml += " background-color: ";
				qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
				qrHtml += ";";
				qrHtml += "\"/>";
			}
			qrHtml += "</tr>";
		}
		qrHtml += "</tbody>";
		qrHtml += "</table>";
		return qrHtml;
	};
	_this.createSvgTag = function(cellSize, margin, alt, title) {
		let opts = {};
		if (typeof arguments[0] == "object") {
			opts = arguments[0];
			cellSize = opts.cellSize;
			margin = opts.margin;
			alt = opts.alt;
			title = opts.title;
		}
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		alt = typeof alt === "string" ? { text: alt } : alt || {};
		alt.text = alt.text || null;
		alt.id = alt.text ? alt.id || "qrcode-description" : null;
		title = typeof title === "string" ? { text: title } : title || {};
		title.text = title.text || null;
		title.id = title.text ? title.id || "qrcode-title" : null;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let c, mc, r, mr, qrSvg = "", rect;
		rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
		qrSvg += "<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\"";
		qrSvg += !opts.scalable ? " width=\"" + size + "px\" height=\"" + size + "px\"" : "";
		qrSvg += " viewBox=\"0 0 " + size + " " + size + "\" ";
		qrSvg += " preserveAspectRatio=\"xMinYMin meet\"";
		qrSvg += title.text || alt.text ? " role=\"img\" aria-labelledby=\"" + escapeXml([title.id, alt.id].join(" ").trim()) + "\"" : "";
		qrSvg += ">";
		qrSvg += title.text ? "<title id=\"" + escapeXml(title.id) + "\">" + escapeXml(title.text) + "</title>" : "";
		qrSvg += alt.text ? "<description id=\"" + escapeXml(alt.id) + "\">" + escapeXml(alt.text) + "</description>" : "";
		qrSvg += "<rect width=\"100%\" height=\"100%\" fill=\"white\" cx=\"0\" cy=\"0\"/>";
		qrSvg += "<path d=\"";
		for (r = 0; r < _this.getModuleCount(); r += 1) {
			mr = r * cellSize + margin;
			for (c = 0; c < _this.getModuleCount(); c += 1) if (_this.isDark(r, c)) {
				mc = c * cellSize + margin;
				qrSvg += "M" + mc + "," + mr + rect;
			}
		}
		qrSvg += "\" stroke=\"transparent\" fill=\"black\"/>";
		qrSvg += "</svg>";
		return qrSvg;
	};
	_this.createDataURL = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		return createDataURL(size, size, function(x, y) {
			if (min <= x && x < max && min <= y && y < max) {
				const c = Math.floor((x - min) / cellSize);
				const r = Math.floor((y - min) / cellSize);
				return _this.isDark(r, c) ? 0 : 1;
			} else return 1;
		});
	};
	_this.createImgTag = function(cellSize, margin, alt) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let img = "";
		img += "<img";
		img += " src=\"";
		img += _this.createDataURL(cellSize, margin);
		img += "\"";
		img += " width=\"";
		img += size;
		img += "\"";
		img += " height=\"";
		img += size;
		img += "\"";
		if (alt) {
			img += " alt=\"";
			img += escapeXml(alt);
			img += "\"";
		}
		img += "/>";
		return img;
	};
	const escapeXml = function(s) {
		let escaped = "";
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charAt(i);
			switch (c) {
				case "<":
					escaped += "&lt;";
					break;
				case ">":
					escaped += "&gt;";
					break;
				case "&":
					escaped += "&amp;";
					break;
				case "\"":
					escaped += "&quot;";
					break;
				default:
					escaped += c;
					break;
			}
		}
		return escaped;
	};
	const _createHalfASCII = function(margin) {
		const cellSize = 1;
		margin = typeof margin == "undefined" ? cellSize * 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r1, r2, p;
		const blocks = {
			"██": "█",
			"█ ": "▀",
			" █": "▄",
			"  ": " "
		};
		const blocksLastLineNoMargin = {
			"██": "▀",
			"█ ": "▀",
			" █": " ",
			"  ": " "
		};
		let ascii = "";
		for (y = 0; y < size; y += 2) {
			r1 = Math.floor((y - min) / cellSize);
			r2 = Math.floor((y + 1 - min) / cellSize);
			for (x = 0; x < size; x += 1) {
				p = "█";
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) p = " ";
				if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) p += " ";
				else p += "█";
				ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
			}
			ascii += "\n";
		}
		if (size % 2 && margin > 0) return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
		return ascii.substring(0, ascii.length - 1);
	};
	_this.createASCII = function(cellSize, margin) {
		cellSize = cellSize || 1;
		if (cellSize < 2) return _createHalfASCII(margin);
		cellSize -= 1;
		margin = typeof margin == "undefined" ? cellSize * 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r, p;
		const white = Array(cellSize + 1).join("██");
		const black = Array(cellSize + 1).join("  ");
		let ascii = "";
		let line = "";
		for (y = 0; y < size; y += 1) {
			r = Math.floor((y - min) / cellSize);
			line = "";
			for (x = 0; x < size; x += 1) {
				p = 1;
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) p = 0;
				line += p ? white : black;
			}
			for (r = 0; r < cellSize; r += 1) ascii += line + "\n";
		}
		return ascii.substring(0, ascii.length - 1);
	};
	_this.renderTo2dContext = function(context, cellSize) {
		cellSize = cellSize || 2;
		const length = _this.getModuleCount();
		for (let row = 0; row < length; row++) for (let col = 0; col < length; col++) {
			context.fillStyle = _this.isDark(row, col) ? "black" : "white";
			context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
		}
	};
	return _this;
};
qrcode.stringToBytes = function(s) {
	const bytes = [];
	for (let i = 0; i < s.length; i += 1) {
		const c = s.charCodeAt(i);
		bytes.push(c & 255);
	}
	return bytes;
};
/**
* @param unicodeData base64 string of byte array.
* [16bit Unicode],[16bit Bytes], ...
* @param numChars
*/
qrcode.createStringToBytes = function(unicodeData, numChars) {
	const unicodeMap = function() {
		const bin = base64DecodeInputStream(unicodeData);
		const read = function() {
			const b = bin.read();
			if (b == -1) throw "eof";
			return b;
		};
		let count = 0;
		const unicodeMap = {};
		while (true) {
			const b0 = bin.read();
			if (b0 == -1) break;
			const b1 = read();
			const b2 = read();
			const b3 = read();
			const k = String.fromCharCode(b0 << 8 | b1);
			unicodeMap[k] = b2 << 8 | b3;
			count += 1;
		}
		if (count != numChars) throw count + " != " + numChars;
		return unicodeMap;
	}();
	const unknownChar = "?".charCodeAt(0);
	return function(s) {
		const bytes = [];
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charCodeAt(i);
			if (c < 128) bytes.push(c);
			else {
				const b = unicodeMap[s.charAt(i)];
				if (typeof b == "number") if ((b & 255) == b) bytes.push(b);
				else {
					bytes.push(b >>> 8);
					bytes.push(b & 255);
				}
				else bytes.push(unknownChar);
			}
		}
		return bytes;
	};
};
var QRMode = {
	MODE_NUMBER: 1,
	MODE_ALPHA_NUM: 2,
	MODE_8BIT_BYTE: 4,
	MODE_KANJI: 8
};
var QRErrorCorrectionLevel = {
	L: 1,
	M: 0,
	Q: 3,
	H: 2
};
var QRMaskPattern = {
	PATTERN000: 0,
	PATTERN001: 1,
	PATTERN010: 2,
	PATTERN011: 3,
	PATTERN100: 4,
	PATTERN101: 5,
	PATTERN110: 6,
	PATTERN111: 7
};
var QRUtil = function() {
	const PATTERN_POSITION_TABLE = [
		[],
		[6, 18],
		[6, 22],
		[6, 26],
		[6, 30],
		[6, 34],
		[
			6,
			22,
			38
		],
		[
			6,
			24,
			42
		],
		[
			6,
			26,
			46
		],
		[
			6,
			28,
			50
		],
		[
			6,
			30,
			54
		],
		[
			6,
			32,
			58
		],
		[
			6,
			34,
			62
		],
		[
			6,
			26,
			46,
			66
		],
		[
			6,
			26,
			48,
			70
		],
		[
			6,
			26,
			50,
			74
		],
		[
			6,
			30,
			54,
			78
		],
		[
			6,
			30,
			56,
			82
		],
		[
			6,
			30,
			58,
			86
		],
		[
			6,
			34,
			62,
			90
		],
		[
			6,
			28,
			50,
			72,
			94
		],
		[
			6,
			26,
			50,
			74,
			98
		],
		[
			6,
			30,
			54,
			78,
			102
		],
		[
			6,
			28,
			54,
			80,
			106
		],
		[
			6,
			32,
			58,
			84,
			110
		],
		[
			6,
			30,
			58,
			86,
			114
		],
		[
			6,
			34,
			62,
			90,
			118
		],
		[
			6,
			26,
			50,
			74,
			98,
			122
		],
		[
			6,
			30,
			54,
			78,
			102,
			126
		],
		[
			6,
			26,
			52,
			78,
			104,
			130
		],
		[
			6,
			30,
			56,
			82,
			108,
			134
		],
		[
			6,
			34,
			60,
			86,
			112,
			138
		],
		[
			6,
			30,
			58,
			86,
			114,
			142
		],
		[
			6,
			34,
			62,
			90,
			118,
			146
		],
		[
			6,
			30,
			54,
			78,
			102,
			126,
			150
		],
		[
			6,
			24,
			50,
			76,
			102,
			128,
			154
		],
		[
			6,
			28,
			54,
			80,
			106,
			132,
			158
		],
		[
			6,
			32,
			58,
			84,
			110,
			136,
			162
		],
		[
			6,
			26,
			54,
			82,
			110,
			138,
			166
		],
		[
			6,
			30,
			58,
			86,
			114,
			142,
			170
		]
	];
	const G15 = 1335;
	const G18 = 7973;
	const G15_MASK = 21522;
	const _this = {};
	const getBCHDigit = function(data) {
		let digit = 0;
		while (data != 0) {
			digit += 1;
			data >>>= 1;
		}
		return digit;
	};
	_this.getBCHTypeInfo = function(data) {
		let d = data << 10;
		while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
		return (data << 10 | d) ^ G15_MASK;
	};
	_this.getBCHTypeNumber = function(data) {
		let d = data << 12;
		while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
		return data << 12 | d;
	};
	_this.getPatternPosition = function(typeNumber) {
		return PATTERN_POSITION_TABLE[typeNumber - 1];
	};
	_this.getMaskFunction = function(maskPattern) {
		switch (maskPattern) {
			case QRMaskPattern.PATTERN000: return function(i, j) {
				return (i + j) % 2 == 0;
			};
			case QRMaskPattern.PATTERN001: return function(i, j) {
				return i % 2 == 0;
			};
			case QRMaskPattern.PATTERN010: return function(i, j) {
				return j % 3 == 0;
			};
			case QRMaskPattern.PATTERN011: return function(i, j) {
				return (i + j) % 3 == 0;
			};
			case QRMaskPattern.PATTERN100: return function(i, j) {
				return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
			};
			case QRMaskPattern.PATTERN101: return function(i, j) {
				return i * j % 2 + i * j % 3 == 0;
			};
			case QRMaskPattern.PATTERN110: return function(i, j) {
				return (i * j % 2 + i * j % 3) % 2 == 0;
			};
			case QRMaskPattern.PATTERN111: return function(i, j) {
				return (i * j % 3 + (i + j) % 2) % 2 == 0;
			};
			default: throw "bad maskPattern:" + maskPattern;
		}
	};
	_this.getErrorCorrectPolynomial = function(errorCorrectLength) {
		let a = qrPolynomial([1], 0);
		for (let i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
		return a;
	};
	_this.getLengthInBits = function(mode, type) {
		if (1 <= type && type < 10) switch (mode) {
			case QRMode.MODE_NUMBER: return 10;
			case QRMode.MODE_ALPHA_NUM: return 9;
			case QRMode.MODE_8BIT_BYTE: return 8;
			case QRMode.MODE_KANJI: return 8;
			default: throw "mode:" + mode;
		}
		else if (type < 27) switch (mode) {
			case QRMode.MODE_NUMBER: return 12;
			case QRMode.MODE_ALPHA_NUM: return 11;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 10;
			default: throw "mode:" + mode;
		}
		else if (type < 41) switch (mode) {
			case QRMode.MODE_NUMBER: return 14;
			case QRMode.MODE_ALPHA_NUM: return 13;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 12;
			default: throw "mode:" + mode;
		}
		else throw "type:" + type;
	};
	_this.getLostPoint = function(qrcode) {
		const moduleCount = qrcode.getModuleCount();
		let lostPoint = 0;
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount; col += 1) {
			let sameCount = 0;
			const dark = qrcode.isDark(row, col);
			for (let r = -1; r <= 1; r += 1) {
				if (row + r < 0 || moduleCount <= row + r) continue;
				for (let c = -1; c <= 1; c += 1) {
					if (col + c < 0 || moduleCount <= col + c) continue;
					if (r == 0 && c == 0) continue;
					if (dark == qrcode.isDark(row + r, col + c)) sameCount += 1;
				}
			}
			if (sameCount > 5) lostPoint += 3 + sameCount - 5;
		}
		for (let row = 0; row < moduleCount - 1; row += 1) for (let col = 0; col < moduleCount - 1; col += 1) {
			let count = 0;
			if (qrcode.isDark(row, col)) count += 1;
			if (qrcode.isDark(row + 1, col)) count += 1;
			if (qrcode.isDark(row, col + 1)) count += 1;
			if (qrcode.isDark(row + 1, col + 1)) count += 1;
			if (count == 0 || count == 4) lostPoint += 3;
		}
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount - 6; col += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5) && qrcode.isDark(row, col + 6)) lostPoint += 40;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount - 6; row += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col) && qrcode.isDark(row + 6, col)) lostPoint += 40;
		let darkCount = 0;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount; row += 1) if (qrcode.isDark(row, col)) darkCount += 1;
		const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
		lostPoint += ratio * 10;
		return lostPoint;
	};
	return _this;
}();
var QRMath = function() {
	const EXP_TABLE = new Array(256);
	const LOG_TABLE = new Array(256);
	for (let i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
	for (let i = 8; i < 256; i += 1) EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
	for (let i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;
	const _this = {};
	_this.glog = function(n) {
		if (n < 1) throw "glog(" + n + ")";
		return LOG_TABLE[n];
	};
	_this.gexp = function(n) {
		while (n < 0) n += 255;
		while (n >= 256) n -= 255;
		return EXP_TABLE[n];
	};
	return _this;
}();
var qrPolynomial = function(num, shift) {
	if (typeof num.length == "undefined") throw num.length + "/" + shift;
	const _num = function() {
		let offset = 0;
		while (offset < num.length && num[offset] == 0) offset += 1;
		const _num = new Array(num.length - offset + shift);
		for (let i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];
		return _num;
	}();
	const _this = {};
	_this.getAt = function(index) {
		return _num[index];
	};
	_this.getLength = function() {
		return _num.length;
	};
	_this.multiply = function(e) {
		const num = new Array(_this.getLength() + e.getLength() - 1);
		for (let i = 0; i < _this.getLength(); i += 1) for (let j = 0; j < e.getLength(); j += 1) num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
		return qrPolynomial(num, 0);
	};
	_this.mod = function(e) {
		if (_this.getLength() - e.getLength() < 0) return _this;
		const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
		const num = new Array(_this.getLength());
		for (let i = 0; i < _this.getLength(); i += 1) num[i] = _this.getAt(i);
		for (let i = 0; i < e.getLength(); i += 1) num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
		return qrPolynomial(num, 0).mod(e);
	};
	return _this;
};
var QRRSBlock = function() {
	const RS_BLOCK_TABLE = [
		[
			1,
			26,
			19
		],
		[
			1,
			26,
			16
		],
		[
			1,
			26,
			13
		],
		[
			1,
			26,
			9
		],
		[
			1,
			44,
			34
		],
		[
			1,
			44,
			28
		],
		[
			1,
			44,
			22
		],
		[
			1,
			44,
			16
		],
		[
			1,
			70,
			55
		],
		[
			1,
			70,
			44
		],
		[
			2,
			35,
			17
		],
		[
			2,
			35,
			13
		],
		[
			1,
			100,
			80
		],
		[
			2,
			50,
			32
		],
		[
			2,
			50,
			24
		],
		[
			4,
			25,
			9
		],
		[
			1,
			134,
			108
		],
		[
			2,
			67,
			43
		],
		[
			2,
			33,
			15,
			2,
			34,
			16
		],
		[
			2,
			33,
			11,
			2,
			34,
			12
		],
		[
			2,
			86,
			68
		],
		[
			4,
			43,
			27
		],
		[
			4,
			43,
			19
		],
		[
			4,
			43,
			15
		],
		[
			2,
			98,
			78
		],
		[
			4,
			49,
			31
		],
		[
			2,
			32,
			14,
			4,
			33,
			15
		],
		[
			4,
			39,
			13,
			1,
			40,
			14
		],
		[
			2,
			121,
			97
		],
		[
			2,
			60,
			38,
			2,
			61,
			39
		],
		[
			4,
			40,
			18,
			2,
			41,
			19
		],
		[
			4,
			40,
			14,
			2,
			41,
			15
		],
		[
			2,
			146,
			116
		],
		[
			3,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			36,
			16,
			4,
			37,
			17
		],
		[
			4,
			36,
			12,
			4,
			37,
			13
		],
		[
			2,
			86,
			68,
			2,
			87,
			69
		],
		[
			4,
			69,
			43,
			1,
			70,
			44
		],
		[
			6,
			43,
			19,
			2,
			44,
			20
		],
		[
			6,
			43,
			15,
			2,
			44,
			16
		],
		[
			4,
			101,
			81
		],
		[
			1,
			80,
			50,
			4,
			81,
			51
		],
		[
			4,
			50,
			22,
			4,
			51,
			23
		],
		[
			3,
			36,
			12,
			8,
			37,
			13
		],
		[
			2,
			116,
			92,
			2,
			117,
			93
		],
		[
			6,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			46,
			20,
			6,
			47,
			21
		],
		[
			7,
			42,
			14,
			4,
			43,
			15
		],
		[
			4,
			133,
			107
		],
		[
			8,
			59,
			37,
			1,
			60,
			38
		],
		[
			8,
			44,
			20,
			4,
			45,
			21
		],
		[
			12,
			33,
			11,
			4,
			34,
			12
		],
		[
			3,
			145,
			115,
			1,
			146,
			116
		],
		[
			4,
			64,
			40,
			5,
			65,
			41
		],
		[
			11,
			36,
			16,
			5,
			37,
			17
		],
		[
			11,
			36,
			12,
			5,
			37,
			13
		],
		[
			5,
			109,
			87,
			1,
			110,
			88
		],
		[
			5,
			65,
			41,
			5,
			66,
			42
		],
		[
			5,
			54,
			24,
			7,
			55,
			25
		],
		[
			11,
			36,
			12,
			7,
			37,
			13
		],
		[
			5,
			122,
			98,
			1,
			123,
			99
		],
		[
			7,
			73,
			45,
			3,
			74,
			46
		],
		[
			15,
			43,
			19,
			2,
			44,
			20
		],
		[
			3,
			45,
			15,
			13,
			46,
			16
		],
		[
			1,
			135,
			107,
			5,
			136,
			108
		],
		[
			10,
			74,
			46,
			1,
			75,
			47
		],
		[
			1,
			50,
			22,
			15,
			51,
			23
		],
		[
			2,
			42,
			14,
			17,
			43,
			15
		],
		[
			5,
			150,
			120,
			1,
			151,
			121
		],
		[
			9,
			69,
			43,
			4,
			70,
			44
		],
		[
			17,
			50,
			22,
			1,
			51,
			23
		],
		[
			2,
			42,
			14,
			19,
			43,
			15
		],
		[
			3,
			141,
			113,
			4,
			142,
			114
		],
		[
			3,
			70,
			44,
			11,
			71,
			45
		],
		[
			17,
			47,
			21,
			4,
			48,
			22
		],
		[
			9,
			39,
			13,
			16,
			40,
			14
		],
		[
			3,
			135,
			107,
			5,
			136,
			108
		],
		[
			3,
			67,
			41,
			13,
			68,
			42
		],
		[
			15,
			54,
			24,
			5,
			55,
			25
		],
		[
			15,
			43,
			15,
			10,
			44,
			16
		],
		[
			4,
			144,
			116,
			4,
			145,
			117
		],
		[
			17,
			68,
			42
		],
		[
			17,
			50,
			22,
			6,
			51,
			23
		],
		[
			19,
			46,
			16,
			6,
			47,
			17
		],
		[
			2,
			139,
			111,
			7,
			140,
			112
		],
		[
			17,
			74,
			46
		],
		[
			7,
			54,
			24,
			16,
			55,
			25
		],
		[
			34,
			37,
			13
		],
		[
			4,
			151,
			121,
			5,
			152,
			122
		],
		[
			4,
			75,
			47,
			14,
			76,
			48
		],
		[
			11,
			54,
			24,
			14,
			55,
			25
		],
		[
			16,
			45,
			15,
			14,
			46,
			16
		],
		[
			6,
			147,
			117,
			4,
			148,
			118
		],
		[
			6,
			73,
			45,
			14,
			74,
			46
		],
		[
			11,
			54,
			24,
			16,
			55,
			25
		],
		[
			30,
			46,
			16,
			2,
			47,
			17
		],
		[
			8,
			132,
			106,
			4,
			133,
			107
		],
		[
			8,
			75,
			47,
			13,
			76,
			48
		],
		[
			7,
			54,
			24,
			22,
			55,
			25
		],
		[
			22,
			45,
			15,
			13,
			46,
			16
		],
		[
			10,
			142,
			114,
			2,
			143,
			115
		],
		[
			19,
			74,
			46,
			4,
			75,
			47
		],
		[
			28,
			50,
			22,
			6,
			51,
			23
		],
		[
			33,
			46,
			16,
			4,
			47,
			17
		],
		[
			8,
			152,
			122,
			4,
			153,
			123
		],
		[
			22,
			73,
			45,
			3,
			74,
			46
		],
		[
			8,
			53,
			23,
			26,
			54,
			24
		],
		[
			12,
			45,
			15,
			28,
			46,
			16
		],
		[
			3,
			147,
			117,
			10,
			148,
			118
		],
		[
			3,
			73,
			45,
			23,
			74,
			46
		],
		[
			4,
			54,
			24,
			31,
			55,
			25
		],
		[
			11,
			45,
			15,
			31,
			46,
			16
		],
		[
			7,
			146,
			116,
			7,
			147,
			117
		],
		[
			21,
			73,
			45,
			7,
			74,
			46
		],
		[
			1,
			53,
			23,
			37,
			54,
			24
		],
		[
			19,
			45,
			15,
			26,
			46,
			16
		],
		[
			5,
			145,
			115,
			10,
			146,
			116
		],
		[
			19,
			75,
			47,
			10,
			76,
			48
		],
		[
			15,
			54,
			24,
			25,
			55,
			25
		],
		[
			23,
			45,
			15,
			25,
			46,
			16
		],
		[
			13,
			145,
			115,
			3,
			146,
			116
		],
		[
			2,
			74,
			46,
			29,
			75,
			47
		],
		[
			42,
			54,
			24,
			1,
			55,
			25
		],
		[
			23,
			45,
			15,
			28,
			46,
			16
		],
		[
			17,
			145,
			115
		],
		[
			10,
			74,
			46,
			23,
			75,
			47
		],
		[
			10,
			54,
			24,
			35,
			55,
			25
		],
		[
			19,
			45,
			15,
			35,
			46,
			16
		],
		[
			17,
			145,
			115,
			1,
			146,
			116
		],
		[
			14,
			74,
			46,
			21,
			75,
			47
		],
		[
			29,
			54,
			24,
			19,
			55,
			25
		],
		[
			11,
			45,
			15,
			46,
			46,
			16
		],
		[
			13,
			145,
			115,
			6,
			146,
			116
		],
		[
			14,
			74,
			46,
			23,
			75,
			47
		],
		[
			44,
			54,
			24,
			7,
			55,
			25
		],
		[
			59,
			46,
			16,
			1,
			47,
			17
		],
		[
			12,
			151,
			121,
			7,
			152,
			122
		],
		[
			12,
			75,
			47,
			26,
			76,
			48
		],
		[
			39,
			54,
			24,
			14,
			55,
			25
		],
		[
			22,
			45,
			15,
			41,
			46,
			16
		],
		[
			6,
			151,
			121,
			14,
			152,
			122
		],
		[
			6,
			75,
			47,
			34,
			76,
			48
		],
		[
			46,
			54,
			24,
			10,
			55,
			25
		],
		[
			2,
			45,
			15,
			64,
			46,
			16
		],
		[
			17,
			152,
			122,
			4,
			153,
			123
		],
		[
			29,
			74,
			46,
			14,
			75,
			47
		],
		[
			49,
			54,
			24,
			10,
			55,
			25
		],
		[
			24,
			45,
			15,
			46,
			46,
			16
		],
		[
			4,
			152,
			122,
			18,
			153,
			123
		],
		[
			13,
			74,
			46,
			32,
			75,
			47
		],
		[
			48,
			54,
			24,
			14,
			55,
			25
		],
		[
			42,
			45,
			15,
			32,
			46,
			16
		],
		[
			20,
			147,
			117,
			4,
			148,
			118
		],
		[
			40,
			75,
			47,
			7,
			76,
			48
		],
		[
			43,
			54,
			24,
			22,
			55,
			25
		],
		[
			10,
			45,
			15,
			67,
			46,
			16
		],
		[
			19,
			148,
			118,
			6,
			149,
			119
		],
		[
			18,
			75,
			47,
			31,
			76,
			48
		],
		[
			34,
			54,
			24,
			34,
			55,
			25
		],
		[
			20,
			45,
			15,
			61,
			46,
			16
		]
	];
	const qrRSBlock = function(totalCount, dataCount) {
		const _this = {};
		_this.totalCount = totalCount;
		_this.dataCount = dataCount;
		return _this;
	};
	const _this = {};
	const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
		switch (errorCorrectionLevel) {
			case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
			case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
			case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
			case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
			default: return;
		}
	};
	_this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
		const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
		if (typeof rsBlock == "undefined") throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
		const length = rsBlock.length / 3;
		const list = [];
		for (let i = 0; i < length; i += 1) {
			const count = rsBlock[i * 3 + 0];
			const totalCount = rsBlock[i * 3 + 1];
			const dataCount = rsBlock[i * 3 + 2];
			for (let j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount));
		}
		return list;
	};
	return _this;
}();
var qrBitBuffer = function() {
	const _buffer = [];
	let _length = 0;
	const _this = {};
	_this.getBuffer = function() {
		return _buffer;
	};
	_this.getAt = function(index) {
		return (_buffer[Math.floor(index / 8)] >>> 7 - index % 8 & 1) == 1;
	};
	_this.put = function(num, length) {
		for (let i = 0; i < length; i += 1) _this.putBit((num >>> length - i - 1 & 1) == 1);
	};
	_this.getLengthInBits = function() {
		return _length;
	};
	_this.putBit = function(bit) {
		const bufIndex = Math.floor(_length / 8);
		if (_buffer.length <= bufIndex) _buffer.push(0);
		if (bit) _buffer[bufIndex] |= 128 >>> _length % 8;
		_length += 1;
	};
	return _this;
};
var qrNumber = function(data) {
	const _mode = QRMode.MODE_NUMBER;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const data = _data;
		let i = 0;
		while (i + 2 < data.length) {
			buffer.put(strToNum(data.substring(i, i + 3)), 10);
			i += 3;
		}
		if (i < data.length) {
			if (data.length - i == 1) buffer.put(strToNum(data.substring(i, i + 1)), 4);
			else if (data.length - i == 2) buffer.put(strToNum(data.substring(i, i + 2)), 7);
		}
	};
	const strToNum = function(s) {
		let num = 0;
		for (let i = 0; i < s.length; i += 1) num = num * 10 + chatToNum(s.charAt(i));
		return num;
	};
	const chatToNum = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		throw "illegal char :" + c;
	};
	return _this;
};
var qrAlphaNum = function(data) {
	const _mode = QRMode.MODE_ALPHA_NUM;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const s = _data;
		let i = 0;
		while (i + 1 < s.length) {
			buffer.put(getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)), 11);
			i += 2;
		}
		if (i < s.length) buffer.put(getCode(s.charAt(i)), 6);
	};
	const getCode = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		else if ("A" <= c && c <= "Z") return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
		else switch (c) {
			case " ": return 36;
			case "$": return 37;
			case "%": return 38;
			case "*": return 39;
			case "+": return 40;
			case "-": return 41;
			case ".": return 42;
			case "/": return 43;
			case ":": return 44;
			default: throw "illegal char :" + c;
		}
	};
	return _this;
};
var qr8BitByte = function(data) {
	const _mode = QRMode.MODE_8BIT_BYTE;
	const _bytes = qrcode.stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _bytes.length;
	};
	_this.write = function(buffer) {
		for (let i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8);
	};
	return _this;
};
var qrKanji = function(data) {
	const _mode = QRMode.MODE_KANJI;
	const stringToBytes = qrcode.stringToBytes;
	(function(c, code) {
		const test = stringToBytes(c);
		if (test.length != 2 || (test[0] << 8 | test[1]) != code) throw "sjis not supported.";
	})("友", 38726);
	const _bytes = stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return ~~(_bytes.length / 2);
	};
	_this.write = function(buffer) {
		const data = _bytes;
		let i = 0;
		while (i + 1 < data.length) {
			let c = (255 & data[i]) << 8 | 255 & data[i + 1];
			if (33088 <= c && c <= 40956) c -= 33088;
			else if (57408 <= c && c <= 60351) c -= 49472;
			else throw "illegal char at " + (i + 1) + "/" + c;
			c = (c >>> 8 & 255) * 192 + (c & 255);
			buffer.put(c, 13);
			i += 2;
		}
		if (i < data.length) throw "illegal char at " + (i + 1);
	};
	return _this;
};
var byteArrayOutputStream = function() {
	const _bytes = [];
	const _this = {};
	_this.writeByte = function(b) {
		_bytes.push(b & 255);
	};
	_this.writeShort = function(i) {
		_this.writeByte(i);
		_this.writeByte(i >>> 8);
	};
	_this.writeBytes = function(b, off, len) {
		off = off || 0;
		len = len || b.length;
		for (let i = 0; i < len; i += 1) _this.writeByte(b[i + off]);
	};
	_this.writeString = function(s) {
		for (let i = 0; i < s.length; i += 1) _this.writeByte(s.charCodeAt(i));
	};
	_this.toByteArray = function() {
		return _bytes;
	};
	_this.toString = function() {
		let s = "";
		s += "[";
		for (let i = 0; i < _bytes.length; i += 1) {
			if (i > 0) s += ",";
			s += _bytes[i];
		}
		s += "]";
		return s;
	};
	return _this;
};
var base64EncodeOutputStream = function() {
	let _buffer = 0;
	let _buflen = 0;
	let _length = 0;
	let _base64 = "";
	const _this = {};
	const writeEncoded = function(b) {
		_base64 += String.fromCharCode(encode(b & 63));
	};
	const encode = function(n) {
		if (n < 0) throw "n:" + n;
		else if (n < 26) return 65 + n;
		else if (n < 52) return 97 + (n - 26);
		else if (n < 62) return 48 + (n - 52);
		else if (n == 62) return 43;
		else if (n == 63) return 47;
		else throw "n:" + n;
	};
	_this.writeByte = function(n) {
		_buffer = _buffer << 8 | n & 255;
		_buflen += 8;
		_length += 1;
		while (_buflen >= 6) {
			writeEncoded(_buffer >>> _buflen - 6);
			_buflen -= 6;
		}
	};
	_this.flush = function() {
		if (_buflen > 0) {
			writeEncoded(_buffer << 6 - _buflen);
			_buffer = 0;
			_buflen = 0;
		}
		if (_length % 3 != 0) {
			const padlen = 3 - _length % 3;
			for (let i = 0; i < padlen; i += 1) _base64 += "=";
		}
	};
	_this.toString = function() {
		return _base64;
	};
	return _this;
};
var base64DecodeInputStream = function(str) {
	const _str = str;
	let _pos = 0;
	let _buffer = 0;
	let _buflen = 0;
	const _this = {};
	_this.read = function() {
		while (_buflen < 8) {
			if (_pos >= _str.length) {
				if (_buflen == 0) return -1;
				throw "unexpected end of file./" + _buflen;
			}
			const c = _str.charAt(_pos);
			_pos += 1;
			if (c == "=") {
				_buflen = 0;
				return -1;
			} else if (c.match(/^\s$/)) continue;
			_buffer = _buffer << 6 | decode(c.charCodeAt(0));
			_buflen += 6;
		}
		const n = _buffer >>> _buflen - 8 & 255;
		_buflen -= 8;
		return n;
	};
	const decode = function(c) {
		if (65 <= c && c <= 90) return c - 65;
		else if (97 <= c && c <= 122) return c - 97 + 26;
		else if (48 <= c && c <= 57) return c - 48 + 52;
		else if (c == 43) return 62;
		else if (c == 47) return 63;
		else throw "c:" + c;
	};
	return _this;
};
var gifImage = function(width, height) {
	const _width = width;
	const _height = height;
	const _data = new Array(width * height);
	const _this = {};
	_this.setPixel = function(x, y, pixel) {
		_data[y * _width + x] = pixel;
	};
	_this.write = function(out) {
		out.writeString("GIF87a");
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(128);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(255);
		out.writeByte(255);
		out.writeByte(255);
		out.writeString(",");
		out.writeShort(0);
		out.writeShort(0);
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(0);
		const lzwMinCodeSize = 2;
		const raster = getLZWRaster(lzwMinCodeSize);
		out.writeByte(lzwMinCodeSize);
		let offset = 0;
		while (raster.length - offset > 255) {
			out.writeByte(255);
			out.writeBytes(raster, offset, 255);
			offset += 255;
		}
		out.writeByte(raster.length - offset);
		out.writeBytes(raster, offset, raster.length - offset);
		out.writeByte(0);
		out.writeString(";");
	};
	const bitOutputStream = function(out) {
		const _out = out;
		let _bitLength = 0;
		let _bitBuffer = 0;
		const _this = {};
		_this.write = function(data, length) {
			if (data >>> length != 0) throw "length over";
			while (_bitLength + length >= 8) {
				_out.writeByte(255 & (data << _bitLength | _bitBuffer));
				length -= 8 - _bitLength;
				data >>>= 8 - _bitLength;
				_bitBuffer = 0;
				_bitLength = 0;
			}
			_bitBuffer = data << _bitLength | _bitBuffer;
			_bitLength = _bitLength + length;
		};
		_this.flush = function() {
			if (_bitLength > 0) _out.writeByte(_bitBuffer);
		};
		return _this;
	};
	const getLZWRaster = function(lzwMinCodeSize) {
		const clearCode = 1 << lzwMinCodeSize;
		const endCode = (1 << lzwMinCodeSize) + 1;
		let bitLength = lzwMinCodeSize + 1;
		const table = lzwTable();
		for (let i = 0; i < clearCode; i += 1) table.add(String.fromCharCode(i));
		table.add(String.fromCharCode(clearCode));
		table.add(String.fromCharCode(endCode));
		const byteOut = byteArrayOutputStream();
		const bitOut = bitOutputStream(byteOut);
		bitOut.write(clearCode, bitLength);
		let dataIndex = 0;
		let s = String.fromCharCode(_data[dataIndex]);
		dataIndex += 1;
		while (dataIndex < _data.length) {
			const c = String.fromCharCode(_data[dataIndex]);
			dataIndex += 1;
			if (table.contains(s + c)) s = s + c;
			else {
				bitOut.write(table.indexOf(s), bitLength);
				if (table.size() < 4095) {
					if (table.size() == 1 << bitLength) bitLength += 1;
					table.add(s + c);
				}
				s = c;
			}
		}
		bitOut.write(table.indexOf(s), bitLength);
		bitOut.write(endCode, bitLength);
		bitOut.flush();
		return byteOut.toByteArray();
	};
	const lzwTable = function() {
		const _map = {};
		let _size = 0;
		const _this = {};
		_this.add = function(key) {
			if (_this.contains(key)) throw "dup key:" + key;
			_map[key] = _size;
			_size += 1;
		};
		_this.size = function() {
			return _size;
		};
		_this.indexOf = function(key) {
			return _map[key];
		};
		_this.contains = function(key) {
			return typeof _map[key] != "undefined";
		};
		return _this;
	};
	return _this;
};
var createDataURL = function(width, height, getPixel) {
	const gif = gifImage(width, height);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gif.setPixel(x, y, getPixel(x, y));
	const b = byteArrayOutputStream();
	gif.write(b);
	const base64 = base64EncodeOutputStream();
	const bytes = b.toByteArray();
	for (let i = 0; i < bytes.length; i += 1) base64.writeByte(bytes[i]);
	base64.flush();
	return "data:image/gif;base64," + base64;
};
qrcode.stringToBytes;
//#endregion
//#region src/qr.ts
var VERSION = 10;
var ECC_LEVEL = "L";
function assertCapacity(text) {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes > 260) throw new Error(`QR chunk too large (${bytes} bytes). Use smaller chunks.`);
}
function makeQr(text) {
	assertCapacity(text);
	const qr = qrcode(VERSION, ECC_LEVEL);
	qr.addData(text, "Byte");
	qr.make();
	return qr;
}
function escapeAttr(value) {
	return String(value ?? "").replace(/[&<>"]/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;"
	})[character]);
}
function qrSvg(text, { scale = 4, quiet = 4, title = "CarryOkie QR" } = {}) {
	const qr = makeQr(text);
	const moduleCount = qr.getModuleCount();
	const size = moduleCount + quiet * 2;
	const rects = [];
	for (let row = 0; row < moduleCount; row++) for (let col = 0; col < moduleCount; col++) if (qr.isDark(row, col)) rects.push(`<rect x="${col + quiet}" y="${row + quiet}" width="1" height="1"/>`);
	const pixelSize = size * scale;
	return `<svg class="qr" data-qr="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${pixelSize}" height="${pixelSize}" role="img" aria-label="${escapeAttr(title)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
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
var LOW_LATENCY_AUDIO_FMTP = "stereo=0;sprop-stereo=0;useinbandfec=1;ptime=10;maxptime=20";
function tuneAudioSenderForLowLatency(sender) {
	try {
		const parameters = sender.getParameters?.();
		if (!parameters) return;
		if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
		for (const encoding of parameters.encodings) {
			encoding.priority = "high";
			encoding.networkPriority = "high";
			encoding.maxBitrate = 96e3;
			encoding.dtx = "disabled";
		}
		sender.setParameters?.(parameters).catch(() => {});
	} catch {}
}
function preferLowLatencyAudioSdp(description) {
	if (!description.sdp || !/^v=0/m.test(description.sdp)) return description;
	const lines = description.sdp.split(/\r?\n/);
	const opusRtpmap = lines.find((line) => /a=rtpmap:(\d+) opus\/48000/i.test(line));
	const payload = opusRtpmap?.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
	if (!payload) return description;
	const fmtpPrefix = `a=fmtp:${payload} `;
	let added = false;
	const tuned = lines.map((line) => {
		if (!line.startsWith(fmtpPrefix)) return line;
		added = true;
		const existing = line.slice(fmtpPrefix.length);
		const params = /* @__PURE__ */ new Map();
		for (const part of existing.split(";")) {
			const token = part.trim();
			if (!token) continue;
			const [key, value] = token.split("=");
			params.set(key, value ?? true);
		}
		for (const part of LOW_LATENCY_AUDIO_FMTP.split(";")) {
			const [key, value] = part.split("=");
			params.set(key, value);
		}
		return `${fmtpPrefix}${[...params.entries()].map(([key, value]) => value === true ? key : `${key}=${value}`).join(";")}`;
	});
	if (!added) {
		const rtpmapIndex = tuned.findIndex((line) => line === opusRtpmap);
		tuned.splice(rtpmapIndex + 1, 0, `${fmtpPrefix}${LOW_LATENCY_AUDIO_FMTP}`);
	}
	return {
		...description,
		sdp: tuned.join("\r\n")
	};
}
async function setLowLatencyLocalDescription(pc, description) {
	await pc.setLocalDescription(preferLowLatencyAudioSdp(description));
}
var rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
var RPC = {
	ROOM_HELLO: "ROOM_HELLO",
	ROOM_STATE_SNAPSHOT: "ROOM_STATE_SNAPSHOT",
	PLAYER_JOINED: "PLAYER_JOINED",
	PLAYER_LEFT: "PLAYER_LEFT",
	QUEUE_ADD_REQUEST: "QUEUE_ADD_REQUEST",
	QUEUE_UPDATE_REQUEST: "QUEUE_UPDATE_REQUEST",
	QUEUE_START_REQUEST: "QUEUE_START_REQUEST",
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
	RECEIVER_PEER_READY: "RECEIVER_PEER_READY",
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
	clockRttMs;
	localStreams;
	relayedStreams;
	constructor(localPeerId) {
		super();
		this.localPeerId = localPeerId;
		this.peers = /* @__PURE__ */ new Map();
		this.clockOffsetMs = 0;
		this.clockRttMs = null;
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
			const sender = edge.pc.addTrack(track, stream);
			if (track.kind === "audio") tuneAudioSenderForLowLatency(sender);
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
			this.clockRttMs = t2 - msg.t0;
			this.clockOffsetMs = msg.h1 + this.clockRttMs / 2 - t2;
			this.emit("clock", {
				offsetMs: this.clockOffsetMs,
				rttMs: this.clockRttMs
			});
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
		const signalFromPeerId = typeof msg.fromPeerId === "string" ? msg.fromPeerId : remotePeerId;
		const viaPeerId = remotePeerId === signalFromPeerId ? null : remotePeerId;
		const edge = this.peers.get(signalFromPeerId) || this.makeConnection(signalFromPeerId, {
			manual: false,
			initiator: false
		});
		if (edge.pc.signalingState === "have-local-offer") await edge.pc.setLocalDescription({ type: "rollback" });
		await edge.pc.setRemoteDescription(this.signalDescription(msg));
		const answer = await edge.pc.createAnswer();
		await setLowLatencyLocalDescription(edge.pc, answer);
		await waitForIceComplete(edge.pc);
		const answerMsg = {
			type: RPC.SIGNAL_RELAY_ANSWER,
			fromPeerId: this.localPeerId,
			toPeerId: signalFromPeerId,
			signal: edge.pc.localDescription
		};
		this.send(viaPeerId || signalFromPeerId, answerMsg);
	}
	async acceptRenegotiationAnswer(remotePeerId, msg) {
		const signalFromPeerId = typeof msg.fromPeerId === "string" ? msg.fromPeerId : remotePeerId;
		const edge = this.peers.get(signalFromPeerId);
		if (!edge) throw new Error("No peer connection for renegotiation answer.");
		await edge.pc.setRemoteDescription(this.signalDescription(msg));
		clearTimeout(edge.negotiationTimer);
		edge.negotiating = false;
		if (edge.needsNegotiation) this.requestNegotiation(edge);
	}
	async createRelayedOffer(remotePeerId, viaPeerId) {
		if (remotePeerId === viaPeerId) throw new Error("Relayed offer needs a separate signaling peer.");
		const edge = this.makeConnection(remotePeerId, {
			manual: false,
			initiator: true,
			replace: false
		});
		const offer = await edge.pc.createOffer({ offerToReceiveAudio: true });
		await setLowLatencyLocalDescription(edge.pc, offer);
		await waitForIceComplete(edge.pc);
		this.send(viaPeerId, {
			type: RPC.SIGNAL_RELAY_OFFER,
			fromPeerId: this.localPeerId,
			toPeerId: remotePeerId,
			signal: edge.pc.localDescription
		});
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
			await setLowLatencyLocalDescription(edge.pc, offer);
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
		await setLowLatencyLocalDescription(edge.pc, offer);
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
		await setLowLatencyLocalDescription(edge.pc, answer);
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
var LOW_LATENCY_MIC_CONSTRAINTS = {
	echoCancellation: false,
	noiseSuppression: false,
	autoGainControl: false,
	channelCount: { ideal: 1 },
	sampleRate: { ideal: 48e3 },
	latency: {
		ideal: 0,
		max: .02
	}
};
var PhoneAudio = class {
	log;
	ctx;
	master;
	remoteGain;
	backingGain;
	localStream;
	publishedStream;
	pendingMicRequest;
	activeCaptureRequest;
	activeCaptureWaiters;
	activeCaptureConsumed;
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
		this.activeCaptureRequest = null;
		this.activeCaptureWaiters = 0;
		this.activeCaptureConsumed = false;
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
		this.ctx = this.ctx || new AudioContext({ latencyHint: "interactive" });
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
		const audioConstraints = LOW_LATENCY_MIC_CONSTRAINTS;
		try {
			this.localStream = await this.getUserMediaWithTimeout({
				audio: audioConstraints,
				video: false
			});
		} catch (error) {
			if (!isConstraintCompatibilityError(error)) throw error;
			this.log(`Mic request with ultra-low-latency karaoke constraints failed: ${error.message}. Retrying with basic audio.`);
			this.localStream = await this.getUserMediaWithTimeout({
				audio: true,
				video: false
			});
		}
		this.applyGate();
		this.buildMicFilterStream(this.localStream);
		this.publishedStream = this.localStream;
		this.setMicMuted(pushToSing);
		return this.publishedStream;
	}
	async getUserMediaWithTimeout(constraints, timeoutMs = 5e3) {
		let timer;
		if (!this.activeCaptureRequest) {
			this.activeCaptureConsumed = false;
			this.activeCaptureRequest = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
				if (this.activeCaptureWaiters === 0 && !this.activeCaptureConsumed) stream.getTracks().forEach((track) => track.stop());
				return stream;
			}).finally(() => {
				this.activeCaptureRequest = null;
				this.activeCaptureWaiters = 0;
				this.activeCaptureConsumed = false;
			});
		}
		this.activeCaptureWaiters += 1;
		try {
			const stream = await Promise.race([this.activeCaptureRequest, new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(/* @__PURE__ */ new Error("Microphone permission timed out. Check browser mic permission and try again."));
				}, timeoutMs);
			})]);
			this.activeCaptureConsumed = true;
			return stream;
		} finally {
			this.activeCaptureWaiters = Math.max(0, this.activeCaptureWaiters - 1);
			clearTimeout(timer);
		}
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
				const request = navigator.wakeLock.request("screen").then((lock) => {
					this.wakeLock = lock;
					return "active";
				});
				return await Promise.race([request, new Promise((resolve) => setTimeout(() => resolve("timeout"), 1e3))]);
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
function isConstraintCompatibilityError(error) {
	const name = error?.name;
	return name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError";
}
var singerWarning = "TV backing track bleed risk: your phone mic can hear the TV backing track. Use headphones or push-to-sing to avoid sending backing track to everyone.";
//#endregion
//#region node_modules/peerjs-js-binarypack/dist/binarypack.mjs
var $e8379818650e2442$export$93654d4f2d6cd524 = class {
	constructor() {
		this.encoder = new TextEncoder();
		this._pieces = [];
		this._parts = [];
	}
	append_buffer(data) {
		this.flush();
		this._parts.push(data);
	}
	append(data) {
		this._pieces.push(data);
	}
	flush() {
		if (this._pieces.length > 0) {
			const buf = new Uint8Array(this._pieces);
			this._parts.push(buf);
			this._pieces = [];
		}
	}
	toArrayBuffer() {
		const buffer = [];
		for (const part of this._parts) buffer.push(part);
		return $e8379818650e2442$var$concatArrayBuffers(buffer).buffer;
	}
};
function $e8379818650e2442$var$concatArrayBuffers(bufs) {
	let size = 0;
	for (const buf of bufs) size += buf.byteLength;
	const result = new Uint8Array(size);
	let offset = 0;
	for (const buf of bufs) {
		const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		result.set(view, offset);
		offset += buf.byteLength;
	}
	return result;
}
function $0cfd7828ad59115f$export$417857010dc9287f(data) {
	return new $0cfd7828ad59115f$var$Unpacker(data).unpack();
}
function $0cfd7828ad59115f$export$2a703dbb0cb35339(data) {
	const packer = new $0cfd7828ad59115f$export$b9ec4b114aa40074();
	const res = packer.pack(data);
	if (res instanceof Promise) return res.then(() => packer.getBuffer());
	return packer.getBuffer();
}
var $0cfd7828ad59115f$var$Unpacker = class {
	constructor(data) {
		this.index = 0;
		this.dataBuffer = data;
		this.dataView = new Uint8Array(this.dataBuffer);
		this.length = this.dataBuffer.byteLength;
	}
	unpack() {
		const type = this.unpack_uint8();
		if (type < 128) return type;
		else if ((type ^ 224) < 32) return (type ^ 224) - 32;
		let size;
		if ((size = type ^ 160) <= 15) return this.unpack_raw(size);
		else if ((size = type ^ 176) <= 15) return this.unpack_string(size);
		else if ((size = type ^ 144) <= 15) return this.unpack_array(size);
		else if ((size = type ^ 128) <= 15) return this.unpack_map(size);
		switch (type) {
			case 192: return null;
			case 193: return;
			case 194: return false;
			case 195: return true;
			case 202: return this.unpack_float();
			case 203: return this.unpack_double();
			case 204: return this.unpack_uint8();
			case 205: return this.unpack_uint16();
			case 206: return this.unpack_uint32();
			case 207: return this.unpack_uint64();
			case 208: return this.unpack_int8();
			case 209: return this.unpack_int16();
			case 210: return this.unpack_int32();
			case 211: return this.unpack_int64();
			case 212: return;
			case 213: return;
			case 214: return;
			case 215: return;
			case 216:
				size = this.unpack_uint16();
				return this.unpack_string(size);
			case 217:
				size = this.unpack_uint32();
				return this.unpack_string(size);
			case 218:
				size = this.unpack_uint16();
				return this.unpack_raw(size);
			case 219:
				size = this.unpack_uint32();
				return this.unpack_raw(size);
			case 220:
				size = this.unpack_uint16();
				return this.unpack_array(size);
			case 221:
				size = this.unpack_uint32();
				return this.unpack_array(size);
			case 222:
				size = this.unpack_uint16();
				return this.unpack_map(size);
			case 223:
				size = this.unpack_uint32();
				return this.unpack_map(size);
		}
	}
	unpack_uint8() {
		const byte = this.dataView[this.index] & 255;
		this.index++;
		return byte;
	}
	unpack_uint16() {
		const bytes = this.read(2);
		const uint16 = (bytes[0] & 255) * 256 + (bytes[1] & 255);
		this.index += 2;
		return uint16;
	}
	unpack_uint32() {
		const bytes = this.read(4);
		const uint32 = ((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3];
		this.index += 4;
		return uint32;
	}
	unpack_uint64() {
		const bytes = this.read(8);
		const uint64 = ((((((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]) * 256 + bytes[4]) * 256 + bytes[5]) * 256 + bytes[6]) * 256 + bytes[7];
		this.index += 8;
		return uint64;
	}
	unpack_int8() {
		const uint8 = this.unpack_uint8();
		return uint8 < 128 ? uint8 : uint8 - 256;
	}
	unpack_int16() {
		const uint16 = this.unpack_uint16();
		return uint16 < 32768 ? uint16 : uint16 - 65536;
	}
	unpack_int32() {
		const uint32 = this.unpack_uint32();
		return uint32 < 2 ** 31 ? uint32 : uint32 - 2 ** 32;
	}
	unpack_int64() {
		const uint64 = this.unpack_uint64();
		return uint64 < 2 ** 63 ? uint64 : uint64 - 2 ** 64;
	}
	unpack_raw(size) {
		if (this.length < this.index + size) throw new Error(`BinaryPackFailure: index is out of range ${this.index} ${size} ${this.length}`);
		const buf = this.dataBuffer.slice(this.index, this.index + size);
		this.index += size;
		return buf;
	}
	unpack_string(size) {
		const bytes = this.read(size);
		let i = 0;
		let str = "";
		let c;
		let code;
		while (i < size) {
			c = bytes[i];
			if (c < 160) {
				code = c;
				i++;
			} else if ((c ^ 192) < 32) {
				code = (c & 31) << 6 | bytes[i + 1] & 63;
				i += 2;
			} else if ((c ^ 224) < 16) {
				code = (c & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63;
				i += 3;
			} else {
				code = (c & 7) << 18 | (bytes[i + 1] & 63) << 12 | (bytes[i + 2] & 63) << 6 | bytes[i + 3] & 63;
				i += 4;
			}
			str += String.fromCodePoint(code);
		}
		this.index += size;
		return str;
	}
	unpack_array(size) {
		const objects = new Array(size);
		for (let i = 0; i < size; i++) objects[i] = this.unpack();
		return objects;
	}
	unpack_map(size) {
		const map = {};
		for (let i = 0; i < size; i++) {
			const key = this.unpack();
			map[key] = this.unpack();
		}
		return map;
	}
	unpack_float() {
		const uint32 = this.unpack_uint32();
		const sign = uint32 >> 31;
		const exp = (uint32 >> 23 & 255) - 127;
		const fraction = uint32 & 8388607 | 8388608;
		return (sign === 0 ? 1 : -1) * fraction * 2 ** (exp - 23);
	}
	unpack_double() {
		const h32 = this.unpack_uint32();
		const l32 = this.unpack_uint32();
		const sign = h32 >> 31;
		const exp = (h32 >> 20 & 2047) - 1023;
		const frac = (h32 & 1048575 | 1048576) * 2 ** (exp - 20) + l32 * 2 ** (exp - 52);
		return (sign === 0 ? 1 : -1) * frac;
	}
	read(length) {
		const j = this.index;
		if (j + length <= this.length) return this.dataView.subarray(j, j + length);
		else throw new Error("BinaryPackFailure: read index out of range");
	}
};
var $0cfd7828ad59115f$export$b9ec4b114aa40074 = class {
	getBuffer() {
		return this._bufferBuilder.toArrayBuffer();
	}
	pack(value) {
		if (typeof value === "string") this.pack_string(value);
		else if (typeof value === "number") if (Math.floor(value) === value) this.pack_integer(value);
		else this.pack_double(value);
		else if (typeof value === "boolean") {
			if (value === true) this._bufferBuilder.append(195);
			else if (value === false) this._bufferBuilder.append(194);
		} else if (value === void 0) this._bufferBuilder.append(192);
		else if (typeof value === "object") if (value === null) this._bufferBuilder.append(192);
		else {
			const constructor = value.constructor;
			if (value instanceof Array) {
				const res = this.pack_array(value);
				if (res instanceof Promise) return res.then(() => this._bufferBuilder.flush());
			} else if (value instanceof ArrayBuffer) this.pack_bin(new Uint8Array(value));
			else if ("BYTES_PER_ELEMENT" in value) {
				const v = value;
				this.pack_bin(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
			} else if (value instanceof Date) this.pack_string(value.toString());
			else if (value instanceof Blob) return value.arrayBuffer().then((buffer) => {
				this.pack_bin(new Uint8Array(buffer));
				this._bufferBuilder.flush();
			});
			else if (constructor == Object || constructor.toString().startsWith("class")) {
				const res = this.pack_object(value);
				if (res instanceof Promise) return res.then(() => this._bufferBuilder.flush());
			} else throw new Error(`Type "${constructor.toString()}" not yet supported`);
		}
		else throw new Error(`Type "${typeof value}" not yet supported`);
		this._bufferBuilder.flush();
	}
	pack_bin(blob) {
		const length = blob.length;
		if (length <= 15) this.pack_uint8(160 + length);
		else if (length <= 65535) {
			this._bufferBuilder.append(218);
			this.pack_uint16(length);
		} else if (length <= 4294967295) {
			this._bufferBuilder.append(219);
			this.pack_uint32(length);
		} else throw new Error("Invalid length");
		this._bufferBuilder.append_buffer(blob);
	}
	pack_string(str) {
		const encoded = this._textEncoder.encode(str);
		const length = encoded.length;
		if (length <= 15) this.pack_uint8(176 + length);
		else if (length <= 65535) {
			this._bufferBuilder.append(216);
			this.pack_uint16(length);
		} else if (length <= 4294967295) {
			this._bufferBuilder.append(217);
			this.pack_uint32(length);
		} else throw new Error("Invalid length");
		this._bufferBuilder.append_buffer(encoded);
	}
	pack_array(ary) {
		const length = ary.length;
		if (length <= 15) this.pack_uint8(144 + length);
		else if (length <= 65535) {
			this._bufferBuilder.append(220);
			this.pack_uint16(length);
		} else if (length <= 4294967295) {
			this._bufferBuilder.append(221);
			this.pack_uint32(length);
		} else throw new Error("Invalid length");
		const packNext = (index) => {
			if (index < length) {
				const res = this.pack(ary[index]);
				if (res instanceof Promise) return res.then(() => packNext(index + 1));
				return packNext(index + 1);
			}
		};
		return packNext(0);
	}
	pack_integer(num) {
		if (num >= -32 && num <= 127) this._bufferBuilder.append(num & 255);
		else if (num >= 0 && num <= 255) {
			this._bufferBuilder.append(204);
			this.pack_uint8(num);
		} else if (num >= -128 && num <= 127) {
			this._bufferBuilder.append(208);
			this.pack_int8(num);
		} else if (num >= 0 && num <= 65535) {
			this._bufferBuilder.append(205);
			this.pack_uint16(num);
		} else if (num >= -32768 && num <= 32767) {
			this._bufferBuilder.append(209);
			this.pack_int16(num);
		} else if (num >= 0 && num <= 4294967295) {
			this._bufferBuilder.append(206);
			this.pack_uint32(num);
		} else if (num >= -2147483648 && num <= 2147483647) {
			this._bufferBuilder.append(210);
			this.pack_int32(num);
		} else if (num >= -0x8000000000000000 && num <= 0x8000000000000000) {
			this._bufferBuilder.append(211);
			this.pack_int64(num);
		} else if (num >= 0 && num <= 0x10000000000000000) {
			this._bufferBuilder.append(207);
			this.pack_uint64(num);
		} else throw new Error("Invalid integer");
	}
	pack_double(num) {
		let sign = 0;
		if (num < 0) {
			sign = 1;
			num = -num;
		}
		const exp = Math.floor(Math.log(num) / Math.LN2);
		const frac0 = num / 2 ** exp - 1;
		const frac1 = Math.floor(frac0 * 2 ** 52);
		const b32 = 2 ** 32;
		const h32 = sign << 31 | exp + 1023 << 20 | frac1 / b32 & 1048575;
		const l32 = frac1 % b32;
		this._bufferBuilder.append(203);
		this.pack_int32(h32);
		this.pack_int32(l32);
	}
	pack_object(obj) {
		const keys = Object.keys(obj);
		const length = keys.length;
		if (length <= 15) this.pack_uint8(128 + length);
		else if (length <= 65535) {
			this._bufferBuilder.append(222);
			this.pack_uint16(length);
		} else if (length <= 4294967295) {
			this._bufferBuilder.append(223);
			this.pack_uint32(length);
		} else throw new Error("Invalid length");
		const packNext = (index) => {
			if (index < keys.length) {
				const prop = keys[index];
				if (obj.hasOwnProperty(prop)) {
					this.pack(prop);
					const res = this.pack(obj[prop]);
					if (res instanceof Promise) return res.then(() => packNext(index + 1));
				}
				return packNext(index + 1);
			}
		};
		return packNext(0);
	}
	pack_uint8(num) {
		this._bufferBuilder.append(num);
	}
	pack_uint16(num) {
		this._bufferBuilder.append(num >> 8);
		this._bufferBuilder.append(num & 255);
	}
	pack_uint32(num) {
		const n = num & 4294967295;
		this._bufferBuilder.append((n & 4278190080) >>> 24);
		this._bufferBuilder.append((n & 16711680) >>> 16);
		this._bufferBuilder.append((n & 65280) >>> 8);
		this._bufferBuilder.append(n & 255);
	}
	pack_uint64(num) {
		const high = num / 2 ** 32;
		const low = num % 2 ** 32;
		this._bufferBuilder.append((high & 4278190080) >>> 24);
		this._bufferBuilder.append((high & 16711680) >>> 16);
		this._bufferBuilder.append((high & 65280) >>> 8);
		this._bufferBuilder.append(high & 255);
		this._bufferBuilder.append((low & 4278190080) >>> 24);
		this._bufferBuilder.append((low & 16711680) >>> 16);
		this._bufferBuilder.append((low & 65280) >>> 8);
		this._bufferBuilder.append(low & 255);
	}
	pack_int8(num) {
		this._bufferBuilder.append(num & 255);
	}
	pack_int16(num) {
		this._bufferBuilder.append((num & 65280) >> 8);
		this._bufferBuilder.append(num & 255);
	}
	pack_int32(num) {
		this._bufferBuilder.append(num >>> 24 & 255);
		this._bufferBuilder.append((num & 16711680) >>> 16);
		this._bufferBuilder.append((num & 65280) >>> 8);
		this._bufferBuilder.append(num & 255);
	}
	pack_int64(num) {
		const high = Math.floor(num / 2 ** 32);
		const low = num % 2 ** 32;
		this._bufferBuilder.append((high & 4278190080) >>> 24);
		this._bufferBuilder.append((high & 16711680) >>> 16);
		this._bufferBuilder.append((high & 65280) >>> 8);
		this._bufferBuilder.append(high & 255);
		this._bufferBuilder.append((low & 4278190080) >>> 24);
		this._bufferBuilder.append((low & 16711680) >>> 16);
		this._bufferBuilder.append((low & 65280) >>> 8);
		this._bufferBuilder.append(low & 255);
	}
	constructor() {
		this._bufferBuilder = new $e8379818650e2442$export$93654d4f2d6cd524();
		this._textEncoder = new TextEncoder();
	}
};
//#endregion
//#region node_modules/webrtc-adapter/src/js/utils.js
var logDisabled_ = true;
var deprecationWarnings_ = true;
/**
* Extract browser version out of the provided user agent string.
*
* @param {!string} uastring userAgent string.
* @param {!string} expr Regular expression used as match criteria.
* @param {!number} pos position in the version string to be returned.
* @return {!number} browser version.
*/
function extractVersion(uastring, expr, pos) {
	const match = uastring.match(expr);
	return match && match.length >= pos && parseFloat(match[pos], 10);
}
function wrapPeerConnectionEvent(window, eventNameToWrap, wrapper) {
	if (!window.RTCPeerConnection) return;
	if (!Object.getOwnPropertyDescriptor(EventTarget.prototype, "addEventListener").writable) {
		log$1("Unable to polyfill events");
		return;
	}
	const proto = window.RTCPeerConnection.prototype;
	const nativeAddEventListener = proto.addEventListener;
	proto.addEventListener = function(nativeEventName, cb) {
		if (nativeEventName !== eventNameToWrap) return nativeAddEventListener.apply(this, arguments);
		const wrappedCallback = (e) => {
			const modifiedEvent = wrapper(e);
			if (modifiedEvent) if (cb.handleEvent) cb.handleEvent(modifiedEvent);
			else cb(modifiedEvent);
		};
		this._eventMap = this._eventMap || {};
		if (!this._eventMap[eventNameToWrap]) this._eventMap[eventNameToWrap] = /* @__PURE__ */ new Map();
		this._eventMap[eventNameToWrap].set(cb, wrappedCallback);
		return nativeAddEventListener.apply(this, [nativeEventName, wrappedCallback]);
	};
	const nativeRemoveEventListener = proto.removeEventListener;
	proto.removeEventListener = function(nativeEventName, cb) {
		if (nativeEventName !== eventNameToWrap || !this._eventMap || !this._eventMap[eventNameToWrap]) return nativeRemoveEventListener.apply(this, arguments);
		if (!this._eventMap[eventNameToWrap].has(cb)) return nativeRemoveEventListener.apply(this, arguments);
		const unwrappedCb = this._eventMap[eventNameToWrap].get(cb);
		this._eventMap[eventNameToWrap].delete(cb);
		if (this._eventMap[eventNameToWrap].size === 0) delete this._eventMap[eventNameToWrap];
		if (Object.keys(this._eventMap).length === 0) delete this._eventMap;
		return nativeRemoveEventListener.apply(this, [nativeEventName, unwrappedCb]);
	};
	Object.defineProperty(proto, "on" + eventNameToWrap, {
		get() {
			return this["_on" + eventNameToWrap];
		},
		set(cb) {
			if (this["_on" + eventNameToWrap]) {
				this.removeEventListener(eventNameToWrap, this["_on" + eventNameToWrap]);
				delete this["_on" + eventNameToWrap];
			}
			if (cb) this.addEventListener(eventNameToWrap, this["_on" + eventNameToWrap] = cb);
		},
		enumerable: true,
		configurable: true
	});
}
function disableLog(bool) {
	if (typeof bool !== "boolean") return /* @__PURE__ */ new Error("Argument type: " + typeof bool + ". Please use a boolean.");
	logDisabled_ = bool;
	return bool ? "adapter.js logging disabled" : "adapter.js logging enabled";
}
/**
* Disable or enable deprecation warnings
* @param {!boolean} bool set to true to disable warnings.
*/
function disableWarnings(bool) {
	if (typeof bool !== "boolean") return /* @__PURE__ */ new Error("Argument type: " + typeof bool + ". Please use a boolean.");
	deprecationWarnings_ = !bool;
	return "adapter.js deprecation warnings " + (bool ? "disabled" : "enabled");
}
function log$1() {
	if (typeof window === "object") {
		if (logDisabled_) return;
		if (typeof console !== "undefined" && typeof console.log === "function") console.log.apply(console, arguments);
	}
}
/**
* Shows a deprecation warning suggesting the modern and spec-compatible API.
*/
function deprecated(oldMethod, newMethod) {
	if (!deprecationWarnings_) return;
	console.warn(oldMethod + " is deprecated, please use " + newMethod + " instead.");
}
/**
* Browser detector.
*
* @return {object} result containing browser and version
*     properties.
*/
function detectBrowser(window) {
	const result = {
		browser: null,
		version: null
	};
	if (typeof window === "undefined" || !window.navigator || !window.navigator.userAgent) {
		result.browser = "Not a browser.";
		return result;
	}
	const { navigator } = window;
	if (navigator.userAgentData && navigator.userAgentData.brands) {
		const chromium = navigator.userAgentData.brands.find((brand) => {
			return brand.brand === "Chromium";
		});
		if (chromium) return {
			browser: "chrome",
			version: parseInt(chromium.version, 10)
		};
	}
	if (navigator.mozGetUserMedia) {
		result.browser = "firefox";
		result.version = parseInt(extractVersion(navigator.userAgent, /Firefox\/(\d+)\./, 1));
	} else if (navigator.webkitGetUserMedia || window.isSecureContext === false && window.webkitRTCPeerConnection) {
		result.browser = "chrome";
		result.version = parseInt(extractVersion(navigator.userAgent, /Chrom(e|ium)\/(\d+)\./, 2)) || null;
	} else if (window.RTCPeerConnection && navigator.userAgent.match(/AppleWebKit\/(\d+)\./)) {
		result.browser = "safari";
		result.version = parseInt(extractVersion(navigator.userAgent, /AppleWebKit\/(\d+)\./, 1));
		result.supportsUnifiedPlan = window.RTCRtpTransceiver && "currentDirection" in window.RTCRtpTransceiver.prototype;
		result._safariVersion = extractVersion(navigator.userAgent, /Version\/(\d+(\.?\d+))/, 1);
	} else {
		result.browser = "Not a supported browser.";
		return result;
	}
	return result;
}
/**
* Checks if something is an object.
*
* @param {*} val The something you want to check.
* @return true if val is an object, false otherwise.
*/
function isObject(val) {
	return Object.prototype.toString.call(val) === "[object Object]";
}
/**
* Remove all empty objects and undefined values
* from a nested object -- an enhanced and vanilla version
* of Lodash's `compact`.
*/
function compactObject(data) {
	if (!isObject(data)) return data;
	return Object.keys(data).reduce(function(accumulator, key) {
		const isObj = isObject(data[key]);
		const value = isObj ? compactObject(data[key]) : data[key];
		const isEmptyObject = isObj && !Object.keys(value).length;
		if (value === void 0 || isEmptyObject) return accumulator;
		return Object.assign(accumulator, { [key]: value });
	}, {});
}
function walkStats(stats, base, resultSet) {
	if (!base || resultSet.has(base.id)) return;
	resultSet.set(base.id, base);
	Object.keys(base).forEach((name) => {
		if (name.endsWith("Id")) walkStats(stats, stats.get(base[name]), resultSet);
		else if (name.endsWith("Ids")) base[name].forEach((id) => {
			walkStats(stats, stats.get(id), resultSet);
		});
	});
}
function filterStats(result, track, outbound) {
	const streamStatsType = outbound ? "outbound-rtp" : "inbound-rtp";
	const filteredResult = /* @__PURE__ */ new Map();
	if (track === null) return filteredResult;
	const trackStats = [];
	result.forEach((value) => {
		if (value.type === "track" && value.trackIdentifier === track.id) trackStats.push(value);
	});
	trackStats.forEach((trackStat) => {
		result.forEach((stats) => {
			if (stats.type === streamStatsType && stats.trackId === trackStat.id) walkStats(result, stats, filteredResult);
		});
	});
	return filteredResult;
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/chrome/getusermedia.js
var logging = log$1;
function shimGetUserMedia$2(window, browserDetails) {
	const navigator = window && window.navigator;
	if (!navigator.mediaDevices) return;
	const constraintsToChrome_ = function(c) {
		if (typeof c !== "object" || c.mandatory || c.optional) return c;
		const cc = {};
		Object.keys(c).forEach((key) => {
			if (key === "require" || key === "advanced" || key === "mediaSource") return;
			const r = typeof c[key] === "object" ? c[key] : { ideal: c[key] };
			if (r.exact !== void 0 && typeof r.exact === "number") r.min = r.max = r.exact;
			const oldname_ = function(prefix, name) {
				if (prefix) return prefix + name.charAt(0).toUpperCase() + name.slice(1);
				return name === "deviceId" ? "sourceId" : name;
			};
			if (r.ideal !== void 0) {
				cc.optional = cc.optional || [];
				let oc = {};
				if (typeof r.ideal === "number") {
					oc[oldname_("min", key)] = r.ideal;
					cc.optional.push(oc);
					oc = {};
					oc[oldname_("max", key)] = r.ideal;
					cc.optional.push(oc);
				} else {
					oc[oldname_("", key)] = r.ideal;
					cc.optional.push(oc);
				}
			}
			if (r.exact !== void 0 && typeof r.exact !== "number") {
				cc.mandatory = cc.mandatory || {};
				cc.mandatory[oldname_("", key)] = r.exact;
			} else ["min", "max"].forEach((mix) => {
				if (r[mix] !== void 0) {
					cc.mandatory = cc.mandatory || {};
					cc.mandatory[oldname_(mix, key)] = r[mix];
				}
			});
		});
		if (c.advanced) cc.optional = (cc.optional || []).concat(c.advanced);
		return cc;
	};
	const shimConstraints_ = function(constraints, func) {
		if (browserDetails.version >= 61) return func(constraints);
		constraints = JSON.parse(JSON.stringify(constraints));
		if (constraints && typeof constraints.audio === "object") {
			const remap = function(obj, a, b) {
				if (a in obj && !(b in obj)) {
					obj[b] = obj[a];
					delete obj[a];
				}
			};
			constraints = JSON.parse(JSON.stringify(constraints));
			remap(constraints.audio, "autoGainControl", "googAutoGainControl");
			remap(constraints.audio, "noiseSuppression", "googNoiseSuppression");
			constraints.audio = constraintsToChrome_(constraints.audio);
		}
		if (constraints && typeof constraints.video === "object") {
			let face = constraints.video.facingMode;
			face = face && (typeof face === "object" ? face : { ideal: face });
			const getSupportedFacingModeLies = browserDetails.version < 66;
			if (face && (face.exact === "user" || face.exact === "environment" || face.ideal === "user" || face.ideal === "environment") && !(navigator.mediaDevices.getSupportedConstraints && navigator.mediaDevices.getSupportedConstraints().facingMode && !getSupportedFacingModeLies)) {
				delete constraints.video.facingMode;
				let matches;
				if (face.exact === "environment" || face.ideal === "environment") matches = ["back", "rear"];
				else if (face.exact === "user" || face.ideal === "user") matches = ["front"];
				if (matches) return navigator.mediaDevices.enumerateDevices().then((devices) => {
					devices = devices.filter((d) => d.kind === "videoinput");
					let dev = devices.find((d) => matches.some((match) => d.label.toLowerCase().includes(match)));
					if (!dev && devices.length && matches.includes("back")) dev = devices[devices.length - 1];
					if (dev) constraints.video.deviceId = face.exact ? { exact: dev.deviceId } : { ideal: dev.deviceId };
					constraints.video = constraintsToChrome_(constraints.video);
					logging("chrome: " + JSON.stringify(constraints));
					return func(constraints);
				});
			}
			constraints.video = constraintsToChrome_(constraints.video);
		}
		logging("chrome: " + JSON.stringify(constraints));
		return func(constraints);
	};
	const shimError_ = function(e) {
		if (browserDetails.version >= 64) return e;
		return {
			name: {
				PermissionDeniedError: "NotAllowedError",
				PermissionDismissedError: "NotAllowedError",
				InvalidStateError: "NotAllowedError",
				DevicesNotFoundError: "NotFoundError",
				ConstraintNotSatisfiedError: "OverconstrainedError",
				TrackStartError: "NotReadableError",
				MediaDeviceFailedDueToShutdown: "NotAllowedError",
				MediaDeviceKillSwitchOn: "NotAllowedError",
				TabCaptureError: "AbortError",
				ScreenCaptureError: "AbortError",
				DeviceCaptureError: "AbortError"
			}[e.name] || e.name,
			message: e.message,
			constraint: e.constraint || e.constraintName,
			toString() {
				return this.name + (this.message && ": ") + this.message;
			}
		};
	};
	const getUserMedia_ = function(constraints, onSuccess, onError) {
		shimConstraints_(constraints, (c) => {
			navigator.webkitGetUserMedia(c, onSuccess, (e) => {
				if (onError) onError(shimError_(e));
			});
		});
	};
	navigator.getUserMedia = getUserMedia_.bind(navigator);
	if (navigator.mediaDevices.getUserMedia) {
		const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getUserMedia = function(cs) {
			return shimConstraints_(cs, (c) => origGetUserMedia(c).then((stream) => {
				if (c.audio && !stream.getAudioTracks().length || c.video && !stream.getVideoTracks().length) {
					stream.getTracks().forEach((track) => {
						track.stop();
					});
					throw new DOMException("", "NotFoundError");
				}
				return stream;
			}, (e) => Promise.reject(shimError_(e))));
		};
	}
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/chrome/chrome_shim.js
var chrome_shim_exports = /* @__PURE__ */ __exportAll({
	fixNegotiationNeeded: () => fixNegotiationNeeded,
	shimAddTrackRemoveTrack: () => shimAddTrackRemoveTrack,
	shimAddTrackRemoveTrackWithNative: () => shimAddTrackRemoveTrackWithNative,
	shimGetSendersWithDtmf: () => shimGetSendersWithDtmf,
	shimGetUserMedia: () => shimGetUserMedia$2,
	shimMediaStream: () => shimMediaStream,
	shimOnTrack: () => shimOnTrack$1,
	shimPeerConnection: () => shimPeerConnection$1,
	shimSenderReceiverGetStats: () => shimSenderReceiverGetStats
});
function shimMediaStream(window) {
	window.MediaStream = window.MediaStream || window.webkitMediaStream;
}
function shimOnTrack$1(window, browserDetails) {
	if (browserDetails.version > 102) return;
	if (typeof window === "object" && window.RTCPeerConnection && !("ontrack" in window.RTCPeerConnection.prototype)) {
		Object.defineProperty(window.RTCPeerConnection.prototype, "ontrack", {
			get() {
				return this._ontrack;
			},
			set(f) {
				if (this._ontrack) this.removeEventListener("track", this._ontrack);
				this.addEventListener("track", this._ontrack = f);
			},
			enumerable: true,
			configurable: true
		});
		const origSetRemoteDescription = window.RTCPeerConnection.prototype.setRemoteDescription;
		window.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
			if (!this._ontrackpoly) {
				this._ontrackpoly = (e) => {
					e.stream.addEventListener("addtrack", (te) => {
						let receiver;
						if (window.RTCPeerConnection.prototype.getReceivers) receiver = this.getReceivers().find((r) => r.track && r.track.id === te.track.id);
						else receiver = { track: te.track };
						const event = new Event("track");
						event.track = te.track;
						event.receiver = receiver;
						event.transceiver = { receiver };
						event.streams = [e.stream];
						this.dispatchEvent(event);
					});
					e.stream.getTracks().forEach((track) => {
						let receiver;
						if (window.RTCPeerConnection.prototype.getReceivers) receiver = this.getReceivers().find((r) => r.track && r.track.id === track.id);
						else receiver = { track };
						const event = new Event("track");
						event.track = track;
						event.receiver = receiver;
						event.transceiver = { receiver };
						event.streams = [e.stream];
						this.dispatchEvent(event);
					});
				};
				this.addEventListener("addstream", this._ontrackpoly);
			}
			return origSetRemoteDescription.apply(this, arguments);
		};
	} else wrapPeerConnectionEvent(window, "track", (e) => {
		if (!e.transceiver) Object.defineProperty(e, "transceiver", { value: { receiver: e.receiver } });
		return e;
	});
}
function shimGetSendersWithDtmf(window) {
	if (typeof window === "object" && window.RTCPeerConnection && !("getSenders" in window.RTCPeerConnection.prototype) && "createDTMFSender" in window.RTCPeerConnection.prototype) {
		const shimSenderWithDtmf = function(pc, track) {
			return {
				track,
				get dtmf() {
					if (this._dtmf === void 0) if (track.kind === "audio") this._dtmf = pc.createDTMFSender(track);
					else this._dtmf = null;
					return this._dtmf;
				},
				_pc: pc
			};
		};
		if (!window.RTCPeerConnection.prototype.getSenders) {
			window.RTCPeerConnection.prototype.getSenders = function getSenders() {
				this._senders = this._senders || [];
				return this._senders.slice();
			};
			const origAddTrack = window.RTCPeerConnection.prototype.addTrack;
			window.RTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
				let sender = origAddTrack.apply(this, arguments);
				if (!sender) {
					sender = shimSenderWithDtmf(this, track);
					this._senders.push(sender);
				}
				return sender;
			};
			const origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
			window.RTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
				origRemoveTrack.apply(this, arguments);
				const idx = this._senders.indexOf(sender);
				if (idx !== -1) this._senders.splice(idx, 1);
			};
		}
		const origAddStream = window.RTCPeerConnection.prototype.addStream;
		window.RTCPeerConnection.prototype.addStream = function addStream(stream) {
			this._senders = this._senders || [];
			origAddStream.apply(this, [stream]);
			stream.getTracks().forEach((track) => {
				this._senders.push(shimSenderWithDtmf(this, track));
			});
		};
		const origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
		window.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
			this._senders = this._senders || [];
			origRemoveStream.apply(this, [stream]);
			stream.getTracks().forEach((track) => {
				const sender = this._senders.find((s) => s.track === track);
				if (sender) this._senders.splice(this._senders.indexOf(sender), 1);
			});
		};
	} else if (typeof window === "object" && window.RTCPeerConnection && "getSenders" in window.RTCPeerConnection.prototype && "createDTMFSender" in window.RTCPeerConnection.prototype && window.RTCRtpSender && !("dtmf" in window.RTCRtpSender.prototype)) {
		const origGetSenders = window.RTCPeerConnection.prototype.getSenders;
		window.RTCPeerConnection.prototype.getSenders = function getSenders() {
			const senders = origGetSenders.apply(this, []);
			senders.forEach((sender) => sender._pc = this);
			return senders;
		};
		Object.defineProperty(window.RTCRtpSender.prototype, "dtmf", { get() {
			if (this._dtmf === void 0) if (this.track.kind === "audio") this._dtmf = this._pc.createDTMFSender(this.track);
			else this._dtmf = null;
			return this._dtmf;
		} });
	}
}
function shimSenderReceiverGetStats(window, browserDetails) {
	if (browserDetails.version >= 67) return;
	if (!(typeof window === "object" && window.RTCPeerConnection && window.RTCRtpSender && window.RTCRtpReceiver)) return;
	if (!("getStats" in window.RTCRtpSender.prototype)) {
		const origGetSenders = window.RTCPeerConnection.prototype.getSenders;
		if (origGetSenders) window.RTCPeerConnection.prototype.getSenders = function getSenders() {
			const senders = origGetSenders.apply(this, []);
			senders.forEach((sender) => sender._pc = this);
			return senders;
		};
		const origAddTrack = window.RTCPeerConnection.prototype.addTrack;
		if (origAddTrack) window.RTCPeerConnection.prototype.addTrack = function addTrack() {
			const sender = origAddTrack.apply(this, arguments);
			sender._pc = this;
			return sender;
		};
		window.RTCRtpSender.prototype.getStats = function getStats() {
			const sender = this;
			return this._pc.getStats().then((result) => filterStats(result, sender.track, true));
		};
	}
	if (!("getStats" in window.RTCRtpReceiver.prototype)) {
		const origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
		if (origGetReceivers) window.RTCPeerConnection.prototype.getReceivers = function getReceivers() {
			const receivers = origGetReceivers.apply(this, []);
			receivers.forEach((receiver) => receiver._pc = this);
			return receivers;
		};
		wrapPeerConnectionEvent(window, "track", (e) => {
			e.receiver._pc = e.srcElement;
			return e;
		});
		window.RTCRtpReceiver.prototype.getStats = function getStats() {
			const receiver = this;
			return this._pc.getStats().then((result) => filterStats(result, receiver.track, false));
		};
	}
	if (!("getStats" in window.RTCRtpSender.prototype && "getStats" in window.RTCRtpReceiver.prototype)) return;
	const origGetStats = window.RTCPeerConnection.prototype.getStats;
	window.RTCPeerConnection.prototype.getStats = function getStats() {
		if (arguments.length > 0 && arguments[0] instanceof window.MediaStreamTrack) {
			const track = arguments[0];
			let sender;
			let receiver;
			let err;
			this.getSenders().forEach((s) => {
				if (s.track === track) if (sender) err = true;
				else sender = s;
			});
			this.getReceivers().forEach((r) => {
				if (r.track === track) if (receiver) err = true;
				else receiver = r;
				return r.track === track;
			});
			if (err || sender && receiver) return Promise.reject(new DOMException("There are more than one sender or receiver for the track.", "InvalidAccessError"));
			else if (sender) return sender.getStats();
			else if (receiver) return receiver.getStats();
			return Promise.reject(new DOMException("There is no sender or receiver for the track.", "InvalidAccessError"));
		}
		return origGetStats.apply(this, arguments);
	};
}
function shimAddTrackRemoveTrackWithNative(window) {
	window.RTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
		this._shimmedLocalStreams = this._shimmedLocalStreams || {};
		return Object.keys(this._shimmedLocalStreams).map((streamId) => this._shimmedLocalStreams[streamId][0]);
	};
	const origAddTrack = window.RTCPeerConnection.prototype.addTrack;
	window.RTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
		if (!stream) return origAddTrack.apply(this, arguments);
		this._shimmedLocalStreams = this._shimmedLocalStreams || {};
		const sender = origAddTrack.apply(this, arguments);
		if (!this._shimmedLocalStreams[stream.id]) this._shimmedLocalStreams[stream.id] = [stream, sender];
		else if (this._shimmedLocalStreams[stream.id].indexOf(sender) === -1) this._shimmedLocalStreams[stream.id].push(sender);
		return sender;
	};
	const origAddStream = window.RTCPeerConnection.prototype.addStream;
	window.RTCPeerConnection.prototype.addStream = function addStream(stream) {
		this._shimmedLocalStreams = this._shimmedLocalStreams || {};
		stream.getTracks().forEach((track) => {
			if (this.getSenders().find((s) => s.track === track)) throw new DOMException("Track already exists.", "InvalidAccessError");
		});
		const existingSenders = this.getSenders();
		origAddStream.apply(this, arguments);
		const newSenders = this.getSenders().filter((newSender) => existingSenders.indexOf(newSender) === -1);
		this._shimmedLocalStreams[stream.id] = [stream].concat(newSenders);
	};
	const origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
	window.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
		this._shimmedLocalStreams = this._shimmedLocalStreams || {};
		delete this._shimmedLocalStreams[stream.id];
		return origRemoveStream.apply(this, arguments);
	};
	const origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
	window.RTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
		this._shimmedLocalStreams = this._shimmedLocalStreams || {};
		if (sender) Object.keys(this._shimmedLocalStreams).forEach((streamId) => {
			const idx = this._shimmedLocalStreams[streamId].indexOf(sender);
			if (idx !== -1) this._shimmedLocalStreams[streamId].splice(idx, 1);
			if (this._shimmedLocalStreams[streamId].length === 1) delete this._shimmedLocalStreams[streamId];
		});
		return origRemoveTrack.apply(this, arguments);
	};
}
function shimAddTrackRemoveTrack(window, browserDetails) {
	if (!window.RTCPeerConnection) return;
	if (window.RTCPeerConnection.prototype.addTrack && browserDetails.version >= 65) return shimAddTrackRemoveTrackWithNative(window);
	const origGetLocalStreams = window.RTCPeerConnection.prototype.getLocalStreams;
	window.RTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
		const nativeStreams = origGetLocalStreams.apply(this);
		this._reverseStreams = this._reverseStreams || {};
		return nativeStreams.map((stream) => this._reverseStreams[stream.id]);
	};
	const origAddStream = window.RTCPeerConnection.prototype.addStream;
	window.RTCPeerConnection.prototype.addStream = function addStream(stream) {
		this._streams = this._streams || {};
		this._reverseStreams = this._reverseStreams || {};
		stream.getTracks().forEach((track) => {
			if (this.getSenders().find((s) => s.track === track)) throw new DOMException("Track already exists.", "InvalidAccessError");
		});
		if (!this._reverseStreams[stream.id]) {
			const newStream = new window.MediaStream(stream.getTracks());
			this._streams[stream.id] = newStream;
			this._reverseStreams[newStream.id] = stream;
			stream = newStream;
		}
		origAddStream.apply(this, [stream]);
	};
	const origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
	window.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
		this._streams = this._streams || {};
		this._reverseStreams = this._reverseStreams || {};
		origRemoveStream.apply(this, [this._streams[stream.id] || stream]);
		delete this._reverseStreams[this._streams[stream.id] ? this._streams[stream.id].id : stream.id];
		delete this._streams[stream.id];
	};
	window.RTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
		if (this.signalingState === "closed") throw new DOMException("The RTCPeerConnection's signalingState is 'closed'.", "InvalidStateError");
		const streams = [].slice.call(arguments, 1);
		if (streams.length !== 1 || !streams[0].getTracks().find((t) => t === track)) throw new DOMException("The adapter.js addTrack polyfill only supports a single  stream which is associated with the specified track.", "NotSupportedError");
		if (this.getSenders().find((s) => s.track === track)) throw new DOMException("Track already exists.", "InvalidAccessError");
		this._streams = this._streams || {};
		this._reverseStreams = this._reverseStreams || {};
		const oldStream = this._streams[stream.id];
		if (oldStream) {
			oldStream.addTrack(track);
			Promise.resolve().then(() => {
				this.dispatchEvent(new Event("negotiationneeded"));
			});
		} else {
			const newStream = new window.MediaStream([track]);
			this._streams[stream.id] = newStream;
			this._reverseStreams[newStream.id] = stream;
			this.addStream(newStream);
		}
		return this.getSenders().find((s) => s.track === track);
	};
	function replaceInternalStreamId(pc, description) {
		let sdp = description.sdp;
		Object.keys(pc._reverseStreams || []).forEach((internalId) => {
			const externalStream = pc._reverseStreams[internalId];
			const internalStream = pc._streams[externalStream.id];
			sdp = sdp.replace(new RegExp(internalStream.id, "g"), externalStream.id);
		});
		return new RTCSessionDescription({
			type: description.type,
			sdp
		});
	}
	function replaceExternalStreamId(pc, description) {
		let sdp = description.sdp;
		Object.keys(pc._reverseStreams || []).forEach((internalId) => {
			const externalStream = pc._reverseStreams[internalId];
			const internalStream = pc._streams[externalStream.id];
			sdp = sdp.replace(new RegExp(externalStream.id, "g"), internalStream.id);
		});
		return new RTCSessionDescription({
			type: description.type,
			sdp
		});
	}
	["createOffer", "createAnswer"].forEach(function(method) {
		const nativeMethod = window.RTCPeerConnection.prototype[method];
		const methodObj = { [method]() {
			const args = arguments;
			if (arguments.length && typeof arguments[0] === "function") return nativeMethod.apply(this, [
				(description) => {
					const desc = replaceInternalStreamId(this, description);
					args[0].apply(null, [desc]);
				},
				(err) => {
					if (args[1]) args[1].apply(null, err);
				},
				arguments[2]
			]);
			return nativeMethod.apply(this, arguments).then((description) => replaceInternalStreamId(this, description));
		} };
		window.RTCPeerConnection.prototype[method] = methodObj[method];
	});
	const origSetLocalDescription = window.RTCPeerConnection.prototype.setLocalDescription;
	window.RTCPeerConnection.prototype.setLocalDescription = function setLocalDescription() {
		if (!arguments.length || !arguments[0].type) return origSetLocalDescription.apply(this, arguments);
		arguments[0] = replaceExternalStreamId(this, arguments[0]);
		return origSetLocalDescription.apply(this, arguments);
	};
	const origLocalDescription = Object.getOwnPropertyDescriptor(window.RTCPeerConnection.prototype, "localDescription");
	Object.defineProperty(window.RTCPeerConnection.prototype, "localDescription", { get() {
		const description = origLocalDescription.get.apply(this);
		if (description.type === "") return description;
		return replaceInternalStreamId(this, description);
	} });
	window.RTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
		if (this.signalingState === "closed") throw new DOMException("The RTCPeerConnection's signalingState is 'closed'.", "InvalidStateError");
		if (!sender._pc) throw new DOMException("Argument 1 of RTCPeerConnection.removeTrack does not implement interface RTCRtpSender.", "TypeError");
		if (!(sender._pc === this)) throw new DOMException("Sender was not created by this connection.", "InvalidAccessError");
		this._streams = this._streams || {};
		let stream;
		Object.keys(this._streams).forEach((streamid) => {
			if (this._streams[streamid].getTracks().find((track) => sender.track === track)) stream = this._streams[streamid];
		});
		if (stream) {
			if (stream.getTracks().length === 1) this.removeStream(this._reverseStreams[stream.id]);
			else stream.removeTrack(sender.track);
			this.dispatchEvent(new Event("negotiationneeded"));
		}
	};
}
function shimPeerConnection$1(window, browserDetails) {
	if (!window.RTCPeerConnection && window.webkitRTCPeerConnection) window.RTCPeerConnection = window.webkitRTCPeerConnection;
	if (!window.RTCPeerConnection) return;
	if (browserDetails.version < 53) [
		"setLocalDescription",
		"setRemoteDescription",
		"addIceCandidate"
	].forEach(function(method) {
		const nativeMethod = window.RTCPeerConnection.prototype[method];
		const methodObj = { [method]() {
			arguments[0] = new (method === "addIceCandidate" ? window.RTCIceCandidate : window.RTCSessionDescription)(arguments[0]);
			return nativeMethod.apply(this, arguments);
		} };
		window.RTCPeerConnection.prototype[method] = methodObj[method];
	});
}
function fixNegotiationNeeded(window, browserDetails) {
	if (browserDetails.version > 102) return;
	wrapPeerConnectionEvent(window, "negotiationneeded", (e) => {
		const pc = e.target;
		if (browserDetails.version < 72 || pc.getConfiguration && pc.getConfiguration().sdpSemantics === "plan-b") {
			if (pc.signalingState !== "stable") return;
		}
		return e;
	});
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/firefox/getusermedia.js
function shimGetUserMedia$1(window, browserDetails) {
	const navigator = window && window.navigator;
	const MediaStreamTrack = window && window.MediaStreamTrack;
	navigator.getUserMedia = function(constraints, onSuccess, onError) {
		deprecated("navigator.getUserMedia", "navigator.mediaDevices.getUserMedia");
		navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
	};
	if (!(browserDetails.version > 55 && "autoGainControl" in navigator.mediaDevices.getSupportedConstraints())) {
		const remap = function(obj, a, b) {
			if (a in obj && !(b in obj)) {
				obj[b] = obj[a];
				delete obj[a];
			}
		};
		const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getUserMedia = function(c) {
			if (typeof c === "object" && typeof c.audio === "object") {
				c = JSON.parse(JSON.stringify(c));
				remap(c.audio, "autoGainControl", "mozAutoGainControl");
				remap(c.audio, "noiseSuppression", "mozNoiseSuppression");
			}
			return nativeGetUserMedia(c);
		};
		if (MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
			const nativeGetSettings = MediaStreamTrack.prototype.getSettings;
			MediaStreamTrack.prototype.getSettings = function() {
				const obj = nativeGetSettings.apply(this, arguments);
				remap(obj, "mozAutoGainControl", "autoGainControl");
				remap(obj, "mozNoiseSuppression", "noiseSuppression");
				return obj;
			};
		}
		if (MediaStreamTrack && MediaStreamTrack.prototype.applyConstraints) {
			const nativeApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
			MediaStreamTrack.prototype.applyConstraints = function(c) {
				if (this.kind === "audio" && typeof c === "object") {
					c = JSON.parse(JSON.stringify(c));
					remap(c, "autoGainControl", "mozAutoGainControl");
					remap(c, "noiseSuppression", "mozNoiseSuppression");
				}
				return nativeApplyConstraints.apply(this, [c]);
			};
		}
	}
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/firefox/getdisplaymedia.js
function shimGetDisplayMedia(window, preferredMediaSource) {
	if (window.navigator.mediaDevices && "getDisplayMedia" in window.navigator.mediaDevices) return;
	if (!window.navigator.mediaDevices) return;
	window.navigator.mediaDevices.getDisplayMedia = function getDisplayMedia(constraints) {
		if (!(constraints && constraints.video)) {
			const err = new DOMException("getDisplayMedia without video constraints is undefined");
			err.name = "NotFoundError";
			err.code = 8;
			return Promise.reject(err);
		}
		if (constraints.video === true) constraints.video = { mediaSource: preferredMediaSource };
		else constraints.video.mediaSource = preferredMediaSource;
		return window.navigator.mediaDevices.getUserMedia(constraints);
	};
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/firefox/firefox_shim.js
var firefox_shim_exports = /* @__PURE__ */ __exportAll({
	shimAddTransceiver: () => shimAddTransceiver,
	shimCreateAnswer: () => shimCreateAnswer,
	shimCreateOffer: () => shimCreateOffer,
	shimGetDisplayMedia: () => shimGetDisplayMedia,
	shimGetParameters: () => shimGetParameters,
	shimGetStats: () => shimGetStats,
	shimGetUserMedia: () => shimGetUserMedia$1,
	shimOnTrack: () => shimOnTrack,
	shimPeerConnection: () => shimPeerConnection,
	shimRTCDataChannel: () => shimRTCDataChannel,
	shimReceiverGetStats: () => shimReceiverGetStats,
	shimRemoveStream: () => shimRemoveStream,
	shimSenderGetStats: () => shimSenderGetStats
});
function shimOnTrack(window) {
	if (typeof window === "object" && window.RTCTrackEvent && "receiver" in window.RTCTrackEvent.prototype && !("transceiver" in window.RTCTrackEvent.prototype)) Object.defineProperty(window.RTCTrackEvent.prototype, "transceiver", { get() {
		return { receiver: this.receiver };
	} });
}
function shimPeerConnection(window, browserDetails) {
	if (typeof window !== "object" || !(window.RTCPeerConnection || window.mozRTCPeerConnection)) return;
	if (!window.RTCPeerConnection && window.mozRTCPeerConnection) window.RTCPeerConnection = window.mozRTCPeerConnection;
	if (browserDetails.version < 53) [
		"setLocalDescription",
		"setRemoteDescription",
		"addIceCandidate"
	].forEach(function(method) {
		const nativeMethod = window.RTCPeerConnection.prototype[method];
		const methodObj = { [method]() {
			arguments[0] = new (method === "addIceCandidate" ? window.RTCIceCandidate : window.RTCSessionDescription)(arguments[0]);
			return nativeMethod.apply(this, arguments);
		} };
		window.RTCPeerConnection.prototype[method] = methodObj[method];
	});
}
function shimGetStats(window, browserDetails) {
	if (typeof window !== "object" || !(window.RTCPeerConnection || window.mozRTCPeerConnection)) return;
	if (browserDetails.version >= 151) return;
	const modernStatsTypes = {
		inboundrtp: "inbound-rtp",
		outboundrtp: "outbound-rtp",
		candidatepair: "candidate-pair",
		localcandidate: "local-candidate",
		remotecandidate: "remote-candidate"
	};
	const nativeGetStats = window.RTCPeerConnection.prototype.getStats;
	window.RTCPeerConnection.prototype.getStats = function getStats() {
		const [selector, onSucc, onErr] = arguments;
		if (this.signalingState === "closed") return Promise.resolve(/* @__PURE__ */ new Map());
		return nativeGetStats.apply(this, [selector || null]).then((stats) => {
			if (browserDetails.version < 53 && !onSucc) try {
				stats.forEach((stat) => {
					stat.type = modernStatsTypes[stat.type] || stat.type;
				});
			} catch (e) {
				if (e.name !== "TypeError") throw e;
				stats.forEach((stat, i) => {
					stats.set(i, Object.assign({}, stat, { type: modernStatsTypes[stat.type] || stat.type }));
				});
			}
			return stats;
		}).then(onSucc, onErr);
	};
}
function shimSenderGetStats(window) {
	if (!(typeof window === "object" && window.RTCPeerConnection && window.RTCRtpSender)) return;
	if (window.RTCRtpSender && "getStats" in window.RTCRtpSender.prototype) return;
	const origGetSenders = window.RTCPeerConnection.prototype.getSenders;
	if (origGetSenders) window.RTCPeerConnection.prototype.getSenders = function getSenders() {
		const senders = origGetSenders.apply(this, []);
		senders.forEach((sender) => sender._pc = this);
		return senders;
	};
	const origAddTrack = window.RTCPeerConnection.prototype.addTrack;
	if (origAddTrack) window.RTCPeerConnection.prototype.addTrack = function addTrack() {
		const sender = origAddTrack.apply(this, arguments);
		sender._pc = this;
		return sender;
	};
	window.RTCRtpSender.prototype.getStats = function getStats() {
		return this.track ? this._pc.getStats(this.track) : Promise.resolve(/* @__PURE__ */ new Map());
	};
}
function shimReceiverGetStats(window) {
	if (!(typeof window === "object" && window.RTCPeerConnection && window.RTCRtpSender)) return;
	if (window.RTCRtpSender && "getStats" in window.RTCRtpReceiver.prototype) return;
	const origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
	if (origGetReceivers) window.RTCPeerConnection.prototype.getReceivers = function getReceivers() {
		const receivers = origGetReceivers.apply(this, []);
		receivers.forEach((receiver) => receiver._pc = this);
		return receivers;
	};
	wrapPeerConnectionEvent(window, "track", (e) => {
		e.receiver._pc = e.srcElement;
		return e;
	});
	window.RTCRtpReceiver.prototype.getStats = function getStats() {
		return this._pc.getStats(this.track);
	};
}
function shimRemoveStream(window) {
	if (!window.RTCPeerConnection || "removeStream" in window.RTCPeerConnection.prototype) return;
	window.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
		deprecated("removeStream", "removeTrack");
		this.getSenders().forEach((sender) => {
			if (sender.track && stream.getTracks().includes(sender.track)) this.removeTrack(sender);
		});
	};
}
function shimRTCDataChannel(window) {
	if (window.DataChannel && !window.RTCDataChannel) window.RTCDataChannel = window.DataChannel;
}
function shimAddTransceiver(window) {
	if (!(typeof window === "object" && window.RTCPeerConnection)) return;
	const origAddTransceiver = window.RTCPeerConnection.prototype.addTransceiver;
	if (origAddTransceiver) window.RTCPeerConnection.prototype.addTransceiver = function addTransceiver() {
		this.setParametersPromises = [];
		let sendEncodings = arguments[1] && arguments[1].sendEncodings;
		if (sendEncodings === void 0) sendEncodings = [];
		sendEncodings = [...sendEncodings];
		const shouldPerformCheck = sendEncodings.length > 0;
		if (shouldPerformCheck) sendEncodings.forEach((encodingParam) => {
			if ("rid" in encodingParam) {
				if (!/^[a-z0-9]{0,16}$/i.test(encodingParam.rid)) throw new TypeError("Invalid RID value provided.");
			}
			if ("scaleResolutionDownBy" in encodingParam) {
				if (!(parseFloat(encodingParam.scaleResolutionDownBy) >= 1)) throw new RangeError("scale_resolution_down_by must be >= 1.0");
			}
			if ("maxFramerate" in encodingParam) {
				if (!(parseFloat(encodingParam.maxFramerate) >= 0)) throw new RangeError("max_framerate must be >= 0.0");
			}
		});
		const transceiver = origAddTransceiver.apply(this, arguments);
		if (shouldPerformCheck) {
			const { sender } = transceiver;
			const params = sender.getParameters();
			if (!("encodings" in params) || params.encodings.length === 1 && Object.keys(params.encodings[0]).length === 0) {
				params.encodings = sendEncodings;
				sender.sendEncodings = sendEncodings;
				this.setParametersPromises.push(sender.setParameters(params).then(() => {
					delete sender.sendEncodings;
				}).catch(() => {
					delete sender.sendEncodings;
				}));
			}
		}
		return transceiver;
	};
}
function shimGetParameters(window) {
	if (!(typeof window === "object" && window.RTCRtpSender)) return;
	const origGetParameters = window.RTCRtpSender.prototype.getParameters;
	if (origGetParameters) window.RTCRtpSender.prototype.getParameters = function getParameters() {
		const params = origGetParameters.apply(this, arguments);
		if (!("encodings" in params)) params.encodings = [].concat(this.sendEncodings || [{}]);
		return params;
	};
}
function shimCreateOffer(window) {
	if (!(typeof window === "object" && window.RTCPeerConnection)) return;
	const origCreateOffer = window.RTCPeerConnection.prototype.createOffer;
	window.RTCPeerConnection.prototype.createOffer = function createOffer() {
		if (this.setParametersPromises && this.setParametersPromises.length) return Promise.all(this.setParametersPromises).then(() => {
			return origCreateOffer.apply(this, arguments);
		}).finally(() => {
			this.setParametersPromises = [];
		});
		return origCreateOffer.apply(this, arguments);
	};
}
function shimCreateAnswer(window) {
	if (!(typeof window === "object" && window.RTCPeerConnection)) return;
	const origCreateAnswer = window.RTCPeerConnection.prototype.createAnswer;
	window.RTCPeerConnection.prototype.createAnswer = function createAnswer() {
		if (this.setParametersPromises && this.setParametersPromises.length) return Promise.all(this.setParametersPromises).then(() => {
			return origCreateAnswer.apply(this, arguments);
		}).finally(() => {
			this.setParametersPromises = [];
		});
		return origCreateAnswer.apply(this, arguments);
	};
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/safari/safari_shim.js
var safari_shim_exports = /* @__PURE__ */ __exportAll({
	shimAudioContext: () => shimAudioContext,
	shimCallbacksAPI: () => shimCallbacksAPI,
	shimConstraints: () => shimConstraints,
	shimCreateOfferLegacy: () => shimCreateOfferLegacy,
	shimGetUserMedia: () => shimGetUserMedia,
	shimLocalStreamsAPI: () => shimLocalStreamsAPI,
	shimRTCIceServerUrls: () => shimRTCIceServerUrls,
	shimRemoteStreamsAPI: () => shimRemoteStreamsAPI,
	shimTrackEventTransceiver: () => shimTrackEventTransceiver
});
function shimLocalStreamsAPI(window) {
	if (typeof window !== "object" || !window.RTCPeerConnection) return;
	if (!("getLocalStreams" in window.RTCPeerConnection.prototype)) window.RTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
		if (!this._localStreams) this._localStreams = [];
		return this._localStreams;
	};
	if (!("addStream" in window.RTCPeerConnection.prototype)) {
		const _addTrack = window.RTCPeerConnection.prototype.addTrack;
		window.RTCPeerConnection.prototype.addStream = function addStream(stream) {
			if (!this._localStreams) this._localStreams = [];
			if (!this._localStreams.includes(stream)) this._localStreams.push(stream);
			stream.getAudioTracks().forEach((track) => _addTrack.call(this, track, stream));
			stream.getVideoTracks().forEach((track) => _addTrack.call(this, track, stream));
		};
		window.RTCPeerConnection.prototype.addTrack = function addTrack(track, ...streams) {
			if (streams) streams.forEach((stream) => {
				if (!this._localStreams) this._localStreams = [stream];
				else if (!this._localStreams.includes(stream)) this._localStreams.push(stream);
			});
			return _addTrack.apply(this, arguments);
		};
	}
	if (!("removeStream" in window.RTCPeerConnection.prototype)) window.RTCPeerConnection.prototype.removeStream = function removeStream(stream) {
		if (!this._localStreams) this._localStreams = [];
		const index = this._localStreams.indexOf(stream);
		if (index === -1) return;
		this._localStreams.splice(index, 1);
		const tracks = stream.getTracks();
		this.getSenders().forEach((sender) => {
			if (tracks.includes(sender.track)) this.removeTrack(sender);
		});
	};
}
function shimRemoteStreamsAPI(window) {
	if (typeof window !== "object" || !window.RTCPeerConnection) return;
	if (!("getRemoteStreams" in window.RTCPeerConnection.prototype)) window.RTCPeerConnection.prototype.getRemoteStreams = function getRemoteStreams() {
		return this._remoteStreams ? this._remoteStreams : [];
	};
	if (!("onaddstream" in window.RTCPeerConnection.prototype)) {
		Object.defineProperty(window.RTCPeerConnection.prototype, "onaddstream", {
			get() {
				return this._onaddstream;
			},
			set(f) {
				if (this._onaddstream) {
					this.removeEventListener("addstream", this._onaddstream);
					this.removeEventListener("track", this._onaddstreampoly);
				}
				this.addEventListener("addstream", this._onaddstream = f);
				this.addEventListener("track", this._onaddstreampoly = (e) => {
					e.streams.forEach((stream) => {
						if (!this._remoteStreams) this._remoteStreams = [];
						if (this._remoteStreams.includes(stream)) return;
						this._remoteStreams.push(stream);
						const event = new Event("addstream");
						event.stream = stream;
						this.dispatchEvent(event);
					});
				});
			}
		});
		const origSetRemoteDescription = window.RTCPeerConnection.prototype.setRemoteDescription;
		window.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
			const pc = this;
			if (!this._onaddstreampoly) this.addEventListener("track", this._onaddstreampoly = function(e) {
				e.streams.forEach((stream) => {
					if (!pc._remoteStreams) pc._remoteStreams = [];
					if (pc._remoteStreams.indexOf(stream) >= 0) return;
					pc._remoteStreams.push(stream);
					const event = new Event("addstream");
					event.stream = stream;
					pc.dispatchEvent(event);
				});
			});
			return origSetRemoteDescription.apply(pc, arguments);
		};
	}
}
function shimCallbacksAPI(window) {
	if (typeof window !== "object" || !window.RTCPeerConnection) return;
	const prototype = window.RTCPeerConnection.prototype;
	const origCreateOffer = prototype.createOffer;
	const origCreateAnswer = prototype.createAnswer;
	const setLocalDescription = prototype.setLocalDescription;
	const setRemoteDescription = prototype.setRemoteDescription;
	const addIceCandidate = prototype.addIceCandidate;
	prototype.createOffer = function createOffer(successCallback, failureCallback) {
		const options = arguments.length >= 2 ? arguments[2] : arguments[0];
		const promise = origCreateOffer.apply(this, [options]);
		if (!failureCallback) return promise;
		promise.then(successCallback, failureCallback);
		return Promise.resolve();
	};
	prototype.createAnswer = function createAnswer(successCallback, failureCallback) {
		const options = arguments.length >= 2 ? arguments[2] : arguments[0];
		const promise = origCreateAnswer.apply(this, [options]);
		if (!failureCallback) return promise;
		promise.then(successCallback, failureCallback);
		return Promise.resolve();
	};
	let withCallback = function(description, successCallback, failureCallback) {
		const promise = setLocalDescription.apply(this, [description]);
		if (!failureCallback) return promise;
		promise.then(successCallback, failureCallback);
		return Promise.resolve();
	};
	prototype.setLocalDescription = withCallback;
	withCallback = function(description, successCallback, failureCallback) {
		const promise = setRemoteDescription.apply(this, [description]);
		if (!failureCallback) return promise;
		promise.then(successCallback, failureCallback);
		return Promise.resolve();
	};
	prototype.setRemoteDescription = withCallback;
	withCallback = function(candidate, successCallback, failureCallback) {
		const promise = addIceCandidate.apply(this, [candidate]);
		if (!failureCallback) return promise;
		promise.then(successCallback, failureCallback);
		return Promise.resolve();
	};
	prototype.addIceCandidate = withCallback;
}
function shimGetUserMedia(window) {
	const navigator = window && window.navigator;
	if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
		const mediaDevices = navigator.mediaDevices;
		const _getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
		navigator.mediaDevices.getUserMedia = (constraints) => {
			return _getUserMedia(shimConstraints(constraints));
		};
	}
	if (!navigator.getUserMedia && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) navigator.getUserMedia = function getUserMedia(constraints, cb, errcb) {
		navigator.mediaDevices.getUserMedia(constraints).then(cb, errcb);
	}.bind(navigator);
}
function shimConstraints(constraints) {
	if (constraints && constraints.video !== void 0) return Object.assign({}, constraints, { video: compactObject(constraints.video) });
	return constraints;
}
function shimRTCIceServerUrls(window) {
	if (!window.RTCPeerConnection) return;
	const OrigPeerConnection = window.RTCPeerConnection;
	window.RTCPeerConnection = function RTCPeerConnection(pcConfig, pcConstraints) {
		if (pcConfig && pcConfig.iceServers) {
			const newIceServers = [];
			for (let i = 0; i < pcConfig.iceServers.length; i++) {
				let server = pcConfig.iceServers[i];
				if (server.urls === void 0 && server.url) {
					deprecated("RTCIceServer.url", "RTCIceServer.urls");
					server = JSON.parse(JSON.stringify(server));
					server.urls = server.url;
					delete server.url;
					newIceServers.push(server);
				} else newIceServers.push(pcConfig.iceServers[i]);
			}
			pcConfig.iceServers = newIceServers;
		}
		return new OrigPeerConnection(pcConfig, pcConstraints);
	};
	window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
	if ("generateCertificate" in OrigPeerConnection) Object.defineProperty(window.RTCPeerConnection, "generateCertificate", { get() {
		return OrigPeerConnection.generateCertificate;
	} });
}
function shimTrackEventTransceiver(window) {
	if (typeof window === "object" && window.RTCTrackEvent && "receiver" in window.RTCTrackEvent.prototype && !("transceiver" in window.RTCTrackEvent.prototype)) Object.defineProperty(window.RTCTrackEvent.prototype, "transceiver", { get() {
		return { receiver: this.receiver };
	} });
}
function shimCreateOfferLegacy(window) {
	const origCreateOffer = window.RTCPeerConnection.prototype.createOffer;
	window.RTCPeerConnection.prototype.createOffer = function createOffer(offerOptions) {
		if (offerOptions) {
			if (typeof offerOptions.offerToReceiveAudio !== "undefined") offerOptions.offerToReceiveAudio = !!offerOptions.offerToReceiveAudio;
			const audioTransceiver = this.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === "audio");
			if (offerOptions.offerToReceiveAudio === false && audioTransceiver) {
				if (audioTransceiver.direction === "sendrecv") if (audioTransceiver.setDirection) audioTransceiver.setDirection("sendonly");
				else audioTransceiver.direction = "sendonly";
				else if (audioTransceiver.direction === "recvonly") if (audioTransceiver.setDirection) audioTransceiver.setDirection("inactive");
				else audioTransceiver.direction = "inactive";
			} else if (offerOptions.offerToReceiveAudio === true && !audioTransceiver) this.addTransceiver("audio", { direction: "recvonly" });
			if (typeof offerOptions.offerToReceiveVideo !== "undefined") offerOptions.offerToReceiveVideo = !!offerOptions.offerToReceiveVideo;
			const videoTransceiver = this.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === "video");
			if (offerOptions.offerToReceiveVideo === false && videoTransceiver) {
				if (videoTransceiver.direction === "sendrecv") if (videoTransceiver.setDirection) videoTransceiver.setDirection("sendonly");
				else videoTransceiver.direction = "sendonly";
				else if (videoTransceiver.direction === "recvonly") if (videoTransceiver.setDirection) videoTransceiver.setDirection("inactive");
				else videoTransceiver.direction = "inactive";
			} else if (offerOptions.offerToReceiveVideo === true && !videoTransceiver) this.addTransceiver("video", { direction: "recvonly" });
		}
		return origCreateOffer.apply(this, arguments);
	};
}
function shimAudioContext(window) {
	if (typeof window !== "object" || window.AudioContext) return;
	window.AudioContext = window.webkitAudioContext;
}
//#endregion
//#region node_modules/sdp/sdp.js
var require_sdp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var SDPUtils = {};
	SDPUtils.generateIdentifier = function() {
		return Math.random().toString(36).substring(2, 12);
	};
	SDPUtils.localCName = SDPUtils.generateIdentifier();
	SDPUtils.splitLines = function(blob) {
		return blob.trim().split("\n").map((line) => line.trim());
	};
	SDPUtils.splitSections = function(blob) {
		return blob.split("\nm=").map((part, index) => (index > 0 ? "m=" + part : part).trim() + "\r\n");
	};
	SDPUtils.getDescription = function(blob) {
		const sections = SDPUtils.splitSections(blob);
		return sections && sections[0];
	};
	SDPUtils.getMediaSections = function(blob) {
		const sections = SDPUtils.splitSections(blob);
		sections.shift();
		return sections;
	};
	SDPUtils.matchPrefix = function(blob, prefix) {
		return SDPUtils.splitLines(blob).filter((line) => line.indexOf(prefix) === 0);
	};
	SDPUtils.parseCandidate = function(line) {
		let parts;
		if (line.indexOf("a=candidate:") === 0) parts = line.substring(12).split(" ");
		else parts = line.substring(10).split(" ");
		const candidate = {
			foundation: parts[0],
			component: {
				1: "rtp",
				2: "rtcp"
			}[parts[1]] || parts[1],
			protocol: parts[2].toLowerCase(),
			priority: parseInt(parts[3], 10),
			ip: parts[4],
			address: parts[4],
			port: parseInt(parts[5], 10),
			type: parts[7]
		};
		for (let i = 8; i < parts.length; i += 2) switch (parts[i]) {
			case "raddr":
				candidate.relatedAddress = parts[i + 1];
				break;
			case "rport":
				candidate.relatedPort = parseInt(parts[i + 1], 10);
				break;
			case "tcptype":
				candidate.tcpType = parts[i + 1];
				break;
			case "ufrag":
				candidate.ufrag = parts[i + 1];
				candidate.usernameFragment = parts[i + 1];
				break;
			default:
				if (candidate[parts[i]] === void 0) candidate[parts[i]] = parts[i + 1];
				break;
		}
		return candidate;
	};
	SDPUtils.writeCandidate = function(candidate) {
		const sdp = [];
		sdp.push(candidate.foundation);
		const component = candidate.component;
		if (component === "rtp") sdp.push(1);
		else if (component === "rtcp") sdp.push(2);
		else sdp.push(component);
		sdp.push(candidate.protocol.toUpperCase());
		sdp.push(candidate.priority);
		sdp.push(candidate.address || candidate.ip);
		sdp.push(candidate.port);
		const type = candidate.type;
		sdp.push("typ");
		sdp.push(type);
		if (type !== "host" && candidate.relatedAddress && candidate.relatedPort !== void 0) {
			sdp.push("raddr");
			sdp.push(candidate.relatedAddress);
			sdp.push("rport");
			sdp.push(candidate.relatedPort);
		}
		if (candidate.tcpType && candidate.protocol.toLowerCase() === "tcp") {
			sdp.push("tcptype");
			sdp.push(candidate.tcpType);
		}
		if (candidate.usernameFragment || candidate.ufrag) {
			sdp.push("ufrag");
			sdp.push(candidate.usernameFragment || candidate.ufrag);
		}
		return "candidate:" + sdp.join(" ");
	};
	SDPUtils.parseIceOptions = function(line) {
		return line.substring(14).split(" ");
	};
	SDPUtils.parseRtpMap = function(line) {
		let parts = line.substring(9).split(" ");
		const parsed = { payloadType: parseInt(parts.shift(), 10) };
		parts = parts[0].split("/");
		parsed.name = parts[0];
		parsed.clockRate = parseInt(parts[1], 10);
		parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
		parsed.numChannels = parsed.channels;
		return parsed;
	};
	SDPUtils.writeRtpMap = function(codec) {
		let pt = codec.payloadType;
		if (codec.preferredPayloadType !== void 0) pt = codec.preferredPayloadType;
		const channels = codec.channels || codec.numChannels || 1;
		return "a=rtpmap:" + pt + " " + codec.name + "/" + codec.clockRate + (channels !== 1 ? "/" + channels : "") + "\r\n";
	};
	SDPUtils.parseExtmap = function(line) {
		const parts = line.substring(9).split(" ");
		return {
			id: parseInt(parts[0], 10),
			direction: parts[0].indexOf("/") > 0 ? parts[0].split("/")[1] : "sendrecv",
			uri: parts[1],
			attributes: parts.slice(2).join(" ")
		};
	};
	SDPUtils.writeExtmap = function(headerExtension) {
		return "a=extmap:" + (headerExtension.id || headerExtension.preferredId) + (headerExtension.direction && headerExtension.direction !== "sendrecv" ? "/" + headerExtension.direction : "") + " " + headerExtension.uri + (headerExtension.attributes ? " " + headerExtension.attributes : "") + "\r\n";
	};
	SDPUtils.parseFmtp = function(line) {
		const parsed = {};
		let kv;
		const parts = line.substring(line.indexOf(" ") + 1).split(";");
		for (let j = 0; j < parts.length; j++) {
			kv = parts[j].trim().split("=");
			parsed[kv[0].trim()] = kv[1];
		}
		return parsed;
	};
	SDPUtils.writeFmtp = function(codec) {
		let line = "";
		let pt = codec.payloadType;
		if (codec.preferredPayloadType !== void 0) pt = codec.preferredPayloadType;
		if (codec.parameters && Object.keys(codec.parameters).length) {
			const params = [];
			Object.keys(codec.parameters).forEach((param) => {
				if (codec.parameters[param] !== void 0) params.push(param + "=" + codec.parameters[param]);
				else params.push(param);
			});
			line += "a=fmtp:" + pt + " " + params.join(";") + "\r\n";
		}
		return line;
	};
	SDPUtils.parseRtcpFb = function(line) {
		const parts = line.substring(line.indexOf(" ") + 1).split(" ");
		return {
			type: parts.shift(),
			parameter: parts.join(" ")
		};
	};
	SDPUtils.writeRtcpFb = function(codec) {
		let lines = "";
		let pt = codec.payloadType;
		if (codec.preferredPayloadType !== void 0) pt = codec.preferredPayloadType;
		if (codec.rtcpFeedback && codec.rtcpFeedback.length) codec.rtcpFeedback.forEach((fb) => {
			lines += "a=rtcp-fb:" + pt + " " + fb.type + (fb.parameter && fb.parameter.length ? " " + fb.parameter : "") + "\r\n";
		});
		return lines;
	};
	SDPUtils.parseSsrcMedia = function(line) {
		const sp = line.indexOf(" ");
		const parts = { ssrc: parseInt(line.substring(7, sp), 10) };
		const colon = line.indexOf(":", sp);
		if (colon > -1) {
			parts.attribute = line.substring(sp + 1, colon);
			parts.value = line.substring(colon + 1);
		} else parts.attribute = line.substring(sp + 1);
		return parts;
	};
	SDPUtils.parseSsrcGroup = function(line) {
		const parts = line.substring(13).split(" ");
		return {
			semantics: parts.shift(),
			ssrcs: parts.map((ssrc) => parseInt(ssrc, 10))
		};
	};
	SDPUtils.getMid = function(mediaSection) {
		const mid = SDPUtils.matchPrefix(mediaSection, "a=mid:")[0];
		if (mid) return mid.substring(6);
	};
	SDPUtils.parseFingerprint = function(line) {
		const parts = line.substring(14).split(" ");
		return {
			algorithm: parts[0].toLowerCase(),
			value: parts[1].toUpperCase()
		};
	};
	SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
		return {
			role: "auto",
			fingerprints: SDPUtils.matchPrefix(mediaSection + sessionpart, "a=fingerprint:").map(SDPUtils.parseFingerprint)
		};
	};
	SDPUtils.writeDtlsParameters = function(params, setupType) {
		let sdp = "a=setup:" + setupType + "\r\n";
		params.fingerprints.forEach((fp) => {
			sdp += "a=fingerprint:" + fp.algorithm + " " + fp.value + "\r\n";
		});
		return sdp;
	};
	SDPUtils.parseCryptoLine = function(line) {
		const parts = line.substring(9).split(" ");
		return {
			tag: parseInt(parts[0], 10),
			cryptoSuite: parts[1],
			keyParams: parts[2],
			sessionParams: parts.slice(3)
		};
	};
	SDPUtils.writeCryptoLine = function(parameters) {
		return "a=crypto:" + parameters.tag + " " + parameters.cryptoSuite + " " + (typeof parameters.keyParams === "object" ? SDPUtils.writeCryptoKeyParams(parameters.keyParams) : parameters.keyParams) + (parameters.sessionParams ? " " + parameters.sessionParams.join(" ") : "") + "\r\n";
	};
	SDPUtils.parseCryptoKeyParams = function(keyParams) {
		if (keyParams.indexOf("inline:") !== 0) return null;
		const parts = keyParams.substring(7).split("|");
		return {
			keyMethod: "inline",
			keySalt: parts[0],
			lifeTime: parts[1],
			mkiValue: parts[2] ? parts[2].split(":")[0] : void 0,
			mkiLength: parts[2] ? parts[2].split(":")[1] : void 0
		};
	};
	SDPUtils.writeCryptoKeyParams = function(keyParams) {
		return keyParams.keyMethod + ":" + keyParams.keySalt + (keyParams.lifeTime ? "|" + keyParams.lifeTime : "") + (keyParams.mkiValue && keyParams.mkiLength ? "|" + keyParams.mkiValue + ":" + keyParams.mkiLength : "");
	};
	SDPUtils.getCryptoParameters = function(mediaSection, sessionpart) {
		return SDPUtils.matchPrefix(mediaSection + sessionpart, "a=crypto:").map(SDPUtils.parseCryptoLine);
	};
	SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
		const ufrag = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=ice-ufrag:")[0];
		const pwd = SDPUtils.matchPrefix(mediaSection + sessionpart, "a=ice-pwd:")[0];
		if (!(ufrag && pwd)) return null;
		return {
			usernameFragment: ufrag.substring(12),
			password: pwd.substring(10)
		};
	};
	SDPUtils.writeIceParameters = function(params) {
		let sdp = "a=ice-ufrag:" + params.usernameFragment + "\r\na=ice-pwd:" + params.password + "\r\n";
		if (params.iceLite) sdp += "a=ice-lite\r\n";
		return sdp;
	};
	SDPUtils.parseRtpParameters = function(mediaSection) {
		const description = {
			codecs: [],
			headerExtensions: [],
			fecMechanisms: [],
			rtcp: []
		};
		const mline = SDPUtils.splitLines(mediaSection)[0].split(" ");
		description.profile = mline[2];
		for (let i = 3; i < mline.length; i++) {
			const pt = mline[i];
			const rtpmapline = SDPUtils.matchPrefix(mediaSection, "a=rtpmap:" + pt + " ")[0];
			if (rtpmapline) {
				const codec = SDPUtils.parseRtpMap(rtpmapline);
				const fmtps = SDPUtils.matchPrefix(mediaSection, "a=fmtp:" + pt + " ");
				codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
				codec.rtcpFeedback = SDPUtils.matchPrefix(mediaSection, "a=rtcp-fb:" + pt + " ").map(SDPUtils.parseRtcpFb);
				description.codecs.push(codec);
				switch (codec.name.toUpperCase()) {
					case "RED":
					case "ULPFEC":
						description.fecMechanisms.push(codec.name.toUpperCase());
						break;
					default: break;
				}
			}
		}
		SDPUtils.matchPrefix(mediaSection, "a=extmap:").forEach((line) => {
			description.headerExtensions.push(SDPUtils.parseExtmap(line));
		});
		const wildcardRtcpFb = SDPUtils.matchPrefix(mediaSection, "a=rtcp-fb:* ").map(SDPUtils.parseRtcpFb);
		description.codecs.forEach((codec) => {
			wildcardRtcpFb.forEach((fb) => {
				if (!codec.rtcpFeedback.find((existingFeedback) => {
					return existingFeedback.type === fb.type && existingFeedback.parameter === fb.parameter;
				})) codec.rtcpFeedback.push(fb);
			});
		});
		return description;
	};
	SDPUtils.writeRtpDescription = function(kind, caps) {
		let sdp = "";
		sdp += "m=" + kind + " ";
		sdp += caps.codecs.length > 0 ? "9" : "0";
		sdp += " " + (caps.profile || "UDP/TLS/RTP/SAVPF") + " ";
		sdp += caps.codecs.map((codec) => {
			if (codec.preferredPayloadType !== void 0) return codec.preferredPayloadType;
			return codec.payloadType;
		}).join(" ") + "\r\n";
		sdp += "c=IN IP4 0.0.0.0\r\n";
		sdp += "a=rtcp:9 IN IP4 0.0.0.0\r\n";
		caps.codecs.forEach((codec) => {
			sdp += SDPUtils.writeRtpMap(codec);
			sdp += SDPUtils.writeFmtp(codec);
			sdp += SDPUtils.writeRtcpFb(codec);
		});
		let maxptime = 0;
		caps.codecs.forEach((codec) => {
			if (codec.maxptime > maxptime) maxptime = codec.maxptime;
		});
		if (maxptime > 0) sdp += "a=maxptime:" + maxptime + "\r\n";
		if (caps.headerExtensions) caps.headerExtensions.forEach((extension) => {
			sdp += SDPUtils.writeExtmap(extension);
		});
		return sdp;
	};
	SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
		const encodingParameters = [];
		const description = SDPUtils.parseRtpParameters(mediaSection);
		const hasRed = description.fecMechanisms.indexOf("RED") !== -1;
		const hasUlpfec = description.fecMechanisms.indexOf("ULPFEC") !== -1;
		const ssrcs = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map((line) => SDPUtils.parseSsrcMedia(line)).filter((parts) => parts.attribute === "cname");
		const primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
		let secondarySsrc;
		const flows = SDPUtils.matchPrefix(mediaSection, "a=ssrc-group:FID").map((line) => {
			return line.substring(17).split(" ").map((part) => parseInt(part, 10));
		});
		if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) secondarySsrc = flows[0][1];
		description.codecs.forEach((codec) => {
			if (codec.name.toUpperCase() === "RTX" && codec.parameters.apt) {
				let encParam = {
					ssrc: primarySsrc,
					codecPayloadType: parseInt(codec.parameters.apt, 10)
				};
				if (primarySsrc && secondarySsrc) encParam.rtx = { ssrc: secondarySsrc };
				encodingParameters.push(encParam);
				if (hasRed) {
					encParam = JSON.parse(JSON.stringify(encParam));
					encParam.fec = {
						ssrc: primarySsrc,
						mechanism: hasUlpfec ? "red+ulpfec" : "red"
					};
					encodingParameters.push(encParam);
				}
			}
		});
		if (encodingParameters.length === 0 && primarySsrc) encodingParameters.push({ ssrc: primarySsrc });
		let bandwidth = SDPUtils.matchPrefix(mediaSection, "b=");
		if (bandwidth.length) {
			if (bandwidth[0].indexOf("b=TIAS:") === 0) bandwidth = parseInt(bandwidth[0].substring(7), 10);
			else if (bandwidth[0].indexOf("b=AS:") === 0) bandwidth = parseInt(bandwidth[0].substring(5), 10) * 1e3 * .95 - 2e3 * 8;
			else bandwidth = void 0;
			encodingParameters.forEach((params) => {
				params.maxBitrate = bandwidth;
			});
		}
		return encodingParameters;
	};
	SDPUtils.parseRtcpParameters = function(mediaSection) {
		const rtcpParameters = {};
		const remoteSsrc = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map((line) => SDPUtils.parseSsrcMedia(line)).filter((obj) => obj.attribute === "cname")[0];
		if (remoteSsrc) {
			rtcpParameters.cname = remoteSsrc.value;
			rtcpParameters.ssrc = remoteSsrc.ssrc;
		}
		const rsize = SDPUtils.matchPrefix(mediaSection, "a=rtcp-rsize");
		rtcpParameters.reducedSize = rsize.length > 0;
		rtcpParameters.compound = rsize.length === 0;
		rtcpParameters.mux = SDPUtils.matchPrefix(mediaSection, "a=rtcp-mux").length > 0;
		return rtcpParameters;
	};
	SDPUtils.writeRtcpParameters = function(rtcpParameters) {
		let sdp = "";
		if (rtcpParameters.reducedSize) sdp += "a=rtcp-rsize\r\n";
		if (rtcpParameters.mux) sdp += "a=rtcp-mux\r\n";
		if (rtcpParameters.ssrc !== void 0 && rtcpParameters.cname) sdp += "a=ssrc:" + rtcpParameters.ssrc + " cname:" + rtcpParameters.cname + "\r\n";
		return sdp;
	};
	SDPUtils.parseMsid = function(mediaSection) {
		let parts;
		const spec = SDPUtils.matchPrefix(mediaSection, "a=msid:");
		if (spec.length === 1) {
			parts = spec[0].substring(7).split(" ");
			return {
				stream: parts[0],
				track: parts[1]
			};
		}
		const planB = SDPUtils.matchPrefix(mediaSection, "a=ssrc:").map((line) => SDPUtils.parseSsrcMedia(line)).filter((msidParts) => msidParts.attribute === "msid");
		if (planB.length > 0) {
			parts = planB[0].value.split(" ");
			return {
				stream: parts[0],
				track: parts[1]
			};
		}
	};
	SDPUtils.parseSctpDescription = function(mediaSection) {
		const mline = SDPUtils.parseMLine(mediaSection);
		const maxSizeLine = SDPUtils.matchPrefix(mediaSection, "a=max-message-size:");
		let maxMessageSize;
		if (maxSizeLine.length > 0) maxMessageSize = parseInt(maxSizeLine[0].substring(19), 10);
		if (isNaN(maxMessageSize)) maxMessageSize = 65536;
		const sctpPort = SDPUtils.matchPrefix(mediaSection, "a=sctp-port:");
		if (sctpPort.length > 0) return {
			port: parseInt(sctpPort[0].substring(12), 10),
			protocol: mline.fmt,
			maxMessageSize
		};
		const sctpMapLines = SDPUtils.matchPrefix(mediaSection, "a=sctpmap:");
		if (sctpMapLines.length > 0) {
			const parts = sctpMapLines[0].substring(10).split(" ");
			return {
				port: parseInt(parts[0], 10),
				protocol: parts[1],
				maxMessageSize
			};
		}
	};
	SDPUtils.writeSctpDescription = function(media, sctp) {
		let output = [];
		if (media.protocol !== "DTLS/SCTP") output = [
			"m=" + media.kind + " 9 " + media.protocol + " " + sctp.protocol + "\r\n",
			"c=IN IP4 0.0.0.0\r\n",
			"a=sctp-port:" + sctp.port + "\r\n"
		];
		else output = [
			"m=" + media.kind + " 9 " + media.protocol + " " + sctp.port + "\r\n",
			"c=IN IP4 0.0.0.0\r\n",
			"a=sctpmap:" + sctp.port + " " + sctp.protocol + " 65535\r\n"
		];
		if (sctp.maxMessageSize !== void 0) output.push("a=max-message-size:" + sctp.maxMessageSize + "\r\n");
		return output.join("");
	};
	SDPUtils.generateSessionId = function() {
		return Math.random().toString().substr(2, 22);
	};
	SDPUtils.writeSessionBoilerplate = function(sessId, sessVer, sessUser) {
		let sessionId;
		const version = sessVer !== void 0 ? sessVer : 2;
		if (sessId) sessionId = sessId;
		else sessionId = SDPUtils.generateSessionId();
		return "v=0\r\no=" + (sessUser || "thisisadapterortc") + " " + sessionId + " " + version + " IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
	};
	SDPUtils.getDirection = function(mediaSection, sessionpart) {
		const lines = SDPUtils.splitLines(mediaSection);
		for (let i = 0; i < lines.length; i++) switch (lines[i]) {
			case "a=sendrecv":
			case "a=sendonly":
			case "a=recvonly":
			case "a=inactive": return lines[i].substring(2);
			default:
		}
		if (sessionpart) return SDPUtils.getDirection(sessionpart);
		return "sendrecv";
	};
	SDPUtils.getKind = function(mediaSection) {
		return SDPUtils.splitLines(mediaSection)[0].split(" ")[0].substring(2);
	};
	SDPUtils.isRejected = function(mediaSection) {
		return mediaSection.split(" ", 2)[1] === "0";
	};
	SDPUtils.parseMLine = function(mediaSection) {
		const parts = SDPUtils.splitLines(mediaSection)[0].substring(2).split(" ");
		return {
			kind: parts[0],
			port: parseInt(parts[1], 10),
			protocol: parts[2],
			fmt: parts.slice(3).join(" ")
		};
	};
	SDPUtils.parseOLine = function(mediaSection) {
		const parts = SDPUtils.matchPrefix(mediaSection, "o=")[0].substring(2).split(" ");
		return {
			username: parts[0],
			sessionId: parts[1],
			sessionVersion: parseInt(parts[2], 10),
			netType: parts[3],
			addressType: parts[4],
			address: parts[5]
		};
	};
	SDPUtils.isValidSDP = function(blob) {
		if (typeof blob !== "string" || blob.length === 0) return false;
		const lines = SDPUtils.splitLines(blob);
		for (let i = 0; i < lines.length; i++) if (lines[i].length < 2 || lines[i].charAt(1) !== "=") return false;
		return true;
	};
	if (typeof module === "object") module.exports = SDPUtils;
}));
//#endregion
//#region node_modules/webrtc-adapter/src/js/common_shim.js
var common_shim_exports = /* @__PURE__ */ __exportAll({
	removeExtmapAllowMixed: () => removeExtmapAllowMixed,
	shimAddIceCandidateNullOrEmpty: () => shimAddIceCandidateNullOrEmpty,
	shimConnectionState: () => shimConnectionState,
	shimMaxMessageSize: () => shimMaxMessageSize,
	shimParameterlessSetLocalDescription: () => shimParameterlessSetLocalDescription,
	shimRTCIceCandidate: () => shimRTCIceCandidate,
	shimRTCIceCandidateRelayProtocol: () => shimRTCIceCandidateRelayProtocol,
	shimSendThrowTypeError: () => shimSendThrowTypeError
});
var import_sdp = /* @__PURE__ */ __toESM(require_sdp());
function shimRTCIceCandidate(window) {
	if (!window.RTCIceCandidate || window.RTCIceCandidate && "foundation" in window.RTCIceCandidate.prototype) return;
	const NativeRTCIceCandidate = window.RTCIceCandidate;
	window.RTCIceCandidate = function RTCIceCandidate(args) {
		if (typeof args === "object" && args.candidate && args.candidate.indexOf("a=") === 0) {
			args = JSON.parse(JSON.stringify(args));
			args.candidate = args.candidate.substring(2);
		}
		if (args.candidate && args.candidate.length) {
			const nativeCandidate = new NativeRTCIceCandidate(args);
			const parsedCandidate = import_sdp.default.parseCandidate(args.candidate);
			for (const key in parsedCandidate) if (!(key in nativeCandidate)) Object.defineProperty(nativeCandidate, key, { value: parsedCandidate[key] });
			nativeCandidate.toJSON = function toJSON() {
				return {
					candidate: nativeCandidate.candidate,
					sdpMid: nativeCandidate.sdpMid,
					sdpMLineIndex: nativeCandidate.sdpMLineIndex,
					usernameFragment: nativeCandidate.usernameFragment
				};
			};
			return nativeCandidate;
		}
		return new NativeRTCIceCandidate(args);
	};
	window.RTCIceCandidate.prototype = NativeRTCIceCandidate.prototype;
	wrapPeerConnectionEvent(window, "icecandidate", (e) => {
		if (e.candidate) Object.defineProperty(e, "candidate", {
			value: new window.RTCIceCandidate(e.candidate),
			writable: "false"
		});
		return e;
	});
}
function shimRTCIceCandidateRelayProtocol(window) {
	if (!window.RTCIceCandidate || window.RTCIceCandidate && "relayProtocol" in window.RTCIceCandidate.prototype) return;
	wrapPeerConnectionEvent(window, "icecandidate", (e) => {
		if (e.candidate) {
			const parsedCandidate = import_sdp.default.parseCandidate(e.candidate.candidate);
			if (parsedCandidate.type === "relay") e.candidate.relayProtocol = {
				0: "tls",
				1: "tcp",
				2: "udp"
			}[parsedCandidate.priority >> 24];
		}
		return e;
	});
}
function shimMaxMessageSize(window, browserDetails) {
	if (!window.RTCPeerConnection) return;
	if (!("sctp" in window.RTCPeerConnection.prototype)) Object.defineProperty(window.RTCPeerConnection.prototype, "sctp", { get() {
		return typeof this._sctp === "undefined" ? null : this._sctp;
	} });
	const sctpInDescription = function(description) {
		if (!description || !description.sdp) return false;
		const sections = import_sdp.default.splitSections(description.sdp);
		sections.shift();
		return sections.some((mediaSection) => {
			const mLine = import_sdp.default.parseMLine(mediaSection);
			return mLine && mLine.kind === "application" && mLine.protocol.indexOf("SCTP") !== -1;
		});
	};
	const getRemoteFirefoxVersion = function(description) {
		const match = description.sdp.match(/mozilla...THIS_IS_SDPARTA-(\d+)/);
		if (match === null || match.length < 2) return -1;
		const version = parseInt(match[1], 10);
		return version !== version ? -1 : version;
	};
	const getCanSendMaxMessageSize = function(remoteIsFirefox) {
		let canSendMaxMessageSize = 65536;
		if (browserDetails.browser === "firefox") if (browserDetails.version < 57) if (remoteIsFirefox === -1) canSendMaxMessageSize = 16384;
		else canSendMaxMessageSize = 2147483637;
		else if (browserDetails.version < 60) canSendMaxMessageSize = browserDetails.version === 57 ? 65535 : 65536;
		else canSendMaxMessageSize = 2147483637;
		return canSendMaxMessageSize;
	};
	const getMaxMessageSize = function(description, remoteIsFirefox) {
		let maxMessageSize = 65536;
		if (browserDetails.browser === "firefox" && browserDetails.version === 57) maxMessageSize = 65535;
		const match = import_sdp.default.matchPrefix(description.sdp, "a=max-message-size:");
		if (match.length > 0) maxMessageSize = parseInt(match[0].substring(19), 10);
		else if (browserDetails.browser === "firefox" && remoteIsFirefox !== -1) maxMessageSize = 2147483637;
		return maxMessageSize;
	};
	const origSetRemoteDescription = window.RTCPeerConnection.prototype.setRemoteDescription;
	window.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
		this._sctp = null;
		if (browserDetails.browser === "chrome" && browserDetails.version >= 76) {
			const { sdpSemantics } = this.getConfiguration();
			if (sdpSemantics === "plan-b") Object.defineProperty(this, "sctp", {
				get() {
					return typeof this._sctp === "undefined" ? null : this._sctp;
				},
				enumerable: true,
				configurable: true
			});
		}
		if (sctpInDescription(arguments[0])) {
			const isFirefox = getRemoteFirefoxVersion(arguments[0]);
			const canSendMMS = getCanSendMaxMessageSize(isFirefox);
			const remoteMMS = getMaxMessageSize(arguments[0], isFirefox);
			let maxMessageSize;
			if (canSendMMS === 0 && remoteMMS === 0) maxMessageSize = Number.POSITIVE_INFINITY;
			else if (canSendMMS === 0 || remoteMMS === 0) maxMessageSize = Math.max(canSendMMS, remoteMMS);
			else maxMessageSize = Math.min(canSendMMS, remoteMMS);
			const sctp = {};
			Object.defineProperty(sctp, "maxMessageSize", { get() {
				return maxMessageSize;
			} });
			this._sctp = sctp;
		}
		return origSetRemoteDescription.apply(this, arguments);
	};
}
function shimSendThrowTypeError(window, browserDetails) {
	if (!(window.RTCPeerConnection && "createDataChannel" in window.RTCPeerConnection.prototype)) return;
	if (browserDetails.browser === "chrome" && browserDetails.version > 149) return;
	if (browserDetails.browser === "firefox" && browserDetails.version > 60) return;
	function wrapDcSend(dc, pc) {
		const origDataChannelSend = dc.send;
		dc.send = function send() {
			const data = arguments[0];
			const length = data.length || data.size || data.byteLength;
			if (dc.readyState === "open" && pc.sctp && length > pc.sctp.maxMessageSize) throw new TypeError("Message too large (can send a maximum of " + pc.sctp.maxMessageSize + " bytes)");
			return origDataChannelSend.apply(dc, arguments);
		};
	}
	const origCreateDataChannel = window.RTCPeerConnection.prototype.createDataChannel;
	window.RTCPeerConnection.prototype.createDataChannel = function createDataChannel() {
		const dataChannel = origCreateDataChannel.apply(this, arguments);
		wrapDcSend(dataChannel, this);
		return dataChannel;
	};
	wrapPeerConnectionEvent(window, "datachannel", (e) => {
		wrapDcSend(e.channel, e.target);
		return e;
	});
}
function shimConnectionState(window) {
	if (!window.RTCPeerConnection || "connectionState" in window.RTCPeerConnection.prototype) return;
	const proto = window.RTCPeerConnection.prototype;
	Object.defineProperty(proto, "connectionState", {
		get() {
			return {
				completed: "connected",
				checking: "connecting"
			}[this.iceConnectionState] || this.iceConnectionState;
		},
		enumerable: true,
		configurable: true
	});
	Object.defineProperty(proto, "onconnectionstatechange", {
		get() {
			return this._onconnectionstatechange || null;
		},
		set(cb) {
			if (this._onconnectionstatechange) {
				this.removeEventListener("connectionstatechange", this._onconnectionstatechange);
				delete this._onconnectionstatechange;
			}
			if (cb) this.addEventListener("connectionstatechange", this._onconnectionstatechange = cb);
		},
		enumerable: true,
		configurable: true
	});
	["setLocalDescription", "setRemoteDescription"].forEach((method) => {
		const origMethod = proto[method];
		proto[method] = function() {
			if (!this._connectionstatechangepoly) {
				this._connectionstatechangepoly = (e) => {
					const pc = e.target;
					if (pc._lastConnectionState !== pc.connectionState) {
						pc._lastConnectionState = pc.connectionState;
						const newEvent = new Event("connectionstatechange", e);
						pc.dispatchEvent(newEvent);
					}
					return e;
				};
				this.addEventListener("iceconnectionstatechange", this._connectionstatechangepoly);
			}
			return origMethod.apply(this, arguments);
		};
	});
}
function removeExtmapAllowMixed(window, browserDetails) {
	if (!window.RTCPeerConnection) return;
	if (browserDetails.browser === "chrome" && browserDetails.version >= 71) return;
	if (browserDetails.browser === "safari" && browserDetails._safariVersion >= 13.1) return;
	const nativeSRD = window.RTCPeerConnection.prototype.setRemoteDescription;
	window.RTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription(desc) {
		if (desc && desc.sdp && desc.sdp.indexOf("\na=extmap-allow-mixed") !== -1) {
			const sdp = desc.sdp.split("\n").filter((line) => {
				return line.trim() !== "a=extmap-allow-mixed";
			}).join("\n");
			if (window.RTCSessionDescription && desc instanceof window.RTCSessionDescription) arguments[0] = new window.RTCSessionDescription({
				type: desc.type,
				sdp
			});
			else desc.sdp = sdp;
		}
		return nativeSRD.apply(this, arguments);
	};
}
function shimAddIceCandidateNullOrEmpty(window, browserDetails) {
	if (!(window.RTCPeerConnection && window.RTCPeerConnection.prototype)) return;
	const nativeAddIceCandidate = window.RTCPeerConnection.prototype.addIceCandidate;
	if (!nativeAddIceCandidate || nativeAddIceCandidate.length === 0) return;
	window.RTCPeerConnection.prototype.addIceCandidate = function addIceCandidate() {
		if (!arguments[0]) {
			if (arguments[1]) arguments[1].apply(null);
			return Promise.resolve();
		}
		if ((browserDetails.browser === "chrome" && browserDetails.version < 78 || browserDetails.browser === "firefox" && browserDetails.version < 68 || browserDetails.browser === "safari") && arguments[0] && arguments[0].candidate === "") return Promise.resolve();
		return nativeAddIceCandidate.apply(this, arguments);
	};
}
function shimParameterlessSetLocalDescription(window, browserDetails) {
	if (!(window.RTCPeerConnection && window.RTCPeerConnection.prototype)) return;
	const nativeSetLocalDescription = window.RTCPeerConnection.prototype.setLocalDescription;
	if (!nativeSetLocalDescription || nativeSetLocalDescription.length === 0) return;
	window.RTCPeerConnection.prototype.setLocalDescription = function setLocalDescription() {
		let desc = arguments[0] || {};
		if (typeof desc !== "object" || desc.type && desc.sdp) return nativeSetLocalDescription.apply(this, arguments);
		desc = {
			type: desc.type,
			sdp: desc.sdp
		};
		if (!desc.type) switch (this.signalingState) {
			case "stable":
			case "have-local-offer":
			case "have-remote-pranswer":
				desc.type = "offer";
				break;
			default:
				desc.type = "answer";
				break;
		}
		if (desc.sdp || desc.type !== "offer" && desc.type !== "answer") return nativeSetLocalDescription.apply(this, [desc]);
		return (desc.type === "offer" ? this.createOffer : this.createAnswer).apply(this).then((d) => nativeSetLocalDescription.apply(this, [d]));
	};
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/adapter_factory.js
function adapterFactory({ window } = {}, options = {
	shimChrome: true,
	shimFirefox: true,
	shimSafari: true
}) {
	const logging = log$1;
	const browserDetails = detectBrowser(window);
	const adapter = {
		browserDetails,
		commonShim: common_shim_exports,
		extractVersion,
		disableLog,
		disableWarnings,
		sdp: import_sdp
	};
	switch (browserDetails.browser) {
		case "chrome":
			if (!chrome_shim_exports || !shimPeerConnection$1 || !options.shimChrome) {
				logging("Chrome shim is not included in this adapter release.");
				return adapter;
			}
			if (browserDetails.version === null) {
				logging("Chrome shim can not determine version, not shimming.");
				return adapter;
			}
			logging("adapter.js shimming chrome.");
			adapter.browserShim = chrome_shim_exports;
			shimAddIceCandidateNullOrEmpty(window, browserDetails);
			shimParameterlessSetLocalDescription(window, browserDetails);
			shimGetUserMedia$2(window, browserDetails);
			shimMediaStream(window, browserDetails);
			shimPeerConnection$1(window, browserDetails);
			shimOnTrack$1(window, browserDetails);
			shimAddTrackRemoveTrack(window, browserDetails);
			shimGetSendersWithDtmf(window, browserDetails);
			shimSenderReceiverGetStats(window, browserDetails);
			fixNegotiationNeeded(window, browserDetails);
			shimRTCIceCandidate(window, browserDetails);
			shimRTCIceCandidateRelayProtocol(window, browserDetails);
			shimConnectionState(window, browserDetails);
			shimMaxMessageSize(window, browserDetails);
			shimSendThrowTypeError(window, browserDetails);
			removeExtmapAllowMixed(window, browserDetails);
			break;
		case "firefox":
			if (!firefox_shim_exports || !shimPeerConnection || !options.shimFirefox) {
				logging("Firefox shim is not included in this adapter release.");
				return adapter;
			}
			logging("adapter.js shimming firefox.");
			adapter.browserShim = firefox_shim_exports;
			shimAddIceCandidateNullOrEmpty(window, browserDetails);
			shimParameterlessSetLocalDescription(window, browserDetails);
			shimGetUserMedia$1(window, browserDetails);
			shimPeerConnection(window, browserDetails);
			shimGetStats(window, browserDetails);
			shimOnTrack(window, browserDetails);
			shimRemoveStream(window, browserDetails);
			shimSenderGetStats(window, browserDetails);
			shimReceiverGetStats(window, browserDetails);
			shimRTCDataChannel(window, browserDetails);
			shimAddTransceiver(window, browserDetails);
			shimGetParameters(window, browserDetails);
			shimCreateOffer(window, browserDetails);
			shimCreateAnswer(window, browserDetails);
			shimRTCIceCandidate(window, browserDetails);
			shimConnectionState(window, browserDetails);
			shimMaxMessageSize(window, browserDetails);
			shimSendThrowTypeError(window, browserDetails);
			break;
		case "safari":
			if (!safari_shim_exports || !options.shimSafari) {
				logging("Safari shim is not included in this adapter release.");
				return adapter;
			}
			logging("adapter.js shimming safari.");
			adapter.browserShim = safari_shim_exports;
			shimAddIceCandidateNullOrEmpty(window, browserDetails);
			shimParameterlessSetLocalDescription(window, browserDetails);
			shimRTCIceServerUrls(window, browserDetails);
			shimCreateOfferLegacy(window, browserDetails);
			shimCallbacksAPI(window, browserDetails);
			shimLocalStreamsAPI(window, browserDetails);
			shimRemoteStreamsAPI(window, browserDetails);
			shimTrackEventTransceiver(window, browserDetails);
			shimGetUserMedia(window, browserDetails);
			shimAudioContext(window, browserDetails);
			shimRTCIceCandidate(window, browserDetails);
			shimRTCIceCandidateRelayProtocol(window, browserDetails);
			shimMaxMessageSize(window, browserDetails);
			shimSendThrowTypeError(window, browserDetails);
			removeExtmapAllowMixed(window, browserDetails);
			break;
		default:
			logging("Unsupported browser!");
			break;
	}
	return adapter;
}
//#endregion
//#region node_modules/webrtc-adapter/src/js/adapter_core.js
var adapter = adapterFactory({ window: typeof window === "undefined" ? void 0 : window });
//#endregion
//#region node_modules/peerjs/dist/bundler.mjs
function $parcel$export(e, n, v, s) {
	Object.defineProperty(e, n, {
		get: v,
		set: s,
		enumerable: true,
		configurable: true
	});
}
var $fcbcc7538a6776d5$export$f1c5f4c9cb95390b = class {
	constructor() {
		this.chunkedMTU = 16300;
		this._dataCount = 1;
		this.chunk = (blob) => {
			const chunks = [];
			const size = blob.byteLength;
			const total = Math.ceil(size / this.chunkedMTU);
			let index = 0;
			let start = 0;
			while (start < size) {
				const end = Math.min(size, start + this.chunkedMTU);
				const b = blob.slice(start, end);
				const chunk = {
					__peerData: this._dataCount,
					n: index,
					data: b,
					total
				};
				chunks.push(chunk);
				start = end;
				index++;
			}
			this._dataCount++;
			return chunks;
		};
	}
};
function $fcbcc7538a6776d5$export$52c89ebcdc4f53f2(bufs) {
	let size = 0;
	for (const buf of bufs) size += buf.byteLength;
	const result = new Uint8Array(size);
	let offset = 0;
	for (const buf of bufs) {
		result.set(buf, offset);
		offset += buf.byteLength;
	}
	return result;
}
var $fb63e766cfafaab9$var$webRTCAdapter = adapter.default || adapter;
var $fb63e766cfafaab9$export$25be9502477c137d = new class {
	isWebRTCSupported() {
		return typeof RTCPeerConnection !== "undefined";
	}
	isBrowserSupported() {
		const browser = this.getBrowser();
		const version = this.getVersion();
		if (!this.supportedBrowsers.includes(browser)) return false;
		if (browser === "chrome") return version >= this.minChromeVersion;
		if (browser === "firefox") return version >= this.minFirefoxVersion;
		if (browser === "safari") return !this.isIOS && version >= this.minSafariVersion;
		return false;
	}
	getBrowser() {
		return $fb63e766cfafaab9$var$webRTCAdapter.browserDetails.browser;
	}
	getVersion() {
		return $fb63e766cfafaab9$var$webRTCAdapter.browserDetails.version || 0;
	}
	isUnifiedPlanSupported() {
		const browser = this.getBrowser();
		const version = $fb63e766cfafaab9$var$webRTCAdapter.browserDetails.version || 0;
		if (browser === "chrome" && version < this.minChromeVersion) return false;
		if (browser === "firefox" && version >= this.minFirefoxVersion) return true;
		if (!window.RTCRtpTransceiver || !("currentDirection" in RTCRtpTransceiver.prototype)) return false;
		let tempPc;
		let supported = false;
		try {
			tempPc = new RTCPeerConnection();
			tempPc.addTransceiver("audio");
			supported = true;
		} catch (e) {} finally {
			if (tempPc) tempPc.close();
		}
		return supported;
	}
	toString() {
		return `Supports:
    browser:${this.getBrowser()}
    version:${this.getVersion()}
    isIOS:${this.isIOS}
    isWebRTCSupported:${this.isWebRTCSupported()}
    isBrowserSupported:${this.isBrowserSupported()}
    isUnifiedPlanSupported:${this.isUnifiedPlanSupported()}`;
	}
	constructor() {
		this.isIOS = typeof navigator !== "undefined" ? [
			"iPad",
			"iPhone",
			"iPod"
		].includes(navigator.platform) : false;
		this.supportedBrowsers = [
			"firefox",
			"chrome",
			"safari"
		];
		this.minFirefoxVersion = 59;
		this.minChromeVersion = 72;
		this.minSafariVersion = 605;
	}
}();
var $9a84a32bf0bf36bb$export$f35f128fd59ea256 = (id) => {
	return !id || /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id);
};
var $0e5fd1585784c252$export$4e61f672936bec77 = () => Math.random().toString(36).slice(2);
var $4f4134156c446392$var$DEFAULT_CONFIG = {
	iceServers: [{ urls: "stun:stun.l.google.com:19302" }, {
		urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
		username: "peerjs",
		credential: "peerjsp"
	}],
	sdpSemantics: "unified-plan"
};
var $4f4134156c446392$export$f8f26dd395d7e1bd = class extends $fcbcc7538a6776d5$export$f1c5f4c9cb95390b {
	noop() {}
	blobToArrayBuffer(blob, cb) {
		const fr = new FileReader();
		fr.onload = function(evt) {
			if (evt.target) cb(evt.target.result);
		};
		fr.readAsArrayBuffer(blob);
		return fr;
	}
	binaryStringToArrayBuffer(binary) {
		const byteArray = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) byteArray[i] = binary.charCodeAt(i) & 255;
		return byteArray.buffer;
	}
	isSecure() {
		return location.protocol === "https:";
	}
	constructor(...args) {
		super(...args), this.CLOUD_HOST = "0.peerjs.com", this.CLOUD_PORT = 443, this.chunkedBrowsers = {
			Chrome: 1,
			chrome: 1
		}, this.defaultConfig = $4f4134156c446392$var$DEFAULT_CONFIG, this.browser = $fb63e766cfafaab9$export$25be9502477c137d.getBrowser(), this.browserVersion = $fb63e766cfafaab9$export$25be9502477c137d.getVersion(), this.pack = $0cfd7828ad59115f$export$2a703dbb0cb35339, this.unpack = $0cfd7828ad59115f$export$417857010dc9287f, this.supports = function() {
			const supported = {
				browser: $fb63e766cfafaab9$export$25be9502477c137d.isBrowserSupported(),
				webRTC: $fb63e766cfafaab9$export$25be9502477c137d.isWebRTCSupported(),
				audioVideo: false,
				data: false,
				binaryBlob: false,
				reliable: false
			};
			if (!supported.webRTC) return supported;
			let pc;
			try {
				pc = new RTCPeerConnection($4f4134156c446392$var$DEFAULT_CONFIG);
				supported.audioVideo = true;
				let dc;
				try {
					dc = pc.createDataChannel("_PEERJSTEST", { ordered: true });
					supported.data = true;
					supported.reliable = !!dc.ordered;
					try {
						dc.binaryType = "blob";
						supported.binaryBlob = !$fb63e766cfafaab9$export$25be9502477c137d.isIOS;
					} catch (e) {}
				} catch (e) {} finally {
					if (dc) dc.close();
				}
			} catch (e) {} finally {
				if (pc) pc.close();
			}
			return supported;
		}(), this.validateId = $9a84a32bf0bf36bb$export$f35f128fd59ea256, this.randomToken = $0e5fd1585784c252$export$4e61f672936bec77;
	}
};
var $4f4134156c446392$export$7debb50ef11d5e0b = new $4f4134156c446392$export$f8f26dd395d7e1bd();
var $257947e92926277a$var$LOG_PREFIX = "PeerJS: ";
var $257947e92926277a$var$Logger = class {
	get logLevel() {
		return this._logLevel;
	}
	set logLevel(logLevel) {
		this._logLevel = logLevel;
	}
	log(...args) {
		if (this._logLevel >= 3) this._print(3, ...args);
	}
	warn(...args) {
		if (this._logLevel >= 2) this._print(2, ...args);
	}
	error(...args) {
		if (this._logLevel >= 1) this._print(1, ...args);
	}
	setLogFunction(fn) {
		this._print = fn;
	}
	_print(logLevel, ...rest) {
		const copy = [$257947e92926277a$var$LOG_PREFIX, ...rest];
		for (const i in copy) if (copy[i] instanceof Error) copy[i] = "(" + copy[i].name + ") " + copy[i].message;
		if (logLevel >= 3) console.log(...copy);
		else if (logLevel >= 2) console.warn("WARNING", ...copy);
		else if (logLevel >= 1) console.error("ERROR", ...copy);
	}
	constructor() {
		this._logLevel = 0;
	}
};
var $257947e92926277a$export$2e2bcd8739ae039 = new $257947e92926277a$var$Logger();
var $c4dcfd1d1ea86647$exports = {};
var $c4dcfd1d1ea86647$var$has = Object.prototype.hasOwnProperty, $c4dcfd1d1ea86647$var$prefix = "~";
/**
* Constructor to create a storage for our `EE` objects.
* An `Events` instance is a plain object whose properties are event names.
*
* @constructor
* @private
*/ function $c4dcfd1d1ea86647$var$Events() {}
if (Object.create) {
	$c4dcfd1d1ea86647$var$Events.prototype = Object.create(null);
	if (!new $c4dcfd1d1ea86647$var$Events().__proto__) $c4dcfd1d1ea86647$var$prefix = false;
}
/**
* Representation of a single event listener.
*
* @param {Function} fn The listener function.
* @param {*} context The context to invoke the listener with.
* @param {Boolean} [once=false] Specify if the listener is a one-time listener.
* @constructor
* @private
*/ function $c4dcfd1d1ea86647$var$EE(fn, context, once) {
	this.fn = fn;
	this.context = context;
	this.once = once || false;
}
/**
* Add a listener for a given event.
*
* @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
* @param {(String|Symbol)} event The event name.
* @param {Function} fn The listener function.
* @param {*} context The context to invoke the listener with.
* @param {Boolean} once Specify if the listener is a one-time listener.
* @returns {EventEmitter}
* @private
*/ function $c4dcfd1d1ea86647$var$addListener(emitter, event, fn, context, once) {
	if (typeof fn !== "function") throw new TypeError("The listener must be a function");
	var listener = new $c4dcfd1d1ea86647$var$EE(fn, context || emitter, once), evt = $c4dcfd1d1ea86647$var$prefix ? $c4dcfd1d1ea86647$var$prefix + event : event;
	if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
	else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
	else emitter._events[evt] = [emitter._events[evt], listener];
	return emitter;
}
/**
* Clear event by name.
*
* @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
* @param {(String|Symbol)} evt The Event name.
* @private
*/ function $c4dcfd1d1ea86647$var$clearEvent(emitter, evt) {
	if (--emitter._eventsCount === 0) emitter._events = new $c4dcfd1d1ea86647$var$Events();
	else delete emitter._events[evt];
}
/**
* Minimal `EventEmitter` interface that is molded against the Node.js
* `EventEmitter` interface.
*
* @constructor
* @public
*/ function $c4dcfd1d1ea86647$var$EventEmitter() {
	this._events = new $c4dcfd1d1ea86647$var$Events();
	this._eventsCount = 0;
}
/**
* Return an array listing the events for which the emitter has registered
* listeners.
*
* @returns {Array}
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.eventNames = function eventNames() {
	var names = [], events, name;
	if (this._eventsCount === 0) return names;
	for (name in events = this._events) if ($c4dcfd1d1ea86647$var$has.call(events, name)) names.push($c4dcfd1d1ea86647$var$prefix ? name.slice(1) : name);
	if (Object.getOwnPropertySymbols) return names.concat(Object.getOwnPropertySymbols(events));
	return names;
};
/**
* Return the listeners registered for a given event.
*
* @param {(String|Symbol)} event The event name.
* @returns {Array} The registered listeners.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.listeners = function listeners(event) {
	var evt = $c4dcfd1d1ea86647$var$prefix ? $c4dcfd1d1ea86647$var$prefix + event : event, handlers = this._events[evt];
	if (!handlers) return [];
	if (handlers.fn) return [handlers.fn];
	for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) ee[i] = handlers[i].fn;
	return ee;
};
/**
* Return the number of listeners listening to a given event.
*
* @param {(String|Symbol)} event The event name.
* @returns {Number} The number of listeners.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.listenerCount = function listenerCount(event) {
	var evt = $c4dcfd1d1ea86647$var$prefix ? $c4dcfd1d1ea86647$var$prefix + event : event, listeners = this._events[evt];
	if (!listeners) return 0;
	if (listeners.fn) return 1;
	return listeners.length;
};
/**
* Calls each of the listeners registered for a given event.
*
* @param {(String|Symbol)} event The event name.
* @returns {Boolean} `true` if the event had listeners, else `false`.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
	var evt = $c4dcfd1d1ea86647$var$prefix ? $c4dcfd1d1ea86647$var$prefix + event : event;
	if (!this._events[evt]) return false;
	var listeners = this._events[evt], len = arguments.length, args, i;
	if (listeners.fn) {
		if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
		switch (len) {
			case 1: return listeners.fn.call(listeners.context), true;
			case 2: return listeners.fn.call(listeners.context, a1), true;
			case 3: return listeners.fn.call(listeners.context, a1, a2), true;
			case 4: return listeners.fn.call(listeners.context, a1, a2, a3), true;
			case 5: return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
			case 6: return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
		}
		for (i = 1, args = new Array(len - 1); i < len; i++) args[i - 1] = arguments[i];
		listeners.fn.apply(listeners.context, args);
	} else {
		var length = listeners.length, j;
		for (i = 0; i < length; i++) {
			if (listeners[i].once) this.removeListener(event, listeners[i].fn, void 0, true);
			switch (len) {
				case 1:
					listeners[i].fn.call(listeners[i].context);
					break;
				case 2:
					listeners[i].fn.call(listeners[i].context, a1);
					break;
				case 3:
					listeners[i].fn.call(listeners[i].context, a1, a2);
					break;
				case 4:
					listeners[i].fn.call(listeners[i].context, a1, a2, a3);
					break;
				default:
					if (!args) for (j = 1, args = new Array(len - 1); j < len; j++) args[j - 1] = arguments[j];
					listeners[i].fn.apply(listeners[i].context, args);
			}
		}
	}
	return true;
};
/**
* Add a listener for a given event.
*
* @param {(String|Symbol)} event The event name.
* @param {Function} fn The listener function.
* @param {*} [context=this] The context to invoke the listener with.
* @returns {EventEmitter} `this`.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.on = function on(event, fn, context) {
	return $c4dcfd1d1ea86647$var$addListener(this, event, fn, context, false);
};
/**
* Add a one-time listener for a given event.
*
* @param {(String|Symbol)} event The event name.
* @param {Function} fn The listener function.
* @param {*} [context=this] The context to invoke the listener with.
* @returns {EventEmitter} `this`.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.once = function once(event, fn, context) {
	return $c4dcfd1d1ea86647$var$addListener(this, event, fn, context, true);
};
/**
* Remove the listeners of a given event.
*
* @param {(String|Symbol)} event The event name.
* @param {Function} fn Only remove the listeners that match this function.
* @param {*} context Only remove the listeners that have this context.
* @param {Boolean} once Only remove one-time listeners.
* @returns {EventEmitter} `this`.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.removeListener = function removeListener(event, fn, context, once) {
	var evt = $c4dcfd1d1ea86647$var$prefix ? $c4dcfd1d1ea86647$var$prefix + event : event;
	if (!this._events[evt]) return this;
	if (!fn) {
		$c4dcfd1d1ea86647$var$clearEvent(this, evt);
		return this;
	}
	var listeners = this._events[evt];
	if (listeners.fn) {
		if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) $c4dcfd1d1ea86647$var$clearEvent(this, evt);
	} else {
		for (var i = 0, events = [], length = listeners.length; i < length; i++) if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) events.push(listeners[i]);
		if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
		else $c4dcfd1d1ea86647$var$clearEvent(this, evt);
	}
	return this;
};
/**
* Remove all listeners, or those of the specified event.
*
* @param {(String|Symbol)} [event] The event name.
* @returns {EventEmitter} `this`.
* @public
*/ $c4dcfd1d1ea86647$var$EventEmitter.prototype.removeAllListeners = function removeAllListeners(event) {
	var evt;
	if (event) {
		evt = $c4dcfd1d1ea86647$var$prefix ? $c4dcfd1d1ea86647$var$prefix + event : event;
		if (this._events[evt]) $c4dcfd1d1ea86647$var$clearEvent(this, evt);
	} else {
		this._events = new $c4dcfd1d1ea86647$var$Events();
		this._eventsCount = 0;
	}
	return this;
};
$c4dcfd1d1ea86647$var$EventEmitter.prototype.off = $c4dcfd1d1ea86647$var$EventEmitter.prototype.removeListener;
$c4dcfd1d1ea86647$var$EventEmitter.prototype.addListener = $c4dcfd1d1ea86647$var$EventEmitter.prototype.on;
$c4dcfd1d1ea86647$var$EventEmitter.prefixed = $c4dcfd1d1ea86647$var$prefix;
$c4dcfd1d1ea86647$var$EventEmitter.EventEmitter = $c4dcfd1d1ea86647$var$EventEmitter;
$c4dcfd1d1ea86647$exports = $c4dcfd1d1ea86647$var$EventEmitter;
var $78455e22dea96b8c$exports = {};
$parcel$export($78455e22dea96b8c$exports, "ConnectionType", () => $78455e22dea96b8c$export$3157d57b4135e3bc);
$parcel$export($78455e22dea96b8c$exports, "PeerErrorType", () => $78455e22dea96b8c$export$9547aaa2e39030ff);
$parcel$export($78455e22dea96b8c$exports, "BaseConnectionErrorType", () => $78455e22dea96b8c$export$7974935686149686);
$parcel$export($78455e22dea96b8c$exports, "DataConnectionErrorType", () => $78455e22dea96b8c$export$49ae800c114df41d);
$parcel$export($78455e22dea96b8c$exports, "SerializationType", () => $78455e22dea96b8c$export$89f507cf986a947);
$parcel$export($78455e22dea96b8c$exports, "SocketEventType", () => $78455e22dea96b8c$export$3b5c4a4b6354f023);
$parcel$export($78455e22dea96b8c$exports, "ServerMessageType", () => $78455e22dea96b8c$export$adb4a1754da6f10d);
var $78455e22dea96b8c$export$3157d57b4135e3bc = /* @__PURE__ */ function(ConnectionType) {
	ConnectionType["Data"] = "data";
	ConnectionType["Media"] = "media";
	return ConnectionType;
}({});
var $78455e22dea96b8c$export$9547aaa2e39030ff = /* @__PURE__ */ function(PeerErrorType) {
	/**
	* The client's browser does not support some or all WebRTC features that you are trying to use.
	*/ PeerErrorType["BrowserIncompatible"] = "browser-incompatible";
	/**
	* You've already disconnected this peer from the server and can no longer make any new connections on it.
	*/ PeerErrorType["Disconnected"] = "disconnected";
	/**
	* The ID passed into the Peer constructor contains illegal characters.
	*/ PeerErrorType["InvalidID"] = "invalid-id";
	/**
	* The API key passed into the Peer constructor contains illegal characters or is not in the system (cloud server only).
	*/ PeerErrorType["InvalidKey"] = "invalid-key";
	/**
	* Lost or cannot establish a connection to the signalling server.
	*/ PeerErrorType["Network"] = "network";
	/**
	* The peer you're trying to connect to does not exist.
	*/ PeerErrorType["PeerUnavailable"] = "peer-unavailable";
	/**
	* PeerJS is being used securely, but the cloud server does not support SSL. Use a custom PeerServer.
	*/ PeerErrorType["SslUnavailable"] = "ssl-unavailable";
	/**
	* Unable to reach the server.
	*/ PeerErrorType["ServerError"] = "server-error";
	/**
	* An error from the underlying socket.
	*/ PeerErrorType["SocketError"] = "socket-error";
	/**
	* The underlying socket closed unexpectedly.
	*/ PeerErrorType["SocketClosed"] = "socket-closed";
	/**
	* The ID passed into the Peer constructor is already taken.
	*
	* :::caution
	* This error is not fatal if your peer has open peer-to-peer connections.
	* This can happen if you attempt to {@apilink Peer.reconnect} a peer that has been disconnected from the server,
	* but its old ID has now been taken.
	* :::
	*/ PeerErrorType["UnavailableID"] = "unavailable-id";
	/**
	* Native WebRTC errors.
	*/ PeerErrorType["WebRTC"] = "webrtc";
	return PeerErrorType;
}({});
var $78455e22dea96b8c$export$7974935686149686 = /* @__PURE__ */ function(BaseConnectionErrorType) {
	BaseConnectionErrorType["NegotiationFailed"] = "negotiation-failed";
	BaseConnectionErrorType["ConnectionClosed"] = "connection-closed";
	return BaseConnectionErrorType;
}({});
var $78455e22dea96b8c$export$49ae800c114df41d = /* @__PURE__ */ function(DataConnectionErrorType) {
	DataConnectionErrorType["NotOpenYet"] = "not-open-yet";
	DataConnectionErrorType["MessageToBig"] = "message-too-big";
	return DataConnectionErrorType;
}({});
var $78455e22dea96b8c$export$89f507cf986a947 = /* @__PURE__ */ function(SerializationType) {
	SerializationType["Binary"] = "binary";
	SerializationType["BinaryUTF8"] = "binary-utf8";
	SerializationType["JSON"] = "json";
	SerializationType["None"] = "raw";
	return SerializationType;
}({});
var $78455e22dea96b8c$export$3b5c4a4b6354f023 = /* @__PURE__ */ function(SocketEventType) {
	SocketEventType["Message"] = "message";
	SocketEventType["Disconnected"] = "disconnected";
	SocketEventType["Error"] = "error";
	SocketEventType["Close"] = "close";
	return SocketEventType;
}({});
var $78455e22dea96b8c$export$adb4a1754da6f10d = /* @__PURE__ */ function(ServerMessageType) {
	ServerMessageType["Heartbeat"] = "HEARTBEAT";
	ServerMessageType["Candidate"] = "CANDIDATE";
	ServerMessageType["Offer"] = "OFFER";
	ServerMessageType["Answer"] = "ANSWER";
	ServerMessageType["Open"] = "OPEN";
	ServerMessageType["Error"] = "ERROR";
	ServerMessageType["IdTaken"] = "ID-TAKEN";
	ServerMessageType["InvalidKey"] = "INVALID-KEY";
	ServerMessageType["Leave"] = "LEAVE";
	ServerMessageType["Expire"] = "EXPIRE";
	return ServerMessageType;
}({});
var $520832d44ba058c8$export$83d89fbfd8236492 = "1.5.5";
var $8f5bfa60836d261d$export$4798917dbf149b79 = class extends $c4dcfd1d1ea86647$exports.EventEmitter {
	constructor(secure, host, port, path, key, pingInterval = 5e3) {
		super(), this.pingInterval = pingInterval, this._disconnected = true, this._messagesQueue = [];
		const wsProtocol = secure ? "wss://" : "ws://";
		this._baseUrl = wsProtocol + host + ":" + port + path + "peerjs?key=" + key;
	}
	start(id, token) {
		this._id = id;
		const wsUrl = `${this._baseUrl}&id=${id}&token=${token}`;
		if (!!this._socket || !this._disconnected) return;
		this._socket = new WebSocket(wsUrl + "&version=1.5.5");
		this._disconnected = false;
		this._socket.onmessage = (event) => {
			let data;
			try {
				data = JSON.parse(event.data);
				$257947e92926277a$export$2e2bcd8739ae039.log("Server message received:", data);
			} catch (e) {
				$257947e92926277a$export$2e2bcd8739ae039.log("Invalid server message", event.data);
				return;
			}
			this.emit($78455e22dea96b8c$export$3b5c4a4b6354f023.Message, data);
		};
		this._socket.onclose = (event) => {
			if (this._disconnected) return;
			$257947e92926277a$export$2e2bcd8739ae039.log("Socket closed.", event);
			this._cleanup();
			this._disconnected = true;
			this.emit($78455e22dea96b8c$export$3b5c4a4b6354f023.Disconnected);
		};
		this._socket.onopen = () => {
			if (this._disconnected) return;
			this._sendQueuedMessages();
			$257947e92926277a$export$2e2bcd8739ae039.log("Socket open");
			this._scheduleHeartbeat();
		};
	}
	_scheduleHeartbeat() {
		this._wsPingTimer = setTimeout(() => {
			this._sendHeartbeat();
		}, this.pingInterval);
	}
	_sendHeartbeat() {
		if (!this._wsOpen()) {
			$257947e92926277a$export$2e2bcd8739ae039.log(`Cannot send heartbeat, because socket closed`);
			return;
		}
		const message = JSON.stringify({ type: $78455e22dea96b8c$export$adb4a1754da6f10d.Heartbeat });
		this._socket.send(message);
		this._scheduleHeartbeat();
	}
	/** Is the websocket currently open? */ _wsOpen() {
		return !!this._socket && this._socket.readyState === 1;
	}
	/** Send queued messages. */ _sendQueuedMessages() {
		const copiedQueue = [...this._messagesQueue];
		this._messagesQueue = [];
		for (const message of copiedQueue) this.send(message);
	}
	/** Exposed send for DC & Peer. */ send(data) {
		if (this._disconnected) return;
		if (!this._id) {
			this._messagesQueue.push(data);
			return;
		}
		if (!data.type) {
			this.emit($78455e22dea96b8c$export$3b5c4a4b6354f023.Error, "Invalid message");
			return;
		}
		if (!this._wsOpen()) return;
		const message = JSON.stringify(data);
		this._socket.send(message);
	}
	close() {
		if (this._disconnected) return;
		this._cleanup();
		this._disconnected = true;
	}
	_cleanup() {
		if (this._socket) {
			this._socket.onopen = this._socket.onmessage = this._socket.onclose = null;
			this._socket.close();
			this._socket = void 0;
		}
		clearTimeout(this._wsPingTimer);
	}
};
var $b82fb8fc0514bfc1$export$89e6bb5ad64bf4a = class {
	constructor(connection) {
		this.connection = connection;
	}
	/** Returns a PeerConnection object set up correctly (for data, media). */ startConnection(options) {
		const peerConnection = this._startPeerConnection();
		this.connection.peerConnection = peerConnection;
		if (this.connection.type === $78455e22dea96b8c$export$3157d57b4135e3bc.Media && options._stream) this._addTracksToConnection(options._stream, peerConnection);
		if (options.originator) {
			const dataConnection = this.connection;
			const config = { ordered: !!options.reliable };
			const dataChannel = peerConnection.createDataChannel(dataConnection.label, config);
			dataConnection._initializeDataChannel(dataChannel);
			this._makeOffer();
		} else this.handleSDP("OFFER", options.sdp);
	}
	/** Start a PC. */ _startPeerConnection() {
		$257947e92926277a$export$2e2bcd8739ae039.log("Creating RTCPeerConnection.");
		const peerConnection = new RTCPeerConnection(this.connection.provider.options.config);
		this._setupListeners(peerConnection);
		return peerConnection;
	}
	/** Set up various WebRTC listeners. */ _setupListeners(peerConnection) {
		const peerId = this.connection.peer;
		const connectionId = this.connection.connectionId;
		const connectionType = this.connection.type;
		const provider = this.connection.provider;
		$257947e92926277a$export$2e2bcd8739ae039.log("Listening for ICE candidates.");
		peerConnection.onicecandidate = (evt) => {
			if (!evt.candidate || !evt.candidate.candidate) return;
			$257947e92926277a$export$2e2bcd8739ae039.log(`Received ICE candidates for ${peerId}:`, evt.candidate);
			provider.socket.send({
				type: $78455e22dea96b8c$export$adb4a1754da6f10d.Candidate,
				payload: {
					candidate: evt.candidate,
					type: connectionType,
					connectionId
				},
				dst: peerId
			});
		};
		peerConnection.oniceconnectionstatechange = () => {
			switch (peerConnection.iceConnectionState) {
				case "failed":
					$257947e92926277a$export$2e2bcd8739ae039.log("iceConnectionState is failed, closing connections to " + peerId);
					this.connection.emitError($78455e22dea96b8c$export$7974935686149686.NegotiationFailed, "Negotiation of connection to " + peerId + " failed.");
					this.connection.close();
					break;
				case "closed":
					$257947e92926277a$export$2e2bcd8739ae039.log("iceConnectionState is closed, closing connections to " + peerId);
					this.connection.emitError($78455e22dea96b8c$export$7974935686149686.ConnectionClosed, "Connection to " + peerId + " closed.");
					this.connection.close();
					break;
				case "disconnected":
					$257947e92926277a$export$2e2bcd8739ae039.log("iceConnectionState changed to disconnected on the connection with " + peerId);
					break;
				case "completed":
					peerConnection.onicecandidate = () => {};
					break;
			}
			this.connection.emit("iceStateChanged", peerConnection.iceConnectionState);
		};
		$257947e92926277a$export$2e2bcd8739ae039.log("Listening for data channel");
		peerConnection.ondatachannel = (evt) => {
			$257947e92926277a$export$2e2bcd8739ae039.log("Received data channel");
			const dataChannel = evt.channel;
			provider.getConnection(peerId, connectionId)._initializeDataChannel(dataChannel);
		};
		$257947e92926277a$export$2e2bcd8739ae039.log("Listening for remote stream");
		peerConnection.ontrack = (evt) => {
			$257947e92926277a$export$2e2bcd8739ae039.log("Received remote stream");
			const stream = evt.streams[0];
			const connection = provider.getConnection(peerId, connectionId);
			if (connection.type === $78455e22dea96b8c$export$3157d57b4135e3bc.Media) {
				const mediaConnection = connection;
				this._addStreamToMediaConnection(stream, mediaConnection);
			}
		};
	}
	cleanup() {
		$257947e92926277a$export$2e2bcd8739ae039.log("Cleaning up PeerConnection to " + this.connection.peer);
		const peerConnection = this.connection.peerConnection;
		if (!peerConnection) return;
		this.connection.peerConnection = null;
		peerConnection.onicecandidate = peerConnection.oniceconnectionstatechange = peerConnection.ondatachannel = peerConnection.ontrack = () => {};
		const peerConnectionNotClosed = peerConnection.signalingState !== "closed";
		let dataChannelNotClosed = false;
		const dataChannel = this.connection.dataChannel;
		if (dataChannel) dataChannelNotClosed = !!dataChannel.readyState && dataChannel.readyState !== "closed";
		if (peerConnectionNotClosed || dataChannelNotClosed) peerConnection.close();
	}
	async _makeOffer() {
		const peerConnection = this.connection.peerConnection;
		const provider = this.connection.provider;
		try {
			const offer = await peerConnection.createOffer(this.connection.options.constraints);
			$257947e92926277a$export$2e2bcd8739ae039.log("Created offer.");
			if (this.connection.options.sdpTransform && typeof this.connection.options.sdpTransform === "function") offer.sdp = this.connection.options.sdpTransform(offer.sdp) || offer.sdp;
			try {
				await peerConnection.setLocalDescription(offer);
				$257947e92926277a$export$2e2bcd8739ae039.log("Set localDescription:", offer, `for:${this.connection.peer}`);
				let payload = {
					sdp: offer,
					type: this.connection.type,
					connectionId: this.connection.connectionId,
					metadata: this.connection.metadata
				};
				if (this.connection.type === $78455e22dea96b8c$export$3157d57b4135e3bc.Data) {
					const dataConnection = this.connection;
					payload = {
						...payload,
						label: dataConnection.label,
						reliable: dataConnection.reliable,
						serialization: dataConnection.serialization
					};
				}
				provider.socket.send({
					type: $78455e22dea96b8c$export$adb4a1754da6f10d.Offer,
					payload,
					dst: this.connection.peer
				});
			} catch (err) {
				if (err != "OperationError: Failed to set local offer sdp: Called in wrong state: kHaveRemoteOffer") {
					provider.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.WebRTC, err);
					$257947e92926277a$export$2e2bcd8739ae039.log("Failed to setLocalDescription, ", err);
				}
			}
		} catch (err_1) {
			provider.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.WebRTC, err_1);
			$257947e92926277a$export$2e2bcd8739ae039.log("Failed to createOffer, ", err_1);
		}
	}
	async _makeAnswer() {
		const peerConnection = this.connection.peerConnection;
		const provider = this.connection.provider;
		try {
			const answer = await peerConnection.createAnswer();
			$257947e92926277a$export$2e2bcd8739ae039.log("Created answer.");
			if (this.connection.options.sdpTransform && typeof this.connection.options.sdpTransform === "function") answer.sdp = this.connection.options.sdpTransform(answer.sdp) || answer.sdp;
			try {
				await peerConnection.setLocalDescription(answer);
				$257947e92926277a$export$2e2bcd8739ae039.log(`Set localDescription:`, answer, `for:${this.connection.peer}`);
				provider.socket.send({
					type: $78455e22dea96b8c$export$adb4a1754da6f10d.Answer,
					payload: {
						sdp: answer,
						type: this.connection.type,
						connectionId: this.connection.connectionId
					},
					dst: this.connection.peer
				});
			} catch (err) {
				provider.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.WebRTC, err);
				$257947e92926277a$export$2e2bcd8739ae039.log("Failed to setLocalDescription, ", err);
			}
		} catch (err_1) {
			provider.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.WebRTC, err_1);
			$257947e92926277a$export$2e2bcd8739ae039.log("Failed to create answer, ", err_1);
		}
	}
	/** Handle an SDP. */ async handleSDP(type, sdp) {
		sdp = new RTCSessionDescription(sdp);
		const peerConnection = this.connection.peerConnection;
		const provider = this.connection.provider;
		$257947e92926277a$export$2e2bcd8739ae039.log("Setting remote description", sdp);
		const self = this;
		try {
			await peerConnection.setRemoteDescription(sdp);
			$257947e92926277a$export$2e2bcd8739ae039.log(`Set remoteDescription:${type} for:${this.connection.peer}`);
			if (type === "OFFER") await self._makeAnswer();
		} catch (err) {
			provider.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.WebRTC, err);
			$257947e92926277a$export$2e2bcd8739ae039.log("Failed to setRemoteDescription, ", err);
		}
	}
	/** Handle a candidate. */ async handleCandidate(ice) {
		$257947e92926277a$export$2e2bcd8739ae039.log(`handleCandidate:`, ice);
		try {
			await this.connection.peerConnection.addIceCandidate(ice);
			$257947e92926277a$export$2e2bcd8739ae039.log(`Added ICE candidate for:${this.connection.peer}`);
		} catch (err) {
			this.connection.provider.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.WebRTC, err);
			$257947e92926277a$export$2e2bcd8739ae039.log("Failed to handleCandidate, ", err);
		}
	}
	_addTracksToConnection(stream, peerConnection) {
		$257947e92926277a$export$2e2bcd8739ae039.log(`add tracks from stream ${stream.id} to peer connection`);
		if (!peerConnection.addTrack) return $257947e92926277a$export$2e2bcd8739ae039.error(`Your browser does't support RTCPeerConnection#addTrack. Ignored.`);
		stream.getTracks().forEach((track) => {
			peerConnection.addTrack(track, stream);
		});
	}
	_addStreamToMediaConnection(stream, mediaConnection) {
		$257947e92926277a$export$2e2bcd8739ae039.log(`add stream ${stream.id} to media connection ${mediaConnection.connectionId}`);
		mediaConnection.addStream(stream);
	}
};
var $23779d1881157a18$export$6a678e589c8a4542 = class extends $c4dcfd1d1ea86647$exports.EventEmitter {
	/**
	* Emits a typed error message.
	*
	* @internal
	*/ emitError(type, err) {
		$257947e92926277a$export$2e2bcd8739ae039.error("Error:", err);
		this.emit("error", new $23779d1881157a18$export$98871882f492de82(`${type}`, err));
	}
};
var $23779d1881157a18$export$98871882f492de82 = class extends Error {
	/**
	* @internal
	*/ constructor(type, err) {
		if (typeof err === "string") super(err);
		else {
			super();
			Object.assign(this, err);
		}
		this.type = type;
	}
};
var $5045192fc6d387ba$export$23a2a68283c24d80 = class extends $23779d1881157a18$export$6a678e589c8a4542 {
	/**
	* Whether the media connection is active (e.g. your call has been answered).
	* You can check this if you want to set a maximum wait time for a one-sided call.
	*/ get open() {
		return this._open;
	}
	constructor(peer, provider, options) {
		super(), this.peer = peer, this.provider = provider, this.options = options, this._open = false;
		this.metadata = options.metadata;
	}
};
var $5c1d08c7c57da9a3$export$4a84e95a2324ac29 = class $5c1d08c7c57da9a3$export$4a84e95a2324ac29 extends $5045192fc6d387ba$export$23a2a68283c24d80 {
	static #_ = this.ID_PREFIX = "mc_";
	/**
	* For media connections, this is always 'media'.
	*/ get type() {
		return $78455e22dea96b8c$export$3157d57b4135e3bc.Media;
	}
	get localStream() {
		return this._localStream;
	}
	get remoteStream() {
		return this._remoteStream;
	}
	constructor(peerId, provider, options) {
		super(peerId, provider, options);
		this._localStream = this.options._stream;
		this.connectionId = this.options.connectionId || $5c1d08c7c57da9a3$export$4a84e95a2324ac29.ID_PREFIX + $4f4134156c446392$export$7debb50ef11d5e0b.randomToken();
		this._negotiator = new $b82fb8fc0514bfc1$export$89e6bb5ad64bf4a(this);
		if (this._localStream) this._negotiator.startConnection({
			_stream: this._localStream,
			originator: true
		});
	}
	/** Called by the Negotiator when the DataChannel is ready. */ _initializeDataChannel(dc) {
		this.dataChannel = dc;
		this.dataChannel.onopen = () => {
			$257947e92926277a$export$2e2bcd8739ae039.log(`DC#${this.connectionId} dc connection success`);
			this.emit("willCloseOnRemote");
		};
		this.dataChannel.onclose = () => {
			$257947e92926277a$export$2e2bcd8739ae039.log(`DC#${this.connectionId} dc closed for:`, this.peer);
			this.close();
		};
	}
	addStream(remoteStream) {
		$257947e92926277a$export$2e2bcd8739ae039.log("Receiving stream", remoteStream);
		this._remoteStream = remoteStream;
		super.emit("stream", remoteStream);
	}
	/**
	* @internal
	*/ handleMessage(message) {
		const type = message.type;
		const payload = message.payload;
		switch (message.type) {
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Answer:
				this._negotiator.handleSDP(type, payload.sdp);
				this._open = true;
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Candidate:
				this._negotiator.handleCandidate(payload.candidate);
				break;
			default:
				$257947e92926277a$export$2e2bcd8739ae039.warn(`Unrecognized message type:${type} from peer:${this.peer}`);
				break;
		}
	}
	/**
	* When receiving a {@apilink PeerEvents | `call`} event on a peer, you can call
	* `answer` on the media connection provided by the callback to accept the call
	* and optionally send your own media stream.
	
	*
	* @param stream A WebRTC media stream.
	* @param options
	* @returns
	*/ answer(stream, options = {}) {
		if (this._localStream) {
			$257947e92926277a$export$2e2bcd8739ae039.warn("Local stream already exists on this MediaConnection. Are you answering a call twice?");
			return;
		}
		this._localStream = stream;
		if (options && options.sdpTransform) this.options.sdpTransform = options.sdpTransform;
		this._negotiator.startConnection({
			...this.options._payload,
			_stream: stream
		});
		const messages = this.provider._getMessages(this.connectionId);
		for (const message of messages) this.handleMessage(message);
		this._open = true;
	}
	/**
	* Exposed functionality for users.
	*/ /**
	* Closes the media connection.
	*/ close() {
		if (this._negotiator) {
			this._negotiator.cleanup();
			this._negotiator = null;
		}
		this._localStream = null;
		this._remoteStream = null;
		if (this.provider) {
			this.provider._removeConnection(this);
			this.provider = null;
		}
		if (this.options && this.options._stream) this.options._stream = null;
		if (!this.open) return;
		this._open = false;
		super.emit("close");
	}
};
var $abf266641927cd89$export$2c4e825dc9120f87 = class {
	constructor(_options) {
		this._options = _options;
	}
	_buildRequest(method) {
		const protocol = this._options.secure ? "https" : "http";
		const { host, port, path, key } = this._options;
		const url = new URL(`${protocol}://${host}:${port}${path}${key}/${method}`);
		url.searchParams.set("ts", `${Date.now()}${Math.random()}`);
		url.searchParams.set("version", $520832d44ba058c8$export$83d89fbfd8236492);
		return fetch(url.href, { referrerPolicy: this._options.referrerPolicy });
	}
	/** Get a unique ID from the server via XHR and initialize with it. */ async retrieveId() {
		try {
			const response = await this._buildRequest("id");
			if (response.status !== 200) throw new Error(`Error. Status:${response.status}`);
			return response.text();
		} catch (error) {
			$257947e92926277a$export$2e2bcd8739ae039.error("Error retrieving ID", error);
			let pathError = "";
			if (this._options.path === "/" && this._options.host !== $4f4134156c446392$export$7debb50ef11d5e0b.CLOUD_HOST) pathError = " If you passed in a `path` to your self-hosted PeerServer, you'll also need to pass in that same path when creating a new Peer.";
			throw new Error("Could not get an ID from the server." + pathError);
		}
	}
	/** @deprecated */ async listAllPeers() {
		try {
			const response = await this._buildRequest("peers");
			if (response.status !== 200) {
				if (response.status === 401) {
					let helpfulError = "";
					if (this._options.host === $4f4134156c446392$export$7debb50ef11d5e0b.CLOUD_HOST) helpfulError = "It looks like you're using the cloud server. You can email team@peerjs.com to enable peer listing for your API key.";
					else helpfulError = "You need to enable `allow_discovery` on your self-hosted PeerServer to use this feature.";
					throw new Error("It doesn't look like you have permission to list peers IDs. " + helpfulError);
				}
				throw new Error(`Error. Status:${response.status}`);
			}
			return response.json();
		} catch (error) {
			$257947e92926277a$export$2e2bcd8739ae039.error("Error retrieving list peers", error);
			throw new Error("Could not get list peers from the server." + error);
		}
	}
};
var $6366c4ca161bc297$export$d365f7ad9d7df9c9 = class $6366c4ca161bc297$export$d365f7ad9d7df9c9 extends $5045192fc6d387ba$export$23a2a68283c24d80 {
	static #_ = this.ID_PREFIX = "dc_";
	static #_2 = this.MAX_BUFFERED_AMOUNT = 8388608;
	get type() {
		return $78455e22dea96b8c$export$3157d57b4135e3bc.Data;
	}
	constructor(peerId, provider, options) {
		super(peerId, provider, options);
		this.connectionId = this.options.connectionId || $6366c4ca161bc297$export$d365f7ad9d7df9c9.ID_PREFIX + $0e5fd1585784c252$export$4e61f672936bec77();
		this.label = this.options.label || this.connectionId;
		this.reliable = !!this.options.reliable;
		this._negotiator = new $b82fb8fc0514bfc1$export$89e6bb5ad64bf4a(this);
		this._negotiator.startConnection(this.options._payload || {
			originator: true,
			reliable: this.reliable
		});
	}
	/** Called by the Negotiator when the DataChannel is ready. */ _initializeDataChannel(dc) {
		this.dataChannel = dc;
		this.dataChannel.onopen = () => {
			$257947e92926277a$export$2e2bcd8739ae039.log(`DC#${this.connectionId} dc connection success`);
			this._open = true;
			this.emit("open");
		};
		this.dataChannel.onmessage = (e) => {
			$257947e92926277a$export$2e2bcd8739ae039.log(`DC#${this.connectionId} dc onmessage:`, e.data);
		};
		this.dataChannel.onclose = () => {
			$257947e92926277a$export$2e2bcd8739ae039.log(`DC#${this.connectionId} dc closed for:`, this.peer);
			this.close();
		};
	}
	/**
	* Exposed functionality for users.
	*/ /** Allows user to close connection. */ close(options) {
		if (options?.flush) {
			this.send({ __peerData: { type: "close" } });
			return;
		}
		if (this._negotiator) {
			this._negotiator.cleanup();
			this._negotiator = null;
		}
		if (this.provider) {
			this.provider._removeConnection(this);
			this.provider = null;
		}
		if (this.dataChannel) {
			this.dataChannel.onopen = null;
			this.dataChannel.onmessage = null;
			this.dataChannel.onclose = null;
			this.dataChannel = null;
		}
		if (!this.open) return;
		this._open = false;
		super.emit("close");
	}
	/** Allows user to send data. */ send(data, chunked = false) {
		if (!this.open) {
			this.emitError($78455e22dea96b8c$export$49ae800c114df41d.NotOpenYet, "Connection is not open. You should listen for the `open` event before sending messages.");
			return;
		}
		return this._send(data, chunked);
	}
	async handleMessage(message) {
		const payload = message.payload;
		switch (message.type) {
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Answer:
				await this._negotiator.handleSDP(message.type, payload.sdp);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Candidate:
				await this._negotiator.handleCandidate(payload.candidate);
				break;
			default:
				$257947e92926277a$export$2e2bcd8739ae039.warn("Unrecognized message type:", message.type, "from peer:", this.peer);
				break;
		}
	}
};
var $a229bedbcaa6ca23$export$ff7c9d4c11d94e8b = class extends $6366c4ca161bc297$export$d365f7ad9d7df9c9 {
	get bufferSize() {
		return this._bufferSize;
	}
	_initializeDataChannel(dc) {
		super._initializeDataChannel(dc);
		this.dataChannel.binaryType = "arraybuffer";
		this.dataChannel.addEventListener("message", (e) => this._handleDataMessage(e));
	}
	_bufferedSend(msg) {
		if (this._buffering || !this._trySend(msg)) {
			this._buffer.push(msg);
			this._bufferSize = this._buffer.length;
		}
	}
	_trySend(msg) {
		if (!this.open) return false;
		if (this.dataChannel.bufferedAmount > $6366c4ca161bc297$export$d365f7ad9d7df9c9.MAX_BUFFERED_AMOUNT) {
			this._buffering = true;
			setTimeout(() => {
				this._buffering = false;
				this._tryBuffer();
			}, 50);
			return false;
		}
		try {
			this.dataChannel.send(msg);
		} catch (e) {
			$257947e92926277a$export$2e2bcd8739ae039.error(`DC#:${this.connectionId} Error when sending:`, e);
			this._buffering = true;
			this.close();
			return false;
		}
		return true;
	}
	_tryBuffer() {
		if (!this.open) return;
		if (this._buffer.length === 0) return;
		const msg = this._buffer[0];
		if (this._trySend(msg)) {
			this._buffer.shift();
			this._bufferSize = this._buffer.length;
			this._tryBuffer();
		}
	}
	close(options) {
		if (options?.flush) {
			this.send({ __peerData: { type: "close" } });
			return;
		}
		this._buffer = [];
		this._bufferSize = 0;
		super.close();
	}
	constructor(...args) {
		super(...args), this._buffer = [], this._bufferSize = 0, this._buffering = false;
	}
};
var $9fcfddb3ae148f88$export$f0a5a64d5bb37108 = class extends $a229bedbcaa6ca23$export$ff7c9d4c11d94e8b {
	close(options) {
		super.close(options);
		this._chunkedData = {};
	}
	constructor(peerId, provider, options) {
		super(peerId, provider, options), this.chunker = new $fcbcc7538a6776d5$export$f1c5f4c9cb95390b(), this.serialization = $78455e22dea96b8c$export$89f507cf986a947.Binary, this._chunkedData = {};
	}
	_handleDataMessage({ data }) {
		const deserializedData = $0cfd7828ad59115f$export$417857010dc9287f(data);
		const peerData = deserializedData["__peerData"];
		if (peerData) {
			if (peerData.type === "close") {
				this.close();
				return;
			}
			this._handleChunk(deserializedData);
			return;
		}
		this.emit("data", deserializedData);
	}
	_handleChunk(data) {
		const id = data.__peerData;
		const chunkInfo = this._chunkedData[id] || {
			data: [],
			count: 0,
			total: data.total
		};
		chunkInfo.data[data.n] = new Uint8Array(data.data);
		chunkInfo.count++;
		this._chunkedData[id] = chunkInfo;
		if (chunkInfo.total === chunkInfo.count) {
			delete this._chunkedData[id];
			const data = $fcbcc7538a6776d5$export$52c89ebcdc4f53f2(chunkInfo.data);
			this._handleDataMessage({ data });
		}
	}
	_send(data, chunked) {
		const blob = $0cfd7828ad59115f$export$2a703dbb0cb35339(data);
		if (blob instanceof Promise) return this._send_blob(blob);
		if (!chunked && blob.byteLength > this.chunker.chunkedMTU) {
			this._sendChunks(blob);
			return;
		}
		this._bufferedSend(blob);
	}
	async _send_blob(blobPromise) {
		const blob = await blobPromise;
		if (blob.byteLength > this.chunker.chunkedMTU) {
			this._sendChunks(blob);
			return;
		}
		this._bufferedSend(blob);
	}
	_sendChunks(blob) {
		const blobs = this.chunker.chunk(blob);
		$257947e92926277a$export$2e2bcd8739ae039.log(`DC#${this.connectionId} Try to send ${blobs.length} chunks...`);
		for (const blob of blobs) this.send(blob, true);
	}
};
var $bbaee3f15f714663$export$6f88fe47d32c9c94 = class extends $a229bedbcaa6ca23$export$ff7c9d4c11d94e8b {
	_handleDataMessage({ data }) {
		super.emit("data", data);
	}
	_send(data, _chunked) {
		this._bufferedSend(data);
	}
	constructor(...args) {
		super(...args), this.serialization = $78455e22dea96b8c$export$89f507cf986a947.None;
	}
};
var $817f931e3f9096cf$export$48880ac635f47186 = class extends $a229bedbcaa6ca23$export$ff7c9d4c11d94e8b {
	_handleDataMessage({ data }) {
		const deserializedData = this.parse(this.decoder.decode(data));
		const peerData = deserializedData["__peerData"];
		if (peerData && peerData.type === "close") {
			this.close();
			return;
		}
		this.emit("data", deserializedData);
	}
	_send(data, _chunked) {
		const encodedData = this.encoder.encode(this.stringify(data));
		if (encodedData.byteLength >= $4f4134156c446392$export$7debb50ef11d5e0b.chunkedMTU) {
			this.emitError($78455e22dea96b8c$export$49ae800c114df41d.MessageToBig, "Message too big for JSON channel");
			return;
		}
		this._bufferedSend(encodedData);
	}
	constructor(...args) {
		super(...args), this.serialization = $78455e22dea96b8c$export$89f507cf986a947.JSON, this.encoder = new TextEncoder(), this.decoder = new TextDecoder(), this.stringify = JSON.stringify, this.parse = JSON.parse;
	}
};
var $dd0187d7f28e386f$export$2e2bcd8739ae039 = class $416260bce337df90$export$ecd1fc136c422448 extends $23779d1881157a18$export$6a678e589c8a4542 {
	static #_ = this.DEFAULT_KEY = "peerjs";
	/**
	* The brokering ID of this peer
	*
	* If no ID was specified in {@apilink Peer | the constructor},
	* this will be `undefined` until the {@apilink PeerEvents | `open`} event is emitted.
	*/ get id() {
		return this._id;
	}
	get options() {
		return this._options;
	}
	get open() {
		return this._open;
	}
	/**
	* @internal
	*/ get socket() {
		return this._socket;
	}
	/**
	* A hash of all connections associated with this peer, keyed by the remote peer's ID.
	* @deprecated
	* Return type will change from Object to Map<string,[]>
	*/ get connections() {
		const plainConnections = Object.create(null);
		for (const [k, v] of this._connections) plainConnections[k] = v;
		return plainConnections;
	}
	/**
	* true if this peer and all of its connections can no longer be used.
	*/ get destroyed() {
		return this._destroyed;
	}
	/**
	* false if there is an active connection to the PeerServer.
	*/ get disconnected() {
		return this._disconnected;
	}
	constructor(id, options) {
		super(), this._serializers = {
			raw: $bbaee3f15f714663$export$6f88fe47d32c9c94,
			json: $817f931e3f9096cf$export$48880ac635f47186,
			binary: $9fcfddb3ae148f88$export$f0a5a64d5bb37108,
			"binary-utf8": $9fcfddb3ae148f88$export$f0a5a64d5bb37108,
			default: $9fcfddb3ae148f88$export$f0a5a64d5bb37108
		}, this._id = null, this._lastServerId = null, this._destroyed = false, this._disconnected = false, this._open = false, this._connections = /* @__PURE__ */ new Map(), this._lostMessages = /* @__PURE__ */ new Map();
		let userId;
		if (id && id.constructor == Object) options = id;
		else if (id) userId = id.toString();
		options = {
			debug: 0,
			host: $4f4134156c446392$export$7debb50ef11d5e0b.CLOUD_HOST,
			port: $4f4134156c446392$export$7debb50ef11d5e0b.CLOUD_PORT,
			path: "/",
			key: $416260bce337df90$export$ecd1fc136c422448.DEFAULT_KEY,
			token: $4f4134156c446392$export$7debb50ef11d5e0b.randomToken(),
			config: $4f4134156c446392$export$7debb50ef11d5e0b.defaultConfig,
			referrerPolicy: "strict-origin-when-cross-origin",
			serializers: {},
			...options
		};
		this._options = options;
		this._serializers = {
			...this._serializers,
			...this.options.serializers
		};
		if (this._options.host === "/") this._options.host = window.location.hostname;
		if (this._options.path) {
			if (this._options.path[0] !== "/") this._options.path = "/" + this._options.path;
			if (this._options.path[this._options.path.length - 1] !== "/") this._options.path += "/";
		}
		if (this._options.secure === void 0 && this._options.host !== $4f4134156c446392$export$7debb50ef11d5e0b.CLOUD_HOST) this._options.secure = $4f4134156c446392$export$7debb50ef11d5e0b.isSecure();
		else if (this._options.host == $4f4134156c446392$export$7debb50ef11d5e0b.CLOUD_HOST) this._options.secure = true;
		if (this._options.logFunction) $257947e92926277a$export$2e2bcd8739ae039.setLogFunction(this._options.logFunction);
		$257947e92926277a$export$2e2bcd8739ae039.logLevel = this._options.debug || 0;
		this._api = new $abf266641927cd89$export$2c4e825dc9120f87(options);
		this._socket = this._createServerConnection();
		if (!$4f4134156c446392$export$7debb50ef11d5e0b.supports.audioVideo && !$4f4134156c446392$export$7debb50ef11d5e0b.supports.data) {
			this._delayedAbort($78455e22dea96b8c$export$9547aaa2e39030ff.BrowserIncompatible, "The current browser does not support WebRTC");
			return;
		}
		if (!!userId && !$4f4134156c446392$export$7debb50ef11d5e0b.validateId(userId)) {
			this._delayedAbort($78455e22dea96b8c$export$9547aaa2e39030ff.InvalidID, `ID "${userId}" is invalid`);
			return;
		}
		if (userId) this._initialize(userId);
		else this._api.retrieveId().then((id) => this._initialize(id)).catch((error) => this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.ServerError, error));
	}
	_createServerConnection() {
		const socket = new $8f5bfa60836d261d$export$4798917dbf149b79(this._options.secure, this._options.host, this._options.port, this._options.path, this._options.key, this._options.pingInterval);
		socket.on($78455e22dea96b8c$export$3b5c4a4b6354f023.Message, (data) => {
			this._handleMessage(data);
		});
		socket.on($78455e22dea96b8c$export$3b5c4a4b6354f023.Error, (error) => {
			this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.SocketError, error);
		});
		socket.on($78455e22dea96b8c$export$3b5c4a4b6354f023.Disconnected, () => {
			if (this.disconnected) return;
			this.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.Network, "Lost connection to server.");
			this.disconnect();
		});
		socket.on($78455e22dea96b8c$export$3b5c4a4b6354f023.Close, () => {
			if (this.disconnected) return;
			this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.SocketClosed, "Underlying socket is already closed.");
		});
		return socket;
	}
	/** Initialize a connection with the server. */ _initialize(id) {
		this._id = id;
		this.socket.start(id, this._options.token);
	}
	/** Handles messages from the server. */ _handleMessage(message) {
		const type = message.type;
		const payload = message.payload;
		const peerId = message.src;
		switch (type) {
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Open:
				this._lastServerId = this.id;
				this._open = true;
				this.emit("open", this.id);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Error:
				this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.ServerError, payload.msg);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.IdTaken:
				this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.UnavailableID, `ID "${this.id}" is taken`);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.InvalidKey:
				this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.InvalidKey, `API KEY "${this._options.key}" is invalid`);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Leave:
				$257947e92926277a$export$2e2bcd8739ae039.log(`Received leave message from ${peerId}`);
				this._cleanupPeer(peerId);
				this._connections.delete(peerId);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Expire:
				this.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.PeerUnavailable, `Could not connect to peer ${peerId}`);
				break;
			case $78455e22dea96b8c$export$adb4a1754da6f10d.Offer: {
				const connectionId = payload.connectionId;
				let connection = this.getConnection(peerId, connectionId);
				if (connection) {
					connection.close();
					$257947e92926277a$export$2e2bcd8739ae039.warn(`Offer received for existing Connection ID:${connectionId}`);
				}
				if (payload.type === $78455e22dea96b8c$export$3157d57b4135e3bc.Media) {
					const mediaConnection = new $5c1d08c7c57da9a3$export$4a84e95a2324ac29(peerId, this, {
						connectionId,
						_payload: payload,
						metadata: payload.metadata
					});
					connection = mediaConnection;
					this._addConnection(peerId, connection);
					this.emit("call", mediaConnection);
				} else if (payload.type === $78455e22dea96b8c$export$3157d57b4135e3bc.Data) {
					const dataConnection = new this._serializers[payload.serialization](peerId, this, {
						connectionId,
						_payload: payload,
						metadata: payload.metadata,
						label: payload.label,
						serialization: payload.serialization,
						reliable: payload.reliable
					});
					connection = dataConnection;
					this._addConnection(peerId, connection);
					this.emit("connection", dataConnection);
				} else {
					$257947e92926277a$export$2e2bcd8739ae039.warn(`Received malformed connection type:${payload.type}`);
					return;
				}
				const messages = this._getMessages(connectionId);
				for (const message of messages) connection.handleMessage(message);
				break;
			}
			default: {
				if (!payload) {
					$257947e92926277a$export$2e2bcd8739ae039.warn(`You received a malformed message from ${peerId} of type ${type}`);
					return;
				}
				const connectionId = payload.connectionId;
				const connection = this.getConnection(peerId, connectionId);
				if (connection && connection.peerConnection) connection.handleMessage(message);
				else if (connectionId) this._storeMessage(connectionId, message);
				else $257947e92926277a$export$2e2bcd8739ae039.warn("You received an unrecognized message:", message);
				break;
			}
		}
	}
	/** Stores messages without a set up connection, to be claimed later. */ _storeMessage(connectionId, message) {
		if (!this._lostMessages.has(connectionId)) this._lostMessages.set(connectionId, []);
		this._lostMessages.get(connectionId).push(message);
	}
	/**
	* Retrieve messages from lost message store
	* @internal
	*/ _getMessages(connectionId) {
		const messages = this._lostMessages.get(connectionId);
		if (messages) {
			this._lostMessages.delete(connectionId);
			return messages;
		}
		return [];
	}
	/**
	* Connects to the remote peer specified by id and returns a data connection.
	* @param peer The brokering ID of the remote peer (their {@apilink Peer.id}).
	* @param options for specifying details about Peer Connection
	*/ connect(peer, options = {}) {
		options = {
			serialization: "default",
			...options
		};
		if (this.disconnected) {
			$257947e92926277a$export$2e2bcd8739ae039.warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect, or call reconnect on this peer if you believe its ID to still be available.");
			this.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.Disconnected, "Cannot connect to new Peer after disconnecting from server.");
			return;
		}
		const dataConnection = new this._serializers[options.serialization](peer, this, options);
		this._addConnection(peer, dataConnection);
		return dataConnection;
	}
	/**
	* Calls the remote peer specified by id and returns a media connection.
	* @param peer The brokering ID of the remote peer (their peer.id).
	* @param stream The caller's media stream
	* @param options Metadata associated with the connection, passed in by whoever initiated the connection.
	*/ call(peer, stream, options = {}) {
		if (this.disconnected) {
			$257947e92926277a$export$2e2bcd8739ae039.warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect.");
			this.emitError($78455e22dea96b8c$export$9547aaa2e39030ff.Disconnected, "Cannot connect to new Peer after disconnecting from server.");
			return;
		}
		if (!stream) {
			$257947e92926277a$export$2e2bcd8739ae039.error("To call a peer, you must provide a stream from your browser's `getUserMedia`.");
			return;
		}
		const mediaConnection = new $5c1d08c7c57da9a3$export$4a84e95a2324ac29(peer, this, {
			...options,
			_stream: stream
		});
		this._addConnection(peer, mediaConnection);
		return mediaConnection;
	}
	/** Add a data/media connection to this peer. */ _addConnection(peerId, connection) {
		$257947e92926277a$export$2e2bcd8739ae039.log(`add connection ${connection.type}:${connection.connectionId} to peerId:${peerId}`);
		if (!this._connections.has(peerId)) this._connections.set(peerId, []);
		this._connections.get(peerId).push(connection);
	}
	_removeConnection(connection) {
		const connections = this._connections.get(connection.peer);
		if (connections) {
			const index = connections.indexOf(connection);
			if (index !== -1) connections.splice(index, 1);
		}
		this._lostMessages.delete(connection.connectionId);
	}
	/** Retrieve a data/media connection for this peer. */ getConnection(peerId, connectionId) {
		const connections = this._connections.get(peerId);
		if (!connections) return null;
		for (const connection of connections) if (connection.connectionId === connectionId) return connection;
		return null;
	}
	_delayedAbort(type, message) {
		setTimeout(() => {
			this._abort(type, message);
		}, 0);
	}
	/**
	* Emits an error message and destroys the Peer.
	* The Peer is not destroyed if it's in a disconnected state, in which case
	* it retains its disconnected state and its existing connections.
	*/ _abort(type, message) {
		$257947e92926277a$export$2e2bcd8739ae039.error("Aborting!");
		this.emitError(type, message);
		if (!this._lastServerId) this.destroy();
		else this.disconnect();
	}
	/**
	* Destroys the Peer: closes all active connections as well as the connection
	* to the server.
	*
	* :::caution
	* This cannot be undone; the respective peer object will no longer be able
	* to create or receive any connections, its ID will be forfeited on the server,
	* and all of its data and media connections will be closed.
	* :::
	*/ destroy() {
		if (this.destroyed) return;
		$257947e92926277a$export$2e2bcd8739ae039.log(`Destroy peer with ID:${this.id}`);
		this.disconnect();
		this._cleanup();
		this._destroyed = true;
		this.emit("close");
	}
	/** Disconnects every connection on this peer. */ _cleanup() {
		for (const peerId of this._connections.keys()) {
			this._cleanupPeer(peerId);
			this._connections.delete(peerId);
		}
		this.socket.removeAllListeners();
	}
	/** Closes all connections to this peer. */ _cleanupPeer(peerId) {
		const connections = this._connections.get(peerId);
		if (!connections) return;
		for (const connection of connections) connection.close();
	}
	/**
	* Disconnects the Peer's connection to the PeerServer. Does not close any
	*  active connections.
	* Warning: The peer can no longer create or accept connections after being
	*  disconnected. It also cannot reconnect to the server.
	*/ disconnect() {
		if (this.disconnected) return;
		const currentId = this.id;
		$257947e92926277a$export$2e2bcd8739ae039.log(`Disconnect peer with ID:${currentId}`);
		this._disconnected = true;
		this._open = false;
		this.socket.close();
		this._lastServerId = currentId;
		this._id = null;
		this.emit("disconnected", currentId);
	}
	/** Attempts to reconnect with the same ID.
	*
	* Only {@apilink Peer.disconnect | disconnected peers} can be reconnected.
	* Destroyed peers cannot be reconnected.
	* If the connection fails (as an example, if the peer's old ID is now taken),
	* the peer's existing connections will not close, but any associated errors events will fire.
	*/ reconnect() {
		if (this.disconnected && !this.destroyed) {
			$257947e92926277a$export$2e2bcd8739ae039.log(`Attempting reconnection to server with ID ${this._lastServerId}`);
			this._disconnected = false;
			this._initialize(this._lastServerId);
		} else if (this.destroyed) throw new Error("This peer cannot reconnect to the server. It has already been destroyed.");
		else if (!this.disconnected && !this.open) $257947e92926277a$export$2e2bcd8739ae039.error("In a hurry? We're still trying to make the initial connection!");
		else throw new Error(`Peer ${this.id} cannot reconnect because it is not disconnected from the server!`);
	}
	/**
	* Get a list of available peer IDs. If you're running your own server, you'll
	* want to set allow_discovery: true in the PeerServer options. If you're using
	* the cloud server, email team@peerjs.com to get the functionality enabled for
	* your key.
	*/ listAllPeers(cb = (_) => {}) {
		this._api.listAllPeers().then((peers) => cb(peers)).catch((error) => this._abort($78455e22dea96b8c$export$9547aaa2e39030ff.ServerError, error));
	}
};
//#endregion
//#region src/peer/PeerJsRoomTransport.ts
/**
* PeerJsRoomTransport — PeerJS-based room-code signaling adapter for CarryOkie.
*
* Replaces manual SDP offer/answer blob exchange with simple room-code join.
* Uses PeerJS Cloud by default; no custom backend needed.
* WebRTC data/media still flows peer-to-peer after signaling.
*/
var AUTO_JOIN_WEBRTC_OFFER = "AUTO_JOIN_WEBRTC_OFFER";
var AUTO_JOIN_WEBRTC_ANSWER = "AUTO_JOIN_WEBRTC_ANSWER";
var AUTO_JOIN_FAILED = "AUTO_JOIN_FAILED";
var STUN_SERVER = { urls: "stun:stun.l.google.com:19302" };
var PeerJsRoomTransport = class {
	peer = null;
	connections = /* @__PURE__ */ new Map();
	handlers;
	_state = "idle";
	_myId = null;
	_roomCode = null;
	_isHost = false;
	constructor(handlers) {
		this.handlers = handlers;
	}
	get state() {
		return this._state;
	}
	get myId() {
		return this._myId;
	}
	get roomCode() {
		return this._roomCode;
	}
	get isHost() {
		return this._isHost;
	}
	get connectedPeerIds() {
		return [...this.connections.keys()];
	}
	setState(s) {
		this._state = s;
		this.handlers.onStateChange(s);
	}
	/**
	* Host: create a room with the given room code as the PeerJS peer ID.
	* If the ID is taken, onError fires with "unavailable-id" and caller must retry.
	*/
	async startHost(roomCode) {
		this._isHost = true;
		this._roomCode = roomCode;
		this.setState("starting");
		return new Promise((resolve, reject) => {
			const peer = new $dd0187d7f28e386f$export$2e2bcd8739ae039(roomCode, {
				config: { iceServers: [STUN_SERVER] },
				debug: 0
			});
			const onOpen = (id) => {
				this._myId = id;
				this._roomCode = id;
				this.setState("ready");
				peer.off("error", onError);
				resolve();
			};
			const onError = (err) => {
				peer.off("open", onOpen);
				peer.destroy();
				this.peer = null;
				this.setState("failed");
				reject(err);
			};
			peer.on("open", onOpen);
			peer.on("error", onError);
			peer.on("connection", (conn) => this.attachConnection(conn));
			peer.on("disconnected", () => {
				this.setState("disconnected");
				peer.reconnect?.();
			});
			peer.on("close", () => {
				this.setState("disconnected");
			});
			this.peer = peer;
		});
	}
	/**
	* Player: join a room by room code.
	*/
	async joinRoom(roomCode, playerInfo) {
		this._isHost = false;
		this._roomCode = roomCode;
		this.setState("starting");
		return new Promise((resolve, reject) => {
			const peer = new $dd0187d7f28e386f$export$2e2bcd8739ae039({
				config: { iceServers: [STUN_SERVER] },
				debug: 0
			});
			const onOpen = (id) => {
				this._myId = id;
				const conn = peer.connect(roomCode, {
					reliable: true,
					serialization: "json",
					metadata: playerInfo || {}
				});
				this.attachConnection(conn);
				const onConnOpen = () => {
					conn.off("error", onConnError);
					this.setState("connected");
					peer.off("error", onPeerError);
					resolve();
				};
				const onConnError = (err) => {
					conn.off("open", onConnOpen);
					reject(err);
				};
				conn.on("open", onConnOpen);
				conn.on("error", onConnError);
			};
			const onPeerError = (err) => {
				peer.off("open", onOpen);
				peer.destroy();
				this.peer = null;
				this.setState("failed");
				reject(err);
			};
			peer.on("open", onOpen);
			peer.on("error", onPeerError);
			peer.on("disconnected", () => {
				this.setState("disconnected");
				peer.reconnect?.();
			});
			peer.on("close", () => {
				this.setState("disconnected");
			});
			this.peer = peer;
		});
	}
	_autoJoinAnswerResolvers = /* @__PURE__ */ new Map();
	attachConnection(conn) {
		conn.on("open", () => {
			this.connections.set(conn.peer, conn);
			this.handlers.onPeerConnected(conn.peer, conn.metadata);
			if (!this._isHost && this._state !== "connected") this.setState("connected");
		});
		conn.on("data", (data) => {
			try {
				const msg = typeof data === "string" ? JSON.parse(data) : data;
				if (!msg?.type) return;
				if (msg.type === "AUTO_JOIN_WEBRTC_OFFER" && this._isHost) {
					const offerText = msg.offer || "";
					if (offerText && this.handlers.onAutoJoinOffer) this.handlers.onAutoJoinOffer(conn.peer, offerText);
					return;
				}
				if (msg.type === "AUTO_JOIN_WEBRTC_ANSWER" && !this._isHost) {
					const answerText = msg.answer || "";
					const resolver = this._autoJoinAnswerResolvers.get(conn.peer);
					if (resolver) {
						clearTimeout(resolver.timer);
						this._autoJoinAnswerResolvers.delete(conn.peer);
						resolver.resolve(answerText);
					}
					if (this.handlers.onAutoJoinAnswer) this.handlers.onAutoJoinAnswer(conn.peer, answerText);
					return;
				}
				if (msg.type === "AUTO_JOIN_FAILED" && !this._isHost) {
					const resolver = this._autoJoinAnswerResolvers.get(conn.peer);
					if (resolver) {
						clearTimeout(resolver.timer);
						this._autoJoinAnswerResolvers.delete(conn.peer);
						resolver.reject(new Error(String(msg.reason || "Auto-join failed")));
					}
					return;
				}
				if (msg?.type) this.handlers.onMessage(conn.peer, msg);
			} catch {}
		});
		conn.on("close", () => {
			this.connections.delete(conn.peer);
			const resolver = this._autoJoinAnswerResolvers.get(conn.peer);
			if (resolver) {
				clearTimeout(resolver.timer);
				this._autoJoinAnswerResolvers.delete(conn.peer);
				resolver.reject(/* @__PURE__ */ new Error("Connection closed during auto-join"));
			}
			this.handlers.onPeerDisconnected(conn.peer);
		});
		conn.on("error", (err) => {
			this.handlers.onError(err);
		});
	}
	/**
	* Host: accept a PeerNode offer from a player and send back the answer.
	* Call this after processing the offer through PeerNode.acceptManualOffer().
	*/
	sendAutoJoinAnswer(peerId, answerText) {
		this.sendTo(peerId, {
			type: AUTO_JOIN_WEBRTC_ANSWER,
			answer: answerText
		});
	}
	/**
	* Host: notify a player that their auto-join failed.
	*/
	sendAutoJoinFailed(peerId, reason) {
		this.sendTo(peerId, {
			type: AUTO_JOIN_FAILED,
			reason
		});
	}
	/**
	* Player: send a PeerNode offer to the host over PeerJS.
	*/
	sendAutoJoinOffer(offerText) {
		if (!this._roomCode) throw new Error("Not in a room");
		this.sendTo(this._roomCode, {
			type: AUTO_JOIN_WEBRTC_OFFER,
			offer: offerText
		});
	}
	/**
	* Player: wait for the host's answer after sending an offer.
	*/
	waitForAutoJoinAnswer(timeoutMs = 3e4) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._autoJoinAnswerResolvers.delete(this._roomCode || "unknown");
				reject(/* @__PURE__ */ new Error("Auto-join answer timeout"));
			}, timeoutMs);
			this._autoJoinAnswerResolvers.set(this._roomCode || "unknown", {
				resolve,
				reject,
				timer
			});
		});
	}
	sendTo(peerId, message) {
		const conn = this.connections.get(peerId);
		if (!conn || !conn.open) throw new Error(`PeerJS connection is not open: ${peerId}`);
		conn.send(message);
	}
	disconnectPeer(peerId) {
		const conn = this.connections.get(peerId);
		if (conn) {
			conn.close();
			this.connections.delete(peerId);
		}
	}
	close() {
		for (const conn of this.connections.values()) conn.close();
		this.connections.clear();
		this.peer?.destroy();
		this.peer = null;
		this.setState("idle");
	}
	/**
	* Extract room code from URL hash or query parameter.
	* Priority: #room=CODE > ?room=CODE
	*/
	static readRoomCodeFromUrl() {
		try {
			const fromHash = new URLSearchParams(location.hash.slice(1)).get("room");
			if (fromHash) return fromHash.toUpperCase().trim();
			const fromQuery = new URLSearchParams(location.search).get("room");
			if (fromQuery) return fromQuery.toUpperCase().trim();
		} catch {}
		return null;
	}
	/**
	* Build a player join URL for the given room code.
	*/
	static playerJoinUrl(roomCode) {
		const base = new URL("../player/", location.href);
		base.searchParams.set("room", roomCode);
		base.hash = "";
		return base.toString();
	}
};
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
	const initialRoomCode = (PeerJsRoomTransport.readRoomCodeFromUrl() || "------").toUpperCase();
	const lockedRoomCode = initialRoomCode === "------" ? "" : initialRoomCode;
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
		audioDiagnostics: null,
		receiverMicLatencyStats: null
	};
	root.innerHTML = `<section id="receiverJoinHero" aria-labelledby="receiverJoinTitle"><div class="receiver-code-block"><p class="eyebrow" id="receiverJoinTitle">Scan with any camera app</p><div id="receiverRoomCode" class="room">${escapeHtml$1(initialRoomCode)}</div><p class="receiver-join-help">No app install. No host approval. Scan, enter your name, queue a song, or go live.</p><a id="receiverJoinLink" href="#">Open singer join link</a></div><div id="receiverJoinQr" aria-label="Singer join QR"></div></section><div id="receiverStageStatus"><p class="status-pill">${escapeHtml$1("Waiting for host tab…")}</p></div><section id="receiverActiveSingers"><h2>Singers</h2><p>No active singers</p></section><section id="receiverNowPlaying"><h2>Now Playing</h2><p>Waiting for song…</p></section><section id="receiverMediaRegion"><video id="media" class="castMediaElement" controls playsinline></video><section id="receiverLyricsRegion" class="lyrics big"></section></section><section id="receiverQueuePreview"><h2>Queue</h2><ol></ol></section><section id="receiverLiveMicStatus"><h2>TV Audio</h2><p>Click once after opening/casting this tab so browser audio can play.</p><button id="startReceiverAudio" class="primary">Start TV audio</button><button id="retryLiveMics">Retry live mics</button></section>`;
	const media = root.querySelector("#media");
	const retryLiveMicsButton = root.querySelector("#retryLiveMics");
	const startReceiverAudioButton = root.querySelector("#startReceiverAudio");
	const receiverId = crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
	let receiverPeerNode = null;
	let receiverPeerTransport = null;
	let directReceiverJoined = false;
	let loadedSongId = "";
	let pendingPlay = false;
	async function startReceiverAudio() {
		state.audioOutputUnlocked = true;
		if (media.src) try {
			await media.play();
			if (!liveMicTrackIds.size) state.status = "Backing track playing.";
		} catch (error) {
			state.status = `Tap the video play button if audio is still blocked: ${error.message}`;
		}
		else {
			pendingPlay = true;
			state.status = state.song ? "Audio unlocked. Loading backing track…" : "Audio unlocked. Waiting for host to start a song.";
		}
		if (liveMicTrackIds.size) await tryPlayLiveMics();
		render();
	}
	async function initDirectReceiverPeer() {
		if (!state.roomCode || state.roomCode === "------" || receiverPeerTransport) return;
		receiverPeerNode = new PeerNode(receiverId);
		receiverPeerNode.addEventListener("open", (event) => {
			const remotePeerId = event.detail?.remotePeerId;
			if (!remotePeerId) return;
			receiverPeerNode?.send(remotePeerId, {
				type: RPC.RECEIVER_PEER_READY,
				receiverPeerId: receiverId
			});
			state.status = "Direct singer audio route ready.";
			render();
		});
		receiverPeerNode.addEventListener("track", (event) => {
			const detail = event.detail || {};
			const stream = detail.stream || (detail.track ? new MediaStream([detail.track]) : null);
			if (stream) addLiveMic(stream);
		});
		receiverPeerNode.addEventListener("error", (event) => {
			const message = event.detail?.message || "Direct audio route failed.";
			state.status = String(message);
			render();
		});
		receiverPeerTransport = new PeerJsRoomTransport({
			onStateChange: (peerState) => {
				if (!directReceiverJoined && peerState !== "connected") {
					state.status = `Direct audio route: ${peerState}`;
					render();
				}
			},
			onMessage: () => {},
			onPeerConnected: () => {},
			onPeerDisconnected: () => {},
			onError: (error) => {
				state.status = `Direct audio route error: ${error.message}`;
				render();
			}
		});
		await receiverPeerTransport.joinRoom(state.roomCode.toUpperCase(), {
			role: "receiver",
			receiverPeerId: receiverId
		});
		const offerPayload = await receiverPeerNode.createManualOffer("host");
		receiverPeerTransport.sendAutoJoinOffer(offerPayload.token);
		const answerText = await receiverPeerTransport.waitForAutoJoinAnswer(3e4);
		await receiverPeerNode.acceptManualAnswer(answerText);
		directReceiverJoined = true;
		state.status = "Direct singer audio route connected.";
		render();
	}
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
		if (liveMicTrackIds.size && muted.length) return "Muted.";
		if (liveMicTrackIds.size && !publishing.length) return "Muted.";
		return "No live mic tracks connected.";
	}
	function renderAudioDiagnostics() {
		const diagEl = root.querySelector("#receiverDiagnosticsPanel") || root.ownerDocument?.querySelector("#receiverDiagnosticsPanel");
		if (!diagEl) return;
		const d = state.audioDiagnostics;
		const { audible, muted, publishing } = singerMicSummary();
		const hostLatency = d?.micLatencyStats;
		const receiverLatency = state.receiverMicLatencyStats;
		const receiverBufferMs = typeof receiverLatency?.receiverInboundJitterBufferMs === "number" ? receiverLatency.receiverInboundJitterBufferMs : 0;
		const outputLatencyMs = typeof receiverLatency?.receiverOutputLatencyMs === "number" ? receiverLatency.receiverOutputLatencyMs : 0;
		const estimatedTotalMs = typeof hostLatency?.estimatedPlayerToHostMs === "number" ? Math.round(hostLatency.estimatedPlayerToHostMs + receiverBufferMs + outputLatencyMs) : null;
		const latencyOutput = `<p>Estimated live mic latency: ${estimatedTotalMs == null ? "collecting…" : `~${estimatedTotalMs} ms`}</p><p>Player→host: RTT ${hostLatency?.playerHostRttMs ?? "?"} ms · host jitter buffer ${hostLatency?.hostInboundJitterBufferMs ?? "?"} ms · host jitter ${hostLatency?.hostInboundJitterMs ?? "?"} ms</p><p>Host→receiver: jitter buffer ${receiverLatency?.receiverInboundJitterBufferMs ?? "?"} ms · jitter ${receiverLatency?.receiverInboundJitterMs ?? "?"} ms · lost ${receiverLatency?.receiverInboundPacketsLost ?? "?"} · level ${receiverLatency?.receiverInboundAudioLevel ?? "?"}</p><p>Receiver AudioContext: base ${receiverLatency?.receiverBaseLatencyMs ?? "?"} ms · output ${receiverLatency?.receiverOutputLatencyMs ?? "?"} ms</p>`;
		const liveOutput = `<p>${escapeHtml$1(liveMicPlaybackDiagnostics())}</p>`;
		if (d) diagEl.innerHTML = `<h2>Audio pipeline</h2><p>Host remote tracks: ${d.hostRemoteAudioTracks ?? "?"} · Relayed streams: ${d.hostRelayedStreams ?? "?"} · Receiver ready: ${d.receiverReady ? "yes" : "no"}</p><p>Receiver PC: ${d.receiverPcConnectionState ?? "?"} · ICE: ${d.receiverPcIceState ?? "?"} · Tracks added: ${d.receiverTracksAdded ?? 0}</p>${d.receiverOfferSentAt ? `<p>Offer sent: ${new Date(d.receiverOfferSentAt).toLocaleTimeString()}</p>` : ""}${d.receiverAnswerReceivedAt ? `<p>Answer received: ${new Date(d.receiverAnswerReceivedAt).toLocaleTimeString()}</p>` : ""}${d.receiverLastError ? `<p class="warn">Error: ${escapeHtml$1(String(d.receiverLastError))}</p>` : ""}<p>Autoplay unlocked: ${state.audioOutputUnlocked ? "yes" : "no"} · Live mic tracks: ${liveMicTrackIds.size}</p><p>Publishing singers: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p>${latencyOutput}${liveOutput}`;
		else diagEl.innerHTML = `<h2>Audio pipeline</h2><p>No diagnostics received yet. Waiting for host tab…</p><p>Autoplay unlocked: ${state.audioOutputUnlocked ? "yes" : "no"} · Live mic tracks: ${liveMicTrackIds.size}</p><p>Publishing singers: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p>${latencyOutput}${liveOutput}`;
	}
	function render() {
		const roomEl = root.querySelector("#receiverRoomCode");
		if (roomEl) roomEl.textContent = state.roomCode;
		const playerUrl = PeerJsRoomTransport ? PeerJsRoomTransport.playerJoinUrl(state.roomCode) : new URL(`../player/?room=${encodeURIComponent(state.roomCode)}`, location.href).toString();
		const joinLink = root.querySelector("#receiverJoinLink");
		if (joinLink) {
			joinLink.href = playerUrl;
			joinLink.textContent = playerUrl;
		}
		const joinQr = root.querySelector("#receiverJoinQr");
		if (joinQr) joinQr.innerHTML = state.roomCode === "------" ? "" : qrSvg(playerUrl, {
			scale: 8,
			quiet: 6,
			title: "Join CarryOkie room"
		});
		const queueSingerLabel = (queueItem) => (queueItem.singerNames?.length ? queueItem.singerNames : (queueItem.singerNumbers || []).map((singerNumber) => `#${singerNumber}`)).join(", ");
		const queuePreview = root.querySelector("#receiverQueuePreview");
		if (queuePreview) queuePreview.innerHTML = `<h2>Queue</h2><ol>` + state.queue.map((q) => `<li>${escapeHtml$1(q.title || q.songId)} singers ${escapeHtml$1(queueSingerLabel(q))}</li>`).join("") + `</ol>`;
		const singers = root.querySelector("#receiverActiveSingers");
		if (singers) singers.innerHTML = "<h2>Singers</h2>" + ((state.singers || []).map((p) => `<p>#${escapeHtml$1(p.playerNumber)} ${escapeHtml$1(p.displayName)}</p>`).join("") || "<p>No active singers</p>");
		const nowPlaying = root.querySelector("#receiverNowPlaying");
		if (nowPlaying) nowPlaying.innerHTML = `<h2>Now Playing</h2><p>${state.song ? `${escapeHtml$1(state.song.title)} — ${escapeHtml$1(state.song.artist)}` : "Waiting for song…"}</p>`;
		const resolvedLiveMicStatus = state.liveMicStatus || (liveMicTrackIds.size ? liveMicStatus() : "");
		const stageStatus = root.querySelector("#receiverStageStatus");
		if (stageStatus) stageStatus.innerHTML = `<p class="status-pill">${escapeHtml$1(state.status)}</p>` + (resolvedLiveMicStatus ? `<p class="status-pill live-status">${escapeHtml$1(resolvedLiveMicStatus)}</p>` : "");
		const liveMicStatusEl = root.querySelector("#receiverLiveMicStatus");
		if (liveMicStatusEl) {
			const { audible, muted, publishing } = singerMicSummary();
			liveMicStatusEl.innerHTML = `<h2>TV Audio</h2><p class="subtle">${state.audioOutputUnlocked ? "Receiver audio is unlocked for backing track and live mics." : "Click once after opening/casting this tab so browser audio can play."}</p><p class="subtle">${audible.length ? `Playing ${audible.length} unmuted live mic${audible.length === 1 ? "" : "s"}.` : muted.length ? "Live mic muted." : "Waiting for singer mic…"}</p><p class="subtle">Publishing: ${publishing.length} · Unmuted: ${audible.length} · Muted: ${muted.length}</p><button id="startReceiverAudio" class="primary">Start TV audio</button><button id="retryLiveMics">Retry live mics</button>`;
			liveMicStatusEl.querySelector("#startReceiverAudio")?.addEventListener("click", () => {
				startReceiverAudio();
			});
			liveMicStatusEl.querySelector("#retryLiveMics")?.addEventListener("click", () => {
				tryPlayLiveMics();
			});
		}
		const active = activeLine();
		const lyricsRegion = root.querySelector("#receiverLyricsRegion");
		if (lyricsRegion) lyricsRegion.innerHTML = state.lines.length ? state.lines.map((l) => `<p class="${l === active ? "active" : ""}">${escapeHtml$1(l.text)}</p>`).join("") : "<p>Waiting for lyrics…</p>";
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
				pendingPlay = true;
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
	function payloadRoomCode(payload) {
		return String(payload?.roomCode || "").toUpperCase();
	}
	function payloadMatchesReceiverRoom(payload) {
		if (!lockedRoomCode) return true;
		return payloadRoomCode(payload) === lockedRoomCode;
	}
	function handle(raw) {
		const msg = unpack(raw);
		if (!msg?.type) return;
		const payload = msg.payload;
		if (!payloadMatchesReceiverRoom(payload)) return;
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
		if (msg.type === "CAST_SHOW_JOIN_QR" && payload) state.roomCode = lockedRoomCode || payload.roomCode;
		if (msg.type === "CAST_UPDATE_QUEUE_PREVIEW" && payload) state.queue = payload.queue || [];
		if (msg.type === "RECEIVER_STATE" && payload) {
			state.roomCode = lockedRoomCode || payload.roomCode || state.roomCode;
			state.queue = payload.queue || state.queue;
			state.singers = payload.singers || state.singers;
			if (payload.playbackState) {
				state.playbackState = payload.playbackState;
				state.mediaTimeMs = deriveTvMediaPositionMs(payload.playbackState).positionMs;
			}
			loadSong(payload.song, state.roomCode);
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
			const liveMicSection = root.querySelector("#receiverLiveMicStatus");
			if (liveMicSection) {
				const subtitle = liveMicSection.querySelector("p.subtle");
				if (subtitle) subtitle.outerHTML = liveMicSummaryHtml();
				if (!liveMicSection.contains(liveMicAudio)) liveMicSection.appendChild(liveMicAudio);
			}
			return liveMicAudio;
		}
		const liveMicSection = root.querySelector("#receiverLiveMicStatus");
		if (liveMicSection) {
			liveMicSection.innerHTML = `<h2>TV Audio</h2>${liveMicSummaryHtml()}<button id="startReceiverAudio" class="primary">Start TV audio</button><button id="retryLiveMics">Retry live mics</button>`;
			liveMicSection.querySelector("#startReceiverAudio")?.addEventListener("click", () => {
				startReceiverAudio();
			});
			liveMicSection.querySelector("#retryLiveMics")?.addEventListener("click", () => {
				tryPlayLiveMics();
			});
		}
		liveMicAudio = document.createElement("audio");
		liveMicAudio.autoplay = true;
		liveMicAudio.controls = true;
		liveMicAudio.playsInline = true;
		liveMicAudio.muted = true;
		liveMicAudio.volume = 1;
		liveMicAudio.srcObject = liveMicStream;
		const targetSection = root.querySelector("#receiverLiveMicStatus");
		if (targetSection) targetSection.appendChild(liveMicAudio);
		return liveMicAudio;
	}
	async function ensureLiveMicOutputGraph() {
		const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextCtor) {
			liveMicOutputStatus = "WebAudio unavailable; using media element";
			return;
		}
		if (!liveMicAudioContext) liveMicAudioContext = new AudioContextCtor({ latencyHint: "interactive" });
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
			state.liveMicStatus = "Press 'Start TV audio' to enable live mic audio.";
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
			ensureLiveMicAudio();
		} catch (error) {
			liveMicLastPlayError = error.message;
			state.liveMicStatus = "Tap receiver once or press Retry live mics.";
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
	async function updateReceiverMicLatencyStats(pc) {
		if (!pc?.getStats) return;
		const inbound = [];
		(await pc.getStats()).forEach((stat) => {
			if (stat.type === "inbound-rtp" && (stat.kind === "audio" || stat.mediaType === "audio")) inbound.push(stat);
		});
		if (!inbound.length) return;
		const stats = inbound[inbound.length - 1];
		const jitterBufferMs = stats.jitterBufferDelay && stats.jitterBufferEmittedCount ? stats.jitterBufferDelay / stats.jitterBufferEmittedCount * 1e3 : null;
		state.receiverMicLatencyStats = {
			receiverInboundJitterMs: typeof stats.jitter === "number" ? Math.round(stats.jitter * 1e3) : null,
			receiverInboundJitterBufferMs: typeof jitterBufferMs === "number" ? Math.round(jitterBufferMs) : null,
			receiverInboundPacketsLost: typeof stats.packetsLost === "number" ? stats.packetsLost : null,
			receiverInboundPacketsReceived: typeof stats.packetsReceived === "number" ? stats.packetsReceived : null,
			receiverInboundAudioLevel: typeof stats.audioLevel === "number" ? stats.audioLevel : null,
			receiverBaseLatencyMs: liveMicAudioContext?.baseLatency ? Math.round(liveMicAudioContext.baseLatency * 1e3) : null,
			receiverOutputLatencyMs: liveMicAudioContext?.outputLatency ? Math.round(liveMicAudioContext.outputLatency * 1e3) : 0,
			updatedAt: Date.now()
		};
		renderAudioDiagnostics();
	}
	if (typeof BroadcastChannel !== "undefined") {
		const channel = new BroadcastChannel("carryokie.receiver");
		let pc = null;
		channel.onmessage = async (ev) => {
			const msg = ev.data || {};
			if (msg.type === "RECEIVER_STATE") handle(msg);
			if (msg.type === "RECEIVER_AUDIO_STATUS" && msg.payload && payloadMatchesReceiverRoom(msg.payload)) {
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
				await pc.setLocalDescription(preferLowLatencyAudioSdp(answer));
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
		setInterval(() => {
			updateReceiverMicLatencyStats(pc).catch(() => {});
		}, 2e3);
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
	initDirectReceiverPeer().catch((error) => {
		state.status = `Direct audio route unavailable: ${error.message}`;
		render();
	});
	retryLiveMicsButton.addEventListener("click", () => {
		tryPlayLiveMics();
	});
	startReceiverAudioButton.addEventListener("click", () => {
		startReceiverAudio();
	});
	root.addEventListener("pointerdown", () => {
		if (!state.audioOutputUnlocked) state.audioOutputUnlocked = true;
		if (media.src) media.play().catch(() => {});
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
function hostShell(root) {
	root.innerHTML = `<main id="appShell" class="shell host-shell"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>Host Control Room</h1><p class="hint">Open the TV Stage first, cast that tab, then run the queue.</p></div><div class="mini-stage" aria-hidden="true"><span></span><span></span><span></span></div></header><div id="hostShowControl"><div id="hostTopStatus" class="card"></div><div id="hostActions" class="button-row host-actions"></div><div id="hostPanels"></div><details id="manualPairingToggle" class="card"><summary>Manual Pairing Fallback</summary><div id="manualPairingPanel"></div></details><details id="diagnosticsToggle" class="card"><summary>Diagnostics</summary><div id="diagnosticsPanel"><pre id="audioPipelineStatus"></pre><div id="log" class="log"></div></div></details></div></main>`;
}
function playerShell(root) {
	root.innerHTML = `<div id="playerSingerRemote"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>CarryOkie Singer Remote</h1></div><div class="mini-stage" aria-hidden="true"><span></span><span></span><span></span></div></header><section id="main"></section><details id="playerManualFallbackToggle" class="card"><summary>Manual Pairing Fallback</summary><div id="playerManualFallbackPanel"></div></details><details id="diagnosticsToggle" class="card"><summary>Diagnostics</summary><div id="diagnosticsPanel"><pre id="audioPipelineStatus"></pre><div id="log" class="log"></div></div></details></div>`;
}
function receiverShell(root) {
	root.innerHTML = `<div id="receiverTvStage"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>CarryOkie TV Stage</h1></div></header><section id="main"></section><details id="receiverDiagnosticsToggle" class="card"><summary>Diagnostics</summary><div id="receiverDiagnosticsPanel"><pre id="audioPipelineStatus"></pre><div id="log" class="log"></div></div></details></div>`;
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
		const hostControls = `${queueItem.status === "queued" ? `<button class="startItem" data-queue-id="${queueId}" title="Start on TV">Start now</button>` : ""} <button class="moveUpItem" data-queue-id="${queueId}" title="Move earlier">↑</button> <button class="moveDownItem" data-queue-id="${queueId}" title="Move later">↓</button> <button class="removeItem" data-queue-id="${queueId}" title="Remove">Remove</button>`;
		const phoneControls = !["active", "ended"].includes(queueItem.status) ? `<button class="queueSelf" data-action="join" data-queue-id="${queueId}">Add me</button> <button class="queueSelf" data-action="leave" data-queue-id="${queueId}">Leave</button> ${queueItem.requestedByPlayerId === player?.playerId ? `<button class="startSelf" data-queue-id="${queueId}">Start on TV</button> <button class="queueSelf" data-action="remove" data-queue-id="${queueId}">Cancel request</button>` : ""}` : "";
		return `<li class="queue-item"><div class="queue-top"><strong>${escapeHtml(songTitle(queueItem.songId))}</strong><span class="queue-status queue-status-${status}">${status}</span></div><p class="subtle">Singers: ${escapeHtml(singerNames(room, queueItem.singerNumbers))} · requested by ${escapeHtml(requestedBy)}</p><div class="button-row queue-actions">${mode === "host" ? hostControls : phoneControls}</div></li>`;
	}).join("")}</ul>`;
}
//#endregion
//#region src/app.ts
var room = loadRoom();
var player = JSON.parse(localStorage.getItem("carryokie.player") || "null");
var peerNode;
var peerJsTransport = null;
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
	receiverLastError: null,
	micLatencyStats: null,
	directReceiverPeerId: null,
	directReceiverConnected: false
};
function renderAudioPipelineStatus() {
	const el = $("#audioPipelineStatus");
	if (el) el.textContent = JSON.stringify(audioPipeline, null, 2);
}
function publishAudioPipelineStatus() {
	renderAudioPipelineStatus();
	receiverChannel?.postMessage?.({
		type: "RECEIVER_AUDIO_STATUS",
		payload: {
			...audioPipeline,
			roomCode: room?.roomCode
		}
	});
}
function summarizeInboundAudioStats(report) {
	const inbound = [];
	report?.forEach?.((stat) => {
		if (stat.type === "inbound-rtp" && (stat.kind === "audio" || stat.mediaType === "audio")) inbound.push(stat);
	});
	if (!inbound.length) return null;
	const stats = inbound[inbound.length - 1];
	const jitterBufferMs = stats.jitterBufferDelay && stats.jitterBufferEmittedCount ? stats.jitterBufferDelay / stats.jitterBufferEmittedCount * 1e3 : null;
	return {
		jitterMs: typeof stats.jitter === "number" ? Math.round(stats.jitter * 1e3) : null,
		jitterBufferMs: typeof jitterBufferMs === "number" ? Math.round(jitterBufferMs) : null,
		packetsLost: typeof stats.packetsLost === "number" ? stats.packetsLost : null,
		packetsReceived: typeof stats.packetsReceived === "number" ? stats.packetsReceived : null,
		audioLevel: typeof stats.audioLevel === "number" ? stats.audioLevel : null,
		totalAudioEnergy: typeof stats.totalAudioEnergy === "number" ? stats.totalAudioEnergy : null
	};
}
async function updateHostMicLatencyStats() {
	if (!player?.isHost || !peerNode?.peers?.size) return;
	for (const [remotePeerId, edge] of peerNode.peers) {
		const summary = summarizeInboundAudioStats(await edge.pc.getStats?.());
		if (!summary) continue;
		const halfRttMs = typeof peerNode.clockRttMs === "number" ? Math.round(peerNode.clockRttMs / 2) : null;
		audioPipeline.micLatencyStats = {
			sourcePeerId: remotePeerId,
			playerHostRttMs: peerNode.clockRttMs,
			playerHostClockOffsetMs: Math.round(peerNode.clockOffsetMs || 0),
			hostInboundJitterMs: summary.jitterMs,
			hostInboundJitterBufferMs: summary.jitterBufferMs,
			hostInboundPacketsLost: summary.packetsLost,
			hostInboundPacketsReceived: summary.packetsReceived,
			hostInboundAudioLevel: summary.audioLevel,
			estimatedPlayerToHostMs: halfRttMs == null && summary.jitterBufferMs == null ? null : (halfRttMs || 0) + (summary.jitterBufferMs || 0),
			updatedAt: Date.now()
		};
		publishAudioPipelineStatus();
		return;
	}
}
var peerCloseTimers = /* @__PURE__ */ new Map();
function deriveMicLabel(p) {
	if (!p?.isSingerForCurrentSong) return "Tap Enable My Mic to sing.";
	if (!audio?.localStream) return "Needs microphone permission.";
	if (p.micState?.muted) return "Ready, muted.";
	if (!audioPipeline.hostRemoteAudioTracks) return "Sending to host.";
	if (!audioPipeline.receiverReady) return "Host receiving.";
	if (!audioPipeline.receiverAnswerReceivedAt) return "Host receiving.";
	if ((audioPipeline.receiverTracksAdded || 0) > 0) return "Live on TV.";
	return "Sending to host.";
}
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
		updateHostMicLatencyStats().catch((error) => log(error?.message || "Mic latency stats unavailable."));
	}, 2e3);
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
	renderHost(document.body);
}
function broadcastRoom(type = RPC.ROOM_STATE_SNAPSHOT) {
	peerNode?.broadcast({
		type,
		room
	});
}
async function connectDirectReceiverIfNeeded() {
	if (player?.isHost || !peerNode || !room?.directReceiverPeerId || !room?.hostPeerId) return;
	if (!peerNode.localStreams?.some((stream) => stream?.getAudioTracks?.().length)) return;
	const receiverPeerId = room.directReceiverPeerId;
	if (receiverPeerId === peerNode.localPeerId) return;
	const edge = peerNode.peers?.get(receiverPeerId);
	if (edge && !["failed", "closed"].includes(edge.pc?.connectionState || "")) return;
	try {
		await peerNode.createRelayedOffer(receiverPeerId, room.hostPeerId);
		log("Direct receiver audio offer sent.");
	} catch (error) {
		log(`Direct receiver audio route failed: ${error.message}`);
	}
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
		payload: {
			...sample || {},
			roomCode: room?.roomCode
		}
	});
}
function publishReceiverCommand(type, payload = {}) {
	receiverChannel?.postMessage?.({
		type,
		payload: {
			...payload,
			roomCode: room?.roomCode
		}
	});
}
function sendCastRoomUpdate(type, payload = {}) {
	castController?.sendSafe?.(type, payload);
	publishReceiverState();
}
function findRoomPlayerByMessage(remotePeerId, playerId) {
	if (!room?.players?.length) return null;
	return room.players.find((p) => p.playerId === playerId && p.peerId === remotePeerId) || room.players.find((p) => p.peerId === remotePeerId) || null;
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
function addSelfServeSinger(target) {
	if (!room || !target?.playerId) return false;
	if (!target.isSingerForCurrentSong) {
		const singers = [...new Set([...room.players.filter((p) => p.isSingerForCurrentSong).map((p) => p.playerId), target.playerId])].slice(0, 5);
		assignSingers(room, singers);
		return true;
	}
	return false;
}
function publishMicStateChange(target) {
	if (!target) return;
	broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
	publishReceiverState();
	renderHost(document.body);
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
			tuneAudioSenderForLowLatency(receiverPc.addTrack(track, stream));
		});
		if (!receiverTrackKeys.size) return;
		const offer = await receiverPc.createOffer({ offerToReceiveAudio: true });
		await receiverPc.setLocalDescription(preferLowLatencyAudioSdp(offer));
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
	if (status) status.textContent = deriveMicLabel(player);
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
function roomHasActiveSong() {
	return !!room?.queue?.some((q) => q.status === "active");
}
function startQueueItem(item) {
	if (!item) {
		log("Queue is empty. Singers can add a song from their phones.");
		return;
	}
	if (item.status !== "queued") {
		log("Only queued songs can be started.");
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
	const beforeActive = roomHasActiveSong();
	handleQueueAddRequest$1(room, catalog, remotePeerId, msg);
	const added = room.queue.find((q) => q.queueItemId === msg.item?.queueItemId);
	if (!beforeActive && added?.status === "queued") startQueueItem(added);
}
function handleQueueStartRequest(remotePeerId, msg) {
	if (roomHasActiveSong()) {
		log("Song is already playing; queued request will stay next.");
		return;
	}
	startQueueItem(queuedItemRequestedByActor(room, remotePeerId, msg));
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
			renderHost(document.body);
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
		connectDirectReceiverIfNeeded().catch((error) => log(error.message));
	}
	if (msg.type === RPC.RECEIVER_PEER_READY && player?.isHost) {
		const receiverPeerId = msg.receiverPeerId || remotePeerId;
		room.directReceiverPeerId = receiverPeerId;
		audioPipeline.directReceiverPeerId = receiverPeerId;
		audioPipeline.directReceiverConnected = true;
		peerNode.send(remotePeerId, {
			type: RPC.ROOM_STATE_SNAPSHOT,
			room
		});
		broadcastRoom(RPC.ROOM_STATE_SNAPSHOT);
		publishAudioPipelineStatus();
		log(`Direct receiver peer ready: ${receiverPeerId}`);
	}
	if (msg.type === RPC.QUEUE_ADD_REQUEST && player?.isHost) try {
		handleQueueAddRequest(remotePeerId, msg);
		publishQueueUpdate();
		renderHost(document.body);
	} catch (e) {
		peerNode.send(remotePeerId, {
			type: RPC.ERROR_NOTICE,
			message: e.message
		});
		log(e.message);
	}
	if (msg.type === RPC.QUEUE_START_REQUEST && player?.isHost) try {
		handleQueueStartRequest(remotePeerId, msg);
		publishQueueUpdate();
		renderHost(document.body);
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
		renderHost(document.body);
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
			renderHost(document.body);
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
		connectDirectReceiverIfNeeded().catch((error) => log(error.message));
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
		const sender = findRoomPlayerByMessage(remotePeerId, msg.playerId);
		const singerAdded = addSelfServeSinger(sender);
		const target = updateRoomMicState(remotePeerId, sender?.playerId, {
			enabled: true,
			publishing: true,
			muted: !!msg.muted
		});
		if (target) {
			if (singerAdded) sendCastRoomUpdate("CAST_SET_SINGERS", { players: room.players.filter((p) => p.isSingerForCurrentSong) });
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
	hostShell(root);
	await initPeerJsHost();
	renderHost(root);
}
async function initPeerJsHost() {
	if (!room?.roomCode) return;
	peerJsTransport = new PeerJsRoomTransport({
		onStateChange: (state) => {
			const el = $("#hostQrJoinStatus");
			if (el) el.textContent = state === "ready" ? "QR Join Ready" : state === "starting" ? "QR Join starting..." : state === "failed" ? "Automatic join unavailable — manual fallback ready." : state;
			renderHost(document.body);
		},
		onMessage: () => {},
		onPeerConnected: (peerId) => {
			log(`PeerJS player connected: ${peerId}`);
		},
		onPeerDisconnected: (peerId) => {
			log(`PeerJS player disconnected: ${peerId}`);
		},
		onError: (err) => {
			log(`PeerJS error: ${err.message}`);
		},
		onAutoJoinOffer: async (peerId, offerText) => {
			try {
				const answerPayload = await peerNode.acceptManualOffer(offerText);
				peerJsTransport.sendAutoJoinAnswer(peerId, answerPayload.token);
				log(`Auto-join: answered ${peerId}`);
			} catch (e) {
				log(`Auto-join failed for ${peerId}: ${e.message}`);
				peerJsTransport.sendAutoJoinFailed(peerId, e.message);
			}
		}
	});
	globalThis.__carryokiePeerJsTransport = peerJsTransport;
	try {
		await peerJsTransport.startHost(room.roomCode);
		log(`PeerJS host ready: room ${room.roomCode}`);
	} catch (e) {
		log(`PeerJS host failed: ${e.message}`);
	}
	renderHost(document.body);
}
function renderHost(main) {
	if (!main || !room) return;
	const activeSingers = room.players.filter((p) => p.isSingerForCurrentSong).length;
	const liveMicCount = room.players.filter((p) => p.isSingerForCurrentSong && p.micState?.enabled && !p.micState?.muted).length;
	const qrStatus = peerJsTransport ? peerJsTransport.state === "ready" ? "QR Join Ready" : peerJsTransport.state === "starting" ? "Starting..." : peerJsTransport.state === "failed" ? "Unavailable — manual fallback ready" : "Manual only" : "Manual only";
	const tvStatus = audioPipeline.receiverReady ? audioPipeline.receiverPcConnectionState === "connected" ? "TV Connected" : audioPipeline.receiverPcConnectionState === "failed" ? "TV Failed" : "TV Tab Open" : "TV Not Open";
	const queuedCount = room.queue.filter((q) => q.status === "queued").length;
	const activeSong = room.currentQueueItemId ? songTitle(room.currentSongId || "") : "";
	const hostNextStep = !audioPipeline.receiverReady ? "1. Open TV Stage, then cast that tab to the TV." : !room.queue.length ? "2. Ask singers to scan the TV QR. They can queue, start, and sing from their phones." : !room.currentQueueItemId ? "3. A singer can start their queued song; Start Next is only a host override." : "Show is running. Singers can keep queuing; host controls are backup.";
	const topStatus = $("#hostTopStatus");
	if (topStatus) topStatus.innerHTML = `<div class="host-next-step"><span class="status-label">Next step</span><strong>${escapeHtml(hostNextStep)}</strong></div><div class="host-status-grid">
      <div class="status-item"><span class="status-label">Room</span><span id="hostRoomCode" class="status-value">${escapeHtml(room.roomCode)}</span></div>
      <div class="status-item"><span class="status-label">TV</span><span id="hostTvStatus" class="status-value">${tvStatus}</span></div>
      <div class="status-item"><span class="status-label">QR Join</span><span id="hostQrJoinStatus" class="status-value">${qrStatus}</span></div>
      <div class="status-item"><span class="status-label">Singers</span><span id="hostSingerCount" class="status-value">${room.players.length}/5</span></div>
      <div class="status-item"><span class="status-label">Live Mics</span><span id="hostLiveMicCount" class="status-value">${liveMicCount}</span></div>
      <div class="status-item"><span class="status-label">Queue</span><span id="hostQueueCount" class="status-value">${queuedCount} ready</span></div>
    </div>`;
	const actions = $("#hostActions");
	if (actions) {
		actions.innerHTML = `<button id="openTvStage" class="primary">1 Open TV Stage</button><button id="copySingerLink">Copy Singer Link</button><button id="showJoinQr">Show QR Here</button><button id="newRoom">Start Over</button>`;
		$("#copySingerLink").onclick = async () => {
			const link = PeerJsRoomTransport.playerJoinUrl(room.roomCode);
			try {
				await navigator.clipboard.writeText(link);
			} catch {}
			log("Singer link copied.");
		};
		$("#openTvStage").onclick = () => window.open(receiverUrl(), "_blank");
		$("#showJoinQr").onclick = () => {
			const panel = $("#hostPanels");
			if (panel) {
				const playerUrl = new URL(`../player/?room=${encodeURIComponent(room.roomCode)}`, location.href).toString();
				const peerJsUrl = peerJsTransport ? PeerJsRoomTransport.playerJoinUrl(room.roomCode) : playerUrl;
				panel.innerHTML = `<div class="card"><h2>Singer Join QR</h2><p class="hint">Scan with any camera app to join, queue songs, or sing live.</p><div id="showQrContainer"></div><p><a href="${escapeHtml(peerJsUrl)}" id="singerJoinLink">${escapeHtml(peerJsUrl)}</a></p></div>`;
				const qrContainer = $("#showQrContainer");
				if (qrContainer) qrContainer.innerHTML = qrSvg(peerJsUrl, {
					scale: 7,
					quiet: 6,
					title: "Join CarryOkie room"
				});
			}
		};
		$("#newRoom").onclick = () => {
			player = makePlayer("host", "Host");
			player.playerNumber = 1;
			room = makeRoom(player);
			persist();
			location.reload();
		};
	}
	const panels = $("#hostPanels");
	if (panels) {
		const setupComplete = room.players.length > 1 && room.queue.length > 0;
		panels.innerHTML = `<div class="host-panels">
      <section class="host-journey grid">
        <div class="card step-card ${audioPipeline.receiverReady ? "step-done" : ""}"><p class="eyebrow">Step 1 · TV</p><h2>Open and cast TV Stage</h2><p>Use the button above. Cast the TV Stage browser tab, not this host control tab.</p></div>
        <div class="card step-card ${room.players.length > 1 ? "step-done" : ""}"><p class="eyebrow">Step 2 · Singers</p><h2>Singers scan the TV QR</h2><p>They enter a name, queue songs, and can go live without host approval.</p></div>
        <div class="card step-card ${room.currentQueueItemId ? "step-done" : ""}"><p class="eyebrow">Step 3 · Show</p><h2>${activeSong ? escapeHtml(activeSong) : "Start the first queued song"}</h2><p>${room.queue.length ? `${queuedCount} queued song${queuedCount === 1 ? "" : "s"} ready.` : "Waiting for singers to queue songs."}</p></div>
      </section>
      <details class="card" ${setupComplete ? "" : "open"}><summary>Setup help</summary><ol class="quickstart"><li>Click <strong>Open TV Stage</strong>.</li><li>Cast that receiver/TV Stage tab to the TV.</li><li>Click <strong>Start TV audio</strong> on the TV tab once if the browser blocks sound.</li><li>Singers scan the TV QR with any camera app.</li><li>Singers queue/start songs and enable their mic from their phone. Host controls are backup.</li></ol></details>
      <div class="card queue-card"><h2>Host Backup Controls</h2><p class="hint">Singers can start their own queued songs when the TV is idle. Use these controls only to recover, pause, or override the room.</p><div class="button-row"><button id="startNext" class="primary">Start Next Queued Song</button><button id="pauseSong">Pause TV</button><button id="resumeSong">Resume TV</button></div>${queueHtml(room, "host")}</div>
      <details class="card"><summary>Singers (${activeSingers} active)</summary>${room.players.map((p) => `<div class="singer-row"><label class="check"><input type="checkbox" class="singer" value="${p.playerId}" ${p.isSingerForCurrentSong ? "checked" : ""}> #${p.playerNumber || "?"} ${escapeHtml(p.displayName)} ${p.micState?.enabled ? p.micState.muted ? "(muted)" : "(live)" : ""}</label></div>`).join("")}<div class="button-row"><button id="setSingers" class="primary">Update Singers</button></div></details>
      <details class="card"><summary>Now Playing</summary>${room.currentQueueItemId ? `<p>${escapeHtml(songTitle(room.currentSongId || ""))}</p>` : "<p>No song active</p>"}${room.players.some((p) => p.isSingerForCurrentSong) ? "<p class=\"warn\">TV bleed risk: singers should use headphones.</p>" : ""}</details>
    </div>`;
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
		document.querySelectorAll(".startItem").forEach((b) => b.onclick = () => {
			startQueueItem(room.queue.find((q) => q.queueItemId === b.dataset.queueId));
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
			const t = room.players.find((p) => p.playerId === b.dataset.playerId);
			if (t) peerNode.send(t.peerId, {
				type: RPC.MIC_MUTED,
				playerId: t.playerId
			});
		});
	}
	const manualPanel = $("#manualPairingPanel");
	if (manualPanel) {
		manualPanel.innerHTML = `<p>Player creates a join code. Paste or scan it here, then send back the host answer.</p><textarea id="offer" placeholder="Paste player offer/link/chunks"></textarea><div class="button-row"><button id="scanOfferQr">Scan player QR</button><button id="answerOffer" class="primary">Create host answer</button></div><div id="answerOut"></div>`;
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
	}
	const cast = castController || (castController = new CastController("CC1AD845"));
	attachCastListeners(cast);
	const castStatus = $("#castStatus");
	const castButton = $("#castBtn");
	if (castStatus && castButton) {
		castStatus.textContent = "Click to connect to Chromecast";
		castButton.onclick = async () => {
			try {
				saveCastOrigin();
				castButton.disabled = true;
				castStatus.textContent = "Connecting to Chromecast…";
				await cast.init();
				await cast.requestSession();
				castButton.style.display = "none";
				showCastControls();
				castStatus.textContent = "Connected to TV";
				publishReceiverState();
				log("Cast connected");
				await loadCurrentSongOnTv();
			} catch (e) {
				castButton.disabled = false;
				log(e.message);
			}
		};
	}
	const castLoadButton = $("#castLoadBtn");
	if (castLoadButton) castLoadButton.onclick = () => {
		saveCastOrigin();
		loadCurrentSongOnTv();
	};
	const castPlayButton = $("#castPlayBtn");
	if (castPlayButton) castPlayButton.onclick = () => {
		publishReceiverCommand("CAST_PLAY");
		cast.play().catch((e) => log(e.message));
	};
	const castPauseButton = $("#castPause");
	if (castPauseButton) castPauseButton.onclick = () => {
		publishReceiverCommand("CAST_PAUSE");
		cast.pause();
	};
	const castSeekButton = $("#castSeek");
	if (castSeekButton) castSeekButton.onclick = () => {
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
	playerShell(root);
	showManualFallbackPanel();
	renderPlayer($("#main"));
}
function roomCodeFromLocation() {
	return PeerJsRoomTransport.readRoomCodeFromUrl() || room?.roomCode || "";
}
function playerIsJoined() {
	return !!(room?.hostPeerId && player?.playerNumber && room.players?.some((p) => p.playerId === player.playerId || p.peerId === player.peerId));
}
function joinRoomHtml(roomCode) {
	return `<section id="playerJoinCard" class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie Singer Remote</p><h2>Join Room</h2><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div></div><div class="card"><label>Room Code<p id="playerRoomCode" class="status-pill">${escapeHtml((roomCode || "").toUpperCase() || "—")}</p></label><label>Your Name<input id="playerDisplayName" value="${escapeHtml(player?.displayName || "")}" placeholder="Your name"></label><button id="joinRoom" class="primary">Join Room</button></div></section>`;
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
	$("#joinRoom").onclick = async () => {
		const roomCode = roomCodeFromLocation();
		const displayName = normalizeDisplayName($("#playerDisplayName")?.value, "Player");
		player.displayName = displayName;
		persist();
		const button = $("#joinRoom");
		if (button) {
			button.disabled = true;
			button.textContent = "Joining...";
		}
		try {
			await initPeerJsPlayer(roomCode);
		} catch (e) {
			log(`Auto-join failed: ${e.message}. Use manual fallback below.`);
			if (button) {
				button.disabled = false;
				button.textContent = "Join Room";
			}
			const manualToggle = $("#playerManualFallbackToggle");
			if (manualToggle) manualToggle.open = true;
			showManualFallbackPanel();
		}
	};
	$("#displayName")?.addEventListener("change", updatePlayerDisplayName);
}
async function initPeerJsPlayer(roomCode) {
	if (!roomCode) throw new Error("No room code");
	peerJsTransport = new PeerJsRoomTransport({
		onStateChange: (state) => {
			log(`PeerJS state: ${state}`);
			const status = $("#playerConnectionStatus");
			if (status) status.textContent = state;
		},
		onMessage: () => {},
		onPeerConnected: () => {},
		onPeerDisconnected: () => {},
		onError: (err) => {
			log(`PeerJS error: ${err.message}`);
		}
	});
	globalThis.__carryokiePeerJsTransport = peerJsTransport;
	await peerJsTransport.joinRoom(roomCode.toUpperCase(), {
		displayName: player.displayName,
		playerId: player.playerId
	});
	log(`PeerJS joined room ${roomCode}`);
	const offerPayload = await peerNode.createManualOffer("host");
	peerJsTransport.sendAutoJoinOffer(offerPayload.token);
	log("Auto-join: offer sent, waiting for answer...");
	const answerText = await peerJsTransport.waitForAutoJoinAnswer(3e4);
	await peerNode.acceptManualAnswer(answerText);
	log("Auto-join: answer received, DataChannel opening...");
}
function showManualFallbackPanel() {
	const panel = $("#playerManualFallbackPanel");
	if (!panel) return;
	panel.innerHTML = `<p>Player creates a join code, then imports the host answer.</p><button id="makeOffer" class="primary">Create phone pairing code</button><div id="offerOut"></div><label>Host answer<textarea id="answer" placeholder="Paste host answer/link/chunks"></textarea></label><div class="button-row"><button id="scanAnswerQr">Scan host answer QR</button><button id="importAnswer" class="primary">Finish pairing</button></div>`;
	$("#makeOffer").onclick = async () => {
		const button = $("#makeOffer");
		try {
			if (button) {
				button.disabled = true;
				button.textContent = "Creating code...";
			}
			updatePlayerDisplayName();
			assertWebRtcSupported();
			const encoded = await peerNode.createManualOffer("host");
			renderPayloadCard($("#offerOut"), encoded, "Player offer");
		} catch (e) {
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
}
function renderPlayer(main) {
	if (!main) return;
	const song = catalog.find((s) => s.songId === (room?.currentSongId || "song_002")) || catalog[0];
	const roomCode = roomCodeFromLocation();
	const currentTitle = song ? `${escapeHtml(song.title || song.songId)}${song.artist ? " — " + escapeHtml(song.artist) : ""}` : "Pick a song";
	const micLabel = deriveMicLabel(player);
	if (!playerIsJoined()) {
		main.innerHTML = joinRoomHtml(roomCode);
		attachJoinHandlers();
		return;
	}
	main.innerHTML = `<section id="playerSingerRemote" class="phone-screen"><div class="phone-hero card"><p class="eyebrow">CarryOkie Singer Remote</p><h2>${currentTitle}</h2><p class="subtle"><span id="playerRoomCode">Room ${escapeHtml(roomCode)}</span> · Player #${escapeHtml(player.playerNumber || "?")} · <span id="playerConnectionStatus">connected</span></p><div class="soundwave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><p id="micStatus" class="status-pill ${micLabel.includes("Live") ? "live-status" : ""}">${escapeHtml(micLabel)}</p><div class="primary-actions"><button id="enableMic" class="primary">Enable My Mic</button><button id="holdSing" class="hold-button">Hold to Sing</button><button id="toggleSing">Live / Mute</button><button id="muteMic" class="danger">Mute Mic</button></div></div>
<details id="queueSongPanel" class="card" open><summary>Queue / Start Song</summary><label>Your Name<input id="displayName" value="${escapeHtml(player.displayName || "Player")}" placeholder="Your name"></label><label>Song<select id="song">${catalog.map((s) => `<option value="${s.songId}">${escapeHtml(s.title)} — ${escapeHtml(s.artist)}</option>`).join("")}</select></label><label>Singers<input id="singers" value="${player.playerNumber || 2}" placeholder="Singer numbers comma separated"></label><p class="subtle">Default singer is you. If nothing is playing, your request starts on the TV automatically. Add more numbers only for duets/groups.</p><div class="button-row"><button id="requestSong" class="primary">Queue / Start on TV</button><button id="requestSinger">Go Live as Singer</button></div><div class="queue-list">${queueHtml(room, "phone")}</div></details>
<details id="soundSettingsPanel" class="card"><summary>Sing</summary><p class="warn compact">${escapeHtml(singerWarning)}</p><label class="check"><input type="checkbox" id="pushToSing"> Push-to-sing</label><label>Mic Filter<select id="voicePreset"><option value="clean">Clean</option><option value="alto">Alto warm</option><option value="bravo">Bravo bright</option><option value="bass">Bass low</option><option value="radio">Radio</option><option value="autotune">Autotune-style polish</option></select></label><p id="wake" class="subtle"></p></details>
<details class="card"><summary>Advanced Audio</summary><div class="button-row"><button id="startBacking">Start backing monitor</button><button id="pauseBacking">Pause backing monitor</button></div><label>Remote gain <input id="remoteGain" type="range" min="0" max="2" value="1" step=".05"></label><label>Backing monitor gain <input id="backingGain" type="range" min="0" max="1" value="0.35" step=".05"></label><label>Master gain <input id="masterGain" type="range" min="0" max="2" value="1" step=".05"></label></details>
<details class="card"><summary>Lyrics / Sync</summary><video id="phoneVideo" controls playsinline muted></video><div id="lyricsPanel"></div><div class="button-row"><button id="earlier">Lyrics earlier</button><button id="later">Lyrics later</button><button id="resetSync">Reset sync</button></div></details></section>`;
	document.querySelectorAll("button").forEach((b) => b.addEventListener("click", unlockPhoneAudio));
	$("#displayName").addEventListener("change", updatePlayerDisplayName);
	$("#requestSong").onclick = () => {
		const item = queueRequest($("#song").value, $("#singers").value.split(",").map((s) => +s.trim()).filter(Boolean), player.playerId, room?.queue?.length || 0);
		peerNode.broadcast({
			type: RPC.QUEUE_ADD_REQUEST,
			item
		});
		log("Song queued. If the TV is idle it starts without host approval.");
	};
	$("#requestSinger").onclick = () => {
		peerNode.broadcast({
			type: RPC.SINGER_JOIN_REQUEST,
			playerId: player.playerId
		});
		log("Singer slot activated. Enable your mic when ready.");
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
	document.querySelectorAll(".startSelf").forEach((b) => b.onclick = () => {
		peerNode.broadcast({
			type: RPC.QUEUE_START_REQUEST,
			queueItemId: b.dataset.queueId,
			playerId: player.playerId
		});
		log("Start request sent. Host approval not required.");
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
			await connectDirectReceiverIfNeeded();
			const label = deriveMicLabel(player);
			$("#micStatus").textContent = label;
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
	receiverShell(root);
	receiverApp($("#main"));
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
