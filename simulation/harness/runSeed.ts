// simulation/harness/runSeed.ts
// Runs one seed to completion in memory: creates the world, optionally strips
// the fantasy arc, ticks it seed.days worth of ticks with a seeded rng (so the
// same seed always replays identically — see the determinism-fix commit), and
// collects metrics along the way. Console output is silenced for the duration.

import seedrandom from 'seedrandom';
import type { WorldState } from '@shared/types.js';
import { createWorldState, tick } from '../tick.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { stripFantasy } from './fantasyStrip.js';
import { silenceConsole, restoreConsole } from './consoleSilence.js';
import { newEventsThisTick } from './eventScan.js';
import { SeedMetricsCollector } from './metrics.js';
import { FantasyMetricsCollector } from './fantasyMetrics.js';
import { shouldFakeChronicle, appendFakeChroniclePage } from './fakeChronicle.js';
import type { ConstantOverride, SeedResult } from './types.js';

export interface RunSeedOptions {
  seed: number;
  days: number;
  keepFantasy: boolean;
  // Runs the real chronicle selection logic (packThreads) at production
  // cadence with placeholder prose — no LLM call — so the light Conduit-bond
  // path (gated on chronicle mentions) becomes reachable. See fakeChronicle.ts.
  fakeChronicle: boolean;
  sampleEveryTicks: number;
  // Which constant overrides were in effect when this seed ran (caller applies
  // them to RELATIONSHIP_CONSTANTS/CONDUIT_CONSTANTS before calling runSeed —
  // this is carried through purely for CSV/report labeling).
  combination: ConstantOverride[];
}

export function runSeed(options: RunSeedOptions): SeedResult {
  const { seed, days, keepFantasy, fakeChronicle, sampleEveryTicks, combination } = options;
  const worldId = `windtunnel_${seed}`;

  const state: WorldState = createWorldState(seed, worldId);
  if (!keepFantasy) stripFantasy(state);

  const rng = seedrandom(String(seed)) as () => number;
  const totalTicks = days * TICKS_PER_DAY;

  const metrics = new SeedMetricsCollector(seed);
  const fantasy = keepFantasy ? new FantasyMetricsCollector() : null;

  silenceConsole();
  try {
    for (let i = 0; i < totalTicks; i++) {
      const tickNumberBeforeCall = state.tick;
      const summary = tick(state, rng);

      // Scan only this tick's new events (see eventScan.ts — the log is capped
      // at 500 and a once-at-the-end read would silently drop most of a long run).
      const newEvents = newEventsThisTick(state, tickNumberBeforeCall);
      metrics.onEvents(newEvents, summary.day);
      metrics.onTickSummary(summary);

      if (fantasy !== null) {
        fantasy.onEvents(newEvents, summary.day);
        fantasy.onTick(state); // pilgrimage detection needs tick, not sample, granularity
      }

      if (fakeChronicle && shouldFakeChronicle(state)) {
        appendFakeChroniclePage(state);
      }

      if (state.tick % sampleEveryTicks === 0) {
        metrics.sample(state, summary.day);
        fantasy?.sample(state);
      }
    }

    // Guarantee a final snapshot even if totalTicks isn't a multiple of
    // sampleEveryTicks, so "at end" metrics (bonds, north-most reach, control)
    // reflect the true final state rather than a slightly-stale last sample.
    metrics.sample(state, state.day);
    fantasy?.sample(state);
  } finally {
    restoreConsole();
  }

  return {
    metrics: metrics.finalize(),
    fantasy: fantasy !== null ? fantasy.finalize(state) : null,
    combination,
  };
}
