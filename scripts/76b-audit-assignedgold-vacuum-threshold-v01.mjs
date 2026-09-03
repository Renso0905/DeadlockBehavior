import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
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

const HU_PER_METER =
  39.37;

const DOCUMENTED_45M_HU =
  45 *
  HU_PER_METER;

const IMMEDIATE_SECONDS =
  0.25;

const EXPIRATION_SECONDS =
  40;

const EXPIRATION_TOLERANCE_SECONDS =
  0.05;


// ============================================================
// CANDIDATE ONSET ENVELOPES
//
// These are descriptive thresholds only.
//
// We are NOT declaring any of these an engine vacuum radius.
// ============================================================

const CANDIDATE_THRESHOLDS_HU = [
  500,
  550,
  600,
  625,
  650,
  675,
  700,
  710,
  720,
  725,
  730,
  735,
  740,
  750,
  775,
  800,
  850,
  900,
  1000,
  1200,
  1500,
  DOCUMENTED_45M_HU
];


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

const summary76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_validation_v01.json'
  );

const episodes76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );

const transitions76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_target_transitions_v01.jsonl'
  );

const outputPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_threshold_audit_v01.json'
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
    summary76Path,
    episodes76Path,
    transitions76Path
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
// LOAD
// ============================================================

const summary75 =
  JSON.parse(
    readFileSync(
      summary75Path,
      'utf8'
    )
  );

const summary76 =
  JSON.parse(
    readFileSync(
      summary76Path,
      'utf8'
    )
  );

const episodes75 =
  await loadJsonl(
    episodes75Path
  );

const rawSnapshots =
  await loadJsonl(
    snapshots75Path
  );

const episodes76 =
  await loadJsonl(
    episodes76Path
  );

const transitions =
  await loadJsonl(
    transitions76Path
  );


console.log('');

console.log(
  `Script 75 episodes: ${episodes75.length}`
);

console.log(
  `Raw Script 75 snapshots: ${rawSnapshots.length}`
);

console.log(
  `Script 76 episodes: ${episodes76.length}`
);

console.log(
  `Script 76 transitions: ${transitions.length}`
);


// ============================================================
// VERIFY THE SCRIPT 76 VALIDATION FAILURE
// ============================================================

const failed76Checks =
  Object
    .entries(
      summary76
        ?.validation
        ?.checks ??
      {}
    )
    .filter(
      ([
        name,
        row
      ]) =>
        row?.pass !==
        true
    )
    .map(
      ([
        name
      ]) =>
        name
    );


const activationTickByDeathIndex =
  new Map();


for (
  const row
  of episodes75
) {
  const deathIndex =
    finite(
      row
        ?.death
        ?.deathIndex
    );

  const activationTick =
    finite(
      row
        ?.assignedGold
        ?.activationTick
    );

  if (
    deathIndex !==
      null
    &&
    activationTick !==
      null
  ) {
    activationTickByDeathIndex.set(
      deathIndex,
      activationTick
    );
  }
}


let joinedRawSnapshots =
  0;

let preActivationSnapshots =
  0;

let postActivationSnapshots =
  0;

let exactActivationSnapshots =
  0;


for (
  const row
  of rawSnapshots
) {
  const deathIndex =
    finite(
      row?.deathIndex
    );

  const tick =
    finite(
      row?.tick
    );

  const activationTick =
    deathIndex ===
      null
      ? null
      : activationTickByDeathIndex.get(
        deathIndex
      ) ??
        null;

  if (
    tick ===
      null
    ||
    activationTick ===
      null
  ) {
    continue;
  }

  joinedRawSnapshots++;

  if (
    tick <
    activationTick
  ) {
    preActivationSnapshots++;
  } else {
    postActivationSnapshots++;
  }

  if (
    tick ===
    activationTick
  ) {
    exactActivationSnapshots++;
  }
}


const episode76SnapshotSum =
  episodes76.reduce(
    (
      sum,
      row
    ) =>
      sum +
      (
        finite(
          row?.snapshotCount
        ) ??
        0
      ),
    0
  );


const expectedRawSnapshots =
  finite(
    summary75
      ?.sourceCounts
      ?.capturedSnapshotRows
  );


const snapshotMismatchFullyExplained =
  rawSnapshots.length ===
    preActivationSnapshots +
      postActivationSnapshots
  &&
  episode76SnapshotSum ===
    postActivationSnapshots;


// ============================================================
// CLEAN TRANSITIONS
// ============================================================

const cleanTransitions =
  transitions.filter(
    row =>
      row
        ?.creditedPlayerName
    &&
    row
        ?.targetPlayerName
  );


const resolved3D =
  cleanTransitions.filter(
    row =>
      Number.isFinite(
        finite(
          row
            ?.targetGeometry
            ?.distanceAtOnset3D
        )
      )
  );


const immediate =
  resolved3D.filter(
    row =>
      finite(
        row?.targetDelaySeconds
      ) !==
        null
    &&
    finite(
      row?.targetDelaySeconds
    ) <=
    IMMEDIATE_SECONDS
  );


const delayed =
  resolved3D.filter(
    row =>
      finite(
        row?.targetDelaySeconds
      ) !==
        null
    &&
    finite(
      row?.targetDelaySeconds
    ) >
    IMMEDIATE_SECONDS
  );


// ============================================================
// ONSET DISTANCES
// ============================================================

const allOnset3D =
  values(
    resolved3D,
    row =>
      row
        ?.targetGeometry
        ?.distanceAtOnset3D
  );


const immediateOnset3D =
  values(
    immediate,
    row =>
      row
        ?.targetGeometry
        ?.distanceAtOnset3D
  );


const delayedOnset3D =
  values(
    delayed,
    row =>
      row
        ?.targetGeometry
        ?.distanceAtOnset3D
  );


const delayedPrior3D =
  values(
    delayed,
    row =>
      row
        ?.targetGeometry
        ?.distanceBeforeOnset3D
  );


const delayedOnsetXY =
  values(
    delayed,
    row =>
      row
        ?.targetGeometry
        ?.distanceAtOnsetXY
  );


// ============================================================
// THRESHOLD COVERAGE TABLE
// ============================================================

const thresholdCoverage =
  CANDIDATE_THRESHOLDS_HU.map(
    thresholdHU => {

      const allCount =
        allOnset3D.filter(
          value =>
            value <=
            thresholdHU
        ).length;

      const immediateCount =
        immediateOnset3D.filter(
          value =>
            value <=
            thresholdHU
        ).length;

      const delayedCount =
        delayedOnset3D.filter(
          value =>
            value <=
            thresholdHU
        ).length;

      return {
        thresholdHU,

        thresholdMeters:
          thresholdHU /
          HU_PER_METER,

        all: {
          supported:
            allCount,

          total:
            allOnset3D.length,

          rate:
            rate(
              allCount,
              allOnset3D.length
            )
        },

        immediate: {
          supported:
            immediateCount,

          total:
            immediateOnset3D.length,

          rate:
            rate(
              immediateCount,
              immediateOnset3D.length
            )
        },

        delayed: {
          supported:
            delayedCount,

          total:
            delayedOnset3D.length,

          rate:
            rate(
              delayedCount,
              delayedOnset3D.length
            )
        }
      };
    }
  );


// ============================================================
// DELAYED TRANSITION ENVELOPE
// ============================================================

const delayedSummary =
  summarizeNumbers(
    delayedOnset3D
  );


const delayedPriorSummary =
  summarizeNumbers(
    delayedPrior3D
  );


const delayedXYSummary =
  summarizeNumbers(
    delayedOnsetXY
  );


const delayedP95 =
  quantile(
    delayedOnset3D
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      ),
    0.95
  );


const delayedP99 =
  quantile(
    delayedOnset3D
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      ),
    0.99
  );


const delayedMaximum =
  delayedSummary.max;


// ============================================================
// HIGHEST-DISTANCE DELAYED TRANSITIONS
// ============================================================

const largestDelayedTransitions =
  delayed
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        finite(
          b
            ?.targetGeometry
            ?.distanceAtOnset3D
        )
        -
        finite(
          a
            ?.targetGeometry
            ?.distanceAtOnset3D
        )
    )
    .slice(
      0,
      25
    )
    .map(
      compactTransition
    );


// ============================================================
// >45M ONSET OUTLIERS
// ============================================================

const onsetOutside45m =
  resolved3D
    .filter(
      row =>
        finite(
          row
            ?.targetGeometry
            ?.distanceAtOnset3D
        ) >
        DOCUMENTED_45M_HU
    )
    .map(
      compactTransition
    );


// ============================================================
// TARGET -> INACTIVE
// ============================================================

const targetToInactive =
  values(
    transitions,
    row =>
      row?.targetToInactiveSeconds
  );


// ============================================================
// TARGETLESS TERMINATIONS
// ============================================================

const targetless =
  episodes76.filter(
    row =>
      row
        ?.vacuum
        ?.targetOnsetType ===
      'NO_PLAYER_TARGET_OBSERVED'
  );


const targetlessInactive =
  targetless.filter(
    row =>
      row
        ?.termination
        ?.activeFalseObserved ===
      true
  );


const targetless40 =
  targetlessInactive.filter(
    row => {
      const duration =
        finite(
          row
            ?.termination
            ?.durationSeconds
        );

      return (
        duration !==
          null
        &&
        Math.abs(
          duration -
          EXPIRATION_SECONDS
        ) <=
        EXPIRATION_TOLERANCE_SECONDS
      );
    }
  );


const targetlessNon40 =
  targetlessInactive
    .filter(
      row => {

        const duration =
          finite(
            row
              ?.termination
              ?.durationSeconds
          );

        return !(
          duration !==
            null
          &&
          Math.abs(
            duration -
            EXPIRATION_SECONDS
          ) <=
          EXPIRATION_TOLERANCE_SECONDS
        );
      }
    )
    .map(
      row => ({
        deathIndex:
          row?.deathIndex,

        clock:
          row?.clock,

        baseType:
          row?.baseType,

        creditedPlayer:
          row
            ?.creditedPlayer
            ?.playerName ??
          null,

        creditedDistanceBand:
          row
            ?.creditedPlayer
            ?.distanceBand ??
          null,

        creditedDistance3D:
          finite(
            row
              ?.creditedPlayer
              ?.distanceAtDeath3D
          ),

        durationSeconds:
          finite(
            row
              ?.termination
              ?.durationSeconds
          ),

        endReason:
          row
            ?.termination
            ?.endReason ??
          null
      })
    );


// ============================================================
// TARGET IDENTITY
// ============================================================

const sameCredited =
  cleanTransitions.filter(
    row =>
      row.targetPlayerName ===
      row.creditedPlayerName
  );


const differentSameTeam =
  cleanTransitions.filter(
    row =>
      row.targetPlayerName !==
      row.creditedPlayerName
    &&
    finite(
      row?.targetPlayerTeam
    ) !==
      null
    &&
    finite(
      row?.creditedPlayerTeam
    ) !==
      null
    &&
    finite(
      row?.targetPlayerTeam
    ) ===
    finite(
      row?.creditedPlayerTeam
    )
  );


const differentTeam =
  cleanTransitions.filter(
    row =>
      finite(
        row?.targetPlayerTeam
      ) !==
        null
    &&
    finite(
      row?.creditedPlayerTeam
    ) !==
        null
    &&
    finite(
      row?.targetPlayerTeam
    ) !==
    finite(
      row?.creditedPlayerTeam
    )
  );


// ============================================================
// VALIDATION
// ============================================================

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


  script76FailedOnlyExpectedSnapshotCheck:
    check(
      failed76Checks,
      [
        'snapshotCountPreserved'
      ],
      failed76Checks.length ===
        1
      &&
      failed76Checks[0] ===
        'snapshotCountPreserved'
    ),


  rawSnapshotCountAgreesWith75:
    check(
      rawSnapshots.length,
      expectedRawSnapshots,
      expectedRawSnapshots ===
        null
        ? rawSnapshots.length >
          0
        : rawSnapshots.length ===
          expectedRawSnapshots
    ),


  rawSnapshotRowsFullyJoined:
    check(
      joinedRawSnapshots,
      rawSnapshots.length,
      joinedRawSnapshots ===
      rawSnapshots.length
    ),


  prePlusPostEqualsRaw:
    check(
      preActivationSnapshots +
        postActivationSnapshots,
      rawSnapshots.length,
      preActivationSnapshots +
        postActivationSnapshots ===
        rawSnapshots.length
    ),


  script76AnalyzedSnapshotCountEqualsPostActivation:
    check(
      episode76SnapshotSum,
      postActivationSnapshots,
      episode76SnapshotSum ===
      postActivationSnapshots
    ),


  snapshotMismatchFullyExplainedByPreActivationPadding:
    check(
      snapshotMismatchFullyExplained,
      true,
      snapshotMismatchFullyExplained ===
      true
    ),


  episodeCount:
    check(
      episodes76.length,
      replayName ===
        'test'
        ? 1388
        : '>0',
      replayName ===
        'test'
        ? episodes76.length ===
          1388
        : episodes76.length >
          0
    ),


  transitionCount:
    check(
      transitions.length,
      replayName ===
        'test'
        ? 947
        : '>0',
      replayName ===
        'test'
        ? transitions.length ===
          947
        : transitions.length >
          0
    ),


  geometryResolvedForAllTransitions:
    check(
      resolved3D.length,
      transitions.length,
      resolved3D.length ===
      transitions.length
    ),


  immediateDelayedPartition:
    check(
      immediate.length +
        delayed.length,
      resolved3D.length,
      immediate.length +
        delayed.length ===
        resolved3D.length
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

const output = {

  replay:
    replayName,

  version:
    'ASSIGNED_GOLD_VACUUM_THRESHOLD_AUDIT_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'SCRIPT76_VALIDATION_FAILURE_EXPLAINED_AND_TARGET_ONSET_AUDITED'
      : 'AUDIT_VALIDATION_FAILURE',

  script76Correction: {

    originalPipelinePass:
      summary76
        ?.validation
        ?.pass,

    failedChecks:
      failed76Checks,

    rawSnapshotRows:
      rawSnapshots.length,

    preActivationPaddingRows:
      preActivationSnapshots,

    postActivationRows:
      postActivationSnapshots,

    exactActivationRows:
      exactActivationSnapshots,

    script76EpisodeSnapshotSum:
      episode76SnapshotSum,

    explanation:
      'Script 75 captured pre-activation padding snapshots. Script 76 intentionally filtered to tick >= activationTick before episode analysis, but its validation incorrectly compared that post-activation total with the raw Script 75 snapshot count.'
  },

  transitionCounts: {

    all:
      transitions.length,

    immediate:
      immediate.length,

    delayed:
      delayed.length,

    resolved3D:
      resolved3D.length
  },

  targetOnsetDistance3D: {

    all:
      summarizeNumbers(
        allOnset3D
      ),

    immediate:
      summarizeNumbers(
        immediateOnset3D
      ),

    delayed:
      delayedSummary,

    delayedP95,

    delayedP99,

    delayedMaximum,

    delayedMaximumMeters:
      Number.isFinite(
        delayedMaximum
      )
        ? delayedMaximum /
          HU_PER_METER
        : null
  },

  delayedTargetPriorDistance3D:
    delayedPriorSummary,

  delayedTargetOnsetDistanceXY:
    delayedXYSummary,

  thresholdCoverage,

  onsetOutside45m: {

    count:
      onsetOutside45m.length,

    cases:
      onsetOutside45m
  },

  largestDelayedTransitions,

  targetToInactiveSeconds:
    summarizeNumbers(
      targetToInactive
    ),

  targetIdentity: {

    comparable:
      cleanTransitions.length,

    sameAsCredited:
      sameCredited.length,

    sameAsCreditedRate:
      rate(
        sameCredited.length,
        cleanTransitions.length
      ),

    differentSameTeam:
      differentSameTeam.length,

    differentSameTeamRate:
      rate(
        differentSameTeam.length,
        cleanTransitions.length
      ),

    differentTeam:
      differentTeam.length,

    differentTeamRate:
      rate(
        differentTeam.length,
        cleanTransitions.length
      )
  },

  targetlessTermination: {

    targetless:
      targetless.length,

    targetlessInactive:
      targetlessInactive.length,

    exact40SecondCandidates:
      targetless40.length,

    exact40SecondRate:
      rate(
        targetless40.length,
        targetlessInactive.length
      ),

    non40Second:
      targetlessNon40.length,

    non40SecondCases:
      targetlessNon40
  },

  interpretation: {

    movement:
      'The ~0.3-0.4 second 32-HU movement observed in Script 75 is not treated as vacuum onset.',

    targetField:
      'The null-to-player m_hVacuumTarget transition remains the strongest current candidate for vacuum-target acquisition.',

    fortySeconds:
      'Targetless termination at ~40 seconds is a strong expiration candidate but remains provisional until the non-40-second targetless cases are resolved.',

    range:
      '45m should not be promoted as the vacuum-target acquisition radius merely because nearly all target onsets occur inside it. The delayed-onset distance envelope is much tighter and must be investigated directly.',

    thresholdCaution:
      'The maximum or high quantiles of observed target-onset distance are not automatically the engine threshold because target assignment may occur after a player has already crossed the actual trigger boundary.'
  },

  validation: {

    pass:
      validationPass,

    checks:
      validationChecks
  }
};


writeFileSync(
  outputPath,
  JSON.stringify(
    output,
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
  'ASSIGNED GOLD VACUUM THRESHOLD AUDIT V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'SCRIPT 76 SNAPSHOT FAILURE'
);

console.log(
  '--------------------------'
);

console.log(
  `Raw snapshots:          ${rawSnapshots.length}`
);

console.log(
  `Pre-activation padding: ${preActivationSnapshots}`
);

console.log(
  `Post-activation:        ${postActivationSnapshots}`
);

console.log(
  `Script76 analyzed sum:  ${episode76SnapshotSum}`
);

console.log(
  `Mismatch fully explained: ${snapshotMismatchFullyExplained}`
);


console.log('');

console.log(
  'TARGET TRANSITIONS'
);

console.log(
  '------------------'
);

console.log(
  `All resolved transitions: ${resolved3D.length}`
);

console.log(
  `Immediate <=0.25s:        ${immediate.length}`
);

console.log(
  `Delayed >0.25s:           ${delayed.length}`
);


console.log('');

console.log(
  'TARGET-ONSET DISTANCE'
);

console.log(
  '---------------------'
);

console.log(
  `All:       ${formatDistribution(summarizeNumbers(allOnset3D))}`
);

console.log(
  `Immediate: ${formatDistribution(summarizeNumbers(immediateOnset3D))}`
);

console.log(
  `Delayed:   ${formatDistribution(delayedSummary)}`
);

console.log(
  `Delayed p95: ${formatNumber(delayedP95)} HU = ${formatMeters(delayedP95)}m`
);

console.log(
  `Delayed p99: ${formatNumber(delayedP99)} HU = ${formatMeters(delayedP99)}m`
);

console.log(
  `Delayed max: ${formatNumber(delayedMaximum)} HU = ${formatMeters(delayedMaximum)}m`
);


console.log('');

console.log(
  'THRESHOLD COVERAGE — DELAYED ONSETS'
);

console.log(
  '-----------------------------------'
);

for (
  const row
  of thresholdCoverage
) {
  console.log(
    `${String(formatNumber(row.thresholdHU)).padStart(8)} HU ` +
    `${formatMeters(row.thresholdHU).padStart(7)}m  ` +
    `${String(row.delayed.supported).padStart(4)}/${String(row.delayed.total).padEnd(4)} ` +
    `${formatPercent(row.delayed.rate)}`
  );
}


console.log('');

console.log(
  'LARGEST 25 DELAYED ONSET DISTANCES'
);

console.log(
  '----------------------------------'
);

for (
  const row
  of largestDelayedTransitions
) {
  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `delay=${formatNumber(row.targetDelaySeconds).padStart(7)}s ` +
    `onset=${formatNumber(row.distanceAtOnset3D).padStart(9)} HU ` +
    `(${formatMeters(row.distanceAtOnset3D)}m) ` +
    `prior=${formatNumber(row.distanceBeforeOnset3D).padStart(9)} HU ` +
    `target=${String(row.targetPlayerName ?? 'NONE')}`
  );
}


console.log('');

console.log(
  'ONSET >45M OUTLIERS'
);

console.log(
  '-------------------'
);

if (
  onsetOutside45m.length ===
  0
) {
  console.log(
    'None.'
  );
} else {
  for (
    const row
    of onsetOutside45m
  ) {
    console.log(
      `${String(row.deathIndex).padStart(4)} ` +
      `${String(row.clock ?? '').padEnd(6)} ` +
      `delay=${formatNumber(row.targetDelaySeconds)} ` +
      `distance=${formatNumber(row.distanceAtOnset3D)} ` +
      `target=${row.targetPlayerName}`
    );
  }
}


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
      targetToInactive
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
  `Same credited player: ${sameCredited.length}/${cleanTransitions.length} = ${formatPercent(rate(sameCredited.length, cleanTransitions.length))}`
);

console.log(
  `Different same-team:  ${differentSameTeam.length}/${cleanTransitions.length} = ${formatPercent(rate(differentSameTeam.length, cleanTransitions.length))}`
);

console.log(
  `Different team:       ${differentTeam.length}/${cleanTransitions.length} = ${formatPercent(rate(differentTeam.length, cleanTransitions.length))}`
);


console.log('');

console.log(
  'TARGETLESS TERMINATION'
);

console.log(
  '----------------------'
);

console.log(
  `Targetless:            ${targetless.length}`
);

console.log(
  `Targetless inactive:   ${targetlessInactive.length}`
);

console.log(
  `~40 second candidates: ${targetless40.length}/${targetlessInactive.length} = ${formatPercent(rate(targetless40.length, targetlessInactive.length))}`
);

console.log(
  `Non-40 second:         ${targetlessNon40.length}`
);


if (
  targetlessNon40.length >
  0
) {
  console.log('');

  console.log(
    'NON-40S TARGETLESS CASES'
  );

  console.log(
    '------------------------'
  );

  for (
    const row
    of targetlessNon40
  ) {
    console.log(
      `${String(row.deathIndex).padStart(4)}  ` +
      `${String(row.clock ?? '').padEnd(6)} ` +
      `${String(row.baseType ?? '').padEnd(7)} ` +
      `credit=${String(row.creditedPlayer ?? 'NONE').padEnd(24)} ` +
      `band=${String(row.creditedDistanceBand ?? 'UNKNOWN').padEnd(19)} ` +
      `dist=${formatNumber(row.creditedDistance3D)} ` +
      `duration=${formatNumber(row.durationSeconds)}`
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
    `${name.padEnd(52)} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log('');

console.log(
  `OVERALL AUDIT: ${validationPass ? 'PASS' : 'FAIL'}`
);

console.log('');

console.log(
  `Summary:\n${outputPath}`
);

console.log('');


// ============================================================
// HELPERS
// ============================================================

function compactTransition(
  row
) {
  return {
    deathIndex:
      finite(
        row?.deathIndex
      ),

    clock:
      row?.clock ??
      null,

    baseType:
      row?.baseType ??
      null,

    creditedPlayerName:
      row?.creditedPlayerName ??
      null,

    targetPlayerName:
      row?.targetPlayerName ??
      null,

    targetDelaySeconds:
      finite(
        row?.targetDelaySeconds
      ),

    distanceAtOnset3D:
      finite(
        row
          ?.targetGeometry
          ?.distanceAtOnset3D
      ),

    distanceAtOnsetXY:
      finite(
        row
          ?.targetGeometry
          ?.distanceAtOnsetXY
      ),

    distanceBeforeOnset3D:
      finite(
        row
          ?.targetGeometry
          ?.distanceBeforeOnset3D
      ),

    distanceBeforeOnsetXY:
      finite(
        row
          ?.targetGeometry
          ?.distanceBeforeOnsetXY
      )
  };
}


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


function values(
  rows,
  selector
) {
  return rows
    .map(
      row =>
        finite(
          selector(
            row
          )
        )
    )
    .filter(
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

      p99:
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

    p95:
      quantile(
        clean,
        0.95
      ),

    p99:
      quantile(
        clean,
        0.99
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
      ) /
      clean.length
  };
}


function quantile(
  sorted,
  q
) {
  if (
    !Array.isArray(
      sorted
    )
    ||
    sorted.length ===
    0
  ) {
    return null;
  }

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
    return sorted[
      lower
    ];
  }

  const weight =
    position -
    lower;

  return (
    sorted[lower] *
      (
        1 -
        weight
      )
    +
    sorted[upper] *
      weight
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


function formatMeters(
  hu
) {
  return Number.isFinite(
    hu
  )
    ? (
      hu /
      HU_PER_METER
    ).toFixed(
      2
    )
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
    ).toFixed(2)}%`
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
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}