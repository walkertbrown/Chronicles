// simulation/harness/run.ts
// The wind-tunnel CLI entry point. Ties together: CLI parsing, constants
// overrides (v1.1), running each seed to completion in memory (runSeed.ts),
// aggregating the results (aggregate.ts), and reporting them (report.ts /
// csvOutput.ts).
//
// No Firebase imports, no chronicle imports, no network — see the hard
// constraints in the wind-tunnel spec. This file and everything it imports
// under simulation/harness/ is pure addition; no simulation mechanics changed
// to build it (see the separate rng-determinism and v1.1-constants commits for
// the two sim-code exceptions the spec calls out explicitly).

import { parseArgs, usageError } from './cli.js';
import { runSeed } from './runSeed.js';
import {
  buildGateVerdict,
  computeAggregateStats,
  computeFantasyAggregateStats,
} from './aggregate.js';
import { formatFullReport } from './report.js';
import { writeCsvAndSummary } from './csvOutput.js';
import { isKnownConstant, listKnownConstants, resetAllConstants, setConstant } from './constantsRegistry.js';
import { expandSweep } from './sweep.js';
import type { ConstantOverride, FantasySeedMetrics, SeedResult } from './types.js';

function validateConstantNames(names: string[]): void {
  const unknown = names.filter((name) => !isKnownConstant(name));
  if (unknown.length > 0) {
    usageError(
      `Unknown constant(s): ${unknown.join(', ')}. Known constants: ${listKnownConstants().join(', ')}`,
    );
  }
}

function combinationLabel(combination: ConstantOverride[]): string | undefined {
  if (combination.length === 0) return undefined;
  return combination.map((o) => `${o.key}=${o.value}`).join(', ');
}

function runCombination(
  combination: ConstantOverride[],
  seeds: number[],
  days: number,
  keepFantasy: boolean,
  sampleEveryTicks: number,
): SeedResult[] {
  resetAllConstants();
  for (const o of combination) setConstant(o.key, o.value);
  return seeds.map((seed) => runSeed({ seed, days, keepFantasy, sampleEveryTicks, combination }));
}

function reportFor(
  results: SeedResult[],
  days: number,
  keepFantasy: boolean,
  combination: ConstantOverride[],
): string {
  const metricsList = results.map((r) => r.metrics);
  const stats = computeAggregateStats(metricsList, days);
  const fantasyList = results.map((r) => r.fantasy).filter((f): f is FantasySeedMetrics => f !== null);
  const fantasyStats = keepFantasy && fantasyList.length > 0 ? computeFantasyAggregateStats(fantasyList) : null;
  const gateVerdict = buildGateVerdict(stats, results.length, days, fantasyStats);
  return formatFullReport(results, stats, fantasyStats, gateVerdict, {
    days,
    keepFantasy,
    ...(combinationLabel(combination) !== undefined
      ? { combinationLabel: combinationLabel(combination)! }
      : {}),
  });
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  // Fail fast on a typo'd constant name rather than after minutes of ticking.
  validateConstantNames([
    ...options.setOverrides.map((o) => o.key),
    ...options.sweepSpecs.map((s) => s.key),
  ]);

  const combinations =
    options.sweepSpecs.length > 0
      ? expandSweep(options.sweepSpecs).map((combo) => [...options.setOverrides, ...combo])
      : [options.setOverrides];

  const startedAt = Date.now();
  const allResults: SeedResult[] = [];
  const reportSections: string[] = [];

  for (const combination of combinations) {
    const results = runCombination(
      combination,
      options.seeds,
      options.days,
      options.keepFantasy,
      options.sampleEveryTicks,
    );
    allResults.push(...results);
    reportSections.push(reportFor(results, options.days, options.keepFantasy, combination));
  }

  resetAllConstants(); // leave the process in a clean state regardless of what ran last

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const fullReport = reportSections.join('\n\n');

  console.log(fullReport);
  console.log(
    `\n(${allResults.length} seed-run(s) across ${combinations.length} combination(s) x ${options.days} days ticked in ${elapsedSec.toFixed(1)}s)`,
  );

  if (options.csv) {
    const { csvPath, summaryPath } = writeCsvAndSummary(allResults, fullReport, {
      days: options.days,
      keepFantasy: options.keepFantasy,
    });
    console.log(`\nWrote ${csvPath}`);
    console.log(`Wrote ${summaryPath}`);
  }
}

main();
