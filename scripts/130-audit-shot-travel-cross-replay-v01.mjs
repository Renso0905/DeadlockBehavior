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
  'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_V01';


// ============================================================
// PURPOSE
//
// Script128 fitted hero-grouped latent timing-distance models:
//
//   latencyTicks
//     ~= fixedDelayTicks
//        + distanceHU * 64 / fittedSpeed
//
// It also generated leave-one-replay-out folds.
//
// IMPORTANT UPDATE:
//
// We now explicitly know that item/loadout state may modify:
//
//   - fire rate
//   - projectile / bullet velocity
//
// Therefore this audit DOES NOT interpret one pooled hero speed
// as an intrinsic hero constant.
//
// Instead it asks two different questions:
//
//   1. Does timing-distance structure GENERALIZE to held-out
//      replay observations?
//
//   2. Are fitted parameters stable across folds, or do they
//      vary enough that time-varying weapon/modifier state
//      should be investigated?
//
// Parameter variability is NOT automatically model failure.
//
// Hero display names come from Script129 V05.
//
// No replay parsing.
// No model refitting.
// No opportunity classification.
// No canonical projectile-speed claims.
// ============================================================


// ============================================================
// INPUTS
// ============================================================

const SCRIPT128_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_specific_shot_travel_candidate_models_v01.json'
  );


const HERO_MAP_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v05.json'
  );


// ============================================================
// OUTPUTS
// ============================================================

const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'shot_travel_cross_replay_audit_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'shot_travel_cross_replay_audit_v01.md'
  );


// ============================================================
// OPERATIONAL AUDIT THRESHOLDS
//
// These are project-level evidence thresholds.
// They are NOT game mechanics.
// ============================================================

const THRESHOLDS =
  {
    minimumAvailableFolds:
      2,

    maximumHeldOutMedianResidualTicks:
      1.5,

    minimumHeldOutWithinOneTickRate:
      0.70,

    minimumHeldOutWithinTwoTickRate:
      0.90,

    stableSpeedRangeRatio:
      1.50,

    stableDelayRangeTicks:
      1.00,

    highSpeedBoundaryHUPerSecond:
      72000
  };


// ============================================================
// GUARDS
// ============================================================

if (
  !existsSync(
    SCRIPT128_PATH
  )
) {

  throw new Error(
    `Missing Script128 summary:\n${SCRIPT128_PATH}`
  );
}


if (
  !existsSync(
    HERO_MAP_PATH
  )
) {

  throw new Error(
    `Missing Script129 V05 hero map:\n${HERO_MAP_PATH}`
  );
}


// ============================================================
// LOAD
// ============================================================

const script128 =
  JSON.parse(
    readFileSync(
      SCRIPT128_PATH,
      'utf8'
    )
  );


const heroMap =
  JSON.parse(
    readFileSync(
      HERO_MAP_PATH,
      'utf8'
    )
  );


if (
  script128?.status !==
  'HERO_SPECIFIC_SHOT_TRAVEL_CANDIDATE_MODELS_READY_FOR_INTERPRETATION'
) {

  throw new Error(
    `Script128 is not ready. Status=${script128?.status}`
  );
}


if (
  heroMap?.status !==
  'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY'
) {

  throw new Error(
    `Hero display-name map is not ready. Status=${heroMap?.status}`
  );
}


// ============================================================
// HERO LOOKUPS
// ============================================================

const displayNameByHeroId =
  heroMap.heroIdToDisplayName
  ??
  {};


const internalKeyByHeroId =
  heroMap.heroIdToInternalKey
  ??
  {};


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'SHOT TRAVEL CROSS-REPLAY AUDIT V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'Travel substrate:       Script128'
);

console.log(
  'Hero names:             Script129 V05'
);

console.log(
  'Replay parsing:         NONE'
);

console.log(
  'Model refitting:        NONE'
);

console.log(
  'Item-state assumption:  MAY MODIFY FIRE RATE / VELOCITY'
);

console.log(
  'Hero-fixed speed claim: NO'
);

console.log('');


// ============================================================
// AUDIT HEROES
// ============================================================

const heroAudits =
  (
    script128.heroModels
    ??
    []
  )
    .map(
      auditHero
    )
    .sort(
      (
        a,
        b
      ) =>
        b.hits -
        a.hits
        ||
        a.heroId -
        b.heroId
    );


// ============================================================
// AGGREGATE CLASSIFICATION COUNTS
// ============================================================

const classificationCounts =
  countBy(
    heroAudits,
    row =>
      row.auditClassification
  );


const multiReplayModeled =
  heroAudits.filter(
    row =>
      row.replayCount >=
      2
      &&
      row.pooledModelAvailable
  );


const timingGeneralizes =
  heroAudits.filter(
    row =>
      row.crossReplayTimingGeneralizes ===
      true
  );


const timingGeneralizesParameterStable =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT'
  );


const timingGeneralizesParameterVariable =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_VARIABLE'
  );


const highSpeedGeneralizes =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'CROSS_REPLAY_HIGH_SPEED_TIMING_GENERALIZES_EXACT_SPEED_UNRESOLVED'
  );


const doesNotGeneralize =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY'
  );


// ============================================================
// INTEGRITY
// ============================================================

const integrityChecks =
  {
    successfulHitCohortPreserved:
      check(
        finite(
          script128
            ?.scope
            ?.successfulHitCohort
        ),
        529,
        finite(
          script128
            ?.scope
            ?.successfulHitCohort
        ) ===
        529
      ),


    heroIdentityReady:
      check(
        heroMap.status,
        'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY',
        heroMap.status ===
        'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY'
      ),


    heroAuditsAvailable:
      check(
        heroAudits.length,
        '>0',
        heroAudits.length >
        0
      ),


    multiReplayModelsAvailable:
      check(
        multiReplayModeled.length,
        '>0',
        multiReplayModeled.length >
        0
      ),


    leaveOneReplayOutEvidenceAvailable:
      check(
        heroAudits.filter(
          row =>
            row.availableFoldCount >
            0
        ).length,
        '>0',
        heroAudits.some(
          row =>
            row.availableFoldCount >
            0
        )
      )
  };


const integrityPass =
  Object
    .values(
      integrityChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// FINAL STATUS
// ============================================================

const status =
  integrityPass
    ? 'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_READY'
    : 'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_INTEGRITY_FAILURE';


const nextStage =
  integrityPass
    ? 'DISCOVER_TIME_VARYING_EFFECTIVE_WEAPON_FIRE_RATE_PROJECTILE_VELOCITY_AND_MODIFIER_STATE'
    : 'DIAGNOSE_SCRIPT128_CROSS_REPLAY_OUTPUT';


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

    inputs:
      {
        script128:
          SCRIPT128_PATH,

        heroMap:
          HERO_MAP_PATH
      },

    thresholds:
      THRESHOLDS,

    scope:
      {
        successfulHitCohort:
          script128
            ?.scope
            ?.successfulHitCohort
          ??
          null,

        heroModels:
          heroAudits.length,

        multiReplayModeledHeroes:
          multiReplayModeled.length
      },

    aggregate:
      {
        timingGeneralizes:
          timingGeneralizes.length,

        timingGeneralizesParametersStableInCohort:
          timingGeneralizesParameterStable.length,

        timingGeneralizesParametersVariable:
          timingGeneralizesParameterVariable.length,

        highSpeedTimingGeneralizesExactSpeedUnresolved:
          highSpeedGeneralizes.length,

        timingDoesNotGeneralizeCleanly:
          doesNotGeneralize.length,

        classificationCounts
      },

    integrity:
      {
        pass:
          integrityPass,

        checks:
          integrityChecks
      },

    heroAudits,

    interpretation:
      {
        keyDistinction:
          'Cross-replay timing generalization and exact parameter stability are separate questions.',

        itemModifierGuardrail:
          'Fire-rate and projectile-velocity modifiers may change during a match. Fold-to-fold parameter variation may therefore reflect real loadout/state differences rather than failure of the distance-time relationship.',

        pooledSpeedGuardrail:
          'Script128 fitted speeds remain empirical mixture parameters for the represented observations. They are not intrinsic hero constants.',

        stableParameterMeaning:
          'Parameters stable in the current cohort means only that the fitted folds happened to be similar across these observations. It does not establish that items cannot modify them.',

        variableParameterMeaning:
          'Timing generalization with variable parameters is especially important evidence for investigating time-varying weapon/item state.',

        behavioralGuardrail:
          'Mechanical reachability is still below attention, attempt, and response in the behavioral hierarchy.'
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

console.log(
  'HERO CROSS-REPLAY AUDIT'
);

console.log(
  '-----------------------'
);


for (
  const row
  of heroAudits
) {

  const label =
    `${row.displayName} (${row.heroId})`;


  if (
    !row.pooledModelAvailable
  ) {

    console.log(
      `${label.padEnd(28)} ` +
      `hits=${String(row.hits).padEnd(4)} ` +
      `replays=${String(row.replayCount).padEnd(2)} ` +
      `audit=${row.auditClassification}`
    );

    continue;
  }


  console.log(
    `${label.padEnd(28)} ` +
    `hits=${String(row.hits).padEnd(4)} ` +
    `replays=${String(row.replayCount).padEnd(2)} ` +
    `poolSpeed=${formatNumber(row.pooled.speedHUPerSecond).padEnd(10)} ` +
    `folds=${String(row.availableFoldCount).padEnd(2)} ` +
    `foldSpeed=${formatRange(row.foldTrainingSpeedHUPerSecond).padEnd(23)} ` +
    `heldMed=${formatNumber(row.heldOutMedianResidualTicks.median).padEnd(6)} ` +
    `W1=${formatPercent(row.heldOutWithinOneTickRate.median).padEnd(8)} ` +
    `W2=${formatPercent(row.heldOutWithinTwoTickRate.median).padEnd(8)} ` +
    `audit=${row.auditClassification}`
  );
}


console.log('');

console.log(
  'CLASSIFICATION COUNTS'
);

console.log(
  '---------------------'
);


for (
  const [
    name,
    count
  ]
  of Object.entries(
    classificationCounts
  )
) {

  console.log(
    `${name.padEnd(70)} ${count}`
  );
}


console.log('');

console.log(
  'INTEGRITY'
);

console.log(
  '---------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    integrityChecks
  )
) {

  console.log(
    `${name.padEnd(44)} ${row.pass} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
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
// HERO AUDIT
// ============================================================

function auditHero(
  row
) {

  const heroId =
    finite(
      row.heroId
    );


  const displayName =
    displayNameByHeroId[
      String(
        heroId
      )
    ]
    ??
    `UNKNOWN HERO`;


  const internalKey =
    internalKeyByHeroId[
      String(
        heroId
      )
    ]
    ??
    null;


  const hits =
    finite(
      row.hits
    )
    ??
    0;


  const replayCount =
    finite(
      row.replayCount
    )
    ??
    0;


  const script128Status =
    row.status
    ??
    'UNKNOWN';


  const pooledModelAvailable =
    Boolean(
      row.fittedModel
    );


  const pooled =
    pooledModelAvailable
      ? {
          speedHUPerSecond:
            finite(
              row
                ?.fittedModel
                ?.speedHUPerSecond
            ),

          fixedDelayTicks:
            finite(
              row
                ?.fittedModel
                ?.fixedDelayTicks
            ),

          medianResidualTicks:
            finite(
              row
                ?.assignments
                ?.residualTicks
                ?.median
            ),

          p75ResidualTicks:
            finite(
              row
                ?.assignments
                ?.residualTicks
                ?.p75
            ),

          nearestAssignedRate:
            finite(
              row
                ?.assignments
                ?.assignedNearestShotRate
            )
        }
      : null;


  const folds =
    Array.isArray(
      row
        ?.leaveOneReplayOut
        ?.folds
    )
      ? row
          .leaveOneReplayOut
          .folds
      : [];


  const availableFolds =
    folds.filter(
      fold =>
        fold?.available ===
        true
    );


  const foldSpeeds =
    availableFolds
      .map(
        fold =>
          finite(
            fold
              ?.trainedModel
              ?.speedHUPerSecond
          )
      )
      .filter(
        Number.isFinite
      );


  const foldDelays =
    availableFolds
      .map(
        fold =>
          finite(
            fold
              ?.trainedModel
              ?.fixedDelayTicks
          )
      )
      .filter(
        Number.isFinite
      );


  const heldOutMedianResiduals =
    availableFolds
      .map(
        fold =>
          finite(
            fold
              ?.heldOutResidualTicks
              ?.median
          )
      )
      .filter(
        Number.isFinite
      );


  const heldOutWithinOneRates =
    availableFolds
      .map(
        fold =>
          finite(
            fold
              ?.heldOutWithinOneTickRate
          )
      )
      .filter(
        Number.isFinite
      );


  const heldOutWithinTwoRates =
    availableFolds
      .map(
        fold =>
          finite(
            fold
              ?.heldOutWithinTwoTickRate
          )
      )
      .filter(
        Number.isFinite
      );


  const foldTrainingSpeedHUPerSecond =
    summarizeNumbers(
      foldSpeeds
    );


  const foldTrainingFixedDelayTicks =
    summarizeNumbers(
      foldDelays
    );


  const heldOutMedianResidualTicks =
    summarizeNumbers(
      heldOutMedianResiduals
    );


  const heldOutWithinOneTickRate =
    summarizeNumbers(
      heldOutWithinOneRates
    );


  const heldOutWithinTwoTickRate =
    summarizeNumbers(
      heldOutWithinTwoRates
    );


  const availableFoldCount =
    availableFolds.length;


  const enoughFolds =
    availableFoldCount >=
    THRESHOLDS.minimumAvailableFolds;


  const everyFoldResidualAcceptable =
    enoughFolds
    &&
    heldOutMedianResiduals.length ===
    availableFoldCount
    &&
    heldOutMedianResiduals.every(
      value =>
        value <=
        THRESHOLDS.maximumHeldOutMedianResidualTicks
    );


  const everyFoldWithinTwoAcceptable =
    enoughFolds
    &&
    heldOutWithinTwoRates.length ===
    availableFoldCount
    &&
    heldOutWithinTwoRates.every(
      value =>
        value >=
        THRESHOLDS.minimumHeldOutWithinTwoTickRate
    );


  const crossReplayTimingGeneralizes =
    enoughFolds
    &&
    everyFoldResidualAcceptable
    &&
    everyFoldWithinTwoAcceptable;


  const speedRangeRatio =
    calculateRangeRatio(
      foldSpeeds
    );


  const delayRangeTicks =
    calculateRange(
      foldDelays
    );


  const parameterStableInCohort =
    enoughFolds
    &&
    Number.isFinite(
      speedRangeRatio
    )
    &&
    speedRangeRatio <=
    THRESHOLDS.stableSpeedRangeRatio
    &&
    Number.isFinite(
      delayRangeTicks
    )
    &&
    delayRangeTicks <=
    THRESHOLDS.stableDelayRangeTicks;


  const pooledHighSpeed =
    Number.isFinite(
      pooled?.speedHUPerSecond
    )
    &&
    pooled.speedHUPerSecond >=
    THRESHOLDS.highSpeedBoundaryHUPerSecond;


  const foldHighSpeedCount =
    foldSpeeds.filter(
      value =>
        value >=
        THRESHOLDS.highSpeedBoundaryHUPerSecond
    ).length;


  const auditClassification =
    classifyAudit({
      script128Status,

      replayCount,

      pooledModelAvailable,

      enoughFolds,

      crossReplayTimingGeneralizes,

      parameterStableInCohort,

      pooledHighSpeed
    });


  return {
    heroId,

    displayName,

    internalKey,

    hits,

    modeledHits:
      finite(
        row.modeledHits
      )
      ??
      null,

    replayCount,

    replays:
      Array.isArray(
        row.replays
      )
        ? row.replays
        : [],

    script128Status,

    pooledModelAvailable,

    pooled,

    availableFoldCount,

    totalFoldCount:
      folds.length,

    foldTrainingSpeedHUPerSecond,

    foldTrainingFixedDelayTicks,

    speedRangeRatio,

    delayRangeTicks,

    foldHighSpeedCount,

    heldOutMedianResidualTicks,

    heldOutWithinOneTickRate,

    heldOutWithinTwoTickRate,

    diagnostics:
      {
        enoughFolds,

        everyFoldResidualAcceptable,

        everyFoldWithinTwoAcceptable,

        parameterStableInCohort,

        pooledHighSpeed
      },

    crossReplayTimingGeneralizes,

    auditClassification,

    folds:
      availableFolds.map(
        fold => ({
          heldOutReplay:
            fold.heldOutReplay,

          trainingHits:
            fold.trainingHits,

          testHits:
            fold.testHits,

          trainedSpeedHUPerSecond:
            finite(
              fold
                ?.trainedModel
                ?.speedHUPerSecond
            ),

          trainedFixedDelayTicks:
            finite(
              fold
                ?.trainedModel
                ?.fixedDelayTicks
            ),

          heldOutMedianResidualTicks:
            finite(
              fold
                ?.heldOutResidualTicks
                ?.median
            ),

          heldOutP75ResidualTicks:
            finite(
              fold
                ?.heldOutResidualTicks
                ?.p75
            ),

          heldOutWithinOneTickRate:
            finite(
              fold
                ?.heldOutWithinOneTickRate
            ),

          heldOutWithinTwoTickRate:
            finite(
              fold
                ?.heldOutWithinTwoTickRate
            )
        })
      )
  };
}


// ============================================================
// CLASSIFICATION
// ============================================================

function classifyAudit({
  script128Status,
  replayCount,
  pooledModelAvailable,
  enoughFolds,
  crossReplayTimingGeneralizes,
  parameterStableInCohort,
  pooledHighSpeed
}) {

  if (
    !pooledModelAvailable
    ||
    script128Status ===
    'INSUFFICIENT_HITS_FOR_MODEL'
  ) {

    return 'INSUFFICIENT_FOR_TRAVEL_MODEL';
  }


  if (
    script128Status ===
    'MODEL_WEAK_OR_UNRESOLVED'
  ) {

    return replayCount >=
      2
      ? 'CROSS_REPLAY_MODEL_WEAK_OR_UNRESOLVED'
      : 'SINGLE_REPLAY_MODEL_WEAK_OR_UNRESOLVED';
  }


  if (
    replayCount <
    2
    ||
    !enoughFolds
  ) {

    if (
      pooledHighSpeed
      ||
      script128Status ===
      'HIGH_SPEED_TIMING_RESOLUTION_LIMITED'
    ) {

      return 'SINGLE_REPLAY_HIGH_SPEED_TIMING_ONLY';
    }


    return 'SINGLE_REPLAY_FINITE_MODEL_PROVISIONAL';
  }


  if (
    pooledHighSpeed
    ||
    script128Status ===
    'HIGH_SPEED_TIMING_RESOLUTION_LIMITED'
  ) {

    return crossReplayTimingGeneralizes
      ? 'CROSS_REPLAY_HIGH_SPEED_TIMING_GENERALIZES_EXACT_SPEED_UNRESOLVED'
      : 'CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY';
  }


  if (
    crossReplayTimingGeneralizes
    &&
    parameterStableInCohort
  ) {

    return 'CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT';
  }


  if (
    crossReplayTimingGeneralizes
  ) {

    return 'CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_VARIABLE';
  }


  return 'CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY';
}


// ============================================================
// NUMERIC HELPERS
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


function calculateRangeRatio(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    clean.length <
    2
  ) {

    return null;
  }


  const minimum =
    Math.min(
      ...clean
    );


  const maximum =
    Math.max(
      ...clean
    );


  if (
    minimum <=
    0
  ) {

    return null;
  }


  return maximum /
    minimum;
}


function calculateRange(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    clean.length <
    2
  ) {

    return null;
  }


  return Math.max(
    ...clean
  ) -
  Math.min(
    ...clean
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

      p25:
        null,

      median:
        null,

      p75:
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

    p25:
      quantile(
        clean,
        0.25
      ),

    median:
      quantile(
        clean,
        0.5
      ),

    p75:
      quantile(
        clean,
        0.75
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
  p
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
    p;


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


// ============================================================
// COLLECTION HELPERS
// ============================================================

function countBy(
  rows,
  selector
) {

  const counts =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      selector(
        row
      );


    counts.set(
      key,
      (
        counts.get(
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
      ...counts.entries()
    ]
      .sort(
        (
          a,
          b
        ) =>
          b[1] -
          a[1]
          ||
          String(
            a[0]
          ).localeCompare(
            String(
              b[0]
            )
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


// ============================================================
// FORMAT HELPERS
// ============================================================

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


function formatRange(
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


  return (
    `${formatNumber(row.min)}..${formatNumber(row.max)}`
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
    '# Shot Travel Cross-Replay Audit V01'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Important interpretation change'
  );

  lines.push('');

  lines.push(
    'Projectile velocity and fire rate may vary with items or other modifier state. Therefore pooled Script128 hero speeds are not treated as intrinsic hero constants.'
  );

  lines.push('');

  lines.push(
    'This audit separates cross-replay timing generalization from fitted-parameter stability.'
  );

  lines.push('');

  lines.push(
    '## Hero audits'
  );

  lines.push('');


  for (
    const row
    of summary.heroAudits
  ) {

    lines.push(
      `- **${row.displayName} (${row.heroId})** — hits=${row.hits}, replays=${row.replayCount}, classification=${row.auditClassification}`
    );
  }


  lines.push('');

  lines.push(
    '## Guardrails'
  );

  lines.push('');

  lines.push(
    '- Parameter variability is not automatically model failure.'
  );

  lines.push(
    '- Stable parameters in this cohort do not imply that items cannot modify the weapon.'
  );

  lines.push(
    '- No fitted speed is yet approved for the final actionable-opportunity denominator.'
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