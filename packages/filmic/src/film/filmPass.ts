import { createProgram, FULLSCREEN_VERT } from "../core/gl";
import type { SourceFrame, View } from "../source";
import { createDust, DUST_GLSL, type DustOptions } from "./dust";
import type { FootageFrame, FootageOptions } from "./footage";
import { resolveFrame, type FrameOptions, type ResolvedFrame } from "./frame";
import {
  createGrainTexture,
  GRAIN_GLSL,
  GRAIN_TEXTURE_SIZE,
  type GrainOptions,
} from "./grain";
import {
  createMottleTexture,
  MOTTLE_GLSL,
  MOTTLE_TEXTURE_SIZE,
  mottleTexelSize,
  type MottleOptions,
} from "./mottle";
import { createOptics, type OpticsOptions } from "./optics";

/** Every film setting, fully resolved (no missing fields). */
export interface FilmSettings {
  frame: FrameOptions;
  optics: OpticsOptions;
  mottle: MottleOptions;
  grain: GrainOptions;
  dust: DustOptions;
  footage: FootageOptions;
}

/**
 * The film pass: reads a source's frame and draws it to the screen "as film".
 * Each film effect is a GLSL chunk included here, so every source gets the
 * same look.
 */
const FILM_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec2 uUvScale;      // how the source texture maps onto the screen,
uniform vec2 uUvOffset;     // see SourceFrame
uniform vec2 uBufferSize;   // output size in device px
uniform float uPixelRatio;  // device px per CSS px
uniform vec4 uFrame;        // film frame rect in CSS px: x, y, width, height
uniform float uFilmScale;   // film px per CSS px
uniform vec3 uWeave;        // footage: frame shift (film px) and rotation (rad)
uniform float uExposure;    // footage flicker, as a gain on sRGB values

out vec4 fragColor;

// Sample the source at a screen UV ((0, 0) bottom-left, (1, 1) top-right).
vec3 sampleSource(vec2 uv) {
  return texture(uSource, uv * uUvScale + uUvOffset).rgb;
}

// A distance in film px (y down) as a screen UV offset (y up).
vec2 filmToUv(vec2 d) {
  return d / uFilmScale * uPixelRatio / uBufferSize * vec2(1., -1.);
}

${GRAIN_GLSL}
${MOTTLE_GLSL}
${DUST_GLSL}

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferSize;
  vec2 cssPx = vec2(gl_FragCoord.x, uBufferSize.y - gl_FragCoord.y) / uPixelRatio;
  // Position on the film, in film px from the frame's top-left corner. Effects
  // that live on the film use this, so they stay put relative to the image.
  vec2 screenFilmPx = (cssPx - uFrame.xy) * uFilmScale;

  // Weave: the film shifts and turns slightly in the gate, so find the point
  // of the film that's under this pixel (the weave's inverse, about the
  // frame's center). Everything on the film moves with it.
  vec2 center = uFrame.zw * uFilmScale * .5;
  vec2 q = screenFilmPx - center - uWeave.xy;
  float cs = cos(uWeave.z), sn = sin(uWeave.z);
  vec2 filmPx = center + vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
  vec2 onFilm = uv + filmToUv(filmPx - screenFilmPx);

  // 1. Emulsion: sample the (already optically softened) image through
  //    grain-driven offsets, so edges break up into grain.
  vec3 c = sampleSource(onFilm + filmToUv(grainBreakup(filmPx)));
  // 2. Flicker: this frame's exposure.
  c *= uExposure;
  // 3. Mottle: faint, soft blotches of density and color.
  c = applyMottle(c, filmPx);
  // 4. Grain on top, strongest in the mid-tones.
  c = applyGrain(c, filmPx);
  // 5. Dust sits on the film, in front of the grain.
  c = applyDust(c, onFilm);

  fragColor = vec4(clamp(c, 0., 1.), 1.);
}`;

export interface FilmPass {
  /**
   * Draw `frame` to the canvas with the film look applied, as footage frame
   * `footage` (STILL_FRAME for a still). Returns where the film frame landed.
   */
  draw(
    frame: SourceFrame,
    view: View,
    settings: FilmSettings,
    footage: FootageFrame,
  ): ResolvedFrame;
  dispose(): void;
}

export function createFilmPass(gl: WebGL2RenderingContext): FilmPass {
  const { program, uniforms: u } = createProgram(
    gl,
    FULLSCREEN_VERT,
    FILM_FRAG,
  );
  const grainTexture = createGrainTexture(gl);
  const mottleTexture = createMottleTexture(gl);
  const dust = createDust(gl);
  const opticsPasses = createOptics(gl);

  return {
    draw(
      sourceFrame,
      view,
      { frame: frameOptions, optics, mottle, grain, dust: dustOptions, footage },
      current,
    ) {
      const film = resolveFrame(view, frameOptions, sourceFrame.rect);

      // Passes that render into textures come first, before targeting the screen:
      // the optical blur, dust, and regenerating noise if its settings changed.
      const frame = opticsPasses.apply(sourceFrame, view, optics, film.scale);
      grainTexture.update(grain.seed, grain.softness, grain.sharpness);
      mottleTexture.update(mottle.seed);
      const dustTexture = dust.render(view, film, dustOptions, footage, current.n);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, view.bufferWidth, view.bufferHeight);
      gl.useProgram(program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frame.texture);
      gl.uniform1i(u.uSource, 0);
      gl.uniform2f(u.uUvScale, frame.uvScale[0], frame.uvScale[1]);
      gl.uniform2f(u.uUvOffset, frame.uvOffset[0], frame.uvOffset[1]);
      gl.uniform2f(u.uBufferSize, view.bufferWidth, view.bufferHeight);
      gl.uniform1f(u.uPixelRatio, view.pixelRatio);

      const { x, y, width, height } = film.rect;
      gl.uniform4f(u.uFrame, x, y, width, height);
      gl.uniform1f(u.uFilmScale, film.scale);
      gl.uniform3f(u.uWeave, current.dx, current.dy, current.rotation);
      // Flicker scales linear light; on (roughly gamma 2.2) sRGB values that's
      // the same as scaling by exposure^(1/2.2).
      gl.uniform1f(u.uExposure, Math.pow(current.exposure, 1 / 2.2));

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, grainTexture.texture);
      gl.uniform1i(u.uGrainTex, 1);
      gl.uniform1f(u.uGrainTexSize, GRAIN_TEXTURE_SIZE);
      gl.uniform1f(u.uGrainPxSize, Math.max(grain.size, 0.05));
      gl.uniform2f(u.uGrainOffset, current.grainOffset[0], current.grainOffset[1]);
      gl.uniform3f(
        u.uGrainLevels,
        grain.shadows * grain.amount,
        grain.midtones * grain.amount,
        grain.highlights * grain.amount,
      );
      gl.uniform1f(u.uGrainChroma, grain.chroma);
      gl.uniform1f(u.uGrainBreakup, grain.breakup * grain.amount);

      // Mottle follows grain's brightness curve, scaled so `amount` is its
      // strength at the mid-tones.
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, mottleTexture.texture);
      gl.uniform1i(u.uMottleTex, 2);
      gl.uniform1f(u.uMottleTexSize, MOTTLE_TEXTURE_SIZE);
      gl.uniform1f(u.uMottlePxSize, mottleTexelSize(Math.max(mottle.size, 0.5)));
      gl.uniform2f(u.uMottleOffset, 0, 0);
      const toMid = mottle.amount / Math.max(grain.midtones, 1e-3);
      gl.uniform3f(
        u.uMottleLevels,
        grain.midtones > 0 ? grain.shadows * toMid : mottle.amount,
        mottle.amount,
        grain.midtones > 0 ? grain.highlights * toMid : mottle.amount,
      );
      gl.uniform1f(u.uMottleChroma, mottle.chroma);
      gl.uniform1f(u.uMottleStreaks, mottle.streaks);

      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, dustTexture);
      gl.uniform1i(u.uDust, 3);
      gl.uniform1f(u.uDustAmount, dustOptions.amount);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return film;
    },
    dispose() {
      gl.deleteProgram(program);
      grainTexture.dispose();
      mottleTexture.dispose();
      dust.dispose();
      opticsPasses.dispose();
    },
  };
}
