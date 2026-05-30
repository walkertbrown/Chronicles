import type { Agent, SimEvent, WorldState } from '@shared/types.js';
import { EventType } from '@shared/types.js';
import { getTopAgentsBySignificance } from '../agents/significance.js';
import { isSick } from '../agents/illness.js';
import { isStarving, TICKS_PER_DAY } from '../agents/drives.js';

export interface SummaryPackage {
  day: number;
  year: number;
  season: string;
  population: number;
  agentsToWatch: Array<{
    name: string;
    role: string;
    state: string;
  }>;
  recentDeaths: string[];
  recentConflicts: string[];
  dominantTension: string;
}

const SUMMARY_EVENT_WINDOW = TICKS_PER_DAY * 2;
const AGENTS_TO_WATCH = 3;

function describeAgentState(agent: Agent): string {
  if (!agent.alive) return 'dead';
  if (isSick(agent)) return 'ill';
  if (isStarving(agent)) return 'starving';
  if (agent.drives.grief > 0.6) return 'grieving';
  if (agent.drives.fear > 0.6) return 'frightened';
  if (agent.drives.hunger > 0.5) return 'hungry';
  if (agent.significanceScore > 0.5) return 'significant — watch closely';
  return 'holding on';
}

function recentEventsSince(state: WorldState, withinTicks: number): SimEvent[] {
  const results: SimEvent[] = [];
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const event = state.eventLog[i];
    if (event === undefined) continue;
    if (state.tick - event.tick > withinTicks) break;
    results.push(event);
  }
  return results;
}

function describeDominantTension(state: WorldState): string {
  const alive = state.agents.filter((a) => a.alive);
  const starving = alive.filter((a) => isStarving(a)).length;
  const sick = alive.filter((a) => isSick(a)).length;
  const grieving = alive.filter((a) => a.drives.grief > 0.6).length;
  const frightened = alive.filter((a) => a.drives.fear > 0.6).length;

  if (starving > alive.length * 0.3) return `${starving} of ${alive.length} people are starving`;
  if (sick > 5) return `illness is spreading — ${sick} people are sick`;
  if (grieving > alive.length * 0.2) return `grief is moving through the group — ${grieving} people affected`;
  if (frightened > alive.length * 0.2) return `fear is high — ${frightened} people frightened`;
  if (!state.vessel.beached) return 'the vessel has not yet landed — the crossing continues';
  return 'the group is holding, for now';
}

export function packSummary(state: WorldState): SummaryPackage {
  const topAgents = getTopAgentsBySignificance(state, AGENTS_TO_WATCH);
  const recentEvents = recentEventsSince(state, SUMMARY_EVENT_WINDOW);

  const recentDeaths = recentEvents
    .filter((e) => e.type === EventType.Death)
    .map((e) => e.description);

  const recentConflicts = recentEvents
    .filter((e) => e.type === EventType.Conflict)
    .map((e) => e.description);

  return {
    day: state.day,
    year: state.year,
    season: state.season,
    population: state.agents.filter((a) => a.alive).length,
    agentsToWatch: topAgents.map((agent) => ({
      name: `${agent.name} ${agent.familyName}`,
      role: agent.foundingHistory?.role ?? 'unknown',
      state: describeAgentState(agent),
    })),
    recentDeaths,
    recentConflicts,
    dominantTension: describeDominantTension(state),
  };
}
