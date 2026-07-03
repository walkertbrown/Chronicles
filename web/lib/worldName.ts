// lib/worldName.ts
// Single source of truth for the world's name. A rename to something other
// than "Aethel" is a pending owner decision — until then this constant (and
// its optional env override) is the ONE place that spells it out. Every page
// that shows the name imports it from here instead of hardcoding a literal.
//
// Set NEXT_PUBLIC_WORLD_NAME to override without a code change. Must be
// NEXT_PUBLIC_-prefixed because the pages that display it are client
// components — see web/AGENTS.md / Next's env-var docs on browser bundling.
export const WORLD_NAME = process.env.NEXT_PUBLIC_WORLD_NAME ?? 'Aethel';
