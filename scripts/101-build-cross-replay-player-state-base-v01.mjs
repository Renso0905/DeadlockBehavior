import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

import {
  spawnSync
} from 'node:child_process';


// ============================================================
// SETTINGS
// ============================================================

const FORCE =
  process.argv.includes(
    '--force'
  );


const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const PLAYER_STATE_SCRIPT =
  resolve(
    'scripts',
    '03-extract-player-state.mjs'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_state_base_batch_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_state_base_batch_v01.md'
  );


// ============================================================
// REQUIRED OUTPUTS FROM SCRIPT 03
// ============================================================

const REQUIRED_PLAYER_STATE_OUTPUTS = [

  'player_state.jsonl',

  'player_state_summary.json'
];


// ============================================================
// INPUT VALIDATION
// ============================================================

if (
  !existsSync(
    MANIFEST_PATH
  )
) {

  throw new Error(
    `Missing Script 100 manifest:\n${MANIFEST_PATH}`
  );
}


if (
  !existsSync(
    PLAYER_STATE_SCRIPT
  )
) {

  throw new Error(
    `Missing player-state extractor:\n${PLAYER_STATE_SCRIPT}`
  );
}


// ============================================================
// LOAD MANIFEST
// ============================================================

const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


if (
  manifest
    ?.readyToBeginReplication !==
  true
) {

  throw new Error(
    'Script 100 manifest is not ready for replication.'
  );
}


const cohort =
  Array.isArray(
    manifest
      ?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No independent replication replays were found in the Script 100 manifest.'
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
  'CROSS-REPLAY PLAYER-STATE BASE EXTRACTION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  `Independent replay cohort: ${cohort.length}`
);


console.log(
  `Force re-extraction:        ${FORCE}`
);


console.log(
  `Node executable:            ${process.execPath}`
);


// ============================================================
// RESULTS
// ============================================================

const results =
  [];


const batchStartedAt =
  new Date();


const batchStartedMs =
  Date.now();


// ============================================================
// RUN REPLAYS SEQUENTIALLY
//
// IMPORTANT:
//
// We deliberately do NOT parallelize 500-700 MiB replay parses.
//
// Sequential execution:
//   - reduces disk thrashing
//   - reduces RAM pressure
//   - makes failures easier to diagnose
//   - produces deterministic logs
// ============================================================

for (
  let index =
    0;

  index <
    cohort.length;

  index++
) {

  const cohortRow =
    cohort[
      index
    ];


  const replayName =
    String(
      cohortRow.replayName
    );


  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`
    );


  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const statePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const summaryPath =
    resolve(
      outputDirectory,
      'player_state_summary.json'
    );


  console.log('');

  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${index + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  // ----------------------------------------------------------
  // REPLAY FILE
  // ----------------------------------------------------------

  if (
    !existsSync(
      replayPath
    )
  ) {

    console.log(
      'FAIL: replay file missing.'
    );


    results.push({

      replayName,

      replayPath,

      status:
        'REPLAY_FILE_MISSING',

      attempted:
        false,

      skipped:
        false,

      success:
        false
    });


    continue;
  }


  const replayStats =
    statSync(
      replayPath
    );


  console.log(
    `Replay size: ${formatNumber(
      replayStats.size /
      (
        1024 *
        1024
      )
    )} MiB`
  );


  // ----------------------------------------------------------
  // EXISTING OUTPUT CHECK
  // ----------------------------------------------------------

  const preexistingState =
    existsSync(
      statePath
    );


  const preexistingSummary =
    existsSync(
      summaryPath
    );


  const existingComplete =
    preexistingState
    &&
    preexistingSummary;


  if (
    existingComplete
    &&
    !FORCE
  ) {

    const inspection =
      inspectOutputs(
        replayName,
        statePath,
        summaryPath
      );


    console.log(
      'Existing complete player-state extraction found.'
    );


    console.log(
      'Skipping. Use --force to regenerate.'
    );


    printInspection(
      inspection
    );


    results.push({

      replayName,

      replayPath,

      replaySizeBytes:
        replayStats.size,

      status:
        inspection.valid
          ? 'SKIPPED_EXISTING_VALID'
          : 'SKIPPED_EXISTING_INVALID',

      attempted:
        false,

      skipped:
        true,

      success:
        inspection.valid,

      durationSeconds:
        0,

      inspection
    });


    continue;
  }


  // ----------------------------------------------------------
  // RUN SCRIPT 03
  // ----------------------------------------------------------

  mkdirSync(
    outputDirectory,
    {
      recursive:
        true
    }
  );


  const startedAt =
    new Date();


  const startedMs =
    Date.now();


  console.log(
    `Starting: ${startedAt.toISOString()}`
  );


  console.log('');

  console.log(
    `${process.execPath} ${PLAYER_STATE_SCRIPT} ${replayPath}`
  );


  console.log('');


  const child =
    spawnSync(

      process.execPath,

      [
        PLAYER_STATE_SCRIPT,
        replayPath
      ],

      {

        cwd:
          process.cwd(),

        stdio:
          'inherit',

        windowsHide:
          false
      }
    );


  const finishedAt =
    new Date();


  const finishedMs =
    Date.now();


  const durationSeconds =
    (
      finishedMs -
      startedMs
    )
    /
    1000;


  // ----------------------------------------------------------
  // CHILD PROCESS FAILURE
  // ----------------------------------------------------------

  if (
    child.error
  ) {

    console.log('');

    console.log(
      `FAIL: ${child.error.message}`
    );


    results.push({

      replayName,

      replayPath,

      replaySizeBytes:
        replayStats.size,

      status:
        'PROCESS_ERROR',

      attempted:
        true,

      skipped:
        false,

      success:
        false,

      exitCode:
        child.status,

      signal:
        child.signal,

      error:
        child.error.message,

      startedAt:
        startedAt.toISOString(),

      finishedAt:
        finishedAt.toISOString(),

      durationSeconds
    });


    continue;
  }


  if (
    child.status !==
    0
  ) {

    console.log('');

    console.log(
      `FAIL: Script 03 exited with code ${child.status}`
    );


    results.push({

      replayName,

      replayPath,

      replaySizeBytes:
        replayStats.size,

      status:
        'NONZERO_EXIT',

      attempted:
        true,

      skipped:
        false,

      success:
        false,

      exitCode:
        child.status,

      signal:
        child.signal,

      startedAt:
        startedAt.toISOString(),

      finishedAt:
        finishedAt.toISOString(),

      durationSeconds
    });


    continue;
  }


  // ----------------------------------------------------------
  // OUTPUT INSPECTION
  // ----------------------------------------------------------

  const inspection =
    inspectOutputs(
      replayName,
      statePath,
      summaryPath
    );


  console.log('');

  printInspection(
    inspection
  );


  const success =
    inspection.valid;


  results.push({

    replayName,

    replayPath,

    replaySizeBytes:
      replayStats.size,

    status:
      success
        ? 'EXTRACTION_PASS'
        : 'OUTPUT_VALIDATION_FAILURE',

    attempted:
      true,

    skipped:
      false,

    success,

    exitCode:
      child.status,

    signal:
      child.signal,

    startedAt:
      startedAt.toISOString(),

    finishedAt:
      finishedAt.toISOString(),

    durationSeconds,

    inspection
  });
}


// ============================================================
// BATCH SUMMARY
// ============================================================

const batchFinishedAt =
  new Date();


const batchFinishedMs =
  Date.now();


const succeeded =
  results.filter(
    row =>
      row.success
  );


const failed =
  results.filter(
    row =>
      !row.success
  );


const attempted =
  results.filter(
    row =>
      row.attempted
  );


const skipped =
  results.filter(
    row =>
      row.skipped
  );


const allReady =
  results.length ===
    cohort.length
  &&
  results.every(
    row =>
      row.success
  );


// ============================================================
// CROSS-REPLAY STRUCTURAL CHECKS
//
// These are not mechanic replication tests.
//
// They simply verify that all replays yielded the basic substrate
// expected by later replication scripts.
// ============================================================

const allHavePlayers =
  succeeded.every(
    row =>
      (
        row
          ?.inspection
          ?.playerCount ??
        0
      ) >
      0
  );


const allHaveRecords =
  succeeded.every(
    row =>
      (
        row
          ?.inspection
          ?.recordsWritten ??
        0
      ) >
      0
  );


const allHaveMatchClock =
  succeeded.every(
    row =>
      row
        ?.inspection
        ?.hasMatchClock ===
      true
  );


const allHaveStateFiles =
  succeeded.every(
    row =>
      (
        row
          ?.inspection
          ?.stateFileBytes ??
        0
      ) >
      0
  );


const baseExtractionReady =
  allReady
  &&
  allHavePlayers
  &&
  allHaveRecords
  &&
  allHaveStateFiles;


// ============================================================
// REPLAY-LEVEL INVENTORY
// ============================================================

const replayInventory =
  results.map(
    row => ({

      replayName:
        row.replayName,

      status:
        row.status,

      success:
        row.success,

      skipped:
        row.skipped,

      replaySizeMiB:
        Number.isFinite(
          row.replaySizeBytes
        )
          ? row.replaySizeBytes /
            (
              1024 *
              1024
            )
          : null,

      durationSeconds:
        row.durationSeconds ??
        null,

      stateFileMiB:
        Number.isFinite(
          row
            ?.inspection
            ?.stateFileBytes
        )
          ? row.inspection.stateFileBytes /
            (
              1024 *
              1024
            )
          : null,

      recordsWritten:
        row
          ?.inspection
          ?.recordsWritten ??
        null,

      playerCount:
        row
          ?.inspection
          ?.playerCount ??
        null,

      firstMatchTime:
        row
          ?.inspection
          ?.firstMatchTime ??
        null,

      finalMatchTime:
        row
          ?.inspection
          ?.finalMatchTime ??
        null
    })
  );


// ============================================================
// SUMMARY OBJECT
// ============================================================

const summary = {

  version:
    'CROSS_REPLAY_PLAYER_STATE_BASE_BATCH_V01',

  canonical:
    false,

  createdAt:
    batchFinishedAt.toISOString(),

  force:
    FORCE,


  purpose: [

    'Create the common player-state substrate for every independent replication replay.',

    'Reuse the existing validated Script 03 extractor rather than duplicating player-state logic inside the compact replication event parser.',

    'Provide player identity, team, position, net worth, currency buckets, body orientation, eye orientation, camera orientation, and match-clock state for later replication tests.',

    'Run replay parsing sequentially to reduce resource contention.',

    'Do not treat successful extraction as mechanic replication evidence.'
  ],


  sourceManifest: {

    path:
      MANIFEST_PATH,

    manifestVersion:
      manifest?.version ??
      null,

    cohortStatus:
      manifest?.cohortStatus ??
      null,

    discoveryReplay:
      manifest?.discoveryReplay ??
      null,

    discoveryCheckpointReady:
      manifest?.discoveryCheckpointReady ??
      null
  },


  extractor: {

    script:
      PLAYER_STATE_SCRIPT,

    nodeExecutable:
      process.execPath,

    requiredOutputs:
      REQUIRED_PLAYER_STATE_OUTPUTS
  },


  batch: {

    startedAt:
      batchStartedAt.toISOString(),

    finishedAt:
      batchFinishedAt.toISOString(),

    durationSeconds:
      (
        batchFinishedMs -
        batchStartedMs
      )
      /
      1000,

    cohortSize:
      cohort.length,

    resultCount:
      results.length,

    attempted:
      attempted.length,

    skipped:
      skipped.length,

    succeeded:
      succeeded.length,

    failed:
      failed.length
  },


  structuralChecks: {

    allReady,

    allHavePlayers,

    allHaveRecords,

    allHaveMatchClock,

    allHaveStateFiles,

    baseExtractionReady
  },


  replayInventory,


  results,


  nextStage: {

    ready:
      baseExtractionReady,

    id:
      'COMPACT_EVENT_REPLICATION_EXTRACTION',

    description:
      'Parse each independent replay once for the event-centered Trooper, AssignedGold, economy, lifecycle, geometry, and shot-direction telemetry required by the frozen Script 99 replication contract.'
  },


  outputs: {

    json:
      OUTPUT_JSON_PATH,

    markdown:
      OUTPUT_MARKDOWN_PATH
  }
};


// ============================================================
// WRITE
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

console.log('');

console.log(
  '========================================================'
);

console.log(
  'CROSS-REPLAY PLAYER-STATE BASE SUMMARY'
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
  of replayInventory
) {

  console.log('');

  console.log(
    `${row.replayName}`
  );


  console.log(
    `  status:        ${row.status}`
  );


  console.log(
    `  success:       ${row.success}`
  );


  console.log(
    `  records:       ${row.recordsWritten ?? 'n/a'}`
  );


  console.log(
    `  players:       ${row.playerCount ?? 'n/a'}`
  );


  console.log(
    `  state size:    ${formatNumber(row.stateFileMiB)} MiB`
  );


  console.log(
    `  match range:   ${formatNumber(row.firstMatchTime)} -> ${formatNumber(row.finalMatchTime)} sec`
  );


  console.log(
    `  duration:      ${formatDuration(row.durationSeconds)}`
  );
}


// ============================================================
// CHECKS
// ============================================================

console.log('');

console.log(
  'STRUCTURAL CHECKS'
);

console.log(
  '-----------------'
);


console.log(
  `All cohort replays ready:      ${allReady}`
);


console.log(
  `All have players:              ${allHavePlayers}`
);


console.log(
  `All have records:              ${allHaveRecords}`
);


console.log(
  `All have match clock:          ${allHaveMatchClock}`
);


console.log(
  `All have state files:          ${allHaveStateFiles}`
);


console.log('');

console.log(
  `BASE EXTRACTION READY:         ${baseExtractionReady}`
);


// ============================================================
// NEXT
// ============================================================

console.log('');

console.log(
  'NEXT STAGE'
);

console.log(
  '----------'
);


if (
  baseExtractionReady
) {

  console.log(
    'Ready for compact event replication extraction.'
  );

} else {

  console.log(
    'One or more replay base extractions require diagnosis before continuing.'
  );
}


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
// OUTPUT INSPECTION
// ============================================================

function inspectOutputs(
  replayName,
  statePath,
  summaryPath
) {

  const statePresent =
    existsSync(
      statePath
    );


  const summaryPresent =
    existsSync(
      summaryPath
    );


  const stateFileBytes =
    statePresent
      ? statSync(
          statePath
        ).size
      : 0;


  const summaryFileBytes =
    summaryPresent
      ? statSync(
          summaryPath
        ).size
      : 0;


  let parsedSummary =
    null;


  let summaryParseError =
    null;


  if (
    summaryPresent
  ) {

    try {

      parsedSummary =
        JSON.parse(
          readFileSync(
            summaryPath,
            'utf8'
          )
        );

    } catch (
      error
    ) {

      summaryParseError =
        error.message;
    }
  }


  const recordsWritten =
    firstFinite([

      parsedSummary
        ?.recordsWritten,

      parsedSummary
        ?.records,

      parsedSummary
        ?.counts
        ?.recordsWritten,

      parsedSummary
        ?.counts
        ?.records
    ]);


  const playerNames =
    firstArray([

      parsedSummary
        ?.playerNamesSeen,

      parsedSummary
        ?.players,

      parsedSummary
        ?.playerNames
    ]);


  const playerCountFromSummary =
    firstFinite([

      parsedSummary
        ?.playerCount,

      parsedSummary
        ?.counts
        ?.players,

      parsedSummary
        ?.playersSeen
    ]);


  const playerCount =
    Number.isFinite(
      playerCountFromSummary
    )
      ? playerCountFromSummary
      : playerNames
        ? playerNames.length
        : null;


  const firstMatchTime =
    firstFinite([

      parsedSummary
        ?.firstMatchTime,

      parsedSummary
        ?.firstMatchTimeSeconds,

      parsedSummary
        ?.timeRange
        ?.firstMatchTime,

      parsedSummary
        ?.time
        ?.firstMatchTime
    ]);


  const finalMatchTime =
    firstFinite([

      parsedSummary
        ?.finalMatchTime,

      parsedSummary
        ?.finalMatchTimeSeconds,

      parsedSummary
        ?.timeRange
        ?.finalMatchTime,

      parsedSummary
        ?.time
        ?.finalMatchTime
    ]);


  const matchClockOffset =
    firstFinite([

      parsedSummary
        ?.matchClockOffsetSeconds,

      parsedSummary
        ?.matchClockOffset,

      parsedSummary
        ?.clock
        ?.offsetSeconds
    ]);


  const hasMatchClock =
    Number.isFinite(
      matchClockOffset
    )
    ||
    (
      Number.isFinite(
        firstMatchTime
      )
      &&
      Number.isFinite(
        finalMatchTime
      )
    );


  const valid =
    statePresent
    &&
    summaryPresent
    &&
    stateFileBytes >
    0
    &&
    summaryFileBytes >
    0
    &&
    summaryParseError ===
    null;


  return {

    replayName,

    valid,

    statePath,

    summaryPath,

    statePresent,

    summaryPresent,

    stateFileBytes,

    summaryFileBytes,

    summaryParseError,

    recordsWritten,

    playerCount,

    playerNames,

    firstMatchTime,

    finalMatchTime,

    matchClockOffset,

    hasMatchClock,

    parsedSummary
  };
}


// ============================================================
// CONSOLE INSPECTION
// ============================================================

function printInspection(
  inspection
) {

  console.log(
    `Output validation: ${inspection.valid ? 'PASS' : 'FAIL'}`
  );


  console.log(
    `player_state.jsonl: ${formatBytes(inspection.stateFileBytes)}`
  );


  console.log(
    `summary JSON:       ${formatBytes(inspection.summaryFileBytes)}`
  );


  console.log(
    `records written:    ${inspection.recordsWritten ?? 'n/a'}`
  );


  console.log(
    `players:            ${inspection.playerCount ?? 'n/a'}`
  );


  console.log(
    `match clock:        ${inspection.hasMatchClock ? 'present' : 'unresolved'}`
  );


  if (
    inspection.summaryParseError
  ) {

    console.log(
      `summary error:      ${inspection.summaryParseError}`
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
    '# Cross-Replay Player-State Base Extraction'
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
    `Cohort size: **${summary.batch.cohortSize}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Succeeded: **${summary.batch.succeeded}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Failed: **${summary.batch.failed}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Base extraction ready: **${summary.structuralChecks.baseExtractionReady}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Replay results'
  );


  lines.push(
    ''
  );


  for (
    const row
    of summary.replayInventory
  ) {

    lines.push(
      `### ${row.replayName}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Status: ${row.status}`
    );


    lines.push(
      `- Success: ${row.success}`
    );


    lines.push(
      `- Replay size: ${formatNumber(row.replaySizeMiB)} MiB`
    );


    lines.push(
      `- Player-state size: ${formatNumber(row.stateFileMiB)} MiB`
    );


    lines.push(
      `- Records: ${row.recordsWritten ?? 'n/a'}`
    );


    lines.push(
      `- Players: ${row.playerCount ?? 'n/a'}`
    );


    lines.push(
      `- Extraction duration: ${formatDuration(row.durationSeconds)}`
    );


    lines.push(
      ''
    );
  }


  lines.push(
    '## Structural checks'
  );


  lines.push(
    ''
  );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      summary.structuralChecks
    )
  ) {

    lines.push(
      `- ${value ? 'PASS' : 'FAIL'} — ${key}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Next stage'
  );


  lines.push(
    ''
  );


  lines.push(
    summary.nextStage.description
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}


// ============================================================
// HELPERS
// ============================================================

function firstFinite(
  values
) {

  for (
    const value
    of values
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

      continue;
    }


    const number =
      Number(
        value
      );


    if (
      Number.isFinite(
        number
      )
    ) {

      return number;
    }
  }


  return null;
}


function firstArray(
  values
) {

  for (
    const value
    of values
  ) {

    if (
      Array.isArray(
        value
      )
    ) {

      return value;
    }
  }


  return null;
}


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


function formatBytes(
  bytes
) {

  if (
    !Number.isFinite(
      bytes
    )
  ) {

    return 'n/a';
  }


  if (
    bytes >=
    1024 *
    1024 *
    1024
  ) {

    return `${formatNumber(
      bytes /
      (
        1024 *
        1024 *
        1024
      )
    )} GiB`;
  }


  if (
    bytes >=
    1024 *
    1024
  ) {

    return `${formatNumber(
      bytes /
      (
        1024 *
        1024
      )
    )} MiB`;
  }


  if (
    bytes >=
    1024
  ) {

    return `${formatNumber(
      bytes /
      1024
    )} KiB`;
  }


  return `${bytes} B`;
}


function formatDuration(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return 'n/a';
  }


  if (
    seconds <
    60
  ) {

    return `${formatNumber(seconds)} sec`;
  }


  const minutes =
    Math.floor(
      seconds /
      60
    );


  const remainingSeconds =
    seconds -
    minutes *
    60;


  return `${minutes}m ${formatNumber(remainingSeconds)}s`;
}