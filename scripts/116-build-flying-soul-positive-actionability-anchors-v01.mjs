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


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_V01';


// ============================================================
// PURPOSE
//
// Script115 gave us complete successful-hit telemetry plus a
// tick-dense moving CItemXP trajectory for every source-linked
// Trooper flying soul.
//
// Script116 builds POSITIVE ACTIONABILITY ANCHORS.
//
// A positive anchor means:
//
//   an identified player actually produced Damage against an
//   identified flying soul at a known replay tick.
//
// Therefore the event is useful for calibrating what observed
// successful interaction geometry looks like.
//
// For each unique:
//
//   eventId + attacker + hit tick + role
//
// we reconstruct:
//
//   - exact / nearest orb position
//   - attacker position from the 4 Hz player-state substrate
//   - attacker validated eye orientation
//   - player -> orb XY / 3D distance
//   - required yaw / pitch to the orb
//   - eye yaw / pitch error
//   - full 3D eye angular error
//   - secure versus deny role
//   - hero ID
//   - timing relative to the attackable interval
//
// IMPORTANT:
//
// Player state is only sampled every 16 ticks (0.25 sec).
// We therefore use explicitly labeled interpolation/proxy rules.
//
// These positive anchors do NOT establish:
//
//   - maximum weapon range
//   - line of sight for non-hit players
//   - opportunity thresholds
//   - causal reaction time
//   - trigger-pull time
//   - projectile travel time
//   - whether a non-response was avoidable
//
// Observed successful-hit envelopes are descriptive calibration
// anchors, not normative cutoffs.
//
// No raw .dem parsing.
// ============================================================


// ============================================================
// GLOBAL CONSTANTS
// ============================================================

const TICK_RATE =
  64;


const PLAYER_STATE_SAMPLE_TICKS =
  16;


// Retain compact player states near each successful-hit tick.
//
// This is large enough to capture both normal 4 Hz bracket
// samples without keeping the complete large player-state stream
// in memory.
const STATE_CAPTURE_RADIUS_TICKS =
  20;


// Only interpolate across an ordinary adjacent 4 Hz interval.
//
// Do not bridge missing 0.25-second samples.
const MAX_INTERPOLATION_GAP_TICKS =
  PLAYER_STATE_SAMPLE_TICKS;


// If interpolation is unavailable, permit a one-sided state
// proxy only when it is at most half the normal sample period
// from the hit.
const MAX_NEAREST_STATE_OFFSET_TICKS =
  8;


// Script115 trajectory is normally tick-dense.
//
// Keep a very small fallback tolerance for rare trajectory gaps.
const MAX_NEAREST_ORB_OFFSET_TICKS =
  2;


// ------------------------------------------------------------
// VALIDATED AIM CONVENTION
//
// Scripts97 V02 / 98 / 104:
//
//   eye component 0 = pitch
//   eye component 1 = yaw
//
// World yaw:
//
//   0   -> +X
//   90  -> +Y
//
// Stored eye pitch converts to Cartesian direction with sign -1.
// ------------------------------------------------------------

const EYE_PITCH_INDEX =
  0;


const EYE_YAW_INDEX =
  1;


// ============================================================
// VALIDATION THRESHOLDS
//
// Pipeline-readiness only.
//
// NONE of these values define gameplay opportunity thresholds.
// ============================================================

const VALIDATION =
  {

    minimumOrbPositionCoverage:
      0.99,

    minimumPlayerPositionCoverage:
      0.95,

    minimumEyeAngleCoverage:
      0.90,

    minimumRoleResolutionRate:
      0.99
  };


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT115_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_trajectory_and_full_hits_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_positive_actionability_anchors_batch_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_positive_actionability_anchors_batch_v01.md'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT115_PATH
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


const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


const script115 =
  JSON.parse(
    readFileSync(
      SCRIPT115_PATH,
      'utf8'
    )
  );


if (
  script115?.status !==
  'FLYING_SOUL_TRAJECTORY_AND_FULL_HIT_SUBSTRATE_READY'
) {

  throw new Error(
    `Script115 substrate is not ready.\nStatus: ${script115?.status}`
  );
}


const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No independent replication cohort.'
  );
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'FLYING-SOUL POSITIVE ACTIONABILITY ANCHORS V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'QUESTION'
);

console.log(
  '--------'
);


console.log(
  'What player/orb geometry is observed when a player actually'
);

console.log(
  'lands a successful secure or deny hit?'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'Raw .dem parsing:          NONE'
);


console.log(
  'Player state:              4 Hz, interpolation explicitly labeled'
);


console.log('');


// ============================================================
// ANALYZE REPLAYS
// ============================================================

const replayResults =
  [];


for (
  let index =
    0;

  index <
    cohort.length;

  index++
) {

  const replayName =
    String(
      cohort[index].replayName
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${index + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await analyzeReplay(
      replayName
    );


  replayResults.push(
    result
  );


  printReplayResult(
    result
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY STATUS
// ============================================================

const passingReplays =
  replayResults.filter(
    row =>
      row.validation.pass
  );


const status =
  passingReplays.length ===
  replayResults.length
    ? 'FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_READY'
    : 'FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_REQUIRE_DIAGNOSIS';


// ============================================================
// CROSS-REPLAY DISTRIBUTIONS
// ============================================================

const distributions =
  {

    uniqueAnchorsPerReplay:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.anchors.unique
        )
      ),


    orbPositionCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.coverage.orbPositionRate
        )
      ),


    playerPositionCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.coverage.playerPositionRate
        )
      ),


    eyeAngleCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.coverage.eyeAngleRate
        )
      ),


    secureDistance3D:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .secureDistance3D
        )
      ),


    denyDistance3D:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .denyDistance3D
        )
      ),


    secureEyeAngularError:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .secureEyeAngularError
        )
      ),


    denyEyeAngularError:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .denyEyeAngularError
        )
      ),


    stateObservationDistanceTicks:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .stateObservationDistanceTicks
        )
      )
  };


// ============================================================
// GLOBAL HERO POSITIVE-HIT ENVELOPES
// ============================================================

const heroRows =
  mergeHeroSummaries(
    replayResults.flatMap(
      row =>
        row.heroPositiveHitEnvelopes
    )
  );


// ============================================================
// INTERPRETATION
// ============================================================

const interpretation =
  {

    status,


    positiveAnchorMeaning:
      'A player successfully interacted with the exact flying soul. The reconstructed position/aim state is therefore a positive actionability calibration anchor.',


    importantTimingFindingFromScript115:
      'Observed Damage arrivals occurred as early as one tick after reconstructed attackable start for both secure and deny roles. Therefore the working secure-priority concept must not yet be encoded as a literal period in which deny-side Damage cannot register.',


    multipleHitGuardrail:
      'Script115 contained more Damage messages than shot episodes. Script116 deduplicates same event/player/tick/role messages into one positive anchor so multi-pellet or same-tick duplicate Damage does not overweight geometry distributions.',


    heroGuardrail:
      'Hero-specific successful-hit envelopes describe where successful interactions happened in this sample. They are not weapon range limits or causal estimates of hero difficulty.',


    nextStage:
      status ===
      'FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_READY'
        ? 'BUILD_ALL_PLAYER_ORB_DYNAMIC_GEOMETRY_AND_SEPARATE_MECHANICAL_REACHABILITY_FROM_ATTENTION_RESPONSE'
        : 'POSITIVE_ANCHOR_RECONSTRUCTION_DIAGNOSIS'
  };


// ============================================================
// GLOBAL SUMMARY
// ============================================================

const summary =
  {

    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    status,


    priorLayer:
      script115.status,


    aimConvention:
      {

        source:
          'Scripts97V02/98/104 validated replay aim convention',

        eyePitchComponent:
          EYE_PITCH_INDEX,

        eyeYawComponent:
          EYE_YAW_INDEX,

        yawWorldConvention:
          '0=+X, 90=+Y',

        cartesianPitchSign:
          -1
      },


    stateReconstruction:
      {

        sourceFrequencyHz:
          TICK_RATE /
          PLAYER_STATE_SAMPLE_TICKS,

        samplePeriodTicks:
          PLAYER_STATE_SAMPLE_TICKS,

        samplePeriodSeconds:
          PLAYER_STATE_SAMPLE_TICKS /
          TICK_RATE,

        maximumInterpolationGapTicks:
          MAX_INTERPOLATION_GAP_TICKS,

        maximumNearestOneSidedOffsetTicks:
          MAX_NEAREST_STATE_OFFSET_TICKS,

        warning:
          'Interpolated eye orientation and pawn position are observational proxies between 4 Hz samples, not true 64 Hz player state.'
      },


    validationThresholds:
      VALIDATION,


    replayCounts:
      {

        total:
          replayResults.length,

        passing:
          passingReplays.length
      },


    distributions,

    heroPositiveHitEnvelopes:
      heroRows,

    replays:
      replayResults,

    interpretation,


    outputs:
      {

        json:
          OUTPUT_JSON_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE GLOBAL OUTPUTS
// ============================================================

mkdirSync(
  dirname(
    OUTPUT_JSON_PATH
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  OUTPUT_JSON_PATH,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  OUTPUT_MARKDOWN_PATH,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// FINAL CONSOLE
// ============================================================

console.log(
  '========================================================'
);

console.log(
  'POSITIVE ACTIONABILITY CROSS-REPLAY SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'REPLAY RESULTS'
);

console.log(
  '--------------'
);


for (
  const row
  of replayResults
) {

  console.log(
    `${row.replay.padEnd(12)} ` +
    `anchors=${String(row.anchors.unique).padEnd(5)} ` +
    `orb=${formatPercent(row.coverage.orbPositionRate).padEnd(8)} ` +
    `player=${formatPercent(row.coverage.playerPositionRate).padEnd(8)} ` +
    `eye=${formatPercent(row.coverage.eyeAngleRate).padEnd(8)} ` +
    `pass=${row.validation.pass}`
  );
}


console.log('');

console.log(
  'KEY DISTRIBUTIONS'
);

console.log(
  '-----------------'
);


console.log(
  `Unique anchors/replay:    ${formatDistribution(
    distributions.uniqueAnchorsPerReplay
  )}`
);


console.log(
  `Orb position coverage:    ${formatDistribution(
    distributions.orbPositionCoverage
  )}`
);


console.log(
  `Player position coverage: ${formatDistribution(
    distributions.playerPositionCoverage
  )}`
);


console.log(
  `Eye angle coverage:       ${formatDistribution(
    distributions.eyeAngleCoverage
  )}`
);


console.log(
  `Secure distance 3D:       ${formatDistribution(
    distributions.secureDistance3D
  )}`
);


console.log(
  `Deny distance 3D:         ${formatDistribution(
    distributions.denyDistance3D
  )}`
);


console.log(
  `Secure eye error:         ${formatDistribution(
    distributions.secureEyeAngularError
  )}`
);


console.log(
  `Deny eye error:           ${formatDistribution(
    distributions.denyEyeAngularError
  )}`
);


console.log('');

console.log(
  'HERO POSITIVE-HIT ENVELOPES'
);

console.log(
  '---------------------------'
);


for (
  const hero
  of heroRows
) {

  console.log(
    `hero=${String(hero.heroId).padEnd(5)} ` +
    `n=${String(hero.anchors).padEnd(4)} ` +
    `secure=${String(hero.secure).padEnd(4)} ` +
    `deny=${String(hero.deny).padEnd(4)} ` +
    `dist3Dmed=${formatNumber(hero.distance3D.median).padEnd(8)} ` +
    `aimErrMed=${formatNumber(hero.eyeAngularError.median)}`
  );
}


console.log('');

console.log(
  'FINAL STATUS'
);

console.log(
  '------------'
);


console.log(
  status
);


console.log('');

console.log(
  'NEXT STAGE'
);

console.log(
  '----------'
);


console.log(
  interpretation.nextStage
);


console.log('');

console.log(
  `JSON:\n${OUTPUT_JSON_PATH}`
);


console.log('');

console.log(
  `Markdown:\n${OUTPUT_MARKDOWN_PATH}`
);


console.log('');


// ============================================================
// ANALYZE ONE REPLAY
// ============================================================

async function analyzeReplay(
  replayName
) {

  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const hitsPath =
    resolve(
      outputDirectory,
      'flying_soul_full_damage_hits_v01.jsonl'
    );


  const trajectoryPath =
    resolve(
      outputDirectory,
      'flying_soul_trajectory_v01.jsonl'
    );


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const anchorOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_positive_actionability_anchors_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_positive_actionability_anchors_summary_v01.json'
    );


  for (
    const path
    of [
      hitsPath,
      trajectoryPath,
      playerStatePath
    ]
  ) {

    if (
      !existsSync(
        path
      )
    ) {

      throw new Error(
        `Missing ${replayName} input:\n${path}`
      );
    }
  }


  // ----------------------------------------------------------
  // LOAD COMPLETE SCRIPT115 HITS
  // ----------------------------------------------------------

  const rawHits =
    await loadJsonl(
      hitsPath
    );


  const usableHits =
    rawHits.filter(
      row =>
        row.attackerPlayerName
        &&
        Number.isFinite(
          finite(
            row.demoTick
          )
        )
        &&
        (
          row.relation ===
          'SECURE_HIT'
          ||
          row.relation ===
          'DENY_HIT'
        )
    );


  // ----------------------------------------------------------
  // DEDUPLICATE SAME PLAYER / EVENT / TICK / ROLE
  //
  // Prevent same-tick pellet or duplicate Damage messages from
  // overweighting positive geometry distributions.
  // ----------------------------------------------------------

  const hitGroups =
    new Map();


  for (
    const hit
    of usableHits
  ) {

    const key =
      [
        hit.eventId,
        hit.attackerPlayerName,
        hit.demoTick,
        hit.relation
      ].join('|');


    if (
      !hitGroups.has(
        key
      )
    ) {

      hitGroups.set(
        key,
        []
      );
    }


    hitGroups.get(
      key
    ).push(
      hit
    );
  }


  const anchorSeeds =
    [
      ...hitGroups.entries()
    ]
      .map(
        ([
          key,
          messages
        ]) => {

          const first =
            messages[0];


          return {

            key,

            eventId:
              first.eventId,

            orbEpisodeId:
              first.orbEpisodeId,

            orbEntityIndex:
              finite(
                first.orbEntityIndex
              ),

            orbTeam:
              finite(
                first.orbTeam
              ),

            sourceDeathId:
              first.sourceDeathId
              ??
              null,

            sourceDeathTick:
              finite(
                first.sourceDeathTick
              ),

            hitTick:
              Math.trunc(
                Number(
                  first.demoTick
                )
              ),

            attackerPlayerName:
              first.attackerPlayerName,

            attackerTeam:
              finite(
                first.attackerTeam
              ),

            attackerHeroId:
              finite(
                first.attackerHeroId
              ),

            relation:
              first.relation,

            attackableStartTick:
              finite(
                first.attackableStartTick
              ),

            attackableEndTick:
              finite(
                first.attackableEndTick
              ),

            ticksAfterAttackableStart:
              finite(
                first.ticksAfterAttackableStart
              ),

            secondsAfterAttackableStart:
              finite(
                first.secondsAfterAttackableStart
              ),

            insideExactAttackableWindow:
              first.insideExactAttackableWindow ===
              true,

            insideTolerantAttackableWindow:
              first.insideTolerantAttackableWindow ===
              true,

            rawDamageMessageCount:
              messages.length,

            damageOrigins:
              messages
                .map(
                  row =>
                    normalizePosition(
                      row.origin
                    )
                )
                .filter(
                  Boolean
                ),

            damageDirections:
              messages
                .map(
                  row =>
                    normalizeVector(
                      row.damageDirection
                    )
                )
                .filter(
                  Boolean
                )
          };
        }
      )
      .sort(
        (
          a,
          b
        ) =>
          a.hitTick -
          b.hitTick
          ||
          a.attackerPlayerName.localeCompare(
            b.attackerPlayerName
          )
      );


  // ----------------------------------------------------------
  // LOAD / INDEX ORB TRAJECTORY
  // ----------------------------------------------------------

  const trajectory =
    await loadJsonl(
      trajectoryPath
    );


  const trajectoryByEvent =
    new Map();


  for (
    const row
    of trajectory
  ) {

    if (
      !row.eventId
    ) {

      continue;
    }


    if (
      !trajectoryByEvent.has(
        row.eventId
      )
    ) {

      trajectoryByEvent.set(
        row.eventId,
        []
      );
    }


    trajectoryByEvent
      .get(
        row.eventId
      )
      .push(
        {

          tick:
            finite(
              row.tick
            ),

          position:
            normalizePosition(
              row.position
            )
        }
      );
  }


  for (
    const rows
    of trajectoryByEvent.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );
  }


  // ----------------------------------------------------------
  // TARGET HIT TICKS BY PLAYER
  // ----------------------------------------------------------

  const targetTicksByPlayer =
    new Map();


  for (
    const seed
    of anchorSeeds
  ) {

    if (
      !targetTicksByPlayer.has(
        seed.attackerPlayerName
      )
    ) {

      targetTicksByPlayer.set(
        seed.attackerPlayerName,
        []
      );
    }


    targetTicksByPlayer
      .get(
        seed.attackerPlayerName
      )
      .push(
        seed.hitTick
      );
  }


  for (
    const [
      player,
      ticks
    ]
    of targetTicksByPlayer.entries()
  ) {

    targetTicksByPlayer.set(
      player,
      [
        ...new Set(
          ticks
        )
      ].sort(
        (
          a,
          b
        ) =>
          a -
          b
      )
    );
  }


  // ----------------------------------------------------------
  // STREAM PLAYER STATE NEAR POSITIVE HIT TICKS ONLY
  // ----------------------------------------------------------

  const playerState =
    await collectNearbyPlayerState({

      playerStatePath,

      targetTicksByPlayer
    });


  // ----------------------------------------------------------
  // BUILD POSITIVE ANCHORS
  // ----------------------------------------------------------

  const anchors =
    [];


  for (
    const seed
    of anchorSeeds
  ) {

    const orbObservation =
      resolveOrbPositionAtTick({

        rows:
          trajectoryByEvent.get(
            seed.eventId
          )
          ??
          [],

        tick:
          seed.hitTick
      });


    const playerRows =
      playerState.samplesByPlayer.get(
        seed.attackerPlayerName
      )
      ??
      [];


    const stateObservation =
      reconstructPlayerStateAtTick({

        rows:
          playerRows,

        tick:
          seed.hitTick
      });


    const playerPosition =
      stateObservation.position;


    const eyeAngles =
      stateObservation.eyeAngles;


    const orbPosition =
      orbObservation.position;


    const geometry =
      buildGeometry({

        playerPosition,

        orbPosition,

        eyeAngles
      });


    anchors.push(
      {

        schemaVersion:
          1,

        canonical:
          false,

        replay:
          replayName,

        anchorId:
          `POSITIVE|${seed.key}`,


        event:
          {

            eventId:
              seed.eventId,

            orbEpisodeId:
              seed.orbEpisodeId,

            orbEntityIndex:
              seed.orbEntityIndex,

            orbTeam:
              seed.orbTeam,

            sourceDeathId:
              seed.sourceDeathId,

            sourceDeathTick:
              seed.sourceDeathTick
          },


        observedSuccessfulInteraction:
          {

            hitTick:
              seed.hitTick,

            attackerPlayerName:
              seed.attackerPlayerName,

            attackerTeam:
              seed.attackerTeam,

            attackerHeroId:
              seed.attackerHeroId,

            relation:
              seed.relation,

            rawDamageMessageCount:
              seed.rawDamageMessageCount,

            semanticStatus:
              'OBSERVED_SUCCESSFUL_CITEMXP_DAMAGE'
          },


        temporal:
          {

            attackableStartTick:
              seed.attackableStartTick,

            attackableEndTick:
              seed.attackableEndTick,

            ticksAfterAttackableStart:
              seed.ticksAfterAttackableStart,

            secondsAfterAttackableStart:
              seed.secondsAfterAttackableStart,

            insideExactAttackableWindow:
              seed.insideExactAttackableWindow,

            insideTolerantAttackableWindow:
              seed.insideTolerantAttackableWindow
          },


        orbState:
          orbObservation,


        playerState:
          stateObservation,


        geometry,


        damageMessageGeometry:
          {

            originsObserved:
              seed.damageOrigins.length,

            directionsObserved:
              seed.damageDirections.length,

            firstOrigin:
              seed.damageOrigins[0]
              ??
              null,

            firstDirection:
              seed.damageDirections[0]
              ??
              null,

            semanticStatus:
              'AUXILIARY_DAMAGE_MESSAGE_FIELDS_NOT_USED_AS_PLAYER_POSITION'
          },


        interpretation:
          {

            positiveActionabilityAnchor:
              Boolean(
                orbPosition
                &&
                playerPosition
              ),

            eyeAimProxyAvailable:
              Boolean(
                geometry
                  .eyeAngularErrorDegrees !==
                null
              ),

            playerPositionSemanticStatus:
              stateObservation
                .positionSemanticStatus,

            eyeSemanticStatus:
              stateObservation
                .eyeSemanticStatus,

            warning:
              'A successful hit proves observed interaction, but interpolated 4 Hz player state is not exact trigger-pull or projectile-launch state.'
          }
      }
    );
  }


  // ----------------------------------------------------------
  // COVERAGE
  // ----------------------------------------------------------

  const orbPositionResolved =
    anchors.filter(
      row =>
        row.orbState.position
    );


  const playerPositionResolved =
    anchors.filter(
      row =>
        row.playerState.position
    );


  const eyeResolved =
    anchors.filter(
      row =>
        row.playerState.eyeAngles
    );


  const roleResolved =
    anchors.filter(
      row =>
        row
          .observedSuccessfulInteraction
          .relation ===
        'SECURE_HIT'
        ||
        row
          .observedSuccessfulInteraction
          .relation ===
        'DENY_HIT'
    );


  const fullGeometry =
    anchors.filter(
      row =>
        Number.isFinite(
          row.geometry.distance3D
        )
        &&
        Number.isFinite(
          row.geometry.eyeAngularErrorDegrees
        )
    );


  const coverage =
    {

      orbPosition:
        orbPositionResolved.length,

      orbPositionRate:
        rate(
          orbPositionResolved.length,
          anchors.length
        ),

      playerPosition:
        playerPositionResolved.length,

      playerPositionRate:
        rate(
          playerPositionResolved.length,
          anchors.length
        ),

      eyeAngles:
        eyeResolved.length,

      eyeAngleRate:
        rate(
          eyeResolved.length,
          anchors.length
        ),

      roleResolved:
        roleResolved.length,

      roleResolutionRate:
        rate(
          roleResolved.length,
          anchors.length
        ),

      fullGeometry:
        fullGeometry.length,

      fullGeometryRate:
        rate(
          fullGeometry.length,
          anchors.length
        )
    };


  // ----------------------------------------------------------
  // METHOD COUNTS
  // ----------------------------------------------------------

  const stateMethodCounts =
    countByObject(
      anchors,
      row =>
        row.playerState.method
    );


  const orbMethodCounts =
    countByObject(
      anchors,
      row =>
        row.orbState.method
    );


  // ----------------------------------------------------------
  // ROLE DISTRIBUTIONS
  // ----------------------------------------------------------

  const secure =
    anchors.filter(
      row =>
        row
          .observedSuccessfulInteraction
          .relation ===
        'SECURE_HIT'
    );


  const deny =
    anchors.filter(
      row =>
        row
          .observedSuccessfulInteraction
          .relation ===
        'DENY_HIT'
    );


  const secureDistance3D =
    secure
      .map(
        row =>
          row.geometry.distance3D
      )
      .filter(
        Number.isFinite
      );


  const denyDistance3D =
    deny
      .map(
        row =>
          row.geometry.distance3D
      )
      .filter(
        Number.isFinite
      );


  const secureEyeAngularError =
    secure
      .map(
        row =>
          row.geometry.eyeAngularErrorDegrees
      )
      .filter(
        Number.isFinite
      );


  const denyEyeAngularError =
    deny
      .map(
        row =>
          row.geometry.eyeAngularErrorDegrees
      )
      .filter(
        Number.isFinite
      );


  const stateObservationDistanceTicks =
    anchors
      .map(
        row =>
          row
            .playerState
            .nearestObservedOffsetTicks
      )
      .filter(
        Number.isFinite
      )
      .map(
        Math.abs
      );


  // ----------------------------------------------------------
  // HERO POSITIVE-HIT ENVELOPES
  // ----------------------------------------------------------

  const heroPositiveHitEnvelopes =
    buildHeroSummaries(
      anchors
    );


  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const checks =
    {

      positiveAnchorsPresent:
        {

          actual:
            anchors.length,

          expected:
            '>0',

          pass:
            anchors.length >
            0
        },


      orbPositionCoverage:
        {

          actual:
            coverage.orbPositionRate,

          expected:
            `>=${VALIDATION.minimumOrbPositionCoverage}`,

          pass:
            Number.isFinite(
              coverage.orbPositionRate
            )
            &&
            coverage.orbPositionRate >=
            VALIDATION.minimumOrbPositionCoverage
        },


      playerPositionCoverage:
        {

          actual:
            coverage.playerPositionRate,

          expected:
            `>=${VALIDATION.minimumPlayerPositionCoverage}`,

          pass:
            Number.isFinite(
              coverage.playerPositionRate
            )
            &&
            coverage.playerPositionRate >=
            VALIDATION.minimumPlayerPositionCoverage
        },


      eyeAngleCoverage:
        {

          actual:
            coverage.eyeAngleRate,

          expected:
            `>=${VALIDATION.minimumEyeAngleCoverage}`,

          pass:
            Number.isFinite(
              coverage.eyeAngleRate
            )
            &&
            coverage.eyeAngleRate >=
            VALIDATION.minimumEyeAngleCoverage
        },


      roleResolution:
        {

          actual:
            coverage.roleResolutionRate,

          expected:
            `>=${VALIDATION.minimumRoleResolutionRate}`,

          pass:
            Number.isFinite(
              coverage.roleResolutionRate
            )
            &&
            coverage.roleResolutionRate >=
            VALIDATION.minimumRoleResolutionRate
        }
    };


  const pass =
    Object.values(
      checks
    )
      .every(
        row =>
          row.pass
      );


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  const result =
    {

      replay:
        replayName,

      version:
        VERSION,

      canonical:
        false,


      input:
        {

          rawDamageMessages:
            rawHits.length,

          usableRoleResolvedDamageMessages:
            usableHits.length,

          uniquePositiveAnchors:
            anchors.length,

          sameTickMessagesCollapsed:
            usableHits.length -
            anchors.length
        },


      anchors:
        {

          unique:
            anchors.length,

          secure:
            secure.length,

          deny:
            deny.length,

          exactAttackable:
            anchors.filter(
              row =>
                row
                  .temporal
                  .insideExactAttackableWindow
            ).length,

          tolerantAttackable:
            anchors.filter(
              row =>
                row
                  .temporal
                  .insideTolerantAttackableWindow
            ).length
        },


      coverage,


      reconstruction:
        {

          playerStateRowsParsed:
            playerState.rowsParsed,

          playerStateRowsRetained:
            playerState.rowsRetained,

          playerStateParseFailures:
            playerState.parseFailures,

          stateMethodCounts,

          orbMethodCounts,

          playerStateSampling:
            {

              sourcePeriodTicks:
                PLAYER_STATE_SAMPLE_TICKS,

              sourcePeriodSeconds:
                PLAYER_STATE_SAMPLE_TICKS /
                TICK_RATE,

              maxInterpolationGapTicks:
                MAX_INTERPOLATION_GAP_TICKS,

              maxNearestOffsetTicks:
                MAX_NEAREST_STATE_OFFSET_TICKS
            }
        },


      geometry:
        {

          secure:
            summarizeGeometry(
              secure
            ),

          deny:
            summarizeGeometry(
              deny
            ),

          all:
            summarizeGeometry(
              anchors
            ),

          interpretation:
            'Observed successful-hit geometry only. Do not promote empirical maxima or percentiles to weapon/actionability thresholds.'
        },


      heroPositiveHitEnvelopes,


      validation:
        {

          pass,

          checks
        },


      rawDistributions:
        {

          secureDistance3D,

          denyDistance3D,

          secureEyeAngularError,

          denyEyeAngularError,

          stateObservationDistanceTicks
        },


      outputs:
        {

          anchors:
            anchorOutputPath,

          summary:
            replaySummaryPath
        }
    };


  // ----------------------------------------------------------
  // WRITE
  // ----------------------------------------------------------

  await writeJsonl(
    anchorOutputPath,
    anchors
  );


  writeFileSync(
    replaySummaryPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    'utf8'
  );


  return result;
}


// ============================================================
// COLLECT NEARBY PLAYER STATE
// ============================================================

async function collectNearbyPlayerState({

  playerStatePath,

  targetTicksByPlayer
}) {

  const samplesByPlayer =
    new Map();


  for (
    const player
    of targetTicksByPlayer.keys()
  ) {

    samplesByPlayer.set(
      player,
      []
    );
  }


  let rowsParsed =
    0;


  let rowsRetained =
    0;


  let parseFailures =
    0;


  const reader =
    createInterface({

      input:
        createReadStream(
          playerStatePath,
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

      parseFailures++;

      continue;
    }


    rowsParsed++;


    const playerName =
      row
        ?.controller
        ?.playerName
      ??
      null;


    const tick =
      finite(
        row.demoTick
      );


    if (
      !playerName
      ||
      tick ===
      null
      ||
      !targetTicksByPlayer.has(
        playerName
      )
    ) {

      continue;
    }


    const targetTicks =
      targetTicksByPlayer.get(
        playerName
      );


    const nearestDistance =
      nearestSortedDistance(
        targetTicks,
        tick
      );


    if (
      nearestDistance ===
      null
      ||
      nearestDistance >
      STATE_CAPTURE_RADIUS_TICKS
    ) {

      continue;
    }


    const compact =
      compactPlayerState(
        row
      );


    samplesByPlayer
      .get(
        playerName
      )
      .push(
        compact
      );


    rowsRetained++;
  }


  for (
    const rows
    of samplesByPlayer.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );
  }


  return {

    rowsParsed,

    rowsRetained,

    parseFailures,

    samplesByPlayer
  };
}


function compactPlayerState(
  row
) {

  const position =
    row
      ?.pawn
      ?.positionValidForMovement ===
    true
      ? normalizePosition(
          row
            ?.pawn
            ?.positionWorld
        )
      : null;


  const eyeAngles =
    normalizeAngles(
      row
        ?.pawn
        ?.eyeAngles
    );


  const bodyAngles =
    normalizeAngles(
      row
        ?.pawn
        ?.bodyRotation
    );


  return {

    tick:
      finite(
        row.demoTick
      ),

    matchTimeSeconds:
      finite(
        row.matchTimeSeconds
      ),

    alive:
      row
        ?.controller
        ?.alive ===
      true,

    playerName:
      row
        ?.controller
        ?.playerName
      ??
      null,

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
      ),

    pawnEntityIndex:
      finite(
        row
          ?.pawn
          ?.entityIndex
      ),

    positionValid:
      Boolean(
        position
      ),

    position,

    eyeAngles,

    bodyAngles
  };
}


// ============================================================
// PLAYER STATE RECONSTRUCTION
// ============================================================

function reconstructPlayerStateAtTick({

  rows,

  tick
}) {

  const exact =
    rows.find(
      row =>
        row.tick ===
        tick
    )
    ??
    null;


  let before =
    null;


  let after =
    null;


  for (
    const row
    of rows
  ) {

    if (
      row.tick <=
      tick
    ) {

      if (
        !before
        ||
        row.tick >
        before.tick
      ) {

        before =
          row;
      }
    }


    if (
      row.tick >=
      tick
    ) {

      if (
        !after
        ||
        row.tick <
        after.tick
      ) {

        after =
          row;
      }
    }
  }


  const nearest =
    chooseNearestState(
      before,
      after,
      tick
    );


  const nearestObservedOffsetTicks =
    nearest
      ? nearest.tick -
        tick
      : null;


  // ----------------------------------------------------------
  // EXACT SAMPLE
  // ----------------------------------------------------------

  if (
    exact
  ) {

    return {

      method:
        'EXACT_4HZ_SAMPLE',

      targetTick:
        tick,

      beforeTick:
        exact.tick,

      afterTick:
        exact.tick,

      nearestObservedTick:
        exact.tick,

      nearestObservedOffsetTicks:
        0,

      interpolationAlpha:
        0,

      alive:
        exact.alive,

      team:
        exact.team,

      heroId:
        exact.heroId,

      pawnEntityIndex:
        exact.pawnEntityIndex,

      position:
        exact.position,

      eyeAngles:
        exact.eyeAngles,

      bodyAngles:
        exact.bodyAngles,

      positionSemanticStatus:
        exact.position
          ? 'OBSERVED_4HZ_SAMPLE'
          : 'UNRESOLVED',

      eyeSemanticStatus:
        exact.eyeAngles
          ? 'OBSERVED_4HZ_SAMPLE'
          : 'UNRESOLVED'
    };
  }


  // ----------------------------------------------------------
  // BRACKET INTERPOLATION
  // ----------------------------------------------------------

  if (
    before
    &&
    after
    &&
    before.tick <
    tick
    &&
    after.tick >
    tick
    &&
    after.tick -
    before.tick <=
    MAX_INTERPOLATION_GAP_TICKS
    &&
    before.alive
    &&
    after.alive
  ) {

    const alpha =
      (
        tick -
        before.tick
      )
      /
      (
        after.tick -
        before.tick
      );


    const position =
      before.position
      &&
      after.position
        ? interpolatePosition(
            before.position,
            after.position,
            alpha
          )
        : null;


    const eyeAngles =
      before.eyeAngles
      &&
      after.eyeAngles
        ? interpolateAngles(
            before.eyeAngles,
            after.eyeAngles,
            alpha
          )
        : null;


    const bodyAngles =
      before.bodyAngles
      &&
      after.bodyAngles
        ? interpolateAngles(
            before.bodyAngles,
            after.bodyAngles,
            alpha
          )
        : null;


    return {

      method:
        'BRACKET_INTERPOLATED_4HZ',

      targetTick:
        tick,

      beforeTick:
        before.tick,

      afterTick:
        after.tick,

      nearestObservedTick:
        nearest?.tick
        ??
        null,

      nearestObservedOffsetTicks,

      interpolationAlpha:
        alpha,

      alive:
        true,

      team:
        nearest?.team
        ??
        before.team
        ??
        after.team
        ??
        null,

      heroId:
        nearest?.heroId
        ??
        before.heroId
        ??
        after.heroId
        ??
        null,

      pawnEntityIndex:
        nearest?.pawnEntityIndex
        ??
        before.pawnEntityIndex
        ??
        after.pawnEntityIndex
        ??
        null,

      position,

      eyeAngles,

      bodyAngles,

      positionSemanticStatus:
        position
          ? 'LINEAR_INTERPOLATION_BETWEEN_ADJACENT_4HZ_SAMPLES'
          : 'UNRESOLVED',

      eyeSemanticStatus:
        eyeAngles
          ? 'CIRCULAR_YAW_LINEAR_PITCH_INTERPOLATION_BETWEEN_ADJACENT_4HZ_SAMPLES'
          : 'UNRESOLVED'
    };
  }


  // ----------------------------------------------------------
  // ONE-SIDED NEAREST FALLBACK
  // ----------------------------------------------------------

  if (
    nearest
    &&
    Math.abs(
      nearestObservedOffsetTicks
    ) <=
    MAX_NEAREST_STATE_OFFSET_TICKS
    &&
    nearest.alive
  ) {

    return {

      method:
        nearest.tick <
        tick
          ? 'NEAREST_BEFORE_4HZ_PROXY'
          : 'NEAREST_AFTER_4HZ_PROXY',

      targetTick:
        tick,

      beforeTick:
        before?.tick
        ??
        null,

      afterTick:
        after?.tick
        ??
        null,

      nearestObservedTick:
        nearest.tick,

      nearestObservedOffsetTicks,

      interpolationAlpha:
        null,

      alive:
        nearest.alive,

      team:
        nearest.team,

      heroId:
        nearest.heroId,

      pawnEntityIndex:
        nearest.pawnEntityIndex,

      position:
        nearest.position,

      eyeAngles:
        nearest.eyeAngles,

      bodyAngles:
        nearest.bodyAngles,

      positionSemanticStatus:
        nearest.position
          ? 'NEAREST_4HZ_SAMPLE_PROXY'
          : 'UNRESOLVED',

      eyeSemanticStatus:
        nearest.eyeAngles
          ? 'NEAREST_4HZ_SAMPLE_PROXY'
          : 'UNRESOLVED'
    };
  }


  return {

    method:
      'UNRESOLVED',

    targetTick:
      tick,

    beforeTick:
      before?.tick
      ??
      null,

    afterTick:
      after?.tick
      ??
      null,

    nearestObservedTick:
      nearest?.tick
      ??
      null,

    nearestObservedOffsetTicks,

    interpolationAlpha:
      null,

    alive:
      null,

    team:
      nearest?.team
      ??
      null,

    heroId:
      nearest?.heroId
      ??
      null,

    pawnEntityIndex:
      nearest?.pawnEntityIndex
      ??
      null,

    position:
      null,

    eyeAngles:
      null,

    bodyAngles:
      null,

    positionSemanticStatus:
      'UNRESOLVED',

    eyeSemanticStatus:
      'UNRESOLVED'
  };
}


function chooseNearestState(
  before,
  after,
  tick
) {

  if (
    !before
  ) {

    return after;
  }


  if (
    !after
  ) {

    return before;
  }


  const beforeDistance =
    Math.abs(
      tick -
      before.tick
    );


  const afterDistance =
    Math.abs(
      after.tick -
      tick
    );


  return beforeDistance <=
    afterDistance
      ? before
      : after;
}


// ============================================================
// ORB POSITION AT HIT TICK
// ============================================================

function resolveOrbPositionAtTick({

  rows,

  tick
}) {

  const exact =
    rows.find(
      row =>
        row.tick ===
        tick
        &&
        row.position
    )
    ??
    null;


  if (
    exact
  ) {

    return {

      method:
        'EXACT_TRAJECTORY_TICK',

      targetTick:
        tick,

      observedTick:
        exact.tick,

      observedOffsetTicks:
        0,

      position:
        exact.position,

      semanticStatus:
        'OBSERVED_CITEMXP_POSITION_AT_HIT_TICK'
    };
  }


  let nearest =
    null;


  let nearestDistance =
    Infinity;


  for (
    const row
    of rows
  ) {

    if (
      !row.position
    ) {

      continue;
    }


    const distance =
      Math.abs(
        row.tick -
        tick
      );


    if (
      distance <
      nearestDistance
    ) {

      nearest =
        row;

      nearestDistance =
        distance;
    }
  }


  if (
    nearest
    &&
    nearestDistance <=
    MAX_NEAREST_ORB_OFFSET_TICKS
  ) {

    return {

      method:
        'NEAREST_TRAJECTORY_TICK',

      targetTick:
        tick,

      observedTick:
        nearest.tick,

      observedOffsetTicks:
        nearest.tick -
        tick,

      position:
        nearest.position,

      semanticStatus:
        'NEAREST_OBSERVED_CITEMXP_POSITION_PROXY'
    };
  }


  return {

    method:
      'UNRESOLVED',

    targetTick:
      tick,

    observedTick:
      null,

    observedOffsetTicks:
      null,

    position:
      null,

    semanticStatus:
      'UNRESOLVED'
  };
}


// ============================================================
// GEOMETRY
// ============================================================

function buildGeometry({

  playerPosition,

  orbPosition,

  eyeAngles
}) {

  if (
    !playerPosition
    ||
    !orbPosition
  ) {

    return emptyGeometry();
  }


  const dx =
    orbPosition.x -
    playerPosition.x;


  const dy =
    orbPosition.y -
    playerPosition.y;


  const dz =
    orbPosition.z -
    playerPosition.z;


  const distanceXY =
    Math.sqrt(
      dx *
      dx
      +
      dy *
      dy
    );


  const distance3D =
    Math.sqrt(
      distanceXY *
      distanceXY
      +
      dz *
      dz
    );


  const requiredYawDegrees =
    wrapDegrees360(
      radiansToDegrees(
        Math.atan2(
          dy,
          dx
        )
      )
    );


  // Stored eye pitch uses validated Cartesian sign -1.
  const requiredEyePitchDegrees =
    -radiansToDegrees(
      Math.atan2(
        dz,
        Math.max(
          1e-9,
          distanceXY
        )
      )
    );


  let eyePitchDegrees =
    null;


  let eyeYawDegrees =
    null;


  let yawErrorDegrees =
    null;


  let pitchErrorDegrees =
    null;


  let eyeAngularErrorDegrees =
    null;


  if (
    eyeAngles
  ) {

    eyePitchDegrees =
      finite(
        eyeAngles.pitch
      );


    eyeYawDegrees =
      finite(
        eyeAngles.yaw
      );


    if (
      eyePitchDegrees !==
      null
      &&
      eyeYawDegrees !==
      null
    ) {

      yawErrorDegrees =
        Math.abs(
          shortestAngleDeltaDegrees(
            eyeYawDegrees,
            requiredYawDegrees
          )
        );


      pitchErrorDegrees =
        Math.abs(
          shortestAngleDeltaDegrees(
            eyePitchDegrees,
            requiredEyePitchDegrees
          )
        );


      const eyeDirection =
        eyeAnglesToDirection(
          eyePitchDegrees,
          eyeYawDegrees
        );


      const targetDirection =
        normalizeVector(
          {

            x:
              dx,

            y:
              dy,

            z:
              dz
          }
        );


      if (
        eyeDirection
        &&
        targetDirection
      ) {

        const dot =
          clamp(
            eyeDirection.x *
            targetDirection.x
            +
            eyeDirection.y *
            targetDirection.y
            +
            eyeDirection.z *
            targetDirection.z,
            -1,
            1
          );


        eyeAngularErrorDegrees =
          radiansToDegrees(
            Math.acos(
              dot
            )
          );
      }
    }
  }


  return {

    originSemanticStatus:
      'PLAYER_PAWN_WORLD_POSITION_PROXY_NOT_EYE_OR_MUZZLE_ORIGIN',

    distanceXY,

    distance3D,

    delta:
      {

        x:
          dx,

        y:
          dy,

        z:
          dz
      },

    requiredYawDegrees,

    requiredEyePitchDegrees,

    eyePitchDegrees,

    eyeYawDegrees,

    yawErrorDegrees,

    pitchErrorDegrees,

    eyeAngularErrorDegrees,

    aimSemanticStatus:
      eyeAngularErrorDegrees !==
      null
        ? 'VALIDATED_EYE_ORIENTATION_WITH_4HZ_STATE_PROXY'
        : 'UNRESOLVED'
  };
}


function emptyGeometry() {

  return {

    originSemanticStatus:
      'UNRESOLVED',

    distanceXY:
      null,

    distance3D:
      null,

    delta:
      null,

    requiredYawDegrees:
      null,

    requiredEyePitchDegrees:
      null,

    eyePitchDegrees:
      null,

    eyeYawDegrees:
      null,

    yawErrorDegrees:
      null,

    pitchErrorDegrees:
      null,

    eyeAngularErrorDegrees:
      null,

    aimSemanticStatus:
      'UNRESOLVED'
  };
}


function eyeAnglesToDirection(
  pitchDegrees,
  yawDegrees
) {

  if (
    !Number.isFinite(
      pitchDegrees
    )
    ||
    !Number.isFinite(
      yawDegrees
    )
  ) {

    return null;
  }


  // Cartesian pitch is negative of stored eye pitch.
  const cartesianPitchRadians =
    degreesToRadians(
      -pitchDegrees
    );


  const yawRadians =
    degreesToRadians(
      yawDegrees
    );


  const cosPitch =
    Math.cos(
      cartesianPitchRadians
    );


  return {

    x:
      cosPitch *
      Math.cos(
        yawRadians
      ),

    y:
      cosPitch *
      Math.sin(
        yawRadians
      ),

    z:
      Math.sin(
        cartesianPitchRadians
      )
  };
}


// ============================================================
// HERO SUMMARIES
// ============================================================

function buildHeroSummaries(
  anchors
) {

  const groups =
    new Map();


  for (
    const anchor
    of anchors
  ) {

    const heroId =
      finite(
        anchor
          .observedSuccessfulInteraction
          .attackerHeroId
      )
      ??
      finite(
        anchor
          .playerState
          .heroId
      );


    if (
      heroId ===
      null
    ) {

      continue;
    }


    if (
      !groups.has(
        heroId
      )
    ) {

      groups.set(
        heroId,
        []
      );
    }


    groups.get(
      heroId
    ).push(
      anchor
    );
  }


  return [
    ...groups.entries()
  ]
    .map(
      ([
        heroId,
        rows
      ]) =>
        summarizeHeroRows(
          heroId,
          rows
        )
    )
    .sort(
      (
        a,
        b
      ) =>
        b.anchors -
        a.anchors
        ||
        a.heroId -
        b.heroId
    );
}


function summarizeHeroRows(
  heroId,
  rows
) {

  const secure =
    rows.filter(
      row =>
        row
          .observedSuccessfulInteraction
          .relation ===
        'SECURE_HIT'
    );


  const deny =
    rows.filter(
      row =>
        row
          .observedSuccessfulInteraction
          .relation ===
        'DENY_HIT'
    );


  return {

    heroId,

    anchors:
      rows.length,

    secure:
      secure.length,

    deny:
      deny.length,

    distance3D:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.distance3D
          )
          .filter(
            Number.isFinite
          )
      ),

    eyeAngularError:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.eyeAngularErrorDegrees
          )
          .filter(
            Number.isFinite
          )
      ),

    secureDistance3D:
      summarizeNumbers(
        secure
          .map(
            row =>
              row.geometry.distance3D
          )
          .filter(
            Number.isFinite
          )
      ),

    denyDistance3D:
      summarizeNumbers(
        deny
          .map(
            row =>
              row.geometry.distance3D
          )
          .filter(
            Number.isFinite
          )
      ),

    semanticStatus:
      'OBSERVED_SUCCESSFUL_HIT_ENVELOPE_NOT_MECHANICAL_CAPABILITY_LIMIT'
  };
}


function mergeHeroSummaries(
  rows
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const heroId =
      finite(
        row.heroId
      );


    if (
      heroId ===
      null
    ) {

      continue;
    }


    if (
      !groups.has(
        heroId
      )
    ) {

      groups.set(
        heroId,
        {

          anchors:
            0,

          secure:
            0,

          deny:
            0,

          distance3D:
            [],

          eyeAngularError:
            []
        }
      );
    }


    const target =
      groups.get(
        heroId
      );


    target.anchors +=
      finite(
        row.anchors
      )
      ??
      0;


    target.secure +=
      finite(
        row.secure
      )
      ??
      0;


    target.deny +=
      finite(
        row.deny
      )
      ??
      0;


    // Replay-level summaries cannot be losslessly pooled from
    // quantiles. Use replay medians as a lightweight global hero
    // display only. Exact event-level distributions remain in
    // each replay's anchor JSONL.
    if (
      Number.isFinite(
        row.distance3D?.median
      )
    ) {

      target.distance3D.push(
        row.distance3D.median
      );
    }


    if (
      Number.isFinite(
        row.eyeAngularError?.median
      )
    ) {

      target.eyeAngularError.push(
        row.eyeAngularError.median
      );
    }
  }


  return [
    ...groups.entries()
  ]
    .map(
      ([
        heroId,
        row
      ]) =>
        ({

          heroId,

          anchors:
            row.anchors,

          secure:
            row.secure,

          deny:
            row.deny,

          distance3D:
            summarizeNumbers(
              row.distance3D
            ),

          eyeAngularError:
            summarizeNumbers(
              row.eyeAngularError
            ),

          aggregationNote:
            'Global displayed geometry summarizes replay-level hero medians; use replay anchor JSONL for event-level modeling.'
        })
    )
    .sort(
      (
        a,
        b
      ) =>
        b.anchors -
        a.anchors
        ||
        a.heroId -
        b.heroId
    );
}


function summarizeGeometry(
  rows
) {

  return {

    distanceXY:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.distanceXY
          )
          .filter(
            Number.isFinite
          )
      ),

    distance3D:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.distance3D
          )
          .filter(
            Number.isFinite
          )
      ),

    yawErrorDegrees:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.yawErrorDegrees
          )
          .filter(
            Number.isFinite
          )
      ),

    pitchErrorDegrees:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.pitchErrorDegrees
          )
          .filter(
            Number.isFinite
          )
      ),

    eyeAngularErrorDegrees:
      summarizeNumbers(
        rows
          .map(
            row =>
              row.geometry.eyeAngularErrorDegrees
          )
          .filter(
            Number.isFinite
          )
      )
  };
}


// ============================================================
// INTERPOLATION
// ============================================================

function interpolatePosition(
  a,
  b,
  alpha
) {

  return {

    x:
      lerp(
        a.x,
        b.x,
        alpha
      ),

    y:
      lerp(
        a.y,
        b.y,
        alpha
      ),

    z:
      lerp(
        a.z,
        b.z,
        alpha
      )
  };
}


function interpolateAngles(
  a,
  b,
  alpha
) {

  return {

    pitch:
      lerp(
        a.pitch,
        b.pitch,
        alpha
      ),

    yaw:
      wrapDegrees180(
        a.yaw
        +
        shortestAngleDeltaDegrees(
          a.yaw,
          b.yaw
        )
        *
        alpha
      )
  };
}


function lerp(
  a,
  b,
  alpha
) {

  return a +
    (
      b -
      a
    )
    *
    alpha;
}


// ============================================================
// ANGLE / VECTOR HELPERS
// ============================================================

function normalizeAngles(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  let pitch =
    null;


  let yaw =
    null;


  if (
    Array.isArray(
      value
    )
  ) {

    pitch =
      finite(
        value[
          EYE_PITCH_INDEX
        ]
      );


    yaw =
      finite(
        value[
          EYE_YAW_INDEX
        ]
      );

  } else if (
    typeof value ===
    'object'
  ) {

    pitch =
      firstFinite(
        [

          value[
            EYE_PITCH_INDEX
          ],

          value[
            String(
              EYE_PITCH_INDEX
            )
          ],

          value.pitch,

          value.x,

          value.c0
        ]
      );


    yaw =
      firstFinite(
        [

          value[
            EYE_YAW_INDEX
          ],

          value[
            String(
              EYE_YAW_INDEX
            )
          ],

          value.yaw,

          value.y,

          value.c1
        ]
      );
  }


  if (
    pitch ===
    null
    ||
    yaw ===
    null
  ) {

    return null;
  }


  return {

    pitch:
      wrapDegrees180(
        pitch
      ),

    yaw:
      wrapDegrees180(
        yaw
      )
  };
}


function normalizePosition(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const x =
    firstFinite(
      [

        value.x,

        value.X,

        value[0],

        value['0']
      ]
    );


  const y =
    firstFinite(
      [

        value.y,

        value.Y,

        value[1],

        value['1']
      ]
    );


  const z =
    firstFinite(
      [

        value.z,

        value.Z,

        value[2],

        value['2'],

        0
      ]
    );


  if (
    x ===
    null
    ||
    y ===
    null
  ) {

    return null;
  }


  return {

    x,

    y,

    z:
      z ??
      0
  };
}


function normalizeVector(
  value
) {

  const vector =
    normalizePosition(
      value
    );


  if (
    !vector
  ) {

    return null;
  }


  const magnitude =
    Math.sqrt(
      vector.x *
      vector.x
      +
      vector.y *
      vector.y
      +
      vector.z *
      vector.z
    );


  if (
    !Number.isFinite(
      magnitude
    )
    ||
    magnitude <=
    1e-9
  ) {

    return null;
  }


  return {

    x:
      vector.x /
      magnitude,

    y:
      vector.y /
      magnitude,

    z:
      vector.z /
      magnitude
  };
}


function shortestAngleDeltaDegrees(
  fromDegrees,
  toDegrees
) {

  return wrapDegrees180(
    toDegrees -
    fromDegrees
  );
}


function wrapDegrees180(
  degrees
) {

  let value =
    degrees %
    360;


  if (
    value >
    180
  ) {

    value -=
      360;
  }


  if (
    value <=
    -180
  ) {

    value +=
      360;
  }


  return value;
}


function wrapDegrees360(
  degrees
) {

  let value =
    degrees %
    360;


  if (
    value <
    0
  ) {

    value +=
      360;
  }


  return value;
}


function degreesToRadians(
  degrees
) {

  return degrees *
    Math.PI /
    180;
}


function radiansToDegrees(
  radians
) {

  return radians *
    180 /
    Math.PI;
}


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );
}


// ============================================================
// SORTED-TICK DISTANCE
// ============================================================

function nearestSortedDistance(
  sorted,
  target
) {

  if (
    sorted.length ===
    0
  ) {

    return null;
  }


  let low =
    0;


  let high =
    sorted.length -
    1;


  while (
    low <=
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


    const value =
      sorted[mid];


    if (
      value ===
      target
    ) {

      return 0;
    }


    if (
      value <
      target
    ) {

      low =
        mid +
        1;

    } else {

      high =
        mid -
        1;
    }
  }


  const candidates =
    [];


  if (
    low <
    sorted.length
  ) {

    candidates.push(
      Math.abs(
        sorted[low] -
        target
      )
    );
  }


  if (
    high >=
    0
  ) {

    candidates.push(
      Math.abs(
        sorted[high] -
        target
      )
    );
  }


  return candidates.length >
    0
      ? Math.min(
          ...candidates
        )
      : null;
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

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
  );


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
// COLLECTION HELPERS
// ============================================================

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
        )
        ??
        0
      )
      +
      1
    );
  }


  return Object.fromEntries(
    [
      ...map.entries()
    ]
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
      )
  );
}


// ============================================================
// VALUE / NUMERIC HELPERS
// ============================================================

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


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    clean.length ===
    0
  ) {

    return null;
  }


  return clean.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  )
  /
  clean.length;
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
      mean(
        clean
      )
  };
}


function quantile(
  sorted,
  q
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


// ============================================================
// CONSOLE
// ============================================================

function printReplayResult(
  row
) {

  console.log('');

  console.log(
    'POSITIVE ANCHORS'
  );


  console.log(
    `  raw Damage messages:        ${row.input.rawDamageMessages}`
  );


  console.log(
    `  usable role-resolved:       ${row.input.usableRoleResolvedDamageMessages}`
  );


  console.log(
    `  unique anchors:             ${row.anchors.unique}`
  );


  console.log(
    `  collapsed same-tick msgs:   ${row.input.sameTickMessagesCollapsed}`
  );


  console.log(
    `  secure anchors:             ${row.anchors.secure}`
  );


  console.log(
    `  deny anchors:               ${row.anchors.deny}`
  );


  console.log('');

  console.log(
    'RECONSTRUCTION COVERAGE'
  );


  console.log(
    `  orb position:               ${row.coverage.orbPosition}/${row.anchors.unique} (${formatPercent(
      row.coverage.orbPositionRate
    )})`
  );


  console.log(
    `  player position:            ${row.coverage.playerPosition}/${row.anchors.unique} (${formatPercent(
      row.coverage.playerPositionRate
    )})`
  );


  console.log(
    `  eye angles:                 ${row.coverage.eyeAngles}/${row.anchors.unique} (${formatPercent(
      row.coverage.eyeAngleRate
    )})`
  );


  console.log(
    `  full geometry:              ${row.coverage.fullGeometry}/${row.anchors.unique} (${formatPercent(
      row.coverage.fullGeometryRate
    )})`
  );


  console.log('');

  console.log(
    'SUCCESSFUL-HIT GEOMETRY'
  );


  console.log(
    `  secure dist 3D median:      ${formatNumber(
      row.geometry.secure.distance3D.median
    )} HU`
  );


  console.log(
    `  deny dist 3D median:        ${formatNumber(
      row.geometry.deny.distance3D.median
    )} HU`
  );


  console.log(
    `  secure eye error median:    ${formatNumber(
      row.geometry.secure.eyeAngularErrorDegrees.median
    )} deg`
  );


  console.log(
    `  deny eye error median:      ${formatNumber(
      row.geometry.deny.eyeAngularErrorDegrees.median
    )} deg`
  );


  console.log('');

  console.log(
    'STATE METHODS'
  );


  console.log(
    `  ${JSON.stringify(
      row.reconstruction.stateMethodCounts
    )}`
  );


  console.log('');

  console.log(
    `VALIDATION:                   ${row.validation.pass ? 'PASS' : 'FAIL'}`
  );
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
          4
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
    `max=${formatNumber(row.max)}`
  );
}


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Flying-Soul Positive Actionability Anchors'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Meaning'
  );


  lines.push('');


  lines.push(
    'Each row is a successful player interaction with a source-linked Trooper flying soul, paired with reconstructed moving-orb position and the attacker’s nearest/interpolated 4 Hz player state.'
  );


  lines.push('');


  lines.push(
    'These are **positive calibration anchors**, not opportunity thresholds.'
  );


  lines.push('');


  lines.push(
    '## Important timing implication'
  );


  lines.push('');


  lines.push(
    'Script115 observed Damage arrivals as early as one tick after reconstructed attackable start for both secure and deny roles. Therefore any short securing-side priority mechanic must not yet be modeled as a literal interval in which deny-side Damage messages cannot register.'
  );


  lines.push('');


  lines.push(
    '## Replay results'
  );


  lines.push('');


  for (
    const replay
    of summary.replays
  ) {

    lines.push(
      `### ${replay.replay}`
    );


    lines.push('');


    lines.push(
      `- Unique positive anchors: ${replay.anchors.unique}`
    );


    lines.push(
      `- Secure anchors: ${replay.anchors.secure}`
    );


    lines.push(
      `- Deny anchors: ${replay.anchors.deny}`
    );


    lines.push(
      `- Orb-position coverage: ${formatPercent(replay.coverage.orbPositionRate)}`
    );


    lines.push(
      `- Player-position coverage: ${formatPercent(replay.coverage.playerPositionRate)}`
    );


    lines.push(
      `- Eye-angle coverage: ${formatPercent(replay.coverage.eyeAngleRate)}`
    );


    lines.push(
      `- Secure successful-hit median 3D distance: ${formatNumber(replay.geometry.secure.distance3D.median)} HU`
    );


    lines.push(
      `- Deny successful-hit median 3D distance: ${formatNumber(replay.geometry.deny.distance3D.median)} HU`
    );


    lines.push(
      `- Validation: **${replay.validation.pass ? 'PASS' : 'FAIL'}**`
    );


    lines.push('');
  }


  lines.push(
    '## Guardrails'
  );


  lines.push('');


  lines.push(
    '- Player position uses pawn world position, not exact eye or muzzle origin.'
  );


  lines.push(
    '- Between 4 Hz state samples, position and eye orientation are explicitly labeled interpolation proxies.'
  );


  lines.push(
    '- Hero-specific successful-hit distributions are observed envelopes, not mechanical range limits or evidence that one hero is intrinsically better at securing/denying.'
  );


  lines.push(
    '- Successful Damage arrival is an outcome anchor, not trigger-pull time or reaction time.'
  );


  lines.push('');


  lines.push(
    '## Next stage'
  );


  lines.push('');


  lines.push(
    summary.interpretation.nextStage
  );


  lines.push('');


  return lines.join(
    '\n'
  );
}