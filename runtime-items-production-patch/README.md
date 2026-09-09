# DeadlockBehavior — Runtime Item Ownership Production Patch

This patch promotes the already-validated A142 runtime item ownership subsystem into the replay-generic production pipeline.

## What changes

- Adds `inspector-v04/production/extract-runtime-items.mjs`.
- Reconstructs `CCitadelPlayerController.m_vecUpgrades` as a time-varying **set** of current standard-shop item ownership.
- Uses the validated Script 138 V02 156-item catalog and Source 2 MurmurHash2 item-token mapping.
- Produces fresh per-replay files:
  - `runtime_item_ownership_production_v01.json`
  - `runtime_item_ownership_events_v01.jsonl`
- Promotes the existing production capability `runtime_item_ownership` from `not_supported` to `supported`.
- Raises expected authoritative production coverage from **41/68 to 49/68** after a successful replay run.
- Wires the dedicated item artifact into `lib/replay-model.mjs`, so the existing Builds and Authoritative Stats views can consume it without requiring the legacy integrated research artifact.
- Makes the Evidence `items` endpoint prefer the new production event stream while retaining a legacy integrated-artifact fallback for old replays.
- Adds source-health entries and regression tests.

## Semantic boundaries retained

- `m_vecUpgrades` is interpreted as **current standard-shop item ownership** under A142.
- Ownership entry is not automatically labeled a shop purchase.
- Ownership exit is not automatically labeled a sale.
- Mixed add/remove transitions are not automatically labeled component upgrades.
- Unknown runtime item IDs are an integrity failure, not silently ignored. This intentionally catches catalog/build drift.

## Research provenance

- Script 138 V02 — validated 156-item standard-shop catalog.
- Script 140 V01 — runtime `m_vecUpgrades` substrate.
- Script 141 V02 — strong semantic support for current ownership.
- Script 142 V02 — strong independent replication across five replays.

## Install

First place `DeadlockBehavior_Runtime_Items_Production_Patch.zip` directly in `G:\DeadlockBehavior`. Then run:

```powershell
Set-Location G:\DeadlockBehavior
Expand-Archive -Path .\DeadlockBehavior_Runtime_Items_Production_Patch.zip -DestinationPath .\runtime-items-production-patch -Force
& "G:\Node\node.exe" .\runtime-items-production-patch\install-runtime-items-production.mjs "G:\DeadlockBehavior"
& "G:\Node\node.exe" --check .\inspector-v04\production\extract-runtime-items.mjs
& "G:\Node\node.exe" --test .\inspector-v04\tests\*.test.mjs
& "G:\Node\node.exe" .\inspector-v04\production\run-production.mjs 104373259
```

Expected production summary if the new replay passes item integrity checks:

```text
Authoritative coverage: 49/68
Not supported: 19
Blocked: 0
Failed: 0
```

The installer makes a timestamped backup under `inspector-v04/.runtime-items-production-backup-*` and fails rather than guessing if expected code anchors have changed.
