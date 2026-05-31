'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { fetchWorldState, fetchDeaths } from '../../lib/api';
import type { AgentSnapshot, DeadAgentSnapshot, WorldSnapshot } from '../../lib/types';
// tileToSvg is the canonical tile→SVG mapping; imported, never re-implemented here.
import { tileToSvg, SVG_W, SVG_H } from '../../lib/tileCoords';
import { oracle, EngravedBar, Kicker, SectionHead, Seal, GiltRings } from '../../lib/oracle';

const c = oracle.c;
const f = oracle.fonts;

// ── map view ───────────────────────────────────────────────────────────────
type MapViewBox = { x: number; y: number; w: number; h: number };

const INITIAL_VIEWBOX: MapViewBox = { x: 150, y: 80, w: 1050, h: 580 };
const MAP_AR = INITIAL_VIEWBOX.h / INITIAL_VIEWBOX.w;
const MIN_W = 240; // deepest zoom-in

function clampViewBox(x: number, y: number, w: number, h: number): MapViewBox {
  const cw = Math.min(SVG_W, Math.max(100, w));
  const ch = Math.min(SVG_H, Math.max(46, h));
  return {
    x: Math.max(0, Math.min(SVG_W - cw, x)),
    y: Math.max(0, Math.min(SVG_H - ch, y)),
    w: cw,
    h: ch,
  };
}

function zoomViewBoxAtPoint(vb: MapViewBox, svgX: number, svgY: number, factor: number): MapViewBox {
  const newW = Math.max(MIN_W, Math.min(INITIAL_VIEWBOX.w, vb.w / factor));
  const newH = newW * MAP_AR;
  const newX = svgX - ((svgX - vb.x) / vb.w) * newW;
  const newY = svgY - ((svgY - vb.y) / vb.h) * newH;
  return clampViewBox(newX, newY, newW, newH);
}

// slice-correct conversion: the map fills the frame (xMidYMid slice), so the
// per-axis scale is the MAX ratio and the overflow is centred.
function svgScale(rect: DOMRect, vb: MapViewBox): number {
  return Math.max(rect.width / vb.w, rect.height / vb.h);
}
function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number, vb: MapViewBox): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const scale = svgScale(rect, vb);
  const offX = (rect.width - vb.w * scale) / 2;
  const offY = (rect.height - vb.h * scale) / 2;
  return { x: vb.x + (clientX - rect.left - offX) / scale, y: vb.y + (clientY - rect.top - offY) / scale };
}

// ── reader intervention ──────────────────────────────────────────────────────
// Vote mechanic deferred — will be implemented when the backend exposes a /vote endpoint.

export default function WorldPage() {
  const [worldSnapshot, setWorldSnapshot] = useState<WorldSnapshot | null>(null);
  const [deadAgents, setDeadAgents] = useState<DeadAgentSnapshot[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentSnapshot | null>(null);
  const [selectedDeadAgent, setSelectedDeadAgent] = useState<DeadAgentSnapshot | null>(null);
  const [rosterTab, setRosterTab] = useState<'living' | 'dead'>('living');
  const [viewBox, setViewBox] = useState<MapViewBox>(INITIAL_VIEWBOX);

  const mapSvgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ x: number; y: number; vb: MapViewBox } | null>(null);
  const draggedRef = useRef(false);
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const lastSelRef = useRef<string | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const zoomed = viewBox.w < INITIAL_VIEWBOX.w - 1;
  const mk = viewBox.w / INITIAL_VIEWBOX.w; // marker scale (≈constant on screen)

  // ── data polling (preserved: 1s state + deaths) ──
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [stateData, deathsData] = await Promise.all([fetchWorldState(), fetchDeaths()]);
        if (active) {
          setWorldSnapshot(stateData);
          setDeadAgents(deathsData.deaths);
        }
      } catch {
        // Simulation server may not be running yet
      }
    };
    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // ── wheel zoom (non-passive) ──
  useEffect(() => {
    const svg = mapSvgRef.current;
    if (svg === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = clientToSvg(svg, e.clientX, e.clientY, viewBoxRef.current);
      setViewBox((cur) => zoomViewBoxAtPoint(cur, p.x, p.y, e.deltaY < 0 ? 1.18 : 1 / 1.18));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // ── fly the view to centre on a selected agent ──
  useEffect(() => {
    const id = selectedAgent?.id ?? null;
    if (id === null || id === lastSelRef.current) {
      lastSelRef.current = id;
      return;
    }
    lastSelRef.current = id;
    const [px, py] = tileToSvg(selectedAgent!.position.x, selectedAgent!.position.y);
    const from = viewBoxRef.current;
    const tw = Math.min(from.w, 560);
    const th = tw * MAP_AR;
    const target = clampViewBox(px - tw / 2, py - th / 2, tw, th);
    if (animRef.current !== null) clearInterval(animRef.current);
    const t0 = Date.now();
    const dur = 540;
    animRef.current = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setViewBox({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (k >= 1 && animRef.current !== null) clearInterval(animRef.current);
    }, 16);
  }, [selectedAgent]);

  // reset selection when the world is first established
  useEffect(() => {
    if (worldSnapshot === null) setSelectedAgent(null);
  }, [worldSnapshot]);

  // ── pan ──
  const onDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    draggedRef.current = false;
    panRef.current = { x: e.clientX, y: e.clientY, vb: viewBoxRef.current };
  };
  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const start = panRef.current;
    const svg = mapSvgRef.current;
    if (start === null || svg === null) return;
    const rect = svg.getBoundingClientRect();
    const scale = svgScale(rect, start.vb);
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) draggedRef.current = true;
    setViewBox(clampViewBox(start.vb.x - dx / scale, start.vb.y - dy / scale, start.vb.w, start.vb.h));
  };
  const onUp = () => {
    panRef.current = null;
  };

  const adjustZoom = (dir: 'in' | 'out' | 'reset') => {
    if (dir === 'reset') {
      setViewBox(INITIAL_VIEWBOX);
      return;
    }
    const vb = viewBoxRef.current;
    setViewBox(zoomViewBoxAtPoint(vb, vb.x + vb.w / 2, vb.y + vb.h / 2, dir === 'in' ? 1.4 : 1 / 1.4));
  };

  // ── click: select nearest living agent (suppressed after a drag) ──
  const onSvgClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const snapshot = worldSnapshot;
    const svg = mapSvgRef.current;
    if (snapshot === null || svg === null) return;
    const p = clientToSvg(svg, e.clientX, e.clientY, viewBoxRef.current);
    let best: AgentSnapshot | null = null;
    let bestD = Infinity;
    for (const a of snapshot.agents) {
      if (!a.alive) continue;
      const [ax, ay] = tileToSvg(a.position.x, a.position.y);
      const d = (ax - p.x) ** 2 + (ay - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    const tol = 36 * (viewBox.w / INITIAL_VIEWBOX.w);
    if (best !== null && bestD < tol * tol) {
      setSelectedDeadAgent(null);
      setSelectedAgent(best);
    } else {
      setSelectedAgent(null);
    }
  };

  const agentName = (agentId: string): string => {
    const a = worldSnapshot?.agents.find((x) => x.id === agentId);
    return a === undefined ? agentId : `${a.name} ${a.familyName}`;
  };

  const dateline =
    worldSnapshot !== null
      ? `${worldSnapshot.season.toUpperCase()} · YEAR ${worldSnapshot.year} · DAY ${worldSnapshot.day} · ${worldSnapshot.population} SOULS`
      : 'CONSULTING THE SIMULATION…';

  const ctrlBtn: CSSProperties = {
    width: 30,
    height: 30,
    cursor: 'pointer',
    background: c.frame,
    border: `1px solid ${c.lineStrong}`,
    color: c.accent,
    fontFamily: f.mono,
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
  };

  return (
    <div
      style={{
        background: c.base,
        color: c.text,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── masthead ── */}
      <header
        style={{
          flexShrink: 0,
          background: c.frame,
          borderBottom: `1px solid ${c.lineStrong}`,
          padding: '12px 22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
          <span style={{ fontFamily: f.display, fontWeight: 700, fontSize: 22, color: c.text, letterSpacing: '0.14em', whiteSpace: 'nowrap' }}>
            THE CHRONICLE
          </span>
          <span style={{ width: 1, height: 18, background: c.line }} />
          <Kicker style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dateline}</Kicker>
        </div>
        <Link
          href="/chronicle"
          style={{ fontFamily: f.mono, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: c.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          The Chronicle →
        </Link>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── map plate ── */}
        <div style={{ flex: 1, minWidth: 0, padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, border: `1px solid ${c.lineStrong}`, boxShadow: '0 2px 24px rgba(0,0,0,0.45)' }}>
            <div style={{ position: 'absolute', inset: 5, border: `1px solid ${c.line}`, overflow: 'hidden' }}>
              <div
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={onUp}
                style={{ position: 'absolute', inset: 0, background: c.sea, overflow: 'hidden' }}
              >
                <svg
                  ref={mapSvgRef}
                  viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                  preserveAspectRatio="xMidYMid slice"
                  onClick={onSvgClick}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    cursor: panRef.current !== null ? 'grabbing' : zoomed ? 'grab' : 'crosshair',
                  }}
                >
                  {/* the real map, served from public/ (not inlined) */}
                  <image href="/map.svg" x={0} y={0} width={SVG_W} height={SVG_H} />

                  {/* vessel */}
                  {worldSnapshot !== null &&
                    (() => {
                      const [vx, vy] = tileToSvg(worldSnapshot.vessel.position.x, worldSnapshot.vessel.position.y);
                      return (
                        <g>
                          <ellipse cx={vx} cy={vy} rx={14 * mk} ry={7 * mk} fill="#8a7060" opacity={0.95} />
                          <rect x={vx - mk} y={vy - 16 * mk} width={2 * mk} height={16 * mk} fill="#6a5040" />
                          <path d={`M ${vx + mk} ${vy - 15 * mk} L ${vx + 12 * mk} ${vy - 9 * mk} L ${vx + mk} ${vy - 9 * mk} Z`} fill="#c8b890" opacity={0.85} />
                        </g>
                      );
                    })()}

                  {/* agents (only once beached and on the land grid) */}
                  {worldSnapshot !== null &&
                    worldSnapshot.vessel.beached &&
                    worldSnapshot.agents
                      .filter((a) => a.alive && a.position.y < 30)
                      .map((agent) => {
                        const [cx, cy] = tileToSvg(agent.position.x, agent.position.y);
                        const act = agent.chronicleThreadActive;
                        const sel = selectedAgent?.id === agent.id;
                        return (
                          <g key={agent.id} style={{ transition: 'transform 1.5s ease' }}>
                            {act && <circle cx={cx} cy={cy} r={9 * mk} fill="none" stroke={c.accent} strokeWidth={1.6 * mk} opacity={0.55} />}
                            {sel && (
                              <g key={`sel-${agent.id}`}>
                                <circle cx={cx} cy={cy} r={13 * mk} fill="none" stroke={c.text} strokeWidth={1.6 * mk} opacity={0.95} />
                                <circle cx={cx} cy={cy} fill="none" stroke={c.accent} strokeWidth={2 * mk}>
                                  <animate attributeName="r" values={`${10 * mk};${24 * mk};${10 * mk}`} dur="1.7s" repeatCount="indefinite" />
                                  <animate attributeName="opacity" values="0.9;0;0.9" dur="1.7s" repeatCount="indefinite" />
                                </circle>
                              </g>
                            )}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={(act ? 4.5 : 3) * mk}
                              fill={act ? c.accent : '#f3ead6'}
                              stroke={act ? '#5a3a16' : '#3a2c1c'}
                              strokeWidth={1.2 * mk}
                            />
                          </g>
                        );
                      })}

                  {/* bonded Conduits — light vs dark */}
                  {worldSnapshot !== null &&
                    worldSnapshot.conduits.map((conduit) => {
                      const [cx, cy] = tileToSvg(conduit.position.x, conduit.position.y);
                      const dark = conduit.bondType === 'dark';
                      const fill = dark ? c.conduitDark : c.conduitLight;
                      const stroke = dark ? c.conduitDarkStroke : c.conduitLightStroke;
                      const r = 6 * mk;
                      return (
                        <g key={conduit.id}>
                          {/* aura: a calm halo for light, a restless one for dark */}
                          <circle cx={cx} cy={cy} fill="none" stroke={fill} strokeWidth={mk} opacity={dark ? 0.5 : 0.45}>
                            <animate attributeName="r" values={dark ? `${8 * mk};${12 * mk};${8 * mk}` : `${9 * mk};${11 * mk};${9 * mk}`} dur={dark ? '2.4s' : '3.6s'} repeatCount="indefinite" />
                            <animate attributeName="opacity" values={dark ? '0.55;0.05;0.55' : '0.45;0.15;0.45'} dur={dark ? '2.4s' : '3.6s'} repeatCount="indefinite" />
                          </circle>
                          <polygon
                            points={`${cx},${cy - r} ${cx + r * 0.72},${cy} ${cx},${cy + r} ${cx - r * 0.72},${cy}`}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={1.2 * mk}
                          />
                        </g>
                      );
                    })}
                </svg>
              </div>

              {/* gilt rings — the god's eye */}
              <div style={{ position: 'absolute', right: -12, top: -12, opacity: 0.8, pointerEvents: 'none' }}>
                <GiltRings size={120} />
              </div>

              {/* zoom controls */}
              <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 4 }}>
                <button type="button" onClick={() => adjustZoom('in')} title="Zoom in" style={ctrlBtn}>
                  +
                </button>
                <button type="button" onClick={() => adjustZoom('out')} title="Zoom out" style={ctrlBtn}>
                  −
                </button>
                {zoomed && (
                  <button type="button" onClick={() => adjustZoom('reset')} title="Reset" style={ctrlBtn}>
                    ⤢
                  </button>
                )}
              </div>

              {worldSnapshot === null && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Kicker>Consulting the simulation…</Kicker>
                </div>
              )}
            </div>
          </div>

          {/* plate caption */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 4px 0', gap: 12 }}>
            <span style={{ fontFamily: f.display, fontSize: 15, color: c.text, letterSpacing: '0.04em' }}>FOLIO I — The New World</span>
            <Kicker>Surveyed from the vessel{worldSnapshot ? ` · ${worldSnapshot.population} ashore` : ''}</Kicker>
          </div>
        </div>

        {/* ── ledger / inspector ── */}
        <aside
          style={{
            width: 360,
            flexShrink: 0,
            background: c.panel,
            borderLeft: `1px solid ${c.lineStrong}`,
            overflowY: 'auto',
            padding: '22px 22px 40px',
          }}
        >
          {selectedAgent !== null ? (
            <LivingDetail agent={selectedAgent} agentName={agentName} onBack={() => setSelectedAgent(null)} />
          ) : selectedDeadAgent !== null ? (
            <DeadDetail
              agent={selectedDeadAgent}
              worldSnapshot={worldSnapshot}
              onBack={() => setSelectedDeadAgent(null)}
              onOpenLiving={(a) => {
                setSelectedDeadAgent(null);
                setSelectedAgent(a);
                setRosterTab('living');
              }}
            />
          ) : (
            <Roster
              worldSnapshot={worldSnapshot}
              deadAgents={deadAgents}
              rosterTab={rosterTab}
              setRosterTab={setRosterTab}
              onSelectAgent={setSelectedAgent}
              onSelectDead={setSelectedDeadAgent}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── living agent codex entry ─────────────────────────────────────────────────
function LivingDetail({
  agent,
  agentName,
  onBack,
}: {
  agent: AgentSnapshot;
  agentName: (id: string) => string;
  onBack: () => void;
}) {
  const drives: Array<[string, number, boolean]> = [
    ['hunger', agent.drives.hunger, true],
    ['fatigue', agent.drives.fatigue, true],
    ['fear', agent.drives.fear, true],
    ['social', agent.drives.socialNeed, false],
    ['grief', agent.drives.grief, false],
    ['longing', agent.drives.longing, false],
  ];
  const bonds = [...agent.relationships].sort((a, b) => b.trust - a.trust).slice(0, 5);
  return (
    <div>
      <BackButton onClick={onBack} />
      {agent.chronicleThreadActive && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.accent }} />
          <Kicker color={c.accent}>Followed by the chronicle</Kicker>
        </div>
      )}
      {agent.conduitId !== null && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, marginLeft: agent.chronicleThreadActive ? 14 : 0 }}>
          <span
            style={{
              width: 9,
              height: 9,
              transform: 'rotate(45deg)',
              background: agent.conduitBondType === 'dark' ? c.conduitDark : c.conduitLight,
            }}
          />
          <Kicker color={agent.conduitBondType === 'dark' ? c.conduitDark : c.conduitLight}>
            {agent.conduitBondType === 'dark' ? 'Dark bond' : 'Conduit bond'}
          </Kicker>
        </div>
      )}
      <h2 style={{ fontFamily: f.display, fontWeight: 600, fontSize: 28, lineHeight: 1.05, margin: '2px 0 4px', color: c.text }}>
        {agent.name} {agent.familyName}
      </h2>
      <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 15, color: c.textDim, margin: '0 0 4px' }}>
        {agent.role} of the {agent.familyName} · {agent.age} years · {agent.gender}
      </p>
      {agent.illnessState !== null && agent.illnessState.sick && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span style={{ width: 7, height: 7, background: c.accent2, display: 'inline-block' }} />
          <Kicker color={c.accent2}>Ill — severity {Math.round(agent.illnessState.severity * 100)}%</Kicker>
        </div>
      )}

      <SectionHead>Drives</SectionHead>
      {drives.map(([k, v, th]) => (
        <EngravedBar key={k} label={k} value={v} threat={th} />
      ))}

      <SectionHead>Skills</SectionHead>
      {Object.entries(agent.skills).map(([k, v]) => (
        <EngravedBar key={k} label={k} value={v} color="#9aa57e" />
      ))}

      <SectionHead>Nature</SectionHead>
      {Object.entries(agent.traits).map(([k, v]) => (
        <EngravedBar key={k} label={k} value={v} color={c.textDim} />
      ))}

      <SectionHead>Bonds</SectionHead>
      {bonds.length === 0 && <p style={{ fontFamily: f.serif, fontSize: 14, color: c.textFaint, margin: 0 }}>No bonds recorded.</p>}
      {bonds.map((rel) => (
        <div key={rel.agentId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: `1px solid ${c.line}` }}>
          <span style={{ fontFamily: f.serif, fontSize: 15, color: rel.trust < 0 ? c.accent2 : c.text }}>
            {agentName(rel.agentId)}
            {rel.bond !== 'none' ? <span style={{ color: c.textFaint }}> · {rel.bond}</span> : null}
          </span>
          <span style={{ fontFamily: f.mono, fontSize: 10, color: rel.trust < 0.34 ? c.accent2 : c.textFaint }}>trust {rel.trust.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

// ── dead agent memorial entry ────────────────────────────────────────────────
function DeadDetail({
  agent,
  worldSnapshot,
  onBack,
  onOpenLiving,
}: {
  agent: DeadAgentSnapshot;
  worldSnapshot: WorldSnapshot | null;
  onBack: () => void;
  onOpenLiving: (a: AgentSnapshot) => void;
}) {
  const drives: Array<[string, number, boolean]> = [
    ['hunger', agent.drives.hunger, true],
    ['fatigue', agent.drives.fatigue, true],
    ['fear', agent.drives.fear, true],
    ['social', agent.drives.socialNeed, false],
    ['grief', agent.drives.grief, false],
    ['longing', agent.drives.longing, false],
  ];
  return (
    <div>
      <BackButton onClick={onBack} />
      <Kicker color={c.textFaint}>In memoriam</Kicker>
      <h2 style={{ fontFamily: f.display, fontWeight: 600, fontSize: 26, lineHeight: 1.05, margin: '6px 0 4px', color: c.textDim }}>
        {agent.name} {agent.familyName}
      </h2>
      <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 14, color: c.textFaint, margin: '0 0 14px' }}>
        {agent.role} · {agent.age} years · {agent.gender}
        {agent.generation === 0 ? ' · founding' : ` · gen ${agent.generation}`}
      </p>

      <div style={{ background: 'rgba(200,85,63,0.10)', border: `1px solid ${c.accent2}`, padding: '10px 12px', marginBottom: 16, fontFamily: f.serif, fontSize: 14, color: c.textDim, lineHeight: 1.5 }}>
        <Kicker color={c.accent2}>Day {agent.dayOfDeath}</Kicker>
        <div style={{ marginTop: 4, fontStyle: 'italic' }}>{agent.deathCause}</div>
      </div>

      {agent.survivingFamily.length > 0 && (
        <>
          <SectionHead>Surviving family</SectionHead>
          {agent.survivingFamily.map((member) => {
            const living = worldSnapshot?.agents.find((a) => a.id === member.id && a.alive);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => {
                  if (living !== undefined) onOpenLiving(living);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: living !== undefined ? c.text : c.textFaint,
                  fontFamily: f.serif,
                  fontSize: 15,
                  cursor: living !== undefined ? 'pointer' : 'default',
                  padding: '4px 0',
                }}
              >
                {member.name} {member.familyName}
                <span style={{ color: c.textFaint }}> — {member.relationship}</span>
              </button>
            );
          })}
        </>
      )}

      <SectionHead>Drives at death</SectionHead>
      {drives.map(([k, v, th]) => (
        <EngravedBar key={k} label={k} value={v} threat={th} color={th ? undefined : '#4a4458'} />
      ))}

      <SectionHead>Skills</SectionHead>
      {Object.entries(agent.skills).map(([k, v]) => (
        <EngravedBar key={k} label={k} value={v} color="#5a6048" />
      ))}

      <SectionHead>Nature</SectionHead>
      {Object.entries(agent.traits).map(([k, v]) => (
        <EngravedBar key={k} label={k} value={v} color="#4a4458" />
      ))}
    </div>
  );
}

// ── roster (living / fallen + bonded conduits) ───────────────────────────────
function Roster({
  worldSnapshot,
  deadAgents,
  rosterTab,
  setRosterTab,
  onSelectAgent,
  onSelectDead,
}: {
  worldSnapshot: WorldSnapshot | null;
  deadAgents: DeadAgentSnapshot[];
  rosterTab: 'living' | 'dead';
  setRosterTab: (t: 'living' | 'dead') => void;
  onSelectAgent: (a: AgentSnapshot) => void;
  onSelectDead: (a: DeadAgentSnapshot) => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Kicker>The Watched</Kicker>
        {worldSnapshot !== null && (
          <p style={{ fontFamily: f.serif, fontSize: 14, color: c.textDim, margin: '6px 0 0', lineHeight: 1.5 }}>
            {worldSnapshot.population} souls ashore, the {worldSnapshot.season} of year {worldSnapshot.year}. Touch any figure on the plate, or a name below.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 18, borderBottom: `1px solid ${c.line}`, marginBottom: 10 }}>
        {(['living', 'dead'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setRosterTab(tab)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: f.mono,
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: rosterTab === tab ? c.text : c.textFaint,
              padding: '0 0 8px',
              borderBottom: `2px solid ${rosterTab === tab ? c.accent : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {tab === 'living' ? `Living (${worldSnapshot?.population ?? 0})` : `Fallen (${deadAgents.length})`}
          </button>
        ))}
      </div>

      {rosterTab === 'living' && worldSnapshot !== null && (
        <div>
          {worldSnapshot.conduits.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderBottom: `1px solid ${c.line}`, marginBottom: 8 }}>
              {worldSnapshot.conduits.map((conduit) => {
                const bonded = worldSnapshot.agents.find((a) => a.id === conduit.bondedAgentId);
                const dark = conduit.bondType === 'dark';
                return (
                  <div key={conduit.id} style={{ display: 'flex', alignItems: 'center', gap: 9, color: dark ? c.conduitDark : c.conduitLight }}>
                    <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', background: dark ? c.conduitDark : c.conduitLight }} />
                    <span style={{ fontFamily: f.serif, fontSize: 15, fontStyle: 'italic' }}>
                      A Conduit, bonded to {bonded?.name ?? 'one unknown'}
                      {dark ? ' — and something has turned in it' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {[...worldSnapshot.agents]
            .filter((a) => a.alive)
            .sort((a, b) => a.familyName.localeCompare(b.familyName))
            .map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelectAgent(agent)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '7px 0',
                  borderBottom: `1px solid ${c.line}`,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: agent.chronicleThreadActive ? c.accent : c.textFaint,
                    boxShadow: agent.chronicleThreadActive ? `0 0 6px ${c.accent}` : 'none',
                  }}
                />
                <span style={{ flex: 1, fontFamily: f.serif, fontSize: 16, color: c.text }}>
                  {agent.name} {agent.familyName}
                </span>
                {agent.conduitId !== null && (
                  <span style={{ width: 7, height: 7, transform: 'rotate(45deg)', background: agent.conduitBondType === 'dark' ? c.conduitDark : c.conduitLight }} />
                )}
                {agent.illnessState !== null && agent.illnessState.sick && <span style={{ width: 6, height: 6, background: c.accent2 }} />}
                <span style={{ fontFamily: f.mono, fontSize: 9, letterSpacing: '0.1em', color: c.textFaint, textTransform: 'uppercase' }}>{agent.role}</span>
              </button>
            ))}
        </div>
      )}

      {rosterTab === 'dead' && (
        <div>
          {deadAgents.length === 0 ? (
            <p style={{ fontFamily: f.serif, fontSize: 14, color: c.textFaint }}>None have fallen yet.</p>
          ) : (
            [...deadAgents]
              .sort((a, b) => b.dayOfDeath - a.dayOfDeath)
              .map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectDead(agent)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '9px 0',
                    borderBottom: `1px solid ${c.line}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: f.serif, fontSize: 16, color: c.textDim }}>
                      {agent.name} {agent.familyName}
                    </span>
                    <Kicker>day {agent.dayOfDeath}</Kicker>
                  </div>
                  <div style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 13, color: c.textFaint, lineHeight: 1.4, marginTop: 2 }}>
                    {agent.deathCause.length > 64 ? `${agent.deathCause.slice(0, 64)}…` : agent.deathCause}
                  </div>
                </button>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: f.mono, fontSize: 10, letterSpacing: '0.18em', color: c.textFaint, padding: 0, marginBottom: 16, textTransform: 'uppercase' }}
    >
      ← The Watched
    </button>
  );
}
