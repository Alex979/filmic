import type { FilmOptions, InkOptions } from "filmic";

// The sky's colors are already film's, halation included, so the canvas's
// halation only starts above its brightest (about 0.68): the blob and the
// brightest city lights glow, the sky doesn't. The title's ink glows too.
export const HORIZON_FILM = { halation: { threshold: 0.78 } } satisfies FilmOptions;
export const HORIZON_INK = { halation: 0.4 } satisfies Partial<InkOptions>;
