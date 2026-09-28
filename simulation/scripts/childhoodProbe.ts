// simulation/scripts/childhoodProbe.ts
// Direct observation of what CHILDREN are doing, which the wind-tunnel report
// does not cover: its aggregate is population-level (births, deaths, bonds), so
// a six-year-old with building skill 1.0 is invisible to it.
//
// Mirrors runSeed.ts's loop, but keeps the final WorldState so the population
// can be inspected by life stage. Diagnostic only — nothing here runs in
// production, and like the rest of the harness it builds a fresh seeded world
// and never touches the live checkpoint.

import seedrandom from 'seedrandom';
import type { Agent, WorldState } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { createWorldState, tick } from '../tick.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { stripFantasy } from '../harness/fantasyStrip.js';
import { silenceConsole, restoreConsole } from '../harness/consoleSilence.js';
import { lifeStage, isAdult } from '../agents/maturity.js';

const seed = Number(process.argv[2] ?? 3);
const days = Number(process.argv[3] ?? 365);

const state: WorldState = createWorldState(seed, `childprobe_${seed}`);
stripFantasy(state);
const rng = seedrandom(String(seed)) as () => number;

silenceConsole();
try {
  for (let i = 0; i < days * TICKS_PER_DAY; i++) tick(state, rng);
} finally {
  restoreConsole();
}

const living = state.agents.filter((a) => a.alive);
const SKILLS = ['building', 'fire', 'gathering', 'hunting', 'healing'] as const;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const mid = s[m] ?? 0;
  const below = s[m - 1] ?? mid;
  return s.length % 2 === 1 ? mid : (below + mid) / 2;
}

console.log(`\n=== seed ${seed}, ${days} days (world day ${state.day}) — ${living.length} alive ===\n`);

for (const stage of ['infant', 'child', 'adolescent', 'adult'] as const) {
  const group = living.filter((a) => lifeStage(a.age) === stage);
  if (group.length === 0) {
    console.log(`${stage.padEnd(11)} 0 alive`);
    continue;
  }
  const parts = SKILLS.map((sk) => {
    const vals = group.map((a) => a.skills[sk]);
    return `${sk} med ${median(vals).toFixed(2)} max ${Math.max(...vals).toFixed(2)}`;
  });
  console.log(`${stage.padEnd(11)} ${String(group.length).padStart(2)} alive   ages ${Math.min(...group.map((a) => a.age))}-${Math.max(...group.map((a) => a.age))}`);
  for (const p of parts) console.log(`            ${p}`);
  const actions = new Map<string, number>();
  for (const a of group) {
    const act = a.currentAction ?? '(none)';
    actions.set(act, (actions.get(act) ?? 0) + 1);
  }
  const top = [...actions.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
  console.log(`            doing: ${top.map(([k, v]) => `${v}x ${k}`).join(' | ')}`);
  console.log('');
}

// ---- Pair bonds: the stagnation mechanism. A Pair involving a non-adult, or
// two agents too far apart to conceive, is a dud that also locks both of them
// out of any other bond (one-mate exclusivity). ----
const byId = new Map(state.agents.map((a) => [a.id, a]));
const seen = new Set<string>();
let underage = 0;
let sameSex = 0;
let valid = 0;
const distances: number[] = [];

for (const a of living) {
  for (const rel of a.relationships) {
    if (rel.bond !== BondType.Pair) continue;
    const b = byId.get(rel.agentId);
    if (b === undefined || !b.alive) continue;
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isAdult(a) || !isAdult(b)) underage++;
    else if (a.gender === b.gender) sameSex++;
    else {
      valid++;
      distances.push(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y));
    }
  }
}

console.log(`pair bonds (living, deduped): ${seen.size}`);
console.log(`  involving a non-adult:      ${underage}    <- must be 0`);
console.log(`  same-sex (cannot conceive): ${sameSex}`);
console.log(`  adult male+female:          ${valid}`);
if (distances.length > 0) {
  console.log(`  their separation (tiles):   med ${median(distances).toFixed(0)}  max ${Math.max(...distances).toFixed(0)}`);
}
const longings = living.filter(isAdult).map((a) => a.drives.longing);
console.log(`adult longing: med ${median(longings).toFixed(2)}  min ${Math.min(...longings).toFixed(2)}  max ${Math.max(...longings).toFixed(2)}`);
console.log(`pregnant now:  ${living.filter((a) => a.pregnancy !== null).length}`);
