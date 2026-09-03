import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import { resolve } from 'node:path';

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


const OUTLIER_XY_HU =
  735;


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const summary78Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_preonset_threshold_trace_v01.json'
  );


const cases78Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_preonset_threshold_cases_v01.jsonl'
  );


const cases77Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_exact_geometry_cases_v01.jsonl'
  );


const activationStreamPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_activation_stream_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_early_vacuum_outlier_diagnostic_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_early_vacuum_outlier_cases_v01.jsonl'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    summary78Path,
    cases78Path,
    cases77Path,
    activationStreamPath
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
// LOAD
// ============================================================

const summary78 =
  JSON.parse(
    readFileSync(
      summary78Path,
      'utf8'
    )
  );


const cases78 =
  await loadJsonl(
    cases78Path
  );


const cases77 =
  await loadJsonl(
    cases77Path
  );


const activationRows =
  await loadJsonl(
    activationStreamPath
  );


console.log('');

console.log(
  `Script 78 cases: ${cases78.length}`
);


console.log(
  `Script 77 cases: ${cases77.length}`
);


console.log(
  `Activation rows: ${activationRows.length}`
);


// ============================================================
// CLOSE SCRIPT 78 REQUESTED-TICK VALIDATION
//
// Script 78 incremented requestedTicksSeen for every DEMO_PACKET
// hit.
//
// If multiple DEMO_PACKET records share one replay tick, that
// raw counter can exceed the number of UNIQUE requested ticks.
//
// Here we reconstruct the exact requested tick set and compare
// it to a Set of unique replay ticks actually observed.
// ============================================================

const requestedTickSet =
  new Set();


for (
  const row
  of cases78
) {

  const startTick =
    finite(
      row?.requestedStartTick
    );


  const onsetTick =
    finite(
      row?.onsetTick
    );


  if (
    startTick ===
      null
    ||
    onsetTick ===
      null
  ) {

    continue;
  }


  for (
    let tick =
      startTick;

    tick <=
      onsetTick;

    tick++
  ) {

    requestedTickSet.add(
      tick
    );
  }
}


let requestedPacketHits =
  0;


const uniqueRequestedTicksSeen =
  new Set();


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
      ||
      !requestedTickSet.has(
        tick
      )
    ) {

      return;
    }


    requestedPacketHits++;


    uniqueRequestedTicksSeen.add(
      tick
    );
  }
);


console.log('');

console.log(
  'Auditing Script 78 requested tick coverage...'
);

console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


const duplicateRequestedPacketHits =
  requestedPacketHits -
  uniqueRequestedTicksSeen.size;


const missingRequestedTicks =
  [
    ...requestedTickSet
  ]
    .filter(
      tick =>
        !uniqueRequestedTicksSeen.has(
          tick
        )
    );


const failed78Checks =
  Object
    .entries(
      summary78
        ?.validation
        ?.checks ??
      {}
    )
    .filter(
      ([
        name,
        row
      ]) =>
        row?.pass !==
        true
    )
    .map(
      ([
        name
      ]) =>
        name
    );


const requestedTickFailureClosed =
  failed78Checks.length ===
    1
  &&
  failed78Checks[0] ===
    'requestedTicksObserved'
  &&
  uniqueRequestedTicksSeen.size ===
    requestedTickSet.size
  &&
  missingRequestedTicks.length ===
    0
  &&
  requestedPacketHits >=
    uniqueRequestedTicksSeen.size;


// ============================================================
// JOIN SCRIPT 77 EXACT GEOMETRY
// ============================================================

const case77ByDeathIndex =
  new Map();


for (
  const row
  of cases77
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    case77ByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// JOIN SCRIPT 55 ACTIVATION BY MATCHED DEATH
// ============================================================

const activationByDeathIndex =
  new Map();


for (
  const row
  of activationRows
) {

  const deathIndex =
    finite(
      row
        ?.oneToOne
        ?.matchedDeathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    activationByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// DELAY BUCKETS
//
// Goal:
//
// Is >735 HU behavior confined to very early lifecycle cases?
// ============================================================

const delayBuckets =
  [

    {

      name:
        'GT_0_25_TO_0_50',

      test:
        value =>
          value >
            0.25
          &&
          value <=
            0.50
    },


    {

      name:
        'GT_0_50_TO_LT_1_00',

      test:
        value =>
          value >
            0.50
          &&
          value <
            1.00
    },


    {

      name:
        'GE_1_00',

      test:
        value =>
          value >=
          1.00
    }
  ];


const bucketSummaries =
  {};


for (
  const bucket
  of delayBuckets
) {

  const rows =
    cases78.filter(
      row => {

        const delay =
          finite(
            row?.targetDelaySeconds
          );


        return (
          delay !==
            null
          &&
          bucket.test(
            delay
          )
        );
      }
    );


  const onsetXY =
    values(
      rows,
      row =>
        row?.onsetDistanceXY
    );


  bucketSummaries[
    bucket.name
  ] =
    {

      count:
        rows.length,

      targetDelaySeconds:
        summarizeNumbers(
          values(
            rows,
            row =>
              row?.targetDelaySeconds
          )
        ),

      onsetXY:
        summarizeNumbers(
          onsetXY
        ),

      over729:
        onsetXY.filter(
          value =>
            value >
            729
        ).length,

      over732:
        onsetXY.filter(
          value =>
            value >
            732
        ).length,

      over735:
        onsetXY.filter(
          value =>
            value >
            735
        ).length,

      over740:
        onsetXY.filter(
          value =>
            value >
            740
        ).length,

      over750:
        onsetXY.filter(
          value =>
            value >
            750
        ).length,

      over775:
        onsetXY.filter(
          value =>
            value >
            775
        ).length,

      over800:
        onsetXY.filter(
          value =>
            value >
            800
        ).length
    };
}


// ============================================================
// >735 XY OUTLIERS
// ============================================================

const outlierRows =
  cases78
    .filter(
      row =>
        Number.isFinite(
          finite(
            row?.onsetDistanceXY
          )
        )
        &&
        finite(
          row?.onsetDistanceXY
        ) >
        OUTLIER_XY_HU
    )
    .map(
      row => {

        const deathIndex =
          finite(
            row?.deathIndex
          );


        const exact =
          case77ByDeathIndex.get(
            deathIndex
          )
          ??
          null;


        const activation =
          activationByDeathIndex.get(
            deathIndex
          )
          ??
          null;


        const activationPosition =
          normalizePosition(
            activation
              ?.state
              ?.position
          );


        const onsetSoulPosition =
          normalizePosition(
            exact
              ?.rawOnsetSoulPosition
          );


        const activationToOnsetSoulXY =
          activationPosition
          &&
          onsetSoulPosition
            ? distanceXY(
              activationPosition,
              onsetSoulPosition
            )
            : null;


        const activationToOnsetSoul3D =
          activationPosition
          &&
          onsetSoulPosition
            ? distance3D(
              activationPosition,
              onsetSoulPosition
            )
            : null;


        return {

          deathIndex,

          clock:
            row?.clock ??
            null,

          baseType:
            row?.baseType ??
            null,

          creditedPlayerName:
            row?.creditedPlayerName ??
            null,

          targetPlayerName:
            row?.targetPlayerName ??
            null,

          targetDelaySeconds:
            finite(
              row?.targetDelaySeconds
            ),

          onsetDistanceXY:
            finite(
              row?.onsetDistanceXY
            ),

          onsetDistance3D:
            finite(
              row?.onsetDistance3D
            ),

          minimumPreOnsetXY:
            finite(
              row?.minimumPreOnsetXY
            ),

          maximumPreOnsetXY:
            finite(
              row?.maximumPreOnsetXY
            ),

          rawPriorDistanceXY:
            finite(
              exact?.rawPriorDistanceXY
            ),

          rawOnsetDistanceXY:
            finite(
              exact?.rawOnsetDistanceXY
            ),

          rawPriorDistance3D:
            finite(
              exact?.rawPriorDistance3D
            ),

          rawOnsetDistance3D:
            finite(
              exact?.rawOnsetDistance3D
            ),

          rawMovementDirectionXY:
            exact
              ?.rawMovementDirectionXY ??
            null,

          rawMovementDirection3D:
            exact
              ?.rawMovementDirection3D ??
            null,

          activationIndex:
            finite(
              activation?.activationIndex
            ),

          activationId:
            activation?.activationId ??
            null,

          activationTick:
            finite(
              activation
                ?.timing
                ?.activationTick
            ),

          activationStartSignals:
            activation
              ?.lifecycle
              ?.startSignals ??
            [],

          activationState:
            activation?.state ??
            null,

          activationEndReason:
            activation
              ?.lifecycle
              ?.endReason ??
            null,

          activationDurationSeconds:
            finite(
              activation
                ?.timing
                ?.durationSeconds
            ),

          firstInteractiveTick:
            finite(
              activation
                ?.lifecycle
                ?.firstInteractiveTick
            ),

          firstValidVacuumTarget:
            activation
              ?.lifecycle
              ?.firstValidVacuumTarget ??
            null,

          vacuumTargetTransitions:
            activation
              ?.lifecycle
              ?.vacuumTargetTransitions ??
            [],

          activationToOnsetSoulXY,

          activationToOnsetSoul3D,

          outlierTrace:
            row?.outlierTrace ??
            null
        };
      }
    );


// ============================================================
// START-SIGNAL COMPARISON
// ============================================================

const allStartSignalCounts =
  countSignals(

    cases78.map(
      row => {

        const deathIndex =
          finite(
            row?.deathIndex
          );


        const activation =
          activationByDeathIndex.get(
            deathIndex
          );


        return activation
          ?.lifecycle
          ?.startSignals ??
          [];
      }
    )
  );


const stableStartSignalCounts =
  countSignals(

    cases78
      .filter(
        row =>
          finite(
            row?.targetDelaySeconds
          ) >=
          1.0
      )
      .map(
        row => {

          const deathIndex =
            finite(
              row?.deathIndex
            );


          const activation =
            activationByDeathIndex.get(
              deathIndex
            );


          return activation
            ?.lifecycle
            ?.startSignals ??
            [];
        }
      )
  );


const shortStartSignalCounts =
  countSignals(

    cases78
      .filter(
        row => {

          const delay =
            finite(
              row?.targetDelaySeconds
            );


          return (
            delay !==
              null
            &&
            delay <
              1.0
          );
        }
      )
      .map(
        row => {

          const deathIndex =
            finite(
              row?.deathIndex
            );


          const activation =
            activationByDeathIndex.get(
              deathIndex
            );


          return activation
            ?.lifecycle
            ?.startSignals ??
            [];
        }
      )
  );


// ============================================================
// STABLE DELAYED ENVELOPE
// ============================================================

const stableRows =
  cases78.filter(
    row =>
      finite(
        row?.targetDelaySeconds
      ) >=
      1.0
  );


const stableOnsetXY =
  values(
    stableRows,
    row =>
      row?.onsetDistanceXY
  );


const stableMaxXY =
  stableOnsetXY.length >
    0
    ? Math.max(
      ...stableOnsetXY
    )
    : null;


const smallestWholeHUContainingStable =
  Number.isFinite(
    stableMaxXY
  )
    ? Math.ceil(
      stableMaxXY
    )
    : null;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script78FailureOnlyRequestedTickCounter:
      check(

        failed78Checks,

        [
          'requestedTicksObserved'
        ],

        failed78Checks.length ===
          1
        &&
        failed78Checks[0] ===
          'requestedTicksObserved'
      ),


    requestedUniqueTickCoverage:
      check(

        uniqueRequestedTicksSeen.size,

        requestedTickSet.size,

        uniqueRequestedTicksSeen.size ===
        requestedTickSet.size
      ),


    noRequestedTicksMissing:
      check(

        missingRequestedTicks.length,

        0,

        missingRequestedTicks.length ===
        0
      ),


    duplicatePacketHitsExplainOvercount:
      check(

        duplicateRequestedPacketHits,

        '>=0',

        duplicateRequestedPacketHits >=
          0
        &&
        requestedTickFailureClosed
      ),


    caseCount:
      check(

        cases78.length,

        replayName ===
          'test'
          ? 458
          : '>0',

        replayName ===
          'test'
          ? cases78.length ===
            458
          : cases78.length >
            0
      ),


    exactGeometryJoin:
      check(

        cases78.filter(
          row =>
            case77ByDeathIndex.has(
              finite(
                row?.deathIndex
              )
            )
        ).length,

        cases78.length,

        cases78.every(
          row =>
            case77ByDeathIndex.has(
              finite(
                row?.deathIndex
              )
            )
        )
      ),


    activationJoin:
      check(

        cases78.filter(
          row =>
            activationByDeathIndex.has(
              finite(
                row?.deathIndex
              )
            )
        ).length,

        cases78.length,

        cases78.every(
          row =>
            activationByDeathIndex.has(
              finite(
                row?.deathIndex
              )
            )
        )
      ),


    stableDelayedObserved:
      check(

        stableRows.length,

        replayName ===
          'test'
          ? 131
          : '>0',

        replayName ===
          'test'
          ? stableRows.length ===
            131
          : stableRows.length >
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
      'ASSIGNED_GOLD_EARLY_VACUUM_OUTLIER_DIAGNOSTIC_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'SCRIPT78_PACKET_COUNTER_CLOSED_EARLY_OUTLIERS_ISOLATED'
        : 'DIAGNOSTIC_VALIDATION_FAILURE',


    script78Closure:
      {

        originalValidationPass:
          summary78
            ?.validation
            ?.pass ??
          null,

        failedChecks:
          failed78Checks,

        requestedUniqueTickKeys:
          requestedTickSet.size,

        rawRequestedPacketHits:
          requestedPacketHits,

        uniqueRequestedTicksSeen:
          uniqueRequestedTicksSeen.size,

        duplicateRequestedPacketHits,

        missingRequestedTicks,

        closed:
          requestedTickFailureClosed,

        explanation:
          'Script 78 counted DEMO_PACKET hits rather than unique requested replay ticks. Duplicate DEMO_PACKET records sharing requested ticks can make the raw hit count exceed the unique requested-tick key count.'
      },


    delayBuckets:
      bucketSummaries,


    stableDelayedEnvelope:
      {

        minimumDelaySeconds:
          1.0,

        count:
          stableRows.length,

        onsetXY:
          summarizeNumbers(
            stableOnsetXY
          ),

        maximumXYHU:
          stableMaxXY,

        maximumXYMeters:
          Number.isFinite(
            stableMaxXY
          )
            ? stableMaxXY /
              HU_PER_METER
            : null,

        smallestWholeHUContainingAllStableDelayedOnsets:
          smallestWholeHUContainingStable,

        interpretation:
          'Empirical center-to-center XY envelope for stable delayed target assignment in one replay, not an engine radius.'
      },


    onsetOver735XY:
      {

        count:
          outlierRows.length,

        cases:
          outlierRows
      },


    activationStartSignals:
      {

        allDelayedCases:
          allStartSignalCounts,

        shortDelayUnder1Second:
          shortStartSignalCounts,

        stableDelayAtLeast1Second:
          stableStartSignalCounts
      },


    interpretation:
      {

        currentCandidate:
          'The stable delayed cohort strongly supports an operational XY target-acquisition envelope near 735 HU (~18.67 m).',

        exactRadiusCaution:
          '735 HU should not yet be called the exact engine vacuum radius. Entity-origin distances can differ from collision/proximity geometry, and the lone early outlier must be explained.',

        earlyOutlier:
          'If the >735 HU case is tied to activation-start, reuse, first-observation, or position-jump behavior and occurs before a stable floor-persistent phase, it should be treated separately from approach-triggered delayed vacuum.',

        next:
          'If the early outlier has a distinct activation signature, promote ~735 HU as the single-replay stable-floor vacuum-target envelope and then diagnose the structured targetless lifetime schedule.'
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
  outlierRows
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD EARLY VACUUM OUTLIER DIAGNOSTIC V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'SCRIPT 78 REQUESTED-TICK CLOSURE'
);

console.log(
  '--------------------------------'
);


console.log(
  `Requested unique ticks:      ${requestedTickSet.size}`
);


console.log(
  `Raw requested packet hits:   ${requestedPacketHits}`
);


console.log(
  `Unique requested ticks seen: ${uniqueRequestedTicksSeen.size}`
);


console.log(
  `Duplicate packet hits:       ${duplicateRequestedPacketHits}`
);


console.log(
  `Missing requested ticks:     ${missingRequestedTicks.length}`
);


console.log(
  `Failure closed:              ${requestedTickFailureClosed}`
);


console.log('');

console.log(
  'DELAY BUCKETS'
);

console.log(
  '-------------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    bucketSummaries
  )
) {

  console.log(

    `${name.padEnd(22)} ` +

    `n=${String(row.count).padStart(3)} ` +

    `maxXY=${formatNumber(row.onsetXY.max).padStart(8)} ` +

    `>735=${String(row.over735).padStart(2)} ` +

    `>750=${String(row.over750).padStart(2)} ` +

    `>775=${String(row.over775).padStart(2)}`
  );
}


console.log('');

console.log(
  'STABLE DELAYED XY ENVELOPE'
);

console.log(
  '--------------------------'
);


console.log(
  formatDistribution(
    summarizeNumbers(
      stableOnsetXY
    )
  )
);


console.log(

  `Max stable XY: ${formatNumber(stableMaxXY)} HU = ` +

  `${formatMeters(stableMaxXY)}m`
);


console.log(

  `Smallest whole-HU envelope: ` +

  `${smallestWholeHUContainingStable ?? 'n/a'} HU`
);


console.log('');

console.log(
  'XY ONSET >735 HU'
);

console.log(
  '----------------'
);


if (
  outlierRows.length ===
  0
) {

  console.log(
    'None.'
  );

} else {

  for (
    const row
    of outlierRows
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)}  ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `delay=${formatNumber(row.targetDelaySeconds).padStart(6)}s ` +

      `onsetXY=${formatNumber(row.onsetDistanceXY).padStart(9)} ` +

      `minPreXY=${formatNumber(row.minimumPreOnsetXY).padStart(9)} ` +

      `dir=${String(row.rawMovementDirectionXY ?? 'UNKNOWN').padEnd(9)} ` +

      `start=${JSON.stringify(row.activationStartSignals)}`
    );


    console.log(

      `      activation->onset soul displacement: ` +

      `XY=${formatNumber(row.activationToOnsetSoulXY)} ` +

      `3D=${formatNumber(row.activationToOnsetSoul3D)} ` +

      `activationDuration=${formatNumber(row.activationDurationSeconds)}`
    );
  }
}


console.log('');

console.log(
  'ACTIVATION START SIGNALS'
);

console.log(
  '------------------------'
);


console.log(
  'Short delay <1s:'
);


printCounts(
  shortStartSignalCounts
);


console.log('');

console.log(
  'Stable delay >=1s:'
);


printCounts(
  stableStartSignalCounts
);


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

    `${name.padEnd(44)} ` +

    `actual=${JSON.stringify(row.actual)} ` +

    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');

console.log(

  `OVERALL DIAGNOSTIC: ` +

  `${validationPass ? 'PASS' : 'FAIL'}`
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
// HELPERS
// ============================================================

function countSignals(
  groups
) {

  const counts =
    new Map();


  for (
    const signals
    of groups
  ) {

    for (
      const signal
      of signals ??
      []
    ) {

      const key =
        String(
          signal
        );


      counts.set(

        key,

        (
          counts.get(
            key
          )
          ??
          0
        )
        +
        1
      );
    }
  }


  return Object.fromEntries(

    [
      ...counts.entries()
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
      value[2],
      0
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

  const content =
    rows
      .map(
        row =>
          JSON.stringify(
            row
          )
      )
      .join(
        '\n'
      );


  writeFileSync(

    path,

    content.length >
      0
      ? `${content}\n`
      : '',

    'utf8'
  );
}


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


function values(
  rows,
  selector
) {

  return rows
    .map(
      row =>
        finite(
          selector(
            row
          )
        )
    )
    .filter(
      Number.isFinite
    );
}


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


function formatMeters(
  hu
) {

  return Number.isFinite(
    hu
  )
    ? (
      hu /
      HU_PER_METER
    ).toFixed(
      2
    )
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


function printCounts(
  object
) {

  const entries =
    Object.entries(
      object
    );


  if (
    entries.length ===
    0
  ) {

    console.log(
      '  none'
    );

    return;
  }


  for (
    const [
      name,
      count
    ]
    of entries
  ) {

    console.log(

      `  ${name.padEnd(36)} ${count}`
    );
  }
}