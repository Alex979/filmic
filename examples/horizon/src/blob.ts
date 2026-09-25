import { clamp, spring } from "./math";

/**
 * The blob: a drop of the title's ink that chases a target.
 *
 * Its head is a mass on a spring: pulled toward the target, carried on by its
 * own momentum, so it swings through turns, overshoots a little and settles,
 * rather than homing in and stopping dead.
 *
 * Its tail is a trail of points, each easing toward the one ahead of it, so
 * it traces the path the head took, smoothed. Moving, it streams out behind
 * in proportion to the speed; stopped, it drains back into the head along
 * that path, leaving a round drop. The shader draws it as one smooth tapering
 * stroke with a rounded tip.
 *
 * It has eyes, which turn to watch what it's after (see Eyes, below). Round
 * normally; going fast, they squeeze into happy ^ ^.
 *
 * It moves in film frames (12 fps), but it's simulated in fine steps between
 * them, so each frame catches it mid-move, like the drawings of a
 * hand-animated one.
 */

/** Most points the scene's shader takes. */
export const MAX_NODES = 24;

/** The blob as the shader draws it, in CSS px on the canvas. */
export interface BlobShape {
  /** x, y, radius of points along it, head first: the stroke through them. */
  nodes: Float32Array;
  count: number;
  /** A circle around the whole blob: x, y, radius. */
  bounds: [number, number, number];
  /** The head's radius. */
  radius: number;
  /** 0 = not drawn. */
  opacity: number;
  /** Changes every step, so the edge boils. */
  boil: number;
  /**
   * Each eye: center x, y, then how much it's squeezed across and down by
   * facing away (1 = head-on).
   */
  eyes: Float32Array;
  /** 0 = round eyes, 1 = ^ ^; and how open they are (0 = mid-blink). */
  happy: number;
  open: number;
}

// --- Head ---
/** The spring pulling it to the target: how quick (rad/s), and how damped. */
const OMEGA = 7.5;
const DAMPING = 0.68; // under 1: it overshoots a touch
/** Its size springs, so it pops when it's let out. */
const SIZE_OMEGA = 15;
const SIZE_DAMPING = 0.35;

// --- Tail ---
const TRAIL = 12;
/** How quickly each point eases toward the one ahead (per second). */
const FOLLOW = 45; // the tip trails the head by about (TRAIL - 1) / FOLLOW s
/** Longest the tail gets, in head radii; longer, it's drawn in to fit. */
const LONGEST = 14;
/** The tail's tip, as a share of the head's radius. */
const TIP = 0.38;
/** Stretched out it thins, as if it only has so much ink: at most to this share. */
const THINNEST = 0.7;

// --- Eyes ---
// They sit on the front of the head as if it were a ball, and turn it toward
// what it's looking at: so they slide across the head, and the far one
// narrows as it turns away.
/** Farthest it turns its head, across and up or down (rad). */
const YAW = 0.75;
const PITCH = 0.6;
/** How far apart the eyes are (rad, each side), and how high (rad, up). */
const EYE_SPREAD = 0.36;
const EYE_RISE = 0.12;
/** The spring turning its head: how quick (rad/s), and how damped. */
const LOOK_OMEGA = 16;
const LOOK_DAMPING = 0.55;
/** It looks fully round at this many head radii away; less, closer in. */
const LOOK_FAR = 2.5;
/** Having fun above this speed (head radii per s), and for a while after. */
const FUN = 11;
const FUN_HOLD = 0.45; // s
const FUN_EASE = 14; // per second
/** Blinks now and then, for about a frame and a half. */
const BLINK_EVERY = [2.2, 5.5]; // s, at random between
const BLINK_TIME = 0.12;

const SUBSTEP = 1 / 240;

export interface Blob {
  readonly shape: BlobShape;
  /** The head's position and velocity (px/s). */
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly speed: number;
  /** Gather it all at one point, with the head's radius r. */
  place(x: number, y: number, r: number): void;
  /** Set the head moving at (vx, vy) px/s. */
  fling(vx: number, vy: number): void;
  /** Where its eyes look, in CSS px on the screen. */
  lookAt(x: number, y: number): void;
  /** Advance dt seconds toward (gx, gy), the head's radius easing to r. */
  step(dt: number, gx: number, gy: number, r: number): void;
  /** How far the farthest edge is from (x, y). */
  reach(x: number, y: number): number;
}

export function createBlob(): Blob {
  const xs = new Float64Array(TRAIL);
  const ys = new Float64Array(TRAIL);
  let vx = 0;
  let vy = 0;
  let radius = 0;
  let radiusV = 0;
  // Eyes: what they look at, where they're turned (-1..1 across and down),
  // and their mood.
  let lookX = 0;
  let lookY = 0;
  let turnX = 0;
  let turnY = 0;
  let turnVX = 0;
  let turnVY = 0;
  let funFor = 0;
  const nextBlink = () =>
    BLINK_EVERY[0] + Math.random() * (BLINK_EVERY[1] - BLINK_EVERY[0]);
  let blinkIn = nextBlink();

  const shape: BlobShape = {
    nodes: new Float32Array(MAX_NODES * 3),
    count: 2 * TRAIL - 1,
    bounds: [0, 0, 0],
    radius: 0,
    opacity: 0,
    boil: 0,
    eyes: new Float32Array(8),
    happy: 0,
    open: 1,
  };

  // Turn toward what it's looking at, and settle its mood, over h seconds.
  const look = (h: number) => {
    const r = Math.max(radius, 0.5);
    const dx = lookX - xs[0];
    const dy = lookY - ys[0];
    const d = Math.hypot(dx, dy);
    const far = d / (d + LOOK_FAR * r) / Math.max(d, 1e-6);
    [turnX, turnVX] = spring(turnX, turnVX, dx * far, LOOK_OMEGA, LOOK_DAMPING, h);
    [turnY, turnVY] = spring(turnY, turnVY, dy * far, LOOK_OMEGA, LOOK_DAMPING, h);
  };

  const mood = (dt: number) => {
    const r = Math.max(radius, 0.5);
    funFor = Math.hypot(vx, vy) > FUN * r ? FUN_HOLD : Math.max(0, funFor - dt);
    const fun = funFor > 0 ? 1 : 0;
    shape.happy += (fun - shape.happy) * (1 - Math.exp(-FUN_EASE * dt));
    blinkIn -= dt;
    if (blinkIn < -BLINK_TIME) blinkIn = nextBlink();
    shape.open = blinkIn < 0 && shape.happy < 0.5 ? 0 : 1;
  };

  // Each eye on the ball of the head, turned, then seen from the front.
  const eyes = () => {
    const r = Math.max(radius, 0.5);
    const yaw = YAW * clamp(turnX, -1, 1);
    const pitch = PITCH * clamp(turnY, -1, 1) - EYE_RISE;
    for (let e = 0; e < 2; e++) {
      const a = yaw + (e ? EYE_SPREAD : -EYE_SPREAD);
      shape.eyes[e * 4] = xs[0] + r * Math.sin(a) * Math.cos(pitch);
      shape.eyes[e * 4 + 1] = ys[0] + r * Math.sin(pitch);
      shape.eyes[e * 4 + 2] = Math.cos(a);
      shape.eyes[e * 4 + 3] = Math.cos(pitch);
    }
  };

  // Each point eases toward the one ahead; then, if the tail has grown too
  // long, it's drawn in toward the head, keeping its shape.
  const follow = (h: number) => {
    const k = 1 - Math.exp(-FOLLOW * h);
    let length = 0;
    for (let i = 1; i < TRAIL; i++) {
      xs[i] += (xs[i - 1] - xs[i]) * k;
      ys[i] += (ys[i - 1] - ys[i]) * k;
      length += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    const longest = LONGEST * radius;
    if (length > longest) {
      const s = longest / length;
      let px = xs[0]; // where the point ahead was, before it moved
      let py = ys[0];
      for (let i = 1; i < TRAIL; i++) {
        const dx = (xs[i] - px) * s;
        const dy = (ys[i] - py) * s;
        px = xs[i];
        py = ys[i];
        xs[i] = xs[i - 1] + dx;
        ys[i] = ys[i - 1] + dy;
      }
    }
  };

  // The trail smoothed into a curve (Catmull-Rom, a point between each
  // pair), with radii tapering from the head to a rounded tip.
  const write = () => {
    const r = Math.max(radius, 0.5);
    let length = 0;
    for (let i = 1; i < TRAIL; i++)
      length += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    const thin = Math.max(THINNEST, Math.sqrt(Math.min(1, (3 * r) / Math.max(length, 1e-6))));
    const at = (i: number) => Math.min(TRAIL - 1, Math.max(0, i));
    const n = shape.count;
    let reach = r;
    for (let k = 0; k < n; k++) {
      const i = k >> 1;
      let x = xs[i];
      let y = ys[i];
      if (k & 1) {
        const p0 = at(i - 1);
        const p3 = at(i + 2);
        const cr = (a: number, b: number, c: number, d: number) =>
          (-a + 9 * b + 9 * c - d) / 16; // Catmull-Rom at t = 1/2
        x = cr(xs[p0], xs[i], xs[i + 1], xs[p3]);
        y = cr(ys[p0], ys[i], ys[i + 1], ys[p3]);
      }
      const u = k / (n - 1);
      const ri = r * (1 - (1 - TIP) * Math.pow(u, 1.1)) * (1 + (thin - 1) * u);
      shape.nodes[k * 3] = x;
      shape.nodes[k * 3 + 1] = y;
      shape.nodes[k * 3 + 2] = ri;
      reach = Math.max(reach, Math.hypot(x - xs[0], y - ys[0]) + ri);
    }
    shape.radius = r;
    // Room for the edge's wobble.
    shape.bounds = [xs[0], ys[0], reach + 0.2 * r + 2];
  };

  return {
    shape,
    get x() {
      return xs[0];
    },
    get y() {
      return ys[0];
    },
    get vx() {
      return vx;
    },
    get vy() {
      return vy;
    },
    get speed() {
      return Math.hypot(vx, vy);
    },
    place(x, y, r) {
      xs.fill(x);
      ys.fill(y);
      vx = vy = radiusV = 0;
      radius = r;
      lookX = x;
      lookY = y;
      turnX = turnY = turnVX = turnVY = 0;
      funFor = shape.happy = 0;
      shape.open = 1;
      write();
      eyes();
    },
    lookAt(x, y) {
      lookX = x;
      lookY = y;
    },
    fling(x, y) {
      vx = x;
      vy = y;
    },
    step(dt, gx, gy, r) {
      const steps = Math.ceil(dt / SUBSTEP);
      const h = steps ? dt / steps : 0;
      for (let s = 0; s < steps; s++) {
        [xs[0], vx] = spring(xs[0], vx, gx, OMEGA, DAMPING, h);
        [ys[0], vy] = spring(ys[0], vy, gy, OMEGA, DAMPING, h);
        [radius, radiusV] = spring(radius, radiusV, r, SIZE_OMEGA, SIZE_DAMPING, h);

        follow(h);
        look(h);
      }
      mood(dt);
      shape.boil++;
      write();
      eyes();
    },
    reach(x, y) {
      let most = 0;
      const n = shape.nodes;
      for (let k = 0; k < shape.count; k++)
        most = Math.max(
          most,
          Math.hypot(n[k * 3] - x, n[k * 3 + 1] - y) + n[k * 3 + 2],
        );
      return most;
    },
  };
}
