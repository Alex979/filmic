import { createProgram, FULLSCREEN_VERT } from "./core/gl";

export interface FilmOptions {
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
 * Temporary test pattern: a soft gradient, a grid line every 100 CSS px drawn
 * exactly one device pixel wide, and a 100px-radius circle. If the lines are
 * crisp and the circle is round, sizing and pixel ratio are correct.
 */
const TEST_PATTERN_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uResolution;   // canvas size in CSS px
uniform vec2 uBufferSize;   // drawing buffer size in device px
uniform float uPixelRatio;  // device px per CSS px
out vec4 o;

void main() {
  // gl_FragCoord is in device px with y up; convert to CSS px with y down,
  // the coordinate system the rest of the page uses.
  vec2 px = vec2(gl_FragCoord.x, uBufferSize.y - gl_FragCoord.y) / uPixelRatio;
  vec2 uv = px / uResolution;

  vec3 c = vec3(.08 + .25 * uv.x, .08 + .12 * (1. - uv.y), .16);

  vec2 cell = mod(px, 100.);
  float onePx = 1. / uPixelRatio;
  if (cell.x < onePx || cell.y < onePx) c = vec3(.45);

  float r = length(px - uResolution * .5);
  if (abs(r - 100.) < onePx) c = vec3(.95, .6, .3);

  o = vec4(c, 1.);
}`;

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

  const testPattern = createProgram(gl, FULLSCREEN_VERT, TEST_PATTERN_FRAG);

  // Canvas size in CSS px, and the pixel ratio we actually render at.
  let cssWidth = 0;
  let cssHeight = 0;
  let pixelRatio = 1;

  // --- Render loop: draw at most once per frame, and only when asked ---
  let frame = 0;
  let destroyed = false;

  const draw = () => {
    frame = 0;
    if (!cssWidth || !cssHeight) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(testPattern.program);
    gl.uniform2f(testPattern.uniforms.uResolution, cssWidth, cssHeight);
    gl.uniform2f(testPattern.uniforms.uBufferSize, canvas.width, canvas.height);
    gl.uniform1f(testPattern.uniforms.uPixelRatio, pixelRatio);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const render = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(draw);
  };

  // --- Sizing: keep the drawing buffer matched to the canvas's on-screen size ---
  const observer = new ResizeObserver(([entry]) => {
    const box = entry.contentBoxSize[0];
    cssWidth = box.inlineSize;
    cssHeight = box.blockSize;

    // Prefer the exact device-pixel size the browser reports (avoids blurry
    // off-by-one scaling at fractional zoom levels); fall back to CSS size * DPR.
    const native = window.devicePixelRatio || 1;
    const device = entry.devicePixelContentBoxSize?.[0];
    const deviceWidth = device ? device.inlineSize : cssWidth * native;
    const deviceHeight = device ? device.blockSize : cssHeight * native;
    const cap = Math.min(1, maxPixelRatio / native);

    const width = Math.max(1, Math.round(deviceWidth * cap));
    const height = Math.max(1, Math.round(deviceHeight * cap));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    pixelRatio = width / Math.max(cssWidth, 1);
    render();
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
      gl.deleteProgram(testPattern.program);
      // The context itself belongs to the canvas and is left alone, so the
      // same canvas can be handed to createFilm again (e.g. React remounts).
    },
  };
}
