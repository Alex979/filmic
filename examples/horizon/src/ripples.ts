import type { Film, InkFilter } from "filmic";

/**
 * Ripples where the screen is pressed: a ring printed in the title's ink,
 * spreading and fading, with a smaller one just behind it. They're animation,
 * not input, so they step with the footage (see film.sync).
 */
export interface Ripples {
  /** A ripple at (x, y), in CSS px on the stage. */
  at(x: number, y: number): void;
  destroy(): void;
}

/** How long a ripple lasts (ms), with room for its echo (see index.css). */
const LIFE = 1100;

/** `parent` is the stage: positions are relative to its top-left corner. */
export function createRipples(film: Film, ink: InkFilter, parent: HTMLElement): Ripples {
  const layer = document.createElement("div");
  layer.className = "ripples";
  layer.setAttribute("aria-hidden", "true");
  parent.appendChild(layer);
  const unsync = film.sync(layer);
  const timers = new Set<number>();

  return {
    at(x, y) {
      // The glow goes on the element around the inked one (see inkFilter).
      const ripple = document.createElement("div");
      ripple.className = "ripple";
      ripple.style.left = `${x.toFixed(1)}px`;
      ripple.style.top = `${y.toFixed(1)}px`;
      ripple.style.filter = ink.glow;
      for (const kind of ["ripple-ring", "ripple-ring echo"]) {
        const ring = document.createElement("div");
        ring.className = kind;
        ring.style.filter = ink.url;
        ripple.appendChild(ring);
      }
      layer.appendChild(ripple);
      const timer = window.setTimeout(() => {
        ripple.remove();
        timers.delete(timer);
      }, LIFE);
      timers.add(timer);
    },
    destroy() {
      timers.forEach((t) => clearTimeout(t));
      unsync();
      layer.remove();
    },
  };
}
