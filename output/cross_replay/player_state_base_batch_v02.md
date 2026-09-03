# Cross-Replay Player-State Base Extraction V0.2

Created: 2026-09-03T19:27:25.458Z

## V01 correction

Script101 V01 failed to recognize the authoritative Script03 `playersSeen` summary field. Replay telemetry itself was unaffected and no re-extraction was required.

Cohort size: **5**

Succeeded: **5**

Failed: **0**

Base extraction ready: **true**

## Replay results

### rep01

- Status: SKIPPED_EXISTING_VALID
- Success: true
- Records: 113820
- Players: 12
- State size: 142.22 MiB
- Match time: -29.75 -> 2341.25 sec

### rep02

- Status: SKIPPED_EXISTING_VALID
- Success: true
- Records: 113868
- Players: 12
- State size: 143.02 MiB
- Match time: -29.75 -> 2342.75 sec

### rep03

- Status: SKIPPED_EXISTING_VALID
- Success: true
- Records: 161256
- Players: 12
- State size: 201.63 MiB
- Match time: -29.75 -> 3329.5 sec

### rep04

- Status: SKIPPED_EXISTING_VALID
- Success: true
- Records: 112200
- Players: 12
- State size: 140.65 MiB
- Match time: -29.75 -> 2307.5 sec

### rep05

- Status: SKIPPED_EXISTING_VALID
- Success: true
- Records: 118380
- Players: 12
- State size: 148.65 MiB
- Match time: -29.75 -> 2437.25 sec

## Structural checks

- PASS — allReady
- PASS — allHavePlayers
- PASS — allHaveExpectedPlayerCount
- PASS — allHaveRecords
- PASS — allHaveMatchClock
- PASS — allHaveStateFiles
- PASS — allReplayNamesAgree
- PASS — baseExtractionReady
