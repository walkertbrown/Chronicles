'use client';
// lib/vote/VotePanel.tsx
// The vote modal — moved out of lib/oracle.tsx (which was over the file-size
// ceiling) and rewritten in divinity voice. No "Divinity Choice" menu header,
// no placeholder camp-movement prompt, no fake turnout number: everything
// here is wired to a real cycle (voteCycle.ts), real owner-authored copy
// (voteCopy.ts), and a real tally (useVote.ts → /api/vote, /api/tally).
import { oracle, EngravedBar, Kicker, Seal } from '../oracle';
import { EmailCapture } from './EmailCapture';
import { SourceMeter } from './SourceMeter';
import { useVote } from './useVote';
import type { VoteOptionId } from './types';

const c = oracle.c;
const f = oracle.fonts;

export function VotePanel({ onClose }: { onClose: () => void }) {
  const { prompt, counts, hasVoted, chosenOptionId, casting, castError, closesInLabel, cast } = useVote();

  const total = counts?.total ?? 0;
  const turnoutLabel =
    total === 0 ? 'Be the first to breathe' : `${total.toLocaleString()} breath${total === 1 ? '' : 's'} drawn`;

  const shareOf = (id: VoteOptionId): number => {
    if (counts === null || counts.total === 0) return 0;
    return counts[id] / counts.total;
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(8,6,4,0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)',
          maxHeight: '90%',
          overflowY: 'auto',
          background: c.frame,
          border: `1px solid ${c.lineStrong}`,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          padding: '34px 38px 30px',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 16,
            right: 18,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: c.textFaint,
            fontFamily: f.serif,
            fontSize: 22,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 22 }}>
          <Seal size={58} glyph="◉" />
          <div style={{ marginTop: 14 }}>
            <Kicker color={c.accent}>{prompt.kicker}</Kicker>
          </div>
        </div>

        <SourceMeter />

        <p
          style={{
            fontFamily: f.serif,
            fontSize: 17,
            lineHeight: 1.6,
            color: c.textDim,
            textAlign: 'center',
            margin: '0 0 24px',
            fontStyle: 'italic',
          }}
        >
          {prompt.prompt}
        </p>

        <div style={{ height: 1, background: c.line, marginBottom: 20 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {prompt.options.map((o) => {
            const chosen = chosenOptionId === o.id;
            const disabled = hasVoted || casting;
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => cast(o.id)}
                style={{
                  position: 'relative',
                  textAlign: 'left',
                  cursor: disabled ? 'default' : 'pointer',
                  background: c.panel,
                  border: `1px solid ${chosen ? c.accent : c.line}`,
                  padding: '13px 15px',
                  opacity: hasVoted && !chosen ? 0.6 : 1,
                }}
              >
                <span style={{ display: 'block', fontFamily: f.display, fontSize: 19, color: c.text }}>{o.title}</span>
                <span style={{ display: 'block', fontFamily: f.serif, fontSize: 14, color: c.textDim, marginTop: 4, lineHeight: 1.45 }}>
                  {o.body}
                </span>
                {counts !== null && (
                  <div style={{ marginTop: 9 }}>
                    <EngravedBar label="" value={shareOf(o.id)} color={chosen ? c.accent : c.textFaint} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Kicker>
            {turnoutLabel}
            {closesInLabel.length > 0 ? ` · closes in ${closesInLabel}` : ''}
          </Kicker>
          {hasVoted && <Kicker color={c.accent}>Your breath is recorded</Kicker>}
        </div>

        {hasVoted && (
          <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 15, color: c.textDim, textAlign: 'center', margin: '16px 0 0', lineHeight: 1.55 }}>
            It is done. The world does not know your name. It will only feel the weather change.
          </p>
        )}

        {castError !== null && (
          <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 14, color: c.accent2, textAlign: 'center', margin: '14px 0 0' }}>
            {castError}
          </p>
        )}

        <EmailCapture />
      </div>
    </div>
  );
}
