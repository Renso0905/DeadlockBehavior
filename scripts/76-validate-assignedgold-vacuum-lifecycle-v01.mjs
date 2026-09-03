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
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const TICK_RATE =
  64;


const HU_PER_METER =
  39.37;


const DEFAULT_RANGE_METERS =
  45;


const DEFAULT_RANGE_HU =
  DEFAULT_RANGE_METERS *
  HU_PER_METER;


// ============================================================
// OPERATIONAL WINDOWS
//
// These remain provisional.
//
// "Immediate" is retained only as a descriptive timing bucket.
// The actual vacuum mechanism is tested primarily through:
//
//   null -> valid player m_hVacuumTarget transition
//
// followed by:
//
//   m_bActive -> false
// ============================================================

const IMMEDIATE_TARGET_SECONDS =
  0.25;


const EXPIRATION_CANDIDATE_SECONDS =
  40;


const EXPIRATION_TOLERANCE_SECONDS =
  0.05;


// ============================================================
// PLAYER-STATE RECONSTRUCTION
// ============================================================

const MAX_INTERPOLATION_GAP_SECONDS =
  0.30;


const MAX_NEAREST_SAMPLE_DELTA_SECONDS =
  0.15;


// ============================================================
// PATHS
// ============================================================

const summary75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_discovery_v02.json'
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const snapshots75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_snapshots_v02.jsonl'
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
    'assigned_gold_vacuum_lifecycle_validation_v01.json'
  );


const outputEpisodesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );


const outputTransitionsPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_target_transitions_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    summary75Path,
    episodes75Path,
    snapshots75Path,
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
// LOAD SCRIPT 75 SUMMARY
// ============================================================

const summary75 =
  JSON.parse(
    readFileSync(
      summary75Path,
      'utf8'
    )
  );


if (
  summary75
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 75 V02 did not PASS.'
  );
}


const candidateRangeHU =
  firstFinite([
    summary75
      ?.candidateRange
      ?.internalUnits,

    DEFAULT_RANGE_HU
  ]);


const candidateRangeMeters =
  firstFinite([
    summary75
      ?.candidateRange
      ?.meters,

    DEFAULT_RANGE_METERS
  ]);


// ============================================================
// LOAD EPISODES
// ============================================================

console.log('');

console.log(
  'Loading Script 75 lifecycle episodes...'
);


const episodes =
  await loadJsonl(
    episodes75Path
  );


console.log(
  `Episodes: ${episodes.length}`
);


// ============================================================
// LOAD SNAPSHOTS
// ============================================================

console.log(
  'Loading Script 75 raw lifecycle snapshots...'
);


const snapshotRows =
  await loadJsonl(
    snapshots75Path
  );


console.log(
  `Snapshots: ${snapshotRows.length}`
);


const snapshotsByDeathIndex =
  new Map();


for (
  const row
  of snapshotRows
) {

  const deathIndex =
    finite(
      row?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  if (
    !snapshotsByDeathIndex.has(
      deathIndex
    )
  ) {

    snapshotsByDeathIndex.set(
      deathIndex,
      []
    );
  }


  snapshotsByDeathIndex
    .get(
      deathIndex
    )
    .push(
      normalizeSnapshot(
        row
      )
    );
}


for (
  const rows
  of snapshotsByDeathIndex.values()
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


// ============================================================
// LOAD PLAYER TIMELINES
// ============================================================

console.log(
  'Loading player timelines...'
);


const timelines =
  await loadPlayerTimelines(
    playerStatePath
  );


console.log(
  `Player timelines: ${timelines.size}`
);


// ============================================================
// ANALYZE EPISODES
// ============================================================

const analyzed =
  episodes.map(
    analyzeEpisode
  );


// ============================================================
// CLEAN CREDIT COHORT
// ============================================================

const clean =
  analyzed.filter(
    row =>
      row
        ?.creditedPlayer
        ?.quality ===
      'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'
  );


const cleanInside =
  clean.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'WITHIN_45M'
  );


const cleanOutside =
  clean.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'OUTSIDE_45M'
  );


const cleanUnresolvedDistance =
  clean.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'DISTANCE_UNRESOLVED'
  );


// ============================================================
// TARGET STATE PARTITIONS
// ============================================================

const cleanTargetTransition =
  clean.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NULL_TO_PLAYER_TARGET_TRANSITION'
  );


const cleanValidAtFirstSnapshot =
  clean.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'PLAYER_TARGET_VALID_AT_FIRST_SNAPSHOT'
  );


const cleanNoPlayerTarget =
  clean.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NO_PLAYER_TARGET_OBSERVED'
  );


const cleanUnresolvedTarget =
  clean.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'VALID_HANDLE_WITHOUT_RESOLVED_PLAYER'
  );


// ============================================================
// IMMEDIATE VS DELAYED CLEAN TRANSITIONS
// ============================================================

const immediateTransitions =
  cleanTargetTransition.filter(
    row =>
      Number.isFinite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      )
      &&
      row
        .vacuum
        .targetDelaySeconds <=
      IMMEDIATE_TARGET_SECONDS
  );


const delayedTransitions =
  cleanTargetTransition.filter(
    row =>
      Number.isFinite(
        row
          ?.vacuum
          ?.targetDelaySeconds
      )
      &&
      row
        .vacuum
        .targetDelaySeconds >
      IMMEDIATE_TARGET_SECONDS
  );


// ============================================================
// TARGET GEOMETRY
// ============================================================

const targetGeometryResolved =
  cleanTargetTransition.filter(
    row =>
      Number.isFinite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnset3D
      )
  );


const targetInside45AtOnset =
  targetGeometryResolved.filter(
    row =>
      row
        .vacuum
        .targetGeometry
        .distanceAtOnset3D <=
      candidateRangeHU
  );


const targetOutside45AtOnset =
  targetGeometryResolved.filter(
    row =>
      row
        .vacuum
        .targetGeometry
        .distanceAtOnset3D >
      candidateRangeHU
  );


const targetInside45XYAtOnset =
  targetGeometryResolved.filter(
    row =>
      Number.isFinite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnsetXY
      )
      &&
      row
        .vacuum
        .targetGeometry
        .distanceAtOnsetXY <=
      candidateRangeHU
  );


// ============================================================
// DELAYED CROSSING TEST
//
// Require:
//
//   target transition > 0.25 s after activation
//   previous snapshot geometry resolved
//   onset geometry resolved
//
// Strong candidate support:
//   previous >45m
//   onset <=45m
// ============================================================

const delayedCrossingComparable =
  delayedTransitions.filter(
    row =>
      Number.isFinite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceBeforeOnset3D
      )
      &&
      Number.isFinite(
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnset3D
      )
  );


const delayedCrossed45 =
  delayedCrossingComparable.filter(
    row =>
      row
        .vacuum
        .targetGeometry
        .distanceBeforeOnset3D >
      candidateRangeHU
      &&
      row
        .vacuum
        .targetGeometry
        .distanceAtOnset3D <=
      candidateRangeHU
  );


const delayedOnsetInside45 =
  delayedCrossingComparable.filter(
    row =>
      row
        .vacuum
        .targetGeometry
        .distanceAtOnset3D <=
      candidateRangeHU
  );


const delayedPriorOutside45 =
  delayedCrossingComparable.filter(
    row =>
      row
        .vacuum
        .targetGeometry
        .distanceBeforeOnset3D >
      candidateRangeHU
  );


// ============================================================
// TARGET -> INACTIVE LAG
// ============================================================

const targetToInactiveValues =
  finiteValues(
    cleanTargetTransition.map(
      row =>
        row
          ?.vacuum
          ?.targetToInactiveSeconds
    )
  );


const immediateTargetToInactiveValues =
  finiteValues(
    immediateTransitions.map(
      row =>
        row
          ?.vacuum
          ?.targetToInactiveSeconds
    )
  );


const delayedTargetToInactiveValues =
  finiteValues(
    delayedTransitions.map(
      row =>
        row
          ?.vacuum
          ?.targetToInactiveSeconds
    )
  );


// ============================================================
// NO-TARGET / EXPIRATION CANDIDATES
// ============================================================

const noTargetInactive =
  cleanNoPlayerTarget.filter(
    row =>
      row
        ?.termination
        ?.activeFalseObserved ===
      true
  );


const expirationCandidates =
  noTargetInactive.filter(
    row =>
      Number.isFinite(
        row
          ?.termination
          ?.durationSeconds
      )
      &&
      Math.abs(
        row
          .termination
          .durationSeconds -
        EXPIRATION_CANDIDATE_SECONDS
      ) <=
      EXPIRATION_TOLERANCE_SECONDS
  );


const noTargetNon40 =
  noTargetInactive.filter(
    row =>
      !(
        Number.isFinite(
          row
            ?.termination
            ?.durationSeconds
        )
        &&
        Math.abs(
          row
            .termination
            .durationSeconds -
          EXPIRATION_CANDIDATE_SECONDS
        ) <=
        EXPIRATION_TOLERANCE_SECONDS
      )
  );


const expirationInside =
  expirationCandidates.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'WITHIN_45M'
  );


const expirationOutside =
  expirationCandidates.filter(
    row =>
      row
        ?.creditedPlayer
        ?.distanceBand ===
      'OUTSIDE_45M'
  );


// ============================================================
// TARGET PLAYER VS CREDITED PLAYER
// ============================================================

const targetIdentityComparable =
  cleanTargetTransition.filter(
    row =>
      Boolean(
        row
          ?.vacuum
          ?.targetPlayerName
      )
      &&
      Boolean(
        row
          ?.creditedPlayer
          ?.playerName
      )
  );


const targetSameAsCredited =
  targetIdentityComparable.filter(
    row =>
      row
        .vacuum
        .targetPlayerName ===
      row
        .creditedPlayer
        .playerName
  );


const targetOtherSameTeam =
  targetIdentityComparable.filter(
    row =>
      row
        .vacuum
        .targetPlayerName !==
      row
        .creditedPlayer
        .playerName
      &&
      row
        .vacuum
        .targetPlayerTeam ===
      row
        .creditedPlayer
        .team
  );


const targetOtherTeam =
  targetIdentityComparable.filter(
    row =>
      Number.isFinite(
        row
          ?.vacuum
          ?.targetPlayerTeam
      )
      &&
      Number.isFinite(
        row
          ?.creditedPlayer
          ?.team
      )
      &&
      row
        .vacuum
        .targetPlayerTeam !==
      row
        .creditedPlayer
        .team
  );


// ============================================================
// DISTANCE / DELAY DISTRIBUTIONS
// ============================================================

const targetOnset3DValues =
  finiteValues(
    cleanTargetTransition.map(
      row =>
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnset3D
    )
  );


const targetOnsetXYValues =
  finiteValues(
    cleanTargetTransition.map(
      row =>
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceAtOnsetXY
    )
  );


const targetPrior3DValues =
  finiteValues(
    delayedCrossingComparable.map(
      row =>
        row
          ?.vacuum
          ?.targetGeometry
          ?.distanceBeforeOnset3D
    )
  );


const targetDelayValues =
  finiteValues(
    cleanTargetTransition.map(
      row =>
        row
          ?.vacuum
          ?.targetDelaySeconds
    )
  );


const noTargetDurationValues =
  finiteValues(
    cleanNoPlayerTarget.map(
      row =>
        row
          ?.termination
          ?.durationSeconds
    )
  );


// ============================================================
// INSIDE / OUTSIDE TARGET TIMING
// ============================================================

const insideWithTargetTransition =
  cleanInside.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NULL_TO_PLAYER_TARGET_TRANSITION'
  );


const outsideWithTargetTransition =
  cleanOutside.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NULL_TO_PLAYER_TARGET_TRANSITION'
  );


const insideNoTarget =
  cleanInside.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NO_PLAYER_TARGET_OBSERVED'
  );


const outsideNoTarget =
  cleanOutside.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NO_PLAYER_TARGET_OBSERVED'
  );


const insideTargetDelay =
  finiteValues(
    insideWithTargetTransition.map(
      row =>
        row
          ?.vacuum
          ?.targetDelaySeconds
    )
  );


const outsideTargetDelay =
  finiteValues(
    outsideWithTargetTransition.map(
      row =>
        row
          ?.vacuum
          ?.targetDelaySeconds
    )
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedEpisodes =
  finite(
    summary75
      ?.sourceCounts
      ?.script55MatchedDeaths
  );


const expectedClean =
  finite(
    summary75
      ?.sourceCounts
      ?.cleanSingleUnitCreditedEpisodes
  );


const expectedSnapshots =
  finite(
    summary75
      ?.sourceCounts
      ?.capturedSnapshotRows
  );


const analyzedSnapshotCount =
  analyzed.reduce(
    (
      sum,
      row
    ) =>
      sum +
      row.snapshotCount,
    0
  );


const targetPartitionTotal =
  cleanTargetTransition.length +
  cleanValidAtFirstSnapshot.length +
  cleanNoPlayerTarget.length +
  cleanUnresolvedTarget.length;


const validationChecks = {

  script75Passed:
    check(
      summary75
        ?.validation
        ?.pass,
      true,
      summary75
        ?.validation
        ?.pass ===
      true
    ),


  episodeCountPreserved:
    check(
      analyzed.length,
      expectedEpisodes,
      expectedEpisodes ===
        null
        ? analyzed.length >
          0
        : analyzed.length ===
          expectedEpisodes
    ),


  expectedTestEpisodeCount:
    check(
      analyzed.length,
      replayName ===
        'test'
        ? 1388
        : '>0',
      replayName ===
        'test'
        ? analyzed.length ===
          1388
        : analyzed.length >
          0
    ),


  cleanCreditCountPreserved:
    check(
      clean.length,
      expectedClean,
      expectedClean ===
        null
        ? clean.length >
          0
        : clean.length ===
          expectedClean
    ),


  expectedTestCleanCreditCount:
    check(
      clean.length,
      replayName ===
        'test'
        ? 991
        : '>0',
      replayName ===
        'test'
        ? clean.length ===
          991
        : clean.length >
          0
    ),


  snapshotCountPreserved:
    check(
      analyzedSnapshotCount,
      expectedSnapshots,
      expectedSnapshots ===
        null
        ? analyzedSnapshotCount >
          0
        : analyzedSnapshotCount ===
          expectedSnapshots
    ),


  cleanTargetPartitionExhaustive:
    check(
      targetPartitionTotal,
      clean.length,
      targetPartitionTotal ===
      clean.length
    ),


  cleanDistancePartitionExhaustive:
    check(
      cleanInside.length +
        cleanOutside.length +
        cleanUnresolvedDistance.length,
      clean.length,
      cleanInside.length +
        cleanOutside.length +
        cleanUnresolvedDistance.length ===
        clean.length
    ),


  targetTransitionsObserved:
    check(
      cleanTargetTransition.length,
      '>0',
      cleanTargetTransition.length >
      0
    ),


  inactiveSignalsObserved:
    check(
      analyzed.filter(
        row =>
          row
            ?.termination
            ?.activeFalseObserved ===
          true
      ).length,
      '>0',
      analyzed.some(
        row =>
          row
            ?.termination
            ?.activeFalseObserved ===
          true
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
    'ASSIGNED_GOLD_VACUUM_LIFECYCLE_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'VACUUM_LIFECYCLE_CANDIDATE_VALIDATION_READY'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',


  purpose: [

    'Test null-to-player m_hVacuumTarget transitions as the candidate onset of AssignedGold vacuum behavior.',

    'Test whether the target player is approximately within 45m of the AssignedGold object when that transition occurs.',

    'Test whether delayed target transitions cross from outside to inside the candidate 45m threshold.',

    'Measure the interval from vacuum-target acquisition to m_bActive=false.',

    'Test whether targetless AssignedGold episodes terminate near 40 seconds as an expiration signature.',

    'Determine whether the eventual vacuum target is the credited last-hitter or another player.'
  ],


  semanticLimits: {

    vacuumOnset:
      'A null-to-valid-player m_hVacuumTarget transition is treated as candidate vacuum onset, not yet an engine-documented guarantee.',

    acquisition:
      'm_bActive=false shortly after target acquisition is a termination signature and is not by itself proof of successful economic collection.',

    expiration:
      'A targetless episode terminating near 40 seconds is classified as an expiration candidate, not yet canonical expiration telemetry.',

    creditedPlayer:
      'Credited-player identity remains based on the clean isolated exact m_iLastHits association rather than direct lethal-target telemetry.'
  },


  candidateVacuumRange: {

    meters:
      candidateRangeMeters,

    internalUnits:
      candidateRangeHU
  },


  sourceCounts: {

    allEpisodes:
      analyzed.length,

    cleanCreditedEpisodes:
      clean.length,

    cleanInside45m:
      cleanInside.length,

    cleanOutside45m:
      cleanOutside.length,

    cleanDistanceUnresolved:
      cleanUnresolvedDistance.length,

    cleanNullToPlayerTransitions:
      cleanTargetTransition.length,

    cleanPlayerTargetValidAtFirstSnapshot:
      cleanValidAtFirstSnapshot.length,

    cleanNoPlayerTarget:
      cleanNoPlayerTarget.length,

    cleanUnresolvedTarget:
      cleanUnresolvedTarget.length
  },


  targetTiming: {

    allCleanTransitions:
      summarizeNumbers(
        targetDelayValues
      ),

    creditedInside45m:
      summarizeNumbers(
        insideTargetDelay
      ),

    creditedOutside45m:
      summarizeNumbers(
        outsideTargetDelay
      ),

    immediateTransitions:
      immediateTransitions.length,

    delayedTransitions:
      delayedTransitions.length
  },


  targetPlayerGeometryAtOnset: {

    resolved:
      targetGeometryResolved.length,

    inside45m3D:
      targetInside45AtOnset.length,

    outside45m3D:
      targetOutside45AtOnset.length,

    inside45m3DRate:
      rate(
        targetInside45AtOnset.length,
        targetGeometryResolved.length
      ),

    inside45mXY:
      targetInside45XYAtOnset.length,

    inside45mXYRate:
      rate(
        targetInside45XYAtOnset.length,
        targetGeometryResolved.length
      ),

    distance3D:
      summarizeNumbers(
        targetOnset3DValues
      ),

    distanceXY:
      summarizeNumbers(
        targetOnsetXYValues
      )
  },


  delayedThresholdCrossingTest: {

    comparableTransitions:
      delayedCrossingComparable.length,

    priorOutside45m:
      delayedPriorOutside45.length,

    priorOutside45mRate:
      rate(
        delayedPriorOutside45.length,
        delayedCrossingComparable.length
      ),

    onsetInside45m:
      delayedOnsetInside45.length,

    onsetInside45mRate:
      rate(
        delayedOnsetInside45.length,
        delayedCrossingComparable.length
      ),

    crossedOutsideToInside45m:
      delayedCrossed45.length,

    crossingRate:
      rate(
        delayedCrossed45.length,
        delayedCrossingComparable.length
      ),

    priorDistance3D:
      summarizeNumbers(
        targetPrior3DValues
      ),

    onsetDistance3D:
      summarizeNumbers(
        finiteValues(
          delayedCrossingComparable.map(
            row =>
              row
                ?.vacuum
                ?.targetGeometry
                ?.distanceAtOnset3D
          )
        )
      )
  },


  targetToInactiveTiming: {

    allCleanTransitions:
      summarizeNumbers(
        targetToInactiveValues
      ),

    immediateTransitions:
      summarizeNumbers(
        immediateTargetToInactiveValues
      ),

    delayedTransitions:
      summarizeNumbers(
        delayedTargetToInactiveValues
      )
  },


  targetIdentity: {

    comparable:
      targetIdentityComparable.length,

    sameAsCreditedLastHitPlayer:
      targetSameAsCredited.length,

    sameAsCreditedRate:
      rate(
        targetSameAsCredited.length,
        targetIdentityComparable.length
      ),

    differentPlayerSameTeam:
      targetOtherSameTeam.length,

    differentPlayerSameTeamRate:
      rate(
        targetOtherSameTeam.length,
        targetIdentityComparable.length
      ),

    differentTeam:
      targetOtherTeam.length,

    differentTeamRate:
      rate(
        targetOtherTeam.length,
        targetIdentityComparable.length
      )
  },


  targetlessTermination: {

    noPlayerTargetEpisodes:
      cleanNoPlayerTarget.length,

    noTargetWithActiveFalse:
      noTargetInactive.length,

    expiration40SecondCandidates:
      expirationCandidates.length,

    expirationCandidateRateAmongNoTargetInactive:
      rate(
        expirationCandidates.length,
        noTargetInactive.length
      ),

    noTargetNon40SecondTermination:
      noTargetNon40.length,

    durationDistribution:
      summarizeNumbers(
        noTargetDurationValues
      ),

    expirationCandidatesInside45mAtDeath:
      expirationInside.length,

    expirationCandidatesOutside45mAtDeath:
      expirationOutside.length
  },


  creditedDistanceOutcomeComparison: {

    inside45m: {

      total:
        cleanInside.length,

      nullToPlayerTargetTransition:
        insideWithTargetTransition.length,

      noPlayerTarget:
        insideNoTarget.length
    },

    outside45m: {

      total:
        cleanOutside.length,

      nullToPlayerTargetTransition:
        outsideWithTargetTransition.length,

      noPlayerTarget:
        outsideNoTarget.length
    }
  },


  interpretationGuide: {

    vacuumTargetSupport:
      'High 45m containment of the actual target player at null-to-player target onset would strongly support m_hVacuumTarget as meaningful vacuum telemetry.',

    thresholdCrossingSupport:
      'Delayed transitions that move from >45m immediately before target acquisition to <=45m at acquisition provide within-episode evidence for a proximity threshold.',

    collectionTravelSupport:
      'A compact positive target-to-inactive interval supports a target-acquisition -> travel/collection lifecycle sequence.',

    expirationSupport:
      'Targetless episodes clustering almost exactly at 40 seconds support a fixed uncollected lifetime.',

    targetOwnership:
      'If the vacuum target frequently differs from the credited last-hitter but remains on the same team, other allied players may be able to trigger/receive the vacuum. This remains observational until independently validated.'
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

    transitions:
      outputTransitionsPath
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
  analyzed
);


await writeJsonl(
  outputTransitionsPath,
  analyzed
    .filter(
      row =>
        row
          ?.vacuum
          ?.targetOnsetType ===
        'NULL_TO_PLAYER_TARGET_TRANSITION'
    )
    .map(
      compactTransition
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
  'ASSIGNED GOLD VACUUM LIFECYCLE VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');


console.log(
  `Clean credited episodes: ${clean.length}`
);

console.log(
  `  <=45m at death: ${cleanInside.length}`
);

console.log(
  `   >45m at death: ${cleanOutside.length}`
);


console.log('');

console.log(
  'VACUUM TARGET ONSET TYPES'
);

console.log(
  '-------------------------'
);

console.log(
  `Null -> player transition:       ${cleanTargetTransition.length}`
);

console.log(
  `Valid at first snapshot:         ${cleanValidAtFirstSnapshot.length}`
);

console.log(
  `No player target observed:       ${cleanNoPlayerTarget.length}`
);

console.log(
  `Valid handle unresolved player:  ${cleanUnresolvedTarget.length}`
);


console.log('');

console.log(
  'TARGET PLAYER GEOMETRY AT ONSET'
);

console.log(
  '-------------------------------'
);

console.log(
  `Resolved:        ${targetGeometryResolved.length}`
);

console.log(
  `Inside 45m 3D:  ${targetInside45AtOnset.length}/${targetGeometryResolved.length} = ${formatPercent(rate(targetInside45AtOnset.length, targetGeometryResolved.length))}`
);

console.log(
  `Inside 45m XY:  ${targetInside45XYAtOnset.length}/${targetGeometryResolved.length} = ${formatPercent(rate(targetInside45XYAtOnset.length, targetGeometryResolved.length))}`
);

console.log(
  `3D distance: ${formatDistribution(summarizeNumbers(targetOnset3DValues))}`
);


console.log('');

console.log(
  'DELAYED TARGET 45M CROSSING TEST'
);

console.log(
  '--------------------------------'
);

console.log(
  `Comparable delayed transitions: ${delayedCrossingComparable.length}`
);

console.log(
  `Prior >45m:                     ${delayedPriorOutside45.length}/${delayedCrossingComparable.length} = ${formatPercent(rate(delayedPriorOutside45.length, delayedCrossingComparable.length))}`
);

console.log(
  `Onset <=45m:                    ${delayedOnsetInside45.length}/${delayedCrossingComparable.length} = ${formatPercent(rate(delayedOnsetInside45.length, delayedCrossingComparable.length))}`
);

console.log(
  `Crossed >45 -> <=45m:           ${delayedCrossed45.length}/${delayedCrossingComparable.length} = ${formatPercent(rate(delayedCrossed45.length, delayedCrossingComparable.length))}`
);


console.log('');

console.log(
  'TARGET -> INACTIVE'
);

console.log(
  '------------------'
);

console.log(
  formatDistribution(
    summarizeNumbers(
      targetToInactiveValues
    )
  )
);


console.log('');

console.log(
  'TARGET IDENTITY'
);

console.log(
  '---------------'
);

console.log(
  `Comparable:                ${targetIdentityComparable.length}`
);

console.log(
  `Same as credited player:   ${targetSameAsCredited.length}/${targetIdentityComparable.length} = ${formatPercent(rate(targetSameAsCredited.length, targetIdentityComparable.length))}`
);

console.log(
  `Different same-team:       ${targetOtherSameTeam.length}/${targetIdentityComparable.length} = ${formatPercent(rate(targetOtherSameTeam.length, targetIdentityComparable.length))}`
);

console.log(
  `Different team:            ${targetOtherTeam.length}/${targetIdentityComparable.length} = ${formatPercent(rate(targetOtherTeam.length, targetIdentityComparable.length))}`
);


console.log('');

console.log(
  'TARGETLESS TERMINATION'
);

console.log(
  '----------------------'
);

console.log(
  `No player target:               ${cleanNoPlayerTarget.length}`
);

console.log(
  `No-target + active=false:       ${noTargetInactive.length}`
);

console.log(
  `~40s expiration candidates:     ${expirationCandidates.length}/${noTargetInactive.length} = ${formatPercent(rate(expirationCandidates.length, noTargetInactive.length))}`
);

console.log(
  `No-target non-40s terminations: ${noTargetNon40.length}`
);

console.log(
  `No-target duration: ${formatDistribution(summarizeNumbers(noTargetDurationValues))}`
);


console.log('');

console.log(
  'CREDITED DISTANCE AT DEATH'
);

console.log(
  '--------------------------'
);

console.log(
  `Inside <=45m: targetTransition=${insideWithTargetTransition.length} noTarget=${insideNoTarget.length}`
);

console.log(
  `Outside >45m: targetTransition=${outsideWithTargetTransition.length} noTarget=${outsideNoTarget.length}`
);

console.log(
  `Inside target delay:  ${formatDistribution(summarizeNumbers(insideTargetDelay))}`
);

console.log(
  `Outside target delay: ${formatDistribution(summarizeNumbers(outsideTargetDelay))}`
);


console.log('');

console.log(
  'CLEAN >45M EPISODES'
);

console.log(
  '-------------------'
);


for (
  const row
  of cleanOutside
) {

  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `credit=${String(row.creditedPlayer.playerName ?? 'NONE').padEnd(24)} ` +
    `deathDist=${formatNumber(row.creditedPlayer.distanceAtDeath3D)} ` +
    `target=${String(row.vacuum.targetPlayerName ?? 'NONE').padEnd(24)} ` +
    `targetDelay=${formatNumber(row.vacuum.targetDelaySeconds)} ` +
    `targetDist=${formatNumber(row.vacuum.targetGeometry?.distanceAtOnset3D)} ` +
    `inactiveLag=${formatNumber(row.vacuum.targetToInactiveSeconds)} ` +
    `duration=${formatNumber(row.termination.durationSeconds)} ` +
    `class=${row.lifecycleClassification}`
  );
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
    `${name.padEnd(38)} ` +
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
  `Transitions:\n${outputTransitionsPath}`
);

console.log('');


// ============================================================
// EPISODE ANALYSIS
// ============================================================

function analyzeEpisode(
  episode
) {

  const deathIndex =
    finite(
      episode
        ?.death
        ?.deathIndex
    );


  const activationTick =
    finite(
      episode
        ?.assignedGold
        ?.activationTick
    );


  const creditedPlayer =
    episode?.creditedPlayer ??
    {};


  const snapshots =
    (
      snapshotsByDeathIndex.get(
        deathIndex
      )
      ??
      []
    )
      .filter(
        row =>
          activationTick ===
            null
          ||
          row.tick >=
            activationTick
      )
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
      );


  const firstActiveFalse =
    snapshots.find(
      row =>
        row.active ===
        false
    )
    ??
    null;


  const targetAnalysis =
    detectTargetOnset(
      snapshots,
      activationTick,
      creditedPlayer
    );


  const durationSeconds =
    firstFinite([
      episode
        ?.script55Lifecycle
        ?.durationSeconds,

      firstActiveFalse
        &&
        activationTick !==
          null
        ? (
          firstActiveFalse.tick -
          activationTick
        )
        /
        TICK_RATE
        : null
    ]);


  const targetToInactiveSeconds =
    targetAnalysis
      .targetOnsetSnapshot
    &&
    firstActiveFalse
      ? (
        firstActiveFalse.tick -
        targetAnalysis
          .targetOnsetSnapshot
          .tick
      )
      /
      TICK_RATE
      : null;


  const lifecycleClassification =
    classifyLifecycle({
      targetAnalysis,

      durationSeconds,

      firstActiveFalse
    });


  return {

    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    clock:
      episode
        ?.death
        ?.clock ??
      null,

    baseType:
      episode
        ?.death
        ?.baseType ??
      null,

    creditedPlayer,

    assignedGold:
      episode?.assignedGold ??
      null,

    snapshotCount:
      snapshots.length,

    vacuum: {

      targetOnsetType:
        targetAnalysis.targetOnsetType,

      targetPlayerName:
        targetAnalysis.targetPlayerName,

      targetPlayerTeam:
        targetAnalysis.targetPlayerTeam,

      targetHandle:
        targetAnalysis.targetHandle,

      targetPawnEntityIndex:
        targetAnalysis.targetPawnEntityIndex,

      targetOnsetTick:
        targetAnalysis
          .targetOnsetSnapshot
          ?.tick ??
        null,

      targetDelaySeconds:
        targetAnalysis
          .targetOnsetSnapshot
          &&
        activationTick !==
          null
          ? (
            targetAnalysis
              .targetOnsetSnapshot
              .tick -
            activationTick
          )
          /
          TICK_RATE
          : null,

      targetGeometry:
        targetAnalysis.targetGeometry,

      targetToInactiveSeconds
    },

    termination: {

      activeFalseObserved:
        Boolean(
          firstActiveFalse
        ),

      activeFalseTick:
        firstActiveFalse?.tick ??
        null,

      durationSeconds,

      endReason:
        episode
          ?.script55Lifecycle
          ?.endReason ??
        null,

      near40Seconds:
        Number.isFinite(
          durationSeconds
        )
          ? Math.abs(
            durationSeconds -
            EXPIRATION_CANDIDATE_SECONDS
          ) <=
            EXPIRATION_TOLERANCE_SECONDS
          : null
    },

    lifecycleClassification
  };
}


// ============================================================
// TARGET ONSET DETECTION
// ============================================================

function detectTargetOnset(
  snapshots,
  activationTick,
  creditedPlayer
) {

  if (
    snapshots.length ===
    0
  ) {

    return {
      targetOnsetType:
        'NO_PLAYER_TARGET_OBSERVED',

      targetPlayerName:
        null,

      targetPlayerTeam:
        null,

      targetHandle:
        null,

      targetPawnEntityIndex:
        null,

      targetOnsetSnapshot:
        null,

      targetGeometry:
        null
    };
  }


  const first =
    snapshots[0];


  if (
    first.vacuumTargetPlayerName
  ) {

    return buildTargetResult(
      'PLAYER_TARGET_VALID_AT_FIRST_SNAPSHOT',
      first,
      null,
      creditedPlayer
    );
  }


  let sawValidUnresolvedHandle =
    first.vacuumTargetHandle !==
      null
    &&
    !first.vacuumTargetPlayerName;


  for (
    let i =
      1;
    i <
      snapshots.length;
    i++
  ) {

    const previous =
      snapshots[
        i -
        1
      ];


    const current =
      snapshots[i];


    if (
      current.vacuumTargetHandle !==
        null
      &&
      !current.vacuumTargetPlayerName
    ) {

      sawValidUnresolvedHandle =
        true;
    }


    if (
      !current.vacuumTargetPlayerName
    ) {

      continue;
    }


    if (
      previous.vacuumTargetHandle ===
      null
    ) {

      return buildTargetResult(
        'NULL_TO_PLAYER_TARGET_TRANSITION',
        current,
        previous,
        creditedPlayer
      );
    }


    return buildTargetResult(
      'PLAYER_TARGET_WITHOUT_CLEAN_NULL_TRANSITION',
      current,
      previous,
      creditedPlayer
    );
  }


  if (
    sawValidUnresolvedHandle
  ) {

    return {
      targetOnsetType:
        'VALID_HANDLE_WITHOUT_RESOLVED_PLAYER',

      targetPlayerName:
        null,

      targetPlayerTeam:
        null,

      targetHandle:
        null,

      targetPawnEntityIndex:
        null,

      targetOnsetSnapshot:
        null,

      targetGeometry:
        null
    };
  }


  return {
    targetOnsetType:
      'NO_PLAYER_TARGET_OBSERVED',

    targetPlayerName:
      null,

    targetPlayerTeam:
      null,

    targetHandle:
      null,

    targetPawnEntityIndex:
      null,

    targetOnsetSnapshot:
      null,

    targetGeometry:
      null
  };
}


// ============================================================
// TARGET RESULT / GEOMETRY
// ============================================================

function buildTargetResult(
  type,
  onset,
  previous,
  creditedPlayer
) {

  const targetName =
    onset.vacuumTargetPlayerName ??
    null;


  const targetTeam =
    finite(
      onset.vacuumTargetPlayerTeam
    );


  const targetGeometry =
    reconstructTargetGeometry(
      targetName,
      targetTeam,
      onset,
      previous
    );


  return {

    targetOnsetType:
      type,

    targetPlayerName:
      targetName,

    targetPlayerTeam:
      targetTeam,

    targetHandle:
      onset.vacuumTargetHandle,

    targetPawnEntityIndex:
      onset.vacuumTargetPawnEntityIndex,

    targetOnsetSnapshot:
      onset,

    previousSnapshot:
      previous,

    targetRelationToCreditedPlayer:
      classifyPlayerRelation(
        targetName,
        targetTeam,
        creditedPlayer
      ),

    targetGeometry
  };
}


// ============================================================
// TARGET GEOMETRY
// ============================================================

function reconstructTargetGeometry(
  playerName,
  team,
  onset,
  previous
) {

  if (
    !playerName
    ||
    team ===
      null
  ) {

    return null;
  }


  const timeline =
    timelines.get(
      `${playerName}|${team}`
    )
    ??
    null;


  if (
    !timeline
  ) {

    return {
      resolved:
        false,

      reason:
        'PLAYER_TIMELINE_NOT_FOUND'
    };
  }


  const onsetState =
    estimateStateAtTime(
      timeline.rows,
      onset.timeSeconds
    );


  const previousState =
    previous
      ? estimateStateAtTime(
        timeline.rows,
        previous.timeSeconds
      )
      : null;


  const distanceAtOnset3D =
    onsetState
    &&
    onset.position
      ? distance3D(
        onsetState.position,
        onset.position
      )
      : null;


  const distanceAtOnsetXY =
    onsetState
    &&
    onset.position
      ? distanceXY(
        onsetState.position,
        onset.position
      )
      : null;


  const distanceBeforeOnset3D =
    previousState
    &&
    previous?.position
      ? distance3D(
        previousState.position,
        previous.position
      )
      : null;


  const distanceBeforeOnsetXY =
    previousState
    &&
    previous?.position
      ? distanceXY(
        previousState.position,
        previous.position
      )
      : null;


  return {

    resolved:
      Number.isFinite(
        distanceAtOnset3D
      ),

    onsetPlayerState:
      onsetState,

    previousPlayerState:
      previousState,

    onsetSoulPosition:
      onset.position,

    previousSoulPosition:
      previous?.position ??
      null,

    distanceAtOnset3D,

    distanceAtOnsetXY,

    distanceBeforeOnset3D,

    distanceBeforeOnsetXY,

    inside45mAtOnset3D:
      Number.isFinite(
        distanceAtOnset3D
      )
        ? distanceAtOnset3D <=
          candidateRangeHU
        : null,

    inside45mAtOnsetXY:
      Number.isFinite(
        distanceAtOnsetXY
      )
        ? distanceAtOnsetXY <=
          candidateRangeHU
        : null,

    outside45mBeforeOnset3D:
      Number.isFinite(
        distanceBeforeOnset3D
      )
        ? distanceBeforeOnset3D >
          candidateRangeHU
        : null,

    crossed45m3D:
      Number.isFinite(
        distanceBeforeOnset3D
      )
      &&
      Number.isFinite(
        distanceAtOnset3D
      )
        ? (
          distanceBeforeOnset3D >
            candidateRangeHU
          &&
          distanceAtOnset3D <=
            candidateRangeHU
        )
        : null
  };
}


// ============================================================
// LIFECYCLE CLASSIFICATION
// ============================================================

function classifyLifecycle({
  targetAnalysis,
  durationSeconds,
  firstActiveFalse
}) {

  if (
    targetAnalysis.targetOnsetType ===
    'NULL_TO_PLAYER_TARGET_TRANSITION'
  ) {

    return 'OBSERVED_PLAYER_TARGET_TRANSITION';
  }


  if (
    targetAnalysis.targetOnsetType ===
    'PLAYER_TARGET_VALID_AT_FIRST_SNAPSHOT'
  ) {

    return 'PLAYER_TARGET_PRESENT_AT_EPISODE_START';
  }


  if (
    targetAnalysis.targetOnsetType ===
    'PLAYER_TARGET_WITHOUT_CLEAN_NULL_TRANSITION'
  ) {

    return 'PLAYER_TARGET_TRANSITION_AMBIGUOUS';
  }


  if (
    targetAnalysis.targetOnsetType ===
    'NO_PLAYER_TARGET_OBSERVED'
    &&
    firstActiveFalse
    &&
    Number.isFinite(
      durationSeconds
    )
    &&
    Math.abs(
      durationSeconds -
      EXPIRATION_CANDIDATE_SECONDS
    ) <=
      EXPIRATION_TOLERANCE_SECONDS
  ) {

    return 'TARGETLESS_40S_EXPIRATION_CANDIDATE';
  }


  if (
    targetAnalysis.targetOnsetType ===
    'NO_PLAYER_TARGET_OBSERVED'
  ) {

    return 'TARGETLESS_OTHER_TERMINATION';
  }


  return 'UNRESOLVED_TARGET_LIFECYCLE';
}


// ============================================================
// PLAYER RELATION
// ============================================================

function classifyPlayerRelation(
  targetName,
  targetTeam,
  creditedPlayer
) {

  const creditName =
    creditedPlayer?.playerName ??
    null;


  const creditTeam =
    finite(
      creditedPlayer?.team
    );


  if (
    !targetName
  ) {

    return 'TARGET_UNRESOLVED';
  }


  if (
    creditName
    &&
    targetName ===
    creditName
  ) {

    return 'SAME_AS_CREDITED_PLAYER';
  }


  if (
    targetTeam !==
      null
    &&
    creditTeam !==
      null
    &&
    targetTeam ===
    creditTeam
  ) {

    return 'DIFFERENT_PLAYER_SAME_TEAM';
  }


  if (
    targetTeam !==
      null
    &&
    creditTeam !==
      null
    &&
    targetTeam !==
    creditTeam
  ) {

    return 'DIFFERENT_TEAM';
  }


  return 'RELATION_UNRESOLVED';
}


// ============================================================
// SNAPSHOT NORMALIZATION
// ============================================================

function normalizeSnapshot(
  row
) {

  return {

    tick:
      finite(
        row?.tick
      ),

    timeSeconds:
      finite(
        row?.timeSeconds
      ),

    position:
      normalizePosition(
        row?.position
      ),

    active:
      row?.active ===
        true
        ? true
        : row?.active ===
            false
          ? false
          : null,

    interactive:
      row?.interactive ===
        true
        ? true
        : row?.interactive ===
            false
          ? false
          : null,

    vacuumTargetHandle:
      row?.vacuumTargetHandle ??
      null,

    vacuumTargetPawnEntityIndex:
      finite(
        row?.vacuumTargetPawnEntityIndex
      ),

    vacuumTargetPlayerName:
      row?.vacuumTargetPlayerName ??
      null,

    vacuumTargetPlayerTeam:
      finite(
        row?.vacuumTargetPlayerTeam
      )
  };
}


// ============================================================
// COMPACT TRANSITION OUTPUT
// ============================================================

function compactTransition(
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

    baseType:
      row.baseType,

    creditedPlayerName:
      row
        ?.creditedPlayer
        ?.playerName ??
      null,

    creditedPlayerTeam:
      row
        ?.creditedPlayer
        ?.team ??
      null,

    creditedPlayerDistanceAtDeath3D:
      row
        ?.creditedPlayer
        ?.distanceAtDeath3D ??
      null,

    creditedPlayerDistanceBand:
      row
        ?.creditedPlayer
        ?.distanceBand ??
      null,

    targetPlayerName:
      row
        ?.vacuum
        ?.targetPlayerName ??
      null,

    targetPlayerTeam:
      row
        ?.vacuum
        ?.targetPlayerTeam ??
      null,

    targetOnsetTick:
      row
        ?.vacuum
        ?.targetOnsetTick ??
      null,

    targetDelaySeconds:
      row
        ?.vacuum
        ?.targetDelaySeconds ??
      null,

    targetGeometry:
      row
        ?.vacuum
        ?.targetGeometry ??
      null,

    targetToInactiveSeconds:
      row
        ?.vacuum
        ?.targetToInactiveSeconds ??
      null,

    durationSeconds:
      row
        ?.termination
        ?.durationSeconds ??
      null
  };
}


// ============================================================
// PLAYER TIMELINES
// ============================================================

async function loadPlayerTimelines(
  path
) {

  const map =
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


    const timeSeconds =
      finite(
        row?.matchTimeSeconds
      );


    if (
      !playerName
      ||
      team ===
        null
      ||
      timeSeconds ===
        null
    ) {

      continue;
    }


    const key =
      `${playerName}|${team}`;


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        {

          playerName,

          team,

          rows:
            []
        }
      );
    }


    map
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
    of map.values()
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


  return map;
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
            interpolate(
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


function interpolate(
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
// NUMBERS
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


function finiteValues(
  values
) {

  return values.filter(
    Number.isFinite
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


// ============================================================
// SUMMARIES
// ============================================================

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