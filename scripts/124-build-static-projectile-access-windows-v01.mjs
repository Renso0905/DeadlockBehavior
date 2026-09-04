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
  'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_V01';


// ============================================================
// PURPOSE
//
// Script123 validated a static dl_midtown projectile-path proxy
// against 529 observed successful flying-soul hits:
//
//   pawn Z +64 HU
//   BULLET_SOLID_CANDIDATE filter
//   521 / 529 successful hit paths clear (98.49%)
//
// Script124 now applies that validated STATIC WORLD substrate to
// every Script117 player x flying-soul candidate relation.
//
// To avoid pretending that one universal pawn->muzzle height is
// exact, each eligible tick is raycast from TWO high-performing
// positive-control origin probes:
//
//   pawn Z +64 HU
//   pawn Z +80 HU
//
// Tick classification:
//
//   ROBUST_STATIC_CLEAR
//     both probes clear
//
//   ROBUST_STATIC_BLOCKED
//     both probes blocked
//
//   ORIGIN_SENSITIVE
//     one clear and one blocked
//
// This directly addresses cases such as:
//
//   player near soul + oriented toward soul + solid building
//   between them
//
// while preserving uncertainty around exact firing origin.
//
// CRITICAL:
//
// STATIC_CLEAR != visible
// STATIC_CLEAR != weapon ready
// STATIC_CLEAR != actionable opportunity
//
// Dynamic doors, breakables, temporary walls, visual foliage,
// hero weapon mechanics, and projectile timing remain later
// layers.
//
// No raw .dem parsing.
// ============================================================


// ============================================================
// CONSTANTS
// ============================================================

const TICK_RATE =
  64;


const PLAYER_STATE_SAMPLE_TICKS =
  16;


const MAX_INTERPOLATION_GAP_TICKS =
  PLAYER_STATE_SAMPLE_TICKS;


const MAX_NEAREST_STATE_OFFSET_TICKS =
  8;


const MAX_NEAREST_ORB_OFFSET_TICKS =
  2;


const GRID_CELL_SIZE_HU =
  1024;


const MAX_CELLS_PER_TRIANGLE =
  256;


// Two independently high-performing positive-control origin
// probes from Script123.
const ORIGIN_Z_OFFSETS_HU =
  [
    64,
    80
  ];


const PRIMARY_FILTER =
  'BULLET_SOLID_CANDIDATE';


const START_CLEARANCE_HU =
  4;


const TARGET_CLEARANCE_HU =
  4;


const VALIDATION =
  {
    minimumEvaluatedCandidateCoverageAmongAliveGeometry:
      0.99,

    minimumPositiveHitCandidateEverRobustClearRate:
      0.95,

    minimumReplayPositiveHitCandidateEverRobustClearRate:
      0.90
  };


// ============================================================
// PATHS
// ============================================================

const SCRIPT123_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_static_physics_positive_raycast_validation_v01.json'
  );


const SCRIPT117_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_all_player_dynamic_geometry_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_static_projectile_access_windows_batch_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_static_projectile_access_windows_batch_v01.md'
  );


// ============================================================
// INPUT GUARDS
// ============================================================

for (
  const path
  of [
    SCRIPT123_PATH,
    SCRIPT117_PATH
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


const script123 =
  JSON.parse(
    readFileSync(
      SCRIPT123_PATH,
      'utf8'
    )
  );


const script117 =
  JSON.parse(
    readFileSync(
      SCRIPT117_PATH,
      'utf8'
    )
  );


if (
  script123?.status !==
  'DL_MIDTOWN_STATIC_PROJECTILE_RAYCAST_POSITIVE_CONTROL_READY'
) {

  throw new Error(
    `Script123 raycast substrate not ready.\nStatus: ${script123?.status}`
  );
}


if (
  script117?.status !==
  'FLYING_SOUL_ALL_PLAYER_DYNAMIC_GEOMETRY_READY'
) {

  throw new Error(
    `Script117 geometry substrate not ready.\nStatus: ${script117?.status}`
  );
}


const physicsGlbPath =
  script123?.map?.physicsGlbPath;


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
    script117?.replays
  )
    ? script117.replays
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
    'No Script117 replay cohort.'
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
  'FLYING-SOUL STATIC PROJECTILE ACCESS WINDOWS V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'CONTRACT'
);

console.log(
  '--------'
);

console.log(
  'Apply validated STATIC dl_midtown projectile-blocking geometry'
);

console.log(
  'to every Script117 player x soul candidate without promoting'
);

console.log(
  'STATIC_CLEAR to visibility or actionable opportunity.'
);

console.log('');

console.log(
  `Physics GLB:             ${physicsGlbPath}`
);

console.log(
  `Origin probes:           ${ORIGIN_Z_OFFSETS_HU.map(value => `Z+${value}`).join(', ')}`
);

console.log(
  `Collision filter:        ${PRIMARY_FILTER}`
);

console.log(
  `Independent replays:     ${replayNames.length}`
);

console.log(
  'Raw .dem parsing:        NONE'
);

console.log('');


// ============================================================
// LOAD PHYSICS GLB + BUILD PRIMARY-FILTER TRIANGLE READERS
// ============================================================

console.log(
  'Loading Midtown physics GLB...'
);


const glb =
  loadGlb(
    physicsGlbPath
  );


const allPrimitiveReaders =
  buildPrimitiveReaders(
    glb
  );


const primitiveReaders =
  allPrimitiveReaders.filter(
    reader =>
      reader.primaryFilterIncluded
  );


if (
  primitiveReaders.length ===
  0
) {

  throw new Error(
    'No BULLET_SOLID_CANDIDATE triangle primitives.'
  );
}


const rawPhysicsBounds =
  aggregatePrimitiveBounds(
    primitiveReaders
  );


console.log(
  `Primary-filter meshes:   ${primitiveReaders.length}/${allPrimitiveReaders.length}`
);

console.log(
  `Primary-filter triangles:${sum(primitiveReaders.map(row => row.triangleCount))}`
);

console.log(
  `Physics bounds:          ${formatBounds(rawPhysicsBounds)}`
);

console.log('');


// ============================================================
// SPATIAL INDEX
// ============================================================

console.log(
  'Building primary-filter static triangle grid...'
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
  'SPATIAL INDEX READY'
);

console.log(
  `  dimensions:            ${grid.nx} x ${grid.ny} x ${grid.nz}`
);

console.log(
  `  cells:                 ${grid.cellCount}`
);

console.log(
  `  assignments:           ${grid.members.length}`
);

console.log(
  `  large triangles:       ${grid.largeTriangles.length}`
);

console.log('');


// ============================================================
// ANALYZE REPLAYS
// ============================================================

const replayResults =
  [];


for (
  let replayIndex =
    0;

  replayIndex <
    replayNames.length;

  replayIndex++
) {

  const replayName =
    replayNames[
      replayIndex
    ];


  console.log(
    '--------------------------------------------------------'
  );

  console.log(
    `[${replayIndex + 1}/${replayNames.length}] ${replayName}`
  );

  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await analyzeReplay({
      replayName,
      grid,
      primitiveReaders
    });


  replayResults.push(
    result
  );


  printReplayResult(
    result
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY VALIDATION
// ============================================================

const totalAliveGeometryCandidates =
  sum(
    replayResults.map(
      row =>
        row.coverage.aliveGeometryCandidates
    )
  );


const totalStaticEvaluatedCandidates =
  sum(
    replayResults.map(
      row =>
        row.coverage.staticEvaluatedCandidates
    )
  );


const totalPositiveHitCandidates =
  sum(
    replayResults.map(
      row =>
        row.positiveControls.observedHitCandidates
    )
  );


const totalPositiveHitEverRobustClear =
  sum(
    replayResults.map(
      row =>
        row.positiveControls.everRobustClear
    )
  );


const evaluatedCandidateCoverage =
  rate(
    totalStaticEvaluatedCandidates,
    totalAliveGeometryCandidates
  );


const positiveHitEverRobustClearRate =
  rate(
    totalPositiveHitEverRobustClear,
    totalPositiveHitCandidates
  );


const checks =
  {
    evaluatedCandidateCoverageAmongAliveGeometry:
      {
        actual:
          evaluatedCandidateCoverage,

        expected:
          `>=${VALIDATION.minimumEvaluatedCandidateCoverageAmongAliveGeometry}`,

        pass:
          Number.isFinite(
            evaluatedCandidateCoverage
          )
          &&
          evaluatedCandidateCoverage >=
          VALIDATION.minimumEvaluatedCandidateCoverageAmongAliveGeometry
      },


    positiveHitCandidateEverRobustClearOverall:
      {
        actual:
          positiveHitEverRobustClearRate,

        expected:
          `>=${VALIDATION.minimumPositiveHitCandidateEverRobustClearRate}`,

        pass:
          Number.isFinite(
            positiveHitEverRobustClearRate
          )
          &&
          positiveHitEverRobustClearRate >=
          VALIDATION.minimumPositiveHitCandidateEverRobustClearRate
      },


    positiveHitCandidateEverRobustClearEveryReplay:
      {
        actual:
          Object.fromEntries(
            replayResults.map(
              row =>
                [
                  row.replay,
                  row.positiveControls.everRobustClearRate
                ]
            )
          ),

        expected:
          `each >=${VALIDATION.minimumReplayPositiveHitCandidateEverRobustClearRate}`,

        pass:
          replayResults.every(
            row =>
              Number.isFinite(
                row.positiveControls.everRobustClearRate
              )
              &&
              row.positiveControls.everRobustClearRate >=
              VALIDATION.minimumReplayPositiveHitCandidateEverRobustClearRate
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
    ? 'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_READY'
    : 'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_REQUIRE_DIAGNOSIS';


const distributions =
  {
    robustClearFractionAmongEvaluatedTicks:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.robustClearFraction
        )
      ),

    robustBlockedFractionAmongEvaluatedTicks:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.robustBlockedFraction
        )
      ),

    originSensitiveFractionAmongEvaluatedTicks:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.originSensitiveFraction
        )
      ),

    firstRobustClearSecondsAfterAttackableStart:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.firstRobustClearSecondsAfterStart
        )
      ),

    longestRobustClearRunSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.longestRobustClearRunSeconds
        )
      )
  };


const summary =
  {
    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    status,

    priorValidation:
      {
        script123Status:
          script123.status,

        script123PrimaryPositiveControl:
          script123?.positiveControls?.primary ??
          null,

        calibrationTail:
          'Script123 primary impact-tick positive control produced 8/529 blocked successful-hit rays (1.51%). Script124 therefore retains STATIC access as an operational proxy rather than canonical truth.'
      },

    method:
      {
        outputUnit:
          'PLAYER_X_FLYING_SOUL_EVENT',

        collisionSource:
          'dl_midtown world_physics embedded physics GLB',

        collisionFilter:
          PRIMARY_FILTER,

        originProbesHU:
          ORIGIN_Z_OFFSETS_HU,

        tickClasses:
          {
            robustClear:
              'both Z+64 and Z+80 static projectile rays clear',

            robustBlocked:
              'both Z+64 and Z+80 static projectile rays blocked',

            originSensitive:
              'one probe clear and one blocked'
          },

        analysisWindow:
          'Uses Script117 analysisStart/analysisEnd and therefore remains censored at player first observed successful hit when applicable.',

        noRawReplayParsing:
          true
      },

    validation:
      {
        pass:
          validationPass,

        thresholds:
          VALIDATION,

        checks
      },

    crossReplay:
      {
        candidateRows:
          sum(
            replayResults.map(
              row =>
                row.candidates.total
            )
          ),

        aliveGeometryCandidates:
          totalAliveGeometryCandidates,

        staticEvaluatedCandidates:
          totalStaticEvaluatedCandidates,

        evaluatedCandidateCoverage,

        positiveHitCandidates:
          totalPositiveHitCandidates,

        positiveHitEverRobustClear:
          totalPositiveHitEverRobustClear,

        positiveHitEverRobustClearRate
      },

    distributions,

    replays:
      replayResults,

    interpretation:
      {
        staticBlockedMeaning:
          'ROBUST_STATIC_BLOCKED is evidence that the selected static Midtown collision substrate blocks a straight projectile path from both validated origin-height probes at that tick.',

        staticClearMeaning:
          'ROBUST_STATIC_CLEAR establishes only that the selected STATIC world mesh does not block those two straight-line probes. It does not establish visual access, dynamic-world access, weapon readiness, projectile timing, attention, or opportunity.',

        buildingExample:
          'A player who is near and oriented toward a soul but separated by a solid Midtown building should now accumulate ROBUST_STATIC_BLOCKED ticks rather than being treated as merely geometrically relevant.',

        nextStage:
          validationPass
            ? 'ADD_DYNAMIC_REPLAY_OCCLUDERS_AND_SEPARATE_VISUAL_ACCESS_FROM_PROJECTILE_ACCESS'
            : 'DIAGNOSE_STATIC_ACCESS_POSITIVE_CONTROL_FAILURES'
      },

    outputs:
      {
        json:
          OUTPUT_JSON_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE GLOBAL OUTPUTS
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


writeFileSync(
  OUTPUT_MARKDOWN_PATH,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// FINAL CONSOLE
// ============================================================

console.log(
  '========================================================'
);

console.log(
  'STATIC PROJECTILE ACCESS CROSS-REPLAY SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'REPLAY RESULTS'
);

console.log(
  '--------------'
);


for (
  const row
  of replayResults
) {

  console.log(
    `${row.replay.padEnd(10)} ` +
    `cand=${String(row.candidates.total).padEnd(6)} ` +
    `eval=${formatPercent(row.coverage.staticEvaluatedCandidateRateAmongAliveGeometry).padEnd(8)} ` +
    `everClear=${formatPercent(row.staticAccess.everRobustClearRateAmongEvaluated).padEnd(8)} ` +
    `hitClear=${formatPercent(row.positiveControls.everRobustClearRate).padEnd(8)} ` +
    `pass=${row.validation.pass}`
  );
}


console.log('');

console.log(
  'CROSS-REPLAY'
);

console.log(
  '------------'
);

console.log(
  `Candidate rows:                  ${summary.crossReplay.candidateRows}`
);

console.log(
  `Alive-geometry candidates:       ${totalAliveGeometryCandidates}`
);

console.log(
  `Static-evaluated candidates:     ${totalStaticEvaluatedCandidates} (${formatPercent(evaluatedCandidateCoverage)})`
);

console.log(
  `Observed-hit candidates:         ${totalPositiveHitCandidates}`
);

console.log(
  `Hit candidates ever robust clear:${totalPositiveHitEverRobustClear}/${totalPositiveHitCandidates} (${formatPercent(positiveHitEverRobustClearRate)})`
);

console.log('');

console.log(
  'ACCESS DISTRIBUTIONS'
);

console.log(
  '--------------------'
);

console.log(
  `Robust-clear fraction:           ${formatDistribution(distributions.robustClearFractionAmongEvaluatedTicks)}`
);

console.log(
  `Robust-blocked fraction:         ${formatDistribution(distributions.robustBlockedFractionAmongEvaluatedTicks)}`
);

console.log(
  `Origin-sensitive fraction:       ${formatDistribution(distributions.originSensitiveFractionAmongEvaluatedTicks)}`
);

console.log(
  `First robust clear after start:  ${formatDistribution(distributions.firstRobustClearSecondsAfterAttackableStart)}`
);

console.log(
  `Longest robust-clear run sec:    ${formatDistribution(distributions.longestRobustClearRunSeconds)}`
);

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
    `${name.padEnd(55)} ${row.pass}`
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
  summary.interpretation.nextStage
);

console.log('');

console.log(
  `JSON:\n${OUTPUT_JSON_PATH}`
);

console.log('');

console.log(
  `Markdown:\n${OUTPUT_MARKDOWN_PATH}`
);

console.log('');


// ============================================================
// ANALYZE ONE REPLAY
// ============================================================

async function analyzeReplay({
  replayName,
  grid,
  primitiveReaders
}) {

  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const candidatePath =
    resolve(
      outputDirectory,
      'flying_soul_all_player_dynamic_geometry_v01.jsonl'
    );


  const trajectoryPath =
    resolve(
      outputDirectory,
      'flying_soul_trajectory_v01.jsonl'
    );


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const candidateOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_static_projectile_access_windows_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_static_projectile_access_windows_summary_v01.json'
    );


  for (
    const path
    of [
      candidatePath,
      trajectoryPath,
      playerStatePath
    ]
  ) {

    if (
      !existsSync(
        path
      )
    ) {

      throw new Error(
        `Missing ${replayName} input:\n${path}`
      );
    }
  }


  console.log(
    'Loading Script117 candidates...'
  );


  const candidates =
    await loadJsonl(
      candidatePath
    );


  console.log(
    'Loading tick-dense orb trajectories...'
  );


  const trajectoryRows =
    await loadJsonl(
      trajectoryPath
    );


  const trajectoryByEvent =
    buildTrajectoryIndex(
      trajectoryRows
    );


  console.log(
    'Loading compact 4 Hz player state...'
  );


  const playerState =
    await loadCompactPlayerState(
      playerStatePath
    );


  console.log(
    'Raycasting candidate static access windows...'
  );


  const outputRows =
    [];


  let aliveGeometryCandidates =
    0;


  let staticEvaluatedCandidates =
    0;


  let totalEvaluatedTicks =
    0;


  let totalRobustClearTicks =
    0;


  let totalRobustBlockedTicks =
    0;


  let totalOriginSensitiveTicks =
    0;


  const blockerMeshes =
    new Map();


  let observedHitCandidates =
    0;


  let positiveHitEverRobustClear =
    0;


  let positiveHitNeverRobustClear =
    0;


  const positiveHitNeverClearRows =
    [];


  const robustClearFraction =
    [];


  const robustBlockedFraction =
    [];


  const originSensitiveFraction =
    [];


  const firstRobustClearSecondsAfterStart =
    [];


  const longestRobustClearRunSeconds =
    [];


  for (
    let candidateIndex =
      0;

    candidateIndex <
      candidates.length;

    candidateIndex++
  ) {

    if (
      candidateIndex ===
      0
      ||
      (
        candidateIndex +
        1
      ) %
      1000 ===
      0
      ||
      candidateIndex ===
      candidates.length -
      1
    ) {

      console.log(
        `  candidate ${candidateIndex + 1}/${candidates.length}`
      );
    }


    const candidate =
      candidates[
        candidateIndex
      ];


    const eventId =
      candidate.eventId
      ??
      null;


    const playerName =
      candidate?.player?.playerName
      ??
      null;


    const attackableStartTick =
      finite(
        candidate
          ?.geometry
          ?.window
          ?.attackableStartTick
      )
      ??
      finite(
        candidate
          ?.stimulus
          ?.attackableStartTick
      );


    const analysisEndTick =
      finite(
        candidate
          ?.geometry
          ?.window
          ?.analysisEndTick
      )
      ??
      finite(
        candidate
          ?.stimulus
          ?.analysisEndTick
      );


    const priorAliveGeometryTicks =
      finite(
        candidate
          ?.geometry
          ?.coverage
          ?.geometryTicks
      )
      ??
      0;


    if (
      priorAliveGeometryTicks >
      0
    ) {

      aliveGeometryCandidates++;
    }


    const result =
      evaluateStaticAccessCandidate({
        eventId,
        playerName,
        attackableStartTick,
        analysisEndTick,
        role:
          candidate?.role?.type ??
          null,
        observedOutcome:
          candidate?.observedResponseOutcome ??
          null,
        playerRows:
          playerState.byPlayer.get(
            playerName
          )
          ??
          [],
        trajectory:
          trajectoryByEvent.get(
            eventId
          )
          ??
          null,
        grid,
        primitiveReaders
      });


    if (
      result.coverage.staticEvaluatedTicks >
      0
    ) {

      staticEvaluatedCandidates++;


      robustClearFraction.push(
        result.staticAccess.robustClearFraction
      );


      robustBlockedFraction.push(
        result.staticAccess.robustBlockedFraction
      );


      originSensitiveFraction.push(
        result.staticAccess.originSensitiveFraction
      );


      if (
        Number.isFinite(
          result.staticAccess.firstRobustClearSecondsAfterAttackableStart
        )
      ) {

        firstRobustClearSecondsAfterStart.push(
          result.staticAccess.firstRobustClearSecondsAfterAttackableStart
        );
      }


      if (
        Number.isFinite(
          result.staticAccess.longestRobustClearRunSeconds
        )
      ) {

        longestRobustClearRunSeconds.push(
          result.staticAccess.longestRobustClearRunSeconds
        );
      }
    }


    totalEvaluatedTicks +=
      result.coverage.staticEvaluatedTicks;


    totalRobustClearTicks +=
      result.staticAccess.robustClearTicks;


    totalRobustBlockedTicks +=
      result.staticAccess.robustBlockedTicks;


    totalOriginSensitiveTicks +=
      result.staticAccess.originSensitiveTicks;


    for (
      const [
        meshName,
        count
      ]
      of Object.entries(
        result.blockers.robustBlockedPrimaryMeshes
      )
    ) {

      incrementBy(
        blockerMeshes,
        meshName,
        count
      );
    }


    const observedHit =
      candidate
        ?.observedResponseOutcome
        ?.class ===
      'OBSERVED_SUCCESSFUL_HIT';


    if (
      observedHit
    ) {

      observedHitCandidates++;


      if (
        result.staticAccess.everRobustClear
      ) {

        positiveHitEverRobustClear++;

      } else {

        positiveHitNeverRobustClear++;


        if (
          positiveHitNeverClearRows.length <
          100
        ) {

          positiveHitNeverClearRows.push(
            {
              candidateId:
                candidate.candidateId ??
                null,

              eventId,

              playerName,

              role:
                candidate?.role?.type ??
                null,

              firstHitTick:
                finite(
                  candidate
                    ?.observedResponseOutcome
                    ?.firstHitTick
                ),

              staticAccess:
                result.staticAccess,

              blockers:
                result.blockers
            }
          );
        }
      }
    }


    outputRows.push(
      {
        schemaVersion:
          1,

        canonical:
          false,

        replay:
          replayName,

        candidateId:
          candidate.candidateId ??
          null,

        eventId,

        player:
          candidate.player ??
          {
            playerName
          },

        role:
          candidate.role ??
          null,

        stimulus:
          candidate.stimulus ??
          null,

        observedResponseOutcome:
          candidate.observedResponseOutcome ??
          null,

        staticProjectileAccess:
          result,

        interpretation:
          {
            visibilityClass:
              'NOT_YET_CLASSIFIED',

            dynamicProjectileAccessClass:
              'NOT_YET_CLASSIFIED',

            actionableOpportunityClass:
              'NOT_YET_CLASSIFIED',

            warning:
              'Static projectile clearance is one antecedent accessibility component only. Static clear must not be interpreted as visible, weapon-ready, attempted, or actionable.'
          }
      }
    );
  }


  const staticEvaluatedCandidateRateAmongAliveGeometry =
    rate(
      staticEvaluatedCandidates,
      aliveGeometryCandidates
    );


  const everRobustClearCandidates =
    outputRows.filter(
      row =>
        row
          .staticProjectileAccess
          .staticAccess
          .everRobustClear
    ).length;


  const everRobustBlockedCandidates =
    outputRows.filter(
      row =>
        row
          .staticProjectileAccess
          .staticAccess
          .everRobustBlocked
    ).length;


  const everOriginSensitiveCandidates =
    outputRows.filter(
      row =>
        row
          .staticProjectileAccess
          .staticAccess
          .everOriginSensitive
    ).length;


  const everRobustClearRateAmongEvaluated =
    rate(
      everRobustClearCandidates,
      staticEvaluatedCandidates
    );


  const positiveHitEverRobustClearRate =
    rate(
      positiveHitEverRobustClear,
      observedHitCandidates
    );


  const replayChecks =
    {
      evaluatedCandidateCoverageAmongAliveGeometry:
        {
          actual:
            staticEvaluatedCandidateRateAmongAliveGeometry,

          expected:
            `>=${VALIDATION.minimumEvaluatedCandidateCoverageAmongAliveGeometry}`,

          pass:
            Number.isFinite(
              staticEvaluatedCandidateRateAmongAliveGeometry
            )
            &&
            staticEvaluatedCandidateRateAmongAliveGeometry >=
            VALIDATION.minimumEvaluatedCandidateCoverageAmongAliveGeometry
        },


      positiveHitCandidateEverRobustClearRate:
        {
          actual:
            positiveHitEverRobustClearRate,

          expected:
            `>=${VALIDATION.minimumReplayPositiveHitCandidateEverRobustClearRate}`,

          pass:
            Number.isFinite(
              positiveHitEverRobustClearRate
            )
            &&
            positiveHitEverRobustClearRate >=
            VALIDATION.minimumReplayPositiveHitCandidateEverRobustClearRate
        }
    };


  const replayPass =
    Object.values(
      replayChecks
    ).every(
      row =>
        row.pass
    );


  const replayResult =
    {
      replay:
        replayName,

      version:
        VERSION,

      canonical:
        false,

      candidates:
        {
          total:
            candidates.length,

          priorAliveGeometry:
            aliveGeometryCandidates,

          staticEvaluated:
            staticEvaluatedCandidates
        },

      coverage:
        {
          aliveGeometryCandidates,

          staticEvaluatedCandidates,

          staticEvaluatedCandidateRateAmongAliveGeometry,

          evaluatedTicks:
            totalEvaluatedTicks
        },

      staticAccess:
        {
          robustClearTicks:
            totalRobustClearTicks,

          robustBlockedTicks:
            totalRobustBlockedTicks,

          originSensitiveTicks:
            totalOriginSensitiveTicks,

          robustClearTickRate:
            rate(
              totalRobustClearTicks,
              totalEvaluatedTicks
            ),

          robustBlockedTickRate:
            rate(
              totalRobustBlockedTicks,
              totalEvaluatedTicks
            ),

          originSensitiveTickRate:
            rate(
              totalOriginSensitiveTicks,
              totalEvaluatedTicks
            ),

          everRobustClearCandidates,

          everRobustBlockedCandidates,

          everOriginSensitiveCandidates,

          everRobustClearRateAmongEvaluated
        },

      positiveControls:
        {
          observedHitCandidates,

          everRobustClear:
            positiveHitEverRobustClear,

          neverRobustClear:
            positiveHitNeverRobustClear,

          everRobustClearRate:
            positiveHitEverRobustClearRate,

          neverRobustClearSamples:
            positiveHitNeverClearRows
        },

      blockers:
        {
          robustBlockedPrimaryMeshes:
            mapToSortedObject(
              blockerMeshes
            )
        },

      reconstruction:
        {
          playerStateRows:
            playerState.rowsParsed,

          playerStateParseFailures:
            playerState.parseFailures,

          players:
            playerState.byPlayer.size,

          trajectoryRows:
            trajectoryRows.length,

          trajectoryEvents:
            trajectoryByEvent.size
        },

      validation:
        {
          pass:
            replayPass,

          checks:
            replayChecks
        },

      rawDistributions:
        {
          robustClearFraction,

          robustBlockedFraction,

          originSensitiveFraction,

          firstRobustClearSecondsAfterStart,

          longestRobustClearRunSeconds
        },

      outputs:
        {
          candidates:
            candidateOutputPath,

          summary:
            replaySummaryPath
        }
    };


  await writeJsonl(
    candidateOutputPath,
    outputRows
  );


  writeFileSync(
    replaySummaryPath,
    JSON.stringify(
      replayResult,
      null,
      2
    ),
    'utf8'
  );


  return replayResult;
}


// ============================================================
// EVALUATE ONE CANDIDATE
// ============================================================

function evaluateStaticAccessCandidate({
  eventId,
  playerName,
  attackableStartTick,
  analysisEndTick,
  role,
  observedOutcome,
  playerRows,
  trajectory,
  grid,
  primitiveReaders
}) {

  if (
    !eventId
    ||
    !playerName
    ||
    attackableStartTick ===
    null
    ||
    analysisEndTick ===
    null
    ||
    analysisEndTick <
    attackableStartTick
  ) {

    return emptyStaticAccessResult({
      attackableStartTick,
      analysisEndTick,
      role,
      observedOutcome
    });
  }


  let evaluatedTicks =
    0;


  let playerStateResolvedTicks =
    0;


  let aliveTicks =
    0;


  let orbResolvedTicks =
    0;


  let staticEvaluatedTicks =
    0;


  let robustClearTicks =
    0;


  let robustBlockedTicks =
    0;


  let originSensitiveTicks =
    0;


  let firstRobustClearTick =
    null;


  let firstRobustBlockedTick =
    null;


  let firstOriginSensitiveTick =
    null;


  let currentClearRun =
    0;


  let longestClearRun =
    0;


  let currentBlockedRun =
    0;


  let longestBlockedRun =
    0;


  const robustBlockedPrimaryMeshes =
    new Map();


  const originSensitivePatterns =
    new Map();


  const selectedSnapshots =
    {
      firstRobustClear:
        null,

      firstRobustBlocked:
        null,

      firstOriginSensitive:
        null
    };


  for (
    let tick =
      attackableStartTick;

    tick <=
      analysisEndTick;

    tick++
  ) {

    evaluatedTicks++;


    const state =
      reconstructPlayerStateAtTick({
        rows:
          playerRows,
        tick
      });


    if (
      state.stateResolved
    ) {

      playerStateResolvedTicks++;
    }


    if (
      state.alive !==
      true
      ||
      !state.position
    ) {

      currentClearRun =
        0;

      currentBlockedRun =
        0;

      continue;
    }


    aliveTicks++;


    const orb =
      resolveOrbPositionAtTick({
        trajectory,
        tick
      });


    if (
      !orb.position
    ) {

      currentClearRun =
        0;

      currentBlockedRun =
        0;

      continue;
    }


    orbResolvedTicks++;


    const probeResults =
      [];


    for (
      const zOffset
      of ORIGIN_Z_OFFSETS_HU
    ) {

      const start =
        {
          x:
            state.position.x,

          y:
            state.position.y,

          z:
            state.position.z +
            zOffset
        };


      const hit =
        raycastSegment({
          start,
          end:
            orb.position,
          grid,
          primitiveReaders,
          startClearanceHU:
            START_CLEARANCE_HU,
          targetClearanceHU:
            TARGET_CLEARANCE_HU
        });


      probeResults.push(
        {
          zOffsetHU:
            zOffset,

          clear:
            !hit,

          blocked:
            Boolean(
              hit
            ),

          blockerMesh:
            hit?.meshName ??
            null,

          intersectionDistanceHU:
            hit?.distanceHU ??
            null,

          distanceRemainingToOrbHU:
            hit
              ? hit.segmentLengthHU -
                hit.distanceHU
              : null
        }
      );
    }


    staticEvaluatedTicks++;


    const clearCount =
      probeResults.filter(
        row =>
          row.clear
      ).length;


    let tickClass;


    if (
      clearCount ===
      ORIGIN_Z_OFFSETS_HU.length
    ) {

      tickClass =
        'ROBUST_STATIC_CLEAR';


      robustClearTicks++;


      currentClearRun++;


      currentBlockedRun =
        0;


      longestClearRun =
        Math.max(
          longestClearRun,
          currentClearRun
        );


      if (
        firstRobustClearTick ===
        null
      ) {

        firstRobustClearTick =
          tick;


        selectedSnapshots.firstRobustClear =
          buildStaticSnapshot({
            tick,
            attackableStartTick,
            state,
            orb,
            probeResults,
            tickClass
          });
      }

    } else if (
      clearCount ===
      0
    ) {

      tickClass =
        'ROBUST_STATIC_BLOCKED';


      robustBlockedTicks++;


      currentBlockedRun++;


      currentClearRun =
        0;


      longestBlockedRun =
        Math.max(
          longestBlockedRun,
          currentBlockedRun
        );


      const primaryBlocker =
        probeResults[0]?.blockerMesh ??
        'UNKNOWN';


      increment(
        robustBlockedPrimaryMeshes,
        primaryBlocker
      );


      if (
        firstRobustBlockedTick ===
        null
      ) {

        firstRobustBlockedTick =
          tick;


        selectedSnapshots.firstRobustBlocked =
          buildStaticSnapshot({
            tick,
            attackableStartTick,
            state,
            orb,
            probeResults,
            tickClass
          });
      }

    } else {

      tickClass =
        'ORIGIN_SENSITIVE';


      originSensitiveTicks++;


      currentClearRun =
        0;


      currentBlockedRun =
        0;


      const pattern =
        probeResults
          .map(
            row =>
              `Z${row.zOffsetHU}:${row.clear ? 'CLEAR' : 'BLOCKED'}`
          )
          .join('|');


      increment(
        originSensitivePatterns,
        pattern
      );


      if (
        firstOriginSensitiveTick ===
        null
      ) {

        firstOriginSensitiveTick =
          tick;


        selectedSnapshots.firstOriginSensitive =
          buildStaticSnapshot({
            tick,
            attackableStartTick,
            state,
            orb,
            probeResults,
            tickClass
          });
      }
    }
  }


  const robustClearFraction =
    rate(
      robustClearTicks,
      staticEvaluatedTicks
    );


  const robustBlockedFraction =
    rate(
      robustBlockedTicks,
      staticEvaluatedTicks
    );


  const originSensitiveFraction =
    rate(
      originSensitiveTicks,
      staticEvaluatedTicks
    );


  return {
    window:
      {
        attackableStartTick,

        analysisEndTick,

        analysisWindowTicks:
          analysisEndTick -
          attackableStartTick +
          1,

        role,

        observedOutcomeClass:
          observedOutcome?.class ??
          null
      },

    coverage:
      {
        evaluatedTicks,

        playerStateResolvedTicks,

        playerStateResolvedTickRate:
          rate(
            playerStateResolvedTicks,
            evaluatedTicks
          ),

        aliveTicks,

        aliveTickRate:
          rate(
            aliveTicks,
            evaluatedTicks
          ),

        orbResolvedTicks,

        orbResolvedTickRate:
          rate(
            orbResolvedTicks,
            aliveTicks
          ),

        staticEvaluatedTicks,

        staticEvaluatedTickRate:
          rate(
            staticEvaluatedTicks,
            evaluatedTicks
          )
      },

    staticAccess:
      {
        robustClearTicks,

        robustBlockedTicks,

        originSensitiveTicks,

        robustClearFraction,

        robustBlockedFraction,

        originSensitiveFraction,

        everRobustClear:
          robustClearTicks >
          0,

        everRobustBlocked:
          robustBlockedTicks >
          0,

        everOriginSensitive:
          originSensitiveTicks >
          0,

        firstRobustClearTick,

        firstRobustClearTicksAfterAttackableStart:
          firstRobustClearTick ===
          null
            ? null
            : firstRobustClearTick -
              attackableStartTick,

        firstRobustClearSecondsAfterAttackableStart:
          firstRobustClearTick ===
          null
            ? null
            : (
                firstRobustClearTick -
                attackableStartTick
              ) /
              TICK_RATE,

        firstRobustBlockedTick,

        firstOriginSensitiveTick,

        longestRobustClearRunTicks:
          longestClearRun,

        longestRobustClearRunSeconds:
          longestClearRun /
          TICK_RATE,

        longestRobustBlockedRunTicks:
          longestBlockedRun,

        longestRobustBlockedRunSeconds:
          longestBlockedRun /
          TICK_RATE,

        semanticStatus:
          'STATIC_WORLD_PROJECTILE_PATH_PROXY_ONLY'
      },

    blockers:
      {
        robustBlockedPrimaryMeshes:
          mapToSortedObject(
            robustBlockedPrimaryMeshes
          ),

        originSensitivePatterns:
          mapToSortedObject(
            originSensitivePatterns
          )
      },

    snapshots:
      selectedSnapshots,

    interpretation:
      {
        staticProjectileAccessClass:
          robustClearTicks >
          0
            ? 'EVER_ROBUST_STATIC_CLEAR'
            : robustBlockedTicks >
              0
              ? 'NO_ROBUST_CLEAR_OBSERVED_STATIC_BLOCKING_PRESENT'
              : 'STATIC_ACCESS_UNRESOLVED',

        visibilityClass:
          'NOT_YET_CLASSIFIED',

        actionableOpportunityClass:
          'NOT_YET_CLASSIFIED'
      }
  };
}


function emptyStaticAccessResult({
  attackableStartTick,
  analysisEndTick,
  role,
  observedOutcome
}) {

  return {
    window:
      {
        attackableStartTick,

        analysisEndTick,

        analysisWindowTicks:
          0,

        role,

        observedOutcomeClass:
          observedOutcome?.class ??
          null
      },

    coverage:
      {
        evaluatedTicks:
          0,

        playerStateResolvedTicks:
          0,

        playerStateResolvedTickRate:
          null,

        aliveTicks:
          0,

        aliveTickRate:
          null,

        orbResolvedTicks:
          0,

        orbResolvedTickRate:
          null,

        staticEvaluatedTicks:
          0,

        staticEvaluatedTickRate:
          null
      },

    staticAccess:
      {
        robustClearTicks:
          0,

        robustBlockedTicks:
          0,

        originSensitiveTicks:
          0,

        robustClearFraction:
          null,

        robustBlockedFraction:
          null,

        originSensitiveFraction:
          null,

        everRobustClear:
          false,

        everRobustBlocked:
          false,

        everOriginSensitive:
          false,

        firstRobustClearTick:
          null,

        firstRobustClearTicksAfterAttackableStart:
          null,

        firstRobustClearSecondsAfterAttackableStart:
          null,

        firstRobustBlockedTick:
          null,

        firstOriginSensitiveTick:
          null,

        longestRobustClearRunTicks:
          0,

        longestRobustClearRunSeconds:
          0,

        longestRobustBlockedRunTicks:
          0,

        longestRobustBlockedRunSeconds:
          0,

        semanticStatus:
          'STATIC_ACCESS_UNRESOLVED'
      },

    blockers:
      {
        robustBlockedPrimaryMeshes:
          {},

        originSensitivePatterns:
          {}
      },

    snapshots:
      {
        firstRobustClear:
          null,

        firstRobustBlocked:
          null,

        firstOriginSensitive:
          null
      },

    interpretation:
      {
        staticProjectileAccessClass:
          'STATIC_ACCESS_UNRESOLVED',

        visibilityClass:
          'NOT_YET_CLASSIFIED',

        actionableOpportunityClass:
          'NOT_YET_CLASSIFIED'
      }
  };
}


function buildStaticSnapshot({
  tick,
  attackableStartTick,
  state,
  orb,
  probeResults,
  tickClass
}) {

  return {
    tick,

    ticksAfterAttackableStart:
      tick -
      attackableStartTick,

    secondsAfterAttackableStart:
      (
        tick -
        attackableStartTick
      ) /
      TICK_RATE,

    tickClass,

    playerPosition:
      state.position,

    playerStateMethod:
      state.method,

    orbPosition:
      orb.position,

    orbMethod:
      orb.method,

    probes:
      probeResults
  };
}


// ============================================================
// PLAYER STATE
// ============================================================

async function loadCompactPlayerState(
  path
) {

  const byPlayer =
    new Map();


  let rowsParsed =
    0;


  let parseFailures =
    0;


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


    let row;


    try {

      row =
        JSON.parse(
          line
        );

    } catch {

      parseFailures++;

      continue;
    }


    rowsParsed++;


    const compact =
      compactPlayerState(
        row
      );


    if (
      !compact.playerName
      ||
      compact.tick ===
      null
    ) {

      continue;
    }


    if (
      !byPlayer.has(
        compact.playerName
      )
    ) {

      byPlayer.set(
        compact.playerName,
        []
      );
    }


    byPlayer
      .get(
        compact.playerName
      )
      .push(
        compact
      );
  }


  for (
    const rows
    of byPlayer.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );
  }


  return {
    rowsParsed,
    parseFailures,
    byPlayer
  };
}


function compactPlayerState(
  row
) {

  const alive =
    row
      ?.controller
      ?.alive ===
    true;


  const lifeState =
    finite(
      row
        ?.pawn
        ?.lifeState
    );


  const positionValid =
    row
      ?.pawn
      ?.positionValidForMovement ===
    true
    &&
    alive
    &&
    (
      lifeState ===
      null
      ||
      lifeState ===
      0
    );


  return {
    tick:
      finite(
        row.demoTick
      ),

    playerName:
      row
        ?.controller
        ?.playerName
      ??
      null,

    team:
      finite(
        row
          ?.controller
          ?.team
      ),

    heroId:
      finite(
        row
          ?.controller
          ?.heroId
      ),

    alive,

    position:
      positionValid
        ? normalizePosition(
            row
              ?.pawn
              ?.positionWorld
          )
        : null
  };
}


function reconstructPlayerStateAtTick({
  rows,
  tick
}) {

  if (
    rows.length ===
    0
  ) {

    return unresolvedPlayerState(
      tick
    );
  }


  const index =
    lowerBoundByTick(
      rows,
      tick
    );


  const after =
    index <
    rows.length
      ? rows[
          index
        ]
      : null;


  const before =
    index >
    0
      ? rows[
          index -
          1
        ]
      : null;


  if (
    after
    &&
    after.tick ===
    tick
  ) {

    return {
      method:
        'EXACT_4HZ_SAMPLE',

      stateResolved:
        true,

      targetTick:
        tick,

      alive:
        after.alive,

      team:
        after.team,

      heroId:
        after.heroId,

      position:
        after.position
    };
  }


  if (
    before
    &&
    after
    &&
    before.tick <
    tick
    &&
    after.tick >
    tick
    &&
    after.tick -
    before.tick <=
    MAX_INTERPOLATION_GAP_TICKS
  ) {

    if (
      before.alive !==
      after.alive
    ) {

      return {
        ...unresolvedPlayerState(
          tick
        ),

        method:
          'ALIVE_STATE_TRANSITION_UNRESOLVED'
      };
    }


    if (
      before.alive ===
      false
      &&
      after.alive ===
      false
    ) {

      return {
        method:
          'BRACKET_DEAD_4HZ',

        stateResolved:
          true,

        targetTick:
          tick,

        alive:
          false,

        team:
          before.team ??
          after.team ??
          null,

        heroId:
          before.heroId ??
          after.heroId ??
          null,

        position:
          null
      };
    }


    const alpha =
      (
        tick -
        before.tick
      ) /
      (
        after.tick -
        before.tick
      );


    return {
      method:
        'BRACKET_INTERPOLATED_4HZ',

      stateResolved:
        true,

      targetTick:
        tick,

      alive:
        true,

      team:
        before.team ??
        after.team ??
        null,

      heroId:
        before.heroId ??
        after.heroId ??
        null,

      position:
        before.position
        &&
        after.position
          ? interpolatePosition(
              before.position,
              after.position,
              alpha
            )
          : null
    };
  }


  const nearest =
    chooseNearestState(
      before,
      after,
      tick
    );


  if (
    nearest
    &&
    Math.abs(
      nearest.tick -
      tick
    ) <=
    MAX_NEAREST_STATE_OFFSET_TICKS
  ) {

    return {
      method:
        nearest.tick <
        tick
          ? 'NEAREST_BEFORE_4HZ_PROXY'
          : 'NEAREST_AFTER_4HZ_PROXY',

      stateResolved:
        true,

      targetTick:
        tick,

      alive:
        nearest.alive,

      team:
        nearest.team,

      heroId:
        nearest.heroId,

      position:
        nearest.alive
          ? nearest.position
          : null
    };
  }


  return unresolvedPlayerState(
    tick
  );
}


function unresolvedPlayerState(
  tick
) {

  return {
    method:
      'UNRESOLVED',

    stateResolved:
      false,

    targetTick:
      tick,

    alive:
      null,

    team:
      null,

    heroId:
      null,

    position:
      null
  };
}


function lowerBoundByTick(
  rows,
  target
) {

  let low =
    0;


  let high =
    rows.length;


  while (
    low <
    high
  ) {

    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );


    if (
      rows[
        mid
      ].tick <
      target
    ) {

      low =
        mid +
        1;

    } else {

      high =
        mid;
    }
  }


  return low;
}


function chooseNearestState(
  before,
  after,
  tick
) {

  if (
    !before
  ) {

    return after;
  }


  if (
    !after
  ) {

    return before;
  }


  return Math.abs(
    tick -
    before.tick
  ) <=
  Math.abs(
    after.tick -
    tick
  )
    ? before
    : after;
}


function interpolatePosition(
  a,
  b,
  alpha
) {

  return {
    x:
      a.x +
      (
        b.x -
        a.x
      ) *
      alpha,

    y:
      a.y +
      (
        b.y -
        a.y
      ) *
      alpha,

    z:
      a.z +
      (
        b.z -
        a.z
      ) *
      alpha
  };
}


// ============================================================
// ORB TRAJECTORY
// ============================================================

function buildTrajectoryIndex(
  rows
) {

  const result =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      !row.eventId
    ) {

      continue;
    }


    const tick =
      finite(
        row.tick
      );


    const position =
      normalizePosition(
        row.position
      );


    if (
      tick ===
      null
      ||
      !position
    ) {

      continue;
    }


    if (
      !result.has(
        row.eventId
      )
    ) {

      result.set(
        row.eventId,
        {
          byTick:
            new Map(),

          ticks:
            []
        }
      );
    }


    result
      .get(
        row.eventId
      )
      .byTick
      .set(
        tick,
        position
      );
  }


  for (
    const target
    of result.values()
  ) {

    target.ticks =
      [
        ...target.byTick.keys()
      ].sort(
        (
          a,
          b
        ) =>
          a -
          b
      );
  }


  return result;
}


function resolveOrbPositionAtTick({
  trajectory,
  tick
}) {

  if (
    !trajectory
  ) {

    return {
      method:
        'UNRESOLVED',

      position:
        null
    };
  }


  const exact =
    trajectory.byTick.get(
      tick
    )
    ??
    null;


  if (
    exact
  ) {

    return {
      method:
        'EXACT_TRAJECTORY_TICK',

      position:
        exact
    };
  }


  const nearestTick =
    nearestSortedValue(
      trajectory.ticks,
      tick
    );


  if (
    nearestTick !==
    null
    &&
    Math.abs(
      nearestTick -
      tick
    ) <=
    MAX_NEAREST_ORB_OFFSET_TICKS
  ) {

    return {
      method:
        'NEAREST_TRAJECTORY_TICK',

      observedTick:
        nearestTick,

      position:
        trajectory.byTick.get(
          nearestTick
        )
        ??
        null
    };
  }


  return {
    method:
      'UNRESOLVED',

    position:
      null
  };
}


function nearestSortedValue(
  sorted,
  target
) {

  if (
    sorted.length ===
    0
  ) {

    return null;
  }


  let low =
    0;


  let high =
    sorted.length -
    1;


  while (
    low <=
    high
  ) {

    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );


    const value =
      sorted[
        mid
      ];


    if (
      value ===
      target
    ) {

      return value;
    }


    if (
      value <
      target
    ) {

      low =
        mid +
        1;

    } else {

      high =
        mid -
        1;
    }
  }


  const lower =
    high >=
    0
      ? sorted[
          high
        ]
      : null;


  const upper =
    low <
    sorted.length
      ? sorted[
          low
        ]
      : null;


  if (
    lower ===
    null
  ) {

    return upper;
  }


  if (
    upper ===
    null
  ) {

    return lower;
  }


  return Math.abs(
    target -
    lower
  ) <=
  Math.abs(
    upper -
    target
  )
    ? lower
    : upper;
}


// ============================================================
// GLB
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
        'Malformed GLB chunk.'
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
      'GLB JSON/BIN missing.'
    );
  }


  return {
    buffer,
    json,
    binStart
  };
}


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


    const node =
      nodes.find(
        candidate =>
          candidate?.mesh ===
          meshIndex
      )
      ??
      null;


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


      if (
        (
          primitive.mode
          ??
          4
        ) !==
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


      const meshName =
        String(
          mesh.name
          ??
          `mesh_${meshIndex}`
        );


      const interactAs =
        Array.isArray(
          node?.extras?.InteractAs
        )
          ? node.extras.InteractAs.map(
              String
            )
          : [];


      output.push(
        {
          readerIndex:
            output.length,

          meshIndex,

          primitiveIndex,

          meshName,

          interactAs,

          primaryFilterIncluded:
            isBulletSolidCandidate({
              meshName,
              interactAs
            }),

          positionAccessor,

          indexAccessor,

          triangleCount:
            Math.floor(
              indexCount /
              3
            )
        }
      );
    }
  }


  return output;
}


function isBulletSolidCandidate({
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


  return !passBullets
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
    );
}


function createAccessorReader(
  glb,
  accessorIndex
) {

  const accessor =
    glb.json.accessors?.[
      accessorIndex
    ];


  const bufferView =
    glb.json.bufferViews?.[
      accessor?.bufferView
    ];


  if (
    !accessor
    ||
    !bufferView
  ) {

    throw new Error(
      `Invalid accessor ${accessorIndex}.`
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


  const stride =
    bufferView.byteStride
    ??
    componentBytes *
    components;


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
    type:
      accessor.type,

    componentType:
      accessor.componentType,

    count:
      accessor.count,

    min:
      accessor.min ??
      null,

    max:
      accessor.max ??
      null,

    stride,

    byteOffset,

    getIndex(
      index
    ) {

      const offset =
        byteOffset +
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
            `Unsupported index type ${accessor.componentType}.`
          );
      }
    },


    getVec3(
      index,
      out =
        {}
    ) {

      const offset =
        byteOffset +
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
        `Unsupported componentType ${componentType}.`
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


function aggregatePrimitiveBounds(
  readers
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
    of readers
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
    ) {

      throw new Error(
        `Missing bounds for ${reader.meshName}.`
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
          bounds.max.x -
          bounds.min.x
        ) /
        cellSize
      ) +
      1
    );


  const ny =
    Math.max(
      1,
      Math.floor(
        (
          bounds.max.y -
          bounds.min.y
        ) /
        cellSize
      ) +
      1
    );


  const nz =
    Math.max(
      1,
      Math.floor(
        (
          bounds.max.z -
          bounds.min.z
        ) /
        cellSize
      ) +
      1
    );


  const cellCount =
    nx *
    ny *
    nz;


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


      if (
        range.cellSpan >
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
          minXValue -
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
          minYValue -
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
          minZValue -
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
          maxXValue -
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
          maxYValue -
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
          maxZValue -
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
        maxX -
        minX +
        1
      ) *
      (
        maxY -
        minY +
        1
      ) *
      (
        maxZ -
        minZ +
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

  return ix +
    nx *
    (
      iy +
      ny *
      iz
    );
}


// ============================================================
// RAYCAST
// ============================================================

function raycastSegment({
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


  let nearestT =
    Infinity;


  let nearestTriangleId =
    -1;


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


      const primitiveIndex =
        grid.triPrimitive[
          triangleId
        ];


      const reader =
        primitiveReaders[
          primitiveIndex
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
        segmentLengthHU -
        targetClearanceHU
      ) {

        return;
      }


      if (
        t <
        nearestT
      ) {

        nearestT =
          t;


        nearestTriangleId =
          triangleId;
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


  if (
    nearestTriangleId <
    0
  ) {

    return null;
  }


  const primitiveIndex =
    grid.triPrimitive[
      nearestTriangleId
    ];


  const reader =
    primitiveReaders[
      primitiveIndex
    ];


  return {
    t:
      nearestT,

    distanceHU:
      nearestT *
      segmentLengthHU,

    segmentLengthHU,

    triangleId:
      nearestTriangleId,

    primitiveIndex,

    meshName:
      reader.meshName,

    interactAs:
      reader.interactAs
  };
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
    e2z -
    dz *
    e2y;


  const hy =
    dz *
    e2x -
    dx *
    e2z;


  const hz =
    dx *
    e2y -
    dy *
    e2x;


  const det =
    e1x *
    hx +
    e1y *
    hy +
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
      hx +
      sy *
      hy +
      sz *
      hz
    ) *
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
    e1z -
    sz *
    e1y;


  const qy =
    sz *
    e1x -
    sx *
    e1z;


  const qz =
    sx *
    e1y -
    sy *
    e1x;


  const v =
    (
      dx *
      qx +
      dy *
      qy +
      dz *
      qz
    ) *
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
      qx +
      e2y *
      qy +
      e2z *
      qz
    ) *
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
      ] -
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
// NUMERIC / COLLECTION
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
    dx +
    dy *
    dy +
    dz *
    dz
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
    ) +
    1
  );
}


function incrementBy(
  map,
  key,
  amount
) {

  map.set(
    key,
    (
      map.get(
        key
      )
      ??
      0
    ) +
    amount
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
        b[1] -
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
// CONSOLE / MARKDOWN
// ============================================================

function printReplayResult(
  row
) {

  console.log('');

  console.log(
    'CANDIDATE COVERAGE'
  );

  console.log(
    `  candidates:                  ${row.candidates.total}`
  );

  console.log(
    `  prior alive geometry:        ${row.coverage.aliveGeometryCandidates}`
  );

  console.log(
    `  static evaluated:            ${row.coverage.staticEvaluatedCandidates}/${row.coverage.aliveGeometryCandidates} (${formatPercent(row.coverage.staticEvaluatedCandidateRateAmongAliveGeometry)})`
  );

  console.log('');

  console.log(
    'STATIC ACCESS'
  );

  console.log(
    `  evaluated ticks:             ${row.coverage.evaluatedTicks}`
  );

  console.log(
    `  robust clear ticks:          ${row.staticAccess.robustClearTicks} (${formatPercent(row.staticAccess.robustClearTickRate)})`
  );

  console.log(
    `  robust blocked ticks:        ${row.staticAccess.robustBlockedTicks} (${formatPercent(row.staticAccess.robustBlockedTickRate)})`
  );

  console.log(
    `  origin-sensitive ticks:      ${row.staticAccess.originSensitiveTicks} (${formatPercent(row.staticAccess.originSensitiveTickRate)})`
  );

  console.log(
    `  candidates ever robust clear:${row.staticAccess.everRobustClearCandidates}/${row.coverage.staticEvaluatedCandidates} (${formatPercent(row.staticAccess.everRobustClearRateAmongEvaluated)})`
  );

  console.log('');

  console.log(
    'POSITIVE HIT CANDIDATES'
  );

  console.log(
    `  observed hit candidates:     ${row.positiveControls.observedHitCandidates}`
  );

  console.log(
    `  ever robust static clear:    ${row.positiveControls.everRobustClear}/${row.positiveControls.observedHitCandidates} (${formatPercent(row.positiveControls.everRobustClearRate)})`
  );

  console.log(
    `  never robust static clear:   ${row.positiveControls.neverRobustClear}`
  );

  console.log('');

  console.log(
    'TOP STATIC BLOCKER MESHES'
  );


  for (
    const [
      mesh,
      count
    ]
    of Object.entries(
      row.blockers.robustBlockedPrimaryMeshes
    ).slice(
      0,
      8
    )
  ) {

    console.log(
      `  ${String(count).padStart(7)}  ${mesh}`
    );
  }

  console.log('');

  console.log(
    `VALIDATION:                    ${row.validation.pass ? 'PASS' : 'FAIL'}`
  );
}


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


function formatDistribution(
  row
) {

  if (
    !row
    ||
    row.count ===
    0
  ) {

    return 'n=0';
  }


  return `n=${row.count} min=${formatNumber(row.min)} p25=${formatNumber(row.p25)} median=${formatNumber(row.median)} p75=${formatNumber(row.p75)} max=${formatNumber(row.max)}`;
}


function formatBounds(
  bounds
) {

  return `min=[${formatNumber(bounds.min.x)},${formatNumber(bounds.min.y)},${formatNumber(bounds.min.z)}] max=[${formatNumber(bounds.max.x)},${formatNumber(bounds.max.y)},${formatNumber(bounds.max.z)}]`;
}


function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Flying-Soul Static Projectile Access Windows'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Meaning'
  );


  lines.push('');


  lines.push(
    'Each Script117 player × flying-soul candidate is evaluated across its attackable analysis window against the validated static dl_midtown projectile-blocking mesh.'
  );


  lines.push('');


  lines.push(
    'Two vertical firing-origin probes (pawn Z+64 HU and Z+80 HU) are used so exact hero muzzle height is not silently assumed.'
  );


  lines.push('');


  lines.push(
    '- `ROBUST_STATIC_CLEAR`: both probes clear.'
  );


  lines.push(
    '- `ROBUST_STATIC_BLOCKED`: both probes blocked.'
  );


  lines.push(
    '- `ORIGIN_SENSITIVE`: the probes disagree.'
  );


  lines.push('');


  lines.push(
    '## Critical guardrail'
  );


  lines.push('');


  lines.push(
    'Static projectile clearance is **not** the same as visual access and is **not** an actionable-opportunity label. Dynamic occluders, visual opacity, weapon state, hero projectile mechanics, and temporal reachability remain unresolved.'
  );


  lines.push('');


  lines.push(
    '## Cross-replay'
  );


  lines.push('');


  lines.push(
    `- Candidate rows: ${summary.crossReplay.candidateRows}`
  );


  lines.push(
    `- Alive-geometry candidates: ${summary.crossReplay.aliveGeometryCandidates}`
  );


  lines.push(
    `- Static-evaluated coverage: ${formatPercent(summary.crossReplay.evaluatedCandidateCoverage)}`
  );


  lines.push(
    `- Observed-hit candidates ever robust static clear: ${summary.crossReplay.positiveHitEverRobustClear}/${summary.crossReplay.positiveHitCandidates} (${formatPercent(summary.crossReplay.positiveHitEverRobustClearRate)})`
  );


  lines.push('');


  lines.push(
    '## Replay results'
  );


  lines.push('');


  for (
    const replay
    of summary.replays
  ) {

    lines.push(
      `### ${replay.replay}`
    );


    lines.push('');


    lines.push(
      `- Candidates: ${replay.candidates.total}`
    );


    lines.push(
      `- Static evaluated among prior alive geometry: ${formatPercent(replay.coverage.staticEvaluatedCandidateRateAmongAliveGeometry)}`
    );


    lines.push(
      `- Robust-clear tick rate: ${formatPercent(replay.staticAccess.robustClearTickRate)}`
    );


    lines.push(
      `- Robust-blocked tick rate: ${formatPercent(replay.staticAccess.robustBlockedTickRate)}`
    );


    lines.push(
      `- Origin-sensitive tick rate: ${formatPercent(replay.staticAccess.originSensitiveTickRate)}`
    );


    lines.push(
      `- Observed-hit candidates ever robust clear: ${formatPercent(replay.positiveControls.everRobustClearRate)}`
    );


    lines.push(
      `- Validation: **${replay.validation.pass ? 'PASS' : 'FAIL'}**`
    );


    lines.push('');
  }


  lines.push(
    '## Next stage'
  );


  lines.push('');


  lines.push(
    summary.interpretation.nextStage
  );


  lines.push('');


  return lines.join(
    '\n'
  );
}