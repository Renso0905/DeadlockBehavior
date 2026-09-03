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


const HU_PER_METER =
  39.37;


const STABLE_FLOOR_CANDIDATE_HU =
  735;


const FORTY_FIVE_M_HU =
  45 *
  HU_PER_METER;


const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// PURPOSE
//
// Scripts 77-80 established:
//
//   stable delayed floor souls
//   -> current soul geometry
//   -> <= ~735 HU XY at m_hVacuumTarget assignment
//
// One early case, death 5, remains >735 HU at target onset.
//
// Script 80 compared the ONSET-TIME player position to:
//   - current soul
//   - activation anchor
//   - death anchor
//
// That does not answer whether the player was already in range
// earlier and then moved outward before m_hVacuumTarget became
// visible.
//
// Script 81 therefore measures the eventual target player at:
//
//   1. Trooper death tick
//   2. AssignedGold activation tick
//   3. m_hVacuumTarget onset tick
//
// This also tests whether initial/immediate vacuum and delayed
// floor pickup may use different proximity conditions.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const episodes76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );


const summary79Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_early_vacuum_outlier_diagnostic_v01.json'
  );


const summary80Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_anchor_geometry_validation_v01.json'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_temporal_geometry_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_temporal_geometry_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    episodes75Path,
    episodes76Path,
    summary79Path,
    summary80Path
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
// LOAD PRIOR SUMMARIES
// ============================================================

const summary79 =
  JSON.parse(
    readFileSync(
      summary79Path,
      'utf8'
    )
  );


const summary80 =
  JSON.parse(
    readFileSync(
      summary80Path,
      'utf8'
    )
  );


if (
  summary79
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 79 did not PASS.'
  );
}


if (
  summary80
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 80 did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 75
// ============================================================

console.log('');

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
// LOAD SCRIPT 76
// ============================================================

console.log(
  'Loading Script 76 lifecycle episodes...'
);


const episodes76 =
  await loadJsonl(
    episodes76Path
  );


console.log(
  `Script 76 episodes: ${episodes76.length}`
);


// ============================================================
// CLEAN TARGET-TRANSITION COHORT
// ============================================================

const cases =
  [];


for (
  const row
  of episodes76
) {

  if (
    row
      ?.creditedPlayer
      ?.quality !==
    'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'
  ) {

    continue;
  }


  if (
    row
      ?.vacuum
      ?.targetOnsetType !==
    'NULL_TO_PLAYER_TARGET_TRANSITION'
  ) {

    continue;
  }


  const deathIndex =
    finite(
      row?.deathIndex
    );


  const source =
    deathIndex ===
      null
      ? null
      : episode75ByDeathIndex.get(
        deathIndex
      )
      ??
      null;


  if (
    !source
  ) {

    continue;
  }


  const deathTick =
    firstFinite([
      source
        ?.death
        ?.tick,

      source
        ?.death
        ?.deathTick,

      source
        ?.death
        ?.timing
        ?.tick
    ]);


  const activationTick =
    firstFinite([
      row
        ?.assignedGold
        ?.activationTick,

      source
        ?.assignedGold
        ?.activationTick
    ]);


  const onsetTick =
    finite(
      row
        ?.vacuum
        ?.targetOnsetTick
    );


  const targetPawnEntityIndex =
    finite(
      row
        ?.vacuum
        ?.targetPawnEntityIndex
    );


  const soulEntityIndex =
    firstFinite([
      row
        ?.assignedGold
        ?.entityIndex,

      source
        ?.assignedGold
        ?.entityIndex
    ]);


  if (
    deathIndex ===
      null
    ||
    deathTick ===
      null
    ||
    activationTick ===
      null
    ||
    onsetTick ===
      null
    ||
    targetPawnEntityIndex ===
      null
    ||
    soulEntityIndex ===
      null
  ) {

    continue;
  }


  cases.push({

    caseIndex:
      cases.length,

    deathIndex,

    clock:
      row?.clock ??
      null,

    baseType:
      row?.baseType ??
      null,

    creditedPlayerName:
      row
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedPlayerTeam:
      finite(
        row
          ?.creditedPlayer
          ?.team
      ),

    creditedPlayerDistanceAtDeath3D:
      finite(
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
      ),

    targetPlayerName:
      row
        ?.vacuum
        ?.targetPlayerName ??
      null,

    targetPlayerTeam:
      finite(
        row
          ?.vacuum
          ?.targetPlayerTeam
      ),

    targetPawnEntityIndex,

    soulEntityIndex,

    targetDelaySeconds:
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      ),

    deathTick,

    activationTick,

    onsetTick,

    deathAnchorPosition:
      normalizePosition(
        source
          ?.death
          ?.position
      ),

    reconstructedActivationPosition:
      normalizePosition(
        source
          ?.assignedGold
          ?.activationPosition
      ),

    captures: {

      death:
        [],

      activation:
        [],

      onset:
        []
    },

    selected: {

      death:
        null,

      activation:
        null,

      onset:
        null
    }
  });
}


console.log(
  `Clean target-transition cases: ${cases.length}`
);


// ============================================================
// REQUEST TICKS
// ============================================================

const needsByTick =
  new Map();


for (
  const row
  of cases
) {

  addNeed(
    row.deathTick,
    row.caseIndex,
    'death'
  );


  addNeed(
    row.activationTick,
    row.caseIndex,
    'activation'
  );


  addNeed(
    row.onsetTick,
    row.caseIndex,
    'onset'
  );
}


function addNeed(
  tick,
  caseIndex,
  phase
) {

  if (
    !needsByTick.has(
      tick
    )
  ) {

    needsByTick.set(
      tick,
      []
    );
  }


  needsByTick
    .get(
      tick
    )
    .push({

      caseIndex,

      phase
    });
}


console.log(
  `Requested unique ticks: ${needsByTick.size}`
);


// ============================================================
// RAW REPLAY RESCAN
//
// We keep every packet capture for duplicate replay ticks.
//
// At onset:
//   prefer capture containing expected target.
//
// At activation:
//   prefer a capture with null target.
//
// This avoids repeating Script 78's duplicate-packet ambiguity.
// ============================================================

console.log('');

console.log(
  'Rescanning exact target-player geometry at death / activation / onset...'
);

console.log('');


const uniqueRequestedTicksSeen =
  new Set();


let requestedPacketHits =
  0;


let captureRows =
  0;


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


    const needs =
      needsByTick.get(
        tick
      );


    if (
      !needs
    ) {

      return;
    }


    requestedPacketHits++;


    uniqueRequestedTicksSeen.add(
      tick
    );


    const demo =
      parser.getDemo();


    const pawns =
      demo.getEntitiesByClassName(
        'CCitadelPlayerPawn'
      )
      ??
      [];


    const souls =
      demo.getEntitiesByClassName(
        'CCitadel_Pickup_AssignedGold'
      )
      ??
      [];


    const pawnByIndex =
      new Map();


    for (
      const entity
      of pawns
    ) {

      const index =
        getEntityIndex(
          entity
        );


      if (
        index !==
        null
      ) {

        pawnByIndex.set(
          index,
          entity
        );
      }
    }


    const soulByIndex =
      new Map();


    for (
      const entity
      of souls
    ) {

      const index =
        getEntityIndex(
          entity
        );


      if (
        index !==
        null
      ) {

        soulByIndex.set(
          index,
          entity
        );
      }
    }


    for (
      const need
      of needs
    ) {

      const row =
        cases[
          need.caseIndex
        ];


      const pawn =
        pawnByIndex.get(
          row.targetPawnEntityIndex
        )
        ??
        null;


      const soul =
        soulByIndex.get(
          row.soulEntityIndex
        )
        ??
        null;


      const targetPosition =
        pawn
          ? getWorldPositionDetailed(
            pawn
          )
          : null;


      const soulPosition =
        soul
          ? getWorldPositionDetailed(
            soul
          )
          : null;


      const rawTargetHandle =
        soul
          ? handleOrNull(
            safeGetField(
              soul,
              'm_hVacuumTarget'
            )
          )
          : null;


      const rawTargetPawnEntityIndex =
        decodeHandleEntityIndex(
          rawTargetHandle
        );


      row
        .captures[
          need.phase
        ]
        .push({

          tick,

          targetPosition,

          soulPosition,

          rawTargetHandle,

          rawTargetPawnEntityIndex,

          soulActive:
            soul
              ? booleanOrNull(
                safeGetField(
                  soul,
                  'm_bActive'
                )
              )
              : null,

          soulInteractive:
            soul
              ? booleanOrNull(
                safeGetField(
                  soul,
                  'm_bInteractive'
                )
              )
              : null
        });


      captureRows++;
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
// SELECT DUPLICATE-TICK CAPTURES
// ============================================================

for (
  const row
  of cases
) {

  row.selected.death =
    selectCapture(
      row.captures.death,
      'death',
      row
    );


  row.selected.activation =
    selectCapture(
      row.captures.activation,
      'activation',
      row
    );


  row.selected.onset =
    selectCapture(
      row.captures.onset,
      'onset',
      row
    );


  const deathTarget =
    row
      .selected
      .death
      ?.targetPosition
    ??
    null;


  const activationTarget =
    row
      .selected
      .activation
      ?.targetPosition
    ??
    null;


  const onsetTarget =
    row
      .selected
      .onset
      ?.targetPosition
    ??
    null;


  const activationSoul =
    row
      .selected
      .activation
      ?.soulPosition
    ??
    null;


  const onsetSoul =
    row
      .selected
      .onset
      ?.soulPosition
    ??
    null;


  row.temporalGeometry =
    {

      targetAtDeathToDeathAnchorXY:
        distanceXYOrNull(
          deathTarget,
          row.deathAnchorPosition
        ),

      targetAtDeathToDeathAnchor3D:
        distance3DOrNull(
          deathTarget,
          row.deathAnchorPosition
        ),


      targetAtActivationToDeathAnchorXY:
        distanceXYOrNull(
          activationTarget,
          row.deathAnchorPosition
        ),

      targetAtActivationToDeathAnchor3D:
        distance3DOrNull(
          activationTarget,
          row.deathAnchorPosition
        ),


      targetAtActivationToSoulXY:
        distanceXYOrNull(
          activationTarget,
          activationSoul
        ),

      targetAtActivationToSoul3D:
        distance3DStrictOrNull(
          activationTarget,
          activationSoul
        ),


      targetAtOnsetToSoulXY:
        distanceXYOrNull(
          onsetTarget,
          onsetSoul
        ),

      targetAtOnsetToSoul3D:
        distance3DStrictOrNull(
          onsetTarget,
          onsetSoul
        )
    };


  const g =
    row.temporalGeometry;


  row.rangeStates =
    {

      deathAnchor735:
        inside(
          g.targetAtDeathToDeathAnchorXY,
          STABLE_FLOOR_CANDIDATE_HU
        ),

      activationSoul735:
        inside(
          g.targetAtActivationToSoulXY,
          STABLE_FLOOR_CANDIDATE_HU
        ),

      onsetSoul735:
        inside(
          g.targetAtOnsetToSoulXY,
          STABLE_FLOOR_CANDIDATE_HU
        ),


      deathAnchor45m:
        inside(
          g.targetAtDeathToDeathAnchorXY,
          FORTY_FIVE_M_HU
        ),

      activationSoul45m:
        inside(
          g.targetAtActivationToSoulXY,
          FORTY_FIVE_M_HU
        ),

      onsetSoul45m:
        inside(
          g.targetAtOnsetToSoulXY,
          FORTY_FIVE_M_HU
        )
    };


  row.temporalClass735 =
    classifyTemporal735(
      row.rangeStates
    );
}


// ============================================================
// COHORTS
// ============================================================

const cohorts =
  {

    ALL:
      cases,


    IMMEDIATE_LE_0_25:
      cases.filter(
        row =>
          Number.isFinite(
            row.targetDelaySeconds
          )
          &&
          row.targetDelaySeconds <=
          0.25
      ),


    EARLY_GT_0_25_LT_1:
      cases.filter(
        row =>
          Number.isFinite(
            row.targetDelaySeconds
          )
          &&
          row.targetDelaySeconds >
          0.25
          &&
          row.targetDelaySeconds <
          1.0
      ),


    STABLE_GE_1:
      cases.filter(
        row =>
          Number.isFinite(
            row.targetDelaySeconds
          )
          &&
          row.targetDelaySeconds >=
          1.0
      )
  };


// ============================================================
// METRICS
// ============================================================

const metricDefinitions =
  [

    [
      'TARGET_AT_DEATH_TO_DEATH_ANCHOR_XY',

      row =>
        row
          ?.temporalGeometry
          ?.targetAtDeathToDeathAnchorXY
    ],


    [
      'TARGET_AT_ACTIVATION_TO_DEATH_ANCHOR_XY',

      row =>
        row
          ?.temporalGeometry
          ?.targetAtActivationToDeathAnchorXY
    ],


    [
      'TARGET_AT_ACTIVATION_TO_SOUL_XY',

      row =>
        row
          ?.temporalGeometry
          ?.targetAtActivationToSoulXY
    ],


    [
      'TARGET_AT_ONSET_TO_SOUL_XY',

      row =>
        row
          ?.temporalGeometry
          ?.targetAtOnsetToSoulXY
    ]
  ];


// ============================================================
// COHORT SUMMARIES
// ============================================================

const cohortSummaries =
  {};


for (
  const [
    cohortName,
    cohortRows
  ]
  of Object.entries(
    cohorts
  )
) {

  const metrics =
    {};


  for (
    const [
      metricName,
      selector
    ]
    of metricDefinitions
  ) {

    const source =
      values(
        cohortRows,
        selector
      );


    const inside735 =
      source.filter(
        value =>
          value <=
          STABLE_FLOOR_CANDIDATE_HU
      ).length;


    const inside45m =
      source.filter(
        value =>
          value <=
          FORTY_FIVE_M_HU
      ).length;


    metrics[
      metricName
    ] =
      {

        distribution:
          summarizeNumbers(
            source
          ),

        inside735,

        inside735Rate:
          rate(
            inside735,
            source.length
          ),

        inside45m,

        inside45mRate:
          rate(
            inside45m,
            source.length
          ),

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
          )
      };
  }


  cohortSummaries[
    cohortName
  ] =
    {

      count:
        cohortRows.length,

      metrics,

      temporalClasses735:
        countBy(
          cohortRows,
          row =>
            row.temporalClass735
        )
    };
}


// ============================================================
// SPECIAL CASES
// ============================================================

const death5 =
  cases.find(
    row =>
      row.deathIndex ===
      5
  )
  ??
  null;


const onsetOver735 =
  cases.filter(
    row =>
      row
        ?.rangeStates
        ?.onsetSoul735 ===
      false
  );


const onsetOver735ButDeathInside735 =
  onsetOver735.filter(
    row =>
      row
        ?.rangeStates
        ?.deathAnchor735 ===
      true
  );


const onsetOver735ButActivationInside735 =
  onsetOver735.filter(
    row =>
      row
        ?.rangeStates
        ?.activationSoul735 ===
      true
  );


const activationOutToOnsetIn735 =
  cases.filter(
    row =>
      row
        ?.rangeStates
        ?.activationSoul735 ===
      false
      &&
      row
        ?.rangeStates
        ?.onsetSoul735 ===
      true
  );


const deathOutToActivationIn735 =
  cases.filter(
    row =>
      row
        ?.rangeStates
        ?.deathAnchor735 ===
      false
      &&
      row
        ?.rangeStates
        ?.activationSoul735 ===
      true
  );


// ============================================================
// CONTRACT / COVERAGE
// ============================================================

const onsetExpectedTarget =
  cases.filter(
    row =>
      row
        ?.selected
        ?.onset
        ?.rawTargetPawnEntityIndex ===
      row.targetPawnEntityIndex
  );


const activationNullTarget =
  cases.filter(
    row =>
      row
        ?.selected
        ?.activation
        ?.rawTargetPawnEntityIndex ===
      null
  );


const deathGeometryResolved =
  values(
    cases,
    row =>
      row
        ?.temporalGeometry
        ?.targetAtDeathToDeathAnchorXY
  ).length;


const activationGeometryResolved =
  values(
    cases,
    row =>
      row
        ?.temporalGeometry
        ?.targetAtActivationToSoulXY
  ).length;


const onsetGeometryResolved =
  values(
    cases,
    row =>
      row
        ?.temporalGeometry
        ?.targetAtOnsetToSoulXY
  ).length;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script79Passed:
      check(
        summary79
          ?.validation
          ?.pass,
        true,
        summary79
          ?.validation
          ?.pass ===
        true
      ),


    script80Passed:
      check(
        summary80
          ?.validation
          ?.pass,
        true,
        summary80
          ?.validation
          ?.pass ===
        true
      ),


    cleanTransitionCount:
      check(
        cases.length,
        replayName ===
          'test'
          ? 947
          : '>0',
        replayName ===
          'test'
          ? cases.length ===
            947
          : cases.length >
            0
      ),


    requestedUniqueTicksCovered:
      check(
        uniqueRequestedTicksSeen.size,
        needsByTick.size,
        uniqueRequestedTicksSeen.size ===
        needsByTick.size
      ),


    onsetExpectedTargetCoverage:
      check(
        onsetExpectedTarget.length,
        cases.length,
        rate(
          onsetExpectedTarget.length,
          cases.length
        ) >=
        0.99
      ),


    deathXYGeometryCoverage:
      check(
        deathGeometryResolved,
        `>=99% of ${cases.length}`,
        rate(
          deathGeometryResolved,
          cases.length
        ) >=
        0.99
      ),


    activationXYGeometryCoverage:
      check(
        activationGeometryResolved,
        `>=99% of ${cases.length}`,
        rate(
          activationGeometryResolved,
          cases.length
        ) >=
        0.99
      ),


    onsetXYGeometryCoverage:
      check(
        onsetGeometryResolved,
        `>=99% of ${cases.length}`,
        rate(
          onsetGeometryResolved,
          cases.length
        ) >=
        0.99
      ),


    stableCount:
      check(
        cohorts
          .STABLE_GE_1
          .length,
        replayName ===
          'test'
          ? 131
          : '>0',
        replayName ===
          'test'
          ? cohorts
              .STABLE_GE_1
              .length ===
            131
          : cohorts
              .STABLE_GE_1
              .length >
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
// SUMMARY
// ============================================================

const summary =
  {

    replay:
      replayName,

    version:
      'ASSIGNED_GOLD_VACUUM_TEMPORAL_GEOMETRY_VALIDATION_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'TEMPORAL_VACUUM_GEOMETRY_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Measure the eventual vacuum-target player at the actual Trooper death tick, AssignedGold activation tick, and m_hVacuumTarget onset tick.',

        'Test whether the lone >735 HU onset case was already within the candidate stable-floor range before target assignment and then moved outward.',

        'Separate initial/death-time proximity from delayed floor-pickup proximity.',

        'Compare the provisional 735-HU stable-floor envelope with the broader 45m gameplay-informed hypothesis.'
      ],


    semanticLimits:
      {

        stable735:
          '735 HU remains a single-replay empirical stable-floor target-acquisition envelope, not an engine-documented radius.',

        fortyFiveMeters:
          '45m is retained only as a gameplay-informed candidate and is not assumed correct.',

        deathAnchor:
          'Death-position geometry uses the exact target-player position at the death tick and the observed Trooper death/source position.',

        activationGeometry:
          'Activation geometry uses raw target-pawn and AssignedGold positions at the reconstructed activation tick.',

        targetIdentity:
          'The eventual m_hVacuumTarget player is used for temporal geometry. This player may differ from the credited last-hitter while remaining allied.'
      },


    sourceCounts:
      {

        cases:
          cases.length,

        requestedUniqueTicks:
          needsByTick.size,

        requestedPacketHits,

        uniqueRequestedTicksSeen:
          uniqueRequestedTicksSeen.size,

        duplicateRequestedPacketHits:
          requestedPacketHits -
          uniqueRequestedTicksSeen.size,

        captureRows,

        onsetExpectedTarget:
          onsetExpectedTarget.length,

        activationNullTarget:
          activationNullTarget.length,

        deathGeometryResolved,

        activationGeometryResolved,

        onsetGeometryResolved
      },


    cohorts:
      cohortSummaries,


    candidate735Transitions:
      {

        onsetOver735:
          onsetOver735.length,

        onsetOver735ButDeathInside735:
          onsetOver735ButDeathInside735.length,

        onsetOver735ButActivationInside735:
          onsetOver735ButActivationInside735.length,

        activationOutsideToOnsetInside735:
          activationOutToOnsetIn735.length,

        deathOutsideToActivationInside735:
          deathOutToActivationIn735.length,

        onsetOver735Cases:
          onsetOver735.map(
            compactCase
          )
      },


    death5:
      death5
        ? compactCase(
            death5
          )
        : null,


    interpretationGuide:
      {

        death5ResolvedByEarlierEligibility:
          'If death 5 is <=735 HU at death or activation but >735 HU at target onset, its onset outlier is compatible with eligibility occurring earlier and m_hVacuumTarget appearing downstream.',

        distinctInitialRange:
          'If early/immediate target cases are frequently >735 HU at death/activation but remain tightly bounded by a larger threshold such as ~45m, initial automatic vacuum and later floor pickup may use different proximity rules.',

        sameRange:
          'If both initial and delayed cases are bounded near ~735 HU when measured at their relevant decision time, a common proximity rule becomes more plausible.',

        unresolved:
          'If death 5 remains outside 735 HU at death, activation, and onset, it remains an unresolved early-lifecycle exception.'
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
  'ASSIGNED GOLD TEMPORAL VACUUM GEOMETRY V0.1'
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


for (
  const [
    name,
    rows
  ]
  of Object.entries(
    cohorts
  )
) {

  console.log(
    `${name.padEnd(24)} ${rows.length}`
  );
}


console.log('');

console.log(
  'XY GEOMETRY BY COHORT'
);

console.log(
  '---------------------'
);


for (
  const [
    cohortName,
    cohort
  ]
  of Object.entries(
    cohortSummaries
  )
) {

  console.log('');

  console.log(
    cohortName
  );


  for (
    const metricName
    of [
      'TARGET_AT_DEATH_TO_DEATH_ANCHOR_XY',
      'TARGET_AT_ACTIVATION_TO_SOUL_XY',
      'TARGET_AT_ONSET_TO_SOUL_XY'
    ]
  ) {

    const row =
      cohort
        .metrics[
          metricName
        ];


    console.log(

      `  ${metricName.padEnd(38)} ` +

      `${formatDistribution(row.distribution)} ` +

      `<=735=${row.inside735}/${row.distribution.count} ` +

      `${formatPercent(row.inside735Rate)} ` +

      `<=45m=${row.inside45m}/${row.distribution.count} ` +

      `${formatPercent(row.inside45mRate)}`
    );
  }


  console.log(

    `  735 temporal classes: ` +

    `${JSON.stringify(cohort.temporalClasses735)}`
  );
}


// ============================================================
// 735 TEMPORAL TRANSITIONS
// ============================================================

console.log('');

console.log(
  '735-HU TEMPORAL TRANSITIONS'
);

console.log(
  '---------------------------'
);


console.log(
  `Onset >735:                         ${onsetOver735.length}`
);


console.log(
  `Onset >735 but death <=735:        ${onsetOver735ButDeathInside735.length}`
);


console.log(
  `Onset >735 but activation <=735:   ${onsetOver735ButActivationInside735.length}`
);


console.log(
  `Activation >735 -> onset <=735:    ${activationOutToOnsetIn735.length}`
);


console.log(
  `Death >735 -> activation <=735:    ${deathOutToActivationIn735.length}`
);


// ============================================================
// DEATH 5
// ============================================================

console.log('');

console.log(
  'DEATH 5 TEMPORAL GEOMETRY'
);

console.log(
  '-------------------------'
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

    `target@death -> death anchor XY: ` +

    `${formatNumber(
      death5
        .temporalGeometry
        .targetAtDeathToDeathAnchorXY
    )} HU`
  );


  console.log(

    `target@activation -> death anchor XY: ` +

    `${formatNumber(
      death5
        .temporalGeometry
        .targetAtActivationToDeathAnchorXY
    )} HU`
  );


  console.log(

    `target@activation -> soul XY: ` +

    `${formatNumber(
      death5
        .temporalGeometry
        .targetAtActivationToSoulXY
    )} HU`
  );


  console.log(

    `target@onset -> soul XY:      ` +

    `${formatNumber(
      death5
        .temporalGeometry
        .targetAtOnsetToSoulXY
    )} HU`
  );


  console.log(

    `735 states: ` +

    `${JSON.stringify(
      death5.rangeStates
    )}`
  );


  console.log(

    `temporal class: ` +

    `${death5.temporalClass735}`
  );
}


// ============================================================
// ENVELOPES
// ============================================================

console.log('');

console.log(
  'EARLY/IMMEDIATE 100% ENVELOPES'
);

console.log(
  '------------------------------'
);


for (
  const cohortName
  of [
    'IMMEDIATE_LE_0_25',
    'EARLY_GT_0_25_LT_1',
    'STABLE_GE_1'
  ]
) {

  const cohort =
    cohortSummaries[
      cohortName
    ];


  const deathRow =
    cohort
      .metrics
      .TARGET_AT_DEATH_TO_DEATH_ANCHOR_XY
      .minimum100;


  const activationRow =
    cohort
      .metrics
      .TARGET_AT_ACTIVATION_TO_SOUL_XY
      .minimum100;


  const onsetRow =
    cohort
      .metrics
      .TARGET_AT_ONSET_TO_SOUL_XY
      .minimum100;


  console.log(

    `${cohortName.padEnd(24)} ` +

    `death=${formatThreshold(deathRow)} ` +

    `activation=${formatThreshold(activationRow)} ` +

    `onset=${formatThreshold(onsetRow)}`
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
// CAPTURE SELECTION
// ============================================================

function selectCapture(
  captures,
  phase,
  row
) {

  if (
    !Array.isArray(
      captures
    )
    ||
    captures.length ===
      0
  ) {

    return null;
  }


  if (
    phase ===
    'onset'
  ) {

    const matches =
      captures.filter(
        capture =>
          capture
            .rawTargetPawnEntityIndex ===
          row.targetPawnEntityIndex
      );


    if (
      matches.length >
      0
    ) {

      return matches[
        matches.length -
        1
      ];
    }
  }


  if (
    phase ===
    'activation'
  ) {

    const nullTarget =
      captures.filter(
        capture =>
          capture
            .rawTargetPawnEntityIndex ===
          null
      );


    if (
      nullTarget.length >
      0
    ) {

      return nullTarget[
        nullTarget.length -
        1
      ];
    }
  }


  return captures[
    captures.length -
    1
  ];
}


// ============================================================
// TEMPORAL CLASS
// ============================================================

function classifyTemporal735(
  states
) {

  const d =
    states.deathAnchor735;


  const a =
    states.activationSoul735;


  const o =
    states.onsetSoul735;


  if (
    d ===
      null
    ||
    a ===
      null
    ||
    o ===
      null
  ) {

    return 'UNRESOLVED';
  }


  if (
    d
    &&
    a
    &&
    o
  ) {

    return 'INSIDE_735_AT_ALL_THREE';
  }


  if (
    d
    &&
    a
    &&
    !o
  ) {

    return 'INSIDE_THROUGH_ACTIVATION_OUTSIDE_AT_ONSET';
  }


  if (
    d
    &&
    !a
    &&
    o
  ) {

    return 'INSIDE_AT_DEATH_OUTSIDE_ACTIVATION_INSIDE_ONSET';
  }


  if (
    !d
    &&
    a
    &&
    o
  ) {

    return 'OUTSIDE_AT_DEATH_INSIDE_BY_ACTIVATION';
  }


  if (
    !d
    &&
    !a
    &&
    o
  ) {

    return 'OUTSIDE_THROUGH_ACTIVATION_INSIDE_AT_ONSET';
  }


  if (
    !d
    &&
    !a
    &&
    !o
  ) {

    return 'OUTSIDE_735_AT_ALL_THREE';
  }


  if (
    d
    &&
    !a
    &&
    !o
  ) {

    return 'INSIDE_AT_DEATH_OUTSIDE_AFTERWARD';
  }


  if (
    !d
    &&
    a
    &&
    !o
  ) {

    return 'OUTSIDE_AT_DEATH_INSIDE_ACTIVATION_OUTSIDE_ONSET';
  }


  return 'OTHER';
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

    deathTick:
      row.deathTick,

    activationTick:
      row.activationTick,

    onsetTick:
      row.onsetTick,

    temporalGeometry:
      row.temporalGeometry,

    rangeStates:
      row.rangeStates,

    temporalClass735:
      row.temporalClass735,

    selectedRawTargetPawnEntityIndex:
      {

        death:
          row
            ?.selected
            ?.death
            ?.rawTargetPawnEntityIndex ??
          null,

        activation:
          row
            ?.selected
            ?.activation
            ?.rawTargetPawnEntityIndex ??
          null,

        onset:
          row
            ?.selected
            ?.onset
            ?.rawTargetPawnEntityIndex ??
          null
      }
  };
}


// ============================================================
// RAW WORLD POSITION
// ============================================================

function getWorldPositionDetailed(
  entity
) {

  const cellX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellX'
      )
    );


  const cellY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellY'
      )
    );


  const cellZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellZ'
      )
    );


  const vecX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecX'
      )
    );


  const vecY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecY'
      )
    );


  const vecZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecZ'
      )
    );


  if (
    cellX ===
      null
    ||
    cellY ===
      null
    ||
    vecX ===
      null
    ||
    vecY ===
      null
  ) {

    return null;
  }


  const hasZ =
    cellZ !==
      null
    &&
    vecZ !==
      null;


  return {

    x:
      cellX *
      512 -
      16384 +
      vecX,

    y:
      cellY *
      512 -
      16384 +
      vecY,

    z:
      hasZ
        ? cellZ *
          512 -
          16384 +
          vecZ
        : null,

    hasZ
  };
}


// ============================================================
// NORMALIZED STORED POSITION
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

    z,

    hasZ:
      true
  };
}


// ============================================================
// ENTITY HELPERS
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


function getEntityIndex(
  entity
) {

  const direct =
    finite(
      entity?.index ??
      entity?.entityIndex
    );


  if (
    direct !==
    null
  ) {

    return direct;
  }


  try {

    return typeof entity?.getIndex ===
      'function'
      ? finite(
          entity.getIndex()
        )
      : null;

  } catch {

    return null;
  }
}


// ============================================================
// HANDLE
// ============================================================

function handleOrNull(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  try {

    const parsed =
      BigInt(
        value
      );


    if (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    ) {

      return null;
    }


    return parsed.toString();

  } catch {

    return null;
  }
}


function decodeHandleEntityIndex(
  handle
) {

  if (
    handle ===
      null
    ||
    handle ===
      undefined
  ) {

    return null;
  }


  try {

    const parsed =
      BigInt(
        handle
      );


    if (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    ) {

      return null;
    }


    return Number(
      parsed &
      BigInt(
        ENTITY_INDEX_MASK
      )
    );

  } catch {

    return null;
  }
}


function booleanOrNull(
  value
) {

  if (
    value ===
      true
    ||
    value ===
      false
  ) {

    return value;
  }


  if (
    value ===
      1
    ||
    value ===
      '1'
  ) {

    return true;
  }


  if (
    value ===
      0
    ||
    value ===
      '0'
  ) {

    return false;
  }


  return null;
}


// ============================================================
// GEOMETRY
// ============================================================

function distanceXYOrNull(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return null;
  }


  return distanceXY(
    a,
    b
  );
}


function distance3DOrNull(
  a,
  b
) {

  if (
    !a
    ||
    !b
    ||
    !Number.isFinite(
      a.z
    )
    ||
    !Number.isFinite(
      b.z
    )
  ) {

    return null;
  }


  return distance3D(
    a,
    b
  );
}


function distance3DStrictOrNull(
  a,
  b
) {

  if (
    !a
    ||
    !b
    ||
    a.hasZ !==
      true
    ||
    b.hasZ !==
      true
  ) {

    return null;
  }


  return distance3D(
    a,
    b
  );
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


// ============================================================
// COUNTS
// ============================================================

function countBy(
  rows,
  selector
) {

  const counts =
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


    counts[
      key
    ] =
      (
        counts[
          key
        ]
        ??
        0
      )
      +
      1;
  }


  return counts;
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

  const writer =
    createWriteStream(
      path,
      {
        encoding:
          'utf8'
      }
    );


  for (
    const row
    of rows
  ) {

    writer.write(
      `${JSON.stringify(row)}\n`
    );
  }


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

    `${formatNumber(row.thresholdHU)}HU` +

    `(${(
      row.thresholdHU /
      HU_PER_METER
    ).toFixed(
      2
    )}m)`
  );
}