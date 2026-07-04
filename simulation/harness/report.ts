// simulation/harness/report.ts
// Formats aggregate.ts's computed stats into the console report: a per-seed
// table, an aggregate median/min/max block, and the GATE VERDICT. Pure string
// building — no computation, no I/O (run.ts does the console.log/file writes).

import type { AggregateStats, FantasyAggregateStats } from './aggregate.js';
import type { GateVerdictLine, NumericStat, SeedResult } from './types.js';

function fmt(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function statLine(label: string, stat: NumericStat, digits = 0): string {
  return `  ${pad(label, 22)} median ${pad(fmt(stat.median, digits), 8)} min ${pad(fmt(stat.min, digits), 8)} max ${pad(fmt(stat.max, digits), 8)} (${stat.presentCount}/${stat.totalCount} seeds)`;
}

const SEED_COLUMNS = [
  'seed', 'pairDay', 'pairs', 'kin', 'rival', 'concDay', 'conc',
  'birthDay', 'births', 'deaths', 'conflicts', 'migr', 'minY',
  'finalPop', 'peakPop', 'minPop', 'illness', 'artDay', 'artifacts',
  'scattered', 'relocDay', 'relocated',
] as const;

const FANTASY_SEED_COLUMNS = [
  'sightDay', 'bondDay', 'nature', 'awakeDay', 'ctrlFinal', 'flips', 'pilgrims', 'imprinted',
] as const;

function seedRow(result: SeedResult): string[] {
  const m = result.metrics;
  const base = [
    String(m.seed),
    fmt(m.firstPairDay), String(m.pairBondsTotal), String(m.kinBonds), String(m.rivalBonds),
    fmt(m.firstConceptionDay), String(m.conceptions),
    fmt(m.firstBirthDay), String(m.births), String(m.deaths), String(m.conflicts),
    String(m.migrations), fmt(m.maxDistanceNorth),
    String(m.finalPopulation), String(m.peakPopulation), String(m.minPopulation), String(m.illnessEvents),
    fmt(m.firstArtifactFoundDay), String(m.artifactsFound),
    String(m.scatteredArtifactsFound),
    fmt(m.firstRelocationDay), String(m.familiesRelocated),
  ];
  if (result.fantasy === null) return base;
  const f = result.fantasy;
  return [
    ...base,
    fmt(f.firstConduitSightingDay), fmt(f.firstConduitBondDay), f.firstConduitBondNature ?? '–',
    fmt(f.sourceAwakenedDay), fmt(f.sourceControlFinal, 2), String(f.sourceFlips), String(f.pilgrimages),
    String(f.artifactsImprinted),
  ];
}

function formatSeedTable(results: SeedResult[]): string {
  const keepFantasy = results.length > 0 && results[0]!.fantasy !== null;
  const columns = keepFantasy ? [...SEED_COLUMNS, ...FANTASY_SEED_COLUMNS] : [...SEED_COLUMNS];
  const rows = results.map(seedRow);

  const widths = columns.map((col, i) =>
    Math.max(col.length, ...rows.map((row) => (row[i] ?? '').length)),
  );

  const headerLine = columns.map((col, i) => pad(col, widths[i]!)).join('  ');
  const dataLines = rows.map((row) => row.map((cell, i) => pad(cell, widths[i]!)).join('  '));

  return [headerLine, ...dataLines].join('\n');
}

function formatAggregateBlock(stats: AggregateStats, fantasyStats: FantasyAggregateStats | null): string {
  const lines = [
    'AGGREGATE (median / min / max across seeds)',
    statLine('firstPairDay', stats.firstPairDay),
    statLine('pairBondsTotal', stats.pairBondsTotal),
    statLine('kinBonds', stats.kinBonds),
    statLine('rivalBonds', stats.rivalBonds),
    statLine('firstConceptionDay', stats.firstConceptionDay),
    statLine('conceptions', stats.conceptions),
    statLine('firstBirthDay', stats.firstBirthDay),
    statLine('births', stats.births),
    statLine('deaths', stats.deaths),
    statLine('deathsPerYear', stats.deathsPerYear, 1),
    statLine('conflicts', stats.conflicts),
    statLine('resolutions', stats.resolutions),
    statLine('migrations', stats.migrations),
    statLine('maxDistanceNorth (min y)', stats.maxDistanceNorth),
    statLine('finalPopulation', stats.finalPopulation),
    statLine('peakPopulation', stats.peakPopulation),
    statLine('minPopulation', stats.minPopulation),
    statLine('illnessEvents', stats.illnessEvents),
    statLine('firstArtifactFoundDay', stats.firstArtifactFoundDay),
    statLine('artifactsFound', stats.artifactsFound),
    statLine('scatteredArtifactsFound', stats.scatteredArtifactsFound),
    statLine('firstRelocationDay', stats.firstRelocationDay),
    statLine('familiesRelocated', stats.familiesRelocated),
  ];

  if (fantasyStats !== null) {
    lines.push(
      '',
      'AGGREGATE — fantasy arc (--keep-fantasy)',
      statLine('firstConduitSightingDay', fantasyStats.firstConduitSightingDay),
      statLine('firstConduitBondDay', fantasyStats.firstConduitBondDay),
      `  ${pad('firstConduitBondNature', 22)} ${fantasyStats.lightBondFirstCount} seeds light-first, ${fantasyStats.darkBondFirstCount} seeds dark-first`,
      statLine('sourceAwakenedDay', fantasyStats.sourceAwakenedDay),
      statLine('sourceControlFinal', fantasyStats.sourceControlFinal, 2),
      statLine('sourceFlips', fantasyStats.sourceFlips),
      statLine('pilgrimages', fantasyStats.pilgrimages),
      statLine('artifactsImprinted', fantasyStats.artifactsImprinted),
    );
  }

  return lines.join('\n');
}

function formatGateVerdict(gateVerdict: GateVerdictLine[]): string {
  const width = Math.max(...gateVerdict.map((g) => g.label.length)) + 1;
  const lines = ['GATE VERDICT'];
  for (const g of gateVerdict) {
    lines.push(`  ${pad(`${g.label}:`, width)} ${pad(g.status, 9)}${g.detail}`);
  }
  return lines.join('\n');
}

export function formatFullReport(
  results: SeedResult[],
  stats: AggregateStats,
  fantasyStats: FantasyAggregateStats | null,
  gateVerdict: GateVerdictLine[],
  meta: { days: number; keepFantasy: boolean; fakeChronicle?: boolean; combinationLabel?: string },
): string {
  const flags = [
    meta.keepFantasy ? '(fantasy kept)' : '(fantasy stripped)',
    meta.fakeChronicle === true ? '(fake-chronicle)' : null,
  ].filter((f): f is string => f !== null).join(' ');
  const header = meta.combinationLabel
    ? `=== ${results.length} seeds × ${meta.days} days ${flags} — ${meta.combinationLabel} ===`
    : `=== ${results.length} seeds × ${meta.days} days ${flags} ===`;

  return [
    header,
    '',
    formatSeedTable(results),
    '',
    formatAggregateBlock(stats, fantasyStats),
    '',
    formatGateVerdict(gateVerdict),
  ].join('\n');
}
