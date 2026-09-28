// simulation/agents/maturity.ts
// Life stages — the one place that decides what a body is old enough to do.
//
// ============================================================
// WHY THIS EXISTS
//
// Before this file, age was demographic decoration. It fed death odds, two
// drive curves and a ruin-rumor gate, and nothing else — so a newborn entered
// exactly the same action dispatch as a forty-year-old. Within a tick of being
// born, children were chopping timber and carrying it to the hall. By world
// year 13 the live camp held six-year-olds with building and fire skills maxed
// at 1.0, indistinguishable from the adults who raised them.
//
// The same missing gate sat on pair bonding, and there it did real demographic
// damage. Bonds were promoted on trust and interaction count alone, so two
// six-year-olds bonded as mates, and a fifty-four-year-old bonded with a
// ten-year-old. Because a pair bond is exclusive — neither partner may hold
// another — every one of those dud bonds permanently removed two people from
// the breeding population. In the live world, six of seven pair bonds were
// duds and the seventh was 756 tiles wide. Zero functioning breeding pairs.
// That, not a birth-rate constant, is why a camp of fifty grew by three in
// thirteen years.
//
// Adulthood is 16 because BIRTH_MIN_AGE is already 16. One number, one
// meaning: the age you may become a parent is the age you are treated as
// grown. Do not let the two drift apart.
// ============================================================

import type { Agent } from '@shared/types.js';

export type LifeStage = 'infant' | 'child' | 'adolescent' | 'adult';

export const MATURITY_CONSTANTS = {
  // Upper bound of each stage, in world years. A world year is 1440 ticks.
  INFANT_MAX_AGE: 2,      // carried, fed, kept at the hearth
  CHILD_MAX_AGE: 9,       // underfoot at camp, learning by watching
  ADOLESCENT_MAX_AGE: 15, // works alongside adults, still no mate and no spear

  // The line. Mating, violence, long treks and full-rate learning start here.
  ADULT_AGE: 16,

  // How fast each stage converts practice into skill, relative to an adult.
  // An infant barely learns, a child learns slowly by imitation, an adolescent
  // is nearly there. Without this, a child who is allowed any productive action
  // at all still reaches skill 1.0 within a few years, which is how the live
  // world produced six-year-old master builders.
  INFANT_LEARNING_RATE: 0.05,
  CHILD_LEARNING_RATE: 0.25,
  ADOLESCENT_LEARNING_RATE: 0.6,
  ADULT_LEARNING_RATE: 1.0,

  // How far from their hearth a child will stray before being drawn back.
  // Keeps the young with the band instead of scattered across the map, which
  // is also what makes them findable as a family when the band migrates.
  CHILD_HOME_LEASH: 4,
  INFANT_HOME_LEASH: 1,
};

export function lifeStage(age: number): LifeStage {
  if (age <= MATURITY_CONSTANTS.INFANT_MAX_AGE) return 'infant';
  if (age <= MATURITY_CONSTANTS.CHILD_MAX_AGE) return 'child';
  if (age <= MATURITY_CONSTANTS.ADOLESCENT_MAX_AGE) return 'adolescent';
  return 'adult';
}

/** True for anyone below the age of majority — infant, child or adolescent. */
export function isChild(agent: Agent): boolean {
  return agent.age < MATURITY_CONSTANTS.ADULT_AGE;
}

export function isAdult(agent: Agent): boolean {
  return agent.age >= MATURITY_CONSTANTS.ADULT_AGE;
}

/** Infants and small children do not work. Adolescents do, at reduced effect. */
export function canDoAdultLabour(agent: Agent): boolean {
  const stage = lifeStage(agent.age);
  return stage === 'adolescent' || stage === 'adult';
}

/** Multiplier applied to every skill gain, by stage. */
export function skillLearningRate(age: number): number {
  switch (lifeStage(age)) {
    case 'infant':
      return MATURITY_CONSTANTS.INFANT_LEARNING_RATE;
    case 'child':
      return MATURITY_CONSTANTS.CHILD_LEARNING_RATE;
    case 'adolescent':
      return MATURITY_CONSTANTS.ADOLESCENT_LEARNING_RATE;
    default:
      return MATURITY_CONSTANTS.ADULT_LEARNING_RATE;
  }
}

/**
 * Whether these two may hold a mating bond. Both must be grown.
 *
 * This is deliberately NOT a check on gender: a same-sex pair bond is a real
 * relationship this world is allowed to have. It is a check on age only.
 */
export function mayBondAsMates(agentA: Agent, agentB: Agent): boolean {
  return isAdult(agentA) && isAdult(agentB);
}

/** How far this agent is allowed to drift from their hearth, by stage. */
export function homeLeash(agent: Agent): number {
  switch (lifeStage(agent.age)) {
    case 'infant':
      return MATURITY_CONSTANTS.INFANT_HOME_LEASH;
    case 'child':
      return MATURITY_CONSTANTS.CHILD_HOME_LEASH;
    default:
      return Number.POSITIVE_INFINITY;
  }
}
