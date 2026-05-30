// simulation/tick.ts
// Main simulation loop — one tick orchestrates every subsystem.

import type { Agent, WorldState } from '@shared/types.js';
import { BondType, EventType, Season, Terrain } from '@shared/types.js';
import { tickBirths } from './agents/births.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR, tickAgentAge, tickAgentDrives } from './agents/drives.js';
import { executeAgentAction } from './agents/actions.js';
import { checkInfection, tickIllness } from './agents/illness.js';
import { initializeAgents } from './agents/initializer.js';
import { OutcomeType, type TickOutcome } from './agents/outcomes.js';
import { applyRelationshipOutcome } from './agents/relationships.js';
import {
  applyTraitOutcome,
  getTraitThresholdCrossings,
  snapshotTraits,
} from './agents/traits.js';
import { detectDeaths, getTopAgentsBySignificance, tickSignificance } from './agents/significance.js';
import { checkBondEligibility, createCompanion, tickCompanion } from './companions/being.js';
import {
  logDeathEvent,
  logEvent,
  logTraitThresholdEvent,
} from './events/log.js';
import { generateWorld } from './world/generator.js';
import { tickAllResources, tickSeason } from './world/resources.js';
import { isVesselZone, manhattanDistance } from './world/tiles.js';
import { tickVessel } from './world/vessel.js';

// ============================================================
// TYPES
// ============================================================

export interface TickSummary {
  tick: number;
  day: number;
  season: Season;
  aliveCount: number;
  deathsThisTick: string[];
  birthsThisTick: string[];
  landingOccurred: boolean;
  shouldCheckpoint: boolean;
  newChronicleThreads: string[];
}

// ============================================================
// CONSTANTS
// ============================================================

const CONSOLE_OUTPUT_INTERVAL = 10;
const CHECKPOINT_INTERVAL = 50;
const RESOURCE_CRISIS_FOOD_THRESHOLD = 0.08;
const NEAR_DEATH_GRIEF_RADIUS = 3;
const NEAR_DEATH_FEAR_SPIKE = 0.15;
const NEAR_DEATH_GRIEF_SPIKE = 0.04;
const BONDED_GRIEF_SPIKE = 0.5;
const THREAT_EVENT_WINDOW = 5;
const NOTABLE_EVENT_MIN_WEIGHT = 0.6;
const NOTABLE_EVENT_TICK_WINDOW = 10;

const TRAIT_KEYS = [
  'curiosity',
  'courage',
  'nobility',
  'cunning',
  'endurance',
  'attraction',
  'aggression',
  'acuity',
] as const;

// ============================================================
// WORLD ASSEMBLY
// ============================================================

export function createWorldState(seed: number, worldId: string): WorldState {
  const world = generateWorld(seed);
  const { agents, vessel } = initializeAgents(world, seed);
  const companion = createCompanion(world.companionStart, world.tiles);

  return {
    worldId,
    seed,
    tick: 0,
    day: 0,
    year: 1,
    season: world.startingSeason,
    ticksInCurrentSeason: 0,
    agents,
    tiles: world.tiles,
    companion,
    vessel,
    eventLog: [],
    chroniclePages: [],
    lastCheckpoint: new Date().toISOString(),
    lastChronicleGeneratedAt: null,
    lastSummaryGeneratedAt: null,
    latestSummary: null,
  };
}

// ============================================================
// LOCAL HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function findAgent(state: WorldState, agentId: string): Agent | undefined {
  return state.agents.find((agent) => agent.id === agentId);
}

function pairKey(agentIdA: string, agentIdB: string): string {
  return agentIdA < agentIdB ? `${agentIdA}|${agentIdB}` : `${agentIdB}|${agentIdA}`;
}

function aliveAgents(state: WorldState): Agent[] {
  return state.agents.filter((agent) => agent.alive);
}

function shuffleAgents(agents: Agent[], rng: () => number): Agent[] {
  const shuffled = [...agents];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    const swap = shuffled[j];
    if (tmp !== undefined && swap !== undefined) {
      shuffled[i] = swap;
      shuffled[j] = tmp;
    }
  }
  return shuffled;
}

function hasNearbyThreat(agent: Agent, state: WorldState): boolean {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (state.tick - event.tick > THREAT_EVENT_WINDOW) break;
    if (
      event.type === EventType.Conflict &&
      event.involvedAgents.includes(agent.id)
    ) {
      return true;
    }
  }
  return false;
}

function computeAverageTileFood(state: WorldState): number {
  let sum = 0;
  let count = 0;
  for (const tile of state.tiles.getDirtyTiles().values()) {
    if (tile.terrain === Terrain.Vessel || isVesselZone(tile.y)) continue;
    sum += tile.resources.food.current;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

function removeAgentFromTile(state: WorldState, agent: Agent): void {
  const tile = state.tiles.getIfCached(agent.position.x, agent.position.y);
  if (tile === undefined) return;
  tile.occupants = tile.occupants.filter((id) => id !== agent.id);
}

function applyDeathRipples(state: WorldState, deadAgent: Agent): void {
  for (const agent of aliveAgents(state)) {
    const distance = manhattanDistance(
      agent.position.x,
      agent.position.y,
      deadAgent.position.x,
      deadAgent.position.y,
    );

    if (distance <= NEAR_DEATH_GRIEF_RADIUS) {
      agent.drives.fear = clamp01(agent.drives.fear + NEAR_DEATH_FEAR_SPIKE);
      agent.drives.grief = clamp01(agent.drives.grief + NEAR_DEATH_GRIEF_SPIKE);
    }

    const pairBond = agent.relationships.find(
      (rel) => rel.agentId === deadAgent.id && rel.bond === BondType.Pair,
    );
    if (pairBond !== undefined) {
      agent.drives.grief = clamp01(agent.drives.grief + BONDED_GRIEF_SPIKE);
    }
  }
}

function highestTrait(agent: Agent): { name: string; value: number } {
  let name: (typeof TRAIT_KEYS)[number] = 'curiosity';
  let value = agent.traits[name];

  for (const key of TRAIT_KEYS) {
    if (agent.traits[key] > value) {
      name = key;
      value = agent.traits[key];
    }
  }

  return { name, value };
}

function agentConsoleNote(agent: Agent, state: WorldState): string {
  const recent = state.eventLog.filter(
    (event) =>
      event.involvedAgents.includes(agent.id) &&
      event.narrativeWeight >= NOTABLE_EVENT_MIN_WEIGHT &&
      state.tick - event.tick <= NOTABLE_EVENT_TICK_WINDOW,
  );
  const latest = recent[recent.length - 1];
  if (latest !== undefined) {
    return latest.description.slice(0, 60);
  }
  return `${agent.relationships.length} relationships`;
}

function printConsoleOutput(
  state: WorldState,
  deathsThisTick: string[],
): void {
  const seasonLabel = state.season.toUpperCase();
  console.log(`\n=== DAY ${state.day} | TICK ${state.tick} | ${seasonLabel} ===`);

  const aliveCount = aliveAgents(state).length;
  const deathNote =
    deathsThisTick.length > 0
      ? ` (${deathsThisTick.length} death${deathsThisTick.length === 1 ? '' : 's'})`
      : '';
  console.log(`Population: ${aliveCount}${deathNote}`);

  console.log('Top significance scores:');
  const topAgents = getTopAgentsBySignificance(state, 3);
  for (const agent of topAgents) {
    const role = agent.foundingHistory?.role ?? 'unknown';
    const trait = highestTrait(agent);
    const note = agentConsoleNote(agent, state);
    console.log(
      `  ${agent.name} [${role}] — ${agent.significanceScore.toFixed(2)} (${trait.name} ${trait.value.toFixed(2)}, ${note})`,
    );
  }

  const notable = state.eventLog.filter(
    (event) =>
      event.narrativeWeight >= NOTABLE_EVENT_MIN_WEIGHT &&
      state.tick - event.tick <= NOTABLE_EVENT_TICK_WINDOW,
  );
  const lastNotable = notable.slice(-3);

  console.log('Notable events:');
  if (lastNotable.length === 0) {
    console.log('  (none)');
  } else {
    for (const event of lastNotable) {
      console.log(`  [T${event.tick}] ${event.description}`);
    }
  }
}

// ============================================================
// MAIN TICK
// ============================================================

export function tick(state: WorldState, rng: () => number): TickSummary {
  const deathsThisTick: string[] = [];
  let birthsThisTick: string[] = [];
  const newChronicleThreads: string[] = [];

  const landingEvent = tickVessel(state);
  const landingOccurred = landingEvent !== null;

  const outcomesByAgent = new Map<string, TickOutcome[]>();

  for (const agent of aliveAgents(state)) {
    const nearbyThreat = hasNearbyThreat(agent, state);
    tickAgentDrives(agent, state, nearbyThreat);
  }

  for (const agent of shuffleAgents(aliveAgents(state), rng)) {
    const agentOutcomes: TickOutcome[] = [];
    executeAgentAction(agent, state, agentOutcomes);
    outcomesByAgent.set(agent.id, agentOutcomes);
  }

  for (const [agentId, agentOutcomes] of outcomesByAgent) {
    const agent = findAgent(state, agentId);
    if (agent === undefined) continue;

    const before = snapshotTraits(agent);
    for (const outcome of agentOutcomes) {
      applyTraitOutcome(agent, outcome);
      if (outcome.involvedAgentId !== null) {
        const other = findAgent(state, outcome.involvedAgentId);
        if (other !== undefined) {
          applyRelationshipOutcome(agent, other, outcome, state.tick);
        }
      }
    }

    const crossings = getTraitThresholdCrossings(agent.id, before, agent.traits);
    for (const crossing of crossings) {
      logTraitThresholdEvent(state, agent, crossing.trait, crossing.level);
    }
  }

  const loggedConflictPairs = new Set<string>();
  for (const [agentId, agentOutcomes] of outcomesByAgent) {
    const agent = findAgent(state, agentId);
    if (agent === undefined) continue;

    for (const outcome of agentOutcomes) {
      if (outcome.type !== OutcomeType.Conflicted) continue;
      if (outcome.involvedAgentId === null) continue;

      const otherAgent = findAgent(state, outcome.involvedAgentId);
      if (otherAgent === undefined) continue;

      const key = pairKey(agent.id, otherAgent.id);
      if (loggedConflictPairs.has(key)) continue;
      loggedConflictPairs.add(key);

      logEvent(
        state,
        EventType.Conflict,
        [agent.id, otherAgent.id],
        { x: agent.position.x, y: agent.position.y },
        `${agent.name} ${agent.familyName} came into conflict with ${otherAgent.name} ${otherAgent.familyName}.`,
        [agent.familyName, otherAgent.familyName],
      );
    }
  }

  for (const agent of aliveAgents(state)) {
    const newlyInfected = checkInfection(agent, state);
    if (newlyInfected) {
      logEvent(
        state,
        EventType.IllnessBegan,
        [agent.id],
        { x: agent.position.x, y: agent.position.y },
        `${agent.name} ${agent.familyName} fell ill.`,
        [agent.familyName],
      );
    }

    const recovered = tickIllness(agent, state);
    if (recovered) {
      logEvent(
        state,
        EventType.IllnessRecovered,
        [agent.id],
        { x: agent.position.x, y: agent.position.y },
        `${agent.name} ${agent.familyName} recovered from illness.`,
        [agent.familyName],
      );
    }
  }

  const deaths = detectDeaths(state);
  for (const death of deaths) {
    const agent = findAgent(state, death.agentId);
    if (agent === undefined || !agent.alive) continue;

    agent.alive = false;
    removeAgentFromTile(state, agent);
    logDeathEvent(state, agent, death.cause);
    applyDeathRipples(state, agent);
    deathsThisTick.push(death.agentId);
  }

  if (state.tick > 0 && state.tick % TICKS_PER_YEAR === 0) {
    for (const agent of state.agents) {
      if (!agent.alive) continue;
      tickAgentAge(agent, state.tick);
    }
  }

  const agentCountBeforeBirths = state.agents.length;
  tickBirths(state, rng);
  birthsThisTick = state.agents
    .slice(agentCountBeforeBirths)
    .map((agent) => agent.id);

  tickCompanion(state);

  const bondCandidate = checkBondEligibility(state.companion, state);
  if (bondCandidate !== null) {
    const candidateAgent = findAgent(state, bondCandidate);
    if (candidateAgent !== undefined) {
      logEvent(
        state,
        EventType.CompanionApproach,
        [bondCandidate],
        {
          x: state.companion.position.x,
          y: state.companion.position.y,
        },
        `${candidateAgent.name} ${candidateAgent.familyName} and the companion being have grown close.`,
        [candidateAgent.familyName],
        0.65,
      );
    }
  }

  const chronicleBefore = new Set(
    state.agents
      .filter((agent) => agent.chronicleThreadActive)
      .map((agent) => agent.id),
  );
  tickSignificance(state);
  for (const agent of state.agents) {
    if (agent.chronicleThreadActive && !chronicleBefore.has(agent.id)) {
      newChronicleThreads.push(agent.id);
    }
  }

  tickAllResources(state.tiles, state.season);
  tickSeason(state);

  if (state.tick % TICKS_PER_DAY === 0) {
    const avgFood = computeAverageTileFood(state);
    if (avgFood < RESOURCE_CRISIS_FOOD_THRESHOLD) {
      logEvent(
        state,
        EventType.ResourceCrisis,
        [],
        { x: 0, y: 0 },
        'Food resources across the land have fallen critically low.',
        [],
      );
    }
  }

  state.tick += 1;
  if (state.tick % TICKS_PER_DAY === 0) {
    state.day += 1;
  }

  const shouldCheckpoint = state.tick % CHECKPOINT_INTERVAL === 0;
  if (shouldCheckpoint) {
    state.lastCheckpoint = new Date().toISOString();
  }

  if (state.tick % CONSOLE_OUTPUT_INTERVAL === 0) {
    printConsoleOutput(state, deathsThisTick);
  }

  return {
    tick: state.tick,
    day: state.day,
    season: state.season,
    aliveCount: aliveAgents(state).length,
    deathsThisTick,
    birthsThisTick,
    landingOccurred,
    shouldCheckpoint,
    newChronicleThreads,
  };
}
