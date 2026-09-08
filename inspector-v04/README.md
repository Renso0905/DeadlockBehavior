# DeadlockBehavior Research Inspector V04

A dependency-free local research inspector for the DeadlockBehavior replay-mining repository.

## What V04 does

- Discovers replay output directories under `output/` (`test`, `rep01`, ...).
- Builds a cached per-replay match model from current research outputs.
- Exposes player/team scoreboard, PlayerState, economy, builds, permanent buffs, bridge buffs, movement, melee, resource exposure, breakables, Troopers/souls, flying soul-orb behavior, automatic awards, and primary-fire cadence.
- Provides one global match-time scrubber so time-sensitive state (health, net worth, build, buffs, position) can be inspected at the same moment.
- Lets aggregate cards drill into their underlying JSON/JSONL evidence rows.
- Shows source health instead of inventing metrics when an upstream output is absent.
- Keeps unresolved semantics explicit: item removal is not called a sale, vacuum targeting is not called collection, camp clear during exposure is not called player-caused, and current ammo/effective magazine/effective DPS are excluded.
- Supports `.dem` import and a **versioned explicit processing manifest** (`pipeline.json`).

## Scientific boundary

The inspector is a consumer of the repository's evidence/authority layer. It does **not** reinterpret a numbered script passing as scientific validation, and it does not automatically run the historical research notebook as a production ETL.

`pipeline.json` is intentionally empty in V04 until replay-safe current entrypoints are consolidated. Importing a `.dem` therefore saves it to `replays/` and reports `PROCESSING_MANIFEST_EMPTY` instead of silently guessing which of 200+ historical scripts should run.

## Install

Place this directory at:

```text
G:\DeadlockBehavior\inspector-v04\
```

No npm install is required.

## Run

From PowerShell:

```powershell
cd G:\DeadlockBehavior
.\inspector-v04\run-inspector.ps1
```

The launcher automatically uses `G:\Node\node.exe` when it exists; otherwise it uses `node` from PATH.

Then open:

```text
http://127.0.0.1:4177
```

Alternative port:

```powershell
.\inspector-v04\run-inspector.ps1 -Port 4188
```

Explicit Node path:

```powershell
.\inspector-v04\run-inspector.ps1 -NodePath "G:\Node\node.exe"
```

## Test

```powershell
.\inspector-v04\test-inspector.ps1
```

Current V04 test coverage includes:

1. A/B metric-registry integrity and exclusions.
2. PlayerState + authoritative ownership + scoreboard/team joins.
3. Nested player-evidence matching across current schemas.
4. End-to-end HTTP API smoke test (replay discovery → model → evidence).

## Primary endpoints

```text
GET  /api/config
GET  /api/metrics
GET  /api/replays
GET  /api/replay/:name/model
GET  /api/replay/:name/health
GET  /api/replay/:name/evidence/:kind
POST /api/import
POST /api/process/:name
```

Evidence kinds currently include:

```text
breakables
rewards
resources
troopers
groundSouls
autoAwards
urnBursts
weapon
melee
playerState
orbs
items
```

Trooper death rows are replay-global because that stream does not encode player attribution. Other evidence streams use nested player-reference matching where the source supports it.

## Data/cache behavior

The first load of a replay scans the needed JSON/JSONL files and writes a fingerprinted cache under `inspector-v04/.cache/`. Use **Rebuild cache** in the UI when you intentionally want to force reconstruction. Cache files are derived and should generally remain untracked.

Recommended `.gitignore` entry:

```gitignore
inspector-v04/.cache/
```

## Processing new replays

V04 deliberately separates two concerns:

1. **Inspector** — consumes current output contracts and makes them inspectable.
2. **Replay processing** — must be promoted into explicit replay-safe entrypoints before being automated.

When consolidation produces those entrypoints, add ordered steps to `pipeline.json`; the existing import/process API and UI are already wired for them. Required-step failures are surfaced rather than suppressed.
