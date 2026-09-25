# filmic API reference

Everything below is exported from `filmic`. For a guided introduction, see the
[README](../README.md).

- [createFilm](#createfilm)
- [The Film object](#the-film-object)
- [Settings](#settings): [frame](#frame) · [optics](#optics) ·
  [halation](#halation) ·
  [grain](#grain) · [mottle](#mottle) · [dust](#dust) · [footage](#footage)
- [Sources](#sources): [elementSource](#elementsource) ·
  [shaderSource](#shadersource) · [testPattern](#testpattern) ·
  [custom sources](#custom-sources)
- [DOM](#dom): [inkFilter](#inkfilter) · [attach](#filmattach) ·
  [sync](#filmsync) · [frame events](#frame-events)
- [Helpers](#helpers)

## createFilm

```ts
createFilm(canvas: HTMLCanvasElement, options?: FilmOptions): Film
```

Takes over a canvas and starts drawing. Size the canvas with CSS; filmic keeps
its drawing buffer matched to that size at the screen's pixel density, and
redraws on resize (with no flash of black).

`options` accepts every [settings group](#settings), plus:

| Option          | Default          | Description                                                                                   |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `source`        | a test pattern   | What to film. See [Sources](#sources).                                                        |
| `maxPixelRatio` | `2`              | Upper limit on the pixel density rendered at. Lower is cheaper; grainy film hides the difference. |

Throws if WebGL 2 isn't available.

## The Film object

| Member                          | Description                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `set(update)`                   | Change settings or the source. Each group is merged into the current one; omitted fields keep their value.   |
| `settings`                      | A read-only copy of the current settings (every group, fully filled in).                                     |
| `render()`                      | Redraw on the next animation frame. Needed after drawing to a canvas source that isn't `live`. While footage plays, a redraw between footage frames keeps that frame's grain, weave and flicker and only updates the picture. |
| `on("frame", listener)`         | Run `listener` on every drawn frame. Returns an unsubscribe function. See [frame events](#frame-events).       |
| `frameTime(now?)`               | `now` (default `performance.now()`) stepped to the start of its footage frame while footage plays; else `now`. |
| `attach(element, options?)`     | Move an element with the film. Returns a detach function. See [attach](#filmattach).                         |
| `sync(element)`                 | Step an element's CSS animations at the footage rate. Returns a stop function. See [sync](#filmsync).        |
| `destroy()`                     | Stop drawing and free GPU resources. The canvas can be handed to `createFilm` again.                          |

## Settings

Seven groups, all optional in `createFilm` and `film.set()`. Each is exported
with its defaults (`DEFAULT_FRAME`, `DEFAULT_OPTICS`, `DEFAULT_HALATION`,
`DEFAULT_GRAIN`, `DEFAULT_MOTTLE`, `DEFAULT_DUST`, `DEFAULT_FOOTAGE`).

Sizes are in **film px**: positions on the film frame, which is
`frame.resolution` film px tall. Effects measured in film px keep their size
relative to the picture, at any screen size.

### frame

The film frame: the piece of film being projected onto the canvas. Grain,
mottle and dust are laid out on it, so they move and scale with the picture.

| Option       | Default      | Description                                                                                         |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------- |
| `fit`        | `"source"`   | How the frame is laid over the canvas (below).                                                      |
| `aspect`     | `16 / 9`     | Frame width / height, for `"cover"` and `"contain"` (and `"source"` when the source has no picture). |
| `anchor`     | `[0.5, 0.5]` | Where the frame is pinned when it doesn't match the canvas, `[x, y]` in 0..1.                        |
| `resolution` | `1080`       | Film px across the frame's height.                                                                  |

`fit` is one of:

- `"source"`: wherever the source put its picture (e.g. an `elementSource`
  laid out with `cover` or `contain`). Sources without one fall back to
  `"cover"`.
- `"cover"`, `"contain"`, `"fill"`: like CSS `object-fit`, using `aspect` and
  `anchor`.
- `"screen"`: exactly the canvas, with 1 film px = 1 CSS px, so effects keep a
  fixed on-screen size.
- `(view) => Rect`: any other layout, as a rectangle in CSS px.

### optics

| Option | Default | Description                                                                                    |
| ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `blur` | `1`     | Lens and emulsion softness: a gaussian blur, in film px. `0` keeps the source pixel-sharp.     |

### halation

The warm glow around bright highlights: light that went through the emulsion,
bounced off the film base and exposed it again around where it came in. It's
added as light, before grain, so over dark surroundings it glows and over
bright ones it barely shows, and highlights stay white. Defaults are tuned by
eye for sources without a film look; set `amount: 0` for images that already
have one.

| Option      | Default     | Description                                                                   |
| ----------- | ----------- | ----------------------------------------------------------------------------- |
| `amount`    | `0.4`       | Strength. `0` turns halation off.                                             |
| `threshold` | `0.6`       | Brightness (0–1) where highlights start to glow. White glows fully.           |
| `radius`    | `28`        | How far the glow reaches, in film px.                                         |
| `color`     | `"#ff6230"` | Color of the glow. Real halation is red-orange.                               |

For DOM text, the ink filter has a matching glow: see
[inkFilter](#inkfilter).

### grain

| Option       | Default | Description                                                                                          |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `amount`     | `1`     | Overall strength. `0` turns grain off.                                                               |
| `size`       | `0.76`  | Size of one grain, in film px.                                                                       |
| `breakup`    | `0.6`   | How far grain pushes the image around, in film px, so sharp edges come out ragged.                   |
| `softness`   | `0.52`  | How soft and clumpy the grains are.                                                                  |
| `sharpness`  | `0.12`  | How crisp each grain is against its surroundings. Around 0.1–0.15 looks like film.                   |
| `chroma`     | `0.25`  | `0` = monochrome grain, `1` = independent per color channel.                                         |
| `shadows`    | `4.6`   | Strength in the darkest tones, in 0–255 levels (times `amount`).                                     |
| `midtones`   | `8.3`   | Strength at the peak, in the lower mid-tones.                                                        |
| `highlights` | `3.75`  | Strength in the brightest tones.                                                                     |
| `seed`       | `0`     | Changes the pattern.                                                                                 |

### mottle

Faint, soft blotches of density and color, and streaks along the film. Follows
grain's brightness curve.

| Option    | Default | Description                                                                          |
| --------- | ------- | ------------------------------------------------------------------------------------ |
| `amount`  | `0.33`  | Strength: standard deviation in 0–255 levels at the mid-tones. `0` turns it off.     |
| `size`    | `5.3`   | Size of the finest blotches, in film px (it mixes in blotches twice as large).       |
| `streaks` | `0.3`   | Strength of the vertical streaks relative to the blotches.                           |
| `chroma`  | `0.58`  | `0` = brightness only, `1` = independent per color channel.                          |
| `seed`    | `0`     | Changes the pattern.                                                                 |

### dust

Specks, fibers, hairs and thin lines. Each piece partly covers the picture,
pulling it toward a cool white (dust on the negative) or near-black (dust on
the print).

| Option    | Default | Description                                                                    |
| --------- | ------- | ------------------------------------------------------------------------------ |
| `amount`  | `1`     | Opacity multiplier. `0` turns dust off.                                        |
| `density` | `240`   | Pieces of dust on a still frame. (Footage uses `footage.dustRate` instead.)    |
| `size`    | `1`     | Size multiplier.                                                               |
| `dark`    | `0.15`  | Share of specks that are dark.                                                 |
| `hairs`   | `0.035` | Share of pieces that are fibers, hairs and thin lines.                         |
| `seed`    | `0`     | Changes the layout.                                                            |

### footage

| Option          | Default | Description                                                                               |
| --------------- | ------- | ----------------------------------------------------------------------------------------- |
| `enabled`       | `false` | Play as footage. Off, the film is a still.                                                |
| `fps`           | `12`    | Film frames per second: any number. 12 reads as old footage, 24 as cinema.                |
| `weave`         | `0.9`   | How far the frame drifts and jitters in the gate, in film px.                             |
| `weaveRotation` | `0.015` | How far it turns, in degrees.                                                             |
| `flicker`       | `0.025` | Exposure flicker, as a fraction (about ±2.5%).                                            |
| `grain`         | `true`  | New grain every frame.                                                                    |
| `dustRate`      | `20`    | Average number of new dust pieces per frame.                                              |
| `dustLinger`    | `0.2`   | Chance a piece stays for 2–6 frames (wandering slightly) instead of one.                  |
| `seed`          | `0`     | Changes every frame's randomness.                                                         |

Frames tick on the page clock (`performance.now()`), so every film and synced
element on the page steps together, and frame N looks the same on every device.
Footage pauses while the canvas is off screen.

## Sources

A source is what gets filmed. Pass one as `source` to `createFilm` or
`film.set()`; setting a new one replaces (and frees) the old one.

### elementSource

```ts
elementSource(element: FilmableElement, options?: ElementSourceOptions): Source
```

Films an `HTMLImageElement`, `HTMLVideoElement`, `HTMLCanvasElement`,
`OffscreenCanvas` or `ImageBitmap`. The element doesn't need to be on the page.

| Option       | Default      | Description                                                                                                  |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `fit`        | `"cover"`    | `"cover"`, `"contain"` or `"fill"`, like CSS `object-fit`.                                                   |
| `anchor`     | `[0.5, 0.5]` | Where it's pinned when it doesn't match, like `object-position`.                                            |
| `background` | `"#000"`     | Color of the bars around a contained element, and behind transparent pixels.                                 |
| `live`       | `false`      | Re-read the element every frame, for canvases animated by their own loop.                                   |

When it re-reads the element:

- **images:** when they load (including after `src` changes)
- **videos:** once per new video frame
- **canvases:** on every draw; call `film.render()` after drawing, or use `live`

WebGL canvases need `preserveDrawingBuffer: true`. Images and videos from
another origin need CORS. While footage plays, everything is filmed at the
footage frame rate.

### shaderSource

```ts
shaderSource(frag: string, setUniforms?: SetUniforms): Source
```

A fragment shader that draws the scene. filmic prepends a header, so `frag`
only needs a `main` (and any uniforms or functions of its own). The header
provides:

| Name                     | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `uResolution`            | `vec2`: canvas size, CSS px.                             |
| `uBufferSize`            | `vec2`: drawing buffer size, device px.                  |
| `uPixelRatio`            | `float`: device px per CSS px.                           |
| `filmPx()`               | The current pixel in CSS px, origin top-left, y down.    |
| `linearToSrgb(vec3)`     | Linear light to sRGB, for output.                        |
| `fragColor`              | The output: write an sRGB color.                         |

`setUniforms(gl, uniforms, view)` runs before every draw: `uniforms` maps names
to locations (array uniforms without `[0]`), `view` is the canvas size (see
`View`).

### testPattern

```ts
testPattern(): Source
```

A grid every 100 CSS px and a 100 px circle, for checking sizing and pixel
ratio. The default source.

### Custom sources

A `Source` has a `create(gl, context)` that returns an instance:

```ts
interface Source {
  create(gl: WebGL2RenderingContext, context: SourceContext): SourceInstance;
}

interface SourceInstance {
  render(view: View): SourceFrame; // draw the scene into a texture
  dispose(): void;
}

interface SourceFrame {
  texture: WebGLTexture;
  uvScale: [number, number]; // the film pass samples at screenUv * uvScale + uvOffset
  uvOffset: [number, number]; // (screen UV: (0, 0) bottom-left)
  rect?: Rect; // where the picture sits on the canvas, for frame.fit "source"
}
```

`context.requestRender()` asks for a redraw (e.g. when new content arrives).
A texture rendered at canvas size uses scale `[1, 1]` and offset `[0, 0]`; an
uploaded image, whose first row is its top, uses `[1, -1]` and `[0, 1]`.

## DOM

### inkFilter

```ts
inkFilter(options?: Partial<InkOptions>, id?: string): InkFilter
```

Adds an SVG filter to the page for a printed-on-film look. Apply it with CSS
(`filter: url(#id)`, or `element.style.filter = ink.url`) or an SVG `filter`
attribute. Any number of elements can share one. Pass an `id` to reference it
from CSS before it exists.

| Option           | Default     | Description                                                       |
| ---------------- | ----------- | ----------------------------------------------------------------- |
| `roughness`      | `0.6`       | How far noise pushes edges around, in CSS px.                     |
| `softness`       | `0.7`       | Blur, in CSS px.                                                  |
| `firmness`       | `1.14`      | Opacity boost after the blur, to firm the edges back up.          |
| `pinholes`       | `0.175`     | Pinholes through the ink: `0` = none, higher = more and larger.   |
| `seed`           | `0`         | Changes the noise pattern.                                        |
| `halation`       | `0`         | Halation: a warm glow around light ink, on the canvas's scale.    |
| `halationRadius` | `14`        | How far the glow reaches, in CSS px.                              |
| `halationColor`  | `"#ff6230"` | Color of the glow.                                                |

The halation glow goes on the element *around* the inked one, not on it:

```html
<p style="filter: var(--title-ink-glow)">
  <span style="display: inline-block; filter: url(#title-ink)">Evening</span>
</p>
```

`ink.glow` is that `var(--id-glow)` value, with the id escaped if it isn't a
CSS identifier (React's `useId()` ids, for one); the custom property lives on
the page's root element and follows `set()`. The glow is CSS `drop-shadow()`
layers, and Safari clips them when they share an element with the SVG filter,
and ignores them on SVG elements, so SVG text takes its glow from an HTML
parent. The glowing element can animate `opacity` and `transform` freely.

The returned `InkFilter` has `id`, `url`, `glow`, `options`, `set(options)`,
`setFrame(n)` (shift the noise for footage frame `n`; `attach` does this) and
`destroy()`.

Sizes are in CSS px, so small text looks softer than large text; lower
`softness` for body copy. Browsers skip filters on zero-size elements: keep
emptiable editable elements from collapsing (e.g. with padding).

### film.attach

```ts
film.attach(element: HTMLElement | SVGElement, options?: { ink?: InkFilter }): () => void
```

While footage plays, each frame it sets the element's `transform` (the weave,
about the film frame's center), `filter` (the flicker, as `brightness()`),
and, with `ink`, advances the ink's noise. It takes over `transform`,
`transform-origin` and `filter`, so attach a wrapper, not the styled element
itself. The returned function detaches it and clears those styles.

### film.sync

```ts
film.sync(element: Element): () => void
```

While footage plays, pauses the CSS animations and transitions of `element` and
its descendants and sets their time to the current film frame's, so they step
in lockstep with the film. New animations are picked up as they start. When
footage stops (or you call the returned function), they resume normally.

### Frame events

`film.on("frame", listener)` calls `listener(frame)` on every drawn frame, in
the same animation frame as the draw, so DOM changes appear together with it.

| Field        | Description                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `playing`    | Footage is playing. When false, the rest describe a still.                  |
| `n`          | Footage frame number on the page clock (`0` when still).                    |
| `time`       | When this frame started, in ms on the `performance.now()` clock.           |
| `fps`        | Footage frames per second.                                                  |
| `dx`, `dy`   | Weave shift, in CSS px.                                                     |
| `rotation`   | Weave rotation, in radians, about `origin`.                                 |
| `origin`     | The film frame's center, `[x, y]` in CSS px from the canvas's top-left.     |
| `exposure`   | Flicker, as a multiplier on linear light.                                  |
| `brightness` | The same flicker as a CSS `brightness()` amount.                            |

## Helpers

| Export                                   | Description                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `hexToRgb(hex)`                          | `"#rrggbb"` to `[r, g, b]` in 0..1 (sRGB).                                  |
| `hexToLinear(hex)`                       | `"#rrggbb"` to linear-light `[r, g, b]`, for blending in shaders.           |
| `srgbToLinear(c)`                        | One sRGB channel (0..1) to linear light.                                    |
| `fitRect(w, h, aspect, fit, anchor?)`    | CSS object-fit math: where a box of `aspect` lands in a `w` x `h` area.     |
| `resolveFrame(view, frame, sourceRect?)` | Where the film frame lands for a view, and its film px per CSS px.          |
| `frameIndex(ms, fps)`, `frameStart(ms, fps)` | Footage frame number at a time, and that frame's start.                 |
| `footageFrame(n, footage)`               | Frame `n`'s weave, flicker and grain offset.                                |
| `layoutDust(dust)`, `layoutFootageDust(…)` | The dust layouts, as instance data.                                       |
