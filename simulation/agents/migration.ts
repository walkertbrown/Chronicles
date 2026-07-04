// simulation/agents/migration.ts
// Family migration — a pair-bonded, settled couple permanently relocates from a
// crowded camp to found a new hamlet inland via a visible multi-tick trek (not
// an atomic teleport). Additive to the forage/home economy; disjoint from the
// Source pilgrimage (Conduit-bonded souls, not pair-bonded families).
//
// Trigger: evaluated once per family per tick, on the smaller-agent-id partner
// only (deterministic, no double-roll — tryBeginMigration). Writes a marker
// only; the trek itself starts next tick.
//
// The mover is deliberately NOT stepAgentToward (actions.ts) — that single-axis
// function has no fallback when its preferred tile is blocked, which is the
// pilgrimage's known "stalls forever" bug. attemptMigrationStep repicks among
// passable neighbors when blocked, and the stuck-timeout guarantees a migration
// can never hang: a family always finishes, at worst short of its target.
// Distance is Manhattan throughout, matching stepToward's one-axis-per-tick
// model (each successful step reduces distance by exactly 1).
//
// Geometry note: Mountain (the only impassable terrain besides an un-beached
// vessel) generates ONLY at y<=3 — far north of even the Source zone (~y599-
// 899) and nowhere near migration's range (destinations y>=950, origins
// ~y1443-1499). Real map generation gives repick-on-block/stuck-timeout almost
// nothing to react to in practice; verified against a constructed obstacle in
// the determinism pass instead (see commit message).

import type { Agent, WorldState } from '@shared/types.js';
import { BondType, EventType, StructureType, Terrain } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import { logEvent } from '../events/log.js';
import { COAST_ROW, MAP_WIDTH } from '../world/generator.js';
import { getTile, isPassable, isVesselZone, manhattanDistance, stepToward } from '../world/tiles.js';

// Tunable via the wind-tunnel harness's --set/--sweep registry, same pattern as
// RELATIONSHIP_CONSTANTS/CONDUIT_CONSTANTS/CONFLICT_CONSTANTS/etc. Unlike those
// extractions, MIGRATION_BASE_CHANCE > 0 is a deliberate baseline-behavior
// change: migration is ON by default.
export const MIGRATION_CONSTANTS = {
  MIGRATION_CROWD_RADIUS: 20,          // home-to-home radius counted as "crowded"
  MIGRATION_CROWD_THRESHOLD: 12,       // living agents homed within that radius
  MIGRATION_RESTLESS_CURIOSITY: 0.55,  // at least one partner must meet this
  MIGRATION_MAX_SURVIVAL_STRESS: 0.50, // hunger/fatigue/fear must all be below this —
                                        // to trigger AND, mid-trek, to keep stepping vs. pausing
  MIGRATION_BASE_CHANCE: 0.0002,       // per-tick roll once eligibility passes
  MIGRATION_MIN_DIST: 100,             // Manhattan tiles from origin home
  MIGRATION_MAX_DIST: 300,
  MIGRATION_MIN_Y: 950,                // hard floor — keeps the Source/ruin zone (~y599-899) untouched
  MIGRATION_CHILD_MAX_AGE: 16,         // mirrors births.ts BIRTH_MIN_AGE; its own tunable knob
  MIGRATION_STUCK_TIMEOUT: 30,         // ticks of no progress before the lead bails in place
  MIGRATION_ARRIVE_RADIUS: 2,          // tiles from destination counted as "arrived"
};

// Fraction of the sampled Manhattan distance that must be northward (the rest
// splits east/west at random) — the picker's "north-biased" component.
const MIGRATION_MIN_NORTH_FRACTION = 0.5;
const MIGRATION_WAYPOINT_CANDIDATES = 12;

// migration is an optional field on Agent (shared/types.ts) so it serializes
// through checkpoints — present only on the handful of agents ever mid-trek.
// Absent/null reads as "not migrating" everywhere; no backfill needed (same
// lazy-optional pattern as agent.home/agent.inventory).
export function hasActiveMigration(agent: Agent): boolean {
  return agent.migration != null;
}

// ============================================================
// ELIGIBILITY
// ============================================================

function homeOf(agent: Agent): { x: number; y: number } {
  return agent.home ?? agent.position;
}

function isInAcuteSurvivalStress(agent: Agent): boolean {
  const t = MIGRATION_CONSTANTS.MIGRATION_MAX_SURVIVAL_STRESS;
  return agent.drives.hunger >= t || agent.drives.fatigue >= t || agent.drives.fear >= t;
}

function hasShelterAtCamp(agent: Agent, state: WorldState): boolean {
  const home = homeOf(agent);
  const structure = getTile(state.tiles, Math.round(home.x), Math.round(home.y))?.structure;
  return structure != null && structure.type === StructureType.Shelter && structure.progress >= 1;
}

// O(n) scan restricted to the rare pair-lead evaluating a trigger this tick —
// far cheaper than the O(n) "nearby company" scan drives.ts already runs for
// EVERY agent EVERY tick, so this is not a new order-of-magnitude cost.
function isHomeCrowded(agent: Agent, state: WorldState): boolean {
  const home = homeOf(agent);
  let count = 0;
  for (const other of state.agents) {
    if (!other.alive) continue;
    const oh = homeOf(other);
    if (manhattanDistance(home.x, home.y, oh.x, oh.y) <= MIGRATION_CONSTANTS.MIGRATION_CROWD_RADIUS) {
      count += 1;
      if (count >= MIGRATION_CONSTANTS.MIGRATION_CROWD_THRESHOLD) return true;
    }
  }
  return false;
}

function isMigrationEligible(agent: Agent, partner: Agent, state: WorldState): boolean {
  if (isInAcuteSurvivalStress(agent) || isInAcuteSurvivalStress(partner)) return false;
  if (Math.max(agent.traits.curiosity, partner.traits.curiosity) < MIGRATION_CONSTANTS.MIGRATION_RESTLESS_CURIOSITY) {
    return false;
  }
  if (!hasShelterAtCamp(agent, state) && !hasShelterAtCamp(partner, state)) return false;
  return isHomeCrowded(agent, state);
}

// Every alive child of either parent still under the cutoff age (blended-family
// style — a step-child of either partner counts too), so no under-16 is left
// behind orphaned when the household relocates.
function collectMigratingChildren(mother: Agent, father: Agent, state: WorldState): Agent[] {
  const ids = new Set<string>([...mother.lineage.children, ...father.lineage.children]);
  const kids: Agent[] = [];
  for (const id of ids) {
    const child = state.agents.find((a) => a.id === id && a.alive);
    if (child !== undefined && child.age < MIGRATION_CONSTANTS.MIGRATION_CHILD_MAX_AGE) kids.push(child);
  }
  return kids;
}

// ============================================================
// DESTINATION PICKER
// North-biased, Manhattan-consistent by construction (northFrac + eastFrac sum
// to 1, so the sampled point is exactly `dist` Manhattan tiles from home before
// clamping) — its own picker, not pickForayWaypoint reused verbatim: different
// distance range, a hard y floor, and "land only" (no water/mountain/vessel-
// zone) rather than foray's merely-passable bar.
// ============================================================

function pickMigrationDestination(
  homeX: number,
  homeY: number,
  state: WorldState,
  rng: () => number,
): { x: number; y: number } | null {
  const minD = MIGRATION_CONSTANTS.MIGRATION_MIN_DIST;
  const maxD = MIGRATION_CONSTANTS.MIGRATION_MAX_DIST;
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (
    let attempt = 0;
    attempt < MIGRATION_WAYPOINT_CANDIDATES * 3 && candidates.length < MIGRATION_WAYPOINT_CANDIDATES;
    attempt++
  ) {
    const dist = minD + rng() * (maxD - minD);
    const northFrac = MIGRATION_MIN_NORTH_FRACTION + rng() * (1 - MIGRATION_MIN_NORTH_FRACTION);
    const eastSign = rng() < 0.5 ? -1 : 1;
    const clampedX = Math.max(2, Math.min(MAP_WIDTH - 3, Math.round(homeX + Math.round(dist * (1 - northFrac)) * eastSign)));
    const clampedY = Math.max(4, Math.min(COAST_ROW - 5, Math.round(homeY - dist * northFrac)));

    // Hard floor: never the Source/ruin zone, regardless of how many hops this
    // family has already taken (a second relocation could otherwise creep
    // north indefinitely). Must also be genuinely north of home.
    if (clampedY < MIGRATION_CONSTANTS.MIGRATION_MIN_Y || clampedY >= homeY) continue;
    if (isVesselZone(clampedY)) continue;

    const actualDist = manhattanDistance(homeX, homeY, clampedX, clampedY);
    if (actualDist < minD || actualDist > maxD) continue; // clamping distorted it out of range

    const tile = getTile(state.tiles, clampedX, clampedY);
    if (tile === undefined || !isPassable(tile.terrain, state.vessel.beached)) continue;
    // "Passable land" — a hamlet doesn't sit ON water or a mountain peak, even
    // though agents may cross such tiles en route.
    if (tile.terrain === Terrain.River || tile.terrain === Terrain.Coast || tile.terrain === Terrain.Mountain) continue;

    // Score/pick one (mirrors pickForayWaypoint's pattern): prefer quieter
    // ground, away from the ancient-charged land reserved for the ruins arc.
    candidates.push({ x: clampedX, y: clampedY, score: (1 - tile.ancientDensity) + rng() * 0.05 });
  }

  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const c of candidates) if (c.score > best.score) best = c;
  return { x: best.x, y: best.y };
}

// ============================================================
// TRIGGER
// ============================================================

export function tryBeginMigration(agent: Agent, state: WorldState, rng: () => number): void {
  const partnerRel = agent.relationships.find((r) => r.bond === BondType.Pair);
  if (partnerRel === undefined) return;
  const partner = state.agents.find((a) => a.id === partnerRel.agentId && a.alive);
  if (partner === undefined) return;
  if (agent.id > partner.id) return; // only the smaller-id partner ever evaluates/rolls
  if (hasActiveMigration(partner)) return; // defensive: partner already trekking somehow

  if (!isMigrationEligible(agent, partner, state)) return;
  if (rng() >= MIGRATION_CONSTANTS.MIGRATION_BASE_CHANCE) return; // the once-per-family roll

  // Round home — it can still hold a slowly-drifting float from driftHome
  // (actions.ts) — so distance math downstream (the picker's bounds check,
  // and the "N tiles inland" figure at founding) always works in whole tiles.
  const home = homeOf(agent);
  const homeX = Math.round(home.x);
  const homeY = Math.round(home.y);
  const dest = pickMigrationDestination(homeX, homeY, state, rng);
  if (dest === null) return; // no viable destination this tick — try again later

  const kids = collectMigratingChildren(agent, partner, state);
  for (const member of [agent, partner, ...kids]) {
    member.migration = {
      destX: dest.x,
      destY: dest.y,
      bestDist: manhattanDistance(member.position.x, member.position.y, dest.x, dest.y),
      stuckTicks: 0,
    };
  }
  // Marker only — no home/position change, no event yet. The trek begins next tick.
}

// ============================================================
// THE TREK
// ============================================================

function migrateOutcome(agent: Agent, success: boolean, partial: boolean): TickOutcome {
  return {
    type: OutcomeType.Migrated,
    success,
    partial,
    involvedAgentId: null,
    fatigueAtTime: agent.drives.fatigue,
    fearAtTime: agent.drives.fear,
    conflictWon: null,
    amountGained: null,
  };
}

function moveMigrant(agent: Agent, toX: number, toY: number, state: WorldState): void {
  const from = getTile(state.tiles, agent.position.x, agent.position.y);
  if (from !== undefined) from.occupants = from.occupants.filter((id) => id !== agent.id);
  agent.position = { x: toX, y: toY };
  const to = getTile(state.tiles, toX, toY);
  if (to !== undefined && !to.occupants.includes(agent.id)) to.occupants.push(agent.id);
}

function tileOpen(x: number, y: number, state: WorldState): boolean {
  const tile = getTile(state.tiles, x, y);
  return tile !== undefined && isPassable(tile.terrain, state.vessel.beached) && !isVesselZone(y);
}

// Returns true if the agent actually moved this tick.
//
// REPICK-ON-BLOCK, when the preferred (stepToward) tile is blocked: try a
// lateral (perpendicular) step first, then only retreat straight back along
// the blocked axis as a last resort. This matters because Manhattan distance
// makes every non-preferred neighbor look equally "worse" when there's no
// remaining offset on the other axis (e.g. destination due north) — requiring
// STRICT improvement over the current distance would then never move at all,
// defeating repick-on-block entirely. A lateral step doesn't reduce distance
// THIS tick, but it can clear a single-tile obstacle so the preferred axis
// opens up again next tick; a temporary uptick is fine because stuckTicks
// tracks the running BEST distance ever reached, not tick-over-tick delta.
function attemptMigrationStep(agent: Agent, state: WorldState, dest: { x: number; y: number }): boolean {
  const fx = agent.position.x;
  const fy = agent.position.y;
  const preferred = stepToward(fx, fy, dest.x, dest.y);
  if (tileOpen(preferred.x, preferred.y, state)) {
    moveMigrant(agent, preferred.x, preferred.y, state);
    return true;
  }

  const dx = dest.x - fx;
  const dy = dest.y - fy;
  const primaryIsX = Math.abs(dx) >= Math.abs(dy); // matches stepToward's own axis choice
  const options: Array<{ x: number; y: number }> = primaryIsX
    ? [{ x: fx, y: fy - 1 }, { x: fx, y: fy + 1 }, { x: fx - Math.sign(dx), y: fy }]
    : [{ x: fx - 1, y: fy }, { x: fx + 1, y: fy }, { x: fx, y: fy - Math.sign(dy) }];

  let best: { x: number; y: number } | undefined;
  let bestDist = Infinity;
  for (const opt of options) {
    if (!tileOpen(opt.x, opt.y, state)) continue;
    const d = manhattanDistance(opt.x, opt.y, dest.x, dest.y);
    if (d < bestDist) {
      bestDist = d;
      best = opt;
    }
  }
  if (best !== undefined) {
    moveMigrant(agent, best.x, best.y, state);
    return true;
  }
  return false; // boxed in on every side — no move possible this tick
}

// Every alive agent sharing this agent's exact (destX,destY) — the "family
// group" for founding purposes. Grouping by shared destination (rather than
// re-deriving lineage/pair-bond relationships) also lets leadership hand off
// cleanly if the original lead dies mid-trek (see isEffectiveLead).
function matchingTrekkers(agent: Agent, state: WorldState): Agent[] {
  const m = agent.migration;
  if (m == null) return [agent];
  return state.agents.filter(
    (a) => a.alive && a.migration != null && a.migration.destX === m.destX && a.migration.destY === m.destY,
  );
}

// The smallest-id alive member of the matching group is the effective lead for
// arrival/stuck-timeout purposes. Ordinarily this is the original trigger-time
// lead; if that agent dies mid-trek, leadership passes to the next smallest id
// rather than leaving the rest of the family with a dangling marker forever.
function isEffectiveLead(agent: Agent, state: WorldState): boolean {
  return matchingTrekkers(agent, state).every((a) => a.id >= agent.id);
}

function foundHamlet(agent: Agent, state: WorldState, finalX: number, finalY: number): TickOutcome {
  const group = matchingTrekkers(agent, state);
  // Round the origin — home.x/y can still hold a slowly-drifting float from
  // driftHome (actions.ts) at the moment of founding, and this figure lands in
  // a plain-language event description, so it must always read as a clean
  // whole number of tiles.
  const origin = homeOf(agent);
  const distTraveled = manhattanDistance(Math.round(origin.x), Math.round(origin.y), finalX, finalY);

  for (const member of group) {
    member.home = { x: finalX, y: finalY };
    member.migration = null;
  }

  const partnerRel = agent.relationships.find((r) => r.bond === BondType.Pair);
  const partner = partnerRel !== undefined ? state.agents.find((a) => a.id === partnerRel.agentId) : undefined;
  const coupleLabel = partner !== undefined
    ? `${agent.name} and ${partner.name} ${agent.familyName}`
    : `${agent.name} ${agent.familyName}`;

  logEvent(
    state,
    EventType.HamletFounded,
    group.map((m) => m.id),
    { x: finalX, y: finalY },
    `The family of ${coupleLabel} left the crowded shore and founded a new hearth ${distTraveled} tiles inland.`,
    [...new Set(group.map((m) => m.familyName))],
  );

  return migrateOutcome(agent, true, false);
}

// Called from actions.ts only when hasActiveMigration(agent) is true and the
// agent is not pausing for acute survival stress (that gate lives in
// actions.ts, mirroring shouldHeedSourceCall — a pause simply never calls
// this, so stuckTicks only ever counts ticks where a step was attempted).
export function actionMigrateStep(agent: Agent, state: WorldState, _rng: () => number): TickOutcome {
  const m = agent.migration;
  if (m == null) return migrateOutcome(agent, false, true); // defensive; dispatch guarantees non-null

  const dest = { x: m.destX, y: m.destY };
  const distNow = manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y);

  const arrived = distNow <= MIGRATION_CONSTANTS.MIGRATION_ARRIVE_RADIUS;
  const stalled = m.stuckTicks >= MIGRATION_CONSTANTS.MIGRATION_STUCK_TIMEOUT;
  if ((arrived || stalled) && isEffectiveLead(agent, state)) {
    return foundHamlet(agent, state, agent.position.x, agent.position.y);
  }

  const moved = attemptMigrationStep(agent, state, dest);

  const distAfter = manhattanDistance(agent.position.x, agent.position.y, dest.x, dest.y);
  if (distAfter < m.bestDist) {
    m.bestDist = distAfter;
    m.stuckTicks = 0;
  } else {
    m.stuckTicks += 1;
  }

  return migrateOutcome(agent, moved, true);
}

// Exported so actions.ts can gate the "has active migration" branch — a
// trekking member in acute survival stress pauses that tick (falls through to
// normal drive-based dispatch) rather than stepping, mirroring how the Source
// pilgrimage yields to survival.
export function shouldPauseMigrationForSurvival(agent: Agent): boolean {
  return isInAcuteSurvivalStress(agent);
}
