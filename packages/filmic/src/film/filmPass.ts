import { createProgram, FULLSCREEN_VERT } from "../core/gl";
import type { SourceFrame, View } from "../source";
import { resolveFrame, type FrameOptions } from "./frame";
import {
  createGrainTexture,
  GRAIN_GLSL,
  GRAIN_TEXTURE_SIZE,
  type GrainOptions,
} from "./grain";
import { createOptics, type OpticsOptions } from "./optics";

/** Every film setting, fully resolved (no missing fields). */
export interface FilmSettings {
  frame: FrameOptions;
  optics: OpticsOptions;
  grain: GrainOptions;
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

void main() {
  vec2 uv = gl_FragCoord.xy / uBufferSize;
  vec2 cssPx = vec2(gl_FragCoord.x, uBufferSize.y - gl_FragCoord.y) / uPixelRatio;
  // Position on the film, in film px from the frame's top-left corner. Effects
  // that live on the film use this, so they stay put relative to the image.
  vec2 filmPx = (cssPx - uFrame.xy) * uFilmScale;

  // 1. Emulsion: sample the (already optically softened) image through
  //    grain-driven offsets, so edges break up into grain.
  vec3 c = sampleSource(uv + filmToUv(grainBreakup(filmPx)));
  // 2. Grain on top, strongest in the mid-tones.
  c = applyGrain(c, filmPx);

  fragColor = vec4(clamp(c, 0., 1.), 1.);
}`;

export interface FilmPass {
  /** Draw `frame` to the canvas with the film look applied. */
  draw(frame: SourceFrame, view: View, settings: FilmSettings): void;
  dispose(): void;
}

export function createFilmPass(gl: WebGL2RenderingContext): FilmPass {
  const { program, uniforms: u } = createProgram(
    gl,
    FULLSCREEN_VERT,
    FILM_FRAG,
  );
  const grainTexture = createGrainTexture(gl);
  const opticsPasses = createOptics(gl);

  return {
    draw(sourceFrame, view, { frame: frameOptions, optics, grain }) {
      const film = resolveFrame(view, frameOptions);

      // Passes that render into textures come first, before targeting the screen:
      // the optical blur, and regenerating grain if its settings changed.
      const frame = opticsPasses.apply(sourceFrame, view, optics, film.scale);
      grainTexture.update(grain.seed, grain.softness, grain.sharpness);

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

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, grainTexture.texture);
      gl.uniform1i(u.uGrainTex, 1);
      gl.uniform1f(u.uGrainTexSize, GRAIN_TEXTURE_SIZE);
      gl.uniform1f(u.uGrainPxSize, Math.max(grain.size, 0.05));
      gl.uniform2f(u.uGrainOffset, 0, 0);
      gl.uniform3f(
        u.uGrainLevels,
        grain.shadows * grain.amount,
        grain.midtones * grain.amount,
        grain.highlights * grain.amount,
      );
      gl.uniform1f(u.uGrainChroma, grain.chroma);
      gl.uniform1f(u.uGrainBreakup, grain.breakup * grain.amount);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      grainTexture.dispose();
      opticsPasses.dispose();
    },
  };
}
