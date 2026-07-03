// simulation/harness/cli.ts
// Command-line parsing for the wind-tunnel harness. No sim logic here — just
// argv -> CliOptions.
//
//   node dist/simulation/harness/run.js --seeds 20 --days 365 \
//     [--keep-fantasy] [--sample-every 48] [--csv]
//
// --set / --sweep (v1.1 constants injection) are added in cliConstants.ts once
// RELATIONSHIP_CONSTANTS/CONDUIT_CONSTANTS exist to override — see run.ts.

import type { CliOptions } from './types.js';

const DEFAULT_SAMPLE_EVERY_TICKS = 48; // TICKS_PER_DAY — once per world-day

export function usageError(message: string): never {
  throw new Error(
    `${message}\n\nUsage: node dist/simulation/harness/run.js --seeds <N|list> --days <D> ` +
      `[--keep-fantasy] [--sample-every <ticks>] [--csv]`,
  );
}

function parseSeeds(raw: string): number[] {
  if (raw.includes(',')) {
    const seeds = raw.split(',').map((s) => Number.parseInt(s.trim(), 10));
    if (seeds.some((s) => !Number.isFinite(s))) {
      usageError(`--seeds contains a non-numeric value: "${raw}"`);
    }
    return seeds;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    usageError(`--seeds must be a positive integer or comma list, got "${raw}"`);
  }
  return Array.from({ length: n }, (_, i) => i + 1);
}

export function parseArgs(argv: string[]): CliOptions {
  let seeds: number[] | null = null;
  let days: number | null = null;
  let keepFantasy = false;
  let sampleEveryTicks = DEFAULT_SAMPLE_EVERY_TICKS;
  let csv = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--seeds':
        seeds = parseSeeds(argv[++i] ?? usageError('--seeds requires a value'));
        break;
      case '--days':
        days = Number.parseInt(argv[++i] ?? '', 10);
        if (!Number.isFinite(days) || days < 1) usageError('--days must be a positive integer');
        break;
      case '--keep-fantasy':
        keepFantasy = true;
        break;
      case '--sample-every':
        sampleEveryTicks = Number.parseInt(argv[++i] ?? '', 10);
        if (!Number.isFinite(sampleEveryTicks) || sampleEveryTicks < 1) {
          usageError('--sample-every must be a positive integer (ticks)');
        }
        break;
      case '--csv':
        csv = true;
        break;
      default:
        usageError(`Unrecognized argument: "${arg}"`);
    }
  }

  if (seeds === null) usageError('--seeds is required');
  if (days === null) usageError('--days is required');

  return {
    seeds,
    days,
    keepFantasy,
    sampleEveryTicks,
    csv,
    setOverrides: [],
    sweepSpecs: [],
  };
}
