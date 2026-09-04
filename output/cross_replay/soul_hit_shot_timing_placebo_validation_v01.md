# Soul-Hit Shot-Timing Placebo Validation

Status: **SOUL_HIT_SHOT_TIMING_EXCEEDS_SAME_PLAYER_PLACEBO**

## Purpose

Determine whether the strong nearest-preceding-shot alignment observed in Script126 is specific to actual CItemXP impact timing or merely reflects frequent ordinary weapon fire.

## Pooled true versus placebo

- Within 4 ticks (0.063 s): true=82.42%, placebo=12.98%, difference=+69.44pp
- Within 8 ticks (0.125 s): true=95.27%, placebo=18.49%, difference=+76.79pp
- Within 16 ticks (0.250 s): true=97.92%, placebo=24.75%, difference=+73.17pp
- Within 32 ticks (0.500 s): true=98.68%, placebo=31.56%, difference=+67.12pp
- Within 64 ticks (1.000 s): true=98.87%, placebo=40.10%, difference=+58.76pp

## Guardrail

Even strong true-versus-placebo discrimination does not prove that the nearest preceding shot was the projectile that hit the soul. It only establishes that weapon-discharge timing contains target-relevant signal beyond the player’s ordinary firing rate.

## Next stage

BUILD_HERO_SPECIFIC_CANDIDATE_SHOT_ASSIGNMENT_AND_TRAVEL_MODEL
