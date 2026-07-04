// simulation/harness/constantsRegistry.ts
// Bridges --set/--sweep CLI overrides to the RELATIONSHIP_CONSTANTS,
// CONDUIT_CONSTANTS, CONFLICT_CONSTANTS, ILLNESS_CONSTANTS,
// PREDATOR_CONSTANTS, POPULATION_CONSTANTS, MIGRATION_CONSTANTS, and
// RUIN_RUMOR_CONSTANTS objects exported from sim code (agents/relationships.ts,
// companions/being.ts, agents/actions.ts, agents/illness.ts,
// agents/predators.ts, agents/initializer.ts, agents/migration.ts,
// agents/ruinExpedition.ts). Those
// are process-wide mutable singletons: sim
// functions read e.g. `RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS`
// fresh on every call rather than capturing a local copy, so setting a
// property here changes what every subsequent createWorldState/tick() call
// sees for the rest of the process.

import { RELATIONSHIP_CONSTANTS } from '../agents/relationships.js';
import { CONDUIT_CONSTANTS } from '../companions/being.js';
import { CONFLICT_CONSTANTS } from '../agents/actions.js';
import { ILLNESS_CONSTANTS } from '../agents/illness.js';
import { PREDATOR_CONSTANTS } from '../agents/predators.js';
import { POPULATION_CONSTANTS } from '../agents/initializer.js';
import { MIGRATION_CONSTANTS } from '../agents/migration.js';
import { RUIN_RUMOR_CONSTANTS } from '../agents/ruinExpedition.js';

type ConstantsObject = Record<string, number>;

const REGISTRIES: ConstantsObject[] = [
  RELATIONSHIP_CONSTANTS,
  CONDUIT_CONSTANTS,
  CONFLICT_CONSTANTS,
  ILLNESS_CONSTANTS,
  PREDATOR_CONSTANTS,
  POPULATION_CONSTANTS,
  MIGRATION_CONSTANTS,
  RUIN_RUMOR_CONSTANTS,
];

// Snapshot of the true defaults, captured once at process start before any
// override runs. Used both to validate --set/--sweep key names and to reset
// between --sweep combinations so an earlier combination's override of key A
// can never leak into a later combination that doesn't mention A.
const DEFAULTS: ConstantsObject = {};
for (const registry of REGISTRIES) {
  for (const [key, value] of Object.entries(registry)) {
    DEFAULTS[key] = value;
  }
}

function findRegistryFor(key: string): ConstantsObject | undefined {
  return REGISTRIES.find((registry) => key in registry);
}

export function isKnownConstant(key: string): boolean {
  return findRegistryFor(key) !== undefined;
}

export function listKnownConstants(): string[] {
  return Object.keys(DEFAULTS).sort();
}

export function setConstant(key: string, value: number): void {
  const registry = findRegistryFor(key);
  if (registry === undefined) {
    throw new Error(`Unknown constant "${key}". Known constants: ${listKnownConstants().join(', ')}`);
  }
  registry[key] = value;
}

/** Restores every constant to its captured default. Call before applying a new --sweep combination. */
export function resetAllConstants(): void {
  for (const registry of REGISTRIES) {
    for (const key of Object.keys(registry)) {
      registry[key] = DEFAULTS[key]!;
    }
  }
}
