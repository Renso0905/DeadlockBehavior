# Direct Melee Full-Bounty Validation

Status: **INSUFFICIENT_REPLAY_COVERAGE**

## Question

Does an explicit Deadlock `MeleeHit` user message target the exact Trooper in the direct-full-bounty/no-orb class at the time of death?

## Replay results

### rep01

- Full-bounty melee-hit rate: 0.00%
- Ground-only melee-hit rate: 0.00%
- Sensitivity: 0.00%
- Specificity: 100.00%
- MCC: n/a
- Fatal-damage coverage: 100.00%
- Melee/fatal temporal concordance: n/a
- Credited-player fatal-attacker match: 98.89%
- Direct melee support: **false**

### rep02

- Full-bounty melee-hit rate: 0.00%
- Ground-only melee-hit rate: 0.00%
- Sensitivity: 0.00%
- Specificity: 100.00%
- MCC: n/a
- Fatal-damage coverage: 100.00%
- Melee/fatal temporal concordance: n/a
- Credited-player fatal-attacker match: 100.00%
- Direct melee support: **false**

### rep03

- Full-bounty melee-hit rate: 0.00%
- Ground-only melee-hit rate: 0.00%
- Sensitivity: 0.00%
- Specificity: 100.00%
- MCC: n/a
- Fatal-damage coverage: 100.00%
- Melee/fatal temporal concordance: n/a
- Credited-player fatal-attacker match: 98.82%
- Direct melee support: **false**

### rep04

- Full-bounty melee-hit rate: 0.00%
- Ground-only melee-hit rate: 0.00%
- Sensitivity: 0.00%
- Specificity: 100.00%
- MCC: n/a
- Fatal-damage coverage: 100.00%
- Melee/fatal temporal concordance: n/a
- Credited-player fatal-attacker match: 98.41%
- Direct melee support: **false**

### rep05

- Full-bounty melee-hit rate: 0.00%
- Ground-only melee-hit rate: 0.00%
- Sensitivity: 0.00%
- Specificity: 100.00%
- MCC: n/a
- Fatal-damage coverage: 100.00%
- Melee/fatal temporal concordance: n/a
- Credited-player fatal-attacker match: 100.00%
- Direct melee support: **false**

## Interpretation

The explicit MELEE_HIT message does not reproduce the Script109 full-bounty signature strongly enough under the predeclared death window.

Inspect message timing/coverage before changing the reward interpretation.
