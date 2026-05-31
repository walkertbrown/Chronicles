'use client';

// Shared viewport hook — ported from the prototype's useMeasuredWidth.
// `useViewport()` tracks window width (SSR-safe: defaults to desktop until
// mounted) and derives the breakpoint booleans the Oracle pages use.
// `useElementWidth(ref)` is the generalized element-measuring variant.

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface Viewport {
  w: number;
  isMobile: boolean; // phones — stacked chrome, hamburger
  isTablet: boolean;
  isNarrow: boolean; // the Eye can no longer sit map + ledger side-by-side
}

export const BREAKPOINTS = { mobile: 760, atlas: 920, tablet: 1100 } as const;

function fromWidth(w: number): Viewport {
  return {
    w,
    isMobile: w < BREAKPOINTS.mobile,
    isTablet: w >= BREAKPOINTS.mobile && w < BREAKPOINTS.tablet,
    isNarrow: w < BREAKPOINTS.atlas,
  };
}

export function useViewport(): Viewport {
  // Default to a desktop width so server render + first paint match desktop,
  // then correct on mount. Avoids a hydration mismatch flashing mobile chrome.
  const [w, setW] = useState<number>(1280);
  useEffect(() => {
    const apply = () => setW(window.innerWidth);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  return fromWidth(w);
}

// Measure any element's width (ResizeObserver + window resize). Useful when a
// region needs to respond to its own box rather than the whole viewport.
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = -1;
    const apply = () => {
      const nw = Math.round(el.getBoundingClientRect().width);
      if (nw && nw !== last) {
        last = nw;
        setW(nw);
      }
    };
    apply();
    window.addEventListener('resize', apply);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', apply);
      ro?.disconnect();
    };
  }, [ref]);
  return w;
}
