import { shaderSource } from "../source";

/**
 * Debugging source: a soft gradient, a grid line every 100 CSS px drawn exactly
 * one device pixel wide, and a 100px-radius circle. If the lines are crisp and
 * the circle is round, sizing and pixel ratio are correct.
 */
export function testPattern() {
  return shaderSource(/* glsl */ `
void main() {
  vec2 px = filmPx();
  vec2 uv = px / uResolution;

  vec3 c = vec3(.08 + .25 * uv.x, .08 + .12 * (1. - uv.y), .16);

  vec2 cell = mod(px, 100.);
  float onePx = 1. / uPixelRatio;
  if (cell.x < onePx || cell.y < onePx) c = vec3(.45);

  float r = length(px - uResolution * .5);
  if (abs(r - 100.) < onePx) c = vec3(.95, .6, .3);

  fragColor = vec4(c, 1.);
}`);
}
