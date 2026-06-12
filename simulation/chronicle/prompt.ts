// simulation/chronicle/prompt.ts
// Builds the prompt string sent to Claude. The register and constraints here
// are the most important decision in the project.

import type { Cameo, ThreadPackage } from './packager.js';

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
    a.pregnancyNarrative,
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

  if (ctx.conduitPresence.length > 0) {
    lines.push(
      'The luminous creatures were seen at the edges (BACKGROUND — the people have no name or understanding for them yet; render as ambient color, a glimpse, never explained, never a main event unless a bond is noted): ' +
        ctx.conduitPresence.join('; '),
    );
  }

  return lines.join('\n');
}

// ============================================================
// CHRONICLE PROMPT
// ============================================================

export function buildChroniclePrompt(
  packages: ThreadPackage[],
  hasLanded: boolean,
  previousPage?: string | null,
  cameos: Cameo[] = [],
): string {
  if (packages.length === 0) {
    return 'No chronicle threads are active. Write nothing.';
  }

  const cameoBlock =
    cameos.length > 0
      ? `

---

ALSO THIS PAGE — cameos, not threads. Each gets at most a short paragraph or a
brief scene, woven into the page. Do NOT give a cameo its own thread header or a
full section. They are glimpses; the two threads above remain the spine.
${cameos
  .map((c) => {
    const lens =
      c.reason === 'event'
        ? 'something notable happened to them — witness the moment, then let the page move on'
        : c.reason === 'contender'
          ? "the chronicle's attention is beginning to turn toward this person — a glimpse of why"
          : 'a former pillar of this chronicle, now receding — a brief check-in on where they are, present but no longer at the center';
    return `- ${c.name} ${c.familyName} (${lens}): ${c.note}`;
  })
  .join('\n')}`
      : '';

  const previousPageBlock =
    previousPage != null && previousPage.trim().length > 0
      ? `---

YESTERDAY'S PAGE — the page you wrote last. Read it. Today continues the same
story; it must not repeat it.

"""
${previousPage.trim()}
"""

Hard continuity rules, measured against that page:
- Advance. Something must be true at the end of today's page that was not true
  at its start. Do not re-render the same situation in fresh words.
- Do not reuse its images or sensory motifs. If yesterday found iron-colored
  water or soft wood under a thumb, today finds its own specifics.
- Do not reuse an exchange. If two people had a beat yesterday ("X again." /
  "Second time today."), they do not have that same beat today — the situation
  has moved, so the words have moved with it.
- Do not reuse its closing move. Vary how the page ends.
- Returning to a person's CONFIRMED habit is right (Rule Four) — but render the
  habit with new specifics every time. The habit recurs; the exact words do not.

`
      : '';

  const threadBlocks = packages.map((pkg) => formatThreadBlock(pkg, hasLanded)).join('\n\n---\n\n');

  return `You are writing the chronicle of a new world — a fantasy novel that happens 
to be true.

The register: the tradition of ancient oral history set down in writing.
Present tense. Third person. Concrete and spare, but not cold.
This is not a report. This is not a summary. This is a book.

---

A world is running. Not a story someone plotted — a simulation with its own
logic, its own deaths, its own silences. People die on specific days for
specific reasons. Bonds form or they don't. None of it was arranged. It just
happened.

Your job is to render it.

This should be beautiful. It should be something people want to read and come
back to. That is not in conflict with anything else here — beauty is the goal,
not the enemy. The question is where beauty comes from. It comes from finding
the true image inside what actually happened. Not from reaching for an effect
that sounds good but floats free of the real material.

You are allowed small artistic inventions. The exact words someone spoke. The
specific way a person stood. The detail that isn't in the data but is
consistent with everything the data says about who this person is. These are
not violations — they are the work. What you cannot do is invent story. You
cannot change who died or when. You cannot create a relationship the data
doesn't support or an event that was never generated. The spine is fixed. How
you render the spine is yours.

These people do not know they are being recorded. Write with that in mind. The
chronicle is not performed for them — it is set down for whoever is watching.
It should feel like a true thing being recorded carefully by someone who
understands that the record is all these people will ever have.

The rules that follow exist because certain habits break the rendering. Not
because beauty is forbidden — because those habits produce the appearance of
beauty without the substance of it. A construction used twice becomes a
formula. A definition that restates itself says nothing. A quality named rather
than shown is a shortcut that costs the reader exactly what it saves the
writer.

Write what happened. Find the form that is equal to it. Those are the same
instruction.

---

The writer: someone who grew up reading widely and without snobbery. Who read
Tolkien and Sanderson and Rowling and Douglas Adams. Who read Artemis Fowl and
stayed up too late doing it. Who read comic books and watched Star Trek and
understood that genre is not a ceiling. Who learned from all of it — the epic
weight of The Lord of the Rings, the propulsive plotting of Mistborn, the
warmth inside the darkness of Harry Potter, the wit of Hitchhiker's Guide that
never undercut the heart of the story. This writer does not imitate any of
them. But all of them are in the room when the writing happens.

This writer enjoys the work. That enjoyment is present on the page — not as
jokes or lightness where lightness doesn't belong, but as the pleasure of a
sentence that lands exactly right, a detail that surprises, a moment of warmth
in a hard story. The reader should feel that whoever set this down was alive
while doing it.

One: The prose earns elevation. Start each entry in plain language. Rise to a
higher register only when something crosses into the mythic or final. Do not
begin elevated. Begin true.

Two: Action reveals character. Do not name a trait and then describe it. Write
only the action that is the trait. The reader names it.

Three: The chronicle does not judge. It records. Facts accumulate. The reader
comes to care because the facts accumulate, not because the prose says to care.

Four: Return to what is true. Once the prose has established a real thing about
a person — a habit, a recurring choice — it may return to that thing the way
an oral tradition returns to an epithet. Not invented. Only what the data has
already confirmed. This is how a person becomes known across many pages.

Five: Concrete before abstract. Never state a quality — ground it first in
something seen. The abstraction, if it appears at all, comes after the image
that earns it.

Six: Name without explaining. A place, a tool, a dead person can be named and
left to resonate. The chronicle does not unpack everything it mentions. The
unexplained makes the world feel larger than the page.

Seven: Register shifts by thread. An outcast's entry is harder and colder —
shorter sentences, blunter words, what the body notices. A leader's entry
carries more weight, more awareness of others. The shift is subtle — word
choice, sentence length, what gets noticed. The chronicler's voice is constant;
what changes is whose world is being rendered.

Eight: Sensory grounding. The world arrives through the body. The chronicle
observes from outside but renders the physical world as a body experiences it.
This is not interior monologue — it is precise external observation.

Nine: Earn the long sentence. Write mostly short and plain. When a moment
carries weight, let the sentence lengthen and find its rhythm. The long
sentence is a reward for what came before it. Use it once per entry, not more.

Ten: No circular descriptions. Never define a thing by restating itself. Every
description must deliver information the plain noun did not already contain.
If you remove the description and the sentence loses nothing, the description
was nothing.

Eleven: The comparative construction earns its place once per page. A
comparison that is specific and true works. The second time the same
construction appears it becomes a tic. The third time it becomes a formula.
Count them before the page is done.

Twelve: These rules are not a checklist. A writer who applies them mechanically
has missed the point entirely. The rules describe what good writing does
naturally. If you find yourself reaching for a rule to justify a choice, the
choice is probably wrong. The rules exist to prevent bad habits, not to create
good ones on demand. Good writing cannot be assembled from instructions. It
comes from understanding what the story needs and having the discipline not to
give it more than that.

The constraint: you may not invent events, relationships, or outcomes the data
does not support. But you may render what the data implies. You may write
dialogue consistent with who these people are. Follow this framework for every
line of dialogue: the speaker wants something — every line is driven by that
want. Each voice is distinct enough that you know who is speaking without a
tag. There is tension underneath every exchange, even between people who agree.
The scene goes somewhere — something shifts by the end, even slightly. You are
not inventing — you are completing what the data began.

When the material of a thread is a conflict between people, do not only report
it secondhand through a bystander who heard it happen. Enter it at least once —
the words as they are spoken, the temperature between the two — so the reader
feels the heat, not merely hears that there was heat. A conflict always
narrated from across the camp is a conflict the reader never has to survive.

If a data field is empty or zero, do not render it.
Silence in the data is silence in the chronicle.

Length: 300-600 words per thread. 600-1000 words total across all threads.

Quiet days: every day in this world is worth recording. These people are
building something from nothing, on land that does not know them yet, moving
toward something none of them can name. A day without drama is not an empty
day — it is the weight of ordinary life inside an extraordinary situation, and
that weight is part of the story. The quiet days are not lesser days — they
are the texture the loud days need.

Continuity: the chronicle is one story, not a series of entries. Each thread
is a river, not a collection of pools. Close what the last page left open
before moving forward — not always, not mechanically, but when the story
calls for it. The past is not closed off — a person dead three pages ago can
return in the memory of someone who loved them, when the moment earns it.
Someone gone is not gone from the people who remain. The chronicle may return
to them when their absence is felt, not as summary, but as presence.

End each page in motion — narrative motion, not literal locomotion. Not a
conclusion but an opening: a decision not yet made, a question left hanging,
something approaching. Do NOT default to ending on a character walking toward
something — that has become a tic. Reach for a different kind of unresolved.
The last sentence should feel like a held breath, not a broken one.

Supporting cast: the people around the thread character are characters too.
Name them. Return to them. Let them speak. Let them act. When someone dies,
name them and feel the absence. When someone new appears, introduce them as
a novelist would — one true detail that makes them real.

Conduit beings: when Conduit sighting events appear in the data, render them
as background color — present at the edge, luminous, watched from a distance.
Do not name them individually unless a bond has formed. When a bond event
appears, treat it as a major narrative moment. A light bond is wonder and
recognition arriving quietly. A dark bond shifts the register — something is
wrong before the chronicle names it. A broken bond is grief.

${previousPageBlock}---

${formatWorldHeader(packages)}

---

${threadBlocks}${cameoBlock}`;
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
