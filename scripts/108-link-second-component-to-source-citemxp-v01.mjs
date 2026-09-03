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
  'SECOND_COMPONENT_SOURCE_CITEMXP_LINK_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// Script107 attempted to use:
//
//   m_iCreepGoldGroundOrb
//   m_iCreepGoldAirOrb
//
// as live economic counters.
//
// Prior test.dem diagnostics had already shown those fields are
// serialized but remain zero throughout the replay.
//
// Script108 therefore abandons those inert counters.
//
// Instead:
//
//   1. Reconstruct Script106's eligible ground-soul cases.
//   2. Extract logical CItemXP episodes.
//   3. Link each CItemXP launch to its SOURCE Trooper death using
//      the previously validated launch-time + spawn-geometry
//      relationship.
//   4. Compare the SAME Trooper's:
//
//          AssignedGold termination tick
//          CItemXP resolution tick
//
//      against Script106's latent reward class:
//
//          GROUND_ONLY
//          GROUND_PLUS_SECOND_COMPONENT
//
//   5. Use m_iGoldNetWorth around the linked CItemXP resolution
//      as a secondary economy-positive-control.
//
// The key causal/mechanistic distinction:
//
//   generic nearby CItemXP termination
//
// is NOT equivalent to:
//
//   the CItemXP produced by this exact source Trooper.
//
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const FORCE_REEXTRACTION =
  process.argv.includes(
    '--force'
  );


const TICK_RATE =
  64;


// ============================================================
// SCRIPT106 ECONOMIC CASE SETTINGS
// ============================================================

const MATCH_MIN_TICK_OFFSET =
  -1;


const MATCH_MAX_TICK_OFFSET =
  4;


const MATCH_MAX_DISTANCE_3D_HU =
  160;


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
// POST-JUNE-30 ECONOMY
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
// CITEMXP SOURCE-LINK SETTINGS
//
// Frozen from the prior Trooper -> CItemXP source work.
//
// Candidate:
//   episode starts deathTick-1 ... deathTick+4
//   start position <=250 HU 3D from Trooper death
//
// We use mutually unique candidates as the PRIMARY cohort.
//
// A broader nearest candidate is reported only diagnostically.
// ============================================================

const XP_SOURCE_MIN_TICK_OFFSET =
  -1;


const XP_SOURCE_MAX_TICK_OFFSET =
  4;


const XP_SOURCE_MAX_DISTANCE_3D_HU =
  250;


// ============================================================
// LOGICAL CITEMXP EPISODE SETTINGS
//
// Mirrors the earlier CItemXP source-classification logic.
// ============================================================

const XP_REUSE_POSITION_JUMP_HU =
  500;


const XP_MIN_TICKS_BEFORE_POSITION_REUSE =
  4;


// ============================================================
// PRIMARY CO-RESOLUTION WINDOW
//
// PREDECLARED.
//
// Script69's independently calibrated CItemXP economy window was
// P0_P6.
//
// Here we compare two independently observed lifecycle anchors.
//
// A ±6 tick tolerance permits packet/update ordering differences
// without fitting the threshold on these replication cases.
// ============================================================

const PRIMARY_CORESOLUTION_WINDOW_TICKS =
  6;


const CORESOLUTION_WINDOWS_TICKS =
  [
    0,
    2,
    4,
    6,
    8,
    16,
    32,
    64
  ];


// ============================================================
// NET-WORTH ECONOMIC CONFIRMATION
//
// Previous CItemXP validation identified a 0..+6-tick economy
// window after CItemXP resolution.
//
// We reuse that timing envelope rather than tuning a new one.
//
// Because recipient count / sharing can change magnitude, we
// compare TEAM positive net-worth gain against the expected
// flying-team-total magnitude.
//
// This is supporting evidence, NOT required to define the
// lifecycle coincidence itself.
// ============================================================

const NETWORTH_BEFORE_TICKS =
  0;


const NETWORTH_AFTER_TICKS =
  6;


const MIN_EXPECTED_ECONOMY_RATIO =
  0.75;


// ============================================================
// CROSS-REPLAY SUPPORT THRESHOLDS
//
// Predeclared before inspecting Script108 results.
// ============================================================

const SUPPORT = {

  minimumLinkedEligibleCases:
    100,

  minimumLinkedGroundOnlyCases:
    50,

  minimumLinkedSecondCases:
    20,

  minimumSourceMatchRate:
    0.70,

  minimumSecondCoResolutionSensitivity:
    0.70,

  minimumGroundOnlyCoResolutionSpecificity:
    0.70,

  minimumCoResolutionMCC:
    0.40,

  minimumSecondEconomicallyConfirmedRate:
    0.70,

  minimumSecondMinusGroundCoResolutionDifference:
    0.40
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


const SCRIPT106_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_mixture_outlier_diagnostic_v02.json'
  );


const SCRIPT107_PATH =
  resolve(
    'output',
    'cross_replay',
    'second_reward_component_source_validation_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'second_component_source_citemxp_link_validation_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'second_component_source_citemxp_link_validation_v01.md'
  );


// ============================================================
// REQUIRED GLOBAL INPUTS
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT106_PATH,
    SCRIPT107_PATH
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


const script107 =
  JSON.parse(
    readFileSync(
      SCRIPT107_PATH,
      'utf8'
    )
  );


if (
  manifest
    ?.readyToBeginReplication !==
  true
) {

  throw new Error(
    'Replication manifest is not ready.'
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
    'No independent replay cohort.'
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
  'SOURCE-LINKED CITEMXP SECOND-COMPONENT VALIDATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'SCRIPT107 INTERPRETATION'
);

console.log(
  '------------------------'
);


console.log(
  'm_iCreepGoldGroundOrb / AirOrb are abandoned as live counters.'
);


console.log(
  'The remaining test links the exact Trooper to its own CItemXP.'
);


console.log('');

console.log(
  `Independent replay units:       ${cohort.length}`
);


console.log(
  `Primary co-resolution window:   ±${PRIMARY_CORESOLUTION_WINDOW_TICKS} ticks`
);


console.log(
  `CItemXP source radius:           ${XP_SOURCE_MAX_DISTANCE_3D_HU} HU`
);


console.log(
  `Source start-tick window:        ${XP_SOURCE_MIN_TICK_OFFSET}..+${XP_SOURCE_MAX_TICK_OFFSET}`
);


console.log(
  `Force CItemXP re-extraction:     ${FORCE_REEXTRACTION}`
);


console.log('');


// ============================================================
// RUN REPLAYS
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
// CROSS-REPLAY SUPPORT
// ============================================================

const informativeReplays =
  replayResults.filter(
    row =>
      row
        ?.support
        ?.informative ===
      true
  );


const supportedReplays =
  informativeReplays.filter(
    row =>
      row
        ?.support
        ?.sameSourceCItemXPSecondComponentSupported ===
      true
  );


const strongEconomicConfirmationReplays =
  informativeReplays.filter(
    row =>
      row
        ?.support
        ?.economicConfirmationSupported ===
      true
  );


let status;


if (
  informativeReplays.length <
  3
) {

  status =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  supportedReplays.length >=
    4
  &&
  strongEconomicConfirmationReplays.length >=
    4
) {

  status =
    'SECOND_COMPONENT_SAME_SOURCE_CITEMXP_PAYOUT_STRONGLY_SUPPORTED';

} else if (
  supportedReplays.length >=
    4
) {

  status =
    'SECOND_COMPONENT_SAME_SOURCE_CITEMXP_RESOLUTION_STRONGLY_SUPPORTED_ECONOMIC_CONFIRMATION_INCOMPLETE';

} else if (
  supportedReplays.length >=
    3
) {

  status =
    'SECOND_COMPONENT_SAME_SOURCE_CITEMXP_RESOLUTION_SUPPORTED';

} else {

  status =
    'SECOND_COMPONENT_SOURCE_STILL_UNRESOLVED';
}


// ============================================================
// REPLAY-LEVEL DISTRIBUTIONS
// ============================================================

const distributions = {

  sourceMatchRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.sourceLink
            ?.eligibleSourceMatchRate
      )
    ),


  sourceTickDelta:
    summarizeNumbers(
      replayResults
        .flatMap(
          row =>
            row
              ?.sourceLink
              ?.strictSourceTickDeltas ??
            []
        )
    ),


  sourceDistanceXY:
    summarizeNumbers(
      replayResults
        .flatMap(
          row =>
            row
              ?.sourceLink
              ?.strictSourceDistancesXY ??
            []
        )
    ),


  sourceDistance3D:
    summarizeNumbers(
      replayResults
        .flatMap(
          row =>
            row
              ?.sourceLink
              ?.strictSourceDistances3D ??
            []
        )
    ),


  secondCoResolutionRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.secondComponent
            ?.coResolutionRate
      )
    ),


  groundOnlyCoResolutionRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.groundOnly
            ?.coResolutionRate
      )
    ),


  coResolutionMCC:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.association
            ?.mcc
      )
    ),


  secondEconomyConfirmationRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.primaryWindow
            ?.secondComponent
            ?.economicallyConfirmedCoResolutionRate
      )
    ),


  secondResolutionOffsetTicks:
    summarizeNumbers(
      replayResults
        .flatMap(
          row =>
            row
              ?.resolutionOffsets
              ?.secondComponent ??
            []
        )
    ),


  groundOnlyResolutionOffsetTicks:
    summarizeNumbers(
      replayResults
        .flatMap(
          row =>
            row
              ?.resolutionOffsets
              ?.groundOnly ??
            []
        )
    )
};


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation;


if (
  status ===
  'SECOND_COMPONENT_SAME_SOURCE_CITEMXP_PAYOUT_STRONGLY_SUPPORTED'
) {

  interpretation = {

    secondComponentResolved:
      true,

    semanticStatus:
      'CROSS_REPLAY_STRONGLY_SUPPORTED',

    conclusion:
      'Script106 second-component events are strongly associated with near-synchronous resolution of the CItemXP spawned by the same Trooper, and those CItemXP resolution windows independently carry the expected net-worth economy signal.',

    operationalMeaning:
      'The high reward observations should be treated as concurrent ground AssignedGold plus same-source flying CItemXP payout rather than as an enlarged ground-soul bounty.',

    rewardModel:
      'Ordinary post-June ground reward remains approximately 50 + 1/min before sharing/modifiers. The equal-sized second component is the concurrent flying-soul reward.',

    nextStage:
      'Close foundational reward magnitude/source semantics and move to behavioral opportunity-feature construction.'
  };

} else if (
  status ===
  'SECOND_COMPONENT_SAME_SOURCE_CITEMXP_RESOLUTION_STRONGLY_SUPPORTED_ECONOMIC_CONFIRMATION_INCOMPLETE'
) {

  interpretation = {

    secondComponentResolved:
      false,

    semanticStatus:
      'SOURCE_IDENTITY_STRONGLY_SUPPORTED_ECONOMIC_CONFIRMATION_INCOMPLETE',

    conclusion:
      'The second-component class strongly tracks near-synchronous resolution of the same source Trooper CItemXP, but the independent net-worth confirmation is not sufficiently complete to call the payout source fully resolved.',

    nextStage:
      'Inspect only the linked CItemXP economy confirmation failures.'
  };

} else if (
  status ===
  'SECOND_COMPONENT_SAME_SOURCE_CITEMXP_RESOLUTION_SUPPORTED'
) {

  interpretation = {

    secondComponentResolved:
      false,

    semanticStatus:
      'SUPPORTED_NOT_STRONG',

    conclusion:
      'Same-source CItemXP resolution is associated with the second component, but replication strength is not yet sufficient for promotion.',

    nextStage:
      'Inspect replay-level failures rather than reopening ground-soul mechanics.'
  };

} else {

  interpretation = {

    secondComponentResolved:
      false,

    semanticStatus:
      'UNRESOLVED',

    conclusion:
      'The second component does not consistently coincide with resolution of the same source Trooper CItemXP under the predeclared timing/source-link rules.',

    nextStage:
      'The flying-soul coincidence hypothesis is not sufficient; characterize the second-component cases by competing exact reward sources.'
  };
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    VERSION,

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  status,


  script107Audit: {

    priorStatus:
      script107?.sourceStatus ??
      null,

    inertNamedCounters:
      [
        'm_iCreepGoldGroundOrb',
        'm_iCreepGoldAirOrb'
      ],

    interpretation:
      'Zero deltas in Script107 are treated as failure of those fields as live telemetry, not evidence against a flying-soul payout.'
  },


  design: {

    replicationUnit:
      'REPLAY',

    sourceLink:
      'Mutually unique Trooper death ↔ CItemXP logical-episode candidates using launch tick -1..+4 and <=250 HU 3D spawn geometry.',

    primaryCoResolutionWindowTicks:
      PRIMARY_CORESOLUTION_WINDOW_TICKS,

    windowsReported:
      CORESOLUTION_WINDOWS_TICKS,

    citemxpResolutionAnchor:
      'First observed LEAVE/DELETE tick for the logical episode; unresolved episodes without an end anchor are excluded from resolution-timing analysis.',

    economicPositiveControl:
      'Positive team m_iGoldNetWorth in the pre-existing Script69-style 0..+6 tick post-resolution window, compared against 75% of expected flying-team-total magnitude.',

    secondComponentClassification:
      'Reconstructed from Script106 post-June ground-only versus ground+equal-flying model using each replay own selected mixture rounding.',

    sourceClaimCaution:
      'Temporal source coincidence plus independent economy signal supports payout attribution observationally; it is not an engine-code proof.'
  },


  thresholds:
    SUPPORT,


  replayCounts: {

    total:
      replayResults.length,

    informative:
      informativeReplays.length,

    sameSourceSupported:
      supportedReplays.length,

    economicConfirmationSupported:
      strongEconomicConfirmationReplays.length
  },


  distributions,

  replays:
    replayResults,

  interpretation,


  outputs: {

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
  'SOURCE-LINKED CITEMXP SUMMARY'
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

    `linked=${formatPercent(
      row.sourceLink.eligibleSourceMatchRate
    ).padEnd(8)} ` +

    `second=${formatPercent(
      row.primaryWindow.secondComponent.coResolutionRate
    ).padEnd(8)} ` +

    `ground=${formatPercent(
      row.primaryWindow.groundOnly.coResolutionRate
    ).padEnd(8)} ` +

    `MCC=${formatNumber(
      row.primaryWindow.association.mcc
    ).padEnd(7)} ` +

    `support=${row.support.sameSourceCItemXPSecondComponentSupported}`
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
  `Source-match rate:              ${formatDistribution(
    distributions.sourceMatchRate
  )}`
);


console.log(
  `Second co-resolution rate:      ${formatDistribution(
    distributions.secondCoResolutionRate
  )}`
);


console.log(
  `Ground-only co-resolution rate: ${formatDistribution(
    distributions.groundOnlyCoResolutionRate
  )}`
);


console.log(
  `Co-resolution MCC:              ${formatDistribution(
    distributions.coResolutionMCC
  )}`
);


console.log(
  `Second economy confirmation:    ${formatDistribution(
    distributions.secondEconomyConfirmationRate
  )}`
);


console.log('');

console.log(
  'FINAL SOURCE STATUS'
);

console.log(
  '-------------------'
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


  const script107CounterPath =
    resolve(
      outputDirectory,
      'replication_reward_source_counter_deltas_v01.jsonl'
    );


  const episodePath =
    resolve(
      outputDirectory,
      'replication_citemxp_source_episodes_v01.jsonl'
    );


  const episodeSummaryPath =
    resolve(
      outputDirectory,
      'replication_citemxp_source_episode_summary_v01.json'
    );


  const caseOutputPath =
    resolve(
      outputDirectory,
      'second_component_source_citemxp_cases_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'second_component_source_citemxp_link_validation_v01.json'
    );


  for (
    const path
    of [
      replayPath,
      deathsPath,
      activationsPath,
      currencyPath,
      script107CounterPath
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
  // RECONSTRUCT SCRIPT106 CASES
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


  const strictGroundMatches =
    buildStrictGroundMatches(
      deaths,
      activations
    );


  const cleanEconomic =
    buildCleanEconomicCases(
      strictGroundMatches,
      currency
    );


  const eligible =
    cleanEconomic.filter(
      isEligibleEconomicCase
    );


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


  const classified =
    eligible.map(
      row =>
        classifyEconomicComponent(
          row,
          mixtureRounding
        )
    );


  // ----------------------------------------------------------
  // CITEMXP LOGICAL EPISODES
  // ----------------------------------------------------------

  let episodes;


  let episodeExtractionSummary;


  if (
    !FORCE_REEXTRACTION
    &&
    existsSync(
      episodePath
    )
    &&
    existsSync(
      episodeSummaryPath
    )
  ) {

    console.log(
      'Existing CItemXP logical episode telemetry found.'
    );


    console.log(
      'Skipping raw replay parse.'
    );


    episodes =
      await loadJsonl(
        episodePath
      );


    episodeExtractionSummary =
      JSON.parse(
        readFileSync(
          episodeSummaryPath,
          'utf8'
        )
      );

  } else {

    console.log(
      'Extracting logical CItemXP episodes...'
    );


    const extraction =
      await extractCItemXPEpisodes(
        replayName,
        replayPath
      );


    episodes =
      extraction.episodes;


    episodeExtractionSummary =
      extraction.summary;


    await writeJsonl(
      episodePath,
      episodes
    );


    writeFileSync(
      episodeSummaryPath,
      JSON.stringify(
        episodeExtractionSummary,
        null,
        2
      ),
      'utf8'
    );
  }


  // ----------------------------------------------------------
  // LINK TROOPER DEATHS TO CITEMXP SOURCE EPISODES
  // ----------------------------------------------------------

  const sourceLink =
    linkDeathsToCItemXPEpisodes(
      classified,
      episodes
    );


  // ----------------------------------------------------------
  // LOAD SCRIPT107 CACHED NET-WORTH DELTAS
  // ----------------------------------------------------------

  const counterRows =
    await loadJsonl(
      script107CounterPath
    );


  const netWorthRows =
    counterRows
      .filter(
        row =>
          row.fieldName ===
            'm_iGoldNetWorth'
        &&
          row.delta >
            0
      )
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
      );


  // ----------------------------------------------------------
  // ATTACH SOURCE EPISODE / RESOLUTION / ECONOMY
  // ----------------------------------------------------------

  const cases =
    classified.map(
      row => {

        const source =
          sourceLink
            .matchByDeathId
            .get(
              row.deathId
            )
          ??
          null;


        if (
          !source
        ) {

          return {

            ...compactEconomicCase(
              row
            ),

            sourceLink:
              null,

            resolution:
              null
          };
        }


        const episode =
          source.episode;


        const resolutionTick =
          finite(
            episode.firstEndTick
          );


        const resolutionOffsetTicks =
          resolutionTick ===
            null
            ? null
            : resolutionTick -
              row.endTick;


        const expectedEconomy =
          measureNetWorthEconomy({

            rows:
              netWorthRows,

            resolutionTick,

            expectedFlyingTeamTotal:
              row.predictedFlying
          });


        return {

          ...compactEconomicCase(
            row
          ),

          sourceLink: {

            method:
              'MUTUAL_UNIQUE_SOURCE_CANDIDATE',

            episodeId:
              episode.episodeId,

            entityIndex:
              episode.entityIndex,

            subclassId:
              episode.subclassId,

            orbTeam:
              episode.team,

            startTick:
              episode.startTick,

            sourceTickDelta:
              source.tickDelta,

            sourceDistanceXY:
              source.distanceXY,

            sourceDistance3D:
              source.distance3D,

            sameTeam:
              source.sameTeam,

            highConfidence:
              source.tickDelta ===
                0
              &&
              source.distanceXY <=
                30
              &&
              source.sameTeam !==
                false
          },

          resolution: {

            tick:
              resolutionTick,

            endReason:
              episode.firstEndReason,

            offsetFromGroundTicks:
              resolutionOffsetTicks,

            offsetFromGroundSeconds:
              resolutionOffsetTicks ===
                null
                ? null
                : resolutionOffsetTicks /
                  TICK_RATE,

            absoluteOffsetTicks:
              resolutionOffsetTicks ===
                null
                ? null
                : Math.abs(
                    resolutionOffsetTicks
                  ),

            economy:
              expectedEconomy
          }
        };
      }
    );


  // ----------------------------------------------------------
  // WINDOW ANALYSIS
  // ----------------------------------------------------------

  const windows =
    {};


  for (
    const windowTicks
    of CORESOLUTION_WINDOWS_TICKS
  ) {

    windows[
      String(
        windowTicks
      )
    ] =
      analyzeCoResolutionWindow(
        cases,
        windowTicks
      );
  }


  const primaryWindow =
    windows[
      String(
        PRIMARY_CORESOLUTION_WINDOW_TICKS
      )
    ];


  // ----------------------------------------------------------
  // OFFSETS
  // ----------------------------------------------------------

  const linkedWithResolution =
    cases.filter(
      row =>
        row.sourceLink
        &&
        Number.isFinite(
          row
            ?.resolution
            ?.offsetFromGroundTicks
        )
    );


  const secondResolutionOffsets =
    linkedWithResolution
      .filter(
        row =>
          row.componentClass ===
          'GROUND_PLUS_SECOND_COMPONENT'
      )
      .map(
        row =>
          row
            .resolution
            .offsetFromGroundTicks
      );


  const groundResolutionOffsets =
    linkedWithResolution
      .filter(
        row =>
          row.componentClass ===
          'GROUND_ONLY'
      )
      .map(
        row =>
          row
            .resolution
            .offsetFromGroundTicks
      );


  // ----------------------------------------------------------
  // SOURCE-LINK SUMMARY
  // ----------------------------------------------------------

  const linked =
    cases.filter(
      row =>
        row.sourceLink
    );


  const strictSourceTickDeltas =
    linked.map(
      row =>
        row
          .sourceLink
          .sourceTickDelta
    );


  const strictSourceDistancesXY =
    linked.map(
      row =>
        row
          .sourceLink
          .sourceDistanceXY
    );


  const strictSourceDistances3D =
    linked.map(
      row =>
        row
          .sourceLink
          .sourceDistance3D
    );


  const highConfidenceLinks =
    linked.filter(
      row =>
        row
          .sourceLink
          .highConfidence ===
        true
    );


  const sourceLinkSummary = {

    eligibleCases:
      cases.length,

    linkedEligibleCases:
      linked.length,

    eligibleSourceMatchRate:
      rate(
        linked.length,
        cases.length
      ),

    highConfidenceLinks:
      highConfidenceLinks.length,

    highConfidenceLinkRate:
      rate(
        highConfidenceLinks.length,
        linked.length
      ),

    strictSourceTickDelta:
      summarizeNumbers(
        strictSourceTickDeltas
      ),

    strictSourceDistanceXY:
      summarizeNumbers(
        strictSourceDistancesXY
      ),

    strictSourceDistance3D:
      summarizeNumbers(
        strictSourceDistances3D
      ),

    strictSourceTickDeltas,

    strictSourceDistancesXY,

    strictSourceDistances3D,

    candidateEdges:
      sourceLink.candidateEdges,

    ambiguousDeaths:
      sourceLink.ambiguousDeaths,

    ambiguousEpisodes:
      sourceLink.ambiguousEpisodes
  };


  // ----------------------------------------------------------
  // SUPPORT
  // ----------------------------------------------------------

  const support =
    evaluateReplaySupport({

      cases,

      sourceLink:
        sourceLinkSummary,

      primaryWindow
    });


  // ----------------------------------------------------------
  // REPLAY RESULT
  // ----------------------------------------------------------

  const result = {

    replay:
      replayName,

    version:
      VERSION,

    canonical:
      false,


    extraction: {

      citemxpEpisodes:
        episodes.length,

      episodeSummary:
        episodeExtractionSummary,

      cachedNetWorthDeltaEvents:
        netWorthRows.length
    },


    economicCases: {

      strictGroundMatches:
        strictGroundMatches.length,

      cleanEconomicCases:
        cleanEconomic.length,

      eligibleCases:
        cases.length,

      mixtureRounding,

      groundOnly:
        cases.filter(
          row =>
            row.componentClass ===
            'GROUND_ONLY'
        ).length,

      secondComponent:
        cases.filter(
          row =>
            row.componentClass ===
            'GROUND_PLUS_SECOND_COMPONENT'
        ).length
    },


    sourceLink:
      sourceLinkSummary,


    resolutionOffsets: {

      secondComponent:
        secondResolutionOffsets,

      groundOnly:
        groundResolutionOffsets,

      secondComponentSummary:
        summarizeNumbers(
          secondResolutionOffsets
        ),

      groundOnlySummary:
        summarizeNumbers(
          groundResolutionOffsets
        ),

      secondComponentAbsoluteSummary:
        summarizeNumbers(
          secondResolutionOffsets.map(
            Math.abs
          )
        ),

      groundOnlyAbsoluteSummary:
        summarizeNumbers(
          groundResolutionOffsets.map(
            Math.abs
          )
        )
    },


    windows,

    primaryWindow,

    support,


    interpretation: {

      primaryPositive:
        'The same source Trooper CItemXP resolves within the frozen ±6-tick window around the AssignedGold economic termination.',

      negativeControl:
        'GROUND_ONLY cases from the same economic cohort.',

      economicConfirmation:
        'Linked CItemXP resolution also has a 0..+6 tick positive team m_iGoldNetWorth signal at least 75% of expected flying-team-total magnitude.'
    },


    outputs: {

      episodes:
        episodePath,

      episodeSummary:
        episodeSummaryPath,

      cases:
        caseOutputPath,

      summary:
        replaySummaryPath
    }
  };


  await writeJsonl(
    caseOutputPath,
    cases
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
// CITEMXP EXTRACTION
// ============================================================

async function extractCItemXPEpisodes(
  replayName,
  replayPath
) {

  const parser =
    new Parser();


  const previousByEntity =
    new Map();


  const openByEntity =
    new Map();


  const sequenceByEntity =
    new Map();


  const episodes =
    [];


  let entityEvents =
    0;


  let creates =
    0;


  let leaves =
    0;


  let deletes =
    0;


  let launchNumChanges =
    0;


  let launchTimeChanges =
    0;


  let positionReuseJumps =
    0;


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


        const className =
          getEntityClassName(
            entity
          );


        if (
          className !==
          'CItemXP'
        ) {

          continue;
        }


        entityEvents++;


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


        const operation =
          decodeOperation(
            event.operation
          );


        if (
          operation ===
          'CREATE'
        ) {

          creates++;
        }


        if (
          operation ===
          'LEAVE'
        ) {

          leaves++;
        }


        if (
          operation ===
          'DELETE'
        ) {

          deletes++;
        }


        const current = {

          tick,

          entityIndex,

          operation,

          subclassId:
            scalarStringOrNull(
              safeGetField(
                entity,
                'm_nSubclassID'
              )
            )
            ??
            'UNKNOWN',

          team:
            finite(
              safeGetField(
                entity,
                'm_iTeamNum'
              )
            ),

          position:
            getBestPosition(
              entity
            ),

          launchNum:
            finite(
              safeGetField(
                entity,
                'm_nLaunchNum'
              )
            ),

          timeLaunch:
            finite(
              safeGetField(
                entity,
                'm_timeLaunch'
              )
            ),

          attackableTime:
            finite(
              safeGetField(
                entity,
                'm_flAttackableTime'
              )
            ),

          endAttackableTime:
            finite(
              safeGetField(
                entity,
                'm_flEndAttackableTime'
              )
            )
        };


        const previous =
          previousByEntity.get(
            entityIndex
          )
          ??
          null;


        const open =
          openByEntity.get(
            entityIndex
          )
          ??
          null;


        const firstObservation =
          previous ===
          null;


        const launchNumChanged =

          Boolean(
            previous
          )

          &&

          current.launchNum !==
          null

          &&

          previous.launchNum !==
          null

          &&

          current.launchNum !==
          previous.launchNum;


        const launchTimeChanged =

          Boolean(
            previous
          )

          &&

          current.timeLaunch !==
          null

          &&

          previous.timeLaunch !==
          null

          &&

          Math.abs(
            current.timeLaunch -
            previous.timeLaunch
          ) >
          0.0001;


        if (
          launchNumChanged
        ) {

          launchNumChanges++;
        }


        if (
          launchTimeChanged
        ) {

          launchTimeChanges++;
        }


        let largeReuseJump =
          false;


        if (
          previous?.position
          &&
          current.position
        ) {

          const jump =
            distance3D(
              previous.position,
              current.position
            );


          if (
            jump >=
            XP_REUSE_POSITION_JUMP_HU
          ) {

            largeReuseJump =
              true;


            positionReuseJumps++;
          }
        }


        const oldEnoughForReuse =
          open
            ? tick -
              open.startTick >=
              XP_MIN_TICKS_BEFORE_POSITION_REUSE
            : true;


        const relaunch =

          Boolean(
            open
          )

          &&

          (
            launchNumChanged

            ||

            launchTimeChanged

            ||

            (
              largeReuseJump
              &&
              oldEnoughForReuse
            )
          );


        if (
          relaunch
        ) {

          finalizeEpisode({

            episode:
              open,

            logicalEndTick:
              tick -
              1,

            logicalEndReason:
              'ENTITY_RELAUNCH_OR_REUSE',

            episodes
          });


          openByEntity.delete(
            entityIndex
          );
        }


        let episode =
          openByEntity.get(
            entityIndex
          )
          ??
          null;


        if (
          !episode
        ) {

          const sequence =
            (
              sequenceByEntity.get(
                entityIndex
              )
              ??
              0
            )
            +
            1;


          sequenceByEntity.set(
            entityIndex,
            sequence
          );


          const startSignals =
            [];


          if (
            firstObservation
          ) {

            startSignals.push(
              'FIRST_OBSERVATION'
            );
          }


          if (
            operation ===
            'CREATE'
          ) {

            startSignals.push(
              'OPERATION_CREATE'
            );
          }


          if (
            launchNumChanged
          ) {

            startSignals.push(
              'LAUNCH_NUM_CHANGED'
            );
          }


          if (
            launchTimeChanged
          ) {

            startSignals.push(
              'TIME_LAUNCH_CHANGED'
            );
          }


          if (
            largeReuseJump
          ) {

            startSignals.push(
              'LARGE_POSITION_REUSE_JUMP'
            );
          }


          episode = {

            episodeId:
              `${entityIndex}|${sequence}`,

            entityIndex,

            sequence,

            subclassId:
              current.subclassId,

            team:
              current.team,

            startTick:
              tick,

            startPosition:
              current.position,

            startSignals,

            launchNum:
              current.launchNum,

            timeLaunch:
              current.timeLaunch,

            attackableTime:
              current.attackableTime,

            endAttackableTime:
              current.endAttackableTime,

            lastObservedTick:
              tick,

            lastPosition:
              current.position,

            firstEndTick:
              null,

            firstEndReason:
              null,

            logicalEndTick:
              null,

            logicalEndReason:
              null,

            finalized:
              false
          };


          openByEntity.set(
            entityIndex,
            episode
          );
        }


        episode.lastObservedTick =
          tick;


        if (
          current.position
        ) {

          episode.lastPosition =
            current.position;
        }


        if (
          current.team !==
          null
        ) {

          episode.team =
            current.team;
        }


        if (
          current.subclassId !==
          'UNKNOWN'
        ) {

          episode.subclassId =
            current.subclassId;
        }


        if (
          current.launchNum !==
          null
        ) {

          episode.launchNum =
            current.launchNum;
        }


        if (
          current.timeLaunch !==
          null
        ) {

          episode.timeLaunch =
            current.timeLaunch;
        }


        if (
          current.attackableTime !==
          null
        ) {

          episode.attackableTime =
            current.attackableTime;
        }


        if (
          current.endAttackableTime !==
          null
        ) {

          episode.endAttackableTime =
            current.endAttackableTime;
        }


        if (
          [
            'LEAVE',
            'DELETE'
          ].includes(
            operation
          )
          &&
          episode.firstEndTick ===
          null
        ) {

          episode.firstEndTick =
            tick;


          episode.firstEndReason =
            operation;
        }


        previousByEntity.set(
          entityIndex,
          current
        );
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


  for (
    const episode
    of openByEntity.values()
  ) {

    finalizeEpisode({

      episode,

      logicalEndTick:
        episode.lastObservedTick,

      logicalEndReason:
        'REPLAY_END',

      episodes
    });
  }


  episodes.sort(
    (
      a,
      b
    ) =>
      a.startTick -
      b.startTick
      ||
      a.entityIndex -
      b.entityIndex
  );


  return {

    episodes,

    summary: {

      version:
        'REPLICATION_CITEMXP_SOURCE_EPISODE_SUMMARY_V01',

      replay:
        replayName,

      canonical:
        false,

      entityEvents,

      logicalEpisodes:
        episodes.length,

      operationCreates:
        creates,

      operationLeaves:
        leaves,

      operationDeletes:
        deletes,

      launchNumChanges,

      launchTimeChanges,

      positionReuseJumps,

      episodesWithStartPosition:
        episodes.filter(
          row =>
            row.startPosition
        ).length,

      episodesWithResolutionEnd:
        episodes.filter(
          row =>
            Number.isFinite(
              row.firstEndTick
            )
        ).length,

      subclassCounts:
        countByObject(
          episodes,
          row =>
            row.subclassId
        )
    }
  };
}


// ============================================================
// FINALIZE CITEMXP EPISODE
// ============================================================

function finalizeEpisode({

  episode,

  logicalEndTick,

  logicalEndReason,

  episodes
}) {

  if (
    episode.finalized
  ) {

    return;
  }


  episode.logicalEndTick =
    logicalEndTick;


  episode.logicalEndReason =
    logicalEndReason;


  episode.finalized =
    true;


  episodes.push(
    episode
  );
}


// ============================================================
// LINK ELIGIBLE TROOPER DEATHS TO CITEMXP EPISODES
// ============================================================

function linkDeathsToCItemXPEpisodes(
  cases,
  episodes
) {

  const episodesByStartTick =
    groupBy(
      episodes,
      row =>
        row.startTick
    );


  const candidatesByDeath =
    new Map();


  const candidatesByEpisode =
    new Map();


  let candidateEdges =
    0;


  for (
    const row
    of cases
  ) {

    const candidates =
      [];


    for (
      let tick =
        row.death.tick +
        XP_SOURCE_MIN_TICK_OFFSET;

      tick <=
        row.death.tick +
        XP_SOURCE_MAX_TICK_OFFSET;

      tick++
    ) {

      for (
        const episode
        of episodesByStartTick.get(
          tick
        )
        ??
        []
      ) {

        if (
          !row.death.position
          ||
          !episode.startPosition
        ) {

          continue;
        }


        const distance3d =
          distance3D(
            row.death.position,
            episode.startPosition
          );


        if (
          distance3d >
          XP_SOURCE_MAX_DISTANCE_3D_HU
        ) {

          continue;
        }


        const distanceXy =
          distanceXY(
            row.death.position,
            episode.startPosition
          );


        const tickDelta =
          episode.startTick -
          row.death.tick;


        const sameTeam =

          isGameTeam(
            row.death.team
          )

          &&

          isGameTeam(
            episode.team
          )

            ? row.death.team ===
              episode.team

            : null;


        const edge = {

          deathId:
            row.deathId,

          episodeId:
            episode.episodeId,

          row,

          episode,

          tickDelta,

          distanceXY:
            distanceXy,

          distance3D:
            distance3d,

          sameTeam
        };


        candidates.push(
          edge
        );


        if (
          !candidatesByEpisode.has(
            episode.episodeId
          )
        ) {

          candidatesByEpisode.set(
            episode.episodeId,
            []
          );
        }


        candidatesByEpisode
          .get(
            episode.episodeId
          )
          .push(
            edge
          );


        candidateEdges++;
      }
    }


    // --------------------------------------------------------
    // Prefer same-team CItemXP candidates when team semantics
    // are available.
    //
    // This does NOT force same-team if no same-team candidate
    // exists. It only removes known opposing-team alternatives
    // from an otherwise ambiguous candidate set.
    // --------------------------------------------------------

    const sameTeamCandidates =
      candidates.filter(
        edge =>
          edge.sameTeam ===
          true
      );


    candidatesByDeath.set(

      row.deathId,

      sameTeamCandidates.length >
        0
        ? sameTeamCandidates
        : candidates
    );
  }


  // ----------------------------------------------------------
  // Rebuild reverse sets after same-team preference.
  // ----------------------------------------------------------

  const preferredReverse =
    new Map();


  for (
    const candidates
    of candidatesByDeath.values()
  ) {

    for (
      const edge
      of candidates
    ) {

      if (
        !preferredReverse.has(
          edge.episodeId
        )
      ) {

        preferredReverse.set(
          edge.episodeId,
          []
        );
      }


      preferredReverse
        .get(
          edge.episodeId
        )
        .push(
          edge
        );
    }
  }


  const matchByDeathId =
    new Map();


  for (
    const [
      deathId,
      candidates
    ]
    of candidatesByDeath
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
      preferredReverse.get(
        edge.episodeId
      )
      ??
      [];


    if (
      reverse.length !==
      1
    ) {

      continue;
    }


    matchByDeathId.set(
      deathId,
      edge
    );
  }


  return {

    matchByDeathId,

    candidateEdges,

    ambiguousDeaths:
      [
        ...candidatesByDeath.values()
      ]
        .filter(
          rows =>
            rows.length >
            1
        ).length,

    ambiguousEpisodes:
      [
        ...preferredReverse.values()
      ]
        .filter(
          rows =>
            rows.length >
            1
        ).length
  };
}


// ============================================================
// CO-RESOLUTION WINDOW ANALYSIS
// ============================================================

function analyzeCoResolutionWindow(
  cases,
  windowTicks
) {

  const linked =
    cases.filter(
      row =>
        row.sourceLink
        &&
        Number.isFinite(
          row
            ?.resolution
            ?.absoluteOffsetTicks
        )
    );


  const groundOnly =
    linked.filter(
      row =>
        row.componentClass ===
        'GROUND_ONLY'
    );


  const secondComponent =
    linked.filter(
      row =>
        row.componentClass ===
        'GROUND_PLUS_SECOND_COMPONENT'
    );


  const groundPositive =
    groundOnly.filter(
      row =>
        row
          .resolution
          .absoluteOffsetTicks <=
        windowTicks
    );


  const secondPositive =
    secondComponent.filter(
      row =>
        row
          .resolution
          .absoluteOffsetTicks <=
        windowTicks
    );


  const economicallyConfirmedSecond =
    secondPositive.filter(
      row =>
        row
          ?.resolution
          ?.economy
          ?.economySignalPresent ===
        true
    );


  const economicallyConfirmedGround =
    groundPositive.filter(
      row =>
        row
          ?.resolution
          ?.economy
          ?.economySignalPresent ===
        true
    );


  const predictions =
    linked.map(
      row => ({

        actualSecond:
          row.componentClass ===
          'GROUND_PLUS_SECOND_COMPONENT',

        predictorPositive:
          row
            .resolution
            .absoluteOffsetTicks <=
          windowTicks
      })
    );


  return {

    windowTicks,

    linkedCases:
      linked.length,


    secondComponent: {

      cases:
        secondComponent.length,

      coResolved:
        secondPositive.length,

      coResolutionRate:
        rate(
          secondPositive.length,
          secondComponent.length
        ),

      economicallyConfirmedCoResolved:
        economicallyConfirmedSecond.length,

      economicallyConfirmedCoResolutionRate:
        rate(
          economicallyConfirmedSecond.length,
          secondPositive.length
        )
    },


    groundOnly: {

      cases:
        groundOnly.length,

      coResolved:
        groundPositive.length,

      coResolutionRate:
        rate(
          groundPositive.length,
          groundOnly.length
        ),

      economicallyConfirmedCoResolved:
        economicallyConfirmedGround.length,

      economicallyConfirmedCoResolutionRate:
        rate(
          economicallyConfirmedGround.length,
          groundPositive.length
        )
    },


    rateDifference:

      (
        rate(
          secondPositive.length,
          secondComponent.length
        )
        ??
        0
      )

      -

      (
        rate(
          groundPositive.length,
          groundOnly.length
        )
        ??
        0
      ),


    association:
      binaryAssociation(
        predictions
      )
  };
}


// ============================================================
// NET-WORTH ECONOMY AROUND CITEMXP RESOLUTION
// ============================================================

function measureNetWorthEconomy({

  rows,

  resolutionTick,

  expectedFlyingTeamTotal
}) {

  if (
    resolutionTick ===
    null
    ||
    !Number.isFinite(
      resolutionTick
    )
  ) {

    return {

      comparable:
        false,

      economySignalPresent:
        false,

      reason:
        'NO_CITEMXP_RESOLUTION_TICK'
    };
  }


  const minimumTick =
    resolutionTick -
    NETWORTH_BEFORE_TICKS;


  const maximumTick =
    resolutionTick +
    NETWORTH_AFTER_TICKS;


  const startIndex =
    lowerBoundByTick(
      rows,
      minimumTick
    );


  const positives =
    [];


  for (
    let i =
      startIndex;

    i <
      rows.length;

    i++
  ) {

    const row =
      rows[i];


    if (
      row.tick >
      maximumTick
    ) {

      break;
    }


    if (
      row.tick <
      minimumTick
    ) {

      continue;
    }


    positives.push(
      row
    );
  }


  const byTeam =
    new Map();


  for (
    const row
    of positives
  ) {

    const team =
      finite(
        row.team
      );


    if (
      !isGameTeam(
        team
      )
    ) {

      continue;
    }


    byTeam.set(

      team,

      (
        byTeam.get(
          team
        )
        ??
        0
      )
      +
      row.delta
    );
  }


  const teamTotals =
    [
      ...byTeam.entries()
    ]
      .map(
        (
          [
            team,
            delta
          ]
        ) => ({

          team,

          delta
        })
      )
      .sort(
        (
          a,
          b
        ) =>
          b.delta -
          a.delta
      );


  const maximumTeamDelta =
    teamTotals[0]?.delta
    ??
    0;


  const threshold =
    Number.isFinite(
      expectedFlyingTeamTotal
    )
      ? expectedFlyingTeamTotal *
        MIN_EXPECTED_ECONOMY_RATIO
      : null;


  const economySignalPresent =
    Number.isFinite(
      threshold
    )
    &&
    maximumTeamDelta >=
      threshold;


  return {

    comparable:
      true,

    window: {

      beforeTicks:
        NETWORTH_BEFORE_TICKS,

      afterTicks:
        NETWORTH_AFTER_TICKS
    },

    positiveEvents:
      positives.length,

    teamTotals,

    maximumTeamDelta,

    expectedFlyingTeamTotal,

    minimumExpectedEconomyRatio:
      MIN_EXPECTED_ECONOMY_RATIO,

    threshold,

    economySignalPresent
  };
}


// ============================================================
// REPLAY SUPPORT
// ============================================================

function evaluateReplaySupport({

  cases,

  sourceLink,

  primaryWindow
}) {

  const linked =
    cases.filter(
      row =>
        row.sourceLink
        &&
        Number.isFinite(
          row
            ?.resolution
            ?.absoluteOffsetTicks
        )
    );


  const linkedGroundOnly =
    linked.filter(
      row =>
        row.componentClass ===
        'GROUND_ONLY'
    );


  const linkedSecond =
    linked.filter(
      row =>
        row.componentClass ===
        'GROUND_PLUS_SECOND_COMPONENT'
    );


  const informative =

    linked.length >=
      SUPPORT.minimumLinkedEligibleCases

    &&

    linkedGroundOnly.length >=
      SUPPORT.minimumLinkedGroundOnlyCases

    &&

    linkedSecond.length >=
      SUPPORT.minimumLinkedSecondCases;


  const sourceMatchRate =
    sourceLink.eligibleSourceMatchRate
    ??
    0;


  const sensitivity =
    primaryWindow
      ?.association
      ?.sensitivity
    ??
    0;


  const specificity =
    primaryWindow
      ?.association
      ?.specificity
    ??
    0;


  const mcc =
    primaryWindow
      ?.association
      ?.mcc
    ??
    -1;


  const rateDifference =
    primaryWindow
      ?.rateDifference
    ??
    0;


  const secondEconomyConfirmation =
    primaryWindow
      ?.secondComponent
      ?.economicallyConfirmedCoResolutionRate
    ??
    0;


  const sameSourceCItemXPSecondComponentSupported =

    informative

    &&

    sourceMatchRate >=
      SUPPORT.minimumSourceMatchRate

    &&

    sensitivity >=
      SUPPORT.minimumSecondCoResolutionSensitivity

    &&

    specificity >=
      SUPPORT.minimumGroundOnlyCoResolutionSpecificity

    &&

    mcc >=
      SUPPORT.minimumCoResolutionMCC

    &&

    rateDifference >=
      SUPPORT.minimumSecondMinusGroundCoResolutionDifference;


  const economicConfirmationSupported =

    informative

    &&

    secondEconomyConfirmation >=
      SUPPORT.minimumSecondEconomicallyConfirmedRate;


  return {

    informative,

    sameSourceCItemXPSecondComponentSupported,

    economicConfirmationSupported,


    criteria: {

      linkedCases:
        linked.length,

      linkedGroundOnlyCases:
        linkedGroundOnly.length,

      linkedSecondCases:
        linkedSecond.length,

      sourceMatchRate,

      primarySensitivity:
        sensitivity,

      primarySpecificity:
        specificity,

      primaryMCC:
        mcc,

      secondMinusGroundRateDifference:
        rateDifference,

      secondEconomyConfirmationRate:
        secondEconomyConfirmation
    }
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
      row.actualSecond
      &&
      row.predictorPositive
    ) {

      tp++;

    } else if (
      row.actualSecond
      &&
      !row.predictorPositive
    ) {

      fn++;

    } else if (
      !row.actualSecond
      &&
      row.predictorPositive
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
// GROUND-SOUL STRICT MATCHING
// ============================================================

function buildStrictGroundMatches(
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


  const candidatesByDeath =
    new Map();


  const candidatesByActivation =
    new Map();


  for (
    const death
    of economicDeaths
  ) {

    const deathId =
      makeDeathId(
        death
      );


    const candidates =
      [];


    for (
      let tick =
        death.tick +
        MATCH_MIN_TICK_OFFSET;

      tick <=
        death.tick +
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


        const distance =
          distance3D(
            death.position,
            activation.position
          );


        if (
          distance >
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

          distance
        };


        candidates.push(
          edge
        );


        if (
          !candidatesByActivation.has(
            activationId
          )
        ) {

          candidatesByActivation.set(
            activationId,
            []
          );
        }


        candidatesByActivation
          .get(
            activationId
          )
          .push(
            edge
          );
      }
    }


    candidatesByDeath.set(
      deathId,
      candidates
    );
  }


  const strict =
    [];


  for (
    const candidates
    of candidatesByDeath.values()
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
      candidatesByActivation.get(
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

      deathId:
        makeDeathId(
          death
        ),

      creditedName,

      creditedTeam,

      endTick,

      sameTeam,

      opponents,

      creditedRecipient
    });
  }


  // ----------------------------------------------------------
  // Require one matched ground-soul termination per team/tick.
  // ----------------------------------------------------------

  const terminationCount =
    new Map();


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    terminationCount.set(

      key,

      (
        terminationCount.get(
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
      terminationCount.get(
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
          recipient
        ) =>
          sum +
          recipient.delta,
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

      ...row,

      teamTotal,

      recipientCount,

      minute,

      teamState,

      normalHpLike:
        hp.normalHpLike,

      baseHp:
        hp.baseHp,

      hpRatio:
        hp.hpRatio
    });
  }


  return output;
}


// ============================================================
// SCRIPT106 ELIGIBILITY
// ============================================================

function isEligibleEconomicCase(
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


  const shareMultiplier =
    SHARE_TOTAL_MULTIPLIER.get(
      row.recipientCount
    );


  if (
    !Number.isFinite(
      shareMultiplier
    )
  ) {

    return false;
  }


  row.shareMultiplier =
    shareMultiplier;


  return true;
}


// ============================================================
// CLASSIFY ECONOMIC COMPONENT
// ============================================================

function classifyEconomicComponent(
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


  return {

    ...row,

    mixtureRounding:
      rounding,

    totalBounty,

    predictedGround,

    predictedFlying,

    predictedCombined,

    componentClass:
      combinedError <
        groundError
        ? 'GROUND_PLUS_SECOND_COMPONENT'
        : 'GROUND_ONLY',

    groundOnlyAbsoluteError:
      groundError,

    combinedAbsoluteError:
      combinedError
  };
}


// ============================================================
// COMPACT CASE
// ============================================================

function compactEconomicCase(
  row
) {

  return {

    deathId:
      row.deathId,

    deathTick:
      row.death.tick,

    deathTimeSeconds:
      row.death.timeSeconds,

    minute:
      row.minute,

    deathTeam:
      row.death.team,

    deathPosition:
      row.death.position,

    baseType:
      row.death.baseType,

    creditedName:
      row.creditedName,

    creditedTeam:
      row.creditedTeam,

    assignedGoldActivationId:
      row.activation.activationId,

    groundEndTick:
      row.endTick,

    teamTotal:
      row.teamTotal,

    recipientCount:
      row.recipientCount,

    shareMultiplier:
      row.shareMultiplier,

    predictedGround:
      row.predictedGround,

    predictedFlying:
      row.predictedFlying,

    predictedCombined:
      row.predictedCombined,

    componentClass:
      row.componentClass
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
// HP CLASSIFIER
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
// TEAM NET WORTH STATE
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


  const opponents =
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
    opponents.length ===
    0
  ) {

    return 'UNKNOWN';
  }


  const opponent =
    Math.max(
      ...opponents
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

      const name =
        entity.getClassName();


      if (
        name
      ) {

        return String(
          name
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

  const text =
    String(
      operation?._code
      ??
      operation?.code
      ??
      operation
      ??
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
// POSITION
// ============================================================

function getBestPosition(
  entity
) {

  const world =
    getWorldPosition(
      entity
    );


  if (
    world
  ) {

    return world;
  }


  const direct =
    entity?.position
    ??
    entity?.origin
    ??
    null;


  if (
    direct
  ) {

    const normalized =
      normalizePosition(
        direct
      );


    if (
      normalized
    ) {

      return normalized;
    }
  }


  return null;
}


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
      cellZ !==
        null
      &&
      vecZ !==
        null
        ? cellZ *
          512
          -
          16384
          +
          vecZ
        : null
  };
}


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
      ??
      value[0]
    );


  const y =
    finite(
      value.y
      ??
      value[1]
    );


  const z =
    finite(
      value.z
      ??
      value[2]
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


// ============================================================
// DISTANCE
// ============================================================

function distanceXY(
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
  );
}


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
// IDS
// ============================================================

function makeDeathId(
  death
) {

  return String(
    death.deathIndex
    ??
    `${death.entityIndex}|${death.tick}`
  );
}


// ============================================================
// GAME TEAM
// ============================================================

function isGameTeam(
  team
) {

  return team ===
    2
    ||
    team ===
    3;
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
// LOWER BOUND
// ============================================================

function lowerBoundByTick(
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
      rows[
        middle
      ].tick <
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
// GENERAL COLLECTION HELPERS
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
// VALUE HELPERS
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

  console.log('');

  console.log(
    'ECONOMIC CASES'
  );


  console.log(
    `  eligible:                    ${row.economicCases.eligibleCases}`
  );


  console.log(
    `  ground-only:                 ${row.economicCases.groundOnly}`
  );


  console.log(
    `  second-component:            ${row.economicCases.secondComponent}`
  );


  console.log('');

  console.log(
    'SOURCE LINK'
  );


  console.log(
    `  logical CItemXP episodes:    ${row.extraction.citemxpEpisodes}`
  );


  console.log(
    `  eligible linked:             ${row.sourceLink.linkedEligibleCases}/${row.sourceLink.eligibleCases} (${formatPercent(
      row.sourceLink.eligibleSourceMatchRate
    )})`
  );


  console.log(
    `  high-confidence links:       ${row.sourceLink.highConfidenceLinks}/${row.sourceLink.linkedEligibleCases} (${formatPercent(
      row.sourceLink.highConfidenceLinkRate
    )})`
  );


  console.log(
    `  source tick median:          ${formatNumber(
      row.sourceLink.strictSourceTickDelta.median
    )}`
  );


  console.log(
    `  source XY median:            ${formatNumber(
      row.sourceLink.strictSourceDistanceXY.median
    )} HU`
  );


  console.log('');

  console.log(
    `PRIMARY ±${PRIMARY_CORESOLUTION_WINDOW_TICKS}-TICK CO-RESOLUTION`
  );


  console.log(
    `  second-component:            ${row.primaryWindow.secondComponent.coResolved}/${row.primaryWindow.secondComponent.cases} (${formatPercent(
      row.primaryWindow.secondComponent.coResolutionRate
    )})`
  );


  console.log(
    `  ground-only:                 ${row.primaryWindow.groundOnly.coResolved}/${row.primaryWindow.groundOnly.cases} (${formatPercent(
      row.primaryWindow.groundOnly.coResolutionRate
    )})`
  );


  console.log(
    `  rate difference:             ${formatSignedPercent(
      row.primaryWindow.rateDifference
    )}`
  );


  console.log(
    `  sensitivity:                 ${formatPercent(
      row.primaryWindow.association.sensitivity
    )}`
  );


  console.log(
    `  specificity:                 ${formatPercent(
      row.primaryWindow.association.specificity
    )}`
  );


  console.log(
    `  MCC:                         ${formatNumber(
      row.primaryWindow.association.mcc
    )}`
  );


  console.log(
    `  second economy confirmation: ${formatPercent(
      row.primaryWindow.secondComponent.economicallyConfirmedCoResolutionRate
    )}`
  );


  console.log('');

  console.log(
    'RESOLUTION OFFSET'
  );


  console.log(
    `  second median abs offset:    ${formatNumber(
      row.resolutionOffsets.secondComponentAbsoluteSummary.median
    )} ticks`
  );


  console.log(
    `  ground median abs offset:    ${formatNumber(
      row.resolutionOffsets.groundOnlyAbsoluteSummary.median
    )} ticks`
  );


  console.log('');

  console.log(
    'SUPPORT'
  );


  console.log(
    `  informative:                 ${row.support.informative}`
  );


  console.log(
    `  same-source CItemXP:         ${row.support.sameSourceCItemXPSecondComponentSupported}`
  );


  console.log(
    `  economy confirmation:        ${row.support.economicConfirmationSupported}`
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


function formatSignedPercent(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'n/a';
  }


  const percentage =
    value *
    100;


  return `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}pp`;
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
    '# Source-Linked CItemXP Second-Component Validation'
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
    'Does the extra reward component isolated by Script106 coincide with resolution of the CItemXP flying soul spawned by the exact same source Trooper?'
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
      `- Eligible cases: ${replay.economicCases.eligibleCases}`
    );


    lines.push(
      `- Source-linked cases: ${replay.sourceLink.linkedEligibleCases}/${replay.sourceLink.eligibleCases} (${formatPercent(replay.sourceLink.eligibleSourceMatchRate)})`
    );


    lines.push(
      `- Second-component co-resolution: ${formatPercent(replay.primaryWindow.secondComponent.coResolutionRate)}`
    );


    lines.push(
      `- Ground-only co-resolution: ${formatPercent(replay.primaryWindow.groundOnly.coResolutionRate)}`
    );


    lines.push(
      `- Difference: ${formatSignedPercent(replay.primaryWindow.rateDifference)}`
    );


    lines.push(
      `- MCC: ${formatNumber(replay.primaryWindow.association.mcc)}`
    );


    lines.push(
      `- Second-component economic confirmation: ${formatPercent(replay.primaryWindow.secondComponent.economicallyConfirmedCoResolutionRate)}`
    );


    lines.push(
      `- Same-source support: **${replay.support.sameSourceCItemXPSecondComponentSupported}**`
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