// simulation/chronicle/generator.ts
// Makes the Anthropic API call and returns the chronicle prose.

import Anthropic from '@anthropic-ai/sdk';
import type { WorldState } from '@shared/types.js';
import { TICKS_PER_DAY } from '../agents/drives.js';
import { packThreads } from './packager.js';
import { buildChroniclePrompt } from './prompt.js';

// ============================================================
// CONSTANTS
// ============================================================

const CHRONICLE_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const REVISION_MAX_TOKENS = 1500;
const SYSTEM_PROMPT =
  'You are the voice of an ancient chronicle. Write only what the data tells you. Do not invent.';

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

  const prompt = buildChroniclePrompt(packages, state.vessel.beached);

  try {
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
not yet made. End in motion — but end.`;

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

    state.chroniclePages.push({
      worldId: state.worldId,
      day: state.day,
      realDate: new Date().toISOString(),
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
      generatedAt: new Date().toISOString(),
    });

    state.lastChronicleGeneratedAt = new Date().toISOString();

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
