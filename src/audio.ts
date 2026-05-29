export class PhoneAudio {
  log: (msg: string) => void;
  ctx: AudioContext | null;
  master: GainNode | null;
  remoteGain: GainNode | null;
  backingGain: GainNode | null;
  localStream: MediaStream | null;
  publishedStream: MediaStream | null;
  pendingMicRequest: Promise<MediaStream> | null;
  activeCaptureRequest: Promise<MediaStream> | null;
  activeCaptureWaiters: number;
  activeCaptureConsumed: boolean;
  micSource: MediaStreamAudioSourceNode | null;
  micDestination: MediaStreamAudioDestinationNode | null;
  micFilters: {
    highpass?: BiquadFilterNode;
    tone?: BiquadFilterNode;
    presence?: BiquadFilterNode;
    compressor?: DynamicsCompressorNode;
    output?: GainNode;
    muteGate?: GainNode;
    silentMonitor?: GainNode;
  };
  voicePreset: string;
  localMonitorGain: number;
  backingAudio: HTMLAudioElement | null;
  backingSource: MediaElementAudioSourceNode | null;
  pushToSing: boolean;
  gateThreshold: number;
  gateEnabled: boolean;
  gateProcessor: ScriptProcessorNode | null;
  wakeLock: WakeLockSentinel | null = null;
  remoteSources: MediaStreamAudioSourceNode[];
  remoteStreams: Set<MediaStream>;

  constructor(log: (msg: string) => void = () => {}) {
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
    this.gateThreshold = 0.03;
    this.gateEnabled = false;
    this.gateProcessor = null;
    this.remoteSources = [];
    this.remoteStreams = new Set();
  }
  async init(): Promise<void> {
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
    if (this.ctx.state === "suspended")
      await this.ctx.resume?.().catch(() => {});
  }
  async requestMic({
    pushToSing = false,
  }: {
    pushToSing?: boolean;
  } = {}): Promise<MediaStream> {
    if (!navigator.mediaDevices) {
      throw new Error(
        "Mic requires HTTPS. Connect via GitHub Pages or localhost.",
      );
    }
    if (!navigator.mediaDevices.getUserMedia) {
      throw new Error("Browser doesn't support getUserMedia API.");
    }

    this.pushToSing = pushToSing;
    if (this.hasLiveMic()) {
      await this.init();
      this.setMicMuted(pushToSing);
      return this.publishedStream!;
    }
    if (!this.pendingMicRequest) {
      this.pendingMicRequest = this.openMic(pushToSing).finally(() => {
        this.pendingMicRequest = null;
      });
    }
    const stream = await this.pendingMicRequest;
    this.pushToSing = pushToSing;
    this.setMicMuted(pushToSing);
    return stream;
  }
  async openMic(pushToSing: boolean): Promise<MediaStream> {
    await this.init();
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      latency: { ideal: 0.01, max: 0.05 },
    } as MediaTrackConstraints;
    try {
      this.localStream = await this.getUserMediaWithTimeout({
        audio: audioConstraints,
        video: false,
      });
    } catch (error) {
      if (!isConstraintCompatibilityError(error)) {
        throw error;
      }
      this.log(
        `Mic request with karaoke constraints failed: ${(error as Error).message}. Retrying with basic audio.`,
      );
      this.localStream = await this.getUserMediaWithTimeout({
        audio: true,
        video: false,
      });
    }
    this.applyGate();
    this.buildMicFilterStream(this.localStream);
    this.publishedStream = this.localStream;
    this.setMicMuted(pushToSing);
    return this.publishedStream;
  }
  async getUserMediaWithTimeout(
    constraints: MediaStreamConstraints,
    timeoutMs = 5000,
  ): Promise<MediaStream> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!this.activeCaptureRequest) {
      this.activeCaptureConsumed = false;
      this.activeCaptureRequest = navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
          if (this.activeCaptureWaiters === 0 && !this.activeCaptureConsumed) {
            stream.getTracks().forEach((track) => track.stop());
          }
          return stream;
        })
        .finally(() => {
          this.activeCaptureRequest = null;
          this.activeCaptureWaiters = 0;
          this.activeCaptureConsumed = false;
        });
    }
    this.activeCaptureWaiters += 1;
    try {
      const stream = await Promise.race([
        this.activeCaptureRequest,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              reject(
                new Error(
                  "Microphone permission timed out. Check browser mic permission and try again.",
                ),
              );
            },
            timeoutMs,
          );
        }),
      ]);
      this.activeCaptureConsumed = true;
      return stream;
    } finally {
      this.activeCaptureWaiters = Math.max(0, this.activeCaptureWaiters - 1);
      clearTimeout(timer);
    }
  }
  hasLiveMic(): boolean {
    return (
      this.streamHasLiveAudio(this.localStream) &&
      this.streamHasLiveAudio(this.publishedStream)
    );
  }
  streamHasLiveAudio(stream: MediaStream | null): boolean {
    if (!stream) return false;
    const tracks =
      typeof stream.getAudioTracks === "function"
        ? stream.getAudioTracks()
        : typeof stream.getTracks === "function"
          ? stream.getTracks().filter((track) => track.kind === "audio")
          : [];
    return tracks.some((track) => track.readyState !== "ended");
  }
  setMicMuted(muted: boolean): void {
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
  buildMicFilterStream(stream: MediaStream): MediaStream {
    if (
      !this.ctx?.createMediaStreamDestination ||
      !this.ctx.createBiquadFilter ||
      !this.ctx.createDynamicsCompressor
    )
      return stream;
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
      /* Insert noise gate into the published mic filter chain
         between compressor and output so it only affects the
         stream sent to peers — never to ctx.destination. */
      if (this.gateEnabled && this.ctx.createScriptProcessor) {
        const gateNode = this.ctx.createScriptProcessor(4096, 1, 1);
        gateNode.onaudioprocess = (e: AudioProcessingEvent) => {
          const input = e.inputBuffer.getChannelData(0);
          const outputBuf = e.outputBuffer.getChannelData(0);
          let rms = 0;
          for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
          rms = Math.sqrt(rms / input.length);
          if (rms < this.gateThreshold) {
            for (let i = 0; i < outputBuf.length; i++) outputBuf[i] = 0;
          } else {
            for (let i = 0; i < outputBuf.length; i++) outputBuf[i] = input[i];
          }
        };
        compressor.connect(gateNode);
        gateNode.connect(output);
        this.gateProcessor = gateNode;
        this.log(
          `Noise gate enabled in mic filter chain (threshold: ${this.gateThreshold}).`,
        );
      } else {
        compressor.connect(output);
        this.gateProcessor = null;
      }
      output.connect(muteGate);
      muteGate.connect(this.micDestination);
      /* Keep Chromium pulling the WebAudio graph so the
         MediaStreamDestination track carries samples to WebRTC. The gain is
         zero, so this does not locally monitor the singer mic or create TV
         bleed/feedback. */
      muteGate.connect(silentMonitor);
      silentMonitor.connect(this.ctx.destination);
      this.micFilters = {
        highpass,
        tone,
        presence,
        compressor,
        output,
        muteGate,
        silentMonitor,
      };
      this.applyVoicePreset();
      return this.micDestination.stream;
    } catch (err: unknown) {
      this.log(
        `Mic filters unavailable: ${(err as Error).message}. Using clean mic.`,
      );
      return stream;
    }
  }
  setVoicePreset(preset: string): void {
    this.voicePreset = [
      "clean",
      "alto",
      "bravo",
      "bass",
      "radio",
      "autotune",
    ].includes(preset)
      ? preset
      : "clean";
    this.applyVoicePreset();
  }
  applyVoicePreset(): void {
    const { highpass, tone, presence, compressor, output } = this.micFilters;
    if (!highpass || !tone || !presence || !compressor || !output) return;
    const presets: Record<
      string,
      {
        hp: number;
        lowGain: number;
        presenceFreq: number;
        presenceGain: number;
        ratio: number;
        threshold: number;
        out: number;
      }
    > = {
      clean: {
        hp: 70,
        lowGain: 0,
        presenceFreq: 3200,
        presenceGain: 0,
        ratio: 2,
        threshold: -24,
        out: 1,
      },
      alto: {
        hp: 95,
        lowGain: 2,
        presenceFreq: 2400,
        presenceGain: 1.5,
        ratio: 3,
        threshold: -26,
        out: 1.05,
      },
      bravo: {
        hp: 120,
        lowGain: -1,
        presenceFreq: 4200,
        presenceGain: 4,
        ratio: 3.5,
        threshold: -28,
        out: 1.08,
      },
      bass: {
        hp: 55,
        lowGain: 4,
        presenceFreq: 1800,
        presenceGain: -1,
        ratio: 3,
        threshold: -25,
        out: 1,
      },
      radio: {
        hp: 180,
        lowGain: -6,
        presenceFreq: 2800,
        presenceGain: 5,
        ratio: 6,
        threshold: -32,
        out: 1.1,
      },
      autotune: {
        hp: 100,
        lowGain: -1,
        presenceFreq: 3600,
        presenceGain: 3,
        ratio: 8,
        threshold: -34,
        out: 1.12,
      },
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
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    output.gain.value = p.out;
  }
  addRemoteStream(stream: MediaStream, label = "remote singer"): void {
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
  async startBackingMonitor(url: string): Promise<HTMLAudioElement> {
    await this.init();
    if (
      !this.backingAudio ||
      !this.backingSource ||
      !this.ctx ||
      !this.backingGain
    ) {
      this.backingAudio = new Audio(url);
      this.backingAudio.loop = false;
      this.backingAudio.crossOrigin = "anonymous";
      this.backingSource = this.ctx!.createMediaElementSource(
        this.backingAudio,
      );
      this.backingSource!.connect(this.backingGain!);
    } else if (this.backingAudio.src !== url) {
      this.backingAudio.src = url;
    }
    this.backingGain!.gain.value = this.backingGain!.gain.value || 0.35;
    await this.backingAudio.play();
    return this.backingAudio;
  }
  pauseBackingMonitor(): void {
    this.backingAudio?.pause();
  }
  setGain(kind: "remote" | "backing" | "master", value: number): void {
    if (kind === "remote" && this.remoteGain)
      this.remoteGain.gain.value = value;
    if (kind === "backing" && this.backingGain)
      this.backingGain.gain.value = value;
    if (kind === "master" && this.master) this.master.gain.value = value;
  }
  wakeLockVideo: HTMLVideoElement | null = null;
  async tryWakeLock(): Promise<string> {
    try {
      if ("wakeLock" in navigator) {
        const request = navigator.wakeLock.request("screen").then((lock) => {
          this.wakeLock = lock;
          return "active";
        });
        return await Promise.race([
          request,
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), 1000),
          ),
        ]);
      }
      if (!this.wakeLockVideo) {
        this.wakeLockVideo = document.createElement("video");
        this.wakeLockVideo.loop = true;
        this.wakeLockVideo.muted = true;
        this.wakeLockVideo.style.cssText =
          "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(this.wakeLockVideo);
      }
      this.wakeLockVideo.src = new URL(
        "../public/silent_loop.mp4",
        import.meta.url,
      ).toString();
      await this.wakeLockVideo.play().catch(() => {});
      return "video-fallback";
    } catch {
      return "failed";
    }
  }
  stopWakeLock(): void {
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
  applyGate(): void {}
  setGateEnabled(enabled: boolean, threshold?: number): void {
    this.gateEnabled = enabled;
    if (threshold !== undefined) this.gateThreshold = threshold;
    if (this.localStream && this.publishedStream) {
      this.publishedStream = this.buildMicFilterStream(this.localStream);
    }
  }
  duetMonitorGains: Map<string, GainNode> = new Map();
  enableDuetMonitoring(peerId: string, enabled: boolean): void {
    if (!this.ctx) return;
    if (enabled && !this.duetMonitorGains.has(peerId)) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0.5;
      gain.connect(this.master!);
      this.duetMonitorGains.set(peerId, gain);
      this.log(`Duet monitoring enabled for ${peerId}`);
    } else if (!enabled && this.duetMonitorGains.has(peerId)) {
      const gain = this.duetMonitorGains.get(peerId);
      gain?.disconnect();
      this.duetMonitorGains.delete(peerId);
      this.log(`Duet monitoring disabled for ${peerId}`);
    }
  }
  connectDuetStream(stream: MediaStream, peerId: string): void {
    if (!this.ctx || !this.duetMonitorGains.has(peerId)) return;
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.duetMonitorGains.get(peerId)!);
  }
}

function isConstraintCompatibilityError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError";
}
export const singerWarning: string =
  "TV backing track bleed risk: your phone mic can hear the TV backing track. Use headphones or push-to-sing to avoid sending backing track to everyone.";
