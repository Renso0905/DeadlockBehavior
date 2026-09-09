# DeadlockBehavior — Runtime Permanent World-Buff Production Patch

This patch promotes the already-validated `runtime_permanent_buff_ownership` claim into the replay-generic production pipeline.

## Result

A successful arbitrary replay production run should move authoritative production coverage from **49/68 to 55/68**.

The six newly productionized A metrics are:

- `permanent_current`
- `permanent_acquisitions`
- `permanent_count`
- `permanent_by_family`
- `permanent_value`
- `permanent_team_diff`

## Runtime authority

Production reads `CCitadelPlayerController.m_vecStatViewerModifierValues` and resolves `m_SourceModifierID` in the validated Source2 compound `EntitySubclassID_t` namespace:

`<recordKey>/<modifierClass>`

The production extractor uses:

- Script 136 V02 world-stat-buff resource contract;
- Script 145 V01 semantic rules;
- Script 146 V01 five-replay replication authority;
- the frozen six-family `m_eValType` map from the replication artifact.

Every observed mapped permanent row is checked against the exact static tier unit value. Positive integral deltas are emitted as authoritative permanent accumulation events. In-place decreases, non-integral values, family/value-type drift, or final-state inconsistencies fail the stage rather than being silently accepted.

**Zero permanent pickup events are valid** when the runtime carrier and authority contracts remain intact.

## Semantic boundaries retained

This patch supports cumulative permanent-pickup ownership/state and positive accumulation events. It does **not** claim:

- which physical world object granted a pickup;
- Golden Statue/Lion Statue causal attribution;
- bridge-powerup semantics;
- exact downstream effective-stat composition with items/hero scaling;
- compatibility across materially different Deadlock builds.

Row removal remains diagnostic and is not interpreted as loss of a permanent buff.

## Outputs

For replay `<replay>`:

- `output/<replay>/runtime_permanent_buff_ownership_production_v01.json`
- `output/<replay>/runtime_permanent_buff_events_v01.jsonl`

The replay model, Buffs view, Authoritative Stats, Source Health, and Evidence explorer consume the dedicated production source.

## Additional fix

`inspector-v04/run-production.ps1` no longer evaluates `$PSScriptRoot` inside a parameter default. Systems that require signed PowerShell scripts may still need `-ExecutionPolicy Bypass`; the direct Node runner remains the simplest path.

## Install

Extract this ZIP to a temporary folder and run:

```powershell
& "G:\Node\node.exe" .\install-runtime-permanent-buffs-production.mjs "G:\DeadlockBehavior"
```

Then:

```powershell
& "G:\Node\node.exe" --check "G:\DeadlockBehavior\inspector-v04\production\extract-runtime-permanent-buffs.mjs"
& "G:\Node\node.exe" --test "G:\DeadlockBehavior\inspector-v04\tests\*.test.mjs"
& "G:\Node\node.exe" "G:\DeadlockBehavior\inspector-v04\production\run-production.mjs" 104373259
```

Expected successful production summary:

```text
Authoritative coverage: 55/68
Not supported: 13
Blocked: 0
Failed: 0
```

The installer creates a timestamped backup under `inspector-v04/.runtime-permanent-buffs-production-backup-*` and refuses to guess if the expected 49/68 item-production anchors are not present.
