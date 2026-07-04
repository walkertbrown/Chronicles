// simulation/harness/metrics.ts
// Accumulates the fantasy-neutral per-seed metrics (Deliverable 1's metrics list)
// across a single seed's run. Two data sources feed it:
//   - onEvents(): called once per tick with exactly that tick's new SimEvents
//     (see eventScan.ts for why "once per tick" matters — the log is capped at
//     500 entries, so scanning only at the end would silently drop most of a
//     365-day run's history).
//   - sample(): called at --sample-every intervals; scans live agent state
//     directly for things that aren't logged as events at all (pair/kin/rival
//     bonds — see agents/relationships.ts — and the northernmost tile any agent
//     has ever reached).

import type { Agent, SimEvent, WorldState } from '@shared/types.js';
import { BondType, EventType } from '@shared/types.js';
import type { TickSummary } from '../tick.js';
import type { DeathBreakdown, DeathCause, SeedMetrics } from './types.js';

function emptyDeathBreakdown(): DeathBreakdown {
  return { starvation: 0, violence: 0, predator: 0, illness: 0, other: 0 };
}

// Death events carry cause only baked into the plain-language description (see
// events/log.ts logDeathEvent) — no structured cause field on SimEvent. Parse it
// back out. Natural old-age deaths ("The body gave out") aren't one of the spec's
// five named buckets, so — like anything unparseable — they land in 'other'.
function classifyDeathCause(description: string): DeathCause {
  if (description.includes('died of starvation')) return 'starvation';
  if (description.includes('died of illness')) return 'illness';
  if (description.includes('mauled by a predator')) return 'predator';
  if (description.includes('was killed by') || description.includes('was killed in conflict')) {
    return 'violence';
  }
  return 'other';
}

function pairKey(agentIdA: string, agentIdB: string): string {
  return agentIdA < agentIdB ? `${agentIdA}|${agentIdB}` : `${agentIdB}|${agentIdA}`;
}

export class SeedMetricsCollector {
  private readonly seed: number;

  private firstPairDay: number | null = null;
  private firstConceptionDay: number | null = null;
  private conceptions = 0;
  private firstBirthDay: number | null = null;
  private births = 0;
  private deaths = 0;
  private readonly deathBreakdown: DeathBreakdown = emptyDeathBreakdown();
  private conflicts = 0;
  private resolutions = 0;
  private migrations = 0;
  private illnessEvents = 0;

  private maxDistanceNorth: number | null = null; // running minimum y across all agents, ever

  private latestPairCount = 0;
  private latestKinCount = 0;
  private latestRivalCount = 0;

  private finalPopulation = 0;
  private peakPopulation = 0;
  private minPopulation = Infinity;
  private readonly populationSamples: number[] = [];

  private artifactsFound = 0;
  private firstArtifactFoundDay: number | null = null;

  private familiesRelocated = 0;
  private firstRelocationDay: number | null = null;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Call once per tick with exactly that tick's newly-appended events. */
  onEvents(events: SimEvent[], day: number): void {
    for (const event of events) {
      switch (event.type) {
        case EventType.Conception:
          this.conceptions += 1;
          if (this.firstConceptionDay === null) this.firstConceptionDay = day;
          break;
        case EventType.Birth:
          this.births += 1;
          if (this.firstBirthDay === null) this.firstBirthDay = day;
          break;
        case EventType.Death:
          this.deaths += 1;
          this.deathBreakdown[classifyDeathCause(event.description)] += 1;
          break;
        case EventType.Conflict:
          this.conflicts += 1;
          break;
        case EventType.Resolution:
          this.resolutions += 1;
          break;
        case EventType.Migration:
          this.migrations += 1;
          break;
        case EventType.IllnessBegan:
          this.illnessEvents += 1;
          break;
        case EventType.HamletFounded:
          this.familiesRelocated += 1;
          if (this.firstRelocationDay === null) this.firstRelocationDay = day;
          break;
        default:
          break;
      }
    }
  }

  /** Call once per tick with that tick's TickSummary. */
  onTickSummary(summary: TickSummary): void {
    this.finalPopulation = summary.aliveCount;
    this.peakPopulation = Math.max(this.peakPopulation, summary.aliveCount);
    this.minPopulation = Math.min(this.minPopulation, summary.aliveCount);
  }

  /** Call at --sample-every intervals. Scans agent state directly. */
  sample(state: WorldState, day: number): void {
    const alive = state.agents.filter((a) => a.alive);
    this.populationSamples.push(alive.length);

    // Northernmost reach: scan every agent ever recorded (dead ones stay put at
    // wherever they died, which still counts as ground reached), not just the
    // living, so a scout who died at the frontier isn't erased from the record.
    for (const agent of state.agents) {
      if (this.maxDistanceNorth === null || agent.position.y < this.maxDistanceNorth) {
        this.maxDistanceNorth = agent.position.y;
      }
    }

    // firstPairDay: scan ALL agents (not just alive) so a pair that formed and
    // then lost a partner before the next sample isn't missed — the relationship
    // record persists on the survivor even after the partner dies.
    if (this.firstPairDay === null) {
      const anyPair = state.agents.some((agent: Agent) =>
        agent.relationships.some((rel) => rel.bond === BondType.Pair),
      );
      if (anyPair) this.firstPairDay = day;
    }

    // "At end" bond snapshot: unique bonded pairs tracked by the CURRENTLY ALIVE
    // population (a relationship persists on a survivor even after their partner
    // dies, so this can still include a since-deceased other party — that's a
    // deliberate choice: it's still a relationship the living population holds).
    // Recomputed (not accumulated) every sample so finalize() reflects the last one.
    const seenPair = new Set<string>();
    const seenKin = new Set<string>();
    const seenRival = new Set<string>();
    for (const agent of alive) {
      for (const rel of agent.relationships) {
        const key = pairKey(agent.id, rel.agentId);
        if (rel.bond === BondType.Pair) seenPair.add(key);
        else if (rel.bond === BondType.Kin) seenKin.add(key);
        else if (rel.bond === BondType.Rival) seenRival.add(key);
      }
    }
    this.latestPairCount = seenPair.size;
    this.latestKinCount = seenKin.size;
    this.latestRivalCount = seenRival.size;

    // Artifact discoveries: scan tile state directly (ground truth) rather than
    // EventType.ArtifactFound. That event is only logged from the idle-curiosity
    // path (agents/actions.ts actionExplore) — the wanderlust-foray path
    // (agents/exploration.ts actionVenture) also discovers artifacts but does
    // NOT log an event for it, so an event-only count would silently undercount.
    // `artifact.discovered` never resets once set, so a periodic scan of the
    // (small, sparse) dirty-tile set gives the true cumulative total.
    let discoveredCount = 0;
    for (const tile of state.tiles.getDirtyTiles().values()) {
      for (const artifact of tile.artifacts) {
        if (artifact.discovered) discoveredCount += 1;
      }
    }
    this.artifactsFound = discoveredCount;
    if (discoveredCount > 0 && this.firstArtifactFoundDay === null) {
      this.firstArtifactFoundDay = day;
    }
  }

  finalize(): SeedMetrics {
    return {
      seed: this.seed,
      firstPairDay: this.firstPairDay,
      pairBondsTotal: this.latestPairCount,
      kinBonds: this.latestKinCount,
      rivalBonds: this.latestRivalCount,
      firstConceptionDay: this.firstConceptionDay,
      conceptions: this.conceptions,
      firstBirthDay: this.firstBirthDay,
      births: this.births,
      deaths: this.deaths,
      deathBreakdown: this.deathBreakdown,
      conflicts: this.conflicts,
      resolutions: this.resolutions,
      migrations: this.migrations,
      maxDistanceNorth: this.maxDistanceNorth,
      finalPopulation: this.finalPopulation,
      peakPopulation: this.peakPopulation,
      minPopulation: this.minPopulation === Infinity ? this.finalPopulation : this.minPopulation,
      illnessEvents: this.illnessEvents,
      firstArtifactFoundDay: this.firstArtifactFoundDay,
      artifactsFound: this.artifactsFound,
      firstRelocationDay: this.firstRelocationDay,
      familiesRelocated: this.familiesRelocated,
      populationSamples: this.populationSamples,
    };
  }
}
