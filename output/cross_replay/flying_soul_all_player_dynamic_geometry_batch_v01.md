# All-Player Flying-Soul Dynamic Geometry

Status: **FLYING_SOUL_ALL_PLAYER_DYNAMIC_GEOMETRY_READY**

## Behavioral unit

One row represents one specific player in relation to one specific source-linked flying soul.

The row summarizes dynamic player-to-orb geometry across the soul’s actually observed attackable lifetime.

## Critical outcome distinction

`NO_OBSERVED_HIT` means only that this player did not produce an observed successful CItemXP Damage message. It is **not** classified as failure, omission, inattention, or an ignored opportunity.

## Replay results

### rep01

- Candidate rows: 7200
- Secure candidates: 3600
- Deny candidates: 3600
- Candidates with any alive geometry: 88.10%
- Orb tick coverage: 100.00%
- Observed successful-hit candidates: 76
- Positive-hit candidate recovery: 100.00%
- Positive-hit geometry coverage: 100.00%
- Validation: **PASS**

### rep02

- Candidate rows: 8172
- Secure candidates: 4086
- Deny candidates: 4086
- Candidates with any alive geometry: 87.21%
- Orb tick coverage: 100.00%
- Observed successful-hit candidates: 91
- Positive-hit candidate recovery: 100.00%
- Positive-hit geometry coverage: 100.00%
- Validation: **PASS**

### rep03

- Candidate rows: 12960
- Secure candidates: 6480
- Deny candidates: 6480
- Candidates with any alive geometry: 87.83%
- Orb tick coverage: 100.00%
- Observed successful-hit candidates: 108
- Positive-hit candidate recovery: 100.00%
- Positive-hit geometry coverage: 100.00%
- Validation: **PASS**

### rep04

- Candidate rows: 9036
- Secure candidates: 4518
- Deny candidates: 4518
- Candidates with any alive geometry: 86.17%
- Orb tick coverage: 100.00%
- Observed successful-hit candidates: 105
- Positive-hit candidate recovery: 100.00%
- Positive-hit geometry coverage: 100.00%
- Validation: **PASS**

### rep05

- Candidate rows: 7776
- Secure candidates: 3888
- Deny candidates: 3888
- Candidates with any alive geometry: 85.53%
- Orb tick coverage: 100.00%
- Observed successful-hit candidates: 64
- Positive-hit candidate recovery: 100.00%
- Positive-hit geometry coverage: 100.00%
- Validation: **PASS**

## Feature semantics

Distance, eye-angle, and joint bands are descriptive feature bins only. They are not validated opportunity thresholds.

The 5- and 6-tick early windows preserve the documented securing-side priority prior as a diagnostic clock interval without asserting that deny-side Damage is physically impossible during that interval.

## Next stage

ADD_WEAPON_STATE_AND_HERO_SPECIFIC_PROJECTILE_MECHANICS_BEFORE_CLASSIFYING_ACTIONABLE_OPPORTUNITIES
