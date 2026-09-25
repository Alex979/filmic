import { shaderSource } from "filmic";
import type { DemoInstance } from "./types";

/**
 * A procedural shaderSource written inline: a low sun in a hazy dusk sky.
 * It's drawn from the canvas size, so it fills any card at any size.
 */
const dusk = () =>
  shaderSource(/* glsl */ `
void main() {
  vec2 uv = filmPx() / uResolution;           // 0..1, y down
  vec2 sun = vec2(.68, .62);
  float aspect = uResolution.x / uResolution.y;
  float d = length((uv - sun) * vec2(aspect, 1.));

  // Sky: deep blue overhead to warm haze at the bottom (linear light).
  vec3 top = vec3(.02, .035, .09);
  vec3 haze = vec3(.9, .42, .16);
  vec3 c = mix(top, haze, pow(uv.y, 1.6));

  // The sun: a bright disc with a wide glow around it.
  c += vec3(1., .55, .22) * .6 * exp(-d * 5.);
  c = mix(c, vec3(1.2, 1., .8), smoothstep(.062, .058, d));

  // Dark ground below the horizon line.
  c = mix(c, vec3(.012, .01, .012), smoothstep(.785, .79, uv.y));

  fragColor = vec4(linearToSrgb(c), 1.);
}`);

/** A procedural shader source: fills whatever canvas it's given. */
export function gradientDemo(): DemoInstance {
  return { source: dusk, dispose() {} };
}
