// simulation/agents/significance.ts
// Calculates significance scores and manages chronicle thread assignment.

import type { Agent, WorldState } from '@shared/types.js';
import { isStarving, starvationUrgency } from './drives.js';
import { isSick, illnessSeverity } from './illness.js';
import { SIGNIFICANCE_PEAK } from './traits.js';
import { getTile, getTilesInRange, manhattanDistance } from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

const TRAIT_EXTREMITY_WEIGHT = 0.35;
const SOCIAL_CENTRALITY_WEIGHT = 0.25;
const RECENT_EVENT_WEIGHT_WEIGHT = 0.25;
const BEHAVIORAL_DEVIATION_WEIGHT = 0.15;

const TRAIT_EXTREMITY_FLOOR = 0.5;
const TRAIT_EXTREMITY_PEAK_BONUS = 0.3;

const MAX_RELATIONSHIPS_FOR_SCALE = 49;
const HIGH_TRUST_THRESHOLD = 0.3;
const HIGH_TRUST_BONUS = 0.6;

const EVENT_RECENCY_WINDOW = 96;
const MAX_EVENT_WEIGHT_SUM = 1.2;

const STARVATION_DEVIATION_BONUS = 0.4;
const COMPANION_PROXIMITY_BONUS = 0.35;
const CHRONICLE_THREAD_BONUS = 0.25;
const FAR_FROM_GROUP_DISTANCE = 8;
const FAR_FROM_GROUP_BONUS = 0.2;

const MAX_CHRONICLE_THREADS_SAMPLE = 2;
// MAX_CHRONICLE_THREADS_FULL = 6 — for production

const SICK_DEVIATION_WEIGHT = 0.3;

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
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function aliveAgents(state: WorldState): Agent[] {
  return state.agents.filter((agent) => agent.alive);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    const lower = sorted[mid - 1];
    const upper = sorted[mid];
    if (lower === undefined || upper === undefined) return 0;
    return (lower + upper) / 2;
  }

  return sorted[mid] ?? 0;
}

function computeGroupMedianPosition(agents: Agent[]): { x: number; y: number } {
  const alive = agents.filter((agent) => agent.alive);
  if (alive.length === 0) return { x: 0, y: 0 };

  const xs = alive.map((agent) => agent.position.x);
  const ys = alive.map((agent) => agent.position.y);
  return { x: median(xs), y: median(ys) };
}

function hasCompanionNearby(agent: Agent, state: WorldState): boolean {
  const { x, y } = agent.position;
  const centerTile = getTile(state.tiles, x, y);
  if (centerTile?.companionPresent) return true;
  return getTilesInRange(state.tiles, x, y, 3).some(
    (tile) => tile.companionPresent,
  );
}

// ============================================================
// SCORING COMPONENTS
// ============================================================

function computeTraitExtremity(agent: Agent): number {
  let sum = 0;
  for (const key of TRAIT_KEYS) {
    const traitValue = agent.traits[key];
    const contribution =
      Math.max(0, traitValue - TRAIT_EXTREMITY_FLOOR) /
      (1.0 - TRAIT_EXTREMITY_FLOOR);
    sum += contribution;
  }

  let score = sum / TRAIT_KEYS.length;

  const hasPeakTrait = TRAIT_KEYS.some(
    (key) => agent.traits[key] >= SIGNIFICANCE_PEAK,
  );
  if (hasPeakTrait) {
    score += TRAIT_EXTREMITY_PEAK_BONUS;
  }

  return clamp01(score);
}

function computeSocialCentrality(agent: Agent): number {
  const relationshipCount = agent.relationships.length;
  const countFactor = Math.min(
    1,
    relationshipCount / MAX_RELATIONSHIPS_FOR_SCALE,
  );

  const highTrustCount = agent.relationships.filter(
    (rel) => rel.trust >= HIGH_TRUST_THRESHOLD,
  ).length;
  const trustFactor = Math.min(
    1,
    (highTrustCount * HIGH_TRUST_BONUS) / MAX_RELATIONSHIPS_FOR_SCALE,
  );

  return clamp01((countFactor + trustFactor) / 2);
}

function computeRecentEventWeight(agent: Agent, state: WorldState): number {
  const recentEvents = agent.recentEvents.filter(
    (event) => state.tick - event.tick <= EVENT_RECENCY_WINDOW,
  );
  const weightSum = recentEvents.reduce(
    (sum, event) => sum + event.narrativeWeight,
    0,
  );
  return clamp01(weightSum / MAX_EVENT_WEIGHT_SUM);
}

function computeBehavioralDeviation(agent: Agent, state: WorldState): number {
  let score = 0;

  if (isStarving(agent)) {
    score += starvationUrgency(agent, state.tick) * STARVATION_DEVIATION_BONUS;
  }

  if (hasCompanionNearby(agent, state)) {
    score += COMPANION_PROXIMITY_BONUS;
  }

  if (agent.chronicleThreadActive) {
    score += CHRONICLE_THREAD_BONUS;
  }

  const medianPosition = computeGroupMedianPosition(state.agents);
  const distanceFromGroup = manhattanDistance(
    agent.position.x,
    agent.position.y,
    medianPosition.x,
    medianPosition.y,
  );
  if (distanceFromGroup > FAR_FROM_GROUP_DISTANCE) {
    score += FAR_FROM_GROUP_BONUS;
  }

  if (isSick(agent)) {
    score += illnessSeverity(agent) * SICK_DEVIATION_WEIGHT;
  }

  return clamp01(score);
}

function computeSignificanceScore(agent: Agent, state: WorldState): number {
  const traitExtremity = computeTraitExtremity(agent);
  const socialCentrality = computeSocialCentrality(agent);
  const recentEventWeight = computeRecentEventWeight(agent, state);
  const behavioralDeviation = computeBehavioralDeviation(agent, state);

  const score =
    traitExtremity * TRAIT_EXTREMITY_WEIGHT +
    socialCentrality * SOCIAL_CENTRALITY_WEIGHT +
    recentEventWeight * RECENT_EVENT_WEIGHT_WEIGHT +
    behavioralDeviation * BEHAVIORAL_DEVIATION_WEIGHT;

  return clamp01(score);
}

// ============================================================
// CHRONICLE THREADS
// ============================================================

function countActiveChronicleThreads(state: WorldState): number {
  return aliveAgents(state).filter((agent) => agent.chronicleThreadActive).length;
}

function updateChronicleThreads(state: WorldState): void {
  // Close threads for dead agents
  for (const agent of state.agents) {
    if (!agent.alive && agent.chronicleThreadActive) {
      agent.chronicleThreadActive = false;
    }
  }

  // Always maintain MAX_CHRONICLE_THREADS_SAMPLE active threads
  // pointing at the top agents by significance — no score threshold.
  // The chronicle follows whoever is most interesting right now.
  const activeCount = countActiveChronicleThreads(state);
  if (activeCount >= MAX_CHRONICLE_THREADS_SAMPLE) return;

  const needed = MAX_CHRONICLE_THREADS_SAMPLE - activeCount;
  const candidates = aliveAgents(state)
    .filter((agent) => !agent.chronicleThreadActive)
    .sort((a, b) => b.significanceScore - a.significanceScore)
    .slice(0, needed);

  for (const agent of candidates) {
    agent.chronicleThreadActive = true;
  }
}

// ============================================================
// DEATH DETECTION
// ============================================================

export interface DeathRecord {
  agentId: string;
  cause: 'starvation' | 'age' | 'illness' | 'animal';
}

export function detectDeaths(state: WorldState): DeathRecord[] {
  const deaths: DeathRecord[] = [];

  for (const agent of state.agents) {
    if (!agent.alive) continue;

    if (starvationUrgency(agent, state.tick) >= 1.0) {
      deaths.push({ agentId: agent.id, cause: 'starvation' });
    } else if (agent.healthScore <= 0) {
      let cause: DeathRecord['cause'] = 'age';
      if (
        agent.animalAttackTick !== null &&
        state.tick - agent.animalAttackTick <= 10
      ) {
        cause = 'animal';
      } else if (agent.illnessState !== null) {
        cause = 'illness';
      }
      deaths.push({ agentId: agent.id, cause });
    }
  }

  return deaths;
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function tickSignificance(state: WorldState): void {
  for (const agent of aliveAgents(state)) {
    agent.significanceScore = computeSignificanceScore(agent, state);
  }
  updateChronicleThreads(state);
}

export function getTopAgentsBySignificance(
  state: WorldState,
  count: number,
): Agent[] {
  return aliveAgents(state)
    .sort((a, b) => b.significanceScore - a.significanceScore)
    .slice(0, count);
}
