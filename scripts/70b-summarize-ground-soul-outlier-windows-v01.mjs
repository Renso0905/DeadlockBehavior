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


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';

const WINDOW_SECONDS = [
  0.125,
  0.250,
  0.500,
  1.000
];


// ============================================================
// PATHS
// ============================================================

const script70SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_outlier_diagnostic_v01.json'
  );

const script70CasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_outlier_cases_v01.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_window_resolution_v01.json'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_window_resolution_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    script70SummaryPath,
    script70CasesPath
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
// LOAD SCRIPT 70
// ============================================================

const script70Summary =
  JSON.parse(
    readFileSync(
      script70SummaryPath,
      'utf8'
    )
  );

if (
  script70Summary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 70 diagnostic did not PASS validation.'
  );
}

const documentedRangeHU =
  finite(
    script70Summary
      ?.documentedMechanicTarget
      ?.rangeInternalUnits
  );

const documentedRangeMeters =
  finite(
    script70Summary
      ?.documentedMechanicTarget
      ?.rangeMeters
  ) ??
  45;

if (
  documentedRangeHU ===
  null
) {
  throw new Error(
    'Could not recover documented range threshold.'
  );
}

const cases =
  await loadJsonl(
    script70CasesPath
  );

console.log('');
console.log(
  `Loaded Script 70 cases: ${cases.length}`
);

console.log(
  `Documented threshold: ${documentedRangeHU.toFixed(3)} HU (${documentedRangeMeters}m)`
);


// ============================================================
// CLASSIFY
// ============================================================

const classified =
  cases.map(
    classifyCase
  );


// ============================================================
// PARTITIONS
// ============================================================

const first3DWindowCounts =
  countByObject(
    classified,
    row =>
      row.first3DResolution
        ?.label ??
      'NO_3D_RESOLUTION_THROUGH_1S'
  );

const resolved3D =
  classified.filter(
    row =>
      Boolean(
        row.first3DResolution
      )
  );

const no3DThrough1s =
  classified.filter(
    row =>
      !row.first3DResolution
  );

const planarOnly =
  no3DThrough1s.filter(
    row =>
      Boolean(
        row.firstXYResolution
      )
  );

const matchAmbiguousWithoutGeometry =
  no3DThrough1s.filter(
    row =>
      !row.firstXYResolution
      &&
      row.script55MatchAmbiguous
  );

const stillPersistent =
  no3DThrough1s.filter(
    row =>
      !row.firstXYResolution
      &&
      !row.script55MatchAmbiguous
  );

const primaryCategoryCounts =
  countByObject(
    classified,
    row =>
      row.primaryResolutionCategory
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedCases =
  finite(
    script70Summary
      ?.sourceCounts
      ?.script57MatchedOutside45m
  );

const script70HalfSecondResolved =
  finite(
    script70Summary
      ?.results
      ?.rawHalfSecond3DResolvedAdditional
  );

const recomputedHalfSecondResolved =
  classified.filter(
    row =>
      row.first3DResolution
      &&
      row.first3DResolution.seconds <=
        0.5
  ).length;

const validationChecks = {
  script70Passed:
    check(
      script70Summary
        ?.validation
        ?.pass,
      true,
      script70Summary
        ?.validation
        ?.pass ===
        true
    ),

  caseCountPreserved:
    check(
      classified.length,
      expectedCases,
      expectedCases ===
        null
        ? classified.length >
          0
        : classified.length ===
          expectedCases
    ),

  expectedTestReplayCaseCount:
    check(
      classified.length,
      replayName ===
        'test'
        ? 15
        : '>0',
      replayName ===
        'test'
        ? classified.length ===
          15
        : classified.length >
          0
    ),

  allCasesHaveExactTickGeometry:
    check(
      classified.filter(
        row =>
          Number.isFinite(
            row.exactTick.best3D
          )
      ).length,
      classified.length,
      classified.every(
        row =>
          Number.isFinite(
            row.exactTick.best3D
          )
      )
    ),

  allCasesHaveOneSecondGeometry:
    check(
      classified.filter(
        row =>
          Number.isFinite(
            row.windows
              ?.['1']
              ?.best3D
          )
      ).length,
      classified.length,
      classified.every(
        row =>
          Number.isFinite(
            row.windows
              ?.['1']
              ?.best3D
          )
      )
    ),

  halfSecondResolutionAgreesWithScript70:
    check(
      recomputedHalfSecondResolved,
      script70HalfSecondResolved,
      script70HalfSecondResolved ===
        null
        ? recomputedHalfSecondResolved >=
          0
        : recomputedHalfSecondResolved ===
          script70HalfSecondResolved
    ),

  classificationsExhaustive:
    check(
      resolved3D.length +
        planarOnly.length +
        matchAmbiguousWithoutGeometry.length +
        stillPersistent.length,
      classified.length,
      resolved3D.length +
        planarOnly.length +
        matchAmbiguousWithoutGeometry.length +
        stillPersistent.length ===
        classified.length
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
    'TROOPER_GROUND_SOUL_45M_WINDOW_RESOLUTION_V01',

  canonical:
    false,

  status:
    !validationPass
      ? 'DIAGNOSTIC_PIPELINE_FAILURE'
      : stillPersistent.length ===
          0
        ? 'ALL_CASES_EXPLAINED_BY_TIMING_PLANAR_GEOMETRY_OR_MATCH_AMBIGUITY'
        : stillPersistent.length <=
            3
          ? 'SMALL_PERSISTENT_45M_EXCEPTION_SET_REMAINS'
          : 'PERSISTENT_45M_EXCEPTION_SET_REMAINS',

  correction:
    'best3D and bestXY now use the minimum finite raw-Trooper/stored-death-position measurement rather than the first available measurement.',

  documentedMechanicTarget: {
    rangeMeters:
      documentedRangeMeters,

    rangeInternalUnits:
      documentedRangeHU
  },

  counts: {
    totalCases:
      classified.length,

    resolvedIn3DByOneSecond:
      resolved3D.length,

    resolvedIn3DByHalfSecond:
      recomputedHalfSecondResolved,

    planarOnlyAfterNo3DThroughOneSecond:
      planarOnly.length,

    matchAmbiguousWithout3DOrPlanarResolution:
      matchAmbiguousWithoutGeometry.length,

    stillPersistentWithout3DPlanarOrMatchAmbiguity:
      stillPersistent.length
  },

  primaryResolutionCategoryCounts:
    primaryCategoryCounts,

  first3DResolutionCounts:
    first3DWindowCounts,

  persistentCases:
    stillPersistent.map(
      compactCase
    ),

  planarOnlyCases:
    planarOnly.map(
      compactCase
    ),

  matchAmbiguousCases:
    matchAmbiguousWithoutGeometry.map(
      compactCase
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
  outputCasesPath,
  classified
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);

console.log(
  'GROUND SOUL 45M WINDOW RESOLUTION V0.1 — CORRECTED'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Cases: ${classified.length}`
);

console.log(
  `Threshold: ${documentedRangeHU.toFixed(3)} HU (${documentedRangeMeters}m)`
);

console.log('');

console.log(
  'FIRST 3D RESOLUTION'
);

console.log(
  '-------------------'
);

for (
  const [
    label,
    count
  ]
  of Object.entries(
    first3DWindowCounts
  )
) {
  console.log(
    `${label.padEnd(34)} ${count}`
  );
}

console.log('');

console.log(
  'FINAL DIAGNOSTIC PARTITION'
);

console.log(
  '--------------------------'
);

console.log(
  `3D resolved by +/-0.5s:          ${recomputedHalfSecondResolved}`
);

console.log(
  `3D resolved by +/-1s:            ${resolved3D.length}`
);

console.log(
  `Planar-only after no 3D:         ${planarOnly.length}`
);

console.log(
  `Match ambiguity only:            ${matchAmbiguousWithoutGeometry.length}`
);

console.log(
  `Still persistent:                ${stillPersistent.length}`
);

console.log('');

console.log(
  'STILL PERSISTENT CASES'
);

console.log(
  '----------------------'
);

if (
  stillPersistent.length ===
  0
) {
  console.log(
    'None.'
  );
} else {
  for (
    const row
    of stillPersistent
  ) {
    const oneSecond =
      row
        ?.windows
        ?.['1']
        ?.best3D;

    console.log(
      `${String(row.death?.deathIndex ?? '').padStart(4)}  ` +
      `${String(row.death?.clock ?? '').padEnd(6)} ` +
      `${String(row.death?.baseType ?? '').padEnd(7)} ` +
      `exact=${formatNumber(row.exactTick.best3D)} ` +
      `1s=${formatNumber(oneSecond)} ` +
      `excess=${formatNumber(
        Number.isFinite(
          oneSecond
        )
          ? oneSecond -
            documentedRangeHU
          : null
      )}`
    );
  }
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
    `${name.padEnd(44)} ` +
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
// CLASSIFICATION
// ============================================================

function classifyCase(
  row
) {
  const exactTick =
    extractExactTick(
      row
    );

  const windows =
    {};

  for (
    const seconds
    of WINDOW_SECONDS
  ) {
    windows[
      String(
        seconds
      )
    ] =
      extractWindow(
        row,
        seconds
      );
  }

  const first3DResolution =
    findFirstResolution(
      exactTick,
      windows,
      'best3D'
    );

  const firstXYResolution =
    findFirstResolution(
      exactTick,
      windows,
      'bestXY'
    );

  const script55MatchAmbiguous =
    row
      ?.script55Match
      ?.ambiguous ===
    true;

  let primaryResolutionCategory;

  if (
    first3DResolution
  ) {
    primaryResolutionCategory =
      first3DResolution.label;

  } else if (
    firstXYResolution
  ) {
    primaryResolutionCategory =
      `PLANAR_ONLY_${firstXYResolution.label}`;

  } else if (
    script55MatchAmbiguous
  ) {
    primaryResolutionCategory =
      'MATCH_AMBIGUITY_NO_GEOMETRIC_RESOLUTION';

  } else {
    primaryResolutionCategory =
      'STILL_PERSISTENT_THROUGH_1S';
  }

  return {
    schemaVersion:
      1,

    canonical:
      false,

    death:
      row?.death ??
      null,

    script57:
      row?.script57 ??
      null,

    script70PrimaryDiagnosticCategory:
      row?.primaryDiagnosticCategory ??
      null,

    script70DiagnosticFlags:
      row?.diagnosticFlags ??
      [],

    script55Match:
      row?.script55Match ??
      null,

    script55MatchAmbiguous,

    exactTick,

    windows,

    first3DResolution,

    firstXYResolution,

    primaryResolutionCategory,

    persistentMechanicCandidate:
      !first3DResolution
      &&
      !firstXYResolution
      &&
      !script55MatchAmbiguous
  };
}


// ============================================================
// EXACT TICK
// ============================================================

function extractExactTick(
  row
) {
  const raw3D =
    finite(
      row
        ?.rawReplay
        ?.exactTick
        ?.nearestUsingRawTrooperPosition
        ?.distanceToRawTrooper3D
    );

  const stored3D =
    finite(
      row
        ?.rawReplay
        ?.exactTick
        ?.nearestUsingStoredDeathPosition
        ?.distanceToStoredDeath3D
    );

  const rawXY =
    finite(
      row
        ?.rawReplay
        ?.exactTick
        ?.nearestUsingRawTrooperPosition
        ?.distanceToRawTrooperXY
    );

  const storedXY =
    finite(
      row
        ?.rawReplay
        ?.exactTick
        ?.nearestUsingStoredDeathPosition
        ?.distanceToStoredDeathXY
    );

  const best3D =
    minFinite([
      raw3D,
      stored3D
    ]);

  const bestXY =
    minFinite([
      rawXY,
      storedXY
    ]);

  return {
    label:
      'EXACT_TICK',

    seconds:
      0,

    rawTrooper3D:
      raw3D,

    storedDeath3D:
      stored3D,

    best3D,

    rawTrooperXY:
      rawXY,

    storedDeathXY:
      storedXY,

    bestXY,

    within45m3D:
      within(
        best3D
      ),

    within45mXY:
      within(
        bestXY
      )
  };
}


// ============================================================
// WINDOWS
// ============================================================

function extractWindow(
  row,
  seconds
) {
  const source =
    row
      ?.rawReplay
      ?.envelopes
      ?.[
        String(
          seconds
        )
      ] ??
    null;

  const raw3D =
    finite(
      source
        ?.rawTrooperPosition
        ?.nearest3D
        ?.distance3D
    );

  const stored3D =
    finite(
      source
        ?.storedDeathPosition
        ?.nearest3D
        ?.distance3D
    );

  const rawXY =
    finite(
      source
        ?.rawTrooperPosition
        ?.nearestXY
        ?.distanceXY
    );

  const storedXY =
    finite(
      source
        ?.storedDeathPosition
        ?.nearestXY
        ?.distanceXY
    );

  const best3D =
    minFinite([
      raw3D,
      stored3D
    ]);

  const bestXY =
    minFinite([
      rawXY,
      storedXY
    ]);

  return {
    label:
      formatWindowLabel(
        seconds
      ),

    seconds,

    rawTrooper3D:
      raw3D,

    storedDeath3D:
      stored3D,

    best3D,

    rawTrooperXY:
      rawXY,

    storedDeathXY:
      storedXY,

    bestXY,

    within45m3D:
      within(
        best3D
      ),

    within45mXY:
      within(
        bestXY
      )
  };
}


// ============================================================
// FIRST RESOLUTION
// ============================================================

function findFirstResolution(
  exact,
  windows,
  distanceKey
) {
  if (
    within(
      exact[
        distanceKey
      ]
    )
  ) {
    return {
      label:
        'EXACT_TICK',

      seconds:
        0,

      distanceHU:
        exact[
          distanceKey
        ]
    };
  }

  for (
    const seconds
    of WINDOW_SECONDS
  ) {
    const measurement =
      windows[
        String(
          seconds
        )
      ];

    const distance =
      measurement
        ?.[
          distanceKey
        ];

    if (
      within(
        distance
      )
    ) {
      return {
        label:
          formatWindowLabel(
            seconds
          ),

        seconds,

        distanceHU:
          distance
      };
    }
  }

  return null;
}


// ============================================================
// COMPACT
// ============================================================

function compactCase(
  row
) {
  return {
    deathIndex:
      row
        ?.death
        ?.deathIndex ??
      null,

    deathKey:
      row
        ?.death
        ?.deathKey ??
      null,

    clock:
      row
        ?.death
        ?.clock ??
      null,

    baseType:
      row
        ?.death
        ?.baseType ??
      null,

    primaryResolutionCategory:
      row.primaryResolutionCategory,

    first3DResolution:
      row.first3DResolution,

    firstXYResolution:
      row.firstXYResolution,

    script55MatchAmbiguous:
      row.script55MatchAmbiguous,

    exactBest3D:
      row.exactTick.best3D,

    oneSecondBest3D:
      row
        ?.windows
        ?.['1']
        ?.best3D ??
      null,

    oneSecondBestXY:
      row
        ?.windows
        ?.['1']
        ?.bestXY ??
      null
  };
}


// ============================================================
// RANGE
// ============================================================

function within(
  value
) {
  return Number.isFinite(
    value
  )
  &&
  value <=
    documentedRangeHU;
}


function formatWindowLabel(
  seconds
) {
  if (
    seconds ===
    0.125
  ) {
    return 'WITHIN_125MS';
  }

  if (
    seconds ===
    0.250
  ) {
    return 'WITHIN_250MS';
  }

  if (
    seconds ===
    0.500
  ) {
    return 'WITHIN_500MS';
  }

  if (
    seconds ===
    1.000
  ) {
    return 'WITHIN_1000MS';
  }

  return `WITHIN_${Math.round(seconds * 1000)}MS`;
}


// ============================================================
// FILES
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
      accept,
      reject
    ) => {
      writer.on(
        'error',
        reject
      );

      writer.end(
        accept
      );
    }
  );
}


// ============================================================
// GENERIC
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


function minFinite(
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

  return Math.min(
    ...clean
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

    map.set(
      key,
      (
        map.get(
          key
        ) ??
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