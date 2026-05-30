import type { SummaryPackage } from './packager.js';

export function buildSummaryPrompt(pkg: SummaryPackage): string {
  const deathLine = pkg.recentDeaths.length > 0
    ? `Recent deaths: ${pkg.recentDeaths.join('; ')}.`
    : '';

  const conflictLine = pkg.recentConflicts.length > 0
    ? `Recent conflicts: ${pkg.recentConflicts.join('; ')}.`
    : '';

  const agentLines = pkg.agentsToWatch
    .map((a) => `${a.name} (${a.role}): ${a.state}`)
    .join('\n');

  return `Write a brief hourly update for a living world simulation.

Tone: present tense, immediate, observational. Not literary — clear and direct.
Do not invent events. Use only what the data shows.
Hard limit: 150 words. No headers. No preamble. Plain prose.
Three parts: the world right now (1-2 sentences), who to watch (one sentence per person), what is building (one sentence on unresolved tension).

Day ${pkg.day}. It is ${pkg.season}. Year ${pkg.year}. ${pkg.population} people remain.
${deathLine}
${conflictLine}
Dominant tension: ${pkg.dominantTension}.

People of note:
${agentLines}

Write the hourly brief now.`;
}
