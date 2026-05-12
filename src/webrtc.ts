import {
  encodeSignalPayload,
  decodeSignalPayload,
  joinChunks,
} from "./signaling.ts";
export const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
export const RPC: Record<string, string> = {
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
  ERROR_NOTICE: "ERROR_NOTICE",
};

interface PeerEdge {
  remotePeerId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  streams: MediaStream[];
  manual: boolean;
  initiator: boolean;
  negotiating?: boolean;
  needsNegotiation?: boolean;
  negotiationTimer?: ReturnType<typeof setTimeout>;
}

interface RelayedStream {
  sourcePeerId: string;
  stream: MediaStream;
}

export function assertWebRtcSupported(): void {
  if (typeof RTCPeerConnection === "undefined")
    throw new Error(
      "WebRTC is unavailable in this browser/context. On phones, open the GitHub Pages HTTPS URL or serve local testing over HTTPS; local HTTP hostnames may block offer creation.",
    );
}

export class PeerNode extends EventTarget {
  localPeerId: string;
  peers: Map<string, PeerEdge>;
  clockOffsetMs: number;
  localStreams: MediaStream[];
  relayedStreams: RelayedStream[];

  constructor(localPeerId: string) {
    super();
    this.localPeerId = localPeerId;
    this.peers = new Map();
    this.clockOffsetMs = 0;
    this.localStreams = [];
    this.relayedStreams = [];
  }
  makeConnection(
    remotePeerId: string,
    {
      manual = true,
      initiator = false,
      replace = false,
    }: { manual?: boolean; initiator?: boolean; replace?: boolean } = {},
  ): PeerEdge {
    assertWebRtcSupported();
    const existing = this.peers.get(remotePeerId);
    if (existing && !replace) return existing;
    if (existing && replace) {
      existing.pc.close?.();
      this.peers.delete(remotePeerId);
    }
    const pc = new RTCPeerConnection(rtcConfig);
    const edge: PeerEdge = {
      remotePeerId,
      pc,
      dc: null,
      streams: [],
      manual,
      initiator,
    };
    pc.oniceconnectionstatechange = () =>
      this.emit("ice", { remotePeerId, state: pc.iceConnectionState });
    pc.onconnectionstatechange = () => {
      this.emit("connection", { remotePeerId, state: pc.connectionState });
      if (pc.connectionState === "failed")
        this.emit("error", {
          message:
            "WebRTC failed. Strict mode has STUN but no TURN; try same Wi-Fi or a less restrictive network.",
          remotePeerId,
        });
    };
    pc.ontrack = (ev) => {
      this.emit("track", {
        remotePeerId,
        stream: ev.streams[0],
        track: ev.track,
      });
      if (ev.streams[0])
        this.emit("duet", { remotePeerId, stream: ev.streams[0] });
    };
    pc.ondatachannel = (ev) => this.attachChannel(edge, ev.channel);
    pc.onnegotiationneeded = () => {
      if (edge.negotiating) {
        edge.needsNegotiation = true;
        return;
      }
      this.negotiate(edge).catch((e) =>
        this.emit("error", { message: `Renegotiation failed: ${(e as Error).message}`, remotePeerId: edge.remotePeerId }),
      );
    };
    if (initiator)
      this.attachChannel(
        edge,
        pc.createDataChannel("room-rpc", { ordered: true }),
      );
    this.localStreams.forEach((stream) => this.addStreamToEdge(edge, stream));
    this.relayedStreams
      .filter((s) => s.sourcePeerId !== remotePeerId)
      .forEach(({ stream }) => this.addStreamToEdge(edge, stream));
    this.peers.set(remotePeerId, edge);
    return edge;
  }
  addStreamToEdge(edge: PeerEdge, stream: MediaStream): void {
    if (edge.streams.includes(stream)) return;
    edge.streams.push(stream);
    stream.getTracks().forEach((t) => edge.pc.addTrack(t, stream));
  }
  attachChannel(edge: PeerEdge, dc: RTCDataChannel): void {
    edge.dc = dc;
    dc.onopen = () => {
      this.emit("open", { remotePeerId: edge.remotePeerId });
      if (edge.streams.length) this.requestNegotiation(edge);
    };
    dc.onclose = () => this.emit("close", { remotePeerId: edge.remotePeerId });
    dc.onmessage = (ev) => {
      try {
        this.handleMessage(edge.remotePeerId, JSON.parse(ev.data));
      } catch (e: unknown) {
        this.emit("error", { message: (e as Error).message });
      }
    };
  }
  handleMessage(remotePeerId: string, msg: Record<string, unknown>): void {
    if (msg.type === RPC.LATENCY_PING)
      this.send(remotePeerId, {
        type: RPC.LATENCY_PONG,
        t0: msg.t0,
        h1: Date.now(),
      });
    if (msg.type === RPC.LATENCY_PONG) {
      const t2 = Date.now();
      this.clockOffsetMs =
        (msg.h1 as number) + (t2 - (msg.t0 as number)) / 2 - t2;
      this.emit("clock", { offsetMs: this.clockOffsetMs });
    }
    if (
      [
        RPC.SIGNAL_RELAY_OFFER,
        RPC.SIGNAL_RELAY_ANSWER,
        RPC.SIGNAL_RELAY_ICE,
      ].includes(msg.type as string) &&
      msg.toPeerId &&
      msg.toPeerId !== this.localPeerId
    ) {
      this.send(msg.toPeerId as string, {
        ...msg,
        relayedByPeerId: this.localPeerId,
      });
      this.emit("relay", {
        fromPeerId: remotePeerId,
        toPeerId: msg.toPeerId,
        msg,
      });
      return;
    }
    if (
      msg.type === RPC.SIGNAL_RELAY_OFFER &&
      msg.toPeerId === this.localPeerId
    ) {
      void this.acceptRenegotiationOffer(remotePeerId, msg).catch((e) =>
        this.emit("error", { message: e.message, remotePeerId }),
      );
      return;
    }
    if (
      msg.type === RPC.SIGNAL_RELAY_ANSWER &&
      msg.toPeerId === this.localPeerId
    ) {
      void this.acceptRenegotiationAnswer(remotePeerId, msg).catch((e) =>
        this.emit("error", { message: e.message, remotePeerId }),
      );
      return;
    }
    this.emit("message", { remotePeerId, msg });
  }
  signalDescription(msg: Record<string, unknown>): RTCSessionDescriptionInit {
    const signal = msg.signal as
      | RTCSessionDescriptionInit
      | { description?: RTCSessionDescriptionInit };
    return ((signal as { description?: RTCSessionDescriptionInit })
      ?.description || signal) as RTCSessionDescriptionInit;
  }
  async acceptRenegotiationOffer(
    remotePeerId: string,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const edge =
      this.peers.get(remotePeerId) ||
      this.makeConnection(remotePeerId, { manual: false, initiator: false });
    await edge.pc.setRemoteDescription(this.signalDescription(msg));
    const answer = await edge.pc.createAnswer();
    await edge.pc.setLocalDescription(answer);
    await waitForIceComplete(edge.pc);
    this.send(remotePeerId, {
      type: RPC.SIGNAL_RELAY_ANSWER,
      fromPeerId: this.localPeerId,
      toPeerId: remotePeerId,
      signal: edge.pc.localDescription,
    });
  }
  async acceptRenegotiationAnswer(
    remotePeerId: string,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const edge = this.peers.get(remotePeerId);
    if (!edge) throw new Error("No peer connection for renegotiation answer.");
    await edge.pc.setRemoteDescription(this.signalDescription(msg));
    clearTimeout(edge.negotiationTimer);
    edge.negotiating = false;
    if (edge.needsNegotiation) this.requestNegotiation(edge);
  }
  requestNegotiation(edge: PeerEdge): void {
    if (
      !edge.dc ||
      edge.dc.readyState !== "open" ||
      edge.negotiating ||
      edge.pc.signalingState !== "stable"
    ) {
      edge.needsNegotiation = true;
      return;
    }
    this.negotiate(edge).catch((e) =>
      this.emit("error", { message: `Renegotiation failed: ${(e as Error).message}`, remotePeerId: edge.remotePeerId }),
    );
  }
  async negotiate(edge: PeerEdge): Promise<void> {
    if (
      !edge.dc ||
      edge.dc.readyState !== "open" ||
      edge.negotiating ||
      edge.pc.signalingState !== "stable"
    ) {
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
        signal: edge.pc.localDescription,
      });
      clearTimeout(edge.negotiationTimer);
      edge.negotiationTimer = setTimeout(() => {
        if (edge.negotiating) {
          edge.negotiating = false;
          if (edge.needsNegotiation) this.requestNegotiation(edge);
        }
      }, 15000);
    } catch (err) {
      edge.negotiating = false;
      throw err;
    }
  }
  send(remotePeerId: string, msg: Record<string, unknown>): void {
    const edge = this.peers.get(remotePeerId);
    if (edge?.dc?.readyState === "open") edge.dc.send(JSON.stringify(msg));
  }
  broadcast(msg: Record<string, unknown>): void {
    for (const id of this.peers.keys()) this.send(id, msg);
  }
  pingAll(): void {
    this.broadcast({ type: RPC.LATENCY_PING, t0: Date.now() });
  }
  relaySignal(
    type: string,
    fromPeerId: string,
    toPeerId: string,
    signal: unknown,
  ): void {
    if (
      ![
        RPC.SIGNAL_RELAY_OFFER,
        RPC.SIGNAL_RELAY_ANSWER,
        RPC.SIGNAL_RELAY_ICE,
      ].includes(type)
    )
      throw new Error(`Unsupported relay type ${type}`);
    this.send(toPeerId, {
      type,
      fromPeerId,
      toPeerId,
      signal,
      sentAt: Date.now(),
    });
  }
  async createManualOffer(remotePeerId: string) {
    const edge = this.makeConnection(remotePeerId, {
      manual: true,
      initiator: true,
      replace: true,
    });
    const offer = await edge.pc.createOffer({ offerToReceiveAudio: true });
    await edge.pc.setLocalDescription(offer);
    await waitForIceComplete(edge.pc);
    return encodeSignalPayload({
      kind: "offer",
      fromPeerId: this.localPeerId,
      toPeerId: remotePeerId,
      description: edge.pc.localDescription,
    });
  }
  async acceptManualOffer(text: string) {
    const payload = await decodeSignalPayload(joinChunks(text));
    if (payload.kind !== "offer") throw new Error("Expected offer payload.");
    const edge = this.makeConnection(payload.fromPeerId, {
      manual: true,
      initiator: false,
      replace: true,
    });
    await edge.pc.setRemoteDescription(
      payload.description as RTCSessionDescriptionInit,
    );
    const answer = await edge.pc.createAnswer();
    await edge.pc.setLocalDescription(answer);
    await waitForIceComplete(edge.pc);
    return encodeSignalPayload({
      kind: "answer",
      fromPeerId: this.localPeerId,
      toPeerId: payload.fromPeerId,
      description: edge.pc.localDescription,
    });
  }
  async acceptManualAnswer(text: string) {
    const payload = await decodeSignalPayload(joinChunks(text));
    if (payload.kind !== "answer") throw new Error("Expected answer payload.");
    const edge =
      (payload.fromPeerId ? this.peers.get(payload.fromPeerId) : undefined) ||
      (payload.toPeerId ? this.peers.get(payload.toPeerId) : undefined) ||
      [...this.peers.values()].find(
        (e) => e.initiator && e.pc.signalingState !== "stable",
      );
    if (!edge) throw new Error("No pending offer for this answer.");
    if (payload.fromPeerId && edge.remotePeerId !== payload.fromPeerId) {
      this.peers.delete(edge.remotePeerId);
      edge.remotePeerId = payload.fromPeerId;
      this.peers.set(edge.remotePeerId, edge);
    }
    await edge.pc.setRemoteDescription(
      payload.description as RTCSessionDescriptionInit,
    );
    if (edge.streams.length) this.requestNegotiation(edge);
    return payload;
  }
  addLocalStream(stream: MediaStream): void {
    if (!this.localStreams.includes(stream)) this.localStreams.push(stream);
    for (const edge of this.peers.values()) {
      this.addStreamToEdge(edge, stream);
      this.requestNegotiation(edge);
    }
  }
  relayRemoteStream(sourcePeerId: string, stream: MediaStream): void {
    if (
      !this.relayedStreams.some(
        (s) => s.sourcePeerId === sourcePeerId && s.stream === stream,
      )
    )
      this.relayedStreams.push({ sourcePeerId, stream });
    for (const edge of this.peers.values()) {
      if (edge.remotePeerId === sourcePeerId) continue;
      this.addStreamToEdge(edge, stream);
      this.requestNegotiation(edge);
    }
  }
  emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
export function waitForIceComplete(
  pc: RTCPeerConnection,
  timeoutMs = 12000,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", on);
      clearTimeout(timer);
      resolve();
    };
    const on = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", on);
  });
}
