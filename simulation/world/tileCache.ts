import seedrandom from 'seedrandom';
import type { Artifact, Resource, TileCache, TileCacheData, WorldTile } from '@shared/types.js';
import { Terrain } from '@shared/types.js';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  COAST_ROW,
  VESSEL_ROW_START,
} from './generator.js';

// ============================================================
// CONSTANTS
// ============================================================

type RNG = () => number;

// Per-terrain resource MAX: [food (plant forage), water, material, game (prey)].
// Game reflects realistic prey availability: richest in forest, good on plains and
// along rivers, sparse in mountains, low on the coast (where fishing substitutes).
const TERRAIN_RESOURCES: Record<Terrain, [number, number, number, number]> = {
  [Terrain.Plain]:    [0.5, 0.4, 0.3, 0.6],
  [Terrain.Forest]:   [0.8, 0.3, 0.7, 0.85],
  [Terrain.River]:    [0.5, 1.0, 0.2, 0.7],
  [Terrain.Mountain]: [0.1, 0.2, 0.8, 0.3],
  [Terrain.Coast]:    [0.4, 0.6, 0.2, 0.25],
  [Terrain.Ruin]:     [0.1, 0.1, 0.4, 0.2],
  [Terrain.Vessel]:   [0.1, 0.1, 0.5, 0.0],
};

// Per-terrain regen rate per tick: [food, water, material, game].
// Game regenerates SLOWER than plant forage — animal populations breed back
// gradually, so an over-hunted patch takes many ticks to recover.
const TERRAIN_REGEN: Record<Terrain, [number, number, number, number]> = {
  [Terrain.Plain]:    [0.002, 0.001, 0.0005, 0.0015],
  [Terrain.Forest]:   [0.004, 0.001, 0.001, 0.002],
  [Terrain.River]:    [0.002, 0.005, 0.0005, 0.0018],
  [Terrain.Mountain]: [0.0005, 0.001, 0.002, 0.0008],
  [Terrain.Coast]:    [0.002, 0.003, 0.0005, 0.0012],
  [Terrain.Ruin]:     [0.0005, 0.0005, 0.001, 0.0008],
  [Terrain.Vessel]:   [0.0005, 0.0005, 0.001, 0.0],
};

// ============================================================
// TERRAIN LAYOUT — mirrors generator.ts paint functions
// but operates per-tile rather than building the full grid.
// Same seed + same x,y always produces the same terrain.
// ============================================================

function getTileRng(seed: number, x: number, y: number): RNG {
  // Unique seed per tile — combine world seed with tile coords
  return seedrandom(`${seed}:${x}:${y}`) as RNG;
}

function getWorldRng(seed: number): RNG {
  return seedrandom(String(seed)) as RNG;
}

function rFloat(rng: RNG, min: number, max: number): number {
  return min + rng() * (max - min);
}

function rInt(rng: RNG, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ============================================================
// WORLD-LEVEL FEATURES
// These are computed once from the world seed and cached.
// They define where rivers, forests, ruins etc. are located.
// ============================================================

interface WorldFeatures {
  // River: array of {x, y} tiles that are river terrain
  riverTiles: Set<string>
  // Forest cluster centers
  forestClusters: Array<{ cx: number; cy: number; radius: number }>
  // Ruin cluster center
  ruinCenter: { cx: number; cy: number; radius: number }
  // Vessel start
  vesselStartX: number
}

function computeWorldFeatures(seed: number): WorldFeatures {
  const rng = getWorldRng(seed);

  // River — mirrors paintRiver in generator.ts
  const riverTiles = new Set<string>();
  let rx = rInt(rng, Math.floor(MAP_WIDTH * 0.3), Math.floor(MAP_WIDTH * 0.7));
  for (let y = COAST_ROW; y >= 4; y--) {
    const halfWidth = rInt(rng, 1, 2);
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const tx = rx + dx;
      if (tx >= 0 && tx < MAP_WIDTH) {
        riverTiles.add(`${tx}:${y}`);
      }
    }
    rx += rInt(rng, -1, 1);
    rx = Math.max(2, Math.min(MAP_WIDTH - 3, rx));
  }

  // Forest clusters — mirrors paintForests in generator.ts
  const forestClusters: Array<{ cx: number; cy: number; radius: number }> = [];
  const clusterCount = rInt(rng, 3, 4);
  for (let c = 0; c < clusterCount; c++) {
    forestClusters.push({
      cx: rInt(rng, 3, MAP_WIDTH - 4),
      cy: rInt(rng, 6, COAST_ROW - 2),
      radius: rInt(rng, 3, 5),
    });
  }

  // Ruin cluster — mirrors paintRuins in generator.ts
  const ruinCenter = {
    cx: rInt(rng, 5, MAP_WIDTH - 6),
    cy: rInt(rng, 4, 8),
    radius: rInt(rng, 2, 4),
  };

  // Vessel start x
  const vesselStartX = Math.floor(MAP_WIDTH / 2) - 1;

  return { riverTiles, forestClusters, ruinCenter, vesselStartX };
}

// ============================================================
// PER-TILE TERRAIN DETERMINATION
// Given world features and tile coords, returns terrain type.
// Deterministic — same inputs always produce same output.
// ============================================================

function determineTerrain(
  x: number,
  y: number,
  features: WorldFeatures,
  seed: number,
): Terrain {
  // Vessel zone
  if (y >= VESSEL_ROW_START) {
    const vx = features.vesselStartX;
    if (x >= vx && x < vx + 3 && y < VESSEL_ROW_START + 2) {
      return Terrain.Vessel;
    }
    return Terrain.Plain; // south of vessel, treat as open water / plain
  }

  // Mountain border — top rows
  if (y <= 3) {
    const mRng = getTileRng(seed, x, -1); // shared per-column seed for mountain depth
    const depth = rInt(mRng, 2, 4);
    if (y < depth) return Terrain.Mountain;
  }

  // Coast band
  if (y >= COAST_ROW - 2 && y <= COAST_ROW) {
    return Terrain.Coast;
  }

  // River
  if (features.riverTiles.has(`${x}:${y}`)) {
    return Terrain.River;
  }

  // Ruin cluster
  const { ruinCenter } = features;
  const ruinDist = Math.sqrt((x - ruinCenter.cx) ** 2 + (y - ruinCenter.cy) ** 2);
  if (ruinDist <= ruinCenter.radius) {
    const ruinRng = getTileRng(seed, x, y);
    const prob = 1 - ruinDist / (ruinCenter.radius + 1);
    if (ruinRng() < prob) return Terrain.Ruin;
  }

  // Forest clusters
  for (const cluster of features.forestClusters) {
    const dist = Math.sqrt((x - cluster.cx) ** 2 + (y - cluster.cy) ** 2);
    if (dist <= cluster.radius) {
      const fRng = getTileRng(seed, x, y);
      const prob = 1 - dist / (cluster.radius + 1);
      if (fRng() < prob) return Terrain.Forest;
    }
  }

  return Terrain.Plain;
}

// ============================================================
// ANCIENT DENSITY
// ============================================================

function computeAncientDensity(
  x: number,
  y: number,
  ruinCenter: { cx: number; cy: number },
): number {
  if (y >= VESSEL_ROW_START) return 0;
  const maxDist = Math.sqrt(MAP_WIDTH ** 2 + COAST_ROW ** 2);
  const dist = Math.sqrt((x - ruinCenter.cx) ** 2 + (y - ruinCenter.cy) ** 2);
  return clamp01(1 - dist / maxDist);
}

// ============================================================
// RESOURCE GENERATION
// ============================================================

function makeResource(max: number, regen: number, rng: RNG): Resource {
  const startFraction = rFloat(rng, 0.7, 1.0);
  return {
    current: clamp01(max * startFraction),
    max: clamp01(max),
    regenRate: regen,
  };
}

function makeTileResources(terrain: Terrain, rng: RNG): WorldTile['resources'] {
  const [foodMax, waterMax, matMax, gameMax] = TERRAIN_RESOURCES[terrain];
  const [foodRegen, waterRegen, matRegen, gameRegen] = TERRAIN_REGEN[terrain];
  const noise = () => rFloat(rng, 0.85, 1.15);
  return {
    food:     makeResource(foodMax  * noise(), foodRegen,  rng),
    water:    makeResource(waterMax * noise(), waterRegen, rng),
    material: makeResource(matMax   * noise(), matRegen,   rng),
    game:     makeResource(gameMax  * noise(), gameRegen,  rng),
  };
}

// ============================================================
// ARTIFACT PLACEMENT
// ============================================================

function placeArtifacts(
  terrain: Terrain,
  x: number,
  y: number,
  ancientDensity: number,
  rng: RNG,
): Artifact[] {
  if (terrain !== Terrain.Ruin) return [];
  const count = rng() < ancientDensity * 0.8
    ? rInt(rng, 1, 3)
    : rng() < 0.3 ? 1 : 0;
  return Array.from({ length: count }, (_, i) => ({
    id: `artifact_${x}_${y}_${i}`,
    discovered: false,
    imprinted: false,
  }));
}

// ============================================================
// SINGLE TILE GENERATOR
// Produces a fully initialized WorldTile from seed + coords.
// Called only when a tile is first accessed.
// ============================================================

function generateTile(
  x: number,
  y: number,
  seed: number,
  features: WorldFeatures,
): WorldTile {
  const terrain = determineTerrain(x, y, features, seed);
  const ancientDensity = computeAncientDensity(x, y, features.ruinCenter);
  const rng = getTileRng(seed, x, y);
  // Advance rng past the terrain determination calls
  // (getTileRng gives a fresh rng per tile so no advance needed)
  return {
    x,
    y,
    terrain,
    resources: makeTileResources(terrain, rng),
    ancientDensity,
    artifacts: placeArtifacts(terrain, x, y, ancientDensity, rng),
    occupants: [],
    conduitIds: [],
  };
}

// ============================================================
// TILE CACHE CLASS
// Implements the TileCache interface from shared/types.ts
// ============================================================

export class TileCacheImpl implements TileCache {
  readonly seed: number;
  private readonly cache: Map<string, WorldTile>;
  private readonly dirty: Set<string>;
  private readonly features: WorldFeatures;

  constructor(seed: number, initialTiles?: Map<string, WorldTile>) {
    this.seed = seed;
    this.cache = initialTiles ?? new Map();
    this.dirty = new Set();
    this.features = computeWorldFeatures(seed);

    // Mark any pre-loaded tiles as dirty so they get saved
    if (initialTiles !== undefined) {
      for (const key of initialTiles.keys()) {
        this.dirty.add(key);
      }
    }
  }

  private key(x: number, y: number): string {
    return `${x}_${y}`;
  }

  get(x: number, y: number): WorldTile {
    const k = this.key(x, y);
    const cached = this.cache.get(k);
    if (cached !== undefined) return cached;

    // Generate on demand
    const tile = generateTile(x, y, this.seed, this.features);
    this.cache.set(k, tile);
    // Not marked dirty — generated tiles match seed, no need to save
    return tile;
  }

  getIfCached(x: number, y: number): WorldTile | undefined {
    return this.cache.get(this.key(x, y));
  }

  set(x: number, y: number, tile: WorldTile): void {
    const k = this.key(x, y);
    this.cache.set(k, tile);
    this.dirty.add(k);
  }

  isDirty(x: number, y: number): boolean {
    return this.dirty.has(this.key(x, y));
  }

  getDirtyTiles(): Map<string, WorldTile> {
    const result = new Map<string, WorldTile>();
    for (const k of this.dirty) {
      const tile = this.cache.get(k);
      if (tile !== undefined) result.set(k, tile);
    }
    return result;
  }

  serialize(): import('@shared/types.js').TileCacheData {
    const dirtyTiles: Record<string, WorldTile> = {};
    for (const [k, tile] of this.getDirtyTiles()) {
      dirtyTiles[k] = tile;
    }
    return { seed: this.seed, dirtyTiles };
  }

  static deserialize(data: import('@shared/types.js').TileCacheData): TileCacheImpl {
    const initialTiles = new Map<string, WorldTile>();
    for (const [k, tile] of Object.entries(data.dirtyTiles)) {
      backfillTileGame(tile, data.seed); // migrate tiles persisted before `game` existed
      initialTiles.set(k, tile);
    }
    return new TileCacheImpl(data.seed, initialTiles);
  }
}

// Tiles persisted before the prey/`game` resource was added lack it. Backfill a
// fresh game stock from the tile's terrain so hunting code never hits undefined.
function backfillTileGame(tile: WorldTile, seed: number): void {
  const resources = tile.resources as Record<string, Resource>;
  if (resources.game !== undefined) return;
  const rng = getTileRng(seed, tile.x, tile.y);
  const [, , , gameMax] = TERRAIN_RESOURCES[tile.terrain];
  const [, , , gameRegen] = TERRAIN_REGEN[tile.terrain];
  resources.game = makeResource(gameMax * rFloat(rng, 0.85, 1.15), gameRegen, rng);
}

// ============================================================
// FACTORY — used by generator.ts to create the initial cache
// Pre-populates the starting zone so agents have tiles on day 1
// ============================================================

export function createTileCache(seed: number): TileCacheImpl {
  const cache = new TileCacheImpl(seed);

  // Pre-warm the starting zone — coast + vessel rows + 10 rows inland
  // so agents have tiles immediately without generation lag on tick 1
  const startX = Math.floor(MAP_WIDTH * 0.2);
  const endX = Math.floor(MAP_WIDTH * 0.8);
  const startY = COAST_ROW - 10;
  const endY = MAP_HEIGHT - 1;

  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      cache.get(x, y); // generates and caches, not marked dirty
    }
  }

  return cache;
}
