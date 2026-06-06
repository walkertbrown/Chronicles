// simulation/world/resources.ts
// Resource regeneration per tick.
// Only processes cached (visited) tiles — unvisited tiles have full resources
// and don't need regeneration until an agent has been there.

import type { Resource, TileCache, WorldState, WorldTile } from '@shared/types.js';
import { Season, Terrain } from '@shared/types.js';
import { TICKS_PER_SEASON } from '../agents/drives.js';

const SEASON_REGEN_MODIFIER: Record<Season, number> = {
  [Season.Spring]: 1.3,
  [Season.Summer]: 1.0,
  [Season.Autumn]: 0.8,
  [Season.Winter]: 0.5,
};

// A meagre shellfish/tidal baseline so the shore is never fully barren — but
// low enough that it can't sustain the whole band, which is what creates the
// real pressure to forage inland rather than camp on the beach forever.
const COAST_FOOD_FLOOR = 0.02;

// A hearth burns down each tick, so a fire must be fed to stay lit. Full fuel
// (1.0) lasts ~25 ticks; at the production pace (~7.5 min/tick) that's a few
// hours, after which the band must bring more wood.
const FIRE_BURN_RATE = 0.04;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function regenResource(resource: Resource, modifier: number): void {
  if (resource.current >= resource.max) return;
  resource.current = clamp01(resource.current + resource.regenRate * modifier);
}

function applyCoastFoodFloor(tile: WorldTile): void {
  if (tile.terrain !== Terrain.Coast) return;
  if (tile.resources.food.current < COAST_FOOD_FLOOR) {
    tile.resources.food.current = COAST_FOOD_FLOOR;
  }
}

export function tickAllResources(tiles: TileCache, season: Season): void {
  const modifier = SEASON_REGEN_MODIFIER[season] ?? 1.0;

  // Only process tiles that have been visited/cached.
  // Unvisited tiles regenerate implicitly — they were never depleted.
  for (const tile of tiles.getDirtyTiles().values()) {
    regenResource(tile.resources.food, modifier);
    regenResource(tile.resources.water, modifier);
    regenResource(tile.resources.material, modifier);
    regenResource(tile.resources.game, modifier);
    // `wood` may be absent on a tile loaded from a pre-wood checkpoint until its
    // lazy backfill runs; guard so regen never dereferences undefined.
    if (tile.resources.wood !== undefined) regenResource(tile.resources.wood, modifier);
    applyCoastFoodFloor(tile);
    // A lit hearth burns down over time and must be re-fed with wood.
    if (tile.structure !== null && tile.structure.fireFuel > 0) {
      tile.structure.fireFuel = Math.max(0, tile.structure.fireFuel - FIRE_BURN_RATE);
    }
  }
}

function advanceSeason(state: WorldState): void {
  switch (state.season) {
    case Season.Spring:
      state.season = Season.Summer;
      break;
    case Season.Summer:
      state.season = Season.Autumn;
      break;
    case Season.Autumn:
      state.season = Season.Winter;
      break;
    case Season.Winter:
      state.season = Season.Spring;
      state.year += 1;
      break;
  }
}

// Advances the season when ticksInCurrentSeason reaches TICKS_PER_SEASON.
// Updates state.season, state.year, and resets state.ticksInCurrentSeason to 0.
// Called once per tick from the tick loop after tickAllResources.
export function tickSeason(state: WorldState): void {
  state.ticksInCurrentSeason += 1;

  if (state.ticksInCurrentSeason >= TICKS_PER_SEASON) {
    state.ticksInCurrentSeason = 0;
    advanceSeason(state);
  }
}
