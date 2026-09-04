# Deadlock Hero ID → Display Name Map V04

Status: **DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_REQUIRES_DIAGNOSIS**

## Source

- Local installed Deadlock `pak01_dir.vpk`.
- Entire `resource` subtree temporarily decompiled with Source2Viewer.
- English localization files discovered recursively after decompilation.
- Temporary extracted resources deleted after parsing.

## Identity semantics

- `heroId` = durable telemetry join key.
- `internalKey` = Valve internal/codename resource identity.
- `internalName` = human-readable internal identity.
- `displayName` = current player-facing English localization.

## Observed project heroes

- **Inferno (1)** — internal=Inferno, key=inferno, source=UNRESOLVED
- **Gigawatt (2)** — internal=Gigawatt, key=gigawatt, source=UNRESOLVED
- **Hornet (3)** — internal=Hornet, key=hornet, source=UNRESOLVED
- **Ghost (4)** — internal=Ghost, key=ghost, source=UNRESOLVED
- **Atlas (6)** — internal=Atlas, key=atlas, source=UNRESOLVED
- **Wraith (7)** — internal=Wraith, key=wraith, source=UNRESOLVED
- **Forge (8)** — internal=Forge, key=forge, source=UNRESOLVED
- **Chrono (10)** — internal=Chrono, key=chrono, source=UNRESOLVED
- **Dynamo (11)** — internal=Dynamo, key=dynamo, source=UNRESOLVED
- **Haze (13)** — internal=Haze, key=haze, source=UNRESOLVED
- **Astro (14)** — internal=Astro, key=astro, source=UNRESOLVED
- **Bebop (15)** — internal=Bebop, key=bebop, source=UNRESOLVED
- **Nano (16)** — internal=Nano, key=nano, source=UNRESOLVED
- **Krill (18)** — internal=Krill, key=krill, source=UNRESOLVED
- **Shiv (19)** — internal=Shiv, key=shiv, source=UNRESOLVED
- **Warden (25)** — internal=Warden, key=warden, source=UNRESOLVED
- **Yamato (27)** — internal=Yamato, key=yamato, source=UNRESOLVED
- **Lash (31)** — internal=Lash, key=lash, source=UNRESOLVED
- **Viscous (35)** — internal=Viscous, key=viscous, source=UNRESOLVED
- **Synth (50)** — internal=Synth, key=synth, source=UNRESOLVED
- **Viper (58)** — internal=Viper, key=viper, source=UNRESOLVED
- **Magician (60)** — internal=Magician, key=magician, source=UNRESOLVED
- **Vampirebat (63)** — internal=Vampirebat, key=vampirebat, source=UNRESOLVED
- **Drifter (64)** — internal=Drifter, key=drifter, source=UNRESOLVED
- **Priest (65)** — internal=Priest, key=priest, source=UNRESOLVED
- **Frank (66)** — internal=Frank, key=frank, source=UNRESOLVED
- **Bookworm (67)** — internal=Bookworm, key=bookworm, source=UNRESOLVED
- **Doorman (69)** — internal=Doorman, key=doorman, source=UNRESOLVED
- **Necro (76)** — internal=Necro, key=necro, source=UNRESOLVED
- **Familiar (79)** — internal=Familiar, key=familiar, source=UNRESOLVED
- **Unicorn (81)** — internal=Unicorn, key=unicorn, source=UNRESOLVED

## Reporting convention

All future human-readable analyses should use `Display Name (heroId)` while preserving the numeric ID and internal key in machine-readable output.

## Next stage

DIAGNOSE_ONLY_UNRESOLVED_HERO_DISPLAY_NAMES
