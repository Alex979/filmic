import { useEffect, useRef, useState, type DragEvent } from "react";
import { createFilm, type Film } from "filmic";
import { addFilm } from "./films";
import type { DemoInstance, Fit } from "./demos/types";

const FITS: Fit[] = ["cover", "contain", "fill"];

interface DemoProps {
  title: string;
  note: string;
  /** Starts the demo. Must be a stable function (not recreated per render). */
  create: () => DemoInstance;
  /** Show cover / contain / fill buttons. */
  fits?: boolean;
  /** Accept dropped image and video files. */
  droppable?: boolean;
  wide?: boolean;
}

/** A card with its own filmed canvas, sized by the page layout. */
export function Demo({ title, note, create, fits, droppable, wide }: DemoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ film: Film; demo: DemoInstance } | null>(null);
  const [fit, setFit] = useState<Fit>("cover");
  const fitRef = useRef(fit);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const demo = create();
    const film = createFilm(canvasRef.current!, {
      source: demo.source(fitRef.current),
    });
    const remove = addFilm(film);
    live.current = { film, demo };
    return () => {
      live.current = null;
      remove();
      film.destroy();
      demo.dispose();
    };
  }, [create]);

  const changeFit = (next: Fit) => {
    setFit(next);
    fitRef.current = next;
    if (live.current)
      live.current.film.set({ source: live.current.demo.source(next) });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    const current = live.current;
    if (file && current?.demo.drop?.(file))
      current.film.set({ source: current.demo.source(fitRef.current) });
  };

  const dropProps = droppable
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop,
      }
    : {};

  return (
    <figure className={wide ? "card wide" : "card"}>
      <div className="viewport" data-dragging={dragging || undefined} {...dropProps}>
        <canvas ref={canvasRef} className="film" />
        {droppable && <div className="drop-hint">Drop an image or video</div>}
      </div>
      <figcaption>
        <div>
          <h2>{title}</h2>
          <p>{note}</p>
        </div>
        {fits && (
          <div className="fits" role="group" aria-label="Fit">
            {FITS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={f === fit}
                onClick={() => changeFit(f)}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
