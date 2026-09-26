import { createProgram } from "../core/gl";
import { createRenderTarget } from "../core/target";
import type { View } from "../source";
import type { FootageOptions } from "./footage";
import type { ResolvedFrame } from "./frame";

/**
 * Dust: specks, fibers and hairs on the film.
 *
 * Dust on the negative blocks light, so it prints as light specks; dust on the
 * print (or the scanner glass) shows dark. Either way it partly covers the
 * image rather than adding a color, so a speck over an orange sky looks
 * different from one over a blue one. That's how it's drawn here: each piece
 * has an opacity, and pulls the image toward a cool white or a near-black.
 *
 * Almost all of it is tiny soft specks, a pixel or two across. A few percent
 * are longer: curly fibers, hairs, and thin, broken vertical lines.
 */
export interface DustOptions {
  /** Opacity multiplier. 0 turns dust off. */
  amount: number;
  /** Pieces of dust on the frame. */
  density: number;
  /** Size multiplier. */
  size: number;
  /** Share of specks that are dark (on the print) rather than light (on the negative). */
  dark: number;
  /** Share of pieces that are fibers, hairs and thin lines rather than specks. */
  hairs: number;
  /** Changes the layout. */
  seed: number;
}

/**
 * Defaults measured from scanned film: how many pieces, their size and
 * opacity spread and the light/dark share, all at a 1080 film px frame. The
 * hair share is set a little below what was measured, by eye: in motion,
 * hairs draw the eye more than their share suggests.
 */
export const DEFAULT_DUST: DustOptions = {
  amount: 1,
  density: 240,
  size: 1,
  dark: 0.15,
  hairs: 0.035,
  seed: 0,
};

/**
 * One drawable piece: a capsule (a line segment with a soft round edge). A
 * speck is one short capsule; fibers and lines are chains of them.
 *
 * anchor: where on the frame, 0..1. a, b: segment ends in film px from the
 * anchor. sigma: edge softness in film px. peak: opacity. dark: 0 or 1.
 */
const FLOATS_PER_PIECE = 8;

/** Small seeded random number generator (mulberry32). */
function random(seed: number) {
  let s = (seed * 0x9e3779b9) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () =>
    Math.sqrt(-2 * Math.log(Math.max(next(), 1e-9))) *
    Math.cos(2 * Math.PI * next());
  /** Log-normal: `median`, spread `sd` in log space. */
  const logNormal = (median: number, sd: number) =>
    median * Math.exp(sd * gauss());
  return { next, gauss, logNormal };
}

/** Smooth 1D value noise, 0..1, over `n` samples with a knot every `every`. */
function smoothNoise(rng: ReturnType<typeof random>, n: number, every: number) {
  const knots = Array.from({ length: Math.ceil(n / every) + 2 }, rng.next);
  return (i: number) => {
    const x = i / every;
    const k = Math.floor(x);
    const f = x - k;
    const t = f * f * (3 - 2 * f);
    return knots[k] * (1 - t) + knots[k + 1] * t;
  };
}

type Rng = ReturnType<typeof random>;

/** Receives one capsule: anchor (0..1), ends (film px), sigma, opacity, dark. */
type Emit = (
  u: number,
  v: number,
  a: [number, number],
  b: [number, number],
  sigma: number,
  peak: number,
  dark: boolean,
) => void;

/** A chain of capsules along a wandering path: fibers, hairs and lines. */
function strand(
  rng: Rng,
  emit: Emit,
  u: number,
  v: number,
  size: number,
  length: number,
  heading: number,
  curl: number,
  sigma: number,
  peak: number,
  opacityAt: (i: number) => number,
) {
  const step = 1.5 * size;
  const n = Math.max(2, Math.ceil(length / step));
  const points: [number, number][] = [[0, 0]];
  let turn = 0;
  for (let i = 0; i < n; i++) {
    turn = turn * 0.85 + rng.gauss() * curl;
    heading += turn;
    const [x, y] = points[i];
    points.push([x + Math.cos(heading) * step, y + Math.sin(heading) * step]);
  }
  // Center it on the anchor.
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  for (let i = 0; i < n; i++) {
    const taper = Math.min(1, (i + 0.5) / (n * 0.12), (n - i - 0.5) / (n * 0.12));
    const opacity = peak * taper * opacityAt(i);
    if (opacity < 0.004) continue;
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    emit(u, v, [ax - cx, ay - cy], [bx - cx, by - cy], sigma, opacity, false);
  }
}

/** One piece of dust, anywhere on the frame, drawn from the mix in `options`. */
function dustPiece(rng: Rng, options: DustOptions, emit: Emit) {
  const size = options.size;
  const u = rng.next();
  const v = rng.next();
  const kind = rng.next();
  const dark = rng.next() < options.dark;

  if (kind < options.hairs * 0.3) {
    // A thin line along the film, dotted and broken up.
    const length = (70 + rng.next() * 55) * size;
    const dots = smoothNoise(rng, length / 1.5, 2.5);
    strand(
      rng,
      emit,
      u,
      v,
      size,
      length,
      Math.PI / 2 + rng.gauss() * 0.03,
      0.004,
      (0.35 + rng.next() * 0.2) * size,
      Math.min(0.5, rng.logNormal(0.15, 0.5)),
      (i) => Math.max(0, dots(i) - 0.45) / 0.55,
    );
  } else if (kind < options.hairs) {
    // A fiber or hair: curly, speckled along its length.
    const length = Math.min(110, Math.max(10, rng.logNormal(28, 0.55))) * size;
    const speckle = smoothNoise(rng, length / 1.5, 3);
    strand(
      rng,
      emit,
      u,
      v,
      size,
      length,
      rng.next() * Math.PI * 2,
      0.015 + rng.next() * 0.055,
      (0.45 + rng.next() * 0.35) * size,
      rng.logNormal(0.2, 0.3),
      (i) => 0.35 + 0.65 * speckle(i),
    );
  } else if (rng.next() < 0.005) {
    // A rare clump: a few specks stuck together, uneven and soft.
    const spread = (1.5 + rng.next() * 2) * size;
    const specks = 3 + Math.floor(rng.next() * 5);
    for (let i = 0; i < specks; i++) {
      const at: [number, number] = [rng.gauss() * spread, rng.gauss() * spread * 0.7];
      const to: [number, number] = [at[0] + rng.gauss() * size, at[1] + rng.gauss() * size];
      emit(u, v, at, to, (0.5 + rng.next() * 0.5) * size, 0.12 + rng.next() * 0.22, dark);
    }
  } else {
    // A speck: a soft, slightly elongated dot. Measured sizes include the
    // scan's softness, so these are the final on-film profiles.
    const minor = Math.min(1, Math.max(0.25, rng.logNormal(0.42, 0.25))) * size;
    const major = minor * (1 + rng.logNormal(0.45, 0.45));
    // A segment of length L blurred by sigma has sd sqrt(L²/12 + sigma²).
    const half = Math.sqrt(3 * (major * major - minor * minor));
    const angle = rng.next() * Math.PI;
    const dx = Math.cos(angle) * half;
    const dy = Math.sin(angle) * half;
    emit(u, v, [-dx, -dy], [dx, dy], minor, Math.min(0.7, rng.logNormal(0.19, 0.5)), dark);
  }
}

/** An Emit that appends to a flat instance array, shifted by (sx, sy) film px. */
const emitInto =
  (out: number[], sx = 0, sy = 0): Emit =>
  (u, v, a, b, sigma, peak, dark) =>
    out.push(u, v, a[0] + sx, a[1] + sy, b[0] + sx, b[1] + sy, sigma, dark ? -peak : peak);

/**
 * Lay out the still frame's dust. Positions are relative to the frame, so the
 * dust stays put (and stretches at most) when the canvas resizes.
 */
export function layoutDust(options: DustOptions): Float32Array {
  const rng = random(options.seed + 1);
  const out: number[] = [];
  const emit = emitInto(out);
  const count = Math.max(0, Math.round(options.density));
  for (let k = 0; k < count; k++) dustPiece(rng, options, emit);
  return new Float32Array(out);
}

/** Longest a speck can linger, in frames. */
const MAX_LIFE = 6;

/**
 * Dust for footage frame n: each frame, a Poisson-distributed number of new
 * pieces lands at random; most last one frame, some linger for 2-6 and wander
 * about a pixel per frame while they do. Built from the births of the last few
 * frames, each seeded by its frame number, so frame n is always the same.
 */
export function layoutFootageDust(
  options: DustOptions,
  rate: number,
  linger: number,
  seed: number,
  n: number,
): Float32Array {
  const out: number[] = [];
  const scratch: number[] = [];
  for (let age = 0; age < MAX_LIFE; age++) {
    const born = n - age;
    const rng = random(Math.floor(hashFrame(born, seed, options.seed) * 4294967296));
    const count = poisson(rng, Math.max(0, rate));
    for (let i = 0; i < count; i++) {
      const life = rng.next() < linger ? 2 + Math.floor(rng.next() * 5) : 1;
      // Always generate the piece, with the same random draws whatever its
      // age, so it's the same piece in every frame it lives through.
      scratch.length = 0;
      dustPiece(rng, options, emitInto(scratch));
      if (age >= life) continue;

      // Wander: a random step of up to ~1.3 film px for each frame alive,
      // from the piece's own generator so it doesn't disturb the others.
      const walk = random(Math.floor(hashFrame(born, i, seed + 7) * 4294967296));
      let sx = 0;
      let sy = 0;
      for (let k = 1; k <= age; k++) {
        sx += (walk.next() - 0.5) * 2.6;
        sy += (walk.next() - 0.5) * 2.6;
      }
      for (let j = 0; j < scratch.length; j += FLOATS_PER_PIECE) {
        scratch[j + 2] += sx;
        scratch[j + 3] += sy;
        scratch[j + 4] += sx;
        scratch[j + 5] += sy;
      }
      out.push(...scratch);
    }
  }
  return new Float32Array(out);
}

/** 0..1 hash of a frame number and two seeds. */
function hashFrame(n: number, a: number, b: number) {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((a | 0) + 17, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35) ^ Math.imul((b | 0) + 29, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Poisson-distributed count with mean `lambda`. */
function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  // Knuth's method, fine for the small means used here; split large ones.
  if (lambda > 60) return poisson(rng, lambda / 2) + poisson(rng, lambda / 2);
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}

const DUST_VERT = /* glsl */ `#version 300 es
in vec2 aAnchor;
in vec4 aSeg;     // segment ends, film px from the anchor
in vec2 aShape;   // sigma, opacity (negative = dark dust)

uniform vec4 uFrame;       // film frame rect, CSS px
uniform float uFilmScale;  // film px per CSS px
uniform vec2 uView;        // canvas size, CSS px
uniform float uPixel;      // film px per device px

out vec2 vP;
flat out vec4 vSeg;
flat out vec2 vShape;
flat out float vSigma;

void main() {
  vec2 corner = vec2[6](
    vec2(0, 0), vec2(1, 0), vec2(0, 1),
    vec2(0, 1), vec2(1, 0), vec2(1, 1))[gl_VertexID];

  vec2 base = aAnchor * uFrame.zw * uFilmScale;
  vec2 a = base + aSeg.xy;
  vec2 b = base + aSeg.zw;

  // Never softer than about a pixel, so tiny specks antialias instead of
  // flickering in and out.
  float sigma = sqrt(aShape.x * aShape.x + .25 * uPixel * uPixel);
  float pad = 3. * sigma;

  // A quad around the capsule, aligned with it.
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1, 0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 p = a + dir * mix(-pad, len + pad, corner.x) + nrm * mix(-pad, pad, corner.y);

  vP = p;
  vSeg = vec4(a, b);
  vShape = aShape;
  vSigma = sigma;

  vec2 clip = (uFrame.xy + p / uFilmScale) / uView * 2. - 1.;
  gl_Position = vec4(clip.x, -clip.y, 0., 1.);
}`;

const DUST_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vP;
flat in vec4 vSeg;
flat in vec2 vShape;
flat in float vSigma;

out vec4 fragColor;

void main() {
  vec2 a = vSeg.xy, b = vSeg.zw, ab = b - a;
  float t = clamp(dot(vP - a, ab) / max(dot(ab, ab), 1e-8), 0., 1.);
  vec2 e = vP - (a + ab * t);
  float d = length(e);

  // When the edge is softened to a pixel, lower the peak so the total amount
  // of dust stays the same: a sub-pixel speck gets fainter, not bigger.
  float s0 = vShape.x, s = vSigma, len = length(ab), k = 2.5066;
  float peak = abs(vShape.y) * (s0 / s) * ((len + s0 * k) / (len + s * k));

  float alpha = peak * exp(-d * d / (2. * s * s));
  fragColor = vShape.y < 0. ? vec4(0., alpha, 0., 0.) : vec4(alpha, 0., 0., 0.);
}`;

/**
 * GLSL for the film pass: composite the dust coverage over the image.
 * Light dust pulls toward a slightly cool white (fitted to scanned dust;
 * the blue goes a little past 1), dark dust toward near-black.
 */
export const DUST_GLSL = /* glsl */ `
uniform sampler2D uDust;    // r: light dust opacity, g: dark, in screen UV
uniform float uDustAmount;

const vec3 DUST_LIGHT = vec3(.875, .976, 1.176);
const vec3 DUST_DARK = vec3(.03, .025, .02);

vec3 applyDust(vec3 c, vec2 uv) {
  vec2 a = clamp(texture(uDust, uv).rg * uDustAmount, 0., 1.);
  c = mix(c, DUST_LIGHT, a.r);
  return mix(c, DUST_DARK, a.g);
}
`;

export interface Dust {
  /**
   * Render the dust coverage and return it (screen space). With footage
   * playing, it's frame n's dust instead of the still's.
   */
  render(
    view: View,
    frame: ResolvedFrame,
    options: DustOptions,
    footage: FootageOptions,
    n: number,
  ): WebGLTexture;
  dispose(): void;
}

export function createDust(gl: WebGL2RenderingContext): Dust {
  const { program, uniforms: u } = createProgram(gl, DUST_VERT, DUST_FRAG);
  const target = createRenderTarget(gl);
  const buffer = gl.createBuffer()!;
  const vao = gl.createVertexArray()!;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = FLOATS_PER_PIECE * 4;
  const attribs: [string, number, number][] = [
    ["aAnchor", 2, 0],
    ["aSeg", 4, 2],
    ["aShape", 2, 6],
  ];
  for (const [name, size, offset] of attribs) {
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);

  let key = "";
  let count = 0;
  // What the texture currently shows: the layout, and where and how big it
  // was drawn. Redrawn only when that changes (a new footage frame, a resize),
  // not on every draw between.
  let drawn = "";

  return {
    render(view, frame, options, footage, n) {
      const shape = [options.size, options.dark, options.hairs, options.seed];
      const k = (
        footage.enabled
          ? [...shape, n, footage.dustRate, footage.dustLinger, footage.seed]
          : [...shape, options.density]
      ).join("|");
      if (k !== key) {
        key = k;
        const data = footage.enabled
          ? layoutFootageDust(options, footage.dustRate, footage.dustLinger, footage.seed, n)
          : layoutDust(options);
        count = data.length / FLOATS_PER_PIECE;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      }

      const { x, y, width, height } = frame.rect;
      const visible = count > 0 && options.amount > 0;
      const d = [
        key,
        visible,
        view.bufferWidth,
        view.bufferHeight,
        view.width,
        view.height,
        x,
        y,
        width,
        height,
        frame.scale,
      ].join("|");
      if (d === drawn) return target.texture;
      drawn = d;

      target.resize(view.bufferWidth, view.bufferHeight);
      target.bind();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!visible) return target.texture;

      gl.useProgram(program);
      gl.uniform4f(u.uFrame, x, y, width, height);
      gl.uniform1f(u.uFilmScale, frame.scale);
      gl.uniform2f(u.uView, view.width, view.height);
      gl.uniform1f(u.uPixel, frame.scale / view.pixelRatio);

      // Overlapping pieces (the joints of a fiber) take the larger opacity
      // instead of adding up, so strands don't get beaded.
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      return target.texture;
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      target.dispose();
    },
  };
}
