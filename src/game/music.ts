/** Original Helio Drift scores. MIDI pitches, arranged in eight-bar cycles.
 * Soft envelopes and a dedicated low-gain bus keep effects intelligible.
 * Scheduling uses the audio clock rather than wall-clock timestamps. */
export type MusicTheme = "flight" | "boss" | "mk6" | "mk6Phase2";

export const SCORES = {
  flight: {
    title: "Signal Beyond",
    bpm: 92,
    roots: [45, 48, 43, 41, 45, 40, 43, 45],
    melody: [
      12,
      null,
      null,
      null,
      19,
      null,
      14,
      null,
      24,
      null,
      null,
      19,
      null,
      null,
      14,
      null,
      12,
      null,
      7,
      null,
      null,
      null,
      14,
      null,
      19,
      null,
      22,
      null,
      14,
      null,
      null,
      null,
    ],
    chord: [0, 7, 14],
  },
  boss: {
    title: "Dreadnought Approach",
    bpm: 104,
    roots: [38, 38, 34, 41, 38, 36, 34, 33],
    melody: [
      12,
      null,
      null,
      null,
      7,
      null,
      12,
      null,
      null,
      null,
      15,
      null,
      14,
      null,
      null,
      null,
      12,
      null,
      7,
      null,
      null,
      null,
      10,
      null,
      7,
      null,
      null,
      null,
      5,
      null,
      null,
      null,
    ],
    chord: [0, 7, 10],
  },
  mk6: {
    // Original composition: no samples or melody from a commercial recording.
    title: "Black Relay",
    bpm: 88,
    roots: [40, 40, 36, 38, 40, 43, 38, 35],
    melody: [
      7,
      null,
      null,
      10,
      null,
      null,
      14,
      null,
      null,
      7,
      null,
      null,
      3,
      null,
      null,
      null,
      12,
      null,
      null,
      null,
      10,
      null,
      7,
      null,
      null,
      null,
      2,
      null,
      3,
      null,
      null,
      null,
    ],
    chord: [0, 7, 10],
  },
} as const;

export class MusicScore {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bus: GainNode;
  private input: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private shaper: WaveShaperNode;
  private filter: BiquadFilterNode;
  private noise: AudioBuffer;
  private voices = new Set<AudioScheduledSourceNode>();
  private step = 0;
  private nextAt: number;

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
    public theme: MusicTheme,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.linearRampToValueAtTime(
      theme === "mk6Phase2" ? 0.3 : 0.24,
      ctx.currentTime + 0.5,
    );
    this.bus.connect(destination);
    this.input = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.filter = ctx.createBiquadFilter();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const value = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.8);
      curve[i] = Math.round(value * 64) / 64;
    }
    this.shaper.curve = curve;
    this.shaper.oversample = "2x";
    this.filter.type = "lowpass";
    this.filter.frequency.value = 3600;
    this.dry.gain.value = theme === "mk6Phase2" ? 0 : 1;
    this.wet.gain.value = theme === "mk6Phase2" ? 0.8 : 0;
    this.input.connect(this.dry).connect(this.bus);
    this.input.connect(this.shaper).connect(this.filter).connect(this.wet).connect(this.bus);
    this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.3), ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    let seed = 7931;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = seed / 2147483648 - 1;
    }
    this.nextAt = ctx.currentTime + 0.06;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 100);
  }

  /** Keep the groove's clock and bar position when Omega enters phase two. */
  retune(theme: MusicTheme): boolean {
    const omega = (value: MusicTheme) => value === "mk6" || value === "mk6Phase2";
    if (!omega(this.theme) || !omega(theme)) return false;
    this.theme = theme;
    const at = this.ctx.currentTime;
    const enraged = theme === "mk6Phase2";
    for (const [param, value] of [
      [this.bus.gain, enraged ? 0.3 : 0.24],
      [this.dry.gain, enraged ? 0 : 1],
      [this.wet.gain, enraged ? 0.8 : 0],
    ] as const) {
      param.cancelScheduledValues(at);
      param.setTargetAtTime(value, at, 0.25);
    }
    return true;
  }

  private track(source: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }

  private note(
    midi: number,
    at: number,
    duration: number,
    level: number,
    type: OscillatorType = "sine",
  ) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.12, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(this.input);
    this.track(osc, gain);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private drum(kind: "kick" | "snare" | "hat", at: number, accent = 1) {
    const gain = this.ctx.createGain();
    const duration = kind === "kick" ? 0.22 : kind === "snare" ? 0.15 : 0.045;
    const level = (kind === "kick" ? 0.24 : kind === "snare" ? 0.12 : 0.027) * accent;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(this.input);
    if (kind === "kick") {
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(132, at);
      osc.frequency.exponentialRampToValueAtTime(43, at + 0.09);
      osc.connect(gain);
      this.track(osc, gain);
      osc.start(at);
      osc.stop(at + duration + 0.02);
    } else {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = kind === "hat" ? 6500 : 2300;
      filter.Q.value = 0.65;
      source.connect(filter).connect(gain);
      this.track(source, gain, filter);
      source.start(at);
      source.stop(at + duration + 0.02);
      if (kind === "snare") this.note(54, at, 0.09, 0.035, "triangle");
    }
  }

  private schedule() {
    if (this.ctx.state !== "running") return;
    const omega = this.theme === "mk6" || this.theme === "mk6Phase2";
    const enraged = this.theme === "mk6Phase2";
    const score = SCORES[omega ? "mk6" : (this.theme as "flight" | "boss")];
    const beat = 60 / score.bpm;
    // A stalled frame skips missed notes instead of bursting them at once.
    if (this.nextAt < this.ctx.currentTime) this.nextAt = this.ctx.currentTime + 0.04;
    while (this.nextAt < this.ctx.currentTime + 0.22) {
      const bar = Math.floor(this.step / 16);
      const root = score.roots[bar % score.roots.length];
      const pulse = this.step % 16;
      const at = this.nextAt + (omega && pulse % 2 ? beat * 0.045 : 0);
      if (pulse === 0) {
        for (const interval of score.chord)
          this.note(root + interval, at, beat * 3.8, omega ? 0.055 : 0.07);
      }
      const bassHit = omega
        ? [0, 7, 10].includes(pulse)
        : this.theme === "flight"
          ? [0, 10].includes(pulse)
          : pulse % 4 === 0;
      if (bassHit) {
        this.note(root - (omega ? 12 : 0), at, beat * 0.9, omega ? 0.18 : 0.12, "triangle");
      }
      if (omega) {
        if ([0, 7, 10].includes(pulse) || (enraged && pulse === 14)) this.drum("kick", at);
        if (pulse === 4 || pulse === 12) this.drum("snare", at);
        if (pulse % 2 === 0 || (enraged && pulse % 4 === 3))
          this.drum("hat", at, pulse % 4 === 0 ? 1 : 0.65);
      }
      if (this.theme === "flight" && pulse % 4 === 2) {
        const orbit = [12, 19, 24, 26][Math.floor(pulse / 4)];
        this.note(root + orbit, at, beat * 0.7, 0.028, "triangle");
      }
      const pitch = score.melody[this.step % score.melody.length];
      if (pitch !== null) {
        // Alternate cycles use a gentler octave answer to avoid a short-loop feel.
        const octave = Math.floor(bar / 8) % 2 === 0 ? 12 : 0;
        this.note(
          root + pitch + (omega ? 0 : octave),
          at,
          beat * (omega ? 0.55 : 1.4),
          omega ? 0.085 : 0.075,
          omega ? "triangle" : "sine",
        );
        if (this.theme === "flight")
          this.note(root + pitch + octave, at + beat * 0.75, beat, 0.023);
      }
      this.step++;
      this.nextAt += beat / 4;
    }
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, now, 0.025);
    for (const voice of this.voices) voice.stop(now + 0.12);
    setTimeout(() => {
      for (const node of [this.input, this.dry, this.wet, this.shaper, this.filter, this.bus])
        node.disconnect();
    }, 180);
  }
}
