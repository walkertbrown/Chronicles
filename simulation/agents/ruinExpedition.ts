// simulation/agents/ruinExpedition.ts
// The "rumor of the ruins" — a curious, adult agent unpressed by survival
// stress catches the pull to trek to the ruin cluster far to the north
// (y≈599-899 — see world/tileCache.ts's computeRuinCenter), search it for an
// artifact, and return home.
//
// WHY THIS EXISTS: artifactsFound/firstArtifactFoundDay have flatlined at 0/20
// seeds in every wind-tunnel run to date. placeArtifacts() (world/tileCache.ts)
// only ever places artifacts on Terrain.Ruin tiles in that small northern
// cluster, and no existing movement mechanic reliably reaches it: wanderlust
// day-trip forays cap at 60 tiles from home (agents/exploration.ts); family
// migration explicitly stops short of it by design (MIGRATION_MIN_Y: 950 —
// agents/migration.ts). Separately, and this mechanic must handle it directly
// rather than assume it away: even an agent standing ON a ruin tile today
// never triggers an artifact discovery, because the existing "found ruins"
// outcome paths short-circuit first —
//   - actions.ts's actionExplore: `if (destination.terrain === Terrain.Ruin)
//     return FoundRuin` returns before ever reaching the artifact check below it.
//   - exploration.ts's actionVenture: same shape — the isNew-Ruin branch
//     returns before the isNew-undiscoveredArtifact branch is ever reached.
// Fixing those shared, already-tuned paths is out of scope (risks disturbing
// exploration/migration baselines) — this mechanic does its own explicit
// search-and-discover step instead.
//
// MOVEMENT: reuses migration.ts's exported attemptMigrationStep — the fixed,
// stall-proof repick-on-block mover with bestDist/stuckTicks tracking — for
// every leg of the trek (outbound, the short hops between candidate ruin
// tiles while searching, and the return home). Do not reimplement a stepper
// here; that would risk reintroducing the Manhattan-distance-tie stall bug
// migration.ts already had to fix once.
//
// MUTUAL EXCLUSION with family migration: this agent's own eligibility check
// refuses to trigger while hasActiveMigration(agent) is true; migration.ts's
// isMigrationEligible refuses the other direction (won't start a migration for
// either partner while one already has an active ruinExpedition). An agent is
// never doing both at once.
//
// UNBONDED-ONLY GATE (added after the first wind-tunnel pass): the initial
// no-bond-gate design let pair-bonded reproductive adults catch the pull too,
// splitting couples for month-long treks — measured at a ~60% conceptions/
// births drop and a ~4x predator-death increase across 20 seeds vs. baseline.
// Restored the same "unbonded" gate exploration.ts's wanderlustExpresses
// already uses (no active Pair relationship, no Conduit bond) so this pull
// only ever draws away agents who aren't mid-reproduction or mid-pilgrimage.
// Still no role/generation restriction otherwise.

import type { Agent, WorldState } from '@shared/types.js';
import { BondType, EventType, Terrain } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import { logEvent } from '../events/log.js';
import { computeRuinCenter } from '../world/tileCache.js';
import { attemptMigrationStep, hasActiveMigration } from './migration.js';
import { getTile, manhattanDistance, markTileDirty } from '../world/tiles.js';

// ============================================================
// CONSTANTS — tunable via the wind-tunnel harness's --set/--sweep registry,
// same pattern as MIGRATION_CONSTANTS et al. (see harness/constantsRegistry.ts).
// ============================================================

export const RUIN_RUMOR_CONSTANTS = {
  // Retuned 2026-07 after the first wind-tunnel pass: 0.0002 produced ~40
  // expeditions/seed/year (far more than "rare and special") and, combined
  // with the missing bond gate, a 68% population collapse relative to
  // baseline. Dropped an order of magnitude; see the bond gate below for the
  // other half of that fix.
  RUIN_RUMOR_BASE_CHANCE: 0.00002,
  RUIN_RUMOR_CURIOSITY: 0.65,
  RUIN_RUMOR_MIN_AGE: 16,               // mirrors births.ts BIRTH_MIN_AGE (adulthood); its own tunable knob
  RUIN_RUMOR_MAX_SURVIVAL_STRESS: 0.50, // hunger/fatigue/fear must all be below this — to trigger AND to keep stepping
  RUIN_RUMOR_STUCK_TIMEOUT: 40,         // ticks of no progress on the current leg before bailing to the next phase
  RUIN_RUMOR_ARRIVE_RADIUS: 1,          // tiles from the outbound/return target counted as "arrived"
  RUIN_RUMOR_SEARCH_CURIOSITY_FACTOR: 10,
};

// ============================================================
// STATE HELPERS
// ============================================================

export function hasActiveRuinExpedition(agent: Agent): boolean {
  return agent.ruinExpedition != null;
}

function homeOf(agent: Agent): { x: number; y: number } {
  return agent.home ?? agent.position;
}

function tileId(x: number, y: number): string {
  return `${x}_${y}`;
}

function isInAcuteSurvivalStress(agent: Agent): boolean {
  const t = RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_MAX_SURVIVAL_STRESS;
  return agent.drives.hunger >= t || agent.drives.fatigue >= t || agent.drives.fear >= t;
}

// Exported so actions.ts can gate the "has active expedition" branch — a
// trekking agent in acute survival stress pauses that tick (falls through to
// normal drive-based dispatch) rather than stepping, mirroring
// shouldPauseMigrationForSurvival exactly. The marker persists untouched.
export function shouldPauseRuinExpeditionForSurvival(agent: Agent): boolean {
  return isInAcuteSurvivalStress(agent);
}

// ============================================================
// RUIN CLUSTER ENUMERATION
// A small, bounded scan of the cluster's bounding box (radius 2-4, so at most
// ~81 tiles) — not a full-map scan. Deterministic per seed (same terrain-
// determination RNG as world generation), so this is safe to cache by seed.
// ============================================================

const ruinClusterCache = new Map<number, Array<{ x: number; y: number }>>();

function getRuinClusterTiles(state: WorldState): Array<{ x: number; y: number }> {
  const cached = ruinClusterCache.get(state.seed);
  if (cached !== undefined) return cached;

  const { cx, cy, radius } = computeRuinCenter(state.seed);
  const tiles: Array<{ x: number; y: number }> = [];
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      const tile = getTile(state.tiles, x, y);
      if (tile !== undefined && tile.terrain === Terrain.Ruin) {
        tiles.push({ x: tile.x, y: tile.y });
      }
    }
  }
  ruinClusterCache.set(state.seed, tiles);
  return tiles;
}

// ============================================================
// ELIGIBILITY + TRIGGER
// ============================================================

function isUnbonded(agent: Agent): boolean {
  const hasPairBond = agent.relationships.some((rel) => rel.bond === BondType.Pair);
  if (hasPairBond) return false;
  if (agent.conduitId !== null) return false;
  return true;
}

function isRuinRumorEligible(agent: Agent): boolean {
  if (agent.traits.curiosity < RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_CURIOSITY) return false;
  if (agent.age < RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_MIN_AGE) return false;
  if (isInAcuteSurvivalStress(agent)) return false;
  if (!isUnbonded(agent)) return false;              // no splitting up pairs/pilgrims — see file header
  if (hasActiveRuinExpedition(agent)) return false; // defensive — actions.ts already gates this
  if (hasActiveMigration(agent)) return false;       // mutual exclusion, see file header
  return true;
}

// Evaluated once per eligible agent per tick (called from actions.ts only when
// the agent isn't already on an expedition and isn't mid-migration). Writes a
// marker only — no movement, no event this tick. The trek begins next tick,
// mirroring tryBeginMigration exactly.
export function tryBeginRuinExpedition(agent: Agent, state: WorldState, rng: () => number): void {
  if (!isRuinRumorEligible(agent)) return;
  if (rng() >= RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_BASE_CHANCE) return;

  const ruinTiles = getRuinClusterTiles(state);
  if (ruinTiles.length === 0) return; // no viable destination this seed's cluster — try again later

  const home = homeOf(agent);
  const homeX = Math.round(home.x);
  const homeY = Math.round(home.y);

  // Prefer the nearest tile that still holds an undiscovered artifact; fall
  // back to the nearest ruin tile in the cluster overall if none currently
  // holds one — the point is still "reached the ruins" even if this run's
  // artifacts there are already claimed.
  let dest: { x: number; y: number } | null = null;
  let bestWithArtifact = Infinity;
  for (const t of ruinTiles) {
    const tile = getTile(state.tiles, t.x, t.y);
    if (tile === undefined || !tile.artifacts.some((a) => !a.discovered)) continue;
    const d = manhattanDistance(homeX, homeY, t.x, t.y);
    if (d < bestWithArtifact) {
      bestWithArtifact = d;
      dest = t;
    }
  }
  if (dest === null) {
    let bestAny = Infinity;
    for (const t of ruinTiles) {
      const d = manhattanDistance(homeX, homeY, t.x, t.y);
      if (d < bestAny) {
        bestAny = d;
        dest = t;
      }
    }
  }
  if (dest === null) return; // unreachable given ruinTiles.length > 0, but defensive

  agent.ruinExpedition = {
    phase: 'outbound',
    destX: dest.x,
    destY: dest.y,
    homeX,
    homeY,
    bestDist: manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y),
    stuckTicks: -1, // sentinel: RuinExpeditionBegan not yet logged (see stepOutbound)
    checkedTiles: [],
    maxTilesToSearch: 0, // computed once on first entering 'searching'
  };
}

// ============================================================
// THE TREK
// ============================================================

function expeditionOutcome(agent: Agent, type: OutcomeType, success: boolean, partial: boolean): TickOutcome {
  return {
    type,
    success,
    partial,
    involvedAgentId: null,
    fatigueAtTime: agent.drives.fatigue,
    fearAtTime: agent.drives.fear,
    conflictWon: null,
    amountGained: null,
  };
}

type RuinExpedition = NonNullable<Agent['ruinExpedition']>;

function beginSearching(agent: Agent, state: WorldState, m: RuinExpedition): void {
  m.phase = 'searching';
  const ruinTiles = getRuinClusterTiles(state);
  m.maxTilesToSearch = Math.min(
    1 + Math.floor(agent.traits.curiosity * RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_SEARCH_CURIOSITY_FACTOR),
    Math.max(1, ruinTiles.length),
  );
  m.stuckTicks = 0;
}

function beginReturning(agent: Agent, state: WorldState, m: RuinExpedition): void {
  m.phase = 'returning';
  m.bestDist = manhattanDistance(agent.position.x, agent.position.y, m.homeX, m.homeY);
  m.stuckTicks = 0;
}

function stepOutbound(agent: Agent, state: WorldState, m: RuinExpedition): TickOutcome {
  if (m.stuckTicks === -1) {
    logEvent(
      state,
      EventType.RuinExpeditionBegan,
      [agent.id],
      { x: agent.position.x, y: agent.position.y },
      `${agent.name} ${agent.familyName} set out on a long trek, drawn by rumor of ruins far to the north.`,
      [agent.familyName],
    );
    m.stuckTicks = 0;
  }

  const dest = { x: m.destX, y: m.destY };
  const distNow = manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y);
  const arrived = distNow <= RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_ARRIVE_RADIUS;
  const stalled = m.stuckTicks >= RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_STUCK_TIMEOUT;

  if (arrived || stalled) {
    beginSearching(agent, state, m);
    return stepSearching(agent, state, m); // no wasted tick — begin searching immediately
  }

  const moved = attemptMigrationStep(agent, state, dest);
  const distAfter = manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y);
  if (distAfter < m.bestDist) {
    m.bestDist = distAfter;
    m.stuckTicks = 0;
  } else {
    m.stuckTicks += 1;
  }

  return expeditionOutcome(agent, OutcomeType.JourneyedToRuins, moved, true);
}

function stepSearching(agent: Agent, state: WorldState, m: RuinExpedition): TickOutcome {
  const here = getTile(state.tiles, agent.position.x, agent.position.y);
  const hereId = tileId(agent.position.x, agent.position.y);

  if (here !== undefined && here.terrain === Terrain.Ruin && !m.checkedTiles.includes(hereId)) {
    m.checkedTiles.push(hereId);
    const artifact = here.artifacts.find((a) => !a.discovered);
    if (artifact !== undefined) {
      artifact.discovered = true;
      markTileDirty(state.tiles, here.x, here.y); // persist discovered flag through checkpoint restore
      const descriptor = artifact.descriptor ?? 'something old and made';
      logEvent(
        state,
        EventType.ArtifactFound,
        [agent.id],
        { x: here.x, y: here.y },
        `${agent.name} ${agent.familyName}, far from home on the trek the rumor promised, found ${descriptor} among the ruins.`,
        [agent.familyName],
      );
      beginReturning(agent, state, m);
      return expeditionOutcome(agent, OutcomeType.FoundArtifact, true, false);
    }
  }

  const ruinTiles = getRuinClusterTiles(state);
  const checked = new Set(m.checkedTiles);
  const unsearched = ruinTiles.filter((t) => !checked.has(tileId(t.x, t.y)));

  const budgetSpent = m.checkedTiles.length >= m.maxTilesToSearch;
  const noneLeft = unsearched.length === 0;
  const timedOut = m.stuckTicks >= RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_STUCK_TIMEOUT;

  if (budgetSpent || noneLeft || timedOut) {
    beginReturning(agent, state, m);
    return stepReturning(agent, state, m); // no wasted tick — begin the leg home immediately
  }

  let best = unsearched[0]!;
  let bestD = manhattanDistance(agent.position.x, agent.position.y, best.x, best.y);
  for (const t of unsearched) {
    const d = manhattanDistance(agent.position.x, agent.position.y, t.x, t.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }

  if (best.x !== m.destX || best.y !== m.destY) {
    m.destX = best.x;
    m.destY = best.y;
    m.bestDist = manhattanDistance(agent.position.x, agent.position.y, best.x, best.y);
    m.stuckTicks = 0;
  }

  const moved = attemptMigrationStep(agent, state, { x: m.destX, y: m.destY });
  const distAfter = manhattanDistance(agent.position.x, agent.position.y, m.destX, m.destY);
  if (distAfter < m.bestDist) {
    m.bestDist = distAfter;
    m.stuckTicks = 0;
  } else {
    m.stuckTicks += 1;
  }

  return expeditionOutcome(agent, OutcomeType.SearchedRuins, moved, true);
}

function stepReturning(agent: Agent, state: WorldState, m: RuinExpedition): TickOutcome {
  const dest = { x: m.homeX, y: m.homeY };
  const distNow = manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y);
  const arrived = distNow <= RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_ARRIVE_RADIUS;
  const stalled = m.stuckTicks >= RUIN_RUMOR_CONSTANTS.RUIN_RUMOR_STUCK_TIMEOUT;

  if (arrived || stalled) {
    logEvent(
      state,
      EventType.RuinExpeditionReturned,
      [agent.id],
      { x: agent.position.x, y: agent.position.y },
      `${agent.name} ${agent.familyName} returned from the long trek to the ruins.`,
      [agent.familyName],
    );
    agent.ruinExpedition = null;
    return expeditionOutcome(agent, OutcomeType.ReturnedFromRuins, true, false);
  }

  const moved = attemptMigrationStep(agent, state, dest);
  const distAfter = manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y);
  if (distAfter < m.bestDist) {
    m.bestDist = distAfter;
    m.stuckTicks = 0;
  } else {
    m.stuckTicks += 1;
  }

  return expeditionOutcome(agent, OutcomeType.ReturnedFromRuins, moved, true);
}

// Called from actions.ts only when hasActiveRuinExpedition(agent) is true and
// the agent is not pausing for acute survival stress.
export function actionRuinExpeditionStep(agent: Agent, state: WorldState, _rng: () => number): TickOutcome {
  const m = agent.ruinExpedition;
  if (m == null) return expeditionOutcome(agent, OutcomeType.ReturnedFromRuins, false, true); // defensive; dispatch guarantees non-null

  if (m.phase === 'outbound') return stepOutbound(agent, state, m);
  if (m.phase === 'searching') return stepSearching(agent, state, m);
  return stepReturning(agent, state, m);
}
