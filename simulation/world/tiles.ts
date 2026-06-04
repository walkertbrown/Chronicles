// simulation/world/tiles.ts
// Tile utility functions. All functions now accept TileCache instead of WorldTile[][].
// getTile delegates to cache.get() which generates tiles on demand from seed.

import type { Agent, TileCache, WorldTile } from '@shared/types.js';
import { Terrain } from '@shared/types.js';
import { COAST_ROW, MAP_HEIGHT, MAP_WIDTH, VESSEL_ROW_START } from './generator.js';

const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export function getTile(
  tiles: TileCache,
  x: number,
  y: number,
): WorldTile | undefined {
  if (!isInBounds(x, y)) return undefined;
  return tiles.get(x, y);
}

export function getAdjacentTiles(
  tiles: TileCache,
  x: number,
  y: number,
): WorldTile[] {
  const adjacent: WorldTile[] = [];
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const tile = getTile(tiles, x + dx, y + dy);
    if (tile !== undefined) {
      adjacent.push(tile);
    }
  }
  return adjacent;
}

export function getTilesInRange(
  tiles: TileCache,
  x: number,
  y: number,
  radius: number,
): WorldTile[] {
  const inRange: WorldTile[] = [];
  for (let tx = x - radius; tx <= x + radius; tx++) {
    for (let ty = y - radius; ty <= y + radius; ty++) {
      if (tx === x && ty === y) continue;
      if (manhattanDistance(x, y, tx, ty) > radius) continue;
      const tile = getTile(tiles, tx, ty);
      if (tile !== undefined) {
        inRange.push(tile);
      }
    }
  }
  return inRange;
}

export function isInBounds(x: number, y: number): boolean {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function isPassable(terrain: Terrain, vesselBeached: boolean): boolean {
  if (terrain === Terrain.Mountain) return false;
  if (terrain === Terrain.Vessel) return !vesselBeached;
  return true;
}

export function manhattanDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function euclideanDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

export function getAgentsOnTile(agents: Agent[], tile: WorldTile): Agent[] {
  return agents.filter(
    (agent) =>
      agent.alive &&
      agent.position.x === tile.x &&
      agent.position.y === tile.y,
  );
}

export function findNearestTerrain(
  tiles: TileCache,
  fromX: number,
  fromY: number,
  terrain: Terrain,
  maxRadius: number,
): WorldTile | undefined {
  let nearest: WorldTile | undefined;
  let nearestDist = Infinity;

  for (let tx = fromX - maxRadius; tx <= fromX + maxRadius; tx++) {
    for (let ty = fromY - maxRadius; ty <= fromY + maxRadius; ty++) {
      const dist = manhattanDistance(fromX, fromY, tx, ty);
      if (dist > maxRadius) continue;
      const tile = getTile(tiles, tx, ty);
      if (tile?.terrain !== terrain) continue;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = tile;
      }
    }
  }

  return nearest;
}

export function findBestFoodTile(
  tiles: TileCache,
  fromX: number,
  fromY: number,
  radius: number,
): WorldTile | undefined {
  return findBestResourceTile(tiles, fromX, fromY, radius, 'food');
}

export function findBestWaterTile(
  tiles: TileCache,
  fromX: number,
  fromY: number,
  radius: number,
): WorldTile | undefined {
  return findBestResourceTile(tiles, fromX, fromY, radius, 'water');
}

export function findBestGameTile(
  tiles: TileCache,
  fromX: number,
  fromY: number,
  radius: number,
): WorldTile | undefined {
  return findBestResourceTile(tiles, fromX, fromY, radius, 'game');
}

function findBestResourceTile(
  tiles: TileCache,
  fromX: number,
  fromY: number,
  radius: number,
  resource: 'food' | 'water' | 'game',
): WorldTile | undefined {
  let best: WorldTile | undefined;
  let bestAmount = 0;

  const candidates = getTilesInRange(tiles, fromX, fromY, radius);
  const origin = getTile(tiles, fromX, fromY);
  if (origin !== undefined) {
    candidates.push(origin);
  }

  for (const tile of candidates) {
    const amount = tile.resources[resource].current;
    if (amount > 0 && amount > bestAmount) {
      bestAmount = amount;
      best = tile;
    }
  }

  return best;
}

export function stepToward(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  if (fx === tx && fy === ty) {
    return { x: fx, y: fy };
  }

  const dx = tx - fx;
  const dy = ty - fy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: fx + Math.sign(dx), y: fy };
  }

  return { x: fx, y: fy + Math.sign(dy) };
}

export function isVesselZone(y: number): boolean {
  return y >= VESSEL_ROW_START;
}

export function isCoast(y: number): boolean {
  return y === COAST_ROW;
}

// Helper to mark a tile dirty after mutation.
// Call this any time you modify tile resources, occupants, artifacts etc.
export function markTileDirty(tiles: TileCache, x: number, y: number): void {
  const tile = tiles.getIfCached(x, y);
  if (tile !== undefined) {
    tiles.set(x, y, tile);
  }
}
