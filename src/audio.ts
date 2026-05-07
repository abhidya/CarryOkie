export class PhoneAudio {
  log: (msg: string) => void;
  ctx: AudioContext | null;
  master: GainNode | null;
  remoteGain: GainNode | null;
  backingGain: GainNode | null;
  localStream: MediaStream | null;
  localMonitorGain: number;
  backingAudio: HTMLAudioElement | null;
  backingSource: MediaElementAudioSourceNode | null;
  pushToSing: boolean;
  gateThreshold: number;
  gateEnabled: boolean;
  gateProcessor: ScriptProcessorNode | null;
  wakeLock: WakeLockSentinel | null = null;

  constructor(log: (msg: string) => void = () => {}) {
    this.log = log; this.ctx = null; this.master = null; this.remoteGain = null; this.backingGain = null;
    this.localStream = null; this.localMonitorGain = 0; this.backingAudio = null; this.backingSource = null;
    this.pushToSing = false; this.gateThreshold = 0.03; this.gateEnabled = false; this.gateProcessor = null;
  }
  async init(): Promise<void> {
    this.ctx = this.ctx || new AudioContext();
    this.master = this.ctx.createGain(); this.remoteGain = this.ctx.createGain(); this.backingGain = this.ctx.createGain();
    this.master.gain.value = 1; this.remoteGain.gain.value = 1; this.backingGain.gain.value = 0; this.localMonitorGain = 0;
    this.remoteGain.connect(this.master); this.backingGain.connect(this.master); this.master.connect(this.ctx.destination);
  }
  async requestMic({headphonesConfirmed = false, pushToSing = false}: {headphonesConfirmed?: boolean; pushToSing?: boolean} = {}): Promise<MediaStream> {
    if (!headphonesConfirmed && !pushToSing) throw new Error('TV backing track bleed risk. Use headphones or enable push-to-sing before mic publishing.');
    await this.init(); this.pushToSing = pushToSing;
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
    if (pushToSing) this.setMicMuted(true);
    this.applyGate(); return this.localStream;
  }
  setMicMuted(muted: boolean): void { this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; }); }
  addRemoteStream(stream: MediaStream, label = 'remote singer'): void {
    this.init().then(() => { if (!this.ctx || !this.remoteGain) return; const src = this.ctx.createMediaStreamSource(stream); src.connect(this.remoteGain); this.log(`Receiving ${label}`); });
  }
  async startBackingMonitor(url: string, {headphonesConfirmed = false, speakerAck = false}: {headphonesConfirmed?: boolean; speakerAck?: boolean} = {}): Promise<HTMLAudioElement> {
    if (!headphonesConfirmed && !speakerAck) throw new Error('Use headphones before phone backing monitor. Speaker output while mic active can feed back into mic.');
    await this.init();
    if (!this.backingAudio || !this.backingSource || !this.ctx || !this.backingGain) {
      this.backingAudio = new Audio(url); this.backingAudio.loop = false; this.backingAudio.crossOrigin = 'anonymous';
      this.backingSource = this.ctx.createMediaElementSource(this.backingAudio); this.backingSource!.connect(this.backingGain!);
    } else if (this.backingAudio.src !== url) { this.backingAudio.src = url; }
    this.backingGain!.gain.value = this.backingGain!.gain.value || 0.35;
    await this.backingAudio.play(); return this.backingAudio;
  }
  pauseBackingMonitor(): void { this.backingAudio?.pause(); }
  setGain(kind: 'remote' | 'backing' | 'master', value: number): void {
    if (kind === 'remote' && this.remoteGain) this.remoteGain.gain.value = value;
    if (kind === 'backing' && this.backingGain) this.backingGain.gain.value = value;
    if (kind === 'master' && this.master) this.master.gain.value = value;
  }
   wakeLockVideo: HTMLVideoElement | null = null;
   async tryWakeLock(): Promise<string> {
    try {
      if ('wakeLock' in navigator) { this.wakeLock = await navigator.wakeLock.request('screen'); return 'active'; }
      if (!this.wakeLockVideo) {
        this.wakeLockVideo = document.createElement('video');
        this.wakeLockVideo.loop = true;
        this.wakeLockVideo.muted = true;
        this.wakeLockVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(this.wakeLockVideo);
      }
      this.wakeLockVideo.src = new URL('../public/silent_loop.mp4', import.meta.url).toString();
      await this.wakeLockVideo.play().catch(() => {});
      return 'video-fallback';
    } catch { return 'failed'; }
  }
  stopWakeLock(): void {
    if (this.wakeLock) { this.wakeLock.release(); this.wakeLock = null; }
    if (this.wakeLockVideo) { this.wakeLockVideo.pause(); this.wakeLockVideo.remove(); this.wakeLockVideo = null; }
  }
  applyGate(): void {
    if (!this.localStream || !this.ctx || !this.gateEnabled) return;
    try {
      const source = this.ctx.createMediaStreamSource(this.localStream);
      const processor = this.ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        let rms = 0;
        for (let i = 0; i < input.length; i++) rms += input[i] * input[i];
        rms = Math.sqrt(rms / input.length);
        if (rms < this.gateThreshold) {
          for (let i = 0; i < output.length; i++) output[i] = 0;
        } else {
          for (let i = 0; i < output.length; i++) output[i] = input[i];
        }
      };
      source.connect(processor);
      processor.connect(this.ctx.destination);
      this.gateProcessor = processor;
      this.log(`Noise gate enabled (threshold: ${this.gateThreshold}).`);
    } catch (err: unknown) {
      this.log(`Noise gate failed: ${(err as Error).message}. Continuing without gate.`);
    }
  }
  setGateEnabled(enabled: boolean, threshold?: number): void {
    this.gateEnabled = enabled;
    if (threshold !== undefined) this.gateThreshold = threshold;
    if (enabled && this.localStream) this.applyGate();
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
export const singerWarning: string = 'Your phone mic can hear the TV backing track. Use headphones or push-to-sing to avoid sending backing track to everyone.';
