import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createFilm, inkFilter, type Film } from "filmic";
import { createControls } from "./controls";
import { createCursor } from "./cursor";
import { HORIZON_FILM, HORIZON_INK } from "./look";
import { createPlay } from "./play";
import { horizonScene } from "./scene";
import { Title } from "./Title";

const INK_ID = "horizon-ink";
const TITLE = "filmic";

// Intro timeline, in seconds. The fade from black is a plain CSS animation
// (see .fade in index.css), so it runs at the screen's refresh rate. The
// title rise is timed with film.frameTime(), so it steps with the footage.
const RISE_START = 0.35;
const RISE_DUR = 1.4;
// The blob is drawn on twos: twice the footage's 12 fps, so chasing the
// pointer reads smoothly. The frames in between keep the footage frame's
// grain and weave.
const BLOB_FPS = 24;
// On a touch screen, a touch this near the target ring (px from its center)
// picks it up to drag, instead of scrolling the page.
const RING_REACH = 48;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/**
 * The page: a filmed planet behind everything, the curved title over it, and
 * below that, room to play (see Play).
 *
 * Two clocks run side by side. What follows input moves at the screen's
 * refresh rate: the page scrolls natively, the scene redraws on every scroll
 * to follow it, and the target ring tracks the pointer. What animates on its
 * own steps in frames: the title's rise and melt with the film at 12 fps,
 * and the blob at twice that.
 *
 * The page scrolls inside a screen-sized stage rather than the window, so
 * how far it scrolls doesn't change as a phone's toolbar grows and shrinks.
 * Nothing is fixed-position either: Safari 26 on iOS tints its status bar
 * and toolbar with the background of a fixed element at the screen's edge.
 */
export function Showcase() {
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<Film | null>(null);
  const [play] = useState(createPlay);
  const [text, setText] = useState(TITLE);
  const [plain, setPlain] = useState(false);
  const [started, setStarted] = useState(false);
  const [introKey, setIntroKey] = useState(0);
  const [rise, setRise] = useState(0);
  const [melt, setMelt] = useState({ amount: 0, boil: 0, hidden: false });

  useEffect(() => {
    const stage = stageRef.current!;
    const scroller = scrollerRef.current!;
    // Keyboard scrolling goes to the focused scroller.
    scroller.focus({ preventScroll: true });

    // The blob's clock: stepped to its own frame rate while the footage
    // plays (its frames line up with the footage's), or smooth otherwise.
    let blobFps = BLOB_FPS; // (tunable in the panel)
    const blobTime = () => {
      const now = performance.now();
      return film.frameTime(now) === now
        ? now
        : (Math.floor((now * blobFps) / 1000) * 1000) / blobFps;
    };
    let blobDrawn = NaN;

    const film: Film = createFilm(canvasRef.current!, {
      source: horizonScene((view) => {
        // Read the scroll as the frame is drawn, so the scene is exactly
        // where the page is.
        const scroll = scroller.scrollTop;
        blobDrawn = blobTime();
        play.advance(film.frameTime(), blobDrawn, view.width, view.height, scroll);
        return { scroll, blob: play.shape };
      }),
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

    // --- Input: at the screen's rate ---
    // Scrolling redraws the scene right away (it keeps the film frame's
    // grain; only the picture moves).
    const onScroll = () => film.render();

    // The canvas stops short of the page's scrollbar (where it has one), so
    // it's exactly as wide as the title's layout.
    const gutter = new ResizeObserver(() =>
      stage.style.setProperty(
        "--gutter",
        `${scroller.offsetWidth - scroller.clientWidth}px`,
      ),
    );
    gutter.observe(scroller);

    // Pointer positions on the stage (and so on the canvas).
    const onStage = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    // With a mouse, the target is the pointer and the ring replaces it. On a
    // touch screen, dragging scrolls, so a tap moves the target instead, or
    // a drag that starts on the ring moves it along.
    const root = document.documentElement;
    const cursor = createCursor(ink, stage);
    let mouse = matchMedia("(hover: hover)").matches;
    let inside = !mouse; // the pointer is over the page
    let wasFree = false;
    const showCursor = () => {
      const free = play.free;
      if (free && !wasFree && !mouse) {
        const { x, y } = play.target;
        cursor.moveTo(x, y);
      }
      wasFree = free;
      cursor.show(free && inside);
      root.classList.toggle("no-cursor", free && mouse);
    };
    // The touch dragging the ring, if one is, and how far the ring is from
    // it (so it doesn't jump to the finger).
    let drag: { id: number; dx: number; dy: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        const { x, y } = onStage(e);
        play.pointTo(x + drag.dx, y + drag.dy);
        cursor.moveTo(x + drag.dx, y + drag.dy);
        return;
      }
      if (e.pointerType === "touch") return;
      mouse = inside = true;
      const { x, y } = onStage(e);
      play.pointTo(x, y);
      cursor.moveTo(x, y);
      showCursor();
    };
    const onLeave = () => {
      if (!mouse) return;
      inside = false;
      showCursor();
    };
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        // Most of the page can't be selected (see .page), so the browser
        // leaves a selection alone when you click it. Clear it by hand.
        const el = e.target as Element;
        if (e.button === 0 && !el.closest?.(".title, .subtitle, .lil-gui"))
          getSelection()?.removeAllRanges();
        return cursor.press(true);
      }
      if ((e.target as Element).closest?.(".lil-gui")) return;
      if (play.free && !drag) {
        const { x, y } = onStage(e);
        const ring = play.target;
        if (Math.hypot(x - ring.x, y - ring.y) < RING_REACH) {
          drag = { id: e.pointerId, dx: ring.x - x, dy: ring.y - y };
          cursor.moveTo(ring.x, ring.y); // (ending any glide)
          cursor.hold(true);
          return;
        }
      }
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    // A touch that picked up the ring drags it, rather than the page.
    const onTouchStart = (e: TouchEvent) => {
      if (drag) e.preventDefault();
    };
    const letGo = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return false;
      drag = null;
      cursor.hold(false);
      return true;
    };
    const onUp = (e: PointerEvent) => {
      cursor.press(false);
      if (letGo(e)) return;
      if (!tap || e.pointerId !== tap.id) return;
      const quick =
        e.timeStamp - tap.t < 400 &&
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12;
      tap = null;
      if (!quick || !play.free) return;
      const { x, y } = onStage(e);
      play.pointTo(x, y);
      cursor.moveTo(x, y, true);
    };
    const onCancel = (e: PointerEvent) => {
      tap = null;
      cursor.press(false);
      letGo(e);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    stage.addEventListener("touchstart", onTouchStart, { passive: false });

    // --- Animation: with the film ---
    // The scene steps the blob and the melt as it draws; the title follows
    // here, in the same animation frame, so the ink changes hands cleanly.
    let shown = -1;
    const offFrame = film.on("frame", (f) => {
      if (play.version !== shown) {
        shown = play.version;
        flushSync(() =>
          setMelt({ amount: play.melt, boil: f.n, hidden: play.loose }),
        );
      }
      showCursor();
      // Without footage nothing else redraws, so keep going while it moves.
      if (!f.playing && play.moving) film.render();
    });

    // With footage, draw the blob's frames that fall between the footage's.
    let raf = 0;
    const blobFrames = () => {
      raf = requestAnimationFrame(blobFrames);
      if (play.loose && blobTime() !== blobDrawn) film.render();
    };
    blobFrames();

    const controls = createControls(film, {
      ink,
      text: TITLE,
      setText,
      setPlain,
      setBoil(on) {
        detach();
        detach = film.attach(layer, on ? { ink } : {});
      },
      replay() {
        scroller.scrollTo(0, 0);
        play.reset();
        setIntroKey((k) => k + 1);
      },
      get blobFps() {
        return blobFps;
      },
      set blobFps(fps) {
        blobFps = fps;
      },
      defaultBlobFps: BLOB_FPS,
    });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      gutter.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("touchstart", onTouchStart);
      root.classList.remove("no-cursor");
      offFrame();
      cancelAnimationFrame(raf);
      cursor.destroy();
      controls.destroy();
      unsync();
      detach();
      ink.destroy();
      film.destroy();
      filmRef.current = null;
    };
  }, [play]);

  // Intro: once fonts are ready, fade in from black and raise the title.
  useEffect(() => {
    let live = true;
    let raf = 0;
    play.setReady(false);
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
        else play.setReady(true);
      };
      tick();
    });
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
  }, [introKey, play]);

  // The ink goes on the text, and its halation glow on the element around it
  // (see inkFilter's `glow`).
  const filter = plain ? undefined : `url(#${INK_ID})`;
  const glow = `var(--${INK_ID}-glow)`;
  return (
    <div ref={stageRef} className="stage">
      <canvas ref={canvasRef} className="film" />
      <div key={introKey} className={started ? "fade play" : "fade"} />
      <main ref={scrollerRef} className="page" tabIndex={-1}>
        <section className="hero">
          <div ref={layerRef} className="film-layer">
            <Title
              text={text}
              rise={rise}
              filter={filter}
              glow={glow}
              melt={melt.amount}
              boil={melt.boil}
              hidden={melt.hidden}
              onAnchor={play.setAnchor}
            >
              {started && (
                // Plain HTML text with the same ink. The paragraph glows and
                // animates in; the span inside it is inked.
                <p key={introKey} className="subtitle" style={{ filter: glow }}>
                  <span style={{ filter }}>A procedural film look for the web</span>
                </p>
              )}
            </Title>
          </div>
        </section>
        {/* Where the blob plays. It lives on the screen, over the scene. */}
        <section className="play-area" />
      </main>
    </div>
  );
}
