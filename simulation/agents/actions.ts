// simulation/agents/actions.ts
// Determines and executes each agent's action per tick based on dominant drive.

import type { Agent, Drives, WorldState, WorldTile } from '@shared/types.js';
import { BondType, EventType, Terrain } from '@shared/types.js';
import { fatigueModifier } from './drives.js';
import { isSick, illnessSeverity, illnessSkillMultiplier, checkWoundInfection } from './illness.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import { getRelationship, socialRestorationValue } from './relationships.js';
import { COAST_ROW } from '../world/generator.js';
import {
  findBestFoodTile,
  findBestWaterTile,
  getAdjacentTiles,
  getTile,
  getTilesInRange,
  isPassable,
  isVesselZone,
  manhattanDistance,
  stepToward,
} from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

const DRIVE_THRESHOLD = 0.2;

const FOOD_SEARCH_RADIUS = 15;
const WATER_SEARCH_RADIUS = 15;
const SOCIAL_SEARCH_RADIUS = 12;
const HELP_SEARCH_RADIUS = 8;

const FOOD_HARVEST_BASE = 0.12;
const WATER_HARVEST_BASE = 0.10;
const VESSEL_FOOD_HARVEST = 0.08;
const VESSEL_WATER_HARVEST = 0.06;

const HUNGER_RESTORE_FOOD = 0.15;
const HUNGER_RESTORE_WATER = 0.10;

const HUNT_SUCCESS_BASE = 0.3;
const HUNT_SKILL_BONUS = 0.4;
const HUNT_FOOD_RESTORE = 0.25;
const HUNT_COST_FATIGUE = 0.05;

const FISH_SUCCESS_BASE = 0.35;
const FISH_SKILL_BONUS = 0.35;
const FISH_FOOD_RESTORE = 0.2;
const FISH_COST_FATIGUE = 0.04;

const COAST_HUNT_RADIUS = 15;
const RIVER_FISH_RADIUS = 12;

const SEASON_HUNT_MODIFIERS: Record<string, number> = {
  spring: 1.4,
  summer: 1.2,
  autumn: 0.9,
  winter: 1.0,
};

const SEASON_FISH_MODIFIERS: Record<string, number> = {
  spring: 1.5,
  summer: 1.3,
  autumn: 1.0,
  winter: 0.8,
};

const FATIGUE_RESTORE_REST = 0.03;

const COURAGE_STAND_THRESHOLD = 0.55;
const NOBILITY_HELP_THRESHOLD = 0.5;
const CURIOSITY_EXPLORE_THRESHOLD = 0.45;

const CONFLICT_BASE_CHANCE = 0.015;
const CONFLICT_AGGRESSION_SCALE = 0.15;

const STEER_FATIGUE_MAX = 0.8;
const STEER_FEAR_MAX = 0.7;
const STEER_MIN_ACUITY_ENDURANCE = 0.6;

const DRIVE_KEYS: Array<keyof Drives> = [
  'hunger',
  'fatigue',
  'fear',
  'socialNeed',
  'grief',
  'longing',
];

// Shelter tiles will provide a bonus multiplier to fatigue restoration when added.

// ============================================================
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function tileId(x: number, y: number): string {
  return `${x}_${y}`;
}

function makeOutcome(
  agent: Agent,
  fields: {
    type: OutcomeType;
    success: boolean;
    partial?: boolean;
    involvedAgentId?: string | null;
    fatigueAtTime?: number;
    fearAtTime?: number;
    conflictWon?: boolean | null;
    amountGained?: number | null;
  },
): TickOutcome {
  return {
    type: fields.type,
    success: fields.success,
    partial: fields.partial ?? false,
    involvedAgentId: fields.involvedAgentId ?? null,
    fatigueAtTime: fields.fatigueAtTime ?? agent.drives.fatigue,
    fearAtTime: fields.fearAtTime ?? agent.drives.fear,
    conflictWon: fields.conflictWon ?? null,
    amountGained: fields.amountGained ?? null,
  };
}

function resolveDriveTie(agent: Agent, tied: Array<keyof Drives>): keyof Drives {
  const remaining = new Set(tied);

  if (remaining.has('hunger') && remaining.has('fatigue')) {
    remaining.delete('fatigue');
  }

  if (remaining.has('fear') && remaining.has('hunger')) {
    if (agent.drives.fear > 0.85) {
      remaining.delete('hunger');
    } else {
      remaining.delete('fear');
    }
  }

  if (remaining.has('socialNeed') && remaining.has('longing')) {
    const hasPairBond = agent.relationships.some((rel) => rel.bond === BondType.Pair);
    if (hasPairBond) {
      remaining.delete('socialNeed');
    } else {
      remaining.delete('longing');
    }
  }

  const resolved = [...remaining][0];
  return resolved ?? tied[0] ?? 'hunger';
}

function getDominantDrive(agent: Agent): keyof Drives | null {
  const aboveThreshold = DRIVE_KEYS.filter(
    (key) => agent.drives[key] > DRIVE_THRESHOLD,
  );
  if (aboveThreshold.length === 0) return null;

  let maxValue = 0;
  for (const key of aboveThreshold) {
    maxValue = Math.max(maxValue, agent.drives[key]);
  }

  const tied = aboveThreshold.filter(
    (key) => agent.drives[key] >= maxValue - 0.01,
  );

  if (tied.length === 1) {
    return tied[0] ?? null;
  }

  return resolveDriveTie(agent, tied);
}

function markDiscovered(agent: Agent, x: number, y: number): boolean {
  const id = tileId(x, y);
  if (agent.discoveredTileIds.includes(id)) return false;
  agent.discoveredTileIds.push(id);
  return true;
}

function moveAgent(
  agent: Agent,
  toX: number,
  toY: number,
  state: WorldState,
): void {
  const currentTile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (currentTile !== undefined) {
    currentTile.occupants = currentTile.occupants.filter((id) => id !== agent.id);
  }

  agent.position = { x: toX, y: toY };

  const newTile = getTile(state.tiles, toX, toY);
  if (newTile !== undefined && !newTile.occupants.includes(agent.id)) {
    newTile.occupants.push(agent.id);
  }
}

function stepAgentToward(
  agent: Agent,
  targetX: number,
  targetY: number,
  state: WorldState,
): boolean {
  const next = stepToward(agent.position.x, agent.position.y, targetX, targetY);
  const nextTile = getTile(state.tiles, next.x, next.y);
  if (nextTile === undefined) return false;
  if (!isPassable(nextTile.terrain, state.vessel.beached)) return false;

  moveAgent(agent, next.x, next.y, state);
  return true;
}

function shouldEatNotDrink(agent: Agent, state: WorldState): boolean {
  if (agent.lastAteAtTick === null) return true;
  const ticksSinceAte = state.tick - agent.lastAteAtTick;
  const ticksSinceDrink = state.tick - (agent.lastDrankAtTick ?? 0);
  return ticksSinceAte > ticksSinceDrink;
}

function aliveAgents(state: WorldState): Agent[] {
  return state.agents.filter((a) => a.alive);
}

function agentsOnSameTile(agent: Agent, state: WorldState): Agent[] {
  return aliveAgents(state).filter(
    (other) =>
      other.id !== agent.id &&
      other.position.x === agent.position.x &&
      other.position.y === agent.position.y,
  );
}

function agentsOnSameOrAdjacent(agent: Agent, state: WorldState): Agent[] {
  return aliveAgents(state).filter((other) => {
    if (other.id === agent.id) return false;
    const dist = manhattanDistance(
      agent.position.x,
      agent.position.y,
      other.position.x,
      other.position.y,
    );
    return dist <= 1;
  });
}

function pickHighestTrust(agent: Agent, candidates: Agent[]): Agent | undefined {
  let best: Agent | undefined;
  let bestTrust = -Infinity;

  for (const candidate of candidates) {
    const trust = getRelationship(agent, candidate.id)?.trust ?? 0;
    if (trust > bestTrust) {
      bestTrust = trust;
      best = candidate;
    }
  }

  return best;
}

function findNearestAgent(
  agent: Agent,
  state: WorldState,
  radius: number,
  filter?: (other: Agent) => boolean,
): Agent | undefined {
  let nearest: Agent | undefined;
  let nearestDist = Infinity;

  for (const other of aliveAgents(state)) {
    if (other.id === agent.id) continue;
    if (filter !== undefined && !filter(other)) continue;

    const dist = manhattanDistance(
      agent.position.x,
      agent.position.y,
      other.position.x,
      other.position.y,
    );
    if (dist <= radius && dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }

  return nearest;
}

function findLongingTarget(agent: Agent, state: WorldState): Agent | undefined {
  const pairBond = agent.relationships.find((rel) => rel.bond === BondType.Pair);
  if (pairBond !== undefined) {
    const partner = aliveAgents(state).find((a) => a.id === pairBond.agentId);
    if (partner !== undefined) return partner;
  }

  let best: Agent | undefined;
  let bestTrust = -Infinity;
  for (const other of aliveAgents(state)) {
    if (other.id === agent.id) continue;
    const trust = getRelationship(agent, other.id)?.trust ?? -1;
    if (trust > bestTrust) {
      bestTrust = trust;
      best = other;
    }
  }

  return best;
}

function findDistressedAgent(agent: Agent, state: WorldState): Agent | undefined {
  let best: Agent | undefined;
  let bestDistress = 0;

  for (const other of aliveAgents(state)) {
    if (other.id === agent.id) continue;
    const dist = manhattanDistance(
      agent.position.x,
      agent.position.y,
      other.position.x,
      other.position.y,
    );
    if (dist > HELP_SEARCH_RADIUS) continue;

    const sicklyDistressed =
      isSick(other) && illnessSeverity(other) > 0.5;
    const distress = Math.max(
      other.drives.fear > 0.6 ? other.drives.fear : 0,
      other.drives.grief > 0.7 ? other.drives.grief : 0,
      other.drives.hunger > 0.8 ? other.drives.hunger : 0,
      sicklyDistressed ? illnessSeverity(other) : 0,
    );
    const qualifies =
      other.drives.fear > 0.6 ||
      other.drives.grief > 0.7 ||
      other.drives.hunger > 0.8 ||
      sicklyDistressed;

    if (qualifies && distress >= bestDistress) {
      bestDistress = distress;
      best = other;
    }
  }

  return best;
}

function isOnVesselTile(agent: Agent, state: WorldState): boolean {
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  return tile?.terrain === Terrain.Vessel;
}

function isOnOrAdjacentToVessel(agent: Agent, state: WorldState): boolean {
  if (isOnVesselTile(agent, state)) return true;
  return getAdjacentTiles(state.tiles, agent.position.x, agent.position.y).some(
    (tile) => tile.terrain === Terrain.Vessel,
  );
}

function restoreFatigue(agent: Agent): void {
  const restore =
    FATIGUE_RESTORE_REST * fatigueModifier(agent.drives.fatigue);
  agent.drives.fatigue = clamp01(agent.drives.fatigue - restore);
}

function findThreatLocation(
  agent: Agent,
  state: WorldState,
): { x: number; y: number } | null {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (state.tick - event.tick > 10) break;
    if (
      event.type === EventType.Conflict &&
      event.involvedAgents.includes(agent.id)
    ) {
      return event.location;
    }
  }
  return null;
}

function findSteerer(state: WorldState): Agent | undefined {
  const helmsman = state.agents.find(
    (a) => a.id === state.vessel.helmsmanId && a.alive,
  );
  if (
    helmsman !== undefined &&
    helmsman.drives.fatigue < STEER_FATIGUE_MAX &&
    helmsman.drives.fear < STEER_FEAR_MAX
  ) {
    return helmsman;
  }

  let best: Agent | undefined;
  let bestScore = -1;

  for (const agent of aliveAgents(state)) {
    if (
      agent.drives.fatigue >= STEER_FATIGUE_MAX ||
      agent.drives.fear >= STEER_FEAR_MAX
    ) {
      continue;
    }

    const score = agent.traits.acuity + agent.traits.endurance;
    if (score < STEER_MIN_ACUITY_ENDURANCE) continue;

    if (score > bestScore) {
      bestScore = score;
      best = agent;
    }
  }

  return best;
}

function shouldNobilityHelp(agent: Agent, state: WorldState): boolean {
  if (agent.traits.nobility < NOBILITY_HELP_THRESHOLD) return false;
  if (agent.drives.hunger >= 0.7 || agent.drives.fear >= 0.6) return false;
  return findDistressedAgent(agent, state) !== undefined;
}

function shouldConflict(agent: Agent, state: WorldState): boolean {
  if (agent.traits.aggression <= 0.5) return false;
  const others = agentsOnSameTile(agent, state);
  if (others.length === 0) return false;

  const chance =
    CONFLICT_BASE_CHANCE +
    (agent.traits.aggression - 0.5) * CONFLICT_AGGRESSION_SCALE;
  return Math.random() < chance;
}

function pickRandomSameTileTarget(agent: Agent, state: WorldState): Agent | undefined {
  const others = agentsOnSameTile(agent, state);
  if (others.length === 0) return undefined;
  const index = Math.floor(Math.random() * others.length);
  return others[index];
}

// ============================================================
// AT SEA ACTIONS
// ============================================================

function actionEatFromVessel(agent: Agent, state: WorldState): TickOutcome {
  const food = state.vessel.resources.food;
  if (food.current <= 0) {
    return makeOutcome(agent, {
      type: OutcomeType.AteSomething,
      success: false,
      amountGained: 0,
    });
  }

  const consumed = Math.min(VESSEL_FOOD_HARVEST, food.current);
  food.current = Math.max(0, food.current - consumed);
  agent.drives.hunger = clamp01(agent.drives.hunger - HUNGER_RESTORE_FOOD);
  agent.lastAteAtTick = state.tick;

  return makeOutcome(agent, {
    type: OutcomeType.AteSomething,
    success: true,
    amountGained: consumed,
  });
}

function actionDrinkFromVessel(agent: Agent, state: WorldState): TickOutcome {
  const water = state.vessel.resources.water;
  if (water.current <= 0) {
    return makeOutcome(agent, {
      type: OutcomeType.DrankWater,
      success: false,
      amountGained: 0,
    });
  }

  const consumed = Math.min(VESSEL_WATER_HARVEST, water.current);
  water.current = Math.max(0, water.current - consumed);
  agent.drives.hunger = clamp01(agent.drives.hunger - HUNGER_RESTORE_WATER);
  agent.lastDrankAtTick = state.tick;

  return makeOutcome(agent, {
    type: OutcomeType.DrankWater,
    success: true,
    amountGained: consumed,
  });
}

function actionRestAtSea(agent: Agent): TickOutcome {
  restoreFatigue(agent);
  return makeOutcome(agent, { type: OutcomeType.Rested, success: true });
}

function actionMaintainVessel(agent: Agent): TickOutcome {
  const success =
    Math.random() <
    agent.skills.building * fatigueModifier(agent.drives.fatigue) + 0.2;

  return makeOutcome(agent, {
    type: OutcomeType.Maintained,
    success,
  });
}

function actionSteer(agent: Agent): TickOutcome {
  return makeOutcome(agent, { type: OutcomeType.Steered, success: true });
}

function actionInteractAtSea(agent: Agent, state: WorldState): TickOutcome {
  const candidates = agentsOnSameOrAdjacent(agent, state);
  const target = pickHighestTrust(agent, candidates);

  if (target === undefined) {
    return makeOutcome(agent, { type: OutcomeType.Interacted, success: false });
  }

  const trust = getRelationship(agent, target.id)?.trust ?? 0;
  const restoration = socialRestorationValue(trust);
  agent.drives.socialNeed = clamp01(agent.drives.socialNeed - restoration);

  return makeOutcome(agent, {
    type: OutcomeType.Interacted,
    success: true,
    involvedAgentId: target.id,
  });
}

// ============================================================
// ON LAND ACTIONS
// ============================================================

function actionHarvestFood(agent: Agent, state: WorldState): TickOutcome {
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (tile === undefined) {
    return makeOutcome(agent, {
      type: OutcomeType.Harvested,
      success: false,
      partial: false,
    });
  }

  if (tile.resources.food.current >= 0.05) {
    const amount = Math.min(
      FOOD_HARVEST_BASE * (0.5 + agent.skills.gathering) * illnessSkillMultiplier(agent),
      tile.resources.food.current,
    );
    const foodBefore = tile.resources.food.current;
    tile.resources.food.current = Math.max(0, tile.resources.food.current - amount);
    agent.drives.hunger = clamp01(agent.drives.hunger - HUNGER_RESTORE_FOOD);
    agent.lastAteAtTick = state.tick;

    const newlyDiscovered = markDiscovered(agent, tile.x, tile.y);
    if (newlyDiscovered && foodBefore > 0.3) {
      return makeOutcome(agent, {
        type: OutcomeType.FoundResource,
        success: true,
        amountGained: amount,
      });
    }

    return makeOutcome(agent, {
      type: OutcomeType.Harvested,
      success: true,
      amountGained: amount,
    });
  }

  const bestFood = findBestFoodTile(
    state.tiles,
    agent.position.x,
    agent.position.y,
    FOOD_SEARCH_RADIUS,
  );
  if (bestFood !== undefined) {
    stepAgentToward(agent, bestFood.x, bestFood.y, state);
    return makeOutcome(agent, {
      type: OutcomeType.Harvested,
      success: false,
      partial: true,
    });
  }

  return makeOutcome(agent, {
    type: OutcomeType.Harvested,
    success: false,
    partial: false,
  });
}

function actionDrinkWater(agent: Agent, state: WorldState): TickOutcome {
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (tile === undefined) {
    return makeOutcome(agent, {
      type: OutcomeType.DrankWater,
      success: false,
      partial: false,
    });
  }

  if (tile.resources.water.current >= 0.05) {
    const amount = Math.min(
      WATER_HARVEST_BASE * (0.5 + agent.skills.gathering) * illnessSkillMultiplier(agent),
      tile.resources.water.current,
    );
    tile.resources.water.current = Math.max(
      0,
      tile.resources.water.current - amount,
    );
    agent.drives.hunger = clamp01(agent.drives.hunger - HUNGER_RESTORE_WATER);
    agent.lastDrankAtTick = state.tick;

    return makeOutcome(agent, {
      type: OutcomeType.DrankWater,
      success: true,
      amountGained: amount,
    });
  }

  const bestWater = findBestWaterTile(
    state.tiles,
    agent.position.x,
    agent.position.y,
    WATER_SEARCH_RADIUS,
  );
  if (bestWater !== undefined) {
    stepAgentToward(agent, bestWater.x, bestWater.y, state);
    return makeOutcome(agent, {
      type: OutcomeType.DrankWater,
      success: false,
      partial: true,
    });
  }

  return makeOutcome(agent, {
    type: OutcomeType.DrankWater,
    success: false,
    partial: false,
  });
}

function actionRest(agent: Agent): TickOutcome {
  restoreFatigue(agent);
  return makeOutcome(agent, { type: OutcomeType.Rested, success: true });
}

function actionFlee(agent: Agent, state: WorldState): TickOutcome {
  const threat = findThreatLocation(agent, state);

  if (threat !== null) {
    const awayX =
      agent.position.x + Math.sign(agent.position.x - threat.x);
    const awayY =
      agent.position.y + Math.sign(agent.position.y - threat.y);
    stepAgentToward(agent, awayX, awayY, state);
  } else {
    stepAgentToward(agent, agent.position.x, COAST_ROW, state);
  }

  return makeOutcome(agent, { type: OutcomeType.Fled, success: true });
}

function actionStandGround(agent: Agent): TickOutcome {
  return makeOutcome(agent, {
    type: OutcomeType.StoodGround,
    success: true,
    fearAtTime: agent.drives.fear,
  });
}

function actionInteractOnLand(
  agent: Agent,
  targetAgent: Agent,
): TickOutcome {
  const trust = getRelationship(agent, targetAgent.id)?.trust ?? 0;
  const restoration = socialRestorationValue(trust);
  agent.drives.socialNeed = clamp01(agent.drives.socialNeed - restoration);

  return makeOutcome(agent, {
    type: OutcomeType.Interacted,
    success: true,
    involvedAgentId: targetAgent.id,
  });
}

function actionMoveTowardSocial(
  agent: Agent,
  state: WorldState,
  target?: Agent,
): TickOutcome {
  const candidates = target !== undefined
    ? [target]
    : aliveAgents(state).filter((other) => {
        if (other.id === agent.id) return false;
        const dist = manhattanDistance(
          agent.position.x,
          agent.position.y,
          other.position.x,
          other.position.y,
        );
        return dist <= SOCIAL_SEARCH_RADIUS;
      });

  const socialTarget = target ?? pickHighestTrust(agent, candidates);
  if (socialTarget === undefined) {
    return makeOutcome(agent, { type: OutcomeType.Wandered, success: false });
  }

  const dist = manhattanDistance(
    agent.position.x,
    agent.position.y,
    socialTarget.position.x,
    socialTarget.position.y,
  );

  if (dist <= 1) {
    return actionInteractOnLand(agent, socialTarget);
  }

  stepAgentToward(
    agent,
    socialTarget.position.x,
    socialTarget.position.y,
    state,
  );

  return makeOutcome(agent, { type: OutcomeType.Wandered, success: true });
}

function actionHelp(agent: Agent, state: WorldState): TickOutcome {
  const target = findDistressedAgent(agent, state);
  if (target === undefined) {
    return makeOutcome(agent, { type: OutcomeType.Helped, success: false });
  }

  const dist = manhattanDistance(
    agent.position.x,
    agent.position.y,
    target.position.x,
    target.position.y,
  );

  if (dist <= 1) {
    const fearBefore = target.drives.fear;
    let fearReduce = 0.1;
    let griefReduce = 0.05;

    if (isSick(target)) {
      // Active treatment intent; passive healer recovery runs in illness.ts tickIllness
      const healFactor = agent.skills.healing * illnessSkillMultiplier(agent);
      fearReduce *= 0.5 + healFactor;
      griefReduce *= 0.5 + healFactor;
    }

    target.drives.fear = clamp01(target.drives.fear - fearReduce);
    target.drives.grief = clamp01(target.drives.grief - griefReduce);

    return makeOutcome(agent, {
      type: OutcomeType.Helped,
      success: true,
      involvedAgentId: target.id,
      fearAtTime: fearBefore,
    });
  }

  stepAgentToward(agent, target.position.x, target.position.y, state);
  return makeOutcome(agent, {
    type: OutcomeType.Helped,
    success: false,
    partial: true,
  });
}

function pickExploreTile(agent: Agent, state: WorldState): WorldTile | undefined {
  const adjacent = getAdjacentTiles(
    state.tiles,
    agent.position.x,
    agent.position.y,
  ).filter((tile) => isPassable(tile.terrain, state.vessel.beached));

  const undiscovered = adjacent.filter(
    (tile) => !agent.discoveredTileIds.includes(tileId(tile.x, tile.y)),
  );

  if (undiscovered.length > 0) {
    let best = undiscovered[0];
    for (const tile of undiscovered) {
      if (best !== undefined && tile.ancientDensity > best.ancientDensity) {
        best = tile;
      }
    }
    if (best !== undefined) return best;
  }

  const randomUndiscovered = undiscovered.filter(
    (tile) => !agent.discoveredTileIds.includes(tileId(tile.x, tile.y)),
  );
  if (randomUndiscovered.length > 0) {
    const index = Math.floor(Math.random() * randomUndiscovered.length);
    return randomUndiscovered[index];
  }

  if (undiscovered.length > 0) {
    const index = Math.floor(Math.random() * undiscovered.length);
    return undiscovered[index];
  }

  let bestPassable: WorldTile | undefined;
  let bestDensity = -1;
  for (const tile of adjacent) {
    if (tile.ancientDensity > bestDensity) {
      bestDensity = tile.ancientDensity;
      bestPassable = tile;
    }
  }
  return bestPassable;
}

function actionExplore(agent: Agent, state: WorldState): TickOutcome {
  const destination = pickExploreTile(agent, state);
  if (destination === undefined) {
    return makeOutcome(agent, { type: OutcomeType.Explored, success: false });
  }

  moveAgent(agent, destination.x, destination.y, state);
  markDiscovered(agent, destination.x, destination.y);

  if (destination.terrain === Terrain.Ruin) {
    return makeOutcome(agent, {
      type: OutcomeType.FoundRuin,
      success: true,
      fearAtTime: agent.drives.fear,
    });
  }

  const artifact = destination.artifacts.find((item) => !item.discovered);
  if (artifact !== undefined) {
    artifact.discovered = true;
    return makeOutcome(agent, {
      type: OutcomeType.FoundArtifact,
      success: true,
      fearAtTime: agent.drives.fear,
    });
  }

  return makeOutcome(agent, { type: OutcomeType.Explored, success: true });
}

function actionWander(agent: Agent, state: WorldState): TickOutcome {
  const adjacent = getAdjacentTiles(
    state.tiles,
    agent.position.x,
    agent.position.y,
  ).filter((tile) => isPassable(tile.terrain, state.vessel.beached));

  if (adjacent.length === 0) {
    return makeOutcome(agent, { type: OutcomeType.Wandered, success: false });
  }

  const index = Math.floor(Math.random() * adjacent.length);
  const destination = adjacent[index];
  if (destination === undefined) {
    return makeOutcome(agent, { type: OutcomeType.Wandered, success: false });
  }

  moveAgent(agent, destination.x, destination.y, state);
  markDiscovered(agent, destination.x, destination.y);

  if (
    agent.drives.grief > 0.6 &&
    Math.random() < agent.traits.curiosity
  ) {
    const secondAdjacent = getAdjacentTiles(
      state.tiles,
      agent.position.x,
      agent.position.y,
    ).filter((tile) => isPassable(tile.terrain, state.vessel.beached));
    const secondIndex = Math.floor(Math.random() * secondAdjacent.length);
    const second = secondAdjacent[secondIndex];
    if (second !== undefined) {
      moveAgent(agent, second.x, second.y, state);
      markDiscovered(agent, second.x, second.y);
    }
  }

  return makeOutcome(agent, { type: OutcomeType.Wandered, success: true });
}

function actionConflict(
  agent: Agent,
  targetAgent: Agent,
  state: WorldState,
  outcomes: TickOutcome[],
): TickOutcome {
  const agentStrength =
    agent.traits.aggression * 0.5 +
    agent.traits.courage * 0.3 +
    Math.random() * 0.2;
  const targetStrength =
    targetAgent.traits.aggression * 0.5 +
    targetAgent.traits.courage * 0.3 +
    Math.random() * 0.2;
  const agentWon = agentStrength > targetStrength;

  agent.drives.fear = clamp01(agent.drives.fear + 0.2);
  targetAgent.drives.fear = clamp01(targetAgent.drives.fear + 0.2);

  if (agentWon) {
    targetAgent.drives.grief = clamp01(targetAgent.drives.grief + 0.1);
  } else {
    agent.drives.grief = clamp01(agent.drives.grief + 0.1);
  }

  outcomes.push(
    makeOutcome(agent, {
      type: OutcomeType.ConflictResolved,
      success: true,
      involvedAgentId: targetAgent.id,
      conflictWon: agentWon,
    }),
  );

  const loser = agentWon ? targetAgent : agent;
  checkWoundInfection(loser, state.tick);
  // Tick loop logs illness events when illness state changes

  return makeOutcome(agent, {
    type: OutcomeType.Conflicted,
    success: agentWon,
    involvedAgentId: targetAgent.id,
    conflictWon: agentWon,
  });
}

function isNearCoast(agent: Agent, state: WorldState): boolean {
  const tiles = getTilesInRange(state.tiles, agent.position.x, agent.position.y, COAST_HUNT_RADIUS);
  return tiles.some((t) => t.terrain === Terrain.Coast) ||
    getTile(state.tiles, agent.position.x, agent.position.y)?.terrain === Terrain.Coast;
}

function isOnOrNearRiver(agent: Agent, state: WorldState): boolean {
  const current = getTile(state.tiles, agent.position.x, agent.position.y);
  if (current?.terrain === Terrain.River) return true;
  const tiles = getTilesInRange(state.tiles, agent.position.x, agent.position.y, RIVER_FISH_RADIUS);
  return tiles.some((t) => t.terrain === Terrain.River);
}

function actionHunt(agent: Agent, state: WorldState): TickOutcome {
  const seasonMod = SEASON_HUNT_MODIFIERS[state.season] ?? 1.0;
  const successChance = (HUNT_SUCCESS_BASE + agent.skills.hunting * HUNT_SKILL_BONUS) * seasonMod;
  const fatigued = fatigueModifier(agent.drives.fatigue);
  const success = Math.random() < successChance * fatigued * illnessSkillMultiplier(agent);

  agent.drives.fatigue = clamp01(agent.drives.fatigue + HUNT_COST_FATIGUE);

  if (success) {
    agent.drives.hunger = clamp01(agent.drives.hunger - HUNT_FOOD_RESTORE);
    agent.lastAteAtTick = state.tick;
  }

  const attackChance = 0.08 - agent.skills.hunting * 0.06;
  if (Math.random() < Math.max(0.02, attackChance)) {
    agent.healthScore = clamp01(agent.healthScore - 0.15);
    agent.drives.fear = clamp01(agent.drives.fear + 0.3);
    agent.animalAttackTick = state.tick;
  }

  return makeOutcome(agent, {
    type: OutcomeType.Hunted,
    success,
    amountGained: success ? HUNT_FOOD_RESTORE : 0,
  });
}

function actionFish(agent: Agent, state: WorldState): TickOutcome {
  const seasonMod = SEASON_FISH_MODIFIERS[state.season] ?? 1.0;
  const successChance = (FISH_SUCCESS_BASE + agent.skills.gathering * FISH_SKILL_BONUS) * seasonMod;
  const fatigued = fatigueModifier(agent.drives.fatigue);
  const success = Math.random() < successChance * fatigued * illnessSkillMultiplier(agent);

  agent.drives.fatigue = clamp01(agent.drives.fatigue + FISH_COST_FATIGUE);

  if (success) {
    agent.drives.hunger = clamp01(agent.drives.hunger - FISH_FOOD_RESTORE);
    agent.lastAteAtTick = state.tick;
    if (getTile(state.tiles, agent.position.x, agent.position.y)?.terrain !== Terrain.River) {
      const riverTile = findBestWaterTile(state.tiles, agent.position.x, agent.position.y, RIVER_FISH_RADIUS);
      if (riverTile !== undefined) {
        stepAgentToward(agent, riverTile.x, riverTile.y, state);
      }
    }
  }

  return makeOutcome(agent, {
    type: OutcomeType.Fished,
    success,
    amountGained: success ? FISH_FOOD_RESTORE : 0,
  });
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function executeAgentAction(
  agent: Agent,
  state: WorldState,
  outcomes: TickOutcome[],
): void {
  const atSea = isVesselZone(agent.position.y);

  if (atSea) {
    const steerer = findSteerer(state);
    if (steerer?.id === agent.id && isOnOrAdjacentToVessel(agent, state)) {
      outcomes.push(actionSteer(agent));
      return;
    }

    const drive = getDominantDrive(agent);

    if (drive === null) {
      if (!state.vessel.beached && isOnVesselTile(agent, state)) {
        outcomes.push(actionMaintainVessel(agent));
      } else {
        outcomes.push(actionRestAtSea(agent));
      }
      return;
    }

    switch (drive) {
      case 'hunger':
        outcomes.push(
          shouldEatNotDrink(agent, state)
            ? actionEatFromVessel(agent, state)
            : actionDrinkFromVessel(agent, state),
        );
        return;
      case 'fatigue':
        outcomes.push(actionRestAtSea(agent));
        return;
      case 'fear':
        outcomes.push(
          agent.traits.courage >= COURAGE_STAND_THRESHOLD
            ? actionStandGround(agent)
            : actionRestAtSea(agent),
        );
        return;
      case 'socialNeed':
      case 'longing':
        outcomes.push(actionInteractAtSea(agent, state));
        return;
      case 'grief':
        outcomes.push(actionRestAtSea(agent));
        return;
    }
  }

  if (shouldNobilityHelp(agent, state)) {
    outcomes.push(actionHelp(agent, state));
    return;
  }

  const drive = getDominantDrive(agent);
  let outcome: TickOutcome;

  if (drive === null) {
    outcome =
      agent.traits.curiosity >= CURIOSITY_EXPLORE_THRESHOLD
        ? actionExplore(agent, state)
        : actionWander(agent, state);
  } else {
    switch (drive) {
      case 'hunger': {
        if (!shouldEatNotDrink(agent, state)) {
          outcome = actionDrinkWater(agent, state);
          break;
        }
        const currentTile = getTile(state.tiles, agent.position.x, agent.position.y);
        const isCoast = currentTile?.terrain === Terrain.Coast;
        const foodThreshold = isCoast ? 0.4 : 0.15;
        const hasTileFood = currentTile !== undefined && currentTile.resources.food.current >= foodThreshold;
        if (hasTileFood) {
          outcome = actionHarvestFood(agent, state);
          break;
        }
        if (isOnOrNearRiver(agent, state)) {
          outcome = actionFish(agent, state);
          break;
        }
        if (isNearCoast(agent, state)) {
          outcome = actionHunt(agent, state);
          break;
        }
        outcome = actionHarvestFood(agent, state);
        break;
      }
      case 'fatigue':
        outcome = actionRest(agent);
        break;
      case 'fear':
        outcome =
          agent.traits.courage >= COURAGE_STAND_THRESHOLD
            ? actionStandGround(agent)
            : actionFlee(agent, state);
        break;
      case 'socialNeed':
        outcome = actionMoveTowardSocial(agent, state);
        break;
      case 'longing': {
        const target = findLongingTarget(agent, state);
        outcome = actionMoveTowardSocial(agent, state, target);
        break;
      }
      case 'grief':
        outcome = actionWander(agent, state);
        break;
      default:
        outcome = actionWander(agent, state);
        break;
    }
  }

  if (shouldConflict(agent, state)) {
    const target = pickRandomSameTileTarget(agent, state);
    if (target !== undefined) {
      outcomes.push(actionConflict(agent, target, state, outcomes));
      return;
    }
  }

  outcomes.push(outcome);
}
