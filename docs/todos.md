# Living World — Todo List
### Current as of Session 6

---

## What Is Built and Working

### Simulation Core (Complete)
- `shared/types.ts` — all types, interfaces, enums; TileCache interface and TileCacheData for serialization; ConduitBeing, ConduitBondType, currentAction on Agent
- `simulation/world/tileCache.ts` — TileCacheImpl: sparse on-demand tile generation from seed, dirty tile tracking, serialize/deserialize for Firestore
- `simulation/world/generator.ts` — 3000x1500 world constants; spawnConduits() places 75 Conduits across interior; generateWorld returns TileCacheImpl + conduits array
- `simulation/world/tiles.ts` — all utilities updated to TileCache; markTileDirty helper
- `simulation/world/resources.ts` — tickAllResources only processes dirty (visited) tiles
- `simulation/world/vessel.ts` — all tile accesses updated to TileCache
- `simulation/agents/` — drives, births, significance, illness, initializer, actions all updated; currentAction written every tick; search radii scaled for larger world
- `simulation/companions/being.ts` — full Conduit system; 75 beings tick independently; sighting events; light/dark bond eligibility; significance multipliers; createConduits() and tickAllConduits() exports
- `simulation/chronicle/packager.ts` — Conduit proximity, bond state, and Conduit event types pulled into thread packages
- `simulation/chronicle/prompt.ts` — Conduit sightings as background color; light bond as wonder; dark bond shifts register; broken bond as grief
- `simulation/tick.ts` — tickAllConduits() called each tick; events appended to eventLog; capped at 500
- `simulation/server.ts` — serves only occupied tiles; bonded Conduits only sent to frontend; currentAction included in agent snapshot
- `simulation/firebase.ts` — checkpoint serializes conduits array; agent checkpoint includes conduitId, conduitBondType, lastChroniclePageMention, healthScore; live feed sends bonded Conduits only
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
- Cloud Run: min 1 instance always running, 512MB RAM, 1 CPU; endpoints open to public (allUsers invoker)
- All API keys stored in Google Secret Manager
- Docker: root-level Dockerfile builds shared/ + simulation/ correctly
- GitHub: code at `https://github.com/walkertbrown/Chronicles`

### Web Frontend (Complete)
- `web/app/world/page.tsx` — Oracle UI; SVG map; zoom/pan; vessel; agent dots; bonded Conduit diamonds (light=violet, dark=oxblood); roster panel with Living/Fallen tabs; agent detail with currentAction; dead agent detail; click-to-locate flies viewbox to agent
- `web/app/chronicle/page.tsx` — Oracle UI; lit-parchment leaf; drop cap; archive; empty state
- `web/lib/api.ts` — env-var driven (NEXT_PUBLIC_API_URL); localhost fallback for dev
- `web/lib/types.ts` — frontend type mirrors including DeadAgentSnapshot, BondedConduitSnapshot, currentAction on AgentSnapshot
- `web/lib/oracle.tsx` — Oracle design system: tokens, EngravedBar, Kicker, SectionHead, Seal, GiltRings
- `web/lib/tileCoords.ts` — tileToSvg exported
- `web/public/map.svg` — Azgaar export
- `web/.env.local` — NEXT_PUBLIC_API_URL set (gitignored)
- **Vercel: deployed at `https://chronicles-azure.vercel.app`**

### Design
- `docs/spec-v2.md` — v2.1; full Conduit/story design documented

---

## Deferred — Known Gaps

- [ ] `bondedAgentName` fix — bond-broken event uses raw agent ID in description because agent is dead at that point. Fix: store `bondedAgentName: string | null` on ConduitBeing when bond forms so it's available when bond breaks. Requires change to `shared/types.ts` and `simulation/companions/being.ts`
- [ ] Artifact imprinting mechanic — `heldArtifactId` field exists on ConduitBeing, logic not built
- [ ] tileCoords full re-extraction for 3000x1500 grid — agent dots on map will be wrong until done
- [ ] Map zoom starts on landing area
- [ ] Transition duration RUN_MODE-aware
- [ ] Chronicle page empty state distinction
- [ ] Dedicated death log (deathLog: DeathRecord[])
- [ ] Event log cap — currently 500, raise before long runs

---

## Phase 3 — Observation Run

Simulation is running on Cloud Run. Frontend is live. Let it run for two real weeks. Watch:
- Death rate
- Agent inland movement
- Pair bond formation and birth system
- Chronicle quality
- Conduit sighting frequency in chronicle prose
- Whether any bonds form naturally

---

## Longer Term
- [ ] Voting mechanic — backend /vote endpoint needed before frontend can be wired; placeholder removed from UI intentionally
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
- **Conduits** — 75 fixed, lemur-like with luminescence; all tick independently; untracked until bonded; sighting events feed chronicle; light/dark bond; significance multiplier on bonded agents
- **Dark bond** — any Conduit + aggression >0.7 + nobility <0.3 agent = dark bond (option A — agent-driven)
- **The Unbound** — ancient civilization that ascended; Conduits left as guardians
- **Audience = new gods** — voting mechanic is divine influence; deferred until backend ready
- **currentAction** — plain-English description of agent's current action; written every tick; displayed in agent detail panel

---

*Updated Session 6. Conduit system complete. Oracle UI deployed to Vercel. Simulation running on Cloud Run. Next: observation run, then deferred gaps as needed.*
