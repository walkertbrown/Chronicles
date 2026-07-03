// simulation/harness/run.ts
// The wind-tunnel CLI entry point. Ties together: CLI parsing, running each
// seed to completion in memory (runSeed.ts), aggregating the results
// (aggregate.ts), and reporting them (report.ts / csvOutput.ts).
//
// No Firebase imports, no chronicle imports, no network — see the hard
// constraints in the wind-tunnel spec. This file and everything it imports
// under simulation/harness/ is pure addition; no simulation mechanics changed
// to build it (see the separate rng-determinism and v1.1-constants commits for
// the two sim-code exceptions the spec calls out explicitly).

import { parseArgs } from './cli.js';
import { runSeed } from './runSeed.js';
import {
  buildGateVerdict,
  computeAggregateStats,
  computeFantasyAggregateStats,
} from './aggregate.js';
import { formatFullReport } from './report.js';
import { writeCsvAndSummary } from './csvOutput.js';
import type { FantasySeedMetrics, SeedResult } from './types.js';

function runBatch(
  seeds: number[],
  days: number,
  keepFantasy: boolean,
  sampleEveryTicks: number,
): SeedResult[] {
  return seeds.map((seed) =>
    runSeed({ seed, days, keepFantasy, sampleEveryTicks, combination: [] }),
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  const startedAt = Date.now();
  const results = runBatch(options.seeds, options.days, options.keepFantasy, options.sampleEveryTicks);
  const elapsedSec = (Date.now() - startedAt) / 1000;

  const metricsList = results.map((r) => r.metrics);
  const stats = computeAggregateStats(metricsList, options.days);

  const fantasyList = results
    .map((r) => r.fantasy)
    .filter((f): f is FantasySeedMetrics => f !== null);
  const fantasyStats =
    options.keepFantasy && fantasyList.length > 0 ? computeFantasyAggregateStats(fantasyList) : null;

  const gateVerdict = buildGateVerdict(stats, results.length, options.days, fantasyStats);

  const report = formatFullReport(results, stats, fantasyStats, gateVerdict, {
    days: options.days,
    keepFantasy: options.keepFantasy,
  });

  console.log(report);
  console.log(`\n(${results.length} seeds x ${options.days} days ticked in ${elapsedSec.toFixed(1)}s)`);

  if (options.csv) {
    const { csvPath, summaryPath } = writeCsvAndSummary(results, stats, fantasyStats, gateVerdict, {
      days: options.days,
      keepFantasy: options.keepFantasy,
    });
    console.log(`\nWrote ${csvPath}`);
    console.log(`Wrote ${summaryPath}`);
  }
}

main();
