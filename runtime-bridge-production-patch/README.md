# DeadlockBehavior — Runtime Bridge Powerup Production Patch

This patch productionizes the current validated `runtime_bridge_buff_ownership` authority and moves replay-generic authoritative coverage from **55/68 to 62/68**.

## Newly productionized A metrics

- `bridge_collections`
- `bridge_current`
- `bridge_uptime`
- `bridge_uptime_share`
- `bridge_overlaps`
- `bridge_termination`
- `bridge_team_uptime`

## Frozen semantic contract

Production preserves the current bridge runtime-interval authority instead of inventing a direct player-side modifier handle.

Acquisition uses:

- `CCitadel_Pickup_Modifier`
- `m_nSubclassID = MurmurHash2(recordKey, 0x31415926)` for the four validated bridge record keys
- `m_bActive true -> false` UPDATE as the world collection transition
- nearest **alive** resolved player at that transition under the frozen **<=300 HU** collector gate
- the existing 0.25-second `player_state.jsonl` sampling only for collector geometry (maximum accepted nearest-snapshot gap: 16 ticks)

The four current bridge resources are Gun, Survival, Casting, and Movement, each with a resource-defined **160 second** duration.

Interval termination uses exact replay events:

- `NATURAL_EXPIRATION` at collection + 160 s
- `DEATH_TERMINATION` at the exact controller alive -> dead transition when earlier
- `MATCH_END_CENSORED` when native gameplay state ends before nominal expiry
- `REPLAY_END_CENSORED` when the replay ends first

Censoring is not mislabeled as natural expiration. The patch also does not claim exact 5-to-40-minute effect interpolation or a directly serialized player-side bridge modifier identity.

## Production outputs

For replay `<replay>`:

- `output/<replay>/runtime_bridge_buff_ownership_production_v01.json`
- `output/<replay>/runtime_bridge_buff_events_v01.jsonl`

The replay model, Authoritative Stats tab, team bridge uptime, Source Health, and Evidence explorer consume the dedicated production source.

## Validation performed while building this patch

The pure derivation layer has regression tests for natural expiration, exact death termination, match/replay censoring, the 300-HU gate, snapshot-gap rejection, non-gameplay cleanup, overlaps, and valid zero-event results.

Against the existing `test.dem` authoritative artifacts, the new derivation reproduced all **19/19** legacy bridge intervals with:

- **19/19 collector assignments identical**
- **0 interval mismatches**
- **0 termination-reason mismatches**
- collector snapshot gaps from **-8 to +7 ticks**
- maximum attributed collector distance **203.30 HU**, inside the frozen 300-HU gate

This is an engineering regression against the already-frozen authority, not a new scientific replication claim.

## Install

Extract the ZIP to a temporary folder and run from any PowerShell location:

```powershell
& "G:\Node\node.exe" ".\install-runtime-bridge-buffs-production.mjs" "G:\DeadlockBehavior"
```

The installer requires the prior 55/68 permanent-buff production stage, creates a timestamped backup, and refuses to guess if its expected anchors are absent.

## Verify

```powershell
& "G:\Node\node.exe" --check "G:\DeadlockBehavior\inspector-v04\production\extract-runtime-bridge-buffs.mjs"
& "G:\Node\node.exe" --test "G:\DeadlockBehavior\inspector-v04\tests\*.test.mjs"
& "G:\Node\node.exe" "G:\DeadlockBehavior\inspector-v04\production\run-production.mjs" 104373259
```

Expected successful production summary:

```text
Authoritative coverage: 62/68
Not supported: 6
Blocked: 0
Failed: 0
```

The remaining six unsupported A metrics are `health_regen` plus the five primary-fire cadence metrics.
