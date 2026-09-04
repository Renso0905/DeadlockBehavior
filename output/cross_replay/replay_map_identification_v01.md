# Replay Map Identification

Status: **REPLAY_MAP_UNRESOLVED**

## Primary authority

`CNETMsg_SignonState.mapName` from each replay.

## Results

- **test:** UNRESOLVED
- **rep01:** UNRESOLVED
- **rep02:** UNRESOLVED
- **rep03:** UNRESOLVED
- **rep04:** UNRESOLVED
- **rep05:** UNRESOLVED

## Replication cohort

- Common replication map: UNRESOLVED
- Five-replay agreement: false
- All six replay agreement: false

## Script119 audit

- Hardcoded Script119 map: dl_streets
- Matches replication replay map: null
- Disposition: **SCRIPT119_MAP_ASSOCIATION_REMAINS_UNRESOLVED**

## Guardrail

No map physics resource should be used for LOS simply because it exists in the local Deadlock installation. It must correspond to the map declared by the replay.

## Next stage

DIAGNOSE_REPLAY_MAP_METADATA
