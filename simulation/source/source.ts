// simulation/source/source.ts
// The source — the contested device beyond the ruins.
//
// A single fixed location whose `control` needle is dragged by the bonded souls
// standing near it: light-bonded toward +1 (the Unbound — a golden age that
// breeds its own shadow), dark-bonded toward -1 (the old gods the founders fled —
// tyranny spreads). The needle never settles; the contest IS the world's central
// conflict. Dormant and disguised until a bonded pilgrim reaches it, which the
// simulation never forces.

import type { Agent, SimEvent, WorldState } from '@shared/types.js';
import { EventType } from '@shared/types.js';
import { manhattanDistance } from '../world/tiles.js';
import { CONDUIT_CONSTANTS } from '../companions/being.js';

// ============================================================
// CONSTANTS
// ============================================================

const PRESENCE_RADIUS = 14;        // bonded souls within this drag the needle
const SHIFT_RATE = 0.015;          // control change per unit of presence imbalance per tick
const UNATTENDED_DECAY = 0.0015;   // with no one near, the needle drifts back toward dormant

// Always-on drift toward 0, applied every tick regardless of presence (on top
// of, not instead of, UNATTENDED_DECAY above — the two branches are mutually
// exclusive per tick, see tickSource()). Without this, a single lone pilgrim's
// per-tick pull (SHIFT_RATE * weight, weight ~= 1.0-2.0, so 0.015-0.03/tick)
// saturates control to a bit-for-bit-frozen exact +-1.0 within about a day and
// it never moves again for the rest of the run (0 sourceFlips ever recorded in
// wind-tunnel data) — not a hard lock, just compounding one-sided presence with
// nothing pulling back. This constant is deliberately small relative to a lone
// pilgrim's pull (0.008 vs. 0.015 minimum) so it does NOT meaningfully delay
// crossing SOURCE_AWAKE_THRESHOLD (0.15) — that first crossing is dominated by
// SHIFT_RATE, not this. It only softens the slow approach to +-1.0 under
// sustained single-polarity presence, and gives an unopposed dominant side a
// very slight, permanent, ongoing loosening of its grip — the surface a rival
// pilgrim's opposing presence (or, eventually, the rival-pull bonus in
// companions/being.ts) has something to push against.
const AMBIENT_DECAY = 0.008;

// |control| at/above this counts as "awake" — the door is open to one side.
export const SOURCE_AWAKE_THRESHOLD = 0.15;

// |control| at/above this counts as "pinned to an extreme" — see extremeSinceTick
// on the Source type. 0.9 rather than 1.0 so a run that's been sitting a hair
// under the clamp (e.g. nudged down slightly by AMBIENT_DECAY) still counts as
// dominated — the point is "one side has effectively won for a while," not
// "control is bit-for-bit exactly +-1.0."
const EXTREME_THRESHOLD = 0.9;

// Ongoing effects, applied per tick and scaled by |control| (so a barely-open
// source barely matters, a fully-held one matters a lot). All deliberately small
// per-tick nudges — they only ever fire once a bond exists and a pilgrim arrives.
const LIGHT_HEAL = 0.0010;         // golden age: the band recovers/thrives
const LIGHT_SHADOW_AMBITION = 0.0004; // …but flourishing breeds ambition — the shadow rises
const DARK_FEAR = 0.0010;          // tyranny: dread spreads
const DARK_AGGRESSION = 0.0008;    // …and the will to dominate

// The aggression push is PRESSURE, not damage. Two rules keep it from ending the
// world, both added 2026-07 after a wind-tunnel run showed the old behaviour:
// a held Source drove EVERY living agent's aggression to a hard 1.000 in ~15
// world-days and left it there permanently (aggression is a trait and nothing
// decayed it), conflicts doubled, and 2/3 of the population died inside 20 days
// — from a stable 54 down to 5 survivors, with no recovery possible. Both
// polarities did it: dark fast, light slower via the shadow-ambition path.
//
//   1. It only touches those already inclined to it — the souls who would
//      qualify for a dark bond (see CONDUIT_CONSTANTS). The tyranny finds the
//      willing; it does not conscript the whole village.
//   2. It is capped per-agent and decays back out once the Source falls dormant,
//      so a soul can be pushed past their nature for a while but not remade.
const SOURCE_AGGRESSION_MAX_SHIFT = 0.25;  // most the Source can add to one agent's own aggression
const SOURCE_AGGRESSION_DECAY = 0.0006;    // per tick, while dormant — unwinds a full push in ~9 world-days

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
// Whose aggression the Source can reach: exactly the souls who would answer a
// dark bond. Thresholds are imported, not copied, so retuning the bond retunes
// who the tyranny can touch — the two are the same statement about a person.
function leansDark(agent: Agent): boolean {
  return (
    agent.traits.aggression >= CONDUIT_CONSTANTS.DARK_BOND_AGGRESSION_MIN &&
    agent.traits.nobility <= CONDUIT_CONSTANTS.DARK_BOND_NOBILITY_MAX
  );
}

// Push an agent's aggression, honouring the per-agent cap, and record how much
// of what they now are came from the Source rather than from them.
function pushAggression(agent: Agent, amount: number): void {
  const shift = agent.sourceAggressionShift ?? 0;
  const room = SOURCE_AGGRESSION_MAX_SHIFT - shift;
  if (room <= 0) return;

  const before = agent.traits.aggression;
  agent.traits.aggression = clamp01(before + Math.min(amount, room));
  agent.sourceAggressionShift = shift + (agent.traits.aggression - before); // actual, post-clamp
}

// Once nothing is held, what the Source put into them drains back out. Their own
// nature is untouched — only the borrowed part leaves.
function relaxAggression(agent: Agent): void {
  const shift = agent.sourceAggressionShift ?? 0;
  if (shift <= 0) return;

  const back = Math.min(SOURCE_AGGRESSION_DECAY, shift);
  const before = agent.traits.aggression;
  agent.traits.aggression = clamp01(before - back);
  agent.sourceAggressionShift = shift - (before - agent.traits.aggression); // actual, post-clamp
}

function applySourceEffects(state: WorldState, control: number): void {
  const dormant = Math.abs(control) < SOURCE_AWAKE_THRESHOLD;

  for (const agent of state.agents) {
    if (!agent.alive) continue;

    if (dormant) {
      relaxAggression(agent); // nothing flows — the pressure bleeds off
      continue;
    }

    if (control > 0) {
      // Golden age: bodies mend and spirits lift…
      agent.healthScore = clamp01(agent.healthScore + LIGHT_HEAL * control);
      agent.drives.grief = clamp01(agent.drives.grief - LIGHT_HEAL * control);
      // …but the brighter the light, the sharper the shadow: ambition rises in
      // those with the appetite for it, so a dark turn stays possible even in a
      // flourishing world. It does NOT reach the whole population.
      if (leansDark(agent)) pushAggression(agent, LIGHT_SHADOW_AMBITION * control);
      else relaxAggression(agent);
    } else {
      // The old gods press back through. Dread spreads to everyone — dread is a
      // drive, it decays on its own, and a whole village can be afraid. The will
      // to dominate only finds those already carrying it.
      const mag = -control;
      agent.drives.fear = clamp01(agent.drives.fear + DARK_FEAR * mag);
      if (leansDark(agent)) pushAggression(agent, DARK_AGGRESSION * mag);
      else relaxAggression(agent);
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
  who: Agent | undefined,
): SimEvent {
  const { x, y } = state.source.position;
  const type = moment === 'awakened' ? EventType.SourceAwakened : EventType.SourceShifted;
  const name = who !== undefined ? `${who.name} ${who.familyName}` : undefined;

  let description: string;
  if (moment === 'awakened') {
    description =
      kind === 'light'
        ? `Far beyond the ruins, the old device woke${name !== undefined ? ` at ${name}'s coming` : ''}. A warm light spilled from a doorway that had always looked like ruin — held open, for now, the way the Unbound left it.`
        : `Far beyond the ruins, something woke that should have stayed asleep. A cold breath came through a doorway in the old stone${name !== undefined ? `, and ${name} stood in it` : ''} — the gods the people crossed the sea to escape, pressing at the threshold.`;
  } else {
    description =
      kind === 'light'
        ? `The threshold beyond the ruins turned toward the light again${name !== undefined ? `, ${name} at its edge` : ''}; the cold drew back. For now.`
        : `The threshold beyond the ruins turned cold${name !== undefined ? ` as ${name} reached it` : ''}; something old and hungry pressed back through. For now.`;
  }

  return {
    id: `source_${moment}_${state.tick}`,
    tick: state.tick,
    day: state.day,
    type,
    involvedAgents: who !== undefined ? [who.id] : [],
    location: { x, y },
    description,
    narrativeWeight: moment === 'awakened' ? 0.98 : 0.95,
    threadRelevant: who !== undefined ? [who.familyName] : [],
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

  // Presence is a STANDOFF, not a tug-of-war rope. Souls at the Source cancel
  // each other one for one, and whoever is left over turns the needle — but the
  // size of that remainder does not matter: one uncontested soul turns it just
  // as fast as twenty. 21 light against 20 dark means twenty pairs annul each
  // other and a single soul is free to do what is necessary; 20 dark against 1
  // light is likewise settled by one. Nobody compounds.
  //
  // The old code summed a per-soul weight of (1 + significanceScore) and scaled
  // the pull by the MARGIN, which compounded twice over — twenty souls pulled
  // ~40x a lone pilgrim, so any crowd (and any future wave of arrivals) would
  // slam the needle to an extreme in a couple of ticks.
  let lightSouls = 0;
  let darkSouls = 0;
  let topLight: Agent | undefined;
  let topDark: Agent | undefined;
  for (const agent of state.agents) {
    if (!agent.alive || agent.conduitBondType === null) continue;
    if (manhattanDistance(x, y, agent.position.x, agent.position.y) > PRESENCE_RADIUS) continue;
    if (agent.conduitBondType === 'light') {
      lightSouls += 1;
      if (topLight === undefined || agent.significanceScore > topLight.significanceScore) topLight = agent;
    } else {
      darkSouls += 1;
      if (topDark === undefined || agent.significanceScore > topDark.significanceScore) topDark = agent;
    }
  }

  // Sign only. A deadlock (equal numbers, including 0-0) turns nothing, and the
  // needle is left to the decay branches below — a contested Source drifts back
  // toward dormant exactly like an abandoned one.
  const holder = Math.sign(lightSouls - darkSouls); // +1 light, -1 dark, 0 deadlocked

  const prev = src.control;
  if (holder !== 0) {
    src.control = clampControl(src.control + SHIFT_RATE * holder);
    // Ambient decay applies even while someone is actively present — pull
    // gently back toward 0 same as UNATTENDED_DECAY below, clamped so it can't
    // overshoot past 0 in one tick.
    if (src.control > 0) {
      src.control = Math.max(0, src.control - AMBIENT_DECAY);
    } else if (src.control < 0) {
      src.control = Math.min(0, src.control + AMBIENT_DECAY);
    }
  } else if (src.control > 0) {
    src.control = Math.max(0, src.control - UNATTENDED_DECAY);
  } else if (src.control < 0) {
    src.control = Math.min(0, src.control + UNATTENDED_DECAY);
  }

  // Track how long control has been pinned near an extreme (|control| >= 0.9),
  // for the rival-pull bonus in companions/being.ts. Reset the moment it drops
  // back below 0.9 — the clock only counts unbroken streaks of dominance.
  if (Math.abs(src.control) >= EXTREME_THRESHOLD) {
    if (src.extremeSinceTick === null) {
      src.extremeSinceTick = state.tick;
    }
  } else {
    src.extremeSinceTick = null;
  }

  applySourceEffects(state, src.control);

  const events: SimEvent[] = [];
  const wasAwake = Math.abs(prev) >= SOURCE_AWAKE_THRESHOLD;
  const isAwake = Math.abs(src.control) >= SOURCE_AWAKE_THRESHOLD;

  if (!wasAwake && isAwake) {
    const kind = src.control > 0 ? 'light' : 'dark';
    events.push(makeSourceEvent(state, kind, 'awakened', kind === 'light' ? topLight : topDark));
  } else if (wasAwake && isAwake && Math.sign(prev) !== Math.sign(src.control)) {
    const kind = src.control > 0 ? 'light' : 'dark';
    events.push(makeSourceEvent(state, kind, 'shifted', kind === 'light' ? topLight : topDark));
  }

  return events;
}
