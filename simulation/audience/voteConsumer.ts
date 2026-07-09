// simulation/audience/voteConsumer.ts
// Orchestration for the audience-voting feature — called once per tick from
// simulation/index.ts. Two independent, cheaply-gated steps:
//
//   1. Author the open cycle (if not already authored this cycle).
//   2. Resolve the just-closed cycle (if not already resolved).
//
// Both steps do a cheap in-memory check before touching Firebase at all, so
// calling this every tick is fine — Firebase is only touched when the open
// cycle id actually changes or a resolve is actually due (at most twice per
// 6-hour cycle, regardless of tick rate).
//
// Never writes the checkpoint doc or the RTDB /live node. The only writes
// this feature makes are to voteCycles/{cycleId} (see voteFirebase.ts).

import type { WorldState } from '@shared/types.js';
import { currentCycleId, previousCycleId } from './voteCycle.js';
import { pickCycleType, resolveVote } from './voteEffects.js';
import { createVoteCycleIfAbsent, readVoteCycle, readVoteTally } from './voteFirebase.js';

const RESOLVED_CYCLE_HISTORY_LIMIT = 64;

// ============================================================
// PURE HELPERS — no Firebase, exercised directly by
// simulation/scripts/voteEffectsCheck.ts
// ============================================================

export function isCycleResolved(state: WorldState, cycleId: string): boolean {
  return state.resolvedVoteCycleIds.includes(cycleId);
}

export function recordResolvedCycle(state: WorldState, cycleId: string): void {
  state.resolvedVoteCycleIds.push(cycleId);
  if (state.resolvedVoteCycleIds.length > RESOLVED_CYCLE_HISTORY_LIMIT) {
    state.resolvedVoteCycleIds = state.resolvedVoteCycleIds.slice(-RESOLVED_CYCLE_HISTORY_LIMIT);
  }
}

// ============================================================
// STEP 1 — AUTHOR THE OPEN CYCLE
// ============================================================

async function authorOpenCycle(state: WorldState, openId: string): Promise<void> {
  if (openId === state.lastAuthoredVoteCycleId) return; // already authored this cycle — no Firebase touch

  const picked = pickCycleType(state, openId);
  if (picked === null) {
    // Only possible in a fully-dead world ('steady' always has a target
    // while anyone is alive) — skip; will retry next tick.
    return;
  }

  await createVoteCycleIfAbsent({
    cycleId: openId,
    type: picked.type,
    targetIds: picked.targetIds,
    flavorNames: picked.flavorNames,
    authoredAtTick: state.tick,
    authoredAt: new Date().toISOString(),
  });
  state.lastAuthoredVoteCycleId = openId;
}

// ============================================================
// STEP 2 — RESOLVE THE JUST-CLOSED CYCLE
// ============================================================

async function resolveClosedCycle(state: WorldState, openId: string): Promise<void> {
  const prevId = previousCycleId(openId);
  if (isCycleResolved(state, prevId)) return; // already resolved — no Firebase touch

  const cycleDoc = await readVoteCycle(prevId);
  if (cycleDoc === null) {
    // The sim was down when this cycle should have opened — nothing was ever
    // pinned for voters to vote on. Record as resolved; apply nothing.
    recordResolvedCycle(state, prevId);
    return;
  }

  const tally = await readVoteTally(prevId);
  const primaryWins =
    tally !== null && tally.primary > tally.secondary && tally.primary > tally.withhold;

  if (primaryWins) {
    resolveVote(state, cycleDoc.type, cycleDoc.targetIds); // re-validates internally; no-ops if target no longer valid
  }

  recordResolvedCycle(state, prevId);
}

// ============================================================
// ENTRY POINT — called once per tick from simulation/index.ts
// ============================================================

export async function runAudienceVoteTick(state: WorldState, nowMs: number): Promise<void> {
  const openId = currentCycleId(nowMs);
  await authorOpenCycle(state, openId);
  await resolveClosedCycle(state, openId);
}
