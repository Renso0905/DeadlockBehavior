# Deadlock Hero ID → Display Name Map V03

Status: **DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_REQUIRES_DIAGNOSIS**

## Source

- Installed local Deadlock `pak01_dir.vpk`.
- English files extracted temporarily from the `resource/localization` subtree with Source2Viewer.
- Temporary extracted localization resources are deleted after parsing.

## Identity semantics

- `heroId`: durable telemetry join key.
- `internalKey`: Valve internal/codename identity.
- `internalName`: human-readable internal identity.
- `displayName`: current English player-facing localization.

## Observed project heroes

- **Inferno (1)** — internal=Inferno, key=inferno, method=INTERNAL_NAME_FALLBACK
- **Gigawatt (2)** — internal=Gigawatt, key=gigawatt, method=INTERNAL_NAME_FALLBACK
- **Hornet (3)** — internal=Hornet, key=hornet, method=INTERNAL_NAME_FALLBACK
- **Ghost (4)** — internal=Ghost, key=ghost, method=INTERNAL_NAME_FALLBACK
- **Atlas (6)** — internal=Atlas, key=atlas, method=INTERNAL_NAME_FALLBACK
- **Wraith (7)** — internal=Wraith, key=wraith, method=INTERNAL_NAME_FALLBACK
- **Forge (8)** — internal=Forge, key=forge, method=INTERNAL_NAME_FALLBACK
- **Chrono (10)** — internal=Chrono, key=chrono, method=INTERNAL_NAME_FALLBACK
- **Dynamo (11)** — internal=Dynamo, key=dynamo, method=INTERNAL_NAME_FALLBACK
- **Haze (13)** — internal=Haze, key=haze, method=INTERNAL_NAME_FALLBACK
- **Astro (14)** — internal=Astro, key=astro, method=INTERNAL_NAME_FALLBACK
- **Bebop (15)** — internal=Bebop, key=bebop, method=INTERNAL_NAME_FALLBACK
- **Nano (16)** — internal=Nano, key=nano, method=INTERNAL_NAME_FALLBACK
- **Krill (18)** — internal=Krill, key=krill, method=INTERNAL_NAME_FALLBACK
- **Shiv (19)** — internal=Shiv, key=shiv, method=INTERNAL_NAME_FALLBACK
- **Warden (25)** — internal=Warden, key=warden, method=INTERNAL_NAME_FALLBACK
- **Yamato (27)** — internal=Yamato, key=yamato, method=INTERNAL_NAME_FALLBACK
- **Lash (31)** — internal=Lash, key=lash, method=INTERNAL_NAME_FALLBACK
- **Viscous (35)** — internal=Viscous, key=viscous, method=INTERNAL_NAME_FALLBACK
- **Synth (50)** — internal=Synth, key=synth, method=INTERNAL_NAME_FALLBACK
- **Viper (58)** — internal=Viper, key=viper, method=INTERNAL_NAME_FALLBACK
- **Magician (60)** — internal=Magician, key=magician, method=INTERNAL_NAME_FALLBACK
- **Vampirebat (63)** — internal=Vampirebat, key=vampirebat, method=INTERNAL_NAME_FALLBACK
- **Drifter (64)** — internal=Drifter, key=drifter, method=INTERNAL_NAME_FALLBACK
- **Priest (65)** — internal=Priest, key=priest, method=INTERNAL_NAME_FALLBACK
- **Frank (66)** — internal=Frank, key=frank, method=INTERNAL_NAME_FALLBACK
- **Bookworm (67)** — internal=Bookworm, key=bookworm, method=INTERNAL_NAME_FALLBACK
- **Doorman (69)** — internal=Doorman, key=doorman, method=INTERNAL_NAME_FALLBACK
- **Necro (76)** — internal=Necro, key=necro, method=INTERNAL_NAME_FALLBACK
- **Familiar (79)** — internal=Familiar, key=familiar, method=INTERNAL_NAME_FALLBACK
- **Unicorn (81)** — internal=Unicorn, key=unicorn, method=INTERNAL_NAME_FALLBACK

## Reporting convention

Future reports should display `Display Name (heroId)` while retaining the numeric ID and internal key in machine-readable data.

## Next stage

DIAGNOSE_ONLY_UNRESOLVED_HERO_LOCALIZATION_ROWS
