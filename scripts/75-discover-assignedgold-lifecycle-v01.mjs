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


const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// OBSERVATIONAL PURPOSE
//
// We are deliberately NOT assuming:
//
//   - AssignedGold activation == vacuum
//   - m_hVacuumTarget == killer
//   - disappearance == collection
//   - disappearance == expiration
//   - movement == acquisition
//
// The goal of Script 75 is to discover lifecycle signatures.
//
// Working gameplay hypothesis to investigate:
//
//   player last-hits Trooper
//        |
//        v
//   ground soul exists
//        |
//        +-- credited player nearby
//        |       -> immediate vacuum candidate
//        |
//        +-- credited player far away
//                -> floor persistence candidate
//                     |
//                     +-- later vacuum candidate
//                     |
//                     +-- disappearance/expiry candidate
//
// Formal mechanic validation comes later.
// ============================================================


// ============================================================
// DOCUMENTED / CANDIDATE RANGE
//
// Script 57 found 45m = 1771.65 HU to be an extremely strong
// spatial separator, but we no longer interpret it as a
// ground-soul SPAWN radius.
//
// Script 75 uses it only to divide the clean credited-player
// cohort into descriptive distance bands.
// ============================================================

const DEFAULT_HU_PER_METER =
  39.37;


const DEFAULT_RANGE_METERS =
  45;


const DEFAULT_RANGE_HU =
  DEFAULT_HU_PER_METER *
  DEFAULT_RANGE_METERS;


// ============================================================
// RAW MOVEMENT THRESHOLDS
//
// Multiple thresholds are preserved because we do not yet know
// how much position jitter / bobbing AssignedGold exhibits.
//
// Do NOT interpret any one of these as an engine constant.
// ============================================================

const MOVEMENT_THRESHOLDS_HU = [
  8,
  16,
  32,
  64,
  128,
  256
];


// ============================================================
// CANDIDATE IMMEDIATE WINDOW
//
// Purely descriptive.
//
// This lets us ask whether a movement / vacuum-target signal
// appears essentially at spawn versus after substantial floor
// persistence.
//
// It is NOT yet a mechanic threshold.
// ============================================================

const IMMEDIATE_SIGNAL_SECONDS =
  0.25;


const IMMEDIATE_SIGNAL_TICKS =
  Math.ceil(
    IMMEDIATE_SIGNAL_SECONDS *
    TICK_RATE
  );


// ============================================================
// FALLBACK EPISODE WINDOW
//
// Script 55 normally gives us activation end state.
//
// If a lifecycle end tick is unavailable, use the next
// activation of the same pooled entity.
//
// Only if neither is available do we permit this fallback.
// ============================================================

const FALLBACK_MAX_LIFETIME_SECONDS =
  60;


const FALLBACK_MAX_LIFETIME_TICKS =
  FALLBACK_MAX_LIFETIME_SECONDS *
  TICK_RATE;


// ============================================================
// RAW WINDOW PADDING
// ============================================================

const RAW_PRE_START_TICKS =
  2;


const RAW_POST_END_TICKS =
  2;


// ============================================================
// PLAYER-STATE RECONSTRUCTION
//
// Match Script 57 / 71 reconstruction conventions.
// ============================================================

const MAX_INTERPOLATION_GAP_SECONDS =
  0.30;


const MAX_NEAREST_SAMPLE_DELTA_SECONDS =
  0.15;


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


const script55SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_summary_v01.json'
  );


const deathStreamPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_v01.jsonl'
  );


const activationStreamPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_activation_stream_v01.jsonl'
  );


const script57SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_range_validation_v01.json'
  );


const script73SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_validation_v01.json'
  );


const script73GroupsPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_groups_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_discovery_v01.json'
  );


const outputEpisodesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v01.jsonl'
  );


const outputEventsPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_events_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    script55SummaryPath,
    deathStreamPath,
    activationStreamPath,
    script57SummaryPath,
    script73SummaryPath,
    script73GroupsPath
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
// LOAD PRIOR VALIDATIONS
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
    'Script 55 did not PASS validation.'
  );
}


const script57Summary =
  JSON.parse(
    readFileSync(
      script57SummaryPath,
      'utf8'
    )
  );


const script73Summary =
  JSON.parse(
    readFileSync(
      script73SummaryPath,
      'utf8'
    )
  );


if (
  script73Summary
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 73 did not PASS validation.'
  );
}


// ============================================================
// RANGE
// ============================================================

const candidateRangeHU =
  firstFinite([
    script57Summary
      ?.documentedMechanicTarget
      ?.rangeInternalUnits,

    DEFAULT_RANGE_HU
  ]);


const candidateRangeMeters =
  firstFinite([
    script57Summary
      ?.documentedMechanicTarget
      ?.rangeMeters,

    DEFAULT_RANGE_METERS
  ]);


// ============================================================
// LOAD PLAYER STATE
// ============================================================

console.log('');

console.log(
  'Loading player timelines...'
);


const playerData =
  await loadPlayerData(
    playerStatePath
  );


const timelineByPlayerTeam =
  playerData.timelineByPlayerTeam;


const playerByPawnIndex =
  playerData.playerByPawnIndex;


console.log(
  `Player timelines: ${timelineByPlayerTeam.size}`
);

console.log(
  `Player pawn indexes: ${playerByPawnIndex.size}`
);


// ============================================================
// LOAD SCRIPT 73 GROUPS
// ============================================================

console.log(
  'Loading exact last-hit groups...'
);


const script73Groups =
  await loadJsonl(
    script73GroupsPath
  );


console.log(
  `Script 73 groups: ${script73Groups.length}`
);


// ============================================================
// BUILD DEATH -> CREDIT SIGNAL MAP
//
// CLEAN_ISOLATED:
//
//   one economic Trooper death in tick-team group
//   one matched death
//   one exact m_iLastHits unit
//   one counter event
//   delta == 1
//
// This is our strongest player identity cohort.
//
// Shared/multi-death groups are retained descriptively but are
// not treated as clean per-Trooper killer attribution.
// ============================================================

const creditByDeathIndex =
  new Map();


for (
  const group
  of script73Groups
) {

  const deaths =
    group?.deaths ??
    [];


  const exactEvents =
    group
      ?.exact
      ?.events ??
    [];


  const exactUnits =
    finite(
      group
        ?.exact
        ?.lastHitUnits
    )
    ??
    exactEvents.reduce(
      (
        total,
        row
      ) =>
        total +
        (
          finite(
            row?.delta
          )
          ??
          0
        ),
      0
    );


  const matchedDeaths =
    deaths.filter(
      row =>
        row?.groundSoulMatched ===
        true
    );


  const playerNames =
    [
      ...new Set(
        exactEvents
          .map(
            row =>
              row?.playerName
          )
          .filter(
            Boolean
          )
      )
    ];


  const cleanIsolated =
    deaths.length ===
      1
    &&
    matchedDeaths.length ===
      1
    &&
    exactUnits ===
      1
    &&
    exactEvents.length ===
      1
    &&
    finite(
      exactEvents[0]?.delta
    ) ===
      1
    &&
    Boolean(
      exactEvents[0]?.playerName
    );


  if (
    cleanIsolated
  ) {

    const deathIndex =
      finite(
        matchedDeaths[0]?.deathIndex
      );


    if (
      deathIndex !==
      null
    ) {

      creditByDeathIndex.set(
        deathIndex,
        {

          quality:
            'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER',

          playerName:
            exactEvents[0].playerName,

          team:
            finite(
              exactEvents[0].team
            ),

          controllerEntityIndex:
            finite(
              exactEvents[0].controllerEntityIndex
            ),

          delta:
            finite(
              exactEvents[0].delta
            ),

          tick:
            finite(
              exactEvents[0].tick
            ),

          groupDeathCount:
            deaths.length,

          groupMatchedCount:
            matchedDeaths.length,

          exactCounterUnits:
            exactUnits
        }
      );
    }

    continue;
  }


  if (
    matchedDeaths.length >
      0
    &&
    playerNames.length ===
      1
    &&
    exactUnits ===
      matchedDeaths.length
  ) {

    for (
      const death
      of matchedDeaths
    ) {

      const deathIndex =
        finite(
          death?.deathIndex
        );


      if (
        deathIndex ===
        null
      ) {

        continue;
      }


      creditByDeathIndex.set(
        deathIndex,
        {

          quality:
            'SHARED_GROUP_LEVEL_EXACT_LASTHIT_COUNTER',

          playerName:
            playerNames[0],

          team:
            finite(
              exactEvents[0]?.team
            ),

          controllerEntityIndex:
            finite(
              exactEvents[0]?.controllerEntityIndex
            ),

          delta:
            exactUnits,

          tick:
            finite(
              group?.tick
            ),

          groupDeathCount:
            deaths.length,

          groupMatchedCount:
            matchedDeaths.length,

          exactCounterUnits:
            exactUnits
        }
      );
    }

    continue;
  }


  for (
    const death
    of matchedDeaths
  ) {

    const deathIndex =
      finite(
        death?.deathIndex
      );


    if (
      deathIndex ===
      null
    ) {

      continue;
    }


    creditByDeathIndex.set(
      deathIndex,
      {

        quality:
          'AMBIGUOUS_EXACT_LASTHIT_COUNTER',

        playerName:
          null,

        team:
          null,

        controllerEntityIndex:
          null,

        delta:
          exactUnits,

        tick:
          finite(
            group?.tick
          ),

        groupDeathCount:
          deaths.length,

        groupMatchedCount:
          matchedDeaths.length,

        exactCounterUnits:
          exactUnits,

        candidatePlayers:
          playerNames
      }
    );
  }
}


// ============================================================
// LOAD SCRIPT 55 ACTIVATION STREAM
// ============================================================

console.log(
  'Loading Script 55 AssignedGold activations...'
);


const rawActivationRows =
  await loadJsonl(
    activationStreamPath
  );


const activationRows =
  rawActivationRows
    .map(
      normalizeActivationRow
    )
    .filter(
      Boolean
    );


console.log(
  `Activation rows: ${activationRows.length}`
);


const activationByIndex =
  new Map();


const activationById =
  new Map();


for (
  const activation
  of activationRows
) {

  if (
    activation.activationIndex !==
    null
  ) {

    activationByIndex.set(
      activation.activationIndex,
      activation
    );
  }


  if (
    activation.activationId
  ) {

    activationById.set(
      activation.activationId,
      activation
    );
  }
}


// ============================================================
// NEXT ACTIVATION BY ENTITY
//
// Used only as an end-window fallback.
// ============================================================

const activationsByEntity =
  new Map();


for (
  const activation
  of activationRows
) {

  if (
    activation.entityIndex ===
    null
    ||
    activation.activationTick ===
    null
  ) {

    continue;
  }


  if (
    !activationsByEntity.has(
      activation.entityIndex
    )
  ) {

    activationsByEntity.set(
      activation.entityIndex,
      []
    );
  }


  activationsByEntity
    .get(
      activation.entityIndex
    )
    .push(
      activation
    );
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
// LOAD SCRIPT 55 DEATH STREAM
// ============================================================

console.log(
  'Loading matched economic Trooper deaths...'
);


const rawDeathRows =
  await loadJsonl(
    deathStreamPath
  );


const matchedDeathRows =
  rawDeathRows
    .filter(
      row =>
        isGroundSoulMatched(
          row
        )
    );


console.log(
  `Matched economic deaths: ${matchedDeathRows.length}`
);


// ============================================================
// BUILD TARGET EPISODES
// ============================================================

const episodes =
  [];


for (
  const deathRow
  of matchedDeathRows
) {

  const episode =
    buildEpisodeTarget(
      deathRow
    );


  if (
    episode
  ) {

    episodes.push(
      episode
    );
  }
}


episodes.sort(
  (
    a,
    b
  ) =>
    a.activationTick -
    b.activationTick
    ||
    a.deathIndex -
    b.deathIndex
);


console.log(
  `Lifecycle episode targets: ${episodes.length}`
);


// ============================================================
// INDEX EPISODES BY ASSIGNEDGOLD ENTITY
// ============================================================

const episodesByEntity =
  new Map();


for (
  const episode
  of episodes
) {

  if (
    !episodesByEntity.has(
      episode.entityIndex
    )
  ) {

    episodesByEntity.set(
      episode.entityIndex,
      []
    );
  }


  episodesByEntity
    .get(
      episode.entityIndex
    )
    .push(
      episode
    );
}


for (
  const rows
  of episodesByEntity.values()
) {

  rows.sort(
    (
      a,
      b
    ) =>
      a.rawStartTick -
      b.rawStartTick
  );
}


// ============================================================
// RAW REPLAY RESCAN
// ============================================================

let assignedGoldEntityEvents =
  0;


let capturedEventRows =
  0;


let eventSequence =
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


      if (
        getEntityClassName(
          entity
        ) !==
        'CCitadel_Pickup_AssignedGold'
      ) {

        continue;
      }


      assignedGoldEntityEvents++;


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


      const candidateEpisodes =
        episodesByEntity.get(
          entityIndex
        )
        ??
        [];


      if (
        candidateEpisodes.length ===
        0
      ) {

        continue;
      }


      const snapshot =
        buildRawSnapshot(
          event,
          entity,
          tick,
          eventSequence++
        );


      for (
        const episode
        of candidateEpisodes
      ) {

        if (
          tick <
          episode.rawStartTick
        ) {

          break;
        }


        if (
          tick >
          episode.rawEndTick
        ) {

          continue;
        }


        episode.rawEvents.push(
          snapshot
        );


        capturedEventRows++;
      }
    }
  }
);


console.log('');

console.log(
  'Rescanning raw AssignedGold lifecycle telemetry...'
);

console.log('');


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// ANALYZE EPISODES
// ============================================================

const analyzedEpisodes =
  episodes.map(
    analyzeEpisode
  );


// ============================================================
// CLEAN CREDIT COHORT
// ============================================================

const cleanCreditedEpisodes =
  analyzedEpisodes.filter(
    row =>
      row
        ?.creditedPlayer
        ?.quality ===
      'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'
  );


const cleanInside45 =
  cleanCreditedEpisodes.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'WITHIN_45M'
  );


const cleanOutside45 =
  cleanCreditedEpisodes.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'OUTSIDE_45M'
  );


const cleanDistanceUnresolved =
  cleanCreditedEpisodes.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'DISTANCE_UNRESOLVED'
  );


// ============================================================
// SIGNATURE COUNTS
// ============================================================

const allSignatureCounts =
  countByObject(
    analyzedEpisodes,
    row =>
      row.candidateLifecycleSignature
  );


const cleanSignatureCounts =
  countByObject(
    cleanCreditedEpisodes,
    row =>
      row.candidateLifecycleSignature
  );


const insideSignatureCounts =
  countByObject(
    cleanInside45,
    row =>
      row.candidateLifecycleSignature
  );


const outsideSignatureCounts =
  countByObject(
    cleanOutside45,
    row =>
      row.candidateLifecycleSignature
  );


// ============================================================
// END-REASON COUNTS
// ============================================================

const allEndReasonCounts =
  countByObject(
    analyzedEpisodes,
    row =>
      row
        ?.script55Lifecycle
        ?.endReason ??
      'UNKNOWN'
  );


const insideEndReasonCounts =
  countByObject(
    cleanInside45,
    row =>
      row
        ?.script55Lifecycle
        ?.endReason ??
      'UNKNOWN'
  );


const outsideEndReasonCounts =
  countByObject(
    cleanOutside45,
    row =>
      row
        ?.script55Lifecycle
        ?.endReason ??
      'UNKNOWN'
  );


// ============================================================
// IMMEDIATE / DELAYED SIGNAL SUMMARIES
// ============================================================

const insideImmediateSignal =
  cleanInside45.filter(
    row =>
      row
        ?.candidateSignals
        ?.firstCombinedVacuumCandidate
        ?.immediate ===
      true
  );


const outsideImmediateSignal =
  cleanOutside45.filter(
    row =>
      row
        ?.candidateSignals
        ?.firstCombinedVacuumCandidate
        ?.immediate ===
      true
  );


const insideDelayedSignal =
  cleanInside45.filter(
    row =>
      row.candidateLifecycleSignature ===
      'DELAYED_VACUUM_SIGNAL_CANDIDATE'
  );


const outsideDelayedSignal =
  cleanOutside45.filter(
    row =>
      row.candidateLifecycleSignature ===
      'DELAYED_VACUUM_SIGNAL_CANDIDATE'
  );


const insidePersistentNoMovement =
  cleanInside45.filter(
    row =>
      row.candidateLifecycleSignature ===
      'PERSISTENT_FLOOR_STATE_CANDIDATE'
  );


const outsidePersistentNoMovement =
  cleanOutside45.filter(
    row =>
      row.candidateLifecycleSignature ===
      'PERSISTENT_FLOOR_STATE_CANDIDATE'
  );


// ============================================================
// RAW COVERAGE
// ============================================================

const episodesWithRawEvents =
  analyzedEpisodes.filter(
    row =>
      row.rawObservation.eventCount >
      0
  );


const episodesWithPosition =
  analyzedEpisodes.filter(
    row =>
      row.rawObservation.positionObservationCount >
      0
  );


const cleanWithPosition =
  cleanCreditedEpisodes.filter(
    row =>
      row.rawObservation.positionObservationCount >
      0
  );


// ============================================================
// MOVEMENT TIMING DISTRIBUTIONS
// ============================================================

const insideFirst32MoveSeconds =
  cleanInside45
    .map(
      row =>
        row
          ?.candidateSignals
          ?.movement
          ?.['32']
          ?.secondsAfterActivation
    )
    .filter(
      Number.isFinite
    );


const outsideFirst32MoveSeconds =
  cleanOutside45
    .map(
      row =>
        row
          ?.candidateSignals
          ?.movement
          ?.['32']
          ?.secondsAfterActivation
    )
    .filter(
      Number.isFinite
    );


const insideFirstTargetSeconds =
  cleanInside45
    .map(
      row =>
        row
          ?.candidateSignals
          ?.firstValidVacuumTarget
          ?.secondsAfterActivation
    )
    .filter(
      Number.isFinite
    );


const outsideFirstTargetSeconds =
  cleanOutside45
    .map(
      row =>
        row
          ?.candidateSignals
          ?.firstValidVacuumTarget
          ?.secondsAfterActivation
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// DURATION DISTRIBUTIONS
// ============================================================

const insideDurations =
  cleanInside45
    .map(
      row =>
        row
          ?.script55Lifecycle
          ?.durationSeconds
    )
    .filter(
      Number.isFinite
    );


const outsideDurations =
  cleanOutside45
    .map(
      row =>
        row
          ?.script55Lifecycle
          ?.durationSeconds
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// DISTANCE DISTRIBUTIONS
// ============================================================

const cleanCreditedDistances =
  cleanCreditedEpisodes
    .map(
      row =>
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
    )
    .filter(
      Number.isFinite
    );


const immediateDistances =
  cleanCreditedEpisodes
    .filter(
      row =>
        row
          ?.candidateSignals
          ?.firstCombinedVacuumCandidate
          ?.immediate ===
        true
    )
    .map(
      row =>
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
    )
    .filter(
      Number.isFinite
    );


const delayedOrPersistentDistances =
  cleanCreditedEpisodes
    .filter(
      row =>
        [
          'DELAYED_VACUUM_SIGNAL_CANDIDATE',
          'PERSISTENT_FLOOR_STATE_CANDIDATE'
        ].includes(
          row.candidateLifecycleSignature
        )
    )
    .map(
      row =>
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// VALIDATION
// ============================================================

const expectedMatchedDeaths =
  finite(
    script55Summary
      ?.matching
      ?.matchedDeaths
  )
  ??
  finite(
    script55Summary
      ?.counts
      ?.matchedDeaths
  )
  ??
  (
    replayName ===
      'test'
      ? 1388
      : null
  );


const expectedCleanIsolated =
  finite(
    script73Summary
      ?.sourceCounts
      ?.isolatedMatched
  )
  ??
  (
    replayName ===
      'test'
      ? 1003
      : null
  );


const validationChecks = {

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


  script73Passed:
    check(
      script73Summary
        ?.validation
        ?.pass,
      true,
      script73Summary
        ?.validation
        ?.pass ===
      true
    ),


  matchedEpisodeCount:
    check(
      analyzedEpisodes.length,
      expectedMatchedDeaths,
      expectedMatchedDeaths ===
        null
        ? analyzedEpisodes.length >
          0
        : analyzedEpisodes.length ===
          expectedMatchedDeaths
    ),


  expectedTestMatchedEpisodeCount:
    check(
      analyzedEpisodes.length,
      replayName ===
        'test'
        ? 1388
        : '>0',
      replayName ===
        'test'
        ? analyzedEpisodes.length ===
          1388
        : analyzedEpisodes.length >
          0
    ),


  cleanIsolatedCreditCount:
    check(
      cleanCreditedEpisodes.length,
      expectedCleanIsolated,
      expectedCleanIsolated ===
        null
        ? cleanCreditedEpisodes.length >
          0
        : cleanCreditedEpisodes.length ===
          expectedCleanIsolated
    ),


  expectedTestCleanIsolatedCreditCount:
    check(
      cleanCreditedEpisodes.length,
      replayName ===
        'test'
        ? 1003
        : '>0',
      replayName ===
        'test'
        ? cleanCreditedEpisodes.length ===
          1003
        : cleanCreditedEpisodes.length >
          0
    ),


  allEpisodesHaveEntityAndActivationTick:
    check(
      analyzedEpisodes.filter(
        row =>
          Number.isFinite(
            row.entityIndex
          )
          &&
          Number.isFinite(
            row.activationTick
          )
      ).length,
      analyzedEpisodes.length,
      analyzedEpisodes.every(
        row =>
          Number.isFinite(
            row.entityIndex
          )
          &&
          Number.isFinite(
            row.activationTick
          )
      )
    ),


  rawAssignedGoldEventsObserved:
    check(
      assignedGoldEntityEvents,
      '>0',
      assignedGoldEntityEvents >
      0
    ),


  rawEpisodeCoverage:
    check(
      episodesWithRawEvents.length,
      `>=95% of ${analyzedEpisodes.length}`,
      rate(
        episodesWithRawEvents.length,
        analyzedEpisodes.length
      ) >=
      0.95
    ),


  rawPositionCoverage:
    check(
      episodesWithPosition.length,
      `>=90% of ${analyzedEpisodes.length}`,
      rate(
        episodesWithPosition.length,
        analyzedEpisodes.length
      ) >=
      0.90
    ),


  cleanCreditPositionCoverage:
    check(
      cleanWithPosition.length,
      `>=90% of ${cleanCreditedEpisodes.length}`,
      rate(
        cleanWithPosition.length,
        cleanCreditedEpisodes.length
      ) >=
      0.90
    ),


  cleanDistancePartitionExhaustive:
    check(
      cleanInside45.length +
        cleanOutside45.length +
        cleanDistanceUnresolved.length,
      cleanCreditedEpisodes.length,
      cleanInside45.length +
        cleanOutside45.length +
        cleanDistanceUnresolved.length ===
        cleanCreditedEpisodes.length
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
    'ASSIGNED_GOLD_LIFECYCLE_DISCOVERY_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'ASSIGNED_GOLD_LIFECYCLE_DISCOVERY_READY'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',


  purpose: [

    'Separate ground-soul production from immediate vacuuming, delayed vacuuming, persistence, disappearance, and possible expiration.',

    'Use the exact m_iLastHits player from clean isolated Script 73 deaths as the strongest available credited-player identity.',

    'Measure credited-player distance at Trooper death rather than nearest-opponent distance.',

    'Observe raw AssignedGold position, active state, interactive state, vacuum-target state, and lifecycle timing.',

    'Discover candidate lifecycle signatures before formal 45m vacuum-radius validation.'
  ],


  semanticLimits: {

    spawn:
      'Script 55 death-to-AssignedGold matching remains the operational evidence that an AssignedGold episode is associated with a Trooper death.',

    movement:
      'Movement is directly observed position change, but movement is not automatically classified as successful acquisition.',

    vacuumTarget:
      'm_hVacuumTarget is retained as observed magnetic-target telemetry only.',

    disappearance:
      'Episode termination is not yet classified as collection versus expiration.',

    immediateVacuum:
      'IMMEDIATE_VACUUM_SIGNAL_CANDIDATE is an operational discovery label based on early movement or vacuum-target evidence, not a validated game-mechanic label.',

    floorState:
      'PERSISTENT_FLOOR_STATE_CANDIDATE means no >=32 HU movement or valid vacuum-target signal was observed during the reconstructed episode. It does not yet prove uncollected expiration.'
  },


  candidateRange: {

    meters:
      candidateRangeMeters,

    internalUnits:
      candidateRangeHU,

    currentInterpretation:
      'Candidate vacuum/proximity radius, no longer interpreted as a ground-soul spawn radius.'
  },


  discoveryThresholds: {

    movementThresholdsHU:
      MOVEMENT_THRESHOLDS_HU,

    immediateSignalSeconds:
      IMMEDIATE_SIGNAL_SECONDS,

    fallbackMaximumEpisodeSeconds:
      FALLBACK_MAX_LIFETIME_SECONDS
  },


  sourceCounts: {

    script55MatchedDeaths:
      analyzedEpisodes.length,

    script55ActivationRows:
      activationRows.length,

    script73Groups:
      script73Groups.length,

    cleanIsolatedCreditedEpisodes:
      cleanCreditedEpisodes.length,

    cleanInside45m:
      cleanInside45.length,

    cleanOutside45m:
      cleanOutside45.length,

    cleanDistanceUnresolved:
      cleanDistanceUnresolved.length,

    assignedGoldRawEntityEvents:
      assignedGoldEntityEvents,

    capturedLifecycleEventRows:
      capturedEventRows,

    episodesWithRawEvents:
      episodesWithRawEvents.length,

    episodesWithRawPosition:
      episodesWithPosition.length
  },


  candidateLifecycleSignatures: {

    allMatchedEpisodes:
      allSignatureCounts,

    cleanCreditedEpisodes:
      cleanSignatureCounts,

    cleanCreditedInside45m:
      insideSignatureCounts,

    cleanCreditedOutside45m:
      outsideSignatureCounts
  },


  immediateSignalComparison: {

    inside45m: {

      total:
        cleanInside45.length,

      immediateSignal:
        insideImmediateSignal.length,

      immediateSignalRate:
        rate(
          insideImmediateSignal.length,
          cleanInside45.length
        ),

      delayedSignal:
        insideDelayedSignal.length,

      persistentFloorCandidate:
        insidePersistentNoMovement.length
    },


    outside45m: {

      total:
        cleanOutside45.length,

      immediateSignal:
        outsideImmediateSignal.length,

      immediateSignalRate:
        rate(
          outsideImmediateSignal.length,
          cleanOutside45.length
        ),

      delayedSignal:
        outsideDelayedSignal.length,

      persistentFloorCandidate:
        outsidePersistentNoMovement.length
    },


    immediateRateDifferenceInsideMinusOutside:
      difference(
        rate(
          insideImmediateSignal.length,
          cleanInside45.length
        ),
        rate(
          outsideImmediateSignal.length,
          cleanOutside45.length
        )
      )
  },


  timingDistributions: {

    first32HUMovementSeconds: {

      inside45m:
        summarizeNumbers(
          insideFirst32MoveSeconds
        ),

      outside45m:
        summarizeNumbers(
          outsideFirst32MoveSeconds
        )
    },


    firstValidVacuumTargetSeconds: {

      inside45m:
        summarizeNumbers(
          insideFirstTargetSeconds
        ),

      outside45m:
        summarizeNumbers(
          outsideFirstTargetSeconds
        )
    },


    script55EpisodeDurationSeconds: {

      inside45m:
        summarizeNumbers(
          insideDurations
        ),

      outside45m:
        summarizeNumbers(
          outsideDurations
        )
    }
  },


  creditedPlayerDistanceDistributions: {

    allCleanCredited:
      summarizeNumbers(
        cleanCreditedDistances
      ),

    immediateSignalCandidate:
      summarizeNumbers(
        immediateDistances
      ),

    delayedOrPersistentCandidate:
      summarizeNumbers(
        delayedOrPersistentDistances
      )
  },


  script55EndReasons: {

    allMatchedEpisodes:
      allEndReasonCounts,

    cleanInside45m:
      insideEndReasonCounts,

    cleanOutside45m:
      outsideEndReasonCounts
  },


  interpretationGuide: {

    expectedIfGameplayDescriptionIsVisibleInTelemetry: [

      'Clean credited-player episodes inside ~45m should show substantially more near-immediate movement/vacuum-target signatures.',

      'Clean credited-player episodes outside ~45m should show longer persistence before movement or no movement before episode termination.',

      'Delayed episodes should permit a later test of credited-player distance at movement/vacuum onset.',

      'No-movement terminated episodes become candidates for expiration, but expiration must be validated separately.'
    ],


    importantFailureMode:
      'If inside/outside credited-player distance does not separate lifecycle signatures, the raw movement/active/vacuum-target fields may not encode visible vacuum behavior in the assumed way and must be inspected before building Script 76.'
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

    episodes:
      outputEpisodesPath,

    events:
      outputEventsPath
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
  outputEpisodesPath,
  analyzedEpisodes
);


await writeLifecycleEventStream(
  outputEventsPath,
  episodes
);


// ============================================================
// CONSOLE OUTPUT
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD LIFECYCLE DISCOVERY V0.1'
);

console.log(
  '========================================================'
);

console.log('');


console.log(
  `Matched AssignedGold episodes: ${analyzedEpisodes.length}`
);

console.log(
  `Clean isolated credited-player episodes: ${cleanCreditedEpisodes.length}`
);

console.log(
  `  <=45m: ${cleanInside45.length}`
);

console.log(
  `   >45m: ${cleanOutside45.length}`
);

console.log(
  `  unresolved distance: ${cleanDistanceUnresolved.length}`
);


console.log('');

console.log(
  'CANDIDATE LIFECYCLE SIGNATURES'
);

console.log(
  '------------------------------'
);


console.log(
  'Inside 45m:'
);


printCounts(
  insideSignatureCounts
);


console.log('');

console.log(
  'Outside 45m:'
);


printCounts(
  outsideSignatureCounts
);


console.log('');

console.log(
  'IMMEDIATE SIGNAL COMPARISON'
);

console.log(
  '---------------------------'
);


console.log(
  `Inside <=45m: ${insideImmediateSignal.length}/${cleanInside45.length} = ${formatPercent(rate(insideImmediateSignal.length, cleanInside45.length))}`
);


console.log(
  `Outside >45m: ${outsideImmediateSignal.length}/${cleanOutside45.length} = ${formatPercent(rate(outsideImmediateSignal.length, cleanOutside45.length))}`
);


console.log(
  `Difference: ${formatSignedPercent(
    difference(
      rate(
        insideImmediateSignal.length,
        cleanInside45.length
      ),
      rate(
        outsideImmediateSignal.length,
        cleanOutside45.length
      )
    )
  )}`
);


console.log('');

console.log(
  'FIRST >=32 HU MOVEMENT'
);

console.log(
  '----------------------'
);


console.log(
  `Inside <=45m: ${formatDistribution(summarizeNumbers(insideFirst32MoveSeconds))}`
);


console.log(
  `Outside >45m: ${formatDistribution(summarizeNumbers(outsideFirst32MoveSeconds))}`
);


console.log('');

console.log(
  'EPISODE DURATION'
);

console.log(
  '----------------'
);


console.log(
  `Inside <=45m: ${formatDistribution(summarizeNumbers(insideDurations))}`
);


console.log(
  `Outside >45m: ${formatDistribution(summarizeNumbers(outsideDurations))}`
);


console.log('');

console.log(
  'CLEAN >45M EXAMPLES'
);

console.log(
  '-------------------'
);


for (
  const row
  of cleanOutside45
    .slice(
      0,
      40
    )
) {

  console.log(

    `${String(row.death.deathIndex).padStart(4)}  ` +

    `${String(row.death.clock ?? '').padEnd(6)} ` +

    `${String(row.death.baseType ?? '').padEnd(7)} ` +

    `player=${String(row.creditedPlayer.playerName ?? 'UNKNOWN').padEnd(24)} ` +

    `dist=${formatNumber(row.creditedPlayer.distanceAtDeath3D)} ` +

    `duration=${formatNumber(row.script55Lifecycle.durationSeconds)} ` +

    `move32=${formatNumber(row.candidateSignals.movement?.['32']?.secondsAfterActivation)} ` +

    `target=${formatNumber(row.candidateSignals.firstValidVacuumTarget?.secondsAfterActivation)} ` +

    `signature=${row.candidateLifecycleSignature}`
  );
}


console.log('');

console.log(
  'SCRIPT55 END REASONS: INSIDE <=45M'
);

console.log(
  '---------------------------------'
);


printCounts(
  insideEndReasonCounts
);


console.log('');

console.log(
  'SCRIPT55 END REASONS: OUTSIDE >45M'
);

console.log(
  '---------------------------------'
);


printCounts(
  outsideEndReasonCounts
);


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
  `Episodes:\n${outputEpisodesPath}`
);

console.log('');

console.log(
  `Events:\n${outputEventsPath}`
);

console.log('');


// ============================================================
// BUILD EPISODE TARGET
// ============================================================

function buildEpisodeTarget(
  deathRow
) {

  const deathIndex =
    finite(
      deathRow?.deathIndex
    );


  const deathTick =
    firstFinite([
      deathRow
        ?.timing
        ?.tick,

      parseTickFromDeathKey(
        deathRow?.deathKey
      )
    ]);


  const deathTimeSeconds =
    firstFinite([
      deathRow
        ?.timing
        ?.timeSeconds,

      deathTick !==
        null
        ? tickToMatchTime(
          deathTick
        )
        : null
    ]);


  const trooperTeam =
    finite(
      deathRow
        ?.trooper
        ?.team
    );


  const deathPosition =
    normalizePosition(
      deathRow
        ?.trooper
        ?.position
    );


  const groundSoul =
    deathRow?.groundSoul ??
    {};


  const activationIndex =
    firstFinite([
      groundSoul?.activationIndex,
      deathRow
        ?.match
        ?.activationIndex
    ]);


  const activationId =
    groundSoul?.activationId ??
    null;


  const linkedActivation =
    (
      activationIndex !==
        null
        ? activationByIndex.get(
          activationIndex
        )
        : null
    )
    ??
    (
      activationId
        ? activationById.get(
          activationId
        )
        : null
    )
    ??
    null;


  const entityIndex =
    firstFinite([
      groundSoul?.entityIndex,
      groundSoul?.activationEntityIndex,
      linkedActivation?.entityIndex
    ]);


  const activationTick =
    firstFinite([
      groundSoul?.activationTick,
      groundSoul
        ?.timing
        ?.activationTick,
      linkedActivation?.activationTick
    ]);


  if (
    deathIndex ===
    null
    ||
    deathTick ===
    null
    ||
    deathTimeSeconds ===
    null
    ||
    trooperTeam ===
    null
    ||
    !deathPosition
    ||
    entityIndex ===
    null
    ||
    activationTick ===
    null
  ) {

    return null;
  }


  const activationPosition =
    normalizePosition(
      groundSoul?.position
    )
    ??
    normalizePosition(
      linkedActivation?.position
    );


  const explicitEndTick =
    firstFinite([
      groundSoul?.endTick,
      groundSoul
        ?.timing
        ?.endTick,
      groundSoul
        ?.lifecycle
        ?.endTick,
      linkedActivation?.endTick
    ]);


  const nextActivationTick =
    findNextActivationTick(
      entityIndex,
      activationTick
    );


  let rawEndTick;


  let rawEndSource;


  if (
    explicitEndTick !==
    null
    &&
    explicitEndTick >=
    activationTick
  ) {

    rawEndTick =
      explicitEndTick +
      RAW_POST_END_TICKS;


    rawEndSource =
      'SCRIPT55_END_TICK';

  } else if (
    nextActivationTick !==
    null
  ) {

    rawEndTick =
      Math.max(
        activationTick,
        nextActivationTick -
        1
      );


    rawEndSource =
      'NEXT_ENTITY_ACTIVATION';

  } else {

    rawEndTick =
      activationTick +
      FALLBACK_MAX_LIFETIME_TICKS;


    rawEndSource =
      'FALLBACK_60S';
  }


  const credit =
    creditByDeathIndex.get(
      deathIndex
    )
    ??
    {

      quality:
        'NO_EXACT_LASTHIT_CREDIT_MAPPING',

      playerName:
        null,

      team:
        null
    };


  return {

    deathIndex,

    deathKey:
      deathRow?.deathKey ??
      null,

    deathTick,

    deathTimeSeconds,

    deathClock:
      deathRow
        ?.timing
        ?.clock ??
      formatClock(
        deathTimeSeconds
      ),

    trooperEntityIndex:
      finite(
        deathRow
          ?.trooper
          ?.entityIndex
      ),

    baseType:
      deathRow
        ?.trooper
        ?.baseType ??
      'UNKNOWN',

    variantLabel:
      deathRow
        ?.trooper
        ?.variantLabel ??
      'UNKNOWN',

    trooperTeam,

    deathPosition,

    activationIndex,

    activationId,

    entityIndex,

    activationTick,

    activationTimeSeconds:
      firstFinite([
        groundSoul?.activationTimeSeconds,
        groundSoul
          ?.timing
          ?.activationTimeSeconds,
        linkedActivation?.activationTimeSeconds,
        tickToMatchTime(
          activationTick
        )
      ]),

    activationPosition,

    activationTeam:
      firstFinite([
        groundSoul?.team,
        linkedActivation?.team
      ]),

    script55EndTick:
      explicitEndTick,

    script55EndTimeSeconds:
      firstFinite([
        groundSoul?.endTimeSeconds,
        groundSoul
          ?.timing
          ?.endTimeSeconds,
        linkedActivation?.endTimeSeconds
      ]),

    script55DurationSeconds:
      firstFinite([
        groundSoul?.durationSeconds,
        groundSoul
          ?.timing
          ?.durationSeconds,
        linkedActivation?.durationSeconds
      ]),

    script55EndReason:
      groundSoul
        ?.lifecycle
        ?.endReason ??
      groundSoul?.endReason ??
      linkedActivation?.endReason ??
      null,

    script55FirstInteractiveTick:
      firstFinite([
        groundSoul
          ?.lifecycle
          ?.firstInteractiveTick,
        linkedActivation?.firstInteractiveTick
      ]),

    script55FirstValidVacuumTarget:
      groundSoul
        ?.lifecycle
        ?.firstValidVacuumTarget ??
      linkedActivation?.firstValidVacuumTarget ??
      null,

    script55VacuumTargetTransitions:
      groundSoul
        ?.lifecycle
        ?.vacuumTargetTransitions ??
      linkedActivation?.vacuumTargetTransitions ??
      [],

    creditedPlayer:
      credit,

    rawStartTick:
      activationTick -
      RAW_PRE_START_TICKS,

    rawEndTick,

    rawEndSource,

    rawEvents:
      []
  };
}


// ============================================================
// ANALYZE ONE EPISODE
// ============================================================

function analyzeEpisode(
  episode
) {

  const events =
    episode.rawEvents
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
          ||
          a.eventSequence -
          b.eventSequence
      );


  const postActivationEvents =
    events.filter(
      row =>
        row.tick >=
        episode.activationTick
    );


  const positionEvents =
    postActivationEvents.filter(
      row =>
        Boolean(
          row.position
        )
    );


  const baselinePosition =
    episode.activationPosition
    ??
    positionEvents[0]?.position
    ??
    null;


  const movement =
    {};


  let maximumDisplacement3D =
    null;


  let maximumDisplacementXY =
    null;


  if (
    baselinePosition
  ) {

    maximumDisplacement3D =
      0;


    maximumDisplacementXY =
      0;


    for (
      const event
      of positionEvents
    ) {

      const distance3D =
        getDistance3D(
          baselinePosition,
          event.position
        );


      const distanceXY =
        getDistanceXY(
          baselinePosition,
          event.position
        );


      maximumDisplacement3D =
        Math.max(
          maximumDisplacement3D,
          distance3D
        );


      maximumDisplacementXY =
        Math.max(
          maximumDisplacementXY,
          distanceXY
        );
    }


    for (
      const threshold
      of MOVEMENT_THRESHOLDS_HU
    ) {

      const first =
        positionEvents.find(
          event =>
            getDistance3D(
              baselinePosition,
              event.position
            ) >=
            threshold
        )
        ??
        null;


      movement[
        String(
          threshold
        )
      ] =
        first
          ? buildSignalSummary(
            first,
            episode,
            {
              distanceFromActivation3D:
                getDistance3D(
                  baselinePosition,
                  first.position
                ),

              distanceFromActivationXY:
                getDistanceXY(
                  baselinePosition,
                  first.position
                )
            }
          )
          : null;
    }
  }


  const firstValidVacuumTargetEvent =
    postActivationEvents.find(
      row =>
        row.vacuumTargetHandle !==
        null
    )
    ??
    null;


  const firstValidVacuumTarget =
    firstValidVacuumTargetEvent
      ? buildSignalSummary(
        firstValidVacuumTargetEvent,
        episode,
        {
          vacuumTargetHandle:
            firstValidVacuumTargetEvent
              .vacuumTargetHandle,

          vacuumTargetPawnEntityIndex:
            firstValidVacuumTargetEvent
              .vacuumTargetPawnEntityIndex,

          vacuumTargetPlayerName:
            firstValidVacuumTargetEvent
              .vacuumTargetPlayerName,

          vacuumTargetPlayerTeam:
            firstValidVacuumTargetEvent
              .vacuumTargetPlayerTeam
        }
      )
      : null;


  const firstActiveFalseEvent =
    postActivationEvents.find(
      row =>
        row.active ===
        false
    )
    ??
    null;


  const firstInteractiveFalseEvent =
    postActivationEvents.find(
      row =>
        row.interactive ===
        false
    )
    ??
    null;


  const firstMovement32 =
    movement['32']
    ??
    null;


  const combinedCandidates =
    [
      firstMovement32
        ? {
          source:
            'MOVEMENT_32_HU',
          signal:
            firstMovement32
        }
        : null,

      firstValidVacuumTarget
        ? {
          source:
            'VALID_VACUUM_TARGET',
          signal:
            firstValidVacuumTarget
        }
        : null
    ]
      .filter(
        Boolean
      )
      .sort(
        (
          a,
          b
        ) =>
          a.signal.tick -
          b.signal.tick
      );


  const firstCombined =
    combinedCandidates[0]
    ??
    null;


  const firstCombinedVacuumCandidate =
    firstCombined
      ? {

        source:
          firstCombined.source,

        ...firstCombined.signal,

        immediate:
          firstCombined.signal.tick -
          episode.activationTick <=
          IMMEDIATE_SIGNAL_TICKS
      }
      : null;


  const lifecycleDurationSeconds =
    firstFinite([
      episode.script55DurationSeconds,

      episode.script55EndTick !==
        null
        ? (
          episode.script55EndTick -
          episode.activationTick
        )
        /
        TICK_RATE
        : null,

      postActivationEvents.length >
        0
        ? (
          postActivationEvents[
            postActivationEvents.length -
            1
          ].tick -
          episode.activationTick
        )
        /
        TICK_RATE
        : null
    ]);


  const creditedPlayerAnalysis =
    analyzeCreditedPlayer(
      episode,
      firstCombinedVacuumCandidate
    );


  const candidateLifecycleSignature =
    classifyCandidateLifecycle({
      rawEventCount:
        postActivationEvents.length,

      firstCombinedVacuumCandidate,

      firstMovement32,

      firstValidVacuumTarget,

      maximumDisplacement3D,

      lifecycleDurationSeconds
    });


  return {

    schemaVersion:
      1,

    canonical:
      false,


    death: {

      deathIndex:
        episode.deathIndex,

      deathKey:
        episode.deathKey,

      entityIndex:
        episode.trooperEntityIndex,

      tick:
        episode.deathTick,

      timeSeconds:
        episode.deathTimeSeconds,

      clock:
        episode.deathClock,

      baseType:
        episode.baseType,

      variantLabel:
        episode.variantLabel,

      team:
        episode.trooperTeam,

      position:
        episode.deathPosition
    },


    assignedGold: {

      activationIndex:
        episode.activationIndex,

      activationId:
        episode.activationId,

      entityIndex:
        episode.entityIndex,

      activationTick:
        episode.activationTick,

      activationTimeSeconds:
        episode.activationTimeSeconds,

      team:
        episode.activationTeam,

      activationPosition:
        baselinePosition
    },


    creditedPlayer:
      creditedPlayerAnalysis,


    script55Lifecycle: {

      endTick:
        episode.script55EndTick,

      endTimeSeconds:
        episode.script55EndTimeSeconds,

      durationSeconds:
        lifecycleDurationSeconds,

      endReason:
        episode.script55EndReason,

      firstInteractiveTick:
        episode.script55FirstInteractiveTick,

      firstValidVacuumTarget:
        episode.script55FirstValidVacuumTarget,

      vacuumTargetTransitions:
        episode.script55VacuumTargetTransitions,

      rawEndWindowSource:
        episode.rawEndSource
    },


    rawObservation: {

      eventCount:
        postActivationEvents.length,

      positionObservationCount:
        positionEvents.length,

      firstObservedTick:
        postActivationEvents[0]?.tick ??
        null,

      lastObservedTick:
        postActivationEvents[
          postActivationEvents.length -
          1
        ]?.tick ??
        null,

      baselinePosition,

      maximumDisplacement3D,

      maximumDisplacementXY,

      distinctValidVacuumTargetHandles:
        [
          ...new Set(
            postActivationEvents
              .map(
                row =>
                  row.vacuumTargetHandle
              )
              .filter(
                value =>
                  value !==
                  null
              )
          )
        ],

      distinctVacuumTargetPlayers:
        [
          ...new Set(
            postActivationEvents
              .map(
                row =>
                  row.vacuumTargetPlayerName
              )
              .filter(
                Boolean
              )
          )
        ]
    },


    candidateSignals: {

      movement,

      firstValidVacuumTarget,

      firstCombinedVacuumCandidate,

      firstActiveFalse:
        firstActiveFalseEvent
          ? buildSignalSummary(
            firstActiveFalseEvent,
            episode
          )
          : null,

      firstInteractiveFalse:
        firstInteractiveFalseEvent
          ? buildSignalSummary(
            firstInteractiveFalseEvent,
            episode
          )
          : null
    },


    candidateLifecycleSignature,


    semanticStatus:
      'DISCOVERY_ONLY'
  };
}


// ============================================================
// CREDITED PLAYER ANALYSIS
// ============================================================

function analyzeCreditedPlayer(
  episode,
  firstCombinedSignal
) {

  const credit =
    episode.creditedPlayer ??
    {};


  const playerName =
    credit.playerName ??
    null;


  const team =
    finite(
      credit.team
    );


  if (
    !playerName
    ||
    team ===
    null
  ) {

    return {

      quality:
        credit.quality ??
        'UNRESOLVED',

      playerName,

      team,

      distanceAtDeath3D:
        null,

      distanceAtDeathXY:
        null,

      distanceBand:
        'DISTANCE_UNRESOLVED',

      stateAtDeath:
        null,

      stateAtFirstVacuumCandidate:
        null
    };
  }


  const timeline =
    timelineByPlayerTeam.get(
      `${playerName}|${team}`
    )
    ??
    null;


  if (
    !timeline
  ) {

    return {

      ...credit,

      distanceAtDeath3D:
        null,

      distanceAtDeathXY:
        null,

      distanceBand:
        'DISTANCE_UNRESOLVED',

      stateAtDeath:
        null,

      stateAtFirstVacuumCandidate:
        null,

      unresolvedReason:
        'PLAYER_TIMELINE_NOT_FOUND'
    };
  }


  const deathState =
    estimateStateAtTime(
      timeline.rows,
      episode.deathTimeSeconds
    );


  const distanceAtDeath3D =
    deathState
      ? getDistance3D(
        episode.deathPosition,
        deathState.position
      )
      : null;


  const distanceAtDeathXY =
    deathState
      ? getDistanceXY(
        episode.deathPosition,
        deathState.position
      )
      : null;


  let distanceBand =
    'DISTANCE_UNRESOLVED';


  if (
    Number.isFinite(
      distanceAtDeath3D
    )
  ) {

    distanceBand =
      distanceAtDeath3D <=
      candidateRangeHU
        ? 'WITHIN_45M'
        : 'OUTSIDE_45M';
  }


  let signalState =
    null;


  if (
    firstCombinedSignal
  ) {

    const signalTimeSeconds =
      tickToMatchTime(
        firstCombinedSignal.tick
      );


    const state =
      estimateStateAtTime(
        timeline.rows,
        signalTimeSeconds
      );


    if (
      state
    ) {

      const soulReferencePosition =
        firstCombinedSignal.position
        ??
        episode.activationPosition;


      signalState = {

        tick:
          firstCombinedSignal.tick,

        timeSeconds:
          signalTimeSeconds,

        method:
          state.method,

        sourceTimeDelta:
          state.sourceTimeDelta,

        position:
          state.position,

        distanceToActivationPosition3D:
          episode.activationPosition
            ? getDistance3D(
              episode.activationPosition,
              state.position
            )
            : null,

        distanceToActivationPositionXY:
          episode.activationPosition
            ? getDistanceXY(
              episode.activationPosition,
              state.position
            )
            : null,

        distanceToObservedSoulPosition3D:
          soulReferencePosition
            ? getDistance3D(
              soulReferencePosition,
              state.position
            )
            : null,

        distanceToObservedSoulPositionXY:
          soulReferencePosition
            ? getDistanceXY(
              soulReferencePosition,
              state.position
            )
            : null
      };
    }
  }


  return {

    ...credit,

    stateAtDeath:
      deathState,

    distanceAtDeath3D,

    distanceAtDeathXY,

    distanceAtDeathMeters:
      Number.isFinite(
        distanceAtDeath3D
      )
        ? distanceAtDeath3D /
          DEFAULT_HU_PER_METER
        : null,

    distanceBand,

    stateAtFirstVacuumCandidate:
      signalState
  };
}


// ============================================================
// CANDIDATE LIFECYCLE CLASSIFIER
//
// These labels are deliberately operational.
// ============================================================

function classifyCandidateLifecycle({
  rawEventCount,
  firstCombinedVacuumCandidate,
  firstMovement32,
  firstValidVacuumTarget,
  maximumDisplacement3D,
  lifecycleDurationSeconds
}) {

  if (
    rawEventCount ===
    0
  ) {

    return 'NO_RAW_LIFECYCLE_OBSERVATION';
  }


  if (
    firstCombinedVacuumCandidate
    &&
    firstCombinedVacuumCandidate.immediate
  ) {

    return 'IMMEDIATE_VACUUM_SIGNAL_CANDIDATE';
  }


  if (
    firstMovement32
    ||
    firstValidVacuumTarget
  ) {

    return 'DELAYED_VACUUM_SIGNAL_CANDIDATE';
  }


  if (
    (
      maximumDisplacement3D ===
        null
      ||
      maximumDisplacement3D <
        32
    )
    &&
    Number.isFinite(
      lifecycleDurationSeconds
    )
    &&
    lifecycleDurationSeconds >
      IMMEDIATE_SIGNAL_SECONDS
  ) {

    return 'PERSISTENT_FLOOR_STATE_CANDIDATE';
  }


  return 'UNRESOLVED_LIFECYCLE_SIGNATURE';
}


// ============================================================
// RAW SNAPSHOT
// ============================================================

function buildRawSnapshot(
  event,
  entity,
  tick,
  sequence
) {

  const vacuumTargetHandle =
    handleOrNull(
      safeGetField(
        entity,
        'm_hVacuumTarget'
      )
    );


  const vacuumTargetPawnEntityIndex =
    vacuumTargetHandle !==
      null
      ? (
        vacuumTargetHandle &
        ENTITY_INDEX_MASK
      )
      : null;


  const vacuumTargetPlayer =
    vacuumTargetPawnEntityIndex !==
      null
      ? playerByPawnIndex.get(
        vacuumTargetPawnEntityIndex
      )
      : null;


  return {

    eventSequence:
      sequence,

    tick,

    timeSeconds:
      tickToMatchTime(
        tick
      ),

    entityIndex:
      getEntityIndex(
        entity
      ),

    operation:
      getEventOperation(
        event
      ),

    changedFields:
      extractChangedFields(
        safeGetChanges(
          event
        )
      ),

    position:
      worldPosition(
        entity
      ),

    active:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bActive'
        )
      ),

    interactive:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bInteractive'
        )
      ),

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    subclassId:
      finite(
        safeGetField(
          entity,
          'm_nSubclassID'
        )
      ),

    vacuumTargetHandle,

    vacuumTargetPawnEntityIndex,

    vacuumTargetPlayerName:
      vacuumTargetPlayer?.playerName ??
      null,

    vacuumTargetPlayerTeam:
      vacuumTargetPlayer?.team ??
      null
  };
}


// ============================================================
// SIGNAL SUMMARY
// ============================================================

function buildSignalSummary(
  event,
  episode,
  extra = {}
) {

  return {

    tick:
      event.tick,

    timeSeconds:
      event.timeSeconds,

    ticksAfterActivation:
      event.tick -
      episode.activationTick,

    secondsAfterActivation:
      (
        event.tick -
        episode.activationTick
      )
      /
      TICK_RATE,

    position:
      event.position,

    active:
      event.active,

    interactive:
      event.interactive,

    changedFields:
      event.changedFields,

    ...extra
  };
}


// ============================================================
// NEXT ACTIVATION
// ============================================================

function findNextActivationTick(
  entityIndex,
  activationTick
) {

  const rows =
    activationsByEntity.get(
      entityIndex
    )
    ??
    [];


  for (
    const row
    of rows
  ) {

    if (
      row.activationTick >
      activationTick
    ) {

      return row.activationTick;
    }
  }


  return null;
}


// ============================================================
// ACTIVATION NORMALIZATION
// ============================================================

function normalizeActivationRow(
  row
) {

  const activationIndex =
    finite(
      row?.activationIndex
    );


  const activationId =
    row?.activationId ??
    null;


  const entityIndex =
    firstFinite([
      row?.entityIndex,
      row
        ?.state
        ?.entityIndex
    ]);


  const activationTick =
    firstFinite([
      row?.activationTick,
      row
        ?.timing
        ?.activationTick
    ]);


  if (
    entityIndex ===
      null
    ||
    activationTick ===
      null
  ) {

    return null;
  }


  return {

    activationIndex,

    activationId,

    entityIndex,

    activationTick,

    activationTimeSeconds:
      firstFinite([
        row?.activationTimeSeconds,
        row
          ?.timing
          ?.activationTimeSeconds,
        tickToMatchTime(
          activationTick
        )
      ]),

    position:
      normalizePosition(
        row?.position
      )
      ??
      normalizePosition(
        row
          ?.state
          ?.position
      ),

    team:
      firstFinite([
        row?.team,
        row
          ?.state
          ?.team
      ]),

    endTick:
      firstFinite([
        row?.endTick,
        row
          ?.timing
          ?.endTick,
        row
          ?.lifecycle
          ?.endTick
      ]),

    endTimeSeconds:
      firstFinite([
        row?.endTimeSeconds,
        row
          ?.timing
          ?.endTimeSeconds
      ]),

    durationSeconds:
      firstFinite([
        row?.durationSeconds,
        row
          ?.timing
          ?.durationSeconds
      ]),

    endReason:
      row?.endReason ??
      row
        ?.lifecycle
        ?.endReason ??
      null,

    firstInteractiveTick:
      firstFinite([
        row?.firstInteractiveTick,
        row
          ?.lifecycle
          ?.firstInteractiveTick
      ]),

    firstValidVacuumTarget:
      row
        ?.firstValidVacuumTarget ??
      row
        ?.lifecycle
        ?.firstValidVacuumTarget ??
      null,

    vacuumTargetTransitions:
      row
        ?.vacuumTargetTransitions ??
      row
        ?.lifecycle
        ?.vacuumTargetTransitions ??
      []
  };
}


// ============================================================
// PLAYER DATA
// ============================================================

async function loadPlayerData(
  path
) {

  const timelineByPlayerTeam =
    new Map();


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


    const timeSeconds =
      finite(
        row?.matchTimeSeconds
      );


    const playerName =
      row
        ?.controller
        ?.playerName ??
      null;


    const team =
      finite(
        row
          ?.controller
          ?.team
      );


    const pawnEntityIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );


    if (
      playerName
      &&
      team !==
        null
      &&
      pawnEntityIndex !==
        null
    ) {

      playerByPawnIndex.set(
        pawnEntityIndex,
        {

          playerName,

          team,

          pawnEntityIndex,

          controllerEntityIndex:
            finite(
              row
                ?.controller
                ?.entityIndex
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


    if (
      timeSeconds ===
        null
      ||
      !playerName
      ||
      team ===
        null
    ) {

      continue;
    }


    const key =
      `${playerName}|${team}`;


    if (
      !timelineByPlayerTeam.has(
        key
      )
    ) {

      timelineByPlayerTeam.set(
        key,
        {

          playerName,

          team,

          rows:
            []
        }
      );
    }


    timelineByPlayerTeam
      .get(
        key
      )
      .rows
      .push({

        timeSeconds,

        alive:
          row
            ?.controller
            ?.alive ===
          true,

        movementValid:
          row
            ?.pawn
            ?.positionValidForMovement ===
          true,

        position:
          normalizePosition(
            row
              ?.pawn
              ?.positionWorld
          )
      });
  }


  for (
    const timeline
    of timelineByPlayerTeam.values()
  ) {

    timeline.rows.sort(
      (
        a,
        b
      ) =>
        a.timeSeconds -
        b.timeSeconds
    );
  }


  return {

    timelineByPlayerTeam,

    playerByPawnIndex
  };
}


// ============================================================
// PLAYER STATE ESTIMATION
// ============================================================

function estimateStateAtTime(
  rows,
  timeSeconds
) {

  const index =
    lowerBoundByTime(
      rows,
      timeSeconds
    );


  const after =
    index <
      rows.length
      ? rows[index]
      : null;


  const before =
    index >
      0
      ? rows[
        index -
        1
      ]
      : null;


  if (
    after
    &&
    Math.abs(
      after.timeSeconds -
      timeSeconds
    ) <
      1e-9
    &&
    validPlayerSample(
      after
    )
  ) {

    return {

      timeSeconds,

      position:
        after.position,

      method:
        'EXACT_SAMPLE',

      sourceTimeDelta:
        0
    };
  }


  if (
    before
    &&
    after
    &&
    validPlayerSample(
      before
    )
    &&
    validPlayerSample(
      after
    )
  ) {

    const gap =
      after.timeSeconds -
      before.timeSeconds;


    if (
      gap >
        0
      &&
      gap <=
        MAX_INTERPOLATION_GAP_SECONDS
    ) {

      const fraction =
        (
          timeSeconds -
          before.timeSeconds
        )
        /
        gap;


      if (
        fraction >=
          0
        &&
        fraction <=
          1
      ) {

        return {

          timeSeconds,

          position:
            interpolatePosition(
              before.position,
              after.position,
              fraction
            ),

          method:
            'LINEAR_INTERPOLATION',

          sourceTimeDelta:
            Math.min(
              Math.abs(
                timeSeconds -
                before.timeSeconds
              ),
              Math.abs(
                after.timeSeconds -
                timeSeconds
              )
            )
        };
      }
    }
  }


  const candidates =
    [];


  for (
    const row
    of [
      before,
      after
    ]
  ) {

    if (
      !validPlayerSample(
        row
      )
    ) {

      continue;
    }


    const delta =
      Math.abs(
        row.timeSeconds -
        timeSeconds
      );


    if (
      delta <=
      MAX_NEAREST_SAMPLE_DELTA_SECONDS
    ) {

      candidates.push({
        row,
        delta
      });
    }
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      a.delta -
      b.delta
  );


  const best =
    candidates[0] ??
    null;


  if (
    !best
  ) {

    return null;
  }


  return {

    timeSeconds:
      best.row.timeSeconds,

    position:
      best.row.position,

    method:
      'NEAREST_VALID_SAMPLE',

    sourceTimeDelta:
      best.delta
  };
}


function validPlayerSample(
  row
) {

  return Boolean(
    row
    &&
    row.alive ===
      true
    &&
    row.movementValid ===
      true
    &&
    row.position
  );
}


// ============================================================
// RAW WORLD POSITION
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
// RAW EVENT HELPERS
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
    raw ===
    null
    ||
    raw ===
    undefined
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


  if (
    typeof raw ===
    'object'
  ) {

    return Object.keys(
      raw
    );
  }


  return [];
}


function getEventOperation(
  event
) {

  const raw =
    event?.operation ??
    event?.type ??
    event?.eventType ??
    null;


  return raw ===
    null
    ||
    raw ===
    undefined
    ? null
    : String(
      raw
    );
}


function getEntityIndex(
  entity
) {

  const direct =
    firstFinite([
      entity?.index,
      entity?.entityIndex
    ]);


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


function getEntityClassName(
  entity
) {

  try {

    const direct =
      entity?.className ??
      entity?.classname ??
      entity?.name ??
      null;


    if (
      typeof direct ===
      'string'
    ) {

      return direct;
    }


    if (
      typeof entity?.getClassName ===
      'function'
    ) {

      return entity.getClassName();
    }


    if (
      typeof entity?.getClass ===
      'function'
    ) {

      const value =
        entity.getClass();


      return value?.name ??
      value?.className ??
      null;
    }

  } catch {}


  return null;
}


// ============================================================
// HANDLE
// ============================================================

function handleOrNull(
  value
) {

  const number =
    finite(
      value
    );


  if (
    number ===
    null
  ) {

    return null;
  }


  const unsigned =
    number >>>
    0;


  if (
    unsigned ===
      0
    ||
    unsigned ===
      0xffffffff
  ) {

    return null;
  }


  const index =
    unsigned &
    ENTITY_INDEX_MASK;


  if (
    index ===
    ENTITY_INDEX_MASK
  ) {

    return null;
  }


  return unsigned;
}


// ============================================================
// MATCH STATUS
// ============================================================

function isGroundSoulMatched(
  row
) {

  return row
    ?.match
    ?.status ===
    'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
  ||
  Boolean(
    row?.groundSoul
  );
}


// ============================================================
// POSITION
// ============================================================

function normalizePosition(
  value
) {

  if (
    !value
  ) {

    return null;
  }


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


function interpolatePosition(
  a,
  b,
  fraction
) {

  return {

    x:
      a.x +
      (
        b.x -
        a.x
      ) *
      fraction,

    y:
      a.y +
      (
        b.y -
        a.y
      ) *
      fraction,

    z:
      a.z +
      (
        b.z -
        a.z
      ) *
      fraction
  };
}


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


// ============================================================
// BINARY SEARCH
// ============================================================

function lowerBoundByTime(
  rows,
  timeSeconds
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
      rows[mid].timeSeconds <
      timeSeconds
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
// DEATH KEY
// ============================================================

function parseTickFromDeathKey(
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
// EVENT OUTPUT
// ============================================================

async function writeLifecycleEventStream(
  path,
  targetEpisodes
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
    const episode
    of targetEpisodes
  ) {

    for (
      const event
      of episode.rawEvents
    ) {

      writer.write(
        `${JSON.stringify({

          schemaVersion:
            1,

          canonical:
            false,

          deathIndex:
            episode.deathIndex,

          deathKey:
            episode.deathKey,

          assignedGoldActivationIndex:
            episode.activationIndex,

          assignedGoldActivationId:
            episode.activationId,

          assignedGoldEntityIndex:
            episode.entityIndex,

          activationTick:
            episode.activationTick,

          creditedPlayerQuality:
            episode
              ?.creditedPlayer
              ?.quality ??
            null,

          creditedPlayerName:
            episode
              ?.creditedPlayer
              ?.playerName ??
            null,

          ...event

        })}\n`
      );
    }
  }


  await finishWriter(
    writer
  );
}


// ============================================================
// JSONL
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


  await finishWriter(
    writer
  );
}


async function finishWriter(
  writer
) {

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


function tickToMatchTime(
  tick
) {

  return tick /
    TICK_RATE -
    MATCH_CLOCK_OFFSET_SECONDS;
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


function difference(
  a,
  b
) {

  if (
    !Number.isFinite(
      a
    )
    ||
    !Number.isFinite(
      b
    )
  ) {

    return null;
  }


  return a -
    b;
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
        ??
        'UNKNOWN'
      );


    map.set(
      key,
      (
        map.get(
          key
        )
        ??
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
      )
      /
      clean.length
  };
}


function quantile(
  values,
  q
) {

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

    return values[
      lower
    ];
  }


  const weight =
    position -
    lower;


  return values[
    lower
  ]
    *
    (
      1 -
      weight
    )
    +
    values[
      upper
    ]
    *
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


function formatSignedPercent(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'n/a';
  }


  const percent =
    value *
    100;


  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}pp`;
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


function printCounts(
  object
) {

  const entries =
    Object.entries(
      object
    );


  if (
    entries.length ===
    0
  ) {

    console.log(
      '  none'
    );

    return;
  }


  for (
    const [
      name,
      count
    ]
    of entries
  ) {

    console.log(
      `  ${name.padEnd(42)} ${count}`
    );
  }
}