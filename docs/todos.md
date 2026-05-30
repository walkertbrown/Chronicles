# Living World — Todo List
### Current as of Session 4

---

## What Is Built and Working

### Simulation Core (Complete)
- `shared/types.ts` — all types, interfaces, enums
- `simulation/world/` — generator, vessel, tiles, resources all complete
- `simulation/agents/` — drives, traits, relationships, actions, significance, illness, births, hunt, fish all complete
- `simulation/agents/drives.ts` — starvation: min 288 ticks, base 480, max 720; hunger depletion 0.001/tick; grief spike 0.04, radius 3, fade 0.001; fear threshold to beat hunger 0.85
- `simulation/world/vessel.ts` — landing threshold 0.55; all agents land at one coast tile
- `simulation/world/resources.ts` — coast food floor 0.05; spring bonus 1.3x; seasonal hunt/fish modifiers
- `simulation/events/log.ts` — death cause (starvation/illness/age/animal); animal attack system
- `simulation/tick.ts` — full tick loop
- `simulation/index.ts` — RUN_MODE=production; TARGET_TICKS Infinity; TICK_INTERVAL_MS 450000; chronicle re-enabled (non-blocking); summary non-blocking
- `simulation/chronicle/` — complete; nine craft principles + M.I.C.R.O.; three-way opening; non-blocking
- `simulation/summary/` — complete; Gemini 2.5 Flash; hourly production; non-blocking
- `simulation/server.ts` — HTTP on port 3001; /state /chronicle /health /deaths; CORS

### Web Frontend (Complete for Sample)
- `web/app/world/page.tsx` — SVG map; zoom/pan; vessel; agent dots on landing; click-to-inspect; chronicle thread highlights; companion diamond; roster panel with Living/Dead tabs; agent detail with drives/skills/traits; dead agent detail with cause/surviving family
- `web/app/chronicle/page.tsx` — fetches /chronicle; latest page full width; archive collapsed below; polls every 30s; empty state handled
- `web/lib/api.ts` — fetchWorldState, fetchChronicle, fetchDeaths
- `web/lib/types.ts` — frontend type mirrors including DeadAgentSnapshot
- `web/public/map.svg` — Azgaar export; physical map + watercolor style

### Design
- `docs/spec-v2.md` — v2.1; full Conduit/story design; Old Religion, the Unbound, ascension mechanic, dark bond, voting as gods all documented

### Environment
- `simulation/.env` — RUN_MODE=production, ANTHROPIC_API_KEY, GEMINI_API_KEY set

---

## Phase 2 — Firebase, Persistence, Cloud Run

This is the current phase. Goal: get the simulation off your Mac and running persistently in the cloud.

### 2.0 — Pre-Firebase Simulation Fixes
- [ ] **Dedicated death log** — add `deathLog: DeathRecord[]` to `WorldState` in `shared/types.ts`. Written at time of death, never truncated. `/deaths` endpoint reads from this instead of scanning `eventLog`. Prevents death causes being lost as event log rolls over.
- [ ] **Event log cap** — currently 500. Raise before long runs. Phase 3 concern.

### 2.1 — Firebase Setup
- [ ] Create Firebase project
- [ ] Enable Firestore, Realtime Database, Firebase Hosting
- [ ] Add `worldId` to all documents (already in types — just needs to flow through)
- [ ] Add Firebase Admin SDK to simulation, Firebase client SDK to web

### 2.2 — Checkpoint Writes (Firestore)
- [ ] Every 50 ticks write full world state to Firestore
- [ ] On startup: check Firestore for existing state, load and continue if found
- [ ] Chronicle pages written to Firestore on generation

### 2.3 — Realtime Database (Live View)
- [ ] Write agent positions and drives to Realtime Database every tick
- [ ] Frontend subscribes to Realtime Database instead of polling /state

### 2.4 — Cloud Run Deployment
- [ ] Dockerfile for simulation (Node.js, compiled dist, env vars from Secret Manager)
- [ ] Health check endpoint already exists (/health)
- [ ] Graceful shutdown — write checkpoint before exit
- [ ] Deploy to Cloud Run with min 1 instance (always running)
- [ ] All API keys in Google Secret Manager, not hardcoded

### 2.5 — Web Deployment
- [ ] Deploy web frontend to Vercel
- [ ] Point API calls at Cloud Run URL instead of localhost
- [ ] Environment variable for API base URL

---

## Deferred — Polish Before Public Launch

- [ ] **tileCoords full re-extraction** — 282 empty cells filled by nearest neighbor; increase scan density to 4px grid
- [ ] **Map zoom starts on landing area** — INITIAL_VIEWBOX should start zoomed on southern coast
- [ ] **Transition duration RUN_MODE-aware** — dev 180ms, prod 405000ms
- [ ] **Chronicle page empty state** — same message whether server is down or chronicle not yet started
- [ ] **Conduit system** — full implementation per spec-v2.1; bonding triggers, dark bond, artifact imprinting, significance multiplier

---

## Phase 3 — Observation Run

After Cloud Run stable. Let simulation run for two real weeks. Collect chronicle exemplars. Tune simulation parameters. Watch for:
- Death rate (lost 17/50 in 41 days last run — may still be too fast)
- Agent inland movement (were staying at coast y=27-29)
- Pair bond formation and birth system
- Chronicle quality — update prompt exemplars with best lines

---

## Longer Term

- [ ] Conduit system full implementation
- [ ] Voting mechanic
- [ ] Auth — Firebase, Apple Sign-In
- [ ] Mobile — Expo / React Native
- [ ] Search — Algolia
- [ ] Multi-world
- [ ] Old World simulation
- [ ] Fine-tuning pipeline
- [ ] Shelter, fire, hunting skill, crafting systems
- [ ] Artifact interaction and written fragments
- [ ] Thread handoff narration

---

## Key Design Decisions

- **Vessel beaches, stays permanently** — agents land at one coast tile together
- **Agents hidden at sea** — vessel icon only; dots appear on landing
- **30x30 grid = small landing zone** — full Azgaar map is the continent
- **Chronicle fires at landing** — non-blocking; ~8-15 real hours in production
- **Summary Gemini 2.5 Flash** — hourly; non-blocking
- **RUN_MODE=production** — 450 seconds/tick; ~1 sim week per real week
- **Conduits** — 75 fixed population, lemur-like with luminescence, not tracked unless bonded, bonding system designed in spec-v2.1
- **The Unbound** — ancient civilization that ascended; left Conduits as guardians; ascension device still on map
- **Audience = new gods** — voting mechanic is divine influence, not game mechanics

---

*Updated Session 4. Phase 2 is next: Firebase, persistence, Cloud Run.*
