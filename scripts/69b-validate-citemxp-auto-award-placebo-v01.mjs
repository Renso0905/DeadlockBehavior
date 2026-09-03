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

const PLACEBO_OFFSETS_TICKS = [
  -512,
  -256,
  -128,
  128,
  256,
  512
];

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
// PREDECLARED PLACEBO THRESHOLDS
//
// These are declared before observing the placebo result.
//
// Real no-shot Trooper resolution windows must show the
// directional + magnitude fingerprint substantially more often
// than matched nearby non-resolution windows.
// ============================================================

const PLACEBO_THRESHOLDS = {
  minimumActualCleanEvents:
    100,

  minimumEligiblePlaceboWindows:
    500,

  maximumPlaceboDirectionalFloorRate:
    0.30,

  minimumActualMinusPlaceboRateDifference:
    0.50,

  minimumActualVsPlaceboRiskRatio:
    3.00
};


// ============================================================
// URN THRESHOLDS
//
// Urn remains a burst-level mechanic because ten payout objects
// overlap tightly. A burst must be all-no-shot and free of:
//
// - Deny increments
// - LastHit increments
// - Player kills
// - Player assists
//
// before its net-worth direction can be used as evidence.
// ============================================================

const URN_THRESHOLDS = {
  minimumCleanAllNoShotBursts:
    2,

  minimumCleanSupportRate:
    1.00
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

const script62StreamPath =
  resolve(
    'output',
    replayName,
    'citemxp_corrected_shot_outcomes_v01.jsonl'
  );

const script69SummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_resolution_validation_v02.json'
  );

const script69UnitsPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_units_v02.jsonl'
  );

const script69UrnBurstsPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_urn_bursts_v02.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_placebo_validation_v01.json'
  );

const outputPlaceboPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_placebo_windows_v01.jsonl'
  );

const outputUrnPath =
  resolve(
    'output',
    replayName,
    'citemxp_auto_award_urn_reclassification_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    script62StreamPath,
    script69SummaryPath,
    script69UnitsPath,
    script69UrnBurstsPath
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
// LOAD SCRIPT 69 V02
// ============================================================

const script69Summary =
  JSON.parse(
    readFileSync(
      script69SummaryPath,
      'utf8'
    )
  );

const script69Units =
  await loadJsonl(
    script69UnitsPath
  );

const script69UrnBursts =
  await loadJsonl(
    script69UrnBurstsPath
  );

if (
  script69Summary
    ?.pipelineValidation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 69 v02 pipeline validation did not PASS.'
  );
}


// ============================================================
// INHERITED CALIBRATION
//
// We do NOT re-optimize the economy window or magnitude floor.
//
// Those were learned in Script 69 v02 from known-shot controls.
// Reusing them prevents us from tuning parameters to make the
// placebo test pass.
// ============================================================

const selectedWindow =
  script69Summary
    ?.shotControlFingerprint
    ?.selectedWindow;

const winnerDeltaFloor =
  finite(
    script69Summary
      ?.shotControlFingerprint
      ?.winnerDeltaFloor
      ?.value
  );

if (
  !selectedWindow
  ||
  !Number.isFinite(
    selectedWindow.before
  )
  ||
  !Number.isFinite(
    selectedWindow.after
  )
  ||
  winnerDeltaFloor ===
    null
) {
  throw new Error(
    'Could not recover Script 69 v02 window/floor calibration.'
  );
}


// ============================================================
// SCRIPT 69 V02 COHORTS
// ============================================================

const cleanTrooperRows =
  script69Units.filter(
    row =>
      row?.sourceType ===
        'TROOPER_DEATH'
      &&
      row?.strictClean ===
        true
  );

const urnNoShotRows =
  script69Units.filter(
    row =>
      row?.sourceType ===
      'URN_DELIVERY'
  );

console.log('');
console.log(
  `Script 69 v02 selected window: ${selectedWindow.id}`
);

console.log(
  `Script 69 v02 winner floor: ${winnerDeltaFloor}`
);

console.log(
  `Clean Trooper no-shot events: ${cleanTrooperRows.length}`
);

console.log(
  `Urn no-shot units: ${urnNoShotRows.length}`
);


// ============================================================
// LOAD ALL CITEMXP RESOLUTION ANCHORS
//
// Placebo windows are invalid if another actual CItemXP
// resolution occurs near them.
//
// We reconstruct all 1,239 target anchors from Script 62 so the
// negative controls exclude both shot and untouched orbs.
// ============================================================

const script62Rows =
  await loadJsonl(
    script62StreamPath
  );

const allAnchorTicks =
  script62Rows
    .map(
      buildResolutionAnchorTick
    )
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

console.log(
  `All CItemXP anchors available for placebo exclusion: ${allAnchorTicks.length}`
);


// ============================================================
// PLAYER IDENTITIES
// ============================================================

const playerIdentity =
  await loadPlayerIdentity(
    playerStatePath
  );

const playerByControllerIndex =
  playerIdentity
    .playerByControllerIndex;

console.log(
  `Players/controllers: ${playerByControllerIndex.size}`
);


// ============================================================
// RAW CONTROLLER RESCAN
//
// Like Script 69 v02, this independently rescans controller
// fields from the replay instead of reading previously measured
// economy windows.
// ============================================================

const previousValue =
  new Map();

const deltaEvents =
  [];

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

      if (
        entityIndex ===
        null
      ) {
        continue;
      }

      const player =
        playerByControllerIndex.get(
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


console.log('');
console.log(
  'Rescanning replay for matched-placebo controller telemetry...'
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

const minTelemetryTick =
  fieldTelemetry
    .get(
      'm_iGoldNetWorth'
    )
    ?.firstObservedTick ??
  0;

const maxTelemetryTick =
  fieldTelemetry
    .get(
      'm_iGoldNetWorth'
    )
    ?.lastObservedTick ??
  Infinity;

console.log(
  `Controller entity events: ${controllerEntityEvents}`
);

console.log(
  `Tracked field deltas: ${deltaEvents.length}`
);


// ============================================================
// MATCHED PLACEBO WINDOWS
//
// Every CLEAN actual Trooper no-shot event receives six nearby
// negative-control windows:
//
// -8 seconds
// -4 seconds
// -2 seconds
// +2 seconds
// +4 seconds
// +8 seconds
//
// A placebo is excluded if:
//
// 1. another CItemXP resolution occurs within 8 ticks, or
// 2. Deny/LastHit/Kill/Assist counters increment.
//
// We then apply the same >= winnerDeltaFloor directional test
// that the real no-shot event must satisfy.
// ============================================================

const placeboRows =
  [];

for (
  const source
  of cleanTrooperRows
) {
  for (
    const offsetTicks
    of PLACEBO_OFFSETS_TICKS
  ) {
    const placeboTick =
      source.anchorTick +
      offsetTicks;

    const minTick =
      placeboTick -
      selectedWindow.before;

    const maxTick =
      placeboTick +
      selectedWindow.after;

    if (
      minTick <
      minTelemetryTick
      ||
      maxTick >
      maxTelemetryTick
    ) {
      placeboRows.push({
        schemaVersion:
          1,

        canonical:
          false,

        episodeId:
          source.episodeId,

        sourceId:
          source.sourceId,

        orbTeam:
          source.orbTeam,

        oppositeOrbTeam:
          source.oppositeOrbTeam,

        actualAnchorTick:
          source.anchorTick,

        offsetTicks,

        placeboTick,

        eligible:
          false,

        exclusionReason:
          'OUTSIDE_CONTROLLER_TELEMETRY_RANGE'
      });

      continue;
    }

    const nearestAnchorTicks =
      nearestTickDistance(
        allAnchorTicks,
        placeboTick
      );

    const collisionWithin8Ticks =
      nearestAnchorTicks <=
      COLLISION_RADIUS_TICKS;

    const evidence =
      measureEvidence(
        minTick,
        maxTick,
        placeboTick
      );

    const netWorth =
      evidence
        .fields
        .m_iGoldNetWorth;

    const sameOrbTeamPositiveDelta =
      teamPositiveDelta(
        netWorth,
        source.orbTeam
      );

    const oppositeOrbTeamPositiveDelta =
      teamPositiveDelta(
        netWorth,
        source.oppositeOrbTeam
      );

    const counterConfounds =
      {};

    let totalCounterConfoundDelta =
      0;

    for (
      const fieldName
      of CONFOUND_FIELDS
    ) {
      const delta =
        evidence
          .fields[
            fieldName
          ]
          ?.totalPositiveDelta ??
        0;

      counterConfounds[
        fieldName
      ] =
        delta;

      totalCounterConfoundDelta +=
        delta;
    }

    const eligible =
      !collisionWithin8Ticks
      &&
      totalCounterConfoundDelta ===
        0;

    const directionalFloorSupport =
      eligible
      &&
      oppositeOrbTeamPositiveDelta >=
        winnerDeltaFloor
      &&
      oppositeOrbTeamPositiveDelta >
        sameOrbTeamPositiveDelta;

    const reverseDirectionalFloorSupport =
      eligible
      &&
      sameOrbTeamPositiveDelta >=
        winnerDeltaFloor
      &&
      sameOrbTeamPositiveDelta >
        oppositeOrbTeamPositiveDelta;

    placeboRows.push({
      schemaVersion:
        1,

      canonical:
        false,

      episodeId:
        source.episodeId,

      sourceId:
        source.sourceId,

      orbTeam:
        source.orbTeam,

      oppositeOrbTeam:
        source.oppositeOrbTeam,

      actualAnchorTick:
        source.anchorTick,

      actualAnchorClock:
        source.anchorClock,

      offsetTicks,

      offsetSeconds:
        offsetTicks /
        TICK_RATE,

      placeboTick,

      placeboClock:
        ticksToClock(
          placeboTick
        ),

      nearestAnchorTicks:
        finiteOrNull(
          nearestAnchorTicks
        ),

      collisionWithin8Ticks,

      counterConfounds,

      totalCounterConfoundDelta,

      eligible,

      exclusionReason:
        eligible
          ? null
          : collisionWithin8Ticks
            ? 'NEAR_REAL_CITEMXP_ANCHOR'
            : 'COUNTER_DEFINED_ECONOMY_CONFOUND',

      sameOrbTeamPositiveDelta,

      oppositeOrbTeamPositiveDelta,

      winnerDeltaFloor,

      directionalFloorSupport,

      reverseDirectionalFloorSupport,

      evidence
    });
  }
}


// ============================================================
// PLACEBO SUMMARY
// ============================================================

const placeboValidation =
  summarizePlacebo(
    cleanTrooperRows,
    placeboRows,
    winnerDeltaFloor
  );

const placeboChecks = {
  actualCleanEvents:
    check(
      placeboValidation.actualCleanEvents,
      `>=${PLACEBO_THRESHOLDS.minimumActualCleanEvents}`,
      placeboValidation.actualCleanEvents >=
        PLACEBO_THRESHOLDS.minimumActualCleanEvents
    ),

  eligiblePlaceboWindows:
    check(
      placeboValidation.placeboEligibleWindows,
      `>=${PLACEBO_THRESHOLDS.minimumEligiblePlaceboWindows}`,
      placeboValidation.placeboEligibleWindows >=
        PLACEBO_THRESHOLDS.minimumEligiblePlaceboWindows
    ),

  placeboDirectionalFloorRate:
    check(
      placeboValidation.placeboDirectionalFloorSupportRate,
      `<=${PLACEBO_THRESHOLDS.maximumPlaceboDirectionalFloorRate}`,
      placeboValidation.placeboDirectionalFloorSupportRate <=
        PLACEBO_THRESHOLDS.maximumPlaceboDirectionalFloorRate
    ),

  actualMinusPlaceboRateDifference:
    check(
      placeboValidation.actualMinusPlaceboRateDifference,
      `>=${PLACEBO_THRESHOLDS.minimumActualMinusPlaceboRateDifference}`,
      placeboValidation.actualMinusPlaceboRateDifference >=
        PLACEBO_THRESHOLDS.minimumActualMinusPlaceboRateDifference
    ),

  actualVsPlaceboRiskRatio:
    check(
      placeboValidation.actualVsPlaceboRiskRatioForCheck,
      `>=${PLACEBO_THRESHOLDS.minimumActualVsPlaceboRiskRatio}`,
      placeboValidation.actualVsPlaceboRiskRatioForCheck >=
        PLACEBO_THRESHOLDS.minimumActualVsPlaceboRiskRatio
    )
};

const placeboPass =
  Object
    .values(
      placeboChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// URN CLEANLINESS CORRECTION
//
// Script 69 v02 only required:
//   all no-shot
//   + no Deny
//   + opposite-team dominance
//
// That allowed a burst containing unrelated LastHit activity to
// count as "strict" support.
//
// This layer corrects that.
//
// A clean all-no-shot Urn burst now requires ZERO:
//
// - Deny
// - LastHit
// - Kill
// - Assist
// ============================================================

const urnBurstReclassification =
  script69UrnBursts.map(
    row => {
      const allNoShot =
        row?.allNoShot ===
        true;

      const deny =
        finite(
          row
            ?.totalDenyIncrement
        ) ??
        0;

      const lastHit =
        finite(
          row
            ?.lastHitIncrement
        ) ??
        0;

      const kill =
        finite(
          row
            ?.killIncrement
        ) ??
        0;

      const assist =
        finite(
          row
            ?.assistIncrement
        ) ??
        0;

      const otherConfoundIncrement =
        lastHit +
        kill +
        assist;

      const cleanForAutoAwardTest =
        allNoShot
        &&
        deny ===
          0
        &&
        otherConfoundIncrement ===
          0;

      const oppositeDelta =
        finite(
          row
            ?.oppositeOrbTeamPositiveDelta
        ) ??
        0;

      const sameDelta =
        finite(
          row
            ?.sameOrbTeamPositiveDelta
        ) ??
        0;

      const strictAutoAwardSupport =
        cleanForAutoAwardTest
        &&
        oppositeDelta >
          0
        &&
        oppositeDelta >
          sameDelta;

      return {
        ...row,

        schemaVersion:
          1,

        originalScript69V02StrictAutoAwardSupport:
          row?.strictAutoAwardSupport ===
          true,

        otherConfoundIncrement,

        cleanForAutoAwardTest,

        strictAutoAwardSupport,

        reclassificationReason:
          !allNoShot
            ? 'NOT_ALL_NO_SHOT'
            : deny >
                0
              ? 'DENY_COUNTER_CONFOUND'
              : otherConfoundIncrement >
                  0
                ? 'LASTHIT_KILL_OR_ASSIST_CONFOUND'
                : strictAutoAwardSupport
                  ? 'CLEAN_ALL_NO_SHOT_OPPOSITE_TEAM_DOMINANT'
                  : 'CLEAN_BUT_DIRECTION_NOT_SUPPORTIVE'
      };
    }
  );


// ============================================================
// URN BURST VALIDATION
// ============================================================

const allNoShotUrnBursts =
  urnBurstReclassification.filter(
    row =>
      row.allNoShot
  );

const cleanAllNoShotUrnBursts =
  allNoShotUrnBursts.filter(
    row =>
      row.cleanForAutoAwardTest
  );

const cleanSupportiveUrnBursts =
  cleanAllNoShotUrnBursts.filter(
    row =>
      row.strictAutoAwardSupport
  );

const urnSupportRate =
  rate(
    cleanSupportiveUrnBursts.length,
    cleanAllNoShotUrnBursts.length
  ) ??
  0;

const urnChecks = {
  cleanAllNoShotBursts:
    check(
      cleanAllNoShotUrnBursts.length,
      `>=${URN_THRESHOLDS.minimumCleanAllNoShotBursts}`,
      cleanAllNoShotUrnBursts.length >=
        URN_THRESHOLDS.minimumCleanAllNoShotBursts
    ),

  cleanSupportRate:
    check(
      urnSupportRate,
      `>=${URN_THRESHOLDS.minimumCleanSupportRate}`,
      urnSupportRate >=
        URN_THRESHOLDS.minimumCleanSupportRate
    )
};

const urnMechanicPass =
  Object
    .values(
      urnChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// URN UNIT RECLASSIFICATION
//
// We expect the previous 20 PROBABLE rows to shrink if one of
// their supporting bursts contained a LastHit/Kill/Assist
// confound.
//
// No individual Urn orb is promoted to VALIDATED.
// ============================================================

const urnBurstBySourceId =
  new Map(
    urnBurstReclassification.map(
      row => [
        String(
          row.sourceId
        ),
        row
      ]
    )
  );

const urnUnitReclassification =
  urnNoShotRows.map(
    row => {
      const burst =
        urnBurstBySourceId.get(
          String(
            row.sourceId
          )
        ) ??
        null;

      const resolution =
        burst
          ?.strictAutoAwardSupport
          ? {
            status:
              'AUTO_AWARD_PROBABLE',

            semanticOutcome:
              'AUTO_AWARD_CLAIM',

            confidence:
              'MODERATE_BURST_LEVEL_SINGLE_REPLAY',

            winnerTeam:
              burst.oppositeOrbTeam,

            basis:
              'CLEAN_ALL_NO_SHOT_BURST_SUPPORTS_OPPOSITE_ORB_TEAM_PAYOUT'
          }
          : {
            status:
              'ECONOMY_COLLISION',

            semanticOutcome:
              null,

            confidence:
              'UNRESOLVED',

            basis:
              burst
                ? burst.reclassificationReason
                : 'URN_BURST_NOT_FOUND'
          };

      return {
        episodeId:
          row.episodeId,

        sourceId:
          row.sourceId,

        orbTeam:
          row.orbTeam,

        oldScript69V02Status:
          row
            ?.resolution
            ?.status ??
          null,

        reclassifiedResolution:
          resolution
      };
    }
  );


// ============================================================
// STRUCTURAL VALIDATION
// ============================================================

const pipelineChecks = {
  script69V02PipelinePassed:
    check(
      script69Summary
        ?.pipelineValidation
        ?.pass,
      true,
      script69Summary
        ?.pipelineValidation
        ?.pass ===
        true
    ),

  script69V02TrooperMechanicPassed:
    check(
      script69Summary
        ?.trooperNoShotValidation
        ?.pass,
      true,
      script69Summary
        ?.trooperNoShotValidation
        ?.pass ===
        true
    ),

  cleanTrooperRowsAvailable:
    check(
      cleanTrooperRows.length,
      '>0',
      cleanTrooperRows.length >
        0
    ),

  allAnchorTicksAvailable:
    check(
      allAnchorTicks.length,
      '>=1239 expected for this replay',
      allAnchorTicks.length >=
        1239
    ),

  controllerTelemetryObserved:
    check(
      deltaEvents.length,
      '>0',
      deltaEvents.length >
        0
    ),

  urnBurstsPreserved:
    check(
      urnBurstReclassification.length,
      script69UrnBursts.length,
      urnBurstReclassification.length ===
        script69UrnBursts.length
    ),

  urnUnitsPreserved:
    check(
      urnUnitReclassification.length,
      urnNoShotRows.length,
      urnUnitReclassification.length ===
        urnNoShotRows.length
    )
};

const pipelinePass =
  Object
    .values(
      pipelineChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// FINAL MECHANIC STATUS
// ============================================================

const trooperNegativeControlSupported =
  pipelinePass
  &&
  script69Summary
    ?.trooperNoShotValidation
    ?.pass ===
    true
  &&
  placeboPass;

const urnUnitStatusCounts =
  countByObject(
    urnUnitReclassification,
    row =>
      row
        .reclassifiedResolution
        .status
  );


// ============================================================
// SUMMARY
// ============================================================

const summary = {
  replay:
    replayName,

  version:
    'CITEMXP_AUTO_AWARD_PLACEBO_VALIDATION_V01',

  canonical:
    false,

  status:
    !pipelinePass
      ? 'DIAGNOSTIC_PIPELINE_FAILURE'
      : trooperNegativeControlSupported
        &&
        !urnMechanicPass
        ? 'TROOPER_AUTO_AWARD_NEGATIVE_CONTROL_SUPPORTED_URN_UNVALIDATED'
        : trooperNegativeControlSupported
          &&
          urnMechanicPass
          ? 'TROOPER_AND_URN_AUTO_AWARD_SUPPORTED_WITH_SCOPE_LIMITS'
          : 'AUTO_AWARD_NEGATIVE_CONTROL_NOT_YET_SUPPORTED',

  purpose: [
    'Challenge Script 69 v02 Trooper automatic-award evidence with matched nearby negative-control windows.',
    'Exclude placebo windows that overlap another CItemXP resolution or a LastHit/Deny/Kill/Assist counter event.',
    'Correct Script 69 v02 Urn burst cleanliness so LastHit, Deny, Kill, and Assist activity all prevent a burst from being treated as clean.',
    'Preserve Script 69 v02 as historical evidence rather than silently overwriting it.'
  ],

  inputs: {
    replay:
      replayPath,

    playerState:
      playerStatePath,

    script62CorrectedOutcomes:
      script62StreamPath,

    script69V02Summary:
      script69SummaryPath,

    script69V02Units:
      script69UnitsPath,

    script69V02UrnBursts:
      script69UrnBurstsPath
  },

  inheritedCalibration: {
    selectedWindow,

    winnerDeltaFloor
  },

  trooperPlaceboValidation: {
    offsetsTicks:
      PLACEBO_OFFSETS_TICKS,

    offsetsSeconds:
      PLACEBO_OFFSETS_TICKS.map(
        value =>
          value /
          TICK_RATE
      ),

    thresholds:
      PLACEBO_THRESHOLDS,

    evidence:
      placeboValidation,

    checks:
      placeboChecks,

    pass:
      placeboPass,

    mechanicConclusion:
      trooperNegativeControlSupported
        ? 'Script 69 v02 Trooper automatic-award result survives matched nearby negative-control testing in this replay.'
        : 'The Trooper automatic-award result did not pass the matched negative-control gate; keep the mechanic provisional.'
  },

  urnCorrection: {
    thresholds:
      URN_THRESHOLDS,

    allNoShotBursts:
      allNoShotUrnBursts.length,

    cleanAllNoShotBursts:
      cleanAllNoShotUrnBursts.length,

    confoundedAllNoShotBursts:
      allNoShotUrnBursts.length -
      cleanAllNoShotUrnBursts.length,

    cleanSupportiveBursts:
      cleanSupportiveUrnBursts.length,

    cleanSupportRate:
      urnSupportRate,

    checks:
      urnChecks,

    pass:
      urnMechanicPass,

    unitStatusCounts:
      urnUnitStatusCounts,

    note:
      urnMechanicPass
        ? 'Urn is supported only at burst level; individual orbs remain non-independent.'
        : 'Urn automatic payout remains unvalidated. Only no-shot units inside a clean supportive burst are retained as PROBABLE.'
  },

  controllerTelemetry: {
    players:
      playerIdentity.players,

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

  pipelineValidation: {
    pass:
      pipelinePass,

    checks:
      pipelineChecks
  },

  interpretation: {
    trooper:
      trooperNegativeControlSupported
        ? 'The Trooper no-shot automatic-award mechanic has now survived direct shot calibration, a held-out control test, a large clean no-shot cohort test, and matched nearby placebo windows within this replay.'
        : 'Do not strengthen the Trooper mechanic beyond Script 69 v02 until the placebo failure mode is understood.',

    urn:
      urnMechanicPass
        ? 'Urn burst-level automatic payout received sufficient clean replication in this replay.'
        : 'Urn remains unresolved at mechanic level because there are too few clean all-no-shot bursts after correcting the confound gate.',

    scope:
      'All conclusions remain single-replay observational validation and require cross-replay replication before canonicalization.'
  },

  outputs: {
    summary:
      outputSummaryPath,

    placeboWindows:
      outputPlaceboPath,

    urnReclassification:
      outputUrnPath
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
  outputPlaceboPath,
  placeboRows
);

await writeJsonl(
  outputUrnPath,
  urnUnitReclassification
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);

console.log(
  'CITEMXP AUTO-AWARD PLACEBO VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'TROOPER MATCHED NEGATIVE CONTROL'
);

console.log(
  '--------------------------------'
);

console.log(
  `Actual directional+floor: ` +
  `${placeboValidation.actualDirectionalFloorSupport}/` +
  `${placeboValidation.actualCleanEvents} ` +
  `(${formatPercent(placeboValidation.actualDirectionalFloorSupportRate)})`
);

console.log(
  `Eligible placebo windows: ` +
  `${placeboValidation.placeboEligibleWindows}/` +
  `${placeboValidation.placeboWindowsGenerated}`
);

console.log(
  `Placebo directional+floor: ` +
  `${placeboValidation.placeboDirectionalFloorSupport}/` +
  `${placeboValidation.placeboEligibleWindows} ` +
  `(${formatPercent(placeboValidation.placeboDirectionalFloorSupportRate)})`
);

console.log(
  `Reverse placebo directional+floor: ` +
  `${placeboValidation.placeboReverseDirectionalFloorSupport}/` +
  `${placeboValidation.placeboEligibleWindows} ` +
  `(${formatPercent(placeboValidation.placeboReverseDirectionalFloorSupportRate)})`
);

console.log(
  `Actual - placebo difference: ` +
  `${formatPercent(placeboValidation.actualMinusPlaceboRateDifference)}`
);

console.log(
  `Actual / placebo risk ratio: ` +
  `${formatNumber(placeboValidation.actualVsPlaceboRiskRatio)}`
);

console.log(
  `PLACEBO GATE: ${placeboPass ? 'PASS' : 'FAIL'}`
);

console.log(
  `TROOPER MECHANIC: ` +
  `${trooperNegativeControlSupported ? 'NEGATIVE-CONTROL SUPPORTED' : 'NOT YET SUPPORTED'}`
);

console.log('');

console.log(
  'URN CLEANLINESS CORRECTION'
);

console.log(
  '--------------------------'
);

console.log(
  `All-no-shot bursts: ${allNoShotUrnBursts.length}`
);

console.log(
  `Clean all-no-shot bursts: ${cleanAllNoShotUrnBursts.length}`
);

console.log(
  `Confounded all-no-shot bursts: ` +
  `${allNoShotUrnBursts.length - cleanAllNoShotUrnBursts.length}`
);

console.log(
  `Clean supportive bursts: ${cleanSupportiveUrnBursts.length}`
);

console.log(
  `Clean support rate: ${formatPercent(urnSupportRate)}`
);

console.log(
  `URN MECHANIC: ` +
  `${urnMechanicPass ? 'SUPPORTED AT BURST LEVEL' : 'NOT VALIDATED'}`
);

console.log(
  'Urn no-shot unit statuses:'
);

for (
  const [
    status,
    count
  ]
  of Object.entries(
    urnUnitStatusCounts
  )
) {
  console.log(
    `  ${status.padEnd(24)} ${count}`
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
    `${row.pass ? 'PASS' : 'FAIL'}  ` +
    `${name.padEnd(34)} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');

console.log(
  `OVERALL PIPELINE: ${pipelinePass ? 'PASS' : 'FAIL'}`
);

console.log('');

console.log(
  `Summary:\n${outputSummaryPath}`
);

console.log('');

console.log(
  `Placebo windows:\n${outputPlaceboPath}`
);

console.log('');

console.log(
  `Urn reclassification:\n${outputUrnPath}`
);

console.log('');


// ============================================================
// PLACEBO SUMMARY
// ============================================================

function summarizePlacebo(
  actualRows,
  placeboRows,
  floor
) {
  const actualDirectional =
    actualRows.filter(
      row =>
        (
          finite(
            row
              ?.oppositeOrbTeamPositiveDelta
          ) ??
          0
        ) >=
          floor
        &&
        (
          finite(
            row
              ?.oppositeOrbTeamPositiveDelta
          ) ??
          0
        ) >
        (
          finite(
            row
              ?.sameOrbTeamPositiveDelta
          ) ??
          0
        )
    );

  const actualReverse =
    actualRows.filter(
      row =>
        (
          finite(
            row
              ?.sameOrbTeamPositiveDelta
          ) ??
          0
        ) >=
          floor
        &&
        (
          finite(
            row
              ?.sameOrbTeamPositiveDelta
          ) ??
          0
        ) >
        (
          finite(
            row
              ?.oppositeOrbTeamPositiveDelta
          ) ??
          0
        )
    );

  const eligible =
    placeboRows.filter(
      row =>
        row.eligible
    );

  const support =
    eligible.filter(
      row =>
        row.directionalFloorSupport
    );

  const reverse =
    eligible.filter(
      row =>
        row.reverseDirectionalFloorSupport
    );

  const actualRate =
    rate(
      actualDirectional.length,
      actualRows.length
    ) ??
    0;

  const placeboRate =
    rate(
      support.length,
      eligible.length
    ) ??
    0;

  const riskRatio =
    placeboRate >
      0
      ? actualRate /
        placeboRate
      : actualRate >
          0
        ? Infinity
        : 0;

  const byOffset =
    {};

  for (
    const offsetTicks
    of PLACEBO_OFFSETS_TICKS
  ) {
    const rows =
      placeboRows.filter(
        row =>
          row.offsetTicks ===
          offsetTicks
      );

    const clean =
      rows.filter(
        row =>
          row.eligible
      );

    const yes =
      clean.filter(
        row =>
          row.directionalFloorSupport
      );

    const no =
      clean.filter(
        row =>
          row.reverseDirectionalFloorSupport
      );

    byOffset[
      String(
        offsetTicks
      )
    ] = {
      offsetTicks,

      offsetSeconds:
        offsetTicks /
        TICK_RATE,

      generated:
        rows.length,

      eligible:
        clean.length,

      directionalFloorSupport:
        yes.length,

      directionalFloorSupportRate:
        rate(
          yes.length,
          clean.length
        ),

      reverseDirectionalFloorSupport:
        no.length,

      reverseDirectionalFloorSupportRate:
        rate(
          no.length,
          clean.length
        )
    };
  }

  return {
    winnerDeltaFloor:
      floor,

    actualCleanEvents:
      actualRows.length,

    actualDirectionalFloorSupport:
      actualDirectional.length,

    actualDirectionalFloorSupportRate:
      actualRate,

    actualReverseDirectionalFloorSupport:
      actualReverse.length,

    actualReverseDirectionalFloorSupportRate:
      rate(
        actualReverse.length,
        actualRows.length
      ),

    placeboWindowsGenerated:
      placeboRows.length,

    placeboEligibleWindows:
      eligible.length,

    placeboExcludedNearCItemXP:
      placeboRows.filter(
        row =>
          row.exclusionReason ===
          'NEAR_REAL_CITEMXP_ANCHOR'
      ).length,

    placeboExcludedCounterConfound:
      placeboRows.filter(
        row =>
          row.exclusionReason ===
          'COUNTER_DEFINED_ECONOMY_CONFOUND'
      ).length,

    placeboExcludedOutsideTelemetry:
      placeboRows.filter(
        row =>
          row.exclusionReason ===
          'OUTSIDE_CONTROLLER_TELEMETRY_RANGE'
      ).length,

    placeboDirectionalFloorSupport:
      support.length,

    placeboDirectionalFloorSupportRate:
      placeboRate,

    placeboReverseDirectionalFloorSupport:
      reverse.length,

    placeboReverseDirectionalFloorSupportRate:
      rate(
        reverse.length,
        eligible.length
      ),

    actualMinusPlaceboRateDifference:
      actualRate -
      placeboRate,

    actualVsPlaceboRiskRatio:
      Number.isFinite(
        riskRatio
      )
        ? riskRatio
        : null,

    actualVsPlaceboRiskRatioForCheck:
      riskRatio,

    placeboRateZero:
      placeboRate ===
      0,

    byOffset
  };
}


// ============================================================
// SCRIPT 62 RESOLUTION ANCHOR
// ============================================================

function buildResolutionAnchorTick(
  row
) {
  const episode =
    row?.episode;

  if (
    !episode
  ) {
    return null;
  }

  const attackableEndTick =
    finite(
      episode?.attackableEndTick
    );

  if (
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

  const ends =
    lifecycleEvents.filter(
      event =>
        [
          'LEAVE',
          'DELETE'
        ].includes(
          event.operation
        )
    );

  if (
    firstHit
  ) {
    return ends.find(
      event =>
        event.tick >=
        firstHit.tick
    )
      ?.tick ??
      firstHit.tick;
  }

  return ends.find(
    event =>
      event.tick >=
      attackableEndTick
  )
    ?.tick ??
    attackableEndTick;
}


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
    tick
  };
}


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
// TELEMETRY MEASUREMENT
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

    const positives =
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
        positives.length,

      totalPositiveDelta:
        sum(
          positives.map(
            row =>
              row.delta
          )
        ),

      team2PositiveDelta:
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
        ),

      team3PositiveDelta:
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
        ),

      positiveDeltaByPlayer:
        Object.fromEntries(
          groupPositiveDeltaByPlayer(
            positives
          )
        ),

      positiveEvents:
        positives
          .slice(
            0,
            30
          )
          .map(
            row => ({
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

              explicitlyChanged:
                row.explicitlyChanged
            })
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
// DELTA EVENT SEARCH
// ============================================================

function collectDeltaEvents(
  minTick,
  maxTick,
  fieldName
) {
  const start =
    lowerBoundDelta(
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


function lowerBoundDelta(
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
// NEAREST REAL CITEMXP ANCHOR
// ============================================================

function nearestTickDistance(
  sortedTicks,
  tick
) {
  let low =
    0;

  let high =
    sortedTicks.length;

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
      sortedTicks[mid] <
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

  const before =
    low >
    0
      ? Math.abs(
        tick -
        sortedTicks[
          low -
          1
        ]
      )
      : Infinity;

  const after =
    low <
    sortedTicks.length
      ? Math.abs(
        sortedTicks[
          low
        ] -
        tick
      )
      : Infinity;

  return Math.min(
    before,
    after
  );
}


// ============================================================
// TEAM ECONOMY
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


function groupPositiveDeltaByPlayer(
  events
) {
  const map =
    new Map();

  for (
    const row
    of events
  ) {
    const name =
      row.playerName ??
      'UNKNOWN';

    map.set(
      name,
      (
        map.get(
          name
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


// ============================================================
// PLAYER IDENTITY
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
    return typeof event
      ?.getChanges ===
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
    return typeof entity
      ?.getField ===
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
    return typeof entity
      ?.getIndex ===
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
      row
        .playersWithFiniteValue
        .size,

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

      writer.end(
        resolvePromise
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
    !clean.length
  ) {
    return {
      count:
        0,

      min:
        null,

      p05:
        null,

      p25:
        null,

      median:
        null,

      p75:
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


function quantile(
  values,
  q
) {
  if (
    !values.length
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
  if (
    value ===
    Infinity
  ) {
    return 'Infinity';
  }

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