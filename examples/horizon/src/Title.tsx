import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { horizonCircle } from "./horizonGradient";

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

const ease = {
  inOut: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  out: (t: number) => 1 - Math.pow(1 - t, 3),
};

/** An arc of +-1.1 rad around the top of a circle. */
function arcPath(cx: number, cy: number, r: number) {
  const sx = Math.sin(1.1) * r;
  const sy = Math.cos(1.1) * r;
  const f = (n: number) => n.toFixed(1);
  return `M${f(cx - sx)} ${f(cy - sy)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + sx)} ${f(cy - sy)}`;
}

interface TitleProps {
  text: string;
  /** 0 = hidden below the horizon, 1 = fully risen. */
  rise: number;
  /** CSS filter to print the title with (an ink filter's `url`), if any. */
  filter?: string;
  /** Shown centered just below the horizon's apex (the subheading). */
  children?: ReactNode;
}

/**
 * The title, set along an arc just above the horizon. It's real SVG text, so
 * it can be selected, found and read by screen readers; the ink filter gives
 * it the printed-on-film look.
 *
 * It rises out from behind the planet: a mask centered on the horizon hides
 * whatever is below the rim, the text slides up through it, and a soft edge
 * sweeps across from left to right to reveal it.
 */
export function Title({ text, rise, filter, children }: TitleProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const sweepRef = useRef<SVGLinearGradientElement>(null);
  const uid = useId().replace(/[^\w-]/g, "");
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

  // One size for the whole block, growing gently with the width (like CSS
  // `clamp(66px, 46px + 3.8vw, 112px)`): 112px at 1740px wide and up, easing
  // down to 66px at about 530px, so phones still get a sizable title. Never
  // wider than 84% of the width. Everything else below is a ratio of it.
  let size = clamp(46 + 0.038 * W, 66, 112);
  if (widthPerPx > 0) size = Math.min(size, (0.84 * W) / widthPerPx);
  // The baseline sits 0.24em above the horizon, on a circle around the same
  // center, so the title follows its curve.
  const arcR = circle.r + 0.24 * size;
  // The subheading: about a third of the title's size, half a title height
  // below the apex.
  const belowY = circle.cy - circle.r + 0.52 * size;
  const belowSize = 0.32 * size;

  // --- Rise ---
  const o = clamp(rise, 0, 1);
  // Horizon mask: hidden inside radius `lo` (behind the planet), fully
  // visible past `hi`. The band slides up with the title as it rises.
  const bandH = 0.55 * size;
  const travel = ease.inOut(o) * (bandH + 0.3 * size);
  const lo = circle.r - travel;
  const hi = circle.r + bandH - travel;
  const maskR = hi + 1;
  const stops: [number, number][] = [
    [0, 0],
    [0.35, 0.18],
    [0.7, 0.62],
    [1, 1],
  ];
  const lift = 1.08 * size * (1 - ease.out(o));
  const dy = (1 - ease.out(clamp((o - 0.04) / 0.62, 0, 1))) * size * 0.28;
  const sweep = clamp((o - 0.04) / 0.7, 0, 1);

  // Left-to-right reveal: a soft white-to-black edge sliding across the text.
  useLayoutEffect(() => {
    const el = textRef.current;
    const grad = sweepRef.current;
    if (!el || !grad || sweep >= 1) return;
    const bb = el.getBBox();
    if (!bb.width) return;
    grad.setAttribute("x1", bb.x.toFixed(1));
    grad.setAttribute("x2", (bb.x + bb.width).toFixed(1));
    const edge = 1.22 * ease.inOut(sweep) - 0.22;
    const s = grad.querySelectorAll("stop");
    s[1].setAttribute("offset", clamp(edge, 0, 1).toFixed(4));
    s[2].setAttribute("offset", clamp(edge + 0.22, 0, 1).toFixed(4));
  });

  const big = 10000;
  const fullRect = { x: -big, y: -big, width: 2 * big, height: 2 * big };

  return (
    <>
      <svg ref={svgRef} className="overlay" viewBox={`0 0 ${W || 1} ${H || 1}`}>
        <defs>
          <path id={`${uid}-arc`} d={arcPath(circle.cx, circle.cy, arcR)} fill="none" />

          <radialGradient
            id={`${uid}-sky`}
            gradientUnits="userSpaceOnUse"
            cx={circle.cx}
            cy={circle.cy}
            r={maskR}
          >
            {stops.map(([t, a]) => (
              <stop
                key={t}
                offset={((lo + (hi - lo) * t) / maskR).toFixed(6)}
                stopColor="#fff"
                stopOpacity={a}
              />
            ))}
          </radialGradient>
          <mask id={`${uid}-sky-mask`} maskUnits="userSpaceOnUse" {...fullRect}>
            <rect {...fullRect} fill={`url(#${uid}-sky)`} />
          </mask>

          <linearGradient
            id={`${uid}-sweep`}
            ref={sweepRef}
            gradientUnits="userSpaceOnUse"
            y1={0}
            y2={0}
          >
            <stop offset="0" stopColor="#fff" />
            <stop offset="0" stopColor="#fff" />
            <stop offset="0" stopColor="#000" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id={`${uid}-sweep-mask`} maskUnits="userSpaceOnUse" {...fullRect}>
            <rect {...fullRect} fill={`url(#${uid}-sweep)`} />
          </mask>
        </defs>

        {W > 0 && (
          <g mask={o < 1 ? `url(#${uid}-sky-mask)` : undefined}>
            <g transform={lift ? `translate(0 ${lift.toFixed(1)})` : undefined}>
              <text
                ref={textRef}
                className="title"
                role="heading"
                aria-level={1}
                fontSize={size.toFixed(1)}
                textAnchor="middle"
                opacity={o > 0.001 ? 1 : 0}
                style={{ filter }}
                mask={sweep < 1 ? `url(#${uid}-sweep-mask)` : undefined}
              >
                <textPath href={`#${uid}-arc`} startOffset="50%">
                  <tspan dy={dy.toFixed(2)}>{text}</tspan>
                </textPath>
              </text>
            </g>
          </g>
        )}
      </svg>
      {W > 0 && (
        <div
          className="below-horizon"
          style={{
            top: `${belowY.toFixed(1)}px`,
            fontSize: `${belowSize.toFixed(1)}px`,
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}
