// lib/vote/types.ts
// Shared shapes for the audience-voting pipe. Kept tiny and dependency-free so
// both client code (useVote, VotePanel) and server code (the two API routes)
// can import it without pulling in Firebase or Next-server-only APIs.

// Option ids are deliberately generic (not tied to a specific agent id or
// effect). Phase 1 only counts breaths; phase 2 (a separate branch) is what
// gives an id like "primary" real-world meaning via voteCycles/{cycleId}.
export type VoteOptionId = 'primary' | 'secondary' | 'withhold';

export interface VoteOption {
  id: VoteOptionId;
  title: string;
  body: string;
}

export interface VotePrompt {
  templateId: string;
  kicker: string;
  prompt: string;
  options: [VoteOption, VoteOption, VoteOption];
}

export interface TallyCounts {
  primary: number;
  secondary: number;
  withhold: number;
  total: number;
}

// ── Sim-authored vote cycles (voteCycles/{cycleId}) ──────────────────────────
// Phase 1.5: a separate sim-side branch (feat/audience-sim) now picks the
// vote type and target(s) for each cycle and writes a decision doc at
// voteCycles/{cycleId}. The full contract also carries targetIds (internal
// sim agent/structure ids), worldDay, and openedAtTick — the browser never
// needs those, and targetIds specifically must never reach the client (see
// app/api/cycle/route.ts), so this type only captures what the web uses.
//
// 'wanderer' and 'bless' are sim-side types with no shipped web template yet
// (voteCopy.ts's promptForType returns null for them) — that's an approved,
// expected gap, not a bug. See voteCopy.ts for the fallback behavior.
export type VoteCycleType = 'steady' | 'bond' | 'wanderer' | 'cool' | 'bless';

export interface VoteCycleDoc {
  type: VoteCycleType;
  flavorNames: string[];
}
