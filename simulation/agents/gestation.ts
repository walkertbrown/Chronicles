// simulation/agents/gestation.ts
// Conception and gestation/delivery logic.
// Conception triggers the pregnancy arc; delivery spawns the child after GESTATION_TICKS.
// Eligibility gates are checked at conception only — delivery proceeds unconditionally.

import type { Agent, WorldState } from '@shared/types.js';
import { logConceptionEvent } from '../events/log.js';
import { TICKS_PER_YEAR } from './drives.js';
import {
  collectUniquePairs,
  resolveParents,
  isEligiblePair,
  spawnChild,
  findAgent,
  PARENT_LONGING_RESET,
} from './births.js';

// ============================================================
// CONSTANTS
// ============================================================

// 0.75 × TICKS_PER_YEAR (1440) = 1080 ticks ≈ 22.5 in-world days
const GESTATION_TICKS = Math.round(0.75 * TICKS_PER_YEAR); // 1080

const BIRTH_CHANCE_PER_DAY = 0.10;

// ============================================================
// CONCEPTION PASS
// Called once per day from tickBirths. Skips mothers already pregnant.
// On a successful roll: sets pregnancy, resets longing for both parents,
// logs a conception event.
// ============================================================

export function tickConception(state: WorldState, rng: () => number): void {
  for (const [agentA, agentB] of collectUniquePairs(state)) {
    const parents = resolveParents(agentA, agentB);
    if (parents === null) continue;

    const { mother, father } = parents;

    // Mother already pregnant — cannot double-conceive
    if (mother.pregnancy !== null) continue;

    if (!isEligiblePair(mother, father)) continue;
    if (rng() >= BIRTH_CHANCE_PER_DAY) continue;

    // Conception: store father info in case he dies during gestation
    mother.pregnancy = {
      fatherId: father.id,
      fatherName: father.name,
      conceivedTick: state.tick,
    };

    // Reset longing now so neither parent seeks a new mate during pregnancy.
    // (This was previously done at birth in spawnChild; it moves here.)
    mother.drives.longing = PARENT_LONGING_RESET;
    father.drives.longing = PARENT_LONGING_RESET;

    logConceptionEvent(state, mother, father);
  }
}

// ============================================================
// DELIVERY PASS
// Called once per day from tickBirths. For each living pregnant mother
// whose gestation is complete, delivers the child and clears the pregnancy.
// Eligibility is NOT re-checked — delivery is unconditional once gestation ends.
// ============================================================

export function tickDeliveries(state: WorldState, rng: () => number): void {
  // Snapshot living pregnant agents before iteration; spawnChild pushes onto
  // state.agents and we don't want to walk newly-spawned children.
  const pregnantMothers = state.agents.filter(
    (a) => a.alive && a.pregnancy !== null,
  );

  for (const mother of pregnantMothers) {
    const preg = mother.pregnancy;
    if (preg === null) continue; // TypeScript narrowing guard

    if (state.tick - preg.conceivedTick < GESTATION_TICKS) continue;

    // Father may have died during gestation — resolve by id, tolerate absence
    const fatherObj: Agent | undefined = findAgent(state, preg.fatherId);

    spawnChild(state, mother, preg.fatherId, preg.fatherName, fatherObj, rng);

    // Delivery complete — clear the pregnancy marker
    mother.pregnancy = null;
  }
}
