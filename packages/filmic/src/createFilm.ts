import { createFilmPass } from "./film/filmPass";
import type { Source, View } from "./source";
import { testPattern } from "./sources/testPattern";

export interface FilmOptions {
  /** What to film. Default: a test pattern. */
  source?: Source;
  /**
   * Upper limit on the canvas's pixel ratio. On a 3x phone screen, rendering at
   * 2x is visually identical for grainy film and costs ~45% fewer pixels.
   * Default: 2.
   */
  maxPixelRatio?: number;
}

export interface Film {
  /** Schedule a redraw on the next animation frame. */
  render(): void;
  /** Stop rendering and release GPU resources. */
  destroy(): void;
}

/**
 * Attach filmic to a canvas. Size the canvas with CSS (e.g. absolutely
 * positioned to fill its container); filmic keeps its drawing buffer matched
 * to that size at the screen's pixel density.
 */
export function createFilm(
  canvas: HTMLCanvasElement,
  options: FilmOptions = {},
): Film {
  const maxPixelRatio = options.maxPixelRatio ?? 2;

  const gl = canvas.getContext("webgl2", {
    alpha: false, // opaque canvas: the browser can skip blending it with the page
    antialias: false, // we only draw full-screen passes; MSAA would be wasted
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("filmic: WebGL2 is not available");

  const source = (options.source ?? testPattern()).create(gl);
  const filmPass = createFilmPass(gl);

  const view: View = {
    width: 0,
    height: 0,
    pixelRatio: 1,
    bufferWidth: 0,
    bufferHeight: 0,
  };

  // --- Render loop: draw at most once per frame, and only when asked ---
  let frame = 0;
  let destroyed = false;

  const draw = () => {
    frame = 0;
    if (!view.width || !view.height) return;

    // Pass 1: the source renders the scene into a texture.
    const sourceFrame = source.render(view);

    // Pass 2: the film pass reads that texture and draws to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.bufferWidth, view.bufferHeight);
    filmPass.draw(sourceFrame, view);
  };

  const render = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(draw);
  };

  // --- Sizing: keep the drawing buffer matched to the canvas's on-screen size ---
  const observer = new ResizeObserver(([entry]) => {
    const box = entry.contentBoxSize[0];
    view.width = box.inlineSize;
    view.height = box.blockSize;

    // Prefer the exact device-pixel size the browser reports (avoids blurry
    // off-by-one scaling at fractional zoom levels); fall back to CSS size * DPR.
    const native = window.devicePixelRatio || 1;
    const device = entry.devicePixelContentBoxSize?.[0];
    const deviceWidth = device ? device.inlineSize : view.width * native;
    const deviceHeight = device ? device.blockSize : view.height * native;
    const cap = Math.min(1, maxPixelRatio / native);

    view.bufferWidth = Math.max(1, Math.round(deviceWidth * cap));
    view.bufferHeight = Math.max(1, Math.round(deviceHeight * cap));
    if (canvas.width !== view.bufferWidth) canvas.width = view.bufferWidth;
    if (canvas.height !== view.bufferHeight) canvas.height = view.bufferHeight;
    view.pixelRatio = view.bufferWidth / Math.max(view.width, 1);

    // Resizing a canvas wipes it to black. Redraw right away instead of on the
    // next frame: ResizeObserver runs after layout but before paint, so the
    // browser never shows the wiped canvas (no flicker while dragging).
    if (destroyed) return;
    cancelAnimationFrame(frame);
    draw();
  });
  try {
    // Also fires when only the pixel ratio changes (browser zoom, moving
    // the window to another monitor).
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(canvas); // browsers without device-pixel-content-box
  }

  return {
    render,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      source.dispose();
      filmPass.dispose();
      // The context itself belongs to the canvas and is left alone, so the
      // same canvas can be handed to createFilm again (e.g. React remounts).
    },
  };
}
