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
 * - "source": wherever the source put its image (e.g. an elementSource laid
 *   out with cover or contain), so effects scale with the picture. Sources
 *   without an image of their own fall back to "cover". (default)
 * - "cover": fill the canvas, cropping the frame
 * - "contain": fit the whole frame inside the canvas
 * - "fill": exactly the canvas
 * - "screen": exactly the canvas, and 1 film px = 1 CSS px, so effects keep a
 *   fixed on-screen size instead of scaling with the canvas
 * - a function returning the frame's rect, for any other layout
 */
export type FrameFit =
  | "source"
  | "cover"
  | "contain"
  | "fill"
  | "screen"
  | ((view: View) => Rect);

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
  fit: "source",
  aspect: 16 / 9,
  anchor: [0.5, 0.5],
  resolution: 1080,
};

/**
 * Lay a box of the given aspect ratio over a `width` x `height` area, like CSS
 * object-fit + object-position: "cover" fills the area (cropping), "contain"
 * fits inside it (leaving bars), "fill" stretches to it. `anchor` pins the box
 * when it doesn't match: [0, 0] top-left, [0.5, 0.5] centered.
 */
export function fitRect(
  width: number,
  height: number,
  aspect: number,
  fit: "cover" | "contain" | "fill",
  anchor: [number, number] = [0.5, 0.5],
): Rect {
  if (fit === "fill") return { x: 0, y: 0, width, height };
  const areaIsWider = width / height > aspect;
  const matchWidth = fit === "cover" ? areaIsWider : !areaIsWider;
  const w = matchWidth ? width : height * aspect;
  const h = matchWidth ? width / aspect : height;
  return {
    x: (width - w) * anchor[0],
    y: (height - h) * anchor[1],
    width: w,
    height: h,
  };
}

export interface ResolvedFrame {
  rect: Rect;
  /** Film px per CSS px. */
  scale: number;
}

/**
 * Where the film frame sits for this view. `sourceRect` is where the source
 * says its image is (see SourceFrame.rect), used by the "source" fit.
 */
export function resolveFrame(
  view: View,
  frame: FrameOptions,
  sourceRect?: Rect,
): ResolvedFrame {
  const W = view.width;
  const H = view.height;
  const fit = frame.fit;
  const byHeight = (rect: Rect) => ({
    rect,
    scale: frame.resolution / Math.max(rect.height, 1e-3),
  });

  if (typeof fit === "function") return byHeight(fit(view));
  if (fit === "source" && sourceRect) return byHeight(sourceRect);
  if (fit === "screen") {
    return { rect: { x: 0, y: 0, width: W, height: H }, scale: 1 };
  }
  return byHeight(
    fitRect(W, H, frame.aspect, fit === "source" ? "cover" : fit, frame.anchor),
  );
}
