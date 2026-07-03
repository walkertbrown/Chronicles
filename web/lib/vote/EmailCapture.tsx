'use client';
// lib/vote/EmailCapture.tsx
// Buttondown embed (email capture ships with the relaunch). The owner hasn't
// created the Buttondown account yet, so this stays behind an env var with a
// graceful "not configured yet" fallback rather than a broken form pointing
// at a username that doesn't exist. Once NEXT_PUBLIC_BUTTONDOWN_USERNAME is
// set (see web/.env.example), the real embed appears with no code change.
//
// Embed action URL confirmed against Buttondown's current docs
// (docs.buttondown.com/building-your-subscriber-base): a plain HTML <form>
// POST to https://buttondown.com/api/emails/embed-subscribe/{username}. No
// script, no CORS — safe to render from a client component.
import { oracle, Kicker } from '../oracle';
import { WORLD_NAME } from '../worldName';

const c = oracle.c;
const f = oracle.fonts;

const BUTTONDOWN_USERNAME = process.env.NEXT_PUBLIC_BUTTONDOWN_USERNAME ?? '';

const boxStyle = {
  marginTop: 20,
  paddingTop: 18,
  borderTop: `1px solid ${c.line}`,
};

export function EmailCapture() {
  if (BUTTONDOWN_USERNAME.length === 0) {
    return (
      <div style={boxStyle}>
        <Kicker>Letters from {WORLD_NAME}</Kicker>
        <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 13, color: c.textFaint, margin: '6px 0 0' }}>
          This channel is not yet open — the watchers have not yet set up letters.
        </p>
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      <Kicker color={c.accent}>Letters from {WORLD_NAME}</Kicker>
      <p style={{ fontFamily: f.serif, fontSize: 13, color: c.textDim, margin: '6px 0 10px' }}>
        Receive a letter when the chronicle turns a page.
      </p>
      <form
        action={`https://buttondown.com/api/emails/embed-subscribe/${BUTTONDOWN_USERNAME}`}
        method="post"
        target="popupwindow"
        onSubmit={() => {
          window.open('https://buttondown.com', 'popupwindow', 'scrollbars=yes,width=800,height=600');
        }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <input
          type="email"
          name="email"
          required
          placeholder="your@email"
          aria-label="Email address"
          style={{
            flex: '1 1 180px',
            minWidth: 0,
            background: c.raised,
            border: `1px solid ${c.line}`,
            color: c.text,
            fontFamily: f.serif,
            fontSize: 13,
            padding: '8px 10px',
          }}
        />
        <input type="hidden" value="1" name="embed" />
        <button
          type="submit"
          style={{
            background: c.accentSoft,
            border: `1px solid ${c.accent}`,
            color: c.accent,
            fontFamily: f.mono,
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            padding: '8px 14px',
            cursor: 'pointer',
          }}
        >
          Subscribe
        </button>
      </form>
    </div>
  );
}
