'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchChronicle } from '../../lib/api';
import type { ChronicleEntry } from '../../lib/types';
import { oracle, Kicker, SectionHead, Seal, Masthead, VotePanel } from '../../lib/oracle';

const c = oracle.c;
const f = oracle.fonts;

function dateline(p: ChronicleEntry): string {
  return `${p.season.toUpperCase()} · YEAR ${p.year} · DAY ${p.day}`;
}

function pageLabel(p: ChronicleEntry): string {
  if (p.title !== undefined && p.title.length > 0) return p.title;
  return dateline(p);
}

function sortPages(pages: ChronicleEntry[]): ChronicleEntry[] {
  return [...pages].sort((a, b) => (a.order ?? a.day) - (b.order ?? b.day));
}

function PageHeader({ page }: { page: ChronicleEntry }) {
  if (page.title === undefined && page.subtitle === undefined) return null;
  return (
    <div style={{ marginBottom: page.body !== undefined || page.fullPage.length > 0 ? 18 : 0 }}>
      {page.title !== undefined && (
        <h2
          style={{
            fontFamily: f.display,
            fontWeight: 600,
            fontSize: 'clamp(22px, 4vw, 28px)',
            color: c.paperText,
            margin: 0,
            letterSpacing: '0.06em',
            lineHeight: 1.2,
          }}
        >
          {page.title}
        </h2>
      )}
      {page.subtitle !== undefined && (
        <p
          style={{
            fontFamily: f.serif,
            fontStyle: 'italic',
            fontSize: 16,
            lineHeight: 1.55,
            color: c.paperDim,
            margin: page.title !== undefined ? '10px 0 0' : 0,
          }}
        >
          {page.subtitle}
        </p>
      )}
    </div>
  );
}

function PageBody({ page, dropCap }: { page: ChronicleEntry; dropCap: boolean }) {
  const text = page.body ?? page.fullPage;
  if (page.threads.length > 0) {
    return (
      <>
        {page.threads.map((thread, i) => (
          <div key={`${thread.primaryAgentId}-${i}`}>
            {i > 0 && <PaperOrnament />}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontFamily: f.mono, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: c.paperDim }}>
                The {thread.familyName} thread
              </span>
            </div>
            <ProseBlock text={thread.prose} dropCap={dropCap && i === 0} />
          </div>
        ))}
      </>
    );
  }
  return <ProseBlock text={text} dropCap={dropCap} />;
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
  const latestRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await fetchChronicle();
        if (active) setPages(sortPages(data.pages));
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

  // On first load, land the reader on the newest entry, expanded at the bottom.
  useEffect(() => {
    if (hasScrolled.current || pages.length === 0) return;
    hasScrolled.current = true;
    requestAnimationFrame(() => {
      latestRef.current?.scrollIntoView({ block: 'start' });
    });
  }, [pages.length]);

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
      <div style={{ background: c.base, color: c.textFaint, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Masthead current="chronicle" sticky />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            textAlign: 'center',
            padding: '24px',
          }}
        >
          <Seal size={56} glyph="◉" />
          <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 18, color: c.textDim, margin: '14px 0 0' }}>
            The chronicle has not yet begun.
          </p>
          <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 18, color: c.textFaint, margin: 0 }}>The vessel is still at sea.</p>
        </div>
      </div>
    );
  }

  const sorted = sortPages(pages);
  const latest = sorted[sorted.length - 1]!;
  const archive = sorted.slice(0, -1);
  const latestHeadline = latest.isPrologue ? latest.title ?? pageLabel(latest) : dateline(latest);

  return (
    <div style={{ background: c.base, color: c.text, minHeight: '100vh' }}>
      {/* masthead */}
      <Masthead current="chronicle" dateline={latest.isPrologue ? (latest.subtitle ?? pageLabel(latest)) : dateline(latest)} sticky />

      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(28px, 5vw, 64px) 24px 80px' }}>
        {/* the archive — oldest first, every prior day preserved and collapsed */}
        {archive.length > 0 && (
          <div>
            <SectionHead accent>The Archive · every day preserved</SectionHead>
            <div>
              {archive.map((p, i) => {
                const isOpen = open.has(i);
                return (
                  <div key={p.id ?? `${p.generatedAt}-${p.day}`} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 2px' }}
                    >
                      <span style={{ fontFamily: f.display, fontSize: 21, color: isOpen ? c.accent : c.text }}>{pageLabel(p)}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Kicker>
                          {p.isPrologue ? 'prologue' : `${p.threads.length} thread${p.threads.length === 1 ? '' : 's'}`}
                        </Kicker>
                        <span style={{ color: c.accent, fontFamily: f.mono, fontSize: 12 }}>{isOpen ? '–' : '+'}</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 2px 22px' }}>
                        <Leaf light>
                          <PageHeader page={p} />
                          <PageBody page={p} dropCap={false} />
                        </Leaf>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* the newest day — featured and expanded at the bottom; load scrolls here */}
        <div ref={latestRef} style={{ scrollMarginTop: 80, marginTop: archive.length > 0 ? 'clamp(36px,6vw,64px)' : 0 }}>
          {/* book head */}
          <div style={{ textAlign: 'center', marginBottom: 'clamp(28px,5vw,52px)' }}>
            <Kicker color={c.accent}>The Chronicle of Aethel</Kicker>
            <h1 style={{ fontFamily: f.display, fontWeight: 600, fontSize: 'clamp(34px,5vw,52px)', color: c.text, margin: '12px 0 0', letterSpacing: '0.08em' }}>
              {latestHeadline}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
              <span style={{ width: 40, height: 1, background: c.line }} />
              <Kicker>{latest.isPrologue ? 'The record before landfall' : 'A page set this morning, unauthored'}</Kicker>
              <span style={{ width: 40, height: 1, background: c.line }} />
            </div>
          </div>

          {/* the latest leaf */}
          <Leaf>
            <PageHeader page={latest} />
            <PageBody page={latest} dropCap />

            {!latest.isPrologue && latest.significantEvents.length > 0 && (
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
            style={{ display: 'none', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left', cursor: 'pointer', margin: '26px 0 0', padding: '18px 22px', background: c.accentSoft, border: `1px solid ${c.lineStrong}` }}
          >
            <Seal size={46} glyph="◉" subtle />
            <span style={{ flex: 1 }}>
              <Kicker color={c.accent}>You are watching</Kicker>
              <span style={{ display: 'block', fontFamily: f.display, fontSize: 21, color: c.text, marginTop: 3 }}>Divinity Choice</span>
              <span style={{ display: 'block', fontFamily: f.serif, fontSize: 14, color: c.textDim, marginTop: 3 }}>
                You may breathe upon the world — once, this cycle.
              </span>
            </span>
            <span style={{ fontFamily: f.mono, fontSize: 18, color: c.accent }}>→</span>
          </button>
        </div>
      </main>

      {voteOpen && <VotePanel onClose={() => setVoteOpen(false)} />}
    </div>
  );
}
