// simulation/audience/voteFirebase.ts
// The ONE Firebase-touching file for the audience-voting feature — every
// other module under simulation/audience/ stays Firebase-free and testable
// without a network connection or credentials (see
// simulation/scripts/voteEffectsCheck.ts).
//
// Two collections, two owners, never overlapping:
//   - voteCycles/{cycleId}  — sim-owned. The sim reads AND writes this (the
//     pinned type + targets for a cycle, written once at author time).
//   - voteTallies/{cycleId} — web-owned. The sim only ever READS this (the
//     vote counts a visitor ballot produced); it never writes it.
// No single document ever has two writers — see CLAUDE.md's hard rules.
//
// Reuses the SAME initialized Firebase Admin app/credential as the rest of
// the sim (simulation/firebase.ts's exported getApp()) — never a second app,
// never a second credential path.

import admin from 'firebase-admin';
import { getApp } from '../firebase.js';
import type { VoteType } from './voteEffects.js';

export interface VoteCycleDoc {
  cycleId: string;
  type: VoteType;
  targetIds: string[];
  flavorNames: string[];
  authoredAtTick: number;
  authoredAt: string; // ISO timestamp
}

export interface VoteTallyDoc {
  primary: number;
  secondary: number;
  withhold: number;
  total: number;
}

function voteCyclesCollection(): admin.firestore.CollectionReference {
  return admin.firestore(getApp()).collection('voteCycles');
}

function voteTalliesCollection(): admin.firestore.CollectionReference {
  return admin.firestore(getApp()).collection('voteTallies');
}

export async function readVoteCycle(cycleId: string): Promise<VoteCycleDoc | null> {
  try {
    const snap = await voteCyclesCollection().doc(cycleId).get();
    if (!snap.exists) return null;
    return snap.data() as VoteCycleDoc;
  } catch (err) {
    console.error(`Failed to read voteCycles/${cycleId}:`, err);
    return null;
  }
}

export async function readVoteTally(cycleId: string): Promise<VoteTallyDoc | null> {
  try {
    const snap = await voteTalliesCollection().doc(cycleId).get();
    if (!snap.exists) return null;
    return snap.data() as VoteTallyDoc;
  } catch (err) {
    console.error(`Failed to read voteTallies/${cycleId}:`, err);
    return null;
  }
}

// Create-if-absent: NEVER overwrites an existing voteCycles/{cycleId} doc.
// Without this, a sim restart mid-cycle could re-run the author step against
// a since-changed world state and silently re-pin a different target than
// the one already shown to voters. Firestore's DocumentReference.create()
// throws ALREADY_EXISTS (gRPC code 6) if the doc is already there — that's
// the expected, harmless case here, not an error.
export async function createVoteCycleIfAbsent(doc: VoteCycleDoc): Promise<void> {
  try {
    await voteCyclesCollection().doc(doc.cycleId).create(doc);
  } catch (err) {
    const code = (err as { code?: number | string } | null | undefined)?.code;
    if (code === 6 || code === 'already-exists') {
      return; // expected on restart — another author already pinned this cycle
    }
    console.error(`Failed to create voteCycles/${doc.cycleId}:`, err);
  }
}
