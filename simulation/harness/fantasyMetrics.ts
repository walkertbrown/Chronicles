// simulation/harness/fantasyMetrics.ts
// Fantasy-arc metrics, collected only when the harness is run with --keep-fantasy
// (i.e. fantasyStrip.ts's state surgery was skipped). Per amendment 2 of the
// wind-tunnel spec: first Conduit sighting/bond, Source awakening/flips/control
// trajectory, and pilgrimages — enough to answer "does the plot ignite, and when."
//
// Event-backed metrics (sighting/bond/awaken/flip) use the same per-tick event
// scan as metrics.ts, for the same reason: state.eventLog is capped at 500 and a
// once-at-the-end read would silently miss most of a long run.
//
// Pilgrimages has no event of its own — OutcomeType.SoughtSource (agents/outcomes.ts)
// is an internal per-tick outcome, never turned into a SimEvent or exposed on
// TickSummary. Rather than add a new event type (out of scope — no sim-mechanics
// changes beyond the approved rng threading and v1.1 constants extraction), we
// read it off the agent's own plain-English `currentAction` field, which
// describeOutcome() in agents/actions.ts already sets verbatim for this outcome:
//   'Communing at the threshold beyond the ruins'   (light, arrived)
//   'Pressing at the threshold beyond the ruins'    (dark, arrived)
//   'Drawn toward something beyond the ruins'        (still journeying)
// This is a read-only proxy — zero sim code changes — and is checked every tick
// (not just at --sample-every points) since currentAction can change tick to tick.

import type { WorldState } from '@shared/types.js';
import { EventType, type SimEvent } from '@shared/types.js';
import type { FantasySeedMetrics } from './types.js';

const SOUGHT_SOURCE_ACTIONS = new Set([
  'Pressing at the threshold beyond the ruins',
  'Communing at the threshold beyond the ruins',
  'Drawn toward something beyond the ruins',
]);

export class FantasyMetricsCollector {
  private firstConduitSightingDay: number | null = null;
  private firstConduitBondDay: number | null = null;
  private firstConduitBondNature: 'light' | 'dark' | null = null;
  private sourceAwakenedDay: number | null = null;
  private sourceFlips = 0;
  private readonly sourceControlSamples: number[] = [];
  private readonly pilgrimAgentIds = new Set<string>();
  private artifactsImprinted = 0;

  /** Call once per tick with exactly that tick's newly-appended events. */
  onEvents(events: SimEvent[], day: number): void {
    for (const event of events) {
      switch (event.type) {
        case EventType.ConduitSighting:
          if (this.firstConduitSightingDay === null) this.firstConduitSightingDay = day;
          break;
        case EventType.ConduitBondLight:
          if (this.firstConduitBondDay === null) {
            this.firstConduitBondDay = day;
            this.firstConduitBondNature = 'light';
          }
          break;
        case EventType.ConduitBondDark:
          if (this.firstConduitBondDay === null) {
            this.firstConduitBondDay = day;
            this.firstConduitBondNature = 'dark';
          }
          break;
        case EventType.SourceAwakened:
          if (this.sourceAwakenedDay === null) this.sourceAwakenedDay = day;
          break;
        case EventType.SourceShifted:
          this.sourceFlips += 1;
          break;
        case EventType.ArtifactImprinted:
          this.artifactsImprinted += 1;
          break;
        default:
          break;
      }
    }
  }

  /** Call every tick (pilgrimage detection needs tick-granularity, not sample-granularity). */
  onTick(state: WorldState): void {
    for (const agent of state.agents) {
      if (agent.conduitBondType === null) continue; // only a bonded soul heeds the call
      if (agent.currentAction !== null && SOUGHT_SOURCE_ACTIONS.has(agent.currentAction)) {
        this.pilgrimAgentIds.add(agent.id);
      }
    }
  }

  /** Call at --sample-every intervals, alongside the population sample. */
  sample(state: WorldState): void {
    this.sourceControlSamples.push(state.source.control);
  }

  finalize(state: WorldState): FantasySeedMetrics {
    return {
      firstConduitSightingDay: this.firstConduitSightingDay,
      firstConduitBondDay: this.firstConduitBondDay,
      firstConduitBondNature: this.firstConduitBondNature,
      sourceAwakenedDay: this.sourceAwakenedDay,
      sourceControlFinal: state.source.control,
      sourceControlSamples: this.sourceControlSamples,
      sourceFlips: this.sourceFlips,
      pilgrimages: this.pilgrimAgentIds.size,
      artifactsImprinted: this.artifactsImprinted,
    };
  }
}
