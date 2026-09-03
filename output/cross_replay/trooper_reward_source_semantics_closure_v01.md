# Trooper Reward-Source Semantics Closure

Status: **TROOPER_REWARD_SOURCE_SEMANTICS_OPERATIONALLY_CLOSED**

## Script111 interpretation audit

Original Script111 global status: `MELEE_FATAL_DAMAGE_TYPE_NOT_REPLICATED`.

Broad replay support: 0/5.

Credited-fatal-attacker-confirmed replay support: **5/5**.

The broad cohort does not require the fatal Damage attacker to equal the independently reconstructed credited last-hitter. The credited-confirmed cohort does, and was predeclared by Script111 as the strongest semantic cohort.

## Pooled credited-attacker-confirmed result

- Cases: 1271
- Full-bounty fatal melee sensitivity: 92.35%
- Ground-only fatal non-melee specificity: 98.77%
- Accuracy: 96.85%
- MCC: 0.9243

## Operational reward paths

### NON_MELEE_SPLIT_BOUNTY

- Fatal credited attack is non-melee.
- Trooper reward follows the split ground/flying pathway.
- A flying soul may create an enemy deny opportunity.

### MELEE_DIRECT_FULL_BOUNTY

- Fatal credited attack has `citadel_type = 3` (`CITADEL_DAMAGETYPE_MELEE`).
- The full-value/direct reward pathway is strongly supported.
- Normal flying CItemXP spawning is suppressed in the overwhelming majority of validated cases.
- No flying-orb enemy deny opportunity should be constructed when no flying orb exists.

## Guardrail

`citadel_type = MELEE` validates melee-type fatal damage. It does not by itself distinguish light melee from heavy melee or prove a specific input topography.

## Next stage

BEHAVIORAL_OPPORTUNITY_FEATURE_CONSTRUCTION
