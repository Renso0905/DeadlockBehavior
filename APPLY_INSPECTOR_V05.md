# Apply DeadlockBehavior inspector V05 fixes

From the repository root (`G:\DeadlockBehavior`):

```powershell
git status
git apply --check .\deadlockbehavior-inspector-v05-fixes.patch
git apply .\deadlockbehavior-inspector-v05-fixes.patch
.\inspector-v04\test-inspector.ps1
```

Then start the inspector and use **Rebuild cache** once. The patch also changes the cache schema, so stale pre-fix cache entries will no longer be accepted.

## Changes

- Clips alive/dead/low-health integration to gameplay time >= 0.
- Uses the first gameplay-time state, not the pre-match state, for level/net-worth rates.
- Removes the hard-coded +30 seconds from reconstructed team-series ticks and uses the replay working offset.
- Version-gates inspector caches after computational changes.
- Loads the validated hero ID -> display-name cross-replay resource and displays hero names and lane context.
- Downgrades the gameplay clock metric from A to B because its ~30 s offset remains provisional in the claim registry.
- Adds deaths/min, health extrema, low-50%-HP time, death/respawn chronology, checkpoint builds, hero display name, and lane presentation.
- Adds metric -> claim links where an operational claim exists and exposes claim authority metadata through `/api/metrics`.
- Adds regression tests for the pre-match-duration bug, clock status, claim links, and new identity metrics.
- Adds `inspector-v04/OUTPUT_CONTRACT.md` to formalize the production-output boundary without turning the numbered research scripts into ETL.

## Intentionally not changed

- `pipeline.json` remains empty. There are not yet consolidated replay-safe production entrypoints, so automatically running historical research scripts would violate the project's authority architecture.
- No synthetic effective ammo/DPS/magazine values are added.
- No camp clear is relabeled as player-caused.
- No vacuum target is relabeled as collection.
- No item removal is relabeled as sale.
- A true Midtown map background is not fabricated; the current coordinate trajectory remains until a validated map-image/world-coordinate transform is available.
