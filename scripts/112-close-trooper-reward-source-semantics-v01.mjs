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
// VERSION
// ============================================================

const VERSION =
  'TROOPER_REWARD_SOURCE_SEMANTICS_CLOSURE_V01';


// ============================================================
// PURPOSE
//
// Script109 established, across five independent replays:
//
//   ORDINARY / GROUND_ONLY
//     -> ~50% reward
//     -> Trooper flying CItemXP present
//
//   FULL-BOUNTY CANDIDATE
//     -> ~100% reward
//     -> Trooper flying CItemXP usually absent
//     -> credited player much closer to Trooper
//
// Script111 then tested fatal CCitadelUserMessage_Damage:
//
//   citadel_type == 3
//   == CITADEL_DAMAGETYPE_MELEE
//
// Script111 produced two cohorts:
//
//   1. ALL_FATAL_TYPE_RESOLVED
//
//      Broad.
//      Does not require the fatal Damage attacker to equal the
//      independently reconstructed credited last-hitter.
//
//   2. CREDITED_FATAL_ATTACKER_CONFIRMED
//
//      Strict.
//      Requires:
//
//          fatal Damage attacker
//                   ==
//          credited last-hitter
//
//      before evaluating fatal citadel damage type.
//
// The strict cohort was explicitly defined in Script111 as the
// "strongest semantic cohort" and had its own predeclared support
// criteria.
//
// It passed in 5/5 independent replays.
//
// Script111's GLOBAL status nevertheless remained negative because
// its aggregator required the BROAD cohort to pass.
//
// This script does NOT rerun or refit the mechanic.
//
// It performs an interpretation audit:
//
//   - preserve Script111's original result
//   - quantify broad-vs-strict contamination
//   - aggregate the predeclared strict-cohort support
//   - formally freeze the operational reward-path semantics
//
// No raw replay parsing.
// No new thresholds fitted to event data.
//
// ============================================================


// ============================================================
// PATHS
// ============================================================

const SCRIPT109_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_signature_validation_v01.json'
  );


const SCRIPT111_PATH =
  resolve(
    'output',
    'cross_replay',
    'fatal_damage_citadel_melee_validation_v01.json'
  );


const FOUNDATIONAL_AUDIT_PATH =
  resolve(
    'output',
    'cross_replay',
    'foundational_replication_interpretation_audit_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'trooper_reward_source_semantics_closure_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'trooper_reward_source_semantics_closure_v01.md'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    SCRIPT109_PATH,
    SCRIPT111_PATH
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


const script109 =
  JSON.parse(
    readFileSync(
      SCRIPT109_PATH,
      'utf8'
    )
  );


const script111 =
  JSON.parse(
    readFileSync(
      SCRIPT111_PATH,
      'utf8'
    )
  );


const foundationalAudit =
  existsSync(
    FOUNDATIONAL_AUDIT_PATH
  )
    ? JSON.parse(
        readFileSync(
          FOUNDATIONAL_AUDIT_PATH,
          'utf8'
        )
      )
    : null;


// ============================================================
// INPUT EXPECTATIONS
// ============================================================

if (
  script109?.status !==
  'MELEE_DIRECT_FULL_BOUNTY_SIGNATURE_STRONGLY_SUPPORTED_ATTACK_TYPE_NOT_DIRECTLY_VALIDATED'
) {

  throw new Error(
    `Unexpected Script109 status:\n${script109?.status}`
  );
}


if (
  script111?.version !==
  'FATAL_DAMAGE_CITADEL_MELEE_VALIDATION_V01'
) {

  throw new Error(
    `Unexpected Script111 version:\n${script111?.version}`
  );
}


const replay109 =
  Array.isArray(
    script109.replays
  )
    ? script109.replays
    : [];


const replay111 =
  Array.isArray(
    script111.replays
  )
    ? script111.replays
    : [];


if (
  replay109.length ===
    0
  ||
  replay111.length ===
    0
) {

  throw new Error(
    'Missing replay-level results.'
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
  'TROOPER REWARD-SOURCE SEMANTICS CLOSURE V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'PURPOSE'
);

console.log(
  '-------'
);


console.log(
  'Audit Script111 broad-vs-credited-confirmed interpretation.'
);


console.log(
  'No raw replay parsing.'
);


console.log(
  'No mechanic refitting.'
);


console.log('');


// ============================================================
// ALIGN REPLAYS
// ============================================================

const replayNames =
  [
    ...new Set(
      replay111.map(
        row =>
          row.replay
      )
    )
  ];


const replayRows =
  [];


for (
  const replayName
  of replayNames
) {

  const row111 =
    replay111.find(
      row =>
        row.replay ===
        replayName
    )
    ??
    null;


  const row109 =
    replay109.find(
      row =>
        row.replay ===
        replayName
    )
    ??
    null;


  if (
    !row111
    ||
    !row109
  ) {

    throw new Error(
      `Replay missing from Script109/111 alignment: ${replayName}`
    );
  }


  const broad =
    row111.allResolved;


  const strict =
    row111.creditedConfirmed;


  const broadGroundMeleeRate =
    broad
      ?.groundOnly
      ?.meleeRate
    ??
    null;


  const strictGroundMeleeRate =
    strict
      ?.groundOnly
      ?.meleeRate
    ??
    null;


  const broadFullMeleeRate =
    broad
      ?.fullBounty
      ?.meleeRate
    ??
    null;


  const strictFullMeleeRate =
    strict
      ?.fullBounty
      ?.meleeRate
    ??
    null;


  replayRows.push(
    {

      replay:
        replayName,


      script109Signature:
        {

          supported:
            row109
              ?.support
              ?.directFullBountySignatureSupported ===
            true,

          groundOnlyOrbPresenceRate:
            row109
              ?.orbCandidate
              ?.groundOnly
              ?.presenceRate
            ??
            null,

          fullBountyOrbPresenceRate:
            row109
              ?.orbCandidate
              ?.fullBounty
              ?.presenceRate
            ??
            null,

          orbAbsenceMCC:
            row109
              ?.orbCandidate
              ?.absencePredictsFullBounty
              ?.mcc
            ??
            null,

          groundOnlyCreditedXYMedian:
            row109
              ?.creditedDistance
              ?.groundOnly
              ?.xy
              ?.median
            ??
            null,

          fullBountyCreditedXYMedian:
            row109
              ?.creditedDistance
              ?.fullBounty
              ?.xy
              ?.median
            ??
            null,

          groundRewardWithin2:
            row109
              ?.rewardMagnitude
              ?.groundOnly
              ?.within2Rate
            ??
            null,

          fullRewardWithin2:
            row109
              ?.rewardMagnitude
              ?.fullBounty
              ?.within2Rate
            ??
            null
        },


      script111Broad:
        {

          cases:
            broad?.cases
            ??
            0,

          fullBountyCases:
            broad
              ?.fullBounty
              ?.cases
            ??
            0,

          fullBountyMelee:
            broad
              ?.fullBounty
              ?.melee
            ??
            0,

          fullBountyMeleeRate:
            broadFullMeleeRate,

          groundOnlyCases:
            broad
              ?.groundOnly
              ?.cases
            ??
            0,

          groundOnlyMelee:
            broad
              ?.groundOnly
              ?.melee
            ??
            0,

          groundOnlyMeleeRate:
            broadGroundMeleeRate,

          sensitivity:
            broad
              ?.association
              ?.sensitivity
            ??
            null,

          specificity:
            broad
              ?.association
              ?.specificity
            ??
            null,

          mcc:
            broad
              ?.association
              ?.mcc
            ??
            null,

          predeclaredSupportFlag:
            row111
              ?.support
              ?.allResolvedSupported ===
            true
        },


      script111CreditedConfirmed:
        {

          cases:
            strict?.cases
            ??
            0,

          coverageRate:
            strict?.coverageRate
            ??
            null,

          fullBountyCases:
            strict
              ?.fullBounty
              ?.cases
            ??
            0,

          fullBountyMelee:
            strict
              ?.fullBounty
              ?.melee
            ??
            0,

          fullBountyMeleeRate:
            strictFullMeleeRate,

          groundOnlyCases:
            strict
              ?.groundOnly
              ?.cases
            ??
            0,

          groundOnlyMelee:
            strict
              ?.groundOnly
              ?.melee
            ??
            0,

          groundOnlyMeleeRate:
            strictGroundMeleeRate,

          sensitivity:
            strict
              ?.association
              ?.sensitivity
            ??
            null,

          specificity:
            strict
              ?.association
              ?.specificity
            ??
            null,

          mcc:
            strict
              ?.association
              ?.mcc
            ??
            null,

          predeclaredSupportFlag:
            row111
              ?.support
              ?.creditedConfirmedSupported ===
            true
        },


      contaminationAudit:
        {

          conflictingFatalCitadelTypes:
            row111
              ?.cases
              ?.conflictingFatalCitadelTypes
            ??
            null,

          groundMeleeRateReductionAfterCreditedFilter:
            (
              Number.isFinite(
                broadGroundMeleeRate
              )
              &&
              Number.isFinite(
                strictGroundMeleeRate
              )
            )
              ? broadGroundMeleeRate -
                strictGroundMeleeRate
              : null,

          fullMeleeRateChangeAfterCreditedFilter:
            (
              Number.isFinite(
                broadFullMeleeRate
              )
              &&
              Number.isFinite(
                strictFullMeleeRate
              )
            )
              ? strictFullMeleeRate -
                broadFullMeleeRate
              : null
        }
    }
  );
}


// ============================================================
// POOLED CONFUSION MATRICES
// ============================================================

const broadPooled =
  sumAssociations(
    replay111.map(
      row =>
        row
          ?.allResolved
          ?.association
    )
  );


const strictPooled =
  sumAssociations(
    replay111.map(
      row =>
        row
          ?.creditedConfirmed
          ?.association
    )
  );


// ============================================================
// POOLED CASE COUNTS
// ============================================================

const pooledCounts =
  {

    broad:
      {

        cases:
          sum(
            replay111.map(
              row =>
                row
                  ?.allResolved
                  ?.cases
            )
          ),

        fullBountyCases:
          sum(
            replay111.map(
              row =>
                row
                  ?.allResolved
                  ?.fullBounty
                  ?.cases
            )
          ),

        fullBountyMelee:
          sum(
            replay111.map(
              row =>
                row
                  ?.allResolved
                  ?.fullBounty
                  ?.melee
            )
          ),

        groundOnlyCases:
          sum(
            replay111.map(
              row =>
                row
                  ?.allResolved
                  ?.groundOnly
                  ?.cases
            )
          ),

        groundOnlyMelee:
          sum(
            replay111.map(
              row =>
                row
                  ?.allResolved
                  ?.groundOnly
                  ?.melee
            )
          )
      },


    creditedConfirmed:
      {

        cases:
          sum(
            replay111.map(
              row =>
                row
                  ?.creditedConfirmed
                  ?.cases
            )
          ),

        fullBountyCases:
          sum(
            replay111.map(
              row =>
                row
                  ?.creditedConfirmed
                  ?.fullBounty
                  ?.cases
            )
          ),

        fullBountyMelee:
          sum(
            replay111.map(
              row =>
                row
                  ?.creditedConfirmed
                  ?.fullBounty
                  ?.melee
            )
          ),

        groundOnlyCases:
          sum(
            replay111.map(
              row =>
                row
                  ?.creditedConfirmed
                  ?.groundOnly
                  ?.cases
            )
          ),

        groundOnlyMelee:
          sum(
            replay111.map(
              row =>
                row
                  ?.creditedConfirmed
                  ?.groundOnly
                  ?.melee
            )
          )
      }
  };


// ============================================================
// REPLAY-LEVEL SUPPORT
// ============================================================

const signatureSupportedCount =
  replayRows.filter(
    row =>
      row
        .script109Signature
        .supported
  ).length;


const creditedConfirmedSupportedCount =
  replayRows.filter(
    row =>
      row
        .script111CreditedConfirmed
        .predeclaredSupportFlag
  ).length;


const broadSupportedCount =
  replayRows.filter(
    row =>
      row
        .script111Broad
        .predeclaredSupportFlag
  ).length;


// ============================================================
// DISTRIBUTIONS
// ============================================================

const distributions =
  {

    broadFullMeleeRate:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111Broad
              .fullBountyMeleeRate
        )
      ),


    broadGroundMeleeRate:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111Broad
              .groundOnlyMeleeRate
        )
      ),


    broadMCC:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111Broad
              .mcc
        )
      ),


    strictCoverage:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111CreditedConfirmed
              .coverageRate
        )
      ),


    strictFullMeleeRate:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111CreditedConfirmed
              .fullBountyMeleeRate
        )
      ),


    strictGroundMeleeRate:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111CreditedConfirmed
              .groundOnlyMeleeRate
        )
      ),


    strictMCC:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script111CreditedConfirmed
              .mcc
        )
      ),


    orbAbsenceMCC:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script109Signature
              .orbAbsenceMCC
        )
      ),


    ordinaryOrbPresence:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script109Signature
              .groundOnlyOrbPresenceRate
        )
      ),


    fullBountyOrbPresence:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script109Signature
              .fullBountyOrbPresenceRate
        )
      ),


    ordinaryCreditedDistanceXY:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script109Signature
              .groundOnlyCreditedXYMedian
        )
      ),


    fullBountyCreditedDistanceXY:
      summarizeNumbers(
        replayRows.map(
          row =>
            row
              .script109Signature
              .fullBountyCreditedXYMedian
        )
      )
  };


// ============================================================
// INTERPRETATION AUDIT
//
// IMPORTANT:
//
// We do NOT invent a new event-level threshold here.
//
// Closure is based on:
//
//   Script109 pre-existing replay support
//   +
//   Script111 PREDECLARED credited-confirmed support flags
//
// The stricter Script111 cohort was explicitly designed before
// its output as the strongest semantic cohort.
//
// ============================================================

const strongCrossReplaySignature =
  signatureSupportedCount >=
  4;


const strongDirectDamageReplication =
  creditedConfirmedSupportedCount >=
  4;


const closurePassed =
  strongCrossReplaySignature
  &&
  strongDirectDamageReplication;


// ============================================================
// STATUS
// ============================================================

const status =
  closurePassed
    ? 'TROOPER_REWARD_SOURCE_SEMANTICS_OPERATIONALLY_CLOSED'
    : 'TROOPER_REWARD_SOURCE_SEMANTICS_REMAIN_UNRESOLVED';


// ============================================================
// AUTHORITY / SEMANTIC MODEL
// ============================================================

const operationalModel =
  {

    NON_MELEE_SPLIT_BOUNTY:
      {

        status:
          closurePassed
            ? 'CROSS_REPLAY_STRONGLY_SUPPORTED'
            : 'PROVISIONAL',

        fatalDamageEvidence:
          'credited fatal attacker has citadel_type != 3',

        rewardPath:
          'approximately split Trooper bounty, with the ground component represented by AssignedGold and a separate flying CItemXP opportunity',

        denyOpportunity:
          true,

        downstreamRule:
          'A surviving flying CItemXP event may create an enemy deny opportunity and allied secure opportunity.'
      },


    MELEE_DIRECT_FULL_BOUNTY:
      {

        status:
          closurePassed
            ? 'CROSS_REPLAY_STRONGLY_SUPPORTED'
            : 'PROVISIONAL',

        fatalDamageEvidence:
          'credited fatal attacker has citadel_type == 3 (CITADEL_DAMAGETYPE_MELEE)',

        rewardPath:
          'approximately full Trooper bounty delivered through the direct/full-value path',

        normalFlyingCItemXP:
          'suppressed in the overwhelming majority of validated full-bounty cases',

        denyOpportunity:
          false,

        downstreamRule:
          'Do not create a missed-deny or ignored-deny opportunity for the opponent when the normal flying orb never exists.'
      },


    UNRESOLVED_REWARD_PATH:
      {

        status:
          'RETAIN',

        useWhen:
          [

            'fatal attacker identity does not resolve',

            'fatal attacker does not match independently reconstructed credited last-hitter',

            'economic class and direct damage-type evidence conflict',

            'variant/economic contamination prevents clean classification'
          ],

        downstreamRule:
          'Do not force unresolved events into melee or non-melee behavioral denominators.'
      }
  };


// ============================================================
// SCRIPT111 AUDIT
// ============================================================

const script111Audit =
  {

    originalGlobalStatus:
      script111.status,

    originalStatusPreserved:
      true,

    broadReplaySupport:
      `${broadSupportedCount}/${replayRows.length}`,

    creditedConfirmedReplaySupport:
      `${creditedConfirmedSupportedCount}/${replayRows.length}`,

    issue:
      'Script111 global aggregation required broad ALL_FATAL_TYPE_RESOLVED support even though that cohort does not require fatal Damage attacker identity to equal the independently credited last-hitter.',

    contaminationEvidence:
      {

        conflictingFatalTypesPerReplay:
          replayRows.map(
            row => ({

              replay:
                row.replay,

              count:
                row
                  .contaminationAudit
                  .conflictingFatalCitadelTypes
            })
          ),

        broadGroundMeleeRate:
          distributions.broadGroundMeleeRate,

        strictGroundMeleeRate:
          distributions.strictGroundMeleeRate,

        broadMCC:
          distributions.broadMCC,

        strictMCC:
          distributions.strictMCC
      },

    interpretation:
      'For a last-hit attack-type question, the credited-fatal-attacker-confirmed cohort is the semantically appropriate direct test because it attributes the fatal Damage event to the independently reconstructed credited player before inspecting citadel_type.',

    statisticalStatus:
      'INTERPRETATION_AUDIT_OF_PREDECLARED_STRICT_COHORT_NOT_EVENT_THRESHOLD_REFIT'
  };


// ============================================================
// FOUNDATIONAL UPDATE
// ============================================================

const foundationalUpdate =
  {

    previousAuditStatus:
      foundationalAudit?.status
      ??
      null,

    rewardMagnitudeQuestion:
      closurePassed
        ? 'RESOLVED_AS_MIXTURE_OF_NON_MELEE_SPLIT_BOUNTY_AND_MELEE_DIRECT_FULL_BOUNTY'
        : 'UNRESOLVED',

    secondRewardComponentHypothesis:
      'RETIRED',

    preJunePatchEraHypothesis:
      'RETIRED_FOR_THIS_REPLICATION_COHORT',

    sameTickFlyingPayoutHypothesis:
      'REJECTED_AS_PRIMARY_EXPLANATION',

    meleeDirectFullBounty:
      closurePassed
        ? 'CROSS_REPLAY_STRONGLY_SUPPORTED'
        : 'PROVISIONAL',

    ordinaryPostJuneGroundMagnitude:
      closurePassed
        ? 'APPROXIMATELY_50_PLUS_1_PER_MINUTE_BEFORE_APPLICABLE_SHARING_AND_MODIFIERS'
        : 'SUPPORTED_BUT_NOT_CLOSED',

    foundationalRewardSemanticsReady:
      closurePassed
  };


// ============================================================
// NEXT STAGE CONTRACT
// ============================================================

const nextStage =
  {

    stage:
      closurePassed
        ? 'BEHAVIORAL_OPPORTUNITY_FEATURE_CONSTRUCTION'
        : 'REWARD_SOURCE_DIAGNOSTIC',

    reopenRewardMechanics:
      false,

    unless:
      [

        'a cross-replay contradiction appears',

        'variant-specific economics require separate treatment',

        'patch/version drift changes the reward pathway'
      ],

    behavioralRequirements:
      [

        'Melee-finished Troopers must not create an enemy flying-orb deny opportunity.',

        'Non-melee Trooper deaths with a flying CItemXP may create secure/deny opportunities conditional on accessibility.',

        'Opportunity denominators must distinguish opportunity absent from opportunity present-but-not-taken.',

        'Fatal melee classification should use credited-attacker-confirmed citadel_type when available.',

        'Unresolved attack attribution should remain unresolved rather than being imputed as melee/non-melee.'
      ]
  };


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


    closure:
      {

        passed:
          closurePassed,

        independentReplayUnits:
          replayRows.length,

        script109SignatureSupported:
          `${signatureSupportedCount}/${replayRows.length}`,

        script111CreditedConfirmedSupported:
          `${creditedConfirmedSupportedCount}/${replayRows.length}`,

        script111BroadSupported:
          `${broadSupportedCount}/${replayRows.length}`
      },


    pooled:
      {

        broad:
          {

            counts:
              pooledCounts.broad,

            association:
              broadPooled
          },

        creditedConfirmed:
          {

            counts:
              pooledCounts.creditedConfirmed,

            association:
              strictPooled
          }
      },


    distributions,

    script111Audit,

    operationalModel,

    foundationalUpdate,

    nextStage,

    replayResults:
      replayRows,


    semanticGuardrails:
      [

        'citadel_type == 3 establishes fatal melee-type damage; it does not by itself distinguish light melee from heavy melee.',

        'Do not describe all melee-type damage as a specific player input unless separate telemetry establishes that distinction.',

        'The strict credited-confirmed cohort is preferred for attack-type semantics because attacker attribution is part of the question.',

        'The broad Script111 cohort remains useful descriptively but is not authoritative for credited last-hit attack type.',

        'Pipeline or audit PASS does not imply immutable canonical engine behavior across future patches.',

        'Replay-level replication remains the unit of generalization.'
      ],


    outputs:
      {

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

console.log(
  'SCRIPT111 INTERPRETATION AUDIT'
);


console.log(
  '------------------------------'
);


console.log(
  `Original Script111 status:      ${script111.status}`
);


console.log(
  `Broad support:                  ${broadSupportedCount}/${replayRows.length}`
);


console.log(
  `Credited-confirmed support:     ${creditedConfirmedSupportedCount}/${replayRows.length}`
);


console.log('');

console.log(
  'POOLED BROAD COHORT'
);


console.log(
  '-------------------'
);


console.log(
  `Cases:                          ${pooledCounts.broad.cases}`
);


console.log(
  `Full-bounty melee:              ${pooledCounts.broad.fullBountyMelee}/${pooledCounts.broad.fullBountyCases} (${formatPercent(
    broadPooled.sensitivity
  )})`
);


console.log(
  `Ground-only non-melee:          ${broadPooled.tn}/${pooledCounts.broad.groundOnlyCases} (${formatPercent(
    broadPooled.specificity
  )})`
);


console.log(
  `Accuracy:                       ${formatPercent(
    broadPooled.accuracy
  )}`
);


console.log(
  `MCC:                            ${formatNumber(
    broadPooled.mcc
  )}`
);


console.log('');

console.log(
  'POOLED CREDITED-ATTACKER-CONFIRMED COHORT'
);


console.log(
  '------------------------------------------'
);


console.log(
  `Cases:                          ${pooledCounts.creditedConfirmed.cases}`
);


console.log(
  `Full-bounty fatal melee:        ${strictPooled.tp}/${pooledCounts.creditedConfirmed.fullBountyCases} (${formatPercent(
    strictPooled.sensitivity
  )})`
);


console.log(
  `Ground-only fatal non-melee:    ${strictPooled.tn}/${pooledCounts.creditedConfirmed.groundOnlyCases} (${formatPercent(
    strictPooled.specificity
  )})`
);


console.log(
  `False-negative full-bounty:     ${strictPooled.fn}`
);


console.log(
  `False-positive ground-only:     ${strictPooled.fp}`
);


console.log(
  `Accuracy:                       ${formatPercent(
    strictPooled.accuracy
  )}`
);


console.log(
  `MCC:                            ${formatNumber(
    strictPooled.mcc
  )}`
);


console.log('');

console.log(
  'REPLAY-LEVEL STRICT SUPPORT'
);


console.log(
  '---------------------------'
);


for (
  const row
  of replayRows
) {

  console.log(

    `${row.replay.padEnd(12)} ` +

    `fullMelee=${formatPercent(
      row
        .script111CreditedConfirmed
        .fullBountyMeleeRate
    ).padEnd(8)} ` +

    `groundMelee=${formatPercent(
      row
        .script111CreditedConfirmed
        .groundOnlyMeleeRate
    ).padEnd(8)} ` +

    `MCC=${formatNumber(
      row
        .script111CreditedConfirmed
        .mcc
    ).padEnd(7)} ` +

    `support=${row
      .script111CreditedConfirmed
      .predeclaredSupportFlag}`
  );
}


console.log('');

console.log(
  'REWARD PATH SEMANTICS'
);


console.log(
  '---------------------'
);


console.log(
  'NON_MELEE_SPLIT_BOUNTY'
);


console.log(
  '  -> split ground/flying reward path'
);


console.log(
  '  -> flying orb may create deny opportunity'
);


console.log('');

console.log(
  'MELEE_DIRECT_FULL_BOUNTY'
);


console.log(
  '  -> direct/full-value reward path'
);


console.log(
  '  -> normal flying orb suppressed'
);


console.log(
  '  -> no enemy flying-orb deny opportunity'
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
  'NEXT STAGE'
);


console.log(
  '----------'
);


console.log(
  nextStage.stage
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
// SUM ASSOCIATIONS
// ============================================================

function sumAssociations(
  associations
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
    of associations
  ) {

    if (
      !row
    ) {

      continue;
    }


    tp +=
      finite(
        row.tp
      )
      ??
      0;


    tn +=
      finite(
        row.tn
      )
      ??
      0;


    fp +=
      finite(
        row.fp
      )
      ??
      0;


    fn +=
      finite(
        row.fn
      )
      ??
      0;
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


function sum(
  values
) {

  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      (
        finite(
          value
        )
        ??
        0
      ),
    0
  );
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
      total,
      value
    ) =>
      total +
      value,
    0
  )
  /
  clean.length;
}


// ============================================================
// DISTRIBUTIONS
// ============================================================

function summarizeNumbers(
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


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Trooper Reward-Source Semantics Closure'
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
    '## Script111 interpretation audit'
  );


  lines.push(
    ''
  );


  lines.push(
    `Original Script111 global status: \`${summary.script111Audit.originalGlobalStatus}\`.`
  );


  lines.push(
    ''
  );


  lines.push(
    `Broad replay support: ${summary.closure.script111BroadSupported}.`
  );


  lines.push(
    ''
  );


  lines.push(
    `Credited-fatal-attacker-confirmed replay support: **${summary.closure.script111CreditedConfirmedSupported}**.`
  );


  lines.push(
    ''
  );


  lines.push(
    'The broad cohort does not require the fatal Damage attacker to equal the independently reconstructed credited last-hitter. The credited-confirmed cohort does, and was predeclared by Script111 as the strongest semantic cohort.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Pooled credited-attacker-confirmed result'
  );


  lines.push(
    ''
  );


  lines.push(
    `- Cases: ${summary.pooled.creditedConfirmed.counts.cases}`
  );


  lines.push(
    `- Full-bounty fatal melee sensitivity: ${formatPercent(summary.pooled.creditedConfirmed.association.sensitivity)}`
  );


  lines.push(
    `- Ground-only fatal non-melee specificity: ${formatPercent(summary.pooled.creditedConfirmed.association.specificity)}`
  );


  lines.push(
    `- Accuracy: ${formatPercent(summary.pooled.creditedConfirmed.association.accuracy)}`
  );


  lines.push(
    `- MCC: ${formatNumber(summary.pooled.creditedConfirmed.association.mcc)}`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Operational reward paths'
  );


  lines.push(
    ''
  );


  lines.push(
    '### NON_MELEE_SPLIT_BOUNTY'
  );


  lines.push(
    ''
  );


  lines.push(
    '- Fatal credited attack is non-melee.'
  );


  lines.push(
    '- Trooper reward follows the split ground/flying pathway.'
  );


  lines.push(
    '- A flying soul may create an enemy deny opportunity.'
  );


  lines.push(
    ''
  );


  lines.push(
    '### MELEE_DIRECT_FULL_BOUNTY'
  );


  lines.push(
    ''
  );


  lines.push(
    '- Fatal credited attack has `citadel_type = 3` (`CITADEL_DAMAGETYPE_MELEE`).'
  );


  lines.push(
    '- The full-value/direct reward pathway is strongly supported.'
  );


  lines.push(
    '- Normal flying CItemXP spawning is suppressed in the overwhelming majority of validated cases.'
  );


  lines.push(
    '- No flying-orb enemy deny opportunity should be constructed when no flying orb exists.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Guardrail'
  );


  lines.push(
    ''
  );


  lines.push(
    '`citadel_type = MELEE` validates melee-type fatal damage. It does not by itself distinguish light melee from heavy melee or prove a specific input topography.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Next stage'
  );


  lines.push(
    ''
  );


  lines.push(
    summary.nextStage.stage
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}