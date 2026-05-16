import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

// Mock PeerJS classes BEFORE importing the module
class MockDataConnection extends EventEmitter {
  peer;
  open = false;
  metadata;
  sendCalls = [];

  constructor(peerId, options) {
    super();
    this.peer = peerId;
    this.metadata = options?.metadata || {};
    setTimeout(() => {
      this.open = true;
      this.emit("open");
    }, 5);
  }

  send(data) {
    if (!this.open) throw new Error("Connection not open");
    this.sendCalls.push(data);
  }

  close() {
    this.open = false;
    this.emit("close");
  }
}

class MockPeer extends EventEmitter {
  id = null;
  connections = new Map();
  options;
  destroyCalled = false;
  reconnectCalled = false;

  constructor(idOrOptions, options) {
    super();
    if (typeof idOrOptions === "string") {
      this.id = idOrOptions;
      this.options = options;
    } else {
      this.options = idOrOptions || {};
    }
    setTimeout(() => {
      this.id = this.id || "mock-peer-id";
      this.emit("open", this.id);
    }, 5);
  }

  connect(targetId, options) {
    const conn = new MockDataConnection(targetId, options);
    this.connections.set(targetId, conn);
    this.emit("connection", conn);
    return conn;
  }

  reconnect() {
    this.reconnectCalled = true;
  }

  destroy() {
    this.destroyCalled = true;
    this.connections.forEach((conn) => conn.close());
    this.emit("close");
  }
}

// Mock global location for URL helpers
globalThis.location = new URL("http://localhost:5173/host/");

// Mock peerjs module
const mockPeerJs = {
  Peer: MockPeer,
  DataConnection: MockDataConnection,
};

// @ts-ignore - override peerjs import
globalThis.peerjs = mockPeerJs;

// Mock the peerjs import in the module
import originalModule from "module";
const require = originalModule.createRequire(import.meta.url);

// Intercept peerjs require
const Module = originalModule;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
  if (request === "peerjs" || request.startsWith("peerjs/")) {
    return request;
  }
  return originalResolve.call(this, request, parent);
};

// Now import the module
const {
  PeerJsRoomTransport,
  ConnectionState,
} = await import("../src/peer/PeerJsRoomTransport.ts");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("readRoomCodeFromUrl returns null when no room in URL", () => {
  globalThis.location = new URL("http://localhost:5173/player/");
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, null);
});

test("readRoomCodeFromUrl extracts from #room= hash", () => {
  globalThis.location = new URL("http://localhost:5173/player/#room=ABC123");
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, "ABC123");
});

test("readRoomCodeFromUrl extracts from ?room= query", () => {
  globalThis.location = new URL("http://localhost:5173/player/?room=XYZ789");
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, "XYZ789");
});

test("readRoomCodeFromUrl normalizes to uppercase", () => {
  globalThis.location = new URL("http://localhost:5173/player/#room=abc123");
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, "ABC123");
});

test("readRoomCodeFromUrl trims whitespace", () => {
  globalThis.location = new URL("http://localhost:5173/player/#room=  ABC123  ");
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, "ABC123");
});

test("readRoomCodeFromUrl hash priority over query", () => {
  globalThis.location = new URL(
    "http://localhost:5173/player/?room=QUERY#room=HASH",
  );
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, "HASH");
});

test("readRoomCodeFromUrl handles malformed URL", () => {
  globalThis.location = { hash: "#invalid", search: "" };
  const code = PeerJsRoomTransport.readRoomCodeFromUrl();
  assert.equal(code, null);
});

test("playerJoinUrl generates correct URL", () => {
  globalThis.location = new URL("http://localhost:5173/host/");
  const url = PeerJsRoomTransport.playerJoinUrl("ROOM123");
  assert.match(url, /\/player\/#room=ROOM123$/);
});

test("playerJoinUrl encodes room code", () => {
  globalThis.location = new URL("http://localhost:5173/host/");
  const url = PeerJsRoomTransport.playerJoinUrl("ROOM 123");
  assert.match(url, /room=ROOM%20123$/);
});

test("Host mode: startHost transitions correctly", async () => {
  const stateChanges = [];
  const handlers = {
    onStateChange: (s) => stateChanges.push(s),
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.startHost("ROOM123");

  assert.equal(stateChanges, ["starting", "ready"]);
  assert.equal(transport.state, "ready");
  assert.equal(transport.myId, "ROOM123");
  assert.equal(transport.roomCode, "ROOM123");
  assert.equal(transport.isHost, true);
});

test("Host mode: startHost rejects on PeerJS error", async () => {
  const stateChanges = [];
  const errors = [];
  const handlers = {
    onStateChange: (s) => stateChanges.push(s),
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: (e) => errors.push(e),
  };

  // Mock to emit error immediately
  const errorPeer = class extends MockPeer {
    constructor(...args) {
      super(...args);
      setTimeout(() => {
        this.emit("error", new Error("unavailable-id"));
      }, 1);
    }
  };

  // @ts-ignore
  const transport = new PeerJsRoomTransport(handlers);
  // @ts-ignore
  transport.peer = new errorPeer("ROOM123");

  try {
    await transport.startHost("ROOM123");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
  }
});

test("Player mode: joinRoom transitions correctly", async () => {
  const stateChanges = [];
  const peerConnected = [];
  const handlers = {
    onStateChange: (s) => stateChanges.push(s),
    onMessage: () => {},
    onPeerConnected: (id) => peerConnected.push(id),
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.joinRoom("ROOM123", { name: "Test Player" });

  assert.equal(stateChanges, ["starting", "connected"]);
  assert.equal(transport.state, "connected");
  assert.equal(transport.myId, "mock-peer-id");
  assert.equal(transport.roomCode, "ROOM123");
  assert.equal(transport.isHost, false);
  assert.ok(peerConnected.includes("ROOM123"));
});

test("sendTo sends message to specific peer", async () => {
  const messages = [];
  const handlers = {
    onStateChange: () => {},
    onMessage: (peer, msg) => messages.push({ peer, msg }),
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.joinRoom("ROOM123");

  transport.sendTo("ROOM123", { type: "TEST", data: "hello" });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].peer, "ROOM123");
  assert.equal(messages[0].msg.type, "TEST");
});

test("sendTo does nothing if connection not open", () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  transport.sendTo("NONEXISTENT", { type: "TEST" });
});

test("broadcast sends to all connected peers", async () => {
  const messages = [];
  const handlers = {
    onStateChange: () => {},
    onMessage: (peer, msg) => messages.push({ peer, msg }),
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.startHost("ROOM123");

  transport.sendTo("peer1", { type: "TEST" });
  transport.sendTo("peer2", { type: "TEST" });
  transport.broadcast({ type: "BROADCAST", data: "to all" });

  assert.equal(messages.length, 3);
});

test("disconnectPeer removes connection", async () => {
  const disconnectedPeers = [];
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: (id) => disconnectedPeers.push(id),
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.startHost("ROOM123");

  transport.disconnectPeer("peer1");

  assert.ok(disconnectedPeers.includes("peer1"));
});

test("disconnectPeer handles nonexistent peer", () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  transport.disconnectPeer("NONEXISTENT");
});

test("close cleans up all connections", async () => {
  const stateChanges = [];
  const handlers = {
    onStateChange: (s) => stateChanges.push(s),
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.startHost("ROOM123");

  transport.close();

  assert.equal(stateChanges, ["starting", "ready", "idle"]);
  assert.equal(transport.state, "idle");
  assert.equal(transport.connectedPeerIds.length, 0);
});

test("close can be called multiple times", async () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.startHost("ROOM123");

  transport.close();
  transport.close();
});

test("getters return correct values", async () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  assert.equal(transport.state, "idle");
  assert.equal(transport.myId, null);
  assert.equal(transport.roomCode, null);
  assert.equal(transport.isHost, false);
  assert.equal(transport.connectedPeerIds.length, 0);

  await transport.startHost("ROOM123");

  assert.equal(transport.state, "ready");
  assert.equal(transport.myId, "ROOM123");
  assert.equal(transport.roomCode, "ROOM123");
  assert.equal(transport.isHost, true);
});

test("handles malformed messages gracefully", async () => {
  const validCount = { count: 0 };
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {
      validCount.count++;
    },
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.joinRoom("ROOM123");

  // Send malformed data
  const conn = transport.peer.connections.get("ROOM123");
  if (conn) {
    conn.emit("data", "not valid json");
    conn.emit("data", { type: "VALID" });
  }

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(validCount.count, 1);
});

// Run tests
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log("PASS", t.name);
  } catch (err) {
    failed++;
    console.error("FAIL", t.name);
    console.error(err.stack || err);
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} PeerJsRoomTransport tests passed`);