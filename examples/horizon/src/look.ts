import type { FilmOptions, InkOptions } from "filmic";

// The sky's colors are already film's, halation included, so the canvas's
// halation only starts above its brightest (about 0.68): the blob and the
// brightest city lights glow, the sky doesn't. The title's ink glows too.
// Half the default lens blur: the full amount reads as out of focus here.
export const HORIZON_FILM = {
  optics: { blur: 0.5 },
  halation: { threshold: 0.78 },
} satisfies FilmOptions;
// Ink softness is for the title at full size; the subheading's smaller
// letters take less, and both ease off as the title shrinks (see inks.ts).
export const HORIZON_INK = { halation: 0.4, softness: 0.7 } satisfies Partial<InkOptions>;
export const SUBTITLE_SOFTNESS = 0.55;
