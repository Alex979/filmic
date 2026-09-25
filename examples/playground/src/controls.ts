import GUI from "lil-gui";
import {
  DEFAULT_DUST,
  DEFAULT_FRAME,
  DEFAULT_GRAIN,
  DEFAULT_MOTTLE,
  DEFAULT_OPTICS,
  type FrameFit,
} from "filmic";
import { setAll } from "./films";

/** One tuning panel for every film on the page. */
export function createControls(): GUI {
  const gui = new GUI({ title: "filmic (all demos)" });

  // --- Frame ---
  const frame = {
    fit: DEFAULT_FRAME.fit as Exclude<FrameFit, Function>,
    resolution: DEFAULT_FRAME.resolution,
  };
  const applyFrame = () => setAll({ frame });
  const f = gui.addFolder("Frame");
  f.add(frame, "fit", ["source", "cover", "contain", "fill", "screen"]).onChange(
    applyFrame,
  );
  f.add(frame, "resolution", 240, 4320, 1)
    .name("resolution (film px tall)")
    .onChange(applyFrame);

  // --- Optics ---
  const optics = { ...DEFAULT_OPTICS };
  const applyOptics = () => setAll({ optics });
  gui
    .addFolder("Optics")
    .add(optics, "blur", 0, 6, 0.05)
    .name("blur (film px)")
    .onChange(applyOptics);

  // --- Mottle ---
  const mottle = { ...DEFAULT_MOTTLE };
  const mottleState = { on: true };
  const applyMottle = () =>
    setAll({
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
  const grain = { ...DEFAULT_GRAIN };
  const grainState = { on: true };
  const applyGrain = () =>
    setAll({ grain: { ...grain, amount: grainState.on ? grain.amount : 0 } });
  const g = gui.addFolder("Grain");
  g.add(grainState, "on").name("enabled").onChange(applyGrain);
  g.add(grain, "amount", 0, 3, 0.01).onChange(applyGrain);
  g.add(grain, "size", 0.2, 4, 0.01).name("size (film px)").onChange(applyGrain);
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
  g.close();


  // --- Dust ---
  const dust = { ...DEFAULT_DUST };
  const dustState = { on: true };
  const applyDust = () =>
    setAll({ dust: { ...dust, amount: dustState.on ? dust.amount : 0 } });
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
            resolution: DEFAULT_FRAME.resolution,
          });
          Object.assign(optics, DEFAULT_OPTICS);
          Object.assign(mottle, DEFAULT_MOTTLE);
          mottleState.on = true;
          Object.assign(grain, DEFAULT_GRAIN);
          grainState.on = true;
          Object.assign(dust, DEFAULT_DUST);
          dustState.on = true;
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
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

  if (window.innerWidth < 720) gui.close(); // don't cover the page on phones
  return gui;
}
