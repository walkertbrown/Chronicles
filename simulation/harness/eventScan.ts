// simulation/harness/eventScan.ts
//
// IMPORTANT CORRECTION vs. the wind-tunnel spec's "Known facts": state.eventLog
// does NOT grow unbounded. events/log.ts caps it at MAX_EVENT_LOG_SIZE = 500 and
// silently evicts the oldest entries once that fills up (tick.ts and vessel.ts
// both do the same eviction). A 365-day run is 17,520 ticks; any metric read only
// once at the end of the run from state.eventLog would see at most the last ~500
// events out of possibly thousands — silently wrong for firstBirthDay, deaths,
// conflicts, etc. on any seed with real activity.
//
// Fix: scan for new events immediately after every single tick() call, before the
// next tick's appends could push anything out. Events are appended in tick order
// and always land at the tail of the array, so walking backward from the end and
// stopping at the first event whose `tick` field doesn't match the tick we just
// ran captures exactly (and only) this tick's new events — O(new events), not
// O(500), and immune to the eviction cap regardless of --sample-every.

import type { SimEvent, WorldState } from '@shared/types.js';

/**
 * Returns the events appended to state.eventLog during the tick that just ran.
 * `tickNumber` must be the value of state.tick BEFORE that tick() call — events
 * created during a tick are stamped with the pre-increment tick number (see
 * events/log.ts createEvent, which reads state.tick before tick.ts increments it
 * at the end of the function).
 */
export function newEventsThisTick(state: WorldState, tickNumber: number): SimEvent[] {
  const log = state.eventLog;
  const collected: SimEvent[] = [];

  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i];
    if (event === undefined) break;
    if (event.tick !== tickNumber) break;
    collected.push(event);
  }

  // Walked backward, so reverse to restore chronological order within the tick.
  collected.reverse();
  return collected;
}
