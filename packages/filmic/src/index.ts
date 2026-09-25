/**
 * filmic: a procedural "film footage" look for the web.
 *
 * This file is the library's public API. Everything a site can use is exported
 * from here; anything not exported is an internal detail we're free to change.
 */

export { createFilm } from "./createFilm";
export type { Film, FilmOptions, FilmUpdate } from "./createFilm";
export type { FilmSettings } from "./film/filmPass";

export { DEFAULT_FRAME, fitRect, resolveFrame } from "./film/frame";
export type { FrameOptions, FrameFit, Rect } from "./film/frame";
export { DEFAULT_OPTICS } from "./film/optics";
export type { OpticsOptions } from "./film/optics";
export { DEFAULT_MOTTLE } from "./film/mottle";
export type { MottleOptions } from "./film/mottle";
export { DEFAULT_GRAIN } from "./film/grain";
export type { GrainOptions } from "./film/grain";
export { DEFAULT_DUST, layoutDust, layoutFootageDust } from "./film/dust";
export type { DustOptions } from "./film/dust";
export {
  DEFAULT_FOOTAGE,
  footageFrame,
  frameIndex,
  frameStart,
} from "./film/footage";
export type { FootageFrame, FootageOptions } from "./film/footage";

export { hexToRgb, hexToLinear, srgbToLinear } from "./core/color";
export type { Hex } from "./core/color";

export { shaderSource } from "./source";
export type {
  Source,
  SourceContext,
  SourceInstance,
  SourceFrame,
  View,
  SetUniforms,
} from "./source";

export { elementSource } from "./sources/elementSource";
export type {
  ElementSourceOptions,
  FilmableElement,
} from "./sources/elementSource";
export { testPattern } from "./sources/testPattern";

export { inkFilter, DEFAULT_INK } from "./dom/inkFilter";
export type { InkFilter, InkOptions } from "./dom/inkFilter";
export type { AttachOptions, FrameEvent, FrameListener } from "./dom/sync";
