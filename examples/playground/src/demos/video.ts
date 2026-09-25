import { elementSource } from "filmic";
import type { DemoInstance } from "./types";

/**
 * A real <video> element, playing a countdown leader recorded live from a
 * canvas (so the repo doesn't need a video file). 4:3 and 24 fps, so the fit
 * and the once-per-video-frame redraws are easy to see.
 */
export function videoDemo(): DemoInstance {
  const W = 960;
  const H = 720;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  let raf = 0;

  const draw = (t: number) => {
    const s = t / 1000;
    const number = 8 - (Math.floor(s) % 7); // 8, 7, ... 2, then again
    const sweep = (s % 1) * Math.PI * 2;
    const cx = W / 2;
    const cy = H / 2;

    ctx.fillStyle = "#9a948c";
    ctx.fillRect(0, 0, W, H);
    // the sweep: a darker wedge growing clockwise from 12 o'clock
    ctx.fillStyle = "#5e5953";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 700, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.fill();

    ctx.strokeStyle = "#f4f1ea";
    ctx.lineWidth = 6;
    for (const r of [230, 280]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();

    ctx.fillStyle = "#1b1917";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 300px Helvetica, Arial, sans-serif";
    ctx.fillText(String(number), cx, cy + 12);

    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  const stream = canvas.captureStream(24);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {}); // rejects if paused before it starts; harmless

  return {
    source: (fit) => elementSource(video, { fit }),
    dispose() {
      cancelAnimationFrame(raf);
      video.pause();
      video.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
