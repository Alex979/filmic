import { horizonGradient } from "filmic";
import type { DemoInstance } from "./types";

/** A procedural shader source: fills whatever canvas it's given. */
export function gradientDemo(): DemoInstance {
  return { source: () => horizonGradient(), dispose() {} };
}
