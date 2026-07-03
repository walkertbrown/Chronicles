# Wind-tunnel baseline — fantasy kept (Conduits + the Source)

`node dist/simulation/harness/run.js --seeds 20 --days 365 --keep-fantasy --csv`, current (default)
constants, same 20 seeds (1–20) and 365-day horizon as BASELINE.md, but the Conduit-stripping surgery
skipped — all 75 Conduit beings live, the Source is active.

Raw output (default-constants baseline): `2026-07-03T17-28-59-339Z.csv` / `-summary.md` in this
directory (gitignored). Note on methodology: this is a **separate run from BASELINE.md**, not derived
from it — Conduits consume `rng()` draws every tick, and that rng is the same shared stream agent logic
draws from, so a fantasy-kept and fantasy-stripped run of the *same* seed diverge in agent behavior from
tick 2 onward purely from rng-stream position. The two runs answer related but distinct questions;
population/death/pair numbers below are close to BASELINE.md's but not identical, which is expected and
correct, not a bug.

## The headline numbers (default constants, no fake-chronicle)

| question | answer |
|---|---|
| Conduit bond forms within a year? | **0/20 seeds** |
| Does the Source ever awaken? | **0/20 seeds** |
| Does control ever flip? | Never — `sourceControlFinal` is exactly 0.00 in all 20 seeds |

**At current constants, with production's real chronicle system running (as it does live), the fantasy
plot's *dark* path cannot ignite within a year in this 20-seed sample — and the *light* path's true
production ignition rate isn't visible in a bare `--keep-fantasy` harness run at all**, for a structural
reason explained below, not a constants problem. Two follow-up investigations (a dark-path constant
sweep, and a `--fake-chronicle` mode that restores the light path's visibility) resolve both questions
with real numbers below.

## What does happen: Conduit sightings

```
conduit sightings: MOVING   (17/20 seeds; median day 4)
```

17 of 20 seeds see a Conduit within the first two weeks; 3/20 never log a sighting in the full year.
Frontier Conduits spawn near the landing site specifically so they're seen early, and that's working.
The bottleneck is entirely downstream of sighting — getting from "seen" to "bonded."

## Part 1 — the DARK path: diagnosed, sweep-verified, and it does ignite under relaxed constants

### Why it flatlines by default: verified against real agent/Conduit state, not just theorized

Per the spec's instruction to verify a flatline against real state before concluding anything, I ran a
throwaway diagnostic (not part of the harness — deleted after use) that ticked seeds with fantasy kept
and inspected `state.conduits[*].agentProximityHistory` and agent traits directly. Dark bonds
(`companions/being.ts` `checkBondEligibility`) require, on the SAME agent-Conduit pair, simultaneously:
`totalTicks >= 120` (DARK_BOND_PROXIMITY_TICKS), `fearSpikes <= 8` (DARK_BOND_FEAR_SPIKES_MAX),
`aggression >= 0.70`, `nobility <= 0.30`.

Checking six full-year seeds directly: dark-trait-eligible agents exist in every seed's population
(1–4 of them) — the trait bar isn't the blocker. The closest real near-misses were in seed 2: agent_40
(aggression 1.00, nobility 0.30 — meets the trait bar) reached **102** proximity-ticks with the
*same* unbonded Conduit (conduit_2) over the full year, but had already accumulated **33** fear-spike
ticks against the cap of 8 — well over. Agent_3 (aggression 0.84, nobility 0.30) reached 97 ticks with
28 fear-spikes, same story. My working hypothesis from this was: **the fear-spike cap is the binding
constraint** — proximity gets close to 120 but fear spikes disqualify first. I sized up a sweep to test it.

### The sweep disproves my own hypothesis — which is exactly what a sweep is for

`--sweep DARK_BOND_FEAR_SPIKES_MAX=8,40,100`, 10 seeds, 365 days, all other constants default:

| DARK_BOND_FEAR_SPIKES_MAX | conduit bonds |
|---|---|
| 8 (default) | 0/10 |
| 40 | 0/10 |
| 100 | 0/10 |

**All three combinations produced byte-for-byte identical results across every seed and every metric.**
Raising the fear-spike allowance 12.5× changed nothing — my hypothesis was wrong. The reason: seed 2's
agent_40/conduit_2 pair topped out at 102 proximity-ticks over the *entire year* and never grew further
(the pair drifted apart) — so no fear-spike cap, however generous, helps a pair that never reaches the
proximity threshold in the first place. **The real binding constraint is `DARK_BOND_PROXIMITY_TICKS`
itself, not the fear-spike cap.**

### Confirming the real lever: proximity ticks, with fear cap along for the ride

Bracketing checks (seeds 1–2, 365 days) to map the actual threshold:

| DARK_BOND_PROXIMITY_TICKS | DARK_BOND_FEAR_SPIKES_MAX | result |
|---|---|---|
| 120 (default) | 8 (default) | no bond |
| 40 | 8 (unrelaxed) | no bond — proximity alone isn't sufficient either |
| 50 | 60 | no bond |
| 45 | 40 | no bond |
| **40** | **40** | **seed 2 bonds, day 28** |
| 10 | 99999 (effectively unlimited) | seed 2 bonds, day 28 (same day) |

**Both constants have to move together, and the window is narrow** — 45/40 fails, 40/40 succeeds, for
the same pair. This is a compound-AND rarity problem: proximity duration and fear-spike accumulation
both need headroom at once, and by default neither has enough.

### Full 10-seed confirmation at the working setting

`--set DARK_BOND_PROXIMITY_TICKS=40 --set DARK_BOND_FEAR_SPIKES_MAX=40`, seeds 1–10, 365 days
(`2026-07-03T17-47-36-783Z.csv`):

```
conduit bonds:     MOVING   (1/10 seeds; median day 28; 0 light-first, 1 dark-first)
source awakening:  MOVING   (1/10 seeds; median day 79)
```

Seed 2: dark bond day 28 → Source awakens day 79 → control locks to **−1.00** (fully dark) and stays
there all year (0 flips). This is the plot igniting, followed all the way through to the Source opening
and the "old gods" effect taking hold (`applySourceEffects` in `source/source.ts`) — a complete, verified
example of the arc actually playing out at relaxed constants. **1/10 (10%) ignition rate at this
setting** — a real but still low rate; a higher-confidence restart setting would need looser values still
(see recommendation at the end).

## Part 2 — the LIGHT path: invisible-by-construction in a bare harness run, restored via `--fake-chronicle`

### Why a plain `--keep-fantasy` run can never show light bonds

The light-bond gate additionally requires `pagesMentioned >= 3` — the agent must appear in at least 3
chronicle pages (`LIGHT_BOND_CHRONICLE_PAGES_MIN`). The harness never runs the chronicle generator (hard
constraint: no LLM calls, $0 cost), so `state.chroniclePages` stays permanently empty — verified:
`chroniclePages.length === 0` at the end of every plain harness run. **The 0/20 in the headline numbers
above is not evidence the light path is broken or rare — it's structurally guaranteed to be zero, by a
harness limitation, not a sim or constants problem.** This matters for interpretation: in the actual live
world, the chronicle *does* run, so the light path is NOT actually blocked in production the way the
un-augmented harness output implies.

### `--fake-chronicle`: real selection logic, no LLM, restores visibility

Per owner authorization, `simulation/harness/fakeChronicle.ts` calls `chronicle/packager.ts`'s
`packThreads()` — the real, pure, synchronous significance/thread-selection logic production uses
(verified: it imports nothing from `chronicle/generator.ts`, `chronicle/prompt.ts`, `firebase.ts`, or the
Anthropic SDK) — at production's real cadence (20 real hours between pages → 160 ticks, since a
production tick is 7.5 real minutes; translated to ticks because the harness has no wall clock to drive
the wall-clock-based scheduler in `shouldGenerateChronicle`), and appends a real `ChronicleEntry` with
placeholder prose instead of ever calling the LLM. Verified deterministic (two runs, byte-identical
CSVs). One faithfully-reproduced production quirk, not fixed: `significantEvents` is populated with tick
*numbers* (matching `generateChronicle`'s own code), while `checkBondEligibility` looks these up as event
*ids* — a mismatch that means that branch of the mention-check is dead in production too, not just here;
only the `primaryAgentId` branch (an agent leading its own chronicle thread) ever actually counts a
mention, in both the harness and production.

### Result: the light path DOES ignite

`--seeds 20 --days 365 --keep-fantasy --fake-chronicle --csv` (`2026-07-03T17-52-32-826Z.csv`), default
constants:

```
conduit bonds:     MOVING   (1/20 seeds; median day 83; 1 light-first, 0 dark-first)
source awakening:  MOVING   (1/20 seeds; median day 133)
```

Seed 19: light bond day 83 → Source awakens day 133 → control locks to **+1.00** (fully light, the
Unbound's golden age) and stays there all year (0 flips), 1 pilgrimage logged. **1/20 (5%) ignition rate
at default constants with chronicle running for real** — confirming the light path is genuinely reachable
in production today, just rare, and rarer than the relaxed-constants dark path above.

### Quick check: does lowering LIGHT_BOND_PROXIMITY_TICKS help?

One bracketing test, `--fake-chronicle --set LIGHT_BOND_PROXIMITY_TICKS=90` (halved from 180), 10 seeds,
365 days (`2026-07-03T17-57-26-190Z.csv`): **0/10** — no improvement over the ~5% baseline rate (and this
is too small a sample to distinguish from "still ~5%"; it's not evidence lowering it *hurts*). Given the
dark path's lesson — that proximity alone was insufficient and the fear-spike cap had to move too —
**the light path likely needs the same treatment**: `LIGHT_BOND_FEAR_SPIKES_MAX` is currently 4 (tighter
even than dark's already-insufficient 8), so it's the more probable next lever, not proximity alone.
**Recommended next sweep (not run here — this was a bracketing check, not the full investigation, per
scope):** `--fake-chronicle --sweep LIGHT_BOND_PROXIMITY_TICKS=180,90,45 --sweep
LIGHT_BOND_FEAR_SPIKES_MAX=4,20,40` (9 combinations), 10+ seeds, 365 days, mirroring the method that
found the dark path's working setting.

## Artifacts and imprinting

```
artifacts:          FLATLINE (0/20 seeds found an artifact in 365 days) ← investigate
artifactsImprinted: 0/20 seeds (always 0)
```

Imprinting (`companions/being.ts` `executeImprint`) requires a bonded Conduit standing with its agent on
a *discovered* artifact tile — with conduit bonds themselves this rare (0–1/20 depending on path/
constants) and artifacts never discovered at all in this sample, imprinting has no path to ever fire.
See BASELINE.md §7 for the artifact flatline's own diagnosis (Ruin-terrain-only placement, far-north
geography) — identical mechanism applies here; keeping the fantasy arc active doesn't change where
artifacts spawn.

## Full gate verdict

```
GATE VERDICT — default constants, --keep-fantasy, no fake-chronicle
  pairs:             MOVING   (20/20 seeds formed ≥1 pair; median firstPairDay 5)
  conceptions:       MOVING   (19/20 seeds; median day 37)
  births:            MOVING   (19/20 seeds; median firstBirthDay 60)
  deaths:            MOVING   (20/20 seeds; median 20.0/yr — violence 17.0, predator 1.0)
  exploration:       MOVING   (10/20 seeds sent anyone north of y1200)
  artifacts:         FLATLINE (0/20 seeds found an artifact in 365 days) ← investigate
  conduit sightings: MOVING   (17/20 seeds; median day 4)
  conduit bonds (dark path):   FLATLINE (0/20 seeds in 365 days)
  conduit bonds (light path):  FLATLINE (0/20 seeds — but structurally invisible here, see Part 2; not
                                a real dark-path-style flatline)
  source awakening:            FLATLINE (0/20 seeds in 365 days)

GATE VERDICT — with the two follow-up investigations above
  conduit bonds (dark, PROXIMITY_TICKS=40 + FEAR_SPIKES_MAX=40): MOVING (1/10 seeds; median day 28)
  conduit bonds (light, --fake-chronicle, default constants):    MOVING (1/20 seeds; median day 83)
  source awakening (either path ignited):                       MOVING (control locks to ±1.00, holds, 0 flips)
```

Pilgrimages: 0 whenever bonds are 0 — a direct, expected consequence (only a bonded agent heeds the
Source's call; see `shouldHeedSourceCall` in `actions.ts`), not an independent finding. In both cases
where a bond did form (dark seed 2, light seed 19), exactly 1 pilgrimage was logged and the Source
awakened and locked to that bond's polarity for the rest of the year — the mechanism works precisely as
designed once a bond exists; the entire story here is about how rarely one forms.

The core living-world gates (pairs/conceptions/births/deaths/exploration) look essentially identical to
the fantasy-stripped baseline within run-to-run noise — keeping the fantasy arc active doesn't visibly
distort the living world's demographics at default constants, because with bonds this rare,
`applySourceEffects` almost never fires. Once a bond *does* form, control holds its polarity for the rest
of the year in both observed cases — zero flips — suggesting that once ignited, the contest is currently
more "settled" than "contested"; whether that's intended (a slow-building golden age or tyranny, not a
back-and-forth war) or worth revisiting is a design question, not a metrics one.
