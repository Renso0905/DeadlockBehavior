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


const TICK_RATE =
  64;


const ENTITY_INDEX_MASK =
  0x3fff;


const EXPIRATION_REFERENCE_SECONDS =
  40;


const EXPIRATION_TOLERANCE_SECONDS =
  0.05;


const PROXIMITY_ASSOCIATED_TERMINATION_SECONDS =
  1.0;


const STANDARD_THRESHOLDS = [
  732,
  735,
  768
];


const CANDIDATE_GLOBAL_PERIODS_SECONDS = [
  5,
  10,
  15,
  20,
  30,
  40,
  60
];


// ============================================================
// PURPOSE
//
// Script 84 strongly supported a unified allied-player proximity
// association with m_hVacuumTarget acquisition.
//
// Remaining unresolved cohort:
//
//   44 clean AssignedGold episodes
//   with no player m_hVacuumTarget.
//
// Prior evidence:
//
//   - 43/44 observed active=false
//   - 33 of those were approximately 40 seconds
//   - ~10 active-false episodes had shorter/non-40 lifetimes
//   - 5/44 entered <=735 HU XY despite no target
//
// Script 85 asks:
//
//   1. Is ~40 s a genuine dominant targetless timeout signature?
//
//   2. What explains shorter targetless terminations?
//
//      - pooled entity reuse?
//      - common/global cleanup timing?
//      - proximity-associated termination without target field?
//      - Trooper/variant grouping?
//      - late-game grouping?
//
//   3. Can the five <=735-HU no-target cases be explained by:
//
//      - m_bInteractive != true at proximity entry?
//      - large vertical separation?
//      - only momentary proximity?
//      - termination immediately after proximity?
//
// IMPORTANT:
//
//   This diagnostic does NOT declare any targetless termination
//   to be canonical "expiration" merely because it occurs near
//   40 seconds.
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


const summary84Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_unified_proximity_trigger_validation_v01.json'
  );


const cases84Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_unified_proximity_trigger_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_expiration_diagnostic_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_expiration_cases_v01.jsonl'
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
    summary84Path,
    cases84Path
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
// SCRIPT 84 SUMMARY
// ============================================================

const summary84 =
  JSON.parse(
    readFileSync(
      summary84Path,
      'utf8'
    )
  );


if (
  summary84
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 84 did not PASS.'
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


const activationsByEntity =
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


  const entityIndex =
    finite(
      row
        ?.assignedGold
        ?.entityIndex
    );


  const activationTick =
    finite(
      row
        ?.assignedGold
        ?.activationTick
    );


  if (
    entityIndex ===
      null
    ||
    activationTick ===
      null
  ) {

    continue;
  }


  if (
    !activationsByEntity.has(
      entityIndex
    )
  ) {

    activationsByEntity.set(
      entityIndex,
      []
    );
  }


  activationsByEntity
    .get(
      entityIndex
    )
    .push({

      deathIndex,

      activationTick
    });
}


for (
  const rows
  of activationsByEntity.values()
) {

  rows.sort(
    (
      a,
      b
    ) =>
      a.activationTick -
      b.activationTick
  );
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


const episode76ByDeathIndex =
  new Map();


for (
  const row
  of episodes76
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex !==
    null
  ) {

    episode76ByDeathIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// LOAD SCRIPT 84
// ============================================================

console.log(
  'Loading Script 84 unified-proximity cases...'
);


const cases84 =
  await loadJsonl(
    cases84Path
  );


console.log(
  `Script 84 cases: ${cases84.length}`
);


// ============================================================
// TARGETLESS COHORT
// ============================================================

const targetless84 =
  cases84.filter(
    row =>
      row?.outcome ===
      'NO_PLAYER_TARGET'
  );


console.log(
  `Targetless Script 84 cases: ${targetless84.length}`
);


// ============================================================
// BUILD TARGETLESS CASES
// ============================================================

const cases =
  [];


for (
  const source84
  of targetless84
) {

  const deathIndex =
    finite(
      source84?.deathIndex
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


  const source76 =
    episode76ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  if (
    !source75
    ||
    !source76
  ) {

    continue;
  }


  const entityIndex =
    firstFinite([
      source84
        ?.assignedGoldEntityIndex,

      source75
        ?.assignedGold
        ?.entityIndex,

      source76
        ?.assignedGold
        ?.entityIndex
    ]);


  const activationTick =
    firstFinite([
      source84
        ?.activationTick,

      source75
        ?.assignedGold
        ?.activationTick,

      source76
        ?.assignedGold
        ?.activationTick
    ]);


  const script76InactiveTick =
    finite(
      source76
        ?.termination
        ?.activeFalseTick
    );


  const script75EndTick =
    finite(
      source75
        ?.script55Lifecycle
        ?.endTick
    );


  const observationEndTick =
    firstFinite([
      source84
        ?.observationEndTick,

      script76InactiveTick,

      script75EndTick
    ]);


  const creditedTeam =
    firstFinite([
      source84
        ?.creditedTeam,

      source76
        ?.creditedPlayer
        ?.team,

      source75
        ?.creditedPlayer
        ?.team
    ]);


  if (
    entityIndex ===
      null
    ||
    activationTick ===
      null
    ||
    observationEndTick ===
      null
    ||
    creditedTeam ===
      null
  ) {

    continue;
  }


  const nextActivation =
    findNextActivation(
      entityIndex,
      activationTick
    );


  const threshold735 =
    source84
      ?.thresholdStates
      ?.['735']
    ??
    {};


  cases.push({

    caseIndex:
      cases.length,

    deathIndex,

    clock:
      source84?.clock ??
      source75
        ?.death
        ?.clock ??
      null,

    deathTimeSeconds:
      finite(
        source75
          ?.death
          ?.timeSeconds
      ),

    baseType:
      source84?.baseType ??
      source75
        ?.death
        ?.baseType ??
      null,

    variantLabel:
      source75
        ?.death
        ?.variantLabel ??
      null,

    creditedPlayerName:
      source84
        ?.creditedPlayerName ??
      source76
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedTeam,

    entityIndex,

    activationTick,

    observationEndTick,

    script75: {

      endTick:
        script75EndTick,

      durationSeconds:
        finite(
          source75
            ?.script55Lifecycle
            ?.durationSeconds
        ),

      endReason:
        source75
          ?.script55Lifecycle
          ?.endReason ??
        null,

      rawEndWindowSource:
        source75
          ?.script55Lifecycle
          ?.rawEndWindowSource ??
        null,

      firstInteractiveTick:
        finite(
          source75
            ?.script55Lifecycle
            ?.firstInteractiveTick
        )
    },

    script76: {

      activeFalseObserved:
        source76
          ?.termination
          ?.activeFalseObserved ===
        true,

      activeFalseTick:
        script76InactiveTick,

      durationSeconds:
        finite(
          source76
            ?.termination
            ?.durationSeconds
        ),

      endReason:
        source76
          ?.termination
          ?.endReason ??
        null,

      near40Seconds:
        source76
          ?.termination
          ?.near40Seconds ??
        null,

      lifecycleClassification:
        source76
          ?.lifecycleClassification ??
        null
    },

    script84: {

      minimumNearestAllyXY:
        finite(
          source84
            ?.minimumNearestAllyXY
        ),

      minimumNearestAlly3D:
        finite(
          source84
            ?.minimumNearestAlly3D
        ),

      firstInside735Tick:
        finite(
          threshold735
            ?.firstInsideTick
        ),

      firstInside735PlayerName:
        threshold735
          ?.firstInsidePlayerName ??
        null,

      everInside735:
        finite(
          threshold735
            ?.firstInsideTick
        ) !==
        null
    },

    nextActivation: {

      deathIndex:
        nextActivation
          ?.deathIndex ??
        null,

      tick:
        nextActivation
          ?.activationTick ??
        null,

      secondsAfterActivation:
        nextActivation
          ? (
            nextActivation.activationTick -
            activationTick
          ) /
          TICK_RATE
          : null,

      secondsAfterScript76Inactive:
        nextActivation
        &&
        script76InactiveTick !==
          null
          ? (
            nextActivation.activationTick -
            script76InactiveTick
          ) /
          TICK_RATE
          : null
    },

    raw: {

      firstObservedTick:
        null,

      lastObservedTick:
        null,

      soulSamples:
        0,

      activeTrueSamples:
        0,

      activeFalseSamples:
        0,

      interactiveTrueSamples:
        0,

      interactiveFalseSamples:
        0,

      interactiveNullSamples:
        0,

      firstActiveTrueTick:
        null,

      lastActiveTrueTick:
        null,

      firstActiveFalseTick:
        null,

      firstInteractiveTrueTick:
        null,

      lastInteractiveTrueTick:
        null,

      firstInteractiveFalseTick:
        null,

      firstTargetTick:
        null,

      firstTargetPawnEntityIndex:
        null,

      firstMissingTickAfterObserved:
        null,

      minimumNearestAllyXY:
        null,

      minimumNearestAllyXYTick:
        null,

      minimumNearestAllyPlayerName:
        null,

      minimumNearestAlly3DAtMinXY:
        null,

      minimumVerticalDeltaAtMinXY:
        null,

      interactiveAtMinXY:
        null,

      minimumNearestAlly3D:
        null,

      minimumNearestAlly3DTick:
        null,

      minimumNearestAllyXYAtMin3D:
        null,

      minimumInteractiveNearestAllyXY:
        null,

      minimumInteractiveNearestAllyXYTick:
        null,

      minimumInteractiveNearestAllyPlayerName:
        null,

      minimumInteractiveNearestAlly3DAtMinXY:
        null,

      minimumInteractiveVerticalDeltaAtMinXY:
        null,

      thresholdStates:
        Object.fromEntries(

          STANDARD_THRESHOLDS.map(
            threshold => [

              String(
                threshold
              ),

              {

                firstInsideAnyTick:
                  null,

                lastInsideAnyTick:
                  null,

                insideAnySamples:
                  0,

                firstInsideInteractiveTick:
                  null,

                lastInsideInteractiveTick:
                  null,

                insideInteractiveSamples:
                  0,

                firstInsideInteractivePlayerName:
                  null
              }
            ]
          )
        )
    },

    derived:
      null
  });
}


// ============================================================
// NEXT ACTIVATION LOOKUP
// ============================================================

function findNextActivation(
  entityIndex,
  activationTick
) {

  const rows =
    activationsByEntity.get(
      entityIndex
    )
    ??
    [];


  return rows.find(
    row =>
      row.activationTick >
      activationTick
  )
  ??
  null;
}


// ============================================================
// ACTIVE INTERVAL SWEEP
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
// RAW REPLAY RESCAN
// ============================================================

let demoPackets =
  0;


let packetsWithTargetlessCases =
  0;


let processedCaseSamples =
  0;


let maximumConcurrentCases =
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


    // --------------------------------------------------------
    // Add newly active targetless observations
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // Retire completed observations
    // --------------------------------------------------------

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


    packetsWithTargetlessCases++;


    maximumConcurrentCases =
      Math.max(
        maximumConcurrentCases,
        activeCaseIndexes.size
      );


    const demo =
      parser.getDemo();


    // ========================================================
    // ASSIGNED GOLD
    // ========================================================

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


    // ========================================================
    // LIVING PLAYER PAWNS
    // ========================================================

    const controllers =
      demo.getEntitiesByClassName(
        'CCitadelPlayerController'
      )
      ??
      [];


    const playersByTeam =
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
        team ===
          null
        ||
        alive !==
          true
        ||
        lifeState !==
          0
        ||
        !position
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

          pawnEntityIndex:
            getEntityIndex(
              pawn
            ),

          position
        });
    }


    // ========================================================
    // TARGETLESS CASES
    // ========================================================

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


      const soul =
        soulByIndex.get(
          row.entityIndex
        )
        ??
        null;


      if (
        !soul
      ) {

        if (
          row
            .raw
            .firstObservedTick !==
          null
          &&
          row
            .raw
            .firstMissingTickAfterObserved ===
          null
        ) {

          row
            .raw
            .firstMissingTickAfterObserved =
            tick;
        }


        continue;
      }


      // ------------------------------------------------------
      // Basic observation
      // ------------------------------------------------------

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


      row
        .raw
        .soulSamples++;


      const active =
        booleanOrNull(
          safeGetField(
            soul,
            'm_bActive'
          )
        );


      const interactive =
        booleanOrNull(
          safeGetField(
            soul,
            'm_bInteractive'
          )
        );


      const targetHandle =
        handleOrNull(
          safeGetField(
            soul,
            'm_hVacuumTarget'
          )
        );


      const targetPawnEntityIndex =
        decodeHandleEntityIndex(
          targetHandle
        );


      // ------------------------------------------------------
      // Active state
      // ------------------------------------------------------

      if (
        active ===
        true
      ) {

        row
          .raw
          .activeTrueSamples++;


        if (
          row
            .raw
            .firstActiveTrueTick ===
          null
        ) {

          row
            .raw
            .firstActiveTrueTick =
            tick;
        }


        row
          .raw
          .lastActiveTrueTick =
          tick;

      } else if (
        active ===
        false
      ) {

        row
          .raw
          .activeFalseSamples++;


        if (
          row
            .raw
            .firstActiveFalseTick ===
          null
        ) {

          row
            .raw
            .firstActiveFalseTick =
            tick;
        }
      }


      // ------------------------------------------------------
      // Interactive state
      // ------------------------------------------------------

      if (
        interactive ===
        true
      ) {

        row
          .raw
          .interactiveTrueSamples++;


        if (
          row
            .raw
            .firstInteractiveTrueTick ===
          null
        ) {

          row
            .raw
            .firstInteractiveTrueTick =
            tick;
        }


        row
          .raw
          .lastInteractiveTrueTick =
          tick;

      } else if (
        interactive ===
        false
      ) {

        row
          .raw
          .interactiveFalseSamples++;


        if (
          row
            .raw
            .firstInteractiveFalseTick ===
          null
        ) {

          row
            .raw
            .firstInteractiveFalseTick =
            tick;
        }

      } else {

        row
          .raw
          .interactiveNullSamples++;
      }


      // ------------------------------------------------------
      // Unexpected target
      // ------------------------------------------------------

      if (
        targetPawnEntityIndex !==
          null
        &&
        row
          .raw
          .firstTargetTick ===
        null
      ) {

        row
          .raw
          .firstTargetTick =
          tick;


        row
          .raw
          .firstTargetPawnEntityIndex =
          targetPawnEntityIndex;
      }


      // ------------------------------------------------------
      // Geometry only while not observed inactive
      // ------------------------------------------------------

      if (
        active ===
        false
      ) {

        continue;
      }


      const soulPosition =
        getWorldPositionDetailed(
          soul
        );


      if (
        !soulPosition
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


      let nearestXY =
        null;


      let nearest3D =
        null;


      for (
        const player
        of alliedPlayers
      ) {

        const xy =
          distanceXY(
            soulPosition,
            player.position
          );


        const vertical =
          (
            soulPosition.hasZ ===
              true
            &&
            player.position.hasZ ===
              true
          )
            ? Math.abs(
              soulPosition.z -
              player.position.z
            )
            : null;


        const threeD =
          Number.isFinite(
            vertical
          )
            ? distance3D(
              soulPosition,
              player.position
            )
            : null;


        const candidate = {

          playerName:
            player.playerName,

          pawnEntityIndex:
            player.pawnEntityIndex,

          distanceXY:
            xy,

          distance3D:
            threeD,

          verticalDelta:
            vertical
        };


        if (
          nearestXY ===
            null
          ||
          candidate.distanceXY <
            nearestXY.distanceXY
        ) {

          nearestXY =
            candidate;
        }


        if (
          Number.isFinite(
            candidate.distance3D
          )
          &&
          (
            nearest3D ===
              null
            ||
            candidate.distance3D <
              nearest3D.distance3D
          )
        ) {

          nearest3D =
            candidate;
        }
      }


      if (
        !nearestXY
      ) {

        continue;
      }


      // ------------------------------------------------------
      // Minimum XY
      // ------------------------------------------------------

      if (
        row
          .raw
          .minimumNearestAllyXY ===
          null
        ||
        nearestXY.distanceXY <
          row
            .raw
            .minimumNearestAllyXY
      ) {

        row
          .raw
          .minimumNearestAllyXY =
          nearestXY.distanceXY;


        row
          .raw
          .minimumNearestAllyXYTick =
          tick;


        row
          .raw
          .minimumNearestAllyPlayerName =
          nearestXY.playerName;


        row
          .raw
          .minimumNearestAlly3DAtMinXY =
          nearestXY.distance3D;


        row
          .raw
          .minimumVerticalDeltaAtMinXY =
          nearestXY.verticalDelta;


        row
          .raw
          .interactiveAtMinXY =
          interactive;
      }


      // ------------------------------------------------------
      // Minimum 3D
      // ------------------------------------------------------

      if (
        nearest3D
        &&
        (
          row
            .raw
            .minimumNearestAlly3D ===
            null
          ||
          nearest3D.distance3D <
            row
              .raw
              .minimumNearestAlly3D
        )
      ) {

        row
          .raw
          .minimumNearestAlly3D =
          nearest3D.distance3D;


        row
          .raw
          .minimumNearestAlly3DTick =
          tick;


        row
          .raw
          .minimumNearestAllyXYAtMin3D =
          nearest3D.distanceXY;
      }


      // ------------------------------------------------------
      // Minimum while interactive=true
      // ------------------------------------------------------

      if (
        interactive ===
        true
      ) {

        if (
          row
            .raw
            .minimumInteractiveNearestAllyXY ===
            null
          ||
          nearestXY.distanceXY <
            row
              .raw
              .minimumInteractiveNearestAllyXY
        ) {

          row
            .raw
            .minimumInteractiveNearestAllyXY =
            nearestXY.distanceXY;


          row
            .raw
            .minimumInteractiveNearestAllyXYTick =
            tick;


          row
            .raw
            .minimumInteractiveNearestAllyPlayerName =
            nearestXY.playerName;


          row
            .raw
            .minimumInteractiveNearestAlly3DAtMinXY =
            nearestXY.distance3D;


          row
            .raw
            .minimumInteractiveVerticalDeltaAtMinXY =
            nearestXY.verticalDelta;
        }
      }


      // ------------------------------------------------------
      // Threshold states
      // ------------------------------------------------------

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


        if (
          nearestXY.distanceXY <=
          threshold
        ) {

          state.insideAnySamples++;


          if (
            state.firstInsideAnyTick ===
            null
          ) {

            state.firstInsideAnyTick =
              tick;
          }


          state.lastInsideAnyTick =
            tick;


          if (
            interactive ===
            true
          ) {

            state.insideInteractiveSamples++;


            if (
              state.firstInsideInteractiveTick ===
              null
            ) {

              state.firstInsideInteractiveTick =
                tick;


              state.firstInsideInteractivePlayerName =
                nearestXY.playerName;
            }


            state.lastInsideInteractiveTick =
              tick;
          }
        }
      }
    }
  }
);


console.log('');

console.log(
  'Rescanning exact targetless AssignedGold lifecycles...'
);

console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// DERIVED CASE FEATURES
// ============================================================

for (
  const row
  of cases
) {

  const rawInactiveTick =
    finite(
      row
        .raw
        .firstActiveFalseTick
    );


  const rawDurationSeconds =
    rawInactiveTick !==
      null
      ? (
        rawInactiveTick -
        row.activationTick
      ) /
        TICK_RATE
      : null;


  const state735 =
    row
      .raw
      .thresholdStates[
        '735'
      ];


  const firstInsideAny735Tick =
    finite(
      state735
        ?.firstInsideAnyTick
    );


  const firstInsideInteractive735Tick =
    finite(
      state735
        ?.firstInsideInteractiveTick
    );


  const any735ToInactiveSeconds =
    firstInsideAny735Tick !==
      null
    &&
    rawInactiveTick !==
      null
      ? (
        rawInactiveTick -
        firstInsideAny735Tick
      ) /
        TICK_RATE
      : null;


  const interactive735ToInactiveSeconds =
    firstInsideInteractive735Tick !==
      null
    &&
    rawInactiveTick !==
      null
      ? (
        rawInactiveTick -
        firstInsideInteractive735Tick
      ) /
        TICK_RATE
      : null;


  const script76DurationDelta =
    rawDurationSeconds !==
      null
    &&
    Number.isFinite(
      row
        .script76
        .durationSeconds
    )
      ? rawDurationSeconds -
        row
          .script76
          .durationSeconds
      : null;


  const nextActivationGapFromInactiveSeconds =
    row
      .nextActivation
      .tick !==
      null
    &&
    rawInactiveTick !==
      null
      ? (
        row
          .nextActivation
          .tick -
        rawInactiveTick
      ) /
        TICK_RATE
      : null;


  row.derived = {

    rawDurationSeconds,

    rawDurationTicks:
      rawInactiveTick !==
        null
        ? rawInactiveTick -
          row.activationTick
        : null,

    rawNear40Seconds:
      Number.isFinite(
        rawDurationSeconds
      )
        ? Math.abs(
          rawDurationSeconds -
          EXPIRATION_REFERENCE_SECONDS
        ) <=
          EXPIRATION_TOLERANCE_SECONDS
        : null,

    rawMinusScript76DurationSeconds:
      script76DurationDelta,

    any735ToInactiveSeconds,

    interactive735ToInactiveSeconds,

    nextActivationGapFromInactiveSeconds,

    targetFieldStayedNull:
      row
        .raw
        .firstTargetTick ===
      null,

    everInside735Any:
      firstInsideAny735Tick !==
      null,

    everInside735Interactive:
      firstInsideInteractive735Tick !==
      null,

    minimumXYWasInteractive:
      row
        .raw
        .interactiveAtMinXY ===
      true,

    proximity735Diagnostic:
      classify735Case(
        row,
        any735ToInactiveSeconds,
        interactive735ToInactiveSeconds
      ),

    terminationDiagnostic:
      classifyTermination(
        row,
        rawDurationSeconds,
        nextActivationGapFromInactiveSeconds,
        interactive735ToInactiveSeconds
      )
  };
}


// ============================================================
// RAW REPLICATION
// ============================================================

const rawTargetStayedNull =
  cases.filter(
    row =>
      row
        .raw
        .firstTargetTick ===
      null
  );


const rawInactive =
  cases.filter(
    row =>
      row
        .raw
        .firstActiveFalseTick !==
      null
  );


const script76Inactive =
  cases.filter(
    row =>
      row
        .script76
        .activeFalseObserved ===
      true
  );


const inactiveTickComparable =
  cases.filter(
    row =>
      row
        .script76
        .activeFalseTick !==
      null
    &&
    row
      .raw
      .firstActiveFalseTick !==
      null
  );


const inactiveTickExactMatch =
  inactiveTickComparable.filter(
    row =>
      row
        .script76
        .activeFalseTick ===
      row
        .raw
        .firstActiveFalseTick
  );


// ============================================================
// LIFETIME DISTRIBUTIONS
// ============================================================

const rawDurations =
  values(
    cases,
    row =>
      row
        ?.derived
        ?.rawDurationSeconds
  );


const script76Durations =
  values(
    cases,
    row =>
      row
        ?.script76
        ?.durationSeconds
  );


const near40Raw =
  cases.filter(
    row =>
      row
        ?.derived
        ?.rawNear40Seconds ===
      true
  );


const non40RawInactive =
  cases.filter(
    row =>
      row
        ?.raw
        ?.firstActiveFalseTick !==
      null
    &&
    row
      ?.derived
      ?.rawNear40Seconds !==
      true
  );


const noRawInactive =
  cases.filter(
    row =>
      row
        ?.raw
        ?.firstActiveFalseTick ===
      null
  );


// ============================================================
// DURATION BUCKETS
// ============================================================

const lifetimeBuckets =
  countBy(
    cases,
    row =>
      classifyDurationBucket(
        row
          ?.derived
          ?.rawDurationSeconds
      )
  );


// ============================================================
// TERMINATION DIAGNOSTIC COUNTS
// ============================================================

const terminationDiagnosticCounts =
  countBy(
    cases,
    row =>
      row
        ?.derived
        ?.terminationDiagnostic ??
      'UNRESOLVED'
  );


const proximity735DiagnosticCounts =
  countBy(
    cases,
    row =>
      row
        ?.derived
        ?.proximity735Diagnostic ??
      'UNRESOLVED'
  );


// ============================================================
// 735 FALSE-POSITIVE AUDIT
// ============================================================

const everInside735 =
  cases.filter(
    row =>
      row
        ?.derived
        ?.everInside735Any ===
      true
  );


const everInside735Interactive =
  cases.filter(
    row =>
      row
        ?.derived
        ?.everInside735Interactive ===
      true
  );


const inside735OnlyNoninteractive =
  everInside735.filter(
    row =>
      row
        ?.derived
        ?.everInside735Interactive !==
      true
  );


const inside735Interactive =
  everInside735.filter(
    row =>
      row
        ?.derived
        ?.everInside735Interactive ===
      true
  );


const interactive735TerminationWithin1s =
  inside735Interactive.filter(
    row =>
      Number.isFinite(
        row
          ?.derived
          ?.interactive735ToInactiveSeconds
      )
    &&
    row
      .derived
      .interactive735ToInactiveSeconds >=
      0
    &&
    row
      .derived
      .interactive735ToInactiveSeconds <=
      PROXIMITY_ASSOCIATED_TERMINATION_SECONDS
  );


// ============================================================
// VERTICAL GEOMETRY FOR <=735 CASES
// ============================================================

const inside735VerticalValues =
  values(
    everInside735,
    row =>
      row
        ?.raw
        ?.minimumVerticalDeltaAtMinXY
  );


const inside7353DAtMinXYValues =
  values(
    everInside735,
    row =>
      row
        ?.raw
        ?.minimumNearestAlly3DAtMinXY
  );


const inside735InteractiveVerticalValues =
  values(
    inside735Interactive,
    row =>
      row
        ?.raw
        ?.minimumInteractiveVerticalDeltaAtMinXY
  );


// ============================================================
// NEXT-ENTITY-ACTIVATION RELATIONS
// ============================================================

const reuseWithinOneSecond =
  cases.filter(
    row =>
      Number.isFinite(
        row
          ?.derived
          ?.nextActivationGapFromInactiveSeconds
      )
    &&
    row
      .derived
      .nextActivationGapFromInactiveSeconds >=
      0
    &&
    row
      .derived
      .nextActivationGapFromInactiveSeconds <=
      1
  );


const non40ReuseWithinOneSecond =
  non40RawInactive.filter(
    row =>
      Number.isFinite(
        row
          ?.derived
          ?.nextActivationGapFromInactiveSeconds
      )
    &&
    row
      .derived
      .nextActivationGapFromInactiveSeconds >=
      0
    &&
    row
      .derived
      .nextActivationGapFromInactiveSeconds <=
      1
  );


// ============================================================
// SHARED END TICKS
// ============================================================

const endTickGroups =
  groupExactTicks(
    rawInactive.map(
      row => ({

        deathIndex:
          row.deathIndex,

        tick:
          row
            .raw
            .firstActiveFalseTick
      })
    )
  );


const sharedEndTicks =
  endTickGroups.filter(
    row =>
      row.count >
      1
  );


// ============================================================
// PERIODIC END-TICK FIT
//
// Descriptive only.
//
// This checks whether early/non-40 targetless terminations appear
// synchronized to a common global cadence.
//
// A good fit does NOT prove a cleanup timer.
// ============================================================

const allInactiveTicks =
  rawInactive.map(
    row =>
      row
        .raw
        .firstActiveFalseTick
  );


const non40InactiveTicks =
  non40RawInactive.map(
    row =>
      row
        .raw
        .firstActiveFalseTick
  );


const periodicFitsAll =
  CANDIDATE_GLOBAL_PERIODS_SECONDS.map(
    seconds =>
      fitPeriodicPhase(
        allInactiveTicks,
        seconds
      )
  );


const periodicFitsNon40 =
  CANDIDATE_GLOBAL_PERIODS_SECONDS.map(
    seconds =>
      fitPeriodicPhase(
        non40InactiveTicks,
        seconds
      )
  );


// ============================================================
// TYPE / TIME GROUPS
// ============================================================

const baseTypeSummary =
  summarizeGroups(
    cases,
    row =>
      row.baseType ??
      'UNKNOWN'
  );


const variantSummary =
  summarizeGroups(
    cases,
    row =>
      row.variantLabel ??
      'UNKNOWN'
  );


const gameTimeSummary =
  summarizeGroups(
    cases,
    row =>
      classifyGameTimeBand(
        row.deathTimeSeconds
      )
  );


// ============================================================
// SCRIPT55 END REASONS
// ============================================================

const script75EndReasons =
  countBy(
    cases,
    row =>
      row
        ?.script75
        ?.endReason ??
      'UNKNOWN'
  );


const script76EndReasons =
  countBy(
    cases,
    row =>
      row
        ?.script76
        ?.endReason ??
      'UNKNOWN'
  );


// ============================================================
// VALIDATION
// ============================================================

const joined75 =
  cases.filter(
    row =>
      episode75ByDeathIndex.has(
        row.deathIndex
      )
  ).length;


const joined76 =
  cases.filter(
    row =>
      episode76ByDeathIndex.has(
        row.deathIndex
      )
  ).length;


const soulObserved =
  cases.filter(
    row =>
      row
        .raw
        .soulSamples >
      0
  );


const validationChecks = {

  script84Passed:
    check(
      summary84
        ?.validation
        ?.pass,
      true,
      summary84
        ?.validation
        ?.pass ===
      true
    ),


  targetless84Count:
    check(
      targetless84.length,
      replayName ===
        'test'
        ? 44
        : '>0',
      replayName ===
        'test'
        ? targetless84.length ===
          44
        : targetless84.length >
          0
    ),


  joinedCaseCount:
    check(
      cases.length,
      targetless84.length,
      cases.length ===
      targetless84.length
    ),


  script75JoinComplete:
    check(
      joined75,
      cases.length,
      joined75 ===
      cases.length
    ),


  script76JoinComplete:
    check(
      joined76,
      cases.length,
      joined76 ===
      cases.length
    ),


  soulObservationCoverage:
    check(
      soulObserved.length,
      cases.length,
      soulObserved.length ===
      cases.length
    ),


  rawTargetStayedNull:
    check(
      rawTargetStayedNull.length,
      cases.length,
      rawTargetStayedNull.length ===
      cases.length
    ),


  script76InactiveCount:
    check(
      script76Inactive.length,
      replayName ===
        'test'
        ? 43
        : '>=0',
      replayName ===
        'test'
        ? script76Inactive.length ===
          43
        : script76Inactive.length >=
          0
    ),


  rawInactiveCount:
    check(
      rawInactive.length,
      script76Inactive.length,
      rawInactive.length ===
      script76Inactive.length
    ),


  inactiveTickReplication:
    check(
      inactiveTickExactMatch.length,
      inactiveTickComparable.length,
      inactiveTickExactMatch.length ===
      inactiveTickComparable.length
    ),


  script84Inside735Count:
    check(
      targetless84.filter(
        row =>
          finite(
            row
              ?.thresholdStates
              ?.['735']
              ?.firstInsideTick
          ) !==
          null
      ).length,
      replayName ===
        'test'
        ? 5
        : '>=0',
      replayName ===
        'test'
        ? targetless84.filter(
            row =>
              finite(
                row
                  ?.thresholdStates
                  ?.['735']
                  ?.firstInsideTick
              ) !==
              null
          ).length ===
          5
        : true
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
    'ASSIGNED_GOLD_TARGETLESS_EXPIRATION_DIAGNOSTIC_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'TARGETLESS_TERMINATION_DIAGNOSTIC_READY'
      : 'PIPELINE_VALIDATION_FAILURE',


  purpose: [

    'Characterize the 44 clean AssignedGold episodes that never acquire a player m_hVacuumTarget.',

    'Test whether approximately 40 seconds is the dominant targetless termination signature without assuming it is universally canonical expiration.',

    'Diagnose shorter targetless lifetimes using exact raw m_bActive and m_bInteractive state, allied proximity, entity reuse timing, and global end-tick structure.',

    'Investigate the five Script84 no-target episodes that nevertheless entered the approximately 735-HU planar proximity region.'
  ],


  semanticLimits: {

    expiration:
      'A targetless active=false transition near 40 seconds is treated as an expiration candidate, not automatically as proven engine expiration.',

    activeFalse:
      'm_bActive=false is a lifecycle termination signal and is not independently proven to mean economic acquisition or expiration.',

    interactive:
      'm_bInteractive is inspected as a candidate eligibility state. Its semantic role is not assumed in advance.',

    proximity:
      'Approximately 732-735 HU remains an empirical single-replay proximity envelope, not an engine-documented exact radius.',

    periodicity:
      'Global periodic fits are descriptive diagnostics only and do not establish a cleanup scheduler.'
  },


  sourceCounts: {

    targetlessCases:
      cases.length,

    rawInactive:
      rawInactive.length,

    noRawInactive:
      noRawInactive.length,

    rawTargetStayedNull:
      rawTargetStayedNull.length,

    soulObserved:
      soulObserved.length,

    demoPackets,

    packetsWithTargetlessCases,

    processedCaseSamples,

    maximumConcurrentCases
  },


  lifetimes: {

    script76DurationSeconds:
      summarizeNumbers(
        script76Durations
      ),

    rawActivationToInactiveSeconds:
      summarizeNumbers(
        rawDurations
      ),

    near40Raw:
      near40Raw.length,

    non40RawInactive:
      non40RawInactive.length,

    noRawInactive:
      noRawInactive.length,

    buckets:
      lifetimeBuckets
  },


  proximity735Audit: {

    everInside735:
      everInside735.length,

    everInside735Interactive:
      everInside735Interactive.length,

    inside735OnlyWhileNotInteractiveOrUnresolved:
      inside735OnlyNoninteractive.length,

    inside735WhileInteractive:
      inside735Interactive.length,

    interactive735TerminationWithin1Second:
      interactive735TerminationWithin1s.length,

    minimumVerticalDeltaAtMinXY:
      summarizeNumbers(
        inside735VerticalValues
      ),

    distance3DAtMinimumXY:
      summarizeNumbers(
        inside7353DAtMinXYValues
      ),

    interactiveMinimumVerticalDelta:
      summarizeNumbers(
        inside735InteractiveVerticalValues
      ),

    diagnosticCounts:
      proximity735DiagnosticCounts
  },


  terminationDiagnostics: {

    diagnosticCounts:
      terminationDiagnosticCounts,

    reuseWithinOneSecondOfInactive:
      reuseWithinOneSecond.length,

    non40ReuseWithinOneSecondOfInactive:
      non40ReuseWithinOneSecond.length,

    script75EndReasons,

    script76EndReasons
  },


  sharedTerminationTicks: {

    sharedTickCount:
      sharedEndTicks.length,

    groups:
      sharedEndTicks
  },


  periodicTerminationFits: {

    allRawInactive:
      periodicFitsAll,

    non40RawInactive:
      periodicFitsNon40
  },


  groupedLifetimes: {

    byBaseType:
      baseTypeSummary,

    byVariant:
      variantSummary,

    byGameTime:
      gameTimeSummary
  },


  non40Cases:
    non40RawInactive.map(
      compactCase
    ),


  noInactiveCases:
    noRawInactive.map(
      compactCase
    ),


  inside735NoTargetCases:
    everInside735.map(
      compactCase
    ),


  interpretationGuide: {

    dominant40SecondTimeout:
      'If most targetless active-false episodes terminate tightly around 40 seconds while shorter episodes have separate explanations, a per-instance approximately 40-second expiration candidate becomes strong.',

    pooledReuse:
      'If shorter terminations occur immediately before reuse of the same AssignedGold pooled entity, some apparent short lifetimes may reflect pool lifecycle boundaries rather than expiration.',

    interactiveEligibility:
      'If Script84 <=735 false positives occurred only while m_bInteractive was not true, interactive state may explain the apparent proximity contradictions.',

    verticalEligibility:
      'If <=735 XY cases have large 3D or vertical separation, planar center-to-center distance alone may overstate true eligibility in those cases.',

    proximityTerminationWithoutTarget:
      'If an interactive <=735 entry is followed almost immediately by active=false without m_hVacuumTarget, targetless collection or an alternate termination path becomes a candidate requiring separate validation.',

    globalCleanup:
      'If non-40 terminations cluster on common exact ticks or exhibit very tight periodic phase alignment, a global cleanup schedule becomes worth testing.',

    unresolved:
      'If shorter lifetimes are neither reuse-related, proximity-associated, nor globally synchronized, their termination mechanism remains unresolved.'
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
  'ASSIGNED GOLD TARGETLESS EXPIRATION DIAGNOSTIC V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// COHORT
// ============================================================

console.log('');

console.log(
  'TARGETLESS COHORT'
);

console.log(
  '-----------------'
);


console.log(
  `Cases:                    ${cases.length}`
);


console.log(
  `Raw active=false:         ${rawInactive.length}`
);


console.log(
  `No raw active=false:      ${noRawInactive.length}`
);


console.log(
  `Target stayed null:       ${rawTargetStayedNull.length}/${cases.length}`
);


// ============================================================
// LIFETIMES
// ============================================================

console.log('');

console.log(
  'RAW ACTIVATION -> ACTIVE=FALSE LIFETIME'
);

console.log(
  '--------------------------------------'
);


console.log(
  formatDistribution(
    summarizeNumbers(
      rawDurations
    )
  )
);


console.log('');

console.log(
  `Near 40.00 s (+/-${EXPIRATION_TOLERANCE_SECONDS}s): ${near40Raw.length}`
);


console.log(
  `Non-40 active=false:                    ${non40RawInactive.length}`
);


console.log(
  `No active=false:                        ${noRawInactive.length}`
);


console.log('');

console.log(
  'LIFETIME BUCKETS'
);

console.log(
  '----------------'
);


printCounts(
  lifetimeBuckets
);


// ============================================================
// NON-40 CASES
// ============================================================

console.log('');

console.log(
  'NON-40 TARGETLESS ACTIVE=FALSE CASES'
);

console.log(
  '------------------------------------'
);


if (
  non40RawInactive.length ===
  0
) {

  console.log(
    'None.'
  );

} else {

  for (
    const row
    of non40RawInactive
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          (
            a
              ?.derived
              ?.rawDurationSeconds ??
            Infinity
          )
          -
          (
            b
              ?.derived
              ?.rawDurationSeconds ??
            Infinity
          )
      )
  ) {

    console.log(

      `${String(row.deathIndex).padStart(4)} ` +

      `${String(row.clock ?? '').padEnd(6)} ` +

      `${String(row.baseType ?? '').padEnd(8)} ` +

      `dur=${formatNumber(row.derived.rawDurationSeconds).padStart(7)}s ` +

      `endReason=${String(row.script76.endReason ?? 'UNKNOWN').padEnd(22)} ` +

      `minXY=${formatNumber(row.raw.minimumNearestAllyXY).padStart(8)} ` +

      `interactiveMin=${formatNumber(row.raw.minimumInteractiveNearestAllyXY).padStart(8)} ` +

      `reuseGap=${formatNumber(row.derived.nextActivationGapFromInactiveSeconds).padStart(8)}s ` +

      `class=${row.derived.terminationDiagnostic}`
    );
  }
}


// ============================================================
// 735 FALSE POSITIVES
// ============================================================

console.log('');

console.log(
  'NO-TARGET CASES THAT ENTERED <=735 HU'
);

console.log(
  '--------------------------------------'
);


console.log(
  `Any active-state <=735:          ${everInside735.length}/${cases.length}`
);


console.log(
  `<=735 while interactive=true:   ${everInside735Interactive.length}/${cases.length}`
);


console.log(
  `<=735 only noninteractive/null:  ${inside735OnlyNoninteractive.length}`
);


console.log(
  `Interactive <=735 then inactive <=1s: ${interactive735TerminationWithin1s.length}`
);


console.log('');


for (
  const row
  of everInside735
) {

  const state735 =
    row
      .raw
      .thresholdStates[
        '735'
      ];


  console.log(

    `${String(row.deathIndex).padStart(4)} ` +

    `${String(row.clock ?? '').padEnd(6)} ` +

    `dur=${formatNumber(row.derived.rawDurationSeconds).padStart(7)}s ` +

    `minXY=${formatNumber(row.raw.minimumNearestAllyXY).padStart(8)} ` +

    `3D@minXY=${formatNumber(row.raw.minimumNearestAlly3DAtMinXY).padStart(8)} ` +

    `vert=${formatNumber(row.raw.minimumVerticalDeltaAtMinXY).padStart(8)} ` +

    `interactive@min=${String(row.raw.interactiveAtMinXY).padEnd(5)} ` +

    `first735=${state735.firstInsideAnyTick ?? 'n/a'} ` +

    `first735interactive=${state735.firstInsideInteractiveTick ?? 'n/a'} ` +

    `entry->inactive=${formatNumber(row.derived.interactive735ToInactiveSeconds).padStart(8)}s ` +

    `diag=${row.derived.proximity735Diagnostic}`
  );
}


// ============================================================
// TERMINATION DIAGNOSTICS
// ============================================================

console.log('');

console.log(
  'TERMINATION DIAGNOSTIC CLASSES'
);

console.log(
  '------------------------------'
);


printCounts(
  terminationDiagnosticCounts
);


// ============================================================
// ENTITY REUSE
// ============================================================

console.log('');

console.log(
  'POOLED ENTITY REUSE'
);

console.log(
  '-------------------'
);


console.log(
  `Any targetless inactive -> next activation <=1s: ${reuseWithinOneSecond.length}`
);


console.log(
  `Non-40 inactive -> next activation <=1s:         ${non40ReuseWithinOneSecond.length}`
);


// ============================================================
// SHARED END TICKS
// ============================================================

console.log('');

console.log(
  'SHARED RAW ACTIVE=FALSE TICKS'
);

console.log(
  '-----------------------------'
);


if (
  sharedEndTicks.length ===
  0
) {

  console.log(
    'No exact shared termination ticks.'
  );

} else {

  for (
    const group
    of sharedEndTicks
  ) {

    console.log(

      `tick=${group.tick} ` +

      `count=${group.count} ` +

      `deaths=${group.deathIndexes.join(',')}`
    );
  }
}


// ============================================================
// PERIODIC FITS
// ============================================================

console.log('');

console.log(
  'GLOBAL PERIODIC END-TICK FIT — NON-40 CASES'
);

console.log(
  '-------------------------------------------'
);


for (
  const row
  of periodicFitsNon40
) {

  console.log(

    `${String(row.periodSeconds).padStart(2)}s ` +

    `n=${String(row.count).padStart(2)} ` +

    `medianResidual=${formatNumber(row.medianResidualTicks).padStart(7)} ticks ` +

    `p95=${formatNumber(row.p95ResidualTicks).padStart(7)} ` +

    `<=4ticks=${row.within4Ticks}/${row.count} ` +

    `phase=${row.bestPhaseTick}`
  );
}


// ============================================================
// GROUPED LIFETIMES
// ============================================================

console.log('');

console.log(
  'TARGETLESS LIFETIME BY BASE TYPE'
);

console.log(
  '--------------------------------'
);


for (
  const row
  of baseTypeSummary
) {

  console.log(

    `${String(row.group).padEnd(18)} ` +

    `n=${String(row.count).padStart(3)} ` +

    `${formatDistribution(row.duration)} ` +

    `near40=${row.near40}`
  );
}


console.log('');

console.log(
  'TARGETLESS LIFETIME BY GAME TIME'
);

console.log(
  '--------------------------------'
);


for (
  const row
  of gameTimeSummary
) {

  console.log(

    `${String(row.group).padEnd(18)} ` +

    `n=${String(row.count).padStart(3)} ` +

    `${formatDistribution(row.duration)} ` +

    `near40=${row.near40}`
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
  `OVERALL DIAGNOSTIC: ${validationPass ? 'PASS' : 'FAIL'}`
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
// DIAGNOSTIC CLASSIFICATION
// ============================================================

function classifyTermination(
  row,
  rawDurationSeconds,
  reuseGapSeconds,
  interactive735ToInactiveSeconds
) {

  if (
    !Number.isFinite(
      rawDurationSeconds
    )
  ) {

    return 'NO_RAW_ACTIVE_FALSE';
  }


  if (
    Math.abs(
      rawDurationSeconds -
      EXPIRATION_REFERENCE_SECONDS
    ) <=
    EXPIRATION_TOLERANCE_SECONDS
  ) {

    return 'NEAR_40S_TIMEOUT_CANDIDATE';
  }


  if (
    Number.isFinite(
      reuseGapSeconds
    )
    &&
    reuseGapSeconds >=
      0
    &&
    reuseGapSeconds <=
      1
  ) {

    return 'EARLY_TERMINATION_NEAR_ENTITY_REUSE';
  }


  if (
    Number.isFinite(
      interactive735ToInactiveSeconds
    )
    &&
    interactive735ToInactiveSeconds >=
      0
    &&
    interactive735ToInactiveSeconds <=
      PROXIMITY_ASSOCIATED_TERMINATION_SECONDS
  ) {

    return 'EARLY_TERMINATION_AFTER_INTERACTIVE_735_ENTRY';
  }


  if (
    row
      ?.derived
      ?.everInside735Any ===
    true
    &&
    row
      ?.derived
      ?.everInside735Interactive !==
    true
  ) {

    return 'EARLY_TERMINATION_WITH_NONINTERACTIVE_735_ENTRY';
  }


  return 'EARLY_TERMINATION_UNRESOLVED';
}


function classify735Case(
  row,
  any735ToInactiveSeconds,
  interactive735ToInactiveSeconds
) {

  const state =
    row
      ?.raw
      ?.thresholdStates
      ?.['735'];


  if (
    !state
    ||
    state.firstInsideAnyTick ===
    null
  ) {

    return 'NEVER_INSIDE_735';
  }


  if (
    state.firstInsideInteractiveTick ===
    null
  ) {

    return 'INSIDE_735_ONLY_WHILE_NOT_INTERACTIVE_OR_UNRESOLVED';
  }


  if (
    Number.isFinite(
      interactive735ToInactiveSeconds
    )
    &&
    interactive735ToInactiveSeconds >=
      0
    &&
    interactive735ToInactiveSeconds <=
      PROXIMITY_ASSOCIATED_TERMINATION_SECONDS
  ) {

    return 'INTERACTIVE_735_ENTRY_CLOSE_TO_TERMINATION';
  }


  if (
    Number.isFinite(
      row
        ?.raw
        ?.minimumInteractiveNearestAlly3DAtMinXY
    )
    &&
    row
      .raw
      .minimumInteractiveNearestAlly3DAtMinXY >
    768
  ) {

    return 'INTERACTIVE_XY_735_BUT_3D_OVER_768';
  }


  if (
    Number.isFinite(
      any735ToInactiveSeconds
    )
  ) {

    return 'INTERACTIVE_735_ENTRY_WITHOUT_TARGET_UNRESOLVED';
  }


  return 'INSIDE_735_UNRESOLVED';
}


// ============================================================
// DURATION BUCKET
// ============================================================

function classifyDurationBucket(
  durationSeconds
) {

  if (
    !Number.isFinite(
      durationSeconds
    )
  ) {

    return 'NO_RAW_ACTIVE_FALSE';
  }


  if (
    Math.abs(
      durationSeconds -
      EXPIRATION_REFERENCE_SECONDS
    ) <=
    EXPIRATION_TOLERANCE_SECONDS
  ) {

    return 'NEAR_40_SECONDS';
  }


  if (
    durationSeconds <
    20
  ) {

    return 'LT_20_SECONDS';
  }


  if (
    durationSeconds <
    30
  ) {

    return 'GE_20_LT_30_SECONDS';
  }


  if (
    durationSeconds <
    39
  ) {

    return 'GE_30_LT_39_SECONDS';
  }


  if (
    durationSeconds <
    39.95
  ) {

    return 'GE_39_LT_39_95_SECONDS';
  }


  if (
    durationSeconds <=
    40.05
  ) {

    return 'AROUND_40_SECONDS';
  }


  return 'GT_40_05_SECONDS';
}


// ============================================================
// GROUP SUMMARIES
// ============================================================

function summarizeGroups(
  rows,
  selector
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const group =
      String(
        selector(
          row
        )
        ??
        'UNKNOWN'
      );


    if (
      !map.has(
        group
      )
    ) {

      map.set(
        group,
        []
      );
    }


    map
      .get(
        group
      )
      .push(
        row
      );
  }


  return [
    ...map.entries()
  ]
    .map(
      (
        [
          group,
          groupRows
        ]
      ) => {

        const durations =
          values(
            groupRows,
            row =>
              row
                ?.derived
                ?.rawDurationSeconds
          );


        return {

          group,

          count:
            groupRows.length,

          duration:
            summarizeNumbers(
              durations
            ),

          near40:
            groupRows.filter(
              row =>
                row
                  ?.derived
                  ?.rawNear40Seconds ===
                true
            ).length,

          non40:
            groupRows.filter(
              row =>
                row
                  ?.raw
                  ?.firstActiveFalseTick !==
                null
                &&
                row
                  ?.derived
                  ?.rawNear40Seconds !==
                true
            ).length,

          noInactive:
            groupRows.filter(
              row =>
                row
                  ?.raw
                  ?.firstActiveFalseTick ===
                null
            ).length
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
        String(
          a.group
        ).localeCompare(
          String(
            b.group
          )
        )
    );
}


// ============================================================
// GAME TIME BAND
// ============================================================

function classifyGameTimeBand(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return 'UNKNOWN';
  }


  const minutes =
    seconds /
    60;


  if (
    minutes <
    10
  ) {

    return 'LT_10_MIN';
  }


  if (
    minutes <
    20
  ) {

    return '10_TO_LT_20_MIN';
  }


  if (
    minutes <
    30
  ) {

    return '20_TO_LT_30_MIN';
  }


  if (
    minutes <
    40
  ) {

    return '30_TO_LT_40_MIN';
  }


  return 'GE_40_MIN';
}


// ============================================================
// PERIODIC PHASE FIT
// ============================================================

function fitPeriodicPhase(
  ticks,
  periodSeconds
) {

  const cleanTicks =
    ticks.filter(
      Number.isFinite
    );


  const periodTicks =
    Math.round(
      periodSeconds *
      TICK_RATE
    );


  if (
    cleanTicks.length ===
    0
  ) {

    return {

      periodSeconds,

      periodTicks,

      count:
        0,

      bestPhaseTick:
        null,

      medianResidualTicks:
        null,

      p95ResidualTicks:
        null,

      maximumResidualTicks:
        null,

      within1Tick:
        0,

      within4Ticks:
        0,

      within16Ticks:
        0
    };
  }


  const residues =
    cleanTicks.map(
      tick =>
        positiveModulo(
          tick,
          periodTicks
        )
    );


  const candidatePhases =
    [
      ...new Set(
        residues
      )
    ];


  let best =
    null;


  for (
    const phase
    of candidatePhases
  ) {

    const residuals =
      residues
        .map(
          residue =>
            circularDistance(
              residue,
              phase,
              periodTicks
            )
        )
        .sort(
          (
            a,
            b
          ) =>
            a -
            b
        );


    const median =
      quantile(
        residuals,
        0.50
      );


    const p95 =
      quantile(
        residuals,
        0.95
      );


    const maximum =
      residuals[
        residuals.length -
        1
      ];


    const candidate = {

      phase,

      residuals,

      median,

      p95,

      maximum
    };


    if (
      best ===
        null
      ||
      candidate.median <
        best.median
      ||
      (
        candidate.median ===
          best.median
        &&
        candidate.p95 <
          best.p95
      )
      ||
      (
        candidate.median ===
          best.median
        &&
        candidate.p95 ===
          best.p95
        &&
        candidate.maximum <
          best.maximum
      )
    ) {

      best =
        candidate;
    }
  }


  return {

    periodSeconds,

    periodTicks,

    count:
      cleanTicks.length,

    bestPhaseTick:
      best.phase,

    medianResidualTicks:
      best.median,

    p95ResidualTicks:
      best.p95,

    maximumResidualTicks:
      best.maximum,

    within1Tick:
      best
        .residuals
        .filter(
          value =>
            value <=
            1
        )
        .length,

    within4Ticks:
      best
        .residuals
        .filter(
          value =>
            value <=
            4
        )
        .length,

    within16Ticks:
      best
        .residuals
        .filter(
          value =>
            value <=
            16
        )
        .length
  };
}


function positiveModulo(
  value,
  modulus
) {

  return (
    (
      value %
      modulus
    )
    +
    modulus
  )
  %
  modulus;
}


function circularDistance(
  value,
  phase,
  modulus
) {

  const direct =
    Math.abs(
      value -
      phase
    );


  return Math.min(
    direct,
    modulus -
    direct
  );
}


// ============================================================
// END-TICK GROUPS
// ============================================================

function groupExactTicks(
  rows
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      !Number.isFinite(
        row.tick
      )
    ) {

      continue;
    }


    if (
      !map.has(
        row.tick
      )
    ) {

      map.set(
        row.tick,
        []
      );
    }


    map
      .get(
        row.tick
      )
      .push(
        row.deathIndex
      );
  }


  return [
    ...map.entries()
  ]
    .map(
      (
        [
          tick,
          deathIndexes
        ]
      ) => ({

        tick,

        count:
          deathIndexes.length,

        deathIndexes:
          deathIndexes
            .slice()
            .sort(
              (
                a,
                b
              ) =>
                a -
                b
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
        a.tick -
          b.tick
    );
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
// WORLD POSITION
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

    deathTimeSeconds:
      row.deathTimeSeconds,

    baseType:
      row.baseType,

    variantLabel:
      row.variantLabel,

    creditedPlayerName:
      row.creditedPlayerName,

    creditedTeam:
      row.creditedTeam,

    entityIndex:
      row.entityIndex,

    activationTick:
      row.activationTick,

    observationEndTick:
      row.observationEndTick,

    script75:
      row.script75,

    script76:
      row.script76,

    script84:
      row.script84,

    nextActivation:
      row.nextActivation,

    raw: {

      firstObservedTick:
        row
          .raw
          .firstObservedTick,

      lastObservedTick:
        row
          .raw
          .lastObservedTick,

      soulSamples:
        row
          .raw
          .soulSamples,

      activeTrueSamples:
        row
          .raw
          .activeTrueSamples,

      activeFalseSamples:
        row
          .raw
          .activeFalseSamples,

      interactiveTrueSamples:
        row
          .raw
          .interactiveTrueSamples,

      interactiveFalseSamples:
        row
          .raw
          .interactiveFalseSamples,

      interactiveNullSamples:
        row
          .raw
          .interactiveNullSamples,

      firstActiveTrueTick:
        row
          .raw
          .firstActiveTrueTick,

      lastActiveTrueTick:
        row
          .raw
          .lastActiveTrueTick,

      firstActiveFalseTick:
        row
          .raw
          .firstActiveFalseTick,

      firstInteractiveTrueTick:
        row
          .raw
          .firstInteractiveTrueTick,

      lastInteractiveTrueTick:
        row
          .raw
          .lastInteractiveTrueTick,

      firstInteractiveFalseTick:
        row
          .raw
          .firstInteractiveFalseTick,

      firstTargetTick:
        row
          .raw
          .firstTargetTick,

      firstTargetPawnEntityIndex:
        row
          .raw
          .firstTargetPawnEntityIndex,

      firstMissingTickAfterObserved:
        row
          .raw
          .firstMissingTickAfterObserved,

      minimumNearestAllyXY:
        row
          .raw
          .minimumNearestAllyXY,

      minimumNearestAllyXYTick:
        row
          .raw
          .minimumNearestAllyXYTick,

      minimumNearestAllyPlayerName:
        row
          .raw
          .minimumNearestAllyPlayerName,

      minimumNearestAlly3DAtMinXY:
        row
          .raw
          .minimumNearestAlly3DAtMinXY,

      minimumVerticalDeltaAtMinXY:
        row
          .raw
          .minimumVerticalDeltaAtMinXY,

      interactiveAtMinXY:
        row
          .raw
          .interactiveAtMinXY,

      minimumNearestAlly3D:
        row
          .raw
          .minimumNearestAlly3D,

      minimumNearestAlly3DTick:
        row
          .raw
          .minimumNearestAlly3DTick,

      minimumNearestAllyXYAtMin3D:
        row
          .raw
          .minimumNearestAllyXYAtMin3D,

      minimumInteractiveNearestAllyXY:
        row
          .raw
          .minimumInteractiveNearestAllyXY,

      minimumInteractiveNearestAllyXYTick:
        row
          .raw
          .minimumInteractiveNearestAllyXYTick,

      minimumInteractiveNearestAllyPlayerName:
        row
          .raw
          .minimumInteractiveNearestAllyPlayerName,

      minimumInteractiveNearestAlly3DAtMinXY:
        row
          .raw
          .minimumInteractiveNearestAlly3DAtMinXY,

      minimumInteractiveVerticalDeltaAtMinXY:
        row
          .raw
          .minimumInteractiveVerticalDeltaAtMinXY,

      thresholdStates:
        row
          .raw
          .thresholdStates
    },

    derived:
      row.derived
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


function printCounts(
  counts
) {

  const entries =
    Object
      .entries(
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
      );


  for (
    const [
      key,
      value
    ]
    of entries
  ) {

    console.log(
      `${String(key).padEnd(48)} ${value}`
    );
  }
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
        3
      )
    ).toString()
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