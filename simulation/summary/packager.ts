import type { Agent, SimEvent, WorldState } from '@shared/types.js';
import { EventType } from '@shared/types.js';
import { getTopAgentsBySignificance } from '../agents/significance.js';
import { isSick } from '../agents/illness.js';
import { isStarving, TICKS_PER_DAY } from '../agents/drives.js';

export interface AgentSummary {
  name: string;
  role: string;
  action: string;           // currentAction or fallback description
  driveContext: string;     // hunger/grief/fear/illness layer — empty string if nothing notable
  interactions: string[];   // names of other agents involved in current action
  isThreaded: boolean;
}

export interface SummaryPackage {
  day: number;
  year: number;
  season: string;
  population: number;
  agentsToWatch: AgentSummary[];
  recentDeaths: string[];
  recentConflicts: string[];
  dominantTension: string;
}

const SUMMARY_EVENT_WINDOW = TICKS_PER_DAY * 2;
const CANDIDATE_POOL = 8;   // pull top 8 by significance, deduplicate down to 3–5
const MIN_AGENTS = 3;
const MAX_AGENTS = 5;

// Rough action category from currentAction text — used to deduplicate
function actionCategory(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('fish') || a.includes('shallows') || a.includes('water') && a.includes('catch')) return 'fishing';
  if (a.includes('gather') || a.includes('forag') || a.includes('grass') || a.includes('root')) return 'gathering';
  if (a.includes('hunt') || a.includes('track') || a.includes('animal')) return 'hunting';
  if (a.includes('rest') || a.includes('sleep')) return 'resting';
  if (a.includes('walk') || a.includes('move') || a.includes('travel') || a.includes('head')) return 'moving';
  if (a.includes('talk') || a.includes('speak') || a.includes('convers')) return 'talking';
  if (a.includes('build') || a.includes('construct') || a.includes('shelter')) return 'building';
  if (a.includes('watch') || a.includes('observe') || a.includes('look')) return 'watching';
  if (a.includes('conflict') || a.includes('fight') || a.includes('attack')) return 'conflict';
  return action.slice(0, 30); // fallback: first 30 chars as its own category
}

function driveContext(agent: Agent): string {
  const parts: string[] = [];
  if (isStarving(agent)) parts.push('starving');
  else if (agent.drives.hunger > 0.6) parts.push('hungry');
  if (isSick(agent)) parts.push('ill');
  if (agent.drives.grief > 0.6) parts.push('grieving');
  if (agent.drives.fear > 0.6) parts.push('frightened');
  return parts.join(', ');
}

// Extract other agent names mentioned in currentAction
function extractInteractions(action: string, allAgents: Agent[]): string[] {
  const found: string[] = [];
  for (const other of allAgents) {
    if (!other.alive) continue;
    const fullName = `${other.name} ${other.familyName}`;
    if (action.includes(other.name) || action.includes(fullName)) {
      found.push(fullName);
    }
  }
  return found;
}

function buildAgentSummary(agent: Agent, allAgents: Agent[]): AgentSummary {
  const action = agent.currentAction ?? 'present at camp';
  return {
    name: `${agent.name} ${agent.familyName}`,
    role: agent.foundingHistory?.role ?? 'unknown',
    action,
    driveContext: driveContext(agent),
    interactions: extractInteractions(action, allAgents),
    isThreaded: agent.chronicleThreadActive,
  };
}

function selectAgents(candidates: Agent[], allAgents: Agent[]): AgentSummary[] {
  const selected: AgentSummary[] = [];
  const usedCategories = new Set<string>();

  for (const agent of candidates) {
    if (selected.length >= MAX_AGENTS) break;
    const action = agent.currentAction ?? 'present at camp';
    const cat = actionCategory(action);

    // Always include up to MIN_AGENTS regardless of category overlap
    if (selected.length < MIN_AGENTS || !usedCategories.has(cat)) {
      selected.push(buildAgentSummary(agent, allAgents));
      usedCategories.add(cat);
    }
  }

  return selected;
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
  const candidates = getTopAgentsBySignificance(state, CANDIDATE_POOL);
  const recentEvents = recentEventsSince(state, SUMMARY_EVENT_WINDOW);

  // Cap at 10 most-recent each: in a deadly world a 2-day window can accumulate
  // many deaths/conflicts and balloon the summary payload.
  const recentDeaths = recentEvents
    .filter((e) => e.type === EventType.Death)
    .map((e) => e.description)
    .slice(-10);

  const recentConflicts = recentEvents
    .filter((e) => e.type === EventType.Conflict)
    .map((e) => e.description)
    .slice(-10);

  return {
    day: state.day,
    year: state.year,
    season: state.season,
    population: state.agents.filter((a) => a.alive).length,
    agentsToWatch: selectAgents(candidates, state.agents),
    recentDeaths,
    recentConflicts,
    dominantTension: describeDominantTension(state),
  };
}
