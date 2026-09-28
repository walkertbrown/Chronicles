// Why the population plateaus: a year-by-year census of how many women are
// actually ABLE to conceive, and which gate is stopping the rest.
//
// A birth needs a woman who is (1) alive, (2) 16-45, (3) in a Pair bond with
// (4) a living male who is 16-60, (5) within 7 tiles of her, (6) both longing
// >= 0.45, (7) both hunger <= 0.5. This walks that funnel every world year and
// prints how many women survive each step, so the binding constraint is visible
// instead of inferred.
//
// Pure observation — changes no sim behaviour, and depends on nothing added by
// the childhood fix, so the identical file runs on both trees.

import seedrandom from 'seedrandom';
import type { Agent, WorldState } from '@shared/types.js';
import { createWorldState, tick } from '../tick.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { stripFantasy } from '../harness/fantasyStrip.js';
import { silenceConsole, restoreConsole } from '../harness/consoleSilence.js';

// Mirrors simulation/agents/births.ts. Duplicated (not imported) so this file
// is byte-identical on both trees.
const MIN_AGE = 16;
const MAX_FEMALE_AGE = 45;
const MAX_MALE_AGE = 60;
const PROXIMITY = 7;
const LONGING = 0.45;
const MAX_HUNGER = 0.5;
const DAYS_PER_YEAR = 30;

const seed = Number(process.argv[2] ?? 3);
const days = Number(process.argv[3] ?? 900);
const label = process.argv[4] ?? 'tree';

const state: WorldState = createWorldState(seed, `fertcensus_${seed}`);
stripFantasy(state);
const rng = seedrandom(String(seed)) as () => number;

function dist(a: Agent, b: Agent): number {
  return Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y);
}

type Row = {
  year: number; pop: number; women: number; fertileAge: number;
  paired: number; livingMate: number; fertileMate: number;
  nearby: number; longing: number; fed: number;
  births: number; deaths: number; unpairedFertileW: number; unpairedFertileM: number;
};
const rows: Row[] = [];

const seenIds = new Set(state.agents.map((a) => a.id));
const wasAlive = new Set(state.agents.filter((a) => a.alive).map((a) => a.id));
let yearBirths = 0;
let yearDeaths = 0;

function census(year: number): Row {
  const living = state.agents.filter((a) => a.alive);
  const byId = new Map(living.map((a) => [a.id, a]));
  const women = living.filter((a) => a.gender === 'female');
  const fertileAge = women.filter((a) => a.age >= MIN_AGE && a.age <= MAX_FEMALE_AGE);

  let paired = 0, livingMate = 0, fertileMate = 0, nearby = 0, longing = 0, fed = 0;
  for (const w of fertileAge) {
    const mateRel = w.relationships.find((r) => String(r.bond).toLowerCase() === 'pair');
    if (mateRel === undefined) continue;
    paired++;
    const m = byId.get(mateRel.agentId);
    if (m === undefined) continue;          // bonded to someone dead
    livingMate++;
    if (m.gender !== 'male' || m.age < MIN_AGE || m.age > MAX_MALE_AGE) continue;
    fertileMate++;
    if (dist(w, m) > PROXIMITY) continue;
    nearby++;
    if (w.drives.longing < LONGING || m.drives.longing < LONGING) continue;
    longing++;
    if (w.drives.hunger > MAX_HUNGER || m.drives.hunger > MAX_HUNGER) continue;
    fed++;
  }

  const hasPair = (a: Agent) => a.relationships.some((r) => String(r.bond).toLowerCase() === 'pair');
  const unpairedFertileW = fertileAge.filter((a) => !hasPair(a)).length;
  const unpairedFertileM = living.filter(
    (a) => a.gender === 'male' && a.age >= MIN_AGE && a.age <= MAX_MALE_AGE && !hasPair(a),
  ).length;

  return {
    year, pop: living.length, women: women.length, fertileAge: fertileAge.length,
    paired, livingMate, fertileMate, nearby, longing, fed,
    births: yearBirths, deaths: yearDeaths, unpairedFertileW, unpairedFertileM,
  };
}

silenceConsole();
try {
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) tick(state, rng);
    for (const a of state.agents) {
      if (!seenIds.has(a.id)) { seenIds.add(a.id); yearBirths++; wasAlive.add(a.id); }
      if (a.alive) continue;
      if (!wasAlive.has(a.id)) continue;
      wasAlive.delete(a.id);
      yearDeaths++;
    }
    if ((d + 1) % DAYS_PER_YEAR === 0) {
      rows.push(census((d + 1) / DAYS_PER_YEAR));
      yearBirths = 0;
      yearDeaths = 0;
    }
  }
} finally {
  restoreConsole();
}

console.log(`\n=== ${label}: seed ${seed}, ${days} days = ${days / DAYS_PER_YEAR} world years ===`);
console.log('The funnel, at the last tick of each world year. Every column is a');
console.log('count of WOMEN, each one a subset of the column to its left.\n');
const hdr = ['yr', 'pop', 'birth', 'death', 'women', '16-45', 'paired', 'mate', 'fertM', 'near', 'longs', 'FED', 'freeW', 'freeM'];
console.log(hdr.map((h) => h.padStart(6)).join(''));
for (const r of rows) {
  console.log([
    r.year, r.pop, r.births, r.deaths, r.women, r.fertileAge,
    r.paired, r.livingMate, r.fertileMate, r.nearby, r.longing, r.fed,
    r.unpairedFertileW, r.unpairedFertileM,
  ].map((v) => String(v).padStart(6)).join(''));
}
console.log('\nfertileAge = women 16-45 | paired = has any Pair bond | mate = that mate is alive');
console.log('fertM = mate is a male 16-60 | near = within 7 tiles | longs = both longing>=0.45');
console.log('FED = both hunger<=0.5 — this is the count that can actually conceive today');
console.log('freeW/freeM = fertile-age adults with NO pair bond at all (the unused supply)');
