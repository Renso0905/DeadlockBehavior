import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Parser, InterceptorStage } from 'deadem';

const replayName = process.argv[2] ?? 'test';

const TICK_RATE = 64;
const HU_PER_METER = 39.37;
const ENTITY_INDEX_MASK = 0x3fff;

const WINDOW_SECONDS = 2.0;
const WINDOW_TICKS = Math.round(WINDOW_SECONDS * TICK_RATE);
const PRIMARY_MIN_DELAY_SECONDS = 1.0;

const SEARCH_MIN_HU = 650;
const SEARCH_MAX_HU = 850;
const SEARCH_STEP_HU = 1;

const STANDARD_THRESHOLDS = [
  700,
  720,
  725,
  729,
  730,
  731,
  732,
  735,
  740,
  750,
  768,
  775,
  782,
  800
];

const OUTLIER_TRACE_THRESHOLD_XY = 735;
const TRACE_TAIL_TICKS = 24;

const replayPath = resolve('replays', `${replayName}.dem`);

const script77SummaryPath = resolve(
  'output',
  replayName,
  'assigned_gold_vacuum_exact_geometry_validation_v01.json'
);

const script77CasesPath = resolve(
  'output',
  replayName,
  'assigned_gold_vacuum_exact_geometry_cases_v01.jsonl'
);

const outputSummaryPath = resolve(
  'output',
  replayName,
  'assigned_gold_vacuum_preonset_threshold_trace_v01.json'
);

const outputCasesPath = resolve(
  'output',
  replayName,
  'assigned_gold_vacuum_preonset_threshold_cases_v01.jsonl'
);

for (const path of [
  replayPath,
  script77SummaryPath,
  script77CasesPath
]) {
  if (!existsSync(path)) {
    throw new Error(`Missing required input:\n${path}`);
  }
}

const script77Summary = JSON.parse(
  readFileSync(script77SummaryPath, 'utf8')
);

if (script77Summary?.validation?.pass !== true) {
  throw new Error('Script 77 did not PASS.');
}

console.log('');
console.log('Loading Script 77 exact-geometry cases...');

const rawCases = await loadJsonl(script77CasesPath);

const cases = rawCases.map((row, caseIndex) => {
  const activationTick = finite(row?.activationTick);
  const onsetTick = finite(row?.onsetTick);

  const requestedStartTick =
    activationTick !== null && onsetTick !== null
      ? Math.max(
          activationTick,
          onsetTick - WINDOW_TICKS
        )
      : null;

  return {
    caseIndex,

    deathIndex:
      finite(row?.deathIndex),

    clock:
      row?.clock ?? null,

    baseType:
      row?.baseType ?? null,

    creditedPlayerName:
      row?.creditedPlayerName ?? null,

    creditedPlayerTeam:
      finite(row?.creditedPlayerTeam),

    targetPlayerName:
      row?.targetPlayerName ?? null,

    targetPlayerTeam:
      finite(row?.targetPlayerTeam),

    targetPawnEntityIndex:
      finite(row?.targetPawnEntityIndex),

    assignedGoldEntityIndex:
      finite(row?.assignedGoldEntityIndex),

    activationTick,

    onsetTick,

    targetDelaySeconds:
      finite(row?.targetDelaySeconds),

    script77PriorDistance3D:
      finite(row?.rawPriorDistance3D),

    script77OnsetDistance3D:
      finite(row?.rawOnsetDistance3D),

    script77PriorDistanceXY:
      finite(row?.rawPriorDistanceXY),

    script77OnsetDistanceXY:
      finite(row?.rawOnsetDistanceXY),

    requestedStartTick,

    samples: []
  };
});

console.log(`Cases: ${cases.length}`);

const primaryCases = cases.filter(
  row =>
    Number.isFinite(row.targetDelaySeconds) &&
    row.targetDelaySeconds >= PRIMARY_MIN_DELAY_SECONDS
);

console.log(
  `Primary stable-delayed cohort (>=${PRIMARY_MIN_DELAY_SECONDS}s): ${primaryCases.length}`
);


// ============================================================
// REQUEST RAW TICKS
// ============================================================

const needsByTick = new Map();

for (const row of cases) {
  if (
    row.requestedStartTick === null ||
    row.onsetTick === null
  ) {
    continue;
  }

  for (
    let tick = row.requestedStartTick;
    tick <= row.onsetTick;
    tick++
  ) {
    if (!needsByTick.has(tick)) {
      needsByTick.set(tick, []);
    }

    needsByTick.get(tick).push(row.caseIndex);
  }
}

console.log(`Requested tick keys: ${needsByTick.size}`);


// ============================================================
// RAW REPLAY RESCAN
// ============================================================

let requestedTicksSeen = 0;
let sampleRowsCaptured = 0;
let playerPositionsCaptured = 0;
let soulPositionsCaptured = 0;

const parser = new Parser();

parser.registerPostInterceptor(
  InterceptorStage.DEMO_PACKET,

  demoPacket => {
    const tick = finite(demoPacket?.tick);

    if (tick === null) {
      return;
    }

    const caseIndexes = needsByTick.get(tick);

    if (!caseIndexes) {
      return;
    }

    requestedTicksSeen++;

    const demo = parser.getDemo();

    const pawnEntities =
      demo.getEntitiesByClassName(
        'CCitadelPlayerPawn'
      ) ?? [];

    const soulEntities =
      demo.getEntitiesByClassName(
        'CCitadel_Pickup_AssignedGold'
      ) ?? [];

    const pawnByIndex = new Map();

    for (const entity of pawnEntities) {
      const entityIndex =
        getEntityIndex(entity);

      if (entityIndex !== null) {
        pawnByIndex.set(
          entityIndex,
          entity
        );
      }
    }

    const soulByIndex = new Map();

    for (const entity of soulEntities) {
      const entityIndex =
        getEntityIndex(entity);

      if (entityIndex !== null) {
        soulByIndex.set(
          entityIndex,
          entity
        );
      }
    }

    for (const caseIndex of caseIndexes) {
      const row = cases[caseIndex];

      const pawn =
        pawnByIndex.get(
          row.targetPawnEntityIndex
        ) ?? null;

      const soul =
        soulByIndex.get(
          row.assignedGoldEntityIndex
        ) ?? null;

      const targetPosition =
        pawn
          ? getWorldPositionDetailed(pawn)
          : null;

      const soulPosition =
        soul
          ? getWorldPositionDetailed(soul)
          : null;

      if (targetPosition) {
        playerPositionsCaptured++;
      }

      if (soulPosition) {
        soulPositionsCaptured++;
      }

      const rawTargetHandle =
        soul
          ? handleOrNull(
              safeGetField(
                soul,
                'm_hVacuumTarget'
              )
            )
          : null;

      const rawTargetPawnEntityIndex =
        decodeHandleEntityIndex(
          rawTargetHandle
        );

      const distanceXYValue =
        targetPosition && soulPosition
          ? distanceXY(
              targetPosition,
              soulPosition
            )
          : null;

      const distance3DValue =
        targetPosition &&
        soulPosition &&
        targetPosition.hasZ &&
        soulPosition.hasZ
          ? distance3D(
              targetPosition,
              soulPosition
            )
          : null;

      row.samples.push({
        tick,

        ticksBeforeOnset:
          row.onsetTick !== null
            ? tick - row.onsetTick
            : null,

        targetPosition,

        soulPosition,

        distance3D:
          distance3DValue,

        distanceXY:
          distanceXYValue,

        rawTargetHandle,

        rawTargetPawnEntityIndex,

        soulActive:
          soul
            ? booleanOrNull(
                safeGetField(
                  soul,
                  'm_bActive'
                )
              )
            : null,

        soulInteractive:
          soul
            ? booleanOrNull(
                safeGetField(
                  soul,
                  'm_bInteractive'
                )
              )
            : null
      });

      sampleRowsCaptured++;
    }
  }
);

console.log('');
console.log(
  'Rescanning raw replay across the pre-onset windows...'
);
console.log('');

await parser.parse(
  createReadStream(replayPath)
);

await parser.dispose();


// ============================================================
// CASE-LEVEL ANALYSIS
// ============================================================

for (const row of cases) {
  row.samples.sort(
    (a, b) => a.tick - b.tick
  );

  row.validXYSamples =
    row.samples.filter(
      sample =>
        Number.isFinite(
          sample.distanceXY
        )
    );

  row.valid3DSamples =
    row.samples.filter(
      sample =>
        Number.isFinite(
          sample.distance3D
        )
    );

  row.preOnsetSamples =
    row.samples.filter(
      sample =>
        row.onsetTick !== null &&
        sample.tick < row.onsetTick
    );

  row.preOnsetNonNullTargetSamples =
    row.preOnsetSamples.filter(
      sample =>
        sample.rawTargetPawnEntityIndex !== null
    );

  row.rawTargetNullThroughoutPreOnset =
    row.preOnsetNonNullTargetSamples.length === 0;

  row.onsetSample =
    row.samples.find(
      sample =>
        sample.tick === row.onsetTick
    ) ?? null;

  row.onsetExpectedTargetConfirmed =
    row.onsetSample
      ?.rawTargetPawnEntityIndex ===
    row.targetPawnEntityIndex;

  row.minimumPreOnsetXY =
    minFinite(
      row.preOnsetSamples.map(
        sample =>
          sample.distanceXY
      )
    );

  row.minimumPreOnset3D =
    minFinite(
      row.preOnsetSamples.map(
        sample =>
          sample.distance3D
      )
    );

  row.maximumPreOnsetXY =
    maxFinite(
      row.preOnsetSamples.map(
        sample =>
          sample.distanceXY
      )
    );

  row.maximumPreOnset3D =
    maxFinite(
      row.preOnsetSamples.map(
        sample =>
          sample.distance3D
      )
    );
}


const rawTransitionContractCases =
  cases.filter(
    row =>
      row.rawTargetNullThroughoutPreOnset &&
      row.onsetExpectedTargetConfirmed
  );


const primary =
  primaryCases.filter(
    row =>
      row.rawTargetNullThroughoutPreOnset &&
      row.onsetExpectedTargetConfirmed
  );


const primaryXY =
  primary.filter(
    row =>
      row.validXYSamples.length >= 2 &&
      Number.isFinite(
        row.onsetSample?.distanceXY
      )
  );


const primary3D =
  primary.filter(
    row =>
      row.valid3DSamples.length >= 2 &&
      Number.isFinite(
        row.onsetSample?.distance3D
      )
  );


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const thresholdRowsXY =
  buildThresholdSearch(
    primaryXY,
    'distanceXY'
  );


const thresholdRows3D =
  buildThresholdSearch(
    primary3D,
    'distance3D'
  );


const bestXY =
  selectBestThreshold(
    thresholdRowsXY
  );


const best3D =
  selectBestThreshold(
    thresholdRows3D
  );


const standardXY =
  STANDARD_THRESHOLDS
    .map(
      threshold =>
        thresholdRowsXY.find(
          row =>
            row.thresholdHU ===
            threshold
        )
    )
    .filter(Boolean);


const standard3D =
  STANDARD_THRESHOLDS
    .map(
      threshold =>
        thresholdRows3D.find(
          row =>
            row.thresholdHU ===
            threshold
        )
    )
    .filter(Boolean);


// ============================================================
// OUTLIERS
// ============================================================

const onsetOver735XY =
  cases.filter(
    row =>
      Number.isFinite(
        row.onsetSample?.distanceXY
      )
      &&
      row.onsetSample.distanceXY >
      OUTLIER_TRACE_THRESHOLD_XY
  );


const onsetOver7353D =
  cases.filter(
    row =>
      Number.isFinite(
        row.onsetSample?.distance3D
      )
      &&
      row.onsetSample.distance3D >
      OUTLIER_TRACE_THRESHOLD_XY
  );


const outlierSummaries =
  onsetOver735XY.map(
    row =>
      buildOutlierSummary(row)
  );


// ============================================================
// DISTRIBUTIONS
// ============================================================

const primaryOnsetXY =
  primaryXY
    .map(
      row =>
        row.onsetSample.distanceXY
    )
    .filter(Number.isFinite);


const primaryOnset3D =
  primary3D
    .map(
      row =>
        row.onsetSample.distance3D
    )
    .filter(Number.isFinite);


const minimumPreOnsetXYValues =
  primaryXY
    .map(
      row =>
        row.minimumPreOnsetXY
    )
    .filter(Number.isFinite);


const minimumPreOnset3DValues =
  primary3D
    .map(
      row =>
        row.minimumPreOnset3D
    )
    .filter(Number.isFinite);


// ============================================================
// VALIDATION
// ============================================================

const validationChecks = {
  script77Passed:
    check(
      script77Summary?.validation?.pass,
      true,
      script77Summary?.validation?.pass ===
      true
    ),

  caseCount:
    check(
      cases.length,
      replayName === 'test'
        ? 458
        : '>0',
      replayName === 'test'
        ? cases.length === 458
        : cases.length > 0
    ),

  primaryStableDelayedObserved:
    check(
      primaryCases.length,
      '>0',
      primaryCases.length > 0
    ),

  requestedTicksObserved:
    check(
      requestedTicksSeen,
      needsByTick.size,
      requestedTicksSeen ===
      needsByTick.size
    ),

  allCasesHaveOnsetSample:
    check(
      cases.filter(
        row =>
          row.onsetSample
      ).length,
      cases.length,
      cases.every(
        row =>
          Boolean(row.onsetSample)
      )
    ),

  rawTargetNullThroughoutPreOnset:
    check(
      cases.filter(
        row =>
          row.rawTargetNullThroughoutPreOnset
      ).length,
      cases.length,
      rate(
        cases.filter(
          row =>
            row.rawTargetNullThroughoutPreOnset
        ).length,
        cases.length
      ) >=
      0.99
    ),

  onsetExpectedTargetConfirmed:
    check(
      cases.filter(
        row =>
          row.onsetExpectedTargetConfirmed
      ).length,
      cases.length,
      rate(
        cases.filter(
          row =>
            row.onsetExpectedTargetConfirmed
        ).length,
        cases.length
      ) >=
      0.99
    ),

  primaryXYCoverage:
    check(
      primaryXY.length,
      `>=99% of ${primary.length}`,
      rate(
        primaryXY.length,
        primary.length
      ) >=
      0.99
    ),

  primary3DCoverage:
    check(
      primary3D.length,
      `>=95% of ${primary.length}`,
      rate(
        primary3D.length,
        primary.length
      ) >=
      0.95
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
    'ASSIGNED_GOLD_VACUUM_PREONSET_THRESHOLD_TRACE_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'RAW_PREONSET_THRESHOLD_TRACE_READY'
      : 'PIPELINE_VALIDATION_FAILURE',

  purpose: [
    'Trace raw target-player and AssignedGold geometry across the two seconds preceding clean delayed m_hVacuumTarget assignment.',
    'Test whether m_hVacuumTarget assignment occurs immediately after a candidate distance crossing or substantially after the target player is already inside the candidate envelope.',
    'Separate XY and strict 3D threshold behavior.',
    'Diagnose the remaining >735 HU XY onset cases directly.'
  ],

  semanticLimits: {
    targetField:
      'm_hVacuumTarget remains downstream observational telemetry and is not assumed to be the exact engine trigger.',

    searchWindow:
      'The trace covers at most the final two seconds before target assignment. A player may have crossed a candidate threshold earlier than this window.',

    threshold:
      'A threshold with short crossing-to-target lag is a stronger candidate than onset containment alone, but still requires replication.'
  },

  sourceCounts: {
    allCleanDelayedCases:
      cases.length,

    primaryStableDelayedCases:
      primaryCases.length,

    rawTransitionContractCases:
      rawTransitionContractCases.length,

    primaryContractCases:
      primary.length,

    primaryXYComparable:
      primaryXY.length,

    primary3DComparable:
      primary3D.length,

    requestedTickKeys:
      needsByTick.size,

    requestedTicksSeen,

    sampleRowsCaptured,

    playerPositionsCaptured,

    soulPositionsCaptured
  },

  primaryOnsetDistance: {
    xy:
      summarizeNumbers(
        primaryOnsetXY
      ),

    strict3D:
      summarizeNumbers(
        primaryOnset3D
      )
  },

  primaryMinimumPreOnsetDistance: {
    xy:
      summarizeNumbers(
        minimumPreOnsetXYValues
      ),

    strict3D:
      summarizeNumbers(
        minimumPreOnset3DValues
      )
  },

  thresholdSearch: {
    searchMinHU:
      SEARCH_MIN_HU,

    searchMaxHU:
      SEARCH_MAX_HU,

    stepHU:
      SEARCH_STEP_HU,

    primaryMinimumDelaySeconds:
      PRIMARY_MIN_DELAY_SECONDS,

    preOnsetWindowSeconds:
      WINDOW_SECONDS,

    xy: {
      best:
        bestXY,

      standard:
        standardXY,

      all:
        thresholdRowsXY
    },

    strict3D: {
      best:
        best3D,

      standard:
        standard3D,

      all:
        thresholdRows3D
    }
  },

  outliers: {
    onsetOver735XYCount:
      onsetOver735XY.length,

    onsetOver7353DCount:
      onsetOver7353D.length,

    onsetOver735XY:
      outlierSummaries
  },

  interpretationGuide: {
    fieldLag:
      'If a candidate threshold is crossed on many episodes and m_hVacuumTarget appears within only a few replay observations afterward, the field is a close proxy for the range trigger.',

    downstreamField:
      'If targets spend substantial time inside a candidate threshold before m_hVacuumTarget appears, the field is downstream of the true trigger and should not define the radius.',

    xyVs3D:
      'A substantially cleaner XY result would support a primarily planar proximity rule or show that vertical entity-origin separation is not relevant to eligibility.',

    outlier:
      'The >735 HU XY cases are retained explicitly because a single reliable onset above a proposed hard radius prevents promotion of that radius without another explanation.'
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

    cases:
      outputCasesPath
  }
};


mkdirSync(
  dirname(outputSummaryPath),
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
  cases.map(
    row =>
      compactCase(row)
  )
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'ASSIGNED GOLD PRE-ONSET THRESHOLD TRACE V0.1'
);
console.log(
  '========================================================'
);

console.log('');
console.log('COHORT');
console.log('------');

console.log(
  `All clean delayed:        ${cases.length}`
);

console.log(
  `Stable delayed >=1.0s:    ${primaryCases.length}`
);

console.log(
  `Primary contract cases:   ${primary.length}`
);

console.log(
  `Primary XY comparable:    ${primaryXY.length}`
);

console.log(
  `Primary 3D comparable:    ${primary3D.length}`
);


console.log('');
console.log(
  'PRIMARY ONSET DISTANCE'
);
console.log(
  '----------------------'
);

console.log(
  `XY: ${formatDistribution(
    summarizeNumbers(primaryOnsetXY)
  )}`
);

console.log(
  `3D: ${formatDistribution(
    summarizeNumbers(primaryOnset3D)
  )}`
);


console.log('');
console.log(
  'BEST PRE-ONSET CROSSING FIT'
);
console.log(
  '---------------------------'
);

console.log(
  `XY:  ${formatThresholdRow(bestXY)}`
);

console.log(
  `3D:  ${formatThresholdRow(best3D)}`
);


console.log('');
console.log(
  'STANDARD THRESHOLDS — XY'
);
console.log(
  '------------------------'
);

printThresholdRows(
  standardXY
);


console.log('');
console.log(
  'STANDARD THRESHOLDS — 3D'
);
console.log(
  '------------------------'
);

printThresholdRows(
  standard3D
);


console.log('');
console.log(
  'XY ONSET >735 HU'
);
console.log(
  '----------------'
);

if (
  outlierSummaries.length === 0
) {
  console.log('None.');
} else {
  for (const row of outlierSummaries) {
    console.log(
      `${String(row.deathIndex).padStart(4)}  ` +
      `${String(row.clock ?? '').padEnd(6)} ` +
      `delay=${formatNumber(row.targetDelaySeconds).padStart(7)}s ` +
      `onsetXY=${formatNumber(row.onsetXY).padStart(9)} ` +
      `minPreXY=${formatNumber(row.minimumPreOnsetXY).padStart(9)} ` +
      `last735EntryLag=${formatNumber(row.last735EntryLagSeconds).padStart(7)}s ` +
      `credit=${String(row.creditedPlayerName ?? 'NONE').padEnd(20)} ` +
      `target=${row.targetPlayerName ?? 'NONE'}`
    );
  }
}


console.log('');
console.log('VALIDATION');
console.log('----------');

for (
  const [name, row]
  of Object.entries(
    validationChecks
  )
) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ` +
    `${name.padEnd(40)} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');
console.log(
  `OVERALL PIPELINE: ${
    validationPass
      ? 'PASS'
      : 'FAIL'
  }`
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
// THRESHOLD SEARCH
// ============================================================

function buildThresholdSearch(
  source,
  field
) {
  const rows = [];

  for (
    let thresholdHU = SEARCH_MIN_HU;
    thresholdHU <= SEARCH_MAX_HU;
    thresholdHU += SEARCH_STEP_HU
  ) {
    let onsetInside = 0;
    let onsetOutside = 0;
    let hadEntry = 0;
    let noEntryButInsideAtWindowStart = 0;
    let noEntryAndOutsideAtOnset = 0;

    let entryWithin1Tick = 0;
    let entryWithin2Ticks = 0;
    let entryWithin4Ticks = 0;
    let entryWithin8Ticks = 0;
    let entryWithin16Ticks = 0;

    const entryLagTicks = [];

    for (const row of source) {
      const samples =
        row.samples
          .filter(
            sample =>
              Number.isFinite(
                sample?.[field]
              )
          )
          .sort(
            (a, b) =>
              a.tick - b.tick
          );

      if (samples.length < 2) {
        continue;
      }

      const onset =
        samples.find(
          sample =>
            sample.tick ===
            row.onsetTick
        );

      if (!onset) {
        continue;
      }

      if (
        onset[field] <=
        thresholdHU
      ) {
        onsetInside++;
      } else {
        onsetOutside++;
      }

      let lastEntryTick = null;

      for (
        let i = 1;
        i < samples.length;
        i++
      ) {
        const previous =
          samples[i - 1];

        const current =
          samples[i];

        if (
          current.tick >
          row.onsetTick
        ) {
          break;
        }

        if (
          previous[field] >
            thresholdHU
          &&
          current[field] <=
            thresholdHU
        ) {
          lastEntryTick =
            current.tick;
        }
      }

      if (
        lastEntryTick !== null
      ) {
        hadEntry++;

        const lagTicks =
          row.onsetTick -
          lastEntryTick;

        entryLagTicks.push(
          lagTicks
        );

        if (lagTicks <= 1) {
          entryWithin1Tick++;
        }

        if (lagTicks <= 2) {
          entryWithin2Ticks++;
        }

        if (lagTicks <= 4) {
          entryWithin4Ticks++;
        }

        if (lagTicks <= 8) {
          entryWithin8Ticks++;
        }

        if (lagTicks <= 16) {
          entryWithin16Ticks++;
        }
      } else if (
        samples[0][field] <=
          thresholdHU
        &&
        onset[field] <=
          thresholdHU
      ) {
        noEntryButInsideAtWindowStart++;
      } else if (
        onset[field] >
        thresholdHU
      ) {
        noEntryAndOutsideAtOnset++;
      }
    }

    rows.push({
      thresholdHU,

      thresholdMeters:
        thresholdHU /
        HU_PER_METER,

      total:
        source.length,

      onsetInside,

      onsetOutside,

      onsetContainmentRate:
        rate(
          onsetInside,
          source.length
        ),

      hadEntry,

      hadEntryRate:
        rate(
          hadEntry,
          source.length
        ),

      noEntryButInsideAtWindowStart,

      noEntryAndOutsideAtOnset,

      entryWithin1Tick,

      entryWithin2Ticks,

      entryWithin4Ticks,

      entryWithin8Ticks,

      entryWithin16Ticks,

      entryWithin4TickRateAmongAll:
        rate(
          entryWithin4Ticks,
          source.length
        ),

      entryWithin4TickRateAmongEntries:
        rate(
          entryWithin4Ticks,
          hadEntry
        ),

      entryLagTicks:
        summarizeNumbers(
          entryLagTicks
        ),

      entryLagSeconds:
        summarizeNumbers(
          entryLagTicks.map(
            value =>
              value /
              TICK_RATE
          )
        )
    });
  }

  return rows;
}


function selectBestThreshold(rows) {
  return (
    rows
      .slice()
      .sort(
        (a, b) =>
          b.entryWithin4Ticks -
            a.entryWithin4Ticks
          ||
          a.onsetOutside -
            b.onsetOutside
          ||
          b.hadEntry -
            a.hadEntry
          ||
          a.thresholdHU -
            b.thresholdHU
      )[0]
    ??
    null
  );
}


// ============================================================
// OUTLIER SUMMARY
// ============================================================

function buildOutlierSummary(row) {
  const thresholdHU =
    OUTLIER_TRACE_THRESHOLD_XY;

  const valid =
    row.samples
      .filter(
        sample =>
          Number.isFinite(
            sample.distanceXY
          )
      )
      .sort(
        (a, b) =>
          a.tick - b.tick
      );

  let lastEntryTick = null;
  let lastExitTick = null;

  for (
    let i = 1;
    i < valid.length;
    i++
  ) {
    const previous =
      valid[i - 1];

    const current =
      valid[i];

    if (
      current.tick >
      row.onsetTick
    ) {
      break;
    }

    if (
      previous.distanceXY >
        thresholdHU
      &&
      current.distanceXY <=
        thresholdHU
    ) {
      lastEntryTick =
        current.tick;
    }

    if (
      previous.distanceXY <=
        thresholdHU
      &&
      current.distanceXY >
        thresholdHU
    ) {
      lastExitTick =
        current.tick;
    }
  }

  const tail =
    valid
      .filter(
        sample =>
          sample.tick >=
          row.onsetTick -
          TRACE_TAIL_TICKS
      )
      .map(
        sample => ({
          tick:
            sample.tick,

          ticksBeforeOnset:
            sample.tick -
            row.onsetTick,

          distanceXY:
            sample.distanceXY,

          distance3D:
            sample.distance3D,

          rawTargetPawnEntityIndex:
            sample.rawTargetPawnEntityIndex,

          soulActive:
            sample.soulActive
        })
      );

  return {
    deathIndex:
      row.deathIndex,

    clock:
      row.clock,

    baseType:
      row.baseType,

    creditedPlayerName:
      row.creditedPlayerName,

    targetPlayerName:
      row.targetPlayerName,

    targetDelaySeconds:
      row.targetDelaySeconds,

    onsetXY:
      row.onsetSample
        ?.distanceXY ??
      null,

    onset3D:
      row.onsetSample
        ?.distance3D ??
      null,

    minimumPreOnsetXY:
      row.minimumPreOnsetXY,

    maximumPreOnsetXY:
      row.maximumPreOnsetXY,

    last735EntryTick:
      lastEntryTick,

    last735EntryLagSeconds:
      lastEntryTick !== null
        ? (
            row.onsetTick -
            lastEntryTick
          ) /
          TICK_RATE
        : null,

    last735ExitTick:
      lastExitTick,

    last735ExitLagSeconds:
      lastExitTick !== null
        ? (
            row.onsetTick -
            lastExitTick
          ) /
          TICK_RATE
        : null,

    rawTargetNullThroughoutPreOnset:
      row.rawTargetNullThroughoutPreOnset,

    tail
  };
}


function compactCase(row) {
  const outlier =
    Number.isFinite(
      row.onsetSample?.distanceXY
    )
    &&
    row.onsetSample.distanceXY >
    OUTLIER_TRACE_THRESHOLD_XY;

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

    creditedPlayerName:
      row.creditedPlayerName,

    creditedPlayerTeam:
      row.creditedPlayerTeam,

    targetPlayerName:
      row.targetPlayerName,

    targetPlayerTeam:
      row.targetPlayerTeam,

    targetPawnEntityIndex:
      row.targetPawnEntityIndex,

    assignedGoldEntityIndex:
      row.assignedGoldEntityIndex,

    activationTick:
      row.activationTick,

    onsetTick:
      row.onsetTick,

    targetDelaySeconds:
      row.targetDelaySeconds,

    requestedStartTick:
      row.requestedStartTick,

    sampleCount:
      row.samples.length,

    rawTargetNullThroughoutPreOnset:
      row.rawTargetNullThroughoutPreOnset,

    onsetExpectedTargetConfirmed:
      row.onsetExpectedTargetConfirmed,

    onsetDistanceXY:
      row.onsetSample
        ?.distanceXY ??
      null,

    onsetDistance3D:
      row.onsetSample
        ?.distance3D ??
      null,

    minimumPreOnsetXY:
      row.minimumPreOnsetXY,

    minimumPreOnset3D:
      row.minimumPreOnset3D,

    maximumPreOnsetXY:
      row.maximumPreOnsetXY,

    maximumPreOnset3D:
      row.maximumPreOnset3D,

    outlierOver735XY:
      outlier,

    outlierTrace:
      outlier
        ? buildOutlierSummary(
            row
          ).tail
        : null
  };
}


// ============================================================
// RAW POSITION
// ============================================================

function getWorldPositionDetailed(entity) {
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
    cellX === null ||
    cellY === null ||
    vecX === null ||
    vecY === null
  ) {
    return null;
  }

  const hasZ =
    cellZ !== null &&
    vecZ !== null;

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
      hasZ
        ? cellZ *
          512 -
          16384 +
          vecZ
        : null,

    hasZ
  };
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


function getEntityIndex(entity) {
  const direct =
    finite(
      entity?.index ??
      entity?.entityIndex
    );

  if (direct !== null) {
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


function handleOrNull(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  try {
    const parsed =
      BigInt(value);

    if (
      parsed <= 0n ||
      parsed === 16777215n
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}


function decodeHandleEntityIndex(handle) {
  if (
    handle === null ||
    handle === undefined
  ) {
    return null;
  }

  try {
    const parsed =
      BigInt(handle);

    if (
      parsed <= 0n ||
      parsed === 16777215n
    ) {
      return null;
    }

    return Number(
      parsed &
      BigInt(
        ENTITY_INDEX_MASK
      )
    );
  } catch {
    return null;
  }
}


function booleanOrNull(value) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  if (
    value === 1 ||
    value === '1'
  ) {
    return true;
  }

  if (
    value === 0 ||
    value === '0'
  ) {
    return false;
  }

  return null;
}


function distance3D(a, b) {
  const dx =
    a.x - b.x;

  const dy =
    a.y - b.y;

  const dz =
    a.z - b.z;

  return Math.sqrt(
    dx * dx +
    dy * dy +
    dz * dz
  );
}


function distanceXY(a, b) {
  const dx =
    a.x - b.x;

  const dy =
    a.y - b.y;

  return Math.sqrt(
    dx * dx +
    dy * dy
  );
}


// ============================================================
// FILE HELPERS
// ============================================================

async function loadJsonl(path) {
  const rows = [];

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
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(
        JSON.parse(line)
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

  for (const row of rows) {
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
// GENERIC HELPERS
// ============================================================

function finite(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function rate(
  numerator,
  denominator
) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator /
    denominator;
}


function minFinite(values) {
  const clean =
    values.filter(
      Number.isFinite
    );

  return clean.length > 0
    ? Math.min(...clean)
    : null;
}


function maxFinite(values) {
  const clean =
    values.filter(
      Number.isFinite
    );

  return clean.length > 0
    ? Math.max(...clean)
    : null;
}


function summarizeNumbers(source) {
  const clean =
    source
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (clean.length === 0) {
    return {
      count: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      p95: null,
      p99: null,
      max: null,
      mean: null
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
        (sum, value) =>
          sum + value,
        0
      ) /
      clean.length
  };
}


function quantile(
  sorted,
  q
) {
  if (
    !Array.isArray(sorted) ||
    sorted.length === 0
  ) {
    return null;
  }

  if (sorted.length === 1) {
    return sorted[0];
  }

  const position =
    (
      sorted.length -
      1
    ) *
    q;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    position - lower;

  return (
    sorted[lower] *
      (1 - weight)
    +
    sorted[upper] *
      weight
  );
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
      Boolean(pass)
  };
}


// ============================================================
// FORMAT
// ============================================================

function formatPercent(value) {
  return Number.isFinite(value)
    ? `${(
        value *
        100
      ).toFixed(2)}%`
    : 'n/a';
}


function formatNumber(value) {
  return Number.isFinite(value)
    ? Number(
        value.toFixed(3)
      ).toString()
    : 'n/a';
}


function formatDistribution(row) {
  if (
    !row ||
    row.count === 0
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


function formatThresholdRow(row) {
  if (!row) {
    return 'n/a';
  }

  return (
    `${row.thresholdHU} HU ` +
    `(${row.thresholdMeters.toFixed(2)}m) ` +
    `onsetInside=${row.onsetInside}/${row.total} ` +
    `hadEntry=${row.hadEntry}/${row.total} ` +
    `entry<=4ticks=${row.entryWithin4Ticks}/${row.total} ` +
    `entryLagMedian=${formatNumber(
      row.entryLagSeconds?.median
    )}s`
  );
}


function printThresholdRows(rows) {
  for (const row of rows) {
    console.log(
      `${String(row.thresholdHU).padStart(4)} HU ` +
      `(${row.thresholdMeters.toFixed(2)}m) ` +
      `inside=${String(row.onsetInside).padStart(4)}/${row.total} ` +
      `entry=${String(row.hadEntry).padStart(4)} ` +
      `<=1t=${String(row.entryWithin1Tick).padStart(3)} ` +
      `<=2t=${String(row.entryWithin2Ticks).padStart(3)} ` +
      `<=4t=${String(row.entryWithin4Ticks).padStart(3)} ` +
      `<=8t=${String(row.entryWithin8Ticks).padStart(3)} ` +
      `medianLag=${formatNumber(
        row.entryLagSeconds?.median
      )}s`
    );
  }
}