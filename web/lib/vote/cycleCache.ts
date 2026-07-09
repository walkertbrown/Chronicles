// lib/vote/cycleCache.ts
// Same short in-memory cache as tallyCache.ts (~10s TTL), applied to the
// sim-authored cycle-doc read (app/api/cycle/route.ts) so a burst of visitors
// opening the vote panel in the same window doesn't each cost a Firestore
// read. Correct because the target hosting is a single self-hosted Node
// process (cost-watchdog amendment #2) — see tallyCache.ts for the full
// rationale; the same "must become a shared cache before Vercel/serverless"
// caveat applies here.
//
// Unlike tallyCache.ts, a "miss" here is itself a meaningful, cacheable
// result: a cycle the sim hasn't authored yet doesn't become authored
// moment-to-moment, so there's no reason to let a burst of "not authored"
// checks each hit Firestore. That means `null` is a valid CACHED value, not
// an absent one — so, unlike getCachedTally, getCachedCycle distinguishes
// "no entry / expired" (returns undefined) from "cached miss" (returns null)
// from "cached hit" (returns the doc).
import type { VoteCycleDoc } from './types';

const TTL_MS = 10_000;
const cache = new Map<string, { doc: VoteCycleDoc | null; expiresAt: number }>();

export function getCachedCycle(cycleId: string): VoteCycleDoc | null | undefined {
  const hit = cache.get(cycleId);
  if (hit === undefined || hit.expiresAt < Date.now()) return undefined;
  return hit.doc;
}

export function setCachedCycle(cycleId: string, doc: VoteCycleDoc | null): void {
  cache.set(cycleId, { doc, expiresAt: Date.now() + TTL_MS });
}
