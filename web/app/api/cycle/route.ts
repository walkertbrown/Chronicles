// app/api/cycle/route.ts
// Returns the sim's authored decision for a vote cycle — Phase 1.5's new read
// path. This is what lets the web show the vote type + target name(s) the
// sim actually picked (voteCycles/{cycleId}), instead of always deriving the
// prompt client-side. Cache-protected the same way /api/tally is (~10s TTL,
// lib/vote/cycleCache.ts): fetched once per cycle-open by useVote.ts, not in
// a tight loop, but a burst of visitors opening the panel in the same window
// shouldn't each cost a Firestore read.
//
// Never returns targetIds (internal sim agent/structure ids) — the response
// is deliberately narrower than the full voteCycles/{cycleId} doc (see
// lib/vote/types.ts's VoteCycleDoc for what the browser is allowed to see).
// `authored: false` is the "not yet authored" signal (sim down, or web
// deployed before the sim writes this cycle's doc) — distinct from an
// `ok: false` network/auth error, which always carries a message and a
// non-200 status instead.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isFirebaseConfigured } from '../../../lib/firebaseAdmin';
import { getCachedCycle, setCachedCycle } from '../../../lib/vote/cycleCache';
import { readVoteCycle } from '../../../lib/vote/cycleStore';
import { isValidCycleId } from '../../../lib/vote/voteCycle';
import type { VoteCycleDoc } from '../../../lib/vote/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cycleId = request.nextUrl.searchParams.get('cycleId') ?? '';
  if (!isValidCycleId(cycleId)) {
    return NextResponse.json({ ok: false, message: 'no such cycle.' }, { status: 400 });
  }

  const cached = getCachedCycle(cycleId);
  if (cached !== undefined) {
    return respond(cycleId, cached, true);
  }

  try {
    const doc = await readVoteCycle(cycleId);
    setCachedCycle(cycleId, doc);
    return respond(cycleId, doc, false);
  } catch (err) {
    console.error('[api/cycle] read failed', err);
    return NextResponse.json({ ok: false, message: 'the cycle record is unreachable.' }, { status: 502 });
  }
}

function respond(cycleId: string, doc: VoteCycleDoc | null, cached: boolean): NextResponse {
  if (doc === null) {
    return NextResponse.json({ ok: true, cycleId, authored: false, stub: !isFirebaseConfigured(), cached });
  }
  // Only type + flavorNames cross the wire — doc may not carry anything else
  // per VoteCycleDoc's shape, but this stays explicit rather than spreading
  // `doc` so a future field added to VoteCycleDoc can't leak here by accident.
  return NextResponse.json({
    ok: true,
    cycleId,
    authored: true,
    type: doc.type,
    flavorNames: doc.flavorNames,
    stub: !isFirebaseConfigured(),
    cached,
  });
}
