// simulation/agents/births.ts
// Pair-bond reproduction — once per simulated day.

import type { Agent, Traits, WorldState } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { logBirthEvent } from '../events/log.js';
import { TICKS_PER_DAY } from './drives.js';
import { generateChildName } from './initializer.js';
import { manhattanDistance } from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

const BIRTH_CHANCE_PER_DAY = 0.10;
const BIRTH_LONGING_THRESHOLD = 0.45;
const BIRTH_PROXIMITY_RADIUS = 7;   // parents need to be together at camp (camp-scale), not the same tile
const BIRTH_MAX_HUNGER = 0.5;       // too hungry to bear/raise a child — a starving time halts births
const BIRTH_MAX_FEMALE_AGE = 45;
const BIRTH_MAX_MALE_AGE = 60;
const BIRTH_MIN_AGE = 16;
const TRAIT_MUTATION_RANGE = 0.08;
const MOTHER_GRIEF_SPIKE = 0.1;
const PARENT_LONGING_RESET = 0.1;
const CHILD_SKILL_BASE = 0.02;

const TRAIT_KEYS: Array<keyof Traits> = [
  'curiosity',
  'courage',
  'nobility',
  'cunning',
  'endurance',
  'attraction',
  'aggression',
  'acuity',
  'sociability', // children inherit a blend of their parents' sociability
];

// ============================================================
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pairKey(agentIdA: string, agentIdB: string): string {
  return agentIdA < agentIdB ? `${agentIdA}|${agentIdB}` : `${agentIdB}|${agentIdA}`;
}

function findAgent(state: WorldState, agentId: string): Agent | undefined {
  return state.agents.find((agent) => agent.id === agentId);
}

function addOccupant(
  state: WorldState,
  x: number,
  y: number,
  agentId: string,
): void {
  const tile = state.tiles.get(x, y);
  if (tile === undefined) return;
  if (!tile.occupants.includes(agentId)) {
    tile.occupants.push(agentId);
  }
}

function collectUniquePairs(state: WorldState): Array<[Agent, Agent]> {
  const seen = new Set<string>();
  const pairs: Array<[Agent, Agent]> = [];

  for (const agent of state.agents) {
    if (!agent.alive) continue;

    for (const relationship of agent.relationships) {
      if (relationship.bond !== BondType.Pair) continue;

      const other = findAgent(state, relationship.agentId);
      if (other === undefined || !other.alive) continue;

      const key = pairKey(agent.id, other.id);
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push([agent, other]);
    }
  }

  return pairs;
}

function resolveParents(
  agentA: Agent,
  agentB: Agent,
): { mother: Agent; father: Agent } | null {
  let mother: Agent | undefined;
  let father: Agent | undefined;

  if (agentA.gender === 'female') mother = agentA;
  else if (agentA.gender === 'male') father = agentA;

  if (agentB.gender === 'female') mother = agentB;
  else if (agentB.gender === 'male') father = agentB;

  if (mother === undefined || father === undefined) return null;
  return { mother, father };
}

function isEligiblePair(mother: Agent, father: Agent): boolean {
  if (
    mother.age < BIRTH_MIN_AGE ||
    mother.age > BIRTH_MAX_FEMALE_AGE ||
    father.age < BIRTH_MIN_AGE ||
    father.age > BIRTH_MAX_MALE_AGE
  ) {
    return false;
  }

  // Together at camp — near each other, not necessarily on the exact same tile
  // (the band is spread now, so "same tile" almost never happened).
  if (
    manhattanDistance(
      mother.position.x,
      mother.position.y,
      father.position.x,
      father.position.y,
    ) > BIRTH_PROXIMITY_RADIUS
  ) {
    return false;
  }

  // Both must desire a mate...
  if (
    mother.drives.longing < BIRTH_LONGING_THRESHOLD ||
    father.drives.longing < BIRTH_LONGING_THRESHOLD
  ) {
    return false;
  }

  // ...and be fed enough to bear and raise a child. The starving time stops
  // births; the stable, well-fed years are when the camp grows again.
  if (
    mother.drives.hunger > BIRTH_MAX_HUNGER ||
    father.drives.hunger > BIRTH_MAX_HUNGER
  ) {
    return false;
  }

  return true;
}

function blendTraits(mother: Agent, father: Agent, rng: () => number): Traits {
  const traits = {} as Traits;

  for (const key of TRAIT_KEYS) {
    const blended = (mother.traits[key] + father.traits[key]) / 2;
    const mutation = (rng() * 2 - 1) * TRAIT_MUTATION_RANGE;
    traits[key] = clamp01(blended + mutation);
  }

  return traits;
}

// ============================================================
// CHILD SPAWN
// ============================================================

function spawnChild(
  state: WorldState,
  mother: Agent,
  father: Agent,
  rng: () => number,
): Agent {
  const gender: Agent['gender'] = rng() < 0.5 ? 'male' : 'female';
  const { name, familyName } = generateChildName(
    mother.id,
    father.id,
    gender,
    state.agents,
    rng,
  );

  const child: Agent = {
    id: `agent_${state.agents.length}`,
    name,
    familyName,
    gender,
    age: 0,
    healthScore: 1.0,
    generation: Math.max(mother.generation, father.generation) + 1,
    alive: true,
    position: { x: mother.position.x, y: mother.position.y },
    home: { x: mother.home?.x ?? mother.position.x, y: mother.home?.y ?? mother.position.y },
    drives: {
      hunger: 0.4,
      fatigue: 0.3,
      fear: 0.05,
      socialNeed: 0.05,
      grief: 0.05,
      longing: 0.05,
    },
    traits: blendTraits(mother, father, rng),
    skills: {
      hunting: CHILD_SKILL_BASE,
      gathering: CHILD_SKILL_BASE,
      building: CHILD_SKILL_BASE,
      fire: CHILD_SKILL_BASE,
      healing: CHILD_SKILL_BASE,
    },
    inventory: { wood: 0, items: [] }, // born carrying nothing
    relationships: [],
    lineage: {
      motherId: mother.id,
      fatherId: father.id,
      children: [],
    },
    foundingHistory: null,
    conduitId: null,
    conduitBondType: null,
    currentAction: null,
    significanceScore: 0,
    chronicleThreadActive: false,
    chronicleChallenge: 0,
    chronicleFade: 0,
    lastChroniclePageMention: null,
    recentEvents: [],
    starvationTick: null,
    starvationSurvivalTicks: null,
    lastAteAtTick: null,
    lastDrankAtTick: null,
    discoveredTileIds: [],
    illnessState: null,
    animalAttackTick: null,
    lastViolenceTick: null,
    lastAttackerId: null,
  };

  state.agents.push(child);
  mother.lineage.children.push(child.id);
  father.lineage.children.push(child.id);
  addOccupant(state, mother.position.x, mother.position.y, child.id);

  mother.drives.grief = clamp01(mother.drives.grief + MOTHER_GRIEF_SPIKE);
  mother.drives.longing = PARENT_LONGING_RESET;
  father.drives.longing = PARENT_LONGING_RESET;

  logBirthEvent(state, child, mother.id, father.id);

  return child;
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function tickBirths(state: WorldState, rng: () => number): void {
  if (state.tick % TICKS_PER_DAY !== 0) return;

  for (const [agentA, agentB] of collectUniquePairs(state)) {
    const parents = resolveParents(agentA, agentB);
    if (parents === null) continue;

    const { mother, father } = parents;
    if (!isEligiblePair(mother, father)) continue;
    if (rng() >= BIRTH_CHANCE_PER_DAY) continue;

    spawnChild(state, mother, father, rng);
  }
}
