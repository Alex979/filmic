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
 *   4. another channel of the same noise, thresholded, punches pinholes
 *      through the ink
 *
 * The noise is one feTurbulence with one octave. It's recomputed every time
 * the ink boils, and Safari computes it pixel by pixel on the CPU, so it's
 * the filter's main cost on phones. Two octaves or a second turbulence cost
 * several times as much for detail too fine to see; their strength is made
 * up for below.
 *
 * Halation, the warm glow film gives bright highlights, is separate: CSS
 * drop-shadow() glows (`ink.glow`) for the element *around* the inked one,
 * e.g. `<p style="filter: var(--id-glow)"><span style="filter: url(#id)">`.
 * Safari needs the two apart: it clips drop-shadow() to the SVG filter's
 * region when both are on one element, and ignores it on SVG elements (so
 * SVG text gets its glow from an HTML parent). The glowing element can
 * animate opacity and transform freely; a glow on an ancestor of an
 * animating element wouldn't reach it in Safari while it animates.
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
  /**
   * Halation: a warm glow around the ink, for light ink. 0 = none. Applied
   * with `glow`, on the element around the inked one.
   */
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
   * The ink's halation glow as a CSS filter value, `var(--id-glow)`. Put it
   * on the element directly around the inked one, not on the inked element
   * itself (see above). The custom property is set on the page's root element
   * and follows `set()`, so stylesheets can use `var(--id-glow)` too.
   */
  readonly glow: string;
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

// One octave of noise varies less than the two the look was tuned with; these
// scale it back up (measured spreads: edges 0.117 / 0.104, pinholes, which
// used their own noise at 0.75, 0.122 / 0.104).
const EDGE_GAIN = 1.118;
const HOLE_GAIN = 1.17;
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
  const noise = el(
    "feTurbulence",
    { type: "fractalNoise", baseFrequency: 0.9, numOctaves: 1, result: "n" },
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
  // Alpha = threshold - 8 * noise (the noise's alpha channel, independent of
  // the R and G the edges use): bright spots become transparent.
  const holes = el("feColorMatrix", { in: "n", type: "matrix", result: "holes" }, filter);
  el("feComposite", { in: "ink", in2: "holes", operator: "in" }, filter);

  const apply = () => {
    const o = current;
    const seed = Math.max(0, Math.floor(o.seed)) + (frame % 997);
    noise.setAttribute("seed", String(4 + seed));
    displace.setAttribute("scale", String(o.roughness * EDGE_GAIN));
    blur.setAttribute("stdDeviation", String(o.softness));
    firm.setAttribute("slope", String(o.firmness));
    // The noise around 0.5, scaled by HOLE_GAIN: alpha = -8 * (0.5 + gain *
    // (noise - 0.5)) + threshold.
    const threshold = 8 * (1 - o.pinholes) + 4 * HOLE_GAIN - 4;
    holes.setAttribute(
      "values",
      `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-8 * HOLE_GAIN} ${threshold}`,
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
      return `drop-shadow(0 0 ${(blur * o.halationRadius).toFixed(2)}px rgb(${r} ${g} ${b} / ${a}))`;
    };
    return [shadow(0.21, 0.45, 0.1), shadow(0.71, 0.5), shadow(2, 0.45)].join(" ");
  };
  // With no glow the property still holds a filter that does nothing, so a
  // filter list that includes var(--id-glow) stays valid.
  const property = `--${id}-glow`;
  const publish = () =>
    document.documentElement.style.setProperty(
      property,
      glow(current) || "opacity(1)",
    );

  apply();
  publish();
  document.body.appendChild(svg);

  return {
    id,
    url: `url(#${id})`,
    glow: `var(${property})`,
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
