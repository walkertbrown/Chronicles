// simulation/source/source.ts
// The source — the contested device beyond the ruins.
//
// A single fixed location whose `control` needle is dragged by the bonded souls
// standing near it: light-bonded toward +1 (the Unbound — a golden age that
// breeds its own shadow), dark-bonded toward -1 (the old gods the founders fled —
// tyranny spreads). The needle never settles; the contest IS the world's central
// conflict. Dormant and disguised until a bonded pilgrim reaches it, which the
// simulation never forces.

import type { SimEvent, WorldState } from '@shared/types.js';
import { EventType } from '@shared/types.js';
import { manhattanDistance } from '../world/tiles.js';

// ============================================================
// CONSTANTS
// ============================================================

const PRESENCE_RADIUS = 14;        // bonded souls within this drag the needle
const SHIFT_RATE = 0.015;          // control change per unit of presence imbalance per tick
const UNATTENDED_DECAY = 0.0015;   // with no one near, the needle drifts back toward dormant

// |control| at/above this counts as "awake" — the door is open to one side.
export const SOURCE_AWAKE_THRESHOLD = 0.15;

// Ongoing effects, applied per tick and scaled by |control| (so a barely-open
// source barely matters, a fully-held one matters a lot). All deliberately small
// per-tick nudges — they only ever fire once a bond exists and a pilgrim arrives.
const LIGHT_HEAL = 0.0010;         // golden age: the band recovers/thrives
const LIGHT_SHADOW_AMBITION = 0.0004; // …but flourishing breeds ambition — the shadow rises
const DARK_FEAR = 0.0010;          // tyranny: dread spreads
const DARK_AGGRESSION = 0.0008;    // …and the will to dominate

// ============================================================
// HELPERS
// ============================================================

function clampControl(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function sourceStateLabel(control: number): 'dormant' | 'light' | 'dark' {
  if (control >= SOURCE_AWAKE_THRESHOLD) return 'light';
  if (control <= -SOURCE_AWAKE_THRESHOLD) return 'dark';
  return 'dormant';
}

// ============================================================
// EFFECTS
// ============================================================

// While the source is held, what flows through it touches the living. Light is a
// golden age that breeds its own shadow (it does NOT pacify — a peace gift would
// end the story); dark is the return of the old tyranny.
function applySourceEffects(state: WorldState, control: number): void {
  if (Math.abs(control) < SOURCE_AWAKE_THRESHOLD) return; // dormant — nothing flows

  for (const agent of state.agents) {
    if (!agent.alive) continue;
    if (control > 0) {
      // Golden age: bodies mend and spirits lift…
      agent.healthScore = clamp01(agent.healthScore + LIGHT_HEAL * control);
      agent.drives.grief = clamp01(agent.drives.grief - LIGHT_HEAL * control);
      // …but the brighter the light, the sharper the shadow: ambition rises, so
      // the conditions for a dark turn grow even in a flourishing world.
      agent.traits.aggression = clamp01(agent.traits.aggression + LIGHT_SHADOW_AMBITION * control);
    } else {
      // The old gods press back through: dread and the will to dominate spread.
      const mag = -control;
      agent.drives.fear = clamp01(agent.drives.fear + DARK_FEAR * mag);
      agent.traits.aggression = clamp01(agent.traits.aggression + DARK_AGGRESSION * mag);
    }
  }
}

// ============================================================
// EVENTS
// ============================================================

function makeSourceEvent(
  state: WorldState,
  kind: 'light' | 'dark',
  moment: 'awakened' | 'shifted',
): SimEvent {
  const { x, y } = state.source.position;
  const type = moment === 'awakened' ? EventType.SourceAwakened : EventType.SourceShifted;

  let description: string;
  if (moment === 'awakened') {
    description =
      kind === 'light'
        ? 'Far beyond the ruins, the old device woke. A warm light spilled from a doorway that had always looked like ruin — held open, for now, the way the Unbound left it.'
        : 'Far beyond the ruins, something woke that should have stayed asleep. A cold breath came through a doorway in the old stone — the gods the people crossed the sea to escape, pressing at the threshold.';
  } else {
    description =
      kind === 'light'
        ? 'The threshold beyond the ruins turned toward the light again; the cold drew back. For now.'
        : 'The threshold beyond the ruins turned cold; something old and hungry pressed back through. For now.';
  }

  return {
    id: `source_${moment}_${state.tick}`,
    tick: state.tick,
    day: state.day,
    type,
    involvedAgents: [],
    location: { x, y },
    description,
    narrativeWeight: moment === 'awakened' ? 0.98 : 0.95,
    threadRelevant: [],
  };
}

// ============================================================
// TICK
// ============================================================

// Called once per tick. Updates the source's control from nearby bonded presence,
// applies its ongoing effects, and returns any climactic events (first opening,
// or a flip light↔dark) for the caller to append to the event log.
export function tickSource(state: WorldState): SimEvent[] {
  const src = state.source;
  const { x, y } = src.position;

  let light = 0;
  let dark = 0;
  for (const agent of state.agents) {
    if (!agent.alive || agent.conduitBondType === null) continue;
    if (manhattanDistance(x, y, agent.position.x, agent.position.y) > PRESENCE_RADIUS) continue;
    const weight = 1 + agent.significanceScore; // stronger souls pull the needle harder
    if (agent.conduitBondType === 'light') light += weight;
    else dark += weight;
  }

  const prev = src.control;
  if (light > 0 || dark > 0) {
    src.control = clampControl(src.control + SHIFT_RATE * (light - dark));
  } else if (src.control > 0) {
    src.control = Math.max(0, src.control - UNATTENDED_DECAY);
  } else if (src.control < 0) {
    src.control = Math.min(0, src.control + UNATTENDED_DECAY);
  }

  applySourceEffects(state, src.control);

  const events: SimEvent[] = [];
  const wasAwake = Math.abs(prev) >= SOURCE_AWAKE_THRESHOLD;
  const isAwake = Math.abs(src.control) >= SOURCE_AWAKE_THRESHOLD;

  if (!wasAwake && isAwake) {
    events.push(makeSourceEvent(state, src.control > 0 ? 'light' : 'dark', 'awakened'));
  } else if (wasAwake && isAwake && Math.sign(prev) !== Math.sign(src.control)) {
    events.push(makeSourceEvent(state, src.control > 0 ? 'light' : 'dark', 'shifted'));
  }

  return events;
}
