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
 * The noise is one feTurbulence with one octave. Safari computes it pixel by
 * pixel on the CPU every time it paints the filter (an inked element
 * scrolling into view, a redraw), so it's the filter's main cost on phones.
 * Two octaves or a second turbulence cost several times as much for detail
 * too fine to see; their strength is made up for below.
 *
 * So while the ink holds still, the filter doesn't compute the noise: it
 * tiles an image of it, rendered once (the same turbulence, made to tile
 * seamlessly), which cut the paint time of a page of inked text to about a
 * third on an iPhone. Until that image is ready, and while the ink boils
 * (`setFrame`, a new pattern every footage frame), the filter computes the
 * noise live instead.
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
   * Halation: a warm glow around the ink, for light ink. 0 = none. On the
   * same scale as the canvas halation's `amount` (default 0.4). Applied with
   * `glow`, on the element around the inked one.
   */
  halation: number;
  /** How far the glow reaches, in CSS px. */
  halationRadius: number;
  /** Color of the glow, "#rrggbb". */
  halationColor: Hex;
  /**
   * The glow's widest layer, its long tail. "auto" leaves it out on screens
   * with 2.5 or more device pixels per CSS px: a blur costs the CPU about the
   * square of its radius in device pixels, so at 3x the tail is most of the
   * glow's paint cost, while at that density it barely shows.
   */
  halationTail: boolean | "auto";
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
  halationTail: "auto",
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
   * and follows `set()`, so stylesheets can use `var(--id-glow)` too (with
   * the id escaped, if it isn't a CSS identifier).
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

const FREQUENCY = 0.9;
// The noise tile's size, in CSS px. A whole number of noise periods fits
// across it (250 * 0.9 = 225), so tiling it seamlessly doesn't need to nudge
// the frequency.
const TILE = 250;
// Device pixels per CSS px from which an "auto" halation tail is left out.
const TAIL_RATIO = 2.5;

// One octave of noise varies less than the two the look was tuned with; these
// scale it back up (measured spreads: edges 0.117 / 0.104, pinholes, which
// used their own noise at 0.75, 0.122 / 0.104).
const EDGE_GAIN = 1.118;
const HOLE_GAIN = 1.17;
let count = 0;

// Noise tiles, shared by every filter with the same seed and pixel ratio, as
// object URLs of PNGs.
interface Tile {
  key: string;
  url: Promise<string>;
  users: number;
}
const tiles = new Map<string, Tile>();

const tileKey = (seed: number, ratio: number) => `${seed}@${ratio}`;

function holdTile(seed: number, ratio: number): Tile {
  const key = tileKey(seed, ratio);
  let tile = tiles.get(key);
  if (!tile) {
    const made: Tile = { key, url: renderTile(seed, ratio), users: 0 };
    // A failed render isn't kept, so the next filter to ask tries again.
    made.url.catch(() => {
      if (tiles.get(key) === made) tiles.delete(key);
    });
    tiles.set(key, made);
    tile = made;
  }
  tile.users++;
  return tile;
}

function releaseTile(tile: Tile) {
  if (--tile.users > 0) return;
  if (tiles.get(tile.key) === tile) tiles.delete(tile.key);
  tile.url.then(URL.revokeObjectURL, () => {});
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/**
 * Render the ink's noise for `seed` into a PNG, TILE CSS px square at `ratio`
 * device pixels per CSS px, and resolve with its object URL.
 *
 * A canvas stores colors premultiplied by alpha, which would wear away the
 * noise's R and G wherever its alpha is low. The ink doesn't use B, so the
 * tile carries the noise's alpha in B and is opaque; the filter moves it back.
 */
async function renderTile(seed: number, ratio: number): Promise<string> {
  const size = Math.max(1, Math.round(TILE * ratio));
  const svg =
    `<svg xmlns="${SVG}" width="${size}" height="${size}" viewBox="0 0 ${TILE} ${TILE}" preserveAspectRatio="none">` +
    `<filter id="t" filterUnits="userSpaceOnUse" x="0" y="0" width="${TILE}" height="${TILE}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${FREQUENCY}" numOctaves="1" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 0 1 0  0 0 0 0 1"/>` +
    `</filter><rect width="${TILE}" height="${TILE}" filter="url(#t)"/></svg>`;
  const image = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  context.drawImage(image, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (!blob) throw new Error("tile not encoded");
  const url = URL.createObjectURL(blob);
  // Decode it before the filter uses it, so the switch doesn't paint a frame
  // with the image still loading (and no noise).
  try {
    await load(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return url;
}

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
    parent: Node,
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
  // The noise, "n": computed live, or tiled from an image of it (see above).
  // Only one of the two is in the filter at a time.
  const turbulence = el(
    "feTurbulence",
    { type: "fractalNoise", baseFrequency: FREQUENCY, numOctaves: 1, result: "n" },
    filter,
  );
  // The image is placed with only a width and height: its x and y default to
  // the filter region's, so the tile starts at the region's corner wherever
  // the element is in its user space. At a fixed x and y it could miss the
  // region (an SVG element far from its origin), and Safari then drops the
  // element altogether. The corner is where every copy of the tile starts,
  // so whatever part of the tile the browser renders is the part that shows.
  const tiled = document.createDocumentFragment();
  const image = el(
    "feImage",
    { width: TILE, height: TILE, preserveAspectRatio: "none", result: "tile" },
    tiled,
  );
  const tile = el("feTile", { in: "tile", result: "tiled" }, tiled);
  // Alpha back out of B, where the tile keeps it (see renderTile).
  const unpack = el(
    "feColorMatrix",
    { in: "tiled", type: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 1 0 0", result: "n" },
    tiled,
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

  // The tile this filter holds, and whether it's ready to use. A tile that
  // failed to render stays held, unready, so the filter computes the noise
  // live and tries again only once the seed or pixel ratio changes.
  let held: Tile | null = null;
  let ready = false;
  let ticket = 0;
  let wired = false;
  let destroyed = false;

  // Swap the noise's source in the filter.
  const wire = (fromImage: boolean) => {
    if (fromImage === wired) return;
    wired = fromImage;
    if (fromImage) turbulence.replaceWith(image, tile, unpack);
    else {
      image.before(turbulence);
      tiled.append(image, tile, unpack);
    }
  };

  // Tiles the noise from an image while the ink holds still and the image
  // for its seed and the screen's pixel ratio is ready; otherwise computes it
  // live. A new image is rendered only when the seed or pixel ratio changes,
  // and not while the ink boils.
  const route = () => {
    if (destroyed) return;
    const seed = 4 + Math.max(0, Math.floor(current.seed));
    const ratio = window.devicePixelRatio || 1;
    const key = tileKey(seed, ratio);
    if (frame === 0 && key !== held?.key) {
      wire(false);
      if (held) releaseTile(held);
      held = holdTile(seed, ratio);
      ready = false;
      const mine = ++ticket;
      held.url.then(
        (url) => {
          if (mine !== ticket) return;
          image.setAttribute("href", url);
          ready = true;
          route();
        },
        () => {}, // live noise it is (see held)
      );
    }
    wire(frame === 0 && ready && key === held?.key);
  };

  // Watch for the pixel ratio changing (a zoom, a move to another screen):
  // it changes the noise tile, and the glow when its tail is "auto".
  let media: MediaQueryList | null = null;
  const watch = () => {
    media?.removeEventListener("change", rewatch);
    media = null;
    if (typeof window.matchMedia !== "function") return;
    media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    media.addEventListener("change", rewatch);
  };
  const rewatch = () => {
    watch();
    route();
    publish();
  };

  // The live noise's seed, the one attribute that changes every boil step.
  // The turbulence keeps it while it's out of the filter (tiling), so it's
  // right whenever it's wired back in.
  let seeded = "";
  const applySeed = () => {
    const seed = String(4 + Math.max(0, Math.floor(current.seed)) + (frame % 997));
    if (seed === seeded) return;
    seeded = seed;
    turbulence.setAttribute("seed", seed);
  };
  // Everything else, which only set() changes.
  const apply = () => {
    const o = current;
    applySeed();
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
  // a little lighter, like the hot edge of real halation. The tail is the
  // costly one, and optional (`halationTail`).
  const glow = (o: InkOptions) => {
    if (o.halation <= 0 || o.halationRadius <= 0) return "";
    const rgb = hexToRgb(o.halationColor);
    const shadow = (blur: number, alpha: number, light = 0) => {
      const [r, g, b] = rgb.map((v) => Math.round((v + (1 - v) * light) * 255));
      const a = Math.min(1, alpha * o.halation).toFixed(3);
      // CSS blur lengths are two standard deviations.
      return `drop-shadow(0 0 ${(blur * o.halationRadius).toFixed(2)}px rgb(${r} ${g} ${b} / ${a}))`;
    };
    const layers = [shadow(0.21, 0.45, 0.1), shadow(0.71, 0.5)];
    const tail =
      o.halationTail === "auto" ? (window.devicePixelRatio || 1) < TAIL_RATIO : o.halationTail;
    if (tail) layers.push(shadow(2, 0.45));
    return layers.join(" ");
  };
  // With no glow the property still holds a filter that does nothing, so a
  // filter list that includes var(--id-glow) stays valid. Any id makes a
  // property name, but in var() it has to be escaped (React's useId() ids,
  // like ":r1:", aren't CSS identifiers).
  // Written only when it changes: every element using it restyles.
  const property = `--${id}-glow`;
  let published = "";
  const publish = () => {
    const value = glow(current) || "opacity(1)";
    if (value === published) return;
    published = value;
    document.documentElement.style.setProperty(property, value);
  };

  apply();
  publish();
  document.body.appendChild(svg);
  watch();
  route();

  return {
    id,
    url: `url(#${id})`,
    glow: `var(${CSS.escape(property)})`,
    get options() {
      return { ...current };
    },
    set(options) {
      current = { ...current, ...options };
      apply();
      route();
      publish();
    },
    setFrame(n) {
      const next = Math.max(0, Math.floor(n));
      if (next === frame) return;
      frame = next;
      applySeed();
      route();
    },
    destroy() {
      destroyed = true;
      ticket++;
      media?.removeEventListener("change", rewatch);
      if (held) releaseTile(held);
      held = null;
      svg.remove();
      document.documentElement.style.removeProperty(property);
    },
  };
}
