/**
 * The page's sound, all synthesized (no files):
 *
 *   - a slow, breathing pad on an open chord, which darkens and gains a low
 *     root as the page tilts down to the planet, and drops to a second
 *     chord a fourth below while the blob is out (see CHORDS)
 *   - the projector: a faint hiss and the odd crackle
 *   - the blob: a breathy rush that follows its speed and where it is, a
 *     liquid gloop as the title melts, a lift as it comes loose, a sparkle
 *     when it's having fun, and a little run up the scale when it's home
 *   - a glassy chime for each click or tap, higher up the screen, higher up
 *     the chord, and panned to where it was
 *   - a harp run up and down the chord as a selection's edge sweeps across
 *     the subtitle
 *
 * Every note played is one of the current chord's.
 *
 * Browsers only start audio from a click or tap, so it's off until then.
 */
export interface Sound {
  readonly on: boolean;
  /** Turn it on. Call it from a click, tap or key press. */
  enable(): void;
  disable(): void;
  /** Hold it while the page is hidden, without turning it off. */
  pause(paused: boolean): void;
  /** How far down the page is scrolled, 0..1. */
  scroll(p: number): void;
  /** Move to chord `i` of CHORDS: 0 for the title, 1 while the blob is out. */
  chord(i: number): void;
  /** The blob: across the screen (0..1), and how fast (0..1). */
  motion(x: number, speed: number): void;
  /** A click or tap at (x, y), in shares of the screen. */
  chime(x: number, y: number): void;
  melt(): void;
  launch(): void;
  home(): void;
  happy(): void;
  /**
   * Where a selection's moving edge is along a line of text (0..1), or null
   * once there's no selection: each step along plays the chord's next note.
   * A new selection runs up to it from `from`, where it began.
   */
  trace(p: number | null, from?: number): void;
  destroy(): void;
}

/**
 * The two chords (MIDI notes): the pad's voicing over a low root, and the
 * tones in close order for everything played over it. The title's is D
 * major 9; the planet's, G major 9, a fourth below. G keeps three of D's
 * notes, so it sounds like the ground falling away rather than a new key,
 * and it's voiced so the pad's top note, the one that sings out, steps down
 * from C# to B, like a held note resolving.
 */
const CHORDS = [
  { pad: [50, 57, 64, 66, 73], sub: 38, tones: [62, 64, 66, 69, 73] },
  { pad: [43, 50, 57, 66, 71], sub: 31, tones: [55, 57, 59, 62, 66] },
];
/** Chimes span this many octaves up from the chord's lowest tone. */
const OCTAVES = 3;
/** A selection's run: this many of the chord's notes across a line, from an
 * octave up. */
const TRACE_NOTES = 11;
/** How quickly the chords cross over (time constant, s: done in about 3x). */
const CROSS_IN = 0.8;
const CROSS_OUT = 0.55;
/** The pad's brightness at the top of the page, and down at the planet (Hz). */
const BRIGHT = 1700;
const DARK = 620;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let on = false;
  let lastHappy = -Infinity;
  let traced = -1; // the last note a selection's edge played
  let suspendTimer = 0;
  // Filled in by build().
  let master: GainNode;
  let wet: GainNode; // into the reverb
  let padFilter: BiquadFilterNode;
  let subGain: GainNode;
  let windFilter: BiquadFilterNode;
  let windGain: GainNode;
  let windPan: StereoPannerNode;
  let layers: GainNode[][] = []; // each chord's: its pad, and its low root
  let current = 0;

  // The current chord's tones, over the chimes' range.
  const notes = () => {
    const { tones } = CHORDS[current];
    const out: number[] = [];
    for (let o = 0; o < OCTAVES; o++) for (const n of tones) out.push(n + 12 * o);
    out.push(tones[0] + 12 * OCTAVES);
    return out;
  };
  const tone = (i: number, octave = 0) => {
    const { tones } = CHORDS[current];
    return midi(tones[i] + 12 * octave);
  };

  // A room: noise dying away over a few seconds, and growing darker as it
  // does.
  const impulse = (c: AudioContext, seconds: number) => {
    const length = Math.floor(c.sampleRate * seconds);
    const ir = c.createBuffer(2, length, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < length; i++) {
        const t = i / c.sampleRate;
        const k = 0.06 + 0.6 * Math.exp(-t * 1.2);
        y += k * (Math.random() * 2 - 1 - y);
        data[i] = y * Math.exp(-t * 1.5) * (t < 0.02 ? 0 : 1);
      }
    }
    return ir;
  };

  const noise = (c: AudioContext, seconds: number) => {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return b;
  };

  // Crackle: silence with the odd click in it, a few a second, most tiny.
  const crackle = (c: AudioContext, seconds: number) => {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const data = b.getChannelData(0);
    const rate = 2.5 / c.sampleRate;
    for (let i = 0; i < data.length - 64; i++) {
      if (Math.random() > rate) continue;
      const a = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 48; j++) data[i + j] += a * Math.exp(-j / 6) * (Math.random() * 2 - 1);
    }
    return b;
  };

  const loop = (c: AudioContext, buffer: AudioBuffer) => {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(0, Math.random() * buffer.duration);
    return src;
  };

  // One of the pad's notes, the i-th of its chord (the root is rounder and a
  // little louder): two detuned oscillators, each on its own slow swell.
  const voice = (c: AudioContext, f: number, i: number, into: AudioNode) => {
    for (const cents of [-6, 6]) {
      const osc = c.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      osc.detune.value = cents;
      const level = (i === 0 ? 0.05 : 0.028) / (1 + i * 0.15);
      const g = c.createGain();
      g.gain.value = level;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.025 + Math.random() * 0.06;
      const depth = c.createGain();
      depth.gain.value = level * 0.7;
      lfo.connect(depth).connect(g.gain);
      osc.connect(g).connect(into);
      osc.start();
      lfo.start();
    }
  };

  const build = () => {
    const c = new AudioContext({ latencyHint: "interactive" });
    ctx = c;
    const out = c.createDynamicsCompressor();
    out.threshold.value = -20;
    out.knee.value = 12;
    out.ratio.value = 3;
    out.connect(c.destination);
    master = c.createGain();
    master.gain.value = 0;
    master.connect(out);

    const reverb = c.createConvolver();
    reverb.buffer = impulse(c, 4.5);
    wet = c.createGain();
    wet.connect(reverb).connect(master);

    // The pad: for each chord, each note two slightly detuned voices, each
    // swelling and fading on its own slow cycle, so the chord breathes, over
    // the chord's low root. Only the current chord's layer is up.
    padFilter = c.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = BRIGHT;
    padFilter.Q.value = 0.4;
    const pad = c.createGain();
    pad.gain.value = 0.5;
    padFilter.connect(pad);
    pad.connect(master);
    const padSend = c.createGain();
    padSend.gain.value = 0.7;
    pad.connect(padSend).connect(wet);
    subGain = c.createGain(); // the low roots, brought in by the scroll
    subGain.gain.value = 0;
    subGain.connect(master);
    layers = CHORDS.map((chord, k) => {
      const level = k === current ? 1 : 0;
      const voices = c.createGain();
      voices.gain.value = level;
      voices.connect(padFilter);
      chord.pad.forEach((n, i) => voice(c, midi(n), i, voices));
      const low = c.createGain();
      low.gain.value = level;
      low.connect(subGain);
      const sub = c.createOscillator();
      sub.frequency.value = midi(chord.sub);
      sub.connect(low);
      sub.start();
      return [voices, low];
    });

    // The projector: hiss, and crackle.
    const hiss = c.createBiquadFilter();
    hiss.type = "highpass";
    hiss.frequency.value = 3200;
    const hissGain = c.createGain();
    hissGain.gain.value = 0.012;
    loop(c, noise(c, 5)).connect(hiss).connect(hissGain).connect(master);
    const pops = c.createBiquadFilter();
    pops.type = "bandpass";
    pops.frequency.value = 2400;
    pops.Q.value = 0.6;
    const popGain = c.createGain();
    popGain.gain.value = 0.12;
    loop(c, crackle(c, 11)).connect(pops).connect(popGain).connect(master);

    // The blob's rush: noise through a band that rises with its speed.
    windFilter = c.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 300;
    windFilter.Q.value = 0.9;
    windGain = c.createGain();
    windGain.gain.value = 0;
    windPan = c.createStereoPanner();
    loop(c, noise(c, 5)).connect(windFilter).connect(windGain).connect(windPan);
    windPan.connect(master);
    const windSend = c.createGain();
    windSend.gain.value = 0.5;
    windPan.connect(windSend).connect(wet);
  };

  // A struck glass note: a few partials, each dying away, the higher ones
  // faster; panned to `pan` (-1..1).
  const bell = (f: number, amp: number, at = 0, pan = 0, length = 3) => {
    if (!ctx || !on) return;
    const c = ctx;
    const t = c.currentTime + 0.01 + at;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    const send = c.createGain();
    send.gain.value = 0.9;
    p.connect(send).connect(wet);
    for (const [ratio, level] of [
      [1, 1],
      [2.01, 0.25],
      [3.98, 0.06],
    ]) {
      const osc = c.createOscillator();
      osc.frequency.value = f * ratio;
      const g = c.createGain();
      const d = length / ratio;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * level, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g).connect(p);
      osc.start(t);
      osc.stop(t + d + 0.05);
    }
  };

  // A pitch sliding from f0 to f1 over `glide` seconds: a drop of liquid,
  // going down; a lift, going up.
  const slide = (f0: number, f1: number, glide: number, amp: number, at = 0) => {
    if (!ctx || !on) return;
    const c = ctx;
    const t = c.currentTime + 0.01 + at;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const lp = c.createBiquadFilter();
    lp.frequency.value = 1600;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + glide + 0.25);
    osc.connect(lp).connect(g);
    g.connect(master);
    const send = c.createGain();
    send.gain.value = 0.8;
    g.connect(send).connect(wet);
    osc.start(t);
    osc.stop(t + glide + 0.3);
  };

  const ease = (param: AudioParam, value: number, time: number) => {
    if (ctx) param.setTargetAtTime(value, ctx.currentTime, time);
  };

  return {
    get on() {
      return on;
    },
    enable() {
      if (!ctx) build();
      on = true;
      clearTimeout(suspendTimer);
      // On iPhone, play even with the ringer off: they asked for sound.
      const session = (navigator as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
      void ctx!.resume();
      master.gain.cancelScheduledValues(ctx!.currentTime);
      ease(master.gain, 0.85, 0.9);
    },
    disable() {
      if (!ctx) return;
      on = false;
      ease(master.gain, 0, 0.12);
      suspendTimer = window.setTimeout(() => {
        if (!on) void ctx?.suspend();
      }, 800);
    },
    pause(paused) {
      if (!ctx || !on) return;
      void (paused ? ctx.suspend() : ctx.resume());
    },
    scroll(p) {
      if (!on) return;
      ease(padFilter.frequency, BRIGHT * Math.pow(DARK / BRIGHT, p), 0.3);
      ease(subGain.gain, 0.06 * p * p, 0.4);
    },
    motion(x, speed) {
      if (!on) return;
      const s = Math.min(Math.max(speed, 0), 1);
      ease(windFilter.frequency, 260 + 1300 * s, 0.07);
      ease(windGain.gain, 0.16 * Math.pow(s, 1.6), 0.07);
      ease(windPan.pan, (x * 2 - 1) * 0.7, 0.1);
    },
    chord(i) {
      if (i === current) return;
      current = i;
      if (!ctx) return;
      layers.forEach((gains, k) =>
        gains.forEach((g) => ease(g.gain, k === i ? 1 : 0, k === i ? CROSS_IN : CROSS_OUT)),
      );
    },
    chime(x, y) {
      const scale = notes();
      const i = Math.round((1 - Math.min(Math.max(y, 0), 1)) * (scale.length - 1));
      bell(midi(scale[i]), 0.11, 0, (x * 2 - 1) * 0.8);
    },
    melt() {
      slide(560, 150, 0.38, 0.13);
      slide(400, 110, 0.32, 0.08, 0.13);
    },
    launch() {
      slide(200, 520, 0.2, 0.07);
      bell(tone(3, 2), 0.025, 0.12, 0, 2);
    },
    home() {
      [tone(0, 1), tone(2, 1), tone(3, 1), tone(0, 2)].forEach((f, i) =>
        bell(f, 0.06, i * 0.09),
      );
    },
    trace(p, start = p ?? 0) {
      if (p === null) {
        traced = -1;
        return;
      }
      const note = (q: number) =>
        Math.round(Math.min(Math.max(q, 0), 1) * (TRACE_NOTES - 1));
      const i = note(p);
      if (i === traced) return;
      // On from where it last was (or where a new selection began),
      // strumming through any notes it jumped past, a few at most.
      const from = traced < 0 ? note(start) : traced + Math.sign(i - traced);
      const step = Math.sign(i - from) || 1;
      const count = Math.min(Math.abs(i - from) + 1, 8);
      const scale = notes().slice(CHORDS[current].tones.length); // an octave up
      for (let k = 0; k < count; k++) {
        const n = i - step * (count - 1 - k);
        bell(midi(scale[n]), 0.045, k * 0.028, ((n / (TRACE_NOTES - 1)) * 2 - 1) * 0.6, 1.4);
      }
      traced = i;
    },
    happy() {
      if (!ctx || ctx.currentTime - lastHappy < 2.5) return;
      lastHappy = ctx.currentTime;
      bell(tone(3, 1), 0.035, 0, 0, 1.6);
      bell(tone(0, 2), 0.035, 0.08, 0, 1.6);
    },
    destroy() {
      clearTimeout(suspendTimer);
      void ctx?.close();
      ctx = null;
      on = false;
    },
  };
}
