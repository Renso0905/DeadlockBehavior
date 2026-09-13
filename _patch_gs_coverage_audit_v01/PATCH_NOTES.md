# Ground Soul Economic Coverage / Exclusion Audit V01

This patch adds a **B-level research/diagnostic audit** for the current conservative Ground Soul economic-credit resolver. It does not change the 77/77 authoritative ledger, claim registry, production pipeline, or the existing 870 resolved-event semantics.

## What it adds

- `scripts/206-audit-ground-soul-economic-coverage-v01.mjs`
  - joins every runtime Ground Soul lifecycle activation to its current economic-resolution row;
  - classifies the exact resolver stage/reason for non-resolved events;
  - independently reconstructs AssignedGold termination collisions within the existing +/-16 tick isolation window;
  - rescans direct positive `CCitadelPlayerPawn.m_nCurrencies.0000` transitions when the replay is available, for diagnostic collision context only;
  - adds nearby authoritative Trooper-death timing counts as temporal context only, never as causal/source-death attribution;
  - writes a compact summary JSON and one diagnostic JSONL row per lifecycle activation.
- `inspector-v04/run-ground-soul-coverage-audit.ps1` convenience runner.
- Workspace **Ground Soul audit** panel:
  - follows the global replay scrubber;
  - shows activation -> completion -> targeting -> candidate -> resolved funnel counts through the current time;
  - shows full-match resolution coverage;
  - shows exclusion-stage counts;
  - shows non-isolated/same-tick collision counts;
  - lists the unresolved events nearest the scrubber and lets you click one to jump the replay time to it.
- Inspector summary/evidence endpoints for the generated B diagnostic artifacts.
- Regression tests for audit classification, collision context, integrity joins, and UI wiring.

## Output files

For replay `104373259`:

- `output/104373259/ground_soul_economic_coverage_audit_v01.json`
- `output/104373259/ground_soul_economic_coverage_audit_events_v01.jsonl`

`all` mode also writes:

- `output/cross_replay/ground_soul_economic_coverage_audit_batch_v01.json`

## Semantics

The audit describes **why the current resolver includes or excludes a lifecycle**, not whether Souls truly were or were not awarded. In particular:

- `UNRESOLVED_NONISOLATED_TERMINATION` means another completed AssignedGold termination is within the current +/-16 tick isolation window. It does **not** mean no reward occurred.
- Nearby Trooper deaths are temporal context only and are not treated as matched source deaths.
- Exact-tick currency0 increases remain observed direct economy transitions. This audit does not rename them canonical Ground Soul payouts.
- No melee, last-hit method, Flying Soul, exact vacuum radius, or exact share-radius claim is introduced.

## Install

```powershell
Expand-Archive ".\DeadlockBehavior_GroundSoulEconomicCoverageAudit_B_V01.zip" `
  -DestinationPath ".\_patch_gs_coverage_audit_v01" -Force

& ".\_patch_gs_coverage_audit_v01\INSTALL.ps1" `
  -RepoRoot "G:\DeadlockBehavior"
```

Then:

```powershell
cd G:\DeadlockBehavior
.\inspector-v04\test-inspector.ps1
.\inspector-v04\run-ground-soul-coverage-audit.ps1 104373259
.\inspector-v04\run-inspector.ps1
```

Open **Workspace -> + Ground Soul audit**.

For every replay that already has the Ground Soul lifecycle and economic-credit production artifacts:

```powershell
.\inspector-v04\run-ground-soul-coverage-audit.ps1 all
```
