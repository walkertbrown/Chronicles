// simulation/companions/being.ts
// Manages all 75 Conduit beings each tick.
// Untracked Conduits move, observe, and generate sighting events.
// Bonded Conduits follow their agent and amplify significance.

import type {
  Agent,
  Artifact,
  AgentProximityRecord,
  ConduitBeing,
  SimEvent,
  WorldState,
  WorldTile,
} from '@shared/types.js';
import { EventType } from '@shared/types.js';
import {
  euclideanDistance,
  getAdjacentTiles,
  getTile,
  isPassable,
  manhattanDistance,
  markTileDirty,
  stepToward,
} from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

// Movement
const MOVE_CHANCE_BASE = 0.35;
const CURIOSITY_MOVE_BONUS = 0.25;

// Fear
const FEAR_SPIKE_RADIUS = 4;
const FEAR_SPIKE_BASE = 0.12;
const FEAR_HIGH_AGGRESSION_MULTIPLIER = 1.7;
const FEAR_FADE_RATE = 0.007;
const FEAR_FLEE_THRESHOLD = 0.55;
const FEAR_CURIOSITY_MOVE_MAX = 0.35;

// Curiosity
const CURIOSITY_BUILD_RATE = 0.0015;
const CURIOSITY_MOVE_THRESHOLD = 0.5;
const CURIOSITY_FADE_NEAR_AGENTS = 0.001;
const CURIOSITY_ANCIENT_DENSITY_MIN = 0.45;
const CURIOSITY_ANCIENT_DENSITY_BONUS = 0.25;
const CURIOSITY_HUMAN_PULL_RADIUS = 80;   // tiles — Conduits are curious about humans from far off
const CURIOSITY_HUMAN_PULL_CHANCE = 0.18; // chance per tick to drift toward nearest human cluster

// Proximity (bonded only)
const PROXIMITY_MOVE_THRESHOLD = 0.4;
const PROXIMITY_DISTANCE_SCALE = 18;
const BOND_NEAR_DISTANCE = 3;
const BOND_FAR_DISTANCE = 12;
const BOND_STRENGTH_GAIN = 0.001;
const BOND_STRENGTH_DECAY = 0.0005;

// Imprinting
const IMPRINT_MIN_BOND_STRENGTH = 0.4;

// Proximity history
const PROXIMITY_TRACKING_RADIUS = 6;
// Genuine-fear bar for the fearSpikes proximity counter (see
// updateProximityHistory below): rec.fearSpikes is meant to record how many
// times a tracked agent's presence pushed the CONDUIT into a real fear state
// (per the field's own doc comment on AgentProximityRecord — "how many times
// this agent triggered Conduit fear"), not merely how many ticks they spent
// near each other. FEAR_FLEE_THRESHOLD (0.55) is already this file's own
// definition of "meaningfully fearful" — it's the exact level at which
// moveConduit's fear-flee behavior takes over from everything else. Reusing
// that same bar here (as an independent constant, so the two can be retuned
// separately later without coupling) means a spike is only recorded when the
// Conduit's fear is at the level that already changes its behavior elsewhere
// in this file — not the old per-tick-recomputed value that was always true.
const FEAR_SPIKE_RECORD_MIN_FEAR = 0.55;

// Sighting events
const SIGHTING_COOLDOWN_TICKS = 200;      // min ticks between sighting logs for same Conduit
const SIGHTING_AGENT_RADIUS = 10;         // tiles — how close agents must be to trigger sighting

// ---- Conduit-bond formation eligibility ----
// Grouped into one exported, mutable object — mirrors RELATIONSHIP_CONSTANTS in
// agents/relationships.ts — so the wind-tunnel harness can override how fast the
// fantasy plot ignites without hand-editing this file.
//
// Retuned 2026-07 after wind-tunnel pacing confirmation at 20 seeds (combined
// with CONDUIT_BOND_MIN_TICK below): dark path ignites in ~60% of worlds,
// median Source awakening day 177; light path ignites in ~50% of worlds,
// median day 193.5 — both landing at or near market-gate's target window
// (median awakening day 180-220). Loosening these alone (without the floor)
// only made ignition both more common AND earlier at the same time — the two
// don't decouple from these constants; the floor is what lets timing be
// tuned independently of reliability. See simulation/harness/results/ and
// the commit that applied this retune.
export const CONDUIT_CONSTANTS = {
  // Light bond eligibility
  LIGHT_BOND_PROXIMITY_TICKS: 25,   // ticks spent near this agent
  LIGHT_BOND_FEAR_SPIKES_MAX: 80,
  LIGHT_BOND_CURIOSITY_MIN: 0.65,
  LIGHT_BOND_SIGNIFICANCE_PERCENTILE: 0.80,  // top 20% of population by significance
  LIGHT_BOND_CHRONICLE_PAGES_MIN: 3,

  // Dark bond eligibility
  DARK_BOND_PROXIMITY_TICKS: 10,    // dark bonds form faster — the pull is stronger
  DARK_BOND_FEAR_SPIKES_MAX: 150,      // dark-bond agents spike fear more, but Conduit still approaches
  DARK_BOND_AGGRESSION_MIN: 0.60,
  DARK_BOND_NOBILITY_MAX: 0.50,

  // Availability floor: no bond (light or dark) can form before this tick,
  // regardless of how eligible a pair otherwise is. Proximity/fear-spike
  // accumulation still happens normally before the floor — an already-
  // qualifying pair simply bonds the moment the floor passes, rather than
  // never being able to reach the threshold at all. Set to 6720 ticks
  // (world-day 140) 2026-07 as part of the pacing retune above — this is
  // what lets the eligibility constants be loosened for reliability without
  // also pulling the median ignition day earlier than intended. 0 = no
  // floor. See simulation/harness/results/ and the commit that applied
  // this retune.
  CONDUIT_BOND_MIN_TICK: 6720,

  // ---- Rival pull ----
  // Once the Source has been pinned to one polarity's extreme (|control| >= 0.9,
  // tracked as state.source.extremeSinceTick — see source/source.ts) for a long
  // unbroken stretch, the OPPOSITE polarity's bond eligibility loosens slightly:
  // a small, monotonically-increasing, capped discount on that polarity's
  // proximity-tick requirement and fear-spike ceiling. The already-dominant
  // polarity gets none of this bonus — only the underdog rival is pulled,
  // representing the contest drawing an opposing pilgrim the longer one side
  // has unopposed control. See rivalPullFactor() below.
  //
  // RIVAL_PULL_THRESHOLD_TICKS chosen from the low end of the ~1440-2880 tick
  // (30-60 world day) range explored for this feature: 2160 ticks (~45 days)
  // of unbroken dominance before any bonus activates at all. That's well after
  // the tuned first-ignition pacing (median Source awakening day ~177) has
  // already played out, so this cannot influence which polarity ignites
  // first — it only ever matters for a SECOND, opposing bond forming after one
  // side has already settled in. RIVAL_PULL_FULL_TICKS is the unbroken-
  // dominance duration at which the bonus reaches its cap — another ~180 days
  // (8640 ticks) beyond the threshold, deliberately slow: the goal is to make a
  // year-long standoff contestable eventually, not to make a rival bond common.
  RIVAL_PULL_THRESHOLD_TICKS: 2160,
  RIVAL_PULL_FULL_TICKS: 8640,
  RIVAL_PULL_MAX_PROXIMITY_REDUCTION: 0.5, // up to 50% fewer proximity-ticks required, at full ramp
  RIVAL_PULL_MAX_FEAR_SPIKE_BONUS: 0.5,    // up to 50% higher fear-spike ceiling, at full ramp
};

// Significance multiplier for bonded agents
const LIGHT_BOND_SIGNIFICANCE_MULTIPLIER = 1.45;
const DARK_BOND_SIGNIFICANCE_MULTIPLIER = 1.35;

// ============================================================
// HELPERS
// ============================================================

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---- Per-tick agent cache (performance only — no behavioural change) --------
//
// findAgentById() used to be state.agents.find(...) — a linear scan — and it is
// called once per proximity record, per unbonded Conduit, per tick. With 75
// Conduits and ~50 agents that is ~75 x 50 x 50 = ~190k array walks per tick,
// ~3 BILLION per 365-day seed. aliveAgents() likewise rebuilt a filtered array
// several times per Conduit per tick (~450 allocations/tick).
//
// This was invisible until the one-Conduit-per-soul fix: the old pile-on bug
// bonded all 75 Conduits within a few ticks, and a bonded Conduit returns early
// without scanning. Now ~70 stay unbonded and scan forever. Same work, finally
// visible. A 365-day seed went from seconds to ~15 minutes.
//
// The cache is keyed on the WorldState object AND the tick: the wind tunnel runs
// many worlds in one process and tick numbers repeat, so a tick-only key would
// serve seed 2 the agents of seed 1. Rebuilt lazily, so it cannot go stale.
let cacheState: WorldState | null = null;
let cacheTick = -1;
let cacheAlive: Agent[] = [];
let cacheById: Map<string, Agent> = new Map();
let cachePercentile: Map<string, number> = new Map();
let cachePagesMentioned: Map<string, number> = new Map();

function primeAgentCache(state: WorldState): void {
  cacheState = state;
  cacheTick = state.tick;
  cacheAlive = state.agents.filter((a) => a.alive);
  cacheById = new Map(state.agents.map((a) => [a.id, a])); // ALL agents, not just alive:
  // updateBondStrength() looks a bonded agent up precisely to discover they died.

  // Significance percentile — was a full copy+sort+findIndex of the population,
  // PER CANDIDATE, PER CONDUIT, PER TICK. Sort once instead; identical values
  // (Array.sort is stable, ids are unique, so an agent's index IS its old rank).
  cachePercentile = new Map();
  const sorted = [...cacheAlive].sort((a, b) => a.significanceScore - b.significanceScore);
  const denom = sorted.length - 1;
  for (let i = 0; i < sorted.length; i++) {
    cachePercentile.set(sorted[i]!.id, denom <= 0 ? 1.0 : i / denom);
  }

  // Chronicle mentions — was chroniclePages.filter(...) with a LINEAR eventLog
  // scan per significant-event id, per page, per candidate, per conduit, per
  // tick. Since chroniclePages grows all run (a page every 160 ticks), the cost
  // of one eligibility check grew with the length of the story — this is what
  // made a 365-day seed take ~15 minutes. Fold it once per tick, event ids
  // resolved through a Map. A page counts at most once per agent, exactly as
  // filter().length did.
  cachePagesMentioned = new Map();
  const eventById = new Map(state.eventLog.map((e) => [e.id, e]));
  for (const page of state.chroniclePages) {
    const mentioned = new Set<string>();
    for (const thread of page.threads) {
      if (thread.primaryAgentId !== null) mentioned.add(thread.primaryAgentId);
    }
    for (const eventId of page.significantEvents) {
      const event = eventById.get(eventId);
      if (event === undefined) continue; // evicted from the capped log — as before
      for (const id of event.involvedAgents) mentioned.add(id);
    }
    for (const id of mentioned) {
      cachePagesMentioned.set(id, (cachePagesMentioned.get(id) ?? 0) + 1);
    }
  }
}

function agentCacheIsStale(state: WorldState): boolean {
  return cacheState !== state || cacheTick !== state.tick;
}

function aliveAgents(state: WorldState): Agent[] {
  if (agentCacheIsStale(state)) primeAgentCache(state);
  return cacheAlive; // read-only by every caller; never mutated in place
}

function agentsWithinRadius(
  agents: Agent[],
  x: number,
  y: number,
  radius: number,
): Agent[] {
  return agents.filter(
    (a) => manhattanDistance(x, y, a.position.x, a.position.y) <= radius,
  );
}

function findAgentById(state: WorldState, id: string): Agent | undefined {
  if (agentCacheIsStale(state)) primeAgentCache(state);
  return cacheById.get(id);
}

function findOrCreateProximityRecord(
  conduit: ConduitBeing,
  agentId: string,
): AgentProximityRecord {
  let rec = conduit.agentProximityHistory.find((r) => r.agentId === agentId);
  if (rec === undefined) {
    rec = { agentId, totalTicks: 0, fearSpikes: 0 };
    conduit.agentProximityHistory.push(rec);
  }
  return rec;
}

function pickRandomPassableAdjacent(
  state: WorldState,
  x: number,
  y: number,
  rng: () => number,
): { x: number; y: number } | undefined {
  const candidates: { x: number; y: number }[] = [];
  for (const tile of getAdjacentTiles(state.tiles, x, y)) {
    if (isPassable(tile.terrain, state.vessel.beached)) {
      candidates.push({ x: tile.x, y: tile.y });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(rng() * candidates.length)];
}

function stepTowardPassable(
  state: WorldState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } | undefined {
  const next = stepToward(fromX, fromY, toX, toY);
  if (next.x === fromX && next.y === fromY) return undefined;
  const tile = getTile(state.tiles, next.x, next.y);
  if (tile === undefined || !isPassable(tile.terrain, state.vessel.beached)) return undefined;
  return next;
}

// Returns the significance percentile rank of an agent (0.0 = lowest, 1.0 = highest)
function significancePercentile(agent: Agent, state: WorldState): number {
  if (agentCacheIsStale(state)) primeAgentCache(state);
  return cachePercentile.get(agent.id) ?? 1.0; // absent only if not alive; alive is checked by every caller
}

// ============================================================
// DRIVES
// ============================================================

function tickConduitDrives(conduit: ConduitBeing, state: WorldState): void {
  const { x, y } = conduit.position;
  const alive = aliveAgents(state);

  // Fear: spike from nearby agents, especially aggressive ones
  const nearby = agentsWithinRadius(alive, x, y, FEAR_SPIKE_RADIUS);
  if (nearby.length > 0) {
    let spike = 0;
    for (const agent of nearby) {
      let s = FEAR_SPIKE_BASE;
      if (agent.traits.aggression > 0.6) s *= FEAR_HIGH_AGGRESSION_MULTIPLIER;
      spike += s;
    }
    conduit.drives.fear = clamp01(conduit.drives.fear + spike);
  } else {
    conduit.drives.fear = clamp01(conduit.drives.fear - FEAR_FADE_RATE);
  }

  // Curiosity: builds naturally; ancient density boosts it; many nearby agents dampen it
  let curiosity = conduit.drives.curiosity + CURIOSITY_BUILD_RATE;
  const currentTile = getTile(state.tiles, x, y);
  if (currentTile !== undefined && currentTile.ancientDensity > CURIOSITY_ANCIENT_DENSITY_MIN) {
    curiosity += CURIOSITY_ANCIENT_DENSITY_BONUS * currentTile.ancientDensity;
  }
  const nearbyCount = agentsWithinRadius(alive, x, y, PROXIMITY_TRACKING_RADIUS).length;
  if (nearbyCount > 3) curiosity -= CURIOSITY_FADE_NEAR_AGENTS * nearbyCount;
  conduit.drives.curiosity = clamp01(curiosity);

  // Proximity: only active when bonded
  if (conduit.bondedAgentId === null) {
    conduit.drives.proximity = 0;
  } else {
    const bonded = findAgentById(state, conduit.bondedAgentId);
    if (bonded === undefined || !bonded.alive) {
      conduit.drives.proximity = 0;
    } else {
      const dist = manhattanDistance(x, y, bonded.position.x, bonded.position.y);
      conduit.drives.proximity = clamp01(dist / PROXIMITY_DISTANCE_SCALE);
    }
  }
}

// ============================================================
// MOVEMENT
// ============================================================

function moveConduit(conduit: ConduitBeing, state: WorldState, rng: () => number): void {
  const { x, y } = conduit.position;

  // 1. Fear — flee from nearest agent
  if (conduit.drives.fear > FEAR_FLEE_THRESHOLD) {
    const nearest = aliveAgents(state).reduce<Agent | undefined>((best, a) => {
      const d = euclideanDistance(x, y, a.position.x, a.position.y);
      if (best === undefined) return a;
      return d < euclideanDistance(x, y, best.position.x, best.position.y) ? a : best;
    }, undefined);

    if (nearest !== undefined) {
      // Step away — pick adjacent tile that increases distance
      let best: { x: number; y: number } | undefined;
      let bestDist = euclideanDistance(x, y, nearest.position.x, nearest.position.y);
      for (const tile of getAdjacentTiles(state.tiles, x, y)) {
        if (!isPassable(tile.terrain, state.vessel.beached)) continue;
        const d = euclideanDistance(tile.x, tile.y, nearest.position.x, nearest.position.y);
        if (d > bestDist) { bestDist = d; best = { x: tile.x, y: tile.y }; }
      }
      if (best !== undefined) { setConduitPosition(conduit, state, best.x, best.y); }
    }
    return;
  }

  // 2. Proximity — follow bonded agent
  if (conduit.bondedAgentId !== null && conduit.drives.proximity > PROXIMITY_MOVE_THRESHOLD) {
    const bonded = findAgentById(state, conduit.bondedAgentId);
    if (bonded !== undefined && bonded.alive) {
      const next = stepTowardPassable(state, x, y, bonded.position.x, bonded.position.y);
      if (next !== undefined) { setConduitPosition(conduit, state, next.x, next.y); return; }
    }
  }

  // 3. Curiosity toward humans (untracked Conduits drift toward population)
  if (
    conduit.bondedAgentId === null &&
    conduit.drives.fear < FEAR_CURIOSITY_MOVE_MAX &&
    conduit.drives.curiosity > CURIOSITY_MOVE_THRESHOLD &&
    rng() < CURIOSITY_HUMAN_PULL_CHANCE
  ) {
    const alive = aliveAgents(state);
    const inRange = agentsWithinRadius(alive, x, y, CURIOSITY_HUMAN_PULL_RADIUS);
    if (inRange.length > 0) {
      // Drift toward centroid of nearby humans
      const cx = inRange.reduce((s, a) => s + a.position.x, 0) / inRange.length;
      const cy = inRange.reduce((s, a) => s + a.position.y, 0) / inRange.length;
      const next = stepTowardPassable(state, x, y, Math.round(cx), Math.round(cy));
      if (next !== undefined) { setConduitPosition(conduit, state, next.x, next.y); return; }
    }
  }

  // 4. Ancient density gradient
  if (conduit.drives.fear < FEAR_CURIOSITY_MOVE_MAX && conduit.drives.curiosity > CURIOSITY_MOVE_THRESHOLD) {
    const currentDensity = getTile(state.tiles, x, y)?.ancientDensity ?? 0;
    let best: { x: number; y: number } | undefined;
    let bestDensity = currentDensity;
    for (const tile of getAdjacentTiles(state.tiles, x, y)) {
      if (!isPassable(tile.terrain, state.vessel.beached)) continue;
      if (tile.ancientDensity > bestDensity) { bestDensity = tile.ancientDensity; best = { x: tile.x, y: tile.y }; }
    }
    if (best !== undefined) { setConduitPosition(conduit, state, best.x, best.y); return; }
  }

  // 5. Random wander
  const moveChance = MOVE_CHANCE_BASE + conduit.drives.curiosity * CURIOSITY_MOVE_BONUS;
  if (rng() < moveChance) {
    const r = pickRandomPassableAdjacent(state, x, y, rng);
    if (r !== undefined) setConduitPosition(conduit, state, r.x, r.y);
  }
}

function setConduitPosition(conduit: ConduitBeing, state: WorldState, nx: number, ny: number): void {
  const oldTile = getTile(state.tiles, conduit.position.x, conduit.position.y);
  if (oldTile !== undefined) {
    oldTile.conduitIds = oldTile.conduitIds.filter((id) => id !== conduit.id);
  }
  const newTile = getTile(state.tiles, nx, ny);
  if (newTile !== undefined) {
    if (!newTile.conduitIds.includes(conduit.id)) newTile.conduitIds.push(conduit.id);
  }
  conduit.position = { x: nx, y: ny };
}

// ============================================================
// PROXIMITY HISTORY
// ============================================================

function updateProximityHistory(conduit: ConduitBeing, state: WorldState): void {
  const { x, y } = conduit.position;
  const tracked = agentsWithinRadius(aliveAgents(state), x, y, PROXIMITY_TRACKING_RADIUS);

  // tickConduitDrives() already ran earlier this tick (see tickAllConduits
  // below), so conduit.drives.fear already reflects this tick's fear level —
  // checking the CONDUIT's own current fear state here (rather than
  // recomputing a local per-agent "spike" estimate that was always above the
  // old recording threshold regardless of anything) is what makes this a
  // genuine fear filter instead of a second dwell-time counter.
  const conduitIsGenuinelyAfraid = conduit.drives.fear >= FEAR_SPIKE_RECORD_MIN_FEAR;

  for (const agent of tracked) {
    const rec = findOrCreateProximityRecord(conduit, agent.id);
    rec.totalTicks += 1;
    const dist = manhattanDistance(x, y, agent.position.x, agent.position.y);
    if (dist <= FEAR_SPIKE_RADIUS && conduitIsGenuinelyAfraid) {
      rec.fearSpikes += 1;
    }
  }
}

// ============================================================
// SIGHTING EVENTS
// ============================================================

function maybeLogSighting(
  conduit: ConduitBeing,
  state: WorldState,
  events: SimEvent[],
  rng: () => number,
): void {
  if (conduit.bondedAgentId !== null) return; // bonded Conduits don't generate sighting events

  const { x, y } = conduit.position;
  const nearby = agentsWithinRadius(aliveAgents(state), x, y, SIGHTING_AGENT_RADIUS);
  if (nearby.length === 0) return;

  const cooldownPassed =
    conduit.lastSightingTick === null ||
    state.tick - conduit.lastSightingTick >= SIGHTING_COOLDOWN_TICKS;
  if (!cooldownPassed) return;

  // Pick the highest-significance nearby agent as the anchor for the event description
  const anchor = nearby.reduce((best, a) =>
    a.significanceScore > best.significanceScore ? a : best,
  );

  const descriptions = [
    `A luminous creature was seen watching from the treeline near ${anchor.name} ${anchor.familyName}.`,
    `One of the glowing beings observed from a distance as ${anchor.name} ${anchor.familyName} moved through the area.`,
    `A large-eyed creature lingered at the edge of camp, watching ${anchor.name} ${anchor.familyName} without sound.`,
    `The creature was gone before anyone moved toward it, but ${anchor.name} ${anchor.familyName} saw it clearly.`,
    `Something luminous and still watched from the undergrowth. ${anchor.name} ${anchor.familyName} did not look away.`,
  ];
  const description = descriptions[Math.floor(rng() * descriptions.length)] ?? descriptions[0]!;

  const event: SimEvent = {
    id: `sighting_${conduit.id}_${state.tick}`,
    tick: state.tick,
    day: state.day,
    type: EventType.ConduitSighting,
    involvedAgents: [anchor.id],
    location: { x, y },
    description,
    narrativeWeight: 0.35 + anchor.significanceScore * 0.3,
    threadRelevant: [anchor.familyName],
  };

  events.push(event);
  conduit.sightingCount += 1;
  conduit.lastSightingTick = state.tick;
}

// ============================================================
// BONDING
// ============================================================

// How much the given polarity's bond eligibility should loosen right now,
// as a factor in [0, 1] (0 = no bonus at all). Only ever nonzero for the
// polarity OPPOSITE the Source's current dominant sign, and only once that
// dominance has held unbroken for at least RIVAL_PULL_THRESHOLD_TICKS — see
// the CONDUIT_CONSTANTS block above for the full rationale. Before the Source
// has ever reached an extreme (extremeSinceTick === null), this always
// returns 0 for both polarities, so default behavior is completely unchanged
// until well after the first-ignition pacing has already played out.
function rivalPullFactor(state: WorldState, polarity: 'light' | 'dark'): number {
  const src = state.source;
  if (src.extremeSinceTick === null) return 0;

  // extremeSinceTick is only ever set while |control| >= 0.9 (see tickSource in
  // source/source.ts), so control's sign is well-defined here — no zero case.
  const dominantPolarity: 'light' | 'dark' = src.control > 0 ? 'light' : 'dark';
  if (polarity === dominantPolarity) return 0; // only the underdog rival is pulled

  const ticksAtExtreme = state.tick - src.extremeSinceTick;
  if (ticksAtExtreme < CONDUIT_CONSTANTS.RIVAL_PULL_THRESHOLD_TICKS) return 0;

  const span = CONDUIT_CONSTANTS.RIVAL_PULL_FULL_TICKS - CONDUIT_CONSTANTS.RIVAL_PULL_THRESHOLD_TICKS;
  const progress = span > 0 ? (ticksAtExtreme - CONDUIT_CONSTANTS.RIVAL_PULL_THRESHOLD_TICKS) / span : 1;
  return Math.max(0, Math.min(1, progress));
}

function checkBondEligibility(
  conduit: ConduitBeing,
  state: WorldState,
): { agentId: string; type: 'light' | 'dark' } | null {
  if (conduit.bondedAgentId !== null) return null;
  if (state.tick < CONDUIT_CONSTANTS.CONDUIT_BOND_MIN_TICK) return null;

  // Rival pull — see rivalPullFactor() above. Computed once per call, applied
  // as a discount on the relevant polarity's thresholds below. Both are 0
  // (i.e. defaults are completely unchanged) until the Source has been pinned
  // to one extreme for a long unbroken stretch.
  const darkPull = rivalPullFactor(state, 'dark');
  const lightPull = rivalPullFactor(state, 'light');
  const darkProximityTicksRequired =
    CONDUIT_CONSTANTS.DARK_BOND_PROXIMITY_TICKS * (1 - darkPull * CONDUIT_CONSTANTS.RIVAL_PULL_MAX_PROXIMITY_REDUCTION);
  const darkFearSpikesMax =
    CONDUIT_CONSTANTS.DARK_BOND_FEAR_SPIKES_MAX * (1 + darkPull * CONDUIT_CONSTANTS.RIVAL_PULL_MAX_FEAR_SPIKE_BONUS);
  const lightProximityTicksRequired =
    CONDUIT_CONSTANTS.LIGHT_BOND_PROXIMITY_TICKS * (1 - lightPull * CONDUIT_CONSTANTS.RIVAL_PULL_MAX_PROXIMITY_REDUCTION);
  const lightFearSpikesMax =
    CONDUIT_CONSTANTS.LIGHT_BOND_FEAR_SPIKES_MAX * (1 + lightPull * CONDUIT_CONSTANTS.RIVAL_PULL_MAX_FEAR_SPIKE_BONUS);

  // ---- Three-bucket scan (stateless — recomputed fresh every tick) ----
  //
  // Dark's proximity bar (10 ticks) is numerically lower than light's (25
  // ticks) on the same shared rec.totalTicks counter. Returning on the first
  // dark match found while scanning (as this used to) meant any agent who'd
  // eventually also qualify for light got claimed by dark the instant its
  // easier, purely trait-based bar cleared — foreclosing light entirely for
  // that pairing, even when the agent already satisfied light's harder
  // narrative conditions and just hadn't hit 25 ticks yet. Fixed by scanning
  // every candidate once per tick and sorting into three buckets:
  //
  //   1. Fully light-eligible (every light condition, INCLUDING the 25-tick
  //      dwell) -> bond light with whichever candidate has the highest
  //      significance percentile (tiebreak: lowest agent id string).
  //   2. Dark-eligible AND NOT a "light candidate" -> bond dark with the
  //      longest-lingering candidate (highest totalTicks; tiebreak: lowest
  //      agent id string). A "light candidate" is an agent who already
  //      satisfies every light condition EXCEPT the dwell requirement (i.e.
  //      fear spikes, curiosity, significance percentile, and chronicle
  //      mentions are all already true, but totalTicks hasn't reached 25 yet).
  //   3. Dark-eligible but also a live light candidate -> no bond fires for
  //      this agent this tick; held, re-evaluated fresh next tick. They'll
  //      either reach 25 ticks and land in bucket 1, or lose light-candidacy
  //      (e.g. drop out of the top-20% significance percentile, or their
  //      fear-spike count finally exceeds light's ceiling) and land in
  //      bucket 2 on some future tick.
  //
  // Bucket 1 is checked first: any fully-light-eligible agent this tick means
  // this Conduit bonds light, full stop, for this tick — bucket 2 is only
  // consulted if bucket 1 is empty. No new state: everything here is
  // recomputed fresh from rec.totalTicks / rec.fearSpikes / agent traits /
  // chronicle pages, exactly as the old single-pass version did — and because
  // ties are broken by an explicit, deterministic key (agent id string, not
  // array/object iteration order), the outcome no longer depends on the order
  // agentProximityHistory happens to have been populated in.
  let bestLight: { agent: Agent; percentile: number } | undefined;
  let bestDark: { agent: Agent; totalTicks: number } | undefined;

  for (const rec of conduit.agentProximityHistory) {
    const agent = findAgentById(state, rec.agentId);
    if (agent === undefined || !agent.alive) continue;
    // A soul the Conduits have already claimed is not on offer to the rest of
    // them. The bond is one-to-one on both sides (Agent.conduitId and
    // ConduitBeing.bondedAgentId are both singular) — but only the Conduit side
    // was ever enforced, at the top of this function. With 75 Conduits hunting
    // the ~10-15 agents who clear these gates, every unbonded Conduit piled onto
    // whoever was already bonded: one soul absorbed dozens of bonds, each firing
    // a fresh "major narrative event", each stacking another significance
    // multiplier, and each feeding the Source's bonded-presence reading until it
    // pinned to an extreme. Measured on seed 1: 225 bond events across just 2-3
    // distinct bonded agents.
    if (agent.conduitId !== null) continue;

    // ---- Light-condition components (shared by "fully eligible" and "candidate") ----
    const meetsLightFearSpikes = rec.fearSpikes <= lightFearSpikesMax;
    const meetsLightCuriosity = agent.traits.curiosity >= CONDUIT_CONSTANTS.LIGHT_BOND_CURIOSITY_MIN;
    const meetsLightChronicleGate =
      agent.lastChroniclePageMention !== null || agent.chronicleThreadActive;

    let percentile = 0;
    let meetsLightSignificance = false;
    let meetsLightChronicle = false;
    if (meetsLightFearSpikes && meetsLightCuriosity && meetsLightChronicleGate) {
      percentile = significancePercentile(agent, state);
      meetsLightSignificance = percentile >= CONDUIT_CONSTANTS.LIGHT_BOND_SIGNIFICANCE_PERCENTILE;
      if (meetsLightSignificance) {
        // Chronicle page count check — agent must have been noticed by the story.
        // Folded once per tick in primeAgentCache(); same count, same semantics.
        const pagesMentioned = cachePagesMentioned.get(agent.id) ?? 0;
        meetsLightChronicle = pagesMentioned >= CONDUIT_CONSTANTS.LIGHT_BOND_CHRONICLE_PAGES_MIN;
      }
    }

    const meetsLightDwell = rec.totalTicks >= lightProximityTicksRequired;
    const meetsLightOthers =
      meetsLightFearSpikes && meetsLightCuriosity && meetsLightSignificance && meetsLightChronicle;
    const isFullyLightEligible = meetsLightDwell && meetsLightOthers;
    const isLightCandidate = !meetsLightDwell && meetsLightOthers;

    if (isFullyLightEligible) {
      if (
        bestLight === undefined ||
        percentile > bestLight.percentile ||
        (percentile === bestLight.percentile && agent.id < bestLight.agent.id)
      ) {
        bestLight = { agent, percentile };
      }
    }

    // ---- Dark eligibility ----
    const isDarkEligible =
      rec.totalTicks >= darkProximityTicksRequired &&
      rec.fearSpikes <= darkFearSpikesMax &&
      agent.traits.aggression >= CONDUIT_CONSTANTS.DARK_BOND_AGGRESSION_MIN &&
      agent.traits.nobility <= CONDUIT_CONSTANTS.DARK_BOND_NOBILITY_MAX;

    if (isDarkEligible && !isLightCandidate) {
      if (
        bestDark === undefined ||
        rec.totalTicks > bestDark.totalTicks ||
        (rec.totalTicks === bestDark.totalTicks && agent.id < bestDark.agent.id)
      ) {
        bestDark = { agent, totalTicks: rec.totalTicks };
      }
    }
  }

  if (bestLight !== undefined) {
    return { agentId: bestLight.agent.id, type: 'light' };
  }
  if (bestDark !== undefined) {
    return { agentId: bestDark.agent.id, type: 'dark' };
  }

  return null;
}

function executeBond(
  conduit: ConduitBeing,
  agentId: string,
  bondType: 'light' | 'dark',
  state: WorldState,
  events: SimEvent[],
  rng: () => number,
): void {
  const agent = findAgentById(state, agentId);
  if (agent === undefined) return;

  conduit.bondedAgentId = agentId;
  conduit.bondType = bondType;
  conduit.bondStrength = 0.05;

  agent.conduitId = conduit.id;
  agent.conduitBondType = bondType;

  const eventType = bondType === 'light' ? EventType.ConduitBondLight : EventType.ConduitBondDark;

  const lightDescriptions = [
    `The creature did not leave when ${agent.name} ${agent.familyName} approached. It has not left since.`,
    `${agent.name} ${agent.familyName} sat with the luminous creature until dark. In the morning it was still there.`,
    `Nobody saw it happen. But the creature now follows ${agent.name} ${agent.familyName} wherever they go.`,
  ];
  const darkDescriptions = [
    `The creature approached ${agent.name} ${agent.familyName} in the night. Something about the way it watches has changed.`,
    `${agent.name} ${agent.familyName} did not call to it. It came anyway. The others notice it does not watch them the same way anymore.`,
    `The bond formed without ceremony. Those near ${agent.name} ${agent.familyName} felt the shift before they could name it.`,
  ];
  const descs = bondType === 'light' ? lightDescriptions : darkDescriptions;
  const description = descs[Math.floor(rng() * descs.length)] ?? descs[0]!;

  const event: SimEvent = {
    id: `bond_${conduit.id}_${agentId}_${state.tick}`,
    tick: state.tick,
    day: state.day,
    type: eventType,
    involvedAgents: [agentId],
    location: { ...conduit.position },
    description,
    narrativeWeight: bondType === 'light' ? 0.92 : 0.95,
    threadRelevant: [agent.familyName],
  };

  events.push(event);
}

function updateBondStrength(conduit: ConduitBeing, state: WorldState, events: SimEvent[]): void {
  if (conduit.bondedAgentId === null) return;

  const bonded = findAgentById(state, conduit.bondedAgentId);
  if (bonded === undefined || !bonded.alive) {
    // Agent died — break bond
    const event: SimEvent = {
      id: `bond_broken_${conduit.id}_${state.tick}`,
      tick: state.tick,
      day: state.day,
      type: EventType.ConduitBondBroken,
      involvedAgents: [conduit.bondedAgentId],
      location: { ...conduit.position },
      description: `The creature that had bonded with ${conduit.bondedAgentId} was seen alone at dawn, still as stone.`,
      narrativeWeight: 0.75,
      threadRelevant: [],
    };
    events.push(event);
    conduit.bondedAgentId = null;
    conduit.bondType = null;
    conduit.bondStrength = 0;
    conduit.heldArtifactId = null; // release artifact hold on bond break; imprint/legible flags remain
    return;
  }

  const dist = manhattanDistance(
    conduit.position.x, conduit.position.y,
    bonded.position.x, bonded.position.y,
  );
  if (dist <= BOND_NEAR_DISTANCE) {
    conduit.bondStrength = clamp01(conduit.bondStrength + BOND_STRENGTH_GAIN);
  } else if (dist > BOND_FAR_DISTANCE) {
    conduit.bondStrength = clamp01(conduit.bondStrength - BOND_STRENGTH_DECAY);
  }
}

// ============================================================
// IMPRINTING
// ============================================================

function executeImprint(
  conduit: ConduitBeing,
  agent: Agent,
  artifact: Artifact,
  tile: WorldTile,
  state: WorldState,
  events: SimEvent[],
  rng: () => number,
): void {
  artifact.imprinted = true;
  artifact.legible = true;
  conduit.heldArtifactId = artifact.id;
  markTileDirty(state.tiles, tile.x, tile.y);

  const lightDescriptions = [
    `The creature went still beside ${agent.name} ${agent.familyName}. Not looking at the object — receiving it. Something passed that no one watching could follow.`,
    `${agent.name} ${agent.familyName} did not see the creature touch it. Afterward the object felt different in the hand. The creature did not look away from it.`,
    `The luminous being leaned close to what ${agent.name} ${agent.familyName} carried. The air around them did not move. It felt right in a way that had no name.`,
  ];
  const darkDescriptions = [
    `The creature fixed on what ${agent.name} ${agent.familyName} carried and did not move for a long time. Those nearby felt something open that should not have opened.`,
    `Something in what ${agent.name} ${agent.familyName} held answered the creature's attention. The object had not changed. The wrongness was in how the creature knew it.`,
    `The creature recognized the thing ${agent.name} ${agent.familyName} carried. That was clear. What woke in it at that moment was not.`,
  ];
  const descs = conduit.bondType === 'light' ? lightDescriptions : darkDescriptions;
  const description = descs[Math.floor(rng() * descs.length)] ?? descs[0]!;

  const event: SimEvent = {
    id: `imprint_${conduit.id}_${artifact.id}_${state.tick}`,
    tick: state.tick,
    day: state.day,
    type: EventType.ArtifactImprinted,
    involvedAgents: [agent.id],
    location: { x: tile.x, y: tile.y },
    description,
    narrativeWeight: 0.88,
    threadRelevant: [agent.familyName],
  };

  events.push(event);
}

function maybeImprint(
  conduit: ConduitBeing,
  state: WorldState,
  events: SimEvent[],
  rng: () => number,
): void {
  // Four trigger conditions must all hold
  if (conduit.bondedAgentId === null) return;
  if (conduit.heldArtifactId !== null) return;
  if (conduit.bondStrength < IMPRINT_MIN_BOND_STRENGTH) return;

  const agent = findAgentById(state, conduit.bondedAgentId);
  if (agent === undefined || !agent.alive) return;

  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (tile === undefined) return;

  const artifact = tile.artifacts.find((a) => a.discovered === true && a.imprinted !== true);
  if (artifact === undefined) return;

  executeImprint(conduit, agent, artifact, tile, state, events, rng);
}

// ============================================================
// SIGNIFICANCE MULTIPLIER
// ============================================================

export function applyConduitSignificanceMultipliers(state: WorldState): void {
  for (const conduit of state.conduits) {
    if (conduit.bondedAgentId === null) continue;
    const agent = findAgentById(state, conduit.bondedAgentId);
    if (agent === undefined || !agent.alive) continue;

    const multiplier =
      conduit.bondType === 'dark'
        ? DARK_BOND_SIGNIFICANCE_MULTIPLIER
        : LIGHT_BOND_SIGNIFICANCE_MULTIPLIER;

    agent.significanceScore = Math.min(1.0, agent.significanceScore * multiplier);
  }
}

// ============================================================
// MAIN TICK EXPORT
// ============================================================

/**
 * tickAllConduits
 *
 * Called once per simulation tick. Ticks every one of the 75 Conduits.
 * Returns new SimEvents generated this tick (sightings, bonds, bond breaks).
 * Caller is responsible for appending these to state.eventLog.
 */
export function tickAllConduits(state: WorldState, rng: () => number): SimEvent[] {
  const newEvents: SimEvent[] = [];

  for (const conduit of state.conduits) {
    tickConduitDrives(conduit, state);
    moveConduit(conduit, state, rng);
    updateProximityHistory(conduit, state);
    maybeLogSighting(conduit, state, newEvents, rng);
    updateBondStrength(conduit, state, newEvents);
    maybeImprint(conduit, state, newEvents, rng);

    // Check for new bond — only unbonded Conduits
    if (conduit.bondedAgentId === null) {
      const eligible = checkBondEligibility(conduit, state);
      if (eligible !== null) {
        executeBond(conduit, eligible.agentId, eligible.type, state, newEvents, rng);
      }
    }
  }

  // Apply significance multipliers after all bonds are processed this tick
  applyConduitSignificanceMultipliers(state);

  return newEvents;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * createConduits
 *
 * Called once at world generation. Takes the conduits array from
 * generateWorld() and stamps their initial tile positions into the TileCache.
 * Returns the same array — no data is changed, only tile state is updated.
 */
export function createConduits(conduits: ConduitBeing[], state: WorldState): ConduitBeing[] {
  for (const conduit of conduits) {
    const tile = getTile(state.tiles, conduit.position.x, conduit.position.y);
    if (tile !== undefined && !tile.conduitIds.includes(conduit.id)) {
      tile.conduitIds.push(conduit.id);
    }
  }
  return conduits;
}
