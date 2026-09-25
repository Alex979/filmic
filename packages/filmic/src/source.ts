import { COLOR_GLSL } from "./core/color";
import { createProgram, FULLSCREEN_VERT, type Uniforms } from "./core/gl";
import { createRenderTarget, srgbFormat } from "./core/target";
import type { Rect } from "./film/frame";

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
  create(gl: WebGL2RenderingContext, context: SourceContext): SourceInstance;
}

/** What the film gives a source instance, besides the GL context. */
export interface SourceContext {
  /**
   * Ask for a redraw on the next animation frame, e.g. when an image finishes
   * loading or a video has a new frame. Calling it from `render` keeps the
   * film redrawing every frame, for sources that are always changing.
   */
  requestRender(): void;
}

export interface SourceInstance {
  /** Produce the current frame of the scene as a texture. */
  render(view: View): SourceFrame;
  /** Release GPU resources. */
  dispose(): void;
}

/**
 * One frame of a source: a texture, and how it lines up with the screen.
 *
 * The texture holds linear light: either an sRGB-format texture, which the
 * GPU decodes as it's read (filmic's own render targets are `SRGB8_ALPHA8`),
 * or linear values in any other format.
 *
 * The film pass works in screen UV: (0, 0) is the bottom-left of the canvas and
 * (1, 1) the top-right (WebGL's convention). It samples the texture at
 * `screenUv * uvScale + uvOffset`, which lets a source flip, crop or letterbox
 * its texture without an extra pass: a texture rendered by filmic at canvas
 * size uses scale (1, 1) and offset (0, 0); an uploaded image, whose first row
 * is its top, flips y with scale (1, -1) and offset (0, 1).
 */
export interface SourceFrame {
  texture: WebGLTexture;
  uvScale: [number, number];
  uvOffset: [number, number];
  /**
   * Where the source's picture sits on the canvas, in CSS px, if it has one
   * (an image laid out with cover or contain). The film frame follows it when
   * `frame.fit` is "source", so effects scale with the picture.
   */
  rect?: Rect;
  /**
   * Changes whenever the texture's contents change. While it stays the same
   * (with the same texture and view), the film skips the passes that only
   * depend on the picture: the optical blur and halation. Leave it out for a
   * texture that may change on every render.
   */
  version?: number;
}

/**
 * Prepended to every shaderSource fragment shader, so a source only needs to
 * write `void main() { fragColor = ...; }`. The shader's `main` is renamed, so
 * the footer below can run it and store what it wrote as linear light.
 */
const SOURCE_HEADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uResolution;   // canvas size in CSS px
uniform vec2 uBufferSize;   // drawing buffer size in device px
uniform float uPixelRatio;  // device px per CSS px

vec4 fragColor;

// The current pixel in CSS px: origin top-left, y down, like the page.
vec2 filmPx() {
  return vec2(gl_FragCoord.x, uBufferSize.y - gl_FragCoord.y) / uPixelRatio;
}
${COLOR_GLSL}
#define main filmicSourceMain
#line 1
`;

const sourceFooter = (linear: boolean) => /* glsl */ `
#undef main
out vec4 filmicOut;
void main() {
  filmicSourceMain();
  filmicOut = vec4(${linear ? "max(fragColor.rgb, 0.)" : "srgbToLinear(fragColor.rgb)"}, fragColor.a);
}
`;

export type SetUniforms = (
  gl: WebGL2RenderingContext,
  uniforms: Uniforms,
  view: View,
) => void;

export interface ShaderSourceOptions {
  /**
   * The shader writes linear light to `fragColor` rather than sRGB. Saves a
   * conversion for shaders that work in linear light anyway. Default false.
   */
  linear?: boolean;
}

/**
 * A source drawn by a fragment shader. The shader gets the header above
 * (uResolution, uPixelRatio, filmPx(), linearToSrgb(), srgbToLinear(),
 * fragColor) and writes sRGB colors to `fragColor`, or linear light with
 * `linear: true`. `setUniforms` runs before each draw to pass in any extra
 * uniforms the shader declares.
 *
 * It renders into its own texture at canvas resolution, which the film pass
 * then reads.
 */
export function shaderSource(
  frag: string,
  setUniforms?: SetUniforms,
  options: ShaderSourceOptions = {},
): Source {
  return {
    create(gl) {
      const { program, uniforms } = createProgram(
        gl,
        FULLSCREEN_VERT,
        SOURCE_HEADER + frag + sourceFooter(options.linear ?? false),
      );
      const target = createRenderTarget(gl, srgbFormat(gl));
      return {
        render(view) {
          target.resize(view.bufferWidth, view.bufferHeight);
          target.bind();
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
          return { texture: target.texture, uvScale: [1, 1], uvOffset: [0, 0] };
        },
        dispose() {
          gl.deleteProgram(program);
          target.dispose();
        },
      };
    },
  };
}
