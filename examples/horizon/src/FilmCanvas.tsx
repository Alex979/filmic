import { useEffect, useRef } from "react";
import { createFilm, horizonGradient } from "filmic";

/** A full-bleed canvas driven by filmic. */
export function FilmCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const film = createFilm(canvasRef.current!, {
      source: horizonGradient(),
    });
    return () => film.destroy();
  }, []);

  return <canvas ref={canvasRef} className="film" />;
}
