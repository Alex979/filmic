/**
 * A render target: a texture with a framebuffer attached, so a pass can draw
 * into the texture instead of the screen, and a later pass can read it back.
 */
export interface RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
  /** Reallocate to a new size (no-op if unchanged). Contents are lost. */
  resize(width: number, height: number): void;
  /** Bind the framebuffer and set the viewport to cover it. */
  bind(): void;
  dispose(): void;
}

/** Storage for a render target's texels. */
export interface TargetFormat {
  internalFormat: number;
  format: number;
  type: number;
}

/**
 * 8-bit sRGB storage for pictures. Shaders read and write linear light; the
 * GPU encodes on write and decodes on read, so texels keep sRGB's precision
 * in the shadows, and sampling between texels blends in linear light. Both
 * without any conversion in the shader.
 */
export function srgbFormat(gl: WebGL2RenderingContext): TargetFormat {
  return { internalFormat: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

/**
 * Half-float storage, for passes whose faint values would band in 8 bits (e.g.
 * glows in linear light), or null if this device can't render to it.
 */
export function halfFloatFormat(gl: WebGL2RenderingContext): TargetFormat | null {
  if (!gl.getExtension("EXT_color_buffer_float")) return null;
  return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  storage: TargetFormat = {
    internalFormat: gl.RGBA8,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  },
): RenderTarget {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // LINEAR so later passes can sample between pixels (blur, halation);
  // CLAMP so samples just past the edge repeat the edge instead of wrapping.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer()!;
  let width = 0;
  let height = 0;

  const target: RenderTarget = {
    texture,
    framebuffer,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        storage.internalFormat,
        w,
        h,
        0,
        storage.format,
        storage.type,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
    },
    bind() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
  };
  return target;
}
