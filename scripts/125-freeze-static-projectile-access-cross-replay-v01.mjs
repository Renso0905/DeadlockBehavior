import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_CROSS_REPLAY_CHECKPOINT_V01';


// ============================================================
// PURPOSE
//
// Scripts 123-124 established:
//
//   - dl_midtown static collision substrate
//   - successful-hit positive-control validation
//   - exhaustive static projectile-path windows
//   - two firing-origin probes: pawn Z+64 and Z+80
//
// Script125 performs NO replay parsing and NO raycasting.
//
// It freezes the five-replay operational static-projectile
// substrate before the pipeline moves into:
//
//   dynamic occluders
//   visual access
//   weapon mechanics
//   temporal reachability
//
// STATIC PROJECTILE ACCESS remains distinct from LOS and from
// actionable opportunity.
// ============================================================


// ============================================================
// REPLAY COHORT
// ============================================================

const REPLAYS =
  [
    'rep01',
    'rep02',
    'rep03',
    'rep04',
    'rep05'
  ];


// ============================================================
// INHERITED SCRIPT117 COHORT COUNTS
//
// These are frozen integrity expectations from the already
// validated Script117 five-replay geometry substrate.
//
// They are NOT new mechanic assumptions.
// ============================================================

const EXPECTED =
  {
    rep01:
      {
        candidates:
          7200,

        aliveGeometry:
          6343,

        observedHitCandidates:
          76
      },

    rep02:
      {
        candidates:
          8172,

        aliveGeometry:
          7127,

        observedHitCandidates:
          91
      },

    rep03:
      {
        candidates:
          12960,

        aliveGeometry:
          11383,

        observedHitCandidates:
          108
      },

    rep04:
      {
        candidates:
          9036,

        aliveGeometry:
          7786,

        observedHitCandidates:
          105
      },

    rep05:
      {
        candidates:
          7776,

        aliveGeometry:
          6651,

        observedHitCandidates:
          64
      }
  };


// ============================================================
// PATHS
// ============================================================

const SCRIPT123_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_static_physics_positive_raycast_validation_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_static_projectile_access_cross_replay_checkpoint_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_static_projectile_access_cross_replay_checkpoint_v01.md'
  );


// ============================================================
// LOAD SCRIPT123
// ============================================================

if (
  !existsSync(
    SCRIPT123_PATH
  )
) {

  throw new Error(
    `Missing Script123 output:\n${SCRIPT123_PATH}`
  );
}


const script123 =
  JSON.parse(
    readFileSync(
      SCRIPT123_PATH,
      'utf8'
    )
  );


if (
  script123?.status !==
  'DL_MIDTOWN_STATIC_PROJECTILE_RAYCAST_POSITIVE_CONTROL_READY'
) {

  throw new Error(
    `Script123 static raycast validation is not ready.\nStatus: ${script123?.status}`
  );
}


// ============================================================
// LOAD SCRIPT124 V02 SUMMARIES
// ============================================================

const replays =
  [];


for (
  const replayName
  of REPLAYS
) {

  const path =
    resolve(
      'output',
      replayName,
      'flying_soul_static_projectile_access_windows_summary_v02.json'
    );


  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing Script124 V02 summary for ${replayName}:\n${path}`
    );
  }


  const row =
    JSON.parse(
      readFileSync(
        path,
        'utf8'
      )
    );


  replays.push(
    {
      replay:
        replayName,

      path,

      summary:
        row
    }
  );
}


// ============================================================
// NORMALIZE REPLAY RESULTS
// ============================================================

const normalized =
  replays.map(
    ({
      replay,
      path,
      summary
    }) => {

      const expected =
        EXPECTED[
          replay
        ];


      const candidateRows =
        finite(
          summary
            ?.candidates
            ?.total
        );


      const aliveGeometry =
        finite(
          summary
            ?.coverage
            ?.priorAliveGeometryCandidates
        );


      const evaluatedCandidates =
        finite(
          summary
            ?.coverage
            ?.staticEvaluatedCandidates
        );


      const evaluatedTicks =
        finite(
          summary
            ?.coverage
            ?.staticEvaluatedTicks
        );


      const robustClearTicks =
        finite(
          summary
            ?.staticAccess
            ?.robustClearTicks
        );


      const robustBlockedTicks =
        finite(
          summary
            ?.staticAccess
            ?.robustBlockedTicks
        );


      const originSensitiveTicks =
        finite(
          summary
            ?.staticAccess
            ?.originSensitiveTicks
        );


      const everRobustClearCandidates =
        finite(
          summary
            ?.staticAccess
            ?.everRobustClearCandidates
        );


      const observedHitCandidates =
        finite(
          summary
            ?.positiveControls
            ?.observedHitCandidates
        );


      const hitCandidatesEverClear =
        finite(
          summary
            ?.positiveControls
            ?.everRobustClear
        );


      const hitCandidatesNeverClear =
        finite(
          summary
            ?.positiveControls
            ?.neverRobustClear
        );


      const tickAccounting =
        (
          robustClearTicks
          ??
          0
        )
        +
        (
          robustBlockedTicks
          ??
          0
        )
        +
        (
          originSensitiveTicks
          ??
          0
        );


      const checks =
        {
          script124StatusReady:
            check(
              summary?.status,
              'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_REPLAY_READY',
              summary?.status ===
              'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_WINDOWS_REPLAY_READY'
            ),


          script124ValidationPass:
            check(
              summary
                ?.validation
                ?.pass,
              true,
              summary
                ?.validation
                ?.pass ===
              true
            ),


          candidateCountPreserved:
            check(
              candidateRows,
              expected.candidates,
              candidateRows ===
              expected.candidates
            ),


          aliveGeometryCountPreserved:
            check(
              aliveGeometry,
              expected.aliveGeometry,
              aliveGeometry ===
              expected.aliveGeometry
            ),


          evaluatedAllAliveGeometryCandidates:
            check(
              evaluatedCandidates,
              expected.aliveGeometry,
              evaluatedCandidates ===
              expected.aliveGeometry
            ),


          successfulHitCandidateCountPreserved:
            check(
              observedHitCandidates,
              expected.observedHitCandidates,
              observedHitCandidates ===
              expected.observedHitCandidates
            ),


          tickClassesExhaustive:
            check(
              tickAccounting,
              evaluatedTicks,
              tickAccounting ===
              evaluatedTicks
            ),


          positiveHitAccountingExhaustive:
            check(
              (
                hitCandidatesEverClear
                ??
                0
              )
              +
              (
                hitCandidatesNeverClear
                ??
                0
              ),
              observedHitCandidates,
              (
                (
                  hitCandidatesEverClear
                  ??
                  0
                )
                +
                (
                  hitCandidatesNeverClear
                  ??
                  0
                )
              ) ===
              observedHitCandidates
            )
        };


      const pass =
        Object
          .values(
            checks
          )
          .every(
            row =>
              row.pass
          );


      return {
        replay,

        path,

        pass,

        status:
          summary?.status
          ??
          null,

        candidateRows,

        aliveGeometry,

        evaluatedCandidates,

        evaluatedCandidateCoverage:
          rate(
            evaluatedCandidates,
            aliveGeometry
          ),

        evaluatedTicks,

        robustClearTicks,

        robustClearTickRate:
          rate(
            robustClearTicks,
            evaluatedTicks
          ),

        robustBlockedTicks,

        robustBlockedTickRate:
          rate(
            robustBlockedTicks,
            evaluatedTicks
          ),

        originSensitiveTicks,

        originSensitiveTickRate:
          rate(
            originSensitiveTicks,
            evaluatedTicks
          ),

        everRobustClearCandidates,

        everRobustClearCandidateRate:
          rate(
            everRobustClearCandidates,
            evaluatedCandidates
          ),

        observedHitCandidates,

        hitCandidatesEverClear,

        hitCandidatesNeverClear,

        successfulHitEverClearRate:
          rate(
            hitCandidatesEverClear,
            observedHitCandidates
          ),

        checks
      };
    }
  );


// ============================================================
// POOLED COUNTS
// ============================================================

const pooled =
  {
    candidateRows:
      sum(
        normalized.map(
          row =>
            row.candidateRows
        )
      ),

    aliveGeometry:
      sum(
        normalized.map(
          row =>
            row.aliveGeometry
        )
      ),

    evaluatedCandidates:
      sum(
        normalized.map(
          row =>
            row.evaluatedCandidates
        )
      ),

    evaluatedTicks:
      sum(
        normalized.map(
          row =>
            row.evaluatedTicks
        )
      ),

    robustClearTicks:
      sum(
        normalized.map(
          row =>
            row.robustClearTicks
        )
      ),

    robustBlockedTicks:
      sum(
        normalized.map(
          row =>
            row.robustBlockedTicks
        )
      ),

    originSensitiveTicks:
      sum(
        normalized.map(
          row =>
            row.originSensitiveTicks
        )
      ),

    everRobustClearCandidates:
      sum(
        normalized.map(
          row =>
            row.everRobustClearCandidates
        )
      ),

    observedHitCandidates:
      sum(
        normalized.map(
          row =>
            row.observedHitCandidates
        )
      ),

    hitCandidatesEverClear:
      sum(
        normalized.map(
          row =>
            row.hitCandidatesEverClear
        )
      ),

    hitCandidatesNeverClear:
      sum(
        normalized.map(
          row =>
            row.hitCandidatesNeverClear
        )
      )
  };


pooled.evaluatedCandidateCoverage =
  rate(
    pooled.evaluatedCandidates,
    pooled.aliveGeometry
  );


pooled.robustClearTickRate =
  rate(
    pooled.robustClearTicks,
    pooled.evaluatedTicks
  );


pooled.robustBlockedTickRate =
  rate(
    pooled.robustBlockedTicks,
    pooled.evaluatedTicks
  );


pooled.originSensitiveTickRate =
  rate(
    pooled.originSensitiveTicks,
    pooled.evaluatedTicks
  );


pooled.everRobustClearCandidateRate =
  rate(
    pooled.everRobustClearCandidates,
    pooled.evaluatedCandidates
  );


pooled.successfulHitEverClearRate =
  rate(
    pooled.hitCandidatesEverClear,
    pooled.observedHitCandidates
  );


// ============================================================
// REPLICATION RANGE
// ============================================================

const replication =
  {
    robustClearTickRate:
      summarizeRates(
        normalized.map(
          row =>
            row.robustClearTickRate
        )
      ),

    robustBlockedTickRate:
      summarizeRates(
        normalized.map(
          row =>
            row.robustBlockedTickRate
        )
      ),

    originSensitiveTickRate:
      summarizeRates(
        normalized.map(
          row =>
            row.originSensitiveTickRate
        )
      ),

    everRobustClearCandidateRate:
      summarizeRates(
        normalized.map(
          row =>
            row.everRobustClearCandidateRate
        )
      ),

    successfulHitEverClearRate:
      summarizeRates(
        normalized.map(
          row =>
            row.successfulHitEverClearRate
        )
      )
  };


// ============================================================
// CROSS-REPLAY CHECKS
// ============================================================

const expectedTotals =
  {
    candidateRows:
      sum(
        Object
          .values(
            EXPECTED
          )
          .map(
            row =>
              row.candidates
          )
      ),

    aliveGeometry:
      sum(
        Object
          .values(
            EXPECTED
          )
          .map(
            row =>
              row.aliveGeometry
          )
      ),

    observedHitCandidates:
      sum(
        Object
          .values(
            EXPECTED
          )
          .map(
            row =>
              row.observedHitCandidates
          )
      )
  };


const crossReplayChecks =
  {
    fiveReplaySummariesLoaded:
      check(
        normalized.length,
        5,
        normalized.length ===
        5
      ),


    everyReplayCheckpointPass:
      check(
        normalized.filter(
          row =>
            row.pass
        ).length,
        5,
        normalized.every(
          row =>
            row.pass
        )
      ),


    candidateCohortPreserved:
      check(
        pooled.candidateRows,
        expectedTotals.candidateRows,
        pooled.candidateRows ===
        expectedTotals.candidateRows
      ),


    aliveGeometryCohortPreserved:
      check(
        pooled.aliveGeometry,
        expectedTotals.aliveGeometry,
        pooled.aliveGeometry ===
        expectedTotals.aliveGeometry
      ),


    allAliveGeometryStaticEvaluated:
      check(
        pooled.evaluatedCandidates,
        pooled.aliveGeometry,
        pooled.evaluatedCandidates ===
        pooled.aliveGeometry
      ),


    successfulHitCohortPreserved:
      check(
        pooled.observedHitCandidates,
        expectedTotals.observedHitCandidates,
        pooled.observedHitCandidates ===
        expectedTotals.observedHitCandidates
      ),


    pooledTickAccountingExhaustive:
      check(
        pooled.robustClearTicks
        +
        pooled.robustBlockedTicks
        +
        pooled.originSensitiveTicks,
        pooled.evaluatedTicks,
        pooled.robustClearTicks
        +
        pooled.robustBlockedTicks
        +
        pooled.originSensitiveTicks ===
        pooled.evaluatedTicks
      ),


    pooledSuccessfulHitAccountingExhaustive:
      check(
        pooled.hitCandidatesEverClear
        +
        pooled.hitCandidatesNeverClear,
        pooled.observedHitCandidates,
        pooled.hitCandidatesEverClear
        +
        pooled.hitCandidatesNeverClear ===
        pooled.observedHitCandidates
      )
  };


const crossReplayPass =
  Object
    .values(
      crossReplayChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// STATUS
// ============================================================

const status =
  crossReplayPass
    ? 'FLYING_SOUL_STATIC_PROJECTILE_ACCESS_CROSS_REPLAY_FROZEN'
    : 'STATIC_PROJECTILE_ACCESS_CROSS_REPLAY_CHECKPOINT_FAILURE';


const nextStage =
  crossReplayPass
    ? 'DYNAMIC_OCCLUDER_STATE_EXTRACTION_AND_VISUAL_PROJECTILE_ACCESS_SEPARATION'
    : 'DIAGNOSE_STATIC_PROJECTILE_ACCESS_CHECKPOINT_FAILURE';


// ============================================================
// SUMMARY
// ============================================================

const summary =
  {
    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    status,

    scope:
      {
        replays:
          REPLAYS,

        map:
          'dl_midtown',

        staticCollisionValidatedBy:
          'Script123',

        exhaustiveReplayWindowsBuiltBy:
          'Script124 V02',

        rawReplayParsing:
          false,

        raycasting:
          false
      },

    inheritedStaticModel:
      {
        physicsGlbPath:
          script123?.map?.physicsGlbPath
          ??
          null,

        mapVpkSha256:
          script123?.map?.vpkSha256
          ??
          null,

        worldPhysicsSha256:
          script123?.map?.worldPhysicsSha256
          ??
          null,

        primaryFilter:
          script123
            ?.positiveControls
            ?.primary
            ?.filter
          ??
          'BULLET_SOLID_CANDIDATE',

        primaryScript123OriginProbeHU:
          script123
            ?.positiveControls
            ?.primary
            ?.zOffsetHU
          ??
          64,

        script124OriginProbesHU:
          [
            64,
            80
          ],

        script123PositiveControl:
          script123
            ?.positiveControls
            ?.primary
          ??
          null
      },

    expectedInheritedCohort:
      EXPECTED,

    replayResults:
      normalized,

    pooled,

    replication,

    crossReplayValidation:
      {
        pass:
          crossReplayPass,

        checks:
          crossReplayChecks
      },

    interpretation:
      {
        replicatedFinding:
          'Static Midtown projectile obstruction is strongly replicated as an important accessibility constraint across the five replay cohort.',

        denominatorEffect:
          'Only approximately one quarter of alive-geometry player×soul candidates ever exhibit a robustly clear static projectile path during their analyzed window.',

        originSensitivity:
          'Disagreement between the Z+64 and Z+80 firing-origin probes is rare relative to static blocking, indicating that static-world geometry dominates this particular uncertainty source.',

        positiveControl:
          'Observed successful hitters almost always have at least one robustly clear static path before their first observed hit. Remaining contradictions are retained rather than discarded.',

        staticClearLimit:
          'ROBUST_STATIC_CLEAR does not establish visual visibility, dynamic-world clearance, weapon readiness, temporal reachability, attention, attempt, or actionable opportunity.',

        staticBlockedLimit:
          'ROBUST_STATIC_BLOCKED is an operational classification against the frozen static Midtown physics substrate, not a claim of exact engine projectile collision in every circumstance.',

        branchStatus:
          'Static projectile access is operationally frozen for the current five-replay Midtown cohort. Reopen only for contradiction, map/physics version drift, or a materially better firing-origin/collision model.'
      },

    nextStage,

    outputs:
      {
        json:
          OUTPUT_JSON_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE
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
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'STATIC PROJECTILE ACCESS CROSS-REPLAY CHECKPOINT'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'REPLAY RESULTS'
);

console.log(
  '--------------'
);


for (
  const row
  of normalized
) {

  console.log(
    `${row.replay.padEnd(8)} ` +
    `cand=${String(row.candidateRows).padEnd(6)} ` +
    `clear=${formatPercent(row.robustClearTickRate).padEnd(8)} ` +
    `blocked=${formatPercent(row.robustBlockedTickRate).padEnd(8)} ` +
    `originSens=${formatPercent(row.originSensitiveTickRate).padEnd(8)} ` +
    `everClear=${formatPercent(row.everRobustClearCandidateRate).padEnd(8)} ` +
    `hitClear=${formatPercent(row.successfulHitEverClearRate).padEnd(8)} ` +
    `pass=${row.pass}`
  );
}


console.log('');

console.log(
  'POOLED'
);

console.log(
  '------'
);


console.log(
  `Candidate rows:                  ${pooled.candidateRows}`
);

console.log(
  `Alive-geometry candidates:       ${pooled.aliveGeometry}`
);

console.log(
  `Static-evaluated candidates:     ${pooled.evaluatedCandidates} (${formatPercent(pooled.evaluatedCandidateCoverage)})`
);

console.log(
  `Evaluated ticks:                 ${pooled.evaluatedTicks}`
);

console.log(
  `Robust-clear ticks:              ${pooled.robustClearTicks} (${formatPercent(pooled.robustClearTickRate)})`
);

console.log(
  `Robust-blocked ticks:            ${pooled.robustBlockedTicks} (${formatPercent(pooled.robustBlockedTickRate)})`
);

console.log(
  `Origin-sensitive ticks:          ${pooled.originSensitiveTicks} (${formatPercent(pooled.originSensitiveTickRate)})`
);

console.log(
  `Candidates ever robust clear:    ${pooled.everRobustClearCandidates}/${pooled.evaluatedCandidates} (${formatPercent(pooled.everRobustClearCandidateRate)})`
);

console.log(
  `Successful-hit candidates clear: ${pooled.hitCandidatesEverClear}/${pooled.observedHitCandidates} (${formatPercent(pooled.successfulHitEverClearRate)})`
);

console.log(
  `Successful-hit contradictions:   ${pooled.hitCandidatesNeverClear}`
);

console.log('');

console.log(
  'REPLICATION RANGES'
);

console.log(
  '------------------'
);


console.log(
  `Robust clear:       ${formatRateRange(replication.robustClearTickRate)}`
);

console.log(
  `Robust blocked:     ${formatRateRange(replication.robustBlockedTickRate)}`
);

console.log(
  `Origin sensitive:   ${formatRateRange(replication.originSensitiveTickRate)}`
);

console.log(
  `Candidate ever clear:${formatRateRange(replication.everRobustClearCandidateRate)}`
);

console.log(
  `Hit ever clear:     ${formatRateRange(replication.successfulHitEverClearRate)}`
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
    crossReplayChecks
  )
) {

  console.log(
    `${name.padEnd(48)} ${row.pass}`
  );
}


console.log('');

console.log(
  'FINAL STATUS'
);

console.log(
  '------------'
);

console.log(
  status
);

console.log('');

console.log(
  'NEXT STAGE'
);

console.log(
  '----------'
);

console.log(
  nextStage
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
// HELPERS
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


function sum(
  values
) {

  let total =
    0;


  for (
    const value
    of values
  ) {

    if (
      Number.isFinite(
        value
      )
    ) {

      total +=
        value;
    }
  }


  return total;
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


function summarizeRates(
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
      ]
  };
}


function quantile(
  sorted,
  proportion
) {

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
    ) *
    proportion;


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


  return sorted[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    sorted[
      upper
    ] *
    weight;
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


function formatRateRange(
  row
) {

  if (
    !row
    ||
    row.count ===
    0
  ) {

    return 'n/a';
  }


  return `${formatPercent(row.min)} .. ${formatPercent(row.max)} (median ${formatPercent(row.median)})`;
}


function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Flying-Soul Static Projectile Access Cross-Replay Checkpoint'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Pooled five-replay result'
  );

  lines.push('');

  lines.push(
    `- Candidate rows: ${summary.pooled.candidateRows}`
  );

  lines.push(
    `- Alive-geometry candidates: ${summary.pooled.aliveGeometry}`
  );

  lines.push(
    `- Static evaluated: ${formatPercent(summary.pooled.evaluatedCandidateCoverage)}`
  );

  lines.push(
    `- Evaluated ticks: ${summary.pooled.evaluatedTicks}`
  );

  lines.push(
    `- Robust static clear: ${summary.pooled.robustClearTicks} (${formatPercent(summary.pooled.robustClearTickRate)})`
  );

  lines.push(
    `- Robust static blocked: ${summary.pooled.robustBlockedTicks} (${formatPercent(summary.pooled.robustBlockedTickRate)})`
  );

  lines.push(
    `- Origin-sensitive: ${summary.pooled.originSensitiveTicks} (${formatPercent(summary.pooled.originSensitiveTickRate)})`
  );

  lines.push(
    `- Candidates ever robust clear: ${summary.pooled.everRobustClearCandidates}/${summary.pooled.evaluatedCandidates} (${formatPercent(summary.pooled.everRobustClearCandidateRate)})`
  );

  lines.push(
    `- Observed successful-hit candidates ever robust clear: ${summary.pooled.hitCandidatesEverClear}/${summary.pooled.observedHitCandidates} (${formatPercent(summary.pooled.successfulHitEverClearRate)})`
  );

  lines.push('');

  lines.push(
    '## Replay replication'
  );

  lines.push('');


  for (
    const row
    of summary.replayResults
  ) {

    lines.push(
      `- **${row.replay}:** clear=${formatPercent(row.robustClearTickRate)}, blocked=${formatPercent(row.robustBlockedTickRate)}, origin-sensitive=${formatPercent(row.originSensitiveTickRate)}, ever-clear=${formatPercent(row.everRobustClearCandidateRate)}, successful-hit-ever-clear=${formatPercent(row.successfulHitEverClearRate)}`
    );
  }


  lines.push('');

  lines.push(
    '## Interpretation'
  );

  lines.push('');

  lines.push(
    'Static projectile access is operationally frozen for the current five-replay Midtown cohort. This layer represents static-world projectile obstruction only.'
  );

  lines.push('');

  lines.push(
    '`ROBUST_STATIC_CLEAR` does not establish visual visibility, dynamic-world clearance, weapon readiness, temporal reachability, response attempt, or actionable opportunity.'
  );

  lines.push('');

  lines.push(
    '## Next stage'
  );

  lines.push('');

  lines.push(
    summary.nextStage
  );

  lines.push('');


  return lines.join(
    '\n'
  );
}