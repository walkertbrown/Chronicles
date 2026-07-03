// simulation/harness/types.ts
// Shared type definitions for the wind-tunnel harness. No sim-mechanics logic
// lives here — pure data shapes so metrics.ts, fantasyMetrics.ts, run.ts, etc.
// all speak the same language.

// ============================================================
// CLI
// ============================================================

export interface ConstantOverride {
  key: string;
  value: number;
}

export interface SweepSpec {
  key: string;
  values: number[];
}

export interface CliOptions {
  seeds: number[];
  days: number;
  keepFantasy: boolean;
  fakeChronicle: boolean;
  sampleEveryTicks: number;
  csv: boolean;
  setOverrides: ConstantOverride[];
  sweepSpecs: SweepSpec[];
}

// ============================================================
// DEATH CAUSES
// Parsed from Death event descriptions (see events/log.ts logDeathEvent).
// ============================================================

// Matches the spec's five categories exactly. Natural old-age deaths ("The body
// gave out" — see events/log.ts logDeathEvent's 'age' case) are not one of the
// spec's named buckets, so they fall into 'other' along with anything unparseable.
export type DeathCause = 'starvation' | 'violence' | 'predator' | 'illness' | 'other';

export type DeathBreakdown = Record<DeathCause, number>;

// ============================================================
// PER-SEED METRICS (fantasy-neutral — always collected)
// ============================================================

export interface SeedMetrics {
  seed: number;

  firstPairDay: number | null;
  pairBondsTotal: number;
  kinBonds: number;
  rivalBonds: number;

  firstConceptionDay: number | null;
  conceptions: number;

  firstBirthDay: number | null;
  births: number;

  deaths: number;
  deathBreakdown: DeathBreakdown;

  conflicts: number;
  resolutions: number;

  migrations: number;
  maxDistanceNorth: number | null; // smallest y reached by any agent; null if no agent ever moved

  finalPopulation: number;
  peakPopulation: number;
  minPopulation: number;

  illnessEvents: number;

  firstArtifactFoundDay: number | null;
  artifactsFound: number;

  populationSamples: number[]; // one entry per sample point, for an optional sparkline
}

// ============================================================
// PER-SEED FANTASY METRICS (only collected with --keep-fantasy)
// ============================================================

export interface FantasySeedMetrics {
  firstConduitSightingDay: number | null;
  firstConduitBondDay: number | null;
  firstConduitBondNature: 'light' | 'dark' | null;

  sourceAwakenedDay: number | null;
  sourceControlFinal: number;
  sourceControlSamples: number[]; // sampled alongside populationSamples
  sourceFlips: number;

  pilgrimages: number; // distinct agents who ever heeded the source's call

  artifactsImprinted: number; // EventType.ArtifactImprinted — requires a bonded Conduit
}

// ============================================================
// COMBINED RESULT OF ONE SEED RUN
// ============================================================

export interface SeedResult {
  metrics: SeedMetrics;
  fantasy: FantasySeedMetrics | null;
  // The constant overrides in effect for this run (empty outside --sweep).
  combination: ConstantOverride[];
}

// ============================================================
// AGGREGATE STATS
// ============================================================

export interface NumericStat {
  median: number | null;
  min: number | null;
  max: number | null;
  presentCount: number; // seeds where the value was non-null
  totalCount: number;
}

export interface GateVerdictLine {
  label: string;
  status: 'MOVING' | 'FLATLINE';
  detail: string;
}
