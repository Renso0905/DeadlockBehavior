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
// SCRIPT 225
// MOVEMENT DISTANCE SUBSTRATE VALIDATION V0.1
//
// First movement authority layer under test:
//
//   position_trajectory
//   xy_distance
//   xyz_distance
//
// Frozen movement-distance rule inherited from the existing
// BEHAVIORAL_METRICS_V02 substrate and independently reconstructed:
//
// Position trajectory:
//   observed finite pawn.positionWorld samples at matchTime >= 0,
//   retaining alive and positionValidForMovement flags.
//
// Valid distance step:
//   - consecutive PlayerState samples for the same player
//   - both samples at matchTime >= 0
//   - both endpoints alive
//   - both endpoints positionValidForMovement
//   - both positions finite
//   - dt > 0
//   - 3D displacement <= 2000 world units
//
// Distance:
//   xy_distance  = sum planar displacement across valid steps
//   xyz_distance = sum 3D displacement across valid steps
//
// Invalid / hard-jump steps are EXCLUDED, never clamped.
//
// Calibration proof:
//   On test, this reconstruction must exactly reproduce every
//   existing BEHAVIORAL_METRICS_V02 player movement record.
//
// Replication proof:
//   Apply the same frozen rule to test + rep01-rep05 and require
//   clean position/cadence/integrity invariants.
//
// This script DOES NOT promote metrics.
// ============================================================

const MAX_ACCEPTED_STEP_3D =
  2000;

const LEGACY_LOW_MOTION_SPEED =
  25;

const DEFAULT_REPLAYS = [
  'test',
  'rep01',
  'rep02',
  'rep03',
  'rep04',
  'rep05'
];

const replayNames =
  process.argv.slice(2).filter(Boolean).length
    ? process.argv.slice(2).filter(Boolean)
    : DEFAULT_REPLAYS;

const outputPath =
  resolve(
    'output',
    'cross_replay',
    'movement_distance_substrate_validation_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('MOVEMENT DISTANCE SUBSTRATE VALIDATION V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

let legacyReference =
  null;

const legacyPath =
  resolve(
    'output',
    'test',
    'behavioral_metrics_v02.json'
  );

if (existsSync(legacyPath)) {
  legacyReference =
    JSON.parse(
      readFileSync(
        legacyPath,
        'utf8'
      )
    );
}

const legacyThreshold =
  legacyReference
    ?.thresholds
    ?.movement
    ?.maxAcceptedStep;

const legacyLowMotion =
  legacyReference
    ?.thresholds
    ?.movement
    ?.lowMotionSpeedThreshold;

const legacyThresholdGate =
  legacyThreshold ===
    MAX_ACCEPTED_STEP_3D;

const legacyLowMotionGate =
  legacyLowMotion ===
    LEGACY_LOW_MOTION_SPEED;

const replayResults =
  [];

for (const replayName of replayNames) {
  const path =
    resolve(
      'output',
      replayName,
      'player_state.jsonl'
    );

  if (!existsSync(path)) {
    replayResults.push({
      replayName,
      success:
        false,

      status:
        'PLAYER_STATE_MISSING',

      path
    });

    console.log(
      `${replayName.padEnd(10)} player_state.jsonl missing`
    );

    continue;
  }

  try {
    const result =
      await analyzeReplay(
        replayName,
        path,
        replayName === 'test'
          ? legacyReference
          : null
      );

    replayResults.push(
      result
    );

    console.log(
      `${replayName.padEnd(10)} ` +
      `players=${String(result.playerCount).padStart(2)} ` +
      `trajectory=${String(result.trajectorySamples).padStart(6)} ` +
      `steps=${String(result.acceptedSteps).padStart(6)} ` +
      `jumps=${String(result.rejectedHardJumps).padStart(4)} ` +
      `badDt=${result.nonpositiveDtTransitions} ` +
      `nonfinite=${result.nonfinitePositionTransitions}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success:
        false,

      status:
        'VALIDATION_EXCEPTION',

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
  replayResults.filter(
    row =>
      row.success
  );

const aggregate =
  aggregateResults(
    successful
  );

const testResult =
  successful.find(
    row =>
      row.replayName ===
        'test'
  )
  ??
  null;

const gates = {
  allRequestedReplaysSucceeded:
    successful.length ===
      replayNames.length,

  twelvePlayersEveryReplay:
    successful.length >
      0
    &&
    successful.every(
      row =>
        row.playerCount ===
          12
    ),

  legacyThresholdFrozenAt2000:
    legacyThresholdGate,

  legacyLowMotionThresholdRecoveredAt25:
    legacyLowMotionGate,

  exactLegacyTestReproduction:
    Boolean(
      testResult
        ?.legacyReproduction
        ?.pass
    ),

  noLegacyNumericMismatch:
    (
      testResult
        ?.legacyReproduction
        ?.mismatchCount
      ??
      1
    ) ===
      0,

  noNonpositiveDtTransitions:
    aggregate
      .nonpositiveDtTransitions ===
      0,

  noNonfiniteAcceptedEndpointTransitions:
    aggregate
      .nonfinitePositionTransitions ===
      0,

  acceptedStepsRespect3dCutoff:
    (
      aggregate
        .maxAcceptedStep3D
      ??
      Infinity
    ) <=
      MAX_ACCEPTED_STEP_3D,

  rejectedHardJumpsExceed3dCutoff:
    aggregate
      .rejectedHardJumps >
      0
    &&
    (
      aggregate
        .minRejectedHardJump3D
      ??
      -Infinity
    ) >
      MAX_ACCEPTED_STEP_3D,

  substantialTrajectoryCoverage:
    aggregate
      .trajectorySamples >
      100000,

  substantialValidStepCoverage:
    aggregate
      .acceptedSteps >
      100000,

  finiteAggregateDistances:
    Number.isFinite(
      aggregate
        .xyDistance
    )
    &&
    Number.isFinite(
      aggregate
        .xyzDistance
    )
    &&
    aggregate
      .xyDistance >
      0
    &&
    aggregate
      .xyzDistance >=
      aggregate
        .xyDistance,

  dominantQuarterSecondCadence:
    (
      aggregate
        .cadence
        ?.quarterSecondShare
      ??
      0
    ) >
      0.999
};

const validationPass =
  Object.values(
    gates
  ).every(Boolean);

const output = {
  version:
    'MOVEMENT_DISTANCE_SUBSTRATE_VALIDATION_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  requestedReplays:
    replayNames,

  successCount:
    successful.length,

  replayCount:
    replayNames.length,

  metricsUnderTest: [
    'position_trajectory',
    'xy_distance',
    'xyz_distance'
  ],

  frozenRule: {
    trajectory:
      'Observed finite pawn.positionWorld samples at nonnegative match time, with alive and positionValidForMovement retained as sample metadata.',

    distanceStep:
      'Consecutive same-player PlayerState samples; both match times nonnegative; both alive; both positionValidForMovement; finite positions; dt > 0; 3D displacement <= 2000.',

    xyDistance:
      'Sum sqrt(dx^2 + dy^2) over valid steps.',

    xyzDistance:
      'Sum sqrt(dx^2 + dy^2 + dz^2) over valid steps.',

    hardJumpRule:
      'The 2000-unit cutoff is evaluated on 3D displacement, not XY displacement.',

    invalidStepRule:
      'Rejected transitions contribute neither distance nor valid movement time. Distances are not clamped.',

    continuousPathClaim:
      false
  },

  calibrationReference: {
    artifact:
      'output/test/behavioral_metrics_v02.json',

    version:
      legacyReference?.version
      ??
      null,

    maxAcceptedStep:
      legacyThreshold
      ??
      null,

    lowMotionSpeedThreshold:
      legacyLowMotion
      ??
      null,

    note:
      'Low-motion classification is not promoted in this phase; it is reconstructed only as an additional exact-calibration check.'
  },

  aggregate,

  gates,

  validationPass,

  recommendedStatusIfPass: {
    integrityValidation:
      'pass',

    semanticValidation:
      'pass',

    replicationStatus:
      'cross_replay_replicated'
  },

  authorityBoundary: {
    positionTrajectory:
      'Discrete observed PlayerState position samples, not a continuous path between observations.',

    xyDistance:
      'Cumulative planar displacement across the frozen valid-step rule.',

    xyzDistance:
      'Cumulative 3D displacement across the frozen valid-step rule.',

    explicitlyNotEstablished: [
      'continuous geometric path length between samples',
      'player locomotion intent',
      'whether displacement was voluntary versus forced movement',
      'distance traveled while dead',
      'distance across movement-invalid endpoints',
      'distance represented by excluded >2000-unit hard jumps',
      'pathing around geometry between samples',
      'moving-versus-low-motion classification as an authoritative metric in this phase'
    ]
  },

  replays:
    replayResults
};

mkdirSync(
  dirname(
    outputPath
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  outputPath,
  JSON.stringify(
    output,
    null,
    2
  ),
  'utf8'
);

printSummary(
  output
);

// ============================================================
// Replay analysis
// ============================================================

async function analyzeReplay(
  replayName,
  path,
  legacy
) {
  const players =
    new Map();

  const cadenceCounts =
    new Map();

  let trajectorySamples =
    0;

  let acceptedSteps =
    0;

  let rejectedHardJumps =
    0;

  let excludedPrematchTransitions =
    0;

  let excludedDeadEndpointTransitions =
    0;

  let excludedMovementInvalidTransitions =
    0;

  let nonfinitePositionTransitions =
    0;

  let nonpositiveDtTransitions =
    0;

  let maxAcceptedStep3D =
    null;

  let minRejectedHardJump3D =
    null;

  let maxRejectedHardJump3D =
    null;

  let xyDistance =
    0;

  let xyzDistance =
    0;

  let validMovementSeconds =
    0;

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

  for await (const line of rl) {
    if (!line.trim()) {
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

    const c =
      row?.controller;

    const pawn =
      row?.pawn;

    if (
      !c
      ||
      typeof c !==
        'object'
      ||
      !pawn
      ||
      typeof pawn !==
        'object'
    ) {
      continue;
    }

    const playerName =
      text(
        c.playerName
      );

    if (
      !playerName
      ||
      playerName ===
        'SourceTV'
    ) {
      continue;
    }

    const sample = {
      tick:
        finite(
          row.demoTick
          ??
          row.tick
        ),

      matchTime:
        finite(
          row.matchTimeSeconds
        ),

      alive:
        Boolean(
          c.alive
        ),

      movementValid:
        pawn.positionValidForMovement ===
          true,

      position:
        normalizePosition(
          pawn.positionWorld
        )
    };

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

        xyDistance:
          0,

        xyzDistance:
          0,

        validMovementSeconds:
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
      sample.matchTime !==
        null
      &&
      sample.matchTime >=
        0
      &&
      sample.position
    ) {
      trajectorySamples++;

      p.trajectorySamples++;
    }

    if (p.previous) {
      const previous =
        p.previous;

      const dt =
        (
          sample.matchTime !==
            null
          &&
          previous.matchTime !==
            null
        )
          ? sample.matchTime -
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
        incrementMap(
          cadenceCounts,
          formatCadence(
            dt
          )
        );
      }

      if (
        sample.matchTime ===
          null
        ||
        previous.matchTime ===
          null
        ||
        sample.matchTime <
          0
        ||
        previous.matchTime <
          0
      ) {
        excludedPrematchTransitions++;

      } else if (
        !previous.alive
        ||
        !sample.alive
      ) {
        excludedDeadEndpointTransitions++;

      } else if (
        !previous.movementValid
        ||
        !sample.movementValid
      ) {
        excludedMovementInvalidTransitions++;

      } else if (
        !previous.position
        ||
        !sample.position
      ) {
        nonfinitePositionTransitions++;

      } else if (
        !Number.isFinite(
          dt
        )
        ||
        dt <=
          0
      ) {
        nonpositiveDtTransitions++;

      } else {
        const dx =
          sample.position.x -
          previous.position.x;

        const dy =
          sample.position.y -
          previous.position.y;

        const dz =
          sample.position.z -
          previous.position.z;

        const stepXY =
          Math.hypot(
            dx,
            dy
          );

        const step3D =
          Math.hypot(
            dx,
            dy,
            dz
          );

        if (
          step3D >
          MAX_ACCEPTED_STEP_3D
        ) {
          rejectedHardJumps++;

          p.rejectedHardJumps++;

          minRejectedHardJump3D =
            minFinite(
              minRejectedHardJump3D,
              step3D
            );

          maxRejectedHardJump3D =
            maxFinite(
              maxRejectedHardJump3D,
              step3D
            );

        } else {
          acceptedSteps++;

          p.acceptedSteps++;

          xyDistance +=
            stepXY;

          xyzDistance +=
            step3D;

          validMovementSeconds +=
            dt;

          p.xyDistance +=
            stepXY;

          p.xyzDistance +=
            step3D;

          p.validMovementSeconds +=
            dt;

          maxAcceptedStep3D =
            maxFinite(
              maxAcceptedStep3D,
              step3D
            );

          const speed3D =
            step3D /
            dt;

          if (
            speed3D <
            LEGACY_LOW_MOTION_SPEED
          ) {
            p.lowMotionSeconds +=
              dt;

          } else {
            p.movingSeconds +=
              dt;
          }
        }
      }
    }

    p.previous =
      sample;
  }

  const legacyReproduction =
    replayName ===
      'test'
      &&
      legacy
        ? compareLegacy(
            players,
            legacy
          )
        : null;

  return {
    replayName,

    success:
      true,

    playerCount:
      players.size,

    trajectorySamples,

    acceptedSteps,

    rejectedHardJumps,

    excludedPrematchTransitions,

    excludedDeadEndpointTransitions,

    excludedMovementInvalidTransitions,

    nonfinitePositionTransitions,

    nonpositiveDtTransitions,

    maxAcceptedStep3D,

    minRejectedHardJump3D,

    maxRejectedHardJump3D,

    xyDistance,

    xyzDistance,

    validMovementSeconds,

    cadence:
      summarizeCadence(
        cadenceCounts
      ),

    legacyReproduction,

    players:
      [...players.values()]
        .map(
          p => ({
            playerName:
              p.playerName,

            trajectorySamples:
              p.trajectorySamples,

            acceptedSteps:
              p.acceptedSteps,

            rejectedHardJumps:
              p.rejectedHardJumps,

            xyDistance:
              p.xyDistance,

            xyzDistance:
              p.xyzDistance,

            validMovementSeconds:
              p.validMovementSeconds
          })
        )
  };
}

// ============================================================
// Exact legacy reproduction
// ============================================================

function compareLegacy(
  players,
  legacy
) {
  const legacyPlayers =
    new Map(
      (
        legacy.players
        ??
        []
      ).map(
        row => [
          row.playerName,
          row
        ]
      )
    );

  const fields = [
    'travelDistanceXY',
    'travelDistance3D',
    'validMovementSeconds',
    'meanSpeedXY',
    'meanSpeed3D',
    'movingSeconds',
    'lowMotionSeconds',
    'lowMotionShare',
    'rejectedJumpCount'
  ];

  const mismatches =
    [];

  let comparedPlayers =
    0;

  let comparedValues =
    0;

  let maxAbsoluteError =
    0;

  for (
    const [
      playerName,
      p
    ]
    of players
  ) {
    const legacyRow =
      legacyPlayers.get(
        playerName
      );

    if (!legacyRow) {
      mismatches.push({
        playerName,
        field:
          'player',
        reason:
          'missing from legacy reference'
      });

      continue;
    }

    const movement =
      legacyRow.movement
      ??
      {};

    const derived = {
      travelDistanceXY:
        p.xyDistance,

      travelDistance3D:
        p.xyzDistance,

      validMovementSeconds:
        p.validMovementSeconds,

      meanSpeedXY:
        safeDiv(
          p.xyDistance,
          p.validMovementSeconds
        ),

      meanSpeed3D:
        safeDiv(
          p.xyzDistance,
          p.validMovementSeconds
        ),

      movingSeconds:
        p.movingSeconds,

      lowMotionSeconds:
        p.lowMotionSeconds,

      lowMotionShare:
        safeDiv(
          p.lowMotionSeconds,
          p.validMovementSeconds
        ),

      rejectedJumpCount:
        p.rejectedHardJumps
    };

    comparedPlayers++;

    for (const field of fields) {
      const actual =
        derived[field];

      const expected =
        movement[field];

      comparedValues++;

      if (
        Number.isFinite(
          actual
        )
        &&
        Number.isFinite(
          expected
        )
      ) {
        const error =
          Math.abs(
            actual -
            expected
          );

        maxAbsoluteError =
          Math.max(
            maxAbsoluteError,
            error
          );

        if (
          error >
          1e-9
        ) {
          mismatches.push({
            playerName,
            field,
            actual,
            expected,
            absoluteError:
              error
          });
        }

      } else if (
        actual !==
        expected
      ) {
        mismatches.push({
          playerName,
          field,
          actual,
          expected
        });
      }
    }
  }

  return {
    referenceVersion:
      legacy.version
      ??
      null,

    comparedPlayers,

    comparedValues,

    maxAbsoluteError,

    mismatchCount:
      mismatches.length,

    mismatches,

    pass:
      comparedPlayers ===
        12
      &&
      mismatches.length ===
        0
  };
}

// ============================================================
// Aggregate / reporting
// ============================================================

function aggregateResults(
  rows
) {
  const result = {
    successfulReplays:
      rows.length,

    playerReplayCount:
      0,

    trajectorySamples:
      0,

    acceptedSteps:
      0,

    rejectedHardJumps:
      0,

    excludedPrematchTransitions:
      0,

    excludedDeadEndpointTransitions:
      0,

    excludedMovementInvalidTransitions:
      0,

    nonfinitePositionTransitions:
      0,

    nonpositiveDtTransitions:
      0,

    maxAcceptedStep3D:
      null,

    minRejectedHardJump3D:
      null,

    maxRejectedHardJump3D:
      null,

    xyDistance:
      0,

    xyzDistance:
      0,

    validMovementSeconds:
      0
  };

  const cadenceCounts =
    new Map();

  for (const row of rows) {
    result.playerReplayCount +=
      row.playerCount;

    for (
      const key
      of [
        'trajectorySamples',
        'acceptedSteps',
        'rejectedHardJumps',
        'excludedPrematchTransitions',
        'excludedDeadEndpointTransitions',
        'excludedMovementInvalidTransitions',
        'nonfinitePositionTransitions',
        'nonpositiveDtTransitions',
        'xyDistance',
        'xyzDistance',
        'validMovementSeconds'
      ]
    ) {
      result[key] +=
        row[key]
        ??
        0;
    }

    result.maxAcceptedStep3D =
      maxFinite(
        result.maxAcceptedStep3D,
        row.maxAcceptedStep3D
      );

    result.minRejectedHardJump3D =
      minFinite(
        result.minRejectedHardJump3D,
        row.minRejectedHardJump3D
      );

    result.maxRejectedHardJump3D =
      maxFinite(
        result.maxRejectedHardJump3D,
        row.maxRejectedHardJump3D
      );

    for (
      const [
        key,
        count
      ]
      of Object.entries(
        row
          .cadence
          ?.counts
        ??
        {}
      )
    ) {
      cadenceCounts.set(
        key,
        (
          cadenceCounts.get(
            key
          )
          ??
          0
        )
        +
        count
      );
    }
  }

  result.cadence =
    summarizeCadence(
      cadenceCounts
    );

  return result;
}

function summarizeCadence(
  counts
) {
  const entries =
    [...counts.entries()]
      .sort(
        (
          a,
          b
        ) =>
          Number(
            a[0]
          )
          -
          Number(
            b[0]
          )
      );

  const total =
    entries.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row[1],
      0
    );

  const quarter =
    counts.get(
      '0.250000'
    )
    ??
    0;

  return {
    totalPositiveIntervals:
      total,

    quarterSecondIntervals:
      quarter,

    quarterSecondShare:
      safeDiv(
        quarter,
        total
      ),

    counts:
      Object.fromEntries(
        entries
      )
  };
}

function printSummary(
  output
) {
  const a =
    output.aggregate;

  console.log('');
  console.log('========================================================');
  console.log('CROSS-REPLAY MOVEMENT DISTANCE EVIDENCE');
  console.log('========================================================');
  console.log(
    `Successful replays: ${output.successCount}/${output.replayCount}`
  );
  console.log(
    `Player-replay records: ${a.playerReplayCount}`
  );
  console.log(
    `Observed post-start finite trajectory samples: ${a.trajectorySamples}`
  );
  console.log(
    `Accepted alive→alive movement steps: ${a.acceptedSteps}`
  );
  console.log(
    `Rejected >2000 3D hard jumps: ${a.rejectedHardJumps}`
  );
  console.log(
    `Movement-invalid endpoint transitions: ${a.excludedMovementInvalidTransitions}`
  );
  console.log(
    `Dead-endpoint transitions: ${a.excludedDeadEndpointTransitions}`
  );
  console.log(
    `Nonfinite position transitions after other gates: ${a.nonfinitePositionTransitions}`
  );
  console.log(
    `Nonpositive-dt transitions after other gates: ${a.nonpositiveDtTransitions}`
  );
  console.log('');
  console.log(
    `Maximum accepted 3D step: ${formatNumber(a.maxAcceptedStep3D)}`
  );
  console.log(
    `Minimum rejected hard jump: ${formatNumber(a.minRejectedHardJump3D)}`
  );
  console.log(
    `Maximum rejected hard jump: ${formatNumber(a.maxRejectedHardJump3D)}`
  );
  console.log('');
  console.log(
    `Quarter-second cadence: ${a.cadence.quarterSecondIntervals}/${a.cadence.totalPositiveIntervals} = ${pct(a.cadence.quarterSecondShare)}`
  );
  console.log('');
  console.log(
    `Aggregate XY distance: ${formatNumber(a.xyDistance)}`
  );
  console.log(
    `Aggregate XYZ distance: ${formatNumber(a.xyzDistance)}`
  );
  console.log(
    `Aggregate valid movement seconds: ${formatNumber(a.validMovementSeconds)}`
  );
  console.log('');

  const legacy =
    output.replays.find(
      row =>
        row.replayName ===
        'test'
    )
    ?.legacyReproduction;

  if (legacy) {
    console.log('Legacy V02 exact-reproduction control:');
    console.log(
      `  players: ${legacy.comparedPlayers}/12`
    );
    console.log(
      `  values compared: ${legacy.comparedValues}`
    );
    console.log(
      `  mismatches: ${legacy.mismatchCount}`
    );
    console.log(
      `  maximum absolute error: ${legacy.maxAbsoluteError}`
    );
    console.log(
      `  result: ${legacy.pass ? 'PASS' : 'FAIL'}`
    );
    console.log('');
  }

  console.log(
    `VALIDATION: ${output.validationPass ? 'PASS' : 'DO NOT PROMOTE'}`
  );
  console.log('');
  console.log(
    'SEMANTIC BOUNDARY: trajectory = discrete observed position samples; distance = displacement across frozen valid steps, not continuous path length.'
  );
  console.log('');
  console.log(
    `Output: ${outputPath}`
  );
  console.log('');
}

// ============================================================
// Utilities
// ============================================================

function normalizePosition(
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
    x === null
    ||
    y === null
    ||
    z === null
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
    b !==
      0
  )
    ? a /
      b
    : null;
}

function text(
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

  const result =
    String(
      value
    ).trim();

  return result
    ? result
    : null;
}

function incrementMap(
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

function formatCadence(
  value
) {
  return Number(
    value
  ).toFixed(
    6
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

function formatNumber(
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
