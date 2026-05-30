// simulation/world/generator.ts
// Produces a seeded, deterministic 30x32 WorldTile[][] map.
// Rows 0–28: inland. Row 29: coast (landfall). Rows 30–31: vessel zone.
// Same seed always produces the same map — essential during development.
// Import from @shared/types for all shared data structures.

import seedrandom from 'seedrandom';
import type { WorldTile, Resource, Artifact } from '@shared/types.js';
import { Season, Terrain } from '@shared/types.js';

// ============================================================
// CONSTANTS
// ============================================================

export const MAP_WIDTH = 30;
export const MAP_HEIGHT = 32;

/** Southern coast / landfall row. Agents move here from the vessel zone. */
export const COAST_ROW = 29;

/** First row of the vessel zone — south of the coast. */
export const VESSEL_ROW_START = 30;

/** @deprecated Use MAP_WIDTH */
export const MAP_SIZE = MAP_WIDTH;

// Resource baseline values by terrain type
// [food_max, water_max, material_max]
const TERRAIN_RESOURCES: Record<Terrain, [number, number, number]> = {
  [Terrain.Plain]:    [0.5, 0.4, 0.3],
  [Terrain.Forest]:   [0.8, 0.3, 0.7],
  [Terrain.River]:    [0.5, 1.0, 0.2],
  [Terrain.Mountain]: [0.1, 0.2, 0.8],
  [Terrain.Coast]:    [0.4, 0.6, 0.2],
  [Terrain.Ruin]:     [0.1, 0.1, 0.4],
  [Terrain.Vessel]:   [0.1, 0.1, 0.5],
};

// Regen rates per tick by terrain (before seasonal modifier)
const TERRAIN_REGEN: Record<Terrain, [number, number, number]> = {
  [Terrain.Plain]:    [0.002, 0.001, 0.0005],
  [Terrain.Forest]:   [0.004, 0.001, 0.001],
  [Terrain.River]:    [0.002, 0.005, 0.0005],
  [Terrain.Mountain]: [0.0005, 0.001, 0.002],
  [Terrain.Coast]:    [0.002, 0.003, 0.0005],
  [Terrain.Ruin]:     [0.0005, 0.0005, 0.001],
  [Terrain.Vessel]:   [0.0005, 0.0005, 0.001],
};

// ============================================================
// RNG HELPERS
// ============================================================

type RNG = () => number;

/** Returns a float in [min, max) */
function rFloat(rng: RNG, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Returns an integer in [min, max] inclusive */
function rInt(rng: RNG, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

/** Returns true with the given probability */
function rChance(rng: RNG, probability: number): boolean {
  return rng() < probability;
}

/** Clamp a value to [0, 1] */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ============================================================
// RESOURCE FACTORY
// ============================================================

function makeResource(max: number, regen: number, rng: RNG): Resource {
  // Start resources at 70–100% of their max so the world doesn't open at zero
  const startFraction = rFloat(rng, 0.7, 1.0);
  return {
    current: clamp01(max * startFraction),
    max: clamp01(max),
    regenRate: regen,
  };
}

function makeTileResources(
  terrain: Terrain,
  rng: RNG,
): WorldTile['resources'] {
  const [foodMax, waterMax, matMax] = TERRAIN_RESOURCES[terrain];
  const [foodRegen, waterRegen, matRegen] = TERRAIN_REGEN[terrain];

  // Apply ±15% noise to max values so identical terrain tiles aren't clones
  const noise = () => rFloat(rng, 0.85, 1.15);

  return {
    food:     makeResource(foodMax  * noise(), foodRegen,  rng),
    water:    makeResource(waterMax * noise(), waterRegen, rng),
    material: makeResource(matMax   * noise(), matRegen,   rng),
  };
}


// ============================================================
// TERRAIN LAYOUT
// Build the 30x32 terrain grid in layers, each pass carving
// features over a base of plains. Land is rows 0–29; rows 30–31
// are the vessel zone south of the coast.
// ============================================================

/**
 * Layer 1 — Base: fill everything with Plain.
 */
function buildBaseTerrain(): Terrain[][] {
  return Array.from({ length: MAP_WIDTH }, () =>
    Array.from({ length: MAP_HEIGHT }, () => Terrain.Plain),
  );
}

/**
 * Layer 2 — Coast: paint y = COAST_ROW-2 through COAST_ROW as coast tiles.
 * Row COAST_ROW (29) is the landfall beach; agents move here from the vessel.
 */
function paintCoast(grid: Terrain[][]): void {
  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let depth = 0; depth < 3; depth++) {
      const y = COAST_ROW - depth;
      const row = grid[x];
      if (row !== undefined) row[y] = Terrain.Coast;
    }
  }
}

/**
 * Layer 3 — Mountain range: a jagged band across the top border (y = 0–3).
 * Impassable. Creates a hard northern boundary.
 */
function paintMountains(grid: Terrain[][], rng: RNG): void {
  for (let x = 0; x < MAP_WIDTH; x++) {
    // Variable depth: 2–4 tiles into the map
    const depth = rInt(rng, 2, 4);
    for (let d = 0; d < depth; d++) {
      const row = grid[x];
      if (row !== undefined) row[d] = Terrain.Mountain;
    }
  }
}

/**
 * Layer 4 — River: one river running from mid-coast inland toward the north.
 * Starts at a random x position on the coast, meanders north.
 * 3–4 tiles wide at any point.
 */
function paintRiver(grid: Terrain[][], rng: RNG): number {
  // River mouth x position — somewhere in the middle third of the coast
  let rx = rInt(rng, Math.floor(MAP_WIDTH * 0.3), Math.floor(MAP_WIDTH * 0.7));
  const riverStartX = rx;

  for (let y = COAST_ROW; y >= 4; y--) {
    // Width: 1–2 tiles on each side of center
    const halfWidth = rInt(rng, 1, 2);
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const tx = rx + dx;
      if (tx >= 0 && tx < MAP_WIDTH) {
        const row = grid[tx];
        if (row !== undefined) row[y] = Terrain.River;
      }
    }
    // Meander: drift left or right by 0–1 each row
    rx += rInt(rng, -1, 1);
    rx = Math.max(2, Math.min(MAP_WIDTH - 3, rx)); // keep river from hugging edge
  }

  return riverStartX;
}

/**
 * Layer 5 — Forest clusters: 3–4 clusters of forest tiles scattered
 * in the mid-section of the map (away from coast and mountains).
 */
function paintForests(grid: Terrain[][], rng: RNG): void {
  const clusterCount = rInt(rng, 3, 4);
  for (let c = 0; c < clusterCount; c++) {
    // Center of cluster — in the mid-map band (y 6 to COAST_ROW-2)
    const cx = rInt(rng, 3, MAP_WIDTH - 4);
    const cy = rInt(rng, 6, COAST_ROW - 2);
    const radius = rInt(rng, 3, 5);

    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= COAST_ROW - 2) continue;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        // Probability falls off with distance — ragged edges
        const prob = 1 - dist / (radius + 1);
        if (rChance(rng, prob)) {
          const row = grid[x];
          const current = row?.[y];
          // Don't overwrite coast, mountain, or river
          if (
            current === Terrain.Plain
          ) {
            if (row !== undefined) row[y] = Terrain.Forest;
          }
        }
      }
    }
  }
}

/**
 * Layer 6 — Ruins: cluster in the far interior (y = 1–8, away from mountains).
 * ancientDensity will be set separately as a gradient.
 */
function paintRuins(grid: Terrain[][], rng: RNG): void {
  // 1 primary ruin cluster deep in the interior
  const cx = rInt(rng, 5, MAP_WIDTH - 6);
  const cy = rInt(rng, 4, 8);  // near the northern interior, past midpoint
  const radius = rInt(rng, 2, 4);

  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= COAST_ROW - 2) continue;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const prob = 1 - dist / (radius + 1);
      if (rChance(rng, prob)) {
        const row = grid[x];
        const current = row?.[y];
        if (current !== Terrain.Mountain && current !== Terrain.Coast) {
          if (row !== undefined) row[y] = Terrain.Ruin;
        }
      }
    }
  }
}

/**
 * Layer 7 — Vessel: a 3-wide x 2-tall cluster on rows 30–31, centered on
 * the landing strip. The founding fifty start here before moving to row 29.
 */
function paintVessel(grid: Terrain[][]): { x: number; y: number } {
  const vesselWidth = 3;
  const vesselHeight = 2;
  const centerX = Math.floor(MAP_WIDTH / 2);
  const startX = centerX - Math.floor(vesselWidth / 2);
  const startY = VESSEL_ROW_START;

  for (let x = startX; x < startX + vesselWidth; x++) {
    for (let y = startY; y < startY + vesselHeight; y++) {
      const row = grid[x];
      if (row !== undefined) row[y] = Terrain.Vessel;
    }
  }

  return { x: startX, y: startY };
}


// ============================================================
// ANCIENT DENSITY GRADIENT
// Lowest at landing coast (y = COAST_ROW), highest at ruins
// cluster center. Creates the "pull" toward the interior.
// ============================================================

function computeAncientDensity(
  x: number,
  y: number,
  ruinCenterX: number,
  ruinCenterY: number,
): number {
  if (y >= VESSEL_ROW_START) return 0;

  // Distance from ruin center (normalized to map diagonal)
  const maxDist = Math.sqrt(MAP_WIDTH ** 2 + COAST_ROW ** 2);
  const dist = Math.sqrt((x - ruinCenterX) ** 2 + (y - ruinCenterY) ** 2);
  // Invert: tiles near ruins have high density
  return clamp01(1 - dist / maxDist);
}

// ============================================================
// ARTIFACT PLACEMENT
// Artifacts are seeded on ruin tiles only at world gen.
// They start undiscovered. Number per tile varies 0–3.
// ============================================================

function placeArtifacts(
  terrain: Terrain,
  tileX: number,
  tileY: number,
  ancientDensity: number,
  rng: RNG,
  artifactIdCounter: { n: number },
): Artifact[] {
  if (terrain !== Terrain.Ruin) return [];

  // Higher ancient density = more likely to have artifacts
  const count = rChance(rng, ancientDensity * 0.8)
    ? rInt(rng, 1, 3)
    : rChance(rng, 0.3) ? 1 : 0;

  return Array.from({ length: count }, () => {
    const id = `artifact_${tileX}_${tileY}_${artifactIdCounter.n++}`;
    return {
      id,
      discovered: false,
      imprinted: false,
    } satisfies Artifact;
  });
}

// ============================================================
// COMPANION STARTING POSITION
// Somewhere in the middle-distance — not near coast, not at ruins.
// The companion starts shy, in a forested or plain area mid-map.
// ============================================================

function pickCompanionStart(
  grid: Terrain[][],
  rng: RNG,
): { x: number; y: number } {
  // Target band: y = MAP_WIDTH/3 to MAP_WIDTH*2/3 (mid-map, inland only)
  const yMin = Math.floor(MAP_WIDTH / 3);
  const yMax = Math.floor((MAP_WIDTH * 2) / 3);

  // Try up to 50 times to find a forest or plain tile in the band
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = rInt(rng, 2, MAP_WIDTH - 3);
    const y = rInt(rng, yMin, yMax);
    const terrain = grid[x]?.[y];
    if (terrain === Terrain.Forest || terrain === Terrain.Plain) {
      return { x, y };
    }
  }

  // Fallback: just pick something in the band
  return {
    x: rInt(rng, 2, MAP_WIDTH - 3),
    y: rInt(rng, yMin, yMax),
  };
}


// ============================================================
// MAIN EXPORT
// ============================================================

export interface GeneratedWorld {
  tiles: WorldTile[][];
  companionStart: { x: number; y: number };
  vesselStart: { x: number; y: number };
  landingZone: { xMin: number; xMax: number; y: number };
  startingSeason: Season;
}

/**
 * generateWorld
 *
 * Produces a fully initialized 30x32 WorldTile[][] from a numeric seed.
 * Rows 0–28 are inland, row 29 is coast (landfall), rows 30–31 are the
 * vessel zone. Every tile has terrain, resources, ancientDensity, artifacts,
 * and empty occupant lists. Companion and vessel starting positions are
 * returned separately for agent and vessel initialization.
 *
 * @param seed  Any integer. Same seed always produces the same map.
 */
export function generateWorld(seed: number): GeneratedWorld {
  const rng = seedrandom(String(seed)) as RNG;

  // --- Terrain layers ---
  const terrainGrid = buildBaseTerrain();
  paintCoast(terrainGrid);
  paintMountains(terrainGrid, rng);
  paintRiver(terrainGrid, rng);
  paintForests(terrainGrid, rng);
  paintRuins(terrainGrid, rng);
  const vesselStart = paintVessel(terrainGrid);

  // Find ruin cluster center for density gradient.
  // We re-scan the grid rather than passing state through every function.
  let ruinCenterX = Math.floor(MAP_WIDTH / 2);
  let ruinCenterY = 4;
  let maxRuinDensity = 0;
  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < COAST_ROW; y++) {
      if (terrainGrid[x]?.[y] === Terrain.Ruin) {
        // Count ruin neighbors to find the densest ruin tile
        let neighborRuins = 0;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            if (terrainGrid[x + dx]?.[y + dy] === Terrain.Ruin) neighborRuins++;
          }
        }
        if (neighborRuins > maxRuinDensity) {
          maxRuinDensity = neighborRuins;
          ruinCenterX = x;
          ruinCenterY = y;
        }
      }
    }
  }

  // --- Artifact counter (shared mutable ref so IDs are unique) ---
  const artifactIdCounter = { n: 0 };

  // --- Build final tile grid ---
  const tiles: WorldTile[][] = Array.from({ length: MAP_WIDTH }, (_, x) =>
    Array.from({ length: MAP_HEIGHT }, (_, y) => {
      const terrain = terrainGrid[x]?.[y] ?? Terrain.Plain;
      const ancientDensity = computeAncientDensity(x, y, ruinCenterX, ruinCenterY);

      return {
        x,
        y,
        terrain,
        resources: makeTileResources(terrain, rng),
        ancientDensity,
        artifacts: placeArtifacts(terrain, x, y, ancientDensity, rng, artifactIdCounter),
        occupants: [],
        companionPresent: false,
      } satisfies WorldTile;
    }),
  );

  // --- Companion starting position ---
  const companionStart = pickCompanionStart(terrainGrid, rng);

  // --- Landing zone: center strip of the coast row (landfall target) ---
  const landingZone = {
    xMin: Math.floor(MAP_WIDTH * 0.3),
    xMax: Math.floor(MAP_WIDTH * 0.7),
    y: COAST_ROW,
  };

  const seasonIndex = rInt(rng, 0, 3);
  const seasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter];
  const startingSeason = seasons[seasonIndex] ?? Season.Spring;

  return { tiles, companionStart, vesselStart, landingZone, startingSeason };
}
