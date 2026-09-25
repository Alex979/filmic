/**
 * The blob: a drop of the title's ink that chases a target, like a fish.
 *
 * Its head swims: it always moves forward, turns toward the target at a
 * limited rate, and slows down to turn when the target is behind it, so it
 * loops around instead of stopping dead and reversing.
 *
 * Its body is a spine of points, each a set distance behind the one ahead
 * and bent no more than so much at each joint, so it can't fold on itself
 * and swings round after the head. The distance grows with speed: still, the
 * points bunch up into a round teardrop; fast, the tail streams out long.
 * The shader draws it as one smooth tapering stroke with a rounded tip.
 *
 * It moves in film frames (12 fps), but it's simulated in fine steps between
 * them, so each frame catches the body mid-swing, like the drawings of a
 * hand-animated move.
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
}

// --- Head ---
/** Wanted speed per px from the goal, per second: no top speed. */
const RATE = 7;
/** How quickly its speed eases to that (per second): speeding up, slowing down. */
const ACCEL = 9;
const DECEL = 16;
/** Fastest it can turn, and how hard it turns toward the goal (per second). */
const TURN = 14; // rad/s
const TURN_GAIN = 14;
/**
 * Its speed, as a share, with the goal straight behind it: it slows down to
 * turn, more the further round the goal is.
 */
const BRAKE = 0.2;
/** Its size springs, so it pops when it's let out. */
const SIZE_OMEGA = 15;
const SIZE_DAMPING = 0.35;

// --- Body ---
const SPINE = 12;
/** Sharpest bend at each joint. */
const BEND = 0.6; // rad, about 34°
/** Gap between spine points, in head radii at rest, plus px per px/s of speed. */
const GAP_REST = 0.12;
const GAP_SPEED = 0.028;
const GAP_MAX = 1.6;
/** How quickly the gap follows the speed: out fast, back in slower (per second). */
const GAP_OUT = 10;
const GAP_IN = 4;
/** The tail's tip, as a share of the head's radius. */
const TIP = 0.38;
/** Stretched out it thins, as if it only has so much ink: at most to this share. */
const THINNEST = 0.7;

const SUBSTEP = 1 / 240;

export interface Blob {
  readonly shape: BlobShape;
  /** The head's position and speed (px/s). */
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  /** Gather it all at one point, with the head's radius r. */
  place(x: number, y: number, r: number): void;
  /** Set the head moving at (vx, vy) px/s. */
  fling(vx: number, vy: number): void;
  /** Advance dt seconds toward (gx, gy), the head's radius easing to r. */
  step(dt: number, gx: number, gy: number, r: number): void;
  /** How far the farthest edge is from (x, y). */
  reach(x: number, y: number): number;
}

/** An angle wrapped to -π..π. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createBlob(): Blob {
  const xs = new Float64Array(SPINE);
  const ys = new Float64Array(SPINE);
  let heading = 0;
  let speed = 0;
  let radius = 0;
  let radiusV = 0;
  let gap = 0;

  const shape: BlobShape = {
    nodes: new Float32Array(MAX_NODES * 3),
    count: 2 * SPINE - 1,
    bounds: [0, 0, 0],
    radius: 0,
    opacity: 0,
    boil: 0,
  };

  // Keep each spine point `gap` behind the one ahead, and bent no more than
  // BEND off the line from the one before (the head's heading, for the
  // first).
  const constrain = () => {
    let fx = Math.cos(heading); // forward, at the joint
    let fy = Math.sin(heading);
    for (let i = 1; i < SPINE; i++) {
      let bx = xs[i] - xs[i - 1]; // back, toward this point
      let by = ys[i] - ys[i - 1];
      const d = Math.hypot(bx, by);
      if (d < 1e-6) {
        bx = -fx;
        by = -fy;
      } else {
        bx /= d;
        by /= d;
      }
      // Straight on, back points opposite forward (an angle of π between
      // them); bent, less. Keep it at least π - BEND.
      const angle = Math.atan2(bx * fy - by * fx, bx * fx + by * fy);
      const least = Math.PI - BEND;
      if (Math.abs(angle) < least) {
        const turn = angle > 0 ? -least : least;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        bx = fx * c - fy * s;
        by = fx * s + fy * c;
      }
      xs[i] = xs[i - 1] + bx * gap;
      ys[i] = ys[i - 1] + by * gap;
      fx = -bx;
      fy = -by;
    }
  };

  // The spine smoothed into a curve (Catmull-Rom, a point between each pair),
  // with radii tapering from the head to a rounded tip.
  const write = () => {
    const r = Math.max(radius, 0.5);
    const length = gap * (SPINE - 1);
    const thin = Math.max(THINNEST, Math.sqrt(Math.min(1, (3 * r) / Math.max(length, 1e-6))));
    const at = (i: number) => Math.min(SPINE - 1, Math.max(0, i));
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
    get speed() {
      return speed;
    },
    place(x, y, r) {
      xs.fill(x);
      ys.fill(y);
      speed = radiusV = 0;
      radius = r;
      gap = 0;
      constrain();
      write();
    },
    fling(vx, vy) {
      heading = Math.atan2(vy, vx);
      speed = Math.hypot(vx, vy);
    },
    step(dt, gx, gy, r) {
      const steps = Math.ceil(dt / SUBSTEP);
      const h = steps ? dt / steps : 0;
      for (let s = 0; s < steps; s++) {
        // Turn toward the goal, and set off (or ease off) with the distance.
        const dx = gx - xs[0];
        const dy = gy - ys[0];
        const d = Math.hypot(dx, dy);
        let want = 0;
        if (d > 0.5) {
          const off = wrap(Math.atan2(dy, dx) - heading);
          heading += Math.max(-TURN, Math.min(TURN, off * TURN_GAIN)) * h;
          const ahead = (1 + Math.cos(off)) / 2;
          want = d * RATE * (BRAKE + (1 - BRAKE) * ahead * ahead);
        }
        speed += (want - speed) * (1 - Math.exp(-(want > speed ? ACCEL : DECEL) * h));
        xs[0] += Math.cos(heading) * speed * h;
        ys[0] += Math.sin(heading) * speed * h;

        radiusV +=
          (SIZE_OMEGA * SIZE_OMEGA * (r - radius) -
            2 * SIZE_DAMPING * SIZE_OMEGA * radiusV) *
          h;
        radius += radiusV * h;

        const goal = Math.min(
          GAP_MAX * radius,
          GAP_REST * radius + speed * GAP_SPEED,
        );
        gap += (goal - gap) * (1 - Math.exp(-(goal > gap ? GAP_OUT : GAP_IN) * h));
        constrain();
      }
      shape.boil++;
      write();
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
