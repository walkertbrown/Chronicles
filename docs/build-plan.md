# [WORKING TITLE] — Sample Build Plan
### Version 1.1

---

## Purpose

The sample exists to answer two questions before anything else is built:

1. Does the simulation produce interesting emergent behavior?
2. Does the chronicle read like mythology worth following?

Everything in this plan serves those two questions. Nothing else is built until they are answered.

---

## Sample Scope

- 50 agents
- 30x30 tile map, new world only
- Full trait system at correct fidelity
- Two initial chronicle threads, emerging from significance scoring
- One companion being type present in the world
- Ruin nodes and artifact locations on the map — not yet reachable
- Daily chronicle page generation against real simulation state
- Hourly world summary generation
- Simple web reading interface
- Simulation view with agent roster panel
- No auth, no voting, no mobile, no search, no multi-world

**The sample is not a throwaway prototype.** Architecture, data structures, and simulation engine are built to production specification. Only scope is reduced. The full product is built on top of this foundation without rewriting it.

---

## Repository Structure

```
/
├── simulation/
│   ├── world/
│   │   ├── generator.ts       # Map generation
│   │   ├── resources.ts       # Resource management
│   │   └── tiles.ts           # Tile definitions
│   ├── agents/
│   │   ├── initializer.ts     # Spawn founding fifty
│   │   ├── drives.ts          # Drive update logic
│   │   ├── traits.ts          # Trait change logic
│   │   ├── actions.ts         # What agents do each tick
│   │   ├── relationships.ts   # Relationship tracking
│   │   └── significance.ts    # Significance scoring
│   ├── companions/
│   │   └── being.ts           # Companion being logic
│   ├── events/
│   │   └── log.ts             # Significant event logging
│   ├── chronicle/
│   │   ├── packager.ts        # Thread state assembly
│   │   ├── prompt.ts          # Chronicle prompt builder
│   │   └── generator.ts       # Anthropic API call
│   ├── summary/
│   │   ├── packager.ts        # World state assembly for summary
│   │   ├── prompt.ts          # Summary prompt builder
│   │   └── generator.ts       # Gemini API call, runs hourly
│   ├── tick.ts                # Main tick loop
│   └── index.ts               # Entry point
│
├── web/                       # Next.js frontend
│   ├── app/
│   │   ├── page.tsx           # Chronicle reading page
│   │   └── world/page.tsx     # Simulation view page
│   └── components/
│       ├── ChronicleReader.tsx
│       ├── SimulationCanvas.tsx
│       ├── InspectPanel.tsx
│       └── AgentRoster.tsx
│
└── shared/
    └── types.ts               # Shared data structure definitions (start here)
```

---

## Phase 0 — Simulation Core
**Runs locally. No UI. No cloud.**

### 0.1 — World Generator

Produces a seeded 30x30 map. Same seed produces same map — essential during development.

Terrain rules:
- Coast tiles along one edge of the map
- One river running inland from coast (3-4 tiles wide, varies)
- Forest clusters in 3-4 areas
- Mountain range across one border — impassable
- Plains fill remaining space
- Ruin tiles cluster in the far interior (high ancientDensity)

Resource rules:
- River tiles have high water, moderate food
- Forest tiles have high food, low water
- Plain tiles have moderate food and water
- Mountain and ruin tiles have minimal resources
- Resources are never evenly distributed

Ancient density gradient:
- Lowest at the landing coast
- Highest at the far interior
- Companion being starts somewhere in the middle distance

### 0.2 — Agent Initializer

Spawns 50 founding agents near the coast where they landed.

**Trait baseline by founding role:**

| Role | Count | Trait Adjustments |
|---|---|---|
| Explorer | 12 | Curiosity +0.2, Courage +0.15, Fear -0.1 |
| Outcast | 28 | Fear +0.15, Grief +0.1, Aggression +0.1 |
| Leader | 2 | Nobility +0.2, Acuity +0.15, Social Need higher |
| Survivor | 8 | Endurance +0.2, Fear +0.2, Courage +0.1 |

All baselines have random variation ±0.15 applied after role adjustments. No two agents are identical. Traits are clamped 0.0 to 1.0.

Drives at spawn: hunger 0.3, fatigue 0.2, all others 0.1. They just arrived. They're tired and hungry but not desperate yet.

### 0.3 — Tick Logic

Runs in this order every tick:

**1. Drive updates**
Hunger and fatigue deplete passively. Fatigue depletes faster when hunger is above 0.5. Fear fades if no threat nearby. Social need depletes if agent alone for N ticks. Longing builds slowly always.

**2. Action determination**
Highest drive wins. Ties broken by trait profile. Action options per drive:

- **Hunger** → seek nearest food resource, harvest if adjacent
- **Fatigue** → move toward shelter or rest in place
- **Fear** → flee if threat present; if courage high enough, stand ground
- **Social need** → move toward nearest known agent; interact if adjacent
- **Grief** → wander; low curiosity agents stay near camp; high curiosity move further
- **Longing** → move toward bonded partner if one exists; otherwise toward highest-trust agent

**3. Action execution**
Agent performs determined action. Resources consumed. Position updated. Relationship scores updated on interaction. All action effectiveness is reduced by current fatigue level.

**4. Trait adjustments**
Small adjustments based on outcomes this tick. Most adjustments ±0.001 to ±0.005. Significant events cause larger adjustments up to ±0.02.

**5. Significant event detection**
Check for: death, birth, conflict, bond formation or break, trait threshold crossing, companion proximity change, artifact discovery.

**6. Significance scoring**
Recalculate for all agents:
```
score = (traitExtremity × 0.35)
      + (socialCentrality × 0.25)
      + (recentEventWeight × 0.25)
      + (behavioralDeviation × 0.15)
```

**7. Season and resource update**
Resources regenerate at seasonal rates. Winter may cause food resources to drop below zero — famine conditions.

**8. Checkpoint flag**
Every 50 ticks, flag for Firestore write. (Implemented in Phase 3.)

### 0.4 — Console Output

Print to console every 10 ticks:

```
=== DAY 4 | TICK 40 | SPRING ===
Population: 49 (1 death: hunger)
Top significance scores:
  Maren [Explorer] — 0.74 (curiosity 0.81, near companion twice)
  Cael [Leader] — 0.71 (conflict resolved, 12 relationships)
  Drev [Outcast] — 0.58 (grief 0.9, wandering far from camp)
Notable events:
  [T38] Maren moved further east than any other agent
  [T39] First death: unnamed outcast, hunger threshold
  [T40] Companion being approached within 8 tiles of Maren
```

**Done when:** Running 200 ticks produces console output that reads like something is happening. An unexpected agent rising in significance. A death that changes something. The companion being moving toward someone specific.

---

## Phase 1 — Simulation View
**Next.js page, local.**

### 1.1 — Canvas Renderer

30x30 grid rendered on an HTML canvas. Scale to fit viewport.

Tile rendering:
- Terrain type determines base tile color — muted, earthy palette
- Resource levels shown as subtle shade variation
- Ruin tiles have a distinct appearance
- River is clearly visible

Agent rendering:
- Small dot for each agent
- All agents visually identical by default — NO drive color coding
- Position updates every tick in real time

Companion being:
- Visually distinct from agents — different shape, not just size

### 1.2 — Chronicle-Linked Highlighting

After each daily page generates, agents mentioned in that page receive a visual distinction — slightly larger dot or distinct outline. Not color-coded by drive. Distinction resets when the next page generates. The highlight moves with the story.

### 1.3 — Click to Inspect Panel

Click any agent dot. Panel shows name, role, age, all drive values with bar indicators, all trait values with bar indicators, skills, relationships, and a one-sentence plain-language "right now" description generated from state — not an LLM call. A bookmark icon (☆) adds them to the Following roster.

### 1.4 — Agent Roster Panel

Sidebar panel. Two sections:

**Chronicled** — agents who have appeared by name in the chronicle. Listed by most recent mention. Click to center map on them. Empty at first — fills as the chronicle runs.

**Following** — agents the reader has personally bookmarked. Listed by time added. Click to center map on them. Stored in localStorage for the sample.

**Done when:** You can click a dot, read their state, bookmark them, find them again from the roster, and feel like you know something about this person.

---

## Phase 2 — Chronicle Generation
**Still local. Chronicle runs manually on demand.**

### 2.1 — Event Log

Every significant simulation event logged with type, narrative weight, thread relevance, and plain language description (facts only — no prose).

### 2.2 — Thread State Packager

For each active thread, assembles: current drives and traits, notable trait changes, significant events from the last day, relationships, location and surroundings, recent behavior pattern. Keeps it tight — only what changed.

### 2.3 — Chronicle Prompt

The most critical engineering decision in the sample. Write three versions. Test against the same state data. Read the outputs.

The prompt must establish:
- **Register**: ancient oral history, sparse, present tense, observational
- **Constraint**: translate only what happened — do not invent events
- **Format**: each thread gets its own titled section, length proportional to event density
- **Tone**: the chronicle does not explain motivations — it observes behavior

Draft prompt structure:

```
You are the chronicler of a new world.

A group of fifty people — outcasts and explorers — have recently
crossed into an unknown land. You record their lives in the style
of ancient oral history: sparse, present tense, observational.
You do not explain why people do things. You record what they do.

Write only what the state data tells you happened.
Do not invent events, relationships, or outcomes.
Do not use modern language or psychological framing.
Each entry should be 3-6 sentences unless nothing significant
happened, in which case 1-2 sentences is correct.

Today is Day [N]. It is [SEASON].

THREAD: [FAMILY NAME]
[Structured state object]

THREAD: [FAMILY NAME]
[Structured state object]

Write the day's page.
```

The right prompt produces prose that makes you want to know what happens tomorrow.

### 2.4 — Daily Page Assembler

Combines thread entries into a single formatted page. Orders threads by narrative weight.

### 2.5 — Reading Page

Simple Next.js page. Today's page full width, clean typography. Archive list below — newest first. No design polish in the sample. The words are the design.

**Done when:** You read a page and want to know what happens tomorrow.

### 2.6 — Hourly World Summary

Generated every real hour by Gemini Flash. ~$0.0002 per call. $0.14/month.

Three parts, 150 words total:

1. **The world right now** — 1-2 sentences on population, season, dominant tension
2. **Who to watch** — 2-3 agents with one plain sentence each (priority: Following list, then thread characters, then high significance scorers)
3. **What's building** — one sentence on unresolved tension or convergence

Sits above the chronicle on the reading page. On mobile becomes the push notification body.

Prompt:
```
You write a brief hourly update for a living world simulation.
Tone: immediate, observational, present tense. Not literary — clear and direct.
Do not invent events. Translate only what the state data shows.
Maximum 150 words total. Do not use headers.

WORLD STATE: [population, season, day, dominant drives across population]
SIGNIFICANT AGENTS: [top 3 by significance score]
RECENT EVENTS: [event log from last 60 real minutes]

Write the hourly brief.
```

Scheduler: Cloud Scheduler fires every real hour. Result written to Firestore at `worlds/{worldId}/summaries/latest`.

**Done when:** You read the first line and open the app.

---

## Phase 3 — Persistence and Deployment
**Cloud Run, Firestore, Firebase Realtime Database.**

### 3.1 — Firebase Setup

Create Firebase project. Enable: Firestore, Realtime Database, Firebase Hosting, Firebase Cloud Messaging (placeholder).

All Firestore documents include `worldId` field even though only one world exists.

### 3.2 — Checkpoint Writes

Every 50 ticks, write to Firestore: all agent states, world tile resource states, last 500 events, all chronicle entries, companion being state.

On startup: check Firestore for existing state. If found, load and continue. If not, generate fresh world.

### 3.3 — Realtime Database

Agent positions and drive states written every tick:
```
/worlds/{worldId}/agents/{agentId}/
  position: { x, y }
  alive: boolean
  chronicleThread: boolean
  lastMentionedDay: number
```

Frontend subscribes and receives live updates.

### 3.4 — Cloud Run Deployment

Persistent Node.js container, minimum one instance always running.

Requirements:
- Environment variables for Firebase credentials, Anthropic API key, Gemini API key
- Health check: GET /health returns `{ ticking: true, lastTick: number, worldDay: number }`
- Graceful shutdown: writes checkpoint before stopping
- Alert fires if world has not ticked in more than 5 minutes

### 3.5 — Chronicle and Summary Schedulers

**Chronicle**: triggers when a new simulated day begins. Retries up to 3 times on failure. On third failure, writes delay notice to Firestore and continues simulation.

**Summary**: Cloud Scheduler fires every real hour. Same retry pattern.

### 3.6 — Live Reading Page

Next.js pointed at live Firestore data. Chronicle pages appear automatically. Archive is full Firestore collection ordered by day.

**Done when:** Close your laptop. Come back the next morning. The world has continued without you. A new page is waiting.

---

## Phase 4 — Observation Run
**Two weeks minimum. No new features.**

### What to Watch

- Are drives producing varied behavior or do agents all do the same thing?
- Are traits actually changing through experience?
- Is significance scoring surfacing interesting agents or just proximity winners?
- Does the chronicle handle quiet days well or inflate small events?
- Is the companion being wandering meaningfully?
- Does winter actually change behavior?

### Tuning Levers

| Problem | Adjustment |
|---|---|
| Agents all doing the same thing | Reduce resource density so drives compete more |
| Traits not changing | Increase event-to-trait feedback multipliers |
| Deaths happening too fast | Reduce drive depletion rates |
| Nothing ever happens | Increase population density on small map |
| Chronicle prose feels flat | Revise prompt register instructions |
| Significance scoring wrong | Reweight scoring formula |
| Companion never approaches | Reduce companion fear baseline |

### Success Criteria

At the end of two weeks:

- **Did something happen that surprised you?** Surprise is the signal emergence is working.
- **Does the chronicle read like something worth following?** The feeling of wanting to know what happens tomorrow.
- **When you click a dot do you feel something about that agent?** Not just data. Something.

All three yes — build Phase 1 of the full product on this foundation.
Any answer no — identify what broke, fix it, run another week.

---

## Where to Start

`shared/types.ts` is already created. Every field defined. Read through it before writing any logic.

First code file: `simulation/world/generator.ts`

---

*Sample Build Plan v1.1 — Hourly world summary added. types.ts complete. Next: world generator.*
