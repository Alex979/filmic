import type { FilmOptions, InkOptions } from "filmic";

// The background's colors are already film's, halation included, so the
// canvas adds none (the panel can turn it on). The title's ink glows instead.
export const HORIZON_FILM = { halation: { amount: 0 } } satisfies FilmOptions;
export const HORIZON_INK = { halation: 1 } satisfies Partial<InkOptions>;
