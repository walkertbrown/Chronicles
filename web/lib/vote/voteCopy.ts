// lib/vote/voteCopy.ts
// Owner-authored, divinity-voice prompt copy for phase 1. No game-menu voice
// anywhere — see PLAN-audience-voting.md §A. Each template optionally draws a
// named agent (or a bonded pair) from the live /state snapshot for flavor;
// with no snapshot (or an empty world) every template degrades to a generic
// but still in-voice line.
//
// Option ids are always the same three values (primary / secondary /
// withhold) regardless of template — see types.ts for why: it keeps
// server-side validation trivial and template-agnostic. Which named agent a
// vote is "about" is flavor text only in phase 1; phase 2 is what gives an id
// a real target.
import type { AgentSnapshot, WorldSnapshot } from '../types';
import type { VoteCycleType, VoteOptionId, VotePrompt } from './types';
import { cycleHashIndex } from './voteCycle';

export const VALID_OPTION_IDS: readonly VoteOptionId[] = ['primary', 'secondary', 'withhold'];

export function isValidOptionId(id: string): id is VoteOptionId {
  return (VALID_OPTION_IDS as readonly string[]).includes(id);
}

function livingAgents(world: WorldSnapshot | null): AgentSnapshot[] {
  return world?.agents.filter((a) => a.alive) ?? [];
}

function fullName(a: AgentSnapshot): string {
  return `${a.name} ${a.familyName}`;
}

function findAgent(world: WorldSnapshot | null, id: string): AgentSnapshot | undefined {
  return world?.agents.find((a) => a.id === id);
}

// ── Template 1 — Blessing: steady a suffering soul ───────────────────────────
// Matches PLAN §A's worked example almost verbatim; §B vote type 1.
function struggleScore(a: AgentSnapshot): number {
  return a.drives.hunger * 0.5 + a.drives.fear * 0.3 + a.drives.grief * 0.2;
}

// Rendering is split from subject-selection so the same owner-authored copy
// backs both the client-derived path (world-computed subject, below) and the
// sim-authored path (promptForType, at the bottom of this file — the sim
// already picked the subject, it just needs rendering).
function renderBlessing(name: string): VotePrompt {
  return {
    templateId: 'blessing',
    kicker: 'A watcher’s breath may reach one soul this day.',
    prompt: `${name} has gone hungry, and their fear rises with the dark. Steady their heart — or let the world test them?`,
    options: [
      {
        id: 'primary',
        title: 'Steady their heart',
        body: 'A small relief, not a cure — they may never know why the fear lifted.',
      },
      {
        id: 'secondary',
        title: 'Let the world test them',
        body: 'No hand reaches down. Whatever comes, comes honestly.',
      },
      {
        id: 'withhold',
        title: 'Withhold your breath',
        body: 'The gods watch, and stay their hand. Let the world decide for itself.',
      },
    ],
  };
}

function blessingPrompt(world: WorldSnapshot | null): VotePrompt {
  const living = livingAgents(world);
  const subject = living.length > 0 ? [...living].sort((a, b) => struggleScore(b) - struggleScore(a))[0] : undefined;
  const name = subject !== undefined ? fullName(subject) : 'One soul among them';
  return renderBlessing(name);
}

// ── Template 2 — Favor a budding bond ────────────────────────────────────────
// §B vote type 2. "Budding" = meaningful trust that hasn't hardened into a
// named bond yet — a coarse read on the trust value alone, flavor only.
function pickBuddingPair(world: WorldSnapshot | null): { a: AgentSnapshot; b: AgentSnapshot } | undefined {
  const living = livingAgents(world);
  let best: { a: AgentSnapshot; b: AgentSnapshot; trust: number } | undefined;
  for (const a of living) {
    for (const rel of a.relationships) {
      if (rel.trust < 0.3 || rel.trust > 0.85) continue; // budding, not yet a settled bond
      const b = findAgent(world, rel.agentId);
      if (b === undefined || !b.alive) continue;
      if (best === undefined || rel.trust > best.trust) best = { a, b, trust: rel.trust };
    }
  }
  return best;
}

function renderBond(nameA: string, nameB: string): VotePrompt {
  return {
    templateId: 'bond',
    kicker: 'A watcher’s breath may favor one bond this day.',
    prompt: `${nameA} and ${nameB} have begun to trust one another, tentative as new saplings. Draw them together — or let distance judge it?`,
    options: [
      {
        id: 'primary',
        title: 'Draw them together',
        body: 'A small warmth, felt the next time their paths cross. They are not forced to it.',
      },
      {
        id: 'secondary',
        title: 'Let distance judge it',
        body: 'If the bond is real, it will hold without your hand on the scale.',
      },
      {
        id: 'withhold',
        title: 'Withhold your breath',
        body: 'Let their hearts find their own way, or not, unwatched.',
      },
    ],
  };
}

function bondPrompt(world: WorldSnapshot | null): VotePrompt {
  const pair = pickBuddingPair(world);
  const nameA = pair !== undefined ? fullName(pair.a) : 'One';
  const nameB = pair !== undefined ? fullName(pair.b) : 'another';
  return renderBond(nameA, nameB);
}

// ── Template 3 — Cool a rising conflict ──────────────────────────────────────
// §B vote type 4. Flavor-only proxy for "recent violence": high aggression
// paired with a low-trust relationship — not a claim that a fight actually
// happened, just a plausible in-world tension to hang the prompt on.
function pickTension(world: WorldSnapshot | null): { aggressor: AgentSnapshot; other: AgentSnapshot } | undefined {
  const living = livingAgents(world);
  const byAggression = [...living].sort((a, b) => b.traits.aggression - a.traits.aggression);
  for (const a of byAggression) {
    const worst = [...a.relationships].sort((x, y) => x.trust - y.trust)[0];
    if (worst === undefined || worst.trust >= 0.3) continue;
    const other = findAgent(world, worst.agentId);
    if (other === undefined || !other.alive) continue;
    return { aggressor: a, other };
  }
  return undefined;
}

function renderConflict(name: string, otherName: string): VotePrompt {
  return {
    templateId: 'conflict',
    kicker: 'A watcher’s breath may cool one temper this day.',
    prompt: `${name}’s temper runs hot toward ${otherName}, and trust between them is thin as ice. Cool the aggressor’s heart — or let it run its course?`,
    options: [
      {
        id: 'primary',
        title: 'Cool the aggressor’s heart',
        body: 'A small easing, one time only. Whatever drove the anger is still there.',
      },
      {
        id: 'secondary',
        title: 'Let it run its course',
        body: 'What happens next, happens for now. The chronicle will note it honestly.',
      },
      {
        id: 'withhold',
        title: 'Withhold your breath',
        body: 'Do not reach into this quarrel. Let the world settle its own debts.',
      },
    ],
  };
}

function conflictPrompt(world: WorldSnapshot | null): VotePrompt {
  const tension = pickTension(world);
  const name = tension !== undefined ? fullName(tension.aggressor) : 'One among them';
  const otherName = tension !== undefined ? fullName(tension.other) : 'another';
  return renderConflict(name, otherName);
}

const TEMPLATES: Array<(world: WorldSnapshot | null) => VotePrompt> = [blessingPrompt, bondPrompt, conflictPrompt];

/** Deterministically picks one of the owner-authored templates for a given
 *  cycle id, so every visitor in the same cycle sees the same prompt. This is
 *  the FALLBACK renderer — used whenever the sim hasn't authored a matching
 *  voteCycles/{cycleId} doc yet (see promptForType below for the primary,
 *  sim-authored path). Kept completely intact by Phase 1.5: still the only
 *  renderer for a cycle the sim never wrote to. */
export function getPromptForCycle(cycleId: string, world: WorldSnapshot | null): VotePrompt {
  const idx = cycleHashIndex(cycleId, TEMPLATES.length);
  return TEMPLATES[idx]!(world);
}

// ── Sim-authored prompts (Phase 1.5) ─────────────────────────────────────────
// Same owner-authored voice as above, but fed by the sim's own choice of
// target(s) (voteCycles/{cycleId}.flavorNames) instead of a locally-computed
// guess. Only 3 of the sim's 5 vote types have shipped web copy so far —
// 'steady'/'bond'/'cool' line up with the blessing/bond/conflict templates
// above; 'wanderer' and 'bless' are sim-side types with no web template yet
// (approved plan: "build all 5 sim-side effects now, web catches up on the
// missing 2 templates later"). promptForType returns null for those — the
// caller (useVote.ts) treats null exactly like "not authored" and falls back
// to getPromptForCycle, it never crashes or renders blank.
function nameOr(name: string | undefined, fallback: string): string {
  return name !== undefined && name.trim().length > 0 ? name : fallback;
}

const TYPE_RENDERERS: Partial<Record<VoteCycleType, (names: string[]) => VotePrompt>> = {
  steady: (names) => renderBlessing(nameOr(names[0], 'One soul among them')),
  bond: (names) => renderBond(nameOr(names[0], 'One'), nameOr(names[1], 'another')),
  cool: (names) => renderConflict(nameOr(names[0], 'One among them'), nameOr(names[1], 'another')),
};

/** Maps a sim-authored cycle (type + display name(s), from voteCycles/
 *  {cycleId}) onto the matching owner-authored template. Returns null when
 *  this type has no shipped web copy yet ('wanderer', 'bless') — the caller
 *  must treat that identically to "not authored" and fall back to
 *  getPromptForCycle. */
export function promptForType(type: VoteCycleType, flavorNames: string[]): VotePrompt | null {
  const render = TYPE_RENDERERS[type];
  return render !== undefined ? render(flavorNames) : null;
}
