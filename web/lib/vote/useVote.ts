'use client';
// lib/vote/useVote.ts
// Client hook backing VotePanel: figures out the live cycle, loads its tally,
// casts a ballot, and remembers "already breathed" across reloads.
//
// Cost-watchdog amendment #1 (hard requirement): fetch /api/tally on open,
// once immediately after casting, and at most every 30s while the panel
// stays open. NEVER inherit the 1s polling habit from app/world/page.tsx.
//
// Phase 1.5: also fetches /api/cycle once on open (no polling — the sim
// authors a cycle's decision once, at cycle-open, so it can't change while
// the panel is open) to check whether the sim authored this cycle's prompt.
// When it hasn't (yet, or ever, for this type), this falls back to the
// original Phase 1 client-derivation below — unchanged.
import { useCallback, useEffect, useState } from 'react';
import { fetchWorldState } from '../api';
import type { WorldSnapshot } from '../types';
import { getPromptForCycle, promptForType } from './voteCopy';
import { currentCycleId, cycleWindow } from './voteCycle';
import type { TallyCounts, VoteCycleType, VoteOptionId, VotePrompt } from './types';

const TALLY_POLL_MS = 30_000;
const CLOCK_TICK_MS = 60_000; // local re-render only, no network — keeps "closes in" fresh

function voteStorageKey(cycleId: string): string {
  return `oracle.vote.${cycleId}`;
}

function readStoredChoice(cycleId: string): VoteOptionId | null {
  const key = voteStorageKey(cycleId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to cookie
  }
  if (raw === null) {
    try {
      const row = document.cookie.split('; ').find((r) => r.startsWith(`${key}=`));
      raw = row !== undefined ? decodeURIComponent(row.split('=').slice(1).join('=')) : null;
    } catch {
      raw = null;
    }
  }
  return raw === 'primary' || raw === 'secondary' || raw === 'withhold' ? raw : null;
}

function persistChoice(cycleId: string, optionId: VoteOptionId): void {
  const key = voteStorageKey(cycleId);
  try {
    localStorage.setItem(key, optionId);
  } catch {
    // ignore — cookie below is the fallback
  }
  try {
    const maxAge = 60 * 60 * 24 * 3; // 3 days — comfortably longer than one cycle
    document.cookie = `${key}=${encodeURIComponent(optionId)}; max-age=${maxAge}; path=/; samesite=lax`;
  } catch {
    // ignore — localStorage above already recorded it in most browsers
  }
}

function formatClosesIn(cycleId: string, nowMs: number): string {
  const w = cycleWindow(cycleId);
  if (w === null) return '';
  const ms = w.endMs - nowMs;
  if (ms <= 0) return 'closing';
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Pure fetch, no state — safe to call from an effect OR an event handler. */
async function fetchTallyCounts(cycleId: string): Promise<TallyCounts | null> {
  try {
    const res = await fetch(`/api/tally?cycleId=${encodeURIComponent(cycleId)}`, { cache: 'no-store' });
    const data = (await res.json()) as { ok: boolean; counts?: TallyCounts };
    return data.ok && data.counts !== undefined ? data.counts : null;
  } catch {
    return null;
  }
}

interface CycleApiResponse {
  ok: boolean;
  authored?: boolean;
  type?: string;
  flavorNames?: string[];
}

/** Pure fetch, no state — mirrors fetchTallyCounts. Any failure (network,
 *  the doc not existing yet, a 4xx/5xx from the route, or a `type` this web
 *  build has no template for) resolves to null, which the caller treats
 *  identically to "the sim hasn't authored this cycle" — never a crash,
 *  never a blank panel. Phase 1's client-derivation (getPromptForCycle) is
 *  what actually renders in every one of those cases. */
async function fetchAuthoredPrompt(cycleId: string): Promise<VotePrompt | null> {
  try {
    const res = await fetch(`/api/cycle?cycleId=${encodeURIComponent(cycleId)}`, { cache: 'no-store' });
    const data = (await res.json()) as CycleApiResponse;
    if (!data.ok || data.authored !== true || typeof data.type !== 'string') return null;
    // promptForType does a plain lookup keyed by VoteCycleType — an
    // unrecognized string (a future sim type this build predates) just
    // misses the lookup and returns null, so this cast is safe even though
    // the value is unchecked JSON off the wire.
    return promptForType(data.type as VoteCycleType, data.flavorNames ?? []);
  } catch {
    return null;
  }
}

export interface UseVoteResult {
  prompt: VotePrompt;
  counts: TallyCounts | null;
  loadingTally: boolean;
  hasVoted: boolean;
  chosenOptionId: VoteOptionId | null;
  casting: boolean;
  castError: string | null;
  closesInLabel: string;
  cast: (optionId: VoteOptionId) => Promise<void>;
}

/** Call only while the panel is mounted/open — its effects (the world-state
 *  flavor fetch, the tally poll) start on mount and stop on unmount. */
export function useVote(): UseVoteResult {
  // Lazy initializers: computed once when this hook instance mounts (the
  // panel mounts/unmounts with the modal, so "once per open" is what we want).
  const [cycleId] = useState(() => currentCycleId());
  const [chosenOptionId, setChosenOptionId] = useState<VoteOptionId | null>(() => readStoredChoice(cycleId));

  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [authoredPrompt, setAuthoredPrompt] = useState<VotePrompt | null>(null);
  const [counts, setCounts] = useState<TallyCounts | null>(null);
  const [loadingTally, setLoadingTally] = useState(true);
  const [casting, setCasting] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // One-time: fetch a world snapshot for prompt flavor (named agents). A
  // failure just leaves voteCopy.ts to fall back to generic phrasing.
  useEffect(() => {
    let active = true;
    fetchWorldState()
      .then((s) => {
        if (active) setWorld(s);
      })
      .catch(() => {
        /* simulation funnel may be briefly unreachable */
      });
    return () => {
      active = false;
    };
  }, []);

  // Cycle-open, once: ask whether the sim authored this cycle (Phase 1.5). No
  // polling — the sim decides once at cycle-open and that doesn't change for
  // the rest of the cycle, so one fetch per panel-open is enough. Resolving
  // to null (not authored, or an unshipped type) just leaves authoredPrompt
  // at its null default, and `prompt` below falls back to getPromptForCycle
  // exactly as Phase 1 already worked.
  useEffect(() => {
    let active = true;
    fetchAuthoredPrompt(cycleId).then((p) => {
      if (active && p !== null) setAuthoredPrompt(p);
    });
    return () => {
      active = false;
    };
  }, [cycleId]);

  // Tally poll: immediately on mount, then at most every 30s (amendment #1).
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const result = await fetchTallyCounts(cycleId);
      if (!active) return;
      if (result !== null) setCounts(result);
      setLoadingTally(false);
    };
    tick();
    const id = setInterval(tick, TALLY_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [cycleId]);

  // Local re-render clock for the "closes in" label — no network involved.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const cast = useCallback(
    async (optionId: VoteOptionId) => {
      setCasting(true);
      setCastError(null);
      try {
        const res = await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cycleId, optionId }),
        });
        const data = (await res.json()) as { ok: boolean; message?: string };
        if (!res.ok || !data.ok) {
          setCastError(data.message ?? 'the world did not receive your breath — try again.');
          return;
        }
        persistChoice(cycleId, optionId);
        setChosenOptionId(optionId);
        // Once immediately after casting (amendment #1) — a plain event-
        // handler call, not inside an effect, so this is unrestricted.
        const freshCounts = await fetchTallyCounts(cycleId);
        if (freshCounts !== null) setCounts(freshCounts);
      } catch {
        setCastError('the world did not receive your breath — try again.');
      } finally {
        setCasting(false);
      }
    },
    [cycleId],
  );

  return {
    // Sim-authored prompt wins when available; otherwise the Phase 1
    // client-derived template (unchanged fallback — see voteCopy.ts).
    prompt: authoredPrompt ?? getPromptForCycle(cycleId, world),
    counts,
    loadingTally,
    hasVoted: chosenOptionId !== null,
    chosenOptionId,
    casting,
    castError,
    closesInLabel: formatClosesIn(cycleId, nowMs),
    cast,
  };
}
