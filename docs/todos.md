# Living World — Todo List
### Current as of Session 5

---

## What Is Built and Working

### Simulation Core (Complete)
- `shared/types.ts` — all types, interfaces, enums; TileCache interface and TileCacheData for serialization
- `simulation/world/tileCache.ts` — TileCacheImpl: sparse on-demand tile generation from seed, dirty tile tracking, serialize/deserialize for Firestore
- `simulation/world/generator.ts` — 3000x1500 world constants; generateWorld returns TileCacheImpl pre-warmed with starting zone
- `simulation/world/tiles.ts` — all utilities updated to TileCache; markTileDirty helper
- `simulation/world/resources.ts` — tickAllResources only processes dirty (visited) tiles
- `simulation/world/vessel.ts` — all tile accesses updated to TileCache
- `simulation/agents/` — drives, births, significance, illness, initializer, actions all updated; search radii scaled for larger world
- `simulation/companions/being.ts` — updated to TileCache
- `simulation/chronicle/packager.ts` — updated to TileCache
- `simulation/tick.ts` — updated to TileCache; computeAverageTileFood uses dirty tiles
- `simulation/server.ts` — serves only occupied tiles to frontend
- `simulation/firebase.ts` — checkpoint serializes only dirty tiles; loadCheckpoint deserializes back to TileCacheImpl
- `simulation/index.ts` — checkpoint load/resume on startup; SIGINT writes final checkpoint
- `simulation/chronicle/` — complete; nine craft principles + M.I.C.R.O.; three-way opening; non-blocking
- `simulation/summary/` — complete; Gemini 2.5 Flash; hourly production; non-blocking

### Web Frontend (Complete for Sample)
- `web/app/world/page.tsx` — SVG map; zoom/pan; vessel; agent dots; roster panel with Living/Dead tabs; agent detail with drives/skills/traits; dead agent detail with cause/surviving family
- `web/app/chronicle/page.tsx` — fetches /chronicle; latest page full width; archive collapsed; polls every 30s
- `web/lib/api.ts` — fetchWorldState, fetchChronicle, fetchDeaths
- `web/lib/types.ts` — frontend type mirrors including DeadAgentSnapshot
- `web/public/map.svg` — Azgaar export; physical map + watercolor style

### Infrastructure
- Firebase project: Chronicles (chronicles-14b34)
- Firestore: checkpoint writes every 50 ticks, resume on startup
- Realtime Database: live agent positions every tick
- Firebase Admin SDK installed in simulation
- Service account: firebase-service-account.json (gitignored)

### Design
- `docs/spec-v2.md` — v2.1; full Conduit/story design documented

### Environment
- `simulation/.env` — RUN_MODE=production, ANTHROPIC_API_KEY, GEMINI_API_KEY set

---

## Phase 2 — Cloud Run and Web Deployment

This is the current phase.

### 2.4 — Cloud Run Deployment
- [ ] Upgrade Firebase project to Blaze plan (required for Cloud Run)
- [ ] Install Google Cloud CLI (gcloud) on Mac
- [ ] Create Dockerfile for simulation
- [ ] Store all API keys in Google Secret Manager
- [ ] Deploy to Cloud Run with min 1 instance always running
- [ ] Graceful shutdown already implemented (SIGINT writes checkpoint)
- [ ] Health check endpoint already exists (/health)

### 2.5 — Web Deployment
- [ ] Deploy web frontend to Vercel
- [ ] Point API calls at Cloud Run URL instead of localhost
- [ ] Environment variable for API base URL

---

## Deferred — Polish Before Public Launch

- [ ] **tileCoords full re-extraction** — needs re-extraction for 3000x1500 grid mapped to SVG
- [ ] **Map zoom starts on landing area** — INITIAL_VIEWBOX should start zoomed on southern coast
- [ ] **Transition duration RUN_MODE-aware** — dev 180ms, prod 405000ms
- [ ] **Chronicle page empty state** — same message whether server is down or chronicle not yet started
- [ ] **Conduit system** — full implementation per spec-v2.1
- [ ] **Old Firestore checkpoint** — delete the old WorldTile[][] checkpoint from Firestore console before production run

---

## Phase 3 — Observation Run

After Cloud Run stable. Let simulation run for two real weeks. Watch for:
- Death rate (lost 17/50 in 41 days last run — may still be too fast)
- Agent inland movement
- Pair bond formation and birth system
- Chronicle quality

---

## Longer Term

- [ ] Conduit system full implementation
- [ ] Voting mechanic
- [ ] Auth — Firebase, Apple Sign-In
- [ ] Mobile — Expo / React Native
- [ ] Search — Algolia
- [ ] Multi-world
- [ ] Old World simulation
- [ ] Shelter, fire, crafting systems
- [ ] Artifact interaction and written fragments
- [ ] World map layer — inter-region travel when population expands
- [ ] Dedicated death log (deathLog: DeathRecord[] on WorldState)
- [ ] Event log cap — currently 500, raise before long runs

---

## Key Design Decisions

- **World grid: 3000x1500 tiles** — each tile ~500 feet; on-demand generation from seed; only visited/modified tiles in memory
- **Sparse TileCache** — unvisited tiles generated deterministically from seed, never stored; only dirty tiles saved to Firestore
- **Vessel beaches permanently** — agents land at one coast tile together
- **Chronicle fires at landing** — ~8-15 real hours in production
- **Summary Gemini 2.5 Flash** — hourly; non-blocking
- **RUN_MODE=production** — 450 seconds/tick
- **Conduits** — 75 fixed, lemur-like with luminescence, not tracked unless bonded
- **The Unbound** — ancient civilization that ascended; Conduits left as guardians
- **Audience = new gods** — voting mechanic is divine influence

---

*Updated Session 5. Phase 2 continues: Cloud Run and Vercel deployment next.*
