# Wind-tunnel baseline — fantasy stripped

`node dist/simulation/harness/run.js --seeds 20 --days 365 --csv`, current (default) constants,
20 seeds (1–20), 365 simulated days each (17,520 ticks/seed, 350,400 ticks total). Fantasy arc
stripped via `state.conduits = []` per the spec's known facts — no Conduit sightings/bonds, Source
stays dormant.

Raw output: `2026-07-03T17-24-35-244Z.csv` / `-summary.md` in this directory (gitignored — this file
is the write-up; the raw run is reproducible with the command above). This is a re-run after adding
artifact metrics to the harness — every non-artifact number below is byte-identical to the original run
(same seeds, same rng, same constants), which is itself a second confirmation of the determinism fix.

Wall-clock: 20 seeds × 365 days ticked in a few minutes on an M-series Mac — well inside the spec's
~15-minute budget.

## 1. Time-to-first-pair: is the live world's ~day 35 typical or lucky?

**Lucky-side outlier — almost certainly a leftover of the old, already-fixed pair-bond gate bug, not
typical of current constants.**

| | value |
|---|---|
| firstPairDay | median **5**, min 2, max 15 (20/20 seeds formed ≥1 pair) |

Every one of 20 seeds paired up within two weeks; the slowest (max 15) is still less than half of the
live world's ~day 35. Under the current constants (`PAIR_BOND_THRESHOLD = 0.7`, `PAIR_BOND_MIN_INTERACTIONS = 8`)
pairing is fast and reliable. Day 35 in the live world is consistent with the historical bug the spec's
context describes (pair-bond gate requiring 20 interactions when trust maxes out long before that) —
i.e. it reflects constants that no longer exist, not a slow-but-normal outcome. Not something to tune
further; the live number is just stale evidence.

## 2. Do births occur, and at what rate? Does population grow, hold, or collapse over a year?

**Births occur reliably, but the population trends downward over a year in most seeds — a mild-to-
moderate decline, not a collapse, but the opposite of growth.**

| | value |
|---|---|
| firstConceptionDay | median 38, min 33, max 66 (20/20 seeds) |
| conceptions | median 11, min 2, max 33 |
| firstBirthDay | median 62, min 56, max 95 (**19/20** seeds — see note) |
| births | median 9, min 0, max 30 |
| finalPopulation (started at 50) | median **40**, min 21, max 69 |
| peakPopulation | median 50, min 50, max 69 |

Note: seed 4 conceived twice (day 36) but delivered zero children in the full year — worth a look if
reproductive throughput matters, but it's 1/20 seeds, not a blocked gate (births clearly aren't
mathematically impossible the way the historical bug made them).

Population arithmetic: median births (9) minus median deaths (19, see below) ≈ −10, which matches the
median finalPopulation drop from 50 → 40 almost exactly. 17 of 20 seeds ended below their starting
population of 50; only seed 8 (69) and seed 11 (61) grew meaningfully. **Net, this is a shrinking world
under current constants** — births are healthy, but deaths (see #3) outpace them in most seeds.

## 3. Death causes ranked — is lethal pressure tuned sanely?

**No. Violence dominates overwhelmingly (~92% of all deaths) and the overall death rate is high enough
that population decline is the norm, not the exception. This reads as a bloodbath, not "some deaths."**

Summed across all 20 seeds (365 days each, 402 deaths total):

| cause | total | share |
|---|---|---|
| violence | 372 | 92.5% |
| predator | 28 | 7.0% |
| illness | 2 | 0.5% |
| starvation | 0 | 0% |
| other (incl. old age) | 0 | 0% |

Per-seed annualized: median **19.0 deaths/yr** (min 11, max 34) against a population that starts at 50
and is already declining — that's on the order of 40–50% mortality per year for the median seed, almost
entirely from conflict (`actions.ts` `actionConflict`'s violence roll, gated by `CONFLICT_BASE_CHANCE`
and the aggression-scaled chance). Starvation and illness are essentially non-factors (0 and 2 deaths
respectively across 7,300 agent-years of simulated life) — the survival-drive economy (food/water/rest)
looks well-tuned; it's specifically the conflict/violence pathway that's driving mortality this hard.
**If the owner wants "some deaths, not a bloodbath," the conflict/violence constants in `actions.ts`
(`CONFLICT_BASE_CHANCE`, `CONFLICT_AGGRESSION_SCALE`, and the violence-chance/damage constants in
`actionConflict`) are the first place to look** — though per the hard constraints those aren't part of
this harness's constants-injection scope (only `agents/relationships.ts` and the Conduit-bond
constants in `companions/being.ts` are overridable today).

## 4. Conflict/resolution rate

Conflicts: median **4,399/year** (min 3,034, max 6,007) — roughly one logged conflict every 4 ticks
across the population. Resolutions: **0/20 seeds, always** — but this is a dead-code finding, not a
gameplay flatline: `EventType.Resolution` is defined in `shared/types.ts` and has a narrative weight in
`events/log.ts`, but grep confirms it is never actually logged anywhere in the codebase. Conflicts *do*
resolve mechanically every tick (`OutcomeType.ConflictResolved` drives trust changes in
`relationships.ts`) — the sim just never emits a `SimEvent` for it, so it's invisible to any log-based
metric (this harness's or otherwise). Not a bug to fix under this scope; just don't mistake the 0 for
"conflicts never resolve."

## 5. Exploration — does wanderlust ever send anyone north?

**Moving, not flatlined — but inconsistent.** 10/20 seeds sent at least one agent at/below y1200 within
the year; the other 10 didn't. Median northmost reach (min y) across all seeds: **1213** (min **796**,
max 1468). The min-796 seed put an agent *past* the Source zone marker (~y866) — physically, some
populations do range that far inland within a year. But it's a coin-flip across seeds whether anyone
gets that far at all, which matters for the fantasy arc: exploration reach isn't the bottleneck for
*whether* a scout could reach the Source, but it's not a sure thing every world either. (The 30-day
smoke test earlier in development showed a full flatline at that shorter horizon — this is a good
example of why the spec's 365-day horizon matters; a shorter run would have wrongly flagged exploration
as broken.)

## 6. Gate verdict flags

```
GATE VERDICT
  pairs:       MOVING   (20/20 seeds formed ≥1 pair; median firstPairDay 5)
  conceptions: MOVING   (20/20 seeds; median day 37.5)
  births:      MOVING   (19/20 seeds; median firstBirthDay 62)
  deaths:      MOVING   (20/20 seeds; median 19.0/yr — violence 17.5, predator 1.0)
  exploration: MOVING   (10/20 seeds sent anyone north of y1200)
  artifacts:   FLATLINE (0/20 seeds found an artifact in 365 days) ← investigate
```

## 7. Artifacts — a genuine, verified FLATLINE (and why)

**0/20 seeds ever discovered an artifact in a full year.** Verified against source, not just the empty
metric: `placeArtifacts()` in `world/tileCache.ts` only ever places artifacts on `Terrain.Ruin` tiles —
`if (terrain !== Terrain.Ruin) return [];` is the very first line. Ruin tiles cluster in a small zone far
north (~y599–899, near the Source) — nowhere close to the settlement (~y1443–1499). Per #5 above, only
10/20 seeds ever sent anyone as far as y1200, and the single deepest incursion across all 20 seeds
reached y796 — inside the ruin band's latitude, but hitting the actual ruin tiles requires also landing
in their narrow x-range, not just the right y. In a year, nobody did. This isn't a "stuck gate" in the
constants-tuning sense (there's no threshold to loosen — the mechanic is "walk onto a Ruin tile," full
stop) — it's a consequence of geography plus how rarely wanderlust reaches that far. It would very likely
start moving in a 2–3 year run, or with `--sweep` tuning the exploration-related drives (out of this
harness's current constants-injection scope — `agents/drives.ts`'s wanderlust constants aren't yet
overridable). Metric collection method: `firstArtifactFoundDay`/`artifactsFound` scan tile state directly
(`artifact.discovered` flags via `state.tiles.getDirtyTiles()`) rather than counting
`EventType.ArtifactFound`, because that event is only logged from the idle-curiosity exploration path
(`actions.ts` `actionExplore`) — the wanderlust-foray path (`exploration.ts` `actionVenture`) discovers
artifacts too but never logs an event for it, so an event-only count would have silently undercounted.

No FLATLINE among the core living-world gates (pairs/conceptions/births/deaths/exploration) — every
mechanic the base spec asks about is demonstrably alive at current constants. The two findings that read
as genuine problems are death-cause concentration (#3 — "a gate open too wide") and artifacts (#7 — a
real flatline, but a geography/time-horizon one, not a broken threshold).
