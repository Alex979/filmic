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
}

/**
 * Move an element with the film: each frame's weave (as a transform about
 * the film frame's center) and flicker (as a brightness filter), and boil its
 * ink filters' noise. It takes over the element's `transform`,
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
  const reset = () => {
    style.transform = "";
    style.transformOrigin = "";
    style.filter = "";
    for (const ink of inks) ink.setFrame(0);
  };

  const off = subscribe((f) => {
    if (!f.playing) return reset();
    // The rotation center is the film frame's, wherever the element sits.
    const c = canvas.getBoundingClientRect();
    const e = element.getBoundingClientRect();
    const ox = c.left + f.origin[0] - e.left;
    const oy = c.top + f.origin[1] - e.top;
    style.transformOrigin = `${ox.toFixed(2)}px ${oy.toFixed(2)}px`;
    style.transform = `translate(${f.dx.toFixed(3)}px, ${f.dy.toFixed(3)}px) rotate(${f.rotation.toFixed(6)}rad)`;
    style.filter = `brightness(${f.brightness.toFixed(4)})`;
    for (const ink of inks) ink.setFrame(f.n);
  });

  return () => {
    off();
    reset();
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
