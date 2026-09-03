# Fatal Damage Citadel-Type Melee Validation

Status: **MELEE_FATAL_DAMAGE_TYPE_NOT_REPLICATED**

## Direct telemetry

`CCitadelUserMessage_Damage.citadel_type` is interpreted using `ECitadelDamageType`, where value `3` is `CITADEL_DAMAGETYPE_MELEE`.

Script110 observed no usable `MeleeHit` messages, but its fatal Damage telemetry was retained and analyzed here without reparsing the demos.

## Replay results

### rep01

- Fatal citadel-type coverage: 100.00%
- Full-bounty fatal melee rate: 87.37%
- Ground-only fatal melee rate: 16.67%
- Sensitivity: 87.37%
- Specificity: 83.33%
- MCC: 0.6745
- Credited-confirmed full-bounty melee rate: 91.01%
- Credited-confirmed ground-only melee rate: 0.00%
- Credited-confirmed MCC: 0.9275
- Direct support: **false**

### rep02

- Fatal citadel-type coverage: 100.00%
- Full-bounty fatal melee rate: 91.11%
- Ground-only fatal melee rate: 16.54%
- Sensitivity: 91.11%
- Specificity: 83.46%
- MCC: 0.6827
- Credited-confirmed full-bounty melee rate: 94.12%
- Credited-confirmed ground-only melee rate: 2.86%
- Credited-confirmed MCC: 0.9126
- Direct support: **false**

### rep03

- Fatal citadel-type coverage: 100.00%
- Full-bounty fatal melee rate: 90.00%
- Ground-only fatal melee rate: 10.18%
- Sensitivity: 90.00%
- Specificity: 89.82%
- MCC: 0.7517
- Credited-confirmed full-bounty melee rate: 95.24%
- Credited-confirmed ground-only melee rate: 0.00%
- Credited-confirmed MCC: 0.9667
- Direct support: **false**

### rep04

- Fatal citadel-type coverage: 100.00%
- Full-bounty fatal melee rate: 83.58%
- Ground-only fatal melee rate: 13.64%
- Sensitivity: 83.58%
- Specificity: 86.36%
- MCC: 0.6273
- Credited-confirmed full-bounty melee rate: 88.71%
- Credited-confirmed ground-only melee rate: 3.14%
- Credited-confirmed MCC: 0.8604
- Direct support: **false**

### rep05

- Fatal citadel-type coverage: 100.00%
- Full-bounty fatal melee rate: 90.16%
- Ground-only fatal melee rate: 14.51%
- Sensitivity: 90.16%
- Specificity: 85.49%
- MCC: 0.6573
- Credited-confirmed full-bounty melee rate: 91.53%
- Credited-confirmed ground-only melee rate: 0.00%
- Credited-confirmed MCC: 0.9435
- Direct support: **false**

## Interpretation

Fatal Damage.citadelType does not reproduce the direct-full-bounty signature sufficiently strongly.

Inspect class-specific fatal citadel-type distributions before changing the mechanic interpretation.
