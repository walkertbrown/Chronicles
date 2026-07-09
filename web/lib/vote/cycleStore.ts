// lib/vote/cycleStore.ts
// Where the sim's per-cycle authored decision lives: voteCycles/{cycleId},
// written by the sim (feat/audience-sim, a separate in-progress branch) at
// the start of each cycle. Unlike voteTallies/{cycleId} (tallyStore.ts,
// written by this app's own /api/vote), the web NEVER writes voteCycles/* —
// this module is read-only from the web's side; there is no recordVote-style
// export here.
//
// When FIREBASE_SERVICE_ACCOUNT isn't set (e.g. this sandbox, or a fresh dev
// checkout before the owner wires the secret in), falls back to an in-memory
// stub store, mirroring tallyStore.ts's stub mode. Because the web has no
// natural write path into voteCycles/*, setStubVoteCycle() exists purely for
// local dev/verification (seed a fake sim decision to exercise the read path
// end to end without real Firebase creds or the sim running) — production
// code never calls it. An unseeded stub, exactly like a real-but-not-yet-
// authored Firestore doc, resolves to null.
import { getVoteFirestore, isFirebaseConfigured } from '../firebaseAdmin';
import type { VoteCycleDoc, VoteCycleType } from './types';

const VALID_TYPES: readonly VoteCycleType[] = ['steady', 'bond', 'wanderer', 'cool', 'bless'];

function isVoteCycleType(v: unknown): v is VoteCycleType {
  return typeof v === 'string' && (VALID_TYPES as readonly string[]).includes(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

const stub = new Map<string, VoteCycleDoc>();

/** Dev/verification only — seeds the in-memory stub so /api/cycle can be
 *  exercised locally without real Firebase creds or the sim running. */
export function setStubVoteCycle(cycleId: string, doc: VoteCycleDoc): void {
  stub.set(cycleId, doc);
}

/** Returns the sim's authored decision for a cycle, or null if it hasn't
 *  authored one yet (sim down, sim not deployed, or this cycle simply
 *  hasn't opened sim-side). null is a normal, expected result — callers
 *  treat it as "fall back to the client-derived prompt," not an error.
 *  A doc with an unrecognized `type` (a future sim vote type this web build
 *  predates) is also treated as null rather than surfaced malformed. */
export async function readVoteCycle(cycleId: string): Promise<VoteCycleDoc | null> {
  if (isFirebaseConfigured()) {
    const db = getVoteFirestore();
    const snap = await db.collection('voteCycles').doc(cycleId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (!isVoteCycleType(data.type)) return null;
    return {
      type: data.type,
      flavorNames: isStringArray(data.flavorNames) ? data.flavorNames : [],
    };
  }

  return stub.get(cycleId) ?? null;
}
