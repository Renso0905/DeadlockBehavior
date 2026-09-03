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
// VERSION
// ============================================================

const VERSION =
  'MELEE_FULL_BOUNTY_DIRECT_ATTACK_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// Scripts106-109 established a very strong cross-replay
// signature:
//
//   ORDINARY CLASS
//     ~50% Trooper reward
//     Trooper flying CItemXP present
//
//   FULL-BOUNTY CLASS
//     ~100% Trooper reward
//     Trooper flying CItemXP usually absent
//     credited player very close to Trooper
//
// Current documented mechanics predict exactly this distinction
// for melee last hits.
//
// Script110 performs the missing DIRECT attack-type test.
//
// Deadlock exposes an explicit user message:
//
//   k_EUserMsg_MeleeHit = 355
//
// with:
//
//   hit_entindex
//   heavy
//
// Primary test:
//
//   Does an explicit MELEE_HIT message target the exact Trooper
//   near its death tick?
//
// Negative control:
//
//   Script109 GROUND_ONLY cases.
//
// Positive class:
//
//   Script109 DIRECT_FULL_BOUNTY candidate cases
//   (historical Script106 label GROUND_PLUS_SECOND_COMPONENT).
//
// Secondary confirmation:
//
//   Damage messages are inspected around the same death for:
//
//     victim entity
//     attacker entity
//     victimHealthNew
//
//   Where a fatal damage message can be resolved, we test
//   whether the attacker matches the independently identified
//   credited last-hitter.
//
// IMPORTANT:
//
// A MELEE_HIT near death is direct attack-type telemetry.
//
// It is still observational replay reconstruction, not engine
// source-code proof.
//
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const ENTITY_INDEX_MASK =
  0x3fff;


const MELEE_HIT_MESSAGE_ID =
  355;


const DAMAGE_MESSAGE_ID =
  300;


// ------------------------------------------------------------
// Windows are PREDECLARED.
//
// Primary:
//
//   -4 .. +4 ticks around Trooper death
//
// At 64 Hz this is ±62.5 ms.
//
// Wider windows are reported as sensitivity diagnostics only.
// ------------------------------------------------------------

const WINDOWS =
  [

    {
      id:
        'EXACT',

      minOffsetTicks:
        0,

      maxOffsetTicks:
        0
    },

    {
      id:
        'M1_P1',

      minOffsetTicks:
        -1,

      maxOffsetTicks:
        1
    },

    {
      id:
        'M2_P2',

      minOffsetTicks:
        -2,

      maxOffsetTicks:
        2
    },

    {
      id:
        'M4_P4',

      minOffsetTicks:
        -4,

      maxOffsetTicks:
        4,

      primary:
        true
    },

    {
      id:
        'M8_P8',

      minOffsetTicks:
        -8,

      maxOffsetTicks:
        8
    },

    {
      id:
        'M16_P16',

      minOffsetTicks:
        -16,

      maxOffsetTicks:
        16
    }
  ];


const PRIMARY_WINDOW =
  WINDOWS.find(
    row =>
      row.primary
  );


// ------------------------------------------------------------
// Fatal-damage / melee-hit temporal concordance.
//
// If a MELEE_HIT and a fatal Damage message hit the same victim
// within this many ticks, they are treated as temporally
// concordant.
//
// This is supporting confirmation only.
// ------------------------------------------------------------

const MELEE_FATAL_CONCORDANCE_TICKS =
  2;


// ============================================================
// SUPPORT THRESHOLDS
//
// Predeclared before Script110 output.
//
// The explicit melee-hit association is the primary gate.
//
// Fatal-damage confirmation strengthens the interpretation but
// does not invalidate MeleeHit telemetry if Damage messages have
// incomplete NPC coverage.
// ============================================================

const SUPPORT =
  {

    minimumCases:
      100,

    minimumFullBountyCases:
      20,

    minimumGroundOnlyCases:
      50,

    minimumMeleeSensitivity:
      0.80,

    minimumMeleeSpecificity:
      0.95,

    minimumMeleeMCC:
      0.75,


    minimumFatalDamageComparable:
      15,

    minimumMeleeFatalConcordanceRate:
      0.80,

    minimumCreditedFatalAttackerComparable:
      15,

    minimumCreditedFatalAttackerMatchRate:
      0.80
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


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_direct_attack_validation_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_direct_attack_validation_v01.md'
  );


// ============================================================
// GLOBAL INPUTS
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT109_PATH
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
  'DIRECT MELEE FULL-BOUNTY VALIDATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'PRIMARY TEST'
);

console.log(
  '------------'
);


console.log(
  'Explicit MELEE_HIT message targets exact dying Trooper.'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  `Primary death window:      ${PRIMARY_WINDOW.minOffsetTicks}..+${PRIMARY_WINDOW.maxOffsetTicks} ticks`
);


console.log(
  `Melee message ID:          ${MELEE_HIT_MESSAGE_ID}`
);


console.log(
  `Damage message ID:         ${DAMAGE_MESSAGE_ID}`
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
// CROSS-REPLAY STATUS
// ============================================================

const informativeReplays =
  replayResults.filter(
    row =>
      row.support.informative
  );


const meleeSupportedReplays =
  informativeReplays.filter(
    row =>
      row
        .support
        .directMeleeAttackTypeSupported
  );


const fatalSupportedReplays =
  informativeReplays.filter(
    row =>
      row
        .support
        .fatalDamageConfirmationSupported
  );


let status;


if (
  informativeReplays.length <
  3
) {

  status =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  meleeSupportedReplays.length >=
    4
  &&
  fatalSupportedReplays.length >=
    4
) {

  status =
    'MELEE_FULL_BOUNTY_DIRECT_ATTACK_AND_FATAL_ATTRIBUTION_STRONGLY_SUPPORTED';

} else if (
  meleeSupportedReplays.length >=
    4
) {

  status =
    'MELEE_FULL_BOUNTY_DIRECT_ATTACK_STRONGLY_SUPPORTED_FATAL_ATTRIBUTION_INCOMPLETE';

} else if (
  meleeSupportedReplays.length >=
    3
) {

  status =
    'MELEE_FULL_BOUNTY_DIRECT_ATTACK_SUPPORTED';

} else {

  status =
    'MELEE_ATTACK_TYPE_NOT_DIRECTLY_REPLICATED';
}


// ============================================================
// DISTRIBUTIONS
// ============================================================

const distributions =
  {

    meleeFullBountyRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .primaryWindow
              .fullBounty
              .meleeHitRate
        )
      ),


    meleeGroundOnlyRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .primaryWindow
              .groundOnly
              .meleeHitRate
        )
      ),


    meleeMCC:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .primaryWindow
              .association
              .mcc
        )
      ),


    meleeAccuracy:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .primaryWindow
              .association
              .accuracy
        )
      ),


    fullBountyMeleeOffset:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .primaryWindow
              .fullBounty
              .meleeOffsetsTicks
        )
      ),


    fatalDamageCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .fatalDamage
              .fullBountyFatalDamageCoverageRate
        )
      ),


    meleeFatalConcordance:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .fatalDamage
              .meleeFatalConcordanceRate
        )
      ),


    creditedFatalAttackerMatch:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .fatalDamage
              .creditedFatalAttackerMatchRate
        )
      )
  };


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation;


if (
  status ===
  'MELEE_FULL_BOUNTY_DIRECT_ATTACK_AND_FATAL_ATTRIBUTION_STRONGLY_SUPPORTED'
) {

  interpretation =
    {

      rewardSourceResolved:
        true,

      semanticStatus:
        'CROSS_REPLAY_STRONGLY_SUPPORTED',

      conclusion:
        'The direct-full-bounty/no-orb class is strongly linked to explicit MELEE_HIT messages targeting the dying Trooper, and fatal Damage telemetry independently associates the lethal event with the credited player.',

      operationalClassification:
        'MELEE_DIRECT_FULL_BOUNTY',

      ordinaryClassification:
        'NON_MELEE_SPLIT_BOUNTY',

      rewardSemantics:
        'Non-melee Trooper deaths use the split ground/flying reward path; melee last hits use the direct full-bounty path and suppress normal orb spawning.',

      nextStage:
        'Close foundational Trooper reward-source semantics and begin behavioral opportunity-feature construction.'
    };

} else if (
  status ===
  'MELEE_FULL_BOUNTY_DIRECT_ATTACK_STRONGLY_SUPPORTED_FATAL_ATTRIBUTION_INCOMPLETE'
) {

  interpretation =
    {

      rewardSourceResolved:
        true,

      semanticStatus:
        'DIRECT_ATTACK_TYPE_STRONGLY_SUPPORTED_FATAL_MESSAGE_COVERAGE_INCOMPLETE',

      conclusion:
        'The direct-full-bounty/no-orb class is strongly linked to explicit MELEE_HIT messages targeting the dying Trooper across independent replays. Damage-message fatal attribution is incomplete but is not required to retain the direct attack-type finding.',

      operationalClassification:
        'MELEE_DIRECT_FULL_BOUNTY',

      ordinaryClassification:
        'NON_MELEE_SPLIT_BOUNTY',

      nextStage:
        'Close reward-source semantics operationally and move to behavioral opportunity-feature construction.'
    };

} else if (
  status ===
  'MELEE_FULL_BOUNTY_DIRECT_ATTACK_SUPPORTED'
) {

  interpretation =
    {

      rewardSourceResolved:
        false,

      semanticStatus:
        'SUPPORTED_NOT_STRONG',

      conclusion:
        'Explicit MELEE_HIT telemetry supports the full-bounty interpretation, but replay-level replication is not strong enough for closure.',

      nextStage:
        'Inspect only the replay-level MeleeHit failures.'
    };

} else {

  interpretation =
    {

      rewardSourceResolved:
        false,

      semanticStatus:
        'UNRESOLVED',

      conclusion:
        'The explicit MELEE_HIT message does not reproduce the Script109 full-bounty signature strongly enough under the predeclared death window.',

      nextStage:
        'Inspect message timing/coverage before changing the reward interpretation.'
    };
}


// ============================================================
// FINAL SUMMARY
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


    priorEvidence:
      {

        script109Status:
          script109.status,

        workingHypothesis:
          'The historical Script106 high-reward class is the melee direct-full-bounty path rather than a concurrent second reward source.'
      },


    directTelemetry:
      {

        meleeMessageId:
          MELEE_HIT_MESSAGE_ID,

        damageMessageId:
          DAMAGE_MESSAGE_ID,

        meleeMessageMeaning:
          'Explicit replay user message indicating a melee hit on hit_entindex.',

        heavyField:
          'Reported directly when available.',

        fatalDamage:
          'Secondary confirmation using Damage message victimHealthNew and attacker identity.'
      },


    design:
      {

        replicationUnit:
          'REPLAY',

        primaryWindow:
          PRIMARY_WINDOW,

        sensitivityWindows:
          WINDOWS,

        fatalMeleeConcordanceTicks:
          MELEE_FATAL_CONCORDANCE_TICKS,

        positiveClass:
          'Script108/109 GROUND_PLUS_SECOND_COMPONENT, reinterpreted prospectively here as DIRECT_FULL_BOUNTY_CANDIDATE.',

        negativeClass:
          'Script108/109 GROUND_ONLY.',

        attackTypeClaim:
          'An explicit MeleeHit message targeting the exact Trooper near death is direct attack-type evidence. It is not dependent on reward magnitude, CItemXP absence, or player distance.'
      },


    supportThresholds:
      SUPPORT,


    replayCounts:
      {

        total:
          replayResults.length,

        informative:
          informativeReplays.length,

        directMeleeSupported:
          meleeSupportedReplays.length,

        fatalDamageConfirmationSupported:
          fatalSupportedReplays.length
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
  'DIRECT MELEE CROSS-REPLAY SUMMARY'
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
      row.primaryWindow.fullBounty.meleeHitRate
    ).padEnd(8)} ` +

    `ground=${formatPercent(
      row.primaryWindow.groundOnly.meleeHitRate
    ).padEnd(8)} ` +

    `MCC=${formatNumber(
      row.primaryWindow.association.mcc
    ).padEnd(7)} ` +

    `fatal=${String(
      row.support.fatalDamageConfirmationSupported
    ).padEnd(5)} ` +

    `support=${row.support.directMeleeAttackTypeSupported}`
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
  `Full-bounty melee rate:     ${formatDistribution(
    distributions.meleeFullBountyRate
  )}`
);


console.log(
  `Ground-only melee rate:     ${formatDistribution(
    distributions.meleeGroundOnlyRate
  )}`
);


console.log(
  `Melee association MCC:      ${formatDistribution(
    distributions.meleeMCC
  )}`
);


console.log(
  `Fatal damage coverage:      ${formatDistribution(
    distributions.fatalDamageCoverage
  )}`
);


console.log(
  `Melee/fatal concordance:    ${formatDistribution(
    distributions.meleeFatalConcordance
  )}`
);


console.log(
  `Credited fatal attacker:    ${formatDistribution(
    distributions.creditedFatalAttackerMatch
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


  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`
    );


  const casesPath =
    resolve(
      outputDirectory,
      'second_component_source_citemxp_cases_v01.jsonl'
    );


  const deathsPath =
    resolve(
      outputDirectory,
      'replication_trooper_deaths_v01.jsonl'
    );


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const caseOutputPath =
    resolve(
      outputDirectory,
      'melee_full_bounty_direct_attack_cases_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'melee_full_bounty_direct_attack_validation_v01.json'
    );


  for (
    const path
    of [
      replayPath,
      casesPath,
      deathsPath,
      playerStatePath
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


  // ----------------------------------------------------------
  // LOAD CASES
  // ----------------------------------------------------------

  const rawCases =
    await loadJsonl(
      casesPath
    );


  const deaths =
    await loadJsonl(
      deathsPath
    );


  const deathById =
    new Map();


  for (
    const death
    of deaths
  ) {

    deathById.set(
      makeDeathId(
        death
      ),
      death
    );
  }


  const cases =
    [];


  for (
    const row
    of rawCases
  ) {

    const death =
      deathById.get(
        String(
          row.deathId
        )
      )
      ??
      null;


    const entityIndex =
      finite(

        death?.entityIndex

        ??

        death?.trooper?.entityIndex
      );


    const deathTick =
      finite(
        row.deathTick
        ??
        death?.tick
        ??
        death?.timing?.tick
      );


    if (
      entityIndex ===
        null
      ||
      deathTick ===
        null
    ) {

      continue;
    }


    cases.push({

      deathId:
        String(
          row.deathId
        ),

      deathTick,

      deathEntityIndex:
        entityIndex,

      creditedName:
        row.creditedName
        ??
        null,

      creditedTeam:
        finite(
          row.creditedTeam
        ),

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
          row.predictedCombined
        ),

      componentClass:
        row.componentClass,

      analysisClass:
        row.componentClass ===
          'GROUND_PLUS_SECOND_COMPONENT'
          ? 'DIRECT_FULL_BOUNTY_CANDIDATE'
          : 'GROUND_ONLY'
    });
  }


  if (
    cases.length ===
    0
  ) {

    throw new Error(
      `${replayName}: no usable Script108 economic cases.`
    );
  }


  const targetEntityIndexes =
    new Set(
      cases.map(
        row =>
          row.deathEntityIndex
      )
    );


  // ----------------------------------------------------------
  // PLAYER PAWN IDENTITIES
  // ----------------------------------------------------------

  const playerByPawnIndex =
    await loadPlayerPawnIdentity(
      playerStatePath
    );


  // ----------------------------------------------------------
  // RAW MESSAGE TELEMETRY
  // ----------------------------------------------------------

  const meleeEvents =
    [];


  const damageEvents =
    [];


  const messageTypeCounts =
    new Map();


  const meleeFieldNames =
    new Set();


  const damageFieldNames =
    new Set();


  const meleeSamples =
    [];


  const damageSamples =
    [];


  let messagePackets =
    0;


  let meleeMessages =
    0;


  let meleeMessagesWithHitEntity =
    0;


  let targetMeleeMessages =
    0;


  let damageMessages =
    0;


  let targetDamageMessages =
    0;


  const parser =
    new Parser();


  parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
      demoPacket,
      messagePacket
    ) => {

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


      messagePackets++;


      const typeText =
        decodeMessageTypeText(
          messagePacket?.type
        );


      const typeNumber =
        decodeMessageTypeNumber(
          messagePacket?.type
        );


      const data =
        getMessageData(
          messagePacket
        );


      // ------------------------------------------------------
      // MELEE HIT
      // ------------------------------------------------------

      if (
        isMeleeHitMessage(
          typeText,
          typeNumber
        )
      ) {

        meleeMessages++;


        increment(
          messageTypeCounts,
          typeText
          ??
          String(
            typeNumber
          )
        );


        for (
          const key
          of collectObjectKeys(
            data,
            2
          )
        ) {

          meleeFieldNames.add(
            key
          );
        }


        const hitRaw =
          firstDefined([

            data?.hitEntindex,

            data?.hit_entindex,

            data?.hitEntityIndex,

            data?.hit_entity_index,

            findEntityReference(
              data,
              [
                /^hitentindex$/i,
                /hit.*entindex/i,
                /hit.*entity.*index/i
              ]
            )
          ]);


        const hitEntityIndex =
          normalizeEntityReference(
            hitRaw
          );


        const heavy =
          booleanOrNull(

            data?.heavy

            ??

            data?.isHeavy

            ??

            data?.is_heavy

            ??

            findValueByKey(
              data,
              /heavy/i
            )
          );


        if (
          hitEntityIndex !==
          null
        ) {

          meleeMessagesWithHitEntity++;
        }


        if (
          hitEntityIndex ===
            null
          ||
          !targetEntityIndexes.has(
            hitEntityIndex
          )
        ) {

          if (
            meleeSamples.length <
            30
          ) {

            meleeSamples.push({

              tick,

              typeText,

              typeNumber,

              hitEntityIndex,

              heavy,

              data:
                serializeValue(
                  data
                )
            });
          }


          return;
        }


        targetMeleeMessages++;


        meleeEvents.push({

          tick,

          typeText,

          typeNumber,

          hitEntityIndex,

          heavy
        });


        if (
          meleeSamples.length <
          100
        ) {

          meleeSamples.push({

            tick,

            typeText,

            typeNumber,

            hitEntityIndex,

            heavy,

            target:
              true,

            data:
              serializeValue(
                data
              )
          });
        }


        return;
      }


      // ------------------------------------------------------
      // DAMAGE
      // ------------------------------------------------------

      if (
        !isDamageMessage(
          typeText,
          typeNumber
        )
      ) {

        return;
      }


      damageMessages++;


      for (
        const key
        of collectObjectKeys(
          data,
          2
        )
      ) {

        damageFieldNames.add(
          key
        );
      }


      const victimRaw =
        firstDefined([

          data?.entindexVictim,

          data?.entindex_victim,

          data?.victimEntityIndex,

          data?.victim_entity_index,

          findEntityReference(
            data,
            [
              /entindexvictim/i,
              /entindex_victim/i,
              /victim.*entity.*index/i,
              /victimindex/i
            ]
          )
        ]);


      const attackerRaw =
        firstDefined([

          data?.entindexAttacker,

          data?.entindex_attacker,

          data?.attackerEntityIndex,

          data?.attacker_entity_index,

          findEntityReference(
            data,
            [
              /entindexattacker/i,
              /entindex_attacker/i,
              /attacker.*entity.*index/i,
              /attackerindex/i
            ]
          )
        ]);


      const victimEntityIndex =
        normalizeEntityReference(
          victimRaw
        );


      if (
        victimEntityIndex ===
          null
        ||
        !targetEntityIndexes.has(
          victimEntityIndex
        )
      ) {

        return;
      }


      targetDamageMessages++;


      const attackerEntityIndex =
        normalizeEntityReference(
          attackerRaw
        );


      const attackerPlayer =
        attackerEntityIndex ===
          null
          ? null
          : playerByPawnIndex.get(
              attackerEntityIndex
            )
            ??
            null;


      const victimHealthNew =
        firstFinite([

          data?.victimHealthNew,

          data?.victim_health_new,

          findNumberByKey(
            data,
            /victim.*health.*new/i
          )
        ]);


      const preDamage =
        firstFinite([

          data?.preDamage,

          data?.pre_damage,

          findNumberByKey(
            data,
            /pre.*damage/i
          )
        ]);


      const healthLost =
        firstFinite([

          data?.healthLost,

          data?.health_lost,

          findNumberByKey(
            data,
            /health.*lost/i
          )
        ]);


      const damage =
        firstFinite([

          data?.damage,

          data?.flDamage,

          data?.amount,

          findNumberByKey(
            data,
            /(^|_)damage$/i
          )
        ]);


      const damageType =
        firstFinite([

          data?.type,

          data?.damageType,

          data?.damage_type,

          findNumberByKey(
            data,
            /(^|_)type$/i
          )
        ]);


      const citadelType =
        firstFinite([

          data?.citadelType,

          data?.citadel_type,

          findNumberByKey(
            data,
            /citadel.*type/i
          )
        ]);


      const flags =
        scalarNumberOrNull(

          data?.flags

          ??

          findValueByKey(
            data,
            /^flags$/i
          )
        );


      const event =
        {

          tick,

          typeText,

          typeNumber,

          victimEntityIndex,

          attackerEntityIndex,

          attackerPlayer,

          victimHealthNew,

          preDamage,

          healthLost,

          damage,

          damageType,

          citadelType,

          flags,

          fatal:
            isFatalDamage({

              victimHealthNew,

              preDamage,

              healthLost,

              damage
            })
        };


      damageEvents.push(
        event
      );


      if (
        damageSamples.length <
        100
      ) {

        damageSamples.push({

          ...event,

          data:
            serializeValue(
              data
            )
        });
      }
    }
  );


  console.log(
    'Parsing explicit MeleeHit + Damage messages...'
  );


  console.log(
    `[${new Date().toISOString()}] Parse started`
  );


  await parser.parse(
    createReadStream(
      replayPath
    )
  );


  await parser.dispose();


  meleeEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  damageEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  // ----------------------------------------------------------
  // INDEX BY VICTIM ENTITY
  // ----------------------------------------------------------

  const meleeByEntity =
    groupBy(
      meleeEvents,
      row =>
        row.hitEntityIndex
    );


  const damageByEntity =
    groupBy(
      damageEvents,
      row =>
        row.victimEntityIndex
    );


  // ----------------------------------------------------------
  // CASE EVIDENCE
  // ----------------------------------------------------------

  const analyzedCases =
    [];


  for (
    const row
    of cases
  ) {

    const entityMelee =
      meleeByEntity.get(
        row.deathEntityIndex
      )
      ??
      [];


    const entityDamage =
      damageByEntity.get(
        row.deathEntityIndex
      )
      ??
      [];


    const windowEvidence =
      {};


    for (
      const window
      of WINDOWS
    ) {

      const matchingMelee =
        entityMelee
          .filter(
            event => {

              const offset =
                event.tick -
                row.deathTick;


              return (
                offset >=
                  window.minOffsetTicks
                &&
                offset <=
                  window.maxOffsetTicks
              );
            }
          )
          .map(
            event => ({

              tick:
                event.tick,

              offsetTicks:
                event.tick -
                row.deathTick,

              heavy:
                event.heavy
            })
          );


      const matchingDamage =
        entityDamage
          .filter(
            event => {

              const offset =
                event.tick -
                row.deathTick;


              return (
                offset >=
                  window.minOffsetTicks
                &&
                offset <=
                  window.maxOffsetTicks
              );
            }
          )
          .map(
            event => ({

              ...event,

              offsetTicks:
                event.tick -
                row.deathTick
            })
          );


      const fatalDamage =
        matchingDamage.filter(
          event =>
            event.fatal
        );


      windowEvidence[
        window.id
      ] =
        {

          meleeHit:
            matchingMelee.length >
            0,

          meleeEvents:
            matchingMelee,

          heavyMeleeObserved:
            matchingMelee.some(
              event =>
                event.heavy ===
                true
            ),

          lightMeleeObserved:
            matchingMelee.some(
              event =>
                event.heavy ===
                false
            ),

          damageEvents:
            matchingDamage,

          fatalDamageEvents:
            fatalDamage
        };
    }


    const primary =
      windowEvidence[
        PRIMARY_WINDOW.id
      ];


    const fatalConfirmation =
      buildFatalConfirmation({

        row,

        meleeEvents:
          primary.meleeEvents,

        fatalDamageEvents:
          primary.fatalDamageEvents
      });


    analyzedCases.push({

      ...row,

      windows:
        windowEvidence,

      primaryMeleeHit:
        primary.meleeHit,

      primaryHeavyMeleeObserved:
        primary.heavyMeleeObserved,

      primaryLightMeleeObserved:
        primary.lightMeleeObserved,

      fatalConfirmation
    });
  }


  // ----------------------------------------------------------
  // WINDOW SUMMARIES
  // ----------------------------------------------------------

  const windowSummaries =
    {};


  for (
    const window
    of WINDOWS
  ) {

    windowSummaries[
      window.id
    ] =
      summarizeWindow(
        analyzedCases,
        window
      );
  }


  const primaryWindow =
    windowSummaries[
      PRIMARY_WINDOW.id
    ];


  // ----------------------------------------------------------
  // FATAL DAMAGE SUMMARY
  // ----------------------------------------------------------

  const fullBountyCases =
    analyzedCases.filter(
      row =>
        row.analysisClass ===
        'DIRECT_FULL_BOUNTY_CANDIDATE'
    );


  const fullBountyWithMelee =
    fullBountyCases.filter(
      row =>
        row.primaryMeleeHit
    );


  const fullBountyWithFatalDamage =
    fullBountyCases.filter(
      row =>
        row
          .fatalConfirmation
          .fatalDamageObserved
    );


  const fullBountyMeleeFatalComparable =
    fullBountyCases.filter(
      row =>
        row.primaryMeleeHit
        &&
        row
          .fatalConfirmation
          .fatalDamageObserved
    );


  const fullBountyMeleeFatalConcordant =
    fullBountyMeleeFatalComparable.filter(
      row =>
        row
          .fatalConfirmation
          .meleeFatalConcordant
    );


  const creditedFatalComparable =
    fullBountyCases.filter(
      row =>
        row
          .fatalConfirmation
          .fatalAttackerIdentityResolved
        &&
        Boolean(
          row.creditedName
        )
    );


  const creditedFatalMatched =
    creditedFatalComparable.filter(
      row =>
        row
          .fatalConfirmation
          .creditedFatalAttackerMatch
    );


  const fatalDamage =
    {

      fullBountyCases:
        fullBountyCases.length,

      fullBountyWithMelee:
        fullBountyWithMelee.length,

      fullBountyWithFatalDamage:
        fullBountyWithFatalDamage.length,

      fullBountyFatalDamageCoverageRate:
        rate(
          fullBountyWithFatalDamage.length,
          fullBountyCases.length
        ),


      meleeFatalComparable:
        fullBountyMeleeFatalComparable.length,

      meleeFatalConcordant:
        fullBountyMeleeFatalConcordant.length,

      meleeFatalConcordanceRate:
        rate(
          fullBountyMeleeFatalConcordant.length,
          fullBountyMeleeFatalComparable.length
        ),


      creditedFatalAttackerComparable:
        creditedFatalComparable.length,

      creditedFatalAttackerMatched:
        creditedFatalMatched.length,

      creditedFatalAttackerMatchRate:
        rate(
          creditedFatalMatched.length,
          creditedFatalComparable.length
        ),


      fatalDamageTypeCounts:
        countByObject(

          fullBountyWithFatalDamage
            .flatMap(
              row =>
                row
                  .fatalConfirmation
                  .fatalDamageEvents
            ),

          row =>
            `type=${row.damageType ?? 'NA'}|citadel=${row.citadelType ?? 'NA'}`
        )
    };


  // ----------------------------------------------------------
  // SUPPORT
  // ----------------------------------------------------------

  const informative =

    analyzedCases.length >=
      SUPPORT.minimumCases

    &&

    primaryWindow
      .fullBounty
      .cases >=
      SUPPORT.minimumFullBountyCases

    &&

    primaryWindow
      .groundOnly
      .cases >=
      SUPPORT.minimumGroundOnlyCases

    &&

    meleeMessages >
      0;


  const directMeleeAttackTypeSupported =

    informative

    &&

    (
      primaryWindow
        .association
        .sensitivity ??
      0
    ) >=
      SUPPORT.minimumMeleeSensitivity

    &&

    (
      primaryWindow
        .association
        .specificity ??
      0
    ) >=
      SUPPORT.minimumMeleeSpecificity

    &&

    (
      primaryWindow
        .association
        .mcc ??
      -1
    ) >=
      SUPPORT.minimumMeleeMCC;


  const fatalDamageConfirmationSupported =

    fullBountyMeleeFatalComparable.length >=
      SUPPORT.minimumFatalDamageComparable

    &&

    (
      fatalDamage
        .meleeFatalConcordanceRate ??
      0
    ) >=
      SUPPORT.minimumMeleeFatalConcordanceRate

    &&

    (
      creditedFatalComparable.length <
        SUPPORT.minimumCreditedFatalAttackerComparable

      ||

      (
        fatalDamage
          .creditedFatalAttackerMatchRate ??
        0
      ) >=
        SUPPORT.minimumCreditedFatalAttackerMatchRate
    );


  const support =
    {

      informative,

      directMeleeAttackTypeSupported,

      fatalDamageConfirmationSupported,


      criteria:
        {

          cases:
            analyzedCases.length,

          fullBountyCases:
            primaryWindow
              .fullBounty
              .cases,

          groundOnlyCases:
            primaryWindow
              .groundOnly
              .cases,

          meleeMessages,

          targetMeleeMessages,

          sensitivity:
            primaryWindow
              .association
              .sensitivity,

          specificity:
            primaryWindow
              .association
              .specificity,

          mcc:
            primaryWindow
              .association
              .mcc,

          meleeFatalComparable:
            fullBountyMeleeFatalComparable.length,

          meleeFatalConcordanceRate:
            fatalDamage
              .meleeFatalConcordanceRate,

          creditedFatalAttackerComparable:
            creditedFatalComparable.length,

          creditedFatalAttackerMatchRate:
            fatalDamage
              .creditedFatalAttackerMatchRate
        }
    };


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  const result =
    {

      replay:
        replayName,

      version:
        VERSION,

      canonical:
        false,


      telemetry:
        {

          messagePackets,

          meleeMessages,

          meleeMessagesWithHitEntity,

          targetMeleeMessages,

          damageMessages,

          targetDamageMessages,


          messageTypeCounts:
            mapToSortedObject(
              messageTypeCounts
            ),

          meleeFieldNames:
            [
              ...meleeFieldNames
            ].sort(),

          damageFieldNames:
            [
              ...damageFieldNames
            ].sort(),

          meleeSamples,

          damageSamples
        },


      cases:
        {

          input:
            rawCases.length,

          usable:
            analyzedCases.length,

          fullBounty:
            primaryWindow
              .fullBounty
              .cases,

          groundOnly:
            primaryWindow
              .groundOnly
              .cases
        },


      windows:
        windowSummaries,

      primaryWindow,

      fatalDamage,

      support,


      interpretation:
        {

          meleeHit:
            'Direct MeleeHit message targets exact Trooper entity near the death tick.',

          fatalDamage:
            'Damage-message confirmation is secondary because NPC fatal-damage coverage may be incomplete.',

          creditedPlayer:
            'Where fatal attacker pawn identity is available, it is compared against the independently derived credited last-hitter.',

          semanticLimit:
            'This is replay-observed attack-type evidence and not source-code proof of the engine reward branch.'
        },


      outputs:
        {

          cases:
            caseOutputPath,

          summary:
            replaySummaryPath
        }
    };


  await writeJsonl(
    caseOutputPath,
    analyzedCases
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


  return result;
}


// ============================================================
// WINDOW SUMMARY
// ============================================================

function summarizeWindow(
  cases,
  window
) {

  const fullBounty =
    cases.filter(
      row =>
        row.analysisClass ===
        'DIRECT_FULL_BOUNTY_CANDIDATE'
    );


  const groundOnly =
    cases.filter(
      row =>
        row.analysisClass ===
        'GROUND_ONLY'
    );


  const fullPositive =
    fullBounty.filter(
      row =>
        row
          .windows[
            window.id
          ]
          .meleeHit
    );


  const groundPositive =
    groundOnly.filter(
      row =>
        row
          .windows[
            window.id
          ]
          .meleeHit
    );


  const association =
    binaryAssociation(

      cases.map(
        row => ({

          actualPositive:
            row.analysisClass ===
            'DIRECT_FULL_BOUNTY_CANDIDATE',

          predictedPositive:
            row
              .windows[
                window.id
              ]
              .meleeHit
        })
      )
    );


  return {

    window,


    fullBounty:
      {

        cases:
          fullBounty.length,

        meleeHit:
          fullPositive.length,

        meleeHitRate:
          rate(
            fullPositive.length,
            fullBounty.length
          ),

        heavy:
          fullPositive.filter(
            row =>
              row
                .windows[
                  window.id
                ]
                .heavyMeleeObserved
          ).length,

        light:
          fullPositive.filter(
            row =>
              row
                .windows[
                  window.id
                ]
                .lightMeleeObserved
          ).length,

        meleeOffsetsTicks:
          fullPositive.flatMap(
            row =>
              row
                .windows[
                  window.id
                ]
                .meleeEvents
                .map(
                  event =>
                    event.offsetTicks
                )
          )
      },


    groundOnly:
      {

        cases:
          groundOnly.length,

        meleeHit:
          groundPositive.length,

        meleeHitRate:
          rate(
            groundPositive.length,
            groundOnly.length
          ),

        heavy:
          groundPositive.filter(
            row =>
              row
                .windows[
                  window.id
                ]
                .heavyMeleeObserved
          ).length,

        light:
          groundPositive.filter(
            row =>
              row
                .windows[
                  window.id
                ]
                .lightMeleeObserved
          ).length,

        meleeOffsetsTicks:
          groundPositive.flatMap(
            row =>
              row
                .windows[
                  window.id
                ]
                .meleeEvents
                .map(
                  event =>
                    event.offsetTicks
                )
          )
      },


    association
  };
}


// ============================================================
// FATAL CONFIRMATION
// ============================================================

function buildFatalConfirmation({

  row,

  meleeEvents,

  fatalDamageEvents
}) {

  const sortedFatal =
    [
      ...fatalDamageEvents
    ]
      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a.offsetTicks
          )
          -
          Math.abs(
            b.offsetTicks
          )
      );


  const bestFatal =
    sortedFatal[0]
    ??
    null;


  let minimumMeleeFatalTickDistance =
    null;


  if (
    meleeEvents.length >
      0
    &&
    sortedFatal.length >
      0
  ) {

    minimumMeleeFatalTickDistance =
      Infinity;


    for (
      const melee
      of meleeEvents
    ) {

      for (
        const damage
        of sortedFatal
      ) {

        minimumMeleeFatalTickDistance =
          Math.min(

            minimumMeleeFatalTickDistance,

            Math.abs(
              melee.tick -
              damage.tick
            )
          );
      }
    }


    if (
      minimumMeleeFatalTickDistance ===
      Infinity
    ) {

      minimumMeleeFatalTickDistance =
        null;
    }
  }


  const attackerName =
    bestFatal
      ?.attackerPlayer
      ?.playerName
    ??
    null;


  const fatalAttackerIdentityResolved =
    Boolean(
      attackerName
    );


  const creditedFatalAttackerMatch =

    fatalAttackerIdentityResolved

    &&

    Boolean(
      row.creditedName
    )

    &&

    attackerName ===
      row.creditedName;


  return {

    fatalDamageObserved:
      sortedFatal.length >
      0,

    fatalDamageEvents:
      sortedFatal,

    bestFatalDamage:
      bestFatal,

    minimumMeleeFatalTickDistance,

    meleeFatalConcordant:

      Number.isFinite(
        minimumMeleeFatalTickDistance
      )

      &&

      minimumMeleeFatalTickDistance <=
        MELEE_FATAL_CONCORDANCE_TICKS,

    fatalAttackerIdentityResolved,

    fatalAttackerName:
      attackerName,

    creditedName:
      row.creditedName,

    creditedFatalAttackerMatch
  };
}


// ============================================================
// FATAL DAMAGE LOGIC
// ============================================================

function isFatalDamage({

  victimHealthNew,

  preDamage,

  healthLost,

  damage
}) {

  // Strongest explicit signal.
  if (
    Number.isFinite(
      victimHealthNew
    )
  ) {

    return victimHealthNew <=
      0;
  }


  // Fallback only when the message appears to encode enough
  // health loss to exhaust the pre-damage health amount.
  if (
    Number.isFinite(
      preDamage
    )
    &&
    Number.isFinite(
      healthLost
    )
    &&
    preDamage >
      0
    &&
    healthLost >=
      preDamage
  ) {

    return true;
  }


  if (
    Number.isFinite(
      preDamage
    )
    &&
    Number.isFinite(
      damage
    )
    &&
    preDamage >
      0
    &&
    damage >=
      preDamage
  ) {

    return true;
  }


  return false;
}


// ============================================================
// MESSAGE TYPE IDENTIFICATION
// ============================================================

function isMeleeHitMessage(
  typeText,
  typeNumber
) {

  if (
    typeNumber ===
    MELEE_HIT_MESSAGE_ID
  ) {

    return true;
  }


  const text =
    String(
      typeText ??
      ''
    );


  return (
    /MELEE.*HIT/i.test(
      text
    )
    ||
    /HIT.*MELEE/i.test(
      text
    )
  );
}


function isDamageMessage(
  typeText,
  typeNumber
) {

  if (
    typeNumber ===
    DAMAGE_MESSAGE_ID
  ) {

    return true;
  }


  const text =
    String(
      typeText ??
      ''
    );


  if (
    /RECENT.*DAMAGE/i.test(
      text
    )
    ||
    /DAMAGE.*SUMMARY/i.test(
      text
    )
    ||
    /TRIGGER.*DAMAGE/i.test(
      text
    )
    ||
    /BOSS.*DAMAGE/i.test(
      text
    )
  ) {

    return false;
  }


  return (
    /USER.*MESSAGE.*DAMAGE/i.test(
      text
    )
    ||
    /CITADEL.*DAMAGE$/i.test(
      text
    )
    ||
    /^DAMAGE$/i.test(
      text
    )
  );
}


// ============================================================
// MESSAGE TYPE DECODING
// ============================================================

function decodeMessageTypeText(
  value
) {

  const candidates =
    [

      value?.name,

      value?._name,

      value?.typeName,

      value?.type_name,

      value?.label,

      value?._label,

      value?.constructor?.name,

      typeof value ===
        'string'
        ? value
        : null
    ];


  for (
    const candidate
    of candidates
  ) {

    if (
      typeof candidate ===
        'string'
      &&
      candidate.length >
        0
      &&
      candidate !==
        'Object'
    ) {

      return candidate;
    }
  }


  if (
    value !==
      null
    &&
    value !==
      undefined
  ) {

    const text =
      String(
        value
      );


    if (
      text !==
      '[object Object]'
    ) {

      return text;
    }
  }


  return 'UNKNOWN';
}


function decodeMessageTypeNumber(
  value
) {

  const candidates =
    [

      value?._value,

      value?.value,

      value?._code,

      value?.code,

      value?.id,

      typeof value ===
        'number'
        ? value
        : null,

      typeof value ===
        'bigint'
        ? Number(
            value
          )
        : null
    ];


  return firstFinite(
    candidates
  );
}


// ============================================================
// MESSAGE DATA
// ============================================================

function getMessageData(
  packet
) {

  const candidates =
    [

      packet?.data,

      packet?.message,

      packet?.payload,

      packet?.body,

      packet?.value,

      packet?.decoded,

      packet?.msg
    ];


  for (
    const candidate
    of candidates
  ) {

    if (
      candidate
      &&
      typeof candidate ===
        'object'
    ) {

      return candidate;
    }
  }


  return packet
    ??
    {};
}


// ============================================================
// RECURSIVE KEY SEARCH
// ============================================================

function findEntityReference(
  object,
  patterns,
  depth =
    0
) {

  if (
    object ===
      null
    ||
    object ===
      undefined
    ||
    typeof object !==
      'object'
    ||
    depth >
      3
  ) {

    return null;
  }


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      object
    )
  ) {

    if (
      patterns.some(
        pattern =>
          pattern.test(
            key
          )
      )
    ) {

      return value;
    }
  }


  for (
    const value
    of Object.values(
      object
    )
  ) {

    if (
      value
      &&
      typeof value ===
        'object'
    ) {

      const found =
        findEntityReference(
          value,
          patterns,
          depth +
            1
        );


      if (
        found !==
          null
        &&
        found !==
          undefined
      ) {

        return found;
      }
    }
  }


  return null;
}


function findNumberByKey(
  object,
  pattern,
  depth =
    0
) {

  const value =
    findValueByKey(
      object,
      pattern,
      depth
    );


  return scalarNumberOrNull(
    value
  );
}


function findValueByKey(
  object,
  pattern,
  depth =
    0
) {

  if (
    object ===
      null
    ||
    object ===
      undefined
    ||
    typeof object !==
      'object'
    ||
    depth >
      3
  ) {

    return null;
  }


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      object
    )
  ) {

    if (
      pattern.test(
        key
      )
    ) {

      return value;
    }
  }


  for (
    const value
    of Object.values(
      object
    )
  ) {

    if (
      value
      &&
      typeof value ===
        'object'
    ) {

      const found =
        findValueByKey(
          value,
          pattern,
          depth +
            1
        );


      if (
        found !==
          null
        &&
        found !==
          undefined
      ) {

        return found;
      }
    }
  }


  return null;
}


// ============================================================
// ENTITY REFERENCE NORMALIZATION
// ============================================================

function normalizeEntityReference(
  value
) {

  const numeric =
    scalarNumberOrNull(
      value
    );


  if (
    numeric ===
      null
    ||
    numeric <
      0
  ) {

    return null;
  }


  const integer =
    Math.trunc(
      numeric
    );


  if (
    integer <=
    ENTITY_INDEX_MASK
  ) {

    return integer;
  }


  return integer &
    ENTITY_INDEX_MASK;
}


// ============================================================
// PLAYER PAWN IDENTITY
// ============================================================

async function loadPlayerPawnIdentity(
  path
) {

  const byPawn =
    new Map();


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


    const pawnIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );


    if (
      !playerName
      ||
      pawnIndex ===
        null
    ) {

      continue;
    }


    const old =
      byPawn.get(
        pawnIndex
      )
      ??
      {};


    byPawn.set(
      pawnIndex,
      {

        playerName,

        team:
          finite(
            row
              ?.controller
              ?.team
          )
          ??
          old.team
          ??
          null,

        heroId:
          finite(
            row
              ?.controller
              ?.heroId
          )
          ??
          old.heroId
          ??
          null,

        pawnEntityIndex:
          pawnIndex
      }
    );
  }


  return byPawn;
}


// ============================================================
// DEATH ID
// ============================================================

function makeDeathId(
  death
) {

  return String(

    death?.deathIndex

    ??

    `${death?.entityIndex}|${death?.tick}`
  );
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
// OBJECT KEYS
// ============================================================

function collectObjectKeys(
  object,
  maximumDepth,
  depth =
    0,
  prefix =
    ''
) {

  if (
    object ===
      null
    ||
    object ===
      undefined
    ||
    typeof object !==
      'object'
    ||
    depth >
      maximumDepth
  ) {

    return [];
  }


  const output =
    [];


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      object
    )
  ) {

    const path =
      prefix
        ? `${prefix}.${key}`
        : key;


    output.push(
      path
    );


    if (
      value
      &&
      typeof value ===
        'object'
    ) {

      output.push(
        ...collectObjectKeys(
          value,
          maximumDepth,
          depth +
            1,
          path
        )
      );
    }
  }


  return output;
}


// ============================================================
// SERIALIZE
// ============================================================

function serializeValue(
  value,
  depth =
    0
) {

  if (
    depth >
      4
  ) {

    return '[MAX_DEPTH]';
  }


  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return value
    ??
    null;
  }


  if (
    typeof value ===
      'bigint'
  ) {

    return value.toString();
  }


  if (
    [
      'string',
      'number',
      'boolean'
    ].includes(
      typeof value
    )
  ) {

    return value;
  }


  if (
    Array.isArray(
      value
    )
  ) {

    return value
      .slice(
        0,
        50
      )
      .map(
        row =>
          serializeValue(
            row,
            depth +
              1
          )
      );
  }


  if (
    typeof value ===
      'object'
  ) {

    const output =
      {};


    for (
      const [
        key,
        child
      ]
      of Object.entries(
        value
      ).slice(
        0,
        100
      )
    ) {

      output[
        key
      ] =
        serializeValue(
          child,
          depth +
            1
        );
    }


    return output;
  }


  return String(
    value
  );
}


// ============================================================
// VALUE NORMALIZATION
// ============================================================

function firstDefined(
  values
) {

  for (
    const value
    of values
  ) {

    if (
      value !==
        null
      &&
      value !==
        undefined
    ) {

      return value;
    }
  }


  return null;
}


function firstFinite(
  values
) {

  for (
    const value
    of values
  ) {

    const numeric =
      scalarNumberOrNull(
        value
      );


    if (
      numeric !==
      null
    ) {

      return numeric;
    }
  }


  return null;
}


function scalarNumberOrNull(
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


  if (
    typeof value ===
      'number'
  ) {

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  if (
    typeof value ===
      'bigint'
  ) {

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


  if (
    typeof value ===
      'string'
  ) {

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


  if (
    typeof value ===
      'object'
  ) {

    const candidate =

      value._value

      ??

      value.value

      ??

      value._code

      ??

      value.code

      ??

      value._id

      ??

      value.id

      ??

      value.index

      ??

      value.entityIndex

      ??

      null;


    if (
      candidate !==
        null
      &&
      candidate !==
        undefined
    ) {

      return scalarNumberOrNull(
        candidate
      );
    }
  }


  return null;
}


function finite(
  value
) {

  return scalarNumberOrNull(
    value
  );
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


  if (
    typeof value ===
      'string'
  ) {

    if (
      value.toLowerCase() ===
      'true'
    ) {

      return true;
    }


    if (
      value.toLowerCase() ===
      'false'
    ) {

      return false;
    }
  }


  return null;
}


// ============================================================
// COLLECTION HELPERS
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


    map.get(
      key
    ).push(
      row
    );
  }


  return map;
}


function increment(
  map,
  key
) {

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


    increment(
      map,
      key
    );
  }


  return mapToSortedObject(
    map
  );
}


function mapToSortedObject(
  map
) {

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
          String(
            a[0]
          ).localeCompare(
            String(
              b[0]
            )
          )
      )
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
// NUMERIC HELPERS
// ============================================================

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

      p05:
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

    p05:
      quantile(
        clean,
        0.05
      ),

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
    'MESSAGE TELEMETRY'
  );


  console.log(
    `  MeleeHit messages:          ${row.telemetry.meleeMessages}`
  );


  console.log(
    `  with hit entity:            ${row.telemetry.meleeMessagesWithHitEntity}`
  );


  console.log(
    `  targeting eligible Trooper: ${row.telemetry.targetMeleeMessages}`
  );


  console.log(
    `  target Damage messages:     ${row.telemetry.targetDamageMessages}`
  );


  console.log('');

  console.log(
    `PRIMARY ${PRIMARY_WINDOW.id}`
  );


  console.log(
    `  full-bounty melee:          ${row.primaryWindow.fullBounty.meleeHit}/${row.primaryWindow.fullBounty.cases} (${formatPercent(
      row.primaryWindow.fullBounty.meleeHitRate
    )})`
  );


  console.log(
    `  ground-only melee:          ${row.primaryWindow.groundOnly.meleeHit}/${row.primaryWindow.groundOnly.cases} (${formatPercent(
      row.primaryWindow.groundOnly.meleeHitRate
    )})`
  );


  console.log(
    `  sensitivity:                ${formatPercent(
      row.primaryWindow.association.sensitivity
    )}`
  );


  console.log(
    `  specificity:                ${formatPercent(
      row.primaryWindow.association.specificity
    )}`
  );


  console.log(
    `  MCC:                        ${formatNumber(
      row.primaryWindow.association.mcc
    )}`
  );


  console.log(
    `  heavy observed:             ${row.primaryWindow.fullBounty.heavy}`
  );


  console.log(
    `  light observed:             ${row.primaryWindow.fullBounty.light}`
  );


  console.log('');

  console.log(
    'FATAL DAMAGE CONFIRMATION'
  );


  console.log(
    `  fatal coverage:             ${row.fatalDamage.fullBountyWithFatalDamage}/${row.fatalDamage.fullBountyCases} (${formatPercent(
      row.fatalDamage.fullBountyFatalDamageCoverageRate
    )})`
  );


  console.log(
    `  melee/fatal concordance:    ${row.fatalDamage.meleeFatalConcordant}/${row.fatalDamage.meleeFatalComparable} (${formatPercent(
      row.fatalDamage.meleeFatalConcordanceRate
    )})`
  );


  console.log(
    `  credited fatal attacker:    ${row.fatalDamage.creditedFatalAttackerMatched}/${row.fatalDamage.creditedFatalAttackerComparable} (${formatPercent(
      row.fatalDamage.creditedFatalAttackerMatchRate
    )})`
  );


  console.log('');

  console.log(
    'SUPPORT'
  );


  console.log(
    `  informative:                ${row.support.informative}`
  );


  console.log(
    `  direct melee attack type:   ${row.support.directMeleeAttackTypeSupported}`
  );


  console.log(
    `  fatal confirmation:         ${row.support.fatalDamageConfirmationSupported}`
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
    '# Direct Melee Full-Bounty Validation'
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
    '## Question'
  );


  lines.push(
    ''
  );


  lines.push(
    'Does an explicit Deadlock `MeleeHit` user message target the exact Trooper in the direct-full-bounty/no-orb class at the time of death?'
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
      `- Full-bounty melee-hit rate: ${formatPercent(replay.primaryWindow.fullBounty.meleeHitRate)}`
    );


    lines.push(
      `- Ground-only melee-hit rate: ${formatPercent(replay.primaryWindow.groundOnly.meleeHitRate)}`
    );


    lines.push(
      `- Sensitivity: ${formatPercent(replay.primaryWindow.association.sensitivity)}`
    );


    lines.push(
      `- Specificity: ${formatPercent(replay.primaryWindow.association.specificity)}`
    );


    lines.push(
      `- MCC: ${formatNumber(replay.primaryWindow.association.mcc)}`
    );


    lines.push(
      `- Fatal-damage coverage: ${formatPercent(replay.fatalDamage.fullBountyFatalDamageCoverageRate)}`
    );


    lines.push(
      `- Melee/fatal temporal concordance: ${formatPercent(replay.fatalDamage.meleeFatalConcordanceRate)}`
    );


    lines.push(
      `- Credited-player fatal-attacker match: ${formatPercent(replay.fatalDamage.creditedFatalAttackerMatchRate)}`
    );


    lines.push(
      `- Direct melee support: **${replay.support.directMeleeAttackTypeSupported}**`
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