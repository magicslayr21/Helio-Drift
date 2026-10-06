/* HELIOS DRIFT — procedural audio.
   Everything is synthesised with WebAudio oscillators and noise buffers,
   so there are no asset downloads and no decode hitches mid-run.        */

export type Sfx =
  | "pulse" | "rail" | "spread" | "seeker" | "ricochet" | "flak" | "arc"
  | "beamStart" | "beamStop" | "overheat"
  | "missile" | "explodeBig" | "explodeSmall" | "hit" | "crit"
  | "hurt" | "pickup" | "creditDrop" | "levelup" | "wave" | "death" | "ui" | "buy"
  | "droneAssemble" | "droneDestroyed" | "droneRebuild"
  | "cycle" | "bossCharge" | "bossDeath";

const MASTER_KEY = "helios-drift-muted-v1";

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  comp: DynamicsCompressorNode | null = null;
  noise: AudioBuffer | null = null;
  muted = false;
  private beam: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filt: BiquadFilterNode } | null = null;
  private voices = 0;
  private lastAt: Record<string, number> = {};

  constructor() {
    try { this.muted = localStorage.getItem(MASTER_KEY) === "1"; } catch { /* ignore */ }
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.42;
    comp.connect(master).connect(ctx.destination);

    // one shared noise buffer for every explosion / impact
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx; this.comp = comp; this.master = master; this.noise = buf;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(MASTER_KEY, m ? "1" : "0"); } catch { /* ignore */ }
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.02);
    }
    if (m) this.stopBeam();
  }

  private ready(): this is { ctx: AudioContext; comp: DynamicsCompressorNode; noise: AudioBuffer } {
    return !!this.ctx && !this.muted && this.ctx.state === "running";
  }

  /** rate-limit a sound so overlapping events can't stack into clipping */
  private gate(key: string, ms: number) {
    const now = performance.now();
    if (this.lastAt[key] && now - this.lastAt[key] < ms) return false;
    this.lastAt[key] = now;
    return true;
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, dur: number, peak: number,
    opts: { attack?: number; filter?: number; detune?: number; delay?: number } = {},
  ) {
    if (!this.ready() || this.voices > 22) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    let node: AudioNode = gain;
    if (opts.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = opts.filter;
      gain.connect(lp);
      node = lp;
    }
    this.env(gain, t, peak, opts.attack ?? 0.004, dur);
    osc.connect(gain);
    node.connect(this.comp!);
    osc.start(t);
    osc.stop(t + dur + 0.08);
    this.voices++;
    osc.onended = () => { this.voices--; };
  }

  private burst(dur: number, peak: number, f0: number, f1: number, q = 1) {
    if (!this.ready() || this.voices > 22) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    const gain = ctx.createGain();
    this.env(gain, t, peak, 0.006, dur);
    src.connect(filt).connect(gain).connect(this.comp!);
    src.start(t);
    src.stop(t + dur + 0.05);
    this.voices++;
    src.onended = () => { this.voices--; };
  }

  play(s: Sfx) {
    if (!this.ready()) return;
    switch (s) {
      case "pulse":
        if (!this.gate("pulse", 45)) return;
        this.tone("square", 760, 190, 0.09, 0.15, { filter: 2400 });
        this.tone("sine", 240, 90, 0.07, 0.1);
        break;
      case "spread":
        if (!this.gate("pulse", 55)) return;
        this.tone("sawtooth", 520, 150, 0.1, 0.13, { filter: 1800 });
        this.burst(0.07, 0.07, 3000, 600);
        break;
      case "rail":
        if (!this.gate("rail", 90)) return;
        this.tone("sawtooth", 1400, 80, 0.3, 0.2, { filter: 3200 });
        this.tone("sine", 120, 42, 0.34, 0.22);
        this.burst(0.18, 0.12, 5000, 300);
        break;
      case "missile":
        this.tone("sawtooth", 300, 900, 0.26, 0.16, { filter: 2200 });
        this.burst(0.3, 0.14, 1600, 300);
        break;
      case "seeker":
        if (!this.gate("seeker", 40)) return;
        this.tone("triangle", 980, 1500, 0.07, 0.09, { filter: 3000 });
        break;
      case "ricochet":
        if (!this.gate("rico", 50)) return;
        this.tone("square", 520, 1400, 0.09, 0.12, { filter: 2600 });
        this.burst(0.05, 0.06, 4000, 900);
        break;
      case "flak":
        if (!this.gate("flak", 80)) return;
        this.tone("sine", 160, 60, 0.22, 0.22);
        this.burst(0.16, 0.16, 900, 200);
        break;
      case "arc":
        if (!this.gate("arc", 70)) return;
        this.burst(0.09, 0.12, 6000, 1400, 4);
        this.tone("sawtooth", 1800 + Math.random() * 600, 300, 0.08, 0.07, { filter: 4500 });
        break;
      case "cycle":
        this.tone("square", 440, 660, 0.06, 0.08, { filter: 2000 });
        this.tone("square", 660, 880, 0.06, 0.06, { filter: 2000, delay: 0.05 });
        break;
      case "bossCharge":
        this.tone("sawtooth", 90, 420, 0.7, 0.14, { filter: 1200, attack: 0.05 });
        this.tone("sine", 45, 110, 0.7, 0.12, { attack: 0.05 });
        break;
      case "bossDeath":
        this.burst(1.1, 0.3, 1800, 40, 1.6);
        this.tone("sine", 110, 22, 1.2, 0.22);
        [220, 277, 330, 440].forEach((f, i) =>
          this.tone("triangle", f, f * 0.5, 0.6, 0.08, { delay: 0.25 + i * 0.09, attack: 0.02 }),
        );
        break;
      case "beamStart": this.startBeam(); break;
      case "beamStop": this.stopBeam(); break;
      case "overheat":
        this.tone("square", 180, 60, 0.4, 0.16, { filter: 900 });
        this.burst(0.35, 0.12, 900, 120);
        break;
      case "hit":
        if (!this.gate("hit", 32)) return;
        this.burst(0.07, 0.09, 2600, 700, 2);
        this.tone("triangle", 420, 200, 0.06, 0.07);
        break;
      case "crit":
        if (!this.gate("crit", 60)) return;
        this.tone("square", 1250, 620, 0.1, 0.13, { filter: 5000 });
        this.burst(0.09, 0.1, 5200, 900);
        break;
      case "explodeSmall":
        if (!this.gate("expS", 40)) return;
        this.burst(0.34, 0.26, 1500, 110, 1.4);
        this.tone("sine", 190, 45, 0.3, 0.16);
        break;
      case "explodeBig":
        this.burst(0.72, 0.4, 2400, 60, 1.8);
        this.tone("sine", 130, 30, 0.66, 0.3);
        this.tone("triangle", 78, 26, 0.8, 0.2, { delay: 0.03 });
        break;
      case "hurt":
        this.tone("sawtooth", 260, 58, 0.42, 0.28, { filter: 1100 });
        this.burst(0.34, 0.2, 1100, 90);
        break;
      case "pickup":
        if (!this.gate("pickup", 45)) return;
        this.tone("triangle", 880, 1320, 0.09, 0.1);
        this.tone("sine", 1760, 2640, 0.07, 0.05, { delay: 0.04 });
        break;
      case "creditDrop":
        if (!this.gate("creditDrop", 120)) return;
        this.tone("triangle", 360, 720, 0.18, 0.11, { filter: 2200 });
        this.tone("sine", 720, 1440, 0.14, 0.07, { delay: 0.06 });
        this.burst(0.11, 0.06, 4200, 1300);
        break;
      case "droneAssemble":
        [220, 330, 495, 660].forEach((f, i) => this.tone("triangle", f, f * 1.2, 0.42, 0.11, { delay: i * 0.08, attack: 0.02 }));
        this.burst(0.35, 0.08, 2800, 700);
        break;
      case "droneDestroyed":
        this.tone("sawtooth", 480, 65, 0.52, 0.22, { filter: 1300 });
        this.burst(0.45, 0.22, 1900, 90);
        break;
      case "droneRebuild":
        this.tone("sine", 90, 300, 0.55, 0.11, { attack: 0.04 });
        this.tone("triangle", 330, 660, 0.6, 0.1, { delay: 0.2, attack: 0.04 });
        break;
      case "levelup":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone("triangle", f, f, 0.5, 0.15, { delay: i * 0.075, attack: 0.012 }),
        );
        this.tone("sine", 130.8, 130.8, 0.9, 0.12, { attack: 0.05 });
        break;
      case "wave":
        [392, 523.25].forEach((f, i) => this.tone("square", f, f, 0.3, 0.1, { delay: i * 0.1, filter: 1800 }));
        break;
      case "death":
        this.tone("sawtooth", 420, 24, 1.5, 0.34, { filter: 1400 });
        this.burst(1.3, 0.34, 2200, 50, 2);
        this.tone("sine", 92, 20, 1.7, 0.24, { delay: 0.06 });
        break;
      case "ui":
        this.tone("square", 620, 620, 0.05, 0.08, { filter: 1600 });
        break;
      case "buy":
        this.tone("triangle", 660, 990, 0.14, 0.13);
        this.tone("triangle", 990, 1320, 0.12, 0.09, { delay: 0.07 });
        break;
    }
  }

  private startBeam() {
    if (!this.ready() || this.beam) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.value = 660; osc.detune.value = 6;
    sub.type = "square"; sub.frequency.value = 164;
    filt.type = "bandpass"; filt.frequency.value = 1300; filt.Q.value = 3.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.05);
    osc.connect(filt); sub.connect(filt);
    filt.connect(gain).connect(this.comp!);
    osc.start(t); sub.start(t);
    this.beam = { osc, sub, gain, filt };
  }

  /** drive the beam's timbre from the overheat gauge (0..1) */
  beamHeat(h: number) {
    if (!this.beam || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.beam.filt.frequency.setTargetAtTime(1300 + h * 1500, t, 0.08);
    this.beam.osc.frequency.setTargetAtTime(660 + h * 260, t, 0.08);
  }

  private stopBeam() {
    if (!this.beam || !this.ctx) return;
    const { osc, sub, gain } = this.beam;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0.0001, t, 0.03);
    osc.stop(t + 0.2); sub.stop(t + 0.2);
    this.beam = null;
  }

  /** hard stop for pause / game over */
  silence() { this.stopBeam(); }
}

export const audio = new AudioEngine();
