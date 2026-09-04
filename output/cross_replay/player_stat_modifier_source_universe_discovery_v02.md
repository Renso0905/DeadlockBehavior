# Player Stat Modifier Source Universe Discovery V02

Status: **PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_READY_FOR_INTERPRETATION**

## Script132 V01 correction

V01 is withdrawn. It selected a `{...}` version identifier inside the KV3 metadata header as the document root, which caused all resources to report zero top-level records.

V02 explicitly skips the KV3 metadata header before locating the resource root.

## Counts

- Top-level records: 967
- Modifier-bearing records: 848
- Shop-item candidates: 272
- Hero-bound abilities: 263
- Permanent world-buff candidates: 45
- Temporary Powerup candidates: 36
- Objective-state candidates: 48
- Stat tokens: 128
- Ability-property keys: 2025

## Guardrail

This remains source-universe discovery. Activation conditions, stacking order, targets, duration and replay observability are not yet inferred.

## Next stage

INSPECT_SOURCE_CLASSES_THEN_BUILD_EXPLICIT_ITEM_PERMANENT_BUFF_POWERUP_AND_ACTIVE_EFFECT_CATALOGS
