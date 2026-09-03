import {
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';

import {
  basename,
  dirname,
  extname,
  resolve
} from 'node:path';

import {
  createHash
} from 'node:crypto';


// ============================================================
// SETTINGS
// ============================================================

const DISCOVERY_REPLAY =
  'test';


const REPLAY_DIRECTORY =
  resolve(
    'replays'
  );


const OUTPUT_ROOT =
  resolve(
    'output'
  );


const CROSS_REPLAY_OUTPUT_DIRECTORY =
  resolve(
    OUTPUT_ROOT,
    'cross_replay'
  );


const outputJsonPath =
  resolve(
    CROSS_REPLAY_OUTPUT_DIRECTORY,
    'replication_manifest_v01.json'
  );


const outputMarkdownPath =
  resolve(
    CROSS_REPLAY_OUTPUT_DIRECTORY,
    'replication_manifest_v01.md'
  );


// ============================================================
// QUICK FILE FINGERPRINT
//
// Full replay hashing could read hundreds of megabytes or more
// per replay.
//
// For cohort identity / duplicate detection we instead hash:
//
//   file size
//   first 1 MiB
//   last 1 MiB
//
// This is not a cryptographic proof of unique replay content.
//
// It is a lightweight duplicate-detection fingerprint.
// ============================================================

const FINGERPRINT_CHUNK_BYTES =
  1024 *
  1024;


// ============================================================
// AUTHORITATIVE SINGLE-REPLAY OUTPUTS
//
// These are NOT required to already exist for new replays.
//
// They are inspected so the future runner can determine what
// work has already been completed.
//
// The foundational checkpoint itself is expected only for the
// discovery replay at this stage.
// ============================================================

const OUTPUT_ARTIFACTS = [

  {
    id:
      'PLAYER_STATE',

    filename:
      'player_state.jsonl'
  },

  {
    id:
      'GROUND_SOUL_LIFECYCLE',

    filename:
      'assigned_gold_lifecycle_classifier_v01.json'
  },

  {
    id:
      'EXACT_CREDIT_ATTRIBUTION',

    filename:
      'assigned_gold_exact_credit_attribution_validation_v01.json'
  },

  {
    id:
      'SHARE_RECIPIENT_GEOMETRY',

    filename:
      'assigned_gold_share_recipient_geometry_comparison_v01.json'
  },

  {
    id:
      'FINAL_INTEGER_ALLOCATION',

    filename:
      'assigned_gold_final_integer_allocation_validation_v01.json'
  },

  {
    id:
      'FACING_ANGLE_SEMANTICS',

    filename:
      'player_facing_angle_semantics_validation_v02.json'
  },

  {
    id:
      'AIM_ANGLE_SEMANTICS',

    filename:
      'player_eye_angle_shot_direction_validation_v01.json'
  },

  {
    id:
      'FOUNDATIONAL_CHECKPOINT',

    filename:
      'foundational_discovery_checkpoint_v01.json'
  }
];


// ============================================================
// REPLICATION CONTRACT
//
// Carried forward directly from Script99.
//
// Script100 does NOT test these mechanics.
//
// It establishes the cohort against which they will be tested.
// ============================================================

const REPLICATION_CONTRACT = [

  {
    order:
      1,

    id:
      'GROUND_SOUL_PRODUCTION_LAST_HIT_LINK',

    question:
      'Does player-last-hit Trooper death remain strongly associated with AssignedGold production?'
  },

  {
    order:
      2,

    id:
      'GROUND_SOUL_LIFECYCLE',

    question:
      'Do targeted and targetless AssignedGold lifecycle classes reconstruct coherently?'
  },

  {
    order:
      3,

    id:
      'VACUUM_PROXIMITY',

    question:
      'Does physical vacuum targeting remain strongly associated with proximity to the ground soul?'
  },

  {
    order:
      4,

    id:
      'ECONOMIC_RECIPIENT_SET',

    question:
      'Is the credited last-hitter economically included while physical vacuum target remains distinct from economic ownership?'
  },

  {
    order:
      5,

    id:
      'RECIPIENT_GEOMETRY',

    question:
      'Does death-time Trooper-centered 3D geometry continue to predict economic sharing membership?'
  },

  {
    order:
      6,

    id:
      'REWARD_ALLOCATION',

    question:
      'Do reward scaling, sharing, integer partition, and credited remainder priority reproduce?'
  },

  {
    order:
      7,

    id:
      'AIM_ORIENTATION',

    question:
      'Do component-1 yaw, component-0 eye pitch, pitch sign, and shot-linked eye orientation reproduce?'
  }
];


// ============================================================
// REPLAY DIRECTORY CHECK
// ============================================================

if (
  !existsSync(
    REPLAY_DIRECTORY
  )
) {

  throw new Error(
    `Replay directory does not exist:\n${REPLAY_DIRECTORY}`
  );
}


// ============================================================
// DISCOVER DEM FILES
// ============================================================

const replayFiles =
  readdirSync(
    REPLAY_DIRECTORY,
    {
      withFileTypes:
        true
    }
  )
    .filter(
      entry =>
        entry.isFile()
        &&
        extname(
          entry.name
        )
          .toLowerCase() ===
        '.dem'
    )
    .map(
      entry => {

        const path =
          resolve(
            REPLAY_DIRECTORY,
            entry.name
          );


        const stats =
          statSync(
            path
          );


        return {

          filename:
            entry.name,

          replayName:
            basename(
              entry.name,
              extname(
                entry.name
              )
            ),

          path,

          sizeBytes:
            stats.size,

          sizeMiB:
            stats.size /
            (
              1024 *
              1024
            ),

          modifiedTime:
            stats.mtime.toISOString()
        };
      }
    )
    .sort(
      (
        a,
        b
      ) =>
        a.replayName.localeCompare(
          b.replayName
        )
    );


console.log('');

console.log(
  `Found ${replayFiles.length} replay file(s).`
);


// ============================================================
// BUILD FINGERPRINTS
// ============================================================

console.log('');

console.log(
  'Computing lightweight replay fingerprints...'
);


for (
  const replay
  of replayFiles
) {

  replay.quickFingerprint =
    quickFileFingerprint(
      replay.path,
      replay.sizeBytes
    );


  console.log(
    `${replay.replayName.padEnd(28)} ${replay.quickFingerprint}`
  );
}


// ============================================================
// DUPLICATE GROUPS
// ============================================================

const fingerprintGroups =
  new Map();


for (
  const replay
  of replayFiles
) {

  if (
    !fingerprintGroups.has(
      replay.quickFingerprint
    )
  ) {

    fingerprintGroups.set(
      replay.quickFingerprint,
      []
    );
  }


  fingerprintGroups
    .get(
      replay.quickFingerprint
    )
    .push(
      replay.replayName
    );
}


const duplicateFingerprintGroups =
  [
    ...fingerprintGroups.entries()
  ]
    .filter(
      (
        [
          fingerprint,
          names
        ]
      ) =>
        names.length >
        1
    )
    .map(
      (
        [
          fingerprint,
          names
        ]
      ) => ({

        fingerprint,

        replayNames:
          names
      })
    );


// ============================================================
// DISCOVERY REPLAY
// ============================================================

const discoveryReplay =
  replayFiles.find(
    replay =>
      replay.replayName ===
      DISCOVERY_REPLAY
  )
  ??
  null;


const discoveryFingerprint =
  discoveryReplay
    ?.quickFingerprint ??
  null;


// ============================================================
// INSPECT OUTPUTS
// ============================================================

const replayRows =
  [];


for (
  const replay
  of replayFiles
) {

  const outputDirectory =
    resolve(
      OUTPUT_ROOT,
      replay.replayName
    );


  const artifacts =
    {};


  let presentArtifactCount =
    0;


  for (
    const artifact
    of OUTPUT_ARTIFACTS
  ) {

    const path =
      resolve(
        outputDirectory,
        artifact.filename
      );


    const present =
      existsSync(
        path
      );


    let validationPass =
      null;


    let version =
      null;


    let status =
      null;


    if (
      present
      &&
      artifact.filename.endsWith(
        '.json'
      )
    ) {

      try {

        const parsed =
          JSON.parse(
            readFileUtf8(
              path
            )
          );


        validationPass =
          typeof parsed
            ?.validation
            ?.pass ===
          'boolean'
            ? parsed.validation.pass
            : null;


        version =
          parsed?.version ??
          null;


        status =
          parsed?.status ??
          parsed?.checkpointStatus ??
          null;

      } catch {

        validationPass =
          null;
      }
    }


    artifacts[
      artifact.id
    ] = {

      filename:
        artifact.filename,

      path,

      present,

      validationPass,

      version,

      status
    };


    if (
      present
    ) {

      presentArtifactCount++;
    }
  }


  const sameAsDiscovery =
    Boolean(
      discoveryFingerprint
    )
    &&
    replay.replayName !==
      DISCOVERY_REPLAY
    &&
    replay.quickFingerprint ===
      discoveryFingerprint;


  const duplicateNames =
    fingerprintGroups.get(
      replay.quickFingerprint
    )
    ??
    [];


  const duplicateOfAnotherReplay =
    duplicateNames.length >
    1;


  const role =
    replay.replayName ===
      DISCOVERY_REPLAY
      ? 'DISCOVERY_CALIBRATION'
      : sameAsDiscovery
        ? 'EXCLUDED_DUPLICATE_OF_DISCOVERY'
        : duplicateOfAnotherReplay
          ? 'REPLICATION_DUPLICATE_CANDIDATE'
          : 'INDEPENDENT_REPLICATION_CANDIDATE';


  const stage =
    classifyReplayStage(
      artifacts,
      role
    );


  replayRows.push({

    ...replay,

    outputDirectory,

    role,

    stage,

    sameAsDiscovery,

    duplicateOfAnotherReplay,

    duplicateReplayNames:
      duplicateNames.filter(
        name =>
          name !==
          replay.replayName
      ),

    artifactCoverage: {

      present:
        presentArtifactCount,

      possible:
        OUTPUT_ARTIFACTS.length,

      fraction:
        presentArtifactCount /
        OUTPUT_ARTIFACTS.length
    },

    artifacts
  });
}


// ============================================================
// REPLICATION COHORT
//
// A valid independent candidate:
//
// - is not test.dem
// - is not fingerprint-identical to test.dem
// - is not one of multiple files with the same fingerprint
//
// For duplicate groups among independent files, only the
// lexicographically first name is retained automatically.
//
// The others remain visible in the manifest.
// ============================================================

const independentRows =
  replayRows.filter(
    row =>
      row.role ===
      'INDEPENDENT_REPLICATION_CANDIDATE'
    ||
      row.role ===
      'REPLICATION_DUPLICATE_CANDIDATE'
  );


const selectedReplicationRows =
  [];


const usedFingerprints =
  new Set();


for (
  const row
  of independentRows
) {

  if (
    usedFingerprints.has(
      row.quickFingerprint
    )
  ) {

    continue;
  }


  usedFingerprints.add(
    row.quickFingerprint
  );


  selectedReplicationRows.push(
    row
  );
}


// ============================================================
// COHORT SIZE INTERPRETATION
// ============================================================

const independentReplayCount =
  selectedReplicationRows.length;


let cohortStatus;


if (
  independentReplayCount ===
  0
) {

  cohortStatus =
    'NO_INDEPENDENT_REPLAYS_AVAILABLE';

} else if (
  independentReplayCount <
  3
) {

  cohortStatus =
    'REPLICATION_COHORT_TOO_SMALL_FOR_STRONG_GENERALIZATION';

} else if (
  independentReplayCount <
  5
) {

  cohortStatus =
    'MINIMUM_REPLICATION_COHORT_AVAILABLE';

} else {

  cohortStatus =
    'STRONG_INITIAL_REPLICATION_COHORT_AVAILABLE';
}


// ============================================================
// DISCOVERY CHECKPOINT VALIDATION
// ============================================================

const discoveryCheckpoint =
  discoveryReplay
    ? replayRows
        .find(
          row =>
            row.replayName ===
            DISCOVERY_REPLAY
        )
        ?.artifacts
        ?.FOUNDATIONAL_CHECKPOINT
    : null;


const discoveryCheckpointReady =
  Boolean(
    discoveryCheckpoint
      ?.present
  )
  &&
  (
    discoveryCheckpoint
      ?.validationPass ===
      true
    ||
    discoveryCheckpoint
      ?.status ===
      'READY_FOR_COMPACT_CROSS_REPLAY_REPLICATION'
  );


// ============================================================
// REPLICATION PLAN
// ============================================================

const replicationPlan =
  selectedReplicationRows.map(
    (
      row,
      index
    ) => ({

      order:
        index +
        1,

      replayName:
        row.replayName,

      filename:
        row.filename,

      fingerprint:
        row.quickFingerprint,

      sizeMiB:
        row.sizeMiB,

      currentStage:
        row.stage,

      nextAction:
        getNextAction(
          row
        )
    })
  );


// ============================================================
// READINESS
// ============================================================

const readyToBeginReplication =
  discoveryCheckpointReady
  &&
  independentReplayCount >
  0;


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    'CROSS_REPLAY_REPLICATION_MANIFEST_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  discoveryReplay:
    DISCOVERY_REPLAY,

  discoveryCheckpointReady,

  readyToBeginReplication,

  cohortStatus,


  purpose: [

    'Freeze test.dem as the discovery/calibration replay.',

    'Discover independent .dem files automatically.',

    'Prevent obvious duplicate replay files from being counted as independent replication.',

    'Record current per-replay output readiness.',

    'Create the persistent cohort manifest for compact cross-replay replication.',

    'Separate replication of already-established relationships from further single-replay mechanic fitting.'
  ],


  authorityPolicy: {

    discoveryReplay:
      'test.dem',

    discoveryUse:
      'Used to discover and operationally validate telemetry semantics.',

    replicationUse:
      'Independent replay files are used to test whether those relationships generalize.',

    prohibition:
      'Failure on a new replay should first be treated as replication evidence or a version/schema difference, not automatically repaired by fitting a new threshold to that replay.'
  },


  replayInventory: {

    totalDemFiles:
      replayRows.length,

    independentReplicationFiles:
      independentReplayCount,

    duplicateFingerprintGroups:
      duplicateFingerprintGroups.length
  },


  duplicateFingerprintGroups,


  replayRows,


  selectedReplicationCohort:
    replicationPlan,


  replicationContract:
    REPLICATION_CONTRACT,


  recommendedInterpretation: {

    zeroIndependent:
      'Add independent Deadlock replay .dem files to the replays directory before beginning replication.',

    oneToTwo:
      'Useful for debugging the replication harness, but insufficient for strong generalization.',

    threeToFour:
      'Adequate minimum first replication cohort.',

    fiveOrMore:
      'Preferred initial cohort for assessing stability of the foundational telemetry relationships.'
  },


  nextStage: {

    id:
      'COMPACT_REPLICATION_EXECUTION',

    description:
      'Run the foundational relationship tests on each selected independent replay and aggregate replay-level effect sizes rather than pooling all events into one pseudo-replay.',

    unitOfReplication:
      'REPLAY',

    important:
      'Event counts within a replay provide precision, but independent replay-level reproduction is the evidence of generalization.'
  },


  outputs: {

    json:
      outputJsonPath,

    markdown:
      outputMarkdownPath
  }
};


// ============================================================
// MARKDOWN
// ============================================================

const markdown =
  buildMarkdown(
    summary
  );


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    outputJsonPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputJsonPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  outputMarkdownPath,
  markdown,
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
  'CROSS-REPLAY REPLICATION INITIALIZATION V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// DISCOVERY
// ============================================================

console.log('');

console.log(
  'DISCOVERY REPLAY'
);

console.log(
  '----------------'
);


if (
  discoveryReplay
) {

  console.log(
    `Replay:       ${discoveryReplay.replayName}`
  );


  console.log(
    `Fingerprint:  ${discoveryReplay.quickFingerprint}`
  );


  console.log(
    `Checkpoint:   ${discoveryCheckpointReady ? 'READY' : 'NOT READY'}`
  );

} else {

  console.log(
    'test.dem not found.'
  );
}


// ============================================================
// INVENTORY
// ============================================================

console.log('');

console.log(
  'REPLAY INVENTORY'
);

console.log(
  '----------------'
);


for (
  const row
  of replayRows
) {

  console.log('');

  console.log(
    `${row.replayName}`
  );


  console.log(
    `  file:        ${row.filename}`
  );


  console.log(
    `  size:        ${formatNumber(row.sizeMiB)} MiB`
  );


  console.log(
    `  role:        ${row.role}`
  );


  console.log(
    `  stage:       ${row.stage}`
  );


  console.log(
    `  fingerprint: ${row.quickFingerprint}`
  );


  console.log(
    `  outputs:     ${row.artifactCoverage.present}/${row.artifactCoverage.possible}`
  );


  if (
    row.duplicateReplayNames.length >
    0
  ) {

    console.log(
      `  duplicates:  ${row.duplicateReplayNames.join(', ')}`
    );
  }
}


// ============================================================
// SELECTED COHORT
// ============================================================

console.log('');

console.log(
  'SELECTED INDEPENDENT REPLICATION COHORT'
);

console.log(
  '---------------------------------------'
);


if (
  replicationPlan.length ===
  0
) {

  console.log(
    'No independent replay files available.'
  );

} else {

  for (
    const row
    of replicationPlan
  ) {

    console.log(
      `${row.order}. ${row.replayName} — ${row.currentStage}`
    );
  }
}


// ============================================================
// DUPLICATES
// ============================================================

console.log('');

console.log(
  'DUPLICATE CHECK'
);

console.log(
  '---------------'
);


if (
  duplicateFingerprintGroups.length ===
  0
) {

  console.log(
    'No duplicate replay fingerprints detected.'
  );

} else {

  for (
    const group
    of duplicateFingerprintGroups
  ) {

    console.log(
      `${group.fingerprint}: ${group.replayNames.join(', ')}`
    );
  }
}


// ============================================================
// READINESS
// ============================================================

console.log('');

console.log(
  'REPLICATION READINESS'
);

console.log(
  '---------------------'
);


console.log(
  `Discovery checkpoint ready: ${discoveryCheckpointReady}`
);


console.log(
  `Independent replay count:    ${independentReplayCount}`
);


console.log(
  `Cohort status:               ${cohortStatus}`
);


console.log(
  `Ready to begin replication:  ${readyToBeginReplication}`
);


// ============================================================
// NEXT ACTION
// ============================================================

console.log('');

console.log(
  'NEXT ACTION BY REPLAY'
);

console.log(
  '---------------------'
);


if (
  replicationPlan.length ===
  0
) {

  console.log(
    'Place independent .dem files in:'
  );


  console.log(
    REPLAY_DIRECTORY
  );

} else {

  for (
    const row
    of replicationPlan
  ) {

    console.log(
      `${row.replayName.padEnd(28)} ${row.nextAction}`
    );
  }
}


// ============================================================
// OUTPUTS
// ============================================================

console.log('');

console.log(
  `JSON:\n${outputJsonPath}`
);


console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);


console.log('');


// ============================================================
// STAGE CLASSIFICATION
// ============================================================

function classifyReplayStage(
  artifacts,
  role
) {

  if (
    role ===
    'EXCLUDED_DUPLICATE_OF_DISCOVERY'
  ) {

    return 'EXCLUDED_DUPLICATE';
  }


  if (
    artifacts
      .FOUNDATIONAL_CHECKPOINT
      .present
  ) {

    return 'FOUNDATIONAL_CHECKPOINT_PRESENT';
  }


  const advancedArtifacts = [

    'GROUND_SOUL_LIFECYCLE',
    'EXACT_CREDIT_ATTRIBUTION',
    'SHARE_RECIPIENT_GEOMETRY',
    'FINAL_INTEGER_ALLOCATION',
    'FACING_ANGLE_SEMANTICS',
    'AIM_ANGLE_SEMANTICS'
  ];


  const advancedPresent =
    advancedArtifacts.filter(
      id =>
        artifacts[
          id
        ].present
    ).length;


  if (
    advancedPresent ===
    advancedArtifacts.length
  ) {

    return 'FOUNDATIONAL_OUTPUTS_PRESENT';
  }


  if (
    advancedPresent >
    0
  ) {

    return 'PARTIAL_FOUNDATIONAL_OUTPUTS';
  }


  if (
    artifacts
      .PLAYER_STATE
      .present
  ) {

    return 'PLAYER_STATE_ONLY';
  }


  return 'RAW_REPLAY_ONLY';
}


// ============================================================
// NEXT ACTION
// ============================================================

function getNextAction(
  row
) {

  switch (
    row.stage
  ) {

    case 'FOUNDATIONAL_CHECKPOINT_PRESENT':

      return 'Ready for cross-replay aggregation.';


    case 'FOUNDATIONAL_OUTPUTS_PRESENT':

      return 'Ready for replication summarization.';


    case 'PARTIAL_FOUNDATIONAL_OUTPUTS':

      return 'Complete missing compact replication metrics.';


    case 'PLAYER_STATE_ONLY':

      return 'Run compact ground-soul/economy replication extraction.';


    case 'RAW_REPLAY_ONLY':

      return 'Run base replay extraction, then compact replication metrics.';


    default:

      return 'Inspect replay status.';
  }
}


// ============================================================
// QUICK FINGERPRINT
// ============================================================

function quickFileFingerprint(
  path,
  fileSize
) {

  const hash =
    createHash(
      'sha256'
    );


  hash.update(
    `size:${fileSize}|`
  );


  const descriptor =
    openSync(
      path,
      'r'
    );


  try {

    const firstLength =
      Math.min(
        FINGERPRINT_CHUNK_BYTES,
        fileSize
      );


    if (
      firstLength >
      0
    ) {

      const firstBuffer =
        Buffer.alloc(
          firstLength
        );


      const firstRead =
        readSync(
          descriptor,
          firstBuffer,
          0,
          firstLength,
          0
        );


      hash.update(
        firstBuffer.subarray(
          0,
          firstRead
        )
      );
    }


    if (
      fileSize >
      FINGERPRINT_CHUNK_BYTES
    ) {

      const lastLength =
        Math.min(
          FINGERPRINT_CHUNK_BYTES,
          fileSize
        );


      const lastBuffer =
        Buffer.alloc(
          lastLength
        );


      const lastPosition =
        Math.max(
          0,
          fileSize -
          lastLength
        );


      const lastRead =
        readSync(
          descriptor,
          lastBuffer,
          0,
          lastLength,
          lastPosition
        );


      hash.update(
        lastBuffer.subarray(
          0,
          lastRead
        )
      );
    }

  } finally {

    closeSync(
      descriptor
    );
  }


  return hash
    .digest(
      'hex'
    )
    .slice(
      0,
      24
    );
}


// ============================================================
// READ UTF8
// ============================================================

function readFileUtf8(
  path
) {

  return createReadStreamSync(
    path
  );
}


function createReadStreamSync(
  path
) {

  const descriptor =
    openSync(
      path,
      'r'
    );


  try {

    const size =
      statSync(
        path
      ).size;


    const buffer =
      Buffer.alloc(
        size
      );


    let offset =
      0;


    while (
      offset <
      size
    ) {

      const bytesRead =
        readSync(
          descriptor,
          buffer,
          offset,
          size -
          offset,
          offset
        );


      if (
        bytesRead <=
        0
      ) {

        break;
      }


      offset +=
        bytesRead;
    }


    return buffer
      .subarray(
        0,
        offset
      )
      .toString(
        'utf8'
      );

  } finally {

    closeSync(
      descriptor
    );
  }
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
    '# DeadlockBehavior Cross-Replay Replication Manifest'
  );


  lines.push(
    ''
  );


  lines.push(
    `Created: ${summary.createdAt}`
  );


  lines.push(
    ''
  );


  lines.push(
    `Discovery replay: \`${summary.discoveryReplay}.dem\``
  );


  lines.push(
    ''
  );


  lines.push(
    `Discovery checkpoint ready: **${summary.discoveryCheckpointReady}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Independent replay count: **${summary.replayInventory.independentReplicationFiles}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Cohort status: **${summary.cohortStatus}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Selected replication cohort'
  );


  lines.push(
    ''
  );


  if (
    summary
      .selectedReplicationCohort
      .length ===
    0
  ) {

    lines.push(
      'No independent replay files are currently available.'
    );

  } else {

    for (
      const row
      of summary.selectedReplicationCohort
    ) {

      lines.push(
        `${row.order}. \`${row.replayName}.dem\` — ${row.currentStage}`
      );
    }
  }


  lines.push(
    ''
  );


  lines.push(
    '## Replication contract'
  );


  lines.push(
    ''
  );


  for (
    const row
    of summary.replicationContract
  ) {

    lines.push(
      `${row.order}. **${row.id}** — ${row.question}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Replay inventory'
  );


  lines.push(
    ''
  );


  for (
    const row
    of summary.replayRows
  ) {

    lines.push(
      `### ${row.replayName}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Role: ${row.role}`
    );


    lines.push(
      `- Stage: ${row.stage}`
    );


    lines.push(
      `- Size: ${formatNumber(row.sizeMiB)} MiB`
    );


    lines.push(
      `- Fingerprint: \`${row.quickFingerprint}\``
    );


    lines.push(
      `- Outputs: ${row.artifactCoverage.present}/${row.artifactCoverage.possible}`
    );


    if (
      row.duplicateReplayNames.length >
      0
    ) {

      lines.push(
        `- Duplicate fingerprint with: ${row.duplicateReplayNames.join(', ')}`
      );
    }


    lines.push(
      ''
    );
  }


  return lines.join(
    '\n'
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
        2
      )
    ).toString()
    : 'n/a';
}