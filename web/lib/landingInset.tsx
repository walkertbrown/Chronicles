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

import { useMemo, useRef, useState, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
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

// The fixed sim-tile window the inset frames. Shared with the world map so it
// can draw a locator box over the same patch of coast. null until the vessel
// beaches (no landing site to frame yet).
export function landingWindowTiles(
  snapshot: WorldSnapshot | null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (snapshot === null || !snapshot.vessel.beached) return null;
  const cx = snapshot.vessel.position.x;
  const cy = snapshot.vessel.position.y;
  const x0 = clamp(cx - WIN_HALF_X, 0, Math.max(0, SIM_W - WIN_HALF_X * 2));
  return { x0, y0: cy - WIN_NORTH, x1: x0 + WIN_HALF_X * 2, y1: cy + WIN_SOUTH };
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
  // Draggable panel — grab the header to slide the inset anywhere over the map
  // so it never sits on top of something you want to watch. A null position
  // means "use the default bottom-left anchor"; dragging pins explicit px.
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; left: number; bottom: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      const el = containerRef.current;
      if (d === null || el === null) return;
      const parent = el.offsetParent as HTMLElement | null;
      const pw = parent?.clientWidth ?? window.innerWidth;
      const ph = parent?.clientHeight ?? window.innerHeight;
      // Clamp to the map area so the panel can't be dragged out of reach.
      const left = clamp(d.left + (e.clientX - d.startX), 0, pw - el.offsetWidth);
      const bottom = clamp(d.bottom - (e.clientY - d.startY), 0, ph - el.offsetHeight);
      setPos({ left, bottom });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onHeaderDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (el === null) return;
    const parent = el.offsetParent as HTMLElement | null;
    const prect = parent?.getBoundingClientRect();
    const erect = el.getBoundingClientRect();
    // Seed the drag from the panel's live position so the first move is smooth
    // whether or not it's been dragged before.
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      left: erect.left - (prect?.left ?? 0),
      bottom: (prect?.bottom ?? window.innerHeight) - erect.bottom,
    };
    e.preventDefault(); // don't select the header text while dragging
  };

  // The landing site only exists once the vessel beaches; before that nobody
  // is ashore and there is nothing to frame. Window bounds are shared with the
  // world-map locator box via landingWindowTiles().
  const win = landingWindowTiles(snapshot);
  const beached = win !== null;
  const winX0 = win?.x0 ?? 0;
  const winY0 = win?.y0 ?? 0;
  const winX1 = win?.x1 ?? WIN_HALF_X * 2;
  const winY1 = win?.y1 ?? WIN_NORTH + WIN_SOUTH;
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
  // The band comes ashore right at the waterline (sim coast row), so a
  // symmetric bloom would fan half its dots out into the rendered sea. For any
  // pile that would reach the water, lift the whole bloom just enough to sit on
  // the beach: its lowest dots touch the shore and the rest spill inland.
  const shoreLimitPy = toPxY(snapshot.vessel.position.y + 0.5) - 1.5;
  for (const arr of groups.values()) {
    arr.sort((p, q) => p.id.localeCompare(q.id)); // stable order → no jitter
    const n = arr.length;
    const baseX = toPxX(arr[0]!.position.x + 0.5);
    const baseY = toPxY(arr[0]!.position.y + 0.5);
    const spread = spreadRadiusPx(n);
    const shift = Math.max(0, baseY + spread - shoreLimitPy);
    for (let i = 0; i < n; i++) {
      const angle = i * GOLDEN_ANGLE;
      const r = spread * Math.sqrt((i + 0.5) / n);
      placed.push({
        agent: arr[i]!,
        px: baseX + r * Math.cos(angle),
        py: baseY + r * Math.sin(angle) - shift,
      });
    }
  }

  const ashore = snapshot.agents.filter((a) => a.alive).length;
  const [vpx, vpy] = [
    toPxX(snapshot.vessel.position.x + 0.5),
    toPxY(snapshot.vessel.position.y + 0.5),
  ];

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: pos?.left ?? 10,
        bottom: pos?.bottom ?? 10,
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
        onMouseDown={onHeaderDown}
        title="Drag to move"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '1px 2px 5px',
          cursor: 'grab',
          userSelect: 'none',
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
