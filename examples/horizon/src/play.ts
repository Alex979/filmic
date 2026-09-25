import { createBlob, type BlobShape } from "./blob";

/**
 * What happens below the hero: scroll far enough and the title melts into a
 * drop of ink, which comes loose and chases a target (the pointer, or the
 * last tap on a touch screen). Left alone, it circles the target. Scroll back
 * up and it flies home and turns back into the title.
 *
 * It's animation, not input, so it steps in frames rather than at the
 * screen's rate: the title with the film (12 fps), and the blob twice as
 * often (on twos, rather than threes), so chasing the pointer reads smoothly.
 * What follows input directly (the scroll, the target's ring) moves at the
 * screen's rate elsewhere.
 */

/** Where the title's ink gathers when it melts, in CSS px on the page. */
export interface Anchor {
  x: number;
  y: number;
  /** The title's font size, in CSS px: the blob is sized from it. */
  size: number;
}

export interface Play {
  /**
   * Step the title to film time `t` and the blob to its own time `blobT`
   * (ms, each stepped to its frame rate), for a `width` x `height` screen
   * scrolled `scroll` px down. Each steps only when its time moves on, so it
   * can be called every draw.
   */
  advance(
    t: number,
    blobT: number,
    width: number,
    height: number,
    scroll: number,
  ): void;
  /** The blob, for the scene's shader. */
  readonly shape: BlobShape;
  /** How melted the title is: 0 = text, 1 = a drop. */
  readonly melt: number;
  /** The blob has the title's ink (the text itself is hidden). */
  readonly loose: boolean;
  /** The blob is out, following the target. */
  readonly free: boolean;
  /** Something is still moving (the blob, or the title melting). */
  readonly moving: boolean;
  /** Bumps whenever `melt` or `loose` change. */
  readonly version: number;
  /** Where the blob is headed, in CSS px on the screen. */
  readonly target: { x: number; y: number };
  /** Move the target (it counts as activity: the blob stops circling). */
  pointTo(x: number, y: number): void;
  setAnchor(anchor: Anchor): void;
  /** Hold the title until the intro has finished. */
  setReady(ready: boolean): void;
  /** Back to the title, right away. */
  reset(): void;
}

// Scroll, in screen heights, past which the title melts, and back above
// which it comes home. Apart, so hovering around one doesn't flip-flop.
const MELT_AT = 0.22;
const FORM_AT = 0.12;
// Seconds to melt, and to form back. Leaving is quick, so a fast scroll
// isn't left looking at nothing; coming home takes its time.
const MELT_TIME = 0.3;
const FORM_TIME = 0.75;
// How fast the blob is flung out of the melted title, toward its target
// (px/s). Its spring does the rest.
const LAUNCH = 700;
// Sizes, as shares of the title's font size.
const BLOB = 0.33;
const DROP = 0.19;
// Circling: after this long without the target moving, the blob starts
// circling it, up to this fast (rad/s).
const IDLE_AFTER = 900;
const ORBIT_SPEED = 2.1;
// How quickly it eases into circling, and back out when the target moves
// (rad/s, critically damped: it starts gently, with no kick).
const ORBIT_IN = 2.6;
const ORBIT_OUT = 9;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

export function createPlay(): Play {
  const blob = createBlob();
  let phase: "title" | "blob" = "title";
  let melt = 0;
  let want = false; // scrolled far enough to let the blob out
  let ready = false;
  let anchor: Anchor | null = null;
  let target: { x: number; y: number } | null = null; // null = the default
  let lastMove = -Infinity;
  let orbit = 0; // 0 = chasing, 1 = circling
  let orbitV = 0;
  let angle = 0;
  let spin = 1; // which way round it circles
  let wasIdle = false;
  let lastT = NaN;
  let lastBlobT = NaN;
  let version = 0;
  let screen = { width: 1, height: 1 };

  // Until there's been input: a little below the middle of the screen, over
  // the planet.
  const aim = () =>
    target ?? { x: 0.5 * screen.width, y: 0.56 * screen.height };

  return {
    advance(t, blobT, width, height, scroll) {
      const since = (now: number, last: number) =>
        Number.isNaN(last) ? 0 : clamp((now - last) / 1000, 0, 0.25);
      const titleMoves = t !== lastT;
      const blobMoves = blobT !== lastBlobT;
      if (!titleMoves && !blobMoves) return;
      const dt = since(t, lastT);
      const blobDt = since(blobT, lastBlobT);
      lastT = t;
      lastBlobT = blobT;
      screen = { width, height };

      const p = scroll / Math.max(height, 1);
      if (!ready) want = false;
      else if (p > MELT_AT) want = true;
      else if (p < FORM_AT) want = false;

      // The title scrolls with the page; the blob lives on the screen.
      const home = anchor && { x: anchor.x, y: anchor.y - scroll };
      const size = anchor?.size ?? 100;

      if (phase === "title") {
        if (!titleMoves) return;
        // Scrolled past before it could melt in view: no need to wait.
        const gone = home && home.y < -0.5 * size;
        const next =
          want && gone
            ? 1
            : clamp(melt + (want ? dt / MELT_TIME : -dt / FORM_TIME), 0, 1);
        if (next !== melt) {
          melt = next;
          version++;
        }
        if (melt >= 1 && want && home) {
          // The melted title becomes the blob, in the same frame.
          phase = "blob";
          const goal = aim();
          const dx = goal.x - home.x;
          const dy = goal.y - home.y;
          const d = Math.max(Math.hypot(dx, dy), 1);
          blob.place(home.x, home.y, DROP * size);
          blob.fling((dx / d) * LAUNCH, (dy / d) * LAUNCH);
          version++;
        }
        blob.shape.opacity = 0;
        return;
      }

      if (!blobMoves) return;
      let gx: number;
      let gy: number;
      let r = BLOB * size;
      if (want || !home) {
        const goal = aim();
        const idle = performance.now() - lastMove > IDLE_AFTER;
        if (idle && !wasIdle && orbit < 0.05) {
          // Set off the way it was already going (or away from the target,
          // if it's still), turning the way it was curving.
          const still = blob.speed < 40;
          const ox = still ? blob.x - goal.x : blob.vx;
          const oy = still ? blob.y - goal.y : blob.vy;
          angle = Math.atan2(oy / 0.72, ox);
          const turning = (blob.x - goal.x) * blob.vy - (blob.y - goal.y) * blob.vx;
          spin = turning < 0 ? -1 : 1;
        }
        wasIdle = idle;
        const w = idle ? ORBIT_IN : ORBIT_OUT;
        const steps = Math.ceil(blobDt * 240);
        for (let i = 0; i < steps; i++) {
          const h = blobDt / steps;
          orbitV += (w * w * ((idle ? 1 : 0) - orbit) - 2 * w * orbitV) * h;
          orbit = clamp(orbit + orbitV * h, 0, 1);
          // It speeds up as it swings out, so it starts off heading straight.
          angle += h * spin * ORBIT_SPEED * orbit;
        }
        const around = (2.4 * r + 26) * (1 + 0.18 * Math.sin(angle * 0.53));
        gx = goal.x + orbit * around * Math.cos(angle);
        gy = goal.y + orbit * around * 0.72 * Math.sin(angle);
        // It keeps its eyes on the target, even circling it.
        blob.lookAt(goal.x, goal.y);
      } else {
        gx = home.x;
        gy = home.y;
        r = DROP * size;
        blob.lookAt(home.x, home.y);
      }
      blob.step(blobDt, gx, gy, r);
      blob.shape.opacity = 1;

      // Home and gathered up: hand the ink back to the title, which then
      // un-melts.
      if (
        !want &&
        home &&
        Math.hypot(blob.x - home.x, blob.y - home.y) < 0.35 * DROP * size &&
        blob.reach(home.x, home.y) < 2.8 * DROP * size &&
        blob.speed < 400
      ) {
        phase = "title";
        melt = 1;
        blob.shape.opacity = 0;
        orbit = orbitV = 0;
        wasIdle = false;
        version++;
      }
    },
    get shape() {
      return blob.shape;
    },
    get melt() {
      return melt;
    },
    get loose() {
      return phase === "blob";
    },
    get free() {
      return phase === "blob" && want;
    },
    get moving() {
      return phase === "blob" || (melt > 0 && (melt < 1 || !want));
    },
    get version() {
      return version;
    },
    get target() {
      return aim();
    },
    pointTo(x, y) {
      target = { x, y };
      lastMove = performance.now();
    },
    setAnchor(next) {
      anchor = next;
    },
    setReady(next) {
      ready = next;
    },
    reset() {
      phase = "title";
      melt = 0;
      want = false;
      orbit = orbitV = 0;
      wasIdle = false;
      blob.shape.opacity = 0;
      version++;
    },
  };
}
