/**
 * A frame-rate readout, for measuring what the film costs on a device without
 * developer tools (e.g. a phone). It counts animation frames over the last
 * second, and reports the longest single frame in it: stutter comes from one
 * heavy frame at a time, which an average hides.
 */
export interface FpsMeter {
  show(on: boolean): void;
  destroy(): void;
}

/** `report` gets the readout a few times a second, and null when hidden. */
export function createFpsMeter(report: (text: string | null) => void): FpsMeter {
  const times: number[] = [];
  let raf = 0;
  let lastReport = 0;

  const tick = (now: number) => {
    times.push(now);
    while (times.length && now - times[0] > 1000) times.shift();
    if (now - lastReport > 250 && times.length > 1) {
      lastReport = now;
      let worst = 0;
      for (let i = 1; i < times.length; i++)
        worst = Math.max(worst, times[i] - times[i - 1]);
      const fps = ((times.length - 1) * 1000) / (now - times[0]);
      report(`${fps.toFixed(0)} fps · worst ${worst.toFixed(0)} ms`);
    }
    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    times.length = 0;
  };

  return {
    show(on) {
      stop();
      report(on ? "…" : null);
      if (on) raf = requestAnimationFrame(tick);
    },
    destroy: stop,
  };
}
