# Flying-Soul Positive Actionability Anchors

Status: **FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_READY**

## Meaning

Each row is a successful player interaction with a source-linked Trooper flying soul, paired with reconstructed moving-orb position and the attacker’s nearest/interpolated 4 Hz player state.

These are **positive calibration anchors**, not opportunity thresholds.

## Important timing implication

Script115 observed Damage arrivals as early as one tick after reconstructed attackable start for both secure and deny roles. Therefore any short securing-side priority mechanic must not yet be modeled as a literal interval in which deny-side Damage messages cannot register.

## Replay results

### rep01

- Unique positive anchors: 81
- Secure anchors: 58
- Deny anchors: 23
- Orb-position coverage: 100.00%
- Player-position coverage: 100.00%
- Eye-angle coverage: 100.00%
- Secure successful-hit median 3D distance: 746.239 HU
- Deny successful-hit median 3D distance: 751.088 HU
- Validation: **PASS**

### rep02

- Unique positive anchors: 124
- Secure anchors: 91
- Deny anchors: 33
- Orb-position coverage: 100.00%
- Player-position coverage: 100.00%
- Eye-angle coverage: 100.00%
- Secure successful-hit median 3D distance: 575.1366 HU
- Deny successful-hit median 3D distance: 527.7539 HU
- Validation: **PASS**

### rep03

- Unique positive anchors: 125
- Secure anchors: 92
- Deny anchors: 33
- Orb-position coverage: 100.00%
- Player-position coverage: 100.00%
- Eye-angle coverage: 100.00%
- Secure successful-hit median 3D distance: 705.2888 HU
- Deny successful-hit median 3D distance: 602.7869 HU
- Validation: **PASS**

### rep04

- Unique positive anchors: 130
- Secure anchors: 91
- Deny anchors: 39
- Orb-position coverage: 100.00%
- Player-position coverage: 100.00%
- Eye-angle coverage: 100.00%
- Secure successful-hit median 3D distance: 659.1576 HU
- Deny successful-hit median 3D distance: 625.2204 HU
- Validation: **PASS**

### rep05

- Unique positive anchors: 69
- Secure anchors: 49
- Deny anchors: 20
- Orb-position coverage: 100.00%
- Player-position coverage: 100.00%
- Eye-angle coverage: 100.00%
- Secure successful-hit median 3D distance: 673.6709 HU
- Deny successful-hit median 3D distance: 463.1694 HU
- Validation: **PASS**

## Guardrails

- Player position uses pawn world position, not exact eye or muzzle origin.
- Between 4 Hz state samples, position and eye orientation are explicitly labeled interpolation proxies.
- Hero-specific successful-hit distributions are observed envelopes, not mechanical range limits or evidence that one hero is intrinsically better at securing/denying.
- Successful Damage arrival is an outcome anchor, not trigger-pull time or reaction time.

## Next stage

BUILD_ALL_PLAYER_ORB_DYNAMIC_GEOMETRY_AND_SEPARATE_MECHANICAL_REACHABILITY_FROM_ATTENTION_RESPONSE
