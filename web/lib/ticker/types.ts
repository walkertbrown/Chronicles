// lib/ticker/types.ts
// Shared shape for the "THE WORLD STIRS" happenings ticker. Mirrors the
// read-only feed the sim exposes via /state's `recentEvents` field (see
// simulation/events/log.ts buildRecentEventsFeed) — kept as a plain string
// `type` (not an imported enum) so this stays dependency-free of the sim
// package; matched by the EventType string values from shared/types.ts.
import { oracle } from '../oracle';

const c = oracle.c;

export interface RecentEvent {
  id: string;
  tick: number;
  day: number;
  type: string;
  description: string;
}

// Per-type color + glyph for visual variety, drawn only from oracle.tsx's
// existing palette (no new colors invented). Any type not listed (or a
// future EventType the web hasn't caught up to yet) falls back to
// TICKER_FALLBACK_STYLE below — never a crash, never a missing entry.
export const TICKER_STYLE: Record<string, { color: string; glyph: string }> = {
  death: { color: c.accent2, glyph: '✦' },
  birth: { color: c.accent, glyph: '✧' },
  conflict: { color: c.accent2, glyph: '⚔' },
  resolution: { color: c.accent, glyph: '☙' },
  discovery: { color: c.conduitLight, glyph: '◈' },
  bond_formed: { color: c.conduitLight, glyph: '❧' },
  bond_broken: { color: c.accent2, glyph: '✂' },
  companion_approach: { color: c.conduitLight, glyph: '◌' },
  companion_bond: { color: c.conduitLight, glyph: '❧' },
  artifact_found: { color: c.accent, glyph: '◈' },
  artifact_imprinted: { color: c.accent, glyph: '◈' },
  trait_threshold: { color: c.textDim, glyph: '↟' },
  migration: { color: c.accent, glyph: '➤' },
  hamlet_founded: { color: c.accent, glyph: '⌂' },
  resource_crisis: { color: c.accent2, glyph: '⚠' },
  illness_began: { color: c.accent2, glyph: '☓' },
  conduit_bond_light: { color: c.conduitLight, glyph: '❧' },
  conduit_bond_dark: { color: c.conduitDark, glyph: '❧' },
  conduit_bond_broken: { color: c.conduitDark, glyph: '✂' },
  source_awakened: { color: c.accent, glyph: '☼' },
  source_shifted: { color: c.conduitDark, glyph: '☾' },
  conception: { color: c.accent, glyph: '✿' },
  ruin_expedition_began: { color: c.textDim, glyph: '➤' },
  ruin_expedition_returned: { color: c.textDim, glyph: '⌂' },
  audience_breath: { color: c.accent, glyph: '◉' },
};

export const TICKER_FALLBACK_STYLE = { color: c.textFaint, glyph: '•' };
