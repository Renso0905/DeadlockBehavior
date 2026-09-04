# dl_midtown Static Physics Positive Raycast Validation

Status: **DL_MIDTOWN_STATIC_PROJECTILE_RAYCAST_POSITIVE_CONTROL_READY**

## Purpose

Validate static-world projectile-path raycasts against observed successful flying-soul hits before applying any occlusion labels to Script117 nonresponders.

## Coordinate interpretation

- Player positions inside raw physics bounds: 100.00%
- Orb positions inside raw physics bounds: 100.00%

## Primary positive control

- Origin proxy: pawn world position + 64 HU Z
- Collision filter: BULLET_SOLID_CANDIDATE
- Overall clear successful-hit paths: 521/529 (98.49%)

- rep01: 79/81 clear (97.53%)
- rep02: 124/124 clear (100.00%)
- rep03: 125/125 clear (100.00%)
- rep04: 127/130 clear (97.69%)
- rep05: 66/69 clear (95.65%)

## Critical guardrails

- Pawn + Z offset is a firing-origin probe, not exact hero muzzle/eye origin.
- Static collision is not the same as visual opacity.
- Dynamic doors, breakables, temporary walls, and props are not yet incorporated.
- No Script117 nonresponse is classified as an ignored or avoidable opportunity here.

## Next stage

SEPARATE_STATIC_VISUAL_OCCLUSION_FROM_PROJECTILE_BLOCKING_AND_ADD_DYNAMIC_OCCLUDER_STATE
