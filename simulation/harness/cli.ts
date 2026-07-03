// simulation/harness/cli.ts
// Command-line parsing for the wind-tunnel harness. No sim logic here — just
// argv -> CliOptions.
//
//   node dist/simulation/harness/run.js --seeds 20 --days 365 \
//     [--keep-fantasy] [--sample-every 48] [--csv] \
//     [--set KEY=value ...] [--sweep KEY=v1,v2,... ...]
//
// --set/--sweep values are matched against RELATIONSHIP_CONSTANTS/
// CONDUIT_CONSTANTS by constantsRegistry.ts (v1.1) — see run.ts.

import type { CliOptions, ConstantOverride, SweepSpec } from './types.js';

const DEFAULT_SAMPLE_EVERY_TICKS = 48; // TICKS_PER_DAY — once per world-day

export function usageError(message: string): never {
  throw new Error(
    `${message}\n\nUsage: node dist/simulation/harness/run.js --seeds <N|list> --days <D> ` +
      `[--keep-fantasy] [--sample-every <ticks>] [--csv] ` +
      `[--set KEY=value ...] [--sweep KEY=v1,v2,... ...]`,
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

function parseSetArg(raw: string): ConstantOverride {
  const eq = raw.indexOf('=');
  if (eq === -1) usageError(`--set expects KEY=value, got "${raw}"`);
  const key = raw.slice(0, eq).trim();
  const value = Number.parseFloat(raw.slice(eq + 1).trim());
  if (key.length === 0 || !Number.isFinite(value)) {
    usageError(`--set expects KEY=value with a numeric value, got "${raw}"`);
  }
  return { key, value };
}

function parseSweepArg(raw: string): SweepSpec {
  const eq = raw.indexOf('=');
  if (eq === -1) usageError(`--sweep expects KEY=v1,v2,..., got "${raw}"`);
  const key = raw.slice(0, eq).trim();
  const values = raw
    .slice(eq + 1)
    .split(',')
    .map((v) => Number.parseFloat(v.trim()));
  if (key.length === 0 || values.length === 0 || values.some((v) => !Number.isFinite(v))) {
    usageError(`--sweep expects KEY=v1,v2,... with numeric values, got "${raw}"`);
  }
  return { key, values };
}

export function parseArgs(argv: string[]): CliOptions {
  let seeds: number[] | null = null;
  let days: number | null = null;
  let keepFantasy = false;
  let sampleEveryTicks = DEFAULT_SAMPLE_EVERY_TICKS;
  let csv = false;
  const setOverrides: ConstantOverride[] = [];
  const sweepSpecs: SweepSpec[] = [];

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
      case '--set':
        setOverrides.push(parseSetArg(argv[++i] ?? usageError('--set requires KEY=value')));
        break;
      case '--sweep':
        sweepSpecs.push(parseSweepArg(argv[++i] ?? usageError('--sweep requires KEY=v1,v2,...')));
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
    setOverrides,
    sweepSpecs,
  };
}
