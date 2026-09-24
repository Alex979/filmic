import type { View } from "../source";

/** A rectangle in CSS px, relative to the canvas's top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How the film frame is laid over the canvas. Mirrors CSS object-fit:
 * - "cover": fill the canvas, cropping the frame (default)
 * - "contain": fit the whole frame inside the canvas
 * - "fill": exactly the canvas
 * - "screen": exactly the canvas, and 1 film px = 1 CSS px, so effects keep a
 *   fixed on-screen size instead of scaling with the canvas
 * - a function returning the frame's rect, for any other layout
 */
export type FrameFit =
  "cover" | "contain" | "fill" | "screen" | ((view: View) => Rect);

/**
 * The film frame: the piece of film being projected onto the canvas. Effects
 * that live "on the film" (grain, and later dust, mottle, weave) are anchored
 * to it, so they move and scale with the image instead of sitting on the
 * screen like an overlay.
 */
export interface FrameOptions {
  fit: FrameFit;
  /** Frame width / height, for "cover" and "contain". */
  aspect: number;
  /** Where the frame is pinned when it doesn't match the canvas: [x, y] in 0..1. */
  anchor: [number, number];
  /** Film px across the frame's height. Effect sizes are given in film px. */
  resolution: number;
}

export const DEFAULT_FRAME: FrameOptions = {
  fit: "cover",
  aspect: 16 / 9,
  anchor: [0.5, 0.5],
  resolution: 1080,
};

export interface ResolvedFrame {
  rect: Rect;
  /** Film px per CSS px. */
  scale: number;
}

export function resolveFrame(view: View, frame: FrameOptions): ResolvedFrame {
  const W = view.width;
  const H = view.height;
  const fit = frame.fit;

  if (typeof fit === "function") {
    const rect = fit(view);
    return { rect, scale: frame.resolution / Math.max(rect.height, 1e-3) };
  }
  if (fit === "screen") {
    return { rect: { x: 0, y: 0, width: W, height: H }, scale: 1 };
  }
  if (fit === "fill") {
    return {
      rect: { x: 0, y: 0, width: W, height: H },
      scale: frame.resolution / Math.max(H, 1e-3),
    };
  }

  // cover / contain: scale the frame uniformly, then pin it with `anchor`.
  const canvasIsWider = W / H > frame.aspect;
  const matchWidth = fit === "cover" ? canvasIsWider : !canvasIsWider;
  const width = matchWidth ? W : H * frame.aspect;
  const height = matchWidth ? W / frame.aspect : H;
  const rect = {
    x: (W - width) * frame.anchor[0],
    y: (H - height) * frame.anchor[1],
    width,
    height,
  };
  return { rect, scale: frame.resolution / height };
}
