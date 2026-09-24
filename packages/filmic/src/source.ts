import { createProgram, FULLSCREEN_VERT, type Uniforms } from "./core/gl";

/** Size information for the frame being drawn. */
export interface View {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** Device px per CSS px actually used for rendering. */
  pixelRatio: number;
  /** Drawing buffer size in device px. */
  bufferWidth: number;
  bufferHeight: number;
}

/**
 * Something filmic can film: a procedural scene, an image, and so on.
 *
 * A Source is a recipe; `create` turns it into a live instance bound to one
 * WebGL context, so the same Source can be used by several canvases.
 */
export interface Source {
  create(gl: WebGL2RenderingContext): SourceInstance;
}

export interface SourceInstance {
  /** Draw the scene into the currently bound framebuffer, covering all of it. */
  draw(view: View): void;
  /** Release GPU resources. */
  dispose(): void;
}

/**
 * Prepended to every shaderSource fragment shader, so a source only needs to
 * write `void main() { fragColor = ...; }`.
 */
const SOURCE_HEADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uResolution;   // canvas size in CSS px
uniform vec2 uBufferSize;   // drawing buffer size in device px
uniform float uPixelRatio;  // device px per CSS px

out vec4 fragColor;

// The current pixel in CSS px: origin top-left, y down, like the page.
vec2 filmPx() {
  return vec2(gl_FragCoord.x, uBufferSize.y - gl_FragCoord.y) / uPixelRatio;
}

// Linear light -> sRGB for output.
vec3 linearToSrgb(vec3 l) {
  l = max(l, 0.);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1. / 2.4)) - .055, step(.0031308, l));
}

#line 1
`;

export type SetUniforms = (
  gl: WebGL2RenderingContext,
  uniforms: Uniforms,
  view: View,
) => void;

/**
 * A source drawn by a fragment shader. The shader gets the header above
 * (uResolution, uPixelRatio, filmPx(), linearToSrgb(), fragColor) and writes
 * sRGB colors to `fragColor`. `setUniforms` runs before each draw to pass in
 * any extra uniforms the shader declares.
 */
export function shaderSource(frag: string, setUniforms?: SetUniforms): Source {
  return {
    create(gl) {
      const { program, uniforms } = createProgram(
        gl,
        FULLSCREEN_VERT,
        SOURCE_HEADER + frag,
      );
      return {
        draw(view) {
          gl.useProgram(program);
          gl.uniform2f(uniforms.uResolution, view.width, view.height);
          gl.uniform2f(
            uniforms.uBufferSize,
            view.bufferWidth,
            view.bufferHeight,
          );
          gl.uniform1f(uniforms.uPixelRatio, view.pixelRatio);
          setUniforms?.(gl, uniforms, view);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        dispose() {
          gl.deleteProgram(program);
        },
      };
    },
  };
}
