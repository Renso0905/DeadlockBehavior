import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';


// ============================================================
// PATHS
// ============================================================

const INPUT_PATH =
  resolve(
    'output',
    'cross_replay',
    'foundational_replication_metrics_v02.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'foundational_replication_interpretation_audit_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'foundational_replication_interpretation_audit_v01.md'
  );


// ============================================================
// INPUT
// ============================================================

if (
  !existsSync(
    INPUT_PATH
  )
) {

  throw new Error(
    `Missing Script103 V02 output:\n${INPUT_PATH}`
  );
}


const source =
  JSON.parse(
    readFileSync(
      INPUT_PATH,
      'utf8'
    )
  );


if (
  source?.version !==
  'CROSS_REPLAY_FOUNDATIONAL_REPLICATION_METRICS_V02'
) {

  throw new Error(
    `Unexpected input version:\n${source?.version}`
  );
}


const replays =
  Array.isArray(
    source?.replays
  )
    ? source.replays
    : [];


if (
  replays.length ===
  0
) {

  throw new Error(
    'Script103 V02 contains no replay summaries.'
  );
}


// ============================================================
// PURPOSE
//
// Script103 V02 mixed three distinct interpretation problems:
//
// 1. AIM SUPPORT BUG
//
//    analyzeAimOrientation() returned:
//
//      {
//        summary,
//        internalCases
//      }
//
//    but evaluateAimSupport() was passed the wrapper instead of:
//
//      aim.summary
//
//    Therefore:
//
//      comparableAimCases === undefined
//
//    and every replay was incorrectly labeled:
//
//      informative=false
//
//
// 2. REWARD CLAIM BUNDLING
//
//    Script103 called the claim:
//
//      REWARD_ALLOCATION
//
//    but its support flag required BOTH:
//
//      integer allocation semantics
//      reward magnitude scaling
//
//    Those are separate empirical questions.
//
//    Across all five replays:
//
//      integer partition = strong
//      remainder priority = strong
//
//    while:
//
//      50 + 1/min reward scaling = not reproduced
//
//
// 3. VACUUM CLAIM BUNDLING
//
//    Script103 required the exact frozen 735 HU threshold to
//    perform strongly despite using 4-Hz player-state geometry.
//
//    The independently fitted operational thresholds cluster
//    tightly around ~765-795 HU.
//
//    Therefore distinguish:
//
//      proximity relationship replication
//
//    from:
//
//      exact 735 HU threshold replication
//
// ============================================================


// ============================================================
// DISCOVERY PRIORS
// ============================================================

const DISCOVERY_VACUUM_HU =
  735;


const DISCOVERY_RECIPIENT_HU =
  2150;


// ============================================================
// PER-REPLAY AUDIT
// ============================================================

const auditedReplays =
  [];


for (
  const replay
  of replays
) {

  // ----------------------------------------------------------
  // PRODUCTION
  // ----------------------------------------------------------

  const production = {

    informative:
      replay
        ?.support
        ?.productionLastHit
        ?.informative ===
      true,

    supported:
      replay
        ?.support
        ?.productionLastHit
        ?.supported ===
      true
  };


  // ----------------------------------------------------------
  // LIFECYCLE
  // ----------------------------------------------------------

  const lifecycle = {

    informative:
      replay
        ?.support
        ?.lifecycle
        ?.informative ===
      true,

    supported:
      replay
        ?.support
        ?.lifecycle
        ?.supported ===
      true,

    targetToInactiveMedianSeconds:
      numberOrNull(
        replay
          ?.lifecycle
          ?.targetToInactiveSeconds
          ?.median
      ),

    timeoutWithin2Rate:
      numberOrNull(
        replay
          ?.lifecycle
          ?.targetlessTimeout
          ?.within2Rate
      )
  };


  // ----------------------------------------------------------
  // VACUUM PROXIMITY
  //
  // Relationship support:
  //
  //   - sufficient positive/negative cases
  //   - best threshold exists
  //   - best threshold remains within the SAME ±125 HU envelope
  //     already used by Script103
  //   - best-threshold MCC >= .70
  //
  // Exact-frozen support is reported separately.
  // ----------------------------------------------------------

  const vacuumBest =
    replay
      ?.vacuumGeometry
      ?.xy
      ?.bestThreshold
    ??
    null;


  const vacuumFrozen =
    replay
      ?.vacuumGeometry
      ?.xy
      ?.frozen735
    ??
    null;


  const vacuumInformative =

    (
      replay
        ?.vacuumGeometry
        ?.targetedComparable ??
      0
    ) >=
    30

    &&

    (
      replay
        ?.vacuumGeometry
        ?.targetlessComparable ??
      0
    ) >=
    5;


  const bestVacuumThreshold =
    numberOrNull(
      vacuumBest?.thresholdHU
    );


  const vacuumRelationshipSupported =

    vacuumInformative

    &&

    Number.isFinite(
      bestVacuumThreshold
    )

    &&

    Math.abs(
      bestVacuumThreshold -
      DISCOVERY_VACUUM_HU
    ) <=
    125

    &&

    (
      numberOrNull(
        vacuumBest?.mcc
      )
      ??
      -Infinity
    ) >=
    0.70;


  const frozenVacuumSupported =

    vacuumInformative

    &&

    (
      numberOrNull(
        vacuumFrozen?.mcc
      )
      ??
      -Infinity
    ) >=
    0.70

    &&

    (
      numberOrNull(
        vacuumFrozen?.sensitivity
      )
      ??
      0
    ) >=
    0.80

    &&

    (
      numberOrNull(
        vacuumFrozen?.specificity
      )
      ??
      0
    ) >=
    0.70;


  const vacuum = {

    informative:
      vacuumInformative,

    relationshipSupported:
      vacuumRelationshipSupported,

    frozen735Supported:
      frozenVacuumSupported,

    bestThresholdHU:
      bestVacuumThreshold,

    bestMCC:
      numberOrNull(
        vacuumBest?.mcc
      ),

    frozen735MCC:
      numberOrNull(
        vacuumFrozen?.mcc
      ),

    frozen735Sensitivity:
      numberOrNull(
        vacuumFrozen?.sensitivity
      ),

    frozen735Specificity:
      numberOrNull(
        vacuumFrozen?.specificity
      )
  };


  // ----------------------------------------------------------
  // ECONOMIC RECIPIENT IDENTITY
  // ----------------------------------------------------------

  const economicRecipient = {

    informative:
      replay
        ?.support
        ?.economicRecipientSet
        ?.informative ===
      true,

    supported:
      replay
        ?.support
        ?.economicRecipientSet
        ?.supported ===
      true,

    cleanCases:
      replay
        ?.economicRecipientSet
        ?.isolatedCleanCases
      ??
      0,

    creditedIncludedRate:
      numberOrNull(
        replay
          ?.economicRecipientSet
          ?.creditedIncludedRate
      )
  };


  // ----------------------------------------------------------
  // RECIPIENT GEOMETRY
  // ----------------------------------------------------------

  const recipientGeometry = {

    informative:
      replay
        ?.support
        ?.recipientGeometry
        ?.informative ===
      true,

    supported:
      replay
        ?.support
        ?.recipientGeometry
        ?.supported ===
      true,

    comparableCases:
      replay
        ?.recipientGeometry
        ?.geometryComparableCases
      ??
      0,

    bestThresholdHU:
      numberOrNull(
        replay
          ?.recipientGeometry
          ?.threeD
          ?.bestThreshold
          ?.thresholdHU
      ),

    bestMCC:
      numberOrNull(
        replay
          ?.recipientGeometry
          ?.threeD
          ?.bestThreshold
          ?.mcc
      ),

    frozen2150MCC:
      numberOrNull(
        replay
          ?.recipientGeometry
          ?.threeD
          ?.frozen2150
          ?.mcc
      ),

    frozen2150ExactSetRate:
      numberOrNull(
        replay
          ?.recipientGeometry
          ?.threeD
          ?.frozen2150
          ?.exactSetRate
      )
  };


  // ----------------------------------------------------------
  // CORE INTEGER ALLOCATION
  //
  // This deliberately excludes reward magnitude scaling.
  // ----------------------------------------------------------

  const partitionRate =
    numberOrNull(
      replay
        ?.rewardAllocation
        ?.integerPartition
        ?.exactRate
    );


  const remainderComparable =
    replay
      ?.rewardAllocation
      ?.remainderPriority
      ?.comparable
    ??
    0;


  const remainderRate =
    numberOrNull(
      replay
        ?.rewardAllocation
        ?.remainderPriority
        ?.creditedGetsCeilRate
    );


  const allocationInformative =
    (
      replay
        ?.rewardAllocation
        ?.cleanCases ??
      0
    ) >=
    20;


  const partitionSupported =
    Number.isFinite(
      partitionRate
    )
    &&
    partitionRate >=
    0.90;


  const remainderSupported =
    remainderComparable <
    10
      ? null
      : (
          Number.isFinite(
            remainderRate
          )
          &&
          remainderRate >=
          0.85
        );


  const integerAllocationSupported =

    allocationInformative

    &&

    partitionSupported

    &&

    (
      remainderSupported ===
      null
      ||
      remainderSupported ===
      true
    );


  const integerAllocation = {

    informative:
      allocationInformative,

    supported:
      integerAllocationSupported,

    cleanCases:
      replay
        ?.rewardAllocation
        ?.cleanCases
      ??
      0,

    partitionExactRate:
      partitionRate,

    remainderComparable,

    creditedRemainderPriorityRate:
      remainderRate,

    partitionSupported,

    remainderSupported
  };


  // ----------------------------------------------------------
  // REWARD MAGNITUDE SCALING
  //
  // Kept separate from allocation.
  //
  // Use Script103's own expected range:
  //
  //   intercept 43..57
  //   slope .75..1.25
  // ----------------------------------------------------------

  const rewardRegression =
    replay
      ?.rewardScaling
      ?.leadingPre35Regression
    ??
    null;


  const rewardScalingCases =
    replay
      ?.rewardScaling
      ?.leadingPre35Cases
    ??
    0;


  const rewardIntercept =
    numberOrNull(
      rewardRegression?.intercept
    );


  const rewardSlope =
    numberOrNull(
      rewardRegression?.slope
    );


  const rewardScalingInformative =

    rewardScalingCases >=
    10

    &&

    Number.isFinite(
      rewardIntercept
    )

    &&

    Number.isFinite(
      rewardSlope
    );


  const rewardScalingSupported =

    rewardScalingInformative

    &&

    rewardIntercept >=
    43

    &&

    rewardIntercept <=
    57

    &&

    rewardSlope >=
    0.75

    &&

    rewardSlope <=
    1.25;


  const rewardScaling = {

    informative:
      rewardScalingInformative,

    supported:
      rewardScalingSupported,

    cases:
      rewardScalingCases,

    intercept:
      rewardIntercept,

    slope:
      rewardSlope,

    r2:
      numberOrNull(
        rewardRegression?.r2
      ),

    rmse:
      numberOrNull(
        rewardRegression?.rmse
      )
  };


  // ----------------------------------------------------------
  // AIM ORIENTATION
  //
  // Script103 V02 passed the wrong object into its support
  // evaluator.
  //
  // We apply V02's OWN intended criteria here:
  //
  //   n >= 8
  //   discovery convention recovered
  //   primary median <= 15°
  //   placebo-primary gain >= 8°
  //   primary beats placebo >= 70%
  // ----------------------------------------------------------

  const aimCases =
    replay
      ?.aimOrientation
      ?.comparableAimCases
    ??
    0;


  const aimPrimaryMedian =
    numberOrNull(
      replay
        ?.aimOrientation
        ?.eye
        ?.primaryError
        ?.median
    );


  const aimPlaceboMedian =
    numberOrNull(
      replay
        ?.aimOrientation
        ?.eye
        ?.placeboError
        ?.median
    );


  const aimPrimaryBeatsPlacebo =
    numberOrNull(
      replay
        ?.aimOrientation
        ?.eye
        ?.primaryBeatsPlaceboRate
    );


  const aimTemporalGain =

    Number.isFinite(
      aimPrimaryMedian
    )

    &&

    Number.isFinite(
      aimPlaceboMedian
    )

      ? aimPlaceboMedian -
        aimPrimaryMedian

      : null;


  const aimInformative =
    aimCases >=
    8;


  const aimSupported =

    aimInformative

    &&

    replay
      ?.aimOrientation
      ?.discoveryConventionRecovered ===
    true

    &&

    Number.isFinite(
      aimPrimaryMedian
    )

    &&

    aimPrimaryMedian <=
    15

    &&

    Number.isFinite(
      aimTemporalGain
    )

    &&

    aimTemporalGain >=
    8

    &&

    (
      aimPrimaryBeatsPlacebo ??
      0
    ) >=
    0.70;


  const aim = {

    informative:
      aimInformative,

    supported:
      aimSupported,

    comparableCases:
      aimCases,

    discoveryConventionRecovered:
      replay
        ?.aimOrientation
        ?.discoveryConventionRecovered ===
      true,

    primaryMedianDegrees:
      aimPrimaryMedian,

    placeboMedianDegrees:
      aimPlaceboMedian,

    temporalGainDegrees:
      aimTemporalGain,

    primaryBeatsPlaceboRate:
      aimPrimaryBeatsPlacebo
  };


  // ----------------------------------------------------------
  // STORE
  // ----------------------------------------------------------

  auditedReplays.push({

    replay:
      replay.replay,

    production,

    lifecycle,

    vacuum,

    economicRecipient,

    recipientGeometry,

    integerAllocation,

    rewardScaling,

    aim
  });
}


// ============================================================
// CLAIM BUILDING
// ============================================================

const claims = {

  GROUND_SOUL_PRODUCTION_LAST_HIT_LINK:
    summarizeClaim(
      auditedReplays,
      row =>
        row.production
    ),


  GROUND_SOUL_LIFECYCLE:
    summarizeClaim(
      auditedReplays,
      row =>
        row.lifecycle
    ),


  VACUUM_PROXIMITY_RELATIONSHIP:
    summarizeClaim(
      auditedReplays,
      row => ({

        informative:
          row
            .vacuum
            .informative,

        supported:
          row
            .vacuum
            .relationshipSupported
      })
    ),


  ECONOMIC_RECIPIENT_SET:
    summarizeClaim(
      auditedReplays,
      row =>
        row.economicRecipient
    ),


  RECIPIENT_GEOMETRY:
    summarizeClaim(
      auditedReplays,
      row =>
        row.recipientGeometry
    ),


  INTEGER_REWARD_ALLOCATION:
    summarizeClaim(
      auditedReplays,
      row =>
        row.integerAllocation
    ),


  AIM_ORIENTATION:
    summarizeClaim(
      auditedReplays,
      row =>
        row.aim
    )
};


// ============================================================
// SECONDARY / UNRESOLVED CLAIMS
// ============================================================

const secondaryClaims = {

  EXACT_FROZEN_735_VACUUM_THRESHOLD:
    summarizeClaim(
      auditedReplays,
      row => ({

        informative:
          row
            .vacuum
            .informative,

        supported:
          row
            .vacuum
            .frozen735Supported
      })
    ),


  REWARD_MAGNITUDE_50_PLUS_1_PER_MINUTE:
    summarizeClaim(
      auditedReplays,
      row =>
        row.rewardScaling
    )
};


// ============================================================
// REPLAY-LEVEL DISTRIBUTIONS
// ============================================================

const distributions = {

  targetToInactiveMedianSeconds:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .lifecycle
            .targetToInactiveMedianSeconds
      )
    ),


  targetlessTimeoutWithin2Rate:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .lifecycle
            .timeoutWithin2Rate
      )
    ),


  vacuumBestThresholdHU:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .vacuum
            .bestThresholdHU
      )
    ),


  vacuumBestMCC:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .vacuum
            .bestMCC
      )
    ),


  vacuumFrozen735MCC:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .vacuum
            .frozen735MCC
      )
    ),


  recipientBestThresholdHU:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .recipientGeometry
            .bestThresholdHU
      )
    ),


  recipientFrozen2150MCC:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .recipientGeometry
            .frozen2150MCC
      )
    ),


  recipientFrozen2150ExactSetRate:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .recipientGeometry
            .frozen2150ExactSetRate
      )
    ),


  integerPartitionExactRate:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .integerAllocation
            .partitionExactRate
      )
    ),


  remainderPriorityRate:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .integerAllocation
            .creditedRemainderPriorityRate
      )
    ),


  rewardIntercept:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .rewardScaling
            .intercept
      )
    ),


  rewardSlope:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .rewardScaling
            .slope
      )
    ),


  aimPrimaryMedianDegrees:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .aim
            .primaryMedianDegrees
      )
    ),


  aimPlaceboMedianDegrees:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .aim
            .placeboMedianDegrees
      )
    ),


  aimTemporalGainDegrees:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .aim
            .temporalGainDegrees
      )
    ),


  aimPrimaryBeatsPlaceboRate:
    summarizeNumbers(
      auditedReplays.map(
        row =>
          row
            .aim
            .primaryBeatsPlaceboRate
      )
    )
};


// ============================================================
// CORE STATUS
// ============================================================

const coreClaimRows =
  Object.values(
    claims
  );


const allCoreStrong =
  coreClaimRows.every(
    row =>
      row.status ===
      'STRONGLY_REPLICATED'
  );


const rewardMagnitudeResolved =
  secondaryClaims
    .REWARD_MAGNITUDE_50_PLUS_1_PER_MINUTE
    .status ===
  'STRONGLY_REPLICATED';


let overallStatus;


if (
  allCoreStrong
  &&
  rewardMagnitudeResolved
) {

  overallStatus =
    'FOUNDATIONAL_SEMANTICS_AND_REWARD_MAGNITUDE_STRONGLY_REPLICATED';

} else if (
  allCoreStrong
) {

  overallStatus =
    'FOUNDATIONAL_SEMANTICS_STRONGLY_REPLICATED_REWARD_MAGNITUDE_UNRESOLVED';

} else {

  overallStatus =
    'FOUNDATIONAL_SEMANTICS_PARTIALLY_REPLICATED';
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    'FOUNDATIONAL_REPLICATION_INTERPRETATION_AUDIT_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  source:
    INPUT_PATH,

  sourceVersion:
    source.version,

  overallStatus,


  corrections: {

    aimSupportBug: {

      present:
        true,

      description:
        'Script103 V02 evaluated the analyzeAimOrientation wrapper instead of aim.summary, causing every replay to be incorrectly marked non-informative.',

      telemetryAffected:
        false
    },


    rewardClaimBundling: {

      present:
        true,

      description:
        'Script103 V02 combined integer allocation semantics and reward magnitude scaling under REWARD_ALLOCATION. This audit separates them.',

      telemetryAffected:
        false
    },


    vacuumClaimBundling: {

      present:
        true,

      description:
        'Script103 V02 combined replication of the proximity relationship with replication of the exact frozen 735 HU discriminator despite using lower-resolution 4-Hz positions.',

      telemetryAffected:
        false
    }
  },


  authorityPolicy: {

    coreFoundationalClaims:
      'Claims required to construct the behavioral opportunity/state model.',

    secondaryExactMechanics:
      'Useful mechanic refinements that need not invalidate the broader semantic relationship.',

    vacuum:
      'A stable proximity relationship may be cross-replay validated while the exact engine boundary remains unresolved.',

    reward:
      'Integer sharing/allocation may be validated independently of the exact underlying reward magnitude function.'
  },


  claims,

  secondaryClaims,

  distributions,

  auditedReplays,


  nextStage: {

    unresolvedPrimaryQuestion:
      rewardMagnitudeResolved
        ? null
        : 'Why do independent-replay clean leading pre-35 AssignedGold cases imply substantially higher unshared reward intercepts than the test.dem 50 + 1/min model?',

    recommendedAction:
      rewardMagnitudeResolved
        ? 'Proceed to behavioral opportunity-feature construction.'
        : 'Run a targeted offline reward-magnitude diagnostic before constructing economic-value behavioral features.',

    doNotReopen: [

      'ground-soul lifecycle',

      'credited-last-hitter economic inclusion',

      'death-time recipient-set geometry',

      'integer partition semantics',

      'credited remainder priority',

      'eye-angle aim orientation'
    ]
  },


  outputs: {

    json:
      OUTPUT_JSON_PATH,

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


writeFileSync(
  OUTPUT_MARKDOWN_PATH,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'FOUNDATIONAL REPLICATION INTERPRETATION AUDIT V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'SCRIPT103 V02 CORRECTIONS'
);

console.log(
  '-------------------------'
);


console.log(
  'Aim informative-status bug:          CORRECTED'
);


console.log(
  'Reward allocation/scaling bundling:  SEPARATED'
);


console.log(
  'Vacuum relation/exact-735 bundling:   SEPARATED'
);


// ============================================================
// CORE CLAIMS
// ============================================================

console.log('');

console.log(
  'CORE FOUNDATIONAL CLAIMS'
);

console.log(
  '------------------------'
);


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

    `${id.padEnd(40)} ` +

    `${row.status.padEnd(22)} ` +

    `${row.supportedReplays}/${row.informativeReplays}`
  );
}


// ============================================================
// SECONDARY
// ============================================================

console.log('');

console.log(
  'SECONDARY / UNRESOLVED MECHANICS'
);

console.log(
  '--------------------------------'
);


for (
  const [
    id,
    row
  ]
  of Object.entries(
    secondaryClaims
  )
) {

  console.log(

    `${id.padEnd(40)} ` +

    `${row.status.padEnd(22)} ` +

    `${row.supportedReplays}/${row.informativeReplays}`
  );
}


// ============================================================
// KEY DISTRIBUTIONS
// ============================================================

console.log('');

console.log(
  'KEY REPLAY-LEVEL DISTRIBUTIONS'
);

console.log(
  '------------------------------'
);


console.log(
  `Vacuum best threshold:       ${formatDistribution(
    distributions.vacuumBestThresholdHU
  )}`
);


console.log(
  `Vacuum frozen-735 MCC:       ${formatDistribution(
    distributions.vacuumFrozen735MCC
  )}`
);


console.log(
  `Recipient best threshold:    ${formatDistribution(
    distributions.recipientBestThresholdHU
  )}`
);


console.log(
  `Recipient frozen-2150 MCC:   ${formatDistribution(
    distributions.recipientFrozen2150MCC
  )}`
);


console.log(
  `Integer partition rate:      ${formatDistribution(
    distributions.integerPartitionExactRate
  )}`
);


console.log(
  `Remainder priority rate:     ${formatDistribution(
    distributions.remainderPriorityRate
  )}`
);


console.log(
  `Reward intercept:            ${formatDistribution(
    distributions.rewardIntercept
  )}`
);


console.log(
  `Reward slope:                ${formatDistribution(
    distributions.rewardSlope
  )}`
);


console.log(
  `Aim primary median:          ${formatDistribution(
    distributions.aimPrimaryMedianDegrees
  )}`
);


console.log(
  `Aim placebo median:          ${formatDistribution(
    distributions.aimPlaceboMedianDegrees
  )}`
);


console.log(
  `Aim temporal gain:           ${formatDistribution(
    distributions.aimTemporalGainDegrees
  )}`
);


// ============================================================
// FINAL
// ============================================================

console.log('');

console.log(
  'AUDITED STATUS'
);

console.log(
  '--------------'
);


console.log(
  overallStatus
);


console.log('');

console.log(
  'NEXT UNRESOLVED PRIMARY QUESTION'
);


console.log(
  '--------------------------------'
);


console.log(
  summary
    .nextStage
    .unresolvedPrimaryQuestion
  ??
  'None.'
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
// CLAIM SUMMARY
// ============================================================

function summarizeClaim(
  rows,
  selector
) {

  const replayResults =
    rows.map(
      row => {

        const selected =
          selector(
            row
          );


        return {

          replay:
            row.replay,

          informative:
            selected?.informative ===
            true,

          supported:
            selected?.supported ===
            true
        };
      }
    );


  const informative =
    replayResults.filter(
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


  return {

    informativeReplays:
      informative.length,

    supportedReplays:
      supported.length,

    supportRate,

    status,

    replayResults
  };
}


// ============================================================
// DISTRIBUTION
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

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      clean.reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      )
      /
      clean.length
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
// NUMERIC
// ============================================================

function numberOrNull(
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


// ============================================================
// FORMAT
// ============================================================

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
    '# Foundational Cross-Replay Replication Interpretation Audit'
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
    '## Corrections to Script103 V02'
  );


  lines.push(
    ''
  );


  lines.push(
    '- Aim support was incorrectly marked non-informative because the support evaluator received the wrapper object rather than `aim.summary`.'
  );


  lines.push(
    '- Integer allocation and reward magnitude scaling are separated.'
  );


  lines.push(
    '- Physical vacuum proximity and exact replication of the frozen 735 HU threshold are separated.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Core foundational claims'
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
      `- **${id}** — ${row.status} — ${row.supportedReplays}/${row.informativeReplays}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Secondary / unresolved mechanics'
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
      summary.secondaryClaims
    )
  ) {

    lines.push(
      `- **${id}** — ${row.status} — ${row.supportedReplays}/${row.informativeReplays}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Next question'
  );


  lines.push(
    ''
  );


  lines.push(
    summary
      .nextStage
      .unresolvedPrimaryQuestion
    ??
    'No foundational question remains unresolved.'
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}