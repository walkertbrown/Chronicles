// Watches WHEN and AT WHAT AGE mate bonds form, by snapshotting the bond set
// each day and noting every newly-appeared pair. Pure observation: it changes
// no sim behaviour, and depends on nothing added by the childhood fix, so the
// identical file runs on both the modified and unmodified trees.
//
// The question it answers: was the unmodified world forming its mate bonds
// during CHILDHOOD (children cluster at the hearth, so trust and interaction
// counts climb easily), such that pairs were already in place when fertility
// arrived at 16 — and does gating bonds at 16 therefore delay each generation?

import seedrandom from 'seedrandom';
import type { WorldState } from '@shared/types.js';
import { createWorldState, tick } from '../tick.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { stripFantasy } from '../harness/fantasyStrip.js';
import { silenceConsole, restoreConsole } from '../harness/consoleSilence.js';

const seed = Number(process.argv[2] ?? 3);
const days = Number(process.argv[3] ?? 900);
const label = process.argv[4] ?? 'tree';

const state: WorldState = createWorldState(seed, `bondprobe_${seed}`);
stripFantasy(state);
const rng = seedrandom(String(seed)) as () => number;

type Form = { day: number; ageA: number; ageB: number; bornA: boolean; bornB: boolean };
const forms: Form[] = [];
const known = new Set<string>();
// Founders are everyone alive at tick 0; anyone else was born in-sim.
const founders = new Set(state.agents.map((a) => a.id));

silenceConsole();
try {
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) tick(state, rng);
    const byId = new Map(state.agents.map((a) => [a.id, a]));
    for (const a of state.agents) {
      for (const r of a.relationships) {
        if (String(r.bond).toLowerCase() !== 'pair') continue;
        const b = byId.get(r.agentId);
        if (b === undefined) continue;
        const key = [a.id, b.id].sort().join('|');
        if (known.has(key)) continue;
        known.add(key);
        forms.push({
          day: state.day, ageA: a.age, ageB: b.age,
          bornA: !founders.has(a.id), bornB: !founders.has(b.id),
        });
      }
    }
  }
} finally {
  restoreConsole();
}

console.log(`\n=== ${label}: seed ${seed}, ${days} days (world day ${state.day}) ===`);
console.log(`alive ${state.agents.filter((a) => a.alive).length}   mate bonds ever formed: ${forms.length}`);

const withMinor = forms.filter((f) => f.ageA < 16 || f.ageB < 16);
const bothAdult = forms.filter((f) => f.ageA >= 16 && f.ageB >= 16);
console.log(`\n  formed with at least one party UNDER 16: ${withMinor.length}`);
console.log(`  formed with both parties 16+:            ${bothAdult.length}`);

// Of bonds involving a sim-born agent, how old was that agent when it bonded?
const simBorn = forms.filter((f) => f.bornA || f.bornB);
const agesAtBond: number[] = [];
for (const f of simBorn) {
  if (f.bornA) agesAtBond.push(f.ageA);
  if (f.bornB) agesAtBond.push(f.ageB);
}
agesAtBond.sort((x, y) => x - y);
console.log(`\n  bonds involving a sim-born agent: ${simBorn.length}`);
console.log(`  age of the sim-born partner when the bond formed:`);
console.log(`    ${agesAtBond.join(', ') || '(none)'}`);
if (agesAtBond.length > 0) {
  const med = agesAtBond[Math.floor(agesAtBond.length / 2)] ?? 0;
  console.log(`    youngest ${agesAtBond[0]}   median ${med}   oldest ${agesAtBond[agesAtBond.length - 1]}`);
}

// Formation timeline, by world year (30 days per year).
const byYear = new Map<number, number>();
for (const f of forms) {
  const y = Math.floor(f.day / 30);
  byYear.set(y, (byYear.get(y) ?? 0) + 1);
}
console.log(`\n  bonds formed per world year (30 days each):`);
const years = [...byYear.keys()].sort((a, b) => a - b);
console.log(`    ${years.map((y) => `y${y}:${byYear.get(y)}`).join('  ')}`);
