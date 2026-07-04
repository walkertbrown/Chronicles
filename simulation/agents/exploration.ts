// simulation/agents/exploration.ts
// Wanderlust-driven inland exploration forays.
//
// Who can venture: any curious, unbonded agent with enough accumulated wanderlust.
// Explorer founding role and youth are BUILD-RATE bonuses (in drives.ts), not
// hard gates — so a high-wanderlust 45-year-old outcast with high curiosity CAN
// roam, just later than a young Explorer. Pair-bonded and Conduit-bonded agents
// have their wanderlust actively decayed in drives.ts so it never pins at 1.0.
//
// Dwell mechanic: scouts who reach dangerous terrain (Ruin/Forest/Mountain) linger
// for a window (~15-40 ticks). During a dwell, MILD hunger does NOT pull them back
// — they resist the forage drive up to DWELL_HUNGER_RESIST_MAX. SEVERE hunger,
// fatigue, or fear still preempts (agents must leave before starving). This gives
// tickPredatorThreat time to accumulate hits so 'animal' deaths actually occur.
//
// Design invariant: no O(n^2) scans of state.agents. Company checks use
// tile.occupants. Keep foray logic here, out of the already-large actions.ts.

import type { Agent, WorldState, WorldTile } from '@shared/types.js';
import { BondType, Terrain } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import {
  getTile,
  isPassable,
  isVesselZone,
  manhattanDistance,
  stepToward,
} from '../world/tiles.js';
import { COAST_ROW } from '../world/generator.js';

// ============================================================
// CONSTANTS
// ============================================================

// Wanderlust must be above this to consider a foray at all.
const WANDERLUST_EXPRESS_THRESHOLD = 0.35;

// Curiosity floor required to venture inland (matches CURIOSITY_EXPLORE_THRESHOLD
// used in actions.ts for the idling exploration branch).
const CURIOSITY_EXPLORE_THRESHOLD = 0.45;

// ---- Dwell mechanic ----
// When a venturing scout is standing on dangerous terrain, it lingers for this
// many ticks before being eligible to leave — giving predator threats time to land.
const DWELL_MIN_TICKS = 15;
const DWELL_MAX_TICKS = 40;

// Hunger threshold below which dwell suppresses the forage-pull. Above this the
// agent overrides the dwell and heads back for food. Set just above the survival
// priority threshold (0.35) so mild hunger is ignored but moderate hunger is not.
// SEVERE hunger (>0.55) always overrides — starvation deaths must not occur.
export const DWELL_HUNGER_RESIST_MAX = 0.55;

// Terrain that triggers dwell behaviour (dangerous ground worth lingering in).
const DWELL_TERRAIN = new Set([Terrain.Forest, Terrain.Ruin, Terrain.Mountain]);

// How far from home the scout's initial waypoint range starts (tiles).
const FORAY_MIN_DIST = 25;

// Max range; grows slightly with discovered-tile count (more experience =
// willing to range further).
const FORAY_MAX_DIST_BASE = 40;
const FORAY_MAX_DIST_DISCOVERY_BONUS = 0.01; // tiles added per discovered tile (capped)
const FORAY_MAX_DIST_CAP = 60;

// How many candidate waypoints we score when picking a destination.
const WAYPOINT_CANDIDATES = 12;

// Weight of ancientDensity vs. undiscovered-tile preference in waypoint scoring.
const WAYPOINT_ANCIENT_WEIGHT = 0.6;
const WAYPOINT_NOVEL_WEIGHT = 0.4;

// Wanderlust discharged per newly-discovered tile during a foray.
const WANDERLUST_DISCHARGE_PER_TILE = 0.12;

// ============================================================
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function tileId(x: number, y: number): string {
  return `${x}_${y}`;
}

// Return (and lazily build) the O(1) Set index for this agent's discovered tiles.
// The backing array (discoveredTileIds) is the serialized source of truth; this
// Set is the fast runtime view.  Never written to Firestore — rehydrated here.
function getDiscoveredSet(agent: Agent): Set<string> {
  const a = agent as AgentWithWaypoint;
  if (a._discoveredSet !== undefined) return a._discoveredSet;
  const set = new Set<string>(agent.discoveredTileIds ?? []);
  a._discoveredSet = set;
  return set;
}

function isDiscovered(agent: Agent, x: number, y: number): boolean {
  return getDiscoveredSet(agent).has(tileId(x, y));
}

function markDiscovered(agent: Agent, x: number, y: number): boolean {
  const id = tileId(x, y);
  const set = getDiscoveredSet(agent);
  if (set.has(id)) return false;
  set.add(id);
  // Keep the array in sync so Firestore serialization is unchanged.
  if (!agent.discoveredTileIds) agent.discoveredTileIds = [];
  agent.discoveredTileIds.push(id);
  return true;
}

// North in this world = LOW y values. COAST_ROW = 1499 is the southern shore.
// Inland / north means heading toward y = 0.
function northOf(y: number): boolean {
  return y < COAST_ROW;
}

// ============================================================
// GATING PREDICATE
// ============================================================

// Returns true when wanderlust should actually drive the agent's action this tick.
//
// Explorer founding role and youth are BUILD-RATE bonuses in tickWanderlust
// (drives.ts), NOT hard gates here. A high-curiosity, unbonded 45-year-old with
// enough accumulated wanderlust CAN venture. Pair-bonded and Conduit-bonded agents
// drain their wanderlust in tickWanderlust so they rarely accumulate enough to pass
// the threshold — but the gate is wanderlust magnitude, not bond status per se.
//
// Survival drives preempt this upstream in getDominantDrive / executeAgentAction,
// so we only reach here when the agent is genuinely wanderlust-dominant.
export function wanderlustExpresses(agent: Agent): boolean {
  // Must have meaningful accumulated wanderlust
  if ((agent.drives.wanderlust ?? 0) < WANDERLUST_EXPRESS_THRESHOLD) return false;

  // Only curious agents venture far from home
  if (agent.traits.curiosity < CURIOSITY_EXPLORE_THRESHOLD) return false;

  // Unbonded: pair-bonded and Conduit-bonded agents bleed wanderlust in drives.ts
  // and almost never reach the threshold — but we also gate here to be safe, since
  // bonded agents have a settled purpose and should not roam.
  const hasPairBond = agent.relationships.some((rel) => rel.bond === BondType.Pair);
  if (hasPairBond) return false;
  if (agent.conduitId !== null) return false;

  return true;
}

// ============================================================
// WAYPOINT SELECTION
// ============================================================

// Pick a distant inland/north waypoint biased toward ancientDensity and
// unexplored ground. Returns null if no suitable candidate can be found
// (e.g., the entire foray range is mountains or water).
export function pickForayWaypoint(
  agent: Agent,
  state: WorldState,
  rng: () => number,
): { x: number; y: number } | null {
  const discoveryCount = agent.discoveredTileIds?.length ?? 0;
  const maxDist = Math.min(
    FORAY_MAX_DIST_CAP,
    FORAY_MAX_DIST_BASE + discoveryCount * FORAY_MAX_DIST_DISCOVERY_BONUS,
  );

  const homeX = agent.home?.x ?? agent.position.x;
  const homeY = agent.home?.y ?? agent.position.y;

  // Build a pool of candidate waypoints by sampling the inland (north) zone
  // at varying distances from home. We step by ~5-tile increments to cover
  // different distances without scanning the whole map.
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (let attempt = 0; attempt < WAYPOINT_CANDIDATES * 3 && candidates.length < WAYPOINT_CANDIDATES; attempt++) {
    // Random angle biased toward north (lower y)
    const angle = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 0.8; // -90 ± 72 deg
    const dist = FORAY_MIN_DIST + rng() * (maxDist - FORAY_MIN_DIST);
    const wx = Math.round(homeX + Math.cos(angle) * dist);
    const wy = Math.round(homeY + Math.sin(angle) * dist);

    // Clamp to world bounds; skip the vessel zone and deep south
    const clampedX = Math.max(2, Math.min(2997, wx));
    const clampedY = Math.max(4, Math.min(COAST_ROW - 5, wy));

    // Must be inland (north of the coastal fringe)
    if (!northOf(clampedY)) continue;

    // Skip vessel zone
    if (isVesselZone(clampedY)) continue;

    const tile = getTile(state.tiles, clampedX, clampedY);
    if (tile === undefined) continue;
    if (!isPassable(tile.terrain, state.vessel.beached)) continue;
    if (tile.terrain === Terrain.Mountain) continue; // don't target mountain peaks

    const isNew = !isDiscovered(agent, clampedX, clampedY);
    const score =
      tile.ancientDensity * WAYPOINT_ANCIENT_WEIGHT +
      (isNew ? 1.0 : 0.0) * WAYPOINT_NOVEL_WEIGHT;

    candidates.push({ x: clampedX, y: clampedY, score });
  }

  if (candidates.length === 0) return null;

  // Pick the highest-scoring candidate
  let best = candidates[0];
  for (const c of candidates) {
    if (best === undefined || c.score > best.score) best = c;
  }

  return best !== undefined ? { x: best.x, y: best.y } : null;
}

// ============================================================
// ACTION
// ============================================================

// Persistent foray waypoint — stored on the agent as a side-channel so we
// don't pick a new target every tick. We reuse discoveredTileIds (already
// an Agent field) for discovery tracking and hang the waypoint off a
// weakly-typed extension to avoid modifying the shared Agent type.
type AgentWithWaypoint = Agent & {
  _forayWaypoint?: { x: number; y: number } | null;
  // Dwell state: how many more ticks this scout should linger on dangerous ground
  // before the foray pull can resume. Counts down each tick the agent stays on
  // dangerous terrain. When zero the agent may move normally again.
  _dwellTicksRemaining?: number;
  // O(1) membership index for discoveredTileIds. Lazily built from the array on
  // first use. The array is kept as the serialized source of truth; this Set is
  // the fast runtime view. Never serialized — rehydrated on first call.
  _discoveredSet?: Set<string>;
};

function getWaypoint(agent: Agent): { x: number; y: number } | null {
  const a = agent as AgentWithWaypoint;
  return a._forayWaypoint ?? null;
}

function setWaypoint(agent: Agent, wp: { x: number; y: number } | null): void {
  (agent as AgentWithWaypoint)._forayWaypoint = wp;
}

function clearWaypoint(agent: Agent): void {
  (agent as AgentWithWaypoint)._forayWaypoint = null;
}

// ---- Dwell helpers ----

function getDwellRemaining(agent: Agent): number {
  return (agent as AgentWithWaypoint)._dwellTicksRemaining ?? 0;
}

function setDwellRemaining(agent: Agent, ticks: number): void {
  (agent as AgentWithWaypoint)._dwellTicksRemaining = ticks;
}

function decrementDwell(agent: Agent): void {
  const a = agent as AgentWithWaypoint;
  a._dwellTicksRemaining = Math.max(0, (a._dwellTicksRemaining ?? 0) - 1);
}

// Returns true if the agent is currently in an active dwell window AND hunger is
// below the resist threshold — i.e., it should suppress the forage-pull this tick.
// Called from actions.ts (executeAgentAction) before routing to chooseForage.
export function agentIsDwelling(agent: Agent): boolean {
  return getDwellRemaining(agent) > 0 &&
    (agent.drives.hunger ?? 0) < DWELL_HUNGER_RESIST_MAX;
}

// Step one tile toward the current foray waypoint, mark the tile discovered,
// discharge wanderlust on newly discovered ground, and return an outcome.
//
// Dwell mechanic: when the agent arrives on dangerous terrain (Forest/Ruin/
// Mountain), a dwell counter is set (15-40 ticks). While dwelling, the agent
// STAYS PUT and the hunger drive in executeAgentAction (actions.ts) is suppressed
// up to DWELL_HUNGER_RESIST_MAX — checked via agentIsDwelling(). This gives
// tickPredatorThreat time to accumulate hits so 'animal' deaths actually fire.
// SEVERE hunger (>DWELL_HUNGER_RESIST_MAX) still preempts — the scout must leave
// before actually starving.
//
// No survival logic here — the dominant-drive preemption in actions.ts
// already handles pulling a hungry/scared scout back. actionFlee already
// steers toward COAST_ROW so a frightened scout runs home automatically.
export function actionVenture(agent: Agent, state: WorldState, rng: () => number): TickOutcome {
  // ---- Dwell: if we're currently lingering on dangerous terrain, count down ----
  const currentTile = getTile(state.tiles, agent.position.x, agent.position.y);
  const onDangerousTerrain =
    currentTile !== undefined && DWELL_TERRAIN.has(currentTile.terrain);

  if (getDwellRemaining(agent) > 0 && onDangerousTerrain) {
    // Actively dwelling — stay put, let predator ticks accumulate
    decrementDwell(agent);
    // Still mark the tile discovered (idempotent) so wanderlust drains correctly
    markDiscovered(agent, agent.position.x, agent.position.y);
    return {
      type: OutcomeType.Ventured,
      success: true,
      partial: false,
      involvedAgentId: null,
      fatigueAtTime: agent.drives.fatigue,
      fearAtTime: agent.drives.fear,
      conflictWon: null,
      amountGained: null,
    };
  }

  let wp = getWaypoint(agent);

  // Pick (or refresh) a waypoint if we don't have one, or if we've arrived.
  if (wp === null || (agent.position.x === wp.x && agent.position.y === wp.y)) {
    wp = pickForayWaypoint(agent, state, rng);
    setWaypoint(agent, wp);
  }

  if (wp === null) {
    // No viable waypoint — discharge a little wanderlust so we don't loop forever
    agent.drives.wanderlust = clamp01((agent.drives.wanderlust ?? 0) - 0.05);
    clearWaypoint(agent);
    return {
      type: OutcomeType.Ventured,
      success: false,
      partial: false,
      involvedAgentId: null,
      fatigueAtTime: agent.drives.fatigue,
      fearAtTime: agent.drives.fear,
      conflictWon: null,
      amountGained: null,
    };
  }

  // Step one tile toward the waypoint
  const next = stepToward(agent.position.x, agent.position.y, wp.x, wp.y);
  const nextTile = getTile(state.tiles, next.x, next.y);

  // If the immediate step is blocked (mountain, water, etc.), try to pick a
  // fresh waypoint next tick rather than banging against a wall repeatedly.
  if (nextTile === undefined || !isPassable(nextTile.terrain, state.vessel.beached) || isVesselZone(next.y)) {
    clearWaypoint(agent);
    return {
      type: OutcomeType.Ventured,
      success: false,
      partial: true,
      involvedAgentId: null,
      fatigueAtTime: agent.drives.fatigue,
      fearAtTime: agent.drives.fear,
      conflictWon: null,
      amountGained: null,
    };
  }

  // Move the agent (update tile occupants manually — mirrors moveAgent in actions.ts)
  const fromTile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (fromTile !== undefined) {
    fromTile.occupants = fromTile.occupants.filter((id) => id !== agent.id);
  }
  agent.position = { x: next.x, y: next.y };
  if (!nextTile.occupants.includes(agent.id)) {
    nextTile.occupants.push(agent.id);
  }

  // Mark discovered; discharge wanderlust on new ground
  const isNew = markDiscovered(agent, next.x, next.y);
  if (isNew) {
    agent.drives.wanderlust = clamp01(
      (agent.drives.wanderlust ?? 0) - WANDERLUST_DISCHARGE_PER_TILE,
    );
  }

  // Arrived on dangerous terrain — start a dwell window so the scout lingers
  if (DWELL_TERRAIN.has(nextTile.terrain)) {
    const dwellTicks = DWELL_MIN_TICKS + Math.floor(rng() * (DWELL_MAX_TICKS - DWELL_MIN_TICKS + 1));
    setDwellRemaining(agent, dwellTicks);
  }

  // Clear waypoint when we've arrived at the destination
  if (next.x === wp.x && next.y === wp.y) {
    clearWaypoint(agent);
  }

  // Special outcomes for notable terrain
  if (isNew && nextTile.terrain === Terrain.Ruin) {
    return {
      type: OutcomeType.FoundRuin,
      success: true,
      partial: false,
      involvedAgentId: null,
      fatigueAtTime: agent.drives.fatigue,
      fearAtTime: agent.drives.fear,
      conflictWon: null,
      amountGained: null,
    };
  }

  return {
    type: OutcomeType.Ventured,
    success: true,
    partial: false,
    involvedAgentId: null,
    fatigueAtTime: agent.drives.fatigue,
    fearAtTime: agent.drives.fear,
    conflictWon: null,
    amountGained: null,
  };
}

// ============================================================
// FORAY WAYPOINT BACKFILL
// Ensure _forayWaypoint and _dwellTicksRemaining fields are initialized for any
// agent where they might be missing (called during the checkpoint-restore path in
// index.ts). This is a pure no-op for fresh agents.
// ============================================================
export function backfillForayWaypoint(agent: Agent): void {
  const a = agent as AgentWithWaypoint;
  if (a._forayWaypoint === undefined) {
    a._forayWaypoint = null;
  }
  if (a._dwellTicksRemaining === undefined) {
    a._dwellTicksRemaining = 0;
  }
}
