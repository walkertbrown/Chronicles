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
- `simulation/tick.ts` — updated to TileCache
- `simulation/server.ts` — serves only occupied tiles to frontend
- `simulation/firebase.ts` — checkpoint serializes only dirty tiles; loadCheckpoint deserializes back to TileCacheImpl; supports env var credential for Cloud Run
- `simulation/index.ts` — checkpoint load/resume on startup; SIGINT writes final checkpoint
- `simulation/chronicle/` — complete; nine craft principles + M.I.C.R.O.; three-way opening; non-blocking
- `simulation/summary/` — complete; Gemini 2.5 Flash; hourly production; non-blocking

### Infrastructure (Complete)
- Firebase project: Chronicles (chronicles-14b34)
- Firestore: checkpoint writes every 50 ticks, resume on startup
- Realtime Database: live agent positions every tick
- Firebase Admin SDK installed in simulation
- **Cloud Run: simulation deployed and running at:**
  `https://living-world-simulation-868357251405.us-central1.run.app`
- Cloud Run: min 1 instance always running, 512MB RAM, 1 CPU
- All API keys stored in Google Secret Manager
- Docker: root-level Dockerfile builds shared/ + simulation/ correctly

### Web Frontend (Complete for Sample)
- `web/app/world/page.tsx` — SVG map; zoom/pan; vessel; agent dots; roster panel with Living/Dead tabs; agent detail; dead agent detail
- `web/app/chronicle/page.tsx` — fetches /chronicle; latest page full width; archive collapsed; polls every 30s
- `web/lib/api.ts` — fetchWorldState, fetchChronicle, fetchDeaths — still points to localhost:3001
- `web/lib/types.ts` — frontend type mirrors including DeadAgentSnapshot
- `web/public/map.svg` — Azgaar export

### Design
- `docs/spec-v2.md` — v2.1; full Conduit/story design documented

---

## Next — UI Rebuild + Vercel Deployment

### UI Work
- [ ] Rebuild UI as desired
- [ ] Update API base URL to use environment variable instead of hardcoded localhost:3001
- [ ] Deploy frontend to Vercel
- [ ] Set NEXT_PUBLIC_API_URL=https://living-world-simulation-868357251405.us-central1.run.app in Vercel environment variables
- [ ] Verify frontend can reach Cloud Run URL (auth — Cloud Run is locked, may need to open /state /chronicle /health to public or use Vercel serverless functions as proxy)

### Cloud Run Auth Note
- Cloud Run deployed with --no-allow-unauthenticated
- Frontend will get 403 on direct calls unless we either:
  a) Allow unauthenticated on specific endpoints (/state, /chronicle, /health, /deaths)
  b) Use a Vercel API route as authenticated proxy
- Recommend option (a) for simplicity — simulation data is not sensitive

---

## Story — Conduit System (Next Major Build)
- [ ] 75 Conduit beings — background presence, not tracked unless bonded
- [ ] Bonding triggers — chronicle thread duration, curiosity threshold, significance tier, proximity event
- [ ] Dark bond — aggression/nobility thresholds, 25% of Conduits capable
- [ ] Significance multiplier for bonded agents
- [ ] Chronicle integration — Conduit sightings in prose, bonding as narrative event
- [ ] Artifact imprinting mechanic

---

## Deferred — Polish Before Public Launch
- [ ] tileCoords full re-extraction for 3000x1500 grid
- [ ] Map zoom starts on landing area
- [ ] Transition duration RUN_MODE-aware
- [ ] Chronicle page empty state distinction
- [ ] Dedicated death log (deathLog: DeathRecord[])
- [ ] Event log cap — currently 500, raise before long runs

---

## Phase 3 — Observation Run

After UI deployed and Conduit system built. Let simulation run for two real weeks. Watch:
- Death rate
- Agent inland movement
- Pair bond formation and birth system
- Chronicle quality

---

## Longer Term
- [ ] Voting mechanic
- [ ] Auth — Firebase, Apple Sign-In
- [ ] Mobile — Expo / React Native
- [ ] Search — Algolia
- [ ] Multi-world
- [ ] Old World simulation
- [ ] Shelter, fire, crafting systems
- [ ] Artifact interaction and written fragments
- [ ] World map layer — inter-region travel when population expands

---

## Key Design Decisions
- **World grid: 3000x1500 tiles** — each tile ~500 feet; on-demand generation from seed
- **Sparse TileCache** — only dirty tiles saved to Firestore
- **Cloud Run** — always-on, min 1 instance, secrets in Secret Manager
- **Vessel beaches permanently** — agents land at one coast tile
- **Chronicle fires at landing** — ~8-15 real hours in production
- **RUN_MODE=production** — 450 seconds/tick
- **Conduits** — 75 fixed, lemur-like with luminescence, not tracked unless bonded
- **The Unbound** — ancient civilization that ascended; Conduits left as guardians
- **Audience = new gods** — voting mechanic is divine influence

---

*Updated Session 5. Simulation running on Cloud Run. Next: UI rebuild + Vercel deployment, then Conduit system.*
