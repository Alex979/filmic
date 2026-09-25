# filmic

A procedural film look for the web. Point it at an image, a video, a canvas or
a shader, and it renders it as if it were shot on film and projected: grain,
soft optics, a warm glow around highlights, mottle, dust, and, if you want,
the gentle weave and flicker of real footage.

- **Everything is procedural.** No film scans or textures to download; it's a
  few WebGL passes on one canvas.
- **Film any source:** `<img>`, `<video>`, any canvas (2D, p5, Pixi,
  Three.js…), or your own GLSL.
- **Effects live on the film,** not the screen: grain and dust stay attached to
  the picture and scale with it, like a real print.
- **Footage mode** steps everything at a film frame rate (12 fps by default),
  and gives DOM text the same motion, flicker and printed-ink look.
- **Framework-agnostic** TypeScript, no dependencies.

> **Status:** early. The API may still change, and it isn't on npm yet: install
> it from this repository (below).

## Install

filmic isn't published yet, so link it from a local clone:

```bash
git clone https://github.com/Alex979/filmic.git
cd filmic/packages/filmic
bun link
```

Then, in your project:

```bash
bun link filmic
```

That adds `"filmic": "link:filmic"` to your `package.json`. With npm or pnpm,
install the folder instead: `npm install ../path/to/filmic/packages/filmic`.

The package ships its TypeScript source, so your bundler needs to compile
TypeScript inside dependencies. Vite and Bun do this out of the box. For
Next.js, add `transpilePackages: ["filmic"]` to `next.config.js`.

filmic needs WebGL 2, which every current browser supports.

## Quick start

filmic draws into a `<canvas>` you size with CSS. It keeps the canvas's pixels
matched to its on-screen size and redraws when it resizes.

```html
<section class="hero">
  <canvas class="hero-film"></canvas>
</section>
```

```css
.hero {
  position: relative;
  height: 100vh;
}
.hero-film {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
```

```ts
import { createFilm, elementSource } from "filmic";

const photo = new Image();
photo.src = "/hero.jpg";

const film = createFilm(document.querySelector("canvas")!, {
  source: elementSource(photo, { fit: "cover" }),
  footage: { enabled: true },
});
```

That's a complete, animated hero. Leave out `footage` for a still.

Everything can be changed later with `film.set()`, which merges into the current
settings. `film.destroy()` stops rendering and frees the GPU resources.

```ts
film.set({ grain: { amount: 1.5 }, footage: { fps: 24 } });
```

## What to film

### Images, video and canvases

`elementSource` films anything the browser can put in a texture. The element
doesn't have to be on the page.

```ts
elementSource(image, {
  fit: "cover",        // like CSS object-fit: "cover" | "contain" | "fill"
  anchor: [0.5, 0.5],  // like object-position
  background: "#000",  // bars around "contain", and behind transparency
});
```

- **Images** are filmed as soon as they load, and again if their `src` changes.
- **Videos** redraw once per video frame. Muted, `playsInline` videos can play
  without being on the page.
- **Canvases** can change at any time, so either call `film.render()` after you
  draw, or pass `live: true` to re-read the canvas every frame (for canvases
  with their own animation loop).
- **WebGL canvases** (Three.js, Pixi…) need `preserveDrawingBuffer: true`,
  or the browser may clear them before filmic reads them.
- **Images from another origin** need CORS (`crossOrigin = "anonymous"` and
  the right server headers), or WebGL isn't allowed to read them.

```ts
// A Three.js scene, filmed live.
const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
const film = createFilm(canvas, {
  source: elementSource(renderer.domElement, { live: true }),
});
```

### Shaders

`shaderSource` runs a fragment shader that fills the canvas. filmic adds a
small header, so the shader only needs a `main`:

```ts
import { shaderSource } from "filmic";

const sunset = shaderSource(`
void main() {
  vec2 uv = filmPx() / uResolution;  // 0..1, top-left origin
  vec3 c = mix(vec3(.02, .04, .1), vec3(.9, .45, .2), uv.y);
  fragColor = vec4(linearToSrgb(c), 1.);
}`);
```

The header provides `uResolution` (canvas size, CSS px), `uBufferSize` (device
px), `uPixelRatio`, `filmPx()` (the pixel's position in CSS px, y down),
`linearToSrgb()` and the `fragColor` output. For your own uniforms, pass a
second argument:

```ts
shaderSource(frag, (gl, uniforms, view) => {
  gl.uniform3f(uniforms.uSun, 0.7, 0.6, 0.1);
});
```

For anything else, implement the `Source` interface yourself: see
[docs/api.md](docs/api.md#custom-sources).

## Footage

With `footage: { enabled: true }`, the film plays: it steps at `fps` (any
number, 12 by default), and every frame gets a slight weave (the film shifting
in the gate), a flicker of exposure, new grain, and fresh dust, some of which
lingers for a few frames.

Frames tick on the page's clock, so every film on the page steps together.
Frame N looks the same on every device, even one that skips frames. Films pause
while they're scrolled out of view.

## Text and other DOM elements

Titles and UI stay real DOM (selectable, searchable, accessible), and filmic
gives them the same look:

- **`inkFilter()`** is an SVG filter for a printed-on-film look: slightly
  rough, soft edges and tiny pinholes. It works on any element, and selection
  highlights and the text cursor get it too. With `halation`, light ink also
  gets film's warm glow, to match the canvas's: `ink.glow` goes on the
  element around the inked one.
- **`film.attach(element)`** moves an element with the film each frame (weave
  and flicker) and makes its ink boil. It takes over the element's `transform`
  and `filter`, so attach a wrapper around your content.
- **`film.sync(element)`** steps the element's CSS animations and transitions
  at the footage frame rate, in lockstep with the film. Anything you don't sync
  keeps animating smoothly.

```html
<section class="hero">
  <canvas class="hero-film"></canvas>
  <div class="hero-text">
    <h1><span>Evening</span></h1>
    <p class="tagline"><span>A short film</span></p>
  </div>
</section>
```

```css
.hero-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
}
/* The glow goes around the inked text, not on it (Safari clips it there). */
.hero-text h1,
.hero-text .tagline {
  filter: var(--title-ink-glow);
}
.hero-text span {
  display: inline-block;
  filter: url(#title-ink);
}
.tagline {
  animation: fade-up 1.2s 0.6s both;
}
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(0.5em);
  }
}
```

```ts
import { createFilm, elementSource, inkFilter } from "filmic";

const film = createFilm(canvas, {
  source: elementSource(photo),
  footage: { enabled: true },
});
const ink = inkFilter({ halation: 0.4 }, "title-ink"); // the id the CSS refers to

const text = document.querySelector<HTMLElement>(".hero-text")!;
film.attach(text, { ink }); // weave, flicker, boiling ink
film.sync(text); // the tagline's fade-up steps at 12 fps
```

For animations you drive from JavaScript, time them with `film.frameTime()`:
it's `performance.now()` stepped to the start of the current film frame while
footage plays, so the animation steps with the film.

```ts
const start = performance.now();
const tick = () => {
  const t = (film.frameTime() - start) / 1000;
  title.style.opacity = String(Math.min(1, t / 1.5));
  if (t < 1.5) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

`film.on("frame", (frame) => …)` runs on every drawn frame, with its number,
time, weave and flicker, for anything else.

Things that follow the user, like the scroll position or the pointer, feel
laggy at 12 fps. Keep them at the screen's rate: call `film.render()` when
they change. A redraw between footage frames keeps that frame's grain, weave
and flicker, and only the picture moves.

## React

filmic doesn't need a wrapper: create the film in an effect and destroy it in
the cleanup.

```tsx
import { useEffect, useRef } from "react";
import { createFilm, elementSource } from "filmic";

export function FilmedPhoto({ src }: { src: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const photo = new Image();
    photo.src = src;
    const film = createFilm(canvas.current!, {
      source: elementSource(photo),
      footage: { enabled: true },
    });
    return () => film.destroy();
  }, [src]);

  return <canvas ref={canvas} style={{ display: "block", width: "100%", height: "100%" }} />;
}
```

## Tuning

Settings come in groups, all optional, all changeable with `film.set()`:

| Group      | What it controls                                                   |
| ---------- | ------------------------------------------------------------------ |
| `frame`    | The film frame: how it's fitted to the canvas, and its resolution  |
| `optics`   | Lens and emulsion softness                                         |
| `halation` | The warm glow around bright highlights: strength, threshold, reach |
| `grain`    | Size, strength per brightness, color, crispness, edge breakup      |
| `mottle`   | Faint blotches and streaks of density and color                    |
| `dust`     | How much dust, how big, how much is dark, how many hairs           |
| `footage`  | Frame rate, weave, flicker, new grain and dust per frame           |

The defaults are calibrated against scanned film. Halation's are tuned by eye
for sources without a film look of their own, so turn it off
(`halation: { amount: 0 }`) for images that already have one.

Sizes are in **film pixels**: the film frame is 1080 film px tall by default,
and it follows your source's picture (for `elementSource`) or covers the canvas
at 16:9 (for shaders). So a grain of `size: 0.76` is the same fraction of the
picture on a phone and on a 4K screen.

Every option and default is listed in [docs/api.md](docs/api.md).

## Good to know

- **Pixel ratio:** filmic renders at most at 2x by default (`maxPixelRatio`).
  On a 3x phone that's visually the same for grainy film, and much cheaper.
- **Curved text jitter:** a letter that sits exactly upright at the top of a
  curve (e.g. SVG `textPath`) can jitter by a pixel as the ink boils, because
  browsers snap upright glyphs to whole pixels. An invisible
  `transform: skewX(0.05deg)` on the text fixes it.
- **Editable inked text:** browsers skip SVG filters on zero-size elements, so
  give an emptiable editable element some padding, or its cursor shows
  unfiltered.
- **Same look everywhere:** all randomness is seeded, so a given seed gives the
  same grain, mottle and dust on every device.

## Examples

This repository is a Bun workspace with two example apps:

```
packages/filmic/     the library (public API in src/index.ts)
examples/horizon/    a sunset hero with a curved title, used to tune the defaults
examples/playground/ one card per kind of source: image, shader, 2D canvas, video, Three.js
```

```bash
bun install
bun dev          # the horizon example, with a tuning panel
bun playground   # the playground (drop your own photo or video on it)
bun typecheck    # type-check the library
bun run build    # build both examples
bun lint
```

The examples use the library straight from its TypeScript source
(`"filmic": "workspace:*"`), so there's no build step while developing.

## Roadmap

Done: the render pipeline, shader and element sources, grain, optics,
halation, mottle, dust, footage mode, ink, and the DOM hooks.

Next:

- [ ] A reusable controls panel
- [ ] Horizon example: cloud-like texture along the horizon
- [ ] Page overlay: real grain and dust over regular page content
- [ ] Filmed text (opt-in): draw DOM text into the film itself
- [ ] An npm package with a compiled build
- [ ] Look (optional): highlight rolloff, vignette

## License

[MIT](LICENSE)
