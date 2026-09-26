import { createFilm, inkFilter, shaderSource, type Film } from "filmic";
import "./stress.css";

/**
 * Stress test for the DOM ink: a scrolling page of `n` inked text blocks over
 * a full-screen film, to measure how the ink's cost scales with the amount
 * of inked text. Driven by URL params, so a script can step through them:
 *
 *   n       number of blocks (default 12)
 *   boil    1: the ink boils each footage frame; 0: it holds still (default 1)
 *   layers  1: each block is its own compositing layer (default 1)
 *   glow    1: the ink's halation glow around each block (default 1)
 *   ink     1: inked; 0: no filters at all, the baseline (default 1)
 *
 * Once set up it exposes `window.stress = { film, ready, params }`.
 */

export interface StressParams {
  n: number;
  boil: boolean;
  layers: boolean;
  glow: boolean;
  ink: boolean;
}

declare global {
  interface Window {
    stress?: { film: Film; ready: true; params: StressParams };
  }
}

function readParams(): StressParams {
  const query = new URLSearchParams(location.search);
  const flag = (name: string, fallback: boolean) => {
    const value = query.get(name);
    return value === null ? fallback : value !== "0";
  };
  const n = Number.parseInt(query.get("n") ?? "", 10);
  const ink = flag("ink", true);
  return {
    n: Number.isFinite(n) && n >= 0 ? n : 12,
    // Without the ink there's nothing to boil or glow.
    boil: ink && flag("boil", true),
    layers: flag("layers", true),
    glow: ink && flag("glow", true),
    ink,
  };
}

// A cheap background: a dark, slightly warm gradient, so light ink reads on it.
const background = () =>
  shaderSource(/* glsl */ `
void main() {
  vec2 uv = filmPx() / uResolution;
  vec3 top = vec3(.10, .09, .12);
  vec3 bottom = vec3(.20, .12, .09);
  fragColor = vec4(mix(top, bottom, uv.y), 1.);
}`);

const HEADINGS = [
  "Morning on the river",
  "The long field",
  "Notes from the workshop",
  "A road through the hills",
  "Evening light",
  "The harbor in winter",
];

// Each about three to four lines on a 400px-wide phone.
const PARAGRAPHS = [
  "The boats came in slowly after the rain, their sails still dark with water, and the people on the pier stood aside to let the ropes be thrown and tied.",
  "Along the edge of the field the grass had been cut in long rows, and the smell of it drifted over the fence toward the road where a cart waited in the shade.",
  "She kept the tools in the order she used them, left to right on the bench, so that in the dim hours before noon she could find each one without looking up.",
  "By the third bend the road began to climb, and the valley opened below it in patches of green and brown, with a thin line of smoke rising from a farmhouse.",
  "The light went amber a little after six, catching the tops of the trees first and then the windows across the square, one after another, like lamps being lit.",
  "In winter the harbor was quiet. A few boats stayed tied up all season, and the gulls stood in rows along the wall, facing into the wind as if waiting for something.",
  "He read the letter twice by the window, then folded it along its creases and put it back in the envelope, which he set on the shelf beside the clock.",
  "Most of the town was built from the same pale stone, cut from a quarry on the hill, so that in the late afternoon every wall seemed to hold a little of the sun.",
];

function buildPage(page: HTMLElement, params: StressParams, url: string, glow: string) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < params.n; i++) {
    // The glow goes on the block, the ink on the element inside it: Safari
    // clips a glow to the ink's filter region when both are on one element.
    const block = document.createElement("div");
    block.className = params.layers ? "block layer" : "block";
    if (params.glow) block.style.filter = glow;

    const inked = document.createElement("div");
    inked.className = "ink";
    if (params.ink) inked.style.filter = url;

    if (i % 5 === 0) {
      const heading = document.createElement("h2");
      heading.textContent = HEADINGS[(i / 5) % HEADINGS.length];
      inked.appendChild(heading);
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = PARAGRAPHS[i % PARAGRAPHS.length];
    inked.appendChild(paragraph);

    block.appendChild(inked);
    fragment.appendChild(block);
  }
  page.appendChild(fragment);
}

async function main() {
  const params = readParams();
  const canvas = document.getElementById("film") as HTMLCanvasElement;
  const page = document.getElementById("page") as HTMLElement;
  const label = document.getElementById("params") as HTMLElement;

  // One ink for every block, with the horizon example's values.
  const ink = params.ink ? inkFilter({ halation: 0.4, softness: 0.7 }) : null;
  buildPage(page, params, ink?.url ?? "", ink?.glow ?? "");

  const flag = (on: boolean) => (on ? 1 : 0);
  label.textContent =
    `n=${params.n} boil=${flag(params.boil)} layers=${flag(params.layers)} ` +
    `glow=${flag(params.glow)} ink=${flag(params.ink)}`;

  await document.fonts.ready;

  const film = createFilm(canvas, {
    source: background(),
    footage: { enabled: true },
  });
  // The page moves with the film (weave and flicker). With `boil`, the ink's
  // noise also changes each footage frame, which redraws every block's
  // filters; without it the ink holds still.
  if (params.boil && ink) film.attach(page, { ink });
  else film.attach(page);

  window.stress = { film, ready: true, params };
}

void main();
