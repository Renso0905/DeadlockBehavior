# Flying-Soul Static Projectile Access Windows V02

Replay: **rep04**
Status: **FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_REPLAY_READY**

## Computational change from V01

- Reusable map-level binary collision cache.
- Flattened triangle coordinates.
- 512-HU spatial grid.
- Early exit after any blocking triangle is found.
- One replay per invocation.
- Atomic 100-candidate checkpoints and resume support.
- Per-candidate static tick classes are persisted with run-length encoding, so downstream scripts do not need to rerun static rays merely to recover the tick timeline.

## Results

- Candidate rows: 9036
- Static-evaluated coverage among prior alive geometry: 100.00%
- Robust-clear tick rate: 21.79%
- Robust-blocked tick rate: 77.83%
- Origin-sensitive tick rate: 0.38%
- Observed-hit candidates ever robust clear: 103/105 (98.10%)

## Guardrail

`ROBUST_STATIC_CLEAR` is a static projectile-path result only. It does not establish visual access, weapon readiness, temporal reachability, response attempt, or actionable opportunity.

## Reuse

The collision cache is tied to the frozen Midtown physics GLB hash and can be reused for later compatible Midtown replays. Replay-specific rays still need to be computed once per replay.

## Next stage

INSPECT_REPLAY_STATIC_ACCESS_THEN_REUSE_CACHE_FOR_LATER_REPLAYS_OR_ADD_DYNAMIC_VISUAL_ACCESS
