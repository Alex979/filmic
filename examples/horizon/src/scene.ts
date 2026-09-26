import {
  hexToLinear,
  shaderSource,
  type Hex,
  type Source,
  type SourceFrame,
  type View,
} from "filmic";
import { MAX_NODES, type BlobShape } from "./blob";
import {
  ARC_SPAN,
  COLUMNS,
  HORIZON_TABLE,
  MAX_ROWS,
  horizonView,
  type HorizonRow,
} from "./horizonGradient";
import { clamp } from "./math";

/**
 * The whole scene behind the page:
 *
 *   - the sky and the glow along the horizon (the color table)
 *   - the planet's night side below it: faint moonlit clouds and city lights
 *     on a sphere, which turns as the page scrolls (they fade in as it
 *     starts, so the hero at the top is just the gradient)
 *   - the blob, printed in the title's ink, with its eyes
 *
 * The blob is drawn here rather than on the page so it's filmed like the rest:
 * the film's softness, grain, weave and halation all land on it. Only it and
 * the brightest city lights are bright enough to halate; the sky's colors
 * already have film's glow in them.
 *
 * It's two passes. The sky and the planet only depend on the scroll and the
 * canvas size, so they're drawn into a texture that's kept until one of those
 * changes; the blob, which moves on its own, is drawn over a copy of it. When
 * neither has changed since the last draw, the last picture is handed back as
 * it is, and the film skips its own picture passes too.
 */

/** What the scene needs from the page each time it's drawn. */
export interface SceneFrame {
  /** How far the page is scrolled, in CSS px. */
  scroll: number;
  blob: BlobShape;
}

// Colors, in linear light.
const INK: Hex = "#f2ede4"; // the title's ink (--light)
const EYE: Hex = "#1c1612"; // the blob's eyes: the page's darkest ink
const MOONLIGHT: Hex = "#1c222c"; // the brightest a cloud gets far from the glow
const SODIUM: Hex = "#ff9a4a"; // city lights; the brightest are white-hot
const glsl = (hex: Hex) =>
  `vec3(${hexToLinear(hex)
    .map((v) => v.toFixed(5))
    .join(", ")})`;

/** Cloud size, in frame heights (seen head-on). */
const CLOUD_SIZE = 0.11;
/** Scroll, in screen heights, over which the night side's detail fades in. */
const DETAIL_IN = 0.3;

const NOISE_GLSL = /* glsl */ `
vec3 hash33(vec3 p) {
  p = fract(p * vec3(.1031, .1030, .0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Gradient noise, about -0.7..0.7 (and never beyond ±3: each gradient and
// offset lies within the unit cube).
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3. - 2. * f);
  #define G(o) dot(hash33(i + o) * 2. - 1., f - o)
  return mix(
    mix(mix(G(vec3(0, 0, 0)), G(vec3(1, 0, 0)), u.x),
        mix(G(vec3(0, 1, 0)), G(vec3(1, 1, 0)), u.x), u.y),
    mix(mix(G(vec3(0, 0, 1)), G(vec3(1, 0, 1)), u.x),
        mix(G(vec3(0, 1, 1)), G(vec3(1, 1, 1)), u.x), u.y), u.z);
  #undef G
}
`;

/** The sky and the planet's night side. Written in linear light. */
const BACKGROUND_FRAG = /* glsl */ `
uniform vec4 uHorizon;   // circle center xy, radius (CSS px), CSS px per frame height
uniform vec3 uPlanet;    // how far it has turned (rad), clouds per radius, detail (0..1)
uniform int uRowCount;
uniform float uRowAt[${MAX_ROWS}];                   // heights, frame heights
uniform vec3 uRowColor[${MAX_ROWS * COLUMNS}];       // linear light, ${COLUMNS} per row

const int COLUMNS = ${COLUMNS};
const float ARC_SPAN = ${ARC_SPAN.toFixed(4)};
const vec3 MOONLIGHT = ${glsl(MOONLIGHT)};
const vec3 SODIUM = ${glsl(SODIUM)};

${NOISE_GLSL}

// --- The sky and the glow: the color table ---

// Row i's color at column position x (0..COLUMNS-1, fractional).
vec3 rowColor(int i, float x) {
  int j = min(int(x), COLUMNS - 2);
  return mix(uRowColor[i * COLUMNS + j], uRowColor[i * COLUMNS + j + 1], x - float(j));
}

vec3 tableColor(float h, float x) {
  vec3 c = rowColor(0, x);
  for (int i = 1; i < ${MAX_ROWS}; i++) {
    if (i >= uRowCount) break;
    if (h > uRowAt[i - 1]) {
      float t = clamp((h - uRowAt[i - 1]) / (uRowAt[i] - uRowAt[i - 1]), 0., 1.);
      c = mix(rowColor(i - 1, x), rowColor(i, x), t);
    }
  }
  return c;
}

// --- The night side ---

// The point of the planet's surface under a pixel, as a unit vector. The
// planet is a sphere seen from far above: q is where a point of it lands on
// the screen (px from the circle's center / radius), and turning it about
// the screen's x axis carries the ground up toward the horizon.
vec3 surface(vec2 q) {
  float z = sqrt(max(1. - dot(q, q), 0.));
  float cs = cos(uPlanet.x), sn = sin(uPlanet.x);
  return vec3(q.x, q.y * cs + z * sn, z * cs - q.y * sn);
}

// Light on the ground at surface point s, at height h (frame heights,
// negative), facing the camera by z (1 = head-on, 0 = at the horizon). ds
// is how far s moves per px.
vec3 nightSide(vec3 s, float ds, float z, float h, vec3 base) {
  // Clouds, stretched along the horizon. Near the horizon the ground is
  // squeezed into a few px; each octave fades out before it's finer than a
  // pixel, so nothing shimmers as it moves.
  vec3 P = s * uPlanet.y * vec3(.55, 1., 1.);
  float px = ds * uPlanet.y; // noise cells per px
  float n = 0., amp = .55, scale = 1.;
  for (int i = 0; i < 3; i++) {
    n += amp * gnoise(P * scale + float(i) * 17.3) * (1. - smoothstep(.2, .5, px * scale));
    scale *= 2.03;
    amp *= .5;
  }
  float cloud = smoothstep(-.02, .42, n);
  // Moonlight far from the horizon; near it, the sunset's glow lights them.
  float glow = exp(h / .045);
  vec3 light = MOONLIGHT * (.35 + .65 * z) + base * 1.3 * glow;
  // At the very rim it's all atmosphere.
  vec3 c = base + uPlanet.z * cloud * light * (1. - smoothstep(-.006, 0., h));

  // City lights: at most one per cell, in clusters, under the clouds. Each
  // is a small round spot about a pixel across, whatever the squeeze, and
  // they fade out where cells get too small to hold one.
  vec3 L = s * uPlanet.y * 3.6;
  vec3 cell = floor(L);
  vec3 rnd = hash33(cell + 41.);
  float cluster = smoothstep(.12, .42, gnoise(s * uPlanet.y * .8 + 29.));
  if (rnd.x < .6 * cluster) {
    float lpx = ds * uPlanet.y * 3.6; // cells per px
    vec3 at = cell + .25 + .5 * hash33(cell + 7.);
    float sigma = .7 * lpx;
    float spot = exp(-dot(L - at, L - at) / (2. * sigma * sigma));
    float b = rnd.y * rnd.y * rnd.y; // mostly dim, a few bright
    vec3 lamp = mix(SODIUM, vec3(1.), b * b) * (.06 + 1.6 * b);
    c += uPlanet.z * lamp * spot * (1. - .75 * cloud) * (1. - smoothstep(.06, .16, lpx));
  }
  return c;
}

void main() {
  vec2 p = filmPx();
  vec2 d = p - uHorizon.xy;

  // Height above the horizon, and position along it (0 = left end of the
  // table's arc, 1 = right end, the screen's center always at 0.5).
  float h = (length(d) - uHorizon.z) / uHorizon.w;
  float along = uHorizon.z * atan(d.x, -d.y) / uHorizon.w;
  float x = clamp(.5 + along / ARC_SPAN, 0., 1.) * float(COLUMNS - 1);

  vec3 c = tableColor(h, x);
  // (Derivatives only work outside of branches.)
  vec2 q = d / uHorizon.z;
  vec3 s = surface(q);
  float ds = length(fwidth(s));
  if (h < 0. && uPlanet.z > 0.) c = nightSide(s, ds, sqrt(max(1. - dot(q, q), 0.)), h, c);

  fragColor = vec4(c, 1.);
}`;

/** The blob, over the background. Written in linear light. */
const BLOB_FRAG = /* glsl */ `
uniform sampler2D uBackground;      // the sky and planet, at canvas size

uniform vec3 uNodes[${MAX_NODES}];  // the blob, head to tail tip: x, y, radius (CSS px)
uniform int uNodeCount;
uniform vec4 uBlobBox;              // a box around it all: left, top, right, bottom
uniform vec3 uBlob;                 // opacity, boil, head radius
uniform vec4 uEyes[2];              // each: center xy, squeeze across and down
uniform vec2 uEyeMood;              // happy (0 = round, 1 = ^), open (0 = blinking)

const vec3 INK = ${glsl(INK)};
const vec3 EYE = ${glsl(EYE)};

${NOISE_GLSL}

// Distance to a stroke from a to b whose radius tapers from a.z to b.z
// (close enough to exact for gentle tapers).
float taper(vec2 p, vec3 a, vec3 b) {
  vec2 pa = p - a.xy, ba = b.xy - a.xy;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.);
  return length(pa - ba * t) - mix(a.z, b.z, t);
}

// Signed distance to the blob's edge, in CSS px (negative inside): one
// smooth, tapering stroke through its points.
float blob(vec2 p) {
  vec3 head = uNodes[0];
  float d = length(p - head.xy) - head.z;
  for (int i = 1; i < ${MAX_NODES}; i++) {
    if (i >= uNodeCount) break;
    d = min(d, taper(p, uNodes[i - 1], uNodes[i]));
  }
  // The edge wobbles a little, differently every frame, like liquid. It can
  // only move the edge so far (|gnoise| < 3): further out or in than that,
  // this pixel is all the way outside or inside whatever the wobble does, so
  // the noise isn't worth computing.
  float r = uBlob.z;
  if (abs(d) > r * .21 + .6) return d;
  return d + r * .07 * gnoise(vec3((p - head.xy) / r * 1.1, uBlob.y * .61));
}

// Distance to the segment from a to b.
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.));
}

// Signed distance to an eye, in CSS px: an oval, which squeezes shut to
// blink, or a ^ when it's happy (the two blend as it changes). The eye is
// drawn head-on and squeezed by how far it's turned away.
float eye(vec2 p, vec4 e) {
  float s = uBlob.z; // sized from the head
  vec2 q = (p - e.xy) / e.zw;
  vec2 ab = s * vec2(.085, max(.14 * uEyeMood.y, .022));
  float k0 = length(q / ab), k1 = length(q / (ab * ab));
  float oval = k0 * (k0 - 1.) / max(k1, 1e-6);
  vec2 c = vec2(abs(q.x), q.y);
  float caret = segment(c, s * vec2(0., -.07), s * vec2(.12, .04)) - s * .032;
  return mix(oval, caret, uEyeMood.x) * min(e.z, e.w);
}

void main() {
  vec3 c = texture(uBackground, gl_FragCoord.xy / uBufferSize).rgb;

  vec2 p = filmPx();
  if (uBlob.x > 0. && all(greaterThan(p, uBlobBox.xy)) && all(lessThan(p, uBlobBox.zw))) {
    // About a px of edge; the film softens it further.
    float cover = clamp(.5 - blob(p) / 1.2, 0., 1.);
    // The eyes only show where there's blob under them.
    float look = cover > 0.
      ? clamp(.5 - min(eye(p, uEyes[0]), eye(p, uEyes[1])) / 1.2, 0., 1.)
      : 0.;
    c = mix(c, mix(INK, EYE, look), cover * uBlob.x);
  }

  fragColor = vec4(c, 1.);
}`;

/** Everything the blob pass reads from the shape, flattened for comparing. */
const BLOB_STATE = MAX_NODES * 3 + 1 + 4 + 3 + 8 + 2;

export function horizonScene(
  frame: (view: View) => SceneFrame,
  table: HorizonRow[] = HORIZON_TABLE,
): Source {
  const rows = table.slice(0, MAX_ROWS);
  const at = new Float32Array(MAX_ROWS);
  const colors = new Float32Array(MAX_ROWS * COLUMNS * 3);
  rows.forEach(([h, row], i) => {
    at[i] = h;
    row.forEach((hex, j) => colors.set(hexToLinear(hex), (i * COLUMNS + j) * 3));
  });

  return {
    create(gl, context) {
      // What the current draw is of, for the passes' uniform setters.
      let scroll = 0;
      let blob: BlobShape | null = null;
      let background: SourceFrame | null = null;

      const sky = shaderSource(
        BACKGROUND_FRAG,
        (gl, u, view) => {
          const g = horizonView(view.width, view.height, scroll);
          gl.uniform4f(u.uHorizon, g.cx, g.cy, g.r, g.scale);
          const t = clamp(scroll / (DETAIL_IN * view.height), 0, 1);
          const detail = t * t * (3 - 2 * t);
          gl.uniform3f(u.uPlanet, g.spin, g.r / g.scale / CLOUD_SIZE, detail);
          gl.uniform1i(u.uRowCount, rows.length);
          gl.uniform1fv(u.uRowAt, at);
          gl.uniform3fv(u.uRowColor, colors);
        },
        { linear: true },
      ).create(gl, context);

      const drop = shaderSource(
        BLOB_FRAG,
        (gl, u) => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, background!.texture);
          gl.uniform1i(u.uBackground, 0);
          const b = blob!;
          gl.uniform3fv(u.uNodes, b.nodes);
          gl.uniform1i(u.uNodeCount, b.count);
          gl.uniform4f(u.uBlobBox, ...b.bounds);
          gl.uniform3f(u.uBlob, b.opacity, b.boil % 1000, b.radius);
          gl.uniform4fv(u.uEyes, b.eyes);
          gl.uniform2f(u.uEyeMood, b.happy, b.open);
        },
        { linear: true },
      ).create(gl, context);

      // What's in the textures now, to tell whether a draw changes anything.
      let skyKey = "";
      const drawn = new Float32Array(BLOB_STATE);
      const state = new Float32Array(BLOB_STATE);
      let picture: SourceFrame | null = null;
      let version = 0;

      // The blob's shape as the shader sees it; all zeros while it isn't
      // drawn, so its resting state is one state.
      const snapshot = (b: BlobShape, into: Float32Array) => {
        into.fill(0);
        if (b.opacity <= 0) return;
        into.set(b.nodes, 0);
        let i = MAX_NODES * 3;
        into[i++] = b.count;
        into.set(b.bounds, i);
        i += 4;
        into[i++] = b.opacity;
        into[i++] = b.boil % 1000;
        into[i++] = b.radius;
        into.set(b.eyes, i);
        i += 8;
        into[i++] = b.happy;
        into[i++] = b.open;
      };

      return {
        render(view) {
          const scene = frame(view);
          scroll = scene.scroll;
          blob = scene.blob;

          const key = [
            scroll,
            view.width,
            view.height,
            view.bufferWidth,
            view.bufferHeight,
          ].join("|");
          let changed = false;
          if (key !== skyKey) {
            skyKey = key;
            background = sky.render(view);
            changed = true;
          }

          snapshot(blob, state);
          for (let i = 0; i < BLOB_STATE && !changed; i++)
            if (state[i] !== drawn[i]) changed = true;

          if (changed || !picture) {
            drawn.set(state);
            version++;
            picture = { ...drop.render(view), version };
          }
          return picture;
        },
        dispose() {
          sky.dispose();
          drop.dispose();
        },
      };
    },
  };
}
