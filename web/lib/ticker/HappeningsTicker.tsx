// lib/ticker/HappeningsTicker.tsx
'use client';
// Always-visible "THE WORLD STIRS" strip — the newest 1-3 raw facts straight
// from the sim's event log (simulation/events/log.ts buildRecentEventsFeed),
// rendered from data the page's existing 1s /state poll already fetched (see
// app/world/page.tsx — no new fetch, no new endpoint, no LLM). Deliberately
// NOT collapsible: simpler than an expandable strip, per the approved design.
//
// `recentEvents` is optional and may be an empty array — either means the
// live sim hasn't redeployed this field yet, or genuinely nothing qualifying
// happened recently. Both render the same quiet fallback line; this
// component never throws and never blank-renders.
import { oracle } from '../oracle';
import { TICKER_STYLE, TICKER_FALLBACK_STYLE } from './types';
import type { RecentEvent } from './types';

const c = oracle.c;
const f = oracle.fonts;

const MAX_VISIBLE = 3;

export function HappeningsTicker({ recentEvents }: { recentEvents?: RecentEvent[] }) {
  const items = (recentEvents ?? []).slice(0, MAX_VISIBLE);

  return (
    <div
      style={{
        flexShrink: 0,
        background: c.frame,
        borderBottom: `1px solid ${c.line}`,
        padding: '10px clamp(16px, 4vw, 22px)',
      }}
    >
      <div
        style={{
          fontFamily: f.display,
          fontSize: 'clamp(11px, 2.4vw, 13px)',
          fontWeight: 600,
          letterSpacing: '0.18em',
          color: c.accent,
          marginBottom: 7,
        }}
      >
        THE WORLD STIRS
      </div>
      {items.length === 0 ? (
        <p style={{ fontFamily: f.serif, fontSize: 14, lineHeight: 1.5, color: c.textFaint, margin: 0, fontStyle: 'italic' }}>
          the world is still
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((event) => {
            const style = TICKER_STYLE[event.type] ?? TICKER_FALLBACK_STYLE;
            return (
              <div key={event.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{ color: style.color, fontSize: 12, flexShrink: 0, width: 14, textAlign: 'center' }}
                >
                  {style.glyph}
                </span>
                <span
                  style={{
                    fontFamily: f.serif,
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: c.textDim,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {event.description}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
