import { useEffect, useRef, useState } from "react";
import { createFilm, inkFilter, type Film } from "filmic";
import { horizonGradient } from "./horizonGradient";
import { createControls } from "./controls";
import { HORIZON_FILM, HORIZON_INK } from "./look";
import { Title } from "./Title";

const INK_ID = "horizon-ink";
const TITLE = "filmic";

// Intro timeline, in seconds. The fade from black is a plain CSS animation
// (see .fade in index.css), so it runs at the screen's refresh rate. The
// title rise is timed with film.frameTime(), so it steps with the footage.
const RISE_START = 0.35;
const RISE_DUR = 1.4;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/** The full-bleed filmed horizon, the curved title, and a tuning panel. */
export function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<Film | null>(null);
  const [text, setText] = useState(TITLE);
  const [plain, setPlain] = useState(false);
  const [started, setStarted] = useState(false);
  const [introKey, setIntroKey] = useState(0);
  const [rise, setRise] = useState(0);

  useEffect(() => {
    const film = createFilm(canvasRef.current!, {
      source: horizonGradient(),
      footage: { enabled: true },
      ...HORIZON_FILM,
    });
    filmRef.current = film;
    const ink = inkFilter(HORIZON_INK, INK_ID);

    // The title and subheading sit above the canvas, in a layer that moves
    // with the film: its weave, its flicker, and ink that boils every frame.
    // Its CSS animations (the subheading's) step at the footage frame rate.
    const layer = layerRef.current!;
    let detach = film.attach(layer, { ink });
    const unsync = film.sync(layer);

    const controls = createControls(film, {
      ink,
      text: TITLE,
      setText,
      setPlain,
      setBoil(on) {
        detach();
        detach = film.attach(layer, on ? { ink } : {});
      },
      replay: () => setIntroKey((k) => k + 1),
    });
    return () => {
      controls.destroy();
      unsync();
      detach();
      ink.destroy();
      film.destroy();
      filmRef.current = null;
    };
  }, []);

  // Intro: once fonts are ready, fade in from black and raise the title.
  useEffect(() => {
    let live = true;
    let raf = 0;
    document.fonts.ready.then(() => {
      if (!live) return;
      setStarted(true);
      const t0 = performance.now();
      const tick = () => {
        const film = filmRef.current;
        if (!film) return;
        // Film time: stepped to the footage frame rate while footage plays.
        const t = Math.max(0, (film.frameTime() - t0) / 1000);
        const next = clamp((t - RISE_START) / RISE_DUR, 0, 1);
        setRise(next);
        if (next < 1) raf = requestAnimationFrame(tick);
      };
      tick();
    });
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
  }, [introKey]);

  // The ink and its halation glow (see inkFilter's `filter`).
  const filter = plain ? undefined : `var(--${INK_ID})`;
  return (
    <>
      <canvas ref={canvasRef} className="film" />
      <div key={introKey} className={started ? "fade play" : "fade"} />
      <div ref={layerRef} className="film-layer">
        <Title text={text} rise={rise} filter={filter}>
          {started && (
            // Plain HTML text with the same ink, via CSS.
            <p key={introKey} className="subtitle" style={{ filter }}>
              A procedural film look for the web
            </p>
          )}
        </Title>
      </div>
    </>
  );
}
