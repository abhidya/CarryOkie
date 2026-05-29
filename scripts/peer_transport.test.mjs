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
  static instances = [];
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
    MockPeer.instances.push(this);
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

// Now import the module
const { PeerJsRoomTransport, AUTO_JOIN_WEBRTC_ANSWER } =
  await import("../src/peer/PeerJsRoomTransport.ts");
PeerJsRoomTransport.setPeerConstructorForTests(MockPeer);

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
  globalThis.location = new URL(
    "http://localhost:5173/player/#room=  ABC123  ",
  );
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
  assert.match(url, /\/player\/\?room=ROOM123$/);
});

test("playerJoinUrl encodes room code", () => {
  globalThis.location = new URL("http://localhost:5173/host/");
  const url = PeerJsRoomTransport.playerJoinUrl("ROOM 123");
  assert.match(url, /room=ROOM(?:%20|\+)123$/);
});

test("readServerConfigFromUrl extracts custom PeerServer params", () => {
  globalThis.location = new URL("http://localhost:5173/host/?peerHost=signal.example.com&peerPort=443&peerPath=peerjs&peerSecure=1&peerKey=abc");
  const config = PeerJsRoomTransport.readServerConfigFromUrl();
  assert.deepEqual(config, {
    host: "signal.example.com",
    port: 443,
    path: "/peerjs",
    secure: true,
    key: "abc",
  });
});

test("playerJoinUrl preserves custom PeerServer params", () => {
  globalThis.location = new URL("http://localhost:5173/receiver/?room=ROOM123&peerHost=127.0.0.1&peerPort=9000&peerPath=/peerjs&peerSecure=0");
  const url = new URL(PeerJsRoomTransport.playerJoinUrl("ROOM123"));
  assert.equal(url.searchParams.get("room"), "ROOM123");
  assert.equal(url.searchParams.get("peerHost"), "127.0.0.1");
  assert.equal(url.searchParams.get("peerPort"), "9000");
  assert.equal(url.searchParams.get("peerPath"), "/peerjs");
  assert.equal(url.searchParams.get("peerSecure"), "0");
});

test("custom PeerServer params are passed to PeerJS", async () => {
  MockPeer.instances = [];
  globalThis.location = new URL("http://localhost:5173/host/?peerHost=127.0.0.1&peerPort=9000&peerPath=/peerjs&peerSecure=0");
  const transport = new PeerJsRoomTransport({
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  });
  await transport.startHost("ROOM123");
  const peer = MockPeer.instances.at(-1);
  assert.equal(peer.options.host, "127.0.0.1");
  assert.equal(peer.options.port, 9000);
  assert.equal(peer.options.path, "/peerjs");
  assert.equal(peer.options.secure, false);
  transport.close();
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

  assert.deepEqual(stateChanges, ["starting", "ready"]);
  assert.equal(transport.state, "ready");
  assert.equal(transport.myId, "ROOM123");
  assert.equal(transport.roomCode, "ROOM123");
  assert.equal(transport.isHost, true);
});

test("Host mode: startHost rejects on PeerJS error", async () => {
  const stateChanges = [];
  const handlers = {
    onStateChange: (s) => stateChanges.push(s),
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const errorPeer = class extends MockPeer {
    constructor(...args) {
      super(...args);
      setTimeout(() => {
        const err = new Error("unavailable-id");
        err.type = "unavailable-id";
        this.emit("error", err);
      }, 1);
    }
  };

  PeerJsRoomTransport.setPeerConstructorForTests(errorPeer);
  const transport = new PeerJsRoomTransport(handlers);
  try {
    await assert.rejects(() => transport.startHost("ROOM123"), /unavailable-id/);
    assert.deepEqual(stateChanges, ["starting", "disconnected", "failed"]);
  } finally {
    PeerJsRoomTransport.setPeerConstructorForTests(MockPeer);
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

  assert.deepEqual(stateChanges, ["starting", "connected"]);
  assert.equal(transport.state, "connected");
  assert.equal(transport.myId, "mock-peer-id");
  assert.equal(transport.roomCode, "ROOM123");
  assert.equal(transport.isHost, false);
  assert.ok(peerConnected.includes("ROOM123"));
});

test("sendTo sends message to specific peer connection", async () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.joinRoom("ROOM123");

  transport.sendTo("ROOM123", { type: "TEST", data: "hello" });

  const conn = transport.peer.connections.get("ROOM123");
  assert.equal(conn.sendCalls.length, 1);
  assert.deepEqual(conn.sendCalls[0], { type: "TEST", data: "hello" });
});

test("sendTo throws if connection is missing or closed", () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  assert.throws(
    () => transport.sendTo("NONEXISTENT", { type: "TEST" }),
    /not open: NONEXISTENT/,
  );
});

test("waitForAutoJoinAnswer rejects superseded waits and resolves latest", async () => {
  const handlers = {
    onStateChange: () => {},
    onMessage: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    onError: () => {},
  };

  const transport = new PeerJsRoomTransport(handlers);
  await transport.joinRoom("ROOM123");

  const first = transport.waitForAutoJoinAnswer(1000);
  const second = transport.waitForAutoJoinAnswer(1000);
  await assert.rejects(first, /superseded/);

  const conn = transport.peer.connections.get("ROOM123");
  conn.emit("data", { type: AUTO_JOIN_WEBRTC_ANSWER, answer: "answer-token" });
  assert.equal(await second, "answer-token");
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
  const conn = new MockDataConnection("peer1");
  transport.peer.emit("connection", conn);
  await new Promise((r) => setTimeout(r, 10));

  transport.disconnectPeer("peer1");

  assert.equal(transport.connectedPeerIds.includes("peer1"), false);
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

  assert.deepEqual(stateChanges, ["starting", "ready", "disconnected", "idle"]);
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
