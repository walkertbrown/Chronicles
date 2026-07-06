// simulation/scripts/checkpointRoundTrip.ts
// Lightweight round-trip check for the checkpoint persistence path. The
// wind-tunnel harness never exercises writeCheckpoint/loadCheckpoint (no
// Firestore, by design — see harness/run.ts's header comment), so a real
// checkpoint bug (a field silently missing from the persisted agent shape)
// is invisible to every sim-only test. This script proves the field survives
// the exact JSON+gzip transformation writeCheckpoint/loadCheckpoint use,
// without touching Firestore itself: it calls the real, exported
// serializeAgentForCheckpoint (the same function production uses), gzips +
// JSON-round-trips the result, and asserts the migration marker survives
// intact for a mid-trek agent and reads back as null for a settled one.
//
// Run with: node dist/simulation/scripts/checkpointRoundTrip.js (after `npm
// run build`). Exits 0 on success, 1 on any failed assertion.

import { gzipSync, gunzipSync } from 'node:zlib';
import type { Agent, Source } from '@shared/types.js';
import { serializeAgentForCheckpoint } from '../firebase.js';

function makeFakeAgent(overrides: Partial<Agent> = {}): Agent {
  const base: Agent = {
    id: 'agent_0',
    name: 'Test',
    familyName: 'Testerson',
    gender: 'female',
    age: 30,
    healthScore: 1.0,
    generation: 0,
    alive: true,
    position: { x: 1490, y: 1400 },
    home: { x: 1490, y: 1400 },
    drives: {
      hunger: 0.2,
      fatigue: 0.2,
      fear: 0.1,
      socialNeed: 0.1,
      grief: 0.05,
      longing: 0.1,
      wanderlust: 0.05,
    },
    traits: {
      curiosity: 0.6,
      courage: 0.5,
      nobility: 0.5,
      cunning: 0.5,
      endurance: 0.5,
      attraction: 0.5,
      aggression: 0.4,
      acuity: 0.5,
      sociability: 0.6,
    },
    skills: { hunting: 0.3, gathering: 0.3, building: 0.3, fire: 0.3, healing: 0.3 },
    inventory: { wood: 0, items: [] },
    relationships: [],
    lineage: { motherId: null, fatherId: null, children: [] },
    foundingHistory: null,
    conduitId: null,
    conduitBondType: null,
    currentAction: null,
    significanceScore: 0,
    chronicleThreadActive: false,
    chronicleChallenge: 0,
    chronicleFade: 0,
    lastChroniclePageMention: null,
    recentEvents: [],
    starvationTick: null,
    starvationSurvivalTicks: null,
    lastAteAtTick: null,
    lastDrankAtTick: null,
    discoveredTileIds: [],
    illnessState: null,
    animalAttackTick: null,
    lastViolenceTick: null,
    lastAttackerId: null,
    pregnancy: null,
  };
  return { ...base, ...overrides };
}

// Mirrors writeCheckpoint's blob construction and loadCheckpoint's blob
// reconstruction exactly (gzip a JSON string; gunzip and JSON.parse it back).
function roundTripThroughBlob<T>(value: T): T {
  const blob = gzipSync(Buffer.from(JSON.stringify(value)));
  return JSON.parse(gunzipSync(blob).toString('utf-8')) as T;
}

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}`);
  if (!ok) {
    failures += 1;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ---- Case 1: a mid-trek agent — the exact bug scenario the tester found ----
const migratingAgent = makeFakeAgent({
  id: 'agent_5',
  position: { x: 1480, y: 1350 },
  migration: { destX: 1520, destY: 1200, bestDist: 42, stuckTicks: 7 },
});
const serializedMigrating = serializeAgentForCheckpoint(migratingAgent);
const restoredMigrating = roundTripThroughBlob(serializedMigrating);

assertEqual('mid-trek agent: migration field present after round trip', restoredMigrating.migration != null, true);
assertEqual('mid-trek agent: destX survives', restoredMigrating.migration?.destX, 1520);
assertEqual('mid-trek agent: destY survives', restoredMigrating.migration?.destY, 1200);
assertEqual('mid-trek agent: bestDist survives', restoredMigrating.migration?.bestDist, 42);
assertEqual('mid-trek agent: stuckTicks survives', restoredMigrating.migration?.stuckTicks, 7);
assertEqual('mid-trek agent: id survives (sanity check on the wider round trip)', restoredMigrating.id, 'agent_5');
assertEqual('mid-trek agent: position survives (sanity check)', restoredMigrating.position, { x: 1480, y: 1350 });

// ---- Case 2: a settled (non-migrating) agent — migration must read back as
// null, never undefined/missing, matching the documented "absent/null both
// mean not migrating" contract with no backfill required. ----
const settledAgent = makeFakeAgent({ id: 'agent_6' });
const serializedSettled = serializeAgentForCheckpoint(settledAgent);
const restoredSettled = roundTripThroughBlob(serializedSettled);

assertEqual('settled agent: migration is explicitly null after round trip', restoredSettled.migration, null);

// ---- Case 1b: an agent mid-searching on a ruin expedition (agents/
// ruinExpedition.ts) — the near-identical bug scenario for the newer field.
// checkedTiles carries a couple of entries so the array (not just scalars)
// is proven to survive the gzip+JSON round trip intact. ----
const questingAgent = makeFakeAgent({
  id: 'agent_7',
  position: { x: 1500, y: 720 },
  ruinExpedition: {
    phase: 'searching',
    destX: 1503,
    destY: 715,
    homeX: 1480,
    homeY: 1350,
    bestDist: 5,
    stuckTicks: 3,
    checkedTiles: ['1498_722', '1501_718'],
    maxTilesToSearch: 4,
  },
});
const serializedQuesting = serializeAgentForCheckpoint(questingAgent);
const restoredQuesting = roundTripThroughBlob(serializedQuesting);

assertEqual('mid-expedition agent: ruinExpedition field present after round trip', restoredQuesting.ruinExpedition != null, true);
assertEqual('mid-expedition agent: phase survives', restoredQuesting.ruinExpedition?.phase, 'searching');
assertEqual('mid-expedition agent: destX/destY survive', [restoredQuesting.ruinExpedition?.destX, restoredQuesting.ruinExpedition?.destY], [1503, 715]);
assertEqual('mid-expedition agent: homeX/homeY survive', [restoredQuesting.ruinExpedition?.homeX, restoredQuesting.ruinExpedition?.homeY], [1480, 1350]);
assertEqual('mid-expedition agent: bestDist survives', restoredQuesting.ruinExpedition?.bestDist, 5);
assertEqual('mid-expedition agent: stuckTicks survives', restoredQuesting.ruinExpedition?.stuckTicks, 3);
assertEqual('mid-expedition agent: checkedTiles array survives intact', restoredQuesting.ruinExpedition?.checkedTiles, ['1498_722', '1501_718']);
assertEqual('mid-expedition agent: maxTilesToSearch survives', restoredQuesting.ruinExpedition?.maxTilesToSearch, 4);

// ---- Case 1c: a settled (non-questing) agent — ruinExpedition must read back
// as null, never undefined/missing, matching migration's own contract. ----
const settledQuestAgent = makeFakeAgent({ id: 'agent_8' });
const serializedSettledQuest = serializeAgentForCheckpoint(settledQuestAgent);
const restoredSettledQuest = roundTripThroughBlob(serializedSettledQuest);

assertEqual('settled agent: ruinExpedition is explicitly null after round trip', restoredSettledQuest.ruinExpedition, null);

// ---- Case 3: state.source, incl. the new extremeSinceTick field (source-contestable) ----
// Unlike agents, writeCheckpoint's `source: state.source` is a full object
// reference, not a hand-maintained field allowlist (see firebase.ts's
// checkpoint construction) — so there is no serializeSourceForCheckpoint to
// call here; this exercises the same gzip+JSON transformation directly on a
// Source-shaped object to confirm a new field on that interface survives the
// round trip the same way the allowlisted agent fields above do, and to catch
// it if `source` is ever changed to an allowlist pattern in the future.
const pinnedSource: Source = {
  position: { x: 1500, y: 700 },
  control: -1,
  extremeSinceTick: 12345,
};
const restoredPinnedSource = roundTripThroughBlob(pinnedSource);
assertEqual('pinned source: extremeSinceTick survives round trip', restoredPinnedSource.extremeSinceTick, 12345);
assertEqual('pinned source: control survives (sanity check)', restoredPinnedSource.control, -1);

const dormantSource: Source = {
  position: { x: 1500, y: 700 },
  control: 0,
  extremeSinceTick: null,
};
const restoredDormantSource = roundTripThroughBlob(dormantSource);
assertEqual('dormant source: extremeSinceTick is explicitly null after round trip', restoredDormantSource.extremeSinceTick, null);

console.log(failures === 0 ? '\nAll checkpoint round-trip checks passed.' : `\n${failures} checkpoint round-trip check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
