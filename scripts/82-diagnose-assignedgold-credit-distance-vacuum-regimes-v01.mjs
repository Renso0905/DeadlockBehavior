import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  resolve
} from 'node:path';

import {
  createInterface
} from 'node:readline';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const HU_PER_METER =
  39.37;


const FLOOR_ENVELOPE_HU =
  735;


const FORTY_FIVE_M_HU =
  45 *
  HU_PER_METER;


// ============================================================
// OPERATIONAL TIMING BANDS
//
// These are descriptive lifecycle timing bands.
//
// They are NOT assumed to be distinct engine mechanics.
//
// IMMEDIATE:
//   m_hVacuumTarget <= 0.25 s after activation
//
// EARLY:
//   >0.25 s and <1.0 s
//
// STABLE:
//   >=1.0 s
//
// The >=1 s cohort is useful because Scripts 78-81 showed an
// extremely tight ~735-HU current-soul XY target-onset envelope
// after the soul had persisted on the floor.
// ============================================================

const IMMEDIATE_SECONDS =
  0.25;


const STABLE_SECONDS =
  1.0;


// ============================================================
// THRESHOLD SEARCH
//
// These searches use Script 75's credited-player death geometry,
// which comes from 4-Hz player-state reconstruction.
//
// Therefore:
//
//   - useful for finding the approximate scale
//   - NOT suitable for declaring an exact radius
//
// If a meaningful boundary appears, Script 83 will repeat it
// using raw credited-player position at the exact death tick.
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
  735,
  800,
  900,
  1000,
  1100,
  1200,
  1300,
  1400,
  1500,
  1600,
  1700,
  FORTY_FIVE_M_HU,
  1800,
  1900,
  2000
];


// ============================================================
// PATHS
// ============================================================

const episodes76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );


const summary81Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_temporal_geometry_validation_v01.json'
  );


const cases81Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_temporal_geometry_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_credit_distance_vacuum_regimes_diagnostic_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_credit_distance_vacuum_regimes_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    episodes76Path,
    summary81Path,
    cases81Path
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
// LOAD SCRIPT 81 SUMMARY
// ============================================================

const summary81 =
  JSON.parse(
    readFileSync(
      summary81Path,
      'utf8'
    )
  );


if (
  summary81
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 81 did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 81 CASES
// ============================================================

console.log('');

console.log(
  'Loading Script 81 temporal-geometry cases...'
);


const cases81 =
  await loadJsonl(
    cases81Path
  );


console.log(
  `Script 81 cases: ${cases81.length}`
);


const case81ByDeathIndex =
  new Map();


for (
  const row
  of cases81
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    case81ByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// LOAD SCRIPT 76 EPISODES
// ============================================================

console.log(
  'Loading Script 76 lifecycle episodes...'
);


const episodes76 =
  await loadJsonl(
    episodes76Path
  );


console.log(
  `Script 76 episodes: ${episodes76.length}`
);


// ============================================================
// CLEAN CREDITED-PLAYER COHORT
// ============================================================

const cleanEpisodes =
  episodes76.filter(
    row =>
      row
        ?.creditedPlayer
        ?.quality ===
      'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'
  );


console.log(
  `Clean credited-player episodes: ${cleanEpisodes.length}`
);


// ============================================================
// BUILD CASES
// ============================================================

const cases =
  cleanEpisodes.map(
    row => {

      const deathIndex =
        finite(
          row?.deathIndex
        );


      const temporal =
        deathIndex ===
          null
          ? null
          : case81ByDeathIndex.get(
            deathIndex
          )
          ??
          null;


      const targetOnsetType =
        row
          ?.vacuum
          ?.targetOnsetType ??
        null;


      const targetDelaySeconds =
        finite(
          row
            ?.vacuum
            ?.targetDelaySeconds
        );


      const lifecycleBand =
        classifyLifecycleBand(
          targetOnsetType,
          targetDelaySeconds
        );


      const creditedPlayerName =
        row
          ?.creditedPlayer
          ?.playerName ??
        null;


      const targetPlayerName =
        row
          ?.vacuum
          ?.targetPlayerName ??
        null;


      const targetIdentityRelation =
        targetPlayerName ===
          null
          ? 'NO_TARGET_PLAYER'
          : creditedPlayerName ===
              targetPlayerName
            ? 'TARGET_IS_CREDITED_PLAYER'
            : 'TARGET_IS_OTHER_PLAYER';


      const creditedDistanceXY =
        finite(
          row
            ?.creditedPlayer
            ?.distanceAtDeathXY
        );


      const creditedDistance3D =
        finite(
          row
            ?.creditedPlayer
            ?.distanceAtDeath3D
        );


      const targetAtDeathXY =
        finite(
          temporal
            ?.temporalGeometry
            ?.targetAtDeathToDeathAnchorXY
        );


      const targetAtActivationXY =
        finite(
          temporal
            ?.temporalGeometry
            ?.targetAtActivationToSoulXY
        );


      const targetAtOnsetXY =
        finite(
          temporal
            ?.temporalGeometry
            ?.targetAtOnsetToSoulXY
        );


      return {

        schemaVersion:
          1,

        canonical:
          false,

        deathIndex,

        clock:
          row?.clock ??
          null,

        baseType:
          row?.baseType ??
          null,

        creditedPlayer: {

          playerName:
            creditedPlayerName,

          team:
            finite(
              row
                ?.creditedPlayer
                ?.team
            ),

          controllerEntityIndex:
            finite(
              row
                ?.creditedPlayer
                ?.controllerEntityIndex
            ),

          distanceAtDeathXY:
            creditedDistanceXY,

          distanceAtDeath3D:
            creditedDistance3D,

          within735XY:
            inside(
              creditedDistanceXY,
              FLOOR_ENVELOPE_HU
            ),

          within45mXY:
            inside(
              creditedDistanceXY,
              FORTY_FIVE_M_HU
            ),

          within45m3D:
            inside(
              creditedDistance3D,
              FORTY_FIVE_M_HU
            )
        },

        vacuumTarget: {

          onsetType:
            targetOnsetType,

          targetPlayerName,

          targetPlayerTeam:
            finite(
              row
                ?.vacuum
                ?.targetPlayerTeam
            ),

          targetDelaySeconds,

          targetIdentityRelation
        },

        lifecycleBand,

        eventualTargetTemporalGeometry:
          temporal
            ? {

              targetAtDeathXY,

              targetAtActivationXY,

              targetAtOnsetXY,

              temporalClass735:
                temporal
                  ?.temporalClass735 ??
                null
            }
            : null,

        termination: {

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

          near40Seconds:
            row
              ?.termination
              ?.near40Seconds ??
            null
        }
      };
    }
  );


// ============================================================
// COHORTS
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
// COHORT SUMMARIES
// ============================================================

const cohortSummaries =
  {};


for (
  const [
    name,
    rows
  ]
  of Object.entries(
    cohorts
  )
) {

  cohortSummaries[
    name
  ] =
    summarizeCohort(
      rows
    );
}


// ============================================================
// BINARY OUTCOMES
//
// Question 1:
//
// Does credited-player distance at death predict that a player
// target appears within <1 second of the AssignedGold activation?
//
// Positive:
//   target delay < 1 second
//
// Negative:
//   target delay >= 1 second OR no player target
//
// Question 2:
//
// Same, but for target <=0.25 second.
//
// These are operational telemetry outcomes, not claimed
// mechanics.
// ============================================================

const resolvedCreditXY =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.creditedPlayer
          ?.distanceAtDeathXY
      )
  );


const resolvedCredit3D =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
      )
  );


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
// THRESHOLD SEARCHES
// ============================================================

const under1XY =
  buildThresholdSearch(
    resolvedCreditXY,
    row =>
      row
        .creditedPlayer
        .distanceAtDeathXY,
    targetUnder1Second
  );


const under1ThreeD =
  buildThresholdSearch(
    resolvedCredit3D,
    row =>
      row
        .creditedPlayer
        .distanceAtDeath3D,
    targetUnder1Second
  );


const immediateXY =
  buildThresholdSearch(
    resolvedCreditXY,
    row =>
      row
        .creditedPlayer
        .distanceAtDeathXY,
    targetImmediate
  );


const immediateThreeD =
  buildThresholdSearch(
    resolvedCredit3D,
    row =>
      row
        .creditedPlayer
        .distanceAtDeath3D,
    targetImmediate
  );


// ============================================================
// BEST THRESHOLDS
// ============================================================

const under1BestMCCXY =
  selectBest(
    under1XY,
    'mcc'
  );


const under1BestBalancedXY =
  selectBest(
    under1XY,
    'balancedAccuracy'
  );


const under1BestMCC3D =
  selectBest(
    under1ThreeD,
    'mcc'
  );


const immediateBestMCCXY =
  selectBest(
    immediateXY,
    'mcc'
  );


const immediateBestMCC3D =
  selectBest(
    immediateThreeD,
    'mcc'
  );


// ============================================================
// STANDARD THRESHOLD ROWS
// ============================================================

const under1StandardXY =
  selectStandardRows(
    under1XY
  );


const under1Standard3D =
  selectStandardRows(
    under1ThreeD
  );


const immediateStandardXY =
  selectStandardRows(
    immediateXY
  );


// ============================================================
// TARGET IDENTITY BY TIMING
// ============================================================

const targetTransitionCases =
  cases.filter(
    row =>
      row
        ?.vacuumTarget
        ?.targetPlayerName
  );


const sameCreditedTarget =
  targetTransitionCases.filter(
    row =>
      row
        .vacuumTarget
        .targetIdentityRelation ===
      'TARGET_IS_CREDITED_PLAYER'
  );


const otherTarget =
  targetTransitionCases.filter(
    row =>
      row
        .vacuumTarget
        .targetIdentityRelation ===
      'TARGET_IS_OTHER_PLAYER'
  );


const targetIdentityByBand =
  {};


for (
  const band
  of [
    'TARGET_IMMEDIATE_LE_0_25',
    'TARGET_EARLY_GT_0_25_LT_1',
    'TARGET_STABLE_GE_1'
  ]
) {

  const rows =
    targetTransitionCases.filter(
      row =>
        row.lifecycleBand ===
        band
    );


  const same =
    rows.filter(
      row =>
        row
          .vacuumTarget
          .targetIdentityRelation ===
        'TARGET_IS_CREDITED_PLAYER'
    );


  const other =
    rows.filter(
      row =>
        row
          .vacuumTarget
          .targetIdentityRelation ===
        'TARGET_IS_OTHER_PLAYER'
    );


  targetIdentityByBand[
    band
  ] =
    {

      total:
        rows.length,

      sameCredited:
        same.length,

      sameCreditedRate:
        rate(
          same.length,
          rows.length
        ),

      otherPlayer:
        other.length,

      otherPlayerRate:
        rate(
          other.length,
          rows.length
        )
    };
}


// ============================================================
// STABLE FLOOR SUBGROUPS
// ============================================================

const stable =
  cohorts
    .TARGET_STABLE_GE_1;


const stableSameCredited =
  stable.filter(
    row =>
      row
        .vacuumTarget
        .targetIdentityRelation ===
      'TARGET_IS_CREDITED_PLAYER'
  );


const stableOtherPlayer =
  stable.filter(
    row =>
      row
        .vacuumTarget
        .targetIdentityRelation ===
      'TARGET_IS_OTHER_PLAYER'
  );


const stableSubgroups =
  {

    all:
      summarizeCohort(
        stable
      ),

    targetIsCreditedPlayer:
      summarizeCohort(
        stableSameCredited
      ),

    targetIsOtherPlayer:
      summarizeCohort(
        stableOtherPlayer
      )
  };


// ============================================================
// DISTANCE-BAND OUTCOME TABLE
// ============================================================

const distanceBandsXY =
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
        'GT_735_LE_1000',
      min:
        735,
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
        'GT_1500_LE_45M',
      min:
        1500,
      max:
        FORTY_FIVE_M_HU
    },

    {
      name:
        'GT_45M',
      min:
        FORTY_FIVE_M_HU,
      max:
        Infinity
    }
  ];


const bandOutcomeRows =
  distanceBandsXY.map(
    band => {

      const rows =
        resolvedCreditXY.filter(
          row => {

            const value =
              row
                .creditedPlayer
                .distanceAtDeathXY;


            return (
              value >
                band.min
              &&
              value <=
                band.max
            );
          }
        );


      return {

        name:
          band.name,

        minExclusiveHU:
          Number.isFinite(
            band.min
          )
            ? band.min
            : null,

        maxInclusiveHU:
          Number.isFinite(
            band.max
          )
            ? band.max
            : null,

        total:
          rows.length,

        immediate:
          rows.filter(
            row =>
              row.lifecycleBand ===
              'TARGET_IMMEDIATE_LE_0_25'
          ).length,

        early:
          rows.filter(
            row =>
              row.lifecycleBand ===
              'TARGET_EARLY_GT_0_25_LT_1'
          ).length,

        stable:
          rows.filter(
            row =>
              row.lifecycleBand ===
              'TARGET_STABLE_GE_1'
          ).length,

        noTarget:
          rows.filter(
            row =>
              row.lifecycleBand ===
              'NO_PLAYER_TARGET'
          ).length,

        targetUnder1Second:
          rows.filter(
            targetUnder1Second
          ).length,

        targetUnder1SecondRate:
          rate(
            rows.filter(
              targetUnder1Second
            ).length,
            rows.length
          )
      };
    }
  );


// ============================================================
// VALIDATION
// ============================================================

const transitionCount =
  cases.filter(
    row =>
      row
        ?.vacuumTarget
        ?.targetPlayerName
  ).length;


const noTargetCount =
  cases.filter(
    row =>
      row.lifecycleBand ===
      'NO_PLAYER_TARGET'
  ).length;


const classifiedCount =
  Object
    .values(
      cohorts
    )
    .slice(
      1
    )
    .reduce(
      (
        sum,
        rows
      ) =>
        sum +
        rows.length,
      0
    );


const joined81Count =
  targetTransitionCases.filter(
    row =>
      row.eventualTargetTemporalGeometry !==
      null
  ).length;


const validationChecks =
  {

    script81Passed:
      check(
        summary81
          ?.validation
          ?.pass,
        true,
        summary81
          ?.validation
          ?.pass ===
        true
      ),


    cleanEpisodeCount:
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


    cleanTransitionCount:
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


    cleanNoTargetCount:
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
      ),


    lifecyclePartitionExhaustive:
      check(
        classifiedCount,
        cases.length,
        classifiedCount ===
        cases.length
      ),


    script81TransitionJoinComplete:
      check(
        joined81Count,
        transitionCount,
        joined81Count ===
        transitionCount
      ),


    creditedXYCoverage:
      check(
        resolvedCreditXY.length,
        '>=99% of clean episodes',
        rate(
          resolvedCreditXY.length,
          cases.length
        ) >=
        0.99
      ),


    credited3DCoverage:
      check(
        resolvedCredit3D.length,
        '>=99% of clean episodes',
        rate(
          resolvedCredit3D.length,
          cases.length
        ) >=
        0.99
      ),


    stableCount:
      check(
        stable.length,
        replayName ===
          'test'
          ? 131
          : '>0',
        replayName ===
          'test'
          ? stable.length ===
            131
          : stable.length >
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
      'ASSIGNED_GOLD_CREDIT_DISTANCE_VACUUM_REGIMES_DIAGNOSTIC_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'CREDITED_PLAYER_DISTANCE_REGIME_DIAGNOSTIC_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Test whether the exact-last-hit credited player distance at Trooper death predicts early AssignedGold vacuum-target timing.',

        'Keep credited last-hitter geometry distinct from eventual vacuum-target geometry.',

        'Compare the gameplay-informed ~45m initial-vacuum hypothesis with the ~735-HU stable floor-pickup envelope.',

        'Determine whether a raw exact-tick credited-player geometry rescan is warranted.'
      ],


    semanticLimits:
      {

        creditedPlayerGeometry:
          'Credited-player death geometry in this diagnostic comes from Script 75 4-Hz player-state reconstruction. It is suitable for approximate scale discovery but not exact-radius canonicalization.',

        targetTiming:
          'm_hVacuumTarget timing remains observed downstream telemetry and is not automatically identical to the instant vacuum eligibility first became true.',

        oneSecondBand:
          'The <1s versus >=1s split is operational. It is used because prior scripts showed a stable-floor geometric regime after >=1s, not because one second is an engine-defined threshold.',

        fortyFiveMeters:
          '45m remains gameplay-informed and provisional.',

        floor735:
          '735 HU is currently a single-replay empirical current-soul XY envelope for stable delayed target assignment.'
      },


    sourceCounts:
      {

        cleanEpisodes:
          cases.length,

        cleanTargetTransitions:
          transitionCount,

        cleanNoTarget:
          noTargetCount,

        creditedXYResolved:
          resolvedCreditXY.length,

        credited3DResolved:
          resolvedCredit3D.length
      },


    lifecycleCohorts:
      cohortSummaries,


    targetIdentity:
      {

        allComparable:
          targetTransitionCases.length,

        targetIsCreditedPlayer:
          sameCreditedTarget.length,

        targetIsCreditedPlayerRate:
          rate(
            sameCreditedTarget.length,
            targetTransitionCases.length
          ),

        targetIsOtherPlayer:
          otherTarget.length,

        targetIsOtherPlayerRate:
          rate(
            otherTarget.length,
            targetTransitionCases.length
          ),

        byTimingBand:
          targetIdentityByBand
      },


    stableFloorSubgroups:
      stableSubgroups,


    creditedDistanceBandOutcomesXY:
      bandOutcomeRows,


    thresholdPrediction:
      {

        targetUnder1Second: {

          positiveDefinition:
            'm_hVacuumTarget player appears <1.0 second after activation',

          negativeDefinition:
            'target appears >=1.0 second after activation OR no player target observed',

          xy: {

            bestMCC:
              under1BestMCCXY,

            bestBalancedAccuracy:
              under1BestBalancedXY,

            standardThresholds:
              under1StandardXY
          },

          threeD: {

            bestMCC:
              under1BestMCC3D,

            standardThresholds:
              under1Standard3D
          }
        },


        targetImmediateQuarterSecond: {

          positiveDefinition:
            'm_hVacuumTarget player appears <=0.25 second after activation',

          negativeDefinition:
            'all other clean credited episodes',

          xy: {

            bestMCC:
              immediateBestMCCXY,

            standardThresholds:
              immediateStandardXY
          },

          threeD: {

            bestMCC:
              immediateBestMCC3D
          }
        }
      },


    interpretationGuide:
      {

        fortyFiveMeterSupport:
          'If credited-player death distance near 45m sharply separates target-under-1s from stable/no-target outcomes, the gameplay-informed initial-vacuum range gains support.',

        smallerRangeSupport:
          'If the best credited-player threshold is instead near the ~735-HU stable-floor envelope, a common smaller proximity scale becomes more plausible.',

        noSharpThreshold:
          'If credited-player death distance poorly predicts early target timing, m_hVacuumTarget timing may be too downstream to classify initial vacuum directly, or additional state variables may govern it.',

        targetIdentity:
          'Different timing behavior when the eventual target differs from the credited player would support separating initial last-hitter eligibility from later allied floor pickup.',

        next:
          'If a meaningful credited-player range signal appears, Script 83 should replace the 4-Hz credited-player death geometry with raw exact-tick pawn geometry.'
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
  cases
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD CREDIT-DISTANCE VACUUM REGIMES V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// COHORTS
// ============================================================

console.log('');

console.log(
  'LIFECYCLE COHORTS'
);

console.log(
  '-----------------'
);


for (
  const [
    name,
    rows
  ]
  of Object.entries(
    cohorts
  )
) {

  console.log(
    `${name.padEnd(32)} ${rows.length}`
  );
}


// ============================================================
// CREDITED DISTANCE BY OUTCOME
// ============================================================

console.log('');

console.log(
  'CREDITED LAST-HITTER DISTANCE AT DEATH — XY'
);

console.log(
  '-------------------------------------------'
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

  const row =
    cohortSummaries[
      name
    ];


  console.log(
    `${name.padEnd(32)} ` +
    `${formatDistribution(row.creditedDistanceAtDeathXY)}`
  );


  console.log(
    `${''.padEnd(32)} ` +
    `<=735=${row.creditedWithin735XY}/${row.creditedXYResolved} ` +
    `${formatPercent(row.creditedWithin735XYRate)}  ` +
    `<=45m=${row.creditedWithin45mXY}/${row.creditedXYResolved} ` +
    `${formatPercent(row.creditedWithin45mXYRate)}`
  );
}


// ============================================================
// BAND OUTCOMES
// ============================================================

console.log('');

console.log(
  'CREDITED DEATH DISTANCE BANDS — XY'
);

console.log(
  '----------------------------------'
);


for (
  const row
  of bandOutcomeRows
) {

  console.log(

    `${row.name.padEnd(20)} ` +

    `n=${String(row.total).padStart(3)} ` +

    `imm=${String(row.immediate).padStart(3)} ` +

    `early=${String(row.early).padStart(3)} ` +

    `stable=${String(row.stable).padStart(3)} ` +

    `noTarget=${String(row.noTarget).padStart(3)} ` +

    `<1s=${formatPercent(row.targetUnder1SecondRate)}`
  );
}


// ============================================================
// <1 SECOND THRESHOLD MODEL
// ============================================================

console.log('');

console.log(
  'PREDICT TARGET <1S FROM CREDITED DEATH DISTANCE'
);

console.log(
  '------------------------------------------------'
);


console.log(
  `Best MCC — XY: ${formatClassifierRow(under1BestMCCXY)}`
);


console.log(
  `Best balanced accuracy — XY: ${formatClassifierRow(under1BestBalancedXY)}`
);


console.log(
  `Best MCC — 3D: ${formatClassifierRow(under1BestMCC3D)}`
);


console.log('');

console.log(
  'STANDARD THRESHOLDS — XY'
);


for (
  const row
  of under1StandardXY
) {

  console.log(
    formatClassifierRow(
      row
    )
  );
}


// ============================================================
// IMMEDIATE THRESHOLD MODEL
// ============================================================

console.log('');

console.log(
  'PREDICT TARGET <=0.25S FROM CREDITED DEATH DISTANCE'
);

console.log(
  '---------------------------------------------------'
);


console.log(
  `Best MCC — XY: ${formatClassifierRow(immediateBestMCCXY)}`
);


console.log(
  `Best MCC — 3D: ${formatClassifierRow(immediateBestMCC3D)}`
);


console.log('');

console.log(
  'STANDARD THRESHOLDS — XY'
);


for (
  const row
  of immediateStandardXY
) {

  console.log(
    formatClassifierRow(
      row
    )
  );
}


// ============================================================
// TARGET IDENTITY
// ============================================================

console.log('');

console.log(
  'VACUUM TARGET IDENTITY BY TIMING BAND'
);

console.log(
  '-------------------------------------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    targetIdentityByBand
  )
) {

  console.log(

    `${name.padEnd(32)} ` +

    `n=${row.total} ` +

    `credit=${row.sameCredited} ` +

    `${formatPercent(row.sameCreditedRate)} ` +

    `other=${row.otherPlayer} ` +

    `${formatPercent(row.otherPlayerRate)}`
  );
}


// ============================================================
// STABLE SUBGROUPS
// ============================================================

console.log('');

console.log(
  'STABLE >=1S — CREDITED PLAYER VS EVENTUAL TARGET'
);

console.log(
  '-----------------------------------------------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    stableSubgroups
  )
) {

  console.log('');

  console.log(
    name
  );


  console.log(
    `  n=${row.count}`
  );


  console.log(
    `  credited death XY: ${formatDistribution(row.creditedDistanceAtDeathXY)}`
  );


  console.log(
    `  eventual target onset XY: ${formatDistribution(row.eventualTargetAtOnsetXY)}`
  );


  console.log(
    `  credited <=735: ${row.creditedWithin735XY}/${row.creditedXYResolved} = ${formatPercent(row.creditedWithin735XYRate)}`
  );


  console.log(
    `  credited <=45m: ${row.creditedWithin45mXY}/${row.creditedXYResolved} = ${formatPercent(row.creditedWithin45mXYRate)}`
  );
}


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

    `${name.padEnd(40)} ` +

    `actual=${JSON.stringify(row.actual)} ` +

    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');

console.log(
  `OVERALL DIAGNOSTIC: ${validationPass ? 'PASS' : 'FAIL'}`
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
// LIFECYCLE BAND
// ============================================================

function classifyLifecycleBand(
  onsetType,
  delaySeconds
) {

  if (
    onsetType ===
    'NO_PLAYER_TARGET_OBSERVED'
  ) {

    return 'NO_PLAYER_TARGET';
  }


  if (
    onsetType !==
    'NULL_TO_PLAYER_TARGET_TRANSITION'
  ) {

    return 'OTHER_TARGET_STATE';
  }


  if (
    !Number.isFinite(
      delaySeconds
    )
  ) {

    return 'OTHER_TARGET_STATE';
  }


  if (
    delaySeconds <=
    IMMEDIATE_SECONDS
  ) {

    return 'TARGET_IMMEDIATE_LE_0_25';
  }


  if (
    delaySeconds <
    STABLE_SECONDS
  ) {

    return 'TARGET_EARLY_GT_0_25_LT_1';
  }


  return 'TARGET_STABLE_GE_1';
}


// ============================================================
// COHORT SUMMARY
// ============================================================

function summarizeCohort(
  rows
) {

  const creditedXY =
    values(
      rows,
      row =>
        row
          ?.creditedPlayer
          ?.distanceAtDeathXY
    );


  const credited3D =
    values(
      rows,
      row =>
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
    );


  const targetDeathXY =
    values(
      rows,
      row =>
        row
          ?.eventualTargetTemporalGeometry
          ?.targetAtDeathXY
    );


  const targetActivationXY =
    values(
      rows,
      row =>
        row
          ?.eventualTargetTemporalGeometry
          ?.targetAtActivationXY
    );


  const targetOnsetXY =
    values(
      rows,
      row =>
        row
          ?.eventualTargetTemporalGeometry
          ?.targetAtOnsetXY
    );


  const creditedWithin735XY =
    creditedXY.filter(
      value =>
        value <=
        FLOOR_ENVELOPE_HU
    ).length;


  const creditedWithin45mXY =
    creditedXY.filter(
      value =>
        value <=
        FORTY_FIVE_M_HU
    ).length;


  const creditedWithin45m3D =
    credited3D.filter(
      value =>
        value <=
        FORTY_FIVE_M_HU
    ).length;


  const targetSame =
    rows.filter(
      row =>
        row
          ?.vacuumTarget
          ?.targetIdentityRelation ===
        'TARGET_IS_CREDITED_PLAYER'
    ).length;


  const targetOther =
    rows.filter(
      row =>
        row
          ?.vacuumTarget
          ?.targetIdentityRelation ===
        'TARGET_IS_OTHER_PLAYER'
    ).length;


  return {

    count:
      rows.length,

    creditedXYResolved:
      creditedXY.length,

    credited3DResolved:
      credited3D.length,

    creditedDistanceAtDeathXY:
      summarizeNumbers(
        creditedXY
      ),

    creditedDistanceAtDeath3D:
      summarizeNumbers(
        credited3D
      ),

    creditedWithin735XY,

    creditedWithin735XYRate:
      rate(
        creditedWithin735XY,
        creditedXY.length
      ),

    creditedWithin45mXY,

    creditedWithin45mXYRate:
      rate(
        creditedWithin45mXY,
        creditedXY.length
      ),

    creditedWithin45m3D,

    creditedWithin45m3DRate:
      rate(
        creditedWithin45m3D,
        credited3D.length
      ),

    eventualTargetAtDeathXY:
      summarizeNumbers(
        targetDeathXY
      ),

    eventualTargetAtActivationXY:
      summarizeNumbers(
        targetActivationXY
      ),

    eventualTargetAtOnsetXY:
      summarizeNumbers(
        targetOnsetXY
      ),

    targetIsCreditedPlayer:
      targetSame,

    targetIsOtherPlayer:
      targetOther,

    targetSameRate:
      rate(
        targetSame,
        targetSame +
        targetOther
      )
  };
}


// ============================================================
// THRESHOLD SEARCH
// ============================================================

function buildThresholdSearch(
  rows,
  distanceSelector,
  positiveSelector
) {

  const positiveCount =
    rows.filter(
      positiveSelector
    ).length;


  const negativeCount =
    rows.length -
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
      of rows
    ) {

      const distance =
        finite(
          distanceSelector(
            row
          )
        );


      if (
        distance ===
        null
      ) {

        continue;
      }


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
        tp +
        fp +
        tn +
        fn
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
// STANDARD ROW SELECTION
// ============================================================

function selectStandardRows(
  rows
) {

  const selected =
    [];


  for (
    const rawThreshold
    of STANDARD_THRESHOLDS
  ) {

    const threshold =
      Math.round(
        rawThreshold
      );


    let best =
      null;


    let bestDifference =
      Infinity;


    for (
      const row
      of rows
    ) {

      const difference =
        Math.abs(
          row.thresholdHU -
          threshold
        );


      if (
        difference <
        bestDifference
      ) {

        best =
          row;

        bestDifference =
          difference;
      }
    }


    if (
      best
      &&
      !selected.some(
        row =>
          row.thresholdHU ===
          best.thresholdHU
      )
    ) {

      selected.push(
        best
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
// HELPERS
// ============================================================

function inside(
  value,
  threshold
) {

  return Number.isFinite(
    value
  )
    ? value <=
      threshold
    : null;
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