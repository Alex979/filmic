import { createProgram, FULLSCREEN_VERT } from "../core/gl";
import { createRenderTarget, srgbFormat } from "../core/target";
import type { SourceFrame, View } from "../source";

/**
 * Optics: what the lens and film do to the image before grain.
 *
 * Real film is never pixel-sharp: lenses and the emulsion itself spread light a
 * little. Without this, a crisp digital source keeps its razor edges under the
 * grain and reads as "edited photo" rather than film.
 */
export interface OpticsOptions {
  /** Blur radius (gaussian sigma) in film px. 0 = pixel-sharp. */
  blur: number;
}

export const DEFAULT_OPTICS: OpticsOptions = {
  blur: 1,
};

/** Largest blur radius, in device px, per pass. */
const MAX_RADIUS = 48;
/** Reads each side of the center in one pass: one per pixel, at most. */
const MAX_TAPS = MAX_RADIUS;

/**
 * One direction of a separable gaussian blur. Run horizontally, then
 * vertically on the result: the two 1D blurs combine into an exact 2D gaussian
 * at a fraction of the cost.
 *
 * Works in linear light (so bright edges don't go muddy). The textures are
 * sRGB (see srgbFormat), so the GPU does the conversions, and blends between
 * pixels in linear light: one read placed between two pixels, weighted by
 * their combined weight, adds up to exactly the two reads it replaces. That
 * holds only where the input's pixels line up 1:1 with the output's, so an
 * input with any other mapping gets a read per pixel (see pairTaps).
 */
const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uInput;
uniform vec2 uUvScale;       // input mapping, see SourceFrame
uniform vec2 uUvOffset;
uniform vec2 uBufferSize;    // output size in device px
uniform vec2 uDirection;     // (1, 0) or (0, 1)
uniform int uTaps;           // reads each side of the center
uniform float uOffsets[${MAX_TAPS + 1}];  // where each read lands, in px ([0] unused)
uniform float uWeights[${MAX_TAPS + 1}];  // its weight ([0] is the center's)

out vec4 fragColor;

vec3 tap(vec2 uv) {
  return texture(uInput, uv * uUvScale + uUvOffset).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferSize;
  vec2 texel = uDirection / uBufferSize;

  vec3 sum = tap(uv) * uWeights[0];
  for (int i = 1; i <= ${MAX_TAPS}; i++) {
    if (i > uTaps) break;
    vec2 o = texel * uOffsets[i];
    sum += (tap(uv + o) + tap(uv - o)) * uWeights[i];
  }
  fragColor = vec4(sum, 1.);
}`;

/** Normalized weights of a gaussian of `sigma` px at 0, 1, 2, ... px. */
export function gaussianWeights(sigma: number) {
  const radius = Math.min(Math.ceil(sigma * 3.5), MAX_RADIUS);
  const w: number[] = [];
  for (let i = 0; i <= radius; i++)
    w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const total = w[0] + 2 * w.slice(1).reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

/**
 * One read per pixel, at 1, 2, 3, ... px: for an input that doesn't line up
 * 1:1 with the output, where reads between pixels would blend the wrong ones.
 * Fills `offsets` and `weights` and returns the read count.
 */
export function plainTaps(
  w: number[],
  offsets: Float32Array,
  weights: Float32Array,
): number {
  offsets.fill(0);
  weights.fill(0);
  for (let i = 0; i < w.length; i++) {
    offsets[i] = i;
    weights[i] = w[i];
  }
  return w.length - 1;
}

/**
 * Fold per-pixel weights into reads between pixel pairs (1 and 2, 3 and 4,
 * ...): each read has the pair's combined weight and lands where the pair's
 * weights balance. Exact only when the input's pixels line up 1:1 with the
 * output's. Fills `offsets` and `weights` and returns the read count.
 */
export function pairTaps(
  w: number[],
  offsets: Float32Array,
  weights: Float32Array,
): number {
  offsets.fill(0);
  weights.fill(0);
  weights[0] = w[0];
  let taps = 0;
  for (let i = 1; i < w.length; i += 2) {
    const a = w[i];
    const b = w[i + 1] ?? 0;
    taps++;
    weights[taps] = a + b;
    offsets[taps] = (i * a + (i + 1) * b) / (a + b);
  }
  return taps;
}

export interface Optics {
  /**
   * Blur `frame` per the settings. Returns a frame in screen space (identity
   * mapping), or the input unchanged when the blur is too small to matter.
   */
  apply(
    frame: SourceFrame,
    view: View,
    options: OpticsOptions,
    filmScale: number,
  ): SourceFrame;
  dispose(): void;
}

export function createOptics(gl: WebGL2RenderingContext): Optics {
  const { program, uniforms: u } = createProgram(
    gl,
    FULLSCREEN_VERT,
    BLUR_FRAG,
  );
  const horizontal = createRenderTarget(gl, srgbFormat(gl));
  const vertical = createRenderTarget(gl, srgbFormat(gl));
  // The reads for the current blur, paired and one per pixel, each kept
  // until the blur changes.
  const kernel = (fold: typeof pairTaps) => {
    const offsets = new Float32Array(MAX_TAPS + 1);
    const weights = new Float32Array(MAX_TAPS + 1);
    let sigma = NaN;
    let taps = 0;
    return {
      offsets,
      weights,
      get taps() {
        return taps;
      },
      update(next: number) {
        if (next === sigma) return;
        sigma = next;
        taps = fold(gaussianWeights(sigma), offsets, weights);
      },
    };
  };
  const paired = kernel(pairTaps);
  const plain = kernel(plainTaps);
  type Kernel = typeof paired;

  const pass = (
    input: SourceFrame,
    target: typeof horizontal,
    direction: [number, number],
    view: View,
    { taps, offsets, weights }: Kernel,
  ) => {
    target.resize(view.bufferWidth, view.bufferHeight);
    target.bind();
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.uniform1i(u.uInput, 0);
    gl.uniform2f(u.uUvScale, input.uvScale[0], input.uvScale[1]);
    gl.uniform2f(u.uUvOffset, input.uvOffset[0], input.uvOffset[1]);
    gl.uniform2f(u.uBufferSize, view.bufferWidth, view.bufferHeight);
    gl.uniform2f(u.uDirection, direction[0], direction[1]);
    gl.uniform1i(u.uTaps, taps);
    gl.uniform1fv(u.uOffsets, offsets);
    gl.uniform1fv(u.uWeights, weights);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return {
    apply(frame, view, options, filmScale) {
      // Film px -> device px.
      const sigma = (options.blur / filmScale) * view.pixelRatio;
      if (sigma < 0.3) return frame;
      paired.update(sigma);

      // Horizontal pass reads the source through its mapping; everything after
      // is in screen space, 1:1 with the output. The source is taken to be too
      // only when its mapping is the identity (see SourceFrame).
      const identity =
        frame.uvScale[0] === 1 &&
        frame.uvScale[1] === 1 &&
        frame.uvOffset[0] === 0 &&
        frame.uvOffset[1] === 0;
      if (!identity) plain.update(sigma);
      pass(frame, horizontal, [1, 0], view, identity ? paired : plain);
      pass(
        { texture: horizontal.texture, uvScale: [1, 1], uvOffset: [0, 0] },
        vertical,
        [0, 1],
        view,
        paired,
      );
      return { texture: vertical.texture, uvScale: [1, 1], uvOffset: [0, 0] };
    },
    dispose() {
      gl.deleteProgram(program);
      horizontal.dispose();
      vertical.dispose();
    },
  };
}
