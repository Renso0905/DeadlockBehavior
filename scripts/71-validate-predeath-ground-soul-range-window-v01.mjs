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


// ============================================================
// RANGE
// ============================================================

const HU_PER_METER =
  39.37;

const DOCUMENTED_RANGE_METERS =
  45;

const DEFAULT_RANGE_HU =
  DOCUMENTED_RANGE_METERS *
  HU_PER_METER;


// ============================================================
// PLAYER-STATE RECONSTRUCTION
//
// This deliberately uses the same 4 Hz player_state source as
// Script 57.
//
// EXACT must reproduce Script 57 before any lookback result is
// considered trustworthy.
// ============================================================

const MAX_INTERPOLATION_GAP_SECONDS =
  0.30;

const MAX_NEAREST_SAMPLE_DELTA_SECONDS =
  0.15;


// ============================================================
// PRE-DEATH LOOKBACK WINDOWS
//
// These are exploratory candidate windows.
//
// A better classifier is NOT automatically an engine mechanic.
// ============================================================

const LOOKBACK_WINDOWS_SECONDS = [
  0,
  0.25,
  0.50,
  1.00,
  1.50,
  2.00,
  3.00,
  4.00,
  5.00
];


// ============================================================
// PATHS
// ============================================================

const deathStreamPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_v01.jsonl'
  );

const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );

const script57SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_range_validation_v01.json'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_predeath_range_validation_v01.json'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_predeath_range_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    deathStreamPath,
    playerStatePath,
    script57SummaryPath
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
// LOAD SCRIPT 57
// ============================================================

const script57 =
  JSON.parse(
    readFileSync(
      script57SummaryPath,
      'utf8'
    )
  );

const rangeHU =
  finite(
    script57
      ?.documentedMechanicTarget
      ?.rangeInternalUnits
  ) ??
  DEFAULT_RANGE_HU;

const expected3D =
  script57
    ?.documented45mTest
    ?.threeDimensional ??
  null;

const expectedXY =
  script57
    ?.documented45mTest
    ?.planarXY ??
  null;


// ============================================================
// LOAD DEATHS
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
    );

console.log(
  `Deaths: ${deaths.length}`
);


// ============================================================
// LOAD PLAYER TIMELINES
// ============================================================

console.log(
  'Loading player-state timelines...'
);

const timelines =
  new Map();

let playerStateRows =
  0;

const reader =
  createInterface({
    input:
      createReadStream(
        playerStatePath,
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

  playerStateRows++;

  let row;

  try {
    row =
      JSON.parse(
        line
      );
  } catch {
    continue;
  }

  const timeSeconds =
    finite(
      row?.matchTimeSeconds
    );

  const playerName =
    row
      ?.controller
      ?.playerName ??
    null;

  const team =
    finite(
      row
        ?.controller
        ?.team
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
    !timelines.has(
      key
    )
  ) {
    timelines.set(
      key,
      {
        playerName,
        team,
        rows:
          []
      }
    );
  }

  timelines
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

      position:
        normalizePosition(
          row
            ?.pawn
            ?.positionWorld
        )
    });
}

for (
  const timeline
  of timelines.values()
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

console.log(
  `Player-state rows: ${playerStateRows}`
);

console.log(
  `Player timelines: ${timelines.size}`
);


// ============================================================
// COMPUTE RANGE WINDOWS
// ============================================================

console.log(
  'Evaluating trailing pre-death windows...'
);

for (
  const death
  of deaths
) {
  death.windows =
    {};

  const opposingTeam =
    oppositeTeam(
      death.team
    );

  for (
    const seconds
    of LOOKBACK_WINDOWS_SECONDS
  ) {
    const key =
      windowKey(
        seconds
      );

    if (
      opposingTeam ===
      null
    ) {
      death.windows[key] = {
        seconds,
        nearest3D:
          null,
        nearestXY:
          null
      };

      continue;
    }

    if (
      seconds ===
      0
    ) {
      death.windows[key] =
        exactWindow(
          death,
          opposingTeam
        );

      continue;
    }

    death.windows[key] =
      trailingWindow(
        death,
        opposingTeam,
        seconds
      );
  }
}


// ============================================================
// EVALUATE
// ============================================================

const evaluations3D =
  LOOKBACK_WINDOWS_SECONDS.map(
    seconds =>
      evaluateWindow(
        seconds,
        'nearest3D',
        'distance3D'
      )
  );

const evaluationsXY =
  LOOKBACK_WINDOWS_SECONDS.map(
    seconds =>
      evaluateWindow(
        seconds,
        'nearestXY',
        'distanceXY'
      )
  );

const exact3D =
  evaluations3D[0];

const exactXY =
  evaluationsXY[0];


// ============================================================
// DELTA FROM EXACT
// ============================================================

for (
  const row
  of evaluations3D
) {
  row.deltaFromExact = {
    matchedRescued:
      row.tp -
      exact3D.tp,

    newFalsePositives:
      row.fp -
      exact3D.fp,

    falseNegativesRemoved:
      exact3D.fn -
      row.fn
  };
}


// ============================================================
// EXPLORATORY SELECTIONS
// ============================================================

const bestZeroFalsePositive =
  chooseBest(
    evaluations3D.filter(
      row =>
        row.fp ===
        0
    )
  );

const bestAtLeast99Specific =
  chooseBest(
    evaluations3D.filter(
      row =>
        Number.isFinite(
          row.specificity
        )
        &&
        row.specificity >=
          0.99
    )
  );

const bestMcc =
  evaluations3D
    .filter(
      row =>
        Number.isFinite(
          row.mcc
        )
    )
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.mcc -
        a.mcc
        ||
        a.seconds -
        b.seconds
    )[0] ??
  null;


// ============================================================
// INTERESTING CASE STREAM
// ============================================================

const caseRows =
  [];

for (
  const death
  of deaths
) {
  const exactDistance =
    finite(
      death
        ?.windows
        ?.['0']
        ?.nearest3D
        ?.distance3D
    );

  const exactInside =
    Number.isFinite(
      exactDistance
    )
      ? exactDistance <=
        rangeHU
      : null;

  const first3D =
    findFirstInside(
      death,
      'nearest3D',
      'distance3D'
    );

  const firstXY =
    findFirstInside(
      death,
      'nearestXY',
      'distanceXY'
    );

  const matchedRescue =
    death.groundSoulMatched
    &&
    exactInside ===
      false
    &&
    Boolean(
      first3D
    );

  const unmatchedFalsePositive =
    !death.groundSoulMatched
    &&
    Boolean(
      first3D
    );

  const unresolvedExact =
    exactInside ===
    null;

  if (
    !matchedRescue
    &&
    !unmatchedFalsePositive
    &&
    !unresolvedExact
  ) {
    continue;
  }

  caseRows.push({
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

    clock:
      death.clock,

    tick:
      death.tick,

    timeSeconds:
      death.timeSeconds,

    groundSoulMatched:
      death.groundSoulMatched,

    exact3D:
      death
        ?.windows
        ?.['0']
        ?.nearest3D ??
      null,

    first3DInside:
      first3D,

    firstXYInside:
      firstXY,

    matchedRescue,

    unmatchedFalsePositive,

    unresolvedExact
  });
}


// ============================================================
// VALIDATION
// ============================================================

const checks = {
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

  timelineCount:
    check(
      timelines.size,
      replayName ===
        'test'
        ? 12
        : '>0',
      replayName ===
        'test'
        ? timelines.size ===
          12
        : timelines.size >
          0
    ),

  exact3Dtp:
    check(
      exact3D.tp,
      expected3D?.tp,
      !expected3D
      ||
      exact3D.tp ===
        expected3D.tp
    ),

  exact3Dfp:
    check(
      exact3D.fp,
      expected3D?.fp,
      !expected3D
      ||
      exact3D.fp ===
        expected3D.fp
    ),

  exact3Dtn:
    check(
      exact3D.tn,
      expected3D?.tn,
      !expected3D
      ||
      exact3D.tn ===
        expected3D.tn
    ),

  exact3Dfn:
    check(
      exact3D.fn,
      expected3D?.fn,
      !expected3D
      ||
      exact3D.fn ===
        expected3D.fn
    ),

  exact3Dunresolved:
    check(
      exact3D.unresolved,
      expected3D?.unresolved,
      !expected3D
      ||
      exact3D.unresolved ===
        expected3D.unresolved
    ),

  exactXYtp:
    check(
      exactXY.tp,
      expectedXY?.tp,
      !expectedXY
      ||
      exactXY.tp ===
        expectedXY.tp
    ),

  exactXYfp:
    check(
      exactXY.fp,
      expectedXY?.fp,
      !expectedXY
      ||
      exactXY.fp ===
        expectedXY.fp
    )
};

const validationPass =
  Object
    .values(
      checks
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
    'TROOPER_GROUND_SOUL_PREDEATH_RANGE_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'PREDEATH_RANGE_WINDOW_DIAGNOSTIC_READY'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',

  purpose: [
    'Test the pre-death proximity-cache hypothesis globally across all economic Trooper deaths.',
    'Determine whether trailing 45m proximity windows rescue matched ground-soul deaths without creating large numbers of unmatched false positives.',
    'Require the exact-time reconstruction to reproduce Script 57 before trusting the exploratory windows.',
    'Do not infer that the empirically best window is an engine constant.'
  ],

  documentedTarget: {
    meters:
      DOCUMENTED_RANGE_METERS,

    internalUnits:
      rangeHU
  },

  inputs: {
    deathStream:
      deathStreamPath,

    playerState:
      playerStatePath,

    script57:
      script57SummaryPath
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

    playerStateRows,

    playerTimelines:
      timelines.size
  },

  reconstruction: {
    maxInterpolationGapSeconds:
      MAX_INTERPOLATION_GAP_SECONDS,

    maxNearestFallbackDeltaSeconds:
      MAX_NEAREST_SAMPLE_DELTA_SECONDS,

    lookbackWindowsSeconds:
      LOOKBACK_WINDOWS_SECONDS,

    note:
      'Trailing windows use observed 4 Hz positions plus reconstructed start/end boundary states.'
  },

  threeDimensional: {
    evaluations:
      evaluations3D,

    exploratorySelections: {
      bestZeroFalsePositive,

      bestAtLeast99Specific,

      bestMcc
    }
  },

  planarXY: {
    evaluations:
      evaluationsXY
  },

  interpretation: {
    mainQuestion:
      'Does permitting pre-death proximity materially reduce matched false negatives while preserving the strong unmatched separation observed by Script 57?',

    timingCacheEvidence:
      'A short lookback that rescues several matched deaths with zero or very few new false positives supports a cached/earlier eligibility-check hypothesis.',

    falsification:
      'If modest lookbacks rapidly create unmatched false positives, a simple pre-death any-time-within-45m rule is not supported.',

    scope:
      'All window selection is exploratory within test.dem and requires replication on other replays.'
  },

  validation: {
    pass:
      validationPass,

    checks
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
  caseRows
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'TROOPER PRE-DEATH RANGE WINDOW VALIDATION V0.1'
);
console.log(
  '========================================================'
);
console.log('');

console.log(
  `Threshold: ${rangeHU.toFixed(3)} HU (${DOCUMENTED_RANGE_METERS}m)`
);

console.log('');
console.log(
  '3D RESULTS'
);
console.log(
  '----------'
);

console.log(
  'Window    TP    FP    TN    FN  Unres    Sens      Spec      MCC'
);

for (
  const row
  of evaluations3D
) {
  console.log(
    `${formatWindow(row.seconds).padEnd(8)} ` +
    `${String(row.tp).padStart(4)}  ` +
    `${String(row.fp).padStart(4)}  ` +
    `${String(row.tn).padStart(4)}  ` +
    `${String(row.fn).padStart(4)}  ` +
    `${String(row.unresolved).padStart(5)}  ` +
    `${formatPercent(row.sensitivity).padStart(8)}  ` +
    `${formatPercent(row.specificity).padStart(8)}  ` +
    `${formatMetric(row.mcc).padStart(7)}`
  );
}

console.log('');
console.log(
  'GAIN VS EXACT'
);
console.log(
  '-------------'
);

for (
  const row
  of evaluations3D
) {
  console.log(
    `${formatWindow(row.seconds).padEnd(8)} ` +
    `matched_rescued=${formatSigned(
      row.deltaFromExact.matchedRescued
    )} ` +
    `new_FP=${formatSigned(
      row.deltaFromExact.newFalsePositives
    )}`
  );
}

console.log('');
console.log(
  'EXPLORATORY SELECTIONS'
);
console.log(
  '----------------------'
);

console.log(
  `Best zero-FP:          ${formatSelection(bestZeroFalsePositive)}`
);

console.log(
  `Best >=99% specificity:${formatSelection(bestAtLeast99Specific)}`
);

console.log(
  `Best MCC:              ${formatSelection(bestMcc)}`
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
    checks
  )
) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ` +
    `${name.padEnd(28)} ` +
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
// EXACT WINDOW
// ============================================================

function exactWindow(
  death,
  opposingTeam
) {
  const candidates =
    [];

  for (
    const timeline
    of timelines.values()
  ) {
    if (
      timeline.team !==
      opposingTeam
    ) {
      continue;
    }

    const state =
      estimateStateAtTime(
        timeline.rows,
        death.timeSeconds
      );

    if (
      !state
    ) {
      continue;
    }

    candidates.push(
      buildCandidate(
        timeline,
        state.timeSeconds,
        state.position,
        death.position,
        state.method
      )
    );
  }

  return {
    seconds:
      0,

    nearest3D:
      nearest(
        candidates,
        'distance3D'
      ),

    nearestXY:
      nearest(
        candidates,
        'distanceXY'
      )
  };
}


// ============================================================
// TRAILING WINDOW
// ============================================================

function trailingWindow(
  death,
  opposingTeam,
  seconds
) {
  const start =
    death.timeSeconds -
    seconds;

  const end =
    death.timeSeconds;

  const candidates =
    [];

  for (
    const timeline
    of timelines.values()
  ) {
    if (
      timeline.team !==
      opposingTeam
    ) {
      continue;
    }

    const seen =
      new Set();

    for (
      const boundary
      of [
        {
          time:
            start,
          label:
            'WINDOW_START'
        },
        {
          time:
            end,
          label:
            'WINDOW_END'
        }
      ]
    ) {
      const state =
        estimateStateAtTime(
          timeline.rows,
          boundary.time
        );

      if (
        !state
      ) {
        continue;
      }

      const key =
        state.timeSeconds.toFixed(
          6
        );

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

      candidates.push(
        buildCandidate(
          timeline,
          state.timeSeconds,
          state.position,
          death.position,
          `${boundary.label}_${state.method}`
        )
      );
    }

    const startIndex =
      lowerBoundByTime(
        timeline.rows,
        start
      );

    for (
      let i =
        Math.max(
          0,
          startIndex -
          1
        );

      i <
        timeline.rows.length;

      i++
    ) {
      const sample =
        timeline.rows[i];

      if (
        sample.timeSeconds <
        start
      ) {
        continue;
      }

      if (
        sample.timeSeconds >
        end
      ) {
        break;
      }

      if (
        !validSample(
          sample
        )
      ) {
        continue;
      }

      const key =
        sample.timeSeconds.toFixed(
          6
        );

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

      candidates.push(
        buildCandidate(
          timeline,
          sample.timeSeconds,
          sample.position,
          death.position,
          'OBSERVED_4HZ_SAMPLE'
        )
      );
    }
  }

  return {
    seconds,

    startTimeSeconds:
      start,

    endTimeSeconds:
      end,

    nearest3D:
      nearest(
        candidates,
        'distance3D'
      ),

    nearestXY:
      nearest(
        candidates,
        'distanceXY'
      )
  };
}


// ============================================================
// EVALUATION
// ============================================================

function evaluateWindow(
  seconds,
  nearestKey,
  distanceKey
) {
  let tp =
    0;

  let fp =
    0;

  let tn =
    0;

  let fn =
    0;

  let unresolved =
    0;

  for (
    const death
    of deaths
  ) {
    const distance =
      finite(
        death
          ?.windows
          ?.[
            windowKey(
              seconds
            )
          ]
          ?.[
            nearestKey
          ]
          ?.[
            distanceKey
          ]
      );

    if (
      distance ===
      null
    ) {
      unresolved++;
      continue;
    }

    const predicted =
      distance <=
      rangeHU;

    if (
      predicted
      &&
      death.groundSoulMatched
    ) {
      tp++;
    } else if (
      predicted
      &&
      !death.groundSoulMatched
    ) {
      fp++;
    } else if (
      !predicted
      &&
      !death.groundSoulMatched
    ) {
      tn++;
    } else {
      fn++;
    }
  }

  const sensitivity =
    rate(
      tp,
      tp +
      fn
    );

  const specificity =
    rate(
      tn,
      tn +
      fp
    );

  return {
    seconds,

    tp,
    fp,
    tn,
    fn,
    unresolved,

    sensitivity,

    specificity,

    precision:
      rate(
        tp,
        tp +
        fp
      ),

    accuracy:
      rate(
        tp +
        tn,
        tp +
        fp +
        tn +
        fn
      ),

    mcc:
      mcc(
        tp,
        fp,
        tn,
        fn
      )
  };
}


// ============================================================
// FIRST INSIDE WINDOW
// ============================================================

function findFirstInside(
  death,
  nearestKey,
  distanceKey
) {
  for (
    const seconds
    of LOOKBACK_WINDOWS_SECONDS
  ) {
    const candidate =
      death
        ?.windows
        ?.[
          windowKey(
            seconds
          )
        ]
        ?.[
          nearestKey
        ] ??
      null;

    const distance =
      finite(
        candidate
          ?.[
            distanceKey
          ]
      );

    if (
      distance !==
        null
      &&
      distance <=
        rangeHU
    ) {
      return {
        windowSeconds:
          seconds,

        playerName:
          candidate.playerName,

        team:
          candidate.team,

        observationTimeSeconds:
          candidate.timeSeconds,

        timeBeforeDeathSeconds:
          death.timeSeconds -
          candidate.timeSeconds,

        method:
          candidate.method,

        distance3D:
          candidate.distance3D,

        distanceXY:
          candidate.distanceXY
      };
    }
  }

  return null;
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
    validSample(
      after
    )
  ) {
    return {
      timeSeconds,
      position:
        after.position,
      method:
        'EXACT_SAMPLE'
    };
  }

  if (
    before
    &&
    after
    &&
    validSample(
      before
    )
    &&
    validSample(
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
        ) /
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
            interpolate(
              before.position,
              after.position,
              fraction
            ),

          method:
            'LINEAR_INTERPOLATION'
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
      !validSample(
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
    candidates[0] ??
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
      'NEAREST_VALID_SAMPLE'
  };
}


// ============================================================
// DEATH NORMALIZATION
// ============================================================

function normalizeDeath(
  row
) {
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

  return {
    deathIndex:
      finite(
        row?.deathIndex
      ),

    deathKey:
      row?.deathKey ??
      null,

    entityIndex,

    baseType:
      row
        ?.trooper
        ?.baseType ??
      'UNKNOWN',

    variantLabel:
      row
        ?.trooper
        ?.variantLabel ??
      'UNKNOWN',

    team,

    tick,

    timeSeconds,

    clock:
      row
        ?.timing
        ?.clock ??
      formatClock(
        timeSeconds
      ),

    position,

    groundSoulMatched:
      row
        ?.match
        ?.status ===
        'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
      ||
      Boolean(
        row?.groundSoul
      ),

    windows:
      null
  };
}


// ============================================================
// POSITION / DISTANCE
// ============================================================

function buildCandidate(
  timeline,
  timeSeconds,
  position,
  deathPosition,
  method
) {
  return {
    playerName:
      timeline.playerName,

    team:
      timeline.team,

    timeSeconds,

    method,

    position,

    distance3D:
      distance3D(
        deathPosition,
        position
      ),

    distanceXY:
      distanceXY(
        deathPosition,
        position
      )
  };
}


function nearest(
  rows,
  key
) {
  return rows
    .filter(
      row =>
        Number.isFinite(
          row[key]
        )
    )
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        a[key] -
        b[key]
        ||
        b.timeSeconds -
        a.timeSeconds
    )[0] ??
    null;
}


function validSample(
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


function interpolate(
  a,
  b,
  f
) {
  return {
    x:
      a.x +
      (
        b.x -
        a.x
      ) *
      f,

    y:
      a.y +
      (
        b.y -
        a.y
      ) *
      f,

    z:
      a.z +
      (
        b.z -
        a.z
      ) *
      f
  };
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
    dx * dx +
    dy * dy +
    dz * dz
  );
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
    dx * dx +
    dy * dy
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


// ============================================================
// SEARCH
// ============================================================

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
// METRICS
// ============================================================

function chooseBest(
  rows
) {
  return rows
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.tp -
        a.tp
        ||
        a.fp -
        b.fp
        ||
        a.seconds -
        b.seconds
    )[0] ??
    null;
}


function mcc(
  tp,
  fp,
  tn,
  fn
) {
  const denominator =
    Math.sqrt(
      (
        tp +
        fp
      ) *
      (
        tp +
        fn
      ) *
      (
        tn +
        fp
      ) *
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
      tn -
    fp *
      fn
  ) /
    denominator;
}


function rate(
  numerator,
  denominator
) {
  if (
    denominator <=
      0
  ) {
    return null;
  }

  return numerator /
    denominator;
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


function windowKey(
  seconds
) {
  return String(
    Number(
      seconds.toFixed(
        3
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


function formatWindow(
  seconds
) {
  return seconds ===
    0
    ? 'EXACT'
    : `${seconds.toFixed(2)}s`;
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


function formatSigned(
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


function formatSelection(
  row
) {
  if (
    !row
  ) {
    return 'none';
  }

  return (
    `${formatWindow(row.seconds)} ` +
    `TP=${row.tp} FP=${row.fp} ` +
    `sens=${formatPercent(row.sensitivity)} ` +
    `spec=${formatPercent(row.specificity)} ` +
    `MCC=${formatMetric(row.mcc)}`
  );
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