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
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const MAX_INTEGER_SHARE_SPREAD =
  1;


// ============================================================
// PURPOSE
//
// Script 90 found:
//
//   stable isolated primary clean = 91
//   single recipient              = 27
//   multi recipient               = 64
//
// Exact equality across all recipients occurred in only 22/64
// multi-recipient cases.
//
// BUT:
//
//   peer / credited ratio median = 1
//   peer - credited median       = 0
//   peer - credited p95          = 0
//
// and recipient-count groups strongly resemble integer division.
//
// Examples:
//
//   total 96 / 5 = 19 remainder 1
//
//     expected integer allocation:
//       20, 19, 19, 19, 19
//
//   total 93 / 6 = 15 remainder 3
//
//     expected integer allocation:
//       16, 16, 16, 15, 15, 15
//
// Therefore literal all-equal testing is too strict.
//
// Script 91 asks:
//
//   1. Do same-team recipient deltas conform to an exact integer
//      equal-share partition:
//
//        floor(total / N)
//        ceil(total / N)
//
//      with exactly:
//
//        total mod N
//
//      recipients receiving the +1 remainder?
//
//   2. Does the credited last-hitter receive special priority
//      for the +1 remainder?
//
//   3. Does m_hVacuumTarget receive special priority for the
//      +1 remainder?
//
//   4. Once recipient splitting is removed, what is the
//      reconstructed total reward distribution?
//
//   5. How much of reconstructed reward magnitude is explained
//      by:
//
//        - exact match time
//        - Trooper base type
//        - provisional variant label
//
// IMPORTANT:
//
// This remains single-replay observational telemetry.
//
// A clean integer partition strongly supports shared economic
// credit but does not by itself prove engine implementation.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const summary90Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_reward_sharing_diagnostic_v01.json'
  );


const cases90Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_reward_sharing_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_integer_sharing_reward_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_integer_sharing_reward_cases_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    summary90Path,
    cases90Path
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
// LOAD SCRIPT 90
// ============================================================

const summary90 =
  JSON.parse(
    readFileSync(
      summary90Path,
      'utf8'
    )
  );


if (
  summary90
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 90 did not PASS.'
  );
}


console.log('');

console.log(
  'Loading Script 90 reward-sharing cases...'
);


const sourceCases =
  await loadJsonl(
    cases90Path
  );


console.log(
  `Script 90 cases: ${sourceCases.length}`
);


// ============================================================
// NORMALIZE PRIMARY CASES
// ============================================================

const cases =
  sourceCases
    .map(
      normalizeCase
    )
    .filter(
      Boolean
    );


const primaryClean =
  cases.filter(
    row =>
      row.primaryClean ===
      true
  );


const primarySingle =
  primaryClean.filter(
    row =>
      row.recipientCount ===
      1
  );


const primaryMulti =
  primaryClean.filter(
    row =>
      row.recipientCount >
      1
  );


console.log('');

console.log(
  `Primary clean: ${primaryClean.length}`
);


console.log(
  `Single recipient: ${primarySingle.length}`
);


console.log(
  `Multi recipient: ${primaryMulti.length}`
);


// ============================================================
// INTEGER-SHARE CLASSIFICATION
// ============================================================

const integerPartitionExact =
  primaryClean.filter(
    row =>
      row.integerShare.partitionExact ===
      true
  );


const integerPartitionFailure =
  primaryClean.filter(
    row =>
      row.integerShare.partitionExact !==
      true
  );


const multiIntegerPartitionExact =
  primaryMulti.filter(
    row =>
      row.integerShare.partitionExact ===
      true
  );


const multiIntegerPartitionFailure =
  primaryMulti.filter(
    row =>
      row.integerShare.partitionExact !==
      true
  );


const multiSpreadLE1 =
  primaryMulti.filter(
    row =>
      Number.isFinite(
        row.integerShare.spread
      )
      &&
      row.integerShare.spread <=
      MAX_INTEGER_SHARE_SPREAD
  );


// ============================================================
// HIGH-CONFIDENCE REWARD COHORT
//
// Integer-partition-consistent cases are treated as the cleanest
// currently reconstructable complete reward events.
//
// Single-recipient cases are naturally exact partitions.
// ============================================================

const rewardModelCohort =
  integerPartitionExact.filter(
    row =>
      Number.isFinite(
        row.matchMinute
      )
      &&
      Number.isFinite(
        row.teamTotal
      )
      &&
      Boolean(
        row.baseType
      )
  );


// ============================================================
// REMAINDER ALLOCATION
// ============================================================

const remainderCases =
  multiIntegerPartitionExact.filter(
    row =>
      row.integerShare.remainder >
      0
  );


const creditedEligibleForExtra =
  remainderCases.filter(
    row =>
      row.creditedDelta >
      0
  );


const creditedGetsExtra =
  creditedEligibleForExtra.filter(
    row =>
      row.integerShare.creditedGetsCeil ===
      true
  );


const targetRemainderComparable =
  remainderCases.filter(
    row =>
      row.targetPlayerName
      &&
      row.targetDelta >
      0
  );


const targetGetsExtra =
  targetRemainderComparable.filter(
    row =>
      row.integerShare.targetGetsCeil ===
      true
  );


const creditedRandomExpected =
  remainderCases.length >
    0
      ? mean(
          remainderCases.map(
            row =>
              row.integerShare.remainder /
              row.recipientCount
          )
        )
      : null;


const targetRandomExpected =
  targetRemainderComparable.length >
    0
      ? mean(
          targetRemainderComparable.map(
            row =>
              row.integerShare.remainder /
              row.recipientCount
          )
        )
      : null;


// ============================================================
// VACUUM TARGET ECONOMIC ROLE
// ============================================================

const mismatchIntegerExact =
  multiIntegerPartitionExact.filter(
    row =>
      row.targetDiffersFromCredited ===
      true
  );


const mismatchTargetAbsent =
  mismatchIntegerExact.filter(
    row =>
      row.targetDelta <=
      0
  );


const mismatchTargetPresent =
  mismatchIntegerExact.filter(
    row =>
      row.targetDelta >
      0
  );


const mismatchNonTargetPeerPresent =
  mismatchIntegerExact.filter(
    row =>
      row.nonTargetPeerCount >
      0
  );


// ============================================================
// RECIPIENT COUNT STRUCTURE
// ============================================================

const byRecipientCount =
  summarizeGroups(
    rewardModelCohort,
    row =>
      String(
        row.recipientCount
      )
  );


const byBaseType =
  summarizeGroups(
    rewardModelCohort,
    row =>
      row.baseType ??
      'UNKNOWN'
  );


const byTimeBand =
  summarizeGroups(
    rewardModelCohort,
    row =>
      row.timeBand
  );


const byTypeAndTime =
  summarizeGroups(
    rewardModelCohort,
    row =>
      `${row.baseType ?? 'UNKNOWN'}|${row.timeBand}`
  );


// ============================================================
// SIMPLE LINEAR REWARD MODELS
//
// MODEL A:
//
//   reward = intercept + slope * matchMinute
//
// MODEL B:
//
//   reward = common slope * matchMinute
//          + separate intercept for each base type
//
// MODEL C:
//
//   separate intercept and slope for each base type
//
// MODEL D:
//
//   model B + recipient count
//
// If recipient count has little predictive contribution after
// type/time are accounted for, that supports conservation of one
// underlying reward total under sharing.
// ============================================================

const modelA =
  fitOLSModel(
    rewardModelCohort,
    [
      {
        name:
          'INTERCEPT',

        value:
          row =>
            1
      },

      {
        name:
          'MATCH_MINUTE',

        value:
          row =>
            row.matchMinute
      }
    ]
  );


const baseTypes =
  [
    ...new Set(
      rewardModelCohort
        .map(
          row =>
            row.baseType
        )
        .filter(
          Boolean
        )
    )
  ]
  .sort();


const referenceBaseType =
  baseTypes[0] ??
  null;


const modelBFeatures =
  [

    {
      name:
        'INTERCEPT',

      value:
        row =>
          1
    },

    {
      name:
        'MATCH_MINUTE',

      value:
        row =>
          row.matchMinute
    }
  ];


for (
  const baseType
  of baseTypes.slice(
    1
  )
) {

  modelBFeatures.push({

    name:
      `TYPE_${baseType}`,

    value:
      row =>
        row.baseType ===
          baseType
          ? 1
          : 0
  });
}


const modelB =
  fitOLSModel(
    rewardModelCohort,
    modelBFeatures
  );


// ============================================================
// MODEL C — TYPE-SPECIFIC SLOPES
// ============================================================

const modelCFeatures =
  [

    {
      name:
        'INTERCEPT',

      value:
        row =>
          1
    },

    {
      name:
        'MATCH_MINUTE',

      value:
        row =>
          row.matchMinute
    }
  ];


for (
  const baseType
  of baseTypes.slice(
    1
  )
) {

  modelCFeatures.push({

    name:
      `TYPE_${baseType}`,

    value:
      row =>
        row.baseType ===
          baseType
          ? 1
          : 0
  });


  modelCFeatures.push({

    name:
      `MINUTE_X_TYPE_${baseType}`,

    value:
      row =>
        row.baseType ===
          baseType
          ? row.matchMinute
          : 0
  });
}


const modelC =
  fitOLSModel(
    rewardModelCohort,
    modelCFeatures
  );


// ============================================================
// MODEL D — DOES RECIPIENT COUNT CHANGE TOTAL REWARD?
// ============================================================

const modelDFeatures =
  [
    ...modelBFeatures,

    {
      name:
        'RECIPIENT_COUNT',

      value:
        row =>
          row.recipientCount
    }
  ];


const modelD =
  fitOLSModel(
    rewardModelCohort,
    modelDFeatures
  );


// ============================================================
// PROVISIONAL VARIANT MODEL
//
// Only diagnostic.
//
// Variant labels are not canonical.
// ============================================================

const variantLabels =
  [
    ...new Set(
      rewardModelCohort
        .map(
          row =>
            row.variantLabel
        )
        .filter(
          value =>
            Boolean(
              value
            )
            &&
            value !==
            'UNKNOWN'
        )
    )
  ]
  .sort();


const variantReference =
  variantLabels[0] ??
  null;


const modelEFeatures =
  [
    ...modelBFeatures
  ];


for (
  const variant
  of variantLabels.slice(
    1
  )
) {

  modelEFeatures.push({

    name:
      `VARIANT_${sanitizeName(
        variant
      )}`,

    value:
      row =>
        row.variantLabel ===
          variant
          ? 1
          : 0
  });
}


const modelE =
  variantLabels.length >
    1
    ? fitOLSModel(
        rewardModelCohort,
        modelEFeatures
      )
    : null;


// ============================================================
// MODEL COMPARISON
// ============================================================

const modelComparison =
  [

    {
      id:
        'A_TIME_ONLY',

      model:
        modelA
    },

    {
      id:
        'B_TIME_PLUS_BASE_TYPE',

      model:
        modelB
    },

    {
      id:
        'C_TYPE_SPECIFIC_SLOPES',

      model:
        modelC
    },

    {
      id:
        'D_TIME_TYPE_PLUS_RECIPIENT_COUNT',

      model:
        modelD
    },

    {
      id:
        'E_TIME_TYPE_PLUS_PROVISIONAL_VARIANT',

      model:
        modelE
    }
  ]
  .filter(
    row =>
      Boolean(
        row.model
      )
  )
  .map(
    row => ({

      id:
        row.id,

      ...row.model
    }))
  .sort(
    (
      a,
      b
    ) =>
      a.rmse -
      b.rmse
  );


const bestModel =
  modelComparison[0] ??
  null;


// ============================================================
// RECIPIENT-COUNT COEFFICIENT
// ============================================================

const recipientCountCoefficient =
  modelD
    ?.coefficients
    ?.RECIPIENT_COUNT ??
  null;


// ============================================================
// TYPE-SPECIFIC SIMPLE REGRESSIONS
// ============================================================

const typeRegressions =
  {};


for (
  const baseType
  of baseTypes
) {

  const rows =
    rewardModelCohort.filter(
      row =>
        row.baseType ===
        baseType
    );


  typeRegressions[
    baseType
  ] =
    fitSimpleRegression(
      rows.map(
        row => ({

          x:
            row.matchMinute,

          y:
            row.teamTotal
        })
      )
    );
}


// ============================================================
// INTEGER AMOUNT MODELS
//
// Reward values are integer telemetry.
//
// After fitting continuous models, evaluate rounded predictions.
// ============================================================

const roundedModelComparison =
  modelComparison.map(
    model =>
      evaluateRoundedModel(
        rewardModelCohort,
        model
      )
  );


roundedModelComparison.sort(
  (
    a,
    b
  ) =>
    a.rmse -
    b.rmse
);


// ============================================================
// CLEANEST CASES FOR MANUAL INSPECTION
// ============================================================

const amountCaseTable =
  rewardModelCohort
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        a.matchMinute -
          b.matchMinute
        ||
        String(
          a.baseType
        ).localeCompare(
          String(
            b.baseType
          )
        )
    )
    .map(
      row => ({

        deathIndex:
          row.deathIndex,

        clock:
          row.clock,

        matchMinute:
          row.matchMinute,

        baseType:
          row.baseType,

        variantLabel:
          row.variantLabel,

        recipientCount:
          row.recipientCount,

        teamTotal:
          row.teamTotal,

        floorShare:
          row.integerShare.floorShare,

        ceilShare:
          row.integerShare.ceilShare,

        remainder:
          row.integerShare.remainder,

        recipientDeltas:
          row.recipientDeltas
      }));


// ============================================================
// FAILURE CASES
// ============================================================

const partitionFailureCases =
  integerPartitionFailure.map(
    row => ({

      deathIndex:
        row.deathIndex,

      clock:
        row.clock,

      baseType:
        row.baseType,

      matchMinute:
        row.matchMinute,

      recipientCount:
        row.recipientCount,

      teamTotal:
        row.teamTotal,

      recipientDeltas:
        row.recipientDeltas,

      spread:
        row.integerShare.spread,

      floorShare:
        row.integerShare.floorShare,

      ceilShare:
        row.integerShare.ceilShare,

      remainder:
        row.integerShare.remainder,

      expectedCeilRecipients:
        row.integerShare.expectedCeilRecipients,

      actualCeilRecipients:
        row.integerShare.actualCeilRecipients,

      unexpectedAmounts:
        row.integerShare.unexpectedAmounts
    }));


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const integerShareRate =
  rate(
    multiIntegerPartitionExact.length,
    primaryMulti.length
  );


const overallPartitionRate =
  rate(
    integerPartitionExact.length,
    primaryClean.length
  );


const integerSharingStrong =
  primaryMulti.length >=
    20
  &&
  integerShareRate >=
    0.90;


const creditedExtraRate =
  rate(
    creditedGetsExtra.length,
    creditedEligibleForExtra.length
  );


const targetExtraRate =
  rate(
    targetGetsExtra.length,
    targetRemainderComparable.length
  );


const creditedRemainderPriorityCandidate =
  Number.isFinite(
    creditedExtraRate
  )
  &&
  Number.isFinite(
    creditedRandomExpected
  )
  &&
  creditedExtraRate >
    creditedRandomExpected +
    0.15;


const targetRemainderPriorityCandidate =
  Number.isFinite(
    targetExtraRate
  )
  &&
  Number.isFinite(
    targetRandomExpected
  )
  &&
  targetExtraRate >
    targetRandomExpected +
    0.15;


const recipientCountLikelyNotRewardDeterminant =
  Number.isFinite(
    recipientCountCoefficient
  )
  &&
  Math.abs(
    recipientCountCoefficient
  ) <
  3;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script90Passed:
      check(
        summary90
          ?.validation
          ?.pass,
        true,
        summary90
          ?.validation
          ?.pass ===
        true
      ),


    sourceCaseCount:
      check(
        sourceCases.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? sourceCases.length ===
            991
          : sourceCases.length >
            0
      ),


    normalizedCaseCount:
      check(
        cases.length,
        sourceCases.length,
        cases.length ===
        sourceCases.length
      ),


    primaryCleanCount:
      check(
        primaryClean.length,
        replayName ===
          'test'
          ? 91
          : '>0',
        replayName ===
          'test'
          ? primaryClean.length ===
            91
          : primaryClean.length >
            0
      ),


    primarySingleCount:
      check(
        primarySingle.length,
        replayName ===
          'test'
          ? 27
          : '>0',
        replayName ===
          'test'
          ? primarySingle.length ===
            27
          : primarySingle.length >
            0
      ),


    primaryMultiCount:
      check(
        primaryMulti.length,
        replayName ===
          'test'
          ? 64
          : '>0',
        replayName ===
          'test'
          ? primaryMulti.length ===
            64
          : primaryMulti.length >
            0
      ),


    rewardModelCasesPresent:
      check(
        rewardModelCohort.length,
        '>0',
        rewardModelCohort.length >
        0
      ),


    baseTypesPresent:
      check(
        baseTypes.length,
        '>=2',
        baseTypes.length >=
        2
      ),


    modelBResolved:
      check(
        Boolean(
          modelB
        ),
        true,
        Boolean(
          modelB
        )
      ),


    modelDResolved:
      check(
        Boolean(
          modelD
        ),
        true,
        Boolean(
          modelD
        )
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
      'ASSIGNED_GOLD_INTEGER_SHARING_REWARD_VALIDATION_V01',

    canonical:
      false,

    status:
      validationPass
        ? integerSharingStrong
          ? 'INTEGER_EQUAL_SHARE_STRONGLY_SUPPORTED'
          : 'INTEGER_SHARE_AND_REWARD_DIAGNOSTIC_COMPLETE'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Test whether same-team exact-tick ground-soul economy deltas are integer-rounded equal shares of one reconstructed reward total.',

        'Determine whether the credited last-hitter or physical vacuum target receives priority for integer remainders.',

        'Reconstruct complete reward totals independently of number of recipients.',

        'Model reconstructed reward magnitude as a function of match time and Trooper type.',

        'Test whether recipient count independently predicts reconstructed total reward after type/time adjustment.'
      ],


    semanticLimits:
      {

        sharing:
          'Integer equal partition is observational evidence for a shared reward rule, not engine-source proof.',

        teamTotal:
          'teamTotal is the sum of same-team positive m_nCurrencies.0000 deltas at the validated exact AssignedGold resolution tick.',

        rewardModel:
          'Reward regressions are descriptive single-replay models and should not be promoted to canonical Deadlock economy formulas.',

        baseType:
          'Trooper base types are currently useful operational classifications but broader variant economics remain provisional.',

        variants:
          'Variant labels are exploratory only.',

        failureCases:
          'Integer-partition failures may represent unrelated simultaneous economy, incomplete recipient observation, or a genuinely different economic rule.'
      },


    cohorts:
      {

        allCases:
          cases.length,

        primaryClean:
          primaryClean.length,

        primarySingle:
          primarySingle.length,

        primaryMulti:
          primaryMulti.length,

        integerPartitionExact:
          integerPartitionExact.length,

        integerPartitionFailure:
          integerPartitionFailure.length,

        multiIntegerPartitionExact:
          multiIntegerPartitionExact.length,

        multiIntegerPartitionFailure:
          multiIntegerPartitionFailure.length,

        rewardModelCohort:
          rewardModelCohort.length
      },


    integerSharing:
      {

        overallPartitionRate:
          overallPartitionRate,

        multiPartitionRate:
          integerShareRate,

        multiSpreadLE1:
          multiSpreadLE1.length,

        multiSpreadLE1Rate:
          rate(
            multiSpreadLE1.length,
            primaryMulti.length
          ),

        remainderCases:
          remainderCases.length
      },


    remainderAllocation:
      {

        credited:
          {

            comparable:
              creditedEligibleForExtra.length,

            getsExtra:
              creditedGetsExtra.length,

            getsExtraRate:
              creditedExtraRate,

            randomExpectedRate:
              creditedRandomExpected,

            priorityCandidate:
              creditedRemainderPriorityCandidate
          },

        physicalTarget:
          {

            comparable:
              targetRemainderComparable.length,

            getsExtra:
              targetGetsExtra.length,

            getsExtraRate:
              targetExtraRate,

            randomExpectedRate:
              targetRandomExpected,

            priorityCandidate:
              targetRemainderPriorityCandidate
          }
      },


    vacuumTargetRole:
      {

        mismatchIntegerExact:
          mismatchIntegerExact.length,

        targetEconomicallyPresent:
          mismatchTargetPresent.length,

        targetEconomicallyAbsent:
          mismatchTargetAbsent.length,

        nonTargetPeerPresent:
          mismatchNonTargetPeerPresent.length
      },


    reconstructedReward:
      {

        distribution:
          summarizeNumbers(
            rewardModelCohort.map(
              row =>
                row.teamTotal
            )
          ),

        modes:
          topValueCounts(
            rewardModelCohort.map(
              row =>
                row.teamTotal
            ),
            30
          ),

        byRecipientCount,

        byBaseType,

        byTimeBand,

        byTypeAndTime
      },


    rewardModels:
      {

        baseTypes,

        referenceBaseType,

        provisionalVariants:
          variantLabels,

        provisionalVariantReference:
          variantReference,

        continuous:
          modelComparison,

        rounded:
          roundedModelComparison,

        bestContinuous:
          bestModel,

        recipientCountCoefficient,

        recipientCountLikelyNotRewardDeterminant,

        typeSpecificRegressions:
          typeRegressions
      },


    partitionFailures:
      partitionFailureCases,


    amountCaseTable,


    interpretiveFlags:
      {

        integerSharingStrong,

        creditedRemainderPriorityCandidate,

        targetRemainderPriorityCandidate,

        recipientCountLikelyNotRewardDeterminant
      },


    interpretationGuide:
      {

        integerShare:
          'If >=90% of clean multi-recipient cases exactly equal an integer partition of the reconstructed team total, shared ground-soul economy is strongly supported.',

        remainder:
          'If recipients differ only by one unit and the number receiving the higher amount equals teamTotal mod recipientCount, those ±1 differences are explained by integer rounding rather than unequal reward valuation.',

        vacuumTarget:
          'If the physical target is sometimes economically absent and has no remainder priority, m_hVacuumTarget should remain a physical vacuum field rather than an economic ownership field.',

        creditedPlayer:
          'If credited player always participates but does not systematically receive remainder priority, the last-hitter may anchor eligibility while the reward itself is then divided among qualifying allies.',

        recipientCount:
          'A near-zero recipient-count coefficient after match time and type adjustment supports conservation of the underlying total reward under sharing.',

        rewardSchedule:
          'The reward models identify whether exact total reward is largely a function of match time and Trooper type. Strong residual structure would indicate additional modifiers still need discovery.',

        next:
          integerSharingStrong
            ? 'Use the reconstructed teamTotal stream to determine the exact match-time/type reward function and discover any remaining modifiers before cross-replay replication.'
            : 'Inspect the integer-partition failure cases before treating same-team exact-tick deltas as one shared reward event.'
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


const writer =
  createWriteStream(
    outputCasesPath,
    {
      encoding:
        'utf8'
    }
  );


for (
  const row
  of cases
) {

  writer.write(
    `${JSON.stringify(row)}\n`
  );
}


await finishWriter(
  writer
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD INTEGER SHARING + REWARD VALIDATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'INTEGER EQUAL-SHARE TEST'
);

console.log(
  '------------------------'
);


console.log(
  `Primary clean:               ${primaryClean.length}`
);


console.log(
  `Multi-recipient:             ${primaryMulti.length}`
);


console.log(
  `Exact integer partitions:    ${multiIntegerPartitionExact.length}/${primaryMulti.length} (${formatPercent(integerShareRate)})`
);


console.log(
  `Spread <=1:                  ${multiSpreadLE1.length}/${primaryMulti.length} (${formatPercent(
    rate(
      multiSpreadLE1.length,
      primaryMulti.length
    )
  )})`
);


console.log(
  `Partition failures:          ${multiIntegerPartitionFailure.length}`
);


console.log('');

console.log(
  'REMAINDER ALLOCATION'
);

console.log(
  '--------------------'
);


console.log(
  `Remainder cases:                 ${remainderCases.length}`
);


console.log(
  `Credited gets +1:                ${creditedGetsExtra.length}/${creditedEligibleForExtra.length} (${formatPercent(creditedExtraRate)})`
);


console.log(
  `Credited random expectation:     ${formatPercent(creditedRandomExpected)}`
);


console.log(
  `Credited priority candidate:     ${creditedRemainderPriorityCandidate}`
);


console.log(
  `Vacuum target gets +1:           ${targetGetsExtra.length}/${targetRemainderComparable.length} (${formatPercent(targetExtraRate)})`
);


console.log(
  `Target random expectation:       ${formatPercent(targetRandomExpected)}`
);


console.log(
  `Target priority candidate:       ${targetRemainderPriorityCandidate}`
);


console.log('');

console.log(
  'PHYSICAL TARGET ECONOMIC ROLE'
);

console.log(
  '-----------------------------'
);


console.log(
  `Mismatch partition-exact cases: ${mismatchIntegerExact.length}`
);


console.log(
  `Target economically present:     ${mismatchTargetPresent.length}`
);


console.log(
  `Target economically absent:      ${mismatchTargetAbsent.length}`
);


console.log(
  `Non-target peer present:         ${mismatchNonTargetPeerPresent.length}`
);


console.log('');

console.log(
  'RECONSTRUCTED TOTAL REWARD'
);

console.log(
  '--------------------------'
);


console.log(
  formatDistribution(
    summarizeNumbers(
      rewardModelCohort.map(
        row =>
          row.teamTotal
      )
    )
  )
);


console.log('');

console.log(
  'TOP TOTAL-REWARD MODES'
);


printModes(
  topValueCounts(
    rewardModelCohort.map(
      row =>
        row.teamTotal
    ),
    25
  )
);


console.log('');

console.log(
  'TOTAL REWARD BY RECIPIENT COUNT'
);

console.log(
  '-------------------------------'
);


printGroupSummaries(
  byRecipientCount
);


console.log('');

console.log(
  'TOTAL REWARD BY TROOPER TYPE'
);

console.log(
  '----------------------------'
);


printGroupSummaries(
  byBaseType
);


console.log('');

console.log(
  'TOTAL REWARD BY TYPE + MATCH TIME'
);

console.log(
  '---------------------------------'
);


printGroupSummaries(
  byTypeAndTime
);


console.log('');

console.log(
  'REWARD MODEL COMPARISON'
);

console.log(
  '-----------------------'
);


for (
  const model
  of modelComparison
) {

  console.log('');

  console.log(
    model.id
  );


  console.log(
    `  n=${model.count}`
  );


  console.log(
    `  RMSE=${formatNumber(model.rmse)}`
  );


  console.log(
    `  MAE=${formatNumber(model.mae)}`
  );


  console.log(
    `  R2=${formatNumber(model.rSquared)}`
  );


  console.log(
    `  maxAbs=${formatNumber(model.maxAbsoluteResidual)}`
  );


  console.log(
    `  coefficients=${JSON.stringify(model.coefficients)}`
  );
}


console.log('');

console.log(
  'ROUNDED INTEGER MODEL COMPARISON'
);

console.log(
  '--------------------------------'
);


for (
  const model
  of roundedModelComparison
) {

  console.log(

    `${model.id.padEnd(42)} ` +

    `RMSE=${formatNumber(model.rmse).padStart(8)} ` +

    `MAE=${formatNumber(model.mae).padStart(8)} ` +

    `exact=${formatPercent(model.exactRate).padStart(8)} ` +

    `within1=${formatPercent(model.within1Rate).padStart(8)} ` +

    `within2=${formatPercent(model.within2Rate).padStart(8)}`
  );
}


console.log('');

console.log(
  'RECIPIENT COUNT EFFECT'
);

console.log(
  '----------------------'
);


console.log(
  `Recipient-count coefficient: ${formatNumber(recipientCountCoefficient)} reward units / additional recipient`
);


console.log(
  `Likely not reward determinant: ${recipientCountLikelyNotRewardDeterminant}`
);


console.log('');

console.log(
  'TYPE-SPECIFIC TIME REGRESSIONS'
);

console.log(
  '------------------------------'
);


for (
  const [
    baseType,
    regression
  ]
  of Object.entries(
    typeRegressions
  )
) {

  console.log(

    `${baseType.padEnd(12)} ` +

    `n=${String(regression?.count ?? 0).padStart(3)} ` +

    `slope=${formatNumber(regression?.slope).padStart(8)} ` +

    `intercept=${formatNumber(regression?.intercept).padStart(9)} ` +

    `R2=${formatNumber(regression?.rSquared).padStart(7)} ` +

    `RMSE=${formatNumber(regression?.rmse).padStart(7)}`
  );
}


if (
  partitionFailureCases.length >
  0
) {

  console.log('');

  console.log(
    'INTEGER PARTITION FAILURES'
  );

  console.log(
    '--------------------------'
  );


  for (
    const row
    of partitionFailureCases
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)} ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `${String(row.baseType ?? '').padEnd(8)} ` +

      `n=${row.recipientCount} ` +

      `total=${row.teamTotal} ` +

      `shares=[${row.recipientDeltas.join(',')}] ` +

      `spread=${row.spread}`
    );
  }
}


console.log('');

console.log(
  'INTERPRETIVE FLAGS'
);

console.log(
  '------------------'
);


console.log(
  `Integer sharing strong:                ${integerSharingStrong}`
);


console.log(
  `Credited remainder priority:           ${creditedRemainderPriorityCandidate}`
);


console.log(
  `Physical-target remainder priority:    ${targetRemainderPriorityCandidate}`
);


console.log(
  `Recipient count likely not determinant:${recipientCountLikelyNotRewardDeterminant}`
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
    result
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(

    `${result.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(38)} ` +

    `actual=${JSON.stringify(result.actual)} ` +

    `expected=${JSON.stringify(result.expected)}`
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
// NORMALIZE CASE
// ============================================================

function normalizeCase(
  row
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    return null;
  }


  const recipientDeltas =
    Array.isArray(
      row?.recipientDeltas
    )
      ? row.recipientDeltas
          .map(
            finite
          )
          .filter(
            Number.isFinite
          )
      : [];


  const recipientCount =
    recipientDeltas.length;


  const teamTotal =
    recipientDeltas.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    );


  const creditedDelta =
    finite(
      row?.creditedDelta
    )
    ??
    0;


  const targetDelta =
    finite(
      row?.targetDelta
    )
    ??
    0;


  const floorShare =
    recipientCount >
      0
      ? Math.floor(
          teamTotal /
          recipientCount
        )
      : null;


  const ceilShare =
    recipientCount >
      0
      ? Math.ceil(
          teamTotal /
          recipientCount
        )
      : null;


  const remainder =
    recipientCount >
      0
      ? teamTotal %
        recipientCount
      : null;


  const actualFloorRecipients =
    floorShare !==
      null
      ? recipientDeltas.filter(
          value =>
            value ===
            floorShare
        ).length
      : 0;


  const actualCeilRecipients =
    ceilShare !==
      null
      ? recipientDeltas.filter(
          value =>
            value ===
            ceilShare
        ).length
      : 0;


  const unexpectedAmounts =
    recipientDeltas.filter(
      value =>
        value !==
          floorShare
        &&
        value !==
          ceilShare
    );


  const expectedCeilRecipients =
    remainder ??
    0;


  const expectedFloorRecipients =
    recipientCount -
    expectedCeilRecipients;


  const spread =
    recipientDeltas.length >
      0
      ? Math.max(
          ...recipientDeltas
        )
        -
        Math.min(
          ...recipientDeltas
        )
      : null;


  const partitionExact =
    recipientCount >
      0
    &&
    unexpectedAmounts.length ===
      0
    &&
    (
      remainder ===
        0
        ? actualFloorRecipients ===
          recipientCount
        : (
          actualCeilRecipients ===
            expectedCeilRecipients
          &&
          actualFloorRecipients ===
            expectedFloorRecipients
        )
    );


  const creditedGetsCeil =
    recipientCount >
      1
    &&
    remainder >
      0
    &&
    creditedDelta ===
      ceilShare;


  const targetGetsCeil =
    recipientCount >
      1
    &&
    remainder >
      0
    &&
    targetDelta ===
      ceilShare;


  const sameTeamRecipients =
    Array.isArray(
      row?.sameTeamRecipients
    )
      ? row.sameTeamRecipients
      : [];


  const creditedPlayerName =
    row?.creditedPlayerName ??
    null;


  const targetPlayerName =
    row?.targetPlayerName ??
    null;


  const nonTargetPeerCount =
    sameTeamRecipients.filter(
      recipient =>
        recipient?.playerName !==
          creditedPlayerName
        &&
        recipient?.playerName !==
          targetPlayerName
    ).length;


  const matchMinute =
    finite(
      row?.matchMinute
    );


  return {

    deathIndex,

    clock:
      row?.clock ??
      null,

    lifecycleClass:
      row?.lifecycleClass ??
      null,

    isolated16:
      row?.isolated16 ===
      true,

    primaryClean:
      row?.primaryClean ===
      true,

    baseType:
      row?.baseType ??
      null,

    variantLabel:
      row?.variantLabel ??
      null,

    matchMinute,

    timeBand:
      classifyTimeBand(
        matchMinute
      ),

    creditedPlayerName,

    targetPlayerName,

    targetDiffersFromCredited:
      row?.targetDiffersFromCredited ===
      true,

    recipientCount,

    recipientDeltas,

    creditedDelta,

    targetDelta,

    teamTotal,

    nonTargetPeerCount,

    integerShare:
      {

        floorShare,

        ceilShare,

        remainder,

        expectedFloorRecipients,

        expectedCeilRecipients,

        actualFloorRecipients,

        actualCeilRecipients,

        unexpectedAmounts,

        spread,

        partitionExact,

        creditedGetsCeil,

        targetGetsCeil
      }
  };
}


// ============================================================
// TIME BAND
// ============================================================

function classifyTimeBand(
  minute
) {

  if (
    !Number.isFinite(
      minute
    )
  ) {

    return 'UNKNOWN';
  }


  const lower =
    Math.floor(
      minute /
      5
    )
    *
    5;


  const upper =
    lower +
    5;


  return `${lower}_TO_LT_${upper}_MIN`;
}


// ============================================================
// GROUP SUMMARY
// ============================================================

function summarizeGroups(
  rows,
  selector
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      String(
        selector(
          row
        )
        ??
        'UNKNOWN'
      );


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );
    }


    groups
      .get(
        key
      )
      .push(
        row
      );
  }


  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          group,
          groupRows
        ]
      ) => {

        const totals =
          groupRows.map(
            row =>
              row.teamTotal
          );


        return {

          group,

          count:
            groupRows.length,

          matchMinute:
            summarizeNumbers(
              groupRows.map(
                row =>
                  row.matchMinute
              )
            ),

          recipientCount:
            summarizeNumbers(
              groupRows.map(
                row =>
                  row.recipientCount
              )
            ),

          teamTotal:
            summarizeNumbers(
              totals
            ),

          modes:
            topValueCounts(
              totals,
              12
            )
        };
      }
    )
    .sort(
      (
        a,
        b
      ) =>
        b.count -
          a.count
        ||
        a.group.localeCompare(
          b.group
        )
    );
}


// ============================================================
// OLS MODEL
// ============================================================

function fitOLSModel(
  rows,
  features
) {

  const usable =
    rows.filter(
      row =>
        Number.isFinite(
          row.teamTotal
        )
        &&
        features.every(
          feature =>
            Number.isFinite(
              feature.value(
                row
              )
            )
        )
    );


  if (
    usable.length <
    features.length
  ) {

    return null;
  }


  const X =
    usable.map(
      row =>
        features.map(
          feature =>
            feature.value(
              row
            )
        )
    );


  const y =
    usable.map(
      row =>
        row.teamTotal
    );


  const xtx =
    multiplyTransposeSelf(
      X
    );


  const xty =
    multiplyTransposeVector(
      X,
      y
    );


  const beta =
    solveLinearSystem(
      xtx,
      xty
    );


  if (
    !beta
  ) {

    return null;
  }


  const predictions =
    X.map(
      row =>
        dot(
          row,
          beta
        )
    );


  const residuals =
    y.map(
      (
        actual,
        index
      ) =>
        actual -
        predictions[
          index
        ]
    );


  const absoluteResiduals =
    residuals.map(
      Math.abs
    );


  const meanY =
    mean(
      y
    );


  const sse =
    residuals.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value *
        value,
      0
    );


  const sst =
    y.reduce(
      (
        sum,
        value
      ) => {

        const delta =
          value -
          meanY;


        return sum +
        delta *
        delta;
      },
      0
    );


  const coefficients =
    {};


  for (
    let i = 0;
    i <
    features.length;
    i++
  ) {

    coefficients[
      features[i].name
    ] =
      beta[i];
  }


  return {

    count:
      usable.length,

    featureNames:
      features.map(
        feature =>
          feature.name
      ),

    coefficients,

    rmse:
      Math.sqrt(
        sse /
        usable.length
      ),

    mae:
      mean(
        absoluteResiduals
      ),

    maxAbsoluteResidual:
      Math.max(
        ...absoluteResiduals
      ),

    rSquared:
      sst >
        0
        ? 1 -
          sse /
          sst
        : null,

    residualDistribution:
      summarizeNumbers(
        residuals
      ),

    predictions:
      usable.map(
        (
          row,
          index
        ) => ({

          deathIndex:
            row.deathIndex,

          actual:
            y[index],

          predicted:
            predictions[index],

          residual:
            residuals[index]
        }))
  };
}


// ============================================================
// ROUNDED MODEL EVALUATION
// ============================================================

function evaluateRoundedModel(
  rows,
  model
) {

  const predictionByDeath =
    new Map(
      (
        model.predictions ??
        []
      )
      .map(
        row => [

          row.deathIndex,
          row.predicted
        ]
      )
    );


  const residuals =
    [];


  let exact =
    0;


  let within1 =
    0;


  let within2 =
    0;


  for (
    const row
    of rows
  ) {

    const continuous =
      predictionByDeath.get(
        row.deathIndex
      );


    if (
      !Number.isFinite(
        continuous
      )
    ) {

      continue;
    }


    const predicted =
      Math.round(
        continuous
      );


    const residual =
      row.teamTotal -
      predicted;


    residuals.push(
      residual
    );


    const absolute =
      Math.abs(
        residual
      );


    if (
      absolute ===
      0
    ) {

      exact++;
    }


    if (
      absolute <=
      1
    ) {

      within1++;
    }


    if (
      absolute <=
      2
    ) {

      within2++;
    }
  }


  const absoluteResiduals =
    residuals.map(
      Math.abs
    );


  return {

    id:
      model.id,

    count:
      residuals.length,

    rmse:
      residuals.length >
        0
        ? Math.sqrt(
          mean(
            residuals.map(
              value =>
                value *
                value
            )
          )
        )
        : null,

    mae:
      residuals.length >
        0
        ? mean(
          absoluteResiduals
        )
        : null,

    exact,

    exactRate:
      rate(
        exact,
        residuals.length
      ),

    within1,

    within1Rate:
      rate(
        within1,
        residuals.length
      ),

    within2,

    within2Rate:
      rate(
        within2,
        residuals.length
      ),

    residualDistribution:
      summarizeNumbers(
        residuals
      )
  };
}


// ============================================================
// SIMPLE REGRESSION
// ============================================================

function fitSimpleRegression(
  points
) {

  const clean =
    points.filter(
      row =>
        Number.isFinite(
          row?.x
        )
        &&
        Number.isFinite(
          row?.y
        )
    );


  if (
    clean.length <
    2
  ) {

    return null;
  }


  const meanX =
    mean(
      clean.map(
        row =>
          row.x
      )
    );


  const meanY =
    mean(
      clean.map(
        row =>
          row.y
      )
    );


  let numerator =
    0;


  let denominator =
    0;


  for (
    const row
    of clean
  ) {

    numerator +=
      (
        row.x -
        meanX
      )
      *
      (
        row.y -
        meanY
      );


    denominator +=
      (
        row.x -
        meanX
      )
      *
      (
        row.x -
        meanX
      );
  }


  if (
    denominator ===
    0
  ) {

    return null;
  }


  const slope =
    numerator /
    denominator;


  const intercept =
    meanY -
    slope *
    meanX;


  const residuals =
    clean.map(
      row =>
        row.y -
        (
          intercept +
          slope *
          row.x
        )
    );


  const sse =
    residuals.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value *
        value,
      0
    );


  const sst =
    clean.reduce(
      (
        sum,
        row
      ) => {

        const delta =
          row.y -
          meanY;


        return sum +
        delta *
        delta;
      },
      0
    );


  return {

    count:
      clean.length,

    slope,

    intercept,

    rmse:
      Math.sqrt(
        sse /
        clean.length
      ),

    rSquared:
      sst >
        0
        ? 1 -
          sse /
          sst
        : null
  };
}


// ============================================================
// MATRIX HELPERS
// ============================================================

function multiplyTransposeSelf(
  matrix
) {

  const columns =
    matrix[0].length;


  const result =
    Array.from(
      {
        length:
          columns
      },
      () =>
        Array(
          columns
        ).fill(
          0
        )
    );


  for (
    const row
    of matrix
  ) {

    for (
      let i = 0;
      i <
      columns;
      i++
    ) {

      for (
        let j = 0;
        j <
        columns;
        j++
      ) {

        result[i][j] +=
          row[i] *
          row[j];
      }
    }
  }


  return result;
}


function multiplyTransposeVector(
  matrix,
  vector
) {

  const columns =
    matrix[0].length;


  const result =
    Array(
      columns
    ).fill(
      0
    );


  for (
    let r = 0;
    r <
    matrix.length;
    r++
  ) {

    for (
      let c = 0;
      c <
      columns;
      c++
    ) {

      result[c] +=
        matrix[r][c] *
        vector[r];
    }
  }


  return result;
}


function solveLinearSystem(
  matrix,
  vector
) {

  const n =
    matrix.length;


  const augmented =
    matrix.map(
      (
        row,
        index
      ) => [

        ...row,
        vector[index]
      ]
    );


  for (
    let column = 0;
    column <
    n;
    column++
  ) {

    let pivotRow =
      column;


    for (
      let row = column + 1;
      row <
      n;
      row++
    ) {

      if (
        Math.abs(
          augmented[row][column]
        )
        >
        Math.abs(
          augmented[pivotRow][column]
        )
      ) {

        pivotRow =
          row;
      }
    }


    if (
      Math.abs(
        augmented[pivotRow][column]
      )
      <
      1e-10
    ) {

      return null;
    }


    [
      augmented[column],
      augmented[pivotRow]
    ] =
      [
        augmented[pivotRow],
        augmented[column]
      ];


    const pivot =
      augmented[column][column];


    for (
      let c = column;
      c <=
      n;
      c++
    ) {

      augmented[column][c] /=
        pivot;
    }


    for (
      let row = 0;
      row <
      n;
      row++
    ) {

      if (
        row ===
        column
      ) {

        continue;
      }


      const factor =
        augmented[row][column];


      for (
        let c = column;
        c <=
        n;
        c++
      ) {

        augmented[row][c] -=
          factor *
          augmented[column][c];
      }
    }
  }


  return augmented.map(
    row =>
      row[n]
  );
}


function dot(
  a,
  b
) {

  let sum =
    0;


  for (
    let i = 0;
    i <
    a.length;
    i++
  ) {

    sum +=
      a[i] *
      b[i];
  }


  return sum;
}


// ============================================================
// MODES
// ============================================================

function topValueCounts(
  source,
  limit
) {

  const counts =
    new Map();


  for (
    const value
    of source
  ) {

    if (
      !Number.isFinite(
        value
      )
    ) {

      continue;
    }


    counts.set(
      value,
      (
        counts.get(
          value
        )
        ??
        0
      )
      +
      1
    );
  }


  return [
    ...counts.entries()
  ]
    .map(
      (
        [
          value,
          count
        ]
      ) => ({

        value,

        count
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        b.count -
          a.count
        ||
        a.value -
          b.value
    )
    .slice(
      0,
      limit
    );
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


async function finishWriter(
  writer
) {

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
// NUMERIC HELPERS
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


function sanitizeName(
  value
) {

  return String(
    value
  )
  .replace(
    /[^A-Za-z0-9]+/g,
    '_'
  )
  .replace(
    /^_+|_+$/g,
    ''
  );
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
// PRINT HELPERS
// ============================================================

function printModes(
  modes
) {

  if (
    modes.length ===
    0
  ) {

    console.log(
      'n/a'
    );

    return;
  }


  console.log(
    modes
      .map(
        row =>
          `${row.value}×${row.count}`
      )
      .join(
        '  '
      )
  );
}


function printGroupSummaries(
  groups
) {

  if (
    groups.length ===
    0
  ) {

    console.log(
      'None.'
    );

    return;
  }


  for (
    const row
    of groups
  ) {

    console.log('');

    console.log(
      `${row.group}  n=${row.count}`
    );


    console.log(
      `  match minute: ${formatDistribution(row.matchMinute)}`
    );


    console.log(
      `  recipients:   ${formatDistribution(row.recipientCount)}`
    );


    console.log(
      `  team total:   ${formatDistribution(row.teamTotal)}`
    );


    if (
      row.modes.length >
      0
    ) {

      console.log(
        `  modes: ${row.modes
          .map(
            mode =>
              `${mode.value}×${mode.count}`
          )
          .join(
            ' '
          )}`
      );
    }
  }
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