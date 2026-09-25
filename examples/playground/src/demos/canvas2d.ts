import { elementSource } from "filmic";
import type { DemoInstance } from "./types";

const ORBS = ["#d9632f", "#e3ae7c", "#5583bd", "#b09aa6", "#9e3c26"];

/**
 * A plain 2D canvas animated by its own loop. `live: true` tells filmic to
 * re-read it every frame. The canvas never goes on the page.
 */
export function canvas2dDemo(): DemoInstance {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;
  let frame = 0;
  let raf = 0;

  const draw = (t: number) => {
    const s = t / 1000;
    ctx.fillStyle = "#141110";
    ctx.fillRect(0, 0, 1280, 720);

    ORBS.forEach((color, i) => {
      const x = 640 + Math.sin(s * (0.35 + i * 0.07) + i * 1.9) * 420;
      const y = 360 + Math.cos(s * (0.28 + i * 0.05) + i * 2.7) * 220;
      const r = 110 + 40 * Math.sin(s * 0.6 + i);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, `${color}00`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#f2ede4";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "italic 160px Georgia, serif";
    ctx.fillText("filmic", 640, 350);
    ctx.font = "22px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`frame ${String(frame++).padStart(6, "0")}`, 40, 680);

    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return {
    source: (fit) => elementSource(canvas, { fit, live: true }),
    dispose: () => cancelAnimationFrame(raf),
  };
}
