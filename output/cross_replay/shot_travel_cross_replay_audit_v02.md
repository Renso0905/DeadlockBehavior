# Shot Travel Cross-Replay Audit V02

Status: **SHOT_TRAVEL_CROSS_REPLAY_AUDIT_V02_READY**

## V01 correction

V01 required a held-out within-two-tick metric that is absent from the available Script128 fold schema. This falsely caused otherwise strong cross-replay models to be classified as failures.

V02 evaluates cross-replay timing using the available held-out median residual and within-one-tick rate.

## Hero audits

- **Graves (76)** — hits=61, replays=2, folds=2, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Seven (2)** — hits=53, replays=3, folds=3, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Viscous (35)** — hits=51, replays=5, folds=5, classification=CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
- **Lash (31)** — hits=43, replays=4, folds=4, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Infernus (1)** — hits=39, replays=3, folds=3, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Dynamo (11)** — hits=29, replays=2, folds=1, classification=MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS
- **Haze (13)** — hits=24, replays=3, folds=3, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_VARIABLE
- **Shiv (19)** — hits=24, replays=2, folds=2, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Wraith (7)** — hits=20, replays=1, folds=0, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Yamato (27)** — hits=18, replays=3, folds=3, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Victor (66)** — hits=17, replays=2, folds=2, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Paige (67)** — hits=17, replays=2, folds=1, classification=MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS
- **Lady Geist (4)** — hits=15, replays=3, folds=3, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **McGinnis (8)** — hits=11, replays=1, folds=0, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Mo & Krill (18)** — hits=11, replays=1, folds=0, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Warden (25)** — hits=11, replays=3, folds=3, classification=CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT
- **Vyper (58)** — hits=10, replays=1, folds=0, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Mina (63)** — hits=10, replays=2, folds=1, classification=MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS
- **Sinclair (60)** — hits=9, replays=2, folds=1, classification=MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS
- **Venator (65)** — hits=9, replays=1, folds=0, classification=SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY
- **Holliday (14)** — hits=8, replays=1, folds=0, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Bebop (15)** — hits=7, replays=1, folds=0, classification=SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY
- **Drifter (64)** — hits=7, replays=1, folds=0, classification=SINGLE_REPLAY_MODEL_WEAK_OR_UNRESOLVED
- **Pocket (50)** — hits=6, replays=1, folds=0, classification=SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY
- **The Doorman (69)** — hits=5, replays=1, folds=0, classification=SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL
- **Paradox (10)** — hits=4, replays=1, folds=0, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Calico (16)** — hits=3, replays=1, folds=0, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Rem (79)** — hits=3, replays=1, folds=0, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Celeste (81)** — hits=2, replays=2, folds=0, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Vindicta (3)** — hits=1, replays=1, folds=0, classification=INSUFFICIENT_FOR_TRAVEL_MODEL
- **Abrams (6)** — hits=1, replays=1, folds=0, classification=INSUFFICIENT_FOR_TRAVEL_MODEL

## Interpretation

- Cross-replay timing generalization does not imply one fixed projectile velocity per hero.
- Item/loadout state may alter projectile velocity and fire rate.
- Parameter-variable but timing-generalizing heroes are especially relevant for the next modifier-state investigation.
- Multi-replay heroes with too few valid held-out folds remain provisional rather than being mislabeled as single-replay evidence.
- No fitted Script128 speed is currently approved as a canonical opportunity-model parameter.

## Next stage

DISCOVER_TIME_VARYING_EFFECTIVE_WEAPON_FIRE_RATE_PROJECTILE_VELOCITY_AND_ITEM_MODIFIER_STATE
