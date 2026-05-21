/**
 * PeerJsRoomTransport — PeerJS-based room-code signaling adapter for CarryOkie.
 *
 * Replaces manual SDP offer/answer blob exchange with simple room-code join.
 * Uses PeerJS Cloud by default; no custom backend needed.
 * WebRTC data/media still flows peer-to-peer after signaling.
 */

import Peer, { DataConnection } from "peerjs";

export type ConnectionState =
  | "idle"
  | "starting"
  | "ready"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

// Auto-join message types exchanged over PeerJS DataChannel
export const AUTO_JOIN_HELLO = "AUTO_JOIN_HELLO";
export const AUTO_JOIN_HOST_READY = "AUTO_JOIN_HOST_READY";
export const AUTO_JOIN_WEBRTC_OFFER = "AUTO_JOIN_WEBRTC_OFFER";
export const AUTO_JOIN_WEBRTC_ANSWER = "AUTO_JOIN_WEBRTC_ANSWER";
export const AUTO_JOIN_FAILED = "AUTO_JOIN_FAILED";
export const AUTO_JOIN_STATUS = "AUTO_JOIN_STATUS";

export interface RoomMessage {
  type: string;
  [key: string]: unknown;
}

export interface TransportHandlers {
  onStateChange: (state: ConnectionState) => void;
  onMessage: (peerId: string, msg: RoomMessage) => void;
  onPeerConnected: (peerId: string, metadata?: Record<string, unknown>) => void;
  onPeerDisconnected: (peerId: string) => void;
  onError: (error: Error) => void;
  onAutoJoinOffer?: (peerId: string, offerText: string) => void;
  onAutoJoinAnswer?: (peerId: string, answerText: string) => void;
}

const STUN_SERVER = { urls: "stun:stun.l.google.com:19302" };

export class PeerJsRoomTransport {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private handlers: TransportHandlers;
  private _state: ConnectionState = "idle";
  private _myId: string | null = null;
  private _roomCode: string | null = null;
  private _isHost: boolean = false;

  constructor(handlers: TransportHandlers) {
    this.handlers = handlers;
  }

  get state(): ConnectionState {
    return this._state;
  }
  get myId(): string | null {
    return this._myId;
  }
  get roomCode(): string | null {
    return this._roomCode;
  }
  get isHost(): boolean {
    return this._isHost;
  }
  get connectedPeerIds(): string[] {
    return [...this.connections.keys()];
  }

  private setState(s: ConnectionState): void {
    this._state = s;
    this.handlers.onStateChange(s);
  }

  /**
   * Host: create a room with the given room code as the PeerJS peer ID.
   * If the ID is taken, onError fires with "unavailable-id" and caller must retry.
   */
  async startHost(roomCode: string): Promise<void> {
    this._isHost = true;
    this._roomCode = roomCode;
    this.setState("starting");

    return new Promise((resolve, reject) => {
      const peer = new Peer(roomCode, {
        config: { iceServers: [STUN_SERVER] },
        debug: 0,
      });

      const onOpen = (id: string) => {
        this._myId = id;
        this._roomCode = id;
        this.setState("ready");
        peer.off("error", onError);
        resolve();
      };

      const onError = (err: Error & { type?: string }) => {
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
  async joinRoom(
    roomCode: string,
    playerInfo?: Record<string, unknown>,
  ): Promise<void> {
    this._isHost = false;
    this._roomCode = roomCode;
    this.setState("starting");

    return new Promise((resolve, reject) => {
      const peer = new Peer({
        config: { iceServers: [STUN_SERVER] },
        debug: 0,
      });

      const onOpen = (id: string) => {
        this._myId = id;
        const conn = peer.connect(roomCode, {
          reliable: true,
          serialization: "json",
          metadata: playerInfo || {},
        });

        this.attachConnection(conn);

        const onConnOpen = () => {
          conn.off("error", onConnError);
          this.setState("connected");
          peer.off("error", onPeerError);
          resolve();
        };

        const onConnError = (err: Error) => {
          conn.off("open", onConnOpen);
          reject(err);
        };

        conn.on("open", onConnOpen);
        conn.on("error", onConnError);
      };

      const onPeerError = (err: Error & { type?: string }) => {
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

  private _autoJoinAnswerResolvers: Map<string, {
    resolve: (answerText: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  private attachConnection(conn: DataConnection): void {
    conn.on("open", () => {
      this.connections.set(conn.peer, conn);
      this.handlers.onPeerConnected(
        conn.peer,
        conn.metadata as Record<string, unknown>,
      );
      if (!this._isHost && this._state !== "connected") {
        this.setState("connected");
      }
    });

    conn.on("data", (data: unknown) => {
      try {
        const msg = (
          typeof data === "string" ? JSON.parse(data) : data
        ) as RoomMessage;
        if (!msg?.type) return;

        // Auto-join signaling messages
        if (msg.type === AUTO_JOIN_WEBRTC_OFFER && this._isHost) {
          const offerText = (msg.offer as string) || "";
          if (offerText && this.handlers.onAutoJoinOffer) {
            this.handlers.onAutoJoinOffer(conn.peer, offerText);
          }
          return;
        }

        if (msg.type === AUTO_JOIN_WEBRTC_ANSWER && !this._isHost) {
          const answerText = (msg.answer as string) || "";
          const resolver = this._autoJoinAnswerResolvers.get(conn.peer);
          if (resolver) {
            clearTimeout(resolver.timer);
            this._autoJoinAnswerResolvers.delete(conn.peer);
            resolver.resolve(answerText);
          }
          if (this.handlers.onAutoJoinAnswer) {
            this.handlers.onAutoJoinAnswer(conn.peer, answerText);
          }
          return;
        }

        if (msg.type === AUTO_JOIN_FAILED && !this._isHost) {
          const resolver = this._autoJoinAnswerResolvers.get(conn.peer);
          if (resolver) {
            clearTimeout(resolver.timer);
            this._autoJoinAnswerResolvers.delete(conn.peer);
            resolver.reject(new Error(String(msg.reason || "Auto-join failed")));
          }
          return;
        }

        if (msg?.type) this.handlers.onMessage(conn.peer, msg);
      } catch {
        // ignore malformed
      }
    });

    conn.on("close", () => {
      this.connections.delete(conn.peer);
      const resolver = this._autoJoinAnswerResolvers.get(conn.peer);
      if (resolver) {
        clearTimeout(resolver.timer);
        this._autoJoinAnswerResolvers.delete(conn.peer);
        resolver.reject(new Error("Connection closed during auto-join"));
      }
      this.handlers.onPeerDisconnected(conn.peer);
    });

    conn.on("error", (err: Error) => {
      this.handlers.onError(err);
    });
  }

  /**
   * Host: accept a PeerNode offer from a player and send back the answer.
   * Call this after processing the offer through PeerNode.acceptManualOffer().
   */
  sendAutoJoinAnswer(peerId: string, answerText: string): void {
    this.sendTo(peerId, {
      type: AUTO_JOIN_WEBRTC_ANSWER,
      answer: answerText,
    });
  }

  /**
   * Host: notify a player that their auto-join failed.
   */
  sendAutoJoinFailed(peerId: string, reason: string): void {
    this.sendTo(peerId, {
      type: AUTO_JOIN_FAILED,
      reason,
    });
  }

  /**
   * Player: send a PeerNode offer to the host over PeerJS.
   */
  sendAutoJoinOffer(offerText: string): void {
    if (!this._roomCode) throw new Error("Not in a room");
    this.sendTo(this._roomCode, {
      type: AUTO_JOIN_WEBRTC_OFFER,
      offer: offerText,
    });
  }

  /**
   * Player: wait for the host's answer after sending an offer.
   */
  waitForAutoJoinAnswer(timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._autoJoinAnswerResolvers.delete(this._roomCode || "unknown");
        reject(new Error("Auto-join answer timeout"));
      }, timeoutMs);

      this._autoJoinAnswerResolvers.set(this._roomCode || "unknown", {
        resolve,
        reject,
        timer,
      });
    });
  }

  disconnectPeer(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.close();
      this.connections.delete(peerId);
    }
  }

  close(): void {
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
  static readRoomCodeFromUrl(): string | null {
    try {
      const hash = new URLSearchParams(location.hash.slice(1));
      const fromHash = hash.get("room");
      if (fromHash) return fromHash.toUpperCase().trim();

      const params = new URLSearchParams(location.search);
      const fromQuery = params.get("room");
      if (fromQuery) return fromQuery.toUpperCase().trim();
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Build a player join URL for the given room code.
   */
  static playerJoinUrl(roomCode: string): string {
    const base = new URL("../player/", location.href);
    base.hash = `room=${encodeURIComponent(roomCode)}`;
    return base.toString();
  }
}
