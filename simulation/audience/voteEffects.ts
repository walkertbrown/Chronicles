// simulation/audience/voteEffects.ts
// The 5 audience-vote effect definitions, the fixed type-rotation-with-
// fallback logic (author step), and pinned-target re-validation (resolve
// step). Target SELECTION lives in voteTargets.ts; this file wires selection
// to mutation. No Firebase, no rng — every mutation here is an explicit,
// deterministic delta, never drawn from the sim's seeded RNG (see the
// project's audience-voting plan: rng() must not be called anywhere in this
// module, checked by simulation/scripts/voteEffectsCheck.ts).

import type { WorldState } from '@shared/types.js';
import { BondType, EventType } from '@shared/types.js';
import { logEvent } from '../events/log.js';
import { RELATIONSHIP_CONSTANTS, evaluateBondType, getRelationship } from '../agents/relationships.js';
import { beginRuinExpedition } from '../agents/ruinExpedition.js';
import { markTileDirty } from '../world/tiles.js';
import { cycleIndex } from './voteCycle.js';
import {
  findAgent,
  parseTileKey,
  selectSteadyTarget,
  selectBondTarget,
  selectWandererTarget,
  selectCoolTarget,
  selectBlessTarget,
  type VoteTargetResult,
} from './voteTargets.js';

export const TYPES = ['steady', 'bond', 'wanderer', 'cool', 'bless'] as const;
export type VoteType = (typeof TYPES)[number];

export interface VoteEffectDef {
  id: VoteType;
  label: string; // human-readable flavor for the ballot ("steady a soul")
  selectTarget(state: WorldState): VoteTargetResult | null;
  isTargetValid(state: WorldState, targetIds: string[]): boolean;
  applyEffect(state: WorldState, targetIds: string[]): void;
}

const FEAR_RELIEF = 0.08;
const AGGRESSION_RELIEF = 0.05;
const BLESS_PROGRESS = 0.10;

// ============================================================
// 1. STEADY — ease a struggling agent's fear
// ============================================================

function isSteadyValid(state: WorldState, targetIds: string[]): boolean {
  const agent = findAgent(state, targetIds[0] ?? '');
  return agent !== undefined && agent.alive;
}

function applySteady(state: WorldState, targetIds: string[]): void {
  const agent = findAgent(state, targetIds[0] ?? '');
  if (agent === undefined) return;
  agent.drives.fear = Math.max(0, agent.drives.fear - FEAR_RELIEF);
  logEvent(
    state,
    EventType.AudienceBreath,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    `${agent.name} ${agent.familyName} felt an unaccountable steadiness settle over them.`,
    [agent.familyName],
  );
}

// ============================================================
// 2. BOND — favor an unpaired relationship with trust
// ============================================================

function isBondValid(state: WorldState, targetIds: string[]): boolean {
  const a = findAgent(state, targetIds[0] ?? '');
  const b = findAgent(state, targetIds[1] ?? '');
  if (a === undefined || !a.alive || b === undefined || !b.alive) return false;
  const rel = getRelationship(a, b.id);
  return rel !== undefined && rel.bond !== BondType.Pair;
}

function applyBond(state: WorldState, targetIds: string[]): void {
  const a = findAgent(state, targetIds[0] ?? '');
  const b = findAgent(state, targetIds[1] ?? '');
  if (a === undefined || b === undefined) return;
  const relA = getRelationship(a, b.id);
  const relB = getRelationship(b, a.id);
  if (relA === undefined || relB === undefined) return;

  relA.trust = Math.min(RELATIONSHIP_CONSTANTS.TRUST_MAX, relA.trust + RELATIONSHIP_CONSTANTS.TRUST_LARGE);
  relB.trust = Math.min(RELATIONSHIP_CONSTANTS.TRUST_MAX, relB.trust + RELATIONSHIP_CONSTANTS.TRUST_LARGE);
  // Deliberately NOT incrementing interactionCount — this is a nudge to
  // existing trust, not a fabricated interaction. A promotion CAN still
  // happen here if the pair separately already has enough interactions;
  // it is never forced by the vote alone.
  evaluateBondType(a, b, relA);

  logEvent(
    state,
    EventType.AudienceBreath,
    [a.id, b.id],
    { x: a.position.x, y: a.position.y },
    `${a.name} ${a.familyName} and ${b.name} ${b.familyName} felt drawn a little closer, for no reason either could name.`,
    [a.familyName, b.familyName],
  );
}

// ============================================================
// 3. WANDERER — draw a curious agent to the ruins
// ============================================================

function isWandererValid(state: WorldState, targetIds: string[]): boolean {
  const agent = findAgent(state, targetIds[0] ?? '');
  return agent !== undefined && agent.alive;
}

function applyWanderer(state: WorldState, targetIds: string[]): void {
  const agent = findAgent(state, targetIds[0] ?? '');
  if (agent === undefined) return;
  const before = agent.ruinExpedition;
  beginRuinExpedition(agent, state);
  // beginRuinExpedition no-ops defensively if the agent picked up an active
  // expedition/migration in the meantime, or if this seed's ruin cluster has
  // no viable destination — in either case nothing actually happened, so no
  // event.
  if (before != null || agent.ruinExpedition == null) return;
  logEvent(
    state,
    EventType.AudienceBreath,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    `${agent.name} ${agent.familyName} felt a sudden, unaccountable pull toward rumor of the ruins.`,
    [agent.familyName],
  );
}

// ============================================================
// 4. COOL — ease an aggressive agent's temper
// ============================================================

function isCoolValid(state: WorldState, targetIds: string[]): boolean {
  const agent = findAgent(state, targetIds[0] ?? '');
  return agent !== undefined && agent.alive;
}

function applyCool(state: WorldState, targetIds: string[]): void {
  const agent = findAgent(state, targetIds[0] ?? '');
  if (agent === undefined) return;
  agent.traits.aggression = Math.max(0, agent.traits.aggression - AGGRESSION_RELIEF);
  logEvent(
    state,
    EventType.AudienceBreath,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    `${agent.name} ${agent.familyName} felt their temper ease, unbidden.`,
    [agent.familyName],
  );
}

// ============================================================
// 5. BLESS — advance a mid-construction structure
// ============================================================

function isBlessValid(state: WorldState, targetIds: string[]): boolean {
  const key = targetIds[0];
  if (key === undefined) return false;
  const { x, y } = parseTileKey(key);
  const tile = state.tiles.getIfCached(x, y);
  const structure = tile?.structure ?? null;
  return structure !== null && structure.progress > 0 && structure.progress < 1;
}

function applyBless(state: WorldState, targetIds: string[]): void {
  const key = targetIds[0];
  if (key === undefined) return;
  const { x, y } = parseTileKey(key);
  const tile = state.tiles.getIfCached(x, y);
  if (tile === undefined || tile.structure === null) return;

  tile.structure.progress = Math.min(1, tile.structure.progress + BLESS_PROGRESS);
  markTileDirty(state.tiles, x, y);

  const builderFamilies = [
    ...new Set(
      tile.structure.builderIds
        .map((id) => findAgent(state, id)?.familyName)
        .filter((name): name is string => name !== undefined),
    ),
  ];
  logEvent(
    state,
    EventType.AudienceBreath,
    tile.structure.builderIds,
    { x, y },
    `An unseen hand seemed to speed the work on the half-built shelter at (${x}, ${y}).`,
    builderFamilies,
  );
}

// ============================================================
// REGISTRY
// ============================================================

export const EFFECTS: Record<VoteType, VoteEffectDef> = {
  steady: {
    id: 'steady',
    label: 'steady a soul',
    selectTarget: selectSteadyTarget,
    isTargetValid: isSteadyValid,
    applyEffect: applySteady,
  },
  bond: {
    id: 'bond',
    label: 'favor a bond',
    selectTarget: selectBondTarget,
    isTargetValid: isBondValid,
    applyEffect: applyBond,
  },
  wanderer: {
    id: 'wanderer',
    label: 'draw a wanderer to the ruins',
    selectTarget: selectWandererTarget,
    isTargetValid: isWandererValid,
    applyEffect: applyWanderer,
  },
  cool: {
    id: 'cool',
    label: 'cool a conflict',
    selectTarget: selectCoolTarget,
    isTargetValid: isCoolValid,
    applyEffect: applyCool,
  },
  bless: {
    id: 'bless',
    label: 'bless a builder',
    selectTarget: selectBlessTarget,
    isTargetValid: isBlessValid,
    applyEffect: applyBless,
  },
};

// ============================================================
// ROTATION (author step) + RE-VALIDATION (resolve step)
// ============================================================

export interface PickedCycle {
  type: VoteType;
  targetIds: string[];
  flavorNames: string[];
}

// Fixed deterministic rotation: TYPES[cycleIndex(cycleId) % 5]. If the
// rotated-to type has no valid target right now, deterministically advances
// through the remaining types in fixed order until one does. 'steady' always
// has a target while anyone is alive, so this always terminates in a
// non-empty world (returns null only for a fully-dead world).
export function pickCycleType(state: WorldState, cycleId: string): PickedCycle | null {
  const length = TYPES.length;
  const startIdx = ((cycleIndex(cycleId) % length) + length) % length;
  for (let offset = 0; offset < length; offset++) {
    const type = TYPES[(startIdx + offset) % length]!;
    const target = EFFECTS[type].selectTarget(state);
    if (target !== null) {
      return { type, targetIds: target.targetIds, flavorNames: target.flavorNames };
    }
  }
  return null;
}

// Re-validates a pinned target at resolve time and applies the effect (incl.
// logging the AudienceBreath event) if still valid. Returns whether the
// effect was actually applied.
export function resolveVote(state: WorldState, type: VoteType, targetIds: string[]): boolean {
  const def = EFFECTS[type];
  if (!def.isTargetValid(state, targetIds)) return false;
  def.applyEffect(state, targetIds);
  return true;
}
