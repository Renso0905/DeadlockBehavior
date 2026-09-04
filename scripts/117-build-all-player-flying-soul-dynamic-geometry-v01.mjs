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
  'FLYING_SOUL_ALL_PLAYER_DYNAMIC_GEOMETRY_V01';


// ============================================================
// PURPOSE
//
// Script116 established POSITIVE actionability anchors:
// successful player -> moving orb interactions with reconstructed
// player position and validated eye orientation.
//
// Script117 expands from successful players to EVERY mechanically
// role-relevant player for EVERY source-linked flying soul.
//
// One output row = one PLAYER x FLYING-SOUL EVENT relation.
//
// For the effective attackable lifetime of that soul we derive:
//
//   - reconstructed alive-state exposure
//   - dynamic player -> orb distance
//   - dynamic eye -> orb angular error
//   - first / best / distributional geometry
//   - descriptive distance/aim bands
//   - secure-priority diagnostic subwindows (5 and 6 ticks)
//   - whether this player actually produced an observed hit
//
// CRITICAL GUARDRAILS
// -------------------
//
// NO_OBSERVED_HIT != FAILURE
// NO_OBSERVED_HIT != IGNORED_SOUL
//
// Geometry alone also does NOT establish mechanical reachability.
// We still have not modeled:
//
//   - line of sight
//   - weapon readiness
//   - ammo / reload / fire-cycle state
//   - hero projectile velocity
//   - muzzle / eye origin offset
//   - projectile travel time
//   - secure/deny adjudication details
//
// This script creates the candidate-level observational feature
// substrate required for that later work.
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


const MAX_INTERPOLATION_GAP_TICKS =
  PLAYER_STATE_SAMPLE_TICKS;


const MAX_NEAREST_STATE_OFFSET_TICKS =
  8;


const MAX_NEAREST_ORB_OFFSET_TICKS =
  2;


// ------------------------------------------------------------
// Validated aim convention from Scripts97V02 / 98 / 104.
// ------------------------------------------------------------

const EYE_PITCH_INDEX =
  0;


const EYE_YAW_INDEX =
  1;


// ------------------------------------------------------------
// These are DESCRIPTIVE FEATURE BANDS ONLY.
//
// They are deliberately NOT called opportunity thresholds.
// ------------------------------------------------------------

const DISTANCE_BANDS_HU =
  [
    500,
    750,
    1000,
    1250,
    1500,
    2000,
    2500
  ];


const AIM_ERROR_BANDS_DEG =
  [
    5,
    10,
    15,
    20,
    30
  ];


const JOINT_BANDS =
  [
    {
      name:
        'D750_A10',
      distanceHU:
        750,
      aimDeg:
        10
    },
    {
      name:
        'D1000_A10',
      distanceHU:
        1000,
      aimDeg:
        10
    },
    {
      name:
        'D1000_A15',
      distanceHU:
        1000,
      aimDeg:
        15
    },
    {
      name:
        'D1500_A15',
      distanceHU:
        1500,
      aimDeg:
        15
    },
    {
      name:
        'D2000_A20',
      distanceHU:
        2000,
      aimDeg:
        20
    }
  ];


// ------------------------------------------------------------
// Secure-side priority remains a documented prior, not a replay-
// canonicalized exclusive lockout rule.
// ------------------------------------------------------------

const PRIORITY_DIAGNOSTIC_TICKS =
  [
    5,
    6
  ];


// ============================================================
// VALIDATION THRESHOLDS
//
// Pipeline readiness only.
// ============================================================

const VALIDATION =
  {
    minimumEventMapRate:
      0.999,

    minimumRoleResolutionRate:
      0.999,

    minimumOrbTickCoverageRate:
      0.99,

    minimumPositiveHitCandidateRecoveryRate:
      0.999,

    minimumPositiveHitGeometryRate:
      0.95
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


const SCRIPT116_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_positive_actionability_anchors_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_all_player_dynamic_geometry_batch_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_all_player_dynamic_geometry_batch_v01.md'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT116_PATH
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


const script116 =
  JSON.parse(
    readFileSync(
      SCRIPT116_PATH,
      'utf8'
    )
  );


if (
  script116?.status !==
  'FLYING_SOUL_POSITIVE_ACTIONABILITY_ANCHORS_READY'
) {

  throw new Error(
    `Script116 positive-anchor layer not ready.\nStatus: ${script116?.status}`
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
  'ALL-PLAYER FLYING-SOUL DYNAMIC GEOMETRY V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'BEHAVIORAL CONTRACT'
);

console.log(
  '-------------------'
);

console.log(
  'Observed geometry and observed response outcome are kept separate.'
);

console.log(
  'NO_OBSERVED_HIT is not labeled failure or ignored opportunity.'
);

console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);

console.log(
  'Raw .dem parsing:          NONE'
);

console.log(
  'Orb trajectory source:     tick-dense Script115'
);

console.log(
  'Player-state source:       4 Hz Script03 with labeled interpolation'
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
    ? 'FLYING_SOUL_ALL_PLAYER_DYNAMIC_GEOMETRY_READY'
    : 'FLYING_SOUL_ALL_PLAYER_DYNAMIC_GEOMETRY_REQUIRES_DIAGNOSIS';


// ============================================================
// CROSS-REPLAY DISTRIBUTIONS
// ============================================================

const distributions =
  {
    candidateRowsPerReplay:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.candidates.total
        )
      ),


    eventMapRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.coverage.eventMapRate
        )
      ),


    orbTickCoverageRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.coverage.orbTickCoverageRate
        )
      ),


    anyAliveGeometryRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.coverage.anyAliveGeometryRate
        )
      ),


    positiveHitCandidateRecoveryRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.outcomes.positiveHitCandidateRecoveryRate
        )
      ),


    positiveHitGeometryRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row.outcomes.positiveHitGeometryRate
        )
      ),


    secureMinDistance3D:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.secureMinDistance3D
        )
      ),


    denyMinDistance3D:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.denyMinDistance3D
        )
      ),


    secureMinEyeError:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.secureMinEyeError
        )
      ),


    denyMinEyeError:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions.denyMinEyeError
        )
      )
  };


// ============================================================
// INTERPRETATION
// ============================================================

const interpretation =
  {
    status,


    establishedIfPass:
      [
        'Per-player dynamic geometry during the actually observed attackable lifetime of each source-linked flying soul.',

        'Observed response outcome kept separate from antecedent geometry.',

        'Role-specific secure/deny candidate rows.',

        'Descriptive geometry during the first 5- and 6-tick priority-diagnostic windows.',

        'Candidate-level feature substrate suitable for later actionability/prediction modeling.'
      ],


    notEstablished:
      [
        'Line of sight.',

        'Exact muzzle position.',

        'Weapon readiness.',

        'Projectile flight time.',

        'Hero-specific mechanical actionability.',

        'Whether no observed hit represents omission, distraction, strategy, or impossibility.',

        'Whether a lost soul was avoidable.'
      ],


    methodologicalGain:
      'The behavioral denominator is now candidate-level rather than match-level: each row asks what geometry a specific player had while a specific flying soul actually existed and remained attackable.',


    nextStage:
      status ===
      'FLYING_SOUL_ALL_PLAYER_DYNAMIC_GEOMETRY_READY'
        ? 'ADD_WEAPON_STATE_AND_HERO_SPECIFIC_PROJECTILE_MECHANICS_BEFORE_CLASSIFYING_ACTIONABLE_OPPORTUNITIES'
        : 'DYNAMIC_GEOMETRY_DIAGNOSIS'
  };


// ============================================================
// SUMMARY
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
      script116.status,


    methodology:
      {
        replicationUnit:
          'REPLAY',

        outputUnit:
          'PLAYER_X_FLYING_SOUL_EVENT',

        rawReplayParsing:
          false,

        effectiveWindow:
          'attackableStartTick through min(nominal attackableEndTick, observed lifecycle endTick, player first successful-hit tick when applicable)',

        playerState:
          '4 Hz observed state with explicitly labeled exact/interpolated/nearest proxy reconstruction',

        orbState:
          'Script115 tick-dense moving CItemXP trajectory',

        responseOutcome:
          'OBSERVED_SUCCESSFUL_HIT or NO_OBSERVED_HIT; the latter is not failure',

        descriptiveDistanceBandsHU:
          DISTANCE_BANDS_HU,

        descriptiveAimBandsDegrees:
          AIM_ERROR_BANDS_DEG,

        descriptiveJointBands:
          JOINT_BANDS,

        securePriorityDiagnosticsTicks:
          PRIORITY_DIAGNOSTIC_TICKS
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
  'ALL-PLAYER DYNAMIC GEOMETRY CROSS-REPLAY SUMMARY'
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
    `candidates=${String(row.candidates.total).padEnd(7)} ` +
    `aliveGeom=${formatPercent(row.coverage.anyAliveGeometryRate).padEnd(8)} ` +
    `hitCand=${String(row.outcomes.observedHitCandidates).padEnd(5)} ` +
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
  `Candidates/replay:          ${formatDistribution(
    distributions.candidateRowsPerReplay
  )}`
);


console.log(
  `Event-map rate:             ${formatDistribution(
    distributions.eventMapRate
  )}`
);


console.log(
  `Orb tick coverage:          ${formatDistribution(
    distributions.orbTickCoverageRate
  )}`
);


console.log(
  `Any alive geometry rate:    ${formatDistribution(
    distributions.anyAliveGeometryRate
  )}`
);


console.log(
  `Positive-hit recovery:      ${formatDistribution(
    distributions.positiveHitCandidateRecoveryRate
  )}`
);


console.log(
  `Positive-hit geometry:      ${formatDistribution(
    distributions.positiveHitGeometryRate
  )}`
);


console.log(
  `Secure candidate min dist:  ${formatDistribution(
    distributions.secureMinDistance3D
  )}`
);


console.log(
  `Deny candidate min dist:    ${formatDistribution(
    distributions.denyMinDistance3D
  )}`
);


console.log(
  `Secure candidate min aim:   ${formatDistribution(
    distributions.secureMinEyeError
  )}`
);


console.log(
  `Deny candidate min aim:     ${formatDistribution(
    distributions.denyMinEyeError
  )}`
);


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


  const candidatePath =
    resolve(
      outputDirectory,
      'flying_soul_opportunity_existence_v01.jsonl'
    );


  const eventPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_events_v02.jsonl'
    );


  const trajectoryPath =
    resolve(
      outputDirectory,
      'flying_soul_trajectory_v01.jsonl'
    );


  const hitsPath =
    resolve(
      outputDirectory,
      'flying_soul_full_damage_hits_v01.jsonl'
    );


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const candidateOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_all_player_dynamic_geometry_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_all_player_dynamic_geometry_summary_v01.json'
    );


  for (
    const path
    of [
      candidatePath,
      eventPath,
      trajectoryPath,
      hitsPath,
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
  // LOAD EVENT / CANDIDATE / HIT SUBSTRATES
  // ----------------------------------------------------------

  const sourceCandidates =
    await loadJsonl(
      candidatePath
    );


  const events =
    await loadJsonl(
      eventPath
    );


  const trajectoryRows =
    await loadJsonl(
      trajectoryPath
    );


  const damageHits =
    await loadJsonl(
      hitsPath
    );


  // ----------------------------------------------------------
  // EVENT MAP
  // ----------------------------------------------------------

  const eventById =
    new Map();


  for (
    const event
    of events
  ) {

    if (
      event.eventId
    ) {

      eventById.set(
        event.eventId,
        event
      );
    }
  }


  // ----------------------------------------------------------
  // ORB TRAJECTORY INDEX
  // ----------------------------------------------------------

  const trajectoryByEvent =
    buildTrajectoryIndex(
      trajectoryRows
    );


  // ----------------------------------------------------------
  // OBSERVED HITS BY EVENT + PLAYER
  // ----------------------------------------------------------

  const hitsByCandidate =
    new Map();


  const observedHitCandidateKeys =
    new Set();


  for (
    const hit
    of damageHits
  ) {

    const playerName =
      hit.attackerPlayerName
      ??
      null;


    if (
      !playerName
      ||
      !hit.eventId
    ) {

      continue;
    }


    const key =
      `${hit.eventId}|${playerName}`;


    observedHitCandidateKeys.add(
      key
    );


    if (
      !hitsByCandidate.has(
        key
      )
    ) {

      hitsByCandidate.set(
        key,
        []
      );
    }


    hitsByCandidate
      .get(
        key
      )
      .push(
        hit
      );
  }


  for (
    const rows
    of hitsByCandidate.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        Number(
          a.demoTick
        )
        -
        Number(
          b.demoTick
        )
    );
  }


  // ----------------------------------------------------------
  // LOAD COMPACT PLAYER STATE FOR THIS REPLAY
  // ----------------------------------------------------------

  console.log(
    'Loading compact 4 Hz player state...'
  );


  const playerState =
    await loadCompactPlayerState(
      playerStatePath
    );


  // ----------------------------------------------------------
  // BUILD CANDIDATE-LEVEL DYNAMIC FEATURES
  // ----------------------------------------------------------

  console.log(
    'Building candidate-level attackable-window geometry...'
  );


  const outputRows =
    [];


  let sourceCandidatesWithEvent =
    0;


  let rolesResolved =
    0;


  let totalEvaluatedTicks =
    0;


  let totalOrbResolvedTicks =
    0;


  let observedHitCandidatesRecovered =
    0;


  let observedHitCandidatesWithGeometry =
    0;


  const outputCandidateKeys =
    new Set();


  for (
    const sourceCandidate
    of sourceCandidates
  ) {

    const eventId =
      sourceCandidate.eventId
      ??
      sourceCandidate
        ?.stimulus
        ?.eventId
      ??
      null;


    const playerName =
      sourceCandidate
        ?.player
        ?.playerName
      ??
      null;


    const role =
      sourceCandidate
        ?.role
        ?.type
      ??
      'ROLE_UNRESOLVED';


    if (
      !eventId
      ||
      !playerName
    ) {

      continue;
    }


    const candidateKey =
      `${eventId}|${playerName}`;


    outputCandidateKeys.add(
      candidateKey
    );


    const event =
      eventById.get(
        eventId
      )
      ??
      null;


    if (
      event
    ) {

      sourceCandidatesWithEvent++;
    }


    if (
      role ===
      'SECURE_CANDIDATE'
      ||
      role ===
      'DENY_CANDIDATE'
    ) {

      rolesResolved++;
    }


    const candidateHits =
      hitsByCandidate.get(
        candidateKey
      )
      ??
      [];


    const firstHit =
      candidateHits[0]
      ??
      null;


    const firstHitTick =
      finite(
        firstHit?.demoTick
      );


    const geometryResult =
      event
        ? evaluateCandidateGeometry({
            event,
            role,
            playerName,
            playerRows:
              playerState.byPlayer.get(
                playerName
              )
              ??
              [],
            trajectory:
              trajectoryByEvent.get(
                eventId
              )
              ??
              null,
            firstHitTick
          })
        : emptyCandidateGeometry();


    totalEvaluatedTicks +=
      geometryResult.coverage.evaluatedTicks;


    totalOrbResolvedTicks +=
      geometryResult.coverage.orbPositionTicks;


    const observedSuccessfulHit =
      candidateHits.length >
      0;


    if (
      observedSuccessfulHit
    ) {

      observedHitCandidatesRecovered++;


      if (
        geometryResult.coverage.geometryTicks >
        0
      ) {

        observedHitCandidatesWithGeometry++;
      }
    }


    outputRows.push(
      {
        schemaVersion:
          1,

        canonical:
          false,

        replay:
          replayName,

        candidateId:
          sourceCandidate.candidateId
          ??
          candidateKey,

        eventId,


        player:
          sourceCandidate.player
          ??
          {
            playerName
          },


        role:
          {
            type:
              role,

            mechanicallyResolved:
              role ===
              'SECURE_CANDIDATE'
              ||
              role ===
              'DENY_CANDIDATE'
          },


        stimulus:
          {
            orbEpisodeId:
              event?.orbEpisodeId
              ??
              sourceCandidate
                ?.stimulus
                ?.orbEpisodeId
              ??
              null,

            orbEntityIndex:
              finite(
                event?.orbEntityIndex
              )
              ??
              finite(
                sourceCandidate
                  ?.stimulus
                  ?.orbEntityIndex
              ),

            orbTeam:
              finite(
                event?.orbTeam
              )
              ??
              finite(
                sourceCandidate
                  ?.stimulus
                  ?.orbTeam
              ),

            attackableStartTick:
              geometryResult.window.attackableStartTick,

            nominalAttackableEndTick:
              geometryResult.window.nominalAttackableEndTick,

            lifecycleEndTick:
              geometryResult.window.lifecycleEndTick,

            effectiveObservedEndTick:
              geometryResult.window.effectiveObservedEndTick,

            analysisEndTick:
              geometryResult.window.analysisEndTick,

            analysisWindowTicks:
              geometryResult.window.analysisWindowTicks
          },


        observedResponseOutcome:
          {
            class:
              observedSuccessfulHit
                ? 'OBSERVED_SUCCESSFUL_HIT'
                : 'NO_OBSERVED_HIT',

            semanticGuardrail:
              observedSuccessfulHit
                ? 'Observed successful CItemXP Damage; does not reveal exact trigger-pull time.'
                : 'No observed hit is not labeled failure, omission, or ignored opportunity.',

            hitCount:
              candidateHits.length,

            firstHitTick,

            firstHitRelation:
              firstHit?.relation
              ??
              null,

            roleConcordant:
              firstHit
                ? isRoleHitConcordant(
                    role,
                    firstHit.relation
                  )
                : null
          },


        geometry:
          geometryResult,


        sourceExistenceLayer:
          {
            aliveObservedDuringExistence:
              sourceCandidate
                ?.eligibility
                ?.aliveObservedDuringExistence
              ??
              null,

            priorTier:
              sourceCandidate
                ?.eligibility
                ?.tier
              ??
              null
          },


        interpretation:
          {
            actionableOpportunityClass:
              'NOT_YET_CLASSIFIED',

            mechanicalReachabilityClass:
              'NOT_YET_CLASSIFIED',

            attentionResponseClass:
              observedSuccessfulHit
                ? 'OBSERVED_RESPONSE_OUTCOME'
                : 'UNRESOLVED_NO_OBSERVED_RESPONSE',

            warning:
              'Dynamic geometry is antecedent context. Weapon mechanics and visibility must be added before opportunity or avoidability labels are assigned.'
          }
      }
    );
  }


  // ----------------------------------------------------------
  // SORT OUTPUT
  // ----------------------------------------------------------

  outputRows.sort(
    (
      a,
      b
    ) =>
      (
        a
          .stimulus
          .attackableStartTick
        ??
        Infinity
      )
      -
      (
        b
          .stimulus
          .attackableStartTick
        ??
        Infinity
      )
      ||
      a.eventId.localeCompare(
        b.eventId
      )
      ||
      a.player.playerName.localeCompare(
        b.player.playerName
      )
  );


  // ----------------------------------------------------------
  // COVERAGE
  // ----------------------------------------------------------

  const anyAliveGeometry =
    outputRows.filter(
      row =>
        row
          .geometry
          .coverage
          .geometryTicks >
        0
    );


  const eventMapRate =
    rate(
      sourceCandidatesWithEvent,
      sourceCandidates.length
    );


  const roleResolutionRate =
    rate(
      rolesResolved,
      sourceCandidates.length
    );


  const orbTickCoverageRate =
    rate(
      totalOrbResolvedTicks,
      totalEvaluatedTicks
    );


  const anyAliveGeometryRate =
    rate(
      anyAliveGeometry.length,
      sourceCandidates.length
    );


  // ----------------------------------------------------------
  // OBSERVED HIT RECOVERY
  // ----------------------------------------------------------

  const positiveHitCandidateRecoveryRate =
    rate(
      observedHitCandidatesRecovered,
      observedHitCandidateKeys.size
    );


  const positiveHitGeometryRate =
    rate(
      observedHitCandidatesWithGeometry,
      observedHitCandidatesRecovered
    );


  const missingObservedHitCandidates =
    [
      ...observedHitCandidateKeys
    ]
      .filter(
        key =>
          !outputCandidateKeys.has(
            key
          )
      );


  // ----------------------------------------------------------
  // ROLE / OUTCOME COUNTS
  // ----------------------------------------------------------

  const secureRows =
    outputRows.filter(
      row =>
        row.role.type ===
        'SECURE_CANDIDATE'
    );


  const denyRows =
    outputRows.filter(
      row =>
        row.role.type ===
        'DENY_CANDIDATE'
    );


  const observedHitRows =
    outputRows.filter(
      row =>
        row
          .observedResponseOutcome
          .class ===
        'OBSERVED_SUCCESSFUL_HIT'
    );


  const noObservedHitRows =
    outputRows.filter(
      row =>
        row
          .observedResponseOutcome
          .class ===
        'NO_OBSERVED_HIT'
    );


  // ----------------------------------------------------------
  // GEOMETRY DISTRIBUTIONS
  // ----------------------------------------------------------

  const secureMinDistance3D =
    secureRows
      .map(
        row =>
          row
            .geometry
            .distance3D
            .min
      )
      .filter(
        Number.isFinite
      );


  const denyMinDistance3D =
    denyRows
      .map(
        row =>
          row
            .geometry
            .distance3D
            .min
      )
      .filter(
        Number.isFinite
      );


  const secureMinEyeError =
    secureRows
      .map(
        row =>
          row
            .geometry
            .eyeAngularErrorDegrees
            .min
      )
      .filter(
        Number.isFinite
      );


  const denyMinEyeError =
    denyRows
      .map(
        row =>
          row
            .geometry
            .eyeAngularErrorDegrees
            .min
      )
      .filter(
        Number.isFinite
      );


  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const checks =
    {
      candidateRowsPresent:
        {
          actual:
            sourceCandidates.length,

          expected:
            '>0',

          pass:
            sourceCandidates.length >
            0
        },


      eventMapRate:
        {
          actual:
            eventMapRate,

          expected:
            `>=${VALIDATION.minimumEventMapRate}`,

          pass:
            Number.isFinite(
              eventMapRate
            )
            &&
            eventMapRate >=
            VALIDATION.minimumEventMapRate
        },


      roleResolutionRate:
        {
          actual:
            roleResolutionRate,

          expected:
            `>=${VALIDATION.minimumRoleResolutionRate}`,

          pass:
            Number.isFinite(
              roleResolutionRate
            )
            &&
            roleResolutionRate >=
            VALIDATION.minimumRoleResolutionRate
        },


      orbTickCoverageRate:
        {
          actual:
            orbTickCoverageRate,

          expected:
            `>=${VALIDATION.minimumOrbTickCoverageRate}`,

          pass:
            Number.isFinite(
              orbTickCoverageRate
            )
            &&
            orbTickCoverageRate >=
            VALIDATION.minimumOrbTickCoverageRate
        },


      positiveHitCandidateRecoveryRate:
        {
          actual:
            positiveHitCandidateRecoveryRate,

          expected:
            `>=${VALIDATION.minimumPositiveHitCandidateRecoveryRate}`,

          pass:
            Number.isFinite(
              positiveHitCandidateRecoveryRate
            )
            &&
            positiveHitCandidateRecoveryRate >=
            VALIDATION.minimumPositiveHitCandidateRecoveryRate
        },


      positiveHitGeometryRate:
        {
          actual:
            positiveHitGeometryRate,

          expected:
            `>=${VALIDATION.minimumPositiveHitGeometryRate}`,

          pass:
            Number.isFinite(
              positiveHitGeometryRate
            )
            &&
            positiveHitGeometryRate >=
            VALIDATION.minimumPositiveHitGeometryRate
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
          sourceCandidates:
            sourceCandidates.length,

          temporalEvents:
            events.length,

          trajectoryRows:
            trajectoryRows.length,

          damageMessages:
            damageHits.length,

          uniqueObservedHitCandidates:
            observedHitCandidateKeys.size,

          playerStateRows:
            playerState.rowsParsed,

          playersInState:
            playerState.byPlayer.size
        },


      candidates:
        {
          total:
            outputRows.length,

          secure:
            secureRows.length,

          deny:
            denyRows.length,

          unresolvedRole:
            outputRows.length -
            secureRows.length -
            denyRows.length,

          withAnyAliveGeometry:
            anyAliveGeometry.length
        },


      outcomes:
        {
          observedHitCandidates:
            observedHitRows.length,

          noObservedHitCandidates:
            noObservedHitRows.length,

          uniqueInputHitCandidates:
            observedHitCandidateKeys.size,

          observedHitCandidatesRecovered,

          positiveHitCandidateRecoveryRate,

          observedHitCandidatesWithGeometry,

          positiveHitGeometryRate,

          missingObservedHitCandidates,

          semanticGuardrail:
            'NO_OBSERVED_HIT is not interpreted as failure or omission.'
        },


      coverage:
        {
          sourceCandidatesWithEvent,

          eventMapRate,

          rolesResolved,

          roleResolutionRate,

          evaluatedTicks:
            totalEvaluatedTicks,

          orbPositionTicks:
            totalOrbResolvedTicks,

          orbTickCoverageRate,

          anyAliveGeometryCandidates:
            anyAliveGeometry.length,

          anyAliveGeometryRate
        },


      reconstructionMethods:
        mergeCountObjects(
          outputRows.map(
            row =>
              row
                .geometry
                .stateMethodCounts
          )
        ),


      geometry:
        {
          secure:
            summarizeCandidateGeometry(
              secureRows
            ),

          deny:
            summarizeCandidateGeometry(
              denyRows
            ),

          observedHit:
            summarizeCandidateGeometry(
              observedHitRows
            ),

          noObservedHit:
            summarizeCandidateGeometry(
              noObservedHitRows
            ),

          warning:
            'These distributions describe geometry exposure only and are not mechanical opportunity thresholds.'
        },


      validation:
        {
          pass,

          checks
        },


      rawDistributions:
        {
          secureMinDistance3D,

          denyMinDistance3D,

          secureMinEyeError,

          denyMinEyeError
        },


      outputs:
        {
          candidates:
            candidateOutputPath,

          summary:
            replaySummaryPath
        }
    };


  // ----------------------------------------------------------
  // WRITE
  // ----------------------------------------------------------

  await writeJsonl(
    candidateOutputPath,
    outputRows
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
// EVALUATE ONE PLAYER x ORB CANDIDATE
// ============================================================

function evaluateCandidateGeometry({

  event,

  role,

  playerName,

  playerRows,

  trajectory,

  firstHitTick
}) {

  const attackableStartTick =
    finite(
      event
        ?.temporal
        ?.attackableStartTick
    );


  const nominalAttackableEndTick =
    finite(
      event
        ?.temporal
        ?.attackableEndTick
    );


  const lifecycleEndTick =
    finite(
      event.endTick
    );


  const effectiveObservedEndTick =
    minimumFinite(
      [
        nominalAttackableEndTick,
        lifecycleEndTick
      ]
    );


  const analysisEndTick =
    minimumFinite(
      [
        effectiveObservedEndTick,
        firstHitTick
      ]
    );


  if (
    attackableStartTick ===
    null
    ||
    analysisEndTick ===
    null
    ||
    analysisEndTick <
    attackableStartTick
  ) {

    return emptyCandidateGeometry({
      attackableStartTick,
      nominalAttackableEndTick,
      lifecycleEndTick,
      effectiveObservedEndTick,
      analysisEndTick
    });
  }


  const distanceXYValues =
    [];


  const distance3DValues =
    [];


  const eyeErrorValues =
    [];


  const yawErrorValues =
    [];


  const pitchErrorValues =
    [];


  const stateMethodCounts =
    {};


  const distanceBands =
    initializeBandTracker(
      DISTANCE_BANDS_HU,
      'HU'
    );


  const aimBands =
    initializeBandTracker(
      AIM_ERROR_BANDS_DEG,
      'DEG'
    );


  const jointBands =
    initializeJointBandTracker(
      JOINT_BANDS
    );


  const priorityWindows =
    {};


  for (
    const ticks
    of PRIORITY_DIAGNOSTIC_TICKS
  ) {

    priorityWindows[
      String(
        ticks
      )
    ] =
      createWindowAccumulator();
  }


  let evaluatedTicks =
    0;


  let orbPositionTicks =
    0;


  let stateResolvedTicks =
    0;


  let aliveTicks =
    0;


  let geometryTicks =
    0;


  let eyeGeometryTicks =
    0;


  let firstAliveTick =
    null;


  let firstGeometryTick =
    null;


  let firstEyeGeometryTick =
    null;


  let firstGeometrySnapshot =
    null;


  let minimumDistanceSnapshot =
    null;


  let minimumEyeErrorSnapshot =
    null;


  for (
    let tick =
      attackableStartTick;

    tick <=
      analysisEndTick;

    tick++
  ) {

    evaluatedTicks++;


    const orbObservation =
      resolveOrbPositionAtTick({
        trajectory,
        tick
      });


    if (
      orbObservation.position
    ) {

      orbPositionTicks++;
    }


    const stateObservation =
      reconstructPlayerStateAtTick({
        rows:
          playerRows,
        tick
      });


    incrementObjectCount(
      stateMethodCounts,
      stateObservation.method
    );


    if (
      stateObservation.stateResolved
    ) {

      stateResolvedTicks++;
    }


    if (
      stateObservation.alive !==
      true
    ) {

      continue;
    }


    aliveTicks++;


    if (
      firstAliveTick ===
      null
    ) {

      firstAliveTick =
        tick;
    }


    const geometry =
      buildGeometry({
        playerPosition:
          stateObservation.position,
        orbPosition:
          orbObservation.position,
        eyeAngles:
          stateObservation.eyeAngles
      });


    if (
      !Number.isFinite(
        geometry.distance3D
      )
    ) {

      continue;
    }


    geometryTicks++;


    if (
      firstGeometryTick ===
      null
    ) {

      firstGeometryTick =
        tick;


      firstGeometrySnapshot =
        compactGeometrySnapshot({
          tick,
          attackableStartTick,
          geometry,
          stateObservation,
          orbObservation
        });
    }


    distanceXYValues.push(
      geometry.distanceXY
    );


    distance3DValues.push(
      geometry.distance3D
    );


    updateBandTracker(
      distanceBands,
      geometry.distance3D,
      tick,
      attackableStartTick
    );


    if (
      !minimumDistanceSnapshot
      ||
      geometry.distance3D <
      minimumDistanceSnapshot.distance3D
    ) {

      minimumDistanceSnapshot =
        compactGeometrySnapshot({
          tick,
          attackableStartTick,
          geometry,
          stateObservation,
          orbObservation
        });
    }


    if (
      Number.isFinite(
        geometry.eyeAngularErrorDegrees
      )
    ) {

      eyeGeometryTicks++;


      if (
        firstEyeGeometryTick ===
        null
      ) {

        firstEyeGeometryTick =
          tick;
      }


      eyeErrorValues.push(
        geometry.eyeAngularErrorDegrees
      );


      yawErrorValues.push(
        geometry.yawErrorDegrees
      );


      pitchErrorValues.push(
        geometry.pitchErrorDegrees
      );


      updateBandTracker(
        aimBands,
        geometry.eyeAngularErrorDegrees,
        tick,
        attackableStartTick
      );


      updateJointBandTracker(
        jointBands,
        geometry.distance3D,
        geometry.eyeAngularErrorDegrees,
        tick,
        attackableStartTick
      );


      if (
        !minimumEyeErrorSnapshot
        ||
        geometry.eyeAngularErrorDegrees <
        minimumEyeErrorSnapshot.eyeAngularErrorDegrees
      ) {

        minimumEyeErrorSnapshot =
          compactGeometrySnapshot({
            tick,
            attackableStartTick,
            geometry,
            stateObservation,
            orbObservation
          });
      }
    }


    // --------------------------------------------------------
    // ROLE-SPECIFIC PRIORITY-DIAGNOSTIC WINDOW GEOMETRY
    //
    // Same clock window is summarized for both roles. The role
    // semantics remain separate and no exclusive lockout is
    // asserted.
    // --------------------------------------------------------

    const offset =
      tick -
      attackableStartTick;


    for (
      const diagnosticTicks
      of PRIORITY_DIAGNOSTIC_TICKS
    ) {

      if (
        offset <=
        diagnosticTicks
      ) {

        updateWindowAccumulator(
          priorityWindows[
            String(
              diagnosticTicks
            )
          ],
          geometry
        );
      }
    }
  }


  // ----------------------------------------------------------
  // FINALIZE BAND FRACTIONS
  // ----------------------------------------------------------

  finalizeBandTracker(
    distanceBands,
    geometryTicks
  );


  finalizeBandTracker(
    aimBands,
    eyeGeometryTicks
  );


  finalizeJointBandTracker(
    jointBands,
    eyeGeometryTicks
  );


  const finalizedPriorityWindows =
    {};


  for (
    const diagnosticTicks
    of PRIORITY_DIAGNOSTIC_TICKS
  ) {

    finalizedPriorityWindows[
      String(
        diagnosticTicks
      )
    ] =
      finalizeWindowAccumulator(
        priorityWindows[
          String(
            diagnosticTicks
          )
        ],
        role,
        diagnosticTicks
      );
  }


  return {
    window:
      {
        attackableStartTick,

        nominalAttackableEndTick,

        lifecycleEndTick,

        effectiveObservedEndTick,

        analysisEndTick,

        analysisWindowTicks:
          analysisEndTick -
          attackableStartTick +
          1,

        censoredAtPlayerFirstHit:
          firstHitTick !==
          null
          &&
          analysisEndTick ===
          firstHitTick,

        role
      },


    coverage:
      {
        evaluatedTicks,

        orbPositionTicks,

        orbPositionTickRate:
          rate(
            orbPositionTicks,
            evaluatedTicks
          ),

        stateResolvedTicks,

        stateResolvedTickRate:
          rate(
            stateResolvedTicks,
            evaluatedTicks
          ),

        aliveTicks,

        aliveTickRate:
          rate(
            aliveTicks,
            evaluatedTicks
          ),

        geometryTicks,

        geometryTickRate:
          rate(
            geometryTicks,
            evaluatedTicks
          ),

        eyeGeometryTicks,

        eyeGeometryTickRate:
          rate(
            eyeGeometryTicks,
            evaluatedTicks
          ),

        firstAliveTick,

        firstGeometryTick,

        firstEyeGeometryTick
      },


    distanceXY:
      summarizeNumbers(
        distanceXYValues
      ),


    distance3D:
      summarizeNumbers(
        distance3DValues
      ),


    eyeAngularErrorDegrees:
      summarizeNumbers(
        eyeErrorValues
      ),


    yawErrorDegrees:
      summarizeNumbers(
        yawErrorValues
      ),


    pitchErrorDegrees:
      summarizeNumbers(
        pitchErrorValues
      ),


    descriptiveBands:
      {
        distance:
          distanceBands,

        eyeError:
          aimBands,

        joint:
          jointBands,

        semanticStatus:
          'FEATURE_BANDS_ONLY_NOT_OPPORTUNITY_THRESHOLDS'
      },


    priorityDiagnosticWindows:
      finalizedPriorityWindows,


    snapshots:
      {
        firstGeometry:
          firstGeometrySnapshot,

        minimumDistance:
          minimumDistanceSnapshot,

        minimumEyeError:
          minimumEyeErrorSnapshot
      },


    stateMethodCounts,


    semanticStatus:
      geometryTicks >
      0
        ? 'DYNAMIC_GEOMETRY_OBSERVED_OR_INTERPOLATED'
        : 'NO_ALIVE_GEOMETRY_RESOLVED'
  };
}


// ============================================================
// EMPTY CANDIDATE GEOMETRY
// ============================================================

function emptyCandidateGeometry(
  window =
    {}
) {

  return {
    window:
      {
        attackableStartTick:
          window.attackableStartTick
          ??
          null,

        nominalAttackableEndTick:
          window.nominalAttackableEndTick
          ??
          null,

        lifecycleEndTick:
          window.lifecycleEndTick
          ??
          null,

        effectiveObservedEndTick:
          window.effectiveObservedEndTick
          ??
          null,

        analysisEndTick:
          window.analysisEndTick
          ??
          null,

        analysisWindowTicks:
          0,

        censoredAtPlayerFirstHit:
          false,

        role:
          null
      },

    coverage:
      {
        evaluatedTicks:
          0,

        orbPositionTicks:
          0,

        orbPositionTickRate:
          null,

        stateResolvedTicks:
          0,

        stateResolvedTickRate:
          null,

        aliveTicks:
          0,

        aliveTickRate:
          null,

        geometryTicks:
          0,

        geometryTickRate:
          null,

        eyeGeometryTicks:
          0,

        eyeGeometryTickRate:
          null,

        firstAliveTick:
          null,

        firstGeometryTick:
          null,

        firstEyeGeometryTick:
          null
      },

    distanceXY:
      summarizeNumbers(
        []
      ),

    distance3D:
      summarizeNumbers(
        []
      ),

    eyeAngularErrorDegrees:
      summarizeNumbers(
        []
      ),

    yawErrorDegrees:
      summarizeNumbers(
        []
      ),

    pitchErrorDegrees:
      summarizeNumbers(
        []
      ),

    descriptiveBands:
      {
        distance:
          initializeBandTracker(
            DISTANCE_BANDS_HU,
            'HU'
          ),

        eyeError:
          initializeBandTracker(
            AIM_ERROR_BANDS_DEG,
            'DEG'
          ),

        joint:
          initializeJointBandTracker(
            JOINT_BANDS
          ),

        semanticStatus:
          'FEATURE_BANDS_ONLY_NOT_OPPORTUNITY_THRESHOLDS'
      },

    priorityDiagnosticWindows:
      {},

    snapshots:
      {
        firstGeometry:
          null,

        minimumDistance:
          null,

        minimumEyeError:
          null
      },

    stateMethodCounts:
      {},

    semanticStatus:
      'NO_VALID_ANALYSIS_WINDOW'
  };
}


// ============================================================
// COMPACT GEOMETRY SNAPSHOT
// ============================================================

function compactGeometrySnapshot({

  tick,

  attackableStartTick,

  geometry,

  stateObservation,

  orbObservation
}) {

  return {
    tick,

    ticksAfterAttackableStart:
      tick -
      attackableStartTick,

    secondsAfterAttackableStart:
      (
        tick -
        attackableStartTick
      )
      /
      TICK_RATE,

    distanceXY:
      geometry.distanceXY,

    distance3D:
      geometry.distance3D,

    eyeAngularErrorDegrees:
      geometry.eyeAngularErrorDegrees,

    yawErrorDegrees:
      geometry.yawErrorDegrees,

    pitchErrorDegrees:
      geometry.pitchErrorDegrees,

    playerPosition:
      stateObservation.position,

    orbPosition:
      orbObservation.position,

    stateMethod:
      stateObservation.method,

    orbMethod:
      orbObservation.method
  };
}


// ============================================================
// DESCRIPTIVE BAND TRACKERS
// ============================================================

function initializeBandTracker(
  thresholds,
  unit
) {

  const output =
    {};


  for (
    const threshold
    of thresholds
  ) {

    output[
      String(
        threshold
      )
    ] =
      {
        threshold,

        unit,

        ticks:
          0,

        fractionOfResolvedGeometryTicks:
          null,

        firstTick:
          null,

        firstTicksAfterAttackableStart:
          null
      };
  }


  return output;
}


function updateBandTracker(
  tracker,
  value,
  tick,
  attackableStartTick
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return;
  }


  for (
    const row
    of Object.values(
      tracker
    )
  ) {

    if (
      value <=
      row.threshold
    ) {

      row.ticks++;


      if (
        row.firstTick ===
        null
      ) {

        row.firstTick =
          tick;


        row.firstTicksAfterAttackableStart =
          tick -
          attackableStartTick;
      }
    }
  }
}


function finalizeBandTracker(
  tracker,
  denominator
) {

  for (
    const row
    of Object.values(
      tracker
    )
  ) {

    row.fractionOfResolvedGeometryTicks =
      rate(
        row.ticks,
        denominator
      );
  }
}


function initializeJointBandTracker(
  bands
) {

  const output =
    {};


  for (
    const band
    of bands
  ) {

    output[
      band.name
    ] =
      {
        name:
          band.name,

        distanceHU:
          band.distanceHU,

        aimDeg:
          band.aimDeg,

        ticks:
          0,

        fractionOfResolvedEyeGeometryTicks:
          null,

        firstTick:
          null,

        firstTicksAfterAttackableStart:
          null
      };
  }


  return output;
}


function updateJointBandTracker(
  tracker,
  distance3D,
  eyeError,
  tick,
  attackableStartTick
) {

  if (
    !Number.isFinite(
      distance3D
    )
    ||
    !Number.isFinite(
      eyeError
    )
  ) {

    return;
  }


  for (
    const row
    of Object.values(
      tracker
    )
  ) {

    if (
      distance3D <=
      row.distanceHU
      &&
      eyeError <=
      row.aimDeg
    ) {

      row.ticks++;


      if (
        row.firstTick ===
        null
      ) {

        row.firstTick =
          tick;


        row.firstTicksAfterAttackableStart =
          tick -
          attackableStartTick;
      }
    }
  }
}


function finalizeJointBandTracker(
  tracker,
  denominator
) {

  for (
    const row
    of Object.values(
      tracker
    )
  ) {

    row.fractionOfResolvedEyeGeometryTicks =
      rate(
        row.ticks,
        denominator
      );
  }
}


// ============================================================
// PRIORITY-DIAGNOSTIC WINDOW ACCUMULATOR
// ============================================================

function createWindowAccumulator() {

  return {
    geometryTicks:
      0,

    eyeGeometryTicks:
      0,

    distance3D:
      [],

    eyeError:
      []
  };
}


function updateWindowAccumulator(
  accumulator,
  geometry
) {

  if (
    Number.isFinite(
      geometry.distance3D
    )
  ) {

    accumulator.geometryTicks++;


    accumulator.distance3D.push(
      geometry.distance3D
    );
  }


  if (
    Number.isFinite(
      geometry.eyeAngularErrorDegrees
    )
  ) {

    accumulator.eyeGeometryTicks++;


    accumulator.eyeError.push(
      geometry.eyeAngularErrorDegrees
    );
  }
}


function finalizeWindowAccumulator(
  accumulator,
  role,
  ticks
) {

  return {
    diagnosticTicks:
      ticks,

    diagnosticMilliseconds:
      ticks /
      TICK_RATE *
      1000,

    role,

    semanticStatus:
      role ===
      'SECURE_CANDIDATE'
        ? 'SECURE_PRIORITY_PRIOR_WINDOW_GEOMETRY_ONLY'
        : role ===
          'DENY_CANDIDATE'
          ? 'DENY_SIDE_GEOMETRY_DURING_SECURE_PRIORITY_PRIOR_WINDOW_ONLY'
          : 'ROLE_UNRESOLVED',

    geometryTicks:
      accumulator.geometryTicks,

    eyeGeometryTicks:
      accumulator.eyeGeometryTicks,

    distance3D:
      summarizeNumbers(
        accumulator.distance3D
      ),

    eyeAngularErrorDegrees:
      summarizeNumbers(
        accumulator.eyeError
      ),

    caution:
      'This window is a documented-prior diagnostic. It is not asserted to be an exclusive deny lockout.'
  };
}


// ============================================================
// TRAJECTORY INDEX
// ============================================================

function buildTrajectoryIndex(
  rows
) {

  const result =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      !row.eventId
    ) {

      continue;
    }


    if (
      !result.has(
        row.eventId
      )
    ) {

      result.set(
        row.eventId,
        {
          byTick:
            new Map(),

          ticks:
            []
        }
      );
    }


    const tick =
      finite(
        row.tick
      );


    const position =
      normalizePosition(
        row.position
      );


    if (
      tick ===
      null
      ||
      !position
    ) {

      continue;
    }


    const target =
      result.get(
        row.eventId
      );


    target.byTick.set(
      tick,
      position
    );
  }


  for (
    const target
    of result.values()
  ) {

    target.ticks =
      [
        ...target.byTick.keys()
      ].sort(
        (
          a,
          b
        ) =>
          a -
          b
      );
  }


  return result;
}


function resolveOrbPositionAtTick({

  trajectory,

  tick
}) {

  if (
    !trajectory
  ) {

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
        null
    };
  }


  const exact =
    trajectory.byTick.get(
      tick
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
        tick,

      observedOffsetTicks:
        0,

      position:
        exact
    };
  }


  const nearestTick =
    nearestSortedValue(
      trajectory.ticks,
      tick
    );


  if (
    nearestTick !==
    null
    &&
    Math.abs(
      nearestTick -
      tick
    ) <=
    MAX_NEAREST_ORB_OFFSET_TICKS
  ) {

    return {
      method:
        'NEAREST_TRAJECTORY_TICK',

      targetTick:
        tick,

      observedTick:
        nearestTick,

      observedOffsetTicks:
        nearestTick -
        tick,

      position:
        trajectory.byTick.get(
          nearestTick
        )
        ??
        null
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
      null
  };
}


// ============================================================
// LOAD COMPACT PLAYER STATE
// ============================================================

async function loadCompactPlayerState(
  path
) {

  const byPlayer =
    new Map();


  let rowsParsed =
    0;


  let parseFailures =
    0;


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

      parseFailures++;

      continue;
    }


    rowsParsed++;


    const compact =
      compactPlayerState(
        row
      );


    if (
      !compact.playerName
      ||
      compact.tick ===
      null
    ) {

      continue;
    }


    if (
      !byPlayer.has(
        compact.playerName
      )
    ) {

      byPlayer.set(
        compact.playerName,
        []
      );
    }


    byPlayer
      .get(
        compact.playerName
      )
      .push(
        compact
      );
  }


  for (
    const rows
    of byPlayer.values()
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

    parseFailures,

    byPlayer
  };
}


function compactPlayerState(
  row
) {

  const alive =
    row
      ?.controller
      ?.alive ===
    true;


  const lifeState =
    finite(
      row
        ?.pawn
        ?.lifeState
    );


  const positionValid =
    row
      ?.pawn
      ?.positionValidForMovement ===
    true
    &&
    alive
    &&
    (
      lifeState ===
      null
      ||
      lifeState ===
      0
    );


  return {
    tick:
      finite(
        row.demoTick
      ),

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

    alive,

    lifeState,

    position:
      positionValid
        ? normalizePosition(
            row
              ?.pawn
              ?.positionWorld
          )
        : null,

    eyeAngles:
      normalizeAngles(
        row
          ?.pawn
          ?.eyeAngles
      )
  };
}


// ============================================================
// RECONSTRUCT PLAYER STATE AT TICK
// ============================================================

function reconstructPlayerStateAtTick({

  rows,

  tick
}) {

  if (
    rows.length ===
    0
  ) {

    return unresolvedPlayerState(
      tick
    );
  }


  const index =
    lowerBoundByTick(
      rows,
      tick
    );


  const after =
    index <
    rows.length
      ? rows[index]
      : null;


  const before =
    index >
    0
      ? rows[index - 1]
      : null;


  if (
    after
    &&
    after.tick ===
    tick
  ) {

    return {
      method:
        'EXACT_4HZ_SAMPLE',

      stateResolved:
        true,

      targetTick:
        tick,

      beforeTick:
        tick,

      afterTick:
        tick,

      nearestObservedTick:
        tick,

      nearestObservedOffsetTicks:
        0,

      interpolationAlpha:
        0,

      alive:
        after.alive,

      team:
        after.team,

      heroId:
        after.heroId,

      pawnEntityIndex:
        after.pawnEntityIndex,

      position:
        after.position,

      eyeAngles:
        after.eyeAngles
    };
  }


  // ----------------------------------------------------------
  // ADJACENT BRACKET
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
  ) {

    // If alive-state changes between the two observed samples,
    // exact transition timing is unresolved. Do not interpolate
    // a position/aim through a death/respawn transition.
    if (
      before.alive !==
      after.alive
    ) {

      const nearest =
        chooseNearestState(
          before,
          after,
          tick
        );


      return {
        ...unresolvedPlayerState(
          tick
        ),

        method:
          'ALIVE_STATE_TRANSITION_UNRESOLVED',

        beforeTick:
          before.tick,

        afterTick:
          after.tick,

        nearestObservedTick:
          nearest?.tick
          ??
          null,

        nearestObservedOffsetTicks:
          nearest
            ? nearest.tick -
              tick
            : null
      };
    }


    // Both observed dead.
    if (
      before.alive ===
      false
      &&
      after.alive ===
      false
    ) {

      const nearest =
        chooseNearestState(
          before,
          after,
          tick
        );


      return {
        method:
          'BRACKET_DEAD_4HZ',

        stateResolved:
          true,

        targetTick:
          tick,

        beforeTick:
          before.tick,

        afterTick:
          after.tick,

        nearestObservedTick:
          nearest.tick,

        nearestObservedOffsetTicks:
          nearest.tick -
          tick,

        interpolationAlpha:
          null,

        alive:
          false,

        team:
          nearest.team,

        heroId:
          nearest.heroId,

        pawnEntityIndex:
          nearest.pawnEntityIndex,

        position:
          null,

        eyeAngles:
          null
      };
    }


    // Both observed alive -> interpolate continuous geometry.
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


    const nearest =
      chooseNearestState(
        before,
        after,
        tick
      );


    return {
      method:
        'BRACKET_INTERPOLATED_4HZ',

      stateResolved:
        true,

      targetTick:
        tick,

      beforeTick:
        before.tick,

      afterTick:
        after.tick,

      nearestObservedTick:
        nearest.tick,

      nearestObservedOffsetTicks:
        nearest.tick -
        tick,

      interpolationAlpha:
        alpha,

      alive:
        true,

      team:
        nearest.team
        ??
        before.team
        ??
        after.team
        ??
        null,

      heroId:
        nearest.heroId
        ??
        before.heroId
        ??
        after.heroId
        ??
        null,

      pawnEntityIndex:
        nearest.pawnEntityIndex
        ??
        before.pawnEntityIndex
        ??
        after.pawnEntityIndex
        ??
        null,

      position:
        before.position
        &&
        after.position
          ? interpolatePosition(
              before.position,
              after.position,
              alpha
            )
          : null,

      eyeAngles:
        before.eyeAngles
        &&
        after.eyeAngles
          ? interpolateAngles(
              before.eyeAngles,
              after.eyeAngles,
              alpha
            )
          : null
    };
  }


  // ----------------------------------------------------------
  // NEAREST ONE-SIDED PROXY
  // ----------------------------------------------------------

  const nearest =
    chooseNearestState(
      before,
      after,
      tick
    );


  if (
    nearest
    &&
    Math.abs(
      nearest.tick -
      tick
    ) <=
    MAX_NEAREST_STATE_OFFSET_TICKS
  ) {

    return {
      method:
        nearest.tick <
        tick
          ? 'NEAREST_BEFORE_4HZ_PROXY'
          : 'NEAREST_AFTER_4HZ_PROXY',

      stateResolved:
        true,

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

      nearestObservedOffsetTicks:
        nearest.tick -
        tick,

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
        nearest.alive
          ? nearest.position
          : null,

      eyeAngles:
        nearest.alive
          ? nearest.eyeAngles
          : null
    };
  }


  return unresolvedPlayerState(
    tick
  );
}


function unresolvedPlayerState(
  tick
) {

  return {
    method:
      'UNRESOLVED',

    stateResolved:
      false,

    targetTick:
      tick,

    beforeTick:
      null,

    afterTick:
      null,

    nearestObservedTick:
      null,

    nearestObservedOffsetTicks:
      null,

    interpolationAlpha:
      null,

    alive:
      null,

    team:
      null,

    heroId:
      null,

    pawnEntityIndex:
      null,

    position:
      null,

    eyeAngles:
      null
  };
}


function lowerBoundByTick(
  rows,
  target
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
        )
        /
        2
      );


    if (
      rows[mid].tick <
      target
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


  return Math.abs(
    tick -
    before.tick
  ) <=
  Math.abs(
    after.tick -
    tick
  )
    ? before
    : after;
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
    distanceXY,

    distance3D,

    requiredYawDegrees,

    requiredEyePitchDegrees,

    eyePitchDegrees,

    eyeYawDegrees,

    yawErrorDegrees,

    pitchErrorDegrees,

    eyeAngularErrorDegrees
  };
}


function emptyGeometry() {

  return {
    distanceXY:
      null,

    distance3D:
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
      null
  };
}


// ============================================================
// CANDIDATE SUMMARY HELPERS
// ============================================================

function summarizeCandidateGeometry(
  rows
) {

  return {
    candidates:
      rows.length,

    withGeometry:
      rows.filter(
        row =>
          row
            .geometry
            .coverage
            .geometryTicks >
          0
      ).length,

    minimumDistance3D:
      summarizeNumbers(
        rows
          .map(
            row =>
              row
                .geometry
                .distance3D
                .min
          )
          .filter(
            Number.isFinite
          )
      ),

    medianDistance3D:
      summarizeNumbers(
        rows
          .map(
            row =>
              row
                .geometry
                .distance3D
                .median
          )
          .filter(
            Number.isFinite
          )
      ),

    minimumEyeAngularError:
      summarizeNumbers(
        rows
          .map(
            row =>
              row
                .geometry
                .eyeAngularErrorDegrees
                .min
          )
          .filter(
            Number.isFinite
          )
      ),

    medianEyeAngularError:
      summarizeNumbers(
        rows
          .map(
            row =>
              row
                .geometry
                .eyeAngularErrorDegrees
                .median
          )
          .filter(
            Number.isFinite
          )
      ),

    aliveTickFraction:
      summarizeNumbers(
        rows
          .map(
            row =>
              row
                .geometry
                .coverage
                .aliveTickRate
          )
          .filter(
            Number.isFinite
          )
      )
  };
}


function isRoleHitConcordant(
  role,
  hitRelation
) {

  return (
    role ===
    'SECURE_CANDIDATE'
    &&
    hitRelation ===
    'SECURE_HIT'
  )
  ||
  (
    role ===
    'DENY_CANDIDATE'
    &&
    hitRelation ===
    'DENY_HIT'
  );
}


// ============================================================
// ANGLE / POSITION INTERPOLATION
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
      z
      ??
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
// SORTED VALUE HELPERS
// ============================================================

function nearestSortedValue(
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
        )
        /
        2
      );


    const value =
      sorted[mid];


    if (
      value ===
      target
    ) {

      return value;
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


  const lower =
    high >=
    0
      ? sorted[high]
      : null;


  const upper =
    low <
    sorted.length
      ? sorted[low]
      : null;


  if (
    lower ===
    null
  ) {

    return upper;
  }


  if (
    upper ===
    null
  ) {

    return lower;
  }


  return Math.abs(
    target -
    lower
  ) <=
  Math.abs(
    upper -
    target
  )
    ? lower
    : upper;
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

function incrementObjectCount(
  object,
  key
) {

  const normalized =
    String(
      key
      ??
      'UNKNOWN'
    );


  object[normalized] =
    (
      object[normalized]
      ??
      0
    )
    +
    1;
}


function mergeCountObjects(
  objects
) {

  const result =
    {};


  for (
    const object
    of objects
  ) {

    for (
      const [
        key,
        value
      ]
      of Object.entries(
        object
        ??
        {}
      )
    ) {

      result[key] =
        (
          result[key]
          ??
          0
        )
        +
        value;
    }
  }


  return Object.fromEntries(
    Object.entries(
      result
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


function minimumFinite(
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


  return Math.min(
    ...clean
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
    'CANDIDATE DATASET'
  );


  console.log(
    `  candidate rows:             ${row.candidates.total}`
  );


  console.log(
    `  secure:                     ${row.candidates.secure}`
  );


  console.log(
    `  deny:                       ${row.candidates.deny}`
  );


  console.log(
    `  with alive geometry:        ${row.candidates.withAnyAliveGeometry}/${row.candidates.total} (${formatPercent(
      row.coverage.anyAliveGeometryRate
    )})`
  );


  console.log('');

  console.log(
    'OBSERVED RESPONSE OUTCOME'
  );


  console.log(
    `  successful-hit candidates:  ${row.outcomes.observedHitCandidates}`
  );


  console.log(
    `  no observed hit:            ${row.outcomes.noObservedHitCandidates}`
  );


  console.log(
    `  hit-candidate recovery:     ${row.outcomes.observedHitCandidatesRecovered}/${row.outcomes.uniqueInputHitCandidates} (${formatPercent(
      row.outcomes.positiveHitCandidateRecoveryRate
    )})`
  );


  console.log(
    `  positive-hit geometry:      ${row.outcomes.observedHitCandidatesWithGeometry}/${row.outcomes.observedHitCandidatesRecovered} (${formatPercent(
      row.outcomes.positiveHitGeometryRate
    )})`
  );


  console.log('');

  console.log(
    'GEOMETRY COVERAGE'
  );


  console.log(
    `  event map:                  ${formatPercent(
      row.coverage.eventMapRate
    )}`
  );


  console.log(
    `  orb ticks resolved:         ${row.coverage.orbPositionTicks}/${row.coverage.evaluatedTicks} (${formatPercent(
      row.coverage.orbTickCoverageRate
    )})`
  );


  console.log('');

  console.log(
    'CANDIDATE MINIMUM GEOMETRY'
  );


  console.log(
    `  secure min dist median:     ${formatNumber(
      row.geometry.secure.minimumDistance3D.median
    )} HU`
  );


  console.log(
    `  deny min dist median:       ${formatNumber(
      row.geometry.deny.minimumDistance3D.median
    )} HU`
  );


  console.log(
    `  secure min aim median:      ${formatNumber(
      row.geometry.secure.minimumEyeAngularError.median
    )} deg`
  );


  console.log(
    `  deny min aim median:        ${formatNumber(
      row.geometry.deny.minimumEyeAngularError.median
    )} deg`
  );


  console.log('');

  console.log(
    'STATE RECONSTRUCTION METHODS'
  );


  console.log(
    `  ${JSON.stringify(
      row.reconstructionMethods
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
    '# All-Player Flying-Soul Dynamic Geometry'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Behavioral unit'
  );


  lines.push('');


  lines.push(
    'One row represents one specific player in relation to one specific source-linked flying soul.'
  );


  lines.push('');


  lines.push(
    'The row summarizes dynamic player-to-orb geometry across the soul’s actually observed attackable lifetime.'
  );


  lines.push('');


  lines.push(
    '## Critical outcome distinction'
  );


  lines.push('');


  lines.push(
    '`NO_OBSERVED_HIT` means only that this player did not produce an observed successful CItemXP Damage message. It is **not** classified as failure, omission, inattention, or an ignored opportunity.'
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
      `- Candidate rows: ${replay.candidates.total}`
    );


    lines.push(
      `- Secure candidates: ${replay.candidates.secure}`
    );


    lines.push(
      `- Deny candidates: ${replay.candidates.deny}`
    );


    lines.push(
      `- Candidates with any alive geometry: ${formatPercent(replay.coverage.anyAliveGeometryRate)}`
    );


    lines.push(
      `- Orb tick coverage: ${formatPercent(replay.coverage.orbTickCoverageRate)}`
    );


    lines.push(
      `- Observed successful-hit candidates: ${replay.outcomes.observedHitCandidates}`
    );


    lines.push(
      `- Positive-hit candidate recovery: ${formatPercent(replay.outcomes.positiveHitCandidateRecoveryRate)}`
    );


    lines.push(
      `- Positive-hit geometry coverage: ${formatPercent(replay.outcomes.positiveHitGeometryRate)}`
    );


    lines.push(
      `- Validation: **${replay.validation.pass ? 'PASS' : 'FAIL'}**`
    );


    lines.push('');
  }


  lines.push(
    '## Feature semantics'
  );


  lines.push('');


  lines.push(
    'Distance, eye-angle, and joint bands are descriptive feature bins only. They are not validated opportunity thresholds.'
  );


  lines.push('');


  lines.push(
    'The 5- and 6-tick early windows preserve the documented securing-side priority prior as a diagnostic clock interval without asserting that deny-side Damage is physically impossible during that interval.'
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