import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  createInterface
} from 'node:readline';

import {
  dirname,
  resolve
} from 'node:path';

// ============================================================
// SCRIPT 226
// COMPLETE MOVEMENT FAMILY VALIDATION V0.1
//
// Validates the complete 11-metric Movement section:
//
//   position_trajectory
//   xy_distance
//   xyz_distance
//   distance_per_min
//   distance_per_alive_min
//   mean_xy_speed
//   mean_xyz_speed
//   moving_time
//   moving_share
//   low_motion_time
//   low_motion_share
//
// Frozen operational rules:
//
// Position trajectory
//   Every finite pawn.positionWorld sample at matchTime >= 0.
//   This is a discrete observed trajectory, NOT a continuous path.
//
// Movement-alive denominator
//   Sum dt only when consecutive post-start samples have BOTH
//   endpoints alive. This exactly reproduces the legacy V02
//   aliveSeconds denominator on the calibration replay.
//
// Valid displacement step
//   - consecutive same-player samples
//   - both match times >= 0
//   - both endpoints alive
//   - both endpoints positionValidForMovement
//   - finite positions
//   - dt > 0
//   - 3D step <= 2000 HU
//
// Invalid >2000-HU 3D hard jumps are EXCLUDED, never clamped.
//
// Movement state classification
//   speed3D = xyzStep / dt
//   moving     if speed3D >= 25 HU/s
//   low-motion if speed3D <  25 HU/s
//
// Derived formulas
//   distance_per_min       = xy_distance / full match minutes
//   distance_per_alive_min = xy_distance / movement-alive minutes
//   mean_xy_speed          = xy_distance  / valid movement seconds
//   mean_xyz_speed         = xyz_distance / valid movement seconds
//   moving_share           = moving_time / valid movement seconds
//   low_motion_share       = low_motion_time / valid movement seconds
//
// Zero/nonpositive denominators -> null.
//
// Calibration:
//   test/behavioral_metrics_v02.json must be exactly reconstructed
//   for the old movement fields AND its aliveSeconds denominator.
//
// Replication:
//   test + rep01-rep05 must satisfy all invariants.
// ============================================================

const MAX_STEP_3D =
  2000;

const MOVING_THRESHOLD_3D =
  25;

const DEFAULT_REPLAYS =
  [
    'test',
    'rep01',
    'rep02',
    'rep03',
    'rep04',
    'rep05'
  ];

const args =
  process.argv
    .slice(2)
    .filter(Boolean);

const replayNames =
  args.length
    ? args
    : DEFAULT_REPLAYS;

const outputRoot =
  resolve(
    process.env.DEADLOCK_OUTPUT_ROOT
    ??
    'output'
  );

const artifactPath =
  resolve(
    outputRoot,
    'cross_replay',
    'movement_family_validation_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('COMPLETE MOVEMENT FAMILY VALIDATION V0.1');
console.log('========================================================');
console.log(`Output root: ${outputRoot}`);
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const legacyPath =
  resolve(
    outputRoot,
    'test',
    'behavioral_metrics_v02.json'
  );

const legacy =
  existsSync(
    legacyPath
  )
    ? JSON.parse(
        readFileSync(
          legacyPath,
          'utf8'
        )
      )
    : null;

const results =
  [];

for (const replayName of replayNames) {
  const playerStatePath =
    resolve(
      outputRoot,
      replayName,
      'player_state.jsonl'
    );

  const summaryPath =
    resolve(
      outputRoot,
      replayName,
      'player_state_summary.json'
    );

  if (
    !existsSync(
      playerStatePath
    )
  ) {
    results.push({
      replayName,
      success:
        false,
      error:
        'player_state.jsonl missing'
    });

    console.log(
      `${replayName.padEnd(10)} MISSING player_state.jsonl`
    );

    continue;
  }

  try {
    const summary =
      existsSync(
        summaryPath
      )
        ? JSON.parse(
            readFileSync(
              summaryPath,
              'utf8'
            )
          )
        : null;

    const row =
      await analyzeReplay(
        replayName,
        playerStatePath,
        summary,
        replayName ===
          'test'
          ? legacy
          : null
      );

    results.push(
      row
    );

    console.log(
      `${replayName.padEnd(10)} ` +
      `players=${String(row.playerCount).padStart(2)} ` +
      `traj=${String(row.trajectorySamples).padStart(6)} ` +
      `steps=${String(row.acceptedSteps).padStart(6)} ` +
      `alive=${fmt(row.movementAliveSeconds).padStart(10)} ` +
      `valid=${fmt(row.validMovementSeconds).padStart(10)} ` +
      `jumps=${String(row.rejectedHardJumps).padStart(4)}`
    );

  } catch (error) {
    results.push({
      replayName,
      success:
        false,
      error:
        error?.stack
        ??
        String(error)
    });

    console.log(
      `${replayName.padEnd(10)} ERROR`
    );

    console.error(
      error
    );
  }
}

const successful =
  results.filter(
    row =>
      row.success
  );

const aggregate =
  aggregateResults(
    successful
  );

const calibration =
  successful.find(
    row =>
      row.replayName ===
        'test'
  )
    ?.legacyCalibration
  ??
  null;

const gates = {
  allSixReplays:
    successful.length ===
      6
    &&
    successful.length ===
      replayNames.length,

  twelvePlayersPerReplay:
    successful.every(
      row =>
        row.playerCount ===
          12
    ),

  seventyTwoPlayerReplayRecords:
    aggregate.playerReplayCount ===
      72,

  legacyArtifactPresent:
    Boolean(
      legacy
    ),

  legacyThresholdIs25:
    legacy
      ?.thresholds
      ?.movement
      ?.lowMotionSpeedThreshold ===
      MOVING_THRESHOLD_3D,

  legacyHardJumpThresholdIs2000:
    legacy
      ?.thresholds
      ?.movement
      ?.maxAcceptedStep ===
      MAX_STEP_3D,

  exactLegacyMovementReproduction:
    calibration
      ?.movementPass ===
      true,

  exactLegacyAliveDenominatorReproduction:
    calibration
      ?.aliveDenominatorPass ===
      true,

  noLegacyMismatches:
    calibration
      ?.mismatchCount ===
      0,

  noNonpositiveDt:
    aggregate.nonpositiveDtTransitions ===
      0,

  noNonfiniteAcceptedPositions:
    aggregate.nonfinitePositionTransitions ===
      0,

  acceptedCutoffRespected:
    (
      aggregate.maxAcceptedStep3D
      ??
      Infinity
    ) <=
      MAX_STEP_3D,

  rejectedCutoffRespected:
    aggregate.rejectedHardJumps >
      0
    &&
    (
      aggregate.minRejectedStep3D
      ??
      -Infinity
    ) >
      MAX_STEP_3D,

  movementPartitionExact:
    aggregate.movementPartitionMaxAbsoluteError <=
      1e-9,

  movementSharesComplement:
    aggregate.shareComplementMaxAbsoluteError <=
      1e-12,

  meanSpeedFormulasExact:
    aggregate.meanSpeedFormulaMaxAbsoluteError <=
      1e-9,

  distanceRateFormulasExact:
    aggregate.distanceRateFormulaMaxAbsoluteError <=
      1e-9,

  validMovementNeverExceedsAliveWindow:
    aggregate.validMinusAliveMax <=
      1e-9,

  xyzNeverBelowXy:
    aggregate.xyzMinusXyMin >=
      -1e-9,

  dominantQuarterSecondCadence:
    aggregate.cadenceQuarterSecondShare >=
      0.999,

  substantialCoverage:
    aggregate.trajectorySamples >
      700000
    &&
    aggregate.acceptedSteps >
      600000,

  allDerivedValuesFiniteWhenDefined:
    aggregate.invalidDerivedValues ===
      0,

  syntheticZeroDenominatorContract:
    syntheticZeroDenominatorCheck()
};

const validationPass =
  Object.values(
    gates
  ).every(Boolean);

const artifact = {
  version:
    'MOVEMENT_FAMILY_VALIDATION_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  metricsUnderTest: [
    'position_trajectory',
    'xy_distance',
    'xyz_distance',
    'distance_per_min',
    'distance_per_alive_min',
    'mean_xy_speed',
    'mean_xyz_speed',
    'moving_time',
    'moving_share',
    'low_motion_time',
    'low_motion_share'
  ],

  operationalContract: {
    maxAcceptedStep3D:
      MAX_STEP_3D,

    movingThreshold3D:
      MOVING_THRESHOLD_3D,

    trajectory:
      'Finite post-start pawn.positionWorld observations at the PlayerState sampling cadence; discrete samples, not a continuous path.',

    movementAliveSeconds:
      'Sum of positive dt for consecutive post-start samples whose two endpoints are both alive.',

    validMovementSeconds:
      'Sum of positive dt for steps whose two endpoints are alive and movement-valid, positions are finite, and 3D displacement is <=2000 HU.',

    movementState:
      'On each valid movement step, 3D step speed >=25 HU/s is moving; <25 HU/s is low-motion.',

    hardJump:
      '3D displacement >2000 HU is excluded from distance, valid movement time, and movement-state classification; it is never clamped.',

    zeroDenominator:
      'null'
  },

  formulas: {
    distance_per_min:
      'xy_distance / (match_duration_seconds / 60)',

    distance_per_alive_min:
      'xy_distance / (movement_alive_seconds / 60)',

    mean_xy_speed:
      'xy_distance / valid_movement_seconds',

    mean_xyz_speed:
      'xyz_distance / valid_movement_seconds',

    moving_share:
      'moving_time / valid_movement_seconds',

    low_motion_share:
      'low_motion_time / valid_movement_seconds'
  },

  semanticBoundary: {
    establishes: [
      'discrete observed post-start position trajectory',
      'cumulative planar displacement across frozen valid movement steps',
      'cumulative 3D displacement across frozen valid movement steps',
      'full-match planar distance rate',
      'both-endpoints-alive planar distance rate',
      'valid-step time-weighted mean planar and 3D speeds',
      'valid-step moving and low-motion durations using the frozen 25 HU/s 3D threshold',
      'moving and low-motion shares of valid movement time'
    ],

    doesNotEstablish: [
      'continuous geometric path between samples',
      'locomotion intent',
      'voluntary versus forced displacement',
      'semantic meaning of 25 HU/s beyond the frozen operational classification',
      'distance represented by excluded >2000-HU hard jumps',
      'pathing around geometry between samples',
      'movement efficiency, risk, or strategic quality'
    ]
  },

  calibration,

  aggregate,

  gates,

  validationPass,

  recommendedAuthorityIfPass: {
    integrityValidation:
      'pass',

    semanticValidation:
      'pass',

    replicationStatus:
      'cross_replay_replicated'
  },

  replays:
    results
};

mkdirSync(
  dirname(
    artifactPath
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  artifactPath,
  JSON.stringify(
    artifact,
    null,
    2
  ),
  'utf8'
);

printSummary(
  artifact
);

process.exitCode =
  validationPass
    ? 0
    : 2;

// ============================================================
// Analysis
// ============================================================

async function analyzeReplay(
  replayName,
  path,
  summary,
  legacyReference
) {
  const players =
    new Map();

  const cadence =
    new Map();

  let matchDurationSeconds =
    0;

  let nonpositiveDtTransitions =
    0;

  let nonfinitePositionTransitions =
    0;

  let rejectedHardJumps =
    0;

  let maxAcceptedStep3D =
    null;

  let minRejectedStep3D =
    null;

  let maxRejectedStep3D =
    null;

  for await (
    const line
    of lineIterator(
      path
    )
  ) {
    if (!line) {
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

    const controller =
      row?.controller;

    const pawn =
      row?.pawn;

    if (
      !controller
      ||
      !pawn
      ||
      typeof controller !==
        'object'
      ||
      typeof pawn !==
        'object'
    ) {
      continue;
    }

    const playerName =
      cleanText(
        controller.playerName
      );

    if (
      !playerName
      ||
      playerName ===
        'SourceTV'
    ) {
      continue;
    }

    const matchTime =
      finite(
        row.matchTimeSeconds
      );

    const tick =
      finite(
        row.demoTick
        ??
        row.tick
      );

    const position =
      finitePosition(
        pawn.positionWorld
      );

    const state = {
      matchTime,
      tick,
      alive:
        Boolean(
          controller.alive
        ),
      movementValid:
        pawn.positionValidForMovement ===
          true,
      position
    };

    if (
      matchTime !==
        null
      &&
      matchTime >=
        0
    ) {
      matchDurationSeconds =
        Math.max(
          matchDurationSeconds,
          matchTime
        );
    }

    let p =
      players.get(
        playerName
      );

    if (!p) {
      p = {
        playerName,
        previous:
          null,

        trajectorySamples:
          0,

        acceptedSteps:
          0,

        rejectedHardJumps:
          0,

        movementAliveSeconds:
          0,

        validMovementSeconds:
          0,

        xyDistance:
          0,

        xyzDistance:
          0,

        movingSeconds:
          0,

        lowMotionSeconds:
          0
      };

      players.set(
        playerName,
        p
      );
    }

    if (
      matchTime !==
        null
      &&
      matchTime >=
        0
      &&
      position
    ) {
      p.trajectorySamples++;
    }

    const previous =
      p.previous;

    if (previous) {
      const dt =
        (
          matchTime !==
            null
          &&
          previous.matchTime !==
            null
        )
          ? matchTime -
            previous.matchTime
          : null;

      if (
        Number.isFinite(
          dt
        )
        &&
        dt >
          0
      ) {
        const key =
          dt.toFixed(
            6
          );

        cadence.set(
          key,
          (
            cadence.get(
              key
            )
            ??
            0
          )
          +
          1
        );
      }

      const postStart =
        previous.matchTime !==
          null
        &&
        matchTime !==
          null
        &&
        previous.matchTime >=
          0
        &&
        matchTime >=
          0;

      if (
        postStart
        &&
        (
          !Number.isFinite(
            dt
          )
          ||
          dt <=
            0
        )
      ) {
        nonpositiveDtTransitions++;
      }

      if (
        postStart
        &&
        Number.isFinite(
          dt
        )
        &&
        dt >
          0
        &&
        previous.alive
        &&
        state.alive
      ) {
        p.movementAliveSeconds +=
          dt;

        if (
          previous.movementValid
          &&
          state.movementValid
        ) {
          if (
            !previous.position
            ||
            !state.position
          ) {
            nonfinitePositionTransitions++;

          } else {
            const dx =
              state.position.x -
              previous.position.x;

            const dy =
              state.position.y -
              previous.position.y;

            const dz =
              state.position.z -
              previous.position.z;

            const xy =
              Math.hypot(
                dx,
                dy
              );

            const xyz =
              Math.hypot(
                dx,
                dy,
                dz
              );

            if (
              xyz >
              MAX_STEP_3D
            ) {
              p.rejectedHardJumps++;
              rejectedHardJumps++;

              minRejectedStep3D =
                minFinite(
                  minRejectedStep3D,
                  xyz
                );

              maxRejectedStep3D =
                maxFinite(
                  maxRejectedStep3D,
                  xyz
                );

            } else {
              p.acceptedSteps++;

              p.xyDistance +=
                xy;

              p.xyzDistance +=
                xyz;

              p.validMovementSeconds +=
                dt;

              maxAcceptedStep3D =
                maxFinite(
                  maxAcceptedStep3D,
                  xyz
                );

              const speed3D =
                xyz /
                dt;

              if (
                speed3D >=
                MOVING_THRESHOLD_3D
              ) {
                p.movingSeconds +=
                  dt;

              } else {
                p.lowMotionSeconds +=
                  dt;
              }
            }
          }
        }
      }
    }

    p.previous =
      state;
  }

  // The extractor summary is a direct timing control.
  const summaryDuration =
    finite(
      summary?.finalMatchTimeSeconds
    );

  const matchDurationDifference =
    summaryDuration ===
      null
      ? null
      : matchDurationSeconds -
        summaryDuration;

  const playerRows =
    [];

  for (const p of players.values()) {
    const row =
      deriveMovement(
        p,
        matchDurationSeconds
      );

    playerRows.push(
      row
    );
  }

  const legacyCalibration =
    legacyReference
      ? compareLegacy(
          playerRows,
          legacyReference
        )
      : null;

  const cadenceTotal =
    [...cadence.values()]
      .reduce(
        (
          a,
          b
        ) =>
          a +
          b,
        0
      );

  const quarterSecond =
    cadence.get(
      '0.250000'
    )
    ??
    0;

  return {
    replayName,
    success:
      true,

    playerCount:
      playerRows.length,

    matchDurationSeconds,

    summaryFinalMatchTimeSeconds:
      summaryDuration,

    matchDurationDifference,

    trajectorySamples:
      sum(
        playerRows,
        'trajectorySamples'
      ),

    acceptedSteps:
      sum(
        playerRows,
        'acceptedSteps'
      ),

    rejectedHardJumps,

    movementAliveSeconds:
      sum(
        playerRows,
        'movementAliveSeconds'
      ),

    validMovementSeconds:
      sum(
        playerRows,
        'validMovementSeconds'
      ),

    xyDistance:
      sum(
        playerRows,
        'xyDistance'
      ),

    xyzDistance:
      sum(
        playerRows,
        'xyzDistance'
      ),

    movingSeconds:
      sum(
        playerRows,
        'movingSeconds'
      ),

    lowMotionSeconds:
      sum(
        playerRows,
        'lowMotionSeconds'
      ),

    nonpositiveDtTransitions,

    nonfinitePositionTransitions,

    maxAcceptedStep3D,

    minRejectedStep3D,

    maxRejectedStep3D,

    cadence: {
      total:
        cadenceTotal,

      quarterSecond:
        quarterSecond,

      quarterSecondShare:
        safeDiv(
          quarterSecond,
          cadenceTotal
        )
    },

    legacyCalibration,

    players:
      playerRows
  };
}

function deriveMovement(
  p,
  matchDurationSeconds
) {
  const matchMinutes =
    matchDurationSeconds >
      0
      ? matchDurationSeconds /
        60
      : null;

  const movementAliveMinutes =
    p.movementAliveSeconds >
      0
      ? p.movementAliveSeconds /
        60
      : null;

  const validSeconds =
    p.validMovementSeconds >
      0
      ? p.validMovementSeconds
      : null;

  return {
    ...p,

    distancePerMinute:
      safeDiv(
        p.xyDistance,
        matchMinutes
      ),

    distancePerAliveMinute:
      safeDiv(
        p.xyDistance,
        movementAliveMinutes
      ),

    meanSpeedXY:
      safeDiv(
        p.xyDistance,
        validSeconds
      ),

    meanSpeed3D:
      safeDiv(
        p.xyzDistance,
        validSeconds
      ),

    movingShare:
      safeDiv(
        p.movingSeconds,
        validSeconds
      ),

    lowMotionShare:
      safeDiv(
        p.lowMotionSeconds,
        validSeconds
      )
  };
}

// ============================================================
// Legacy calibration
// ============================================================

function compareLegacy(
  playerRows,
  legacyReference
) {
  const byName =
    new Map(
      (
        legacyReference.players
        ??
        []
      ).map(
        row => [
          row.playerName,
          row
        ]
      )
    );

  const movementFields = [
    [
      'xyDistance',
      'travelDistanceXY'
    ],
    [
      'xyzDistance',
      'travelDistance3D'
    ],
    [
      'validMovementSeconds',
      'validMovementSeconds'
    ],
    [
      'meanSpeedXY',
      'meanSpeedXY'
    ],
    [
      'meanSpeed3D',
      'meanSpeed3D'
    ],
    [
      'movingSeconds',
      'movingSeconds'
    ],
    [
      'lowMotionSeconds',
      'lowMotionSeconds'
    ],
    [
      'lowMotionShare',
      'lowMotionShare'
    ],
    [
      'rejectedHardJumps',
      'rejectedJumpCount'
    ]
  ];

  const mismatches =
    [];

  let maxAbsoluteError =
    0;

  let movementComparedValues =
    0;

  let aliveComparedValues =
    0;

  for (const row of playerRows) {
    const expected =
      byName.get(
        row.playerName
      );

    if (!expected) {
      mismatches.push({
        playerName:
          row.playerName,
        field:
          'player',
        reason:
          'missing legacy player'
      });

      continue;
    }

    for (
      const [
        actualField,
        legacyField
      ]
      of movementFields
    ) {
      const actual =
        row[
          actualField
        ];

      const legacyValue =
        expected
          ?.movement
          ?.[legacyField];

      movementComparedValues++;

      const error =
        numericError(
          actual,
          legacyValue
        );

      if (
        error !==
          null
      ) {
        maxAbsoluteError =
          Math.max(
            maxAbsoluteError,
            error
          );

        if (
          error >
          1e-8
        ) {
          mismatches.push({
            playerName:
              row.playerName,
            field:
              legacyField,
            actual,
            expected:
              legacyValue,
            absoluteError:
              error
          });
        }

      } else if (
        actual !==
          legacyValue
      ) {
        mismatches.push({
          playerName:
            row.playerName,
          field:
            legacyField,
          actual,
          expected:
            legacyValue
        });
      }
    }

    aliveComparedValues++;

    const aliveError =
      numericError(
        row.movementAliveSeconds,
        expected.aliveSeconds
      );

    if (
      aliveError ===
        null
      ||
      aliveError >
        1e-8
    ) {
      mismatches.push({
        playerName:
          row.playerName,
        field:
          'aliveSeconds denominator',
        actual:
          row.movementAliveSeconds,
        expected:
          expected.aliveSeconds,
        absoluteError:
          aliveError
      });

    } else {
      maxAbsoluteError =
        Math.max(
          maxAbsoluteError,
          aliveError
        );
    }
  }

  const movementMismatchCount =
    mismatches.filter(
      row =>
        row.field !==
          'aliveSeconds denominator'
        &&
        row.field !==
          'player'
    ).length;

  const aliveMismatchCount =
    mismatches.filter(
      row =>
        row.field ===
          'aliveSeconds denominator'
    ).length;

  return {
    legacyVersion:
      legacyReference.version
      ??
      null,

    playersCompared:
      playerRows.length,

    movementComparedValues,

    aliveComparedValues,

    maxAbsoluteError,

    mismatchCount:
      mismatches.length,

    movementMismatchCount,

    aliveMismatchCount,

    movementPass:
      playerRows.length ===
        12
      &&
      movementMismatchCount ===
        0,

    aliveDenominatorPass:
      playerRows.length ===
        12
      &&
      aliveMismatchCount ===
        0,

    mismatches
  };
}

// ============================================================
// Aggregate invariant checks
// ============================================================

function aggregateResults(
  replayRows
) {
  const playerRows =
    replayRows.flatMap(
      row =>
        row.players
    );

  let partitionError =
    0;

  let complementError =
    0;

  let meanSpeedError =
    0;

  let rateError =
    0;

  let validMinusAliveMax =
    -Infinity;

  let xyzMinusXyMin =
    Infinity;

  let invalidDerivedValues =
    0;

  for (
    let replayIndex =
      0;
    replayIndex <
      replayRows.length;
    replayIndex++
  ) {
    const replay =
      replayRows[
        replayIndex
      ];

    for (
      const p
      of replay.players
    ) {
      partitionError =
        Math.max(
          partitionError,
          Math.abs(
            (
              p.movingSeconds +
              p.lowMotionSeconds
            )
            -
            p.validMovementSeconds
          )
        );

      if (
        p.validMovementSeconds >
          0
      ) {
        complementError =
          Math.max(
            complementError,
            Math.abs(
              (
                p.movingShare +
                p.lowMotionShare
              )
              -
              1
            )
          );

        meanSpeedError =
          Math.max(
            meanSpeedError,
            Math.abs(
              p.meanSpeedXY -
              (
                p.xyDistance /
                p.validMovementSeconds
              )
            ),
            Math.abs(
              p.meanSpeed3D -
              (
                p.xyzDistance /
                p.validMovementSeconds
              )
            )
          );
      }

      if (
        replay.matchDurationSeconds >
          0
      ) {
        rateError =
          Math.max(
            rateError,
            Math.abs(
              p.distancePerMinute -
              (
                p.xyDistance /
                (
                  replay.matchDurationSeconds /
                  60
                )
              )
            )
          );
      }

      if (
        p.movementAliveSeconds >
          0
      ) {
        rateError =
          Math.max(
            rateError,
            Math.abs(
              p.distancePerAliveMinute -
              (
                p.xyDistance /
                (
                  p.movementAliveSeconds /
                  60
                )
              )
            )
          );
      }

      validMinusAliveMax =
        Math.max(
          validMinusAliveMax,
          p.validMovementSeconds -
          p.movementAliveSeconds
        );

      xyzMinusXyMin =
        Math.min(
          xyzMinusXyMin,
          p.xyzDistance -
          p.xyDistance
        );

      for (
        const key
        of [
          'distancePerMinute',
          'distancePerAliveMinute',
          'meanSpeedXY',
          'meanSpeed3D',
          'movingShare',
          'lowMotionShare'
        ]
      ) {
        const value =
          p[
            key
          ];

        if (
          value !==
            null
          &&
          !Number.isFinite(
            value
          )
        ) {
          invalidDerivedValues++;
        }
      }
    }
  }

  const cadenceTotal =
    replayRows.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.cadence
            ?.total
          ??
          0
        ),
      0
    );

  const cadenceQuarter =
    replayRows.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.cadence
            ?.quarterSecond
          ??
          0
        ),
      0
    );

  return {
    successfulReplays:
      replayRows.length,

    playerReplayCount:
      playerRows.length,

    trajectorySamples:
      sum(
        playerRows,
        'trajectorySamples'
      ),

    acceptedSteps:
      sum(
        playerRows,
        'acceptedSteps'
      ),

    rejectedHardJumps:
      sum(
        playerRows,
        'rejectedHardJumps'
      ),

    movementAliveSeconds:
      sum(
        playerRows,
        'movementAliveSeconds'
      ),

    validMovementSeconds:
      sum(
        playerRows,
        'validMovementSeconds'
      ),

    xyDistance:
      sum(
        playerRows,
        'xyDistance'
      ),

    xyzDistance:
      sum(
        playerRows,
        'xyzDistance'
      ),

    movingSeconds:
      sum(
        playerRows,
        'movingSeconds'
      ),

    lowMotionSeconds:
      sum(
        playerRows,
        'lowMotionSeconds'
      ),

    nonpositiveDtTransitions:
      replayRows.reduce(
        (
          sum,
          row
        ) =>
          sum +
          row.nonpositiveDtTransitions,
        0
      ),

    nonfinitePositionTransitions:
      replayRows.reduce(
        (
          sum,
          row
        ) =>
          sum +
          row.nonfinitePositionTransitions,
        0
      ),

    maxAcceptedStep3D:
      maxOf(
        replayRows,
        'maxAcceptedStep3D'
      ),

    minRejectedStep3D:
      minOf(
        replayRows,
        'minRejectedStep3D'
      ),

    maxRejectedStep3D:
      maxOf(
        replayRows,
        'maxRejectedStep3D'
      ),

    movementPartitionMaxAbsoluteError:
      partitionError,

    shareComplementMaxAbsoluteError:
      complementError,

    meanSpeedFormulaMaxAbsoluteError:
      meanSpeedError,

    distanceRateFormulaMaxAbsoluteError:
      rateError,

    validMinusAliveMax,

    xyzMinusXyMin,

    invalidDerivedValues,

    cadenceQuarterSecondShare:
      safeDiv(
        cadenceQuarter,
        cadenceTotal
      ),

    replayMatchDurationMaxAbsoluteDifference:
      replayRows.reduce(
        (
          current,
          row
        ) =>
          row.matchDurationDifference ===
            null
            ? current
            : Math.max(
                current,
                Math.abs(
                  row.matchDurationDifference
                )
              ),
        0
      )
  };
}

// ============================================================
// Reporting
// ============================================================

function printSummary(
  artifact
) {
  const a =
    artifact.aggregate;

  console.log('');
  console.log('========================================================');
  console.log('CROSS-REPLAY MOVEMENT FAMILY EVIDENCE');
  console.log('========================================================');
  console.log(
    `Successful replays: ${a.successfulReplays}/6`
  );
  console.log(
    `Player-replay records: ${a.playerReplayCount}`
  );
  console.log(
    `Trajectory samples: ${a.trajectorySamples}`
  );
  console.log(
    `Accepted movement steps: ${a.acceptedSteps}`
  );
  console.log(
    `Rejected >2000-HU jumps: ${a.rejectedHardJumps}`
  );
  console.log(
    `Movement-alive seconds: ${fmt(a.movementAliveSeconds)}`
  );
  console.log(
    `Valid movement seconds: ${fmt(a.validMovementSeconds)}`
  );
  console.log(
    `Moving seconds: ${fmt(a.movingSeconds)}`
  );
  console.log(
    `Low-motion seconds: ${fmt(a.lowMotionSeconds)}`
  );
  console.log('');
  console.log(
    `Max accepted 3D step: ${fmt(a.maxAcceptedStep3D)}`
  );
  console.log(
    `Min rejected 3D step: ${fmt(a.minRejectedStep3D)}`
  );
  console.log(
    `Quarter-second cadence: ${pct(a.cadenceQuarterSecondShare)}`
  );
  console.log('');
  console.log(
    `moving + low - valid max error: ${a.movementPartitionMaxAbsoluteError}`
  );
  console.log(
    `moving share + low share - 1 max error: ${a.shareComplementMaxAbsoluteError}`
  );
  console.log(
    `mean-speed formula max error: ${a.meanSpeedFormulaMaxAbsoluteError}`
  );
  console.log(
    `distance-rate formula max error: ${a.distanceRateFormulaMaxAbsoluteError}`
  );
  console.log('');

  if (
    artifact.calibration
  ) {
    console.log('Calibration replay exact-reproduction control:');
    console.log(
      `  players: ${artifact.calibration.playersCompared}/12`
    );
    console.log(
      `  movement values: ${artifact.calibration.movementComparedValues}`
    );
    console.log(
      `  alive denominator values: ${artifact.calibration.aliveComparedValues}`
    );
    console.log(
      `  mismatches: ${artifact.calibration.mismatchCount}`
    );
    console.log(
      `  max absolute error: ${artifact.calibration.maxAbsoluteError}`
    );
    console.log(
      `  movement: ${artifact.calibration.movementPass ? 'PASS' : 'FAIL'}`
    );
    console.log(
      `  alive denominator: ${artifact.calibration.aliveDenominatorPass ? 'PASS' : 'FAIL'}`
    );
    console.log('');
  }

  console.log(
    `VALIDATION: ${artifact.validationPass ? 'PASS' : 'DO NOT PROMOTE'}`
  );
  console.log('');

  if (
    !artifact.validationPass
  ) {
    console.log('Failed gates:');

    for (
      const [
        key,
        value
      ]
      of Object.entries(
        artifact.gates
      )
    ) {
      if (!value) {
        console.log(
          `  - ${key}`
        );
      }
    }

    console.log('');
  }

  console.log(
    `Output: ${artifactPath}`
  );
  console.log('');
}

// ============================================================
// Utilities
// ============================================================

async function* lineIterator(
  path
) {
  const rl =
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
    of rl
  ) {
    yield line;
  }
}

function finitePosition(
  value
) {
  if (
    !value
    ||
    typeof value !==
      'object'
  ) {
    return null;
  }

  const x =
    finite(
      value.x
    );

  const y =
    finite(
      value.y
    );

  const z =
    finite(
      value.z
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
  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : null;
}

function safeDiv(
  a,
  b
) {
  return (
    Number.isFinite(
      a
    )
    &&
    Number.isFinite(
      b
    )
    &&
    b >
      0
  )
    ? a /
      b
    : null;
}

function cleanText(
  value
) {
  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {
    return null;
  }

  const text =
    String(
      value
    ).trim();

  return text
    ? text
    : null;
}

function numericError(
  a,
  b
) {
  if (
    Number.isFinite(
      a
    )
    &&
    Number.isFinite(
      b
    )
  ) {
    return Math.abs(
      a -
      b
    );
  }

  return null;
}

function sum(
  rows,
  key
) {
  return rows.reduce(
    (
      total,
      row
    ) =>
      total +
      (
        Number(
          row[
            key
          ]
        )
        ||
        0
      ),
    0
  );
}

function maxOf(
  rows,
  key
) {
  let value =
    null;

  for (const row of rows) {
    value =
      maxFinite(
        value,
        row[
          key
        ]
      );
  }

  return value;
}

function minOf(
  rows,
  key
) {
  let value =
    null;

  for (const row of rows) {
    value =
      minFinite(
        value,
        row[
          key
        ]
      );
  }

  return value;
}

function maxFinite(
  a,
  b
) {
  if (
    !Number.isFinite(
      b
    )
  ) {
    return a;
  }

  if (
    !Number.isFinite(
      a
    )
  ) {
    return b;
  }

  return Math.max(
    a,
    b
  );
}

function minFinite(
  a,
  b
) {
  if (
    !Number.isFinite(
      b
    )
  ) {
    return a;
  }

  if (
    !Number.isFinite(
      a
    )
  ) {
    return b;
  }

  return Math.min(
    a,
    b
  );
}

function syntheticZeroDenominatorCheck() {
  return (
    safeDiv(
      100,
      0
    ) ===
      null
    &&
    safeDiv(
      100,
      null
    ) ===
      null
    &&
    safeDiv(
      0,
      10
    ) ===
      0
  );
}

function fmt(
  value
) {
  return Number.isFinite(
    value
  )
    ? value.toFixed(
        6
      )
    : '—';
}

function pct(
  value
) {
  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(
        4
      )}%`
    : '—';
}
