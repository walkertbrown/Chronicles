// lib/vote/voteCycle.ts
// Phase-1 cycles are web-scheduled, not sim-scheduled: the cycle id is derived
// deterministically from wall-clock time, so every visitor (and the server)
// agrees on "which cycle is open" without a database round trip. One cycle =
// one world day = 6 real hours (see PLAN-audience-voting.md §A). This is a
// single config value (CYCLE_HOURS) — easy to retune later.
//
// Safe to import from both client and server code: no Node-only APIs here.

const CYCLE_HOURS = 6;
export const CYCLE_MS = CYCLE_HOURS * 60 * 60 * 1000;

/** The cycle id for "now" (or an arbitrary instant, for tests). */
export function currentCycleId(nowMs: number = Date.now()): string {
  return `c${Math.floor(nowMs / CYCLE_MS)}`;
}

/** The [start, end) wall-clock window a cycle id refers to, or null if the id
 *  isn't one of ours (e.g. a hand-picked test id like "test-2026-07-03"). */
export function cycleWindow(cycleId: string): { startMs: number; endMs: number } | null {
  const m = /^c(\d+)$/.exec(cycleId);
  if (m === null) return null;
  const idx = Number(m[1]);
  return { startMs: idx * CYCLE_MS, endMs: (idx + 1) * CYCLE_MS };
}

// Deliberately permissive: accepts both the "c<n>" cycles this module mints
// AND a hand-written id (e.g. a manual test cycle) — the write path's
// integrity comes from per-IP soft caps + one-vote-per-visitor, not from
// pinning every ballot to the live-computed window. See PLAN §C, §D.
const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidCycleId(id: string): boolean {
  return VALID_ID.test(id);
}

/** Deterministic small-int hash of a cycle id, used to rotate which owner-
 *  authored prompt template applies to a given cycle (voteCopy.ts). */
export function cycleHashIndex(cycleId: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < cycleId.length; i += 1) {
    h = (h * 31 + cycleId.charCodeAt(i)) >>> 0;
  }
  return h % modulo;
}
