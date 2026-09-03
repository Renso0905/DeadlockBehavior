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

const SENSITIVITY_COLLISION_RADIUS_TICKS =
  16;

const MAX_EVENT_EXAMPLES =
  30;

const MAX_BURST_EXAMPLES =
  20;

const TARGET_FIELDS = [
  'm_iGoldNetWorth',
  'm_iDenies',
  'm_iLastHits',
  'm_iPlayerKills',
  'm_iPlayerAssists'
];

const CONFOUND_FIELDS = [
  'm_iDenies',
  'm_iLastHits',
  'm_iPlayerKills',
  'm_iPlayerAssists'
];


// ============================================================
// CANDIDATE AWARD WINDOWS
//
// The window is selected ONLY from known-shot controls.
// No-shot rows are not used to choose the window.
// ============================================================

const WINDOWS = [
  {
    id: 'P0_P4',
    before: 0,
    after: 4
  },
  {
    id: 'P0_P6',
    before: 0,
    after: 6
  },
  {
    id: 'P0_P8',
    before: 0,
    after: 8
  },
  {
    id: 'P0_P12',
    before: 0,
    after: 12
  },
  {
    id: 'P0_P16',
    before: 0,
    after: 16
  },
  {
    id: 'M2_P8',
    before: 2,
    after: 8
  }
];


// ============================================================
// PREDECLARED VALIDATION THRESHOLDS
//
// These are intentionally conservative. A validation PASS means
// the single-replay telemetry supports the mechanic under these
// criteria. It does NOT make the mechanic globally canonical.
// ============================================================

const CONTROL_THRESHOLDS = {
  minimumHoldoutControls: 20,
  minimumShooterSignalRate: 0.95,
  minimumWinnerSignalRate: 0.95,
  minimumWinnerDominanceRate: 0.80,
  minimumCleanWinnerOnlyRate: 0.60,
  maximumOtherOnlyRate: 0.05,
  minimumSameTeamDenyConfirmationRate: 0.95,
  maximumOpposingTeamDenyFalsePositiveRate: 0.05
};

const TROOPER_AUTO_THRESHOLDS = {
  minimumCleanNoShotEvents: 100,
  minimumOppositeTeamSignalRate: 0.90,
  minimumOppositeTeamDominanceRate: 0.95,
  maximumSameTeamOnlyRate: 0.02,
  minimumTimingSupportRate: 0.90,
  minimumFloorSupportRate: 0.85
};

const URN_BURST_THRESHOLDS = {
  minimumAllNoShotBursts: 2,
  minimumOppositeTeamSignalRate: 1.00,
  minimumOppositeTeamDominanceRate: 1.00,
  maximumBurstDenyIncrementRate: 0.00
};


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

const script65SummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_final_outcome_validation_v01.json'
  );

const script65StreamPath =
  resolve(
    'output',
    replayName,
    'citemxp_final_outcomes_v01.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_resolution_validation_v02.json'
  );

const outputUnitsPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_units_v02.jsonl'
  );

const outputUrnBurstsPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_urn_bursts_v02.jsonl'
  );


// ============================================================
// REQUIRED INPUTS
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
//
// Script 62 is used for target/lifecycle/race structure only.
// Its Urn CLAIM/DENY semantic labels are NOT treated as truth.
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
// LOAD PLAYER / CONTROLLER IDENTITIES
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
// LOAD SCRIPT 62 PER-ORB STRUCTURE
// ============================================================

console.log('');
console.log(
  'Loading validated CItemXP target structure...'
);

const correctedRows =
  await loadJsonl(
    correctedOutcomePath
  );

const anchors =
  correctedRows
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

for (
  let i = 0;
  i <
  anchors.length;
  i++
) {
  const anchor =
    anchors[i];

  anchor.anchorIndex =
    i;

  const previousDistance =
    i >
    0
      ? anchor.anchorTick -
        anchors[i - 1].anchorTick
      : Infinity;

  const nextDistance =
    i + 1 <
    anchors.length
      ? anchors[i + 1].anchorTick -
        anchor.anchorTick
      : Infinity;

  anchor.nearestOtherAnchorTicks =
    Math.min(
      previousDistance,
      nextDistance
    );

  anchor.collisionWithin8Ticks =
    anchor.nearestOtherAnchorTicks <=
    COLLISION_RADIUS_TICKS;

  anchor.collisionWithin16Ticks =
    anchor.nearestOtherAnchorTicks <=
    SENSITIVITY_COLLISION_RADIUS_TICKS;
}

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

const trooperNoShotAnchors =
  noShotAnchors.filter(
    row =>
      row.sourceType ===
      'TROOPER_DEATH'
  );

const urnNoShotAnchors =
  noShotAnchors.filter(
    row =>
      row.sourceType ===
      'URN_DELIVERY'
  );

console.log(
  `Targets: ${anchors.length}`
);

console.log(
  `Shot / no-shot: ${shotAnchors.length} / ${noShotAnchors.length}`
);


// ============================================================
// OPTIONAL SCRIPT 65 COMPARATOR
//
// Script 65 is NEVER used to decide the Script 69 outcome.
// It is loaded only so the output can show how many old labels
// survive the stricter validation.
// ============================================================

let script65Summary =
  null;

let script65ByEpisodeId =
  new Map();

if (
  existsSync(
    script65SummaryPath
  )
  &&
  existsSync(
    script65StreamPath
  )
) {
  try {
    script65Summary =
      JSON.parse(
        readFileSync(
          script65SummaryPath,
          'utf8'
        )
      );

    const script65Rows =
      await loadJsonl(
        script65StreamPath
      );

    for (
      const row
      of script65Rows
    ) {
      const episodeId =
        row?.episodeId ??
        null;

      if (
        episodeId
      ) {
        script65ByEpisodeId.set(
          String(
            episodeId
          ),
          row
        );
      }
    }
  } catch {
    script65Summary =
      null;

    script65ByEpisodeId =
      new Map();
  }
}


// ============================================================
// SHOT-CONTROL COHORT
//
// Use non-mixed Trooper shot episodes.
// Prefer collision-free controls.
//
// The controls are split deterministically into calibration and
// holdout sets by chronological order so the no-shot test does
// not reuse no-shot data to tune the award window.
// ============================================================

let fingerprintControls =
  shotAnchors.filter(
    row =>
      row.sourceType ===
        'TROOPER_DEATH'
      &&
      !row.mixedTeamRace
      &&
      isGameTeam(
        row.firstHitTeam
      )
      &&
      !row.collisionWithin8Ticks
  );

let fingerprintControlCohort =
  'COLLISION_FREE_NON_MIXED_TROOPER_SHOTS';

if (
  fingerprintControls.length <
  40
) {
  fingerprintControls =
    shotAnchors.filter(
      row =>
        row.sourceType ===
          'TROOPER_DEATH'
        &&
        !row.mixedTeamRace
        &&
        isGameTeam(
          row.firstHitTeam
        )
    );

  fingerprintControlCohort =
    'ALL_NON_MIXED_TROOPER_SHOTS_FALLBACK';
}

fingerprintControls.sort(
  (
    a,
    b
  ) =>
    a.anchorTick -
    b.anchorTick
);

const calibrationControls =
  fingerprintControls.filter(
    (
      row,
      index
    ) =>
      index %
      2 ===
      0
  );

const holdoutControls =
  fingerprintControls.filter(
    (
      row,
      index
    ) =>
      index %
      2 ===
      1
  );

console.log(
  `Fingerprint controls: ${fingerprintControls.length}`
);

console.log(
  `Calibration / holdout: ${calibrationControls.length} / ${holdoutControls.length}`
);


// ============================================================
// RAW CONTROLLER TELEMETRY
//
// This rescans the replay instead of consuming Script 64's
// per-anchor measurements. That is the key independence check.
// ============================================================

const previousValue =
  new Map();

const fieldTelemetry =
  new Map(
    TARGET_FIELDS.map(
      fieldName => [
        fieldName,
        createFieldTelemetry(
          fieldName
        )
      ]
    )
  );

const deltaEvents =
  [];

let controllerEntityEvents =
  0;

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
      of events ??
      []
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

        const deltaRow = {
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
          deltaRow
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
          deltaRow.explicitlyChanged
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


console.log('');
console.log(
  'Rescanning replay for independent controller-economy telemetry...'
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
    ||
    a.fieldName.localeCompare(
      b.fieldName
    )
);

console.log(
  `Controller entity events: ${controllerEntityEvents}`
);

console.log(
  `Tracked field deltas: ${deltaEvents.length}`
);


// ============================================================
// CALIBRATE WINDOW ON TRAINING SHOT CONTROLS
// ============================================================

const windowCalibration =
  WINDOWS
    .map(
      window =>
        summarizeShotControls(
          calibrationControls,
          window
        )
    )
    .sort(
      compareWindowCalibration
    );

const selectedWindow =
  windowCalibration[0]
    ?.window ??
  WINDOWS[2];

const calibrationSelected =
  windowCalibration[0] ??
  summarizeShotControls(
    calibrationControls,
    selectedWindow
  );

const holdoutSelected =
  summarizeShotControls(
    holdoutControls,
    selectedWindow
  );


// ============================================================
// SHOT SEMANTIC CHECK
//
// This does not use Script 62's Urn label.
// Relation to orb team + m_iDenies is tested directly.
// ============================================================

const semanticShotControls =
  shotAnchors.filter(
    row =>
      !row.mixedTeamRace
      &&
      isGameTeam(
        row.firstHitTeam
      )
      &&
      isGameTeam(
        row.orbTeam
      )
  );

const shotSemanticValidation =
  summarizeShotSemantics(
    semanticShotControls,
    selectedWindow
  );


// ============================================================
// HOLDOUT CONTROL PASS
// ============================================================

const controlFingerprintChecks = {
  holdoutCount: check(
    holdoutSelected.controlCount,
    `>=${CONTROL_THRESHOLDS.minimumHoldoutControls}`,
    holdoutSelected.controlCount >=
      CONTROL_THRESHOLDS.minimumHoldoutControls
  ),

  shooterSignalRate: check(
    holdoutSelected.shooterSignalRate,
    `>=${CONTROL_THRESHOLDS.minimumShooterSignalRate}`,
    holdoutSelected.shooterSignalRate >=
      CONTROL_THRESHOLDS.minimumShooterSignalRate
  ),

  winnerSignalRate: check(
    holdoutSelected.winnerSignalRate,
    `>=${CONTROL_THRESHOLDS.minimumWinnerSignalRate}`,
    holdoutSelected.winnerSignalRate >=
      CONTROL_THRESHOLDS.minimumWinnerSignalRate
  ),

  winnerDominanceRate: check(
    holdoutSelected.winnerDominanceRate,
    `>=${CONTROL_THRESHOLDS.minimumWinnerDominanceRate}`,
    holdoutSelected.winnerDominanceRate >=
      CONTROL_THRESHOLDS.minimumWinnerDominanceRate
  ),

  cleanWinnerOnlyRate: check(
    holdoutSelected.cleanWinnerOnlyRate,
    `>=${CONTROL_THRESHOLDS.minimumCleanWinnerOnlyRate}`,
    holdoutSelected.cleanWinnerOnlyRate >=
      CONTROL_THRESHOLDS.minimumCleanWinnerOnlyRate
  ),

  otherOnlyRate: check(
    holdoutSelected.otherOnlyRate,
    `<=${CONTROL_THRESHOLDS.maximumOtherOnlyRate}`,
    holdoutSelected.otherOnlyRate <=
      CONTROL_THRESHOLDS.maximumOtherOnlyRate
  ),

  sameTeamDenyConfirmationRate: check(
    shotSemanticValidation.sameOrbTeam
      .shooterDenyIncrementRate,
    `>=${CONTROL_THRESHOLDS.minimumSameTeamDenyConfirmationRate}`,
    shotSemanticValidation.sameOrbTeam
      .shooterDenyIncrementRate >=
      CONTROL_THRESHOLDS.minimumSameTeamDenyConfirmationRate
  ),

  opposingTeamDenyFalsePositiveRate: check(
    shotSemanticValidation.opposingOrbTeam
      .shooterDenyIncrementRate,
    `<=${CONTROL_THRESHOLDS.maximumOpposingTeamDenyFalsePositiveRate}`,
    shotSemanticValidation.opposingOrbTeam
      .shooterDenyIncrementRate <=
      CONTROL_THRESHOLDS.maximumOpposingTeamDenyFalsePositiveRate
  )
};

const controlFingerprintPass =
  Object
    .values(
      controlFingerprintChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// DERIVE MAGNITUDE + TIMING ENVELOPE FROM HOLDOUT CONTROLS
//
// Use the 5th percentile rather than the absolute minimum.
// This avoids letting one unusually weak/noisy control define
// the no-shot evidence floor.
// ============================================================

const holdoutMeasurements =
  holdoutControls.map(
    anchor =>
      measureShotControl(
        anchor,
        selectedWindow
      )
  );

const positiveWinnerDeltas =
  holdoutMeasurements
    .map(
      row =>
        row.winnerTeamPositiveDelta
    )
    .filter(
      value =>
        Number.isFinite(
          value
        )
        &&
        value >
        0
    );

const firstWinnerOffsets =
  holdoutMeasurements
    .map(
      row =>
        row.firstWinnerOffsetTicks
    )
    .filter(
      Number.isFinite
    );

const winnerDeltaFloor =
  positiveWinnerDeltas.length
    ? quantile(
      positiveWinnerDeltas,
      0.05
    )
    : null;

const rawTimingLow =
  firstWinnerOffsets.length
    ? quantile(
      firstWinnerOffsets,
      0.05
    )
    : null;

const rawTimingHigh =
  firstWinnerOffsets.length
    ? quantile(
      firstWinnerOffsets,
      0.95
    )
    : null;

const timingEnvelope = {
  minOffsetTicks:
    Number.isFinite(
      rawTimingLow
    )
      ? Math.max(
        -selectedWindow.before,
        Math.floor(
          rawTimingLow
        ) -
        1
      )
      : -selectedWindow.before,

  maxOffsetTicks:
    Number.isFinite(
      rawTimingHigh
    )
      ? Math.min(
        selectedWindow.after,
        Math.ceil(
          rawTimingHigh
        ) +
        1
      )
      : selectedWindow.after,

  source:
    '5TH_TO_95TH_PERCENTILE_OF_HOLDOUT_FIRST_WINNER_OFFSETS_EXPANDED_BY_ONE_TICK'
};


// ============================================================
// MEASURE ALL NO-SHOT EPISODES WITHOUT ASSUMING A WINNER
// ============================================================

const rawNoShotRows =
  noShotAnchors.map(
    anchor => {
      const evidence =
        measureEvidence(
          anchor.anchorTick -
            selectedWindow.before,

          anchor.anchorTick +
            selectedWindow.after,

          anchor.anchorTick
        );

      return buildNoShotEvidence(
        anchor,
        evidence,
        winnerDeltaFloor,
        timingEnvelope
      );
    }
  );

const rawTrooperNoShot =
  rawNoShotRows.filter(
    row =>
      row.sourceType ===
      'TROOPER_DEATH'
  );


// ============================================================
// TROOPER NO-SHOT COHORT TEST
//
// Crucially, this asks:
//   Does observed economy point to OPPOSITE-orb-team recipients?
//
// It does not pre-label the opposite team as the winner.
// ============================================================

const trooperAutoValidation =
  summarizeTrooperAutoEvidence(
    rawTrooperNoShot
  );

const trooperAutoChecks = {
  controlFingerprintPass: check(
    controlFingerprintPass,
    true,
    controlFingerprintPass
  ),

  cleanNoShotEvents: check(
    trooperAutoValidation.cleanEvents,
    `>=${TROOPER_AUTO_THRESHOLDS.minimumCleanNoShotEvents}`,
    trooperAutoValidation.cleanEvents >=
      TROOPER_AUTO_THRESHOLDS.minimumCleanNoShotEvents
  ),

  oppositeTeamSignalRate: check(
    trooperAutoValidation.oppositeTeamSignalRate,
    `>=${TROOPER_AUTO_THRESHOLDS.minimumOppositeTeamSignalRate}`,
    trooperAutoValidation.oppositeTeamSignalRate >=
      TROOPER_AUTO_THRESHOLDS.minimumOppositeTeamSignalRate
  ),

  oppositeTeamDominanceRate: check(
    trooperAutoValidation.oppositeTeamDominanceRate,
    `>=${TROOPER_AUTO_THRESHOLDS.minimumOppositeTeamDominanceRate}`,
    trooperAutoValidation.oppositeTeamDominanceRate >=
      TROOPER_AUTO_THRESHOLDS.minimumOppositeTeamDominanceRate
  ),

  sameTeamOnlyRate: check(
    trooperAutoValidation.sameTeamOnlyRate,
    `<=${TROOPER_AUTO_THRESHOLDS.maximumSameTeamOnlyRate}`,
    trooperAutoValidation.sameTeamOnlyRate <=
      TROOPER_AUTO_THRESHOLDS.maximumSameTeamOnlyRate
  ),

  timingSupportRate: check(
    trooperAutoValidation.timingSupportRate,
    `>=${TROOPER_AUTO_THRESHOLDS.minimumTimingSupportRate}`,
    trooperAutoValidation.timingSupportRate >=
      TROOPER_AUTO_THRESHOLDS.minimumTimingSupportRate
  ),

  floorSupportRate: check(
    trooperAutoValidation.floorSupportRate,
    `>=${TROOPER_AUTO_THRESHOLDS.minimumFloorSupportRate}`,
    trooperAutoValidation.floorSupportRate >=
      TROOPER_AUTO_THRESHOLDS.minimumFloorSupportRate
  )
};

const trooperAutoAwardMechanicPass =
  Object
    .values(
      trooperAutoChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// URN BURST TEST
//
// Urn payout orbs are intentionally tested at the BURST level.
// Ten payout objects overlap too tightly for independent per-orb
// economy attribution.
//
// The all-no-shot bursts are the strongest natural experiment:
// no shooter can explain a deny/claim award in those bursts.
// ============================================================

const urnBursts =
  buildUrnBursts(
    anchors.filter(
      row =>
        row.sourceType ===
        'URN_DELIVERY'
    ),
    selectedWindow
  );

const allNoShotUrnBursts =
  urnBursts.filter(
    row =>
      row.noShotCount ===
      row.orbCount
  );

const urnBurstValidation =
  summarizeUrnBurstEvidence(
    allNoShotUrnBursts
  );

const urnBurstChecks = {
  controlFingerprintPass: check(
    controlFingerprintPass,
    true,
    controlFingerprintPass
  ),

  allNoShotBurstCount: check(
    urnBurstValidation.allNoShotBursts,
    `>=${URN_BURST_THRESHOLDS.minimumAllNoShotBursts}`,
    urnBurstValidation.allNoShotBursts >=
      URN_BURST_THRESHOLDS.minimumAllNoShotBursts
  ),

  oppositeTeamSignalRate: check(
    urnBurstValidation.oppositeTeamSignalRate,
    `>=${URN_BURST_THRESHOLDS.minimumOppositeTeamSignalRate}`,
    urnBurstValidation.oppositeTeamSignalRate >=
      URN_BURST_THRESHOLDS.minimumOppositeTeamSignalRate
  ),

  oppositeTeamDominanceRate: check(
    urnBurstValidation.oppositeTeamDominanceRate,
    `>=${URN_BURST_THRESHOLDS.minimumOppositeTeamDominanceRate}`,
    urnBurstValidation.oppositeTeamDominanceRate >=
      URN_BURST_THRESHOLDS.minimumOppositeTeamDominanceRate
  ),

  burstDenyIncrementRate: check(
    urnBurstValidation.burstsWithAnyDenyIncrementRate,
    `<=${URN_BURST_THRESHOLDS.maximumBurstDenyIncrementRate}`,
    urnBurstValidation.burstsWithAnyDenyIncrementRate <=
      URN_BURST_THRESHOLDS.maximumBurstDenyIncrementRate
  )
};

const urnAutoAwardMechanicBurstPass =
  Object
    .values(
      urnBurstChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// FINAL PER-NO-SHOT CLASSIFICATION
//
// These statuses are stricter than Script 65.
//
// TROOPER:
// - AUTO_AWARD_VALIDATED requires clean event-level evidence AND
//   the cohort-level mechanic test to pass.
// - AUTO_AWARD_PROBABLE means direction/timing are supportive
//   but the full validation gate was not met.
// - ECONOMY_COLLISION means another CItemXP resolution or a
//   counter-defined economy event contaminates the window.
// - UNRESOLVED means no clean supporting signal.
//
// URN:
// - Individual orbs are never called VALIDATED here because the
//   ten-orb burst overlaps.
// - All-no-shot burst support may make an individual orb
//   PROBABLE, but attribution remains burst-level.
// ============================================================

const urnBurstBySourceId =
  new Map(
    urnBursts.map(
      row => [
        String(
          row.sourceId
        ),
        row
      ]
    )
  );

const finalUnits =
  rawNoShotRows.map(
    row => {
      let result;

      if (
        row.sourceType ===
        'TROOPER_DEATH'
      ) {
        result =
          classifyTrooperNoShot(
            row,
            {
              controlFingerprintPass,
              trooperAutoAwardMechanicPass
            }
          );

      } else {
        result =
          classifyUrnNoShot(
            row,
            urnBurstBySourceId.get(
              String(
                row.sourceId
              )
            ) ??
            null,
            {
              controlFingerprintPass,
              urnAutoAwardMechanicBurstPass
            }
          );
      }

      const script65Row =
        row.episodeId
          ? script65ByEpisodeId.get(
            String(
              row.episodeId
            )
          ) ??
          null
          : null;

      return {
        ...row,

        resolution:
          result,

        script65Comparator: {
          available:
            Boolean(
              script65Row
            ),

          oldOutcome:
            script65Row
              ?.finalOutcome
              ?.label ??
            null,

          oldConfidence:
            script65Row
              ?.finalOutcome
              ?.confidence ??
            null,

          note:
            'Script 65 is comparator-only and does not influence Script 69 classification.'
        }
      };
    }
  );


// ============================================================
// SCRIPT 65 CROSSWALK
// ============================================================

const script65Crosswalk =
  mapToSortedObject(
    countBy(
      finalUnits,
      row =>
        `${row.script65Comparator.oldOutcome ?? 'NO_SCRIPT65_ROW'} -> ${row.resolution.status}`
    )
  );


// ============================================================
// OUTPUT COUNTS
// ============================================================

const resolutionStatusCounts =
  mapToSortedObject(
    countBy(
      finalUnits,
      row =>
        row.resolution.status
    )
  );

const resolutionStatusBySource =
  {
    trooper:
      mapToSortedObject(
        countBy(
          finalUnits.filter(
            row =>
              row.sourceType ===
              'TROOPER_DEATH'
          ),
          row =>
            row.resolution.status
        )
      ),

    urn:
      mapToSortedObject(
        countBy(
          finalUnits.filter(
            row =>
              row.sourceType ===
              'URN_DELIVERY'
          ),
          row =>
            row.resolution.status
        )
      )
  };


// ============================================================
// PIPELINE VALIDATION
//
// This means the diagnostic itself ran coherently.
// It is deliberately separate from whether either mechanic test
// passes.
// ============================================================

const expectedCounts =
  raceSummary?.counts ??
  {};

const pipelineChecks = {
  script62Passed: check(
    raceSummary
      ?.validation
      ?.pass,
    true,
    raceSummary
      ?.validation
      ?.pass ===
      true
  ),

  targetCountPreserved: check(
    anchors.length,
    expectedCounts.targets,
    anchors.length ===
      expectedCounts.targets
  ),

  shotCountPreserved: check(
    shotAnchors.length,
    expectedCounts.shotEpisodes,
    shotAnchors.length ===
      expectedCounts.shotEpisodes
  ),

  noShotCountPreserved: check(
    noShotAnchors.length,
    expectedCounts.noShotEpisodes,
    noShotAnchors.length ===
      expectedCounts.noShotEpisodes
  ),

  playerIdentitiesLoaded: check(
    playerByControllerIndex.size,
    '>=10',
    playerByControllerIndex.size >=
      10
  ),

  controllerEventsObserved: check(
    controllerEntityEvents,
    '>0',
    controllerEntityEvents >
      0
  ),

  goldNetWorthDeltasObserved: check(
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

  fingerprintControlCount: check(
    fingerprintControls.length,
    '>=40 preferred',
    fingerprintControls.length >=
      40
  ),

  holdoutControlsAvailable: check(
    holdoutControls.length,
    `>=${CONTROL_THRESHOLDS.minimumHoldoutControls}`,
    holdoutControls.length >=
      CONTROL_THRESHOLDS.minimumHoldoutControls
  ),

  noShotUnitsAccountedFor: check(
    finalUnits.length,
    noShotAnchors.length,
    finalUnits.length ===
      noShotAnchors.length
  ),

  urnBurstsObserved: check(
    urnBursts.length,
    '>0',
    urnBursts.length >
      0
  )
};

const pipelineValidationPass =
  Object
    .values(
      pipelineChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// WRITE OUTPUT STREAMS
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

const unitWriter =
  createWriteStream(
    outputUnitsPath,
    {
      encoding:
        'utf8'
    }
  );

for (
  const row
  of finalUnits
) {
  unitWriter.write(
    `${JSON.stringify(row)}\n`
  );
}

await finishWriter(
  unitWriter
);

const burstWriter =
  createWriteStream(
    outputUrnBurstsPath,
    {
      encoding:
        'utf8'
    }
  );

for (
  const row
  of urnBursts
) {
  burstWriter.write(
    `${JSON.stringify(row)}\n`
  );
}

await finishWriter(
  burstWriter
);


// ============================================================
// SUMMARY
// ============================================================

const summaryStatus =
  !pipelineValidationPass
    ? 'DIAGNOSTIC_PIPELINE_FAILURE'
    : !controlFingerprintPass
      ? 'SHOT_CONTROL_FINGERPRINT_FAILED_NO_AUTO_AWARD_PROMOTION'
      : trooperAutoAwardMechanicPass
        &&
        urnAutoAwardMechanicBurstPass
        ? 'AUTO_AWARD_MECHANIC_SUPPORTED_WITH_SCOPE_LIMITS'
        : trooperAutoAwardMechanicPass
          ||
          urnAutoAwardMechanicBurstPass
          ? 'AUTO_AWARD_MECHANIC_PARTIALLY_SUPPORTED'
          : 'AUTO_AWARD_MECHANIC_NOT_YET_VALIDATED';

const summary = {
  replay:
    replayName,

  version:
    'CITEMXP_AUTO_AWARD_RESOLUTION_VALIDATION_V02',

  canonical:
    false,

  status:
    summaryStatus,

  purpose: [
    'Independently rescan raw controller telemetry to challenge Script 65 automatic no-shot CItemXP outcomes.',
    'Choose the economy timing window only from known-shot Trooper controls, with a deterministic calibration/holdout split.',
    'Test no-shot Trooper team direction without presupposing that opposite-orb-team is the winner.',
    'Test Soul Urn automatic payout semantics at the burst level, where the ten payout objects can be evaluated without pretending each tightly overlapping orb is independently attributable.',
    'Separate AUTO_AWARD_VALIDATED, AUTO_AWARD_PROBABLE, ECONOMY_COLLISION, and UNRESOLVED rather than forcing every untouched orb into a winner.'
  ],

  independenceFromEarlierAutoAwardLogic: {
    consumesScript64PerAnchorUnits:
      false,

    consumesScript65LabelsForClassification:
      false,

    script65Use:
      script65Summary
        ? 'COMPARATOR_ONLY'
        : 'NOT_AVAILABLE',

    directReplayRescan:
      true,

    fieldsRescanned:
      TARGET_FIELDS
  },

  inputs: {
    replay:
      replayPath,

    playerState:
      playerStatePath,

    script62Summary:
      raceSummaryPath,

    script62CorrectedOutcomes:
      correctedOutcomePath,

    optionalScript65Summary:
      existsSync(
        script65SummaryPath
      )
        ? script65SummaryPath
        : null,

    optionalScript65Stream:
      existsSync(
        script65StreamPath
      )
        ? script65StreamPath
        : null
  },

  counts: {
    targets:
      anchors.length,

    shotTargets:
      shotAnchors.length,

    noShotTargets:
      noShotAnchors.length,

    trooperNoShotTargets:
      trooperNoShotAnchors.length,

    urnNoShotTargets:
      urnNoShotAnchors.length,

    fingerprintControls:
      fingerprintControls.length,

    calibrationControls:
      calibrationControls.length,

    holdoutControls:
      holdoutControls.length,

    urnBursts:
      urnBursts.length,

    allNoShotUrnBursts:
      allNoShotUrnBursts.length
  },

  controllerTelemetry: {
    controllerEntityEvents,

    deltaEvents:
      deltaEvents.length,

    fields:
      Object.fromEntries(
        TARGET_FIELDS.map(
          fieldName => [
            fieldName,
            finalizeFieldTelemetry(
              fieldTelemetry.get(
                fieldName
              )
            )
          ]
        )
      )
  },

  shotControlFingerprint: {
    cohort:
      fingerprintControlCohort,

    splitRule:
      'Chronologically sorted controls; even indexes calibrate and odd indexes are holdout.',

    candidateWindows:
      windowCalibration,

    selectedWindow,

    calibration:
      calibrationSelected,

    holdout:
      holdoutSelected,

    checks:
      controlFingerprintChecks,

    pass:
      controlFingerprintPass,

    winnerDeltaFloor: {
      value:
        winnerDeltaFloor,

      derivation:
        '5th percentile of positive winning-team m_iGoldNetWorth deltas in holdout shot controls.'
    },

    timingEnvelope,

    shotSemanticValidation
  },

  trooperNoShotValidation: {
    thresholds:
      TROOPER_AUTO_THRESHOLDS,

    evidence:
      trooperAutoValidation,

    checks:
      trooperAutoChecks,

    pass:
      trooperAutoAwardMechanicPass,

    interpretation:
      trooperAutoAwardMechanicPass
        ? 'Collision-free, counter-clean no-shot Trooper episodes independently support automatic economy flowing to the opposite-orb team within the shot-calibrated timing envelope. Only event-level rows satisfying the strict gate are labeled AUTO_AWARD_VALIDATED.'
        : 'The no-shot Trooper cohort did not satisfy every predeclared validation criterion. Do not treat all untouched Trooper orbs as validated automatic awards.'
  },

  urnNoShotBurstValidation: {
    thresholds:
      URN_BURST_THRESHOLDS,

    evidence:
      urnBurstValidation,

    checks:
      urnBurstChecks,

    pass:
      urnAutoAwardMechanicBurstPass,

    interpretation:
      urnAutoAwardMechanicBurstPass
        ? 'All-no-shot Urn bursts support automatic payout to the opposite-orb team at the burst level. Individual untouched Urn orbs remain only PROBABLE because their economy windows overlap inside the ten-orb burst.'
        : 'All-no-shot Urn bursts did not satisfy every burst-level validation criterion. Keep individual untouched Urn outcomes unresolved/collision-affected.'
  },

  resolutionStatusCounts,

  resolutionStatusBySource,

  script65Crosswalk: {
    warning:
      'This is a comparison only. Script 65 labels were not used to create Script 69 classifications.',

    counts:
      script65Crosswalk
  },

  pipelineValidation: {
    pass:
      pipelineValidationPass,

    checks:
      pipelineChecks
  },

  interpretation: {
    pipeline:
      pipelineValidationPass
        ? 'The validation pipeline ran coherently.'
        : 'The validation pipeline failed one or more structural checks; do not interpret mechanic results.',

    automaticAwards:
      !controlFingerprintPass
        ? 'Known-shot holdout controls did not validate the selected net-worth fingerprint. No automatic award should be promoted from this run.'
        : trooperAutoAwardMechanicPass
          || urnAutoAwardMechanicBurstPass
          ? 'At least one automatic-award mechanic received independent support, but scope limits and event-level collision flags must be preserved.'
          : 'Neither automatic-award mechanic met the predeclared validation gate. Keep Script 65 no-shot outcomes provisional.',

    singleReplayCaution:
      'All mechanic conclusions remain single-replay validation. Cross-replay replication is required before canonicalizing them.'
  },

  nextStep:
    !pipelineValidationPass
      ? 'Fix failed structural checks before continuing.'
      : !controlFingerprintPass
        ? 'Inspect the selected-window holdout failures and design a better direct award signal before revisiting no-shot outcomes.'
        : trooperAutoAwardMechanicPass
          ? 'Use only AUTO_AWARD_VALIDATED Trooper rows for downstream automatic-award metrics; preserve PROBABLE, COLLISION, and UNRESOLVED rows separately. Then repair Script 56 melee ingestion.'
          : 'Do not promote Script 65 automatic outcomes yet. Inspect the no-shot direction/timing failure modes before moving downstream.',

  outputs: {
    summary:
      outputSummaryPath,

    perNoShotUnits:
      outputUnitsPath,

    urnBursts:
      outputUrnBurstsPath
  }
};

writeFileSync(
  outputSummaryPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'CITEMXP AUTO-AWARD RESOLUTION VALIDATION V0.2'
);
console.log(
  '========================================================'
);
console.log('');

console.log(
  `Selected shot-control window: ${selectedWindow.id}`
);

console.log(
  `Holdout controls: ${holdoutSelected.controlCount}`
);

console.log(
  `Holdout shooter signal: ${formatPercent(holdoutSelected.shooterSignalRate)}`
);

console.log(
  `Holdout winner signal: ${formatPercent(holdoutSelected.winnerSignalRate)}`
);

console.log(
  `Holdout winner dominance: ${formatPercent(holdoutSelected.winnerDominanceRate)}`
);

console.log(
  `Holdout clean winner-only: ${formatPercent(holdoutSelected.cleanWinnerOnlyRate)}`
);

console.log(
  `Holdout other-only: ${formatPercent(holdoutSelected.otherOnlyRate)}`
);

console.log(
  `Winner delta floor: ${formatNumber(winnerDeltaFloor)}`
);

console.log(
  `Timing envelope: ${timingEnvelope.minOffsetTicks}..${timingEnvelope.maxOffsetTicks} ticks`
);

console.log('');
console.log(
  'SHOT SEMANTICS'
);
console.log(
  '--------------'
);

console.log(
  `Same-orb-team shooter deny increment: ${formatPercent(shotSemanticValidation.sameOrbTeam.shooterDenyIncrementRate)}`
);

console.log(
  `Opposing-orb-team shooter deny increment: ${formatPercent(shotSemanticValidation.opposingOrbTeam.shooterDenyIncrementRate)}`
);

console.log('');
console.log(
  `SHOT CONTROL FINGERPRINT: ${controlFingerprintPass ? 'PASS' : 'FAIL'}`
);

console.log('');
console.log(
  'TROOPER NO-SHOT'
);
console.log(
  '---------------'
);

console.log(
  `Clean events: ${trooperAutoValidation.cleanEvents}/${trooperAutoValidation.totalEvents}`
);

console.log(
  `Opposite-team signal rate: ${formatPercent(trooperAutoValidation.oppositeTeamSignalRate)}`
);

console.log(
  `Opposite-team dominance rate: ${formatPercent(trooperAutoValidation.oppositeTeamDominanceRate)}`
);

console.log(
  `Same-team-only rate: ${formatPercent(trooperAutoValidation.sameTeamOnlyRate)}`
);

console.log(
  `Timing support rate: ${formatPercent(trooperAutoValidation.timingSupportRate)}`
);

console.log(
  `Floor support rate: ${formatPercent(trooperAutoValidation.floorSupportRate)}`
);

console.log(
  `TROOPER AUTO-AWARD MECHANIC: ${trooperAutoAwardMechanicPass ? 'SUPPORTED' : 'NOT VALIDATED'}`
);

console.log('');
console.log(
  'URN ALL-NO-SHOT BURSTS'
);
console.log(
  '----------------------'
);

console.log(
  `All-no-shot bursts: ${urnBurstValidation.allNoShotBursts}`
);

console.log(
  `Opposite-team signal rate: ${formatPercent(urnBurstValidation.oppositeTeamSignalRate)}`
);

console.log(
  `Opposite-team dominance rate: ${formatPercent(urnBurstValidation.oppositeTeamDominanceRate)}`
);

console.log(
  `Bursts with deny increment: ${urnBurstValidation.burstsWithAnyDenyIncrement}/${urnBurstValidation.allNoShotBursts}`
);

console.log(
  `URN AUTO-AWARD MECHANIC: ${urnAutoAwardMechanicBurstPass ? 'SUPPORTED AT BURST LEVEL' : 'NOT VALIDATED'}`
);

console.log('');
console.log(
  'PER-ORB NO-SHOT STATUS'
);
console.log(
  '----------------------'
);

for (
  const [
    status,
    count
  ]
  of Object.entries(
    resolutionStatusCounts
  )
) {
  console.log(
    `${status.padEnd(28)} ${count}`
  );
}

console.log('');
console.log(
  'PIPELINE VALIDATION'
);
console.log(
  '-------------------'
);

for (
  const [
    name,
    row
  ]
  of Object.entries(
    pipelineChecks
  )
) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');
console.log(
  `OVERALL PIPELINE: ${pipelineValidationPass ? 'PASS' : 'FAIL'}`
);

console.log('');
console.log(
  `Summary:\n${outputSummaryPath}`
);

console.log('');
console.log(
  `Per-no-shot units:\n${outputUnitsPath}`
);

console.log('');
console.log(
  `Urn bursts:\n${outputUrnBurstsPath}`
);

console.log('');


// ============================================================
// NORMALIZE SCRIPT 62 ROW
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
// NORMALIZE LIFECYCLE
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

  return {
    ...row,

    shotObserved,

    firstHitTick:
      row.firstHit?.tick ??
      null,

    firstHitPlayerName:
      row.firstHit?.playerName ??
      null,

    firstHitTeam:
      finite(
        row.firstHit?.team
      ),

    anchorTick,

    anchorReason
  };
}


// ============================================================
// SHOT CONTROL WINDOW SUMMARY
// ============================================================

function summarizeShotControls(
  controls,
  window
) {
  const measurements =
    controls.map(
      anchor =>
        measureShotControl(
          anchor,
          window
        )
    );

  const controlCount =
    measurements.length;

  const shooterSignal =
    measurements.filter(
      row =>
        row.shooterPositiveDelta >
        0
    ).length;

  const winnerSignal =
    measurements.filter(
      row =>
        row.winnerTeamPositiveDelta >
        0
    ).length;

  const winnerOnly =
    measurements.filter(
      row =>
        row.winnerTeamPositiveDelta >
        0
        &&
        row.loserTeamPositiveDelta ===
        0
    ).length;

  const otherOnly =
    measurements.filter(
      row =>
        row.winnerTeamPositiveDelta ===
        0
        &&
        row.loserTeamPositiveDelta >
        0
    ).length;

  const winnerDominant =
    measurements.filter(
      row =>
        row.winnerTeamPositiveDelta >
        row.loserTeamPositiveDelta
    ).length;

  const tie =
    measurements.filter(
      row =>
        row.winnerTeamPositiveDelta ===
        row.loserTeamPositiveDelta
    ).length;

  const shooterSignalRate =
    rate(
      shooterSignal,
      controlCount
    ) ??
    0;

  const winnerSignalRate =
    rate(
      winnerSignal,
      controlCount
    ) ??
    0;

  const cleanWinnerOnlyRate =
    rate(
      winnerOnly,
      controlCount
    ) ??
    0;

  const otherOnlyRate =
    rate(
      otherOnly,
      controlCount
    ) ??
    0;

  const winnerDominanceRate =
    rate(
      winnerDominant,
      controlCount
    ) ??
    0;

  const windowWidth =
    window.before +
    window.after;

  const score =
    0.30 *
      shooterSignalRate
    +
    0.20 *
      winnerSignalRate
    +
    0.20 *
      cleanWinnerOnlyRate
    +
    0.20 *
      winnerDominanceRate
    +
    0.10 *
      (
        1 -
        otherOnlyRate
      )
    -
    0.0005 *
      windowWidth;

  return {
    window,

    controlCount,

    shooterSignal,

    winnerSignal,

    winnerOnly,

    otherOnly,

    winnerDominant,

    tie,

    shooterSignalRate,

    winnerSignalRate,

    cleanWinnerOnlyRate,

    otherOnlyRate,

    winnerDominanceRate,

    winnerTeamPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.winnerTeamPositiveDelta
        )
      ),

    loserTeamPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.loserTeamPositiveDelta
        )
      ),

    shooterPositiveDelta:
      summarizeNumbers(
        measurements.map(
          row =>
            row.shooterPositiveDelta
        )
      ),

    firstWinnerOffsetTicks:
      summarizeNumbers(
        measurements
          .map(
            row =>
              row.firstWinnerOffsetTicks
          )
          .filter(
            Number.isFinite
          )
      ),

    score
  };
}


// ============================================================
// WINDOW SORT
// ============================================================

function compareWindowCalibration(
  a,
  b
) {
  return b.score -
    a.score
    ||
    b.cleanWinnerOnlyRate -
    a.cleanWinnerOnlyRate
    ||
    b.winnerDominanceRate -
    a.winnerDominanceRate
    ||
    (
      a.window.before +
      a.window.after
    ) -
    (
      b.window.before +
      b.window.after
    );
}


// ============================================================
// MEASURE SHOT CONTROL
// ============================================================

function measureShotControl(
  anchor,
  window
) {
  const evidence =
    measureEvidence(
      anchor.anchorTick -
        window.before,

      anchor.anchorTick +
        window.after,

      anchor.anchorTick
    );

  const winnerTeam =
    anchor.firstHitTeam;

  const loserTeam =
    oppositeTeam(
      winnerTeam
    );

  const netWorth =
    evidence.fields
      .m_iGoldNetWorth;

  const denies =
    evidence.fields
      .m_iDenies;

  return {
    sourceType:
      anchor.sourceType,

    sourceId:
      anchor.sourceId,

    episodeId:
      anchor.episodeId,

    anchorTick:
      anchor.anchorTick,

    orbTeam:
      anchor.orbTeam,

    winnerTeam,

    loserTeam,

    shooter:
      anchor.firstHitPlayerName,

    winnerTeamPositiveDelta:
      teamPositiveDelta(
        netWorth,
        winnerTeam
      ),

    loserTeamPositiveDelta:
      teamPositiveDelta(
        netWorth,
        loserTeam
      ),

    shooterPositiveDelta:
      playerPositiveDelta(
        netWorth,
        anchor.firstHitPlayerName
      ),

    shooterDenyDelta:
      playerPositiveDelta(
        denies,
        anchor.firstHitPlayerName
      ),

    firstWinnerOffsetTicks:
      firstTeamOffset(
        netWorth,
        winnerTeam
      ),

    evidence
  };
}


// ============================================================
// SHOT SEMANTICS
// ============================================================

function summarizeShotSemantics(
  controls,
  window
) {
  const same =
    [];

  const opposing =
    [];

  for (
    const anchor
    of controls
  ) {
    const measurement =
      measureShotControl(
        anchor,
        window
      );

    if (
      anchor.firstHitTeam ===
      anchor.orbTeam
    ) {
      same.push(
        measurement
      );

    } else {
      opposing.push(
        measurement
      );
    }
  }

  return {
    sameOrbTeam:
      summarizeShotRelation(
        same
      ),

    opposingOrbTeam:
      summarizeShotRelation(
        opposing
      ),

    interpretation:
      'A same-orb-team shot is supported as DENY when the shooter m_iDenies counter increments; an opposing-orb-team shot is supported as SECURE/CLAIM when the shooter receives net worth without a deny increment.'
  };
}


function summarizeShotRelation(
  rows
) {
  const shooterNetWorth =
    rows.filter(
      row =>
        row.shooterPositiveDelta >
        0
    ).length;

  const shooterDeny =
    rows.filter(
      row =>
        row.shooterDenyDelta >
        0
    ).length;

  return {
    rows:
      rows.length,

    shooterNetWorthSignal:
      shooterNetWorth,

    shooterNetWorthSignalRate:
      rate(
        shooterNetWorth,
        rows.length
      ),

    shooterDenyIncrement:
      shooterDeny,

    shooterDenyIncrementRate:
      rate(
        shooterDeny,
        rows.length
      )
  };
}


// ============================================================
// RAW NO-SHOT EVIDENCE
// ============================================================

function buildNoShotEvidence(
  anchor,
  evidence,
  winnerFloor,
  timing
) {
  const sameTeam =
    anchor.orbTeam;

  const opposite =
    oppositeTeam(
      sameTeam
    );

  const netWorth =
    evidence.fields
      .m_iGoldNetWorth;

  const sameOrbTeamPositiveDelta =
    teamPositiveDelta(
      netWorth,
      sameTeam
    );

  const oppositeOrbTeamPositiveDelta =
    teamPositiveDelta(
      netWorth,
      opposite
    );

  const firstSameOffsetTicks =
    firstTeamOffset(
      netWorth,
      sameTeam
    );

  const firstOppositeOffsetTicks =
    firstTeamOffset(
      netWorth,
      opposite
    );

  const counterConfounds =
    {};

  let totalCounterConfoundDelta =
    0;

  for (
    const fieldName
    of CONFOUND_FIELDS
  ) {
    const field =
      evidence.fields[
        fieldName
      ];

    const totalPositiveDelta =
      field
        ?.totalPositiveDelta ??
      0;

    counterConfounds[
      fieldName
    ] =
      totalPositiveDelta;

    totalCounterConfoundDelta +=
      totalPositiveDelta;
  }

  const anyNetWorthSignal =
    sameOrbTeamPositiveDelta >
      0
    ||
    oppositeOrbTeamPositiveDelta >
      0;

  const direction =
    relationDirection(
      oppositeOrbTeamPositiveDelta,
      sameOrbTeamPositiveDelta
    );

  const floorSupported =
    Number.isFinite(
      winnerFloor
    )
      ? oppositeOrbTeamPositiveDelta >=
        winnerFloor
      : false;

  const timingSupported =
    Number.isFinite(
      firstOppositeOffsetTicks
    )
      ? firstOppositeOffsetTicks >=
          timing.minOffsetTicks
        &&
        firstOppositeOffsetTicks <=
          timing.maxOffsetTicks
      : false;

  const strictClean =
    !anchor.collisionWithin8Ticks
    &&
    totalCounterConfoundDelta ===
      0;

  const strictEventSupport =
    strictClean
    &&
    floorSupported
    &&
    timingSupported
    &&
    oppositeOrbTeamPositiveDelta >
      0
    &&
    sameOrbTeamPositiveDelta ===
      0;

  return {
    schemaVersion:
      2,

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

    oppositeOrbTeam:
      opposite,

    startTick:
      anchor.startTick,

    attackableStartTick:
      anchor.attackableStartTick,

    attackableEndTick:
      anchor.attackableEndTick,

    anchorTick:
      anchor.anchorTick,

    anchorClock:
      ticksToClock(
        anchor.anchorTick
      ),

    anchorReason:
      anchor.anchorReason,

    nearestOtherAnchorTicks:
      finiteOrNull(
        anchor.nearestOtherAnchorTicks
      ),

    collisionWithin8Ticks:
      anchor.collisionWithin8Ticks,

    collisionWithin16Ticks:
      anchor.collisionWithin16Ticks,

    sameOrbTeamPositiveDelta,

    oppositeOrbTeamPositiveDelta,

    firstSameOffsetTicks,

    firstOppositeOffsetTicks,

    direction,

    anyNetWorthSignal,

    winnerDeltaFloor:
      winnerFloor,

    floorSupported,

    timingEnvelope:
      timing,

    timingSupported,

    counterConfounds,

    totalCounterConfoundDelta,

    strictClean,

    strictEventSupport,

    evidence
  };
}


// ============================================================
// TROOPER COHORT SUMMARY
// ============================================================

function summarizeTrooperAutoEvidence(
  rows
) {
  const clean =
    rows.filter(
      row =>
        row.strictClean
    );

  const anySignal =
    clean.filter(
      row =>
        row.anyNetWorthSignal
    );

  const oppositeSignal =
    clean.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta >
        0
    );

  const oppositeOnly =
    clean.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta >
        0
        &&
        row.sameOrbTeamPositiveDelta ===
        0
    );

  const sameOnly =
    clean.filter(
      row =>
        row.sameOrbTeamPositiveDelta >
        0
        &&
        row.oppositeOrbTeamPositiveDelta ===
        0
    );

  const both =
    clean.filter(
      row =>
        row.sameOrbTeamPositiveDelta >
        0
        &&
        row.oppositeOrbTeamPositiveDelta >
        0
    );

  const neither =
    clean.filter(
      row =>
        row.sameOrbTeamPositiveDelta ===
        0
        &&
        row.oppositeOrbTeamPositiveDelta ===
        0
    );

  const oppositeDominant =
    anySignal.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta >
        row.sameOrbTeamPositiveDelta
    );

  const sameDominant =
    anySignal.filter(
      row =>
        row.sameOrbTeamPositiveDelta >
        row.oppositeOrbTeamPositiveDelta
    );

  const directional =
    anySignal.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta !==
        row.sameOrbTeamPositiveDelta
    );

  const timingSupported =
    oppositeSignal.filter(
      row =>
        row.timingSupported
    );

  const floorSupported =
    clean.filter(
      row =>
        row.floorSupported
    );

  return {
    totalEvents:
      rows.length,

    collisionWithin8Ticks:
      rows.filter(
        row =>
          row.collisionWithin8Ticks
      ).length,

    counterConfounded:
      rows.filter(
        row =>
          row.totalCounterConfoundDelta >
          0
      ).length,

    cleanEvents:
      clean.length,

    cleanWithAnySignal:
      anySignal.length,

    oppositeTeamSignal:
      oppositeSignal.length,

    oppositeOnly:
      oppositeOnly.length,

    sameOnly:
      sameOnly.length,

    bothTeams:
      both.length,

    neitherTeam:
      neither.length,

    oppositeDominant:
      oppositeDominant.length,

    sameDominant:
      sameDominant.length,

    directionalEvents:
      directional.length,

    timingSupported:
      timingSupported.length,

    floorSupported:
      floorSupported.length,

    strictEventSupport:
      clean.filter(
        row =>
          row.strictEventSupport
      ).length,

    oppositeTeamSignalRate:
      rate(
        oppositeSignal.length,
        clean.length
      ) ??
      0,

    oppositeTeamDominanceRate:
      rate(
        oppositeDominant.length,
        directional.length
      ) ??
      0,

    sameTeamOnlyRate:
      rate(
        sameOnly.length,
        clean.length
      ) ??
      0,

    timingSupportRate:
      rate(
        timingSupported.length,
        oppositeSignal.length
      ) ??
      0,

    floorSupportRate:
      rate(
        floorSupported.length,
        clean.length
      ) ??
      0,

    strictEventSupportRate:
      rate(
        clean.filter(
          row =>
            row.strictEventSupport
        ).length,
        clean.length
      ) ??
      0,

    oppositeTeamPositiveDelta:
      summarizeNumbers(
        clean.map(
          row =>
            row.oppositeOrbTeamPositiveDelta
        )
      ),

    sameOrbTeamPositiveDelta:
      summarizeNumbers(
        clean.map(
          row =>
            row.sameOrbTeamPositiveDelta
        )
      )
  };
}


// ============================================================
// TROOPER PER-EVENT CLASSIFICATION
// ============================================================

function classifyTrooperNoShot(
  row,
  context
) {
  if (
    !context.controlFingerprintPass
  ) {
    return {
      status:
        'UNRESOLVED',

      semanticOutcome:
        null,

      confidence:
        'UNRESOLVED',

      basis:
        'SHOT_CONTROL_FINGERPRINT_FAILED'
    };
  }

  if (
    row.collisionWithin8Ticks
  ) {
    return {
      status:
        'ECONOMY_COLLISION',

      semanticOutcome:
        null,

      confidence:
        'UNRESOLVED',

      basis:
        'ANOTHER_CITEMXP_RESOLUTION_WITHIN_8_TICKS'
    };
  }

  if (
    row.totalCounterConfoundDelta >
    0
  ) {
    return {
      status:
        'ECONOMY_COLLISION',

      semanticOutcome:
        null,

      confidence:
        'UNRESOLVED',

      basis:
        'COUNTER_DEFINED_ECONOMY_EVENT_IN_SELECTED_WINDOW'
    };
  }

  if (
    row.oppositeOrbTeamPositiveDelta >
      0
    &&
    row.sameOrbTeamPositiveDelta >
      0
  ) {
    return {
      status:
        'ECONOMY_COLLISION',

      semanticOutcome:
        null,

      confidence:
        'UNRESOLVED',

      basis:
        'BOTH_TEAMS_GAINED_NET_WORTH_IN_SELECTED_WINDOW'
    };
  }

  if (
    row.strictEventSupport
  ) {
    return context
      .trooperAutoAwardMechanicPass
      ? {
        status:
          'AUTO_AWARD_VALIDATED',

        semanticOutcome:
          'AUTO_AWARD_SECURE',

        confidence:
          'STRONG_SINGLE_REPLAY',

        winnerTeam:
          row.oppositeOrbTeam,

        basis:
          'COHORT_MECHANIC_PASS_PLUS_COLLISION_FREE_OPPOSITE_TEAM_ONLY_NET_WORTH_WITH_SHOT_CALIBRATED_MAGNITUDE_AND_TIMING'
      }
      : {
        status:
          'AUTO_AWARD_PROBABLE',

        semanticOutcome:
          'AUTO_AWARD_SECURE',

        confidence:
          'MODERATE',

        winnerTeam:
          row.oppositeOrbTeam,

        basis:
          'EVENT_LEVEL_SIGNAL_STRONG_BUT_COHORT_MECHANIC_GATE_DID_NOT_FULLY_PASS'
      };
  }

  if (
    row.oppositeOrbTeamPositiveDelta >
    row.sameOrbTeamPositiveDelta
    &&
    row.oppositeOrbTeamPositiveDelta >
    0
  ) {
    return {
      status:
        'AUTO_AWARD_PROBABLE',

      semanticOutcome:
        'AUTO_AWARD_SECURE',

      confidence:
        'MODERATE',

      winnerTeam:
        row.oppositeOrbTeam,

      basis:
        'OPPOSITE_ORB_TEAM_ECONOMY_DIRECTION_SUPPORTED_BUT_STRICT_MAGNITUDE_OR_TIMING_GATE_FAILED'
    };
  }

  return {
    status:
      'UNRESOLVED',

    semanticOutcome:
      null,

    confidence:
      'UNRESOLVED',

    basis:
      row.sameOrbTeamPositiveDelta >
      row.oppositeOrbTeamPositiveDelta
        ? 'SAME_ORB_TEAM_SIGNAL_DOMINATED_OR_CONTRADICTED_HYPOTHESIS'
        : 'NO_CLEAN_NET_WORTH_SIGNAL'
  };
}


// ============================================================
// URN BURSTS
// ============================================================

function buildUrnBursts(
  urnAnchors,
  window
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

        const orbTeam =
          orbTeams.length ===
          1
            ? orbTeams[0]
            : null;

        const opposite =
          oppositeTeam(
            orbTeam
          );

        const firstAnchorTick =
          rows[0]
            ?.anchorTick ??
          null;

        const lastAnchorTick =
          rows[
            rows.length -
            1
          ]
            ?.anchorTick ??
          null;

        const evidence =
          measureEvidence(
            firstAnchorTick -
              window.before,

            lastAnchorTick +
              window.after,

            lastAnchorTick
          );

        const netWorth =
          evidence.fields
            .m_iGoldNetWorth;

        const sameOrbTeamPositiveDelta =
          teamPositiveDelta(
            netWorth,
            orbTeam
          );

        const oppositeOrbTeamPositiveDelta =
          teamPositiveDelta(
            netWorth,
            opposite
          );

        const denyField =
          evidence.fields
            .m_iDenies;

        const totalDenyIncrement =
          denyField
            ?.totalPositiveDelta ??
          0;

        const sameTeamShotCount =
          rows.filter(
            row =>
              row.shotObserved
              &&
              row.firstHitTeam ===
              orbTeam
          ).length;

        const opposingTeamShotCount =
          rows.filter(
            row =>
              row.shotObserved
              &&
              row.firstHitTeam ===
              opposite
          ).length;

        const shotCount =
          rows.filter(
            row =>
              row.shotObserved
          ).length;

        const noShotCount =
          rows.length -
          shotCount;

        const allNoShot =
          noShotCount ===
          rows.length;

        const oppositeDominant =
          oppositeOrbTeamPositiveDelta >
          sameOrbTeamPositiveDelta;

        const strictAutoAwardSupport =
          allNoShot
          &&
          isGameTeam(
            orbTeam
          )
          &&
          oppositeOrbTeamPositiveDelta >
            0
          &&
          oppositeDominant
          &&
          totalDenyIncrement ===
            0;

        return {
          schemaVersion:
            2,

          canonical:
            false,

          sourceType:
            'URN_DELIVERY',

          sourceId,

          orbTeams,

          orbTeam,

          oppositeOrbTeam:
            opposite,

          orbCount:
            rows.length,

          shotCount,

          noShotCount,

          sameTeamShotCount,

          opposingTeamShotCount,

          firstAnchorTick,

          lastAnchorTick,

          firstClock:
            ticksToClock(
              firstAnchorTick
            ),

          lastClock:
            ticksToClock(
              lastAnchorTick
            ),

          sameOrbTeamPositiveDelta,

          oppositeOrbTeamPositiveDelta,

          direction:
            relationDirection(
              oppositeOrbTeamPositiveDelta,
              sameOrbTeamPositiveDelta
            ),

          totalDenyIncrement,

          lastHitIncrement:
            evidence.fields
              .m_iLastHits
              ?.totalPositiveDelta ??
            0,

          killIncrement:
            evidence.fields
              .m_iPlayerKills
              ?.totalPositiveDelta ??
            0,

          assistIncrement:
            evidence.fields
              .m_iPlayerAssists
              ?.totalPositiveDelta ??
            0,

          allNoShot,

          strictAutoAwardSupport,

          evidence
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
// URN BURST SUMMARY
// ============================================================

function summarizeUrnBurstEvidence(
  bursts
) {
  const oppositeSignal =
    bursts.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta >
        0
    );

  const directional =
    bursts.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta !==
        row.sameOrbTeamPositiveDelta
    );

  const oppositeDominant =
    directional.filter(
      row =>
        row.oppositeOrbTeamPositiveDelta >
        row.sameOrbTeamPositiveDelta
    );

  const withDeny =
    bursts.filter(
      row =>
        row.totalDenyIncrement >
        0
    );

  return {
    allNoShotBursts:
      bursts.length,

    oppositeTeamSignal:
      oppositeSignal.length,

    oppositeTeamSignalRate:
      rate(
        oppositeSignal.length,
        bursts.length
      ) ??
      0,

    directionalBursts:
      directional.length,

    oppositeTeamDominant:
      oppositeDominant.length,

    oppositeTeamDominanceRate:
      rate(
        oppositeDominant.length,
        directional.length
      ) ??
      0,

    burstsWithAnyDenyIncrement:
      withDeny.length,

    burstsWithAnyDenyIncrementRate:
      rate(
        withDeny.length,
        bursts.length
      ) ??
      0,

    strictAutoAwardSupport:
      bursts.filter(
        row =>
          row.strictAutoAwardSupport
      ).length,

    examples:
      bursts
        .slice(
          0,
          MAX_BURST_EXAMPLES
        )
        .map(
          compactUrnBurst
        )
  };
}


// ============================================================
// URN PER-ORB CLASSIFICATION
// ============================================================

function classifyUrnNoShot(
  row,
  burst,
  context
) {
  if (
    !context.controlFingerprintPass
  ) {
    return {
      status:
        'UNRESOLVED',

      semanticOutcome:
        null,

      confidence:
        'UNRESOLVED',

      basis:
        'SHOT_CONTROL_FINGERPRINT_FAILED'
    };
  }

  if (
    !burst
  ) {
    return {
      status:
        'UNRESOLVED',

      semanticOutcome:
        null,

      confidence:
        'UNRESOLVED',

      basis:
        'URN_BURST_NOT_FOUND'
    };
  }

  if (
    burst.allNoShot
    &&
    burst.strictAutoAwardSupport
  ) {
    return {
      status:
        'AUTO_AWARD_PROBABLE',

      semanticOutcome:
        'AUTO_AWARD_CLAIM',

      confidence:
        context
          .urnAutoAwardMechanicBurstPass
          ? 'STRONG_BURST_LEVEL_SINGLE_REPLAY'
          : 'MODERATE',

      winnerTeam:
        burst.oppositeOrbTeam,

      basis:
        context
          .urnAutoAwardMechanicBurstPass
          ? 'ALL_NO_SHOT_BURST_SUPPORTS_OPPOSITE_ORB_TEAM_AUTOMATIC_PAYOUT_BUT_PER_ORB_WINDOWS_OVERLAP'
          : 'INDIVIDUAL_ORB_IS_INSIDE_SUPPORTIVE_ALL_NO_SHOT_BURST_BUT_BURST_GATE_DID_NOT_FULLY_PASS'
    };
  }

  return {
    status:
      'ECONOMY_COLLISION',

    semanticOutcome:
      null,

    confidence:
      'UNRESOLVED',

    basis:
      'URN_PAYOUT_OBJECTS_OVERLAP_WITHIN_MULTI_ORB_BURST_PER_ORB_ECONOMY_NOT_INDEPENDENTLY_ATTRIBUTABLE'
  };
}


// ============================================================
// MEASURE RAW TELEMETRY INTERVAL
// ============================================================

function measureEvidence(
  minTick,
  maxTick,
  referenceTick
) {
  const fields =
    {};

  for (
    const fieldName
    of TARGET_FIELDS
  ) {
    const events =
      collectDeltaEvents(
        minTick,
        maxTick,
        fieldName
      );

    const positiveEvents =
      events.filter(
        row =>
          row.delta >
          0
      );

    fields[
      fieldName
    ] = {
      fieldName,

      totalDeltaEvents:
        events.length,

      totalPositiveEvents:
        positiveEvents.length,

      totalPositiveDelta:
        sum(
          positiveEvents.map(
            row =>
              row.delta
          )
        ),

      team2PositiveDelta:
        sum(
          positiveEvents
            .filter(
              row =>
                row.team ===
                2
            )
            .map(
              row =>
                row.delta
            )
        ),

      team3PositiveDelta:
        sum(
          positiveEvents
            .filter(
              row =>
                row.team ===
                3
            )
            .map(
              row =>
                row.delta
            )
        ),

      firstTeam2OffsetTicks:
        firstOffsetForTeam(
          positiveEvents,
          2,
          referenceTick
        ),

      firstTeam3OffsetTicks:
        firstOffsetForTeam(
          positiveEvents,
          3,
          referenceTick
        ),

      positivePlayers:
        [
          ...new Set(
            positiveEvents.map(
              row =>
                row.playerName
            )
          )
        ],

      positiveDeltaByPlayer:
        Object.fromEntries(
          [
            ...groupPositiveDeltaByPlayer(
              positiveEvents
            ).entries()
          ]
        ),

      positiveEvents:
        positiveEvents
          .slice(
            0,
            MAX_EVENT_EXAMPLES
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

  return {
    minTick,

    maxTick,

    referenceTick,

    fields
  };
}


// ============================================================
// FIELD ACCESSORS
// ============================================================

function teamPositiveDelta(
  field,
  team
) {
  if (
    team ===
    2
  ) {
    return field
      ?.team2PositiveDelta ??
      0;
  }

  if (
    team ===
    3
  ) {
    return field
      ?.team3PositiveDelta ??
      0;
  }

  return 0;
}


function firstTeamOffset(
  field,
  team
) {
  if (
    team ===
    2
  ) {
    return finite(
      field
        ?.firstTeam2OffsetTicks
    );
  }

  if (
    team ===
    3
  ) {
    return finite(
      field
        ?.firstTeam3OffsetTicks
    );
  }

  return null;
}


function playerPositiveDelta(
  field,
  playerName
) {
  if (
    !playerName
  ) {
    return 0;
  }

  return finite(
    field
      ?.positiveDeltaByPlayer
      ?.[playerName]
  ) ??
  0;
}


function groupPositiveDeltaByPlayer(
  events
) {
  const map =
    new Map();

  for (
    const row
    of events
  ) {
    const playerName =
      row.playerName ??
      'UNKNOWN';

    map.set(
      playerName,
      (
        map.get(
          playerName
        ) ??
        0
      ) +
      (
        Number.isFinite(
          row.delta
        )
          ? row.delta
          : 0
      )
    );
  }

  return map;
}


function firstOffsetForTeam(
  events,
  team,
  referenceTick
) {
  const first =
    events.find(
      row =>
        row.team ===
        team
    );

  return first
    ? first.tick -
      referenceTick
    : null;
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

  const result =
    [];

  for (
    let i =
      start;
    i <
      deltaEvents.length
      &&
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
// PLAYER IDENTITIES
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
// COMPACT OUTPUT
// ============================================================

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

    delta:
      row.delta,

    previousValue:
      row.previousValue,

    currentValue:
      row.currentValue,

    explicitlyChanged:
      row.explicitlyChanged
  };
}


function compactUrnBurst(
  row
) {
  return {
    sourceId:
      row.sourceId,

    orbTeam:
      row.orbTeam,

    oppositeOrbTeam:
      row.oppositeOrbTeam,

    orbCount:
      row.orbCount,

    shotCount:
      row.shotCount,

    noShotCount:
      row.noShotCount,

    firstClock:
      row.firstClock,

    lastClock:
      row.lastClock,

    sameOrbTeamPositiveDelta:
      row.sameOrbTeamPositiveDelta,

    oppositeOrbTeamPositiveDelta:
      row.oppositeOrbTeamPositiveDelta,

    direction:
      row.direction,

    totalDenyIncrement:
      row.totalDenyIncrement,

    lastHitIncrement:
      row.lastHitIncrement,

    killIncrement:
      row.killIncrement,

    assistIncrement:
      row.assistIncrement,

    strictAutoAwardSupport:
      row.strictAutoAwardSupport
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


function relationDirection(
  opposite,
  same
) {
  if (
    opposite >
    same
  ) {
    return 'OPPOSITE_ORB_TEAM_GREATER';
  }

  if (
    same >
    opposite
  ) {
    return 'SAME_ORB_TEAM_GREATER';
  }

  return 'TIE';
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


function sum(
  values
) {
  let total =
    0;

  for (
    const value
    of values
  ) {
    if (
      Number.isFinite(
        value
      )
    ) {
      total +=
        value;
    }
  }

  return total;
}


function quantile(
  values,
  q
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
    return null;
  }

  if (
    clean.length ===
    1
  ) {
    return clean[0];
  }

  const position =
    (
      clean.length -
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
    return clean[
      lower
    ];
  }

  const weight =
    position -
    lower;

  return clean[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    clean[
      upper
    ] *
    weight;
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

      p05:
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

      p95:
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

    p05:
      quantile(
        clean,
        0.05
      ),

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

    p95:
      quantile(
        clean,
        0.95
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


function countBy(
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

  return map;
}


function mapToSortedObject(
  map
) {
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

  const seconds =
    tick /
    TICK_RATE -
    30;

  const sign =
    seconds <
    0
      ? '-'
      : '';

  const absolute =
    Math.abs(
      seconds
    );

  const minutes =
    Math.floor(
      absolute /
      60
    );

  const remainder =
    Math.floor(
      absolute %
      60
    );

  return `${sign}${minutes}:${String(remainder).padStart(2, '0')}`;
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