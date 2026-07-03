// simulation/agents/relationships.ts
// Creates, reads, and updates relationship state between agent pairs.

import type { Agent, Relationship } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';

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
    interactionCount >= RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS
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
