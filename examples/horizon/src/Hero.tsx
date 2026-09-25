import { useEffect, useRef, useState } from "react";
import { createFilm, inkFilter } from "filmic";
import { horizonGradient } from "./horizonGradient";
import { createControls } from "./controls";
import { Title } from "./Title";

const INK_ID = "horizon-ink";

/** The full-bleed filmed horizon, the curved title, and a tuning panel. */
export function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState("Horizon");
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    const film = createFilm(canvasRef.current!, {
      source: horizonGradient(),
    });
    const ink = inkFilter({}, INK_ID);
    const controls = createControls(film, {
      ink,
      text: "Horizon",
      setText,
      setPlain,
    });
    return () => {
      controls.destroy();
      ink.destroy();
      film.destroy();
    };
  }, []);

  const filter = plain ? undefined : `url(#${INK_ID})`;
  return (
    <>
      <canvas ref={canvasRef} className="film" />
      <Title text={text} filter={filter} />
      {/* Plain HTML text with the same ink, via CSS. Editable, to try the
          cursor and selection under the filter. */}
      <p
        className="subtitle"
        style={{ filter }}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
      >
        A procedural film look for the web
      </p>
    </>
  );
}
