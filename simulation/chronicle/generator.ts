// simulation/chronicle/generator.ts
// Makes the Anthropic API call and returns the chronicle prose.

import Anthropic from '@anthropic-ai/sdk';
import type { ChronicleEntry, WorldState } from '@shared/types.js';
import { Season } from '@shared/types.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import {
  isChronicleCollectionEmpty,
  writeChronicleDocument,
} from '../firebase.js';
import { packThreads, packCameos } from './packager.js';
import { buildChroniclePrompt } from './prompt.js';

// ============================================================
// CONSTANTS
// ============================================================

const CHRONICLE_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const REVISION_MAX_TOKENS = 1500;
const SYSTEM_PROMPT =
  'You are the voice of an ancient chronicle. Write only what the data tells you. Do not invent.';

const PROLOGUE_BODY = `We left because the gods were wrong.

Not absent. Not silent. Wrong — in the specific, structural way that a thing built to keep people small will always be wrong, no matter how many centuries it spends calling itself sacred. The gods of the old world had an answer for everything, and every answer pointed the same direction: stay. Obey. Be grateful for the ceiling we have placed above you, for without it you would be lost.

Some of us were cast out. Some chose to leave. The water does not care about the distinction, and after enough weeks at sea, neither do we.

There is a story the priests told — one of their favorites, trotted out whenever someone asked the wrong question or stood up too straight. A civilization that came before us. The Unbound, they were called, which was meant to sound like a warning and somehow always sounded, to certain ears, like an invitation. People who reached for what the gods kept for themselves. Who vanished. Who were destroyed, or transformed, or — and this is the part the priests never finished — simply left.

No bones. No ruin worth the name. No monument to foolishness.

Just: they were here, and then they were not.

I have spent this crossing thinking about that silence. The deliberate incompleteness of it. A cautionary tale with no body, no grave, no satisfying wreckage. The old gods were many things, but they were not careless. If the Unbound had been destroyed, there would have been evidence. Priests love evidence. They build temples to it.

The silence was intentional. Which means the ending they wouldn't tell us was one they couldn't afford for us to hear.

There are fifty of us on this vessel. We are cold. Several are sick. The stores ran out two days ago and we have been making a collective, unspoken decision not to discuss this. We have been at sea long enough that the old arguments feel like arguments someone else had, in a room we no longer live in. The gods feel far away. For the first time in my life, that does not frighten me.

It feels, if I am honest, like breathing.

Whatever is ahead — and something is ahead, the birds have been telling us so for three days now — we chose it. Every person on this vessel made a choice, whether the choice was made for them first or not. We are moving toward something rather than simply away. That is not nothing. After a life in a world that wanted us stationary, it is very nearly everything.

I do not know what we will find.

I know what we left, and I know why, and I know that the story the priests told about the people who came before us ended wrong — not in destruction, but in something the old gods had no word for.

We are going to find out what it was.

Year 1 — three days from the coast, or so the birds suggest.`;

function buildPrologueEntry(worldId: string, createdAt: string): ChronicleEntry & { id: string; order: number } {
  return {
    id: 'prologue',
    worldId,
    title: 'From the Record — First Page',
    subtitle:
      'Set down before landfall, in the hand of Rovan Halveth, aboard the vessel whose name we have stopped saying',
    body: PROLOGUE_BODY,
    fullPage: PROLOGUE_BODY,
    day: 0,
    year: 1,
    season: Season.Winter,
    threads: [],
    significantEvents: [],
    generatedAt: createdAt,
    createdAt,
    realDate: createdAt,
    isPrologue: true,
    order: 0,
  };
}

export async function ensurePrologueSeeded(state: WorldState): Promise<void> {
  if (!(await isChronicleCollectionEmpty(state.worldId))) {
    return;
  }

  const createdAt = new Date().toISOString();
  const prologue = buildPrologueEntry(state.worldId, createdAt);

  if (!state.chroniclePages.some((p) => p.id === 'prologue' || p.isPrologue)) {
    state.chroniclePages.unshift(prologue);
  }

  await writeChronicleDocument(state.worldId, prologue);

  console.log('Chronicle prologue written to Firestore.');
}

function nextChronicleOrder(state: WorldState): number {
  const orders = state.chroniclePages.map((p) => p.order ?? 0);
  return Math.max(0, ...orders) + 1;
}

function extractTextFromResponse(
  content: Anthropic.Message['content'],
): string {
  const firstBlock = content[0];
  return firstBlock !== undefined && firstBlock.type === 'text'
    ? firstBlock.text
    : 'The chronicle is silent today.';
}

// ============================================================
// TYPES
// ============================================================

export interface ChronicleResult {
  prose: string;
  day: number;
  threadCount: number;
  generatedAt: string;
}

function extractThreadProse(fullProse: string, familyName: string): string {
  const sections = fullProse.split('---');
  for (const section of sections) {
    if (section.includes(familyName)) {
      return section.trim();
    }
  }
  return fullProse;
}

// ============================================================
// GENERATION
// ============================================================

export async function generateChronicle(
  state: WorldState,
  apiKey: string,
): Promise<ChronicleResult> {
  const packages = packThreads(state);

  if (packages.length === 0) {
    return {
      prose: 'No threads are followed yet. The chronicle has not begun.',
      day: state.day,
      threadCount: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  // The most recent page before today — fed into the prompt so the writer can
  // see what it already wrote and avoid repeating its images, exchanges, and
  // closing moves (the chief flattening risk over a long-running chronicle).
  const priorPages = state.chroniclePages
    .filter((p) => (p.day ?? 0) < state.day)
    .sort((a, b) => (a.order ?? a.day ?? 0) - (b.order ?? b.day ?? 0));
  const previousPage =
    priorPages.length > 0 ? (priorPages[priorPages.length - 1]?.fullPage ?? null) : null;

  const prompt = buildChroniclePrompt(packages, state.vessel.beached, previousPage, packCameos(state));

  try {
    await ensurePrologueSeeded(state);

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: CHRONICLE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const draftProse = extractTextFromResponse(response.content);

    const revisionPrompt = `You wrote this chronicle page:

${draftProse}

You are now the editor. Your job is not to cut — it is to make this better to read.

Find the flat sentences and make them specific.
Find the general words and replace them with true details from the data.
Find the places where the prose explains what it should show.
Find the dialogue opportunities — moments where two people are together
and nothing is said but something should be.
Let the images do more work.

Do not add invented events. Do not change what happened.
Make what happened more vivid, more true to these specific people.

Return the full revised page. It may be the same length or longer —
better is the goal, not shorter.

One requirement: every thread section must end on a complete sentence.
The ending should feel like a door left open, not a sentence cut off.
A man still watching something. A question not yet answered. A decision
not yet made. End unresolved — a held breath — but on a complete sentence,
and not on someone merely walking toward something.`;

    const revisionResponse = await client.messages.create({
      model: CHRONICLE_MODEL,
      max_tokens: REVISION_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: revisionPrompt }],
    });

    const prose = extractTextFromResponse(revisionResponse.content);

    const result: ChronicleResult = {
      prose,
      day: state.day,
      threadCount: packages.length,
      generatedAt: new Date().toISOString(),
    };

    const generatedAt = new Date().toISOString();
    // Deterministic, one-per-day id. A regenerated day (e.g. a checkpoint replay
    // re-reaching this tick) overwrites the existing Firestore doc instead of
    // creating a fresh timestamped duplicate.
    const pageId = `day-${state.day}`;
    const order = nextChronicleOrder(state);

    const entry: ChronicleEntry & { id: string; order: number } = {
      id: pageId,
      worldId: state.worldId,
      day: state.day,
      realDate: generatedAt,
      season: state.season,
      year: state.year,
      threads: packages.map((p) => ({
        familyName: p.familyName,
        primaryAgentId: p.primaryAgent.id,
        prose: extractThreadProse(result.prose, p.familyName),
      })),
      fullPage: result.prose,
      significantEvents: packages.flatMap((p) =>
        p.primaryAgent.recentEvents.map((e) => e.tick.toString()),
      ),
      generatedAt,
      order,
    };

    // Upsert by id so a regenerated day replaces its prior page in memory (and in
    // the checkpoint's chroniclePages array) instead of appending a duplicate.
    state.chroniclePages = state.chroniclePages.filter((p) => p.id !== pageId);
    state.chroniclePages.push(entry);
    await writeChronicleDocument(state.worldId, entry);

    state.lastChronicleGeneratedAt = new Date().toISOString();
    state.lastChronicleDay = state.day;

    return result;
  } catch (error) {
    console.error('Chronicle generation failed:', error);
    return {
      prose: 'The chronicle is silent today.',
      day: state.day,
      threadCount: packages.length,
      generatedAt: new Date().toISOString(),
    };
  }
}

const CHRONICLE_DEV_INTERVAL_DAYS = 5;
const CHRONICLE_PROD_MIN_HOURS = 20;

export function shouldGenerateChronicle(state: WorldState, runMode: string): boolean {
  if (runMode === 'production') {
    if (state.lastChronicleGeneratedAt === null) {
      return state.tick > 0 && state.tick % TICKS_PER_DAY === 0;
    }
    const hoursSinceLast =
      (Date.now() - new Date(state.lastChronicleGeneratedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceLast >= CHRONICLE_PROD_MIN_HOURS;
  }

  // dev mode: fire every N simulated days
  return (
    state.tick > 0 &&
    state.tick % (TICKS_PER_DAY * CHRONICLE_DEV_INTERVAL_DAYS) === 0
  );
}
