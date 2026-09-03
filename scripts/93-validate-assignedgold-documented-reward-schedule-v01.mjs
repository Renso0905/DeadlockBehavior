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
// EXTERNAL DOCUMENTED REFERENCE
//
// Current Trooper bounty:
//
//   total Trooper bounty:
//       100 + 2 per match minute
//
// Current division:
//
//       50% ground orb
//       50% flying orb
//
// Therefore nominal UNSHARED GROUND reward:
//
//       50 + 1 per match minute
//
// Trooper soul sharing:
//
// players   each player   total generated
//
//   1         100%           100%
//   2          54%           108%
//   3          36%           108%
//   4          25%           100%
//   5          20%           100%
//   6          16%            96%
//
// This is an EXTERNAL REFERENCE TARGET.
//
// It is not treated as telemetry truth.
// ============================================================

const DOCUMENTED_PER_PLAYER_SHARE = {

  1:
    1.00,

  2:
    0.54,

  3:
    0.36,

  4:
    0.25,

  5:
    0.20,

  6:
    0.16
};


// ============================================================
// TIME RULE CANDIDATES
//
// "per minute" can be implemented several ways.
//
// Rather than assume continuous versus discrete scaling, test:
//
//   continuous minute
//   floor minute
//   rounded minute
//   ceiling minute
//
// The discrete floor-minute model is particularly plausible for
// integer game-economy bookkeeping.
//
// These are tested without fitting any parameters.
// ============================================================

const TIME_RULES = [

  {

    id:
      'CONTINUOUS_MINUTE',

    groundBase:
      minute =>
        50 +
        minute
  },

  {

    id:
      'FLOOR_MINUTE',

    groundBase:
      minute =>
        50 +
        Math.floor(
          minute
        )
  },

  {

    id:
      'ROUND_MINUTE',

    groundBase:
      minute =>
        50 +
        Math.round(
          minute
        )
  },

  {

    id:
      'CEIL_MINUTE',

    groundBase:
      minute =>
        50 +
        Math.ceil(
          minute
        )
  }
];


// ============================================================
// ROUNDING / IMPLEMENTATION MODELS
//
// Two conceptually different possibilities:
//
// POOL_*
//
//   1. calculate the total shared reward pool
//   2. integerize that pool
//   3. divide it among recipients
//
// PER_PLAYER_*
//
//   1. calculate each player's documented percentage
//   2. integerize each player's amount independently
//   3. sum them
//
// Script91's integer-partition structure makes POOL_* especially
// interesting, but we test both families.
//
// ============================================================

const ROUNDING_RULES = [

  {

    id:
      'ROUND',

    fn:
      Math.round
  },

  {

    id:
      'FLOOR',

    fn:
      Math.floor
  },

  {

    id:
      'CEIL',

    fn:
      Math.ceil
  }
];


// ============================================================
// PATHS
// ============================================================

const summary92Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_share_recipient_geometry_comparison_v01.json'
  );


const cases92Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_share_recipient_geometry_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_documented_reward_schedule_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_documented_reward_schedule_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    summary92Path,
    cases92Path
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
// LOAD SCRIPT 92
// ============================================================

const summary92 =
  JSON.parse(
    readFileSync(
      summary92Path,
      'utf8'
    )
  );


if (
  summary92
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 92 did not PASS.'
  );
}


console.log('');

console.log(
  'Loading Script 92 economic-recipient cases...'
);


const rawCases =
  await loadJsonl(
    cases92Path
  );


console.log(
  `Script 92 cases: ${rawCases.length}`
);


// ============================================================
// NORMALIZE
// ============================================================

const cases =
  rawCases
    .map(
      normalizeCase
    )
    .filter(
      Boolean
    );


console.log(
  `Usable documented-formula cases: ${cases.length}`
);


// ============================================================
// BUILD MODEL DEFINITIONS
// ============================================================

const modelDefinitions =
  [];


for (
  const timeRule
  of TIME_RULES
) {

  for (
    const roundingRule
    of ROUNDING_RULES
  ) {

    modelDefinitions.push({

      id:
        `POOL_${roundingRule.id}_${timeRule.id}`,

      family:
        'POOL',

      timeRule,

      roundingRule
    });


    modelDefinitions.push({

      id:
        `PER_PLAYER_${roundingRule.id}_${timeRule.id}`,

      family:
        'PER_PLAYER',

      timeRule,

      roundingRule
    });
  }
}


// ============================================================
// EVALUATE EVERY DOCUMENTED MODEL
// ============================================================

const modelResults =
  modelDefinitions.map(
    model =>
      evaluateModel(
        cases,
        model
      )
  );


modelResults.sort(
  (
    a,
    b
  ) =>
    a.rmse -
      b.rmse
    ||
    b.exactRate -
      a.exactRate
    ||
    b.within1Rate -
      a.within1Rate
  );


const bestModel =
  modelResults[0]
  ??
  null;


// ============================================================
// BEST POOL / PER-PLAYER
// ============================================================

const bestPoolModel =
  modelResults.find(
    row =>
      row.family ===
      'POOL'
  )
  ??
  null;


const bestPerPlayerModel =
  modelResults.find(
    row =>
      row.family ===
      'PER_PLAYER'
  )
  ??
  null;


// ============================================================
// DIRECT IMPLIED UNSHARED BASE
//
// For each observed case:
//
//     observed shared total
//     ---------------------
//     documented total multiplier
//
// gives an empirical estimate of the unshared ground-orb bounty.
//
// This calculation does not require choosing a rounding rule.
// ============================================================

const impliedBaseRows =
  cases.map(
    row => {

      const totalMultiplier =
        getTotalMultiplier(
          row.recipientCount
        );


      return {

        ...row,

        documentedPerPlayerShare:
          DOCUMENTED_PER_PLAYER_SHARE[
            row.recipientCount
          ],

        documentedTotalMultiplier:
          totalMultiplier,

        impliedUnsharedGroundBase:
          row.teamTotal /
          totalMultiplier,

        continuousExpectedBase:
          50 +
          row.matchMinute,

        floorExpectedBase:
          50 +
          Math.floor(
            row.matchMinute
          )
      };
    }
  );


// ============================================================
// FIT IMPLIED BASE:
//
//     implied ground base = a + b * match minute
//
// Documentation predicts:
//
//     a ≈ 50
//     b ≈ 1
//
// ============================================================

const impliedBaseRegression =
  fitSimpleRegression(
    impliedBaseRows.map(
      row => ({

        x:
          row.matchMinute,

        y:
          row.impliedUnsharedGroundBase
      })
    )
  );


// ============================================================
// DOCUMENTED FORMULA RESIDUALS
// ============================================================

const continuousBaseResiduals =
  impliedBaseRows.map(
    row =>
      row.impliedUnsharedGroundBase -
      row.continuousExpectedBase
  );


const floorBaseResiduals =
  impliedBaseRows.map(
    row =>
      row.impliedUnsharedGroundBase -
      row.floorExpectedBase
  );


// ============================================================
// EMPIRICAL MULTIPLIERS
//
// Use the time rule selected by the best externally specified
// model.
//
// This lets us ask:
//
//     observed teamTotal / nominal solo ground reward
//
// Does that recover:
//
//     1.00
//     1.08
//     1.08
//     1.00
//     1.00
//     0.96
//
// ============================================================

const empiricalMultiplierRows =
  bestModel
    ? cases.map(
        row => {

          const nominalBase =
            bestModel
              .timeRule
              .groundBase(
                row.matchMinute
              );


          return {

            ...row,

            nominalBase,

            expectedTotalMultiplier:
              getTotalMultiplier(
                row.recipientCount
              ),

            empiricalTotalMultiplier:
              row.teamTotal /
              nominalBase,

            expectedPerPlayerShare:
              DOCUMENTED_PER_PLAYER_SHARE[
                row.recipientCount
              ],

            empiricalMeanPerPlayerShare:
              (
                row.teamTotal /
                row.recipientCount
              )
              /
              nominalBase
          };
        }
      )
    : [];


// ============================================================
// SUMMARIES BY RECIPIENT COUNT
// ============================================================

const byRecipientCount =
  summarizeRecipientCount(
    empiricalMultiplierRows
  );


// ============================================================
// BEST MODEL CASE RESULTS
// ============================================================

const bestCaseResults =
  bestModel
    ? bestModel.caseResults
    : [];


// ============================================================
// BEST MODEL RESIDUAL GROUPS
//
// If the documented formula is almost right but residuals cluster
// by team, time, or Trooper type, that points directly to the
// remaining modifier.
//
// Comeback mechanics are one possible explanation for team-linked
// residuals, but this script does NOT assume that.
// ============================================================

const residualByTeam =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      row.creditedTeam ??
      'UNKNOWN'
  );


const residualByBaseType =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      row.baseType ??
      'UNKNOWN'
  );


const residualByRecipientCount =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      String(
        row.recipientCount
      )
  );


const residualByTimeBand =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      classifyTimeBand(
        row.matchMinute
      )
  );


// ============================================================
// PLAYER-LEVEL ALLOCATION UNDER BEST POOL MODEL
//
// For POOL models:
//
//     predicted team pool
//     ↓
//     floor(pool / N)
//     ceil(pool / N)
//
// Script91 already suggested integer division with credited-player
// remainder priority.
//
// Here we test whether the externally documented reward formula
// also predicts the actual individual integer share multiset.
// ============================================================

const allocationAnalysis =
  bestModel
  &&
  bestModel.family ===
    'POOL'
    ? evaluateAllocation(
        bestCaseResults
      )
    : null;


// ============================================================
// MODEL COMPARISON AGAINST NO-SHARING NULL
//
// Null:
//
//   pretend every recipient-count configuration has total
//   multiplier 1.0.
//
// Same time rules and rounding are tested.
//
// If documented sharing is real, it should outperform this null,
// particularly N=2, N=3, and N=6.
// ============================================================

const nullModels =
  [];


for (
  const timeRule
  of TIME_RULES
) {

  for (
    const roundingRule
    of ROUNDING_RULES
  ) {

    const model = {

      id:
        `NULL_NO_SHARING_${roundingRule.id}_${timeRule.id}`,

      family:
        'NULL',

      timeRule,

      roundingRule
    };


    nullModels.push(
      evaluateNullModel(
        cases,
        model
      )
    );
  }
}


nullModels.sort(
  (
    a,
    b
  ) =>
    a.rmse -
      b.rmse
    ||
    b.exactRate -
      a.exactRate
  );


const bestNullModel =
  nullModels[0]
  ??
  null;


// ============================================================
// FORMULA SUPPORT
// ============================================================

const bestVsNullRMSEImprovement =
  bestModel
  &&
  bestNullModel
    ? bestNullModel.rmse -
      bestModel.rmse
    : null;


const impliedInterceptDifference =
  impliedBaseRegression
    ? impliedBaseRegression.intercept -
      50
    : null;


const impliedSlopeDifference =
  impliedBaseRegression
    ? impliedBaseRegression.slope -
      1
    : null;


const documentedBaseCurveStrong =
  impliedBaseRegression
  &&
  Math.abs(
    impliedInterceptDifference
  ) <=
    3
  &&
  Math.abs(
    impliedSlopeDifference
  ) <=
    0.10;


const documentedShareScheduleStrong =
  bestModel
  &&
  bestNullModel
  &&
  bestModel.rmse <
    bestNullModel.rmse
  &&
  byRecipientCount.every(
    row =>
      Math.abs(
        row
          .empiricalTotalMultiplier
          .median -
        row.expectedTotalMultiplier
      ) <=
      0.05
  );


const documentedGroundRewardStrong =
  documentedBaseCurveStrong
  &&
  documentedShareScheduleStrong;


// ============================================================
// TEAM RESIDUAL STRUCTURE
// ============================================================

const teamMeanResiduals =
  residualByTeam
    .map(
      row =>
        row.residual.mean
    )
    .filter(
      Number.isFinite
    );


const teamResidualMeanRange =
  teamMeanResiduals.length >
    1
    ? Math.max(
        ...teamMeanResiduals
      )
      -
      Math.min(
        ...teamMeanResiduals
      )
    : null;


const teamLinkedModifierCandidate =
  Number.isFinite(
    teamResidualMeanRange
  )
  &&
  teamResidualMeanRange >=
    2;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script92Passed:
      check(
        summary92
          ?.validation
          ?.pass,
        true,
        summary92
          ?.validation
          ?.pass ===
        true
      ),


    sourceCaseCount:
      check(
        rawCases.length,
        replayName ===
          'test'
          ? 85
          : '>0',
        replayName ===
          'test'
          ? rawCases.length ===
            85
          : rawCases.length >
            0
      ),


    usableCaseCount:
      check(
        cases.length,
        rawCases.length,
        cases.length ===
        rawCases.length
      ),


    recipientCountsSupported:
      check(
        cases.every(
          row =>
            Object.hasOwn(
              DOCUMENTED_PER_PLAYER_SHARE,
              row.recipientCount
            )
        ),
        true,
        cases.every(
          row =>
            Object.hasOwn(
              DOCUMENTED_PER_PLAYER_SHARE,
              row.recipientCount
            )
        )
      ),


    bestModelResolved:
      check(
        Boolean(
          bestModel
        ),
        true,
        Boolean(
          bestModel
        )
      ),


    impliedBaseRegressionResolved:
      check(
        Boolean(
          impliedBaseRegression
        ),
        true,
        Boolean(
          impliedBaseRegression
        )
      ),


    nullModelResolved:
      check(
        Boolean(
          bestNullModel
        ),
        true,
        Boolean(
          bestNullModel
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

const summary = {

  replay:
    replayName,

  version:
    'ASSIGNED_GOLD_DOCUMENTED_REWARD_SCHEDULE_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? documentedGroundRewardStrong
        ? 'DOCUMENTED_GROUND_REWARD_AND_SHARING_STRONGLY_SUPPORTED'
        : 'DOCUMENTED_REWARD_SCHEDULE_DIAGNOSTIC_COMPLETE'
      : 'PIPELINE_VALIDATION_FAILURE',


  externalReferenceTarget: {

    totalTrooperBase:
      100,

    totalTrooperGainPerMinute:
      2,

    groundFraction:
      0.50,

    nominalGroundBase:
      50,

    nominalGroundGainPerMinute:
      1,

    perPlayerShare:
      DOCUMENTED_PER_PLAYER_SHARE,

    totalMultiplier: {

      1:
        1.00,

      2:
        1.08,

      3:
        1.08,

      4:
        1.00,

      5:
        1.00,

      6:
        0.96
    },

    semanticStatus:
      'EXTERNAL_DOCUMENTED_REFERENCE_NOT_ASSUMED_TRUE'
  },


  purpose: [

    'Validate the current documented ground-half Trooper bounty schedule against reconstructed AssignedGold economic events.',

    'Determine whether ground reward scales approximately as 50 + 1 per match minute.',

    'Validate the documented 100/54/36/25/20/16 per-player sharing schedule.',

    'Compare pool-first versus player-first integer rounding implementations.',

    'Recover the empirical unshared ground-soul reward independently of recipient count.',

    'Identify residual structure that may indicate additional economy modifiers such as team-state effects.'
  ],


  semanticLimits: {

    externalDocumentation:
      'The documented formula is an independent reference target, not telemetry truth.',

    rounding:
      'Integer economy implementation can differ slightly from nominal percentages while preserving the same broad sharing mechanic.',

    comeback:
      'Team-linked residuals may be consistent with comeback mechanics or another team-state modifier, but this script does not assign a cause.',

    groundOnly:
      'This analysis concerns the AssignedGold ground component, not the separate flying CItemXP component.',

    recipientSet:
      'Recipient identities use the previously reconstructed exact economic recipient stream; Script92 separately validated a death-time 3D geometry model for those recipients.'
  },


  cohort: {

    cases:
      cases.length,

    recipientCountCounts:
      countBy(
        cases,
        row =>
          String(
            row.recipientCount
          )
      )
  },


  documentedModels:
    modelResults.map(
      stripCaseResults
    ),


  bestDocumentedModel:
    bestModel
      ? stripCaseResults(
          bestModel
        )
      : null,


  bestPoolModel:
    bestPoolModel
      ? stripCaseResults(
          bestPoolModel
        )
      : null,


  bestPerPlayerModel:
    bestPerPlayerModel
      ? stripCaseResults(
          bestPerPlayerModel
        )
      : null,


  nullModels:
    nullModels.map(
      stripCaseResults
    ),


  bestNullModel:
    bestNullModel
      ? stripCaseResults(
          bestNullModel
        )
      : null,


  bestVsNullRMSEImprovement,


  impliedUnsharedGroundReward: {

    distribution:
      summarizeNumbers(
        impliedBaseRows.map(
          row =>
            row.impliedUnsharedGroundBase
        )
      ),

    regression:
      impliedBaseRegression,

    documentedExpected: {

      intercept:
        50,

      slopePerMinute:
        1
    },

    interceptDifference:
      impliedInterceptDifference,

    slopeDifference:
      impliedSlopeDifference,

    continuousFormulaResidual:
      summarizeNumbers(
        continuousBaseResiduals
      ),

    floorMinuteFormulaResidual:
      summarizeNumbers(
        floorBaseResiduals
      )
  },


  empiricalSharing:
    byRecipientCount,


  bestModelResiduals: {

    byTeam:
      residualByTeam,

    byBaseType:
      residualByBaseType,

    byRecipientCount:
      residualByRecipientCount,

    byTimeBand:
      residualByTimeBand,

    teamMeanResidualRange:
      teamResidualMeanRange,

    teamLinkedModifierCandidate
  },


  individualAllocation:
    allocationAnalysis,


  interpretiveFlags: {

    documentedBaseCurveStrong,

    documentedShareScheduleStrong,

    documentedGroundRewardStrong,

    teamLinkedModifierCandidate
  },


  interpretationGuide: {

    baseCurve:
      'An implied-base regression near intercept 50 and slope +1/min independently reproduces the documented 50% ground component of a 100 + 2/min Trooper bounty.',

    sharing:
      'Observed total multipliers near 1.00/1.08/1.08/1.00/1.00/0.96 support the documented sharing schedule independently of exact integer rounding.',

    poolVsPlayer:
      'A materially better POOL model supports calculation of one shared reward pool followed by integer division among recipients.',

    nullComparison:
      'Improvement over a no-sharing null demonstrates that recipient count affects total generated reward in the documented direction rather than merely dividing a fixed pool.',

    residuals:
      'If a documented formula is close but residuals cluster strongly by team or time, investigate additional game-state modifiers rather than adding arbitrary Trooper-type coefficients.',

    next:
      documentedGroundRewardStrong
        ? 'If residuals are small, ground-soul amount semantics are sufficiently resolved for cross-replay. If residuals show systematic team structure, isolate the remaining team-state/comeback modifier first.'
        : 'Inspect the winning rounding model and residual groups before promoting the documented amount schedule.'
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


const writer =
  createWriteStream(
    outputCasesPath,
    {
      encoding:
        'utf8'
    }
  );


for (
  const row
  of bestCaseResults
) {

  writer.write(
    `${JSON.stringify(row)}\n`
  );
}


await finishWriter(
  writer
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD DOCUMENTED REWARD SCHEDULE V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'EXTERNAL TARGET'
);

console.log(
  '---------------'
);


console.log(
  'Ground base candidate: 50 + 1 soul / match minute'
);


console.log(
  'Per-player sharing:     100 / 54 / 36 / 25 / 20 / 16 %'
);


console.log(
  'Total multipliers:      1.00 / 1.08 / 1.08 / 1.00 / 1.00 / 0.96'
);


// ============================================================
// MODEL RESULTS
// ============================================================

console.log('');

console.log(
  'DOCUMENTED FORMULA MODELS'
);

console.log(
  '-------------------------'
);


for (
  const row
  of modelResults
) {

  console.log(

    `${row.id.padEnd(43)} ` +

    `RMSE=${formatNumber(row.rmse).padStart(7)} ` +

    `MAE=${formatNumber(row.mae).padStart(7)} ` +

    `exact=${formatPercent(row.exactRate).padStart(8)} ` +

    `<=1=${formatPercent(row.within1Rate).padStart(8)} ` +

    `<=2=${formatPercent(row.within2Rate).padStart(8)} ` +

    `bias=${formatNumber(row.meanResidual).padStart(7)}`
  );
}


// ============================================================
// WINNER
// ============================================================

console.log('');

console.log(
  'BEST DOCUMENTED MODEL'
);

console.log(
  '---------------------'
);


if (
  bestModel
) {

  console.log(
    `Model:       ${bestModel.id}`
  );


  console.log(
    `Family:      ${bestModel.family}`
  );


  console.log(
    `Time rule:   ${bestModel.timeRule.id}`
  );


  console.log(
    `Rounding:    ${bestModel.roundingRule.id}`
  );


  console.log(
    `RMSE:        ${formatNumber(bestModel.rmse)}`
  );


  console.log(
    `MAE:         ${formatNumber(bestModel.mae)}`
  );


  console.log(
    `Exact:       ${bestModel.exact}/${bestModel.count} (${formatPercent(bestModel.exactRate)})`
  );


  console.log(
    `Within 1:    ${bestModel.within1}/${bestModel.count} (${formatPercent(bestModel.within1Rate)})`
  );


  console.log(
    `Within 2:    ${bestModel.within2}/${bestModel.count} (${formatPercent(bestModel.within2Rate)})`
  );


  console.log(
    `Max abs:     ${formatNumber(bestModel.maxAbsoluteResidual)}`
  );
}


// ============================================================
// NULL
// ============================================================

console.log('');

console.log(
  'NO-SHARING NULL'
);

console.log(
  '---------------'
);


if (
  bestNullModel
) {

  console.log(
    `Best null:     ${bestNullModel.id}`
  );


  console.log(
    `Null RMSE:     ${formatNumber(bestNullModel.rmse)}`
  );


  console.log(
    `Formula RMSE:  ${formatNumber(bestModel?.rmse)}`
  );


  console.log(
    `Improvement:   ${formatNumber(bestVsNullRMSEImprovement)}`
  );
}


// ============================================================
// IMPLIED BASE
// ============================================================

console.log('');

console.log(
  'IMPLIED UNSHARED GROUND REWARD'
);

console.log(
  '------------------------------'
);


console.log(
  `Observed implied base: ${formatDistribution(
    summarizeNumbers(
      impliedBaseRows.map(
        row =>
          row.impliedUnsharedGroundBase
      )
    )
  )}`
);


if (
  impliedBaseRegression
) {

  console.log(
    `Regression: base = ${formatNumber(impliedBaseRegression.intercept)} + ${formatNumber(impliedBaseRegression.slope)} * matchMinute`
  );


  console.log(
    `Expected:   base = 50 + 1 * matchMinute`
  );


  console.log(
    `R2:         ${formatNumber(impliedBaseRegression.rSquared)}`
  );


  console.log(
    `RMSE:       ${formatNumber(impliedBaseRegression.rmse)}`
  );


  console.log(
    `Intercept difference: ${formatNumber(impliedInterceptDifference)}`
  );


  console.log(
    `Slope difference:     ${formatNumber(impliedSlopeDifference)}`
  );
}


console.log('');

console.log(
  'BASE FORMULA RESIDUALS'
);

console.log(
  '----------------------'
);


console.log(
  `Continuous 50+t: ${formatDistribution(
    summarizeNumbers(
      continuousBaseResiduals
    )
  )}`
);


console.log(
  `Floor 50+floor(t): ${formatDistribution(
    summarizeNumbers(
      floorBaseResiduals
    )
  )}`
);


// ============================================================
// EMPIRICAL SHARING
// ============================================================

console.log('');

console.log(
  'EMPIRICAL SHARE MULTIPLIERS'
);

console.log(
  '---------------------------'
);


for (
  const row
  of byRecipientCount
) {

  console.log('');

  console.log(
    `${row.recipientCount} recipient(s)  n=${row.count}`
  );


  console.log(
    `  expected team multiplier: ${formatNumber(row.expectedTotalMultiplier)}`
  );


  console.log(
    `  empirical team multiplier:${formatDistribution(row.empiricalTotalMultiplier)}`
  );


  console.log(
    `  expected each player:     ${formatPercent(row.expectedPerPlayerShare)}`
  );


  console.log(
    `  empirical mean/player:    ${formatDistribution(row.empiricalMeanPerPlayerShare)}`
  );
}


// ============================================================
// RESIDUAL GROUPS
// ============================================================

console.log('');

console.log(
  'BEST-MODEL RESIDUALS BY TEAM'
);

console.log(
  '----------------------------'
);


printResidualGroups(
  residualByTeam
);


console.log('');

console.log(
  'BEST-MODEL RESIDUALS BY RECIPIENT COUNT'
);

console.log(
  '---------------------------------------'
);


printResidualGroups(
  residualByRecipientCount
);


console.log('');

console.log(
  'BEST-MODEL RESIDUALS BY TROOPER TYPE'
);

console.log(
  '------------------------------------'
);


printResidualGroups(
  residualByBaseType
);


console.log('');

console.log(
  'BEST-MODEL RESIDUALS BY TIME'
);

console.log(
  '----------------------------'
);


printResidualGroups(
  residualByTimeBand
);


// ============================================================
// ALLOCATION
// ============================================================

if (
  allocationAnalysis
) {

  console.log('');

  console.log(
    'INDIVIDUAL INTEGER ALLOCATION'
  );

  console.log(
    '-----------------------------'
  );


  console.log(
    `Exact predicted team total:      ${allocationAnalysis.exactTeamTotal}/${allocationAnalysis.count} (${formatPercent(allocationAnalysis.exactTeamTotalRate)})`
  );


  console.log(
    `Exact recipient amount multiset: ${allocationAnalysis.exactAmountMultiset}/${allocationAnalysis.count} (${formatPercent(allocationAnalysis.exactAmountMultisetRate)})`
  );


  console.log(
    `Credited gets expected ceil:     ${allocationAnalysis.creditedExpectedAmount}/${allocationAnalysis.creditedComparable} (${formatPercent(allocationAnalysis.creditedExpectedAmountRate)})`
  );
}


// ============================================================
// FLAGS
// ============================================================

console.log('');

console.log(
  'INTERPRETIVE FLAGS'
);

console.log(
  '------------------'
);


console.log(
  `Documented base curve strong:     ${documentedBaseCurveStrong}`
);


console.log(
  `Documented share schedule strong: ${documentedShareScheduleStrong}`
);


console.log(
  `Documented ground reward strong:  ${documentedGroundRewardStrong}`
);


console.log(
  `Team-linked modifier candidate:   ${teamLinkedModifierCandidate}`
);


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
    result
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(

    `${result.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(38)} ` +

    `actual=${JSON.stringify(result.actual)} ` +

    `expected=${JSON.stringify(result.expected)}`
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
// NORMALIZE CASE
// ============================================================

function normalizeCase(
  row
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  const matchMinute =
    finite(
      row?.matchMinute
    );


  const teamTotal =
    finite(
      row?.teamTotal
    );


  const recipientCount =
    finite(
      row?.actualRecipientCount
    );


  if (
    deathIndex ===
      null
    ||
    matchMinute ===
      null
    ||
    teamTotal ===
      null
    ||
    recipientCount ===
      null
    ||
    !Object.hasOwn(
      DOCUMENTED_PER_PLAYER_SHARE,
      recipientCount
    )
  ) {

    return null;
  }


  const actualRecipients =
    Array.isArray(
      row?.actualRecipients
    )
      ? row.actualRecipients
          .map(
            recipient => {

              const positiveDelta =
                finite(
                  recipient
                    ?.positiveDelta
                );


              if (
                !recipient?.playerName
                ||
                positiveDelta ===
                  null
              ) {

                return null;
              }


              return {

                playerName:
                  String(
                    recipient.playerName
                  ),

                team:
                  finite(
                    recipient.team
                  ),

                positiveDelta
              };
            }
          )
          .filter(
            Boolean
          )
      : [];


  return {

    deathIndex,

    clock:
      row?.clock ??
      null,

    matchMinute,

    teamTotal,

    recipientCount,

    creditedPlayerName:
      row?.creditedPlayerName ??
      null,

    creditedTeam:
      finite(
        row?.creditedTeam
      ),

    targetPlayerName:
      row?.targetPlayerName ??
      null,

    baseType:
      row?.baseType ??
      null,

    variantLabel:
      row?.variantLabel ??
      null,

    actualRecipients
  };
}


// ============================================================
// DOCUMENTED MODEL
// ============================================================

function evaluateModel(
  rows,
  model
) {

  const caseResults =
    [];


  for (
    const row
    of rows
  ) {

    const base =
      model
        .timeRule
        .groundBase(
          row.matchMinute
        );


    const perPlayerShare =
      DOCUMENTED_PER_PLAYER_SHARE[
        row.recipientCount
      ];


    const totalMultiplier =
      row.recipientCount *
      perPlayerShare;


    let predicted;


    if (
      model.family ===
      'POOL'
    ) {

      predicted =
        model
          .roundingRule
          .fn(
            base *
            totalMultiplier
          );

    } else {

      const each =
        model
          .roundingRule
          .fn(
            base *
            perPlayerShare
          );


      predicted =
        each *
        row.recipientCount;
    }


    const residual =
      row.teamTotal -
      predicted;


    caseResults.push({

      ...row,

      modelId:
        model.id,

      modelFamily:
        model.family,

      timeRule:
        model.timeRule.id,

      roundingRule:
        model.roundingRule.id,

      nominalUnsharedGroundBase:
        base,

      documentedPerPlayerShare:
        perPlayerShare,

      documentedTotalMultiplier:
        totalMultiplier,

      predictedTeamTotal:
        predicted,

      residual,

      absoluteResidual:
        Math.abs(
          residual
        )
    });
  }


  return summarizeModel(
    model,
    caseResults
  );
}


// ============================================================
// NULL MODEL
// ============================================================

function evaluateNullModel(
  rows,
  model
) {

  const caseResults =
    [];


  for (
    const row
    of rows
  ) {

    const base =
      model
        .timeRule
        .groundBase(
          row.matchMinute
        );


    const predicted =
      model
        .roundingRule
        .fn(
          base
        );


    const residual =
      row.teamTotal -
      predicted;


    caseResults.push({

      ...row,

      modelId:
        model.id,

      modelFamily:
        'NULL',

      timeRule:
        model.timeRule.id,

      roundingRule:
        model.roundingRule.id,

      nominalUnsharedGroundBase:
        base,

      documentedPerPlayerShare:
        null,

      documentedTotalMultiplier:
        1,

      predictedTeamTotal:
        predicted,

      residual,

      absoluteResidual:
        Math.abs(
          residual
        )
    });
  }


  return summarizeModel(
    model,
    caseResults
  );
}


// ============================================================
// MODEL SUMMARY
// ============================================================

function summarizeModel(
  model,
  caseResults
) {

  const residuals =
    caseResults.map(
      row =>
        row.residual
    );


  const absolute =
    caseResults.map(
      row =>
        row.absoluteResidual
    );


  const exact =
    absolute.filter(
      value =>
        value ===
        0
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


  return {

    id:
      model.id,

    family:
      model.family,

    timeRule:
      model.timeRule,

    roundingRule:
      model.roundingRule,

    count:
      caseResults.length,

    rmse:
      Math.sqrt(
        mean(
          residuals.map(
            value =>
              value *
              value
          )
        )
      ),

    mae:
      mean(
        absolute
      ),

    meanResidual:
      mean(
        residuals
      ),

    maxAbsoluteResidual:
      Math.max(
        ...absolute
      ),

    exact,

    exactRate:
      rate(
        exact,
        caseResults.length
      ),

    within1,

    within1Rate:
      rate(
        within1,
        caseResults.length
      ),

    within2,

    within2Rate:
      rate(
        within2,
        caseResults.length
      ),

    within3,

    within3Rate:
      rate(
        within3,
        caseResults.length
      ),

    residualDistribution:
      summarizeNumbers(
        residuals
      ),

    caseResults
  };
}


// ============================================================
// TOTAL MULTIPLIER
// ============================================================

function getTotalMultiplier(
  recipientCount
) {

  return (
    recipientCount *
    DOCUMENTED_PER_PLAYER_SHARE[
      recipientCount
    ]
  );
}


// ============================================================
// RECIPIENT COUNT SUMMARY
// ============================================================

function summarizeRecipientCount(
  rows
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      !groups.has(
        row.recipientCount
      )
    ) {

      groups.set(
        row.recipientCount,
        []
      );
    }


    groups
      .get(
        row.recipientCount
      )
      .push(
        row
      );
  }


  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          recipientCount,
          groupRows
        ]
      ) => ({

        recipientCount,

        count:
          groupRows.length,

        expectedTotalMultiplier:
          getTotalMultiplier(
            recipientCount
          ),

        empiricalTotalMultiplier:
          summarizeNumbers(
            groupRows.map(
              row =>
                row.empiricalTotalMultiplier
            )
          ),

        expectedPerPlayerShare:
          DOCUMENTED_PER_PLAYER_SHARE[
            recipientCount
          ],

        empiricalMeanPerPlayerShare:
          summarizeNumbers(
            groupRows.map(
              row =>
                row.empiricalMeanPerPlayerShare
            )
          ),

        teamTotal:
          summarizeNumbers(
            groupRows.map(
              row =>
                row.teamTotal
            )
          )
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        a.recipientCount -
        b.recipientCount
    );
}


// ============================================================
// RESIDUAL GROUPS
// ============================================================

function summarizeResidualGroups(
  rows,
  selector
) {

  const groups =
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
        ??
        'UNKNOWN'
      );


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );
    }


    groups
      .get(
        key
      )
      .push(
        row
      );
  }


  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          group,
          groupRows
        ]
      ) => ({

        group,

        count:
          groupRows.length,

        residual:
          summarizeNumbers(
            groupRows.map(
              row =>
                row.residual
            )
          ),

        absoluteResidual:
          summarizeNumbers(
            groupRows.map(
              row =>
                row.absoluteResidual
            )
          ),

        exactRate:
          rate(
            groupRows.filter(
              row =>
                row.absoluteResidual ===
                0
            ).length,
            groupRows.length
          ),

        within1Rate:
          rate(
            groupRows.filter(
              row =>
                row.absoluteResidual <=
                1
            ).length,
            groupRows.length
          )
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        b.count -
          a.count
        ||
        a.group.localeCompare(
          b.group
        )
    );
}


// ============================================================
// INDIVIDUAL ALLOCATION
// ============================================================

function evaluateAllocation(
  rows
) {

  let exactTeamTotal =
    0;


  let exactAmountMultiset =
    0;


  let creditedComparable =
    0;


  let creditedExpectedAmount =
    0;


  for (
    const row
    of rows
  ) {

    if (
      row.predictedTeamTotal ===
      row.teamTotal
    ) {

      exactTeamTotal++;
    }


    const predictedTotal =
      row.predictedTeamTotal;


    const n =
      row.recipientCount;


    const floorShare =
      Math.floor(
        predictedTotal /
        n
      );


    const remainder =
      predictedTotal %
      n;


    const predictedAmounts =
      [];


    for (
      let i = 0;
      i <
      n;
      i++
    ) {

      predictedAmounts.push(
        i <
          remainder
          ? floorShare +
            1
          : floorShare
      );
    }


    predictedAmounts.sort(
      (
        a,
        b
      ) =>
        a -
        b
    );


    const actualAmounts =
      row.actualRecipients
        .map(
          recipient =>
            recipient.positiveDelta
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
      arraysEqual(
        predictedAmounts,
        actualAmounts
      )
    ) {

      exactAmountMultiset++;
    }


    const credited =
      row.actualRecipients.find(
        recipient =>
          recipient.playerName ===
          row.creditedPlayerName
      );


    if (
      credited
    ) {

      creditedComparable++;


      const expectedCredited =
        remainder >
          0
          ? floorShare +
            1
          : floorShare;


      if (
        credited.positiveDelta ===
        expectedCredited
      ) {

        creditedExpectedAmount++;
      }
    }
  }


  return {

    count:
      rows.length,

    exactTeamTotal,

    exactTeamTotalRate:
      rate(
        exactTeamTotal,
        rows.length
      ),

    exactAmountMultiset,

    exactAmountMultisetRate:
      rate(
        exactAmountMultiset,
        rows.length
      ),

    creditedComparable,

    creditedExpectedAmount,

    creditedExpectedAmountRate:
      rate(
        creditedExpectedAmount,
        creditedComparable
      )
  };
}


// ============================================================
// SIMPLE REGRESSION
// ============================================================

function fitSimpleRegression(
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
    mean(
      clean.map(
        row =>
          row.x
      )
    );


  const meanY =
    mean(
      clean.map(
        row =>
          row.y
      )
    );


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


  const residuals =
    clean.map(
      row =>
        row.y -
        (
          intercept +
          slope *
          row.x
        )
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


  const meanTarget =
    meanY;


  const sst =
    clean.reduce(
      (
        sum,
        row
      ) => {

        const delta =
          row.y -
          meanTarget;


        return sum +
        delta *
        delta;
      },
      0
    );


  return {

    count:
      clean.length,

    slope,

    intercept,

    rmse:
      Math.sqrt(
        sse /
        clean.length
      ),

    rSquared:
      sst >
        0
        ? 1 -
          sse /
          sst
        : null,

    residual:
      summarizeNumbers(
        residuals
      )
  };
}


// ============================================================
// TIME BAND
// ============================================================

function classifyTimeBand(
  minute
) {

  if (
    !Number.isFinite(
      minute
    )
  ) {

    return 'UNKNOWN';
  }


  const lower =
    Math.floor(
      minute /
      5
    )
    *
    5;


  const upper =
    lower +
    5;


  return `${lower}_TO_LT_${upper}_MIN`;
}


// ============================================================
// STRIP CASES FROM SUMMARY MODEL
// ============================================================

function stripCaseResults(
  row
) {

  if (
    !row
  ) {

    return null;
  }


  return {

    id:
      row.id,

    family:
      row.family,

    timeRule:
      row.timeRule.id,

    roundingRule:
      row.roundingRule.id,

    count:
      row.count,

    rmse:
      row.rmse,

    mae:
      row.mae,

    meanResidual:
      row.meanResidual,

    maxAbsoluteResidual:
      row.maxAbsoluteResidual,

    exact:
      row.exact,

    exactRate:
      row.exactRate,

    within1:
      row.within1,

    within1Rate:
      row.within1Rate,

    within2:
      row.within2,

    within2Rate:
      row.within2Rate,

    within3:
      row.within3,

    within3Rate:
      row.within3Rate,

    residualDistribution:
      row.residualDistribution
  };
}


// ============================================================
// ARRAY
// ============================================================

function arraysEqual(
  a,
  b
) {

  if (
    a.length !==
    b.length
  ) {

    return false;
  }


  for (
    let i = 0;
    i <
    a.length;
    i++
  ) {

    if (
      a[i] !==
      b[i]
    ) {

      return false;
    }
  }


  return true;
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


async function finishWriter(
  writer
) {

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
    sorted[lower] *
      (
        1 -
        weight
      )
    +
    sorted[upper] *
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
// CONSOLE HELPERS
// ============================================================

function printResidualGroups(
  groups
) {

  for (
    const row
    of groups
  ) {

    console.log('');

    console.log(
      `${row.group}  n=${row.count}`
    );


    console.log(
      `  residual: ${formatDistribution(row.residual)}`
    );


    console.log(
      `  abs:      ${formatDistribution(row.absoluteResidual)}`
    );


    console.log(
      `  exact:    ${formatPercent(row.exactRate)}`
    );


    console.log(
      `  <=1:      ${formatPercent(row.within1Rate)}`
    );
  }
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
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}