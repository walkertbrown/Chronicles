'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchChronicle } from '../../lib/api';
import type { ChronicleEntry } from '../../lib/types';
import { oracle, Kicker, SectionHead, Seal, VotePanel } from '../../lib/oracle';

const c = oracle.c;
const f = oracle.fonts;

function dateline(p: ChronicleEntry): string {
  return `${p.season.toUpperCase()} · YEAR ${p.year} · DAY ${p.day}`;
}

function ProseBlock({ text, dropCap }: { text: string; dropCap: boolean }) {
  const paras = text.split(/\n\n+/).filter((p) => p.trim());
  if (paras.length === 0) {
    return <p style={{ fontFamily: f.serif, fontSize: 19, lineHeight: 1.85, color: c.paperText, margin: 0 }}>{text}</p>;
  }
  return (
    <div>
      {paras.map((p, i) => (
        <p key={i} style={{ fontFamily: f.serif, fontSize: 19, lineHeight: 1.85, color: c.paperText, margin: '0 0 1.4em', textWrap: 'pretty' }}>
          {dropCap && i === 0 ? (
            <span style={{ float: 'left', fontFamily: f.display, fontWeight: 600, fontSize: 62, lineHeight: 0.82, paddingRight: 10, paddingTop: 6, color: c.accent }}>
              {p.charAt(0)}
            </span>
          ) : null}
          {dropCap && i === 0 ? p.slice(1) : p}
        </p>
      ))}
    </div>
  );
}

function Leaf({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <div
      style={{
        background: c.paper,
        border: `1px solid ${c.paperRule}`,
        boxShadow: light ? `0 1px 0 ${c.paperRule}` : `0 18px 60px ${c.paperEdge}`,
        padding: 'clamp(28px, 5vw, 60px)',
      }}
    >
      {children}
    </div>
  );
}

function PaperOrnament() {
  return <div style={{ textAlign: 'center', color: c.paperDim, fontFamily: f.serif, fontSize: 16, letterSpacing: '0.5em', margin: '30px 0' }}>❧</div>;
}

export default function ChroniclePage() {
  const [pages, setPages] = useState<ChronicleEntry[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [voteOpen, setVoteOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await fetchChronicle();
        if (active) setPages(data.pages);
      } catch {
        // Simulation server may not be running yet
      }
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // ── empty state ──
  if (pages.length === 0) {
    return (
      <div style={{ background: c.base, color: c.textFaint, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center' }}>
        <Seal size={56} glyph="◉" />
        <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 18, color: c.textDim, margin: '14px 0 0' }}>The chronicle has not yet begun.</p>
        <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 18, color: c.textFaint, margin: 0 }}>The vessel is still at sea.</p>
      </div>
    );
  }

  const latest = pages[pages.length - 1]!;
  const archive = pages.slice(0, -1).reverse();

  return (
    <div style={{ background: c.base, color: c.text, minHeight: '100vh' }}>
      {/* masthead */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: c.frame,
          borderBottom: `1px solid ${c.lineStrong}`,
          padding: '12px 22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontFamily: f.display, fontWeight: 700, fontSize: 22, color: c.text, letterSpacing: '0.14em' }}>THE CHRONICLE</span>
        <Link href="/world" style={{ fontFamily: f.mono, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: c.accent, textDecoration: 'none' }}>
          ← The Eye
        </Link>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(28px, 5vw, 64px) 24px 80px' }}>
        {/* book head */}
        <div style={{ textAlign: 'center', marginBottom: 'clamp(28px,5vw,52px)' }}>
          <Kicker color={c.accent}>The Chronicle of Aethel</Kicker>
          <h1 style={{ fontFamily: f.display, fontWeight: 600, fontSize: 'clamp(34px,5vw,52px)', color: c.text, margin: '12px 0 0', letterSpacing: '0.08em' }}>
            {dateline(latest)}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
            <span style={{ width: 40, height: 1, background: c.line }} />
            <Kicker>A page set this morning, unauthored</Kicker>
            <span style={{ width: 40, height: 1, background: c.line }} />
          </div>
        </div>

        {/* the latest leaf */}
        <Leaf>
          {latest.threads.length > 0 ? (
            latest.threads.map((thread, i) => (
              <div key={`${thread.primaryAgentId}-${i}`}>
                {i > 0 && <PaperOrnament />}
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontFamily: f.mono, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: c.paperDim }}>
                    The {thread.familyName} thread
                  </span>
                </div>
                <ProseBlock text={thread.prose} dropCap />
              </div>
            ))
          ) : (
            <ProseBlock text={latest.fullPage} dropCap />
          )}

          {latest.significantEvents.length > 0 && (
            <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${c.paperRule}` }}>
              <span style={{ fontFamily: f.mono, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: c.paperDim }}>This day it is written</span>
              <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                {latest.significantEvents.map((e, i) => (
                  <li key={i} style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 15, color: c.paperDim, padding: '3px 0' }}>
                    — {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Leaf>

        {/* the breath */}
        <button
          type="button"
          onClick={() => setVoteOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left', cursor: 'pointer', margin: '26px 0 0', padding: '18px 22px', background: c.accentSoft, border: `1px solid ${c.lineStrong}` }}
        >
          <Seal size={46} glyph="◉" subtle />
          <span style={{ flex: 1 }}>
            <Kicker color={c.accent}>You are watching</Kicker>
            <span style={{ display: 'block', fontFamily: f.display, fontSize: 21, color: c.text, marginTop: 3 }}>Your Influence</span>
            <span style={{ display: 'block', fontFamily: f.serif, fontSize: 14, color: c.textDim, marginTop: 3 }}>
              You may cast your influence upon the world — once, this cycle.
            </span>
          </span>
          <span style={{ fontFamily: f.mono, fontSize: 18, color: c.accent }}>→</span>
        </button>

        {/* the archive */}
        {archive.length > 0 && (
          <div style={{ marginTop: 'clamp(36px,6vw,64px)' }}>
            <SectionHead accent>The Archive · every day preserved</SectionHead>
            <div>
              {archive.map((p, i) => {
                const isOpen = open.has(i);
                return (
                  <div key={`${p.generatedAt}-${p.day}`} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 2px' }}
                    >
                      <span style={{ fontFamily: f.display, fontSize: 21, color: isOpen ? c.accent : c.text }}>{dateline(p)}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Kicker>
                          {p.threads.length} thread{p.threads.length === 1 ? '' : 's'}
                        </Kicker>
                        <span style={{ color: c.accent, fontFamily: f.mono, fontSize: 12 }}>{isOpen ? '–' : '+'}</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 2px 22px' }}>
                        <Leaf light>
                          <ProseBlock text={p.fullPage} dropCap={false} />
                        </Leaf>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {voteOpen && <VotePanel onClose={() => setVoteOpen(false)} />}
    </div>
  );
}
