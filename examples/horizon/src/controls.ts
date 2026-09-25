import GUI from "lil-gui";
import { createFpsMeter } from "./fpsMeter";
import { HORIZON_FILM, HORIZON_INK } from "./look";
import {
  DEFAULT_DUST,
  DEFAULT_FOOTAGE,
  DEFAULT_FRAME,
  DEFAULT_GRAIN,
  DEFAULT_HALATION,
  DEFAULT_INK,
  DEFAULT_MOTTLE,
  DEFAULT_OPTICS,
  type Film,
  type FrameFit,
  type InkFilter,
} from "filmic";

interface TitleControls {
  ink: InkFilter;
  text: string;
  setText(text: string): void;
  setPlain(plain: boolean): void;
  /** Boil the ink's noise every footage frame. */
  setBoil(on: boolean): void;
  /** Play the intro again. */
  replay(): void;
  /** The blob's frame rate while the footage plays, and its default. */
  blobFps: number;
  defaultBlobFps: number;
}

/** A tuning panel for a film. Returns the panel so the caller can destroy it. */
export function createControls(film: Film, title: TitleControls): GUI {
  const gui = new GUI({ title: "filmic" });
  const refresh = (folder: GUI) =>
    folder.controllersRecursive().forEach((c) => c.updateDisplay());

  // --- Frame rate readout, for measuring on devices without dev tools ---
  // Shown in the panel's title bar, so it's visible open or closed.
  const meter = createFpsMeter((text) =>
    gui.title(text ? `filmic · ${text}` : "filmic"),
  );
  gui
    .add({ fps: false }, "fps")
    .name("show fps")
    .onChange((on: boolean) => meter.show(on));
  const destroy = gui.destroy.bind(gui);
  gui.destroy = () => {
    meter.destroy();
    destroy();
  };

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
  f.add(frame, "fit", ["source", "cover", "contain", "fill", "screen"]).onChange(
    applyFrame,
  );
  f.add(frame, "aspect", 0.5, 3, 0.01).onChange(applyFrame);
  f.add(frame, "anchorX", 0, 1, 0.01).name("anchor x").onChange(applyFrame);
  f.add(frame, "anchorY", 0, 1, 0.01).name("anchor y").onChange(applyFrame);
  f.add(frame, "resolution", 240, 4320, 1)
    .name("resolution (film px tall)")
    .onChange(applyFrame);

  // --- Optics ---
  const optics = { ...s.optics };
  const applyOptics = () => film.set({ optics });
  const o = gui.addFolder("Optics");
  o.add(optics, "blur", 0, 6, 0.05)
    .name("blur (film px)")
    .onChange(applyOptics);

  // --- Halation ---
  const halation = { ...s.halation };
  const halationState = { on: s.halation.amount > 0 };
  const applyHalation = () =>
    film.set({
      halation: { ...halation, amount: halationState.on ? halation.amount : 0 },
    });
  const h = gui.addFolder("Halation");
  h.add(halationState, "on").name("enabled").onChange(applyHalation);
  h.add(halation, "amount", 0, 3, 0.01).onChange(applyHalation);
  h.add(halation, "threshold", 0, 1, 0.01).onChange(applyHalation);
  h.add(halation, "radius", 1, 80, 0.5)
    .name("radius (film px)")
    .onChange(applyHalation);
  h.addColor(halation, "color").onChange(applyHalation);

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


  // --- Title ---
  const titleState = { text: title.text, on: true };
  const ink = { ...title.ink.options };
  const applyInk = () => title.ink.set(ink);
  const t = gui.addFolder("Title");
  t.add(titleState, "text").onChange((v: string) => title.setText(v));
  t.add(titleState, "on")
    .name("ink")
    .onChange((on: boolean) => title.setPlain(!on));
  t.add(ink, "roughness", 0, 4, 0.01).name("roughness (px)").onChange(applyInk);
  t.add(ink, "softness", 0, 3, 0.01).name("softness (px)").onChange(applyInk);
  t.add(ink, "firmness", 0.5, 3, 0.01).onChange(applyInk);
  t.add(ink, "pinholes", 0, 0.6, 0.005).onChange(applyInk);
  t.add(ink, "seed", 0, 100, 1).onChange(applyInk);
  t.add(ink, "halation", 0, 3, 0.01).name("halation").onChange(applyInk);
  t.add(ink, "halationRadius", 0, 60, 0.5)
    .name("halation radius (px)")
    .onChange(applyInk);
  t.addColor(ink, "halationColor").name("halation color").onChange(applyInk);

  // --- Footage ---
  const footage = { ...s.footage };
  const boil = { on: true };
  const applyFootage = () => film.set({ footage });
  const fo = gui.addFolder("Footage");
  fo.add(footage, "enabled").name("animated").onChange(applyFootage);
  fo.add(footage, "fps", 1, 60, 1).name("frame rate (fps)").onChange(applyFootage);
  fo.add(title, "blobFps", 1, 60, 1).name("blob frame rate (fps)");
  fo.add(footage, "grain").name("new grain every frame").onChange(applyFootage);
  fo.add(boil, "on")
    .name("boil title ink")
    .onChange((on: boolean) => title.setBoil(on));
  fo.add(footage, "weave", 0, 4, 0.01).name("weave (film px)").onChange(applyFootage);
  fo.add(footage, "weaveRotation", 0, 0.2, 0.001)
    .name("weave rotation (deg)")
    .onChange(applyFootage);
  fo.add(footage, "flicker", 0, 0.2, 0.001).onChange(applyFootage);
  fo.add(footage, "dustRate", 0, 240, 1).name("dust per frame").onChange(applyFootage);
  fo.add(footage, "dustLinger", 0, 1, 0.01).name("dust linger chance").onChange(applyFootage);
  fo.add(footage, "seed", 0, 100, 1).onChange(applyFootage);
  fo.add(title, "replay").name("replay intro");

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
          Object.assign(halation, DEFAULT_HALATION, HORIZON_FILM.halation);
          halationState.on = true;
          Object.assign(mottle, DEFAULT_MOTTLE);
          mottleState.on = true;
          Object.assign(grain, DEFAULT_GRAIN);
          grainState.on = true;
          Object.assign(dust, DEFAULT_DUST);
          dustState.on = true;
          Object.assign(ink, DEFAULT_INK, HORIZON_INK);
          titleState.on = true;
          title.setPlain(false);
          applyInk();
          // This example plays as footage by default.
          Object.assign(footage, DEFAULT_FOOTAGE, { enabled: true });
          title.blobFps = title.defaultBlobFps;
          boil.on = true;
          title.setBoil(true);
          applyFootage();
          refresh(gui);
          applyFrame();
          applyOptics();
          applyHalation();
          applyMottle();
          applyGrain();
          applyDust();
        },
      },
      "reset",
    )
    .name("reset all");

  // Start collapsed, with every section closed: a small title bar over the
  // film until someone opens it.
  gui.folders.forEach((folder) => folder.close());
  gui.close();
  return gui;
}
