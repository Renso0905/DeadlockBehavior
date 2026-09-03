import {
  createReadStream,
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


const TICK_RATE =
  64;


// ============================================================
// EMPIRICAL PLATEAU / TRANSITION DEFINITIONS
//
// These are used to identify the visibly separated regions in
// Script 85:
//
//   early targetless cases ~18 s
//   transitional cases     20-39.95 s
//   later targetless cases ~40 s
//
// They are diagnostic partitions, not engine constants.
// ============================================================

const LOWER_PLATEAU_SELECTION_MAX_SECONDS =
  20;


const UPPER_PLATEAU_SELECTION_MIN_SECONDS =
  39.95;


// ============================================================
// SIMPLE ROUND-NUMBER CANDIDATE
//
// Script 85 strongly suggested:
//
//   minimum lifetime ~18 s
//   slope            ~4 s / match minute
//   maximum lifetime ~40 s
//
// One natural candidate is:
//
//   clamp(
//     18,
//     4 * matchMinute - 18,
//     40
//   )
//
// This corresponds to:
//
//   lower plateau until ~9:00
//   linear scaling from ~9:00 to ~14:30
//   upper plateau from ~14:30 onward
//
// THIS SCRIPT TESTS THAT MODEL.
// IT DOES NOT ASSUME IT IS CORRECT.
// ============================================================

const SIMPLE_LOWER_SECONDS =
  18;


const SIMPLE_UPPER_SECONDS =
  40;


const SIMPLE_SLOPE_SECONDS_PER_MINUTE =
  4;


const SIMPLE_INTERCEPT_SECONDS =
  -18;


// ============================================================
// PATHS
// ============================================================

const summary85Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_expiration_diagnostic_v01.json'
  );


const cases85Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_expiration_cases_v01.jsonl'
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_lifetime_scaling_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_lifetime_scaling_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    summary85Path,
    cases85Path,
    episodes75Path
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
// SCRIPT 85 SUMMARY
// ============================================================

const summary85 =
  JSON.parse(
    readFileSync(
      summary85Path,
      'utf8'
    )
  );


if (
  summary85
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 85 did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 85 CASES
// ============================================================

console.log('');

console.log(
  'Loading Script 85 targetless cases...'
);


const cases85 =
  await loadJsonl(
    cases85Path
  );


console.log(
  `Script 85 cases: ${cases85.length}`
);


// ============================================================
// LOAD SCRIPT 75 EPISODES
// ============================================================

console.log(
  'Loading Script 75 lifecycle episodes...'
);


const episodes75 =
  await loadJsonl(
    episodes75Path
  );


console.log(
  `Script 75 episodes: ${episodes75.length}`
);


const episode75ByDeathIndex =
  new Map();


for (
  const row
  of episodes75
) {

  const deathIndex =
    finite(
      row
        ?.death
        ?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    episode75ByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// BUILD CASES
// ============================================================

const cases =
  [];


for (
  const source85
  of cases85
) {

  const deathIndex =
    finite(
      source85?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const source75 =
    episode75ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  if (
    !source75
  ) {

    continue;
  }


  const deathTick =
    finite(
      source75
        ?.death
        ?.tick
    );


  const activationTick =
    firstFinite([
      source85
        ?.activationTick,

      source75
        ?.assignedGold
        ?.activationTick
    ]);


  const deathTimeSeconds =
    firstFinite([
      source75
        ?.death
        ?.timeSeconds,

      source85
        ?.deathTimeSeconds
    ]);


  let activationTimeSeconds =
    finite(
      source75
        ?.assignedGold
        ?.activationTimeSeconds
    );


  if (
    activationTimeSeconds ===
      null
    &&
    deathTimeSeconds !==
      null
    &&
    deathTick !==
      null
    &&
    activationTick !==
      null
  ) {

    activationTimeSeconds =
      deathTimeSeconds +
      (
        activationTick -
        deathTick
      )
      /
      TICK_RATE;
  }


  const rawDurationSeconds =
    finite(
      source85
        ?.derived
        ?.rawDurationSeconds
    );


  const rawDurationTicks =
    finite(
      source85
        ?.derived
        ?.rawDurationTicks
    );


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      source85?.clock ??
      source75
        ?.death
        ?.clock ??
      null,

    baseType:
      source85?.baseType ??
      source75
        ?.death
        ?.baseType ??
      null,

    variantLabel:
      source85?.variantLabel ??
      source75
        ?.death
        ?.variantLabel ??
      null,

    deathTick,

    activationTick,

    deathTimeSeconds,

    activationTimeSeconds,

    deathMatchMinute:
      Number.isFinite(
        deathTimeSeconds
      )
        ? deathTimeSeconds /
          60
        : null,

    activationMatchMinute:
      Number.isFinite(
        activationTimeSeconds
      )
        ? activationTimeSeconds /
          60
        : null,

    rawDurationSeconds,

    rawDurationTicks,

    observedState:
      classifyObservedDuration(
        rawDurationSeconds
      ),

    source85: {

      terminationDiagnostic:
        source85
          ?.derived
          ?.terminationDiagnostic ??
        null,

      minimumNearestAllyXY:
        finite(
          source85
            ?.raw
            ?.minimumNearestAllyXY
        ),

      minimumNearestAlly3D:
        finite(
          source85
            ?.raw
            ?.minimumNearestAlly3D
        ),

      everInside735:
        source85
          ?.derived
          ?.everInside735Any ===
        true
    },

    predictions:
      {}
  });
}


// ============================================================
// INACTIVE / CENSORED PARTITION
// ============================================================

const observedLifetimeCases =
  cases.filter(
    row =>
      Number.isFinite(
        row.rawDurationSeconds
      )
  );


const censoredCases =
  cases.filter(
    row =>
      !Number.isFinite(
        row.rawDurationSeconds
      )
  );


const activationTimeResolved =
  observedLifetimeCases.filter(
    row =>
      Number.isFinite(
        row.activationMatchMinute
      )
  );


const deathTimeResolved =
  observedLifetimeCases.filter(
    row =>
      Number.isFinite(
        row.deathMatchMinute
      )
  );


// ============================================================
// EMPIRICAL PLATEAUS
// ============================================================

const lowerPlateauCases =
  observedLifetimeCases.filter(
    row =>
      row.rawDurationSeconds <=
      LOWER_PLATEAU_SELECTION_MAX_SECONDS
  );


const upperPlateauCases =
  observedLifetimeCases.filter(
    row =>
      row.rawDurationSeconds >=
      UPPER_PLATEAU_SELECTION_MIN_SECONDS
  );


const transitionCases =
  observedLifetimeCases.filter(
    row =>
      row.rawDurationSeconds >
        LOWER_PLATEAU_SELECTION_MAX_SECONDS
      &&
      row.rawDurationSeconds <
        UPPER_PLATEAU_SELECTION_MIN_SECONDS
  );


const empiricalLowerSeconds =
  median(
    lowerPlateauCases.map(
      row =>
        row.rawDurationSeconds
    )
  );


const empiricalUpperSeconds =
  median(
    upperPlateauCases.map(
      row =>
        row.rawDurationSeconds
    )
  );


// ============================================================
// LINEAR FIT — ACTIVATION TIME
// ============================================================

const transitionActivationRows =
  transitionCases.filter(
    row =>
      Number.isFinite(
        row.activationMatchMinute
      )
  );


const activationOLS =
  fitLinearRegression(
    transitionActivationRows.map(
      row => ({

        x:
          row.activationMatchMinute,

        y:
          row.rawDurationSeconds
      })
    )
  );


// ============================================================
// LINEAR FIT — DEATH TIME
// ============================================================

const transitionDeathRows =
  transitionCases.filter(
    row =>
      Number.isFinite(
        row.deathMatchMinute
      )
  );


const deathOLS =
  fitLinearRegression(
    transitionDeathRows.map(
      row => ({

        x:
          row.deathMatchMinute,

        y:
          row.rawDurationSeconds
      })
    )
  );


// ============================================================
// CONSTRAINED 4 SEC / MIN FIT
//
// Keep slope fixed at 4 and estimate only intercept.
//
// For y = 4x + b:
//
//   b = mean(y - 4x)
// ============================================================

const activationSlope4Intercept =
  fitFixedSlopeIntercept(
    transitionActivationRows.map(
      row => ({

        x:
          row.activationMatchMinute,

        y:
          row.rawDurationSeconds
      })
    ),

    4
  );


const deathSlope4Intercept =
  fitFixedSlopeIntercept(
    transitionDeathRows.map(
      row => ({

        x:
          row.deathMatchMinute,

        y:
          row.rawDurationSeconds
      })
    ),

    4
  );


// ============================================================
// MODELS
// ============================================================

const models =
  {

    SIMPLE_ROUND_ACTIVATION:
      {

        label:
          'clamp(18, 4 * activationMinute - 18, 40)',

        xSource:
          'ACTIVATION_TIME',

        lower:
          SIMPLE_LOWER_SECONDS,

        upper:
          SIMPLE_UPPER_SECONDS,

        slope:
          SIMPLE_SLOPE_SECONDS_PER_MINUTE,

        intercept:
          SIMPLE_INTERCEPT_SECONDS
      },


    SIMPLE_ROUND_DEATH:
      {

        label:
          'clamp(18, 4 * deathMinute - 18, 40)',

        xSource:
          'DEATH_TIME',

        lower:
          SIMPLE_LOWER_SECONDS,

        upper:
          SIMPLE_UPPER_SECONDS,

        slope:
          SIMPLE_SLOPE_SECONDS_PER_MINUTE,

        intercept:
          SIMPLE_INTERCEPT_SECONDS
      },


    FITTED_SLOPE4_ACTIVATION:
      {

        label:
          'empirical plateaus + fixed 4 sec/min slope using activation time',

        xSource:
          'ACTIVATION_TIME',

        lower:
          empiricalLowerSeconds,

        upper:
          empiricalUpperSeconds,

        slope:
          4,

        intercept:
          activationSlope4Intercept
      },


    FITTED_SLOPE4_DEATH:
      {

        label:
          'empirical plateaus + fixed 4 sec/min slope using death time',

        xSource:
          'DEATH_TIME',

        lower:
          empiricalLowerSeconds,

        upper:
          empiricalUpperSeconds,

        slope:
          4,

        intercept:
          deathSlope4Intercept
      },


    OLS_ACTIVATION:
      {

        label:
          'empirical plateaus + unconstrained linear middle using activation time',

        xSource:
          'ACTIVATION_TIME',

        lower:
          empiricalLowerSeconds,

        upper:
          empiricalUpperSeconds,

        slope:
          activationOLS?.slope ??
          null,

        intercept:
          activationOLS?.intercept ??
          null
      },


    OLS_DEATH:
      {

        label:
          'empirical plateaus + unconstrained linear middle using death time',

        xSource:
          'DEATH_TIME',

        lower:
          empiricalLowerSeconds,

        upper:
          empiricalUpperSeconds,

        slope:
          deathOLS?.slope ??
          null,

        intercept:
          deathOLS?.intercept ??
          null
      }
  };


// ============================================================
// EVALUATE MODELS
// ============================================================

const modelEvaluations =
  {};


for (
  const [
    modelName,
    model
  ]
  of Object.entries(
    models
  )
) {

  const evaluation =
    evaluateModel(
      observedLifetimeCases,
      model
    );


  modelEvaluations[
    modelName
  ] =
    {

      ...evaluation,

      lowerBreakpointMinute:
        calculateBreakpoint(
          model.lower,
          model.slope,
          model.intercept
        ),

      upperBreakpointMinute:
        calculateBreakpoint(
          model.upper,
          model.slope,
          model.intercept
        )
    };
}


// ============================================================
// SELECT BEST MODELS
// ============================================================

const bestOverall =
  selectBestModel(
    modelEvaluations,
    'rmseSeconds'
  );


const bestSimpleOrFixed4 =
  selectBestModel(

    Object.fromEntries(
      Object.entries(
        modelEvaluations
      )
      .filter(
        (
          [
            name
          ]
        ) =>
          name.startsWith(
            'SIMPLE_'
          )
          ||
          name.startsWith(
            'FITTED_SLOPE4_'
          )
      )
    ),

    'rmseSeconds'
  );


// ============================================================
// ATTACH PREDICTIONS TO CASES
// ============================================================

for (
  const row
  of cases
) {

  for (
    const [
      modelName,
      model
    ]
    of Object.entries(
      models
    )
  ) {

    const x =
      model.xSource ===
        'ACTIVATION_TIME'
        ? row.activationMatchMinute
        : row.deathMatchMinute;


    const predicted =
      predictModel(
        model,
        x
      );


    row.predictions[
      modelName
    ] = {

      predictedSeconds:
        predicted,

      residualSeconds:
        Number.isFinite(
          predicted
        )
        &&
        Number.isFinite(
          row.rawDurationSeconds
        )
          ? row.rawDurationSeconds -
            predicted
          : null,

      absoluteResidualSeconds:
        Number.isFinite(
          predicted
        )
        &&
        Number.isFinite(
          row.rawDurationSeconds
        )
          ? Math.abs(
            row.rawDurationSeconds -
            predicted
          )
          : null
    };
  }
}


// ============================================================
// TRANSITION DETAIL
// ============================================================

const transitionDetail =
  transitionCases
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        (
          a.activationTimeSeconds ??
          Infinity
        )
        -
        (
          b.activationTimeSeconds ??
          Infinity
        )
    );


// ============================================================
// EXACT DURATION TICK STRUCTURE
// ============================================================

const durationTickCounts =
  countBy(
    observedLifetimeCases,
    row =>
      Number.isFinite(
        row.rawDurationTicks
      )
        ? String(
          row.rawDurationTicks
        )
        : 'UNRESOLVED'
  );


const durationSecondsRoundedCounts =
  countBy(
    observedLifetimeCases,
    row =>
      Number.isFinite(
        row.rawDurationSeconds
      )
        ? row
            .rawDurationSeconds
            .toFixed(
              3
            )
        : 'UNRESOLVED'
  );


// ============================================================
// SIMPLE MODEL RESIDUAL COHORTS
// ============================================================

const simpleActivationResiduals =
  observedLifetimeCases
    .map(
      row =>
        row
          .predictions
          .SIMPLE_ROUND_ACTIVATION
          .residualSeconds
    )
    .filter(
      Number.isFinite
    );


const fittedSlope4ActivationResiduals =
  observedLifetimeCases
    .map(
      row =>
        row
          .predictions
          .FITTED_SLOPE4_ACTIVATION
          .residualSeconds
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script85Passed:
      check(
        summary85
          ?.validation
          ?.pass,
        true,
        summary85
          ?.validation
          ?.pass ===
        true
      ),


    targetlessCaseCount:
      check(
        cases.length,
        replayName ===
          'test'
          ? 44
          : '>0',
        replayName ===
          'test'
          ? cases.length ===
            44
          : cases.length >
            0
      ),


    observedLifetimeCount:
      check(
        observedLifetimeCases.length,
        replayName ===
          'test'
          ? 43
          : '>0',
        replayName ===
          'test'
          ? observedLifetimeCases.length ===
            43
          : observedLifetimeCases.length >
            0
      ),


    censoredCount:
      check(
        censoredCases.length,
        replayName ===
          'test'
          ? 1
          : '>=0',
        replayName ===
          'test'
          ? censoredCases.length ===
            1
          : censoredCases.length >=
            0
      ),


    activationTimeCoverage:
      check(
        activationTimeResolved.length,
        observedLifetimeCases.length,
        activationTimeResolved.length ===
        observedLifetimeCases.length
      ),


    deathTimeCoverage:
      check(
        deathTimeResolved.length,
        observedLifetimeCases.length,
        deathTimeResolved.length ===
        observedLifetimeCases.length
      ),


    lowerPlateauPresent:
      check(
        lowerPlateauCases.length,
        '>0',
        lowerPlateauCases.length >
        0
      ),


    upperPlateauPresent:
      check(
        upperPlateauCases.length,
        '>0',
        upperPlateauCases.length >
        0
      ),


    transitionCasesPresent:
      check(
        transitionCases.length,
        replayName ===
          'test'
          ? 4
          : '>=2',
        replayName ===
          'test'
          ? transitionCases.length ===
            4
          : transitionCases.length >=
            2
      ),


    activationOLSAvailable:
      check(
        Boolean(
          activationOLS
        ),
        true,
        Boolean(
          activationOLS
        )
      ),


    deathOLSAvailable:
      check(
        Boolean(
          deathOLS
        ),
        true,
        Boolean(
          deathOLS
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

const summary =
  {

    replay:
      replayName,

    version:
      'ASSIGNED_GOLD_TARGETLESS_LIFETIME_SCALING_VALIDATION_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'TARGETLESS_LIFETIME_SCALING_MODEL_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Test whether targetless AssignedGold lifetime varies systematically with match time.',

        'Determine whether the apparent approximately 18-second early plateau, linear midgame increase, and approximately 40-second later plateau form one coherent timer function.',

        'Compare exact activation-time and death-time predictors.',

        'Test a simple round-number candidate of clamp(18, 4 * matchMinute - 18, 40) against empirically fitted alternatives.'
      ],


    semanticLimits:
      {

        expiration:
          'The modeled lifetime describes targetless AssignedGold active-to-inactive timing. Even an excellent fit does not by itself establish the engine semantic label expiration.',

        sample:
          'The transition region contains only a small number of targetless cases in test.dem, so slope and breakpoint estimates require cross-replay replication.',

        formula:
          'Round-number formulas are candidate descriptions and are not assumed to be source-code constants.',

        censored:
          'The single episode without observed active=false is excluded from timer fitting.'
      },


    cohort:
      {

        totalTargetless:
          cases.length,

        observedLifetime:
          observedLifetimeCases.length,

        censored:
          censoredCases.length,

        lowerPlateauCases:
          lowerPlateauCases.length,

        transitionCases:
          transitionCases.length,

        upperPlateauCases:
          upperPlateauCases.length
      },


    empiricalPlateaus:
      {

        lowerSeconds:
          empiricalLowerSeconds,

        lowerDistribution:
          summarizeNumbers(
            lowerPlateauCases.map(
              row =>
                row.rawDurationSeconds
            )
          ),

        upperSeconds:
          empiricalUpperSeconds,

        upperDistribution:
          summarizeNumbers(
            upperPlateauCases.map(
              row =>
                row.rawDurationSeconds
            )
          )
      },


    transitionRegression:
      {

        activationTimeOLS:
          activationOLS,

        deathTimeOLS:
          deathOLS,

        activationFixedSlope4Intercept:
          activationSlope4Intercept,

        deathFixedSlope4Intercept:
          deathSlope4Intercept
      },


    models,


    evaluations:
      modelEvaluations,


    bestOverall,

    bestSimpleOrFixed4,


    durationTickCounts,

    durationSecondsRoundedCounts,


    residualDistributions:
      {

        simpleRoundActivation:
          summarizeNumbers(
            simpleActivationResiduals
          ),

        fittedSlope4Activation:
          summarizeNumbers(
            fittedSlope4ActivationResiduals
          )
      },


    transitionCases:
      transitionDetail.map(
        compactCase
      ),


    censoredCases:
      censoredCases.map(
        compactCase
      ),


    interpretationGuide:
      {

        strongTimeScalingSupport:
          'If one clamped linear model predicts nearly all 43 observed targetless lifetimes with small sub-second residuals, the prior apparently irregular 18/24/32/39/40-second durations should be interpreted as one match-time-dependent lifetime function.',

        fourSecondSlope:
          'If the unconstrained transition slope is near 4 seconds per match minute and the fixed-slope model performs nearly as well, a simple 4-second-per-minute scaling rule becomes strongly supported within this replay.',

        simpleRoundFormula:
          'If clamp(18, 4 * minute - 18, 40) fits nearly as well as the fitted model, round breakpoints near 9:00 and 14:30 become plausible candidates but remain noncanonical.',

        activationVsDeath:
          'If activation-time prediction is measurably tighter than death-time prediction, the timer is more naturally referenced to AssignedGold activation than Trooper death; otherwise the temporal difference is too small to resolve from this replay.',

        next:
          'If lifetime scaling is strongly supported, build the formal AssignedGold lifecycle classifier using production, proximity/vacuum-target acquisition, and match-time-conditioned targetless timeout telemetry.'
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
  cases.map(
    compactCase
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
  'ASSIGNED GOLD TARGETLESS LIFETIME SCALING V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// COHORT
// ============================================================

console.log('');

console.log(
  'COHORT'
);

console.log(
  '------'
);


console.log(
  `Targetless cases:       ${cases.length}`
);


console.log(
  `Observed active=false:  ${observedLifetimeCases.length}`
);


console.log(
  `Censored/no inactive:   ${censoredCases.length}`
);


console.log(
  `Early plateau cases:    ${lowerPlateauCases.length}`
);


console.log(
  `Transition cases:       ${transitionCases.length}`
);


console.log(
  `Upper plateau cases:    ${upperPlateauCases.length}`
);


// ============================================================
// PLATEAUS
// ============================================================

console.log('');

console.log(
  'EMPIRICAL LIFETIME PLATEAUS'
);

console.log(
  '---------------------------'
);


console.log(
  `Lower: ${formatDistribution(
    summarizeNumbers(
      lowerPlateauCases.map(
        row =>
          row.rawDurationSeconds
      )
    )
  )}`
);


console.log(
  `Upper: ${formatDistribution(
    summarizeNumbers(
      upperPlateauCases.map(
        row =>
          row.rawDurationSeconds
      )
    )
  )}`
);


// ============================================================
// TRANSITION CASES
// ============================================================

console.log('');

console.log(
  'TRANSITION CASES'
);

console.log(
  '----------------'
);


for (
  const row
  of transitionDetail
) {

  console.log(

    `${String(row.deathIndex).padStart(4)} ` +

    `${String(row.clock ?? '').padEnd(6)} ` +

    `deathMin=${formatNumber(row.deathMatchMinute).padStart(8)} ` +

    `activationMin=${formatNumber(row.activationMatchMinute).padStart(8)} ` +

    `duration=${formatNumber(row.rawDurationSeconds).padStart(8)}s`
  );
}


// ============================================================
// REGRESSION
// ============================================================

console.log('');

console.log(
  'TRANSITION LINEAR REGRESSION'
);

console.log(
  '----------------------------'
);


console.log(
  `Activation time: ${formatRegression(activationOLS)}`
);


console.log(
  `Death time:      ${formatRegression(deathOLS)}`
);


console.log(
  `Fixed slope 4 activation intercept: ${formatNumber(activationSlope4Intercept)}`
);


console.log(
  `Fixed slope 4 death intercept:      ${formatNumber(deathSlope4Intercept)}`
);


// ============================================================
// MODEL COMPARISON
// ============================================================

console.log('');

console.log(
  'CLAMPED LIFETIME MODEL COMPARISON'
);

console.log(
  '---------------------------------'
);


for (
  const [
    modelName,
    evaluation
  ]
  of Object.entries(
    modelEvaluations
  )
) {

  const model =
    models[
      modelName
    ];


  console.log('');

  console.log(
    modelName
  );


  console.log(
    `  ${model.label}`
  );


  console.log(
    `  slope=${formatNumber(model.slope)} sec/min intercept=${formatNumber(model.intercept)}`
  );


  console.log(
    `  lower=${formatNumber(model.lower)} upper=${formatNumber(model.upper)}`
  );


  console.log(
    `  breakpoints=${formatClockFromMinute(evaluation.lowerBreakpointMinute)} -> ${formatClockFromMinute(evaluation.upperBreakpointMinute)}`
  );


  console.log(
    `  RMSE=${formatNumber(evaluation.rmseSeconds)}s MAE=${formatNumber(evaluation.maeSeconds)}s maxAbs=${formatNumber(evaluation.maxAbsoluteResidualSeconds)}s`
  );


  console.log(
    `  <=1tick=${evaluation.within1Tick}/${evaluation.count} <=4ticks=${evaluation.within4Ticks}/${evaluation.count} <=16ticks=${evaluation.within16Ticks}/${evaluation.count}`
  );
}


// ============================================================
// BEST MODEL
// ============================================================

console.log('');

console.log(
  'BEST MODELS'
);

console.log(
  '-----------'
);


console.log(
  `Best overall:          ${bestOverall?.modelName ?? 'n/a'} RMSE=${formatNumber(bestOverall?.rmseSeconds)}s`
);


console.log(
  `Best simple/fixed-4:   ${bestSimpleOrFixed4?.modelName ?? 'n/a'} RMSE=${formatNumber(bestSimpleOrFixed4?.rmseSeconds)}s`
);


// ============================================================
// CASE-BY-CASE SIMPLE MODEL
// ============================================================

console.log('');

console.log(
  'OBSERVED VS SIMPLE ROUND ACTIVATION MODEL'
);

console.log(
  '-----------------------------------------'
);


for (
  const row
  of observedLifetimeCases
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        (
          a.activationTimeSeconds ??
          Infinity
        )
        -
        (
          b.activationTimeSeconds ??
          Infinity
        )
    )
) {

  const prediction =
    row
      .predictions
      .SIMPLE_ROUND_ACTIVATION;


  console.log(

    `${String(row.deathIndex).padStart(4)} ` +

    `${String(row.clock ?? '').padEnd(6)} ` +

    `t=${formatNumber(row.activationMatchMinute).padStart(7)}m ` +

    `observed=${formatNumber(row.rawDurationSeconds).padStart(7)} ` +

    `predicted=${formatNumber(prediction.predictedSeconds).padStart(7)} ` +

    `residual=${formatSignedNumber(prediction.residualSeconds).padStart(8)}`
  );
}


// ============================================================
// VALIDATION
// ============================================================

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

    `${name.padEnd(38)} ` +

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
// OBSERVED DURATION CLASS
// ============================================================

function classifyObservedDuration(
  duration
) {

  if (
    !Number.isFinite(
      duration
    )
  ) {

    return 'CENSORED_NO_ACTIVE_FALSE';
  }


  if (
    duration <=
    LOWER_PLATEAU_SELECTION_MAX_SECONDS
  ) {

    return 'LOWER_PLATEAU';
  }


  if (
    duration >=
    UPPER_PLATEAU_SELECTION_MIN_SECONDS
  ) {

    return 'UPPER_PLATEAU';
  }


  return 'TRANSITION';
}


// ============================================================
// LINEAR REGRESSION
// ============================================================

function fitLinearRegression(
  points
) {

  const clean =
    points.filter(
      row =>
        Number.isFinite(
          row?.x
        )
        &&
        Number.isFinite(
          row?.y
        )
    );


  if (
    clean.length <
    2
  ) {

    return null;
  }


  const meanX =
    clean.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row.x,
      0
    )
    /
    clean.length;


  const meanY =
    clean.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row.y,
      0
    )
    /
    clean.length;


  let numerator =
    0;


  let denominator =
    0;


  for (
    const row
    of clean
  ) {

    numerator +=
      (
        row.x -
        meanX
      )
      *
      (
        row.y -
        meanY
      );


    denominator +=
      (
        row.x -
        meanX
      )
      *
      (
        row.x -
        meanX
      );
  }


  if (
    denominator ===
    0
  ) {

    return null;
  }


  const slope =
    numerator /
    denominator;


  const intercept =
    meanY -
    slope *
    meanX;


  const predictions =
    clean.map(
      row =>
        slope *
          row.x
        +
        intercept
    );


  const residuals =
    clean.map(
      (
        row,
        index
      ) =>
        row.y -
        predictions[
          index
        ]
    );


  const sse =
    residuals.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value *
        value,
      0
    );


  const totalSS =
    clean.reduce(
      (
        sum,
        row
      ) => {

        const delta =
          row.y -
          meanY;


        return sum +
          delta *
          delta;
      },
      0
    );


  const rSquared =
    totalSS >
      0
      ? 1 -
        sse /
        totalSS
      : null;


  return {

    count:
      clean.length,

    slope,

    intercept,

    rSquared,

    rmse:
      Math.sqrt(
        sse /
        clean.length
      ),

    residualDistribution:
      summarizeNumbers(
        residuals
      )
  };
}


// ============================================================
// FIXED-SLOPE INTERCEPT
// ============================================================

function fitFixedSlopeIntercept(
  points,
  slope
) {

  const clean =
    points.filter(
      row =>
        Number.isFinite(
          row?.x
        )
        &&
        Number.isFinite(
          row?.y
        )
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
      row
    ) =>
      sum +
      (
        row.y -
        slope *
        row.x
      ),
    0
  )
  /
  clean.length;
}


// ============================================================
// MODEL PREDICTION
// ============================================================

function predictModel(
  model,
  x
) {

  if (
    !Number.isFinite(
      x
    )
    ||
    !Number.isFinite(
      model?.lower
    )
    ||
    !Number.isFinite(
      model?.upper
    )
    ||
    !Number.isFinite(
      model?.slope
    )
    ||
    !Number.isFinite(
      model?.intercept
    )
  ) {

    return null;
  }


  const linear =
    model.slope *
      x
    +
    model.intercept;


  return Math.max(
    model.lower,
    Math.min(
      model.upper,
      linear
    )
  );
}


// ============================================================
// MODEL EVALUATION
// ============================================================

function evaluateModel(
  rows,
  model
) {

  const residuals =
    [];


  for (
    const row
    of rows
  ) {

    const x =
      model.xSource ===
        'ACTIVATION_TIME'
        ? row.activationMatchMinute
        : row.deathMatchMinute;


    const predicted =
      predictModel(
        model,
        x
      );


    if (
      !Number.isFinite(
        predicted
      )
      ||
      !Number.isFinite(
        row.rawDurationSeconds
      )
    ) {

      continue;
    }


    residuals.push(
      row.rawDurationSeconds -
      predicted
    );
  }


  const absoluteResiduals =
    residuals.map(
      Math.abs
    );


  const squaredResiduals =
    residuals.map(
      value =>
        value *
        value
    );


  return {

    count:
      residuals.length,

    rmseSeconds:
      residuals.length >
        0
        ? Math.sqrt(
          squaredResiduals.reduce(
            (
              sum,
              value
            ) =>
              sum +
              value,
            0
          )
          /
          residuals.length
        )
        : null,

    maeSeconds:
      residuals.length >
        0
        ? absoluteResiduals.reduce(
          (
            sum,
            value
          ) =>
            sum +
            value,
          0
        )
        /
        residuals.length
        : null,

    maxAbsoluteResidualSeconds:
      absoluteResiduals.length >
        0
        ? Math.max(
          ...absoluteResiduals
        )
        : null,

    residualDistribution:
      summarizeNumbers(
        residuals
      ),

    absoluteResidualDistribution:
      summarizeNumbers(
        absoluteResiduals
      ),

    within1Tick:
      absoluteResiduals.filter(
        value =>
          value <=
          1 /
          TICK_RATE
      ).length,

    within4Ticks:
      absoluteResiduals.filter(
        value =>
          value <=
          4 /
          TICK_RATE
      ).length,

    within16Ticks:
      absoluteResiduals.filter(
        value =>
          value <=
          16 /
          TICK_RATE
      ).length
  };
}


// ============================================================
// BREAKPOINT
// ============================================================

function calculateBreakpoint(
  plateau,
  slope,
  intercept
) {

  if (
    !Number.isFinite(
      plateau
    )
    ||
    !Number.isFinite(
      slope
    )
    ||
    slope ===
      0
    ||
    !Number.isFinite(
      intercept
    )
  ) {

    return null;
  }


  return (
    plateau -
    intercept
  )
  /
  slope;
}


// ============================================================
// BEST MODEL
// ============================================================

function selectBestModel(
  evaluations,
  metric
) {

  return Object
    .entries(
      evaluations
    )
    .map(
      (
        [
          modelName,
          evaluation
        ]
      ) => ({

        modelName,

        ...evaluation
      })
    )
    .filter(
      row =>
        Number.isFinite(
          row?.[metric]
        )
    )
    .sort(
      (
        a,
        b
      ) =>
        a[metric] -
        b[metric]
    )[0]
    ??
    null;
}


// ============================================================
// COMPACT CASE
// ============================================================

function compactCase(
  row
) {

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

    variantLabel:
      row.variantLabel,

    deathTick:
      row.deathTick,

    activationTick:
      row.activationTick,

    deathTimeSeconds:
      row.deathTimeSeconds,

    activationTimeSeconds:
      row.activationTimeSeconds,

    deathMatchMinute:
      row.deathMatchMinute,

    activationMatchMinute:
      row.activationMatchMinute,

    rawDurationSeconds:
      row.rawDurationSeconds,

    rawDurationTicks:
      row.rawDurationTicks,

    observedState:
      row.observedState,

    source85:
      row.source85,

    predictions:
      row.predictions
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


function median(
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


  return quantile(
    clean,
    0.5
  );
}


function countBy(
  rows,
  selector
) {

  const output =
    {};


  for (
    const row
    of rows
  ) {

    const key =
      String(
        selector(
          row
        )
        ??
        'NULL'
      );


    output[
      key
    ] =
      (
        output[
          key
        ]
        ??
        0
      )
      +
      1;
  }


  return output;
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


// ============================================================
// VALIDATION
// ============================================================

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


function formatSignedNumber(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'n/a';
  }


  const rounded =
    Number(
      value.toFixed(
        4
      )
    );


  return rounded >=
    0
    ? `+${rounded}`
    : String(
      rounded
    );
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


function formatRegression(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (

    `n=${row.count} ` +

    `slope=${formatNumber(row.slope)} sec/min ` +

    `intercept=${formatNumber(row.intercept)} ` +

    `R2=${formatNumber(row.rSquared)} ` +

    `RMSE=${formatNumber(row.rmse)}s`
  );
}


function formatClockFromMinute(
  minute
) {

  if (
    !Number.isFinite(
      minute
    )
  ) {

    return 'n/a';
  }


  const totalSeconds =
    minute *
    60;


  const minutes =
    Math.floor(
      totalSeconds /
      60
    );


  const seconds =
    totalSeconds -
    minutes *
    60;


  return (
    `${minutes}:` +
    `${seconds.toFixed(2).padStart(5, '0')}`
  );
}