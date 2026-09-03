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


// ============================================================
// DOCUMENTED ORDINARY GROUND-SOUL ECONOMY
//
// Script93 independently supported:
//
//   unshared ground reward ≈ 50 + match minute
//
// sharing:
//
// players   each      total
//
//   1       100%      100%
//   2        54%      108%
//   3        36%      108%
//   4        25%      100%
//   5        20%      100%
//   6        16%       96%
//
// ============================================================

const PER_PLAYER_SHARE = {

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
// COMEBACK REFERENCE
//
// Current external reference:
//
//   first 3,000 NW difference ignored
//
//   bonus scales linearly with net-worth deficit
//
//   full bonus around 20% deficit
//
//   current documentation: up to 26%
//
// Historical official introduction:
//
//   up to 25%
//
// Therefore both:
//
//   0.25
//   0.26
//
// are explicitly tested.
//
// We also test several possible definitions of "% behind":
//
//   eligible gap / leading-team NW
//   eligible gap / trailing-team NW
//   eligible gap / average team NW
//
// rather than silently assuming denominator semantics.
// ============================================================

const COMEBACK_MAX_BONUSES = [
  0.25,
  0.26
];


const COMEBACK_FULL_AT_DEFICIT =
  0.20;


const IGNORED_ABSOLUTE_GAP =
  3000;


// ============================================================
// ANCHORS
//
// DEATH:
//
//   candidate that comeback state is assigned when Trooper dies.
//
// ACTIVE_FALSE:
//
//   candidate that comeback state is evaluated when AssignedGold
//   is economically resolved.
//
// ============================================================

const ANCHORS = [
  'DEATH',
  'ACTIVE_FALSE'
];


// ============================================================
// DEFICIT DENOMINATORS
// ============================================================

const DENOMINATORS = [

  {
    id:
      'LEADING_TEAM',

    value:
      ({
        leading,
        trailing
      }) =>
        leading
  },

  {
    id:
      'TRAILING_TEAM',

    value:
      ({
        leading,
        trailing
      }) =>
        trailing
  },

  {
    id:
      'AVERAGE_TEAM',

    value:
      ({
        leading,
        trailing
      }) =>
        (
          leading +
          trailing
        )
        /
        2
  }
];


// ============================================================
// GAP RULES
//
// Primary documented rule:
//
//   ignore first 3000.
//
// NO_IGNORE is retained as a falsification control.
// ============================================================

const GAP_RULES = [

  {
    id:
      'IGNORE_FIRST_3000',

    eligibleGap:
      gap =>
        Math.max(
          0,
          gap -
          IGNORED_ABSOLUTE_GAP
        )
  },

  {
    id:
      'NO_3000_IGNORE_CONTROL',

    eligibleGap:
      gap =>
        Math.max(
          0,
          gap
        )
  }
];


// ============================================================
// INTEGER ROUNDING
// ============================================================

const ROUNDING_RULES = [

  {
    id:
      'FLOOR',

    fn:
      Math.floor
  },

  {
    id:
      'ROUND',

    fn:
      Math.round
  },

  {
    id:
      'CEIL',

    fn:
      Math.ceil
  }
];


// ============================================================
// SECONDARY MAX-BONUS GRID
//
// This is exploratory only.
//
// It asks whether the replay naturally prefers something near
// 25-26%, without changing the documented 20% deficit cap.
//
// ============================================================

const BONUS_GRID_MIN =
  0.15;


const BONUS_GRID_MAX =
  0.35;


const BONUS_GRID_STEP =
  0.001;


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const summary93Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_documented_reward_schedule_validation_v01.json'
  );


const cases93Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_documented_reward_schedule_cases_v01.jsonl'
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
    'assigned_gold_comeback_modifier_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_comeback_modifier_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    summary93Path,
    cases93Path,
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
// LOAD SCRIPT93
// ============================================================

const summary93 =
  JSON.parse(
    readFileSync(
      summary93Path,
      'utf8'
    )
  );


if (
  summary93
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 93 did not PASS.'
  );
}


console.log('');

console.log(
  'Loading Script 93 documented-reward cases...'
);


const cases93 =
  await loadJsonl(
    cases93Path
  );


console.log(
  `Script 93 cases: ${cases93.length}`
);


console.log(
  'Loading Script 92 geometry cases...'
);


const cases92 =
  await loadJsonl(
    cases92Path
  );


console.log(
  `Script 92 cases: ${cases92.length}`
);


// ============================================================
// INDEX SCRIPT92
// ============================================================

const case92ByDeath =
  new Map();


for (
  const row
  of cases92
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    case92ByDeath.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// NORMALIZE CASES
// ============================================================

const cases =
  [];


for (
  const source93
  of cases93
) {

  const deathIndex =
    finite(
      source93?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const source92 =
    case92ByDeath.get(
      deathIndex
    )
    ??
    null;


  if (
    !source92
  ) {

    continue;
  }


  const deathTick =
    finite(
      source92?.deathTick
    );


  const activeFalseTick =
    finite(
      source92?.activeFalseTick
    );


  const matchMinute =
    finite(
      source93?.matchMinute
    );


  const teamTotal =
    finite(
      source93?.teamTotal
    );


  const recipientCount =
    finite(
      source93?.recipientCount
    );


  const creditedTeam =
    firstFinite([
      source93?.creditedTeam,
      source92?.creditedTeam
    ]);


  if (
    deathTick ===
      null
    ||
    activeFalseTick ===
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
    creditedTeam ===
      null
    ||
    !Object.hasOwn(
      PER_PLAYER_SHARE,
      recipientCount
    )
  ) {

    continue;
  }


  const baselinePredicted =
    finite(
      source93
        ?.predictedTeamTotal
    );


  const baselineResidual =
    finite(
      source93
        ?.residual
    );


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      source93?.clock ??
      source92?.clock ??
      null,

    matchMinute,

    deathTick,

    activeFalseTick,

    creditedTeam,

    creditedPlayerName:
      source93
        ?.creditedPlayerName ??
      source92
        ?.creditedPlayerName ??
      null,

    baseType:
      source93?.baseType ??
      source92?.baseType ??
      null,

    variantLabel:
      source93?.variantLabel ??
      source92?.variantLabel ??
      null,

    recipientCount,

    documentedPerPlayerShare:
      PER_PLAYER_SHARE[
        recipientCount
      ],

    documentedTotalMultiplier:
      recipientCount *
      PER_PLAYER_SHARE[
        recipientCount
      ],

    teamTotal,

    ordinaryGroundBase:
      50 +
      matchMinute,

    baselineModelId:
      source93?.modelId ??
      summary93
        ?.bestDocumentedModel
        ?.id ??
      null,

    baselinePredicted,

    baselineResidual,

    baselineAbsoluteResidual:
      baselineResidual !==
        null
        ? Math.abs(
          baselineResidual
        )
        : null,

    anchors: {

      DEATH:
        null,

      ACTIVE_FALSE:
        null
    }
  });
}


console.log('');

console.log(
  `Joined cases: ${cases.length}`
);


// ============================================================
// REQUEST MAP
// ============================================================

const requestsByTick =
  new Map();


for (
  const row
  of cases
) {

  addRequest(
    row.deathTick,
    row,
    'DEATH'
  );


  addRequest(
    row.activeFalseTick,
    row,
    'ACTIVE_FALSE'
  );
}


function addRequest(
  tick,
  row,
  anchor
) {

  if (
    !requestsByTick.has(
      tick
    )
  ) {

    requestsByTick.set(
      tick,
      []
    );
  }


  requestsByTick
    .get(
      tick
    )
    .push({

      row,
      anchor
    });
}


// ============================================================
// EXACT NET-WORTH RESCAN
// ============================================================

let demoPackets =
  0;


let relevantPackets =
  0;


let anchorCaptures =
  0;


console.log('');

console.log(
  'Rescanning exact death and economic-resolution ticks for team net worth...'
);

console.log('');


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
    ) {

      return;
    }


    demoPackets++;


    const requests =
      requestsByTick.get(
        tick
      );


    if (
      !requests
      ||
      requests.length ===
        0
    ) {

      return;
    }


    relevantPackets++;


    const demo =
      parser.getDemo();


    const snapshot =
      collectNetWorthSnapshot(
        demo,
        tick
      );


    for (
      const request
      of requests
    ) {

      request
        .row
        .anchors[
          request.anchor
        ] =
        snapshot;


      anchorCaptures++;
    }
  }
);


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// ANCHOR COVERAGE
// ============================================================

const anchorCoverage =
  {};


for (
  const anchor
  of ANCHORS
) {

  const captured =
    cases.filter(
      row =>
        Boolean(
          row.anchors[
            anchor
          ]
        )
    );


  const complete =
    captured.filter(
      row =>
        getTwoTeamSnapshot(
          row.anchors[
            anchor
          ]
        )
    );


  anchorCoverage[
    anchor
  ] = {

    captured:
      captured.length,

    completeTwoTeamNetWorth:
      complete.length,

    coverageRate:
      rate(
        complete.length,
        cases.length
      )
  };
}


// ============================================================
// ADD TEAM-STATE DERIVATIVES
// ============================================================

for (
  const row
  of cases
) {

  row.teamState =
    {};


  for (
    const anchor
    of ANCHORS
  ) {

    row.teamState[
      anchor
    ] =
      buildTeamState(
        row,
        anchor
      );
  }
}


// ============================================================
// BASELINE STRUCTURE
// ============================================================

const baselineSummary =
  summarizeExistingResiduals(
    cases
  );


const baselineByTeam =
  summarizeResidualGroups(
    cases,
    row =>
      String(
        row.creditedTeam
      ),
    row =>
      row.baselineResidual
  );


const baselineByDeathTrailingStatus =
  summarizeResidualGroups(
    cases,
    row =>
      row
        .teamState
        .DEATH
        ?.creditedTeamStatus ??
      'UNKNOWN',
    row =>
      row.baselineResidual
  );


const baselineByPayoutTrailingStatus =
  summarizeResidualGroups(
    cases,
    row =>
      row
        .teamState
        .ACTIVE_FALSE
        ?.creditedTeamStatus ??
      'UNKNOWN',
    row =>
      row.baselineResidual
  );


// ============================================================
// DOCUMENTED COMEBACK CANDIDATE MODELS
// ============================================================

const candidateModels =
  [];


for (
  const anchor
  of ANCHORS
) {

  for (
    const denominator
    of DENOMINATORS
  ) {

    for (
      const gapRule
      of GAP_RULES
    ) {

      for (
        const maxBonus
        of COMEBACK_MAX_BONUSES
      ) {

        for (
          const rounding
          of ROUNDING_RULES
        ) {

          candidateModels.push({

            id:
              [
                anchor,
                denominator.id,
                gapRule.id,
                `MAX_${Math.round(
                  maxBonus *
                  100
                )}`,
                rounding.id
              ].join(
                '__'
              ),

            anchor,

            denominator,

            gapRule,

            maxBonus,

            rounding
          });
        }
      }
    }
  }
}


// ============================================================
// EVALUATE CANDIDATES
// ============================================================

const candidateResults =
  candidateModels
    .map(
      model =>
        evaluateComebackModel(
          cases,
          model
        )
    )
    .filter(
      Boolean
    );


candidateResults.sort(
  compareModelResults
);


const bestModel =
  candidateResults[0]
  ??
  null;


// ============================================================
// BEST DOCUMENTED-SEMANTIC MODEL
//
// Requires:
//
//   IGNORE_FIRST_3000
//
// Keeps both 25 and 26 candidates.
// ============================================================

const documentedRuleResults =
  candidateResults.filter(
    row =>
      row.gapRule ===
      'IGNORE_FIRST_3000'
  );


const bestDocumentedRule =
  documentedRuleResults[0]
  ??
  null;


// ============================================================
// BEST 25 / 26
// ============================================================

const best25 =
  candidateResults.find(
    row =>
      row.maxBonus ===
      0.25
    &&
    row.gapRule ===
      'IGNORE_FIRST_3000'
  )
  ??
  null;


const best26 =
  candidateResults.find(
    row =>
      row.maxBonus ===
      0.26
    &&
    row.gapRule ===
      'IGNORE_FIRST_3000'
  )
  ??
  null;


// ============================================================
// DEATH VS PAYOUT
// ============================================================

const bestDeath =
  candidateResults.find(
    row =>
      row.anchor ===
      'DEATH'
    &&
    row.gapRule ===
      'IGNORE_FIRST_3000'
  )
  ??
  null;


const bestActiveFalse =
  candidateResults.find(
    row =>
      row.anchor ===
      'ACTIVE_FALSE'
    &&
    row.gapRule ===
      'IGNORE_FIRST_3000'
  )
  ??
  null;


// ============================================================
// 3000-IGNORE COMPARISON
// ============================================================

const bestWithIgnore =
  candidateResults.find(
    row =>
      row.gapRule ===
      'IGNORE_FIRST_3000'
  )
  ??
  null;


const bestWithoutIgnore =
  candidateResults.find(
    row =>
      row.gapRule ===
      'NO_3000_IGNORE_CONTROL'
  )
  ??
  null;


// ============================================================
// SECONDARY MAX-BONUS GRID
//
// Hold:
//
//   cap = 20%
//
// Search:
//
//   max reward bonus 15%-35%
//
// for each:
//
//   anchor
//   denominator
//   3000 rule
//   rounding
//
// ============================================================

const bonusGridResults =
  [];


for (
  const anchor
  of ANCHORS
) {

  for (
    const denominator
    of DENOMINATORS
  ) {

    for (
      const gapRule
      of GAP_RULES
    ) {

      for (
        const rounding
        of ROUNDING_RULES
      ) {

        let best =
          null;


        for (
          let maxBonus =
            BONUS_GRID_MIN;

          maxBonus <=
            BONUS_GRID_MAX +
            1e-9;

          maxBonus +=
            BONUS_GRID_STEP
        ) {

          const roundedBonus =
            Number(
              maxBonus.toFixed(
                3
              )
            );


          const model = {

            id:
              'GRID',

            anchor,

            denominator,

            gapRule,

            maxBonus:
              roundedBonus,

            rounding
          };


          const result =
            evaluateComebackModel(
              cases,
              model,
              false
            );


          if (
            !result
          ) {

            continue;
          }


          if (
            !best
            ||
            compareModelResults(
              result,
              best
            ) <
            0
          ) {

            best =
              result;
          }
        }


        if (
          best
        ) {

          bonusGridResults.push(
            best
          );
        }
      }
    }
  }
}


bonusGridResults.sort(
  compareModelResults
);


const bestGrid =
  bonusGridResults[0]
  ??
  null;


// ============================================================
// BEST MODEL CASES
// ============================================================

const bestCaseResults =
  bestModel
    ?.caseResults ??
  [];


// ============================================================
// BEST RESIDUAL STRUCTURE
// ============================================================

const bestResidualByTeam =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      String(
        row.creditedTeam
      ),
    row =>
      row.residual
  );


const bestResidualByStatus =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      row.creditedTeamStatus ??
      'UNKNOWN',
    row =>
      row.residual
  );


const bestResidualByRecipientCount =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      String(
        row.recipientCount
      ),
    row =>
      row.residual
  );


const bestResidualByTime =
  summarizeResidualGroups(
    bestCaseResults,
    row =>
      classifyTimeBand(
        row.matchMinute
      ),
    row =>
      row.residual
  );


// ============================================================
// TRAILING / LEADING COUNTS
// ============================================================

const deathStatusCounts =
  countBy(
    cases,
    row =>
      row
        .teamState
        .DEATH
        ?.creditedTeamStatus ??
      'UNKNOWN'
  );


const payoutStatusCounts =
  countBy(
    cases,
    row =>
      row
        .teamState
        .ACTIVE_FALSE
        ?.creditedTeamStatus ??
      'UNKNOWN'
  );


// ============================================================
// BASELINE RESIDUAL VS PREDICTED COMEBACK
// ============================================================

const baselineResidualVsComeback =
  bestModel
    ? pearsonCorrelation(
        bestCaseResults.map(
          row => ({

            x:
              row.predictedComebackAmount,

            y:
              row.baselineResidual
          })
        )
      )
    : null;


// ============================================================
// MODEL IMPROVEMENT
// ============================================================

const baselineRMSE =
  finite(
    summary93
      ?.bestDocumentedModel
      ?.rmse
  )
  ??
  baselineSummary.rmse;


const rmseImprovement =
  bestModel
  &&
  Number.isFinite(
    baselineRMSE
  )
    ? baselineRMSE -
      bestModel.rmse
    : null;


const rmseReductionFraction =
  bestModel
  &&
  Number.isFinite(
    baselineRMSE
  )
  &&
  baselineRMSE >
    0
    ? rmseImprovement /
      baselineRMSE
    : null;


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const comebackStrong =
  bestModel
  &&
  Number.isFinite(
    rmseReductionFraction
  )
  &&
  rmseReductionFraction >=
    0.50
  &&
  bestModel.within2Rate >=
    0.90;


const documented3000RuleSupported =
  bestWithIgnore
  &&
  bestWithoutIgnore
  &&
  bestWithIgnore.rmse <
    bestWithoutIgnore.rmse;


const deathAnchorPreferred =
  bestDeath
  &&
  bestActiveFalse
  &&
  bestDeath.rmse +
    0.10 <
  bestActiveFalse.rmse;


const payoutAnchorPreferred =
  bestDeath
  &&
  bestActiveFalse
  &&
  bestActiveFalse.rmse +
    0.10 <
  bestDeath.rmse;


const current26Preferred =
  best25
  &&
  best26
  &&
  best26.rmse +
    0.05 <
  best25.rmse;


const historical25Preferred =
  best25
  &&
  best26
  &&
  best25.rmse +
    0.05 <
  best26.rmse;


const bonusConstantUnresolved =
  best25
  &&
  best26
  &&
  Math.abs(
    best25.rmse -
    best26.rmse
  ) <=
    0.05;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script93Passed:
      check(
        summary93
          ?.validation
          ?.pass,
        true,
        summary93
          ?.validation
          ?.pass ===
        true
      ),


    script93CaseCount:
      check(
        cases93.length,
        replayName ===
          'test'
          ? 85
          : '>0',
        replayName ===
          'test'
          ? cases93.length ===
            85
          : cases93.length >
            0
      ),


    joinedCaseCount:
      check(
        cases.length,
        cases93.length,
        cases.length ===
        cases93.length
      ),


    deathNetWorthCoverage:
      check(
        anchorCoverage
          .DEATH
          .completeTwoTeamNetWorth,
        cases.length,
        anchorCoverage
          .DEATH
          .completeTwoTeamNetWorth ===
        cases.length
      ),


    activeFalseNetWorthCoverage:
      check(
        anchorCoverage
          .ACTIVE_FALSE
          .completeTwoTeamNetWorth,
        cases.length,
        anchorCoverage
          .ACTIVE_FALSE
          .completeTwoTeamNetWorth ===
        cases.length
      ),


    creditedTeamStatusesResolvedAtDeath:
      check(
        cases.filter(
          row =>
            row
              .teamState
              .DEATH
              ?.creditedTeamStatus !==
            'UNKNOWN'
        ).length,
        cases.length,
        cases.every(
          row =>
            row
              .teamState
              .DEATH
              ?.creditedTeamStatus !==
            'UNKNOWN'
        )
      ),


    candidateModelsPresent:
      check(
        candidateResults.length,
        '>0',
        candidateResults.length >
        0
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


    bonusGridResolved:
      check(
        Boolean(
          bestGrid
        ),
        true,
        Boolean(
          bestGrid
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
    'ASSIGNED_GOLD_COMEBACK_MODIFIER_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? comebackStrong
        ? 'TROOPER_COMEBACK_MODIFIER_STRONGLY_SUPPORTED'
        : 'COMEBACK_MODIFIER_DIAGNOSTIC_COMPLETE'
      : 'PIPELINE_VALIDATION_FAILURE',


  externalReferenceTarget: {

    ignoredAbsoluteNetWorthGap:
      IGNORED_ABSOLUTE_GAP,

    fullBonusAtDeficit:
      COMEBACK_FULL_AT_DEFICIT,

    maxBonusCandidates: {

      historicalOfficial:
        0.25,

      currentDocumented:
        0.26
    },

    semanticStatus:
      'EXTERNAL_REFERENCE_TARGETS_NOT_ASSUMED_TRUE'
  },


  purpose: [

    'Test whether Script93 team-linked positive residuals are explained by Deadlock team comeback economy.',

    'Measure exact team net worth at Trooper death and AssignedGold payout.',

    'Compare whether comeback state is better explained at source death versus eventual ground-soul resolution.',

    'Test the documented first-3000-net-worth-gap exclusion.',

    'Compare 25% historical and 26% current maximum comeback bonus references.',

    'Compare plausible denominator interpretations for percentage net-worth deficit.',

    'Determine whether comeback correction collapses the remaining ground-soul amount residuals.'
  ],


  semanticLimits: {

    netWorth:
      'Team net worth is reconstructed by summing controller m_iGoldNetWorth at the exact requested replay tick.',

    comeback:
      'A good match to the documented comeback formula is observational validation within test.dem, not engine-source proof.',

    maxBonus:
      '25% and 26% are tested separately because historical official and current reference values differ.',

    catchup:
      'The separate post-laning bottom-two-player catch-up mechanic is not modeled here. The primary cohort already requires exact integer-partition ground-soul reward events, which should strongly suppress unrelated player-specific additions.',

    anchor:
      'Death and active=false are compared because telemetry alone should determine whether the relevant team-state snapshot is source-time or payout-time.',

    denominator:
      'The exact engine definition of percent net-worth deficit is not assumed; leading-team, trailing-team, and mean-team denominators are compared.'
  },


  cohort: {

    cases:
      cases.length,

    deathStatusCounts,

    payoutStatusCounts
  },


  anchorCoverage,


  baseline: {

    modelId:
      summary93
        ?.bestDocumentedModel
        ?.id ??
      null,

    rmse:
      baselineRMSE,

    summary:
      baselineSummary,

    residualByTeam:
      baselineByTeam,

    residualByDeathStatus:
      baselineByDeathTrailingStatus,

    residualByPayoutStatus:
      baselineByPayoutTrailingStatus
  },


  documentedCandidateModels:
    candidateResults.map(
      stripCaseResults
    ),


  bestModel:
    bestModel
      ? stripCaseResults(
          bestModel
        )
      : null,


  bestDocumentedRule:
    bestDocumentedRule
      ? stripCaseResults(
          bestDocumentedRule
        )
      : null,


  comparisons: {

    max25:
      best25
        ? stripCaseResults(
            best25
          )
        : null,

    max26:
      best26
        ? stripCaseResults(
            best26
          )
        : null,

    deathAnchor:
      bestDeath
        ? stripCaseResults(
            bestDeath
          )
        : null,

    activeFalseAnchor:
      bestActiveFalse
        ? stripCaseResults(
            bestActiveFalse
          )
        : null,

    ignore3000:
      bestWithIgnore
        ? stripCaseResults(
            bestWithIgnore
          )
        : null,

    noIgnore3000:
      bestWithoutIgnore
        ? stripCaseResults(
            bestWithoutIgnore
          )
        : null
  },


  exploratoryBonusGrid: {

    searchMin:
      BONUS_GRID_MIN,

    searchMax:
      BONUS_GRID_MAX,

    step:
      BONUS_GRID_STEP,

    best:
      bestGrid
        ? stripCaseResults(
            bestGrid
          )
        : null,

    top:
      bonusGridResults
        .slice(
          0,
          20
        )
        .map(
          stripCaseResults
        )
  },


  improvement: {

    baselineRMSE,

    correctedRMSE:
      bestModel
        ?.rmse ??
      null,

    absoluteRMSEImprovement:
      rmseImprovement,

    fractionalRMSEReduction:
      rmseReductionFraction,

    baselineResidualVsPredictedComebackCorrelation:
      baselineResidualVsComeback
  },


  bestCorrectedResiduals: {

    byTeam:
      bestResidualByTeam,

    byCreditedTeamStatus:
      bestResidualByStatus,

    byRecipientCount:
      bestResidualByRecipientCount,

    byTime:
      bestResidualByTime
  },


  interpretiveFlags: {

    comebackStrong,

    documented3000RuleSupported,

    deathAnchorPreferred,

    payoutAnchorPreferred,

    current26Preferred,

    historical25Preferred,

    bonusConstantUnresolved
  },


  interpretationGuide: {

    comeback:
      'If comeback correction sharply reduces Script93 RMSE and removes the Team-3 positive residual tail, the remaining amount modifier is strongly attributable to trailing-team economy.',

    deathAnchor:
      'If death-time net worth clearly outperforms payout-time net worth, the ground-soul reward magnitude is most consistent with being determined when the Trooper dies rather than when the orb is later vacuumed.',

    first3000:
      'If IGNORE_FIRST_3000 outperforms the no-ignore control, the replay independently supports that documented mechanic.',

    maxBonus:
      'If 25% and 26% are nearly indistinguishable, keep the exact maximum unresolved until cross-replay provides larger comeback deficits.',

    grid:
      'The bonus grid is exploratory. A fitted maximum near 0.25-0.26 supports the documented magnitude but should not replace predefined validation.',

    next:
      comebackStrong
        ? 'Reassess exact integer allocation and remainder priority using comeback-corrected reward totals. If residuals then collapse to rounding-scale error, AssignedGold reward semantics are ready for cross-replay replication.'
        : 'Inspect trailing-team cases and remaining residual structure before introducing another modifier.'
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
  'ASSIGNED GOLD COMEBACK MODIFIER VALIDATION V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// COHORT
// ============================================================

console.log('');

console.log(
  'COHORT / TEAM STATE'
);

console.log(
  '-------------------'
);


console.log(
  `Cases: ${cases.length}`
);


console.log(
  `Death anchor coverage:       ${anchorCoverage.DEATH.completeTwoTeamNetWorth}/${cases.length}`
);


console.log(
  `Active=false coverage:       ${anchorCoverage.ACTIVE_FALSE.completeTwoTeamNetWorth}/${cases.length}`
);


console.log('');

console.log(
  'Credited-team status at death:'
);


printCounts(
  deathStatusCounts
);


console.log('');

console.log(
  'Credited-team status at payout:'
);


printCounts(
  payoutStatusCounts
);


// ============================================================
// BASELINE
// ============================================================

console.log('');

console.log(
  'SCRIPT93 BASELINE'
);

console.log(
  '-----------------'
);


console.log(
  `RMSE: ${formatNumber(baselineRMSE)}`
);


console.log(
  `MAE:  ${formatNumber(baselineSummary.mae)}`
);


console.log(
  `Max:  ${formatNumber(baselineSummary.maxAbsoluteResidual)}`
);


console.log('');

console.log(
  'Baseline residual by death-time status:'
);


printResidualGroups(
  baselineByDeathTrailingStatus
);


// ============================================================
// TOP MODELS
// ============================================================

console.log('');

console.log(
  'TOP COMEBACK MODELS'
);

console.log(
  '-------------------'
);


for (
  const row
  of candidateResults.slice(
    0,
    20
  )
) {

  console.log(

    `${row.id.padEnd(78)} ` +

    `RMSE=${formatNumber(row.rmse).padStart(7)} ` +

    `MAE=${formatNumber(row.mae).padStart(7)} ` +

    `exact=${formatPercent(row.exactRate).padStart(8)} ` +

    `<=1=${formatPercent(row.within1Rate).padStart(8)} ` +

    `<=2=${formatPercent(row.within2Rate).padStart(8)} ` +

    `max=${String(row.maxAbsoluteResidual).padStart(3)}`
  );
}


// ============================================================
// BEST
// ============================================================

console.log('');

console.log(
  'BEST COMEBACK MODEL'
);

console.log(
  '-------------------'
);


if (
  bestModel
) {

  console.log(
    `Model:          ${bestModel.id}`
  );


  console.log(
    `Anchor:         ${bestModel.anchor}`
  );


  console.log(
    `Denominator:    ${bestModel.denominator}`
  );


  console.log(
    `Gap rule:       ${bestModel.gapRule}`
  );


  console.log(
    `Max bonus:      ${formatPercent(bestModel.maxBonus)}`
  );


  console.log(
    `Rounding:       ${bestModel.roundingRule}`
  );


  console.log(
    `RMSE:           ${formatNumber(bestModel.rmse)}`
  );


  console.log(
    `MAE:            ${formatNumber(bestModel.mae)}`
  );


  console.log(
    `Exact:          ${bestModel.exact}/${bestModel.count} (${formatPercent(bestModel.exactRate)})`
  );


  console.log(
    `Within 1:       ${bestModel.within1}/${bestModel.count} (${formatPercent(bestModel.within1Rate)})`
  );


  console.log(
    `Within 2:       ${bestModel.within2}/${bestModel.count} (${formatPercent(bestModel.within2Rate)})`
  );


  console.log(
    `Max residual:   ${formatNumber(bestModel.maxAbsoluteResidual)}`
  );
}


// ============================================================
// CRITICAL COMPARISONS
// ============================================================

console.log('');

console.log(
  'CRITICAL COMPARISONS'
);

console.log(
  '--------------------'
);


printComparison(
  'Best 25%',
  best25
);


printComparison(
  'Best 26%',
  best26
);


printComparison(
  'Death anchor',
  bestDeath
);


printComparison(
  'Active=false anchor',
  bestActiveFalse
);


printComparison(
  'Ignore first 3000',
  bestWithIgnore
);


printComparison(
  'No 3000 ignore',
  bestWithoutIgnore
);


// ============================================================
// GRID
// ============================================================

console.log('');

console.log(
  'EXPLORATORY MAX-BONUS GRID'
);

console.log(
  '--------------------------'
);


if (
  bestGrid
) {

  console.log(
    `Best grid anchor:       ${bestGrid.anchor}`
  );


  console.log(
    `Best denominator:       ${bestGrid.denominator}`
  );


  console.log(
    `Best gap rule:          ${bestGrid.gapRule}`
  );


  console.log(
    `Best max bonus:         ${formatPercent(bestGrid.maxBonus)}`
  );


  console.log(
    `Best rounding:          ${bestGrid.roundingRule}`
  );


  console.log(
    `RMSE:                   ${formatNumber(bestGrid.rmse)}`
  );


  console.log(
    `Within 1:               ${formatPercent(bestGrid.within1Rate)}`
  );
}


// ============================================================
// IMPROVEMENT
// ============================================================

console.log('');

console.log(
  'BASELINE -> COMEBACK CORRECTION'
);

console.log(
  '-------------------------------'
);


console.log(
  `Baseline RMSE:                 ${formatNumber(baselineRMSE)}`
);


console.log(
  `Corrected RMSE:                ${formatNumber(bestModel?.rmse)}`
);


console.log(
  `Absolute improvement:          ${formatNumber(rmseImprovement)}`
);


console.log(
  `Fractional RMSE reduction:     ${formatPercent(rmseReductionFraction)}`
);


console.log(
  `Residual/comeback correlation: ${formatNumber(baselineResidualVsComeback?.r)}`
);


// ============================================================
// CORRECTED RESIDUALS
// ============================================================

console.log('');

console.log(
  'CORRECTED RESIDUALS BY TEAM'
);

console.log(
  '---------------------------'
);


printResidualGroups(
  bestResidualByTeam
);


console.log('');

console.log(
  'CORRECTED RESIDUALS BY TRAILING STATUS'
);

console.log(
  '--------------------------------------'
);


printResidualGroups(
  bestResidualByStatus
);


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
  `Comeback modifier strong:       ${comebackStrong}`
);


console.log(
  `3000-ignore supported:          ${documented3000RuleSupported}`
);


console.log(
  `Death anchor preferred:         ${deathAnchorPreferred}`
);


console.log(
  `Payout anchor preferred:        ${payoutAnchorPreferred}`
);


console.log(
  `Current 26% preferred:          ${current26Preferred}`
);


console.log(
  `Historical 25% preferred:       ${historical25Preferred}`
);


console.log(
  `25% vs 26% unresolved:          ${bonusConstantUnresolved}`
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

    `${name.padEnd(42)} ` +

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
// NET WORTH SNAPSHOT
// ============================================================

function collectNetWorthSnapshot(
  demo,
  tick
) {

  const controllers =
    demo.getEntitiesByClassName(
      'CCitadelPlayerController'
    )
    ??
    [];


  const players =
    [];


  const teamTotals =
    new Map();


  for (
    const controller
    of controllers
  ) {

    const playerName =
      safeGetField(
        controller,
        'm_iszPlayerName'
      );


    if (
      !playerName
      ||
      playerName ===
      'SourceTV'
    ) {

      continue;
    }


    const team =
      finite(
        safeGetField(
          controller,
          'm_iTeamNum'
        )
      );


    const netWorth =
      finite(
        safeGetField(
          controller,
          'm_iGoldNetWorth'
        )
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


    players.push({

      playerName:
        String(
          playerName
        ),

      team,

      netWorth
    });


    teamTotals.set(
      team,
      (
        teamTotals.get(
          team
        )
        ??
        0
      )
      +
      netWorth
    );
  }


  const sortedTeamTotals =
    [
      ...teamTotals.entries()
    ]
    .map(
      (
        [
          team,
          netWorth
        ]
      ) => ({

        team,

        netWorth
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        a.team -
        b.team
    );


  return {

    tick,

    players,

    teamTotals:
      sortedTeamTotals
  };
}


// ============================================================
// TWO TEAM SNAPSHOT
// ============================================================

function getTwoTeamSnapshot(
  snapshot
) {

  if (
    !snapshot
    ||
    !Array.isArray(
      snapshot.teamTotals
    )
  ) {

    return null;
  }


  const playable =
    snapshot
      .teamTotals
      .filter(
        row =>
          Number.isFinite(
            row.team
          )
          &&
          Number.isFinite(
            row.netWorth
          )
          &&
          row.team !==
            0
          &&
          row.team !==
            1
      );


  if (
    playable.length !==
    2
  ) {

    return null;
  }


  return playable;
}


// ============================================================
// TEAM STATE
// ============================================================

function buildTeamState(
  row,
  anchor
) {

  const snapshot =
    row
      .anchors[
        anchor
      ];


  const teams =
    getTwoTeamSnapshot(
      snapshot
    );


  if (
    !teams
  ) {

    return {

      anchor,

      resolved:
        false,

      creditedTeamStatus:
        'UNKNOWN'
    };
  }


  const credited =
    teams.find(
      team =>
        team.team ===
        row.creditedTeam
    )
    ??
    null;


  const opponent =
    teams.find(
      team =>
        team.team !==
        row.creditedTeam
    )
    ??
    null;


  if (
    !credited
    ||
    !opponent
  ) {

    return {

      anchor,

      resolved:
        false,

      creditedTeamStatus:
        'UNKNOWN'
    };
  }


  const creditedNW =
    credited.netWorth;


  const opponentNW =
    opponent.netWorth;


  let status;


  if (
    creditedNW <
    opponentNW
  ) {

    status =
      'TRAILING';

  } else if (
    creditedNW >
    opponentNW
  ) {

    status =
      'LEADING';

  } else {

    status =
      'TIED';
  }


  const leadingNW =
    Math.max(
      creditedNW,
      opponentNW
    );


  const trailingNW =
    Math.min(
      creditedNW,
      opponentNW
    );


  const rawGap =
    Math.abs(
      creditedNW -
      opponentNW
    );


  const ignored3000Gap =
    Math.max(
      0,
      rawGap -
      IGNORED_ABSOLUTE_GAP
    );


  return {

    anchor,

    resolved:
      true,

    creditedTeam:
      row.creditedTeam,

    creditedTeamNW:
      creditedNW,

    opponentTeam:
      opponent.team,

    opponentTeamNW:
      opponentNW,

    creditedTeamStatus:
      status,

    leadingNW,

    trailingNW,

    rawGap,

    ignored3000Gap,

    rawGapFractionOfLeader:
      leadingNW >
        0
        ? rawGap /
          leadingNW
        : null,

    ignoredGapFractionOfLeader:
      leadingNW >
        0
        ? ignored3000Gap /
          leadingNW
        : null
  };
}


// ============================================================
// COMEBACK MODEL
// ============================================================

function evaluateComebackModel(
  rows,
  model,
  includeCases = true
) {

  const results =
    [];


  for (
    const row
    of rows
  ) {

    const state =
      row
        .teamState[
          model.anchor
        ];


    if (
      !state
      ||
      state.resolved !==
        true
    ) {

      continue;
    }


    const trailing =
      state.creditedTeamStatus ===
      'TRAILING';


    let eligibleGap =
      0;


    let denominator =
      null;


    let deficitFraction =
      0;


    let ramp =
      0;


    let comebackBonusFraction =
      0;


    if (
      trailing
    ) {

      eligibleGap =
        model
          .gapRule
          .eligibleGap(
            state.rawGap
          );


      denominator =
        model
          .denominator
          .value({

            leading:
              state.leadingNW,

            trailing:
              state.trailingNW
          });


      if (
        Number.isFinite(
          denominator
        )
        &&
        denominator >
        0
      ) {

        deficitFraction =
          eligibleGap /
          denominator;


        ramp =
          Math.min(
            1,
            Math.max(
              0,
              deficitFraction /
              COMEBACK_FULL_AT_DEFICIT
            )
          );


        comebackBonusFraction =
          model.maxBonus *
          ramp;
      }
    }


    const ordinaryRawTotal =
      row.ordinaryGroundBase *
      row.documentedTotalMultiplier;


    const comebackMultiplier =
      1 +
      comebackBonusFraction;


    const correctedRawTotal =
      ordinaryRawTotal *
      comebackMultiplier;


    const predicted =
      model
        .rounding
        .fn(
          correctedRawTotal
        );


    const residual =
      row.teamTotal -
      predicted;


    const ordinaryContribution =
      ordinaryRawTotal;


    const predictedComebackAmount =
      correctedRawTotal -
      ordinaryRawTotal;


    results.push({

      deathIndex:
        row.deathIndex,

      clock:
        row.clock,

      matchMinute:
        row.matchMinute,

      creditedTeam:
        row.creditedTeam,

      creditedPlayerName:
        row.creditedPlayerName,

      baseType:
        row.baseType,

      recipientCount:
        row.recipientCount,

      actualTeamTotal:
        row.teamTotal,

      baselinePredicted:
        row.baselinePredicted,

      baselineResidual:
        row.baselineResidual,

      anchor:
        model.anchor,

      creditedTeamStatus:
        state.creditedTeamStatus,

      creditedTeamNW:
        state.creditedTeamNW,

      opponentTeamNW:
        state.opponentTeamNW,

      rawNetWorthGap:
        state.rawGap,

      eligibleNetWorthGap:
        eligibleGap,

      denominator,

      deficitFraction,

      comebackRamp:
        ramp,

      comebackMaxBonus:
        model.maxBonus,

      comebackBonusFraction,

      comebackMultiplier,

      ordinaryGroundBase:
        row.ordinaryGroundBase,

      documentedTotalMultiplier:
        row.documentedTotalMultiplier,

      ordinaryRawTotal:
        ordinaryContribution,

      predictedComebackAmount,

      correctedRawTotal,

      roundingRule:
        model.rounding.id,

      predictedTeamTotal:
        predicted,

      residual,

      absoluteResidual:
        Math.abs(
          residual
        )
    });
  }


  if (
    results.length ===
    0
  ) {

    return null;
  }


  const residuals =
    results.map(
      row =>
        row.residual
    );


  const absolute =
    results.map(
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

    anchor:
      model.anchor,

    denominator:
      model.denominator.id,

    gapRule:
      model.gapRule.id,

    maxBonus:
      model.maxBonus,

    roundingRule:
      model.rounding.id,

    count:
      results.length,

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
        results.length
      ),

    within1,

    within1Rate:
      rate(
        within1,
        results.length
      ),

    within2,

    within2Rate:
      rate(
        within2,
        results.length
      ),

    within3,

    within3Rate:
      rate(
        within3,
        results.length
      ),

    residualDistribution:
      summarizeNumbers(
        residuals
      ),

    comebackBonusDistribution:
      summarizeNumbers(
        results.map(
          row =>
            row.comebackBonusFraction
        )
      ),

    predictedComebackAmountDistribution:
      summarizeNumbers(
        results.map(
          row =>
            row.predictedComebackAmount
        )
      ),

    caseResults:
      includeCases
        ? results
        : undefined
  };
}


// ============================================================
// MODEL ORDER
// ============================================================

function compareModelResults(
  a,
  b
) {

  return (
    a.rmse -
      b.rmse
    ||
    a.mae -
      b.mae
    ||
    b.exactRate -
      a.exactRate
    ||
    b.within1Rate -
      a.within1Rate
  );
}


// ============================================================
// BASELINE
// ============================================================

function summarizeExistingResiduals(
  rows
) {

  const residuals =
    rows
      .map(
        row =>
          row.baselineResidual
      )
      .filter(
        Number.isFinite
      );


  const absolute =
    residuals.map(
      Math.abs
    );


  return {

    count:
      residuals.length,

    rmse:
      residuals.length >
        0
        ? Math.sqrt(
          mean(
            residuals.map(
              value =>
                value *
                value
            )
          )
        )
        : null,

    mae:
      mean(
        absolute
      ),

    maxAbsoluteResidual:
      absolute.length >
        0
        ? Math.max(
          ...absolute
        )
        : null,

    residual:
      summarizeNumbers(
        residuals
      )
  };
}


// ============================================================
// RESIDUAL GROUPS
// ============================================================

function summarizeResidualGroups(
  rows,
  groupSelector,
  residualSelector
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const residual =
      finite(
        residualSelector(
          row
        )
      );


    if (
      residual ===
      null
    ) {

      continue;
    }


    const key =
      String(
        groupSelector(
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
        residual
      );
  }


  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          group,
          residuals
        ]
      ) => {

        const absolute =
          residuals.map(
            Math.abs
          );


        return {

          group,

          count:
            residuals.length,

          residual:
            summarizeNumbers(
              residuals
            ),

          absoluteResidual:
            summarizeNumbers(
              absolute
            ),

          exactRate:
            rate(
              absolute.filter(
                value =>
                  value ===
                  0
              ).length,
              absolute.length
            ),

          within1Rate:
            rate(
              absolute.filter(
                value =>
                  value <=
                  1
              ).length,
              absolute.length
            ),

          within2Rate:
            rate(
              absolute.filter(
                value =>
                  value <=
                  2
              ).length,
              absolute.length
            )
        };
      }
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
// PEARSON
// ============================================================

function pearsonCorrelation(
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


  let denominatorX =
    0;


  let denominatorY =
    0;


  for (
    const row
    of clean
  ) {

    const dx =
      row.x -
      meanX;


    const dy =
      row.y -
      meanY;


    numerator +=
      dx *
      dy;


    denominatorX +=
      dx *
      dx;


    denominatorY +=
      dy *
      dy;
  }


  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );


  return {

    count:
      clean.length,

    r:
      denominator >
        0
        ? numerator /
          denominator
        : null
  };
}


// ============================================================
// STRIP LARGE CASE ARRAY
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

    anchor:
      row.anchor,

    denominator:
      row.denominator,

    gapRule:
      row.gapRule,

    maxBonus:
      row.maxBonus,

    roundingRule:
      row.roundingRule,

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
      row.residualDistribution,

    comebackBonusDistribution:
      row.comebackBonusDistribution,

    predictedComebackAmountDistribution:
      row.predictedComebackAmountDistribution
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


  return `${lower}_TO_LT_${lower + 5}_MIN`;
}


// ============================================================
// RAW ENTITY HELPERS
// ============================================================

function safeGetField(
  entity,
  fieldName
) {

  try {

    return typeof entity?.getField ===
      'function'
      ? entity.getField(
          fieldName
        )
      : undefined;

  } catch {

    return undefined;
  }
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
        'UNKNOWN'
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

function printCounts(
  counts
) {

  for (
    const [
      key,
      value
    ]
    of Object.entries(
      counts
    )
  ) {

    console.log(
      `  ${key.padEnd(12)} ${value}`
    );
  }
}


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


    console.log(
      `  <=2:      ${formatPercent(row.within2Rate)}`
    );
  }
}


function printComparison(
  label,
  row
) {

  if (
    !row
  ) {

    console.log(
      `${label.padEnd(22)} n/a`
    );

    return;
  }


  console.log(

    `${label.padEnd(22)} ` +

    `RMSE=${formatNumber(row.rmse).padStart(7)} ` +

    `MAE=${formatNumber(row.mae).padStart(7)} ` +

    `<=1=${formatPercent(row.within1Rate).padStart(8)} ` +

    `exact=${formatPercent(row.exactRate).padStart(8)} ` +

    `${row.anchor}/${row.denominator}/${row.gapRule}/${formatPercent(row.maxBonus)}/${row.roundingRule}`
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
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}