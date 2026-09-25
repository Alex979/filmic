/** Small numeric helpers, shared across the example. */

export const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/**
 * One step of `h` seconds of a damped spring pulling `x` (moving at `v`)
 * toward `goal`: `omega` is how quick it is (rad/s), `zeta` how damped (1 =
 * just no overshoot, less = some). Semi-implicit Euler, so keep `h` well
 * under 1 / omega. Returns the new position and velocity.
 */
export function spring(
  x: number,
  v: number,
  goal: number,
  omega: number,
  zeta: number,
  h: number,
): [number, number] {
  const next = v + (omega * omega * (goal - x) - 2 * zeta * omega * v) * h;
  return [x + next * h, next];
}
