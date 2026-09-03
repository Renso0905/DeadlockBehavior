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

import {
  Parser,
  InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const HU_PER_METER =
  39.37;


const FLOOR_CANDIDATE_HU =
  735;


const ROUGH_45M_HU =
  45 *
  HU_PER_METER;


const IMMEDIATE_SECONDS =
  0.25;


const STABLE_SECONDS =
  1.0;


// ============================================================
// THRESHOLD SEARCH
//
// Exact raw death-tick geometry is used here.
//
// We still treat the resulting threshold empirically rather
// than as an engine constant.
// ============================================================

const SEARCH_MIN_HU =
  400;


const SEARCH_MAX_HU =
  2200;


const SEARCH_STEP_HU =
  1;


const STANDARD_THRESHOLDS = [
  600,
  700,
  720,
  729,
  735,
  740,
  750,
  768,
  800,
  809,
  850,
  900,
  1000,
  1200,
  1500,
  1772,
  2000
];


// ============================================================
// PURPOSE
//
// Script 82 showed a strong relationship between:
//
//   credited last-hitter distance at death
//            ↓
//   m_hVacuumTarget appearing <1 second later
//
// But Script 82 used 4-Hz reconstructed credited-player
// positions.
//
// Script 83 upgrades that analysis to RAW replay geometry at the
// exact Trooper-death tick.
//
// It also tests an important alternative:
//
//   perhaps ANY living allied player can satisfy the initial
//   proximity condition.
//
// Therefore we compare:
//
//   1. credited last-hitter distance
//   2. nearest living allied player distance
//   3. nearest living OTHER ally distance
//   4. eventual vacuum-target player's distance at death
//
// This keeps:
//
//   last-hit attribution
//
// distinct from:
//
//   vacuum-trigger eligibility.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const summary82Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_credit_distance_vacuum_regimes_diagnostic_v01.json'
  );


const cases82Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_credit_distance_vacuum_regimes_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_death_team_geometry_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_death_team_geometry_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    episodes75Path,
    summary82Path,
    cases82Path
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
// PRIOR SUMMARY
// ============================================================

const summary82 =
  JSON.parse(
    readFileSync(
      summary82Path,
      'utf8'
    )
  );


if (
  summary82
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 82 did not PASS.'
  );
}


// ============================================================
// SCRIPT 75 DEATH DATA
// ============================================================

console.log('');

console.log(
  'Loading Script 75 lifecycle episodes...'
);


const episodes75 =
  await loadJsonl(
    episodes75Path
  );


console.log(
  `Script 75 episodes: ${episodes75.length}`
);


const episode75ByDeathIndex =
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


  if (
    deathIndex !==
    null
  ) {

    episode75ByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// SCRIPT 82 CASES
// ============================================================

console.log(
  'Loading Script 82 clean credited cases...'
);


const cases82 =
  await loadJsonl(
    cases82Path
  );


console.log(
  `Script 82 cases: ${cases82.length}`
);


// ============================================================
// BUILD RAW-SCAN CASES
// ============================================================

const cases =
  [];


for (
  const source
  of cases82
) {

  const deathIndex =
    finite(
      source?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const episode75 =
    episode75ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  if (
    !episode75
  ) {

    continue;
  }


  const deathTick =
    finite(
      episode75
        ?.death
        ?.tick
    );


  const deathPosition =
    normalizePosition(
      episode75
        ?.death
        ?.position
    );


  const creditedPlayerName =
    source
      ?.creditedPlayer
      ?.playerName ??
    null;


  const creditedPlayerTeam =
    finite(
      source
        ?.creditedPlayer
        ?.team
    );


  const creditedControllerEntityIndex =
    finite(
      source
        ?.creditedPlayer
        ?.controllerEntityIndex
    );


  if (
    deathTick ===
      null
    ||
    !deathPosition
    ||
    !creditedPlayerName
    ||
    creditedPlayerTeam ===
      null
  ) {

    continue;
  }


  cases.push({

    caseIndex:
      cases.length,

    deathIndex,

    clock:
      source?.clock ??
      episode75
        ?.death
        ?.clock ??
      null,

    baseType:
      source?.baseType ??
      episode75
        ?.death
        ?.baseType ??
      null,

    deathTick,

    deathPosition,

    lifecycleBand:
      source?.lifecycleBand ??
      null,

    targetDelaySeconds:
      finite(
        source
          ?.vacuumTarget
          ?.targetDelaySeconds
      ),

    creditedPlayerName,

    creditedPlayerTeam,

    creditedControllerEntityIndex,

    eventualTargetPlayerName:
      source
        ?.vacuumTarget
        ?.targetPlayerName ??
      null,

    eventualTargetPlayerTeam:
      finite(
        source
          ?.vacuumTarget
          ?.targetPlayerTeam
      ),

    targetIdentityRelation:
      source
        ?.vacuumTarget
        ?.targetIdentityRelation ??
      null,

    approximate4Hz: {

      creditedDistanceXY:
        finite(
          source
            ?.creditedPlayer
            ?.distanceAtDeathXY
        ),

      creditedDistance3D:
        finite(
          source
            ?.creditedPlayer
            ?.distanceAtDeath3D
        )
    },

    captures:
      [],

    selectedCapture:
      null,

    exactGeometry:
      null
  });
}


console.log(
  `Joined clean cases: ${cases.length}`
);


// ============================================================
// INDEX REQUESTED DEATH TICKS
// ============================================================

const needsByTick =
  new Map();


for (
  const row
  of cases
) {

  if (
    !needsByTick.has(
      row.deathTick
    )
  ) {

    needsByTick.set(
      row.deathTick,
      []
    );
  }


  needsByTick
    .get(
      row.deathTick
    )
    .push(
      row.caseIndex
    );
}


console.log(
  `Requested unique death ticks: ${needsByTick.size}`
);


// ============================================================
// RAW REPLAY SCAN
// ============================================================

let requestedPacketHits =
  0;


const uniqueRequestedTicksSeen =
  new Set();


let playerRowsCaptured =
  0;


const parser =
  new Parser();


parser.registerPostInterceptor(

  InterceptorStage.DEMO_PACKET,

  demoPacket => {

    const tick =
      finite(
        demoPacket?.tick
      );


    if (
      tick ===
      null
    ) {

      return;
    }


    const caseIndexes =
      needsByTick.get(
        tick
      );


    if (
      !caseIndexes
    ) {

      return;
    }


    requestedPacketHits++;


    uniqueRequestedTicksSeen.add(
      tick
    );


    const demo =
      parser.getDemo();


    const controllers =
      demo.getEntitiesByClassName(
        'CCitadelPlayerController'
      )
      ??
      [];


    const players =
      [];


    for (
      const controller
      of controllers
    ) {

      const playerName =
        safeGetField(
          controller,
          'm_iszPlayerName'
        );


      if (
        !playerName
        ||
        playerName ===
        'SourceTV'
      ) {

        continue;
      }


      const controllerEntityIndex =
        getEntityIndex(
          controller
        );


      const team =
        finite(
          safeGetField(
            controller,
            'm_iTeamNum'
          )
        );


      const alive =
        booleanOrNull(
          safeGetField(
            controller,
            'm_bAlive'
          )
        );


      let pawnHandle =
        safeGetField(
          controller,
          'm_hHeroPawn'
        );


      if (
        isInvalidHandle(
          pawnHandle
        )
      ) {

        pawnHandle =
          safeGetField(
            controller,
            'm_hPawn'
          );
      }


      let pawn =
        null;


      if (
        !isInvalidHandle(
          pawnHandle
        )
      ) {

        try {

          pawn =
            demo.getEntityByHandle(
              pawnHandle
            );

        } catch {

          pawn =
            null;
        }
      }


      const pawnEntityIndex =
        pawn
          ? getEntityIndex(
            pawn
          )
          : null;


      const position =
        pawn
          ? getWorldPositionDetailed(
            pawn
          )
          : null;


      const lifeState =
        pawn
          ? finite(
            safeGetField(
              pawn,
              'm_lifeState'
            )
          )
          : null;


      const eligibleLivingPawn =
        position !==
          null
        &&
        alive ===
          true
        &&
        lifeState ===
          0;


      players.push({

        controllerEntityIndex,

        playerName:
          String(
            playerName
          ),

        team,

        alive,

        pawnEntityIndex,

        lifeState,

        eligibleLivingPawn,

        position
      });


      playerRowsCaptured++;
    }


    for (
      const caseIndex
      of caseIndexes
    ) {

      const row =
        cases[
          caseIndex
        ];


      row.captures.push({

        tick,

        players
      });
    }
  }
);


console.log('');

console.log(
  'Rescanning exact raw player geometry at Trooper-death ticks...'
);

console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// SELECT SAME-TICK CAPTURES
//
// Duplicate DEMO_PACKET observations can share a tick.
//
// Prefer a capture where:
//
//   - credited player resolves
//   - credited pawn position resolves
//
// otherwise use the final capture.
// ============================================================

for (
  const row
  of cases
) {

  row.selectedCapture =
    selectCapture(
      row
    );


  row.exactGeometry =
    analyzeCapture(
      row
    );
}


// ============================================================
// COVERAGE
// ============================================================

const selectedCases =
  cases.filter(
    row =>
      row.selectedCapture !==
      null
  );


const creditedXYResolved =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.exactGeometry
          ?.creditedPlayer
          ?.distanceXY
      )
  );


const credited3DResolved =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.exactGeometry
          ?.creditedPlayer
          ?.distance3D
      )
  );


const nearestAllyXYResolved =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.exactGeometry
          ?.nearestEligibleAlly
          ?.distanceXY
      )
  );


const nearestAlly3DResolved =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.exactGeometry
          ?.nearestEligibleAlly
          ?.distance3D
      )
  );


const eventualTargetDeathXYResolved =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.exactGeometry
          ?.eventualTargetPlayer
          ?.distanceXY
      )
  );


// ============================================================
// RAW VS 4-HZ CREDITED GEOMETRY
// ============================================================

const rawMinus4HzXY =
  cases
    .map(
      row => {

        const raw =
          finite(
            row
              ?.exactGeometry
              ?.creditedPlayer
              ?.distanceXY
          );


        const reconstructed =
          finite(
            row
              ?.approximate4Hz
              ?.creditedDistanceXY
          );


        return (
          raw !==
            null
          &&
          reconstructed !==
            null
        )
          ? raw -
            reconstructed
          : null;
      }
    )
    .filter(
      Number.isFinite
    );


const rawMinus4Hz3D =
  cases
    .map(
      row => {

        const raw =
          finite(
            row
              ?.exactGeometry
              ?.creditedPlayer
              ?.distance3D
          );


        const reconstructed =
          finite(
            row
              ?.approximate4Hz
              ?.creditedDistance3D
          );


        return (
          raw !==
            null
          &&
          reconstructed !==
            null
        )
          ? raw -
            reconstructed
          : null;
      }
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// LIFECYCLE COHORTS
// ============================================================

const cohorts =
  {

    ALL:
      cases,


    TARGET_IMMEDIATE_LE_0_25:
      cases.filter(
        row =>
          row.lifecycleBand ===
          'TARGET_IMMEDIATE_LE_0_25'
      ),


    TARGET_EARLY_GT_0_25_LT_1:
      cases.filter(
        row =>
          row.lifecycleBand ===
          'TARGET_EARLY_GT_0_25_LT_1'
      ),


    TARGET_STABLE_GE_1:
      cases.filter(
        row =>
          row.lifecycleBand ===
          'TARGET_STABLE_GE_1'
      ),


    NO_PLAYER_TARGET:
      cases.filter(
        row =>
          row.lifecycleBand ===
          'NO_PLAYER_TARGET'
      )
  };


// ============================================================
// METRIC DEFINITIONS
// ============================================================

const metrics =
  {

    CREDITED_XY:
      row =>
        row
          ?.exactGeometry
          ?.creditedPlayer
          ?.distanceXY,


    CREDITED_3D:
      row =>
        row
          ?.exactGeometry
          ?.creditedPlayer
          ?.distance3D,


    NEAREST_ALLY_XY:
      row =>
        row
          ?.exactGeometry
          ?.nearestEligibleAlly
          ?.distanceXY,


    NEAREST_ALLY_3D:
      row =>
        row
          ?.exactGeometry
          ?.nearestEligibleAlly
          ?.distance3D,


    NEAREST_OTHER_ALLY_XY:
      row =>
        row
          ?.exactGeometry
          ?.nearestEligibleOtherAlly
          ?.distanceXY,


    EVENTUAL_TARGET_AT_DEATH_XY:
      row =>
        row
          ?.exactGeometry
          ?.eventualTargetPlayer
          ?.distanceXY
  };


// ============================================================
// COHORT SUMMARIES
// ============================================================

const cohortSummaries =
  {};


for (
  const [
    cohortName,
    rows
  ]
  of Object.entries(
    cohorts
  )
) {

  const metricSummaries =
    {};


  for (
    const [
      metricName,
      selector
    ]
    of Object.entries(
      metrics
    )
  ) {

    metricSummaries[
      metricName
    ] =
      summarizeDistanceMetric(
        rows,
        selector
      );
  }


  cohortSummaries[
    cohortName
  ] =
    {

      count:
        rows.length,

      metrics:
        metricSummaries,

      nearestAllyIsCredited:
        rows.filter(
          row =>
            row
              ?.exactGeometry
              ?.nearestEligibleAlly
              ?.isCreditedPlayer ===
            true
        ).length,

      nearestAllyIsEventualTarget:
        rows.filter(
          row =>
            row
              ?.exactGeometry
              ?.nearestEligibleAlly
              ?.isEventualTarget ===
            true
        ).length
    };
}


// ============================================================
// BINARY OUTCOME DEFINITIONS
// ============================================================

const targetUnder1Second =
  row =>
    row.lifecycleBand ===
      'TARGET_IMMEDIATE_LE_0_25'
    ||
    row.lifecycleBand ===
      'TARGET_EARLY_GT_0_25_LT_1';


const targetImmediate =
  row =>
    row.lifecycleBand ===
    'TARGET_IMMEDIATE_LE_0_25';


// ============================================================
// CLASSIFIER SEARCHES
// ============================================================

const classifierResults =
  {};


for (
  const metricName
  of [
    'CREDITED_XY',
    'CREDITED_3D',
    'NEAREST_ALLY_XY',
    'NEAREST_ALLY_3D'
  ]
) {

  const selector =
    metrics[
      metricName
    ];


  const under1Rows =
    buildThresholdSearch(
      cases,
      selector,
      targetUnder1Second
    );


  const immediateRows =
    buildThresholdSearch(
      cases,
      selector,
      targetImmediate
    );


  classifierResults[
    metricName
  ] =
    {

      targetUnder1Second: {

        bestMCC:
          selectBest(
            under1Rows,
            'mcc'
          ),

        bestBalancedAccuracy:
          selectBest(
            under1Rows,
            'balancedAccuracy'
          ),

        standardThresholds:
          selectStandardRows(
            under1Rows
          ),

        allThresholds:
          under1Rows
      },


      targetImmediateQuarterSecond: {

        bestMCC:
          selectBest(
            immediateRows,
            'mcc'
          ),

        bestBalancedAccuracy:
          selectBest(
            immediateRows,
            'balancedAccuracy'
          ),

        standardThresholds:
          selectStandardRows(
            immediateRows
          ),

        allThresholds:
          immediateRows
      }
    };
}


// ============================================================
// DISTANCE BAND OUTCOMES
// ============================================================

const distanceBands =
  [

    {
      name:
        'LE_735',
      min:
        -Infinity,
      max:
        735
    },

    {
      name:
        'GT_735_LE_800',
      min:
        735,
      max:
        800
    },

    {
      name:
        'GT_800_LE_1000',
      min:
        800,
      max:
        1000
    },

    {
      name:
        'GT_1000_LE_1200',
      min:
        1000,
      max:
        1200
    },

    {
      name:
        'GT_1200_LE_1500',
      min:
        1200,
      max:
        1500
    },

    {
      name:
        'GT_1500_LE_ROUGH45M',
      min:
        1500,
      max:
        ROUGH_45M_HU
    },

    {
      name:
        'GT_ROUGH45M',
      min:
        ROUGH_45M_HU,
      max:
        Infinity
    }
  ];


const creditedBandOutcomes =
  buildBandOutcomes(
    cases,
    metrics.CREDITED_XY
  );


const nearestAllyBandOutcomes =
  buildBandOutcomes(
    cases,
    metrics.NEAREST_ALLY_XY
  );


// ============================================================
// FAR CREDIT / CLOSE ALLY CASES
//
// Especially useful for explaining apparent false negatives
// when credited-player distance is used alone.
// ============================================================

const creditedOutside735NearestAllyInside735 =
  cases.filter(
    row => {

      const credit =
        finite(
          metrics.CREDITED_XY(
            row
          )
        );


      const nearest =
        finite(
          metrics.NEAREST_ALLY_XY(
            row
          )
        );


      return (
        credit !==
          null
        &&
        nearest !==
          null
        &&
        credit >
          FLOOR_CANDIDATE_HU
        &&
        nearest <=
          FLOOR_CANDIDATE_HU
      );
    }
  );


const under1CreditOutside735NearestInside735 =
  creditedOutside735NearestAllyInside735.filter(
    targetUnder1Second
  );


// ============================================================
// EVENTUAL-TARGET RELATIONS
// ============================================================

const transitionCases =
  cases.filter(
    row =>
      Boolean(
        row.eventualTargetPlayerName
      )
  );


const eventualTargetIsNearestAtDeath =
  transitionCases.filter(
    row =>
      row
        ?.exactGeometry
        ?.nearestEligibleAlly
        ?.isEventualTarget ===
      true
  );


const creditedIsNearestAtDeath =
  cases.filter(
    row =>
      row
        ?.exactGeometry
        ?.nearestEligibleAlly
        ?.isCreditedPlayer ===
      true
  );


// ============================================================
// VALIDATION
// ============================================================

const uniqueTickCoverage =
  uniqueRequestedTicksSeen.size ===
  needsByTick.size;


const duplicatePacketHits =
  requestedPacketHits -
  uniqueRequestedTicksSeen.size;


const transitionCount =
  cases.filter(
    row =>
      Boolean(
        row.eventualTargetPlayerName
      )
  ).length;


const noTargetCount =
  cohorts
    .NO_PLAYER_TARGET
    .length;


const validationChecks =
  {

    script82Passed:
      check(
        summary82
          ?.validation
          ?.pass,
        true,
        summary82
          ?.validation
          ?.pass ===
        true
      ),


    cleanCaseCount:
      check(
        cases.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? cases.length ===
            991
          : cases.length >
            0
      ),


    script75JoinComplete:
      check(
        cases.length,
        cases82.length,
        cases.length ===
        cases82.length
      ),


    requestedUniqueTicksCovered:
      check(
        uniqueRequestedTicksSeen.size,
        needsByTick.size,
        uniqueTickCoverage
      ),


    captureCoverage:
      check(
        selectedCases.length,
        cases.length,
        selectedCases.length ===
        cases.length
      ),


    creditedRawXYCoverage:
      check(
        creditedXYResolved.length,
        '>=99% of clean cases',
        rate(
          creditedXYResolved.length,
          cases.length
        ) >=
        0.99
      ),


    creditedRaw3DCoverage:
      check(
        credited3DResolved.length,
        '>=99% of clean cases',
        rate(
          credited3DResolved.length,
          cases.length
        ) >=
        0.99
      ),


    nearestAllyXYCoverage:
      check(
        nearestAllyXYResolved.length,
        '>=99% of clean cases',
        rate(
          nearestAllyXYResolved.length,
          cases.length
        ) >=
        0.99
      ),


    nearestAlly3DCoverage:
      check(
        nearestAlly3DResolved.length,
        '>=99% of clean cases',
        rate(
          nearestAlly3DResolved.length,
          cases.length
        ) >=
        0.99
      ),


    targetTransitionCount:
      check(
        transitionCount,
        replayName ===
          'test'
          ? 947
          : '>0',
        replayName ===
          'test'
          ? transitionCount ===
            947
          : transitionCount >
            0
      ),


    noTargetCount:
      check(
        noTargetCount,
        replayName ===
          'test'
          ? 44
          : '>=0',
        replayName ===
          'test'
          ? noTargetCount ===
            44
          : noTargetCount >=
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
// SUMMARY
// ============================================================

const summary =
  {

    replay:
      replayName,

    version:
      'ASSIGNED_GOLD_EXACT_DEATH_TEAM_GEOMETRY_VALIDATION_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'EXACT_DEATH_TEAM_GEOMETRY_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Replace Script82 4-Hz credited-player death geometry with raw pawn positions at the exact Trooper-death tick.',

        'Compare credited last-hitter distance with nearest living allied-player distance.',

        'Determine whether early AssignedGold target acquisition is better predicted by last-hitter proximity or by any eligible allied player being nearby.',

        'Compare the resulting proximity scale with the previously observed ~735-HU stable-floor target-acquisition envelope.'
      ],


    semanticLimits:
      {

        outcome:
          'm_hVacuumTarget appearing <1 second remains an operational lifecycle outcome, not a direct engine vacuum-start event.',

        nearestAlly:
          'Nearest allied player is restricted to controller alive=true, pawn lifeState=0, and valid raw pawn position at the sampled death tick.',

        radius:
          'A classifier threshold is empirical. It must not automatically be promoted to an exact engine radius.',

        rough45m:
          'The ~45m value is retained only as a rough gameplay recollection and comparison scale, not a validation target.'
      },


    sourceCounts:
      {

        cleanCases:
          cases.length,

        requestedUniqueDeathTicks:
          needsByTick.size,

        rawRequestedPacketHits:
          requestedPacketHits,

        uniqueRequestedTicksSeen:
          uniqueRequestedTicksSeen.size,

        duplicatePacketHits,

        playerRowsCaptured,

        creditedXYResolved:
          creditedXYResolved.length,

        credited3DResolved:
          credited3DResolved.length,

        nearestAllyXYResolved:
          nearestAllyXYResolved.length,

        nearestAlly3DResolved:
          nearestAlly3DResolved.length,

        eventualTargetAtDeathXYResolved:
          eventualTargetDeathXYResolved.length
      },


    rawVs4HzCreditedGeometry:
      {

        xyRawMinusReconstructed:
          summarizeNumbers(
            rawMinus4HzXY
          ),

        threeDRawMinusReconstructed:
          summarizeNumbers(
            rawMinus4Hz3D
          )
      },


    lifecycleCohorts:
      cohortSummaries,


    classifiers:
      classifierResults,


    distanceBandOutcomes:
      {

        creditedPlayerXY:
          creditedBandOutcomes,

        nearestEligibleAllyXY:
          nearestAllyBandOutcomes
      },


    alliedProximityRelations:
      {

        creditedOutside735ButNearestAllyInside735:
          creditedOutside735NearestAllyInside735.length,

        under1SecondAmongThoseCases:
          under1CreditOutside735NearestInside735.length,

        under1SecondRate:
          rate(
            under1CreditOutside735NearestInside735.length,
            creditedOutside735NearestAllyInside735.length
          ),

        creditedPlayerIsNearestEligibleAlly:
          creditedIsNearestAtDeath.length,

        creditedPlayerIsNearestEligibleAllyRate:
          rate(
            creditedIsNearestAtDeath.length,
            cases.length
          ),

        eventualTargetIsNearestEligibleAllyAtDeath:
          eventualTargetIsNearestAtDeath.length,

        eventualTargetIsNearestEligibleAllyAtDeathRate:
          rate(
            eventualTargetIsNearestAtDeath.length,
            transitionCases.length
          )
      },


    interpretationGuide:
      {

        creditedBetter:
          'If exact credited-player distance remains substantially more predictive than nearest-allied distance, the last-hitter may have privileged initial-vacuum relevance.',

        nearestAllyBetter:
          'If nearest eligible ally distance markedly improves classification, initial vacuum eligibility is more consistent with a team-level proximity condition rather than last-hitter-only proximity.',

        commonScale:
          'If the strongest exact raw threshold is again near the ~735-HU stable-floor envelope, a common proximity scale becomes substantially more plausible.',

        broadScale:
          'If exact raw geometry instead supports a materially larger threshold, initial post-kill vacuum and stable floor pickup may be distinct proximity regimes.',

        timingCaution:
          'Poor prediction of the <=0.25-second field transition does not by itself reject a distance mechanic because m_hVacuumTarget may be populated downstream of the actual trigger.'
      },


    validation:
      {

        pass:
          validationPass,

        checks:
          validationChecks
      },


    outputs:
      {

        summary:
          outputSummaryPath,

        cases:
          outputCasesPath
      }
  };


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    outputSummaryPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputSummaryPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


await writeJsonl(
  outputCasesPath,
  cases.map(
    compactCase
  )
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD EXACT DEATH TEAM GEOMETRY V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// COVERAGE
// ============================================================

console.log('');

console.log(
  'RAW GEOMETRY COVERAGE'
);

console.log(
  '---------------------'
);


console.log(
  `Clean cases:               ${cases.length}`
);


console.log(
  `Unique death ticks:        ${needsByTick.size}`
);


console.log(
  `Raw packet hits:           ${requestedPacketHits}`
);


console.log(
  `Duplicate packet hits:     ${duplicatePacketHits}`
);


console.log(
  `Credited XY resolved:      ${creditedXYResolved.length}/${cases.length}`
);


console.log(
  `Nearest ally XY resolved:  ${nearestAllyXYResolved.length}/${cases.length}`
);


// ============================================================
// RAW VS 4 HZ
// ============================================================

console.log('');

console.log(
  'RAW EXACT MINUS 4HZ CREDITED DISTANCE'
);

console.log(
  '--------------------------------------'
);


console.log(
  `XY: ${formatDistribution(
    summarizeNumbers(
      rawMinus4HzXY
    )
  )}`
);


console.log(
  `3D: ${formatDistribution(
    summarizeNumbers(
      rawMinus4Hz3D
    )
  )}`
);


// ============================================================
// LIFECYCLE COHORTS
// ============================================================

console.log('');

console.log(
  'EXACT DEATH DISTANCE BY LIFECYCLE — XY'
);

console.log(
  '--------------------------------------'
);


for (
  const name
  of [
    'TARGET_IMMEDIATE_LE_0_25',
    'TARGET_EARLY_GT_0_25_LT_1',
    'TARGET_STABLE_GE_1',
    'NO_PLAYER_TARGET'
  ]
) {

  const cohort =
    cohortSummaries[
      name
    ];


  console.log('');

  console.log(
    name
  );


  console.log(
    `  credited:     ${formatDistribution(
      cohort
        .metrics
        .CREDITED_XY
        .distribution
    )}`
  );


  console.log(
    `                <=735 ${cohort.metrics.CREDITED_XY.inside735}/${cohort.metrics.CREDITED_XY.count} = ${formatPercent(cohort.metrics.CREDITED_XY.inside735Rate)}`
  );


  console.log(
    `  nearest ally: ${formatDistribution(
      cohort
        .metrics
        .NEAREST_ALLY_XY
        .distribution
    )}`
  );


  console.log(
    `                <=735 ${cohort.metrics.NEAREST_ALLY_XY.inside735}/${cohort.metrics.NEAREST_ALLY_XY.count} = ${formatPercent(cohort.metrics.NEAREST_ALLY_XY.inside735Rate)}`
  );


  console.log(
    `  nearest ally is credited: ${cohort.nearestAllyIsCredited}/${cohort.count}`
  );
}


// ============================================================
// MAIN CLASSIFIER
// ============================================================

console.log('');

console.log(
  'PREDICT TARGET <1S — EXACT RAW DEATH GEOMETRY'
);

console.log(
  '---------------------------------------------'
);


for (
  const metricName
  of [
    'CREDITED_XY',
    'CREDITED_3D',
    'NEAREST_ALLY_XY',
    'NEAREST_ALLY_3D'
  ]
) {

  const result =
    classifierResults[
      metricName
    ]
    .targetUnder1Second;


  console.log('');

  console.log(
    metricName
  );


  console.log(
    `  Best MCC: ${formatClassifierRow(
      result.bestMCC
    )}`
  );


  console.log(
    `  Best balanced: ${formatClassifierRow(
      result.bestBalancedAccuracy
    )}`
  );
}


// ============================================================
// STANDARD CREDITED / NEAREST THRESHOLDS
// ============================================================

console.log('');

console.log(
  'STANDARD THRESHOLDS — CREDITED XY'
);

console.log(
  '---------------------------------'
);


for (
  const row
  of classifierResults
    .CREDITED_XY
    .targetUnder1Second
    .standardThresholds
) {

  console.log(
    formatClassifierRow(
      row
    )
  );
}


console.log('');

console.log(
  'STANDARD THRESHOLDS — NEAREST ALLY XY'
);

console.log(
  '-------------------------------------'
);


for (
  const row
  of classifierResults
    .NEAREST_ALLY_XY
    .targetUnder1Second
    .standardThresholds
) {

  console.log(
    formatClassifierRow(
      row
    )
  );
}


// ============================================================
// IMMEDIATE OUTCOME
// ============================================================

console.log('');

console.log(
  'PREDICT TARGET <=0.25S — EXACT RAW DEATH GEOMETRY'
);

console.log(
  '-------------------------------------------------'
);


for (
  const metricName
  of [
    'CREDITED_XY',
    'NEAREST_ALLY_XY'
  ]
) {

  const result =
    classifierResults[
      metricName
    ]
    .targetImmediateQuarterSecond;


  console.log(
    `${metricName.padEnd(22)} ${formatClassifierRow(result.bestMCC)}`
  );
}


// ============================================================
// BAND OUTCOMES
// ============================================================

console.log('');

console.log(
  'NEAREST ALLY DISTANCE BANDS — TARGET <1S'
);

console.log(
  '----------------------------------------'
);


for (
  const row
  of nearestAllyBandOutcomes
) {

  console.log(

    `${row.name.padEnd(25)} ` +

    `n=${String(row.total).padStart(3)} ` +

    `imm=${String(row.immediate).padStart(3)} ` +

    `early=${String(row.early).padStart(3)} ` +

    `stable=${String(row.stable).padStart(3)} ` +

    `noTarget=${String(row.noTarget).padStart(3)} ` +

    `<1s=${formatPercent(row.under1Rate)}`
  );
}


// ============================================================
// TEAM RELATIONS
// ============================================================

console.log('');

console.log(
  'TEAM PROXIMITY RELATIONS'
);

console.log(
  '------------------------'
);


console.log(
  `Credited >735 but nearest ally <=735: ${creditedOutside735NearestAllyInside735.length}`
);


console.log(
  `  target <1s: ${under1CreditOutside735NearestInside735.length}/${creditedOutside735NearestAllyInside735.length} = ${formatPercent(rate(under1CreditOutside735NearestInside735.length, creditedOutside735NearestAllyInside735.length))}`
);


console.log(
  `Credited player is nearest ally: ${creditedIsNearestAtDeath.length}/${cases.length} = ${formatPercent(rate(creditedIsNearestAtDeath.length, cases.length))}`
);


console.log(
  `Eventual target is nearest ally at death: ${eventualTargetIsNearestAtDeath.length}/${transitionCases.length} = ${formatPercent(rate(eventualTargetIsNearestAtDeath.length, transitionCases.length))}`
);


// ============================================================
// VALIDATION
// ============================================================

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

    `${name.padEnd(38)} ` +

    `actual=${JSON.stringify(row.actual)} ` +

    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');

console.log(
  `OVERALL PIPELINE: ${validationPass ? 'PASS' : 'FAIL'}`
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
// CAPTURE ANALYSIS
// ============================================================

function selectCapture(
  row
) {

  if (
    !Array.isArray(
      row.captures
    )
    ||
    row.captures.length ===
      0
  ) {

    return null;
  }


  const strong =
    row.captures.filter(
      capture => {

        const credited =
          findCreditedPlayer(
            row,
            capture.players
          );


        return credited
          ?.position !==
          null;
      }
    );


  if (
    strong.length >
    0
  ) {

    return strong[
      strong.length -
      1
    ];
  }


  return row.captures[
    row.captures.length -
    1
  ];
}


function analyzeCapture(
  row
) {

  const capture =
    row.selectedCapture;


  if (
    !capture
  ) {

    return null;
  }


  const players =
    capture.players ??
    [];


  const credited =
    findCreditedPlayer(
      row,
      players
    );


  const eligibleAllies =
    players
      .filter(
        player =>
          player.team ===
            row.creditedPlayerTeam
          &&
          player.eligibleLivingPawn ===
            true
          &&
          player.position !==
            null
      )
      .map(
        player =>
          buildPlayerDistance(
            row,
            player
          )
      )
      .filter(
        player =>
          Number.isFinite(
            player.distanceXY
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          a.distanceXY -
          b.distanceXY
      );


  const creditedDistance =
    credited
    &&
    credited.position
      ? buildPlayerDistance(
        row,
        credited
      )
      : null;


  const nearestEligibleAlly =
    eligibleAllies[0]
    ??
    null;


  const nearestEligibleOtherAlly =
    eligibleAllies.find(
      player =>
        !player.isCreditedPlayer
    )
    ??
    null;


  let eventualTarget =
    null;


  if (
    row.eventualTargetPlayerName
  ) {

    const player =
      players.find(
        candidate =>
          candidate.playerName ===
            row.eventualTargetPlayerName
          &&
          (
            row.eventualTargetPlayerTeam ===
              null
            ||
            candidate.team ===
            row.eventualTargetPlayerTeam
          )
      )
      ??
      null;


    if (
      player
      &&
      player.position
    ) {

      eventualTarget =
        buildPlayerDistance(
          row,
          player
        );
    }
  }


  return {

    tick:
      capture.tick,

    captureCountAtTick:
      row.captures.length,

    creditedPlayer:
      creditedDistance,

    nearestEligibleAlly,

    nearestEligibleOtherAlly,

    eventualTargetPlayer:
      eventualTarget,

    eligibleAllyCount:
      eligibleAllies.length,

    eligibleAllies
  };
}


function findCreditedPlayer(
  row,
  players
) {

  if (
    row.creditedControllerEntityIndex !==
    null
  ) {

    const exact =
      players.find(
        player =>
          player.controllerEntityIndex ===
          row.creditedControllerEntityIndex
      );


    if (
      exact
    ) {

      return exact;
    }
  }


  return players.find(
    player =>
      player.playerName ===
        row.creditedPlayerName
      &&
      player.team ===
        row.creditedPlayerTeam
  )
  ??
  null;
}


function buildPlayerDistance(
  row,
  player
) {

  const distanceXYValue =
    distanceXY(
      row.deathPosition,
      player.position
    );


  const distance3DValue =
    (
      row.deathPosition
      &&
      player.position
      &&
      Number.isFinite(
        row.deathPosition.z
      )
      &&
      player.position.hasZ ===
        true
    )
      ? distance3D(
        row.deathPosition,
        player.position
      )
      : null;


  return {

    controllerEntityIndex:
      player.controllerEntityIndex,

    pawnEntityIndex:
      player.pawnEntityIndex,

    playerName:
      player.playerName,

    team:
      player.team,

    alive:
      player.alive,

    lifeState:
      player.lifeState,

    eligibleLivingPawn:
      player.eligibleLivingPawn,

    position:
      player.position,

    distanceXY:
      distanceXYValue,

    distance3D:
      distance3DValue,

    isCreditedPlayer:
      player.playerName ===
        row.creditedPlayerName
      &&
      player.team ===
        row.creditedPlayerTeam,

    isEventualTarget:
      Boolean(
        row.eventualTargetPlayerName
      )
      &&
      player.playerName ===
        row.eventualTargetPlayerName
      &&
      (
        row.eventualTargetPlayerTeam ===
          null
        ||
        player.team ===
          row.eventualTargetPlayerTeam
      )
  };
}


// ============================================================
// DISTANCE SUMMARY
// ============================================================

function summarizeDistanceMetric(
  rows,
  selector
) {

  const source =
    values(
      rows,
      selector
    );


  const inside735 =
    source.filter(
      value =>
        value <=
        FLOOR_CANDIDATE_HU
    ).length;


  const inside45m =
    source.filter(
      value =>
        value <=
        ROUGH_45M_HU
    ).length;


  return {

    count:
      source.length,

    distribution:
      summarizeNumbers(
        source
      ),

    inside735,

    inside735Rate:
      rate(
        inside735,
        source.length
      ),

    insideRough45m:
      inside45m,

    insideRough45mRate:
      rate(
        inside45m,
        source.length
      )
  };
}


// ============================================================
// BAND OUTCOMES
// ============================================================

function buildBandOutcomes(
  rows,
  selector
) {

  return distanceBands.map(
    band => {

      const matching =
        rows.filter(
          row => {

            const distance =
              finite(
                selector(
                  row
                )
              );


            return (
              distance !==
                null
              &&
              distance >
                band.min
              &&
              distance <=
                band.max
            );
          }
        );


      const under1 =
        matching.filter(
          targetUnder1Second
        ).length;


      return {

        name:
          band.name,

        total:
          matching.length,

        immediate:
          matching.filter(
            row =>
              row.lifecycleBand ===
              'TARGET_IMMEDIATE_LE_0_25'
          ).length,

        early:
          matching.filter(
            row =>
              row.lifecycleBand ===
              'TARGET_EARLY_GT_0_25_LT_1'
          ).length,

        stable:
          matching.filter(
            row =>
              row.lifecycleBand ===
              'TARGET_STABLE_GE_1'
          ).length,

        noTarget:
          matching.filter(
            row =>
              row.lifecycleBand ===
              'NO_PLAYER_TARGET'
          ).length,

        under1,

        under1Rate:
          rate(
            under1,
            matching.length
          )
      };
    }
  );
}


// ============================================================
// THRESHOLD CLASSIFIER
// ============================================================

function buildThresholdSearch(
  rows,
  distanceSelector,
  positiveSelector
) {

  const usable =
    rows.filter(
      row =>
        Number.isFinite(
          finite(
            distanceSelector(
              row
            )
          )
        )
    );


  const positiveCount =
    usable.filter(
      positiveSelector
    ).length;


  const negativeCount =
    usable.length -
    positiveCount;


  const output =
    [];


  for (
    let thresholdHU =
      SEARCH_MIN_HU;

    thresholdHU <=
      SEARCH_MAX_HU;

    thresholdHU +=
      SEARCH_STEP_HU
  ) {

    let tp =
      0;


    let fp =
      0;


    let tn =
      0;


    let fn =
      0;


    for (
      const row
      of usable
    ) {

      const distance =
        finite(
          distanceSelector(
            row
          )
        );


      const actualPositive =
        Boolean(
          positiveSelector(
            row
          )
        );


      const predictedPositive =
        distance <=
        thresholdHU;


      if (
        actualPositive
        &&
        predictedPositive
      ) {

        tp++;

      } else if (
        !actualPositive
        &&
        predictedPositive
      ) {

        fp++;

      } else if (
        !actualPositive
        &&
        !predictedPositive
      ) {

        tn++;

      } else {

        fn++;
      }
    }


    const sensitivity =
      rate(
        tp,
        tp +
        fn
      );


    const specificity =
      rate(
        tn,
        tn +
        fp
      );


    const accuracy =
      rate(
        tp +
        tn,
        usable.length
      );


    const balancedAccuracy =
      Number.isFinite(
        sensitivity
      )
      &&
      Number.isFinite(
        specificity
      )
        ? (
          sensitivity +
          specificity
        )
        /
        2
        : null;


    output.push({

      thresholdHU,

      thresholdMeters:
        thresholdHU /
        HU_PER_METER,

      total:
        usable.length,

      positiveCount,

      negativeCount,

      tp,

      fp,

      tn,

      fn,

      sensitivity,

      specificity,

      accuracy,

      balancedAccuracy,

      mcc:
        matthewsCorrelation({
          tp,
          fp,
          tn,
          fn
        })
    });
  }


  return output;
}


// ============================================================
// BEST CLASSIFIER
// ============================================================

function selectBest(
  rows,
  metric
) {

  return rows
    .filter(
      row =>
        Number.isFinite(
          row?.[metric]
        )
    )
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b[metric] -
          a[metric]
        ||
        (
          b.balancedAccuracy ??
          -Infinity
        )
        -
        (
          a.balancedAccuracy ??
          -Infinity
        )
        ||
        a.thresholdHU -
          b.thresholdHU
    )[0]
    ??
    null;
}


// ============================================================
// STANDARD THRESHOLDS
// ============================================================

function selectStandardRows(
  rows
) {

  const selected =
    [];


  for (
    const threshold
    of STANDARD_THRESHOLDS
  ) {

    const exact =
      rows.find(
        row =>
          row.thresholdHU ===
          threshold
      )
      ??
      null;


    if (
      exact
    ) {

      selected.push(
        exact
      );
    }
  }


  return selected;
}


// ============================================================
// MCC
// ============================================================

function matthewsCorrelation({
  tp,
  fp,
  tn,
  fn
}) {

  const numerator =
    tp *
      tn
    -
    fp *
      fn;


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


  return numerator /
    denominator;
}


// ============================================================
// RAW PLAYER HELPERS
// ============================================================

function safeGetField(
  entity,
  fieldName
) {

  try {

    return typeof entity?.getField ===
      'function'
      ? entity.getField(
        fieldName
      )
      : undefined;

  } catch {

    return undefined;
  }
}


function getEntityIndex(
  entity
) {

  const direct =
    finite(
      entity?.index ??
      entity?.entityIndex
    );


  if (
    direct !==
    null
  ) {

    return direct;
  }


  try {

    return typeof entity?.getIndex ===
      'function'
      ? finite(
        entity.getIndex()
      )
      : null;

  } catch {

    return null;
  }
}


function isInvalidHandle(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return true;
  }


  try {

    const parsed =
      BigInt(
        value
      );


    return (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    );

  } catch {

    return true;
  }
}


function booleanOrNull(
  value
) {

  if (
    value ===
      true
    ||
    value ===
      false
  ) {

    return value;
  }


  if (
    value ===
      1
    ||
    value ===
      '1'
  ) {

    return true;
  }


  if (
    value ===
      0
    ||
    value ===
      '0'
  ) {

    return false;
  }


  return null;
}


// ============================================================
// RAW WORLD POSITION
// ============================================================

function getWorldPositionDetailed(
  entity
) {

  const cellX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellX'
      )
    );


  const cellY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellY'
      )
    );


  const cellZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellZ'
      )
    );


  const vecX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecX'
      )
    );


  const vecY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecY'
      )
    );


  const vecZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecZ'
      )
    );


  if (
    cellX ===
      null
    ||
    cellY ===
      null
    ||
    vecX ===
      null
    ||
    vecY ===
      null
  ) {

    return null;
  }


  const hasZ =
    cellZ !==
      null
    &&
    vecZ !==
      null;


  return {

    x:
      cellX *
      512 -
      16384 +
      vecX,

    y:
      cellY *
      512 -
      16384 +
      vecY,

    z:
      hasZ
        ? cellZ *
          512 -
          16384 +
          vecZ
        : null,

    hasZ
  };
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
    firstFinite([
      value.x,
      value.X,
      value[0]
    ]);


  const y =
    firstFinite([
      value.y,
      value.Y,
      value[1]
    ]);


  const z =
    firstFinite([
      value.z,
      value.Z,
      value[2],
      0
    ]);


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

    z,

    hasZ:
      true
  };
}


// ============================================================
// GEOMETRY
// ============================================================

function distanceXY(
  a,
  b
) {

  const dx =
    a.x -
    b.x;


  const dy =
    a.y -
    b.y;


  return Math.sqrt(
    dx *
      dx
    +
    dy *
      dy
  );
}


function distance3D(
  a,
  b
) {

  const dx =
    a.x -
    b.x;


  const dy =
    a.y -
    b.y;


  const dz =
    a.z -
    b.z;


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


// ============================================================
// COMPACT CASE
// ============================================================

function compactCase(
  row
) {

  return {

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex:
      row.deathIndex,

    clock:
      row.clock,

    baseType:
      row.baseType,

    deathTick:
      row.deathTick,

    lifecycleBand:
      row.lifecycleBand,

    targetDelaySeconds:
      row.targetDelaySeconds,

    creditedPlayerName:
      row.creditedPlayerName,

    creditedPlayerTeam:
      row.creditedPlayerTeam,

    creditedControllerEntityIndex:
      row.creditedControllerEntityIndex,

    eventualTargetPlayerName:
      row.eventualTargetPlayerName,

    targetIdentityRelation:
      row.targetIdentityRelation,

    approximate4Hz:
      row.approximate4Hz,

    rawCaptureCount:
      row.captures.length,

    exactGeometry:
      row.exactGeometry
        ? {

          creditedPlayer:
            compactPlayerDistance(
              row
                .exactGeometry
                .creditedPlayer
            ),

          nearestEligibleAlly:
            compactPlayerDistance(
              row
                .exactGeometry
                .nearestEligibleAlly
            ),

          nearestEligibleOtherAlly:
            compactPlayerDistance(
              row
                .exactGeometry
                .nearestEligibleOtherAlly
            ),

          eventualTargetPlayer:
            compactPlayerDistance(
              row
                .exactGeometry
                .eventualTargetPlayer
            ),

          eligibleAllyCount:
            row
              .exactGeometry
              .eligibleAllyCount
        }
        : null
  };
}


function compactPlayerDistance(
  row
) {

  if (
    !row
  ) {

    return null;
  }


  return {

    controllerEntityIndex:
      row.controllerEntityIndex,

    pawnEntityIndex:
      row.pawnEntityIndex,

    playerName:
      row.playerName,

    team:
      row.team,

    alive:
      row.alive,

    lifeState:
      row.lifeState,

    eligibleLivingPawn:
      row.eligibleLivingPawn,

    distanceXY:
      row.distanceXY,

    distance3D:
      row.distance3D,

    isCreditedPlayer:
      row.isCreditedPlayer,

    isEventualTarget:
      row.isEventualTarget
  };
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
// GENERIC HELPERS
// ============================================================

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


function firstFinite(
  values
) {

  for (
    const value
    of values
  ) {

    const number =
      finite(
        value
      );


    if (
      number !==
      null
    ) {

      return number;
    }
  }


  return null;
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
// VALIDATION
// ============================================================

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
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}


function formatClassifierRow(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (
    `${formatNumber(row.thresholdHU)} HU ` +
    `(${row.thresholdMeters.toFixed(2)}m) ` +
    `TP=${row.tp} ` +
    `FP=${row.fp} ` +
    `TN=${row.tn} ` +
    `FN=${row.fn} ` +
    `sens=${formatPercent(row.sensitivity)} ` +
    `spec=${formatPercent(row.specificity)} ` +
    `bal=${formatPercent(row.balancedAccuracy)} ` +
    `MCC=${formatNumber(row.mcc)}`
  );
}