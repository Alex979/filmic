import GUI from "lil-gui";
import {
  DEFAULT_FRAME,
  DEFAULT_GRAIN,
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

  gui
    .add(
      {
        reset() {
          Object.assign(frame, {
            fit: DEFAULT_FRAME.fit,
            resolution: DEFAULT_FRAME.resolution,
          });
          Object.assign(optics, DEFAULT_OPTICS);
          Object.assign(grain, DEFAULT_GRAIN);
          grainState.on = true;
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          applyFrame();
          applyOptics();
          applyGrain();
        },
      },
      "reset",
    )
    .name("reset all");

  if (window.innerWidth < 720) gui.close(); // don't cover the page on phones
  return gui;
}
