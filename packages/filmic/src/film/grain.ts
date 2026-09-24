import { createProgram, FULLSCREEN_VERT } from "../core/gl";

/**
 * Film grain.
 *
 * Real grain is the image itself being made of tiny clumps of silver/dye, so:
 * - it's random per spot but has a size (grains, not pixels),
 * - it's mostly the same in R, G and B, with a little color,
 * - it's strongest in the lower mid-tones and weaker in deep shadows and bright
 *   highlights.
 *
 * We synthesize a tileable noise texture once (see GRAIN_GEN_FRAG), then the
 * film pass samples it in film space (see frame.ts), so grain moves and scales
 * with the image, and scales it by a brightness curve.
 */
export interface GrainOptions {
  /** Overall strength multiplier. 0 turns grain off. */
  amount: number;
  /** Size of one grain texel in film px. Smaller = finer grain. */
  size: number;
  /**
   * How far grain pushes the image around, in film px. The image is sampled
   * through small grain-driven offsets, so sharp edges come out ragged and
   * grainy instead of crisp: the image is made of grain, not covered by it.
   */
  breakup: number;
  /** Blur applied to the noise, in texels: 0 = crisp, 1+ = soft, clumpy. */
  softness: number;
  /**
   * Makes each grain crisper against its surroundings (a slight dark/light ring
   * two texels out), giving the salty look of real grain instead of soft haze.
   * 0 = off, around 0.1-0.15 is film-like.
   */
  sharpness: number;
  /** 0 = monochrome grain, 1 = fully independent per color channel. */
  chroma: number;
  /** Grain strength in the darkest tones (0-255 levels, before `amount`). */
  shadows: number;
  /** Grain strength at the peak, in the lower mid-tones. */
  midtones: number;
  /** Grain strength in the brightest tones. */
  highlights: number;
  /** Changes the random pattern. */
  seed: number;
}

/**
 * Defaults tuned by measuring rendered output against a scanned-film reference
 * at the same viewport: visible grain strength per brightness band, correlation
 * with the next pixel and the one after (grain size and crispness), and R/G
 * correlation (color) all match within a few percent.
 */
export const DEFAULT_GRAIN: GrainOptions = {
  amount: 1,
  size: 0.76,
  breakup: 0.6,
  softness: 0.52,
  sharpness: 0.12,
  chroma: 0.25,
  shadows: 4.6,
  midtones: 8.3,
  highlights: 3.75,
  seed: 0,
};

/** Width and height of the tileable grain texture, in texels. */
export const GRAIN_TEXTURE_SIZE = 1024;

/**
 * Generates the grain texture. Each texel stores four independent unit-variance
 * noise values: RGB for per-channel grain and A for the part shared by all
 * channels. The film pass mixes them (see `chroma`), so color can be tuned live
 * without regenerating.
 *
 * Values are stored as n / 8 + 0.5, i.e. -4..4 standard deviations in 8 bits.
 */
const GRAIN_GEN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform uint uSeed;
uniform float uSoftness;
uniform float uSharpness;
uniform int uSize;

out vec4 fragColor;

// PCG-style integer hash: good-quality randomness with no visible patterns.
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 rand3(ivec2 p, uint stream) {
  // Wrap coordinates so the texture tiles seamlessly.
  p = (p % uSize + uSize) % uSize;
  return vec3(pcg3d(uvec3(p, uSeed * 8u + stream))) / 4294967296.;
}

// Two independent standard normals from two uniforms (Box-Muller).
vec2 normals(vec2 u) {
  float r = sqrt(-2. * log(max(u.x, 1e-7)));
  return r * vec2(cos(6.2831853 * u.y), sin(6.2831853 * u.y));
}

// 1D kernel weight at offset d (0, 1 or 2 texels): a gaussian for softness,
// minus a little at distance 2 for sharpness.
float kernel(int d) {
  float s2 = 2. * uSoftness * uSoftness;
  float g = d == 0 ? 1. : (uSoftness > 0. ? exp(-float(d * d) / s2) : 0.);
  return d == 2 ? g - uSharpness : g;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 sum = vec4(0.);
  float wsum2 = 0.;

  // Filter the per-grain noise with a small 5x5 kernel to give grains a size
  // and edge. The kernel is separable: weight(i, j) = kernel(i) * kernel(j).
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      float w = kernel(abs(i)) * kernel(abs(j));
      if (abs(w) < 1e-5) continue;
      ivec2 q = p + ivec2(i, j);
      vec3 a = rand3(q, 0u);
      vec3 b = rand3(q, 1u);
      vec4 n = vec4(normals(a.xy), normals(vec2(a.z, b.x)));
      // Grains vary in how strongly they show; E[k^2] for k in [.4, 1.6] is 1.12.
      float k = mix(.4, 1.6, b.y) / 1.0583;
      sum += w * k * n;
      wsum2 += w * w;
    }
  }
  // Renormalize so the blurred noise still has unit variance.
  vec4 g = sum / sqrt(max(wsum2, 1e-6));
  fragColor = clamp(g / 8. + .5, 0., 1.);
}`;

export interface GrainTexture {
  readonly texture: WebGLTexture;
  /** Regenerate if the seed, softness or sharpness changed. */
  update(seed: number, softness: number, sharpness: number): void;
  dispose(): void;
}

export function createGrainTexture(gl: WebGL2RenderingContext): GrainTexture {
  const N = GRAIN_TEXTURE_SIZE;
  const { program, uniforms: u } = createProgram(
    gl,
    FULLSCREEN_VERT,
    GRAIN_GEN_FRAG,
  );

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, Math.log2(N) + 1, gl.RGBA8, N, N);
  // Mipmaps: where grain is finer than a screen pixel, the GPU averages it
  // down instead of aliasing (the same thing a display would do physically).
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );

  let current = "";

  return {
    texture,
    update(seed, softness, sharpness) {
      const key = `${seed}|${softness}|${sharpness}`;
      if (key === current) return;
      current = key;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, N, N);
      gl.useProgram(program);
      gl.uniform1ui(u.uSeed, Math.max(0, Math.floor(seed)) >>> 0);
      gl.uniform1f(u.uSoftness, softness);
      gl.uniform1f(u.uSharpness, sharpness);
      gl.uniform1i(u.uSize, N);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    },
  };
}

/**
 * GLSL for the film pass. Positions are in film px (see frame.ts).
 * - grainNoise: unit-variance grain at a position
 * - grainLevel: strength for a brightness, through three control points
 *   (shadows at 0, midtones at GRAIN_PIVOT, highlights at 1)
 * - grainBreakup: a small grain-driven offset for sampling the image
 */
export const GRAIN_GLSL = /* glsl */ `
uniform sampler2D uGrainTex;
uniform float uGrainTexSize;  // texels
uniform float uGrainPxSize;   // film px per grain texel
uniform vec2 uGrainOffset;    // texels; changes every frame in footage mode
uniform vec3 uGrainLevels;    // shadows, midtones, highlights (0-255 levels, x amount)
uniform float uGrainChroma;
uniform float uGrainBreakup;  // film px

const float GRAIN_PIVOT = .35;

vec4 grainTexel(vec2 filmPx, vec2 shift) {
  vec2 uv = (filmPx / uGrainPxSize + uGrainOffset + shift) / uGrainTexSize;
  return texture(uGrainTex, uv) * 8. - 4.;
}

vec3 grainNoise(vec2 filmPx) {
  vec4 n = grainTexel(filmPx, vec2(0.));
  return (n.a + uGrainChroma * n.rgb) / sqrt(1. + uGrainChroma * uGrainChroma);
}

// Offset (film px) to sample the image through. Read from a far-away part of
// the texture so it's independent of the grain added on top.
vec2 grainBreakup(vec2 filmPx) {
  return grainTexel(filmPx, vec2(517.3, 293.9)).xy * .5 * uGrainBreakup;
}

float grainLevel(float L) {
  return L < GRAIN_PIVOT
    ? mix(uGrainLevels.x, uGrainLevels.y, smoothstep(0., GRAIN_PIVOT, L))
    : mix(uGrainLevels.y, uGrainLevels.z, smoothstep(GRAIN_PIVOT, 1., L));
}

// Add grain to an sRGB color.
vec3 applyGrain(vec3 c, vec2 filmPx) {
  float L = dot(c, vec3(.2126, .7152, .0722));
  return c + grainNoise(filmPx) * grainLevel(L) / 255.;
}
`;
