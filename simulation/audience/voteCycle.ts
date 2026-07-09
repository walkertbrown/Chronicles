// simulation/audience/voteCycle.ts
// Wall-clock cycle-id helpers for the audience-voting feature. 1 cycle = 6
// real hours = 1 world day (matching the web's ballot-box cadence — see
// CLAUDE.md's audience-voting-plan memory). Pure math, no state, no I/O.

const CYCLE_MS = 6 * 60 * 60 * 1000;

// "c" + floor(now_ms / 6h) — the currently open cycle at the given wall-clock
// timestamp. Monotonic in real time; independent of the sim's own tick clock
// so a restart resumes into the correct real-world cycle regardless of how
// long the sim was down.
export function currentCycleId(nowMs: number): string {
  return `c${Math.floor(nowMs / CYCLE_MS)}`;
}

// Parses the integer N out of a "c<N>" cycle id. Returns 0 for a malformed
// id (defensive — should never happen since every id this module produces is
// well-formed) rather than NaN, so downstream modulo/rotation math stays safe.
export function cycleIndex(cycleId: string): number {
  const n = Number(cycleId.slice(1));
  return Number.isFinite(n) ? n : 0;
}

export function previousCycleId(cycleId: string): string {
  return `c${cycleIndex(cycleId) - 1}`;
}
