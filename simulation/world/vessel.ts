// simulation/world/vessel.ts
// Vessel integrity, maintenance, helmsman landing decision, and landfall event.
// Called once per tick from the main tick loop while the vessel is at sea.

import type { Agent, Item, SimEvent, TileCache, WorldState, WorldTile } from '@shared/types.js';
import { EventType, FoundingRole, ItemType, Terrain } from '@shared/types.js';
import { COAST_ROW, MAP_WIDTH, VESSEL_ROW_START } from './generator.js';

// ============================================================
// CONSTANTS
// ============================================================

const STARTING_ITEM_COUNTS: Record<ItemType, number> = {
  [ItemType.Axe]: 4,
  [ItemType.Flint]: 6,
  [ItemType.Rope]: 8,
  [ItemType.Knife]: 10,
  [ItemType.Spear]: 6,
};

const DEFAULT_ITEM_CONDITION = 1.0;

const INTEGRITY_DECAY_HIGH = 0.05;
const INTEGRITY_DECAY_NORMAL = 0.02;
const HIGH_DECAY_TICKS = 10;

const LANDING_EVAL_START_TICK = 5;
const LANDING_SCORE_THRESHOLD = 0.35;
const LANDING_FORCE_TICK = 150;
const LANDING_NARRATIVE_WEIGHT = 0.92;

/** Building skill contribution per tick when adjacent to the hull. */
const MAINTENANCE_SKILL_FACTOR = 0.012;

const LANDING_WEIGHTS = {
  integrityUrgency: 0.25,
  helmsmanFear: 0.2,
  helmsmanCourage: 0.15,
  groupFear: 0.2,
  supplyShortage: 0.2,
} as const;

// ============================================================
// HELPERS
// ============================================================

/** Founding vessel inventory: Axe×4, Flint×6, Rope×8, Knife×10, Spear×6. */
export function createStartingVesselItems(): Item[] {
  const items: Item[] = [];
  let index = 0;

  for (const type of Object.values(ItemType)) {
    const count = STARTING_ITEM_COUNTS[type];
    for (let n = 0; n < count; n++) {
      items.push({
        id: `vessel_item_${type}_${index++}`,
        type,
        condition: DEFAULT_ITEM_CONDITION,
      });
    }
  }

  return items;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Fatigue reduces skill effectiveness across the simulation. */
export function fatigueEffectiveness(fatigue: number): number {
  return clamp01(1 - fatigue);
}

function resourceFraction(current: number, max: number): number {
  if (max <= 0) return 0;
  return clamp01(current / max);
}

function isEdgeAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

/** All map tiles with Terrain.Vessel hull structure. */
export function getVesselStructureTiles(tiles: TileCache): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < MAP_WIDTH; x++) {
    const column = tiles.getIfCached(x, VESSEL_ROW_START);
    if (column?.terrain === Terrain.Vessel) {
      positions.push({ x, y: VESSEL_ROW_START });
    }
    const row2 = tiles.getIfCached(x, VESSEL_ROW_START + 1);
    if (row2?.terrain === Terrain.Vessel) {
      positions.push({ x, y: VESSEL_ROW_START + 1 });
    }
  }
  return positions;
}

function agentOnOrAdjacentToVessel(agent: Agent, structure: Array<{ x: number; y: number }>): boolean {
  for (const tile of structure) {
    if (agent.position.x === tile.x && agent.position.y === tile.y) return true;
    if (isEdgeAdjacent(agent.position.x, agent.position.y, tile.x, tile.y)) return true;
  }
  return false;
}

function removeAgentFromTile(tiles: TileCache, agent: Agent): void {
  const tile = tiles.getIfCached(agent.position.x, agent.position.y);
  if (!tile) return;
  tile.occupants = tile.occupants.filter((id) => id !== agent.id);
}

function addAgentToTile(tiles: TileCache, agent: Agent, x: number, y: number): void {
  const tile = tiles.get(x, y);
  if (!tile) return;
  if (!tile.occupants.includes(agent.id)) {
    tile.occupants.push(agent.id);
  }
}

function appendEvent(state: WorldState, event: SimEvent): void {
  state.eventLog.push(event);
  if (state.eventLog.length > 500) {
    state.eventLog = state.eventLog.slice(-500);
  }
}

function averageAliveFear(agents: Agent[]): number {
  const alive = agents.filter((a) => a.alive);
  if (alive.length === 0) return 0;
  return alive.reduce((sum, a) => sum + a.drives.fear, 0) / alive.length;
}

function findHelmsman(state: WorldState): Agent | undefined {
  return state.agents.find((a) => a.id === state.vessel.helmsmanId && a.alive);
}

function rolePriority(role: FoundingRole): number {
  switch (role) {
    case FoundingRole.Leader:
      return 2;
    case FoundingRole.Explorer:
      return 1;
    default:
      return 0;
  }
}

function selectBestHelmsman(aliveAgents: Agent[]): Agent {
  let best = aliveAgents[0];
  if (!best) {
    throw new Error('Cannot select helmsman from empty agent list');
  }

  for (const agent of aliveAgents) {
    const agentScore = agent.traits.acuity + agent.traits.endurance;
    const bestScore = best.traits.acuity + best.traits.endurance;

    if (agentScore > bestScore) {
      best = agent;
      continue;
    }

    if (agentScore < bestScore) continue;

    const agentRole = agent.foundingHistory?.role;
    const bestRole = best.foundingHistory?.role;
    const agentPriority = agentRole ? rolePriority(agentRole) : 0;
    const bestPriority = bestRole ? rolePriority(bestRole) : 0;

    if (agentPriority > bestPriority) {
      best = agent;
    }
  }

  return best;
}

// If the current helmsman is dead, reassign to the alive agent with
// the highest acuity + endurance. Prefer Leader role on ties, then Explorer.
// Does nothing if current helmsman is alive.
// Does nothing if no alive agents remain.
function reassignHelmsmanIfNeeded(state: WorldState): void {
  const current = state.agents.find((a) => a.id === state.vessel.helmsmanId);
  if (current?.alive) return;

  const alive = state.agents.filter((a) => a.alive);
  if (alive.length === 0) return;

  const newHelmsman = selectBestHelmsman(alive);
  state.vessel.helmsmanId = newHelmsman.id;
}

function isCoastLandable(tile: WorldTile | undefined): boolean {
  if (!tile) return false;
  return tile.terrain === Terrain.Coast || tile.terrain === Terrain.River;
}

// ============================================================
// INTEGRITY
// ============================================================

function baseIntegrityDecay(tick: number): number {
  return tick < HIGH_DECAY_TICKS ? INTEGRITY_DECAY_HIGH : INTEGRITY_DECAY_NORMAL;
}

/**
 * Sum maintenance from agents on or adjacent to vessel hull tiles.
 * Building skill reduces decay; fatigue dampens effectiveness as elsewhere.
 */
export function computeMaintenanceReduction(state: WorldState): number {
  const structure = getVesselStructureTiles(state.tiles);
  if (structure.length === 0) return 0;

  let reduction = 0;
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    if (!agentOnOrAdjacentToVessel(agent, structure)) continue;

    const effectiveness =
      agent.skills.building * fatigueEffectiveness(agent.drives.fatigue);
    reduction += effectiveness * MAINTENANCE_SKILL_FACTOR;
  }

  return reduction;
}

export function degradeVesselIntegrity(state: WorldState, maintenanceReduction: number): void {
  if (state.vessel.beached) return;

  const decay = Math.max(0, baseIntegrityDecay(state.tick) - maintenanceReduction);
  state.vessel.integrity = clamp01(state.vessel.integrity - decay);
}

// ============================================================
// HELMSMAN LANDING DECISION
// ============================================================

/**
 * Weighted landing score from vessel state, helmsman profile, group fear,
 * and onboard supplies. Evaluated after tick 20 (end of day 1).
 */
export function computeLandingScore(state: WorldState): number {
  const { vessel, agents } = state;
  const helmsman = findHelmsman(state);

  const integrityUrgency = 1 - vessel.integrity;

  const helmsmanFear = helmsman?.drives.fear ?? averageAliveFear(agents);
  const helmsmanCourageInverse = helmsman ? 1 - helmsman.traits.courage : 0.5;

  const groupFear = averageAliveFear(agents);

  const foodFrac = resourceFraction(
    vessel.resources.food.current,
    vessel.resources.food.max,
  );
  const waterFrac = resourceFraction(
    vessel.resources.water.current,
    vessel.resources.water.max,
  );
  const supplyShortage = 1 - (foodFrac + waterFrac) / 2;

  return clamp01(
    integrityUrgency * LANDING_WEIGHTS.integrityUrgency +
      helmsmanFear * LANDING_WEIGHTS.helmsmanFear +
      helmsmanCourageInverse * LANDING_WEIGHTS.helmsmanCourage +
      groupFear * LANDING_WEIGHTS.groupFear +
      supplyShortage * LANDING_WEIGHTS.supplyShortage,
  );
}

export function shouldTriggerLanding(state: WorldState): boolean {
  if (state.vessel.beached) return false;
  if (state.tick < LANDING_EVAL_START_TICK) return false;

  // Structural failure forces landfall regardless of helmsman's judgment.
  if (state.vessel.integrity <= 0) return true;
  if (state.tick >= LANDING_FORCE_TICK) return true;

  return computeLandingScore(state) >= LANDING_SCORE_THRESHOLD;
}

// ============================================================
// LANDING EVENT
// ============================================================

/** River mouth on the coast row, or map center if no river reaches the beach. */
export function findVesselLandingSite(tiles: TileCache): { x: number; y: number } {
  const riverMouthTiles: number[] = [];
  for (let x = 0; x < MAP_WIDTH; x++) {
    if (tiles.getIfCached(x, COAST_ROW)?.terrain === Terrain.River) {
      riverMouthTiles.push(x);
    }
  }

  if (riverMouthTiles.length > 0) {
    const mid = Math.floor(riverMouthTiles.length / 2);
    return { x: riverMouthTiles[mid]!, y: COAST_ROW };
  }

  return { x: Math.floor(MAP_WIDTH / 2), y: COAST_ROW };
}

function collectCoastSlots(tiles: TileCache): Array<{ x: number; y: number }> {
  const slots: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < MAP_WIDTH; x++) {
    const tile = tiles.get(x, COAST_ROW);
    if (isCoastLandable(tile)) {
      slots.push({ x, y: COAST_ROW });
    }
  }
  return slots;
}

function isAgentOnVessel(agent: Agent, tiles: TileCache): boolean {
  const tile = tiles.getIfCached(agent.position.x, agent.position.y);
  return tile?.terrain === Terrain.Vessel || agent.position.y >= VESSEL_ROW_START;
}

function applyRoughLandingConsequences(
  agentsToMove: Agent[],
  integrity: number,
): void {
  if (integrity >= 0.7) return;

  if (integrity >= 0.4) {
    for (const agent of agentsToMove) {
      agent.drives.fear = clamp01(agent.drives.fear + 0.15);
    }
    return;
  }

  for (const agent of agentsToMove) {
    agent.drives.fear = clamp01(agent.drives.fear + 0.3);
  }

  const griefCount = Math.floor(agentsToMove.length * 0.3);
  const selected = [...agentsToMove].sort(() => Math.random() - 0.5);
  for (let i = 0; i < griefCount; i++) {
    const agent = selected[i];
    if (agent !== undefined) {
      agent.drives.grief = clamp01(agent.drives.grief + 0.2);
    }
  }
}

function buildLandingDescription(
  landingSite: { x: number; y: number },
  agentCount: number,
  integrity: number,
): string {
  const base =
    `The founding vessel beached at (${landingSite.x}, ${landingSite.y}). ` +
    `${agentCount} agents came ashore on the coast.`;

  if (integrity >= 0.7) return base;
  if (integrity >= 0.4) return `${base} The landing was rough.`;
  return `${base} The vessel was nearly lost. Several were injured coming ashore.`;
}

/**
 * Beaches the vessel, relocates all agents from the vessel zone to coast row 29,
 * and logs a high-weight Migration event.
 */
export function executeLanding(state: WorldState): SimEvent {
  const integrityAtLanding = state.vessel.integrity;
  const landingSite = findVesselLandingSite(state.tiles);
  const coastSlots = collectCoastSlots(state.tiles);

  const agentsToMove = state.agents.filter(
    (a) => a.alive && isAgentOnVessel(a, state.tiles),
  );

  for (const agent of agentsToMove) {
    removeAgentFromTile(state.tiles, agent);
  }

  // Spread the party across a beachhead of coast tiles nearest the landing
  // site rather than dumping everyone on one tile. Stacking them all on a
  // single tile is what made the whole band forage as one blob; distinct
  // starting points let central-place foraging fan them out from day one.
  if (coastSlots.length > 0) {
    coastSlots.sort(
      (a, b) =>
        Math.abs(a.x - landingSite.x) - Math.abs(b.x - landingSite.x),
    );

    // Use the nearest N slots (~2 agents per tile) so they land as a tight
    // beachhead centred on the landing site, not strung along the whole coast.
    const beachhead = Math.min(
      coastSlots.length,
      Math.max(8, Math.ceil(agentsToMove.length / 2)),
    );
    agentsToMove.forEach((agent, i) => {
      const slot = coastSlots[i % beachhead] ?? coastSlots[0]!;
      agent.position = { x: slot.x, y: slot.y };
      addAgentToTile(state.tiles, agent, slot.x, slot.y);
    });
  }

  // Clear offshore hull tiles; mark the beached hull on the coast.
  for (let x = 0; x < MAP_WIDTH; x++) {
    const column = state.tiles.getIfCached(x, VESSEL_ROW_START);
    if (column?.terrain === Terrain.Vessel) {
      column.terrain = Terrain.Plain;
      state.tiles.set(x, VESSEL_ROW_START, column);
    }
    const row2 = state.tiles.getIfCached(x, VESSEL_ROW_START + 1);
    if (row2?.terrain === Terrain.Vessel) {
      row2.terrain = Terrain.Plain;
      state.tiles.set(x, VESSEL_ROW_START + 1, row2);
    }
  }

  const beachedTile = state.tiles.get(landingSite.x, landingSite.y);
  if (beachedTile) {
    beachedTile.terrain = Terrain.Vessel;
  }

  state.vessel.beached = true;
  state.vessel.position = { x: landingSite.x, y: landingSite.y };

  const involvedAgents = agentsToMove.map((a) => a.id);
  const helmsman = findHelmsman(state);
  if (helmsman && !involvedAgents.includes(helmsman.id)) {
    involvedAgents.push(helmsman.id);
  }

  applyRoughLandingConsequences(agentsToMove, integrityAtLanding);

  const familyNames = [...new Set(agentsToMove.map((a) => a.familyName))];

  const event: SimEvent = {
    id: `landing_${state.worldId}_${state.tick}`,
    tick: state.tick,
    day: state.day,
    type: EventType.Migration,
    involvedAgents,
    location: { x: landingSite.x, y: landingSite.y },
    description: buildLandingDescription(
      landingSite,
      agentsToMove.length,
      integrityAtLanding,
    ),
    narrativeWeight: LANDING_NARRATIVE_WEIGHT,
    threadRelevant: familyNames,
  };

  appendEvent(state, event);
  return event;
}

// ============================================================
// MAIN TICK ENTRY
// ============================================================

/**
 * Process vessel integrity, maintenance, and landing decision for one tick.
 * Returns a landing event when landfall occurs, otherwise null.
 */
export function tickVessel(state: WorldState): SimEvent | null {
  if (state.vessel.beached) return null;

  reassignHelmsmanIfNeeded(state);

  const maintenanceReduction = computeMaintenanceReduction(state);
  degradeVesselIntegrity(state, maintenanceReduction);

  if (shouldTriggerLanding(state)) {
    return executeLanding(state);
  }

  return null;
}
