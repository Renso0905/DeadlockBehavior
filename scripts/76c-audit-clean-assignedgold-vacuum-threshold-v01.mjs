import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';


const replayName =
  process.argv[2] ??
  'test';


const HU_PER_METER =
  39.37;


const EXPIRATION_SECONDS =
  40;


const EXPIRATION_TOLERANCE_SECONDS =
  0.05;


const IMMEDIATE_SECONDS =
  0.25;


// ============================================================
// THRESHOLD SEARCH
//
// Exploratory only.
//
// We are testing the clean delayed m_hVacuumTarget cohort to
// identify the empirical target-acquisition envelope.
//
// Do NOT promote the selected value to an engine constant.
// ============================================================

const SEARCH_MIN_HU =
  600;


const SEARCH_MAX_HU =
  850;


const SEARCH_STEP_HU =
  1;


// ============================================================
// BOUNDARY-LIKE PAIRS
//
// A delayed transition is especially informative when:
//
//   previous distance > onset distance
//
// and the player moved only a relatively small amount between
// those consecutive replay snapshots.
//
// For any threshold T:
//
//   onset <= T < previous
//
// would produce an exact previous-outside / onset-inside
// crossing.
//
// The overlap of those intervals can reveal a candidate boundary.
// ============================================================

const BOUNDARY_PAIR_MAX_STEP_HU =
  50;


// ============================================================
// PATHS
// ============================================================

const summary75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_discovery_v02.json'
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const snapshots75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_snapshots_v02.jsonl'
  );


const summary76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_validation_v01.json'
  );


const episodes76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_threshold_clean_audit_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_threshold_clean_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    summary75Path,
    episodes75Path,
    snapshots75Path,
    summary76Path,
    episodes76Path
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


// ============================================================
// LOAD SUMMARIES / EPISODES
// ============================================================

const summary75 =
  JSON.parse(
    readFileSync(
      summary75Path,
      'utf8'
    )
  );


const summary76 =
  JSON.parse(
    readFileSync(
      summary76Path,
      'utf8'
    )
  );


if (
  summary75
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 75 V02 did not PASS.'
  );
}


const episodes75 =
  await loadJsonl(
    episodes75Path
  );


const episodes76 =
  await loadJsonl(
    episodes76Path
  );


console.log('');

console.log(
  `Script 75 episodes: ${episodes75.length}`
);


console.log(
  `Script 76 episodes: ${episodes76.length}`
);


// ============================================================
// CLOSE SCRIPT 76 SNAPSHOT VALIDATION ERROR
// ============================================================

const failed76Checks =
  Object
    .entries(
      summary76
        ?.validation
        ?.checks ??
      {}
    )
    .filter(
      ([
        name,
        row
      ]) =>
        row?.pass !==
        true
    )
    .map(
      ([
        name
      ]) =>
        name
    );


const activationTickByDeathIndex =
  new Map();


for (
  const row
  of episodes75
) {

  const deathIndex =
    finite(
      row
        ?.death
        ?.deathIndex
    );


  const activationTick =
    finite(
      row
        ?.assignedGold
        ?.activationTick
    );


  if (
    deathIndex !==
      null
    &&
    activationTick !==
      null
  ) {

    activationTickByDeathIndex.set(
      deathIndex,
      activationTick
    );
  }
}


let rawSnapshotCount =
  0;


let joinedSnapshotCount =
  0;


let preActivationSnapshotCount =
  0;


let postActivationSnapshotCount =
  0;


const snapshotReader =
  createInterface({

    input:
      createReadStream(
        snapshots75Path,
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
  of snapshotReader
) {

  if (
    !line.trim()
  ) {

    continue;
  }


  rawSnapshotCount++;


  let row;


  try {

    row =
      JSON.parse(
        line
      );

  } catch {

    continue;
  }


  const deathIndex =
    finite(
      row?.deathIndex
    );


  const tick =
    finite(
      row?.tick
    );


  const activationTick =
    deathIndex ===
      null
      ? null
      : activationTickByDeathIndex.get(
        deathIndex
      )
      ??
      null;


  if (
    tick ===
      null
    ||
    activationTick ===
      null
  ) {

    continue;
  }


  joinedSnapshotCount++;


  if (
    tick <
    activationTick
  ) {

    preActivationSnapshotCount++;

  } else {

    postActivationSnapshotCount++;
  }
}


const script76EpisodeSnapshotSum =
  episodes76.reduce(
    (
      sum,
      row
    ) =>
      sum +
      (
        finite(
          row?.snapshotCount
        )
        ??
        0
      ),
    0
  );


const snapshotFailureExplained =
  failed76Checks.length ===
    1
  &&
  failed76Checks[0] ===
    'snapshotCountPreserved'
  &&
  joinedSnapshotCount ===
    rawSnapshotCount
  &&
  preActivationSnapshotCount +
    postActivationSnapshotCount ===
    rawSnapshotCount
  &&
  script76EpisodeSnapshotSum ===
    postActivationSnapshotCount;


// ============================================================
// CLEAN SCRIPT 73 CREDIT COHORT ONLY
// ============================================================

const clean =
  episodes76.filter(
    row =>
      row
        ?.creditedPlayer
        ?.quality ===
      'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'
  );


const cleanTransitions =
  clean.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NULL_TO_PLAYER_TARGET_TRANSITION'
  );


const cleanNoTarget =
  clean.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NO_PLAYER_TARGET_OBSERVED'
  );


const cleanOtherTargetState =
  clean.filter(
    row =>
      ![
        'NULL_TO_PLAYER_TARGET_TRANSITION',
        'NO_PLAYER_TARGET_OBSERVED'
      ].includes(
        row
          ?.vacuum
          ?.targetOnsetType
      )
  );


// ============================================================
// CLEAN GEOMETRY
// ============================================================

const cleanGeometryResolved =
  cleanTransitions.filter(
    row =>
      Number.isFinite(
        finite(
          row
            ?.vacuum
            ?.targetGeometry
            ?.distanceAtOnset3D
        )
      )
  );


const cleanImmediate =
  cleanGeometryResolved.filter(
    row =>
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      ) !==
        null
    &&
    finite(
      row
        ?.vacuum
        ?.targetDelaySeconds
    ) <=
    IMMEDIATE_SECONDS
  );


const cleanDelayed =
  cleanGeometryResolved.filter(
    row =>
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      ) !==
        null
    &&
    finite(
      row
        ?.vacuum
        ?.targetDelaySeconds
    ) >
    IMMEDIATE_SECONDS
  );


const delayedComparable =
  cleanDelayed.filter(
    row =>
      Number.isFinite(
        finite(
          row
            ?.vacuum
            ?.targetGeometry
            ?.distanceBeforeOnset3D
        )
      )
  );


// ============================================================
// BOUNDARY-LIKE PAIRS
// ============================================================

const boundaryLikePairs =
  delayedComparable.filter(
    row => {

      const onset =
        finite(
          row
            ?.vacuum
            ?.targetGeometry
            ?.distanceAtOnset3D
        );


      const prior =
        finite(
          row
            ?.vacuum
            ?.targetGeometry
            ?.distanceBeforeOnset3D
        );


      return (
        onset !==
          null
        &&
        prior !==
          null
        &&
        prior >
          onset
        &&
        prior -
          onset <=
        BOUNDARY_PAIR_MAX_STEP_HU
      );
    }
  );


// ============================================================
// CLEAN DISTANCE DISTRIBUTIONS
// ============================================================

const allOnset3D =
  values(
    cleanGeometryResolved,
    row =>
      row
        ?.vacuum
        ?.targetGeometry
        ?.distanceAtOnset3D
  );


const immediateOnset3D =
  values(
    cleanImmediate,
    row =>
      row
        ?.vacuum
        ?.targetGeometry
        ?.distanceAtOnset3D
  );


const delayedOnset3D =
  values(
    cleanDelayed,
    row =>
      row
        ?.vacuum
        ?.targetGeometry
        ?.distanceAtOnset3D
  );


const delayedPrior3D =
  values(
    delayedComparable,
    row =>
      row
        ?.vacuum
        ?.targetGeometry
        ?.distanceBeforeOnset3D
  );


const delayedOnsetXY =
  values(
    cleanDelayed,
    row =>
      row
        ?.vacuum
        ?.targetGeometry
        ?.distanceAtOnsetXY
  );


const allSummary =
  summarizeNumbers(
    allOnset3D
  );


const immediateSummary =
  summarizeNumbers(
    immediateOnset3D
  );


const delayedSummary =
  summarizeNumbers(
    delayedOnset3D
  );


const delayedPriorSummary =
  summarizeNumbers(
    delayedPrior3D
  );


const delayedXYSummary =
  summarizeNumbers(
    delayedOnsetXY
  );


// ============================================================
// MINIMUM CONTAINMENT THRESHOLDS
// ============================================================

const delayedMinimum95 =
  minimumThresholdForCoverage(
    delayedOnset3D,
    0.95
  );


const delayedMinimum99 =
  minimumThresholdForCoverage(
    delayedOnset3D,
    0.99
  );


const delayedMinimum100 =
  minimumThresholdForCoverage(
    delayedOnset3D,
    1.00
  );


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const thresholdRows =
  [];


for (
  let thresholdHU =
    SEARCH_MIN_HU;

  thresholdHU <=
    SEARCH_MAX_HU;

  thresholdHU +=
    SEARCH_STEP_HU
) {

  let onsetInside =
    0;


  let onsetOutside =
    0;


  let priorOutside =
    0;


  let priorInside =
    0;


  let exactCrossing =
    0;


  for (
    const row
    of delayedComparable
  ) {

    const onset =
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnset3D
      );


    const prior =
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceBeforeOnset3D
      );


    if (
      onset <=
      thresholdHU
    ) {

      onsetInside++;

    } else {

      onsetOutside++;
    }


    if (
      prior >
      thresholdHU
    ) {

      priorOutside++;

    } else {

      priorInside++;
    }


    if (
      prior >
        thresholdHU
      &&
      onset <=
        thresholdHU
    ) {

      exactCrossing++;
    }
  }


  let boundaryLikeCrossing =
    0;


  for (
    const row
    of boundaryLikePairs
  ) {

    const onset =
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnset3D
      );


    const prior =
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceBeforeOnset3D
      );


    if (
      prior >
        thresholdHU
      &&
      onset <=
        thresholdHU
    ) {

      boundaryLikeCrossing++;
    }
  }


  thresholdRows.push({

    thresholdHU,

    thresholdMeters:
      thresholdHU /
      HU_PER_METER,

    comparable:
      delayedComparable.length,

    onsetInside,

    onsetInsideRate:
      rate(
        onsetInside,
        delayedComparable.length
      ),

    onsetOutside,

    priorOutside,

    priorOutsideRate:
      rate(
        priorOutside,
        delayedComparable.length
      ),

    priorInside,

    exactCrossing,

    exactCrossingRate:
      rate(
        exactCrossing,
        delayedComparable.length
      ),

    boundaryLikePairs:
      boundaryLikePairs.length,

    boundaryLikeCrossing,

    boundaryLikeCrossingRate:
      rate(
        boundaryLikeCrossing,
        boundaryLikePairs.length
      )
  });
}


// ============================================================
// BEST THRESHOLDS
// ============================================================

const bestOverallCrossing =
  thresholdRows
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.exactCrossing -
          a.exactCrossing
        ||
        a.onsetOutside -
          b.onsetOutside
        ||
        a.thresholdHU -
          b.thresholdHU
    )[0]
    ??
    null;


const bestBoundaryLikeCrossing =
  thresholdRows
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.boundaryLikeCrossing -
          a.boundaryLikeCrossing
        ||
        a.onsetOutside -
          b.onsetOutside
        ||
        a.thresholdHU -
          b.thresholdHU
    )[0]
    ??
    null;


const topBoundaryThresholds =
  thresholdRows
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.boundaryLikeCrossing -
          a.boundaryLikeCrossing
        ||
        b.exactCrossing -
          a.exactCrossing
        ||
        a.thresholdHU -
          b.thresholdHU
    )
    .slice(
      0,
      20
    );


// ============================================================
// CLEAN ONSET OUTLIERS
// ============================================================

const cleanOnsetOver800 =
  cleanGeometryResolved
    .filter(
      row =>
        finite(
          row
            ?.vacuum
            ?.targetGeometry
            ?.distanceAtOnset3D
        ) >
        800
    )
    .map(
      compactTransition
    );


const cleanDelayedOver800 =
  cleanDelayed
    .filter(
      row =>
        finite(
          row
            ?.vacuum
            ?.targetGeometry
            ?.distanceAtOnset3D
        ) >
        800
    )
    .map(
      compactTransition
    );


// ============================================================
// CLEAN TARGETLESS / EXPIRATION
// ============================================================

const cleanTargetlessInactive =
  cleanNoTarget.filter(
    row =>
      row
        ?.termination
        ?.activeFalseObserved ===
      true
  );


const cleanExpiration40 =
  cleanTargetlessInactive.filter(
    row => {

      const duration =
        finite(
          row
            ?.termination
            ?.durationSeconds
        );


      return (
        duration !==
          null
        &&
        Math.abs(
          duration -
          EXPIRATION_SECONDS
        ) <=
        EXPIRATION_TOLERANCE_SECONDS
      );
    }
  );


const cleanTargetlessNon40 =
  cleanTargetlessInactive
    .filter(
      row => {

        const duration =
          finite(
            row
              ?.termination
              ?.durationSeconds
          );


        return !(
          duration !==
            null
          &&
          Math.abs(
            duration -
            EXPIRATION_SECONDS
          ) <=
          EXPIRATION_TOLERANCE_SECONDS
        );
      }
    )
    .map(
      compactTargetless
    );


// ============================================================
// TARGET -> INACTIVE
// ============================================================

const targetToInactiveValues =
  values(
    cleanTransitions,
    row =>
      row
        ?.vacuum
        ?.targetToInactiveSeconds
  );


// ============================================================
// TARGET IDENTITY
// ============================================================

const targetIdentityComparable =
  cleanTransitions.filter(
    row =>
      Boolean(
        row
          ?.vacuum
          ?.targetPlayerName
      )
    &&
    Boolean(
      row
        ?.creditedPlayer
        ?.playerName
    )
  );


const targetSameAsCredited =
  targetIdentityComparable.filter(
    row =>
      row
        .vacuum
        .targetPlayerName ===
      row
        .creditedPlayer
        .playerName
  );


const targetDifferentSameTeam =
  targetIdentityComparable.filter(
    row =>
      row
        .vacuum
        .targetPlayerName !==
      row
        .creditedPlayer
        .playerName
    &&
    finite(
      row
        ?.vacuum
        ?.targetPlayerTeam
    ) !==
      null
    &&
    finite(
      row
        ?.creditedPlayer
        ?.team
    ) !==
      null
    &&
    finite(
      row
        .vacuum
        .targetPlayerTeam
    ) ===
    finite(
      row
        .creditedPlayer
        .team
    )
  );


const targetDifferentTeam =
  targetIdentityComparable.filter(
    row =>
      finite(
        row
          ?.vacuum
          ?.targetPlayerTeam
      ) !==
        null
    &&
    finite(
      row
        ?.creditedPlayer
        ?.team
    ) !==
      null
    &&
    finite(
      row
        .vacuum
        .targetPlayerTeam
    ) !==
    finite(
      row
        .creditedPlayer
        .team
    )
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedClean =
  finite(
    summary75
      ?.sourceCounts
      ?.cleanSingleUnitCreditedEpisodes
  );


const expectedCleanTransitions =
  finite(
    summary76
      ?.sourceCounts
      ?.cleanNullToPlayerTransitions
  );


const expectedCleanNoTarget =
  finite(
    summary76
      ?.sourceCounts
      ?.cleanNoPlayerTarget
  );


const expectedCleanGeometry =
  finite(
    summary76
      ?.targetPlayerGeometryAtOnset
      ?.resolved
  );


const validationChecks = {

  script75Passed:
    check(
      summary75
        ?.validation
        ?.pass,
      true,
      summary75
        ?.validation
        ?.pass ===
      true
    ),


  script76FailureIsOnlySnapshotBookkeeping:
    check(
      failed76Checks,
      [
        'snapshotCountPreserved'
      ],
      snapshotFailureExplained
    ),


  rawSnapshotCountPreserved:
    check(
      rawSnapshotCount,
      finite(
        summary75
          ?.sourceCounts
          ?.capturedSnapshotRows
      ),
      rawSnapshotCount ===
      finite(
        summary75
          ?.sourceCounts
          ?.capturedSnapshotRows
      )
    ),


  script76PostActivationSnapshotCountPreserved:
    check(
      script76EpisodeSnapshotSum,
      postActivationSnapshotCount,
      script76EpisodeSnapshotSum ===
      postActivationSnapshotCount
    ),


  cleanCreditCount:
    check(
      clean.length,
      expectedClean,
      expectedClean ===
        null
        ? clean.length >
          0
        : clean.length ===
          expectedClean
    ),


  cleanTransitionCount:
    check(
      cleanTransitions.length,
      expectedCleanTransitions,
      expectedCleanTransitions ===
        null
        ? cleanTransitions.length >
          0
        : cleanTransitions.length ===
          expectedCleanTransitions
    ),


  cleanNoTargetCount:
    check(
      cleanNoTarget.length,
      expectedCleanNoTarget,
      expectedCleanNoTarget ===
        null
        ? cleanNoTarget.length >=
          0
        : cleanNoTarget.length ===
          expectedCleanNoTarget
    ),


  cleanTargetPartitionExhaustive:
    check(
      cleanTransitions.length +
        cleanNoTarget.length +
        cleanOtherTargetState.length,
      clean.length,
      cleanTransitions.length +
        cleanNoTarget.length +
        cleanOtherTargetState.length ===
        clean.length
    ),


  cleanGeometryResolved:
    check(
      cleanGeometryResolved.length,
      expectedCleanGeometry,
      expectedCleanGeometry ===
        null
        ? cleanGeometryResolved.length >
          0
        : cleanGeometryResolved.length ===
          expectedCleanGeometry
    ),


  delayedComparableObserved:
    check(
      delayedComparable.length,
      '>0',
      delayedComparable.length >
      0
    )
};


const validationPass =
  Object
    .values(
      validationChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// OUTPUT
// ============================================================

const output = {

  replay:
    replayName,

  version:
    'ASSIGNED_GOLD_VACUUM_THRESHOLD_CLEAN_AUDIT_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'SCRIPT76_BOOKKEEPING_FAILURE_CLOSED_CLEAN_THRESHOLD_AUDIT_READY'
      : 'AUDIT_VALIDATION_FAILURE',


  script76Closure: {

    failedChecks:
      failed76Checks,

    rawSnapshotCount,

    joinedSnapshotCount,

    preActivationSnapshotCount,

    postActivationSnapshotCount,

    script76EpisodeSnapshotSum,

    snapshotFailureExplained
  },


  cleanCohort: {

    episodes:
      clean.length,

    nullToPlayerTransitions:
      cleanTransitions.length,

    noPlayerTargetObserved:
      cleanNoTarget.length,

    otherTargetStates:
      cleanOtherTargetState.length,

    geometryResolved:
      cleanGeometryResolved.length,

    immediateTransitions:
      cleanImmediate.length,

    delayedTransitions:
      cleanDelayed.length,

    delayedComparable:
      delayedComparable.length,

    boundaryLikePairs:
      boundaryLikePairs.length
  },


  cleanTargetOnsetDistance3D: {

    all:
      allSummary,

    immediate:
      immediateSummary,

    delayed:
      delayedSummary,

    delayedPrior:
      delayedPriorSummary,

    delayedOnsetXY:
      delayedXYSummary,

    minimumThresholdHUFor95PercentDelayedContainment:
      delayedMinimum95,

    minimumThresholdHUFor99PercentDelayedContainment:
      delayedMinimum99,

    minimumThresholdHUFor100PercentDelayedContainment:
      delayedMinimum100
  },


  thresholdSearch: {

    searchMinHU:
      SEARCH_MIN_HU,

    searchMaxHU:
      SEARCH_MAX_HU,

    stepHU:
      SEARCH_STEP_HU,

    boundaryPairMaximumPriorMinusOnsetHU:
      BOUNDARY_PAIR_MAX_STEP_HU,

    bestOverallCrossing,

    bestBoundaryLikeCrossing,

    topBoundaryThresholds,

    allThresholds:
      thresholdRows
  },


  onsetOutliers: {

    cleanOnsetOver800Count:
      cleanOnsetOver800.length,

    cleanDelayedOver800Count:
      cleanDelayedOver800.length,

    cleanOnsetOver800,

    cleanDelayedOver800
  },


  targetToInactiveSeconds:
    summarizeNumbers(
      targetToInactiveValues
    ),


  targetIdentity: {

    comparable:
      targetIdentityComparable.length,

    sameAsCredited:
      targetSameAsCredited.length,

    sameAsCreditedRate:
      rate(
        targetSameAsCredited.length,
        targetIdentityComparable.length
      ),

    differentSameTeam:
      targetDifferentSameTeam.length,

    differentSameTeamRate:
      rate(
        targetDifferentSameTeam.length,
        targetIdentityComparable.length
      ),

    differentTeam:
      targetDifferentTeam.length,

    differentTeamRate:
      rate(
        targetDifferentTeam.length,
        targetIdentityComparable.length
      )
  },


  cleanTargetlessTermination: {

    noPlayerTarget:
      cleanNoTarget.length,

    inactive:
      cleanTargetlessInactive.length,

    fortySecondCandidates:
      cleanExpiration40.length,

    fortySecondRate:
      rate(
        cleanExpiration40.length,
        cleanTargetlessInactive.length
      ),

    non40Second:
      cleanTargetlessNon40.length,

    non40SecondCases:
      cleanTargetlessNon40
  },


  interpretation: {

    fortyFiveMeters:
      '45m is decisively too broad to identify the actual m_hVacuumTarget acquisition boundary; delayed target-onset distances occupy a much tighter envelope.',

    thresholdSearch:
      'The clean delayed cohort is used to estimate a candidate target-acquisition boundary. This remains an empirical envelope, not a canonical engine constant.',

    crossingIntervals:
      'For a delayed transition with previous distance > onset distance, any threshold T satisfying onset <= T < previous would produce an exact previous-outside/onset-inside crossing. The interval-overlap search identifies thresholds supported by the largest number of such one-tick boundary pairs.',

    immediateOutliers:
      'Immediate target assignment is analyzed separately because activation timing or other lifecycle effects can produce onset geometry that does not reflect an approach crossing.',

    expiration:
      'Targetless 40-second termination remains a strong expiration candidate. Non-40-second targetless cases must be resolved before canonicalization.'
  },


  validation: {

    pass:
      validationPass,

    checks:
      validationChecks
  }
};


writeFileSync(
  outputSummaryPath,
  JSON.stringify(
    output,
    null,
    2
  ),
  'utf8'
);


// ============================================================
// CASE STREAM
// ============================================================

const caseRows = [

  ...cleanOnsetOver800.map(
    row => ({

      category:
        'CLEAN_TARGET_ONSET_OVER_800_HU',

      ...row
    })
  ),


  ...cleanTargetlessNon40.map(
    row => ({

      category:
        'CLEAN_TARGETLESS_NON40_TERMINATION',

      ...row
    })
  ),


  ...boundaryLikePairs
    .slice()
    .sort(
      (
        a,
        b
      ) => {

        const aPrior =
          finite(
            a
              ?.vacuum
              ?.targetGeometry
              ?.distanceBeforeOnset3D
          );


        const aOnset =
          finite(
            a
              ?.vacuum
              ?.targetGeometry
              ?.distanceAtOnset3D
          );


        const bPrior =
          finite(
            b
              ?.vacuum
              ?.targetGeometry
              ?.distanceBeforeOnset3D
          );


        const bOnset =
          finite(
            b
              ?.vacuum
              ?.targetGeometry
              ?.distanceAtOnset3D
          );


        return (
          aPrior -
          aOnset
        )
        -
        (
          bPrior -
          bOnset
        );
      }
    )
    .slice(
      0,
      100
    )
    .map(
      row => ({

        category:
          'CLEAN_DELAYED_BOUNDARY_LIKE_PAIR',

        ...compactTransition(
          row
        )
      })
    )
];


await writeJsonl(
  outputCasesPath,
  caseRows
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD CLEAN VACUUM THRESHOLD AUDIT V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'SCRIPT 76 CLOSURE'
);

console.log(
  '-----------------'
);

console.log(
  `Failed checks:              ${JSON.stringify(failed76Checks)}`
);

console.log(
  `Raw snapshots:              ${rawSnapshotCount}`
);

console.log(
  `Pre-activation padding:     ${preActivationSnapshotCount}`
);

console.log(
  `Post-activation snapshots:  ${postActivationSnapshotCount}`
);

console.log(
  `Script76 analyzed sum:      ${script76EpisodeSnapshotSum}`
);

console.log(
  `Failure fully explained:    ${snapshotFailureExplained}`
);


console.log('');

console.log(
  'CLEAN COHORT'
);

console.log(
  '------------'
);

console.log(
  `Clean credited episodes:      ${clean.length}`
);

console.log(
  `Null -> player transitions:   ${cleanTransitions.length}`
);

console.log(
  `No player target:             ${cleanNoTarget.length}`
);

console.log(
  `Other target states:          ${cleanOtherTargetState.length}`
);

console.log(
  `Geometry resolved:            ${cleanGeometryResolved.length}`
);

console.log(
  `Immediate <=0.25s:            ${cleanImmediate.length}`
);

console.log(
  `Delayed >0.25s:               ${cleanDelayed.length}`
);

console.log(
  `Delayed comparable:           ${delayedComparable.length}`
);

console.log(
  `Boundary-like pairs <=${BOUNDARY_PAIR_MAX_STEP_HU} HU: ${boundaryLikePairs.length}`
);


console.log('');

console.log(
  'CLEAN TARGET-ONSET DISTANCE'
);

console.log(
  '---------------------------'
);

console.log(
  `All:       ${formatDistribution(allSummary)}`
);

console.log(
  `Immediate: ${formatDistribution(immediateSummary)}`
);

console.log(
  `Delayed:   ${formatDistribution(delayedSummary)}`
);

console.log(
  `Prior:     ${formatDistribution(delayedPriorSummary)}`
);

console.log(
  `95% delayed containment: ${formatThreshold(delayedMinimum95)}`
);

console.log(
  `99% delayed containment: ${formatThreshold(delayedMinimum99)}`
);

console.log(
  `100% delayed containment:${formatThreshold(delayedMinimum100)}`
);


console.log('');

console.log(
  'BEST THRESHOLD CROSSING FITS'
);

console.log(
  '----------------------------'
);

console.log(
  `Overall:       ${formatThresholdRow(bestOverallCrossing)}`
);

console.log(
  `Boundary-like: ${formatThresholdRow(bestBoundaryLikeCrossing)}`
);


console.log('');

console.log(
  'TOP BOUNDARY-LIKE THRESHOLDS'
);

console.log(
  '----------------------------'
);


for (
  const row
  of topBoundaryThresholds.slice(
    0,
    15
  )
) {

  console.log(

    `${String(row.thresholdHU).padStart(4)} HU ` +

    `(${row.thresholdMeters.toFixed(2)}m) ` +

    `boundaryCross=${String(row.boundaryLikeCrossing).padStart(4)}/${row.boundaryLikePairs} ` +

    `allCross=${String(row.exactCrossing).padStart(4)}/${row.comparable} ` +

    `onsetOutside=${row.onsetOutside}`
  );
}


console.log('');

console.log(
  'CLEAN ONSET >800 HU'
);

console.log(
  '-------------------'
);


if (
  cleanOnsetOver800.length ===
  0
) {

  console.log(
    'None.'
  );

} else {

  for (
    const row
    of cleanOnsetOver800
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)}  ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `delay=${formatNumber(row.targetDelaySeconds)} ` +

      `onset=${formatNumber(row.distanceAtOnset3D)} ` +

      `prior=${formatNumber(row.distanceBeforeOnset3D)} ` +

      `target=${row.targetPlayerName ?? 'NONE'}`
    );
  }
}


console.log('');

console.log(
  'TARGET -> INACTIVE'
);

console.log(
  '------------------'
);

console.log(
  formatDistribution(
    summarizeNumbers(
      targetToInactiveValues
    )
  )
);


console.log('');

console.log(
  'TARGET IDENTITY — CLEAN COHORT'
);

console.log(
  '------------------------------'
);

console.log(
  `Same credited player: ${targetSameAsCredited.length}/${targetIdentityComparable.length} = ${formatPercent(rate(targetSameAsCredited.length, targetIdentityComparable.length))}`
);

console.log(
  `Different same-team:  ${targetDifferentSameTeam.length}/${targetIdentityComparable.length} = ${formatPercent(rate(targetDifferentSameTeam.length, targetIdentityComparable.length))}`
);

console.log(
  `Different team:       ${targetDifferentTeam.length}/${targetIdentityComparable.length} = ${formatPercent(rate(targetDifferentTeam.length, targetIdentityComparable.length))}`
);


console.log('');

console.log(
  'CLEAN TARGETLESS TERMINATION'
);

console.log(
  '----------------------------'
);

console.log(
  `No target:             ${cleanNoTarget.length}`
);

console.log(
  `Inactive observed:     ${cleanTargetlessInactive.length}`
);

console.log(
  `~40s candidates:       ${cleanExpiration40.length}/${cleanTargetlessInactive.length} = ${formatPercent(rate(cleanExpiration40.length, cleanTargetlessInactive.length))}`
);

console.log(
  `Non-40s:               ${cleanTargetlessNon40.length}`
);


if (
  cleanTargetlessNon40.length >
  0
) {

  console.log('');

  console.log(
    'CLEAN NON-40S TARGETLESS CASES'
  );

  console.log(
    '------------------------------'
  );


  for (
    const row
    of cleanTargetlessNon40
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)}  ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `credit=${String(row.creditedPlayerName ?? 'NONE').padEnd(24)} ` +

      `band=${String(row.distanceBand ?? 'UNKNOWN').padEnd(19)} ` +

      `dist=${formatNumber(row.creditedDistanceAtDeath3D)} ` +

      `duration=${formatNumber(row.durationSeconds)}`
    );
  }
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
    validationChecks
  )
) {

  console.log(

    `${row.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(48)} ` +

    `actual=${JSON.stringify(row.actual)} ` +

    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');

console.log(
  `OVERALL AUDIT: ${validationPass ? 'PASS' : 'FAIL'}`
);

console.log('');

console.log(
  `Summary:\n${outputSummaryPath}`
);

console.log('');

console.log(
  `Cases:\n${outputCasesPath}`
);

console.log('');


// ============================================================
// HELPERS
// ============================================================

function compactTransition(
  row
) {

  return {

    deathIndex:
      finite(
        row?.deathIndex
      ),

    clock:
      row?.clock ??
      null,

    baseType:
      row?.baseType ??
      null,

    creditedPlayerName:
      row
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedPlayerTeam:
      finite(
        row
          ?.creditedPlayer
          ?.team
      ),

    targetPlayerName:
      row
        ?.vacuum
        ?.targetPlayerName ??
      null,

    targetPlayerTeam:
      finite(
        row
          ?.vacuum
          ?.targetPlayerTeam
      ),

    targetDelaySeconds:
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      ),

    distanceAtOnset3D:
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnset3D
      ),

    distanceAtOnsetXY:
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnsetXY
      ),

    distanceBeforeOnset3D:
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceBeforeOnset3D
      ),

    distanceBeforeOnsetXY:
      finite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceBeforeOnsetXY
      ),

    targetToInactiveSeconds:
      finite(
        row
          ?.vacuum
          ?.targetToInactiveSeconds
      ),

    durationSeconds:
      finite(
        row
          ?.termination
          ?.durationSeconds
      )
  };
}


function compactTargetless(
  row
) {

  return {

    deathIndex:
      finite(
        row?.deathIndex
      ),

    clock:
      row?.clock ??
      null,

    baseType:
      row?.baseType ??
      null,

    creditedPlayerName:
      row
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedPlayerTeam:
      finite(
        row
          ?.creditedPlayer
          ?.team
      ),

    distanceBand:
      row
        ?.creditedPlayer
        ?.distanceBand ??
      null,

    creditedDistanceAtDeath3D:
      finite(
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
      ),

    durationSeconds:
      finite(
        row
          ?.termination
          ?.durationSeconds
      ),

    activeFalseObserved:
      row
        ?.termination
        ?.activeFalseObserved ===
      true,

    endReason:
      row
        ?.termination
        ?.endReason ??
      null
  };
}


function minimumThresholdForCoverage(
  source,
  coverage
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

    return null;
  }


  const index =
    Math.max(
      0,
      Math.ceil(
        clean.length *
        coverage
      ) -
      1
    );


  const thresholdHU =
    clean[index];


  return {

    coverage,

    thresholdHU,

    thresholdMeters:
      thresholdHU /
      HU_PER_METER,

    supported:
      index +
      1,

    total:
      clean.length
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


async function writeJsonl(
  path,
  rows
) {

  const content =
    rows
      .map(
        row =>
          JSON.stringify(
            row
          )
      )
      .join(
        '\n'
      );


  writeFileSync(
    path,
    content.length >
      0
      ? `${content}\n`
      : '',
    'utf8'
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


function values(
  rows,
  selector
) {

  return rows
    .map(
      row =>
        finite(
          selector(
            row
          )
        )
    )
    .filter(
      Number.isFinite
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

      p99:
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

    p99:
      quantile(
        clean,
        0.99
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
      ) /
      clean.length
  };
}


function quantile(
  sorted,
  q
) {

  if (
    !Array.isArray(
      sorted
    )
    ||
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


  return (
    sorted[lower] *
      (
        1 -
        weight
      )
    +
    sorted[upper] *
      weight
  );
}


function check(
  actual,
  expected,
  pass
) {

  return {

    actual,

    expected,

    pass:
      Boolean(
        pass
      )
  };
}


function formatNumber(
  value
) {

  return Number.isFinite(
    value
  )
    ? Number(
      value.toFixed(
        3
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
    ).toFixed(2)}%`
    : 'n/a';
}


function formatMeters(
  hu
) {

  return Number.isFinite(
    hu
  )
    ? (
      hu /
      HU_PER_METER
    ).toFixed(
      2
    )
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
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}


function formatThreshold(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (
    `${formatNumber(row.thresholdHU)} HU ` +
    `(${formatMeters(row.thresholdHU)}m) ` +
    `${row.supported}/${row.total}`
  );
}


function formatThresholdRow(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (
    `${row.thresholdHU} HU (${row.thresholdMeters.toFixed(2)}m) ` +
    `exactCross=${row.exactCrossing}/${row.comparable} ` +
    `boundaryCross=${row.boundaryLikeCrossing}/${row.boundaryLikePairs} ` +
    `onsetOutside=${row.onsetOutside}`
  );
}