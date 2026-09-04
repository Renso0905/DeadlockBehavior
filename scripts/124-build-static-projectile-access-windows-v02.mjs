import {
  createHash
} from 'node:crypto';

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_V02';


// ============================================================
// PURPOSE
//
// V01 proved computationally impractical because it rebuilt the
// same Midtown acceleration structure and then performed dense
// raycasts with expensive per-triangle GLB accessor reads.
//
// V02 keeps the exhaustive per-tick static-access calculation,
// but changes the COMPUTATION, not the behavioral construct:
//
//   1. one replay per invocation (rep01 by default)
//   2. reusable map-level binary collision cache
//   3. flattened triangle coordinates for fast intersection
//   4. 512-HU acceleration grid
//   5. early exit on first blocking triangle
//   6. progress every 100 candidates with ETA
//   7. atomic 100-candidate checkpoint chunks; rerunning resumes
//
// Static tick classification remains:
//
//   ROBUST_STATIC_CLEAR
//     Z+64 and Z+80 both clear
//
//   ROBUST_STATIC_BLOCKED
//     Z+64 and Z+80 both blocked
//
//   ORIGIN_SENSITIVE
//     the two origin probes disagree
//
// STATIC CLEAR IS NOT LOS AND IS NOT ACTIONABLE OPPORTUNITY.
// ============================================================


// ============================================================
// SETTINGS
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


// Smaller than V01's 1024-HU cells.
const GRID_CELL_SIZE_HU =
  512;


const MAX_CELLS_PER_TRIANGLE =
  256;


const ORIGIN_Z_OFFSETS_HU =
  [
    64,
    80
  ];


const PRIMARY_FILTER =
  'BULLET_SOLID_CANDIDATE_V01';


const START_CLEARANCE_HU =
  4;


const TARGET_CLEARANCE_HU =
  4;


const CHUNK_SIZE_CANDIDATES =
  100;


const PROGRESS_EVERY_CANDIDATES =
  100;


const VALIDATION =
  {
    minimumEvaluatedCandidateCoverageAmongPriorAliveGeometry:
      0.99,

    minimumPositiveHitCandidateEverRobustClearRate:
      0.95
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


const CACHE_DIRECTORY =
  resolve(
    'resources',
    'dl_midtown',
    'world_physics_v01',
    'static_bullet_grid_cache_v02'
  );


const CACHE_METADATA_PATH =
  resolve(
    CACHE_DIRECTORY,
    'metadata.json'
  );


const CACHE_TRIANGLES_PATH =
  resolve(
    CACHE_DIRECTORY,
    'triangles_f32.bin'
  );


const CACHE_TRIANGLE_MESH_PATH =
  resolve(
    CACHE_DIRECTORY,
    'triangle_mesh_u8.bin'
  );


const CACHE_OFFSETS_PATH =
  resolve(
    CACHE_DIRECTORY,
    'grid_offsets_u32.bin'
  );


const CACHE_MEMBERS_PATH =
  resolve(
    CACHE_DIRECTORY,
    'grid_members_u32.bin'
  );


const CACHE_LARGE_TRIANGLES_PATH =
  resolve(
    CACHE_DIRECTORY,
    'large_triangles_u32.bin'
  );


// ============================================================
// ARGS
// ============================================================

const args =
  parseArgs(
    process.argv.slice(2)
  );


const replayName =
  args.replay
  ??
  'rep01';


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


const allowedReplayNames =
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
  !allowedReplayNames.includes(
    replayName
  )
) {

  throw new Error(
    `Replay ${replayName} is not in Script117 cohort: ${allowedReplayNames.join(', ')}`
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


// ============================================================
// REPLAY PATHS
// ============================================================

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


const chunkDirectory =
  resolve(
    outputDirectory,
    'flying_soul_static_projectile_access_windows_v02_chunks'
  );


const runSignaturePath =
  resolve(
    chunkDirectory,
    'run_signature.json'
  );


const candidateOutputPath =
  resolve(
    outputDirectory,
    'flying_soul_static_projectile_access_windows_v02.jsonl'
  );


const replaySummaryPath =
  resolve(
    outputDirectory,
    'flying_soul_static_projectile_access_windows_summary_v02.json'
  );


const outputMarkdownPath =
  resolve(
    outputDirectory,
    'flying_soul_static_projectile_access_windows_summary_v02.md'
  );


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'FLYING-SOUL STATIC PROJECTILE ACCESS WINDOWS V0.2'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Replay:                    ${replayName}`
);

console.log(
  `Physics GLB:               ${physicsGlbPath}`
);

console.log(
  `Origin probes:             ${ORIGIN_Z_OFFSETS_HU.map(value => `Z+${value}`).join(', ')}`
);

console.log(
  `Collision filter:          ${PRIMARY_FILTER}`
);

console.log(
  `Grid cell size:            ${GRID_CELL_SIZE_HU} HU`
);

console.log(
  `Checkpoint chunk size:     ${CHUNK_SIZE_CANDIDATES} candidates`
);

console.log(
  `Resume enabled:            ${!args.fresh}`
);

console.log(
  'Raw .dem parsing:          NONE'
);

console.log(
  'LOS classification:        NONE'
);

console.log(
  'Opportunity classification:NONE'
);

console.log('');


// ============================================================
// MAP CACHE
// ============================================================

console.log(
  'Hashing physics GLB for cache identity...'
);


const physicsGlbSha256 =
  await sha256File(
    physicsGlbPath
  );


let collisionIndex;


if (
  !args.rebuildCache
  &&
  cacheLooksReusable({
    physicsGlbSha256,
    physicsGlbPath
  })
) {

  console.log(
    'Loading reusable Midtown collision cache...'
  );


  collisionIndex =
    loadCollisionCache();


  console.log(
    `Cache loaded: ${collisionIndex.totalTriangles} triangles, ${collisionIndex.members.length} cell assignments.`
  );

} else {

  if (
    args.rebuildCache
  ) {

    console.log(
      'Forced cache rebuild requested.'
    );

  } else {

    console.log(
      'No compatible collision cache found; building once for this Midtown GLB.'
    );
  }


  collisionIndex =
    buildAndSaveCollisionCache({
      physicsGlbPath,
      physicsGlbSha256
    });
}


console.log('');

console.log(
  'MAP-LEVEL COLLISION CACHE'
);

console.log(
  '-------------------------'
);

console.log(
  `triangles:                ${collisionIndex.totalTriangles}`
);

console.log(
  `meshes:                   ${collisionIndex.meshNames.length}`
);

console.log(
  `grid:                     ${collisionIndex.nx} x ${collisionIndex.ny} x ${collisionIndex.nz}`
);

console.log(
  `cells:                    ${collisionIndex.cellCount}`
);

console.log(
  `assignments:              ${collisionIndex.members.length}`
);

console.log(
  `large triangles:          ${collisionIndex.largeTriangles.length}`
);

console.log(
  `cache directory:          ${CACHE_DIRECTORY}`
);

console.log('');


// ============================================================
// LOAD REPLAY INPUTS
// ============================================================

console.log(
  'Loading Script117 candidates...'
);


const candidates =
  await loadJsonl(
    candidatePath
  );


console.log(
  `Candidates:                 ${candidates.length}`
);


console.log(
  'Loading tick-dense orb trajectory index...'
);


const trajectoryByEvent =
  await loadTrajectoryIndex(
    trajectoryPath
  );


console.log(
  `Trajectory events:          ${trajectoryByEvent.size}`
);


console.log(
  'Loading compact 4 Hz player-state index...'
);


const playerState =
  await loadCompactPlayerState(
    playerStatePath
  );


console.log(
  `Players:                    ${playerState.byPlayer.size}`
);

console.log('');


// ============================================================
// RUN SIGNATURE / RESUME
// ============================================================

const runSignature =
  {
    version:
      VERSION,

    replay:
      replayName,

    physicsGlbSha256,

    gridCellSizeHU:
      GRID_CELL_SIZE_HU,

    maxCellsPerTriangle:
      MAX_CELLS_PER_TRIANGLE,

    collisionFilter:
      PRIMARY_FILTER,

    originZOffsetsHU:
      ORIGIN_Z_OFFSETS_HU,

    candidateInput:
      fileIdentity(
        candidatePath
      ),

    trajectoryInput:
      fileIdentity(
        trajectoryPath
      ),

    playerStateInput:
      fileIdentity(
        playerStatePath
      ),

    candidateCount:
      candidates.length
  };


if (
  args.fresh
  &&
  existsSync(
    chunkDirectory
  )
) {

  console.log(
    'Fresh replay run requested; removing prior V02 checkpoint chunks.'
  );


  rmSync(
    chunkDirectory,
    {
      recursive:
        true,

      force:
        true
    }
  );
}


mkdirSync(
  chunkDirectory,
  {
    recursive:
      true
  }
);


if (
  existsSync(
    runSignaturePath
  )
) {

  const priorSignature =
    JSON.parse(
      readFileSync(
        runSignaturePath,
        'utf8'
      )
    );


  if (
    JSON.stringify(
      priorSignature
    ) !==
    JSON.stringify(
      runSignature
    )
  ) {

    console.log(
      'Replay inputs/settings changed; clearing stale V02 checkpoint chunks.'
    );


    rmSync(
      chunkDirectory,
      {
        recursive:
          true,

        force:
          true
      }
    );


    mkdirSync(
      chunkDirectory,
      {
        recursive:
          true
      }
    );
  }
}


writeFileSync(
  runSignaturePath,
  JSON.stringify(
    runSignature,
    null,
    2
  ),
  'utf8'
);


// ============================================================
// PROCESS CHUNKS
// ============================================================

const totalChunks =
  Math.ceil(
    candidates.length /
    CHUNK_SIZE_CANDIDATES
  );


let completedBeforeRun =
  0;


for (
  let chunkIndex =
    0;

  chunkIndex <
    totalChunks;

  chunkIndex++
) {

  const startIndex =
    chunkIndex *
    CHUNK_SIZE_CANDIDATES;


  const endIndexExclusive =
    Math.min(
      candidates.length,
      startIndex +
      CHUNK_SIZE_CANDIDATES
    );


  const path =
    chunkPath(
      chunkIndex
    );


  if (
    isValidChunkFile({
      path,
      startIndex,
      endIndexExclusive
    })
  ) {

    completedBeforeRun +=
      endIndexExclusive -
      startIndex;
  }
}


if (
  completedBeforeRun >
  0
) {

  console.log(
    `Resuming: ${completedBeforeRun}/${candidates.length} candidates already checkpointed.`
  );

  console.log('');
}


console.log(
  'Raycasting exhaustive per-tick static access...'
);

console.log('');


const workStartMs =
  Date.now();


let processedThisRun =
  0;


let raysThisRun =
  0;


for (
  let chunkIndex =
    0;

  chunkIndex <
    totalChunks;

  chunkIndex++
) {

  const startIndex =
    chunkIndex *
    CHUNK_SIZE_CANDIDATES;


  const endIndexExclusive =
    Math.min(
      candidates.length,
      startIndex +
      CHUNK_SIZE_CANDIDATES
    );


  const path =
    chunkPath(
      chunkIndex
    );


  if (
    isValidChunkFile({
      path,
      startIndex,
      endIndexExclusive
    })
  ) {

    continue;
  }


  const chunkRows =
    [];


  for (
    let candidateIndex =
      startIndex;

    candidateIndex <
      endIndexExclusive;

    candidateIndex++
  ) {

    const candidate =
      candidates[
        candidateIndex
      ];


    const result =
      evaluateCandidate({
        candidate,
        candidateIndex,
        playerRows:
          playerState.byPlayer.get(
            extractCandidatePlayerName(
              candidate
            )
          )
          ??
          [],
        trajectory:
          trajectoryByEvent.get(
            candidate.eventId
          )
          ??
          null,
        collisionIndex
      });


    raysThisRun +=
      result.diagnostics.raysCast;


    chunkRows.push(
      buildCandidateOutputRow({
        candidate,
        candidateIndex,
        result
      })
    );


    processedThisRun++;


    const absoluteCompleted =
      completedBeforeRun +
      processedThisRun;


    if (
      absoluteCompleted ===
      1
      ||
      absoluteCompleted %
      PROGRESS_EVERY_CANDIDATES ===
      0
      ||
      absoluteCompleted ===
      candidates.length
    ) {

      printProgress({
        absoluteCompleted,
        total:
          candidates.length,
        processedThisRun,
        raysThisRun,
        startedMs:
          workStartMs
      });
    }
  }


  writeJsonlAtomic(
    path,
    chunkRows
  );
}


// ============================================================
// MERGE CHUNKS + SUMMARY
// ============================================================

console.log('');

console.log(
  'All candidate chunks complete. Merging final replay output...'
);


const mergedTextParts =
  [];


const aggregate =
  createReplayAggregate();


for (
  let chunkIndex =
    0;

  chunkIndex <
    totalChunks;

  chunkIndex++
) {

  const path =
    chunkPath(
      chunkIndex
    );


  const text =
    readFileSync(
      path,
      'utf8'
    );


  mergedTextParts.push(
    text.endsWith(
      '\n'
    )
      ? text
      : `${text}\n`
  );


  for (
    const line
    of text.split(
      /\r?\n/
    )
  ) {

    if (
      !line.trim()
    ) {

      continue;
    }


    const row =
      JSON.parse(
        line
      );


    updateReplayAggregate(
      aggregate,
      row
    );
  }
}


writeFileSync(
  candidateOutputPath,
  mergedTextParts.join(
    ''
  ),
  'utf8'
);


const finalized =
  finalizeReplayAggregate({
    aggregate,
    totalCandidates:
      candidates.length
  });


const checks =
  {
    evaluatedCandidateCoverageAmongPriorAliveGeometry:
      {
        actual:
          finalized.coverage.staticEvaluatedCandidateRateAmongPriorAliveGeometry,

        expected:
          `>=${VALIDATION.minimumEvaluatedCandidateCoverageAmongPriorAliveGeometry}`,

        pass:
          Number.isFinite(
            finalized.coverage.staticEvaluatedCandidateRateAmongPriorAliveGeometry
          )
          &&
          finalized.coverage.staticEvaluatedCandidateRateAmongPriorAliveGeometry >=
          VALIDATION.minimumEvaluatedCandidateCoverageAmongPriorAliveGeometry
      },


    positiveHitCandidateEverRobustClearRate:
      {
        actual:
          finalized.positiveControls.everRobustClearRate,

        expected:
          `>=${VALIDATION.minimumPositiveHitCandidateEverRobustClearRate}`,

        pass:
          Number.isFinite(
            finalized.positiveControls.everRobustClearRate
          )
          &&
          finalized.positiveControls.everRobustClearRate >=
          VALIDATION.minimumPositiveHitCandidateEverRobustClearRate
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
    ? 'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_REPLAY_READY'
    : 'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_REPLAY_REQUIRES_DIAGNOSIS';


const summary =
  {
    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    replay:
      replayName,

    status,

    mapCache:
      {
        physicsGlbPath,
        physicsGlbSha256,

        cacheDirectory:
          CACHE_DIRECTORY,

        cacheVersion:
          collisionIndex.cacheVersion,

        gridCellSizeHU:
          GRID_CELL_SIZE_HU,

        totalTriangles:
          collisionIndex.totalTriangles,

        meshNames:
          collisionIndex.meshNames,

        cells:
          collisionIndex.cellCount,

        assignments:
          collisionIndex.members.length,

        largeTriangles:
          collisionIndex.largeTriangles.length
      },

    method:
      {
        outputUnit:
          'PLAYER_X_FLYING_SOUL_EVENT',

        exhaustiveAcrossCandidateAnalysisWindow:
          true,

        originProbesHU:
          ORIGIN_Z_OFFSETS_HU,

        collisionFilter:
          PRIMARY_FILTER,

        tickClasses:
          {
            ROBUST_STATIC_CLEAR:
              'both Z+64 and Z+80 probes clear',

            ROBUST_STATIC_BLOCKED:
              'both Z+64 and Z+80 probes blocked',

            ORIGIN_SENSITIVE:
              'one probe clear and one blocked',

            NOT_EVALUATED:
              'player/orb state unavailable or player not alive'
          },

        persistedTickRepresentation:
          'run-length encoded tick classes per candidate',

        resume:
          '100-candidate atomic chunk checkpoints'
      },

    candidates:
      finalized.candidates,

    coverage:
      finalized.coverage,

    staticAccess:
      finalized.staticAccess,

    positiveControls:
      finalized.positiveControls,

    blockers:
      finalized.blockers,

    distributions:
      finalized.distributions,

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
          'Static Midtown projectile-path access is persisted per candidate and per tick for this replay, using the Script123-validated collision substrate and two origin-height probes.',

        staticClearGuardrail:
          'ROBUST_STATIC_CLEAR is not visual visibility, weapon readiness, temporal reachability, action attempt, or actionable opportunity.',

        staticBlockedGuardrail:
          'ROBUST_STATIC_BLOCKED is an operational static-world blocking classification. Dynamic geometry and replay/map-version drift can still create disagreement.',

        reuse:
          'The binary Midtown acceleration cache is map-level and should be reused for rep02-rep05 and future compatible Midtown replays without rebuilding the map index.',

        nextStage:
          validationPass
            ? 'INSPECT_REPLAY_STATIC_ACCESS_THEN_REUSE_CACHE_FOR_LATER_REPLAYS_OR_ADD_DYNAMIC_VISUAL_ACCESS'
            : 'DIAGNOSE_REPLAY_STATIC_ACCESS_POSITIVE_CONTROLS'
      },

    performance:
      {
        completedBeforeRun,
        processedThisRun,
        raysThisRun,

        workElapsedSeconds:
          (
            Date.now() -
            workStartMs
          ) /
          1000
      },

    outputs:
      {
        candidates:
          candidateOutputPath,

        summary:
          replaySummaryPath,

        markdown:
          outputMarkdownPath,

        checkpoints:
          chunkDirectory
      }
  };


writeFileSync(
  replaySummaryPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  outputMarkdownPath,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// FINAL CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'REPLAY STATIC PROJECTILE ACCESS SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Replay:                        ${replayName}`
);

console.log(
  `Candidate rows:                ${summary.candidates.total}`
);

console.log(
  `Prior alive-geometry candidates:${summary.coverage.priorAliveGeometryCandidates}`
);

console.log(
  `Static-evaluated candidates:   ${summary.coverage.staticEvaluatedCandidates}/${summary.coverage.priorAliveGeometryCandidates} (${formatPercent(summary.coverage.staticEvaluatedCandidateRateAmongPriorAliveGeometry)})`
);

console.log(
  `Evaluated ticks:               ${summary.coverage.staticEvaluatedTicks}`
);

console.log('');

console.log(
  `Robust-clear ticks:            ${summary.staticAccess.robustClearTicks} (${formatPercent(summary.staticAccess.robustClearTickRate)})`
);

console.log(
  `Robust-blocked ticks:          ${summary.staticAccess.robustBlockedTicks} (${formatPercent(summary.staticAccess.robustBlockedTickRate)})`
);

console.log(
  `Origin-sensitive ticks:        ${summary.staticAccess.originSensitiveTicks} (${formatPercent(summary.staticAccess.originSensitiveTickRate)})`
);

console.log(
  `Candidates ever robust clear:  ${summary.staticAccess.everRobustClearCandidates}/${summary.coverage.staticEvaluatedCandidates} (${formatPercent(summary.staticAccess.everRobustClearRateAmongEvaluated)})`
);

console.log('');

console.log(
  `Observed-hit candidates:       ${summary.positiveControls.observedHitCandidates}`
);

console.log(
  `Hit candidates ever clear:     ${summary.positiveControls.everRobustClear}/${summary.positiveControls.observedHitCandidates} (${formatPercent(summary.positiveControls.everRobustClearRate)})`
);

console.log(
  `Hit candidates never clear:    ${summary.positiveControls.neverRobustClear}`
);

console.log('');

console.log(
  'TOP ROBUST-BLOCKED MESHES'
);

console.log(
  '-------------------------'
);


for (
  const [
    meshName,
    count
  ]
  of Object.entries(
    summary.blockers.robustBlockedFirstDetectedMeshes
  ).slice(
    0,
    12
  )
) {

  console.log(
    `${String(count).padStart(8)}  ${meshName}`
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
    `${name.padEnd(58)} ${row.pass}`
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
  `Candidates:\n${candidateOutputPath}`
);

console.log('');

console.log(
  `Summary:\n${replaySummaryPath}`
);

console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);

console.log('');


// ============================================================
// COLLISION CACHE
// ============================================================

function cacheLooksReusable({
  physicsGlbSha256,
  physicsGlbPath
}) {

  for (
    const path
    of [
      CACHE_METADATA_PATH,
      CACHE_TRIANGLES_PATH,
      CACHE_TRIANGLE_MESH_PATH,
      CACHE_OFFSETS_PATH,
      CACHE_MEMBERS_PATH,
      CACHE_LARGE_TRIANGLES_PATH
    ]
  ) {

    if (
      !existsSync(
        path
      )
    ) {

      return false;
    }
  }


  try {

    const metadata =
      JSON.parse(
        readFileSync(
          CACHE_METADATA_PATH,
          'utf8'
        )
      );


    return metadata?.cacheVersion ===
      'STATIC_BULLET_GRID_CACHE_V02'
      &&
      metadata?.physicsGlbSha256 ===
      physicsGlbSha256
      &&
      metadata?.physicsGlbBytes ===
      statSync(
        physicsGlbPath
      ).size
      &&
      metadata?.gridCellSizeHU ===
      GRID_CELL_SIZE_HU
      &&
      metadata?.maxCellsPerTriangle ===
      MAX_CELLS_PER_TRIANGLE
      &&
      metadata?.collisionFilter ===
      PRIMARY_FILTER;

  } catch {

    return false;
  }
}


function loadCollisionCache() {

  const metadata =
    JSON.parse(
      readFileSync(
        CACHE_METADATA_PATH,
        'utf8'
      )
    );


  const triangles =
    readFloat32Array(
      CACHE_TRIANGLES_PATH
    );


  const triangleMesh =
    Uint8Array.from(
      readFileSync(
        CACHE_TRIANGLE_MESH_PATH
      )
    );


  const offsets =
    readUint32Array(
      CACHE_OFFSETS_PATH
    );


  const members =
    readUint32Array(
      CACHE_MEMBERS_PATH
    );


  const largeTriangles =
    readUint32Array(
      CACHE_LARGE_TRIANGLES_PATH
    );


  if (
    triangles.length !==
    metadata.totalTriangles *
    9
    ||
    triangleMesh.length !==
    metadata.totalTriangles
    ||
    offsets.length !==
    metadata.cellCount +
    1
  ) {

    throw new Error(
      'Collision cache binary lengths do not match metadata. Use --rebuild-cache.'
    );
  }


  return {
    ...metadata,

    triangles,

    triangleMesh,

    offsets,

    members,

    largeTriangles,

    seenStamp:
      new Uint32Array(
        metadata.totalTriangles
      ),

    rayStamp:
      0
  };
}


function buildAndSaveCollisionCache({
  physicsGlbPath,
  physicsGlbSha256
}) {

  console.log(
    'Loading physics GLB for cache construction...'
  );


  const glb =
    loadGlb(
      physicsGlbPath
    );


  const allReaders =
    buildPrimitiveReaders(
      glb
    );


  const readers =
    allReaders.filter(
      reader =>
        reader.primaryFilterIncluded
    );


  if (
    readers.length ===
    0
  ) {

    throw new Error(
      'No BULLET_SOLID_CANDIDATE triangle primitives.'
    );
  }


  const bounds =
    aggregatePrimitiveBounds(
      readers
    );


  const nx =
    Math.max(
      1,
      Math.floor(
        (
          bounds.max.x -
          bounds.min.x
        ) /
        GRID_CELL_SIZE_HU
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
        GRID_CELL_SIZE_HU
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
        GRID_CELL_SIZE_HU
      ) +
      1
    );


  const cellCount =
    nx *
    ny *
    nz;


  const totalTriangles =
    sum(
      readers.map(
        row =>
          row.triangleCount
      )
    );


  console.log(
    `Filtered meshes: ${readers.length}/${allReaders.length}`
  );

  console.log(
    `Triangles:       ${totalTriangles}`
  );

  console.log(
    `Grid:            ${nx} x ${ny} x ${nz} = ${cellCount} cells`
  );

  console.log('');


  const triangles =
    new Float32Array(
      totalTriangles *
      9
    );


  const triangleMesh =
    new Uint8Array(
      totalTriangles
    );


  const counts =
    new Uint32Array(
      cellCount
    );


  const largeTriangles =
    [];


  let globalTriangleId =
    0;


  console.log(
    'Cache build pass 1/2: flattening triangles + counting grid assignments'
  );


  for (
    let meshIndex =
      0;

    meshIndex <
      readers.length;

    meshIndex++
  ) {

    const reader =
      readers[
        meshIndex
      ];


    console.log(
      `  ${String(meshIndex + 1).padStart(2)}/${readers.length} ${reader.meshName} triangles=${reader.triangleCount}`
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


      triangleMesh[
        triangleId
      ] =
        meshIndex;


      reader.copyTriangleToFlatArray({
        localTriangleIndex,

        destination:
          triangles,

        destinationOffset:
          triangleId *
          9
      });


      const range =
        triangleCellRangeFromFlat({
          triangles,
          triangleId,
          bounds,

          cellSize:
            GRID_CELL_SIZE_HU,

          nx,
          ny,
          nz
        });


      if (
        range.cellSpan >
        MAX_CELLS_PER_TRIANGLE
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

          let cell =
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
              cell++
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
    let cell =
      0;

    cell <
      cellCount;

    cell++
  ) {

    assignmentTotal +=
      counts[
        cell
      ];


    if (
      assignmentTotal >
      0xffffffff
    ) {

      throw new Error(
        'Grid assignment count exceeds Uint32 capacity.'
      );
    }


    offsets[
      cell +
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
    `Assignments: ${assignmentTotal}; large triangles: ${largeTriangles.length}`
  );


  console.log(
    'Cache build pass 2/2: filling grid membership'
  );


  for (
    let triangleId =
      0;

    triangleId <
      totalTriangles;

    triangleId++
  ) {

    const range =
      triangleCellRangeFromFlat({
        triangles,
        triangleId,
        bounds,

        cellSize:
          GRID_CELL_SIZE_HU,

        nx,
        ny,
        nz
      });


    if (
      range.cellSpan >
      MAX_CELLS_PER_TRIANGLE
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

        let cell =
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

          const targetCell =
            cell++;


          members[
            cursor[
              targetCell
            ]++
          ] =
            triangleId;
        }
      }
    }
  }


  mkdirSync(
    CACHE_DIRECTORY,
    {
      recursive:
        true
    }
  );


  console.log(
    'Writing reusable binary map cache...'
  );


  writeTypedArray(
    CACHE_TRIANGLES_PATH,
    triangles
  );


  writeTypedArray(
    CACHE_TRIANGLE_MESH_PATH,
    triangleMesh
  );


  writeTypedArray(
    CACHE_OFFSETS_PATH,
    offsets
  );


  writeTypedArray(
    CACHE_MEMBERS_PATH,
    members
  );


  const largeTrianglesArray =
    Uint32Array.from(
      largeTriangles
    );


  writeTypedArray(
    CACHE_LARGE_TRIANGLES_PATH,
    largeTrianglesArray
  );


  const metadata =
    {
      cacheVersion:
        'STATIC_BULLET_GRID_CACHE_V02',

      createdAt:
        new Date().toISOString(),

      physicsGlbPath,

      physicsGlbSha256,

      physicsGlbBytes:
        statSync(
          physicsGlbPath
        ).size,

      collisionFilter:
        PRIMARY_FILTER,

      gridCellSizeHU:
        GRID_CELL_SIZE_HU,

      maxCellsPerTriangle:
        MAX_CELLS_PER_TRIANGLE,

      bounds,

      nx,
      ny,
      nz,
      cellCount,
      totalTriangles,

      assignments:
        members.length,

      largeTriangleCount:
        largeTrianglesArray.length,

      meshNames:
        readers.map(
          row =>
            row.meshName
        ),

      meshTriangleCounts:
        readers.map(
          row =>
            row.triangleCount
        )
    };


  writeFileSync(
    CACHE_METADATA_PATH,
    JSON.stringify(
      metadata,
      null,
      2
    ),
    'utf8'
  );


  return {
    ...metadata,

    triangles,

    triangleMesh,

    offsets,

    members,

    largeTriangles:
      largeTrianglesArray,

    seenStamp:
      new Uint32Array(
        totalTriangles
      ),

    rayStamp:
      0
  };
}


function triangleCellRangeFromFlat({
  triangles,
  triangleId,
  bounds,
  cellSize,
  nx,
  ny,
  nz
}) {

  const offset =
    triangleId *
    9;


  const ax =
    triangles[
      offset
    ];

  const ay =
    triangles[
      offset +
      1
    ];

  const az =
    triangles[
      offset +
      2
    ];


  const bx =
    triangles[
      offset +
      3
    ];

  const by =
    triangles[
      offset +
      4
    ];

  const bz =
    triangles[
      offset +
      5
    ];


  const cx =
    triangles[
      offset +
      6
    ];

  const cy =
    triangles[
      offset +
      7
    ];

  const cz =
    triangles[
      offset +
      8
    ];


  const minX =
    clampInt(
      Math.floor(
        (
          Math.min(
            ax,
            bx,
            cx
          ) -
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
          Math.min(
            ay,
            by,
            cy
          ) -
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
          Math.min(
            az,
            bz,
            cz
          ) -
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
          Math.max(
            ax,
            bx,
            cx
          ) -
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
          Math.max(
            ay,
            by,
            cy
          ) -
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
          Math.max(
            az,
            bz,
            cz
          ) -
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


// ============================================================
// CANDIDATE EVALUATION
// ============================================================

function evaluateCandidate({
  candidate,
  candidateIndex,
  playerRows,
  trajectory,
  collisionIndex
}) {

  const eventId =
    candidate.eventId
    ??
    null;


  const playerName =
    extractCandidatePlayerName(
      candidate
    );


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


  const priorGeometryTicks =
    finite(
      candidate
        ?.geometry
        ?.coverage
        ?.geometryTicks
    )
    ??
    0;


  const priorAliveGeometry =
    priorGeometryTicks >
    0;


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

    return emptyCandidateResult({
      candidateIndex,
      priorAliveGeometry,
      priorGeometryTicks,
      attackableStartTick,
      analysisEndTick
    });
  }


  let windowTicks =
    0;

  let playerStateResolvedTicks =
    0;

  let alivePositionTicks =
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

  let notEvaluatedTicks =
    0;

  let raysCast =
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


  const blockerMeshes =
    new Map();


  const tickRuns =
    [];


  let currentTickClass =
    null;

  let currentRunStartTick =
    null;


  function pushTickClass(
    tick,
    tickClass
  ) {

    if (
      currentTickClass ===
      null
    ) {

      currentTickClass =
        tickClass;

      currentRunStartTick =
        tick;

      return;
    }


    if (
      currentTickClass ===
      tickClass
    ) {

      return;
    }


    tickRuns.push(
      {
        startTick:
          currentRunStartTick,

        endTick:
          tick -
          1,

        ticks:
          tick -
          currentRunStartTick,

        class:
          currentTickClass
      }
    );


    currentTickClass =
      tickClass;

    currentRunStartTick =
      tick;
  }


  for (
    let tick =
      attackableStartTick;

    tick <=
      analysisEndTick;

    tick++
  ) {

    windowTicks++;


    const playerStateAtTick =
      reconstructPlayerStateAtTick({
        rows:
          playerRows,

        tick
      });


    if (
      playerStateAtTick.stateResolved
    ) {

      playerStateResolvedTicks++;
    }


    if (
      playerStateAtTick.alive !==
      true
      ||
      !playerStateAtTick.position
    ) {

      notEvaluatedTicks++;

      currentClearRun =
        0;

      currentBlockedRun =
        0;


      pushTickClass(
        tick,
        'NOT_EVALUATED'
      );

      continue;
    }


    alivePositionTicks++;


    const orb =
      resolveOrbPositionAtTick({
        trajectory,
        tick
      });


    if (
      !orb.position
    ) {

      notEvaluatedTicks++;

      currentClearRun =
        0;

      currentBlockedRun =
        0;


      pushTickClass(
        tick,
        'NOT_EVALUATED'
      );

      continue;
    }


    orbResolvedTicks++;


    let clearProbeCount =
      0;


    let firstDetectedBlockerMesh =
      null;


    for (
      const zOffset
      of ORIGIN_Z_OFFSETS_HU
    ) {

      const start =
        {
          x:
            playerStateAtTick.position.x,

          y:
            playerStateAtTick.position.y,

          z:
            playerStateAtTick.position.z +
            zOffset
        };


      const blocker =
        raycastFirstBlocker({
          start,

          end:
            orb.position,

          collisionIndex,

          startClearanceHU:
            START_CLEARANCE_HU,

          targetClearanceHU:
            TARGET_CLEARANCE_HU
        });


      raysCast++;


      if (
        blocker
      ) {

        firstDetectedBlockerMesh =
          firstDetectedBlockerMesh
          ??
          blocker.meshName;

      } else {

        clearProbeCount++;
      }
    }


    staticEvaluatedTicks++;


    if (
      clearProbeCount ===
      ORIGIN_Z_OFFSETS_HU.length
    ) {

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
      }


      pushTickClass(
        tick,
        'ROBUST_STATIC_CLEAR'
      );

    } else if (
      clearProbeCount ===
      0
    ) {

      robustBlockedTicks++;

      currentBlockedRun++;

      currentClearRun =
        0;


      longestBlockedRun =
        Math.max(
          longestBlockedRun,
          currentBlockedRun
        );


      if (
        firstRobustBlockedTick ===
        null
      ) {

        firstRobustBlockedTick =
          tick;
      }


      increment(
        blockerMeshes,

        firstDetectedBlockerMesh
        ??
        'UNKNOWN'
      );


      pushTickClass(
        tick,
        'ROBUST_STATIC_BLOCKED'
      );

    } else {

      originSensitiveTicks++;

      currentClearRun =
        0;

      currentBlockedRun =
        0;


      if (
        firstOriginSensitiveTick ===
        null
      ) {

        firstOriginSensitiveTick =
          tick;
      }


      pushTickClass(
        tick,
        'ORIGIN_SENSITIVE'
      );
    }
  }


  if (
    currentTickClass !==
    null
  ) {

    tickRuns.push(
      {
        startTick:
          currentRunStartTick,

        endTick:
          analysisEndTick,

        ticks:
          analysisEndTick -
          currentRunStartTick +
          1,

        class:
          currentTickClass
      }
    );
  }


  return {
    priorAliveGeometry,

    priorGeometryTicks,

    window:
      {
        attackableStartTick,
        analysisEndTick,
        windowTicks
      },

    coverage:
      {
        playerStateResolvedTicks,
        alivePositionTicks,
        orbResolvedTicks,
        staticEvaluatedTicks,
        notEvaluatedTicks,

        staticEvaluatedTickRate:
          rate(
            staticEvaluatedTicks,
            windowTicks
          )
      },

    staticAccess:
      {
        robustClearTicks,
        robustBlockedTicks,
        originSensitiveTicks,

        robustClearFraction:
          rate(
            robustClearTicks,
            staticEvaluatedTicks
          ),

        robustBlockedFraction:
          rate(
            robustBlockedTicks,
            staticEvaluatedTicks
          ),

        originSensitiveFraction:
          rate(
            originSensitiveTicks,
            staticEvaluatedTicks
          ),

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
          TICK_RATE
      },

    tickRuns,

    blockers:
      {
        firstDetectedMeshCounts:
          mapToSortedObject(
            blockerMeshes
          ),

        semanticGuardrail:
          'First detected blocker is sufficient for blocked/clear classification but is not guaranteed to be the nearest blocker.'
      },

    diagnostics:
      {
        raysCast
      }
  };
}


function emptyCandidateResult({
  candidateIndex,
  priorAliveGeometry,
  priorGeometryTicks,
  attackableStartTick,
  analysisEndTick
}) {

  return {
    priorAliveGeometry,

    priorGeometryTicks,

    window:
      {
        attackableStartTick,
        analysisEndTick,
        windowTicks:
          0
      },

    coverage:
      {
        playerStateResolvedTicks:
          0,

        alivePositionTicks:
          0,

        orbResolvedTicks:
          0,

        staticEvaluatedTicks:
          0,

        notEvaluatedTicks:
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
          0
      },

    tickRuns:
      [],

    blockers:
      {
        firstDetectedMeshCounts:
          {},

        semanticGuardrail:
          'UNRESOLVED'
      },

    diagnostics:
      {
        raysCast:
          0,

        unresolvedCandidateIndex:
          candidateIndex
      }
  };
}


function buildCandidateOutputRow({
  candidate,
  candidateIndex,
  result
}) {

  return {
    schemaVersion:
      2,

    canonical:
      false,

    replay:
      replayName,

    candidateIndex,

    candidateId:
      candidate.candidateId
      ??
      null,

    eventId:
      candidate.eventId
      ??
      null,

    player:
      candidate.player
      ??
      {
        playerName:
          extractCandidatePlayerName(
            candidate
          )
      },

    role:
      candidate.role
      ??
      null,

    stimulus:
      candidate.stimulus
      ??
      null,

    observedResponseOutcome:
      candidate.observedResponseOutcome
      ??
      null,

    priorAliveGeometry:
      result.priorAliveGeometry,

    priorGeometryTicks:
      result.priorGeometryTicks,

    staticProjectileAccess:
      {
        window:
          result.window,

        coverage:
          result.coverage,

        staticAccess:
          result.staticAccess,

        tickRuns:
          result.tickRuns,

        blockers:
          result.blockers,

        semanticStatus:
          'STATIC_WORLD_PROJECTILE_PATH_PROXY_ONLY'
      },

    diagnostics:
      result.diagnostics,

    interpretation:
      {
        visibilityClass:
          'NOT_YET_CLASSIFIED',

        dynamicProjectileAccessClass:
          'NOT_YET_CLASSIFIED',

        actionableOpportunityClass:
          'NOT_YET_CLASSIFIED',

        warning:
          'Static projectile clearance is not equivalent to visibility, weapon readiness, temporal reachability, attempt, success, or actionable opportunity.'
      }
  };
}


function extractCandidatePlayerName(
  candidate
) {

  return candidate
    ?.player
    ?.playerName
    ??
    candidate
      ?.playerName
    ??
    null;
}


// ============================================================
// FAST RAYCAST
// ============================================================

function raycastFirstBlocker({
  start,
  end,
  collisionIndex,
  startClearanceHU,
  targetClearanceHU
}) {

  const segmentLengthHU =
    distance3D(
      start,
      end
    );


  if (
    !Number.isFinite(
      segmentLengthHU
    )
    ||
    segmentLengthHU <=
    startClearanceHU +
    targetClearanceHU
  ) {

    return null;
  }


  collisionIndex.rayStamp++;


  if (
    collisionIndex.rayStamp >=
    0xfffffffe
  ) {

    collisionIndex.seenStamp.fill(
      0
    );


    collisionIndex.rayStamp =
      1;
  }


  const stamp =
    collisionIndex.rayStamp;


  const minimumT =
    startClearanceHU /
    segmentLengthHU;


  const maximumT =
    1 -
    targetClearanceHU /
    segmentLengthHU;


  const testTriangle =
    triangleId => {

      if (
        collisionIndex.seenStamp[
          triangleId
        ] ===
        stamp
      ) {

        return null;
      }


      collisionIndex.seenStamp[
        triangleId
      ] =
        stamp;


      const t =
        segmentTriangleIntersectionTFlat({
          start,
          end,

          triangles:
            collisionIndex.triangles,

          triangleId
        });


      if (
        t ===
        null
        ||
        t <=
        minimumT
        ||
        t >=
        maximumT
      ) {

        return null;
      }


      return {
        triangleId,

        t,

        distanceHU:
          t *
          segmentLengthHU,

        meshName:
          collisionIndex.meshNames[
            collisionIndex.triangleMesh[
              triangleId
            ]
          ]
          ??
          'UNKNOWN'
      };
    };


  for (
    const triangleId
    of collisionIndex.largeTriangles
  ) {

    const hit =
      testTriangle(
        triangleId
      );


    if (
      hit
    ) {

      return hit;
    }
  }


  const clipped =
    clipSegmentToBounds(
      start,
      end,
      collisionIndex.bounds
    );


  if (
    !clipped
  ) {

    return null;
  }


  let found =
    null;


  traverseGridSegment({
    start,
    end,

    tStart:
      clipped.tStart,

    tEnd:
      clipped.tEnd,

    grid:
      collisionIndex,


    visitCell(
      cell
    ) {

      const begin =
        collisionIndex.offsets[
          cell
        ];


      const finish =
        collisionIndex.offsets[
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

        const hit =
          testTriangle(
            collisionIndex.members[
              index
            ]
          );


        if (
          hit
        ) {

          found =
            hit;

          return false;
        }
      }


      return true;
    }
  });


  return found;
}


function segmentTriangleIntersectionTFlat({
  start,
  end,
  triangles,
  triangleId
}) {

  const offset =
    triangleId *
    9;


  const ax =
    triangles[
      offset
    ];

  const ay =
    triangles[
      offset +
      1
    ];

  const az =
    triangles[
      offset +
      2
    ];


  const bx =
    triangles[
      offset +
      3
    ];

  const by =
    triangles[
      offset +
      4
    ];

  const bz =
    triangles[
      offset +
      5
    ];


  const cx =
    triangles[
      offset +
      6
    ];

  const cy =
    triangles[
      offset +
      7
    ];

  const cz =
    triangles[
      offset +
      8
    ];


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
    bx -
    ax;

  const e1y =
    by -
    ay;

  const e1z =
    bz -
    az;


  const e2x =
    cx -
    ax;

  const e2y =
    cy -
    ay;

  const e2z =
    cz -
    az;


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


  const determinant =
    e1x *
    hx +
    e1y *
    hy +
    e1z *
    hz;


  if (
    Math.abs(
      determinant
    ) <
    1e-9
  ) {

    return null;
  }


  const inverseDeterminant =
    1 /
    determinant;


  const sx =
    start.x -
    ax;

  const sy =
    start.y -
    ay;

  const sz =
    start.z -
    az;


  const u =
    (
      sx *
      hx +
      sy *
      hy +
      sz *
      hz
    ) *
    inverseDeterminant;


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
    inverseDeterminant;


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
    inverseDeterminant;


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

      const temporary =
        t1;


      t1 =
        t2;


      t2 =
        temporary;
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
        grid.gridCellSizeHU
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
        grid.gridCellSizeHU
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
        grid.gridCellSizeHU
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
      grid.gridCellSizeHU
    );


  let tMaxY =
    axisNextBoundaryT(
      start.y,
      dy,
      iy,
      stepY,
      grid.bounds.min.y,
      grid.gridCellSizeHU
    );


  let tMaxZ =
    axisNextBoundaryT(
      start.z,
      dz,
      iz,
      stepZ,
      grid.bounds.min.z,
      grid.gridCellSizeHU
    );


  const tDeltaX =
    stepX ===
    0
      ? Infinity
      : grid.gridCellSizeHU /
        Math.abs(
          dx
        );


  const tDeltaY =
    stepY ===
    0
      ? Infinity
      : grid.gridCellSizeHU /
        Math.abs(
          dy
        );


  const tDeltaZ =
    stepZ ===
    0
      ? Infinity
      : grid.gridCellSizeHU /
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

    const shouldContinue =
      visitCell(
        cellIndex(
          ix,
          iy,
          iz,
          grid.nx,
          grid.ny
        )
      );


    if (
      shouldContinue ===
      false
    ) {

      return;
    }


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

      return;
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
  minimum,
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
      ? minimum +
        (
          cell +
          1
        ) *
        cellSize
      : minimum +
        cell *
        cellSize;


  return (
    boundary -
    startValue
  ) /
  delta;
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
// PLAYER STATE
// ============================================================

async function loadCompactPlayerState(
  path
) {

  const byPlayer =
    new Map();


  let rowsParsed =
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

    return {
      stateResolved:
        false,

      alive:
        null,

      position:
        null
    };
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
      stateResolved:
        true,

      alive:
        after.alive,

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
        stateResolved:
          false,

        alive:
          null,

        position:
          null
      };
    }


    if (
      !before.alive
    ) {

      return {
        stateResolved:
          true,

        alive:
          false,

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
      stateResolved:
        true,

      alive:
        true,

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
      stateResolved:
        true,

      alive:
        nearest.alive,

      position:
        nearest.alive
          ? nearest.position
          : null
    };
  }


  return {
    stateResolved:
      false,

    alive:
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
// TRAJECTORY
// ============================================================

async function loadTrajectoryIndex(
  path
) {

  const result =
    new Map();


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

      continue;
    }


    const eventId =
      row.eventId;


    const tick =
      finite(
        row.tick
      );


    const position =
      normalizePosition(
        row.position
      );


    if (
      !eventId
      ||
      tick ===
      null
      ||
      !position
    ) {

      continue;
    }


    if (
      !result.has(
        eventId
      )
    ) {

      result.set(
        eventId,
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
        eventId
      )
      .byTick
      .set(
        tick,
        position
      );
  }


  for (
    const event
    of result.values()
  ) {

    event.ticks =
      [
        ...event.byTick.keys()
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
      position:
        null
    };
  }


  const exact =
    trajectory.byTick.get(
      tick
    );


  if (
    exact
  ) {

    return {
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
      position:
        trajectory.byTick.get(
          nearestTick
        )
        ??
        null
    };
  }


  return {
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
// GLB READERS FOR CACHE BUILD
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
    ||
    buffer.readUInt32LE(
      0
    ) !==
    0x46546c67
  ) {

    throw new Error(
      'Invalid GLB.'
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
      'GLB JSON/BIN chunk missing.'
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


      const positions =
        createAccessorReader(
          glb,
          positionAccessorIndex
        );


      const indices =
        Number.isInteger(
          primitive.indices
        )
          ? createAccessorReader(
              glb,
              primitive.indices
            )
          : null;


      const indexCount =
        indices
          ? indices.count
          : positions.count;


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
          meshName,

          interactAs,

          primaryFilterIncluded:
            isBulletSolidCandidate({
              meshName,
              interactAs
            }),

          positionAccessor:
            positions,

          indexAccessor:
            indices,

          triangleCount:
            Math.floor(
              indexCount /
              3
            ),


          copyTriangleToFlatArray({
            localTriangleIndex,
            destination,
            destinationOffset
          }) {

            const base =
              localTriangleIndex *
              3;


            const i0 =
              indices
                ? indices.getIndex(
                    base
                  )
                : base;


            const i1 =
              indices
                ? indices.getIndex(
                    base +
                    1
                  )
                : base +
                  1;


            const i2 =
              indices
                ? indices.getIndex(
                    base +
                    2
                  )
                : base +
                  2;


            positions.copyVec3ToFlatArray(
              i0,
              destination,
              destinationOffset
            );


            positions.copyVec3ToFlatArray(
              i1,
              destination,
              destinationOffset +
              3
            );


            positions.copyVec3ToFlatArray(
              i2,
              destination,
              destinationOffset +
              6
            );
          }
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


  const packedStride =
    componentBytes *
    components;


  const stride =
    bufferView.byteStride
    ??
    packedStride;


  const byteOffset =
    glb.binStart +
    (
      bufferView.byteOffset
      ??
      0
    ) +
    (
      accessor.byteOffset
      ??
      0
    );


  const typedArray =
    createFastTypedAccessorView({
      glb,
      accessor,
      stride,
      byteOffset,
      packedStride
    });


  return {
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


    getIndex(
      index
    ) {

      if (
        typedArray
      ) {

        return typedArray[
          index
        ];
      }


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
            `Unsupported index componentType ${accessor.componentType}.`
          );
      }
    },


    copyVec3ToFlatArray(
      index,
      destination,
      destinationOffset
    ) {

      if (
        typedArray
        &&
        accessor.componentType ===
        5126
        &&
        accessor.type ===
        'VEC3'
      ) {

        const sourceOffset =
          index *
          3;


        destination[
          destinationOffset
        ] =
          typedArray[
            sourceOffset
          ];


        destination[
          destinationOffset +
          1
        ] =
          typedArray[
            sourceOffset +
            1
          ];


        destination[
          destinationOffset +
          2
        ] =
          typedArray[
            sourceOffset +
            2
          ];

        return;
      }


      const offset =
        byteOffset +
        index *
        stride;


      destination[
        destinationOffset
      ] =
        glb.buffer.readFloatLE(
          offset
        );


      destination[
        destinationOffset +
        1
      ] =
        glb.buffer.readFloatLE(
          offset +
          4
        );


      destination[
        destinationOffset +
        2
      ] =
        glb.buffer.readFloatLE(
          offset +
          8
        );
    }
  };
}


function createFastTypedAccessorView({
  glb,
  accessor,
  stride,
  byteOffset,
  packedStride
}) {

  if (
    stride !==
    packedStride
  ) {

    return null;
  }


  const absoluteByteOffset =
    glb.buffer.byteOffset +
    byteOffset;


  try {

    switch (
      accessor.componentType
    ) {

      case 5121:
        return new Uint8Array(
          glb.buffer.buffer,
          absoluteByteOffset,
          accessor.count *
          accessorTypeComponents(
            accessor.type
          )
        );

      case 5123:

        if (
          absoluteByteOffset %
          2 !==
          0
        ) {

          return null;
        }

        return new Uint16Array(
          glb.buffer.buffer,
          absoluteByteOffset,
          accessor.count *
          accessorTypeComponents(
            accessor.type
          )
        );

      case 5125:

        if (
          absoluteByteOffset %
          4 !==
          0
        ) {

          return null;
        }

        return new Uint32Array(
          glb.buffer.buffer,
          absoluteByteOffset,
          accessor.count *
          accessorTypeComponents(
            accessor.type
          )
        );

      case 5126:

        if (
          absoluteByteOffset %
          4 !==
          0
        ) {

          return null;
        }

        return new Float32Array(
          glb.buffer.buffer,
          absoluteByteOffset,
          accessor.count *
          accessorTypeComponents(
            accessor.type
          )
        );

      default:
        return null;
    }

  } catch {

    return null;
  }
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
        `Missing POSITION bounds for ${reader.meshName}.`
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


// ============================================================
// CHECKPOINT CHUNKS
// ============================================================

function chunkPath(
  chunkIndex
) {

  return resolve(
    chunkDirectory,
    `chunk_${String(chunkIndex).padStart(4, '0')}.jsonl`
  );
}


function isValidChunkFile({
  path,
  startIndex,
  endIndexExclusive
}) {

  if (
    !existsSync(
      path
    )
  ) {

    return false;
  }


  try {

    const lines =
      readFileSync(
        path,
        'utf8'
      )
        .split(
          /\r?\n/
        )
        .filter(
          line =>
            line.trim()
        );


    const expectedRows =
      endIndexExclusive -
      startIndex;


    if (
      lines.length !==
      expectedRows
    ) {

      return false;
    }


    const first =
      JSON.parse(
        lines[0]
      );


    const last =
      JSON.parse(
        lines[
          lines.length -
          1
        ]
      );


    return first?.schemaVersion ===
      2
      &&
      first?.replay ===
      replayName
      &&
      first?.candidateIndex ===
      startIndex
      &&
      last?.candidateIndex ===
      endIndexExclusive -
      1;

  } catch {

    return false;
  }
}


function writeJsonlAtomic(
  path,
  rows
) {

  const temporaryPath =
    `${path}.tmp`;


  const text =
    rows
      .map(
        row =>
          JSON.stringify(
            row
          )
      )
      .join(
        '\n'
      ) +
    '\n';


  writeFileSync(
    temporaryPath,
    text,
    'utf8'
  );


  renameSync(
    temporaryPath,
    path
  );
}


// ============================================================
// SUMMARY AGGREGATION
// ============================================================

function createReplayAggregate() {

  return {
    priorAliveGeometryCandidates:
      0,

    staticEvaluatedCandidates:
      0,

    staticEvaluatedTicks:
      0,

    robustClearTicks:
      0,

    robustBlockedTicks:
      0,

    originSensitiveTicks:
      0,

    everRobustClearCandidates:
      0,

    everRobustBlockedCandidates:
      0,

    everOriginSensitiveCandidates:
      0,

    observedHitCandidates:
      0,

    observedHitEverRobustClear:
      0,

    observedHitNeverRobustClear:
      0,

    blockerMeshes:
      new Map(),

    robustClearFractions:
      [],

    robustBlockedFractions:
      [],

    originSensitiveFractions:
      [],

    firstRobustClearSeconds:
      [],

    longestRobustClearRunSeconds:
      []
  };
}


function updateReplayAggregate(
  aggregate,
  row
) {

  const access =
    row
      ?.staticProjectileAccess;


  const staticAccess =
    access
      ?.staticAccess;


  const coverage =
    access
      ?.coverage;


  if (
    row.priorAliveGeometry ===
    true
  ) {

    aggregate.priorAliveGeometryCandidates++;
  }


  if (
    (
      coverage?.staticEvaluatedTicks
      ??
      0
    ) >
    0
  ) {

    aggregate.staticEvaluatedCandidates++;
  }


  aggregate.staticEvaluatedTicks +=
    coverage?.staticEvaluatedTicks
    ??
    0;


  aggregate.robustClearTicks +=
    staticAccess?.robustClearTicks
    ??
    0;


  aggregate.robustBlockedTicks +=
    staticAccess?.robustBlockedTicks
    ??
    0;


  aggregate.originSensitiveTicks +=
    staticAccess?.originSensitiveTicks
    ??
    0;


  if (
    staticAccess?.everRobustClear ===
    true
  ) {

    aggregate.everRobustClearCandidates++;
  }


  if (
    staticAccess?.everRobustBlocked ===
    true
  ) {

    aggregate.everRobustBlockedCandidates++;
  }


  if (
    staticAccess?.everOriginSensitive ===
    true
  ) {

    aggregate.everOriginSensitiveCandidates++;
  }


  if (
    Number.isFinite(
      staticAccess?.robustClearFraction
    )
  ) {

    aggregate.robustClearFractions.push(
      staticAccess.robustClearFraction
    );
  }


  if (
    Number.isFinite(
      staticAccess?.robustBlockedFraction
    )
  ) {

    aggregate.robustBlockedFractions.push(
      staticAccess.robustBlockedFraction
    );
  }


  if (
    Number.isFinite(
      staticAccess?.originSensitiveFraction
    )
  ) {

    aggregate.originSensitiveFractions.push(
      staticAccess.originSensitiveFraction
    );
  }


  if (
    Number.isFinite(
      staticAccess?.firstRobustClearSecondsAfterAttackableStart
    )
  ) {

    aggregate.firstRobustClearSeconds.push(
      staticAccess.firstRobustClearSecondsAfterAttackableStart
    );
  }


  if (
    Number.isFinite(
      staticAccess?.longestRobustClearRunSeconds
    )
  ) {

    aggregate.longestRobustClearRunSeconds.push(
      staticAccess.longestRobustClearRunSeconds
    );
  }


  for (
    const [
      meshName,
      count
    ]
    of Object.entries(
      access
        ?.blockers
        ?.firstDetectedMeshCounts
      ??
      {}
    )
  ) {

    incrementBy(
      aggregate.blockerMeshes,
      meshName,
      count
    );
  }


  const observedHit =
    row
      ?.observedResponseOutcome
      ?.class ===
    'OBSERVED_SUCCESSFUL_HIT';


  if (
    observedHit
  ) {

    aggregate.observedHitCandidates++;


    if (
      staticAccess?.everRobustClear ===
      true
    ) {

      aggregate.observedHitEverRobustClear++;

    } else {

      aggregate.observedHitNeverRobustClear++;
    }
  }
}


function finalizeReplayAggregate({
  aggregate,
  totalCandidates
}) {

  return {
    candidates:
      {
        total:
          totalCandidates
      },

    coverage:
      {
        priorAliveGeometryCandidates:
          aggregate.priorAliveGeometryCandidates,

        staticEvaluatedCandidates:
          aggregate.staticEvaluatedCandidates,

        staticEvaluatedCandidateRateAmongPriorAliveGeometry:
          rate(
            aggregate.staticEvaluatedCandidates,
            aggregate.priorAliveGeometryCandidates
          ),

        staticEvaluatedTicks:
          aggregate.staticEvaluatedTicks
      },

    staticAccess:
      {
        robustClearTicks:
          aggregate.robustClearTicks,

        robustBlockedTicks:
          aggregate.robustBlockedTicks,

        originSensitiveTicks:
          aggregate.originSensitiveTicks,

        robustClearTickRate:
          rate(
            aggregate.robustClearTicks,
            aggregate.staticEvaluatedTicks
          ),

        robustBlockedTickRate:
          rate(
            aggregate.robustBlockedTicks,
            aggregate.staticEvaluatedTicks
          ),

        originSensitiveTickRate:
          rate(
            aggregate.originSensitiveTicks,
            aggregate.staticEvaluatedTicks
          ),

        everRobustClearCandidates:
          aggregate.everRobustClearCandidates,

        everRobustBlockedCandidates:
          aggregate.everRobustBlockedCandidates,

        everOriginSensitiveCandidates:
          aggregate.everOriginSensitiveCandidates,

        everRobustClearRateAmongEvaluated:
          rate(
            aggregate.everRobustClearCandidates,
            aggregate.staticEvaluatedCandidates
          )
      },

    positiveControls:
      {
        observedHitCandidates:
          aggregate.observedHitCandidates,

        everRobustClear:
          aggregate.observedHitEverRobustClear,

        neverRobustClear:
          aggregate.observedHitNeverRobustClear,

        everRobustClearRate:
          rate(
            aggregate.observedHitEverRobustClear,
            aggregate.observedHitCandidates
          )
      },

    blockers:
      {
        robustBlockedFirstDetectedMeshes:
          mapToSortedObject(
            aggregate.blockerMeshes
          )
      },

    distributions:
      {
        robustClearFractionAmongEvaluatedTicks:
          summarizeNumbers(
            aggregate.robustClearFractions
          ),

        robustBlockedFractionAmongEvaluatedTicks:
          summarizeNumbers(
            aggregate.robustBlockedFractions
          ),

        originSensitiveFractionAmongEvaluatedTicks:
          summarizeNumbers(
            aggregate.originSensitiveFractions
          ),

        firstRobustClearSecondsAfterAttackableStart:
          summarizeNumbers(
            aggregate.firstRobustClearSeconds
          ),

        longestRobustClearRunSeconds:
          summarizeNumbers(
            aggregate.longestRobustClearRunSeconds
          )
      }
  };
}


// ============================================================
// PROGRESS
// ============================================================

function printProgress({
  absoluteCompleted,
  total,
  processedThisRun,
  raysThisRun,
  startedMs
}) {

  const elapsedSeconds =
    Math.max(
      0.001,
      (
        Date.now() -
        startedMs
      ) /
      1000
    );


  const candidateRate =
    processedThisRun /
    elapsedSeconds;


  const rayRate =
    raysThisRun /
    elapsedSeconds;


  const remaining =
    Math.max(
      0,
      total -
      absoluteCompleted
    );


  const etaSeconds =
    candidateRate >
    0
      ? remaining /
        candidateRate
      : null;


  console.log(
    `  candidate ${absoluteCompleted}/${total} | ${candidateRate.toFixed(2)} cand/s | ${rayRate.toFixed(0)} rays/s | elapsed ${formatDuration(elapsedSeconds)} | ETA ${formatDuration(etaSeconds)}`
  );
}


// ============================================================
// BINARY / FILE HELPERS
// ============================================================

function writeTypedArray(
  path,
  typedArray
) {

  writeFileSync(
    path,
    Buffer.from(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength
    )
  );
}


function readUint32Array(
  path
) {

  const buffer =
    readFileSync(
      path
    );


  if (
    buffer.byteLength %
    4 !==
    0
  ) {

    throw new Error(
      `Invalid Uint32 binary length: ${path}`
    );
  }


  const copy =
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset +
      buffer.byteLength
    );


  return new Uint32Array(
    copy
  );
}


function readFloat32Array(
  path
) {

  const buffer =
    readFileSync(
      path
    );


  if (
    buffer.byteLength %
    4 !==
    0
  ) {

    throw new Error(
      `Invalid Float32 binary length: ${path}`
    );
  }


  const copy =
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset +
      buffer.byteLength
    );


  return new Float32Array(
    copy
  );
}


async function sha256File(
  path
) {

  const hash =
    createHash(
      'sha256'
    );


  for await (
    const chunk
    of createReadStream(
      path
    )
  ) {

    hash.update(
      chunk
    );
  }


  return hash.digest(
    'hex'
  );
}


function fileIdentity(
  path
) {

  const stat =
    statSync(
      path
    );


  return {
    path:
      resolve(
        path
      ),

    bytes:
      stat.size,

    mtimeMs:
      Math.round(
        stat.mtimeMs
      )
  };
}


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


// ============================================================
// GENERIC HELPERS
// ============================================================

function parseArgs(
  argv
) {

  const result =
    {
      replay:
        null,

      fresh:
        false,

      rebuildCache:
        false
    };


  for (
    let index =
      0;

    index <
      argv.length;

    index++
  ) {

    if (
      argv[
        index
      ] ===
      '--replay'
      &&
      argv[
        index +
        1
      ]
    ) {

      result.replay =
        argv[
          ++index
        ];

      continue;
    }


    if (
      argv[
        index
      ] ===
      '--fresh'
    ) {

      result.fresh =
        true;

      continue;
    }


    if (
      argv[
        index
      ] ===
      '--rebuild-cache'
    ) {

      result.rebuildCache =
        true;
    }
  }


  return result;
}


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
    ) +
    sorted[
      upper
    ] *
    weight;
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


function formatDuration(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return 'n/a';
  }


  const rounded =
    Math.max(
      0,
      Math.round(
        seconds
      )
    );


  const hours =
    Math.floor(
      rounded /
      3600
    );


  const minutes =
    Math.floor(
      (
        rounded %
        3600
      ) /
      60
    );


  const secs =
    rounded %
    60;


  if (
    hours >
    0
  ) {

    return `${hours}h ${minutes}m ${secs}s`;
  }


  if (
    minutes >
    0
  ) {

    return `${minutes}m ${secs}s`;
  }


  return `${secs}s`;
}


function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Flying-Soul Static Projectile Access Windows V02'
  );

  lines.push('');

  lines.push(
    `Replay: **${summary.replay}**`
  );

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Computational change from V01'
  );

  lines.push('');

  lines.push(
    '- Reusable map-level binary collision cache.'
  );

  lines.push(
    '- Flattened triangle coordinates.'
  );

  lines.push(
    '- 512-HU spatial grid.'
  );

  lines.push(
    '- Early exit after any blocking triangle is found.'
  );

  lines.push(
    '- One replay per invocation.'
  );

  lines.push(
    '- Atomic 100-candidate checkpoints and resume support.'
  );

  lines.push(
    '- Per-candidate static tick classes are persisted with run-length encoding, so downstream scripts do not need to rerun static rays merely to recover the tick timeline.'
  );

  lines.push('');

  lines.push(
    '## Results'
  );

  lines.push('');

  lines.push(
    `- Candidate rows: ${summary.candidates.total}`
  );

  lines.push(
    `- Static-evaluated coverage among prior alive geometry: ${formatPercent(summary.coverage.staticEvaluatedCandidateRateAmongPriorAliveGeometry)}`
  );

  lines.push(
    `- Robust-clear tick rate: ${formatPercent(summary.staticAccess.robustClearTickRate)}`
  );

  lines.push(
    `- Robust-blocked tick rate: ${formatPercent(summary.staticAccess.robustBlockedTickRate)}`
  );

  lines.push(
    `- Origin-sensitive tick rate: ${formatPercent(summary.staticAccess.originSensitiveTickRate)}`
  );

  lines.push(
    `- Observed-hit candidates ever robust clear: ${summary.positiveControls.everRobustClear}/${summary.positiveControls.observedHitCandidates} (${formatPercent(summary.positiveControls.everRobustClearRate)})`
  );

  lines.push('');

  lines.push(
    '## Guardrail'
  );

  lines.push('');

  lines.push(
    '`ROBUST_STATIC_CLEAR` is a static projectile-path result only. It does not establish visual access, weapon readiness, temporal reachability, response attempt, or actionable opportunity.'
  );

  lines.push('');

  lines.push(
    '## Reuse'
  );

  lines.push('');

  lines.push(
    'The collision cache is tied to the frozen Midtown physics GLB hash and can be reused for later compatible Midtown replays. Replay-specific rays still need to be computed once per replay.'
  );

  lines.push('');

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