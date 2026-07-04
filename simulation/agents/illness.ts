// simulation/agents/illness.ts
// Infection checks, severity progression, recovery, and illness drive modifiers.

import type { Agent, WorldState } from '@shared/types.js';
import { Season, Terrain } from '@shared/types.js';
import { getTile, manhattanDistance } from '../world/tiles.js';

// TODO: log illness events via events/log.ts when the tick loop wires logIllnessEvent

// ============================================================
// CONSTANTS
// ============================================================

// Tuning knobs, grouped into one exported, mutable object so the
// wind-tunnel harness (simulation/harness/) can override them before a run —
// same pattern as RELATIONSHIP_CONSTANTS/CONDUIT_CONSTANTS/CONFLICT_CONSTANTS.
// Defaults below are unchanged from before this refactor; see the
// determinism check in the commit that introduced this object.
export const ILLNESS_CONSTANTS = {
  INFECTION_WATER_CHANCE: 0.003,
  INFECTION_WATER_LOW_RESOURCE: 0.008,
  INFECTION_EXPOSURE_CHANCE: 0.001,
  INFECTION_PROXIMITY_CHANCE: 0.002,
  INFECTION_WOUND_CHANCE: 0.08,

  SEVERITY_WORSEN_RATE: 0.004,
  SEVERITY_NATURAL_RECOVER_RATE: 0.003,
  SEVERITY_HEALER_RECOVER_RATE: 0.012,
  SEVERITY_HIGH_ENDURANCE_BONUS: 0.002,
  SEVERITY_HEALTH_IMPACT_THRESHOLD: 0.7,
  SEVERITY_HEALTH_DRAIN_RATE: 0.008,

  ILLNESS_FATIGUE_MULTIPLIER_MIN: 1.2,
  ILLNESS_FATIGUE_MULTIPLIER_MAX: 2.0,
  ILLNESS_HUNGER_MULTIPLIER_MIN: 1.1,
  ILLNESS_HUNGER_MULTIPLIER_MAX: 1.5,
  ILLNESS_SKILL_DAMPENER: 0.4,

  HEALER_SKILL_THRESHOLD: 0.3,
  EXPOSURE_ENDURANCE_MAX: 0.4,
  EXPOSURE_FATIGUE_MIN: 0.7,
  WORSEN_FATIGUE_MIN: 0.8,
  WORSEN_HUNGER_MIN: 0.6,
  LOW_WATER_RESOURCE: 0.2,
};

// ============================================================
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * clamp01(t);
}

function aliveAgents(state: WorldState): Agent[] {
  return state.agents.filter((agent) => agent.alive);
}

function agentsOnSameTile(agent: Agent, state: WorldState): Agent[] {
  return aliveAgents(state).filter(
    (other) =>
      other.id !== agent.id &&
      other.position.x === agent.position.x &&
      other.position.y === agent.position.y,
  );
}

export function hasAdjacentHealer(agent: Agent, state: WorldState): boolean {
  for (const other of aliveAgents(state)) {
    if (other.id === agent.id) continue;
    const distance = manhattanDistance(
      agent.position.x,
      agent.position.y,
      other.position.x,
      other.position.y,
    );
    if (distance <= 1 && other.skills.healing > ILLNESS_CONSTANTS.HEALER_SKILL_THRESHOLD) {
      return true;
    }
  }
  return false;
}

function contractIllness(
  agent: Agent,
  state: WorldState,
  severity: number,
): void {
  agent.illnessState = {
    sick: true,
    severity,
    contractedAtTick: state.tick,
  };
}

// ============================================================
// MULTIPLIERS
// ============================================================

export function illnessFatigueMultiplier(agent: Agent): number {
  if (agent.illnessState === null) return 1.0;
  return lerp(
    ILLNESS_CONSTANTS.ILLNESS_FATIGUE_MULTIPLIER_MIN,
    ILLNESS_CONSTANTS.ILLNESS_FATIGUE_MULTIPLIER_MAX,
    agent.illnessState.severity,
  );
}

export function illnessHungerMultiplier(agent: Agent): number {
  if (agent.illnessState === null) return 1.0;
  return lerp(
    ILLNESS_CONSTANTS.ILLNESS_HUNGER_MULTIPLIER_MIN,
    ILLNESS_CONSTANTS.ILLNESS_HUNGER_MULTIPLIER_MAX,
    agent.illnessState.severity,
  );
}

export function illnessSkillMultiplier(agent: Agent): number {
  if (agent.illnessState === null) return 1.0;
  return 1 - agent.illnessState.severity * ILLNESS_CONSTANTS.ILLNESS_SKILL_DAMPENER;
}

// ============================================================
// INFECTION
// ============================================================

export function checkInfection(agent: Agent, state: WorldState, rng: () => number): boolean {
  if (agent.illnessState !== null) return false;

  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  const drankOrAteThisTick =
    agent.lastDrankAtTick === state.tick || agent.lastAteAtTick === state.tick;

  if (
    tile?.terrain === Terrain.River &&
    drankOrAteThisTick &&
    rng() <
      (tile.resources.water.current < ILLNESS_CONSTANTS.LOW_WATER_RESOURCE
        ? ILLNESS_CONSTANTS.INFECTION_WATER_LOW_RESOURCE
        : ILLNESS_CONSTANTS.INFECTION_WATER_CHANCE)
  ) {
    contractIllness(agent, state, 0.1);
    return true;
  }

  if (
    state.season === Season.Winter &&
    agent.traits.endurance < ILLNESS_CONSTANTS.EXPOSURE_ENDURANCE_MAX &&
    agent.drives.fatigue > ILLNESS_CONSTANTS.EXPOSURE_FATIGUE_MIN &&
    rng() < ILLNESS_CONSTANTS.INFECTION_EXPOSURE_CHANCE
  ) {
    contractIllness(agent, state, 0.1);
    return true;
  }

  for (const other of agentsOnSameTile(agent, state)) {
    if (other.illnessState !== null && rng() < ILLNESS_CONSTANTS.INFECTION_PROXIMITY_CHANCE) {
      contractIllness(agent, state, 0.1);
      return true;
    }
  }

  return false;
}

export function checkWoundInfection(agent: Agent, currentTick: number, rng: () => number): boolean {
  if (agent.illnessState !== null) return false;

  if (rng() < ILLNESS_CONSTANTS.INFECTION_WOUND_CHANCE) {
    agent.illnessState = {
      sick: true,
      severity: 0.15,
      contractedAtTick: currentTick,
    };
    return true;
  }

  return false;
}

// ============================================================
// STATUS
// ============================================================

export function isSick(agent: Agent): boolean {
  return agent.illnessState !== null;
}

export function illnessSeverity(agent: Agent): number {
  return agent.illnessState?.severity ?? 0;
}

// ============================================================
// TICK
// ============================================================

export function tickIllness(agent: Agent, state: WorldState): boolean {
  if (agent.illnessState === null) return false;

  const worsening =
    agent.drives.fatigue > ILLNESS_CONSTANTS.WORSEN_FATIGUE_MIN &&
    agent.drives.hunger > ILLNESS_CONSTANTS.WORSEN_HUNGER_MIN;

  if (worsening) {
    agent.illnessState.severity = clamp01(
      agent.illnessState.severity + ILLNESS_CONSTANTS.SEVERITY_WORSEN_RATE,
    );
  } else {
    let recovery = hasAdjacentHealer(agent, state)
      ? ILLNESS_CONSTANTS.SEVERITY_HEALER_RECOVER_RATE
      : ILLNESS_CONSTANTS.SEVERITY_NATURAL_RECOVER_RATE;

    if (agent.traits.endurance > 0.6) {
      recovery += ILLNESS_CONSTANTS.SEVERITY_HIGH_ENDURANCE_BONUS;
    }

    agent.illnessState.severity = clamp01(
      agent.illnessState.severity - recovery,
    );
  }

  if (agent.illnessState.severity > ILLNESS_CONSTANTS.SEVERITY_HEALTH_IMPACT_THRESHOLD) {
    agent.healthScore = Math.max(
      0,
      agent.healthScore - ILLNESS_CONSTANTS.SEVERITY_HEALTH_DRAIN_RATE,
    );
  }

  if (agent.illnessState.severity <= 0) {
    agent.illnessState = null;
    return true;
  }

  return false;
}
