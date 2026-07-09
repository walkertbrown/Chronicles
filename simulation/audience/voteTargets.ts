// simulation/audience/voteTargets.ts
// Pure target selection for the 5 audience-vote types. No Firebase, no rng —
// every function here is a deterministic function of the current WorldState,
// so the same world state always yields the same pinned target. That
// determinism is load-bearing: it's what makes the author step idempotent
// (see voteConsumer.ts) and keeps this feature invisible to the wind-tunnel
// harness's reproducibility model.

import type { Agent, WorldState, WorldTile } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { RELATIONSHIP_CONSTANTS } from '../agents/relationships.js';
import { isRuinRumorEligible } from '../agents/ruinExpedition.js';
import { TICKS_PER_DAY } from '../agents/drives.js';

// ============================================================
// SHARED HELPERS
// ============================================================

export function findAgent(state: WorldState, agentId: string): Agent | undefined {
  return state.agents.find((agent) => agent.id === agentId);
}

export function tileKey(x: number, y: number): string {
  return `${x}_${y}`;
}

export function parseTileKey(key: string): { x: number; y: number } {
  const parts = key.split('_');
  return { x: Number(parts[0]), y: Number(parts[1]) };
}

function pairKey(agentIdA: string, agentIdB: string): string {
  return agentIdA < agentIdB ? `${agentIdA}|${agentIdB}` : `${agentIdB}|${agentIdA}`;
}

// "Highest score, tie-break lowest id" — the shared shape of the steady,
// wanderer, and cool target selectors.
function pickBestAgent(agents: Agent[], score: (agent: Agent) => number): Agent | null {
  let best: Agent | null = null;
  let bestScore = -Infinity;
  for (const agent of agents) {
    const s = score(agent);
    if (best === null || s > bestScore || (s === bestScore && agent.id < best.id)) {
      best = agent;
      bestScore = s;
    }
  }
  return best;
}

export interface VoteTargetResult {
  targetIds: string[];
  flavorNames: string[];
}

function agentDisplayName(agent: Agent): string {
  return `${agent.name} ${agent.familyName}`;
}

// ============================================================
// 1. STEADY — highest struggleScore living agent
// ============================================================

export function struggleScore(agent: Agent): number {
  return agent.drives.hunger * 0.5 + agent.drives.fear * 0.3 + agent.drives.grief * 0.2;
}

export function selectSteadyTarget(state: WorldState): VoteTargetResult | null {
  const alive = state.agents.filter((a) => a.alive);
  const best = pickBestAgent(alive, struggleScore);
  if (best === null) return null;
  return { targetIds: [best.id], flavorNames: [agentDisplayName(best)] };
}

// ============================================================
// 2. BOND — highest-trust not-yet-paired relationship, both agents alive
// ============================================================

export function selectBondTarget(state: WorldState): VoteTargetResult | null {
  const aliveIds = new Set(state.agents.filter((a) => a.alive).map((a) => a.id));
  let bestKey: string | null = null;
  let bestTrust = -Infinity;
  let bestPair: [string, string] | null = null;

  for (const agent of state.agents) {
    if (!agent.alive) continue;
    for (const rel of agent.relationships) {
      if (rel.bond === BondType.Pair) continue;
      if (rel.interactionCount >= RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS) continue;
      if (!aliveIds.has(rel.agentId)) continue;

      const key = pairKey(agent.id, rel.agentId);
      if (
        bestPair === null ||
        rel.trust > bestTrust ||
        (rel.trust === bestTrust && key < (bestKey as string))
      ) {
        bestTrust = rel.trust;
        bestKey = key;
        bestPair = agent.id < rel.agentId ? [agent.id, rel.agentId] : [rel.agentId, agent.id];
      }
    }
  }

  if (bestPair === null) return null;
  const [aId, bId] = bestPair;
  const a = findAgent(state, aId);
  const b = findAgent(state, bId);
  if (a === undefined || b === undefined) return null;
  return { targetIds: [aId, bId], flavorNames: [agentDisplayName(a), agentDisplayName(b)] };
}

// ============================================================
// 3. WANDERER — most ruin-eligible living agent, highest curiosity
// ============================================================

export function selectWandererTarget(state: WorldState): VoteTargetResult | null {
  const eligible = state.agents.filter((a) => a.alive && isRuinRumorEligible(a));
  const best = pickBestAgent(eligible, (a) => a.traits.curiosity);
  if (best === null) return null;
  return { targetIds: [best.id], flavorNames: [agentDisplayName(best)] };
}

// ============================================================
// 4. COOL — highest-aggression recently-violent agent, else highest-
//    aggression agent with any Rival relationship
// ============================================================

const RECENT_VIOLENCE_WINDOW_TICKS = 2 * TICKS_PER_DAY;

export function selectCoolTarget(state: WorldState): VoteTargetResult | null {
  const recentlyViolent = state.agents.filter(
    (a) =>
      a.alive &&
      a.lastViolenceTick !== null &&
      state.tick - a.lastViolenceTick <= RECENT_VIOLENCE_WINDOW_TICKS,
  );
  let best = pickBestAgent(recentlyViolent, (a) => a.traits.aggression);

  if (best === null) {
    const withRival = state.agents.filter(
      (a) => a.alive && a.relationships.some((r) => r.bond === BondType.Rival),
    );
    best = pickBestAgent(withRival, (a) => a.traits.aggression);
  }

  if (best === null) return null;
  return { targetIds: [best.id], flavorNames: [agentDisplayName(best)] };
}

// ============================================================
// 5. BLESS — highest-progress mid-construction Structure
// ============================================================

export function selectBlessTarget(state: WorldState): VoteTargetResult | null {
  let best: WorldTile | null = null;

  for (const tile of state.tiles.getDirtyTiles().values()) {
    const structure = tile.structure;
    if (structure === null || !(structure.progress > 0 && structure.progress < 1)) continue;

    if (best === null) {
      best = tile;
      continue;
    }
    const bestStructure = best.structure;
    if (bestStructure === null) continue; // unreachable — best always carries a structure
    if (structure.progress > bestStructure.progress) {
      best = tile;
    } else if (
      structure.progress === bestStructure.progress &&
      (tile.x < best.x || (tile.x === best.x && tile.y < best.y))
    ) {
      best = tile;
    }
  }

  if (best === null) return null;
  return {
    targetIds: [tileKey(best.x, best.y)],
    flavorNames: [`a half-built shelter at (${best.x}, ${best.y})`],
  };
}
