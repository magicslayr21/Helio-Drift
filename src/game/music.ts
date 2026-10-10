/** Original Helio Drift scores. MIDI pitches, arranged in eight-bar cycles.
 * Soft envelopes and a dedicated low-gain bus keep effects intelligible.
 * Scheduling uses the audio clock rather than wall-clock timestamps. */
export type MusicTheme = "flight" | "boss" | "mk6";

export const SCORES = {
  flight: {
    title: "Quiet Orbit",
    bpm: 76,
    roots: [45, 41, 48, 43, 45, 41, 43, 40],
    melody: [12, null, 19, null, 14, null, 7, null, 12, null, 15, 14, null, 7, null, null],
    chord: [0, 7, 14],
  },
  boss: {
    title: "Dreadnought Approach",
    bpm: 104,
    roots: [38, 38, 34, 41, 38, 36, 34, 33],
    melody: [12, null, 7, 12, null, 15, 14, null, 12, 7, null, 10, 7, null, 5, null],
    chord: [0, 7, 10],
  },
  mk6: {
    title: "Omega Wake",
    bpm: 84,
    roots: [33, 33, 34, 29, 33, 36, 34, 28],
    melody: [12, null, null, 13, 7, null, 12, null, null, 19, 13, null, 12, 7, null, null],
    chord: [0, 7, 12],
  },
} as const;

export class MusicScore {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bus: GainNode;
  private voices = new Set<OscillatorNode>();
  private step = 0;
  private nextAt: number;

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
    readonly theme: MusicTheme,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.5);
    this.bus.connect(destination);
    this.nextAt = ctx.currentTime + 0.06;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 100);
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
    osc.connect(gain).connect(this.bus);
    this.voices.add(osc);
    osc.onended = () => {
      this.voices.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private schedule() {
    if (this.ctx.state !== "running") return;
    const score = SCORES[this.theme];
    const beat = 60 / score.bpm;
    // A stalled frame skips missed notes instead of bursting them at once.
    if (this.nextAt < this.ctx.currentTime) this.nextAt = this.ctx.currentTime + 0.04;
    while (this.nextAt < this.ctx.currentTime + 0.22) {
      const bar = Math.floor(this.step / 8);
      const root = score.roots[bar % score.roots.length];
      const pulse = this.step % 8;
      if (pulse === 0) {
        for (const interval of score.chord)
          this.note(root + interval, this.nextAt, beat * 3.8, 0.07);
      }
      const bassEvery = this.theme === "flight" ? 8 : this.theme === "boss" ? 2 : 4;
      if (pulse % bassEvery === 0) {
        this.note(
          root - (this.theme === "mk6" ? 12 : 0),
          this.nextAt,
          beat * 0.9,
          this.theme === "mk6" ? 0.2 : 0.12,
          "triangle",
        );
      }
      const pitch = score.melody[this.step % score.melody.length];
      if (pitch !== null) {
        // Alternate cycles use a gentler octave answer to avoid a short-loop feel.
        const octave = Math.floor(bar / 8) % 2 === 0 ? 12 : 0;
        this.note(root + pitch + octave, this.nextAt, beat * 1.4, 0.075);
      }
      this.step++;
      this.nextAt += beat / 2;
    }
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, now, 0.025);
    for (const voice of this.voices) voice.stop(now + 0.12);
    setTimeout(() => this.bus.disconnect(), 180);
  }
}
