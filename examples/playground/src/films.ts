import type { Film, FilmUpdate } from "filmic";

/**
 * Every film on the page, so one tuning panel can drive all of them. Films
 * that mount later start from whatever the panel is currently set to.
 */
const films = new Set<Film>();
let shared: Omit<FilmUpdate, "source"> = {};

export function addFilm(film: Film) {
  film.set(shared);
  films.add(film);
  return () => {
    films.delete(film);
  };
}

export function setAll(update: Omit<FilmUpdate, "source">) {
  shared = {
    frame: { ...shared.frame, ...update.frame },
    optics: { ...shared.optics, ...update.optics },
    mottle: { ...shared.mottle, ...update.mottle },
    grain: { ...shared.grain, ...update.grain },
    dust: { ...shared.dust, ...update.dust },
  };
  films.forEach((film) => film.set(update));
}
