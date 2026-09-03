import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
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


const HU_PER_METER =
  39.37;


const PRIMARY_CANDIDATE_HU =
  735;


const STABLE_DELAY_SECONDS =
  1.0;


const EARLY_DELAY_SECONDS =
  1.0;


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const SEARCH_MIN_HU =
  650;


const SEARCH_MAX_HU =
  850;


const SEARCH_STEP_HU =
  1;


const STANDARD_THRESHOLDS = [
  700,
  720,
  725,
  729,
  730,
  731,
  732,
  735,
  740,
  750,
  768,
  775,
  782,
  800
];


// ============================================================
// PURPOSE
//
// Script 77 measured target player -> CURRENT AssignedGold
// entity position at m_hVacuumTarget onset.
//
// Script 79 identified one early outlier:
//
//   current soul distance = 776.458 HU
//   soul displacement from activation = 47.732 HU
//
// That suggests the proximity condition may use a more stable
// anchor:
//
//   A. current AssignedGold entity position
//   B. AssignedGold activation position
//   C. Trooper death position
//
// Script 80 compares those three geometries.
//
// No anchor is promoted to an engine mechanic merely because it
// produces the tightest empirical envelope.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const script75EpisodesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const script77SummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_exact_geometry_validation_v01.json'
  );


const script77CasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_exact_geometry_cases_v01.jsonl'
  );


const script79SummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_early_vacuum_outlier_diagnostic_v01.json'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_anchor_geometry_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_anchor_geometry_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    script75EpisodesPath,
    script77SummaryPath,
    script77CasesPath,
    script79SummaryPath
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

const script77Summary =
  JSON.parse(
    readFileSync(
      script77SummaryPath,
      'utf8'
    )
  );


const script79Summary =
  JSON.parse(
    readFileSync(
      script79SummaryPath,
      'utf8'
    )
  );


if (
  script77Summary
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 77 did not PASS.'
  );
}


if (
  script79Summary
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 79 did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 75 EPISODES
// ============================================================

console.log('');

console.log(
  'Loading Script 75 lifecycle episodes...'
);


const episodes75 =
  await loadJsonl(
    script75EpisodesPath
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
// LOAD SCRIPT 77 CASES
// ============================================================

console.log(
  'Loading Script 77 exact-geometry cases...'
);


const rawCases77 =
  await loadJsonl(
    script77CasesPath
  );


console.log(
  `Script 77 cases: ${rawCases77.length}`
);


// ============================================================
// JOIN / BUILD CASES
// ============================================================

const cases =
  [];


for (
  const row
  of rawCases77
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const episode75 =
    episode75ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  if (
    !episode75
  ) {

    continue;
  }


  const targetPosition =
    normalizePosition(
      row?.rawOnsetTargetPosition
    );


  const currentSoulPosition =
    normalizePosition(
      row?.rawOnsetSoulPosition
    );


  const activationPosition =
    normalizePosition(
      episode75
        ?.assignedGold
        ?.activationPosition
    );


  const deathPosition =
    normalizePosition(
      episode75
        ?.death
        ?.position
    );


  const currentXY =
    targetPosition
    &&
    currentSoulPosition
      ? distanceXY(
        targetPosition,
        currentSoulPosition
      )
      : null;


  const activationXY =
    targetPosition
    &&
    activationPosition
      ? distanceXY(
        targetPosition,
        activationPosition
      )
      : null;


  const deathXY =
    targetPosition
    &&
    deathPosition
      ? distanceXY(
        targetPosition,
        deathPosition
      )
      : null;


  const current3D =
    targetPosition
    &&
    currentSoulPosition
      ? distance3D(
        targetPosition,
        currentSoulPosition
      )
      : null;


  const activation3D =
    targetPosition
    &&
    activationPosition
      ? distance3D(
        targetPosition,
        activationPosition
      )
      : null;


  const death3D =
    targetPosition
    &&
    deathPosition
      ? distance3D(
        targetPosition,
        deathPosition
      )
      : null;


  const soulDisplacementXY =
    activationPosition
    &&
    currentSoulPosition
      ? distanceXY(
        activationPosition,
        currentSoulPosition
      )
      : null;


  const soulDisplacement3D =
    activationPosition
    &&
    currentSoulPosition
      ? distance3D(
        activationPosition,
        currentSoulPosition
      )
      : null;


  const deathToActivationXY =
    deathPosition
    &&
    activationPosition
      ? distanceXY(
        deathPosition,
        activationPosition
      )
      : null;


  const deathToActivation3D =
    deathPosition
    &&
    activationPosition
      ? distance3D(
        deathPosition,
        activationPosition
      )
      : null;


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      row?.clock ??
      null,

    baseType:
      row?.baseType ??
      null,

    creditedPlayerName:
      row?.creditedPlayerName ??
      null,

    targetPlayerName:
      row?.targetPlayerName ??
      null,

    targetDelaySeconds:
      finite(
        row?.targetDelaySeconds
      ),

    activationTick:
      finite(
        row?.activationTick
      ),

    onsetTick:
      finite(
        row?.onsetTick
      ),

    targetPosition,

    currentSoulPosition,

    activationPosition,

    deathPosition,

    distances: {

      currentSoul: {

        xy:
          currentXY,

        d3:
          current3D
      },

      activationAnchor: {

        xy:
          activationXY,

        d3:
          activation3D
      },

      deathAnchor: {

        xy:
          deathXY,

        d3:
          death3D
      }
    },

    geometryDifferences: {

      currentMinusActivationXY:
        difference(
          currentXY,
          activationXY
        ),

      currentMinusDeathXY:
        difference(
          currentXY,
          deathXY
        ),

      activationMinusDeathXY:
        difference(
          activationXY,
          deathXY
        ),

      currentMinusActivation3D:
        difference(
          current3D,
          activation3D
        ),

      currentMinusDeath3D:
        difference(
          current3D,
          death3D
        )
    },

    soulMotion: {

      activationToOnsetXY:
        soulDisplacementXY,

      activationToOnset3D:
        soulDisplacement3D,

      deathToActivationXY,

      deathToActivation3D
    },

    candidate735: {

      currentSoulInside:
        inside(
          currentXY,
          PRIMARY_CANDIDATE_HU
        ),

      activationAnchorInside:
        inside(
          activationXY,
          PRIMARY_CANDIDATE_HU
        ),

      deathAnchorInside:
        inside(
          deathXY,
          PRIMARY_CANDIDATE_HU
        )
    }
  });
}


console.log(
  `Joined cases: ${cases.length}`
);


// ============================================================
// COHORTS
// ============================================================

const stable =
  cases.filter(
    row =>
      Number.isFinite(
        row.targetDelaySeconds
      )
      &&
      row.targetDelaySeconds >=
      STABLE_DELAY_SECONDS
  );


const early =
  cases.filter(
    row =>
      Number.isFinite(
        row.targetDelaySeconds
      )
      &&
      row.targetDelaySeconds <
      EARLY_DELAY_SECONDS
  );


const earliest =
  cases.filter(
    row =>
      Number.isFinite(
        row.targetDelaySeconds
      )
      &&
      row.targetDelaySeconds <=
      0.50
  );


// ============================================================
// MODEL DEFINITIONS
// ============================================================

const models =
  [

    {

      name:
        'CURRENT_SOUL_XY',

      selector:
        row =>
          row
            ?.distances
            ?.currentSoul
            ?.xy
    },


    {

      name:
        'ACTIVATION_ANCHOR_XY',

      selector:
        row =>
          row
            ?.distances
            ?.activationAnchor
            ?.xy
    },


    {

      name:
        'DEATH_ANCHOR_XY',

      selector:
        row =>
          row
            ?.distances
            ?.deathAnchor
            ?.xy
    },


    {

      name:
        'CURRENT_SOUL_3D',

      selector:
        row =>
          row
            ?.distances
            ?.currentSoul
            ?.d3
    },


    {

      name:
        'ACTIVATION_ANCHOR_3D',

      selector:
        row =>
          row
            ?.distances
            ?.activationAnchor
            ?.d3
    },


    {

      name:
        'DEATH_ANCHOR_3D',

      selector:
        row =>
          row
            ?.distances
            ?.deathAnchor
            ?.d3
    }
  ];


// ============================================================
// MODEL SUMMARIES
// ============================================================

const modelSummaries =
  {};


for (
  const model
  of models
) {

  modelSummaries[
    model.name
  ] =
    {

      all:
        summarizeModel(
          cases,
          model.selector
        ),

      earlyUnder1Second:
        summarizeModel(
          early,
          model.selector
        ),

      stableAtLeast1Second:
        summarizeModel(
          stable,
          model.selector
        ),

      earliestAtMostPoint5Seconds:
        summarizeModel(
          earliest,
          model.selector
        )
    };
}


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const thresholdSearch =
  {};


for (
  const model
  of models
) {

  const source =
    values(
      cases,
      model.selector
    );


  const rows =
    [];


  for (
    let thresholdHU =
      SEARCH_MIN_HU;

    thresholdHU <=
      SEARCH_MAX_HU;

    thresholdHU +=
      SEARCH_STEP_HU
  ) {

    const contained =
      source.filter(
        value =>
          value <=
          thresholdHU
      ).length;


    rows.push({

      thresholdHU,

      thresholdMeters:
        thresholdHU /
        HU_PER_METER,

      contained,

      total:
        source.length,

      rate:
        rate(
          contained,
          source.length
        )
    });
  }


  thresholdSearch[
    model.name
  ] =
    {

      minimum95:
        minimumThresholdForCoverage(
          source,
          0.95
        ),

      minimum99:
        minimumThresholdForCoverage(
          source,
          0.99
        ),

      minimum100:
        minimumThresholdForCoverage(
          source,
          1.00
        ),

      standard:
        STANDARD_THRESHOLDS
          .map(
            threshold =>
              rows.find(
                row =>
                  row.thresholdHU ===
                  threshold
              )
          )
          .filter(
            Boolean
          ),

      all:
        rows
    };
}


// ============================================================
// 735-HU FAILURE SETS
// ============================================================

const currentSoulOver735 =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.distances
          ?.currentSoul
          ?.xy
      )
      &&
      row
        .distances
        .currentSoul
        .xy >
      PRIMARY_CANDIDATE_HU
  );


const activationAnchorOver735 =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.distances
          ?.activationAnchor
          ?.xy
      )
      &&
      row
        .distances
        .activationAnchor
        .xy >
      PRIMARY_CANDIDATE_HU
  );


const deathAnchorOver735 =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.distances
          ?.deathAnchor
          ?.xy
      )
      &&
      row
        .distances
        .deathAnchor
        .xy >
      PRIMARY_CANDIDATE_HU
  );


// ============================================================
// CASES FIXED BY ANCHORS
// ============================================================

const currentFailActivationPass =
  cases.filter(
    row =>
      row
        ?.candidate735
        ?.currentSoulInside ===
      false
      &&
      row
        ?.candidate735
        ?.activationAnchorInside ===
      true
  );


const currentFailDeathPass =
  cases.filter(
    row =>
      row
        ?.candidate735
        ?.currentSoulInside ===
      false
      &&
      row
        ?.candidate735
        ?.deathAnchorInside ===
      true
  );


// ============================================================
// PARTICULAR DEATH 5
// ============================================================

const death5 =
  cases.find(
    row =>
      row.deathIndex ===
      5
  )
  ??
  null;


// ============================================================
// SOUL MOTION DISTRIBUTIONS
// ============================================================

const soulMotionXY =
  values(
    cases,
    row =>
      row
        ?.soulMotion
        ?.activationToOnsetXY
  );


const earlySoulMotionXY =
  values(
    early,
    row =>
      row
        ?.soulMotion
        ?.activationToOnsetXY
  );


const stableSoulMotionXY =
  values(
    stable,
    row =>
      row
        ?.soulMotion
        ?.activationToOnsetXY
  );


const deathToActivationXY =
  values(
    cases,
    row =>
      row
        ?.soulMotion
        ?.deathToActivationXY
  );


// ============================================================
// GEOMETRY DIFFERENCE DISTRIBUTIONS
// ============================================================

const currentMinusActivationXY =
  values(
    cases,
    row =>
      row
        ?.geometryDifferences
        ?.currentMinusActivationXY
  );


const currentMinusDeathXY =
  values(
    cases,
    row =>
      row
        ?.geometryDifferences
        ?.currentMinusDeathXY
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedCases =
  finite(
    script77Summary
      ?.sourceCounts
      ?.cleanDelayedTransitions
  );


const validationChecks =
  {

    script77Passed:
      check(

        script77Summary
          ?.validation
          ?.pass,

        true,

        script77Summary
          ?.validation
          ?.pass ===
        true
      ),


    script79Passed:
      check(

        script79Summary
          ?.validation
          ?.pass,

        true,

        script79Summary
          ?.validation
          ?.pass ===
        true
      ),


    caseCount:
      check(

        cases.length,

        expectedCases,

        expectedCases ===
          null
          ? cases.length >
            0
          : cases.length ===
            expectedCases
      ),


    expectedTestCaseCount:
      check(

        cases.length,

        replayName ===
          'test'
          ? 458
          : '>0',

        replayName ===
          'test'
          ? cases.length ===
            458
          : cases.length >
            0
      ),


    script75JoinComplete:
      check(

        rawCases77.filter(
          row =>
            episode75ByDeathIndex.has(
              finite(
                row?.deathIndex
              )
            )
        ).length,

        rawCases77.length,

        rawCases77.every(
          row =>
            episode75ByDeathIndex.has(
              finite(
                row?.deathIndex
              )
            )
        )
      ),


    currentXYCoverage:
      check(

        values(
          cases,
          row =>
            row
              ?.distances
              ?.currentSoul
              ?.xy
        ).length,

        cases.length,

        values(
          cases,
          row =>
            row
              ?.distances
              ?.currentSoul
              ?.xy
        ).length ===
        cases.length
      ),


    activationAnchorXYCoverage:
      check(

        values(
          cases,
          row =>
            row
              ?.distances
              ?.activationAnchor
              ?.xy
        ).length,

        cases.length,

        values(
          cases,
          row =>
            row
              ?.distances
              ?.activationAnchor
              ?.xy
        ).length ===
        cases.length
      ),


    deathAnchorXYCoverage:
      check(

        values(
          cases,
          row =>
            row
              ?.distances
              ?.deathAnchor
              ?.xy
        ).length,

        cases.length,

        values(
          cases,
          row =>
            row
              ?.distances
              ?.deathAnchor
              ?.xy
        ).length ===
        cases.length
      ),


    stableCount:
      check(

        stable.length,

        replayName ===
          'test'
          ? 131
          : '>0',

        replayName ===
          'test'
          ? stable.length ===
            131
          : stable.length >
            0
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
// SUMMARY OUTPUT
// ============================================================

const summary =
  {

    replay:
      replayName,

    version:
      'ASSIGNED_GOLD_VACUUM_ANCHOR_GEOMETRY_VALIDATION_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'VACUUM_ANCHOR_GEOMETRY_COMPARISON_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Compare current AssignedGold position, AssignedGold activation anchor, and Trooper death anchor as candidate geometries for vacuum-target proximity.',

        'Test whether the lone >735 HU current-entity outlier is explained by initial AssignedGold movement away from its activation/death anchor.',

        'Compare geometry separately for early and stable delayed target acquisition.'
      ],


    semanticLimits:
      {

        activationAnchor:
          'Script 75 activation position is the reconstructed initial AssignedGold activation position and is not automatically the engine proximity-test origin.',

        deathAnchor:
          'Trooper death position is an observed source position and is not automatically the ground-soul collision/proximity origin.',

        threshold:
          'A tighter anchor-relative envelope is evidence favoring that geometry, not proof of an exact engine radius.'
      },


    cohorts:
      {

        all:
          cases.length,

        earlyUnder1Second:
          early.length,

        earliestAtMostPoint5Seconds:
          earliest.length,

        stableAtLeast1Second:
          stable.length
      },


    modelSummaries,


    thresholdSearch,


    candidate735Comparison:
      {

        currentSoulOver735:
          currentSoulOver735.length,

        activationAnchorOver735:
          activationAnchorOver735.length,

        deathAnchorOver735:
          deathAnchorOver735.length,

        currentFailButActivationPass:
          currentFailActivationPass.length,

        currentFailButDeathPass:
          currentFailDeathPass.length,

        currentFailActivationPassCases:
          currentFailActivationPass.map(
            compactCase
          ),

        currentFailDeathPassCases:
          currentFailDeathPass.map(
            compactCase
          )
      },


    death5:
      death5
        ? compactCase(
          death5
        )
        : null,


    soulMotion:
      {

        activationToOnsetXYAll:
          summarizeNumbers(
            soulMotionXY
          ),

        activationToOnsetXYEarly:
          summarizeNumbers(
            earlySoulMotionXY
          ),

        activationToOnsetXYStable:
          summarizeNumbers(
            stableSoulMotionXY
          ),

        deathToActivationXY:
          summarizeNumbers(
            deathToActivationXY
          )
      },


    geometryDifferences:
      {

        currentMinusActivationXY:
          summarizeNumbers(
            currentMinusActivationXY
          ),

        currentMinusDeathXY:
          summarizeNumbers(
            currentMinusDeathXY
          )
      },


    interpretationGuide:
      {

        activationAnchorSupport:
          'If current-soul >735 failures become activation-anchor <=735 cases, initial AssignedGold movement is likely contaminating current-entity distance as a proximity proxy.',

        deathAnchorSupport:
          'If death-position geometry is tighter still, the proximity system may be anchored to source/death location or both death and activation positions may approximate a hidden ground-soul origin.',

        noAnchorImprovement:
          'If death 5 remains >735 under every anchor model, the outlier cannot be explained by initial soul displacement alone and should remain an unresolved early-lifecycle exception.',

        stableResult:
          'Regardless of the early outlier, the >=1-second stable floor cohort already supports a <=735 HU XY current-entity target-onset envelope in this replay.'
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
  'ASSIGNED GOLD VACUUM ANCHOR GEOMETRY V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'COHORTS'
);

console.log(
  '-------'
);


console.log(
  `All delayed:        ${cases.length}`
);


console.log(
  `Early <1s:          ${early.length}`
);


console.log(
  `Earliest <=0.5s:    ${earliest.length}`
);


console.log(
  `Stable >=1s:        ${stable.length}`
);


// ============================================================
// MODEL CONSOLE
// ============================================================

console.log('');

console.log(
  'XY MODEL COMPARISON — ALL 458'
);

console.log(
  '-----------------------------'
);


for (
  const name
  of [
    'CURRENT_SOUL_XY',
    'ACTIVATION_ANCHOR_XY',
    'DEATH_ANCHOR_XY'
  ]
) {

  const row =
    modelSummaries[
      name
    ]
    .all;


  console.log(

    `${name.padEnd(24)} ` +

    `${formatDistribution(row.distribution)} ` +

    `<=735=${row.inside735}/${row.count} ` +

    `${formatPercent(row.inside735Rate)}`
  );
}


console.log('');

console.log(
  'XY MODEL COMPARISON — EARLY <1S'
);

console.log(
  '-----------------------------'
);


for (
  const name
  of [
    'CURRENT_SOUL_XY',
    'ACTIVATION_ANCHOR_XY',
    'DEATH_ANCHOR_XY'
  ]
) {

  const row =
    modelSummaries[
      name
    ]
    .earlyUnder1Second;


  console.log(

    `${name.padEnd(24)} ` +

    `${formatDistribution(row.distribution)} ` +

    `<=735=${row.inside735}/${row.count} ` +

    `${formatPercent(row.inside735Rate)}`
  );
}


console.log('');

console.log(
  'XY MODEL COMPARISON — STABLE >=1S'
);

console.log(
  '---------------------------------'
);


for (
  const name
  of [
    'CURRENT_SOUL_XY',
    'ACTIVATION_ANCHOR_XY',
    'DEATH_ANCHOR_XY'
  ]
) {

  const row =
    modelSummaries[
      name
    ]
    .stableAtLeast1Second;


  console.log(

    `${name.padEnd(24)} ` +

    `${formatDistribution(row.distribution)} ` +

    `<=735=${row.inside735}/${row.count} ` +

    `${formatPercent(row.inside735Rate)}`
  );
}


console.log('');

console.log(
  '735-HU FAILURE COMPARISON'
);

console.log(
  '-------------------------'
);


console.log(
  `Current soul >735:       ${currentSoulOver735.length}`
);


console.log(
  `Activation anchor >735:  ${activationAnchorOver735.length}`
);


console.log(
  `Death anchor >735:       ${deathAnchorOver735.length}`
);


console.log(
  `Current fails, activation passes: ${currentFailActivationPass.length}`
);


console.log(
  `Current fails, death passes:      ${currentFailDeathPass.length}`
);


// ============================================================
// DEATH 5
// ============================================================

console.log('');

console.log(
  'DEATH 5 OUTLIER'
);

console.log(
  '---------------'
);


if (
  !death5
) {

  console.log(
    'Death 5 not found.'
  );

} else {

  console.log(
    `delay: ${formatNumber(death5.targetDelaySeconds)}s`
  );


  console.log(
    `current soul XY:      ${formatNumber(death5.distances.currentSoul.xy)} HU`
  );


  console.log(
    `activation anchor XY: ${formatNumber(death5.distances.activationAnchor.xy)} HU`
  );


  console.log(
    `death anchor XY:      ${formatNumber(death5.distances.deathAnchor.xy)} HU`
  );


  console.log(
    `soul moved from activation: ${formatNumber(death5.soulMotion.activationToOnsetXY)} HU`
  );


  console.log(
    `death -> activation anchor:  ${formatNumber(death5.soulMotion.deathToActivationXY)} HU`
  );


  console.log(
    `current<=735:    ${death5.candidate735.currentSoulInside}`
  );


  console.log(
    `activation<=735: ${death5.candidate735.activationAnchorInside}`
  );


  console.log(
    `death<=735:      ${death5.candidate735.deathAnchorInside}`
  );
}


// ============================================================
// SOUL MOTION
// ============================================================

console.log('');

console.log(
  'SOUL ACTIVATION -> TARGET-ONSET MOTION'
);

console.log(
  '--------------------------------------'
);


console.log(
  `All:    ${formatDistribution(summarizeNumbers(soulMotionXY))}`
);


console.log(
  `Early:  ${formatDistribution(summarizeNumbers(earlySoulMotionXY))}`
);


console.log(
  `Stable: ${formatDistribution(summarizeNumbers(stableSoulMotionXY))}`
);


// ============================================================
// MINIMUM 100% ENVELOPES
// ============================================================

console.log('');

console.log(
  'MINIMUM 100% CONTAINMENT — ALL CASES'
);

console.log(
  '------------------------------------'
);


for (
  const name
  of [
    'CURRENT_SOUL_XY',
    'ACTIVATION_ANCHOR_XY',
    'DEATH_ANCHOR_XY'
  ]
) {

  const row =
    thresholdSearch[
      name
    ]
    .minimum100;


  console.log(

    `${name.padEnd(24)} ` +

    `${formatThreshold(row)}`
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

    `${name.padEnd(36)} ` +

    `actual=${JSON.stringify(row.actual)} ` +

    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');

console.log(

  `OVERALL PIPELINE: ` +

  `${validationPass ? 'PASS' : 'FAIL'}`
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
// MODEL SUMMARY
// ============================================================

function summarizeModel(
  source,
  selector
) {

  const sourceValues =
    values(
      source,
      selector
    );


  const inside735 =
    sourceValues.filter(
      value =>
        value <=
        PRIMARY_CANDIDATE_HU
    ).length;


  return {

    count:
      sourceValues.length,

    distribution:
      summarizeNumbers(
        sourceValues
      ),

    inside735,

    inside735Rate:
      rate(
        inside735,
        sourceValues.length
      ),

    over735:
      sourceValues.length -
      inside735
  };
}


// ============================================================
// MINIMUM THRESHOLD
// ============================================================

function minimumThresholdForCoverage(
  source,
  coverage
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

    return null;
  }


  const index =
    Math.max(
      0,
      Math.ceil(
        clean.length *
        coverage
      )
      -
      1
    );


  const thresholdHU =
    clean[
      index
    ];


  return {

    coverage,

    thresholdHU,

    thresholdMeters:
      thresholdHU /
      HU_PER_METER,

    supported:
      index +
      1,

    total:
      clean.length
  };
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

    creditedPlayerName:
      row.creditedPlayerName,

    targetPlayerName:
      row.targetPlayerName,

    targetDelaySeconds:
      row.targetDelaySeconds,

    currentSoulXY:
      row
        ?.distances
        ?.currentSoul
        ?.xy ??
      null,

    activationAnchorXY:
      row
        ?.distances
        ?.activationAnchor
        ?.xy ??
      null,

    deathAnchorXY:
      row
        ?.distances
        ?.deathAnchor
        ?.xy ??
      null,

    currentSoul3D:
      row
        ?.distances
        ?.currentSoul
        ?.d3 ??
      null,

    activationAnchor3D:
      row
        ?.distances
        ?.activationAnchor
        ?.d3 ??
      null,

    deathAnchor3D:
      row
        ?.distances
        ?.deathAnchor
        ?.d3 ??
      null,

    currentMinusActivationXY:
      row
        ?.geometryDifferences
        ?.currentMinusActivationXY ??
      null,

    currentMinusDeathXY:
      row
        ?.geometryDifferences
        ?.currentMinusDeathXY ??
      null,

    soulActivationToOnsetXY:
      row
        ?.soulMotion
        ?.activationToOnsetXY ??
      null,

    deathToActivationXY:
      row
        ?.soulMotion
        ?.deathToActivationXY ??
      null,

    currentSoulInside735:
      row
        ?.candidate735
        ?.currentSoulInside ??
      null,

    activationAnchorInside735:
      row
        ?.candidate735
        ?.activationAnchorInside ??
      null,

    deathAnchorInside735:
      row
        ?.candidate735
        ?.deathAnchorInside ??
      null
  };
}


// ============================================================
// POSITIONS
// ============================================================

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
      value[2],
      0
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
    dx *
      dx
    +
    dy *
      dy
  );
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
    dx *
      dx
    +
    dy *
      dy
    +
    dz *
      dz
  );
}


// ============================================================
// GENERIC
// ============================================================

function inside(
  value,
  threshold
) {

  return Number.isFinite(
    value
  )
    ? value <=
      threshold
    : null;
}


function difference(
  a,
  b
) {

  return Number.isFinite(
    a
  )
  &&
  Number.isFinite(
    b
  )
    ? a -
      b
    : null;
}


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


function values(
  rows,
  selector
) {

  return rows
    .map(
      row =>
        finite(
          selector(
            row
          )
        )
    )
    .filter(
      Number.isFinite
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
        3
      )
    ).toString()
    : 'n/a';
}


function formatMeters(
  hu
) {

  return Number.isFinite(
    hu
  )
    ? (
      hu /
      HU_PER_METER
    ).toFixed(
      2
    )
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


function formatThreshold(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (

    `${formatNumber(row.thresholdHU)} HU ` +

    `(${formatMeters(row.thresholdHU)}m) ` +

    `${row.supported}/${row.total}`
  );
}