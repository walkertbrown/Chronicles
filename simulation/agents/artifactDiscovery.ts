// simulation/agents/artifactDiscovery.ts
// Scattered-artifact discovery — the everyday-life counterpart to the ruin
// cluster's artifact finds. A handful of artifacts are seeded onto ordinary,
// already-reachable Plain/Forest tiles in the populated band (see
// world/tileCache.ts's scatterAnchors); this hook is what lets an agent
// standing on one of those tiles actually notice it, no special expedition
// or foray required.
//
// Evaluated once per living agent per tick (see tick.ts's per-agent loop) —
// covers every action type (forage, migration trek, ordinary wandering,
// exploring, fleeing) since it runs independent of which action the agent
// took that tick.
//
// Ruin-tile discovery is out of scope here on purpose: the ruin cluster keeps
// its own (unrelated) discovery path, and this hook bails before touching
// rng() if the agent's tile is a Ruin tile.

import type { Agent, WorldState } from '@shared/types.js';
import { EventType, Terrain } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import { logEvent } from '../events/log.js';
import { getTile, markTileDirty } from '../world/tiles.js';

// Tunable via the wind-tunnel harness's --set/--sweep registry, same pattern
// as MIGRATION_CONSTANTS/RELATIONSHIP_CONSTANTS/etc.
export const SCATTERED_ARTIFACT_CONSTANTS = {
  SCATTERED_ARTIFACT_BASE_CHANCE: 0.25, // multiplied by curiosity (0-1 trait)
};

function scatteredArtifactOutcome(agent: Agent): TickOutcome {
  return {
    type: OutcomeType.FoundArtifact,
    success: true,
    partial: false,
    involvedAgentId: null,
    fatigueAtTime: agent.drives.fatigue,
    fearAtTime: agent.drives.fear,
    conflictWon: null,
    amountGained: null,
  };
}

export function checkScatteredArtifactDiscovery(
  agent: Agent,
  state: WorldState,
  rng: () => number,
): TickOutcome | undefined {
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  if (tile === undefined) return undefined;
  if (tile.terrain === Terrain.Ruin) return undefined; // ruin discovery stays expedition-exclusive

  const artifact = tile.artifacts.find((item) => !item.discovered);
  if (artifact === undefined) return undefined;

  // Everything above this line must never draw from rng() — determinism
  // requires the roll below to be the ONLY draw this hook ever makes, and
  // only on ticks where a genuine undiscovered artifact is actually underfoot.
  const roll = rng();
  const threshold = SCATTERED_ARTIFACT_CONSTANTS.SCATTERED_ARTIFACT_BASE_CHANCE * agent.traits.curiosity;
  if (roll >= threshold) return undefined;

  artifact.discovered = true;
  markTileDirty(state.tiles, agent.position.x, agent.position.y);

  const descriptor = artifact.descriptor ?? 'something old and made';
  logEvent(
    state,
    EventType.ArtifactFound,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    `${agent.name} ${agent.familyName} found ${descriptor} in the tall grass.`,
    [agent.familyName],
  );

  return scatteredArtifactOutcome(agent);
}
