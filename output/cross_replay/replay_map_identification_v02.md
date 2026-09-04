# Replay Map Identification V02

Status: **REPLAY_MAP_STRONGLY_RESOLVED_ALL_SIX_AGREE**

## V01 correction

V01 inspected `CNETMsg_SignonState.mapName`, but the Deadlock replay SignonState messages contained no map-name value.

V02 uses `DEM_FILE_HEADER / CDemoFileHeader.mapName` through the DEMO_PACKET interceptor as the primary replay map authority.

## Results

- **test:** start — DIRECT_DEMO_FILE_HEADER_MAP_NAME
- **rep01:** start — DIRECT_DEMO_FILE_HEADER_MAP_NAME
- **rep02:** start — DIRECT_DEMO_FILE_HEADER_MAP_NAME
- **rep03:** start — DIRECT_DEMO_FILE_HEADER_MAP_NAME
- **rep04:** start — DIRECT_DEMO_FILE_HEADER_MAP_NAME
- **rep05:** start — DIRECT_DEMO_FILE_HEADER_MAP_NAME

## Replication cohort

- Resolved: true
- Agreement: true
- Authoritative replication map: start

## Script119 audit

- Hardcoded map: dl_streets
- Matches replication map: false
- Disposition: **SCRIPT119_WRONG_MAP_FOR_REPLICATION_COHORT_DIAGNOSTIC_ONLY**

## Guardrail

The existence of a local VPK is not evidence that the replay used that map. Future LOS physics extraction must use the map identity declared by the replay header.

## Next stage

EXTRACT_WORLD_PHYSICS_FOR_REPLAY_DECLARED_MAP
