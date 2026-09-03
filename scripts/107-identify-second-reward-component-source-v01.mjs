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

const TICK_RATE =
  64;


const FORCE_REEXTRACTION =
  process.argv.includes(
    '--force'
  );


// ------------------------------------------------------------
// Counter timing.
//
// Entity/controller updates can be ordered a few ticks away from
// the pawn currency mutation representing the economic award.
//
// We therefore report:
//
//   exact tick
//   ±1
//   ±2
//   ±4  <- primary diagnostic
//   ±8
//
// We do NOT silently optimize the window.
// ------------------------------------------------------------

const COUNTER_WINDOWS =
  [
    0,
    1,
    2,
    4,
    8
  ];


const PRIMARY_COUNTER_WINDOW =
  4;


// ------------------------------------------------------------
// CItemXP termination timing.
//
// Secondary diagnostic only. Named controller counters carry
// more semantic weight than CItemXP disappearance by itself.
// ------------------------------------------------------------

const CITEMXP_WINDOW_TICKS =
  4;


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT106_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_mixture_outlier_diagnostic_v02.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'second_reward_component_source_validation_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'second_reward_component_source_validation_v01.md'
  );


// ============================================================
// LIVE CONTROLLER ECONOMIC COUNTERS
//
// These fields were discovered previously on
// CCitadelPlayerController.
//
// IMPORTANT:
//
// The field names are strong semantic evidence, but we still
// validate their actual behavior empirically here.
// ============================================================

const ECONOMIC_COUNTER_FIELDS =
  [

    'm_iCreepGoldGroundOrb',

    'm_iCreepGoldAirOrb',

    'm_iCreepGoldKill',

    'm_iCreepGoldSoloBonus',

    'm_iCreepGoldDeny',

    'm_iCreepGoldNeutral',

    'm_iGoldNetWorth'
  ];


// ============================================================
// POST-JUNE-30 REWARD MODEL
//
// Script106 strongly supported the modern ground baseline.
//
// total Trooper bounty:
//   100 + 2/min
//
// ground:
//   50%
//
// flying:
//   50%
//
// Thus:
//
// ground reward:
//   50 + 1/min
//
// flying reward:
//   50 + 1/min
// ============================================================

const POST_TOTAL_INTERCEPT =
  100;


const POST_TOTAL_SLOPE =
  2;


const POST_GROUND_FRACTION =
  0.50;


const POST_FLYING_FRACTION =
  0.50;


// ============================================================
// SHARE TOTAL MULTIPLIERS
// ============================================================

const SHARE_TOTAL_MULTIPLIER =
  new Map([

    [
      1,
      1.00
    ],

    [
      2,
      1.08
    ],

    [
      3,
      1.08
    ],

    [
      4,
      1.00
    ],

    [
      5,
      1.00
    ],

    [
      6,
      0.96
    ]
  ]);


// ============================================================
// DEATH <-> ASSIGNEDGOLD MATCHING
// ============================================================

const MATCH_MIN_TICK_OFFSET =
  -1;


const MATCH_MAX_TICK_OFFSET =
  4;


const MATCH_MAX_DISTANCE_3D_HU =
  160;


// ============================================================
// SCRIPT106 NORMAL-TROOPER SCREEN
// ============================================================

const NORMAL_BASE_HP =
  new Map([

    [
      'RANGED',
      300
    ],

    [
      'MEDIC',
      350
    ],

    [
      'MELEE',
      400
    ]
  ]);


const MAX_NORMAL_HP_RATIO =
  1.20;


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT106_PATH
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


const script106 =
  JSON.parse(
    readFileSync(
      SCRIPT106_PATH,
      'utf8'
    )
  );


if (
  manifest
    ?.readyToBeginReplication !==
  true
) {

  throw new Error(
    'Script100 replication manifest is not ready.'
  );
}


if (
  script106
    ?.status !==
  'POST_JUNE_30_BASELINE_WITH_SECOND_COMPONENT_STRONGLY_SUPPORTED'
) {

  throw new Error(
    `Unexpected Script106 status:\n${script106?.status}`
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
  'SECOND REWARD COMPONENT SOURCE VALIDATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'PRIMARY QUESTION'
);

console.log(
  '----------------'
);


console.log(
  'Does the Script106 second reward component correspond to'
);


console.log(
  'direct m_iCreepGoldAirOrb counter increments?'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  `Primary timing window:     ±${PRIMARY_COUNTER_WINDOW} ticks`
);


console.log(
  `Force re-extraction:       ${FORCE_REEXTRACTION}`
);


console.log('');


// ============================================================
// BATCH LOOP
// ============================================================

const replayResults =
  [];


for (
  let replayIndex =
    0;

  replayIndex <
    cohort.length;

  replayIndex++
) {

  const replayName =
    String(
      cohort[
        replayIndex
      ].replayName
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${replayIndex + 1}/${cohort.length}] ${replayName}`
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


  printReplayResult(
    result
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY CLAIM
// ============================================================

const informativeReplays =
  replayResults.filter(
    row =>
      row
        ?.support
        ?.informative ===
      true
  );


const directAirSupportedReplays =
  informativeReplays.filter(
    row =>
      row
        ?.support
        ?.directAirOrbSourceSupported ===
      true
  );


const counterSemanticsSupportedReplays =
  informativeReplays.filter(
    row =>
      row
        ?.support
        ?.groundCounterValidated ===
      true
  );


const citemxpSupportedReplays =
  informativeReplays.filter(
    row =>
      row
        ?.support
        ?.citemxpTerminationAssociationSupported ===
      true
  );


let sourceStatus;


if (
  informativeReplays.length <
  3
) {

  sourceStatus =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  directAirSupportedReplays.length >=
    4
) {

  sourceStatus =
    'SECOND_COMPONENT_DIRECTLY_LINKED_TO_AIR_ORB_REWARD';

} else if (
  counterSemanticsSupportedReplays.length >=
    4
  &&
  citemxpSupportedReplays.length >=
    4
) {

  sourceStatus =
    'SECOND_COMPONENT_LINKED_TO_CITEMXP_RESOLUTION_AIR_COUNTER_INCOMPLETE';

} else {

  sourceStatus =
    'SECOND_COMPONENT_SOURCE_UNRESOLVED';
}


// ============================================================
// REPLAY-LEVEL DISTRIBUTIONS
// ============================================================

const distributions = {

  secondComponentRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.caseCounts
            ?.secondComponentRate
      )
    ),


  groundCounterPresenceAll:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.all
            ?.m_iCreepGoldGroundOrb
            ?.presenceRate
      )
    ),


  airCounterPresenceGroundOnly:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.groundOnly
            ?.m_iCreepGoldAirOrb
            ?.presenceRate
      )
    ),


  airCounterPresenceSecondComponent:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.secondComponent
            ?.m_iCreepGoldAirOrb
            ?.presenceRate
      )
    ),


  airCounterAssociationMCC:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.airOrbAssociation
            ?.mcc
      )
    ),


  airAmountResidualWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.secondComponent
            ?.airCounterVsExcess
            ?.within2Rate
      )
    ),


  groundPlusAirVsObservedWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.all
            ?.groundPlusAirCounterVsObserved
            ?.within2Rate
      )
    ),


  citemxpTerminationSecondComponent:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.citemxpTermination
            ?.secondComponentPresenceRate
      )
    ),


  citemxpTerminationGroundOnly:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.citemxpTermination
            ?.groundOnlyPresenceRate
      )
    )
};


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation;


if (
  sourceStatus ===
  'SECOND_COMPONENT_DIRECTLY_LINKED_TO_AIR_ORB_REWARD'
) {

  interpretation = {

    secondComponentResolved:
      true,

    semanticStatus:
      'CROSS_REPLAY_STRONGLY_SUPPORTED',

    conclusion:
      'The second economic component identified by Script106 is directly associated with positive m_iCreepGoldAirOrb increments, while the ordinary component is associated with m_iCreepGoldGroundOrb.',

    workingMechanic:
      'Some exact pawn-currency observations contain both the ground AssignedGold reward and a flying-air-orb reward. Treat those as two concurrent reward sources rather than one enlarged ground-soul payout.',

    implication:
      'The ordinary post-June-30 ground reward model remains approximately 50 + 1/min before sharing/modifiers, and the positive tail should not be used to refit the ground reward curve.',

    nextStage:
      'Close the reward-magnitude discrepancy and proceed to the behavioral opportunity-feature model.'
  };

} else if (
  sourceStatus ===
  'SECOND_COMPONENT_LINKED_TO_CITEMXP_RESOLUTION_AIR_COUNTER_INCOMPLETE'
) {

  interpretation = {

    secondComponentResolved:
      false,

    semanticStatus:
      'SOURCE_FAMILY_SUPPORTED_EXACT_COUNTER_SEMANTICS_INCOMPLETE',

    conclusion:
      'High-reward cases align with CItemXP resolution, but the named AirOrb counter does not yet provide sufficiently complete direct attribution.',

    nextStage:
      'Tighten CItemXP award attribution only; do not reopen ground-soul economics.'
  };

} else {

  interpretation = {

    secondComponentResolved:
      false,

    semanticStatus:
      'UNRESOLVED',

    conclusion:
      'The current telemetry does not directly identify the second reward source.',

    nextStage:
      'Inspect the counter timing/source diagnostics and isolate the strongest competing source.'
  };
}


// ============================================================
// FINAL SUMMARY
// ============================================================

const summary = {

  version:
    'SECOND_REWARD_COMPONENT_SOURCE_VALIDATION_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  sourceStatus,


  priorResult: {

    script106Version:
      script106.version,

    script106Status:
      script106.status,

    secondComponentCandidate:
      'Flying CItemXP / AirOrb reward',

    priorSemanticStatus:
      'CANDIDATE_ONLY'
  },


  design: {

    replicationUnit:
      'REPLAY',

    rawReplayParse:
      'One narrow controller-counter/CItemXP pass per replay unless cached outputs already exist.',

    eligibleEconomicCases:
      'Reconstructed using the same strict matching, isolation, pre-35, leading-team, normal-HP-like cohort used by Script106.',

    classification:
      'Each eligible case is classified against the post-June ground-only versus ground+equal-flying candidate using Script106 replay-specific mixture rounding.',

    primaryWindowTicks:
      PRIMARY_COUNTER_WINDOW,

    windowsReported:
      COUNTER_WINDOWS,

    primaryNamedFields: [

      'm_iCreepGoldGroundOrb',

      'm_iCreepGoldAirOrb'
    ],

    secondaryFields:
      ECONOMIC_COUNTER_FIELDS.filter(
        field =>
          ![
            'm_iCreepGoldGroundOrb',
            'm_iCreepGoldAirOrb'
          ].includes(
            field
          )
      ),

    citemxpTermination:
      'Secondary supporting diagnostic only; CItemXP disappearance alone is not treated as proof of award.'
  },


  replayCounts: {

    total:
      replayResults.length,

    informative:
      informativeReplays.length,

    directAirSupported:
      directAirSupportedReplays.length,

    groundCounterValidated:
      counterSemanticsSupportedReplays.length,

    citemxpTerminationSupported:
      citemxpSupportedReplays.length
  },


  distributions,

  replays:
    replayResults,

  interpretation,


  authorityUpdate: {

    ifDirectAirSupported:
      'Promote second component to concurrent AirOrb/flying-soul reward within the tested replay cohort.',

    groundRewardCurve:
      'Do not refit the post-June ordinary ground reward curve from mixed ground+air events.',

    integerAllocation:
      'Already cross-replay strongly replicated and not reopened.',

    recipientGeometry:
      'Already cross-replay strongly replicated and not reopened.'
  },


  outputs: {

    json:
      OUTPUT_JSON_PATH,

    markdown:
      OUTPUT_MARKDOWN_PATH
  }
};


// ============================================================
// WRITE FINAL
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
  'SECOND COMPONENT SOURCE SUMMARY'
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

    `informative=${String(
      row.support.informative
    ).padEnd(5)} ` +

    `groundCounter=${String(
      row.support.groundCounterValidated
    ).padEnd(5)} ` +

    `directAir=${String(
      row.support.directAirOrbSourceSupported
    ).padEnd(5)}`
  );
}


console.log('');

console.log(
  'KEY REPLAY-LEVEL DISTRIBUTIONS'
);

console.log(
  '------------------------------'
);


console.log(
  `Ground counter presence:       ${formatDistribution(
    distributions.groundCounterPresenceAll
  )}`
);


console.log(
  `Air presence ground-only:      ${formatDistribution(
    distributions.airCounterPresenceGroundOnly
  )}`
);


console.log(
  `Air presence second-component: ${formatDistribution(
    distributions.airCounterPresenceSecondComponent
  )}`
);


console.log(
  `Air association MCC:           ${formatDistribution(
    distributions.airCounterAssociationMCC
  )}`
);


console.log(
  `Air amount vs excess <=2:      ${formatDistribution(
    distributions.airAmountResidualWithin2
  )}`
);


console.log(
  `Ground+Air vs observed <=2:    ${formatDistribution(
    distributions.groundPlusAirVsObservedWithin2
  )}`
);


console.log('');

console.log(
  'SOURCE STATUS'
);

console.log(
  '-------------'
);


console.log(
  sourceStatus
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
// ANALYZE REPLAY
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


  const deathsPath =
    resolve(
      outputDirectory,
      'replication_trooper_deaths_v01.jsonl'
    );


  const activationsPath =
    resolve(
      outputDirectory,
      'replication_assigned_gold_activations_v01.jsonl'
    );


  const currencyPath =
    resolve(
      outputDirectory,
      'replication_currency0_deltas_v01.jsonl'
    );


  const counterPath =
    resolve(
      outputDirectory,
      'replication_reward_source_counter_deltas_v01.jsonl'
    );


  const citemxpPath =
    resolve(
      outputDirectory,
      'replication_citemxp_terminations_v01.jsonl'
    );


  const rawSummaryPath =
    resolve(
      outputDirectory,
      'replication_reward_source_raw_summary_v01.json'
    );


  const replayDiagnosticPath =
    resolve(
      outputDirectory,
      'second_reward_component_source_validation_v01.json'
    );


  for (
    const path
    of [
      replayPath,
      deathsPath,
      activationsPath,
      currencyPath
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
  // RECONSTRUCT SCRIPT106 ELIGIBLE CASES
  // ----------------------------------------------------------

  const deaths =
    await loadJsonl(
      deathsPath
    );


  const activations =
    await loadJsonl(
      activationsPath
    );


  const currency =
    await loadJsonl(
      currencyPath
    );


  const strictMatches =
    buildStrictMatches(
      deaths,
      activations
    );


  const cleanEconomicCases =
    buildCleanEconomicCases(
      strictMatches,
      currency
    );


  const eligibleCases =
    cleanEconomicCases.filter(
      isEligibleCase
    );


  // ----------------------------------------------------------
  // SCRIPT106 MIXTURE ROUNDING FOR THIS REPLAY
  // ----------------------------------------------------------

  const script106Replay =
    script106
      ?.replays
      ?.find(
        row =>
          row.replay ===
          replayName
      )
    ??
    null;


  const mixtureRounding =
    script106Replay
      ?.eras
      ?.POST_JUNE_30_2026
      ?.mixture
      ?.best
      ?.rounding
    ??
    'FLOOR';


  const classifiedCases =
    eligibleCases.map(
      row =>
        classifyRewardCase(
          row,
          mixtureRounding
        )
    );


  // ----------------------------------------------------------
  // RAW COUNTER EXTRACTION
  // ----------------------------------------------------------

  let raw;


  if (
    !FORCE_REEXTRACTION
    &&
    existsSync(
      counterPath
    )
    &&
    existsSync(
      citemxpPath
    )
    &&
    existsSync(
      rawSummaryPath
    )
  ) {

    console.log(
      'Existing reward-source telemetry found.'
    );


    console.log(
      'Skipping raw replay parse.'
    );


    raw = {

      counterDeltas:
        await loadJsonl(
          counterPath
        ),

      citemxpTerminations:
        await loadJsonl(
          citemxpPath
        ),

      summary:
        JSON.parse(
          readFileSync(
            rawSummaryPath,
            'utf8'
          )
        )
    };

  } else {

    console.log(
      'Parsing narrow reward-source telemetry...'
    );


    raw =
      await extractRewardSourceTelemetry(
        replayName,
        replayPath
      );


    await writeJsonl(
      counterPath,
      raw.counterDeltas
    );


    await writeJsonl(
      citemxpPath,
      raw.citemxpTerminations
    );


    writeFileSync(
      rawSummaryPath,
      JSON.stringify(
        raw.summary,
        null,
        2
      ),
      'utf8'
    );
  }


  // ----------------------------------------------------------
  // COUNTER INDEX
  // ----------------------------------------------------------

  const counterByFieldTick =
    buildCounterIndex(
      raw.counterDeltas
    );


  const citemxpByTick =
    groupBy(
      raw.citemxpTerminations,
      row =>
        Number(
          row.tick
        )
    );


  // ----------------------------------------------------------
  // CASE-LEVEL EVIDENCE
  // ----------------------------------------------------------

  const evidenceCases =
    classifiedCases.map(
      row =>
        attachSourceEvidence({

          row,

          counterByFieldTick,

          citemxpByTick
        })
    );


  // ----------------------------------------------------------
  // ANALYZE WINDOWS
  // ----------------------------------------------------------

  const windows =
    {};


  for (
    const windowTicks
    of COUNTER_WINDOWS
  ) {

    windows[
      String(
        windowTicks
      )
    ] =
      analyzeWindow(
        evidenceCases,
        windowTicks
      );
  }


  const primaryWindow =
    windows[
      String(
        PRIMARY_COUNTER_WINDOW
      )
    ];


  // ----------------------------------------------------------
  // COUNTER EXTRACTION COUNTS
  // ----------------------------------------------------------

  const positiveDeltaCounts =
    {};


  for (
    const field
    of ECONOMIC_COUNTER_FIELDS
  ) {

    positiveDeltaCounts[
      field
    ] =
      raw.counterDeltas.filter(
        row =>
          row.fieldName ===
            field
        &&
          row.delta >
            0
      ).length;
  }


  // ----------------------------------------------------------
  // SUPPORT
  // ----------------------------------------------------------

  const support =
    evaluateReplaySupport({

      evidenceCases,

      primaryWindow,

      positiveDeltaCounts
    });


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  const result = {

    replay:
      replayName,

    version:
      'SECOND_REWARD_COMPONENT_SOURCE_VALIDATION_V01',

    canonical:
      false,


    extraction: {

      rawReplayParsed:
        raw
          ?.summary
          ?.parsedNow ===
        true,

      controllerCounterDeltaEvents:
        raw.counterDeltas.length,

      citemxpTerminationEvents:
        raw.citemxpTerminations.length,

      positiveDeltaCounts,

      fieldsObserved:
        ECONOMIC_COUNTER_FIELDS
          .filter(
            field =>
              (
                positiveDeltaCounts[
                  field
                ]
                ??
                0
              ) >
              0
          )
    },


    caseCounts: {

      strictMatches:
        strictMatches.length,

      cleanEconomicCases:
        cleanEconomicCases.length,

      eligibleCases:
        evidenceCases.length,

      groundOnly:
        evidenceCases.filter(
          row =>
            row.componentClass ===
            'GROUND_ONLY'
        ).length,

      secondComponent:
        evidenceCases.filter(
          row =>
            row.componentClass ===
            'GROUND_PLUS_SECOND_COMPONENT'
        ).length,

      secondComponentRate:
        rate(

          evidenceCases.filter(
            row =>
              row.componentClass ===
              'GROUND_PLUS_SECOND_COMPONENT'
          ).length,

          evidenceCases.length
        ),

      mixtureRounding
    },


    windows,

    primaryWindow,

    support,


    semanticNotes: {

      airOrbCounter:
        'm_iCreepGoldAirOrb is treated as a direct named-field candidate; its actual event relationship is validated rather than assumed.',

      groundOrbCounter:
        'm_iCreepGoldGroundOrb serves as a positive-control named field for the already validated ground AssignedGold economic event.',

      citemxpTermination:
        'CItemXP termination is supporting timing evidence only and is not equivalent to reward acquisition by itself.'
    },


    outputs: {

      counterDeltas:
        counterPath,

      citemxpTerminations:
        citemxpPath,

      rawSummary:
        rawSummaryPath,

      diagnostic:
        replayDiagnosticPath
    }
  };


  writeFileSync(
    replayDiagnosticPath,
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
// RAW REPLAY EXTRACTION
// ============================================================

async function extractRewardSourceTelemetry(
  replayName,
  replayPath
) {

  const parser =
    new Parser();


  const previousController =
    new Map();


  const currentCItemXP =
    new Map();


  const counterDeltas =
    [];


  const citemxpTerminations =
    [];


  const terminationKeys =
    new Set();


  const telemetry = {

    entityPackets:
      0,

    entityEvents:
      0,

    controllerEvents:
      0,

    citemxpEvents:
      0
  };


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
        // PLAYER CONTROLLER ECONOMIC COUNTERS
        // ------------------------------------------------------

        if (
          className ===
          'CCitadelPlayerController'
        ) {

          telemetry.controllerEvents++;


          if (
            entityIndex ===
            null
          ) {

            continue;
          }


          const playerName =
            stringOrNull(
              safeGetField(
                entity,
                'm_iszPlayerName'
              )
            );


          const team =
            finite(
              safeGetField(
                entity,
                'm_iTeamNum'
              )
            );


          const heroId =
            finite(
              safeGetField(
                entity,
                'm_nHeroID'
              )
            );


          const currentValues =
            {};


          for (
            const field
            of ECONOMIC_COUNTER_FIELDS
          ) {

            currentValues[
              field
            ] =
              finite(
                safeGetField(
                  entity,
                  field
                )
              );
          }


          const previous =
            previousController.get(
              entityIndex
            )
            ??
            null;


          // ----------------------------------------------------
          // Identity change = reset baseline.
          // ----------------------------------------------------

          const sameIdentity =

            previous

            &&

            previous.playerName ===
            playerName;


          if (
            sameIdentity
          ) {

            for (
              const field
              of ECONOMIC_COUNTER_FIELDS
            ) {

              const oldValue =
                previous.values[
                  field
                ];


              const newValue =
                currentValues[
                  field
                ];


              if (
                oldValue ===
                  null
                ||
                newValue ===
                  null
                ||
                oldValue ===
                  undefined
                ||
                newValue ===
                  undefined
              ) {

                continue;
              }


              const delta =
                newValue -
                oldValue;


              if (
                delta ===
                0
              ) {

                continue;
              }


              counterDeltas.push({

                schemaVersion:
                  1,

                canonical:
                  false,

                replay:
                  replayName,

                tick,

                controllerEntityIndex:
                  entityIndex,

                playerName,

                team,

                heroId,

                fieldName:
                  field,

                previousValue:
                  oldValue,

                currentValue:
                  newValue,

                delta
              });
            }
          }


          previousController.set(

            entityIndex,

            {

              playerName,

              team,

              heroId,

              values:
                currentValues
            }
          );


          continue;
        }


        // ------------------------------------------------------
        // CITEMXP LIFECYCLE
        // ------------------------------------------------------

        if (
          className ===
          'CItemXP'
        ) {

          telemetry.citemxpEvents++;


          if (
            entityIndex ===
            null
          ) {

            continue;
          }


          const existing =
            currentCItemXP.get(
              entityIndex
            )
            ??
            null;


          const current = {

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
              tick
          };


          currentCItemXP.set(
            entityIndex,
            current
          );


          if (
            operation ===
              'LEAVE'
            ||
            operation ===
              'DELETE'
          ) {

            const key =
              `${entityIndex}|${tick}`;


            if (
              !terminationKeys.has(
                key
              )
            ) {

              terminationKeys.add(
                key
              );


              citemxpTerminations.push({

                schemaVersion:
                  1,

                canonical:
                  false,

                replay:
                  replayName,

                tick,

                operation,

                entityIndex,

                subclassId:
                  current.subclassId,

                team:
                  current.team,

                position:
                  current.position,

                firstSeenTick:
                  current.firstSeenTick,

                lastSeenTick:
                  current.lastSeenTick
              });
            }
          }
        }
      }
    }
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


  return {

    counterDeltas,

    citemxpTerminations,

    summary: {

      replay:
        replayName,

      version:
        'REWARD_SOURCE_RAW_TELEMETRY_V01',

      canonical:
        false,

      parsedNow:
        true,

      telemetry,

      counterDeltaEvents:
        counterDeltas.length,

      positiveCounterDeltaEvents:
        counterDeltas.filter(
          row =>
            row.delta >
            0
        ).length,

      citemxpTerminationEvents:
        citemxpTerminations.length,

      positiveDeltaCounts:
        Object.fromEntries(

          ECONOMIC_COUNTER_FIELDS.map(
            field => [

              field,

              counterDeltas.filter(
                row =>
                  row.fieldName ===
                    field
                &&
                  row.delta >
                    0
              ).length
            ]
          )
        )
    }
  };
}


// ============================================================
// BUILD COUNTER INDEX
// ============================================================

function buildCounterIndex(
  rows
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      row.delta <=
      0
    ) {

      continue;
    }


    const field =
      row.fieldName;


    const tick =
      Number(
        row.tick
      );


    if (
      !map.has(
        field
      )
    ) {

      map.set(
        field,
        new Map()
      );
    }


    const tickMap =
      map.get(
        field
      );


    if (
      !tickMap.has(
        tick
      )
    ) {

      tickMap.set(
        tick,
        []
      );
    }


    tickMap
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
// ATTACH SOURCE EVIDENCE
// ============================================================

function attachSourceEvidence({

  row,

  counterByFieldTick,

  citemxpByTick
}) {

  const evidence =
    {};


  for (
    const windowTicks
    of COUNTER_WINDOWS
  ) {

    const windowEvidence =
      {};


    for (
      const field
      of ECONOMIC_COUNTER_FIELDS
    ) {

      windowEvidence[
        field
      ] =
        aggregateCounterAroundTick({

          index:
            counterByFieldTick,

          field,

          team:
            row.creditedTeam,

          tick:
            row.endTick,

          windowTicks
        });
    }


    const citemxp =
      aggregateCItemXPTerminationsAroundTick({

        citemxpByTick,

        tick:
          row.endTick,

        windowTicks
      });


    evidence[
      String(
        windowTicks
      )
    ] = {

      counters:
        windowEvidence,

      citemxp
    };
  }


  return {

    ...row,

    sourceEvidence:
      evidence
  };
}


// ============================================================
// COUNTER AROUND EVENT
// ============================================================

function aggregateCounterAroundTick({

  index,

  field,

  team,

  tick,

  windowTicks
}) {

  const tickMap =
    index.get(
      field
    )
    ??
    new Map();


  const rows =
    [];


  for (
    let candidateTick =
      tick -
      windowTicks;

    candidateTick <=
      tick +
      windowTicks;

    candidateTick++
  ) {

    for (
      const row
      of tickMap.get(
        candidateTick
      )
      ??
      []
    ) {

      if (
        row.team !==
        team
      ) {

        continue;
      }


      rows.push(
        row
      );
    }
  }


  const byPlayer =
    new Map();


  for (
    const row
    of rows
  ) {

    const playerName =
      row.playerName
      ??
      `ENTITY_${row.controllerEntityIndex}`;


    byPlayer.set(

      playerName,

      (
        byPlayer.get(
          playerName
        )
        ??
        0
      )
      +
      row.delta
    );
  }


  return {

    present:
      rows.length >
      0,

    events:
      rows.length,

    players:
      byPlayer.size,

    totalDelta:
      rows.reduce(
        (
          sum,
          row
        ) =>
          sum +
          row.delta,
        0
      ),

    byPlayer:
      Object.fromEntries(
        byPlayer
      )
  };
}


// ============================================================
// CITEMXP TERMINATIONS AROUND EVENT
// ============================================================

function aggregateCItemXPTerminationsAroundTick({

  citemxpByTick,

  tick,

  windowTicks
}) {

  const rows =
    [];


  const seen =
    new Set();


  for (
    let candidateTick =
      tick -
      windowTicks;

    candidateTick <=
      tick +
      windowTicks;

    candidateTick++
  ) {

    for (
      const row
      of citemxpByTick.get(
        candidateTick
      )
      ??
      []
    ) {

      const key =
        `${row.entityIndex}|${row.tick}`;


      if (
        seen.has(
          key
        )
      ) {

        continue;
      }


      seen.add(
        key
      );


      rows.push(
        row
      );
    }
  }


  return {

    present:
      rows.length >
      0,

    count:
      rows.length,

    subclassCounts:
      countBy(
        rows,
        row =>
          row.subclassId ??
          'UNKNOWN'
      )
  };
}


// ============================================================
// ANALYZE WINDOW
// ============================================================

function analyzeWindow(
  cases,
  windowTicks
) {

  const groundOnly =
    cases.filter(
      row =>
        row.componentClass ===
        'GROUND_ONLY'
    );


  const secondComponent =
    cases.filter(
      row =>
        row.componentClass ===
        'GROUND_PLUS_SECOND_COMPONENT'
    );


  const all =
    cases;


  const result = {

    windowTicks,

    groundOnly:
      buildClassStatistics(
        groundOnly,
        windowTicks
      ),

    secondComponent:
      buildClassStatistics(
        secondComponent,
        windowTicks
      ),

    all:
      buildClassStatistics(
        all,
        windowTicks
      )
  };


  // ----------------------------------------------------------
  // DIRECT AIR COUNTER ASSOCIATION
  // ----------------------------------------------------------

  const airPredictions =
    cases.map(
      row => {

        const air =
          row
            .sourceEvidence[
              String(
                windowTicks
              )
            ]
            .counters
            .m_iCreepGoldAirOrb;


        return {

          actualSecondComponent:
            row.componentClass ===
            'GROUND_PLUS_SECOND_COMPONENT',

          airCounterPresent:
            air.present
        };
      }
    );


  result.airOrbAssociation =
    binaryAssociation(
      airPredictions
    );


  // ----------------------------------------------------------
  // CITEMXP TERMINATION ASSOCIATION
  // ----------------------------------------------------------

  const groundCitemxpPresent =
    groundOnly.filter(
      row =>
        row
          .sourceEvidence[
            String(
              windowTicks
            )
          ]
          .citemxp
          .present
    ).length;


  const secondCitemxpPresent =
    secondComponent.filter(
      row =>
        row
          .sourceEvidence[
            String(
              windowTicks
            )
          ]
          .citemxp
          .present
    ).length;


  result.citemxpTermination = {

    groundOnlyPresent:
      groundCitemxpPresent,

    groundOnlyPresenceRate:
      rate(
        groundCitemxpPresent,
        groundOnly.length
      ),

    secondComponentPresent:
      secondCitemxpPresent,

    secondComponentPresenceRate:
      rate(
        secondCitemxpPresent,
        secondComponent.length
      )
  };


  return result;
}


// ============================================================
// CLASS STATISTICS
// ============================================================

function buildClassStatistics(
  rows,
  windowTicks
) {

  const output = {

    cases:
      rows.length
  };


  for (
    const field
    of ECONOMIC_COUNTER_FIELDS
  ) {

    const observations =
      rows.map(
        row =>
          row
            .sourceEvidence[
              String(
                windowTicks
              )
            ]
            .counters[
              field
            ]
      );


    const present =
      observations.filter(
        row =>
          row.present
      );


    output[
      field
    ] = {

      present:
        present.length,

      presenceRate:
        rate(
          present.length,
          rows.length
        ),

      totalDelta:
        summarizeNumbers(
          observations.map(
            row =>
              row.totalDelta
          )
      )
    };
  }


  // ----------------------------------------------------------
  // GROUND COUNTER VS PREDICTED GROUND COMPONENT
  // ----------------------------------------------------------

  const groundResiduals =
    [];


  const airResiduals =
    [];


  const combinedCounterResiduals =
    [];


  const airExcessResiduals =
    [];


  let groundComparable =
    0;


  let airComparable =
    0;


  let combinedComparable =
    0;


  for (
    const row
    of rows
  ) {

    const evidence =
      row
        .sourceEvidence[
          String(
            windowTicks
          )
        ]
        .counters;


    const ground =
      evidence
        .m_iCreepGoldGroundOrb
        .totalDelta;


    const air =
      evidence
        .m_iCreepGoldAirOrb
        .totalDelta;


    // --------------------------------------------------------
    // Compare even zero counter amount.
    //
    // Presence separately tells us whether a named field changed.
    // --------------------------------------------------------

    if (
      Number.isFinite(
        ground
      )
    ) {

      groundComparable++;


      groundResiduals.push(
        ground -
        row.predictedGround
      );
    }


    if (
      Number.isFinite(
        air
      )
    ) {

      airComparable++;


      airResiduals.push(
        air -
        row.predictedFlying
      );


      airExcessResiduals.push(
        air -
        row.excessAboveGround
      );
    }


    if (
      Number.isFinite(
        ground
      )
      &&
      Number.isFinite(
        air
      )
    ) {

      combinedComparable++;


      combinedCounterResiduals.push(
        (
          ground +
          air
        )
        -
        row.teamTotal
      );
    }
  }


  output.groundCounterVsPredictedGround =
    buildResidualMetrics(
      groundResiduals,
      groundComparable
    );


  output.airCounterVsPredictedFlying =
    buildResidualMetrics(
      airResiduals,
      airComparable
    );


  output.airCounterVsExcess =
    buildResidualMetrics(
      airExcessResiduals,
      airComparable
    );


  output.groundPlusAirCounterVsObserved =
    buildResidualMetrics(
      combinedCounterResiduals,
      combinedComparable
    );


  return output;
}


// ============================================================
// RESIDUAL METRICS
// ============================================================

function buildResidualMetrics(
  residuals,
  comparable
) {

  const clean =
    residuals.filter(
      Number.isFinite
    );


  const absolute =
    clean.map(
      Math.abs
    );


  return {

    comparable,

    residual:
      summarizeNumbers(
        clean
      ),

    absoluteError:
      summarizeNumbers(
        absolute
      ),

    exact:
      absolute.filter(
        value =>
          value <
          1e-9
      ).length,

    exactRate:
      rate(

        absolute.filter(
          value =>
            value <
            1e-9
        ).length,

        clean.length
      ),

    within1:
      absolute.filter(
        value =>
          value <=
          1
      ).length,

    within1Rate:
      rate(

        absolute.filter(
          value =>
            value <=
            1
        ).length,

        clean.length
      ),

    within2:
      absolute.filter(
        value =>
          value <=
          2
      ).length,

    within2Rate:
      rate(

        absolute.filter(
          value =>
            value <=
            2
        ).length,

        clean.length
      )
  };
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
      row.actualSecondComponent
      &&
      row.airCounterPresent
    ) {

      tp++;

    } else if (
      row.actualSecondComponent
      &&
      !row.airCounterPresent
    ) {

      fn++;

    } else if (
      !row.actualSecondComponent
      &&
      row.airCounterPresent
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
// REPLAY SUPPORT
// ============================================================

function evaluateReplaySupport({

  evidenceCases,

  primaryWindow,

  positiveDeltaCounts
}) {

  const groundOnlyCount =
    evidenceCases.filter(
      row =>
        row.componentClass ===
        'GROUND_ONLY'
    ).length;


  const secondCount =
    evidenceCases.filter(
      row =>
        row.componentClass ===
        'GROUND_PLUS_SECOND_COMPONENT'
    ).length;


  const informative =
    evidenceCases.length >=
      50
    &&
    groundOnlyCount >=
      20
    &&
    secondCount >=
      10;


  const groundCounterPositiveEvents =
    positiveDeltaCounts
      .m_iCreepGoldGroundOrb
    ??
    0;


  const airCounterPositiveEvents =
    positiveDeltaCounts
      .m_iCreepGoldAirOrb
    ??
    0;


  const groundPresence =
    primaryWindow
      ?.all
      ?.m_iCreepGoldGroundOrb
      ?.presenceRate
    ??
    0;


  const groundAmountWithin2 =
    primaryWindow
      ?.all
      ?.groundCounterVsPredictedGround
      ?.within2Rate
    ??
    0;


  const groundCounterValidated =
    informative
    &&
    groundCounterPositiveEvents >
      0
    &&
    groundPresence >=
      0.80
    &&
    groundAmountWithin2 >=
      0.70;


  const airAssociation =
    primaryWindow
      ?.airOrbAssociation
    ??
    {};


  const airAmountVsExcess =
    primaryWindow
      ?.secondComponent
      ?.airCounterVsExcess
      ?.within2Rate
    ??
    0;


  const combinedAmount =
    primaryWindow
      ?.all
      ?.groundPlusAirCounterVsObserved
      ?.within2Rate
    ??
    0;


  const directAirOrbSourceSupported =
    informative
    &&
    airCounterPositiveEvents >
      0
    &&
    (
      airAssociation.sensitivity ??
      0
    ) >=
      0.80
    &&
    (
      airAssociation.specificity ??
      0
    ) >=
      0.80
    &&
    (
      airAssociation.mcc ??
      -1
    ) >=
      0.65
    &&
    airAmountVsExcess >=
      0.75
    &&
    combinedAmount >=
      0.80;


  const citemxpSecond =
    primaryWindow
      ?.citemxpTermination
      ?.secondComponentPresenceRate
    ??
    0;


  const citemxpGround =
    primaryWindow
      ?.citemxpTermination
      ?.groundOnlyPresenceRate
    ??
    0;


  const citemxpTerminationAssociationSupported =
    informative
    &&
    citemxpSecond >=
      0.75
    &&
    (
      citemxpSecond -
      citemxpGround
    ) >=
      0.40;


  return {

    informative,

    groundCounterValidated,

    directAirOrbSourceSupported,

    citemxpTerminationAssociationSupported,


    criteria: {

      eligibleCases:
        evidenceCases.length,

      groundOnlyCases:
        groundOnlyCount,

      secondComponentCases:
        secondCount,

      groundCounterPositiveEvents,

      airCounterPositiveEvents,

      groundPresence,

      groundAmountWithin2,

      airSensitivity:
        airAssociation.sensitivity
        ??
        null,

      airSpecificity:
        airAssociation.specificity
        ??
        null,

      airMCC:
        airAssociation.mcc
        ??
        null,

      airAmountVsExcessWithin2:
        airAmountVsExcess,

      groundPlusAirVsObservedWithin2:
        combinedAmount,

      citemxpSecondPresence:
        citemxpSecond,

      citemxpGroundPresence:
        citemxpGround
    }
  };
}


// ============================================================
// RECONSTRUCT SCRIPT106 CASES
// ============================================================

function buildStrictMatches(
  deaths,
  activations
) {

  const economicDeaths =
    deaths.filter(
      row =>
        row.economicBaseType ===
        true
    );


  const activationsByTick =
    groupBy(
      activations,
      row =>
        Number(
          row.activationTick
        )
    );


  const deathCandidates =
    new Map();


  const activationCandidates =
    new Map();


  for (
    const death
    of economicDeaths
  ) {

    const deathId =
      String(
        death.deathIndex ??
        `${death.entityIndex}|${death.tick}`
      );


    const candidates =
      [];


    for (
      let tick =
        Number(
          death.tick
        )
        +
        MATCH_MIN_TICK_OFFSET;

      tick <=
        Number(
          death.tick
        )
        +
        MATCH_MAX_TICK_OFFSET;

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


        const edgeDistance =
          distance3D(
            death.position,
            activation.position
          );


        if (
          edgeDistance >
          MATCH_MAX_DISTANCE_3D_HU
        ) {

          continue;
        }


        const activationId =
          String(
            activation.activationId
          );


        const edge = {

          death,

          activation,

          deathId,

          activationId,

          edgeDistance
        };


        candidates.push(
          edge
        );


        if (
          !activationCandidates.has(
            activationId
          )
        ) {

          activationCandidates.set(
            activationId,
            []
          );
        }


        activationCandidates
          .get(
            activationId
          )
          .push(
            edge
          );
      }
    }


    deathCandidates.set(
      deathId,
      candidates
    );
  }


  const strict =
    [];


  for (
    const candidates
    of deathCandidates.values()
  ) {

    if (
      candidates.length !==
      1
    ) {

      continue;
    }


    const edge =
      candidates[0];


    const reverse =
      activationCandidates.get(
        edge.activationId
      )
      ??
      [];


    if (
      reverse.length !==
      1
    ) {

      continue;
    }


    strict.push(
      edge
    );
  }


  return strict;
}


// ============================================================
// CLEAN ECONOMIC CASES
// ============================================================

function buildCleanEconomicCases(
  strictMatches,
  currencyEvents
) {

  const currencyByTick =
    groupBy(
      currencyEvents,
      row =>
        Number(
          row.tick
        )
    );


  const provisional =
    [];


  for (
    const edge
    of strictMatches
  ) {

    const death =
      edge.death;


    const activation =
      edge.activation;


    const credited =
      death
        ?.lastHitEvidence
        ?.uniqueExactOpposing
      ??
      null;


    if (
      !credited
    ) {

      continue;
    }


    const creditedName =
      credited.playerName
      ??
      null;


    const creditedTeam =
      finite(
        credited.team
      );


    const endTick =
      finite(
        activation.endTick
      );


    if (
      !creditedName
      ||
      creditedTeam ===
        null
      ||
      endTick ===
        null
    ) {

      continue;
    }


    const exact =
      aggregateCurrencyEvents(
        currencyByTick.get(
          endTick
        )
        ??
        []
      );


    const sameTeam =
      exact.filter(
        row =>
          row.team ===
            creditedTeam
        &&
          row.delta >
            0
      );


    const opponents =
      exact.filter(
        row =>
          row.team !==
            null
        &&
          row.team !==
            creditedTeam
        &&
          row.delta >
            0
      );


    const creditedRecipient =
      sameTeam.find(
        row =>
          row.playerName ===
          creditedName
      )
      ??
      null;


    provisional.push({

      death,

      activation,

      creditedTeam,

      creditedName,

      endTick,

      sameTeam,

      opponents,

      creditedRecipient
    });
  }


  // ----------------------------------------------------------
  // ONE MATCHED GROUND-SOUL TERMINATION PER TEAM/TICK
  // ----------------------------------------------------------

  const eventCount =
    new Map();


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    eventCount.set(

      key,

      (
        eventCount.get(
          key
        )
        ??
        0
      )
      +
      1
    );
  }


  const output =
    [];


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    if (
      eventCount.get(
        key
      ) !==
      1
    ) {

      continue;
    }


    if (
      row.activation.endReason !==
      'BECAME_INACTIVE'
    ) {

      continue;
    }


    if (
      row.sameTeam.length ===
      0
    ) {

      continue;
    }


    if (
      row.opponents.length !==
      0
    ) {

      continue;
    }


    if (
      !row.creditedRecipient
    ) {

      continue;
    }


    const teamTotal =
      row.sameTeam.reduce(
        (
          sum,
          player
        ) =>
          sum +
          player.delta,
        0
      );


    const recipientCount =
      row.sameTeam.length;


    const minute =
      Number(
        row.death.timeSeconds
      )
      /
      60;


    const teamState =
      classifyTeamNetWorthState(
        row.death.playersAtDeath,
        row.creditedTeam
      );


    const hp =
      classifyNormalHpLike(
        row.death
      );


    output.push({

      death:
        row.death,

      activation:
        row.activation,

      creditedTeam:
        row.creditedTeam,

      creditedName:
        row.creditedName,

      endTick:
        row.endTick,

      teamTotal,

      recipientCount,

      minute,

      teamState,

      normalHpLike:
        hp.normalHpLike,

      baseHp:
        hp.baseHp,

      hpRatio:
        hp.hpRatio,

      sameTeamRecipients:
        row.sameTeam
    });
  }


  return output;
}


// ============================================================
// ELIGIBLE CASE
// ============================================================

function isEligibleCase(
  row
) {

  if (
    !Number.isFinite(
      row.minute
    )
    ||
    row.minute <
      0
    ||
    row.minute >=
      35
  ) {

    return false;
  }


  if (
    row.teamState !==
    'LEADING'
  ) {

    return false;
  }


  if (
    row.normalHpLike !==
    true
  ) {

    return false;
  }


  const multiplier =
    SHARE_TOTAL_MULTIPLIER.get(
      row.recipientCount
    );


  if (
    !Number.isFinite(
      multiplier
    )
  ) {

    return false;
  }


  row.shareMultiplier =
    multiplier;


  return true;
}


// ============================================================
// CLASSIFY SCRIPT106 REWARD COMPONENT
// ============================================================

function classifyRewardCase(
  row,
  rounding
) {

  const totalBounty =
    POST_TOTAL_INTERCEPT

    +

    POST_TOTAL_SLOPE *
    row.minute;


  const predictedGround =
    applyRounding(

      totalBounty
      *
      POST_GROUND_FRACTION
      *
      row.shareMultiplier,

      rounding
    );


  const predictedFlying =
    applyRounding(

      totalBounty
      *
      POST_FLYING_FRACTION
      *
      row.shareMultiplier,

      rounding
    );


  const predictedCombined =
    predictedGround +
    predictedFlying;


  const groundError =
    Math.abs(
      row.teamTotal -
      predictedGround
    );


  const combinedError =
    Math.abs(
      row.teamTotal -
      predictedCombined
    );


  const componentClass =
    combinedError <
      groundError
      ? 'GROUND_PLUS_SECOND_COMPONENT'
      : 'GROUND_ONLY';


  return {

    ...row,

    rounding,

    totalBounty,

    predictedGround,

    predictedFlying,

    predictedCombined,

    excessAboveGround:
      row.teamTotal -
      predictedGround,

    groundOnlyAbsoluteError:
      groundError,

    combinedAbsoluteError:
      combinedError,

    componentClass
  };
}


// ============================================================
// CURRENCY AGGREGATION
// ============================================================

function aggregateCurrencyEvents(
  events
) {

  const map =
    new Map();


  for (
    const event
    of events
  ) {

    const playerName =
      event.playerName
      ??
      null;


    const delta =
      finite(
        event.delta
      );


    if (
      !playerName
      ||
      delta ===
        null
      ||
      delta <=
        0
    ) {

      continue;
    }


    if (
      !map.has(
        playerName
      )
    ) {

      map.set(

        playerName,

        {

          playerName,

          team:
            finite(
              event.team
            ),

          delta:
            0
        }
      );
    }


    map.get(
      playerName
    ).delta +=
      delta;
  }


  return [
    ...map.values()
  ];
}


// ============================================================
// NORMAL HP SCREEN
// ============================================================

function classifyNormalHpLike(
  death
) {

  const baseHp =
    NORMAL_BASE_HP.get(
      death.baseType
    )
    ??
    null;


  const maxHealth =
    finite(
      death.maxHealth
    );


  if (
    !Number.isFinite(
      baseHp
    )
    ||
    maxHealth ===
      null
    ||
    maxHealth <=
      0
  ) {

    return {

      normalHpLike:
        false,

      baseHp,

      hpRatio:
        null
    };
  }


  const hpRatio =
    maxHealth /
    baseHp;


  return {

    normalHpLike:

      hpRatio >=
      0.90

      &&

      hpRatio <=
      MAX_NORMAL_HP_RATIO,

    baseHp,

    hpRatio
  };
}


// ============================================================
// TEAM NET WORTH
// ============================================================

function classifyTeamNetWorthState(
  players,
  creditedTeam
) {

  if (
    !Array.isArray(
      players
    )
  ) {

    return 'UNKNOWN';
  }


  const totals =
    new Map();


  for (
    const player
    of players
  ) {

    const team =
      finite(
        player.team
      );


    const netWorth =
      finite(
        player.netWorth
      );


    if (
      team ===
        null
      ||
      netWorth ===
        null
    ) {

      continue;
    }


    totals.set(

      team,

      (
        totals.get(
          team
        )
        ??
        0
      )
      +
      netWorth
    );
  }


  if (
    !totals.has(
      creditedTeam
    )
  ) {

    return 'UNKNOWN';
  }


  const own =
    totals.get(
      creditedTeam
    );


  const opponentTotals =
    [
      ...totals.entries()
    ]
      .filter(
        (
          [
            team
          ]
        ) =>
          team !==
          creditedTeam
      )
      .map(
        (
          [
            team,
            value
          ]
        ) =>
          value
      );


  if (
    opponentTotals.length ===
    0
  ) {

    return 'UNKNOWN';
  }


  const opponent =
    Math.max(
      ...opponentTotals
    );


  if (
    own >
    opponent
  ) {

    return 'LEADING';
  }


  if (
    own <
    opponent
  ) {

    return 'TRAILING';
  }


  return 'TIED';
}


// ============================================================
// ROUNDING
// ============================================================

function applyRounding(
  value,
  rounding
) {

  switch (
    rounding
  ) {

    case 'FLOOR':

      return Math.floor(
        value
      );


    case 'ROUND':

      return Math.round(
        value
      );


    case 'CEIL':

      return Math.ceil(
        value
      );


    default:

      return value;
  }
}


// ============================================================
// ENTITY HELPERS
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

function distance3D(
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


  const x1 =
    finite(
      a.x
    );


  const y1 =
    finite(
      a.y
    );


  const z1 =
    finite(
      a.z
    );


  const x2 =
    finite(
      b.x
    );


  const y2 =
    finite(
      b.y
    );


  const z2 =
    finite(
      b.z
    );


  if (
    x1 ===
      null
    ||
    y1 ===
      null
    ||
    x2 ===
      null
    ||
    y2 ===
      null
  ) {

    return Infinity;
  }


  const dz =
    z1 !==
      null
    &&
    z2 !==
      null
      ? z1 -
        z2
      : 0;


  return Math.sqrt(

    (
      x1 -
      x2
    )
    ** 2

    +

    (
      y1 -
      y2
    )
    ** 2

    +

    dz
    ** 2
  );
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
// GENERAL HELPERS
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
    map
  );
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
// VALUE NORMALIZATION
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
// CONSOLE
// ============================================================

function printReplayResult(
  row
) {

  const primary =
    row.primaryWindow;


  console.log('');

  console.log(
    `Eligible cases:             ${row.caseCounts.eligibleCases}`
  );


  console.log(
    `Ground only:                ${row.caseCounts.groundOnly}`
  );


  console.log(
    `Second component:           ${row.caseCounts.secondComponent} (${formatPercent(
      row.caseCounts.secondComponentRate
    )})`
  );


  console.log('');

  console.log(
    'RAW NAMED COUNTERS'
  );


  console.log(
    `  GroundOrb +delta events:  ${row.extraction.positiveDeltaCounts.m_iCreepGoldGroundOrb}`
  );


  console.log(
    `  AirOrb +delta events:     ${row.extraction.positiveDeltaCounts.m_iCreepGoldAirOrb}`
  );


  console.log('');

  console.log(
    `PRIMARY ±${PRIMARY_COUNTER_WINDOW}-TICK WINDOW`
  );


  console.log(
    `  Ground counter all:       ${formatPercent(
      primary
        ?.all
        ?.m_iCreepGoldGroundOrb
        ?.presenceRate
    )}`
  );


  console.log(
    `  Air counter ground-only:  ${formatPercent(
      primary
        ?.groundOnly
        ?.m_iCreepGoldAirOrb
        ?.presenceRate
    )}`
  );


  console.log(
    `  Air counter second-comp:  ${formatPercent(
      primary
        ?.secondComponent
        ?.m_iCreepGoldAirOrb
        ?.presenceRate
    )}`
  );


  console.log(
    `  Air sensitivity:          ${formatPercent(
      primary
        ?.airOrbAssociation
        ?.sensitivity
    )}`
  );


  console.log(
    `  Air specificity:          ${formatPercent(
      primary
        ?.airOrbAssociation
        ?.specificity
    )}`
  );


  console.log(
    `  Air MCC:                  ${formatNumber(
      primary
        ?.airOrbAssociation
        ?.mcc
    )}`
  );


  console.log(
    `  Air amount vs excess <=2: ${formatPercent(
      primary
        ?.secondComponent
        ?.airCounterVsExcess
        ?.within2Rate
    )}`
  );


  console.log(
    `  Ground+Air vs total <=2:  ${formatPercent(
      primary
        ?.all
        ?.groundPlusAirCounterVsObserved
        ?.within2Rate
    )}`
  );


  console.log(
    `  CItemXP term ground-only: ${formatPercent(
      primary
        ?.citemxpTermination
        ?.groundOnlyPresenceRate
    )}`
  );


  console.log(
    `  CItemXP term second-comp: ${formatPercent(
      primary
        ?.citemxpTermination
        ?.secondComponentPresenceRate
    )}`
  );


  console.log('');

  console.log(
    'SUPPORT'
  );


  console.log(
    `  informative:              ${row.support.informative}`
  );


  console.log(
    `  ground counter validated: ${row.support.groundCounterValidated}`
  );


  console.log(
    `  direct AirOrb source:     ${row.support.directAirOrbSourceSupported}`
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
    '# Second Reward Component Source Validation'
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.sourceStatus}**`
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
    'Does the second reward component isolated by Script106 correspond directly to the named `m_iCreepGoldAirOrb` economic counter?'
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

    const primary =
      replay.primaryWindow;


    lines.push(
      `### ${replay.replay}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Eligible cases: ${replay.caseCounts.eligibleCases}`
    );


    lines.push(
      `- Second-component cases: ${replay.caseCounts.secondComponent} (${formatPercent(replay.caseCounts.secondComponentRate)})`
    );


    lines.push(
      `- Positive GroundOrb counter events: ${replay.extraction.positiveDeltaCounts.m_iCreepGoldGroundOrb}`
    );


    lines.push(
      `- Positive AirOrb counter events: ${replay.extraction.positiveDeltaCounts.m_iCreepGoldAirOrb}`
    );


    lines.push(
      `- Ground counter presence, all cases: ${formatPercent(primary?.all?.m_iCreepGoldGroundOrb?.presenceRate)}`
    );


    lines.push(
      `- Air counter presence, ground-only cases: ${formatPercent(primary?.groundOnly?.m_iCreepGoldAirOrb?.presenceRate)}`
    );


    lines.push(
      `- Air counter presence, second-component cases: ${formatPercent(primary?.secondComponent?.m_iCreepGoldAirOrb?.presenceRate)}`
    );


    lines.push(
      `- Air association MCC: ${formatNumber(primary?.airOrbAssociation?.mcc)}`
    );


    lines.push(
      `- Air counter vs excess within ±2 souls: ${formatPercent(primary?.secondComponent?.airCounterVsExcess?.within2Rate)}`
    );


    lines.push(
      `- Ground + Air counters vs observed total within ±2 souls: ${formatPercent(primary?.all?.groundPlusAirCounterVsObserved?.within2Rate)}`
    );


    lines.push(
      `- Direct AirOrb source supported: **${replay.support.directAirOrbSourceSupported}**`
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