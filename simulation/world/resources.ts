// simulation/world/resources.ts
// Resource regeneration and seasonal modifiers. Called once per tick from the tick loop after actions resolve.

import type { Resource, WorldState, WorldTile } from '@shared/types.js';
import { Season, Terrain } from '@shared/types.js';
import { TICKS_PER_SEASON } from '../agents/drives.js';
import { MAP_HEIGHT, MAP_WIDTH, VESSEL_ROW_START } from './generator.js';

const SEASON_REGEN_MULTIPLIERS: Record<Season, number> = {
  [Season.Spring]: 1.4,
  [Season.Summer]: 1.0,
  [Season.Autumn]: 0.7,
  [Season.Winter]: 0.2,
};

const FAMINE_FOOD_THRESHOLD = 0.1;
const FAMINE_DECAY_RATE = 0.001;
const SPRING_FOOD_BONUS = 1.3;

export function getSeasonMultiplier(season: Season): number {
  return SEASON_REGEN_MULTIPLIERS[season];
}

export function isFamineCondition(
  resource: Resource,
  season: Season,
  terrain: Terrain,
): boolean {
  if (season !== Season.Winter) return false;
  if (!isFoodResourceTerrain(terrain)) return false;
  return resource.current <= FAMINE_FOOD_THRESHOLD;
}

function isFoodResourceTerrain(terrain: Terrain): boolean {
  return terrain === Terrain.Plain || terrain === Terrain.Forest;
}

function clampResource(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

export function tickResource(
  resource: Resource,
  season: Season,
  terrain: Terrain,
  isFoodResource: boolean,
): void {
  if (isFoodResource && isFamineCondition(resource, season, terrain)) {
    resource.current = clampResource(resource.current - FAMINE_DECAY_RATE, resource.max);
    return;
  }

  // Coast tiles maintain a minimum food floor year round — shoreline always offers something
  if (isFoodResource && terrain === Terrain.Coast) {
    const coastFloor = 0.05;
    if (resource.current < coastFloor) {
      resource.current = clampResource(resource.current + resource.regenRate * 0.5, resource.max);
      return;
    }
  }

  const multiplier = getSeasonMultiplier(season);
  const delta = resource.regenRate * multiplier;
  resource.current = clampResource(resource.current + delta, resource.max);
}

export function tickAllResources(tiles: WorldTile[][], season: Season): void {
  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      if (y >= VESSEL_ROW_START) continue;

      const tile = tiles[x]?.[y];
      if (tile === undefined) continue;
      if (tile.terrain === Terrain.Vessel) continue;

      const foodRegenBonus = season === Season.Spring ? SPRING_FOOD_BONUS : 1.0;
      const foodResource: Resource = season === Season.Spring
        ? { ...tile.resources.food, regenRate: tile.resources.food.regenRate * foodRegenBonus }
        : tile.resources.food;
      tickResource(foodResource, season, tile.terrain, true);
      if (season === Season.Spring) {
        tile.resources.food.current = foodResource.current;
      }
      tickResource(tile.resources.water, season, tile.terrain, false);
      tickResource(tile.resources.material, season, tile.terrain, false);
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
