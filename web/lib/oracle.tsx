// lib/oracle.tsx
'use client';
// Shared Oracle visual system — design tokens + small presentational atoms.
// Imported by app/world/page.tsx and app/chronicle/page.tsx so both pages stay lean.
//
// Fonts (Cinzel / EB Garamond / IBM Plex Mono) are loaded via @import in globals.css.

import Link from 'next/link';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useViewport } from './useViewport';

export const oracle = {
  fonts: {
    display: "'Cinzel', Georgia, serif",
    serif: "'EB Garamond', Georgia, serif",
    mono: "'IBM Plex Mono', var(--font-geist-mono), ui-monospace, monospace",
  },
  c: {
    base: '#100e15',
    frame: '#171522',
    panel: '#1c1929',
    raised: '#241f33',
    line: '#352f4c',
    lineStrong: '#5a4f7a',
    text: '#ece6d8',
    textDim: '#b4aac4',
    textFaint: '#7a7190',
    accent: '#d8b25e',
    accentSoft: 'rgba(216,178,94,0.16)',
    accent2: '#c8553f',
    // light parchment leaf (chronicle)
    paper: '#e8e1cd',
    paperText: '#221d2b',
    paperDim: '#665d6f',
    paperRule: '#c9bda0',
    paperEdge: 'rgba(20,14,30,0.6)',
    // sea (map fill so nothing reads as void beyond the painted ocean)
    sea: '#2d788b',
    // conduit marker hues
    conduitLight: '#c2a2f0',
    conduitLightStroke: '#7050a0',
    conduitDark: '#b3503f',
    conduitDarkStroke: '#5c2122',
  },
} as const;

const c = oracle.c;
const f = oracle.fonts;

export function driveColor(value: number, threat: boolean): string {
  if (!threat) return c.textFaint;
  if (value > 0.7) return c.accent2;
  if (value > 0.45) return '#c8893f';
  return c.accent;
}

export function Kicker({
  children,
  color,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: f.mono,
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: color ?? c.textFaint,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function SectionHead({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
      <Kicker color={accent ? c.accent : c.textFaint}>{children}</Kicker>
      <span style={{ flex: 1, height: 1, background: c.line }} />
    </div>
  );
}

export function EngravedBar({
  label,
  value,
  threat = false,
  color,
}: {
  label: string;
  value: number;
  threat?: boolean;
  color?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill = color ?? driveColor(value, threat);
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ fontFamily: f.serif, fontSize: 13, color: c.textDim, fontVariant: 'small-caps', letterSpacing: '0.04em' }}>
          {label}
        </span>
        <span style={{ fontFamily: f.mono, fontSize: 10, color: c.textFaint, letterSpacing: '0.06em' }}>{pct}</span>
      </div>
      <div style={{ position: 'relative', height: 5, background: c.raised, border: `1px solid ${c.line}` }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: fill, opacity: 0.92 }} />
      </div>
    </div>
  );
}

export function Ornament({ glyph = '❧' }: { glyph?: string }) {
  return (
    <div style={{ textAlign: 'center', color: c.accent, letterSpacing: '0.5em', margin: '30px 0', fontSize: 15, opacity: 0.7, fontFamily: f.serif }}>
      {glyph}
    </div>
  );
}

export function Seal({ size = 56, glyph = '◉', subtle = false }: { size?: number; glyph?: string; subtle?: boolean }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `1.5px solid ${c.accent}`,
        color: c.accent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: f.display,
        fontSize: size * 0.42,
        boxShadow: `inset 0 0 0 3px ${c.base}, inset 0 0 0 4px ${subtle ? 'transparent' : c.accentSoft}`,
        background: c.accentSoft,
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  );
}

export function GiltRings({ size = 120 }: { size?: number }) {
  const ticks = Array.from({ length: 24 }, (_, i) => i);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block' }} aria-hidden>
      <circle cx="50" cy="50" r="46" fill="none" stroke={c.accent} strokeWidth="0.6" opacity="0.55" />
      <circle cx="50" cy="50" r="38" fill="none" stroke={c.accent} strokeWidth="0.4" opacity="0.4" />
      <circle cx="50" cy="50" r="30" fill="none" stroke={c.accent} strokeWidth="0.4" opacity="0.3" />
      {ticks.map((i) => {
        const a = (i / 24) * Math.PI * 2;
        const r1 = 46;
        const r2 = i % 6 === 0 ? 41 : 43.5;
        return (
          <line
            key={i}
            x1={50 + Math.cos(a) * r1}
            y1={50 + Math.sin(a) * r1}
            x2={50 + Math.cos(a) * r2}
            y2={50 + Math.sin(a) * r2}
            stroke={c.accent}
            strokeWidth="0.4"
            opacity="0.5"
          />
        );
      })}
    </svg>
  );
}

// ── reader intervention (front-end placeholder) ──────────────────────────────
// Curated, one-choice-per-cycle. Wire to a /vote endpoint when the backend
// exposes one; tallies/turnout here are illustrative only.
export const VOTE = {
  cycle: 12,
  closesIn: '6h 12m',
  turnout: 4187,
  prompt: 'The camp is divided on whether to follow the curious inland toward the broken towers, or hold the shore.',
  options: [
    { id: 'inland', title: 'Let the curious go inland', body: 'A small party follows toward the ruins. They may find the first of the artifacts. They may not return.' },
    { id: 'hold', title: 'Hold the shore another season', body: 'The camp consolidates. Safety, for now — and the towers wait, as they have always waited.' },
    { id: 'abstain', title: 'Do not breathe on the world', body: 'Let it decide for itself. The gods watch and stay their hand.' },
  ],
};

export function VotePanel({ onClose }: { onClose: () => void }) {
  const [cast, setCast] = useState<string | null>(null);
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(8,6,4,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 94vw)', maxHeight: '90%', overflowY: 'auto', background: c.frame, border: `1px solid ${c.lineStrong}`, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', padding: '34px 38px 30px', position: 'relative' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ position: 'absolute', top: 16, right: 18, background: 'none', border: 'none', cursor: 'pointer', color: c.textFaint, fontFamily: f.serif, fontSize: 22, lineHeight: 1 }}
        >
          ×
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 22 }}>
          <Seal size={58} glyph="◉" />
          <div style={{ marginTop: 14 }}>
            <Kicker color={c.accent}>You are watching · Cycle {VOTE.cycle}</Kicker>
          </div>
          <h2 style={{ fontFamily: f.display, fontWeight: 600, fontSize: 30, color: c.text, margin: '8px 0 0', letterSpacing: '0.06em' }}>The Breath</h2>
        </div>
        <p style={{ fontFamily: f.serif, fontSize: 17, lineHeight: 1.6, color: c.textDim, textAlign: 'center', margin: '0 0 24px', fontStyle: 'italic' }}>{VOTE.prompt}</p>
        <div style={{ height: 1, background: c.line, marginBottom: 20 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {VOTE.options.map((o) => {
            const chosen = cast === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={cast !== null}
                onClick={() => setCast(o.id)}
                style={{ position: 'relative', textAlign: 'left', cursor: cast !== null ? 'default' : 'pointer', background: c.panel, border: `1px solid ${chosen ? c.accent : c.line}`, padding: '13px 15px', opacity: cast !== null && !chosen ? 0.6 : 1 }}
              >
                <span style={{ display: 'block', fontFamily: f.display, fontSize: 19, color: c.text }}>{o.title}</span>
                <span style={{ display: 'block', fontFamily: f.serif, fontSize: 14, color: c.textDim, marginTop: 4, lineHeight: 1.45 }}>{o.body}</span>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Kicker>{VOTE.turnout.toLocaleString()} watching · closes in {VOTE.closesIn}</Kicker>
          {cast !== null && <Kicker color={c.accent}>Your breath is recorded</Kicker>}
        </div>
        {cast !== null && (
          <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 15, color: c.textDim, textAlign: 'center', margin: '16px 0 0', lineHeight: 1.55 }}>
            It is done. The world does not know your name. It will only feel the weather change.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Segmented control (Oracle-styled) ────────────────────────────────────────
// Used for the mobile Eye layout switch and the mobile Map/Roster toggle.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${c.line}`, width: '100%' }}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              textAlign: 'center',
              background: on ? c.accentSoft : 'transparent',
              color: on ? c.accent : c.textFaint,
              border: 'none',
              borderRight: i < options.length - 1 ? `1px solid ${c.line}` : 'none',
              padding: '10px 10px',
              fontFamily: f.mono,
              fontSize: 10,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Masthead ─────────────────────────────────────────────────────────────────
// Responsive chrome shared by the Eye + Chronicle pages. Desktop: wordmark +
// dateline + cross-nav. Phone: wordmark + hamburger menu (nav, dateline, and an
// optional `menuExtra` slot — the Eye uses it for the mobile layout switch).
type MastView = 'world' | 'chronicle';

const NAV: Array<{ href: string; label: string; key: MastView | 'home' }> = [
  { href: '/', label: 'The Threshold', key: 'home' },
  { href: '/world', label: 'The Eye', key: 'world' },
  { href: '/chronicle', label: 'The Chronicle', key: 'chronicle' },
];

function MenuIcon({ open, color }: { open: boolean; color: string }) {
  const bar: CSSProperties = {
    display: 'block',
    width: 18,
    height: 1.5,
    background: color,
    transition: 'transform .2s, opacity .2s',
  };
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 18 }}>
      <span style={{ ...bar, transform: open ? 'translateY(5.5px) rotate(45deg)' : 'none' }} />
      <span style={{ ...bar, opacity: open ? 0 : 1 }} />
      <span style={{ ...bar, transform: open ? 'translateY(-5.5px) rotate(-45deg)' : 'none' }} />
    </span>
  );
}

export function Masthead({
  current,
  dateline,
  menuExtra,
  sticky = false,
}: {
  current: MastView;
  dateline?: string;
  menuExtra?: ReactNode;
  sticky?: boolean;
}) {
  const vp = useViewport();
  const [menu, setMenu] = useState(false);

  const wordmark = (size: number) => (
    <Link
      href="/"
      style={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', minWidth: 0 }}
    >
      <span
        style={{
          fontFamily: f.display,
          fontWeight: 700,
          fontSize: size,
          color: c.text,
          letterSpacing: '0.14em',
          whiteSpace: 'nowrap',
        }}
      >
        THE CHRONICLE
      </span>
    </Link>
  );

  // ── phone ──
  if (vp.isMobile) {
    return (
      <header
        style={{
          position: sticky ? 'sticky' : 'relative',
          top: sticky ? 0 : undefined,
          flexShrink: 0,
          zIndex: 20,
          background: c.frame,
          borderBottom: `1px solid ${c.lineStrong}`,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {wordmark(17)}
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setMenu((m) => !m)}
          style={{
            background: menu ? c.accentSoft : 'transparent',
            border: `1px solid ${c.line}`,
            width: 38,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <MenuIcon open={menu} color={menu ? c.accent : c.textDim} />
        </button>

        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 12,
                marginTop: 6,
                zIndex: 31,
                width: 'min(280px, calc(100vw - 24px))',
                background: c.panel,
                border: `1px solid ${c.lineStrong}`,
                boxShadow: '0 18px 50px rgba(0,0,0,0.6)',
              }}
            >
              {dateline !== undefined && (
                <div style={{ padding: '13px 15px', borderBottom: `1px solid ${c.line}` }}>
                  <Kicker>{dateline}</Kicker>
                </div>
              )}
              {NAV.map((item) => {
                const active = item.key === current;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setMenu(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textDecoration: 'none',
                      borderBottom: `1px solid ${c.line}`,
                      padding: '13px 15px',
                    }}
                  >
                    <span style={{ fontFamily: f.display, fontSize: 16, color: active ? c.accent : c.text }}>
                      {item.label}
                    </span>
                    {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.accent }} />}
                  </Link>
                );
              })}
              {menuExtra !== undefined && <div style={{ padding: '13px 15px' }}>{menuExtra}</div>}
            </div>
          </>
        )}
      </header>
    );
  }

  // ── tablet / desktop ──
  return (
    <header
      style={{
        position: sticky ? 'sticky' : 'relative',
        top: sticky ? 0 : undefined,
        flexShrink: 0,
        zIndex: 20,
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
        {wordmark(22)}
        {dateline !== undefined && (
          <>
            <span style={{ width: 1, height: 18, background: c.line }} />
            <Kicker style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dateline}</Kicker>
          </>
        )}
      </div>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {NAV.filter((i) => i.key !== 'home').map((item) => {
          const active = item.key === current;
          return (
            <Link
              key={item.key}
              href={item.href}
              style={{
                fontFamily: f.mono,
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: active ? c.accent : c.textFaint,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                borderBottom: `1px solid ${active ? c.accent : 'transparent'}`,
                paddingBottom: 2,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
