# Hero Stat / Progression Schema Discovery V01

Status: **HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION**

## Scope

This checkpoint establishes intrinsic hero and progression stat structures from the locally installed Deadlock build. It does not calculate effective runtime stats.

- Hero records: 59
- Player-selectable heroes: 42
- Starting-stat keys: 31
- Standard level/boon upgrade keys: 10
- Special scaling relationships: 13
- Purchase bonus rows: 630

## Starting-stat schema

- **EAbilityResourceMax** — heroes=42, unique=1, varies=false
- **EAbilityResourceRegenPerSecond** — heroes=42, unique=1, varies=false
- **EAirDashDistanceInMeters** — heroes=42, unique=1, varies=false
- **EAirDashDuration** — heroes=42, unique=3, varies=true
- **EBaseHealthRegen** — heroes=42, unique=6, varies=true
- **EBuildUpRate** — heroes=1, unique=1, varies=false
- **EBulletLifesteal** — heroes=1, unique=1, varies=false
- **ECritDamageBonusScale** — heroes=42, unique=5, varies=true
- **ECritDamageReceivedScale** — heroes=42, unique=4, varies=true
- **ECrouchSpeed** — heroes=42, unique=1, varies=false
- **EDebuffResist** — heroes=1, unique=1, varies=false
- **EGroundDashDistanceInMeters** — heroes=42, unique=1, varies=false
- **EGroundDashDuration** — heroes=42, unique=3, varies=true
- **EHeavyMeleeDamage** — heroes=42, unique=4, varies=true
- **EHeroBulletLifestealEffectiveness** — heroes=42, unique=1, varies=false
- **EHeroSpiritLifestealEffectiveness** — heroes=42, unique=1, varies=false
- **ELightMeleeDamage** — heroes=42, unique=6, varies=true
- **EMaxHealth** — heroes=42, unique=14, varies=true
- **EMaxMoveSpeed** — heroes=42, unique=12, varies=true
- **EMeleeResist** — heroes=1, unique=1, varies=false
- **EMoveAcceleration** — heroes=42, unique=1, varies=false
- **EProcBuildUpRateScale** — heroes=42, unique=1, varies=false
- **EReloadSpeed** — heroes=42, unique=1, varies=false
- **ESprintSpeed** — heroes=42, unique=11, varies=true
- **EStamina** — heroes=42, unique=3, varies=true
- **EStaminaRegenPerSecond** — heroes=42, unique=5, varies=true
- **ETechArmorDamageReduction** — heroes=3, unique=2, varies=true
- **ETechDuration** — heroes=42, unique=1, varies=false
- **ETechRange** — heroes=42, unique=1, varies=false
- **EWeaponPower** — heroes=42, unique=1, varies=false
- **EWeaponPowerScale** — heroes=42, unique=1, varies=false

## Standard level / boon schema

- **MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL** — heroes=42, unique=37, varies=true
- **MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL_ALT_FIRE** — heroes=42, unique=5, varies=true
- **MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL** — heroes=42, unique=25, varies=true
- **MODIFIER_VALUE_BASE_MELEE_DAMAGE_FROM_LEVEL** — heroes=42, unique=4, varies=true
- **MODIFIER_VALUE_BONUS_ATTACK_RANGE** — heroes=42, unique=2, varies=true
- **MODIFIER_VALUE_BOON_COUNT** — heroes=42, unique=1, varies=false
- **MODIFIER_VALUE_BULLET_ARMOR_DAMAGE_RESIST** — heroes=42, unique=3, varies=true
- **MODIFIER_VALUE_TECH_DAMAGE_MULTIPLIER** — heroes=42, unique=1, varies=false
- **MODIFIER_VALUE_TECH_POWER** — heroes=42, unique=4, varies=true
- **MODIFIER_VALUE_TECH_RESIST** — heroes=42, unique=3, varies=true

## Special scaling relationships

- **Vindicta (3)** — ETechPower scale=0.022
- **Wraith (7)** — ETechPower scale=0.05
- **Haze (13)** — ETechPower scale=0.5
- **Grey Talon (17)** — ETechPower scale=0.0084
- **Grey Talon (17)** — ETechPower scale=0.08
- **Warden (25)** — ETechPower scale=0.01
- **Warden (25)** — ETechPower scale=0.25
- **Yamato (27)** — ETechPower scale=0.15
- **Venator (65)** — ETechPower scale=0.12178
- **Venator (65)** — ETechPower scale=0.12178
- **Victor (66)** — ETechPower scale=0.08
- **Paige (67)** — ETechPower scale=0.3
- **Fortuna (75)** — ETechPower scale=0.06

## Category investment consistency

- **WEAPON** — heroes=42, unique tables=1, universal in parsed cohort=true
- **VITALITY** — heroes=42, unique tables=1, universal in parsed cohort=true
- **SPIRIT** — heroes=42, unique tables=1, universal in parsed cohort=true

## Guardrail

These values describe hero/resource progression substrate. Effective PlayerState(t) still requires items, permanent buffs, temporary Powerups, ability/passive state, external buffs/debuffs, and any other modifier sources.

## Next stage

INSPECT_SCHEMA_THEN_DISCOVER_ITEM_PERMANENT_BUFF_POWERUP_AND_OTHER_STAT_MODIFIER_SOURCES
