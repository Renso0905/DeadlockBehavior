# Replay Map Identification V03

Replay: **test**
Status: **REPLAY_GAMEPLAY_MAP_RESOURCE_IDENTITY_UNRESOLVED**

## V02 correction

The demo header reports `start`. This value is treated as a generic/bootstrap marker rather than gameplay-map identity.

## Map-resource candidates

- **dl_midtown** — count=46; source layers=RAW_ASCII
- **dl_midtown_pulse** — count=46; source layers=DEMO_PACKET

## Resolution

- Resolved map: UNRESOLVED
- Resolution status: MULTIPLE_DL_MAP_RESOURCE_CANDIDATES_REQUIRE_CONTEXT

## Guardrail

Map identity is not inferred from replay date or from whichever map archives happen to exist in the current local installation.

No LOS classifications or actionable-opportunity labels are produced.

## Next stage

INSPECT_STRING_TABLE_AND_RESOURCE_EVIDENCE_DIAGNOSTIC
