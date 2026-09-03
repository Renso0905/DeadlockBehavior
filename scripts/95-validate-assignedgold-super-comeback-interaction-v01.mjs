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
// DOCUMENTED / INDEPENDENT CANDIDATE MECHANICS
//
// ORDINARY GROUND REWARD:
//
//   50 + 1 soul / match minute
//
// TROOPER SHARING:
//
//   N=1  100% each  = 100% total
//   N=2   54% each  = 108% total
//   N=3   36% each  = 108% total
//   N=4   25% each  = 100% total
//   N=5   20% each  = 100% total
//   N=6   16% each  =  96% total
//
// SUPER TROOPER:
//
//   current documented bounty reduction:
//       -15%
//       multiplier = 0.85
//
// TEAM COMEBACK:
//
//   historical maximum candidate:
//       +25%
//
//   current documented maximum candidate:
//       +26%
//
//   first 3000 team-NW gap ignored
//
//   full bonus at approximately 20% eligible NW deficit
//
// Script94 found LEADING_TEAM denominator was the best of the
// denominator candidates, but comeback alone overpredicted some
// trailing-team events.
//
// Script95 tests whether those failures are explained by the
// independently observed Super-Trooper bounty reduction.
// ============================================================

const SUPER_BOUNTY_FACTOR =
  0.85;


const COMEBACK_MAX_CANDIDATES = [
  0,
  0.25,
  0.26
];


const IGNORED_NET_WORTH_GAP =
  3000;


const FULL_COMEBACK_DEFICIT =
  0.20;


// ============================================================
// ROUNDING
//
// Script93 favored pool-first integerization.
// We retain all three final integerization candidates.
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
// EXPLORATORY 2D GRID
//
// SECONDARY ONLY.
//
// This searches:
//
//   Super bounty factor
//
// and
//
//   maximum comeback bonus
//
// simultaneously.
//
// If the fitted values independently converge near:
//
//   Super ≈ 0.85
//   Comeback ≈ 0.25–0.26
//
// that is much stronger than either parameter being fit alone.
//
// Grid values must NOT replace predefined mechanic validation.
// ============================================================

const SUPER_GRID_MIN =
  0.75;


const SUPER_GRID_MAX =
  1.00;


const SUPER_GRID_STEP =
  0.005;


const COMEBACK_GRID_MIN =
  0.10;


const COMEBACK_GRID_MAX =
  0.35;


const COMEBACK_GRID_STEP =
  0.005;


// ============================================================
// PATHS
// ============================================================

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


const summary94Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_comeback_modifier_validation_v01.json'
  );


const cases94Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_comeback_modifier_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_super_comeback_interaction_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_super_comeback_interaction_cases_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    summary93Path,
    cases93Path,
    summary94Path,
    cases94Path
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
// LOAD SUMMARIES
// ============================================================

const summary93 =
  JSON.parse(
    readFileSync(
      summary93Path,
      'utf8'
    )
  );


const summary94 =
  JSON.parse(
    readFileSync(
      summary94Path,
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


if (
  summary94
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 94 did not PASS.'
  );
}


// ============================================================
// LOAD CASES
// ============================================================

console.log('');

console.log(
  'Loading Script 93 reward cases...'
);


const cases93 =
  await loadJsonl(
    cases93Path
  );


console.log(
  `Script 93 cases: ${cases93.length}`
);


console.log(
  'Loading Script 94 team-state cases...'
);


const cases94 =
  await loadJsonl(
    cases94Path
  );


console.log(
  `Script 94 cases: ${cases94.length}`
);


// ============================================================
// INDEX SCRIPT94
// ============================================================

const case94ByDeath =
  new Map();


for (
  const row
  of cases94
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    case94ByDeath.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// JOIN
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


  const source94 =
    case94ByDeath.get(
      deathIndex
    )
    ??
    null;


  if (
    !source94
  ) {

    continue;
  }


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


  const totalShareMultiplier =
    finite(
      source93
        ?.documentedTotalMultiplier
    );


  const nominalGroundBase =
    finite(
      source93
        ?.nominalUnsharedGroundBase
    )
    ??
    (
      matchMinute !==
        null
        ? 50 +
          matchMinute
        : null
    );


  const creditedTeamNW =
    finite(
      source94?.creditedTeamNW
    );


  const opponentTeamNW =
    finite(
      source94?.opponentTeamNW
    );


  const rawNetWorthGap =
    finite(
      source94?.rawNetWorthGap
    );


  if (
    matchMinute ===
      null
    ||
    teamTotal ===
      null
    ||
    recipientCount ===
      null
    ||
    totalShareMultiplier ===
      null
    ||
    nominalGroundBase ===
      null
    ||
    creditedTeamNW ===
      null
    ||
    opponentTeamNW ===
      null
    ||
    rawNetWorthGap ===
      null
  ) {

    continue;
  }


  const variantLabel =
    String(
      source93?.variantLabel ??
      'UNKNOWN'
    );


  const variant =
    classifyVariant(
      variantLabel
    );


  const creditedTeamStatus =
    source94
      ?.creditedTeamStatus ??
    (
      creditedTeamNW <
        opponentTeamNW
        ? 'TRAILING'
        : creditedTeamNW >
          opponentTeamNW
          ? 'LEADING'
          : 'TIED'
    );


  const leadingTeamNW =
    Math.max(
      creditedTeamNW,
      opponentTeamNW
    );


  const trailingTeamNW =
    Math.min(
      creditedTeamNW,
      opponentTeamNW
    );


  const eligibleNetWorthGap =
    Math.max(
      0,
      rawNetWorthGap -
      IGNORED_NET_WORTH_GAP
    );


  const eligibleDeficitFraction =
    leadingTeamNW >
      0
      ? eligibleNetWorthGap /
        leadingTeamNW
      : 0;


  const comebackRamp =
    creditedTeamStatus ===
      'TRAILING'
      ? Math.min(
          1,
          Math.max(
            0,
            eligibleDeficitFraction /
            FULL_COMEBACK_DEFICIT
          )
        )
      : 0;


  const ordinaryRawTotal =
    nominalGroundBase *
    totalShareMultiplier;


  const script93Predicted =
    finite(
      source93
        ?.predictedTeamTotal
    );


  const script93Residual =
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
      source94?.clock ??
      null,

    matchMinute,

    creditedTeam:
      finite(
        source93?.creditedTeam
      )
      ??
      finite(
        source94?.creditedTeam
      ),

    creditedPlayerName:
      source93
        ?.creditedPlayerName ??
      source94
        ?.creditedPlayerName ??
      null,

    baseType:
      source93?.baseType ??
      source94?.baseType ??
      null,

    variantLabel,

    isSuper:
      variant.isSuper,

    isRift:
      variant.isRift,

    recipientCount,

    teamTotal,

    nominalGroundBase,

    totalShareMultiplier,

    ordinaryRawTotal,

    script93Predicted,

    script93Residual,

    script93AbsoluteResidual:
      script93Residual !==
        null
        ? Math.abs(
          script93Residual
        )
        : null,

    creditedTeamStatus,

    creditedTeamNW,

    opponentTeamNW,

    leadingTeamNW,

    trailingTeamNW,

    rawNetWorthGap,

    eligibleNetWorthGap,

    eligibleDeficitFraction,

    comebackRamp,

    observedFactorVsOrdinaryRaw:
      ordinaryRawTotal >
        0
        ? teamTotal /
          ordinaryRawTotal
        : null,

    observedBonusVsOrdinaryRaw:
      ordinaryRawTotal >
        0
        ? teamTotal /
          ordinaryRawTotal -
          1
        : null
  });
}


console.log('');

console.log(
  `Joined cases: ${cases.length}`
);


// ============================================================
// COHORTS
// ============================================================

const normalCases =
  cases.filter(
    row =>
      !row.isSuper
      &&
      !row.isRift
  );


const superCases =
  cases.filter(
    row =>
      row.isSuper
  );


const riftCases =
  cases.filter(
    row =>
      row.isRift
  );


const trailingCases =
  cases.filter(
    row =>
      row.creditedTeamStatus ===
      'TRAILING'
  );


const leadingCases =
  cases.filter(
    row =>
      row.creditedTeamStatus ===
      'LEADING'
  );


const normalTrailing =
  normalCases.filter(
    row =>
      row.creditedTeamStatus ===
      'TRAILING'
  );


const normalLeading =
  normalCases.filter(
    row =>
      row.creditedTeamStatus ===
      'LEADING'
  );


const superTrailing =
  superCases.filter(
    row =>
      row.creditedTeamStatus ===
      'TRAILING'
  );


const superLeading =
  superCases.filter(
    row =>
      row.creditedTeamStatus ===
      'LEADING'
  );


// ============================================================
// BASELINE REPRODUCTION
//
// Our no-super / no-comeback / CEIL model should reproduce
// Script93's best model exactly.
//
// If it does not, stop interpretation.
// ============================================================

const baselineReproduction =
  evaluateModel(
    cases,
    {

      id:
        'BASELINE_REPRODUCTION',

      superFactor:
        1,

      applySuper:
        false,

      comebackMax:
        0,

      rounding:
        ROUNDING_RULES.find(
          row =>
            row.id ===
            'CEIL'
        )
    }
  );


let baselinePredictionAgreements =
  0;


for (
  const result
  of baselineReproduction.caseResults
) {

  const source =
    cases.find(
      row =>
        row.deathIndex ===
        result.deathIndex
    );


  if (
    source
    &&
    source.script93Predicted ===
      result.predictedTeamTotal
  ) {

    baselinePredictionAgreements++;
  }
}


// ============================================================
// VARIANT / BASELINE DIAGNOSTIC
// ============================================================

const baselineByVariant =
  summarizeExistingGroups(
    cases,
    row =>
      row.variantLabel
  );


const baselineBySuper =
  summarizeExistingGroups(
    cases,
    row =>
      row.isSuper
        ? 'SUPER'
        : row.isRift
          ? 'RIFT_NON_SUPER'
          : 'NON_SUPER_NON_RIFT'
  );


const baselineByTeamStatus =
  summarizeExistingGroups(
    cases,
    row =>
      row.creditedTeamStatus
  );


const baselineByTeam =
  summarizeExistingGroups(
    cases,
    row =>
      String(
        row.creditedTeam
      )
  );


// ============================================================
// FIXED PREDEFINED MODELS
//
// These are the actual validation comparisons.
//
// Super:
//   none
//   documented 0.85
//
// Comeback:
//   none
//   historical 25%
//   current 26%
//
// Final integerization:
//   floor / round / ceil
// ============================================================

const fixedModels =
  [];


for (
  const applySuper
  of [
    false,
    true
  ]
) {

  for (
    const comebackMax
    of COMEBACK_MAX_CANDIDATES
  ) {

    for (
      const rounding
      of ROUNDING_RULES
    ) {

      fixedModels.push({

        id:
          [
            applySuper
              ? 'SUPER_085'
              : 'NO_SUPER',

            `COMEBACK_${Math.round(
              comebackMax *
              100
            )}`,

            rounding.id
          ].join(
            '__'
          ),

        applySuper,

        superFactor:
          SUPER_BOUNTY_FACTOR,

        comebackMax,

        rounding
      });
    }
  }
}


const fixedResults =
  fixedModels
    .map(
      model =>
        evaluateModel(
          cases,
          model
        )
    )
    .sort(
      compareResults
    );


const bestFixed =
  fixedResults[0]
  ??
  null;


// ============================================================
// IMPORTANT PREDEFINED COMPARISONS
// ============================================================

const bestNoModifiers =
  bestMatchingModel(
    fixedResults,
    row =>
      row.applySuper ===
        false
      &&
      row.comebackMax ===
        0
  );


const bestSuperOnly =
  bestMatchingModel(
    fixedResults,
    row =>
      row.applySuper ===
        true
      &&
      row.comebackMax ===
        0
  );


const bestComeback25Only =
  bestMatchingModel(
    fixedResults,
    row =>
      row.applySuper ===
        false
      &&
      row.comebackMax ===
        0.25
  );


const bestComeback26Only =
  bestMatchingModel(
    fixedResults,
    row =>
      row.applySuper ===
        false
      &&
      row.comebackMax ===
        0.26
  );


const bestCombined25 =
  bestMatchingModel(
    fixedResults,
    row =>
      row.applySuper ===
        true
      &&
      row.comebackMax ===
        0.25
  );


const bestCombined26 =
  bestMatchingModel(
    fixedResults,
    row =>
      row.applySuper ===
        true
      &&
      row.comebackMax ===
        0.26
  );


// ============================================================
// NORMAL-TROOPER COMEBACK TEST
//
// This is especially important.
//
// Super Troopers are removed entirely.
//
// If the documented comeback relationship works much better on
// ordinary trailing Troopers, Script94's failure was confounding
// rather than evidence against comeback.
// ============================================================

const normalTrailing25 =
  evaluateBestRounding(
    normalTrailing,
    {

      applySuper:
        false,

      superFactor:
        1,

      comebackMax:
        0.25,

      idPrefix:
        'NORMAL_TRAILING_COMEBACK_25'
    }
  );


const normalTrailing26 =
  evaluateBestRounding(
    normalTrailing,
    {

      applySuper:
        false,

      superFactor:
        1,

      comebackMax:
        0.26,

      idPrefix:
        'NORMAL_TRAILING_COMEBACK_26'
    }
  );


const normalTrailingNoComeback =
  evaluateBestRounding(
    normalTrailing,
    {

      applySuper:
        false,

      superFactor:
        1,

      comebackMax:
        0,

      idPrefix:
        'NORMAL_TRAILING_NO_COMEBACK'
    }
  );


// ============================================================
// SUPER-TROOPER INTERACTION TEST
// ============================================================

const superTrailing25 =
  evaluateBestRounding(
    superTrailing,
    {

      applySuper:
        true,

      superFactor:
        SUPER_BOUNTY_FACTOR,

      comebackMax:
        0.25,

      idPrefix:
        'SUPER_TRAILING_SUPER085_COMEBACK25'
    }
  );


const superTrailing26 =
  evaluateBestRounding(
    superTrailing,
    {

      applySuper:
        true,

      superFactor:
        SUPER_BOUNTY_FACTOR,

      comebackMax:
        0.26,

      idPrefix:
        'SUPER_TRAILING_SUPER085_COMEBACK26'
    }
  );


const superTrailingNoSuper =
  evaluateBestRounding(
    superTrailing,
    {

      applySuper:
        false,

      superFactor:
        1,

      comebackMax:
        0.25,

      idPrefix:
        'SUPER_TRAILING_COMEBACK25_NO_SUPER_DISCOUNT'
    }
  );


// ============================================================
// EXPLORATORY TWO-DIMENSIONAL GRID
//
// Active-false team state / leading-team denominator / first
// 3000 ignored are held fixed.
//
// Search:
//
//   Super bounty multiplier
//   comeback maximum
//
// Rounding remains selectable.
//
// ============================================================

const gridResults =
  [];


for (
  let superFactor =
    SUPER_GRID_MIN;

  superFactor <=
    SUPER_GRID_MAX +
    1e-9;

  superFactor +=
    SUPER_GRID_STEP
) {

  const cleanSuperFactor =
    Number(
      superFactor.toFixed(
        3
      )
    );


  for (
    let comebackMax =
      COMEBACK_GRID_MIN;

    comebackMax <=
      COMEBACK_GRID_MAX +
      1e-9;

    comebackMax +=
      COMEBACK_GRID_STEP
  ) {

    const cleanComeback =
      Number(
        comebackMax.toFixed(
          3
        )
      );


    for (
      const rounding
      of ROUNDING_RULES
    ) {

      const result =
        evaluateModel(
          cases,
          {

            id:
              'GRID',

            applySuper:
              true,

            superFactor:
              cleanSuperFactor,

            comebackMax:
              cleanComeback,

            rounding
          },

          false
        );


      gridResults.push(
        result
      );
    }
  }
}


gridResults.sort(
  compareResults
);


const bestGrid =
  gridResults[0]
  ??
  null;


// ============================================================
// GRID DISTANCE FROM DOCUMENTED TARGET
// ============================================================

const bestGridSuperDifference =
  bestGrid
    ? bestGrid.superFactor -
      SUPER_BOUNTY_FACTOR
    : null;


const bestGridComeback25Difference =
  bestGrid
    ? bestGrid.comebackMax -
      0.25
    : null;


const bestGridComeback26Difference =
  bestGrid
    ? bestGrid.comebackMax -
      0.26
    : null;


// ============================================================
// BEST FIXED RESIDUAL STRUCTURE
// ============================================================

const bestFixedCases =
  bestFixed
    ?.caseResults ??
  [];


const bestByVariant =
  summarizeModelGroups(
    bestFixedCases,
    row =>
      row.variantLabel
  );


const bestBySuper =
  summarizeModelGroups(
    bestFixedCases,
    row =>
      row.isSuper
        ? 'SUPER'
        : row.isRift
          ? 'RIFT_NON_SUPER'
          : 'NON_SUPER_NON_RIFT'
  );


const bestByStatus =
  summarizeModelGroups(
    bestFixedCases,
    row =>
      row.creditedTeamStatus
  );


const bestByTeam =
  summarizeModelGroups(
    bestFixedCases,
    row =>
      String(
        row.creditedTeam
      )
  );


const bestByTime =
  summarizeModelGroups(
    bestFixedCases,
    row =>
      classifyTimeBand(
        row.matchMinute
      )
  );


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
  baselineReproduction.rmse;


const combinedRMSE =
  bestFixed
    ?.rmse ??
  null;


const absoluteImprovement =
  Number.isFinite(
    baselineRMSE
  )
  &&
  Number.isFinite(
    combinedRMSE
  )
    ? baselineRMSE -
      combinedRMSE
    : null;


const fractionalImprovement =
  Number.isFinite(
    absoluteImprovement
  )
  &&
  baselineRMSE >
    0
    ? absoluteImprovement /
      baselineRMSE
    : null;


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const superCasesPresent =
  superCases.length >
  0;


const superComebackInteractionImproves =
  bestCombined25
  &&
  bestComeback25Only
  &&
  bestCombined25.rmse +
    0.25 <
  bestComeback25Only.rmse;


const normalTrailingComebackImproves =
  normalTrailing25
  &&
  normalTrailingNoComeback
  &&
  normalTrailing25.rmse +
    0.25 <
  normalTrailingNoComeback.rmse;


const combinedModelStrong =
  bestFixed
  &&
  Number.isFinite(
    fractionalImprovement
  )
  &&
  fractionalImprovement >=
    0.50
  &&
  bestFixed.within2Rate >=
    0.90;


const gridNearSuper085 =
  bestGrid
  &&
  Math.abs(
    bestGridSuperDifference
  ) <=
    0.03;


const gridNearComebackDocumented =
  bestGrid
  &&
  (
    Math.abs(
      bestGridComeback25Difference
    ) <=
      0.03
    ||
    Math.abs(
      bestGridComeback26Difference
    ) <=
      0.03
  );


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


    script94Passed:
      check(
        summary94
          ?.validation
          ?.pass,
        true,
        summary94
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


    script94CaseCount:
      check(
        cases94.length,
        replayName ===
          'test'
          ? 85
          : '>0',
        replayName ===
          'test'
          ? cases94.length ===
            85
          : cases94.length >
            0
      ),


    joinedCases:
      check(
        cases.length,
        cases93.length,
        cases.length ===
        cases93.length
      ),


    baselineReproduction:
      check(
        baselinePredictionAgreements,
        cases.length,
        baselinePredictionAgreements ===
        cases.length
      ),


    normalCasesPresent:
      check(
        normalCases.length,
        '>0',
        normalCases.length >
        0
      ),


    trailingCasesPresent:
      check(
        trailingCases.length,
        '>0',
        trailingCases.length >
        0
      ),


    normalTrailingCasesPresent:
      check(
        normalTrailing.length,
        '>0',
        normalTrailing.length >
        0
      ),


    fixedModelsPresent:
      check(
        fixedResults.length,
        18,
        fixedResults.length ===
        18
      ),


    bestFixedResolved:
      check(
        Boolean(
          bestFixed
        ),
        true,
        Boolean(
          bestFixed
        )
      ),


    gridResolved:
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
    'ASSIGNED_GOLD_SUPER_COMEBACK_INTERACTION_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? combinedModelStrong
        ? 'SUPER_AND_COMEBACK_INTERACTION_STRONGLY_SUPPORTED'
        : 'SUPER_COMEBACK_INTERACTION_DIAGNOSTIC_COMPLETE'
      : 'PIPELINE_VALIDATION_FAILURE',


  externalReferenceTargets: {

    superTrooperBountyFactor:
      SUPER_BOUNTY_FACTOR,

    comebackMaxCandidates: {

      historical:
        0.25,

      current:
        0.26
    },

    ignoredNetWorthGap:
      IGNORED_NET_WORTH_GAP,

    fullComebackAtDeficit:
      FULL_COMEBACK_DEFICIT,

    semanticStatus:
      'EXTERNAL_REFERENCE_TARGETS_NOT_ASSUMED_TRUE'
  },


  purpose: [

    'Test whether Script94 comeback failures are explained by the independently observed Super-Trooper bounty reduction.',

    'Separate normal trailing Troopers from Super trailing Troopers before evaluating comeback economy.',

    'Test the predefined -15% Super bounty modifier jointly with 25% and 26% comeback candidates.',

    'Determine whether the late Team-3 negative residuals correspond to Super Troopers.',

    'Avoid interpreting Script94 exploratory ~15% comeback fit before accounting for Trooper variant bounty.',

    'Use a secondary two-dimensional grid to determine whether independently fitted Super and comeback parameters converge near documented values.'
  ],


  semanticLimits: {

    superClassification:
      'Super status is inherited from the existing provisional HP-based Trooper variant classification. The HP pattern is strong within test.dem, but variant classification remains noncanonical.',

    comebackAnchor:
      'This diagnostic uses Script94 active=false team-state rows because active=false marginally won Script94. Death versus payout timing remained essentially unresolved and should not be promoted from this test.',

    comebackFormula:
      'The first-3000 exclusion, leading-team denominator, and 20% cap are candidate semantics. Success would validate the combined model within test.dem, not engine source code.',

    grid:
      'The two-dimensional grid is exploratory and must not supersede predefined 0.85 and 0.25/0.26 validation targets.',

    rift:
      'Rift-labelled cases are retained and reported rather than silently removed because the existing variant ontology remains provisional.'
  },


  cohort: {

    all:
      cases.length,

    normalNonRift:
      normalCases.length,

    super:
      superCases.length,

    rift:
      riftCases.length,

    trailing:
      trailingCases.length,

    leading:
      leadingCases.length,

    normalTrailing:
      normalTrailing.length,

    normalLeading:
      normalLeading.length,

    superTrailing:
      superTrailing.length,

    superLeading:
      superLeading.length,

    variantCounts:
      countBy(
        cases,
        row =>
          row.variantLabel
      )
  },


  baseline: {

    rmse:
      baselineRMSE,

    reproductionAgreements:
      baselinePredictionAgreements,

    reproductionCases:
      cases.length,

    byVariant:
      baselineByVariant,

    bySuperStatus:
      baselineBySuper,

    byTeamStatus:
      baselineByTeamStatus,

    byTeam:
      baselineByTeam
  },


  fixedModels:
    fixedResults.map(
      stripCases
    ),


  criticalComparisons: {

    noModifiers:
      stripCases(
        bestNoModifiers
      ),

    superOnly:
      stripCases(
        bestSuperOnly
      ),

    comeback25Only:
      stripCases(
        bestComeback25Only
      ),

    comeback26Only:
      stripCases(
        bestComeback26Only
      ),

    combinedSuper085Comeback25:
      stripCases(
        bestCombined25
      ),

    combinedSuper085Comeback26:
      stripCases(
        bestCombined26
      )
  },


  isolatedNormalTrailingComeback: {

    noComeback:
      stripCases(
        normalTrailingNoComeback
      ),

    comeback25:
      stripCases(
        normalTrailing25
      ),

    comeback26:
      stripCases(
        normalTrailing26
      )
  },


  isolatedSuperTrailingInteraction: {

    comeback25WithoutSuperDiscount:
      stripCases(
        superTrailingNoSuper
      ),

    super085Comeback25:
      stripCases(
        superTrailing25
      ),

    super085Comeback26:
      stripCases(
        superTrailing26
      )
  },


  bestFixedModel:
    stripCases(
      bestFixed
    ),


  bestFixedResiduals: {

    byVariant:
      bestByVariant,

    bySuperStatus:
      bestBySuper,

    byTeamStatus:
      bestByStatus,

    byTeam:
      bestByTeam,

    byTime:
      bestByTime
  },


  exploratoryGrid: {

    superFactorRange: {
      min:
        SUPER_GRID_MIN,

      max:
        SUPER_GRID_MAX,

      step:
        SUPER_GRID_STEP
    },

    comebackRange: {
      min:
        COMEBACK_GRID_MIN,

      max:
        COMEBACK_GRID_MAX,

      step:
        COMEBACK_GRID_STEP
    },

    best:
      stripCases(
        bestGrid
      ),

    superFactorDifferenceFrom085:
      bestGridSuperDifference,

    comebackDifferenceFrom25:
      bestGridComeback25Difference,

    comebackDifferenceFrom26:
      bestGridComeback26Difference,

    top:
      gridResults
        .slice(
          0,
          25
        )
        .map(
          stripCases
        )
  },


  improvement: {

    script93BaselineRMSE:
      baselineRMSE,

    bestFixedCombinedRMSE:
      combinedRMSE,

    absoluteRMSEImprovement:
      absoluteImprovement,

    fractionalRMSEImprovement:
      fractionalImprovement
  },


  interpretiveFlags: {

    superCasesPresent,

    superComebackInteractionImproves,

    normalTrailingComebackImproves,

    combinedModelStrong,

    gridNearSuper085,

    gridNearComebackDocumented
  },


  interpretationGuide: {

    normalTrailing:
      'If comeback materially improves normal trailing Troopers after Super cases are removed, Script94 was confounded rather than a clean falsification of comeback.',

    superTrailing:
      'If adding a 0.85 Super factor sharply improves Super trailing cases, the late negative residuals are explained by concurrent Super bounty reduction and comeback economy.',

    combined:
      'If the full predefined Super+comeback model substantially beats both comeback-only and Super-only models, the two modifiers interact multiplicatively in the observed reward stream.',

    grid:
      'If the unrestricted 2D grid converges near Super=0.85 and comeback=0.25–0.26, the replay independently recovers both external mechanic magnitudes.',

    next:
      combinedModelStrong
        ? 'Run one final exact integer-allocation validation using Super- and comeback-corrected reward pools, then move AssignedGold economics to cross-replay replication.'
        : 'Inspect residuals by exact variant and trailing status before adding any further economy modifier.'
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
  of bestFixedCases
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
  'ASSIGNED GOLD SUPER + COMEBACK INTERACTION V0.1'
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
  `All cases:              ${cases.length}`
);


console.log(
  `Normal non-Rift:        ${normalCases.length}`
);


console.log(
  `Super:                  ${superCases.length}`
);


console.log(
  `Rift-labelled:          ${riftCases.length}`
);


console.log(
  `Trailing:               ${trailingCases.length}`
);


console.log(
  `Leading:                ${leadingCases.length}`
);


console.log(
  `Normal trailing:        ${normalTrailing.length}`
);


console.log(
  `Super trailing:         ${superTrailing.length}`
);


console.log(
  `Super leading:          ${superLeading.length}`
);


// ============================================================
// VARIANTS
// ============================================================

console.log('');

console.log(
  'VARIANT COUNTS'
);

console.log(
  '--------------'
);


printCounts(
  countBy(
    cases,
    row =>
      row.variantLabel
  )
);


// ============================================================
// BASELINE RESIDUALS
// ============================================================

console.log('');

console.log(
  'SCRIPT93 BASELINE BY VARIANT'
);

console.log(
  '----------------------------'
);


printGroups(
  baselineByVariant
);


console.log('');

console.log(
  'SCRIPT93 BASELINE BY SUPER STATUS'
);

console.log(
  '---------------------------------'
);


printGroups(
  baselineBySuper
);


// ============================================================
// FIXED MODELS
// ============================================================

console.log('');

console.log(
  'PREDEFINED MODELS'
);

console.log(
  '-----------------'
);


for (
  const row
  of fixedResults
) {

  console.log(

    `${row.id.padEnd(40)} ` +

    `RMSE=${formatNumber(row.rmse).padStart(7)} ` +

    `MAE=${formatNumber(row.mae).padStart(7)} ` +

    `exact=${formatPercent(row.exactRate).padStart(8)} ` +

    `<=1=${formatPercent(row.within1Rate).padStart(8)} ` +

    `<=2=${formatPercent(row.within2Rate).padStart(8)} ` +

    `max=${String(row.maxAbsoluteResidual).padStart(3)}`
  );
}


// ============================================================
// CRITICAL COMPARISON
// ============================================================

console.log('');

console.log(
  'CRITICAL COMPARISONS'
);

console.log(
  '--------------------'
);


printComparison(
  'No modifiers',
  bestNoModifiers
);


printComparison(
  'Super only',
  bestSuperOnly
);


printComparison(
  'Comeback 25 only',
  bestComeback25Only
);


printComparison(
  'Comeback 26 only',
  bestComeback26Only
);


printComparison(
  'Super + comeback 25',
  bestCombined25
);


printComparison(
  'Super + comeback 26',
  bestCombined26
);


// ============================================================
// NORMAL TRAILING
// ============================================================

console.log('');

console.log(
  'NORMAL TRAILING TROOPERS'
);

console.log(
  '------------------------'
);


console.log(
  `Cases: ${normalTrailing.length}`
);


printComparison(
  'No comeback',
  normalTrailingNoComeback
);


printComparison(
  'Comeback 25%',
  normalTrailing25
);


printComparison(
  'Comeback 26%',
  normalTrailing26
);


// ============================================================
// SUPER TRAILING
// ============================================================

console.log('');

console.log(
  'SUPER TROOPER × COMEBACK'
);

console.log(
  '------------------------'
);


console.log(
  `Super trailing cases: ${superTrailing.length}`
);


printComparison(
  '25%, no Super discount',
  superTrailingNoSuper
);


printComparison(
  '0.85 × comeback 25%',
  superTrailing25
);


printComparison(
  '0.85 × comeback 26%',
  superTrailing26
);


// ============================================================
// GRID
// ============================================================

console.log('');

console.log(
  'EXPLORATORY 2D GRID'
);

console.log(
  '-------------------'
);


if (
  bestGrid
) {

  console.log(
    `Best Super factor:       ${formatNumber(bestGrid.superFactor)}`
  );


  console.log(
    `Documented candidate:    0.85`
  );


  console.log(
    `Best comeback maximum:   ${formatPercent(bestGrid.comebackMax)}`
  );


  console.log(
    `Documented candidates:   25% / 26%`
  );


  console.log(
    `Best rounding:           ${bestGrid.roundingRule}`
  );


  console.log(
    `RMSE:                    ${formatNumber(bestGrid.rmse)}`
  );


  console.log(
    `MAE:                     ${formatNumber(bestGrid.mae)}`
  );


  console.log(
    `Within 1:                ${formatPercent(bestGrid.within1Rate)}`
  );


  console.log(
    `Within 2:                ${formatPercent(bestGrid.within2Rate)}`
  );


  console.log(
    `Difference from 0.85:    ${formatNumber(bestGridSuperDifference)}`
  );


  console.log(
    `Difference from 25%:     ${formatPercent(bestGridComeback25Difference)}`
  );


  console.log(
    `Difference from 26%:     ${formatPercent(bestGridComeback26Difference)}`
  );
}


// ============================================================
// IMPROVEMENT
// ============================================================

console.log('');

console.log(
  'SCRIPT93 -> BEST PREDEFINED COMBINED MODEL'
);

console.log(
  '-----------------------------------------'
);


console.log(
  `Script93 baseline RMSE:       ${formatNumber(baselineRMSE)}`
);


console.log(
  `Best predefined RMSE:         ${formatNumber(combinedRMSE)}`
);


console.log(
  `Absolute improvement:         ${formatNumber(absoluteImprovement)}`
);


console.log(
  `Fractional improvement:       ${formatPercent(fractionalImprovement)}`
);


// ============================================================
// BEST MODEL RESIDUALS
// ============================================================

console.log('');

console.log(
  'BEST PREDEFINED RESIDUALS BY VARIANT'
);

console.log(
  '------------------------------------'
);


printGroups(
  bestByVariant
);


console.log('');

console.log(
  'BEST PREDEFINED RESIDUALS BY TEAM STATUS'
);

console.log(
  '----------------------------------------'
);


printGroups(
  bestByStatus
);


console.log('');

console.log(
  'BEST PREDEFINED RESIDUALS BY TEAM'
);

console.log(
  '---------------------------------'
);


printGroups(
  bestByTeam
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
  `Super cases present:                 ${superCasesPresent}`
);


console.log(
  `Super interaction improves:          ${superComebackInteractionImproves}`
);


console.log(
  `Normal trailing comeback improves:   ${normalTrailingComebackImproves}`
);


console.log(
  `Combined predefined model strong:    ${combinedModelStrong}`
);


console.log(
  `Grid near Super 0.85:                ${gridNearSuper085}`
);


console.log(
  `Grid near comeback 25-26%:           ${gridNearComebackDocumented}`
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
// VARIANT
// ============================================================

function classifyVariant(
  label
) {

  const upper =
    String(
      label ??
      'UNKNOWN'
    )
    .toUpperCase();


  return {

    isSuper:
      upper.includes(
        'SUPER'
      ),

    isRift:
      upper.includes(
        'RIFT'
      )
  };
}


// ============================================================
// MODEL
// ============================================================

function evaluateModel(
  rows,
  model,
  includeCases = true
) {

  const caseResults =
    [];


  for (
    const row
    of rows
  ) {

    const superFactor =
      model.applySuper
      &&
      row.isSuper
        ? model.superFactor
        : 1;


    const comebackBonus =
      row.creditedTeamStatus ===
        'TRAILING'
        ? model.comebackMax *
          row.comebackRamp
        : 0;


    const comebackFactor =
      1 +
      comebackBonus;


    const predictedRaw =
      row.ordinaryRawTotal *
      superFactor *
      comebackFactor;


    const predicted =
      model
        .rounding
        .fn(
          predictedRaw
        );


    const residual =
      row.teamTotal -
      predicted;


    caseResults.push({

      ...row,

      modelId:
        model.id,

      modelSuperApplied:
        Boolean(
          model.applySuper
        ),

      modelSuperFactor:
        model.superFactor,

      appliedSuperFactor:
        superFactor,

      modelComebackMax:
        model.comebackMax,

      appliedComebackBonus:
        comebackBonus,

      appliedComebackFactor:
        comebackFactor,

      predictedRaw,

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

    applySuper:
      model.applySuper,

    superFactor:
      model.superFactor,

    comebackMax:
      model.comebackMax,

    roundingRule:
      model.rounding.id,

    count:
      rows.length,

    rmse:
      rows.length >
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

    meanResidual:
      mean(
        residuals
      ),

    maxAbsoluteResidual:
      absolute.length >
        0
        ? Math.max(
          ...absolute
        )
        : null,

    exact,

    exactRate:
      rate(
        exact,
        rows.length
      ),

    within1,

    within1Rate:
      rate(
        within1,
        rows.length
      ),

    within2,

    within2Rate:
      rate(
        within2,
        rows.length
      ),

    within3,

    within3Rate:
      rate(
        within3,
        rows.length
      ),

    residualDistribution:
      summarizeNumbers(
        residuals
      ),

    caseResults:
      includeCases
        ? caseResults
        : []
  };
}


// ============================================================
// BEST ROUNDING
// ============================================================

function evaluateBestRounding(
  rows,
  config
) {

  if (
    rows.length ===
    0
  ) {

    return null;
  }


  const results =
    ROUNDING_RULES.map(
      rounding =>
        evaluateModel(
          rows,
          {

            id:
              `${config.idPrefix}__${rounding.id}`,

            applySuper:
              config.applySuper,

            superFactor:
              config.superFactor,

            comebackMax:
              config.comebackMax,

            rounding
          }
        )
    );


  results.sort(
    compareResults
  );


  return results[0]
  ??
  null;
}


// ============================================================
// BEST MATCHING MODEL
// ============================================================

function bestMatchingModel(
  results,
  predicate
) {

  return results
    .filter(
      predicate
    )
    .sort(
      compareResults
    )[0]
    ??
    null;
}


// ============================================================
// RESULT COMPARATOR
// ============================================================

function compareResults(
  a,
  b
) {

  const aRMSE =
    Number.isFinite(
      a?.rmse
    )
      ? a.rmse
      : Infinity;


  const bRMSE =
    Number.isFinite(
      b?.rmse
    )
      ? b.rmse
      : Infinity;


  return (
    aRMSE -
      bRMSE
    ||
    (
      a?.mae ??
      Infinity
    )
    -
    (
      b?.mae ??
      Infinity
    )
    ||
    (
      b?.within1Rate ??
      -Infinity
    )
    -
    (
      a?.within1Rate ??
      -Infinity
    )
  );
}


// ============================================================
// EXISTING SCRIPT93 GROUPS
// ============================================================

function summarizeExistingGroups(
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
      ) => {

        const residuals =
          groupRows
            .map(
              row =>
                row.script93Residual
            )
            .filter(
              Number.isFinite
            );


        const absolute =
          residuals.map(
            Math.abs
          );


        return {

          group,

          count:
            groupRows.length,

          trailing:
            groupRows.filter(
              row =>
                row.creditedTeamStatus ===
                'TRAILING'
            ).length,

          leading:
            groupRows.filter(
              row =>
                row.creditedTeamStatus ===
                'LEADING'
            ).length,

          observedFactor:
            summarizeNumbers(
              groupRows
                .map(
                  row =>
                    row.observedFactorVsOrdinaryRaw
                )
                .filter(
                  Number.isFinite
                )
            ),

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
// MODEL GROUPS
// ============================================================

function summarizeModelGroups(
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
      ) => {

        const residuals =
          groupRows.map(
            row =>
              row.residual
          );


        const absolute =
          residuals.map(
            Math.abs
          );


        return {

          group,

          count:
            groupRows.length,

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
// STRIP LARGE CASE ARRAYS
// ============================================================

function stripCases(
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

    applySuper:
      row.applySuper,

    superFactor:
      row.superFactor,

    comebackMax:
      row.comebackMax,

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
      row.residualDistribution
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
// CONSOLE
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
    .sort(
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
  ) {

    console.log(
      `  ${key.padEnd(30)} ${value}`
    );
  }
}


function printGroups(
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


    if (
      Number.isFinite(
        row.trailing
      )
    ) {

      console.log(
        `  trailing=${row.trailing} leading=${row.leading}`
      );
    }


    if (
      row.observedFactor
    ) {

      console.log(
        `  observed factor: ${formatDistribution(row.observedFactor)}`
      );
    }


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


    if (
      row.within2Rate !==
      undefined
    ) {

      console.log(
        `  <=2:      ${formatPercent(row.within2Rate)}`
      );
    }
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
      `${label.padEnd(27)} n/a`
    );

    return;
  }


  console.log(

    `${label.padEnd(27)} ` +

    `n=${String(row.count).padStart(3)} ` +

    `RMSE=${formatNumber(row.rmse).padStart(7)} ` +

    `MAE=${formatNumber(row.mae).padStart(7)} ` +

    `exact=${formatPercent(row.exactRate).padStart(8)} ` +

    `<=1=${formatPercent(row.within1Rate).padStart(8)} ` +

    `<=2=${formatPercent(row.within2Rate).padStart(8)} ` +

    `${row.roundingRule}`
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