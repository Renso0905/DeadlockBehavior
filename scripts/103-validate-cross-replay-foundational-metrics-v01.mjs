import {
  createReadStream,
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
// SETTINGS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const BASE_BATCH_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_state_base_batch_v02.json'
  );


const EVENT_BATCH_PATH =
  resolve(
    'output',
    'cross_replay',
    'compact_event_replication_extraction_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'foundational_replication_metrics_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'foundational_replication_metrics_v01.md'
  );


// ============================================================
// DISCOVERY-REPLAY FROZEN PRIORS
//
// These are NOT silently refitted.
//
// For each independent replay we report:
//
//   1. performance of the frozen discovery value
//   2. independently best-fitting replay value
//
// This lets us distinguish:
//
//   "same relationship, slightly different boundary"
//
// from:
//
//   "discovery result does not generalize"
// ============================================================

const FROZEN_PHYSICAL_VACUUM_HU =
  735;


const FROZEN_RECIPIENT_RADIUS_HU =
  2150;


const FROZEN_TARGET_TO_INACTIVE_MEDIAN_SECONDS =
  0.6406;


const TARGETLESS_TIMEOUT_LOWER_SECONDS =
  18;


const TARGETLESS_TIMEOUT_UPPER_SECONDS =
  40;


const TARGETLESS_TIMEOUT_SLOPE_SECONDS_PER_MINUTE =
  4;


const TARGETLESS_TIMEOUT_INTERCEPT_SECONDS =
  -17.9271;


// ============================================================
// MATCHING PRIOR FROM SCRIPT102
// ============================================================

const DEATH_ACTIVATION_MIN_TICK_OFFSET =
  -1;


const DEATH_ACTIVATION_MAX_TICK_OFFSET =
  4;


const DEATH_ACTIVATION_MAX_DISTANCE_HU =
  160;


// ============================================================
// VACUUM THRESHOLD SEARCH
// ============================================================

const VACUUM_THRESHOLD_MIN_HU =
  500;


const VACUUM_THRESHOLD_MAX_HU =
  1000;


const VACUUM_THRESHOLD_STEP_HU =
  5;


// ============================================================
// ECONOMIC RECIPIENT THRESHOLD SEARCH
// ============================================================

const RECIPIENT_THRESHOLD_MIN_HU =
  1500;


const RECIPIENT_THRESHOLD_MAX_HU =
  2600;


const RECIPIENT_THRESHOLD_STEP_HU =
  5;


// ============================================================
// AIM WINDOWS
//
// player_state is 4 Hz = one sample every 16 ticks.
//
// We retain the same conceptual windows as Script98:
//
//   primary: 0-48 ticks before impact
//   placebo: 128-176 ticks before impact
//
// We are no longer claiming exact firing tick.
// ============================================================

const AIM_PRIMARY_MIN_LAG_TICKS =
  0;


const AIM_PRIMARY_MAX_LAG_TICKS =
  48;


const AIM_PLACEBO_MIN_LAG_TICKS =
  128;


const AIM_PLACEBO_MAX_LAG_TICKS =
  176;


// ============================================================
// VALIDATED ANGLE STRUCTURE FROM DISCOVERY
// ============================================================

const YAW_COMPONENT =
  1;


const PITCH_COMPONENT =
  0;


const DISCOVERY_DAMAGE_DIRECTION_SIGN =
  1;


const DISCOVERY_EYE_PITCH_SIGN =
  -1;


// ============================================================
// DOCUMENTED / DISCOVERY-SUPPORTED SHARE TOTAL MULTIPLIERS
// ============================================================

const SHARE_TOTAL_MULTIPLIER =
  new Map([

    [
      1,
      1.00
    ],

    [
      2,
      1.08
    ],

    [
      3,
      1.08
    ],

    [
      4,
      1.00
    ],

    [
      5,
      1.00
    ],

    [
      6,
      0.96
    ]
  ]);


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    BASE_BATCH_PATH,
    EVENT_BATCH_PATH
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


const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


const baseBatch =
  JSON.parse(
    readFileSync(
      BASE_BATCH_PATH,
      'utf8'
    )
  );


const eventBatch =
  JSON.parse(
    readFileSync(
      EVENT_BATCH_PATH,
      'utf8'
    )
  );


if (
  manifest
    ?.readyToBeginReplication !==
  true
) {

  throw new Error(
    'Script100 manifest is not replication-ready.'
  );
}


if (
  baseBatch
    ?.structuralChecks
    ?.baseExtractionReady !==
  true
) {

  throw new Error(
    'Script101 V02 substrate is not ready.'
  );
}


if (
  eventBatch
    ?.batchPass !==
  true
) {

  throw new Error(
    'Script102 event extraction batch did not PASS.'
  );
}


const cohort =
  Array.isArray(
    manifest
      ?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No replication cohort present.'
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
  'CROSS-REPLAY FOUNDATIONAL REPLICATION METRICS V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'No raw .dem parsing in this script.'
);


console.log('');


// ============================================================
// REPLAY LOOP
// ============================================================

const replaySummaries =
  [];


const internalResults =
  [];


for (
  let replayIndex =
    0;

  replayIndex <
    cohort.length;

  replayIndex++
) {

  const replayName =
    String(
      cohort[
        replayIndex
      ].replayName
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${replayIndex + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await analyzeReplay(
      replayName
    );


  replaySummaries.push(
    result.summary
  );


  internalResults.push(
    result.internal
  );


  writeFileSync(

    resolve(
      'output',
      replayName,
      'foundational_replication_metrics_v01.json'
    ),

    JSON.stringify(
      result.summary,
      null,
      2
    ),

    'utf8'
  );


  printReplaySummary(
    result.summary
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY CLAIM SUMMARY
// ============================================================

const claims =
  buildCrossReplayClaims(
    replaySummaries
  );


// ============================================================
// CROSS-REPLAY DESCRIPTIVE DISTRIBUTIONS
//
// These summarize replay-level estimates.
//
// They are intentionally NOT computed by pooling all events into
// one pseudo-replay.
// ============================================================

const replayLevelDistributions = {

  productionAnyCandidateRate:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.productionLastHit
              ?.creditedDeathsWithAnyActivationCandidateRate
        )
    ),


  productionStrictMatchRate:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.productionLastHit
              ?.creditedDeathsWithStrictMatchRate
        )
    ),


  targetToInactiveMedianSeconds:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.lifecycle
              ?.targetToInactiveSeconds
              ?.median
        )
    ),


  vacuumBestXYThresholdHU:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.vacuumGeometry
              ?.xy
              ?.bestThreshold
              ?.thresholdHU
        )
    ),


  frozen735XYMCC:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.vacuumGeometry
              ?.xy
              ?.frozen735
              ?.mcc
        )
    ),


  recipientBest3DThresholdHU:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.recipientGeometry
              ?.threeD
              ?.bestThreshold
              ?.thresholdHU
        )
    ),


  recipientFrozen2150MCC:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.recipientGeometry
              ?.threeD
              ?.frozen2150
              ?.mcc
        )
    ),


  integerPartitionExactRate:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.rewardAllocation
              ?.integerPartition
              ?.exactRate
        )
    ),


  creditedRemainderPriorityRate:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.rewardAllocation
              ?.remainderPriority
              ?.creditedGetsCeilRate
        )
    ),


  ordinaryRewardSlope:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.rewardScaling
              ?.leadingPre35Regression
              ?.slope
        )
    ),


  ordinaryRewardIntercept:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.rewardScaling
              ?.leadingPre35Regression
              ?.intercept
        )
    ),


  aimPrimaryMedianDegrees:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.aimOrientation
              ?.eye
              ?.primaryError
              ?.median
        )
    ),


  aimPlaceboMedianDegrees:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.aimOrientation
              ?.eye
              ?.placeboError
              ?.median
        )
    ),


  aimPrimaryBeatsPlaceboRate:
    summarizeNumbers(
      replaySummaries
        .map(
          row =>
            row
              ?.aimOrientation
              ?.eye
              ?.primaryBeatsPlaceboRate
        )
    )
};


// ============================================================
// AGGREGATE AIM CONVENTION
//
// This is included because individual replay CItemXP hit counts
// are small.
//
// The mechanic-generalization decision still uses replay-level
// support, but this pooled descriptive result tells us whether
// the sign/pitch convention remains globally coherent.
// ============================================================

const allAimCases =
  internalResults.flatMap(
    row =>
      row.aimCases
  );


const aggregateAimConvention =
  evaluateAimConventionSearch(
    allAimCases
  );


// ============================================================
// OVERALL REPLICATION STATUS
// ============================================================

const stronglyReplicatedClaims =
  Object
    .values(
      claims
    )
    .filter(
      row =>
        row.status ===
        'STRONGLY_REPLICATED'
    )
    .length;


const replicatedOrSupportedClaims =
  Object
    .values(
      claims
    )
    .filter(
      row =>
        [
          'STRONGLY_REPLICATED',
          'SUPPORTED'
        ].includes(
          row.status
        )
    )
    .length;


let overallStatus;


if (
  stronglyReplicatedClaims ===
  Object.keys(
    claims
  ).length
) {

  overallStatus =
    'FOUNDATIONAL_RELATIONSHIPS_STRONGLY_REPLICATED';

} else if (
  replicatedOrSupportedClaims >=
  Math.ceil(
    Object.keys(
      claims
    ).length *
    0.75
  )
) {

  overallStatus =
    'FOUNDATIONAL_RELATIONSHIPS_BROADLY_SUPPORTED';

} else {

  overallStatus =
    'MIXED_CROSS_REPLAY_REPLICATION';
}


// ============================================================
// OUTPUT SUMMARY
// ============================================================

const summary = {

  version:
    'CROSS_REPLAY_FOUNDATIONAL_REPLICATION_METRICS_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  overallStatus,


  design: {

    discoveryReplay:
      manifest
        ?.discoveryReplay ??
      'test',

    discoveryReplayIncludedAsReplicationUnit:
      false,

    independentReplicationUnits:
      cohort.length,

    replicationUnit:
      'REPLAY',

    eventPoolingPolicy:
      'Replay-level estimates are primary. Event pooling is used only for descriptive diagnostics such as aggregate aim convention.',

    frozenPriorPolicy:
      'Discovery-replay thresholds and angle conventions are evaluated directly before independent replay-specific best fits are considered.'
  },


  frozenDiscoveryPriors: {

    physicalVacuumHU:
      FROZEN_PHYSICAL_VACUUM_HU,

    recipientRadius3DHU:
      FROZEN_RECIPIENT_RADIUS_HU,

    targetToInactiveMedianSeconds:
      FROZEN_TARGET_TO_INACTIVE_MEDIAN_SECONDS,

    targetlessTimeout: {

      lowerSeconds:
        TARGETLESS_TIMEOUT_LOWER_SECONDS,

      upperSeconds:
        TARGETLESS_TIMEOUT_UPPER_SECONDS,

      slopeSecondsPerMinute:
        TARGETLESS_TIMEOUT_SLOPE_SECONDS_PER_MINUTE,

      interceptSeconds:
        TARGETLESS_TIMEOUT_INTERCEPT_SECONDS
    },

    worldYaw:
      'PLUS_YAW_0',

    eyeYawComponent:
      YAW_COMPONENT,

    eyePitchComponent:
      PITCH_COMPONENT,

    damageDirectionSign:
      DISCOVERY_DAMAGE_DIRECTION_SIGN,

    eyePitchSign:
      DISCOVERY_EYE_PITCH_SIGN
  },


  claims,

  replayLevelDistributions,

  aggregateAimConvention,

  replays:
    replaySummaries,


  interpretationGuide: {

    frozenVsBestFit:
      'High frozen-threshold performance is stronger replication evidence than merely recovering a similar best-fitting threshold.',

    replayUnit:
      'Thousands of events within one replay improve precision inside that replay but do not increase the number of independent replication units.',

    strictMatching:
      'Economic analyses use mutually unique death-activation candidate pairs to minimize false source attribution.',

    isolatedEconomy:
      'Reward and recipient analyses require isolated exact-tick payout cases to reduce contamination from simultaneous unrelated currency gains.',

    rewardScaling:
      'Ordinary reward scaling is estimated primarily from leading-team pre-35-minute cases to avoid comeback and late Super-Trooper confounds.',

    vacuum:
      'Vacuum geometry uses 4-Hz player-state positions and therefore should not be interpreted as an exact engine-radius measurement.',

    aim:
      'Aim replication uses successful CItemXP damage as a positive-control attack event and compares the near-impact window with a temporally distant placebo window.'
  },


  nextStage: {

    conditional:
      true,

    ifStrong:
      'Promote replicated foundational telemetry contracts from single-replay operational status to cross-replay validated status and proceed toward behavioral opportunity-feature construction.',

    ifMixed:
      'Investigate only the specific non-replicating contract instead of reopening the entire discovery pipeline.'
  },


  outputs: {

    json:
      OUTPUT_JSON_PATH,

    markdown:
      OUTPUT_MARKDOWN_PATH,

    perReplay:
      replaySummaries.map(
        row =>
          resolve(
            'output',
            row.replay,
            'foundational_replication_metrics_v01.json'
          )
      )
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
  'CROSS-REPLAY CLAIM SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');


for (
  const [
    id,
    row
  ]
  of Object.entries(
    claims
  )
) {

  console.log(
    `${id.padEnd(38)} ` +
    `${row.status.padEnd(22)} ` +
    `${row.supportedReplays}/${row.informativeReplays}`
  );
}


console.log('');

console.log(
  `OVERALL STATUS: ${overallStatus}`
);


console.log('');

console.log(
  'REPLAY-LEVEL KEY DISTRIBUTIONS'
);


console.log(
  '------------------------------'
);


console.log(
  `Recipient best threshold: ${formatDistribution(
    replayLevelDistributions
      .recipientBest3DThresholdHU
  )}`
);


console.log(
  `Frozen 2150 MCC:          ${formatDistribution(
    replayLevelDistributions
      .recipientFrozen2150MCC
  )}`
);


console.log(
  `Integer partition rate:   ${formatDistribution(
    replayLevelDistributions
      .integerPartitionExactRate
  )}`
);


console.log(
  `Remainder priority rate:  ${formatDistribution(
    replayLevelDistributions
      .creditedRemainderPriorityRate
  )}`
);


console.log(
  `Aim primary median:       ${formatDistribution(
    replayLevelDistributions
      .aimPrimaryMedianDegrees
  )}`
);


console.log(
  `Aim placebo median:       ${formatDistribution(
    replayLevelDistributions
      .aimPlaceboMedianDegrees
  )}`
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
// REPLAY ANALYSIS
// ============================================================

async function analyzeReplay(
  replayName
) {

  const outputDir =
    resolve(
      'output',
      replayName
    );


  const paths = {

    deaths:
      resolve(
        outputDir,
        'replication_trooper_deaths_v01.jsonl'
      ),

    activations:
      resolve(
        outputDir,
        'replication_assigned_gold_activations_v01.jsonl'
      ),

    lastHits:
      resolve(
        outputDir,
        'replication_last_hit_events_v01.jsonl'
      ),

    currency:
      resolve(
        outputDir,
        'replication_currency0_deltas_v01.jsonl'
      ),

    citemxp:
      resolve(
        outputDir,
        'replication_citemxp_damage_events_v01.jsonl'
      ),

    playerState:
      resolve(
        outputDir,
        'player_state.jsonl'
      )
  };


  for (
    const path
    of Object.values(
      paths
    )
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


  // ----------------------------------------------------------
  // LOAD EVENT EXTRACTS
  // ----------------------------------------------------------

  const deaths =
    await loadJsonl(
      paths.deaths
    );


  const activations =
    await loadJsonl(
      paths.activations
    );


  const lastHits =
    await loadJsonl(
      paths.lastHits
    );


  const currency =
    await loadJsonl(
      paths.currency
    );


  const citemxp =
    await loadJsonl(
      paths.citemxp
    );


  // ----------------------------------------------------------
  // LOAD COMPACT PLAYER STATE INDEX
  // ----------------------------------------------------------

  const playerState =
    await buildPlayerStateIndex(
      paths.playerState
    );


  // ----------------------------------------------------------
  // STRICT DEATH <-> ACTIVATION MATCHING
  // ----------------------------------------------------------

  const matching =
    buildStrictDeathActivationMatches(
      deaths,
      activations
    );


  // ----------------------------------------------------------
  // PRODUCTION / LAST HIT
  // ----------------------------------------------------------

  const productionLastHit =
    analyzeProductionLastHit(
      matching,
      deaths
    );


  // ----------------------------------------------------------
  // LIFECYCLE
  // ----------------------------------------------------------

  const lifecycle =
    analyzeLifecycle(
      matching.strictMatches
    );


  // ----------------------------------------------------------
  // VACUUM GEOMETRY
  // ----------------------------------------------------------

  const vacuumGeometry =
    analyzeVacuumGeometry(
      matching.strictMatches,
      playerState
    );


  // ----------------------------------------------------------
  // ECONOMY
  // ----------------------------------------------------------

  const economic =
    buildEconomicCases(
      matching.strictMatches,
      currency
    );


  // ----------------------------------------------------------
  // RECIPIENT GEOMETRY
  // ----------------------------------------------------------

  const recipientGeometry =
    analyzeRecipientGeometry(
      economic.cleanCases
    );


  // ----------------------------------------------------------
  // INTEGER ALLOCATION
  // ----------------------------------------------------------

  const rewardAllocation =
    analyzeRewardAllocation(
      economic.cleanCases
    );


  // ----------------------------------------------------------
  // REWARD SCALING
  // ----------------------------------------------------------

  const rewardScaling =
    analyzeRewardScaling(
      economic.cleanCases
    );


  // ----------------------------------------------------------
  // AIM
  // ----------------------------------------------------------

  const aim =
    analyzeAimOrientation(
      citemxp,
      playerState
    );


  // ----------------------------------------------------------
  // REPLAY SUPPORT FLAGS
  // ----------------------------------------------------------

  const support = {


    productionLastHit:
      evaluateProductionSupport(
        productionLastHit
      ),


    lifecycle:
      evaluateLifecycleSupport(
        lifecycle
      ),


    vacuumProximity:
      evaluateVacuumSupport(
        vacuumGeometry
      ),


    economicRecipientSet:
      evaluateEconomicRecipientSupport(
        economic
      ),


    recipientGeometry:
      evaluateRecipientGeometrySupport(
        recipientGeometry
      ),


    rewardAllocation:
      evaluateRewardSupport(
        rewardAllocation,
        rewardScaling
      ),


    aimOrientation:
      evaluateAimSupport(
        aim
      )
  };


  // ----------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------

  const summary = {

    replay:
      replayName,

    version:
      'FOUNDATIONAL_REPLICATION_METRICS_V01',

    canonical:
      false,


    sourceCounts: {

      deaths:
        deaths.length,

      activations:
        activations.length,

      lastHitEvents:
        lastHits.length,

      currencyEvents:
        currency.length,

      citemxpDamageEvents:
        citemxp.length,

      playerStateSamples:
        playerState.totalSamples
    },


    matching: {

      economicDeaths:
        matching.economicDeaths.length,

      candidateEdges:
        matching.edges.length,

      deathsWithCandidate:
        matching.deathsWithCandidate,

      activationsWithCandidate:
        matching.activationsWithCandidate,

      strictMutualOneToOneMatches:
        matching.strictMatches.length,

      ambiguousDeaths:
        matching.ambiguousDeaths,

      ambiguousActivations:
        matching.ambiguousActivations
    },


    productionLastHit,

    lifecycle,

    vacuumGeometry,


    economicRecipientSet: {

      strictMatchesWithUniqueCredited:
        economic.withUniqueCredited,

      strictMatchesWithEndTick:
        economic.withEndTick,

      isolatedCleanCases:
        economic.cleanCases.length,

      creditedIncluded:
        economic.creditedIncluded,

      creditedIncludedRate:
        rate(
          economic.creditedIncluded,
          economic.cleanCases.length
        ),

      physicalTargetDifferentFromCredited:
        economic.targetDifferentFromCredited,

      physicalTargetEconomicallyAbsent:
        economic.targetEconomicallyAbsent,

      physicalTargetEconomicallyAbsentRate:
        rate(
          economic.targetEconomicallyAbsent,
          economic.targetDifferentFromCredited
        )
    },


    recipientGeometry,

    rewardAllocation,

    rewardScaling,

    aimOrientation:
      aim.summary,

    support
  };


  return {

    summary,

    internal: {

      aimCases:
        aim.internalCases
    }
  };
}


// ============================================================
// STRICT DEATH <-> ACTIVATION MATCHING
// ============================================================

function buildStrictDeathActivationMatches(
  deaths,
  activations
) {

  const economicDeaths =
    deaths.filter(
      row =>
        row.economicBaseType ===
        true
    );


  const activationsByTick =
    groupBy(
      activations,
      row =>
        Number(
          row.activationTick
        )
    );


  const deathCandidates =
    new Map();


  const activationCandidates =
    new Map();


  const edges =
    [];


  for (
    const death
    of economicDeaths
  ) {

    const deathId =
      String(
        death.deathIndex ??
        `${death.entityIndex}|${death.tick}`
      );


    const deathEdges =
      [];


    for (
      let tick =
        Number(
          death.tick
        )
        +
        DEATH_ACTIVATION_MIN_TICK_OFFSET;

      tick <=
        Number(
          death.tick
        )
        +
        DEATH_ACTIVATION_MAX_TICK_OFFSET;

      tick++
    ) {

      for (
        const activation
        of activationsByTick.get(
          tick
        )
        ??
        []
      ) {

        if (
          !death.position
          ||
          !activation.position
        ) {

          continue;
        }


        const distance3D =
          distance3D(
            death.position,
            activation.position
          );


        if (
          distance3D >
          DEATH_ACTIVATION_MAX_DISTANCE_HU
        ) {

          continue;
        }


        const activationId =
          String(
            activation.activationId
          );


        const edge = {

          death,

          activation,

          deathId,

          activationId,

          tickOffset:
            Number(
              activation.activationTick
            )
            -
            Number(
              death.tick
            ),

          distance3D
        };


        edges.push(
          edge
        );


        deathEdges.push(
          edge
        );


        if (
          !activationCandidates.has(
            activationId
          )
        ) {

          activationCandidates.set(
            activationId,
            []
          );
        }


        activationCandidates
          .get(
            activationId
          )
          .push(
            edge
          );
      }
    }


    deathCandidates.set(
      deathId,
      deathEdges
    );
  }


  const strictMatches =
    [];


  for (
    const [
      deathId,
      candidates
    ]
    of deathCandidates
  ) {

    if (
      candidates.length !==
      1
    ) {

      continue;
    }


    const edge =
      candidates[
        0
      ];


    const reverse =
      activationCandidates.get(
        edge.activationId
      )
      ??
      [];


    if (
      reverse.length !==
      1
    ) {

      continue;
    }


    strictMatches.push(
      edge
    );
  }


  return {

    economicDeaths,

    edges,

    deathCandidates,

    activationCandidates,

    strictMatches,

    deathsWithCandidate:
      [
        ...deathCandidates.values()
      ]
        .filter(
          rows =>
            rows.length >
            0
        )
        .length,

    activationsWithCandidate:
      activationCandidates.size,

    ambiguousDeaths:
      [
        ...deathCandidates.values()
      ]
        .filter(
          rows =>
            rows.length >
            1
        )
        .length,

    ambiguousActivations:
      [
        ...activationCandidates.values()
      ]
        .filter(
          rows =>
            rows.length >
            1
        )
        .length
  };
}


// ============================================================
// PRODUCTION / LAST HIT
// ============================================================

function analyzeProductionLastHit(
  matching,
  deaths
) {

  const strictDeathIds =
    new Set(
      matching.strictMatches.map(
        edge =>
          edge.deathId
      )
    );


  const candidateDeathIds =
    new Set(
      matching.edges.map(
        edge =>
          edge.deathId
      )
    );


  const creditedDeaths =
    matching.economicDeaths.filter(
      death =>
        Boolean(
          death
            ?.lastHitEvidence
            ?.uniqueExactOpposing
        )
    );


  const creditedWithAnyCandidate =
    creditedDeaths.filter(
      death => {

        const id =
          String(
            death.deathIndex ??
            `${death.entityIndex}|${death.tick}`
          );


        return candidateDeathIds.has(
          id
        );
      }
    );


  const creditedWithStrictMatch =
    creditedDeaths.filter(
      death => {

        const id =
          String(
            death.deathIndex ??
            `${death.entityIndex}|${death.tick}`
          );


        return strictDeathIds.has(
          id
        );
      }
    );


  const strictWithUniqueCredited =
    matching.strictMatches.filter(
      edge =>
        Boolean(
          edge
            ?.death
            ?.lastHitEvidence
            ?.uniqueExactOpposing
        )
    );


  return {

    economicDeaths:
      matching.economicDeaths.length,

    economicDeathsWithUniqueExactOpposingLastHit:
      creditedDeaths.length,

    creditedDeathsWithAnyActivationCandidate:
      creditedWithAnyCandidate.length,

    creditedDeathsWithAnyActivationCandidateRate:
      rate(
        creditedWithAnyCandidate.length,
        creditedDeaths.length
      ),

    creditedDeathsWithStrictMatch:
      creditedWithStrictMatch.length,

    creditedDeathsWithStrictMatchRate:
      rate(
        creditedWithStrictMatch.length,
        creditedDeaths.length
      ),

    strictMatches:
      matching.strictMatches.length,

    strictMatchesWithUniqueExactOpposingLastHit:
      strictWithUniqueCredited.length,

    strictMatchesWithUniqueExactOpposingLastHitRate:
      rate(
        strictWithUniqueCredited.length,
        matching.strictMatches.length
      )
  };
}


// ============================================================
// LIFECYCLE
// ============================================================

function analyzeLifecycle(
  strictMatches
) {

  const activations =
    strictMatches.map(
      edge =>
        edge.activation
    );


  const targeted =
    activations.filter(
      row =>
        Boolean(
          row.firstValidVacuumTarget
        )
    );


  const targetless =
    activations.filter(
      row =>
        !row.firstValidVacuumTarget
    );


  const targetOnsetDelay =
    targeted
      .map(
        row =>
          finite(
            row.targetOnsetDelaySeconds
          )
      )
      .filter(
        Number.isFinite
      );


  const targetToInactive =
    targeted
      .map(
        row => {

          const targetTick =
            finite(
              row.targetOnsetTick
            );


          const endTick =
            finite(
              row.endTick
            );


          if (
            targetTick ===
              null
            ||
            endTick ===
              null
          ) {

            return null;
          }


          return (
            endTick -
            targetTick
          )
          /
          64;
        }
      )
      .filter(
        Number.isFinite
      );


  const immediate =
    targetOnsetDelay.filter(
      seconds =>
        seconds <=
        0.25
    );


  const delayed =
    targetOnsetDelay.filter(
      seconds =>
        seconds >
        0.25
    );


  const timeoutComparisons =
    [];


  for (
    const row
    of targetless
  ) {

    const duration =
      finite(
        row.durationSeconds
      );


    const activationMinute =
      finite(
        row.activationTimeSeconds
      ) !==
        null
        ? Number(
            row.activationTimeSeconds
          )
          /
          60
        : null;


    if (
      duration ===
        null
      ||
      activationMinute ===
        null
    ) {

      continue;
    }


    const predicted =
      clamp(

        TARGETLESS_TIMEOUT_SLOPE_SECONDS_PER_MINUTE
        *
        activationMinute

        +

        TARGETLESS_TIMEOUT_INTERCEPT_SECONDS,

        TARGETLESS_TIMEOUT_LOWER_SECONDS,

        TARGETLESS_TIMEOUT_UPPER_SECONDS
      );


    timeoutComparisons.push({

      observed:
        duration,

      predicted,

      error:
        duration -
        predicted,

      absError:
        Math.abs(
          duration -
          predicted
        )
    });
  }


  const timeoutAbs =
    timeoutComparisons.map(
      row =>
        row.absError
    );


  return {

    strictMatchedActivations:
      activations.length,

    targeted:
      targeted.length,

    targetless:
      targetless.length,

    targetedRate:
      rate(
        targeted.length,
        activations.length
      ),

    immediateTargeted:
      immediate.length,

    immediateTargetedRate:
      rate(
        immediate.length,
        targeted.length
      ),

    delayedTargeted:
      delayed.length,

    targetOnsetDelaySeconds:
      summarizeNumbers(
        targetOnsetDelay
      ),

    targetToInactiveSeconds:
      summarizeNumbers(
        targetToInactive
      ),

    targetToInactiveDiscoveryMedianDifference:
      Number.isFinite(
        median(
          targetToInactive
        )
      )
        ? median(
            targetToInactive
          )
          -
          FROZEN_TARGET_TO_INACTIVE_MEDIAN_SECONDS
        : null,

    targetlessTimeout: {

      comparable:
        timeoutComparisons.length,

      observed:
        summarizeNumbers(
          timeoutComparisons.map(
            row =>
              row.observed
          )
        ),

      predicted:
        summarizeNumbers(
          timeoutComparisons.map(
            row =>
              row.predicted
          )
        ),

      error:
        summarizeNumbers(
          timeoutComparisons.map(
            row =>
              row.error
          )
        ),

      absoluteError:
        summarizeNumbers(
          timeoutAbs
        ),

      within1:
        timeoutAbs.filter(
          value =>
            value <=
            1
        ).length,

      within1Rate:
        rate(
          timeoutAbs.filter(
            value =>
              value <=
              1
          ).length,
          timeoutAbs.length
        ),

      within2:
        timeoutAbs.filter(
          value =>
            value <=
            2
        ).length,

      within2Rate:
        rate(
          timeoutAbs.filter(
            value =>
              value <=
              2
          ).length,
          timeoutAbs.length
        )
    }
  };
}


// ============================================================
// VACUUM GEOMETRY
// ============================================================

function analyzeVacuumGeometry(
  strictMatches,
  playerState
) {

  const xyObservations =
    [];


  const threeDObservations =
    [];


  let targetedComparable =
    0;


  let targetlessComparable =
    0;


  for (
    const edge
    of strictMatches
  ) {

    const death =
      edge.death;


    const activation =
      edge.activation;


    const credited =
      death
        ?.lastHitEvidence
        ?.uniqueExactOpposing
      ??
      null;


    const creditedTeam =
      finite(
        credited?.team
      );


    if (
      creditedTeam ===
        null
    ) {

      continue;
    }


    // --------------------------------------------------------
    // TARGETED:
    //
    // distance from physical vacuum target player to exact
    // AssignedGold position at target onset.
    // --------------------------------------------------------

    if (
      activation.firstValidVacuumTarget
    ) {

      const transition =
        activation.firstValidVacuumTarget;


      let targetPlayerName =
        transition
          ?.player
          ?.playerName
        ??
        null;


      if (
        !targetPlayerName
      ) {

        targetPlayerName =
          playerState
            .pawnIndexToPlayer
            .get(
              Number(
                transition.decodedEntityIndex
              )
            )
          ??
          null;
      }


      if (
        !targetPlayerName
      ) {

        continue;
      }


      const samples =
        playerState
          .byPlayer
          .get(
            targetPlayerName
          )
        ??
        [];


      const targetTick =
        finite(
          transition.tick
        );


      const soulPosition =
        transition.assignedGoldPosition
        ??
        activation.position;


      if (
        targetTick ===
          null
        ||
        !soulPosition
      ) {

        continue;
      }


      const sample =
        findNearestSample(
          samples,
          targetTick,
          8
        );


      if (
        !sample?.position
      ) {

        continue;
      }


      targetedComparable++;


      xyObservations.push({

        positive:
          true,

        distance:
          distanceXY(
            sample.position,
            soulPosition
          )
      });


      threeDObservations.push({

        positive:
          true,

        distance:
          distance3D(
            sample.position,
            soulPosition
          )
      });


      continue;
    }


    // --------------------------------------------------------
    // TARGETLESS:
    //
    // minimum same-team player distance to the stationary soul
    // during its active lifetime.
    // --------------------------------------------------------

    const startTick =
      finite(
        activation.activationTick
      );


    const endTick =
      finite(
        activation.endTick
      );


    const soulPosition =
      activation.position;


    if (
      startTick ===
        null
      ||
      endTick ===
        null
      ||
      !soulPosition
    ) {

      continue;
    }


    let bestXY =
      Infinity;


    let best3D =
      Infinity;


    for (
      const [
        playerName,
        team
      ]
      of playerState.playerTeam
    ) {

      if (
        team !==
        creditedTeam
      ) {

        continue;
      }


      const samples =
        playerState
          .byPlayer
          .get(
            playerName
          )
        ??
        [];


      const minimum =
        findMinimumDistanceInRange(
          samples,
          startTick,
          endTick,
          soulPosition
        );


      if (
        Number.isFinite(
          minimum.xy
        )
      ) {

        bestXY =
          Math.min(
            bestXY,
            minimum.xy
          );
      }


      if (
        Number.isFinite(
          minimum.threeD
        )
      ) {

        best3D =
          Math.min(
            best3D,
            minimum.threeD
          );
      }
    }


    if (
      Number.isFinite(
        bestXY
      )
      &&
      Number.isFinite(
        best3D
      )
    ) {

      targetlessComparable++;


      xyObservations.push({

        positive:
          false,

        distance:
          bestXY
      });


      threeDObservations.push({

        positive:
          false,

        distance:
          best3D
      });
    }
  }


  const xy =
    evaluateThresholdFamily({

      observations:
        xyObservations,

      minimum:
        VACUUM_THRESHOLD_MIN_HU,

      maximum:
        VACUUM_THRESHOLD_MAX_HU,

      step:
        VACUUM_THRESHOLD_STEP_HU,

      frozen:
        FROZEN_PHYSICAL_VACUUM_HU,

      frozenName:
        'frozen735'
    });


  const threeD =
    evaluateThresholdFamily({

      observations:
        threeDObservations,

      minimum:
        VACUUM_THRESHOLD_MIN_HU,

      maximum:
        VACUUM_THRESHOLD_MAX_HU,

      step:
        VACUUM_THRESHOLD_STEP_HU,

      frozen:
        FROZEN_PHYSICAL_VACUUM_HU,

      frozenName:
        'frozen735'
    });


  return {

    targetedComparable,

    targetlessComparable,

    totalComparable:
      targetedComparable +
      targetlessComparable,

    note:
      '4-Hz player positions make this an operational replication of the proximity envelope, not an exact engine-radius measurement.',

    xy,

    threeD
  };
}


// ============================================================
// ECONOMIC CASE BUILDING
// ============================================================

function buildEconomicCases(
  strictMatches,
  currencyEvents
) {

  const currencyByTick =
    groupBy(
      currencyEvents,
      row =>
        Number(
          row.tick
        )
    );


  const provisional =
    [];


  let withUniqueCredited =
    0;


  let withEndTick =
    0;


  for (
    const edge
    of strictMatches
  ) {

    const death =
      edge.death;


    const activation =
      edge.activation;


    const credited =
      death
        ?.lastHitEvidence
        ?.uniqueExactOpposing
      ??
      null;


    if (
      !credited
    ) {

      continue;
    }


    withUniqueCredited++;


    const creditedPlayerName =
      credited.playerName
      ??
      null;


    const creditedTeam =
      finite(
        credited.team
      );


    const endTick =
      finite(
        activation.endTick
      );


    if (
      !creditedPlayerName
      ||
      creditedTeam ===
        null
      ||
      endTick ===
        null
    ) {

      continue;
    }


    withEndTick++;


    const exactEvents =
      currencyByTick.get(
        endTick
      )
      ??
      [];


    const aggregated =
      aggregateCurrencyEvents(
        exactEvents
      );


    const sameTeam =
      aggregated.filter(
        row =>
          row.team ===
          creditedTeam
        &&
          row.delta >
          0
      );


    const opponents =
      aggregated.filter(
        row =>
          row.team !==
            null
        &&
          row.team !==
            creditedTeam
        &&
          row.delta >
          0
      );


    const creditedRecipient =
      sameTeam.find(
        row =>
          row.playerName ===
          creditedPlayerName
      )
      ??
      null;


    const targetName =
      activation
        ?.firstValidVacuumTarget
        ?.player
        ?.playerName
      ??
      null;


    provisional.push({

      edge,

      death,

      activation,

      credited,

      creditedPlayerName,

      creditedTeam,

      endTick,

      exactEvents,

      sameTeam,

      opponents,

      creditedRecipient,

      targetName
    });
  }


  // ----------------------------------------------------------
  // SIMULTANEOUS EVENT ISOLATION
  //
  // If multiple matched ground-soul events for the same team
  // terminate on the same tick, the exact currency deltas cannot
  // be confidently assigned to one individual source reward.
  // ----------------------------------------------------------

  const eventCountByEndTeam =
    new Map();


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    eventCountByEndTeam.set(

      key,

      (
        eventCountByEndTeam.get(
          key
        )
        ??
        0
      )
      +
      1
    );
  }


  const cleanCases =
    [];


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    const isolated =
      eventCountByEndTeam.get(
        key
      ) ===
      1;


    const endedNormally =
      row.activation.endReason ===
      'BECAME_INACTIVE';


    const clean =
      isolated

      &&

      endedNormally

      &&

      row.sameTeam.length >
      0

      &&

      row.opponents.length ===
      0

      &&

      Boolean(
        row.creditedRecipient
      );


    if (
      !clean
    ) {

      continue;
    }


    const teamTotal =
      row.sameTeam.reduce(
        (
          sum,
          recipient
        ) =>
          sum +
          recipient.delta,
        0
      );


    cleanCases.push({

      ...row,

      teamTotal,

      recipientCount:
        row.sameTeam.length,

      recipientNames:
        row.sameTeam
          .map(
            recipient =>
              recipient.playerName
          )
          .sort()
    });
  }


  let creditedIncluded =
    0;


  let targetDifferentFromCredited =
    0;


  let targetEconomicallyAbsent =
    0;


  for (
    const row
    of cleanCases
  ) {

    if (
      row.creditedRecipient
    ) {

      creditedIncluded++;
    }


    if (
      row.targetName
      &&
      row.targetName !==
        row.creditedPlayerName
    ) {

      targetDifferentFromCredited++;


      if (
        !row.recipientNames.includes(
          row.targetName
        )
      ) {

        targetEconomicallyAbsent++;
      }
    }
  }


  return {

    withUniqueCredited,

    withEndTick,

    cleanCases,

    creditedIncluded,

    targetDifferentFromCredited,

    targetEconomicallyAbsent
  };
}


// ============================================================
// CURRENCY EVENT AGGREGATION
// ============================================================

function aggregateCurrencyEvents(
  events
) {

  const byPlayer =
    new Map();


  for (
    const event
    of events
  ) {

    const playerName =
      event.playerName
      ??
      null;


    const delta =
      finite(
        event.delta
      );


    if (
      !playerName
      ||
      delta ===
        null
      ||
      delta <=
        0
    ) {

      continue;
    }


    if (
      !byPlayer.has(
        playerName
      )
    ) {

      byPlayer.set(

        playerName,

        {

          playerName,

          team:
            finite(
              event.team
            ),

          delta:
            0,

          eventCount:
            0
        }
      );
    }


    const row =
      byPlayer.get(
        playerName
      );


    row.delta +=
      delta;


    row.eventCount++;
  }


  return [
    ...byPlayer.values()
  ];
}


// ============================================================
// RECIPIENT GEOMETRY
// ============================================================

function analyzeRecipientGeometry(
  cleanCases
) {

  const geometryCases =
    [];


  for (
    const row
    of cleanCases
  ) {

    const deathPosition =
      row.death.position;


    const players =
      Array.isArray(
        row
          ?.death
          ?.playersAtDeath
      )
        ? row.death.playersAtDeath
        : [];


    if (
      !deathPosition
      ||
      players.length ===
        0
    ) {

      continue;
    }


    const eligiblePlayers =
      players.filter(
        player =>
          player.team ===
            row.creditedTeam
        &&
          player.playerName
        &&
          player.position
      );


    if (
      eligiblePlayers.length ===
        0
    ) {

      continue;
    }


    const observedSet =
      new Set(
        row.recipientNames
      );


    const availableNames =
      new Set(
        eligiblePlayers.map(
          player =>
            player.playerName
        )
      );


    const allObservedPresent =
      row.recipientNames.every(
        name =>
          availableNames.has(
            name
          )
      );


    if (
      !allObservedPresent
    ) {

      continue;
    }


    geometryCases.push({

      caseId:
        `${row.death.deathIndex}|${row.activation.activationId}`,

      observedRecipients:
        [
          ...observedSet
        ],

      players:
        eligiblePlayers.map(
          player => ({

            playerName:
              player.playerName,

            actual:
              observedSet.has(
                player.playerName
              ),

            distanceXY:
              distanceXY(
                player.position,
                deathPosition
              ),

            distance3D:
              distance3D(
                player.position,
                deathPosition
              )
          })
        )
    });
  }


  const xy =
    evaluateGeometryThresholds({

      cases:
        geometryCases,

      distanceField:
        'distanceXY',

      minimum:
        RECIPIENT_THRESHOLD_MIN_HU,

      maximum:
        RECIPIENT_THRESHOLD_MAX_HU,

      step:
        RECIPIENT_THRESHOLD_STEP_HU,

      frozen:
        FROZEN_RECIPIENT_RADIUS_HU,

      frozenName:
        'frozen2150'
    });


  const threeD =
    evaluateGeometryThresholds({

      cases:
        geometryCases,

      distanceField:
        'distance3D',

      minimum:
        RECIPIENT_THRESHOLD_MIN_HU,

      maximum:
        RECIPIENT_THRESHOLD_MAX_HU,

      step:
        RECIPIENT_THRESHOLD_STEP_HU,

      frozen:
        FROZEN_RECIPIENT_RADIUS_HU,

      frozenName:
        'frozen2150'
    });


  return {

    cleanEconomicCases:
      cleanCases.length,

    geometryComparableCases:
      geometryCases.length,

    xy,

    threeD
  };
}


// ============================================================
// REWARD ALLOCATION
// ============================================================

function analyzeRewardAllocation(
  cleanCases
) {

  let integerExact =
    0;


  let remainderCases =
    0;


  let creditedGetsCeil =
    0;


  const recipientCounts =
    new Map();


  for (
    const row
    of cleanCases
  ) {

    const n =
      row.recipientCount;


    recipientCounts.set(

      n,

      (
        recipientCounts.get(
          n
        )
        ??
        0
      )
      +
      1
    );


    const actual =
      row.sameTeam
        .map(
          recipient =>
            recipient.delta
        )
        .sort(
          (
            a,
            b
          ) =>
            a -
            b
        );


    const partition =
      buildIntegerPartition(
        row.teamTotal,
        n
      );


    if (
      arraysEqual(
        actual,
        partition.amounts
      )
    ) {

      integerExact++;
    }


    if (
      partition.remainder >
      0
    ) {

      remainderCases++;


      if (
        row.creditedRecipient.delta ===
        partition.ceilShare
      ) {

        creditedGetsCeil++;
      }
    }
  }


  return {

    cleanCases:
      cleanCases.length,

    recipientCounts:
      Object.fromEntries(
        [
          ...recipientCounts.entries()
        ]
          .sort(
            (
              a,
              b
            ) =>
              a[0] -
              b[0]
          )
      ),

    integerPartition: {

      exact:
        integerExact,

      exactRate:
        rate(
          integerExact,
          cleanCases.length
        )
    },

    remainderPriority: {

      comparable:
        remainderCases,

      creditedGetsCeil,

      creditedGetsCeilRate:
        rate(
          creditedGetsCeil,
          remainderCases
        )
    }
  };
}


// ============================================================
// REWARD SCALING
// ============================================================

function analyzeRewardScaling(
  cleanCases
) {

  const eligible =
    [];


  for (
    const row
    of cleanCases
  ) {

    const minute =
      Number(
        row.death.timeSeconds
      )
      /
      60;


    if (
      !Number.isFinite(
        minute
      )
      ||
      minute <
        0
      ||
      minute >=
        35
    ) {

      continue;
    }


    const shareMultiplier =
      SHARE_TOTAL_MULTIPLIER.get(
        row.recipientCount
      );


    if (
      !Number.isFinite(
        shareMultiplier
      )
    ) {

      continue;
    }


    const teamState =
      classifyTeamNetWorthState(
        row.death.playersAtDeath,
        row.creditedTeam
      );


    if (
      teamState !==
      'LEADING'
    ) {

      continue;
    }


    const expectedBase =
      50 +
      minute;


    const observedTotalMultiplier =
      row.teamTotal /
      expectedBase;


    const impliedUnshared =
      row.teamTotal /
      shareMultiplier;


    eligible.push({

      minute,

      recipientCount:
        row.recipientCount,

      teamTotal:
        row.teamTotal,

      expectedBase,

      shareMultiplier,

      observedTotalMultiplier,

      impliedUnshared
    });
  }


  const regression =
    linearRegression(
      eligible.map(
        row =>
          [
            row.minute,
            row.impliedUnshared
          ]
      )
    );


  const byRecipientCount =
    [];


  for (
    const n
    of [
      1,
      2,
      3,
      4,
      5,
      6
    ]
  ) {

    const rows =
      eligible.filter(
        row =>
          row.recipientCount ===
          n
      );


    if (
      rows.length ===
        0
    ) {

      continue;
    }


    const expected =
      SHARE_TOTAL_MULTIPLIER.get(
        n
      );


    const observed =
      rows.map(
        row =>
          row.observedTotalMultiplier
      );


    byRecipientCount.push({

      recipientCount:
        n,

      count:
        rows.length,

      expectedTotalMultiplier:
        expected,

      observedTotalMultiplier:
        summarizeNumbers(
          observed
        ),

      medianDifference:
        Number.isFinite(
          median(
            observed
          )
        )
          ? median(
              observed
            )
            -
            expected
          : null
    });
  }


  return {

    methodology:
      'Leading-team, match-minute <35 clean economic cases only.',

    leadingPre35Cases:
      eligible.length,

    leadingPre35Regression:
      regression,

    expectedUnsharedGroundCurve:
      '50 + 1 * matchMinute',

    byRecipientCount
  };
}


// ============================================================
// AIM ORIENTATION
// ============================================================

function analyzeAimOrientation(
  citemxpEvents,
  playerState
) {

  const cases =
    [];


  for (
    const event
    of citemxpEvents
  ) {

    const direction =
      normalizeUnitVector(
        event.damageDirection
      );


    if (
      !direction
    ) {

      continue;
    }


    let shooterName =
      event
        ?.attackerPlayer
        ?.playerName
      ??
      null;


    if (
      !shooterName
      &&
      Number.isFinite(
        Number(
          event.attackerIndex
        )
      )
    ) {

      shooterName =
        playerState
          .pawnIndexToPlayer
          .get(
            Number(
              event.attackerIndex
            )
          )
        ??
        null;
    }


    if (
      !shooterName
    ) {

      continue;
    }


    const samples =
      playerState
        .byPlayer
        .get(
          shooterName
        )
      ??
      [];


    if (
      samples.length ===
        0
    ) {

      continue;
    }


    const hitTick =
      finite(
        event.tick
      );


    if (
      hitTick ===
        null
    ) {

      continue;
    }


    cases.push({

      hitTick,

      shooterName,

      direction,

      samples
    });
  }


  const conventionSearch =
    evaluateAimConventionSearch(
      cases
    );


  const selected =
    conventionSearch
      ?.selected
    ??
    {

      directionSign:
        DISCOVERY_DAMAGE_DIRECTION_SIGN,

      pitchSign:
        DISCOVERY_EYE_PITCH_SIGN
    };


  const eyePrimary =
    [];


  const eyePlacebo =
    [];


  const cameraPrimary =
    [];


  const bodyPrimary =
    [];


  let primaryWins =
    0;


  let eyeBeatsCamera =
    0;


  let cameraBeatsEye =
    0;


  for (
    const row
    of cases
  ) {

    const primary =
      findBestAimError({

        row,

        field:
          'eyeAngles',

        directionSign:
          selected.directionSign,

        pitchSign:
          selected.pitchSign,

        minLag:
          AIM_PRIMARY_MIN_LAG_TICKS,

        maxLag:
          AIM_PRIMARY_MAX_LAG_TICKS
      });


    const placebo =
      findBestAimError({

        row,

        field:
          'eyeAngles',

        directionSign:
          selected.directionSign,

        pitchSign:
          selected.pitchSign,

        minLag:
          AIM_PLACEBO_MIN_LAG_TICKS,

        maxLag:
          AIM_PLACEBO_MAX_LAG_TICKS
      });


    const camera =
      findBestAimError({

        row,

        field:
          'cameraAngles',

        directionSign:
          selected.directionSign,

        pitchSign:
          selected.pitchSign,

        minLag:
          AIM_PRIMARY_MIN_LAG_TICKS,

        maxLag:
          AIM_PRIMARY_MAX_LAG_TICKS
      });


    const body =
      findBestYawError({

        row,

        field:
          'bodyRotation',

        directionSign:
          selected.directionSign,

        minLag:
          AIM_PRIMARY_MIN_LAG_TICKS,

        maxLag:
          AIM_PRIMARY_MAX_LAG_TICKS
      });


    if (
      Number.isFinite(
        primary
      )
    ) {

      eyePrimary.push(
        primary
      );
    }


    if (
      Number.isFinite(
        placebo
      )
    ) {

      eyePlacebo.push(
        placebo
      );
    }


    if (
      Number.isFinite(
        camera
      )
    ) {

      cameraPrimary.push(
        camera
      );
    }


    if (
      Number.isFinite(
        body
      )
    ) {

      bodyPrimary.push(
        body
      );
    }


    if (
      Number.isFinite(
        primary
      )
      &&
      Number.isFinite(
        placebo
      )
      &&
      primary <
        placebo
    ) {

      primaryWins++;
    }


    if (
      Number.isFinite(
        primary
      )
      &&
      Number.isFinite(
        camera
      )
    ) {

      if (
        primary <
        camera
      ) {

        eyeBeatsCamera++;

      } else if (
        camera <
        primary
      ) {

        cameraBeatsEye++;
      }
    }
  }


  const summary = {

    rawDamageEvents:
      citemxpEvents.length,

    comparableAimCases:
      cases.length,

    conventionSearch:
      conventionSearch.candidates,

    selectedConvention:
      conventionSearch.selected,

    discoveryConventionRecovered:
      conventionSearch
        ?.selected
        ?.directionSign ===
        DISCOVERY_DAMAGE_DIRECTION_SIGN
      &&
      conventionSearch
        ?.selected
        ?.pitchSign ===
        DISCOVERY_EYE_PITCH_SIGN,


    eye: {

      primaryError:
        summarizeNumbers(
          eyePrimary
        ),

      placeboError:
        summarizeNumbers(
          eyePlacebo
        ),

      primaryBeatsPlacebo:
        primaryWins,

      primaryBeatsPlaceboRate:
        rate(
          primaryWins,
          Math.min(
            eyePrimary.length,
            eyePlacebo.length
          )
        ),

      primaryWithin10Rate:
        rate(
          eyePrimary.filter(
            value =>
              value <=
              10
          ).length,
          eyePrimary.length
        ),

      primaryWithin15Rate:
        rate(
          eyePrimary.filter(
            value =>
              value <=
              15
          ).length,
          eyePrimary.length
        )
    },


    camera: {

      primaryError:
        summarizeNumbers(
          cameraPrimary
        )
    },


    bodyYaw: {

      primaryError:
        summarizeNumbers(
          bodyPrimary
        ),

      note:
        'Body is yaw-only and should not be directly ranked against full 3D eye error.'
    },


    eyeVsCamera: {

      eyeBeatsCamera,

      cameraBeatsEye,

      eyeWinRate:
        rate(
          eyeBeatsCamera,
          eyeBeatsCamera +
          cameraBeatsEye
        )
    }
  };


  return {

    summary,

    internalCases:
      cases
  };
}


// ============================================================
// AIM CONVENTION SEARCH
// ============================================================

function evaluateAimConventionSearch(
  cases
) {

  const candidates =
    [];


  for (
    const directionSign
    of [
      1,
      -1
    ]
  ) {

    for (
      const pitchSign
      of [
        1,
        -1
      ]
    ) {

      const errors =
        [];


      for (
        const row
        of cases
      ) {

        const error =
          findBestAimError({

            row,

            field:
              'eyeAngles',

            directionSign,

            pitchSign,

            minLag:
              AIM_PRIMARY_MIN_LAG_TICKS,

            maxLag:
              AIM_PRIMARY_MAX_LAG_TICKS
          });


        if (
          Number.isFinite(
            error
          )
        ) {

          errors.push(
            error
          );
        }
      }


      candidates.push({

        directionSign,

        pitchSign,

        count:
          errors.length,

        error:
          summarizeNumbers(
            errors
          ),

        within10Rate:
          rate(
            errors.filter(
              value =>
                value <=
                10
            ).length,
            errors.length
          )
      });
    }
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      compareNullableNumbers(
        a.error.median,
        b.error.median
      )
      ||
      compareNullableNumbers(
        a.error.p75,
        b.error.p75
      )
      ||
      (
        b.within10Rate ??
        -Infinity
      )
      -
      (
        a.within10Rate ??
        -Infinity
      )
  );


  return {

    candidates,

    selected:
      candidates[0]
      ? {

        directionSign:
          candidates[0].directionSign,

        pitchSign:
          candidates[0].pitchSign,

        count:
          candidates[0].count,

        medianError:
          candidates[0]
            .error
            .median
      }
      : null
  };
}


// ============================================================
// AIM ERROR
// ============================================================

function findBestAimError({

  row,

  field,

  directionSign,

  pitchSign,

  minLag,

  maxLag
}) {

  const target =
    normalizeUnitVector(
      scaleVector(
        row.direction,
        directionSign
      )
    );


  if (
    !target
  ) {

    return null;
  }


  let best =
    Infinity;


  const lowerTick =
    row.hitTick -
    maxLag;


  const upperTick =
    row.hitTick -
    minLag;


  const startIndex =
    lowerBoundSamples(
      row.samples,
      lowerTick
    );


  for (
    let i =
      startIndex;

    i <
      row.samples.length;

    i++
  ) {

    const sample =
      row.samples[
        i
      ];


    if (
      sample.tick >
      upperTick
    ) {

      break;
    }


    const angles =
      sample[
        field
      ];


    if (
      !angles
    ) {

      continue;
    }


    const yaw =
      finite(
        angles[
          YAW_COMPONENT
        ]
      );


    const pitch =
      finite(
        angles[
          PITCH_COMPONENT
        ]
      );


    if (
      yaw ===
        null
      ||
      pitch ===
        null
    ) {

      continue;
    }


    const forward =
      anglesToForwardVector(
        yaw,
        pitch,
        pitchSign
      );


    const error =
      vectorAngleDegrees(
        forward,
        target
      );


    if (
      Number.isFinite(
        error
      )
    ) {

      best =
        Math.min(
          best,
          error
        );
    }
  }


  return Number.isFinite(
    best
  )
    ? best
    : null;
}


// ============================================================
// BODY YAW ERROR
// ============================================================

function findBestYawError({

  row,

  field,

  directionSign,

  minLag,

  maxLag
}) {

  const target =
    scaleVector(
      row.direction,
      directionSign
    );


  const targetYaw =
    normalizeDegrees(
      radiansToDegrees(
        Math.atan2(
          target.y,
          target.x
        )
      )
    );


  let best =
    Infinity;


  const lowerTick =
    row.hitTick -
    maxLag;


  const upperTick =
    row.hitTick -
    minLag;


  const startIndex =
    lowerBoundSamples(
      row.samples,
      lowerTick
    );


  for (
    let i =
      startIndex;

    i <
      row.samples.length;

    i++
  ) {

    const sample =
      row.samples[
        i
      ];


    if (
      sample.tick >
      upperTick
    ) {

      break;
    }


    const angles =
      sample[
        field
      ];


    if (
      !angles
    ) {

      continue;
    }


    const yaw =
      finite(
        angles[
          YAW_COMPONENT
        ]
      );


    if (
      yaw ===
        null
    ) {

      continue;
    }


    best =
      Math.min(

        best,

        circularDifference(
          yaw,
          targetYaw
        )
      );
  }


  return Number.isFinite(
    best
  )
    ? best
    : null;
}


// ============================================================
// PLAYER STATE INDEX
// ============================================================

async function buildPlayerStateIndex(
  path
) {

  const byPlayer =
    new Map();


  const playerTeam =
    new Map();


  const pawnIndexToPlayer =
    new Map();


  let totalSamples =
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


    const playerName =
      row
        ?.controller
        ?.playerName
      ??
      null;


    const team =
      finite(
        row
          ?.controller
          ?.team
      );


    const tick =
      finite(
        row.demoTick
      );


    if (
      !playerName
      ||
      tick ===
        null
    ) {

      continue;
    }


    if (
      !byPlayer.has(
        playerName
      )
    ) {

      byPlayer.set(
        playerName,
        []
      );
    }


    playerTeam.set(
      playerName,
      team
    );


    const pawnIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );


    if (
      pawnIndex !==
        null
    ) {

      pawnIndexToPlayer.set(
        pawnIndex,
        playerName
      );
    }


    byPlayer
      .get(
        playerName
      )
      .push({

        tick,

        team,

        position:
          normalizePosition(
            row
              ?.pawn
              ?.positionWorld
          ),

        positionValidForMovement:
          row
            ?.pawn
            ?.positionValidForMovement ===
          true,

        bodyRotation:
          normalizeAngleTriple(
            row
              ?.pawn
              ?.bodyRotation
          ),

        eyeAngles:
          normalizeAngleTriple(
            row
              ?.pawn
              ?.eyeAngles
          ),

        cameraAngles:
          normalizeAngleTriple(
            row
              ?.pawn
              ?.cameraAngles
          )
      });


    totalSamples++;
  }


  return {

    byPlayer,

    playerTeam,

    pawnIndexToPlayer,

    totalSamples
  };
}


// ============================================================
// NEAREST SAMPLE
// ============================================================

function findNearestSample(
  samples,
  tick,
  maximumDifference
) {

  if (
    samples.length ===
    0
  ) {

    return null;
  }


  const index =
    lowerBoundSamples(
      samples,
      tick
    );


  const candidates =
    [];


  if (
    index <
    samples.length
  ) {

    candidates.push(
      samples[
        index
      ]
    );
  }


  if (
    index >
    0
  ) {

    candidates.push(
      samples[
        index -
        1
      ]
    );
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      Math.abs(
        a.tick -
        tick
      )
      -
      Math.abs(
        b.tick -
        tick
      )
  );


  const best =
    candidates[0]
    ??
    null;


  if (
    !best
    ||
    Math.abs(
      best.tick -
      tick
    )
    >
    maximumDifference
  ) {

    return null;
  }


  return best;
}


// ============================================================
// MINIMUM DISTANCE IN RANGE
// ============================================================

function findMinimumDistanceInRange(
  samples,
  startTick,
  endTick,
  point
) {

  let bestXY =
    Infinity;


  let best3D =
    Infinity;


  const index =
    lowerBoundSamples(
      samples,
      startTick
    );


  for (
    let i =
      index;

    i <
      samples.length;

    i++
  ) {

    const sample =
      samples[
        i
      ];


    if (
      sample.tick >
      endTick
    ) {

      break;
    }


    if (
      !sample.position
      ||
      !sample.positionValidForMovement
    ) {

      continue;
    }


    bestXY =
      Math.min(

        bestXY,

        distanceXY(
          sample.position,
          point
        )
      );


    best3D =
      Math.min(

        best3D,

        distance3D(
          sample.position,
          point
        )
      );
  }


  return {

    xy:
      bestXY,

    threeD:
      best3D
  };
}


// ============================================================
// BINARY SEARCH
// ============================================================

function lowerBoundSamples(
  samples,
  tick
) {

  let low =
    0;


  let high =
    samples.length;


  while (
    low <
    high
  ) {

    const mid =
      Math.floor(
        (
          low +
          high
        )
        /
        2
      );


    if (
      samples[
        mid
      ].tick <
      tick
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


// ============================================================
// THRESHOLD FAMILY - SIMPLE BINARY OBSERVATIONS
// ============================================================

function evaluateThresholdFamily({

  observations,

  minimum,

  maximum,

  step,

  frozen,

  frozenName
}) {

  const thresholds =
    [];


  for (
    let threshold =
      minimum;

    threshold <=
      maximum;

    threshold +=
      step
  ) {

    thresholds.push(
      evaluateBinaryThreshold(
        observations,
        threshold
      )
    );
  }


  thresholds.sort(
    (
      a,
      b
    ) =>
      compareMetricDescending(
        a.mcc,
        b.mcc
      )
      ||
      compareMetricDescending(
        a.specificity,
        b.specificity
      )
      ||
      compareMetricDescending(
        a.sensitivity,
        b.sensitivity
      )
      ||
      a.thresholdHU -
      b.thresholdHU
  );


  return {

    observations:
      observations.length,

    positive:
      observations.filter(
        row =>
          row.positive
      ).length,

    negative:
      observations.filter(
        row =>
          !row.positive
      ).length,

    bestThreshold:
      thresholds[0]
      ??
      null,

    [
      frozenName
    ]:
      evaluateBinaryThreshold(
        observations,
        frozen
      )
  };
}


// ============================================================
// BINARY THRESHOLD
// ============================================================

function evaluateBinaryThreshold(
  observations,
  threshold
) {

  let tp =
    0;


  let tn =
    0;


  let fp =
    0;


  let fn =
    0;


  for (
    const row
    of observations
  ) {

    const predicted =
      row.distance <=
      threshold;


    if (
      row.positive
      &&
      predicted
    ) {

      tp++;

    } else if (
      row.positive
      &&
      !predicted
    ) {

      fn++;

    } else if (
      !row.positive
      &&
      predicted
    ) {

      fp++;

    } else {

      tn++;
    }
  }


  return {

    thresholdHU:
      threshold,

    tp,

    tn,

    fp,

    fn,

    sensitivity:
      safeDivide(
        tp,
        tp +
        fn
      ),

    specificity:
      safeDivide(
        tn,
        tn +
        fp
      ),

    accuracy:
      safeDivide(
        tp +
        tn,
        tp +
        tn +
        fp +
        fn
      ),

    mcc:
      matthewsCorrelation(
        tp,
        tn,
        fp,
        fn
      )
  };
}


// ============================================================
// GEOMETRY THRESHOLD FAMILY WITH EXACT-SET ACCURACY
// ============================================================

function evaluateGeometryThresholds({

  cases,

  distanceField,

  minimum,

  maximum,

  step,

  frozen,

  frozenName
}) {

  const rows =
    [];


  for (
    let threshold =
      minimum;

    threshold <=
      maximum;

    threshold +=
      step
  ) {

    rows.push(
      evaluateGeometryThreshold(
        cases,
        distanceField,
        threshold
      )
    );
  }


  rows.sort(
    (
      a,
      b
    ) =>
      compareMetricDescending(
        a.mcc,
        b.mcc
      )
      ||
      compareMetricDescending(
        a.exactSetRate,
        b.exactSetRate
      )
      ||
      a.thresholdHU -
      b.thresholdHU
  );


  return {

    comparableCases:
      cases.length,

    bestThreshold:
      rows[0]
      ??
      null,

    [
      frozenName
    ]:
      evaluateGeometryThreshold(
        cases,
        distanceField,
        frozen
      )
  };
}


// ============================================================
// GEOMETRY THRESHOLD
// ============================================================

function evaluateGeometryThreshold(
  cases,
  distanceField,
  threshold
) {

  let tp =
    0;


  let tn =
    0;


  let fp =
    0;


  let fn =
    0;


  let exactSets =
    0;


  for (
    const caseRow
    of cases
  ) {

    const predictedSet =
      [];


    const actualSet =
      caseRow.observedRecipients
        .slice()
        .sort();


    for (
      const player
      of caseRow.players
    ) {

      const predicted =
        player[
          distanceField
        ] <=
        threshold;


      if (
        predicted
      ) {

        predictedSet.push(
          player.playerName
        );
      }


      if (
        player.actual
        &&
        predicted
      ) {

        tp++;

      } else if (
        player.actual
        &&
        !predicted
      ) {

        fn++;

      } else if (
        !player.actual
        &&
        predicted
      ) {

        fp++;

      } else {

        tn++;
      }
    }


    predictedSet.sort();


    if (
      arraysEqual(
        predictedSet,
        actualSet
      )
    ) {

      exactSets++;
    }
  }


  return {

    thresholdHU:
      threshold,

    tp,

    tn,

    fp,

    fn,

    sensitivity:
      safeDivide(
        tp,
        tp +
        fn
      ),

    specificity:
      safeDivide(
        tn,
        tn +
        fp
      ),

    mcc:
      matthewsCorrelation(
        tp,
        tn,
        fp,
        fn
      ),

    exactSets,

    exactSetRate:
      safeDivide(
        exactSets,
        cases.length
      )
  };
}


// ============================================================
// TEAM NET WORTH STATE
// ============================================================

function classifyTeamNetWorthState(
  players,
  creditedTeam
) {

  if (
    !Array.isArray(
      players
    )
  ) {

    return 'UNKNOWN';
  }


  const sums =
    new Map();


  for (
    const player
    of players
  ) {

    const team =
      finite(
        player.team
      );


    const netWorth =
      finite(
        player.netWorth
      );


    if (
      team ===
        null
      ||
      netWorth ===
        null
    ) {

      continue;
    }


    sums.set(

      team,

      (
        sums.get(
          team
        )
        ??
        0
      )
      +
      netWorth
    );
  }


  if (
    !sums.has(
      creditedTeam
    )
  ) {

    return 'UNKNOWN';
  }


  const credited =
    sums.get(
      creditedTeam
    );


  const otherValues =
    [
      ...sums.entries()
    ]
      .filter(
        (
          [
            team
          ]
        ) =>
          team !==
          creditedTeam
      )
      .map(
        (
          [
            team,
            value
          ]
        ) =>
          value
      );


  if (
    otherValues.length ===
    0
  ) {

    return 'UNKNOWN';
  }


  const opponent =
    Math.max(
      ...otherValues
    );


  if (
    credited >
    opponent
  ) {

    return 'LEADING';
  }


  if (
    credited <
    opponent
  ) {

    return 'TRAILING';
  }


  return 'TIED';
}


// ============================================================
// REPLAY SUPPORT RULES
//
// These are replication-screening thresholds.
//
// They are deliberately broad enough to tolerate measurement
// resolution and replay composition while still requiring the
// discovery relationship to be clearly present.
// ============================================================

function evaluateProductionSupport(
  row
) {

  const informative =
    row
      .economicDeathsWithUniqueExactOpposingLastHit >=
    50;


  const supported =
    informative

    &&

    (
      row
        .creditedDeathsWithAnyActivationCandidateRate ??
      0
    ) >=
    0.90

    &&

    (
      row
        .strictMatchesWithUniqueExactOpposingLastHitRate ??
      0
    ) >=
    0.90;


  return {

    informative,

    supported
  };
}


function evaluateLifecycleSupport(
  row
) {

  const informative =
    row.targeted >=
    50;


  const targetEndMedian =
    row
      ?.targetToInactiveSeconds
      ?.median;


  const targetedRelation =
    Number.isFinite(
      targetEndMedian
    )
    &&
    targetEndMedian >=
      0.35
    &&
    targetEndMedian <=
      0.95;


  const timeoutComparable =
    row
      ?.targetlessTimeout
      ?.comparable ??
    0;


  const timeoutSupport =
    timeoutComparable <
      5
      ? null
      : (
          row
            ?.targetlessTimeout
            ?.within2Rate ??
          0
        ) >=
        0.70;


  const supported =
    informative
    &&
    targetedRelation
    &&
    (
      timeoutSupport ===
        null
      ||
      timeoutSupport ===
        true
    );


  return {

    informative,

    supported,

    targetedRelation,

    timeoutSupport
  };
}


function evaluateVacuumSupport(
  row
) {

  const informative =
    row.targetedComparable >=
      30
    &&
    row.targetlessComparable >=
      5;


  const frozen =
    row
      ?.xy
      ?.frozen735;


  const best =
    row
      ?.xy
      ?.bestThreshold;


  const supported =
    informative

    &&

    (
      frozen?.mcc ??
      -1
    ) >=
    0.70

    &&

    (
      frozen?.sensitivity ??
      0
    ) >=
    0.80

    &&

    (
      frozen?.specificity ??
      0
    ) >=
    0.70

    &&

    Number.isFinite(
      best?.thresholdHU
    )

    &&

    Math.abs(
      best.thresholdHU -
      FROZEN_PHYSICAL_VACUUM_HU
    ) <=
    125;


  return {

    informative,

    supported
  };
}


function evaluateEconomicRecipientSupport(
  economic
) {

  const clean =
    economic.cleanCases.length;


  const creditedRate =
    rate(
      economic.creditedIncluded,
      clean
    );


  const informative =
    clean >=
    20;


  const supported =
    informative
    &&
    (
      creditedRate ??
      0
    ) >=
    0.95;


  return {

    informative,

    supported
  };
}


function evaluateRecipientGeometrySupport(
  row
) {

  const frozen =
    row
      ?.threeD
      ?.frozen2150;


  const best =
    row
      ?.threeD
      ?.bestThreshold;


  const informative =
    row.geometryComparableCases >=
    20;


  const supported =
    informative

    &&

    (
      frozen?.mcc ??
      -1
    ) >=
    0.85

    &&

    (
      frozen?.exactSetRate ??
      0
    ) >=
    0.80

    &&

    Number.isFinite(
      best?.thresholdHU
    )

    &&

    Math.abs(
      best.thresholdHU -
      FROZEN_RECIPIENT_RADIUS_HU
    ) <=
    150;


  return {

    informative,

    supported
  };
}


function evaluateRewardSupport(
  allocation,
  scaling
) {

  const allocationInformative =
    allocation.cleanCases >=
    20;


  const partitionStrong =
    (
      allocation
        ?.integerPartition
        ?.exactRate ??
      0
    ) >=
    0.90;


  const remainderComparable =
    allocation
      ?.remainderPriority
      ?.comparable ??
    0;


  const remainderStrong =
    remainderComparable <
      10
      ? true
      : (
          allocation
            ?.remainderPriority
            ?.creditedGetsCeilRate ??
          0
        ) >=
        0.85;


  const regression =
    scaling
      ?.leadingPre35Regression;


  const scalingInformative =
    (
      scaling
        ?.leadingPre35Cases ??
      0
    ) >=
    10
    &&
    regression
    &&
    Number.isFinite(
      regression.slope
    )
    &&
    Number.isFinite(
      regression.intercept
    );


  const scalingStrong =
    !scalingInformative
      ? null
      : regression.slope >=
          0.75
        &&
        regression.slope <=
          1.25
        &&
        regression.intercept >=
          43
        &&
        regression.intercept <=
          57;


  const informative =
    allocationInformative;


  const supported =
    informative
    &&
    partitionStrong
    &&
    remainderStrong
    &&
    (
      scalingStrong ===
        null
      ||
      scalingStrong ===
        true
    );


  return {

    informative,

    supported,

    partitionStrong,

    remainderStrong,

    scalingInformative,

    scalingStrong
  };
}


function evaluateAimSupport(
  aim
) {

  const n =
    aim.comparableAimCases;


  const informative =
    n >=
    8;


  const primary =
    aim
      ?.eye
      ?.primaryError
      ?.median;


  const placebo =
    aim
      ?.eye
      ?.placeboError
      ?.median;


  const temporalGain =
    Number.isFinite(
      primary
    )
    &&
    Number.isFinite(
      placebo
    )
      ? placebo -
        primary
      : null;


  const supported =
    informative

    &&

    aim.discoveryConventionRecovered ===
      true

    &&

    Number.isFinite(
      primary
    )

    &&

    primary <=
      15

    &&

    Number.isFinite(
      temporalGain
    )

    &&

    temporalGain >=
      8

    &&

    (
      aim
        ?.eye
        ?.primaryBeatsPlaceboRate ??
      0
    ) >=
    0.70;


  return {

    informative,

    supported,

    temporalGainDegrees:
      temporalGain
  };
}


// ============================================================
// CROSS-REPLAY CLAIMS
// ============================================================

function buildCrossReplayClaims(
  summaries
) {

  const definitions = {

    GROUND_SOUL_PRODUCTION_LAST_HIT_LINK:
      'productionLastHit',

    GROUND_SOUL_LIFECYCLE:
      'lifecycle',

    VACUUM_PROXIMITY:
      'vacuumProximity',

    ECONOMIC_RECIPIENT_SET:
      'economicRecipientSet',

    RECIPIENT_GEOMETRY:
      'recipientGeometry',

    REWARD_ALLOCATION:
      'rewardAllocation',

    AIM_ORIENTATION:
      'aimOrientation'
  };


  const output =
    {};


  for (
    const [
      claimId,
      supportKey
    ]
    of Object.entries(
      definitions
    )
  ) {

    const rows =
      summaries
        .map(
          row => ({

            replay:
              row.replay,

            informative:
              row
                ?.support[
                  supportKey
                ]
                ?.informative ===
              true,

            supported:
              row
                ?.support[
                  supportKey
                ]
                ?.supported ===
              true
          })
        );


    const informative =
      rows.filter(
        row =>
          row.informative
      );


    const supported =
      informative.filter(
        row =>
          row.supported
      );


    const supportRate =
      rate(
        supported.length,
        informative.length
      );


    let status;


    if (
      informative.length <
      3
    ) {

      status =
        'INSUFFICIENT_REPLAY_COVERAGE';

    } else if (
      supported.length >=
        4
      &&
      (
        supportRate ??
        0
      ) >=
      0.80
    ) {

      status =
        'STRONGLY_REPLICATED';

    } else if (
      supported.length >=
        3
      &&
      (
        supportRate ??
        0
      ) >=
      0.60
    ) {

      status =
        'SUPPORTED';

    } else {

      status =
        'MIXED_OR_NOT_REPLICATED';
    }


    output[
      claimId
    ] = {

      informativeReplays:
        informative.length,

      supportedReplays:
        supported.length,

      supportRate,

      status,

      replayResults:
        rows
    };
  }


  return output;
}


// ============================================================
// INTEGER PARTITION
// ============================================================

function buildIntegerPartition(
  total,
  count
) {

  const floorShare =
    Math.floor(
      total /
      count
    );


  const remainder =
    total %
    count;


  const ceilShare =
    remainder >
      0
      ? floorShare +
        1
      : floorShare;


  const amounts =
    [];


  for (
    let i =
      0;

    i <
      count;

    i++
  ) {

    amounts.push(
      i <
        remainder
        ? ceilShare
        : floorShare
    );
  }


  amounts.sort(
    (
      a,
      b
    ) =>
      a -
      b
  );


  return {

    floorShare,

    ceilShare,

    remainder,

    amounts
  };
}


// ============================================================
// LINEAR REGRESSION
// ============================================================

function linearRegression(
  pairs
) {

  const clean =
    pairs.filter(
      pair =>
        Array.isArray(
          pair
        )
        &&
        pair.length >=
          2
        &&
        Number.isFinite(
          pair[0]
        )
        &&
        Number.isFinite(
          pair[1]
        )
    );


  if (
    clean.length <
    2
  ) {

    return {

      count:
        clean.length,

      intercept:
        null,

      slope:
        null,

      r2:
        null,

      rmse:
        null
    };
  }


  const xs =
    clean.map(
      row =>
        row[0]
    );


  const ys =
    clean.map(
      row =>
        row[1]
    );


  const meanX =
    mean(
      xs
    );


  const meanY =
    mean(
      ys
    );


  let numerator =
    0;


  let denominator =
    0;


  for (
    let i =
      0;

    i <
      clean.length;

    i++
  ) {

    numerator +=
      (
        xs[i] -
        meanX
      )
      *
      (
        ys[i] -
        meanY
      );


    denominator +=
      (
        xs[i] -
        meanX
      )
      ** 2;
  }


  const slope =
    denominator >
      0
      ? numerator /
        denominator
      : 0;


  const intercept =
    meanY -
    slope *
    meanX;


  const residuals =
    [];


  let ssResidual =
    0;


  let ssTotal =
    0;


  for (
    let i =
      0;

    i <
      clean.length;

    i++
  ) {

    const predicted =
      intercept +
      slope *
      xs[i];


    const residual =
      ys[i] -
      predicted;


    residuals.push(
      residual
    );


    ssResidual +=
      residual ** 2;


    ssTotal +=
      (
        ys[i] -
        meanY
      )
      ** 2;
  }


  return {

    count:
      clean.length,

    intercept,

    slope,

    r2:
      ssTotal >
        0
        ? 1 -
          ssResidual /
          ssTotal
        : null,

    rmse:
      Math.sqrt(
        ssResidual /
        clean.length
      ),

    residual:
      summarizeNumbers(
        residuals
      )
  };
}


// ============================================================
// VECTOR / ANGLE
// ============================================================

function anglesToForwardVector(
  yawDegrees,
  pitchDegrees,
  pitchSign
) {

  const yaw =
    degreesToRadians(
      normalizeDegrees(
        yawDegrees
      )
    );


  const pitch =
    degreesToRadians(

      signedDegrees(
        pitchDegrees
      )
      *
      pitchSign
    );


  const cosPitch =
    Math.cos(
      pitch
    );


  return normalizeUnitVector({

    x:
      cosPitch *
      Math.cos(
        yaw
      ),

    y:
      cosPitch *
      Math.sin(
        yaw
      ),

    z:
      Math.sin(
        pitch
      )
  });
}


function normalizeUnitVector(
  vector
) {

  if (
    !vector
  ) {

    return null;
  }


  const x =
    finite(
      vector.x
    );


  const y =
    finite(
      vector.y
    );


  const z =
    finite(
      vector.z
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


  const magnitude =
    Math.sqrt(
      x ** 2 +
      y ** 2 +
      z ** 2
    );


  if (
    magnitude <=
    1e-9
  ) {

    return null;
  }


  return {

    x:
      x /
      magnitude,

    y:
      y /
      magnitude,

    z:
      z /
      magnitude
  };
}


function scaleVector(
  vector,
  scale
) {

  return {

    x:
      vector.x *
      scale,

    y:
      vector.y *
      scale,

    z:
      vector.z *
      scale
  };
}


function vectorAngleDegrees(
  a,
  b
) {

  const ua =
    normalizeUnitVector(
      a
    );


  const ub =
    normalizeUnitVector(
      b
    );


  if (
    !ua
    ||
    !ub
  ) {

    return null;
  }


  const dot =
    clamp(

      ua.x *
      ub.x

      +

      ua.y *
      ub.y

      +

      ua.z *
      ub.z,

      -1,

      1
    );


  return radiansToDegrees(
    Math.acos(
      dot
    )
  );
}


function circularDifference(
  a,
  b
) {

  let difference =
    Math.abs(
      normalizeDegrees(
        a
      )
      -
      normalizeDegrees(
        b
      )
    );


  if (
    difference >
    180
  ) {

    difference =
      360 -
      difference;
  }


  return difference;
}


function normalizeDegrees(
  value
) {

  const output =
    value %
    360;


  return output <
    0
      ? output +
        360
      : output;
}


function signedDegrees(
  value
) {

  let output =
    normalizeDegrees(
      value
    );


  if (
    output >
    180
  ) {

    output -=
      360;
  }


  return output;
}


function degreesToRadians(
  value
) {

  return value *
    Math.PI /
    180;
}


function radiansToDegrees(
  value
) {

  return value *
    180 /
    Math.PI;
}


// ============================================================
// POSITION / ANGLES NORMALIZATION
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
  ) {

    return null;
  }


  return {

    x,

    y,

    z
  };
}


function normalizeAngleTriple(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  let source;


  if (
    Array.isArray(
      value
    )
  ) {

    source = [

      value[0],
      value[1],
      value[2]
    ];

  } else if (
    typeof value ===
    'object'
  ) {

    source = [

      value['0']
      ??
      value.x,

      value['1']
      ??
      value.y,

      value['2']
      ??
      value.z
    ];

  } else {

    return null;
  }


  const output =
    source.map(
      finite
    );


  if (
    output.some(
      value =>
        value ===
        null
    )
  ) {

    return null;
  }


  return output;
}


// ============================================================
// DISTANCE
// ============================================================

function distanceXY(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return Infinity;
  }


  return Math.sqrt(

    (
      a.x -
      b.x
    )
    ** 2

    +

    (
      a.y -
      b.y
    )
    ** 2
  );
}


function distance3D(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return Infinity;
  }


  const dz =
    Number.isFinite(
      a.z
    )
    &&
    Number.isFinite(
      b.z
    )
      ? a.z -
        b.z
      : 0;


  return Math.sqrt(

    (
      a.x -
      b.x
    )
    ** 2

    +

    (
      a.y -
      b.y
    )
    ** 2

    +

    dz
    ** 2
  );
}


// ============================================================
// MCC
// ============================================================

function matthewsCorrelation(
  tp,
  tn,
  fp,
  fn
) {

  const denominator =
    Math.sqrt(

      (
        tp +
        fp
      )

      *

      (
        tp +
        fn
      )

      *

      (
        tn +
        fp
      )

      *

      (
        tn +
        fn
      )
    );


  if (
    denominator ===
    0
  ) {

    return null;
  }


  return (
    tp *
    tn
    -
    fp *
    fn
  )
  /
  denominator;
}


// ============================================================
// GENERAL HELPERS
// ============================================================

function groupBy(
  rows,
  selector
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      selector(
        row
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        []
      );
    }


    map
      .get(
        key
      )
      .push(
        row
      );
  }


  return map;
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


function arraysEqual(
  a,
  b
) {

  if (
    a.length !==
    b.length
  ) {

    return false;
  }


  for (
    let i =
      0;

    i <
      a.length;

    i++
  ) {

    if (
      a[i] !==
      b[i]
    ) {

      return false;
    }
  }


  return true;
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


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    clean.length ===
      0
  ) {

    return null;
  }


  return clean.reduce(
    (
      sum,
      value
    ) =>
      sum +
      value,
    0
  )
  /
  clean.length;
}


function median(
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

    return null;
  }


  return quantile(
    clean,
    0.5
  );
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


function safeDivide(
  numerator,
  denominator
) {

  return denominator >
    0
      ? numerator /
        denominator
      : null;
}


function clamp(
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


function compareNullableNumbers(
  a,
  b
) {

  const aa =
    Number.isFinite(
      a
    )
      ? a
      : Infinity;


  const bb =
    Number.isFinite(
      b
    )
      ? b
      : Infinity;


  return aa -
    bb;
}


function compareMetricDescending(
  a,
  b
) {

  const aa =
    Number.isFinite(
      a
    )
      ? a
      : -Infinity;


  const bb =
    Number.isFinite(
      b
    )
      ? b
      : -Infinity;


  return bb -
    aa;
}


// ============================================================
// DISTRIBUTIONS
// ============================================================

function summarizeNumbers(
  source
) {

  const clean =
    source
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

      p95:
        null,

      max:
        null,

      mean:
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
        0.50
      ),

    p75:
      quantile(
        clean,
        0.75
      ),

    p95:
      quantile(
        clean,
        0.95
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      mean(
        clean
      )
  };
}


function quantile(
  sorted,
  q
) {

  if (
    sorted.length ===
    0
  ) {

    return null;
  }


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
    )
    *
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


  return (
    sorted[
      lower
    ]
    *
    (
      1 -
      weight
    )

    +

    sorted[
      upper
    ]
    *
    weight
  );
}


// ============================================================
// CONSOLE
// ============================================================

function printReplaySummary(
  row
) {

  console.log('');

  console.log(
    'MATCHING'
  );


  console.log(
    `  Strict one-to-one:       ${row.matching.strictMutualOneToOneMatches}`
  );


  console.log(
    `  Ambiguous deaths:        ${row.matching.ambiguousDeaths}`
  );


  console.log('');

  console.log(
    'PRODUCTION / LAST HIT'
  );


  console.log(
    `  Unique credited deaths:  ${row.productionLastHit.economicDeathsWithUniqueExactOpposingLastHit}`
  );


  console.log(
    `  Any activation candidate:${formatPercent(
      row.productionLastHit.creditedDeathsWithAnyActivationCandidateRate
    )}`
  );


  console.log(
    `  Strict match:            ${formatPercent(
      row.productionLastHit.creditedDeathsWithStrictMatchRate
    )}`
  );


  console.log('');

  console.log(
    'LIFECYCLE'
  );


  console.log(
    `  Targeted:                ${row.lifecycle.targeted}`
  );


  console.log(
    `  Targetless:              ${row.lifecycle.targetless}`
  );


  console.log(
    `  Target->inactive median: ${formatNumber(
      row.lifecycle.targetToInactiveSeconds.median
    )} sec`
  );


  console.log(
    `  Timeout <=2 sec:         ${formatPercent(
      row.lifecycle.targetlessTimeout.within2Rate
    )}`
  );


  console.log('');

  console.log(
    'VACUUM GEOMETRY'
  );


  console.log(
    `  Comparable + / -:        ${row.vacuumGeometry.targetedComparable} / ${row.vacuumGeometry.targetlessComparable}`
  );


  console.log(
    `  Best XY threshold:       ${formatNumber(
      row.vacuumGeometry.xy.bestThreshold?.thresholdHU
    )} HU`
  );


  console.log(
    `  Frozen 735 XY MCC:       ${formatNumber(
      row.vacuumGeometry.xy.frozen735?.mcc
    )}`
  );


  console.log('');

  console.log(
    'ECONOMIC RECIPIENTS'
  );


  console.log(
    `  Clean cases:             ${row.economicRecipientSet.isolatedCleanCases}`
  );


  console.log(
    `  Credited included:       ${formatPercent(
      row.economicRecipientSet.creditedIncludedRate
    )}`
  );


  console.log('');

  console.log(
    'RECIPIENT GEOMETRY'
  );


  console.log(
    `  Comparable cases:        ${row.recipientGeometry.geometryComparableCases}`
  );


  console.log(
    `  Best 3D threshold:       ${formatNumber(
      row.recipientGeometry.threeD.bestThreshold?.thresholdHU
    )} HU`
  );


  console.log(
    `  Frozen 2150 MCC:         ${formatNumber(
      row.recipientGeometry.threeD.frozen2150?.mcc
    )}`
  );


  console.log(
    `  Frozen exact-set rate:   ${formatPercent(
      row.recipientGeometry.threeD.frozen2150?.exactSetRate
    )}`
  );


  console.log('');

  console.log(
    'REWARD ALLOCATION'
  );


  console.log(
    `  Integer partition exact: ${formatPercent(
      row.rewardAllocation.integerPartition.exactRate
    )}`
  );


  console.log(
    `  Remainder priority:      ${formatPercent(
      row.rewardAllocation.remainderPriority.creditedGetsCeilRate
    )}`
  );


  console.log(
    `  Leading pre35 reward n:  ${row.rewardScaling.leadingPre35Cases}`
  );


  console.log(
    `  Reward regression:       ${formatNumber(
      row.rewardScaling.leadingPre35Regression.intercept
    )} + ${formatNumber(
      row.rewardScaling.leadingPre35Regression.slope
    )}*minute`
  );


  console.log('');

  console.log(
    'AIM ORIENTATION'
  );


  console.log(
    `  Comparable hits:         ${row.aimOrientation.comparableAimCases}`
  );


  console.log(
    `  Discovery convention:    ${row.aimOrientation.discoveryConventionRecovered}`
  );


  console.log(
    `  Eye primary median:      ${formatNumber(
      row.aimOrientation.eye.primaryError.median
    )}°`
  );


  console.log(
    `  Eye placebo median:      ${formatNumber(
      row.aimOrientation.eye.placeboError.median
    )}°`
  );


  console.log(
    `  Primary beats placebo:   ${formatPercent(
      row.aimOrientation.eye.primaryBeatsPlaceboRate
    )}`
  );


  console.log('');

  console.log(
    'SUPPORT'
  );


  for (
    const [
      key,
      support
    ]
    of Object.entries(
      row.support
    )
  ) {

    console.log(

      `  ${key.padEnd(24)} ` +

      `informative=${String(support.informative).padEnd(5)} ` +

      `supported=${support.supported}`
    );
  }
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


function formatPercent(
  value
) {

  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(
        2
      )}%`
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


  return (
    `n=${row.count} ` +
    `min=${formatNumber(row.min)} ` +
    `p25=${formatNumber(row.p25)} ` +
    `median=${formatNumber(row.median)} ` +
    `p75=${formatNumber(row.p75)} ` +
    `max=${formatNumber(row.max)}`
  );
}


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# DeadlockBehavior Cross-Replay Foundational Replication'
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.overallStatus}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Independent replay units: **${summary.design.independentReplicationUnits}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Claim-level replication'
  );


  lines.push(
    ''
  );


  for (
    const [
      id,
      row
    ]
    of Object.entries(
      summary.claims
    )
  ) {

    lines.push(
      `- **${id}** — ${row.status} — ${row.supportedReplays}/${row.informativeReplays} informative replays supported`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Replay-level results'
  );


  lines.push(
    ''
  );


  for (
    const replay
    of summary.replays
  ) {

    lines.push(
      `### ${replay.replay}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Strict death↔AssignedGold matches: ${replay.matching.strictMutualOneToOneMatches}`
    );


    lines.push(
      `- Last-hit deaths with AssignedGold candidate: ${formatPercent(replay.productionLastHit.creditedDeathsWithAnyActivationCandidateRate)}`
    );


    lines.push(
      `- Target→inactive median: ${formatNumber(replay.lifecycle.targetToInactiveSeconds.median)} sec`
    );


    lines.push(
      `- Best vacuum XY threshold: ${formatNumber(replay.vacuumGeometry.xy.bestThreshold?.thresholdHU)} HU`
    );


    lines.push(
      `- Frozen 735 vacuum MCC: ${formatNumber(replay.vacuumGeometry.xy.frozen735?.mcc)}`
    );


    lines.push(
      `- Clean economic cases: ${replay.economicRecipientSet.isolatedCleanCases}`
    );


    lines.push(
      `- Best recipient 3D threshold: ${formatNumber(replay.recipientGeometry.threeD.bestThreshold?.thresholdHU)} HU`
    );


    lines.push(
      `- Frozen 2150 recipient MCC: ${formatNumber(replay.recipientGeometry.threeD.frozen2150?.mcc)}`
    );


    lines.push(
      `- Frozen 2150 exact-set rate: ${formatPercent(replay.recipientGeometry.threeD.frozen2150?.exactSetRate)}`
    );


    lines.push(
      `- Integer partition exact rate: ${formatPercent(replay.rewardAllocation.integerPartition.exactRate)}`
    );


    lines.push(
      `- Credited remainder priority: ${formatPercent(replay.rewardAllocation.remainderPriority.creditedGetsCeilRate)}`
    );


    lines.push(
      `- Aim primary median: ${formatNumber(replay.aimOrientation.eye.primaryError.median)}°`
    );


    lines.push(
      `- Aim placebo median: ${formatNumber(replay.aimOrientation.eye.placeboError.median)}°`
    );


    lines.push(
      ''
    );
  }


  lines.push(
    '## Interpretation'
  );


  lines.push(
    ''
  );


  lines.push(
    'The discovery replay is excluded from the replication-unit count. Frozen discovery parameters are evaluated directly before replay-specific best-fitting estimates are considered.'
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}