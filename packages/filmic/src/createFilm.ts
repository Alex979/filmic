import { createFilmPass, type FilmSettings } from "./film/filmPass";
import {
  DEFAULT_FOOTAGE,
  footageFrame,
  frameIndex,
  frameStart,
  STILL_FRAME,
  type FootageFrame,
  type FootageOptions,
} from "./film/footage";
import { DEFAULT_FRAME, type FrameOptions } from "./film/frame";
import { DEFAULT_DUST, type DustOptions } from "./film/dust";
import { DEFAULT_GRAIN, type GrainOptions } from "./film/grain";
import { DEFAULT_MOTTLE, type MottleOptions } from "./film/mottle";
import { DEFAULT_OPTICS, type OpticsOptions } from "./film/optics";
import { DEFAULT_HALATION, type HalationOptions } from "./film/halation";
import type { Source, SourceContext, SourceInstance, View } from "./source";
import { testPattern } from "./sources/testPattern";
import {
  attachElement,
  syncAnimations,
  type AttachOptions,
  type FrameEvent,
  type FrameListener,
} from "./dom/sync";

/**
 * Settings that can be changed at any time with `film.set()`. Each group is
 * merged into the current settings; omitted fields keep their value.
 */
export interface FilmUpdate {
  /** What to film. */
  source?: Source;
  /** How the film frame is laid over the canvas. */
  frame?: Partial<FrameOptions>;
  /** Lens and emulsion softness. */
  optics?: Partial<OpticsOptions>;
  /** The warm glow around bright highlights. */
  halation?: Partial<HalationOptions>;
  /** Faint, soft blotches of density and color. */
  mottle?: Partial<MottleOptions>;
  grain?: Partial<GrainOptions>;
  /** Specks, fibers and hairs on the film. */
  dust?: Partial<DustOptions>;
  /** Play as footage: frame rate, weave, flicker, per-frame grain and dust. */
  footage?: Partial<FootageOptions>;
}

export interface FilmOptions extends FilmUpdate {
  /**
   * Upper limit on the canvas's pixel ratio. On a 3x phone screen, rendering at
   * 2x is visually identical for grainy film and costs ~45% fewer pixels.
   * Default: 2.
   */
  maxPixelRatio?: number;
}

export interface Film {
  /** Change settings or the source; redraws on the next frame. */
  set(update: FilmUpdate): void;
  /** The current effect settings (read-only snapshot). */
  readonly settings: Readonly<FilmSettings>;
  /** Schedule a redraw on the next animation frame. */
  render(): void;
  /**
   * Listen for each drawn frame: its footage frame number and time, weave and
   * flicker. Runs in the same animation frame as the draw, so DOM changes made
   * here appear together with it. Returns a function that stops listening.
   */
  on(event: "frame", listener: FrameListener): () => void;
  /**
   * `now` (default: performance.now()) stepped to the start of its footage
   * frame while footage plays, or unchanged otherwise. Animations timed with
   * it step in sync with the film.
   */
  frameTime(now?: number): number;
  /**
   * Move an element with the film each frame (weave and flicker) and boil an
   * ink filter's noise. Takes over the element's transform and filter, so use
   * a wrapper. Returns a function that detaches it.
   */
  attach(element: HTMLElement | SVGElement, options?: AttachOptions): () => void;
  /**
   * Step an element's CSS animations and transitions at the footage frame
   * rate while footage plays. Returns a function that stops syncing.
   */
  sync(element: Element): () => void;
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

  const filmPass = createFilmPass(gl);
  const settings: FilmSettings = {
    frame: { ...DEFAULT_FRAME, ...options.frame },
    optics: { ...DEFAULT_OPTICS, ...options.optics },
    halation: { ...DEFAULT_HALATION, ...options.halation },
    mottle: { ...DEFAULT_MOTTLE, ...options.mottle },
    grain: { ...DEFAULT_GRAIN, ...options.grain },
    dust: { ...DEFAULT_DUST, ...options.dust },
    footage: { ...DEFAULT_FOOTAGE, ...options.footage },
  };

  const view: View = {
    width: 0,
    height: 0,
    pixelRatio: 1,
    bufferWidth: 0,
    bufferHeight: 0,
  };

  // --- Render loop ---
  // As a still, draw at most once per animation frame, and only when asked.
  // As footage, also draw whenever the page clock reaches a new film frame.
  let frame = 0;
  let destroyed = false;
  let current: FootageFrame = STILL_FRAME;
  const listeners = new Set<FrameListener>();
  const subscribe = (listener: FrameListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // Footage plays only while the canvas is on screen.
  let onScreen = true;
  const playing = () => settings.footage.enabled && onScreen;

  const draw = () => {
    frame = 0;
    if (!view.width || !view.height) return;

    // Pass 1: the source renders the scene into a texture.
    const sourceFrame = source.render(view);

    // Pass 2: the film pass reads that texture and draws to the screen.
    const film = filmPass.draw(sourceFrame, view, settings, current);

    if (!listeners.size) return;
    const isPlaying = current !== STILL_FRAME;
    const { fps } = settings.footage;
    const event: FrameEvent = {
      playing: isPlaying,
      n: current.n,
      time: isPlaying ? frameStart(performance.now(), fps) : performance.now(),
      fps,
      // Film px -> CSS px, so they can be used as CSS lengths.
      dx: current.dx / film.scale,
      dy: current.dy / film.scale,
      rotation: current.rotation,
      origin: [
        film.rect.x + film.rect.width / 2,
        film.rect.y + film.rect.height / 2,
      ],
      exposure: current.exposure,
      brightness: Math.pow(current.exposure, 1 / 2.2),
    };
    listeners.forEach((listener) => listener(event));
  };

  const render = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(draw);
  };

  // While footage plays, watch the page clock and draw each new film frame.
  let tick = 0;
  const loop = () => {
    tick = 0;
    if (destroyed || !playing()) return;
    const n = frameIndex(performance.now(), settings.footage.fps);
    if (current === STILL_FRAME || n !== current.n) {
      current = footageFrame(n, settings.footage);
      cancelAnimationFrame(frame);
      draw();
    }
    tick = requestAnimationFrame(loop);
  };
  const updatePlayback = () => {
    if (playing()) {
      if (!tick) tick = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(tick);
      tick = 0;
      current = STILL_FRAME;
    }
  };

  // Sources can ask for redraws themselves (an image loaded, a new video
  // frame). While footage plays, the next film frame picks the change up, so
  // live sources are filmed at the footage frame rate like everything else.
  const context: SourceContext = {
    requestRender: () => {
      if (!playing()) render();
    },
  };
  let source: SourceInstance = (options.source ?? testPattern()).create(
    gl,
    context,
  );

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
  const visibility = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updatePlayback();
    render();
  });
  visibility.observe(canvas);

  try {
    // Also fires when only the pixel ratio changes (browser zoom, moving
    // the window to another monitor).
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(canvas); // browsers without device-pixel-content-box
  }

  return {
    set(update) {
      if (destroyed) return;
      if (update.source) {
        source.dispose();
        source = update.source.create(gl, context);
      }
      if (update.frame) settings.frame = { ...settings.frame, ...update.frame };
      if (update.optics)
        settings.optics = { ...settings.optics, ...update.optics };
      if (update.halation)
        settings.halation = { ...settings.halation, ...update.halation };
      if (update.mottle)
        settings.mottle = { ...settings.mottle, ...update.mottle };
      if (update.grain) settings.grain = { ...settings.grain, ...update.grain };
      if (update.dust) settings.dust = { ...settings.dust, ...update.dust };
      if (update.footage) {
        settings.footage = { ...settings.footage, ...update.footage };
        // New settings (e.g. weave) apply from the current frame on.
        if (current !== STILL_FRAME)
          current = footageFrame(current.n, settings.footage);
        updatePlayback();
      }
      render();
    },
    get settings(): FilmSettings {
      // A copy, so callers can't change settings without going through set().
      // (Shallow per group: frame.fit may be a function, which can't be cloned.)
      return {
        frame: {
          ...settings.frame,
          anchor: [settings.frame.anchor[0], settings.frame.anchor[1]],
        },
        optics: { ...settings.optics },
        halation: { ...settings.halation },
        mottle: { ...settings.mottle },
        grain: { ...settings.grain },
        dust: { ...settings.dust },
        footage: { ...settings.footage },
      };
    },
    render,
    on(_event, listener) {
      return subscribe(listener);
    },
    frameTime(now = performance.now()) {
      return playing() ? frameStart(now, settings.footage.fps) : now;
    },
    attach(element, attachOptions) {
      const detach = attachElement(element, canvas, subscribe, attachOptions);
      render();
      return detach;
    },
    sync(element) {
      const stop = syncAnimations(element, subscribe);
      render();
      return stop;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(tick);
      observer.disconnect();
      visibility.disconnect();
      listeners.clear();
      source.dispose();
      filmPass.dispose();
      // The context itself belongs to the canvas and is left alone, so the
      // same canvas can be handed to createFilm again (e.g. React remounts).
    },
  };
}
