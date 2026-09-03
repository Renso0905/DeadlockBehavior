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
  Parser,
  InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const TICK_RATE =
  64;


const MATCH_WINDOW_BEFORE_TICKS =
  -1;


const MATCH_WINDOW_AFTER_TICKS =
  4;


const MATCH_DISTANCE_3D_HU =
  160;


const POSITION_JUMP_THRESHOLD_HU =
  32;


const ACTIVATION_MERGE_TICKS =
  3;


const ACTIVATION_MERGE_DISTANCE_HU =
  64;


const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const PLAYER_STATE_BATCH_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_state_base_batch_v02.json'
  );


const BATCH_SUMMARY_PATH =
  resolve(
    'output',
    'cross_replay',
    'compact_event_replication_extraction_batch_v01.json'
  );


const BATCH_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'compact_event_replication_extraction_batch_v01.md'
  );


// ============================================================
// TROOPER TYPE PRIOR
//
// This mapping was established during discovery.
//
// IMPORTANT:
//
// It is imported here as a discovery-replay prior, not treated
// as a newly proven cross-replay mechanic.
//
// Script103 will report whether the same subclasses behave
// consistently in the independent replay cohort.
// ============================================================

const TROOPER_BASE_TYPE_PRIOR =
  new Map([

    [
      '1003135509',
      'MEDIC'
    ],

    [
      '1773848083',
      'RANGED'
    ],

    [
      '2943225653',
      'MELEE'
    ],

    [
      '3237674373',
      'NON_STANDARD_TROOPER_CANDIDATE'
    ]
  ]);


const ECONOMIC_BASE_TYPES =
  new Set([

    'RANGED',
    'MEDIC',
    'MELEE'
  ]);


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    PLAYER_STATE_BATCH_PATH
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


const playerStateBatch =
  JSON.parse(
    readFileSync(
      PLAYER_STATE_BATCH_PATH,
      'utf8'
    )
  );


if (
  manifest
    ?.readyToBeginReplication !==
  true
) {

  throw new Error(
    'Script100 manifest is not replication-ready.'
  );
}


if (
  playerStateBatch
    ?.structuralChecks
    ?.baseExtractionReady !==
  true
) {

  throw new Error(
    'Script101 V02 base extraction is not ready.'
  );
}


const cohort =
  Array.isArray(
    manifest
      ?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No independent replay cohort found.'
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
  'COMPACT CROSS-REPLAY EVENT EXTRACTION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  `Independent replay cohort: ${cohort.length}`
);


console.log(
  'One raw replay parse per replay.'
);


console.log('');


// ============================================================
// BATCH LOOP
// ============================================================

const batchStartedMs =
  Date.now();


const replayResults =
  [];


for (
  let i =
    0;

  i <
    cohort.length;

  i++
) {

  const replayName =
    String(
      cohort[i].replayName
    );


  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`
    );


  const playerSummaryPath =
    resolve(
      'output',
      replayName,
      'player_state_summary.json'
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${i + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  // ----------------------------------------------------------
  // RAW REPLAY
  // ----------------------------------------------------------

  if (
    !existsSync(
      replayPath
    )
  ) {

    replayResults.push({

      replayName,

      success:
        false,

      status:
        'REPLAY_MISSING'
    });


    console.log(
      'FAIL: replay missing.'
    );


    console.log('');


    continue;
  }


  // ----------------------------------------------------------
  // CLOCK SUBSTRATE
  // ----------------------------------------------------------

  if (
    !existsSync(
      playerSummaryPath
    )
  ) {

    replayResults.push({

      replayName,

      success:
        false,

      status:
        'PLAYER_STATE_SUMMARY_MISSING'
    });


    console.log(
      'FAIL: player_state_summary.json missing.'
    );


    console.log('');


    continue;
  }


  const playerSummary =
    JSON.parse(
      readFileSync(
        playerSummaryPath,
        'utf8'
      )
    );


  const clockOffset =
    finite(
      playerSummary
        ?.matchClockOffsetSeconds
    );


  if (
    clockOffset ===
    null
  ) {

    replayResults.push({

      replayName,

      success:
        false,

      status:
        'MATCH_CLOCK_OFFSET_MISSING'
    });


    console.log(
      'FAIL: match clock offset missing.'
    );


    console.log('');


    continue;
  }


  const startedMs =
    Date.now();


  // ----------------------------------------------------------
  // EXTRACT
  // ----------------------------------------------------------

  try {

    const result =
      await extractReplay({

        replayName,

        replayPath,

        clockOffset
      });


    replayResults.push(
      result
    );


    console.log('');


    console.log(
      `Trooper deaths:             ${result.counts.trooperDeaths}`
    );


    console.log(
      `Economic-type deaths:       ${result.counts.economicTrooperDeaths}`
    );


    console.log(
      `Last-hit increments:        ${result.counts.lastHitEvents}`
    );


    console.log(
      `AssignedGold activations:   ${result.counts.assignedGoldActivations}`
    );


    console.log(
      `Targeted activations:       ${result.counts.targetedActivations}`
    );


    console.log(
      `Targetless activations:     ${result.counts.targetlessActivations}`
    );


    console.log(
      `Positive currency0 deltas:  ${result.counts.positiveCurrencyDeltas}`
    );


    console.log(
      `CItemXP damage events:      ${result.counts.citemxpDamageEvents}`
    );


    console.log(
      `Extraction validation:      ${result.validation.pass ? 'PASS' : 'FAIL'}`
    );


    console.log(
      `Duration:                   ${formatDuration(
        (
          Date.now() -
          startedMs
        )
        /
        1000
      )}`
    );


    console.log('');

  } catch (
    error
  ) {

    replayResults.push({

      replayName,

      success:
        false,

      status:
        'EXTRACTION_EXCEPTION',

      error:
        error?.stack ??
        String(
          error
        )
    });


    console.log('');


    console.log(
      'FAIL: extraction exception'
    );


    console.log(
      error
    );


    console.log('');
  }
}


// ============================================================
// BATCH SUMMARY
// ============================================================

const successful =
  replayResults.filter(
    row =>
      row.success
  );


const passed =
  replayResults.filter(
    row =>
      row
        ?.validation
        ?.pass ===
      true
  );


const batchPass =
  replayResults.length ===
    cohort.length
  &&
  successful.length ===
    cohort.length
  &&
  passed.length ===
    cohort.length;


const batchSummary = {

  version:
    'COMPACT_EVENT_REPLICATION_EXTRACTION_BATCH_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),


  purpose: [

    'Create one compact event-centered telemetry extract per independent replay.',

    'Parse each raw replay exactly once in this stage.',

    'Preserve Trooper deaths, exact-tick last-hit increments, AssignedGold lifecycle activations, player currency deltas, and player-attributed CItemXP damage directions.',

    'Defer mechanic replication statistics to the next offline analysis script.',

    'Do not fit new mechanic thresholds during extraction.'
  ],


  authority: {

    discoveryReplay:
      manifest
        ?.discoveryReplay ??
      'test',

    replicationUnit:
      'REPLAY',

    note:
      'These extracts are replication evidence inputs, not canonical mechanic claims.'
  },


  cohortSize:
    cohort.length,

  successCount:
    successful.length,

  validationPassCount:
    passed.length,

  batchPass,

  durationSeconds:
    (
      Date.now() -
      batchStartedMs
    )
    /
    1000,

  replays:
    replayResults,


  nextStage: {

    ready:
      batchPass,

    id:
      'CROSS_REPLAY_FOUNDATIONAL_METRICS',

    description:
      'Join compact event extracts with 4 Hz player_state telemetry and compute replay-level replication metrics for the frozen Script99 contracts.'
  },


  outputs: {

    json:
      BATCH_SUMMARY_PATH,

    markdown:
      BATCH_MARKDOWN_PATH
  }
};


// ============================================================
// WRITE BATCH SUMMARY
// ============================================================

mkdirSync(
  dirname(
    BATCH_SUMMARY_PATH
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  BATCH_SUMMARY_PATH,
  JSON.stringify(
    batchSummary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  BATCH_MARKDOWN_PATH,
  buildBatchMarkdown(
    batchSummary
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
  'COMPACT EVENT EXTRACTION BATCH SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');


for (
  const row
  of replayResults
) {

  console.log(

    `${row.replayName.padEnd(12)} ` +

    `${row.success ? 'SUCCESS' : 'FAIL'} ` +

    `validation=${row?.validation?.pass ?? false}`
  );
}


console.log('');


console.log(
  `BATCH PASS: ${batchPass}`
);


console.log('');


console.log(
  `JSON:\n${BATCH_SUMMARY_PATH}`
);


console.log('');


console.log(
  `Markdown:\n${BATCH_MARKDOWN_PATH}`
);


console.log('');


// ============================================================
// REPLAY EXTRACTION
// ============================================================

async function extractReplay({
  replayName,
  replayPath,
  clockOffset
}) {

  const outputDir =
    resolve(
      'output',
      replayName
    );


  mkdirSync(
    outputDir,
    {
      recursive:
        true
    }
  );


  // ----------------------------------------------------------
  // OUTPUT PATHS
  // ----------------------------------------------------------

  const summaryPath =
    resolve(
      outputDir,
      'compact_replication_event_extract_v01.json'
    );


  const deathsPath =
    resolve(
      outputDir,
      'replication_trooper_deaths_v01.jsonl'
    );


  const activationsPath =
    resolve(
      outputDir,
      'replication_assigned_gold_activations_v01.jsonl'
    );


  const lastHitsPath =
    resolve(
      outputDir,
      'replication_last_hit_events_v01.jsonl'
    );


  const currencyPath =
    resolve(
      outputDir,
      'replication_currency0_deltas_v01.jsonl'
    );


  const citemxpDamagePath =
    resolve(
      outputDir,
      'replication_citemxp_damage_events_v01.jsonl'
    );


  // ----------------------------------------------------------
  // PARSER
  // ----------------------------------------------------------

  const parser =
    new Parser();


  // ----------------------------------------------------------
  // ENTITY STATE
  // ----------------------------------------------------------

  const previousTrooper =
    new Map();


  const previousController =
    new Map();


  const previousPawnCurrency =
    new Map();


  const playerByPawnIndex =
    new Map();


  const playerByControllerIndex =
    new Map();


  // ----------------------------------------------------------
  // ASSIGNED GOLD STATE
  // ----------------------------------------------------------

  const previousAssignedGold =
    new Map();


  const openActivationByEntity =
    new Map();


  const activationSequenceByEntity =
    new Map();


  // ----------------------------------------------------------
  // CITEMXP LIVE IDENTITY
  // ----------------------------------------------------------

  const currentCItemXP =
    new Map();


  // ----------------------------------------------------------
  // OUTPUT ARRAYS
  // ----------------------------------------------------------

  const trooperDeaths =
    [];


  const deathKeys =
    new Set();


  const lastHitEvents =
    [];


  const currencyEvents =
    [];


  const activations =
    [];


  const citemxpDamageEvents =
    [];


  // ----------------------------------------------------------
  // TELEMETRY COUNTERS
  // ----------------------------------------------------------

  const telemetry = {

    entityPackets:
      0,

    entityEvents:
      0,

    trooperEvents:
      0,

    controllerEvents:
      0,

    pawnEvents:
      0,

    assignedGoldEvents:
      0,

    citemxpEvents:
      0,

    messagePackets:
      0,

    damageLikeMessages:
      0,

    citemxpMatchedDamageMessages:
      0
  };


  // ==========================================================
  // ENTITY PACKETS
  // ==========================================================

  parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
      demoPacket,
      messagePacket,
      events
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


      telemetry.entityPackets++;


      for (
        const event
        of events ??
        []
      ) {

        telemetry.entityEvents++;


        const entity =
          event?.entity;


        if (
          !entity
        ) {

          continue;
        }


        const className =
          getEntityClassName(
            entity
          );


        const entityIndex =
          getEntityIndex(
            entity
          );


        const operation =
          decodeOperation(
            event.operation
          );


        // ------------------------------------------------------
        // ENTITY INDEX REUSE GUARD FOR CITEMXP
        // ------------------------------------------------------

        if (
          entityIndex !==
            null
          &&
          className !==
            'CItemXP'
        ) {

          if (
            operation ===
              'CREATE'
            &&
            currentCItemXP.has(
              entityIndex
            )
          ) {

            currentCItemXP.delete(
              entityIndex
            );
          }
        }


        // ------------------------------------------------------
        // PLAYER CONTROLLER
        // ------------------------------------------------------

        if (
          className ===
          'CCitadelPlayerController'
        ) {

          telemetry.controllerEvents++;


          processController({

            entity,

            entityIndex,

            tick,

            clockOffset,

            previousController,

            playerByPawnIndex,

            playerByControllerIndex,

            lastHitEvents
          });


          continue;
        }


        // ------------------------------------------------------
        // PLAYER PAWN ECONOMY
        // ------------------------------------------------------

        if (
          className ===
          'CCitadelPlayerPawn'
        ) {

          telemetry.pawnEvents++;


          processPlayerPawnCurrency({

            entity,

            entityIndex,

            tick,

            clockOffset,

            previousPawnCurrency,

            playerByPawnIndex,

            currencyEvents,

            parser
          });


          continue;
        }


        // ------------------------------------------------------
        // TROOPER
        // ------------------------------------------------------

        if (
          className ===
          'CNPC_Trooper'
        ) {

          telemetry.trooperEvents++;


          processTrooper({

            entity,

            entityIndex,

            tick,

            clockOffset,

            previousTrooper,

            trooperDeaths,

            deathKeys,

            parser,

            playerByPawnIndex
          });


          continue;
        }


        // ------------------------------------------------------
        // GROUND ASSIGNED GOLD
        // ------------------------------------------------------

        if (
          className ===
          'CCitadel_Pickup_AssignedGold'
        ) {

          telemetry.assignedGoldEvents++;


          processAssignedGold({

            event,

            entity,

            entityIndex,

            tick,

            clockOffset,

            previousAssignedGold,

            openActivationByEntity,

            activationSequenceByEntity,

            activations,

            playerByPawnIndex
          });


          continue;
        }


        // ------------------------------------------------------
        // FLYING / ATTACKABLE CITEMXP
        // ------------------------------------------------------

        if (
          className ===
          'CItemXP'
        ) {

          telemetry.citemxpEvents++;


          processCItemXP({

            entity,

            entityIndex,

            tick,

            operation,

            currentCItemXP
          });
        }
      }
    }
  );


  // ==========================================================
  // DAMAGE MESSAGES
  // ==========================================================

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


      telemetry.messagePackets++;


      const type =
        decodeMessageType(
          messagePacket?.type
        );


      if (
        !type
        ||
        !/DAMAGE/i.test(
          type
        )
      ) {

        return;
      }


      telemetry.damageLikeMessages++;


      const data =
        getMessageData(
          messagePacket
        );


      // --------------------------------------------------------
      // VICTIM
      // --------------------------------------------------------

      const victimIndex =
        normalizeEntityReference(

          findEntityReference(

            data,

            [
              /entindexvictim/i,
              /entindex_victim/i,
              /victimentityindex/i,
              /victimindex/i,
              /^victim$/i,
              /hvictim/i
            ]
          )
        );


      // --------------------------------------------------------
      // ATTACKER
      // --------------------------------------------------------

      const attackerIndex =
        normalizeEntityReference(

          findEntityReference(

            data,

            [
              /entindexattacker/i,
              /entindex_attacker/i,
              /attackerentityindex/i,
              /attackerindex/i,
              /^attacker$/i,
              /hattacker/i
            ]
          )
        );


      if (
        victimIndex ===
        null
      ) {

        return;
      }


      const citemxp =
        currentCItemXP.get(
          victimIndex
        )
        ??
        null;


      if (
        !citemxp
      ) {

        return;
      }


      // --------------------------------------------------------
      // ALLOW SAME-TICK / NEAR-END DAMAGE
      // --------------------------------------------------------

      if (
        Number.isFinite(
          citemxp.endTick
        )
        &&
        tick >
          citemxp.endTick +
          8
      ) {

        return;
      }


      telemetry
        .citemxpMatchedDamageMessages++;


      const attackerPlayer =
        attackerIndex !==
          null
          ? (
              playerByPawnIndex.get(
                attackerIndex
              )
              ??
              null
            )
          : null;


      citemxpDamageEvents.push({

        schemaVersion:
          1,

        canonical:
          false,

        tick,

        timeSeconds:
          tickToMatchTime(
            tick,
            clockOffset
          ),

        clock:
          formatClock(
            tickToMatchTime(
              tick,
              clockOffset
            )
          ),

        messageType:
          type,

        victimIndex,

        attackerIndex,

        attackerPlayer,


        citemxp: {

          entityIndex:
            citemxp.entityIndex,

          subclassId:
            citemxp.subclassId,

          team:
            citemxp.team,

          position:
            citemxp.position,

          firstSeenTick:
            citemxp.firstSeenTick,

          lastSeenTick:
            citemxp.lastSeenTick,

          endTick:
            citemxp.endTick
        },


        damageDirection:
          normalizeVector(

            findValueByKeyPatterns(

              data,

              [
                /damageDirection/i
              ],

              3
            )
            ?.value
          ),


        origin:
          normalizeVector(

            findValueByKeyPatterns(

              data,

              [
                /^origin$/i
              ],

              3
            )
            ?.value
          ),


        damage:
          firstFinite([

            data?.damage,

            data?.flDamage,

            data?.amount,

            data?.damageAmount,

            findNumberByKey(
              data,
              /(^|_)damage$/i
            )
          ]),


        abilityId:
          firstFinite([

            data?.abilityId,

            data?.ability_id
          ]),


        entindexAbility:
          normalizeEntityReference(
            data?.entindexAbility
          ),


        entindexInflictor:
          normalizeEntityReference(
            data?.entindexInflictor
          )
      });
    }
  );


  // ==========================================================
  // RUN
  // ==========================================================

  console.log(
    `Parsing ${replayName}...`
  );


  await parser.parse(
    createReadStream(
      replayPath
    )
  );


  await parser.dispose();


  // ==========================================================
  // FINALIZE OPEN ASSIGNEDGOLD ACTIVATIONS
  // ==========================================================

  for (
    const activation
    of openActivationByEntity.values()
  ) {

    finalizeActivation(

      activation,

      activation.lastObservedTick,

      'REPLAY_END_OR_LAST_OBSERVATION',

      clockOffset
    );
  }


  openActivationByEntity.clear();


  // ==========================================================
  // SORT
  // ==========================================================

  activations.sort(
    (
      a,
      b
    ) =>
      a.activationTick -
      b.activationTick
  );


  trooperDeaths.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  lastHitEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  currencyEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  citemxpDamageEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  // ==========================================================
  // DEATH <- LAST-HIT EVIDENCE
  // ==========================================================

  const lastHitsByTick =
    groupByTick(
      lastHitEvents
    );


  for (
    let deathIndex =
      0;

    deathIndex <
      trooperDeaths.length;

    deathIndex++
  ) {

    const death =
      trooperDeaths[
        deathIndex
      ];


    death.deathIndex =
      deathIndex;


    const exact =
      lastHitsByTick.get(
        death.tick
      )
      ??
      [];


    const nearby =
      [];


    for (
      let t =
        death.tick -
        1;

      t <=
        death.tick +
        1;

      t++
    ) {

      for (
        const event
        of lastHitsByTick.get(
          t
        )
        ??
        []
      ) {

        nearby.push(
          event
        );
      }
    }


    const exactOpposing =
      exact.filter(

        event =>

          event.team !==
            null

          &&

          death.team !==
            null

          &&

          event.team !==
            death.team

          &&

          event.delta >
            0
      );


    death.lastHitEvidence = {

      exactTick:
        exact,

      nearbyPlusMinus1:
        nearby,

      exactOpposing,

      uniqueExactOpposing:
        exactOpposing.length ===
          1
          ? exactOpposing[0]
          : null
    };
  }


  // ==========================================================
  // LIGHTWEIGHT DEATH <-> ACTIVATION CANDIDATE GRAPH
  //
  // This is only candidate discovery.
  //
  // Script103 will solve the one-to-one matching problem offline
  // and calculate replication statistics.
  // ==========================================================

  const activationsByTick =
    groupByTick(

      activations,

      row =>
        row.activationTick
    );


  let candidateEdgeCount =
    0;


  let deathsWithCandidate =
    0;


  const activationCandidateCounts =
    new Map();


  for (
    const death
    of trooperDeaths
  ) {

    if (
      !death.economicBaseType
    ) {

      death.assignedGoldCandidateCount =
        0;


      continue;
    }


    let count =
      0;


    for (
      let tick =
        death.tick +
        MATCH_WINDOW_BEFORE_TICKS;

      tick <=
        death.tick +
        MATCH_WINDOW_AFTER_TICKS;

      tick++
    ) {

      for (
        const activation
        of activationsByTick.get(
          tick
        )
        ??
        []
      ) {

        if (
          !death.position
          ||
          !activation.position
        ) {

          continue;
        }


        const distance3D =
          getDistance3D(

            death.position,

            activation.position
          );


        if (
          distance3D >
          MATCH_DISTANCE_3D_HU
        ) {

          continue;
        }


        count++;


        candidateEdgeCount++;


        activationCandidateCounts.set(

          activation.activationId,

          (
            activationCandidateCounts.get(
              activation.activationId
            )
            ??
            0
          )
          +
          1
        );
      }
    }


    death.assignedGoldCandidateCount =
      count;


    if (
      count >
      0
    ) {

      deathsWithCandidate++;
    }
  }


  const activationsWithCandidate =
    [
      ...activationCandidateCounts.values()
    ]
      .filter(
        count =>
          count >
          0
      )
      .length;


  // ==========================================================
  // COHORT COUNTS
  // ==========================================================

  const economicDeaths =
    trooperDeaths.filter(
      row =>
        row.economicBaseType
    );


  const targetedActivations =
    activations.filter(
      row =>
        Boolean(
          row.firstValidVacuumTarget
        )
    );


  const targetlessActivations =
    activations.filter(
      row =>
        !row.firstValidVacuumTarget
    );


  const endedActivations =
    activations.filter(
      row =>
        Number.isFinite(
          row.endTick
        )
    );


  const playerAttributedDamage =
    citemxpDamageEvents.filter(
      row =>
        Boolean(
          row
            ?.attackerPlayer
            ?.playerName
        )
    );


  const damageWithDirection =
    citemxpDamageEvents.filter(
      row =>
        Boolean(
          row.damageDirection
        )
    );


  // ==========================================================
  // VALIDATION
  // ==========================================================

  const validationChecks = {


    trooperDeathsPresent:
      check(

        trooperDeaths.length,

        '>0',

        trooperDeaths.length >
        0
      ),


    economicDeathsPresent:
      check(

        economicDeaths.length,

        '>0',

        economicDeaths.length >
        0
      ),


    lastHitEventsPresent:
      check(

        lastHitEvents.length,

        '>0',

        lastHitEvents.length >
        0
      ),


    assignedGoldActivationsPresent:
      check(

        activations.length,

        '>0',

        activations.length >
        0
      ),


    assignedGoldEndCoverage:
      check(

        endedActivations.length,

        '>=95%',

        rate(
          endedActivations.length,
          activations.length
        )
        >=
        0.95
      ),


    positiveCurrencyDeltasPresent:
      check(

        currencyEvents.length,

        '>0',

        currencyEvents.length >
        0
      ),


    deathActivationCandidatesPresent:
      check(

        deathsWithCandidate,

        '>0',

        deathsWithCandidate >
        0
      ),


    citemxpDamageTelemetryPresent:
      check(

        citemxpDamageEvents.length,

        '>=0',

        citemxpDamageEvents.length >=
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


  // ==========================================================
  // REPLAY SUMMARY
  // ==========================================================

  const summary = {

    replay:
      replayName,

    version:
      'COMPACT_REPLICATION_EVENT_EXTRACT_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'COMPACT_EVENT_EXTRACTION_PASS'
        : 'COMPACT_EVENT_EXTRACTION_VALIDATION_FAILURE',


    purpose: [

      'Capture the minimum raw event telemetry needed for cross-replay replication of the frozen foundational contracts.',

      'Preserve raw observations separately from later inferred matches and mechanic claims.',

      'Avoid fitting replay-specific mechanic thresholds during extraction.'
    ],


    extractionPolicy: {

      rawReplayPasses:
        1,

      trooperDeathSignal:
        'health > 0 -> <= 0 OR lifeState 0 -> nonzero',

      assignedGoldActivationSignal:
        'became active OR active position jump OR first active observation',

      assignedGoldCreateAlone:
        'not treated as semantic spawn',

      assignedGoldDeathCandidateWindowTicks: [

        MATCH_WINDOW_BEFORE_TICKS,

        MATCH_WINDOW_AFTER_TICKS
      ],

      assignedGoldDeathCandidateMaxDistance3D:
        MATCH_DISTANCE_3D_HU,

      candidateEdgesOnly:
        true,

      oneToOneMatchingDeferred:
        true,

      trooperTypeMappingStatus:
        'DISCOVERY_REPLAY_MAPPING_PRIOR_NOT_CANONICAL'
    },


    matchClockOffsetSeconds:
      clockOffset,


    telemetry,


    counts: {

      trooperDeaths:
        trooperDeaths.length,

      economicTrooperDeaths:
        economicDeaths.length,

      lastHitEvents:
        lastHitEvents.length,

      assignedGoldActivations:
        activations.length,

      targetedActivations:
        targetedActivations.length,

      targetlessActivations:
        targetlessActivations.length,

      endedActivations:
        endedActivations.length,

      positiveCurrencyDeltas:
        currencyEvents.length,

      citemxpDamageEvents:
        citemxpDamageEvents.length,

      playerAttributedCitemxpDamageEvents:
        playerAttributedDamage.length,

      citemxpDamageEventsWithDirection:
        damageWithDirection.length,

      deathActivationCandidateEdges:
        candidateEdgeCount,

      economicDeathsWithActivationCandidate:
        deathsWithCandidate,

      activationsWithDeathCandidate:
        activationsWithCandidate
    },


    distributions: {

      trooperDeathsBySubclass:
        countBy(

          trooperDeaths,

          row =>
            row.subclassId ??
            'UNKNOWN'
        ),


      trooperDeathsByBaseType:
        countBy(

          trooperDeaths,

          row =>
            row.baseType ??
            'UNKNOWN'
        ),


      activationsByTeam:
        countBy(

          activations,

          row =>
            String(
              row.team ??
              'UNKNOWN'
            )
        ),


      citemxpDamageBySubclass:
        countBy(

          citemxpDamageEvents,

          row =>
            row
              ?.citemxp
              ?.subclassId ??
            'UNKNOWN'
        )
    },


    validation: {

      pass:
        validationPass,

      checks:
        validationChecks
    },


    outputs: {

      summary:
        summaryPath,

      trooperDeaths:
        deathsPath,

      assignedGoldActivations:
        activationsPath,

      lastHitEvents:
        lastHitsPath,

      positiveCurrencyDeltas:
        currencyPath,

      citemxpDamageEvents:
        citemxpDamagePath
    }
  };


  // ==========================================================
  // WRITE REPLAY OUTPUTS
  // ==========================================================

  await writeJsonl(
    deathsPath,
    trooperDeaths
  );


  await writeJsonl(
    activationsPath,
    activations
  );


  await writeJsonl(
    lastHitsPath,
    lastHitEvents
  );


  await writeJsonl(
    currencyPath,
    currencyEvents
  );


  await writeJsonl(
    citemxpDamagePath,
    citemxpDamageEvents
  );


  writeFileSync(

    summaryPath,

    JSON.stringify(
      summary,
      null,
      2
    ),

    'utf8'
  );


  return {

    replayName,

    success:
      validationPass,

    status:
      summary.status,

    counts:
      summary.counts,

    validation:
      summary.validation,

    outputs:
      summary.outputs
  };
}


// ============================================================
// PLAYER CONTROLLER
// ============================================================

function processController({

  entity,

  entityIndex,

  tick,

  clockOffset,

  previousController,

  playerByPawnIndex,

  playerByControllerIndex,

  lastHitEvents
}) {

  if (
    entityIndex ===
    null
  ) {

    return;
  }


  const current = {

    playerName:
      stringOrNull(
        safeGetField(
          entity,
          'm_iszPlayerName'
        )
      ),

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    heroId:
      finite(
        safeGetField(
          entity,
          'm_nHeroID'
        )
      ),

    lastHits:
      finite(
        safeGetField(
          entity,
          'm_iLastHits'
        )
      ),

    pawnHandle:
      handleOrNull(
        safeGetField(
          entity,
          'm_hHeroPawn'
        )
      )
      ??
      handleOrNull(
        safeGetField(
          entity,
          'm_hPawn'
        )
      )
  };


  // ----------------------------------------------------------
  // IDENTITY MAP
  // ----------------------------------------------------------

  if (
    current.playerName
    &&
    current.playerName !==
      'SourceTV'
  ) {

    playerByControllerIndex.set(

      entityIndex,

      {

        playerName:
          current.playerName,

        team:
          current.team,

        heroId:
          current.heroId,

        controllerEntityIndex:
          entityIndex
      }
    );


    const pawnIndex =
      decodeHandleEntityIndex(
        current.pawnHandle
      );


    if (
      pawnIndex !==
      null
    ) {

      playerByPawnIndex.set(

        pawnIndex,

        {

          playerName:
            current.playerName,

          team:
            current.team,

          heroId:
            current.heroId,

          pawnEntityIndex:
            pawnIndex,

          controllerEntityIndex:
            entityIndex
        }
      );
    }
  }


  // ----------------------------------------------------------
  // LAST-HIT COUNTER
  // ----------------------------------------------------------

  const previous =
    previousController.get(
      entityIndex
    )
    ??
    null;


  if (
    previous

    &&

    Number.isFinite(
      previous.lastHits
    )

    &&

    Number.isFinite(
      current.lastHits
    )

    &&

    current.lastHits >
      previous.lastHits
  ) {

    lastHitEvents.push({

      schemaVersion:
        1,

      canonical:
        false,

      tick,

      timeSeconds:
        tickToMatchTime(
          tick,
          clockOffset
        ),

      clock:
        formatClock(
          tickToMatchTime(
            tick,
            clockOffset
          )
        ),

      controllerEntityIndex:
        entityIndex,

      playerName:
        current.playerName ??
        previous.playerName,

      team:
        current.team ??
        previous.team,

      heroId:
        current.heroId ??
        previous.heroId,

      previousLastHits:
        previous.lastHits,

      currentLastHits:
        current.lastHits,

      delta:
        current.lastHits -
        previous.lastHits
    });
  }


  previousController.set(
    entityIndex,
    current
  );
}


// ============================================================
// PLAYER CURRENCY 0
// ============================================================

function processPlayerPawnCurrency({

  entity,

  entityIndex,

  tick,

  clockOffset,

  previousPawnCurrency,

  playerByPawnIndex,

  currencyEvents,

  parser
}) {

  if (
    entityIndex ===
    null
  ) {

    return;
  }


  const currency0 =
    finite(
      safeGetField(
        entity,
        'm_nCurrencies.0000'
      )
    );


  if (
    currency0 ===
    null
  ) {

    return;
  }


  let player =
    playerByPawnIndex.get(
      entityIndex
    )
    ??
    null;


  if (
    !player
  ) {

    player =
      findPlayerForPawnIndex(

        parser.getDemo(),

        entityIndex,

        playerByPawnIndex
      );
  }


  const previous =
    previousPawnCurrency.get(
      entityIndex
    )
    ??
    null;


  if (
    previous

    &&

    Number.isFinite(
      previous.currency0
    )

    &&

    currency0 >
      previous.currency0
  ) {

    currencyEvents.push({

      schemaVersion:
        1,

      canonical:
        false,

      tick,

      timeSeconds:
        tickToMatchTime(
          tick,
          clockOffset
        ),

      clock:
        formatClock(
          tickToMatchTime(
            tick,
            clockOffset
          )
        ),

      pawnEntityIndex:
        entityIndex,

      playerName:
        player?.playerName ??
        null,

      team:
        player?.team
        ??
        finite(
          safeGetField(
            entity,
            'm_iTeamNum'
          )
        ),

      heroId:
        player?.heroId
        ??
        finite(
          safeGetField(
            entity,
            'm_nHeroID'
          )
        ),

      previousCurrency0:
        previous.currency0,

      currentCurrency0:
        currency0,

      delta:
        currency0 -
        previous.currency0
    });
  }


  previousPawnCurrency.set(

    entityIndex,

    {

      currency0,

      tick
    }
  );
}


// ============================================================
// TROOPER DEATH
// ============================================================

function processTrooper({

  entity,

  entityIndex,

  tick,

  clockOffset,

  previousTrooper,

  trooperDeaths,

  deathKeys,

  parser,

  playerByPawnIndex
}) {

  if (
    entityIndex ===
    null
  ) {

    return;
  }


  const current =
    readTrooperState(
      entity
    );


  const previous =
    previousTrooper.get(
      entityIndex
    )
    ??
    null;


  if (
    !previous
  ) {

    previousTrooper.set(
      entityIndex,
      current
    );


    return;
  }


  // ----------------------------------------------------------
  // HEALTH DEATH
  // ----------------------------------------------------------

  const healthDeath =

    Number.isFinite(
      previous.health
    )

    &&

    Number.isFinite(
      current.health
    )

    &&

    previous.health >
      0

    &&

    current.health <=
      0;


  // ----------------------------------------------------------
  // LIFE-STATE DEATH
  // ----------------------------------------------------------

  const lifeDeath =

    Number.isFinite(
      previous.lifeState
    )

    &&

    Number.isFinite(
      current.lifeState
    )

    &&

    previous.lifeState ===
      0

    &&

    current.lifeState !==
      0;


  // ----------------------------------------------------------
  // RECORD
  // ----------------------------------------------------------

  if (
    healthDeath
    ||
    lifeDeath
  ) {

    const key =
      `${entityIndex}|${tick}`;


    if (
      !deathKeys.has(
        key
      )
    ) {

      deathKeys.add(
        key
      );


      const subclassId =
        current.subclassId ??
        previous.subclassId;


      const baseType =
        TROOPER_BASE_TYPE_PRIOR.get(
          String(
            subclassId
          )
        )
        ??
        'UNMAPPED';


      const economicBaseType =
        ECONOMIC_BASE_TYPES.has(
          baseType
        );


      const timeSeconds =
        tickToMatchTime(
          tick,
          clockOffset
        );


      trooperDeaths.push({

        schemaVersion:
          1,

        canonical:
          false,

        entityIndex,

        tick,

        timeSeconds,

        clock:
          formatClock(
            timeSeconds
          ),

        healthSignal:
          healthDeath,

        lifeStateSignal:
          lifeDeath,

        previousHealth:
          previous.health,

        currentHealth:
          current.health,

        previousLifeState:
          previous.lifeState,

        currentLifeState:
          current.lifeState,

        maxHealth:
          current.maxHealth ??
          previous.maxHealth,

        team:
          current.team ??
          previous.team,

        lane:
          current.lane ??
          previous.lane,

        subclassId,

        baseType,

        economicBaseType,

        baseTypeMappingStatus:
          'DISCOVERY_REPLAY_MAPPING_PRIOR',

        position:
          current.position ??
          previous.position,


        // -----------------------------------------------------
        // Exact death-time player geometry is captured for
        // economic Troopers only.
        //
        // This avoids bloating output with transport/nonstandard
        // Trooper snapshots.
        // -----------------------------------------------------

        playersAtDeath:
          economicBaseType
            ? collectCurrentPlayerSnapshot(

                parser.getDemo(),

                playerByPawnIndex
              )
            : null
      });
    }
  }


  previousTrooper.set(
    entityIndex,
    current
  );
}


// ============================================================
// TROOPER STATE
// ============================================================

function readTrooperState(
  entity
) {

  return {

    health:
      finite(
        safeGetField(
          entity,
          'm_iHealth'
        )
      ),

    maxHealth:
      finite(
        safeGetField(
          entity,
          'm_iMaxHealth'
        )
      ),

    lifeState:
      finite(
        safeGetField(
          entity,
          'm_lifeState'
        )
      ),

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    lane:
      finite(
        safeGetField(
          entity,
          'm_iLane'
        )
      ),

    subclassId:
      scalarStringOrNull(
        safeGetField(
          entity,
          'm_nSubclassID'
        )
      ),

    position:
      getWorldPosition(
        entity
      )
  };
}


// ============================================================
// PLAYER SNAPSHOT AT TROOPER DEATH
// ============================================================

function collectCurrentPlayerSnapshot(
  demo,
  playerByPawnIndex
) {

  const rows =
    [];


  const controllers =
    demo
      ?.getEntitiesByClassName
      ?.(
        'CCitadelPlayerController'
      )
    ??
    [];


  for (
    const controller
    of controllers
  ) {

    const playerName =
      stringOrNull(
        safeGetField(
          controller,
          'm_iszPlayerName'
        )
      );


    if (
      !playerName
      ||
      playerName ===
        'SourceTV'
    ) {

      continue;
    }


    const team =
      finite(
        safeGetField(
          controller,
          'm_iTeamNum'
        )
      );


    const heroId =
      finite(
        safeGetField(
          controller,
          'm_nHeroID'
        )
      );


    const netWorth =
      finite(
        safeGetField(
          controller,
          'm_iGoldNetWorth'
        )
      );


    const lastHits =
      finite(
        safeGetField(
          controller,
          'm_iLastHits'
        )
      );


    // --------------------------------------------------------
    // RETAIN RAW HANDLE FOR getEntityByHandle.
    //
    // handleOrNull() serializes the handle for output/identity,
    // but deadem should receive the original handle object/value.
    // --------------------------------------------------------

    const rawHeroPawnHandle =
      safeGetField(
        controller,
        'm_hHeroPawn'
      );


    const rawFallbackPawnHandle =
      safeGetField(
        controller,
        'm_hPawn'
      );


    const rawPawnHandle =

      decodeHandleEntityIndex(
        rawHeroPawnHandle
      ) !==
      null
        ? rawHeroPawnHandle
        : rawFallbackPawnHandle;


    const pawnHandle =
      handleOrNull(
        rawPawnHandle
      );


    const pawnIndex =
      decodeHandleEntityIndex(
        pawnHandle
      );


    let pawn =
      null;


    if (
      rawPawnHandle !==
        null
      &&
      rawPawnHandle !==
        undefined
    ) {

      try {

        pawn =
          demo.getEntityByHandle(
            rawPawnHandle
          );

      } catch {

        pawn =
          null;
      }
    }


    const position =
      pawn
        ? getWorldPosition(
            pawn
          )
        : null;


    const currency0 =
      pawn
        ? finite(
            safeGetField(
              pawn,
              'm_nCurrencies.0000'
            )
          )
        : null;


    const controllerIndex =
      getEntityIndex(
        controller
      );


    if (
      pawnIndex !==
      null
    ) {

      playerByPawnIndex.set(

        pawnIndex,

        {

          playerName,

          team,

          heroId,

          pawnEntityIndex:
            pawnIndex,

          controllerEntityIndex:
            controllerIndex
        }
      );
    }


    rows.push({

      playerName,

      team,

      heroId,

      controllerEntityIndex:
        controllerIndex,

      pawnEntityIndex:
        pawnIndex,

      position,

      netWorth,

      lastHits,

      currency0
    });
  }


  return rows;
}


// ============================================================
// ASSIGNED GOLD
// ============================================================

function processAssignedGold({

  event,

  entity,

  entityIndex,

  tick,

  clockOffset,

  previousAssignedGold,

  openActivationByEntity,

  activationSequenceByEntity,

  activations,

  playerByPawnIndex
}) {

  if (
    entityIndex ===
    null
  ) {

    return;
  }


  const current = {

    tick,

    entityIndex,

    operation:
      decodeOperation(
        event.operation
      ),

    active:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bActive'
        )
      ),

    interactive:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bInteractive'
        )
      ),

    vacuumTarget:
      handleOrNull(
        safeGetField(
          entity,
          'm_hVacuumTarget'
        )
      ),

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    subclassId:
      scalarStringOrNull(
        safeGetField(
          entity,
          'm_nSubclassID'
        )
      ),

    position:
      getWorldPosition(
        entity
      ),

    signals:
      []
  };


  const previous =
    previousAssignedGold.get(
      entityIndex
    )
    ??
    null;


  const firstObservation =
    previous ===
    null;


  if (
    firstObservation
  ) {

    current.signals.push(
      'FIRST_OBSERVATION'
    );
  }


  if (
    current.operation ===
    'CREATE'
  ) {

    current.signals.push(
      'OPERATION_CREATE'
    );
  }


  // ----------------------------------------------------------
  // TRANSITIONS
  // ----------------------------------------------------------

  const becameActive =

    previous

    &&

    previous.active ===
      false

    &&

    current.active ===
      true;


  const becameInactive =

    previous

    &&

    previous.active ===
      true

    &&

    current.active ===
      false;


  const becameInteractive =

    previous

    &&

    previous.interactive ===
      false

    &&

    current.interactive ===
      true;


  const becameNonInteractive =

    previous

    &&

    previous.interactive ===
      true

    &&

    current.interactive ===
      false;


  const vacuumChanged =

    previous

    &&

    previous.vacuumTarget !==
      current.vacuumTarget;


  if (
    becameActive
  ) {

    current.signals.push(
      'BECAME_ACTIVE'
    );
  }


  if (
    becameInactive
  ) {

    current.signals.push(
      'BECAME_INACTIVE'
    );
  }


  if (
    becameInteractive
  ) {

    current.signals.push(
      'BECAME_INTERACTIVE'
    );
  }


  if (
    becameNonInteractive
  ) {

    current.signals.push(
      'BECAME_NONINTERACTIVE'
    );
  }


  if (
    vacuumChanged
  ) {

    current.signals.push(
      'VACUUM_TARGET_CHANGED'
    );
  }


  // ----------------------------------------------------------
  // POSITION JUMP
  // ----------------------------------------------------------

  let positionJump =
    false;


  let positionJumpDistance =
    null;


  if (
    previous?.position
    &&
    current.position
  ) {

    positionJumpDistance =
      getDistance3D(

        previous.position,

        current.position
      );


    if (
      positionJumpDistance >=
      POSITION_JUMP_THRESHOLD_HU
    ) {

      positionJump =
        true;


      current.signals.push(
        'POSITION_JUMP'
      );
    }
  }


  // ----------------------------------------------------------
  // LOGICAL ACTIVATION
  //
  // CREATE alone is deliberately not enough.
  // ----------------------------------------------------------

  const firstActiveObservation =

    firstObservation

    &&

    current.active ===
      true;


  const strongActivationSignal =

    becameActive

    ||

    (
      positionJump
      &&
      current.active ===
        true
    )

    ||

    firstActiveObservation;


  if (
    strongActivationSignal
  ) {

    let open =
      openActivationByEntity.get(
        entityIndex
      )
      ??
      null;


    if (
      open
      &&
      shouldMergeActivationSignal(
        open,
        current
      )
    ) {

      mergeActivationSignal(

        open,

        current,

        positionJumpDistance
      );

    } else {

      if (
        open
      ) {

        finalizeActivation(

          open,

          tick,

          'ENTITY_REUSED_BEFORE_INACTIVE',

          clockOffset
        );
      }


      const sequence =

        (
          activationSequenceByEntity.get(
            entityIndex
          )
          ??
          0
        )

        +

        1;


      activationSequenceByEntity.set(
        entityIndex,
        sequence
      );


      open = {

        schemaVersion:
          1,

        canonical:
          false,

        activationId:
          `${entityIndex}|${sequence}`,

        entityIndex,

        sequence,

        activationTick:
          tick,

        activationTimeSeconds:
          tickToMatchTime(
            tick,
            clockOffset
          ),

        activationClock:
          formatClock(
            tickToMatchTime(
              tick,
              clockOffset
            )
          ),

        team:
          current.team,

        subclassId:
          current.subclassId,

        position:
          current.position,

        activeAtStart:
          current.active,

        interactiveAtStart:
          current.interactive,

        startSignals:
          [
            ...current.signals
          ],

        positionJumpDistance,

        firstInteractiveTick:
          current.interactive ===
            true
            ? tick
            : null,

        firstValidVacuumTarget:
          null,

        vacuumTargetTransitions:
          [],

        lastObservedTick:
          tick,

        endTick:
          null,

        endTimeSeconds:
          null,

        endClock:
          null,

        durationSeconds:
          null,

        endReason:
          null,

        finalized:
          false
      };


      attachVacuumTarget(

        open,

        current,

        playerByPawnIndex,

        clockOffset
      );


      openActivationByEntity.set(
        entityIndex,
        open
      );


      activations.push(
        open
      );
    }
  }


  // ----------------------------------------------------------
  // UPDATE OPEN ACTIVATION
  // ----------------------------------------------------------

  const open =
    openActivationByEntity.get(
      entityIndex
    )
    ??
    null;


  if (
    open
  ) {

    open.lastObservedTick =
      tick;


    if (
      open.firstInteractiveTick ===
        null
      &&
      current.interactive ===
        true
    ) {

      open.firstInteractiveTick =
        tick;
    }


    attachVacuumTarget(

      open,

      current,

      playerByPawnIndex,

      clockOffset
    );
  }


  // ----------------------------------------------------------
  // END
  // ----------------------------------------------------------

  if (
    becameInactive
    &&
    open
  ) {

    finalizeActivation(

      open,

      tick,

      'BECAME_INACTIVE',

      clockOffset
    );


    openActivationByEntity.delete(
      entityIndex
    );
  }


  previousAssignedGold.set(
    entityIndex,
    current
  );
}


// ============================================================
// ASSIGNED GOLD VACUUM TARGET
// ============================================================

function attachVacuumTarget(

  activation,

  current,

  playerByPawnIndex,

  clockOffset
) {

  const targetIndex =
    decodeHandleEntityIndex(
      current.vacuumTarget
    );


  if (
    targetIndex ===
    null
  ) {

    return;
  }


  const previousTransition =

    activation
      .vacuumTargetTransitions[
        activation
          .vacuumTargetTransitions
          .length -
        1
      ]

    ??

    null;


  if (
    previousTransition
    &&
    previousTransition.handle ===
      current.vacuumTarget
  ) {

    return;
  }


  const transition = {

    tick:
      current.tick,

    timeSeconds:
      tickToMatchTime(
        current.tick,
        clockOffset
      ),

    clock:
      formatClock(
        tickToMatchTime(
          current.tick,
          clockOffset
        )
      ),

    handle:
      current.vacuumTarget,

    decodedEntityIndex:
      targetIndex,

    player:
      playerByPawnIndex.get(
        targetIndex
      )
      ??
      null,

    assignedGoldPosition:
      current.position
  };


  activation
    .vacuumTargetTransitions
    .push(
      transition
    );


  if (
    !activation.firstValidVacuumTarget
  ) {

    activation.firstValidVacuumTarget =
      transition;
  }
}


// ============================================================
// ACTIVATION MERGE
// ============================================================

function shouldMergeActivationSignal(
  activation,
  current
) {

  const tickDelta =
    current.tick -
    activation.activationTick;


  if (
    tickDelta <
      0
    ||
    tickDelta >
      ACTIVATION_MERGE_TICKS
  ) {

    return false;
  }


  if (
    activation.position
    &&
    current.position
  ) {

    const distance =
      getDistance3D(

        activation.position,

        current.position
      );


    if (
      distance >
      ACTIVATION_MERGE_DISTANCE_HU
    ) {

      return false;
    }
  }


  return true;
}


// ============================================================
// MERGE ACTIVATION SIGNAL
// ============================================================

function mergeActivationSignal(

  activation,

  current,

  positionJumpDistance
) {

  activation.startSignals = [

    ...new Set([

      ...activation.startSignals,

      ...current.signals
    ])
  ];


  if (
    Number.isFinite(
      positionJumpDistance
    )
  ) {

    activation.positionJumpDistance =
      Math.max(

        activation.positionJumpDistance ??
        0,

        positionJumpDistance
      );
  }


  if (
    !activation.position
    &&
    current.position
  ) {

    activation.position =
      current.position;
  }


  if (
    activation.team ===
      null
    &&
    current.team !==
      null
  ) {

    activation.team =
      current.team;
  }
}


// ============================================================
// FINALIZE ACTIVATION
// ============================================================

function finalizeActivation(

  activation,

  endTick,

  reason,

  clockOffset
) {

  if (
    activation.finalized
  ) {

    return;
  }


  const finalTick =
    Number.isFinite(
      endTick
    )
      ? endTick
      : activation.lastObservedTick;


  activation.endTick =
    finalTick;


  activation.endTimeSeconds =
    Number.isFinite(
      finalTick
    )
      ? tickToMatchTime(
          finalTick,
          clockOffset
        )
      : null;


  activation.endClock =
    Number.isFinite(
      activation.endTimeSeconds
    )
      ? formatClock(
          activation.endTimeSeconds
        )
      : null;


  activation.durationSeconds =

    Number.isFinite(
      finalTick
    )

    &&

    Number.isFinite(
      activation.activationTick
    )

      ? (
          finalTick -
          activation.activationTick
        )
        /
        TICK_RATE

      : null;


  activation.endReason =
    reason;


  activation.finalized =
    true;


  activation.targeted =
    Boolean(
      activation.firstValidVacuumTarget
    );


  activation.targetOnsetTick =
    activation
      .firstValidVacuumTarget
      ?.tick
    ??
    null;


  activation.targetOnsetDelaySeconds =
    Number.isFinite(
      activation.targetOnsetTick
    )
      ? (
          activation.targetOnsetTick -
          activation.activationTick
        )
        /
        TICK_RATE
      : null;
}


// ============================================================
// CITEMXP IDENTITY
// ============================================================

function processCItemXP({

  entity,

  entityIndex,

  tick,

  operation,

  currentCItemXP
}) {

  if (
    entityIndex ===
    null
  ) {

    return;
  }


  const existing =
    currentCItemXP.get(
      entityIndex
    )
    ??
    null;


  const row = {

    entityIndex,

    subclassId:
      scalarStringOrNull(
        safeGetField(
          entity,
          'm_nSubclassID'
        )
      )
      ??
      existing?.subclassId
      ??
      null,

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      )
      ??
      existing?.team
      ??
      null,

    position:
      getWorldPosition(
        entity
      )
      ??
      existing?.position
      ??
      null,

    firstSeenTick:
      existing?.firstSeenTick
      ??
      tick,

    lastSeenTick:
      tick,

    endTick:
      existing?.endTick
      ??
      null
  };


  if (
    operation ===
      'DELETE'
    ||
    operation ===
      'LEAVE'
  ) {

    row.endTick =
      tick;
  }


  currentCItemXP.set(
    entityIndex,
    row
  );
}


// ============================================================
// PLAYER LOOKUP BY PAWN INDEX
// ============================================================

function findPlayerForPawnIndex(

  demo,

  pawnIndex,

  playerByPawnIndex
) {

  const cached =
    playerByPawnIndex.get(
      pawnIndex
    )
    ??
    null;


  if (
    cached
  ) {

    return cached;
  }


  const controllers =
    demo
      ?.getEntitiesByClassName
      ?.(
        'CCitadelPlayerController'
      )
    ??
    [];


  for (
    const controller
    of controllers
  ) {

    const playerName =
      stringOrNull(
        safeGetField(
          controller,
          'm_iszPlayerName'
        )
      );


    if (
      !playerName
      ||
      playerName ===
        'SourceTV'
    ) {

      continue;
    }


    const pawnHandle =

      handleOrNull(
        safeGetField(
          controller,
          'm_hHeroPawn'
        )
      )

      ??

      handleOrNull(
        safeGetField(
          controller,
          'm_hPawn'
        )
      );


    const decoded =
      decodeHandleEntityIndex(
        pawnHandle
      );


    if (
      decoded ===
      null
    ) {

      continue;
    }


    const player = {

      playerName,

      team:
        finite(
          safeGetField(
            controller,
            'm_iTeamNum'
          )
        ),

      heroId:
        finite(
          safeGetField(
            controller,
            'm_nHeroID'
          )
        ),

      pawnEntityIndex:
        decoded,

      controllerEntityIndex:
        getEntityIndex(
          controller
        )
    };


    playerByPawnIndex.set(
      decoded,
      player
    );


    if (
      decoded ===
      pawnIndex
    ) {

      return player;
    }
  }


  return null;
}


// ============================================================
// WORLD POSITION
// ============================================================

function getWorldPosition(
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


  return {

    x:
      cellX *
      512
      -
      16384
      +
      vecX,

    y:
      cellY *
      512
      -
      16384
      +
      vecY,

    z:
      (
        cellZ !==
          null
        &&
        vecZ !==
          null
      )
        ? cellZ *
          512
          -
          16384
          +
          vecZ
        : null
  };
}


// ============================================================
// DISTANCE
// ============================================================

function getDistance3D(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return Infinity;
  }


  const dz =

    Number.isFinite(
      a.z
    )

    &&

    Number.isFinite(
      b.z
    )

      ? a.z -
        b.z

      : 0;


  return Math.sqrt(

    (
      a.x -
      b.x
    )
    ** 2

    +

    (
      a.y -
      b.y
    )
    ** 2

    +

    dz
    ** 2
  );
}


// ============================================================
// MESSAGE HELPERS
// ============================================================

function decodeMessageType(
  type
) {

  if (
    type ===
      null
    ||
    type ===
      undefined
  ) {

    return null;
  }


  const code =
    type?._code
    ??
    type?.code
    ??
    null;


  if (
    code !==
      null
    &&
    code !==
      undefined
  ) {

    return String(
      code
    );
  }


  const id =
    type?._id
    ??
    type?.id
    ??
    null;


  if (
    id !==
      null
    &&
    id !==
      undefined
  ) {

    return `MESSAGE_ID_${id}`;
  }


  return String(
    type
  );
}


// ============================================================
// MESSAGE DATA
// ============================================================

function getMessageData(
  packet
) {

  return packet?.data
    ??
    packet?.message
    ??
    packet?.payload
    ??
    packet
    ??
    null;
}


// ============================================================
// ENTITY-REFERENCE SEARCH
// ============================================================

function findEntityReference(
  object,
  patterns
) {

  return (
    findValueByKeyPatterns(
      object,
      patterns,
      4
    )
    ?.value
    ??
    null
  );
}


// ============================================================
// NUMBER SEARCH
// ============================================================

function findNumberByKey(
  object,
  pattern
) {

  return finite(

    findValueByKeyPatterns(
      object,
      [
        pattern
      ],
      4
    )
    ?.value
  );
}


// ============================================================
// RECURSIVE FIELD SEARCH
// ============================================================

function findValueByKeyPatterns(

  root,

  patterns,

  maxDepth
) {

  const seen =
    new Set();


  const queue = [

    {

      value:
        root,

      depth:
        0
    }
  ];


  while (
    queue.length >
    0
  ) {

    const current =
      queue.shift();


    const value =
      current.value;


    if (
      value ===
        null
      ||
      value ===
        undefined
      ||
      typeof value !==
        'object'
    ) {

      continue;
    }


    if (
      seen.has(
        value
      )
    ) {

      continue;
    }


    seen.add(
      value
    );


    for (
      const [
        key,
        nested
      ]
      of Object.entries(
        value
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

        return {

          key,

          value:
            nested
        };
      }


      if (
        current.depth <
          maxDepth
        &&
        nested !==
          null
        &&
        typeof nested ===
          'object'
      ) {

        queue.push({

          value:
            nested,

          depth:
            current.depth +
            1
        });
      }
    }
  }


  return null;
}


// ============================================================
// ENTITY CLASS
// ============================================================

function getEntityClassName(
  entity
) {

  try {

    if (
      typeof entity?.getClassName ===
      'function'
    ) {

      const value =
        entity.getClassName();


      if (
        value
      ) {

        return String(
          value
        );
      }
    }

  } catch {}


  return (
    entity?.className
    ??
    entity?.class?.name
    ??
    entity?._className
    ??
    null
  );
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
  entity
) {

  const direct =
    finite(
      entity?.index
      ??
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


// ============================================================
// SAFE FIELD
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


// ============================================================
// ENTITY OPERATION
// ============================================================

function decodeOperation(
  operation
) {

  const code =
    operation?._code
    ??
    operation?.code
    ??
    operation;


  const text =
    String(
      code ??
      'UNKNOWN'
    )
      .toUpperCase();


  if (
    text.includes(
      'CREATE'
    )
  ) {

    return 'CREATE';
  }


  if (
    text.includes(
      'UPDATE'
    )
  ) {

    return 'UPDATE';
  }


  if (
    text.includes(
      'LEAVE'
    )
  ) {

    return 'LEAVE';
  }


  if (
    text.includes(
      'DELETE'
    )
  ) {

    return 'DELETE';
  }


  return text;
}


// ============================================================
// HANDLE SERIALIZATION
// ============================================================

function handleOrNull(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  try {

    const parsed =
      BigInt(
        value
      );


    if (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    ) {

      return null;
    }


    return parsed.toString();

  } catch {

    return null;
  }
}


// ============================================================
// HANDLE -> ENTITY INDEX
// ============================================================

function decodeHandleEntityIndex(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  try {

    const parsed =
      BigInt(
        value
      );


    if (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    ) {

      return null;
    }


    return Number(
      parsed
      &
      BigInt(
        ENTITY_INDEX_MASK
      )
    );

  } catch {

    return null;
  }
}


// ============================================================
// GENERAL ENTITY REFERENCE
// ============================================================

function normalizeEntityReference(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  if (
    typeof value ===
    'object'
  ) {

    for (
      const key
      of [

        'entityIndex',
        'entindex',
        'index',
        'handle',
        'value',
        'id'
      ]
    ) {

      if (
        Object
          .prototype
          .hasOwnProperty
          .call(
            value,
            key
          )
      ) {

        const normalized =
          normalizeEntityReference(
            value[
              key
            ]
          );


        if (
          normalized !==
          null
        ) {

          return normalized;
        }
      }
    }


    return null;
  }


  const number =
    finite(
      value
    );


  if (
    number ===
    null
  ) {

    return null;
  }


  const integer =
    Math.trunc(
      number
    );


  if (
    integer >=
      0
    &&
    integer <=
      ENTITY_INDEX_MASK
  ) {

    return integer;
  }


  const masked =
    integer
    &
    ENTITY_INDEX_MASK;


  return (
    masked >=
      0
    &&
    masked <=
      ENTITY_INDEX_MASK
  )
    ? masked
    : null;
}


// ============================================================
// VECTOR
// ============================================================

function normalizeVector(
  value
) {

  if (
    !value
    ||
    typeof value !==
      'object'
  ) {

    return null;
  }


  const x =
    finite(
      value.x
      ??
      value['0']
    );


  const y =
    finite(
      value.y
      ??
      value['1']
    );


  const z =
    finite(
      value.z
      ??
      value['2']
    );


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

    z
  };
}


// ============================================================
// GROUP BY TICK
// ============================================================

function groupByTick(

  rows,

  selector =
    row =>
      row.tick
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const tick =
      finite(
        selector(
          row
        )
      );


    if (
      tick ===
      null
    ) {

      continue;
    }


    if (
      !map.has(
        tick
      )
    ) {

      map.set(
        tick,
        []
      );
    }


    map
      .get(
        tick
      )
      .push(
        row
      );
  }


  return map;
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
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
// JSONL WRITER
// ============================================================

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
// TIME
// ============================================================

function tickToMatchTime(
  tick,
  clockOffset
) {

  return (
    tick /
    TICK_RATE
  )
  -
  clockOffset;
}


// ============================================================
// CLOCK
// ============================================================

function formatClock(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return null;
  }


  const negative =
    seconds <
    0;


  const absolute =
    Math.abs(
      seconds
    );


  const minutes =
    Math.floor(
      absolute /
      60
    );


  const wholeSeconds =
    Math.floor(
      absolute %
      60
    );


  return (
    `${negative ? '-' : ''}` +
    `${minutes}:` +
    `${String(wholeSeconds).padStart(2, '0')}`
  );
}


// ============================================================
// FINITE
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


// ============================================================
// FIRST FINITE
// ============================================================

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


// ============================================================
// RATE
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


// ============================================================
// BOOLEAN
// ============================================================

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
// SCALAR STRING
// ============================================================

function scalarStringOrNull(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  if (
    typeof value ===
      'string'
    ||
    typeof value ===
      'number'
    ||
    typeof value ===
      'bigint'
  ) {

    return String(
      value
    );
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
      value._id
      ??
      value.id
      ??
      value._code
      ??
      value.code
      ??
      null;


    if (
      candidate !==
        null
      &&
      candidate !==
        undefined
    ) {

      return String(
        candidate
      );
    }
  }


  return String(
    value
  );
}


// ============================================================
// STRING
// ============================================================

function stringOrNull(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  const text =
    String(
      value
    );


  return text.length >
    0
      ? text
      : null;
}


// ============================================================
// CHECK
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
// MARKDOWN
// ============================================================

function buildBatchMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Compact Cross-Replay Event Extraction'
  );


  lines.push(
    ''
  );


  lines.push(
    `Created: ${summary.createdAt}`
  );


  lines.push(
    ''
  );


  lines.push(
    `Cohort size: **${summary.cohortSize}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Batch pass: **${summary.batchPass}**`
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
    const row
    of summary.replays
  ) {

    lines.push(
      `### ${row.replayName}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Success: ${row.success}`
    );


    lines.push(
      `- Status: ${row.status}`
    );


    if (
      row.counts
    ) {

      lines.push(
        `- Trooper deaths: ${row.counts.trooperDeaths}`
      );


      lines.push(
        `- Economic Trooper deaths: ${row.counts.economicTrooperDeaths}`
      );


      lines.push(
        `- AssignedGold activations: ${row.counts.assignedGoldActivations}`
      );


      lines.push(
        `- Positive currency deltas: ${row.counts.positiveCurrencyDeltas}`
      );


      lines.push(
        `- CItemXP damage events: ${row.counts.citemxpDamageEvents}`
      );
    }


    lines.push(
      ''
    );
  }


  return lines.join(
    '\n'
  );
}


// ============================================================
// DURATION
// ============================================================

function formatDuration(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return 'n/a';
  }


  if (
    seconds <
    60
  ) {

    return `${seconds.toFixed(2)} sec`;
  }


  const minutes =
    Math.floor(
      seconds /
      60
    );


  const remaining =
    seconds -
    minutes *
    60;


  return `${minutes}m ${remaining.toFixed(1)}s`;
}