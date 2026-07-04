// simulation/harness/csvOutput.ts
// Writes the --csv deliverables: one row per (seed × constant combination) in
// <ISO-timestamp>.csv, plus a <ISO-timestamp>-summary.md wrapping the same
// report text already printed to the console (report.ts formats it; this file
// only knows how to persist it).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedResult } from './types.js';

// NOTE: import.meta.dirname would resolve inside dist/ (the compiled file's own
// location), not the source tree — since tsc mirrors simulation/harness/ into
// simulation/dist/simulation/harness/. The spec's documented invocation is
// `cd simulation && node dist/simulation/harness/run.js`, i.e. run with cwd set
// to simulation/, so resolving against process.cwd() lands results in the
// source-tree simulation/harness/results/ every time, matching the spec exactly.
const RESULTS_DIR = join(process.cwd(), 'harness', 'results');

function csvCell(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function combinationKeys(results: SeedResult[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const r of results) {
    for (const o of r.combination) {
      if (!seen.has(o.key)) {
        seen.add(o.key);
        keys.push(o.key);
      }
    }
  }
  return keys;
}

function buildCsv(results: SeedResult[]): string {
  const keepFantasy = results.length > 0 && results[0]!.fantasy !== null;
  const comboKeys = combinationKeys(results);

  const header = [
    'seed',
    ...comboKeys,
    'firstPairDay', 'pairBondsTotal', 'kinBonds', 'rivalBonds',
    'firstConceptionDay', 'conceptions', 'firstBirthDay', 'births',
    'deaths', 'deaths_starvation', 'deaths_violence', 'deaths_predator', 'deaths_illness', 'deaths_other',
    'conflicts', 'resolutions', 'migrations', 'maxDistanceNorth',
    'finalPopulation', 'peakPopulation', 'minPopulation', 'illnessEvents',
    'firstArtifactFoundDay', 'artifactsFound',
    'firstRelocationDay', 'familiesRelocated',
  ];
  if (keepFantasy) {
    header.push(
      'firstConduitSightingDay', 'firstConduitBondDay', 'firstConduitBondNature',
      'sourceAwakenedDay', 'sourceControlFinal', 'sourceFlips', 'pilgrimages', 'artifactsImprinted',
    );
  }

  const rows = results.map((r) => {
    const m = r.metrics;
    const comboValues = comboKeys.map((key) => {
      const found = r.combination.find((o) => o.key === key);
      return found !== undefined ? String(found.value) : '';
    });
    const base = [
      String(m.seed),
      ...comboValues,
      m.firstPairDay ?? '', m.pairBondsTotal, m.kinBonds, m.rivalBonds,
      m.firstConceptionDay ?? '', m.conceptions, m.firstBirthDay ?? '', m.births,
      m.deaths, m.deathBreakdown.starvation, m.deathBreakdown.violence,
      m.deathBreakdown.predator, m.deathBreakdown.illness, m.deathBreakdown.other,
      m.conflicts, m.resolutions, m.migrations, m.maxDistanceNorth ?? '',
      m.finalPopulation, m.peakPopulation, m.minPopulation, m.illnessEvents,
      m.firstArtifactFoundDay ?? '', m.artifactsFound,
      m.firstRelocationDay ?? '', m.familiesRelocated,
    ];
    if (keepFantasy && r.fantasy !== null) {
      base.push(
        r.fantasy.firstConduitSightingDay ?? '', r.fantasy.firstConduitBondDay ?? '',
        r.fantasy.firstConduitBondNature ?? '', r.fantasy.sourceAwakenedDay ?? '',
        r.fantasy.sourceControlFinal, r.fantasy.sourceFlips, r.fantasy.pilgrimages,
        r.fantasy.artifactsImprinted,
      );
    }
    return base.map((cell) => csvCell(cell)).join(',');
  });

  return [header.map(csvCell).join(','), ...rows].join('\n') + '\n';
}

export interface CsvWriteResult {
  csvPath: string;
  summaryPath: string;
}

export function writeCsvAndSummary(
  results: SeedResult[],
  reportText: string,
  meta: { days: number; keepFantasy: boolean },
): CsvWriteResult {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = join(RESULTS_DIR, `${timestamp}.csv`);
  const summaryPath = join(RESULTS_DIR, `${timestamp}-summary.md`);

  writeFileSync(csvPath, buildCsv(results), 'utf8');

  const summary = [
    `# Wind-tunnel run — ${timestamp}`,
    '',
    `${results.length} seed-run(s) total × ${meta.days} days, fantasy ${meta.keepFantasy ? 'kept' : 'stripped'}.`,
    '',
    '```',
    reportText,
    '```',
    '',
  ].join('\n');
  writeFileSync(summaryPath, summary, 'utf8');

  return { csvPath, summaryPath };
}
