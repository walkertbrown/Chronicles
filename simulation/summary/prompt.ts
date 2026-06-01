import type { SummaryPackage } from './packager.js';

export function buildSummaryPrompt(pkg: SummaryPackage): string {
  const deathLine = pkg.recentDeaths.length > 0
    ? `The dead: ${pkg.recentDeaths.join('; ')}.`
    : '';

  const conflictLine = pkg.recentConflicts.length > 0
    ? `Recent conflict: ${pkg.recentConflicts.join('; ')}.`
    : '';

  const agentLines = pkg.agentsToWatch.map((a) => {
    const driveNote = a.driveContext ? ` [${a.driveContext}]` : '';
    const threadNote = a.isThreaded ? ' [chronicle thread]' : '';
    const interactionNote = a.interactions.length > 0
      ? ` — alongside ${a.interactions.join(', ')}`
      : '';
    return `${a.name} (${a.role})${threadNote}: ${a.action}${interactionNote}${driveNote}`;
  }).join('\n');

  return `You are a bard recounting what is happening right now in a living world. Speak in present tense. Be vivid but brief — a storyteller at a fire, not a scribe at a desk. Do not invent events. Use only what the data gives you.

Length: 100–300 words depending on how much is happening. If it is a quiet hour, say so briefly and beautifully. If it is eventful, give it room.

Write flowing prose. No headers. No bullet points. No preamble like "Here is the update."

When an agent is listed alongside others, treat those others as named side characters — mention them by name, give them a line or two, let them exist in the scene. They are not props.

Weave any tension or unresolved conflict into the prose naturally. Do not call it out as a separate line.

---

It is ${pkg.season}, Year ${pkg.year}, Day ${pkg.day}. ${pkg.population} people remain.
${deathLine}
${conflictLine}

Who to watch:
${agentLines}

Tell it.`;
}

