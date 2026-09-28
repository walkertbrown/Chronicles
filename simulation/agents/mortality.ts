// simulation/agents/mortality.ts
// Background mortality — the deaths no event causes.
//
// Before this, a person died only when something happened to them: a wound, a
// predator, an illness that drained their health to zero. Nothing else ever
// killed anyone. Babies survived at the same rate as adults and the old lived
// on indefinitely, so a 30-year wind-tunnel run saw ~15 deaths against ~150
// births — about 4 deaths per 1,000 people per year, where pre-modern
// populations ran 30-40. With births unopposed the population compounded.
//
// This adds the two missing sources, as an annual risk that depends only on age:
//   - childhood: highest for newborns, falling through the first years
//   - old age:   rising steeply from the mid-forties (a Gompertz curve)
// Rolled once per world day, with the annual risk spread evenly across the
// year's 30 days.

import type { Agent, WorldState } from '@shared/types.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './drives.js';
import type { DeathRecord } from './significance.js';

const DAYS_PER_YEAR = TICKS_PER_YEAR / TICKS_PER_DAY; // 30

// Annual probability of dying, by age. Age is a whole number that ticks up for
// everyone at once on the world's new year, so a newborn spends on average only
// half a year at age 0 — the age-0 rate is set high to cover that.
export const MORTALITY_CONSTANTS = {
  INFANT_ANNUAL: 0.22,        // age 0
  EARLY_CHILD_ANNUAL: 0.04,   // ages 1-4
  CHILD_ANNUAL: 0.008,        // ages 5-14
  CHILDHOOD_END_AGE: 15,
  // Old age: risk = OLD_AGE_BASE × e^(OLD_AGE_GROWTH × (age − OLD_AGE_ONSET)).
  // ≈1.2% at 45, 2.7% at 55, 4% at 60, 9% at 70, 20% at 80.
  OLD_AGE_ONSET: 45,
  OLD_AGE_BASE: 0.012,
  OLD_AGE_GROWTH: 0.08,
};

export function annualMortality(age: number): number {
  const c = MORTALITY_CONSTANTS;
  if (age < 1) return c.INFANT_ANNUAL;
  if (age < 5) return c.EARLY_CHILD_ANNUAL;
  if (age < c.CHILDHOOD_END_AGE) return c.CHILD_ANNUAL;
  if (age < c.OLD_AGE_ONSET) return 0;
  return Math.min(1, c.OLD_AGE_BASE * Math.exp(c.OLD_AGE_GROWTH * (age - c.OLD_AGE_ONSET)));
}

function dailyMortality(age: number): number {
  const annual = annualMortality(age);
  if (annual <= 0) return 0;
  if (annual >= 1) return 1;
  return 1 - Math.pow(1 - annual, 1 / DAYS_PER_YEAR);
}

// Called every tick; acts once per world day. Returns the deaths for tick.ts to
// apply through the same path as every other death (log, ripples, bonds).
export function rollNaturalDeaths(state: WorldState, rng: () => number): DeathRecord[] {
  if (state.tick % TICKS_PER_DAY !== 0) return [];

  const deaths: DeathRecord[] = [];
  for (const agent of state.agents as Agent[]) {
    if (!agent.alive) continue;
    const p = dailyMortality(agent.age);
    if (p <= 0 || rng() >= p) continue;
    deaths.push({
      agentId: agent.id,
      cause: agent.age < MORTALITY_CONSTANTS.CHILDHOOD_END_AGE ? 'childhood' : 'age',
    });
  }
  return deaths;
}
