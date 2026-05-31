// lib/oracle.tsx
'use client';
// Shared Oracle visual system — design tokens + small presentational atoms.
// Imported by app/world/page.tsx and app/chronicle/page.tsx so both pages stay lean.
//
// Fonts (Cinzel / EB Garamond / IBM Plex Mono) are loaded via @import in globals.css.

import type { CSSProperties, ReactNode } from 'react';

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
