// simulation/agents/initializer.ts
// Spawns the founding 50 agents on the vessel and creates initial VesselState.
// Called once at world start.

import seedrandom from 'seedrandom';
import type {
  Agent,
  Drives,
  FoundingHistory,
  Resource,
  Skills,
  Traits,
  VesselState,
} from '@shared/types.js';
import { BondType, FoundingRole } from '@shared/types.js';
import type { GeneratedWorld } from '../world/generator.js';
import { createRelationship, getRelationship } from './relationships.js';
import { createStartingVesselItems } from '../world/vessel.js';

// ============================================================
// NAME LISTS
// ============================================================

const FOUNDING_MALE_NAMES = [
  'Drev', 'Cael', 'Bren', 'Mors', 'Tack', 'Harven', 'Kael', 'Wulf', 'Sorn', 'Dagan',
  'Fen', 'Roth', 'Brael', 'Tavic', 'Gurn', 'Aldric', 'Jorvath', 'Cress', 'Balt', 'Harric',
  'Stenn', 'Duvall', 'Keth', 'Rovan', 'Wace', 'Theron', 'Aldun', 'Moric', 'Sable', 'Crenn',
  'Fael', 'Dorn', 'Harwick', 'Vael', 'Maren',
] as const;

const FOUNDING_FEMALE_NAMES = [
  'Sela', 'Brix', 'Aldra', 'Veth', 'Corra', 'Neva', 'Thea', 'Wren', 'Sora', 'Bael',
  'Dara', 'Ovra', 'Lira', 'Fen', 'Maren',
] as const;

const NEXT_GEN_MALE_NAMES = [
  'Aldren', 'Bael', 'Casten', 'Davan', 'Erwick', 'Fenrath', 'Garven', 'Hael', 'Iorn', 'Jethwick',
  'Kalder', 'Lorven', 'Maevik', 'Norrath', 'Orveth', 'Praen', 'Quelven', 'Ravick', 'Sorath', 'Taven',
  'Urvane', 'Valdric', 'Wreth', 'Xaven', 'Yorne', 'Zaevic', 'Broven', 'Caeldric', 'Daveth', 'Elmwick',
] as const;

const NEXT_GEN_FEMALE_NAMES = [
  'Aldris', 'Braela', 'Caelith', 'Davreth', 'Elwren', 'Fenra', 'Gaelith', 'Hevra', 'Iorna', 'Jaeveth',
  'Kaela', 'Lorveth', 'Maevra', 'Norra', 'Orveth', 'Praela', 'Quelra', 'Raveth', 'Sorveth', 'Taevra',
] as const;

const FAMILY_NAMES = [
  'Ashvane', 'Durnwall', 'Correth', 'Mervak', 'Stonefall', 'Halveth', 'Torcren', 'Aldmere',
  'Brenvast', 'Worvane', 'Caelder', 'Duskwall', 'Fennick', 'Halcrow', 'Ironveth',
] as const;

// ============================================================
// ROLE & POPULATION CONSTANTS
//
// Grouped into one exported, mutable object so the wind-tunnel harness
// (simulation/harness/) can override TOTAL_AGENTS before a run — same
// pattern as RELATIONSHIP_CONSTANTS/CONDUIT_CONSTANTS/CONFLICT_CONSTANTS/
// ILLNESS_CONSTANTS/PREDATOR_CONSTANTS. Gender and role counts are derived
// from TOTAL_AGENTS × ratio at generation time (see getMaleCount/
// getRoleCounts below) rather than hardcoded, so they always sum exactly
// to TOTAL_AGENTS at any population size — the ratios reproduce today's
// exact 35/15 gender split and 12/28/2/8 role split at the default
// TOTAL_AGENTS=50 (see the determinism check in the commit that introduced
// this object). NEARLY_DIED_COUNT/MIN_NEARLY_DIED_OUTCASTS/
// ELEVATED_PAIR_COUNT stay absolute (founding-story flavor counts, not
// population-proportional — a bigger village doesn't need proportionally
// more crossing casualties or shipboard romances).
// ============================================================

export const POPULATION_CONSTANTS = {
  TOTAL_AGENTS: 50,
  MALE_RATIO: 0.7,
  EXPLORER_RATIO: 0.24,
  LEADER_RATIO: 0.04,
  SURVIVOR_RATIO: 0.16,
  // Outcast is the implicit remainder: TOTAL_AGENTS - explorer - leader - survivor.
  NEARLY_DIED_COUNT: 6,
  MIN_NEARLY_DIED_OUTCASTS: 3,
  ELEVATED_PAIR_COUNT: 7,
};

function getMaleCount(): number {
  return Math.round(POPULATION_CONSTANTS.TOTAL_AGENTS * POPULATION_CONSTANTS.MALE_RATIO);
}

function getFemaleCount(): number {
  return POPULATION_CONSTANTS.TOTAL_AGENTS - getMaleCount();
}

function getRoleCounts(): Record<FoundingRole, number> {
  const total = POPULATION_CONSTANTS.TOTAL_AGENTS;
  const explorer = Math.round(total * POPULATION_CONSTANTS.EXPLORER_RATIO);
  const leader = Math.round(total * POPULATION_CONSTANTS.LEADER_RATIO);
  const survivor = Math.round(total * POPULATION_CONSTANTS.SURVIVOR_RATIO);
  const outcast = total - explorer - leader - survivor;
  return {
    [FoundingRole.Explorer]: explorer,
    [FoundingRole.Outcast]: outcast,
    [FoundingRole.Leader]: leader,
    [FoundingRole.Survivor]: survivor,
  };
}

const TRAIT_BASE = 0.4;
const TRAIT_VARIATION = 0.15;

// Sociability is generated separately from the other traits, with a social-
// skewed distribution: most agents want company, loners are a minority, true
// hermits rarer still. (1 - r^skew: higher skew → fewer loners.)
const SOCIABILITY_SKEW = 2.5;
const SOCIABILITY_LEADER_BONUS = 0.15;       // leaders bind the group
const SOCIABILITY_SOLITARY_ROLE_PENALTY = 0.2; // explorers/outcasts lean solitary
const SKILL_MIN = 0.05;
const SKILL_MAX = 0.2;

const VESSEL_WIDTH = 3;
const VESSEL_HEIGHT = 2;

type RNG = () => number;
type Gender = 'male' | 'female';

interface AgentBlueprint {
  role: FoundingRole;
  gender: Gender;
  familyName: string;
  nearlyDiedOnCrossing: boolean;
}

// ============================================================
// RNG HELPERS
// ============================================================

function rFloat(rng: RNG, min: number, max: number): number {
  return min + rng() * (max - min);
}

function rInt(rng: RNG, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function shuffle<T>(array: T[], rng: RNG): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    const swap = copy[j];
    if (tmp !== undefined && swap !== undefined) {
      copy[i] = swap;
      copy[j] = tmp;
    }
  }
  return copy;
}

// ============================================================
// TRAIT & DRIVE GENERATION
// ============================================================

function generateTraits(role: FoundingRole, rng: RNG): Traits {
  const traits: Traits = {
    curiosity: TRAIT_BASE,
    courage: TRAIT_BASE,
    nobility: TRAIT_BASE,
    cunning: TRAIT_BASE,
    endurance: TRAIT_BASE,
    attraction: TRAIT_BASE,
    aggression: TRAIT_BASE,
    acuity: TRAIT_BASE,
    sociability: TRAIT_BASE, // overwritten below with its own skewed distribution
  };

  switch (role) {
    case FoundingRole.Explorer:
      traits.curiosity += 0.2;
      traits.courage += 0.15;
      break;
    case FoundingRole.Outcast:
      traits.aggression += 0.1;
      break;
    case FoundingRole.Leader:
      traits.nobility += 0.2;
      traits.acuity += 0.15;
      break;
    case FoundingRole.Survivor:
      traits.endurance += 0.2;
      traits.courage += 0.1;
      break;
  }

  for (const key of Object.keys(traits) as Array<keyof Traits>) {
    traits[key] = clamp01(traits[key] + rFloat(rng, -TRAIT_VARIATION, TRAIT_VARIATION));
  }

  // Sociability is its own thing, generated with a social-skewed distribution
  // rather than the uniform noise above. Role colours it: leaders bind the
  // group; those who left or were cast out lean solitary.
  let sociability = clamp01(1 - Math.pow(rng(), SOCIABILITY_SKEW));
  if (role === FoundingRole.Leader) {
    sociability = clamp01(sociability + SOCIABILITY_LEADER_BONUS);
  } else if (role === FoundingRole.Explorer || role === FoundingRole.Outcast) {
    sociability = clamp01(sociability - SOCIABILITY_SOLITARY_ROLE_PENALTY);
  }
  traits.sociability = sociability;

  return traits;
}

function generateDrives(
  role: FoundingRole,
  nearlyDiedOnCrossing: boolean,
): Drives {
  if (nearlyDiedOnCrossing) {
    return {
      hunger: 0.3,
      fatigue: 0.2,
      fear: 0.35,
      socialNeed: 0.1,
      grief: 0.25,
      longing: 0.05,
      wanderlust: 0.05,
    };
  }

  const drives: Drives = {
    hunger: 0.3,
    fatigue: 0.2,
    fear: 0.1,
    socialNeed: 0.1,
    grief: 0.1,
    longing: 0.05,
    wanderlust: role === FoundingRole.Explorer ? 0.20 : 0.05,
  };

  switch (role) {
    case FoundingRole.Explorer:
      drives.fear = clamp01(drives.fear - 0.1);
      break;
    case FoundingRole.Outcast:
      drives.fear = clamp01(drives.fear + 0.15);
      drives.grief = clamp01(drives.grief + 0.1);
      break;
    case FoundingRole.Survivor:
      drives.fear = clamp01(drives.fear + 0.2);
      break;
    case FoundingRole.Leader:
      drives.socialNeed = 0.15;
      break;
  }

  return drives;
}

function generateSkills(rng: RNG): Skills {
  return {
    hunting: rFloat(rng, SKILL_MIN, SKILL_MAX),
    gathering: rFloat(rng, SKILL_MIN, SKILL_MAX),
    building: rFloat(rng, SKILL_MIN, SKILL_MAX),
    fire: rFloat(rng, SKILL_MIN, SKILL_MAX),
    healing: rFloat(rng, SKILL_MIN, SKILL_MAX),
  };
}

function choseToLeave(role: FoundingRole, rng: RNG): boolean {
  switch (role) {
    case FoundingRole.Explorer:
    case FoundingRole.Leader:
      return true;
    case FoundingRole.Outcast:
      return false;
    case FoundingRole.Survivor:
      return rng() < 0.5;
  }
}

function generateAge(role: FoundingRole, rng: RNG): number {
  if (role === FoundingRole.Leader) {
    return rInt(rng, 30, 55);
  }
  return rInt(rng, 18, 45);
}

// ============================================================
// NAME SELECTION
// ============================================================

function namesUsedInFamily(agents: Agent[], familyName: string): Set<string> {
  const used = new Set<string>();
  for (const agent of agents) {
    if (agent.familyName === familyName) {
      used.add(agent.name);
    }
  }
  return used;
}

function pickNameFromPools(
  primaryPool: readonly string[],
  fallbackPool: readonly string[],
  usedInFamily: Set<string>,
  rng: RNG,
): string {
  const availablePrimary = primaryPool.filter((name) => !usedInFamily.has(name));
  if (availablePrimary.length > 0) {
    const index = Math.floor(rng() * availablePrimary.length);
    const name = availablePrimary[index];
    if (name !== undefined) return name;
  }

  const availableFallback = fallbackPool.filter((name) => !usedInFamily.has(name));
  if (availableFallback.length > 0) {
    const index = Math.floor(rng() * availableFallback.length);
    const name = availableFallback[index];
    if (name !== undefined) return name;
  }

  const combined = [...primaryPool, ...fallbackPool];
  const index = Math.floor(rng() * combined.length);
  return combined[index] ?? 'Unknown';
}

function pickFoundingName(
  gender: Gender,
  familyName: string,
  usedByFamily: Map<string, Set<string>>,
  rng: RNG,
): string {
  const usedInFamily = usedByFamily.get(familyName) ?? new Set<string>();
  const primaryPool = gender === 'male' ? FOUNDING_MALE_NAMES : FOUNDING_FEMALE_NAMES;
  const fallbackPool = gender === 'male' ? FOUNDING_FEMALE_NAMES : FOUNDING_MALE_NAMES;
  const name = pickNameFromPools(primaryPool, fallbackPool, usedInFamily, rng);

  if (!usedByFamily.has(familyName)) {
    usedByFamily.set(familyName, new Set());
  }
  usedByFamily.get(familyName)?.add(name);

  return name;
}

// ============================================================
// BLUEPRINT ASSEMBLY
// ============================================================

function buildRoleList(rng: RNG): FoundingRole[] {
  const roles: FoundingRole[] = [];
  for (const [role, count] of Object.entries(getRoleCounts()) as Array<[FoundingRole, number]>) {
    for (let i = 0; i < count; i++) {
      roles.push(role);
    }
  }
  return shuffle(roles, rng);
}

function buildGenderList(rng: RNG): Gender[] {
  const genders: Gender[] = [
    ...Array.from({ length: getMaleCount() }, () => 'male' as const),
    ...Array.from({ length: getFemaleCount() }, () => 'female' as const),
  ];
  return shuffle(genders, rng);
}

function assignNearlyDiedFlags(roles: FoundingRole[], rng: RNG): boolean[] {
  const flags = Array.from({ length: POPULATION_CONSTANTS.TOTAL_AGENTS }, () => false);
  const outcastIndices: number[] = [];
  const otherIndices: number[] = [];

  for (let i = 0; i < roles.length; i++) {
    if (roles[i] === FoundingRole.Outcast) {
      outcastIndices.push(i);
    } else {
      otherIndices.push(i);
    }
  }

  const shuffledOutcasts = shuffle(outcastIndices, rng);
  const shuffledOthers = shuffle(otherIndices, rng);

  const outcastPicks = Math.min(POPULATION_CONSTANTS.MIN_NEARLY_DIED_OUTCASTS, shuffledOutcasts.length);
  for (let i = 0; i < outcastPicks; i++) {
    const index = shuffledOutcasts[i];
    if (index !== undefined) flags[index] = true;
  }

  let assigned = outcastPicks;
  for (const index of shuffledOutcasts.slice(outcastPicks)) {
    if (assigned >= POPULATION_CONSTANTS.NEARLY_DIED_COUNT) break;
    if (index !== undefined) {
      flags[index] = true;
      assigned++;
    }
  }

  for (const index of shuffledOthers) {
    if (assigned >= POPULATION_CONSTANTS.NEARLY_DIED_COUNT) break;
    if (index !== undefined) {
      flags[index] = true;
      assigned++;
    }
  }

  return flags;
}

function buildBlueprints(rng: RNG): AgentBlueprint[] {
  const roles = buildRoleList(rng);
  const genders = buildGenderList(rng);
  const nearlyDiedFlags = assignNearlyDiedFlags(roles, rng);

  return roles.map((role, index) => ({
    role,
    gender: genders[index] ?? 'male',
    familyName: FAMILY_NAMES[rInt(rng, 0, FAMILY_NAMES.length - 1)] ?? FAMILY_NAMES[0],
    nearlyDiedOnCrossing: nearlyDiedFlags[index] ?? false,
  }));
}

// ============================================================
// VESSEL POSITIONING
// ============================================================

function getVesselTilePositions(vesselStart: { x: number; y: number }): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < VESSEL_HEIGHT; dy++) {
    for (let dx = 0; dx < VESSEL_WIDTH; dx++) {
      positions.push({
        x: vesselStart.x + dx,
        y: vesselStart.y + dy,
      });
    }
  }
  return positions;
}

function distributeAgentPositions(
  agentCount: number,
  vesselStart: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const tiles = getVesselTilePositions(vesselStart);
  const positions: Array<{ x: number; y: number }> = [];
  const basePerTile = Math.floor(agentCount / tiles.length);
  let remainder = agentCount % tiles.length;

  for (const tile of tiles) {
    let count = basePerTile;
    if (remainder > 0) {
      count++;
      remainder--;
    }
    for (let i = 0; i < count; i++) {
      positions.push({ x: tile.x, y: tile.y });
    }
  }

  return positions;
}

function addOccupant(
  tiles: GeneratedWorld['tiles'],
  x: number,
  y: number,
  agentId: string,
): void {
  const tile = tiles.get(x, y);
  if (!tile) return;
  if (!tile.occupants.includes(agentId)) {
    tile.occupants.push(agentId);
  }
}

// ============================================================
// HELMSMAN
// ============================================================

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

function selectHelmsman(agents: Agent[]): Agent {
  let best = agents[0];
  if (!best) {
    throw new Error('Cannot select helmsman from empty agent list');
  }

  for (const agent of agents) {
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

function setMutualTrust(
  agentA: Agent,
  agentB: Agent,
  trust: number,
  bond?: BondType,
): void {
  const relA = getRelationship(agentA, agentB.id);
  const relB = getRelationship(agentB, agentA.id);
  if (relA !== undefined) {
    relA.trust = trust;
    if (bond !== undefined) relA.bond = bond;
  }
  if (relB !== undefined) {
    relB.trust = trust;
    if (bond !== undefined) relB.bond = bond;
  }
}

function initializeRelationships(
  agents: Agent[],
  helmsmanId: string,
  rng: RNG,
): void {
  // Step 1 — baseline trust for every pair
  for (const agent of agents) {
    for (const other of agents) {
      if (other.id === agent.id) continue;
      agent.relationships.push(
        createRelationship(other.id, rFloat(rng, 0.1, 0.2), BondType.None),
      );
    }
  }

  const helmsman = agents.find((agent) => agent.id === helmsmanId);
  if (helmsman === undefined) return;

  // Step 2 — helmsman knows everyone slightly better
  for (const agent of agents) {
    if (agent.id === helmsmanId) continue;
    const trust = rFloat(rng, 0.2, 0.35);
    setMutualTrust(agent, helmsman, trust);
  }

  // Step 3 — same family starts as kin with elevated trust
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const agentA = agents[i];
      const agentB = agents[j];
      if (agentA === undefined || agentB === undefined) continue;
      if (agentA.familyName !== agentB.familyName) continue;

      const trust = rFloat(rng, 0.3, 0.5);
      setMutualTrust(agentA, agentB, trust, BondType.Kin);
    }
  }

  // Step 4 — nearly died agents bond with their implicit helper
  for (const agent of agents) {
    if (agent.foundingHistory?.nearlyDiedOnCrossing !== true) continue;

    let helper: Agent | undefined;
    let highestNobility = -1;
    for (const other of agents) {
      if (other.id === agent.id || !other.alive) continue;
      if (other.traits.nobility > highestNobility) {
        highestNobility = other.traits.nobility;
        helper = other;
      }
    }

    if (helper !== undefined) {
      const trust = rFloat(rng, 0.35, 0.55);
      setMutualTrust(agent, helper, trust);
    }
  }

  // Step 5 — random crossing bonds that formed at sea
  const eligiblePairs: Array<[Agent, Agent]> = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const agentA = agents[i];
      const agentB = agents[j];
      if (agentA === undefined || agentB === undefined) continue;

      const relA = getRelationship(agentA, agentB.id);
      const relB = getRelationship(agentB, agentA.id);
      if (
        relA !== undefined &&
        relB !== undefined &&
        relA.trust < 0.3 &&
        relB.trust < 0.3
      ) {
        eligiblePairs.push([agentA, agentB]);
      }
    }
  }

  const shuffledPairs = shuffle(eligiblePairs, rng);
  const pairCount = Math.min(POPULATION_CONSTANTS.ELEVATED_PAIR_COUNT, shuffledPairs.length);
  for (let i = 0; i < pairCount; i++) {
    const pair = shuffledPairs[i];
    if (pair === undefined) continue;
    const [agentA, agentB] = pair;
    const trust = rFloat(rng, 0.3, 0.5);
    setMutualTrust(agentA, agentB, trust);
  }
}

// ============================================================
// CHILD NAMING
// ============================================================

export function generateChildName(
  _motherId: string,
  _fatherId: string,
  gender: Gender,
  existingAgents: Agent[],
  rng: () => number,
): { name: string; familyName: string } {
  const mother = existingAgents.find((a) => a.id === _motherId);
  const familyName = mother?.familyName ?? FAMILY_NAMES[0];

  const usedInFamily = namesUsedInFamily(existingAgents, familyName);
  const primaryPool = gender === 'male' ? NEXT_GEN_MALE_NAMES : NEXT_GEN_FEMALE_NAMES;
  const fallbackPool = gender === 'male' ? FOUNDING_MALE_NAMES : FOUNDING_FEMALE_NAMES;

  const name = pickNameFromPools(primaryPool, fallbackPool, usedInFamily, rng);

  return { name, familyName };
}

function computeStartingHealth(age: number): number {
  if (age < 40) return 1.0;
  if (age < 55) return Math.max(0.1, 1.0 - (age - 39) * 0.008);
  return Math.max(0.1, 1.0 - (age - 39) * 0.012);
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function initializeAgents(
  world: GeneratedWorld,
  seed: number,
): { agents: Agent[]; vessel: VesselState } {
  const rng = seedrandom(`agents_${seed}`) as RNG;
  const blueprints = buildBlueprints(rng);
  const positions = distributeAgentPositions(POPULATION_CONSTANTS.TOTAL_AGENTS, world.vesselStart);
  const usedNamesByFamily = new Map<string, Set<string>>();

  const agents: Agent[] = blueprints.map((blueprint, index) => {
    const name = pickFoundingName(
      blueprint.gender,
      blueprint.familyName,
      usedNamesByFamily,
      rng,
    );

    const foundingHistory: FoundingHistory = {
      role: blueprint.role,
      ledTheCrossing: false,
      nearlyDiedOnCrossing: blueprint.nearlyDiedOnCrossing,
      choseToLeave: choseToLeave(blueprint.role, rng),
    };

    const position = positions[index] ?? world.vesselStart;
    const agentId = `agent_${index}`;
    const age = generateAge(blueprint.role, rng);

    addOccupant(world.tiles, position.x, position.y, agentId);

    return {
      id: agentId,
      name,
      familyName: blueprint.familyName,
      gender: blueprint.gender,
      age,
      healthScore: computeStartingHealth(age),
      generation: 0,
      alive: true,
      position,
      home: { x: position.x, y: position.y }, // provisional; the camp is set at landfall
      drives: generateDrives(blueprint.role, blueprint.nearlyDiedOnCrossing),
      traits: generateTraits(blueprint.role, rng),
      skills: generateSkills(rng),
      inventory: { wood: 0, items: [] }, // empty-handed at landfall
      relationships: [],
      lineage: {
        motherId: null,
        fatherId: null,
        children: [],
      },
      foundingHistory,
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
      pregnancy: null,
    };
  });

  const helmsman = selectHelmsman(agents);
  if (helmsman.foundingHistory) {
    helmsman.foundingHistory.ledTheCrossing = true;
  }

  initializeRelationships(agents, helmsman.id, rng);

  const vesselResources: { food: Resource; water: Resource } = {
    food: { current: 0.48, max: 0.6, regenRate: 0 },
    water: { current: 0.4, max: 0.5, regenRate: 0 },
  };

  const vessel: VesselState = {
    id: 'vessel_founding',
    position: world.vesselStart,
    integrity: 1,
    beached: false,
    resources: vesselResources,
    items: createStartingVesselItems(),
    helmsmanId: helmsman.id,
  };

  return { agents, vessel };
}
