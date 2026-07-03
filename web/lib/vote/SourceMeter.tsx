'use client';
// lib/vote/SourceMeter.tsx
// The "Divinity" needle: reads source.control / source.state, already present
// on /state (see lib/types.ts SourceSnapshot), and renders the dormant state
// gracefully — the Source is unbuilt/unawakened for most of the game's life,
// so "nothing here yet" must read as in-world, not broken.
import { useEffect, useState } from 'react';
import { fetchWorldState } from '../api';
import type { SourceSnapshot } from '../types';
import { oracle, Kicker } from '../oracle';

const c = oracle.c;
const f = oracle.fonts;

type LoadState = 'loading' | 'ready';

export function SourceMeter() {
  const [source, setSource] = useState<SourceSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;
    fetchWorldState()
      .then((s) => {
        if (active) {
          setSource(s.source ?? null);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) setState('ready');
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div style={{ margin: '0 0 20px', textAlign: 'center' }}>
        <Kicker>Reading the balance…</Kicker>
      </div>
    );
  }

  const sourceState = source?.state ?? 'dormant';
  const control = Math.max(-1, Math.min(1, source?.control ?? 0));
  const pct = ((control + 1) / 2) * 100; // -1..1 → 0..100
  const dark = sourceState === 'dark';
  const light = sourceState === 'light';
  const needleColor = dark ? c.conduitDark : light ? c.conduitLight : c.textFaint;
  const label =
    sourceState === 'dormant'
      ? 'The Source lies dormant beyond the ruins. No hand has yet awakened it.'
      : light
        ? 'The Source stirs toward the Unbound light.'
        : 'The Source stirs toward the old gods’ dark.';

  return (
    <div style={{ margin: '0 0 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Kicker color={dark ? c.conduitDark : light ? c.conduitLight : c.textFaint}>Divinity</Kicker>
        <Kicker>{sourceState}</Kicker>
      </div>
      <div style={{ position: 'relative', height: 5, background: c.raised, border: `1px solid ${c.line}` }}>
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: `${pct}%`,
            width: 2,
            height: 9,
            background: needleColor,
            transform: 'translateX(-1px)',
            opacity: sourceState === 'dormant' ? 0.5 : 0.95,
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontFamily: f.mono, fontSize: 9, letterSpacing: '0.1em', color: c.conduitDarkStroke }}>
          OLD GODS
        </span>
        <span style={{ fontFamily: f.mono, fontSize: 9, letterSpacing: '0.1em', color: c.conduitLightStroke }}>
          UNBOUND
        </span>
      </div>
      <p style={{ fontFamily: f.serif, fontStyle: 'italic', fontSize: 13, color: c.textDim, textAlign: 'center', margin: '10px 0 0' }}>
        {label}
      </p>
    </div>
  );
}
