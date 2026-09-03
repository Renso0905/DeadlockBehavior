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


const SEARCH_MIN_HU =
  100;


const SEARCH_MAX_HU =
  4000;


const SEARCH_STEP_HU =
  10;


// ============================================================
// STANDARD THRESHOLDS
// ============================================================

const STANDARD_THRESHOLDS_HU = [
  500,
  750,
  1000,
  1250,
  1500,
  1750,
  2000,
  2250,
  2500,
  2750,
  3000,
  3500,
  4000
];


// ============================================================
// COMPETING RECIPIENT-SELECTION MODELS
//
// The economic outcome is already known:
//
//   exact same-tick m_nCurrencies.0000 recipient set
//
// We now ask WHICH spatial state best predicts that set.
//
// Credited last-hitter is always modeled separately:
//
//   predicted recipient set =
//       credited player
//       +
//       qualifying non-credited allies
//
// because Scripts 89-91 strongly support a privileged economic
// role for the credited last-hitter.
//
// ------------------------------------------------------------
//
// MODEL A
//
//   DEATH_TROOPER_CENTERED
//
//   Position of each ally relative to the Trooper when it dies.
//
// ------------------------------------------------------------
//
// MODEL B
//
//   TARGET_ONSET_SOUL_CENTERED
//
//   Position of each ally relative to the current AssignedGold
//   soul when m_hVacuumTarget first becomes a player.
//
// ------------------------------------------------------------
//
// MODEL C
//
//   TARGET_ONSET_COLLECTOR_CENTERED
//
//   Position of each ally relative to the physical vacuum-target
//   player when m_hVacuumTarget first becomes a player.
//
// ------------------------------------------------------------
//
// MODEL D
//
//   ACTIVE_FALSE_SOUL_CENTERED
//
//   Position of each ally relative to the AssignedGold entity at
//   the exact economic-resolution tick.
//
// ------------------------------------------------------------
//
// MODEL E
//
//   ACTIVE_FALSE_COLLECTOR_CENTERED
//
//   Position of each ally relative to the physical vacuum-target
//   player at the exact economic-resolution tick.
//
// ------------------------------------------------------------
//
// This directly distinguishes:
//
//   "near the dying Trooper"
//
// from:
//
//   "near the person who later vacuumed the soul"
//
// without assuming either mechanic.
// ============================================================

const MODEL_DEFINITIONS = [

  {
    id:
      'DEATH_TROOPER_CENTERED',

    anchor:
      'DEATH',

    center:
      'TROOPER_DEATH_POSITION'
  },

  {
    id:
      'TARGET_ONSET_SOUL_CENTERED',

    anchor:
      'TARGET_ONSET',

    center:
      'SOUL_POSITION'
  },

  {
    id:
      'TARGET_ONSET_COLLECTOR_CENTERED',

    anchor:
      'TARGET_ONSET',

    center:
      'VACUUM_TARGET_POSITION'
  },

  {
    id:
      'ACTIVE_FALSE_SOUL_CENTERED',

    anchor:
      'ACTIVE_FALSE',

    center:
      'SOUL_POSITION'
  },

  {
    id:
      'ACTIVE_FALSE_COLLECTOR_CENTERED',

    anchor:
      'ACTIVE_FALSE',

    center:
      'VACUUM_TARGET_POSITION'
  }
];


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const summary91Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_integer_sharing_reward_validation_v01.json'
  );


const cases91Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_integer_sharing_reward_cases_v01.jsonl'
  );


const cases90Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_reward_sharing_cases_v01.jsonl'
  );


const cases87Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classified_v01.jsonl'
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_share_recipient_geometry_comparison_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_share_recipient_geometry_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    summary91Path,
    cases91Path,
    cases90Path,
    cases87Path,
    episodes75Path
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
// LOAD SCRIPT 91 SUMMARY
// ============================================================

const summary91 =
  JSON.parse(
    readFileSync(
      summary91Path,
      'utf8'
    )
  );


if (
  summary91
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 91 did not PASS.'
  );
}


// ============================================================
// LOAD STREAMS
// ============================================================

console.log('');

console.log(
  'Loading Script 91 cases...'
);


const cases91 =
  await loadJsonl(
    cases91Path
  );


console.log(
  `Script 91 cases: ${cases91.length}`
);


console.log(
  'Loading Script 90 recipient cases...'
);


const cases90 =
  await loadJsonl(
    cases90Path
  );


console.log(
  `Script 90 cases: ${cases90.length}`
);


console.log(
  'Loading Script 87 lifecycle cases...'
);


const cases87 =
  await loadJsonl(
    cases87Path
  );


console.log(
  `Script 87 cases: ${cases87.length}`
);


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


// ============================================================
// INDEX SOURCES
// ============================================================

const case90ByDeath =
  indexByDeathIndex(
    cases90
  );


const case87ByDeath =
  indexByDeathIndex(
    cases87
  );


const episode75ByDeath =
  indexByDeathIndex(
    episodes75
  );


// ============================================================
// PRIMARY ECONOMIC COHORT
//
// Script91:
//
//   primaryClean
//   integerShare.partitionExact
//
// This gave 85 clean reconstructed reward events in test.dem.
// ============================================================

const primary91 =
  cases91.filter(
    row =>
      row?.primaryClean ===
        true
      &&
      row
        ?.integerShare
        ?.partitionExact ===
        true
  );


console.log('');

console.log(
  `Primary partition-exact cases: ${primary91.length}`
);


// ============================================================
// BUILD CASES
// ============================================================

const cases =
  [];


for (
  const source91
  of primary91
) {

  const deathIndex =
    finite(
      source91?.deathIndex
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


  const source87 =
    case87ByDeath.get(
      deathIndex
    )
    ??
    null;


  const source75 =
    episode75ByDeath.get(
      deathIndex
    )
    ??
    null;


  if (
    !source90
    ||
    !source87
    ||
    !source75
  ) {

    continue;
  }


  const deathTick =
    finite(
      source75
        ?.death
        ?.tick
    );


  const targetOnsetTick =
    finite(
      source87
        ?.vacuum
        ?.targetOnsetTick
    );


  const activeFalseTick =
    finite(
      source87
        ?.termination
        ?.activeFalseTick
    );


  const deathPosition =
    normalizePosition(
      source75
        ?.death
        ?.position
    );


  const groundSoulEntityIndex =
    firstFinite([
      source87
        ?.groundSoul
        ?.entityIndex,

      source75
        ?.assignedGold
        ?.entityIndex
    ]);


  const creditedPlayerName =
    source90
      ?.creditedPlayerName ??
    source87
      ?.creditedPlayer
      ?.playerName ??
    null;


  const creditedTeam =
    firstFinite([
      source90
        ?.creditedTeam,

      source87
        ?.creditedPlayer
        ?.team,

      source75
        ?.creditedPlayer
        ?.team
    ]);


  const targetPlayerName =
    source90
      ?.targetPlayerName ??
    source87
      ?.vacuum
      ?.targetPlayerName ??
    null;


  const recipients =
    normalizeRecipients(
      source90
        ?.sameTeamRecipients
    );


  if (
    deathTick ===
      null
    ||
    targetOnsetTick ===
      null
    ||
    activeFalseTick ===
      null
    ||
    !deathPosition
    ||
    groundSoulEntityIndex ===
      null
    ||
    !creditedPlayerName
    ||
    creditedTeam ===
      null
    ||
    !targetPlayerName
    ||
    recipients.length ===
      0
  ) {

    continue;
  }


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      source91?.clock ??
      source90?.clock ??
      source87?.clock ??
      null,

    baseType:
      source91?.baseType ??
      source87
        ?.trooper
        ?.baseType ??
      source75
        ?.death
        ?.baseType ??
      null,

    variantLabel:
      source91?.variantLabel ??
      source87
        ?.trooper
        ?.variantLabel ??
      source75
        ?.death
        ?.variantLabel ??
      null,

    matchMinute:
      finite(
        source91
          ?.matchMinute
      ),

    teamTotal:
      finite(
        source91
          ?.teamTotal
      ),

    deathTick,

    targetOnsetTick,

    activeFalseTick,

    deathPosition,

    groundSoulEntityIndex,

    creditedPlayerName,

    creditedTeam,

    targetPlayerName,

    targetDiffersFromCredited:
      targetPlayerName !==
      creditedPlayerName,

    actualRecipients:
      recipients,

    actualRecipientNames:
      new Set(
        recipients.map(
          row =>
            row.playerName
        )
      ),

    actualRecipientCount:
      recipients.length,

    anchors: {

      DEATH:
        null,

      TARGET_ONSET:
        null,

      ACTIVE_FALSE:
        null
    }
  });
}


// ============================================================
// BUILD RAW-TICK REQUEST MAP
// ============================================================

const requestsByTick =
  new Map();


for (
  const row
  of cases
) {

  addRequest(
    row.deathTick,
    row,
    'DEATH'
  );


  addRequest(
    row.targetOnsetTick,
    row,
    'TARGET_ONSET'
  );


  addRequest(
    row.activeFalseTick,
    row,
    'ACTIVE_FALSE'
  );
}


function addRequest(
  tick,
  row,
  anchor
) {

  if (
    !requestsByTick.has(
      tick
    )
  ) {

    requestsByTick.set(
      tick,
      []
    );
  }


  requestsByTick
    .get(
      tick
    )
    .push({

      row,

      anchor
    });
}


// ============================================================
// RAW REPLAY RESCAN
// ============================================================

let demoPackets =
  0;


let relevantPackets =
  0;


let anchorSnapshots =
  0;


console.log('');

console.log(
  'Rescanning exact death / target-onset / active=false ticks...'
);

console.log('');


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


    demoPackets++;


    const requests =
      requestsByTick.get(
        tick
      );


    if (
      !requests
      ||
      requests.length ===
      0
    ) {

      return;
    }


    relevantPackets++;


    const demo =
      parser.getDemo();


    const players =
      collectCurrentPlayers(
        demo
      );


    const soulPositions =
      collectAssignedGoldPositions(
        demo
      );


    for (
      const request
      of requests
    ) {

      const row =
        request.row;


      const alliedPlayers =
        players.filter(
          player =>
            player.team ===
            row.creditedTeam
        );


      const targetPlayer =
        alliedPlayers.find(
          player =>
            player.playerName ===
            row.targetPlayerName
        )
        ??
        null;


      row.anchors[
        request.anchor
      ] = {

        tick,

        alliedPlayers,

        soulPosition:
          soulPositions.get(
            row.groundSoulEntityIndex
          )
          ??
          null,

        vacuumTargetPosition:
          targetPlayer
            ?.position ??
          null,

        vacuumTargetAlive:
          targetPlayer
            ?.alive ??
          null
      };


      anchorSnapshots++;
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
// ANCHOR COVERAGE
// ============================================================

const anchorCoverage =
  {};


for (
  const anchor
  of [
    'DEATH',
    'TARGET_ONSET',
    'ACTIVE_FALSE'
  ]
) {

  const snapshots =
    cases.filter(
      row =>
        Boolean(
          row.anchors[
            anchor
          ]
        )
    );


  const targetPositions =
    snapshots.filter(
      row =>
        Boolean(
          row
            .anchors[
              anchor
            ]
            ?.vacuumTargetPosition
        )
    );


  const soulPositions =
    snapshots.filter(
      row =>
        Boolean(
          row
            .anchors[
              anchor
            ]
            ?.soulPosition
        )
    );


  anchorCoverage[
    anchor
  ] = {

    snapshotCases:
      snapshots.length,

    targetPositionCases:
      targetPositions.length,

    soulPositionCases:
      soulPositions.length
  };
}


// ============================================================
// MODEL DATASETS
// ============================================================

const modelDatasets =
  {};


for (
  const model
  of MODEL_DEFINITIONS
) {

  modelDatasets[
    model.id
  ] =
    buildModelDataset(
      model
    );
}


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const modelResults =
  [];


for (
  const model
  of MODEL_DEFINITIONS
) {

  const dataset =
    modelDatasets[
      model.id
    ];


  for (
    const distanceField
    of [
      'distanceXY',
      'distance3D'
    ]
  ) {

    const search =
      [];


    for (
      let threshold =
        SEARCH_MIN_HU;

      threshold <=
        SEARCH_MAX_HU;

      threshold +=
        SEARCH_STEP_HU
    ) {

      search.push(
        evaluateThreshold(
          dataset,
          threshold,
          distanceField
        )
      );
    }


    const bestMCC =
      selectBest(
        search,
        'mcc'
      );


    const bestBalanced =
      selectBest(
        search,
        'balancedAccuracy'
      );


    const bestExactSet =
      selectBest(
        search,
        'exactRecipientSetRate'
      );


    const standard =
      STANDARD_THRESHOLDS_HU.map(
        threshold =>
          evaluateThreshold(
            dataset,
            threshold,
            distanceField
          )
      );


    modelResults.push({

      model,

      distanceField,

      datasetCoverage: {

        cases:
          dataset.cases.length,

        caseRate:
          rate(
            dataset.cases.length,
            cases.length
          ),

        observations:
          dataset.observations.length,

        actualNonCreditedRecipients:
          dataset.actualRecipientObservations,

        actualNonCreditedNonRecipients:
          dataset.actualNonRecipientObservations,

        unresolvedActualRecipients:
          dataset.unresolvedActualRecipients
      },

      bestMCC,

      bestBalanced,

      bestExactSet,

      standard
    });
  }
}


// ============================================================
// OVERALL BEST
// ============================================================

const overallCandidates =
  modelResults
    .map(
      row => ({

        model:
          row.model,

        distanceField:
          row.distanceField,

        coverage:
          row.datasetCoverage,

        result:
          row.bestMCC
      })
    )
    .filter(
      row =>
        row.result
        &&
        Number.isFinite(
          row.result.mcc
        )
    );


overallCandidates.sort(
  (
    a,
    b
  ) =>
    b.result.mcc -
      a.result.mcc
    ||
    b.result.exactRecipientSetRate -
      a.result.exactRecipientSetRate
    ||
    b.coverage.caseRate -
      a.coverage.caseRate
);


const overallBest =
  overallCandidates[0]
  ??
  null;


// ============================================================
// FAMILY COMPARISON
// ============================================================

const deathFamily =
  bestAcrossModels(
    [
      'DEATH_TROOPER_CENTERED'
    ]
  );


const targetOnsetFamily =
  bestAcrossModels(
    [
      'TARGET_ONSET_SOUL_CENTERED',
      'TARGET_ONSET_COLLECTOR_CENTERED'
    ]
  );


const activeFalseFamily =
  bestAcrossModels(
    [
      'ACTIVE_FALSE_SOUL_CENTERED',
      'ACTIVE_FALSE_COLLECTOR_CENTERED'
    ]
  );


const collectorCenteredFamily =
  bestAcrossModels(
    [
      'TARGET_ONSET_COLLECTOR_CENTERED',
      'ACTIVE_FALSE_COLLECTOR_CENTERED'
    ]
  );


const soulCenteredCollectionFamily =
  bestAcrossModels(
    [
      'TARGET_ONSET_SOUL_CENTERED',
      'ACTIVE_FALSE_SOUL_CENTERED'
    ]
  );


// ============================================================
// PHYSICAL TARGET ECONOMIC-ABSENCE AUDIT
//
// Collector-centered models always give the physical target:
//
//   distance = 0
//
// Therefore every economically absent non-credited target is a
// direct false positive for any collector-centered radius > 0.
// ============================================================

const nonCreditedTargetCases =
  cases.filter(
    row =>
      row.targetDiffersFromCredited
  );


const targetEconomicallyPresent =
  nonCreditedTargetCases.filter(
    row =>
      row
        .actualRecipientNames
        .has(
          row.targetPlayerName
        )
  );


const targetEconomicallyAbsent =
  nonCreditedTargetCases.filter(
    row =>
      !row
        .actualRecipientNames
        .has(
          row.targetPlayerName
        )
  );


// ============================================================
// BEST MODEL EVENT AUDIT
// ============================================================

let bestEventAudits =
  [];


if (
  overallBest
) {

  const dataset =
    modelDatasets[
      overallBest
        .model
        .id
    ];


  bestEventAudits =
    auditEvents(
      dataset,
      overallBest
        .result
        .threshold,
      overallBest.distanceField
    );
}


const bestExactSets =
  bestEventAudits.filter(
    row =>
      row.exactSetMatch
  );


const bestCountMatches =
  bestEventAudits.filter(
    row =>
      row.actualRecipientCount ===
      row.predictedRecipientCount
  );


const bestMismatches =
  bestEventAudits.filter(
    row =>
      !row.exactSetMatch
  );


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const overallStrong =
  overallBest
  &&
  overallBest.coverage.caseRate >=
    0.90
  &&
  overallBest.result.mcc >=
    0.75
  &&
  overallBest.result.balancedAccuracy >=
    0.85;


const deathBetterThanCollector =
  deathFamily
  &&
  collectorCenteredFamily
  &&
  deathFamily.result.mcc >
    collectorCenteredFamily.result.mcc +
    0.05;


const collectorBetterThanDeath =
  deathFamily
  &&
  collectorCenteredFamily
  &&
  collectorCenteredFamily.result.mcc >
    deathFamily.result.mcc +
    0.05;


const collectionSoulBetterThanDeath =
  deathFamily
  &&
  soulCenteredCollectionFamily
  &&
  soulCenteredCollectionFamily.result.mcc >
    deathFamily.result.mcc +
    0.05;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script91Passed:
      check(
        summary91
          ?.validation
          ?.pass,
        true,
        summary91
          ?.validation
          ?.pass ===
        true
      ),


    script91CaseCount:
      check(
        cases91.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? cases91.length ===
            991
          : cases91.length >
            0
      ),


    primaryPartitionExactCount:
      check(
        primary91.length,
        replayName ===
          'test'
          ? 85
          : '>0',
        replayName ===
          'test'
          ? primary91.length ===
            85
          : primary91.length >
            0
      ),


    joinedCaseCount:
      check(
        cases.length,
        primary91.length,
        cases.length ===
        primary91.length
      ),


    deathAnchorCoverage:
      check(
        anchorCoverage
          .DEATH
          .snapshotCases,
        cases.length,
        anchorCoverage
          .DEATH
          .snapshotCases ===
        cases.length
      ),


    targetOnsetAnchorPresent:
      check(
        anchorCoverage
          .TARGET_ONSET
          .snapshotCases,
        '>0',
        anchorCoverage
          .TARGET_ONSET
          .snapshotCases >
        0
      ),


    activeFalseAnchorPresent:
      check(
        anchorCoverage
          .ACTIVE_FALSE
          .snapshotCases,
        '>0',
        anchorCoverage
          .ACTIVE_FALSE
          .snapshotCases >
        0
      ),


    modelResultsPresent:
      check(
        modelResults.length,
        MODEL_DEFINITIONS.length *
        2,
        modelResults.length ===
        MODEL_DEFINITIONS.length *
        2
      ),


    overallBestResolved:
      check(
        Boolean(
          overallBest
        ),
        true,
        Boolean(
          overallBest
        )
      ),


    nonCreditedTargetCasesPresent:
      check(
        nonCreditedTargetCases.length,
        '>0',
        nonCreditedTargetCases.length >
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
      'ASSIGNED_GOLD_SHARE_RECIPIENT_GEOMETRY_COMPARISON_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'COMPETING_SHARE_RECIPIENT_GEOMETRY_MODELS_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    documentedExternalReference:
      {

        nearbyPlayerSharePercent:
          {

            one:
              100,

            two:
              54,

            three:
              36,

            four:
              25,

            five:
              20,

            six:
              16
          },

        totalGeneratedPercent:
          {

            one:
              100,

            two:
              108,

            three:
              108,

            four:
              100,

            five:
              100,

            six:
              96
          },

        semanticStatus:
          'EXTERNAL_DOCUMENTED_REFERENCE_ONLY_NOT_USED_AS_CLASSIFIER_TRUTH'
      },


    purpose:
      [

        'Compare death-time and collection-time explanations for AssignedGold economic sharing.',

        'Directly test whether teammates near the physical vacuum-target player are the economic recipients.',

        'Compare Trooper-centered, soul-centered, and collector-centered geometry.',

        'Keep the credited last-hitter as a separate privileged economic assignment candidate.',

        'Use exact integer-partition economic recipient sets from Script91 as the observed outcome.',

        'Avoid inferring death-time sharing merely because death geometry and later collection geometry may be correlated.'
      ],


    semanticLimits:
      {

        recipient:
          'Actual economic recipient is defined by the previously validated exact-tick m_nCurrencies.0000 reconstruction.',

        creditedPlayer:
          'Credited last-hitter is inserted independently into every candidate recipient set and excluded from the ordinary ally distance classifier.',

        physicalTarget:
          'm_hVacuumTarget is treated as the physical vacuum-target candidate, not automatically an economic recipient.',

        onlineShareTable:
          'The documented 100/54/36/25/20/16 table is included only as external reference and is not used to determine which player counts as nearby.',

        geometry:
          'All thresholds discovered here are empirical single-replay center-to-center distances.',

        causalMeaning:
          'A superior geometric model identifies the state most predictive of sharing; observational telemetry alone does not establish engine causal implementation.'
      },


    cohort:
      {

        script91Cases:
          cases91.length,

        primaryPartitionExact:
          primary91.length,

        joinedCases:
          cases.length,

        nonCreditedTargetCases:
          nonCreditedTargetCases.length,

        targetEconomicallyPresent:
          targetEconomicallyPresent.length,

        targetEconomicallyAbsent:
          targetEconomicallyAbsent.length
      },


    anchorCoverage,


    modelResults,


    overallBest,


    familyComparison:
      {

        deathTime:
          deathFamily,

        targetOnset:
          targetOnsetFamily,

        activeFalse:
          activeFalseFamily,

        collectorCentered:
          collectorCenteredFamily,

        soulCenteredCollection:
          soulCenteredCollectionFamily
      },


    physicalVacuumTarget:
      {

        nonCreditedCases:
          nonCreditedTargetCases.length,

        economicallyPresent:
          targetEconomicallyPresent.length,

        economicallyPresentRate:
          rate(
            targetEconomicallyPresent.length,
            nonCreditedTargetCases.length
          ),

        economicallyAbsent:
          targetEconomicallyAbsent.length,

        economicallyAbsentRate:
          rate(
            targetEconomicallyAbsent.length,
            nonCreditedTargetCases.length
          ),

        implication:
          targetEconomicallyAbsent.length >
            0
            ? 'ANY_SIMPLE_COLLECTOR_CENTERED_MODEL_THAT_ALWAYS_INCLUDES_THE_COLLECTOR_HAS_DIRECT_FALSE_POSITIVES'
            : 'PHYSICAL_TARGET_ALWAYS_ECONOMICALLY_PRESENT_IN_THIS_COHORT'
      },


    bestEventReconstruction:
      overallBest
        ? {

          model:
            overallBest.model.id,

          distanceField:
            overallBest.distanceField,

          thresholdHU:
            overallBest
              .result
              .threshold,

          thresholdMeters:
            overallBest
              .result
              .threshold /
            HU_PER_METER,

          cases:
            bestEventAudits.length,

          exactRecipientSets:
            bestExactSets.length,

          exactRecipientSetRate:
            rate(
              bestExactSets.length,
              bestEventAudits.length
            ),

          recipientCountMatches:
            bestCountMatches.length,

          recipientCountMatchRate:
            rate(
              bestCountMatches.length,
              bestEventAudits.length
            ),

          mismatchCount:
            bestMismatches.length
        }
        : null,


    bestMismatchEvents:
      bestMismatches.slice(
        0,
        100
      ),


    interpretiveFlags:
      {

        overallStrong,

        deathBetterThanCollector,

        collectorBetterThanDeath,

        collectionSoulBetterThanDeath
      },


    interpretationGuide:
      {

        deathModelWins:
          'If DEATH_TROOPER_CENTERED materially outperforms the collection-time models, economic sharing eligibility is most consistent with allies near the Trooper when it dies.',

        collectorModelWins:
          'If a collector-centered model materially outperforms death geometry, the user-proposed model of sharing with teammates near the physical vacuuming player is supported.',

        soulCollectionModelWins:
          'If soul-centered collection geometry wins, economic recipients may be determined by proximity to the ground soul at collection rather than proximity to the eventual vacuum-target player.',

        physicalTargetAbsent:
          'If the physical target is sometimes economically absent, a simple rule in which the collector must always receive the shared reward is contradicted by the reconstructed economy stream.',

        correlatedModels:
          'If several models perform similarly, this replay does not spatially separate death-time from collection-time eligibility well enough and cross-replay variation will be especially valuable.',

        next:
          'Use the winning recipient-count model together with the documented share table to test observed per-player reward scaling, rounding behavior, and the exact underlying Trooper reward schedule.'
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
    `${JSON.stringify(
      serializeCase(
        row
      )
    )}\n`
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
  'ASSIGNED GOLD SHARE-RECIPIENT GEOMETRY COMPARISON V0.1'
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
  `Partition-exact economic cases: ${primary91.length}`
);


console.log(
  `Joined cases:                   ${cases.length}`
);


console.log(
  `Target != credited:             ${nonCreditedTargetCases.length}`
);


console.log(
  `Physical target paid:           ${targetEconomicallyPresent.length}`
);


console.log(
  `Physical target unpaid:         ${targetEconomicallyAbsent.length}`
);


// ============================================================
// ANCHOR COVERAGE
// ============================================================

console.log('');

console.log(
  'RAW ANCHOR COVERAGE'
);

console.log(
  '-------------------'
);


for (
  const [
    anchor,
    coverage
  ]
  of Object.entries(
    anchorCoverage
  )
) {

  console.log(

    `${anchor.padEnd(15)} ` +

    `snapshots=${String(coverage.snapshotCases).padStart(3)} ` +

    `soul=${String(coverage.soulPositionCases).padStart(3)} ` +

    `target=${String(coverage.targetPositionCases).padStart(3)}`
  );
}


// ============================================================
// MODEL RESULTS
// ============================================================

console.log('');

console.log(
  'COMPETING GEOMETRY MODELS'
);

console.log(
  '-------------------------'
);


for (
  const model
  of MODEL_DEFINITIONS
) {

  console.log('');

  console.log(
    model.id
  );


  for (
    const distanceField
    of [
      'distanceXY',
      'distance3D'
    ]
  ) {

    const result =
      modelResults.find(
        row =>
          row.model.id ===
            model.id
          &&
          row.distanceField ===
            distanceField
      );


    if (
      !result
    ) {

      continue;
    }


    console.log(
      `  ${distanceField}`
    );


    console.log(
      `    coverage=${result.datasetCoverage.cases}/${cases.length} (${formatPercent(result.datasetCoverage.caseRate)}) observations=${result.datasetCoverage.observations}`
    );


    printBest(
      'best MCC',
      result.bestMCC
    );


    printBest(
      'best balanced',
      result.bestBalanced
    );


    printBest(
      'best exact-set',
      result.bestExactSet
    );
  }
}


// ============================================================
// HEAD TO HEAD
// ============================================================

console.log('');

console.log(
  'HEAD-TO-HEAD FAMILY WINNERS'
);

console.log(
  '--------------------------'
);


printFamily(
  'Death-time Trooper',
  deathFamily
);


printFamily(
  'Target-onset',
  targetOnsetFamily
);


printFamily(
  'Active=false',
  activeFalseFamily
);


printFamily(
  'Collector-centered',
  collectorCenteredFamily
);


printFamily(
  'Soul-centered collection',
  soulCenteredCollectionFamily
);


// ============================================================
// OVERALL BEST
// ============================================================

console.log('');

console.log(
  'OVERALL BEST MODEL'
);

console.log(
  '------------------'
);


if (
  overallBest
) {

  console.log(
    `Model:        ${overallBest.model.id}`
  );


  console.log(
    `Geometry:     ${overallBest.distanceField}`
  );


  console.log(
    `Threshold:    ${overallBest.result.threshold} HU (${formatNumber(
      overallBest.result.threshold /
      HU_PER_METER
    )}m)`
  );


  console.log(
    `Sensitivity:  ${formatPercent(overallBest.result.sensitivity)}`
  );


  console.log(
    `Specificity:  ${formatPercent(overallBest.result.specificity)}`
  );


  console.log(
    `Balanced:     ${formatPercent(overallBest.result.balancedAccuracy)}`
  );


  console.log(
    `MCC:          ${formatNumber(overallBest.result.mcc)}`
  );


  console.log(
    `Exact sets:   ${overallBest.result.exactRecipientSets}/${overallBest.result.eventCount} (${formatPercent(overallBest.result.exactRecipientSetRate)})`
  );


  console.log(
    `Count match:  ${overallBest.result.recipientCountMatches}/${overallBest.result.eventCount} (${formatPercent(overallBest.result.recipientCountMatchRate)})`
  );
}


// ============================================================
// PHYSICAL TARGET
// ============================================================

console.log('');

console.log(
  'PHYSICAL VACUUM TARGET ECONOMIC ROLE'
);

console.log(
  '------------------------------------'
);


console.log(
  `Target != credited cases:      ${nonCreditedTargetCases.length}`
);


console.log(
  `Target economically present:   ${targetEconomicallyPresent.length}/${nonCreditedTargetCases.length} (${formatPercent(
    rate(
      targetEconomicallyPresent.length,
      nonCreditedTargetCases.length
    )
  )})`
);


console.log(
  `Target economically absent:    ${targetEconomicallyAbsent.length}/${nonCreditedTargetCases.length} (${formatPercent(
    rate(
      targetEconomicallyAbsent.length,
      nonCreditedTargetCases.length
    )
  )})`
);


// ============================================================
// BEST MISMATCHES
// ============================================================

if (
  bestMismatches.length >
  0
) {

  console.log('');

  console.log(
    'BEST-MODEL RECIPIENT-SET MISMATCHES'
  );

  console.log(
    '-----------------------------------'
  );


  for (
    const row
    of bestMismatches.slice(
      0,
      40
    )
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)} ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `actual=[${row.actualRecipients.join(', ')}] ` +

      `pred=[${row.predictedRecipients.join(', ')}] ` +

      `missing=[${row.missingRecipients.join(', ')}] ` +

      `extra=[${row.extraRecipients.join(', ')}]`
    );
  }
}


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
  `Overall strong model:              ${overallStrong}`
);


console.log(
  `Death materially > collector:      ${deathBetterThanCollector}`
);


console.log(
  `Collector materially > death:      ${collectorBetterThanDeath}`
);


console.log(
  `Collection-soul materially > death:${collectionSoulBetterThanDeath}`
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
// BUILD MODEL DATASET
// ============================================================

function buildModelDataset(
  model
) {

  const modelCases =
    [];


  const observations =
    [];


  let unresolvedActualRecipients =
    0;


  for (
    const row
    of cases
  ) {

    const anchor =
      row
        .anchors[
          model.anchor
        ];


    if (
      !anchor
    ) {

      continue;
    }


    const center =
      getModelCenter(
        row,
        anchor,
        model
      );


    if (
      !center
    ) {

      continue;
    }


    const alliedPlayers =
      anchor
        .alliedPlayers
        .filter(
          player =>
            player.position
        );


    const observedNames =
      new Set(
        alliedPlayers.map(
          player =>
            player.playerName
        )
      );


    for (
      const actualName
      of row.actualRecipientNames
    ) {

      if (
        actualName ===
        row.creditedPlayerName
      ) {

        continue;
      }


      if (
        !observedNames.has(
          actualName
        )
      ) {

        unresolvedActualRecipients++;
      }
    }


    const playerRows =
      [];


    for (
      const player
      of alliedPlayers
    ) {

      if (
        player.playerName ===
        row.creditedPlayerName
      ) {

        continue;
      }


      // Ordinary proximity recipient model uses living allies.
      //
      // Dead/invalid states remain visible indirectly through
      // unresolved-recipient accounting and whole-event errors.

      if (
        player.alive !==
        true
      ) {

        continue;
      }


      const distanceXYValue =
        distanceXY(
          center,
          player.position
        );


      const distance3DValue =
        (
          Number.isFinite(
            center.z
          )
          &&
          Number.isFinite(
            player.position.z
          )
        )
          ? distance3D(
            center,
            player.position
          )
          : null;


      const actualEconomicRecipient =
        row
          .actualRecipientNames
          .has(
            player.playerName
          );


      const playerRow = {

        deathIndex:
          row.deathIndex,

        clock:
          row.clock,

        playerName:
          player.playerName,

        isVacuumTarget:
          player.playerName ===
          row.targetPlayerName,

        actualEconomicRecipient,

        distanceXY:
          distanceXYValue,

        distance3D:
          distance3DValue
      };


      observations.push(
        playerRow
      );


      playerRows.push(
        playerRow
      );
    }


    modelCases.push({

      row,

      center,

      players:
        playerRows
    });
  }


  return {

    model,

    cases:
      modelCases,

    observations,

    actualRecipientObservations:
      observations.filter(
        row =>
          row.actualEconomicRecipient
      ).length,

    actualNonRecipientObservations:
      observations.filter(
        row =>
          !row.actualEconomicRecipient
      ).length,

    unresolvedActualRecipients
  };
}


// ============================================================
// MODEL CENTER
// ============================================================

function getModelCenter(
  row,
  anchor,
  model
) {

  switch (
    model.center
  ) {

    case 'TROOPER_DEATH_POSITION':

      return row.deathPosition;


    case 'SOUL_POSITION':

      return anchor.soulPosition;


    case 'VACUUM_TARGET_POSITION':

      return anchor.vacuumTargetPosition;


    default:

      return null;
  }
}


// ============================================================
// THRESHOLD EVALUATION
// ============================================================

function evaluateThreshold(
  dataset,
  threshold,
  distanceField
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
    of dataset.observations
  ) {

    const distance =
      finite(
        row?.[distanceField]
      );


    if (
      distance ===
      null
    ) {

      continue;
    }


    const predicted =
      distance <=
      threshold;


    const actual =
      row.actualEconomicRecipient ===
      true;


    if (
      predicted
      &&
      actual
    ) {

      tp++;

    } else if (
      predicted
      &&
      !actual
    ) {

      fp++;

    } else if (
      !predicted
      &&
      actual
    ) {

      fn++;

    } else {

      tn++;
    }
  }


  const sensitivity =
    safeDivide(
      tp,
      tp +
      fn
    );


  const specificity =
    safeDivide(
      tn,
      tn +
      fp
    );


  const precision =
    safeDivide(
      tp,
      tp +
      fp
    );


  const balancedAccuracy =
    (
      Number.isFinite(
        sensitivity
      )
      &&
      Number.isFinite(
        specificity
      )
    )
      ? (
        sensitivity +
        specificity
      )
      /
      2
      : null;


  const mcc =
    matthews(
      tp,
      fp,
      tn,
      fn
    );


  const eventAudits =
    auditEvents(
      dataset,
      threshold,
      distanceField
    );


  const exactRecipientSets =
    eventAudits.filter(
      row =>
        row.exactSetMatch
    ).length;


  const recipientCountMatches =
    eventAudits.filter(
      row =>
        row.actualRecipientCount ===
        row.predictedRecipientCount
    ).length;


  return {

    threshold,

    meters:
      threshold /
      HU_PER_METER,

    tp,
    fp,
    tn,
    fn,

    sensitivity,

    specificity,

    precision,

    balancedAccuracy,

    mcc,

    eventCount:
      eventAudits.length,

    exactRecipientSets,

    exactRecipientSetRate:
      rate(
        exactRecipientSets,
        eventAudits.length
      ),

    recipientCountMatches,

    recipientCountMatchRate:
      rate(
        recipientCountMatches,
        eventAudits.length
      )
  };
}


// ============================================================
// EVENT AUDIT
// ============================================================

function auditEvents(
  dataset,
  threshold,
  distanceField
) {

  return dataset
    .cases
    .map(
      modelCase => {

        const row =
          modelCase.row;


        const predicted =
          new Set();


        // Privileged credited-player candidate.

        predicted.add(
          row.creditedPlayerName
        );


        for (
          const player
          of modelCase.players
        ) {

          const distance =
            finite(
              player?.[
                distanceField
              ]
            );


          if (
            distance !==
              null
            &&
            distance <=
              threshold
          ) {

            predicted.add(
              player.playerName
            );
          }
        }


        const actual =
          row.actualRecipientNames;


        const missing =
          [
            ...actual
          ]
          .filter(
            name =>
              !predicted.has(
                name
              )
          )
          .sort();


        const extra =
          [
            ...predicted
          ]
          .filter(
            name =>
              !actual.has(
                name
              )
          )
          .sort();


        return {

          deathIndex:
            row.deathIndex,

          clock:
            row.clock,

          actualRecipients:
            [
              ...actual
            ]
            .sort(),

          predictedRecipients:
            [
              ...predicted
            ]
            .sort(),

          missingRecipients:
            missing,

          extraRecipients:
            extra,

          actualRecipientCount:
            actual.size,

          predictedRecipientCount:
            predicted.size,

          exactSetMatch:
            missing.length ===
              0
            &&
            extra.length ===
              0
        };
      }
    );
}


// ============================================================
// BEST SELECTION
// ============================================================

function selectBest(
  rows,
  metric
) {

  return rows
    .filter(
      row =>
        Number.isFinite(
          row?.[
            metric
          ]
        )
    )
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b[
          metric
        ] -
        a[
          metric
        ]
        ||
        (
          b.mcc ??
          -Infinity
        )
        -
        (
          a.mcc ??
          -Infinity
        )
        ||
        a.threshold -
        b.threshold
    )[0]
    ??
    null;
}


// ============================================================
// BEST ACROSS MODEL FAMILY
// ============================================================

function bestAcrossModels(
  modelIds
) {

  const candidates =
    modelResults
      .filter(
        row =>
          modelIds.includes(
            row.model.id
          )
      )
      .map(
        row => ({

          model:
            row.model,

          distanceField:
            row.distanceField,

          coverage:
            row.datasetCoverage,

          result:
            row.bestMCC
        })
      )
      .filter(
        row =>
          row.result
          &&
          Number.isFinite(
            row.result.mcc
          )
      );


  candidates.sort(
    (
      a,
      b
    ) =>
      b.result.mcc -
        a.result.mcc
      ||
      b.result.exactRecipientSetRate -
        a.result.exactRecipientSetRate
  );


  return candidates[0]
  ??
  null;
}


// ============================================================
// CURRENT PLAYER STATE
// ============================================================

function collectCurrentPlayers(
  demo
) {

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


    const team =
      finite(
        safeGetField(
          controller,
          'm_iTeamNum'
        )
      );


    if (
      team ===
      null
    ) {

      continue;
    }


    const controllerAlive =
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


    if (
      isInvalidHandle(
        pawnHandle
      )
    ) {

      continue;
    }


    let pawn;


    try {

      pawn =
        demo.getEntityByHandle(
          pawnHandle
        );

    } catch {

      pawn =
        null;
    }


    if (
      !pawn
    ) {

      continue;
    }


    const position =
      getWorldPositionDetailed(
        pawn
      );


    if (
      !position
    ) {

      continue;
    }


    const lifeState =
      finite(
        safeGetField(
          pawn,
          'm_lifeState'
        )
      );


    const alive =
      controllerAlive !==
        false
      &&
      (
        lifeState ===
          null
        ||
        lifeState ===
          0
      );


    players.push({

      playerName:
        String(
          playerName
        ),

      team,

      pawnEntityIndex:
        getEntityIndex(
          pawn
        ),

      alive,

      position
    });
  }


  return players;
}


// ============================================================
// CURRENT ASSIGNEDGOLD POSITIONS
// ============================================================

function collectAssignedGoldPositions(
  demo
) {

  const positions =
    new Map();


  const entities =
    demo.getEntitiesByClassName(
      'CCitadel_Pickup_AssignedGold'
    )
    ??
    [];


  for (
    const entity
    of entities
  ) {

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


    const position =
      getWorldPositionDetailed(
        entity
      );


    if (
      position
    ) {

      positions.set(
        entityIndex,
        position
      );
    }
  }


  return positions;
}


// ============================================================
// POSITION
// ============================================================

function normalizePosition(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const x =
    finite(
      value.x
    );


  const y =
    finite(
      value.y
    );


  const z =
    finite(
      value.z
    );


  if (
    x ===
      null
    ||
    y ===
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
      (
        cellZ !==
          null
        &&
        vecZ !==
          null
      )
        ? cellZ *
          512 -
          16384 +
          vecZ
        : null
  };
}


// ============================================================
// DISTANCE
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
// CONFUSION METRICS
// ============================================================

function matthews(
  tp,
  fp,
  tn,
  fn
) {

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


function safeDivide(
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
    denominator ===
      0
  ) {

    return null;
  }


  return numerator /
    denominator;
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
// INDEX
// ============================================================

function indexByDeathIndex(
  rows
) {

  const output =
    new Map();


  for (
    const row
    of rows
  ) {

    const deathIndex =
      firstFinite([
        row?.deathIndex,

        row
          ?.death
          ?.deathIndex
      ]);


    if (
      deathIndex !==
      null
    ) {

      output.set(
        deathIndex,
        row
      );
    }
  }


  return output;
}


// ============================================================
// SERIALIZATION
// ============================================================

function serializeCase(
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

    variantLabel:
      row.variantLabel,

    matchMinute:
      row.matchMinute,

    teamTotal:
      row.teamTotal,

    deathTick:
      row.deathTick,

    targetOnsetTick:
      row.targetOnsetTick,

    activeFalseTick:
      row.activeFalseTick,

    deathPosition:
      row.deathPosition,

    groundSoulEntityIndex:
      row.groundSoulEntityIndex,

    creditedPlayerName:
      row.creditedPlayerName,

    creditedTeam:
      row.creditedTeam,

    targetPlayerName:
      row.targetPlayerName,

    targetDiffersFromCredited:
      row.targetDiffersFromCredited,

    actualRecipients:
      row.actualRecipients,

    actualRecipientCount:
      row.actualRecipientCount,

    anchors:
      row.anchors
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

function printBest(
  label,
  row
) {

  if (
    !row
  ) {

    console.log(
      `    ${label.padEnd(15)} n/a`
    );

    return;
  }


  console.log(

    `    ${label.padEnd(15)} ` +

    `${String(row.threshold).padStart(4)} HU ` +

    `sens=${formatPercent(row.sensitivity).padStart(8)} ` +

    `spec=${formatPercent(row.specificity).padStart(8)} ` +

    `bal=${formatPercent(row.balancedAccuracy).padStart(8)} ` +

    `MCC=${formatNumber(row.mcc).padStart(7)} ` +

    `exactSet=${formatPercent(row.exactRecipientSetRate).padStart(8)}`
  );
}


function printFamily(
  label,
  row
) {

  if (
    !row
  ) {

    console.log(
      `${label.padEnd(26)} n/a`
    );

    return;
  }


  console.log(

    `${label.padEnd(26)} ` +

    `${row.model.id.padEnd(38)} ` +

    `${row.distanceField.padEnd(10)} ` +

    `threshold=${String(row.result.threshold).padStart(4)} ` +

    `MCC=${formatNumber(row.result.mcc).padStart(7)} ` +

    `exactSet=${formatPercent(row.result.exactRecipientSetRate).padStart(8)}`
  );
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