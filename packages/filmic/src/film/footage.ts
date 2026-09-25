import { GRAIN_TEXTURE_SIZE } from "./grain";

/**
 * Footage: makes the film move like projected film. It steps at a film frame
 * rate (not the screen's), and every frame:
 *
 *   - weave:   the whole frame drifts and jitters a little, like film in a gate
 *   - flicker: exposure changes slightly
 *   - grain:   a new grain pattern
 *   - dust:    fresh specks, a few of which linger for several frames
 *
 * Everything is a function of the frame number and seed, so frame N looks the
 * same on every device, whatever frames it had to skip.
 */
export interface FootageOptions {
  /** Play as footage. Off, the film is a still. */
  enabled: boolean;
  /** Film frames per second. 12 reads as old footage, 24 as cinema. */
  fps: number;
  /** Gate weave amplitude, in film px. */
  weave: number;
  /** Gate weave rotation amplitude, in degrees. */
  weaveRotation: number;
  /** Exposure flicker amplitude, as a fraction (0.025 = about ±2.5%). */
  flicker: number;
  /** New grain every frame. */
  grain: boolean;
  /** Average number of new dust specks per frame (replaces the still's dust). */
  dustRate: number;
  /** Chance that a speck stays for 2-6 frames instead of one. */
  dustLinger: number;
  /** Changes every frame's randomness. */
  seed: number;
}

/**
 * Defaults tuned by eye against a reference hero, at a 1080 film px frame
 * (its 0.7 px weave at a ~830 px tall screen is 0.9 film px).
 */
export const DEFAULT_FOOTAGE: FootageOptions = {
  enabled: false,
  fps: 12,
  weave: 0.9,
  weaveRotation: 0.015,
  flicker: 0.025,
  grain: true,
  dustRate: 20,
  dustLinger: 0.2,
  seed: 0,
};

// --- The film clock ---
// Frames are counted on the page's clock (performance.now), not from when a
// film started, so every film and DOM element on the page steps together.

/** Film frame number at time `ms`. */
export const frameIndex = (ms: number, fps: number) =>
  Math.floor((ms / 1000) * fps);

/** Start time (ms) of the film frame containing `ms`. */
export const frameStart = (ms: number, fps: number) =>
  (frameIndex(ms, fps) * 1000) / fps;

// --- Deterministic noise over frame numbers ---

/** Hash (n, channel) -> 0..1. */
export function hash(n: number, ch: number) {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(ch | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Per-frame white noise, -1..1. */
const white = (n: number, ch: number) => hash(n, ch) * 2 - 1;

/** Smooth value noise, -1..1: random targets at whole t, cosine-blended. */
function smooth(t: number, ch: number) {
  const i = Math.floor(t);
  const f = (1 - Math.cos((t - i) * Math.PI)) / 2;
  return white(i, ch + 101) * (1 - f) + white(i + 1, ch + 101) * f;
}

/** What changes from one film frame to the next. */
export interface FootageFrame {
  /** Frame number on the page clock. */
  n: number;
  /** Weave: shift in film px, and rotation (radians) about the frame's center. */
  dx: number;
  dy: number;
  rotation: number;
  /** Exposure multiplier, in linear light (flicker). */
  exposure: number;
  /** Where to read the grain texture from, in texels. */
  grainOffset: [number, number];
}

/** No motion, no flicker: what a still looks like. */
export const STILL_FRAME: FootageFrame = {
  n: 0,
  dx: 0,
  dy: 0,
  rotation: 0,
  exposure: 1,
  grainOffset: [0, 0],
};

/**
 * Frame n. Weave and flicker mix slow drift (smooth) with per-frame jitter
 * (white): drift alone looks like camera shake, jitter alone like a glitch;
 * film in a gate moves a bit of both.
 */
export function footageFrame(n: number, o: FootageOptions): FootageFrame {
  // Offset by the seed on a separate axis, so seeds give unrelated motion.
  const m = n + Math.floor(o.seed) * 7919;
  const t = m / Math.max(o.fps, 1e-3);
  return {
    n,
    dx: o.weave * (0.65 * smooth(t * 1.1, 1) + 0.35 * white(m, 2)),
    // Vertical movement is mostly frame-to-frame registration jitter.
    dy: o.weave * 0.8 * (0.45 * smooth(t * 0.9, 3) + 0.55 * white(m, 4)),
    rotation: ((o.weaveRotation * Math.PI) / 180) * smooth(t * 0.7, 5),
    exposure: 1 + o.flicker * (0.6 * white(m, 6) + 0.4 * smooth(t * 2.3, 7)),
    grainOffset: o.grain
      ? [hash(m, 8) * GRAIN_TEXTURE_SIZE, hash(m, 9) * GRAIN_TEXTURE_SIZE]
      : [0, 0],
  };
}
