'use client';

// app/page.tsx — The Threshold. A reverent title page that greets the reader as
// a watching god, then sends them into the Eye (the world) or the Chronicle
// (its days). Replaces the bare nav. Fully responsive.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { fetchWorldState } from '../lib/api';
import type { WorldSnapshot } from '../lib/types';
import { oracle, Kicker } from '../lib/oracle';
import { useViewport } from '../lib/useViewport';

const c = oracle.c;
const f = oracle.fonts;

const WORLD_NAME = 'Aethel';
const WORLD_DESIGNATION = 'WORLD I';

// The god's-eye emblem — concentric gilded rings, radiating ticks, a watching
// pupil at the centre. Primitives only.
function EyeEmblem({ size }: { size: number }) {
  const a = c.accent;
  const ticks = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '-22%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${c.accentSoft} 0%, rgba(0,0,0,0) 68%)`,
          pointerEvents: 'none',
        }}
      />
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'relative', display: 'block' }} aria-hidden>
        <circle cx="50" cy="50" r="47" fill="none" stroke={a} strokeWidth="0.5" opacity="0.5" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={a} strokeWidth="0.4" opacity="0.38" />
        <circle cx="50" cy="50" r="22" fill="none" stroke={a} strokeWidth="0.4" opacity="0.3" />
        {ticks.map((i) => {
          const ang = (i / 48) * Math.PI * 2;
          const r1 = 47;
          const r2 = i % 4 === 0 ? 42 : 44.5;
          return (
            <line
              key={i}
              x1={50 + Math.cos(ang) * r1}
              y1={50 + Math.sin(ang) * r1}
              x2={50 + Math.cos(ang) * r2}
              y2={50 + Math.sin(ang) * r2}
              stroke={a}
              strokeWidth="0.4"
              opacity="0.5"
            />
          );
        })}
        <ellipse cx="50" cy="50" rx="20" ry="11" fill="none" stroke={a} strokeWidth="0.9" opacity="0.85" />
        <circle cx="50" cy="50" r="7.5" fill="none" stroke={a} strokeWidth="0.9" opacity="0.9" />
        <circle cx="50" cy="50" r="3.4" fill={a} />
      </svg>
    </div>
  );
}

function FrameCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const s = 'clamp(20px, 4vw, 40px)';
  const base: CSSProperties = { position: 'absolute', width: s, height: s, pointerEvents: 'none', opacity: 0.55 };
  const map: Record<typeof pos, CSSProperties> = {
    tl: { top: 0, left: 0, borderTop: `1px solid ${c.lineStrong}`, borderLeft: `1px solid ${c.lineStrong}` },
    tr: { top: 0, right: 0, borderTop: `1px solid ${c.lineStrong}`, borderRight: `1px solid ${c.lineStrong}` },
    bl: { bottom: 0, left: 0, borderBottom: `1px solid ${c.lineStrong}`, borderLeft: `1px solid ${c.lineStrong}` },
    br: { bottom: 0, right: 0, borderBottom: `1px solid ${c.lineStrong}`, borderRight: `1px solid ${c.lineStrong}` },
  };
  return <span style={{ ...base, ...map[pos] }} />;
}

function ThresholdRule() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, width: '100%', maxWidth: 360, margin: '0 auto' }}>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${c.line})` }} />
      <span style={{ color: c.accent, fontFamily: f.serif, fontSize: 14, opacity: 0.8 }}>✶</span>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${c.line}, transparent)` }} />
    </div>
  );
}

function Portal({
  href,
  kicker,
  title,
  sub,
  primary = false,
}: {
  href: string;
  kicker: string;
  title: string;
  sub: string;
  primary?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: '1 1 220px',
        minWidth: 0,
        textAlign: 'left',
        textDecoration: 'none',
        background: primary ? c.accentSoft : hover ? c.frame : 'transparent',
        border: `1px solid ${primary || hover ? c.lineStrong : c.line}`,
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        transition: 'background .18s, border-color .18s, transform .18s',
        transform: hover ? 'translateY(-2px)' : 'none',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontFamily: f.mono,
            fontSize: 9.5,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: primary ? c.accent : c.textFaint,
            marginBottom: 6,
          }}
        >
          {kicker}
        </span>
        <span style={{ display: 'block', fontFamily: f.display, fontWeight: 600, fontSize: 'clamp(19px, 2.6vw, 23px)', color: c.text, letterSpacing: '0.04em' }}>
          {title}
        </span>
        <span style={{ display: 'block', fontFamily: f.serif, fontStyle: 'italic', fontSize: 14, color: c.textDim, marginTop: 3 }}>{sub}</span>
      </span>
      <span style={{ fontFamily: f.mono, fontSize: 18, color: c.accent, transform: hover ? 'translateX(3px)' : 'none', transition: 'transform .18s' }}>→</span>
    </Link>
  );
}

export default function Threshold() {
  const vp = useViewport();
  const [snap, setSnap] = useState<WorldSnapshot | null>(null);

  // One light read for the population / dateline. Fails quietly if the sim is
  // offline — the copy degrades gracefully.
  useEffect(() => {
    let active = true;
    fetchWorldState()
      .then((s) => {
        if (active) setSnap(s);
      })
      .catch(() => {
        /* simulation server may not be running */
      });
    return () => {
      active = false;
    };
  }, []);

  const emblem = vp.isMobile ? 132 : vp.isTablet ? 164 : 196;
  // Size the nowrap wordmark from the measured width so it never overflows.
  const titleSize = Math.max(22, Math.min(vp.isMobile ? 32 : 58, Math.round(vp.w * 0.072)));
  const pop = snap?.population ?? null;
  const dateline =
    snap !== null
      ? `${snap.season.charAt(0).toUpperCase() + snap.season.slice(1)} · Year ${snap.year} · Day ${snap.day} · ${snap.population} souls ashore`
      : 'Surveyed from the vessel';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflowY: 'auto',
        background: `radial-gradient(120% 86% at 50% 30%, ${c.frame} 0%, ${c.base} 62%)`,
        color: c.text,
      }}
    >
      <FrameCorner pos="tl" />
      <FrameCorner pos="tr" />
      <FrameCorner pos="bl" />
      <FrameCorner pos="br" />

      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
          padding: vp.isMobile ? '54px 22px 40px' : 'clamp(48px, 7vh, 96px) 32px',
          gap: vp.isMobile ? 18 : 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: '100%' }}>
          <span style={{ width: 'clamp(16px,5vw,40px)', height: 1, background: c.line }} />
          <Kicker>
            {WORLD_DESIGNATION} · {WORLD_NAME} · Surveyed from the vessel
          </Kicker>
          <span style={{ width: 'clamp(16px,5vw,40px)', height: 1, background: c.line }} />
        </div>

        <EyeEmblem size={emblem} />

        <div>
          <Kicker color={c.accent} style={{ fontSize: 'clamp(10px,1.6vw,12px)', letterSpacing: '0.32em' }}>
            You are watching
          </Kicker>
          <h1 style={{ fontFamily: f.display, fontWeight: 700, color: c.text, fontSize: titleSize, letterSpacing: '0.06em', lineHeight: 1.1, margin: '14px 0 0' }}>
            THE CHRONICLE
          </h1>
          <p style={{ fontFamily: f.serif, fontStyle: 'italic', color: c.textDim, fontSize: 'clamp(17px, 3vw, 25px)', margin: '12px 0 0', letterSpacing: '0.02em' }}>
            of {WORLD_NAME}
          </p>
        </div>

        <ThresholdRule />

        <p style={{ fontFamily: f.serif, color: c.textDim, maxWidth: 600, fontSize: 'clamp(15px, 2.4vw, 19px)', lineHeight: 1.75, margin: 0, textWrap: 'pretty' }}>
          A world has begun without you. {pop !== null ? `${pop} souls have` : 'Souls have'} come ashore on a coast that has
          no name for them — to build, to quarrel, to fall ill, to fall in love. They will never know you are here. You may
          only watch the world turn, read what its days set down, and — once each cycle — breathe upon it.
        </p>

        <div style={{ display: 'flex', flexDirection: vp.isMobile ? 'column' : 'row', gap: 14, width: '100%', maxWidth: 600, marginTop: 6, boxSizing: 'border-box', minWidth: 0 }}>
          <Portal primary href="/world" kicker="The world, surveyed" title="The Eye" sub="Walk the plate · find the watched" />
          <Portal href="/chronicle" kicker="The days, as written" title="The Chronicle" sub="Read the page set this morning" />
        </div>

        <div style={{ marginTop: vp.isMobile ? 6 : 10 }}>
          <Kicker>{dateline}</Kicker>
        </div>
      </div>
    </div>
  );
}
