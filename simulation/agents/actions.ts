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
  findBestWaterTile,
  getAdjacentTiles,
  getTile,
  getTilesInRange,
  isPassable,
  isVesselZone,
  manhattanDistance,
  markTileDirty,
  stepToward,
} from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

const DRIVE_THRESHOLD = 0.2;

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
// Hunting draws down a local prey population (the herd breeds back over time).
const HUNT_GAME_TAKE = 0.15;    // game removed from the tile per successful kill
const HUNT_CROWDING_K = 0.2;    // success penalty per extra hunter sharing the patch

const FISH_SUCCESS_BASE = 0.35;
const FISH_SKILL_BONUS = 0.35;
const FISH_FOOD_RESTORE = 0.2;
const FISH_COST_FATIGUE = 0.04;
// Fishing draws on aquatic forage, represented by the river/coast tile's food stock.
const FISH_STOCK_TAKE = 0.1;    // food removed from the tile per successful catch
const FISH_CROWDING_K = 0.2;    // success penalty per extra fisher on the same spot
const FISH_RESIDUAL = 0.06;     // meagre shellfish baseline (lowered so the shore alone can't feed the whole band)

// Foraging is decided per-agent from LOCAL information — no global best-tile
// oracle. Perception is short (agents reason about nearby ground only); the
// distance and crowding discounts make them prefer near, uncontested patches;
// satisficing lets them settle rather than chase the global maximum. Combined
// with skill weighting, this fans the band out by vocation instead of herding.
const FORAGE_PERCEPTION_RADIUS = 6;
const FORAGE_DIST_WEIGHT = 0.12;   // expected-yield discount per tile of travel
const FORAGE_CROWD_WEIGHT = 0.5;   // expected-yield discount per other forager already on the tile
const FORAGE_SATISFICE_FRAC = 0.7; // work here if it scores >= this fraction of the best patch in view
const FORAGE_MIN_VIABLE = 0.04;    // below this expected yield, wander for fresher ground
const FORAGE_HUNGER_REACH = 10;    // extra perception tiles at max hunger (desperation widens the search)
const FORAGE_DESPERATION = 0.7;    // how much hunger softens the travel-distance penalty (0..1)

// Foraging cohesion: agents prefer to work the ground around their camp (home)
// and return to it, so the band settles rather than strip-mining outward. The
// pull is scaled by sociability — gregarious agents cling to camp, loners barely
// heed it and roam. The camp itself drifts toward where they actually forage, so
// it follows sustained effort: settle, work the land, move on when it's spent.
const COHESION_STRENGTH = 0.6;     // max score bonus for foraging at home (at sociability 1.0)
const COHESION_FALLOFF = 0.12;     // how quickly the home bonus decays with distance from camp
const HOME_DRIFT = 0.015;          // fraction of the gap the camp closes toward a worked patch each tick
const MATE_HOME_PULL = 0.06;       // mates share a hearth — their camps ease toward each other each forage
// Leash: agents work the ground within this radius of camp and only break past
// it when the local ground is genuinely spent. Loners get a far longer leash —
// they barely heed camp and roam. Beyond the leash, a tile's appeal falls off
// fast, so only real local exhaustion (nothing good in reach) sends them out.
const HOME_LEASH_BASE = 6;         // worked radius for a fully gregarious agent
const HOME_LEASH_ROAM = 30;        // extra leash a pure loner gets (× (1 - sociability))
const LEASH_PENALTY = 0.5;         // how hard appeal drops per tile beyond the leash

// Survival drives outrank social/emotional ones once they cross this urgency.
const SURVIVAL_DRIVES: Array<keyof Drives> = ['hunger', 'fatigue', 'fear'];
const SURVIVAL_PRIORITY_THRESHOLD = 0.35;

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

  // Survival before sentiment: when a survival drive (hunger/fatigue/fear) is
  // genuinely pressing, it outranks the social/emotional drives regardless of
  // their raw magnitude — so nobody starves while wandering off to find company.
  const survivalPressing = aboveThreshold.filter(
    (key) =>
      SURVIVAL_DRIVES.includes(key) &&
      agent.drives[key] >= SURVIVAL_PRIORITY_THRESHOLD,
  );
  const pool = survivalPressing.length > 0 ? survivalPressing : aboveThreshold;

  let maxValue = 0;
  for (const key of pool) {
    maxValue = Math.max(maxValue, agent.drives[key]);
  }

  const tied = pool.filter((key) => agent.drives[key] >= maxValue - 0.01);

  if (tied.length === 1) {
    return tied[0] ?? null;
  }

  return resolveDriveTie(agent, tied);
}

function markDiscovered(agent: Agent, x: number, y: number): boolean {
  const id = tileId(x, y);
  if (!agent.discoveredTileIds) agent.discoveredTileIds = [];
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
    markTileDirty(state.tiles, tile.x, tile.y); // depleted patch now regenerates
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

  // Nothing worth gathering on this tile. Where to range next is the forage
  // chooser's job now — no global best-tile hunt here.
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
    markTileDirty(state.tiles, tile.x, tile.y); // depleted patch now regenerates
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
  ).filter((tile) => isPassable(tile.terrain, state.vessel.beached) && !isVesselZone(tile.y));

  if (!agent.discoveredTileIds) agent.discoveredTileIds = [];
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

  if (!agent.discoveredTileIds) agent.discoveredTileIds = [];
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
  ).filter((tile) => isPassable(tile.terrain, state.vessel.beached) && !isVesselZone(tile.y));

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
    ).filter((tile) => isPassable(tile.terrain, state.vessel.beached) && !isVesselZone(tile.y));
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

// ── Foraging: each agent decides for itself ─────────────────────────────────
// There is no global best-tile oracle. An agent weighs only the ground it can
// see, by what ITS OWN skills can wring from each patch, discounted by travel
// and by how many foragers already crowd it. Heterogeneous skills + local
// competition make the band fan out by vocation — hunters to the game, gatherers
// to the plant ground, fisherfolk to the water — instead of all chasing one tile.

type ForageMode = 'hunt' | 'gather' | 'fish';

// Water is fished; dry land is hunted or gathered.
function forageModesFor(tile: WorldTile): ForageMode[] {
  if (tile.terrain === Terrain.Coast || tile.terrain === Terrain.River) {
    return ['fish'];
  }
  return ['hunt', 'gather'];
}

// Expected yield of working `tile` in `mode`, as THIS agent sees it: own skill
// × resource present × season, discounted by distance and by other foragers
// already on the tile (interference / competition).
function forageScore(
  agent: Agent,
  state: WorldState,
  tile: WorldTile,
  mode: ForageMode,
  fromX: number,
  fromY: number,
): number {
  let skillResource: number;
  if (mode === 'hunt') {
    const seasonMod = SEASON_HUNT_MODIFIERS[state.season] ?? 1.0;
    skillResource = (0.5 + agent.skills.hunting) * tile.resources.game.current * seasonMod;
  } else if (mode === 'fish') {
    const seasonMod = SEASON_FISH_MODIFIERS[state.season] ?? 1.0;
    skillResource = (0.5 + agent.skills.gathering) * tile.resources.food.current * seasonMod;
  } else {
    skillResource = (0.5 + agent.skills.gathering) * tile.resources.food.current;
  }

  const dist = manhattanDistance(fromX, fromY, tile.x, tile.y);
  // Don't count the agent itself when scoring the tile it already stands on.
  const others = Math.max(0, tile.occupants.length - (dist === 0 ? 1 : 0));
  // Desperation: the hungrier an agent is, the less it minds travelling, so a
  // rich-but-distant patch (e.g. forest) starts to beat a tapped-out near one.
  const distWeight = FORAGE_DIST_WEIGHT * (1 - FORAGE_DESPERATION * agent.drives.hunger);
  return (
    skillResource /
    ((1 + distWeight * dist) * (1 + FORAGE_CROWD_WEIGHT * others))
  );
}

function bestForageModeForTile(
  agent: Agent,
  state: WorldState,
  tile: WorldTile,
  fromX: number,
  fromY: number,
): { mode: ForageMode; score: number } {
  let best: { mode: ForageMode; score: number } = { mode: 'gather', score: -1 };
  for (const mode of forageModesFor(tile)) {
    const score = forageScore(agent, state, tile, mode, fromX, fromY);
    if (score > best.score) best = { mode, score };
  }
  return best;
}

function forageOutcomeType(mode: ForageMode): OutcomeType {
  if (mode === 'hunt') return OutcomeType.Hunted;
  if (mode === 'fish') return OutcomeType.Fished;
  return OutcomeType.Harvested;
}

function workForage(agent: Agent, state: WorldState, mode: ForageMode): TickOutcome {
  driftHome(agent, state); // the camp eases toward wherever they're working (and toward a mate's hearth)
  if (mode === 'hunt') return actionHunt(agent, state);
  if (mode === 'fish') return actionFish(agent, state);
  return actionHarvestFood(agent, state);
}

// The agent's camp. Lazily backfilled for agents restored from a checkpoint
// written before homes existed (they adopt where they currently stand).
function getHome(agent: Agent): { x: number; y: number } {
  const existing = agent.home as { x: number; y: number } | undefined;
  if (existing !== undefined) return existing;
  agent.home = { x: agent.position.x, y: agent.position.y };
  return agent.home;
}

// The pair-bonded partner an agent shares a hearth with (highest-trust Pair
// bond), or null if unpartnered.
function findMate(agent: Agent, state: WorldState): Agent | undefined {
  let mate: Agent | undefined;
  let bestTrust = -Infinity;
  for (const rel of agent.relationships) {
    if (rel.bond !== BondType.Pair) continue;
    if (rel.trust <= bestTrust) continue;
    const other = state.agents.find((a) => a.id === rel.agentId && a.alive);
    if (other !== undefined) {
      mate = other;
      bestTrust = rel.trust;
    }
  }
  return mate;
}

// The camp follows sustained foraging: each time an agent works a patch, its
// home eases a little toward that spot. When the ground around camp is rich they
// forage at home and it barely moves; when it's spent they work farther out and
// the camp migrates after them — settle, deplete, move on. Mates also ease their
// hearths toward each other, so a bonded couple keeps one camp and can raise a
// family rather than drifting apart.
function driftHome(agent: Agent, state: WorldState): void {
  const home = getHome(agent);
  home.x += HOME_DRIFT * (agent.position.x - home.x);
  home.y += HOME_DRIFT * (agent.position.y - home.y);

  const mate = findMate(agent, state);
  if (mate !== undefined) {
    const mateHome = getHome(mate);
    home.x += MATE_HOME_PULL * (mateHome.x - home.x);
    home.y += MATE_HOME_PULL * (mateHome.y - home.y);
  }
}

// How appealing it is to forage tile (tx,ty) given the agent's camp: a bonus for
// being near home (scaled by sociability), and a sharp penalty for straying past
// the leash. So agents work the radius around camp and only range out when the
// near ground is spent. A loner has a huge leash and a tiny bonus — they roam.
function homePullFactor(
  tx: number,
  ty: number,
  home: { x: number; y: number },
  sociability: number,
  leash: number,
): number {
  const d = manhattanDistance(tx, ty, home.x, home.y);
  const bonus = 1 + (sociability * COHESION_STRENGTH) / (1 + COHESION_FALLOFF * d);
  if (d <= leash) return bonus;
  return bonus / (1 + LEASH_PENALTY * (d - leash));
}

// Pick how and where to forage from the agent's own vantage, then either work
// the current spot or take one step toward the best patch it can see.
function chooseForage(agent: Agent, state: WorldState): TickOutcome {
  const fx = agent.position.x;
  const fy = agent.position.y;

  // A hungry agent looks further afield for food (desperation widens the search).
  const reach = FORAGE_PERCEPTION_RADIUS + Math.round(agent.drives.hunger * FORAGE_HUNGER_REACH);
  const candidates = getTilesInRange(state.tiles, fx, fy, reach);
  const here = getTile(state.tiles, fx, fy);
  if (here !== undefined) candidates.push(here);

  // Gregarious agents bias toward ground near their camp (so camps hold together
  // instead of strip-mining outward); loners ignore it. `raw` is the food yield
  // (used for the viability floor); `adj` adds the home pull and is what the
  // agent actually optimises.
  const home = getHome(agent);
  const sociability = agent.traits.sociability;
  const leash = HOME_LEASH_BASE + (1 - sociability) * HOME_LEASH_ROAM;

  let best: { tile: WorldTile; mode: ForageMode; raw: number; adj: number } | undefined;
  let hereChoice: { mode: ForageMode; raw: number; adj: number } | undefined;
  for (const tile of candidates) {
    if (!isPassable(tile.terrain, state.vessel.beached)) continue;
    // The open sea south of the coast is generated as "plain" but is NOT land —
    // never forage into the vessel zone or agents wander offshore and strand.
    if (isVesselZone(tile.y)) continue;
    const bm = bestForageModeForTile(agent, state, tile, fx, fy);
    const adj = bm.score * homePullFactor(tile.x, tile.y, home, sociability, leash);
    if (best === undefined || adj > best.adj) {
      best = { tile, mode: bm.mode, raw: bm.score, adj };
    }
    if (tile.x === fx && tile.y === fy) hereChoice = { mode: bm.mode, raw: bm.score, adj };
  }

  // Nothing actually worth eating within sight — wander to find fresher ground.
  // (Viability is judged on raw food yield, never on the cohesion bonus.)
  if (best === undefined || best.raw < FORAGE_MIN_VIABLE) {
    return actionWander(agent, state);
  }

  // Satisfice on the cohesion-adjusted score, but only settle on a tile that is
  // genuinely worth working. Keeps foragers near camp and lets different
  // starting points settle on different patches instead of converging on one.
  if (
    hereChoice !== undefined &&
    hereChoice.raw >= FORAGE_MIN_VIABLE &&
    hereChoice.adj >= FORAGE_SATISFICE_FRAC * best.adj
  ) {
    return workForage(agent, state, hereChoice.mode);
  }

  if (best.tile.x === fx && best.tile.y === fy) {
    return workForage(agent, state, best.mode);
  }

  stepAgentToward(agent, best.tile.x, best.tile.y, state);
  return makeOutcome(agent, { type: forageOutcomeType(best.mode), success: false, partial: true });
}

function actionHunt(agent: Agent, state: WorldState): TickOutcome {
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  const localGame = tile?.resources.game.current ?? 0;

  // Many hunters working one patch interfere with each other and spook the game,
  // so per-capita success falls as the tile gets crowded.
  const coHunters = tile?.occupants.length ?? 1;
  const crowdingPenalty = 1 / (1 + HUNT_CROWDING_K * Math.max(0, coHunters - 1));

  // Success scales with how much game is actually present.
  const seasonMod = SEASON_HUNT_MODIFIERS[state.season] ?? 1.0;
  const gameFactor = clamp01(localGame);
  const successChance =
    (HUNT_SUCCESS_BASE + agent.skills.hunting * HUNT_SKILL_BONUS) *
    seasonMod *
    gameFactor *
    crowdingPenalty;
  const fatigued = fatigueModifier(agent.drives.fatigue);
  const success = Math.random() < successChance * fatigued * illnessSkillMultiplier(agent);

  agent.drives.fatigue = clamp01(agent.drives.fatigue + HUNT_COST_FATIGUE);

  if (success) {
    // A kill removes animals from the local population; the tile is marked dirty
    // so it regenerates (the herd breeds back) over the coming ticks.
    if (tile !== undefined) {
      tile.resources.game.current = Math.max(0, tile.resources.game.current - HUNT_GAME_TAKE);
      markTileDirty(state.tiles, tile.x, tile.y);
    }
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
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  // Aquatic forage (fish, shellfish) is drawn from the river/coast tile's food
  // stock — fishing depletes it just as hunting depletes game.
  const localStock = tile?.resources.food.current ?? 0;

  const coFishers = tile?.occupants.length ?? 1;
  const crowdingPenalty = 1 / (1 + FISH_CROWDING_K * Math.max(0, coFishers - 1));
  const seasonMod = SEASON_FISH_MODIFIERS[state.season] ?? 1.0;
  const stockFactor = clamp01(localStock + FISH_RESIDUAL);
  const successChance =
    (FISH_SUCCESS_BASE + agent.skills.gathering * FISH_SKILL_BONUS) *
    seasonMod *
    stockFactor *
    crowdingPenalty;
  const fatigued = fatigueModifier(agent.drives.fatigue);
  const success = Math.random() < successChance * fatigued * illnessSkillMultiplier(agent);

  agent.drives.fatigue = clamp01(agent.drives.fatigue + FISH_COST_FATIGUE);

  if (success) {
    if (tile !== undefined) {
      tile.resources.food.current = Math.max(0, tile.resources.food.current - FISH_STOCK_TAKE);
      markTileDirty(state.tiles, tile.x, tile.y);
    }
    agent.drives.hunger = clamp01(agent.drives.hunger - FISH_FOOD_RESTORE);
    agent.lastAteAtTick = state.tick;
  }

  return makeOutcome(agent, {
    type: OutcomeType.Fished,
    success,
    amountGained: success ? FISH_FOOD_RESTORE : 0,
  });
}

// ============================================================
// ACTION DESCRIPTION
// Translates an outcome into plain English for the frontend detail panel.
// Called once per tick per agent after the outcome is determined.
// ============================================================

function describeOutcome(outcome: TickOutcome, agent: Agent): string {
  switch (outcome.type) {
    case OutcomeType.Harvested:
      if (outcome.success) return 'Gathering food';
      if (outcome.partial) return 'Searching for food';
      return 'Finding no food nearby';

    case OutcomeType.FoundResource:
      return 'Gathering food — found rich ground';

    case OutcomeType.Hunted:
      return outcome.success ? 'Hunting' : 'Hunting — came back empty-handed';

    case OutcomeType.Fished:
      return outcome.success ? 'Fishing' : 'Fishing — nothing yet';

    case OutcomeType.DrankWater:
      if (outcome.success) return 'Drinking water';
      if (outcome.partial) return 'Moving toward water';
      return 'Finding no water nearby';

    case OutcomeType.AteSomething:
      return outcome.success
        ? 'Eating from the vessel stores'
        : 'Enduring hunger — nothing left in the stores';

    case OutcomeType.Rested:
      return 'Resting';

    case OutcomeType.Wandered:
      return agent.drives.grief > 0.6 ? 'Moving without direction' : 'Wandering';

    case OutcomeType.Explored:
      return 'Exploring unfamiliar ground';

    case OutcomeType.FoundRuin:
      return 'Exploring — standing in the ruins';

    case OutcomeType.FoundArtifact:
      return 'Exploring — found something old';

    case OutcomeType.Fled:
      return 'Fleeing';

    case OutcomeType.StoodGround:
      return 'Holding ground despite fear';

    case OutcomeType.Interacted:
      return outcome.success ? 'Talking with someone' : 'Looking for someone to talk to';

    case OutcomeType.Helped:
      if (outcome.success) return 'Helping someone in distress';
      if (outcome.partial) return 'Moving toward someone who needs help';
      return 'Finding no one who needs help';

    case OutcomeType.Conflicted:
      return 'In conflict';

    case OutcomeType.ConflictResolved:
      return 'In conflict';

    case OutcomeType.Maintained:
      return 'Working on the vessel';

    case OutcomeType.Steered:
      return 'Steering the vessel';

    default:
      return 'Acting';
  }
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

  // After landfall nobody belongs on the water. Any agent that ends up in the
  // sea zone — stranded from an old checkpoint, or having wandered/fled offshore
  // — wades back to the coast instead of resting at sea forever.
  if (atSea && state.vessel.beached) {
    const home = getHome(agent);
    if (isVesselZone(home.y)) home.y = COAST_ROW - 1; // a sea-set home must not pull them back out
    // Wade to the nearest passable land, routing around the beached hull (the
    // tile due north can be the impassable Vessel structure). Prefer landward
    // steps (north), then around to the sides.
    const fx = agent.position.x;
    const fy = agent.position.y;
    for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]] as const) {
      const nt = getTile(state.tiles, fx + dx, fy + dy);
      if (nt !== undefined && isPassable(nt.terrain, state.vessel.beached)) {
        moveAgent(agent, fx + dx, fy + dy, state);
        break;
      }
    }
    const o = makeOutcome(agent, { type: OutcomeType.Wandered, success: true });
    outcomes.push(o);
    agent.currentAction = 'Wading back to shore';
    return;
  }

  if (atSea) {
    const steerer = findSteerer(state);
    if (steerer?.id === agent.id && isOnOrAdjacentToVessel(agent, state)) {
      const o = actionSteer(agent);
      outcomes.push(o);
      agent.currentAction = describeOutcome(o, agent);
      return;
    }

    const drive = getDominantDrive(agent);

    if (drive === null) {
      const o = (!state.vessel.beached && isOnVesselTile(agent, state))
        ? actionMaintainVessel(agent)
        : actionRestAtSea(agent);
      outcomes.push(o);
      agent.currentAction = describeOutcome(o, agent);
      return;
    }

    let seaOutcome: TickOutcome;
    switch (drive) {
      case 'hunger':
        if (shouldEatNotDrink(agent, state)) {
          seaOutcome = actionEatFromVessel(agent, state);
          if (!seaOutcome.success) {
            seaOutcome = actionDrinkFromVessel(agent, state);
            if (!seaOutcome.success) {
              seaOutcome = actionRestAtSea(agent);
            }
          }
        } else {
          seaOutcome = actionDrinkFromVessel(agent, state);
          if (!seaOutcome.success) {
            seaOutcome = actionRestAtSea(agent);
          }
        }
        break;
      case 'fatigue':
        seaOutcome = actionRestAtSea(agent);
        break;
      case 'fear':
        seaOutcome = agent.traits.courage >= COURAGE_STAND_THRESHOLD
          ? actionStandGround(agent)
          : actionRestAtSea(agent);
        break;
      case 'socialNeed':
      case 'longing':
        seaOutcome = actionInteractAtSea(agent, state);
        break;
      case 'grief':
        seaOutcome = actionRestAtSea(agent);
        break;
      default:
        seaOutcome = actionRestAtSea(agent);
        break;
    }
    outcomes.push(seaOutcome);
    agent.currentAction = describeOutcome(seaOutcome, agent);
    return;
  }

  if (shouldNobilityHelp(agent, state)) {
    const o = actionHelp(agent, state);
    outcomes.push(o);
    agent.currentAction = describeOutcome(o, agent);
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
        // One routine scores fishing/hunting/gathering on nearby ground by this
        // agent's own skills and picks where to work or step — no global best-
        // tile oracle, so the band fans out by vocation instead of all fishing.
        outcome = chooseForage(agent, state);
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
      const conflictOutcome = actionConflict(agent, target, state, outcomes);
      outcomes.push(conflictOutcome);
      agent.currentAction = describeOutcome(conflictOutcome, agent);
      return;
    }
  }

  outcomes.push(outcome);
  agent.currentAction = describeOutcome(outcome, agent);
}
