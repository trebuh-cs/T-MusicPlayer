import type { WebAudioDeviceInfo, WebAudioStatus } from "../types";

/**
 * Live Web Audio API spectrum capture engine for iPad / Safari / Desktop browsers.
 * Supports USB-C audio interfaces, mixing desk line-in, built-in microphones, and a built-in
 * Demo Beat generator for theme setup before soundcheck.
 */
export class WebAudioCaptureEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rawBins: Uint8Array<ArrayBuffer> = new Uint8Array(1024);

  private active = false;
  private capturing = false;
  private demoMode = false;
  private selectedDeviceId: string | null = null;
  private deviceName = "Tap 'Start Audio' to connect Mic / USB-C Mixer";
  private inputGain = 1.15;
  private noiseGate = 8;
  private peakLevel = 0;
  private error: string | null = null;

  getStatus(): WebAudioStatus {
    return {
      active: this.active,
      capturing: this.capturing,
      demoMode: this.demoMode,
      deviceName: this.deviceName,
      selectedDeviceId: this.selectedDeviceId,
      inputGain: this.inputGain,
      noiseGate: this.noiseGate,
      peakLevel: this.peakLevel,
      error: this.error,
    };
  }

  setInputGain(gain: number): void {
    this.inputGain = Math.max(0.2, Math.min(4.0, gain));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.inputGain, this.ctx.currentTime, 0.02);
    }
  }

  setNoiseGate(gate: number): void {
    this.noiseGate = Math.max(0, Math.min(48, Math.round(gate)));
  }

  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    if (enabled) {
      this.error = null;
      if (!this.capturing) {
        this.deviceName = "Demo Beat Preview (No Mic Needed)";
      }
    } else if (!this.capturing) {
      this.deviceName = "Tap 'Start Audio' to connect Mic / USB-C Mixer";
    }
  }

  async resumeContextIfSuspended(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        // Ignore if not triggered by user gesture
      }
    }
  }

  async listDevices(): Promise<WebAudioDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      return inputs.map((d, idx) => ({
        id: d.deviceId,
        name: d.label?.trim() || (idx === 0 ? "Default Microphone / Line-In" : `Audio Input ${idx + 1}`),
        isDefault: d.deviceId === "default" || idx === 0,
      }));
    } catch {
      return [];
    }
  }

  async start(deviceId: string | null = this.selectedDeviceId): Promise<WebAudioStatus> {
    this.error = null;
    this.selectedDeviceId = deviceId;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.error =
        window.isSecureContext
          ? "Audio input is not supported in this browser."
          : "HTTPS is required on iPad Safari to access Microphone / USB-C Audio.";
      this.active = false;
      this.capturing = false;
      return this.getStatus();
    }

    this.stopStreamOnly();

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      this.error = "Web Audio API is unavailable in this browser.";
      return this.getStatus();
    }

    if (!this.ctx) {
      this.ctx = new AudioCtx({ latencyHint: "interactive" });
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    // Critical for festival FOH / music: disable Safari speech DSP so bass & dynamics stay intact
    const primaryConstraints: MediaStreamConstraints = {
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
          video: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.error = `Audio permission/device error: ${msg}`;
        this.active = false;
        this.capturing = false;
        return this.getStatus();
      }
    }

    const track = stream.getAudioTracks()[0];
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.inputGain;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.62;
    this.analyser.minDecibels = -86;
    this.analyser.maxDecibels = -12;

    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.rawBins = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    this.active = true;
    this.capturing = true;
    this.demoMode = false;
    this.deviceName = track?.label?.trim() || "Live Microphone / USB-C Input";

    if (track) {
      track.onended = () => {
        this.capturing = false;
        this.active = false;
        this.deviceName = "Audio input disconnected";
      };
    }

    return this.getStatus();
  }

  private stopStreamOnly(): void {
    try {
      this.source?.disconnect();
    } catch {
      // Ignore
    }
    try {
      this.gainNode?.disconnect();
    } catch {
      // Ignore
    }
    this.source = null;
    this.gainNode = null;
    this.analyser = null;

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }

  stop(): void {
    this.stopStreamOnly();
    this.active = false;
    this.capturing = false;
    this.peakLevel = 0;
    if (!this.demoMode) {
      this.deviceName = "Audio stopped — tap Start Audio";
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  /**
   * Fills a 256-bin spectrum buffer compatible with @shared/visualizer/renderer.ts.
   * Returns true if live or demo signal is present above silence threshold.
   */
  sampleInto(target: Uint8Array, nowMs: number): boolean {
    if (this.capturing && this.analyser) {
      this.analyser.getByteFrequencyData(this.rawBins);
      const srcLen = this.rawBins.length;
      const dstLen = target.length;
      const gate = this.noiseGate;
      const gateScale = gate > 0 ? 255 / Math.max(1, 255 - gate) : 1;

      let peak = 0;
      // Mild perceptual curve so bass/mids/highs fill the 256 bins like the WASAPI engine
      const maxBin = Math.min(srcLen - 1, 680);
      for (let i = 0; i < dstLen; i++) {
        const t = i / (dstLen - 1);
        const idxFloat = Math.pow(t, 1.38) * maxBin;
        const idx0 = Math.floor(idxFloat);
        const idx1 = Math.min(srcLen - 1, idx0 + 1);
        const frac = idxFloat - idx0;
        let val = this.rawBins[idx0] * (1 - frac) + this.rawBins[idx1] * frac;
        if (val <= gate) {
          val = 0;
        } else if (gate > 0) {
          val = (val - gate) * gateScale;
        }
        const clamped = Math.max(0, Math.min(255, Math.round(val)));
        target[i] = clamped;
        if (clamped > peak) peak = clamped;
      }
      this.peakLevel = peak;
      return peak > 3;
    }

    if (this.demoMode) {
      const t = nowMs * 0.001;
      const bpm = 126;
      const beatPhase = (t * (bpm / 60)) % 1;
      const kick = Math.pow(Math.max(0, 1 - beatPhase * 3.8), 2.1);
      const offBeat = Math.pow(Math.max(0, 1 - (((beatPhase + 0.5) % 1) * 4.5)), 2.2);
      let peak = 0;
      for (let i = 0; i < target.length; i++) {
        const u = i / target.length;
        const sub = Math.exp(-Math.pow(u * 9.5, 2)) * (135 + kick * 120);
        const mid =
          Math.exp(-Math.pow((u - 0.28) * 5.2, 2)) *
          (85 + Math.sin(t * 2.4 + i * 0.12) * 52 + offBeat * 45);
        const high =
          Math.exp(-Math.pow((u - 0.68) * 4.6, 2)) *
          (42 + offBeat * 92 + Math.sin(t * 6.5 + i * 0.35) * 28);
        const v = Math.max(0, Math.min(255, Math.round(sub + mid + high)));
        target[i] = v;
        if (v > peak) peak = v;
      }
      this.peakLevel = peak;
      return true;
    }

    target.fill(0);
    this.peakLevel = 0;
    return false;
  }
}
