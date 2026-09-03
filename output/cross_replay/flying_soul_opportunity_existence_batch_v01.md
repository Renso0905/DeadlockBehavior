# Flying-Soul Opportunity Existence Layer

Status: **FLYING_SOUL_OPPORTUNITY_EXISTENCE_BASE_READY**

## Behavioral hierarchy

This layer establishes **stimulus existence, player role, and observed alive-state overlap only**.

It does not yet classify spatial accessibility, line of sight, aimability, response attempts, success, failure, or ignored opportunities.

## Role semantics

- Player team equals orb team -> `DENY_CANDIDATE`.
- Player team opposes orb team -> `SECURE_CANDIDATE`.
- Melee-finished Troopers with no flying orb produce no flying-soul candidate event.

## Replay results

### rep01

- Source-linked flying souls: 600
- Player candidates: 7200
- Secure candidates: 3600
- Deny candidates: 3600
- Observed alive during stimulus existence: 88.56%
- Validation: **PASS**

### rep02

- Source-linked flying souls: 681
- Player candidates: 8172
- Secure candidates: 4086
- Deny candidates: 4086
- Observed alive during stimulus existence: 87.58%
- Validation: **PASS**

### rep03

- Source-linked flying souls: 1080
- Player candidates: 12960
- Secure candidates: 6480
- Deny candidates: 6480
- Observed alive during stimulus existence: 88.05%
- Validation: **PASS**

### rep04

- Source-linked flying souls: 753
- Player candidates: 9036
- Secure candidates: 4518
- Deny candidates: 4518
- Observed alive during stimulus existence: 86.47%
- Validation: **PASS**

### rep05

- Source-linked flying souls: 648
- Player candidates: 7776
- Secure candidates: 3888
- Deny candidates: 3888
- Observed alive during stimulus existence: 85.92%
- Validation: **PASS**

## Geometry warning

Distance fields in this layer use the fixed flying-soul **spawn anchor**. They are descriptive context only and must not be used as a final accessibility/opportunity threshold.

## Next stage

During the exact attackable interval, when was each living player spatially and visually capable of interacting with the moving orb?
