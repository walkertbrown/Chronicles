// simulation/world/generator.ts
// World generation constants and starting position logic.
// Tile generation has moved to tileCache.ts — this file no longer
// builds the full grid. It provides constants and starting positions only.

import seedrandom from 'seedrandom';
import { Season, type ConduitBeing } from '@shared/types.js';
import { TileCacheImpl, createTileCache, computeSourcePosition } from './tileCache.js';

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
  conduits: ConduitBeing[];
  source: { x: number; y: number };
  vesselStart: { x: number; y: number };
  landingZone: { xMin: number; xMax: number; y: number };
  startingSeason: Season;
}

// ============================================================
// CONDUIT SPAWNING
// ============================================================

const CONDUIT_COUNT = 75;
const FRONTIER_CONDUITS = 5;  // how many of the 75 watch from the treeline near the landing

/**
 * Spawn 75 Conduits across the interior of the new world.
 *
 * Distribution rules (from spec):
 * - Not at the landing coast — they are here before the settlers and
 *   watch from a distance at first
 * - Weighted toward mid-distance and interior — curious about the land,
 *   drawn toward ancient density gradients
 * - None in the far-north ruin zone initially — that discovery belongs
 *   to agents who earn it
 * - Spread across x-axis to avoid clustering
 */
function spawnConduits(rng: RNG): ConduitBeing[] {
  const conduits: ConduitBeing[] = [];

  // Y bands: coast is COAST_ROW (1499). Interior runs north (lower y values).
  // Conduits avoid the southern 15% (landing zone) and the northern 10% (deep ruins).
  const yMin = Math.floor(COAST_ROW * 0.10);  // ~150 — far interior but not ruin tip
  const yMax = Math.floor(COAST_ROW * 0.82);  // ~1229 — well away from landing coast

  // A few linger at the treeline near where the settlers come ashore — watching
  // from a distance, as the spec's opening image intends ("luminous creatures
  // watching from the trees"). The rest keep to the interior.
  const frontierYMin = Math.floor(COAST_ROW * 0.86);  // ~1289 — just inland of the coast
  const frontierYMax = Math.floor(COAST_ROW * 0.95);  // ~1424 — treeline above the landing
  const landingCenterX = Math.floor(MAP_WIDTH / 2);

  for (let i = 0; i < CONDUIT_COUNT; i++) {
    let x: number;
    let y: number;

    if (i < FRONTIER_CONDUITS) {
      // Treeline watchers, clustered loosely around the landing column.
      const span = Math.floor(MAP_WIDTH * 0.18);
      x = Math.max(10, Math.min(MAP_WIDTH - 10, landingCenterX + Math.floor((rng() - 0.5) * span)));
      y = frontierYMin + Math.floor(rng() * (frontierYMax - frontierYMin));
    } else {
      // Spread x deterministically across the full width with jitter
      const xBase = Math.floor((i / CONDUIT_COUNT) * MAP_WIDTH);
      const xJitter = Math.floor((rng() - 0.5) * (MAP_WIDTH / CONDUIT_COUNT) * 1.5);
      x = Math.max(10, Math.min(MAP_WIDTH - 10, xBase + xJitter));

      // Y weighted toward mid-interior — Conduits gather where ancient density is higher
      // Use a beta-like distribution: most land in the middle third
      const r1 = rng();
      const r2 = rng();
      const yNorm = (r1 + r2) / 2; // average of two randoms — peaks in middle
      y = Math.floor(yMin + yNorm * (yMax - yMin));
    }

    const conduit: ConduitBeing = {
      id: `conduit_${i}`,
      position: { x, y },
      drives: {
        curiosity: 0.55 + rng() * 0.30,  // 0.55–0.85 — they are curious by nature
        fear: 0.55 + rng() * 0.20,       // 0.55–0.75 — cautious of new arrivals
        proximity: 0,
      },
      bondedAgentId: null,
      bondType: null,
      bondStrength: 0,
      agentProximityHistory: [],
      heldArtifactId: null,
      sightingCount: 0,
      lastSightingTick: null,
    };

    conduits.push(conduit);
  }

  return conduits;
}

/**
 * generateWorld
 *
 * Creates a TileCacheImpl pre-warmed with the starting coastal zone,
 * and spawns 75 Conduit beings distributed across the interior.
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

  // Spawn all 75 Conduits
  const conduits = spawnConduits(rng);

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

  const source = computeSourcePosition(seed);

  return { tiles, conduits, source, vesselStart, landingZone, startingSeason };
}
