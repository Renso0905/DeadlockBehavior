# Midtown Resource-Context Resolution

Status: **REPLAY_MAP_PACKAGE_IDENTITY_DL_MIDTOWN_STRONGLY_SUPPORTED**

## Question

Determine whether `dl_midtown_pulse` is a separate gameplay-map package or an internal resource/context identifier associated with `dl_midtown`.

## Local package evidence

- dl_midtown.vpk exists: true
- dl_midtown_pulse.vpk exists: false
- maps/dl_midtown.vmap_c in dl_midtown.vpk: true
- maps/dl_midtown_pulse.vmap_c in dl_midtown.vpk: false

## Cross-replay raw resource token replication

- **test:** {"dl_midtown":46,"dl_t":5,"dl_0":1,"dl_p":1}
- **rep01:** {"dl_midtown":34,"dl_t":4,"dl_p":2,"dl_pj":1}
- **rep02:** {"dl_midtown":35,"dl_0":1,"dl_t":1}
- **rep03:** {"dl_midtown":46,"dl_t":7,"dl_0":1,"dl_p":1,"dl_z":1}
- **rep04:** {"dl_midtown":36,"dl_t":6,"dl_dt":2,"dl_ps":1}
- **rep05:** {"dl_midtown":36,"dl_p":2,"dl_k":1,"dl_t":1}

## Interpretation

- Package: DL_MIDTOWN_TOP_LEVEL_MAP_PACKAGE_STRONGLY_SUPPORTED
- Pulse token: DL_MIDTOWN_PULSE_NOT_A_LOCAL_TOP_LEVEL_VPK_OR_TOP_LEVEL_VMAP_TREAT_AS_INTERNAL_RESOURCE_CONTEXT_UNTIL_PROVEN_OTHERWISE

No physics mesh or LOS classification is accepted by this script.

## Next stage

EXTRACT_DL_MIDTOWN_WORLD_PHYSICS_WITH_MAP_PACKAGE_HASH_AND_VALIDATE_COLLISION_MESH
