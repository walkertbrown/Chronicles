// app/api/tally/route.ts
// Returns the current tally for a cycle, spike-protected by a short in-memory
// cache (~10s TTL — lib/vote/tallyCache.ts). This is the read path the vote
// panel polls; per the cost-watchdog amendment it must be polled at most
// every 30s client-side (see lib/vote/useVote.ts), never the 1s habit used
// for /state.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isFirebaseConfigured } from '../../../lib/firebaseAdmin';
import { getCachedTally, setCachedTally } from '../../../lib/vote/tallyCache';
import { readTally } from '../../../lib/vote/tallyStore';
import { isValidCycleId } from '../../../lib/vote/voteCycle';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cycleId = request.nextUrl.searchParams.get('cycleId') ?? '';
  if (!isValidCycleId(cycleId)) {
    return NextResponse.json({ ok: false, message: 'no such cycle.' }, { status: 400 });
  }

  const cached = getCachedTally(cycleId);
  if (cached !== null) {
    return NextResponse.json({ ok: true, cycleId, counts: cached, stub: !isFirebaseConfigured(), cached: true });
  }

  try {
    const counts = await readTally(cycleId);
    setCachedTally(cycleId, counts);
    return NextResponse.json({ ok: true, cycleId, counts, stub: !isFirebaseConfigured(), cached: false });
  } catch (err) {
    console.error('[api/tally] read failed', err);
    return NextResponse.json({ ok: false, message: 'the tally is unreachable.' }, { status: 502 });
  }
}
