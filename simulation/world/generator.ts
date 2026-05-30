// simulation/world/generator.ts
// World generation constants and starting position logic.
// Tile generation has moved to tileCache.ts — this file no longer
// builds the full grid. It provides constants and starting positions only.

import seedrandom from 'seedrandom';
import { Season } from '@shared/types.js';
import { TileCacheImpl, createTileCache } from './tileCache.js';

// ============================================================
// CONSTANTS
// ============================================================

/** Full world width in tiles. Each tile is ~500 feet. */
export const MAP_WIDTH = 3000;

/** Full world height in tiles. Each tile is ~500 feet. */
export const MAP_HEIGHT = 1502;

/** Southern coast / landfall row. Agents move here from the vessel zone. */
export const COAST_ROW = 1499;

/** First row of the vessel zone — south of the coast. */
export const VESSEL_ROW_START = 1500;

/** @deprecated Use MAP_WIDTH */
export const MAP_SIZE = MAP_WIDTH;

// ============================================================
// RNG HELPERS
// ============================================================

type RNG = () => number;

function rInt(rng: RNG, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

// ============================================================
// GENERATED WORLD
// ============================================================

export interface GeneratedWorld {
  tiles: TileCacheImpl;
  companionStart: { x: number; y: number };
  vesselStart: { x: number; y: number };
  landingZone: { xMin: number; xMax: number; y: number };
  startingSeason: Season;
}

/**
 * generateWorld
 *
 * Creates a TileCacheImpl pre-warmed with the starting coastal zone.
 * The full 3000x1502 world is generated on demand as agents explore.
 * Same seed always produces the same world.
 *
 * @param seed  Any integer. Same seed always produces the same map.
 */
export function generateWorld(seed: number): GeneratedWorld {
  const rng = seedrandom(String(seed)) as RNG;

  // Build the tile cache — pre-warms starting zone
  const tiles = createTileCache(seed);

  // Vessel starts centered on the coast, in the southern vessel zone
  const centerX = Math.floor(MAP_WIDTH / 2);
  const vesselStart = {
    x: centerX - 1,
    y: VESSEL_ROW_START,
  };

  // Companion starts somewhere in the mid-map interior
  // We pick a deterministic position from the seed
  const companionX = rInt(rng, Math.floor(MAP_WIDTH * 0.3), Math.floor(MAP_WIDTH * 0.7));
  const companionY = rInt(rng, Math.floor(COAST_ROW * 0.3), Math.floor(COAST_ROW * 0.6));
  const companionStart = { x: companionX, y: companionY };

  // Landing zone: center strip of the coast row
  const landingZone = {
    xMin: Math.floor(MAP_WIDTH * 0.3),
    xMax: Math.floor(MAP_WIDTH * 0.7),
    y: COAST_ROW,
  };

  // Starting season
  const seasonIndex = rInt(rng, 0, 3);
  const seasons: Season[] = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter];
  const startingSeason = seasons[seasonIndex] ?? Season.Spring;

  return { tiles, companionStart, vesselStart, landingZone, startingSeason };
}
