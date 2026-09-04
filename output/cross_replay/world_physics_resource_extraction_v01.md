# Deadlock World-Physics Resource Extraction

Status: **WORLD_PHYSICS_RESOURCE_EXTRACTED_CUSTOM_PHYSICS_MESH_EXTRACTION_REQUIRED**

## Purpose

Prepare the dedicated static-world physics resource needed to distinguish genuine player-to-soul line of sight from proximity/orientation cases blocked by buildings or other map architecture.

No LOS or opportunity classifications are produced by this script.

## Frozen map resource

- Map: dl_streets
- VPK: `G:\SteamLibrary\steamapps\common\Deadlock\game\citadel\maps\dl_streets.vpk`
- VPK SHA256: `b11b9e6429b1a73be2bcc201fc0e8b64dc4caf3c8ad0ad31614edc28aad0a07c`
- world_physics SHA256: `8e06625a4cfe0e99bddcd7092a441db372766ac6b33305ef8132dad232195536`

## World physics export

- GLB exists: true
- GLB valid: true
- Meshes: 0
- Primitives: 0
- POSITION vertices: 0
- Indexed-triangle diagnostic: 0

## Interpretation

The dedicated map world-physics resource is the appropriate candidate source for static building-level occlusion.

No exported mesh is accepted as LOS collision merely because it came from world_physics.vmdl_c. Its coordinates and raycast behavior must be validated against replay positions and observed successful soul hits.

## Next stage

BUILD_DIRECT_PHYSAGGREGATE_EXTRACTION_FROM_WORLD_PHYSICS_VMDL
