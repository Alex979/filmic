/**
 * filmic: a procedural "film footage" look for the web.
 *
 * This file is the library's public API. Everything a site can use is exported
 * from here; anything not exported is an internal detail we're free to change.
 */

export { createFilm } from "./film";
export type { Film, FilmOptions } from "./film";
