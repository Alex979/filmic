import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { horizonCircle } from "./horizonGradient";
import { clamp } from "./math";
import type { Anchor } from "./play";

const ease = {
  in: (t: number) => t * t,
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
  /**
   * CSS filter for the title's halation (an ink filter's `glow`), if any. It
   * goes on an HTML wrapper: Safari ignores it on SVG elements.
   */
  glow?: string;
  /**
   * How melted the title is: 0 = text, 1 = its letters pushed together and
   * run into one drop of ink (see Play).
   */
  melt?: number;
  /** Hide the text (its ink is out as the blob). */
  hidden?: boolean;
  /** Where the letters gather as they melt, whenever that moves. */
  onAnchor?: (anchor: Anchor) => void;
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
 *
 * It can also melt: the letters slide together along the arc and shrink,
 * while a "goo" filter (a growing blur cut back to a hard edge) rounds them
 * off and runs them into one drop. The ink prints over that, so the drop
 * keeps the title's rough, boiling edge.
 */
export function Title({
  text,
  rise,
  filter,
  glow,
  melt = 0,
  hidden = false,
  onAnchor,
  children,
}: TitleProps) {
  const glowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const sweepRef = useRef<SVGLinearGradientElement>(null);
  const uid = useId().replace(/[^\w-]/g, "");
  const [view, setView] = useState({ W: 0, H: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  // Text width per 1px of font size, so long titles can shrink to fit.
  const [widthPerPx, setWidthPerPx] = useState(0);

  // The title is laid out over its container (the same box as the canvas).
  useLayoutEffect(() => {
    const container = glowRef.current!.parentElement!;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentBoxSize[0];
      setView({ W: box.inlineSize, H: box.blockSize });
    });
    observer.observe(container);
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
  const maskR = Math.max(1, hi + 1); // never negative, even before the first measure
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

  // The title's strip of the screen: from above its tallest letters to below
  // the apex, where it rises from. The SVG and its glow cover only this, not
  // the whole screen, because the glow is redrawn over its whole area each
  // time the ink boils, and phones feel every pixel of it. The SVG keeps
  // screen coordinates (its viewBox starts at the strip's top).
  const apexY = circle.cy - circle.r;

  // --- Melt ---
  // The letters gather around the middle of the word, a little above the
  // baseline at the apex.
  const ax = circle.cx;
  const ay = apexY - 0.24 * size - 0.3 * size;
  useLayoutEffect(() => {
    if (W) onAnchor?.({ x: ax, y: ay, size });
  }, [W, ax, ay, size, onAnchor]);
  const m = clamp(melt, 0, 1);
  const goo = ease.in(m);
  const squeeze = -0.36 * ease.inOut(m);
  const shrink = 1 - 0.5 * goo;
  // The goo, in the text's own px: thicken the strokes, blur them together,
  // then cut the blur back to an edge about a px wide.
  const dilate = Math.max(0.01, 0.04 * size * goo);
  const sigma = 0.35 + 0.1 * size * goo;
  const firm = Math.max(1.2, 2.4 * sigma);
  const cut = 0.42;

  const bandTop = Math.max(0, apexY - 1.35 * size);
  const bandHeight = Math.max(1, Math.min(H, apexY + 0.9 * size) - bandTop);

  const big = 10000;
  const fullRect = { x: -big, y: -big, width: 2 * big, height: 2 * big };

  return (
    <>
      <div
        ref={glowRef}
        className="title-glow"
        style={{ filter: glow, top: `${bandTop.toFixed(1)}px`, height: `${bandHeight.toFixed(1)}px` }}
      >
        <svg className="overlay" viewBox={`0 ${bandTop.toFixed(1)} ${W || 1} ${bandHeight.toFixed(1)}`}>
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

            {m > 0 && (
              <filter
                id={`${uid}-melt`}
                filterUnits="userSpaceOnUse"
                x={0}
                y={bandTop.toFixed(1)}
                width={W || 1}
                height={bandHeight.toFixed(1)}
                colorInterpolationFilters="sRGB"
              >
                <feMorphology in="SourceGraphic" operator="dilate" radius={dilate.toFixed(2)} result="fat" />
                <feGaussianBlur in="fat" stdDeviation={sigma.toFixed(2)} result="soft" />
                <feComponentTransfer in="soft">
                  <feFuncA type="linear" slope={firm.toFixed(3)} intercept={(0.5 - firm * cut).toFixed(3)} />
                </feComponentTransfer>
              </filter>
            )}
          </defs>

          {W > 0 && (
            <g
              mask={o < 1 ? `url(#${uid}-sky-mask)` : undefined}
              transform={
                m > 0
                  ? `translate(${ax.toFixed(1)} ${ay.toFixed(1)}) scale(${shrink.toFixed(4)}) translate(${(-ax).toFixed(1)} ${(-ay).toFixed(1)})`
                  : undefined
              }
            >
              {/* The ink prints whatever the text becomes, melted or not. */}
              <g
                transform={lift ? `translate(0 ${lift.toFixed(1)})` : undefined}
                style={{ filter }}
              >
                <text
                  ref={textRef}
                  className="title"
                  role="heading"
                  aria-level={1}
                  fontSize={size.toFixed(1)}
                  textAnchor="middle"
                  opacity={o > 0.001 && !hidden ? 1 : 0}
                  letterSpacing={m > 0 ? `${squeeze.toFixed(4)}em` : undefined}
                  style={{ filter: m > 0 ? `url(#${uid}-melt)` : undefined }}
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
      </div>
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
