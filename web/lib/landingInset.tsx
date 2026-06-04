'use client';

// Landing-zone inset — a small, always-on window onto the patch of coast where
// the band came ashore. The continent plate maps all 3000×1500 sim tiles onto
// ~1010 SVG px, so anyone near the landing site collapses into a single dot.
// This inset reframes a FIXED ~180-tile window around the beach and, crucially,
// fans out co-located agents so a stack of N souls on one tile reads as N dots
// (the size of each bloom encodes how many are piled on that tile).
//
// Terrain is drawn from the baked tileToTerrain grid (no server data needed),
// so it stays crisp at this zoom instead of enlarging the low-res map raster.

import { useMemo } from 'react';
import type { AgentSnapshot, WorldSnapshot } from './types';
import { tileToTerrain } from './tileCoords';
import { oracle } from './oracle';

const c = oracle.c;
const f = oracle.fonts;

// Sim constants — mirror simulation/world/generator.ts (MAP_WIDTH, COAST_ROW).
// Only used to clamp the window horizontally; the vertical anchor comes from
// the beached vessel's own y, so these can't silently drift the framing.
const SIM_W = 3000;

// Inset coordinate space (logical px); CSS scales the <svg> to fit its box.
const BOXW = 240;
const BOXH = 210;

// Fixed window, in sim tiles, around the landing site. Biased north so the
// shore sits near the bottom with the foraging hinterland filling most of it.
const WIN_HALF_X = 90; // ±90 tiles → 180 wide
const WIN_NORTH = 120; // tiles of land (hinterland) shown above the coast
const WIN_SOUTH = 40; // sea below the coast — puts the shore ~75% down, leaving
//                       room for a full agent-bloom to stay inside the frame
const TERRAIN_STEP = 5; // native tileToTerrain resolution (3000/600)

const TERRAIN_COLORS: Record<string, string> = {
  O: c.sea, // ocean
  c: '#caa86f', // coast / sand
  l: '#6f8350', // lowland
  m: '#566b3b', // midland
  h: '#7c6a44', // highland
  M: '#5d5546', // mountain
  L: '#3f8fb0', // lake / river
};

// Golden-angle phyllotaxis so a stack of co-located agents fans into a tidy
// disc of distinct, individually-clickable dots instead of one fat blob.
const GOLDEN_ANGLE = 2.399963229728653;
function spreadRadiusPx(n: number): number {
  if (n <= 1) return 0;
  return Math.min(30, 5 + 3.4 * Math.sqrt(n));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function LandingInset({
  snapshot,
  selectedId,
  onSelect,
}: {
  snapshot: WorldSnapshot | null;
  selectedId: string | null;
  onSelect: (agent: AgentSnapshot) => void;
}) {
  // The landing site only exists once the vessel beaches; before that nobody
  // is ashore and there is nothing to frame.
  const beached = snapshot?.vessel.beached === true;
  const cx = snapshot?.vessel.position.x ?? 0;
  const cy = snapshot?.vessel.position.y ?? 0;

  // Window bounds in sim tiles (stable — depends only on the landing point).
  const winX0 = clamp(cx - WIN_HALF_X, 0, Math.max(0, SIM_W - WIN_HALF_X * 2));
  const winX1 = winX0 + WIN_HALF_X * 2;
  const winY0 = cy - WIN_NORTH;
  const winY1 = cy + WIN_SOUTH;
  const winW = winX1 - winX0;
  const winH = winY1 - winY0;

  // Uniform "meet" fit of the tile window into the inset box.
  const scale = Math.min(BOXW / winW, BOXH / winH);
  const offX = (BOXW - winW * scale) / 2;
  const offY = (BOXH - winH * scale) / 2;
  const toPxX = (tx: number) => offX + (tx - winX0) * scale;
  const toPxY = (ty: number) => offY + (ty - winY0) * scale;

  // Terrain layer is static for a given landing site — memoise so the 1 Hz
  // snapshot poll doesn't rebuild ~1.2k rects every second.
  const terrainCells = useMemo(() => {
    if (!beached) return [];
    const cells: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
    const startX = Math.floor(winX0 / TERRAIN_STEP) * TERRAIN_STEP;
    const startY = Math.floor(winY0 / TERRAIN_STEP) * TERRAIN_STEP;
    const cellPx = TERRAIN_STEP * scale + 0.6; // tiny overlap hides seams
    for (let tx = startX; tx < winX1; tx += TERRAIN_STEP) {
      for (let ty = startY; ty < winY1; ty += TERRAIN_STEP) {
        const code = tileToTerrain(tx, ty);
        cells.push({
          x: toPxX(tx),
          y: toPxY(ty),
          w: cellPx,
          h: cellPx,
          fill: TERRAIN_COLORS[code] ?? c.sea,
        });
      }
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beached, winX0, winY0, winX1, winY1, scale]);

  if (!beached || snapshot === null) return null;

  // Group living agents by tile so each pile can be fanned out in place.
  const groups = new Map<string, AgentSnapshot[]>();
  for (const a of snapshot.agents) {
    if (!a.alive) continue;
    if (a.position.x < winX0 || a.position.x > winX1) continue;
    if (a.position.y < winY0 || a.position.y > winY1) continue;
    const key = `${a.position.x}_${a.position.y}`;
    const arr = groups.get(key);
    if (arr === undefined) groups.set(key, [a]);
    else arr.push(a);
  }

  type Placed = { agent: AgentSnapshot; px: number; py: number };
  const placed: Placed[] = [];
  for (const arr of groups.values()) {
    arr.sort((p, q) => p.id.localeCompare(q.id)); // stable order → no jitter
    const n = arr.length;
    const baseX = toPxX(arr[0]!.position.x + 0.5);
    const baseY = toPxY(arr[0]!.position.y + 0.5);
    const spread = spreadRadiusPx(n);
    for (let i = 0; i < n; i++) {
      const angle = i * GOLDEN_ANGLE;
      const r = spread * Math.sqrt((i + 0.5) / n);
      placed.push({
        agent: arr[i]!,
        px: baseX + r * Math.cos(angle),
        py: baseY + r * Math.sin(angle),
      });
    }
  }

  const ashore = snapshot.agents.filter((a) => a.alive).length;
  const [vpx, vpy] = [toPxX(cx + 0.5), toPxY(cy + 0.5)];

  return (
    <div
      style={{
        position: 'absolute',
        left: 10,
        bottom: 10,
        zIndex: 4,
        width: 'clamp(150px, 21vw, 240px)',
        background: c.frame,
        border: `1px solid ${c.lineStrong}`,
        boxShadow: '0 2px 14px rgba(0,0,0,0.5)',
        padding: 6,
      }}
      // Keep map pan/zoom from reacting to interaction with the inset.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '1px 2px 5px',
        }}
      >
        <span
          style={{
            fontFamily: f.display,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.16em',
            color: c.accent,
          }}
        >
          LANDING
        </span>
        <span style={{ fontFamily: f.mono, fontSize: 9, color: c.textFaint }}>{ashore} ashore</span>
      </div>

      <svg
        viewBox={`0 0 ${BOXW} ${BOXH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block', background: c.sea }}
      >
        {/* terrain */}
        {terrainCells.map((cell, i) => (
          <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h} fill={cell.fill} shapeRendering="crispEdges" />
        ))}

        {/* beached hull at the landing site */}
        <g opacity={0.9}>
          <ellipse cx={vpx} cy={vpy} rx={5} ry={2.4} fill="#8a7060" stroke="#5a4636" strokeWidth={0.6} />
          <rect x={vpx - 0.5} y={vpy - 6} width={1} height={6} fill="#6a5040" />
        </g>

        {/* conduits in-frame (rare this close to shore, but show if present) */}
        {snapshot.conduits.map((conduit) => {
          if (conduit.position.x < winX0 || conduit.position.x > winX1) return null;
          if (conduit.position.y < winY0 || conduit.position.y > winY1) return null;
          const dark = conduit.bondType === 'dark';
          const fill = dark ? c.conduitDark : c.conduitLight;
          const px = toPxX(conduit.position.x + 0.5);
          const py = toPxY(conduit.position.y + 0.5);
          const r = 3;
          return (
            <polygon
              key={conduit.id}
              points={`${px},${py - r} ${px + r * 0.72},${py} ${px},${py + r} ${px - r * 0.72},${py}`}
              fill={fill}
              stroke={dark ? c.conduitDarkStroke : c.conduitLightStroke}
              strokeWidth={0.7}
            />
          );
        })}

        {/* agents — fanned out per tile, each clickable */}
        {placed.map(({ agent, px, py }) => {
          const act = agent.chronicleThreadActive;
          const sel = selectedId === agent.id;
          return (
            <g key={agent.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(agent)}>
              {sel && <circle cx={px} cy={py} r={5.5} fill="none" stroke={c.text} strokeWidth={1.2} opacity={0.95} />}
              <circle
                cx={px}
                cy={py}
                r={act ? 3.2 : 2.4}
                fill={act ? c.accent : '#f3ead6'}
                stroke={act ? '#5a3a16' : '#3a2c1c'}
                strokeWidth={0.8}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
