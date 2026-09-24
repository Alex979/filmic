/**
 * filmic: a procedural "film footage" look for the web.
 *
 * This file is the library's public API. Everything a site can use is exported
 * from here; anything not exported is an internal detail we're free to change.
 */

export { createFilm } from "./createFilm";
export type { Film, FilmOptions, FilmUpdate } from "./createFilm";
export type { FilmSettings } from "./film/filmPass";

export { DEFAULT_FRAME, resolveFrame } from "./film/frame";
export type { FrameOptions, FrameFit, Rect } from "./film/frame";
export { DEFAULT_OPTICS } from "./film/optics";
export type { OpticsOptions } from "./film/optics";
export { DEFAULT_GRAIN } from "./film/grain";
export type { GrainOptions } from "./film/grain";

export { shaderSource } from "./source";
export type {
  Source,
  SourceInstance,
  SourceFrame,
  View,
  SetUniforms,
} from "./source";

export {
  horizonGradient,
  horizonCircle,
  DEFAULT_HORIZON_STOPS,
} from "./sources/horizonGradient";
export type {
  HorizonGradientOptions,
  HorizonStop,
  Circle,
} from "./sources/horizonGradient";
export { testPattern } from "./sources/testPattern";
