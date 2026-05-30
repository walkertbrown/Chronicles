// simulation/companions/being.ts
// Manages the companion being's behavior each tick.

import type {
  Agent,
  AgentProximityRecord,
  CompanionBeing,
  WorldState,
  WorldTile,
} from '@shared/types.js';
import {
  euclideanDistance,
  getAdjacentTiles,
  getTile,
  getTilesInRange,
  isPassable,
  manhattanDistance,
  stepToward,
} from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

const COMPANION_MOVE_CHANCE_BASE = 0.4;
const COMPANION_CURIOSITY_MOVE_BONUS = 0.3;

const FEAR_SPIKE_AGENT_PROXIMITY = 3;
const FEAR_SPIKE_AMOUNT = 0.15;
const FEAR_FADE_RATE = 0.008;
const HIGH_AGGRESSION_FEAR_MULTIPLIER = 1.6;

const CURIOSITY_BUILD_RATE = 0.002;
const CURIOSITY_FADE_NEAR_AGENTS = 0.001;
const CURIOSITY_ANCIENT_DENSITY_BONUS = 0.3;

const PROXIMITY_TRACKING_RADIUS = 5;
const FEAR_SPIKE_THRESHOLD_FOR_RECORD = 0.1;

const BOND_PROXIMITY_TICKS_REQUIRED = 200;
const BOND_NOBILITY_MINIMUM = 0.82;
const BOND_FEAR_SPIKES_MAX = 3;

const ANCIENT_DENSITY_PULL_THRESHOLD = 0.4;
const RUINS_BEHAVIOR_RADIUS = 6;

const AGENTS_NEAR_CURIOSITY_FADE_RADIUS = 5;
const AGENTS_NEAR_CURIOSITY_FADE_COUNT = 3;
const CURIOSITY_ANCIENT_DENSITY_MIN = 0.5;

const FEAR_FLEE_THRESHOLD = 0.5;
const FEAR_CURIOSITY_MOVE_MAX = 0.3;
const CURIOSITY_MOVE_THRESHOLD = 0.5;
const PROXIMITY_MOVE_THRESHOLD = 0.4;
const BOND_PROXIMITY_DISTANCE_SCALE = 15;
const BOND_NEAR_DISTANCE = 3;
const BOND_FAR_DISTANCE = 10;
const BOND_STRENGTH_GAIN = 0.001;
const BOND_STRENGTH_DECAY = 0.0005;

// ============================================================
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function aliveAgents(state: WorldState): Agent[] {
  return state.agents.filter((agent) => agent.alive);
}

function agentsWithinRadius(
  agents: Agent[],
  x: number,
  y: number,
  radius: number,
): Agent[] {
  return agents.filter(
    (agent) => manhattanDistance(x, y, agent.position.x, agent.position.y) <= radius,
  );
}

function fearSpikeFromAgent(agent: Agent): number {
  let spike = FEAR_SPIKE_AMOUNT;
  if (agent.traits.aggression > 0.6) {
    spike *= HIGH_AGGRESSION_FEAR_MULTIPLIER;
  }
  return spike;
}

function getPassableAdjacentPositions(
  tiles: WorldTile[][],
  x: number,
  y: number,
  vesselBeached: boolean,
): Array<{ x: number; y: number; tile: WorldTile }> {
  const positions: Array<{ x: number; y: number; tile: WorldTile }> = [];

  for (const tile of getAdjacentTiles(tiles, x, y)) {
    if (isPassable(tile.terrain, vesselBeached)) {
      positions.push({ x: tile.x, y: tile.y, tile });
    }
  }

  return positions;
}

function findNearestAliveAgent(
  companion: CompanionBeing,
  state: WorldState,
): Agent | undefined {
  let nearest: Agent | undefined;
  let nearestDistance = Infinity;

  for (const agent of aliveAgents(state)) {
    const distance = euclideanDistance(
      companion.position.x,
      companion.position.y,
      agent.position.x,
      agent.position.y,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = agent;
    }
  }

  return nearest;
}

function findAgentById(state: WorldState, agentId: string): Agent | undefined {
  return state.agents.find((agent) => agent.id === agentId);
}

function setCompanionPosition(
  companion: CompanionBeing,
  state: WorldState,
  newX: number,
  newY: number,
): void {
  const newTile = getTile(state.tiles, newX, newY);
  if (newTile === undefined) return;
  if (!isPassable(newTile.terrain, state.vessel.beached)) return;

  const oldTile = getTile(
    state.tiles,
    companion.position.x,
    companion.position.y,
  );
  if (oldTile !== undefined) {
    oldTile.companionPresent = false;
  }

  newTile.companionPresent = true;
  companion.position = { x: newX, y: newY };
}

function pickRandomPassableAdjacent(
  tiles: WorldTile[][],
  x: number,
  y: number,
  vesselBeached: boolean,
): { x: number; y: number } | undefined {
  const adjacent = getPassableAdjacentPositions(tiles, x, y, vesselBeached);
  if (adjacent.length === 0) return undefined;

  const pick = adjacent[Math.floor(Math.random() * adjacent.length)];
  return pick !== undefined ? { x: pick.x, y: pick.y } : undefined;
}

function findOrCreateProximityRecord(
  companion: CompanionBeing,
  agentId: string,
): AgentProximityRecord {
  const existing = companion.agentProximityHistory.find(
    (record) => record.agentId === agentId,
  );
  if (existing !== undefined) return existing;

  const newRecord: AgentProximityRecord = {
    agentId,
    totalTicks: 0,
    fearSpikes: 0,
  };
  companion.agentProximityHistory.push(newRecord);
  return newRecord;
}

// ============================================================
// DRIVE UPDATES
// ============================================================

function tickCompanionDrives(companion: CompanionBeing, state: WorldState): void {
  const { x, y } = companion.position;
  const nearbyForFear = agentsWithinRadius(
    aliveAgents(state),
    x,
    y,
    FEAR_SPIKE_AGENT_PROXIMITY,
  );

  if (nearbyForFear.length > 0) {
    let fearIncrease = 0;
    for (const agent of nearbyForFear) {
      fearIncrease += fearSpikeFromAgent(agent);
    }
    companion.drives.fear = clamp01(companion.drives.fear + fearIncrease);
  } else {
    companion.drives.fear = clamp01(companion.drives.fear - FEAR_FADE_RATE);
  }

  let curiosity = companion.drives.curiosity + CURIOSITY_BUILD_RATE;

  const nearbyAgents = agentsWithinRadius(
    aliveAgents(state),
    x,
    y,
    AGENTS_NEAR_CURIOSITY_FADE_RADIUS,
  );
  if (nearbyAgents.length > AGENTS_NEAR_CURIOSITY_FADE_COUNT) {
    curiosity -= CURIOSITY_FADE_NEAR_AGENTS;
  }

  const currentTile = getTile(state.tiles, x, y);
  if (
    currentTile !== undefined &&
    currentTile.ancientDensity > CURIOSITY_ANCIENT_DENSITY_MIN
  ) {
    curiosity += CURIOSITY_ANCIENT_DENSITY_BONUS * currentTile.ancientDensity;
  }

  companion.drives.curiosity = clamp01(curiosity);

  if (companion.bondedAgentId === null) {
    companion.drives.proximity = 0;
  } else {
    const bondedAgent = findAgentById(state, companion.bondedAgentId);
    if (bondedAgent === undefined || !bondedAgent.alive) {
      companion.drives.proximity = 0;
    } else {
      const distance = manhattanDistance(
        x,
        y,
        bondedAgent.position.x,
        bondedAgent.position.y,
      );
      companion.drives.proximity = clamp01(
        distance / BOND_PROXIMITY_DISTANCE_SCALE,
      );
    }
  }
}

// ============================================================
// MOVEMENT
// ============================================================

function moveCompanion(companion: CompanionBeing, state: WorldState): void {
  const { x, y } = companion.position;
  const { tiles, vessel } = state;
  const vesselBeached = vessel.beached;

  if (companion.drives.fear > FEAR_FLEE_THRESHOLD) {
    const nearestAgent = findNearestAliveAgent(companion, state);
    if (nearestAgent !== undefined) {
      const adjacent = getPassableAdjacentPositions(tiles, x, y, vesselBeached);
      const currentDistance = euclideanDistance(
        x,
        y,
        nearestAgent.position.x,
        nearestAgent.position.y,
      );

      let best: { x: number; y: number } | undefined;
      let bestDistance = currentDistance;

      for (const pos of adjacent) {
        const distance = euclideanDistance(
          pos.x,
          pos.y,
          nearestAgent.position.x,
          nearestAgent.position.y,
        );
        if (distance > bestDistance) {
          bestDistance = distance;
          best = { x: pos.x, y: pos.y };
        }
      }

      if (best !== undefined) {
        setCompanionPosition(companion, state, best.x, best.y);
      }
    }
    return;
  }

  if (
    companion.bondedAgentId !== null &&
    companion.drives.proximity > PROXIMITY_MOVE_THRESHOLD
  ) {
    const bondedAgent = findAgentById(state, companion.bondedAgentId);
    if (bondedAgent !== undefined && bondedAgent.alive) {
      const next = stepToward(x, y, bondedAgent.position.x, bondedAgent.position.y);
      const nextTile = getTile(tiles, next.x, next.y);
      if (
        nextTile !== undefined &&
        isPassable(nextTile.terrain, vesselBeached) &&
        (next.x !== x || next.y !== y)
      ) {
        setCompanionPosition(companion, state, next.x, next.y);
        return;
      }
    }
  }

  if (
    companion.drives.fear < FEAR_CURIOSITY_MOVE_MAX &&
    companion.drives.curiosity > CURIOSITY_MOVE_THRESHOLD
  ) {
    const adjacent = getPassableAdjacentPositions(tiles, x, y, vesselBeached);
    const currentTile = getTile(tiles, x, y);
    const currentDensity = currentTile?.ancientDensity ?? 0;

    let highestDensity = currentDensity;
    for (const pos of adjacent) {
      if (pos.tile.ancientDensity > highestDensity) {
        highestDensity = pos.tile.ancientDensity;
      }
    }

    if (highestDensity <= currentDensity) {
      const randomMove = pickRandomPassableAdjacent(tiles, x, y, vesselBeached);
      if (randomMove !== undefined) {
        setCompanionPosition(companion, state, randomMove.x, randomMove.y);
      }
      return;
    }

    let best: { x: number; y: number } | undefined;
    let bestDensity = currentDensity;

    for (const pos of adjacent) {
      if (pos.tile.ancientDensity > bestDensity) {
        bestDensity = pos.tile.ancientDensity;
        best = { x: pos.x, y: pos.y };
      }
    }

    if (best !== undefined) {
      setCompanionPosition(companion, state, best.x, best.y);
    }
    return;
  }

  const moveChance =
    COMPANION_MOVE_CHANCE_BASE +
    companion.drives.curiosity * COMPANION_CURIOSITY_MOVE_BONUS;

  if (Math.random() < moveChance) {
    const randomMove = pickRandomPassableAdjacent(tiles, x, y, vesselBeached);
    if (randomMove !== undefined) {
      setCompanionPosition(companion, state, randomMove.x, randomMove.y);
    }
  }
}

// ============================================================
// PROXIMITY HISTORY
// ============================================================

function updateProximityHistory(
  companion: CompanionBeing,
  state: WorldState,
): void {
  const { x, y } = companion.position;
  const trackedAgents = agentsWithinRadius(
    aliveAgents(state),
    x,
    y,
    PROXIMITY_TRACKING_RADIUS,
  );

  for (const agent of trackedAgents) {
    const record = findOrCreateProximityRecord(companion, agent.id);
    record.totalTicks += 1;

    const distance = manhattanDistance(
      x,
      y,
      agent.position.x,
      agent.position.y,
    );
    if (distance <= FEAR_SPIKE_AGENT_PROXIMITY) {
      const spike = fearSpikeFromAgent(agent);
      if (spike >= FEAR_SPIKE_THRESHOLD_FOR_RECORD) {
        record.fearSpikes += 1;
      }
    }
  }
}

// ============================================================
// BONDING
// ============================================================

// Sample milestone: eligibility is checked by the tick loop but bonding is
// never executed — a non-null return is logged as a significant event only.
export function checkBondEligibility(
  companion: CompanionBeing,
  state: WorldState,
): string | null {
  if (companion.bondedAgentId !== null) return null;

  for (const record of companion.agentProximityHistory) {
    if (record.totalTicks < BOND_PROXIMITY_TICKS_REQUIRED) continue;
    if (record.fearSpikes >= BOND_FEAR_SPIKES_MAX) continue;

    const agent = findAgentById(state, record.agentId);
    if (agent === undefined || !agent.alive) continue;
    if (agent.traits.nobility < BOND_NOBILITY_MINIMUM) continue;

    return record.agentId;
  }

  return null;
}

function updateBondStrength(companion: CompanionBeing, state: WorldState): void {
  if (companion.bondedAgentId === null) return;

  const bondedAgent = findAgentById(state, companion.bondedAgentId);
  if (bondedAgent === undefined || !bondedAgent.alive) {
    companion.bondedAgentId = null;
    companion.bondStrength = 0;
    return;
  }

  const distance = manhattanDistance(
    companion.position.x,
    companion.position.y,
    bondedAgent.position.x,
    bondedAgent.position.y,
  );

  if (distance <= BOND_NEAR_DISTANCE) {
    companion.bondStrength = clamp01(
      companion.bondStrength + BOND_STRENGTH_GAIN,
    );
  } else if (distance > BOND_FAR_DISTANCE) {
    companion.bondStrength = clamp01(
      companion.bondStrength - BOND_STRENGTH_DECAY,
    );
  }
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function tickCompanion(state: WorldState): void {
  const companion = state.companion;
  if (!companion.alive) return;

  tickCompanionDrives(companion, state);
  moveCompanion(companion, state);
  updateProximityHistory(companion, state);
  updateBondStrength(companion, state);
}

export function getCompanionProximityRecord(
  companion: CompanionBeing,
  agentId: string,
): AgentProximityRecord | undefined {
  return companion.agentProximityHistory.find(
    (record) => record.agentId === agentId,
  );
}

export function createCompanion(
  companionStart: { x: number; y: number },
  tiles: WorldTile[][],
): CompanionBeing {
  const tile = getTile(tiles, companionStart.x, companionStart.y);
  if (tile !== undefined) {
    tile.companionPresent = true;
  }

  return {
    id: 'companion_0',
    position: companionStart,
    alive: true,
    drives: { curiosity: 0.6, fear: 0.7, proximity: 0 },
    bondedAgentId: null,
    bondStrength: 0,
    agentProximityHistory: [],
    heldArtifactId: null,
  };
}
