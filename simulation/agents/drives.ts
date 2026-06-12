// simulation/agents/drives.ts
// Updates all agent drives once per tick. Vessel-aware where noted.

import type { Agent, WorldState } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import {
  illnessFatigueMultiplier,
  illnessHungerMultiplier,
} from './illness.js';
import { isVesselZone, manhattanDistance } from '../world/tiles.js';
import { tickHealthRecovery } from './recovery.js';

// ============================================================
// CONSTANTS
// ============================================================

const TICKS_PER_DAY = 48;
const TICKS_PER_SEASON = 360;    // 7.5 simulated days per season
const TICKS_PER_YEAR = 1440;     // 4 seasons × 360 ticks

export { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR };

const HUNGER_DEPLETION_RATE = 0.001;
const HUNGER_CRITICAL_THRESHOLD = 1.0;

const FATIGUE_DEPLETION_BASE = 0.001;
const FATIGUE_HUNGER_MULTIPLIER = 1.8;
const FATIGUE_HUNGER_THRESHOLD = 0.5;

const FEAR_FADE_RATE = 0.003;
const FEAR_VESSEL_FADE_RATE = 0.001;

const SOCIAL_DEPLETION_RATE = 0.0005;
const SOCIAL_VESSEL_DEPLETION_RATE = 0.00005;

const GRIEF_FADE_RATE = 0.001;

const LONGING_BUILD_RATE = 0.0003; // longing is the desire for a MATE; it builds until discharged by reproduction
const COMPANY_RADIUS = 3;          // another agent within this range counts as company (for socialNeed)

// Wanderlust — the pull toward the unknown interior.
// Builds slowly in curious, unbonded agents; near-zero for the settled/old.
// Bonded agents DECAY wanderlust (see WANDERLUST_DECAY_BONDED below) — no build.
const WANDERLUST_BUILD_BASE = 0.0006;  // per tick, before curiosity scaling
const WANDERLUST_YOUTH_BONUS = 0.5;    // multiplier bonus for agents under 30
const WANDERLUST_OLD_AGE = 50;         // above this age, wanderlust fades toward zero
const WANDERLUST_OLD_FACTOR = 0.15;    // fraction of normal rate for the old

const STARVATION_BASE_TICKS = 480;
const STARVATION_ENDURANCE_MODIFIER = 24;
const STARVATION_MIN_TICKS = 288;
const STARVATION_MAX_TICKS = 720;
const STARVATION_DOUBLE_SPEED_THRESHOLD = 0.9;

const FATIGUE_EXPRESSION_DAMPENER = 0.4;

const STARVATION_FEAR_SPIKE = 0.25;

// Wanderlust decay: bonded/settled agents bleed off their wanderlust so it does
// not permanently pin at 1.0 with no outlet (the "stuck state"). The decay rate
// is slow — a suppressed agent drains ~1.0 to 0 in ~2000 ticks.
const WANDERLUST_DECAY_BONDED = 0.0005; // per tick when pair-bonded or conduit-bonded
// Explorer founding role — extra build rate so explorers accrue wanderlust faster
// and roam more reliably. Youth bonus already applies on top of this.
const WANDERLUST_EXPLORER_BONUS = 0.6;  // multiplier added to base for explorer-role agents

export interface AgeModifiers {
  fatigueMultiplier: number;
  hungerMultiplier: number;
  enduranceDrainPerYear: number;
}

export function getAgeModifiers(age: number): AgeModifiers {
  if (age < 40) {
    return { fatigueMultiplier: 1.0, hungerMultiplier: 1.0, enduranceDrainPerYear: 0 };
  }
  if (age < 55) {
    const t = (age - 40) / 15;
    return {
      fatigueMultiplier: 1.0 + t * 0.3,
      hungerMultiplier: 1.0 + t * 0.1,
      enduranceDrainPerYear: 0.002,
    };
  }
  if (age < 70) {
    const t = (age - 55) / 15;
    return {
      fatigueMultiplier: 1.3 + t * 0.5,
      hungerMultiplier: 1.1 + t * 0.1,
      enduranceDrainPerYear: 0.004,
    };
  }
  return {
    fatigueMultiplier: 1.8,
    hungerMultiplier: 1.2,
    enduranceDrainPerYear: 0.006,
  };
}

export function tickAgentAge(agent: Agent, currentTick: number): void {
  if (currentTick % TICKS_PER_YEAR !== 0) return;
  if (currentTick === 0) return;

  agent.age += 1;

  const modifiers = getAgeModifiers(agent.age);
  agent.traits.endurance = Math.max(
    0,
    agent.traits.endurance - modifiers.enduranceDrainPerYear,
  );

  // Cunning passive boost in middle age (40-60)
  // Represents accumulated experience and learned indirection
  if (agent.age >= 40 && agent.age <= 60) {
    agent.traits.cunning = Math.min(1, agent.traits.cunning + 0.001);
  }

  if (agent.age < 55) return;

  const baseDecline = agent.age < 70 ? 0.015 : 0.03;
  const enduranceBonus = agent.traits.endurance > 0.6 ? 0.7 : 1.0;
  const decline = baseDecline * enduranceBonus;

  agent.healthScore = Math.max(0, agent.healthScore - decline);
}

// ============================================================
// HELPERS
// ============================================================

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeSurvivalTicks(endurance: number): number {
  const enduranceDelta = endurance - 0.5;
  const tenths = enduranceDelta / 0.1;
  const ticks = STARVATION_BASE_TICKS + tenths * STARVATION_ENDURANCE_MODIFIER;
  return Math.max(STARVATION_MIN_TICKS, Math.min(STARVATION_MAX_TICKS, ticks));
}

export function fatigueModifier(fatigue: number): number {
  return 1 - FATIGUE_EXPRESSION_DAMPENER * clamp01(fatigue);
}

export function isStarving(agent: Agent): boolean {
  return agent.starvationTick !== null;
}

export function starvationUrgency(agent: Agent, currentTick: number): number {
  if (agent.starvationTick === null || agent.starvationSurvivalTicks === null) {
    return 0;
  }

  const ticksElapsed = currentTick - agent.starvationTick;
  let effectiveElapsed = ticksElapsed;
  if (agent.drives.fatigue >= STARVATION_DOUBLE_SPEED_THRESHOLD) {
    effectiveElapsed = ticksElapsed * 2;
  }

  return clamp01(effectiveElapsed / agent.starvationSurvivalTicks);
}

// ============================================================
// PER-DRIVE TICK FUNCTIONS
// ============================================================

function tickHunger(agent: Agent, _isAtSea: boolean, state: WorldState): void {
  const ageModifiers = getAgeModifiers(agent.age);
  agent.drives.hunger = clamp01(
    agent.drives.hunger +
      HUNGER_DEPLETION_RATE *
        ageModifiers.hungerMultiplier *
        illnessHungerMultiplier(agent),
  );

  if (agent.drives.hunger >= HUNGER_CRITICAL_THRESHOLD) {
    if (agent.starvationTick === null) {
      agent.starvationTick = state.tick;
      agent.starvationSurvivalTicks = computeSurvivalTicks(agent.traits.endurance);
      agent.drives.fear = clamp01(agent.drives.fear + STARVATION_FEAR_SPIKE);
    }
  } else {
    agent.starvationTick = null;
    agent.starvationSurvivalTicks = null;
  }
}

function tickFatigue(agent: Agent, _isAtSea: boolean): void {
  const ageModifiers = getAgeModifiers(agent.age);
  let depletion =
    FATIGUE_DEPLETION_BASE *
    ageModifiers.fatigueMultiplier *
    illnessFatigueMultiplier(agent);
  if (agent.drives.hunger > FATIGUE_HUNGER_THRESHOLD) {
    depletion *= FATIGUE_HUNGER_MULTIPLIER;
  }
  agent.drives.fatigue = clamp01(agent.drives.fatigue + depletion);
  // Fatigue restoration is handled in actions.ts when agents rest.
  // There is no passive recovery — rest is a deliberate action competing with other drives.
}

function tickFear(agent: Agent, isAtSea: boolean, nearbyThreat: boolean): void {
  if (nearbyThreat) return;

  const fadeRate = isAtSea ? FEAR_VESSEL_FADE_RATE : FEAR_FADE_RATE;
  agent.drives.fear = clamp01(agent.drives.fear - fadeRate);
}

function tickSocialNeed(
  agent: Agent,
  isAtSea: boolean,
  nearCompany: boolean,
): void {
  if (isAtSea) {
    agent.drives.socialNeed = clamp01(
      agent.drives.socialNeed + SOCIAL_VESSEL_DEPLETION_RATE,
    );
    return;
  }

  // Isolation builds social need — but only as much as the agent's nature cares.
  // A loner (low sociability) barely feels it; a gregarious agent aches to return.
  if (!nearCompany) {
    agent.drives.socialNeed = clamp01(
      agent.drives.socialNeed + SOCIAL_DEPLETION_RATE * agent.traits.sociability,
    );
  }
}

function tickGrief(agent: Agent): void {
  agent.drives.grief = clamp01(agent.drives.grief - GRIEF_FADE_RATE);
}

// Longing is the desire for a MATE — distinct from socialNeed (the need for any
// company). It builds over time, coloured by how strongly the agent forms pair
// bonds (attraction), and is discharged by reproduction (births.ts resets it).
// This is what drives an agent to seek a partner; survival drives still outrank
// it when pressing, and resolveDriveTie defers it to socialNeed until a pair
// bond exists — so the unmated seek company first, the bonded seek their mate.
function tickLonging(agent: Agent): void {
  agent.drives.longing = clamp01(
    agent.drives.longing + LONGING_BUILD_RATE * (0.5 + agent.traits.attraction),
  );
}

// Wanderlust — build slowly, scaled by curiosity and life circumstances.
// Near-zero for pair-bonded, conduit-bonded, old, or settled agents;
// highest for young, curious, unbonded souls. Explorer founding role and youth
// are build-rate BONUSES (not hard gates); they make those agents roam sooner
// and more often. Bonded agents actively DECAY wanderlust so it cannot pin at
// 1.0 forever — the stuck state where half the population silently holds a
// maxed drive with no outlet. Discharged by reaching new ground (in
// actionVenture in exploration.ts) rather than here.
function tickWanderlust(agent: Agent): void {
  // Ensure the field exists on agents restored from old checkpoints
  if (typeof agent.drives.wanderlust !== 'number') {
    agent.drives.wanderlust = 0.05;
  }

  const hasPairBond = agent.relationships.some(
    (rel) => rel.bond === BondType.Pair,
  );
  const hasConduitBond = agent.conduitId !== null;

  // Bonded agents actively bleed off wanderlust — prevents the permanent max.
  if (hasPairBond || hasConduitBond) {
    agent.drives.wanderlust = clamp01(agent.drives.wanderlust - WANDERLUST_DECAY_BONDED);
    return; // no further build when bonded
  }

  // Settled/old agents barely feel it
  const ageFactor =
    agent.age >= WANDERLUST_OLD_AGE
      ? WANDERLUST_OLD_FACTOR
      : agent.age < 30
        ? 1 + WANDERLUST_YOUTH_BONUS
        : 1.0;

  // Explorer founding role: accrues faster (they came to find what's out there)
  const isExplorer = agent.foundingHistory?.role === 'explorer';
  const explorerFactor = isExplorer ? 1 + WANDERLUST_EXPLORER_BONUS : 1.0;

  const rate =
    WANDERLUST_BUILD_BASE *
    agent.traits.curiosity *
    ageFactor *
    explorerFactor;

  agent.drives.wanderlust = clamp01(agent.drives.wanderlust + rate);
}

// Company = at least one other living agent within COMPANY_RADIUS.
function hasNearbyCompany(agent: Agent, state: WorldState): boolean {
  for (const other of state.agents) {
    if (!other.alive || other.id === agent.id) continue;
    if (
      manhattanDistance(
        agent.position.x,
        agent.position.y,
        other.position.x,
        other.position.y,
      ) <= COMPANY_RADIUS
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function tickAgentDrives(
  agent: Agent,
  state: WorldState,
  nearbyThreat: boolean,
): void {
  const isAtSea = isVesselZone(agent.position.y);
  const nearCompany = hasNearbyCompany(agent, state);

  tickHunger(agent, isAtSea, state);
  tickFatigue(agent, isAtSea);
  tickFear(agent, isAtSea, nearbyThreat);
  tickSocialNeed(agent, isAtSea, nearCompany);
  tickGrief(agent);
  tickLonging(agent);
  tickWanderlust(agent);
  tickHealthRecovery(agent, state);
}
