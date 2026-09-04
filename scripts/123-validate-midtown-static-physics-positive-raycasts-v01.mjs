import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

import {
  createInterface
} from 'node:readline';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'DL_MIDTOWN_STATIC_PHYSICS_POSITIVE_RAYCAST_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// Script122 recovered the dedicated dl_midtown embedded physics
// GLB with ~3.46 million collision triangles.
//
// Script123 performs the FIRST static-world collision validation.
//
// Positive controls are Script116 successful soul-hit anchors.
// If an observed successful hit is reconstructed as passing
// through a static building/wall, then at least one of these is
// wrong or incomplete:
//
//   - collision-mesh selection
//   - collision-tag filtering
//   - coordinate interpretation
//   - player firing-origin proxy
//   - replay/map-version alignment
//   - projectile path assumption
//
// IMPORTANT:
//
// This script does NOT classify all Script117 candidates as LOS.
// It does NOT create actionable-opportunity labels.
//
// It validates a STATIC PROJECTILE-PATH substrate only.
// Dynamic doors, breakables, temporary walls, hero weapon state,
// visual attention, and exact muzzle origin remain later layers.
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const GRID_CELL_SIZE_HU =
  1024;


const MAX_CELLS_PER_TRIANGLE =
  256;


// Pawn world position is not an exact eye/muzzle origin.
// We therefore test several explicitly labeled vertical probes.
const ORIGIN_Z_OFFSETS_HU =
  [
    0,
    48,
    64,
    80
  ];


const PRIMARY_ORIGIN_Z_OFFSET_HU =
  64;


const START_CLEARANCE_HU =
  4;


const TARGET_CLEARANCE_HU =
  4;


const VALIDATION =
  {
    minimumAnchorPlayerInsideRawPhysicsBoundsRate:
      0.99,

    minimumAnchorOrbInsideRawPhysicsBoundsRate:
      0.99,

    minimumPrimaryClearRateOverall:
      0.95,

    minimumPrimaryClearRatePerReplay:
      0.90
  };


// ============================================================
// COLLISION FILTERS
//
// Mesh names are generated from Source 2 physics interaction
// tags/surface properties by ValveResourceFormat.
//
// We intentionally test several filters instead of declaring
// every physics triangle bullet-blocking.
// ============================================================

const FILTERS =
  [
    {
      name:
        'ALL_PHYSICS',

      bit:
        1
    },

    {
      name:
        'EXCLUDE_PASSBULLETS',

      bit:
        2
    },

    {
      name:
        'BULLET_SOLID_CANDIDATE',

      bit:
        4
    },

    {
      name:
        'STRICT_SOLID_OR_DEFAULT_GROUP',

      bit:
        8
    }
  ];


const PRIMARY_FILTER =
  'BULLET_SOLID_CANDIDATE';


// ============================================================
// PATHS
// ============================================================

const SCRIPT122_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_world_physics_extraction_v01.json'
  );


const SCRIPT116_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_positive_actionability_anchors_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_static_physics_positive_raycast_validation_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_static_physics_positive_raycast_validation_v01.md'
  );


const OUTPUT_ANCHORS_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_static_physics_positive_raycast_anchors_v01.jsonl'
  );


// ============================================================
// INPUT GUARDS
// ============================================================

for (
  const path
  of [
    SCRIPT122_PATH,
    SCRIPT116_PATH
  ]
) {

  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing required input:\n${path}`
    );
  }
}


const script122 =
  JSON.parse(
    readFileSync(
      SCRIPT122_PATH,
      'utf8'
    )
  );


const script116 =
  JSON.parse(
    readFileSync(
      SCRIPT116_PATH,
      'utf8'
    )
  );


if (
  script122?.status !==
  'DL_MIDTOWN_WORLD_PHYSICS_GLB_CANDIDATE_READY'
) {

  throw new Error(
    `Script122 physics substrate not ready.\nStatus: ${script122?.status}`
  );
}


if (
  script116?.status !==
  'FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_READY'
) {

  throw new Error(
    `Script116 positive anchors not ready.\nStatus: ${script116?.status}`
  );
}


const physicsGlbPath =
  script122
    ?.glbExport
    ?.embeddedPhysicsGlb
    ?.path;


if (
  !physicsGlbPath
  ||
  !existsSync(
    physicsGlbPath
  )
) {

  throw new Error(
    `Physics GLB not found:\n${physicsGlbPath ?? 'UNRESOLVED'}`
  );
}


const replayNames =
  Array.isArray(
    script116?.replays
  )
    ? script116.replays
        .map(
          row =>
            row.replay
        )
        .filter(
          Boolean
        )
    : [];


if (
  replayNames.length ===
  0
) {

  throw new Error(
    'No Script116 replay cohort found.'
  );
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'MIDTOWN STATIC PHYSICS POSITIVE RAYCAST VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'PURPOSE'
);

console.log(
  '-------'
);

console.log(
  'Validate static-world collision against observed successful'
);

console.log(
  'flying-soul hit paths before applying LOS to nonresponses.'
);

console.log('');

console.log(
  `Physics GLB:              ${physicsGlbPath}`
);

console.log(
  `Positive-control replays: ${replayNames.length}`
);

console.log(
  'All-candidate LOS:         NONE'
);

console.log(
  'Opportunity classification:NONE'
);

console.log('');


// ============================================================
// LOAD GLB
// ============================================================

console.log(
  'Loading physics GLB...'
);


const glb =
  loadGlb(
    physicsGlbPath
  );


const primitiveReaders =
  buildPrimitiveReaders(
    glb
  );


if (
  primitiveReaders.length ===
  0
) {

  throw new Error(
    'No triangle primitives found in physics GLB.'
  );
}


const rawPhysicsBounds =
  aggregatePrimitiveBounds(
    primitiveReaders
  );


const nodeTransformSummary =
  summarizePhysicsNodeTransforms(
    glb.json,
    primitiveReaders
  );


console.log('');

console.log(
  'PHYSICS GLB'
);

console.log(
  '-----------'
);

console.log(
  `meshes/primitives:        ${primitiveReaders.length}`
);

console.log(
  `triangles:                ${sum(
    primitiveReaders.map(
      row =>
        row.triangleCount
    )
  )}`
);

console.log(
  `raw POSITION bounds:      ${formatBounds(
    rawPhysicsBounds
  )}`
);

console.log(
  `unique node matrices:     ${nodeTransformSummary.uniqueMatrixCount}`
);

console.log('');

console.log(
  'COLLISION FILTER MEMBERSHIP'
);

console.log(
  '---------------------------'
);


for (
  const row
  of summarizePrimitiveFilters(
    primitiveReaders
  )
) {

  console.log(
    `${row.filter.padEnd(32)} meshes=${String(row.meshes).padEnd(4)} triangles=${row.triangles}`
  );
}


// ============================================================
// BUILD SPATIAL INDEX
// ============================================================

console.log('');

console.log(
  'Building static-world triangle grid...'
);


const grid =
  buildTriangleGrid({
    primitiveReaders,

    bounds:
      rawPhysicsBounds,

    cellSize:
      GRID_CELL_SIZE_HU,

    maxCellsPerTriangle:
      MAX_CELLS_PER_TRIANGLE
  });


console.log('');

console.log(
  'SPATIAL INDEX'
);

console.log(
  '-------------'
);

console.log(
  `cell size:                ${GRID_CELL_SIZE_HU} HU`
);

console.log(
  `dimensions:               ${grid.nx} x ${grid.ny} x ${grid.nz}`
);

console.log(
  `cells:                    ${grid.cellCount}`
);

console.log(
  `triangle-cell assignments:${grid.members.length}`
);

console.log(
  `large triangles:          ${grid.largeTriangles.length}`
);

console.log('');


// ============================================================
// LOAD POSITIVE ANCHORS
// ============================================================

const anchors =
  [];


for (
  const replayName
  of replayNames
) {

  const path =
    resolve(
      'output',
      replayName,
      'flying_soul_positive_actionability_anchors_v01.jsonl'
    );


  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing Script116 anchor file:\n${path}`
    );
  }


  const replayAnchors =
    await loadJsonl(
      path
    );


  for (
    const row
    of replayAnchors
  ) {

    const playerPosition =
      normalizePosition(
        row?.playerState?.position
      );


    const orbPosition =
      normalizePosition(
        row?.orbState?.position
      );


    if (
      !playerPosition
      ||
      !orbPosition
    ) {

      continue;
    }


    anchors.push(
      {
        replay:
          replayName,

        anchorId:
          row.anchorId
          ??
          `${replayName}|${row?.event?.eventId}|${row?.observedSuccessfulInteraction?.attackerPlayerName}|${row?.observedSuccessfulInteraction?.hitTick}`,

        eventId:
          row?.event?.eventId
          ??
          null,

        hitTick:
          finite(
            row?.observedSuccessfulInteraction?.hitTick
          ),

        playerName:
          row?.observedSuccessfulInteraction?.attackerPlayerName
          ??
          null,

        heroId:
          finite(
            row?.observedSuccessfulInteraction?.attackerHeroId
          ),

        relation:
          row?.observedSuccessfulInteraction?.relation
          ??
          null,

        playerStateMethod:
          row?.playerState?.method
          ??
          null,

        playerPosition,

        orbPosition
      }
    );
  }
}


if (
  anchors.length ===
  0
) {

  throw new Error(
    'No usable positive anchors.'
  );
}


console.log(
  `Positive anchors loaded:  ${anchors.length}`
);

console.log('');


// ============================================================
// COORDINATE-SPACE VALIDATION
//
// VRF physics GLB accessors retain source-like coordinates and
// apply Source->glTF conversion at the node transform. Therefore
// replay Source coordinates should fall directly within raw
// POSITION accessor bounds if this interpretation is correct.
// ============================================================

let playersInsideRawBounds =
  0;


let orbsInsideRawBounds =
  0;


for (
  const anchor
  of anchors
) {

  if (
    pointInsideBounds(
      anchor.playerPosition,
      rawPhysicsBounds
    )
  ) {

    playersInsideRawBounds++;
  }


  if (
    pointInsideBounds(
      anchor.orbPosition,
      rawPhysicsBounds
    )
  ) {

    orbsInsideRawBounds++;
  }
}


const playerInsideRate =
  rate(
    playersInsideRawBounds,
    anchors.length
  );


const orbInsideRate =
  rate(
    orbsInsideRawBounds,
    anchors.length
  );


console.log(
  'RAW SOURCE-SPACE BOUNDS CHECK'
);

console.log(
  '-----------------------------'
);

console.log(
  `player positions inside:    ${playersInsideRawBounds}/${anchors.length} (${formatPercent(playerInsideRate)})`
);

console.log(
  `orb positions inside:       ${orbsInsideRawBounds}/${anchors.length} (${formatPercent(orbInsideRate)})`
);

console.log('');


// ============================================================
// RAYCAST POSITIVE CONTROLS
// ============================================================

console.log(
  'Raycasting successful-hit positive controls...'
);

console.log('');


const aggregateStats =
  createStatsCollection();


const replayStats =
  new Map();


for (
  const replayName
  of replayNames
) {

  replayStats.set(
    replayName,
    createStatsCollection()
  );
}


const roleStats =
  new Map();


for (
  const role
  of [
    'SECURE_HIT',
    'DENY_HIT'
  ]
) {

  roleStats.set(
    role,
    createStatsCollection()
  );
}


const outputRows =
  [];


let anchorIndex =
  0;


for (
  const anchor
  of anchors
) {

  anchorIndex++;


  if (
    anchorIndex ===
    1
    ||
    anchorIndex %
      50 ===
    0
    ||
    anchorIndex ===
    anchors.length
  ) {

    console.log(
      `  anchor ${anchorIndex}/${anchors.length}`
    );
  }


  const probes =
    [];


  for (
    const zOffset
    of ORIGIN_Z_OFFSETS_HU
  ) {

    const start =
      {
        x:
          anchor.playerPosition.x,

        y:
          anchor.playerPosition.y,

        z:
          anchor.playerPosition.z
          +
          zOffset
      };


    const end =
      anchor.orbPosition;


    const rayResult =
      raycastSegmentAllFilters({
        start,

        end,

        grid,

        primitiveReaders,

        startClearanceHU:
          START_CLEARANCE_HU,

        targetClearanceHU:
          TARGET_CLEARANCE_HU
      });


    const filterResults =
      {};


    for (
      const filter
      of FILTERS
    ) {

      const hit =
        rayResult[
          filter.name
        ];


      const blocked =
        Boolean(
          hit
        );


      const result =
        {
          blocked,

          clear:
            !blocked,

          blockerMesh:
            hit?.meshName
            ??
            null,

          blockerPrimitiveIndex:
            hit?.primitiveReaderIndex
            ??
            null,

          blockerTriangleId:
            hit?.triangleId
            ??
            null,

          intersectionFraction:
            hit?.t
            ??
            null,

          intersectionDistanceHU:
            hit?.distanceHU
            ??
            null,

          distanceRemainingToOrbHU:
            hit
              ? hit.segmentLengthHU
                -
                hit.distanceHU
              : null
        };


      filterResults[
        filter.name
      ] =
        result;


      updateStatsCollection({
        collection:
          aggregateStats,

        zOffset,

        filterName:
          filter.name,

        result
      });


      updateStatsCollection({
        collection:
          replayStats.get(
            anchor.replay
          ),

        zOffset,

        filterName:
          filter.name,

        result
      });


      if (
        roleStats.has(
          anchor.relation
        )
      ) {

        updateStatsCollection({
          collection:
            roleStats.get(
              anchor.relation
            ),

          zOffset,

          filterName:
            filter.name,

          result
        });
      }
    }


    probes.push(
      {
        originSemanticStatus:
          zOffset ===
          0
            ? 'PAWN_WORLD_ORIGIN_DIAGNOSTIC_NOT_MUZZLE'
            : `PAWN_WORLD_ORIGIN_PLUS_${zOffset}_HU_VERTICAL_PROBE_NOT_MUZZLE`,

        zOffsetHU:
          zOffset,

        start,

        end,

        segmentLengthHU:
          distance3D(
            start,
            end
          ),

        filters:
          filterResults
      }
    );
  }


  outputRows.push(
    {
      schemaVersion:
        1,

      canonical:
        false,

      replay:
        anchor.replay,

      anchorId:
        anchor.anchorId,

      eventId:
        anchor.eventId,

      hitTick:
        anchor.hitTick,

      playerName:
        anchor.playerName,

      heroId:
        anchor.heroId,

      relation:
        anchor.relation,

      playerStateMethod:
        anchor.playerStateMethod,

      coordinateChecks:
        {
          playerInsideRawPhysicsBounds:
            pointInsideBounds(
              anchor.playerPosition,
              rawPhysicsBounds
            ),

          orbInsideRawPhysicsBounds:
            pointInsideBounds(
              anchor.orbPosition,
              rawPhysicsBounds
            )
        },

      probes,

      interpretation:
        {
          positiveControl:
            true,

          semanticStatus:
            'OBSERVED_SUCCESSFUL_HIT_STATIC_PATH_VALIDATION_ONLY',

          warning:
            'Blocked result may still reflect firing-origin proxy, projectile travel timing, collision-filter mismatch, map-version drift, or dynamic-state mismatch. It is not automatically evidence the observed hit was impossible.'
        }
    }
  );
}


// ============================================================
// FINALIZE STATS
// ============================================================

const aggregateSummary =
  finalizeStatsCollection(
    aggregateStats
  );


const replaySummary =
  Object.fromEntries(
    replayNames.map(
      replayName =>
        [
          replayName,

          finalizeStatsCollection(
            replayStats.get(
              replayName
            )
          )
        ]
    )
  );


const roleSummary =
  Object.fromEntries(
    [
      ...roleStats.entries()
    ].map(
      ([
        role,
        collection
      ]) =>
        [
          role,

          finalizeStatsCollection(
            collection
          )
        ]
    )
  );


const primaryKey =
  statsKey(
    PRIMARY_ORIGIN_Z_OFFSET_HU,
    PRIMARY_FILTER
  );


const primaryOverall =
  aggregateSummary[
    primaryKey
  ];


const primaryPerReplay =
  Object.fromEntries(
    replayNames.map(
      replayName =>
        [
          replayName,

          replaySummary[
            replayName
          ][
            primaryKey
          ]
        ]
    )
  );


// ============================================================
// VALIDATION
// ============================================================

const checks =
  {
    playerRawBoundsCoverage:
      {
        actual:
          playerInsideRate,

        expected:
          `>=${VALIDATION.minimumAnchorPlayerInsideRawPhysicsBoundsRate}`,

        pass:
          playerInsideRate >=
          VALIDATION.minimumAnchorPlayerInsideRawPhysicsBoundsRate
      },


    orbRawBoundsCoverage:
      {
        actual:
          orbInsideRate,

        expected:
          `>=${VALIDATION.minimumAnchorOrbInsideRawPhysicsBoundsRate}`,

        pass:
          orbInsideRate >=
          VALIDATION.minimumAnchorOrbInsideRawPhysicsBoundsRate
      },


    primaryPositiveControlClearRateOverall:
      {
        actual:
          primaryOverall?.clearRate
          ??
          null,

        expected:
          `>=${VALIDATION.minimumPrimaryClearRateOverall}`,

        pass:
          Number.isFinite(
            primaryOverall?.clearRate
          )
          &&
          primaryOverall.clearRate >=
          VALIDATION.minimumPrimaryClearRateOverall
      },


    primaryPositiveControlClearRateEveryReplay:
      {
        actual:
          Object.fromEntries(
            replayNames.map(
              replayName =>
                [
                  replayName,

                  primaryPerReplay[
                    replayName
                  ]?.clearRate
                  ??
                  null
                ]
            )
          ),

        expected:
          `each >=${VALIDATION.minimumPrimaryClearRatePerReplay}`,

        pass:
          replayNames.every(
            replayName =>
              Number.isFinite(
                primaryPerReplay[
                  replayName
                ]?.clearRate
              )
              &&
              primaryPerReplay[
                replayName
              ].clearRate >=
              VALIDATION.minimumPrimaryClearRatePerReplay
          )
      }
  };


const validationPass =
  Object.values(
    checks
  ).every(
    row =>
      row.pass
  );


const status =
  validationPass
    ? 'DL_MIDTOWN_STATIC_PROJECTILE_RAYCAST_POSITIVE_CONTROL_READY'
    : 'DL_MIDTOWN_STATIC_PROJECTILE_RAYCAST_REQUIRES_DIAGNOSIS';


const nextStage =
  validationPass
    ? 'SEPARATE_STATIC_VISUAL_OCCLUSION_FROM_PROJECTILE_BLOCKING_AND_ADD_DYNAMIC_OCCLUDER_STATE'
    : 'DIAGNOSE_BLOCKED_SUCCESSFUL_HITS_BY_MESH_TAG_ORIGIN_PROXY_AND_MAP_VERSION';


// ============================================================
// BLOCKER DIAGNOSTICS
// ============================================================

const primaryBlockers =
  primaryOverall?.blockerMeshes
  ??
  {};


const bestProbeRows =
  Object.values(
    aggregateSummary
  )
    .filter(
      row =>
        row.zOffsetHU !==
        0
    )
    .sort(
      (a, b) =>
        b.clearRate
        -
        a.clearRate
        ||
        a.zOffsetHU
        -
        b.zOffsetHU
        ||
        a.filter.localeCompare(
          b.filter
        )
    );


// ============================================================
// SUMMARY
// ============================================================

const summary =
  {
    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    status,

    map:
      {
        name:
          'dl_midtown',

        vpkSha256:
          script122?.mapVpk?.sha256
          ??
          null,

        worldPhysicsSha256:
          script122?.extraction?.worldPhysicsSha256
          ??
          null,

        physicsGlbPath
      },

    coordinateInterpretation:
      {
        method:
          'RAYCAST_REPLAY_SOURCE_COORDINATES_DIRECTLY_AGAINST_RAW_GLTF_POSITION_ACCESSORS',

        rationale:
          'ValveResourceFormat leaves physics vertices in Source-space local coordinates and applies Source->glTF scale/rotation at the node transform. Script123 therefore does not apply the glTF node matrix to the raw POSITION accessor data for replay-space raycasts.',

        rawPhysicsBounds,

        nodeTransformSummary,

        positiveAnchorBoundsCoverage:
          {
            anchors:
              anchors.length,

            playersInside:
              playersInsideRawBounds,

            playerRate:
              playerInsideRate,

            orbsInside:
              orbsInsideRawBounds,

            orbRate:
              orbInsideRate
          }
      },

    spatialIndex:
      {
        cellSizeHU:
          GRID_CELL_SIZE_HU,

        maxCellsPerTriangle:
          MAX_CELLS_PER_TRIANGLE,

        dimensions:
          {
            x:
              grid.nx,

            y:
              grid.ny,

            z:
              grid.nz
          },

        cells:
          grid.cellCount,

        totalTriangles:
          grid.totalTriangles,

        assignments:
          grid.members.length,

        largeTriangles:
          grid.largeTriangles.length
      },

    collisionFilters:
      summarizePrimitiveFilters(
        primitiveReaders
      ),

    originProbes:
      {
        offsetsHU:
          ORIGIN_Z_OFFSETS_HU,

        primaryOffsetHU:
          PRIMARY_ORIGIN_Z_OFFSET_HU,

        semanticGuardrail:
          'These are vertical firing-origin probes above pawn world origin, not validated hero muzzle/eye origins.'
      },

    positiveControls:
      {
        anchors:
          anchors.length,

        aggregate:
          aggregateSummary,

        byReplay:
          replaySummary,

        byRole:
          roleSummary,

        primary:
          {
            key:
              primaryKey,

            filter:
              PRIMARY_FILTER,

            zOffsetHU:
              PRIMARY_ORIGIN_Z_OFFSET_HU,

            overall:
              primaryOverall,

            byReplay:
              primaryPerReplay,

            blockerMeshes:
              primaryBlockers
          },

        bestDescriptiveProbePairs:
          bestProbeRows.slice(
            0,
            12
          )
      },

    validation:
      {
        pass:
          validationPass,

        thresholds:
          VALIDATION,

        checks
      },

    interpretation:
      {
        establishedIfPass:
          'A replay-coordinate static projectile-path raycast against selected Midtown world-physics triangles is consistent with observed successful soul-hit positive controls at the stated validation thresholds.',

        notEstablished:
          [
            'Exact hero muzzle or eye origin.',
            'Visual visibility/opacity semantics.',
            'Dynamic doors, breakables, temporary walls, props, or player bodies.',
            'Weapon readiness or projectile travel timing.',
            'Actionable opportunity for Script117 nonresponders.',
            'Avoidable secure/deny loss.'
          ],

        collisionTagGuardrail:
          'The world-physics GLB contains interaction classes such as passbullets, blocklos, foliage, playerclip, and solid. All physics triangles are therefore not semantically interchangeable.',

        positiveControlGuardrail:
          'A blocked successful-hit ray is a diagnostic contradiction, not proof that the replay hit or physics mesh is wrong. Approximate firing origin and impact-time player position are known sources of disagreement.'
      },

    nextStage,

    outputs:
      {
        json:
          OUTPUT_JSON_PATH,

        anchors:
          OUTPUT_ANCHORS_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    OUTPUT_JSON_PATH
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  OUTPUT_JSON_PATH,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


await writeJsonl(
  OUTPUT_ANCHORS_PATH,
  outputRows
);


writeFileSync(
  OUTPUT_MARKDOWN_PATH,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// CONSOLE SUMMARY
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'STATIC PHYSICS POSITIVE-CONTROL SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'PROBE RESULTS'
);

console.log(
  '-------------'
);


for (
  const zOffset
  of ORIGIN_Z_OFFSETS_HU
) {

  console.log('');

  console.log(
    `Origin Z +${zOffset} HU`
  );


  for (
    const filter
    of FILTERS
  ) {

    const row =
      aggregateSummary[
        statsKey(
          zOffset,
          filter.name
        )
      ];


    console.log(
      `  ${filter.name.padEnd(32)} clear=${formatPercent(row.clearRate).padEnd(8)} blocked=${String(row.blocked).padEnd(4)} / ${row.total}`
    );
  }
}


console.log('');

console.log(
  'PRIMARY POSITIVE CONTROL'
);

console.log(
  '------------------------'
);

console.log(
  `origin probe:             pawn Z +${PRIMARY_ORIGIN_Z_OFFSET_HU} HU`
);

console.log(
  `filter:                   ${PRIMARY_FILTER}`
);

console.log(
  `overall clear:            ${primaryOverall.clear}/${primaryOverall.total} (${formatPercent(primaryOverall.clearRate)})`
);

console.log('');


for (
  const replayName
  of replayNames
) {

  const row =
    primaryPerReplay[
      replayName
    ];


  console.log(
    `${replayName.padEnd(10)} clear=${String(row.clear).padEnd(4)}/${String(row.total).padEnd(4)} (${formatPercent(row.clearRate)})`
  );
}


console.log('');

console.log(
  'PRIMARY BLOCKER MESHES'
);

console.log(
  '----------------------'
);


for (
  const [
    meshName,
    count
  ]
  of Object.entries(
    primaryBlockers
  ).slice(
    0,
    20
  )
) {

  console.log(
    `${String(count).padStart(5)}  ${meshName}`
  );
}


console.log('');

console.log(
  'VALIDATION'
);

console.log(
  '----------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    checks
  )
) {

  console.log(
    `${name.padEnd(46)} ${row.pass}`
  );
}


console.log('');

console.log(
  'FINAL STATUS'
);

console.log(
  '------------'
);

console.log(
  status
);

console.log('');

console.log(
  'NEXT STAGE'
);

console.log(
  '----------'
);

console.log(
  nextStage
);

console.log('');

console.log(
  `JSON:\n${OUTPUT_JSON_PATH}`
);

console.log('');

console.log(
  `Anchors:\n${OUTPUT_ANCHORS_PATH}`
);

console.log('');

console.log(
  `Markdown:\n${OUTPUT_MARKDOWN_PATH}`
);

console.log('');


// ============================================================
// GLB LOADER
// ============================================================

function loadGlb(
  path
) {

  const buffer =
    readFileSync(
      path
    );


  if (
    buffer.length <
    20
  ) {

    throw new Error(
      'GLB too small.'
    );
  }


  if (
    buffer.readUInt32LE(
      0
    ) !==
    0x46546c67
  ) {

    throw new Error(
      'Invalid GLB magic.'
    );
  }


  let json =
    null;


  let binStart =
    null;


  let binLength =
    null;


  let offset =
    12;


  while (
    offset +
    8 <=
    buffer.length
  ) {

    const chunkLength =
      buffer.readUInt32LE(
        offset
      );


    const chunkType =
      buffer.readUInt32LE(
        offset +
        4
      );


    const dataStart =
      offset +
      8;


    const dataEnd =
      dataStart +
      chunkLength;


    if (
      dataEnd >
      buffer.length
    ) {

      throw new Error(
        'Malformed GLB chunk length.'
      );
    }


    if (
      chunkType ===
      0x4e4f534a
    ) {

      json =
        JSON.parse(
          buffer
            .subarray(
              dataStart,
              dataEnd
            )
            .toString(
              'utf8'
            )
            .replace(
              /\u0000+$/g,
              ''
            )
            .trim()
        );
    }


    if (
      chunkType ===
      0x004e4942
    ) {

      binStart =
        dataStart;


      binLength =
        chunkLength;
    }


    offset =
      dataEnd;
  }


  if (
    !json
    ||
    binStart ===
    null
  ) {

    throw new Error(
      'GLB JSON or BIN chunk missing.'
    );
  }


  return {
    path,
    buffer,
    json,
    binStart,
    binLength
  };
}


// ============================================================
// ACCESSORS / PRIMITIVES
// ============================================================

function buildPrimitiveReaders(
  glb
) {

  const meshes =
    Array.isArray(
      glb.json.meshes
    )
      ? glb.json.meshes
      : [];


  const nodes =
    Array.isArray(
      glb.json.nodes
    )
      ? glb.json.nodes
      : [];


  const output =
    [];


  for (
    let meshIndex =
      0;

    meshIndex <
      meshes.length;

    meshIndex++
  ) {

    const mesh =
      meshes[
        meshIndex
      ];


    const meshNodes =
      nodes
        .map(
          (
            node,
            nodeIndex
          ) =>
            ({
              node,
              nodeIndex
            })
        )
        .filter(
          row =>
            row.node?.mesh ===
            meshIndex
        );


    for (
      let primitiveIndex =
        0;

      primitiveIndex <
        (
          mesh.primitives?.length
          ??
          0
        );

      primitiveIndex++
    ) {

      const primitive =
        mesh.primitives[
          primitiveIndex
        ];


      const mode =
        primitive.mode
        ??
        4;


      if (
        mode !==
        4
      ) {

        continue;
      }


      const positionAccessorIndex =
        primitive
          ?.attributes
          ?.POSITION;


      if (
        !Number.isInteger(
          positionAccessorIndex
        )
      ) {

        continue;
      }


      const positionAccessor =
        createAccessorReader(
          glb,
          positionAccessorIndex
        );


      if (
        positionAccessor.type !==
        'VEC3'
        ||
        positionAccessor.componentType !==
        5126
      ) {

        throw new Error(
          `Unsupported POSITION accessor format on mesh ${meshIndex}.`
        );
      }


      const indexAccessor =
        Number.isInteger(
          primitive.indices
        )
          ? createAccessorReader(
              glb,
              primitive.indices
            )
          : null;


      const indexCount =
        indexAccessor
          ? indexAccessor.count
          : positionAccessor.count;


      const triangleCount =
        Math.floor(
          indexCount /
          3
        );


      const node =
        meshNodes[0]?.node
        ??
        null;


      const interactAs =
        Array.isArray(
          node?.extras?.InteractAs
        )
          ? node.extras.InteractAs.map(
              String
            )
          : [];


      const meshName =
        String(
          mesh.name
          ??
          `mesh_${meshIndex}`
        );


      const filterMask =
        classifyPrimitiveFilterMask({
          meshName,
          interactAs
        });


      output.push(
        {
          readerIndex:
            output.length,

          meshIndex,

          primitiveIndex,

          meshName,

          interactAs,

          filterMask,

          positionAccessor,

          indexAccessor,

          triangleCount,

          meshNodes:
            meshNodes.map(
              row =>
                ({
                  nodeIndex:
                    row.nodeIndex,

                  matrix:
                    row.node?.matrix
                    ??
                    null,

                  translation:
                    row.node?.translation
                    ??
                    null,

                  rotation:
                    row.node?.rotation
                    ??
                    null,

                  scale:
                    row.node?.scale
                    ??
                    null,

                  extras:
                    row.node?.extras
                    ??
                    null
                })
            )
        }
      );
    }
  }


  return output;
}


function createAccessorReader(
  glb,
  accessorIndex
) {

  const accessor =
    glb.json.accessors?.[
      accessorIndex
    ];


  if (
    !accessor
  ) {

    throw new Error(
      `Accessor ${accessorIndex} missing.`
    );
  }


  const bufferView =
    glb.json.bufferViews?.[
      accessor.bufferView
    ];


  if (
    !bufferView
  ) {

    throw new Error(
      `bufferView missing for accessor ${accessorIndex}.`
    );
  }


  const componentBytes =
    componentTypeBytes(
      accessor.componentType
    );


  const components =
    accessorTypeComponents(
      accessor.type
    );


  const packedStride =
    componentBytes *
    components;


  const stride =
    bufferView.byteStride
    ??
    packedStride;


  const byteOffset =
    glb.binStart
    +
    (
      bufferView.byteOffset
      ??
      0
    )
    +
    (
      accessor.byteOffset
      ??
      0
    );


  return {
    accessorIndex,

    type:
      accessor.type,

    componentType:
      accessor.componentType,

    count:
      accessor.count,

    min:
      accessor.min
      ??
      null,

    max:
      accessor.max
      ??
      null,

    stride,

    byteOffset,

    buffer:
      glb.buffer,


    getIndex(
      index
    ) {

      const offset =
        byteOffset
        +
        index *
        stride;


      switch (
        accessor.componentType
      ) {

        case 5121:
          return glb.buffer.readUInt8(
            offset
          );

        case 5123:
          return glb.buffer.readUInt16LE(
            offset
          );

        case 5125:
          return glb.buffer.readUInt32LE(
            offset
          );

        default:
          throw new Error(
            `Unsupported index componentType ${accessor.componentType}.`
          );
      }
    },


    getVec3(
      index,
      out =
        {}
    ) {

      const offset =
        byteOffset
        +
        index *
        stride;


      out.x =
        glb.buffer.readFloatLE(
          offset
        );


      out.y =
        glb.buffer.readFloatLE(
          offset +
          4
        );


      out.z =
        glb.buffer.readFloatLE(
          offset +
          8
        );


      return out;
    }
  };
}


function componentTypeBytes(
  componentType
) {

  switch (
    componentType
  ) {

    case 5120:

    case 5121:
      return 1;

    case 5122:

    case 5123:
      return 2;

    case 5125:

    case 5126:
      return 4;

    default:
      throw new Error(
        `Unsupported GLTF componentType ${componentType}.`
      );
  }
}


function accessorTypeComponents(
  type
) {

  switch (
    type
  ) {

    case 'SCALAR':
      return 1;

    case 'VEC2':
      return 2;

    case 'VEC3':
      return 3;

    case 'VEC4':
      return 4;

    default:
      throw new Error(
        `Unsupported accessor type ${type}.`
      );
  }
}


function getTriangleVertices(
  reader,
  localTriangleIndex,
  a =
    {},
  b =
    {},
  c =
    {}
) {

  const base =
    localTriangleIndex *
    3;


  const i0 =
    reader.indexAccessor
      ? reader.indexAccessor.getIndex(
          base
        )
      : base;


  const i1 =
    reader.indexAccessor
      ? reader.indexAccessor.getIndex(
          base +
          1
        )
      : base +
        1;


  const i2 =
    reader.indexAccessor
      ? reader.indexAccessor.getIndex(
          base +
          2
        )
      : base +
        2;


  reader.positionAccessor.getVec3(
    i0,
    a
  );


  reader.positionAccessor.getVec3(
    i1,
    b
  );


  reader.positionAccessor.getVec3(
    i2,
    c
  );


  return [
    a,
    b,
    c
  ];
}


// ============================================================
// FILTER CLASSIFICATION
// ============================================================

function classifyPrimitiveFilterMask({
  meshName,
  interactAs
}) {

  const text =
    `${meshName} ${interactAs.join(' ')}`
      .toLowerCase();


  const passBullets =
    /passbullets/.test(
      text
    );


  const playerOrNpcClip =
    /(playerclip|npcclip)/.test(
      text
    );


  const foliage =
    /foliage/.test(
      text
    );


  const blockLos =
    /blocklos/.test(
      text
    );


  const solid =
    /(^|[_\s])solid($|[_\s])/.test(
      text
    );


  const defaultPhysicsGroup =
    /^physics_group(?:_|$)/i.test(
      meshName
    );


  let mask =
    0;


  mask |=
    1;


  if (
    !passBullets
  ) {

    mask |=
      2;
  }


  if (
    !passBullets
    &&
    !playerOrNpcClip
    &&
    !(
      foliage
      &&
      !solid
    )
    &&
    !(
      blockLos
      &&
      !solid
    )
  ) {

    mask |=
      4;
  }


  if (
    !passBullets
    &&
    (
      defaultPhysicsGroup
      ||
      solid
    )
  ) {

    mask |=
      8;
  }


  return mask;
}


function summarizePrimitiveFilters(
  primitiveReaders
) {

  return FILTERS.map(
    filter => {

      const rows =
        primitiveReaders.filter(
          reader =>
            (
              reader.filterMask
              &
              filter.bit
            ) !==
            0
        );


      return {
        filter:
          filter.name,

        bit:
          filter.bit,

        meshes:
          rows.length,

        triangles:
          sum(
            rows.map(
              row =>
                row.triangleCount
            )
          ),

        meshNames:
          rows.map(
            row =>
              row.meshName
          )
      };
    }
  );
}


// ============================================================
// BOUNDS / NODE TRANSFORMS
// ============================================================

function aggregatePrimitiveBounds(
  primitiveReaders
) {

  const bounds =
    {
      min:
        {
          x:
            Infinity,

          y:
            Infinity,

          z:
            Infinity
        },

      max:
        {
          x:
            -Infinity,

          y:
            -Infinity,

          z:
            -Infinity
        }
    };


  for (
    const reader
    of primitiveReaders
  ) {

    const min =
      reader.positionAccessor.min;


    const max =
      reader.positionAccessor.max;


    if (
      !Array.isArray(
        min
      )
      ||
      !Array.isArray(
        max
      )
      ||
      min.length <
      3
      ||
      max.length <
      3
    ) {

      throw new Error(
        `POSITION accessor bounds missing for ${reader.meshName}.`
      );
    }


    bounds.min.x =
      Math.min(
        bounds.min.x,
        min[0]
      );


    bounds.min.y =
      Math.min(
        bounds.min.y,
        min[1]
      );


    bounds.min.z =
      Math.min(
        bounds.min.z,
        min[2]
      );


    bounds.max.x =
      Math.max(
        bounds.max.x,
        max[0]
      );


    bounds.max.y =
      Math.max(
        bounds.max.y,
        max[1]
      );


    bounds.max.z =
      Math.max(
        bounds.max.z,
        max[2]
      );
  }


  return bounds;
}


function summarizePhysicsNodeTransforms(
  json,
  primitiveReaders
) {

  const matrixCounts =
    new Map();


  let nodesObserved =
    0;


  let nodesWithMatrix =
    0;


  let primitivesWithExactlyOneNode =
    0;


  for (
    const reader
    of primitiveReaders
  ) {

    if (
      reader.meshNodes.length ===
      1
    ) {

      primitivesWithExactlyOneNode++;
    }


    for (
      const nodeRow
      of reader.meshNodes
    ) {

      nodesObserved++;


      if (
        Array.isArray(
          nodeRow.matrix
        )
        &&
        nodeRow.matrix.length ===
        16
      ) {

        nodesWithMatrix++;


        const key =
          JSON.stringify(
            nodeRow.matrix.map(
              value =>
                Number(
                  Number(
                    value
                  ).toFixed(
                    8
                  )
                )
            )
          );


        increment(
          matrixCounts,
          key
        );
      }
    }
  }


  return {
    nodesObserved,

    nodesWithMatrix,

    primitivesWithExactlyOneNode,

    uniqueMatrixCount:
      matrixCounts.size,

    matrices:
      Object.fromEntries(
        matrixCounts
      )
  };
}


// ============================================================
// TRIANGLE GRID
// ============================================================

function buildTriangleGrid({
  primitiveReaders,
  bounds,
  cellSize,
  maxCellsPerTriangle
}) {

  const nx =
    Math.max(
      1,
      Math.floor(
        (
          bounds.max.x
          -
          bounds.min.x
        ) /
        cellSize
      )
      +
      1
    );


  const ny =
    Math.max(
      1,
      Math.floor(
        (
          bounds.max.y
          -
          bounds.min.y
        ) /
        cellSize
      )
      +
      1
    );


  const nz =
    Math.max(
      1,
      Math.floor(
        (
          bounds.max.z
          -
          bounds.min.z
        ) /
        cellSize
      )
      +
      1
    );


  const cellCount =
    nx *
    ny *
    nz;


  if (
    !Number.isSafeInteger(
      cellCount
    )
    ||
    cellCount >
    2_000_000
  ) {

    throw new Error(
      `Unexpected grid cell count: ${cellCount}`
    );
  }


  const totalTriangles =
    sum(
      primitiveReaders.map(
        row =>
          row.triangleCount
      )
    );


  const triPrimitive =
    new Uint8Array(
      totalTriangles
    );


  const triLocal =
    new Uint32Array(
      totalTriangles
    );


  const counts =
    new Uint32Array(
      cellCount
    );


  const largeTriangles =
    [];


  const a =
    {};

  const b =
    {};

  const c =
    {};


  let globalTriangleId =
    0;


  console.log(
    '  pass 1/2: counting triangle-cell assignments'
  );


  for (
    let primitiveIndex =
      0;

    primitiveIndex <
      primitiveReaders.length;

    primitiveIndex++
  ) {

    const reader =
      primitiveReaders[
        primitiveIndex
      ];


    console.log(
      `    ${String(primitiveIndex + 1).padStart(2)}/${primitiveReaders.length} ${reader.meshName} triangles=${reader.triangleCount}`
    );


    for (
      let localTriangleIndex =
        0;

      localTriangleIndex <
        reader.triangleCount;

      localTriangleIndex++
    ) {

      const triangleId =
        globalTriangleId++;


      triPrimitive[
        triangleId
      ] =
        primitiveIndex;


      triLocal[
        triangleId
      ] =
        localTriangleIndex;


      getTriangleVertices(
        reader,
        localTriangleIndex,
        a,
        b,
        c
      );


      const range =
        triangleCellRange({
          a,
          b,
          c,
          bounds,
          cellSize,
          nx,
          ny,
          nz
        });


      const assignments =
        range.cellSpan;


      if (
        assignments >
        maxCellsPerTriangle
      ) {

        largeTriangles.push(
          triangleId
        );

        continue;
      }


      for (
        let iz =
          range.minZ;

        iz <=
          range.maxZ;

        iz++
      ) {

        for (
          let iy =
            range.minY;

          iy <=
            range.maxY;

          iy++
        ) {

          let index =
            cellIndex(
              range.minX,
              iy,
              iz,
              nx,
              ny
            );


          for (
            let ix =
              range.minX;

            ix <=
              range.maxX;

            ix++
          ) {

            counts[
              index++
            ]++;
          }
        }
      }
    }
  }


  if (
    globalTriangleId !==
    totalTriangles
  ) {

    throw new Error(
      'Triangle accounting mismatch.'
    );
  }


  const offsets =
    new Uint32Array(
      cellCount +
      1
    );


  let assignmentTotal =
    0;


  for (
    let index =
      0;

    index <
      cellCount;

    index++
  ) {

    assignmentTotal +=
      counts[
        index
      ];


    if (
      assignmentTotal >
      0xffffffff
    ) {

      throw new Error(
        'Triangle-cell assignment count exceeds Uint32 capacity.'
      );
    }


    offsets[
      index +
      1
    ] =
      assignmentTotal;
  }


  const members =
    new Uint32Array(
      assignmentTotal
    );


  const cursor =
    offsets.slice(
      0,
      cellCount
    );


  console.log(
    `  assignments=${assignmentTotal}, largeTriangles=${largeTriangles.length}`
  );


  console.log(
    '  pass 2/2: filling triangle grid'
  );


  for (
    let triangleId =
      0;

    triangleId <
      totalTriangles;

    triangleId++
  ) {

    const primitiveIndex =
      triPrimitive[
        triangleId
      ];


    const localTriangleIndex =
      triLocal[
        triangleId
      ];


    const reader =
      primitiveReaders[
        primitiveIndex
      ];


    getTriangleVertices(
      reader,
      localTriangleIndex,
      a,
      b,
      c
    );


    const range =
      triangleCellRange({
        a,
        b,
        c,
        bounds,
        cellSize,
        nx,
        ny,
        nz
      });


    if (
      range.cellSpan >
      maxCellsPerTriangle
    ) {

      continue;
    }


    for (
      let iz =
        range.minZ;

      iz <=
        range.maxZ;

      iz++
    ) {

      for (
        let iy =
          range.minY;

        iy <=
          range.maxY;

        iy++
      ) {

        let index =
          cellIndex(
            range.minX,
            iy,
            iz,
            nx,
            ny
          );


        for (
          let ix =
            range.minX;

          ix <=
            range.maxX;

          ix++
        ) {

          const cell =
            index++;


          members[
            cursor[
              cell
            ]++
          ] =
            triangleId;
        }
      }
    }
  }


  return {
    bounds,

    cellSize,

    nx,

    ny,

    nz,

    cellCount,

    totalTriangles,

    offsets,

    members,

    triPrimitive,

    triLocal,

    largeTriangles:
      Uint32Array.from(
        largeTriangles
      ),

    seenStamp:
      new Uint32Array(
        totalTriangles
      ),

    rayStamp:
      0
  };
}


function triangleCellRange({
  a,
  b,
  c,
  bounds,
  cellSize,
  nx,
  ny,
  nz
}) {

  const minXValue =
    Math.min(
      a.x,
      b.x,
      c.x
    );


  const minYValue =
    Math.min(
      a.y,
      b.y,
      c.y
    );


  const minZValue =
    Math.min(
      a.z,
      b.z,
      c.z
    );


  const maxXValue =
    Math.max(
      a.x,
      b.x,
      c.x
    );


  const maxYValue =
    Math.max(
      a.y,
      b.y,
      c.y
    );


  const maxZValue =
    Math.max(
      a.z,
      b.z,
      c.z
    );


  const minX =
    clampInt(
      Math.floor(
        (
          minXValue
          -
          bounds.min.x
        ) /
        cellSize
      ),
      0,
      nx -
      1
    );


  const minY =
    clampInt(
      Math.floor(
        (
          minYValue
          -
          bounds.min.y
        ) /
        cellSize
      ),
      0,
      ny -
      1
    );


  const minZ =
    clampInt(
      Math.floor(
        (
          minZValue
          -
          bounds.min.z
        ) /
        cellSize
      ),
      0,
      nz -
      1
    );


  const maxX =
    clampInt(
      Math.floor(
        (
          maxXValue
          -
          bounds.min.x
        ) /
        cellSize
      ),
      0,
      nx -
      1
    );


  const maxY =
    clampInt(
      Math.floor(
        (
          maxYValue
          -
          bounds.min.y
        ) /
        cellSize
      ),
      0,
      ny -
      1
    );


  const maxZ =
    clampInt(
      Math.floor(
        (
          maxZValue
          -
          bounds.min.z
        ) /
        cellSize
      ),
      0,
      nz -
      1
    );


  return {
    minX,

    minY,

    minZ,

    maxX,

    maxY,

    maxZ,

    cellSpan:
      (
        maxX
        -
        minX
        +
        1
      )
      *
      (
        maxY
        -
        minY
        +
        1
      )
      *
      (
        maxZ
        -
        minZ
        +
        1
      )
  };
}


function cellIndex(
  ix,
  iy,
  iz,
  nx,
  ny
) {

  return ix
    +
    nx *
    (
      iy
      +
      ny *
      iz
    );
}


// ============================================================
// RAYCAST
// ============================================================

function raycastSegmentAllFilters({
  start,
  end,
  grid,
  primitiveReaders,
  startClearanceHU,
  targetClearanceHU
}) {

  grid.rayStamp++;


  if (
    grid.rayStamp ===
    0xffffffff
  ) {

    grid.seenStamp.fill(
      0
    );


    grid.rayStamp =
      1;
  }


  const stamp =
    grid.rayStamp;


  const segmentLengthHU =
    distance3D(
      start,
      end
    );


  const nearestT =
    new Float64Array(
      FILTERS.length
    );


  nearestT.fill(
    Infinity
  );


  const nearestTriangle =
    new Int32Array(
      FILTERS.length
    );


  nearestTriangle.fill(
    -1
  );


  const a =
    {};

  const b =
    {};

  const c =
    {};


  const testTriangle =
    triangleId => {

      if (
        grid.seenStamp[
          triangleId
        ] ===
        stamp
      ) {

        return;
      }


      grid.seenStamp[
        triangleId
      ] =
        stamp;


      const primitiveReaderIndex =
        grid.triPrimitive[
          triangleId
        ];


      const reader =
        primitiveReaders[
          primitiveReaderIndex
        ];


      getTriangleVertices(
        reader,
        grid.triLocal[
          triangleId
        ],
        a,
        b,
        c
      );


      const t =
        segmentTriangleIntersectionT(
          start,
          end,
          a,
          b,
          c
        );


      if (
        t ===
        null
      ) {

        return;
      }


      const distanceHU =
        t *
        segmentLengthHU;


      if (
        distanceHU <=
        startClearanceHU
        ||
        distanceHU >=
        segmentLengthHU
        -
        targetClearanceHU
      ) {

        return;
      }


      for (
        let filterIndex =
          0;

        filterIndex <
          FILTERS.length;

        filterIndex++
      ) {

        if (
          (
            reader.filterMask
            &
            FILTERS[
              filterIndex
            ].bit
          ) ===
          0
        ) {

          continue;
        }


        if (
          t <
          nearestT[
            filterIndex
          ]
        ) {

          nearestT[
            filterIndex
          ] =
            t;


          nearestTriangle[
            filterIndex
          ] =
            triangleId;
        }
      }
    };


  for (
    const triangleId
    of grid.largeTriangles
  ) {

    testTriangle(
      triangleId
    );
  }


  const clipped =
    clipSegmentToBounds(
      start,
      end,
      grid.bounds
    );


  if (
    clipped
  ) {

    traverseGridSegment({
      start,

      end,

      tStart:
        clipped.tStart,

      tEnd:
        clipped.tEnd,

      grid,


      visitCell(
        cell
      ) {

        const begin =
          grid.offsets[
            cell
          ];


        const finish =
          grid.offsets[
            cell +
            1
          ];


        for (
          let index =
            begin;

          index <
            finish;

          index++
        ) {

          testTriangle(
            grid.members[
              index
            ]
          );
        }
      }
    });
  }


  const result =
    {};


  for (
    let filterIndex =
      0;

    filterIndex <
      FILTERS.length;

    filterIndex++
  ) {

    const filter =
      FILTERS[
        filterIndex
      ];


    const triangleId =
      nearestTriangle[
        filterIndex
      ];


    if (
      triangleId <
      0
    ) {

      result[
        filter.name
      ] =
        null;

      continue;
    }


    const primitiveReaderIndex =
      grid.triPrimitive[
        triangleId
      ];


    const reader =
      primitiveReaders[
        primitiveReaderIndex
      ];


    const t =
      nearestT[
        filterIndex
      ];


    result[
      filter.name
    ] =
      {
        t,

        distanceHU:
          t *
          segmentLengthHU,

        segmentLengthHU,

        triangleId,

        primitiveReaderIndex,

        meshName:
          reader.meshName,

        interactAs:
          reader.interactAs
      };
  }


  return result;
}


function segmentTriangleIntersectionT(
  start,
  end,
  a,
  b,
  c
) {

  const dx =
    end.x -
    start.x;


  const dy =
    end.y -
    start.y;


  const dz =
    end.z -
    start.z;


  const e1x =
    b.x -
    a.x;


  const e1y =
    b.y -
    a.y;


  const e1z =
    b.z -
    a.z;


  const e2x =
    c.x -
    a.x;


  const e2y =
    c.y -
    a.y;


  const e2z =
    c.z -
    a.z;


  const hx =
    dy *
    e2z
    -
    dz *
    e2y;


  const hy =
    dz *
    e2x
    -
    dx *
    e2z;


  const hz =
    dx *
    e2y
    -
    dy *
    e2x;


  const det =
    e1x *
    hx
    +
    e1y *
    hy
    +
    e1z *
    hz;


  if (
    Math.abs(
      det
    ) <
    1e-9
  ) {

    return null;
  }


  const invDet =
    1 /
    det;


  const sx =
    start.x -
    a.x;


  const sy =
    start.y -
    a.y;


  const sz =
    start.z -
    a.z;


  const u =
    (
      sx *
      hx
      +
      sy *
      hy
      +
      sz *
      hz
    )
    *
    invDet;


  if (
    u <
    -1e-8
    ||
    u >
    1 +
    1e-8
  ) {

    return null;
  }


  const qx =
    sy *
    e1z
    -
    sz *
    e1y;


  const qy =
    sz *
    e1x
    -
    sx *
    e1z;


  const qz =
    sx *
    e1y
    -
    sy *
    e1x;


  const v =
    (
      dx *
      qx
      +
      dy *
      qy
      +
      dz *
      qz
    )
    *
    invDet;


  if (
    v <
    -1e-8
    ||
    u +
    v >
    1 +
    1e-8
  ) {

    return null;
  }


  const t =
    (
      e2x *
      qx
      +
      e2y *
      qy
      +
      e2z *
      qz
    )
    *
    invDet;


  if (
    t <
    0
    ||
    t >
    1
  ) {

    return null;
  }


  return t;
}


function clipSegmentToBounds(
  start,
  end,
  bounds
) {

  let tStart =
    0;


  let tEnd =
    1;


  for (
    const axis
    of [
      'x',
      'y',
      'z'
    ]
  ) {

    const s =
      start[
        axis
      ];


    const d =
      end[
        axis
      ]
      -
      s;


    const min =
      bounds.min[
        axis
      ];


    const max =
      bounds.max[
        axis
      ];


    if (
      Math.abs(
        d
      ) <
      1e-12
    ) {

      if (
        s <
        min
        ||
        s >
        max
      ) {

        return null;
      }


      continue;
    }


    let t1 =
      (
        min -
        s
      ) /
      d;


    let t2 =
      (
        max -
        s
      ) /
      d;


    if (
      t1 >
      t2
    ) {

      const temp =
        t1;


      t1 =
        t2;


      t2 =
        temp;
    }


    tStart =
      Math.max(
        tStart,
        t1
      );


    tEnd =
      Math.min(
        tEnd,
        t2
      );


    if (
      tStart >
      tEnd
    ) {

      return null;
    }
  }


  return {
    tStart,
    tEnd
  };
}


function traverseGridSegment({
  start,
  end,
  tStart,
  tEnd,
  grid,
  visitCell
}) {

  const dx =
    end.x -
    start.x;


  const dy =
    end.y -
    start.y;


  const dz =
    end.z -
    start.z;


  const px =
    start.x +
    dx *
    tStart;


  const py =
    start.y +
    dy *
    tStart;


  const pz =
    start.z +
    dz *
    tStart;


  let ix =
    clampInt(
      Math.floor(
        (
          px -
          grid.bounds.min.x
        ) /
        grid.cellSize
      ),
      0,
      grid.nx -
      1
    );


  let iy =
    clampInt(
      Math.floor(
        (
          py -
          grid.bounds.min.y
        ) /
        grid.cellSize
      ),
      0,
      grid.ny -
      1
    );


  let iz =
    clampInt(
      Math.floor(
        (
          pz -
          grid.bounds.min.z
        ) /
        grid.cellSize
      ),
      0,
      grid.nz -
      1
    );


  const stepX =
    Math.sign(
      dx
    );


  const stepY =
    Math.sign(
      dy
    );


  const stepZ =
    Math.sign(
      dz
    );


  let tMaxX =
    axisNextBoundaryT(
      start.x,
      dx,
      ix,
      stepX,
      grid.bounds.min.x,
      grid.cellSize
    );


  let tMaxY =
    axisNextBoundaryT(
      start.y,
      dy,
      iy,
      stepY,
      grid.bounds.min.y,
      grid.cellSize
    );


  let tMaxZ =
    axisNextBoundaryT(
      start.z,
      dz,
      iz,
      stepZ,
      grid.bounds.min.z,
      grid.cellSize
    );


  const tDeltaX =
    stepX ===
    0
      ? Infinity
      : grid.cellSize /
        Math.abs(
          dx
        );


  const tDeltaY =
    stepY ===
    0
      ? Infinity
      : grid.cellSize /
        Math.abs(
          dy
        );


  const tDeltaZ =
    stepZ ===
    0
      ? Infinity
      : grid.cellSize /
        Math.abs(
          dz
        );


  const epsilon =
    1e-10;


  let safety =
    0;


  const maximumSteps =
    grid.nx +
    grid.ny +
    grid.nz +
    100;


  while (
    ix >=
    0
    &&
    ix <
    grid.nx
    &&
    iy >=
    0
    &&
    iy <
    grid.ny
    &&
    iz >=
    0
    &&
    iz <
    grid.nz
  ) {

    visitCell(
      cellIndex(
        ix,
        iy,
        iz,
        grid.nx,
        grid.ny
      )
    );


    const nextT =
      Math.min(
        tMaxX,
        tMaxY,
        tMaxZ
      );


    if (
      nextT >
      tEnd +
      epsilon
    ) {

      break;
    }


    if (
      Math.abs(
        tMaxX -
        nextT
      ) <=
      epsilon
    ) {

      ix +=
        stepX;


      tMaxX +=
        tDeltaX;
    }


    if (
      Math.abs(
        tMaxY -
        nextT
      ) <=
      epsilon
    ) {

      iy +=
        stepY;


      tMaxY +=
        tDeltaY;
    }


    if (
      Math.abs(
        tMaxZ -
        nextT
      ) <=
      epsilon
    ) {

      iz +=
        stepZ;


      tMaxZ +=
        tDeltaZ;
    }


    safety++;


    if (
      safety >
      maximumSteps
    ) {

      throw new Error(
        'Grid traversal exceeded safety limit.'
      );
    }
  }
}


function axisNextBoundaryT(
  startValue,
  delta,
  cell,
  step,
  minValue,
  cellSize
) {

  if (
    step ===
    0
  ) {

    return Infinity;
  }


  const boundary =
    step >
    0
      ? minValue +
        (
          cell +
          1
        ) *
        cellSize
      : minValue +
        cell *
        cellSize;


  return (
    boundary -
    startValue
  ) /
  delta;
}


// ============================================================
// STATS
// ============================================================

function createStatsCollection() {

  const result =
    new Map();


  for (
    const zOffset
    of ORIGIN_Z_OFFSETS_HU
  ) {

    for (
      const filter
      of FILTERS
    ) {

      result.set(
        statsKey(
          zOffset,
          filter.name
        ),
        {
          zOffsetHU:
            zOffset,

          filter:
            filter.name,

          total:
            0,

          clear:
            0,

          blocked:
            0,

          intersectionDistancesHU:
            [],

          blockerMeshes:
            new Map()
        }
      );
    }
  }


  return result;
}


function updateStatsCollection({
  collection,
  zOffset,
  filterName,
  result
}) {

  const row =
    collection.get(
      statsKey(
        zOffset,
        filterName
      )
    );


  row.total++;


  if (
    result.blocked
  ) {

    row.blocked++;


    if (
      Number.isFinite(
        result.intersectionDistanceHU
      )
    ) {

      row.intersectionDistancesHU.push(
        result.intersectionDistanceHU
      );
    }


    increment(
      row.blockerMeshes,
      result.blockerMesh
      ??
      'UNKNOWN'
    );

  } else {

    row.clear++;
  }
}


function finalizeStatsCollection(
  collection
) {

  return Object.fromEntries(
    [
      ...collection.entries()
    ].map(
      ([
        key,
        row
      ]) =>
        [
          key,
          {
            zOffsetHU:
              row.zOffsetHU,

            filter:
              row.filter,

            total:
              row.total,

            clear:
              row.clear,

            blocked:
              row.blocked,

            clearRate:
              rate(
                row.clear,
                row.total
              ),

            blockedRate:
              rate(
                row.blocked,
                row.total
              ),

            intersectionDistanceHU:
              summarizeNumbers(
                row.intersectionDistancesHU
              ),

            blockerMeshes:
              mapToSortedObject(
                row.blockerMeshes
              )
          }
        ]
    )
  );
}


function statsKey(
  zOffset,
  filterName
) {

  return `Z${zOffset}|${filterName}`;
}


// ============================================================
// FILE HELPERS
// ============================================================

async function loadJsonl(
  path
) {

  const rows =
    [];


  const reader =
    createInterface({
      input:
        createReadStream(
          path,
          {
            encoding:
              'utf8'
          }
        ),

      crlfDelay:
        Infinity
    });


  for await (
    const line
    of reader
  ) {

    if (
      !line.trim()
    ) {

      continue;
    }


    try {

      rows.push(
        JSON.parse(
          line
        )
      );

    } catch {}
  }


  return rows;
}


async function writeJsonl(
  path,
  rows
) {

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
  );


  const writer =
    createWriteStream(
      path,
      {
        encoding:
          'utf8'
      }
    );


  for (
    const row
    of rows
  ) {

    writer.write(
      `${JSON.stringify(row)}\n`
    );
  }


  await new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {

      writer.on(
        'error',
        rejectPromise
      );


      writer.on(
        'finish',
        resolvePromise
      );


      writer.end();
    }
  );
}


// ============================================================
// NUMERIC / GEOMETRY HELPERS
// ============================================================

function normalizePosition(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const x =
    finite(
      value.x
      ??
      value[0]
    );


  const y =
    finite(
      value.y
      ??
      value[1]
    );


  const z =
    finite(
      value.z
      ??
      value[2]
      ??
      0
    );


  if (
    x ===
    null
    ||
    y ===
    null
    ||
    z ===
    null
  ) {

    return null;
  }


  return {
    x,
    y,
    z
  };
}


function pointInsideBounds(
  point,
  bounds
) {

  return point.x >=
    bounds.min.x
    &&
    point.x <=
    bounds.max.x
    &&
    point.y >=
    bounds.min.y
    &&
    point.y <=
    bounds.max.y
    &&
    point.z >=
    bounds.min.z
    &&
    point.z <=
    bounds.max.z;
}


function distance3D(
  a,
  b
) {

  const dx =
    b.x -
    a.x;


  const dy =
    b.y -
    a.y;


  const dz =
    b.z -
    a.z;


  return Math.sqrt(
    dx *
    dx
    +
    dy *
    dy
    +
    dz *
    dz
  );
}


function finite(
  value
) {

  if (
    value ===
    null
    ||
    value ===
    undefined
    ||
    value ===
    ''
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function rate(
  numerator,
  denominator
) {

  if (
    !Number.isFinite(
      numerator
    )
    ||
    !Number.isFinite(
      denominator
    )
    ||
    denominator <=
    0
  ) {

    return null;
  }


  return numerator /
    denominator;
}


function sum(
  values
) {

  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  );
}


function clampInt(
  value,
  minimum,
  maximum
) {

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );
}


function increment(
  map,
  key
) {

  map.set(
    key,
    (
      map.get(
        key
      )
      ??
      0
    )
    +
    1
  );
}


function mapToSortedObject(
  map
) {

  return Object.fromEntries(
    [
      ...map.entries()
    ].sort(
      (
        a,
        b
      ) =>
        b[1]
        -
        a[1]
        ||
        String(
          a[0]
        ).localeCompare(
          String(
            b[0]
          )
        )
    )
  );
}


function summarizeNumbers(
  values
) {

  const clean =
    values
      .filter(
        Number.isFinite
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  if (
    clean.length ===
    0
  ) {

    return {
      count:
        0,

      min:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      max:
        null
    };
  }


  return {
    count:
      clean.length,

    min:
      clean[0],

    p25:
      quantile(
        clean,
        0.25
      ),

    median:
      quantile(
        clean,
        0.5
      ),

    p75:
      quantile(
        clean,
        0.75
      ),

    max:
      clean[
        clean.length -
        1
      ]
  };
}


function quantile(
  sorted,
  q
) {

  if (
    sorted.length ===
    1
  ) {

    return sorted[0];
  }


  const position =
    (
      sorted.length -
      1
    ) *
    q;


  const lower =
    Math.floor(
      position
    );


  const upper =
    Math.ceil(
      position
    );


  if (
    lower ===
    upper
  ) {

    return sorted[
      lower
    ];
  }


  const weight =
    position -
    lower;


  return sorted[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    sorted[
      upper
    ] *
    weight;
}


// ============================================================
// FORMAT / MARKDOWN
// ============================================================

function formatPercent(
  value
) {

  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(2)}%`
    : 'n/a';
}


function formatBounds(
  bounds
) {

  if (
    !bounds
  ) {

    return 'n/a';
  }


  return `min=[${formatNumber(bounds.min.x)},${formatNumber(bounds.min.y)},${formatNumber(bounds.min.z)}] max=[${formatNumber(bounds.max.x)},${formatNumber(bounds.max.y)},${formatNumber(bounds.max.z)}]`;
}


function formatNumber(
  value
) {

  return Number.isFinite(
    value
  )
    ? Number(
        value.toFixed(
          4
        )
      ).toString()
    : 'n/a';
}


function buildMarkdown(
  summary
) {

  const primary =
    summary
      .positiveControls
      .primary;


  const lines =
    [];


  lines.push(
    '# dl_midtown Static Physics Positive Raycast Validation'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Purpose'
  );


  lines.push('');


  lines.push(
    'Validate static-world projectile-path raycasts against observed successful flying-soul hits before applying any occlusion labels to Script117 nonresponders.'
  );


  lines.push('');


  lines.push(
    '## Coordinate interpretation'
  );


  lines.push('');


  lines.push(
    `- Player positions inside raw physics bounds: ${formatPercent(summary.coordinateInterpretation.positiveAnchorBoundsCoverage.playerRate)}`
  );


  lines.push(
    `- Orb positions inside raw physics bounds: ${formatPercent(summary.coordinateInterpretation.positiveAnchorBoundsCoverage.orbRate)}`
  );


  lines.push('');


  lines.push(
    '## Primary positive control'
  );


  lines.push('');


  lines.push(
    `- Origin proxy: pawn world position + ${primary.zOffsetHU} HU Z`
  );


  lines.push(
    `- Collision filter: ${primary.filter}`
  );


  lines.push(
    `- Overall clear successful-hit paths: ${primary.overall.clear}/${primary.overall.total} (${formatPercent(primary.overall.clearRate)})`
  );


  lines.push('');


  for (
    const [
      replay,
      row
    ]
    of Object.entries(
      primary.byReplay
    )
  ) {

    lines.push(
      `- ${replay}: ${row.clear}/${row.total} clear (${formatPercent(row.clearRate)})`
    );
  }


  lines.push('');


  lines.push(
    '## Critical guardrails'
  );


  lines.push('');


  lines.push(
    '- Pawn + Z offset is a firing-origin probe, not exact hero muzzle/eye origin.'
  );


  lines.push(
    '- Static collision is not the same as visual opacity.'
  );


  lines.push(
    '- Dynamic doors, breakables, temporary walls, and props are not yet incorporated.'
  );


  lines.push(
    '- No Script117 nonresponse is classified as an ignored or avoidable opportunity here.'
  );


  lines.push('');


  lines.push(
    '## Next stage'
  );


  lines.push('');


  lines.push(
    summary.nextStage
  );


  lines.push('');


  return lines.join(
    '\n'
  );
}