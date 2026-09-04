# LOS / Occluder Substrate Discovery

Replay: **test**
Status: **LOS_OCCLUDER_SUBSTRATE_DISCOVERY_COMPLETE**

## Purpose

Determine whether replay network telemetry itself contains sufficient physical world geometry for trustworthy player-to-soul line-of-sight raycasts.

No line-of-sight or opportunity labels are produced by this script.

## World geometry assessment

Mode: **DIRECT_BOUNDS_CANDIDATES_PRESENT_NEEDS_RAYCAST_VALIDATION**

- Primary candidate entities: 210
- Position coverage: 100.00%
- Model-reference coverage: 100.00%
- Direct-bounds coverage: 100.00%
- Collision-signal coverage: 100.00%
- CWorld present: true
- CFuncBrush present: true

## Class profiles

### CWorld

- Unique entities: 1
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CFuncBrush

- Unique entities: 35
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CDynamicProp

- Unique entities: 122
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CPhysicsProp

- Unique entities: 12
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CCitadelPassthroughFakeWall

- Unique entities: 36
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CCitadel_Destroyable_Building

- Unique entities: 4
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CCitadel_BreakableProp

- Unique entities: 691
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CTriggerPassthroughFakeWall

- Unique entities: 36
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CDoormanBombProjectile

- Unique entities: 93
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CCitadel_DoorwayPortal

- Unique entities: 73
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CProjectile_Doorman_Cart_Projectile

- Unique entities: 44
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CCitadel_ShopProp

- Unique entities: 8
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CRagdollProp

- Unique entities: 4
- Position: 100.00%
- Model: 100.00%
- Direct bounds: 100.00%
- Collision signal: 100.00%
- Profile: `DIRECT_BOUNDS_SUBSTRATE_PRESENT`

### CCitadel_BaseProp_MidStairs

- Unique entities: 2
- Position: 100.00%
- Model: 0.00%
- Direct bounds: 0.00%
- Collision signal: 100.00%
- Profile: `COLLISION_SIGNAL_PLUS_TRANSFORM_NO_DIRECT_BOUNDS`

### CCitadel_Ability_Doorman_Bomb

- Unique entities: 1
- Position: 0.00%
- Model: 0.00%
- Direct bounds: 0.00%
- Collision signal: 0.00%
- Profile: `SPARSE_GEOMETRY_METADATA`

### CCitadel_Ability_Doorman_Cart

- Unique entities: 1
- Position: 0.00%
- Model: 0.00%
- Direct bounds: 0.00%
- Collision signal: 0.00%
- Profile: `SPARSE_GEOMETRY_METADATA`

### CCitadel_Ability_Doorman_Doorway

- Unique entities: 1
- Position: 0.00%
- Model: 0.00%
- Direct bounds: 0.00%
- Collision signal: 0.00%
- Profile: `SPARSE_GEOMETRY_METADATA`

### CCitadel_Ability_Doorman_Hotel

- Unique entities: 1
- Position: 0.00%
- Model: 0.00%
- Direct bounds: 0.00%
- Collision signal: 0.00%
- Profile: `SPARSE_GEOMETRY_METADATA`

## Guardrail

Render bounds, fog-volume bounds, trigger bounds, or generic entity boxes must not automatically be interpreted as bullet-blocking world collision.

Any later LOS model must be validated against known successful soul-hit paths.

## Next stage

VALIDATE_DIRECT_REPLAY_OCCLUDER_PRIMITIVES_AGAINST_SUCCESSFUL_HIT_POSITIVE_CONTROLS
