// simulation/agents/predators.ts
// Ambient predator threat — one call per alive agent per tick.
// Uses tile.occupants (no O(n^2) agent scan).

import type { Agent, WorldState } from '@shared/types.js';
import { Terrain } from '@shared/types.js';
import { getTile, manhattanDistance } from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

// Base per-tick attack probability by terrain type.
// Safe terrains (Plain, Coast, River) are absent — tickPredatorThreat returns
// immediately for those, so no entry is needed.
const PREDATOR_BASE: Partial<Record<Terrain, number>> = {
  [Terrain.Forest]: 0.004,
  [Terrain.Mountain]: 0.006,
  [Terrain.Ruin]: 0.010,
};

// Solo wanderers far from home face up to 2× the base risk.
const DISTANCE_SCALE_MAX = 2.0;
const DISTANCE_SCALE_FAR = 12; // tiles from home where the full 2× applies

// Each additional occupant on the same tile reduces attack chance.
const COMPANY_MITIGATION_PER_PERSON = 0.12;
const COMPANY_MITIGATION_MAX = 0.60;

// Trait dampening on attack chance (modest — they don't make you invulnerable).
const COURAGE_DAMPENER = 0.15;
const ENDURANCE_DAMPENER = 0.10;

// Damage range on a predator hit.
const DAMAGE_MIN = 0.15;
const DAMAGE_RANGE = 0.13; // random component, giving 0.15–0.28

// ============================================================
// MAIN EXPORT
// ============================================================

export function tickPredatorThreat(agent: Agent, state: WorldState): void {
  // Fast exit: safe terrain or terrain with no predator entry.
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  const terrain = tile?.terrain;
  const terrainBase =
    terrain === Terrain.Forest || terrain === Terrain.Mountain || terrain === Terrain.Ruin
      ? (PREDATOR_BASE[terrain] ?? 0)
      : 0;

  if (terrainBase === 0) return;

  // distanceFactor: 1.0 near home, scaling to DISTANCE_SCALE_MAX when far.
  const homeDist = manhattanDistance(
    agent.position.x,
    agent.position.y,
    agent.home.x,
    agent.home.y,
  );
  const distanceFactor =
    1.0 + (DISTANCE_SCALE_MAX - 1.0) * Math.min(1, homeDist / DISTANCE_SCALE_FAR);

  // companyMitigation: fewer predators attack a group. Read tile.occupants —
  // this is maintained by moveAgent; no agent scan needed.
  const companions = tile !== undefined ? Math.max(0, tile.occupants.length - 1) : 0;
  const companyMitigation = Math.min(
    COMPANY_MITIGATION_MAX,
    companions * COMPANY_MITIGATION_PER_PERSON,
  );

  // Trait dampening — courage and endurance reduce the chance modestly.
  const traitDampener =
    1.0 - agent.traits.courage * COURAGE_DAMPENER - agent.traits.endurance * ENDURANCE_DAMPENER;

  const attackChance =
    terrainBase * distanceFactor * (1 - companyMitigation) * Math.max(0.3, traitDampener);

  if (Math.random() >= attackChance) return;

  // ── Hit ──────────────────────────────────────────────────────────────────
  const damage = DAMAGE_MIN + Math.random() * DAMAGE_RANGE;
  agent.healthScore = Math.max(0, agent.healthScore - damage);
  agent.drives.fear = Math.min(1, agent.drives.fear + 0.3);
  agent.animalAttackTick = state.tick;
  // Death attribution and narrative are handled by detectDeaths + logDeathEvent.
  // No per-maul event type is logged here.
}
