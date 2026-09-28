// simulation/scripts/demographyProbe.ts
// Is the population realistic? Runs one fresh seeded world and reports the
// numbers a demographer would check against pre-modern populations:
//   - annual growth rate (real range ~0-1%, fastest ever recorded ~3-4%)
//   - crude death rate per 1,000 per year (pre-modern ~30-40)
//   - share of children who died before 15 (pre-modern ~35-50%)
//   - deaths by cause and by age band
//
// Usage: node dist/simulation/scripts/demographyProbe.js <seed> <days>
// Diagnostic only. Fresh seeded world; never touches the live checkpoint.

import seedrandom from 'seedrandom';
import type { Agent, WorldState } from '@shared/types.js';
import { createWorldState, tick } from '../tick.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { stripFantasy } from '../harness/fantasyStrip.js';
import { silenceConsole, restoreConsole } from '../harness/consoleSilence.js';

const DAYS_PER_YEAR = 30;
const seed = Number(process.argv[2] ?? 3);
const days = Number(process.argv[3] ?? 900);
const years = days / DAYS_PER_YEAR;

const state: WorldState = createWorldState(seed, `demography_${seed}`);
stripFantasy(state);
const rng = seedrandom(String(seed)) as () => number;

const founderIds = new Set(state.agents.map((a) => a.id));
const startPop = state.agents.filter((a) => a.alive).length;
const bornDay = new Map<string, number>();
let personYears = 0;
const popByYear: number[] = [];

silenceConsole();
try {
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) tick(state, rng);
    for (const a of state.agents) if (!founderIds.has(a.id) && !bornDay.has(a.id)) bornDay.set(a.id, d);
    const alive = state.agents.filter((a) => a.alive).length;
    personYears += alive / DAYS_PER_YEAR;
    if ((d + 1) % DAYS_PER_YEAR === 0) popByYear.push(alive);
  }
} finally {
  restoreConsole();
}

function causeOf(a: Agent): string {
  const c = a.deathCause ?? '';
  if (c.includes('in childhood')) return 'childhood';
  if (c.includes('body gave out')) return 'old age';
  if (c.includes('of illness')) return 'illness';
  if (c.includes('predator')) return 'predator';
  if (c.includes('killed')) return 'violence';
  if (c.includes('starvation')) return 'starvation';
  return 'unknown';
}

const dead = state.agents.filter((a) => !a.alive);
const finalPop = state.agents.length - dead.length;
const births = bornDay.size;
const growth = Math.pow(finalPop / startPop, 1 / years) - 1;
const cdr = (dead.length / personYears) * 1000;
const cbr = (births / personYears) * 1000;

// Child mortality: only children born early enough that they would have reached
// 15 by the end of the run if they lived — otherwise the young are undercounted.
const cohort = [...bornDay.entries()].filter(([, d]) => days - d >= 15 * DAYS_PER_YEAR);
const cohortDiedYoung = cohort.filter(([id]) => {
  const a = state.agents.find((x) => x.id === id)!;
  return !a.alive && a.age < 15;
}).length;

const byCause = new Map<string, number>();
for (const a of dead) byCause.set(causeOf(a), (byCause.get(causeOf(a)) ?? 0) + 1);
const bands: Array<[string, number, number]> = [['0', 0, 0], ['1-4', 1, 4], ['5-14', 5, 14], ['15-44', 15, 44], ['45-59', 45, 59], ['60+', 60, 999]];
const bandCounts = bands.map(([label, lo, hi]) => [label, dead.filter((a) => a.age >= lo && a.age <= hi).length] as const);
const adultDeaths = dead.filter((a) => a.age >= 15).map((a) => a.age).sort((x, y) => x - y);
const foundersAlive = state.agents.filter((a) => founderIds.has(a.id) && a.alive).length;

console.log(`seed ${seed} | ${years} world years | pop ${startPop} -> ${finalPop} | growth ${(growth * 100).toFixed(2)}%/yr`);
console.log(`  births ${births} (${cbr.toFixed(0)}/1000/yr) | deaths ${dead.length} (${cdr.toFixed(0)}/1000/yr)`);
console.log(`  child mortality <15: ${cohortDiedYoung}/${cohort.length} = ${cohort.length ? ((cohortDiedYoung / cohort.length) * 100).toFixed(0) : '-'}% (children born ≥15 yrs before end)`);
console.log(`  by cause: ${[...byCause.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  by age at death: ${bandCounts.map(([l, n]) => `${l}: ${n}`).join(', ')}`);
console.log(`  adult median age at death: ${adultDeaths.length ? adultDeaths[Math.floor(adultDeaths.length / 2)] : '-'} | founders alive: ${foundersAlive}/${founderIds.size}`);
console.log(`  pop by year: ${popByYear.join(' ')}`);
