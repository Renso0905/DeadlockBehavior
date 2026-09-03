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


// ============================================================
// PURPOSE
//
// Scripts 88-92 established:
//
//   - credited last-hitter is the economic assignment anchor
//   - physical m_hVacuumTarget is not necessarily economic
//   - economic recipient pool is fixed by death-time geometry
//   - reconstructed rewards form integer share partitions
//
// Script93 established:
//
//   - ordinary ground reward ≈ 50 + 1/min
//   - documented recipient-count sharing is strongly supported
//
// Script95 established:
//
//   - Super Trooper ≈ 0.85 bounty factor
//   - trailing-team comeback is required
//   - predefined Super 0.85 + comeback 26% reduces RMSE to
//     approximately one-soul rounding scale
//
// Earlier remainder analysis suggested:
//
//   credited last-hitter receives the +1 integer remainder
//   with very high probability.
//
// BUT:
//
// earlier predicted reward pools did not yet account for both
// Super and comeback modifiers.
//
// Script96 therefore performs the FINAL allocation validation.
//
// It asks:
//
//   1. Does the observed recipient allocation remain an exact
//      integer partition of the OBSERVED team reward?
//
//   2. Among cases where Script95 predicts the complete team
//      reward exactly, does the predicted integer partition also
//      exactly reproduce the observed amount multiset?
//
//   3. When integer division leaves a remainder, does the
//      credited last-hitter preferentially receive a ceil share?
//
//   4. Does the physical vacuum target show comparable remainder
//      priority?
//
//   5. What remains unresolved once reward magnitude and sharing
//      are jointly modeled?
//
// No new mechanic is fitted here.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const summary95Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_super_comeback_interaction_validation_v01.json'
  );


const cases95Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_super_comeback_interaction_cases_v01.jsonl'
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
    'assigned_gold_final_integer_allocation_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_final_integer_allocation_cases_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    summary95Path,
    cases95Path,
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
// LOAD
// ============================================================

const summary95 =
  JSON.parse(
    readFileSync(
      summary95Path,
      'utf8'
    )
  );


if (
  summary95
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 95 did not PASS.'
  );
}


console.log('');

console.log(
  'Loading Script 95 corrected reward cases...'
);


const cases95 =
  await loadJsonl(
    cases95Path
  );


console.log(
  `Script 95 cases: ${cases95.length}`
);


console.log(
  'Loading Script 90 economic recipient cases...'
);


const cases90 =
  await loadJsonl(
    cases90Path
  );


console.log(
  `Script 90 cases: ${cases90.length}`
);


// ============================================================
// INDEX SCRIPT90
// ============================================================

const case90ByDeath =
  new Map();


for (
  const row
  of cases90
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    case90ByDeath.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// JOIN
// ============================================================

const cases =
  [];


for (
  const source95
  of cases95
) {

  const deathIndex =
    finite(
      source95?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const source90 =
    case90ByDeath.get(
      deathIndex
    )
    ??
    null;


  if (
    !source90
  ) {

    continue;
  }


  const recipients =
    normalizeRecipients(
      source90
        ?.sameTeamRecipients
    );


  if (
    recipients.length ===
    0
  ) {

    continue;
  }


  const observedTeamTotal =
    recipients.reduce(
      (
        sum,
        recipient
      ) =>
        sum +
        recipient.positiveDelta,
      0
    );


  const sourceTeamTotal =
    finite(
      source95?.teamTotal
    );


  const predictedTeamTotal =
    finite(
      source95?.predictedTeamTotal
    );


  const creditedPlayerName =
    source95
      ?.creditedPlayerName ??
    source90
      ?.creditedPlayerName ??
    null;


  const targetPlayerName =
    source90
      ?.targetPlayerName ??
    null;


  if (
    sourceTeamTotal ===
      null
    ||
    predictedTeamTotal ===
      null
    ||
    !creditedPlayerName
  ) {

    continue;
  }


  const recipientCount =
    recipients.length;


  const observedPartition =
    buildIntegerPartition(
      observedTeamTotal,
      recipientCount
    );


  const predictedPartition =
    buildIntegerPartition(
      predictedTeamTotal,
      recipientCount
    );


  const actualAmounts =
    recipients
      .map(
        row =>
          row.positiveDelta
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  const creditedRecipient =
    recipients.find(
      row =>
        row.playerName ===
        creditedPlayerName
    )
    ??
    null;


  const targetRecipient =
    targetPlayerName
      ? recipients.find(
          row =>
            row.playerName ===
            targetPlayerName
        )
        ??
        null
      : null;


  const observedPartitionExact =
    arraysEqual(
      actualAmounts,
      observedPartition.amounts
    );


  const predictedPartitionExact =
    arraysEqual(
      actualAmounts,
      predictedPartition.amounts
    );


  const rewardTotalExact =
    predictedTeamTotal ===
    observedTeamTotal;


  const rewardError =
    observedTeamTotal -
    predictedTeamTotal;


  const creditedObservedCeil =
    creditedRecipient
    &&
    observedPartition.remainder >
      0
      ? creditedRecipient.positiveDelta ===
        observedPartition.ceilShare
      : null;


  const targetObservedCeil =
    targetRecipient
    &&
    observedPartition.remainder >
      0
      ? targetRecipient.positiveDelta ===
        observedPartition.ceilShare
      : null;


  const creditedPredictedCeil =
    creditedRecipient
    &&
    predictedPartition.remainder >
      0
      ? creditedRecipient.positiveDelta ===
        predictedPartition.ceilShare
      : null;


  const targetPredictedCeil =
    targetRecipient
    &&
    predictedPartition.remainder >
      0
      ? targetRecipient.positiveDelta ===
        predictedPartition.ceilShare
      : null;


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      source95?.clock ??
      source90?.clock ??
      null,

    matchMinute:
      finite(
        source95?.matchMinute
      ),

    creditedTeam:
      finite(
        source95?.creditedTeam
      ),

    creditedPlayerName,

    targetPlayerName,

    targetDiffersFromCredited:
      Boolean(
        targetPlayerName
      )
      &&
      targetPlayerName !==
        creditedPlayerName,

    baseType:
      source95?.baseType ??
      null,

    variantLabel:
      source95?.variantLabel ??
      null,

    isSuper:
      source95?.isSuper ===
      true,

    creditedTeamStatus:
      source95
        ?.creditedTeamStatus ??
      null,

    recipientCount,

    recipients,

    actualAmounts,

    observedTeamTotal,

    sourceTeamTotal,

    sourceTotalAgreement:
      observedTeamTotal ===
      sourceTeamTotal,

    predictedTeamTotal,

    predictedRaw:
      finite(
        source95?.predictedRaw
      ),

    rewardError,

    absoluteRewardError:
      Math.abs(
        rewardError
      ),

    rewardTotalExact,

    observedPartition,

    predictedPartition,

    observedPartitionExact,

    predictedPartitionExact,

    creditedRecipient,

    targetRecipient,

    creditedIsRecipient:
      Boolean(
        creditedRecipient
      ),

    targetIsRecipient:
      Boolean(
        targetRecipient
      ),

    creditedObservedCeil,

    targetObservedCeil,

    creditedPredictedCeil,

    targetPredictedCeil
  });
}


console.log('');

console.log(
  `Joined allocation cases: ${cases.length}`
);


// ============================================================
// BASIC VALIDATION COHORTS
// ============================================================

const sourceTotalAgreementCases =
  cases.filter(
    row =>
      row.sourceTotalAgreement
  );


const observedPartitionExactCases =
  cases.filter(
    row =>
      row.observedPartitionExact
  );


const predictedPartitionExactCases =
  cases.filter(
    row =>
      row.predictedPartitionExact
  );


const rewardExactCases =
  cases.filter(
    row =>
      row.rewardTotalExact
  );


const rewardWithin1Cases =
  cases.filter(
    row =>
      row.absoluteRewardError <=
      1
  );


const rewardWithin2Cases =
  cases.filter(
    row =>
      row.absoluteRewardError <=
      2
  );


// ============================================================
// CREDITED RECIPIENT
// ============================================================

const creditedRecipientCases =
  cases.filter(
    row =>
      row.creditedIsRecipient
  );


const creditedAbsentCases =
  cases.filter(
    row =>
      !row.creditedIsRecipient
  );


// ============================================================
// OBSERVED REMAINDER PRIORITY
//
// This is independent of Script95 reward prediction.
//
// We use the ACTUAL reconstructed reward pool.
//
// Comparable:
//
//   recipientCount > 1
//   observed pool has non-zero remainder
// ============================================================

const observedRemainderCases =
  cases.filter(
    row =>
      row.recipientCount >
        1
      &&
      row.observedPartition.remainder >
        0
  );


const observedCreditedComparable =
  observedRemainderCases.filter(
    row =>
      row.creditedRecipient
  );


const observedCreditedGetsCeil =
  observedCreditedComparable.filter(
    row =>
      row.creditedObservedCeil ===
      true
  );


const observedCreditedRandomExpectation =
  weightedRandomExpectation(
    observedCreditedComparable,
    row =>
      row.observedPartition.remainder /
      row.recipientCount
  );


// ============================================================
// PHYSICAL TARGET REMAINDER
//
// Only compare:
//   target != credited
//   target is an economic recipient
//   actual pool has remainder
// ============================================================

const observedTargetComparable =
  observedRemainderCases.filter(
    row =>
      row.targetDiffersFromCredited
      &&
      row.targetRecipient
  );


const observedTargetGetsCeil =
  observedTargetComparable.filter(
    row =>
      row.targetObservedCeil ===
      true
  );


const observedTargetRandomExpectation =
  weightedRandomExpectation(
    observedTargetComparable,
    row =>
      row.observedPartition.remainder /
      row.recipientCount
  );


// ============================================================
// MODEL-EXACT REMAINDER PRIORITY
//
// Strongest validation cohort:
//
//   Script95 predicts team reward exactly.
//
// Then:
//
//   predicted partition == actual pool,
//   so remainder identity is tested without total-reward error.
// ============================================================

const modelExactRemainderCases =
  rewardExactCases.filter(
    row =>
      row.recipientCount >
        1
      &&
      row.predictedPartition.remainder >
        0
  );


const modelExactCreditedComparable =
  modelExactRemainderCases.filter(
    row =>
      row.creditedRecipient
  );


const modelExactCreditedGetsCeil =
  modelExactCreditedComparable.filter(
    row =>
      row.creditedPredictedCeil ===
      true
  );


const modelExactCreditedRandomExpectation =
  weightedRandomExpectation(
    modelExactCreditedComparable,
    row =>
      row.predictedPartition.remainder /
      row.recipientCount
  );


const modelExactTargetComparable =
  modelExactRemainderCases.filter(
    row =>
      row.targetDiffersFromCredited
      &&
      row.targetRecipient
  );


const modelExactTargetGetsCeil =
  modelExactTargetComparable.filter(
    row =>
      row.targetPredictedCeil ===
      true
  );


const modelExactTargetRandomExpectation =
  weightedRandomExpectation(
    modelExactTargetComparable,
    row =>
      row.predictedPartition.remainder /
      row.recipientCount
  );


// ============================================================
// REWARD ERROR GROUPS
// ============================================================

const byVariant =
  summarizeGroups(
    cases,
    row =>
      row.variantLabel ??
      'UNKNOWN'
  );


const bySuper =
  summarizeGroups(
    cases,
    row =>
      row.isSuper
        ? 'SUPER'
        : 'NON_SUPER'
  );


const byTeamStatus =
  summarizeGroups(
    cases,
    row =>
      row.creditedTeamStatus ??
      'UNKNOWN'
  );


const byRecipientCount =
  summarizeGroups(
    cases,
    row =>
      String(
        row.recipientCount
      )
  );


const byTime =
  summarizeGroups(
    cases,
    row =>
      classifyTimeBand(
        row.matchMinute
      )
  );


// ============================================================
// REWARD-ERROR CASES
// ============================================================

const rewardMismatchCases =
  cases
    .filter(
      row =>
        !row.rewardTotalExact
    )
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.absoluteRewardError -
          a.absoluteRewardError
        ||
        a.deathIndex -
          b.deathIndex
    );


// ============================================================
// REMAINDER IDENTITY DETAILS
// ============================================================

const remainderDetail =
  observedRemainderCases.map(
    row => {

      const ceilRecipients =
        row.recipients
          .filter(
            recipient =>
              recipient.positiveDelta ===
              row.observedPartition.ceilShare
          )
          .map(
            recipient =>
              recipient.playerName
          );


      const floorRecipients =
        row.recipients
          .filter(
            recipient =>
              recipient.positiveDelta ===
              row.observedPartition.floorShare
          )
          .map(
            recipient =>
              recipient.playerName
          );


      return {

        deathIndex:
          row.deathIndex,

        clock:
          row.clock,

        recipientCount:
          row.recipientCount,

        observedTeamTotal:
          row.observedTeamTotal,

        remainder:
          row.observedPartition.remainder,

        floorShare:
          row.observedPartition.floorShare,

        ceilShare:
          row.observedPartition.ceilShare,

        creditedPlayerName:
          row.creditedPlayerName,

        creditedGetsCeil:
          row.creditedObservedCeil,

        targetPlayerName:
          row.targetPlayerName,

        targetIsRecipient:
          row.targetIsRecipient,

        targetGetsCeil:
          row.targetObservedCeil,

        ceilRecipients,

        floorRecipients
      };
    }
  );


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const observedIntegerPartitionStrong =
  rate(
    observedPartitionExactCases.length,
    cases.length
  ) >=
  0.95;


const correctedRewardStrong =
  rate(
    rewardWithin2Cases.length,
    cases.length
  ) >=
  0.95;


const creditedAlwaysIncluded =
  creditedAbsentCases.length ===
  0;


const creditedObservedRemainderRate =
  rate(
    observedCreditedGetsCeil.length,
    observedCreditedComparable.length
  );


const creditedModelExactRemainderRate =
  rate(
    modelExactCreditedGetsCeil.length,
    modelExactCreditedComparable.length
  );


const targetObservedRemainderRate =
  rate(
    observedTargetGetsCeil.length,
    observedTargetComparable.length
  );


const targetModelExactRemainderRate =
  rate(
    modelExactTargetGetsCeil.length,
    modelExactTargetComparable.length
  );


const creditedRemainderPriorityStrong =
  Number.isFinite(
    creditedObservedRemainderRate
  )
  &&
  Number.isFinite(
    observedCreditedRandomExpectation
  )
  &&
  creditedObservedRemainderRate >=
    0.90
  &&
  creditedObservedRemainderRate >
    observedCreditedRandomExpectation +
    0.25;


const creditedRemainderPriorityModelConfirmed =
  modelExactCreditedComparable.length >=
    10
  &&
  Number.isFinite(
    creditedModelExactRemainderRate
  )
  &&
  creditedModelExactRemainderRate >=
    0.90;


const physicalTargetRemainderPriorityStrong =
  observedTargetComparable.length >=
    10
  &&
  Number.isFinite(
    targetObservedRemainderRate
  )
  &&
  Number.isFinite(
    observedTargetRandomExpectation
  )
  &&
  targetObservedRemainderRate >
    observedTargetRandomExpectation +
    0.25;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script95Passed:
      check(
        summary95
          ?.validation
          ?.pass,
        true,
        summary95
          ?.validation
          ?.pass ===
        true
      ),


    script95CaseCount:
      check(
        cases95.length,
        replayName ===
          'test'
          ? 85
          : '>0',
        replayName ===
          'test'
          ? cases95.length ===
            85
          : cases95.length >
            0
      ),


    joinedCaseCount:
      check(
        cases.length,
        cases95.length,
        cases.length ===
        cases95.length
      ),


    sourceTeamTotalAgreement:
      check(
        sourceTotalAgreementCases.length,
        cases.length,
        sourceTotalAgreementCases.length ===
        cases.length
      ),


    observedPartitionExact:
      check(
        observedPartitionExactCases.length,
        replayName ===
          'test'
          ? 85
          : '>=95%',
        replayName ===
          'test'
          ? observedPartitionExactCases.length ===
            85
          : observedIntegerPartitionStrong
      ),


    creditedRecipientCoverage:
      check(
        creditedRecipientCases.length,
        cases.length,
        creditedRecipientCases.length ===
        cases.length
      ),


    observedRemainderCasesPresent:
      check(
        observedRemainderCases.length,
        '>0',
        observedRemainderCases.length >
        0
      ),


    modelExactCasesPresent:
      check(
        rewardExactCases.length,
        '>=30',
        rewardExactCases.length >=
        30
      ),


    modelExactRemainderCasesPresent:
      check(
        modelExactRemainderCases.length,
        '>=10',
        modelExactRemainderCases.length >=
        10
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

const summary = {

  replay:
    replayName,

  version:
    'ASSIGNED_GOLD_FINAL_INTEGER_ALLOCATION_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? (
          observedIntegerPartitionStrong
          &&
          correctedRewardStrong
          &&
          creditedAlwaysIncluded
          &&
          creditedRemainderPriorityStrong
        )
        ? 'ASSIGNED_GOLD_ALLOCATION_SEMANTICS_STRONGLY_SUPPORTED'
        : 'FINAL_ALLOCATION_DIAGNOSTIC_COMPLETE'
      : 'PIPELINE_VALIDATION_FAILURE',


  purpose: [

    'Perform final integer-allocation validation after incorporating ordinary reward scaling, recipient-count sharing, Super-Trooper bounty reduction, and comeback economy.',

    'Confirm exact integer partition of reconstructed ground-soul rewards.',

    'Re-test credited-last-hitter remainder priority without confounding from incorrect total-reward predictions.',

    'Test whether the physical vacuum target has comparable integer-remainder priority.',

    'Identify the residual amount error that should be deferred to cross-replay rather than overfit within test.dem.'
  ],


  semanticLimits: {

    allocation:
      'Observed partition validation uses the reconstructed exact-tick economic recipient set and observed team reward.',

    predictedReward:
      'Predicted team reward comes from Script95 best predefined Super+comeback model. Remaining ±1-3 errors may reflect rounding or exact comeback implementation.',

    creditedPriority:
      'Remainder priority means preferential receipt of the ceil integer share when one underlying reward cannot divide evenly among recipients.',

    otherRemainders:
      'This analysis does not assume a deterministic rule for which non-credited recipients receive any remaining +1 units.',

    physicalTarget:
      'm_hVacuumTarget remains a physical collection role and is tested separately from economic assignment.',

    canonical:
      'All conclusions remain within-replay validation until reproduced independently.'
  },


  cohort: {

    cases:
      cases.length,

    observedPartitionExact:
      observedPartitionExactCases.length,

    rewardTotalExact:
      rewardExactCases.length,

    rewardWithin1:
      rewardWithin1Cases.length,

    rewardWithin2:
      rewardWithin2Cases.length,

    creditedRecipientCases:
      creditedRecipientCases.length,

    creditedAbsentCases:
      creditedAbsentCases.length,

    observedRemainderCases:
      observedRemainderCases.length,

    modelExactRemainderCases:
      modelExactRemainderCases.length
  },


  correctedRewardPerformance: {

    exact:
      rewardExactCases.length,

    exactRate:
      rate(
        rewardExactCases.length,
        cases.length
      ),

    within1:
      rewardWithin1Cases.length,

    within1Rate:
      rate(
        rewardWithin1Cases.length,
        cases.length
      ),

    within2:
      rewardWithin2Cases.length,

    within2Rate:
      rate(
        rewardWithin2Cases.length,
        cases.length
      ),

    rewardError:
      summarizeNumbers(
        cases.map(
          row =>
            row.rewardError
        )
      ),

    absoluteRewardError:
      summarizeNumbers(
        cases.map(
          row =>
            row.absoluteRewardError
        )
      )
  },


  observedAllocation: {

    integerPartitionExact:
      observedPartitionExactCases.length,

    integerPartitionExactRate:
      rate(
        observedPartitionExactCases.length,
        cases.length
      ),

    creditedAlwaysIncluded,

    creditedRemainder: {

      comparable:
        observedCreditedComparable.length,

      getsCeil:
        observedCreditedGetsCeil.length,

      getsCeilRate:
        creditedObservedRemainderRate,

      randomExpectedRate:
        observedCreditedRandomExpectation,

      priorityStrong:
        creditedRemainderPriorityStrong
    },

    physicalTargetRemainder: {

      comparable:
        observedTargetComparable.length,

      getsCeil:
        observedTargetGetsCeil.length,

      getsCeilRate:
        targetObservedRemainderRate,

      randomExpectedRate:
        observedTargetRandomExpectation,

      priorityStrong:
        physicalTargetRemainderPriorityStrong
    }
  },


  modelExactAllocation: {

    rewardExactCases:
      rewardExactCases.length,

    predictedAmountMultisetExact:
      predictedPartitionExactCases.length,

    predictedAmountMultisetExactRate:
      rate(
        predictedPartitionExactCases.length,
        cases.length
      ),

    creditedRemainder: {

      comparable:
        modelExactCreditedComparable.length,

      getsCeil:
        modelExactCreditedGetsCeil.length,

      getsCeilRate:
        creditedModelExactRemainderRate,

      randomExpectedRate:
        modelExactCreditedRandomExpectation,

      confirmed:
        creditedRemainderPriorityModelConfirmed
    },

    physicalTargetRemainder: {

      comparable:
        modelExactTargetComparable.length,

      getsCeil:
        modelExactTargetGetsCeil.length,

      getsCeilRate:
        targetModelExactRemainderRate,

      randomExpectedRate:
        modelExactTargetRandomExpectation
    }
  },


  residualGroups: {

    byVariant,

    bySuper,

    byTeamStatus,

    byRecipientCount,

    byTime
  },


  largestRewardMismatches:
    rewardMismatchCases
      .slice(
        0,
        30
      )
      .map(
        row => ({

          deathIndex:
            row.deathIndex,

          clock:
            row.clock,

          matchMinute:
            row.matchMinute,

          variantLabel:
            row.variantLabel,

          isSuper:
            row.isSuper,

          teamStatus:
            row.creditedTeamStatus,

          recipientCount:
            row.recipientCount,

          observed:
            row.observedTeamTotal,

          predicted:
            row.predictedTeamTotal,

          error:
            row.rewardError
        })
      ),


  remainderDetail,


  interpretiveFlags: {

    observedIntegerPartitionStrong,

    correctedRewardStrong,

    creditedAlwaysIncluded,

    creditedRemainderPriorityStrong,

    creditedRemainderPriorityModelConfirmed,

    physicalTargetRemainderPriorityStrong
  },


  interpretationGuide: {

    integerPartition:
      'A 100% observed partition rate establishes that the validated economic events divide into floor/ceil integer shares of one observed reward pool.',

    creditedPriority:
      'A credited-player ceil rate far above the random remainder expectation supports last-hitter priority for integer remainder allocation.',

    modelExact:
      'The model-exact subset is the strongest test because both the underlying predicted reward and observed reward agree before allocation is examined.',

    physicalTarget:
      'Lack of comparable remainder priority for m_hVacuumTarget further separates physical collection from economic assignment.',

    residuals:
      'If corrected totals are overwhelmingly within one or two souls, remaining exact-rounding differences should be replicated across independent matches rather than fitted further to test.dem.',

    next:
      'If pipeline and allocation semantics pass, close AssignedGold economic discovery on test.dem. Proceed to facing/aim field validation, then compact cross-replay replication of the foundational ground-soul mechanics.'
  },


  validation: {

    pass:
      validationPass,

    checks:
      validationChecks
  },


  outputs: {

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
  'ASSIGNED GOLD FINAL INTEGER ALLOCATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'CORRECTED REWARD PERFORMANCE'
);

console.log(
  '----------------------------'
);


console.log(
  `Cases:              ${cases.length}`
);


console.log(
  `Exact total:        ${rewardExactCases.length}/${cases.length} (${formatPercent(
    rate(
      rewardExactCases.length,
      cases.length
    )
  )})`
);


console.log(
  `Within 1:           ${rewardWithin1Cases.length}/${cases.length} (${formatPercent(
    rate(
      rewardWithin1Cases.length,
      cases.length
    )
  )})`
);


console.log(
  `Within 2:           ${rewardWithin2Cases.length}/${cases.length} (${formatPercent(
    rate(
      rewardWithin2Cases.length,
      cases.length
    )
  )})`
);


console.log(
  `Reward error:       ${formatDistribution(
    summarizeNumbers(
      cases.map(
        row =>
          row.rewardError
      )
    )
  )}`
);


// ============================================================
// OBSERVED ALLOCATION
// ============================================================

console.log('');

console.log(
  'OBSERVED INTEGER ALLOCATION'
);

console.log(
  '---------------------------'
);


console.log(
  `Exact integer partitions: ${observedPartitionExactCases.length}/${cases.length} (${formatPercent(
    rate(
      observedPartitionExactCases.length,
      cases.length
    )
  )})`
);


console.log(
  `Credited recipient:        ${creditedRecipientCases.length}/${cases.length} (${formatPercent(
    rate(
      creditedRecipientCases.length,
      cases.length
    )
  )})`
);


// ============================================================
// OBSERVED REMAINDER
// ============================================================

console.log('');

console.log(
  'OBSERVED REMAINDER PRIORITY'
);

console.log(
  '---------------------------'
);


console.log(
  `Remainder cases:               ${observedRemainderCases.length}`
);


console.log(
  `Credited comparable:           ${observedCreditedComparable.length}`
);


console.log(
  `Credited gets ceil:            ${observedCreditedGetsCeil.length}/${observedCreditedComparable.length} (${formatPercent(
    creditedObservedRemainderRate
  )})`
);


console.log(
  `Credited random expectation:   ${formatPercent(
    observedCreditedRandomExpectation
  )}`
);


console.log(
  `Credited priority strong:      ${creditedRemainderPriorityStrong}`
);


console.log('');

console.log(
  `Target comparable:             ${observedTargetComparable.length}`
);


console.log(
  `Target gets ceil:              ${observedTargetGetsCeil.length}/${observedTargetComparable.length} (${formatPercent(
    targetObservedRemainderRate
  )})`
);


console.log(
  `Target random expectation:     ${formatPercent(
    observedTargetRandomExpectation
  )}`
);


console.log(
  `Target priority strong:        ${physicalTargetRemainderPriorityStrong}`
);


// ============================================================
// MODEL-EXACT
// ============================================================

console.log('');

console.log(
  'MODEL-EXACT ALLOCATION'
);

console.log(
  '----------------------'
);


console.log(
  `Exact reward-total cases:      ${rewardExactCases.length}`
);


console.log(
  `Exact predicted amount sets:   ${predictedPartitionExactCases.length}/${cases.length} (${formatPercent(
    rate(
      predictedPartitionExactCases.length,
      cases.length
    )
  )})`
);


console.log(
  `Exact-total remainder cases:   ${modelExactRemainderCases.length}`
);


console.log(
  `Credited comparable:           ${modelExactCreditedComparable.length}`
);


console.log(
  `Credited gets predicted ceil:  ${modelExactCreditedGetsCeil.length}/${modelExactCreditedComparable.length} (${formatPercent(
    creditedModelExactRemainderRate
  )})`
);


console.log(
  `Random expectation:            ${formatPercent(
    modelExactCreditedRandomExpectation
  )}`
);


console.log(
  `Model-confirmed priority:      ${creditedRemainderPriorityModelConfirmed}`
);


console.log('');

console.log(
  `Target comparable:             ${modelExactTargetComparable.length}`
);


console.log(
  `Target gets predicted ceil:    ${modelExactTargetGetsCeil.length}/${modelExactTargetComparable.length} (${formatPercent(
    targetModelExactRemainderRate
  )})`
);


console.log(
  `Target random expectation:     ${formatPercent(
    modelExactTargetRandomExpectation
  )}`
);


// ============================================================
// RESIDUAL GROUPS
// ============================================================

console.log('');

console.log(
  'REWARD ERROR BY VARIANT'
);

console.log(
  '-----------------------'
);


printGroups(
  byVariant
);


console.log('');

console.log(
  'REWARD ERROR BY TEAM STATUS'
);

console.log(
  '---------------------------'
);


printGroups(
  byTeamStatus
);


console.log('');

console.log(
  'REWARD ERROR BY RECIPIENT COUNT'
);

console.log(
  '-------------------------------'
);


printGroups(
  byRecipientCount
);


// ============================================================
// FLAGS
// ============================================================

console.log('');

console.log(
  'INTERPRETIVE FLAGS'
);

console.log(
  '------------------'
);


console.log(
  `Observed integer partition strong:    ${observedIntegerPartitionStrong}`
);


console.log(
  `Corrected reward model strong:        ${correctedRewardStrong}`
);


console.log(
  `Credited player always included:      ${creditedAlwaysIncluded}`
);


console.log(
  `Credited remainder priority strong:   ${creditedRemainderPriorityStrong}`
);


console.log(
  `Model-confirmed remainder priority:   ${creditedRemainderPriorityModelConfirmed}`
);


console.log(
  `Physical-target remainder priority:   ${physicalTargetRemainderPriorityStrong}`
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
    result
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(

    `${result.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(42)} ` +

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
    let i = 0;
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

    total,

    count,

    floorShare,

    ceilShare,

    remainder,

    floorRecipients:
      count -
      remainder,

    ceilRecipients:
      remainder,

    amounts
  };
}


// ============================================================
// RECIPIENT NORMALIZATION
// ============================================================

function normalizeRecipients(
  rows
) {

  if (
    !Array.isArray(
      rows
    )
  ) {

    return [];
  }


  return rows
    .map(
      row => {

        const positiveDelta =
          finite(
            row?.positiveDelta
          );


        if (
          !row?.playerName
          ||
          positiveDelta ===
            null
          ||
          positiveDelta <=
            0
        ) {

          return null;
        }


        return {

          playerName:
            String(
              row.playerName
            ),

          team:
            finite(
              row.team
            ),

          positiveDelta
        };
      }
    )
    .filter(
      Boolean
    );
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

        const errors =
          groupRows.map(
            row =>
              row.rewardError
          );


        const absolute =
          groupRows.map(
            row =>
              row.absoluteRewardError
          );


        return {

          group,

          count:
            groupRows.length,

          rewardError:
            summarizeNumbers(
              errors
            ),

          absoluteRewardError:
            summarizeNumbers(
              absolute
            ),

          exactRate:
            rate(
              groupRows.filter(
                row =>
                  row.rewardTotalExact
              ).length,
              groupRows.length
            ),

          within1Rate:
            rate(
              groupRows.filter(
                row =>
                  row.absoluteRewardError <=
                  1
              ).length,
              groupRows.length
            ),

          within2Rate:
            rate(
              groupRows.filter(
                row =>
                  row.absoluteRewardError <=
                  2
              ).length,
              groupRows.length
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
// EXPECTATION
// ============================================================

function weightedRandomExpectation(
  rows,
  selector
) {

  if (
    rows.length ===
    0
  ) {

    return null;
  }


  return mean(
    rows.map(
      selector
    )
  );
}


// ============================================================
// TIME
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


  return `${lower}_TO_LT_${lower + 5}_MIN`;
}


// ============================================================
// ARRAY
// ============================================================

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
    let i = 0;
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


// ============================================================
// FILE
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
// NUMERIC
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
// CONSOLE
// ============================================================

function printGroups(
  groups
) {

  for (
    const row
    of groups
  ) {

    console.log('');

    console.log(
      `${row.group}  n=${row.count}`
    );


    console.log(
      `  error:  ${formatDistribution(row.rewardError)}`
    );


    console.log(
      `  abs:    ${formatDistribution(row.absoluteRewardError)}`
    );


    console.log(
      `  exact:  ${formatPercent(row.exactRate)}`
    );


    console.log(
      `  <=1:    ${formatPercent(row.within1Rate)}`
    );


    console.log(
      `  <=2:    ${formatPercent(row.within2Rate)}`
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
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}