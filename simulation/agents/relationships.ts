// simulation/agents/relationships.ts
// Creates, reads, and updates relationship state between agent pairs.

import type { Agent, Relationship } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';

// ============================================================
// CONSTANTS
// ============================================================

const TRUST_MIN = -1.0;
const TRUST_MAX = 1.0;

const BASELINE_TRUST_MIN = 0.1;
const BASELINE_TRUST_MAX = 0.2;
const ELEVATED_TRUST_MIN = 0.3;
const ELEVATED_TRUST_MAX = 0.5;
const HELMSMAN_TRUST_MIN = 0.2;
const HELMSMAN_TRUST_MAX = 0.35;

const TRUST_MICRO = 0.005;
const TRUST_SMALL = 0.015;
const TRUST_MEDIUM = 0.03;
const TRUST_LARGE = 0.06;

const PAIR_BOND_THRESHOLD = 0.65;
const KIN_BOND_THRESHOLD = 0.4;
const RIVAL_BOND_THRESHOLD = -0.4;

const PAIR_BOND_MIN_INTERACTIONS = 20;
const KIN_BOND_MIN_INTERACTIONS = 5;
const RIVAL_BOND_MIN_INTERACTIONS = 8;

const SOCIAL_RESTORE_AT_ZERO_TRUST = 0.02;
const SOCIAL_RESTORE_AT_MAX_TRUST = 0.08;

// ============================================================
// HELPERS
// ============================================================

function clampTrust(value: number): number {
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, value));
}

function resolveBondType(
  agentA: Agent,
  agentB: Agent,
  relationship: Relationship,
): BondType {
  const { trust, interactionCount, bond } = relationship;

  if (
    trust <= RIVAL_BOND_THRESHOLD &&
    interactionCount >= RIVAL_BOND_MIN_INTERACTIONS
  ) {
    return BondType.Rival;
  }

  if (
    agentA.familyName === agentB.familyName &&
    trust >= KIN_BOND_THRESHOLD &&
    interactionCount >= KIN_BOND_MIN_INTERACTIONS
  ) {
    return BondType.Kin;
  }

  if (
    trust >= PAIR_BOND_THRESHOLD &&
    interactionCount >= PAIR_BOND_MIN_INTERACTIONS
  ) {
    return BondType.Pair;
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
        updateTrust(agentA, agentB, TRUST_SMALL, currentTick);
      } else {
        updateTrust(agentA, agentB, -TRUST_MICRO, currentTick);
      }
      return;

    case OutcomeType.Helped:
      if (outcome.success) {
        updateTrust(agentA, agentB, TRUST_LARGE, currentTick);
      } else {
        updateTrust(agentA, agentB, TRUST_SMALL, currentTick);
      }
      return;

    case OutcomeType.Conflicted:
      updateTrust(agentA, agentB, -TRUST_SMALL, currentTick);
      return;

    case OutcomeType.ConflictResolved:
      if (outcome.conflictWon === true) {
        applyTrustDeltaOneWay(agentB, agentA.id, -TRUST_MEDIUM, currentTick, 0);
        applyTrustDeltaOneWay(agentA, agentB.id, 0, currentTick, 0);
      } else if (outcome.conflictWon === false) {
        applyTrustDeltaOneWay(agentA, agentB.id, -TRUST_MICRO, currentTick, 0);
        applyTrustDeltaOneWay(agentB, agentA.id, 0, currentTick, 0);
      } else {
        updateTrust(agentA, agentB, -TRUST_MICRO, currentTick);
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
    SOCIAL_RESTORE_AT_ZERO_TRUST +
    trust * (SOCIAL_RESTORE_AT_MAX_TRUST - SOCIAL_RESTORE_AT_ZERO_TRUST)
  );
}
