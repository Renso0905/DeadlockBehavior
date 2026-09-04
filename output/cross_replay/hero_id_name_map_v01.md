# Deadlock Hero ID → Name Map V01

Status: **DEADLOCK_HERO_ID_NAME_MAP_READY**

## Source

- Local installed Deadlock `pak01_dir.vpk`.
- `scripts/heroes.vdata_c` decompiled with Source2Viewer.
- Temporary decompiled game resource deleted after parsing.

## Observed project heroes

- Inferno (1)
- Gigawatt (2)
- Hornet (3)
- Ghost (4)
- Atlas (6)
- Wraith (7)
- Forge (8)
- Chrono (10)
- Dynamo (11)
- Haze (13)
- Astro (14)
- Bebop (15)
- Nano (16)
- Krill (18)
- Shiv (19)
- Warden (25)
- Yamato (27)
- Lash (31)
- Viscous (35)
- Synth (50)
- Viper (58)
- Magician (60)
- Vampirebat (63)
- Drifter (64)
- Priest (65)
- Frank (66)
- Bookworm (67)
- Doorman (69)
- Necro (76)
- Familiar (79)
- Unicorn (81)

## Usage

Keep the numeric `heroId` as the durable join key. Use `heroName` for human-readable reports and console output.

Recommended display form: `Hero Name (ID)`.

## Next stage

USE_THIS_LOOKUP_IN_ALL_SUBSEQUENT_REPORTS_THEN_RETURN_TO_SHOT_TRAVEL_CROSS_REPLAY_AUDIT
