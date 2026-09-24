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

export function createRenderTarget(gl: WebGL2RenderingContext): RenderTarget {
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
        gl.RGBA8,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
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
