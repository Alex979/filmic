import GUI from "lil-gui";
import {
  DEFAULT_DUST,
  DEFAULT_FRAME,
  DEFAULT_GRAIN,
  DEFAULT_MOTTLE,
  DEFAULT_OPTICS,
  type Film,
  type FrameFit,
} from "filmic";

/** A tuning panel for a film. Returns the panel so the caller can destroy it. */
export function createControls(film: Film): GUI {
  const gui = new GUI({ title: "filmic" });
  const refresh = (folder: GUI) =>
    folder.controllersRecursive().forEach((c) => c.updateDisplay());

  // --- Frame ---
  const s = film.settings;
  const frame = {
    fit: s.frame.fit as Exclude<FrameFit, Function>,
    aspect: s.frame.aspect,
    anchorX: s.frame.anchor[0],
    anchorY: s.frame.anchor[1],
    resolution: s.frame.resolution,
  };
  const applyFrame = () =>
    film.set({
      frame: {
        fit: frame.fit,
        aspect: frame.aspect,
        anchor: [frame.anchorX, frame.anchorY],
        resolution: frame.resolution,
      },
    });
  const f = gui.addFolder("Frame");
  f.add(frame, "fit", ["cover", "contain", "fill", "screen"]).onChange(
    applyFrame,
  );
  f.add(frame, "aspect", 0.5, 3, 0.01).onChange(applyFrame);
  f.add(frame, "anchorX", 0, 1, 0.01).name("anchor x").onChange(applyFrame);
  f.add(frame, "anchorY", 0, 1, 0.01).name("anchor y").onChange(applyFrame);
  f.add(frame, "resolution", 240, 4320, 1)
    .name("resolution (film px tall)")
    .onChange(applyFrame);
  f.close();

  // --- Optics ---
  const optics = { ...s.optics };
  const applyOptics = () => film.set({ optics });
  const o = gui.addFolder("Optics");
  o.add(optics, "blur", 0, 6, 0.05)
    .name("blur (film px)")
    .onChange(applyOptics);

  // --- Mottle ---
  const mottle = { ...s.mottle };
  const mottleState = { on: true };
  const applyMottle = () =>
    film.set({
      mottle: { ...mottle, amount: mottleState.on ? mottle.amount : 0 },
    });
  const m = gui.addFolder("Mottle");
  m.add(mottleState, "on").name("enabled").onChange(applyMottle);
  m.add(mottle, "amount", 0, 8, 0.01)
    .name("amount (levels)")
    .onChange(applyMottle);
  m.add(mottle, "size", 1, 40, 0.1)
    .name("size (film px)")
    .onChange(applyMottle);
  m.add(mottle, "streaks", 0, 2, 0.01).onChange(applyMottle);
  m.add(mottle, "chroma", 0, 1, 0.01).name("color").onChange(applyMottle);
  m.add(mottle, "seed", 0, 100, 1).onChange(applyMottle);

  // --- Grain ---
  const grain = { ...s.grain };
  const grainState = { on: true };
  const applyGrain = () =>
    film.set({ grain: { ...grain, amount: grainState.on ? grain.amount : 0 } });

  const g = gui.addFolder("Grain");
  g.add(grainState, "on").name("enabled").onChange(applyGrain);
  g.add(grain, "amount", 0, 3, 0.01).onChange(applyGrain);
  g.add(grain, "size", 0.2, 4, 0.01)
    .name("size (film px)")
    .onChange(applyGrain);
  g.add(grain, "breakup", 0, 4, 0.01)
    .name("edge breakup (film px)")
    .onChange(applyGrain);
  g.add(grain, "softness", 0, 2, 0.01).onChange(applyGrain);
  g.add(grain, "sharpness", 0, 0.4, 0.005).onChange(applyGrain);
  g.add(grain, "chroma", 0, 1, 0.01).name("color").onChange(applyGrain);
  g.add(grain, "shadows", 0, 20, 0.05).onChange(applyGrain);
  g.add(grain, "midtones", 0, 20, 0.05).onChange(applyGrain);
  g.add(grain, "highlights", 0, 20, 0.05).onChange(applyGrain);
  g.add(grain, "seed", 0, 100, 1).onChange(applyGrain);


  // --- Dust ---
  const dust = { ...s.dust };
  const dustState = { on: true };
  const applyDust = () =>
    film.set({ dust: { ...dust, amount: dustState.on ? dust.amount : 0 } });
  const d = gui.addFolder("Dust");
  d.add(dustState, "on").name("enabled").onChange(applyDust);
  d.add(dust, "amount", 0, 4, 0.01).onChange(applyDust);
  d.add(dust, "density", 0, 1000, 1).onChange(applyDust);
  d.add(dust, "size", 0.25, 6, 0.01).onChange(applyDust);
  d.add(dust, "dark", 0, 1, 0.01).name("dark share").onChange(applyDust);
  d.add(dust, "hairs", 0, 0.5, 0.001).name("hair share").onChange(applyDust);
  d.add(dust, "seed", 0, 100, 1).onChange(applyDust);

  gui
    .add(
      {
        reset() {
          Object.assign(frame, {
            fit: DEFAULT_FRAME.fit,
            aspect: DEFAULT_FRAME.aspect,
            anchorX: DEFAULT_FRAME.anchor[0],
            anchorY: DEFAULT_FRAME.anchor[1],
            resolution: DEFAULT_FRAME.resolution,
          });
          Object.assign(optics, DEFAULT_OPTICS);
          Object.assign(mottle, DEFAULT_MOTTLE);
          mottleState.on = true;
          Object.assign(grain, DEFAULT_GRAIN);
          grainState.on = true;
          Object.assign(dust, DEFAULT_DUST);
          dustState.on = true;
          refresh(gui);
          applyFrame();
          applyOptics();
          applyMottle();
          applyGrain();
          applyDust();
        },
      },
      "reset",
    )
    .name("reset all");

  return gui;
}
