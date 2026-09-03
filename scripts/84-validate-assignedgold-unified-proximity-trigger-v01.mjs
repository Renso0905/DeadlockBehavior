import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Parser, InterceptorStage } from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const TICK_RATE =
  64;


const HU_PER_METER =
  39.37;


const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// THRESHOLD SEARCH
// ============================================================

const SEARCH_MIN_HU =
  650;


const SEARCH_MAX_HU =
  900;


const SEARCH_STEP_HU =
  1;


const STANDARD_THRESHOLDS = [
  700,
  720,
  729,
  732,
  735,
  740,
  746,
  750,
  768,
  800,
  825,
  850
];


const FALLBACK_MAX_LIFETIME_TICKS =
  60 *
  TICK_RATE;


// ============================================================
// PURPOSE
//
// Script 83 showed that exact nearest-allied-player distance at
// Trooper death predicts target acquisition <1s much better than
// credited-last-hitter distance, with the strongest threshold
// again near the ~735-HU stable floor envelope.
//
// Script 84 tests the stronger unified hypothesis directly:
//
//   CURRENT AssignedGold exists
//          +
//   ANY living allied pawn approaches CURRENT soul
//          ↓
//   m_hVacuumTarget becomes a player
//
// For every clean credited episode we rescan raw replay state
// from AssignedGold activation until:
//
//   - m_hVacuumTarget onset, for target-transition cases, or
//   - lifecycle termination, for no-target cases.
//
// We measure the minimum exact XY distance from the CURRENT soul
// to ANY eligible allied player before the outcome.
//
// This can test both necessity and specificity:
//
//   target episodes should enter the candidate proximity region
//   no-target episodes should remain outside it
//
// No threshold is promoted to an engine constant in this script.
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


const summary83Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_death_team_geometry_validation_v01.json'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_unified_proximity_trigger_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_unified_proximity_trigger_cases_v01.jsonl'
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
    summary83Path
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


const summary83 =
  JSON.parse(
    readFileSync(
      summary83Path,
      'utf8'
    )
  );


if (
  summary83
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 83 did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 75 / 76
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
// BUILD CLEAN 991-EPISODE COHORT
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


  const activationTick =
    firstFinite([
      row
        ?.assignedGold
        ?.activationTick,

      source75
        ?.assignedGold
        ?.activationTick
    ]);


  const entityIndex =
    firstFinite([
      row
        ?.assignedGold
        ?.entityIndex,

      source75
        ?.assignedGold
        ?.entityIndex
    ]);


  const endTick =
    firstFinite([
      source75
        ?.script55Lifecycle
        ?.endTick,

      source75
        ?.assignedGold
        ?.endTick
    ]);


  const targetOnsetType =
    row
      ?.vacuum
      ?.targetOnsetType ??
    null;


  const expectedTargetOnsetTick =
    targetOnsetType ===
      'NULL_TO_PLAYER_TARGET_TRANSITION'
      ? finite(
        row
          ?.vacuum
          ?.targetOnsetTick
      )
      : null;


  const expectedTargetPawnEntityIndex =
    targetOnsetType ===
      'NULL_TO_PLAYER_TARGET_TRANSITION'
      ? finite(
        row
          ?.vacuum
          ?.targetPawnEntityIndex
      )
      : null;


  const creditedTeam =
    finite(
      row
        ?.creditedPlayer
        ?.team
    );


  if (
    activationTick ===
      null
    ||
    entityIndex ===
      null
    ||
    creditedTeam ===
      null
  ) {

    continue;
  }


  const observationEndTick =
    expectedTargetOnsetTick !==
      null
      ? expectedTargetOnsetTick

      : endTick !==
          null
        ? endTick

        : activationTick +
          FALLBACK_MAX_LIFETIME_TICKS;


  if (
    observationEndTick <
    activationTick
  ) {

    continue;
  }


  const lifecycleBand =
    classifyLifecycleBand(
      targetOnsetType,
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      )
    );


  cases.push({

    caseIndex:
      cases.length,

    deathIndex,

    clock:
      row?.clock ??
      source75
        ?.death
        ?.clock ??
      null,

    baseType:
      row?.baseType ??
      source75
        ?.death
        ?.baseType ??
      null,

    creditedPlayerName:
      row
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedTeam,

    assignedGoldEntityIndex:
      entityIndex,

    activationTick,

    observationEndTick,

    expectedTargetOnsetType:
      targetOnsetType,

    expectedTargetOnsetTick,

    expectedTargetPawnEntityIndex,

    expectedTargetPlayerName:
      row
        ?.vacuum
        ?.targetPlayerName ??
      null,

    targetDelaySeconds:
      finite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      ),

    lifecycleBand,

    raw: {

      firstObservedTick:
        null,

      lastObservedTick:
        null,

      soulPositionSamples:
        0,

      allyGeometrySamples:
        0,

      firstSoulActiveTick:
        null,

      firstSoulInactiveTick:
        null,

      rawTargetOnsetTick:
        null,

      rawTargetPawnEntityIndex:
        null,

      rawTargetPlayerName:
        null,

      minimumNearestAllyXY:
        null,

      minimumNearestAlly3D:
        null,

      minimumNearestAllyTick:
        null,

      minimumNearestAllyPlayerName:
        null,

      minimumNearestAllyPawnEntityIndex:
        null,

      nearestAtActivationXY:
        null,

      nearestAtActivationPlayerName:
        null,

      nearestAtRawTargetOnsetXY:
        null,

      nearestAtRawTargetOnsetPlayerName:
        null,

      thresholdStates:
        Object.fromEntries(

          STANDARD_THRESHOLDS.map(
            threshold => [

              String(
                threshold
              ),

              {

                firstInsideTick:
                  null,

                firstInsidePlayerName:
                  null,

                firstInsidePawnEntityIndex:
                  null,

                lastEntryTick:
                  null,

                lastEntryPlayerName:
                  null,

                insideAtActivation:
                  null,

                previousInside:
                  null
              }
            ]
          )
        )
    }
  });
}


console.log(
  `Clean lifecycle cases: ${cases.length}`
);


// ============================================================
// SORT STARTS FOR ACTIVE-INTERVAL SWEEP
// ============================================================

const starts =
  cases
    .map(
      row => ({

        caseIndex:
          row.caseIndex,

        startTick:
          row.activationTick
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        a.startTick -
          b.startTick
        ||
        a.caseIndex -
          b.caseIndex
    );


let startPointer =
  0;


const activeCaseIndexes =
  new Set();


// ============================================================
// RAW REPLAY SCAN
// ============================================================

let demoPackets =
  0;


let packetsWithActiveCases =
  0;


let processedCaseSamples =
  0;


let maxActiveCases =
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


    demoPackets++;


    while (
      startPointer <
        starts.length
      &&
      starts[
        startPointer
      ].startTick <=
        tick
    ) {

      const start =
        starts[
          startPointer
        ];


      const row =
        cases[
          start.caseIndex
        ];


      if (
        row.observationEndTick >=
        tick
      ) {

        activeCaseIndexes.add(
          start.caseIndex
        );
      }


      startPointer++;
    }


    for (
      const caseIndex
      of [
        ...activeCaseIndexes
      ]
    ) {

      if (
        cases[
          caseIndex
        ].observationEndTick <
        tick
      ) {

        activeCaseIndexes.delete(
          caseIndex
        );
      }
    }


    if (
      activeCaseIndexes.size ===
      0
    ) {

      return;
    }


    packetsWithActiveCases++;


    maxActiveCases =
      Math.max(
        maxActiveCases,
        activeCaseIndexes.size
      );


    const demo =
      parser.getDemo();


    const soulEntities =
      demo.getEntitiesByClassName(
        'CCitadel_Pickup_AssignedGold'
      )
      ??
      [];


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


    const controllerEntities =
      demo.getEntitiesByClassName(
        'CCitadelPlayerController'
      )
      ??
      [];


    const playersByTeam =
      new Map();


    const playerNameByPawnIndex =
      new Map();


    for (
      const controller
      of controllerEntities
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


      const alive =
        booleanOrNull(
          safeGetField(
            controller,
            'm_bAlive'
          )
        );


      let pawnHandle =
        safeGetField(
          controller,
          'm_hHeroPawn'
        );


      if (
        isInvalidHandle(
          pawnHandle
        )
      ) {

        pawnHandle =
          safeGetField(
            controller,
            'm_hPawn'
          );
      }


      let pawn =
        null;


      if (
        !isInvalidHandle(
          pawnHandle
        )
      ) {

        try {

          pawn =
            demo.getEntityByHandle(
              pawnHandle
            );

        } catch {

          pawn =
            null;
        }
      }


      if (
        !pawn
      ) {

        continue;
      }


      const pawnEntityIndex =
        getEntityIndex(
          pawn
        );


      const lifeState =
        finite(
          safeGetField(
            pawn,
            'm_lifeState'
          )
        );


      const position =
        getWorldPositionDetailed(
          pawn
        );


      if (
        pawnEntityIndex !==
        null
      ) {

        playerNameByPawnIndex.set(

          pawnEntityIndex,

          String(
            playerName
          )
        );
      }


      const eligibleLivingPawn =
        team !==
          null
        &&
        alive ===
          true
        &&
        lifeState ===
          0
        &&
        position !==
          null;


      if (
        !eligibleLivingPawn
      ) {

        continue;
      }


      if (
        !playersByTeam.has(
          team
        )
      ) {

        playersByTeam.set(
          team,
          []
        );
      }


      playersByTeam
        .get(
          team
        )
        .push({

          playerName:
            String(
              playerName
            ),

          pawnEntityIndex,

          team,

          position
        });
    }


    for (
      const caseIndex
      of activeCaseIndexes
    ) {

      const row =
        cases[
          caseIndex
        ];


      if (
        tick <
          row.activationTick
        ||
        tick >
          row.observationEndTick
      ) {

        continue;
      }


      processedCaseSamples++;


      if (
        row
          .raw
          .firstObservedTick ===
        null
      ) {

        row
          .raw
          .firstObservedTick =
          tick;
      }


      row
        .raw
        .lastObservedTick =
        tick;


      const soul =
        soulByIndex.get(
          row.assignedGoldEntityIndex
        )
        ??
        null;


      if (
        !soul
      ) {

        continue;
      }


      const soulPosition =
        getWorldPositionDetailed(
          soul
        );


      const soulActive =
        booleanOrNull(
          safeGetField(
            soul,
            'm_bActive'
          )
        );


      if (
        soulActive ===
          true
        &&
        row
          .raw
          .firstSoulActiveTick ===
        null
      ) {

        row
          .raw
          .firstSoulActiveTick =
          tick;
      }


      if (
        soulActive ===
          false
        &&
        row
          .raw
          .firstSoulInactiveTick ===
        null
      ) {

        row
          .raw
          .firstSoulInactiveTick =
          tick;
      }


      const rawTargetHandle =
        handleOrNull(
          safeGetField(
            soul,
            'm_hVacuumTarget'
          )
        );


      const rawTargetPawnEntityIndex =
        decodeHandleEntityIndex(
          rawTargetHandle
        );


      if (
        rawTargetPawnEntityIndex !==
          null
        &&
        row
          .raw
          .rawTargetOnsetTick ===
        null
      ) {

        row
          .raw
          .rawTargetOnsetTick =
          tick;


        row
          .raw
          .rawTargetPawnEntityIndex =
          rawTargetPawnEntityIndex;


        row
          .raw
          .rawTargetPlayerName =
          playerNameByPawnIndex.get(
            rawTargetPawnEntityIndex
          )
          ??
          null;
      }


      if (
        !soulPosition
      ) {

        continue;
      }


      row
        .raw
        .soulPositionSamples++;


      // Once inactive, geometry is no longer treated as an
      // active pickup opportunity.

      if (
        soulActive ===
        false
      ) {

        continue;
      }


      const alliedPlayers =
        playersByTeam.get(
          row.creditedTeam
        )
        ??
        [];


      if (
        alliedPlayers.length ===
        0
      ) {

        continue;
      }


      let nearest =
        null;


      for (
        const player
        of alliedPlayers
      ) {

        const distanceXYValue =
          distanceXY(
            soulPosition,
            player.position
          );


        const distance3DValue =
          soulPosition.hasZ ===
            true
          &&
          player.position.hasZ ===
            true
            ? distance3D(
              soulPosition,
              player.position
            )
            : null;


        if (
          nearest ===
            null
          ||
          distanceXYValue <
            nearest.distanceXY
        ) {

          nearest = {

            playerName:
              player.playerName,

            pawnEntityIndex:
              player.pawnEntityIndex,

            distanceXY:
              distanceXYValue,

            distance3D:
              distance3DValue
          };
        }
      }


      if (
        !nearest
      ) {

        continue;
      }


      row
        .raw
        .allyGeometrySamples++;


      if (
        row
          .raw
          .minimumNearestAllyXY ===
          null
        ||
        nearest.distanceXY <
          row
            .raw
            .minimumNearestAllyXY
      ) {

        row
          .raw
          .minimumNearestAllyXY =
          nearest.distanceXY;


        row
          .raw
          .minimumNearestAlly3D =
          nearest.distance3D;


        row
          .raw
          .minimumNearestAllyTick =
          tick;


        row
          .raw
          .minimumNearestAllyPlayerName =
          nearest.playerName;


        row
          .raw
          .minimumNearestAllyPawnEntityIndex =
          nearest.pawnEntityIndex;
      }


      if (
        tick ===
        row.activationTick
      ) {

        row
          .raw
          .nearestAtActivationXY =
          nearest.distanceXY;


        row
          .raw
          .nearestAtActivationPlayerName =
          nearest.playerName;
      }


      if (
        row
          .raw
          .rawTargetOnsetTick !==
          null
        &&
        tick ===
          row
            .raw
            .rawTargetOnsetTick
      ) {

        row
          .raw
          .nearestAtRawTargetOnsetXY =
          nearest.distanceXY;


        row
          .raw
          .nearestAtRawTargetOnsetPlayerName =
          nearest.playerName;
      }


      for (
        const threshold
        of STANDARD_THRESHOLDS
      ) {

        const state =
          row
            .raw
            .thresholdStates[
              String(
                threshold
              )
            ];


        const insideNow =
          nearest.distanceXY <=
          threshold;


        if (
          tick ===
            row.activationTick
          &&
          state.insideAtActivation ===
            null
        ) {

          state.insideAtActivation =
            insideNow;
        }


        if (
          insideNow
          &&
          state.firstInsideTick ===
            null
        ) {

          state.firstInsideTick =
            tick;


          state.firstInsidePlayerName =
            nearest.playerName;


          state.firstInsidePawnEntityIndex =
            nearest.pawnEntityIndex;
        }


        if (
          insideNow
          &&
          state.previousInside ===
            false
        ) {

          state.lastEntryTick =
            tick;


          state.lastEntryPlayerName =
            nearest.playerName;
        }


        if (
          insideNow
          &&
          state.previousInside ===
            null
          &&
          tick >
            row.activationTick
        ) {

          state.lastEntryTick =
            tick;


          state.lastEntryPlayerName =
            nearest.playerName;
        }


        state.previousInside =
          insideNow;
      }
    }
  }
);


console.log('');

console.log(
  'Rescanning current-soul proximity to any living allied player...'
);

console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// FINALIZE CASES
// ============================================================

for (
  const row
  of cases
) {

  const hasExpectedTarget =
    row.expectedTargetOnsetType ===
    'NULL_TO_PLAYER_TARGET_TRANSITION';


  row.outcome =
    hasExpectedTarget
      ? 'PLAYER_TARGET_TRANSITION'
      : 'NO_PLAYER_TARGET';


  row.rawTargetMatchesExpectedTick =
    hasExpectedTarget
      ? row
          .raw
          .rawTargetOnsetTick ===
        row.expectedTargetOnsetTick

      : row
          .raw
          .rawTargetOnsetTick ===
        null;


  row.rawTargetMatchesExpectedPawn =
    hasExpectedTarget
      ? row
          .raw
          .rawTargetPawnEntityIndex ===
        row.expectedTargetPawnEntityIndex

      : row
          .raw
          .rawTargetPawnEntityIndex ===
        null;


  for (
    const threshold
    of STANDARD_THRESHOLDS
  ) {

    const state =
      row
        .raw
        .thresholdStates[
          String(
            threshold
          )
        ];


    state.firstInsideLagToTargetTicks =
      state.firstInsideTick !==
        null
      &&
      row
        .raw
        .rawTargetOnsetTick !==
        null
        ? row
            .raw
            .rawTargetOnsetTick -
          state.firstInsideTick

        : null;


    state.firstInsideLagToTargetSeconds =
      Number.isFinite(
        state.firstInsideLagToTargetTicks
      )
        ? state.firstInsideLagToTargetTicks /
          TICK_RATE
        : null;


    state.lastEntryLagToTargetTicks =
      state.lastEntryTick !==
        null
      &&
      row
        .raw
        .rawTargetOnsetTick !==
        null
        ? row
            .raw
            .rawTargetOnsetTick -
          state.lastEntryTick

        : null;


    state.lastEntryLagToTargetSeconds =
      Number.isFinite(
        state.lastEntryLagToTargetTicks
      )
        ? state.lastEntryLagToTargetTicks /
          TICK_RATE
        : null;
  }
}


// ============================================================
// COHORTS
// ============================================================

const targetCases =
  cases.filter(
    row =>
      row.outcome ===
      'PLAYER_TARGET_TRANSITION'
  );


const noTargetCases =
  cases.filter(
    row =>
      row.outcome ===
      'NO_PLAYER_TARGET'
  );


const targetRawConfirmed =
  targetCases.filter(
    row =>
      row.rawTargetMatchesExpectedTick
      &&
      row.rawTargetMatchesExpectedPawn
  );


const noTargetRawConfirmed =
  noTargetCases.filter(
    row =>
      row
        .raw
        .rawTargetOnsetTick ===
      null
  );


// ============================================================
// MINIMUM DISTANCE DISTRIBUTIONS
// ============================================================

const targetMinimumXY =
  values(
    targetCases,
    row =>
      row
        .raw
        .minimumNearestAllyXY
  );


const noTargetMinimumXY =
  values(
    noTargetCases,
    row =>
      row
        .raw
        .minimumNearestAllyXY
  );


const targetMinimum3D =
  values(
    targetCases,
    row =>
      row
        .raw
        .minimumNearestAlly3D
  );


const noTargetMinimum3D =
  values(
    noTargetCases,
    row =>
      row
        .raw
        .minimumNearestAlly3D
  );


// ============================================================
// THRESHOLD CLASSIFIER
//
// Positive:
//   player target transition observed.
//
// Prediction:
//   minimum nearest-allied-player distance to the current active
//   soul <= threshold before the outcome.
// ============================================================

const thresholdRowsXY =
  [];


for (
  let thresholdHU =
    SEARCH_MIN_HU;

  thresholdHU <=
    SEARCH_MAX_HU;

  thresholdHU +=
    SEARCH_STEP_HU
) {

  let tp =
    0;


  let fp =
    0;


  let tn =
    0;


  let fn =
    0;


  let unresolved =
    0;


  for (
    const row
    of cases
  ) {

    const minimum =
      finite(
        row
          .raw
          .minimumNearestAllyXY
      );


    if (
      minimum ===
      null
    ) {

      unresolved++;

      continue;
    }


    const actualPositive =
      row.outcome ===
      'PLAYER_TARGET_TRANSITION';


    const predictedPositive =
      minimum <=
      thresholdHU;


    if (
      actualPositive
      &&
      predictedPositive
    ) {

      tp++;

    } else if (
      !actualPositive
      &&
      predictedPositive
    ) {

      fp++;

    } else if (
      !actualPositive
      &&
      !predictedPositive
    ) {

      tn++;

    } else {

      fn++;
    }
  }


  const sensitivity =
    rate(
      tp,
      tp +
      fn
    );


  const specificity =
    rate(
      tn,
      tn +
      fp
    );


  const balancedAccuracy =
    Number.isFinite(
      sensitivity
    )
    &&
    Number.isFinite(
      specificity
    )
      ? (
        sensitivity +
        specificity
      ) /
      2

      : null;


  thresholdRowsXY.push({

    thresholdHU,

    thresholdMeters:
      thresholdHU /
      HU_PER_METER,

    tp,

    fp,

    tn,

    fn,

    unresolved,

    sensitivity,

    specificity,

    balancedAccuracy,

    accuracy:
      rate(
        tp +
        tn,
        tp +
        fp +
        tn +
        fn
      ),

    mcc:
      matthewsCorrelation({
        tp,
        fp,
        tn,
        fn
      })
  });
}


const bestMCCXY =
  selectBest(
    thresholdRowsXY,
    'mcc'
  );


const bestBalancedXY =
  selectBest(
    thresholdRowsXY,
    'balancedAccuracy'
  );


const standardRowsXY =
  STANDARD_THRESHOLDS
    .map(
      threshold =>
        thresholdRowsXY.find(
          row =>
            row.thresholdHU ===
            threshold
        )
    )
    .filter(
      Boolean
    );


// ============================================================
// STANDARD THRESHOLD TIMING SUMMARIES
// ============================================================

const standardTiming =
  {};


for (
  const threshold
  of STANDARD_THRESHOLDS
) {

  const key =
    String(
      threshold
    );


  const targetInside =
    targetCases.filter(
      row =>
        row
          .raw
          .thresholdStates[
            key
          ]
          .firstInsideTick !==
        null
    );


  const noTargetInside =
    noTargetCases.filter(
      row =>
        row
          .raw
          .thresholdStates[
            key
          ]
          .firstInsideTick !==
        null
    );


  const firstLags =
    values(
      targetInside,
      row =>
        row
          .raw
          .thresholdStates[
            key
          ]
          .firstInsideLagToTargetSeconds
    );


  const lastEntryLags =
    values(
      targetInside,
      row =>
        row
          .raw
          .thresholdStates[
            key
          ]
          .lastEntryLagToTargetSeconds
    );


  standardTiming[
    key
  ] = {

    thresholdHU:
      threshold,

    thresholdMeters:
      threshold /
      HU_PER_METER,

    targetCases:
      targetCases.length,

    targetEverInside:
      targetInside.length,

    targetEverInsideRate:
      rate(
        targetInside.length,
        targetCases.length
      ),

    noTargetCases:
      noTargetCases.length,

    noTargetEverInside:
      noTargetInside.length,

    noTargetEverInsideRate:
      rate(
        noTargetInside.length,
        noTargetCases.length
      ),

    firstInsideLagToTargetSeconds:
      summarizeNumbers(
        firstLags
      ),

    lastEntryLagToTargetSeconds:
      summarizeNumbers(
        lastEntryLags
      ),

    targetWithin1TickOfFirstInside:
      targetInside.filter(
        row => {

          const lag =
            row
              .raw
              .thresholdStates[
                key
              ]
              .firstInsideLagToTargetTicks;


          return (
            Number.isFinite(
              lag
            )
            &&
            lag >=
              0
            &&
            lag <=
              1
          );
        }
      ).length,

    targetWithin4TicksOfFirstInside:
      targetInside.filter(
        row => {

          const lag =
            row
              .raw
              .thresholdStates[
                key
              ]
              .firstInsideLagToTargetTicks;


          return (
            Number.isFinite(
              lag
            )
            &&
            lag >=
              0
            &&
            lag <=
              4
          );
        }
      ).length,

    targetWithin16TicksOfFirstInside:
      targetInside.filter(
        row => {

          const lag =
            row
              .raw
              .thresholdStates[
                key
              ]
              .firstInsideLagToTargetTicks;


          return (
            Number.isFinite(
              lag
            )
            &&
            lag >=
              0
            &&
            lag <=
              16
          );
        }
      ).length,

    targetWithin32TicksOfFirstInside:
      targetInside.filter(
        row => {

          const lag =
            row
              .raw
              .thresholdStates[
                key
              ]
              .firstInsideLagToTargetTicks;


          return (
            Number.isFinite(
              lag
            )
            &&
            lag >=
              0
            &&
            lag <=
              32
          );
        }
      ).length
  };
}


// ============================================================
// 735-HU DECISIVE CASE SETS
// ============================================================

const key735 =
  String(
    735
  );


const targetNeverInside735 =
  targetCases.filter(
    row =>
      row
        .raw
        .thresholdStates[
          key735
        ]
        .firstInsideTick ===
      null
  );


const noTargetEverInside735 =
  noTargetCases.filter(
    row =>
      row
        .raw
        .thresholdStates[
          key735
        ]
        .firstInsideTick !==
      null
  );


const targetInside735 =
  targetCases.filter(
    row =>
      row
        .raw
        .thresholdStates[
          key735
        ]
        .firstInsideTick !==
      null
  );


const targetInside735SamePlayerAsVacuumTarget =
  targetInside735.filter(
    row => {

      const firstPawn =
        row
          .raw
          .thresholdStates[
            key735
          ]
          .firstInsidePawnEntityIndex;


      return (
        firstPawn !==
          null
        &&
        firstPawn ===
          row
            .raw
            .rawTargetPawnEntityIndex
      );
    }
  );


// ============================================================
// LIFECYCLE BAND SUMMARIES AT 735
// ============================================================

const lifecycle735 =
  {};


for (
  const band
  of [
    'TARGET_IMMEDIATE_LE_0_25',
    'TARGET_EARLY_GT_0_25_LT_1',
    'TARGET_STABLE_GE_1',
    'NO_PLAYER_TARGET'
  ]
) {

  const rows =
    cases.filter(
      row =>
        row.lifecycleBand ===
        band
    );


  const inside =
    rows.filter(
      row =>
        row
          .raw
          .thresholdStates[
            key735
          ]
          .firstInsideTick !==
        null
    );


  lifecycle735[
    band
  ] = {

    total:
      rows.length,

    everInside735:
      inside.length,

    everInside735Rate:
      rate(
        inside.length,
        rows.length
      ),

    minimumNearestAllyXY:
      summarizeNumbers(
        values(
          rows,
          row =>
            row
              .raw
              .minimumNearestAllyXY
        )
      ),

    firstInsideLagToTargetSeconds:
      summarizeNumbers(
        values(
          inside,
          row =>
            row
              .raw
              .thresholdStates[
                key735
              ]
              .firstInsideLagToTargetSeconds
        )
      )
  };
}


// ============================================================
// COVERAGE / VALIDATION
// ============================================================

const soulPositionCoverage =
  cases.filter(
    row =>
      row
        .raw
        .soulPositionSamples >
      0
  );


const allyGeometryCoverage =
  cases.filter(
    row =>
      row
        .raw
        .allyGeometrySamples >
      0
  );


const validationChecks = {

  script83Passed:
    check(
      summary83
        ?.validation
        ?.pass,
      true,
      summary83
        ?.validation
        ?.pass ===
      true
    ),


  cleanCaseCount:
    check(
      cases.length,
      replayName ===
        'test'
        ? 991
        : '>0',
      replayName ===
        'test'
        ? cases.length ===
          991
        : cases.length >
          0
    ),


  targetTransitionCount:
    check(
      targetCases.length,
      replayName ===
        'test'
        ? 947
        : '>0',
      replayName ===
        'test'
        ? targetCases.length ===
          947
        : targetCases.length >
          0
    ),


  noTargetCount:
    check(
      noTargetCases.length,
      replayName ===
        'test'
        ? 44
        : '>=0',
      replayName ===
        'test'
        ? noTargetCases.length ===
          44
        : noTargetCases.length >=
          0
    ),


  soulPositionCoverage:
    check(
      soulPositionCoverage.length,
      '>=99% of clean cases',
      rate(
        soulPositionCoverage.length,
        cases.length
      ) >=
      0.99
    ),


  allyGeometryCoverage:
    check(
      allyGeometryCoverage.length,
      '>=99% of clean cases',
      rate(
        allyGeometryCoverage.length,
        cases.length
      ) >=
      0.99
    ),


  rawTargetTransitionReplication:
    check(
      targetRawConfirmed.length,
      '>=99% of target cases',
      rate(
        targetRawConfirmed.length,
        targetCases.length
      ) >=
      0.99
    ),


  rawNoTargetReplication:
    check(
      noTargetRawConfirmed.length,
      noTargetCases.length,
      noTargetRawConfirmed.length ===
      noTargetCases.length
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
    'ASSIGNED_GOLD_UNIFIED_PROXIMITY_TRIGGER_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'UNIFIED_CURRENT_SOUL_TEAM_PROXIMITY_AUDIT_READY'
      : 'PIPELINE_VALIDATION_FAILURE',


  purpose: [

    'Test whether player-target acquisition is associated with any living allied pawn entering a common proximity region around the current active AssignedGold entity.',

    'Measure proximity continuously from AssignedGold activation through target acquisition or no-target lifecycle termination.',

    'Test both target-case necessity and no-target-case specificity for the candidate ~735-HU envelope.',

    'Compare the empirical threshold with the independent stable-floor and exact death-team geometry findings.'
  ],


  semanticLimits: {

    targetField:
      'm_hVacuumTarget remains observed downstream telemetry. Entering proximity before target assignment does not prove the field itself is the engine trigger.',

    eligibleAlly:
      'Eligible allied players are operationally controller alive=true, pawn lifeState=0, same team as the clean credited player, and valid raw pawn position.',

    currentSoul:
      'Distance is measured to the current raw AssignedGold entity position while the soul is not observed active=false.',

    threshold:
      'A high-performing empirical threshold is not automatically an engine-documented collision radius.',

    meters:
      'Meter equivalents use 39.37 HU per meter as the working conversion and should remain secondary to HU.'
  },


  sourceCounts: {

    cleanCases:
      cases.length,

    targetTransitions:
      targetCases.length,

    noTarget:
      noTargetCases.length,

    demoPackets,

    packetsWithActiveCases,

    processedCaseSamples,

    maxActiveCases,

    casesWithSoulPosition:
      soulPositionCoverage.length,

    casesWithAlliedGeometry:
      allyGeometryCoverage.length,

    rawTargetTransitionsConfirmed:
      targetRawConfirmed.length,

    rawNoTargetConfirmed:
      noTargetRawConfirmed.length
  },


  minimumNearestAlliedDistance: {

    targetCasesXY:
      summarizeNumbers(
        targetMinimumXY
      ),

    noTargetCasesXY:
      summarizeNumbers(
        noTargetMinimumXY
      ),

    targetCases3D:
      summarizeNumbers(
        targetMinimum3D
      ),

    noTargetCases3D:
      summarizeNumbers(
        noTargetMinimum3D
      )
  },


  thresholdSearchXY: {

    searchMinHU:
      SEARCH_MIN_HU,

    searchMaxHU:
      SEARCH_MAX_HU,

    stepHU:
      SEARCH_STEP_HU,

    bestMCC:
      bestMCCXY,

    bestBalancedAccuracy:
      bestBalancedXY,

    standardThresholds:
      standardRowsXY,

    allThresholds:
      thresholdRowsXY
  },


  standardThresholdTiming:
    standardTiming,


  candidate735: {

    targetCases:
      targetCases.length,

    targetEverInside735:
      targetInside735.length,

    targetEverInside735Rate:
      rate(
        targetInside735.length,
        targetCases.length
      ),

    noTargetCases:
      noTargetCases.length,

    noTargetEverInside735:
      noTargetEverInside735.length,

    noTargetEverInside735Rate:
      rate(
        noTargetEverInside735.length,
        noTargetCases.length
      ),

    targetNeverInside735:
      targetNeverInside735.length,

    firstInsidePlayerIsFinalVacuumTarget:
      targetInside735SamePlayerAsVacuumTarget.length,

    firstInsidePlayerIsFinalVacuumTargetRate:
      rate(
        targetInside735SamePlayerAsVacuumTarget.length,
        targetInside735.length
      ),

    lifecycleBands:
      lifecycle735,

    targetNeverInside735Cases:
      targetNeverInside735.map(
        compactCase
      ),

    noTargetEverInside735Cases:
      noTargetEverInside735.map(
        compactCase
      )
  },


  interpretationGuide: {

    unifiedSupport:
      'Strong support would consist of nearly all target-transition episodes entering the same narrow current-soul allied-proximity envelope while nearly all no-target episodes remain outside it.',

    commonScale:
      'A best threshold near the independently observed stable-floor ~735-HU envelope would support one common team-level proximity scale across initial and delayed vacuum states.',

    targetIdentity:
      'The player first entering the envelope need not always equal m_hVacuumTarget if target selection and proximity eligibility are distinct operations.',

    contradictions:
      'Target episodes never entering the threshold and no-target episodes entering it are the most important cases for subsequent diagnosis.',

    next:
      'If the unified proximity audit is clean, freeze the single-replay proximity mechanic as strongly supported and move to targetless lifetime/expiration structure before cross-replay replication.'
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
  'ASSIGNED GOLD UNIFIED PROXIMITY TRIGGER V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'RAW LIFECYCLE COVERAGE'
);

console.log(
  '----------------------'
);


console.log(
  `Clean cases:                ${cases.length}`
);


console.log(
  `Target-transition cases:    ${targetCases.length}`
);


console.log(
  `No-target cases:            ${noTargetCases.length}`
);


console.log(
  `Cases with soul position:   ${soulPositionCoverage.length}/${cases.length}`
);


console.log(
  `Cases with allied geometry: ${allyGeometryCoverage.length}/${cases.length}`
);


console.log(
  `Raw targets confirmed:      ${targetRawConfirmed.length}/${targetCases.length}`
);


console.log(
  `Raw no-target confirmed:    ${noTargetRawConfirmed.length}/${noTargetCases.length}`
);


console.log('');

console.log(
  'MINIMUM CURRENT-SOUL -> NEAREST ALLY DISTANCE'
);

console.log(
  '----------------------------------------------'
);


console.log(
  `Target cases XY:    ${formatDistribution(
    summarizeNumbers(
      targetMinimumXY
    )
  )}`
);


console.log(
  `No-target cases XY: ${formatDistribution(
    summarizeNumbers(
      noTargetMinimumXY
    )
  )}`
);


console.log('');

console.log(
  'TARGET VS NO-TARGET THRESHOLD SEARCH — XY'
);

console.log(
  '-----------------------------------------'
);


console.log(
  `Best MCC:      ${formatClassifierRow(bestMCCXY)}`
);


console.log(
  `Best balanced: ${formatClassifierRow(bestBalancedXY)}`
);


console.log('');

console.log(
  'STANDARD THRESHOLDS — UNIFIED XY'
);

console.log(
  '--------------------------------'
);


for (
  const row
  of standardRowsXY
) {

  console.log(
    formatClassifierRow(
      row
    )
  );
}


console.log('');

console.log(
  'STANDARD THRESHOLD TIMING'
);

console.log(
  '-------------------------'
);


for (
  const threshold
  of STANDARD_THRESHOLDS
) {

  const row =
    standardTiming[
      String(
        threshold
      )
    ];


  console.log(

    `${String(threshold).padStart(4)} HU ` +

    `targetInside=${String(row.targetEverInside).padStart(3)}/${row.targetCases} ` +

    `noTargetInside=${String(row.noTargetEverInside).padStart(2)}/${row.noTargetCases} ` +

    `firstLagMed=${formatNumber(row.firstInsideLagToTargetSeconds.median).padStart(6)}s ` +

    `lastEntryLagMed=${formatNumber(row.lastEntryLagToTargetSeconds.median).padStart(6)}s`
  );
}


console.log('');

console.log(
  '735-HU UNIFIED AUDIT'
);

console.log(
  '--------------------'
);


console.log(
  `Target cases ever <=735:    ${targetInside735.length}/${targetCases.length} = ${formatPercent(rate(targetInside735.length, targetCases.length))}`
);


console.log(
  `Target cases never <=735:   ${targetNeverInside735.length}`
);


console.log(
  `No-target cases ever <=735: ${noTargetEverInside735.length}/${noTargetCases.length} = ${formatPercent(rate(noTargetEverInside735.length, noTargetCases.length))}`
);


console.log(
  `First <=735 player = final target: ${targetInside735SamePlayerAsVacuumTarget.length}/${targetInside735.length} = ${formatPercent(rate(targetInside735SamePlayerAsVacuumTarget.length, targetInside735.length))}`
);


console.log('');

console.log(
  '735 BY LIFECYCLE BAND'
);

console.log(
  '---------------------'
);


for (
  const [
    band,
    row
  ]
  of Object.entries(
    lifecycle735
  )
) {

  console.log(

    `${band.padEnd(30)} ` +

    `n=${String(row.total).padStart(3)} ` +

    `inside=${String(row.everInside735).padStart(3)} ` +

    `${formatPercent(row.everInside735Rate)} ` +

    `minXY=${formatDistribution(row.minimumNearestAllyXY)}`
  );
}


console.log('');

console.log(
  'TARGET CASES NEVER <=735'
);

console.log(
  '------------------------'
);


if (
  targetNeverInside735.length ===
  0
) {

  console.log(
    'None.'
  );

} else {

  for (
    const row
    of targetNeverInside735.slice(
      0,
      30
    )
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)}  ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `band=${String(row.lifecycleBand).padEnd(28)} ` +

      `minXY=${formatNumber(row.raw.minimumNearestAllyXY).padStart(9)} ` +

      `targetTick=${row.raw.rawTargetOnsetTick ?? 'n/a'}`
    );
  }
}


console.log('');

console.log(
  'NO-TARGET CASES EVER <=735'
);

console.log(
  '--------------------------'
);


if (
  noTargetEverInside735.length ===
  0
) {

  console.log(
    'None.'
  );

} else {

  for (
    const row
    of noTargetEverInside735.slice(
      0,
      30
    )
  ) {

    const state =
      row
        .raw
        .thresholdStates[
          key735
        ];


    console.log(

      `${String(row.deathIndex).padStart(4)}  ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `minXY=${formatNumber(row.raw.minimumNearestAllyXY).padStart(9)} ` +

      `first735=${state.firstInsideTick ?? 'n/a'} ` +

      `end=${row.observationEndTick}`
    );
  }
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

    `${name.padEnd(40)} ` +

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
// COMPACT CASE
// ============================================================

function compactCase(
  row
) {

  const thresholdStates =
    {};


  for (
    const threshold
    of STANDARD_THRESHOLDS
  ) {

    const source =
      row
        .raw
        .thresholdStates[
          String(
            threshold
          )
        ];


    thresholdStates[
      String(
        threshold
      )
    ] = {

      firstInsideTick:
        source.firstInsideTick,

      firstInsidePlayerName:
        source.firstInsidePlayerName,

      firstInsidePawnEntityIndex:
        source.firstInsidePawnEntityIndex,

      lastEntryTick:
        source.lastEntryTick,

      lastEntryPlayerName:
        source.lastEntryPlayerName,

      insideAtActivation:
        source.insideAtActivation,

      firstInsideLagToTargetTicks:
        source.firstInsideLagToTargetTicks,

      firstInsideLagToTargetSeconds:
        source.firstInsideLagToTargetSeconds,

      lastEntryLagToTargetTicks:
        source.lastEntryLagToTargetTicks,

      lastEntryLagToTargetSeconds:
        source.lastEntryLagToTargetSeconds
    };
  }


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

    creditedTeam:
      row.creditedTeam,

    assignedGoldEntityIndex:
      row.assignedGoldEntityIndex,

    activationTick:
      row.activationTick,

    observationEndTick:
      row.observationEndTick,

    lifecycleBand:
      row.lifecycleBand,

    outcome:
      row.outcome,

    targetDelaySeconds:
      row.targetDelaySeconds,

    expectedTargetOnsetTick:
      row.expectedTargetOnsetTick,

    expectedTargetPawnEntityIndex:
      row.expectedTargetPawnEntityIndex,

    expectedTargetPlayerName:
      row.expectedTargetPlayerName,

    rawTargetOnsetTick:
      row
        .raw
        .rawTargetOnsetTick,

    rawTargetPawnEntityIndex:
      row
        .raw
        .rawTargetPawnEntityIndex,

    rawTargetPlayerName:
      row
        .raw
        .rawTargetPlayerName,

    rawTargetMatchesExpectedTick:
      row.rawTargetMatchesExpectedTick,

    rawTargetMatchesExpectedPawn:
      row.rawTargetMatchesExpectedPawn,

    firstObservedTick:
      row
        .raw
        .firstObservedTick,

    lastObservedTick:
      row
        .raw
        .lastObservedTick,

    soulPositionSamples:
      row
        .raw
        .soulPositionSamples,

    allyGeometrySamples:
      row
        .raw
        .allyGeometrySamples,

    minimumNearestAllyXY:
      row
        .raw
        .minimumNearestAllyXY,

    minimumNearestAlly3D:
      row
        .raw
        .minimumNearestAlly3D,

    minimumNearestAllyTick:
      row
        .raw
        .minimumNearestAllyTick,

    minimumNearestAllyPlayerName:
      row
        .raw
        .minimumNearestAllyPlayerName,

    minimumNearestAllyPawnEntityIndex:
      row
        .raw
        .minimumNearestAllyPawnEntityIndex,

    nearestAtActivationXY:
      row
        .raw
        .nearestAtActivationXY,

    nearestAtActivationPlayerName:
      row
        .raw
        .nearestAtActivationPlayerName,

    nearestAtRawTargetOnsetXY:
      row
        .raw
        .nearestAtRawTargetOnsetXY,

    nearestAtRawTargetOnsetPlayerName:
      row
        .raw
        .nearestAtRawTargetOnsetPlayerName,

    thresholdStates
  };
}


// ============================================================
// LIFECYCLE BAND
// ============================================================

function classifyLifecycleBand(
  onsetType,
  delaySeconds
) {

  if (
    onsetType ===
    'NO_PLAYER_TARGET_OBSERVED'
  ) {

    return 'NO_PLAYER_TARGET';
  }


  if (
    onsetType !==
    'NULL_TO_PLAYER_TARGET_TRANSITION'
  ) {

    return 'OTHER_TARGET_STATE';
  }


  if (
    !Number.isFinite(
      delaySeconds
    )
  ) {

    return 'OTHER_TARGET_STATE';
  }


  if (
    delaySeconds <=
    0.25
  ) {

    return 'TARGET_IMMEDIATE_LE_0_25';
  }


  if (
    delaySeconds <
    1.0
  ) {

    return 'TARGET_EARLY_GT_0_25_LT_1';
  }


  return 'TARGET_STABLE_GE_1';
}


// ============================================================
// ENTITY / RAW POSITION HELPERS
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


function isInvalidHandle(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return true;
  }


  try {

    const parsed =
      BigInt(
        value
      );


    return (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    );

  } catch {

    return true;
  }
}


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
// THRESHOLD CLASSIFIER
// ============================================================

function matthewsCorrelation({
  tp,
  fp,
  tn,
  fn
}) {

  const numerator =
    tp *
      tn
    -
    fp *
      fn;


  const denominator =
    Math.sqrt(
      (
        tp +
        fp
      )
      *
      (
        tp +
        fn
      )
      *
      (
        tn +
        fp
      )
      *
      (
        tn +
        fn
      )
    );


  if (
    denominator ===
    0
  ) {

    return null;
  }


  return numerator /
    denominator;
}


function selectBest(
  rows,
  metric
) {

  return rows
    .filter(
      row =>
        Number.isFinite(
          row?.[metric]
        )
    )
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b[metric] -
          a[metric]
        ||
        (
          b.balancedAccuracy ??
          -Infinity
        )
        -
        (
          a.balancedAccuracy ??
          -Infinity
        )
        ||
        a.thresholdHU -
          b.thresholdHU
    )[0]
    ??
    null;
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
  source
) {

  for (
    const value
    of source
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


  return (

    sorted[
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
    weight
  );
}


// ============================================================
// VALIDATION / FORMAT
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


function formatClassifierRow(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (

    `${formatNumber(row.thresholdHU)} HU ` +

    `(${row.thresholdMeters.toFixed(2)}m) ` +

    `TP=${row.tp} ` +

    `FP=${row.fp} ` +

    `TN=${row.tn} ` +

    `FN=${row.fn} ` +

    `sens=${formatPercent(row.sensitivity)} ` +

    `spec=${formatPercent(row.specificity)} ` +

    `bal=${formatPercent(row.balancedAccuracy)} ` +

    `MCC=${formatNumber(row.mcc)}`
  );
}