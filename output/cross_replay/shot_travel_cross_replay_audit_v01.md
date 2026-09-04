# Shot Travel Cross-Replay Audit V01

Status: **SHOT_TRAVEL_CROSS_REPLAY_AUDIT_READY**

## Important interpretation change

Projectile velocity and fire rate may vary with items or other modifier state. Therefore pooled Script128 hero speeds are not treated as intrinsic hero constants.

This audit separates cross-replay timing generalization from fitted-parameter stability.

## Hero audits

- **Graves (76)** — hits=61, replays=2, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Seven (2)** — hits=53, replays=3, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Viscous (35)** — hits=51, replays=5, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Lash (31)** — hits=43, replays=4, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Infernus (1)** — hits=39, replays=3, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Dynamo (11)** — hits=29, replays=2, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Haze (13)** — hits=24, replays=3, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Shiv (19)** — hits=24, replays=2, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Wraith (7)** — hits=20, replays=1, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Yamato (27)** — hits=18, replays=3, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Victor (66)** — hits=17, replays=2, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Paige (67)** — hits=17, replays=2, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Lady Geist (4)** — hits=15, replays=3, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **McGinnis (8)** — hits=11, replays=1, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Mo & Krill (18)** — hits=11, replays=1, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Warden (25)** — hits=11, replays=3, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Vyper (58)** — hits=10, replays=1, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Mina (63)** — hits=10, replays=2, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Sinclair (60)** — hits=9, replays=2, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Venator (65)** — hits=9, replays=1, classification=SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY
- **Holliday (14)** — hits=8, replays=1, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Bebop (15)** — hits=7, replays=1, classification=SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY
- **Drifter (64)** — hits=7, replays=1, classification=SINGLE_REPLAY_MODEL_WEAK_OR_UNRESOLVED
- **Pocket (50)** — hits=6, replays=1, classification=SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY
- **The Doorman (69)** — hits=5, replays=1, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Paradox (10)** — hits=4, replays=1, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Calico (16)** — hits=3, replays=1, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Rem (79)** — hits=3, replays=1, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Celeste (81)** — hits=2, replays=2, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Vindicta (3)** — hits=1, replays=1, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Abrams (6)** — hits=1, replays=1, classification=INSUFFICIENT_FOR_TRAVEL_MODEL

## Guardrails

- Parameter variability is not automatically model failure.
- Stable parameters in this cohort do not imply that items cannot modify the weapon.
- No fitted speed is yet approved for the final actionable-opportunity denominator.

## Next stage

DISCOVER_TIME_VARYING_EFFECTIVE_WEAPON_FIRE_RATE_PROJECTILE_VELOCITY_AND_MODIFIER_STATE
