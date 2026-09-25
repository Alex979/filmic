import { createGeneratedTexture, NOISE_GLSL } from "../core/noise";

/**
 * Mottle: faint, soft blotches of density and color across the frame.
 *
 * Grain is the fine texture of film; mottle is its coarse cousin. Silver and
 * dye clouds clump unevenly at larger scales too, so flat areas like a sky are
 * never perfectly smooth: they drift a fraction of a level lighter and darker,
 * slightly warmer and cooler, in patches tens of film px across.
 *
 * Scanned film also shows faint streaks running along the film (the direction
 * it travels through the camera and scanner), so part of the mottle is
 * stretched vertically.
 *
 * Like grain, it lives in film space, is mostly shared by R, G and B, and
 * follows the same brightness curve (strongest in the mid-tones). It's added
 * to the image before grain.
 */
export interface MottleOptions {
  /**
   * Strength: standard deviation in 0-255 levels at the mid-tones (scaled by
   * grain's shadows/midtones/highlights curve elsewhere). 0 turns it off. The
   * default is subtle, as on real film; a few levels makes it obvious.
   */
  amount: number;
  /**
   * Size of the finest blotches, in film px. The pattern mixes these with
   * blotches twice as large, like the clumping in real emulsion.
   */
  size: number;
  /**
   * Strength of the vertical streaks relative to the blotches: 0 = none, 1 =
   * as strong. They're about as thin as the finest blotches and 30x as long.
   */
  streaks: number;
  /** 0 = brightness only, 1 = fully independent per color channel. */
  chroma: number;
  /** Changes the random pattern. */
  seed: number;
}

/**
 * Defaults measured from a scanned-film reference: blotch spectrum, streak
 * share and direction, strength per brightness band and R/G/B correlation, at
 * a 1080 film px frame.
 */
export const DEFAULT_MOTTLE: MottleOptions = {
  amount: 0.33,
  size: 5.3,
  streaks: 0.3,
  chroma: 0.58,
  seed: 0,
};

/** Width and height of the tileable mottle texture, in texels. */
export const MOTTLE_TEXTURE_SIZE = 512;

/** Blur of the texture's white noise, in texels (so 1 texel = size / this). */
const TEXEL_SIGMA = 2;

/**
 * Generates the mottle texture: white noise blurred by a gaussian of
 * TEXEL_SIGMA texels, i.e. smooth blobs with no preferred shape. Like the
 * grain texture, RGB hold per-channel noise and A the shared part, each with
 * unit variance, stored as n / 8 + 0.5.
 */
const MOTTLE_GEN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform uint uSeed;
uniform int uSize;

out vec4 fragColor;

${NOISE_GLSL}

const float SIGMA = ${TEXEL_SIGMA.toFixed(1)};
const int RADIUS = ${Math.ceil(TEXEL_SIGMA * 3)};

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 sum = vec4(0.);
  float wsum2 = 0.;
  for (int j = -RADIUS; j <= RADIUS; j++) {
    for (int i = -RADIUS; i <= RADIUS; i++) {
      float w = exp(-float(i * i + j * j) / (2. * SIGMA * SIGMA));
      ivec2 q = p + ivec2(i, j);
      vec3 a = rand3(q, uSize, uSeed, 2u); // streams 0-1 are the grain's
      vec3 b = rand3(q, uSize, uSeed, 3u);
      sum += w * vec4(normals(a.xy), normals(vec2(a.z, b.x)));
      wsum2 += w * w;
    }
  }
  fragColor = clamp(sum / sqrt(wsum2) / 8. + .5, 0., 1.);
}`;

export interface MottleTexture {
  readonly texture: WebGLTexture;
  /** Regenerate if the seed changed. */
  update(seed: number): void;
  dispose(): void;
}

export function createMottleTexture(gl: WebGL2RenderingContext): MottleTexture {
  const generated = createGeneratedTexture(
    gl,
    MOTTLE_GEN_FRAG,
    MOTTLE_TEXTURE_SIZE,
  );
  let current: number | null = null;

  return {
    texture: generated.texture,
    update(seed) {
      if (seed === current) return;
      current = seed;
      generated.generate((u) => {
        gl.uniform1ui(u.uSeed, Math.max(0, Math.floor(seed)) >>> 0);
        gl.uniform1i(u.uSize, MOTTLE_TEXTURE_SIZE);
      });
    },
    dispose: generated.dispose,
  };
}

/** Film px per mottle texel, for a given blotch size. */
export const mottleTexelSize = (size: number) => size / TEXEL_SIGMA;

/**
 * GLSL for the film pass. Needs toneLevel() from GRAIN_GLSL.
 *
 * Three layers are read from the same texture, each from a different spot so
 * they don't line up: blotches at `size`, blotches at twice the size (weighted
 * 1.5x, matching the reference's spectrum), and streaks (the texture stretched
 * 0.75x across, 30x down).
 */
export const MOTTLE_GLSL = /* glsl */ `
uniform sampler2D uMottleTex;
uniform float uMottleTexSize;  // texels
uniform float uMottlePxSize;   // film px per texel (finer octave)
uniform vec2 uMottleOffset;    // texels; for per-frame changes in footage mode
uniform vec3 uMottleLevels;    // shadows, midtones, highlights (0-255 levels)
uniform float uMottleChroma;
uniform float uMottleStreaks;

vec3 mottleNoise(vec2 filmPx) {
  vec2 t = (filmPx / uMottlePxSize + uMottleOffset) / uMottleTexSize;
  vec4 fine = texture(uMottleTex, t) - .5;
  vec4 coarse = texture(uMottleTex, t * .5 + vec2(.37, .71)) - .5;
  // Streaks: u only depends on x, so they stay vertical; the shear in v keeps
  // the pattern from repeating across the frame when u wraps.
  vec2 s = filmPx / (uMottlePxSize * vec2(.75, 30.)) + uMottleOffset;
  vec4 streak = texture(uMottleTex, (s + vec2(0., .137 * s.x)) / uMottleTexSize + vec2(.13, .52)) - .5;

  vec4 blotches = (fine + 1.5 * coarse) / sqrt(3.25);
  vec4 n = (blotches + uMottleStreaks * streak) * 8. / sqrt(1. + uMottleStreaks * uMottleStreaks);
  return (n.a + uMottleChroma * n.rgb) / sqrt(1. + uMottleChroma * uMottleChroma);
}

// Add mottle to an sRGB color.
vec3 applyMottle(vec3 c, vec2 filmPx) {
  float L = dot(c, vec3(.2126, .7152, .0722));
  return c + mottleNoise(filmPx) * toneLevel(uMottleLevels, L) / 255.;
}
`;
