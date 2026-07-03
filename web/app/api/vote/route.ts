// app/api/vote/route.ts
// The site's own backend endpoint that records a ballot — the ONLY thing that
// writes votes (PLAN-audience-voting.md §5). The browser never touches
// Firebase directly; it POSTs here, same-origin, and this route validates
// then writes with a server-side admin credential (lib/firebaseAdmin.ts).
//
// Route Handler conventions per node_modules/next/dist/docs/.../route.md:
// a plain exported async POST(request), NextRequest/NextResponse, no
// bodyParser config needed. GET/PUT/etc are unsupported here (Next returns
// 405 automatically for methods this file doesn't export).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isFirebaseConfigured } from '../../../lib/firebaseAdmin';
import { isValidOptionId } from '../../../lib/vote/voteCopy';
import { isValidCycleId } from '../../../lib/vote/voteCycle';
import { recordVote } from '../../../lib/vote/tallyStore';
import { checkAndRecordVote, clientIpHash, sameOriginOk } from '../../../lib/vote/serverGuard';

// POST is never cached by Next regardless; force-dynamic documents intent.
export const dynamic = 'force-dynamic';

interface VoteBody {
  cycleId?: unknown;
  optionId?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ ok: false, message: 'the world does not know this messenger.' }, { status: 403 });
  }

  let body: VoteBody;
  try {
    body = (await request.json()) as VoteBody;
  } catch {
    return NextResponse.json({ ok: false, message: 'the world did not understand your breath.' }, { status: 400 });
  }

  const cycleId = typeof body.cycleId === 'string' ? body.cycleId : '';
  const optionId = typeof body.optionId === 'string' ? body.optionId : '';

  if (!isValidCycleId(cycleId) || !isValidOptionId(optionId)) {
    return NextResponse.json({ ok: false, message: 'that petition means nothing to the world.' }, { status: 400 });
  }

  const ipHash = clientIpHash(request);
  if (!checkAndRecordVote(ipHash, cycleId)) {
    return NextResponse.json({ ok: false, message: 'the world is catching its breath.' }, { status: 429 });
  }

  try {
    await recordVote(cycleId, optionId);
  } catch (err) {
    console.error('[api/vote] write failed', err);
    return NextResponse.json(
      { ok: false, message: 'the world did not receive your breath — try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, stub: !isFirebaseConfigured() });
}
