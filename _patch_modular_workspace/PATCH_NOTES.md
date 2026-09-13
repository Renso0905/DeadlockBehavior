# DeadlockBehavior Modular Workspace V01

This patch adds an additive **Workspace** tab to the existing inspector. It does not alter production extraction, claim status, or the 77/77 authority ledger.

## What it adds

- Draggable statistic cards with keyboard/click move-left and move-right alternatives.
- Duplicate/remove cards so the same statistic can be compared across players.
- Per-card player selector and statistic selector.
- Global scrubber synchronization: every card resolves at the same selected match time.
- A pinnable comparison baseline. Every card shows current value, baseline value, absolute change, and percentage change when meaningful.
- Per-card full-match trend chart with current-time and baseline markers.
- Persisted layout in browser local storage.
- 1/2/3/4/auto column layouts.
- Existing authority status displayed from `/api/metrics`.
- Explicit labeling for time-window "derived views" so UI convenience is not confused with a new A claim.

## Initial metric adapters

Level; health; max health; health percent; health regen; gold net worth; AP net worth; team net worth; team net-worth differential; player team share; owned item count; permanent world-buff units; active bridge buffs; bridge uptime through scrubber; deaths through scrubber; Ground Soul economic gain; Ground Soul activations through scrubber.

The architecture is intentionally adapter-based so new replay-model statistics can be added without rewriting the workspace shell.

## Install

Extract the ZIP anywhere, then from PowerShell:

```powershell
& ".\INSTALL.ps1" -RepoRoot "G:\DeadlockBehavior"
```

The installer makes a timestamped backup under `G:\DeadlockBehavior\patch-backups\` and rolls back touched files if installation verification fails.

Then run:

```powershell
cd G:\DeadlockBehavior
.\inspector-v04\test-inspector.ps1
.\inspector-v04\run-inspector.ps1
```

Open the new **Workspace** tab. Existing tabs remain unchanged.
