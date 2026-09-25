import { COLOR_GLSL, hexToLinear, type Hex } from "../core/color";
import { createProgram, FULLSCREEN_VERT } from "../core/gl";
import {
  createRenderTarget,
  halfFloatFormat,
  type RenderTarget,
} from "../core/target";
import type { SourceFrame, View } from "../source";

/**
 * Halation: the warm glow around bright highlights.
 *
 * Bright light goes straight through the emulsion, bounces off the back of the
 * film base and comes back up, exposing the film again in a soft ring around
 * where it came in. It reaches the red-sensitive layer first (it's nearest the
 * base), so the glow is red-orange: the tell-tale fringe around lamps, white
 * text and sunlit edges on film.
 *
 * Here: the source's highlights are picked out, blurred at low resolution in
 * two widths (a tight core and a wide tail, like the real falloff) and added
 * back as light, before grain, so the glow is grainy like everything else.
 */
export interface HalationOptions {
  /** Strength of the glow. 0 turns it off. */
  amount: number;
  /**
   * Brightness (0-1) where highlights start to glow. They glow more the
   * brighter they are; white glows fully.
   */
  threshold: number;
  /** How far the glow reaches, in film px. */
  radius: number;
  /** Color of the glow. Real halation is red-orange. */
  color: Hex;
}

/**
 * Defaults tuned by eye on sources with no film look of their own: a subtle
 * warm bloom around white text and lights, little change to bright skies.
 */
export const DEFAULT_HALATION: HalationOptions = {
  amount: 0.4,
  threshold: 0.6,
  radius: 28,
  color: "#ff6230",
};

/** The core's width, as a share of the tail's. */
const CORE_WIDTH = 0.25;
/** Most blur levels: 2^7 = 1/128th resolution. */
const MAX_LEVEL = 7;
/** Taps each side in one blur pass. */
const MAX_TAPS = 16;

/**
 * Storage helpers for the glow textures. Linear light's faint values need
 * more than 8 bits; where half floats can't be rendered to, values are stored
 * as their square root instead, which keeps the dim tail from banding.
 */
const codec = (encode: boolean) => /* glsl */ `
vec3 store(vec3 c) { return ${encode ? "sqrt(max(c, 0.))" : "c"}; }
vec3 load(vec3 c) { return ${encode ? "c * c" : "c"}; }
`;

/**
 * Pick out the highlights and halve the resolution. Four bilinear reads cover
 * a 4x4 block, so small highlights don't shimmer. The input is linear light
 * (see SourceFrame); the threshold is on brightness as seen on screen.
 */
const prefilterFrag = (encode: boolean) => /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uInput;
uniform vec2 uUvScale;     // input mapping, see SourceFrame
uniform vec2 uUvOffset;
uniform vec2 uInputTexel;  // one input px, in screen UV
uniform vec2 uOutSize;
uniform float uThreshold;

out vec4 fragColor;
${codec(encode)}
${COLOR_GLSL}

vec3 highlight(vec2 uv) {
  vec3 c = texture(uInput, uv * uUvScale + uUvOffset).rgb;
  float L = dot(linearToSrgb(c), vec3(.2126, .7152, .0722));
  float w = smoothstep(0., 1., (L - uThreshold) / max(1. - uThreshold, 1e-3));
  return c * w;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec2 o = uInputTexel;
  vec3 c = highlight(uv + vec2(-o.x, -o.y)) + highlight(uv + vec2(o.x, -o.y))
         + highlight(uv + vec2(-o.x, o.y)) + highlight(uv + vec2(o.x, o.y));
  fragColor = vec4(store(c * .25), 1.);
}`;

/** Halve the resolution again, the same way. */
const downFrag = (encode: boolean) => /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uInput;
uniform vec2 uInputTexel;
uniform vec2 uOutSize;

out vec4 fragColor;
${codec(encode)}

vec3 tap(vec2 uv) { return load(texture(uInput, uv).rgb); }

void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec2 o = uInputTexel;
  vec3 c = tap(uv + vec2(-o.x, -o.y)) + tap(uv + vec2(o.x, -o.y))
         + tap(uv + vec2(-o.x, o.y)) + tap(uv + vec2(o.x, o.y));
  fragColor = vec4(store(c * .25), 1.);
}`;

/** One direction of a separable gaussian, at the level's resolution. */
const blurFrag = (encode: boolean) => /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uInput;
uniform vec2 uStep;       // one texel along the blur direction, in UV
uniform vec2 uOutSize;
uniform int uRadius;
uniform float uWeights[${MAX_TAPS + 1}];

out vec4 fragColor;
${codec(encode)}

void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec3 sum = load(texture(uInput, uv).rgb) * uWeights[0];
  for (int i = 1; i <= ${MAX_TAPS}; i++) {
    if (i > uRadius) break;
    vec2 o = uStep * float(i);
    sum += (load(texture(uInput, uv + o).rgb) + load(texture(uInput, uv - o).rgb)) * uWeights[i];
  }
  fragColor = vec4(store(sum), 1.);
}`;

/**
 * GLSL for the film pass: add the glow to a color in linear light. The glow's
 * strength comes mostly from the highlights' red and green, since blue light
 * is absorbed before it reaches the base; its color is `color`.
 */
export const HALATION_GLSL = /* glsl */ `
uniform bool uHaloOn;
uniform bool uHaloEncoded;
uniform sampler2D uHaloCore;
uniform sampler2D uHaloTail;
uniform vec3 uHaloColor;     // linear light, times amount
uniform float uHaloCoreMix;  // share of the core in the glow

vec3 applyHalation(vec3 c, vec2 uv) {
  if (!uHaloOn) return c;
  vec3 core = texture(uHaloCore, uv).rgb;
  vec3 tail = texture(uHaloTail, uv).rgb;
  if (uHaloEncoded) { core *= core; tail *= tail; }
  float glow = dot(mix(tail, core, uHaloCoreMix), vec3(.5, .38, .12));
  // Screen, not add: the glow lights up darker surroundings, but the
  // highlight itself, already near white, stays white instead of turning pink.
  return 1. - (1. - clamp(c, 0., 1.)) * (1. - clamp(uHaloColor * glow, 0., 1.));
}
`;

/** The blurred highlights, ready for the film pass. */
export interface HaloFrame {
  core: WebGLTexture;
  tail: WebGLTexture;
  /** Values are stored as square roots (no half-float rendering). */
  encoded: boolean;
}

export interface Halation {
  /** Blur `frame`'s highlights. Null when halation is off. */
  render(
    frame: SourceFrame,
    view: View,
    options: HalationOptions,
    filmScale: number,
  ): HaloFrame | null;
  /** Set the film pass's halation uniforms, binding textures from `unit`. */
  bind(
    uniforms: Record<string, WebGLUniformLocation>,
    halo: HaloFrame | null,
    options: HalationOptions,
    unit: number,
  ): void;
  dispose(): void;
}

export function createHalation(gl: WebGL2RenderingContext): Halation {
  const format = halfFloatFormat(gl);
  const encode = !format;
  const prefilter = createProgram(gl, FULLSCREEN_VERT, prefilterFrag(encode));
  const down = createProgram(gl, FULLSCREEN_VERT, downFrag(encode));
  const blur = createProgram(gl, FULLSCREEN_VERT, blurFrag(encode));
  const target = () =>
    format ? createRenderTarget(gl, format) : createRenderTarget(gl);

  // levels[k] holds the highlights at 1/2^k resolution (levels[0] is unused).
  const levels: RenderTarget[] = [];
  const blurred = { core: [target(), target()], tail: [target(), target()] };
  const weights = new Float32Array(MAX_TAPS + 1);

  const size = (view: View, k: number): [number, number] => [
    Math.max(1, Math.round(view.bufferWidth / 2 ** k)),
    Math.max(1, Math.round(view.bufferHeight / 2 ** k)),
  ];

  const level = (view: View, k: number) => {
    levels[k] ??= target();
    levels[k].resize(...size(view, k));
    return levels[k];
  };

  const draw = (out: RenderTarget) => {
    out.bind();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Blur level k by `sigma` level px, into one of the `pair`. */
  const blurLevel = (
    view: View,
    k: number,
    sigma: number,
    pair: RenderTarget[],
  ): WebGLTexture => {
    const input = levels[k];
    // The downsampling already blurred by about half a level px.
    const rest = Math.sqrt(Math.max(sigma * sigma - 0.25, 0));
    if (rest < 0.3) return input.texture;

    const radius = Math.min(Math.ceil(rest * 3), MAX_TAPS);
    let total = 0;
    for (let i = 0; i <= MAX_TAPS; i++) {
      weights[i] = i <= radius ? Math.exp(-(i * i) / (2 * rest * rest)) : 0;
      total += i ? 2 * weights[i] : weights[i];
    }
    for (let i = 0; i <= radius; i++) weights[i] /= total;

    const [w, h] = size(view, k);
    const { program, uniforms: u } = blur;
    gl.useProgram(program);
    gl.uniform2f(u.uOutSize, w, h);
    gl.uniform1i(u.uRadius, radius);
    gl.uniform1fv(u.uWeights, weights);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.uInput, 0);

    pair[0].resize(w, h);
    pair[1].resize(w, h);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.uniform2f(u.uStep, 1 / w, 0);
    draw(pair[0]);
    gl.bindTexture(gl.TEXTURE_2D, pair[0].texture);
    gl.uniform2f(u.uStep, 0, 1 / h);
    draw(pair[1]);
    return pair[1].texture;
  };

  /** The level where a blur of `sigma` device px is a couple of texels. */
  const levelFor = (sigma: number) =>
    Math.min(MAX_LEVEL, Math.max(1, Math.floor(Math.log2(sigma / 1.5))));

  return {
    render(frame, view, options, filmScale) {
      if (options.amount <= 0 || options.radius <= 0) return null;

      // Film px -> device px.
      const tail = (options.radius / filmScale) * view.pixelRatio;
      const core = tail * CORE_WIDTH;
      const kCore = levelFor(core);
      const kTail = levelFor(tail);

      // Highlights at half resolution, then halved again down to the tail's level.
      {
        const out = level(view, 1);
        const { program, uniforms: u } = prefilter;
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frame.texture);
        gl.uniform1i(u.uInput, 0);
        gl.uniform2f(u.uUvScale, frame.uvScale[0], frame.uvScale[1]);
        gl.uniform2f(u.uUvOffset, frame.uvOffset[0], frame.uvOffset[1]);
        gl.uniform2f(u.uInputTexel, 1 / view.bufferWidth, 1 / view.bufferHeight);
        gl.uniform2f(u.uOutSize, out.width, out.height);
        gl.uniform1f(u.uThreshold, options.threshold);
        draw(out);
      }
      for (let k = 2; k <= kTail; k++) {
        const input = levels[k - 1];
        const out = level(view, k);
        const { program, uniforms: u } = down;
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, input.texture);
        gl.uniform1i(u.uInput, 0);
        gl.uniform2f(u.uInputTexel, 1 / input.width, 1 / input.height);
        gl.uniform2f(u.uOutSize, out.width, out.height);
        draw(out);
      }

      return {
        core: blurLevel(view, kCore, core / 2 ** kCore, blurred.core),
        tail: blurLevel(view, kTail, tail / 2 ** kTail, blurred.tail),
        encoded: encode,
      };
    },
    bind(u, halo, options, unit) {
      gl.uniform1i(u.uHaloOn, halo ? 1 : 0);
      if (!halo) return;
      gl.uniform1i(u.uHaloEncoded, halo.encoded ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, halo.core);
      gl.uniform1i(u.uHaloCore, unit);
      gl.activeTexture(gl.TEXTURE0 + unit + 1);
      gl.bindTexture(gl.TEXTURE_2D, halo.tail);
      gl.uniform1i(u.uHaloTail, unit + 1);
      const [r, g, b] = hexToLinear(options.color);
      const a = options.amount;
      gl.uniform3f(u.uHaloColor, r * a, g * a, b * a);
      gl.uniform1f(u.uHaloCoreMix, 0.45);
    },
    dispose() {
      gl.deleteProgram(prefilter.program);
      gl.deleteProgram(down.program);
      gl.deleteProgram(blur.program);
      for (const t of levels) t?.dispose();
      for (const t of [...blurred.core, ...blurred.tail]) t.dispose();
    },
  };
}
