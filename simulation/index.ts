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

async function main(): Promise<void> {
  const saved = await loadCheckpoint(WORLD_ID);
  const state = saved ?? createWorldState(SEED, WORLD_ID);
  if (saved !== null) {
    console.log(`Resuming from tick ${state.tick}, day ${state.day}`);
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
    if (state.tick % 50 === 0) void writeCheckpoint(state).catch(() => {});

    const justLanded = tickResult.landingOccurred;
    if (justLanded || shouldGenerateChronicle(state, RUN_MODE)) {
      const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
      if (apiKey) {
        // Run in background — do not block the tick loop
        void generateChronicle(state, apiKey).catch((err: unknown) => {
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
