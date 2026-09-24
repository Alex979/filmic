/**
 * Small WebGL2 helpers shared by every pass.
 */

export type Uniforms = Record<string, WebGLUniformLocation>;

export interface Program {
  program: WebGLProgram;
  /** Uniform locations by name (array uniforms are listed without "[0]"). */
  uniforms: Uniforms;
}

/**
 * Vertex shader for a full-screen pass. It draws a single triangle big enough
 * to cover the whole viewport, with positions derived from gl_VertexID, so it
 * needs no vertex buffer at all: just `gl.drawArrays(gl.TRIANGLES, 0, 3)`.
 *
 *   (-1, 3)
 *     |\
 *     |  \
 *     |____\______
 *     |    |  \
 *     |    |    \      the viewport is the square from (-1,-1) to (1,1);
 *     |____|______\    the rest of the triangle is clipped away
 *  (-1,-1)       (3,-1)
 */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): Program {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`filmic: shader failed to compile\n${log}`);
    }
    return shader;
  };

  const vert = compile(gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  // Once linked, the program keeps what it needs; the shader objects can go.
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(
      `filmic: program failed to link\n${gl.getProgramInfoLog(program)}`,
    );
  }

  const uniforms: Uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(
      program,
      info.name,
    )!;
  }
  return { program, uniforms };
}
