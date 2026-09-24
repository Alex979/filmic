# filmic

A procedural "film footage" look for the web: any source (a procedural gradient, a
photo, eventually a whole page) rendered as if it were shot on film and projected.

## Layout

```
packages/filmic/     the library: framework-agnostic TypeScript, public API in src/index.ts
examples/horizon/    Vite + React demo that uses the library
```

The example depends on the library as `"filmic": "workspace:*"` and imports its
TypeScript source directly, so there's no build step while developing.

## Run

```bash
bun install
bun dev          # examples/horizon
bun typecheck    # type-check the library
bun run build    # build the example
bun lint
```

## Roadmap

- [x] Project setup
- [x] WebGL groundwork: canvas, resize/DPR, full-screen pass, render loop
- [x] Sources: `shaderSource`, procedural horizon gradient
- [x] Two-pass pipeline: source -> texture -> film pass
- [x] Film frame: effects anchored to the image (cover/contain/fill/screen/custom)
- [x] Grain: procedural, brightness-dependent, with edge breakup
- [x] Optics: lens/emulsion blur (separable gaussian)
- [x] Live settings: `film.set()`
- [ ] `elementSource`: film any canvas (2D, p5, Pixi, Three…), video or image
- [ ] Mottle: low-frequency blotches
- [ ] Look: tone curve, halation, vignette
- [ ] Dust: procedural specks and hairs
- [ ] Title: curved text (SVG overlay, or drawn into the source)
- [ ] Footage mode: frame clock, weave, flicker, per-frame grain/dust
- [ ] Controls panel
- [ ] Horizon source: cloud-like variation in the sky
