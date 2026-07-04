// simulation/harness/aggregate.ts
// Pure computation: turns a batch of per-seed SeedResults into median/min/max
// stats and the GATE VERDICT lines. No printing here — see report.ts.

import type {
  DeathBreakdown,
  DeathCause,
  FantasySeedMetrics,
  GateVerdictLine,
  NumericStat,
  SeedMetrics,
} from './types.js';

// A seed counts as having "sent anyone north" once an agent's y position gets
// at or below this line. Settlement sits ~y1443-1499; the Source zone is
// ~y866 — y1200 is comfortably past the coastal fringe, matching the spec's
// own GATE VERDICT example.
export const NORTH_THRESHOLD_Y = 1200;

const DEATH_CAUSES: DeathCause[] = ['starvation', 'violence', 'predator', 'illness', 'other'];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function computeStat(raw: Array<number | null>): NumericStat {
  const present = raw.filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    median: median(present),
    min: present.length > 0 ? Math.min(...present) : null,
    max: present.length > 0 ? Math.max(...present) : null,
    presentCount: present.length,
    totalCount: raw.length,
  };
}

function annualize(count: number, days: number): number {
  return (count * 365) / days;
}

export interface AggregateStats {
  firstPairDay: NumericStat;
  pairBondsTotal: NumericStat;
  kinBonds: NumericStat;
  rivalBonds: NumericStat;
  firstConceptionDay: NumericStat;
  conceptions: NumericStat;
  firstBirthDay: NumericStat;
  births: NumericStat;
  deaths: NumericStat;
  deathsPerYear: NumericStat;
  deathCauseMedianPerYear: Record<DeathCause, number>;
  conflicts: NumericStat;
  resolutions: NumericStat;
  migrations: NumericStat;
  maxDistanceNorth: NumericStat;
  finalPopulation: NumericStat;
  peakPopulation: NumericStat;
  minPopulation: NumericStat;
  illnessEvents: NumericStat;
  firstArtifactFoundDay: NumericStat;
  artifactsFound: NumericStat;
  firstRelocationDay: NumericStat;
  familiesRelocated: NumericStat;
  expeditionsLaunched: NumericStat;
  expeditionsReturned: NumericStat;
  northSeedCount: number; // seeds that ever sent someone at/below NORTH_THRESHOLD_Y
  deathSeedCount: number; // seeds that recorded at least one death
  artifactSeedCount: number; // seeds that found at least one artifact
  relocationSeedCount: number; // seeds that saw at least one family relocate
  expeditionSeedCount: number; // seeds that launched at least one ruin expedition
}

export function computeAggregateStats(metricsList: SeedMetrics[], days: number): AggregateStats {
  const deathCauseMedianPerYear = {} as Record<DeathCause, number>;
  for (const cause of DEATH_CAUSES) {
    const perSeed = metricsList.map((m) => annualize(m.deathBreakdown[cause], days));
    deathCauseMedianPerYear[cause] = median(perSeed) ?? 0;
  }

  return {
    firstPairDay: computeStat(metricsList.map((m) => m.firstPairDay)),
    pairBondsTotal: computeStat(metricsList.map((m) => m.pairBondsTotal)),
    kinBonds: computeStat(metricsList.map((m) => m.kinBonds)),
    rivalBonds: computeStat(metricsList.map((m) => m.rivalBonds)),
    firstConceptionDay: computeStat(metricsList.map((m) => m.firstConceptionDay)),
    conceptions: computeStat(metricsList.map((m) => m.conceptions)),
    firstBirthDay: computeStat(metricsList.map((m) => m.firstBirthDay)),
    births: computeStat(metricsList.map((m) => m.births)),
    deaths: computeStat(metricsList.map((m) => m.deaths)),
    deathsPerYear: computeStat(metricsList.map((m) => annualize(m.deaths, days))),
    deathCauseMedianPerYear,
    conflicts: computeStat(metricsList.map((m) => m.conflicts)),
    resolutions: computeStat(metricsList.map((m) => m.resolutions)),
    migrations: computeStat(metricsList.map((m) => m.migrations)),
    maxDistanceNorth: computeStat(metricsList.map((m) => m.maxDistanceNorth)),
    finalPopulation: computeStat(metricsList.map((m) => m.finalPopulation)),
    peakPopulation: computeStat(metricsList.map((m) => m.peakPopulation)),
    minPopulation: computeStat(metricsList.map((m) => m.minPopulation)),
    illnessEvents: computeStat(metricsList.map((m) => m.illnessEvents)),
    firstArtifactFoundDay: computeStat(metricsList.map((m) => m.firstArtifactFoundDay)),
    artifactsFound: computeStat(metricsList.map((m) => m.artifactsFound)),
    firstRelocationDay: computeStat(metricsList.map((m) => m.firstRelocationDay)),
    familiesRelocated: computeStat(metricsList.map((m) => m.familiesRelocated)),
    expeditionsLaunched: computeStat(metricsList.map((m) => m.expeditionsLaunched)),
    expeditionsReturned: computeStat(metricsList.map((m) => m.expeditionsReturned)),
    northSeedCount: metricsList.filter(
      (m) => m.maxDistanceNorth !== null && m.maxDistanceNorth <= NORTH_THRESHOLD_Y,
    ).length,
    deathSeedCount: metricsList.filter((m) => m.deaths > 0).length,
    artifactSeedCount: metricsList.filter((m) => m.artifactsFound > 0).length,
    relocationSeedCount: metricsList.filter((m) => m.familiesRelocated > 0).length,
    expeditionSeedCount: metricsList.filter((m) => m.expeditionsLaunched > 0).length,
  };
}

export interface FantasyAggregateStats {
  firstConduitSightingDay: NumericStat;
  firstConduitBondDay: NumericStat;
  sourceAwakenedDay: NumericStat;
  sourceControlFinal: NumericStat;
  sourceFlips: NumericStat;
  pilgrimages: NumericStat;
  artifactsImprinted: NumericStat;
  lightBondFirstCount: number;
  darkBondFirstCount: number;
}

export function computeFantasyAggregateStats(fantasyList: FantasySeedMetrics[]): FantasyAggregateStats {
  return {
    firstConduitSightingDay: computeStat(fantasyList.map((f) => f.firstConduitSightingDay)),
    firstConduitBondDay: computeStat(fantasyList.map((f) => f.firstConduitBondDay)),
    sourceAwakenedDay: computeStat(fantasyList.map((f) => f.sourceAwakenedDay)),
    sourceControlFinal: computeStat(fantasyList.map((f) => f.sourceControlFinal)),
    sourceFlips: computeStat(fantasyList.map((f) => f.sourceFlips)),
    pilgrimages: computeStat(fantasyList.map((f) => f.pilgrimages)),
    artifactsImprinted: computeStat(fantasyList.map((f) => f.artifactsImprinted)),
    lightBondFirstCount: fantasyList.filter((f) => f.firstConduitBondNature === 'light').length,
    darkBondFirstCount: fantasyList.filter((f) => f.firstConduitBondNature === 'dark').length,
  };
}

function gate(label: string, movingCount: number, total: number, detailMoving: string, detailFlatline: string): GateVerdictLine {
  const moving = movingCount > 0;
  return {
    label,
    status: moving ? 'MOVING' : 'FLATLINE',
    detail: moving ? detailMoving : detailFlatline,
  };
}

function rankedCauses(deathCauseMedianPerYear: Record<DeathCause, number>): string {
  return DEATH_CAUSES
    .map((cause) => ({ cause, value: deathCauseMedianPerYear[cause] }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((c) => `${c.cause} ${c.value.toFixed(1)}`)
    .join(', ');
}

export function buildGateVerdict(
  stats: AggregateStats,
  totalSeeds: number,
  days: number,
  fantasyStats: FantasyAggregateStats | null,
): GateVerdictLine[] {
  const lines: GateVerdictLine[] = [];

  lines.push(
    gate(
      'pairs',
      stats.firstPairDay.presentCount,
      totalSeeds,
      `(${stats.firstPairDay.presentCount}/${totalSeeds} seeds formed ≥1 pair; median firstPairDay ${stats.firstPairDay.median})`,
      `(0/${totalSeeds} seeds formed a pair in ${days} days)`,
    ),
  );
  lines.push(
    gate(
      'conceptions',
      stats.firstConceptionDay.presentCount,
      totalSeeds,
      `(${stats.firstConceptionDay.presentCount}/${totalSeeds} seeds; median day ${stats.firstConceptionDay.median})`,
      `(0/${totalSeeds} seeds conceived in ${days} days)`,
    ),
  );
  lines.push(
    gate(
      'births',
      stats.firstBirthDay.presentCount,
      totalSeeds,
      `(${stats.firstBirthDay.presentCount}/${totalSeeds} seeds; median firstBirthDay ${stats.firstBirthDay.median})`,
      `(0/${totalSeeds} seeds saw a birth in ${days} days)`,
    ),
  );
  const causeStr = rankedCauses(stats.deathCauseMedianPerYear);
  lines.push(
    gate(
      'deaths',
      stats.deathSeedCount,
      totalSeeds,
      `(${stats.deathSeedCount}/${totalSeeds} seeds; median ${(stats.deathsPerYear.median ?? 0).toFixed(1)}/yr${causeStr.length > 0 ? ` — ${causeStr}` : ''})`,
      `(0/${totalSeeds} seeds recorded a death in ${days} days)`,
    ),
  );
  lines.push(
    gate(
      'exploration',
      stats.northSeedCount,
      totalSeeds,
      `(${stats.northSeedCount}/${totalSeeds} seeds sent anyone north of y${NORTH_THRESHOLD_Y})`,
      `(0/${totalSeeds} seeds sent anyone north of y${NORTH_THRESHOLD_Y}) ← investigate`,
    ),
  );
  lines.push(
    gate(
      'artifacts',
      stats.artifactSeedCount,
      totalSeeds,
      `(${stats.artifactSeedCount}/${totalSeeds} seeds; median firstArtifactFoundDay ${stats.firstArtifactFoundDay.median})`,
      `(0/${totalSeeds} seeds found an artifact in ${days} days) ← investigate`,
    ),
  );
  lines.push(
    gate(
      'migration',
      stats.relocationSeedCount,
      totalSeeds,
      `(${stats.relocationSeedCount}/${totalSeeds} seeds saw ≥1 family relocate; median day ${stats.firstRelocationDay.median})`,
      `(0/${totalSeeds} seeds relocated a family in ${days} days) ← investigate`,
    ),
  );
  lines.push(
    gate(
      'ruin expeditions',
      stats.expeditionSeedCount,
      totalSeeds,
      `(${stats.expeditionSeedCount}/${totalSeeds} seeds launched ≥1 expedition; median launched ${stats.expeditionsLaunched.median}, returned ${stats.expeditionsReturned.median})`,
      `(0/${totalSeeds} seeds launched a ruin expedition in ${days} days) ← investigate`,
    ),
  );

  if (fantasyStats !== null) {
    lines.push(
      gate(
        'conduit sightings',
        fantasyStats.firstConduitSightingDay.presentCount,
        totalSeeds,
        `(${fantasyStats.firstConduitSightingDay.presentCount}/${totalSeeds} seeds; median day ${fantasyStats.firstConduitSightingDay.median})`,
        `(0/${totalSeeds} seeds in ${days} days) ← investigate`,
      ),
    );
    lines.push(
      gate(
        'conduit bonds',
        fantasyStats.firstConduitBondDay.presentCount,
        totalSeeds,
        `(${fantasyStats.firstConduitBondDay.presentCount}/${totalSeeds} seeds; median day ${fantasyStats.firstConduitBondDay.median}; ${fantasyStats.lightBondFirstCount} light-first, ${fantasyStats.darkBondFirstCount} dark-first)`,
        `(0/${totalSeeds} seeds in ${days} days)`,
      ),
    );
    lines.push(
      gate(
        'source awakening',
        fantasyStats.sourceAwakenedDay.presentCount,
        totalSeeds,
        `(${fantasyStats.sourceAwakenedDay.presentCount}/${totalSeeds} seeds; median day ${fantasyStats.sourceAwakenedDay.median})`,
        `(0/${totalSeeds} seeds in ${days} days)`,
      ),
    );
  }

  return lines;
}
