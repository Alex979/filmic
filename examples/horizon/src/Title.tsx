import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { horizonCircle } from "./horizonGradient";

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/** An arc of +-1.1 rad around the top of a circle. */
function arcPath(cx: number, cy: number, r: number) {
  const sx = Math.sin(1.1) * r;
  const sy = Math.cos(1.1) * r;
  const f = (n: number) => n.toFixed(1);
  return `M${f(cx - sx)} ${f(cy - sy)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + sx)} ${f(cy - sy)}`;
}

interface TitleProps {
  text: string;
  /** CSS filter to print the title with (an ink filter's url), if any. */
  filter?: string;
}

/**
 * The title, set along an arc just above the horizon. It's real SVG text, so
 * it can be selected, found and read by screen readers; the ink filter gives
 * it the printed-on-film look.
 */
export function Title({ text, filter }: TitleProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const arcId = useId();
  const [view, setView] = useState({ W: 0, H: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  // Text width per 1px of font size, so long titles can shrink to fit.
  const [widthPerPx, setWidthPerPx] = useState(0);

  useLayoutEffect(() => {
    const svg = svgRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentBoxSize[0];
      setView({ W: box.inlineSize, H: box.blockSize });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !view.W) return;
    const fontSize = parseFloat(el.getAttribute("font-size") || "16");
    setWidthPerPx(el.getComputedTextLength() / fontSize);
  }, [text, fontsReady, view.W]);

  const { W, H } = view;
  const circle = horizonCircle(W, H);

  // About 6.6% of the width, within limits, and never wider than 84% of it.
  let size = clamp(0.066 * W, 34, 112);
  if (widthPerPx > 0) size = Math.min(size, (0.84 * W) / widthPerPx);
  // The baseline sits 0.24em above the horizon, on a circle around the same
  // center, so the title follows its curve.
  const arcR = circle.r + 0.24 * size + (W <= 760 ? 16 : 0);

  return (
    <svg ref={svgRef} className="overlay" viewBox={`0 0 ${W || 1} ${H || 1}`}>
      <defs>
        <path id={arcId} d={arcPath(circle.cx, circle.cy, arcR)} fill="none" />
      </defs>
      {W > 0 && (
        <text
          ref={textRef}
          className="title"
          role="heading"
          aria-level={1}
          fontSize={size.toFixed(1)}
          textAnchor="middle"
          filter={filter}
        >
          <textPath href={`#${arcId}`} startOffset="50%">
            {text}
          </textPath>
        </text>
      )}
    </svg>
  );
}
