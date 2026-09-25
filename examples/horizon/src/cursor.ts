import type { InkFilter } from "filmic";

/**
 * The blob's target, drawn as a ring printed in the title's ink. It follows
 * input at the screen's refresh rate: with a mouse it replaces the pointer
 * (a separate ring would trail the real pointer by a frame, which shows), on
 * a touch screen it glides to each tap.
 */
export interface Cursor {
  show(on: boolean): void;
  /** Move to (x, y) in CSS px on the stage; glide there instead of jumping. */
  moveTo(x: number, y: number, glide?: boolean): void;
  /** Pressed down (mouse button held). */
  press(on: boolean): void;
  /** Held by a finger, being dragged: it opens out, to show around it. */
  hold(on: boolean): void;
  destroy(): void;
}

/** `parent` is the stage: positions are relative to its top-left corner. */
export function createCursor(ink: InkFilter, parent: HTMLElement): Cursor {
  // The glow goes on the element around the inked one (see inkFilter).
  const el = document.createElement("div");
  el.className = "cursor";
  el.style.filter = ink.glow;
  el.setAttribute("aria-hidden", "true");
  const mark = document.createElement("div");
  mark.className = "cursor-mark";
  mark.style.filter = ink.url;
  el.appendChild(mark);
  parent.appendChild(el);

  return {
    show(on) {
      el.classList.toggle("on", on);
    },
    moveTo(x, y, glide = false) {
      el.classList.toggle("glide", glide);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    },
    press(on) {
      el.classList.toggle("pressed", on);
    },
    hold(on) {
      el.classList.toggle("held", on);
    },
    destroy() {
      el.remove();
    },
  };
}
