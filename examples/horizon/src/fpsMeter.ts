/**
 * A small frame-rate readout, for measuring what the film costs on a device
 * without developer tools (e.g. a phone). It counts animation frames over the
 * last second, and shows the longest single frame in it: stutter comes from
 * one heavy frame at a time, which an average hides.
 */
export interface FpsMeter {
  show(on: boolean): void;
  destroy(): void;
}

export function createFpsMeter(): FpsMeter {
  const el = document.createElement("div");
  el.className = "fps-meter";
  el.hidden = true;
  document.body.append(el);

  const times: number[] = [];
  let raf = 0;
  let lastText = 0;

  const tick = (now: number) => {
    times.push(now);
    while (times.length && now - times[0] > 1000) times.shift();
    if (now - lastText > 250 && times.length > 1) {
      lastText = now;
      let worst = 0;
      for (let i = 1; i < times.length; i++)
        worst = Math.max(worst, times[i] - times[i - 1]);
      const fps = ((times.length - 1) * 1000) / (now - times[0]);
      el.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(0)} ms`;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    show(on) {
      el.hidden = !on;
      cancelAnimationFrame(raf);
      times.length = 0;
      el.textContent = "…";
      if (on) raf = requestAnimationFrame(tick);
    },
    destroy() {
      cancelAnimationFrame(raf);
      el.remove();
    },
  };
}
