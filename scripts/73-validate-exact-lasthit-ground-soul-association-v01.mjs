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

const LAST_HIT_FIELD =
  'm_iLastHits';


// ============================================================
// NEGATIVE-CONTROL OFFSETS
//
// Exact tick is the candidate signal.
//
// Shifted ticks are nearby negative controls. They are not
// interpreted as alternate mechanic windows.
// ============================================================

const CONTROL_OFFSETS = [
  -8,
  -4,
  -2,
  -1,
  0,
  1,
  2,
  4,
  8
];


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

const script72SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_lasthit_counter_diagnostic_v01.json'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_validation_v01.json'
  );

const outputGroupsPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_groups_v01.jsonl'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_cases_v01.jsonl'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    deathStreamPath,
    script55SummaryPath,
    script57SummaryPath,
    script57OutlierPath,
    script72SummaryPath
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
// LOAD PRIOR SUMMARIES
// ============================================================

const script55 =
  JSON.parse(
    readFileSync(
      script55SummaryPath,
      'utf8'
    )
  );

const script57 =
  JSON.parse(
    readFileSync(
      script57SummaryPath,
      'utf8'
    )
  );

const script72 =
  JSON.parse(
    readFileSync(
      script72SummaryPath,
      'utf8'
    )
  );


if (
  script55
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 55 did not PASS.'
  );
}


if (
  script72
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 72 did not PASS.'
  );
}


// ============================================================
// RANGE SETS
// ============================================================

const outlierRows =
  await loadJsonl(
    script57OutlierPath
  );


const matchedOutside =
  new Set(

    outlierRows
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


const unmatchedInside =
  new Set(

    outlierRows
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


const unmatchedUnresolved =
  new Set(

    outlierRows
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
// LOAD DEATH STREAM
// ============================================================

console.log('');
console.log(
  'Loading economic Trooper deaths...'
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
  `Deaths: ${deaths.length}`
);


// ============================================================
// PLAYER / CONTROLLER IDENTITIES
// ============================================================

console.log(
  'Loading controller identities...'
);


const playerByControllerIndex =
  await loadPlayerIdentities(
    playerStatePath
  );


console.log(
  `Controllers: ${playerByControllerIndex.size}`
);


// ============================================================
// RESCAN m_iLastHits
// ============================================================

const previousValues =
  new Map();

const lastHitEvents =
  [];

let controllerEvents =
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
          : playerByControllerIndex.get(
            entityIndex
          );


      if (
        !player
      ) {
        continue;
      }


      controllerEvents++;


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


      const prior =
        previousValues.get(
          entityIndex
        )
        ??
        null;


      previousValues.set(
        entityIndex,
        {
          tick,
          value
        }
      );


      if (
        !prior
      ) {
        continue;
      }


      const delta =
        value -
        prior.value;


      if (
        delta <=
        0
      ) {
        continue;
      }


      lastHitEvents.push({

        tick,

        controllerEntityIndex:
          entityIndex,

        playerName:
          player.playerName,

        team:
          player.team,

        heroId:
          player.heroId,

        previousValue:
          prior.value,

        currentValue:
          value,

        delta
      });
    }
  }
);


console.log('');
console.log(
  'Rescanning replay for exact-tick last-hit telemetry...'
);
console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


lastHitEvents.sort(
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


const positiveUnits =
  lastHitEvents.reduce(
    (
      total,
      row
    ) =>
      total +
      row.delta,
    0
  );


console.log(
  `Positive events: ${lastHitEvents.length}`
);

console.log(
  `Positive units:  ${positiveUnits}`
);


// ============================================================
// INDEX COUNTER EVENTS BY TICK + PLAYER TEAM
// ============================================================

const counterByTickTeam =
  new Map();


for (
  const event
  of lastHitEvents
) {

  const key =
    tickTeamKey(
      event.tick,
      event.team
    );


  if (
    !counterByTickTeam.has(
      key
    )
  ) {

    counterByTickTeam.set(
      key,
      []
    );
  }


  counterByTickTeam
    .get(
      key
    )
    .push(
      event
    );
}


// ============================================================
// GROUP ECONOMIC DEATHS BY TICK + TROOPER TEAM
//
// This avoids pretending that multiple same-tick deaths are
// statistically independent attribution events.
// ============================================================

const groupMap =
  new Map();


for (
  const death
  of deaths
) {

  const key =
    tickTeamKey(
      death.tick,
      death.team
    );


  if (
    !groupMap.has(
      key
    )
  ) {

    groupMap.set(
      key,
      {
        tick:
          death.tick,

        trooperTeam:
          death.team,

        deaths:
          []
      }
    );
  }


  groupMap
    .get(
      key
    )
    .deaths
    .push(
      death
    );
}


const groups =
  [
    ...groupMap.values()
  ]
    .sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
        ||
        a.trooperTeam -
        b.trooperTeam
    )
    .map(
      buildGroup
    );


// ============================================================
// ISOLATED SINGLE-DEATH COHORT
// ============================================================

const isolated =
  groups.filter(
    row =>
      row.deathCount ===
      1
  );


const isolatedMatched =
  isolated.filter(
    row =>
      row.matchedCount ===
      1
  );


const isolatedUnmatched =
  isolated.filter(
    row =>
      row.unmatchedCount ===
      1
  );


const isolatedMatchedOutside =
  isolatedMatched.filter(
    row =>
      row.deaths[0].rangeGroup ===
      'MATCHED_OUTSIDE_45M'
  );


const isolatedUnmatchedOutside =
  isolatedUnmatched.filter(
    row =>
      row.deaths[0].rangeGroup ===
      'UNMATCHED_OUTSIDE_45M'
  );


// ============================================================
// EXACT SIGNAL RATES
// ============================================================

const exactIsolatedMatchedSignal =
  isolatedMatched.filter(
    row =>
      row.exact.lastHitUnits >
      0
  );


const exactIsolatedUnmatchedSignal =
  isolatedUnmatched.filter(
    row =>
      row.exact.lastHitUnits >
      0
  );


const exactMatchedRate =
  rate(
    exactIsolatedMatchedSignal.length,
    isolatedMatched.length
  );


const exactUnmatchedRate =
  rate(
    exactIsolatedUnmatchedSignal.length,
    isolatedUnmatched.length
  );


const exactRateDifference =
  difference(
    exactMatchedRate,
    exactUnmatchedRate
  );


const exactRiskRatio =
  ratio(
    exactMatchedRate,
    exactUnmatchedRate
  );


// ============================================================
// OUTSIDE-45M ISOLATED COHORT
// ============================================================

const isolatedMatchedOutsideSignal =
  isolatedMatchedOutside.filter(
    row =>
      row.exact.lastHitUnits >
      0
  );


const isolatedUnmatchedOutsideSignal =
  isolatedUnmatchedOutside.filter(
    row =>
      row.exact.lastHitUnits >
      0
  );


const isolatedMatchedOutsideRate =
  rate(
    isolatedMatchedOutsideSignal.length,
    isolatedMatchedOutside.length
  );


const isolatedUnmatchedOutsideRate =
  rate(
    isolatedUnmatchedOutsideSignal.length,
    isolatedUnmatchedOutside.length
  );


// ============================================================
// OFFSET NEGATIVE CONTROLS
// ============================================================

const offsetControls =
  CONTROL_OFFSETS.map(
    offset =>
      summarizeOffset(
        offset
      )
  );


// ============================================================
// EXACT ACCOUNTING / CONSERVATION
//
// Counter units may include other farm sources on the same tick,
// so exact equality is supporting evidence, not an assumed law.
// ============================================================

const groupsWithCounterSignal =
  groups.filter(
    row =>
      row.exact.lastHitUnits >
      0
  );


const exactUnitsEqualMatched =
  groups.filter(
    row =>
      row.exact.lastHitUnits ===
      row.matchedCount
  );


const exactUnitsEqualTotalDeaths =
  groups.filter(
    row =>
      row.exact.lastHitUnits ===
      row.deathCount
  );


const exactResiduals =
  groups.map(
    row =>
      row.exact.lastHitUnits -
      row.matchedCount
  );


// ============================================================
// INVESTIGATE THE TWO SCRIPT72 UNMATCHED EXACT COINCIDENCES
// ============================================================

const unmatchedExactCases =
  [];


for (
  const group
  of groups
) {

  if (
    group.exact.lastHitUnits <=
    0
  ) {
    continue;
  }


  for (
    const death
    of group.deaths
  ) {

    if (
      death.groundSoulMatched
    ) {
      continue;
    }


    unmatchedExactCases.push({

      deathIndex:
        death.deathIndex,

      deathKey:
        death.deathKey,

      clock:
        death.clock,

      baseType:
        death.baseType,

      rangeGroup:
        death.rangeGroup,

      tick:
        death.tick,

      trooperTeam:
        death.team,

      sameTickTeamDeathCount:
        group.deathCount,

      sameTickTeamMatchedCount:
        group.matchedCount,

      sameTickTeamUnmatchedCount:
        group.unmatchedCount,

      exactOpposingLastHitUnits:
        group.exact.lastHitUnits,

      exactOpposingLastHitEvents:
        group.exact.events,

      collisionWithMatchedDeathSameTick:
        group.matchedCount >
        0
    });
  }
}


// ============================================================
// MATCHED >45M CASES
// ============================================================

const matchedOutsideCases =
  [];


for (
  const group
  of groups
) {

  for (
    const death
    of group.deaths
  ) {

    if (
      death.rangeGroup !==
      'MATCHED_OUTSIDE_45M'
    ) {
      continue;
    }


    matchedOutsideCases.push({

      deathIndex:
        death.deathIndex,

      deathKey:
        death.deathKey,

      clock:
        death.clock,

      baseType:
        death.baseType,

      tick:
        death.tick,

      trooperTeam:
        death.team,

      sameTickTeamDeathCount:
        group.deathCount,

      sameTickTeamMatchedCount:
        group.matchedCount,

      sameTickTeamUnmatchedCount:
        group.unmatchedCount,

      isolated:
        group.deathCount ===
        1,

      exactOpposingLastHitUnits:
        group.exact.lastHitUnits,

      exactOpposingLastHitEvents:
        group.exact.events
    });
  }
}


// ============================================================
// VALIDATION
// ============================================================

const expected72PositiveEvents =
  finite(
    script72
      ?.lastHitCounterTelemetry
      ?.positiveDeltaEvents
  );


const expected72PositiveUnits =
  finite(
    script72
      ?.lastHitCounterTelemetry
      ?.positiveCounterUnits
  );


const validationChecks = {

  script55Passed:
    check(
      script55
        ?.validation
        ?.pass,
      true,
      script55
        ?.validation
        ?.pass ===
      true
    ),


  script72Passed:
    check(
      script72
        ?.validation
        ?.pass,
      true,
      script72
        ?.validation
        ?.pass ===
      true
    ),


  deathCount:
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


  matchedCount:
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
        : true
    ),


  unmatchedCount:
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


  matchedOutsideCount:
    check(
      deaths.filter(
        row =>
          row.rangeGroup ===
          'MATCHED_OUTSIDE_45M'
      ).length,
      replayName ===
        'test'
        ? 15
        : '>0',
      replayName ===
        'test'
        ? deaths.filter(
          row =>
            row.rangeGroup ===
            'MATCHED_OUTSIDE_45M'
        ).length ===
          15
        : true
    ),


  positiveEventCountAgreesWith72:
    check(
      lastHitEvents.length,
      expected72PositiveEvents,
      expected72PositiveEvents ===
        null
        ? lastHitEvents.length >
          0
        : lastHitEvents.length ===
          expected72PositiveEvents
    ),


  positiveUnitsAgreeWith72:
    check(
      positiveUnits,
      expected72PositiveUnits,
      expected72PositiveUnits ===
        null
        ? positiveUnits >
          0
        : positiveUnits ===
          expected72PositiveUnits
    ),


  controllerCount:
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


  exactOffsetIncluded:
    check(
      CONTROL_OFFSETS.includes(
        0
      ),
      true,
      CONTROL_OFFSETS.includes(
        0
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

const summary = {

  replay:
    replayName,

  version:
    'TROOPER_GROUND_SOUL_EXACT_LASTHIT_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'EXACT_LASTHIT_GROUND_SOUL_ASSOCIATION_READY'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',


  purpose: [

    'Validate the Script 72 exact-tick m_iLastHits observation using tick-by-team aggregation.',

    'Avoid treating simultaneous Trooper deaths as independent per-death last-hit attributions.',

    'Measure the exact-tick last-hit counter association among isolated single-death matched and unmatched cohorts.',

    'Determine whether the rare unmatched exact-tick signals collide with matched Trooper deaths on the same tick.',

    'Use nearby shifted ticks as negative controls for temporal specificity.'
  ],


  semanticLimit: {

    observedField:
      LAST_HIT_FIELD,

    targetAttributionValidated:
      false,

    causalMechanicValidated:
      false,

    statement:
      'This validates temporal/statistical association only. m_iLastHits remains a controller counter and not direct victim identity telemetry.'
  },


  sourceCounts: {

    deaths:
      deaths.length,

    matched:
      deaths.filter(
        row =>
          row.groundSoulMatched
      ).length,

    unmatched:
      deaths.filter(
        row =>
          !row.groundSoulMatched
      ).length,

    tickTeamGroups:
      groups.length,

    isolatedSingleDeathGroups:
      isolated.length,

    isolatedMatched:
      isolatedMatched.length,

    isolatedUnmatched:
      isolatedUnmatched.length,

    isolatedMatchedOutside45m:
      isolatedMatchedOutside.length,

    isolatedUnmatchedOutside45m:
      isolatedUnmatchedOutside.length,

    lastHitPositiveEvents:
      lastHitEvents.length,

    lastHitPositiveUnits:
      positiveUnits
  },


  exactTickAssociation: {

    isolatedMatched: {

      total:
        isolatedMatched.length,

      withSignal:
        exactIsolatedMatchedSignal.length,

      rate:
        exactMatchedRate
    },

    isolatedUnmatched: {

      total:
        isolatedUnmatched.length,

      withSignal:
        exactIsolatedUnmatchedSignal.length,

      rate:
        exactUnmatchedRate
    },

    matchedMinusUnmatchedRateDifference:
      exactRateDifference,

    matchedVsUnmatchedRiskRatio:
      exactRiskRatio
  },


  outside45mIsolated: {

    matched: {

      total:
        isolatedMatchedOutside.length,

      withExactSignal:
        isolatedMatchedOutsideSignal.length,

      rate:
        isolatedMatchedOutsideRate
    },

    unmatched: {

      total:
        isolatedUnmatchedOutside.length,

      withExactSignal:
        isolatedUnmatchedOutsideSignal.length,

      rate:
        isolatedUnmatchedOutsideRate
    },

    rateDifference:
      difference(
        isolatedMatchedOutsideRate,
        isolatedUnmatchedOutsideRate
      ),

    riskRatio:
      ratio(
        isolatedMatchedOutsideRate,
        isolatedUnmatchedOutsideRate
      )
  },


  shiftedTickNegativeControls:
    offsetControls,


  tickTeamAccounting: {

    groups:
      groups.length,

    groupsWithAnyExactCounterSignal:
      groupsWithCounterSignal.length,

    groupsWhereExactCounterUnitsEqualMatchedDeaths:
      exactUnitsEqualMatched.length,

    equalityRateCounterUnitsVsMatchedDeaths:
      rate(
        exactUnitsEqualMatched.length,
        groups.length
      ),

    groupsWhereExactCounterUnitsEqualAllEconomicDeaths:
      exactUnitsEqualTotalDeaths.length,

    equalityRateCounterUnitsVsAllEconomicDeaths:
      rate(
        exactUnitsEqualTotalDeaths.length,
        groups.length
      ),

    residualExactCounterUnitsMinusMatchedDeaths:
      summarizeNumbers(
        exactResiduals
      )
  },


  unmatchedExactCases,

  matchedOutside45mCases:
    matchedOutsideCases,


  interpretation: {

    strongestTest:
      'The isolated single-death cohort is the cleanest evidence because no second same-team economic Trooper death shares the tick.',

    unmatchedCoincidenceTest:
      'If unmatched exact-signal cases occur only in groups that also contain matched deaths, their counter signal should not be interpreted as evidence that the unmatched death itself generated the last-hit increment.',

    shiftedControls:
      'A large signal-rate peak at offset 0 relative to +/- nearby ticks supports exact temporal coupling and argues against generic high-frequency farming coincidence.',

    mechanicCaution:
      'Even a near-perfect exact association would show that AssignedGold matches and m_iLastHits increments co-occur. It would not by itself prove whether last-hit credit causes AssignedGold, AssignedGold causes the counter, or both derive from a common underlying kill event.'
  },


  validation: {

    pass:
      validationPass,

    checks:
      validationChecks
  },


  outputs: {

    summary:
      outputSummaryPath,

    groups:
      outputGroupsPath,

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


await writeJsonl(
  outputGroupsPath,
  groups
);


await writeJsonl(

  outputCasesPath,

  [
    ...matchedOutsideCases.map(
      row => ({
        category:
          'MATCHED_OUTSIDE_45M',
        ...row
      })
    ),

    ...unmatchedExactCases.map(
      row => ({
        category:
          'UNMATCHED_WITH_EXACT_LASTHIT_SIGNAL',
        ...row
      })
    )
  ]
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'EXACT LAST-HIT / GROUND-SOUL VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');


console.log(
  'ISOLATED SINGLE-DEATH COHORT'
);

console.log(
  '----------------------------'
);


console.log(
  `Matched:   ${exactIsolatedMatchedSignal.length}/${isolatedMatched.length} = ${formatPercent(exactMatchedRate)}`
);

console.log(
  `Unmatched: ${exactIsolatedUnmatchedSignal.length}/${isolatedUnmatched.length} = ${formatPercent(exactUnmatchedRate)}`
);

console.log(
  `Difference: ${formatSignedPercent(exactRateDifference)}`
);

console.log(
  `Risk ratio: ${formatMetric(exactRiskRatio)}`
);


console.log('');

console.log(
  'ISOLATED OUTSIDE-45M COHORT'
);

console.log(
  '---------------------------'
);


console.log(
  `Matched outside:   ${isolatedMatchedOutsideSignal.length}/${isolatedMatchedOutside.length} = ${formatPercent(isolatedMatchedOutsideRate)}`
);

console.log(
  `Unmatched outside: ${isolatedUnmatchedOutsideSignal.length}/${isolatedUnmatchedOutside.length} = ${formatPercent(isolatedUnmatchedOutsideRate)}`
);


console.log('');

console.log(
  'SHIFTED-TICK NEGATIVE CONTROLS'
);

console.log(
  '------------------------------'
);

console.log(
  'Offset   matched signal        unmatched signal'
);


for (
  const row
  of offsetControls
) {

  console.log(

    `${formatSignedInteger(row.offsetTicks).padStart(5)}   ` +

    `${String(row.matchedWithSignal).padStart(4)}/${String(row.matchedTotal).padEnd(4)} ` +
    `${formatPercent(row.matchedSignalRate).padStart(8)}   ` +

    `${String(row.unmatchedWithSignal).padStart(4)}/${String(row.unmatchedTotal).padEnd(4)} ` +
    `${formatPercent(row.unmatchedSignalRate).padStart(8)}`
  );
}


console.log('');

console.log(
  'TICK-TEAM ACCOUNTING'
);

console.log(
  '--------------------'
);


console.log(
  `Groups: ${groups.length}`
);

console.log(
  `Counter units == matched deaths: ${exactUnitsEqualMatched.length}/${groups.length} = ${formatPercent(rate(exactUnitsEqualMatched.length, groups.length))}`
);

console.log(
  `Counter units == all deaths:     ${exactUnitsEqualTotalDeaths.length}/${groups.length} = ${formatPercent(rate(exactUnitsEqualTotalDeaths.length, groups.length))}`
);


console.log('');

console.log(
  'UNMATCHED EXACT-SIGNAL CASES'
);

console.log(
  '----------------------------'
);


if (
  unmatchedExactCases.length ===
  0
) {

  console.log(
    'None.'
  );

} else {

  for (
    const row
    of unmatchedExactCases
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)}  ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `${String(row.baseType ?? '').padEnd(7)} ` +

      `groupDeaths=${row.sameTickTeamDeathCount} ` +

      `matchedSameTick=${row.sameTickTeamMatchedCount} ` +

      `units=${row.exactOpposingLastHitUnits} ` +

      `collision=${row.collisionWithMatchedDeathSameTick}`
    );
  }
}


console.log('');

console.log(
  '15 MATCHED >45M CASES'
);

console.log(
  '---------------------'
);


for (
  const row
  of matchedOutsideCases
) {

  console.log(

    `${String(row.deathIndex).padStart(4)}  ` +

    `${String(row.clock ?? '').padEnd(6)} ` +

    `${String(row.baseType ?? '').padEnd(7)} ` +

    `isolated=${String(row.isolated).padEnd(5)} ` +

    `groupDeaths=${row.sameTickTeamDeathCount} ` +

    `matched=${row.sameTickTeamMatchedCount} ` +

    `units=${row.exactOpposingLastHitUnits}`
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
  `Groups:\n${outputGroupsPath}`
);

console.log('');

console.log(
  `Cases:\n${outputCasesPath}`
);

console.log('');


// ============================================================
// GROUP BUILDER
// ============================================================

function buildGroup(
  rawGroup
) {

  const opposingTeam =
    oppositeTeam(
      rawGroup.trooperTeam
    );


  const matchedCount =
    rawGroup.deaths.filter(
      row =>
        row.groundSoulMatched
    ).length;


  const unmatchedCount =
    rawGroup.deaths.length -
    matchedCount;


  const offsetData =
    {};


  for (
    const offset
    of CONTROL_OFFSETS
  ) {

    const events =
      counterByTickTeam.get(

        tickTeamKey(
          rawGroup.tick +
          offset,
          opposingTeam
        )
      )
      ??
      [];


    offsetData[
      String(
        offset
      )
    ] = {

      offsetTicks:
        offset,

      eventCount:
        events.length,

      playerCount:
        new Set(
          events.map(
            row =>
              row.playerName
          )
        ).size,

      lastHitUnits:
        events.reduce(
          (
            total,
            row
          ) =>
            total +
            row.delta,
          0
        ),

      events:
        events.map(
          compactCounterEvent
        )
    };
  }


  return {

    schemaVersion:
      1,

    canonical:
      false,

    tick:
      rawGroup.tick,

    trooperTeam:
      rawGroup.trooperTeam,

    opposingTeam,

    deathCount:
      rawGroup.deaths.length,

    matchedCount,

    unmatchedCount,

    isolated:
      rawGroup.deaths.length ===
      1,

    deaths:
      rawGroup.deaths.map(
        compactDeath
      ),

    exact:
      offsetData['0'],

    offsetData
  };
}


// ============================================================
// NEGATIVE CONTROL SUMMARY
// ============================================================

function summarizeOffset(
  offset
) {

  const key =
    String(
      offset
    );


  const matchedWithSignal =
    isolatedMatched.filter(
      row =>
        (
          row
            ?.offsetData
            ?.[key]
            ?.lastHitUnits
          ??
          0
        ) >
        0
    ).length;


  const unmatchedWithSignal =
    isolatedUnmatched.filter(
      row =>
        (
          row
            ?.offsetData
            ?.[key]
            ?.lastHitUnits
          ??
          0
        ) >
        0
    ).length;


  return {

    offsetTicks:
      offset,

    matchedTotal:
      isolatedMatched.length,

    matchedWithSignal,

    matchedSignalRate:
      rate(
        matchedWithSignal,
        isolatedMatched.length
      ),

    unmatchedTotal:
      isolatedUnmatched.length,

    unmatchedWithSignal,

    unmatchedSignalRate:
      rate(
        unmatchedWithSignal,
        isolatedUnmatched.length
      )
  };
}


// ============================================================
// DEATH NORMALIZATION
// ============================================================

function normalizeDeath(
  row
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  const tick =
    finite(
      row
        ?.timing
        ?.tick
    );


  const team =
    finite(
      row
        ?.trooper
        ?.team
    );


  if (
    deathIndex ===
    null
    ||
    tick ===
    null
    ||
    team ===
    null
  ) {

    return null;
  }


  return {

    deathIndex,

    deathKey:
      row?.deathKey
      ??
      null,

    entityIndex:
      finite(
        row
          ?.trooper
          ?.entityIndex
      ),

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

    clock:
      row
        ?.timing
        ?.clock
      ??
      null,

    groundSoulMatched:
      row
        ?.match
        ?.status ===
        'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
      ||
      Boolean(
        row?.groundSoul
      ),

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

    return matchedOutside.has(
      death.deathIndex
    )

      ? 'MATCHED_OUTSIDE_45M'

      : 'MATCHED_INSIDE_45M';
  }


  if (
    unmatchedUnresolved.has(
      death.deathIndex
    )
  ) {

    return 'UNMATCHED_RANGE_UNRESOLVED';
  }


  if (
    unmatchedInside.has(
      death.deathIndex
    )
  ) {

    return 'UNMATCHED_INSIDE_45M';
  }


  return 'UNMATCHED_OUTSIDE_45M';
}


// ============================================================
// PLAYER IDENTITIES
// ============================================================

async function loadPlayerIdentities(
  path
) {

  const map =
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


    if (
      controllerIndex ===
      null
      ||
      !playerName
    ) {
      continue;
    }


    const old =
      map.get(
        controllerIndex
      )
      ??
      {};


    map.set(
      controllerIndex,
      {

        controllerEntityIndex:
          controllerIndex,

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
          null
      }
    );
  }


  return map;
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
// KEYS / COMPACT OUTPUT
// ============================================================

function tickTeamKey(
  tick,
  team
) {

  return `${tick}|${team}`;
}


function compactCounterEvent(
  row
) {

  return {

    tick:
      row.tick,

    controllerEntityIndex:
      row.controllerEntityIndex,

    playerName:
      row.playerName,

    team:
      row.team,

    heroId:
      row.heroId,

    delta:
      row.delta,

    previousValue:
      row.previousValue,

    currentValue:
      row.currentValue
  };
}


function compactDeath(
  row
) {

  return {

    deathIndex:
      row.deathIndex,

    deathKey:
      row.deathKey,

    entityIndex:
      row.entityIndex,

    baseType:
      row.baseType,

    variantLabel:
      row.variantLabel,

    team:
      row.team,

    clock:
      row.clock,

    groundSoulMatched:
      row.groundSoulMatched,

    rangeGroup:
      row.rangeGroup
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


function rate(
  numerator,
  denominator
) {

  if (
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

      median:
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

    median:
      quantile(
        clean,
        0.5
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
      )
      /
      clean.length
  };
}


function quantile(
  values,
  q
) {

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
    return values[
      lower
    ];
  }


  const weight =
    position -
    lower;


  return values[
    lower
  ]
    *
    (
      1 -
      weight
    )
    +
    values[
      upper
    ]
    *
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


  const valuePercent =
    value *
    100;


  return `${valuePercent > 0 ? '+' : ''}${valuePercent.toFixed(2)}pp`;
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


function formatSignedInteger(
  value
) {

  return value >
    0

    ? `+${value}`

    : String(
      value
    );
}