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

const MATCH_CLOCK_OFFSET_SECONDS =
  30;


// ============================================================
// IMPORTANT SEMANTIC LIMIT
//
// m_iLastHits is an OBSERVED CONTROLLER COUNTER.
//
// This script does NOT assume that an increment proves which
// entity received the lethal hit. It tests whether positive
// counter increments are temporally associated with economic
// Trooper deaths and whether that signal can explain the small
// set of 45m ground-soul exceptions.
//
// We use labels such as LASTHIT_COUNTER_SIGNAL rather than
// TARGET_ATTRIBUTED_KILL.
// ============================================================

const LAST_HIT_FIELD =
  'm_iLastHits';


// ============================================================
// ASSOCIATION WINDOWS
//
// Primary window is intentionally tight around death.
//
// Offset convention:
//   counterTick - deathTick
// ============================================================

const ASSOCIATION_WINDOWS = [
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
      'M2_P4',

    minOffsetTicks:
      -2,

    maxOffsetTicks:
      4
  },

  {
    id:
      'M2_P6',

    minOffsetTicks:
      -2,

    maxOffsetTicks:
      6,

    primary:
      true
  },

  {
    id:
      'M4_P8',

    minOffsetTicks:
      -4,

    maxOffsetTicks:
      8
  },

  {
    id:
      'M8_P16',

    minOffsetTicks:
      -8,

    maxOffsetTicks:
      16
  }
];

const PRIMARY_WINDOW =
  ASSOCIATION_WINDOWS.find(
    row =>
      row.primary
  );


// ============================================================
// BROAD TIMING DIAGNOSTIC
//
// Used only to describe timing of especially clean one-death /
// one-counter associations.
//
// It is NOT the primary attribution window.
// ============================================================

const BROAD_TIMING_WINDOW = {
  id:
    'BROAD_M8_P64',

  minOffsetTicks:
    -8,

  maxOffsetTicks:
    64
};


const RANGE_GROUP_ORDER = [
  'MATCHED_INSIDE_45M',
  'MATCHED_OUTSIDE_45M',
  'UNMATCHED_INSIDE_45M',
  'UNMATCHED_OUTSIDE_45M',
  'UNMATCHED_RANGE_UNRESOLVED'
];


// ============================================================
// SCRIPT 57 PLAYER-STATE RECONSTRUCTION CONTRACT
// ============================================================

const MAX_INTERPOLATION_GAP_SECONDS =
  0.30;

const MAX_NEAREST_SAMPLE_DELTA_SECONDS =
  0.15;


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

const deathStreamPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_v01.jsonl'
  );

const script55SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_summary_v01.json'
  );

const script57SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_range_validation_v01.json'
  );

const script57OutlierPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_range_outliers_v01.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_lasthit_counter_diagnostic_v01.json'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_lasthit_counter_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    deathStreamPath,
    script55SummaryPath,
    script57SummaryPath,
    script57OutlierPath
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
// LOAD AUTHORITATIVE SUMMARIES
// ============================================================

const script55Summary =
  JSON.parse(
    readFileSync(
      script55SummaryPath,
      'utf8'
    )
  );


if (
  script55Summary
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 55 one-to-one summary did not PASS.'
  );
}


const script57Summary =
  JSON.parse(
    readFileSync(
      script57SummaryPath,
      'utf8'
    )
  );


const documentedRangeHU =
  finite(
    script57Summary
      ?.documentedMechanicTarget
      ?.rangeInternalUnits
  );


const documentedRangeMeters =
  finite(
    script57Summary
      ?.documentedMechanicTarget
      ?.rangeMeters
  )
  ??
  45;


if (
  documentedRangeHU ===
  null
) {

  throw new Error(
    'Could not recover documented 45m threshold from Script 57.'
  );
}


// ============================================================
// LOAD SCRIPT 57 RANGE EXCEPTION SETS
// ============================================================

const script57Outliers =
  await loadJsonl(
    script57OutlierPath
  );


const matchedOutside45Indexes =
  new Set(

    script57Outliers
      .filter(
        row =>
          row?.category ===
          'MATCHED_OUTSIDE_DOCUMENTED_45M'
      )
      .map(
        row =>
          finite(
            row?.deathIndex
          )
      )
      .filter(
        Number.isFinite
      )
  );


const unmatchedInside45Indexes =
  new Set(

    script57Outliers
      .filter(
        row =>
          row?.category ===
          'UNMATCHED_INSIDE_DOCUMENTED_45M'
      )
      .map(
        row =>
          finite(
            row?.deathIndex
          )
      )
      .filter(
        Number.isFinite
      )
  );


const unmatchedUnresolvedIndexes =
  new Set(

    script57Outliers
      .filter(
        row =>
          row?.category ===
          'UNMATCHED_NO_SYNCHRONOUS_OPPONENT_STATE'
      )
      .map(
        row =>
          finite(
            row?.deathIndex
          )
      )
      .filter(
        Number.isFinite
      )
  );


// ============================================================
// LOAD ECONOMIC TROOPER DEATHS
// ============================================================

console.log('');

console.log(
  'Loading economic Trooper death stream...'
);


const rawDeaths =
  await loadJsonl(
    deathStreamPath
  );


const deaths =
  rawDeaths
    .map(
      normalizeDeath
    )
    .filter(
      Boolean
    )
    .sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
        ||
        a.deathIndex -
        b.deathIndex
    );


for (
  const death
  of deaths
) {

  death.rangeGroup =
    classifyRangeGroup(
      death
    );
}


console.log(
  `Economic deaths: ${deaths.length}`
);


// ============================================================
// LOAD PLAYER IDENTITIES + TIMELINES
// ============================================================

console.log(
  'Loading player/controller identities and timelines...'
);


const playerData =
  await loadPlayerData(
    playerStatePath
  );


const playerByControllerIndex =
  playerData
    .playerByControllerIndex;


const timelineByPlayerTeam =
  playerData
    .timelineByPlayerTeam;


console.log(
  `Players: ${playerData.players.length}`
);

console.log(
  `Controller indexes: ${playerByControllerIndex.size}`
);

console.log(
  `Player timelines: ${timelineByPlayerTeam.size}`
);


// ============================================================
// RESCAN RAW CONTROLLER m_iLastHits TELEMETRY
// ============================================================

const previousLastHitValue =
  new Map();


const lastHitDeltaEvents =
  [];


let controllerEntityEvents =
  0;

let finiteLastHitReads =
  0;

let explicitLastHitMentions =
  0;


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


    for (
      const event
      of events ?? []
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


      const player =
        entityIndex ===
        null

          ? null

          : playerByControllerIndex
            .get(
              entityIndex
            );


      if (
        !player
      ) {

        continue;
      }


      controllerEntityEvents++;


      const changedFields =
        new Set(

          extractChangedFields(

            safeGetChanges(
              event
            )
          )
        );


      if (
        changedFields.has(
          LAST_HIT_FIELD
        )
      ) {

        explicitLastHitMentions++;
      }


      const value =
        finite(

          safeGetField(
            entity,
            LAST_HIT_FIELD
          )
        );


      if (
        value ===
        null
      ) {

        continue;
      }


      finiteLastHitReads++;


      const prior =
        previousLastHitValue.get(
          entityIndex
        )
        ??
        null;


      previousLastHitValue.set(
        entityIndex,
        {
          tick,
          value
        }
      );


      if (
        !prior
        ||
        !Number.isFinite(
          prior.value
        )
      ) {

        continue;
      }


      const delta =
        value -
        prior.value;


      if (
        delta ===
        0
      ) {

        continue;
      }


      lastHitDeltaEvents.push({

        tick,

        matchTimeSeconds:
          tickToMatchTime(
            tick
          ),

        controllerEntityIndex:
          entityIndex,

        playerName:
          player.playerName,

        team:
          player.team,

        heroId:
          player.heroId,

        previousTick:
          prior.tick,

        previousValue:
          prior.value,

        currentValue:
          value,

        delta,

        explicitlyChanged:
          changedFields.has(
            LAST_HIT_FIELD
          )
      });
    }
  }
);


console.log('');

console.log(
  'Rescanning replay for controller m_iLastHits telemetry...'
);

console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


lastHitDeltaEvents.sort(
  (
    a,
    b
  ) =>
    a.tick -
    b.tick
    ||
    a.controllerEntityIndex -
    b.controllerEntityIndex
);


const positiveLastHitEvents =
  lastHitDeltaEvents
    .filter(
      row =>
        row.delta >
        0
    )
    .map(
      (
        row,
        index
      ) => ({

        ...row,

        positiveEventIndex:
          index
      })
    );


const negativeLastHitEvents =
  lastHitDeltaEvents.filter(
    row =>
      row.delta <
      0
  );


const positiveLastHitUnits =
  positiveLastHitEvents.reduce(
    (
      total,
      row
    ) =>
      total +
      row.delta,
    0
  );


console.log(
  `Controller entity events: ${controllerEntityEvents}`
);

console.log(
  `m_iLastHits deltas: ${lastHitDeltaEvents.length}`
);

console.log(
  `Positive / negative deltas: ${positiveLastHitEvents.length} / ${negativeLastHitEvents.length}`
);

console.log(
  `Positive counter units: ${positiveLastHitUnits}`
);


// ============================================================
// WINDOW SENSITIVITY
// ============================================================

const windowSummaries =
  [];


let primaryRows =
  null;


for (
  const window
  of ASSOCIATION_WINDOWS
) {

  const analysis =
    analyzeAssociationWindow(
      window,
      window.primary ===
      true
    );


  windowSummaries.push(
    analysis.summary
  );


  if (
    window.primary ===
    true
  ) {

    primaryRows =
      analysis.rows;
  }
}


if (
  !primaryRows
) {

  throw new Error(
    'Primary association window was not analyzed.'
  );
}


// ============================================================
// BROAD UNIQUE TIMING DIAGNOSTIC
// ============================================================

const broadTimingAnalysis =
  analyzeAssociationWindow(
    BROAD_TIMING_WINDOW,
    false
  );


const strictBroadRows =
  broadTimingAnalysis
    .rows
    .filter(
      row =>
        row.strictUniqueSignal
    );


const strictBroadOffsetHistogram =
  countByNumericObject(
    strictBroadRows,
    row =>
      row
        .strictUniqueEvent
        ?.offsetTicks
  );


// ============================================================
// PRIMARY GROUP SUMMARIES
// ============================================================

const primaryGroupSummaries =
  {};


for (
  const groupName
  of RANGE_GROUP_ORDER
) {

  primaryGroupSummaries[
    groupName
  ] =
    summarizePrimaryGroup(
      primaryRows,
      groupName
    );
}


// ============================================================
// OUTSIDE-45M HYPOTHESIS COMPARISON
//
// Strongest version:
//
// A unique opposing m_iLastHits counter signal belongs to a
// player who is themselves outside 45m at death.
//
// Compare matched-outside against unmatched-outside controls.
// ============================================================

const matchedOutsideRows =
  primaryRows.filter(
    row =>
      row.rangeGroup ===
      'MATCHED_OUTSIDE_45M'
  );


const unmatchedOutsideRows =
  primaryRows.filter(
    row =>
      row.rangeGroup ===
      'UNMATCHED_OUTSIDE_45M'
  );


const matchedOutsideStrictOutOfRange =
  matchedOutsideRows.filter(
    strictUniquePlayerOutside45m
  );


const unmatchedOutsideStrictOutOfRange =
  unmatchedOutsideRows.filter(
    strictUniquePlayerOutside45m
  );


const matchedOutsideStrictOutRate =
  rate(
    matchedOutsideStrictOutOfRange.length,
    matchedOutsideRows.length
  );


const unmatchedOutsideStrictOutRate =
  rate(
    unmatchedOutsideStrictOutOfRange.length,
    unmatchedOutsideRows.length
  );


const strictOutRateDifference =
  difference(
    matchedOutsideStrictOutRate,
    unmatchedOutsideStrictOutRate
  );


const strictOutRiskRatio =
  ratio(
    matchedOutsideStrictOutRate,
    unmatchedOutsideStrictOutRate
  );


// ============================================================
// VALIDATION
// ============================================================

const expected57 =
  script57Summary
    ?.documented45mTest
    ?.threeDimensional
  ??
  {};


const groupCounts =
  countByObject(
    deaths,
    row =>
      row.rangeGroup
  );


const validationChecks = {

  script55Pass:
    check(

      script55Summary
        ?.validation
        ?.pass,

      true,

      script55Summary
        ?.validation
        ?.pass ===
      true
    ),


  economicDeaths:
    check(

      deaths.length,

      replayName ===
        'test'
        ? 1727
        : '>0',

      replayName ===
        'test'
        ? deaths.length ===
          1727
        : deaths.length >
          0
    ),


  matchedDeaths:
    check(

      deaths.filter(
        row =>
          row.groundSoulMatched
      ).length,

      replayName ===
        'test'
        ? 1388
        : '>0',

      replayName ===
        'test'

        ? deaths.filter(
          row =>
            row.groundSoulMatched
        ).length ===
          1388

        : deaths.some(
          row =>
            row.groundSoulMatched
        )
    ),


  unmatchedDeaths:
    check(

      deaths.filter(
        row =>
          !row.groundSoulMatched
      ).length,

      replayName ===
        'test'
        ? 339
        : '>=0',

      replayName ===
        'test'

        ? deaths.filter(
          row =>
            !row.groundSoulMatched
        ).length ===
          339

        : true
    ),


  matchedOutside45m:
    check(

      groupCounts
        .MATCHED_OUTSIDE_45M
      ??
      0,

      expected57.fn,

      Number.isFinite(
        expected57.fn
      )

        ? (
          groupCounts
            .MATCHED_OUTSIDE_45M
          ??
          0
        ) ===
          expected57.fn

        : true
    ),


  unmatchedOutside45m:
    check(

      groupCounts
        .UNMATCHED_OUTSIDE_45M
      ??
      0,

      expected57.tn,

      Number.isFinite(
        expected57.tn
      )

        ? (
          groupCounts
            .UNMATCHED_OUTSIDE_45M
          ??
          0
        ) ===
          expected57.tn

        : true
    ),


  unmatchedUnresolved:
    check(

      groupCounts
        .UNMATCHED_RANGE_UNRESOLVED
      ??
      0,

      expected57.unresolved,

      Number.isFinite(
        expected57.unresolved
      )

        ? (
          groupCounts
            .UNMATCHED_RANGE_UNRESOLVED
          ??
          0
        ) ===
          expected57.unresolved

        : true
    ),


  playerControllers:
    check(

      playerByControllerIndex.size,

      replayName ===
        'test'
        ? 12
        : '>0',

      replayName ===
        'test'

        ? playerByControllerIndex.size ===
          12

        : playerByControllerIndex.size >
          0
    ),


  positiveLastHitEventsObserved:
    check(

      positiveLastHitEvents.length,

      '>0',

      positiveLastHitEvents.length >
      0
    ),


  primaryRowsPreserved:
    check(

      primaryRows.length,

      deaths.length,

      primaryRows.length ===
      deaths.length
    ),


  primaryWindowExists:
    check(

      PRIMARY_WINDOW?.id,

      'M2_P6',

      PRIMARY_WINDOW?.id ===
      'M2_P6'
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
    'TROOPER_GROUND_SOUL_LASTHIT_COUNTER_DIAGNOSTIC_V01',

  canonical:
    false,

  status:
    validationPass

      ? 'LASTHIT_COUNTER_EXCEPTION_DIAGNOSTIC_READY'

      : 'DIAGNOSTIC_PIPELINE_FAILURE',


  purpose: [

    'Test whether controller m_iLastHits increments are temporally associated with ordinary economic Trooper deaths.',

    'Test whether a unique opposing-player m_iLastHits signal explains matched ground-soul deaths outside the Script 57 documented 45m range.',

    'Compare the matched-outside exception set against the much larger unmatched-outside control group.',

    'Preserve ambiguity when one counter event can correspond to multiple nearby Trooper deaths.',

    'Do not treat m_iLastHits as direct lethal-target attribution without separate validation.'
  ],


  semanticLimit: {

    directTargetAttribution:
      false,

    observedField:
      LAST_HIT_FIELD,

    statement:
      'A positive m_iLastHits delta is an observed controller counter signal. This artifact does not assert that the player delivered the lethal hit to a specific Trooper unless a future direct target field validates that interpretation.'
  },


  inputs: {

    replay:
      replayPath,

    playerState:
      playerStatePath,

    deathStream:
      deathStreamPath,

    script55Summary:
      script55SummaryPath,

    script57Summary:
      script57SummaryPath,

    script57Outliers:
      script57OutlierPath
  },


  documentedRange: {

    meters:
      documentedRangeMeters,

    internalUnits:
      documentedRangeHU
  },


  sourceCounts: {

    economicDeaths:
      deaths.length,

    matchedDeaths:
      deaths.filter(
        row =>
          row.groundSoulMatched
      ).length,

    unmatchedDeaths:
      deaths.filter(
        row =>
          !row.groundSoulMatched
      ).length,

    rangeGroups:
      groupCounts,

    players:
      playerData.players.length,

    controllerIndexes:
      playerByControllerIndex.size,

    playerTimelines:
      timelineByPlayerTeam.size
  },


  lastHitCounterTelemetry: {

    field:
      LAST_HIT_FIELD,

    controllerEntityEvents,

    finiteReads:
      finiteLastHitReads,

    explicitFieldMentions:
      explicitLastHitMentions,

    allDeltaEvents:
      lastHitDeltaEvents.length,

    positiveDeltaEvents:
      positiveLastHitEvents.length,

    negativeDeltaEvents:
      negativeLastHitEvents.length,

    positiveCounterUnits:
      positiveLastHitUnits,

    positiveDeltaDistribution:
      summarizeNumbers(
        positiveLastHitEvents.map(
          row =>
            row.delta
        )
      ),

    negativeDeltaDistribution:
      summarizeNumbers(
        negativeLastHitEvents.map(
          row =>
            row.delta
        )
      )
  },


  associationModel: {

    primaryWindow:
      PRIMARY_WINDOW,

    sensitivityWindows:
      ASSOCIATION_WINDOWS,

    strictUniqueDefinition:
      'Exactly one opposing-team positive m_iLastHits event in the window; that event has delta=+1; and that same event has exactly one eligible opposing-team economic Trooper death candidate under the same window.',

    uniquePlayerDefinition:
      'All opposing positive m_iLastHits events in the death window belong to one player. This is weaker than strict uniqueness.',

    ambiguityRule:
      'Multiple candidate events, delta > 1, or an event linked to multiple candidate deaths prevents strict per-death counter attribution.'
  },


  windowSensitivity:
    windowSummaries,


  broadTimingDiagnostic: {

    window:
      BROAD_TIMING_WINDOW,

    strictUniqueAssociations:
      strictBroadRows.length,

    offsetHistogramTicks:
      strictBroadOffsetHistogram,

    offsetDistributionTicks:
      summarizeNumbers(

        strictBroadRows
          .map(
            row =>
              row
                .strictUniqueEvent
                ?.offsetTicks
          )
          .filter(
            Number.isFinite
          )
      ),

    note:
      'Broad timing is descriptive only and must not be used as direct target attribution.'
  },


  primaryWindowResults: {

    byRangeGroup:
      primaryGroupSummaries,

    outside45mComparison: {

      matchedOutsideTotal:
        matchedOutsideRows.length,

      unmatchedOutsideTotal:
        unmatchedOutsideRows.length,

      matchedOutsideStrictUniquePlayerOutside45m:
        matchedOutsideStrictOutOfRange.length,

      unmatchedOutsideStrictUniquePlayerOutside45m:
        unmatchedOutsideStrictOutOfRange.length,

      matchedOutsideRate:
        matchedOutsideStrictOutRate,

      unmatchedOutsideRate:
        unmatchedOutsideStrictOutRate,

      rateDifferenceMatchedMinusUnmatched:
        strictOutRateDifference,

      riskRatioMatchedVsUnmatched:
        strictOutRiskRatio,

      interpretationRule:
        'A true player-counter exception hypothesis should produce strong enrichment among MATCHED_OUTSIDE_45M versus UNMATCHED_OUTSIDE_45M. Similar rates in the two groups argue against the hypothesis.'
    }
  },


  matchedOutside45mCases:
    matchedOutsideRows.map(
      compactPrimaryCase
    ),


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


await writeJsonl(
  outputCasesPath,
  primaryRows
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'TROOPER LAST-HIT COUNTER DIAGNOSTIC V0.1'
);

console.log(
  '========================================================'
);

console.log('');


console.log(
  `Primary window: ${PRIMARY_WINDOW.id} [${PRIMARY_WINDOW.minOffsetTicks}, +${PRIMARY_WINDOW.maxOffsetTicks}] ticks`
);


console.log('');

console.log(
  'COUNTER TELEMETRY'
);

console.log(
  '-----------------'
);

console.log(
  `Positive m_iLastHits events: ${positiveLastHitEvents.length}`
);

console.log(
  `Positive counter units:      ${positiveLastHitUnits}`
);

console.log(
  `Negative delta events:       ${negativeLastHitEvents.length}`
);


console.log('');

console.log(
  'WINDOW SENSITIVITY'
);

console.log(
  '------------------'
);

console.log(
  'Window    MO:any/uniq/strict      UO:any/uniq/strict'
);


for (
  const row
  of windowSummaries
) {

  const mo =
    row
      .groups
      .MATCHED_OUTSIDE_45M;


  const uo =
    row
      .groups
      .UNMATCHED_OUTSIDE_45M;


  console.log(

    `${row.window.id.padEnd(9)} ` +

    `${formatTriple(mo).padEnd(23)} ` +

    `${formatTriple(uo)}`
  );
}


console.log('');

console.log(
  'PRIMARY RANGE GROUPS'
);

console.log(
  '--------------------'
);


for (
  const groupName
  of RANGE_GROUP_ORDER
) {

  const row =
    primaryGroupSummaries[
      groupName
    ];


  console.log(

    `${groupName.padEnd(28)} ` +

    `n=${String(row.total).padStart(4)} ` +

    `any=${String(row.anySignal).padStart(4)} ` +

    `uniquePlayer=${String(row.uniquePlayerSignal).padStart(4)} ` +

    `strict=${String(row.strictUniqueSignal).padStart(4)} ` +

    `strictOut45=${String(row.strictUniquePlayerOutside45m).padStart(4)}`
  );
}


console.log('');

console.log(
  'OUTSIDE-45M STRICT UNIQUE PLAYER COMPARISON'
);

console.log(
  '-------------------------------------------'
);

console.log(
  `Matched outside:   ${matchedOutsideStrictOutOfRange.length}/${matchedOutsideRows.length} = ${formatPercent(matchedOutsideStrictOutRate)}`
);

console.log(
  `Unmatched outside: ${unmatchedOutsideStrictOutOfRange.length}/${unmatchedOutsideRows.length} = ${formatPercent(unmatchedOutsideStrictOutRate)}`
);

console.log(
  `Rate difference:   ${formatSignedPercent(strictOutRateDifference)}`
);

console.log(
  `Risk ratio:        ${formatMetric(strictOutRiskRatio)}`
);


console.log('');

console.log(
  '15 MATCHED >45M CASES'
);

console.log(
  '---------------------'
);


for (
  const row
  of matchedOutsideRows
) {

  console.log(

    `${String(row.deathIndex).padStart(4)}  ` +

    `${String(row.clock ?? '').padEnd(6)} ` +

    `${String(row.baseType ?? '').padEnd(7)} ` +

    `status=${String(row.associationStatus).padEnd(39)} ` +

    `player=${String(row.uniquePlayerName ?? 'NONE').padEnd(24)} ` +

    `dt=${formatSignedInteger(
      row
        .strictUniqueEvent
        ?.offsetTicks
      ??
      row.nearestCandidateOffsetTicks
    )} ` +

    `dist=${formatNumber(
      row
        .uniquePlayerGeometry
        ?.distanceAtDeath3D
    )}`
  );
}


console.log('');

console.log(
  'BROAD STRICT-UNIQUE OFFSET HISTOGRAM'
);

console.log(
  '------------------------------------'
);


for (
  const [
    offset,
    count
  ]
  of Object.entries(
    strictBroadOffsetHistogram
  )
) {

  console.log(
    `${String(offset).padStart(4)} ticks  ${count}`
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
    row
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(

    `${row.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(34)} ` +

    `actual=${JSON.stringify(row.actual)} ` +

    `expected=${JSON.stringify(row.expected)}`
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
// ASSOCIATION WINDOW ANALYSIS
// ============================================================

function analyzeAssociationWindow(
  window,
  includeGeometry
) {

  const eventCandidateDeathCounts =
    new Map();


  for (
    const event
    of positiveLastHitEvents
  ) {

    eventCandidateDeathCounts.set(

      event.positiveEventIndex,

      countCandidateDeathsForEvent(
        event,
        window
      )
    );
  }


  const rows =
    deaths.map(

      death =>
        buildDeathAssociation(
          death,
          window,
          eventCandidateDeathCounts,
          includeGeometry
        )
    );


  const groups =
    {};


  for (
    const groupName
    of RANGE_GROUP_ORDER
  ) {

    groups[
      groupName
    ] =
      summarizeWindowGroup(
        rows,
        groupName
      );
  }


  return {

    rows,

    summary: {

      window,

      totalDeaths:
        rows.length,

      groups
    }
  };
}


// ============================================================
// BUILD PER-DEATH COUNTER ASSOCIATION
// ============================================================

function buildDeathAssociation(
  death,
  window,
  eventCandidateDeathCounts,
  includeGeometry
) {

  const opposingTeam =
    oppositeTeam(
      death.team
    );


  const candidateEvents =
    collectPositiveLastHitEvents(

      death.tick +
      window.minOffsetTicks,

      death.tick +
      window.maxOffsetTicks
    )
    .filter(
      event =>
        event.team ===
        opposingTeam
    )
    .map(
      event => ({

        positiveEventIndex:
          event.positiveEventIndex,

        tick:
          event.tick,

        offsetTicks:
          event.tick -
          death.tick,

        offsetSeconds:
          (
            event.tick -
            death.tick
          ) /
          TICK_RATE,

        playerName:
          event.playerName,

        team:
          event.team,

        heroId:
          event.heroId,

        delta:
          event.delta,

        previousValue:
          event.previousValue,

        currentValue:
          event.currentValue,

        explicitlyChanged:
          event.explicitlyChanged,

        candidateEconomicDeaths:
          eventCandidateDeathCounts.get(
            event.positiveEventIndex
          )
          ??
          0
      })
    );


  const playerNames =
    [
      ...new Set(

        candidateEvents
          .map(
            row =>
              row.playerName
          )
          .filter(
            Boolean
          )
      )
    ];


  const uniquePlayerName =
    playerNames.length ===
    1

      ? playerNames[0]

      : null;


  const strictUniqueSignal =
    candidateEvents.length ===
      1
    &&
    approximatelyEqual(
      candidateEvents[0].delta,
      1
    )
    &&
    candidateEvents[0]
      .candidateEconomicDeaths ===
      1;


  const strictUniqueEvent =
    strictUniqueSignal

      ? candidateEvents[0]

      : null;


  const uniquePlayerSignal =
    candidateEvents.length >
      0
    &&
    uniquePlayerName !==
    null;


  const anySignal =
    candidateEvents.length >
    0;


  let associationStatus =
    'NO_LASTHIT_COUNTER_SIGNAL';


  if (
    strictUniqueSignal
  ) {

    associationStatus =
      'STRICT_UNIQUE_LASTHIT_COUNTER_SIGNAL';

  } else if (
    uniquePlayerSignal
  ) {

    associationStatus =
      'UNIQUE_PLAYER_AMBIGUOUS_LASTHIT_SIGNAL';

  } else if (
    anySignal
  ) {

    associationStatus =
      'MULTI_PLAYER_AMBIGUOUS_LASTHIT_SIGNAL';
  }


  let uniquePlayerGeometry =
    null;


  if (
    includeGeometry
    &&
    uniquePlayerName
  ) {

    const playerTeam =
      candidateEvents.find(
        row =>
          row.playerName ===
          uniquePlayerName
      )
        ?.team
      ??
      opposingTeam;


    uniquePlayerGeometry =
      reconstructPlayerGeometry(

        uniquePlayerName,

        playerTeam,

        death,

        strictUniqueEvent
        ??
        candidateEvents[0]
        ??
        null
      );
  }


  const nearestCandidateOffsetTicks =
    candidateEvents.length >
      0

      ? candidateEvents
        .slice()
        .sort(
          (
            a,
            b
          ) =>
            Math.abs(
              a.offsetTicks
            ) -
            Math.abs(
              b.offsetTicks
            )
            ||
            a.offsetTicks -
            b.offsetTicks
        )[0]
        .offsetTicks

      : null;


  return {

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex:
      death.deathIndex,

    deathKey:
      death.deathKey,

    entityIndex:
      death.entityIndex,

    baseType:
      death.baseType,

    variantLabel:
      death.variantLabel,

    team:
      death.team,

    tick:
      death.tick,

    timeSeconds:
      death.timeSeconds,

    clock:
      death.clock,

    deathPosition:
      death.position,

    groundSoulMatched:
      death.groundSoulMatched,

    rangeGroup:
      death.rangeGroup,

    associationWindow:
      window,

    associationStatus,

    anySignal,

    uniquePlayerSignal,

    strictUniqueSignal,

    uniquePlayerName,

    nearestCandidateOffsetTicks,

    candidateEventCount:
      candidateEvents.length,

    candidatePlayerCount:
      playerNames.length,

    candidatePlayers:
      playerNames,

    candidateEvents,

    strictUniqueEvent,

    uniquePlayerGeometry
  };
}


// ============================================================
// WINDOW GROUP SUMMARY
// ============================================================

function summarizeWindowGroup(
  rows,
  groupName
) {

  const selected =
    rows.filter(
      row =>
        row.rangeGroup ===
        groupName
    );


  const anySignal =
    selected.filter(
      row =>
        row.anySignal
    ).length;


  const uniquePlayerSignal =
    selected.filter(
      row =>
        row.uniquePlayerSignal
    ).length;


  const strictUniqueSignal =
    selected.filter(
      row =>
        row.strictUniqueSignal
    ).length;


  return {

    total:
      selected.length,

    anySignal,

    anySignalRate:
      rate(
        anySignal,
        selected.length
      ),

    uniquePlayerSignal,

    uniquePlayerSignalRate:
      rate(
        uniquePlayerSignal,
        selected.length
      ),

    strictUniqueSignal,

    strictUniqueSignalRate:
      rate(
        strictUniqueSignal,
        selected.length
      )
  };
}


// ============================================================
// PRIMARY GROUP SUMMARY
// ============================================================

function summarizePrimaryGroup(
  rows,
  groupName
) {

  const selected =
    rows.filter(
      row =>
        row.rangeGroup ===
        groupName
    );


  const anySignal =
    selected.filter(
      row =>
        row.anySignal
    );


  const uniquePlayer =
    selected.filter(
      row =>
        row.uniquePlayerSignal
    );


  const strict =
    selected.filter(
      row =>
        row.strictUniqueSignal
    );


  const strictInside45 =
    strict.filter(
      row =>
        Number.isFinite(
          row
            ?.uniquePlayerGeometry
            ?.distanceAtDeath3D
        )
        &&
        row
          .uniquePlayerGeometry
          .distanceAtDeath3D <=
        documentedRangeHU
    );


  const strictOutside45 =
    strict.filter(
      strictUniquePlayerOutside45m
    );


  const strictPositionUnresolved =
    strict.filter(
      row =>
        !Number.isFinite(
          row
            ?.uniquePlayerGeometry
            ?.distanceAtDeath3D
        )
    );


  return {

    total:
      selected.length,

    anySignal:
      anySignal.length,

    anySignalRate:
      rate(
        anySignal.length,
        selected.length
      ),

    uniquePlayerSignal:
      uniquePlayer.length,

    uniquePlayerSignalRate:
      rate(
        uniquePlayer.length,
        selected.length
      ),

    strictUniqueSignal:
      strict.length,

    strictUniqueSignalRate:
      rate(
        strict.length,
        selected.length
      ),

    strictUniquePlayerInside45m:
      strictInside45.length,

    strictUniquePlayerOutside45m:
      strictOutside45.length,

    strictUniquePlayerPositionUnresolved:
      strictPositionUnresolved.length,

    strictUniquePlayerDistance3D:
      summarizeNumbers(

        strict
          .map(
            row =>
              row
                ?.uniquePlayerGeometry
                ?.distanceAtDeath3D
          )
          .filter(
            Number.isFinite
          )
      ),

    strictUniqueOffsetTicks:
      summarizeNumbers(

        strict
          .map(
            row =>
              row
                ?.strictUniqueEvent
                ?.offsetTicks
          )
          .filter(
            Number.isFinite
          )
      )
  };
}


// ============================================================
// EVENT <-> DEATH CANDIDACY
// ============================================================

function collectPositiveLastHitEvents(
  minTick,
  maxTick
) {

  const start =
    lowerBoundByTick(
      positiveLastHitEvents,
      minTick
    );


  const rows =
    [];


  for (
    let i =
      start;

    i <
      positiveLastHitEvents.length
      &&
      positiveLastHitEvents[i].tick <=
      maxTick;

    i++
  ) {

    rows.push(
      positiveLastHitEvents[i]
    );
  }


  return rows;
}


function countCandidateDeathsForEvent(
  event,
  window
) {

  const minimumDeathTick =
    event.tick -
    window.maxOffsetTicks;


  const maximumDeathTick =
    event.tick -
    window.minOffsetTicks;


  const start =
    lowerBoundByTick(
      deaths,
      minimumDeathTick
    );


  const requiredTrooperTeam =
    oppositeTeam(
      event.team
    );


  let count =
    0;


  for (
    let i =
      start;

    i <
      deaths.length
      &&
      deaths[i].tick <=
      maximumDeathTick;

    i++
  ) {

    if (
      deaths[i].team ===
      requiredTrooperTeam
    ) {

      count++;
    }
  }


  return count;
}


// ============================================================
// PLAYER GEOMETRY
// ============================================================

function reconstructPlayerGeometry(
  playerName,
  team,
  death,
  counterEvent
) {

  const timeline =
    timelineByPlayerTeam.get(
      `${playerName}|${team}`
    )
    ??
    null;


  if (
    !timeline
  ) {

    return {

      resolved:
        false,

      reason:
        'PLAYER_TIMELINE_NOT_FOUND'
    };
  }


  const atDeath =
    estimateStateAtTime(
      timeline.rows,
      death.timeSeconds
    );


  const counterTimeSeconds =
    counterEvent

      ? tickToMatchTime(
        counterEvent.tick
      )

      : null;


  const atCounter =
    Number.isFinite(
      counterTimeSeconds
    )

      ? estimateStateAtTime(
        timeline.rows,
        counterTimeSeconds
      )

      : null;


  const distanceAtDeath3D =
    atDeath

      ? getDistance3D(
        death.position,
        atDeath.position
      )

      : null;


  const distanceAtDeathXY =
    atDeath

      ? getDistanceXY(
        death.position,
        atDeath.position
      )

      : null;


  const distanceAtCounter3D =
    atCounter

      ? getDistance3D(
        death.position,
        atCounter.position
      )

      : null;


  const distanceAtCounterXY =
    atCounter

      ? getDistanceXY(
        death.position,
        atCounter.position
      )

      : null;


  return {

    resolved:
      Boolean(
        atDeath
      ),

    playerName,

    team,

    deathTimeState:
      atDeath

        ? {

          method:
            atDeath.method,

          sourceTimeDelta:
            atDeath.sourceTimeDelta,

          timeSeconds:
            atDeath.timeSeconds,

          position:
            atDeath.position
        }

        : null,

    distanceAtDeath3D,

    distanceAtDeathXY,

    inside45mAtDeath3D:
      Number.isFinite(
        distanceAtDeath3D
      )

        ? distanceAtDeath3D <=
          documentedRangeHU

        : null,

    counterEventState:
      atCounter

        ? {

          tick:
            counterEvent.tick,

          timeSeconds:
            counterTimeSeconds,

          method:
            atCounter.method,

          sourceTimeDelta:
            atCounter.sourceTimeDelta,

          position:
            atCounter.position
        }

        : null,

    distanceAtCounter3D,

    distanceAtCounterXY
  };
}


// ============================================================
// SCRIPT 57 STYLE STATE ESTIMATION
// ============================================================

function estimateStateAtTime(
  rows,
  timeSeconds
) {

  const index =
    lowerBoundByTime(
      rows,
      timeSeconds
    );


  const after =
    index <
      rows.length

      ? rows[index]

      : null;


  const before =
    index >
      0

      ? rows[
        index -
        1
      ]

      : null;


  if (
    after
    &&
    Math.abs(
      after.timeSeconds -
      timeSeconds
    ) <
    1e-9
    &&
    validPlayerSample(
      after
    )
  ) {

    return {

      timeSeconds,

      position:
        after.position,

      method:
        'EXACT_SAMPLE',

      sourceTimeDelta:
        0
    };
  }


  if (
    before
    &&
    after
    &&
    validPlayerSample(
      before
    )
    &&
    validPlayerSample(
      after
    )
  ) {

    const gap =
      after.timeSeconds -
      before.timeSeconds;


    if (
      gap >
      0
      &&
      gap <=
      MAX_INTERPOLATION_GAP_SECONDS
    ) {

      const fraction =
        (
          timeSeconds -
          before.timeSeconds
        )
        /
        gap;


      if (
        fraction >=
        0
        &&
        fraction <=
        1
      ) {

        return {

          timeSeconds,

          position:
            interpolatePosition(
              before.position,
              after.position,
              fraction
            ),

          method:
            'LINEAR_INTERPOLATION',

          sourceTimeDelta:
            Math.min(

              Math.abs(
                timeSeconds -
                before.timeSeconds
              ),

              Math.abs(
                after.timeSeconds -
                timeSeconds
              )
            )
        };
      }
    }
  }


  const candidates =
    [];


  for (
    const row
    of [
      before,
      after
    ]
  ) {

    if (
      !validPlayerSample(
        row
      )
    ) {

      continue;
    }


    const delta =
      Math.abs(
        row.timeSeconds -
        timeSeconds
      );


    if (
      delta <=
      MAX_NEAREST_SAMPLE_DELTA_SECONDS
    ) {

      candidates.push({
        row,
        delta
      });
    }
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      a.delta -
      b.delta
  );


  const best =
    candidates[0]
    ??
    null;


  if (
    !best
  ) {

    return null;
  }


  return {

    timeSeconds:
      best.row.timeSeconds,

    position:
      best.row.position,

    method:
      'NEAREST_VALID_SAMPLE',

    sourceTimeDelta:
      best.delta
  };
}


function validPlayerSample(
  row
) {

  return Boolean(

    row
    &&
    row.alive ===
    true
    &&
    row.movementValid ===
    true
    &&
    row.position
  );
}


function interpolatePosition(
  a,
  b,
  fraction
) {

  return {

    x:
      a.x +
      (
        b.x -
        a.x
      ) *
      fraction,

    y:
      a.y +
      (
        b.y -
        a.y
      ) *
      fraction,

    z:
      a.z +
      (
        b.z -
        a.z
      ) *
      fraction
  };
}


// ============================================================
// PLAYER DATA
// ============================================================

async function loadPlayerData(
  path
) {

  const playerByControllerIndex =
    new Map();


  const playerByName =
    new Map();


  const timelineByPlayerTeam =
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


    const controllerIndex =
      finite(
        row
          ?.controller
          ?.entityIndex
      );


    const playerName =
      row
        ?.controller
        ?.playerName
      ??
      null;


    const team =
      finite(
        row
          ?.controller
          ?.team
      );


    if (
      controllerIndex !==
      null
      &&
      playerName
    ) {

      const old =
        playerByControllerIndex.get(
          controllerIndex
        )
        ??
        playerByName.get(
          playerName
        )
        ??
        {};


      const identity = {

        playerName,

        team:
          team
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

        controllerEntityIndex:
          controllerIndex,

        pawnEntityIndex:
          finite(
            row
              ?.pawn
              ?.entityIndex
          )
          ??
          old.pawnEntityIndex
          ??
          null
      };


      playerByControllerIndex.set(
        controllerIndex,
        identity
      );


      playerByName.set(
        playerName,
        identity
      );
    }


    const timeSeconds =
      finite(
        row?.matchTimeSeconds
      );


    const position =
      normalizePosition(
        row
          ?.pawn
          ?.positionWorld
      );


    if (
      timeSeconds ===
      null
      ||
      !playerName
      ||
      team ===
      null
    ) {

      continue;
    }


    const key =
      `${playerName}|${team}`;


    if (
      !timelineByPlayerTeam.has(
        key
      )
    ) {

      timelineByPlayerTeam.set(

        key,

        {

          playerName,

          team,

          rows:
            []
        }
      );
    }


    timelineByPlayerTeam
      .get(
        key
      )
      .rows
      .push({

        timeSeconds,

        alive:
          row
            ?.controller
            ?.alive ===
          true,

        movementValid:
          row
            ?.pawn
            ?.positionValidForMovement ===
          true,

        position
      });
  }


  for (
    const timeline
    of timelineByPlayerTeam.values()
  ) {

    timeline.rows.sort(
      (
        a,
        b
      ) =>
        a.timeSeconds -
        b.timeSeconds
    );
  }


  return {

    playerByControllerIndex,

    playerByName,

    timelineByPlayerTeam,

    players:
      [
        ...playerByName.values()
      ].sort(
        (
          a,
          b
        ) =>
          (
            a.team
            ??
            99
          ) -
          (
            b.team
            ??
            99
          )
          ||
          a.playerName.localeCompare(
            b.playerName
          )
      )
  };
}


// ============================================================
// DEATH NORMALIZATION / RANGE GROUP
// ============================================================

function normalizeDeath(
  row
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  const entityIndex =
    finite(
      row
        ?.trooper
        ?.entityIndex
    );


  const tick =
    finite(
      row
        ?.timing
        ?.tick
    );


  const timeSeconds =
    finite(
      row
        ?.timing
        ?.timeSeconds
    );


  const team =
    finite(
      row
        ?.trooper
        ?.team
    );


  const position =
    normalizePosition(
      row
        ?.trooper
        ?.position
    );


  if (
    deathIndex ===
    null
    ||
    entityIndex ===
    null
    ||
    tick ===
    null
    ||
    timeSeconds ===
    null
    ||
    team ===
    null
    ||
    !position
  ) {

    return null;
  }


  const groundSoulMatched =
    row
      ?.match
      ?.status ===
      'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
    ||
    Boolean(
      row?.groundSoul
    );


  return {

    deathIndex,

    deathKey:
      row?.deathKey
      ??
      null,

    entityIndex,

    baseType:
      row
        ?.trooper
        ?.baseType
      ??
      'UNKNOWN',

    variantLabel:
      row
        ?.trooper
        ?.variantLabel
      ??
      'UNKNOWN',

    team,

    tick,

    timeSeconds,

    clock:
      row
        ?.timing
        ?.clock
      ??
      formatClock(
        timeSeconds
      ),

    position,

    groundSoulMatched,

    rangeGroup:
      null
  };
}


function classifyRangeGroup(
  death
) {

  if (
    death.groundSoulMatched
  ) {

    return matchedOutside45Indexes.has(
      death.deathIndex
    )

      ? 'MATCHED_OUTSIDE_45M'

      : 'MATCHED_INSIDE_45M';
  }


  if (
    unmatchedUnresolvedIndexes.has(
      death.deathIndex
    )
  ) {

    return 'UNMATCHED_RANGE_UNRESOLVED';
  }


  if (
    unmatchedInside45Indexes.has(
      death.deathIndex
    )
  ) {

    return 'UNMATCHED_INSIDE_45M';
  }


  return 'UNMATCHED_OUTSIDE_45M';
}


// ============================================================
// ENTITY HELPERS
// ============================================================

function safeGetChanges(
  event
) {

  try {

    return typeof event?.getChanges ===
      'function'

      ? event.getChanges()

      : null;

  } catch {

    return null;
  }
}


function extractChangedFields(
  raw
) {

  if (
    raw ==
    null
  ) {

    return [];
  }


  if (
    raw instanceof
    Map
  ) {

    return [
      ...raw.keys()
    ].map(
      String
    );
  }


  if (
    Array.isArray(
      raw
    )
  ) {

    return [

      ...new Set(

        raw
          .map(
            row =>
              Array.isArray(
                row
              )

                ? row[0]

                : row?.fieldName
                  ??
                  row?.name
                  ??
                  row?.key
                  ??
                  row?.path
          )
          .filter(
            Boolean
          )
          .map(
            String
          )
      )
    ];
  }


  return typeof raw ===
    'object'

    ? Object.keys(
      raw
    )

    : [];
}


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
// SEARCH HELPERS
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

    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );


    if (
      rows[mid].tick <
      tick
    ) {

      low =
        mid +
        1;

    } else {

      high =
        mid;
    }
  }


  return low;
}


function lowerBoundByTime(
  rows,
  timeSeconds
) {

  let low =
    0;

  let high =
    rows.length;


  while (
    low <
    high
  ) {

    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );


    if (
      rows[mid].timeSeconds <
      timeSeconds
    ) {

      low =
        mid +
        1;

    } else {

      high =
        mid;
    }
  }


  return low;
}


// ============================================================
// POSITION / DISTANCE
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
    firstFinite([
      value.x,
      value.X,
      value[0]
    ]);


  const y =
    firstFinite([
      value.y,
      value.Y,
      value[1]
    ]);


  const z =
    firstFinite([
      value.z,
      value.Z,
      value[2]
    ]);


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


function getDistance3D(
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
    dx * dx +
    dy * dy +
    dz * dz
  );
}


function getDistanceXY(
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
    dx * dx +
    dy * dy
  );
}


// ============================================================
// PRIMARY CASE HELPERS
// ============================================================

function strictUniquePlayerOutside45m(
  row
) {

  return row.strictUniqueSignal
    &&
    Number.isFinite(
      row
        ?.uniquePlayerGeometry
        ?.distanceAtDeath3D
    )
    &&
    row
      .uniquePlayerGeometry
      .distanceAtDeath3D >
    documentedRangeHU;
}


function compactPrimaryCase(
  row
) {

  return {

    deathIndex:
      row.deathIndex,

    deathKey:
      row.deathKey,

    clock:
      row.clock,

    baseType:
      row.baseType,

    variantLabel:
      row.variantLabel,

    team:
      row.team,

    rangeGroup:
      row.rangeGroup,

    associationStatus:
      row.associationStatus,

    candidateEventCount:
      row.candidateEventCount,

    candidatePlayerCount:
      row.candidatePlayerCount,

    uniquePlayerName:
      row.uniquePlayerName,

    strictUniqueEvent:
      row.strictUniqueEvent,

    uniquePlayerGeometry:
      row.uniquePlayerGeometry
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


async function writeJsonl(
  path,
  rows
) {

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


      writer.end(
        resolvePromise
      );
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


function oppositeTeam(
  team
) {

  if (
    team ===
    2
  ) {

    return 3;
  }


  if (
    team ===
    3
  ) {

    return 2;
  }


  return null;
}


function tickToMatchTime(
  tick
) {

  return tick /
    TICK_RATE -
    MATCH_CLOCK_OFFSET_SECONDS;
}


function approximatelyEqual(
  a,
  b,
  epsilon = 1e-9
) {

  return Number.isFinite(
    a
  )
    &&
    Number.isFinite(
      b
    )
    &&
    Math.abs(
      a -
      b
    ) <=
    epsilon;
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


function difference(
  a,
  b
) {

  return Number.isFinite(
    a
  )
    &&
    Number.isFinite(
      b
    )

    ? a -
      b

    : null;
}


function ratio(
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
      ) +
      1
    );
  }


  return Object.fromEntries(

    [
      ...map.entries()
    ].sort(
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


function countByNumericObject(
  rows,
  selector
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const value =
      finite(
        selector(
          row
        )
      );


    if (
      value ===
      null
    ) {

      continue;
    }


    map.set(

      value,

      (
        map.get(
          value
        )
        ??
        0
      ) +
      1
    );
  }


  return Object.fromEntries(

    [
      ...map.entries()
    ].sort(
      (
        a,
        b
      ) =>
        Number(
          a[0]
        ) -
        Number(
          b[0]
        )
    )
  );
}


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

      p10:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p90:
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

    p10:
      quantile(
        clean,
        0.10
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

    p90:
      quantile(
        clean,
        0.90
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      clean.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
      clean.length
  };
}


function quantile(
  values,
  q
) {

  if (
    values.length ===
    0
  ) {

    return null;
  }


  if (
    values.length ===
    1
  ) {

    return values[0];
  }


  const position =
    (
      values.length -
      1
    ) *
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

    return values[
      lower
    ];
  }


  const weight =
    position -
    lower;


  return values[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    values[
      upper
    ] *
    weight;
}


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


function formatClock(
  timeSeconds
) {

  if (
    !Number.isFinite(
      timeSeconds
    )
  ) {

    return null;
  }


  const sign =
    timeSeconds <
    0

      ? '-'

      : '';


  const absolute =
    Math.abs(
      timeSeconds
    );


  const minutes =
    Math.floor(
      absolute /
      60
    );


  const seconds =
    Math.floor(
      absolute %
      60
    );


  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}


function formatTriple(
  group
) {

  if (
    !group
  ) {

    return 'n/a';
  }


  return `${group.anySignal}/${group.uniquePlayerSignal}/${group.strictUniqueSignal}`;
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
    ).toFixed(2)}%`

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


  const percent =
    value *
    100;


  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}pp`;
}


function formatMetric(
  value
) {

  return Number.isFinite(
    value
  )

    ? value.toFixed(
      4
    )

    : 'n/a';
}


function formatNumber(
  value
) {

  return Number.isFinite(
    value
  )

    ? Number(
      value.toFixed(
        3
      )
    ).toString()

    : 'n/a';
}


function formatSignedInteger(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'n/a';
  }


  return value >
    0

    ? `+${value}`

    : String(
      value
    );
}