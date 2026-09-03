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
// VERSION
// ============================================================

const VERSION =
  'FATAL_DAMAGE_CITADEL_MELEE_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// Script109 strongly reproduced the expected melee-finisher
// economic signature:
//
//   GROUND_ONLY
//     ~50% reward
//     flying CItemXP present
//
//   DIRECT_FULL_BOUNTY_CANDIDATE
//     ~100% reward
//     flying CItemXP usually absent
//     credited player very close to Trooper
//
// Script110 attempted to validate attack type using the explicit
// MeleeHit user message.
//
// Result:
//
//   MeleeHit messages observed = 0 in all five replays.
//
// Therefore the MeleeHit replay channel is operationally
// unavailable and is abandoned.
//
// HOWEVER:
//
// Script110's Damage telemetry had:
//
//   100% fatal-damage coverage in the full-bounty cohort
//
// and saved:
//
//   damageType
//   citadelType
//   fatal attacker identity
//
// Deadlock's ECitadelDamageType enum defines:
//
//   0 = NONE
//   1 = BULLET
//   2 = ABILITY
//   3 = MELEE
//   4 = ENVIRONMENTAL
//   5 = POISON
//   6 = WEAKPOINT_BONUS
//   7 = PURE
//
// Therefore Script111 performs the direct attack-type test
// OFFLINE using the already-extracted fatal Damage messages.
//
// PRIMARY QUESTION:
//
//   Does fatal Damage.citadelType == 3 identify the
//   DIRECT_FULL_BOUNTY_CANDIDATE class?
//
// STRONGER CONFIRMATION:
//
//   Restrict to cases where the fatal attacker's player identity
//   matches the independently reconstructed credited last-hitter.
//
// No raw .dem parsing occurs in this script.
//
// ============================================================


// ============================================================
// DAMAGE TYPE ENUM
// ============================================================

const CITADEL_DAMAGE_TYPE =
  {

    0:
      'NONE',

    1:
      'BULLET',

    2:
      'ABILITY',

    3:
      'MELEE',

    4:
      'ENVIRONMENTAL',

    5:
      'POISON',

    6:
      'WEAKPOINT_BONUS',

    7:
      'PURE'
  };


const MELEE_CITADEL_TYPE =
  3;


// ============================================================
// SUPPORT THRESHOLDS
//
// Predeclared before inspecting Script111 results.
//
// PRIMARY ALL-TYPE-RESOLVED COHORT:
//
//   >=100 cases
//   >=20 full-bounty
//   >=50 ground-only
//
//   sensitivity >= .85
//   specificity >= .95
//   MCC >= .80
//
// CREDITED-FATAL-ATTACKER CONFIRMATION:
//
//   slightly lower count requirements because some fatal attacker
//   identities were unresolved in Script110.
//
// The thresholds concern classification performance, not exact
// game-engine constants.
//
// ============================================================

const SUPPORT =
  {

    allResolved:
      {

        minimumCases:
          100,

        minimumFullBountyCases:
          20,

        minimumGroundOnlyCases:
          50,

        minimumSensitivity:
          0.85,

        minimumSpecificity:
          0.95,

        minimumMCC:
          0.80
      },


    creditedConfirmed:
      {

        minimumCases:
          80,

        minimumFullBountyCases:
          15,

        minimumGroundOnlyCases:
          40,

        minimumSensitivity:
          0.85,

        minimumSpecificity:
          0.95,

        minimumMCC:
          0.80
      }
  };


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT109_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_signature_validation_v01.json'
  );


const SCRIPT110_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_direct_attack_validation_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'fatal_damage_citadel_melee_validation_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'fatal_damage_citadel_melee_validation_v01.md'
  );


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT109_PATH,
    SCRIPT110_PATH
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


const script109 =
  JSON.parse(
    readFileSync(
      SCRIPT109_PATH,
      'utf8'
    )
  );


const script110 =
  JSON.parse(
    readFileSync(
      SCRIPT110_PATH,
      'utf8'
    )
  );


if (
  script109?.status !==
  'MELEE_DIRECT_FULL_BOUNTY_SIGNATURE_STRONGLY_SUPPORTED_ATTACK_TYPE_NOT_DIRECTLY_VALIDATED'
) {

  throw new Error(
    `Unexpected Script109 status:\n${script109?.status}`
  );
}


const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No independent replication cohort.'
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
  'FATAL DAMAGE CITADEL-TYPE MELEE VALIDATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'SCRIPT110 CORRECTION'
);

console.log(
  '--------------------'
);


console.log(
  'MeleeHit replay messages were absent in all five replays.'
);


console.log(
  'Fatal Damage telemetry was complete and already contains'
);


console.log(
  'the direct citadel damage-type field.'
);


console.log('');

console.log(
  'DIRECT ENUM TEST'
);


console.log(
  '----------------'
);


console.log(
  'ECitadelDamageType == 3 -> MELEE'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'Raw replay parsing:        NONE'
);


console.log('');


// ============================================================
// ANALYZE REPLAYS
// ============================================================

const replayResults =
  [];


for (
  let index =
    0;

  index <
    cohort.length;

  index++
) {

  const replayName =
    String(
      cohort[
        index
      ].replayName
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${index + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await analyzeReplay(
      replayName
    );


  replayResults.push(
    result
  );


  printReplay(
    result
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY SUPPORT
// ============================================================

const informativeReplays =
  replayResults.filter(
    row =>
      row
        .support
        .informative
  );


const allResolvedSupported =
  informativeReplays.filter(
    row =>
      row
        .support
        .allResolvedSupported
  );


const creditedConfirmedSupported =
  informativeReplays.filter(
    row =>
      row
        .support
        .creditedConfirmedSupported
  );


let status;


if (
  informativeReplays.length <
  3
) {

  status =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  allResolvedSupported.length >=
    4
  &&
  creditedConfirmedSupported.length >=
    4
) {

  status =
    'MELEE_DIRECT_FULL_BOUNTY_FATAL_DAMAGE_TYPE_STRONGLY_SUPPORTED';

} else if (
  allResolvedSupported.length >=
    4
) {

  status =
    'MELEE_FULL_BOUNTY_FATAL_DAMAGE_TYPE_STRONGLY_SUPPORTED_CREDITED_CONFIRMATION_INCOMPLETE';

} else if (
  allResolvedSupported.length >=
    3
) {

  status =
    'MELEE_FULL_BOUNTY_FATAL_DAMAGE_TYPE_SUPPORTED';

} else {

  status =
    'MELEE_FATAL_DAMAGE_TYPE_NOT_REPLICATED';
}


// ============================================================
// REPLAY-LEVEL DISTRIBUTIONS
// ============================================================

const distributions =
  {

    fatalTypeCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .allResolved
              .coverageRate
        )
      ),


    fullBountyMeleeRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .allResolved
              .fullBounty
              .meleeRate
        )
      ),


    groundOnlyMeleeRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .allResolved
              .groundOnly
              .meleeRate
        )
      ),


    allResolvedMCC:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .allResolved
              .association
              .mcc
        )
      ),


    allResolvedAccuracy:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .allResolved
              .association
              .accuracy
        )
      ),


    creditedConfirmedCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .creditedConfirmed
              .coverageRate
        )
      ),


    creditedFullBountyMeleeRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .creditedConfirmed
              .fullBounty
              .meleeRate
        )
      ),


    creditedGroundOnlyMeleeRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .creditedConfirmed
              .groundOnly
              .meleeRate
        )
      ),


    creditedConfirmedMCC:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .creditedConfirmed
              .association
              .mcc
        )
      ),


    fatalTickOffset:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .fatalTickOffsets
        )
      )
  };


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation;


if (
  status ===
  'MELEE_DIRECT_FULL_BOUNTY_FATAL_DAMAGE_TYPE_STRONGLY_SUPPORTED'
) {

  interpretation =
    {

      rewardSourceResolved:
        true,

      semanticStatus:
        'CROSS_REPLAY_STRONGLY_SUPPORTED',

      conclusion:
        'Fatal Damage telemetry directly identifies the Script109 direct-full-bounty/no-orb class as melee damage across independent replays. The relationship persists when restricted to cases where the fatal attacker is independently confirmed as the credited last-hitter.',

      finalOperationalClasses:
        {

          melee:
            'MELEE_DIRECT_FULL_BOUNTY',

          nonMelee:
            'NON_MELEE_SPLIT_BOUNTY'
        },

      mechanic:
        'Melee finishing is a distinct Trooper reward pathway: full value is awarded directly and the normal denyable flying-orb opportunity is suppressed.',

      behavioralConsequence:
        'Melee finishing removes the opponent future deny opportunity. Such Troopers must not enter denominators for missed/ignored enemy deny opportunities.',

      nextStage:
        'Close foundational Trooper reward-source semantics and proceed to behavioral opportunity-feature construction.'
    };

} else if (
  status ===
  'MELEE_FULL_BOUNTY_FATAL_DAMAGE_TYPE_STRONGLY_SUPPORTED_CREDITED_CONFIRMATION_INCOMPLETE'
) {

  interpretation =
    {

      rewardSourceResolved:
        true,

      semanticStatus:
        'DIRECT_ATTACK_TYPE_STRONGLY_SUPPORTED',

      conclusion:
        'Fatal Damage.citadelType strongly identifies the direct-full-bounty class as melee, although credited-fatal-attacker identity coverage is not sufficient in at least two replay units.',

      nextStage:
        'Close the attack-type distinction operationally; retain credited-attacker confirmation as supporting evidence.'
    };

} else if (
  status ===
  'MELEE_FULL_BOUNTY_FATAL_DAMAGE_TYPE_SUPPORTED'
) {

  interpretation =
    {

      rewardSourceResolved:
        false,

      semanticStatus:
        'SUPPORTED_NOT_STRONG',

      conclusion:
        'Fatal Damage.citadelType supports the melee interpretation but does not meet the predeclared strong cross-replay threshold.',

      nextStage:
        'Inspect only replay-level fatal citadel-type failures.'
    };

} else {

  interpretation =
    {

      rewardSourceResolved:
        false,

      semanticStatus:
        'UNRESOLVED',

      conclusion:
        'Fatal Damage.citadelType does not reproduce the direct-full-bounty signature sufficiently strongly.',

      nextStage:
        'Inspect class-specific fatal citadel-type distributions before changing the mechanic interpretation.'
    };
}


// ============================================================
// SUMMARY
// ============================================================

const summary =
  {

    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    status,


    correctionToScript110:
      {

        script110Status:
          script110?.status
          ??
          null,

        meleeHitMessagesObserved:
          replayResults.reduce(
            (
              sum,
              row
            ) =>
              sum +
              row.script110MeleeMessages,
            0
          ),

        interpretation:
          'MeleeHit user-message telemetry is unavailable in this replay/parser channel. This is a telemetry-channel limitation, not evidence that melee attacks are absent.'
      },


    directDamageSemantics:
      {

        field:
          'CCitadelUserMessage_Damage.citadel_type',

        enum:
          CITADEL_DAMAGE_TYPE,

        meleeValue:
          MELEE_CITADEL_TYPE,

        meleeMeaning:
          'CITADEL_DAMAGETYPE_MELEE'
      },


    design:
      {

        replicationUnit:
          'REPLAY',

        rawReplayParsing:
          false,

        positiveClass:
          'DIRECT_FULL_BOUNTY_CANDIDATE',

        negativeClass:
          'GROUND_ONLY',

        primaryAttackType:
          'Best fatal Damage event from Script110 primary ±4-tick death window.',

        strongestCohort:
          'Fatal citadel type resolved AND fatal attacker identity matches independently derived credited last-hitter.',

        classificationRule:
          'fatal Damage.citadelType === 3 -> MELEE',

        caveat:
          'Replay-observed message semantics are operational evidence, not engine source-code proof.'
      },


    supportThresholds:
      SUPPORT,


    replayCounts:
      {

        total:
          replayResults.length,

        informative:
          informativeReplays.length,

        allResolvedSupported:
          allResolvedSupported.length,

        creditedConfirmedSupported:
          creditedConfirmedSupported.length
      },


    distributions,

    replays:
      replayResults,

    interpretation,


    outputs:
      {

        json:
          OUTPUT_JSON_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE GLOBAL OUTPUT
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
  'FATAL CITADEL-TYPE CROSS-REPLAY SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'REPLAY SUPPORT'
);

console.log(
  '--------------'
);


for (
  const row
  of replayResults
) {

  console.log(

    `${row.replay.padEnd(12)} ` +

    `full=${formatPercent(
      row
        .allResolved
        .fullBounty
        .meleeRate
    ).padEnd(8)} ` +

    `ground=${formatPercent(
      row
        .allResolved
        .groundOnly
        .meleeRate
    ).padEnd(8)} ` +

    `MCC=${formatNumber(
      row
        .allResolved
        .association
        .mcc
    ).padEnd(7)} ` +

    `creditedMCC=${formatNumber(
      row
        .creditedConfirmed
        .association
        .mcc
    ).padEnd(7)} ` +

    `support=${row.support.allResolvedSupported}`
  );
}


console.log('');

console.log(
  'KEY DISTRIBUTIONS'
);

console.log(
  '-----------------'
);


console.log(
  `Fatal type coverage:         ${formatDistribution(
    distributions.fatalTypeCoverage
  )}`
);


console.log(
  `Full-bounty melee rate:      ${formatDistribution(
    distributions.fullBountyMeleeRate
  )}`
);


console.log(
  `Ground-only melee rate:      ${formatDistribution(
    distributions.groundOnlyMeleeRate
  )}`
);


console.log(
  `All-resolved MCC:            ${formatDistribution(
    distributions.allResolvedMCC
  )}`
);


console.log(
  `Credited-confirmed coverage: ${formatDistribution(
    distributions.creditedConfirmedCoverage
  )}`
);


console.log(
  `Credited full melee rate:    ${formatDistribution(
    distributions.creditedFullBountyMeleeRate
  )}`
);


console.log(
  `Credited ground melee rate:  ${formatDistribution(
    distributions.creditedGroundOnlyMeleeRate
  )}`
);


console.log(
  `Credited-confirmed MCC:      ${formatDistribution(
    distributions.creditedConfirmedMCC
  )}`
);


console.log('');

console.log(
  'FINAL STATUS'
);

console.log(
  '------------'
);


console.log(
  status
);


console.log('');

console.log(
  'INTERPRETATION'
);

console.log(
  '--------------'
);


console.log(
  interpretation.conclusion
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
// ANALYZE ONE REPLAY
// ============================================================

async function analyzeReplay(
  replayName
) {

  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const casesPath =
    resolve(
      outputDirectory,
      'melee_full_bounty_direct_attack_cases_v01.jsonl'
    );


  const script110ReplayPath =
    resolve(
      outputDirectory,
      'melee_full_bounty_direct_attack_validation_v01.json'
    );


  const classifiedOutputPath =
    resolve(
      outputDirectory,
      'fatal_damage_citadel_melee_cases_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'fatal_damage_citadel_melee_validation_v01.json'
    );


  for (
    const path
    of [
      casesPath,
      script110ReplayPath
    ]
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


  const cases =
    await loadJsonl(
      casesPath
    );


  const script110Replay =
    JSON.parse(
      readFileSync(
        script110ReplayPath,
        'utf8'
      )
    );


  const classified =
    [];


  for (
    const row
    of cases
  ) {

    const fatal =
      classifyFatalDamage(
        row
      );


    classified.push(
      {

        replay:
          replayName,

        deathId:
          row.deathId,

        deathTick:
          finite(
            row.deathTick
          ),

        creditedName:
          row.creditedName
          ??
          null,

        analysisClass:
          row.analysisClass,

        componentClass:
          row.componentClass,

        teamTotal:
          finite(
            row.teamTotal
          ),

        predictedGround:
          finite(
            row.predictedGround
          ),

        predictedFull:
          finite(
            row.predictedFull
          ),

        fatalTypeResolved:
          fatal.typeResolved,

        fatalCitadelType:
          fatal.citadelType,

        fatalCitadelTypeName:
          damageTypeName(
            fatal.citadelType
          ),

        fatalIsMelee:
          fatal.isMelee,

        fatalDamageType:
          fatal.damageType,

        fatalTick:
          fatal.tick,

        fatalOffsetTicks:
          fatal.offsetTicks,

        fatalAttackerName:
          fatal.attackerName,

        fatalAttackerIdentityResolved:
          fatal.attackerIdentityResolved,

        creditedFatalAttackerMatch:
          fatal.creditedAttackerMatch,

        fatalEventCount:
          fatal.fatalEventCount,

        distinctFatalCitadelTypes:
          fatal.distinctCitadelTypes,

        conflictingFatalCitadelTypes:
          fatal.conflictingTypes
      }
    );
  }


  // ----------------------------------------------------------
  // ALL CASES WITH RESOLVED FATAL CITADEL TYPE
  // ----------------------------------------------------------

  const typeResolved =
    classified.filter(
      row =>
        row.fatalTypeResolved
    );


  const allResolvedSummary =
    summarizeClassificationCohort({

      rows:
        typeResolved,

      denominator:
        classified.length,

      cohortId:
        'ALL_FATAL_TYPE_RESOLVED'
    });


  // ----------------------------------------------------------
  // CREDITED FATAL ATTACKER CONFIRMED
  //
  // This is our strongest semantic cohort:
  //
  // independently credited last-hitter
  //        ==
  // fatal Damage attacker
  //
  // and we then inspect that fatal Damage event's citadel type.
  // ----------------------------------------------------------

  const creditedConfirmedRows =
    typeResolved.filter(
      row =>
        row.creditedFatalAttackerMatch ===
        true
    );


  const creditedConfirmedSummary =
    summarizeClassificationCohort({

      rows:
        creditedConfirmedRows,

      denominator:
        classified.length,

      cohortId:
        'CREDITED_FATAL_ATTACKER_CONFIRMED'
    });


  // ----------------------------------------------------------
  // FATAL TYPE COUNTS
  // ----------------------------------------------------------

  const typeCounts =
    {

      all:
        countDamageTypes(
          typeResolved
        ),

      fullBounty:
        countDamageTypes(
          typeResolved.filter(
            row =>
              row.analysisClass ===
              'DIRECT_FULL_BOUNTY_CANDIDATE'
          )
        ),

      groundOnly:
        countDamageTypes(
          typeResolved.filter(
            row =>
              row.analysisClass ===
              'GROUND_ONLY'
          )
        ),

      creditedConfirmedFullBounty:
        countDamageTypes(
          creditedConfirmedRows.filter(
            row =>
              row.analysisClass ===
              'DIRECT_FULL_BOUNTY_CANDIDATE'
          )
        ),

      creditedConfirmedGroundOnly:
        countDamageTypes(
          creditedConfirmedRows.filter(
            row =>
              row.analysisClass ===
              'GROUND_ONLY'
          )
        )
    };


  // ----------------------------------------------------------
  // RAW DAMAGE-TYPE COUNTS
  //
  // Kept diagnostic only.
  //
  // We do NOT assign semantics to the generic Damage.type field
  // here; citadelType is the relevant ECitadelDamageType field.
  // ----------------------------------------------------------

  const genericDamageTypeCounts =
    {

      fullBounty:
        countByObject(

          typeResolved.filter(
            row =>
              row.analysisClass ===
              'DIRECT_FULL_BOUNTY_CANDIDATE'
          ),

          row =>
            row.fatalDamageType
            ??
            'NULL'
        ),

      groundOnly:
        countByObject(

          typeResolved.filter(
            row =>
              row.analysisClass ===
              'GROUND_ONLY'
          ),

          row =>
            row.fatalDamageType
            ??
            'NULL'
        )
    };


  // ----------------------------------------------------------
  // TIMING
  // ----------------------------------------------------------

  const fatalTickOffsets =
    typeResolved
      .map(
        row =>
          row.fatalOffsetTicks
      )
      .filter(
        Number.isFinite
      );


  // ----------------------------------------------------------
  // AMBIGUITY
  // ----------------------------------------------------------

  const conflictingFatalCitadelTypes =
    classified.filter(
      row =>
        row.conflictingFatalCitadelTypes
    );


  // ----------------------------------------------------------
  // SUPPORT
  // ----------------------------------------------------------

  const allThresholds =
    SUPPORT.allResolved;


  const creditedThresholds =
    SUPPORT.creditedConfirmed;


  const allResolvedInformative =

    allResolvedSummary.cases >=
      allThresholds.minimumCases

    &&

    allResolvedSummary.fullBounty.cases >=
      allThresholds.minimumFullBountyCases

    &&

    allResolvedSummary.groundOnly.cases >=
      allThresholds.minimumGroundOnlyCases;


  const allResolvedSupported =

    allResolvedInformative

    &&

    (
      allResolvedSummary
        .association
        .sensitivity ??
      0
    ) >=
      allThresholds.minimumSensitivity

    &&

    (
      allResolvedSummary
        .association
        .specificity ??
      0
    ) >=
      allThresholds.minimumSpecificity

    &&

    (
      allResolvedSummary
        .association
        .mcc ??
      -1
    ) >=
      allThresholds.minimumMCC;


  const creditedConfirmedInformative =

    creditedConfirmedSummary.cases >=
      creditedThresholds.minimumCases

    &&

    creditedConfirmedSummary.fullBounty.cases >=
      creditedThresholds.minimumFullBountyCases

    &&

    creditedConfirmedSummary.groundOnly.cases >=
      creditedThresholds.minimumGroundOnlyCases;


  const creditedConfirmedSupported =

    creditedConfirmedInformative

    &&

    (
      creditedConfirmedSummary
        .association
        .sensitivity ??
      0
    ) >=
      creditedThresholds.minimumSensitivity

    &&

    (
      creditedConfirmedSummary
        .association
        .specificity ??
      0
    ) >=
      creditedThresholds.minimumSpecificity

    &&

    (
      creditedConfirmedSummary
        .association
        .mcc ??
      -1
    ) >=
      creditedThresholds.minimumMCC;


  const support =
    {

      informative:
        allResolvedInformative,

      allResolvedInformative,

      allResolvedSupported,

      creditedConfirmedInformative,

      creditedConfirmedSupported,


      allResolvedCriteria:
        {

          cases:
            allResolvedSummary.cases,

          fullBountyCases:
            allResolvedSummary.fullBounty.cases,

          groundOnlyCases:
            allResolvedSummary.groundOnly.cases,

          sensitivity:
            allResolvedSummary
              .association
              .sensitivity,

          specificity:
            allResolvedSummary
              .association
              .specificity,

          mcc:
            allResolvedSummary
              .association
              .mcc
        },


      creditedConfirmedCriteria:
        {

          cases:
            creditedConfirmedSummary.cases,

          fullBountyCases:
            creditedConfirmedSummary.fullBounty.cases,

          groundOnlyCases:
            creditedConfirmedSummary.groundOnly.cases,

          sensitivity:
            creditedConfirmedSummary
              .association
              .sensitivity,

          specificity:
            creditedConfirmedSummary
              .association
              .specificity,

          mcc:
            creditedConfirmedSummary
              .association
              .mcc
        }
    };


  // ----------------------------------------------------------
  // OUTPUT
  // ----------------------------------------------------------

  const result =
    {

      replay:
        replayName,

      version:
        VERSION,

      canonical:
        false,


      script110Telemetry:
        {

          meleeMessages:
            script110Replay
              ?.telemetry
              ?.meleeMessages
            ??
            0,

          targetDamageMessages:
            script110Replay
              ?.telemetry
              ?.targetDamageMessages
            ??
            null
        },


      cases:
        {

          input:
            classified.length,

          fatalTypeResolved:
            typeResolved.length,

          fatalTypeCoverageRate:
            rate(
              typeResolved.length,
              classified.length
            ),

          fatalAttackerCreditedConfirmed:
            creditedConfirmedRows.length,

          creditedConfirmedCoverageRate:
            rate(
              creditedConfirmedRows.length,
              classified.length
            ),

          conflictingFatalCitadelTypes:
            conflictingFatalCitadelTypes.length
        },


      allResolved:
        allResolvedSummary,

      creditedConfirmed:
        creditedConfirmedSummary,

      fatalCitadelTypeCounts:
        typeCounts,

      genericDamageTypeCounts,

      fatalTickOffsets,

      fatalTickOffsetSummary:
        summarizeNumbers(
          fatalTickOffsets
        ),

      support,


      interpretation:
        {

          positiveClass:
            'DIRECT_FULL_BOUNTY_CANDIDATE',

          negativeClass:
            'GROUND_ONLY',

          meleeDefinition:
            'fatal CCitadelUserMessage_Damage.citadelType === 3',

          enumMeaning:
            'ECitadelDamageType.CITADEL_DAMAGETYPE_MELEE',

          strongestEvidence:
            'creditedConfirmed cohort ties the independently reconstructed credited last-hitter to the fatal Damage attacker before evaluating melee damage type.'
        },


      outputs:
        {

          cases:
            classifiedOutputPath,

          summary:
            replaySummaryPath
        }
    };


  await writeJsonl(
    classifiedOutputPath,
    classified
  );


  writeFileSync(
    replaySummaryPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    'utf8'
  );


  return {

    ...result,

    script110MeleeMessages:
      script110Replay
        ?.telemetry
        ?.meleeMessages
      ??
      0
  };
}


// ============================================================
// CLASSIFY FATAL DAMAGE
// ============================================================

function classifyFatalDamage(
  row
) {

  const confirmation =
    row?.fatalConfirmation
    ??
    {};


  const events =
    Array.isArray(
      confirmation.fatalDamageEvents
    )
      ? confirmation.fatalDamageEvents
      : [];


  // ----------------------------------------------------------
  // Script110 already sorted fatalDamageEvents by absolute
  // distance from the Trooper death tick.
  //
  // Prefer bestFatalDamage when available.
  // ----------------------------------------------------------

  let best =
    confirmation.bestFatalDamage
    ??
    events[0]
    ??
    null;


  // ----------------------------------------------------------
  // If bestFatalDamage exists but lacks citadelType, use the
  // nearest fatal event that actually contains one.
  // ----------------------------------------------------------

  if (
    !Number.isFinite(
      finite(
        best?.citadelType
      )
    )
  ) {

    best =
      events.find(
        event =>
          Number.isFinite(
            finite(
              event?.citadelType
            )
          )
      )
      ??
      best;
  }


  const citadelType =
    finite(
      best?.citadelType
    );


  const damageType =
    finite(
      best?.damageType
    );


  const tick =
    finite(
      best?.tick
    );


  const offsetTicks =
    finite(
      best?.offsetTicks
    );


  const attackerName =
    best
      ?.attackerPlayer
      ?.playerName
    ??
    confirmation.fatalAttackerName
    ??
    null;


  const attackerIdentityResolved =
    Boolean(
      attackerName
    );


  const creditedAttackerMatch =
    confirmation
      ?.creditedFatalAttackerMatch ===
    true;


  const distinctCitadelTypes =
    [
      ...new Set(

        events
          .map(
            event =>
              finite(
                event?.citadelType
              )
          )
          .filter(
            Number.isFinite
          )
      )
    ]
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  return {

    fatalEventCount:
      events.length,

    typeResolved:
      Number.isFinite(
        citadelType
      ),

    citadelType,

    damageType,

    isMelee:
      citadelType ===
      MELEE_CITADEL_TYPE,

    tick,

    offsetTicks,

    attackerName,

    attackerIdentityResolved,

    creditedAttackerMatch,

    distinctCitadelTypes,

    conflictingTypes:
      distinctCitadelTypes.length >
      1
  };
}


// ============================================================
// SUMMARIZE CLASSIFICATION COHORT
// ============================================================

function summarizeClassificationCohort({

  rows,

  denominator,

  cohortId
}) {

  const fullBounty =
    rows.filter(
      row =>
        row.analysisClass ===
        'DIRECT_FULL_BOUNTY_CANDIDATE'
    );


  const groundOnly =
    rows.filter(
      row =>
        row.analysisClass ===
        'GROUND_ONLY'
    );


  const fullMelee =
    fullBounty.filter(
      row =>
        row.fatalIsMelee
    );


  const groundMelee =
    groundOnly.filter(
      row =>
        row.fatalIsMelee
    );


  const association =
    binaryAssociation(

      rows.map(
        row => ({

          actualPositive:
            row.analysisClass ===
            'DIRECT_FULL_BOUNTY_CANDIDATE',

          predictedPositive:
            row.fatalIsMelee
        })
      )
    );


  return {

    cohortId,

    cases:
      rows.length,

    denominator,

    coverageRate:
      rate(
        rows.length,
        denominator
      ),


    fullBounty:
      {

        cases:
          fullBounty.length,

        melee:
          fullMelee.length,

        nonMelee:
          fullBounty.length -
          fullMelee.length,

        meleeRate:
          rate(
            fullMelee.length,
            fullBounty.length
          )
      },


    groundOnly:
      {

        cases:
          groundOnly.length,

        melee:
          groundMelee.length,

        nonMelee:
          groundOnly.length -
          groundMelee.length,

        meleeRate:
          rate(
            groundMelee.length,
            groundOnly.length
          )
      },


    association
  };
}


// ============================================================
// DAMAGE TYPE COUNTS
// ============================================================

function countDamageTypes(
  rows
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const type =
      row.fatalCitadelType;


    const label =
      damageTypeName(
        type
      );


    const key =
      `${type ?? 'NULL'}:${label}`;


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


  return Object.fromEntries(

    [
      ...map.entries()
    ]
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
  );
}


function damageTypeName(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'UNRESOLVED';
  }


  return CITADEL_DAMAGE_TYPE[
    value
  ]
  ??
  `UNKNOWN_${value}`;
}


// ============================================================
// BINARY ASSOCIATION
// ============================================================

function binaryAssociation(
  rows
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
    of rows
  ) {

    if (
      row.actualPositive
      &&
      row.predictedPositive
    ) {

      tp++;

    } else if (
      row.actualPositive
      &&
      !row.predictedPositive
    ) {

      fn++;

    } else if (
      !row.actualPositive
      &&
      row.predictedPositive
    ) {

      fp++;

    } else {

      tn++;
    }
  }


  return {

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

    positivePredictiveValue:
      safeDivide(
        tp,
        tp +
        fp
      ),

    negativePredictiveValue:
      safeDivide(
        tn,
        tn +
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

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
  );


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
// COLLECTION HELPERS
// ============================================================

function countByObject(
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
      );


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


  return Object.fromEntries(

    [
      ...map.entries()
    ]
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

function printReplay(
  row
) {

  console.log('');

  console.log(
    'FATAL TYPE COVERAGE'
  );


  console.log(
    `  cases:                      ${row.cases.input}`
  );


  console.log(
    `  citadel type resolved:      ${row.cases.fatalTypeResolved}/${row.cases.input} (${formatPercent(
      row.cases.fatalTypeCoverageRate
    )})`
  );


  console.log(
    `  credited attacker confirmed:${row.cases.fatalAttackerCreditedConfirmed}/${row.cases.input} (${formatPercent(
      row.cases.creditedConfirmedCoverageRate
    )})`
  );


  console.log(
    `  conflicting fatal types:    ${row.cases.conflictingFatalCitadelTypes}`
  );


  console.log('');

  console.log(
    'ALL TYPE-RESOLVED CASES'
  );


  console.log(
    `  full-bounty melee:          ${row.allResolved.fullBounty.melee}/${row.allResolved.fullBounty.cases} (${formatPercent(
      row.allResolved.fullBounty.meleeRate
    )})`
  );


  console.log(
    `  ground-only melee:          ${row.allResolved.groundOnly.melee}/${row.allResolved.groundOnly.cases} (${formatPercent(
      row.allResolved.groundOnly.meleeRate
    )})`
  );


  console.log(
    `  sensitivity:                ${formatPercent(
      row.allResolved.association.sensitivity
    )}`
  );


  console.log(
    `  specificity:                ${formatPercent(
      row.allResolved.association.specificity
    )}`
  );


  console.log(
    `  accuracy:                   ${formatPercent(
      row.allResolved.association.accuracy
    )}`
  );


  console.log(
    `  MCC:                        ${formatNumber(
      row.allResolved.association.mcc
    )}`
  );


  console.log('');

  console.log(
    'CREDITED FATAL ATTACKER CONFIRMED'
  );


  console.log(
    `  cases:                      ${row.creditedConfirmed.cases}`
  );


  console.log(
    `  full-bounty melee:          ${row.creditedConfirmed.fullBounty.melee}/${row.creditedConfirmed.fullBounty.cases} (${formatPercent(
      row.creditedConfirmed.fullBounty.meleeRate
    )})`
  );


  console.log(
    `  ground-only melee:          ${row.creditedConfirmed.groundOnly.melee}/${row.creditedConfirmed.groundOnly.cases} (${formatPercent(
      row.creditedConfirmed.groundOnly.meleeRate
    )})`
  );


  console.log(
    `  sensitivity:                ${formatPercent(
      row.creditedConfirmed.association.sensitivity
    )}`
  );


  console.log(
    `  specificity:                ${formatPercent(
      row.creditedConfirmed.association.specificity
    )}`
  );


  console.log(
    `  MCC:                        ${formatNumber(
      row.creditedConfirmed.association.mcc
    )}`
  );


  console.log('');

  console.log(
    'FATAL CITADEL TYPE COUNTS'
  );


  console.log(
    `  full-bounty: ${JSON.stringify(
      row.fatalCitadelTypeCounts.fullBounty
    )}`
  );


  console.log(
    `  ground-only: ${JSON.stringify(
      row.fatalCitadelTypeCounts.groundOnly
    )}`
  );


  console.log('');

  console.log(
    'SUPPORT'
  );


  console.log(
    `  all-resolved:               ${row.support.allResolvedSupported}`
  );


  console.log(
    `  credited-confirmed:         ${row.support.creditedConfirmedSupported}`
  );
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
    '# Fatal Damage Citadel-Type Melee Validation'
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Direct telemetry'
  );


  lines.push(
    ''
  );


  lines.push(
    '`CCitadelUserMessage_Damage.citadel_type` is interpreted using `ECitadelDamageType`, where value `3` is `CITADEL_DAMAGETYPE_MELEE`.'
  );


  lines.push(
    ''
  );


  lines.push(
    'Script110 observed no usable `MeleeHit` messages, but its fatal Damage telemetry was retained and analyzed here without reparsing the demos.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Replay results'
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
      `- Fatal citadel-type coverage: ${formatPercent(replay.cases.fatalTypeCoverageRate)}`
    );


    lines.push(
      `- Full-bounty fatal melee rate: ${formatPercent(replay.allResolved.fullBounty.meleeRate)}`
    );


    lines.push(
      `- Ground-only fatal melee rate: ${formatPercent(replay.allResolved.groundOnly.meleeRate)}`
    );


    lines.push(
      `- Sensitivity: ${formatPercent(replay.allResolved.association.sensitivity)}`
    );


    lines.push(
      `- Specificity: ${formatPercent(replay.allResolved.association.specificity)}`
    );


    lines.push(
      `- MCC: ${formatNumber(replay.allResolved.association.mcc)}`
    );


    lines.push(
      `- Credited-confirmed full-bounty melee rate: ${formatPercent(replay.creditedConfirmed.fullBounty.meleeRate)}`
    );


    lines.push(
      `- Credited-confirmed ground-only melee rate: ${formatPercent(replay.creditedConfirmed.groundOnly.meleeRate)}`
    );


    lines.push(
      `- Credited-confirmed MCC: ${formatNumber(replay.creditedConfirmed.association.mcc)}`
    );


    lines.push(
      `- Direct support: **${replay.support.allResolvedSupported}**`
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
    summary.interpretation.conclusion
  );


  lines.push(
    ''
  );


  lines.push(
    summary.interpretation.nextStage
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}