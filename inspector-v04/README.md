# DeadlockBehavior Research Inspector V04

A local replay-to-statistics pipeline and research inspector for the DeadlockBehavior repository.

## What V04 does

- Discovers replay output directories under `output/` (`test`, `rep01`, ...).
- Builds a cached per-replay match model from current research outputs.
- Exposes player/team scoreboard, PlayerState, economy, builds, permanent buffs, bridge buffs, movement, melee, resource exposure, breakables, Troopers/souls, flying soul-orb behavior, automatic awards, and primary-fire cadence.
- Provides one global match-time scrubber so time-sensitive state (health, net worth, build, buffs, position) can be inspected at the same moment.
- Lets aggregate cards drill into their underlying JSON/JSONL evidence rows.
- Shows source health instead of inventing metrics when an upstream output is absent.
- Keeps unresolved semantics explicit: item removal is not called a sale, vacuum targeting is not called collection, camp clear during exposure is not called player-caused, and current ammo/effective magazine/effective DPS are excluded.
- Imports a `.dem`, runs all required production producers, validates their artifacts, and publishes a versioned immutable snapshot.
- Exposes every canonical A metric through the UI and `GET /api/replay/:name/metrics` with per-player availability and provenance.

## Scientific boundary

The inspector is a consumer of the repository's evidence/authority layer. It does **not** reinterpret a numbered script passing as scientific validation, and it does not automatically run the historical research notebook as a production ETL.

`pipeline.json` contains the replay-safe production chain. Historical numbered research scripts remain outside the automated pipeline. A run becomes READY only when the exact canonical metric set is owned, all required stages pass, input fingerprints remain stable, and every published output matches its SHA-256 proof.

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
GET  /api/replay/:name/metrics?player=:playerId&time=:seconds
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

Incomplete runs work in `output/.pipeline-work/`. Completed runs move atomically to `output/<replay>/.production-runs/<run-id>/`; the production manifest is published last. The visualizer reads that immutable run. Compatibility copies remain at the replay output root for historical research scripts.

## Processing new replays

Use **Import .dem** to save and process a replay in one flow. Use **Process / retry** for an existing unprocessed, stale, incomplete, or failed replay. With the default launcher, new `.dem` files placed in `replays/` are also detected and queued automatically. Required-step failures remain visible and the last valid published snapshot is preserved.

To validate published metrics independently:

```powershell
G:\Node\node.exe scripts\228-validate-production-reliability.mjs 104373259 104559948 105367926 rep01 rep02 rep03 rep04 rep05 test
```

The current contract contains 116 A metrics: 102 core and 14 extended. The scoped promotions are `ground_soul_vacuum_target` (resolved physical attraction targets only), `reload_state` (direct observed reload state/transitions), `active_fire_mode` (raw numeric mode value), `burst_continuous_state` (raw continuous-shot and burst-remaining counters), `trooper_base_types` (legacy ID narrowed to direct raw subclass-ID counts), `trooper_team_lane` (direct raw numeric team/lane-pair counts), `trooper_orbs` (mutually unique source-linked CItemXP episodes), and `orb_attackable_window` (direct attackable-time difference). Named Trooper types, lane names, variants, shooter identity, secure/deny outcomes, rewards, automatic awards, visibility, and opportunity remain research/B.
