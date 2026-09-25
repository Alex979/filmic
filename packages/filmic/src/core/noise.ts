import { createProgram, FULLSCREEN_VERT, type Uniforms } from "./gl";

/**
 * GLSL random-number helpers shared by the texture generators (grain, mottle).
 */
export const NOISE_GLSL = /* glsl */ `
// PCG-style integer hash: good-quality randomness with no visible patterns.
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

// Three uniform randoms in 0..1 for texel p of a tileable texture of size n.
vec3 rand3(ivec2 p, int n, uint seed, uint stream) {
  p = (p % n + n) % n; // wrap, so the texture tiles seamlessly
  return vec3(pcg3d(uvec3(p, seed * 8u + stream))) / 4294967296.;
}

// Two independent standard normals from two uniforms (Box-Muller).
vec2 normals(vec2 u) {
  float r = sqrt(-2. * log(max(u.x, 1e-7)));
  return r * vec2(cos(6.2831853 * u.y), sin(6.2831853 * u.y));
}
`;

/**
 * A tileable, mipmapped RGBA8 texture filled by a fragment shader, for noise
 * that's generated once (and again only when its settings change).
 */
export interface GeneratedTexture {
  readonly texture: WebGLTexture;
  /** Run the generator. `setUniforms` passes in its settings. */
  generate(setUniforms: (uniforms: Uniforms) => void): void;
  dispose(): void;
}

export function createGeneratedTexture(
  gl: WebGL2RenderingContext,
  frag: string,
  size: number,
): GeneratedTexture {
  const { program, uniforms } = createProgram(gl, FULLSCREEN_VERT, frag);

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, Math.log2(size) + 1, gl.RGBA8, size, size);
  // Mipmaps: where the noise is finer than a screen pixel, the GPU averages it
  // down instead of aliasing (the same thing a display would do physically).
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );

  return {
    texture,
    generate(setUniforms) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, size, size);
      gl.useProgram(program);
      setUniforms(uniforms);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    },
  };
}
