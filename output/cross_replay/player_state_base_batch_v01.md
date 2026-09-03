# Cross-Replay Player-State Base Extraction

Created: 2026-09-03T19:23:53.833Z

Cohort size: **5**

Succeeded: **5**

Failed: **0**

Base extraction ready: **false**

## Replay results

### rep01

- Status: EXTRACTION_PASS
- Success: true
- Replay size: 490.18 MiB
- Player-state size: 142.22 MiB
- Records: 113820
- Players: n/a
- Extraction duration: 19.43 sec

### rep02

- Status: EXTRACTION_PASS
- Success: true
- Replay size: 521.74 MiB
- Player-state size: 143.02 MiB
- Records: 113868
- Players: n/a
- Extraction duration: 20.83 sec

### rep03

- Status: EXTRACTION_PASS
- Success: true
- Replay size: 738.64 MiB
- Player-state size: 201.63 MiB
- Records: 161256
- Players: n/a
- Extraction duration: 28.59 sec

### rep04

- Status: EXTRACTION_PASS
- Success: true
- Replay size: 506.77 MiB
- Player-state size: 140.65 MiB
- Records: 112200
- Players: n/a
- Extraction duration: 19.49 sec

### rep05

- Status: EXTRACTION_PASS
- Success: true
- Replay size: 505.27 MiB
- Player-state size: 148.65 MiB
- Records: 118380
- Players: n/a
- Extraction duration: 20.06 sec

## Structural checks

- PASS — allReady
- FAIL — allHavePlayers
- PASS — allHaveRecords
- PASS — allHaveMatchClock
- PASS — allHaveStateFiles
- FAIL — baseExtractionReady

## Next stage

Parse each independent replay once for the event-centered Trooper, AssignedGold, economy, lifecycle, geometry, and shot-direction telemetry required by the frozen Script 99 replication contract.
