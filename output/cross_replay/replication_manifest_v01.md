# DeadlockBehavior Cross-Replay Replication Manifest

Created: 2026-09-03T19:18:11.683Z

Discovery replay: `test.dem`

Discovery checkpoint ready: **true**

Independent replay count: **5**

Cohort status: **STRONG_INITIAL_REPLICATION_COHORT_AVAILABLE**

## Selected replication cohort

1. `rep01.dem` — RAW_REPLAY_ONLY
2. `rep02.dem` — RAW_REPLAY_ONLY
3. `rep03.dem` — RAW_REPLAY_ONLY
4. `rep04.dem` — RAW_REPLAY_ONLY
5. `rep05.dem` — RAW_REPLAY_ONLY

## Replication contract

1. **GROUND_SOUL_PRODUCTION_LAST_HIT_LINK** — Does player-last-hit Trooper death remain strongly associated with AssignedGold production?
2. **GROUND_SOUL_LIFECYCLE** — Do targeted and targetless AssignedGold lifecycle classes reconstruct coherently?
3. **VACUUM_PROXIMITY** — Does physical vacuum targeting remain strongly associated with proximity to the ground soul?
4. **ECONOMIC_RECIPIENT_SET** — Is the credited last-hitter economically included while physical vacuum target remains distinct from economic ownership?
5. **RECIPIENT_GEOMETRY** — Does death-time Trooper-centered 3D geometry continue to predict economic sharing membership?
6. **REWARD_ALLOCATION** — Do reward scaling, sharing, integer partition, and credited remainder priority reproduce?
7. **AIM_ORIENTATION** — Do component-1 yaw, component-0 eye pitch, pitch sign, and shot-linked eye orientation reproduce?

## Replay inventory

### rep01

- Role: INDEPENDENT_REPLICATION_CANDIDATE
- Stage: RAW_REPLAY_ONLY
- Size: 490.18 MiB
- Fingerprint: `8daac46727dab0273ab061fd`
- Outputs: 0/8

### rep02

- Role: INDEPENDENT_REPLICATION_CANDIDATE
- Stage: RAW_REPLAY_ONLY
- Size: 521.74 MiB
- Fingerprint: `fe03e782284b1dfa31ab23f0`
- Outputs: 0/8

### rep03

- Role: INDEPENDENT_REPLICATION_CANDIDATE
- Stage: RAW_REPLAY_ONLY
- Size: 738.64 MiB
- Fingerprint: `79110534bb643de935afaaf1`
- Outputs: 0/8

### rep04

- Role: INDEPENDENT_REPLICATION_CANDIDATE
- Stage: RAW_REPLAY_ONLY
- Size: 506.77 MiB
- Fingerprint: `9983ecac7898a076f04a5358`
- Outputs: 0/8

### rep05

- Role: INDEPENDENT_REPLICATION_CANDIDATE
- Stage: RAW_REPLAY_ONLY
- Size: 505.27 MiB
- Fingerprint: `8736c6890a7f7fda97deb7c5`
- Outputs: 0/8

### test

- Role: DISCOVERY_CALIBRATION
- Stage: FOUNDATIONAL_CHECKPOINT_PRESENT
- Size: 715.21 MiB
- Fingerprint: `d15802d42c9157a87c41823c`
- Outputs: 8/8
