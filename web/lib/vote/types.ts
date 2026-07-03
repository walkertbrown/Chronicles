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
