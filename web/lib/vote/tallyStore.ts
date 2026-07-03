// lib/vote/tallyStore.ts
// Where ballot counts live. The write path stays exactly ONE Firestore op — a
// single atomic FieldValue.increment(), never a read-then-write transaction
// (cost-watchdog amendment). Path is voteTallies/{cycleId}, entirely separate
// from the checkpoint doc (worlds/world_sample_01) and the /live RTDB node.
//
// When FIREBASE_SERVICE_ACCOUNT isn't set (e.g. this sandbox, or a fresh dev
// checkout before the owner wires the secret in), falls back to an in-memory
// stub store so the rest of the pipe (routes, hook, panel) can still be
// exercised end to end locally. The stub never touches disk or a real
// database and resets whenever the process restarts.
import { FieldValue, getVoteFirestore, isFirebaseConfigured } from '../firebaseAdmin';
import type { TallyCounts, VoteOptionId } from './types';

function emptyCounts(): TallyCounts {
  return { primary: 0, secondary: 0, withhold: 0, total: 0 };
}

const stub = new Map<string, TallyCounts>();

export async function recordVote(cycleId: string, optionId: VoteOptionId): Promise<void> {
  if (isFirebaseConfigured()) {
    const db = getVoteFirestore();
    await db
      .collection('voteTallies')
      .doc(cycleId)
      .set(
        {
          [optionId]: FieldValue.increment(1),
          total: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    return;
  }

  const cur = stub.get(cycleId) ?? emptyCounts();
  cur[optionId] += 1;
  cur.total += 1;
  stub.set(cycleId, cur);
}

export async function readTally(cycleId: string): Promise<TallyCounts> {
  if (isFirebaseConfigured()) {
    const db = getVoteFirestore();
    const snap = await db.collection('voteTallies').doc(cycleId).get();
    if (!snap.exists) return emptyCounts();
    const data = snap.data() ?? {};
    return {
      primary: numberOr(data.primary),
      secondary: numberOr(data.secondary),
      withhold: numberOr(data.withhold),
      total: numberOr(data.total),
    };
  }

  return stub.get(cycleId) ?? emptyCounts();
}

function numberOr(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
