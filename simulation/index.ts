// simulation/index.ts
// Entry point — creates the world, runs the tick loop, handles graceful shutdown.

import 'dotenv/config';
import seedrandom from 'seedrandom';
import type { WorldState } from '@shared/types.js';
import { computeSourcePosition } from './world/tileCache.js';
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

// One-time, idempotent: ensure a few unbonded Conduits linger at the settlement's
// treeline so the watchers appear as ambient background. Lore-consistent — they
// are "curious about humans from far off" and drift toward population. Once enough
// are near, the guard short-circuits, so this no-ops on subsequent restarts.
//
// Called for BOTH fresh worlds and resumed checkpoints. Fresh worlds already have
// frontier Conduits spawned nearby (generator.ts), so this typically no-ops.
// For resumed checkpoints from before the frontier-spawn change, it draws a few
// Conduits down to sighting range (~30-50 tiles north of camp).
//
// BUG FIX (v2): Previous version placed Conduits at cy+12 (SOUTH of the settlement,
// into the vessel zone). North in this world = lower y. Corrected to cy-12 so
// watchers are placed NORTH of camp, between the settlement and the interior.
function nudgeConduitsToTreeline(state: WorldState): void {
  const alive = state.agents.filter((a) => a.alive);
  if (alive.length === 0) return;
  const cx = Math.round(alive.reduce((s, a) => s + a.position.x, 0) / alive.length);
  const cy = Math.round(alive.reduce((s, a) => s + a.position.y, 0) / alive.length);

  const NEAR = 70; // a Conduit within this of camp counts as already present
  const WANT = 4; // keep at least this many watchers near the settlement
  const distToCamp = (c: { position: { x: number; y: number } }): number =>
    Math.abs(c.position.x - cx) + Math.abs(c.position.y - cy);

  const unbonded = state.conduits.filter((c) => c.bondedAgentId === null);
  const present = unbonded.filter((c) => distToCamp(c) <= NEAR).length;
  if (present >= WANT) return; // watchers already at the edges — leave them be

  const toMove = unbonded
    .filter((c) => distToCamp(c) > NEAR)
    .sort((a, b) => distToCamp(a) - distToCamp(b))
    .slice(0, WANT - present);

  toMove.forEach((c, i) => {
    // A loose arc ~25-35 tiles NORTH of camp (lower y = inland treeline), spread
    // across a ~60-tile x-span so they aren't all on top of each other.
    // North = lower y values. cy is ~1499 (coast), so cy - 30 ≈ 1469 = treeline.
    const angle = (i / Math.max(1, toMove.length)) * Math.PI; // semicircle to the north
    const radius = 25 + Math.round(Math.random() * 10); // 25-35 tiles out
    c.position = {
      x: Math.max(10, Math.min(2990, cx + Math.round(Math.cos(angle) * 30))),
      y: Math.max(1, cy - radius + Math.round(Math.sin(angle) * 8)),
    };
  });

  if (toMove.length > 0) {
    console.log(`Drew ${toMove.length} Conduit(s) to the northern treeline near the settlement.`);
  }
}

async function main(): Promise<void> {
  const saved = await loadCheckpoint(WORLD_ID);
  const state = saved ?? createWorldState(SEED, WORLD_ID);

  if (saved === null) {
    // Fresh world: frontier Conduits already spawn near the coast in generator.ts,
    // but run the nudge to confirm at least WANT are within sighting reach and to
    // place extras if the random spawn happened to miss the landing column.
    nudgeConduitsToTreeline(state);
    console.log('Fresh world initialized.');
  }

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
      // Contested-supersession fields added after this checkpoint was written.
      const a = agent as { chronicleChallenge?: number; chronicleFade?: number };
      if (typeof a.chronicleChallenge !== 'number') agent.chronicleChallenge = 0;
      if (typeof a.chronicleFade !== 'number') agent.chronicleFade = 0;
      // Wanderlust drive added with the exploration/migration update. Backfill
      // so every restored agent has the field rather than undefined.
      const drv = agent.drives as typeof agent.drives & { wanderlust?: number };
      if (typeof drv.wanderlust !== 'number') {
        drv.wanderlust = 0.05;
      }
    }
    // The generator now seeds a few treeline watchers near the landing, but this
    // world was generated before that — draw a handful of Conduits down to the
    // settlement's edge so the luminous creatures are present from the start.
    nudgeConduitsToTreeline(state);
    // The source was added after this world was generated — place it (dormant)
    // at its deterministic spot beyond the ruins so the arc has somewhere to go.
    const restoredSource = state.source as WorldState['source'] | undefined;
    if (restoredSource === undefined) {
      state.source = { position: computeSourcePosition(state.seed), control: 0 };
    }
    // ONE-TIME SOURCE MIGRATION: The ruin cluster was moved from y≈4-8 to
    // y≈599-899 (middle-distance north) in the exploration/migration update.
    // The persisted Source position reflects the old formula (far-north edge,
    // y≈3-7). Recompute from the new formula and overwrite — idempotent because
    // once the checkpoint is re-saved the position matches and this no-ops.
    // Guard: only migrate if the source y is suspiciously far north (< 50),
    // which is only possible under the old formula. The new positions are ~598-898.
    if (restoredSource !== undefined && state.source.position.y < 50) {
      const newPos = computeSourcePosition(state.seed);
      console.log(
        `Migrating Source from y=${state.source.position.y} to y=${newPos.y} (ruin zone moved inland)`,
      );
      state.source = { position: newPos, control: state.source.control };
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
