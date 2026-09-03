# DeadlockBehavior Foundational Discovery Checkpoint

Replay: `test`

Status: **READY_FOR_COMPACT_CROSS_REPLAY_REPLICATION**

Ready for cross-replay replication: **true**

## Authority

These mechanics are validated operationally within `test.dem`; they are not yet canonical Deadlock mechanics.

## Source validation

- PASS — lifecycle — ASSIGNED_GOLD_LIFECYCLE_CLASSIFIER_V01
- PASS — exactCredit — ASSIGNED_GOLD_EXACT_CREDIT_ATTRIBUTION_VALIDATION_V01
- PASS — sharingGeometry — ASSIGNED_GOLD_SHARE_RECIPIENT_GEOMETRY_COMPARISON_V01
- PASS — integerAllocation — ASSIGNED_GOLD_FINAL_INTEGER_ALLOCATION_VALIDATION_V01
- PASS — facingAngles — PLAYER_FACING_ANGLE_SEMANTICS_VALIDATION_V02
- PASS — aimAngles — PLAYER_EYE_ANGLE_SHOT_DIRECTION_VALIDATION_V01

## Operational claims

### GROUND_SOUL_LIFECYCLE

**VALIDATED_WITHIN_TEST_DEM**

Matched AssignedGold episodes can be exhaustively classified into targeted immediate, targeted early-floor, targeted stable-floor, targetless match-time-scaled timeout-candidate, and censored targetless lifecycle classes.

### VACUUM_TARGET_NOT_ECONOMIC_OWNER

**STRONGLY_SUPPORTED_WITHIN_TEST_DEM**

m_hVacuumTarget represents physical vacuum targeting and is not the exclusive economic-recipient authority.

### CREDITED_LAST_HITTER_ECONOMICALLY_INCLUDED

**STRONGLY_SUPPORTED_WITHIN_TEST_DEM**

The credited last-hitter is strongly associated with the AssignedGold economic recipient set and is consistently included in the validated exact-partition cohort.

### GROUND_SOUL_RECIPIENT_SET_GEOMETRY

**STRONGLY_SUPPORTED_WITHIN_TEST_DEM**

Economic-sharing membership is best explained in the validated cohort by death-time 3D distance from the Trooper, with an empirical ~2150 HU envelope.

Caution: 2150 HU is an empirical single-replay boundary and is not promoted to an exact canonical engine constant.

### GROUND_SOUL_INTEGER_ALLOCATION

**STRONGLY_SUPPORTED_WITHIN_TEST_DEM**

Observed AssignedGold team reward is distributed as an exact integer partition among recipients, with strong credited-last-hitter remainder priority.

### TARGETLESS_NO_PAYOUT

**SUPPORTED_WITHIN_TEST_DEM**

Targetless lifecycle termination has strong exact-tick negative-control support for no AssignedGold payout.

Caution: Use targetless lifecycle termination / timeout candidate rather than claiming canonical expiration semantics.

### WORLD_YAW

**STRONGLY_SUPPORTED_WITHIN_TEST_DEM**

Angle component 1 behaves as yaw for body, eye, and camera orientation, using PLUS_YAW_0 world convention: 0°=+X, 90°=+Y, 180°=-X, 270°=-Y.

### EYE_ANGLE_AIM_ORIENTATION

**STRONGLY_SUPPORTED_WITHIN_TEST_DEM**

m_angEyeAngles component 1 is operational shot/aim yaw and component 0 is pitch with negative Cartesian pitch sign.

### CAMERA_DISTINCT_FROM_AIM

**SUPPORTED_WITHIN_TEST_DEM**

m_angClientCamera is a distinct third-person camera-orientation signal and should not replace m_angEyeAngles for aim-relative behavioral features.

### BODY_FACING_PROXY

**SUPPORTED_WITHIN_TEST_DEM**

CBodyComponent.m_angRotation component 1 is a movement-aligned body-facing yaw proxy.

Caution: Exact animation/model-facing semantics remain narrower than the operational body-yaw proxy.

## Intentionally deferred to cross-replay

- **VACUUM_RADIUS_EXACT_CONSTANT** — Does the ~732-735 HU operational ground-soul vacuum envelope reproduce independently, and what is the true engine boundary?
- **RECIPIENT_SHARE_RADIUS_GENERALIZATION** — Does the ~2150 HU / 54.6 m death-time 3D recipient-set boundary reproduce across independent matches?
- **TARGET_SELECTION_ARBITRATION** — When multiple allies satisfy physical-vacuum proximity, what determines final m_hVacuumTarget?
- **TARGETLESS_TIMEOUT_SCALING** — Does the ~18 s -> +4 s/min -> ~40 s targetless lifecycle function reproduce across independent matches and game versions?
- **GROUND_SOUL_REWARD_SCALING** — Do match-time scaling, variant modifiers, comeback behavior, sharing schedule, and integer allocation reproduce independently?
- **TROOPER_VARIANT_ECONOMICS** — Do provisional Trooper variant multipliers and Super behavior reproduce across varied independent matches?
- **AIM_ORIENTATION_GENERALIZATION** — Does m_angEyeAngles preserve the same yaw/pitch and shot-direction relationship across players, heroes, matches, and versions?

## Do not reopen on test.dem

- Exact 732 versus 735 HU ground-soul vacuum threshold tuning.
- Additional targetless-lifetime formula fitting.
- Additional AssignedGold reward residual fitting to eliminate remaining +/-1-3 soul errors.
- More m_angEyeAngles component-order discovery.
- More movement-only validation of yaw convention.
- Attempts to force m_hVacuumTarget to equal economic ownership.

## Cross-replay replication order

1. **GROUND_SOUL_PRODUCTION_LAST_HIT_LINK** — Player-last-hit Trooper deaths should reproduce the near-deterministic AssignedGold production association.
2. **GROUND_SOUL_LIFECYCLE** — Reconstruct AssignedGold lifecycle and verify targeted versus targetless classes remain coherent.
3. **VACUUM_PROXIMITY** — Test whether targeted episodes remain strongly associated with allied proximity to the physical soul.
4. **ECONOMIC_RECIPIENT_SET** — Verify credited last-hitter inclusion and distinguish economic recipients from physical vacuum target.
5. **RECIPIENT_GEOMETRY** — Test whether death-time Trooper-centered 3D geometry continues to predict the recipient set.
6. **REWARD_ALLOCATION** — Verify sharing, reward scaling, integer partitions, and credited remainder priority.
7. **AIM_ORIENTATION** — Verify component-1 yaw, component-0 eye pitch, pitch sign, and eye-angle alignment to successful shot direction.
