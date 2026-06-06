// simulation/agents/traits.ts
// Updates agent traits and skills based on tick outcomes.

import type { Agent, Skills, Traits } from '@shared/types.js';
import { fatigueModifier } from './drives.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';

// ============================================================
// CONSTANTS
// ============================================================

const MICRO = 0.001;
const SMALL = 0.003;
const MEDIUM = 0.008;
const LARGE = 0.02;

const TRAIT_MIN = 0.0;
const TRAIT_MAX = 1.0;
export const SIGNIFICANCE_THRESHOLD = 0.85;
export const SIGNIFICANCE_PEAK = 0.95;

// Middle-age cunning growth (+0.001/year, ages 40-60) is applied in drives.ts tickAgentAge.
// Represents accumulated experience and learned indirection over a lifetime.

const ACUITY_SCALE_MIN = 0.5;
const ACUITY_SCALE_MAX = 1.5;

const TRAIT_KEYS: Array<keyof Traits> = [
  'curiosity',
  'courage',
  'nobility',
  'cunning',
  'endurance',
  'attraction',
  'aggression',
  'acuity',
];

// Fire skill grows when agents successfully start or maintain fire —
// that OutcomeType will be added when shelter/fire actions are built.
//
// ============================================================
// HELPERS
// ============================================================

function acuityScale(acuity: number): number {
  return ACUITY_SCALE_MIN + acuity * (ACUITY_SCALE_MAX - ACUITY_SCALE_MIN);
}

function clampTrait(value: number): number {
  return Math.max(TRAIT_MIN, Math.min(TRAIT_MAX, value));
}

function clampSkill(value: number): number {
  return Math.max(TRAIT_MIN, Math.min(TRAIT_MAX, value));
}

function scaledDelta(agent: Agent, outcome: TickOutcome, magnitude: number): number {
  return magnitude * acuityScale(agent.traits.acuity) * fatigueModifier(outcome.fatigueAtTime);
}

function applyTraitDelta(
  agent: Agent,
  outcome: TickOutcome,
  trait: keyof Traits,
  magnitude: number,
): void {
  agent.traits[trait] = clampTrait(agent.traits[trait] + scaledDelta(agent, outcome, magnitude));
}

function applySkillDelta(
  agent: Agent,
  outcome: TickOutcome,
  skill: keyof Skills,
  magnitude: number,
): void {
  agent.skills[skill] = clampSkill(agent.skills[skill] + scaledDelta(agent, outcome, magnitude));
}

// ============================================================
// THRESHOLD DETECTION
// ============================================================

export function snapshotTraits(agent: Agent): Traits {
  return { ...agent.traits };
}

export function getTraitThresholdCrossings(
  _agentId: string,
  traitsBefore: Traits,
  traitsAfter: Traits,
): Array<{ trait: keyof Traits; level: 'significant' | 'peak' }> {
  const crossings: Array<{ trait: keyof Traits; level: 'significant' | 'peak' }> = [];

  for (const trait of TRAIT_KEYS) {
    const before = traitsBefore[trait];
    const after = traitsAfter[trait];

    if (before < SIGNIFICANCE_PEAK && after >= SIGNIFICANCE_PEAK) {
      crossings.push({ trait, level: 'peak' });
    } else if (before < SIGNIFICANCE_THRESHOLD && after >= SIGNIFICANCE_THRESHOLD) {
      crossings.push({ trait, level: 'significant' });
    }
  }

  return crossings;
}

// ============================================================
// OUTCOME HANDLERS
// ============================================================

function applyHarvested(agent: Agent, outcome: TickOutcome): void {
  if (outcome.success) {
    applyTraitDelta(agent, outcome, 'endurance', MICRO);
    applySkillDelta(agent, outcome, 'gathering', SMALL);
  } else {
    applyTraitDelta(agent, outcome, 'cunning', MICRO);
    applySkillDelta(agent, outcome, 'gathering', MICRO);
  }
}

function applyHunted(agent: Agent, outcome: TickOutcome): void {
  if (outcome.success) {
    applyTraitDelta(agent, outcome, 'endurance', MICRO);
    applySkillDelta(agent, outcome, 'hunting', SMALL);
  } else {
    applyTraitDelta(agent, outcome, 'cunning', MICRO);
    applySkillDelta(agent, outcome, 'hunting', MICRO);
  }
}

function applyFished(agent: Agent, outcome: TickOutcome): void {
  applyHarvested(agent, outcome);
}

function applyExplored(agent: Agent, outcome: TickOutcome): void {
  if (outcome.success) {
    applyTraitDelta(agent, outcome, 'curiosity', SMALL);
    applyTraitDelta(agent, outcome, 'courage', MICRO);
    applyTraitDelta(agent, outcome, 'endurance', MICRO);
  } else {
    applyTraitDelta(agent, outcome, 'cunning', MICRO);
  }
}

function applyStoodGround(agent: Agent, outcome: TickOutcome): void {
  const courageMagnitude = outcome.fearAtTime > 0.7 ? LARGE : MEDIUM;
  applyTraitDelta(agent, outcome, 'courage', courageMagnitude);
  applyTraitDelta(agent, outcome, 'endurance', SMALL);
}

function applyInteracted(agent: Agent, outcome: TickOutcome): void {
  if (outcome.success) {
    applyTraitDelta(agent, outcome, 'attraction', MICRO);
  } else {
    applyTraitDelta(agent, outcome, 'cunning', MICRO);
  }
}

function applyHelped(agent: Agent, outcome: TickOutcome): void {
  if (outcome.success) {
    const nobilityMagnitude = outcome.fearAtTime > 0.5 ? LARGE : MEDIUM;
    applyTraitDelta(agent, outcome, 'nobility', nobilityMagnitude);
    applyTraitDelta(agent, outcome, 'endurance', MICRO);
    applySkillDelta(agent, outcome, 'healing', SMALL);
  } else {
    applyTraitDelta(agent, outcome, 'nobility', SMALL);
    applySkillDelta(agent, outcome, 'healing', MICRO);
  }
}

function applyConflicted(agent: Agent, outcome: TickOutcome): void {
  applyTraitDelta(agent, outcome, 'aggression', SMALL);
  if (outcome.success) {
    applyTraitDelta(agent, outcome, 'cunning', MICRO);
  } else {
    applyTraitDelta(agent, outcome, 'endurance', SMALL);
  }
  applySkillDelta(agent, outcome, 'hunting', MICRO);
}

function applyConflictResolved(agent: Agent, outcome: TickOutcome): void {
  if (outcome.conflictWon === true) {
    applyTraitDelta(agent, outcome, 'courage', SMALL);
    applyTraitDelta(agent, outcome, 'cunning', SMALL);
  } else if (outcome.conflictWon === false) {
    applyTraitDelta(agent, outcome, 'endurance', MEDIUM);
    applyTraitDelta(agent, outcome, 'aggression', -MICRO);
  } else {
    applyTraitDelta(agent, outcome, 'cunning', SMALL);
    applyTraitDelta(agent, outcome, 'endurance', SMALL);
  }
}

function applyMaintained(agent: Agent, outcome: TickOutcome): void {
  applyTraitDelta(agent, outcome, 'endurance', MICRO);
  if (outcome.success) {
    applySkillDelta(agent, outcome, 'building', SMALL);
  } else {
    applySkillDelta(agent, outcome, 'building', MICRO);
  }
}

function applyFoundRuin(agent: Agent, outcome: TickOutcome): void {
  const curiosityMagnitude = outcome.fearAtTime > 0.5 ? LARGE : MEDIUM;
  applyTraitDelta(agent, outcome, 'curiosity', curiosityMagnitude);
  applyTraitDelta(agent, outcome, 'courage', SMALL);
}

function applyFoundArtifact(agent: Agent, outcome: TickOutcome): void {
  applyTraitDelta(agent, outcome, 'curiosity', LARGE);
  applyTraitDelta(agent, outcome, 'acuity', SMALL);
  if (outcome.fearAtTime > 0.5) {
    applyTraitDelta(agent, outcome, 'courage', SMALL);
  }
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function applyTraitOutcome(agent: Agent, outcome: TickOutcome): void {
  switch (outcome.type) {
    case OutcomeType.Harvested:
      applyHarvested(agent, outcome);
      break;

    case OutcomeType.Hunted:
      applyHunted(agent, outcome);
      break;

    case OutcomeType.Fished:
      applyFished(agent, outcome);
      break;

    case OutcomeType.DrankWater:
    case OutcomeType.AteSomething:
    case OutcomeType.Rested:
      break;

    case OutcomeType.ChoppedWood:
      // Felling and hauling timber is how the `building` skill is honed ashore
      // (previously only trained by maintaining the vessel at sea).
      applyTraitDelta(agent, outcome, 'endurance', MICRO);
      if (outcome.success) applySkillDelta(agent, outcome, 'building', SMALL);
      break;

    case OutcomeType.Built:
      // Raising a shelter is the purest expression of the building craft.
      applyTraitDelta(agent, outcome, 'endurance', MICRO);
      if (outcome.success) applySkillDelta(agent, outcome, 'building', MEDIUM);
      break;

    case OutcomeType.TendedFire:
      // Coaxing and feeding the hearth hones the long-dormant fire skill.
      if (outcome.success) applySkillDelta(agent, outcome, 'fire', SMALL);
      break;

    case OutcomeType.Wandered:
      applyTraitDelta(agent, outcome, 'curiosity', MICRO);
      break;

    case OutcomeType.Explored:
      applyExplored(agent, outcome);
      break;

    case OutcomeType.Fled:
      applyTraitDelta(agent, outcome, 'courage', -SMALL);
      applyTraitDelta(agent, outcome, 'endurance', MICRO);
      break;

    case OutcomeType.StoodGround:
      applyStoodGround(agent, outcome);
      break;

    case OutcomeType.Interacted:
      applyInteracted(agent, outcome);
      break;

    case OutcomeType.Helped:
      applyHelped(agent, outcome);
      break;

    case OutcomeType.Conflicted:
      applyConflicted(agent, outcome);
      break;

    case OutcomeType.ConflictResolved:
      applyConflictResolved(agent, outcome);
      break;

    case OutcomeType.Maintained:
      applyMaintained(agent, outcome);
      break;

    case OutcomeType.Steered:
      applyTraitDelta(agent, outcome, 'acuity', MICRO);
      applyTraitDelta(agent, outcome, 'endurance', MICRO);
      break;

    case OutcomeType.FoundResource:
      applyTraitDelta(agent, outcome, 'curiosity', SMALL);
      applyTraitDelta(agent, outcome, 'acuity', MICRO);
      applySkillDelta(agent, outcome, 'gathering', MICRO);
      break;

    case OutcomeType.FoundRuin:
      applyFoundRuin(agent, outcome);
      break;

    case OutcomeType.FoundArtifact:
      applyFoundArtifact(agent, outcome);
      break;
  }
}
