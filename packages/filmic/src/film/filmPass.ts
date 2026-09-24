import { createProgram, FULLSCREEN_VERT } from "../core/gl";
import type { SourceFrame, View } from "../source";

/**
 * The film pass: reads a source's frame and draws it to the screen "as film".
 *
 * For now it's a straight copy. Each film effect (grain, mottle, halation, ...)
 * will be added here, so every source gets the same look.
 */
const FILM_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uSource;
uniform vec2 uUvScale;      // how the source texture maps onto the screen,
uniform vec2 uUvOffset;     // see SourceFrame
uniform vec2 uBufferSize;   // output size in device px

out vec4 fragColor;

void main() {
  // Screen UV: (0, 0) bottom-left, (1, 1) top-right.
  vec2 uv = gl_FragCoord.xy / uBufferSize;
  vec3 c = texture(uSource, uv * uUvScale + uUvOffset).rgb;
  fragColor = vec4(c, 1.);
}`;

export interface FilmPass {
  /** Draw `frame` into the currently bound framebuffer. */
  draw(frame: SourceFrame, view: View): void;
  dispose(): void;
}

export function createFilmPass(gl: WebGL2RenderingContext): FilmPass {
  const { program, uniforms: u } = createProgram(
    gl,
    FULLSCREEN_VERT,
    FILM_FRAG,
  );

  return {
    draw(frame, view) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frame.texture);
      gl.uniform1i(u.uSource, 0);
      gl.uniform2f(u.uUvScale, frame.uvScale[0], frame.uvScale[1]);
      gl.uniform2f(u.uUvOffset, frame.uvOffset[0], frame.uvOffset[1]);
      gl.uniform2f(u.uBufferSize, view.bufferWidth, view.bufferHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
