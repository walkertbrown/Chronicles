// simulation/agents/relationships.ts
// Creates, reads, and updates relationship state between agent pairs.

import type { Agent, Relationship, WorldState } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import { mayBondAsMates } from './maturity.js';

// ============================================================
// CONSTANTS
//
// Tuning knobs (thresholds, interaction minimums, trust deltas) are grouped
// into one exported, mutable object so the wind-tunnel harness
// (simulation/harness/) can override them before a run — e.g.
// `RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS = 6` — without hand-
// editing this file. Defaults below are unchanged from before this refactor;
// see the determinism check in the commit that introduced this object.
// ============================================================

export const RELATIONSHIP_CONSTANTS = {
  TRUST_MIN: -1.0,
  TRUST_MAX: 1.0,

  TRUST_MICRO: 0.005,
  TRUST_SMALL: 0.015,
  TRUST_MEDIUM: 0.03,
  TRUST_LARGE: 0.06,

  PAIR_BOND_THRESHOLD: 0.7,
  KIN_BOND_THRESHOLD: 0.4,
  RIVAL_BOND_THRESHOLD: -0.4,

  PAIR_BOND_MIN_INTERACTIONS: 8,
  KIN_BOND_MIN_INTERACTIONS: 5,
  RIVAL_BOND_MIN_INTERACTIONS: 8,

  SOCIAL_RESTORE_AT_ZERO_TRUST: 0.02,
  SOCIAL_RESTORE_AT_MAX_TRUST: 0.08,
};

// These three pairs (BASELINE/ELEVATED/HELMSMAN _TRUST_MIN/MAX) are defined
// but never referenced anywhere in the codebase (verified by repo-wide grep) —
// pre-existing dead code, left untouched; out of scope for this extraction.
const BASELINE_TRUST_MIN = 0.1;
const BASELINE_TRUST_MAX = 0.2;
const ELEVATED_TRUST_MIN = 0.3;
const ELEVATED_TRUST_MAX = 0.5;
const HELMSMAN_TRUST_MIN = 0.2;
const HELMSMAN_TRUST_MAX = 0.35;

// ============================================================
// HELPERS
// ============================================================

function clampTrust(value: number): number {
  return Math.max(RELATIONSHIP_CONSTANTS.TRUST_MIN, Math.min(RELATIONSHIP_CONSTANTS.TRUST_MAX, value));
}

function resolveBondType(
  agentA: Agent,
  agentB: Agent,
  relationship: Relationship,
): BondType {
  const { trust, interactionCount, bond } = relationship;

  if (
    trust <= RELATIONSHIP_CONSTANTS.RIVAL_BOND_THRESHOLD &&
    interactionCount >= RELATIONSHIP_CONSTANTS.RIVAL_BOND_MIN_INTERACTIONS
  ) {
    return BondType.Rival;
  }

  if (
    agentA.familyName === agentB.familyName &&
    trust >= RELATIONSHIP_CONSTANTS.KIN_BOND_THRESHOLD &&
    interactionCount >= RELATIONSHIP_CONSTANTS.KIN_BOND_MIN_INTERACTIONS
  ) {
    return BondType.Kin;
  }

  if (
    trust >= RELATIONSHIP_CONSTANTS.PAIR_BOND_THRESHOLD &&
    interactionCount >= RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS &&
    // Both must be grown. Trust and familiarity alone used to promote any two
    // agents to mates, which bonded six-year-olds to each other and a
    // fifty-four-year-old to a ten-year-old. Because the bond below is
    // exclusive, each of those removed two people from the breeding population.
    mayBondAsMates(agentA, agentB)
  ) {
    // One-mate exclusivity: neither agent may already hold a Pair bond with a
    // DIFFERENT partner. If either does, we fall through rather than promote —
    // the existing pair persists, and the current relationship stays as-is.
    // Once a pair dissolves (drops to None) the agent is freed to bond again.
    const agentAHasOtherPair = agentA.relationships.some(
      (r) => r.bond === BondType.Pair && r.agentId !== agentB.id,
    );
    const agentBHasOtherPair = agentB.relationships.some(
      (r) => r.bond === BondType.Pair && r.agentId !== agentA.id,
    );
    if (!agentAHasOtherPair && !agentBHasOtherPair) {
      return BondType.Pair;
    }
  }

  if (bond === BondType.Pair || bond === BondType.Kin || bond === BondType.Rival) {
    return BondType.None;
  }

  return bond;
}

/**
 * Dissolve every mating bond that involves someone too young, on both sides.
 *
 * The age gate in resolveBondType stops NEW underage pairings, but it only
 * fires when the two agents interact again — and the pairs already written
 * into the live checkpoint had drifted as far as 142 tiles apart, so they may
 * never meet to have the bond re-evaluated. Meanwhile the bond goes on
 * consuming both partners' one-mate exclusivity slot and keeping two people
 * out of the breeding population for good.
 *
 * Dropping to None is the same outcome resolveBondType produces for a pair
 * that no longer qualifies, so nothing downstream sees a novel state. Trust
 * and interaction history are left alone: these people still know each other.
 *
 * Idempotent — a second run finds nothing to do.
 */
export function dissolveUnderageMateBonds(state: WorldState): number {
  const byId = new Map(state.agents.map((agent) => [agent.id, agent]));
  let dissolved = 0;

  for (const agent of state.agents) {
    for (const rel of agent.relationships) {
      if (rel.bond !== BondType.Pair) continue;
      const partner = byId.get(rel.agentId);
      if (partner === undefined) continue;
      if (mayBondAsMates(agent, partner)) continue;
      rel.bond = BondType.None;
      dissolved += 1;
    }
  }

  return dissolved;
}

/**
 * Releases one survivor's mate bond when their partner dies.
 *
 * One-mate exclusivity (resolveBondType) asks only whether a Pair bond EXISTS,
 * never whether the partner is still breathing — so a widow or widower kept the
 * bond forever and could never take another mate. Nothing cleared it: death set
 * alive = false and applyDeathRipples added grief, but the relationship record
 * stayed Pair for the rest of the survivor's life.
 *
 * In a camp with only a handful of women of child-bearing age, one bereavement
 * permanently removed one of them from the breeding population. That is a bug,
 * not mourning: grief is a drive, and it already spikes and decays on its own.
 *
 * Trust and interaction history are left intact — they loved this person, and
 * the chronicle still has the death. Only the exclusive claim is lifted, and it
 * is lifted at once: a mourning period would need state we do not keep.
 *
 * Returns true if a bond was actually released.
 */
export function releaseMateBondOnDeath(survivor: Agent, deadAgentId: string): boolean {
  const rel = survivor.relationships.find(
    (r) => r.agentId === deadAgentId && r.bond === BondType.Pair,
  );
  if (rel === undefined) return false;
  rel.bond = BondType.None;
  return true;
}

/**
 * One-time repair for checkpoints written before releaseMateBondOnDeath existed,
 * where survivors are still holding Pair bonds to the long dead. Same shape and
 * same reasoning as dissolveUnderageMateBonds above.
 *
 * Idempotent — a second run finds nothing to do.
 */
export function dissolveBondsToTheDead(state: WorldState): number {
  const byId = new Map(state.agents.map((agent) => [agent.id, agent]));
  let dissolved = 0;

  for (const agent of state.agents) {
    if (!agent.alive) continue;
    for (const rel of agent.relationships) {
      if (rel.bond !== BondType.Pair) continue;
      const partner = byId.get(rel.agentId);
      if (partner === undefined) continue; // partner gone from the roster entirely
      if (partner.alive) continue;
      rel.bond = BondType.None;
      dissolved += 1;
    }
  }

  return dissolved;
}

function applyTrustDeltaOneWay(
  from: Agent,
  toId: string,
  delta: number,
  currentTick: number,
  initialTrust: number,
): Relationship {
  const relationship = getOrCreateRelationship(from, toId, initialTrust);
  relationship.trust = clampTrust(relationship.trust + delta);
  relationship.interactionCount += 1;
  relationship.lastInteractionTick = currentTick;
  return relationship;
}

function syncBondTypes(agentA: Agent, agentB: Agent, bond: BondType): void {
  const relA = getRelationship(agentA, agentB.id);
  const relB = getRelationship(agentB, agentA.id);
  if (relA !== undefined) relA.bond = bond;
  if (relB !== undefined) relB.bond = bond;
}

// ============================================================
// CORE RELATIONSHIP FUNCTIONS
// ============================================================

export function getRelationship(
  agent: Agent,
  targetId: string,
): Relationship | undefined {
  return agent.relationships.find((rel) => rel.agentId === targetId);
}

export function createRelationship(
  targetId: string,
  trust: number,
  bond: BondType,
): Relationship {
  return {
    agentId: targetId,
    trust: clampTrust(trust),
    bond,
    interactionCount: 0,
    lastInteractionTick: 0,
  };
}

export function getOrCreateRelationship(
  agent: Agent,
  targetId: string,
  initialTrust: number,
): Relationship {
  const existing = getRelationship(agent, targetId);
  if (existing !== undefined) return existing;

  const relationship = createRelationship(targetId, initialTrust, BondType.None);
  agent.relationships.push(relationship);
  return relationship;
}

export function evaluateBondType(
  agentA: Agent,
  agentB: Agent,
  relationship: Relationship,
): void {
  const bond = resolveBondType(agentA, agentB, relationship);
  syncBondTypes(agentA, agentB, bond);
}

export function updateTrust(
  agentA: Agent,
  agentB: Agent,
  delta: number,
  currentTick: number,
): void {
  const initialTrust = 0;
  applyTrustDeltaOneWay(agentA, agentB.id, delta, currentTick, initialTrust);
  applyTrustDeltaOneWay(agentB, agentA.id, delta, currentTick, initialTrust);

  const relA = getRelationship(agentA, agentB.id);
  if (relA !== undefined) {
    evaluateBondType(agentA, agentB, relA);
  }
}

// ============================================================
// OUTCOME-BASED TRUST UPDATES
// ============================================================

export function applyRelationshipOutcome(
  agentA: Agent,
  agentB: Agent,
  outcome: TickOutcome,
  currentTick: number,
): void {
  switch (outcome.type) {
    case OutcomeType.Interacted:
      if (outcome.success) {
        updateTrust(agentA, agentB, RELATIONSHIP_CONSTANTS.TRUST_SMALL, currentTick);
      } else {
        updateTrust(agentA, agentB, -RELATIONSHIP_CONSTANTS.TRUST_MICRO, currentTick);
      }
      return;

    case OutcomeType.Helped:
      if (outcome.success) {
        updateTrust(agentA, agentB, RELATIONSHIP_CONSTANTS.TRUST_LARGE, currentTick);
      } else {
        updateTrust(agentA, agentB, RELATIONSHIP_CONSTANTS.TRUST_SMALL, currentTick);
      }
      return;

    case OutcomeType.Conflicted:
      updateTrust(agentA, agentB, -RELATIONSHIP_CONSTANTS.TRUST_SMALL, currentTick);
      return;

    case OutcomeType.ConflictResolved:
      if (outcome.conflictWon === true) {
        applyTrustDeltaOneWay(agentB, agentA.id, -RELATIONSHIP_CONSTANTS.TRUST_MEDIUM, currentTick, 0);
        applyTrustDeltaOneWay(agentA, agentB.id, 0, currentTick, 0);
      } else if (outcome.conflictWon === false) {
        applyTrustDeltaOneWay(agentA, agentB.id, -RELATIONSHIP_CONSTANTS.TRUST_MICRO, currentTick, 0);
        applyTrustDeltaOneWay(agentB, agentA.id, 0, currentTick, 0);
      } else {
        updateTrust(agentA, agentB, -RELATIONSHIP_CONSTANTS.TRUST_MICRO, currentTick);
      }

      {
        const relA = getRelationship(agentA, agentB.id);
        if (relA !== undefined) {
          evaluateBondType(agentA, agentB, relA);
        }
      }
      return;

    default:
      return;
  }
}

// ============================================================
// SOCIAL RESTORATION
// ============================================================

export function socialRestorationValue(trust: number): number {
  if (trust < 0) return 0;
  return (
    RELATIONSHIP_CONSTANTS.SOCIAL_RESTORE_AT_ZERO_TRUST +
    trust * (RELATIONSHIP_CONSTANTS.SOCIAL_RESTORE_AT_MAX_TRUST - RELATIONSHIP_CONSTANTS.SOCIAL_RESTORE_AT_ZERO_TRUST)
  );
}

/**
 * Could these two ever become mates under resolveBondType? Both grown, not of
 * one family (same-family trust becomes Kin at 0.4, long before a Pair's 0.7),
 * and neither already paired to someone else. Longing uses this to pick who to
 * seek out — seeking anyone who fails it can only ever produce a Kin bond.
 */
export function couldBecomeMates(agentA: Agent, agentB: Agent): boolean {
  if (agentA.id === agentB.id) return false;
  if (!agentA.alive || !agentB.alive) return false;
  if (!mayBondAsMates(agentA, agentB)) return false;
  if (agentA.familyName === agentB.familyName) return false;
  const pairedElsewhere = (a: Agent, other: Agent) =>
    a.relationships.some((r) => r.bond === BondType.Pair && r.agentId !== other.id);
  return !pairedElsewhere(agentA, agentB) && !pairedElsewhere(agentB, agentA);
}
