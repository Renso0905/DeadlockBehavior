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

const MATCH_CLOCK_OFFSET_SECONDS =
  30;


// ============================================================
// DIAGNOSTIC WINDOWS
//
// Script 70/70b already established which cases remain outside
// 45m through +/-1 second around the Trooper death.
//
// Script 70c changes the REFERENCE POINT and REFERENCE TIME:
//
//   - Trooper death position / death tick
//   - AssignedGold activation position / activation tick
//
// We also retain wider windows as diagnostics only.
// ============================================================

const WINDOW_SECONDS = [
  0.125,
  0.250,
  0.500,
  1.000,
  2.000
];

const MAX_WINDOW_SECONDS =
  Math.max(
    ...WINDOW_SECONDS
  );

const MAX_WINDOW_TICKS =
  Math.ceil(
    MAX_WINDOW_SECONDS *
    TICK_RATE
  );


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );

const script70bSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_window_resolution_v01.json'
  );

const script70bCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_window_resolution_cases_v01.jsonl'
  );

const deathStreamPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_v01.jsonl'
  );

const script55SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_summary_v01.json'
  );

const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_persistent_range_diagnostic_v01.json'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_persistent_range_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    script70bSummaryPath,
    script70bCasesPath,
    deathStreamPath,
    script55SummaryPath,
    playerStatePath
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
// LOAD SCRIPT 70B
// ============================================================

const script70bSummary =
  JSON.parse(
    readFileSync(
      script70bSummaryPath,
      'utf8'
    )
  );

if (
  script70bSummary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Corrected Script 70b summary did not PASS validation.'
  );
}

const documentedRangeHU =
  finite(
    script70bSummary
      ?.documentedMechanicTarget
      ?.rangeInternalUnits
  );

const documentedRangeMeters =
  finite(
    script70bSummary
      ?.documentedMechanicTarget
      ?.rangeMeters
  ) ??
  45;

if (
  documentedRangeHU ===
  null
) {
  throw new Error(
    'Could not recover documented 45m threshold from Script 70b.'
  );
}

const script70bCases =
  await loadJsonl(
    script70bCasesPath
  );

const persistent70bCases =
  script70bCases
    .filter(
      row =>
        row?.persistentMechanicCandidate ===
        true
    )
    .sort(
      (
        a,
        b
      ) =>
        finite(
          a?.death?.deathIndex
        ) -
        finite(
          b?.death?.deathIndex
        )
    );

console.log('');
console.log(
  `Corrected Script 70b persistent cases: ${persistent70bCases.length}`
);
console.log(
  `Documented threshold: ${documentedRangeHU.toFixed(3)} HU (${documentedRangeMeters}m)`
);


// ============================================================
// LOAD SCRIPT 55
// ============================================================

const script55Summary =
  JSON.parse(
    readFileSync(
      script55SummaryPath,
      'utf8'
    )
  );

if (
  script55Summary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 55 one-to-one summary did not PASS validation.'
  );
}

const rawDeathRows =
  await loadJsonl(
    deathStreamPath
  );

const deathByIndex =
  new Map();

for (
  const row
  of rawDeathRows
) {
  const deathIndex =
    finite(
      row?.deathIndex
    );

  if (
    deathIndex !==
    null
  ) {
    deathByIndex.set(
      deathIndex,
      row
    );
  }
}


// ============================================================
// PLAYER IDENTITY FALLBACK
// ============================================================

const playerIdentity =
  await loadPlayerIdentity(
    playerStatePath
  );

const playerByPawnIndex =
  playerIdentity.playerByPawnIndex;


// ============================================================
// BUILD TARGET CASES
// ============================================================

const targets =
  [];

for (
  const source
  of persistent70bCases
) {
  const deathIndex =
    finite(
      source?.death?.deathIndex
    );

  if (
    deathIndex ===
    null
  ) {
    continue;
  }

  const deathRow =
    deathByIndex.get(
      deathIndex
    ) ??
    null;

  if (
    !deathRow
  ) {
    continue;
  }

  const deathTick =
    firstFinite([
      deathRow
        ?.timing
        ?.tick,
      parseDeathKeyTick(
        deathRow?.deathKey
      ),
      source
        ?.death
        ?.tick
    ]);

  const deathPosition =
    normalizePosition(
      deathRow
        ?.trooper
        ?.position ??
      source
        ?.death
        ?.storedDeathPosition
    );

  const trooperTeam =
    firstFinite([
      deathRow
        ?.trooper
        ?.team,
      source
        ?.death
        ?.team
    ]);

  const groundSoul =
    deathRow?.groundSoul ??
    null;

  const activationTick =
    firstFinite([
      groundSoul?.activationTick,
      groundSoul
        ?.timing
        ?.activationTick
    ]);

  const activationPosition =
    normalizePosition(
      groundSoul?.position
    );

  const activationEntityIndex =
    firstFinite([
      groundSoul?.entityIndex,
      groundSoul?.activationEntityIndex
    ]);

  const groundSoulTeam =
    finite(
      groundSoul?.team
    );

  if (
    deathTick ===
      null
    ||
    !deathPosition
    ||
    activationTick ===
      null
    ||
    !activationPosition
  ) {
    targets.push({
      deathIndex,
      valid:
        false,
      invalidReason:
        'MISSING_DEATH_OR_ASSIGNEDGOLD_ANCHOR',
      source70b:
        source,
      deathRow
    });

    continue;
  }

  const vacuumTargetPlayer =
    groundSoul
      ?.vacuumTargetPlayer ??
    null;

  targets.push({
    deathIndex,
    valid:
      true,

    deathKey:
      deathRow?.deathKey ??
      source?.death?.deathKey ??
      null,

    entityIndex:
      firstFinite([
        deathRow
          ?.trooper
          ?.entityIndex,
        source
          ?.death
          ?.entityIndex
      ]),

    baseType:
      deathRow
        ?.trooper
        ?.baseType ??
      source
        ?.death
        ?.baseType ??
      'UNKNOWN',

    variantLabel:
      deathRow
        ?.trooper
        ?.variantLabel ??
      source
        ?.death
        ?.variantLabel ??
      'UNKNOWN',

    clock:
      deathRow
        ?.timing
        ?.clock ??
      source
        ?.death
        ?.clock ??
      null,

    deathTick,

    deathTimeSeconds:
      firstFinite([
        deathRow
          ?.timing
          ?.timeSeconds,
        source
          ?.death
          ?.timeSeconds,
        tickToMatchTime(
          deathTick
        )
      ]),

    deathPosition,

    trooperTeam,

    activationTick,

    activationTimeSeconds:
      firstFinite([
        groundSoul?.activationTimeSeconds,
        groundSoul
          ?.timing
          ?.activationTimeSeconds,
        tickToMatchTime(
          activationTick
        )
      ]),

    activationClock:
      groundSoul?.activationClock ??
      groundSoul
        ?.timing
        ?.activationClock ??
      formatClock(
        tickToMatchTime(
          activationTick
        )
      ),

    activationEntityIndex,

    activationPosition,

    groundSoulTeam,

    vacuumTargetPlayer,

    match:
      deathRow?.match ??
      null,

    source70b:
      source,

    deathRow
  });
}

const validTargets =
  targets.filter(
    row =>
      row.valid
  );

console.log(
  `Persistent cases joined to AssignedGold anchors: ${validTargets.length}/${persistent70bCases.length}`
);


// ============================================================
// RAW REPLAY TARGET TICKS
// ============================================================

const ticksOfInterest =
  new Set();

for (
  const target
  of validTargets
) {
  for (
    let tick =
      Math.min(
        target.deathTick,
        target.activationTick
      ) -
      MAX_WINDOW_TICKS;

    tick <=
      Math.max(
        target.deathTick,
        target.activationTick
      ) +
      MAX_WINDOW_TICKS;

    tick++
  ) {
    ticksOfInterest.add(
      tick
    );
  }
}


// ============================================================
// RAW SNAPSHOTS
// ============================================================

const snapshotsByDeathIndex =
  new Map();

for (
  const target
  of validTargets
) {
  snapshotsByDeathIndex.set(
    target.deathIndex,
    []
  );
}

let relevantDemoPackets =
  0;


// ============================================================
// PARSER
// ============================================================

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
      ||
      !ticksOfInterest.has(
        tick
      )
    ) {
      return;
    }

    relevantDemoPackets++;

    const demo =
      parser.getDemo();

    const pawns =
      demo.getEntitiesByClassName(
        'CCitadelPlayerPawn'
      );

    const assignedGoldEntities =
      demo.getEntitiesByClassName(
        'CCitadel_Pickup_AssignedGold'
      );

    for (
      const target
      of validTargets
    ) {
      if (
        tick <
          Math.min(
            target.deathTick,
            target.activationTick
          ) -
          MAX_WINDOW_TICKS
        ||
        tick >
          Math.max(
            target.deathTick,
            target.activationTick
          ) +
          MAX_WINDOW_TICKS
      ) {
        continue;
      }

      const players =
        [];

      for (
        const pawn
        of pawns
      ) {
        const position =
          worldPosition(
            pawn
          );

        if (
          !position
        ) {
          continue;
        }

        const identity =
          resolvePawnIdentity(
            demo,
            pawn
          );

        const aliveState =
          readPawnAliveState(
            pawn
          );

        players.push({
          tick,

          matchTimeSeconds:
            tickToMatchTime(
              tick
            ),

          playerName:
            identity.playerName,

          pawnEntityIndex:
            pawn.index,

          controllerEntityIndex:
            identity.controllerEntityIndex,

          team:
            identity.team,

          heroId:
            identity.heroId,

          aliveState,

          position,

          distanceToDeath3D:
            getDistance3D(
              target.deathPosition,
              position
            ),

          distanceToDeathXY:
            getDistanceXY(
              target.deathPosition,
              position
            ),

          distanceToAssignedGold3D:
            getDistance3D(
              target.activationPosition,
              position
            ),

          distanceToAssignedGoldXY:
            getDistanceXY(
              target.activationPosition,
              position
            )
        });
      }

      const rawAssignedGold =
        Number.isFinite(
          target.activationEntityIndex
        )
          ? assignedGoldEntities.find(
            entity =>
              entity.index ===
              target.activationEntityIndex
          ) ??
          null
          : null;

      const rawAssignedGoldPosition =
        rawAssignedGold
          ? worldPosition(
            rawAssignedGold
          )
          : null;

      snapshotsByDeathIndex
        .get(
          target.deathIndex
        )
        .push({
          tick,

          matchTimeSeconds:
            tickToMatchTime(
              tick
            ),

          deathTickDelta:
            tick -
            target.deathTick,

          activationTickDelta:
            tick -
            target.activationTick,

          players,

          rawAssignedGold: {
            entityFound:
              Boolean(
                rawAssignedGold
              ),

            position:
              rawAssignedGoldPosition,

            storedVsRawPositionDifference3D:
              rawAssignedGoldPosition
                ? getDistance3D(
                  target.activationPosition,
                  rawAssignedGoldPosition
                )
                : null,

            storedVsRawPositionDifferenceXY:
              rawAssignedGoldPosition
                ? getDistanceXY(
                  target.activationPosition,
                  rawAssignedGoldPosition
                )
                : null,

            team:
              rawAssignedGold
                ? numberField(
                  rawAssignedGold,
                  'm_iTeamNum'
                )
                : null,

            vacuumTargetHandle:
              rawAssignedGold
                ? firstFinite([
                  numberField(
                    rawAssignedGold,
                    'm_hVacuumTarget'
                  ),
                  numberField(
                    rawAssignedGold,
                    'm_hVacuumTargetEntity'
                  )
                ])
                : null
          }
        });
    }
  }
);


// ============================================================
// RUN
// ============================================================

console.log('');
console.log(
  'Rescanning raw replay around persistent cases...'
);
console.log('');

await parser.parse(
  createReadStream(
    replayPath
  )
);

await parser.dispose();


// ============================================================
// ANALYZE CASES
// ============================================================

const analyzedCases =
  [];

for (
  const target
  of targets
) {
  if (
    !target.valid
  ) {
    analyzedCases.push({
      schemaVersion:
        1,

      canonical:
        false,

      deathIndex:
        target.deathIndex,

      valid:
        false,

      invalidReason:
        target.invalidReason
    });

    continue;
  }

  const snapshots =
    (
      snapshotsByDeathIndex.get(
        target.deathIndex
      ) ??
      []
    )
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
      );

  const opposingTeam =
    oppositeTeam(
      target.trooperTeam
    );

  const exactActivationSnapshot =
    snapshots.find(
      row =>
        row.tick ===
        target.activationTick
    ) ??
    null;

  const exactDeathSnapshot =
    snapshots.find(
      row =>
        row.tick ===
        target.deathTick
    ) ??
    null;

  const exactActivation =
    summarizeSnapshotGeometry(
      exactActivationSnapshot,
      target,
      opposingTeam
    );

  const exactDeath =
    summarizeSnapshotGeometry(
      exactDeathSnapshot,
      target,
      opposingTeam
    );

  const windows =
    {};

  for (
    const seconds
    of WINDOW_SECONDS
  ) {
    windows[
      String(
        seconds
      )
    ] =
      summarizeWindowGeometry(
        snapshots,
        target,
        opposingTeam,
        seconds
      );
  }

  const assignedGoldDisplacement3D =
    getDistance3D(
      target.deathPosition,
      target.activationPosition
    );

  const assignedGoldDisplacementXY =
    getDistanceXY(
      target.deathPosition,
      target.activationPosition
    );

  const vacuumTargetName =
    target
      ?.vacuumTargetPlayer
      ?.playerName ??
    null;

  const vacuumTargetAtActivation =
    vacuumTargetName
      ? exactActivationSnapshot
        ?.players
        ?.find(
          player =>
            player.playerName ===
            vacuumTargetName
        ) ??
        null
      : null;

  const resolution =
    classifyPersistentCase({
      target,
      opposingTeam,
      exactActivation,
      exactDeath,
      windows,
      vacuumTargetAtActivation
    });

  analyzedCases.push({
    schemaVersion:
      1,

    canonical:
      false,

    valid:
      true,

    death: {
      deathIndex:
        target.deathIndex,

      deathKey:
        target.deathKey,

      entityIndex:
        target.entityIndex,

      baseType:
        target.baseType,

      variantLabel:
        target.variantLabel,

      clock:
        target.clock,

      tick:
        target.deathTick,

      timeSeconds:
        target.deathTimeSeconds,

      team:
        target.trooperTeam,

      position:
        target.deathPosition
    },

    assignedGold: {
      entityIndex:
        target.activationEntityIndex,

      activationTick:
        target.activationTick,

      activationTimeSeconds:
        target.activationTimeSeconds,

      activationClock:
        target.activationClock,

      team:
        target.groundSoulTeam,

      position:
        target.activationPosition,

      deathToActivationTickDelta:
        target.activationTick -
        target.deathTick,

      deathToActivationTimeDeltaSeconds:
        (
          target.activationTick -
          target.deathTick
        ) /
        TICK_RATE,

      deathToActivationPositionDistance3D:
        assignedGoldDisplacement3D,

      deathToActivationPositionDistanceXY:
        assignedGoldDisplacementXY,

      vacuumTargetPlayer:
        target.vacuumTargetPlayer,

      rawAtActivationTick:
        exactActivationSnapshot
          ?.rawAssignedGold ??
        null
    },

    script55Match: {
      status:
        target
          ?.match
          ?.status ??
        null,

      tickDelta:
        firstFinite([
          target
            ?.match
            ?.tickDelta,
          target
            ?.match
            ?.deltaTicks
        ]),

      distance3D:
        firstFinite([
          target
            ?.match
            ?.distance3D,
          target
            ?.match
            ?.distance
        ]),

      deathCandidateCount:
        firstFinite([
          target
            ?.match
            ?.deathCandidateCount,
          target
            ?.match
            ?.candidateActivationCount
        ]),

      activationCandidateCount:
        finite(
          target
            ?.match
            ?.activationCandidateCount
        ),

      confidence:
        target
          ?.match
          ?.confidence ??
        null
    },

    exactDeathTick:
      exactDeath,

    exactAssignedGoldActivationTick:
      exactActivation,

    windowsAroundAssignedGoldActivation:
      windows,

    vacuumTargetAtActivation:
      vacuumTargetAtActivation
        ? compactPlayer(
          vacuumTargetAtActivation
        )
        : null,

    resolution,

    source70b: {
      primaryResolutionCategory:
        target
          ?.source70b
          ?.primaryResolutionCategory ??
        null,

      exactBest3D:
        target
          ?.source70b
          ?.exactTick
          ?.best3D ??
        null,

      oneSecondBest3D:
        target
          ?.source70b
          ?.windows
          ?.['1']
          ?.best3D ??
        null
    }
  });
}


// ============================================================
// COUNTS
// ============================================================

const validAnalyzed =
  analyzedCases.filter(
    row =>
      row.valid
  );

const resolutionCounts =
  countByObject(
    validAnalyzed,
    row =>
      row
        ?.resolution
        ?.primaryCategory ??
      'UNKNOWN'
  );

const exactActivation3DResolved =
  validAnalyzed.filter(
    row =>
      row
        ?.exactAssignedGoldActivationTick
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D <=
      documentedRangeHU
  );

const activationHalfSecond3DResolved =
  validAnalyzed.filter(
    row =>
      row
        ?.windowsAroundAssignedGoldActivation
        ?.['0.5']
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D <=
      documentedRangeHU
  );

const activationOneSecond3DResolved =
  validAnalyzed.filter(
    row =>
      row
        ?.windowsAroundAssignedGoldActivation
        ?.['1']
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D <=
      documentedRangeHU
  );

const activationTwoSecond3DResolved =
  validAnalyzed.filter(
    row =>
      row
        ?.windowsAroundAssignedGoldActivation
        ?.['2']
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D <=
      documentedRangeHU
  );

const assignedGoldPointHelps =
  validAnalyzed.filter(
    row => {
      const deathDistance =
        row
          ?.exactAssignedGoldActivationTick
          ?.opposingAlive
          ?.nearestToDeath3D
          ?.distance3D;

      const soulDistance =
        row
          ?.exactAssignedGoldActivationTick
          ?.opposingAlive
          ?.nearestToAssignedGold3D
          ?.distance3D;

      return Number.isFinite(
        deathDistance
      )
      &&
      Number.isFinite(
        soulDistance
      )
      &&
      soulDistance <
        deathDistance;
    }
  );

const anyTeamOnlyResolved =
  validAnalyzed.filter(
    row =>
      row
        ?.resolution
        ?.primaryCategory ===
      'ANY_TEAM_ONLY_AT_ACTIVATION'
  );

const planarOnlyResolved =
  validAnalyzed.filter(
    row =>
      row
        ?.resolution
        ?.primaryCategory ===
      'PLANAR_ONLY_AT_ASSIGNEDGOLD_ACTIVATION'
  );

const stillPersistent =
  validAnalyzed.filter(
    row =>
      row
        ?.resolution
        ?.primaryCategory ===
      'STILL_PERSISTENT_AFTER_ASSIGNEDGOLD_ANCHOR_TEST'
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedPersistentCount =
  finite(
    script70bSummary
      ?.counts
      ?.stillPersistentWithout3DPlanarOrMatchAmbiguity
  );

const validationChecks = {
  script70bPassed:
    check(
      script70bSummary
        ?.validation
        ?.pass,
      true,
      script70bSummary
        ?.validation
        ?.pass ===
        true
    ),

  script55Passed:
    check(
      script55Summary
        ?.validation
        ?.pass,
      true,
      script55Summary
        ?.validation
        ?.pass ===
        true
    ),

  persistentCountPreserved:
    check(
      persistent70bCases.length,
      expectedPersistentCount,
      expectedPersistentCount ===
        null
        ? persistent70bCases.length >
          0
        : persistent70bCases.length ===
          expectedPersistentCount
    ),

  expectedTestReplayPersistentCount:
    check(
      persistent70bCases.length,
      replayName ===
        'test'
        ? 7
        : '>0',
      replayName ===
        'test'
        ? persistent70bCases.length ===
          7
        : persistent70bCases.length >
          0
    ),

  allPersistentCasesJoinedToScript55:
    check(
      validTargets.length,
      persistent70bCases.length,
      validTargets.length ===
        persistent70bCases.length
    ),

  rawReplayRelevantPacketsObserved:
    check(
      relevantDemoPackets,
      '>0',
      relevantDemoPackets >
        0
    ),

  exactActivationSnapshotsObservedForAll:
    check(
      validAnalyzed.filter(
        row =>
          Boolean(
            row.exactAssignedGoldActivationTick
          )
      ).length,
      validAnalyzed.length,
      validAnalyzed.every(
        row =>
          Boolean(
            row.exactAssignedGoldActivationTick
          )
      )
    ),

  classificationExhaustive:
    check(
      Object.values(
        resolutionCounts
      ).reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ),
      validAnalyzed.length,
      Object.values(
        resolutionCounts
      ).reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) ===
        validAnalyzed.length
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
    'TROOPER_GROUND_SOUL_PERSISTENT_RANGE_DIAGNOSTIC_V01',

  canonical:
    false,

  status:
    !validationPass
      ? 'DIAGNOSTIC_PIPELINE_FAILURE'
      : stillPersistent.length ===
          0
        ? 'PERSISTENT_45M_CASES_EXPLAINED_BY_ASSIGNEDGOLD_ANCHOR_OR_ALTERNATIVE_GEOMETRY'
        : 'PERSISTENT_RANGE_CASES_REMAIN_AFTER_ASSIGNEDGOLD_ANCHOR_TEST',

  purpose: [
    'Take only the corrected Script 70b persistent 45m exception set.',
    'Test raw player geometry at the actual Script 55 AssignedGold activation tick.',
    'Compare Trooper death position against the matched AssignedGold activation position as the possible range reference point.',
    'Test opposing-team alive players, any-team alive players, planar geometry, and the observed vacuum-target player separately.',
    'Do not redefine the 45m mechanic from wider timing windows; +/-2s remains diagnostic only.'
  ],

  documentedMechanicTarget: {
    rangeMeters:
      documentedRangeMeters,

    rangeInternalUnits:
      documentedRangeHU
  },

  inputs: {
    replay:
      replayPath,

    script70bSummary:
      script70bSummaryPath,

    script70bCases:
      script70bCasesPath,

    script55DeathStream:
      deathStreamPath,

    script55Summary:
      script55SummaryPath,

    playerState:
      playerStatePath
  },

  counts: {
    persistentCasesInput:
      persistent70bCases.length,

    persistentCasesJoined:
      validTargets.length,

    exactAssignedGoldActivation3DResolved:
      exactActivation3DResolved.length,

    assignedGoldActivationHalfSecond3DResolved:
      activationHalfSecond3DResolved.length,

    assignedGoldActivationOneSecond3DResolved:
      activationOneSecond3DResolved.length,

    assignedGoldActivationTwoSecond3DResolvedDiagnosticOnly:
      activationTwoSecond3DResolved.length,

    assignedGoldReferencePointCloserThanDeathPointAtActivation:
      assignedGoldPointHelps.length,

    anyTeamOnlyResolved:
      anyTeamOnlyResolved.length,

    planarOnlyAtAssignedGoldActivation:
      planarOnlyResolved.length,

    stillPersistent:
      stillPersistent.length
  },

  resolutionCounts,

  interpretation: {
    assignedGoldAnchor:
      'If a case is inside 45m at the exact AssignedGold activation tick/position, the prior exception is best treated as a reference-time/reference-point problem rather than a true range exception.',

    anyTeam:
      'Any-team-only resolution is evidence that the current opposing-team eligibility assumption deserves direct validation; it is not proof that same-team players satisfy the mechanic.',

    planar:
      'Planar-only resolution keeps XY geometry alive as a hypothesis but does not establish engine implementation.',

    vacuumTarget:
      'm_hVacuumTarget-derived player identity remains an observed magnetic target, not validated soul acquisition or causal eligibility.',

    persistent:
      'Cases still outside after exact AssignedGold activation geometry remain the strongest candidates for a missing mechanic, incorrect 45m documentation/conversion, or a deeper source-linkage issue.'
  },

  cases: {
    stillPersistent:
      stillPersistent.map(
        compactCase
      ),

    exactActivationResolved:
      exactActivation3DResolved.map(
        compactCase
      ),

    anyTeamOnly:
      anyTeamOnlyResolved.map(
        compactCase
      ),

    planarOnly:
      planarOnlyResolved.map(
        compactCase
      )
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
  analyzedCases
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'PERSISTENT GROUND-SOUL RANGE DIAGNOSTIC V0.1'
);
console.log(
  '========================================================'
);
console.log('');

console.log(
  `Input persistent cases: ${persistent70bCases.length}`
);
console.log(
  `Joined AssignedGold anchors: ${validTargets.length}`
);

console.log('');
console.log(
  'ASSIGNEDGOLD ANCHOR TEST'
);
console.log(
  '------------------------'
);
console.log(
  `Exact activation 3D resolved:       ${exactActivation3DResolved.length}`
);
console.log(
  `+/-0.5s activation 3D resolved:     ${activationHalfSecond3DResolved.length}`
);
console.log(
  `+/-1.0s activation 3D resolved:     ${activationOneSecond3DResolved.length}`
);
console.log(
  `+/-2.0s activation 3D resolved*:    ${activationTwoSecond3DResolved.length}`
);
console.log(
  '* +/-2.0s is diagnostic only, not a mechanic gate.'
);
console.log(
  `AssignedGold point closer @ exact:  ${assignedGoldPointHelps.length}`
);
console.log(
  `Any-team-only exact resolutions:    ${anyTeamOnlyResolved.length}`
);
console.log(
  `Planar-only exact resolutions:      ${planarOnlyResolved.length}`
);
console.log(
  `Still persistent:                   ${stillPersistent.length}`
);

console.log('');
console.log(
  'PRIMARY RESOLUTION CATEGORIES'
);
console.log(
  '-----------------------------'
);

for (
  const [
    category,
    count
  ]
  of Object.entries(
    resolutionCounts
  )
) {
  console.log(
    `${category.padEnd(52)} ${count}`
  );
}

console.log('');
console.log(
  'STILL PERSISTENT CASES'
);
console.log(
  '----------------------'
);

if (
  stillPersistent.length ===
  0
) {
  console.log(
    'None.'
  );
} else {
  for (
    const row
    of stillPersistent
  ) {
    const exactDeath =
      row
        ?.exactAssignedGoldActivationTick
        ?.opposingAlive
        ?.nearestToDeath3D
        ?.distance3D;

    const exactSoul =
      row
        ?.exactAssignedGoldActivationTick
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D;

    const oneSecond =
      row
        ?.windowsAroundAssignedGoldActivation
        ?.['1']
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D;

    console.log(
      `${String(row.death.deathIndex).padStart(4)}  ` +
      `${String(row.death.clock ?? '').padEnd(6)} ` +
      `${String(row.death.baseType ?? '').padEnd(7)} ` +
      `deathRef=${formatNumber(exactDeath)} ` +
      `soulRef=${formatNumber(exactSoul)} ` +
      `1s=${formatNumber(oneSecond)}`
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
    `${name.padEnd(44)} ` +
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
// CASE CLASSIFICATION
// ============================================================

function classifyPersistentCase({
  exactActivation,
  windows,
  vacuumTargetAtActivation
}) {
  const opposingExact3D =
    exactActivation
      ?.opposingAlive
      ?.nearestToAssignedGold3D
      ?.distance3D;

  const opposingExactXY =
    exactActivation
      ?.opposingAlive
      ?.nearestToAssignedGoldXY
      ?.distanceXY;

  const anyExact3D =
    exactActivation
      ?.anyAlive
      ?.nearestToAssignedGold3D
      ?.distance3D;

  if (
    within45m(
      opposingExact3D
    )
  ) {
    return {
      primaryCategory:
        'ASSIGNEDGOLD_ACTIVATION_EXACT_3D_RESOLVED',

      strongestEvidence:
        'Opposing alive player is inside 45m of the matched AssignedGold activation position at the exact activation tick.'
    };
  }

  if (
    within45m(
      anyExact3D
    )
    &&
    !within45m(
      opposingExact3D
    )
  ) {
    return {
      primaryCategory:
        'ANY_TEAM_ONLY_AT_ACTIVATION',

      strongestEvidence:
        'An alive player is inside 45m at activation, but no opposing-team alive player is.'
    };
  }

  if (
    within45m(
      opposingExactXY
    )
  ) {
    return {
      primaryCategory:
        'PLANAR_ONLY_AT_ASSIGNEDGOLD_ACTIVATION',

      strongestEvidence:
        'Opposing player is inside 45m in XY but remains outside in 3D at the exact AssignedGold activation tick.'
    };
  }

  for (
    const seconds
    of [
      0.125,
      0.250,
      0.500,
      1.000
    ]
  ) {
    const distance =
      windows
        ?.[
          String(
            seconds
          )
        ]
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D;

    if (
      within45m(
        distance
      )
    ) {
      return {
        primaryCategory:
          `ASSIGNEDGOLD_ACTIVATION_WITHIN_${Math.round(seconds * 1000)}MS_3D_RESOLVED`,

        strongestEvidence:
          `Opposing alive player crosses inside 45m of AssignedGold position within +/-${seconds}s of activation.`
      };
    }
  }

  if (
    vacuumTargetAtActivation
    &&
    within45m(
      vacuumTargetAtActivation
        ?.distanceToAssignedGold3D
    )
  ) {
    return {
      primaryCategory:
        'VACUUM_TARGET_INSIDE_45M_AT_ACTIVATION',

      strongestEvidence:
        'Observed Script 55 vacuum-target player is inside 45m of AssignedGold at activation.'
    };
  }

  return {
    primaryCategory:
      'STILL_PERSISTENT_AFTER_ASSIGNEDGOLD_ANCHOR_TEST',

    strongestEvidence:
      'No opposing-team 3D resolution through +/-1s around AssignedGold activation, no exact any-team alternative, and no exact planar resolution.'
  };
}


// ============================================================
// SNAPSHOT GEOMETRY
// ============================================================

function summarizeSnapshotGeometry(
  snapshot,
  target,
  opposingTeam
) {
  if (
    !snapshot
  ) {
    return null;
  }

  const alivePlayers =
    snapshot.players.filter(
      player =>
        !player
          ?.aliveState
          ?.definitelyDead
    );

  const opposingAlive =
    alivePlayers.filter(
      player =>
        player.team ===
        opposingTeam
    );

  return {
    tick:
      snapshot.tick,

    matchTimeSeconds:
      snapshot.matchTimeSeconds,

    rawAssignedGold:
      snapshot.rawAssignedGold,

    opposingAlive:
      summarizePlayerGroup(
        opposingAlive
      ),

    anyAlive:
      summarizePlayerGroup(
        alivePlayers
      )
  };
}


function summarizeWindowGeometry(
  snapshots,
  target,
  opposingTeam,
  seconds
) {
  const ticks =
    Math.ceil(
      seconds *
      TICK_RATE
    );

  const rows =
    snapshots.filter(
      row =>
        Math.abs(
          row.tick -
          target.activationTick
        ) <=
        ticks
    );

  const allAlive =
    [];

  const opposingAlive =
    [];

  for (
    const snapshot
    of rows
  ) {
    for (
      const player
      of snapshot.players
    ) {
      if (
        player
          ?.aliveState
          ?.definitelyDead
      ) {
        continue;
      }

      const enriched = {
        ...player,

        activationTickDelta:
          snapshot.tick -
          target.activationTick
      };

      allAlive.push(
        enriched
      );

      if (
        player.team ===
        opposingTeam
      ) {
        opposingAlive.push(
          enriched
        );
      }
    }
  }

  return {
    seconds,

    ticks,

    snapshotCount:
      rows.length,

    opposingAlive:
      summarizePlayerGroup(
        opposingAlive
      ),

    anyAlive:
      summarizePlayerGroup(
        allAlive
      )
  };
}


function summarizePlayerGroup(
  players
) {
  return {
    count:
      players.length,

    nearestToDeath3D:
      nearestBy(
        players,
        'distanceToDeath3D',
        'distance3D'
      ),

    nearestToDeathXY:
      nearestBy(
        players,
        'distanceToDeathXY',
        'distanceXY'
      ),

    nearestToAssignedGold3D:
      nearestBy(
        players,
        'distanceToAssignedGold3D',
        'distance3D'
      ),

    nearestToAssignedGoldXY:
      nearestBy(
        players,
        'distanceToAssignedGoldXY',
        'distanceXY'
      )
  };
}


function nearestBy(
  players,
  sourceKey,
  outputDistanceKey
) {
  const clean =
    players
      .filter(
        player =>
          Number.isFinite(
            player[
              sourceKey
            ]
          )
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a[
            sourceKey
          ] -
          b[
            sourceKey
          ]
      );

  const best =
    clean[0] ??
    null;

  if (
    !best
  ) {
    return null;
  }

  return {
    playerName:
      best.playerName,

    pawnEntityIndex:
      best.pawnEntityIndex,

    team:
      best.team,

    tick:
      best.tick,

    matchTimeSeconds:
      best.matchTimeSeconds,

    activationTickDelta:
      best.activationTickDelta ??
      null,

    position:
      best.position,

    [outputDistanceKey]:
      best[
        sourceKey
      ]
  };
}


// ============================================================
// PLAYER IDENTITY
// ============================================================

function resolvePawnIdentity(
  demo,
  pawn
) {
  const fallback =
    playerByPawnIndex.get(
      pawn.index
    ) ??
    null;

  const controllerHandle =
    firstFinite([
      numberField(
        pawn,
        'm_hController'
      ),

      numberField(
        pawn,
        'm_hDefaultController'
      )
    ]);

  let controller =
    null;

  if (
    Number.isFinite(
      controllerHandle
    )
  ) {
    try {
      controller =
        demo.getEntityByHandle(
          controllerHandle
        );
    } catch {}
  }

  return {
    playerName:
      safeField(
        controller,
        'm_iszPlayerName'
      ) ??
      fallback?.playerName ??
      null,

    team:
      firstFinite([
        numberField(
          controller,
          'm_iTeamNum'
        ),

        numberField(
          pawn,
          'm_iTeamNum'
        ),

        fallback?.team
      ]),

    heroId:
      firstFinite([
        numberField(
          pawn,
          'm_nHeroID'
        ),

        numberField(
          controller,
          'm_nHeroID'
        ),

        fallback?.heroId
      ]),

    controllerEntityIndex:
      controller?.index ??
      fallback?.controllerEntityIndex ??
      null
  };
}


function readPawnAliveState(
  pawn
) {
  const lifeState =
    numberField(
      pawn,
      'm_lifeState'
    );

  const health =
    firstFinite([
      numberField(
        pawn,
        'm_iHealth'
      ),

      numberField(
        pawn,
        'm_iHealthInternal'
      )
    ]);

  const definitelyDead =
    (
      Number.isFinite(
        health
      )
      &&
      health <=
        0
    )
    ||
    (
      Number.isFinite(
        lifeState
      )
      &&
      lifeState !==
        0
    );

  return {
    lifeState,
    health,
    definitelyDead
  };
}


async function loadPlayerIdentity(
  path
) {
  const playerByPawnIndex =
    new Map();

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

    let row;

    try {
      row =
        JSON.parse(
          line
        );
    } catch {
      continue;
    }

    const pawnEntityIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );

    const playerName =
      row
        ?.controller
        ?.playerName ??
      null;

    if (
      pawnEntityIndex ===
        null
      ||
      !playerName
    ) {
      continue;
    }

    playerByPawnIndex.set(
      pawnEntityIndex,
      {
        playerName,

        pawnEntityIndex,

        controllerEntityIndex:
          finite(
            row
              ?.controller
              ?.entityIndex
          ),

        team:
          finite(
            row
              ?.controller
              ?.team
          ),

        heroId:
          finite(
            row
              ?.controller
              ?.heroId
          )
      }
    );
  }

  return {
    playerByPawnIndex
  };
}


// ============================================================
// WORLD POSITION
// ============================================================

function worldPosition(
  entity
) {
  if (
    !entity
  ) {
    return null;
  }

  const cellX =
    numberField(
      entity,
      'CBodyComponent.m_cellX'
    );

  const cellY =
    numberField(
      entity,
      'CBodyComponent.m_cellY'
    );

  const cellZ =
    numberField(
      entity,
      'CBodyComponent.m_cellZ'
    );

  const vecX =
    numberField(
      entity,
      'CBodyComponent.m_vecX'
    );

  const vecY =
    numberField(
      entity,
      'CBodyComponent.m_vecY'
    );

  const vecZ =
    numberField(
      entity,
      'CBodyComponent.m_vecZ'
    );

  if (
    ![
      cellX,
      cellY,
      cellZ,
      vecX,
      vecY,
      vecZ
    ].every(
      Number.isFinite
    )
  ) {
    return null;
  }

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
      cellZ *
      512 -
      16384 +
      vecZ
  };
}


// ============================================================
// OUTPUT HELPERS
// ============================================================

function compactCase(
  row
) {
  return {
    deathIndex:
      row
        ?.death
        ?.deathIndex ??
      null,

    clock:
      row
        ?.death
        ?.clock ??
      null,

    baseType:
      row
        ?.death
        ?.baseType ??
      null,

    deathTick:
      row
        ?.death
        ?.tick ??
      null,

    activationTick:
      row
        ?.assignedGold
        ?.activationTick ??
      null,

    activationTickDelta:
      row
        ?.assignedGold
        ?.deathToActivationTickDelta ??
      null,

    deathToAssignedGoldDistance3D:
      row
        ?.assignedGold
        ?.deathToActivationPositionDistance3D ??
      null,

    exactDeathReference3D:
      row
        ?.exactAssignedGoldActivationTick
        ?.opposingAlive
        ?.nearestToDeath3D
        ?.distance3D ??
      null,

    exactAssignedGoldReference3D:
      row
        ?.exactAssignedGoldActivationTick
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D ??
      null,

    exactAssignedGoldReferenceXY:
      row
        ?.exactAssignedGoldActivationTick
        ?.opposingAlive
        ?.nearestToAssignedGoldXY
        ?.distanceXY ??
      null,

    oneSecondAssignedGoldReference3D:
      row
        ?.windowsAroundAssignedGoldActivation
        ?.['1']
        ?.opposingAlive
        ?.nearestToAssignedGold3D
        ?.distance3D ??
      null,

    vacuumTargetPlayer:
      row
        ?.assignedGold
        ?.vacuumTargetPlayer
        ?.playerName ??
      null,

    resolutionCategory:
      row
        ?.resolution
        ?.primaryCategory ??
      null
  };
}


function compactPlayer(
  player
) {
  return {
    playerName:
      player.playerName,

    pawnEntityIndex:
      player.pawnEntityIndex,

    team:
      player.team,

    position:
      player.position,

    distanceToDeath3D:
      player.distanceToDeath3D,

    distanceToDeathXY:
      player.distanceToDeathXY,

    distanceToAssignedGold3D:
      player.distanceToAssignedGold3D,

    distanceToAssignedGoldXY:
      player.distanceToAssignedGoldXY
  };
}


// ============================================================
// DISTANCE
// ============================================================

function getDistance3D(
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
    dx * dx +
    dy * dy +
    dz * dz
  );
}


function getDistanceXY(
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
    dx * dx +
    dy * dy
  );
}


function within45m(
  value
) {
  return Number.isFinite(
    value
  )
  &&
  value <=
    documentedRangeHU;
}


// ============================================================
// ENTITY FIELDS
// ============================================================

function safeField(
  entity,
  fieldName
) {
  if (
    !entity
  ) {
    return null;
  }

  try {
    return typeof entity.getField ===
      'function'
      ? entity.getField(
        fieldName
      )
      : null;
  } catch {
    return null;
  }
}


function numberField(
  entity,
  fieldName
) {
  return finite(
    safeField(
      entity,
      fieldName
    )
  );
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalizePosition(
  value
) {
  if (
    !value
  ) {
    return null;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    const x =
      finite(
        value[0]
      );

    const y =
      finite(
        value[1]
      );

    const z =
      finite(
        value[2]
      );

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

  if (
    typeof value ===
    'object'
  ) {
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
        value[2]
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

  return null;
}


function parseDeathKeyTick(
  deathKey
) {
  if (
    typeof deathKey !==
    'string'
  ) {
    return null;
  }

  const parts =
    deathKey.split(
      '|'
    );

  if (
    parts.length <
    2
  ) {
    return null;
  }

  return finite(
    parts[
      parts.length -
      1
    ]
  );
}


// ============================================================
// FILES
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
      accept,
      reject
    ) => {
      writer.on(
        'error',
        reject
      );

      writer.end(
        accept
      );
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


function oppositeTeam(
  team
) {
  if (
    team ===
    2
  ) {
    return 3;
  }

  if (
    team ===
    3
  ) {
    return 2;
  }

  return null;
}


function tickToMatchTime(
  tick
) {
  return tick /
    TICK_RATE -
    MATCH_CLOCK_OFFSET_SECONDS;
}


function formatClock(
  timeSeconds
) {
  if (
    !Number.isFinite(
      timeSeconds
    )
  ) {
    return null;
  }

  const sign =
    timeSeconds <
      0
      ? '-'
      : '';

  const absolute =
    Math.abs(
      timeSeconds
    );

  const minutes =
    Math.floor(
      absolute /
      60
    );

  const seconds =
    Math.floor(
      absolute %
      60
    );

  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}


function countByObject(
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
      String(
        selector(
          row
        )
      );

    map.set(
      key,
      (
        map.get(
          key
        ) ??
        0
      ) +
      1
    );
  }

  return Object.fromEntries(
    [
      ...map.entries()
    ].sort(
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