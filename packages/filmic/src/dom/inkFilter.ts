/**
 * Ink: the "printed on film" look for DOM elements (text, logos, boxes), as an
 * SVG filter the browser applies itself.
 *
 * The element stays real DOM: selection, find-in-page highlights, the text
 * cursor and editing all keep working, and get the same treatment as the
 * element, because the browser filters everything it paints for it.
 *
 * What the filter does:
 *   1. fractal noise pushes the edges around a little (ink bleeding)
 *   2. a small blur softens them (slightly out of focus)
 *   3. alpha is boosted to firm the softened edge back up
 *   4. a second noise field, thresholded, punches pinholes through the ink
 *
 * Sizes are in CSS px, because the browser applies the filter in the
 * element's own coordinates.
 *
 * Browsers skip the filter on an element with zero width or height, so an
 * editable element that can be emptied should keep some size (e.g. padding),
 * or its text cursor shows unfiltered.
 */
export interface InkOptions {
  /** How far noise pushes edges around, in CSS px. 0 = clean edges. */
  roughness: number;
  /** Blur, in CSS px. */
  softness: number;
  /** Opacity boost after the blur, to firm the edges back up. 1 = none. */
  firmness: number;
  /** Pinholes through the ink: 0 = none, higher = more and larger. */
  pinholes: number;
  /** Changes the noise pattern. Footage mode changes it every frame. */
  seed: number;
}

/** Defaults matching a hand-tuned reference title. */
export const DEFAULT_INK: InkOptions = {
  roughness: 0.6,
  softness: 0.7,
  firmness: 1.14,
  pinholes: 0.175,
  seed: 0,
};

export interface InkFilter {
  /** The filter's element id. */
  readonly id: string;
  /**
   * The CSS / SVG filter value, `url(#id)`. Use it as `element.style.filter`,
   * or an SVG element's `filter` attribute.
   */
  readonly url: string;
  /** Current options. */
  readonly options: Readonly<InkOptions>;
  /** Change options; elements using the filter update right away. */
  set(options: Partial<InkOptions>): void;
  /**
   * Footage frame to show: shifts the noise per frame, on top of `seed`, so
   * edges and pinholes boil like print on moving film. 0 = still. Usually
   * driven by `film.attach()`.
   */
  setFrame(n: number): void;
  /** Remove the filter from the page. */
  destroy(): void;
}

const SVG = "http://www.w3.org/2000/svg";
let count = 0;

/**
 * Create an ink filter and add it to the page (in a hidden <svg>). Any number
 * of elements can share one. Pass an `id` to reference it from markup or CSS
 * before it exists (e.g. `filter: url(#title-ink)`); otherwise one is made up.
 */
export function inkFilter(
  options: Partial<InkOptions> = {},
  id = `filmic-ink-${++count}`,
): InkFilter {
  let current: InkOptions = { ...DEFAULT_INK, ...options };
  let frame = 0;

  const el = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>,
    parent: Element,
  ) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    parent.appendChild(node);
    return node;
  };

  // A 0x0 <svg> that only holds the filter definition.
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";

  const filter = el(
    "filter",
    // A bit of room around the element, for edges pushed outward.
    { id, x: "-4%", y: "-15%", width: "108%", height: "130%", "color-interpolation-filters": "sRGB" },
    el("defs", {}, svg),
  );
  const edgeNoise = el(
    "feTurbulence",
    { type: "fractalNoise", baseFrequency: 0.9, numOctaves: 2, result: "n" },
    filter,
  );
  const displace = el(
    "feDisplacementMap",
    { in: "SourceGraphic", in2: "n", xChannelSelector: "R", yChannelSelector: "G", result: "rough" },
    filter,
  );
  const blur = el("feGaussianBlur", { in: "rough", result: "soft" }, filter);
  const firm = el(
    "feFuncA",
    { type: "linear", intercept: 0 },
    el("feComponentTransfer", { in: "soft", result: "ink" }, filter),
  );
  const holeNoise = el(
    "feTurbulence",
    { type: "fractalNoise", baseFrequency: 0.75, numOctaves: 2, result: "s" },
    filter,
  );
  // Alpha = threshold - 8 * noise: bright spots of noise become transparent.
  const holes = el("feColorMatrix", { in: "s", type: "matrix", result: "holes" }, filter);
  el("feComposite", { in: "ink", in2: "holes", operator: "in" }, filter);

  const apply = () => {
    const o = current;
    const seed = Math.max(0, Math.floor(o.seed)) + (frame % 997);
    edgeNoise.setAttribute("seed", String(4 + seed));
    holeNoise.setAttribute("seed", String(12 + seed));
    displace.setAttribute("scale", String(o.roughness));
    blur.setAttribute("stdDeviation", String(o.softness));
    firm.setAttribute("slope", String(o.firmness));
    const threshold = 8 * (1 - o.pinholes);
    holes.setAttribute(
      "values",
      `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -8 0 0 0 ${threshold}`,
    );
  };
  apply();
  document.body.appendChild(svg);

  return {
    id,
    url: `url(#${id})`,
    get options() {
      return { ...current };
    },
    set(options) {
      current = { ...current, ...options };
      apply();
    },
    setFrame(n) {
      const next = Math.max(0, Math.floor(n));
      if (next === frame) return;
      frame = next;
      apply();
    },
    destroy() {
      svg.remove();
    },
  };
}
