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

import type { Agent, WorldState, WorldTile } from '@shared/types.js';
import { EventType, Terrain } from '@shared/types.js';
import { OutcomeType, type TickOutcome } from './outcomes.js';
import { logEvent } from '../events/log.js';
import { getTilesInRange, markTileDirty } from '../world/tiles.js';

// Tunable via the wind-tunnel harness's --set/--sweep registry, same pattern
// as MIGRATION_CONSTANTS/RELATIONSHIP_CONSTANTS/etc.
export const SCATTERED_ARTIFACT_CONSTANTS = {
  SCATTERED_ARTIFACT_BASE_CHANCE: 0.25, // multiplied by curiosity (0-1 trait)
  // An artifact underfoot is one tile out of ~144k — a demand for an exact
  // position match made discovery unreachable in practice (a wind-tunnel run
  // with the chance pinned to 1.0 still produced ~0 finds). Noticing one a few
  // tiles off is also just truer to the fiction: it lies in the open grass.
  // Foraging already perceives at radius 6 (actions.ts FORAGE_PERCEPTION_RADIUS),
  // so a smaller radius here is well inside the established idiom.
  SCATTERED_ARTIFACT_PERCEPTION_RADIUS: 3,
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

// The nearest in-range tile carrying an undiscovered artifact, or undefined.
// Deterministic: getTilesInRange walks a fixed x-then-y order, and ties break
// on that order, so this never depends on rng() or on iteration luck.
function findNearbyArtifactTile(agent: Agent, state: WorldState): WorldTile | undefined {
  const radius = SCATTERED_ARTIFACT_CONSTANTS.SCATTERED_ARTIFACT_PERCEPTION_RADIUS;
  const inRange = getTilesInRange(state.tiles, agent.position.x, agent.position.y, radius);

  let best: WorldTile | undefined;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const tile of inRange) {
    if (tile.terrain === Terrain.Ruin) continue; // ruin discovery stays expedition-exclusive
    if (!tile.artifacts.some((item) => !item.discovered)) continue;

    const dist =
      Math.abs(tile.x - agent.position.x) + Math.abs(tile.y - agent.position.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = tile;
    }
  }

  return best;
}

export function checkScatteredArtifactDiscovery(
  agent: Agent,
  state: WorldState,
  rng: () => number,
): TickOutcome | undefined {
  const tile = findNearbyArtifactTile(agent, state);
  if (tile === undefined) return undefined;

  const artifact = tile.artifacts.find((item) => !item.discovered);
  if (artifact === undefined) return undefined; // unreachable; findNearbyArtifactTile guarantees one

  // Everything above this line must never draw from rng() — determinism
  // requires the roll below to be the ONLY draw this hook ever makes, and
  // only on ticks where a genuine undiscovered artifact is actually in view.
  const roll = rng();
  const threshold = SCATTERED_ARTIFACT_CONSTANTS.SCATTERED_ARTIFACT_BASE_CHANCE * agent.traits.curiosity;
  if (roll >= threshold) return undefined;

  artifact.discovered = true;
  markTileDirty(state.tiles, tile.x, tile.y);

  const descriptor = artifact.descriptor ?? 'something old and made';
  logEvent(
    state,
    EventType.ArtifactFound,
    [agent.id],
    { x: tile.x, y: tile.y },
    `${agent.name} ${agent.familyName} found ${descriptor} in the tall grass.`,
    [agent.familyName],
  );

  return scatteredArtifactOutcome(agent);
}
