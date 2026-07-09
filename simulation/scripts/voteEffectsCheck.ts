// simulation/scripts/voteEffectsCheck.ts
// Standalone, no-Firebase, no-network check for simulation/audience/. Mirrors
// scripts/checkpointRoundTrip.ts's style: constructs fake WorldState objects
// directly, exercises the real exported functions, and asserts exact
// mutations. Run with `npx tsx simulation/scripts/voteEffectsCheck.ts` or
// (after `npm run build`) `node dist/simulation/scripts/voteEffectsCheck.js`.
// Exits 0 on success, 1 on any failed assertion.

import type { Agent, Relationship, Resource, Structure, WorldState, WorldTile } from '@shared/types.js';
import { BondType, EventType, Season, StructureType, Terrain } from '@shared/types.js';
import { TileCacheImpl } from '../world/tileCache.js';
import { RELATIONSHIP_CONSTANTS } from '../agents/relationships.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import {
  EFFECTS,
  pickCycleType,
  resolveVote,
  type VoteEffectDef,
  type VoteType,
} from '../audience/voteEffects.js';
import { isCycleResolved, recordResolvedCycle } from '../audience/voteConsumer.js';
import type { VoteTargetResult } from '../audience/voteTargets.js';
import type { VoteCycleDoc } from '../audience/voteFirebase.js';

// ============================================================
// ASSERTION HELPERS
// ============================================================

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

function assertTrue(label: string, condition: boolean): void {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`);
  if (!condition) failures += 1;
}

// ============================================================
// FAKE STATE CONSTRUCTION
// ============================================================

let nextAgentSuffix = 0;

function makeFakeAgent(overrides: Partial<Agent> = {}): Agent {
  nextAgentSuffix += 1;
  const base: Agent = {
    id: `agent_${nextAgentSuffix}`,
    name: 'Test',
    familyName: `Family${nextAgentSuffix}`,
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

function makeFakeResource(current = 0.5, max = 1, regenRate = 0.001): Resource {
  return { current, max, regenRate };
}

function makeFakeTile(x: number, y: number, structure: Structure | null = null): WorldTile {
  return {
    x,
    y,
    terrain: Terrain.Plain,
    resources: {
      food: makeFakeResource(),
      water: makeFakeResource(),
      material: makeFakeResource(),
      game: makeFakeResource(),
      wood: makeFakeResource(),
    },
    ancientDensity: 0,
    artifacts: [],
    occupants: [],
    conduitIds: [],
    structure,
  };
}

function makeFakeState(overrides: Partial<WorldState> = {}): WorldState {
  // Seed 42 — the same seed production runs with, so the deterministic ruin
  // cluster used by the wanderer effect is guaranteed non-empty (real terrain
  // generation, no network — see world/tileCache.ts's generateTile).
  const seed = 42;
  const base: WorldState = {
    worldId: 'test_world',
    seed,
    tick: 1000,
    day: 20,
    year: 1,
    season: Season.Summer,
    ticksInCurrentSeason: 10,
    agents: [],
    tiles: new TileCacheImpl(seed),
    conduits: [],
    source: { position: { x: 0, y: 0 }, control: 0, extremeSinceTick: null },
    vessel: {
      id: 'vessel_0',
      position: { x: 0, y: 0 },
      integrity: 1,
      beached: true,
      resources: { food: makeFakeResource(), water: makeFakeResource() },
      items: [],
      helmsmanId: 'agent_helmsman',
    },
    eventLog: [],
    chroniclePages: [],
    lastCheckpoint: new Date().toISOString(),
    lastChronicleDay: -1,
    lastChronicleGeneratedAt: null,
    lastSummaryGeneratedAt: null,
    latestSummary: null,
    resolvedVoteCycleIds: [],
    lastAuthoredVoteCycleId: null,
  };
  return { ...base, ...overrides };
}

function relationship(overrides: Partial<Relationship> & { agentId: string }): Relationship {
  return {
    agentId: overrides.agentId,
    trust: overrides.trust ?? 0,
    bond: overrides.bond ?? BondType.None,
    interactionCount: overrides.interactionCount ?? 0,
    lastInteractionTick: overrides.lastInteractionTick ?? 0,
  };
}

function countAudienceBreathEvents(state: WorldState): number {
  return state.eventLog.filter((e) => e.type === EventType.AudienceBreath).length;
}

// ============================================================
// 1. STEADY
// ============================================================

{
  const low = makeFakeAgent({ id: 'agent_steady_low', drives: { hunger: 0.1, fatigue: 0.1, fear: 0.1, socialNeed: 0.1, grief: 0.1, longing: 0.1, wanderlust: 0.1 } });
  const high = makeFakeAgent({ id: 'agent_steady_high', drives: { hunger: 0.9, fatigue: 0.1, fear: 0.9, socialNeed: 0.1, grief: 0.9, longing: 0.1, wanderlust: 0.1 } });
  const state = makeFakeState({ agents: [low, high] });

  const target = EFFECTS.steady.selectTarget(state);
  assertEqual('steady: selects highest struggleScore agent', target?.targetIds, ['agent_steady_high']);

  const beforeFear = high.drives.fear;
  const beforeEvents = countAudienceBreathEvents(state);
  EFFECTS.steady.applyEffect(state, target!.targetIds);
  assertEqual('steady: fear reduced by exactly 0.08', high.drives.fear, Math.max(0, beforeFear - 0.08));
  assertEqual('steady: exactly one AudienceBreath event logged', countAudienceBreathEvents(state) - beforeEvents, 1);
}

// ============================================================
// 2. BOND
// ============================================================

{
  const a = makeFakeAgent({ id: 'agent_bond_a' });
  const b = makeFakeAgent({ id: 'agent_bond_b' });
  const c = makeFakeAgent({ id: 'agent_bond_c' });
  const d = makeFakeAgent({ id: 'agent_bond_d' });
  a.relationships = [relationship({ agentId: b.id, trust: 0.5, interactionCount: 3 })];
  b.relationships = [relationship({ agentId: a.id, trust: 0.5, interactionCount: 3 })];
  c.relationships = [relationship({ agentId: d.id, trust: 0.8, interactionCount: 2 })];
  d.relationships = [relationship({ agentId: c.id, trust: 0.8, interactionCount: 2 })];
  const state = makeFakeState({ agents: [a, b, c, d] });

  const target = EFFECTS.bond.selectTarget(state);
  // Deterministic order: bestPair is assembled lowest-id-first (see
  // selectBondTarget), so this is agent_bond_c then agent_bond_d, not a set.
  assertEqual('bond: selects the higher-trust not-yet-paired pair', target?.targetIds, ['agent_bond_c', 'agent_bond_d']);

  const beforeEvents = countAudienceBreathEvents(state);
  EFFECTS.bond.applyEffect(state, target!.targetIds);
  const relCD = c.relationships.find((r) => r.agentId === d.id)!;
  const relDC = d.relationships.find((r) => r.agentId === c.id)!;
  assertEqual('bond: trust raised by TRUST_LARGE on side A', relCD.trust, Math.min(RELATIONSHIP_CONSTANTS.TRUST_MAX, 0.8 + RELATIONSHIP_CONSTANTS.TRUST_LARGE));
  assertEqual('bond: trust raised by TRUST_LARGE on side B', relDC.trust, Math.min(RELATIONSHIP_CONSTANTS.TRUST_MAX, 0.8 + RELATIONSHIP_CONSTANTS.TRUST_LARGE));
  assertEqual('bond: interactionCount NOT incremented', relCD.interactionCount, 2);
  assertEqual('bond: exactly one AudienceBreath event logged', countAudienceBreathEvents(state) - beforeEvents, 1);

  // Promotion CAN happen (not forced) if the pair separately already has
  // enough interactions by resolve time.
  const e = makeFakeAgent({ id: 'agent_bond_e' });
  const f = makeFakeAgent({ id: 'agent_bond_f' });
  e.relationships = [relationship({ agentId: f.id, trust: 0.66, interactionCount: RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS })];
  f.relationships = [relationship({ agentId: e.id, trust: 0.66, interactionCount: RELATIONSHIP_CONSTANTS.PAIR_BOND_MIN_INTERACTIONS })];
  const promoState = makeFakeState({ agents: [e, f] });
  EFFECTS.bond.applyEffect(promoState, [e.id, f.id]); // 0.66 + 0.06 = 0.72 >= PAIR_BOND_THRESHOLD (0.7), interactions already sufficient
  const relEF = e.relationships.find((r) => r.agentId === f.id)!;
  assertEqual('bond: promotion CAN fire when interactions already sufficient', relEF.bond, BondType.Pair);
}

// ============================================================
// 3. WANDERER
// ============================================================

{
  const eligibleDrives = { hunger: 0.1, fatigue: 0.1, fear: 0.1, socialNeed: 0.1, grief: 0.1, longing: 0.1, wanderlust: 0.1 };
  const lowCuriosity = makeFakeAgent({ id: 'agent_wander_low', age: 25, traits: { curiosity: 0.7, courage: 0.5, nobility: 0.5, cunning: 0.5, endurance: 0.5, attraction: 0.5, aggression: 0.4, acuity: 0.5, sociability: 0.6 }, drives: { ...eligibleDrives } });
  const highCuriosity = makeFakeAgent({ id: 'agent_wander_high', age: 25, traits: { curiosity: 0.9, courage: 0.5, nobility: 0.5, cunning: 0.5, endurance: 0.5, attraction: 0.5, aggression: 0.4, acuity: 0.5, sociability: 0.6 }, drives: { ...eligibleDrives } });
  const state = makeFakeState({ agents: [lowCuriosity, highCuriosity] });

  const target = EFFECTS.wanderer.selectTarget(state);
  assertEqual('wanderer: selects the most ruin-eligible, highest-curiosity agent', target?.targetIds, ['agent_wander_high']);

  const beforeEvents = countAudienceBreathEvents(state);
  EFFECTS.wanderer.applyEffect(state, target!.targetIds);
  assertTrue('wanderer: ruinExpedition marker seeded', highCuriosity.ruinExpedition != null);
  assertEqual('wanderer: marker phase is outbound', highCuriosity.ruinExpedition?.phase, 'outbound');
  assertEqual('wanderer: exactly one AudienceBreath event logged', countAudienceBreathEvents(state) - beforeEvents, 1);

  // A second call must no-op (already trekking) — no marker clobber, no event.
  const destBefore = { x: highCuriosity.ruinExpedition!.destX, y: highCuriosity.ruinExpedition!.destY };
  const beforeEvents2 = countAudienceBreathEvents(state);
  EFFECTS.wanderer.applyEffect(state, target!.targetIds);
  assertEqual('wanderer: re-applying to an already-trekking agent does not change the destination', { x: highCuriosity.ruinExpedition!.destX, y: highCuriosity.ruinExpedition!.destY }, destBefore);
  assertEqual('wanderer: re-applying to an already-trekking agent logs no new event', countAudienceBreathEvents(state) - beforeEvents2, 0);
}

// ============================================================
// 4. COOL
// ============================================================

{
  const recentlyViolent = makeFakeAgent({ id: 'agent_cool_recent', traits: { curiosity: 0.5, courage: 0.5, nobility: 0.5, cunning: 0.5, endurance: 0.5, attraction: 0.5, aggression: 0.6, acuity: 0.5, sociability: 0.5 }, lastViolenceTick: 990 });
  const oldViolence = makeFakeAgent({ id: 'agent_cool_old', traits: { curiosity: 0.5, courage: 0.5, nobility: 0.5, cunning: 0.5, endurance: 0.5, attraction: 0.5, aggression: 0.9, acuity: 0.5, sociability: 0.5 }, lastViolenceTick: 100 });
  const state = makeFakeState({ agents: [recentlyViolent, oldViolence], tick: 1000 });
  assertTrue('cool: fixture window sanity — recent violence within window', state.tick - 990 <= 2 * TICKS_PER_DAY);
  assertTrue('cool: fixture window sanity — old violence outside window', state.tick - 100 > 2 * TICKS_PER_DAY);

  const target = EFFECTS.cool.selectTarget(state);
  assertEqual('cool: prefers recent violence over higher aggression outside the window', target?.targetIds, ['agent_cool_recent']);

  const beforeAgg = recentlyViolent.traits.aggression;
  const beforeEvents = countAudienceBreathEvents(state);
  EFFECTS.cool.applyEffect(state, target!.targetIds);
  assertEqual('cool: aggression reduced by exactly 0.05', recentlyViolent.traits.aggression, Math.max(0, beforeAgg - 0.05));
  assertEqual('cool: exactly one AudienceBreath event logged', countAudienceBreathEvents(state) - beforeEvents, 1);

  // Fallback: no recent violence anywhere — highest-aggression rival-holder wins.
  const rivalHolder = makeFakeAgent({ id: 'agent_cool_rival', traits: { curiosity: 0.5, courage: 0.5, nobility: 0.5, cunning: 0.5, endurance: 0.5, attraction: 0.5, aggression: 0.5, acuity: 0.5, sociability: 0.5 } });
  const other = makeFakeAgent({ id: 'agent_cool_z' });
  rivalHolder.relationships = [relationship({ agentId: other.id, trust: -0.6, bond: BondType.Rival, interactionCount: 8 })];
  const bystander = makeFakeAgent({ id: 'agent_cool_bystander', traits: { curiosity: 0.5, courage: 0.5, nobility: 0.5, cunning: 0.5, endurance: 0.5, attraction: 0.5, aggression: 0.95, acuity: 0.5, sociability: 0.5 } });
  const fallbackState = makeFakeState({ agents: [rivalHolder, other, bystander] });
  const fallbackTarget = EFFECTS.cool.selectTarget(fallbackState);
  assertEqual('cool: falls back to highest-aggression agent with a rival relationship', fallbackTarget?.targetIds, ['agent_cool_rival']);
}

// ============================================================
// 5. BLESS
// ============================================================

{
  const builder = makeFakeAgent({ id: 'agent_bless_builder' });
  const lowProgress: Structure = { type: StructureType.Shelter, progress: 0.3, woodInvested: 0.3, builderIds: [builder.id], fireFuel: 0 };
  const highProgress: Structure = { type: StructureType.Shelter, progress: 0.8, woodInvested: 0.8, builderIds: [builder.id], fireFuel: 0 };
  const state = makeFakeState({ agents: [builder] });
  state.tiles.set(100, 100, makeFakeTile(100, 100, lowProgress));
  state.tiles.set(200, 200, makeFakeTile(200, 200, highProgress));

  const target = EFFECTS.bless.selectTarget(state);
  assertEqual('bless: selects the highest-progress mid-construction structure', target?.targetIds, ['200_200']);

  const beforeEvents = countAudienceBreathEvents(state);
  EFFECTS.bless.applyEffect(state, target!.targetIds);
  assertEqual('bless: progress advanced by exactly 0.10', highProgress.progress, 0.9);
  assertEqual('bless: the other structure is untouched', lowProgress.progress, 0.3);
  assertEqual('bless: exactly one AudienceBreath event logged', countAudienceBreathEvents(state) - beforeEvents, 1);

  // Clamped at 1 — never overshoots.
  highProgress.progress = 0.95;
  EFFECTS.bless.applyEffect(state, target!.targetIds);
  assertEqual('bless: progress clamps at 1', highProgress.progress, 1);
}

// ============================================================
// 6. AUTHOR-TIME IDEMPOTENCY (create-if-absent, conceptual)
// A sim restart mid-cycle must never re-pin a different target for a cycle
// voters are already seeing, even if pickCycleType would now select
// differently against the (since-changed) world state. voteFirebase.ts
// enforces this with a real Firestore .create() (ALREADY_EXISTS on retry);
// this section proves the invariant the same way, in memory.
// ============================================================

{
  const fakeStore = new Map<string, VoteCycleDoc>();
  function fakeCreateIfAbsent(doc: VoteCycleDoc): void {
    if (!fakeStore.has(doc.cycleId)) fakeStore.set(doc.cycleId, doc);
  }
  function toDoc(cycleId: string, picked: { type: VoteType; targetIds: string[]; flavorNames: string[] }): VoteCycleDoc {
    return { cycleId, type: picked.type, targetIds: picked.targetIds, flavorNames: picked.flavorNames, authoredAtTick: 0, authoredAt: '' };
  }

  const strugglingFirst = makeFakeAgent({ id: 'agent_idem_first', drives: { hunger: 0.9, fatigue: 0.1, fear: 0.9, socialNeed: 0.1, grief: 0.9, longing: 0.1, wanderlust: 0.1 } });
  const calmSecond = makeFakeAgent({ id: 'agent_idem_second', drives: { hunger: 0.1, fatigue: 0.1, fear: 0.1, socialNeed: 0.1, grief: 0.1, longing: 0.1, wanderlust: 0.1 } });
  const state = makeFakeState({ agents: [strugglingFirst, calmSecond] });

  const cycleId = 'c500'; // 500 % 5 === 0 → rotates to 'steady' first
  const picked1 = pickCycleType(state, cycleId);
  assertEqual('idempotency: first author call pins agent_idem_first (steady)', picked1?.targetIds, ['agent_idem_first']);
  fakeCreateIfAbsent(toDoc(cycleId, picked1!));

  // World state changes — the OTHER agent is now the highest-struggle agent.
  strugglingFirst.drives.hunger = 0.1;
  strugglingFirst.drives.fear = 0.1;
  strugglingFirst.drives.grief = 0.1;
  calmSecond.drives.hunger = 0.9;
  calmSecond.drives.fear = 0.9;
  calmSecond.drives.grief = 0.9;

  const picked2 = pickCycleType(state, cycleId);
  assertEqual('idempotency: a second raw select call WOULD now pick differently', picked2?.targetIds, ['agent_idem_second']);

  // But a second "author" attempt (mirroring a sim restart) must not change
  // what was already pinned.
  fakeCreateIfAbsent(toDoc(cycleId, picked2!));
  assertEqual('idempotency: create-if-absent keeps the ORIGINAL pinned target', fakeStore.get(cycleId)?.targetIds, ['agent_idem_first']);
}

// ============================================================
// 7. RESOLVE-TIME NO-OP FOR AN ALREADY-RESOLVED CYCLE + 64-ENTRY BOUND
// ============================================================

{
  const state = makeFakeState({});
  assertEqual('resolve: a fresh cycle id is not resolved', isCycleResolved(state, 'c777'), false);
  recordResolvedCycle(state, 'c777');
  assertEqual('resolve: after recording, the same cycle id reads as resolved (the guard that makes a second resolve a no-op)', isCycleResolved(state, 'c777'), true);

  const boundedState = makeFakeState({});
  for (let i = 0; i < 70; i++) recordResolvedCycle(boundedState, `c${i}`);
  assertEqual('resolve: resolvedVoteCycleIds is bounded to the last 64 entries', boundedState.resolvedVoteCycleIds.length, 64);
  assertEqual('resolve: bounding keeps the most recent entries', boundedState.resolvedVoteCycleIds[boundedState.resolvedVoteCycleIds.length - 1], 'c69');
  assertEqual('resolve: bounding drops the oldest entries', boundedState.resolvedVoteCycleIds.includes('c0'), false);
}

// ============================================================
// 8. resolveVote end-to-end (invalid target → no-op)
// ============================================================

{
  const deadAgent = makeFakeAgent({ id: 'agent_dead', alive: false, drives: { hunger: 0.9, fatigue: 0.1, fear: 0.9, socialNeed: 0.1, grief: 0.9, longing: 0.1, wanderlust: 0.1 } });
  const state = makeFakeState({ agents: [deadAgent] });
  const beforeEvents = countAudienceBreathEvents(state);
  const applied = resolveVote(state, 'steady', [deadAgent.id]);
  assertEqual('resolveVote: refuses to apply to a no-longer-valid (dead) target', applied, false);
  assertEqual('resolveVote: no event logged for a refused resolution', countAudienceBreathEvents(state) - beforeEvents, 0);
}

// ============================================================
// 9. NO RNG — verified at the type-signature level (won't compile if any
// selectTarget/applyEffect grows a required rng parameter) AND at runtime
// (declared-parameter count via Function.length).
// ============================================================

{
  type SelectTargetFn = (state: WorldState) => VoteTargetResult | null;
  type ApplyEffectFn = (state: WorldState, targetIds: string[]) => void;

  const allDefs: VoteEffectDef[] = Object.values(EFFECTS);
  for (const def of allDefs) {
    // Assignability check: fails to compile if selectTarget/applyEffect ever
    // grows an extra REQUIRED parameter (e.g. an rng function) — a function
    // requiring more parameters than its target type declares is not
    // assignable in TypeScript.
    const selectCheck: SelectTargetFn = def.selectTarget;
    const applyCheck: ApplyEffectFn = def.applyEffect;
    void selectCheck;
    void applyCheck;

    assertEqual(`no-rng (type level, runtime arity): ${def.id}.selectTarget declares exactly 1 parameter`, def.selectTarget.length, 1);
    assertEqual(`no-rng (type level, runtime arity): ${def.id}.applyEffect declares exactly 2 parameters`, def.applyEffect.length, 2);
  }
}

console.log(failures === 0 ? '\nAll vote-effects checks passed.' : `\n${failures} vote-effects check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
