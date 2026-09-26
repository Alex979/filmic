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
   * The decision belongs to the ink filters: once one "auto" attachment
   * stops them, every "auto" attachment using them holds them still too
   * (only a `true` one keeps boiling them). The state shows on the element
   * as `data-filmic-boil`: "on" or "off".
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
/**
 * Frames longer than this, in ms, are stalls. One inside a step's interval
 * makes the step late, like any other long frame, but it's kept out of the
 * baseline.
 */
const PROBE_GAP = 250;
/** Frame times the baseline is the median of: about 0.5 s at 60 Hz. */
const RECENT = 31;
/** Frame times needed before their median replaces REFRESH as the baseline. */
const RECENT_MIN = 3;
/**
 * Frames right after a boil step's frame that stay out of the baseline, since
 * the step's cost can land there (see above). With more, a 30 Hz screen at
 * 12 fps footage would have no frames left to measure.
 */
const STEP_TAIL = 1;
/** The baseline until there are frames without a boil step to measure. */
const REFRESH = 1000 / 60;
/**
 * A frame is late when it takes more than this many times the baseline: the
 * median frame without a boil step (the screen's own rate), but at least
 * REFRESH. The baseline leaves out frames with a boil step, since when
 * footage runs at half the screen's rate or more those are most frames, and
 * their median would be the boil's cost itself. The REFRESH floor keeps a
 * real 120 Hz animation frame rate (Chrome or Firefox on a ProMotion screen)
 * from calling a step late for missing one 120 Hz refresh when it would still
 * have fit a 60 Hz frame. So a frame is late past 20.8 ms at 60 Hz or more:
 * at 60 Hz a missed frame takes 33 ms, and on a 120 Hz iPhone, where Safari
 * holds animation frames to 60 Hz, 25 ms (the next 120 Hz refresh). On a
 * 30 Hz screen (e.g. low-power mode) the baseline is 33 ms, so it takes over
 * 41 ms.
 */
const LATE = 1.25;

/**
 * Inks that an "auto" attachment found too costly to boil. Other "auto"
 * attachments leave them still, so a shared filter doesn't keep boiling
 * through them.
 */
const stopped = new WeakSet<InkFilter>();

/**
 * Watches what the ink's boil costs while `element` is on screen and calls
 * `decide` once, if the boil keeps making frames late. Per frame it does a
 * subtraction and a few comparisons; per boil step, a median of RECENT
 * numbers. Its rAF loop runs only while boil steps keep coming (`step`), and
 * stops for good once it decides.
 */
function boilProbe(element: Element, decide: () => void) {
  let raf = 0;
  let last = -1; // the previous frame's timestamp; -1: none yet
  // When the latest two boil steps were applied. With a step every frame
  // and the film drawing before this loop's callback, the latest is already
  // this frame's by the time the previous frame's step is looked for.
  let stepAt = -Infinity;
  let stepBefore = -Infinity;
  let since = 0; // frames since the latest boil step's frame
  let inView = false;
  // Recent frame times without a boil step, for the baseline.
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

  // Start over, so nothing is counted across a pause. The baseline is the
  // screen's, so it's kept.
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
  // Entries come oldest first: the last is the element's current state.
  const view = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    if (!inView) pause();
  });
  view.observe(element);
  // A hidden page has no frames, and the first one back would look like a
  // stall.
  const visibility = () => {
    if (document.hidden) pause();
  };
  document.addEventListener("visibilitychange", visibility);
  const stop = () => {
    pause();
    view.disconnect();
    document.removeEventListener("visibilitychange", visibility);
  };

  // A step's interval is over: judge it against the baseline.
  const close = () => {
    if (!open) return;
    let baseline = REFRESH;
    const count = Math.min(recentCount, RECENT);
    if (count >= RECENT_MIN) {
      const values = sorted.subarray(0, count);
      values.set(recent.subarray(0, count));
      values.sort();
      baseline = Math.max(values[count >> 1], REFRESH);
    }
    const isLate = longest > LATE * baseline ? 1 : 0;
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
    if (document.hidden) return pause();
    // A step applied during the previous frame starts a new interval with
    // this gap. Every callback in a frame gets the frame's start time, so
    // this holds whether the film drew before or after this loop.
    if (
      (stepAt >= previous && stepAt < time) ||
      (stepBefore >= previous && stepBefore < time)
    ) {
      close();
      if (!raf) return; // decided
      open = true;
      longest = 0;
      since = 0;
    } else since++;
    if (open) longest = Math.max(longest, gap);
    if (since > STEP_TAIL && gap <= PROBE_GAP)
      recent[recentCount++ % RECENT] = gap;
  };

  return {
    /** A boil step was just applied. */
    step() {
      stepBefore = stepAt;
      stepAt = performance.now();
      if (raf || !inView || document.hidden) return;
      // The loop's first frame only takes its timestamp: the frame this step
      // was applied in isn't measured, and the next one counts as its tail.
      last = -1;
      since = 0;
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
  const auto = boil === "auto";
  // An "auto" attachment leaves inks that another one stopped (see stopped).
  const live = (ink: InkFilter) => !auto || !stopped.has(ink);
  let boiling = boil !== false && inks.some(live);
  // The boil's state, where it's cheap to read (e.g. from a device's inspector).
  const show = (state: "on" | "off") => {
    element.dataset.filmicBoil = state;
  };
  let probe: ReturnType<typeof boilProbe> | null = null;
  const stopBoiling = () => {
    probe?.stop();
    probe = null;
    boiling = false;
    show("off");
  };
  if (inks.length) {
    show(boiling ? "on" : "off");
    if (auto && boiling)
      probe = boilProbe(element, () => {
        probe = null; // it has stopped itself
        for (const ink of inks) {
          stopped.add(ink);
          ink.setFrame(0);
        }
        stopBoiling();
      });
  }
  // The pose the element has, as the frame fields it came from (n < 0: none),
  // and the shift it applied.
  let posed = -1;
  let originX = 0;
  let originY = 0;
  let rotation = 0;
  let brightness = 0;
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
    // New settings or a resize can change the pose within a footage frame.
    if (
      f.n === posed &&
      f.origin[0] === originX &&
      f.origin[1] === originY &&
      f.dx === dx &&
      f.dy === dy &&
      f.rotation === rotation &&
      f.brightness === brightness
    )
      return;
    const newFrame = f.n !== posed;
    posed = f.n;
    originX = f.origin[0];
    originY = f.origin[1];
    rotation = f.rotation;
    brightness = f.brightness;
    // The rotation center is the film frame's, wherever the element sits.
    // The element's box includes the shift it was given last frame; the
    // rotation's effect on it is too small to matter.
    const c = canvas.getBoundingClientRect();
    const e = element.getBoundingClientRect();
    const ox = c.left + originX - (e.left - dx);
    const oy = c.top + originY - (e.top - dy);
    dx = f.dx;
    dy = f.dy;
    style.transformOrigin = `${ox.toFixed(2)}px ${oy.toFixed(2)}px`;
    style.transform = `translate(${dx.toFixed(3)}px, ${dy.toFixed(3)}px) rotate(${rotation.toFixed(6)}rad)`;
    style.filter = `brightness(${brightness.toFixed(4)})`;
    if (!boiling || !newFrame) return;
    let stepped = false;
    for (const ink of inks) {
      if (!live(ink)) continue;
      ink.setFrame(f.n);
      stepped = true;
    }
    if (stepped) probe?.step();
    else stopBoiling(); // another attachment stopped all of them
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
