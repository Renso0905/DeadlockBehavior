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
    'player_state_base_batch_v02.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_state_base_batch_v02.md'
  );


// ============================================================
// V01 CORRECTION
//
// Script 03 writes:
//
//   playersSeen: [...playerNamesSeen]
//
// Script101 V01 mistakenly searched for:
//
//   playerNamesSeen
//   players
//   playerNames
//
// Therefore all five successful extractions were incorrectly
// reported with:
//
//   players: n/a
//
// and:
//
//   All have players: false
//
// V02 adds the authoritative Script03 field:
//
//   playersSeen
//
// No replay re-extraction is required.
// ============================================================


// ============================================================
// REQUIRED SCRIPT03 OUTPUTS
// ============================================================

const REQUIRED_OUTPUTS = [

  'player_state.jsonl',

  'player_state_summary.json'
];


// ============================================================
// INPUT CHECKS
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
    `Missing Script 03 extractor:\n${PLAYER_STATE_SCRIPT}`
  );
}


// ============================================================
// LOAD SCRIPT100 MANIFEST
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
    'Script100 manifest is not ready for replication.'
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
    'No independent replication replays are present in the Script100 manifest.'
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
  'CROSS-REPLAY PLAYER-STATE BASE EXTRACTION V0.2'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'V01 CORRECTION'
);

console.log(
  '--------------'
);


console.log(
  'Script101 V01 searched the wrong Script03 player-list key.'
);


console.log(
  'Authoritative Script03 field: playersSeen'
);


console.log(
  'Existing successful replay extractions will be reused.'
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
// BATCH
// ============================================================

const results =
  [];


const batchStartedAt =
  new Date();


const batchStartedMs =
  Date.now();


// ============================================================
// REPLAY LOOP
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
  // REPLAY EXISTS
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
        false,

      inspection:
        null
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
  // EXISTING OUTPUTS
  // ----------------------------------------------------------

  const existingInspection =
    inspectOutputs(
      replayName,
      statePath,
      summaryPath
    );


  if (
    existingInspection.valid
    &&
    !FORCE
  ) {

    console.log(
      'Existing valid Script03 extraction found.'
    );


    console.log(
      'Skipping replay parse.'
    );


    printInspection(
      existingInspection
    );


    results.push({

      replayName,

      replayPath,

      replaySizeBytes:
        replayStats.size,

      status:
        'SKIPPED_EXISTING_VALID',

      attempted:
        false,

      skipped:
        true,

      success:
        true,

      durationSeconds:
        0,

      inspection:
        existingInspection
    });


    continue;
  }


  // ----------------------------------------------------------
  // PARSE ONLY WHEN NECESSARY
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
    `Starting extraction: ${startedAt.toISOString()}`
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

      durationSeconds,

      inspection:
        null
    });


    continue;
  }


  if (
    child.status !==
    0
  ) {

    console.log('');

    console.log(
      `FAIL: Script03 exited with code ${child.status}`
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

      durationSeconds,

      inspection:
        null
    });


    continue;
  }


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


  results.push({

    replayName,

    replayPath,

    replaySizeBytes:
      replayStats.size,

    status:
      inspection.valid
        ? 'EXTRACTION_PASS'
        : 'OUTPUT_VALIDATION_FAILURE',

    attempted:
      true,

    skipped:
      false,

    success:
      inspection.valid,

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
// STRUCTURAL CHECKS
// ============================================================

const allHavePlayers =
  results.length ===
    cohort.length
  &&
  results.every(
    row =>
      (
        row
          ?.inspection
          ?.playerCount ??
        0
      ) >
      0
  );


const allHaveExpectedPlayerCount =
  results.length ===
    cohort.length
  &&
  results.every(
    row =>
      row
        ?.inspection
        ?.playerCount ===
      12
  );


const allHaveRecords =
  results.length ===
    cohort.length
  &&
  results.every(
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
  results.length ===
    cohort.length
  &&
  results.every(
    row =>
      row
        ?.inspection
        ?.hasMatchClock ===
      true
  );


const allHaveStateFiles =
  results.length ===
    cohort.length
  &&
  results.every(
    row =>
      (
        row
          ?.inspection
          ?.stateFileBytes ??
        0
      ) >
      0
  );


const allReplayNamesAgree =
  results.length ===
    cohort.length
  &&
  results.every(
    row =>
      row
        ?.inspection
        ?.summaryReplayName ===
      row.replayName
  );


// ------------------------------------------------------------
// Do NOT require exactly 12 names to proceed.
//
// The normal expectation is 12 players, and we report that
// separately. But the actual substrate requirement is:
//
//   >0 identified players
//
// because unusual replay metadata should not automatically make
// the extraction unusable.
//
// If any replay is not 12, we will inspect it before treating it
// as a standard match.
// ------------------------------------------------------------

const baseExtractionReady =
  allReady
  &&
  allHavePlayers
  &&
  allHaveRecords
  &&
  allHaveMatchClock
  &&
  allHaveStateFiles
  &&
  allReplayNamesAgree;


// ============================================================
// REPLAY INVENTORY
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

      attempted:
        row.attempted,

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

      playerNames:
        row
          ?.inspection
          ?.playerNames ??
        null,

      heroIdsSeen:
        row
          ?.inspection
          ?.heroIdsSeen ??
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
        null,

      matchClockOffset:
        row
          ?.inspection
          ?.matchClockOffset ??
        null
    })
  );


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    'CROSS_REPLAY_PLAYER_STATE_BASE_BATCH_V02',

  supersedes:
    'CROSS_REPLAY_PLAYER_STATE_BASE_BATCH_V01',

  canonical:
    false,

  createdAt:
    batchFinishedAt.toISOString(),


  v01Correction: {

    issue:
      'V01 did not recognize Script03 player_state_summary.json field playersSeen.',

    consequence:
      'All five successful extractions were reported with playerCount=null, causing allHavePlayers=false and baseExtractionReady=false.',

    correction:
      'V02 recognizes playersSeen and reuses existing valid outputs without reparsing the replay.',

    replayDataAffected:
      false,

    reExtractionRequired:
      false
  },


  purpose: [

    'Validate the common Script03 player-state substrate for every independent replication replay.',

    'Reuse existing successful player-state extractions whenever possible.',

    'Correct Script101 V01 player-count inspection without altering replay telemetry.',

    'Provide player identity, team, position, net worth, currency, body orientation, eye orientation, camera orientation, and match-clock substrate for compact cross-replay replication.'
  ],


  sourceManifest: {

    path:
      MANIFEST_PATH,

    version:
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
      REQUIRED_OUTPUTS,

    authoritativeSummaryPlayerField:
      'playersSeen'
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

    results:
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

    allHaveExpectedPlayerCount,

    allHaveRecords,

    allHaveMatchClock,

    allHaveStateFiles,

    allReplayNamesAgree,

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
      'Parse each independent replay for the minimum event-centered Trooper, AssignedGold, lifecycle, economy, recipient-geometry, and shot telemetry required by the frozen Script99 replication contract.'
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
// CONSOLE SUMMARY
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'CROSS-REPLAY PLAYER-STATE BASE SUMMARY V0.2'
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
    row.replayName
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
    `  clock offset:  ${formatNumber(row.matchClockOffset)} sec`
  );


  console.log(
    `  duration:      ${formatDuration(row.durationSeconds)}`
  );
}


// ============================================================
// PLAYER COUNTS
// ============================================================

console.log('');

console.log(
  'PLAYER IDENTITY COVERAGE'
);

console.log(
  '------------------------'
);


for (
  const row
  of replayInventory
) {

  console.log(
    `${row.replayName.padEnd(12)} players=${String(row.playerCount ?? 'n/a').padStart(3)}  names=${formatNameList(row.playerNames)}`
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
  `All have exactly 12 players:   ${allHaveExpectedPlayerCount}`
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


console.log(
  `All replay names agree:        ${allReplayNamesAgree}`
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
    'One or more structural substrate checks require diagnosis.'
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


  // ----------------------------------------------------------
  // AUTHORITATIVE SCRIPT03 FIELDS FIRST
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // V02 FIX:
  //
  // Script03 writes playersSeen.
  // ----------------------------------------------------------

  const playerNames =
    firstArray([

      parsedSummary
        ?.playersSeen,

      parsedSummary
        ?.playerNamesSeen,

      parsedSummary
        ?.players,

      parsedSummary
        ?.playerNames
    ]);


  const explicitPlayerCount =
    firstFinite([

      parsedSummary
        ?.playerCount,

      parsedSummary
        ?.counts
        ?.players,

      parsedSummary
        ?.playersCount
    ]);


  const playerCount =
    Number.isFinite(
      explicitPlayerCount
    )
      ? explicitPlayerCount
      : Array.isArray(
          playerNames
        )
        ? playerNames.length
        : null;


  const heroIdsSeen =
    firstArray([

      parsedSummary
        ?.heroIdsSeen,

      parsedSummary
        ?.heroesSeen,

      parsedSummary
        ?.heroIds
    ]);


  const firstMatchTime =
    firstFinite([

      parsedSummary
        ?.firstMatchTimeSeconds,

      parsedSummary
        ?.firstMatchTime,

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
        ?.finalMatchTimeSeconds,

      parsedSummary
        ?.finalMatchTime,

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


  const summaryReplayName =
    parsedSummary
      ?.replay ??
    null;


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
    null
    &&
    Number.isFinite(
      recordsWritten
    )
    &&
    recordsWritten >
    0
    &&
    Array.isArray(
      playerNames
    )
    &&
    playerNames.length >
    0;


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

    heroIdsSeen,

    firstMatchTime,

    finalMatchTime,

    matchClockOffset,

    hasMatchClock,

    summaryReplayName,

    parsedSummary
  };
}


// ============================================================
// INSPECTION CONSOLE
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
    '# Cross-Replay Player-State Base Extraction V0.2'
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
    '## V01 correction'
  );


  lines.push(
    ''
  );


  lines.push(
    'Script101 V01 failed to recognize the authoritative Script03 `playersSeen` summary field. Replay telemetry itself was unaffected and no re-extraction was required.'
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
      `- Records: ${row.recordsWritten ?? 'n/a'}`
    );


    lines.push(
      `- Players: ${row.playerCount ?? 'n/a'}`
    );


    lines.push(
      `- State size: ${formatNumber(row.stateFileMiB)} MiB`
    );


    lines.push(
      `- Match time: ${formatNumber(row.firstMatchTime)} -> ${formatNumber(row.finalMatchTime)} sec`
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


function formatNameList(
  names
) {

  if (
    !Array.isArray(
      names
    )
  ) {

    return 'n/a';
  }


  return `[${names.join(', ')}]`;
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


  const remainder =
    seconds -
    minutes *
    60;


  return `${minutes}m ${formatNumber(remainder)}s`;
}