import { createProgram, FULLSCREEN_VERT } from "../core/gl";
import { createRenderTarget } from "../core/target";
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

/**
 * One direction of a separable gaussian blur. Run horizontally, then
 * vertically on the result: the two 1D blurs combine into an exact 2D gaussian
 * at a fraction of the cost.
 *
 * Works in linear light (so bright edges don't go muddy) and writes sRGB back
 * out, so 8-bit intermediate textures keep precision in the shadows.
 */
const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uInput;
uniform vec2 uUvScale;       // input mapping, see SourceFrame
uniform vec2 uUvOffset;
uniform vec2 uBufferSize;    // output size in device px
uniform vec2 uDirection;     // (1, 0) or (0, 1)
uniform int uRadius;         // device px
uniform float uWeights[${MAX_RADIUS + 1}];  // weight at 0, 1, 2, ... px

out vec4 fragColor;

vec3 sampleLinear(vec2 uv) {
  vec3 c = texture(uInput, uv * uUvScale + uUvOffset).rgb;
  return pow(max(c, 0.), vec3(2.2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferSize;
  vec2 texel = uDirection / uBufferSize;

  // Read every pixel in the radius individually. (Reading between pixel pairs
  // would halve the reads, but the GPU would blend them before we convert to
  // linear light, which puts a faint sawtooth along hard edges.)
  vec3 sum = sampleLinear(uv) * uWeights[0];
  for (int i = 1; i <= ${MAX_RADIUS}; i++) {
    if (i > uRadius) break;
    vec2 o = texel * float(i);
    sum += (sampleLinear(uv + o) + sampleLinear(uv - o)) * uWeights[i];
  }
  fragColor = vec4(pow(sum, vec3(1. / 2.2)), 1.);
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
  const horizontal = createRenderTarget(gl);
  const vertical = createRenderTarget(gl);
  const weights = new Float32Array(MAX_RADIUS + 1);

  const pass = (
    input: SourceFrame,
    target: typeof horizontal,
    direction: [number, number],
    radius: number,
    view: View,
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
    gl.uniform1i(u.uRadius, radius);
    gl.uniform1fv(u.uWeights, weights);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return {
    apply(frame, view, options, filmScale) {
      // Film px -> device px.
      const sigma = (options.blur / filmScale) * view.pixelRatio;
      if (sigma < 0.3) return frame;

      const w = gaussianWeights(sigma);
      weights.fill(0).set(w);
      const radius = w.length - 1;

      // Horizontal pass reads the source through its mapping; everything after
      // is in screen space.
      pass(frame, horizontal, [1, 0], radius, view);
      pass(
        { texture: horizontal.texture, uvScale: [1, 1], uvOffset: [0, 0] },
        vertical,
        [0, 1],
        radius,
        view,
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
