# Flying-Soul Trajectory and Full-Hit Extraction

Status: **FLYING_SOUL_TRAJECTORY_AND_FULL_HIT_SUBSTRATE_READY**

## Purpose

This extraction creates the moving-orb geometry and comprehensive successful-hit substrate needed for player-specific soul opportunity modeling.

It does **not** yet classify line of sight, weapon readiness, projectile travel time, missed responses, ignored opportunities, or optimal play.

## Replay results

### rep01

- Source-linked flying souls: 600
- Trajectory event coverage: 100.00%
- Position event coverage: 100.00%
- Attackable-position event coverage: 100.00%
- Full matched hits: 81
- Script114 compact matched hits: 4
- Shot episodes: 71
- Secure hits: 58
- Deny hits: 23
- Player attribution: 100.00%
- Role resolution: 100.00%
- Tolerant attackable hit rate: 100.00%
- Validation: **PASS**

### rep02

- Source-linked flying souls: 681
- Trajectory event coverage: 100.00%
- Position event coverage: 100.00%
- Attackable-position event coverage: 100.00%
- Full matched hits: 124
- Script114 compact matched hits: 6
- Shot episodes: 80
- Secure hits: 91
- Deny hits: 33
- Player attribution: 100.00%
- Role resolution: 100.00%
- Tolerant attackable hit rate: 100.00%
- Validation: **PASS**

### rep03

- Source-linked flying souls: 1080
- Trajectory event coverage: 100.00%
- Position event coverage: 100.00%
- Attackable-position event coverage: 100.00%
- Full matched hits: 125
- Script114 compact matched hits: 8
- Shot episodes: 106
- Secure hits: 92
- Deny hits: 33
- Player attribution: 100.00%
- Role resolution: 100.00%
- Tolerant attackable hit rate: 100.00%
- Validation: **PASS**

### rep04

- Source-linked flying souls: 753
- Trajectory event coverage: 100.00%
- Position event coverage: 100.00%
- Attackable-position event coverage: 100.00%
- Full matched hits: 130
- Script114 compact matched hits: 9
- Shot episodes: 97
- Secure hits: 91
- Deny hits: 39
- Player attribution: 100.00%
- Role resolution: 100.00%
- Tolerant attackable hit rate: 99.23%
- Validation: **PASS**

### rep05

- Source-linked flying souls: 648
- Trajectory event coverage: 100.00%
- Position event coverage: 100.00%
- Attackable-position event coverage: 100.00%
- Full matched hits: 69
- Script114 compact matched hits: 0
- Shot episodes: 60
- Secure hits: 49
- Deny hits: 20
- Player attribution: 100.00%
- Role resolution: 100.00%
- Tolerant attackable hit rate: 100.00%
- Validation: **PASS**

## Behavioral guardrail

An observed successful Damage message is an outcome anchor. It does not reveal the exact trigger-pull time and therefore must not yet be treated as reaction time.

## Next stage

BUILD_PLAYER_ORB_GEOMETRY_AND_POSITIVE_ACTIONABILITY_ANCHORS
