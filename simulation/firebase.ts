import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChronicleEntry, WorldState } from '@shared/types.js';
import { TileCacheImpl } from './world/tileCache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let initialized = false;

function getApp(): admin.app.App {
  if (!initialized) {
    let serviceAccount: object;

    const envJson = process.env['FIREBASE_SERVICE_ACCOUNT'];
    if (envJson !== undefined && envJson.length > 0) {
      // Cloud Run — service account JSON passed as environment variable
      serviceAccount = JSON.parse(envJson);
    } else {
      // Local development — read from file
      const serviceAccountPath = resolve(__dirname, '../../firebase-service-account.json');
      serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      databaseURL: 'https://chronicles-14b34-default-rtdb.firebaseio.com',
    });
    initialized = true;
  }
  return admin.app();
}

export async function writeCheckpoint(state: WorldState): Promise<void> {
  try {
    const app = getApp();
    const db = admin.firestore(app);
    const doc = db.collection('worlds').doc(state.worldId);
    // Firestore has a 1MB document limit — strip heavy arrays before writing
    const checkpoint = {
      worldId: state.worldId,
      tick: state.tick,
      day: state.day,
      year: state.year,
      season: state.season,
      lastCheckpoint: new Date().toISOString(),
      population: state.agents.filter((a) => a.alive).length,
      agents: state.agents.map((a) => ({
        id: a.id,
        name: a.name,
        familyName: a.familyName,
        alive: a.alive,
        age: a.age,
        gender: a.gender,
        generation: a.generation,
        position: a.position,
        home: a.home ?? a.position,
        drives: a.drives,
        traits: a.traits,
        skills: a.skills,
        significanceScore: a.significanceScore,
        chronicleThreadActive: a.chronicleThreadActive,
        illnessState: a.illnessState,
        lineage: a.lineage,
        foundingHistory: a.foundingHistory,
        conduitId: a.conduitId,
        conduitBondType: a.conduitBondType,
        lastChroniclePageMention: a.lastChroniclePageMention,
        healthScore: a.healthScore,
        relationships: a.relationships,
        recentEvents: a.recentEvents.slice(-10),
        starvationTick: a.starvationTick,
        starvationSurvivalTicks: a.starvationSurvivalTicks,
        lastAteAtTick: a.lastAteAtTick,
        lastDrankAtTick: a.lastDrankAtTick,
        animalAttackTick: a.animalAttackTick,
      })),
      vessel: state.vessel,
      conduits: state.conduits,
      tiles: state.tiles.serialize(),
      chroniclePages: state.chroniclePages,
      latestSummary: state.latestSummary,
      lastChronicleGeneratedAt: state.lastChronicleGeneratedAt,
      lastSummaryGeneratedAt: state.lastSummaryGeneratedAt,
      eventLog: state.eventLog.slice(-500),
    };
    await doc.set(checkpoint);
    console.log(`Checkpoint written at tick ${state.tick}`);
  } catch (err) {
    console.error('Checkpoint write failed:', err);
  }
}

export async function writeAgentPositions(state: WorldState): Promise<void> {
  try {
    const app = getApp();
    const db = admin.database(app);
    const ref = db.ref(`worlds/${state.worldId}/live`);
    await ref.set({
      tick: state.tick,
      day: state.day,
      year: state.year,
      season: state.season,
      population: state.agents.filter((a) => a.alive).length,
      vessel: {
        beached: state.vessel.beached,
        position: state.vessel.position,
      },
      agents: state.agents
        .filter((a) => a.alive)
        .map((a) => ({
          id: a.id,
          name: a.name,
          familyName: a.familyName,
          position: a.position,
          chronicleThreadActive: a.chronicleThreadActive,
          hunger: a.drives.hunger,
          fear: a.drives.fear,
        })),
      conduits: state.conduits
        .filter((c) => c.bondedAgentId !== null)
        .map((c) => ({
          id: c.id,
          position: c.position,
          bondedAgentId: c.bondedAgentId,
          bondType: c.bondType,
        })),
    });
  } catch (err) {
    // Non-blocking — don't crash the tick loop
    console.error('Live position write failed:', err);
  }
}

export async function loadCheckpoint(worldId: string): Promise<WorldState | null> {
  try {
    const app = getApp();
    const db = admin.firestore(app);
    const doc = await db.collection('worlds').doc(worldId).get();
    if (!doc.exists) {
      console.log('No checkpoint found — starting fresh.');
      return null;
    }
    const raw = doc.data() as Omit<WorldState, 'tiles'> & { tiles: import('@shared/types.js').TileCacheData };
    const tiles = TileCacheImpl.deserialize(raw.tiles);
    const state = { ...raw, tiles } as WorldState;
    console.log(`Checkpoint loaded — tick ${state.tick}, day ${state.day}`);
    return state;
  } catch (err) {
    console.error('Failed to load checkpoint:', err);
    return null;
  }
}

function chronicleCollection(worldId: string): admin.firestore.CollectionReference {
  const db = admin.firestore(getApp());
  return db.collection('worlds').doc(worldId).collection('chronicle');
}

export async function isChronicleCollectionEmpty(worldId: string): Promise<boolean> {
  try {
    const snap = await chronicleCollection(worldId).limit(1).get();
    return snap.empty;
  } catch (err) {
    console.error('Chronicle collection check failed:', err);
    return true;
  }
}

export async function writeChronicleDocument(
  worldId: string,
  page: ChronicleEntry & { id: string; order: number },
): Promise<void> {
  try {
    await chronicleCollection(worldId).doc(page.id).set(page);
  } catch (err) {
    console.error(`Chronicle write failed for ${page.id}:`, err);
    throw err;
  }
}

export async function fetchChroniclePages(worldId: string): Promise<ChronicleEntry[]> {
  try {
    const snap = await chronicleCollection(worldId).get();
    return snap.docs.map((doc) => doc.data() as ChronicleEntry);
  } catch (err) {
    console.error('Chronicle fetch failed:', err);
    return [];
  }
}

export async function getChroniclePages(state: WorldState): Promise<ChronicleEntry[]> {
  const fromFirestore = await fetchChroniclePages(state.worldId);
  const merged = new Map<string, ChronicleEntry>();

  for (const page of state.chroniclePages) {
    merged.set(page.id ?? `${page.day}-${page.generatedAt}`, page);
  }
  for (const page of fromFirestore) {
    merged.set(page.id ?? `${page.day}-${page.generatedAt}`, page);
  }

  return [...merged.values()].sort(
    (a, b) => (a.order ?? a.day) - (b.order ?? b.day),
  );
}
