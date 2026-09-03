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

const COLLISION_RADIUS_TICKS =
  8;

const MAX_EXAMPLES =
  40;

const TARGET_FIELDS = [
  'm_iGoldNetWorth',
  'm_iCreepGold',
  'm_iCreepGoldSoloBonus',
  'm_iCreepGoldKill',
  'm_iCreepGoldAirOrb',
  'm_iCreepGoldGroundOrb',
  'm_iCreepGoldDeny',
  'm_iCreepGoldNeutral',
  'm_iLastHits',
  'm_iDenies'
];

const WINDOWS = [
  {
    id: 'M8_P8',
    before: 8,
    after: 8
  },
  {
    id: 'M4_P8',
    before: 4,
    after: 8
  },
  {
    id: 'P0_P8',
    before: 0,
    after: 8
  },
  {
    id: 'P0_P16',
    before: 0,
    after: 16
  },
  {
    id: 'M8_P16',
    before: 8,
    after: 16
  },
  {
    id: 'M16_P32',
    before: 16,
    after: 32
  }
];


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );

const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );

const raceSummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_race_resolution_validation_v01.json'
  );

const correctedOutcomePath =
  resolve(
    'output',
    replayName,
    'citemxp_corrected_shot_outcomes_v01.jsonl'
  );

const summaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_award_resolution_validation_v01.json'
  );

const unitsPath =
  resolve(
    'output',
    replayName,
    'citemxp_award_resolution_units_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    raceSummaryPath,
    correctedOutcomePath
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
// LOAD SCRIPT 62 SUMMARY
// ============================================================

const raceSummary =
  JSON.parse(
    readFileSync(
      raceSummaryPath,
      'utf8'
    )
  );

if (
  raceSummary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 62 race-resolution validation did not PASS.'
  );
}


// ============================================================
// LOAD PLAYER IDENTITIES
// ============================================================

console.log('');

console.log(
  'Loading player/controller identities...'
);

const playerIdentity =
  await loadPlayerIdentity(
    playerStatePath
  );

const playerByControllerIndex =
  playerIdentity.playerByControllerIndex;

console.log(
  `Players: ${playerIdentity.players.length}`
);

console.log(
  `Controller indexes: ${playerByControllerIndex.size}`
);


// ============================================================
// LOAD SCRIPT 62 CORRECTED OUTCOMES
// ============================================================

console.log('');

console.log(
  'Loading Script 62 corrected outcomes...'
);

const rawRows =
  await loadJsonl(
    correctedOutcomePath
  );

const anchors =
  rawRows
    .map(
      normalizeCorrectedRow
    )
    .filter(
      Boolean
    )
    .map(
      buildAnchor
    )
    .filter(
      Boolean
    )
    .sort(
      (
        a,
        b
      ) =>
        a.anchorTick -
        b.anchorTick
        ||
        a.entityIndex -
        b.entityIndex
    );


// ============================================================
// ANCHOR COLLISION FLAGS
// ============================================================

for (
  let i = 0;
  i < anchors.length;
  i++
) {
  anchors[i].anchorIndex =
    i;

  const previousDistance =
    i > 0
      ? anchors[i].anchorTick -
        anchors[i - 1].anchorTick
      : Infinity;

  const nextDistance =
    i + 1 <
    anchors.length
      ? anchors[i + 1].anchorTick -
        anchors[i].anchorTick
      : Infinity;

  anchors[i].nearestOtherAnchorTicks =
    Math.min(
      previousDistance,
      nextDistance
    );

  anchors[i].collisionWithin8Ticks =
    anchors[i].nearestOtherAnchorTicks <=
    COLLISION_RADIUS_TICKS;
}


// ============================================================
// CONTROL COHORTS
// ============================================================

const shotAnchors =
  anchors.filter(
    row =>
      row.shotObserved
  );

const noShotAnchors =
  anchors.filter(
    row =>
      !row.shotObserved
  );

const mixedTeamAnchors =
  anchors.filter(
    row =>
      row.mixedTeamRace
  );

const highConfidenceControls =
  shotAnchors.filter(
    isHighConfidenceControl
  );

const trooperControls =
  highConfidenceControls.filter(
    row =>
      row.sourceType ===
      'TROOPER_DEATH'
  );

const isolatedTrooperControls =
  trooperControls.filter(
    row =>
      !row.collisionWithin8Ticks
  );

const calibrationControls =
  isolatedTrooperControls.length >=
  20
    ? isolatedTrooperControls
    : trooperControls;

const calibrationCohort =
  isolatedTrooperControls.length >=
  20
    ? 'ISOLATED_TROOPER_KNOWN_SHOTS'
    : 'ALL_TROOPER_KNOWN_SHOTS';

console.log(
  `Targets: ${anchors.length}`
);

console.log(
  `Shot / no-shot: ${shotAnchors.length} / ${noShotAnchors.length}`
);

console.log(
  `Mixed-team races: ${mixedTeamAnchors.length}`
);

console.log(
  `Calibration controls: ${calibrationControls.length} (${calibrationCohort})`
);


// ============================================================
// CONTROLLER FIELD TRACKING
// ============================================================

const previousValue =
  new Map();

const fieldTelemetry =
  new Map(
    TARGET_FIELDS.map(
      field => [
        field,
        createFieldTelemetry(
          field
        )
      ]
    )
  );

const deltaEvents = [];

let controllerEntityEvents =
  0;


// ============================================================
// PARSER
// ============================================================

const parser =
  new Parser();

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (
    demoPacket,
    messagePacket,
    events
  ) => {
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

    for (
      const event
      of events ?? []
    ) {
      const entity =
        event?.entity;

      if (
        !entity
      ) {
        continue;
      }

      const entityIndex =
        getEntityIndex(
          entity
        );

      const player =
        entityIndex ===
        null
          ? null
          : playerByControllerIndex.get(
            entityIndex
          );

      if (
        !player
      ) {
        continue;
      }

      controllerEntityEvents++;

      const changedFields =
        new Set(
          extractChangedFields(
            safeGetChanges(
              event
            )
          )
        );

      for (
        const fieldName
        of TARGET_FIELDS
      ) {
        const stats =
          fieldTelemetry.get(
            fieldName
          );

        const value =
          finite(
            safeGetField(
              entity,
              fieldName
            )
          );

        stats.readAttempts++;

        if (
          changedFields.has(
            fieldName
          )
        ) {
          stats.explicitChangeMentions++;
        }

        if (
          value ===
          null
        ) {
          continue;
        }

        stats.finiteReads++;

        stats
          .playersWithFiniteValue
          .add(
            player.playerName
          );

        stats
          .controllerIndexesWithFiniteValue
          .add(
            entityIndex
          );

        if (
          stats.firstObservedTick ===
          null
        ) {
          stats.firstObservedTick =
            tick;
        }

        stats.lastObservedTick =
          tick;

        const key =
          `${entityIndex}|${fieldName}`;

        const prior =
          previousValue.get(
            key
          ) ??
          null;

        previousValue.set(
          key,
          {
            tick,
            value
          }
        );

        if (
          !prior
          ||
          !Number.isFinite(
            prior.value
          )
        ) {
          continue;
        }

        const delta =
          value -
          prior.value;

        if (
          delta ===
          0
        ) {
          continue;
        }

        const row = {
          tick,

          fieldName,

          controllerEntityIndex:
            entityIndex,

          playerName:
            player.playerName,

          team:
            player.team,

          heroId:
            player.heroId,

          previousTick:
            prior.tick,

          previousValue:
            prior.value,

          currentValue:
            value,

          delta,

          explicitlyChanged:
            changedFields.has(
              fieldName
            )
        };

        deltaEvents.push(
          row
        );

        stats.deltaCount++;

        if (
          delta >
          0
        ) {
          stats.positiveDeltaCount++;
        }

        if (
          delta <
          0
        ) {
          stats.negativeDeltaCount++;
        }

        if (
          row.explicitlyChanged
        ) {
          stats.explicitDeltaCount++;
        }

        stats.deltaValues.push(
          delta
        );
      }
    }
  }
);


// ============================================================
// RUN PARSER
// ============================================================

console.log('');

console.log(
  '============================================='
);

console.log(
  'CITEMXP AWARD RESOLUTION VALIDATION V0.1'
);

console.log(
  '============================================='
);

console.log('');

await parser.parse(
  createReadStream(
    replayPath
  )
);

await parser.dispose();

deltaEvents.sort(
  (
    a,
    b
  ) =>
    a.tick -
    b.tick
    ||
    a.controllerEntityIndex -
    b.controllerEntityIndex
);


// ============================================================
// POSITIVE-CONTROL CALIBRATION
// ============================================================

const calibrationRows = [];

for (
  const fieldName
  of TARGET_FIELDS
) {
  for (
    const window
    of WINDOWS
  ) {
    calibrationRows.push(
      summarizeCalibration(
        calibrationControls,
        fieldName,
        window
      )
    );
  }
}

calibrationRows.sort(
  compareCalibrationRows
);

const bestCandidate =
  calibrationRows[0] ??
  null;

const allControlMatrix =
  buildCalibrationMatrix(
    highConfidenceControls
  );

const trooperControlMatrix =
  buildCalibrationMatrix(
    trooperControls
  );

const isolatedTrooperControlMatrix =
  buildCalibrationMatrix(
    isolatedTrooperControls
  );

const cleanSignal =
  Boolean(
    bestCandidate
    &&
    bestCandidate.controlCount >=
    20
    &&
    bestCandidate.expectedSignalRate >=
    0.90
    &&
    bestCandidate.directionAccuracy >=
    0.90
    &&
    bestCandidate.otherOnlyRate <=
    0.05
  );


// ============================================================
// APPLY BEST DIAGNOSTIC TO ALL ANCHORS
// ============================================================

const bestField =
  bestCandidate?.fieldName ??
  'm_iGoldNetWorth';

const bestWindow =
  WINDOWS.find(
    row =>
      row.id ===
      bestCandidate?.windowId
  ) ??
  WINDOWS[4];

for (
  const anchor
  of anchors
) {
  anchor.bestMeasurement =
    measureAnchor(
      anchor,
      bestField,
      bestWindow
    );
}

const noShotTrooper =
  noShotAnchors.filter(
    row =>
      row.sourceType ===
      'TROOPER_DEATH'
  );

const noShotUrn =
  noShotAnchors.filter(
    row =>
      row.sourceType ===
      'URN_DELIVERY'
  );

const noShotDiagnostics = {
  all:
    summarizeDiagnosticSet(
      noShotAnchors
    ),

  trooper:
    summarizeDiagnosticSet(
      noShotTrooper
    ),

  urnPerOrbCaution:
    summarizeDiagnosticSet(
      noShotUrn
    )
};


// ============================================================
// URN BURST AGGREGATION
// ============================================================

const urnBursts =
  buildUrnBursts(
    anchors.filter(
      row =>
        row.sourceType ===
        'URN_DELIVERY'
    )
  );

for (
  const burst
  of urnBursts
) {
  burst.bestMeasurement =
    measureBurst(
      burst,
      bestField,
      bestWindow
    );
}


// ============================================================
// WRITE PER-ANCHOR STREAM
// ============================================================

mkdirSync(
  dirname(
    summaryPath
  ),
  {
    recursive:
      true
  }
);

const writer =
  createWriteStream(
    unitsPath,
    {
      encoding:
        'utf8'
    }
  );

for (
  const anchor
  of anchors
) {
  const compactFieldMeasurements = {};

  for (
    const fieldName
    of TARGET_FIELDS
  ) {
    const measurement =
      measureAnchor(
        anchor,
        fieldName,
        bestWindow
      );

    if (
      measurement.totalDeltaEvents >
      0
    ) {
      compactFieldMeasurements[fieldName] =
        measurement;
    }
  }

  writer.write(
    JSON.stringify({
      schemaVersion:
        1,

      canonical:
        false,

      sourceType:
        anchor.sourceType,

      sourceId:
        anchor.sourceId,

      episodeId:
        anchor.episodeId,

      entityIndex:
        anchor.entityIndex,

      subclassId:
        anchor.subclassId,

      orbTeam:
        anchor.orbTeam,

      anchorTick:
        anchor.anchorTick,

      anchorClock:
        ticksToClock(
          anchor.anchorTick
        ),

      anchorReason:
        anchor.anchorReason,

      shotObserved:
        anchor.shotObserved,

      mixedTeamRace:
        anchor.mixedTeamRace,

      correctedOutcomeLabel:
        anchor.correctedOutcomeLabel,

      expectedSignalTeam:
        anchor.expectedSignalTeam,

      expectedSignalBasis:
        anchor.expectedSignalBasis,

      firstHitPlayerName:
        anchor.firstHitPlayerName,

      firstHitTeam:
        anchor.firstHitTeam,

      nearestOtherAnchorTicks:
        finiteOrNull(
          anchor.nearestOtherAnchorTicks
        ),

      collisionWithin8Ticks:
        anchor.collisionWithin8Ticks,

      diagnosticOnly:
        true,

      noShotStatus:
        anchor.shotObserved
          ? null
          : 'NO_SHOT_UNRESOLVED',

      selectedFingerprint: {
        fieldName:
          bestField,

        window:
          bestWindow
      },

      bestMeasurement:
        anchor.bestMeasurement,

      nonzeroTargetFieldMeasurements:
        compactFieldMeasurements
    }) +
    '\n'
  );
}

await finishWriter(
  writer
);


// ============================================================
// VALIDATION
// ============================================================

const expectedCounts =
  raceSummary?.counts ??
  {};

const validationChecks = {
  script62Passed:
    check(
      raceSummary
        ?.validation
        ?.pass,
      true,
      raceSummary
        ?.validation
        ?.pass ===
      true
    ),

  targetCountPreserved:
    check(
      anchors.length,
      expectedCounts.targets,
      anchors.length ===
      expectedCounts.targets
    ),

  shotCountPreserved:
    check(
      shotAnchors.length,
      expectedCounts.shotEpisodes,
      shotAnchors.length ===
      expectedCounts.shotEpisodes
    ),

  noShotCountPreserved:
    check(
      noShotAnchors.length,
      expectedCounts.noShotEpisodes,
      noShotAnchors.length ===
      expectedCounts.noShotEpisodes
    ),

  controllerIdentitiesLoaded:
    check(
      playerByControllerIndex.size,
      '>=10',
      playerByControllerIndex.size >=
      10
    ),

  controllerEventsObserved:
    check(
      controllerEntityEvents,
      '>0',
      controllerEntityEvents >
      0
    ),

  targetFieldDeltasObserved:
    check(
      deltaEvents.length,
      '>0',
      deltaEvents.length >
      0
    ),

  goldNetWorthObserved:
    check(
      fieldTelemetry
        .get(
          'm_iGoldNetWorth'
        )
        ?.deltaCount ??
        0,
      '>0',
      (
        fieldTelemetry
          .get(
            'm_iGoldNetWorth'
          )
          ?.deltaCount ??
        0
      ) >
      0
    ),

  knownControlsAvailable:
    check(
      highConfidenceControls.length,
      '>0',
      highConfidenceControls.length >
      0
    ),

  noShotRowsRemainUnresolved:
    check(
      noShotAnchors.filter(
        row =>
          row.correctedOutcomeLabel ===
          'NO_SHOT_UNRESOLVED'
      ).length,
      noShotAnchors.length,
      noShotAnchors.every(
        row =>
          row.correctedOutcomeLabel ===
          'NO_SHOT_UNRESOLVED'
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
    'CITEMXP_AWARD_RESOLUTION_VALIDATION_V01',

  canonical:
    false,

  status:
    !validationPass
      ? 'DIAGNOSTIC_ONLY_INPUT_OR_TELEMETRY_FAILURE'
      : cleanSignal
        ? 'CLEAN_CONTROL_FINGERPRINT_FOUND_REQUIRES_REVIEW'
        : 'NO_CLEAN_DIRECT_AWARD_FINGERPRINT_YET',

  purpose: [
    'Calibrate economy-counter timing and team direction from high-confidence Script 62 shot outcomes.',
    'Test m_iGoldNetWorth plus semantically named m_iCreepGold* counters by reading their current values on every player-controller event.',
    'Describe untouched-orb telemetry without relabeling NO_SHOT_UNRESOLVED as AUTO_AWARD.'
  ],

  inputs: {
    replay:
      replayPath,

    playerState:
      playerStatePath,

    script62Summary:
      raceSummaryPath,

    correctedOutcomes:
      correctedOutcomePath
  },

  counts: {
    targets:
      anchors.length,

    trooperTargets:
      anchors.filter(
        row =>
          row.sourceType ===
          'TROOPER_DEATH'
      ).length,

    urnTargets:
      anchors.filter(
        row =>
          row.sourceType ===
          'URN_DELIVERY'
      ).length,

    shotTargets:
      shotAnchors.length,

    noShotTargets:
      noShotAnchors.length,

    mixedTeamRaces:
      mixedTeamAnchors.length,

    highConfidenceKnownShotControls:
      highConfidenceControls.length,

    trooperKnownShotControls:
      trooperControls.length,

    isolatedTrooperKnownShotControls:
      isolatedTrooperControls.length,

    noShotStillUnresolved:
      noShotAnchors.length,

    urnBursts:
      urnBursts.length
  },

  anchorRules: {
    shot:
      'First Script 62 lifecycle LEAVE/DELETE at or after first hit; falls back to first hit.',

    noShot:
      'First Script 62 lifecycle LEAVE/DELETE at or after attackable-end; falls back to attackable-end.',

    knownExpectedTeam:
      'First-hit player team for high-confidence SECURE, DENY, or CLAIM controls.',

    noShotExpectedTeamHypothesis: {
      trooper:
        'Opposite orb team; hypothesis only.',

      urn:
        'Same orb team; hypothesis only and evaluated per burst where possible.'
    },

    collisionFlag:
      `Another CItemXP anchor within ${COLLISION_RADIUS_TICKS} ticks.`
  },

  controllerTelemetry: {
    players:
      playerIdentity.players,

    controllerEntityEvents,

    targetDeltaEvents:
      deltaEvents.length,

    fields:
      Object.fromEntries(
        TARGET_FIELDS.map(
          field => [
            field,
            finalizeFieldTelemetry(
              fieldTelemetry.get(
                field
              )
            )
          ]
        )
      )
  },

  calibration: {
    rankingCohort:
      calibrationCohort,

    rankingControlCount:
      calibrationControls.length,

    cleanSignalThresholds: {
      minimumControls:
        20,

      minimumExpectedSignalRate:
        0.90,

      minimumDirectionAccuracy:
        0.90,

      maximumOtherOnlyRate:
        0.05
    },

    cleanSignal,

    selectedDiagnosticFingerprint:
      bestCandidate,

    topCandidates:
      calibrationRows.slice(
        0,
        20
      ),

    matrices: {
      allHighConfidenceKnownShots:
        allControlMatrix,

      allTrooperKnownShots:
        trooperControlMatrix,

      isolatedTrooperKnownShots:
        isolatedTrooperControlMatrix
    }
  },

  noShotDiagnostics: {
    warning:
      'These are fingerprint comparisons only. Every no-shot row remains NO_SHOT_UNRESOLVED.',

    selectedField:
      bestField,

    selectedWindow:
      bestWindow,

    ...noShotDiagnostics
  },

  urnBurstDiagnostics: {
    warning:
      'The ten Urn payout objects can overlap tightly; burst-level windows reduce per-orb double counting.',

    summary:
      summarizeUrnBursts(
        urnBursts
      ),

    examples:
      urnBursts
        .slice(
          0,
          MAX_EXAMPLES
        )
        .map(
          compactUrnBurst
        )
  },

  examples: {
    controls:
      highConfidenceControls
        .slice(
          0,
          MAX_EXAMPLES
        )
        .map(
          compactAnchor
        ),

    noShotTrooper:
      noShotTrooper
        .slice(
          0,
          MAX_EXAMPLES
        )
        .map(
          compactAnchor
        ),

    noShotUrn:
      noShotUrn
        .slice(
          0,
          MAX_EXAMPLES
        )
        .map(
          compactAnchor
        )
  },

  validation: {
    pass:
      validationPass,

    checks:
      validationChecks
  },

  interpretation:
    !validationPass
      ? 'Required inputs or controller telemetry failed validation. Do not interpret the fingerprint.'
      : cleanSignal
        ? 'A field/window passed the predeclared positive-control thresholds. Review its value/timing distributions and collision sensitivity before promoting untouched outcomes.'
        : 'Known-shot controls did not yield a sufficiently clean direct award fingerprint. Do not promote untouched outcomes; use the reported timing, value, and field-availability diagnostics to design the next targeted test.',

  outputs: {
    summary:
      summaryPath,

    perAnchorDiagnostics:
      unitsPath
  }
};


// ============================================================
// WRITE SUMMARY
// ============================================================

writeFileSync(
  summaryPath,
  JSON.stringify(
    summary,
    null,
    2
  )
);


// ============================================================
// CONSOLE RESULTS
// ============================================================

console.log(
  'FIELD AVAILABILITY'
);

for (
  const fieldName
  of TARGET_FIELDS
) {
  const stats =
    finalizeFieldTelemetry(
      fieldTelemetry.get(
        fieldName
      )
    );

  console.log(
    `${fieldName.padEnd(28)} ` +
    `deltas=${String(stats.deltaCount).padStart(6)} ` +
    `positive=${String(stats.positiveDeltaCount).padStart(6)} ` +
    `explicit=${String(stats.explicitDeltaCount).padStart(6)} ` +
    `players=${stats.playersWithFiniteValue}`
  );
}

console.log('');

console.log(
  'TOP CALIBRATION CANDIDATES'
);

for (
  const row
  of calibrationRows.slice(
    0,
    12
  )
) {
  console.log(
    `${row.fieldName.padEnd(28)} ` +
    `${row.windowId.padEnd(10)} ` +
    `controls=${String(row.controlCount).padStart(3)} ` +
    `expected=${formatPercent(row.expectedSignalRate).padStart(7)} ` +
    `direction=${formatPercent(row.directionAccuracy).padStart(7)} ` +
    `otherOnly=${formatPercent(row.otherOnlyRate).padStart(7)} ` +
    `score=${formatNumber(row.score)}`
  );
}

console.log('');

console.log(
  'VALIDATION'
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
    `${name.padEnd(34)} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');

console.log(
  `OVERALL: ${validationPass ? 'PASS' : 'FAIL'}`
);

console.log(
  `CLEAN CONTROL FINGERPRINT: ${cleanSignal ? 'YES — REVIEW REQUIRED' : 'NO'}`
);

console.log(
  `NO-SHOT STATUS: ${noShotAnchors.length} remain NO_SHOT_UNRESOLVED`
);

console.log('');

console.log(
  `Summary:\n${summaryPath}`
);

console.log('');

console.log(
  `Per-anchor diagnostics:\n${unitsPath}`
);

console.log('');


// ============================================================
// NORMALIZE CORRECTED OUTCOME ROW
// ============================================================

function normalizeCorrectedRow(
  row
) {
  const episode =
    row?.episode;

  if (
    !episode
    ||
    ![
      'TROOPER_DEATH',
      'URN_DELIVERY'
    ].includes(
      row?.sourceType
    )
  ) {
    return null;
  }

  const entityIndex =
    finite(
      episode.entityIndex
    );

  const startTick =
    finite(
      episode.startTick
    );

  const attackableEndTick =
    finite(
      episode.attackableEndTick
    );

  if (
    entityIndex ===
    null
    ||
    startTick ===
    null
    ||
    attackableEndTick ===
    null
  ) {
    return null;
  }

  const orderedHits =
    (
      row
        ?.raceAnalysis
        ?.orderedHits ??
      []
    )
      .map(
        normalizeHit
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
      );

  const firstHit =
    normalizeHit(
      row
        ?.raceAnalysis
        ?.firstHit
    ) ??
    orderedHits[0] ??
    null;

  const lifecycleEvents =
    (
      row
        ?.lifecycleAnalysis
        ?.events ??
      []
    )
      .map(
        normalizeLifecycle
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
      );

  return {
    sourceType:
      row.sourceType,

    sourceId:
      row?.sourceId ??
      null,

    episodeId:
      episode?.episodeId ??
      null,

    entityIndex,

    subclassId:
      String(
        episode?.subclassId ??
        'UNKNOWN'
      ),

    orbTeam:
      finite(
        episode?.orbTeam
      ),

    startTick,

    attackableStartTick:
      finite(
        episode?.attackableStartTick
      ),

    attackableEndTick,

    firstLeaveTick:
      finite(
        episode?.firstLeaveTick
      ),

    firstHit,

    orderedHits,

    lifecycleEvents,

    mixedTeamRace:
      row
        ?.raceAnalysis
        ?.mixedTeamRace ===
      true,

    correctedOutcomeLabel:
      row
        ?.correctedOutcome
        ?.label ??
      'UNKNOWN',

    correctedOutcomeConfidence:
      row
        ?.correctedOutcome
        ?.confidence ??
      null,

    urnBurst:
      row?.urnBurst ??
      null
  };
}


// ============================================================
// NORMALIZE HIT
// ============================================================

function normalizeHit(
  row
) {
  const tick =
    finite(
      row?.tick
    );

  if (
    tick ===
    null
    ||
    !row?.attackerPlayer
  ) {
    return null;
  }

  return {
    tick,

    playerName:
      row
        .attackerPlayer
        ?.playerName ??
      'UNKNOWN',

    team:
      finite(
        row
          .attackerPlayer
          ?.team
      ),

    heroId:
      finite(
        row
          .attackerPlayer
          ?.heroId
      ),

    pawnEntityIndex:
      finite(
        row
          .attackerPlayer
          ?.pawnEntityIndex
      )
  };
}


// ============================================================
// NORMALIZE LIFECYCLE EVENT
// ============================================================

function normalizeLifecycle(
  row
) {
  const tick =
    finite(
      row?.tick
    );

  if (
    tick ===
    null
  ) {
    return null;
  }

  return {
    tick,

    operation:
      String(
        row?.operation ??
        'UNKNOWN'
      ).toUpperCase()
  };
}


// ============================================================
// BUILD RESOLUTION ANCHOR
// ============================================================

function buildAnchor(
  row
) {
  const shotObserved =
    Boolean(
      row.firstHit
    );

  const ends =
    row.lifecycleEvents.filter(
      event =>
        [
          'LEAVE',
          'DELETE'
        ].includes(
          event.operation
        )
    );

  let anchorTick =
    null;

  let anchorReason =
    null;

  if (
    shotObserved
  ) {
    const end =
      ends.find(
        event =>
          event.tick >=
          row.firstHit.tick
      ) ??
      null;

    anchorTick =
      end?.tick ??
      row.firstHit.tick;

    anchorReason =
      end
        ? 'SHOT_THEN_LIFECYCLE_END'
        : 'FIRST_PLAYER_HIT_FALLBACK';

  } else {
    const end =
      ends.find(
        event =>
          event.tick >=
          row.attackableEndTick
      ) ??
      null;

    anchorTick =
      end?.tick ??
      row.attackableEndTick;

    anchorReason =
      end
        ? 'NO_SHOT_POST_ATTACKABLE_LIFECYCLE_END'
        : 'ATTACKABLE_END_FALLBACK';
  }

  if (
    !Number.isFinite(
      anchorTick
    )
  ) {
    return null;
  }

  const firstHitTeam =
    finite(
      row.firstHit?.team
    );

  let expectedSignalTeam =
    null;

  let expectedSignalBasis =
    null;

  if (
    shotObserved
    &&
    isGameTeam(
      firstHitTeam
    )
  ) {
    expectedSignalTeam =
      firstHitTeam;

    expectedSignalBasis =
      'KNOWN_FIRST_HIT_TEAM';

  } else if (
    !shotObserved
    &&
    isGameTeam(
      row.orbTeam
    )
  ) {
    expectedSignalTeam =
      row.sourceType ===
      'TROOPER_DEATH'
        ? oppositeTeam(
          row.orbTeam
        )
        : row.orbTeam;

    expectedSignalBasis =
      row.sourceType ===
      'TROOPER_DEATH'
        ? 'NO_SHOT_TROOPER_OPPOSITE_ORB_TEAM_HYPOTHESIS'
        : 'NO_SHOT_URN_SAME_ORB_TEAM_HYPOTHESIS';
  }

  return {
    ...row,

    shotObserved,

    firstHitTick:
      row.firstHit?.tick ??
      null,

    firstHitPlayerName:
      row.firstHit?.playerName ??
      null,

    firstHitTeam,

    anchorTick,

    anchorReason,

    expectedSignalTeam,

    expectedSignalBasis,

    bestMeasurement:
      null
  };
}


// ============================================================
// CONTROL FILTER
// ============================================================

function isHighConfidenceControl(
  anchor
) {
  return anchor.shotObserved
    &&
    !anchor.mixedTeamRace
    &&
    [
      'SECURE',
      'DENY',
      'CLAIM'
    ].includes(
      anchor.correctedOutcomeLabel
    )
    &&
    isGameTeam(
      anchor.firstHitTeam
    );
}


// ============================================================
// CALIBRATION SUMMARY
// ============================================================

function summarizeCalibration(
  controls,
  fieldName,
  window
) {
  const measurements =
    controls.map(
      anchor =>
        measureAnchor(
          anchor,
          fieldName,
          window
        )
    );

  const expectedPresent =
    measurements.filter(
      row =>
        row.expectedPositiveDelta >
        0
    ).length;

  const otherPresent =
    measurements.filter(
      row =>
        row.otherPositiveDelta >
        0
    ).length;

  const expectedOnly =
    measurements.filter(
      row =>
        row.expectedPositiveDelta >
        0
        &&
        row.otherPositiveDelta ===
        0
    ).length;

  const otherOnly =
    measurements.filter(
      row =>
        row.expectedPositiveDelta ===
        0
        &&
        row.otherPositiveDelta >
        0
    ).length;

  const both =
    measurements.filter(
      row =>
        row.expectedPositiveDelta >
        0
        &&
        row.otherPositiveDelta >
        0
    ).length;

  const neither =
    measurements.filter(
      row =>
        row.expectedPositiveDelta ===
        0
        &&
        row.otherPositiveDelta ===
        0
    ).length;

  const comparable =
    measurements.filter(
      row =>
        row.expectedPositiveDelta !==
        row.otherPositiveDelta
    );

  const directionCorrect =
    comparable.filter(
      row =>
        row.expectedPositiveDelta >
        row.otherPositiveDelta
    ).length;

  const shooterPresent =
    measurements.filter(
      row =>
        row.shooterPositiveDelta >
        0
    ).length;

  const expectedSignalRate =
    rate(
      expectedPresent,
      measurements.length
    ) ??
    0;

  const directionAccuracy =
    rate(
      directionCorrect,
      comparable.length
    ) ??
    0;

  const otherOnlyRate =
    rate(
      otherOnly,
      measurements.length
    ) ??
    0;

  const expectedOnlyRate =
    rate(
      expectedOnly,
      measurements.length
    ) ??
    0;

  const score =
    measurements.length ===
    0
      ? -Infinity
      : 0.40 *
        expectedSignalRate
        +
        0.35 *
        directionAccuracy
        +
        0.15 *
        expectedOnlyRate
        +
        0.10 *
        (
          1 -
          otherOnlyRate
        );

  return {
    fieldName,

    windowId:
      window.id,

    beforeTicks:
      window.before,

    afterTicks:
      window.after,

    controlCount:
      measurements.length,

    controlsWithAnyPositiveDelta:
      measurements.filter(
        row =>
          row.totalPositiveDelta >
          0
      ).length,

    expectedPresent,

    otherPresent,

    expectedOnly,

    otherOnly,

    both,

    neither,

    comparableDirectionCount:
      comparable.length,

    directionCorrect,

    expectedSignalRate,

    directionAccuracy,

    otherOnlyRate,

    expectedOnlyRate,

    shooterSignalRate:
      rate(
        shooterPresent,
        measurements.length
      ),

    expectedPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.expectedPositiveDelta
        )
      ),

    otherPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.otherPositiveDelta
        )
      ),

    positiveMargin:
      summarizeNumbers(
        measurements.map(
          row =>
            row.expectedPositiveDelta -
            row.otherPositiveDelta
        )
      ),

    firstExpectedOffsetTicks:
      summarizeNumbers(
        measurements
          .map(
            row =>
              row.firstExpectedOffsetTicks
          )
          .filter(
            Number.isFinite
          )
      ),

    score
  };
}


// ============================================================
// CALIBRATION SORT
// ============================================================

function compareCalibrationRows(
  a,
  b
) {
  return b.score -
    a.score
    ||
    b.directionAccuracy -
    a.directionAccuracy
    ||
    b.expectedSignalRate -
    a.expectedSignalRate
    ||
    a.otherOnlyRate -
    b.otherOnlyRate
    ||
    a.fieldName.localeCompare(
      b.fieldName
    )
    ||
    a.windowId.localeCompare(
      b.windowId
    );
}


// ============================================================
// BUILD CALIBRATION MATRIX
// ============================================================

function buildCalibrationMatrix(
  controls
) {
  const result = {};

  for (
    const fieldName
    of TARGET_FIELDS
  ) {
    result[fieldName] =
      WINDOWS.map(
        window =>
          summarizeCalibration(
            controls,
            fieldName,
            window
          )
      );
  }

  return {
    controlCount:
      controls.length,

    fields:
      result
  };
}


// ============================================================
// MEASURE ANCHOR
// ============================================================

function measureAnchor(
  anchor,
  fieldName,
  window
) {
  return measureRange(
    anchor.anchorTick -
    window.before,

    anchor.anchorTick +
    window.after,

    anchor.anchorTick,

    anchor.expectedSignalTeam,

    anchor.firstHitPlayerName,

    fieldName
  );
}


// ============================================================
// MEASURE URN BURST
// ============================================================

function measureBurst(
  burst,
  fieldName,
  window
) {
  return measureRange(
    burst.firstAnchorTick -
    window.before,

    burst.lastAnchorTick +
    window.after,

    burst.lastAnchorTick,

    burst.expectedSignalTeam,

    null,

    fieldName
  );
}


// ============================================================
// MEASURE DELTAS IN A RANGE
// ============================================================

function measureRange(
  minTick,
  maxTick,
  referenceTick,
  expectedTeam,
  shooterName,
  fieldName
) {
  const events =
    collectDeltaEvents(
      minTick,
      maxTick,
      fieldName
    );

  const positives =
    events.filter(
      row =>
        row.delta >
        0
    );

  const otherTeam =
    oppositeTeam(
      expectedTeam
    );

  const expectedEvents =
    positives.filter(
      row =>
        row.team ===
        expectedTeam
    );

  const otherEvents =
    positives.filter(
      row =>
        row.team ===
        otherTeam
    );

  const shooterEvents =
    positives.filter(
      row =>
        shooterName
        &&
        row.playerName ===
        shooterName
    );

  const team2PositiveDelta =
    sum(
      positives
        .filter(
          row =>
            row.team ===
            2
        )
        .map(
          row =>
            row.delta
        )
    );

  const team3PositiveDelta =
    sum(
      positives
        .filter(
          row =>
            row.team ===
            3
        )
        .map(
          row =>
            row.delta
        )
    );

  const expectedPositiveDelta =
    sum(
      expectedEvents.map(
        row =>
          row.delta
      )
    );

  const otherPositiveDelta =
    sum(
      otherEvents.map(
        row =>
          row.delta
      )
    );

  return {
    fieldName,

    minTick,

    maxTick,

    referenceTick,

    expectedTeam:
      isGameTeam(
        expectedTeam
      )
        ? expectedTeam
        : null,

    otherTeam:
      isGameTeam(
        otherTeam
      )
        ? otherTeam
        : null,

    totalDeltaEvents:
      events.length,

    totalPositiveDeltaEvents:
      positives.length,

    totalPositiveDelta:
      sum(
        positives.map(
          row =>
            row.delta
        )
      ),

    team2PositiveDelta,

    team3PositiveDelta,

    expectedPositiveDelta,

    otherPositiveDelta,

    expectedPositivePlayers:
      new Set(
        expectedEvents.map(
          row =>
            row.playerName
        )
      ).size,

    otherPositivePlayers:
      new Set(
        otherEvents.map(
          row =>
            row.playerName
        )
      ).size,

    shooterPositiveDelta:
      sum(
        shooterEvents.map(
          row =>
            row.delta
        )
      ),

    firstExpectedOffsetTicks:
      expectedEvents.length >
      0
        ? expectedEvents[0].tick -
          referenceTick
        : null,

    firstOtherOffsetTicks:
      otherEvents.length >
      0
        ? otherEvents[0].tick -
          referenceTick
        : null,

    expectedVsOtherDirection:
      directionLabel(
        expectedPositiveDelta,
        otherPositiveDelta
      ),

    positiveDeltaExamples:
      positives
        .slice(
          0,
          20
        )
        .map(
          row =>
            compactDelta(
              row,
              referenceTick
            )
        )
  };
}


// ============================================================
// COLLECT DELTA EVENTS
// ============================================================

function collectDeltaEvents(
  minTick,
  maxTick,
  fieldName
) {
  const start =
    lowerBound(
      deltaEvents,
      minTick
    );

  const result = [];

  for (
    let i = start;
    i < deltaEvents.length &&
    deltaEvents[i].tick <=
    maxTick;
    i++
  ) {
    if (
      deltaEvents[i].fieldName ===
      fieldName
    ) {
      result.push(
        deltaEvents[i]
      );
    }
  }

  return result;
}


// ============================================================
// BINARY SEARCH
// ============================================================

function lowerBound(
  rows,
  tick
) {
  let low =
    0;

  let high =
    rows.length;

  while (
    low <
    high
  ) {
    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );

    if (
      rows[mid].tick <
      tick
    ) {
      low =
        mid +
        1;

    } else {
      high =
        mid;
    }
  }

  return low;
}


// ============================================================
// DIAGNOSTIC SET SUMMARY
// ============================================================

function summarizeDiagnosticSet(
  rows
) {
  const measurements =
    rows
      .map(
        row =>
          row.bestMeasurement
      )
      .filter(
        Boolean
      );

  const expectedPresent =
    measurements.filter(
      row =>
        row.expectedPositiveDelta >
        0
    ).length;

  const directionExpected =
    measurements.filter(
      row =>
        row.expectedVsOtherDirection ===
        'EXPECTED_TEAM_GREATER'
    ).length;

  return {
    anchors:
      rows.length,

    collisionWithin8Ticks:
      rows.filter(
        row =>
          row.collisionWithin8Ticks
      ).length,

    expectedTeamSignalPresent:
      expectedPresent,

    otherTeamSignalPresent:
      measurements.filter(
        row =>
          row.otherPositiveDelta >
          0
      ).length,

    expectedOnly:
      measurements.filter(
        row =>
          row.expectedPositiveDelta >
          0
          &&
          row.otherPositiveDelta ===
          0
      ).length,

    otherOnly:
      measurements.filter(
        row =>
          row.expectedPositiveDelta ===
          0
          &&
          row.otherPositiveDelta >
          0
      ).length,

    both:
      measurements.filter(
        row =>
          row.expectedPositiveDelta >
          0
          &&
          row.otherPositiveDelta >
          0
      ).length,

    neither:
      measurements.filter(
        row =>
          row.expectedPositiveDelta ===
          0
          &&
          row.otherPositiveDelta ===
          0
      ).length,

    directionExpected,

    directionOther:
      measurements.filter(
        row =>
          row.expectedVsOtherDirection ===
          'OTHER_TEAM_GREATER'
      ).length,

    directionTie:
      measurements.filter(
        row =>
          row.expectedVsOtherDirection ===
          'TIE'
      ).length,

    expectedSignalRate:
      rate(
        expectedPresent,
        measurements.length
      ),

    expectedDirectionRate:
      rate(
        directionExpected,
        measurements.length
      ),

    expectedPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.expectedPositiveDelta
        )
      ),

    otherPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.otherPositiveDelta
        )
      ),

    noShotClassification:
      'NO_SHOT_UNRESOLVED'
  };
}


// ============================================================
// BUILD URN BURSTS
// ============================================================

function buildUrnBursts(
  urnAnchors
) {
  const groups =
    new Map();

  for (
    const anchor
    of urnAnchors
  ) {
    const key =
      String(
        anchor.sourceId ??
        anchor
          .urnBurst
          ?.burstId ??
        `UNKNOWN_${anchor.anchorIndex}`
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
        anchor
      );
  }

  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          sourceId,
          rows
        ]
      ) => {
        rows.sort(
          (
            a,
            b
          ) =>
            a.anchorTick -
            b.anchorTick
        );

        const orbTeams =
          [
            ...new Set(
              rows
                .map(
                  row =>
                    row.orbTeam
                )
                .filter(
                  isGameTeam
                )
            )
          ];

        const shotTeams =
          [
            ...new Set(
              rows
                .map(
                  row =>
                    row.firstHitTeam
                )
                .filter(
                  isGameTeam
                )
            )
          ];

        const allNoShot =
          rows.every(
            row =>
              !row.shotObserved
          );

        const expectedSignalTeam =
          allNoShot
          &&
          orbTeams.length ===
          1
            ? orbTeams[0]
            : shotTeams.length ===
              1
              ? shotTeams[0]
              : null;

        return {
          sourceId,

          anchors:
            rows,

          orbCount:
            rows.length,

          shotCount:
            rows.filter(
              row =>
                row.shotObserved
            ).length,

          noShotCount:
            rows.filter(
              row =>
                !row.shotObserved
            ).length,

          orbTeams,

          shotTeams,

          firstAnchorTick:
            rows[0].anchorTick,

          lastAnchorTick:
            rows[
              rows.length -
              1
            ].anchorTick,

          expectedSignalTeam,

          expectedSignalBasis:
            allNoShot
              ? 'NO_SHOT_URN_SAME_ORB_TEAM_HYPOTHESIS'
              : 'OBSERVED_SINGLE_SHOOTER_TEAM_IF_UNANIMOUS',

          bestMeasurement:
            null
        };
      }
    )
    .sort(
      (
        a,
        b
      ) =>
        a.firstAnchorTick -
        b.firstAnchorTick
    );
}


// ============================================================
// SUMMARIZE URN BURSTS
// ============================================================

function summarizeUrnBursts(
  bursts
) {
  const noShot =
    bursts.filter(
      row =>
        row.noShotCount ===
        row.orbCount
    );

  const shot =
    bursts.filter(
      row =>
        row.shotCount >
        0
    );

  const expectedSignalPresent =
    noShot.filter(
      row =>
        row
          .bestMeasurement
          ?.expectedPositiveDelta >
        0
    ).length;

  return {
    bursts:
      bursts.length,

    allNoShotBursts:
      noShot.length,

    burstsWithAnyShot:
      shot.length,

    orbCount:
      summarizeNumbers(
        bursts.map(
          row =>
            row.orbCount
        )
      ),

    anchorSpanTicks:
      summarizeNumbers(
        bursts.map(
          row =>
            row.lastAnchorTick -
            row.firstAnchorTick
        )
      ),

    allNoShotExpectedSignalPresent:
      expectedSignalPresent,

    allNoShotExpectedSignalRate:
      rate(
        expectedSignalPresent,
        noShot.length
      ),

    allNoShotDirectionExpected:
      noShot.filter(
        row =>
          row
            .bestMeasurement
            ?.expectedVsOtherDirection ===
          'EXPECTED_TEAM_GREATER'
      ).length
  };
}


// ============================================================
// COMPACT URN BURST
// ============================================================

function compactUrnBurst(
  row
) {
  return {
    sourceId:
      row.sourceId,

    orbCount:
      row.orbCount,

    shotCount:
      row.shotCount,

    noShotCount:
      row.noShotCount,

    orbTeams:
      row.orbTeams,

    shotTeams:
      row.shotTeams,

    firstAnchorTick:
      row.firstAnchorTick,

    lastAnchorTick:
      row.lastAnchorTick,

    expectedSignalTeam:
      row.expectedSignalTeam,

    expectedSignalBasis:
      row.expectedSignalBasis,

    bestMeasurement:
      row.bestMeasurement
  };
}


// ============================================================
// LOAD PLAYER IDENTITIES
// ============================================================

async function loadPlayerIdentity(
  path
) {
  const playerByControllerIndex =
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

    const controllerIndex =
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
      controllerIndex ===
      null
      ||
      !playerName
    ) {
      continue;
    }

    const old =
      playerByControllerIndex.get(
        controllerIndex
      ) ??
      playerByName.get(
        playerName
      ) ??
      {};

    const identity = {
      playerName,

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
        null,

      controllerEntityIndex:
        controllerIndex,

      pawnEntityIndex:
        finite(
          row
            ?.pawn
            ?.entityIndex
        ) ??
        old.pawnEntityIndex ??
        null
    };

    playerByControllerIndex.set(
      controllerIndex,
      identity
    );

    playerByName.set(
      playerName,
      identity
    );
  }

  return {
    playerByControllerIndex,

    playerByName,

    players:
      [
        ...playerByName.values()
      ].sort(
        (
          a,
          b
        ) =>
          (
            a.team ??
            99
          ) -
          (
            b.team ??
            99
          )
          ||
          a.playerName.localeCompare(
            b.playerName
          )
      )
  };
}


// ============================================================
// ENTITY HELPERS
// ============================================================

function safeGetChanges(
  event
) {
  try {
    return typeof event?.getChanges ===
      'function'
      ? event.getChanges()
      : null;

  } catch {
    return null;
  }
}


function extractChangedFields(
  raw
) {
  if (
    raw ==
    null
  ) {
    return [];
  }

  if (
    raw instanceof
    Map
  ) {
    return [
      ...raw.keys()
    ].map(
      String
    );
  }

  if (
    Array.isArray(
      raw
    )
  ) {
    return [
      ...new Set(
        raw
          .map(
            row =>
              Array.isArray(
                row
              )
                ? row[0]
                : row?.fieldName ??
                  row?.name ??
                  row?.key ??
                  row?.path
          )
          .filter(
            Boolean
          )
          .map(
            String
          )
      )
    ];
  }

  return typeof raw ===
    'object'
    ? Object.keys(
      raw
    )
    : [];
}


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
// FIELD TELEMETRY
// ============================================================

function createFieldTelemetry(
  fieldName
) {
  return {
    fieldName,

    readAttempts:
      0,

    finiteReads:
      0,

    explicitChangeMentions:
      0,

    explicitDeltaCount:
      0,

    deltaCount:
      0,

    positiveDeltaCount:
      0,

    negativeDeltaCount:
      0,

    firstObservedTick:
      null,

    lastObservedTick:
      null,

    playersWithFiniteValue:
      new Set(),

    controllerIndexesWithFiniteValue:
      new Set(),

    deltaValues:
      []
  };
}


function finalizeFieldTelemetry(
  row
) {
  return {
    fieldName:
      row.fieldName,

    readAttempts:
      row.readAttempts,

    finiteReads:
      row.finiteReads,

    explicitChangeMentions:
      row.explicitChangeMentions,

    explicitDeltaCount:
      row.explicitDeltaCount,

    deltaCount:
      row.deltaCount,

    positiveDeltaCount:
      row.positiveDeltaCount,

    negativeDeltaCount:
      row.negativeDeltaCount,

    firstObservedTick:
      row.firstObservedTick,

    lastObservedTick:
      row.lastObservedTick,

    playersWithFiniteValue:
      row.playersWithFiniteValue.size,

    controllerIndexesWithFiniteValue:
      row
        .controllerIndexesWithFiniteValue
        .size,

    deltaValues:
      summarizeNumbers(
        row.deltaValues
      )
  };
}


// ============================================================
// COMPACT OUTPUT HELPERS
// ============================================================

function compactAnchor(
  row
) {
  return {
    sourceType:
      row.sourceType,

    sourceId:
      row.sourceId,

    episodeId:
      row.episodeId,

    entityIndex:
      row.entityIndex,

    orbTeam:
      row.orbTeam,

    anchorTick:
      row.anchorTick,

    anchorClock:
      ticksToClock(
        row.anchorTick
      ),

    anchorReason:
      row.anchorReason,

    shotObserved:
      row.shotObserved,

    correctedOutcomeLabel:
      row.correctedOutcomeLabel,

    firstHitPlayerName:
      row.firstHitPlayerName,

    firstHitTeam:
      row.firstHitTeam,

    expectedSignalTeam:
      row.expectedSignalTeam,

    expectedSignalBasis:
      row.expectedSignalBasis,

    nearestOtherAnchorTicks:
      finiteOrNull(
        row.nearestOtherAnchorTicks
      ),

    collisionWithin8Ticks:
      row.collisionWithin8Ticks,

    bestMeasurement:
      row.bestMeasurement
  };
}


function compactDelta(
  row,
  referenceTick
) {
  return {
    tick:
      row.tick,

    offsetTicks:
      row.tick -
      referenceTick,

    playerName:
      row.playerName,

    team:
      row.team,

    previousValue:
      row.previousValue,

    currentValue:
      row.currentValue,

    delta:
      row.delta,

    explicitlyChanged:
      row.explicitlyChanged
  };
}


// ============================================================
// FILE HELPERS
// ============================================================

async function loadJsonl(
  path
) {
  const rows = [];

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


function finishWriter(
  writer
) {
  return new Promise(
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


function finiteOrNull(
  value
) {
  return Number.isFinite(
    value
  )
    ? value
    : null;
}


function isGameTeam(
  value
) {
  return value ===
    2
    ||
    value ===
    3;
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


function directionLabel(
  expected,
  other
) {
  if (
    expected >
    other
  ) {
    return 'EXPECTED_TEAM_GREATER';
  }

  if (
    other >
    expected
  ) {
    return 'OTHER_TEAM_GREATER';
  }

  return 'TIE';
}


function sum(
  values
) {
  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
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
      percentile(
        clean,
        0.10
      ),

    p25:
      percentile(
        clean,
        0.25
      ),

    median:
      percentile(
        clean,
        0.50
      ),

    p75:
      percentile(
        clean,
        0.75
      ),

    p90:
      percentile(
        clean,
        0.90
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      sum(
        clean
      ) /
      clean.length
  };
}


function percentile(
  sorted,
  proportion
) {
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
    proportion;

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
    return sorted[lower];
  }

  const weight =
    position -
    lower;

  return sorted[lower] *
    (
      1 -
      weight
    )
    +
    sorted[upper] *
    weight;
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
    denominator ===
    0
  ) {
    return null;
  }

  return numerator /
    denominator;
}


function check(
  actual,
  expected,
  pass
) {
  return {
    actual,
    expected,
    pass
  };
}


function ticksToClock(
  tick
) {
  if (
    !Number.isFinite(
      tick
    )
  ) {
    return null;
  }

  const totalSeconds =
    Math.floor(
      tick /
      TICK_RATE
    );

  const minutes =
    Math.floor(
      totalSeconds /
      60
    );

  const seconds =
    totalSeconds %
    60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}


function formatPercent(
  value
) {
  return Number.isFinite(
    value
  )
    ? `${(value * 100).toFixed(1)}%`
    : 'n/a';
}


function formatNumber(
  value
) {
  return Number.isFinite(
    value
  )
    ? value.toFixed(
      3
    )
    : 'n/a';
}