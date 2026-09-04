# Primary Weapon Shot Telemetry Validation

Replay: **rep01**
Status: **PRIMARY_WEAPON_SHOT_TELEMETRY_STRONGLY_SUPPORTED**

## Purpose

Validate an independent primary-weapon discharge signal against known successful CItemXP Damage impacts.

## Weapon telemetry

- Unique weapon entities: 14
- Player-linked weapon entities: 14
- Observed discharge events: 26073
- Player-linked discharge events: 26073

## Successful-hit alignment

- Within 8 ticks (0.125 s): 79/81 (97.53%)
- Within 16 ticks (0.250 s): 81/81 (100.00%)
- Within 32 ticks (0.500 s): 81/81 (100.00%)
- Within 64 ticks (1.000 s): 81/81 (100.00%)

- Hero agreement: 81/81 (100.00%)

## Semantic limits

- Weapon discharge is an observed action/execution signal, not direct target attribution.
- Nearest preceding shot remains candidate linkage only.
- Exploratory implied speed is not yet a projectile-speed constant.
- Trigger-input attempts while the gun cannot fire are not measured here.

## Next stage

CALIBRATE_HERO_SPECIFIC_SHOT_TO_HIT_TRAVEL_AND_WEAPON_READY_STATE
