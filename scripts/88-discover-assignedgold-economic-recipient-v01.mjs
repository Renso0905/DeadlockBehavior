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


const TICK_RATE =
  64;


// ============================================================
// COLLISION FILTER
//
// Primary discovery uses stable floor souls whose active=false
// termination is separated from another AssignedGold
// termination by >16 ticks.
//
// This reduces obvious economy batching from simultaneous ground
// soul collections.
//
// It does NOT remove every possible unrelated economy event.
// ============================================================

const ISOLATION_RADIUS_TICKS =
  16;


// ============================================================
// ECONOMIC CANDIDATE FIELDS
//
// m_iGoldNetWorth:
//
//   Already independently supported by Script 69 as a useful
//   economy-award signal for CItemXP.
//
// m_nCurrencies.*:
//
//   Raw pawn-side currency buckets already extracted by Script03.
//
// We DO NOT currently know which bucket, if any, corresponds
// specifically to the ground-soul award.
//
// That is what this script is testing.
// ============================================================

const CONTROLLER_CANDIDATE_FIELDS = [
  'm_iGoldNetWorth'
];


const PAWN_CANDIDATE_FIELDS = [
  'm_nCurrencies.0000',
  'm_nCurrencies.0001',
  'm_nCurrencies.0002',
  'm_nCurrencies.0003',
  'm_nCurrencies.0004',
  'm_nCurrencies.0005'
];


const CONTROLLER_CONTEXT_FIELDS = [
  'm_iLastHits',
  'm_iDenies',
  'm_iPlayerKills',
  'm_iPlayerAssists'
];


const PAWN_CONTEXT_FIELDS = [
  'm_nSpentCurrencies.0000',
  'm_nSpentCurrencies.0001',
  'm_nSpentCurrencies.0002',
  'm_nSpentCurrencies.0003',
  'm_nSpentCurrencies.0004',
  'm_nSpentCurrencies.0005'
];


// ============================================================
// CANDIDATE TEMPORAL WINDOWS
//
// We explicitly test BOTH:
//
//   m_hVacuumTarget onset
//
// and:
//
//   m_bActive=false
//
// because we do not yet know at which point the economic award
// becomes visible.
//
// Target -> inactive median is ~0.64 s, so active=false windows
// include wider pre-windows capable of reaching target onset.
// ============================================================

const WINDOW_CONFIGS = [

  {
    id:
      'TARGET_ONSET_P0_P4',

    anchorType:
      'TARGET_ONSET',

    before:
      0,

    after:
      4
  },

  {
    id:
      'TARGET_ONSET_P0_P8',

    anchorType:
      'TARGET_ONSET',

    before:
      0,

    after:
      8
  },

  {
    id:
      'TARGET_ONSET_P0_P16',

    anchorType:
      'TARGET_ONSET',

    before:
      0,

    after:
      16
  },

  {
    id:
      'TARGET_ONSET_M4_P8',

    anchorType:
      'TARGET_ONSET',

    before:
      4,

    after:
      8
  },

  {
    id:
      'ACTIVE_FALSE_P0_P8',

    anchorType:
      'ACTIVE_FALSE',

    before:
      0,

    after:
      8
  },

  {
    id:
      'ACTIVE_FALSE_M8_P8',

    anchorType:
      'ACTIVE_FALSE',

    before:
      8,

    after:
      8
  },

  {
    id:
      'ACTIVE_FALSE_M16_P16',

    anchorType:
      'ACTIVE_FALSE',

    before:
      16,

    after:
      16
  },

  {
    id:
      'ACTIVE_FALSE_M32_P8',

    anchorType:
      'ACTIVE_FALSE',

    before:
      32,

    after:
      8
  },

  {
    id:
      'ACTIVE_FALSE_M48_P8',

    anchorType:
      'ACTIVE_FALSE',

    before:
      48,

    after:
      8
  },

  {
    id:
      'ACTIVE_FALSE_M64_P8',

    anchorType:
      'ACTIVE_FALSE',

    before:
      64,

    after:
      8
  }
];


// ============================================================
// WIDE TIMING SEARCH
//
// Used after field/window ranking to show where positive economic
// changes actually fall relative to:
//
//   target onset
//   active=false
// ============================================================

const TIMING_SEARCH_BEFORE_TICKS =
  80;


const TIMING_SEARCH_AFTER_TICKS =
  96;


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );


const summary87Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classifier_v01.json'
  );


const classified87Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classified_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_economic_recipient_discovery_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_economic_recipient_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    summary87Path,
    classified87Path
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
// LOAD SCRIPT 87
// ============================================================

const summary87 =
  JSON.parse(
    readFileSync(
      summary87Path,
      'utf8'
    )
  );


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


console.log('');

console.log(
  'Loading formal AssignedGold lifecycle stream...'
);


const lifecycleRows =
  await loadJsonl(
    classified87Path
  );


console.log(
  `Lifecycle cases: ${lifecycleRows.length}`
);


// ============================================================
// LOAD PLAYER IDENTITIES
// ============================================================

console.log(
  'Loading controller / pawn player identities...'
);


const identity =
  await loadPlayerIdentity(
    playerStatePath
  );


console.log(
  `Players: ${identity.players.length}`
);


console.log(
  `Controller indexes: ${identity.playerByControllerIndex.size}`
);


console.log(
  `Pawn indexes: ${identity.playerByPawnIndex.size}`
);


console.log(
  `Ambiguous pawn indexes excluded: ${identity.ambiguousPawnIndexes.size}`
);


// ============================================================
// LIFECYCLE COHORTS
// ============================================================

const targeted =
  lifecycleRows.filter(
    row =>
      row
        ?.vacuum
        ?.targetAssigned ===
      true
  );


const stableTargeted =
  lifecycleRows.filter(
    row =>
      row?.lifecycleClass ===
      'TARGETED_STABLE_FLOOR'
  );


const targetless =
  lifecycleRows.filter(
    row =>
      row
        ?.vacuum
        ?.targetAssigned ===
      false
  );


const targetlessWithInactive =
  targetless.filter(
    row =>
      Number.isFinite(
        finite(
          row
            ?.termination
            ?.activeFalseTick
        )
      )
  );


console.log('');

console.log(
  `Targeted cases: ${targeted.length}`
);


console.log(
  `Stable targeted cases: ${stableTargeted.length}`
);


console.log(
  `Targetless cases: ${targetless.length}`
);


console.log(
  `Targetless with active=false: ${targetlessWithInactive.length}`
);


// ============================================================
// TERMINATION COLLISION GEOMETRY
// ============================================================

const allTerminationTicks =
  lifecycleRows
    .map(
      row => ({

        deathIndex:
          finite(
            row?.deathIndex
          ),

        tick:
          finite(
            row
              ?.termination
              ?.activeFalseTick
          )
      })
    )
    .filter(
      row =>
        row.deathIndex !==
          null
        &&
        row.tick !==
          null
    )
    .sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );


const nearestOtherTerminationByDeath =
  new Map();


for (
  let i = 0;
  i <
  allTerminationTicks.length;
  i++
) {

  const current =
    allTerminationTicks[i];


  let nearest =
    Infinity;


  if (
    i >
    0
  ) {

    nearest =
      Math.min(
        nearest,
        current.tick -
        allTerminationTicks[
          i - 1
        ].tick
      );
  }


  if (
    i + 1 <
    allTerminationTicks.length
  ) {

    nearest =
      Math.min(
        nearest,
        allTerminationTicks[
          i + 1
        ].tick -
        current.tick
      );
  }


  nearestOtherTerminationByDeath.set(
    current.deathIndex,
    nearest
  );
}


// ============================================================
// NORMALIZE DISCOVERY CASES
// ============================================================

const cases =
  lifecycleRows
    .map(
      normalizeLifecycleCase
    )
    .filter(
      Boolean
    );


function normalizeLifecycleCase(
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


  const targetOnsetTick =
    finite(
      row
        ?.vacuum
        ?.targetOnsetTick
    );


  const activeFalseTick =
    finite(
      row
        ?.termination
        ?.activeFalseTick
    );


  const nearestOtherTerminationTicks =
    nearestOtherTerminationByDeath.get(
      deathIndex
    )
    ??
    Infinity;


  return {

    deathIndex,

    clock:
      row?.clock ??
      row
        ?.death
        ?.clock ??
      null,

    lifecycleClass:
      row?.lifecycleClass ??
      null,

    creditedPlayerName:
      row
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedTeam:
      finite(
        row
          ?.creditedPlayer
          ?.team
      ),

    targetAssigned:
      row
        ?.vacuum
        ?.targetAssigned ===
      true,

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

    targetOnsetTick,

    targetDelaySeconds:
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      ),

    activeFalseTick,

    targetToInactiveSeconds:
      finite(
        row
          ?.termination
          ?.targetToInactiveSeconds
      ),

    nearestOtherTerminationTicks,

    isolated16:
      nearestOtherTerminationTicks >
      ISOLATION_RADIUS_TICKS,

    targetDiffersFromCredited:
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
      &&
      row
        .vacuum
        .targetPlayerName !==
      row
        .creditedPlayer
        .playerName,

    source:
      row,

    measurements:
      null
  };
}


// ============================================================
// PRIMARY DISCOVERY COHORT
//
// Stable floor cases are intentionally preferred because their
// collection occurs >=1 s after AssignedGold activation.
//
// This gives us the cleanest chance to separate ground-soul
// collection from the originating Trooper death and flying orb.
// ============================================================

let primaryTargeted =
  cases.filter(
    row =>
      row.lifecycleClass ===
        'TARGETED_STABLE_FLOOR'
      &&
      row.isolated16
      &&
      row.activeFalseTick !==
        null
      &&
      row.targetOnsetTick !==
        null
  );


let primaryCohortLabel =
  'STABLE_FLOOR_ISOLATED_16_TICKS';


if (
  primaryTargeted.length <
  40
) {

  primaryTargeted =
    cases.filter(
      row =>
        row.lifecycleClass ===
          'TARGETED_STABLE_FLOOR'
        &&
        row.activeFalseTick !==
          null
        &&
        row.targetOnsetTick !==
          null
    );


  primaryCohortLabel =
    'ALL_STABLE_FLOOR_FALLBACK';
}


const primaryTargetlessControls =
  cases.filter(
    row =>
      row.lifecycleClass ===
        'TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE'
      &&
      row.isolated16
      &&
      row.activeFalseTick !==
        null
  );


console.log('');

console.log(
  `Primary targeted cohort: ${primaryTargeted.length} (${primaryCohortLabel})`
);


console.log(
  `Primary isolated targetless controls: ${primaryTargetlessControls.length}`
);


// ============================================================
// CALIBRATION / HOLDOUT SPLIT
//
// Chronological alternating split.
//
// Calibration selects candidate field/window.
// Holdout evaluates it independently within test.dem.
// ============================================================

const primarySorted =
  primaryTargeted
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        a.activeFalseTick -
        b.activeFalseTick
    );


const calibration =
  primarySorted.filter(
    (
      row,
      index
    ) =>
      index %
        2 ===
      0
  );


const holdout =
  primarySorted.filter(
    (
      row,
      index
    ) =>
      index %
        2 ===
      1
  );


console.log(
  `Calibration / holdout: ${calibration.length} / ${holdout.length}`
);


// ============================================================
// RAW ECONOMY TELEMETRY
// ============================================================

const deltaEvents =
  [];


const previousValues =
  new Map();


const fieldStats =
  new Map();


for (
  const fieldName
  of [
    ...CONTROLLER_CANDIDATE_FIELDS,
    ...CONTROLLER_CONTEXT_FIELDS,
    ...PAWN_CANDIDATE_FIELDS,
    ...PAWN_CONTEXT_FIELDS
  ]
) {

  fieldStats.set(
    fieldName,
    {

      readAttempts:
        0,

      finiteReads:
        0,

      nonzeroDeltas:
        0,

      positiveDeltas:
        0,

      negativeDeltas:
        0,

      players:
        new Set()
    }
  );
}


let entityPackets =
  0;


let controllerEntityEvents =
  0;


let pawnEntityEvents =
  0;


console.log('');

console.log(
  'Rescanning replay for exact player economy telemetry...'
);

console.log('');


const parser =
  new Parser();


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


    entityPackets++;


    for (
      const event
      of events ??
      []
    ) {

      const entity =
        event?.entity;


      if (
        !entity
      ) {

        continue;
      }


      const entityIndex =
        getEntityIndex(
          entity
        );


      if (
        entityIndex ===
        null
      ) {

        continue;
      }


      const controllerPlayer =
        identity
          .playerByControllerIndex
          .get(
            entityIndex
          )
        ??
        null;


      const pawnPlayer =
        identity
          .playerByPawnIndex
          .get(
            entityIndex
          )
        ??
        null;


      if (
        controllerPlayer
      ) {

        controllerEntityEvents++;


        for (
          const fieldName
          of [
            ...CONTROLLER_CANDIDATE_FIELDS,
            ...CONTROLLER_CONTEXT_FIELDS
          ]
        ) {

          observeField({
            tick,
            source:
              'CONTROLLER',
            entity,
            entityIndex,
            player:
              controllerPlayer,
            fieldName
          });
        }
      }


      if (
        pawnPlayer
      ) {

        pawnEntityEvents++;


        for (
          const fieldName
          of [
            ...PAWN_CANDIDATE_FIELDS,
            ...PAWN_CONTEXT_FIELDS
          ]
        ) {

          observeField({
            tick,
            source:
              'PAWN',
            entity,
            entityIndex,
            player:
              pawnPlayer,
            fieldName
          });
        }
      }
    }
  }
);


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// FIELD OBSERVATION
// ============================================================

function observeField({
  tick,
  source,
  entity,
  entityIndex,
  player,
  fieldName
}) {

  const stats =
    fieldStats.get(
      fieldName
    );


  stats.readAttempts++;


  const value =
    finite(
      safeGetField(
        entity,
        fieldName
      )
    );


  if (
    value ===
    null
  ) {

    return;
  }


  stats.finiteReads++;


  stats.players.add(
    player.playerName
  );


  const key =
    `${source}|${entityIndex}|${fieldName}`;


  const previous =
    previousValues.get(
      key
    )
    ??
    null;


  previousValues.set(
    key,
    {

      tick,
      value
    }
  );


  if (
    !previous
    ||
    !Number.isFinite(
      previous.value
    )
  ) {

    return;
  }


  const delta =
    value -
    previous.value;


  if (
    delta ===
    0
  ) {

    return;
  }


  stats.nonzeroDeltas++;


  if (
    delta >
    0
  ) {

    stats.positiveDeltas++;

  } else {

    stats.negativeDeltas++;
  }


  deltaEvents.push({

    tick,

    source,

    entityIndex,

    playerName:
      player.playerName,

    team:
      player.team,

    heroId:
      player.heroId,

    fieldName,

    previousTick:
      previous.tick,

    previousValue:
      previous.value,

    currentValue:
      value,

    delta
  });
}


// ============================================================
// SORT RAW DELTAS
// ============================================================

deltaEvents.sort(
  (
    a,
    b
  ) =>
    a.tick -
      b.tick
    ||
    a.playerName.localeCompare(
      b.playerName
    )
    ||
    a.fieldName.localeCompare(
      b.fieldName
    )
);


console.log(
  `Economy/context delta events: ${deltaEvents.length}`
);


// ============================================================
// CANDIDATE FIELD DEFINITIONS
// ============================================================

const candidateFields =
  [

    ...CONTROLLER_CANDIDATE_FIELDS.map(
      fieldName => ({

        source:
          'CONTROLLER',

        fieldName,

        id:
          `CONTROLLER:${fieldName}`
      })
    ),

    ...PAWN_CANDIDATE_FIELDS.map(
      fieldName => ({

        source:
          'PAWN',

        fieldName,

        id:
          `PAWN:${fieldName}`
      })
    )
  ];


// ============================================================
// MEASURE FIELD/WINDOW COMBINATIONS
// ============================================================

const rankingRows =
  [];


for (
  const candidate
  of candidateFields
) {

  for (
    const window
    of WINDOW_CONFIGS
  ) {

    const calibrationEvaluation =
      evaluateTargetedCohort(
        calibration,
        candidate,
        window
      );


    let controlEvaluation =
      null;


    if (
      window.anchorType ===
      'ACTIVE_FALSE'
    ) {

      controlEvaluation =
        evaluateTargetlessControls(
          primaryTargetlessControls,
          candidate,
          window
        );
    }


    const targetSignal =
      calibrationEvaluation
        .targetPositiveRate ??
      0;


    const opponentSignal =
      calibrationEvaluation
        .anyOpponentPositiveRate ??
      0;


    const controlSignal =
      controlEvaluation
        ?.anyCreditedTeamPositiveRate ??
      0;


    const score =
      targetSignal
      -
      opponentSignal
      -
      0.50 *
      controlSignal;


    rankingRows.push({

      candidate,

      window,

      score,

      calibration:
        calibrationEvaluation,

      targetlessControls:
        controlEvaluation
    });
  }
}


// ============================================================
// RANK
// ============================================================

rankingRows.sort(
  (
    a,
    b
  ) =>
    b.score -
      a.score
    ||
    (
      b
        .calibration
        .targetPositiveRate ??
      -Infinity
    )
    -
    (
      a
        .calibration
        .targetPositiveRate ??
      -Infinity
    )
);


const bestOverall =
  rankingRows[0]
  ??
  null;


const bestTargetOnset =
  rankingRows.find(
    row =>
      row.window.anchorType ===
      'TARGET_ONSET'
  )
  ??
  null;


const bestActiveFalse =
  rankingRows.find(
    row =>
      row.window.anchorType ===
      'ACTIVE_FALSE'
  )
  ??
  null;


// ============================================================
// HOLDOUT EVALUATION
// ============================================================

const holdoutBestOverall =
  bestOverall
    ? evaluateTargetedCohort(
      holdout,
      bestOverall.candidate,
      bestOverall.window
    )
    : null;


const holdoutBestTargetOnset =
  bestTargetOnset
    ? evaluateTargetedCohort(
      holdout,
      bestTargetOnset.candidate,
      bestTargetOnset.window
    )
    : null;


const holdoutBestActiveFalse =
  bestActiveFalse
    ? evaluateTargetedCohort(
      holdout,
      bestActiveFalse.candidate,
      bestActiveFalse.window
    )
    : null;


const holdoutTargetlessBestActiveFalse =
  bestActiveFalse
    ? evaluateTargetlessControls(
      primaryTargetlessControls,
      bestActiveFalse.candidate,
      bestActiveFalse.window
    )
    : null;


// ============================================================
// ALL PRIMARY CASE EVALUATION FOR BEST SIGNAL
// ============================================================

const primaryBest =
  bestOverall
    ? evaluateTargetedCohort(
      primaryTargeted,
      bestOverall.candidate,
      bestOverall.window
    )
    : null;


const primaryBestMismatch =
  bestOverall
    ? evaluateMismatchCohort(
      primaryTargeted.filter(
        row =>
          row.targetDiffersFromCredited
      ),
      bestOverall.candidate,
      bestOverall.window
    )
    : null;


// ============================================================
// TIMING DISTRIBUTION FOR BEST FIELD
// ============================================================

const bestTiming =
  bestOverall
    ? buildTimingAnalysis(
      primaryTargeted,
      bestOverall.candidate
    )
    : null;


// ============================================================
// BUILD CASE OUTPUT FOR BEST FIELD/WINDOW
// ============================================================

const outputCases =
  cases.map(
    row => {

      const measurement =
        bestOverall
          ? measureCase(
            row,
            bestOverall.candidate,
            bestOverall.window
          )
          : null;


      const timing =
        bestOverall
          ? measureTimingForCase(
            row,
            bestOverall.candidate
          )
          : null;


      return {

        schemaVersion:
          1,

        canonical:
          false,

        deathIndex:
          row.deathIndex,

        clock:
          row.clock,

        lifecycleClass:
          row.lifecycleClass,

        isolated16:
          row.isolated16,

        nearestOtherTerminationTicks:
          Number.isFinite(
            row.nearestOtherTerminationTicks
          )
            ? row.nearestOtherTerminationTicks
            : null,

        creditedPlayerName:
          row.creditedPlayerName,

        creditedTeam:
          row.creditedTeam,

        targetAssigned:
          row.targetAssigned,

        targetPlayerName:
          row.targetPlayerName,

        targetPlayerTeam:
          row.targetPlayerTeam,

        targetDiffersFromCredited:
          row.targetDiffersFromCredited,

        targetOnsetTick:
          row.targetOnsetTick,

        activeFalseTick:
          row.activeFalseTick,

        targetToInactiveSeconds:
          row.targetToInactiveSeconds,

        selectedEconomicCandidate:
          bestOverall
            ? {

              field:
                bestOverall.candidate,

              window:
                bestOverall.window
            }
            : null,

        measurement,

        timing
      };
    }
  );


// ============================================================
// EVALUATION FUNCTIONS
// ============================================================

function evaluateTargetedCohort(
  cohort,
  candidate,
  window
) {

  const comparable =
    cohort.filter(
      row =>
        getAnchorTick(
          row,
          window.anchorType
        ) !==
        null
        &&
        Boolean(
          row.targetPlayerName
        )
        &&
        Boolean(
          row.creditedPlayerName
        )
        &&
        row.creditedTeam !==
        null
    );


  let targetPositive =
    0;


  let creditedPositive =
    0;


  let anySameTeamPositive =
    0;


  let anyOpponentPositive =
    0;


  let targetOnlyPositivePlayer =
    0;


  let targetAmongPositivePlayers =
    0;


  let multipleSameTeamPositive =
    0;


  let totalTargetPositiveDelta =
    0;


  let totalCreditedPositiveDelta =
    0;


  const targetPositiveValues =
    [];


  const creditedPositiveValues =
    [];


  const positiveRecipientCounts =
    [];


  for (
    const row
    of comparable
  ) {

    const measurement =
      measureCase(
        row,
        candidate,
        window
      );


    if (
      measurement.targetPositiveDelta >
      0
    ) {

      targetPositive++;


      totalTargetPositiveDelta +=
        measurement.targetPositiveDelta;


      targetPositiveValues.push(
        measurement.targetPositiveDelta
      );
    }


    if (
      measurement.creditedPositiveDelta >
      0
    ) {

      creditedPositive++;


      totalCreditedPositiveDelta +=
        measurement.creditedPositiveDelta;


      creditedPositiveValues.push(
        measurement.creditedPositiveDelta
      );
    }


    if (
      measurement.sameTeamPositivePlayers.length >
      0
    ) {

      anySameTeamPositive++;
    }


    if (
      measurement.opponentPositivePlayers.length >
      0
    ) {

      anyOpponentPositive++;
    }


    if (
      measurement.sameTeamPositivePlayers.length >
      1
    ) {

      multipleSameTeamPositive++;
    }


    if (
      measurement
        .sameTeamPositivePlayers
        .some(
          player =>
            player.playerName ===
            row.targetPlayerName
        )
    ) {

      targetAmongPositivePlayers++;
    }


    if (
      measurement.sameTeamPositivePlayers.length ===
        1
      &&
      measurement
        .sameTeamPositivePlayers[0]
        .playerName ===
      row.targetPlayerName
    ) {

      targetOnlyPositivePlayer++;
    }


    positiveRecipientCounts.push(
      measurement.sameTeamPositivePlayers.length
    );
  }


  return {

    count:
      comparable.length,

    targetPositive:
      targetPositive,

    targetPositiveRate:
      rate(
        targetPositive,
        comparable.length
      ),

    creditedPositive:
      creditedPositive,

    creditedPositiveRate:
      rate(
        creditedPositive,
        comparable.length
      ),

    anySameTeamPositive:
      anySameTeamPositive,

    anySameTeamPositiveRate:
      rate(
        anySameTeamPositive,
        comparable.length
      ),

    anyOpponentPositive:
      anyOpponentPositive,

    anyOpponentPositiveRate:
      rate(
        anyOpponentPositive,
        comparable.length
      ),

    targetAmongPositivePlayers:
      targetAmongPositivePlayers,

    targetAmongPositivePlayersRate:
      rate(
        targetAmongPositivePlayers,
        comparable.length
      ),

    targetOnlyPositivePlayer:
      targetOnlyPositivePlayer,

    targetOnlyPositivePlayerRate:
      rate(
        targetOnlyPositivePlayer,
        comparable.length
      ),

    multipleSameTeamPositive:
      multipleSameTeamPositive,

    multipleSameTeamPositiveRate:
      rate(
        multipleSameTeamPositive,
        comparable.length
      ),

    targetPositiveDelta:
      summarizeNumbers(
        targetPositiveValues
      ),

    creditedPositiveDelta:
      summarizeNumbers(
        creditedPositiveValues
      ),

    sameTeamPositiveRecipientCount:
      summarizeNumbers(
        positiveRecipientCounts
      ),

    totalTargetPositiveDelta,

    totalCreditedPositiveDelta
  };
}


function evaluateMismatchCohort(
  cohort,
  candidate,
  window
) {

  let targetOnly =
    0;


  let creditedOnly =
    0;


  let both =
    0;


  let neither =
    0;


  let targetPositive =
    0;


  let creditedPositive =
    0;


  const rows =
    [];


  for (
    const row
    of cohort
  ) {

    const measurement =
      measureCase(
        row,
        candidate,
        window
      );


    const targetHas =
      measurement.targetPositiveDelta >
      0;


    const creditedHas =
      measurement.creditedPositiveDelta >
      0;


    if (
      targetHas
    ) {

      targetPositive++;
    }


    if (
      creditedHas
    ) {

      creditedPositive++;
    }


    let relation;


    if (
      targetHas
      &&
      !creditedHas
    ) {

      targetOnly++;

      relation =
        'TARGET_ONLY';

    } else if (
      !targetHas
      &&
      creditedHas
    ) {

      creditedOnly++;

      relation =
        'CREDITED_ONLY';

    } else if (
      targetHas
      &&
      creditedHas
    ) {

      both++;

      relation =
        'BOTH';

    } else {

      neither++;

      relation =
        'NEITHER';
    }


    rows.push({

      deathIndex:
        row.deathIndex,

      clock:
        row.clock,

      targetPlayerName:
        row.targetPlayerName,

      creditedPlayerName:
        row.creditedPlayerName,

      targetPositiveDelta:
        measurement.targetPositiveDelta,

      creditedPositiveDelta:
        measurement.creditedPositiveDelta,

      sameTeamPositivePlayers:
        measurement.sameTeamPositivePlayers,

      relation
    });
  }


  return {

    count:
      cohort.length,

    targetPositive,

    targetPositiveRate:
      rate(
        targetPositive,
        cohort.length
      ),

    creditedPositive,

    creditedPositiveRate:
      rate(
        creditedPositive,
        cohort.length
      ),

    targetOnly,

    creditedOnly,

    both,

    neither,

    rows
  };
}


function evaluateTargetlessControls(
  cohort,
  candidate,
  window
) {

  const comparable =
    cohort.filter(
      row =>
        row.activeFalseTick !==
          null
        &&
        row.creditedTeam !==
          null
    );


  let anyCreditedTeamPositive =
    0;


  let anyOpponentPositive =
    0;


  let creditedPlayerPositive =
    0;


  const creditedTeamPositiveTotals =
    [];


  for (
    const row
    of comparable
  ) {

    const measurement =
      measureCase(
        row,
        candidate,
        window
      );


    if (
      measurement.sameTeamPositivePlayers.length >
      0
    ) {

      anyCreditedTeamPositive++;
    }


    if (
      measurement.opponentPositivePlayers.length >
      0
    ) {

      anyOpponentPositive++;
    }


    if (
      measurement.creditedPositiveDelta >
      0
    ) {

      creditedPlayerPositive++;
    }


    creditedTeamPositiveTotals.push(
      measurement.sameTeamPositiveDelta
    );
  }


  return {

    count:
      comparable.length,

    anyCreditedTeamPositive,

    anyCreditedTeamPositiveRate:
      rate(
        anyCreditedTeamPositive,
        comparable.length
      ),

    creditedPlayerPositive,

    creditedPlayerPositiveRate:
      rate(
        creditedPlayerPositive,
        comparable.length
      ),

    anyOpponentPositive,

    anyOpponentPositiveRate:
      rate(
        anyOpponentPositive,
        comparable.length
      ),

    creditedTeamPositiveDelta:
      summarizeNumbers(
        creditedTeamPositiveTotals
      )
  };
}


// ============================================================
// MEASURE ONE CASE
// ============================================================

function measureCase(
  row,
  candidate,
  window
) {

  const anchorTick =
    getAnchorTick(
      row,
      window.anchorType
    );


  if (
    anchorTick ===
    null
  ) {

    return {

      anchorTick:
        null,

      candidateField:
        candidate.id,

      windowId:
        window.id,

      targetPositiveDelta:
        0,

      creditedPositiveDelta:
        0,

      sameTeamPositiveDelta:
        0,

      opponentPositiveDelta:
        0,

      sameTeamPositivePlayers:
        [],

      opponentPositivePlayers:
        [],

      deltaEvents:
        []
    };
  }


  const events =
    collectDeltaEvents({

      anchorTick,

      before:
        window.before,

      after:
        window.after,

      source:
        candidate.source,

      fieldName:
        candidate.fieldName
    });


  const positiveByPlayer =
    new Map();


  for (
    const event
    of events
  ) {

    if (
      event.delta <=
      0
    ) {

      continue;
    }


    if (
      !positiveByPlayer.has(
        event.playerName
      )
    ) {

      positiveByPlayer.set(
        event.playerName,
        {

          playerName:
            event.playerName,

          team:
            event.team,

          positiveDelta:
            0,

          events:
            []
        }
      );
    }


    const player =
      positiveByPlayer.get(
        event.playerName
      );


    player.positiveDelta +=
      event.delta;


    player.events.push({

      tick:
        event.tick,

      tickOffset:
        event.tick -
        anchorTick,

      delta:
        event.delta
    });
  }


  const players =
    [
      ...positiveByPlayer.values()
    ]
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


  const sameTeamPositivePlayers =
    players.filter(
      player =>
        row.creditedTeam !==
          null
        &&
        player.team ===
        row.creditedTeam
    );


  const opponentPositivePlayers =
    players.filter(
      player =>
        row.creditedTeam !==
          null
        &&
        player.team !==
        row.creditedTeam
    );


  const targetPositiveDelta =
    row.targetPlayerName
      ? positiveByPlayer.get(
          row.targetPlayerName
        )
        ?.positiveDelta ??
        0
      : 0;


  const creditedPositiveDelta =
    row.creditedPlayerName
      ? positiveByPlayer.get(
          row.creditedPlayerName
        )
        ?.positiveDelta ??
        0
      : 0;


  return {

    anchorTick,

    candidateField:
      candidate.id,

    windowId:
      window.id,

    targetPositiveDelta,

    creditedPositiveDelta,

    sameTeamPositiveDelta:
      sameTeamPositivePlayers.reduce(
        (
          sum,
          player
        ) =>
          sum +
          player.positiveDelta,
        0
      ),

    opponentPositiveDelta:
      opponentPositivePlayers.reduce(
        (
          sum,
          player
        ) =>
          sum +
          player.positiveDelta,
        0
      ),

    sameTeamPositivePlayers,

    opponentPositivePlayers,

    deltaEvents:
      events.map(
        event => ({

          tick:
            event.tick,

          tickOffset:
            event.tick -
            anchorTick,

          playerName:
            event.playerName,

          team:
            event.team,

          delta:
            event.delta
        })
      )
  };
}


// ============================================================
// TIMING ANALYSIS
// ============================================================

function buildTimingAnalysis(
  cohort,
  candidate
) {

  const targetVsOnset =
    [];


  const targetVsInactive =
    [];


  const creditedVsOnset =
    [];


  const creditedVsInactive =
    [];


  let targetWithPositiveNearby =
    0;


  let creditedWithPositiveNearby =
    0;


  for (
    const row
    of cohort
  ) {

    const measurement =
      measureTimingForCase(
        row,
        candidate
      );


    if (
      measurement
        .targetNearestPositiveFromOnsetTicks !==
      null
    ) {

      targetWithPositiveNearby++;


      targetVsOnset.push(
        measurement
          .targetNearestPositiveFromOnsetTicks
      );
    }


    if (
      measurement
        .targetNearestPositiveFromInactiveTicks !==
      null
    ) {

      targetVsInactive.push(
        measurement
          .targetNearestPositiveFromInactiveTicks
      );
    }


    if (
      measurement
        .creditedNearestPositiveFromOnsetTicks !==
      null
    ) {

      creditedWithPositiveNearby++;


      creditedVsOnset.push(
        measurement
          .creditedNearestPositiveFromOnsetTicks
      );
    }


    if (
      measurement
        .creditedNearestPositiveFromInactiveTicks !==
      null
    ) {

      creditedVsInactive.push(
        measurement
          .creditedNearestPositiveFromInactiveTicks
      );
    }
  }


  return {

    candidate,

    cohortCount:
      cohort.length,

    targetWithPositiveNearby,

    targetWithPositiveNearbyRate:
      rate(
        targetWithPositiveNearby,
        cohort.length
      ),

    creditedWithPositiveNearby,

    creditedWithPositiveNearbyRate:
      rate(
        creditedWithPositiveNearby,
        cohort.length
      ),

    targetNearestPositiveFromOnsetTicks:
      summarizeNumbers(
        targetVsOnset
      ),

    targetNearestPositiveFromOnsetSeconds:
      summarizeNumbers(
        targetVsOnset.map(
          value =>
            value /
            TICK_RATE
        )
      ),

    targetNearestPositiveFromInactiveTicks:
      summarizeNumbers(
        targetVsInactive
      ),

    targetNearestPositiveFromInactiveSeconds:
      summarizeNumbers(
        targetVsInactive.map(
          value =>
            value /
            TICK_RATE
        )
      ),

    creditedNearestPositiveFromOnsetTicks:
      summarizeNumbers(
        creditedVsOnset
      ),

    creditedNearestPositiveFromInactiveTicks:
      summarizeNumbers(
        creditedVsInactive
      )
  };
}


function measureTimingForCase(
  row,
  candidate
) {

  const result = {

    targetNearestPositiveFromOnsetTicks:
      null,

    targetNearestPositiveFromInactiveTicks:
      null,

    creditedNearestPositiveFromOnsetTicks:
      null,

    creditedNearestPositiveFromInactiveTicks:
      null
  };


  if (
    row.targetOnsetTick !==
    null
  ) {

    const events =
      collectDeltaEvents({

        anchorTick:
          row.targetOnsetTick,

        before:
          TIMING_SEARCH_BEFORE_TICKS,

        after:
          TIMING_SEARCH_AFTER_TICKS,

        source:
          candidate.source,

        fieldName:
          candidate.fieldName
      });


    result
      .targetNearestPositiveFromOnsetTicks =
      nearestPositiveOffset(
        events,
        row.targetPlayerName,
        row.targetOnsetTick
      );


    result
      .creditedNearestPositiveFromOnsetTicks =
      nearestPositiveOffset(
        events,
        row.creditedPlayerName,
        row.targetOnsetTick
      );
  }


  if (
    row.activeFalseTick !==
    null
  ) {

    const events =
      collectDeltaEvents({

        anchorTick:
          row.activeFalseTick,

        before:
          TIMING_SEARCH_BEFORE_TICKS,

        after:
          TIMING_SEARCH_AFTER_TICKS,

        source:
          candidate.source,

        fieldName:
          candidate.fieldName
      });


    result
      .targetNearestPositiveFromInactiveTicks =
      nearestPositiveOffset(
        events,
        row.targetPlayerName,
        row.activeFalseTick
      );


    result
      .creditedNearestPositiveFromInactiveTicks =
      nearestPositiveOffset(
        events,
        row.creditedPlayerName,
        row.activeFalseTick
      );
  }


  return result;
}


function nearestPositiveOffset(
  events,
  playerName,
  anchorTick
) {

  if (
    !playerName
  ) {

    return null;
  }


  const matching =
    events
      .filter(
        event =>
          event.playerName ===
            playerName
          &&
          event.delta >
          0
      )
      .map(
        event =>
          event.tick -
          anchorTick
      );


  if (
    matching.length ===
    0
  ) {

    return null;
  }


  matching.sort(
    (
      a,
      b
    ) =>
      Math.abs(
        a
      )
      -
      Math.abs(
        b
      )
  );


  return matching[0];
}


// ============================================================
// DELTA QUERY
// ============================================================

function collectDeltaEvents({
  anchorTick,
  before,
  after,
  source,
  fieldName
}) {

  const minTick =
    anchorTick -
    before;


  const maxTick =
    anchorTick +
    after;


  const startIndex =
    lowerBoundTick(
      deltaEvents,
      minTick
    );


  const output =
    [];


  for (
    let i = startIndex;
    i <
    deltaEvents.length;
    i++
  ) {

    const event =
      deltaEvents[i];


    if (
      event.tick >
      maxTick
    ) {

      break;
    }


    if (
      event.source !==
      source
      ||
      event.fieldName !==
      fieldName
    ) {

      continue;
    }


    output.push(
      event
    );
  }


  return output;
}


function lowerBoundTick(
  rows,
  tick
) {

  let low =
    0;


  let high =
    rows.length;


  while (
    low <
    high
  ) {

    const middle =
      Math.floor(
        (
          low +
          high
        )
        /
        2
      );


    if (
      rows[middle].tick <
      tick
    ) {

      low =
        middle +
        1;

    } else {

      high =
        middle;
    }
  }


  return low;
}


// ============================================================
// ANCHOR
// ============================================================

function getAnchorTick(
  row,
  anchorType
) {

  if (
    anchorType ===
    'TARGET_ONSET'
  ) {

    return row.targetOnsetTick;
  }


  if (
    anchorType ===
    'ACTIVE_FALSE'
  ) {

    return row.activeFalseTick;
  }


  return null;
}


// ============================================================
// FIELD COVERAGE
// ============================================================

const fieldCoverage =
  {};


for (
  const [
    fieldName,
    stats
  ]
  of fieldStats.entries()
) {

  fieldCoverage[
    fieldName
  ] = {

    readAttempts:
      stats.readAttempts,

    finiteReads:
      stats.finiteReads,

    nonzeroDeltas:
      stats.nonzeroDeltas,

    positiveDeltas:
      stats.positiveDeltas,

    negativeDeltas:
      stats.negativeDeltas,

    players:
      stats.players.size
  };
}


// ============================================================
// VALIDATION
// ============================================================

const observedCandidateFields =
  candidateFields.filter(
    candidate =>
      (
        fieldStats
          .get(
            candidate.fieldName
          )
          ?.nonzeroDeltas ??
        0
      ) >
      0
  );


const validationChecks =
  {

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


    classifiedCount:
      check(
        lifecycleRows.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? lifecycleRows.length ===
            991
          : lifecycleRows.length >
            0
      ),


    targetedCount:
      check(
        targeted.length,
        replayName ===
          'test'
          ? 947
          : '>0',
        replayName ===
          'test'
          ? targeted.length ===
            947
          : targeted.length >
            0
      ),


    stableTargetCount:
      check(
        stableTargeted.length,
        replayName ===
          'test'
          ? 131
          : '>0',
        replayName ===
          'test'
          ? stableTargeted.length ===
            131
          : stableTargeted.length >
            0
      ),


    targetlessCount:
      check(
        targetless.length,
        replayName ===
          'test'
          ? 44
          : '>=0',
        replayName ===
          'test'
          ? targetless.length ===
            44
          : true
      ),


    targetlessInactiveCount:
      check(
        targetlessWithInactive.length,
        replayName ===
          'test'
          ? 43
          : '>=0',
        replayName ===
          'test'
          ? targetlessWithInactive.length ===
            43
          : true
      ),


    playerCount:
      check(
        identity.players.length,
        replayName ===
          'test'
          ? 12
          : '>0',
        replayName ===
          'test'
          ? identity.players.length ===
            12
          : identity.players.length >
            0
      ),


    controllerIdentityCoverage:
      check(
        identity
          .playerByControllerIndex
          .size,
        identity.players.length,
        identity
          .playerByControllerIndex
          .size ===
        identity.players.length
      ),


    primaryStableCohort:
      check(
        primaryTargeted.length,
        '>=40',
        primaryTargeted.length >=
        40
      ),


    candidateEconomicFieldsObserved:
      check(
        observedCandidateFields.length,
        '>0',
        observedCandidateFields.length >
        0
      ),


    calibrationPresent:
      check(
        calibration.length,
        '>0',
        calibration.length >
        0
      ),


    holdoutPresent:
      check(
        holdout.length,
        '>0',
        holdout.length >
        0
      ),


    bestCandidateResolved:
      check(
        Boolean(
          bestOverall
        ),
        true,
        Boolean(
          bestOverall
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
      'ASSIGNED_GOLD_ECONOMIC_RECIPIENT_DISCOVERY_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'ECONOMIC_RECIPIENT_FIELD_DISCOVERY_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Determine which player economy telemetry changes around AssignedGold collection.',

        'Test whether m_hVacuumTarget corresponds to an economic recipient rather than only a physical vacuum target.',

        'Compare m_hVacuumTarget with the credited last-hitter when those identities differ.',

        'Discover whether ground-soul resolution can economically credit multiple allied players.',

        'Compare controller m_iGoldNetWorth with pawn m_nCurrencies.0000 through .0005.',

        'Use stable delayed floor souls as the cleanest primary discovery cohort.',

        'Use targetless match-time-scaled timeout cases as negative controls for active=false-associated economy changes.'
      ],


    semanticLimits:
      {

        recipient:
          'A positive economy-field delta near collection is observational evidence of recipient attribution. This script does not yet promote any field to canonical ground-soul payout telemetry.',

        amount:
          'Observed deltas may include batched or unrelated economy. Do not yet interpret a delta magnitude as exact ground-soul value.',

        target:
          'm_hVacuumTarget remains an observed vacuum-lifecycle target until economic correspondence is demonstrated.',

        targetless:
          'Targetless timeout cases are negative controls, but unrelated economy can still occur in their temporal windows.',

        isolation:
          'The 16-tick AssignedGold isolation filter removes nearby ground-soul terminations, not every other economic event in the game.'
      },


    sourceCounts:
      {

        classifiedLifecycleCases:
          lifecycleRows.length,

        targeted:
          targeted.length,

        stableTargeted:
          stableTargeted.length,

        targetless:
          targetless.length,

        targetlessWithInactive:
          targetlessWithInactive.length,

        primaryTargeted:
          primaryTargeted.length,

        primaryTargetlessControls:
          primaryTargetlessControls.length,

        calibration:
          calibration.length,

        holdout:
          holdout.length,

        players:
          identity.players.length,

        controllerIndexes:
          identity
            .playerByControllerIndex
            .size,

        pawnIndexes:
          identity
            .playerByPawnIndex
            .size,

        ambiguousPawnIndexes:
          identity
            .ambiguousPawnIndexes
            .size
      },


    rawTelemetry:
      {

        entityPackets,

        controllerEntityEvents,

        pawnEntityEvents,

        totalDeltaEvents:
          deltaEvents.length,

        fieldCoverage
      },


    discoveryCohort:
      {

        label:
          primaryCohortLabel,

        isolationRadiusTicks:
          ISOLATION_RADIUS_TICKS,

        isolationRadiusSeconds:
          ISOLATION_RADIUS_TICKS /
          TICK_RATE
      },


    candidateRanking:
      rankingRows.map(
        compactRanking
      ),


    bestOverall:
      bestOverall
        ? {

          discovery:
            compactRanking(
              bestOverall
            ),

          holdout:
            holdoutBestOverall,

          allPrimary:
            primaryBest,

          targetVsCreditedMismatch:
            primaryBestMismatch,

          timing:
            bestTiming
        }
        : null,


    bestTargetOnset:
      bestTargetOnset
        ? {

          discovery:
            compactRanking(
              bestTargetOnset
            ),

          holdout:
            holdoutBestTargetOnset
        }
        : null,


    bestActiveFalse:
      bestActiveFalse
        ? {

          discovery:
            compactRanking(
              bestActiveFalse
            ),

          holdout:
            holdoutBestActiveFalse,

          targetlessControls:
            holdoutTargetlessBestActiveFalse
        }
        : null,


    interpretationGuide:
      {

        targetRecipientSupport:
          'Strong support would be a high target-positive rate in calibration and holdout, especially when m_hVacuumTarget differs from the credited last-hitter.',

        creditedRecipientSupport:
          'If credited-only positive deltas dominate target-only deltas when identities differ, economic ownership is more likely tied to the last-hitter than the physical vacuum target.',

        multiRecipientSupport:
          'If multiple same-team players repeatedly receive positive deltas in the same narrow window, ground-soul collection may trigger shared economic credit rather than one-player-only payout.',

        currencyBucketSupport:
          'If one m_nCurrencies.* bucket produces a much cleaner time-locked signal than m_iGoldNetWorth, that bucket becomes the preferred candidate for exact reward-value work.',

        targetlessNoPayoutSupport:
          'If the best active=false economic signal is common in targeted cases but rare at targetless timeout active=false events, the targetless termination is consistent with no payout.',

        next:
          'Use the strongest independently held-out field/window and mismatch pattern in Script 89 to validate economic recipient identity and then estimate exact ground-soul reward amount.'
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
// WRITE OUTPUTS
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


const caseWriter =
  createWriteStream(
    outputCasesPath,
    {
      encoding:
        'utf8'
    }
  );


for (
  const row
  of outputCases
) {

  caseWriter.write(
    `${JSON.stringify(row)}\n`
  );
}


await finishWriter(
  caseWriter
);


// ============================================================
// CONSOLE REPORT
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD ECONOMIC RECIPIENT DISCOVERY V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'RAW ECONOMY FIELD COVERAGE'
);

console.log(
  '--------------------------'
);


for (
  const candidate
  of candidateFields
) {

  const stats =
    fieldCoverage[
      candidate.fieldName
    ];


  console.log(

    `${candidate.id.padEnd(38)} ` +

    `deltas=${String(stats.nonzeroDeltas).padStart(7)} ` +

    `positive=${String(stats.positiveDeltas).padStart(7)} ` +

    `negative=${String(stats.negativeDeltas).padStart(7)} ` +

    `players=${stats.players}`
  );
}


console.log('');

console.log(
  'PRIMARY DISCOVERY COHORT'
);

console.log(
  '------------------------'
);


console.log(
  `Cohort:                  ${primaryCohortLabel}`
);


console.log(
  `Stable targeted cases:   ${primaryTargeted.length}`
);


console.log(
  `Calibration / holdout:   ${calibration.length} / ${holdout.length}`
);


console.log(
  `Targetless controls:     ${primaryTargetlessControls.length}`
);


console.log('');

console.log(
  'TOP 15 FIELD / WINDOW CANDIDATES'
);

console.log(
  '--------------------------------'
);


for (
  const row
  of rankingRows.slice(
    0,
    15
  )
) {

  console.log(

    `${row.candidate.id.padEnd(38)} ` +

    `${row.window.id.padEnd(27)} ` +

    `score=${formatNumber(row.score).padStart(7)} ` +

    `target=${formatPercent(row.calibration.targetPositiveRate).padStart(8)} ` +

    `credited=${formatPercent(row.calibration.creditedPositiveRate).padStart(8)} ` +

    `sameTeam=${formatPercent(row.calibration.anySameTeamPositiveRate).padStart(8)} ` +

    `opp=${formatPercent(row.calibration.anyOpponentPositiveRate).padStart(8)} ` +

    `timeout=${formatPercent(
      row.targetlessControls
        ?.anyCreditedTeamPositiveRate
    ).padStart(8)}`
  );
}


if (
  bestOverall
) {

  console.log('');

  console.log(
    'BEST OVERALL CANDIDATE'
  );

  console.log(
    '----------------------'
  );


  console.log(
    `Field:   ${bestOverall.candidate.id}`
  );


  console.log(
    `Window:  ${bestOverall.window.id}`
  );


  console.log(
    `Score:   ${formatNumber(bestOverall.score)}`
  );


  console.log('');

  console.log(
    'CALIBRATION'
  );


  printTargetEvaluation(
    bestOverall.calibration
  );


  console.log('');

  console.log(
    'HOLDOUT'
  );


  printTargetEvaluation(
    holdoutBestOverall
  );


  console.log('');

  console.log(
    'ALL PRIMARY STABLE CASES'
  );


  printTargetEvaluation(
    primaryBest
  );


  console.log('');

  console.log(
    'TARGET != CREDITED PLAYER'
  );

  console.log(
    '-------------------------'
  );


  if (
    primaryBestMismatch
  ) {

    console.log(
      `Cases:          ${primaryBestMismatch.count}`
    );


    console.log(
      `Target positive:${String(primaryBestMismatch.targetPositive).padStart(5)} (${formatPercent(primaryBestMismatch.targetPositiveRate)})`
    );


    console.log(
      `Credited pos.:  ${String(primaryBestMismatch.creditedPositive).padStart(5)} (${formatPercent(primaryBestMismatch.creditedPositiveRate)})`
    );


    console.log(
      `Target only:    ${primaryBestMismatch.targetOnly}`
    );


    console.log(
      `Credited only:  ${primaryBestMismatch.creditedOnly}`
    );


    console.log(
      `Both:           ${primaryBestMismatch.both}`
    );


    console.log(
      `Neither:        ${primaryBestMismatch.neither}`
    );
  }


  console.log('');

  console.log(
    'BEST FIELD TIMING'
  );

  console.log(
    '-----------------'
  );


  console.log(
    `Target positive nearby: ${bestTiming.targetWithPositiveNearby}/${bestTiming.cohortCount} (${formatPercent(bestTiming.targetWithPositiveNearbyRate)})`
  );


  console.log(
    `Target delta vs onset:   ${formatDistribution(bestTiming.targetNearestPositiveFromOnsetTicks)} ticks`
  );


  console.log(
    `Target delta vs inactive:${formatDistribution(bestTiming.targetNearestPositiveFromInactiveTicks)} ticks`
  );


  console.log(
    `Target seconds vs onset: ${formatDistribution(bestTiming.targetNearestPositiveFromOnsetSeconds)}`
  );


  console.log(
    `Target seconds vs inactive: ${formatDistribution(bestTiming.targetNearestPositiveFromInactiveSeconds)}`
  );
}


if (
  bestActiveFalse
) {

  console.log('');

  console.log(
    'BEST ACTIVE=FALSE CANDIDATE VS TARGETLESS CONTROLS'
  );

  console.log(
    '-----------------------------------------------'
  );


  console.log(
    `${bestActiveFalse.candidate.id} / ${bestActiveFalse.window.id}`
  );


  console.log(
    `Holdout target-positive: ${formatPercent(holdoutBestActiveFalse?.targetPositiveRate)}`
  );


  console.log(
    `Timeout team-positive:   ${formatPercent(holdoutTargetlessBestActiveFalse?.anyCreditedTeamPositiveRate)}`
  );
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
// PRINT TARGET EVALUATION
// ============================================================

function printTargetEvaluation(
  row
) {

  if (
    !row
  ) {

    console.log(
      'n/a'
    );

    return;
  }


  console.log(
    `Cases:                   ${row.count}`
  );


  console.log(
    `Target positive:         ${row.targetPositive}/${row.count} (${formatPercent(row.targetPositiveRate)})`
  );


  console.log(
    `Credited positive:       ${row.creditedPositive}/${row.count} (${formatPercent(row.creditedPositiveRate)})`
  );


  console.log(
    `Any same-team positive:  ${row.anySameTeamPositive}/${row.count} (${formatPercent(row.anySameTeamPositiveRate)})`
  );


  console.log(
    `Any opponent positive:   ${row.anyOpponentPositive}/${row.count} (${formatPercent(row.anyOpponentPositiveRate)})`
  );


  console.log(
    `Target among recipients: ${row.targetAmongPositivePlayers}/${row.count} (${formatPercent(row.targetAmongPositivePlayersRate)})`
  );


  console.log(
    `Target only recipient:   ${row.targetOnlyPositivePlayer}/${row.count} (${formatPercent(row.targetOnlyPositivePlayerRate)})`
  );


  console.log(
    `Multiple same-team:      ${row.multipleSameTeamPositive}/${row.count} (${formatPercent(row.multipleSameTeamPositiveRate)})`
  );


  console.log(
    `Target positive delta:   ${formatDistribution(row.targetPositiveDelta)}`
  );


  console.log(
    `Credited positive delta: ${formatDistribution(row.creditedPositiveDelta)}`
  );
}


// ============================================================
// COMPACT RANKING
// ============================================================

function compactRanking(
  row
) {

  return {

    candidate:
      row.candidate,

    window:
      row.window,

    score:
      row.score,

    calibration:
      row.calibration,

    targetlessControls:
      row.targetlessControls
  };
}


// ============================================================
// PLAYER IDENTITY
// ============================================================

async function loadPlayerIdentity(
  path
) {

  const playerByControllerIndex =
    new Map();


  const pawnNamesByIndex =
    new Map();


  const playersByName =
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


    const controller =
      row?.controller ??
      null;


    if (
      !controller
    ) {

      continue;
    }


    const playerName =
      controller.playerName ??
      null;


    if (
      !playerName
      ||
      playerName ===
      'SourceTV'
    ) {

      continue;
    }


    const controllerIndex =
      finite(
        controller.entityIndex
      );


    const team =
      finite(
        controller.team
      );


    const heroId =
      finite(
        controller.heroId
      );


    const identity = {

      playerName:
        String(
          playerName
        ),

      team,

      heroId,

      controllerEntityIndex:
        controllerIndex,

      pawnEntityIndex:
        finite(
          row
            ?.pawn
            ?.entityIndex
        )
    };


    if (
      !playersByName.has(
        identity.playerName
      )
    ) {

      playersByName.set(
        identity.playerName,
        identity
      );

    } else {

      const old =
        playersByName.get(
          identity.playerName
        );


      playersByName.set(
        identity.playerName,
        {

          ...old,

          team:
            old.team ??
            identity.team,

          heroId:
            old.heroId ??
            identity.heroId,

          controllerEntityIndex:
            old.controllerEntityIndex ??
            identity.controllerEntityIndex,

          pawnEntityIndex:
            old.pawnEntityIndex ??
            identity.pawnEntityIndex
        }
      );
    }


    if (
      controllerIndex !==
      null
    ) {

      playerByControllerIndex.set(
        controllerIndex,
        identity
      );
    }


    const pawnIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );


    if (
      pawnIndex !==
      null
    ) {

      if (
        !pawnNamesByIndex.has(
          pawnIndex
        )
      ) {

        pawnNamesByIndex.set(
          pawnIndex,
          new Set()
        );
      }


      pawnNamesByIndex
        .get(
          pawnIndex
        )
        .add(
          identity.playerName
        );
    }
  }


  const ambiguousPawnIndexes =
    new Set();


  const playerByPawnIndex =
    new Map();


  for (
    const [
      pawnIndex,
      names
    ]
    of pawnNamesByIndex.entries()
  ) {

    if (
      names.size !==
      1
    ) {

      ambiguousPawnIndexes.add(
        pawnIndex
      );

      continue;
    }


    const playerName =
      [
        ...names
      ][0];


    const identity =
      playersByName.get(
        playerName
      );


    if (
      identity
    ) {

      playerByPawnIndex.set(
        pawnIndex,
        identity
      );
    }
  }


  return {

    players:
      [
        ...playersByName.values()
      ]
      .sort(
        (
          a,
          b
        ) =>
          (
            a.team ??
            999
          )
          -
          (
            b.team ??
            999
          )
          ||
          a.playerName.localeCompare(
            b.playerName
          )
      ),

    playerByControllerIndex,

    playerByPawnIndex,

    ambiguousPawnIndexes
  };
}


// ============================================================
// RAW ENTITY HELPERS
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
// GENERIC NUMERIC HELPERS
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