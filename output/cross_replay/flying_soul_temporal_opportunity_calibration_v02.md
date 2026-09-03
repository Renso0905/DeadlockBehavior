# Flying-Soul Temporal Opportunity Calibration V0.2

Status: **FLYING_SOUL_TEMPORAL_SUBSTRATE_READY_SHOT_TIMING_AVAILABLE**

## V01 correction

V01 failed because `ENTITY_INDEX_MASK` was referenced before its `const` declaration had executed. V02 moves the constant above the main execution path. No replay telemetry or prior analytical result was invalidated.

## Temporal model

`launch -> attackable start -> attackable end -> lifecycle resolution`

The approximately 80 ms securing-side priority advantage remains an external documented prior rather than an exact replay-derived lockout duration.

## Replay results

### rep01

- Source-linked flying souls: 600
- Timing coverage: 100.00%
- Launch -> attackable median: 0.65 sec
- Attackable duration median: 0.7 sec
- Matched source-linked CItemXP damage events: 4
- Secure hits: 2
- Deny hits: 2
- Mixed-team races: 1
- Timing ready: **true**
- Hit telemetry ready: **true**

### rep02

- Source-linked flying souls: 681
- Timing coverage: 100.00%
- Launch -> attackable median: 0.65 sec
- Attackable duration median: 0.7 sec
- Matched source-linked CItemXP damage events: 6
- Secure hits: 3
- Deny hits: 3
- Mixed-team races: 1
- Timing ready: **true**
- Hit telemetry ready: **true**

### rep03

- Source-linked flying souls: 1080
- Timing coverage: 100.00%
- Launch -> attackable median: 0.65 sec
- Attackable duration median: 0.7 sec
- Matched source-linked CItemXP damage events: 8
- Secure hits: 4
- Deny hits: 4
- Mixed-team races: 0
- Timing ready: **true**
- Hit telemetry ready: **true**

### rep04

- Source-linked flying souls: 753
- Timing coverage: 100.00%
- Launch -> attackable median: 0.65 sec
- Attackable duration median: 0.7 sec
- Matched source-linked CItemXP damage events: 9
- Secure hits: 2
- Deny hits: 7
- Mixed-team races: 0
- Timing ready: **true**
- Hit telemetry ready: **true**

### rep05

- Source-linked flying souls: 648
- Timing coverage: 100.00%
- Launch -> attackable median: 0.65 sec
- Attackable duration median: 0.7 sec
- Matched source-linked CItemXP damage events: 0
- Secure hits: 0
- Deny hits: 0
- Mixed-team races: 0
- Timing ready: **true**
- Hit telemetry ready: **false**

## Behavioral interpretation

Secure and deny opportunity timing must remain role-specific. A living player near an orb is not automatically an actionable opportunity.

The eventual model should compare the player/hero weapon system’s earliest mechanically achievable impact time against the securing-side priority interval and subsequent contest window.
