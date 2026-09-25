import { hexToRgb, type Hex } from "../core/color";
import { fitRect, type Rect } from "../film/frame";
import { shaderSource, type Source } from "../source";

/** Anything the browser can upload to a texture that filmic can film. */
export type FilmableElement =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap;

export interface ElementSourceOptions {
  /**
   * How the element is laid onto the canvas, like CSS object-fit: "cover"
   * fills the canvas (cropping), "contain" shows all of it (with bars), "fill"
   * stretches it. Default "cover".
   */
  fit?: "cover" | "contain" | "fill";
  /** Where it's pinned when it doesn't match, like object-position. Default centered. */
  anchor?: [number, number];
  /** Color of the bars around a contained element, and behind transparent pixels. Default "#000". */
  background?: Hex;
  /**
   * Redraw every frame, for canvases animated by their own loop (2D, p5, Pixi,
   * Three…). Without it, call `film.render()` after drawing to the canvas.
   * Videos redraw on their own whenever they have a new frame.
   *
   * WebGL canvases need `preserveDrawingBuffer: true`, or the browser may clear
   * them before filmic reads them.
   */
  live?: boolean;
}

/**
 * Film an existing image, video or canvas. The element doesn't need to be on
 * the page; it's copied into a texture whenever it may have changed.
 *
 * Images and videos from another origin need CORS (`crossOrigin="anonymous"`
 * and the right server headers), or the browser won't let WebGL read them.
 */
export function elementSource(
  element: FilmableElement,
  options: ElementSourceOptions = {},
): Source {
  const fit = options.fit ?? "cover";
  const anchor = options.anchor ?? [0.5, 0.5];
  const background = hexToRgb(options.background ?? "#000");

  return {
    create(gl, context) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Mipmaps, so a big element shown small doesn't shimmer or alias.
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      let uploaded = false; // does the texture hold anything yet?
      let stale = true; // may the element have changed since the last upload?
      let rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

      const upload = () => {
        const [w, h] = elementSize(element);
        if (!w || !h) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Keep rows top-first (the shader flips) and premultiply, so
        // transparent pixels blend cleanly with the background.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          element,
        );
        gl.generateMipmap(gl.TEXTURE_2D);
        uploaded = true;
        stale = false;
      };

      // --- When to re-upload ---
      // Images and videos fire events when they change. Canvases can change at
      // any time without telling anyone, so they're re-read on every draw.
      const image = element instanceof HTMLImageElement ? element : null;
      const video = element instanceof HTMLVideoElement ? element : null;
      const media = image ?? video;
      const alwaysStale =
        !media &&
        !(typeof ImageBitmap !== "undefined" && element instanceof ImageBitmap);
      const changed = () => {
        stale = true;
        context.requestRender();
      };
      const events = image ? ["load"] : video ? ["loadeddata", "seeked", "resize"] : [];
      for (const e of events) media?.addEventListener(e, changed);

      // Videos: redraw once per new video frame (not per screen refresh).
      let videoCallback = 0;
      let disposed = false;
      const onVideoFrame = () => {
        if (disposed || !video) return;
        changed();
        videoCallback = video.requestVideoFrameCallback(onVideoFrame);
      };
      const hasFrameCallback =
        video && "requestVideoFrameCallback" in HTMLVideoElement.prototype;
      if (video && hasFrameCallback)
        videoCallback = video.requestVideoFrameCallback(onVideoFrame);

      const place = shaderSource(
        /* glsl */ `
uniform sampler2D uImage;
uniform vec4 uRect;         // where the element sits, in CSS px: x, y, width, height
uniform vec3 uBackground;
uniform bool uHasImage;

void main() {
  vec2 px = filmPx();
  // 0..1 across the element, y down: matches the texture's top-first rows.
  vec2 t = (px - uRect.xy) / uRect.zw;
  vec4 c = uHasImage ? texture(uImage, t) : vec4(0.);

  // How much of this pixel the element covers, so its edges are antialiased
  // where it meets the bars.
  vec2 inside = min(px - uRect.xy, uRect.xy + uRect.zw - px) * uPixelRatio;
  float coverage = clamp(min(inside.x, inside.y) + .5, 0., 1.);

  vec3 rgb = c.rgb + uBackground * (1. - c.a); // premultiplied "over"
  fragColor = vec4(mix(uBackground, rgb, coverage), 1.);
}`,
        (gl, u) => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.uniform1i(u.uImage, 0);
          gl.uniform4f(u.uRect, rect.x, rect.y, rect.width, rect.height);
          gl.uniform3f(u.uBackground, ...background);
          gl.uniform1i(u.uHasImage, uploaded ? 1 : 0);
        },
      ).create(gl, context);

      return {
        render(view) {
          if (alwaysStale || stale || (video && !hasFrameCallback)) upload();
          if (options.live || (video && !hasFrameCallback && !video.paused))
            context.requestRender();

          const [w, h] = elementSize(element);
          rect =
            w && h
              ? fitRect(view.width, view.height, w / h, fit, anchor)
              : { x: 0, y: 0, width: view.width, height: view.height };

          return { ...place.render(view), rect };
        },
        dispose() {
          disposed = true;
          for (const e of events) media?.removeEventListener(e, changed);
          if (video && hasFrameCallback)
            video.cancelVideoFrameCallback(videoCallback);
          place.dispose();
          gl.deleteTexture(texture);
        },
      };
    },
  };
}

/** The element's own size in pixels, or [0, 0] if it isn't ready yet. */
function elementSize(element: FilmableElement): [number, number] {
  if (element instanceof HTMLImageElement)
    return element.complete ? [element.naturalWidth, element.naturalHeight] : [0, 0];
  if (element instanceof HTMLVideoElement)
    return element.readyState >= element.HAVE_CURRENT_DATA
      ? [element.videoWidth, element.videoHeight]
      : [0, 0];
  return [element.width, element.height];
}
