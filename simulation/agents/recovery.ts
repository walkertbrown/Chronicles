// simulation/agents/recovery.ts
// Health recovery logic — extracted from drives.ts to keep that file under the
// 380-line soft ceiling after the wanderlust-decay additions.
//
// Called once per tick per agent from tickAgentDrives. No side effects outside
// the agent's healthScore field.

import type { Agent, WorldState } from '@shared/types.js';
import { EventType, StructureType } from '@shared/types.js';
import { getTile } from '../world/tiles.js';
import { hasAdjacentHealer } from './illness.js';

// ============================================================
// CONSTANTS (mirrors those declared in drives.ts — keep in sync)
// ============================================================

const RECOVERY_HUNGER_MAX = 0.5;      // must be below this to heal
const RECOVERY_FATIGUE_MAX = 0.6;     // must be below this to heal
const RECOVERY_THREAT_WINDOW = 5;     // ticks — matches hasNearbyThreat in tick.ts
const RECOVERY_WOUND_WINDOW = 10;     // ticks after violence/animal wound before healing resumes
const RECOVERY_BASE_RATE = 0.004;     // health restored per tick
const RECOVERY_ENDURANCE_BONUS = 0.002; // extra rate for high endurance
const RECOVERY_HEALER_BONUS = 0.002;  // extra rate when adjacent healer present
const RECOVERY_SHELTER_BONUS = 0.001; // extra rate when on a tile with a completed shelter
const RECOVERY_ENDURANCE_THRESHOLD = 0.6;
const RECOVERY_SHELTER_PROGRESS = 1.0; // shelter must be fully built

// ============================================================
// HELPERS
// ============================================================

// O(recent events) check: replicates the hasNearbyThreat pattern from tick.ts
// without importing it (to avoid a circular dependency).
function hasRecentThreat(agent: Agent, state: WorldState): boolean {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (state.tick - event.tick > RECOVERY_THREAT_WINDOW) break;
    if (
      event.type === EventType.Conflict &&
      event.involvedAgents.includes(agent.id)
    ) {
      return true;
    }
  }
  return false;
}

function isSheltered(agent: Agent, state: WorldState): boolean {
  // The current tile (or home tile) has a completed shelter.
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (tile?.structure !== null && tile?.structure !== undefined) {
    if (
      tile.structure.type === StructureType.Shelter &&
      tile.structure.progress >= RECOVERY_SHELTER_PROGRESS
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function tickHealthRecovery(agent: Agent, state: WorldState): void {
  // No recovery when sick, hungry, fatigued, threatened, or freshly wounded.
  if (agent.illnessState !== null) return;
  if (agent.drives.hunger >= RECOVERY_HUNGER_MAX) return;
  if (agent.drives.fatigue >= RECOVERY_FATIGUE_MAX) return;
  if (hasRecentThreat(agent, state)) return;

  const freshViolenceWound =
    agent.lastViolenceTick !== null &&
    state.tick - agent.lastViolenceTick <= RECOVERY_WOUND_WINDOW;
  const freshAnimalWound =
    agent.animalAttackTick !== null &&
    state.tick - agent.animalAttackTick <= RECOVERY_WOUND_WINDOW;
  if (freshViolenceWound || freshAnimalWound) return;

  // All conditions met — heal.
  let rate = RECOVERY_BASE_RATE;

  if (agent.traits.endurance > RECOVERY_ENDURANCE_THRESHOLD) {
    rate += RECOVERY_ENDURANCE_BONUS;
  }
  if (isSheltered(agent, state)) {
    rate += RECOVERY_SHELTER_BONUS;
  }
  if (hasAdjacentHealer(agent, state)) {
    rate += RECOVERY_HEALER_BONUS;
  }

  agent.healthScore = Math.min(1.0, agent.healthScore + rate);
}
