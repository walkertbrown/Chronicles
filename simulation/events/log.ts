// simulation/events/log.ts
// Utilities for creating, appending, and querying the simulation event log.

import type { Agent, SimEvent, WorldState } from '@shared/types.js';
import { EventType } from '@shared/types.js';

// ============================================================
// CONSTANTS
// ============================================================

const MAX_EVENT_LOG_SIZE = 500;
const MAX_AGENT_RECENT_EVENTS = 20;

const NARRATIVE_WEIGHTS: Record<EventType, number> = {
  [EventType.Death]: 0.95,
  [EventType.Birth]: 0.85,
  [EventType.Conflict]: 0.6,
  [EventType.Resolution]: 0.55,
  [EventType.Discovery]: 0.7,
  [EventType.BondFormed]: 0.8,
  [EventType.BondBroken]: 0.75,
  [EventType.CompanionApproach]: 0.65,
  [EventType.CompanionBond]: 0.9,
  [EventType.ArtifactFound]: 0.8,
  [EventType.ArtifactImprinted]: 0.88,
  [EventType.TraitThreshold]: 0.72,
  [EventType.Migration]: 0.92,
  [EventType.ResourceCrisis]: 0.68,
  [EventType.IllnessBegan]: 0.62,
  [EventType.IllnessRecovered]: 0.45,
  [EventType.ConduitSighting]: 0.35,
  [EventType.ConduitBondLight]: 0.92,
  [EventType.ConduitBondDark]: 0.95,
  [EventType.ConduitBondBroken]: 0.75,
  [EventType.SourceAwakened]: 0.98,   // the door beyond the ruins opens — the largest beat there is
  [EventType.SourceShifted]: 0.95,    // control of the source flips light↔dark
  [EventType.Conception]: 0.55,       // a pair bond conceives — quiet but chronicle-worthy
};

// ============================================================
// EVENT FACTORY
// ============================================================

export function createEvent(
  state: WorldState,
  type: EventType,
  involvedAgents: string[],
  location: { x: number; y: number },
  description: string,
  threadRelevant: string[],
  narrativeWeightOverride?: number,
): SimEvent {
  const primaryAgent = involvedAgents[0] ?? 'none';

  return {
    id: `event_${state.worldId}_${state.tick}_${type}_${primaryAgent}`,
    tick: state.tick,
    day: state.day,
    type,
    involvedAgents,
    location,
    description,
    narrativeWeight: narrativeWeightOverride ?? NARRATIVE_WEIGHTS[type],
    threadRelevant,
  };
}

// ============================================================
// APPEND
// ============================================================

export function appendEvent(state: WorldState, event: SimEvent): void {
  state.eventLog.push(event);

  if (state.eventLog.length > MAX_EVENT_LOG_SIZE) {
    state.eventLog = state.eventLog.slice(-MAX_EVENT_LOG_SIZE);
  }

  for (const agentId of event.involvedAgents) {
    const agent = state.agents.find((candidate) => candidate.id === agentId);
    if (agent === undefined) continue;

    agent.recentEvents.push(event);

    if (agent.recentEvents.length > MAX_AGENT_RECENT_EVENTS) {
      agent.recentEvents = agent.recentEvents.slice(-MAX_AGENT_RECENT_EVENTS);
    }
  }
}

export function logEvent(
  state: WorldState,
  type: EventType,
  involvedAgents: string[],
  location: { x: number; y: number },
  description: string,
  threadRelevant: string[],
  narrativeWeightOverride?: number,
): SimEvent {
  const event = createEvent(
    state,
    type,
    involvedAgents,
    location,
    description,
    threadRelevant,
    narrativeWeightOverride,
  );
  appendEvent(state, event);
  return event;
}

// ============================================================
// QUERY HELPERS
// ============================================================

function isWithinTicks(event: SimEvent, state: WorldState, withinTicks: number): boolean {
  return state.tick - event.tick <= withinTicks;
}

export function getRecentEventsByType(
  state: WorldState,
  type: EventType,
  withinTicks: number,
): SimEvent[] {
  const results: SimEvent[] = [];

  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (!isWithinTicks(event, state, withinTicks)) break;
    if (event.type === type) {
      results.push(event);
    }
  }

  return results;
}

export function getRecentEventsForAgent(
  state: WorldState,
  agentId: string,
  withinTicks: number,
): SimEvent[] {
  const results: SimEvent[] = [];

  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (!isWithinTicks(event, state, withinTicks)) break;
    if (event.involvedAgents.includes(agentId)) {
      results.push(event);
    }
  }

  return results;
}

export function getSignificantRecentEvents(
  state: WorldState,
  minNarrativeWeight: number,
  withinTicks: number,
): SimEvent[] {
  const results: SimEvent[] = [];

  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (!isWithinTicks(event, state, withinTicks)) break;
    if (event.narrativeWeight >= minNarrativeWeight) {
      results.push(event);
    }
  }

  return results;
}

export function getLastEventForAgent(
  state: WorldState,
  agentId: string,
  type: EventType,
): SimEvent | undefined {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (event.type === type && event.involvedAgents.includes(agentId)) {
      return event;
    }
  }

  return undefined;
}

// ============================================================
// CONVENIENCE LOGGERS
// ============================================================

export function logDeathEvent(
  state: WorldState,
  agent: Agent,
  cause: 'starvation' | 'age' | 'illness' | 'animal',
): SimEvent {
  const fullName = `${agent.name} ${agent.familyName}`;
  let description: string;

  switch (cause) {
    case 'starvation':
      description = `${fullName} died of starvation. Age ${agent.age}. Had not eaten in days.`;
      break;
    case 'illness':
      description = `${fullName} died of illness. Age ${agent.age}. Had been sick for days.`;
      break;
    case 'animal':
      description = `${fullName} was killed by an animal while hunting. Age ${agent.age}.`;
      break;
    case 'age':
      description = `${fullName} died. Age ${agent.age}. The body gave out.`;
      break;
  }

  return logEvent(
    state,
    EventType.Death,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    description,
    [agent.familyName],
  );
}

export function logBirthEvent(
  state: WorldState,
  child: Agent,
  motherId: string,
  fatherId: string,
): SimEvent {
  return logEvent(
    state,
    EventType.Birth,
    [child.id, motherId, fatherId],
    { x: child.position.x, y: child.position.y },
    `${child.name} ${child.familyName} was born.`,
    [child.familyName],
  );
}

export function logTraitThresholdEvent(
  state: WorldState,
  agent: Agent,
  trait: string,
  level: 'significant' | 'peak',
): SimEvent {
  return logEvent(
    state,
    EventType.TraitThreshold,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    `${agent.name} ${agent.familyName}'s ${trait} reached ${level} levels.`,
    [agent.familyName],
    level === 'peak' ? 0.88 : 0.72,
  );
}

export function logIllnessEvent(
  state: WorldState,
  agent: Agent,
  began: boolean,
): SimEvent {
  const type = began ? EventType.IllnessBegan : EventType.IllnessRecovered;
  const description = began
    ? `${agent.name} ${agent.familyName} fell ill.`
    : `${agent.name} ${agent.familyName} recovered from illness.`;

  return logEvent(
    state,
    type,
    [agent.id],
    { x: agent.position.x, y: agent.position.y },
    description,
    [agent.familyName],
  );
}

export function logConceptionEvent(
  state: WorldState,
  mother: Agent,
  father: Agent,
): SimEvent {
  return logEvent(
    state,
    EventType.Conception,
    [mother.id, father.id],
    { x: mother.position.x, y: mother.position.y },
    `${mother.name} ${mother.familyName} is with child.`,
    [mother.familyName],
  );
}
