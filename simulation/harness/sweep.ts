// simulation/harness/sweep.ts
// Cross-product expansion for --sweep KEY=v1,v2,... (repeatable — one SweepSpec
// per flag occurrence). Each resulting combination is a full assignment, one
// value per swept key, run through every seed (run.ts does the seed loop).

import type { ConstantOverride, SweepSpec } from './types.js';

export function expandSweep(specs: SweepSpec[]): ConstantOverride[][] {
  if (specs.length === 0) return [[]];

  let combinations: ConstantOverride[][] = [[]];
  for (const spec of specs) {
    const next: ConstantOverride[][] = [];
    for (const combo of combinations) {
      for (const value of spec.values) {
        next.push([...combo, { key: spec.key, value }]);
      }
    }
    combinations = next;
  }
  return combinations;
}
