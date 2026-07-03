// lib/vote/tallyCache.ts
// Plain in-memory cache with a ~10s TTL — correct because the target hosting
// is a single self-hosted Node process (cost-watchdog amendment #2). This is
// what collapses a traffic spike's live-tally reads to a few per 10s instead
// of one per visitor (PLAN §F/§G).
//
// IMPORTANT: if hosting ever moves to Vercel/serverless, a bare module
// variable is per-instance and caps nothing — this MUST become a shared
// cache (route-segment revalidate or KV) before that move.
import type { TallyCounts } from './types';

const TTL_MS = 10_000;
const cache = new Map<string, { counts: TallyCounts; expiresAt: number }>();

export function getCachedTally(cycleId: string): TallyCounts | null {
  const hit = cache.get(cycleId);
  if (hit === undefined || hit.expiresAt < Date.now()) return null;
  return hit.counts;
}

export function setCachedTally(cycleId: string, counts: TallyCounts): void {
  cache.set(cycleId, { counts, expiresAt: Date.now() + TTL_MS });
}
