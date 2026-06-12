import seedrandom from 'seedrandom';
import type { Artifact, Resource, Structure, TileCache, TileCacheData, WorldTile } from '@shared/types.js';
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
// Per-terrain resource MAX: [food, water, material, game, wood].
// Wood (standing timber) is heaviest in forest, with copses on plains and
// riparian growth along rivers; mountains and coast carry only scrub.
const TERRAIN_RESOURCES: Record<Terrain, [number, number, number, number, number]> = {
  [Terrain.Plain]:    [0.5, 0.4, 0.3, 0.6,  0.25],
  [Terrain.Forest]:   [0.8, 0.3, 0.7, 0.85, 0.9],
  [Terrain.River]:    [0.5, 1.0, 0.2, 0.7,  0.35],
  [Terrain.Mountain]: [0.1, 0.2, 0.8, 0.3,  0.15],
  [Terrain.Coast]:    [0.4, 0.6, 0.2, 0.25, 0.1],
  [Terrain.Ruin]:     [0.25, 0.1, 0.4, 0.2,  0.15],
  [Terrain.Vessel]:   [0.1, 0.1, 0.5, 0.0,  0.0],
};

// Per-terrain regen rate per tick: [food, water, material, game, wood].
// Game regenerates SLOWER than plant forage — animal populations breed back
// gradually. Wood is slower still: a felled stand takes many seasons to regrow.
const TERRAIN_REGEN: Record<Terrain, [number, number, number, number, number]> = {
  [Terrain.Plain]:    [0.002,  0.001,  0.0005, 0.0015, 0.0003],
  [Terrain.Forest]:   [0.004,  0.001,  0.001,  0.002,  0.0008],
  [Terrain.River]:    [0.002,  0.005,  0.0005, 0.0018, 0.0004],
  [Terrain.Mountain]: [0.0005, 0.001,  0.002,  0.0008, 0.0002],
  [Terrain.Coast]:    [0.002,  0.003,  0.0005, 0.0012, 0.0002],
  [Terrain.Ruin]:     [0.0005, 0.0005, 0.001,  0.0008, 0.0002],
  [Terrain.Vessel]:   [0.0005, 0.0005, 0.001,  0.0,    0.0],
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

  // Forest clusters — mirrors paintForests in generator.ts.
  // Far clusters: scattered through the deep interior (unchanged range).
  // Near clusters: seeded in the 30-70 tile band north of the coast so that
  // scouts on a ~25-60 tile foray can reach dangerous terrain and trigger the
  // dwell mechanic and predator threat within the first weeks.  We add 3 near
  // clusters; their cy values are drawn from [COAST_ROW-70, COAST_ROW-30], i.e.
  // y ≈ 1429-1469.  That keeps them out of the immediate landing zone (y≥1497)
  // but squarely in the foray range.  The 15-tile minimum from the coast fringe
  // (coast band is COAST_ROW-2 .. COAST_ROW) is satisfied by the -30 lower bound.
  const forestClusters: Array<{ cx: number; cy: number; radius: number }> = [];
  const clusterCount = rInt(rng, 3, 4);
  for (let c = 0; c < clusterCount; c++) {
    forestClusters.push({
      cx: rInt(rng, 3, MAP_WIDTH - 4),
      cy: rInt(rng, 6, COAST_ROW - 2),
      radius: rInt(rng, 3, 5),
    });
  }
  // Near-coast forest clusters — 3 additional patches in the scout-reachable band.
  // Spread across the x-axis so at least one falls near the landing column on most
  // seeds.  Radius is smaller (2-3) so the patches are tight — a scout must enter
  // them, not just graze them from a plain tile.
  const NEAR_FOREST_COUNT = 3;
  const NEAR_FOREST_Y_NEAR = COAST_ROW - 30;  // 1469 — closest to the coast
  const NEAR_FOREST_Y_FAR  = COAST_ROW - 70;  // 1429 — farthest from the coast
  for (let c = 0; c < NEAR_FOREST_COUNT; c++) {
    // Spread x in thirds so clusters don't pile up.
    const xSegment = Math.floor(MAP_WIDTH / NEAR_FOREST_COUNT);
    forestClusters.push({
      cx: rInt(rng, c * xSegment + 10, (c + 1) * xSegment - 10),
      cy: rInt(rng, NEAR_FOREST_Y_FAR, NEAR_FOREST_Y_NEAR),
      radius: rInt(rng, 2, 3),
    });
  }

  // Ruin cluster — mirrors paintRuins in generator.ts.
  // North = LOW y. COAST_ROW = 1499. Ruins sit ~600-900 tiles north of the
  // coast so agents must actually range inland to reach them.
  // ruinCenter.cy = COAST_ROW - (600..900) ≈ 599..899.
  const ruinCenter = {
    cx: rInt(rng, 5, MAP_WIDTH - 6),
    cy: rInt(rng, COAST_ROW - 900, COAST_ROW - 600),
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
  const [foodMax, waterMax, matMax, gameMax, woodMax] = TERRAIN_RESOURCES[terrain];
  const [foodRegen, waterRegen, matRegen, gameRegen, woodRegen] = TERRAIN_REGEN[terrain];
  const noise = () => rFloat(rng, 0.85, 1.15);
  return {
    food:     makeResource(foodMax  * noise(), foodRegen,  rng),
    water:    makeResource(waterMax * noise(), waterRegen, rng),
    material: makeResource(matMax   * noise(), matRegen,   rng),
    game:     makeResource(gameMax  * noise(), gameRegen,  rng),
    wood:     makeResource(woodMax  * noise(), woodRegen,  rng),
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
    structure: null,
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
      backfillTileWood(tile, data.seed); // migrate tiles persisted before `wood` existed
      backfillTileStructure(tile);       // migrate tiles persisted before `structure` existed
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

// Tiles persisted before the `wood` resource was added lack it. Backfill a
// fresh timber stock from the tile's terrain so chopping never hits undefined.
function backfillTileWood(tile: WorldTile, seed: number): void {
  const resources = tile.resources as Record<string, Resource>;
  if (resources.wood !== undefined) return;
  const rng = getTileRng(seed, tile.x, tile.y);
  const [, , , , woodMax] = TERRAIN_RESOURCES[tile.terrain];
  const [, , , , woodRegen] = TERRAIN_REGEN[tile.terrain];
  resources.wood = makeResource(woodMax * rFloat(rng, 0.85, 1.15), woodRegen, rng);
}

// Tiles persisted before structures existed lack the field; default it to null
// so build/anchor code can read tile.structure without hitting undefined.
function backfillTileStructure(tile: WorldTile): void {
  const t = tile as { structure?: Structure | null };
  if (t.structure === undefined) {
    t.structure = null;
    return;
  }
  // Structures persisted before hearths existed lack fireFuel; default it cold.
  if (t.structure !== null && (t.structure as { fireFuel?: number }).fireFuel === undefined) {
    t.structure.fireFuel = 0;
  }
}

// ============================================================
// FACTORY — used by generator.ts to create the initial cache
// Pre-populates the starting zone so agents have tiles on day 1
// ============================================================

// The source sits beyond the ruins — at the far (northern) edge of the ruin
// cluster, against the mountains, the true end of the ancient-density gradient.
// Deterministic per seed (reuses the same feature RNG), so worldgen and any
// later backfill agree on where it is.
export function computeSourcePosition(seed: number): { x: number; y: number } {
  const { ruinCenter } = computeWorldFeatures(seed);
  return {
    x: ruinCenter.cx,
    y: Math.max(4, ruinCenter.cy - ruinCenter.radius - 1),
  };
}

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
