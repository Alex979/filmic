import { useEffect, useRef } from "react";
import { createFilm, horizonGradient } from "filmic";
import { createControls } from "./controls";

/** A full-bleed canvas driven by filmic, with a tuning panel. */
export function FilmCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const film = createFilm(canvasRef.current!, {
      source: horizonGradient(),
    });
    const controls = createControls(film);
    return () => {
      controls.destroy();
      film.destroy();
    };
  }, []);

  return <canvas ref={canvasRef} className="film" />;
}
