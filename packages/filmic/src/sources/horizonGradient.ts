import { hexToLinear, type Hex } from "../core/color";
import { shaderSource } from "../source";

/**
 * A color stop: [height above the horizon, color].
 *
 * Height is measured from the horizon's edge, straight out from the planet's
 * center, as a fraction of the viewport height: 0 is the horizon, 0.1 is 10% of
 * the viewport above it, negative values are on the planet.
 */
export type HorizonStop = [height: number, color: Hex];

export interface HorizonGradientOptions {
  /** Where the top of the horizon sits, as a fraction of viewport height. Default 0.53. */
  apex?: number;
  /**
   * Planet radius in viewport widths. Bigger = flatter horizon. Default 4.
   */
  curvature?: number;
  /** Up to 16 stops, sorted by height. */
  stops?: HorizonStop[];
}

export const DEFAULT_HORIZON_STOPS: HorizonStop[] = [
  // the planet: near-black, with the glow bleeding a little way past the rim
  [-0.25, "#110e0d"],
  [-0.06, "#1b1411"],
  [-0.015, "#3a1d15"],
  [-0.008, "#52251b"],
  [-0.003, "#763020"],
  // the glow: a soft red rim, then orange, peach, dusty lavender
  [0.0, "#9e3c26"],
  [0.006, "#c4522b"],
  [0.016, "#d9632f"],
  [0.035, "#ea8f48"],
  [0.07, "#e3ae7c"],
  [0.12, "#b09aa6"],
  // the sky: periwinkle to blue, fading to night at the top
  [0.2, "#8095c0"],
  [0.32, "#5583bd"],
  [0.42, "#34598c"],
  [0.55, "#182a47"],
  [1.2, "#0b1020"],
];

const MAX_STOPS = 16;

/** The horizon circle in CSS px: center (cx, cy) and radius r. */
export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Where the planet's edge is for a given canvas size. */
export function horizonCircle(
  width: number,
  height: number,
  options: HorizonGradientOptions = {},
): Circle {
  const apex = options.apex ?? 0.53;
  const r = (options.curvature ?? 4) * width;
  return { cx: width / 2, cy: apex * height + r, r };
}

/**
 * A planet's horizon at sunset, seen from high up: color depends only on how
 * far a pixel is above the curved horizon.
 */
export function horizonGradient(options: HorizonGradientOptions = {}) {
  const stops = (options.stops ?? DEFAULT_HORIZON_STOPS).slice(0, MAX_STOPS);
  const at = new Float32Array(MAX_STOPS);
  const colors = new Float32Array(MAX_STOPS * 3);
  stops.forEach(([h, hex], i) => {
    at[i] = h;
    colors.set(hexToLinear(hex), i * 3);
  });

  return shaderSource(
    /* glsl */ `
uniform vec3 uCircle;              // horizon circle: center xy, radius z (CSS px)
uniform int uStopCount;
uniform float uStopAt[${MAX_STOPS}];
uniform vec3 uStopColor[${MAX_STOPS}]; // linear light

void main() {
  vec2 px = filmPx();

  // Height above the horizon: distance from the planet's center minus its
  // radius, in viewport heights. This one number is what makes the bands curve.
  float h = (length(px - uCircle.xy) - uCircle.z) / uResolution.y;

  // Find the two stops around h and blend between them (in linear light).
  vec3 c = uStopColor[0];
  for (int i = 1; i < ${MAX_STOPS}; i++) {
    if (i >= uStopCount) break;
    if (h > uStopAt[i - 1]) {
      float t = clamp((h - uStopAt[i - 1]) / (uStopAt[i] - uStopAt[i - 1]), 0., 1.);
      c = mix(uStopColor[i - 1], uStopColor[i], smoothstep(0., 1., t));
    }
  }

  fragColor = vec4(linearToSrgb(c), 1.);
}`,
    (gl, u, view) => {
      const { cx, cy, r } = horizonCircle(view.width, view.height, options);
      gl.uniform3f(u.uCircle, cx, cy, r);
      gl.uniform1i(u.uStopCount, stops.length);
      gl.uniform1fv(u.uStopAt, at);
      gl.uniform3fv(u.uStopColor, colors);
    },
  );
}
