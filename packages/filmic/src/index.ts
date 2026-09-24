/**
 * filmic: a procedural "film footage" look for the web.
 *
 * This file is the library's public API. Everything a site can use is exported
 * from here; anything not exported is an internal detail we're free to change.
 */

export { createFilm } from "./createFilm";
export type { Film, FilmOptions } from "./createFilm";

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
