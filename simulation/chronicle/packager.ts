// simulation/chronicle/packager.ts
// Assembles structured state for each active chronicle thread.
// Only what changed, only what matters — feeds the prompt builder.

import type { Agent, SimEvent, TileCache, WorldState, WorldTile } from '@shared/types.js';
import { EventType, Terrain } from '@shared/types.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR, isStarving, starvationUrgency } from '../agents/drives.js';
import { isSick, illnessSeverity } from '../agents/illness.js';
import { getTopAgentsBySignificance } from '../agents/significance.js';
import { getRecentEventsForAgent, getSignificantRecentEvents } from '../events/log.js';
import { COAST_ROW } from '../world/generator.js';
import { getTile, getTilesInRange, manhattanDistance } from '../world/tiles.js';

// ============================================================
// TYPES
// ============================================================

export interface SupportingCharacter {
  id: string;
  name: string;
  fullName: string;
  role: string;
  trust: number;
  bond: string;
  recentActivity: string;
  isAlive: boolean;
  isSick: boolean;
  isStarving: boolean;
  notableTraits: Array<{ name: string; value: number }>;
  recentSharedEvents: string[];
}

export interface WorldContext {
  day: number;
  year: number;
  season: string;
  alivePopulation: number;
  deadSinceYesterday: string[];
  newlyIll: string[];
  recovered: string[];
  conflicts: string[];
  recentWorldEvents: Array<{ tick: number; description: string; weight: number }>;
  groupLocation: string;
  // Conduit sightings/bonds anywhere in the world this window — surfaced as
  // ambient background regardless of whose thread it touched or its weight, so
  // readers learn the luminous watchers exist the moment anyone first sees one.
  conduitPresence: string[];
}

export interface ThreadPackage {
  familyName: string;
  previousDayProse: string;
  primaryAgent: {
    id: string;
    name: string;
    fullName: string;
    role: string;
    age: number;
    alive: boolean;
    generation: number;
    gender: string;

    activeDrives: Array<{ name: string; value: number; label: string }>;
    notableTraits: Array<{ name: string; value: number }>;
    recentTraitCrossings: string[];

    recentEvents: Array<{ id: string; tick: number; description: string; weight: number }>;
    currentLocation: string;
    surroundingTerrain: string;
    nearbyAgentCount: number;

    isStarving: boolean;
    isSick: boolean;
    hungerNarrative: string;
    sicknessNarrative: string;
    healthNarrative: string;

    companionProximityNarrative: string;
    companionBonded: boolean;
    conduitBondType: 'light' | 'dark' | null;
    conduitEvents: Array<{ tick: number; description: string; weight: number; type: EventType }>;
    pregnancyNarrative: string;
  };
  supportingCast: SupportingCharacter[];
  worldContext: WorldContext;
}

// ============================================================
// CONSTANTS
// ============================================================

const CONDUIT_EVENT_TYPES = new Set<EventType>([
  EventType.ConduitSighting,
  EventType.ConduitBondLight,
  EventType.ConduitBondDark,
  EventType.ConduitBondBroken,
  EventType.ArtifactImprinted,
]);
const PRIMARY_TRAIT_THRESHOLD = 0.65;
const SUPPORTING_TRAIT_THRESHOLD = 0.7;
const EVENT_RECENCY_WINDOW = 96;
const MAX_PRIMARY_EVENTS = 20;
const MAX_SUPPORTING_CAST = 6;
const MAX_SHARED_EVENTS = 3;
const WORLD_EVENT_MIN_WEIGHT = 0.65;
const MAX_WORLD_EVENTS = 8;
const MAX_CONDUIT_PRESENCE = 4;   // ambient watcher lines surfaced per page
const WORLD_EVENT_WINDOW = TICKS_PER_DAY * 2;
const NEARBY_AGENT_RADIUS = 5;
const SUPPORTING_PROXIMITY_RADIUS = 10;
const SURROUNDING_TERRAIN_RADIUS = 3;

const DRIVE_KEYS = [
  'hunger',
  'fatigue',
  'fear',
  'socialNeed',
  'grief',
  'longing',
] as const;

const TRAIT_KEYS = [
  'curiosity',
  'courage',
  'nobility',
  'cunning',
  'endurance',
  'attraction',
  'aggression',
  'acuity',
] as const;

const TERRAIN_LABELS: Record<Terrain, string> = {
  [Terrain.Plain]: 'open plain',
  [Terrain.Forest]: 'forest',
  [Terrain.River]: 'river bank',
  [Terrain.Mountain]: 'mountains',
  [Terrain.Coast]: 'coast',
  [Terrain.Ruin]: 'ruins',
  [Terrain.Vessel]: 'the beached vessel',
};

const CARDINALS: Array<{ dx: number; dy: number; label: string }> = [
  { dx: 0, dy: -1, label: 'north' },
  { dx: 0, dy: 1, label: 'south' },
  { dx: -1, dy: 0, label: 'west' },
  { dx: 1, dy: 0, label: 'east' },
];

// ============================================================
// HELPERS
// ============================================================

function aliveAgents(state: WorldState): Agent[] {
  return state.agents.filter((agent) => agent.alive);
}

function aliveCount(state: WorldState): number {
  return aliveAgents(state).length;
}

function findAgent(state: WorldState, agentId: string): Agent | undefined {
  return state.agents.find((agent) => agent.id === agentId);
}

function fullName(agent: Agent): string {
  return `${agent.name} ${agent.familyName}`;
}

function eventsSinceTick(state: WorldState, withinTicks: number): SimEvent[] {
  const results: SimEvent[] = [];
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (state.tick - event.tick > withinTicks) break;
    results.push(event);
  }
  return results;
}

function lookupPreviousDayProse(state: WorldState, familyName: string): string {
  for (let i = state.chroniclePages.length - 1; i >= 0; i--) {
    const entry = state.chroniclePages[i];
    if (entry === undefined) continue;

    const thread = entry.threads.find((t) => t.familyName === familyName);
    if (thread !== undefined) {
      return thread.prose;
    }
  }
  return '';
}

function driveLabel(name: string, value: number): string {
  switch (name) {
    case 'hunger':
      if (value >= 0.8) return 'starving';
      if (value >= 0.5) return 'hungry';
      return 'somewhat hungry';
    case 'fatigue':
      if (value >= 0.7) return 'exhausted';
      if (value >= 0.5) return 'weary';
      return 'tired';
    case 'fear':
      if (value >= 0.6) return 'frightened';
      if (value >= 0.4) return 'uneasy';
      return 'watchful';
    case 'grief':
      if (value >= 0.5) return 'grieving';
      return 'sorrowful';
    case 'longing':
      if (value >= 0.4) return 'lonely';
      return 'restless';
    case 'socialNeed':
      if (value >= 0.5) return 'isolated';
      return 'restless for company';
    default:
      return name;
  }
}

function collectActiveDrives(
  agent: Agent,
): Array<{ name: string; value: number; label: string }> {
  const drives: Array<{ name: string; value: number; label: string }> = [];
  for (const key of DRIVE_KEYS) {
    const value = agent.drives[key];
    if (value > DRIVE_INCLUDE_THRESHOLD) {
      drives.push({ name: key, value, label: driveLabel(key, value) });
    }
  }
  return drives.sort((a, b) => b.value - a.value);
}

function collectNotableTraits(
  agent: Agent,
  threshold: number,
): Array<{ name: string; value: number }> {
  const traits: Array<{ name: string; value: number }> = [];
  for (const key of TRAIT_KEYS) {
    const value = agent.traits[key];
    if (value > threshold) {
      traits.push({ name: key, value });
    }
  }
  return traits.sort((a, b) => b.value - a.value);
}

function terrainPlainEnglish(terrain: Terrain | undefined): string {
  if (terrain === undefined) return 'unknown ground';
  return TERRAIN_LABELS[terrain] ?? terrain;
}

function currentLocationLabel(state: WorldState, agent: Agent): string {
  const tile = getTile(state.tiles, agent.position.x, agent.position.y);
  return terrainPlainEnglish(tile?.terrain);
}

function describeSurroundingTerrain(state: WorldState, agent: Agent): string {
  const nearby = getTilesInRange(
    state.tiles,
    agent.position.x,
    agent.position.y,
    SURROUNDING_TERRAIN_RADIUS,
  );
  const center = getTile(state.tiles, agent.position.x, agent.position.y);
  const tiles = center !== undefined ? [center, ...nearby] : nearby;

  const counts = new Map<Terrain, number>();
  for (const tile of tiles) {
    counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
  }

  let dominant: Terrain | undefined;
  let dominantCount = 0;
  for (const [terrain, count] of counts) {
    if (count > dominantCount) {
      dominant = terrain;
      dominantCount = count;
    }
  }

  const dominantLabel = terrainPlainEnglish(dominant);
  const hasRiver = tiles.some((tile) => tile.terrain === Terrain.River);
  const hasForest = tiles.some((tile) => tile.terrain === Terrain.Forest);
  const hasCoast = tiles.some((tile) => tile.terrain === Terrain.Coast);
  const hasPlain = tiles.some((tile) => tile.terrain === Terrain.Plain);

  if (dominant === Terrain.Forest && hasRiver) {
    const riverDir = findDirectionToTerrain(
      state.tiles,
      agent.position.x,
      agent.position.y,
      Terrain.River,
      SURROUNDING_TERRAIN_RADIUS,
    );
    return riverDir
      ? `dense forest with a river to the ${riverDir}`
      : 'dense forest near a river';
  }

  if (dominant === Terrain.Coast && hasPlain) {
    return 'open coast with plains inland';
  }

  if (hasForest && hasPlain) {
    return `mixed ${dominantLabel} and open ground`;
  }

  if (hasCoast && agent.position.y >= COAST_ROW - 2) {
    return 'near the coast';
  }

  return dominantLabel;
}

function findDirectionToTerrain(
  tiles: TileCache,
  x: number,
  y: number,
  terrain: Terrain,
  radius: number,
): string | undefined {
  for (const { dx, dy, label } of CARDINALS) {
    for (let step = 1; step <= radius; step++) {
      const tile = getTile(tiles, x + dx * step, y + dy * step);
      if (tile?.terrain === terrain) return label;
    }
  }
  return undefined;
}

function countNearbyAgents(state: WorldState, agent: Agent, radius: number): number {
  return aliveAgents(state).filter(
    (other) =>
      other.id !== agent.id &&
      manhattanDistance(
        agent.position.x,
        agent.position.y,
        other.position.x,
        other.position.y,
      ) <= radius,
  ).length;
}

function daysSinceAte(agent: Agent, state: WorldState): number {
  if (agent.lastAteAtTick === null) {
    return Math.round((state.tick / TICKS_PER_DAY) * 10) / 10;
  }
  const ticksSince = state.tick - agent.lastAteAtTick;
  return Math.round((ticksSince / TICKS_PER_DAY) * 10) / 10;
}

function describeHungerState(agent: Agent, state: WorldState): string {
  const days = daysSinceAte(agent, state);
  const hunger = agent.drives.hunger;

  if (hunger < 0.3) return '';
  if (days < 0.5) return '';

  if (hunger >= 0.95 && agent.starvationTick !== null) {
    const urgency = starvationUrgency(agent, state.tick);
    if (urgency > 0.7) return `Has not eaten in ${days} days. Dying.`;
    if (urgency > 0.3) return `Has not eaten in ${days} days. The body fails.`;
    return `Has not eaten in ${days} days. Starving.`;
  }

  if (days >= 3) return `Has not eaten in ${days} days.`;
  if (days >= 1) return `Has not eaten since yesterday.`;
  if (hunger >= 0.6) return 'Hungry. Has not eaten today.';
  return '';
}

function describeSicknessState(agent: Agent, state: WorldState): string {
  if (!isSick(agent) || agent.illnessState === null) return '';
  const days = Math.max(
    1,
    Math.round((state.tick - agent.illnessState.contractedAtTick) / TICKS_PER_DAY),
  );
  const severity = illnessSeverity(agent);
  if (severity > 0.7) return `Severely ill for ${days} day${days === 1 ? '' : 's'}.`;
  if (severity > 0.4) return `Ill for ${days} day${days === 1 ? '' : 's'}.`;
  return `Mildly ill for ${days} day${days === 1 ? '' : 's'}.`;
}

function describeHealthState(agent: Agent): string {
  if (agent.healthScore > 0.85) return '';
  if (agent.healthScore > 0.6) return 'Health declining.';
  if (agent.healthScore > 0.3) return 'Seriously weakened.';
  return 'Near death from age or illness.';
}

// GESTATION_TICKS mirrors the constant in gestation.ts (0.75 × TICKS_PER_YEAR = 1080).
// Kept local so packager.ts has no circular dependency on births/gestation.
const PACKAGER_GESTATION_TICKS = Math.round(0.75 * TICKS_PER_YEAR); // 1080

function describePregnancyState(agent: Agent, state: WorldState): string {
  if (agent.pregnancy === null) return '';
  const elapsed = state.tick - agent.pregnancy.conceivedTick;
  if (elapsed < PACKAGER_GESTATION_TICKS / 2) {
    return 'With child.';
  }
  return 'Heavy with child — her time draws near.';
}

function describeConduitProximity(totalTicks: number): string {
  if (totalTicks <= 0) return '';

  if (totalTicks < TICKS_PER_DAY) {
    return 'A Conduit has been seen near this person today.';
  }

  const days = Math.floor(totalTicks / TICKS_PER_DAY);
  if (days === 1) {
    return 'A Conduit has lingered near this person for a day.';
  }

  return `A Conduit has lingered near this person for ${days} days.`;
}

function getConduitProximityTicks(state: WorldState, agentId: string): number {
  let maxTicks = 0;
  for (const conduit of state.conduits) {
    const record = conduit.agentProximityHistory.find((entry) => entry.agentId === agentId);
    if (record !== undefined && record.totalTicks > maxTicks) {
      maxTicks = record.totalTicks;
    }
  }
  return maxTicks;
}

function collectConduitEvents(
  state: WorldState,
  agentId: string,
  eventWindow: number,
): Array<{ tick: number; description: string; weight: number; type: EventType }> {
  return eventsSinceTick(state, eventWindow)
    .filter(
      (event) =>
        CONDUIT_EVENT_TYPES.has(event.type) &&
        event.involvedAgents.includes(agentId),
    )
    .map((event) => ({
      tick: event.tick,
      description: event.description,
      weight:
        event.type === EventType.ConduitSighting
          ? event.narrativeWeight
          : Math.max(event.narrativeWeight, 0.9),
      type: event.type,
    }))
    .sort((a, b) => b.tick - a.tick);
}

const DRIVE_INCLUDE_THRESHOLD = 0.15;

function collectRecentEvents(
  state: WorldState,
  agent: Agent,
  eventWindow: number,
): Array<{ id: string; tick: number; description: string; weight: number }> {
  return getRecentEventsForAgent(state, agent.id, eventWindow)
    .map((event) => ({
      id: event.id,
      tick: event.tick,
      description: event.description,
      weight: event.narrativeWeight,
    }))
    .sort((a, b) => b.tick - a.tick)
    .slice(0, MAX_PRIMARY_EVENTS);
}

function collectTraitCrossings(
  events: Array<{ description: string; tick: number }>,
  state: WorldState,
): string[] {
  const crossings: string[] = [];
  for (const event of events) {
    const logEvent = state.eventLog.find(
      (e) => e.tick === event.tick && e.description === event.description,
    );
    if (logEvent?.type === EventType.TraitThreshold) {
      crossings.push(event.description);
    }
  }
  return crossings;
}

function sharedEventsBetween(
  state: WorldState,
  agentAId: string,
  agentBId: string,
  withinTicks: number,
): string[] {
  const results: string[] = [];
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (state.tick - event.tick > withinTicks) break;
    if (
      event.involvedAgents.includes(agentAId) &&
      event.involvedAgents.includes(agentBId)
    ) {
      results.push(event.description);
    }
  }
  return results.slice(0, MAX_SHARED_EVENTS);
}

function describeRecentActivity(state: WorldState, agent: Agent): string {
  const name = fullName(agent);
  const location = currentLocationLabel(state, agent);
  const drives = collectActiveDrives(agent);
  const topDrive = drives[0];

  const recent = getRecentEventsForAgent(state, agent.id, TICKS_PER_DAY);
  const latest = recent[0];

  if (isSick(agent)) {
    const days =
      agent.illnessState !== null
        ? Math.max(
            1,
            Math.round((state.tick - agent.illnessState.contractedAtTick) / TICKS_PER_DAY),
          )
        : 1;
    return `${name} fell ill ${days} day${days === 1 ? '' : 's'} ago and has not recovered`;
  }

  if (isStarving(agent)) {
    return `${name} is starving and finds no food`;
  }

  if (latest !== undefined) {
    return `${name}: ${latest.description}`;
  }

  if (topDrive !== undefined) {
    return `${name} is ${topDrive.label} and remains near the ${location}`;
  }

  return `${name} remains near the ${location}`;
}

function supportingCastScore(
  state: WorldState,
  primary: Agent,
  other: Agent,
  rel: Agent['relationships'][number],
  eventWindow: number,
): number {
  const distance = manhattanDistance(
    primary.position.x,
    primary.position.y,
    other.position.x,
    other.position.y,
  );

  const trustScore = Math.abs(rel.trust) * 0.3;
  const sharedCount = sharedEventsBetween(
    state,
    primary.id,
    other.id,
    eventWindow,
  ).length;
  const sharedScore = Math.min(1, sharedCount / 3) * 0.25;
  const distressScore =
    isSick(other) || isStarving(other) || other.drives.grief > 0.5 ? 0.2 : 0;
  const familyScore = other.familyName === primary.familyName ? 0.15 : 0;
  const proximityScore =
    distance <= SUPPORTING_PROXIMITY_RADIUS
      ? ((SUPPORTING_PROXIMITY_RADIUS - distance) / SUPPORTING_PROXIMITY_RADIUS) * 0.2
      : 0;

  return trustScore + sharedScore + distressScore + familyScore + proximityScore;
}

function buildSupportingCast(
  state: WorldState,
  primary: Agent,
  eventWindow: number,
): SupportingCharacter[] {
  const candidates: Array<{ agent: Agent; rel: Agent['relationships'][number]; score: number }> =
    [];

  for (const rel of primary.relationships) {
    const other = findAgent(state, rel.agentId);
    if (other === undefined || other.id === primary.id) continue;

    candidates.push({
      agent: other,
      rel,
      score: supportingCastScore(state, primary, other, rel, eventWindow),
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUPPORTING_CAST)
    .map(({ agent, rel }) => ({
      id: agent.id,
      name: agent.name,
      fullName: fullName(agent),
      role: agent.foundingHistory?.role ?? 'unknown',
      trust: rel.trust,
      bond: rel.bond,
      recentActivity: describeRecentActivity(state, agent),
      isAlive: agent.alive,
      isSick: isSick(agent),
      isStarving: isStarving(agent),
      notableTraits: collectNotableTraits(agent, SUPPORTING_TRAIT_THRESHOLD),
      recentSharedEvents: sharedEventsBetween(
        state,
        primary.id,
        agent.id,
        eventWindow,
      ),
    }));
}

function namesFromDeathEvents(state: WorldState, eventWindow: number): string[] {
  return eventsSinceTick(state, eventWindow)
    .filter((event) => event.type === EventType.Death)
    .flatMap((event) =>
      event.involvedAgents
        .map((id) => findAgent(state, id))
        .filter((agent): agent is Agent => agent !== undefined)
        .map(fullName),
    );
}

function namesFromNewlyIll(state: WorldState, eventWindow: number): string[] {
  return aliveAgents(state)
    .filter(
      (agent) =>
        agent.illnessState !== null &&
        state.tick - agent.illnessState.contractedAtTick <= eventWindow,
    )
    .map(fullName);
}

function namesFromRecovered(state: WorldState, eventWindow: number): string[] {
  return eventsSinceTick(state, eventWindow)
    .filter((event) => event.type === EventType.IllnessRecovered)
    .flatMap((event) =>
      event.involvedAgents
        .map((id) => findAgent(state, id))
        .filter((agent): agent is Agent => agent !== undefined)
        .map(fullName),
    );
}

function collectConflicts(state: WorldState, eventWindow: number): string[] {
  return eventsSinceTick(state, eventWindow)
    .filter((event) => event.type === EventType.Conflict)
    .map((event) => event.description);
}

// Every Conduit sighting/bond event in the window, world-wide — NOT filtered by
// thread membership or narrative weight (the way per-character conduitEvents and
// recentWorldEvents are). This is the channel that guarantees the watchers reach
// the page as ambient color even when only a minor settler glimpsed one.
function collectConduitPresence(state: WorldState, eventWindow: number): string[] {
  return eventsSinceTick(state, eventWindow)
    .filter((event) => CONDUIT_EVENT_TYPES.has(event.type))
    .map((event) => event.description)
    .slice(0, MAX_CONDUIT_PRESENCE);
}

function collectRecentWorldEvents(
  state: WorldState,
  eventWindow: number,
): Array<{ tick: number; description: string; weight: number }> {
  return getSignificantRecentEvents(state, WORLD_EVENT_MIN_WEIGHT, eventWindow)
    .slice(0, MAX_WORLD_EVENTS)
    .map((event) => ({
      tick: event.tick,
      description: event.description,
      weight: event.narrativeWeight,
    }));
}

function describeGroupLocation(state: WorldState): string {
  const occupancy = new Map<string, { tile: WorldTile; count: number }>();

  for (const agent of aliveAgents(state)) {
    const tile = getTile(state.tiles, agent.position.x, agent.position.y);
    if (tile === undefined) continue;

    const key = `${tile.x}_${tile.y}`;
    const existing = occupancy.get(key);
    if (existing === undefined) {
      occupancy.set(key, { tile, count: 1 });
    } else {
      existing.count++;
    }
  }

  let best: { tile: WorldTile; count: number } | undefined;
  for (const entry of occupancy.values()) {
    if (best === undefined || entry.count > best.count) {
      best = entry;
    }
  }

  if (best === undefined) {
    return 'the camp is scattered and thin';
  }

  const terrain = terrainPlainEnglish(best.tile.terrain);
  const y = best.tile.y;
  const coastDistance = COAST_ROW - y;

  if (coastDistance <= 0) {
    return `most of the people are gathered on the ${terrain}, at the water's edge`;
  }
  if (coastDistance <= 3) {
    return `most of the people are gathered on the ${terrain}, near the coast`;
  }
  if (coastDistance >= 15) {
    return `most of the people are gathered on the ${terrain}, far inland from the coast`;
  }
  return `most of the people are gathered on the ${terrain}, inland from the coast`;
}

function buildWorldContext(state: WorldState, eventWindow: number): WorldContext {
  return {
    day: state.day,
    year: state.year,
    season: state.season,
    alivePopulation: aliveCount(state),
    deadSinceYesterday: namesFromDeathEvents(state, eventWindow),
    newlyIll: namesFromNewlyIll(state, eventWindow),
    recovered: namesFromRecovered(state, eventWindow),
    conflicts: collectConflicts(state, eventWindow),
    recentWorldEvents: collectRecentWorldEvents(state, eventWindow),
    conduitPresence: collectConduitPresence(state, eventWindow),
    groupLocation: describeGroupLocation(state),
  };
}

function packThread(
  state: WorldState,
  agent: Agent,
  worldContext: WorldContext,
  eventWindow: number,
): ThreadPackage {
  const recentEvents = collectRecentEvents(state, agent, eventWindow);

  return {
    familyName: agent.familyName,
    previousDayProse: lookupPreviousDayProse(state, agent.familyName),
    primaryAgent: {
      id: agent.id,
      name: agent.name,
      fullName: fullName(agent),
      role: agent.foundingHistory?.role ?? 'unknown',
      age: agent.age,
      alive: agent.alive,
      generation: agent.generation,
      gender: agent.gender,
      activeDrives: collectActiveDrives(agent),
      notableTraits: collectNotableTraits(agent, PRIMARY_TRAIT_THRESHOLD),
      recentTraitCrossings: collectTraitCrossings(recentEvents, state),
      recentEvents,
      currentLocation: currentLocationLabel(state, agent),
      surroundingTerrain: describeSurroundingTerrain(state, agent),
      nearbyAgentCount: countNearbyAgents(state, agent, NEARBY_AGENT_RADIUS),
      isStarving: isStarving(agent),
      isSick: isSick(agent),
      hungerNarrative: describeHungerState(agent, state),
      sicknessNarrative: describeSicknessState(agent, state),
      healthNarrative: describeHealthState(agent),
      pregnancyNarrative: describePregnancyState(agent, state),
      companionProximityNarrative: describeConduitProximity(
        getConduitProximityTicks(state, agent.id),
      ),
      companionBonded: agent.conduitId !== null,
      conduitBondType: agent.conduitBondType,
      conduitEvents: collectConduitEvents(state, agent.id, eventWindow),
    },
    supportingCast: buildSupportingCast(state, agent, eventWindow),
    worldContext,
  };
}

// ============================================================
// MAIN EXPORT
// ============================================================

export function packThreads(state: WorldState): ThreadPackage[] {
  const ticksSinceLastChronicle = state.lastChronicleGeneratedAt === null
    ? state.tick
    : Math.min(state.tick, TICKS_PER_DAY * 6);
  const worldContext = buildWorldContext(state, ticksSinceLastChronicle);
  const threadAgents = state.agents.filter((agent) => agent.chronicleThreadActive);
  const packages = threadAgents.map((agent) =>
    packThread(state, agent, worldContext, ticksSinceLastChronicle),
  );

  const significanceOrder = getTopAgentsBySignificance(state, threadAgents.length).map(
    (agent) => agent.id,
  );
  const orderIndex = new Map(significanceOrder.map((id, index) => [id, index]));

  return packages.sort(
    (a, b) =>
      (orderIndex.get(a.primaryAgent.id) ?? Infinity) -
      (orderIndex.get(b.primaryAgent.id) ?? Infinity),
  );
}

// ============================================================
// CAMEOS — others featured briefly, without becoming full threads
// ============================================================

export interface Cameo {
  name: string;
  familyName: string;
  reason: 'contender' | 'fading' | 'event';
  note: string; // the moment or state worth a glimpse
}

const MAX_CAMEOS = 3;
const CAMEO_CHALLENGE_MIN = 0.25; // a rising contender becomes visible once momentum passes this
const CAMEO_EVENT_WEIGHT = 0.7;   // a non-lead in an event this notable earns a one-off cameo

// Non-lead agents worth a brief appearance this page: someone a big moment just
// happened to (event), a rising figure contesting a thread (contender), or a
// superseded former lead still receding from view (fading). Keeps the two-thread
// focus while ensuring the cast turns over and no one vanishes the instant they
// lose their thread.
export function packCameos(state: WorldState): Cameo[] {
  const eventWindow =
    state.lastChronicleGeneratedAt === null ? state.tick : Math.min(state.tick, TICKS_PER_DAY * 6);

  const cameos: Cameo[] = [];
  for (const agent of state.agents) {
    if (!agent.alive || agent.chronicleThreadActive) continue;

    const events = getRecentEventsForAgent(state, agent.id, eventWindow);
    const top = events.reduce<SimEvent | undefined>(
      (best, e) => (best === undefined || e.narrativeWeight > best.narrativeWeight ? e : best),
      undefined,
    );

    let reason: Cameo['reason'] | null = null;
    if (top !== undefined && top.narrativeWeight >= CAMEO_EVENT_WEIGHT) reason = 'event';
    else if (agent.chronicleChallenge >= CAMEO_CHALLENGE_MIN) reason = 'contender';
    else if (agent.chronicleFade > 0) reason = 'fading';
    if (reason === null) continue;

    const note =
      reason === 'event' && top !== undefined
        ? top.description
        : (top?.description ?? agent.currentAction ?? 'present at the edges of the camp');
    cameos.push({ name: agent.name, familyName: agent.familyName, reason, note });
  }

  const priority: Record<Cameo['reason'], number> = { event: 0, contender: 1, fading: 2 };
  cameos.sort((a, b) => priority[a.reason] - priority[b.reason]);
  return cameos.slice(0, MAX_CAMEOS);
}
