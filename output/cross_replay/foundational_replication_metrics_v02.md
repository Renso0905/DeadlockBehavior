# DeadlockBehavior Cross-Replay Foundational Replication V0.2

Status: **MIXED_CROSS_REPLAY_REPLICATION**

Independent replay units: **5**

## V01 correction

V01 failed before analysis because a local `distance3D` constant shadowed the `distance3D()` helper function. V02 renames the scalar to `edgeDistance3D`. No extraction data were affected.

## Claim-level replication

- **GROUND_SOUL_PRODUCTION_LAST_HIT_LINK** — STRONGLY_REPLICATED — 5/5 informative replays supported
- **GROUND_SOUL_LIFECYCLE** — STRONGLY_REPLICATED — 5/5 informative replays supported
- **VACUUM_PROXIMITY** — MIXED_OR_NOT_REPLICATED — 0/5 informative replays supported
- **ECONOMIC_RECIPIENT_SET** — STRONGLY_REPLICATED — 5/5 informative replays supported
- **RECIPIENT_GEOMETRY** — STRONGLY_REPLICATED — 5/5 informative replays supported
- **REWARD_ALLOCATION** — MIXED_OR_NOT_REPLICATED — 0/5 informative replays supported
- **AIM_ORIENTATION** — INSUFFICIENT_REPLAY_COVERAGE — 0/0 informative replays supported

## Replay-level results

### rep01

- Strict death↔AssignedGold matches: 805
- Last-hit deaths with AssignedGold candidate: 97.53%
- Target→inactive median: 0.6563 sec
- Best vacuum XY threshold: 790 HU
- Frozen 735 vacuum MCC: 0.5875
- Clean economic cases: 709
- Best recipient 3D threshold: 2160 HU
- Frozen 2150 recipient MCC: 0.9758
- Frozen 2150 exact-set rate: 94.50%
- Integer partition exact rate: 95.20%
- Credited remainder priority: 94.02%
- Aim primary median: 5.6699°
- Aim placebo median: 19.0584°

### rep02

- Strict death↔AssignedGold matches: 900
- Last-hit deaths with AssignedGold candidate: 98.08%
- Target→inactive median: 0.6406 sec
- Best vacuum XY threshold: 795 HU
- Frozen 735 vacuum MCC: 0.6365
- Clean economic cases: 796
- Best recipient 3D threshold: 2175 HU
- Frozen 2150 recipient MCC: 0.9536
- Frozen 2150 exact-set rate: 89.95%
- Integer partition exact rate: 93.22%
- Credited remainder priority: 87.79%
- Aim primary median: 10.214°
- Aim placebo median: 28.3761°

### rep03

- Strict death↔AssignedGold matches: 1320
- Last-hit deaths with AssignedGold candidate: 98.39%
- Target→inactive median: 0.6563 sec
- Best vacuum XY threshold: 785 HU
- Frozen 735 vacuum MCC: 0.583
- Clean economic cases: 1153
- Best recipient 3D threshold: 2165 HU
- Frozen 2150 recipient MCC: 0.9745
- Frozen 2150 exact-set rate: 93.93%
- Integer partition exact rate: 95.06%
- Credited remainder priority: 92.79%
- Aim primary median: 8.1583°
- Aim placebo median: 15.3831°

### rep04

- Strict death↔AssignedGold matches: 919
- Last-hit deaths with AssignedGold candidate: 98.39%
- Target→inactive median: 0.6719 sec
- Best vacuum XY threshold: 765 HU
- Frozen 735 vacuum MCC: 0.6988
- Clean economic cases: 782
- Best recipient 3D threshold: 2165 HU
- Frozen 2150 recipient MCC: 0.9632
- Frozen 2150 exact-set rate: 92.71%
- Integer partition exact rate: 93.61%
- Credited remainder priority: 90.30%
- Aim primary median: 6.9924°
- Aim placebo median: 18.1539°

### rep05

- Strict death↔AssignedGold matches: 884
- Last-hit deaths with AssignedGold candidate: 98.63%
- Target→inactive median: 0.625 sec
- Best vacuum XY threshold: 790 HU
- Frozen 735 vacuum MCC: 0.5722
- Clean economic cases: 799
- Best recipient 3D threshold: 2165 HU
- Frozen 2150 recipient MCC: 0.9719
- Frozen 2150 exact-set rate: 93.12%
- Integer partition exact rate: 96.87%
- Credited remainder priority: 95.25%
- Aim primary median: 4.5567°
- Aim placebo median: 16.9346°

## Interpretation

The discovery replay is excluded from the replication-unit count. Frozen discovery parameters are evaluated directly before replay-specific best-fitting estimates are considered.
