import { useEffect, useRef } from "react";
import { createFilm } from "filmic";

/** A full-bleed canvas driven by filmic. */
export function FilmCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const film = createFilm(canvasRef.current!);
    return () => film.destroy();
  }, []);

  return <canvas ref={canvasRef} className="film" />;
}
