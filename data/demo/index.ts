import { generateDemoDataset, type DemoDataset } from "./generate";

export * from "./neighbourhood-profiles";
export * from "./lenders";
export * from "./sources";
export type { DemoDataset } from "./generate";

/**
 * The dataset is generated once per process and reused. Building it is cheap
 * (a few thousand rows of arithmetic) but doing it per request would be wasteful,
 * and — more importantly — a module-level cache is the same shape a real database
 * connection pool takes, so swapping one for the other changes little.
 */
let cached: DemoDataset | null = null;

export function getDemoDataset(): DemoDataset {
  if (!cached) {
    cached = generateDemoDataset();
  }
  return cached;
}
