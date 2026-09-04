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
  'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_V02';


// ============================================================
// PURPOSE
//
// Script130 V01 contained an audit-classification bug.
//
// It required:
//
//   heldOutWithinTwoTickRate
//
// to classify cross-replay timing generalization.
//
// The Script128 output available in this cohort does NOT contain
// that metric in its held-out fold rows, so V01 printed:
//
//   W2=n/a
//
// and consequently forced every otherwise eligible multi-replay
// hero into:
//
//   CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY
//
// V02 corrects that.
//
// Cross-replay timing generalization is now evaluated using the
// diagnostics that ACTUALLY EXIST in Script128:
//
//   1. held-out median residual ticks
//   2. held-out within-one-tick rate
//
// heldOutWithinTwoTickRate remains OPTIONAL if present.
//
// V02 also fixes a semantic classification issue:
//
// A hero represented in multiple replays but having only one
// usable leave-one-replay-out fold is NOT called "single replay."
//
// Instead:
//
//   MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS
//
// IMPORTANT ITEM/MODIFIER GUARDRAIL:
//
// Fire rate and projectile velocity may vary with item/loadout
// state.
//
// Therefore:
//
//   - timing generalization
//   - fitted parameter stability
//
// remain separate questions.
//
// A parameter-variable model can still have excellent predictive
// timing structure.
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
    'shot_travel_cross_replay_audit_v02.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'shot_travel_cross_replay_audit_v02.md'
  );


// ============================================================
// OPERATIONAL AUDIT THRESHOLDS
//
// These are project-level evidence thresholds.
//
// They are NOT Deadlock engine constants.
// ============================================================

const THRESHOLDS =
  {
    minimumAvailableFolds:
      2,

    maximumHeldOutMedianResidualTicks:
      1.5,

    minimumHeldOutWithinOneTickRate:
      0.70,

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
// LOAD INPUTS
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
    `Script128 not ready. Status=${script128?.status}`
  );
}


if (
  heroMap?.status !==
  'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY'
) {

  throw new Error(
    `Hero display-name map not ready. Status=${heroMap?.status}`
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
  'SHOT TRAVEL CROSS-REPLAY AUDIT V0.2'
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
  'Required held-out data: median residual + within-1-tick rate'
);

console.log(
  'Within-2-tick data:     OPTIONAL / descriptive if present'
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
// AGGREGATE
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


const enoughHeldOutFolds =
  heroAudits.filter(
    row =>
      row.availableFoldCount >=
      THRESHOLDS.minimumAvailableFolds
  );


const timingGeneralizes =
  heroAudits.filter(
    row =>
      row.crossReplayTimingGeneralizes ===
      true
  );


const timingGeneralizesStable =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'CROSS_REPLAY_TIMING_GENERALIZES_PARAMETERS_STABLE_IN_COHORT'
  );


const timingGeneralizesVariable =
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


const timingFails =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY'
  );


const multiReplayInsufficientFolds =
  heroAudits.filter(
    row =>
      row.auditClassification ===
      'MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS'
  );


// ============================================================
// SCHEMA DIAGNOSTIC
// ============================================================

const allAvailableFolds =
  heroAudits.flatMap(
    row =>
      row.folds
  );


const foldMetricAvailability =
  {
    folds:
      allAvailableFolds.length,

    medianResidualPresent:
      allAvailableFolds.filter(
        row =>
          Number.isFinite(
            row.heldOutMedianResidualTicks
          )
      ).length,

    withinOnePresent:
      allAvailableFolds.filter(
        row =>
          Number.isFinite(
            row.heldOutWithinOneTickRate
          )
      ).length,

    withinTwoPresent:
      allAvailableFolds.filter(
        row =>
          Number.isFinite(
            row.heldOutWithinTwoTickRate
          )
      ).length
  };


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


    heldOutMedianResidualMetricAvailable:
      check(
        foldMetricAvailability.medianResidualPresent,
        allAvailableFolds.length,
        allAvailableFolds.length >
        0
        &&
        foldMetricAvailability.medianResidualPresent ===
        allAvailableFolds.length
      ),


    heldOutWithinOneMetricAvailable:
      check(
        foldMetricAvailability.withinOnePresent,
        allAvailableFolds.length,
        allAvailableFolds.length >
        0
        &&
        foldMetricAvailability.withinOnePresent ===
        allAvailableFolds.length
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
// STATUS
// ============================================================

const status =
  integrityPass
    ? 'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_V02_READY'
    : 'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_V02_INTEGRITY_FAILURE';


const nextStage =
  integrityPass
    ? 'DISCOVER_TIME_VARYING_EFFECTIVE_WEAPON_FIRE_RATE_PROJECTILE_VELOCITY_AND_ITEM_MODIFIER_STATE'
    : 'DIAGNOSE_SCRIPT128_HELD_OUT_METRIC_SCHEMA';


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

    supersedesInterpretationOf:
      'SHOT_TRAVEL_CROSS_REPLAY_AUDIT_V01',

    correction:
      {
        v01Problem:
          'V01 required heldOutWithinTwoTickRate even though that field is absent from the available Script128 folds.',

        consequence:
          'V01 falsely forced otherwise strong multi-replay models into CROSS_REPLAY_TIMING_DOES_NOT_GENERALIZE_CLEANLY.',

        v02Rule:
          'Cross-replay generalization requires available-fold median residual <= threshold and within-one-tick rate >= threshold. Within-two-tick coverage is optional.'
      },

    thresholds:
      THRESHOLDS,

    foldMetricAvailability,

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
          multiReplayModeled.length,

        heroesWithEnoughHeldOutFolds:
          enoughHeldOutFolds.length
      },

    aggregate:
      {
        timingGeneralizes:
          timingGeneralizes.length,

        timingGeneralizesParametersStableInCohort:
          timingGeneralizesStable.length,

        timingGeneralizesParametersVariable:
          timingGeneralizesVariable.length,

        highSpeedTimingGeneralizesExactSpeedUnresolved:
          highSpeedGeneralizes.length,

        timingDoesNotGeneralizeCleanly:
          timingFails.length,

        multiReplayInsufficientHeldOutFolds:
          multiReplayInsufficientFolds.length,

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
        timingVsParameter:
          'Held-out timing generalization and exact fitted speed stability are distinct.',

        itemState:
          'Item/loadout state may alter projectile velocity and fire rate. Parameter variation may represent real time-varying weapon state rather than random model failure.',

        stableParameter:
          'Stable-in-cohort means folds happen to fit similar parameters in this sample; it does not establish a fixed hero constant.',

        variableParameter:
          'Cross-replay timing generalization with variable fitted parameters is positive evidence for investigating loadout-conditioned effective weapon mechanics.',

        insufficientFolds:
          'A multi-replay hero with only one available leave-one-replay-out fold remains provisional rather than being mislabeled as single-replay evidence.',

        pooledSpeed:
          'No Script128 pooled fitted speed is frozen as a hero projectile-speed constant.',

        behavioral:
          'This remains a mechanical reachability layer only. It does not establish attention, attempt, or response.'
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
  'FOLD METRIC AVAILABILITY'
);

console.log(
  '------------------------'
);

console.log(
  `available folds:          ${foldMetricAvailability.folds}`
);

console.log(
  `median residual present:  ${foldMetricAvailability.medianResidualPresent}/${foldMetricAvailability.folds}`
);

console.log(
  `within-one present:       ${foldMetricAvailability.withinOnePresent}/${foldMetricAvailability.folds}`
);

console.log(
  `within-two present:       ${foldMetricAvailability.withinTwoPresent}/${foldMetricAvailability.folds}`
);

console.log('');

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
    `speedRatio=${formatNumber(row.speedRangeRatio).padEnd(6)} ` +
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
    `${name.padEnd(72)} ${count}`
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
    `${name.padEnd(48)} ${row.pass} ` +
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
    'UNKNOWN HERO';


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


  const foldRows =
    availableFolds.map(
      fold => ({
        heldOutReplay:
          fold.heldOutReplay,

        trainingHits:
          finite(
            fold.trainingHits
          ),

        testHits:
          finite(
            fold.testHits
          ),

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
    );


  const foldSpeeds =
    foldRows
      .map(
        fold =>
          fold.trainedSpeedHUPerSecond
      )
      .filter(
        Number.isFinite
      );


  const foldDelays =
    foldRows
      .map(
        fold =>
          fold.trainedFixedDelayTicks
      )
      .filter(
        Number.isFinite
      );


  const heldOutMedians =
    foldRows
      .map(
        fold =>
          fold.heldOutMedianResidualTicks
      )
      .filter(
        Number.isFinite
      );


  const heldOutW1 =
    foldRows
      .map(
        fold =>
          fold.heldOutWithinOneTickRate
      )
      .filter(
        Number.isFinite
      );


  const heldOutW2 =
    foldRows
      .map(
        fold =>
          fold.heldOutWithinTwoTickRate
      )
      .filter(
        Number.isFinite
      );


  const availableFoldCount =
    foldRows.length;


  const enoughFolds =
    availableFoldCount >=
    THRESHOLDS.minimumAvailableFolds;


  const allRequiredFoldMetricsPresent =
    enoughFolds
    &&
    heldOutMedians.length ===
    availableFoldCount
    &&
    heldOutW1.length ===
    availableFoldCount;


  const everyFoldMedianAcceptable =
    allRequiredFoldMetricsPresent
    &&
    heldOutMedians.every(
      value =>
        value <=
        THRESHOLDS.maximumHeldOutMedianResidualTicks
    );


  const everyFoldW1Acceptable =
    allRequiredFoldMetricsPresent
    &&
    heldOutW1.every(
      value =>
        value >=
        THRESHOLDS.minimumHeldOutWithinOneTickRate
    );


  const crossReplayTimingGeneralizes =
    enoughFolds
    &&
    allRequiredFoldMetricsPresent
    &&
    everyFoldMedianAcceptable
    &&
    everyFoldW1Acceptable;


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

    foldTrainingSpeedHUPerSecond:
      summarizeNumbers(
        foldSpeeds
      ),

    foldTrainingFixedDelayTicks:
      summarizeNumbers(
        foldDelays
      ),

    heldOutMedianResidualTicks:
      summarizeNumbers(
        heldOutMedians
      ),

    heldOutWithinOneTickRate:
      summarizeNumbers(
        heldOutW1
      ),

    heldOutWithinTwoTickRate:
      summarizeNumbers(
        heldOutW2
      ),

    speedRangeRatio,

    delayRangeTicks,

    diagnostics:
      {
        enoughFolds,

        allRequiredFoldMetricsPresent,

        everyFoldMedianAcceptable,

        everyFoldW1Acceptable,

        parameterStableInCohort,

        pooledHighSpeed,

        optionalWithinTwoMetricPresentForAllFolds:
          availableFoldCount >
          0
          &&
          heldOutW2.length ===
          availableFoldCount
      },

    crossReplayTimingGeneralizes,

    auditClassification,

    folds:
      foldRows
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
      ? 'MULTI_REPLAY_MODEL_WEAK_OR_UNRESOLVED'
      : 'SINGLE_REPLAY_MODEL_WEAK_OR_UNRESOLVED';
  }


  if (
    replayCount >=
    2
    &&
    !enoughFolds
  ) {

    return 'MULTI_REPLAY_INSUFFICIENT_HELD_OUT_FOLDS';
  }


  if (
    replayCount <
    2
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
  summary
) {

  if (
    !summary
    ||
    summary.count ===
    0
  ) {

    return 'n/a';
  }


  return (
    `${formatNumber(summary.min)}..${formatNumber(summary.max)}`
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
    '# Shot Travel Cross-Replay Audit V02'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## V01 correction'
  );

  lines.push('');

  lines.push(
    'V01 required a held-out within-two-tick metric that is absent from the available Script128 fold schema. This falsely caused otherwise strong cross-replay models to be classified as failures.'
  );

  lines.push('');

  lines.push(
    'V02 evaluates cross-replay timing using the available held-out median residual and within-one-tick rate.'
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
      `- **${row.displayName} (${row.heroId})** — hits=${row.hits}, replays=${row.replayCount}, folds=${row.availableFoldCount}, classification=${row.auditClassification}`
    );
  }


  lines.push('');

  lines.push(
    '## Interpretation'
  );

  lines.push('');

  lines.push(
    '- Cross-replay timing generalization does not imply one fixed projectile velocity per hero.'
  );

  lines.push(
    '- Item/loadout state may alter projectile velocity and fire rate.'
  );

  lines.push(
    '- Parameter-variable but timing-generalizing heroes are especially relevant for the next modifier-state investigation.'
  );

  lines.push(
    '- Multi-replay heroes with too few valid held-out folds remain provisional rather than being mislabeled as single-replay evidence.'
  );

  lines.push(
    '- No fitted Script128 speed is currently approved as a canonical opportunity-model parameter.'
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