// simulation/scripts/mortalityProbe.ts
// Who actually dies, and of what. The wind-tunnel CSV gives deaths by cause but
// not by age, so it cannot answer the question that matters after the childhood
// change: are CHILDREN dying because they now stay near the hearth while the
// healers are out working? (hasAdjacentHealer in illness.ts needs someone within
// 1 tile whose healing skill clears 0.3.)
//
// Reads agent.deathDay / agent.deathCause, so it doubles as a live check that
// those two fields are actually being stamped.
//
// Diagnostic only. Fresh seeded world; never touches the live checkpoint.

import seedrandom from 'seedrandom';
import type { WorldState } from '@shared/types.js';
import { createWorldState, tick } from '../tick.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { stripFantasy } from '../harness/fantasyStrip.js';
import { silenceConsole, restoreConsole } from '../harness/consoleSilence.js';
import { lifeStage } from '../agents/maturity.js';

const seed = Number(process.argv[2] ?? 4);
const days = Number(process.argv[3] ?? 365);

const state: WorldState = createWorldState(seed, `mortprobe_${seed}`);
stripFantasy(state);
const rng = seedrandom(String(seed)) as () => number;

silenceConsole();
try {
  for (let i = 0; i < days * TICKS_PER_DAY; i++) tick(state, rng);
} finally {
  restoreConsole();
}

function bucket(cause: string | null): string {
  const d = (cause ?? '').toLowerCase();
  if (d.includes('starvation')) return 'starvation';
  if (d.includes('illness')) return 'illness';
  if (d.includes('killed') || d.includes('wound') || d.includes('struck')) return 'violence';
  if (d.includes('animal') || d.includes('predator') || d.includes('lion') || d.includes('beast')) return 'predator';
  return 'other';
}

const dead = state.agents.filter((a) => !a.alive);
const living = state.agents.filter((a) => a.alive);

console.log(`\n=== seed ${seed}, ${days} days (world day ${state.day}) ===`);
console.log(`alive ${living.length}   dead ${dead.length}   total ever ${state.agents.length}`);

// Cause x life stage at death.
const stages = ['infant', 'child', 'adolescent', 'adult'] as const;
const causes = ['starvation', 'illness', 'violence', 'predator', 'other'] as const;
const grid = new Map<string, number>();
for (const a of dead) {
  const key = `${bucket(a.deathCause)}|${lifeStage(a.age)}`;
  grid.set(key, (grid.get(key) ?? 0) + 1);
}
console.log(`\ndeaths by cause x life stage at death`);
console.log(`  ${'cause'.padEnd(12)}${stages.map((s) => s.padStart(11)).join('')}${'total'.padStart(8)}`);
for (const c of causes) {
  const row = stages.map((s) => grid.get(`${c}|${s}`) ?? 0);
  const tot = row.reduce((x, y) => x + y, 0);
  if (tot === 0) continue;
  console.log(`  ${c.padEnd(12)}${row.map((n) => String(n).padStart(11)).join('')}${String(tot).padStart(8)}`);
}

// Were the death fields actually stamped?
const missingCause = dead.filter((a) => a.deathCause === null).length;
const missingDay = dead.filter((a) => a.deathDay === null).length;
console.log(`\ndeath fields: ${dead.length - missingCause}/${dead.length} have deathCause, ` +
  `${dead.length - missingDay}/${dead.length} have deathDay`);

// How many living agents could ever tend a sick neighbour?
const HEALER = 0.3;
const healers = living.filter((a) => a.skills.healing > HEALER);
console.log(`\nhealers among the living (healing > ${HEALER}): ${healers.length} of ${living.length}`);
console.log(`  their ages: ${healers.map((a) => a.age).sort((a, b) => a - b).join(', ') || '(none)'}`);

// Ages of the dead, youngest first, with day and cause — the raw record.
console.log(`\nthe dead (age at death, day, cause)`);
for (const a of [...dead].sort((x, y) => x.age - y.age)) {
  console.log(`  age ${String(a.age).padStart(3)}  ${lifeStage(a.age).padEnd(11)} day ${String(a.deathDay ?? -1).padStart(4)}  ${a.deathCause ?? '(none)'}`);
}
