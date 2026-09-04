# Flying-Soul Static Projectile Access Cross-Replay Checkpoint

Status: **FLYING_SOUL_STATIC_PROJECTILE_ACCESS_CROSS_REPLAY_FROZEN**

## Pooled five-replay result

- Candidate rows: 45144
- Alive-geometry candidates: 39290
- Static evaluated: 100.00%
- Evaluated ticks: 1658877
- Robust static clear: 365557 (22.04%)
- Robust static blocked: 1286296 (77.54%)
- Origin-sensitive: 7024 (0.42%)
- Candidates ever robust clear: 9828/39290 (25.01%)
- Observed successful-hit candidates ever robust clear: 439/444 (98.87%)

## Replay replication

- **rep01:** clear=21.31%, blocked=78.20%, origin-sensitive=0.49%, ever-clear=24.58%, successful-hit-ever-clear=98.68%
- **rep02:** clear=21.45%, blocked=78.13%, origin-sensitive=0.42%, ever-clear=24.46%, successful-hit-ever-clear=100.00%
- **rep03:** clear=21.98%, blocked=77.65%, origin-sensitive=0.37%, ever-clear=24.98%, successful-hit-ever-clear=100.00%
- **rep04:** clear=21.79%, blocked=77.83%, origin-sensitive=0.38%, ever-clear=24.33%, successful-hit-ever-clear=98.10%
- **rep05:** clear=23.72%, blocked=75.78%, origin-sensitive=0.50%, ever-clear=26.90%, successful-hit-ever-clear=96.88%

## Interpretation

Static projectile access is operationally frozen for the current five-replay Midtown cohort. This layer represents static-world projectile obstruction only.

`ROBUST_STATIC_CLEAR` does not establish visual visibility, dynamic-world clearance, weapon readiness, temporal reachability, response attempt, or actionable opportunity.

## Next stage

DYNAMIC_OCCLUDER_STATE_EXTRACTION_AND_VISUAL_PROJECTILE_ACCESS_SEPARATION
