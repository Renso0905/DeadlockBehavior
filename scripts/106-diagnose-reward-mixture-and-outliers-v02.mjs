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
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT105_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_patch_era_diagnostic_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_mixture_outlier_diagnostic_v02.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_mixture_outlier_diagnostic_v02.md'
  );


// ============================================================
// V01 CORRECTION
//
// V01 successfully analyzed rep01, then crashed while printing:
//
//   ReferenceError: printReplayResult is not defined
//
// The analysis function existed, but its console-rendering helper
// was accidentally omitted.
//
// V02 adds printReplayResult().
//
// No telemetry or extraction data are affected.
// No raw replay parsing is required.
// ============================================================


// ============================================================
// SCRIPT105 INTERPRETATION CORRECTION
//
// Script105 selected:
//
//   PRE-JUNE-30
//
// based solely on lower RMSE.
//
// But its own output showed:
//
//   PRE:
//     very poor MAE
//     ~0% within 1-2 souls
//
//   POST:
//     much lower MAE
//     ~67% within 1 soul pooled
//     ~74% within 2 souls pooled
//
// A minority of large positive residuals can dominate RMSE.
//
// Therefore:
//
//   PRE_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED
//
// remains withdrawn pending this mixture/outlier analysis.
// ============================================================


// ============================================================
// HISTORICAL ECONOMY CANDIDATES
// ============================================================

const ERAS = {

  PRE_JUNE_30_2026: {

    id:
      'PRE_JUNE_30_2026',

    totalIntercept:
      116,

    totalSlope:
      1.16,

    groundFraction:
      0.60,

    flyingFraction:
      0.40
  },


  POST_JUNE_30_2026: {

    id:
      'POST_JUNE_30_2026',

    totalIntercept:
      100,

    totalSlope:
      2,

    groundFraction:
      0.50,

    flyingFraction:
      0.50
  }
};


// ============================================================
// SHARING TOTAL MULTIPLIER
// ============================================================

const SHARE_TOTAL_MULTIPLIER =
  new Map([

    [
      1,
      1.00
    ],

    [
      2,
      1.08
    ],

    [
      3,
      1.08
    ],

    [
      4,
      1.00
    ],

    [
      5,
      1.00
    ],

    [
      6,
      0.96
    ]
  ]);


// ============================================================
// MATCHING
// ============================================================

const MATCH_MIN_TICK_OFFSET =
  -1;


const MATCH_MAX_TICK_OFFSET =
  4;


const MATCH_MAX_DISTANCE_3D_HU =
  160;


// ============================================================
// NORMAL TROOPER SCREEN
//
// Preserve Script105's primary cohort exactly.
// ============================================================

const NORMAL_BASE_HP =
  new Map([

    [
      'RANGED',
      300
    ],

    [
      'MEDIC',
      350
    ],

    [
      'MELEE',
      400
    ]
  ]);


const MAX_NORMAL_HP_RATIO =
  1.20;


// ============================================================
// ROUNDING OPTIONS
// ============================================================

const ROUNDING_OPTIONS = [

  'NONE',
  'FLOOR',
  'ROUND',
  'CEIL'
];


// ============================================================
// ROBUST TRIM LEVELS
// ============================================================

const TRIM_LEVELS = [

  0.05,
  0.10,
  0.20,
  0.25
];


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT105_PATH
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


const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


const script105 =
  JSON.parse(
    readFileSync(
      SCRIPT105_PATH,
      'utf8'
    )
  );


if (
  manifest
    ?.readyToBeginReplication !==
  true
) {

  throw new Error(
    'Replication manifest is not ready.'
  );
}


const cohort =
  Array.isArray(
    manifest
      ?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No independent replication cohort.'
  );
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'REWARD MIXTURE / OUTLIER DIAGNOSTIC V0.2'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'V01 CORRECTION'
);

console.log(
  '--------------'
);


console.log(
  'Added missing printReplayResult() console helper.'
);


console.log(
  'No telemetry or extraction data affected.'
);


console.log('');

console.log(
  'SCRIPT105 STATUS'
);

console.log(
  '----------------'
);


console.log(
  `Previous status: ${script105?.patchEraSignatureStatus ?? 'UNKNOWN'}`
);


console.log(
  'Previous patch-era interpretation remains WITHDRAWN pending this audit.'
);


console.log('');

console.log(
  'Reason: RMSE-only model selection conflicts with MAE and near-exact case performance.'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'No raw .dem parsing.'
);


console.log('');


// ============================================================
// ANALYZE REPLAYS
// ============================================================

const replayResults =
  [];


const allCases =
  [];


for (
  let index =
    0;

  index <
    cohort.length;

  index++
) {

  const replayName =
    String(
      cohort[
        index
      ].replayName
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${index + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await analyzeReplay(
      replayName
    );


  replayResults.push(
    result.summary
  );


  for (
    const row
    of result.cases
  ) {

    allCases.push({

      replay:
        replayName,

      ...row
    });
  }


  printReplayResult(
    result.summary
  );


  console.log('');
}


// ============================================================
// POOLED DESCRIPTIVE
// ============================================================

const pooled =
  analyzeCaseSet(
    allCases
  );


// ============================================================
// REPLAY-LEVEL ERA WINNERS
// ============================================================

const informativeReplays =
  replayResults.filter(
    row =>
      row.eligibleCases >=
      20
  );


const postRobustWins =
  informativeReplays.filter(
    row =>
      row.robustEraWinner ===
      'POST_JUNE_30_2026'
  );


const preRobustWins =
  informativeReplays.filter(
    row =>
      row.robustEraWinner ===
      'PRE_JUNE_30_2026'
  );


const postSingleCaseMajority =
  informativeReplays.filter(
    row =>
      (
        row
          ?.singleModelCaseWinners
          ?.postRate ??
        0
      ) >
      0.50
  );


// ============================================================
// POST-MIXTURE QUALITY
// ============================================================

const postMixtureStrongReplays =
  informativeReplays.filter(
    row => {

      const best =
        row
          ?.eras
          ?.POST_JUNE_30_2026
          ?.mixture
          ?.best;


      if (
        !best
      ) {

        return false;
      }


      return (

        (
          best.within2Rate ??
          0
        ) >=
        0.85

        &&

        (
          best.medianAbsoluteError ??
          Infinity
        ) <=
        1.5
      );
    }
  );


// ============================================================
// STATUS
// ============================================================

let status;


if (
  informativeReplays.length <
  3
) {

  status =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  postRobustWins.length >=
    4
  &&
  postSingleCaseMajority.length >=
    4
  &&
  postMixtureStrongReplays.length >=
    4
) {

  status =
    'POST_JUNE_30_BASELINE_WITH_SECOND_COMPONENT_STRONGLY_SUPPORTED';

} else if (
  postRobustWins.length >=
    4
  &&
  postSingleCaseMajority.length >=
    4
) {

  status =
    'POST_JUNE_30_BASELINE_STRONGLY_SUPPORTED_OUTLIER_SOURCE_UNRESOLVED';

} else if (
  preRobustWins.length >=
    4
) {

  status =
    'PRE_JUNE_30_REGIME_ROBUSTLY_SUPPORTED';

} else {

  status =
    'REWARD_REGIME_MIXED_OR_UNRESOLVED';
}


// ============================================================
// POST-MIXTURE ASSIGNMENTS
// ============================================================

const postMixtureAssignments =
  replayResults.map(
    row => {

      const best =
        row
          ?.eras
          ?.POST_JUNE_30_2026
          ?.mixture
          ?.best;


      return {

        replay:
          row.replay,

        eligibleCases:
          row.eligibleCases,

        groundOnly:
          best?.groundOnlyAssignments ??
          null,

        groundPlusFlying:
          best?.combinedAssignments ??
          null,

        combinedRate:
          best?.combinedAssignmentRate ??
          null
      };
    }
  );


// ============================================================
// DISTRIBUTIONS
// ============================================================

const distributions = {

  postSingleMedianAbsoluteError:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.eras
            ?.POST_JUNE_30_2026
            ?.single
            ?.bestRobust
            ?.medianAbsoluteError
      )
    ),


  preSingleMedianAbsoluteError:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.eras
            ?.PRE_JUNE_30_2026
            ?.single
            ?.bestRobust
            ?.medianAbsoluteError
      )
    ),


  postSingleWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.eras
            ?.POST_JUNE_30_2026
            ?.single
            ?.bestRobust
            ?.within2Rate
      )
    ),


  preSingleWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.eras
            ?.PRE_JUNE_30_2026
            ?.single
            ?.bestRobust
            ?.within2Rate
      )
    ),


  postMixtureMedianAbsoluteError:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.eras
            ?.POST_JUNE_30_2026
            ?.mixture
            ?.best
            ?.medianAbsoluteError
      )
    ),


  postMixtureWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.eras
            ?.POST_JUNE_30_2026
            ?.mixture
            ?.best
            ?.within2Rate
      )
    ),


  postCombinedAssignmentRate:
    summarizeNumbers(
      postMixtureAssignments.map(
        row =>
          row.combinedRate
      )
    )
};


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation;


if (
  status ===
  'POST_JUNE_30_BASELINE_WITH_SECOND_COMPONENT_STRONGLY_SUPPORTED'
) {

  interpretation = {

    script105PatchEraConclusionValid:
      false,

    primaryConclusion:
      'The bulk of eligible events follow the post-June-30 ground-reward model. A second reward component explains much of the positive-residual tail substantially better than treating the entire replay cohort as pre-June-30.',

    secondComponentSemanticStatus:
      'CANDIDATE_ONLY',

    secondComponentCandidate:
      'A coincident flying-soul payout is a mechanically plausible candidate because the post-June-30 ground/flying split is 50/50, but this script does not directly identify the second reward source.',

    nextQuestion:
      'Can the high-reward component be directly associated with flying CItemXP acquisition or another exact-tick economic event?'
  };

} else if (
  status ===
  'POST_JUNE_30_BASELINE_STRONGLY_SUPPORTED_OUTLIER_SOURCE_UNRESOLVED'
) {

  interpretation = {

    script105PatchEraConclusionValid:
      false,

    primaryConclusion:
      'Typical eligible observations strongly favor the post-June-30 ground reward curve, while a minority of large positive economic events inflate ordinary regression and RMSE.',

    secondComponentSemanticStatus:
      'UNRESOLVED',

    nextQuestion:
      'What exact-tick reward source produces the positive residual tail?'
  };

} else if (
  status ===
  'PRE_JUNE_30_REGIME_ROBUSTLY_SUPPORTED'
) {

  interpretation = {

    script105PatchEraConclusionValid:
      true,

    primaryConclusion:
      'The pre-June-30 reward regime remains superior even under robust and mixture-aware comparisons.',

    secondComponentSemanticStatus:
      'NOT_REQUIRED',

    nextQuestion:
      null
  };

} else {

  interpretation = {

    script105PatchEraConclusionValid:
      false,

    primaryConclusion:
      'The reward regime remains unresolved after robust comparison.',

    secondComponentSemanticStatus:
      'UNRESOLVED',

    nextQuestion:
      'Characterize the high-residual reward cases directly.'
  };
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    'REWARD_MIXTURE_OUTLIER_DIAGNOSTIC_V02',

  supersedes:
    'REWARD_MIXTURE_OUTLIER_DIAGNOSTIC_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  status,


  v01Correction: {

    issue:
      'V01 referenced printReplayResult() without defining it.',

    consequence:
      'V01 crashed after analyzing the first replay and before writing final outputs.',

    correction:
      'V02 includes the missing console helper.',

    telemetryAffected:
      false,

    reExtractionRequired:
      false
  },


  script105Audit: {

    previousStatus:
      script105?.patchEraSignatureStatus ??
      null,

    previousInterpretationWithdrawn:
      true,

    reason:
      'Script105 selected patch era by RMSE alone despite large disagreement with MAE and within-1/within-2 accuracy.',

    telemetryAffected:
      false
  },


  methodology: {

    replicationUnit:
      'REPLAY',

    eligibleCaseDefinition:
      'Same primary cohort as Script105: strict death↔AssignedGold match, unique credited player, isolated exact-tick economy, credited recipient present, leading team, pre-35-minute death, normal-HP-like ordinary Trooper.',

    singleModelComparison:
      'Each era is evaluated as one ground-only reward curve.',

    mixtureComparison:
      'Each era is also evaluated with two allowed latent components: ground-only versus ground+flying. Each case is assigned to whichever candidate gives the lower absolute residual.',

    postJuneMixture:
      '50% ground versus 50% ground + 50% flying.',

    preJuneMixture:
      '60% ground versus 60% ground + 40% flying.',

    caveat:
      'Latent mixture assignment is diagnostic and does not establish that the second component is actually flying-soul acquisition.',

    robustWinner:
      'Era comparison prioritizes median absolute error, then MAE, then 20%-trimmed RMSE, rather than raw RMSE.'
  },


  replayCounts: {

    total:
      replayResults.length,

    informative:
      informativeReplays.length,

    postRobustWins:
      postRobustWins.length,

    preRobustWins:
      preRobustWins.length,

    postSingleCaseMajority:
      postSingleCaseMajority.length,

    postMixtureStrong:
      postMixtureStrongReplays.length
  },


  distributions,

  postMixtureAssignments,

  replays:
    replayResults,

  pooledDescriptive:
    pooled,

  interpretation,


  nextStage: {

    ifPostMixture:
      'Directly test whether the second component corresponds to flying CItemXP acquisition or another same-tick reward source.',

    ifPostOutliers:
      'Characterize positive residual events by timing, recipient set, Trooper subtype, and concurrent telemetry.',

    ifPre:
      'Promote reward magnitude as patch-version conditioned.',

    ifMixed:
      'Extract replay build/date metadata before further mechanic inference.'
  },


  outputs: {

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
// CONSOLE SUMMARY
// ============================================================

console.log(
  '========================================================'
);

console.log(
  'REWARD MIXTURE / OUTLIER SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'REPLAY-LEVEL ROBUST RESULTS'
);

console.log(
  '---------------------------'
);


for (
  const row
  of replayResults
) {

  printReplayResult(
    row
  );
}


// ============================================================
// POOLED
// ============================================================

console.log('');

console.log(
  'POOLED DESCRIPTIVE'
);

console.log(
  '------------------'
);


console.log(
  `Cases: ${allCases.length}`
);


console.log('');


printPooledEra(
  'POST-JUNE-30',
  pooled
    .eras
    .POST_JUNE_30_2026
);


console.log('');


printPooledEra(
  'PRE-JUNE-30',
  pooled
    .eras
    .PRE_JUNE_30_2026
);


// ============================================================
// STATUS
// ============================================================

console.log('');

console.log(
  'AUDITED REWARD STATUS'
);

console.log(
  '---------------------'
);


console.log(
  status
);


console.log('');

console.log(
  'INTERPRETATION'
);

console.log(
  '--------------'
);


console.log(
  interpretation.primaryConclusion
);


if (
  interpretation.secondComponentCandidate
) {

  console.log('');


  console.log(
    `Second-component candidate: ${interpretation.secondComponentCandidate}`
  );
}


if (
  interpretation.nextQuestion
) {

  console.log('');


  console.log(
    `Next question: ${interpretation.nextQuestion}`
  );
}


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
// ANALYZE ONE REPLAY
// ============================================================

async function analyzeReplay(
  replayName
) {

  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const deathsPath =
    resolve(
      outputDirectory,
      'replication_trooper_deaths_v01.jsonl'
    );


  const activationsPath =
    resolve(
      outputDirectory,
      'replication_assigned_gold_activations_v01.jsonl'
    );


  const currencyPath =
    resolve(
      outputDirectory,
      'replication_currency0_deltas_v01.jsonl'
    );


  for (
    const path
    of [
      deathsPath,
      activationsPath,
      currencyPath
    ]
  ) {

    if (
      !existsSync(
        path
      )
    ) {

      throw new Error(
        `Missing ${replayName} input:\n${path}`
      );
    }
  }


  const deaths =
    await loadJsonl(
      deathsPath
    );


  const activations =
    await loadJsonl(
      activationsPath
    );


  const currency =
    await loadJsonl(
      currencyPath
    );


  const strictMatches =
    buildStrictMatches(
      deaths,
      activations
    );


  const cleanEconomic =
    buildCleanEconomicCases(
      strictMatches,
      currency
    );


  const eligible =
    cleanEconomic.filter(
      isEligibleCase
    );


  const analyzed =
    analyzeCaseSet(
      eligible
    );


  return {

    summary: {

      replay:
        replayName,

      strictMatches:
        strictMatches.length,

      cleanEconomicCases:
        cleanEconomic.length,

      eligibleCases:
        eligible.length,

      ...analyzed
    },

    cases:
      eligible
  };
}


// ============================================================
// CASE SET ANALYSIS
// ============================================================

function analyzeCaseSet(
  cases
) {

  const eras =
    {};


  for (
    const era
    of Object.values(
      ERAS
    )
  ) {

    eras[
      era.id
    ] =
      analyzeEra(
        cases,
        era
      );
  }


  // ----------------------------------------------------------
  // SINGLE-MODEL CASE WINNERS
  // ----------------------------------------------------------

  const postSingle =
    eras
      .POST_JUNE_30_2026
      .single
      .bestRobust;


  const preSingle =
    eras
      .PRE_JUNE_30_2026
      .single
      .bestRobust;


  let postWins =
    0;


  let preWins =
    0;


  let ties =
    0;


  for (
    const row
    of cases
  ) {

    const postPrediction =
      predictSingle(

        row,

        ERAS.POST_JUNE_30_2026,

        postSingle.rounding
      );


    const prePrediction =
      predictSingle(

        row,

        ERAS.PRE_JUNE_30_2026,

        preSingle.rounding
      );


    const postError =
      Math.abs(
        row.teamTotal -
        postPrediction
      );


    const preError =
      Math.abs(
        row.teamTotal -
        prePrediction
      );


    if (
      postError <
      preError
    ) {

      postWins++;

    } else if (
      preError <
      postError
    ) {

      preWins++;

    } else {

      ties++;
    }
  }


  // ----------------------------------------------------------
  // ROBUST ERA WINNER
  //
  // Compare the corresponding two-component models because the
  // purpose of this audit is to determine whether one historical
  // baseline remains superior after allowing a possible second
  // same-tick reward component under BOTH eras.
  // ----------------------------------------------------------

  const postMixture =
    eras
      .POST_JUNE_30_2026
      .mixture
      .best;


  const preMixture =
    eras
      .PRE_JUNE_30_2026
      .mixture
      .best;


  const comparison =
    compareRobustMetrics(
      postMixture,
      preMixture
    );


  const robustEraWinner =
    comparison <
      0
      ? 'POST_JUNE_30_2026'
      : comparison >
          0
        ? 'PRE_JUNE_30_2026'
        : 'TIE';


  return {

    eras,


    singleModelCaseWinners: {

      post:
        postWins,

      pre:
        preWins,

      ties,

      postRate:
        rate(
          postWins,
          postWins +
          preWins +
          ties
        ),

      preRate:
        rate(
          preWins,
          postWins +
          preWins +
          ties
        )
    },


    robustEraWinner
  };
}


// ============================================================
// ANALYZE ERA
// ============================================================

function analyzeEra(
  cases,
  era
) {

  const singleResults =
    ROUNDING_OPTIONS.map(
      rounding =>
        evaluateSingleModel(
          cases,
          era,
          rounding
        )
    );


  const mixtureResults =
    ROUNDING_OPTIONS.map(
      rounding =>
        evaluateMixtureModel(
          cases,
          era,
          rounding
        )
    );


  const singleSorted =
    [
      ...singleResults
    ]
      .sort(
        compareRobustMetrics
      );


  const mixtureSorted =
    [
      ...mixtureResults
    ]
      .sort(
        compareRobustMetrics
      );


  return {

    single: {

      bestRobust:
        singleSorted[0]
        ??
        null,

      all:
        singleResults
    },


    mixture: {

      best:
        mixtureSorted[0]
        ??
        null,

      all:
        mixtureResults
    }
  };
}


// ============================================================
// SINGLE MODEL
// ============================================================

function evaluateSingleModel(
  cases,
  era,
  rounding
) {

  const residuals =
    [];


  for (
    const row
    of cases
  ) {

    const predicted =
      predictSingle(
        row,
        era,
        rounding
      );


    residuals.push(
      row.teamTotal -
      predicted
    );
  }


  return buildErrorMetrics({

    residuals,

    rounding,

    model:
      'GROUND_ONLY'
  });
}


// ============================================================
// MIXTURE MODEL
//
// Candidate A:
//   ground only
//
// Candidate B:
//   ground + flying
//
// Each event is assigned to the candidate giving the smaller
// absolute error.
//
// IMPORTANT:
//
// This is latent diagnostic classification.
//
// It does NOT prove the second reward was a flying soul.
// ============================================================

function evaluateMixtureModel(
  cases,
  era,
  rounding
) {

  const residuals =
    [];


  let groundOnlyAssignments =
    0;


  let combinedAssignments =
    0;


  let assignmentTies =
    0;


  const componentRows =
    [];


  for (
    const row
    of cases
  ) {

    const groundOnly =
      predictSingle(
        row,
        era,
        rounding
      );


    const combined =
      predictCombined(
        row,
        era,
        rounding
      );


    const groundResidual =
      row.teamTotal -
      groundOnly;


    const combinedResidual =
      row.teamTotal -
      combined;


    const groundAbs =
      Math.abs(
        groundResidual
      );


    const combinedAbs =
      Math.abs(
        combinedResidual
      );


    let selectedResidual;


    let component;


    if (
      groundAbs <
      combinedAbs
    ) {

      groundOnlyAssignments++;


      selectedResidual =
        groundResidual;


      component =
        'GROUND_ONLY';

    } else if (
      combinedAbs <
      groundAbs
    ) {

      combinedAssignments++;


      selectedResidual =
        combinedResidual;


      component =
        'GROUND_PLUS_FLYING';

    } else {

      assignmentTies++;


      groundOnlyAssignments++;


      selectedResidual =
        groundResidual;


      component =
        'TIE_GROUND_ONLY_SELECTED';
    }


    residuals.push(
      selectedResidual
    );


    componentRows.push({

      observed:
        row.teamTotal,

      groundOnly,

      combined,

      component,

      residual:
        selectedResidual
    });
  }


  return {

    ...buildErrorMetrics({

      residuals,

      rounding,

      model:
        'GROUND_ONLY_OR_GROUND_PLUS_FLYING'
    }),

    groundOnlyAssignments,

    combinedAssignments,

    assignmentTies,

    combinedAssignmentRate:
      rate(
        combinedAssignments,
        cases.length
      ),

    componentRows
  };
}


// ============================================================
// PREDICTIONS
// ============================================================

function predictSingle(
  row,
  era,
  rounding
) {

  const totalBounty =
    era.totalIntercept

    +

    era.totalSlope *
    row.minute;


  const groundPool =
    totalBounty

    *

    era.groundFraction

    *

    row.shareMultiplier;


  return applyRounding(
    groundPool,
    rounding
  );
}


function predictCombined(
  row,
  era,
  rounding
) {

  const totalBounty =
    era.totalIntercept

    +

    era.totalSlope *
    row.minute;


  const groundPool =
    totalBounty

    *

    era.groundFraction

    *

    row.shareMultiplier;


  const flyingPool =
    totalBounty

    *

    era.flyingFraction

    *

    row.shareMultiplier;


  // ----------------------------------------------------------
  // Treat candidate ground and flying components as separately
  // integerized rewards.
  // ----------------------------------------------------------

  return (
    applyRounding(
      groundPool,
      rounding
    )

    +

    applyRounding(
      flyingPool,
      rounding
    )
  );
}


// ============================================================
// ERROR METRICS
// ============================================================

function buildErrorMetrics({

  residuals,

  rounding,

  model
}) {

  const clean =
    residuals.filter(
      Number.isFinite
    );


  const absolute =
    clean.map(
      Math.abs
    );


  const squared =
    clean.map(
      value =>
        value ** 2
    );


  const exact =
    absolute.filter(
      value =>
        value <
        1e-9
    ).length;


  const within1 =
    absolute.filter(
      value =>
        value <=
        1
    ).length;


  const within2 =
    absolute.filter(
      value =>
        value <=
        2
    ).length;


  const within3 =
    absolute.filter(
      value =>
        value <=
        3
    ).length;


  const trimmedRMSE =
    {};


  for (
    const trim
    of TRIM_LEVELS
  ) {

    trimmedRMSE[
      String(
        Math.round(
          trim *
          100
        )
      )
    ] =
      calculateTrimmedRMSE(
        clean,
        trim
      );
  }


  return {

    model,

    rounding,

    count:
      clean.length,

    rmse:
      clean.length >
      0
        ? Math.sqrt(
            mean(
              squared
            )
          )
        : null,

    mae:
      mean(
        absolute
      ),

    medianAbsoluteError:
      median(
        absolute
      ),

    residual:
      summarizeNumbers(
        clean
      ),

    absoluteResidual:
      summarizeNumbers(
        absolute
      ),

    trimmedRMSE,

    exact,

    exactRate:
      rate(
        exact,
        clean.length
      ),

    within1,

    within1Rate:
      rate(
        within1,
        clean.length
      ),

    within2,

    within2Rate:
      rate(
        within2,
        clean.length
      ),

    within3,

    within3Rate:
      rate(
        within3,
        clean.length
      )
  };
}


// ============================================================
// ROBUST MODEL COMPARATOR
//
// Lower is better.
//
// Ordering:
//
//   1. median absolute error
//   2. MAE
//   3. 20%-trimmed RMSE
//   4. raw RMSE
// ============================================================

function compareRobustMetrics(
  a,
  b
) {

  return (

    compareNullable(
      a?.medianAbsoluteError,
      b?.medianAbsoluteError
    )

    ||

    compareNullable(
      a?.mae,
      b?.mae
    )

    ||

    compareNullable(
      a?.trimmedRMSE?.['20'],
      b?.trimmedRMSE?.['20']
    )

    ||

    compareNullable(
      a?.rmse,
      b?.rmse
    )
  );
}


// ============================================================
// TRIMMED RMSE
// ============================================================

function calculateTrimmedRMSE(
  residuals,
  trimFraction
) {

  if (
    residuals.length ===
    0
  ) {

    return null;
  }


  const sorted =
    residuals
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a
          )
          -
          Math.abs(
            b
          )
      );


  const keep =
    Math.max(

      1,

      Math.floor(
        sorted.length *
        (
          1 -
          trimFraction
        )
      )
    );


  const retained =
    sorted.slice(
      0,
      keep
    );


  return Math.sqrt(

    mean(
      retained.map(
        value =>
          value ** 2
      )
    )
  );
}


// ============================================================
// ELIGIBLE CASE
// ============================================================

function isEligibleCase(
  row
) {

  if (
    !Number.isFinite(
      row.minute
    )
    ||
    row.minute <
      0
    ||
    row.minute >=
      35
  ) {

    return false;
  }


  if (
    row.teamState !==
    'LEADING'
  ) {

    return false;
  }


  if (
    row.normalHpLike !==
    true
  ) {

    return false;
  }


  const multiplier =
    SHARE_TOTAL_MULTIPLIER.get(
      row.recipientCount
    );


  if (
    !Number.isFinite(
      multiplier
    )
  ) {

    return false;
  }


  row.shareMultiplier =
    multiplier;


  return true;
}


// ============================================================
// STRICT MATCHING
// ============================================================

function buildStrictMatches(
  deaths,
  activations
) {

  const economicDeaths =
    deaths.filter(
      row =>
        row.economicBaseType ===
        true
    );


  const activationsByTick =
    groupBy(
      activations,
      row =>
        Number(
          row.activationTick
        )
    );


  const deathCandidates =
    new Map();


  const activationCandidates =
    new Map();


  for (
    const death
    of economicDeaths
  ) {

    const deathId =
      String(
        death.deathIndex ??
        `${death.entityIndex}|${death.tick}`
      );


    const candidates =
      [];


    for (
      let tick =
        Number(
          death.tick
        )
        +
        MATCH_MIN_TICK_OFFSET;

      tick <=
        Number(
          death.tick
        )
        +
        MATCH_MAX_TICK_OFFSET;

      tick++
    ) {

      for (
        const activation
        of activationsByTick.get(
          tick
        )
        ??
        []
      ) {

        if (
          !death.position
          ||
          !activation.position
        ) {

          continue;
        }


        const edgeDistance =
          distance3D(
            death.position,
            activation.position
          );


        if (
          edgeDistance >
          MATCH_MAX_DISTANCE_3D_HU
        ) {

          continue;
        }


        const activationId =
          String(
            activation.activationId
          );


        const edge = {

          death,

          activation,

          deathId,

          activationId,

          edgeDistance
        };


        candidates.push(
          edge
        );


        if (
          !activationCandidates.has(
            activationId
          )
        ) {

          activationCandidates.set(
            activationId,
            []
          );
        }


        activationCandidates
          .get(
            activationId
          )
          .push(
            edge
          );
      }
    }


    deathCandidates.set(
      deathId,
      candidates
    );
  }


  const strict =
    [];


  for (
    const candidates
    of deathCandidates.values()
  ) {

    if (
      candidates.length !==
      1
    ) {

      continue;
    }


    const edge =
      candidates[
        0
      ];


    const reverse =
      activationCandidates.get(
        edge.activationId
      )
      ??
      [];


    if (
      reverse.length !==
      1
    ) {

      continue;
    }


    strict.push(
      edge
    );
  }


  return strict;
}


// ============================================================
// CLEAN ECONOMIC CASES
// ============================================================

function buildCleanEconomicCases(
  strictMatches,
  currencyEvents
) {

  const currencyByTick =
    groupBy(
      currencyEvents,
      row =>
        Number(
          row.tick
        )
    );


  const provisional =
    [];


  for (
    const edge
    of strictMatches
  ) {

    const death =
      edge.death;


    const activation =
      edge.activation;


    const credited =
      death
        ?.lastHitEvidence
        ?.uniqueExactOpposing
      ??
      null;


    if (
      !credited
    ) {

      continue;
    }


    const creditedName =
      credited.playerName
      ??
      null;


    const creditedTeam =
      finite(
        credited.team
      );


    const endTick =
      finite(
        activation.endTick
      );


    if (
      !creditedName
      ||
      creditedTeam ===
        null
      ||
      endTick ===
        null
    ) {

      continue;
    }


    const exact =
      aggregateCurrencyEvents(
        currencyByTick.get(
          endTick
        )
        ??
        []
      );


    const sameTeam =
      exact.filter(
        row =>
          row.team ===
            creditedTeam
        &&
          row.delta >
            0
      );


    const opponents =
      exact.filter(
        row =>
          row.team !==
            null
        &&
          row.team !==
            creditedTeam
        &&
          row.delta >
            0
      );


    const creditedRecipient =
      sameTeam.find(
        row =>
          row.playerName ===
          creditedName
      )
      ??
      null;


    provisional.push({

      death,

      activation,

      creditedTeam,

      creditedName,

      endTick,

      sameTeam,

      opponents,

      creditedRecipient
    });
  }


  // ----------------------------------------------------------
  // ONE MATCHED GROUND SOUL PER TEAM / END TICK
  // ----------------------------------------------------------

  const eventCount =
    new Map();


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    eventCount.set(

      key,

      (
        eventCount.get(
          key
        )
        ??
        0
      )
      +
      1
    );
  }


  const output =
    [];


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    if (
      eventCount.get(
        key
      ) !==
      1
    ) {

      continue;
    }


    if (
      row.activation.endReason !==
      'BECAME_INACTIVE'
    ) {

      continue;
    }


    if (
      row.sameTeam.length ===
      0
    ) {

      continue;
    }


    if (
      row.opponents.length !==
      0
    ) {

      continue;
    }


    if (
      !row.creditedRecipient
    ) {

      continue;
    }


    const teamTotal =
      row.sameTeam.reduce(
        (
          sum,
          player
        ) =>
          sum +
          player.delta,
        0
      );


    const recipientCount =
      row.sameTeam.length;


    const minute =
      Number(
        row.death.timeSeconds
      )
      /
      60;


    const teamState =
      classifyTeamNetWorthState(
        row.death.playersAtDeath,
        row.creditedTeam
      );


    const hp =
      classifyNormalHpLike(
        row.death
      );


    output.push({

      death:
        row.death,

      activation:
        row.activation,

      teamTotal,

      recipientCount,

      minute,

      teamState,

      normalHpLike:
        hp.normalHpLike,

      baseHp:
        hp.baseHp,

      hpRatio:
        hp.hpRatio,

      sameTeamRecipients:
        row.sameTeam
    });
  }


  return output;
}


// ============================================================
// CURRENCY AGGREGATION
// ============================================================

function aggregateCurrencyEvents(
  events
) {

  const map =
    new Map();


  for (
    const event
    of events
  ) {

    const playerName =
      event.playerName
      ??
      null;


    const delta =
      finite(
        event.delta
      );


    if (
      !playerName
      ||
      delta ===
        null
      ||
      delta <=
        0
    ) {

      continue;
    }


    if (
      !map.has(
        playerName
      )
    ) {

      map.set(

        playerName,

        {

          playerName,

          team:
            finite(
              event.team
            ),

          delta:
            0
        }
      );
    }


    map.get(
      playerName
    ).delta +=
      delta;
  }


  return [
    ...map.values()
  ];
}


// ============================================================
// HP SCREEN
// ============================================================

function classifyNormalHpLike(
  death
) {

  const baseHp =
    NORMAL_BASE_HP.get(
      death.baseType
    )
    ??
    null;


  const maxHealth =
    finite(
      death.maxHealth
    );


  if (
    !Number.isFinite(
      baseHp
    )
    ||
    maxHealth ===
      null
    ||
    maxHealth <=
      0
  ) {

    return {

      normalHpLike:
        false,

      baseHp,

      hpRatio:
        null
    };
  }


  const hpRatio =
    maxHealth /
    baseHp;


  return {

    normalHpLike:

      hpRatio >=
      0.90

      &&

      hpRatio <=
      MAX_NORMAL_HP_RATIO,

    baseHp,

    hpRatio
  };
}


// ============================================================
// TEAM NET WORTH
// ============================================================

function classifyTeamNetWorthState(
  players,
  creditedTeam
) {

  if (
    !Array.isArray(
      players
    )
  ) {

    return 'UNKNOWN';
  }


  const totals =
    new Map();


  for (
    const player
    of players
  ) {

    const team =
      finite(
        player.team
      );


    const netWorth =
      finite(
        player.netWorth
      );


    if (
      team ===
        null
      ||
      netWorth ===
        null
    ) {

      continue;
    }


    totals.set(

      team,

      (
        totals.get(
          team
        )
        ??
        0
      )
      +
      netWorth
    );
  }


  if (
    !totals.has(
      creditedTeam
    )
  ) {

    return 'UNKNOWN';
  }


  const own =
    totals.get(
      creditedTeam
    );


  const other =
    [
      ...totals.entries()
    ]
      .filter(
        (
          [
            team
          ]
        ) =>
          team !==
          creditedTeam
      )
      .map(
        (
          [
            team,
            value
          ]
        ) =>
          value
      );


  if (
    other.length ===
    0
  ) {

    return 'UNKNOWN';
  }


  const opponent =
    Math.max(
      ...other
    );


  if (
    own >
    opponent
  ) {

    return 'LEADING';
  }


  if (
    own <
    opponent
  ) {

    return 'TRAILING';
  }


  return 'TIED';
}


// ============================================================
// ROUNDING
// ============================================================

function applyRounding(
  value,
  rounding
) {

  switch (
    rounding
  ) {

    case 'FLOOR':

      return Math.floor(
        value
      );


    case 'ROUND':

      return Math.round(
        value
      );


    case 'CEIL':

      return Math.ceil(
        value
      );


    default:

      return value;
  }
}


// ============================================================
// DISTANCE
// ============================================================

function distance3D(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return Infinity;
  }


  const x1 =
    finite(
      a.x
    );


  const y1 =
    finite(
      a.y
    );


  const z1 =
    finite(
      a.z
    );


  const x2 =
    finite(
      b.x
    );


  const y2 =
    finite(
      b.y
    );


  const z2 =
    finite(
      b.z
    );


  if (
    x1 ===
      null
    ||
    y1 ===
      null
    ||
    x2 ===
      null
    ||
    y2 ===
      null
  ) {

    return Infinity;
  }


  const dz =
    z1 !==
      null
    &&
    z2 !==
      null
      ? z1 -
        z2
      : 0;


  return Math.sqrt(

    (
      x1 -
      x2
    )
    ** 2

    +

    (
      y1 -
      y2
    )
    ** 2

    +

    dz
    ** 2
  );
}


// ============================================================
// JSONL
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


// ============================================================
// GROUP BY
// ============================================================

function groupBy(
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
      selector(
        row
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        []
      );
    }


    map.get(
      key
    ).push(
      row
    );
  }


  return map;
}


// ============================================================
// NUMERIC
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


function mean(
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


  return clean.reduce(
    (
      sum,
      value
    ) =>
      sum +
      value,
    0
  )
  /
  clean.length;
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


  if (
    clean.length ===
    0
  ) {

    return null;
  }


  return quantile(
    clean,
    0.5
  );
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


function compareNullable(
  a,
  b
) {

  const aa =
    Number.isFinite(
      a
    )
      ? a
      : Infinity;


  const bb =
    Number.isFinite(
      b
    )
      ? b
      : Infinity;


  return aa -
    bb;
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

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      mean(
        clean
      )
  };
}


function quantile(
  sorted,
  q
) {

  if (
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
// V02 FIX: REPLAY CONSOLE RENDERER
// ============================================================

function printReplayResult(
  row
) {

  const postSingle =
    row
      ?.eras
      ?.POST_JUNE_30_2026
      ?.single
      ?.bestRobust
    ??
    null;


  const preSingle =
    row
      ?.eras
      ?.PRE_JUNE_30_2026
      ?.single
      ?.bestRobust
    ??
    null;


  const postMix =
    row
      ?.eras
      ?.POST_JUNE_30_2026
      ?.mixture
      ?.best
    ??
    null;


  const preMix =
    row
      ?.eras
      ?.PRE_JUNE_30_2026
      ?.mixture
      ?.best
    ??
    null;


  console.log('');

  console.log(
    row.replay
  );


  console.log(
    `  eligible:                 ${row.eligibleCases}`
  );


  console.log(
    `  POST single rounding:     ${postSingle?.rounding ?? 'n/a'}`
  );


  console.log(
    `  POST single median|e|:    ${formatNumber(
      postSingle?.medianAbsoluteError
    )}`
  );


  console.log(
    `  POST single MAE:          ${formatNumber(
      postSingle?.mae
    )}`
  );


  console.log(
    `  POST single <=2:          ${formatPercent(
      postSingle?.within2Rate
    )}`
  );


  console.log(
    `  PRE single rounding:      ${preSingle?.rounding ?? 'n/a'}`
  );


  console.log(
    `  PRE single median|e|:     ${formatNumber(
      preSingle?.medianAbsoluteError
    )}`
  );


  console.log(
    `  PRE single MAE:           ${formatNumber(
      preSingle?.mae
    )}`
  );


  console.log(
    `  PRE single <=2:           ${formatPercent(
      preSingle?.within2Rate
    )}`
  );


  console.log(
    `  case winner POST/PRE/TIE: ${row?.singleModelCaseWinners?.post ?? 0}/${row?.singleModelCaseWinners?.pre ?? 0}/${row?.singleModelCaseWinners?.ties ?? 0}`
  );


  console.log(
    `  case winner POST rate:    ${formatPercent(
      row
        ?.singleModelCaseWinners
        ?.postRate
    )}`
  );


  console.log(
    `  POST mixture rounding:    ${postMix?.rounding ?? 'n/a'}`
  );


  console.log(
    `  POST mixture <=2:         ${formatPercent(
      postMix?.within2Rate
    )}`
  );


  console.log(
    `  POST mixture median|e|:   ${formatNumber(
      postMix?.medianAbsoluteError
    )}`
  );


  console.log(
    `  POST mixture MAE:         ${formatNumber(
      postMix?.mae
    )}`
  );


  console.log(
    `  POST mixture combined:    ${postMix?.combinedAssignments ?? 0}/${row.eligibleCases} (${formatPercent(
      postMix?.combinedAssignmentRate
    )})`
  );


  console.log(
    `  PRE mixture rounding:     ${preMix?.rounding ?? 'n/a'}`
  );


  console.log(
    `  PRE mixture <=2:          ${formatPercent(
      preMix?.within2Rate
    )}`
  );


  console.log(
    `  PRE mixture median|e|:    ${formatNumber(
      preMix?.medianAbsoluteError
    )}`
  );


  console.log(
    `  PRE mixture MAE:          ${formatNumber(
      preMix?.mae
    )}`
  );


  console.log(
    `  robust era winner:        ${row.robustEraWinner}`
  );
}


// ============================================================
// POOLED CONSOLE
// ============================================================

function printPooledEra(
  label,
  era
) {

  const single =
    era
      .single
      .bestRobust;


  const mixture =
    era
      .mixture
      .best;


  console.log(
    label
  );


  console.log(
    `  single rounding:  ${single.rounding}`
  );


  console.log(
    `  single median|e|: ${formatNumber(
      single.medianAbsoluteError
    )}`
  );


  console.log(
    `  single MAE:       ${formatNumber(
      single.mae
    )}`
  );


  console.log(
    `  single <=2:       ${formatPercent(
      single.within2Rate
    )}`
  );


  console.log(
    `  mixture rounding: ${mixture.rounding}`
  );


  console.log(
    `  mixture median|e|:${formatNumber(
      mixture.medianAbsoluteError
    )}`
  );


  console.log(
    `  mixture MAE:      ${formatNumber(
      mixture.mae
    )}`
  );


  console.log(
    `  mixture <=2:      ${formatPercent(
      mixture.within2Rate
    )}`
  );


  console.log(
    `  mixture combined: ${mixture.combinedAssignments}/${mixture.count} (${formatPercent(
      mixture.combinedAssignmentRate
    )})`
  );
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


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Reward Mixture / Outlier Diagnostic V0.2'
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## V01 correction'
  );


  lines.push(
    ''
  );


  lines.push(
    'V01 omitted the `printReplayResult()` console helper and therefore crashed after completing the first replay analysis. V02 restores that helper. No telemetry or extraction data were affected.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Script105 audit'
  );


  lines.push(
    ''
  );


  lines.push(
    'The Script105 pre-June-30 conclusion remains withdrawn because it selected patch era using RMSE alone despite contradictory MAE and near-exact accuracy.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Replay results'
  );


  lines.push(
    ''
  );


  for (
    const replay
    of summary.replays
  ) {

    const post =
      replay
        .eras
        .POST_JUNE_30_2026;


    const pre =
      replay
        .eras
        .PRE_JUNE_30_2026;


    lines.push(
      `### ${replay.replay}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Eligible cases: ${replay.eligibleCases}`
    );


    lines.push(
      `- POST ground-only median absolute error: ${formatNumber(post.single.bestRobust.medianAbsoluteError)}`
    );


    lines.push(
      `- PRE ground-only median absolute error: ${formatNumber(pre.single.bestRobust.medianAbsoluteError)}`
    );


    lines.push(
      `- POST case-level win rate: ${formatPercent(replay.singleModelCaseWinners.postRate)}`
    );


    lines.push(
      `- POST mixture within ±2: ${formatPercent(post.mixture.best.within2Rate)}`
    );


    lines.push(
      `- POST mixture second-component rate: ${formatPercent(post.mixture.best.combinedAssignmentRate)}`
    );


    lines.push(
      `- PRE mixture within ±2: ${formatPercent(pre.mixture.best.within2Rate)}`
    );


    lines.push(
      `- Robust era winner: **${replay.robustEraWinner}**`
    );


    lines.push(
      ''
    );
  }


  lines.push(
    '## Interpretation'
  );


  lines.push(
    ''
  );


  lines.push(
    summary.interpretation.primaryConclusion
  );


  if (
    summary.interpretation.secondComponentCandidate
  ) {

    lines.push(
      ''
    );


    lines.push(
      summary.interpretation.secondComponentCandidate
    );
  }


  if (
    summary.interpretation.nextQuestion
  ) {

    lines.push(
      ''
    );


    lines.push(
      `Next question: ${summary.interpretation.nextQuestion}`
    );
  }


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}