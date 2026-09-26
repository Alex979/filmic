# AGENTS.md

Notes for anyone (human or agent) changing filmic.

## The repo

A Bun workspace:

- `packages/filmic/src`: the library. Exported from `index.ts`, shipped as
  TypeScript source, no dependencies.
- `examples/horizon`: the showcase (the live demo).
- `examples/playground`: one card per source type.
- `docs/api.md`: the API reference. Update it with any API change.

From the repo root:

- `bun run typecheck`: type-checks the library.
- `bun run build`: builds both examples, which type-checks them too.
- `bun run lint`: oxlint.
- `bun run dev` / `bun run playground`: dev servers.

Run typecheck, build and lint before calling a change done.

## Cheap by construction

filmic should be cheap enough to give a whole site the film look, not just
one hero. No effect should need a "use sparingly" warning. So:

- **Nothing that runs every frame may run on the CPU per pixel.** Per-frame
  work is either a GPU pass on the film's canvas, or DOM changes the
  compositor can apply without repainting (transform, opacity, and
  `filter: brightness()` on an element that isn't filtered otherwise).
- **DOM filters are painted once, never animated.** SVG filters (the ink)
  and CSS `drop-shadow()`/`blur()` (the glows) are computed on the CPU in
  Safari. Changing anything they depend on (an attribute, a seed, a style of
  the element or its content) redraws them, and on a phone each redraw can
  cost a dropped frame. As static decoration they're fine. The ink's live boil
  (`film.attach(el, { ink })`) breaks this rule, so by default (`boil:
  "auto"`) it watches what it costs and stops if it keeps dropping frames.
- **Give filtered elements their own small layer** (`will-change: transform`
  on the filtered element or a tight wrapper). Sharing a layer with anything
  that changes each frame repaints the filters with it. Keep these layers
  small: one full-screen layer over the canvas cost about 10 fps (below).
- **Skip unchanged work.** Cache stages whose inputs didn't change, and only
  write styles or attributes when the value changes: browsers can treat an
  identical write as a change.
- **Scale with pixels, not elements.** Prefer one shared GPU pass over
  per-element work.

## Measuring performance

iOS Safari is where performance problems show up, and desktop numbers don't
predict it (see below). Judge changes on a real iPhone:

- Measure frame times with `requestAnimationFrame` deltas, and count **late
  frames** (over 20 ms), not just average fps: a hitch every footage frame
  still averages close to 60 fps.
- Compare against a control build run right before and after, since phones
  slow down as they warm up.
- Test production builds (`vite build` + `vite preview`), not the dev server.

Measured on iOS Safari, and counter-intuitive:

- `gl.invalidateFramebuffer` before redrawing a target made the pipeline about
  twice as slow, where it should help a tile-based GPU.
- `will-change: transform` on a full-screen layer over the canvas cost about
  10 fps.
- A layer at `opacity: 0` (or off screen) loses its drawing, so showing it
  again redraws it, filters included.

## Code

- TypeScript only.
- Match the surrounding code: comments are prose that explain *why*, and
  names are plain words.
- Measured defaults are "calibrated against scanned film".
- The horizon example is deliberately styled; don't restyle it.
- Keep repo files and commit messages free of local paths and references to
  private projects.

## Commits

Conventional commits: `type: subject`, imperative, lowercase, at most 72
characters, saying what changed (`feat`, `fix`, `perf`, `docs`, `build`,
`refactor`, `test`, `chore`). A body of 1-4 sentences only when it adds what
the diff can't show: why, a trade-off, a limitation.
