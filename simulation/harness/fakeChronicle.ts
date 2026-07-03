// simulation/harness/fakeChronicle.ts
// --fake-chronicle mode: owner-authorized exception to "no chronicle imports."
// The original constraint existed to guarantee $0 cost and no API keys — it was
// never about the SELECTION logic (which agents a page is about), only the LLM
// prose call. This runs the real, pure, synchronous selection logic from
// chronicle/packager.ts (packThreads/packCameos — no network, no Firebase, no
// Anthropic SDK; verified by reading its imports) at production's real cadence,
// and appends a real ChronicleEntry to state.chroniclePages with placeholder
// prose instead of ever calling the LLM. That's everything
// checkBondEligibility's light-bond "pagesMentioned >= 3" gate reads — so light
// Conduit bonds become reachable in the harness without spending a cent.
//
// Never imports chronicle/generator.ts (the LLM caller) or chronicle/prompt.ts
// (the prompt builder) — only chronicle/packager.ts, which contains no LLM
// call of its own.

import type { ChronicleEntry, WorldState } from '@shared/types.js';
import { packThreads } from '../chronicle/packager.js';

// Production's real cadence (chronicle/generator.ts shouldGenerateChronicle,
// runMode==='production') fires on WALL-CLOCK time — 20 real hours since the
// last chronicle. A production tick is 7.5 real minutes (index.ts
// TICK_INTERVAL_MS=450000), so 20 hours = 1200 minutes = 160 ticks exactly.
// The harness has no wall clock tied to simulated ticks (it runs at full CPU
// speed, seconds for what production takes months), so shouldGenerateChronicle
// itself would never fire meaningfully here — we translate its real-hours rule
// into the equivalent tick count instead of reusing its wall-clock branch.
export const FAKE_CHRONICLE_CADENCE_TICKS = 160; // 20 real hours' worth ≈ every 3⅓ world days

const PLACEHOLDER_PROSE = '[fake-chronicle: selection ran for real, prose skipped — LLM never called]';

export function shouldFakeChronicle(state: WorldState): boolean {
  return state.tick > 0 && state.tick % FAKE_CHRONICLE_CADENCE_TICKS === 0;
}

/**
 * Appends a chronicle page built from the REAL selection logic (packThreads —
 * the same significance/thread ordering production uses) with placeholder
 * prose. No-ops if there are no active chronicle threads yet (mirrors
 * generateChronicle's own early return when packages.length === 0).
 */
export function appendFakeChroniclePage(state: WorldState): void {
  const packages = packThreads(state);
  if (packages.length === 0) return;

  const generatedAt = new Date().toISOString();

  const entry: ChronicleEntry = {
    id: `fake-tick-${state.tick}`,
    worldId: state.worldId,
    day: state.day,
    realDate: generatedAt,
    season: state.season,
    year: state.year,
    threads: packages.map((p) => ({
      familyName: p.familyName,
      primaryAgentId: p.primaryAgent.id,
      prose: PLACEHOLDER_PROSE,
    })),
    fullPage: PLACEHOLDER_PROSE,
    // Mirrors chronicle/generator.ts generateChronicle()'s exact construction —
    // including a pre-existing quirk worth flagging rather than fixing (out of
    // scope; not sim-mechanics this harness may change): this pushes tick
    // NUMBERS (`e.tick.toString()`), while companions/being.ts
    // checkBondEligibility looks these up via
    // `state.eventLog.find(e => e.id === eid)` — an id-shaped string match
    // against tick-number strings, which never matches. So that branch of the
    // "pagesMentioned" check is dead in PRODUCTION too, not just here — only
    // the primaryAgentId branch (checked above) ever actually counts a
    // mention. Reproduced faithfully so this mode's behavior matches
    // production's real (buggy) behavior, not an idealized fixed version.
    significantEvents: packages.flatMap((p) =>
      p.primaryAgent.recentEvents.map((e) => e.tick.toString()),
    ),
    generatedAt,
  };

  state.chroniclePages.push(entry);
  state.lastChronicleGeneratedAt = generatedAt;
  state.lastChronicleDay = state.day;
}
