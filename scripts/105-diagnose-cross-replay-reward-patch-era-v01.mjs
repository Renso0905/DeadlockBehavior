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


const EVENT_BATCH_PATH =
  resolve(
    'output',
    'cross_replay',
    'compact_event_replication_extraction_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_patch_era_diagnostic_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_patch_era_diagnostic_v01.md'
  );


// ============================================================
// DOCUMENTED HISTORICAL MODELS
//
// PRE-JUNE-30-2026:
//
//   total Trooper bounty:
//     116 + 1.16/min
//
//   flying proportion:
//     40%
//
//   therefore ground proportion:
//     60%
//
//   ground:
//     69.6 + 0.696/min
//
//
// POST-JUNE-30-2026:
//
//   total Trooper bounty:
//     100 + 2/min
//
//   flying proportion:
//     50%
//
//   therefore ground proportion:
//     50%
//
//   ground:
//     50 + 1/min
//
// ============================================================

const MODELS = {

  PRE_JUNE_30_2026: {

    id:
      'PRE_JUNE_30_2026',

    totalIntercept:
      116,

    totalSlope:
      1.16,

    groundFraction:
      0.60,

    groundIntercept:
      69.6,

    groundSlope:
      0.696
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

    groundIntercept:
      50,

    groundSlope:
      1
  }
};


// ============================================================
// SHARE TOTAL MULTIPLIERS
//
// Same sharing structure used in the validated discovery work.
//
// These are aggregate total multipliers after N-player sharing:
//
// 1 -> 1.00
// 2 -> 1.08
// 3 -> 1.08
// 4 -> 1.00
// 5 -> 1.00
// 6 -> 0.96
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
// DEATH <-> ASSIGNEDGOLD MATCHING
// ============================================================

const MATCH_MIN_TICK_OFFSET =
  -1;


const MATCH_MAX_TICK_OFFSET =
  4;


const MATCH_MAX_DISTANCE_3D_HU =
  160;


// ============================================================
// NORMAL TROOPER HP PRIORS
//
// We restrict the primary diagnostic to:
//
//   match minute <35
//   normal-HP-like Troopers
//   leading team
//
// This minimizes:
//
//   comeback modifier
//   global post-35 HP modification
//   Super Trooper modifier
//   Rift classification contamination
//
// Super Trooper HP is substantially above ordinary base HP,
// so a generous <=1.20 ratio screens obvious upgraded units.
//
// This is a diagnostic filter, not a canonical variant rule.
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
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    EVENT_BATCH_PATH
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


const eventBatch =
  JSON.parse(
    readFileSync(
      EVENT_BATCH_PATH,
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


if (
  eventBatch
    ?.batchPass !==
  true
) {

  throw new Error(
    'Script102 event extraction did not pass.'
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
    'No independent replication cohort found.'
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
  'CROSS-REPLAY REWARD PATCH-ERA DIAGNOSTIC V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'DOCUMENTED MODEL CANDIDATES'
);


console.log(
  '---------------------------'
);


console.log(
  'PRE-JUNE-30-2026'
);


console.log(
  '  Total bounty:  116 + 1.16/min'
);


console.log(
  '  Ground share:  60%'
);


console.log(
  '  Ground reward: 69.6 + 0.696/min'
);


console.log('');


console.log(
  'POST-JUNE-30-2026'
);


console.log(
  '  Total bounty:  100 + 2/min'
);


console.log(
  '  Ground share:  50%'
);


console.log(
  '  Ground reward: 50 + 1/min'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'No raw replay parsing.'
);


console.log('');


// ============================================================
// REPLAY ANALYSIS
// ============================================================

const replayResults =
  [];


const allEligibleCases =
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
    of result.eligibleCases
  ) {

    allEligibleCases.push({

      replay:
        replayName,

      ...row
    });
  }


  printReplay(
    result.summary
  );


  console.log('');
}


// ============================================================
// POOLED DESCRIPTIVE MODEL COMPARISON
//
// This does NOT change the replication unit.
//
// It simply estimates the historical reward curve using all
// eligible economic observations after replay-level results have
// been computed.
// ============================================================

const pooledModelComparison =
  compareModels(
    allEligibleCases
  );


const pooledRegression =
  fitImpliedGroundRegression(
    allEligibleCases
  );


// ============================================================
// REPLAY-LEVEL MODEL WINNERS
// ============================================================

const preWins =
  replayResults.filter(
    row =>
      row.modelWinner ===
      'PRE_JUNE_30_2026'
  );


const postWins =
  replayResults.filter(
    row =>
      row.modelWinner ===
      'POST_JUNE_30_2026'
  );


const informativeReplays =
  replayResults.filter(
    row =>
      row.eligibleCases >=
      20
  );


const preSupportRate =
  rate(
    informativeReplays.filter(
      row =>
        row.modelWinner ===
        'PRE_JUNE_30_2026'
    ).length,
    informativeReplays.length
  );


// ============================================================
// PATCH-ERA SIGNATURE STATUS
// ============================================================

let patchEraSignatureStatus;


if (
  informativeReplays.length <
  3
) {

  patchEraSignatureStatus =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  preWins.length >=
    4
  &&
  (
    preSupportRate ??
    0
  ) >=
    0.80
  ) {

  patchEraSignatureStatus =
    'PRE_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED';

} else if (
  postWins.length >=
    4
  ) {

  patchEraSignatureStatus =
    'POST_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED';

} else {

  patchEraSignatureStatus =
    'MIXED_OR_UNRESOLVED_REWARD_REGIME';
}


// ============================================================
// REPLAY-LEVEL DISTRIBUTIONS
// ============================================================

const distributions = {

  empiricalIntercept:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.empiricalRegression
            ?.intercept
      )
    ),


  empiricalSlope:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.empiricalRegression
            ?.slope
      )
    ),


  preModelRMSE:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.models
            ?.PRE_JUNE_30_2026
            ?.best
            ?.rmse
      )
    ),


  postModelRMSE:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.models
            ?.POST_JUNE_30_2026
            ?.best
            ?.rmse
      )
    ),


  rmseImprovementUsingPre:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            ?.preVsPost
            ?.rmseImprovementFraction
      )
    )
};


// ============================================================
// BY RECIPIENT COUNT
// ============================================================

const pooledByRecipientCount =
  [];


for (
  const recipientCount
  of [
    1,
    2,
    3,
    4,
    5,
    6
  ]
) {

  const cases =
    allEligibleCases.filter(
      row =>
        row.recipientCount ===
        recipientCount
    );


  if (
    cases.length ===
    0
  ) {

    continue;
  }


  pooledByRecipientCount.push({

    recipientCount,

    count:
      cases.length,

    models:
      compareModels(
        cases
      )
  });
}


// ============================================================
// BY MATCH TIME
// ============================================================

const timeBins = [

  {
    id:
      '0_TO_10',

    minimum:
      0,

    maximum:
      10
  },

  {
    id:
      '10_TO_20',

    minimum:
      10,

    maximum:
      20
  },

  {
    id:
      '20_TO_35',

    minimum:
      20,

    maximum:
      35
  }
];


const pooledByTime =
  [];


for (
  const bin
  of timeBins
) {

  const cases =
    allEligibleCases.filter(
      row =>
        row.minute >=
          bin.minimum
        &&
        row.minute <
          bin.maximum
    );


  pooledByTime.push({

    ...bin,

    count:
      cases.length,

    models:
      compareModels(
        cases
      )
  });
}


// ============================================================
// RESIDUAL OUTLIER DIAGNOSTIC
//
// Large residuals under the winning historical model can later
// be inspected for:
//
//   Super Trooper modifier
//   other simultaneous reward events
//   classification errors
//   undocumented modifiers
//
// We do NOT fit those here.
// ============================================================

const winningModel =
  patchEraSignatureStatus ===
    'PRE_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED'
    ? MODELS.PRE_JUNE_30_2026
    : patchEraSignatureStatus ===
        'POST_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED'
      ? MODELS.POST_JUNE_30_2026
      : null;


const largeResidualCases =
  [];


if (
  winningModel
) {

  for (
    const row
    of allEligibleCases
  ) {

    const evaluation =
      evaluateCaseAgainstModel(
        row,
        winningModel,
        'ROUND'
      );


    if (
      Math.abs(
        evaluation.residual
      ) >
      5
    ) {

      largeResidualCases.push({

        replay:
          row.replay,

        deathTick:
          row.deathTick,

        minute:
          row.minute,

        baseType:
          row.baseType,

        maxHealth:
          row.maxHealth,

        recipientCount:
          row.recipientCount,

        observedTeamTotal:
          row.teamTotal,

        predictedTeamTotal:
          evaluation.predicted,

        residual:
          evaluation.residual
      });
    }
  }
}


// ============================================================
// FINAL INTERPRETATION
// ============================================================

let interpretation;


if (
  patchEraSignatureStatus ===
  'PRE_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED'
) {

  interpretation = {

    rewardDiscrepancyExplained:
      true,

    conclusion:
      'The replication cohort strongly expresses the documented pre-June-30-2026 Trooper economy signature: total bounty 116 + 1.16/min with 40% flying / 60% ground, yielding ground reward 69.6 + 0.696/min.',

    implication:
      'The test.dem post-June-30 reward curve and the independent replay cohort should be treated as different game-version strata rather than failed replications of one invariant reward formula.',

    recommendedAuthority:
      'Reward magnitude must be version-conditioned.',

    doNotDo:
      'Do not force one reward curve across both replay eras.'
  };

} else if (
  patchEraSignatureStatus ===
  'POST_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED'
) {

  interpretation = {

    rewardDiscrepancyExplained:
      false,

    conclusion:
      'The independent replay cohort favors the post-June-30 reward model, so the regression discrepancy requires another explanation.',

    implication:
      'Investigate remaining modifiers or economic-case contamination.',

    recommendedAuthority:
      'Keep reward magnitude unresolved.'
  };

} else {

  interpretation = {

    rewardDiscrepancyExplained:
      false,

    conclusion:
      'Neither historical reward model dominates strongly enough across independent replays.',

    implication:
      'Replay patch/build metadata or additional modifier classification is required.',

    recommendedAuthority:
      'Keep reward magnitude unresolved.'
  };
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    'CROSS_REPLAY_REWARD_PATCH_ERA_DIAGNOSTIC_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  patchEraSignatureStatus,


  historicalModels: {

    PRE_JUNE_30_2026:
      MODELS.PRE_JUNE_30_2026,

    POST_JUNE_30_2026:
      MODELS.POST_JUNE_30_2026
  },


  methodology: {

    replicationUnit:
      'REPLAY',

    primaryCohort:
      'Strict mutually unique Trooper-death ↔ AssignedGold matches with unique exact-tick opposing last-hit credit, isolated normal termination, no exact-tick opposing-team positive currency delta, credited recipient present, leading credited team, pre-35-minute death, and normal-HP-like Trooper.',

    normalHpScreen:
      `maxHealth / baseHP <= ${MAX_NORMAL_HP_RATIO}`,

    superTrooperHandling:
      'Obvious high-HP upgraded units are excluded from the primary reward-curve diagnostic. Exact Super classification is not claimed.',

    comebackHandling:
      'Trailing-team cases are excluded.',

    lateGameHandling:
      'Deaths at or after 35 minutes are excluded.',

    modelComparison:
      'Each historical model is evaluated under NONE, FLOOR, ROUND, and CEIL aggregate-team-total integerization. The best rounding result is reported separately for each model.',

    pooledUse:
      'Pooled cases are descriptive only. Cross-replay generalization is determined from replay-level model winners.'
  },


  replayCounts: {

    total:
      replayResults.length,

    informative:
      informativeReplays.length,

    preJune30Winner:
      preWins.length,

    postJune30Winner:
      postWins.length,

    preJune30SupportRate:
      preSupportRate
  },


  distributions,

  replays:
    replayResults,


  pooledDescriptive: {

    eligibleCases:
      allEligibleCases.length,

    empiricalRegression:
      pooledRegression,

    modelComparison:
      pooledModelComparison,

    byRecipientCount:
      pooledByRecipientCount,

    byTime:
      pooledByTime
  },


  residualDiagnostic: {

    winningHistoricalModel:
      winningModel?.id ??
      null,

    largeResidualThresholdSouls:
      5,

    largeResidualCases:
      largeResidualCases.length,

    examples:
      largeResidualCases.slice(
        0,
        50
      )
  },


  interpretation,


  nextStage: {

    ifPreJune30:
      'Update the foundational replication authority to treat reward magnitude as patch-version conditioned and proceed toward behavioral feature construction.',

    ifPostJune30:
      'Investigate economic modifiers or contamination.',

    ifMixed:
      'Extract or infer replay build/date information and stratify the cohort.'
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
  'REWARD PATCH-ERA DIAGNOSTIC SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'REPLAY-LEVEL MODEL WINNERS'
);

console.log(
  '--------------------------'
);


for (
  const row
  of replayResults
) {

  console.log('');

  console.log(
    row.replay
  );


  console.log(
    `  eligible cases:    ${row.eligibleCases}`
  );


  console.log(
    `  empirical curve:   ${formatNumber(
      row.empiricalRegression.intercept
    )} + ${formatNumber(
      row.empiricalRegression.slope
    )}*minute`
  );


  console.log(
    `  pre-June30 RMSE:   ${formatNumber(
      row.models.PRE_JUNE_30_2026.best.rmse
    )}`
  );


  console.log(
    `  post-June30 RMSE:  ${formatNumber(
      row.models.POST_JUNE_30_2026.best.rmse
    )}`
  );


  console.log(
    `  winner:            ${row.modelWinner}`
  );


  console.log(
    `  pre RMSE advantage:${formatPercent(
      row.preVsPost.rmseImprovementFraction
    )}`
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
  `Eligible cases:       ${allEligibleCases.length}`
);


console.log(
  `Empirical regression: ${formatNumber(
    pooledRegression.intercept
  )} + ${formatNumber(
    pooledRegression.slope
  )}*minute`
);


console.log('');

console.log(
  'PRE-JUNE-30 MODEL'
);


printModelMetrics(
  pooledModelComparison
    .PRE_JUNE_30_2026
    .best
);


console.log('');

console.log(
  'POST-JUNE-30 MODEL'
);


printModelMetrics(
  pooledModelComparison
    .POST_JUNE_30_2026
    .best
);


// ============================================================
// FINAL STATUS
// ============================================================

console.log('');

console.log(
  'PATCH-ERA SIGNATURE'
);

console.log(
  '-------------------'
);


console.log(
  patchEraSignatureStatus
);


console.log('');


console.log(
  `Pre-June30 winners:  ${preWins.length}/${informativeReplays.length}`
);


console.log(
  `Post-June30 winners: ${postWins.length}/${informativeReplays.length}`
);


console.log('');

console.log(
  'INTERPRETATION'
);

console.log(
  '--------------'
);


console.log(
  interpretation.conclusion
);


console.log('');

console.log(
  interpretation.implication
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
// REPLAY ANALYSIS
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


  const currencyEvents =
    await loadJsonl(
      currencyPath
    );


  const matching =
    buildStrictMatches(
      deaths,
      activations
    );


  const economic =
    buildCleanEconomicCases(
      matching.strictMatches,
      currencyEvents
    );


  const filterCounts = {

    cleanEconomic:
      economic.length,

    pre35:
      0,

    leading:
      0,

    normalHpLike:
      0,

    fullyEligible:
      0
  };


  const eligible =
    [];


  for (
    const row
    of economic
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

      continue;
    }


    filterCounts.pre35++;


    if (
      row.teamState !==
      'LEADING'
    ) {

      continue;
    }


    filterCounts.leading++;


    if (
      row.normalHpLike !==
      true
    ) {

      continue;
    }


    filterCounts.normalHpLike++;


    const shareMultiplier =
      SHARE_TOTAL_MULTIPLIER.get(
        row.recipientCount
      );


    if (
      !Number.isFinite(
        shareMultiplier
      )
    ) {

      continue;
    }


    filterCounts.fullyEligible++;


    eligible.push({

      deathTick:
        row.death.tick,

      minute:
        row.minute,

      teamTotal:
        row.teamTotal,

      recipientCount:
        row.recipientCount,

      shareMultiplier,

      impliedUnsharedGroundReward:
        row.teamTotal /
        shareMultiplier,

      baseType:
        row.death.baseType,

      maxHealth:
        row.death.maxHealth,

      baseHp:
        row.baseHp,

      hpRatio:
        row.hpRatio
    });
  }


  const empiricalRegression =
    fitImpliedGroundRegression(
      eligible
    );


  const models =
    compareModels(
      eligible
    );


  const preRMSE =
    models
      .PRE_JUNE_30_2026
      .best
      .rmse;


  const postRMSE =
    models
      .POST_JUNE_30_2026
      .best
      .rmse;


  let modelWinner;


  if (
    Number.isFinite(
      preRMSE
    )
    &&
    Number.isFinite(
      postRMSE
    )
  ) {

    modelWinner =
      preRMSE <
        postRMSE
        ? 'PRE_JUNE_30_2026'
        : postRMSE <
            preRMSE
          ? 'POST_JUNE_30_2026'
          : 'TIE';

  } else {

    modelWinner =
      'UNRESOLVED';
  }


  const rmseImprovementFraction =

    Number.isFinite(
      preRMSE
    )

    &&

    Number.isFinite(
      postRMSE
    )

    &&

    postRMSE >
      0

      ? (
          postRMSE -
          preRMSE
        )
        /
        postRMSE

      : null;


  const summary = {

    replay:
      replayName,

    strictMatches:
      matching.strictMatches.length,

    cleanEconomicCases:
      economic.length,

    filterCounts,

    eligibleCases:
      eligible.length,

    empiricalRegression,

    models,

    modelWinner,


    preVsPost: {

      preRMSE,

      postRMSE,

      rmseImprovementFraction
    }
  };


  return {

    summary,

    eligibleCases:
      eligible
  };
}


// ============================================================
// STRICT DEATH <-> ASSIGNEDGOLD MATCHING
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


  const strictMatches =
    [];


  for (
    const [
      deathId,
      candidates
    ]
    of deathCandidates
  ) {

    if (
      candidates.length !==
      1
    ) {

      continue;
    }


    const edge =
      candidates[0];


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


    strictMatches.push(
      edge
    );
  }


  return {

    strictMatches
  };
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


    const creditedPlayerName =
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
      !creditedPlayerName
      ||
      creditedTeam ===
        null
      ||
      endTick ===
        null
    ) {

      continue;
    }


    const exactEvents =
      currencyByTick.get(
        endTick
      )
      ??
      [];


    const aggregated =
      aggregateCurrencyEvents(
        exactEvents
      );


    const sameTeam =
      aggregated.filter(
        row =>
          row.team ===
            creditedTeam
        &&
          row.delta >
          0
      );


    const opponents =
      aggregated.filter(
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
          creditedPlayerName
      )
      ??
      null;


    provisional.push({

      death,

      activation,

      credited,

      creditedTeam,

      creditedPlayerName,

      endTick,

      sameTeam,

      opponents,

      creditedRecipient
    });
  }


  // ----------------------------------------------------------
  // ISOLATE ONE MATCHED GROUND-SOUL TERMINATION PER TEAM/TICK
  // ----------------------------------------------------------

  const countByEndTeam =
    new Map();


  for (
    const row
    of provisional
  ) {

    const key =
      `${row.endTick}|${row.creditedTeam}`;


    countByEndTeam.set(

      key,

      (
        countByEndTeam.get(
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
      countByEndTeam.get(
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
          recipient
        ) =>
          sum +
          recipient.delta,
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

      ...row,

      teamTotal,

      recipientCount,

      minute,

      teamState,

      normalHpLike:
        hp.normalHpLike,

      baseHp:
        hp.baseHp,

      hpRatio:
        hp.hpRatio
    });
  }


  return output;
}


// ============================================================
// NORMAL HP-LIKE CLASSIFIER
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
// MODEL COMPARISON
// ============================================================

function compareModels(
  cases
) {

  const output =
    {};


  for (
    const model
    of Object.values(
      MODELS
    )
  ) {

    const roundingResults =
      [];


    for (
      const rounding
      of [
        'NONE',
        'FLOOR',
        'ROUND',
        'CEIL'
      ]
    ) {

      roundingResults.push(
        evaluateModel(
          cases,
          model,
          rounding
        )
      );
    }


    roundingResults.sort(
      (
        a,
        b
      ) =>
        compareNullable(
          a.rmse,
          b.rmse
        )
        ||
        compareNullable(
          a.mae,
          b.mae
        )
    );


    output[
      model.id
    ] = {

      model,

      best:
        roundingResults[0],

      roundingResults
    };
  }


  return output;
}


// ============================================================
// MODEL EVALUATION
// ============================================================

function evaluateModel(
  cases,
  model,
  rounding
) {

  const residuals =
    [];


  let exact =
    0;


  let within1 =
    0;


  let within2 =
    0;


  let within3 =
    0;


  for (
    const row
    of cases
  ) {

    const evaluated =
      evaluateCaseAgainstModel(
        row,
        model,
        rounding
      );


    residuals.push(
      evaluated.residual
    );


    const absolute =
      Math.abs(
        evaluated.residual
      );


    if (
      absolute <
      1e-9
    ) {

      exact++;
    }


    if (
      absolute <=
      1
    ) {

      within1++;
    }


    if (
      absolute <=
      2
    ) {

      within2++;
    }


    if (
      absolute <=
      3
    ) {

      within3++;
    }
  }


  const squared =
    residuals.map(
      value =>
        value ** 2
    );


  const absolute =
    residuals.map(
      Math.abs
    );


  return {

    model:
      model.id,

    rounding,

    cases:
      cases.length,

    rmse:
      cases.length >
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

    residual:
      summarizeNumbers(
        residuals
      ),

    exact,

    exactRate:
      rate(
        exact,
        cases.length
      ),

    within1,

    within1Rate:
      rate(
        within1,
        cases.length
      ),

    within2,

    within2Rate:
      rate(
        within2,
        cases.length
      ),

    within3,

    within3Rate:
      rate(
        within3,
        cases.length
      )
  };
}


// ============================================================
// CASE MODEL
// ============================================================

function evaluateCaseAgainstModel(
  row,
  model,
  rounding
) {

  const groundReward =
    model.groundIntercept

    +

    model.groundSlope *
    row.minute;


  const continuousTeamTotal =
    groundReward *
    row.shareMultiplier;


  let predicted;


  switch (
    rounding
  ) {

    case 'FLOOR':

      predicted =
        Math.floor(
          continuousTeamTotal
        );

      break;


    case 'ROUND':

      predicted =
        Math.round(
          continuousTeamTotal
        );

      break;


    case 'CEIL':

      predicted =
        Math.ceil(
          continuousTeamTotal
        );

      break;


    default:

      predicted =
        continuousTeamTotal;

      break;
  }


  return {

    predicted,

    residual:
      row.teamTotal -
      predicted
  };
}


// ============================================================
// IMPLIED UNSHARED REGRESSION
// ============================================================

function fitImpliedGroundRegression(
  cases
) {

  const pairs =
    cases
      .map(
        row => {

          const multiplier =
            row.shareMultiplier;


          if (
            !Number.isFinite(
              multiplier
            )
            ||
            multiplier <=
              0
          ) {

            return null;
          }


          return [

            row.minute,

            row.teamTotal /
            multiplier
          ];
        }
      )
      .filter(
        Boolean
      );


  return linearRegression(
    pairs
  );
}


// ============================================================
// CURRENCY AGGREGATION
// ============================================================

function aggregateCurrencyEvents(
  events
) {

  const byPlayer =
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
      !byPlayer.has(
        playerName
      )
    ) {

      byPlayer.set(

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


    const row =
      byPlayer.get(
        playerName
      );


    row.delta +=
      delta;
  }


  return [
    ...byPlayer.values()
  ];
}


// ============================================================
// TEAM NET-WORTH STATE
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


  const opponents =
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
    opponents.length ===
    0
  ) {

    return 'UNKNOWN';
  }


  const opponent =
    Math.max(
      ...opponents
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


    map
      .get(
        key
      )
      .push(
        row
      );
  }


  return map;
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
// LINEAR REGRESSION
// ============================================================

function linearRegression(
  pairs
) {

  const clean =
    pairs.filter(
      row =>
        Array.isArray(
          row
        )
        &&
        row.length >=
          2
        &&
        Number.isFinite(
          row[0]
        )
        &&
        Number.isFinite(
          row[1]
        )
    );


  if (
    clean.length <
    2
  ) {

    return {

      count:
        clean.length,

      intercept:
        null,

      slope:
        null,

      r2:
        null,

      rmse:
        null
    };
  }


  const xs =
    clean.map(
      row =>
        row[0]
    );


  const ys =
    clean.map(
      row =>
        row[1]
    );


  const meanX =
    mean(
      xs
    );


  const meanY =
    mean(
      ys
    );


  let numerator =
    0;


  let denominator =
    0;


  for (
    let i =
      0;

    i <
      clean.length;

    i++
  ) {

    numerator +=
      (
        xs[i] -
        meanX
      )
      *
      (
        ys[i] -
        meanY
      );


    denominator +=
      (
        xs[i] -
        meanX
      )
      ** 2;
  }


  const slope =
    denominator >
      0
      ? numerator /
        denominator
      : 0;


  const intercept =
    meanY -
    slope *
    meanX;


  let ssResidual =
    0;


  let ssTotal =
    0;


  for (
    let i =
      0;

    i <
      clean.length;

    i++
  ) {

    const predicted =
      intercept +
      slope *
      xs[i];


    ssResidual +=
      (
        ys[i] -
        predicted
      )
      ** 2;


    ssTotal +=
      (
        ys[i] -
        meanY
      )
      ** 2;
  }


  return {

    count:
      clean.length,

    intercept,

    slope,

    r2:
      ssTotal >
        0
        ? 1 -
          ssResidual /
          ssTotal
        : null,

    rmse:
      Math.sqrt(
        ssResidual /
        clean.length
      )
  };
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
// CONSOLE
// ============================================================

function printReplay(
  row
) {

  console.log('');

  console.log(
    `Strict matches:      ${row.strictMatches}`
  );


  console.log(
    `Clean economics:     ${row.cleanEconomicCases}`
  );


  console.log(
    `Eligible cases:      ${row.eligibleCases}`
  );


  console.log(
    `Empirical curve:     ${formatNumber(
      row.empiricalRegression.intercept
    )} + ${formatNumber(
      row.empiricalRegression.slope
    )}*minute`
  );


  console.log('');

  console.log(
    'PRE-JUNE-30'
  );


  printModelMetrics(
    row
      .models
      .PRE_JUNE_30_2026
      .best
  );


  console.log('');

  console.log(
    'POST-JUNE-30'
  );


  printModelMetrics(
    row
      .models
      .POST_JUNE_30_2026
      .best
  );


  console.log('');

  console.log(
    `Winner:              ${row.modelWinner}`
  );
}


function printModelMetrics(
  row
) {

  console.log(
    `  rounding: ${row.rounding}`
  );


  console.log(
    `  RMSE:     ${formatNumber(row.rmse)}`
  );


  console.log(
    `  MAE:      ${formatNumber(row.mae)}`
  );


  console.log(
    `  exact:    ${formatPercent(row.exactRate)}`
  );


  console.log(
    `  <=1:      ${formatPercent(row.within1Rate)}`
  );


  console.log(
    `  <=2:      ${formatPercent(row.within2Rate)}`
  );
}


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
    `max=${formatNumber(row.max)}`
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
    '# Cross-Replay Reward Patch-Era Diagnostic'
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.patchEraSignatureStatus}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Historical models'
  );


  lines.push(
    ''
  );


  lines.push(
    '- Pre-June-30-2026 ground reward: `69.6 + 0.696 × matchMinute`.'
  );


  lines.push(
    '- Post-June-30-2026 ground reward: `50 + 1 × matchMinute`.'
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
      `- Empirical curve: ${formatNumber(replay.empiricalRegression.intercept)} + ${formatNumber(replay.empiricalRegression.slope)} × minute`
    );


    lines.push(
      `- Pre-June-30 RMSE: ${formatNumber(replay.models.PRE_JUNE_30_2026.best.rmse)}`
    );


    lines.push(
      `- Post-June-30 RMSE: ${formatNumber(replay.models.POST_JUNE_30_2026.best.rmse)}`
    );


    lines.push(
      `- Winner: **${replay.modelWinner}**`
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
    summary.interpretation.conclusion
  );


  lines.push(
    ''
  );


  lines.push(
    summary.interpretation.implication
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}