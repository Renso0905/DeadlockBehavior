# Melee / Direct Full-Bounty Signature Validation

Status: **MELEE_DIRECT_FULL_BOUNTY_SIGNATURE_STRONGLY_SUPPORTED_ATTACK_TYPE_NOT_DIRECTLY_VALIDATED**

## Working hypothesis

The Script106 `GROUND_PLUS_SECOND_COMPONENT` class may instead represent direct 100% Trooper bounty awards from melee kills, which suppress normal ground/flying orb spawning.

## Replay results

### rep01

- Ground-only cases: 204
- Full-bounty candidate cases: 95
- Trooper CItemXP presence in ground-only: 100.00%
- Trooper CItemXP presence in full-bounty class: 7.37%
- Orb-absence MCC: 0.9464
- Ground-only credited-player XY median: 527.6726 HU
- Full-bounty credited-player XY median: 64.5906 HU
- Ground 50% model within ±2: 100.00%
- Full 100% model within ±2: 93.68%
- Signature supported: **true**

### rep02

- Ground-only cases: 254
- Full-bounty candidate cases: 90
- Trooper CItemXP presence in ground-only: 100.00%
- Trooper CItemXP presence in full-bounty class: 8.89%
- Orb-absence MCC: 0.9398
- Ground-only credited-player XY median: 539.256 HU
- Full-bounty credited-player XY median: 65.0628 HU
- Ground 50% model within ±2: 98.43%
- Full 100% model within ±2: 90.00%
- Signature supported: **true**

### rep03

- Ground-only cases: 275
- Full-bounty candidate cases: 90
- Trooper CItemXP presence in ground-only: 100.00%
- Trooper CItemXP presence in full-bounty class: 6.67%
- Orb-absence MCC: 0.9557
- Ground-only credited-player XY median: 607.5941 HU
- Full-bounty credited-player XY median: 66.0899 HU
- Ground 50% model within ±2: 97.45%
- Full 100% model within ±2: 94.44%
- Signature supported: **true**

### rep04

- Ground-only cases: 264
- Full-bounty candidate cases: 67
- Trooper CItemXP presence in ground-only: 100.00%
- Trooper CItemXP presence in full-bounty class: 13.43%
- Orb-absence MCC: 0.9149
- Ground-only credited-player XY median: 601.814 HU
- Full-bounty credited-player XY median: 62.414 HU
- Ground 50% model within ±2: 97.35%
- Full 100% model within ±2: 94.03%
- Signature supported: **true**

### rep05

- Ground-only cases: 255
- Full-bounty candidate cases: 61
- Trooper CItemXP presence in ground-only: 100.00%
- Trooper CItemXP presence in full-bounty class: 6.56%
- Orb-absence MCC: 0.9592
- Ground-only credited-player XY median: 438.9852 HU
- Full-bounty credited-player XY median: 80.1327 HU
- Ground 50% model within ±2: 98.82%
- Full 100% model within ±2: 95.08%
- Signature supported: **true**

## Interpretation

The Script106 high-reward class reproduces the expected direct-full-bounty/no-orb signature across independent replays. The earlier flying-orb-co-resolution explanation should be rejected.

Remaining question: Can fatal Trooper damage telemetry directly distinguish melee attacks in these exact full-bounty cases?
