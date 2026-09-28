// simulation/scripts/migrationDryRun.ts
// Runs the two bond migrations against a SNAPSHOT of the live world (a saved
// /state payload) and reports exactly what they would change. Read-only with
// respect to the real world: it parses a JSON file, never Firestore, and never
// writes anything back. Diagnostic — not part of the sim.
//
//   node dist/simulation/scripts/migrationDryRun.js <path-to-state.json>

import { readFileSync } from 'node:fs';
import type { Agent, WorldState } from '@shared/types.js';
import { BondType } from '@shared/types.js';
import { dissolveUnderageMateBonds, dissolveBondsToTheDead } from '../agents/relationships.js';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: migrationDryRun <path-to-state.json>');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(path, 'utf8')) as { agents: Agent[] };
const state = { agents: payload.agents } as unknown as WorldState;

function snapshotPairs(agents: Agent[]): Set<string> {
  const out = new Set<string>();
  for (const a of agents) {
    for (const rel of a.relationships) {
      if (rel.bond === BondType.Pair) out.add(`${a.id}->${rel.agentId}`);
    }
  }
  return out;
}

const byId = new Map(payload.agents.map((a) => [a.id, a]));
const before = snapshotPairs(payload.agents);

const underage = dissolveUnderageMateBonds(state);
const widowed = dissolveBondsToTheDead(state);

const after = snapshotPairs(payload.agents);
const removed = [...before].filter((k) => !after.has(k));

console.log(`\nPair-bond records before: ${before.size}`);
console.log(`  dissolveUnderageMateBonds released: ${underage}`);
console.log(`  dissolveBondsToTheDead released:    ${widowed}`);
console.log(`Pair-bond records after:  ${after.size}\n`);

console.log('released (one line per one-sided record):');
for (const key of removed) {
  const [fromId, toId] = key.split('->');
  const from = byId.get(fromId ?? '');
  const to = byId.get(toId ?? '');
  const desc = (x: Agent | undefined): string =>
    x === undefined ? '(unknown)' : `${x.name} ${x.familyName} ${x.age}${x.gender[0]?.toUpperCase()}${x.alive ? '' : ' [dead]'}`;
  console.log(`  ${desc(from)}  --x-->  ${desc(to)}`);
}

// Idempotency: a second pass must find nothing.
const again = dissolveUnderageMateBonds(state) + dissolveBondsToTheDead(state);
console.log(`\nsecond pass released: ${again}  (must be 0 — the migration is idempotent)`);

// Only pairs where BOTH partners are alive matter. A record still held BY a
// dead agent is inert — nothing reads the dead's relationships, and the living
// survivor's own record has already been released above — so listing those as
// "surviving" would overstate what is left.
const seen = new Set<string>();
const livePairs: Array<[Agent, Agent]> = [];
for (const key of after) {
  const [fromId, toId] = key.split('->');
  const a = byId.get(fromId ?? '');
  const b = byId.get(toId ?? '');
  if (a === undefined || b === undefined) continue;
  if (!a.alive || !b.alive) continue;
  const k = [a.id, b.id].sort().join('|');
  if (seen.has(k)) continue;
  seen.add(k);
  livePairs.push([a, b]);
}
console.log(`\nliving pair bonds that SURVIVE the migration: ${livePairs.length}`);
for (const [a, b] of livePairs) {
  const fertile = (x: Agent): boolean =>
    x.gender === 'female' ? x.age >= 16 && x.age <= 45 : x.age >= 16 && x.age <= 60;
  const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  const canBreed = a.gender !== b.gender && fertile(a) && fertile(b);
  console.log(
    `  ${a.name} ${a.age}${a.gender[0]?.toUpperCase()} + ${b.name} ${b.age}${b.gender[0]?.toUpperCase()}` +
      `  ${dist.toFixed(0)} tiles apart  ${canBreed ? 'CAN conceive' : 'cannot conceive'}`,
  );
}
