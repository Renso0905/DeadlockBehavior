# Hero Stat / Progression Schema Discovery V02

Status: **HERO_CATEGORY_GOLD_THRESHOLD_PROGRESSION_SCHEMA_READY**

## Correction

`m_mapPurchaseBonuses` and `m_MapModCostBonuses` are distinct resource structures.

`m_MapModCostBonuses` contains explicit gold thresholds (`nGoldThreshold`) and bonus values (`flBonus`), so it is the stronger structural candidate for cumulative Weapon/Vitality/Spirit investment breakpoints.

## Gold-threshold tables

### SPIRIT

| Gold threshold | Bonus | Graph % |
|---:|---:|---:|
| 800 | 7 | 7 |
| 1600 | 11 | 7 |
| 2400 | 15 | 8 |
| 3200 | 19 | 8 |
| 4800 | 38 | 9 |
| 6400 | 45 | 9 |
| 8000 | 52 | 10 |
| 11200 | 59 | 10 |
| 16000 | 66 | 10 |
| 22400 | 75 | 11 |
| 28800 | 100 | 11 |

### VITALITY

| Gold threshold | Bonus | Graph % |
|---:|---:|---:|
| 800 | 9 | 7 |
| 1600 | 12 | 7 |
| 2400 | 15 | 8 |
| 3200 | 20 | 8 |
| 4800 | 38 | 9 |
| 6400 | 42 | 9 |
| 8000 | 46 | 10 |
| 11200 | 50 | 10 |
| 16000 | 54 | 10 |
| 22400 | 60 | 11 |
| 28800 | 66 | 11 |

### WEAPON

| Gold threshold | Bonus | Graph % |
|---:|---:|---:|
| 800 | 9 | 7 |
| 1600 | 12 | 7 |
| 2400 | 15 | 8 |
| 3200 | 18 | 8 |
| 4800 | 46 | 9 |
| 6400 | 54 | 9 |
| 8000 | 62 | 10 |
| 11200 | 74 | 10 |
| 16000 | 86 | 10 |
| 22400 | 100 | 11 |
| 28800 | 115 | 11 |

## Guardrail

These are installed-build progression structures. Effective player stats still require the player’s current category investment, item properties, hero progression, permanent buffs, temporary buffs, ability/passive state and debuffs.

## Next stage

DISCOVER_ALL_STAT_MODIFIER_SOURCES_ITEMS_PERMANENT_BUFFS_POWERUPS_ABILITIES_AND_EXTERNAL_EFFECTS
