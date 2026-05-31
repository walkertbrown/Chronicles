'use client';

// lib/atlasMobile.tsx — the three explorable mobile layouts for the Eye.
// Desktop puts the map plate and the roster side-by-side; on a phone they can't
// both be full-size, so this offers Toggle / Stack / Sheet. The page owns the
// map + roster nodes and passes them in; these components only arrange them.
//
// Default is Toggle; Stack and Sheet are switchable from the masthead menu so
// they can be compared on a real device before one is locked in.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { oracle, Kicker, Segmented } from './oracle';

const c = oracle.c;
const f = oracle.fonts;

export type AtlasMode = 'toggle' | 'stack' | 'sheet';

export interface AtlasMobileProps {
  mode: AtlasMode;
  // The page renders the framed map; `fill` => absolutely fill the parent,
  // otherwise a fixed-height block.
  renderMap: (opts: { fill: boolean; height?: number | string }) => ReactNode;
  panel: ReactNode; // roster or selected-figure detail
  caption: ReactNode; // plate caption
  ledgerLabel: string; // e.g. "The Watched"
  soulCount: number;
  selectionKey: string | null; // a figure's id while one is selected, else null
  sheetTitle: string; // selected name, or the ledger label
}

export function AtlasMobile(props: AtlasMobileProps) {
  if (props.mode === 'stack') return <AtlasStack {...props} />;
  if (props.mode === 'sheet') return <AtlasSheet {...props} />;
  return <AtlasToggle {...props} />;
}

// ── Toggle: segmented Map / Roster, one full-height at a time ────────────────
function AtlasToggle({ renderMap, panel, caption, ledgerLabel, selectionKey }: AtlasMobileProps) {
  const [tab, setTab] = useState<'map' | 'roster'>('map');
  const prev = useRef<string | null>(selectionKey);
  useEffect(() => {
    if (selectionKey !== null && selectionKey !== prev.current) setTab('roster');
    prev.current = selectionKey;
  }, [selectionKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: c.base }}>
      <div style={{ padding: '12px 14px 0' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'map', label: 'The plate' },
            { value: 'roster', label: selectionKey !== null ? 'The figure' : ledgerLabel },
          ]}
        />
      </div>
      {tab === 'map' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 14px 14px' }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{renderMap({ fill: true })}</div>
          {caption}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 40px' }}>{panel}</div>
      )}
    </div>
  );
}

// ── Stack: map on top, roster scrolls beneath in one column ──────────────────
function AtlasStack({ renderMap, panel, caption, selectionKey }: AtlasMobileProps) {
  const scRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prev = useRef<string | null>(selectionKey);
  useEffect(() => {
    if (selectionKey !== null && selectionKey !== prev.current && scRef.current !== null && panelRef.current !== null) {
      scRef.current.scrollTo({ top: Math.max(0, panelRef.current.offsetTop - 12), behavior: 'smooth' });
    }
    prev.current = selectionKey;
  }, [selectionKey]);

  return (
    <div ref={scRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: c.base }}>
      <div style={{ padding: '14px 14px 0' }}>
        {renderMap({ fill: false, height: 'clamp(248px, 44vh, 440px)' })}
        {caption}
      </div>
      <div ref={panelRef} style={{ padding: '14px 16px 48px' }}>
        {panel}
      </div>
    </div>
  );
}

// ── Sheet: full-bleed map with a slide-up roster sheet ───────────────────────
function AtlasSheet({ renderMap, panel, soulCount, selectionKey, sheetTitle }: AtlasMobileProps) {
  const [expanded, setExpanded] = useState(false);
  const prev = useRef<string | null>(selectionKey);
  useEffect(() => {
    if (selectionKey !== null && selectionKey !== prev.current) setExpanded(true);
    prev.current = selectionKey;
  }, [selectionKey]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0 }}>{renderMap({ fill: true })}</div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 6,
          height: expanded ? '82%' : 72,
          background: c.panel,
          borderTop: `1px solid ${c.lineStrong}`,
          boxShadow: '0 -14px 40px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'height .28s cubic-bezier(.3,.7,.4,1)',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            borderBottom: expanded ? `1px solid ${c.line}` : 'none',
            cursor: 'pointer',
            padding: '9px 16px 11px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <span style={{ width: 34, height: 4, borderRadius: 2, background: c.lineStrong, alignSelf: 'center' }} />
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span
              style={{
                fontFamily: f.display,
                fontSize: 15,
                color: c.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {sheetTitle}
            </span>
            <Kicker color={c.accent}>{expanded ? 'Close' : `${soulCount} souls`}</Kicker>
          </span>
        </button>
        {expanded && <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 32px' }}>{panel}</div>}
      </div>
    </div>
  );
}
