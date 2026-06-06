// simulation/index.ts
// Entry point — creates the world, runs the tick loop, handles graceful shutdown.

import 'dotenv/config';
import seedrandom from 'seedrandom';
import { createWorldState, tick } from './tick.js';
import { generateChronicle, shouldGenerateChronicle, ensurePrologueSeeded } from './chronicle/generator.js';
import { generateSummary, shouldGenerateSummary } from './summary/generator.js';
import { startServer } from './server.js';
import { writeCheckpoint, writeAgentPositions, loadCheckpoint } from './firebase.js';

const WORLD_ID = 'world_sample_01';
const SEED = 42;
const RUN_MODE = process.env['RUN_MODE'] ?? 'dev';
const TARGET_TICKS = RUN_MODE === 'production' ? Infinity : 2000;
const TICK_INTERVAL_MS = RUN_MODE === 'production' ? 450000 : 200;
// A production tick is ~7.5 min, so checkpointing every 50 ticks meant persisting
// only every ~6 hours — longer than the deploy container lives, so progress (and
// the landing) never saved and the world replayed the same day forever. Ticks are
// far apart in production, so checkpoint every one; keep the cheap cadence in dev.
const CHECKPOINT_TICK_INTERVAL = RUN_MODE === 'production' ? 1 : 50;

async function main(): Promise<void> {
  const saved = await loadCheckpoint(WORLD_ID);
  const state = saved ?? createWorldState(SEED, WORLD_ID);
  if (saved !== null) {
    console.log(`Resuming from tick ${state.tick}, day ${state.day}`);
    // Backfill fields added after this checkpoint was written, so restored
    // agents don't carry undefined sociability/home into the new drive math.
    for (const agent of state.agents) {
      const traits = agent.traits as typeof agent.traits & { sociability?: number };
      if (typeof traits.sociability !== 'number') {
        traits.sociability = Math.max(0, Math.min(1, 1 - Math.pow(Math.random(), 2.5)));
      }
      const home = agent.home as { x: number; y: number } | undefined;
      if (home === undefined) {
        agent.home = { x: agent.position.x, y: agent.position.y };
      }
      const inventory = agent.inventory as import('@shared/types.js').Inventory | undefined;
      if (inventory === undefined) {
        agent.inventory = { wood: 0, items: [] };
      }
    }
  }
  process.on('SIGINT', () => {
    console.log('\nSimulation interrupted. Writing final checkpoint...');
    writeCheckpoint(state).finally(() => process.exit(0));
  });

  startServer(() => state);
  const rng = seedrandom(String(SEED)) as () => number;

  console.log('World created. Starting simulation...');
  console.log(`Seed: ${SEED}`);
  console.log(`Starting season: ${state.season}`);

  await ensurePrologueSeeded(state);

  for (let i = 0; i < TARGET_TICKS; i++) {
    const tickResult = tick(state, rng);
    void writeAgentPositions(state).catch(() => {});
    if (state.tick % CHECKPOINT_TICK_INTERVAL === 0) void writeCheckpoint(state).catch(() => {});

    const justLanded = tickResult.landingOccurred;
    // Landing is the single most important state transition. Persist it immediately
    // so a restart resumes already-beached instead of re-landing and re-chronicling
    // the same day — the exact loop that pinned the world to day 5.
    if (justLanded) void writeCheckpoint(state).catch(() => {});
    // At most one chronicle per simulated day. Without this guard, any time a
    // checkpoint restore replays an already-chronicled tick (e.g. a crash loop
    // resuming before tick 240), the day's chronicle is regenerated again.
    const dayNotYetChronicled = state.day > state.lastChronicleDay;
    if (dayNotYetChronicled && (justLanded || shouldGenerateChronicle(state, RUN_MODE))) {
      const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
      if (apiKey) {
        // Run in background — do not block the tick loop. The generator advances
        // state.lastChronicleDay on success; checkpoint immediately afterward so a
        // crash before the next 50-tick checkpoint can't replay this day.
        void generateChronicle(state, apiKey)
          .then(() => writeCheckpoint(state))
          .catch((err: unknown) => {
            console.error('Chronicle generation failed:', err);
          });
      }
    }

    if (shouldGenerateSummary(state, RUN_MODE)) {
      const geminiKey = process.env['GEMINI_API_KEY'] ?? '';
      if (geminiKey) {
        void generateSummary(state, geminiKey).catch((err: unknown) => {
          console.error('Summary generation failed:', err);
        });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }

  console.log('Target ticks reached. Simulation complete.');
}

main().catch((error: unknown) => {
  console.error('Simulation failed:', error);
  process.exit(1);
});
