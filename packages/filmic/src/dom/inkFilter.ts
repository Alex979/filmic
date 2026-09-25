import { hexToRgb, type Hex } from "../core/color";

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
 * Halation, the warm glow film gives bright highlights, is added after the
 * filter as CSS drop-shadow() glows: unlike the SVG filter, CSS filter
 * functions grow the painted area as far as they need, so the glow is never
 * cut off at the edge of the element. It's part of `ink.filter`, not
 * `ink.url`.
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
  /** Halation: a warm glow around the ink, for light ink. 0 = none. */
  halation: number;
  /** How far the glow reaches, in CSS px. */
  halationRadius: number;
  /** Color of the glow, "#rrggbb". */
  halationColor: Hex;
}

/** Defaults: a subtle printed look for display-size text. */
export const DEFAULT_INK: InkOptions = {
  roughness: 0.6,
  softness: 0.7,
  firmness: 1.14,
  pinholes: 0.175,
  seed: 0,
  halation: 0,
  halationRadius: 14,
  halationColor: "#ff6230",
};

export interface InkFilter {
  /** The filter's element id. */
  readonly id: string;
  /**
   * The CSS / SVG filter value, `url(#id)`. Use it as `element.style.filter`,
   * or an SVG element's `filter` attribute.
   */
  readonly url: string;
  /**
   * The full CSS filter value: the ink plus its halation glow, as
   * `var(--id)`. The custom property is set on the page's root element and
   * follows `set()`, so in a stylesheet `filter: var(--title-ink)` works too.
   */
  readonly filter: string;
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
  // The halation: a bright rim, a soft glow and a wide tail, each glowing off
  // the ones before it. CSS blends glows in sRGB, where a faint tail looks
  // much dimmer than the same light blended in linear (as the canvas does),
  // so it takes three layers to get film's long, luminous falloff. The rim is
  // a little lighter, like the hot edge of real halation.
  const glow = (o: InkOptions) => {
    if (o.halation <= 0 || o.halationRadius <= 0) return "";
    const rgb = hexToRgb(o.halationColor);
    const shadow = (blur: number, alpha: number, light = 0) => {
      const [r, g, b] = rgb.map((v) => Math.round((v + (1 - v) * light) * 255));
      const a = Math.min(1, alpha * o.halation).toFixed(3);
      // CSS blur lengths are two standard deviations.
      return ` drop-shadow(0 0 ${(blur * o.halationRadius).toFixed(2)}px rgb(${r} ${g} ${b} / ${a}))`;
    };
    return shadow(0.21, 0.45, 0.1) + shadow(0.71, 0.5) + shadow(2, 0.45);
  };
  const property = `--${id}`;
  const publish = () =>
    document.documentElement.style.setProperty(
      property,
      `url(#${id})${glow(current)}`,
    );

  apply();
  publish();
  document.body.appendChild(svg);

  return {
    id,
    url: `url(#${id})`,
    filter: `var(${property})`,
    get options() {
      return { ...current };
    },
    set(options) {
      current = { ...current, ...options };
      apply();
      publish();
    },
    setFrame(n) {
      const next = Math.max(0, Math.floor(n));
      if (next === frame) return;
      frame = next;
      apply();
    },
    destroy() {
      svg.remove();
      document.documentElement.style.removeProperty(property);
    },
  };
}
