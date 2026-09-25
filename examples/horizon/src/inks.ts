import { DEFAULT_INK, inkFilter, type InkFilter, type InkOptions } from "filmic";
import { HORIZON_INK, SUBTITLE_SOFTNESS } from "./look";
import { TITLE_FULL_SIZE } from "./Title";

/** Everything the two inks share, and each one's softness at full size. */
export type InksOptions = InkOptions & { subtitleSoftness: number };

export interface Inks {
  /** The title's ink. The cursor and ripples print in it too. */
  readonly title: InkFilter;
  /** The subheading's. */
  readonly subtitle: InkFilter;
  /** Current options; `softness` is the title's at full size. */
  readonly options: Readonly<InksOptions>;
  set(options: Partial<InksOptions>): void;
  /** The title's font size, in CSS px, to soften for. */
  setSize(size: number): void;
  destroy(): void;
}

/**
 * The title's and subheading's inks. Softness is in CSS px, so a blur that
 * suits big letters swamps small ones: the subheading's, and the title's on a
 * narrow screen. So each ink has its own softness at full size, and both
 * scale with the square root of the title's size (fit to what looked right
 * on a wide screen and a phone).
 */
export function createInks(titleId: string, subtitleId: string): Inks {
  let current: InksOptions = {
    ...DEFAULT_INK,
    ...HORIZON_INK,
    subtitleSoftness: SUBTITLE_SOFTNESS,
  };
  let size = TITLE_FULL_SIZE;
  const title = inkFilter({}, titleId);
  const subtitle = inkFilter({}, subtitleId);

  const apply = () => {
    const { subtitleSoftness, ...shared } = current;
    const scale = Math.sqrt(size / TITLE_FULL_SIZE);
    title.set({ ...shared, softness: shared.softness * scale });
    subtitle.set({ ...shared, softness: subtitleSoftness * scale });
  };
  apply();

  return {
    title,
    subtitle,
    get options() {
      return { ...current };
    },
    set(options) {
      current = { ...current, ...options };
      apply();
    },
    setSize(next) {
      if (next === size || !(next > 0)) return;
      size = next;
      apply();
    },
    destroy() {
      title.destroy();
      subtitle.destroy();
    },
  };
}
