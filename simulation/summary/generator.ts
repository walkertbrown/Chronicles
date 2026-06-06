import type { WorldState } from '@shared/types.js';
import { packSummary } from './packager.js';
import { buildSummaryPrompt } from './prompt.js';

const SUMMARY_PROD_MIN_HOURS = 1;
const SUMMARY_DEV_MIN_HOURS = 1;

// How many in-world ticks to let pass before the very first brief. Tick-based on
// purpose: the old gate keyed off state.lastCheckpoint, which is rewritten every
// checkpoint, so `now - lastCheckpoint` never exceeded its threshold on an
// always-on worker and a fresh world's first brief would never fire.
const SUMMARY_WARMUP_TICKS = 3;

export function shouldGenerateSummary(state: WorldState, runMode: string): boolean {
  if (state.lastSummaryGeneratedAt === null) {
    // First brief: fire once the world has taken a few steps. (A world restored
    // with no prior brief is already past this, so it fires on the next tick.)
    return state.tick >= SUMMARY_WARMUP_TICKS;
  }

  const minHours = runMode === 'production' ? SUMMARY_PROD_MIN_HOURS : SUMMARY_DEV_MIN_HOURS;
  const hoursSinceLast =
    (Date.now() - new Date(state.lastSummaryGeneratedAt).getTime()) / (1000 * 60 * 60);
  return hoursSinceLast >= minHours;
}

export async function generateSummary(
  state: WorldState,
  apiKey: string,
): Promise<string> {
  const pkg = packSummary(state);
  const prompt = buildSummaryPrompt(pkg);

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.7,
          // 2.5 Flash spends output budget on thinking unless capped at 0.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text =
    parts
      .filter((p) => p.text !== undefined && p.thought !== true)
      .map((p) => p.text)
      .join('')
      .trim() || 'The world is quiet.';

  if (candidate?.finishReason === 'MAX_TOKENS') {
    console.warn('Summary generation hit MAX_TOKENS; output may be truncated.');
  }

  state.latestSummary = {
    worldId: state.worldId,
    generatedAt: new Date().toISOString(),
    worldNow: text,
    agentsToWatch: pkg.agentsToWatch.map((a) => ({
      agentId: '',
      name: a.name,
      note: a.action,
    })),
    building: pkg.dominantTension,
  };

  state.lastSummaryGeneratedAt = new Date().toISOString();

  return text;
}
