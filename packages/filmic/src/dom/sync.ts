import type { InkFilter } from "./inkFilter";

/** What the film tells DOM elements each time it draws. */
export interface FrameEvent {
  /** Footage is playing. When false this is a still: no motion, no flicker. */
  playing: boolean;
  /** Footage frame number on the page clock (0 when still). */
  n: number;
  /** When this frame started, in ms on the `performance.now()` clock. */
  time: number;
  /** Footage frames per second. */
  fps: number;
  /** Weave shift, in CSS px. */
  dx: number;
  dy: number;
  /** Weave rotation, in radians, about `origin`. */
  rotation: number;
  /** The film frame's center, in CSS px from the canvas's top-left corner. */
  origin: [number, number];
  /** Flicker, as a multiplier on linear light. */
  exposure: number;
  /** The same flicker as a CSS `brightness()` amount (it scales sRGB values). */
  brightness: number;
}

export type FrameListener = (frame: FrameEvent) => void;
type Subscribe = (listener: FrameListener) => () => void;

export interface AttachOptions {
  /** Ink filters used inside the element: their noise boils every frame. */
  ink?: InkFilter | readonly InkFilter[];
  /**
   * Whether the ink boils. `true`: every footage frame. `false`: never (it
   * holds still). `"auto"` (default): it boils, watches what that costs,
   * and stops for good if it keeps dropping frames (see WINDOW_LATE).
   * The state shows on the element as `data-filmic-boil`: "on" or "off".
   */
  boil?: boolean | "auto";
}

// --- boil: "auto" ---
// Safari paints SVG filters on the CPU, and each boil step (new noise every
// footage frame) redraws every boiling filter. Whether that fits in a frame
// depends on the device and the page, and can't be predicted: on an iPhone,
// the horizon example's boiling title made a late frame at nearly every boil
// step (96 of 480 frames in 8 s); on desktop Safari about 1 step in 6 was,
// which is fine; a page of boiling paragraphs cost nothing measurable on
// either. So the ink boils from the start while its cost is watched, and
// stops for good once most boil steps are dropping frames.
//
// A step's late frame doesn't reliably land in the frame that applied it
// (WebKit can paint it a frame or two later), so a step counts as late if
// any frame until the next step was.

/** Boil steps judged together: 2 s of footage at 12 fps. */
const WINDOW = 24;
/**
 * The boil stops once this many of the last WINDOW steps were late. The
 * iPhone makes nearly every step late, so it stops there in about 2 s;
 * desktop Safari's 1 in 6 keeps it, and so does a one-off second of jank
 * (12 of 24).
 */
const WINDOW_LATE = 16;
/** Longer gaps between frames, in ms, are stalls or a hidden page. */
const PROBE_GAP = 250;
/** Recent frames the median frame time is taken over: about 0.5 s at 60 Hz. */
const RECENT = 31;
/**
 * A frame is late when it takes this many times the median frame, so the
 * test works at any refresh rate. At 60 Hz a missed frame takes 2x, but on a
 * 120 Hz iPhone, where Safari holds animation frames to 60 Hz, it takes only
 * 1.5x (25 ms): the next 120 Hz refresh.
 */
const LATE = 1.25;

/**
 * Watches what the ink's boil costs while `element` is on screen and calls
 * `decide` once, if the boil keeps making frames late. Per frame it does a
 * subtraction and a comparison; per boil step, a median of RECENT numbers.
 * Its rAF loop runs only while boil steps keep coming (`step`), and stops for
 * good once it decides.
 */
function boilProbe(element: Element, decide: () => void) {
  let raf = 0;
  let last = -1; // the previous frame's timestamp; -1: none yet
  let stepAt = -Infinity; // when the latest boil step was applied
  let inView = false;
  // Recent frame times, for the median.
  const recent = new Float64Array(RECENT);
  const sorted = new Float64Array(RECENT);
  let recentCount = 0;
  // The current step's interval: whether one is open, and its longest frame.
  let open = false;
  let longest = 0;
  // Whether each of the last WINDOW steps was late, as a ring.
  const judged = new Uint8Array(WINDOW);
  let steps = 0;
  let late = 0;

  // Start over, so nothing is counted across a gap.
  const clear = () => {
    open = false;
    steps = late = 0;
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    clear();
  };
  // Off screen, the browser doesn't paint the ink, so its cost can't show.
  const view = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (!inView) pause();
  });
  view.observe(element);
  const stop = () => {
    pause();
    view.disconnect();
  };

  // A step's interval is over: judge it against the recent median.
  const close = () => {
    if (!open || recentCount < RECENT) return;
    sorted.set(recent);
    sorted.sort();
    const isLate = longest > LATE * sorted[RECENT >> 1] ? 1 : 0;
    const slot = steps % WINDOW;
    if (steps >= WINDOW) late -= judged[slot];
    judged[slot] = isLate;
    late += isLate;
    steps++;
    if (steps >= WINDOW && late >= WINDOW_LATE) {
      stop();
      decide();
    }
  };

  const frame = (time: number) => {
    raf = requestAnimationFrame(frame);
    const gap = time - last;
    const previous = last;
    last = time;
    if (previous < 0) return;
    if (gap > PROBE_GAP || document.hidden) return clear();
    // A step applied during the previous frame starts a new interval with
    // this gap. Every callback in a frame gets the frame's start time, so
    // this holds whether the film drew before or after this loop.
    if (stepAt >= previous && stepAt < time) {
      close();
      if (!raf) return; // decided
      open = true;
      longest = 0;
    }
    longest = Math.max(longest, gap);
    recent[recentCount++ % RECENT] = gap;
  };

  return {
    /** A boil step was just applied. */
    step() {
      stepAt = performance.now();
      if (raf || !inView) return;
      last = -1;
      raf = requestAnimationFrame(frame);
    },
    /** Footage stopped: stop watching until the next step. */
    pause,
    /** Detached: stop for good. */
    stop,
  };
}

/**
 * Move an element with the film: each frame's weave (as a transform about
 * the film frame's center) and flicker (as a brightness filter), and boil its
 * ink filters' noise (see `boil`). It takes over the element's `transform`,
 * `transform-origin` and `filter`, so attach a wrapper around the content
 * (which can have its own transforms and filters).
 *
 * Curved text: browsers snap glyphs that are almost exactly upright to whole
 * pixels, but not rotated ones. When text inside is redrawn (e.g. its ink
 * boils) at each frame's sub-pixel weave offset, a letter at the top of a
 * curve can then jitter on its own. An invisible skew on the text (e.g.
 * `transform: skewX(0.05deg)`) keeps every glyph off the snapping path.
 */
export function attachElement(
  element: HTMLElement | SVGElement,
  canvas: HTMLCanvasElement,
  subscribe: Subscribe,
  options: AttachOptions = {},
) {
  const style = element.style;
  const inks = options.ink ? [options.ink].flat() : [];
  const boil = options.boil ?? "auto";
  let boiling = inks.length > 0 && boil !== false;
  // The boil's state, where it's cheap to read (e.g. from a device's inspector).
  const show = (state: "on" | "off") => {
    element.dataset.filmicBoil = state;
  };
  let probe: ReturnType<typeof boilProbe> | null = null;
  if (inks.length) {
    show(boiling ? "on" : "off");
    if (boil === "auto")
      probe = boilProbe(element, () => {
        probe = null;
        boiling = false;
        show("off");
        for (const ink of inks) ink.setFrame(0);
      });
  }
  // The frame the element is posed for, and the shift that pose applied.
  let posed = -1;
  let dx = 0;
  let dy = 0;
  const reset = () => {
    probe?.pause();
    if (posed < 0) return;
    posed = -1;
    dx = dy = 0;
    style.transform = "";
    style.transformOrigin = "";
    style.filter = "";
    for (const ink of inks) ink.setFrame(0);
  };

  const off = subscribe((f) => {
    if (!f.playing) return reset();
    // Draws between footage frames (e.g. on scroll) change nothing here, and
    // touching the styles anyway would make the browser redraw the element.
    if (f.n === posed) return;
    posed = f.n;
    // The rotation center is the film frame's, wherever the element sits.
    // The element's box includes the shift it was given last frame; the
    // rotation's effect on it is too small to matter.
    const c = canvas.getBoundingClientRect();
    const e = element.getBoundingClientRect();
    const ox = c.left + f.origin[0] - (e.left - dx);
    const oy = c.top + f.origin[1] - (e.top - dy);
    dx = f.dx;
    dy = f.dy;
    style.transformOrigin = `${ox.toFixed(2)}px ${oy.toFixed(2)}px`;
    style.transform = `translate(${f.dx.toFixed(3)}px, ${f.dy.toFixed(3)}px) rotate(${f.rotation.toFixed(6)}rad)`;
    style.filter = `brightness(${f.brightness.toFixed(4)})`;
    if (!boiling) return;
    for (const ink of inks) ink.setFrame(f.n);
    probe?.step();
  });

  return () => {
    off();
    probe?.stop();
    reset();
    if (inks.length) delete element.dataset.filmicBoil;
  };
}

/**
 * Step an element's CSS animations and transitions (and those of its
 * descendants) at the footage frame rate, in lockstep with the film. While
 * footage isn't playing they run normally, at the screen's rate.
 */
export function syncAnimations(element: Element, subscribe: Subscribe) {
  // Each animation's start on the page clock, so stepping can put it exactly
  // where it would be at the start of the current film frame.
  const starts = new Map<Animation, number>();

  const release = () => {
    for (const [animation, start] of starts) {
      // Setting the start time resumes a paused animation from there.
      if (animation.playState === "paused") animation.startTime = start;
    }
    starts.clear();
  };

  const off = subscribe((f) => {
    if (!f.playing) return release();
    const now = performance.now();
    const live = new Set(element.getAnimations({ subtree: true }));
    for (const animation of live) {
      if (!starts.has(animation)) {
        const start =
          animation.startTime != null
            ? Number(animation.startTime)
            : now - Number(animation.currentTime ?? 0);
        starts.set(animation, start);
      }
      if (animation.playState !== "paused") animation.pause();
      animation.currentTime = Math.max(0, f.time - starts.get(animation)!);
    }
    for (const animation of starts.keys())
      if (!live.has(animation)) starts.delete(animation);
  });

  return () => {
    off();
    release();
  };
}
