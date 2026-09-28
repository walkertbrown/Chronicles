# Chronicles — operational context

A persistent living-world simulation ("Chronicles"): ~50 agents with drives, traits, trust-based
relationships, births/deaths, a building economy, and a dormant fantasy arc (Conduits, the Source).
An LLM narrator writes chronicle pages from simulated events — the narrator dramatizes, the sim decides.

## Where the live sim runs (as of 2026-07-03)

- Docker on the home server "ServerMac" (Ubuntu 22.04): `ssh elizabethcorley@servermac.local`
  (user is in the docker group — no sudo needed; tailscale operator is set)
- Container: `chronicles-sim`, `--restart unless-stopped`, running an explicitly TAGGED image
  (see `docker inspect chronicles-sim --format '{{.Config.Image}}'`). Do NOT rely on
  `chronicles-sim:latest` — as of 2026-09-28 it is a stale 2026-07-01 build from before PR #14,
  and running it would silently roll the world back.
- Port: host `127.0.0.1:3101` → container `3001` (host 3001 is TAKEN by another app — never bind it)
- Exact run command (`<tag>` = the image you just built):
  ```
  docker run -d --name chronicles-sim --restart unless-stopped \
    -p 127.0.0.1:3101:3001 \
    --env-file ~/chronicles/simulation/.env \
    -v ~/chronicles/simulation/firebase-service-account.json:/app/simulation/firebase-service-account.json \
    chronicles-sim:<tag>
  ```
- Env on the box (`~/chronicles/simulation/.env`): ANTHROPIC_API_KEY, GEMINI_API_KEY, RUN_MODE=production
- Logs: `docker logs chronicles-sim`

## Public API (Tailscale Funnel)

- `https://servermac.tailaad45c.ts.net:8443` → 127.0.0.1:3101
- Endpoints: `/state`, `/chronicle`, `/deaths`
- The same funnel serves MinIO (port 443 root) and `/menus` (9120) — do not touch those mappings.

## Deploying sim changes

`~/chronicles` on the box is a git clone of `github.com/walkertbrown/chronicles`, on `main`.
Work in a branch or worktree elsewhere; the serving tree only ever fast-forwards.

1. Merge the PR on GitHub, then `git -C ~/chronicles pull --ff-only`.
2. Back up the checkpoint doc first if the change migrates saved state (a resume-time repair is
   a one-way edit to the live world).
3. `docker build -t chronicles-sim:<new-tag> ~/chronicles` — a NEW tag; keep the old image for rollback.
4. `docker rm -f chronicles-sim`, then the run command above with `<new-tag>`.
   Rollback = the same two steps with the previous tag.

The sim resumes automatically from the Firestore checkpoint on start.

## State (Firebase project `chronicles-14b34`)

- Firestore doc `worlds/world_sample_01` = the checkpoint, format **gzip-v1**: the whole world state
  as one gzipped JSON blob field (~180KB), written every tick. The loader also accepts the old
  structured format (pre-2026-07-01 checkpoints).
- Chronicle pages: subcollection `worlds/world_sample_01/chronicle`. Pages with `generatedAt`
  BEFORE 2026-07-01 are a **ghost timeline** — a prior run whose saves silently failed; world days
  36–50 in those pages never persisted and the live world is re-living those days differently.
- Realtime DB (`chronicles-14b34-default-rtdb`): live agent positions at `worlds/world_sample_01/live`.

## Pace & cost

- Production tick = 7.5 min (`TICK_INTERVAL_MS=450000`); 48 ticks = 1 world day = 6 real hours.
- Chronicle page: Claude Sonnet, ~1 per 20 real hours. Hourly brief: Gemini Flash. ≈ $4–5/month total.
- Compute is $0 (home server). There is no Cloud Run — the old service was DELETED 2026-07-01.

## Hard rules

- **NEVER run a second sim instance against `world_sample_01`** — two writers clobber checkpoints.
- Do not recreate the Cloud Run service.
- There is **no deployed web frontend** (Vercel intentionally dropped 2026-07-01). Reading the world = the funnel API.
- The wind-tunnel harness (`simulation/harness/`, branch `feat/wind-tunnel`, spec in repo root or
  provided separately) must stay headless/in-memory: no `firebase.ts` imports, no network, never
  touches the live world.
- The narrator may dramatize (dialogue, texture) but must not invent events/relationships — and the
  sim has **no gossip/information-propagation mechanic yet** (trust changes only via direct pairwise
  interaction). Don't describe rumor-spreading as simulated; it's planned, not built.
