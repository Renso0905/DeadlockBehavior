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
// Script 89 established a strong exact-tick economy association:
//
// stable isolated AssignedGold:
//   credited player positive = 95/96
//   opponent positive        =  4/96
//
// target != credited:
//   credited positive = 54/55
//   target positive   = 40/55
//   target-only       =  0/55
//
// At the same time:
//
//   66/96 stable isolated cases contained >1 same-team player
//   with a positive m_nCurrencies.0000 delta.
//
// Script 90 asks:
//
//   1. Are those multiple-player deltas structured enough to
//      support an actual shared-reward interpretation?
//
//   2. Do credited player and allied recipients usually receive
//      equal amounts?
//
//   3. Does the physical vacuum target have any special economic
//      amount relative to other allied recipients?
//
//   4. What exact amount patterns occur by:
//        - Trooper base type
//        - match time
//        - recipient count
//
//   5. Can single-recipient cases provide a cleaner estimate of
//      the ground-soul reward amount?
//
// IMPORTANT:
//
// This script does NOT assume every exact-tick same-team delta is
// caused by the ground soul.
//
// Primary amount analysis therefore uses:
//
//   stable floor
//   AssignedGold-isolated
//   credited player positive
//   no opponent positive on the exact tick
//
// This is the highest-specificity cohort currently available.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const script89SummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_credit_attribution_validation_v01.json'
  );


const script89CasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_credit_attribution_cases_v01.jsonl'
  );


const script87SummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classifier_v01.json'
  );


const script87CasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classified_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_reward_sharing_diagnostic_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_reward_sharing_cases_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    script89SummaryPath,
    script89CasesPath,
    script87SummaryPath,
    script87CasesPath
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
// LOAD SUMMARIES
// ============================================================

const summary89 =
  JSON.parse(
    readFileSync(
      script89SummaryPath,
      'utf8'
    )
  );


const summary87 =
  JSON.parse(
    readFileSync(
      script87SummaryPath,
      'utf8'
    )
  );


if (
  summary89
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 89 did not PASS.'
  );
}


if (
  summary87
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 87 did not PASS.'
  );
}


// ============================================================
// REQUIRE EXACT OFFSET 0 FOR TEST.DEM
//
// Script 89 selected the empirically strongest exact economy
// timing.
//
// We do not silently change that timing here.
// ============================================================

const selectedOffset =
  finite(
    summary89
      ?.selectedTelemetry
      ?.primaryExactOffsetTicks
  );


if (
  selectedOffset ===
  null
) {

  throw new Error(
    'Script 89 exact offset is unresolved.'
  );
}


// ============================================================
// LOAD STREAMS
// ============================================================

console.log('');

console.log(
  'Loading Script 89 exact-credit cases...'
);


const cases89 =
  await loadJsonl(
    script89CasesPath
  );


console.log(
  `Script 89 cases: ${cases89.length}`
);


console.log(
  'Loading Script 87 formal lifecycle cases...'
);


const cases87 =
  await loadJsonl(
    script87CasesPath
  );


console.log(
  `Script 87 cases: ${cases87.length}`
);


// ============================================================
// INDEX SCRIPT 87
// ============================================================

const case87ByDeathIndex =
  new Map();


for (
  const row
  of cases87
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    case87ByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// NORMALIZE CASES
// ============================================================

const cases =
  [];


for (
  const source89
  of cases89
) {

  const deathIndex =
    finite(
      source89?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const source87 =
    case87ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  if (
    !source87
  ) {

    continue;
  }


  const exact =
    source89?.exactCredit ??
    null;


  if (
    !exact
  ) {

    continue;
  }


  const sameTeamPlayers =
    normalizePositivePlayers(
      exact.sameTeamPositivePlayers
    );


  const opponentPlayers =
    normalizePositivePlayers(
      exact.opponentPositivePlayers
    );


  const creditedPlayerName =
    source89.creditedPlayerName ??
    source87
      ?.creditedPlayer
      ?.playerName ??
    null;


  const targetPlayerName =
    source89.targetPlayerName ??
    source87
      ?.vacuum
      ?.targetPlayerName ??
    null;


  const creditedRecipient =
    sameTeamPlayers.find(
      player =>
        player.playerName ===
        creditedPlayerName
    )
    ??
    null;


  const targetRecipient =
    targetPlayerName
      ? sameTeamPlayers.find(
          player =>
            player.playerName ===
            targetPlayerName
        )
        ??
        null
      : null;


  const peerRecipients =
    sameTeamPlayers.filter(
      player =>
        player.playerName !==
        creditedPlayerName
    );


  const nonTargetPeerRecipients =
    peerRecipients.filter(
      player =>
        player.playerName !==
        targetPlayerName
    );


  const recipientDeltas =
    sameTeamPlayers
      .map(
        player =>
          player.positiveDelta
      )
      .filter(
        Number.isFinite
      );


  const peerDeltas =
    peerRecipients
      .map(
        player =>
          player.positiveDelta
      )
      .filter(
        Number.isFinite
      );


  const creditedDelta =
    creditedRecipient
      ?.positiveDelta ??
    0;


  const targetDelta =
    targetRecipient
      ?.positiveDelta ??
    0;


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


  const allEqual =
    recipientDeltas.length >
      1
      ? allValuesEqual(
          recipientDeltas
        )
      : recipientDeltas.length ===
        1;


  const uniqueAmountCount =
    new Set(
      recipientDeltas
    ).size;


  const minimumRecipientDelta =
    recipientDeltas.length >
      0
      ? Math.min(
          ...recipientDeltas
        )
      : null;


  const maximumRecipientDelta =
    recipientDeltas.length >
      0
      ? Math.max(
          ...recipientDeltas
        )
      : null;


  const recipientSpread =
    minimumRecipientDelta !==
      null
    &&
    maximumRecipientDelta !==
      null
      ? maximumRecipientDelta -
        minimumRecipientDelta
      : null;


  const creditedPeerRatios =
    creditedDelta >
      0
      ? peerDeltas.map(
          value =>
            value /
            creditedDelta
        )
      : [];


  const peerMinusCredited =
    creditedDelta >
      0
      ? peerDeltas.map(
          value =>
            value -
            creditedDelta
        )
      : [];


  const activationTimeSeconds =
    finite(
      source87
        ?.groundSoul
        ?.activationTimeSeconds
    );


  const deathTimeSeconds =
    finite(
      source87
        ?.death
        ?.timeSeconds
    );


  const matchTimeSeconds =
    activationTimeSeconds ??
    deathTimeSeconds;


  const matchMinute =
    Number.isFinite(
      matchTimeSeconds
    )
      ? matchTimeSeconds /
        60
      : null;


  const opponentPositiveCount =
    opponentPlayers.length;


  const creditedPositive =
    creditedDelta >
    0;


  const primaryClean =
    source89.lifecycleClass ===
      'TARGETED_STABLE_FLOOR'
    &&
    source89.isolated16 ===
      true
    &&
    creditedPositive
    &&
    opponentPositiveCount ===
      0;


  const sharingClass =
    classifySharing({
      sameTeamPlayers,
      creditedPlayerName,
      targetPlayerName
    });


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      source89.clock ??
      source87.clock ??
      null,

    lifecycleClass:
      source89.lifecycleClass ??
      source87.lifecycleClass ??
      null,

    isolated16:
      source89.isolated16 ===
      true,

    baseType:
      source87
        ?.trooper
        ?.baseType ??
      null,

    variantLabel:
      source87
        ?.trooper
        ?.variantLabel ??
      null,

    deathTimeSeconds,

    activationTimeSeconds,

    matchMinute,

    matchTimeBand:
      classifyMatchTimeBand(
        matchMinute
      ),

    creditedPlayerName,

    creditedTeam:
      finite(
        source89.creditedTeam
      ),

    targetPlayerName,

    targetPlayerTeam:
      finite(
        source89.targetPlayerTeam
      ),

    targetDiffersFromCredited:
      source89.targetDiffersFromCredited ===
      true,

    activeFalseTick:
      finite(
        source89.activeFalseTick
      ),

    exactOffsetTicks:
      selectedOffset,

    exactOffsetSeconds:
      selectedOffset /
      64,

    sameTeamRecipients:
      sameTeamPlayers,

    opponentRecipients:
      opponentPlayers,

    sameTeamRecipientCount:
      sameTeamPlayers.length,

    opponentRecipientCount:
      opponentPlayers.length,

    peerRecipientCount:
      peerRecipients.length,

    nonTargetPeerRecipientCount:
      nonTargetPeerRecipients.length,

    creditedPositive,

    creditedDelta,

    targetPositive:
      targetDelta >
      0,

    targetDelta,

    teamTotal,

    recipientDeltas,

    peerDeltas,

    allEqual,

    uniqueAmountCount,

    minimumRecipientDelta,

    maximumRecipientDelta,

    recipientSpread,

    creditedPeerRatios,

    peerMinusCredited,

    sharingClass,

    primaryClean
  });
}


// ============================================================
// COHORTS
// ============================================================

const stableIsolated =
  cases.filter(
    row =>
      row.lifecycleClass ===
        'TARGETED_STABLE_FLOOR'
      &&
      row.isolated16
  );


const primaryClean =
  cases.filter(
    row =>
      row.primaryClean
  );


const primarySingleRecipient =
  primaryClean.filter(
    row =>
      row.sameTeamRecipientCount ===
      1
  );


const primaryMultiRecipient =
  primaryClean.filter(
    row =>
      row.sameTeamRecipientCount >
      1
  );


const primaryMismatch =
  primaryClean.filter(
    row =>
      row.targetDiffersFromCredited
  );


const primaryMismatchBoth =
  primaryMismatch.filter(
    row =>
      row.creditedPositive
      &&
      row.targetPositive
  );


const primaryMismatchTargetAbsent =
  primaryMismatch.filter(
    row =>
      row.creditedPositive
      &&
      !row.targetPositive
  );


const targetlessControls =
  cases.filter(
    row =>
      row.lifecycleClass ===
        'TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE'
      &&
      row.isolated16
  );


// ============================================================
// BASIC COUNTS
// ============================================================

const sharingClassCounts =
  countBy(
    primaryClean,
    row =>
      row.sharingClass
  );


const recipientCountCounts =
  countBy(
    primaryClean,
    row =>
      String(
        row.sameTeamRecipientCount
      )
  );


// ============================================================
// AMOUNT DISTRIBUTIONS
// ============================================================

const creditedDeltas =
  values(
    primaryClean,
    row =>
      row.creditedDelta
  );


const targetDeltas =
  values(
    primaryClean.filter(
      row =>
        row.targetPositive
    ),
    row =>
      row.targetDelta
  );


const peerDeltas =
  primaryClean.flatMap(
    row =>
      row.peerDeltas
  )
  .filter(
    Number.isFinite
  );


const teamTotals =
  values(
    primaryClean,
    row =>
      row.teamTotal
  );


const singleRecipientDeltas =
  values(
    primarySingleRecipient,
    row =>
      row.creditedDelta
  );


const multiCreditedDeltas =
  values(
    primaryMultiRecipient,
    row =>
      row.creditedDelta
  );


const multiPeerDeltas =
  primaryMultiRecipient.flatMap(
    row =>
      row.peerDeltas
  )
  .filter(
    Number.isFinite
  );


const multiTeamTotals =
  values(
    primaryMultiRecipient,
    row =>
      row.teamTotal
  );


// ============================================================
// EQUALITY / SHARING STRUCTURE
// ============================================================

const multiAllEqual =
  primaryMultiRecipient.filter(
    row =>
      row.allEqual
  );


const multiNotEqual =
  primaryMultiRecipient.filter(
    row =>
      !row.allEqual
  );


const multiCreditedEqualsEveryPeer =
  primaryMultiRecipient.filter(
    row =>
      row.creditedDelta >
        0
      &&
      row.peerDeltas.length >
        0
      &&
      row.peerDeltas.every(
        value =>
          value ===
          row.creditedDelta
      )
  );


const multiCreditedGreaterThanEveryPeer =
  primaryMultiRecipient.filter(
    row =>
      row.creditedDelta >
        0
      &&
      row.peerDeltas.length >
        0
      &&
      row.peerDeltas.every(
        value =>
          row.creditedDelta >
          value
      )
  );


const multiCreditedLessThanAnyPeer =
  primaryMultiRecipient.filter(
    row =>
      row.creditedDelta >
        0
      &&
      row.peerDeltas.some(
        value =>
          value >
          row.creditedDelta
      )
  );


// ============================================================
// TARGET ROLE WITHIN SHARING
// ============================================================

const mismatchTargetPositive =
  primaryMismatch.filter(
    row =>
      row.targetPositive
  );


const mismatchTargetAbsent =
  primaryMismatch.filter(
    row =>
      !row.targetPositive
  );


const mismatchTargetEqualsCreditedAmount =
  primaryMismatchBoth.filter(
    row =>
      row.targetDelta ===
      row.creditedDelta
  );


const mismatchTargetLessThanCredited =
  primaryMismatchBoth.filter(
    row =>
      row.targetDelta <
      row.creditedDelta
  );


const mismatchTargetGreaterThanCredited =
  primaryMismatchBoth.filter(
    row =>
      row.targetDelta >
      row.creditedDelta
  );


const mismatchTargetRatios =
  primaryMismatchBoth
    .filter(
      row =>
        row.creditedDelta >
        0
    )
    .map(
      row =>
        row.targetDelta /
        row.creditedDelta
    );


// ============================================================
// NON-TARGET PEER PARTICIPATION
// ============================================================

const withNonTargetPeer =
  primaryClean.filter(
    row =>
      row.nonTargetPeerRecipientCount >
      0
  );


const mismatchWithNonTargetPeer =
  primaryMismatch.filter(
    row =>
      row.nonTargetPeerRecipientCount >
      0
  );


// ============================================================
// TOP AMOUNT MODES
// ============================================================

const amountModes =
  {

    credited:
      topValueCounts(
        creditedDeltas,
        25
      ),

    target:
      topValueCounts(
        targetDeltas,
        25
      ),

    peer:
      topValueCounts(
        peerDeltas,
        25
      ),

    singleRecipient:
      topValueCounts(
        singleRecipientDeltas,
        25
      ),

    teamTotal:
      topValueCounts(
        teamTotals,
        25
      )
  };


// ============================================================
// GROUP SUMMARIES
// ============================================================

const byRecipientCount =
  summarizeGroups(
    primaryClean,
    row =>
      String(
        row.sameTeamRecipientCount
      )
  );


const byBaseType =
  summarizeGroups(
    primaryClean,
    row =>
      row.baseType ??
      'UNKNOWN'
  );


const byMatchTimeBand =
  summarizeGroups(
    primaryClean,
    row =>
      row.matchTimeBand
  );


const byBaseTypeAndRecipientCount =
  summarizeGroups(
    primaryClean,
    row =>
      `${row.baseType ?? 'UNKNOWN'}|N${row.sameTeamRecipientCount}`
  );


const singleByBaseType =
  summarizeGroups(
    primarySingleRecipient,
    row =>
      row.baseType ??
      'UNKNOWN'
  );


const singleByBaseTypeAndTime =
  summarizeGroups(
    primarySingleRecipient,
    row =>
      `${row.baseType ?? 'UNKNOWN'}|${row.matchTimeBand}`
  );


// ============================================================
// WITHIN-CASE PEER RATIOS
// ============================================================

const peerToCreditedRatios =
  primaryMultiRecipient
    .flatMap(
      row =>
        row.creditedPeerRatios
    )
    .filter(
      Number.isFinite
    );


const peerMinusCreditedValues =
  primaryMultiRecipient
    .flatMap(
      row =>
        row.peerMinusCredited
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// TARGETLESS BACKGROUND
// ============================================================

const targetlessWithAnyTeamPositive =
  targetlessControls.filter(
    row =>
      row.sameTeamRecipientCount >
      0
  );


const targetlessCreditedPositive =
  targetlessControls.filter(
    row =>
      row.creditedPositive
  );


const targetlessTeamTotals =
  values(
    targetlessWithAnyTeamPositive,
    row =>
      row.teamTotal
  );


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const multiEqualRate =
  rate(
    multiAllEqual.length,
    primaryMultiRecipient.length
  );


const creditedEqualsEveryPeerRate =
  rate(
    multiCreditedEqualsEveryPeer.length,
    primaryMultiRecipient.length
  );


const targetPositiveMismatchRate =
  rate(
    mismatchTargetPositive.length,
    primaryMismatch.length
  );


const nonTargetPeerRate =
  rate(
    withNonTargetPeer.length,
    primaryClean.length
  );


const exactSharingStrong =
  primaryMultiRecipient.length >=
    20
  &&
  multiEqualRate >=
    0.50;


const physicalTargetNotRequiredForEconomicShare =
  primaryMismatch.length >
    0
  &&
  mismatchTargetAbsent.length >
    0
  &&
  primaryMismatch.every(
    row =>
      row.creditedPositive
  );


const nonTargetAlliesCanReceive =
  withNonTargetPeer.length >
  0;


const amountStillConfounded =
  multiNotEqual.length >
    0
  ||
  new Set(
    singleRecipientDeltas
  ).size >
    10;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script89Passed:
      check(
        summary89
          ?.validation
          ?.pass,
        true,
        summary89
          ?.validation
          ?.pass ===
        true
      ),


    script87Passed:
      check(
        summary87
          ?.validation
          ?.pass,
        true,
        summary87
          ?.validation
          ?.pass ===
        true
      ),


    case89Count:
      check(
        cases89.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? cases89.length ===
            991
          : cases89.length >
            0
      ),


    joinedCaseCount:
      check(
        cases.length,
        cases89.length,
        cases.length ===
        cases89.length
      ),


    exactOffset:
      check(
        selectedOffset,
        replayName ===
          'test'
          ? 0
          : 'resolved',
        replayName ===
          'test'
          ? selectedOffset ===
            0
          : selectedOffset !==
            null
      ),


    stableIsolatedCount:
      check(
        stableIsolated.length,
        replayName ===
          'test'
          ? 96
          : '>0',
        replayName ===
          'test'
          ? stableIsolated.length ===
            96
          : stableIsolated.length >
            0
      ),


    primaryCleanCount:
      check(
        primaryClean.length,
        '>=80',
        primaryClean.length >=
        80
      ),


    singleRecipientCasesPresent:
      check(
        primarySingleRecipient.length,
        '>0',
        primarySingleRecipient.length >
        0
      ),


    multiRecipientCasesPresent:
      check(
        primaryMultiRecipient.length,
        '>0',
        primaryMultiRecipient.length >
        0
      ),


    mismatchCasesPresent:
      check(
        primaryMismatch.length,
        '>0',
        primaryMismatch.length >
        0
      ),


    targetlessControlsPresent:
      check(
        targetlessControls.length,
        '>0',
        targetlessControls.length >
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
      'ASSIGNED_GOLD_EXACT_REWARD_SHARING_DIAGNOSTIC_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'EXACT_REWARD_SHARING_DIAGNOSTIC_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Characterize exact-tick same-team m_nCurrencies.0000 changes at AssignedGold resolution.',

        'Determine whether multiple allied player deltas form a structured shared-reward pattern.',

        'Compare credited-player, physical vacuum-target, and other-allied economic roles.',

        'Identify clean single-recipient cases for later exact ground-soul amount modeling.',

        'Describe reward amount distributions by Trooper type, match time, and number of same-team recipients.'
      ],


    semanticLimits:
      {

        sharing:
          'Multiple exact-tick allied currency deltas are strong evidence of shared economic credit only if their amount structure is systematic. This script describes that structure without assuming the engine rule.',

        rewardAmount:
          'Even isolated stable-floor exact-tick deltas can theoretically contain another economic event. Exact reward values remain provisional until amount patterns are internally consistent.',

        recipient:
          'Credited last-hitter, physical m_hVacuumTarget, and other allied recipients are kept as separate roles.',

        variants:
          'Trooper variant labels remain provisional and must not be promoted to canonical variant economics from this diagnostic alone.',

        targetless:
          'Occasional targetless exact-tick currency changes are treated as background economic coincidence unless independently linked to AssignedGold.'
      },


    selectedTelemetry:
      {

        field:
          summary89
            ?.selectedTelemetry
            ?.candidate ??
          null,

        exactOffsetTicks:
          selectedOffset,

        exactOffsetSeconds:
          selectedOffset /
          64
      },


    cohorts:
      {

        allJoined:
          cases.length,

        stableIsolated:
          stableIsolated.length,

        primaryClean:
          primaryClean.length,

        primarySingleRecipient:
          primarySingleRecipient.length,

        primaryMultiRecipient:
          primaryMultiRecipient.length,

        primaryTargetDiffersFromCredited:
          primaryMismatch.length,

        primaryMismatchBothPositive:
          primaryMismatchBoth.length,

        primaryMismatchTargetAbsent:
          primaryMismatchTargetAbsent.length,

        targetlessControls:
          targetlessControls.length
      },


    sharing:
      {

        classCounts:
          sharingClassCounts,

        recipientCountCounts,

        multiRecipientCases:
          primaryMultiRecipient.length,

        multiAllEqual:
          multiAllEqual.length,

        multiAllEqualRate:
          multiEqualRate,

        creditedEqualsEveryPeer:
          multiCreditedEqualsEveryPeer.length,

        creditedEqualsEveryPeerRate:
          creditedEqualsEveryPeerRate,

        creditedGreaterThanEveryPeer:
          multiCreditedGreaterThanEveryPeer.length,

        creditedLessThanAnyPeer:
          multiCreditedLessThanAnyPeer.length,

        withNonTargetPeer:
          withNonTargetPeer.length,

        withNonTargetPeerRate:
          nonTargetPeerRate,

        mismatchWithNonTargetPeer:
          mismatchWithNonTargetPeer.length,

        peerToCreditedRatio:
          summarizeNumbers(
            peerToCreditedRatios
          ),

        peerMinusCredited:
          summarizeNumbers(
            peerMinusCreditedValues
          )
      },


    physicalVacuumTarget:
      {

        mismatchCases:
          primaryMismatch.length,

        targetPositive:
          mismatchTargetPositive.length,

        targetPositiveRate:
          targetPositiveMismatchRate,

        targetAbsent:
          mismatchTargetAbsent.length,

        targetEqualsCreditedAmount:
          mismatchTargetEqualsCreditedAmount.length,

        targetLessThanCredited:
          mismatchTargetLessThanCredited.length,

        targetGreaterThanCredited:
          mismatchTargetGreaterThanCredited.length,

        targetToCreditedRatio:
          summarizeNumbers(
            mismatchTargetRatios
          )
      },


    amounts:
      {

        credited:
          summarizeNumbers(
            creditedDeltas
          ),

        target:
          summarizeNumbers(
            targetDeltas
          ),

        peer:
          summarizeNumbers(
            peerDeltas
          ),

        teamTotal:
          summarizeNumbers(
            teamTotals
          ),

        singleRecipient:
          summarizeNumbers(
            singleRecipientDeltas
          ),

        multiRecipientCredited:
          summarizeNumbers(
            multiCreditedDeltas
          ),

        multiRecipientPeer:
          summarizeNumbers(
            multiPeerDeltas
          ),

        multiRecipientTeamTotal:
          summarizeNumbers(
            multiTeamTotals
          ),

        modes:
          amountModes
      },


    groupedAmounts:
      {

        byRecipientCount,

        byBaseType,

        byMatchTimeBand,

        byBaseTypeAndRecipientCount,

        singleRecipientByBaseType:
          singleByBaseType,

        singleRecipientByBaseTypeAndTime:
          singleByBaseTypeAndTime
      },


    targetlessBackground:
      {

        controls:
          targetlessControls.length,

        anySameTeamPositive:
          targetlessWithAnyTeamPositive.length,

        anySameTeamPositiveRate:
          rate(
            targetlessWithAnyTeamPositive.length,
            targetlessControls.length
          ),

        creditedPositive:
          targetlessCreditedPositive.length,

        creditedPositiveRate:
          rate(
            targetlessCreditedPositive.length,
            targetlessControls.length
          ),

        teamTotalWhenPositive:
          summarizeNumbers(
            targetlessTeamTotals
          )
      },


    interpretiveFlags:
      {

        exactSharingStrong,

        physicalTargetNotRequiredForEconomicShare,

        nonTargetAlliesCanReceive,

        amountStillConfounded
      },


    interpretationGuide:
      {

        equalMultiRecipientAmounts:
          'If most multi-recipient cases give identical amounts to every same-team recipient, a direct shared-reward event is strongly supported.',

        creditedPremium:
          'If credited player systematically receives more than peers, the ground-soul reward may contain a last-hit-assigned component plus a shared component.',

        targetSpecialRole:
          'If physical vacuum targets receive no amount advantage over other peers and can be economically absent while the credited player is paid, m_hVacuumTarget should remain a physical collection field rather than an economic ownership field.',

        singleRecipientAmounts:
          'Single-recipient stable isolated cases are the preferred next cohort for determining exact ground-soul reward values because no same-tick allied sharing decomposition is required.',

        amountVariation:
          'If single-recipient values form systematic groups by Trooper type and match time, Script 91 should fit the ground-soul amount schedule to those predictors.',

        next:
          'Inspect single-recipient and equal-sharing amount patterns. If structured, fit exact ground-soul reward value and sharing mechanics in Script 91.'
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
  'ASSIGNED GOLD EXACT REWARD SHARING DIAGNOSTIC V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'COHORT'
);

console.log(
  '------'
);


console.log(
  `Stable isolated:             ${stableIsolated.length}`
);


console.log(
  `Primary clean:               ${primaryClean.length}`
);


console.log(
  `Single-recipient:            ${primarySingleRecipient.length}`
);


console.log(
  `Multi-recipient:             ${primaryMultiRecipient.length}`
);


console.log(
  `Target != credited:          ${primaryMismatch.length}`
);


console.log(
  `Targetless controls:         ${targetlessControls.length}`
);


// ============================================================
// SHARING
// ============================================================

console.log('');

console.log(
  'EXACT-TICK SHARING STRUCTURE'
);

console.log(
  '----------------------------'
);


printCounts(
  sharingClassCounts
);


console.log('');


console.log(
  'RECIPIENT COUNT'
);


printCounts(
  recipientCountCounts
);


console.log('');


console.log(
  `Multi-recipient all equal:           ${multiAllEqual.length}/${primaryMultiRecipient.length} (${formatPercent(multiEqualRate)})`
);


console.log(
  `Credited = every peer:               ${multiCreditedEqualsEveryPeer.length}/${primaryMultiRecipient.length} (${formatPercent(creditedEqualsEveryPeerRate)})`
);


console.log(
  `Credited > every peer:               ${multiCreditedGreaterThanEveryPeer.length}`
);


console.log(
  `Some peer > credited:                ${multiCreditedLessThanAnyPeer.length}`
);


console.log(
  `Non-target peer received currency:   ${withNonTargetPeer.length}/${primaryClean.length} (${formatPercent(nonTargetPeerRate)})`
);


console.log(
  `Peer / credited ratio:               ${formatDistribution(
    summarizeNumbers(
      peerToCreditedRatios
    )
  )}`
);


console.log(
  `Peer - credited delta:               ${formatDistribution(
    summarizeNumbers(
      peerMinusCreditedValues
    )
  )}`
);


// ============================================================
// TARGET ROLE
// ============================================================

console.log('');

console.log(
  'PHYSICAL VACUUM TARGET ROLE'
);

console.log(
  '---------------------------'
);


console.log(
  `Mismatch cases:                ${primaryMismatch.length}`
);


console.log(
  `Target positive:               ${mismatchTargetPositive.length}/${primaryMismatch.length} (${formatPercent(targetPositiveMismatchRate)})`
);


console.log(
  `Target economically absent:    ${mismatchTargetAbsent.length}`
);


console.log(
  `Target = credited amount:      ${mismatchTargetEqualsCreditedAmount.length}`
);


console.log(
  `Target < credited amount:      ${mismatchTargetLessThanCredited.length}`
);


console.log(
  `Target > credited amount:      ${mismatchTargetGreaterThanCredited.length}`
);


console.log(
  `Target / credited ratio:       ${formatDistribution(
    summarizeNumbers(
      mismatchTargetRatios
    )
  )}`
);


// ============================================================
// AMOUNTS
// ============================================================

console.log('');

console.log(
  'EXACT-TICK AMOUNT DISTRIBUTIONS'
);

console.log(
  '-------------------------------'
);


console.log(
  `Credited:              ${formatDistribution(
    summarizeNumbers(
      creditedDeltas
    )
  )}`
);


console.log(
  `Target:                ${formatDistribution(
    summarizeNumbers(
      targetDeltas
    )
  )}`
);


console.log(
  `All peer deltas:       ${formatDistribution(
    summarizeNumbers(
      peerDeltas
    )
  )}`
);


console.log(
  `Team total:            ${formatDistribution(
    summarizeNumbers(
      teamTotals
    )
  )}`
);


console.log(
  `Single-recipient:      ${formatDistribution(
    summarizeNumbers(
      singleRecipientDeltas
    )
  )}`
);


console.log(
  `Multi credited:        ${formatDistribution(
    summarizeNumbers(
      multiCreditedDeltas
    )
  )}`
);


console.log(
  `Multi peers:           ${formatDistribution(
    summarizeNumbers(
      multiPeerDeltas
    )
  )}`
);


// ============================================================
// MODES
// ============================================================

console.log('');

console.log(
  'TOP EXACT AMOUNT MODES'
);

console.log(
  '----------------------'
);


printModes(
  'CREDITED',
  amountModes.credited
);


printModes(
  'SINGLE RECIPIENT',
  amountModes.singleRecipient
);


printModes(
  'PEERS',
  amountModes.peer
);


printModes(
  'TEAM TOTAL',
  amountModes.teamTotal
);


// ============================================================
// RECIPIENT COUNT GROUPS
// ============================================================

console.log('');

console.log(
  'BY RECIPIENT COUNT'
);

console.log(
  '------------------'
);


printGroupSummaries(
  byRecipientCount
);


// ============================================================
// BASE TYPES
// ============================================================

console.log('');

console.log(
  'BY TROOPER BASE TYPE'
);

console.log(
  '--------------------'
);


printGroupSummaries(
  byBaseType
);


// ============================================================
// SINGLE RECIPIENT BY TYPE
// ============================================================

console.log('');

console.log(
  'SINGLE-RECIPIENT BY TROOPER BASE TYPE'
);

console.log(
  '-------------------------------------'
);


printGroupSummaries(
  singleByBaseType
);


// ============================================================
// SINGLE RECIPIENT BY TYPE/TIME
// ============================================================

console.log('');

console.log(
  'SINGLE-RECIPIENT BY TYPE + MATCH TIME'
);

console.log(
  '-------------------------------------'
);


printGroupSummaries(
  singleByBaseTypeAndTime
);


// ============================================================
// TARGETLESS
// ============================================================

console.log('');

console.log(
  'TARGETLESS EXACT-TICK BACKGROUND'
);

console.log(
  '--------------------------------'
);


console.log(
  `Controls:                ${targetlessControls.length}`
);


console.log(
  `Any team positive:       ${targetlessWithAnyTeamPositive.length}/${targetlessControls.length} (${formatPercent(
    rate(
      targetlessWithAnyTeamPositive.length,
      targetlessControls.length
    )
  )})`
);


console.log(
  `Credited player positive:${targetlessCreditedPositive.length}/${targetlessControls.length} (${formatPercent(
    rate(
      targetlessCreditedPositive.length,
      targetlessControls.length
    )
  )})`
);


console.log(
  `Positive team totals:    ${formatDistribution(
    summarizeNumbers(
      targetlessTeamTotals
    )
  )}`
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
  `Exact sharing strong:                       ${exactSharingStrong}`
);


console.log(
  `Physical target not required for share:     ${physicalTargetNotRequiredForEconomicShare}`
);


console.log(
  `Non-target allies can receive:              ${nonTargetAlliesCanReceive}`
);


console.log(
  `Amount still confounded/needs modeling:     ${amountStillConfounded}`
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
// SHARING CLASS
// ============================================================

function classifySharing({
  sameTeamPlayers,
  creditedPlayerName,
  targetPlayerName
}) {

  if (
    sameTeamPlayers.length ===
    0
  ) {

    return 'NO_SAME_TEAM_POSITIVE';
  }


  const names =
    new Set(
      sameTeamPlayers.map(
        row =>
          row.playerName
      )
    );


  const credited =
    creditedPlayerName
    &&
    names.has(
      creditedPlayerName
    );


  const target =
    targetPlayerName
    &&
    names.has(
      targetPlayerName
    );


  const other =
    sameTeamPlayers.some(
      row =>
        row.playerName !==
          creditedPlayerName
        &&
        row.playerName !==
          targetPlayerName
    );


  if (
    sameTeamPlayers.length ===
      1
    &&
    credited
  ) {

    return 'CREDITED_ONLY';
  }


  if (
    sameTeamPlayers.length ===
      1
    &&
    target
  ) {

    return 'TARGET_ONLY';
  }


  if (
    credited
    &&
    target
    &&
    other
  ) {

    return 'CREDITED_TARGET_AND_OTHER_ALLY';
  }


  if (
    credited
    &&
    target
  ) {

    return 'CREDITED_AND_TARGET';
  }


  if (
    credited
    &&
    other
  ) {

    return 'CREDITED_AND_OTHER_ALLY_TARGET_ABSENT';
  }


  if (
    credited
  ) {

    return 'CREDITED_PLUS_ALLIES';
  }


  if (
    target
  ) {

    return 'TARGET_PLUS_ALLIES_WITHOUT_CREDITED';
  }


  return 'OTHER_SAME_TEAM_PLAYERS_ONLY';
}


// ============================================================
// MATCH TIME BAND
// ============================================================

function classifyMatchTimeBand(
  minute
) {

  if (
    !Number.isFinite(
      minute
    )
  ) {

    return 'UNKNOWN';
  }


  if (
    minute <
    10
  ) {

    return 'LT_10_MIN';
  }


  if (
    minute <
    15
  ) {

    return '10_TO_LT_15_MIN';
  }


  if (
    minute <
    20
  ) {

    return '15_TO_LT_20_MIN';
  }


  if (
    minute <
    25
  ) {

    return '20_TO_LT_25_MIN';
  }


  if (
    minute <
    30
  ) {

    return '25_TO_LT_30_MIN';
  }


  if (
    minute <
    35
  ) {

    return '30_TO_LT_35_MIN';
  }


  if (
    minute <
    40
  ) {

    return '35_TO_LT_40_MIN';
  }


  if (
    minute <
    45
  ) {

    return '40_TO_LT_45_MIN';
  }


  return 'GE_45_MIN';
}


// ============================================================
// GROUP SUMMARY
// ============================================================

function summarizeGroups(
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
      String(
        selector(
          row
        )
        ??
        'UNKNOWN'
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


  return [
    ...map.entries()
  ]
    .map(
      (
        [
          group,
          groupRows
        ]
      ) => {

        const credited =
          values(
            groupRows,
            row =>
              row.creditedDelta
          );


        const peers =
          groupRows
            .flatMap(
              row =>
                row.peerDeltas
            )
            .filter(
              Number.isFinite
            );


        const totals =
          values(
            groupRows,
            row =>
              row.teamTotal
          );


        const allEqual =
          groupRows.filter(
            row =>
              row.allEqual
          ).length;


        return {

          group,

          count:
            groupRows.length,

          recipientCount:
            summarizeNumbers(
              groupRows.map(
                row =>
                  row.sameTeamRecipientCount
              )
            ),

          credited:
            summarizeNumbers(
              credited
            ),

          peer:
            summarizeNumbers(
              peers
            ),

          teamTotal:
            summarizeNumbers(
              totals
            ),

          allEqual,

          allEqualRate:
            rate(
              allEqual,
              groupRows.length
            ),

          creditedModes:
            topValueCounts(
              credited,
              10
            ),

          peerModes:
            topValueCounts(
              peers,
              10
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
// PLAYER NORMALIZATION
// ============================================================

function normalizePositivePlayers(
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

        const delta =
          finite(
            row?.positiveDelta
          );


        if (
          !row?.playerName
          ||
          delta ===
            null
          ||
          delta <=
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

          positiveDelta:
            delta
        };
      }
    )
    .filter(
      Boolean
    )
    .sort(
      (
        a,
        b
      ) =>
        b.positiveDelta -
          a.positiveDelta
        ||
        a.playerName.localeCompare(
          b.playerName
        )
    );
}


// ============================================================
// MODES
// ============================================================

function topValueCounts(
  values,
  limit
) {

  const counts =
    new Map();


  for (
    const value
    of values
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
// VALUE EQUALITY
// ============================================================

function allValuesEqual(
  values
) {

  if (
    values.length <=
    1
  ) {

    return true;
  }


  const first =
    values[0];


  return values.every(
    value =>
      value ===
      first
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


function countBy(
  rows,
  selector
) {

  const counts =
    {};


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
        'NULL'
      );


    counts[
      key
    ] =
      (
        counts[
          key
        ]
        ??
        0
      )
      +
      1;
  }


  return counts;
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
// CONSOLE HELPERS
// ============================================================

function printCounts(
  counts
) {

  for (
    const [
      key,
      count
    ]
    of Object
      .entries(
        counts
      )
      .sort(
        (
          a,
          b
        ) =>
          b[1] -
            a[1]
          ||
          a[0].localeCompare(
            b[0]
          )
      )
  ) {

    console.log(
      `${key.padEnd(48)} ${count}`
    );
  }
}


function printModes(
  label,
  modes
) {

  console.log('');

  console.log(
    label
  );


  if (
    modes.length ===
    0
  ) {

    console.log(
      '  n/a'
    );

    return;
  }


  console.log(
    '  ' +
    modes
      .slice(
        0,
        15
      )
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
      `  recipients: ${formatDistribution(row.recipientCount)}`
    );


    console.log(
      `  credited:   ${formatDistribution(row.credited)}`
    );


    console.log(
      `  peers:      ${formatDistribution(row.peer)}`
    );


    console.log(
      `  team total: ${formatDistribution(row.teamTotal)}`
    );


    console.log(
      `  all equal:  ${row.allEqual}/${row.count} (${formatPercent(row.allEqualRate)})`
    );


    if (
      row.creditedModes.length >
      0
    ) {

      console.log(
        `  credited modes: ${row.creditedModes
          .slice(
            0,
            8
          )
          .map(
            mode =>
              `${mode.value}×${mode.count}`
          )
          .join(
            ' '
          )}`
      );
    }


    if (
      row.peerModes.length >
      0
    ) {

      console.log(
        `  peer modes:     ${row.peerModes
          .slice(
            0,
            8
          )
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