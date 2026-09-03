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

const replayName = process.argv[2] ?? 'test';

const TICK_RATE = 64;
const MATCH_CLOCK_OFFSET_SECONDS = 30;
const ENTITY_INDEX_MASK = 0x3fff;

const DEFAULT_HU_PER_METER = 39.37;
const DEFAULT_RANGE_METERS = 45;
const DEFAULT_RANGE_HU =
  DEFAULT_HU_PER_METER *
  DEFAULT_RANGE_METERS;

const MOVEMENT_THRESHOLDS_HU = [
  8,
  16,
  32,
  64,
  128,
  256
];

const IMMEDIATE_SIGNAL_SECONDS = 0.25;

const IMMEDIATE_SIGNAL_TICKS =
  Math.ceil(
    IMMEDIATE_SIGNAL_SECONDS *
    TICK_RATE
  );

const RAW_PRE_START_TICKS = 2;
const RAW_POST_END_TICKS = 2;

const FALLBACK_MAX_LIFETIME_SECONDS = 60;

const FALLBACK_MAX_LIFETIME_TICKS =
  FALLBACK_MAX_LIFETIME_SECONDS *
  TICK_RATE;

const MAX_INTERPOLATION_GAP_SECONDS = 0.30;
const MAX_NEAREST_SAMPLE_DELTA_SECONDS = 0.15;


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
    'assigned_gold_lifecycle_discovery_v02.json'
  );

const outputEpisodesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );

const outputSnapshotsPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_snapshots_v02.jsonl'
  );


// ============================================================
// REQUIRED INPUTS
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
// PRIOR SUMMARIES
// ============================================================

const script55Summary =
  JSON.parse(
    readFileSync(
      script55SummaryPath,
      'utf8'
    )
  );

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
  script55Summary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 55 did not PASS validation.'
  );
}

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
// CANDIDATE VACUUM RANGE
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
// PLAYER STATE
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
// SCRIPT 73 CREDIT GROUPS
// ============================================================

console.log(
  'Loading Script 73 exact last-hit groups...'
);

const script73Groups =
  await loadJsonl(
    script73GroupsPath
  );

console.log(
  `Script 73 groups: ${script73Groups.length}`
);


const script73IsolatedMatchedGroups =
  script73Groups.filter(
    group => {
      const deaths =
        group?.deaths ??
        [];

      const matched =
        deaths.filter(
          row =>
            row?.groundSoulMatched ===
            true
        );

      return (
        deaths.length ===
        1
        &&
        matched.length ===
        1
      );
    }
  );


const cleanCreditGroups =
  script73Groups.filter(
    group => {
      const deaths =
        group?.deaths ??
        [];

      const matched =
        deaths.filter(
          row =>
            row?.groundSoulMatched ===
            true
        );

      const events =
        group
          ?.exact
          ?.events ??
        [];

      const units =
        finite(
          group
            ?.exact
            ?.lastHitUnits
        )
        ??
        events.reduce(
          (
            sum,
            row
          ) =>
            sum +
            (
              finite(
                row?.delta
              )
              ??
              0
            ),
          0
        );

      return (
        deaths.length ===
        1
        &&
        matched.length ===
        1
        &&
        units ===
        1
        &&
        events.length ===
        1
        &&
        finite(
          events[0]?.delta
        ) ===
        1
        &&
        Boolean(
          events[0]?.playerName
        )
      );
    }
  );


const creditByDeathIndex =
  new Map();


for (
  const group
  of script73Groups
) {
  const deaths =
    group?.deaths ??
    [];

  const matchedDeaths =
    deaths.filter(
      row =>
        row?.groundSoulMatched ===
        true
    );

  const events =
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
    events.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          finite(
            row?.delta
          )
          ??
          0
        ),
      0
    );

  const playerNames =
    [
      ...new Set(
        events
          .map(
            row =>
              row?.playerName
          )
          .filter(
            Boolean
          )
      )
    ];


  // ==========================================================
  // CLEAN ISOLATED PLAYER CREDIT
  // ==========================================================

  const clean =
    deaths.length ===
      1
    &&
    matchedDeaths.length ===
      1
    &&
    exactUnits ===
      1
    &&
    events.length ===
      1
    &&
    finite(
      events[0]?.delta
    ) ===
      1
    &&
    Boolean(
      events[0]?.playerName
    );


  if (
    clean
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
            events[0].playerName,

          team:
            finite(
              events[0].team
            ),

          controllerEntityIndex:
            finite(
              events[0].controllerEntityIndex
            ),

          delta:
            1,

          tick:
            finite(
              events[0].tick
            ),

          groupDeathCount:
            1,

          groupMatchedCount:
            1,

          exactCounterUnits:
            1
        }
      );
    }

    continue;
  }


  // ==========================================================
  // SHARED GROUP-LEVEL CREDIT
  //
  // Useful descriptively, but not clean per-Trooper identity.
  // ==========================================================

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
              events[0]?.team
            ),

          controllerEntityIndex:
            finite(
              events[0]?.controllerEntityIndex
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


  // ==========================================================
  // AMBIGUOUS
  // ==========================================================

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


console.log(
  `Script 73 isolated matched groups: ${script73IsolatedMatchedGroups.length}`
);

console.log(
  `Clean single-unit player-credit groups: ${cleanCreditGroups.length}`
);


// ============================================================
// SCRIPT 55 ACTIVATION STREAM
// ============================================================

console.log(
  'Loading Script 55 AssignedGold activation stream...'
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

const activationsByEntity =
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
// SCRIPT 55 MATCHED DEATHS
// ============================================================

console.log(
  'Loading Script 55 matched economic death stream...'
);

const rawDeathRows =
  await loadJsonl(
    deathStreamPath
  );

const matchedDeathRows =
  rawDeathRows.filter(
    isGroundSoulMatched
  );

console.log(
  `Matched economic deaths: ${matchedDeathRows.length}`
);


// ============================================================
// BUILD EPISODE TARGETS
// ============================================================

const episodes =
  [];


for (
  const deathRow
  of matchedDeathRows
) {
  const target =
    buildEpisodeTarget(
      deathRow
    );

  if (
    target
  ) {
    episodes.push(
      target
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
// INDEX EPISODES BY POOLED ASSIGNEDGOLD ENTITY
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
//
// V02 samples current AssignedGold state directly on DEMO_PACKET
// ticks rather than relying on mutation events for lifecycle
// observation.
//
// This is deliberately better suited for identifying periods
// where an orb remains stationary on the ground.
// ============================================================

const pointerByEntity =
  new Map();

let demoPackets =
  0;

let assignedGoldSnapshotsObserved =
  0;

let capturedSnapshotRows =
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

    const demo =
      parser.getDemo();

    const entities =
      demo.getEntitiesByClassName(
        'CCitadel_Pickup_AssignedGold'
      );


    for (
      const entity
      of entities
    ) {
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

      const targetEpisodes =
        episodesByEntity.get(
          entityIndex
        );

      if (
        !targetEpisodes
        ||
        targetEpisodes.length ===
        0
      ) {
        continue;
      }


      let pointer =
        pointerByEntity.get(
          entityIndex
        )
        ??
        0;


      while (
        pointer <
          targetEpisodes.length
        &&
        tick >
          targetEpisodes[
            pointer
          ].rawEndTick
      ) {
        pointer++;
      }


      pointerByEntity.set(
        entityIndex,
        pointer
      );


      if (
        pointer >=
        targetEpisodes.length
      ) {
        continue;
      }


      for (
        let i =
          pointer;

        i <
          targetEpisodes.length;

        i++
      ) {
        const episode =
          targetEpisodes[i];

        if (
          episode.rawStartTick >
          tick
        ) {
          break;
        }

        if (
          tick >
          episode.rawEndTick
        ) {
          continue;
        }

        const snapshot =
          buildRawSnapshot(
            entity,
            tick
          );

        assignedGoldSnapshotsObserved++;

        episode.rawSnapshots.push(
          snapshot
        );

        capturedSnapshotRows++;
      }
    }
  }
);


console.log('');

console.log(
  'Rescanning raw AssignedGold state on DEMO_PACKET ticks...'
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
// CLEAN CREDIT COHORTS
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
// SCRIPT55 END REASONS
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
// SIGNATURE COHORTS
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


const insidePersistent =
  cleanInside45.filter(
    row =>
      row.candidateLifecycleSignature ===
      'PERSISTENT_FLOOR_STATE_CANDIDATE'
  );


const outsidePersistent =
  cleanOutside45.filter(
    row =>
      row.candidateLifecycleSignature ===
      'PERSISTENT_FLOOR_STATE_CANDIDATE'
  );


// ============================================================
// RAW COVERAGE
// ============================================================

const episodesWithRawSnapshots =
  analyzedEpisodes.filter(
    row =>
      row
        .rawObservation
        .snapshotCount >
      0
  );


const episodesWithPosition =
  analyzedEpisodes.filter(
    row =>
      row
        .rawObservation
        .positionObservationCount >
      0
  );


const cleanWithPosition =
  cleanCreditedEpisodes.filter(
    row =>
      row
        .rawObservation
        .positionObservationCount >
      0
  );


// ============================================================
// TIMING DISTRIBUTIONS
// ============================================================

const insideFirst32MoveSeconds =
  finiteValues(
    cleanInside45.map(
      row =>
        row
          ?.candidateSignals
          ?.movement
          ?.['32']
          ?.secondsAfterActivation
    )
  );


const outsideFirst32MoveSeconds =
  finiteValues(
    cleanOutside45.map(
      row =>
        row
          ?.candidateSignals
          ?.movement
          ?.['32']
          ?.secondsAfterActivation
    )
  );


const insideFirstTargetSeconds =
  finiteValues(
    cleanInside45.map(
      row =>
        row
          ?.candidateSignals
          ?.firstValidVacuumTarget
          ?.secondsAfterActivation
    )
  );


const outsideFirstTargetSeconds =
  finiteValues(
    cleanOutside45.map(
      row =>
        row
          ?.candidateSignals
          ?.firstValidVacuumTarget
          ?.secondsAfterActivation
    )
  );


const insideInactiveSeconds =
  finiteValues(
    cleanInside45.map(
      row =>
        row
          ?.candidateSignals
          ?.firstActiveFalse
          ?.secondsAfterActivation
    )
  );


const outsideInactiveSeconds =
  finiteValues(
    cleanOutside45.map(
      row =>
        row
          ?.candidateSignals
          ?.firstActiveFalse
          ?.secondsAfterActivation
    )
  );


const insideDurations =
  finiteValues(
    cleanInside45.map(
      row =>
        row
          ?.script55Lifecycle
          ?.durationSeconds
    )
  );


const outsideDurations =
  finiteValues(
    cleanOutside45.map(
      row =>
        row
          ?.script55Lifecycle
          ?.durationSeconds
    )
  );


// ============================================================
// DISTANCE DISTRIBUTIONS
// ============================================================

const cleanCreditedDistances =
  finiteValues(
    cleanCreditedEpisodes.map(
      row =>
        row
          ?.creditedPlayer
          ?.distanceAtDeath3D
    )
  );


const immediateDistances =
  finiteValues(
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
  );


const delayedOrPersistentDistances =
  finiteValues(
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
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedMatchedDeaths =
  firstFinite([
    script55Summary
      ?.oneToOneResults
      ?.matchedDeaths,

    replayName ===
      'test'
      ? 1388
      : null
  ]);


const expectedIsolatedMatched =
  firstFinite([
    script73Summary
      ?.sourceCounts
      ?.isolatedMatched,

    replayName ===
      'test'
      ? 1003
      : null
  ]);


const derivedCleanCreditCount =
  cleanCreditGroups.length;


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

  script73IsolatedMatchedCount:
    check(
      script73IsolatedMatchedGroups.length,
      expectedIsolatedMatched,
      expectedIsolatedMatched ===
        null
        ? script73IsolatedMatchedGroups.length >
          0
        : script73IsolatedMatchedGroups.length ===
          expectedIsolatedMatched
    ),

  cleanSingleUnitCreditCount:
    check(
      cleanCreditedEpisodes.length,
      derivedCleanCreditCount,
      cleanCreditedEpisodes.length ===
        derivedCleanCreditCount
    ),

  expectedTestCleanSingleUnitCreditCount:
    check(
      cleanCreditedEpisodes.length,
      replayName ===
        'test'
        ? 991
        : '>0',
      replayName ===
        'test'
        ? cleanCreditedEpisodes.length ===
          991
        : cleanCreditedEpisodes.length >
          0
    ),

  allEpisodesHaveEntityAndActivationTick:
    check(
      analyzedEpisodes.filter(
        row =>
          Number.isFinite(
            row
              ?.assignedGold
              ?.entityIndex
          )
          &&
          Number.isFinite(
            row
              ?.assignedGold
              ?.activationTick
          )
      ).length,
      analyzedEpisodes.length,
      analyzedEpisodes.every(
        row =>
          Number.isFinite(
            row
              ?.assignedGold
              ?.entityIndex
          )
          &&
          Number.isFinite(
            row
              ?.assignedGold
              ?.activationTick
          )
      )
    ),

  demoPacketsObserved:
    check(
      demoPackets,
      '>0',
      demoPackets >
      0
    ),

  assignedGoldSnapshotsObserved:
    check(
      assignedGoldSnapshotsObserved,
      '>0',
      assignedGoldSnapshotsObserved >
      0
    ),

  rawEpisodeCoverage:
    check(
      episodesWithRawSnapshots.length,
      `>=95% of ${analyzedEpisodes.length}`,
      rate(
        episodesWithRawSnapshots.length,
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
    'ASSIGNED_GOLD_LIFECYCLE_DISCOVERY_V02',

  canonical:
    false,

  artifactRole:
    'CURRENT_DIAGNOSTIC',

  status:
    validationPass
      ? 'ASSIGNED_GOLD_LIFECYCLE_DISCOVERY_READY'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',

  supersedes:
    'ASSIGNED_GOLD_LIFECYCLE_DISCOVERY_V01',

  purpose: [
    'Separate AssignedGold production from immediate vacuuming, delayed vacuuming, persistence, and termination.',
    'Use exact m_iLastHits player identity only in clean isolated single-unit Script 73 groups.',
    'Measure credited-player distance at Trooper death rather than nearest-opponent distance.',
    'Sample raw CCitadel_Pickup_AssignedGold state on DEMO_PACKET ticks rather than depending on entity-mutation class-name filtering.',
    'Discover lifecycle signatures before formal 45m vacuum-radius validation.'
  ],

  correctionFromV01: {
    cleanCreditDenominator:
      'V01 incorrectly expected all 1003 isolated matched groups to satisfy the stricter single-event +1 player-credit definition. The clean player-identity cohort is derived independently from Script 73 groups and is 991 in test.dem.',

    rawSampling:
      'V01 returned zero raw AssignedGold events because its class-name helper could return an entity instance name before calling getClassName(). V02 avoids that failure by sampling demo.getEntitiesByClassName("CCitadel_Pickup_AssignedGold") directly.',

    validationPath:
      'V01 checked entityIndex and activationTick at the episode top level even though analyzed episodes store them under assignedGold. V02 validates the correct nested paths.',

    positionReconstruction:
      'V02 follows Script 55 world-position behavior and allows missing Z telemetry to fall back to z=0 instead of discarding the position entirely.'
  },

  semanticLimits: {
    production:
      'Script 55 death-to-AssignedGold matching is operational evidence of an AssignedGold episode associated with a Trooper death.',

    lastHitPlayer:
      'Clean isolated exact m_iLastHits credit is a strongly associated player-credit signal, not direct victim-target telemetry.',

    movement:
      'Observed AssignedGold displacement is not automatically equivalent to successful acquisition.',

    vacuumTarget:
      'm_hVacuumTarget remains magnetic-target telemetry only.',

    inactive:
      'BECAME_INACTIVE / m_bActive=false is a lifecycle termination signal; collection versus expiration is not yet distinguished.',

    floorState:
      'PERSISTENT_FLOOR_STATE_CANDIDATE remains an operational discovery label.'
  },

  candidateRange: {
    meters:
      candidateRangeMeters,

    internalUnits:
      candidateRangeHU,

    currentInterpretation:
      'Candidate vacuum/proximity radius, not a soul-production radius.'
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

    script73IsolatedMatchedGroups:
      script73IsolatedMatchedGroups.length,

    cleanSingleUnitCreditedEpisodes:
      cleanCreditedEpisodes.length,

    cleanInside45m:
      cleanInside45.length,

    cleanOutside45m:
      cleanOutside45.length,

    cleanDistanceUnresolved:
      cleanDistanceUnresolved.length,

    demoPackets,

    assignedGoldSnapshotsObserved,

    capturedSnapshotRows,

    episodesWithRawSnapshots:
      episodesWithRawSnapshots.length,

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
        insidePersistent.length
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
        outsidePersistent.length
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

    firstActiveFalseSeconds: {
      inside45m:
        summarizeNumbers(
          insideInactiveSeconds
        ),

      outside45m:
        summarizeNumbers(
          outsideInactiveSeconds
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
    strongestAlreadyObservedSignal:
      'If the V01 duration separation reproduces, short inside-range lifetimes versus long outside-range lifetimes strongly support different post-production lifecycle states even before movement semantics are fully validated.',

    expectedVacuumSignature:
      'Inside-range credited players should show earlier movement, target assignment, or inactivity than outside-range credited players.',

    expirationCandidate:
      'Long approximately stationary episodes terminating around a common upper lifetime become candidates for uncollected expiration, but require separate validation.',

    nextStep:
      'If V02 passes and distance strongly separates lifecycle timing, Script 76 should formally classify immediate-vacuum versus floor-drop episodes and estimate the vacuum threshold.'
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

    snapshots:
      outputSnapshotsPath
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
  outputEpisodesPath,
  analyzedEpisodes
);

await writeSnapshotStream(
  outputSnapshotsPath,
  episodes
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNED GOLD LIFECYCLE DISCOVERY V0.2'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Matched AssignedGold episodes: ${analyzedEpisodes.length}`
);

console.log(
  `Script 73 isolated matched groups: ${script73IsolatedMatchedGroups.length}`
);

console.log(
  `Clean single-unit credited-player episodes: ${cleanCreditedEpisodes.length}`
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

console.log(
  `Raw snapshots captured: ${capturedSnapshotRows}`
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
  'FIRST ACTIVE=FALSE'
);

console.log(
  '------------------'
);

console.log(
  `Inside <=45m: ${formatDistribution(summarizeNumbers(insideInactiveSeconds))}`
);

console.log(
  `Outside >45m: ${formatDistribution(summarizeNumbers(outsideInactiveSeconds))}`
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
  of cleanOutside45.slice(
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
    `inactive=${formatNumber(row.candidateSignals.firstActiveFalse?.secondsAfterActivation)} ` +
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
  `Episodes:\n${outputEpisodesPath}`
);

console.log('');

console.log(
  `Snapshots:\n${outputSnapshotsPath}`
);

console.log('');


// ============================================================
// BUILD ONE EPISODE
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
      linkedActivation?.entityIndex
    ]);

  const activationTick =
    firstFinite([
      groundSoul?.activationTick,
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
      'SCRIPT55_ACTIVATION_STREAM_END_TICK';
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
      linkedActivation?.endTick ??
      null,

    script55EndTimeSeconds:
      linkedActivation?.endTimeSeconds ??
      null,

    script55DurationSeconds:
      firstFinite([
        groundSoul?.durationSeconds,
        linkedActivation?.durationSeconds
      ]),

    script55EndReason:
      groundSoul?.endReason ??
      linkedActivation?.endReason ??
      null,

    script55FirstInteractiveTick:
      linkedActivation?.firstInteractiveTick ??
      null,

    script55FirstValidVacuumTarget:
      linkedActivation?.firstValidVacuumTarget ??
      null,

    script55VacuumTargetTransitions:
      linkedActivation?.vacuumTargetTransitions ??
      [],

    creditedPlayer:
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
      },

    rawStartTick:
      activationTick -
      RAW_PRE_START_TICKS,

    rawEndTick,

    rawEndSource,

    rawSnapshots:
      []
  };
}


// ============================================================
// ANALYZE EPISODE
// ============================================================

function analyzeEpisode(
  episode
) {
  const snapshots =
    episode.rawSnapshots
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
      );

  const postActivation =
    snapshots.filter(
      row =>
        row.tick >=
        episode.activationTick
    );

  const positionSnapshots =
    postActivation.filter(
      row =>
        Boolean(
          row.position
        )
    );

  const baselinePosition =
    episode.activationPosition
    ??
    positionSnapshots[0]?.position
    ??
    null;


  // ==========================================================
  // MOVEMENT
  // ==========================================================

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
      const snapshot
      of positionSnapshots
    ) {
      maximumDisplacement3D =
        Math.max(
          maximumDisplacement3D,
          getDistance3D(
            baselinePosition,
            snapshot.position
          )
        );

      maximumDisplacementXY =
        Math.max(
          maximumDisplacementXY,
          getDistanceXY(
            baselinePosition,
            snapshot.position
          )
        );
    }


    for (
      const threshold
      of MOVEMENT_THRESHOLDS_HU
    ) {
      const first =
        positionSnapshots.find(
          snapshot =>
            getDistance3D(
              baselinePosition,
              snapshot.position
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


  // ==========================================================
  // VACUUM TARGET / INACTIVITY
  // ==========================================================

  const firstTargetSnapshot =
    postActivation.find(
      row =>
        row.vacuumTargetHandle !==
        null
    )
    ??
    null;


  const firstValidVacuumTarget =
    firstTargetSnapshot
      ? buildSignalSummary(
        firstTargetSnapshot,
        episode,
        {
          vacuumTargetHandle:
            firstTargetSnapshot.vacuumTargetHandle,

          vacuumTargetPawnEntityIndex:
            firstTargetSnapshot
              .vacuumTargetPawnEntityIndex,

          vacuumTargetPlayerName:
            firstTargetSnapshot
              .vacuumTargetPlayerName,

          vacuumTargetPlayerTeam:
            firstTargetSnapshot
              .vacuumTargetPlayerTeam
        }
      )
      : null;


  const firstActiveFalseSnapshot =
    postActivation.find(
      row =>
        row.active ===
        false
    )
    ??
    null;


  const firstInteractiveFalseSnapshot =
    postActivation.find(
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


  // ==========================================================
  // COMBINED MOVEMENT / VACUUM-TARGET CANDIDATE
  // ==========================================================

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


  // ==========================================================
  // DURATION
  // ==========================================================

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

      postActivation.length >
        0
        ? (
          postActivation[
            postActivation.length -
            1
          ].tick -
          episode.activationTick
        )
        /
        TICK_RATE
        : null
    ]);


  const creditedPlayer =
    analyzeCreditedPlayer(
      episode,
      firstCombinedVacuumCandidate
    );


  const candidateLifecycleSignature =
    classifyCandidateLifecycle({
      snapshotCount:
        postActivation.length,

      firstCombinedVacuumCandidate,

      firstMovement32,

      firstValidVacuumTarget,

      maximumDisplacement3D,

      lifecycleDurationSeconds
    });


  return {
    schemaVersion:
      2,

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


    creditedPlayer,


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
      snapshotCount:
        postActivation.length,

      positionObservationCount:
        positionSnapshots.length,

      firstObservedTick:
        postActivation[0]?.tick ??
        null,

      lastObservedTick:
        postActivation[
          postActivation.length -
          1
        ]?.tick ??
        null,

      baselinePosition,

      maximumDisplacement3D,

      maximumDisplacementXY,

      distinctValidVacuumTargetHandles:
        [
          ...new Set(
            postActivation
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
            postActivation
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
        firstActiveFalseSnapshot
          ? buildSignalSummary(
            firstActiveFalseSnapshot,
            episode
          )
          : null,

      firstInteractiveFalse:
        firstInteractiveFalseSnapshot
          ? buildSignalSummary(
            firstInteractiveFalseSnapshot,
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
// CREDITED PLAYER
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


  const distanceBand =
    Number.isFinite(
      distanceAtDeath3D
    )
      ? (
        distanceAtDeath3D <=
        candidateRangeHU
          ? 'WITHIN_45M'
          : 'OUTSIDE_45M'
      )
      : 'DISTANCE_UNRESOLVED';


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
// OPERATIONAL LIFECYCLE LABEL
// ============================================================

function classifyCandidateLifecycle({
  snapshotCount,
  firstCombinedVacuumCandidate,
  firstMovement32,
  firstValidVacuumTarget,
  maximumDisplacement3D,
  lifecycleDurationSeconds
}) {
  if (
    snapshotCount ===
    0
  ) {
    return 'NO_RAW_LIFECYCLE_OBSERVATION';
  }

  if (
    firstCombinedVacuumCandidate
      ?.immediate ===
    true
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
  entity,
  tick
) {
  const vacuumTargetHandle =
    handleOrNull(
      safeGetField(
        entity,
        'm_hVacuumTarget'
      )
    );

  const vacuumTargetPawnEntityIndex =
    decodeHandleEntityIndex(
      vacuumTargetHandle
    );

  const vacuumTargetPlayer =
    vacuumTargetPawnEntityIndex !==
      null
      ? playerByPawnIndex.get(
        vacuumTargetPawnEntityIndex
      )
        ??
        null
      : null;


  return {
    tick,

    timeSeconds:
      tickToMatchTime(
        tick
      ),

    entityIndex:
      getEntityIndex(
        entity
      ),

    position:
      getWorldPosition(
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
      serializeScalar(
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
// SIGNAL
// ============================================================

function buildSignalSummary(
  snapshot,
  episode,
  extra = {}
) {
  return {
    tick:
      snapshot.tick,

    timeSeconds:
      snapshot.timeSeconds,

    ticksAfterActivation:
      snapshot.tick -
      episode.activationTick,

    secondsAfterActivation:
      (
        snapshot.tick -
        episode.activationTick
      )
      /
      TICK_RATE,

    position:
      snapshot.position,

    active:
      snapshot.active,

    interactive:
      snapshot.interactive,

    ...extra
  };
}


// ============================================================
// NEXT POOLED ACTIVATION
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
// ACTIVATION STREAM NORMALIZATION
//
// Script 55 schema:
//   timing.activationTick
//   timing.endTick
//   state.position
//   state.team
//   lifecycle.*
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
    finite(
      row?.entityIndex
    );

  const activationTick =
    firstFinite([
      row
        ?.timing
        ?.activationTick,

      row?.activationTick
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
        row
          ?.timing
          ?.activationTimeSeconds,

        row?.activationTimeSeconds,

        tickToMatchTime(
          activationTick
        )
      ]),

    position:
      normalizePosition(
        row
          ?.state
          ?.position
      )
      ??
      normalizePosition(
        row?.position
      ),

    team:
      firstFinite([
        row
          ?.state
          ?.team,

        row?.team
      ]),

    endTick:
      firstFinite([
        row
          ?.timing
          ?.endTick,

        row?.endTick
      ]),

    endTimeSeconds:
      firstFinite([
        row
          ?.timing
          ?.endTimeSeconds,

        row?.endTimeSeconds
      ]),

    durationSeconds:
      firstFinite([
        row
          ?.timing
          ?.durationSeconds,

        row?.durationSeconds
      ]),

    endReason:
      row
        ?.lifecycle
        ?.endReason ??
      row?.endReason ??
      null,

    firstInteractiveTick:
      firstFinite([
        row
          ?.lifecycle
          ?.firstInteractiveTick,

        row?.firstInteractiveTick
      ]),

    firstValidVacuumTarget:
      row
        ?.lifecycle
        ?.firstValidVacuumTarget ??
      row?.firstValidVacuumTarget ??
      null,

    vacuumTargetTransitions:
      row
        ?.lifecycle
        ?.vacuumTargetTransitions ??
      row?.vacuumTargetTransitions ??
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
      .push(
        {
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
        }
      );
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
      candidates.push(
        {
          row,
          delta
        }
      );
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
// SCRIPT55-COMPATIBLE WORLD POSITION
// ============================================================

function getWorldPosition(
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
      (
        cellZ !==
          null
        &&
        vecZ !==
          null
      )
        ? (
          cellZ *
          512 -
          16384 +
          vecZ
        )
        : 0
  };
}


// ============================================================
// ENTITY HELPERS
// ============================================================

function safeGetField(
  entity,
  fieldName
) {
  try {
    if (
      typeof entity?.getField ===
      'function'
    ) {
      return entity.getField(
        fieldName
      );
    }
  } catch {}

  return undefined;
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
    if (
      typeof entity?.getIndex ===
      'function'
    ) {
      return finite(
        entity.getIndex()
      );
    }
  } catch {}

  return null;
}


// ============================================================
// HANDLE
//
// Follows Script 55's BigInt-safe treatment.
// ============================================================

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
    const value =
      BigInt(
        handle
      );

    if (
      value <=
        0n
      ||
      value ===
        16777215n
    ) {
      return null;
    }

    return Number(
      value &
      BigInt(
        ENTITY_INDEX_MASK
      )
    );
  } catch {
    return null;
  }
}


function serializeScalar(
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

  if (
    typeof value ===
    'bigint'
  ) {
    return value.toString();
  }

  if (
    typeof value ===
      'number'
    ||
    typeof value ===
      'string'
    ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  try {
    return String(
      value
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
// MATCH
// ============================================================

function isGroundSoulMatched(
  row
) {
  return (
    row
      ?.match
      ?.status ===
    'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
  )
  ||
  Boolean(
    row?.groundSoul
  );
}


// ============================================================
// GEOMETRY
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
      value[2],
      0
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
    (
      a.z ??
      0
    )
    -
    (
      b.z ??
      0
    );

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
    dx *
    dx
    +
    dy *
    dy
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
// SNAPSHOT OUTPUT
// ============================================================

async function writeSnapshotStream(
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
      const snapshot
      of episode.rawSnapshots
    ) {
      writer.write(
        `${JSON.stringify({
          schemaVersion:
            2,

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

          ...snapshot
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


function finiteValues(
  values
) {
  return values.filter(
    Number.isFinite
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