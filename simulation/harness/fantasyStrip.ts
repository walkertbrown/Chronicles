// simulation/harness/fantasyStrip.ts
// Strips the dormant fantasy arc (Conduits + the Source) from a freshly created
// world, per the wind-tunnel spec's "Known facts": with zero Conduits there are
// no sightings, no Conduit bonds, and the Source never moves (its control only
// shifts via bonded-agent presence near it), so tickAllConduits/tickSource no-op
// harmlessly. This is pure state surgery — no sim code is touched.
//
// Exploration/migration stay untouched; only the Conduit/Source plot is removed.

import type { WorldState } from '@shared/types.js';

export function stripFantasy(state: WorldState): void {
  state.conduits = [];
}
