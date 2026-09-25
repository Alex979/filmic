import type { Source } from "filmic";

export type Fit = "cover" | "contain" | "fill";

/** One running demo: owns its element (canvas, video…) and makes sources for it. */
export interface DemoInstance {
  /** A source for the demo's content, laid out with `fit`. */
  source(fit: Fit): Source;
  /** Swap in a dropped file. Returns false if the file isn't usable. */
  drop?(file: File): boolean;
  dispose(): void;
}
