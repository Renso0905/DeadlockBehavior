# dl_midtown World Physics Extraction

Status: **DL_MIDTOWN_WORLD_PHYSICS_GLB_CANDIDATE_READY**

## Map authority

Script121 strongly resolved the top-level replay map package as **dl_midtown**.

## Frozen local resources

- dl_midtown.vpk SHA256: `2c54e22cdf0180d71f3c1d8170154ad3fe3c9d9fd68bbb7988b4ac98bdcb1dc1`
- world_physics.vmdl_c SHA256: `912d5138172c4e4ba01cf19cde690f7d6baefa664442b6deb9ac7acaf7e1503b`

## Embedded physics GLB

- Exists: true
- Valid: true
- Meshes: 36
- Primitives: 36
- POSITION vertices: 10170536
- Indexed triangle diagnostic: 3456299
- Position bounds: min=[-35585,-17321.752,-3639.999] max=[32945,31437.25,15962.7012]

## Guardrails

- The GLB coordinate system/units are not yet assumed to equal replay Source coordinates.
- The static-world physics mesh still requires successful-hit raycast validation before it is used as authoritative LOS.
- Dynamic replay-time occluders remain a separate later layer.

## Next stage

VALIDATE_GLTF_TO_REPLAY_COORDINATE_TRANSFORM_AND_SUCCESSFUL_HIT_STATIC_RAYCASTS
