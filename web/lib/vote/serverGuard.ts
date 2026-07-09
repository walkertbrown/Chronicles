// lib/vote/serverGuard.ts
// Vote integrity, hobby scale — PLAN-audience-voting.md §C and the cost-
// watchdog amendments. Everything here is in-process memory, never Firestore:
// the vote-casting path stays exactly ONE Firestore op (see tallyStore.ts).
//
// Server-only (uses node:crypto + NextRequest). Never import from client code.
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

const MAX_PER_MINUTE = 8; // per-IP-per-minute rate cap
const MAX_PER_CYCLE = 5; // soft per-IP cap per cycle (PLAN says 3–5)
const MAX_TRACKED_IPS = 20_000; // bound memory on a long-running single process

interface Bucket {
  minuteWindowStart: number;
  minuteCount: number;
  cycleCounts: Map<string, number>;
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();

/** Basic bot friction: same-origin only. Permissive when neither Origin nor
 *  Referer is present (some privacy-hardened clients strip both) — hobby
 *  scale doesn't warrant a captcha unless actually abused (PLAN §C). */
export function sameOriginOk(req: NextRequest): boolean {
  const host = req.headers.get('host');
  if (host === null) return true; // nothing to compare against; don't block

  const origin = req.headers.get('origin');
  if (origin !== null) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.get('referer');
  if (referer !== null) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return true;
}

/** Hashed IP — no PII stored, in memory or otherwise (PLAN §C). Reads
 *  x-forwarded-for / x-real-ip, which a reverse proxy in front of the
 *  self-hosted process is expected to set (see web/README self-hosting note). */
export function clientIpHash(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd !== null ? (fwd.split(',')[0] ?? 'unknown').trim() : (req.headers.get('x-real-ip') ?? 'unknown');
  return createHash('sha256').update(ip).digest('hex');
}

/** Returns true if this vote is allowed, and records it. False = over a soft
 *  cap; the caller responds with a gentle "the world is catching its breath". */
export function checkAndRecordVote(ipHash: string, cycleId: string): boolean {
  const now = Date.now();
  pruneIfNeeded(now);

  let b = buckets.get(ipHash);
  if (b === undefined) {
    b = { minuteWindowStart: now, minuteCount: 0, cycleCounts: new Map(), lastSeen: now };
    buckets.set(ipHash, b);
  }
  b.lastSeen = now;

  if (now - b.minuteWindowStart > 60_000) {
    b.minuteWindowStart = now;
    b.minuteCount = 0;
  }
  if (b.minuteCount >= MAX_PER_MINUTE) return false;

  const cycleCount = b.cycleCounts.get(cycleId) ?? 0;
  if (cycleCount >= MAX_PER_CYCLE) return false;

  b.minuteCount += 1;
  b.cycleCounts.set(cycleId, cycleCount + 1);
  return true;
}

function pruneIfNeeded(now: number): void {
  if (buckets.size < MAX_TRACKED_IPS) return;
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [key, b] of buckets) {
    if (b.lastSeen < cutoff) buckets.delete(key);
  }
}
