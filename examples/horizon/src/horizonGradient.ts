import type { Hex } from "filmic";

/**
 * A planet's horizon at sunset, seen from high up.
 *
 * Color depends on two things: how far a pixel is above the curved horizon,
 * and where it is along it (the glow is brighter and more golden on the left,
 * dimmer and redder on the right). Both are measured in "frame heights": the
 * scene is laid out as if it were a photo placed over the screen, so the glow
 * band keeps its proportions at any window size.
 */

/**
 * One row of the color table: a height above the horizon (in frame heights;
 * negative is on the planet), and its color at five points along the horizon,
 * from the left end of the arc to the right.
 */
export type HorizonRow = [height: number, colors: [Hex, Hex, Hex, Hex, Hex]];

/**
 * 24 heights, placed where the colors change fastest, by 5 points along the
 * horizon, blended linearly in linear light. It holds the broad shape of the
 * sunset; cloud-like texture along the horizon would need more than a smooth
 * table.
 */
export const HORIZON_TABLE: HorizonRow[] = [
  // the planet: near-black, warming toward the rim
  [-0.55468, ["#010101", "#000101", "#000101", "#000101", "#010101"]],
  [-0.48315, ["#0a0705", "#15120e", "#110f0d", "#120f0d", "#09080c"]],
  [-0.10021, ["#181210", "#1b1717", "#1d1716", "#1f1816", "#1f1815"]],
  [-0.01881, ["#301c1a", "#311d1c", "#2d1a1a", "#2d1b1b", "#2b1a19"]],
  [-0.00956, ["#4c231b", "#512a22", "#4a241e", "#47221b", "#46211a"]],
  [-0.00462, ["#733223", "#80372b", "#772d24", "#642920", "#62251e"]],
  // the rim and the glow: red, orange, then peach
  [0.0, ["#a14023", "#ad452d", "#ac3a29", "#9d3324", "#872d23"]],
  [0.00462, ["#bd5224", "#d55c31", "#d94b2a", "#c53d25", "#b63d29"]],
  [0.00586, ["#ca5c2a", "#db6131", "#dd4e2a", "#c94227", "#a92e1a"]],
  [0.00647, ["#c65725", "#dc6332", "#de522b", "#c94225", "#b73e28"]],
  [0.01634, ["#dc792e", "#e07a31", "#c55325", "#bd4925", "#b64427"]],
  [0.02436, ["#e08531", "#dc8438", "#cf692e", "#ca6029", "#cb5e2f"]],
  [0.03792, ["#d68d38", "#e09958", "#e7984f", "#d6793a", "#c36434"]],
  [0.04409, ["#e6a653", "#e0a264", "#e19959", "#cc793d", "#bf693c"]],
  // dusty lavender into the blue sky
  [0.08911, ["#b99e90", "#b89e99", "#a78d8f", "#a3796d", "#906960"]],
  [0.13351, ["#a299b4", "#9c99b1", "#8d8fad", "#848094", "#686778"]],
  [0.18777, ["#7392c1", "#7391bb", "#6c8db4", "#6c84a5", "#687c95"]],
  [0.2223, ["#708db8", "#7292ba", "#6e8eb5", "#6c88a9", "#6f88a1"]],
  [0.2482, ["#7496b8", "#6990b6", "#6790b6", "#5c82ab", "#557ca2"]],
  [0.29383, ["#4a7aa6", "#4679a7", "#4778a8", "#3f6f9c", "#43709a"]],
  // fading to night at the top
  [0.33762, ["#2b547a", "#2b577f", "#2c547c", "#2c5175", "#31597e"]],
  [0.38757, ["#1f3752", "#1b3451", "#1b3049", "#1c3046", "#223750"]],
  [0.4332, ["#1b2837", "#162234", "#151f2c", "#151e28", "#19212e"]],
  [0.55468, ["#141519", "#0b0f13", "#0c0f13", "#0f1115", "#111116"]],
];

/** Most rows the scene's shader takes. */
export const MAX_ROWS = 24;
/** Colors per row, along the horizon. */
export const COLUMNS = 5;

// --- Layout ---
// The scene is placed like a 16:9 photo whose horizon apex sits 49.1% down
// it, on a circle 5.62 frame heights in radius; the color table spans 1.94
// frame heights along the arc.
const APEX_IN_FRAME = 0.4913;
const RADIUS = 5.6191;
export const ARC_SPAN = 1.9418;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/** Where the horizon is on a given canvas, in CSS px. */
export interface HorizonGeometry {
  /** The horizon circle: center and radius. */
  cx: number;
  cy: number;
  r: number;
  /** CSS px per frame height: how big the scene is drawn. */
  scale: number;
}

/**
 * The horizon for a `width` x `height` canvas. Its apex sits 53% of the way
 * down, and the scene is drawn just big enough to
 * cover the canvas, with a small margin, around it. On narrow screens the
 * radius is capped so the curve stays visible.
 */
export function horizonGeometry(width: number, height: number): HorizonGeometry {
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const apex = 0.53;
  const margin = Math.max(18, 0.021 * Math.max(W, H));
  const scale = Math.max(
    (apex * H + margin) / APEX_IN_FRAME, // room above the horizon
    ((1 - apex) * H + margin) / (1 - APEX_IN_FRAME), // and below it
    (W / 2 + margin) / (8 / 9), // and to each side (16:9: 8/9 heights)
  );
  let r = RADIUS * scale;
  const cap = W < 1000 ? W * (4.4 + 0.8 * clamp((W - 390) / 610, 0, 1)) : 0;
  if (cap && cap < r) r = cap;
  return { cx: W / 2, cy: apex * H + r, r, scale };
}

/** The horizon circle in CSS px: center (cx, cy) and radius r. */
export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Where the planet's edge is for a given canvas size. */
export function horizonCircle(width: number, height: number): Circle {
  const { cx, cy, r } = horizonGeometry(width, height);
  return { cx, cy, r };
}

// --- Scrolling ---
// Scrolling down tilts the camera down toward the planet and flies it
// forward. The horizon is far away, so it rises slower than the page; the
// ground turns toward it, fastest nearest the camera.

/** How far the horizon rises per px scrolled. */
export const PARALLAX = 0.36;
/**
 * How far the ground at the bottom of the screen moves per px scrolled, on
 * top of the horizon's rise: together they keep up with the page.
 */
const FLOW = 0.64;

/** The horizon after scrolling `scroll` CSS px down the page. */
export interface HorizonView extends HorizonGeometry {
  /** How far the planet has turned toward the horizon, in radians. */
  spin: number;
}

export function horizonView(
  width: number,
  height: number,
  scroll: number,
): HorizonView {
  const g = horizonGeometry(width, height);
  // The ground at the bottom of the screen, seen on a sphere: how directly it
  // faces the camera (1 = head-on, 0 = at the horizon). Turning the planet by
  // 1 rad moves it r * facing px up the screen.
  const q = (Math.max(height, 1) - g.cy) / g.r;
  const facing = Math.sqrt(Math.max(1 - q * q, 1e-4));
  return {
    ...g,
    cy: g.cy - PARALLAX * scroll,
    spin: (FLOW * scroll) / (g.r * facing),
  };
}
