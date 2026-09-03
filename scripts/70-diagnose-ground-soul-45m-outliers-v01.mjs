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
// RAW-REPLAY DIAGNOSTIC WINDOWS
//
// Script 57 reconstructed player positions from the 4 Hz
// player_state stream.
//
// Script 70 instead samples the raw demo state around each
// matched >45m outlier.
//
// EXACT:
//   state on the Trooper death tick.
//
// ENVELOPES:
//   minimum observed distance in raw replay snapshots around
//   the death.
//
// These windows are diagnostic. They do not redefine the game
// mechanic.
// ============================================================

const RAW_ENVELOPE_WINDOWS_SECONDS = [
  0.125,
  0.250,
  0.500,
  1.000
];

const MAX_RAW_ENVELOPE_SECONDS =
  Math.max(
    ...RAW_ENVELOPE_WINDOWS_SECONDS
  );

const MAX_RAW_ENVELOPE_TICKS =
  Math.ceil(
    MAX_RAW_ENVELOPE_SECONDS *
    TICK_RATE
  );


// ============================================================
// POSITION-DISCREPANCY DIAGNOSTIC
// ============================================================

const LARGE_TROOPER_POSITION_SHIFT_HU =
  128;


// ============================================================
// MATCH AMBIGUITY
//
// Script 55 already uses exact maximum-cardinality,
// minimum-cost one-to-one matching.
//
// These flags do not say the match is wrong. They identify cases
// where an outlier belonged to a locally ambiguous candidate
// graph and therefore deserves extra scrutiny.
// ============================================================

const MATCH_DISTANCE_NEAR_LIMIT_HU =
  140;

const MATCH_TICK_EDGE_ABS =
  4;


// ============================================================
// OUTPUT LIMITS
// ============================================================

const MAX_EXAMPLES_PER_CATEGORY =
  30;


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );

const script57SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_range_validation_v01.json'
  );

const script57OutlierPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_range_outliers_v01.jsonl'
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
    'trooper_ground_soul_45m_outlier_diagnostic_v01.json'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_45m_outlier_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    script57SummaryPath,
    script57OutlierPath,
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
// LOAD SCRIPT 57
// ============================================================

console.log('');
console.log(
  'Loading Script 57 range validation...'
);

const script57Summary =
  JSON.parse(
    readFileSync(
      script57SummaryPath,
      'utf8'
    )
  );

const documentedRangeHU =
  finite(
    script57Summary
      ?.documentedMechanicTarget
      ?.rangeInternalUnits
  );

const documentedRangeMeters =
  finite(
    script57Summary
      ?.documentedMechanicTarget
      ?.rangeMeters
  ) ??
  45;

if (
  documentedRangeHU ===
  null
) {
  throw new Error(
    'Could not recover documented 45m internal-unit threshold from Script 57.'
  );
}

const rawScript57Outliers =
  await loadJsonl(
    script57OutlierPath
  );

const targetOutliers =
  rawScript57Outliers
    .filter(
      row =>
        row?.category ===
        'MATCHED_OUTSIDE_DOCUMENTED_45M'
    )
    .map(
      normalizeScript57Outlier
    )
    .filter(
      Boolean
    )
    .sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
        ||
        a.deathIndex -
        b.deathIndex
    );

console.log(
  `Documented range: ${documentedRangeHU.toFixed(3)} HU (${documentedRangeMeters}m)`
);

console.log(
  `Matched >45m outliers: ${targetOutliers.length}`
);


// ============================================================
// LOAD SCRIPT 55 SUMMARY
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
    'Script 55 one-to-one ground-soul summary did not PASS.'
  );
}


// ============================================================
// LOAD FULL DEATH STREAM
//
// We need:
// - original Script 55 match metadata
// - candidate ambiguity
// - same-tick death cohorts
// ============================================================

console.log(
  'Loading Script 55 death stream...'
);

const rawDeathRows =
  await loadJsonl(
    deathStreamPath
  );

const normalizedDeaths =
  rawDeathRows
    .map(
      (
        row,
        streamIndex
      ) =>
        normalizeDeathStreamRow(
          row,
          streamIndex
        )
    )
    .filter(
      Boolean
    );

const deathByIndex =
  new Map();

const deathsByTick =
  new Map();

for (
  const death
  of normalizedDeaths
) {
  if (
    Number.isFinite(
      death.deathIndex
    )
  ) {
    deathByIndex.set(
      death.deathIndex,
      death
    );
  }

  if (
    !deathsByTick.has(
      death.tick
    )
  ) {
    deathsByTick.set(
      death.tick,
      []
    );
  }

  deathsByTick
    .get(
      death.tick
    )
    .push(
      death
    );
}

console.log(
  `Death stream rows: ${normalizedDeaths.length}`
);


// ============================================================
// LOAD PLAYER IDENTITIES
//
// Used as a fallback identity map if controller resolution from
// the raw demo is temporarily unavailable.
// ============================================================

console.log(
  'Loading player identities...'
);

const playerIdentity =
  await loadPlayerIdentity(
    playerStatePath
  );

const playerByPawnIndex =
  playerIdentity
    .playerByPawnIndex;

console.log(
  `Player pawn identities: ${playerByPawnIndex.size}`
);


// ============================================================
// TARGET TICK INDEX
// ============================================================

const targetByTick =
  new Map();

const ticksOfInterest =
  new Set();

for (
  const outlier
  of targetOutliers
) {
  targetByTick.set(
    outlier.tick,
    [
      ...(
        targetByTick.get(
          outlier.tick
        ) ??
        []
      ),
      outlier
    ]
  );

  for (
    let tick =
      outlier.tick -
      MAX_RAW_ENVELOPE_TICKS;

    tick <=
      outlier.tick +
      MAX_RAW_ENVELOPE_TICKS;

    tick++
  ) {
    ticksOfInterest.add(
      tick
    );
  }
}


// ============================================================
// RAW REPLAY SNAPSHOTS
//
// Key:
//   deathIndex -> snapshot rows
//
// Each snapshot contains direct current replay state for every
// opposing player pawn around that outlier.
// ============================================================

const rawSnapshotsByDeathIndex =
  new Map();

for (
  const outlier
  of targetOutliers
) {
  rawSnapshotsByDeathIndex.set(
    outlier.deathIndex,
    []
  );
}


// ============================================================
// RAW TROOPER SNAPSHOTS
//
// Used to determine whether Script 57's stored death position is
// stale or materially displaced from the raw Trooper entity at
// the death tick.
// ============================================================

const rawTrooperSnapshotsByDeathIndex =
  new Map();

for (
  const outlier
  of targetOutliers
) {
  rawTrooperSnapshotsByDeathIndex.set(
    outlier.deathIndex,
    []
  );
}


// ============================================================
// PARSER
// ============================================================

const parser =
  new Parser();

let inspectedDemoPackets =
  0;

let relevantDemoPackets =
  0;


// ============================================================
// RAW DEMO PACKET SAMPLING
// ============================================================

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

    inspectedDemoPackets++;

    if (
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

    const troopers =
      demo.getEntitiesByClassName(
        'CNPC_Trooper'
      );

    for (
      const outlier
      of targetOutliers
    ) {
      const tickDelta =
        tick -
        outlier.tick;

      if (
        Math.abs(
          tickDelta
        ) >
        MAX_RAW_ENVELOPE_TICKS
      ) {
        continue;
      }

      const opposingTeam =
        oppositeTeam(
          outlier.team
        );

      if (
        opposingTeam ===
        null
      ) {
        continue;
      }

      const playerSnapshots =
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

        const team =
          finite(
            identity.team
          );

        if (
          team !==
          opposingTeam
        ) {
          continue;
        }

        const aliveState =
          readPawnAliveState(
            pawn
          );

        if (
          aliveState.definitelyDead
        ) {
          continue;
        }

        const distanceToStoredDeath3D =
          getDistance3D(
            outlier.deathPosition,
            position
          );

        const distanceToStoredDeathXY =
          getDistanceXY(
            outlier.deathPosition,
            position
          );

        playerSnapshots.push({
          tick,

          matchTimeSeconds:
            tickToMatchTime(
              tick
            ),

          tickDelta,

          playerName:
            identity.playerName,

          pawnEntityIndex:
            pawn.index,

          controllerEntityIndex:
            identity.controllerEntityIndex,

          team,

          heroId:
            identity.heroId,

          aliveState,

          position,

          distanceToStoredDeath3D,

          distanceToStoredDeathXY
        });
      }

      playerSnapshots.sort(
        (
          a,
          b
        ) =>
          a.distanceToStoredDeath3D -
          b.distanceToStoredDeath3D
          ||
          a.pawnEntityIndex -
          b.pawnEntityIndex
      );

      rawSnapshotsByDeathIndex
        .get(
          outlier.deathIndex
        )
        .push({
          tick,

          tickDelta,

          matchTimeSeconds:
            tickToMatchTime(
              tick
            ),

          opponents:
            playerSnapshots
        });

      // ======================================================
      // RAW TROOPER POSITION
      // ======================================================

      const trooper =
        troopers.find(
          entity =>
            entity.index ===
            outlier.entityIndex
        ) ??
        null;

      if (
        trooper
      ) {
        const rawTrooperPosition =
          worldPosition(
            trooper
          );

        if (
          rawTrooperPosition
        ) {
          rawTrooperSnapshotsByDeathIndex
            .get(
              outlier.deathIndex
            )
            .push({
              tick,

              tickDelta,

              matchTimeSeconds:
                tickToMatchTime(
                  tick
                ),

              position:
                rawTrooperPosition,

              storedDeathPositionDifference3D:
                getDistance3D(
                  outlier.deathPosition,
                  rawTrooperPosition
                ),

              storedDeathPositionDifferenceXY:
                getDistanceXY(
                  outlier.deathPosition,
                  rawTrooperPosition
                ),

              health:
                numberField(
                  trooper,
                  'm_iHealth'
                ),

              lifeState:
                numberField(
                  trooper,
                  'm_lifeState'
                ),

              team:
                numberField(
                  trooper,
                  'm_iTeamNum'
                )
            });
        }
      }
    }
  }
);


// ============================================================
// RUN RAW REPLAY PASS
// ============================================================

console.log('');
console.log(
  'Rescanning raw replay around the Script 57 outliers...'
);
console.log('');

await parser.parse(
  createReadStream(
    replayPath
  )
);

await parser.dispose();


// ============================================================
// ANALYZE EACH OUTLIER
// ============================================================

const cases =
  [];

for (
  const outlier
  of targetOutliers
) {
  const rawDeathRow =
    deathByIndex.get(
      outlier.deathIndex
    ) ??
    null;

  const rawSnapshots =
    (
      rawSnapshotsByDeathIndex.get(
        outlier.deathIndex
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

  const rawTrooperSnapshots =
    (
      rawTrooperSnapshotsByDeathIndex.get(
        outlier.deathIndex
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

  const exactTickSnapshots =
    rawSnapshots.filter(
      row =>
        row.tickDelta ===
        0
    );

  const exactTickOpponents =
    exactTickSnapshots
      .flatMap(
        row =>
          row.opponents
      );

  exactTickOpponents.sort(
    (
      a,
      b
    ) =>
      a.distanceToStoredDeath3D -
      b.distanceToStoredDeath3D
  );

  const exactNearest =
    exactTickOpponents[0] ??
    null;

  const exactTrooperSnapshot =
    chooseClosestTickSnapshot(
      rawTrooperSnapshots,
      0
    );

  const rawTrooperPosition =
    exactTrooperSnapshot
      ?.tickDelta ===
      0
      ? exactTrooperSnapshot.position
      : null;

  const exactDistancesUsingRawTrooper =
    rawTrooperPosition
      ? exactTickOpponents
        .map(
          opponent => ({
            ...opponent,

            distanceToRawTrooper3D:
              getDistance3D(
                rawTrooperPosition,
                opponent.position
              ),

            distanceToRawTrooperXY:
              getDistanceXY(
                rawTrooperPosition,
                opponent.position
              )
          })
        )
        .sort(
          (
            a,
            b
          ) =>
            a.distanceToRawTrooper3D -
            b.distanceToRawTrooper3D
        )
      : [];

  const exactNearestUsingRawTrooper =
    exactDistancesUsingRawTrooper[0] ??
    null;

  const envelopeResults =
    {};

  for (
    const windowSeconds
    of RAW_ENVELOPE_WINDOWS_SECONDS
  ) {
    const ticks =
      Math.ceil(
        windowSeconds *
        TICK_RATE
      );

    const snapshots =
      rawSnapshots.filter(
        row =>
          Math.abs(
            row.tickDelta
          ) <=
          ticks
      );

    const allOpponents =
      snapshots
        .flatMap(
          row =>
            row.opponents
        );

    const nearest3D =
      allOpponents
        .slice()
        .sort(
          (
            a,
            b
          ) =>
            a.distanceToStoredDeath3D -
            b.distanceToStoredDeath3D
        )[0] ??
      null;

    const nearestXY =
      allOpponents
        .slice()
        .sort(
          (
            a,
            b
          ) =>
            a.distanceToStoredDeathXY -
            b.distanceToStoredDeathXY
        )[0] ??
      null;

    let nearestRawTrooper3D =
      null;

    let nearestRawTrooperXY =
      null;

    // For each tick, use the raw Trooper position from the same
    // tick if it exists.
    for (
      const snapshot
      of snapshots
    ) {
      const sameTickTrooper =
        rawTrooperSnapshots.find(
          row =>
            row.tick ===
            snapshot.tick
        ) ??
        null;

      if (
        !sameTickTrooper
      ) {
        continue;
      }

      for (
        const opponent
        of snapshot.opponents
      ) {
        const distance3D =
          getDistance3D(
            sameTickTrooper.position,
            opponent.position
          );

        const distanceXY =
          getDistanceXY(
            sameTickTrooper.position,
            opponent.position
          );

        if (
          !nearestRawTrooper3D
          ||
          distance3D <
            nearestRawTrooper3D.distance3D
        ) {
          nearestRawTrooper3D = {
            tick:
              snapshot.tick,

            tickDelta:
              snapshot.tickDelta,

            matchTimeSeconds:
              snapshot.matchTimeSeconds,

            playerName:
              opponent.playerName,

            playerPosition:
              opponent.position,

            trooperPosition:
              sameTickTrooper.position,

            distance3D,

            distanceXY
          };
        }

        if (
          !nearestRawTrooperXY
          ||
          distanceXY <
            nearestRawTrooperXY.distanceXY
        ) {
          nearestRawTrooperXY = {
            tick:
              snapshot.tick,

            tickDelta:
              snapshot.tickDelta,

            matchTimeSeconds:
              snapshot.matchTimeSeconds,

            playerName:
              opponent.playerName,

            playerPosition:
              opponent.position,

            trooperPosition:
              sameTickTrooper.position,

            distance3D,

            distanceXY
          };
        }
      }
    }

    envelopeResults[
      String(
        windowSeconds
      )
    ] = {
      windowSeconds,

      windowTicks:
        ticks,

      storedDeathPosition: {
        nearest3D:
          compactOpponentDistance(
            nearest3D,
            'distanceToStoredDeath3D',
            'distanceToStoredDeathXY'
          ),

        nearestXY:
          compactOpponentDistance(
            nearestXY,
            'distanceToStoredDeath3D',
            'distanceToStoredDeathXY'
          )
      },

      rawTrooperPosition: {
        nearest3D:
          nearestRawTrooper3D,

        nearestXY:
          nearestRawTrooperXY
      }
    };
  }

  // ==========================================================
  // SCRIPT 55 MATCH INTEGRITY
  // ==========================================================

  const sameTickDeaths =
    deathsByTick.get(
      outlier.tick
    ) ??
    [];

  const matchDiagnostic =
    buildMatchDiagnostic(
      rawDeathRow,
      sameTickDeaths
    );

  // ==========================================================
  // RAW 45M FLAGS
  // ==========================================================

  const exactStored3D =
    exactNearest
      ?.distanceToStoredDeath3D ??
    null;

  const exactStoredXY =
    exactNearest
      ?.distanceToStoredDeathXY ??
    null;

  const exactRaw3D =
    exactNearestUsingRawTrooper
      ?.distanceToRawTrooper3D ??
    null;

  const exactRawXY =
    exactNearestUsingRawTrooper
      ?.distanceToRawTrooperXY ??
    null;

  const halfSecond =
    envelopeResults[
      '0.5'
    ];

  const envelopeStored3D =
    halfSecond
      ?.storedDeathPosition
      ?.nearest3D
      ?.distance3D ??
    null;

  const envelopeStoredXY =
    halfSecond
      ?.storedDeathPosition
      ?.nearestXY
      ?.distanceXY ??
    null;

  const envelopeRaw3D =
    halfSecond
      ?.rawTrooperPosition
      ?.nearest3D
      ?.distance3D ??
    null;

  const envelopeRawXY =
    halfSecond
      ?.rawTrooperPosition
      ?.nearestXY
      ?.distanceXY ??
    null;

  const storedPositionShift =
    exactTrooperSnapshot
      ?.storedDeathPositionDifference3D ??
    null;

  const rawResolution = {
    exactStored3DWithin45m:
      withinThreshold(
        exactStored3D,
        documentedRangeHU
      ),

    exactStoredXYWithin45m:
      withinThreshold(
        exactStoredXY,
        documentedRangeHU
      ),

    exactRawTrooper3DWithin45m:
      withinThreshold(
        exactRaw3D,
        documentedRangeHU
      ),

    exactRawTrooperXYWithin45m:
      withinThreshold(
        exactRawXY,
        documentedRangeHU
      ),

    halfSecondStored3DWithin45m:
      withinThreshold(
        envelopeStored3D,
        documentedRangeHU
      ),

    halfSecondStoredXYWithin45m:
      withinThreshold(
        envelopeStoredXY,
        documentedRangeHU
      ),

    halfSecondRawTrooper3DWithin45m:
      withinThreshold(
        envelopeRaw3D,
        documentedRangeHU
      ),

    halfSecondRawTrooperXYWithin45m:
      withinThreshold(
        envelopeRawXY,
        documentedRangeHU
      ),

    largeStoredVsRawTrooperPositionShift:
      Number.isFinite(
        storedPositionShift
      )
      &&
      storedPositionShift >
        LARGE_TROOPER_POSITION_SHIFT_HU
  };

  const diagnosticFlags =
    [];

  if (
    rawResolution.exactRawTrooper3DWithin45m
    ||
    rawResolution.exactStored3DWithin45m
  ) {
    diagnosticFlags.push(
      'RAW_EXACT_TICK_3D_RESOLUTION'
    );
  }

  if (
    !rawResolution.exactRawTrooper3DWithin45m
    &&
    !rawResolution.exactStored3DWithin45m
    &&
    (
      rawResolution.halfSecondRawTrooper3DWithin45m
      ||
      rawResolution.halfSecondStored3DWithin45m
    )
  ) {
    diagnosticFlags.push(
      'RAW_TEMPORAL_ENVELOPE_3D_RESOLUTION'
    );
  }

  if (
    (
      rawResolution.exactRawTrooperXYWithin45m
      ||
      rawResolution.exactStoredXYWithin45m
    )
    &&
    !(
      rawResolution.exactRawTrooper3DWithin45m
      ||
      rawResolution.exactStored3DWithin45m
    )
  ) {
    diagnosticFlags.push(
      'PLANAR_XY_ONLY_AT_EXACT_TICK'
    );
  }

  if (
    !(
      rawResolution.exactRawTrooperXYWithin45m
      ||
      rawResolution.exactStoredXYWithin45m
    )
    &&
    (
      rawResolution.halfSecondRawTrooperXYWithin45m
      ||
      rawResolution.halfSecondStoredXYWithin45m
    )
    &&
    !(
      rawResolution.halfSecondRawTrooper3DWithin45m
      ||
      rawResolution.halfSecondStored3DWithin45m
    )
  ) {
    diagnosticFlags.push(
      'PLANAR_XY_ONLY_WITHIN_HALF_SECOND'
    );
  }

  if (
    rawResolution.largeStoredVsRawTrooperPositionShift
  ) {
    diagnosticFlags.push(
      'TROOPER_DEATH_POSITION_RECONSTRUCTION_DIFFERENCE'
    );
  }

  if (
    matchDiagnostic.ambiguous
  ) {
    diagnosticFlags.push(
      'SCRIPT55_MATCH_AMBIGUITY'
    );
  }

  if (
    sameTickDeaths.length >
    1
  ) {
    diagnosticFlags.push(
      'MULTIPLE_ELIGIBLE_DEATHS_SAME_TICK'
    );
  }

  const persistent3D =
    !rawResolution.exactStored3DWithin45m
    &&
    !rawResolution.exactRawTrooper3DWithin45m
    &&
    !rawResolution.halfSecondStored3DWithin45m
    &&
    !rawResolution.halfSecondRawTrooper3DWithin45m;

  if (
    persistent3D
  ) {
    diagnosticFlags.push(
      'PERSISTENT_RAW_3D_OUTLIER'
    );
  }

  const primaryDiagnosticCategory =
    selectPrimaryCategory(
      rawResolution,
      matchDiagnostic,
      sameTickDeaths
    );

  cases.push({
    schemaVersion:
      1,

    canonical:
      false,

    category:
      'MATCHED_OUTSIDE_DOCUMENTED_45M',

    primaryDiagnosticCategory,

    diagnosticFlags,

    death: {
      deathIndex:
        outlier.deathIndex,

      deathKey:
        outlier.deathKey,

      entityIndex:
        outlier.entityIndex,

      tick:
        outlier.tick,

      timeSeconds:
        outlier.timeSeconds,

      clock:
        outlier.clock,

      baseType:
        outlier.baseType,

      variantLabel:
        outlier.variantLabel,

      team:
        outlier.team,

      lane:
        outlier.lane,

      storedDeathPosition:
        outlier.deathPosition
    },

    script57: {
      nearestDistance3D:
        outlier.nearestDistance3D,

      nearestDistanceXY:
        outlier.nearestDistanceXY,

      nearestEnvelopeDistance3D:
        outlier.nearestEnvelopeDistance3D,

      envelopeResolved:
        outlier.envelopeResolved,

      nearestOpponent:
        outlier.nearestOpponent
    },

    rawReplay: {
      exactTick: {
        playerSnapshotCount:
          exactTickOpponents.length,

        nearestUsingStoredDeathPosition:
          exactNearest,

        rawTrooperSnapshot:
          exactTrooperSnapshot,

        nearestUsingRawTrooperPosition:
          exactNearestUsingRawTrooper
      },

      envelopes:
        envelopeResults
    },

    rawResolution,

    script55Match:
      matchDiagnostic,

    sameTickDeathCohort:
      sameTickDeaths.map(
        compactSameTickDeath
      ),

    originalDeathStreamMatch: {
      match:
        rawDeathRow
          ?.raw
          ?.match ??
        null,

      groundSoul:
        rawDeathRow
          ?.raw
          ?.groundSoul ??
        null
    }
  });
}


// ============================================================
// SUMMARY COUNTS
// ============================================================

const categoryCounts =
  countByObject(
    cases,
    row =>
      row.primaryDiagnosticCategory
  );

const flagCounts =
  countMany(
    cases.flatMap(
      row =>
        row.diagnosticFlags
    )
  );

const persistentCases =
  cases.filter(
    row =>
      row.diagnosticFlags.includes(
        'PERSISTENT_RAW_3D_OUTLIER'
      )
  );

const exact3DResolvedCases =
  cases.filter(
    row =>
      row.diagnosticFlags.includes(
        'RAW_EXACT_TICK_3D_RESOLUTION'
      )
  );

const envelope3DResolvedCases =
  cases.filter(
    row =>
      row.diagnosticFlags.includes(
        'RAW_TEMPORAL_ENVELOPE_3D_RESOLUTION'
      )
  );

const planarOnlyCases =
  cases.filter(
    row =>
      row.diagnosticFlags.includes(
        'PLANAR_XY_ONLY_AT_EXACT_TICK'
      )
      ||
      row.diagnosticFlags.includes(
        'PLANAR_XY_ONLY_WITHIN_HALF_SECOND'
      )
  );

const matchAmbiguousCases =
  cases.filter(
    row =>
      row.diagnosticFlags.includes(
        'SCRIPT55_MATCH_AMBIGUITY'
      )
  );

const deathPositionShiftCases =
  cases.filter(
    row =>
      row.diagnosticFlags.includes(
        'TROOPER_DEATH_POSITION_RECONSTRUCTION_DIFFERENCE'
      )
  );


// ============================================================
// DISTRIBUTIONS
// ============================================================

const script57ExcessHU =
  cases
    .map(
      row =>
        Number.isFinite(
          row
            ?.script57
            ?.nearestDistance3D
        )
          ? row.script57.nearestDistance3D -
            documentedRangeHU
          : null
    )
    .filter(
      Number.isFinite
    );

const rawExact3D =
  cases
    .map(
      row =>
        firstFinite([
          row
            ?.rawReplay
            ?.exactTick
            ?.nearestUsingRawTrooperPosition
            ?.distanceToRawTrooper3D,

          row
            ?.rawReplay
            ?.exactTick
            ?.nearestUsingStoredDeathPosition
            ?.distanceToStoredDeath3D
        ])
    )
    .filter(
      Number.isFinite
    );

const rawHalfSecond3D =
  cases
    .map(
      row =>
        firstFinite([
          row
            ?.rawReplay
            ?.envelopes
            ?.[
              '0.5'
            ]
            ?.rawTrooperPosition
            ?.nearest3D
            ?.distance3D,

          row
            ?.rawReplay
            ?.envelopes
            ?.[
              '0.5'
            ]
            ?.storedDeathPosition
            ?.nearest3D
            ?.distance3D
        ])
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks = {
  script55Pass:
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

  script57OutlierCountPreserved:
    check(
      targetOutliers.length,
      script57Summary
        ?.documented45mTest
        ?.matchedOutside45m,
      targetOutliers.length ===
        script57Summary
          ?.documented45mTest
          ?.matchedOutside45m
    ),

  expectedOutlierCountForTestReplay:
    check(
      targetOutliers.length,
      replayName ===
        'test'
        ? 15
        : '>0',
      replayName ===
        'test'
        ? targetOutliers.length ===
          15
        : targetOutliers.length >
          0
    ),

  deathStreamRowsAvailable:
    check(
      normalizedDeaths.length,
      '>0',
      normalizedDeaths.length >
        0
    ),

  allOutliersJoinedToDeathStream:
    check(
      cases.filter(
        row =>
          deathByIndex.has(
            row.death.deathIndex
          )
      ).length,
      targetOutliers.length,
      cases.every(
        row =>
          deathByIndex.has(
            row.death.deathIndex
          )
      )
    ),

  rawReplayRelevantPacketsObserved:
    check(
      relevantDemoPackets,
      '>0',
      relevantDemoPackets >
        0
    ),

  exactTickPlayerStateObservedForMostOutliers:
    check(
      cases.filter(
        row =>
          (
            row
              ?.rawReplay
              ?.exactTick
              ?.playerSnapshotCount ??
            0
          ) >
          0
      ).length,
      '>=80% of outliers',
      cases.filter(
        row =>
          (
            row
              ?.rawReplay
              ?.exactTick
              ?.playerSnapshotCount ??
            0
          ) >
          0
      ).length >=
        Math.ceil(
          targetOutliers.length *
          0.80
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
// OVERALL INTERPRETATION
// ============================================================

let rangeInterpretation =
  'PERSISTENT_OUTLIERS_REQUIRE_ADDITIONAL_MECHANIC_DISCOVERY';

if (
  persistentCases.length ===
  0
) {
  rangeInterpretation =
    'ALL_SCRIPT57_3D_OUTLIERS_EXPLAINED_BY_RAW_REPLAY_GEOMETRY_OR_TIMING';
}

if (
  persistentCases.length >
    0
  &&
  persistentCases.length <=
    3
) {
  rangeInterpretation =
    'DOCUMENTED_45M_RANGE_STRONGLY_SUPPORTED_WITH_SMALL_PERSISTENT_EXCEPTION_SET';
}

if (
  persistentCases.length >
    3
  &&
  planarOnlyCases.length >
    0
) {
  rangeInterpretation =
    'MIXED_3D_AND_PLANAR_GEOMETRY_EXPLANATIONS_REQUIRE_FURTHER_VALIDATION';
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {
  replay:
    replayName,

  version:
    'TROOPER_GROUND_SOUL_45M_OUTLIER_DIAGNOSTIC_V01',

  canonical:
    false,

  status:
    validationPass
      ? rangeInterpretation
      : 'DIAGNOSTIC_PIPELINE_FAILURE',

  purpose: [
    'Investigate Script 57 matched ground-soul deaths reconstructed outside the documented 45m eligibility range.',
    'Rescan raw replay player-pawn positions at the exact Trooper death tick instead of relying only on the 4 Hz player_state stream.',
    'Separate 3D-range failures from planar-XY-only cases.',
    'Identify local Script 55 one-to-one matching ambiguity without assuming ambiguous matches are wrong.',
    'Preserve persistent unexplained cases for further mechanic discovery rather than forcing them into the 45m model.'
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

    script57Summary:
      script57SummaryPath,

    script57Outliers:
      script57OutlierPath,

    script55DeathStream:
      deathStreamPath,

    script55Summary:
      script55SummaryPath,

    playerState:
      playerStatePath
  },

  sourceCounts: {
    script57MatchedOutside45m:
      targetOutliers.length,

    deathStreamRows:
      normalizedDeaths.length,

    rawReplayDemoPacketsInspected:
      inspectedDemoPackets,

    rawReplayRelevantDemoPackets:
      relevantDemoPackets
  },

  results: {
    primaryCategoryCounts:
      categoryCounts,

    diagnosticFlagCounts:
      flagCounts,

    rawExactTick3DResolved:
      exact3DResolvedCases.length,

    rawHalfSecond3DResolvedAdditional:
      envelope3DResolvedCases.length,

    planarOnlyCases:
      planarOnlyCases.length,

    script55MatchAmbiguityCases:
      matchAmbiguousCases.length,

    largeTrooperDeathPositionShiftCases:
      deathPositionShiftCases.length,

    persistentRaw3DOutliers:
      persistentCases.length
  },

  distributions: {
    script57DistanceBeyond45mHU:
      summarizeNumbers(
        script57ExcessHU
      ),

    rawExactNearest3D:
      summarizeNumbers(
        rawExact3D
      ),

    rawHalfSecondMinimum3D:
      summarizeNumbers(
        rawHalfSecond3D
      )
  },

  interpretation: {
    range:
      rangeInterpretation,

    exactTick:
      'If an outlier is <=45m in raw exact-tick replay state, the Script 57 violation is best treated as a 4 Hz sampling/interpolation artifact.',

    temporalEnvelope:
      'If exact-tick 3D remains outside but raw ±0.5 s crosses inside, timing and state-transition granularity remain plausible explanations.',

    planarGeometry:
      'XY-only resolution is evidence that vertical geometry deserves explicit testing; it is not proof that the engine mechanic is planar.',

    matchAmbiguity:
      'A Script 55 ambiguous candidate component is a matching-quality flag only. It does not invalidate a ground-soul match by itself.',

    persistent:
      'Persistent raw 3D outliers should remain explicit exceptions until their AssignedGold linkage, entity state, or mechanic-specific geometry is independently explained.'
  },

  examples: {
    exactTick3DResolved:
      exact3DResolvedCases
        .slice(
          0,
          MAX_EXAMPLES_PER_CATEGORY
        )
        .map(
          compactCase
        ),

    envelope3DResolved:
      envelope3DResolvedCases
        .slice(
          0,
          MAX_EXAMPLES_PER_CATEGORY
        )
        .map(
          compactCase
        ),

    planarOnly:
      planarOnlyCases
        .slice(
          0,
          MAX_EXAMPLES_PER_CATEGORY
        )
        .map(
          compactCase
        ),

    matchAmbiguous:
      matchAmbiguousCases
        .slice(
          0,
          MAX_EXAMPLES_PER_CATEGORY
        )
        .map(
          compactCase
        ),

    persistent:
      persistentCases
        .slice(
          0,
          MAX_EXAMPLES_PER_CATEGORY
        )
        .map(
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
  cases
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'GROUND SOUL 45M OUTLIER DIAGNOSTIC V0.1'
);
console.log(
  '========================================================'
);
console.log('');

console.log(
  `Documented threshold: ${documentedRangeHU.toFixed(3)} HU (${documentedRangeMeters}m)`
);

console.log(
  `Script 57 matched >45m cases: ${targetOutliers.length}`
);

console.log('');
console.log(
  'RAW REPLAY RESULTS'
);
console.log(
  '------------------'
);

console.log(
  `Exact-tick 3D resolved:        ${exact3DResolvedCases.length}`
);

console.log(
  `±0.5s 3D resolved additional:  ${envelope3DResolvedCases.length}`
);

console.log(
  `Planar-only candidates:        ${planarOnlyCases.length}`
);

console.log(
  `Script55 ambiguity flags:      ${matchAmbiguousCases.length}`
);

console.log(
  `Large death-position shifts:   ${deathPositionShiftCases.length}`
);

console.log(
  `Persistent raw 3D outliers:    ${persistentCases.length}`
);

console.log('');
console.log(
  'PRIMARY CATEGORIES'
);
console.log(
  '------------------'
);

for (
  const [
    category,
    count
  ]
  of Object.entries(
    categoryCounts
  )
) {
  console.log(
    `${category.padEnd(46)} ${count}`
  );
}

console.log('');
console.log(
  'PERSISTENT CASES'
);
console.log(
  '----------------'
);

if (
  persistentCases.length ===
  0
) {
  console.log(
    'None.'
  );
} else {
  for (
    const row
    of persistentCases
  ) {
    const exact =
      firstFinite([
        row
          ?.rawReplay
          ?.exactTick
          ?.nearestUsingRawTrooperPosition
          ?.distanceToRawTrooper3D,

        row
          ?.rawReplay
          ?.exactTick
          ?.nearestUsingStoredDeathPosition
          ?.distanceToStoredDeath3D
      ]);

    const envelope =
      firstFinite([
        row
          ?.rawReplay
          ?.envelopes
          ?.[
            '0.5'
          ]
          ?.rawTrooperPosition
          ?.nearest3D
          ?.distance3D,

        row
          ?.rawReplay
          ?.envelopes
          ?.[
            '0.5'
          ]
          ?.storedDeathPosition
          ?.nearest3D
          ?.distance3D
      ]);

    console.log(
      `${String(row.death.deathIndex).padStart(4)}  ` +
      `${row.death.clock.padEnd(6)} ` +
      `${row.death.baseType.padEnd(7)} ` +
      `exact=${formatNumber(exact)} ` +
      `env=${formatNumber(envelope)} ` +
      `flags=${row.diagnosticFlags.join(',')}`
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
// PRIMARY CATEGORY
// ============================================================

function selectPrimaryCategory(
  resolution,
  matchDiagnostic,
  sameTickDeaths
) {
  if (
    resolution.exactRawTrooper3DWithin45m
    ||
    resolution.exactStored3DWithin45m
  ) {
    return 'RAW_EXACT_TICK_3D_RESOLVED';
  }

  if (
    resolution.halfSecondRawTrooper3DWithin45m
    ||
    resolution.halfSecondStored3DWithin45m
  ) {
    return 'RAW_HALF_SECOND_3D_RESOLVED';
  }

  if (
    resolution.exactRawTrooperXYWithin45m
    ||
    resolution.exactStoredXYWithin45m
  ) {
    return 'PLANAR_XY_ONLY_EXACT_TICK';
  }

  if (
    resolution.halfSecondRawTrooperXYWithin45m
    ||
    resolution.halfSecondStoredXYWithin45m
  ) {
    return 'PLANAR_XY_ONLY_HALF_SECOND';
  }

  if (
    resolution.largeStoredVsRawTrooperPositionShift
  ) {
    return 'TROOPER_POSITION_RECONSTRUCTION_CANDIDATE';
  }

  if (
    matchDiagnostic.ambiguous
    ||
    sameTickDeaths.length >
      1
  ) {
    return 'SCRIPT55_MATCHING_AMBIGUITY_CANDIDATE';
  }

  return 'PERSISTENT_RAW_3D_OUTLIER';
}


// ============================================================
// SCRIPT 55 MATCH DIAGNOSTIC
// ============================================================

function buildMatchDiagnostic(
  death,
  sameTickDeaths
) {
  if (
    !death
  ) {
    return {
      available:
        false,

      ambiguous:
        true,

      reason:
        'DEATH_STREAM_ROW_NOT_FOUND'
    };
  }

  const raw =
    death.raw;

  const match =
    raw?.match ??
    {};

  const groundSoul =
    raw?.groundSoul ??
    {};

  const deathCandidateCount =
    firstFinite([
      match?.deathCandidateCount,
      match?.candidateActivationCount,
      raw?.candidateActivationCount
    ]) ??
    0;

  const activationCandidateCount =
    firstFinite([
      match?.activationCandidateCount,
      groundSoul?.candidateDeathCount
    ]) ??
    0;

  const tickDelta =
    firstFinite([
      match?.tickDelta,
      match?.deltaTicks
    ]);

  const matchDistance3D =
    firstFinite([
      match?.distance3D,
      match?.distance
    ]);

  const confidence =
    firstString([
      match?.confidence,
      raw?.confidence
    ]);

  const multipleDeathCandidates =
    deathCandidateCount >
    1;

  const multipleActivationCandidates =
    activationCandidateCount >
    1;

  const sameTickCohort =
    sameTickDeaths.length >
    1;

  const nearSpatialMatchLimit =
    Number.isFinite(
      matchDistance3D
    )
    &&
    matchDistance3D >=
      MATCH_DISTANCE_NEAR_LIMIT_HU;

  const tickAtMatchEdge =
    Number.isFinite(
      tickDelta
    )
    &&
    Math.abs(
      tickDelta
    ) >=
      MATCH_TICK_EDGE_ABS;

  const ambiguous =
    multipleDeathCandidates
    ||
    multipleActivationCandidates
    ||
    nearSpatialMatchLimit
    ||
    tickAtMatchEdge
    ||
    sameTickCohort;

  const flags =
    [];

  if (
    multipleDeathCandidates
  ) {
    flags.push(
      'MULTIPLE_ACTIVATION_CANDIDATES_FOR_DEATH'
    );
  }

  if (
    multipleActivationCandidates
  ) {
    flags.push(
      'ACTIVATION_HAS_MULTIPLE_DEATH_CANDIDATES'
    );
  }

  if (
    sameTickCohort
  ) {
    flags.push(
      'MULTIPLE_ELIGIBLE_DEATHS_SAME_TICK'
    );
  }

  if (
    nearSpatialMatchLimit
  ) {
    flags.push(
      'MATCH_DISTANCE_NEAR_160HU_LIMIT'
    );
  }

  if (
    tickAtMatchEdge
  ) {
    flags.push(
      'MATCH_TICK_DELTA_AT_EDGE'
    );
  }

  return {
    available:
      true,

    ambiguous,

    flags,

    deathCandidateCount,

    activationCandidateCount,

    tickDelta,

    matchDistance3D,

    confidence,

    sameTickEligibleDeaths:
      sameTickDeaths.length,

    sameTickMatchedDeaths:
      sameTickDeaths.filter(
        row =>
          row.groundSoulMatched
      ).length
  };
}


// ============================================================
// RAW PLAYER IDENTITY
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

  const playerName =
    safeField(
      controller,
      'm_iszPlayerName'
    ) ??
    fallback?.playerName ??
    null;

  const team =
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
    ]);

  const heroId =
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
    ]);

  return {
    playerName,

    team,

    heroId,

    controllerEntityIndex:
      controller?.index ??
      fallback?.controllerEntityIndex ??
      null
  };
}


// ============================================================
// PAWN ALIVE STATE
// ============================================================

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


// ============================================================
// WORLD POSITION
//
// Same cell/vector reconstruction already used elsewhere in the
// pipeline.
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
// SCRIPT 57 OUTLIER NORMALIZATION
// ============================================================

function normalizeScript57Outlier(
  row
) {
  const deathIndex =
    finite(
      row?.deathIndex
    );

  const entityIndex =
    finite(
      row?.entityIndex
    );

  const timeSeconds =
    finite(
      row?.timeSeconds
    );

  const deathPosition =
    normalizePosition(
      row?.deathPosition
    );

  if (
    deathIndex ===
      null
    ||
    entityIndex ===
      null
    ||
    timeSeconds ===
      null
    ||
    !deathPosition
  ) {
    return null;
  }

  const tick =
    firstFinite([
      row?.tick,

      parseDeathKeyTick(
        row?.deathKey
      ),

      Math.round(
        (
          timeSeconds +
          MATCH_CLOCK_OFFSET_SECONDS
        ) *
        TICK_RATE
      )
    ]);

  if (
    tick ===
    null
  ) {
    return null;
  }

  return {
    deathIndex,

    deathKey:
      row?.deathKey ??
      null,

    entityIndex,

    tick,

    timeSeconds,

    clock:
      row?.clock ??
      formatClock(
        timeSeconds
      ),

    baseType:
      row?.baseType ??
      'UNKNOWN',

    variantLabel:
      row?.variantLabel ??
      'UNKNOWN',

    team:
      finite(
        row?.team
      ),

    lane:
      finite(
        row?.lane
      ),

    deathPosition,

    nearestOpponent:
      row?.nearestOpponent ??
      null,

    nearestDistance3D:
      finite(
        row?.nearestDistance3D
      ),

    nearestDistanceXY:
      finite(
        row?.nearestDistanceXY
      ),

    nearestEnvelopeDistance3D:
      finite(
        row?.nearestEnvelopeDistance3D
      ),

    envelopeResolved:
      row?.envelopeResolved ===
      true
  };
}


// ============================================================
// DEATH STREAM NORMALIZATION
// ============================================================

function normalizeDeathStreamRow(
  row,
  streamIndex
) {
  const tick =
    firstFinite([
      row
        ?.timing
        ?.tick,

      row?.tick,

      parseDeathKeyTick(
        row?.deathKey
      )
    ]);

  const entityIndex =
    firstFinite([
      row
        ?.trooper
        ?.entityIndex,

      row?.entityIndex
    ]);

  if (
    tick ===
      null
    ||
    entityIndex ===
      null
  ) {
    return null;
  }

  const matchStatus =
    row
      ?.match
      ?.status ??
    null;

  const groundSoulMatched =
    matchStatus ===
      'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
    ||
    Boolean(
      row?.groundSoul
    );

  return {
    streamIndex,

    deathIndex:
      firstFinite([
        row?.deathIndex
      ]),

    deathKey:
      row?.deathKey ??
      null,

    entityIndex,

    tick,

    groundSoulMatched,

    team:
      firstFinite([
        row
          ?.trooper
          ?.team,

        row?.team
      ]),

    baseType:
      row
        ?.trooper
        ?.baseType ??
      row?.baseType ??
      'UNKNOWN',

    raw:
      row
  };
}


// ============================================================
// PLAYER IDENTITY MAP
// ============================================================

async function loadPlayerIdentity(
  path
) {
  const playerByPawnIndex =
    new Map();

  const playerByName =
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

    const controllerEntityIndex =
      finite(
        row
          ?.controller
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

    const old =
      playerByPawnIndex.get(
        pawnEntityIndex
      ) ??
      playerByName.get(
        playerName
      ) ??
      {};

    const identity = {
      playerName,

      pawnEntityIndex,

      controllerEntityIndex:
        controllerEntityIndex ??
        old.controllerEntityIndex ??
        null,

      team:
        finite(
          row
            ?.controller
            ?.team
        ) ??
        old.team ??
        null,

      heroId:
        finite(
          row
            ?.controller
            ?.heroId
        ) ??
        old.heroId ??
        null
    };

    playerByPawnIndex.set(
      pawnEntityIndex,
      identity
    );

    playerByName.set(
      playerName,
      identity
    );
  }

  return {
    playerByPawnIndex,

    playerByName
  };
}


// ============================================================
// COMPACT HELPERS
// ============================================================

function compactCase(
  row
) {
  return {
    deathIndex:
      row.death.deathIndex,

    deathKey:
      row.death.deathKey,

    clock:
      row.death.clock,

    baseType:
      row.death.baseType,

    primaryDiagnosticCategory:
      row.primaryDiagnosticCategory,

    diagnosticFlags:
      row.diagnosticFlags,

    script57Nearest3D:
      row.script57.nearestDistance3D,

    rawExactStored3D:
      row
        ?.rawReplay
        ?.exactTick
        ?.nearestUsingStoredDeathPosition
        ?.distanceToStoredDeath3D ??
      null,

    rawExactRawTrooper3D:
      row
        ?.rawReplay
        ?.exactTick
        ?.nearestUsingRawTrooperPosition
        ?.distanceToRawTrooper3D ??
      null,

    rawHalfSecondStored3D:
      row
        ?.rawReplay
        ?.envelopes
        ?.[
          '0.5'
        ]
        ?.storedDeathPosition
        ?.nearest3D
        ?.distance3D ??
      null,

    rawHalfSecondRawTrooper3D:
      row
        ?.rawReplay
        ?.envelopes
        ?.[
          '0.5'
        ]
        ?.rawTrooperPosition
        ?.nearest3D
        ?.distance3D ??
      null,

    matchDiagnostic:
      row.script55Match
  };
}


function compactSameTickDeath(
  row
) {
  return {
    deathIndex:
      row.deathIndex,

    deathKey:
      row.deathKey,

    entityIndex:
      row.entityIndex,

    baseType:
      row.baseType,

    team:
      row.team,

    groundSoulMatched:
      row.groundSoulMatched,

    matchDistance3D:
      firstFinite([
        row
          ?.raw
          ?.match
          ?.distance3D,

        row
          ?.raw
          ?.match
          ?.distance
      ]),

    tickDelta:
      firstFinite([
        row
          ?.raw
          ?.match
          ?.tickDelta,

        row
          ?.raw
          ?.match
          ?.deltaTicks
      ])
  };
}


function compactOpponentDistance(
  row,
  distance3DKey,
  distanceXYKey
) {
  if (
    !row
  ) {
    return null;
  }

  return {
    tick:
      row.tick,

    tickDelta:
      row.tickDelta,

    matchTimeSeconds:
      row.matchTimeSeconds,

    playerName:
      row.playerName,

    pawnEntityIndex:
      row.pawnEntityIndex,

    team:
      row.team,

    position:
      row.position,

    distance3D:
      row[
        distance3DKey
      ],

    distanceXY:
      row[
        distanceXYKey
      ]
  };
}


// ============================================================
// SNAPSHOT HELPERS
// ============================================================

function chooseClosestTickSnapshot(
  rows,
  targetTickDelta
) {
  if (
    !rows.length
  ) {
    return null;
  }

  return rows
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        Math.abs(
          a.tickDelta -
          targetTickDelta
        ) -
        Math.abs(
          b.tickDelta -
          targetTickDelta
        )
        ||
        Math.abs(
          a.tickDelta
        ) -
        Math.abs(
          b.tickDelta
        )
    )[0];
}


// ============================================================
// ENTITY FIELD HELPERS
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


function withinThreshold(
  value,
  threshold
) {
  return Number.isFinite(
    value
  )
  &&
  value <=
    threshold;
}


// ============================================================
// POSITION NORMALIZATION
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


// ============================================================
// DEATH KEY
// ============================================================

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


function firstString(
  values
) {
  for (
    const value
    of values
  ) {
    if (
      typeof value ===
        'string'
      &&
      value.length >
        0
    ) {
      return value;
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


function countMany(
  values
) {
  const map =
    new Map();

  for (
    const value
    of values
  ) {
    map.set(
      String(
        value
      ),
      (
        map.get(
          String(
            value
          )
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


function summarizeNumbers(
  values
) {
  const clean =
    values
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

      p10:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p90:
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

    p10:
      quantile(
        clean,
        0.10
      ),

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

    p90:
      quantile(
        clean,
        0.90
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      clean.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
      clean.length
  };
}


function quantile(
  values,
  q
) {
  if (
    values.length ===
    0
  ) {
    return null;
  }

  if (
    values.length ===
    1
  ) {
    return values[0];
  }

  const position =
    (
      values.length -
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
    return values[
      lower
    ];
  }

  const weight =
    position -
    lower;

  return values[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    values[
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