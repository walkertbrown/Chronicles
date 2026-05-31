// simulation/chronicle/prompt.ts
// Builds the prompt string sent to Claude. The register and constraints here
// are the most important decision in the project.

import type { ThreadPackage } from './packager.js';

// ============================================================
// FORMATTING HELPERS
// ============================================================

function formatList(items: string[]): string {
  if (items.length === 0) return 'none';
  if (items.length === 1) return items[0] ?? 'none';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')}, and ${last}`;
}

function formatTrust(trust: number): string {
  if (trust >= 0.5) return 'close companion';
  if (trust <= -0.3) return 'estranged, at odds';
  return 'known but not close';
}

function formatActiveDrivesAsProse(
  drives: ThreadPackage['primaryAgent']['activeDrives'],
): string {
  if (drives.length === 0) return 'steady, with no drive pressing hard';

  const labels = drives.map((d) => d.label);
  if (labels.length === 1) return labels[0] ?? 'restless';

  const last = labels.pop();
  return `${labels.join(', ')}, and ${last}`;
}

function formatTraitsAsProse(
  traits: ThreadPackage['primaryAgent']['notableTraits'],
): string {
  if (traits.length === 0) return 'no trait stands far above the rest';

  return traits
    .map((trait) => {
      if (trait.value >= 0.85) {
        return `${trait.name} that has become exceptional`;
      }
      if (trait.value >= 0.75) {
        return `${trait.name} that runs strong`;
      }
      return `${trait.name} that is still building`;
    })
    .join('; ');
}

function appendConditionNarratives(
  lines: string[],
  a: ThreadPackage['primaryAgent'],
): void {
  const narratives = [
    a.hungerNarrative,
    a.sicknessNarrative,
    a.healthNarrative,
  ].filter((n) => n.length > 0);

  for (const narrative of narratives) {
    lines.push(narrative);
  }
}

function buildUnresolved(pkg: ThreadPackage): string {
  const items: string[] = [];
  const a = pkg.primaryAgent;
  const ctx = pkg.worldContext;

  if (a.sicknessNarrative.length > 0) {
    items.push(`${a.fullName} remains ill — ${a.sicknessNarrative}`);
  }

  if (a.hungerNarrative.length > 0) {
    items.push(`${a.fullName}: ${a.hungerNarrative}`);
  }

  if (a.healthNarrative.length > 0) {
    items.push(`${a.fullName}: ${a.healthNarrative}`);
  }

  if (!a.alive) {
    items.push(`${a.fullName} is dead — the thread must reckon with what remains`);
  }

  for (const conflict of ctx.conflicts) {
    items.push(conflict);
  }

  for (const event of a.recentEvents) {
    if (event.weight >= 0.7) {
      items.push(event.description);
    }
  }

  for (const character of pkg.supportingCast) {
    if (character.isSick) {
      items.push(`${character.fullName} is sick and not recovered`);
    }
    if (character.isStarving) {
      items.push(`${character.fullName} is starving`);
    }
    if (!character.isAlive) {
      items.push(`${character.fullName} has died`);
    }
  }

  if (items.length === 0) {
    return 'nothing urgent presses — the day may be quiet, or the quiet may be waiting';
  }

  return items.join('; ');
}

function topTraitName(
  traits: Array<{ name: string; value: number }>,
): string {
  return traits[0]?.name ?? 'unknown';
}

function formatInteractionEntry(
  primary: ThreadPackage['primaryAgent'],
  character: ThreadPackage['supportingCast'][number],
): string {
  const lines: string[] = [];
  const context =
    character.recentSharedEvents.length > 0
      ? character.recentSharedEvents.join('; ')
      : character.recentActivity;

  lines.push(`  ${character.fullName}: ${context}`);

  const primaryTrait = topTraitName(primary.notableTraits);
  const supportingTrait = topTraitName(character.notableTraits);
  lines.push(
    `  Conversation between ${primary.fullName} (${primaryTrait}) and ${character.fullName} (${supportingTrait}): suggest what they might say to each other given their traits and trust.`,
  );

  return lines.join('\n');
}

function formatInteractionsSection(pkg: ThreadPackage): string[] {
  const lines: string[] = [];
  const relevant = pkg.supportingCast.filter(
    (character) =>
      character.trust > 0.2 || character.recentSharedEvents.length > 0,
  );

  if (relevant.length === 0) return lines;

  lines.push('');
  lines.push('Interactions today (people this person was near or spoke with):');
  for (const character of relevant) {
    lines.push(formatInteractionEntry(pkg.primaryAgent, character));
  }

  return lines;
}

function formatSupportingCharacter(character: ThreadPackage['supportingCast'][number]): string {
  const relationship = formatTrust(character.trust);
  let line = `  ${character.fullName} (${character.role}, ${relationship}): ${character.recentActivity}.`;

  if (character.recentSharedEvents.length > 0) {
    line += ` Shared history: ${character.recentSharedEvents.join('; ')}.`;
  }

  return line;
}

function formatThreadBlock(pkg: ThreadPackage, hasLanded: boolean): string {
  const a = pkg.primaryAgent;
  const lines: string[] = [];

  lines.push(`THREAD: ${pkg.familyName}`);

  const isFirstEntry = pkg.previousDayProse.trim().length === 0;

  if (isFirstEntry && hasLanded) {
    lines.push(`OPENING ENTRY — the vessel has just beached. This is the first page of the chronicle.`);
    lines.push(`There is no previous page. You are opening the book.`);
    lines.push('');
    lines.push(`Write the arrival. Not the crossing as backstory — the crossing as weight that these people are still carrying. The cold of the water still in the hands. The shore under the feet for the first time. The ones who did not make it across. What the land looks like to people who have not seen land in weeks. What it feels like to stop moving after moving for so long.`);
    lines.push(`Then move into the first days ashore. The hunger is already real. The cold is winter. The land gives nothing. But they have arrived. That fact is large enough to open a book on.`);
    lines.push(`Begin at the moment of beaching and move forward through the first days. This is the chapter the whole story grows from.`);
    lines.push('');
  } else if (isFirstEntry && !hasLanded) {
    lines.push(`OPENING ENTRY — the vessel is still at sea. This is the chronicle's first page.`);
    lines.push(`There is no previous page. You are opening the book.`);
    lines.push('');
    lines.push(`Write the crossing. These people are at sea on a damaged vessel, hungry and afraid. Some have nearly died. They have not yet seen the coast they are moving toward. Write what it is to be on this water, on this ship, with these people, not knowing what comes next. Begin here and move forward through what happens.`);
    lines.push('');
  } else {
    lines.push(`The previous page ended here:`);
    lines.push(`"${pkg.previousDayProse}"`);
    lines.push('');
    lines.push(`What has happened since then (this may span several days):`);
  }
  lines.push(`${a.fullName}, ${a.role}, age ${a.age}. ${a.gender}.`);

  if (!a.alive) {
    lines.push('Dead.');
  } else {
    lines.push(`Currently: ${formatActiveDrivesAsProse(a.activeDrives)}.`);

    appendConditionNarratives(lines, a);

    lines.push(`Notable traits: ${formatTraitsAsProse(a.notableTraits)}.`);

    if (a.recentTraitCrossings.length > 0) {
      lines.push(a.recentTraitCrossings.join('; '));
    }

    lines.push(`Location: ${a.currentLocation}. Surroundings: ${a.surroundingTerrain}.`);
    lines.push(`${a.nearbyAgentCount} others nearby.`);
  }

  if (a.recentEvents.length > 0) {
    lines.push('');
    lines.push('Recent events (most significant first):');
    for (const event of a.recentEvents) {
      lines.push(event.description);
    }
  }

  lines.push(...formatInteractionsSection(pkg));

  if (pkg.supportingCast.length > 0) {
    lines.push('');
    lines.push("People in this person's world today:");
    for (const character of pkg.supportingCast) {
      lines.push(formatSupportingCharacter(character));
    }
  }

  if (a.companionProximityNarrative.length > 0) {
    lines.push(a.companionProximityNarrative);
  }

  if (a.conduitEvents.length > 0) {
    lines.push('');
    lines.push('Conduit events (background color and bond moments):');
    for (const event of a.conduitEvents) {
      lines.push(event.description);
    }
  }

  if (a.companionBonded) {
    if (a.conduitBondType === 'dark') {
      lines.push('A Conduit has bonded to this person — something in the bond feels wrong, changed.');
    } else {
      lines.push('A Conduit has bonded to this person.');
    }
  }

  lines.push('');
  lines.push(`What is unresolved: ${buildUnresolved(pkg)}`);

  return lines.join('\n');
}

function formatWorldHeader(packages: ThreadPackage[]): string {
  const first = packages[0];
  if (first === undefined) return '';

  const ctx = first.worldContext;
  const lines: string[] = [];

  if (ctx.season === 'winter') {
    lines.push(`Today is Day ${ctx.day}. It is winter. Year ${ctx.year}. The land gives nothing in this season.`);
  } else if (ctx.season === 'spring') {
    lines.push(`Today is Day ${ctx.day}. It is spring. Year ${ctx.year}. The land is beginning to open.`);
  } else if (ctx.season === 'summer') {
    lines.push(`Today is Day ${ctx.day}. It is summer. Year ${ctx.year}.`);
  } else {
    lines.push(`Today is Day ${ctx.day}. It is ${ctx.season}. Year ${ctx.year}. The season is turning.`);
  }
  if (ctx.deadSinceYesterday.length > 0) {
    lines.push(
      `${ctx.alivePopulation} people remain. ${ctx.deadSinceYesterday.length} have died since yesterday: ${formatList(ctx.deadSinceYesterday)}.`,
    );
  } else {
    lines.push(`${ctx.alivePopulation} people remain.`);
  }

  if (ctx.newlyIll.length > 0 || ctx.recovered.length > 0) {
    const illPart =
      ctx.newlyIll.length > 0
        ? `${formatList(ctx.newlyIll)} are sick.`
        : '';
    const recoveredPart =
      ctx.recovered.length > 0
        ? `${formatList(ctx.recovered)} have recovered.`
        : '';
    lines.push(`${illPart} ${recoveredPart}`.trim());
  }

  if (ctx.conflicts.length > 0) {
    lines.push(ctx.conflicts.join('; '));
  }

  if (ctx.groupLocation.length > 0) {
    lines.push(ctx.groupLocation);
  }

  return lines.join('\n');
}

// ============================================================
// CHRONICLE PROMPT
// ============================================================

export function buildChroniclePrompt(packages: ThreadPackage[], hasLanded: boolean): string {
  if (packages.length === 0) {
    return 'No chronicle threads are active. Write nothing.';
  }

  const threadBlocks = packages.map((pkg) => formatThreadBlock(pkg, hasLanded)).join('\n\n---\n\n');

  return `You are writing the chronicle of a new world — a fantasy novel that happens to be true.

The register: the tradition of ancient oral history set down in writing.
Present tense. Third person. Concrete and spare, but not cold.
This is not a report. This is not a summary. This is a book.

The writer: imagine a fantasy novelist — someone who has read Ursula Le Guin,
Guy Gavriel Kay, Robin Hobb. Someone who knows that a single true detail
does more than three invented flourishes. Someone who writes hunger as
the way a man holds his hands, not as a statement about hunger.

One: The prose earns elevation. Start each entry in plain language — a man's hands, the cold, the silence. Rise to a higher register only when something crosses into the mythic or final. Do not begin elevated. Begin true.

Two: Action reveals character. Do not name a trait and then describe it. Write only the action that is the trait. A person with high nobility does not get described as noble — they get the thing they do that only a noble person would do. The reader names it.

Three: The chronicle does not judge. It records. It does not advocate for any person or explain why they are worth following. Facts accumulate. The reader comes to care because the facts accumulate, not because the prose says to care.

Four: Return to what is true. Once the prose has established a real thing about a person — a habit, a way of standing, a recurring choice — it may return to that thing the way an oral tradition returns to an epithet. Not invented. Only what the data has already confirmed. This is how a person becomes known across many pages.

Five: Concrete before abstract. Never state a quality — ground it first in something seen. Not "his endurance is exceptional" but the image that is the endurance. The abstraction, if it appears at all, comes after the image that earns it.

Six: Name without explaining. A tool, a place, a dead person can be named and left to resonate. The chronicle does not unpack everything it mentions. The unexplained makes the world feel larger than the page.

Seven: Register shifts by thread. An outcast's entry is harder and colder — shorter sentences, blunter words, what the body notices. A leader's entry has more weight to it, more awareness of others. The shift is subtle — word choice, sentence length, what gets noticed — not a wholesale change of voice. The chronicler's voice is constant; what changes is whose world is being rendered.

Eight: Sensory grounding. The world arrives through the body. Cold that settles in the joints. The smell of the shore. The taste of what little there is. The chronicle observes from outside but renders the physical world as a body experiences it. This is not interior monologue — it is precise external observation.

Nine: Earn the long sentence. Write mostly short and plain. But when a moment carries weight — a death, a decision held too long, the first sight of something that will matter — let the sentence lengthen and find its rhythm. The long sentence is a reward for what came before it. Use it once, not three times.

The constraint: you may not invent events, relationships, or outcomes
the data does not support. But you may render what the data implies.
You may write dialogue that is consistent with who these people are. When two people interact, they may speak. Follow this framework for every line of dialogue: the speaker wants something — every line is driven by that want, not by what the chronicle needs to convey. Each voice is distinct enough that you should know who is speaking without a tag. There is tension underneath every exchange, even between people who agree. The speech sounds like a real person in this world, not like exposition. The scene goes somewhere — something shifts by the end of the exchange, even slightly. A frightened person speaks differently than a courageous one. A grieving person does not joke. You are not inventing — you are completing what the data began.

If a data field is empty or zero, do not render it.
Empty means it did not happen or does not apply.
Silence in the data is silence in the chronicle.

Length: 200-300 words per thread. A full scene, not a caption.
Every thread entry should feel like a chapter in a novel that has been
running for a long time and will run longer still.
The full page should run 400-600 words total across all threads.

Quiet days: when nothing significant happened, write the most ordinary
true thing with care. A man at a fire. Two people in silence. The cold
that has not lifted. The quiet days are not lesser days — they are the
texture the loud days need. Write them as well as the eventful ones,
only shorter.

Continuity: this is a serial story. Each page is a chapter. The previous page is given to you — begin by closing what it left open, even slightly, before moving into new ground. If the last page ended on hunger, open in hunger's continuation or its resolution. If it ended on a person moving toward something, show where they arrived.

Each page covers everything that happened since the last one — not just the most recent moment. If several days passed, the page should have the texture of several days: what built slowly, what happened suddenly, what did not happen at all and what that silence meant.

End each page in motion. Not a conclusion — an opening. Something unresolved, something approaching, something that will require another page to answer. The reader should feel the story continuing past the edge of what is written.

Every thread section ends on a complete sentence. The last sentence should
feel like a held breath, not a broken one. The story continues — but the
page is finished.

The first page is different. It opens the book. It establishes the world without explaining it. The crossing happened — render its weight in what the people carry now, not in summary. Begin at the moment of arrival and move forward.

Supporting cast: the people around the thread character are characters too.
Name them. Return to them. Let them speak. Let them act.
When someone dies, name them and feel the absence.
When someone new appears in the data, introduce them as a novelist would —
one true detail that makes them real.

Conduit beings: when Conduit sighting events appear in the data, render them as
background color — luminous creatures at the edge of vision, watched from tree
cover, present at dusk. Do not name them individually unless a bond has formed.
When a Conduit bond event appears (light or dark), treat it as a major narrative
moment with full weight. A light bond is wonder and recognition — something
sacred arriving quietly. A dark bond shifts the register: something is wrong,
something has changed; the prose should feel it before the chronicle names it.
A broken bond is grief — name what was lost.

This is what the chronicle sounds like when it is working:

---
Mors set the snare before first light and came back to it at midday. It was empty. He stood over it the way a man stands over something he no longer believes in, then reset it anyway and walked back to camp without looking at the others.

Wren was feeding the fire when he returned. She did not ask. He did not say. The fire was small because the wood was wet and neither of them had the will to go further for dry wood. They sat beside it anyway.

Later, when the light was going, Aldric came in from the east with nothing either. The three of them ate what little there was and did not speak of the snare or the cold or the days since the landing. Some things do not need naming to be known.
---

Match this. Not the subject matter — the density, the restraint,
the willingness to let dialogue carry weight without explaining it.
A sentence that ends on a fact. A detail that does the work of a paragraph.

${formatWorldHeader(packages)}

---

${threadBlocks}

---

Write today's page. One titled section per thread.
Title each section with the family name only — no date, no decorative header.
Begin immediately. No preamble.
The page should read as one continuous piece of writing interrupted only by the thread titles.
A reader who has followed from the beginning should feel the story continuing.
A reader joining today should be able to follow.
Both are true at once.`;
}

// ============================================================
// SUMMARY PROMPT
// ============================================================

export function buildSummaryPrompt(
  packages: ThreadPackage[],
  worldContext: { day: number; season: string; population: number },
): string {
  const agentLines = packages
    .map((pkg) => {
      const a = pkg.primaryAgent;
      const notes: string[] = [];
      if (a.isSick) notes.push('ill');
      if (a.isStarving) notes.push('starving');
      const noteStr = notes.length > 0 ? ` (${notes.join(', ')})` : '';
      return `${a.fullName}, ${a.role}${noteStr}`;
    })
    .join('\n');

  const first = packages[0];
  const deaths = first?.worldContext.deadSinceYesterday ?? [];
  const conflicts = first?.worldContext.conflicts ?? [];

  let worldNotes = '';
  if (deaths.length > 0) {
    worldNotes += `Deaths: ${formatList(deaths)}. `;
  }
  if (conflicts.length > 0) {
    worldNotes += `Conflicts: ${conflicts.join('; ')}.`;
  }

  return `Write a brief account of the world right now.

Register: present tense, immediate, observational. Not mythic — current.
You do not explain motives. You do not invent. Use only what the data supports.

Strict limit: 150 words. No headings. No preamble. Plain prose.

Day ${worldContext.day}. It is ${worldContext.season}. ${worldContext.population} people remain.
${worldNotes.trim()}

People of note:
${agentLines || 'No active threads.'}

Write the account now.`;
}
