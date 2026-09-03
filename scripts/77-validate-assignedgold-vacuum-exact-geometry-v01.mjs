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


const IMMEDIATE_SECONDS =
  0.25;


const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// THRESHOLD SEARCH
//
// Exploratory only. We deliberately search a broad range around
// the ~18-20 m envelope discovered by Script 76c.
//
// No selected value is promoted to an engine constant here.
// ============================================================

const SEARCH_MIN_HU =
  500;


const SEARCH_MAX_HU =
  1200;


const SEARCH_STEP_HU =
  1;


// ============================================================
// PURPOSE
//
// Script 76 / 76c used 4 Hz player_state reconstruction for the
// target player's position at m_hVacuumTarget onset.
//
// Script 77 replaces that with raw replay geometry on the exact
// two DEMO_PACKET observations that bracket target acquisition:
//
//   prior observed snapshot: m_hVacuumTarget == null
//   onset observed snapshot: m_hVacuumTarget == target player
//
// We read BOTH:
//
//   - target-player pawn position
//   - AssignedGold position
//
// directly from the replay on those ticks.
//
// This eliminates 4 Hz interpolation from the fine-grained range
// estimate.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const summary75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_discovery_v02.json'
  );


const snapshots75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_snapshots_v02.jsonl'
  );


const episodes76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );


const audit76cPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_threshold_clean_audit_v01.json'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_exact_geometry_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_exact_geometry_cases_v01.jsonl'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    summary75Path,
    snapshots75Path,
    episodes76Path,
    audit76cPath
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

const summary75 =
  JSON.parse(
    readFileSync(
      summary75Path,
      'utf8'
    )
  );


const audit76c =
  JSON.parse(
    readFileSync(
      audit76cPath,
      'utf8'
    )
  );


if (
  summary75
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 75 V02 did not PASS.'
  );
}


if (
  audit76c
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 76c did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 76 EPISODES
// ============================================================

console.log('');
console.log(
  'Loading Script 76 lifecycle episodes...'
);


const episodes76 =
  await loadJsonl(
    episodes76Path
  );


console.log(
  `Episodes: ${episodes76.length}`
);


// ============================================================
// CLEAN DELAYED TARGET TRANSITIONS
//
// This is the same strongest player-credit cohort used in 76c.
// ============================================================

const cases =
  episodes76
    .filter(
      row =>
        row
          ?.creditedPlayer
          ?.quality ===
        'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'

        &&

        row
          ?.vacuum
          ?.targetOnsetType ===
        'NULL_TO_PLAYER_TARGET_TRANSITION'

        &&

        Number.isFinite(
          finite(
            row
              ?.vacuum
              ?.targetDelaySeconds
          )
        )

        &&

        finite(
          row
            ?.vacuum
            ?.targetDelaySeconds
        ) >
        IMMEDIATE_SECONDS

        &&

        Number.isFinite(
          finite(
            row
              ?.vacuum
              ?.targetOnsetTick
          )
        )

        &&

        Number.isFinite(
          finite(
            row
              ?.vacuum
              ?.targetPawnEntityIndex
          )
        )

        &&

        Number.isFinite(
          finite(
            row
              ?.assignedGold
              ?.entityIndex
          )
        )
    )
    .map(
      (
        row,
        caseIndex
      ) => ({

        caseIndex,

        deathIndex:
          finite(
            row?.deathIndex
          ),

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

        expectedTargetPawnEntityIndex:
          finite(
            row
              ?.vacuum
              ?.targetPawnEntityIndex
          ),

        assignedGoldEntityIndex:
          finite(
            row
              ?.assignedGold
              ?.entityIndex
          ),

        activationTick:
          finite(
            row
              ?.assignedGold
              ?.activationTick
          ),

        onsetTick:
          finite(
            row
              ?.vacuum
              ?.targetOnsetTick
          ),

        targetDelaySeconds:
          finite(
            row
              ?.vacuum
              ?.targetDelaySeconds
          ),

        interpolatedOnsetDistance3D:
          finite(
            row
              ?.vacuum
              ?.targetGeometry
              ?.distanceAtOnset3D
          ),

        interpolatedOnsetDistanceXY:
          finite(
            row
              ?.vacuum
              ?.targetGeometry
              ?.distanceAtOnsetXY
          ),

        interpolatedPriorDistance3D:
          finite(
            row
              ?.vacuum
              ?.targetGeometry
              ?.distanceBeforeOnset3D
          ),

        interpolatedPriorDistanceXY:
          finite(
            row
              ?.vacuum
              ?.targetGeometry
              ?.distanceBeforeOnsetXY
          ),

        priorSnapshotTick:
          null,

        onsetSnapshotSeenIn75:
          false,

        script75OnsetTargetHandle:
          null,

        script75OnsetTargetPawnEntityIndex:
          null,

        script75PriorTargetHandle:
          null,

        script75PriorTargetPawnEntityIndex:
          null,

        rawPrior:
          null,

        rawOnset:
          null
      })
    );


console.log(
  `Clean delayed transitions: ${cases.length}`
);


// ============================================================
// MAP CASES BY DEATH INDEX
// ============================================================

const caseByDeathIndex =
  new Map();


for (
  const row
  of cases
) {

  if (
    row.deathIndex !==
    null
  ) {

    caseByDeathIndex.set(
      row.deathIndex,
      row
    );
  }
}


// ============================================================
// STREAM SCRIPT 75 SNAPSHOTS TO RECOVER THE ACTUAL PRIOR
// OBSERVATION USED BY SCRIPT 76
//
// We do NOT assume onsetTick - 1. We use the immediately prior
// Script 75 DEMO_PACKET snapshot for that exact episode.
// ============================================================

console.log(
  'Recovering prior/onset Script 75 snapshot ticks...'
);


const snapshotReader =
  createInterface({

    input:
      createReadStream(
        snapshots75Path,
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
  of snapshotReader
) {

  if (
    !line.trim()
  ) {

    continue;
  }


  let snapshot;


  try {

    snapshot =
      JSON.parse(
        line
      );

  } catch {

    continue;
  }


  const deathIndex =
    finite(
      snapshot?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const row =
    caseByDeathIndex.get(
      deathIndex
    );


  if (
    !row
  ) {

    continue;
  }


  const tick =
    finite(
      snapshot?.tick
    );


  if (
    tick ===
    null
  ) {

    continue;
  }


  if (
    row.activationTick !==
    null
    &&
    tick <
    row.activationTick
  ) {

    continue;
  }


  if (
    tick <
    row.onsetTick
  ) {

    row.priorSnapshotTick =
      tick;

    row.script75PriorTargetHandle =
      snapshot?.vacuumTargetHandle ??
      null;

    row.script75PriorTargetPawnEntityIndex =
      finite(
        snapshot
          ?.vacuumTargetPawnEntityIndex
      );

    continue;
  }


  if (
    tick ===
    row.onsetTick
  ) {

    row.onsetSnapshotSeenIn75 =
      true;

    row.script75OnsetTargetHandle =
      snapshot?.vacuumTargetHandle ??
      null;

    row.script75OnsetTargetPawnEntityIndex =
      finite(
        snapshot
          ?.vacuumTargetPawnEntityIndex
      );
  }
}


// ============================================================
// REQUESTED RAW TICKS
// ============================================================

const needsByTick =
  new Map();


for (
  const row
  of cases
) {

  if (
    row.priorSnapshotTick !==
    null
  ) {

    addNeed(
      row.priorSnapshotTick,
      {
        caseIndex:
          row.caseIndex,

        phase:
          'PRIOR'
      }
    );
  }


  if (
    row.onsetTick !==
    null
  ) {

    addNeed(
      row.onsetTick,
      {
        caseIndex:
          row.caseIndex,

        phase:
          'ONSET'
      }
    );
  }
}


function addNeed(
  tick,
  need
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
    .push(
      need
    );
}


// ============================================================
// RAW REPLAY RESCAN
// ============================================================

let requestedTicksSeen =
  0;


let priorRequestsCaptured =
  0;


let onsetRequestsCaptured =
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


    requestedTicksSeen++;


    const demo =
      parser.getDemo();


    const pawnEntities =
      demo.getEntitiesByClassName(
        'CCitadelPlayerPawn'
      )
      ??
      [];


    const soulEntities =
      demo.getEntitiesByClassName(
        'CCitadel_Pickup_AssignedGold'
      )
      ??
      [];


    const pawnByIndex =
      new Map();


    for (
      const entity
      of pawnEntities
    ) {

      const entityIndex =
        getEntityIndex(
          entity
        );


      if (
        entityIndex !==
        null
      ) {

        pawnByIndex.set(
          entityIndex,
          entity
        );
      }
    }


    const soulByIndex =
      new Map();


    for (
      const entity
      of soulEntities
    ) {

      const entityIndex =
        getEntityIndex(
          entity
        );


      if (
        entityIndex !==
        null
      ) {

        soulByIndex.set(
          entityIndex,
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
          row.expectedTargetPawnEntityIndex
        )
        ??
        null;


      const soul =
        soulByIndex.get(
          row.assignedGoldEntityIndex
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


      const geometry =
        buildGeometrySnapshot({
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


      if (
        need.phase ===
        'PRIOR'
      ) {

        row.rawPrior =
          geometry;

        priorRequestsCaptured++;

      } else {

        row.rawOnset =
          geometry;

        onsetRequestsCaptured++;
      }
    }
  }
);


console.log('');
console.log(
  'Rescanning raw replay at exact prior/onset ticks...'
);
console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// FINAL CASE CLASSIFICATION
// ============================================================

for (
  const row
  of cases
) {

  const prior3D =
    finite(
      row
        ?.rawPrior
        ?.distance3D
    );


  const onset3D =
    finite(
      row
        ?.rawOnset
        ?.distance3D
    );


  const priorXY =
    finite(
      row
        ?.rawPrior
        ?.distanceXY
    );


  const onsetXY =
    finite(
      row
        ?.rawOnset
        ?.distanceXY
    );


  row.rawPriorResolved =
    priorXY !==
    null;


  row.rawOnsetResolved =
    onsetXY !==
    null;


  row.rawStrict3DComparable =
    prior3D !==
      null
    &&
    onset3D !==
      null;


  row.rawXYComparable =
    priorXY !==
      null
    &&
    onsetXY !==
      null;


  row.rawTargetTransitionConfirmed =
    row
      ?.rawPrior
      ?.rawTargetPawnEntityIndex ===
      null
    &&
    row
      ?.rawOnset
      ?.rawTargetPawnEntityIndex ===
    row.expectedTargetPawnEntityIndex;


  row.script75TargetTransitionConfirmed =
    row.script75PriorTargetPawnEntityIndex ===
      null
    &&
    row.script75OnsetTargetPawnEntityIndex ===
    row.expectedTargetPawnEntityIndex;


  row.rawPriorMinusOnset3D =
    prior3D !==
      null
    &&
    onset3D !==
      null
      ? prior3D -
        onset3D
      : null;


  row.rawPriorMinusOnsetXY =
    priorXY !==
      null
    &&
    onsetXY !==
      null
      ? priorXY -
        onsetXY
      : null;


  row.rawMovementDirection3D =
    classifyDirection(
      row.rawPriorMinusOnset3D
    );


  row.rawMovementDirectionXY =
    classifyDirection(
      row.rawPriorMinusOnsetXY
    );


  row.rawMinusInterpolatedOnset3D =
    onset3D !==
      null
    &&
    row.interpolatedOnsetDistance3D !==
      null
      ? onset3D -
        row.interpolatedOnsetDistance3D
      : null;


  row.rawMinusInterpolatedOnsetXY =
    onsetXY !==
      null
    &&
    row.interpolatedOnsetDistanceXY !==
      null
      ? onsetXY -
        row.interpolatedOnsetDistanceXY
      : null;
}


// ============================================================
// STRONGEST INFERENCE COHORTS
//
// Raw field transition must reproduce the null -> expected pawn
// change. Then geometry must be available.
// ============================================================

const rawTransitionConfirmed =
  cases.filter(
    row =>
      row.rawTargetTransitionConfirmed
  );


const strict3D =
  rawTransitionConfirmed.filter(
    row =>
      row.rawStrict3DComparable
  );


const xyComparable =
  rawTransitionConfirmed.filter(
    row =>
      row.rawXYComparable
  );


const strict3DInward =
  strict3D.filter(
    row =>
      row.rawPriorMinusOnset3D >
      0
  );


const strict3DOutward =
  strict3D.filter(
    row =>
      row.rawPriorMinusOnset3D <
      0
  );


const strict3DUnchanged =
  strict3D.filter(
    row =>
      row.rawPriorMinusOnset3D ===
      0
  );


const xyInward =
  xyComparable.filter(
    row =>
      row.rawPriorMinusOnsetXY >
      0
  );


// ============================================================
// DISTANCE DISTRIBUTIONS
// ============================================================

const strictOnset3D =
  values(
    strict3D,
    row =>
      row.rawOnset.distance3D
  );


const strictPrior3D =
  values(
    strict3D,
    row =>
      row.rawPrior.distance3D
  );


const onsetXY =
  values(
    xyComparable,
    row =>
      row.rawOnset.distanceXY
  );


const priorXY =
  values(
    xyComparable,
    row =>
      row.rawPrior.distanceXY
  );


const rawMinusInterpolated3D =
  values(
    strict3D,
    row =>
      row.rawMinusInterpolatedOnset3D
  );


const rawMinusInterpolatedXY =
  values(
    xyComparable,
    row =>
      row.rawMinusInterpolatedOnsetXY
  );


const verticalContribution =
  strict3D
    .map(
      row => {

        const d3 =
          row.rawOnset.distance3D;

        const dxy =
          row.rawOnset.distanceXY;


        return Number.isFinite(
          d3
        )
        &&
        Number.isFinite(
          dxy
        )
          ? d3 -
            dxy
          : null;
      }
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// THRESHOLD SEARCH — 3D / XY
// ============================================================

const threshold3D =
  buildThresholdSearch(
    strict3D,
    'distance3D'
  );


const thresholdXY =
  buildThresholdSearch(
    xyComparable,
    'distanceXY'
  );


function buildThresholdSearch(
  source,
  field
) {

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

    let onsetInside =
      0;


    let onsetOutside =
      0;


    let exactCrossing =
      0;


    let inwardComparable =
      0;


    let inwardCrossing =
      0;


    for (
      const row
      of source
    ) {

      const prior =
        finite(
          row
            ?.rawPrior
            ?.[field]
        );


      const onset =
        finite(
          row
            ?.rawOnset
            ?.[field]
        );


      if (
        prior ===
          null
        ||
        onset ===
          null
      ) {

        continue;
      }


      if (
        onset <=
        thresholdHU
      ) {

        onsetInside++;

      } else {

        onsetOutside++;
      }


      if (
        prior >
          thresholdHU
        &&
        onset <=
          thresholdHU
      ) {

        exactCrossing++;
      }


      if (
        prior >
        onset
      ) {

        inwardComparable++;


        if (
          prior >
            thresholdHU
          &&
          onset <=
            thresholdHU
        ) {

          inwardCrossing++;
        }
      }
    }


    rows.push({

      thresholdHU,

      thresholdMeters:
        thresholdHU /
        HU_PER_METER,

      total:
        source.length,

      onsetInside,

      onsetOutside,

      onsetContainmentRate:
        rate(
          onsetInside,
          source.length
        ),

      exactCrossing,

      exactCrossingRate:
        rate(
          exactCrossing,
          source.length
        ),

      inwardComparable,

      inwardCrossing,

      inwardCrossingRate:
        rate(
          inwardCrossing,
          inwardComparable
        )
    });
  }


  return rows;
}


// ============================================================
// MINIMUM CONTAINMENT ENVELOPES
// ============================================================

const strict3D95 =
  minimumThresholdForCoverage(
    strictOnset3D,
    0.95
  );


const strict3D99 =
  minimumThresholdForCoverage(
    strictOnset3D,
    0.99
  );


const strict3D100 =
  minimumThresholdForCoverage(
    strictOnset3D,
    1.00
  );


const xy95 =
  minimumThresholdForCoverage(
    onsetXY,
    0.95
  );


const xy99 =
  minimumThresholdForCoverage(
    onsetXY,
    0.99
  );


const xy100 =
  minimumThresholdForCoverage(
    onsetXY,
    1.00
  );


// ============================================================
// BEST CROSSING COUNTS
//
// Descriptive, NOT automatically the radius.
// ============================================================

const best3DCrossing =
  selectBestCrossing(
    threshold3D
  );


const bestXYCrossing =
  selectBestCrossing(
    thresholdXY
  );


function selectBestCrossing(
  rows
) {

  return rows
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.exactCrossing -
          a.exactCrossing
        ||
        a.onsetOutside -
          b.onsetOutside
        ||
        a.thresholdHU -
          b.thresholdHU
    )[0]
    ??
    null;
}


// ============================================================
// STANDARD THRESHOLDS
// ============================================================

const standardThresholds = [
  700,
  720,
  729,
  735,
  740,
  750,
  768,
  775,
  782,
  800,
  825,
  850,
  900,
  1000
];


const standard3D =
  standardThresholds
    .map(
      threshold =>
        threshold3D.find(
          row =>
            row.thresholdHU ===
            threshold
        )
    )
    .filter(
      Boolean
    );


const standardXY =
  standardThresholds
    .map(
      threshold =>
        thresholdXY.find(
          row =>
            row.thresholdHU ===
            threshold
        )
    )
    .filter(
      Boolean
    );


// ============================================================
// EXTREME CASES
// ============================================================

const largest3DOnsets =
  strict3D
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.rawOnset.distance3D -
        a.rawOnset.distance3D
    )
    .slice(
      0,
      30
    )
    .map(
      compactCase
    );


const largestXYOnsets =
  xyComparable
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.rawOnset.distanceXY -
        a.rawOnset.distanceXY
    )
    .slice(
      0,
      30
    )
    .map(
      compactCase
    );


const onsetOver8003D =
  strict3D
    .filter(
      row =>
        row.rawOnset.distance3D >
        800
    )
    .map(
      compactCase
    );


const onsetOver800XY =
  xyComparable
    .filter(
      row =>
        row.rawOnset.distanceXY >
        800
    )
    .map(
      compactCase
    );


// ============================================================
// TRANSITION CONTRACT COUNTS
// ============================================================

const script75TransitionConfirmed =
  cases.filter(
    row =>
      row.script75TargetTransitionConfirmed
  );


const rawOnsetMatchesExpectedPawn =
  cases.filter(
    row =>
      row
        ?.rawOnset
        ?.rawTargetPawnEntityIndex ===
      row.expectedTargetPawnEntityIndex
  );


const rawPriorIsNullTarget =
  cases.filter(
    row =>
      row
        ?.rawPrior
        ?.rawTargetPawnEntityIndex ===
      null
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedCleanDelayed =
  finite(
    audit76c
      ?.cleanCohort
      ?.delayedTransitions
  );


const validationChecks = {

  script75Passed:
    check(
      summary75
        ?.validation
        ?.pass,
      true,
      summary75
        ?.validation
        ?.pass ===
      true
    ),


  script76cPassed:
    check(
      audit76c
        ?.validation
        ?.pass,
      true,
      audit76c
        ?.validation
        ?.pass ===
      true
    ),


  cleanDelayedCount:
    check(
      cases.length,
      expectedCleanDelayed,
      expectedCleanDelayed ===
        null
        ? cases.length >
          0
        : cases.length ===
          expectedCleanDelayed
    ),


  expectedTestCleanDelayedCount:
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


  priorScript75SnapshotRecovered:
    check(
      cases.filter(
        row =>
          row.priorSnapshotTick !==
          null
      ).length,
      cases.length,
      cases.every(
        row =>
          row.priorSnapshotTick !==
          null
      )
    ),


  onsetScript75SnapshotRecovered:
    check(
      cases.filter(
        row =>
          row.onsetSnapshotSeenIn75
      ).length,
      cases.length,
      cases.every(
        row =>
          row.onsetSnapshotSeenIn75
      )
    ),


  script75NullToExpectedTargetContract:
    check(
      script75TransitionConfirmed.length,
      cases.length,
      script75TransitionConfirmed.length ===
      cases.length
    ),


  requestedTicksSeen:
    check(
      requestedTicksSeen,
      needsByTick.size,
      requestedTicksSeen ===
      needsByTick.size
    ),


  priorRawRequestCoverage:
    check(
      cases.filter(
        row =>
          row.rawPrior !==
          null
      ).length,
      cases.length,
      rate(
        cases.filter(
          row =>
            row.rawPrior !==
            null
        ).length,
        cases.length
      ) >=
      0.95
    ),


  onsetRawRequestCoverage:
    check(
      cases.filter(
        row =>
          row.rawOnset !==
          null
      ).length,
      cases.length,
      rate(
        cases.filter(
          row =>
            row.rawOnset !==
            null
        ).length,
        cases.length
      ) >=
      0.95
    ),


  rawOnsetTargetMatchesExpectedPawn:
    check(
      rawOnsetMatchesExpectedPawn.length,
      cases.length,
      rate(
        rawOnsetMatchesExpectedPawn.length,
        cases.length
      ) >=
      0.99
    ),


  rawPriorTargetIsNull:
    check(
      rawPriorIsNullTarget.length,
      cases.length,
      rate(
        rawPriorIsNullTarget.length,
        cases.length
      ) >=
      0.99
    ),


  rawTransitionConfirmed:
    check(
      rawTransitionConfirmed.length,
      cases.length,
      rate(
        rawTransitionConfirmed.length,
        cases.length
      ) >=
      0.99
    ),


  strict3DGeometryCoverage:
    check(
      strict3D.length,
      `>=95% of ${rawTransitionConfirmed.length}`,
      rate(
        strict3D.length,
        rawTransitionConfirmed.length
      ) >=
      0.95
    ),


  xyGeometryCoverage:
    check(
      xyComparable.length,
      `>=99% of ${rawTransitionConfirmed.length}`,
      rate(
        xyComparable.length,
        rawTransitionConfirmed.length
      ) >=
      0.99
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
    'ASSIGNED_GOLD_VACUUM_EXACT_GEOMETRY_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'EXACT_RAW_VACUUM_GEOMETRY_READY'
      : 'PIPELINE_VALIDATION_FAILURE',


  purpose: [

    'Replace 4Hz reconstructed target-player geometry with raw replay target-pawn and AssignedGold positions at the exact observed vacuum-target transition.',

    'Use the actual prior Script75 snapshot tick instead of assuming targetOnsetTick - 1.',

    'Confirm the raw null-to-expected-player m_hVacuumTarget transition.',

    'Estimate the empirical vacuum-target acquisition envelope separately in strict 3D and XY geometry.'
  ],


  semanticLimits: {

    vacuumTarget:
      'm_hVacuumTarget remains observed target telemetry. The strong null-to-player transition and subsequent inactivity support vacuum semantics but do not constitute engine documentation.',

    geometry:
      'Distances are raw replay entity-origin distances. Strict 3D requires valid Z telemetry for both target pawn and AssignedGold; XY is reported separately.',

    threshold:
      'Observed containment and crossing counts identify an empirical single-replay envelope. They do not establish an exact engine constant without replication and outlier resolution.',

    bestCrossing:
      'The threshold maximizing previous-outside/onset-inside crossings is descriptive and must not override reliable onset distances above that threshold.'
  },


  sourceCounts: {

    cleanDelayedTransitions:
      cases.length,

    requestedTicks:
      needsByTick.size,

    requestedTicksSeen,

    priorRequestsCaptured,

    onsetRequestsCaptured,

    script75TransitionConfirmed:
      script75TransitionConfirmed.length,

    rawTransitionConfirmed:
      rawTransitionConfirmed.length,

    strict3DComparable:
      strict3D.length,

    xyComparable:
      xyComparable.length
  },


  rawTransitionContract: {

    onsetMatchesExpectedTargetPawn:
      rawOnsetMatchesExpectedPawn.length,

    onsetMatchesExpectedTargetPawnRate:
      rate(
        rawOnsetMatchesExpectedPawn.length,
        cases.length
      ),

    priorHasNullTarget:
      rawPriorIsNullTarget.length,

    priorHasNullTargetRate:
      rate(
        rawPriorIsNullTarget.length,
        cases.length
      ),

    fullyConfirmedNullToExpectedPlayer:
      rawTransitionConfirmed.length,

    fullyConfirmedRate:
      rate(
        rawTransitionConfirmed.length,
        cases.length
      )
  },


  rawMovementDirection: {

    strict3D: {

      inward:
        strict3DInward.length,

      outward:
        strict3DOutward.length,

      unchanged:
        strict3DUnchanged.length
    },

    xy: {

      inward:
        xyInward.length,

      other:
        xyComparable.length -
        xyInward.length
    }
  },


  exactRawDistance3D: {

    onset:
      summarizeNumbers(
        strictOnset3D
      ),

    prior:
      summarizeNumbers(
        strictPrior3D
      ),

    minimumThresholdFor95PercentContainment:
      strict3D95,

    minimumThresholdFor99PercentContainment:
      strict3D99,

    minimumThresholdFor100PercentContainment:
      strict3D100,

    bestCrossingThreshold:
      best3DCrossing,

    standardThresholds:
      standard3D
  },


  exactRawDistanceXY: {

    onset:
      summarizeNumbers(
        onsetXY
      ),

    prior:
      summarizeNumbers(
        priorXY
      ),

    minimumThresholdFor95PercentContainment:
      xy95,

    minimumThresholdFor99PercentContainment:
      xy99,

    minimumThresholdFor100PercentContainment:
      xy100,

    bestCrossingThreshold:
      bestXYCrossing,

    standardThresholds:
      standardXY
  },


  rawVsFourHzReconstruction: {

    rawMinusInterpolatedOnset3D:
      summarizeNumbers(
        rawMinusInterpolated3D
      ),

    rawMinusInterpolatedOnsetXY:
      summarizeNumbers(
        rawMinusInterpolatedXY
      ),

    onset3DMinusXY:
      summarizeNumbers(
        verticalContribution
      )
  },


  outliers: {

    onsetOver800HU3D:
      onsetOver8003D,

    onsetOver800HUXY:
      onsetOver800XY,

    largest3DOnsets,

    largestXYOnsets
  },


  interpretationGuide: {

    rawUpgrade:
      'This is the requested replacement of 4Hz interpolated player geometry with exact raw replay geometry at the vacuum-target transition.',

    hardBoundary:
      'A candidate hard radius must be at least as large as the highest reliable onset geometry in the relevant metric. Crossing-count optima below reliable onset observations cannot be treated as the radius.',

    metricChoice:
      'If XY produces a materially tighter boundary than 3D, the vacuum condition may be primarily planar or entity-origin Z may add irrelevant vertical separation. That remains a mechanic hypothesis until replicated.',

    next:
      'After this result, resolve any small set of extreme onset cases. If the clean raw envelope is stable, then promote a single-replay candidate vacuum radius and move to the structured targetless lifetime schedule.'
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
// WRITE OUTPUTS
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
  'ASSIGNED GOLD EXACT VACUUM GEOMETRY V0.1'
);
console.log(
  '========================================================'
);


console.log('');
console.log(
  'RAW TARGET TRANSITION CONTRACT'
);
console.log(
  '------------------------------'
);


console.log(
  `Clean delayed cases:             ${cases.length}`
);


console.log(
  `Script75 null->expected target:  ${script75TransitionConfirmed.length}/${cases.length} = ${formatPercent(rate(script75TransitionConfirmed.length, cases.length))}`
);


console.log(
  `Raw prior target null:           ${rawPriorIsNullTarget.length}/${cases.length} = ${formatPercent(rate(rawPriorIsNullTarget.length, cases.length))}`
);


console.log(
  `Raw onset expected target:       ${rawOnsetMatchesExpectedPawn.length}/${cases.length} = ${formatPercent(rate(rawOnsetMatchesExpectedPawn.length, cases.length))}`
);


console.log(
  `Raw full transition confirmed:   ${rawTransitionConfirmed.length}/${cases.length} = ${formatPercent(rate(rawTransitionConfirmed.length, cases.length))}`
);


console.log('');
console.log(
  'RAW GEOMETRY COVERAGE'
);
console.log(
  '---------------------'
);


console.log(
  `Strict 3D comparable: ${strict3D.length}/${rawTransitionConfirmed.length} = ${formatPercent(rate(strict3D.length, rawTransitionConfirmed.length))}`
);


console.log(
  `XY comparable:        ${xyComparable.length}/${rawTransitionConfirmed.length} = ${formatPercent(rate(xyComparable.length, rawTransitionConfirmed.length))}`
);


console.log('');
console.log(
  'EXACT RAW 3D ONSET DISTANCE'
);
console.log(
  '---------------------------'
);


console.log(
  formatDistribution(
    summarizeNumbers(
      strictOnset3D
    )
  )
);


console.log(
  `95% containment:  ${formatThreshold(strict3D95)}`
);


console.log(
  `99% containment:  ${formatThreshold(strict3D99)}`
);


console.log(
  `100% containment: ${formatThreshold(strict3D100)}`
);


console.log('');
console.log(
  'EXACT RAW XY ONSET DISTANCE'
);
console.log(
  '---------------------------'
);


console.log(
  formatDistribution(
    summarizeNumbers(
      onsetXY
    )
  )
);


console.log(
  `95% containment:  ${formatThreshold(xy95)}`
);


console.log(
  `99% containment:  ${formatThreshold(xy99)}`
);


console.log(
  `100% containment: ${formatThreshold(xy100)}`
);


console.log('');
console.log(
  'RAW VS 4HZ INTERPOLATED ONSET DISTANCE'
);
console.log(
  '--------------------------------------'
);


console.log(
  `3D raw-minus-interpolated: ${formatDistribution(summarizeNumbers(rawMinusInterpolated3D))}`
);


console.log(
  `XY raw-minus-interpolated: ${formatDistribution(summarizeNumbers(rawMinusInterpolatedXY))}`
);


console.log('');
console.log(
  'STANDARD CANDIDATE THRESHOLDS — 3D'
);
console.log(
  '----------------------------------'
);


for (
  const row
  of standard3D
) {

  console.log(
    `${String(row.thresholdHU).padStart(4)} HU ` +
    `(${row.thresholdMeters.toFixed(2)}m) ` +
    `contain=${String(row.onsetInside).padStart(4)}/${strict3D.length} ` +
    `${formatPercent(row.onsetContainmentRate)} ` +
    `cross=${String(row.exactCrossing).padStart(3)}/${strict3D.length}`
  );
}


console.log('');
console.log(
  'STANDARD CANDIDATE THRESHOLDS — XY'
);
console.log(
  '----------------------------------'
);


for (
  const row
  of standardXY
) {

  console.log(
    `${String(row.thresholdHU).padStart(4)} HU ` +
    `(${row.thresholdMeters.toFixed(2)}m) ` +
    `contain=${String(row.onsetInside).padStart(4)}/${xyComparable.length} ` +
    `${formatPercent(row.onsetContainmentRate)} ` +
    `cross=${String(row.exactCrossing).padStart(3)}/${xyComparable.length}`
  );
}


console.log('');
console.log(
  'BEST CROSSING-COUNT THRESHOLDS'
);
console.log(
  '------------------------------'
);


console.log(
  `3D: ${formatThresholdRow(best3DCrossing)}`
);


console.log(
  `XY: ${formatThresholdRow(bestXYCrossing)}`
);


console.log('');
console.log(
  'LARGEST 20 EXACT 3D ONSETS'
);
console.log(
  '--------------------------'
);


for (
  const row
  of largest3DOnsets.slice(
    0,
    20
  )
) {

  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `delay=${formatNumber(row.targetDelaySeconds).padStart(7)}s ` +
    `prior=${formatNumber(row.rawPriorDistance3D).padStart(9)} ` +
    `onset=${formatNumber(row.rawOnsetDistance3D).padStart(9)} HU ` +
    `(${formatMeters(row.rawOnsetDistance3D)}m) ` +
    `xy=${formatNumber(row.rawOnsetDistanceXY).padStart(9)} ` +
    `dir=${row.rawMovementDirection3D}`
  );
}


console.log('');
console.log(
  'ONSET >800 HU'
);
console.log(
  '-------------'
);


console.log(
  `3D: ${onsetOver8003D.length}`
);


console.log(
  `XY: ${onsetOver800XY.length}`
);


for (
  const row
  of onsetOver8003D
) {

  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `prior3D=${formatNumber(row.rawPriorDistance3D)} ` +
    `onset3D=${formatNumber(row.rawOnsetDistance3D)} ` +
    `onsetXY=${formatNumber(row.rawOnsetDistanceXY)} ` +
    `target=${row.targetPlayerName ?? 'NONE'}`
  );
}


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
    `${name.padEnd(42)} ` +
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
// RAW GEOMETRY SNAPSHOT
// ============================================================

function buildGeometrySnapshot({
  tick,
  targetPosition,
  soulPosition,
  rawTargetHandle,
  rawTargetPawnEntityIndex,
  soulActive,
  soulInteractive
}) {

  const distanceXYValue =
    targetPosition
    &&
    soulPosition
      ? distanceXY(
        targetPosition,
        soulPosition
      )
      : null;


  const distance3DValue =
    targetPosition
    &&
    soulPosition
    &&
    targetPosition.hasZ
    &&
    soulPosition.hasZ
      ? distance3D(
        targetPosition,
        soulPosition
      )
      : null;


  return {

    tick,

    targetPosition,

    soulPosition,

    distance3D:
      distance3DValue,

    distanceXY:
      distanceXYValue,

    rawTargetHandle,

    rawTargetPawnEntityIndex,

    soulActive,

    soulInteractive
  };
}


// ============================================================
// WORLD POSITION
//
// XY is valid when X/Y cell+vector fields are available.
// Strict 3D is only considered valid when Z is also directly
// available. We do not substitute z=0 for threshold inference.
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


function classifyDirection(
  priorMinusOnset
) {

  if (
    !Number.isFinite(
      priorMinusOnset
    )
  ) {

    return 'UNRESOLVED';
  }


  if (
    priorMinusOnset >
    0
  ) {

    return 'INWARD';
  }


  if (
    priorMinusOnset <
    0
  ) {

    return 'OUTWARD';
  }


  return 'UNCHANGED';
}


// ============================================================
// THRESHOLD HELPERS
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
      ) -
      1
    );


  const thresholdHU =
    clean[index];


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

    deathIndex:
      row.deathIndex,

    clock:
      row.clock,

    baseType:
      row.baseType,

    creditedPlayerName:
      row.creditedPlayerName,

    creditedPlayerTeam:
      row.creditedPlayerTeam,

    targetPlayerName:
      row.targetPlayerName,

    targetPlayerTeam:
      row.targetPlayerTeam,

    targetPawnEntityIndex:
      row.expectedTargetPawnEntityIndex,

    assignedGoldEntityIndex:
      row.assignedGoldEntityIndex,

    activationTick:
      row.activationTick,

    priorSnapshotTick:
      row.priorSnapshotTick,

    onsetTick:
      row.onsetTick,

    targetDelaySeconds:
      row.targetDelaySeconds,

    script75TargetTransitionConfirmed:
      row.script75TargetTransitionConfirmed,

    rawTargetTransitionConfirmed:
      row.rawTargetTransitionConfirmed,

    rawPriorTargetPawnEntityIndex:
      row
        ?.rawPrior
        ?.rawTargetPawnEntityIndex ??
      null,

    rawOnsetTargetPawnEntityIndex:
      row
        ?.rawOnset
        ?.rawTargetPawnEntityIndex ??
      null,

    rawPriorDistance3D:
      finite(
        row
          ?.rawPrior
          ?.distance3D
      ),

    rawOnsetDistance3D:
      finite(
        row
          ?.rawOnset
          ?.distance3D
      ),

    rawPriorDistanceXY:
      finite(
        row
          ?.rawPrior
          ?.distanceXY
      ),

    rawOnsetDistanceXY:
      finite(
        row
          ?.rawOnset
          ?.distanceXY
      ),

    rawPriorMinusOnset3D:
      row.rawPriorMinusOnset3D,

    rawPriorMinusOnsetXY:
      row.rawPriorMinusOnsetXY,

    rawMovementDirection3D:
      row.rawMovementDirection3D,

    rawMovementDirectionXY:
      row.rawMovementDirectionXY,

    interpolatedPriorDistance3D:
      row.interpolatedPriorDistance3D,

    interpolatedOnsetDistance3D:
      row.interpolatedOnsetDistance3D,

    interpolatedPriorDistanceXY:
      row.interpolatedPriorDistanceXY,

    interpolatedOnsetDistanceXY:
      row.interpolatedOnsetDistanceXY,

    rawMinusInterpolatedOnset3D:
      row.rawMinusInterpolatedOnset3D,

    rawMinusInterpolatedOnsetXY:
      row.rawMinusInterpolatedOnsetXY,

    rawPriorTargetPosition:
      row
        ?.rawPrior
        ?.targetPosition ??
      null,

    rawPriorSoulPosition:
      row
        ?.rawPrior
        ?.soulPosition ??
      null,

    rawOnsetTargetPosition:
      row
        ?.rawOnset
        ?.targetPosition ??
      null,

    rawOnsetSoulPosition:
      row
        ?.rawOnset
        ?.soulPosition ??
      null
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
      ) /
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
    ) *
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

function formatPercent(
  value
) {

  return Number.isFinite(
    value
  )
    ? `${(
      value *
      100
    ).toFixed(2)}%`
    : 'n/a';
}


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


function formatThresholdRow(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (
    `${row.thresholdHU} HU ` +
    `(${row.thresholdMeters.toFixed(2)}m) ` +
    `cross=${row.exactCrossing}/${row.total} ` +
    `contain=${row.onsetInside}/${row.total} ` +
    `outside=${row.onsetOutside}`
  );
}