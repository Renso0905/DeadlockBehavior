import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';

import {
  basename,
  dirname,
  join,
  resolve
} from 'node:path';

import {
  execFileSync
} from 'node:child_process';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'MIDTOWN_RESOURCE_CONTEXT_RESOLUTION_V01';


// ============================================================
// PURPOSE
//
// Script120 V03 found two related tokens in test.dem:
//
//   RAW_ASCII    -> dl_midtown
//   DEMO_PACKET  -> dl_midtown_pulse
//
// Those should not automatically be treated as two independent
// gameplay maps.
//
// Script121 asks:
//
//   1. Which top-level map VPKs exist locally?
//   2. What top-level .vmap_c entries are actually inside
//      dl_midtown.vpk?
//   3. Does dl_midtown_pulse exist as its own VPK or top-level
//      compiled map?
//   4. What exact V03 evidence produced each token?
//   5. Do raw bytes from all six replays independently contain
//      the same dl_* map-family token?
//
// NO physics extraction.
// NO LOS classification.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const V03_PATH =
  resolve(
    'output',
    'test',
    'replay_map_identification_v03.json'
  );


const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'midtown_resource_context_resolution_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'midtown_resource_context_resolution_v01.md'
  );


// ============================================================
// ARGUMENTS
// ============================================================

const args =
  parseArgs(
    process.argv.slice(2)
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    V03_PATH,
    MANIFEST_PATH
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


const v03 =
  JSON.parse(
    readFileSync(
      V03_PATH,
      'utf8'
    )
  );


const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


// ============================================================
// LOCATE SOURCE 2 VIEWER
// ============================================================

const vrfCli =
  args.vrf
  ??
  findFirstFileNamed(
    resolve(
      'tools',
      'source2viewer'
    ),
    'Source2Viewer-CLI.exe'
  );


if (
  !vrfCli
  ||
  !existsSync(
    vrfCli
  )
) {

  throw new Error(
    'Source2Viewer-CLI.exe not found.'
  );
}


// ============================================================
// LOCATE DEADLOCK
// ============================================================

const deadlockRoot =
  args.deadlock
  ??
  findDeadlockRoot();


if (
  !deadlockRoot
) {

  throw new Error(
    'Deadlock installation not found.'
  );
}


const mapsDirectory =
  resolve(
    deadlockRoot,
    'game',
    'citadel',
    'maps'
  );


const midtownVpkPath =
  resolve(
    mapsDirectory,
    'dl_midtown.vpk'
  );


const pulseVpkPath =
  resolve(
    mapsDirectory,
    'dl_midtown_pulse.vpk'
  );


if (
  !existsSync(
    midtownVpkPath
  )
) {

  throw new Error(
    `dl_midtown.vpk not found:\n${midtownVpkPath}`
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
  'MIDTOWN RESOURCE-CONTEXT RESOLUTION V0.1'
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
  'Are dl_midtown and dl_midtown_pulse two gameplay maps,'
);

console.log(
  'or is _pulse an internal resource/context identifier?'
);

console.log('');

console.log(
  `Deadlock root: ${deadlockRoot}`
);

console.log(
  `Source2Viewer: ${vrfCli}`
);

console.log(
  'Raw .dem parsing: NO deadem parse; byte-token scan only'
);

console.log(
  'Physics extraction: NONE'
);

console.log(
  'LOS classification: NONE'
);

console.log('');


// ============================================================
// LOCAL TOP-LEVEL MAP VPK INVENTORY
// ============================================================

const localMapVpks =
  readdirSync(
    mapsDirectory,
    {
      withFileTypes:
        true
    }
  )
    .filter(
      entry =>
        entry.isFile()
        &&
        entry.name
          .toLowerCase()
          .endsWith(
            '.vpk'
          )
    )
    .map(
      entry =>
        entry.name
    )
    .sort();


// ============================================================
// LIST DL_MIDTOWN.VPK
// ============================================================

console.log(
  'Listing dl_midtown.vpk...'
);


const vpkList =
  safeExecCapture(
    vrfCli,
    [
      '-i',
      midtownVpkPath,
      '--vpk_list'
    ]
  );


if (
  !vpkList.ok
) {

  throw new Error(
    `Could not list dl_midtown.vpk:\n${vpkList.stderr}`
  );
}


const normalizedListing =
  String(
    vpkList.stdout
    ??
    ''
  )
    .replace(
      /\\/g,
      '/'
    );


const allListedPaths =
  extractVpkPaths(
    normalizedListing
  );


const topLevelVmaps =
  [
    ...new Set(
      allListedPaths.filter(
        path =>
          /^maps\/[^/]+\.vmap_c$/i.test(
            path
          )
      )
    )
  ].sort();


const midtownTopLevelVmap =
  topLevelVmaps.some(
    path =>
      path.toLowerCase() ===
      'maps/dl_midtown.vmap_c'
  );


const pulseTopLevelVmap =
  topLevelVmaps.some(
    path =>
      path.toLowerCase() ===
      'maps/dl_midtown_pulse.vmap_c'
  );


const pulseListingEntries =
  allListedPaths.filter(
    path =>
      /dl_midtown_pulse/i.test(
        path
      )
  );


const pulseAnyListingEntries =
  allListedPaths.filter(
    path =>
      /pulse/i.test(
        path
      )
  );


// ============================================================
// EXACT V03 EVIDENCE CONTEXT
// ============================================================

const v03Evidence =
  Array.isArray(
    v03?.evidence
  )
    ? v03.evidence
    : [];


const exactEvidence =
  {

    dl_midtown:
      collectEvidenceForToken(
        v03Evidence,
        'dl_midtown'
      ),

    dl_midtown_pulse:
      collectEvidenceForToken(
        v03Evidence,
        'dl_midtown_pulse'
      )
  };


// ============================================================
// CROSS-REPLAY RAW TOKEN REPLICATION
// ============================================================

const replicationNames =
  Array.isArray(
    manifest?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
        .map(
          row =>
            String(
              row.replayName
            )
        )
    : [];


const replayNames =
  [
    'test',
    ...replicationNames
  ];


const replayTokenResults =
  [];


console.log('');

console.log(
  'Scanning all six replay files for raw dl_* tokens...'
);

console.log('');


for (
  let index =
    0;

  index <
    replayNames.length;

  index++
) {

  const replayName =
    replayNames[index];


  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`
    );


  if (
    !existsSync(
      replayPath
    )
  ) {

    throw new Error(
      `Replay missing:\n${replayPath}`
    );
  }


  console.log(
    `[${index + 1}/${replayNames.length}] ${replayName}`
  );


  const scan =
    await scanDlTokens(
      replayPath
    );


  replayTokenResults.push(
    {

      replay:
        replayName,

      replayPath,

      tokenCounts:
        scan.tokenCounts,

      tokens:
        Object.keys(
          scan.tokenCounts
        ),

      dlMidtownObserved:
        Boolean(
          scan.tokenCounts.dl_midtown
        ),

      dlMidtownPulseObserved:
        Boolean(
          scan.tokenCounts.dl_midtown_pulse
        )
    }
  );


  console.log(
    `  ${JSON.stringify(
      scan.tokenCounts
    )}`
  );
}


// ============================================================
// PACKAGE / MAP CONTEXT INTERPRETATION
// ============================================================

const localMidtownVpkExists =
  existsSync(
    midtownVpkPath
  );


const localPulseVpkExists =
  existsSync(
    pulseVpkPath
  );


const allSixRawMidtown =
  replayTokenResults.every(
    row =>
      row.dlMidtownObserved
  );


const allSixRawPulse =
  replayTokenResults.every(
    row =>
      row.dlMidtownPulseObserved
  );


const packageEvidenceStrong =
  localMidtownVpkExists
  &&
  !localPulseVpkExists
  &&
  midtownTopLevelVmap
  &&
  !pulseTopLevelVmap;


let packageStatus;


if (
  packageEvidenceStrong
  &&
  allSixRawMidtown
) {

  packageStatus =
    'DL_MIDTOWN_TOP_LEVEL_MAP_PACKAGE_STRONGLY_SUPPORTED';

} else if (
  localMidtownVpkExists
  &&
  midtownTopLevelVmap
) {

  packageStatus =
    'DL_MIDTOWN_TOP_LEVEL_MAP_PACKAGE_SUPPORTED_REPLICATION_INCOMPLETE';

} else {

  packageStatus =
    'MIDTOWN_RESOURCE_CONTEXT_REQUIRES_DIAGNOSIS';
}


let pulseDisposition;


if (
  !localPulseVpkExists
  &&
  !pulseTopLevelVmap
) {

  pulseDisposition =
    'DL_MIDTOWN_PULSE_NOT_A_LOCAL_TOP_LEVEL_VPK_OR_TOP_LEVEL_VMAP_TREAT_AS_INTERNAL_RESOURCE_CONTEXT_UNTIL_PROVEN_OTHERWISE';

} else {

  pulseDisposition =
    'DL_MIDTOWN_PULSE_HAS_TOP_LEVEL_MAP_EVIDENCE_REQUIRES_SEPARATE_INSPECTION';
}


const status =
  packageStatus ===
  'DL_MIDTOWN_TOP_LEVEL_MAP_PACKAGE_STRONGLY_SUPPORTED'
    ? 'REPLAY_MAP_PACKAGE_IDENTITY_DL_MIDTOWN_STRONGLY_SUPPORTED'
    : 'REPLAY_MAP_PACKAGE_IDENTITY_REQUIRES_MORE_DIAGNOSIS';


const nextStage =
  status ===
  'REPLAY_MAP_PACKAGE_IDENTITY_DL_MIDTOWN_STRONGLY_SUPPORTED'
    ? 'EXTRACT_DL_MIDTOWN_WORLD_PHYSICS_WITH_MAP_PACKAGE_HASH_AND_VALIDATE_COLLISION_MESH'
    : 'INSPECT_MIDTOWN_PULSE_RESOURCE_CONTEXT';


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

    priorV03:
      {

        status:
          v03?.status
          ??
          null,

        resolvedMap:
          v03?.mapCandidates?.resolvedMap
          ??
          null,

        observedCandidates:
          v03?.mapCandidates?.dlCandidates
          ??
          []
      },

    localResources:
      {

        mapsDirectory,

        localMapVpks,

        midtownVpkPath,

        localMidtownVpkExists,

        pulseVpkPath,

        localPulseVpkExists
      },

    midtownVpkListing:
      {

        topLevelVmaps,

        midtownTopLevelVmap,

        pulseTopLevelVmap,

        pulseListingEntryCount:
          pulseListingEntries.length,

        pulseListingEntries:
          pulseListingEntries.slice(
            0,
            100
          ),

        anyPulseEntryCount:
          pulseAnyListingEntries.length,

        anyPulseEntries:
          pulseAnyListingEntries.slice(
            0,
            100
          )
      },

    v03ExactEvidence:
      exactEvidence,

    crossReplayRawTokens:
      {

        results:
          replayTokenResults,

        allSixRawMidtown,

        allSixRawPulse
      },

    interpretation:
      {

        packageStatus,

        pulseDisposition,

        keyDistinction:
          'A replay string token can name an internal resource, mode, or sub-context. Top-level VPK/.vmap identity is evaluated separately from arbitrary dl_* strings.',

        guardrail:
          'This script resolves map-package context only. It does not yet validate that any physics mesh blocks soul projectiles exactly as the live game does.'
      },

    nextStage,

    outputs:
      {

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
  'MIDTOWN RESOURCE-CONTEXT SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'LOCAL MAP PACKAGES'
);

console.log(
  '------------------'
);

console.log(
  `dl_midtown.vpk exists:       ${localMidtownVpkExists}`
);

console.log(
  `dl_midtown_pulse.vpk exists: ${localPulseVpkExists}`
);

console.log('');

console.log(
  'DL_MIDTOWN.VPK TOP-LEVEL MAPS'
);

console.log(
  '-----------------------------'
);


for (
  const path
  of topLevelVmaps
) {

  console.log(
    `  ${path}`
  );
}


console.log('');

console.log(
  `dl_midtown.vmap_c present:       ${midtownTopLevelVmap}`
);

console.log(
  `dl_midtown_pulse.vmap_c present: ${pulseTopLevelVmap}`
);

console.log(
  `listing entries containing dl_midtown_pulse: ${pulseListingEntries.length}`
);

console.log('');

console.log(
  'V03 EXACT EVIDENCE'
);

console.log(
  '------------------'
);


printEvidenceGroup(
  'dl_midtown',
  exactEvidence.dl_midtown
);


printEvidenceGroup(
  'dl_midtown_pulse',
  exactEvidence.dl_midtown_pulse
);


console.log('');

console.log(
  'CROSS-REPLAY RAW TOKEN REPLICATION'
);

console.log(
  '----------------------------------'
);

console.log(
  `all six contain raw dl_midtown:       ${allSixRawMidtown}`
);

console.log(
  `all six contain raw dl_midtown_pulse: ${allSixRawPulse}`
);

console.log('');

console.log(
  'INTERPRETATION'
);

console.log(
  '--------------'
);

console.log(
  `Package: ${packageStatus}`
);

console.log(
  `Pulse:   ${pulseDisposition}`
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
  nextStage
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
// V03 EVIDENCE
// ============================================================

function collectEvidenceForToken(
  rows,
  token
) {

  const matches =
    rows.filter(
      row =>
        Array.isArray(
          row?.mapTokens
        )
        &&
        row.mapTokens.includes(
          token
        )
    );


  const unique =
    new Map();


  for (
    const row
    of matches
  ) {

    const compact =
      {

        sourceLayer:
          row.sourceLayer
          ??
          null,

        sourceType:
          row.sourceType
          ??
          null,

        tick:
          row.tick
          ??
          null,

        path:
          row.path
          ??
          null,

        value:
          row.value
          ??
          null,

        resourcePaths:
          row.resourcePaths
          ??
          []
      };


    const key =
      JSON.stringify(
        compact
      );


    if (
      !unique.has(
        key
      )
    ) {

      unique.set(
        key,
        compact
      );
    }
  }


  return {

    observations:
      matches.length,

    uniqueContexts:
      unique.size,

    samples:
      [
        ...unique.values()
      ].slice(
        0,
        50
      )
  };
}


function printEvidenceGroup(
  token,
  group
) {

  console.log('');

  console.log(
    `${token}: observations=${group.observations}, uniqueContexts=${group.uniqueContexts}`
  );


  for (
    const row
    of group.samples.slice(
      0,
      10
    )
  ) {

    console.log(
      `  [${row.sourceLayer}/${row.sourceType}] ` +
      `${row.path ?? '(no path)'} => ${truncateText(
        row.value,
        240
      )}`
    );
  }
}


// ============================================================
// RAW REPLAY TOKEN SCAN
// ============================================================

async function scanDlTokens(
  path
) {

  const counts =
    new Map();


  const seenOccurrences =
    new Set();


  const stream =
    createReadStream(
      path,
      {
        highWaterMark:
          4 *
          1024 *
          1024
      }
    );


  let byteOffset =
    0;


  let carry =
    '';


  const overlap =
    128;


  for await (
    const chunk
    of stream
  ) {

    const text =
      chunk.toString(
        'latin1'
      );


    const combined =
      carry +
      text;


    const combinedStart =
      byteOffset -
      carry.length;


    for (
      const match
      of combined.matchAll(
        /\bdl_[a-z0-9_]+\b/gi
      )
    ) {

      const token =
        String(
          match[0]
        ).toLowerCase();


      const absolutePosition =
        combinedStart +
        match.index;


      const occurrenceKey =
        `${token}|${absolutePosition}`;


      if (
        seenOccurrences.has(
          occurrenceKey
        )
      ) {

        continue;
      }


      seenOccurrences.add(
        occurrenceKey
      );


      increment(
        counts,
        token
      );
    }


    byteOffset +=
      chunk.length;


    carry =
      combined.slice(
        -overlap
      );
  }


  return {

    tokenCounts:
      mapToSortedObject(
        counts
      )
  };
}


// ============================================================
// VPK LIST PARSING
// ============================================================

function extractVpkPaths(
  text
) {

  const normalized =
    String(
      text
      ??
      ''
    )
      .replace(
        /\\/g,
        '/'
      );


  const output =
    new Set();


  const regex =
    /(?:^|\s)((?:maps|models|materials|particles|scripts|soundevents|sounds)\/[A-Za-z0-9_./-]+)/gm;


  for (
    const match
    of normalized.matchAll(
      regex
    )
  ) {

    let path =
      match[1];


    path =
      path.replace(
        /[),;\]}]+$/g,
        ''
      );


    output.add(
      path
    );
  }


  for (
    const line
    of normalized.split(
      /\r?\n/
    )
  ) {

    const trimmed =
      line.trim();


    if (
      /^(?:maps|models|materials|particles|scripts|soundevents|sounds)\//i.test(
        trimmed
      )
    ) {

      output.add(
        trimmed.split(
          /\s+/
        )[0]
      );
    }
  }


  return [
    ...output
  ];
}


// ============================================================
// PROCESS EXECUTION
// ============================================================

function safeExecCapture(
  executable,
  argv
) {

  try {

    const stdout =
      execFileSync(
        executable,
        argv,
        {
          encoding:
            'utf8',

          windowsHide:
            true,

          maxBuffer:
            256 *
            1024 *
            1024,

          stdio:
            [
              'ignore',
              'pipe',
              'pipe'
            ]
        }
      );


    return {

      ok:
        true,

      stdout:
        stdout
        ??
        '',

      stderr:
        ''
    };

  } catch (
    error
  ) {

    return {

      ok:
        false,

      stdout:
        bufferToText(
          error?.stdout
        ),

      stderr:
        bufferToText(
          error?.stderr
        )
        ||
        String(
          error?.message
          ??
          error
        )
    };
  }
}


function bufferToText(
  value
) {

  if (
    value ===
    null
    ||
    value ===
    undefined
  ) {

    return '';
  }


  if (
    Buffer.isBuffer(
      value
    )
  ) {

    return value.toString(
      'utf8'
    );
  }


  return String(
    value
  );
}


// ============================================================
// ARGUMENTS / FILE DISCOVERY
// ============================================================

function parseArgs(
  argv
) {

  const output =
    {

      deadlock:
        null,

      vrf:
        null
    };


  for (
    let index =
      0;

    index <
      argv.length;

    index++
  ) {

    if (
      argv[index] ===
      '--deadlock'
      &&
      argv[index + 1]
    ) {

      output.deadlock =
        resolve(
          argv[++index]
        );

      continue;
    }


    if (
      argv[index] ===
      '--vrf'
      &&
      argv[index + 1]
    ) {

      output.vrf =
        resolve(
          argv[++index]
        );
    }
  }


  return output;
}


function findDeadlockRoot() {

  const candidates =
    [];


  for (
    const letter
    of 'CDEFGHIJKLMNOPQRSTUVWXYZ'
  ) {

    candidates.push(
      `${letter}:\\SteamLibrary\\steamapps\\common\\Deadlock`
    );
  }


  if (
    process.env['PROGRAMFILES(X86)']
  ) {

    candidates.push(
      join(
        process.env['PROGRAMFILES(X86)'],
        'Steam',
        'steamapps',
        'common',
        'Deadlock'
      )
    );
  }


  for (
    const candidate
    of candidates
  ) {

    if (
      existsSync(
        resolve(
          candidate,
          'game',
          'citadel',
          'gameinfo.gi'
        )
      )
    ) {

      return candidate;
    }
  }


  return null;
}


function findFirstFileNamed(
  root,
  fileName
) {

  if (
    !root
    ||
    !existsSync(
      root
    )
  ) {

    return null;
  }


  const stack =
    [
      root
    ];


  while (
    stack.length >
    0
  ) {

    const current =
      stack.pop();


    let entries;


    try {

      entries =
        readdirSync(
          current,
          {
            withFileTypes:
              true
          }
        );

    } catch {

      continue;
    }


    for (
      const entry
      of entries
    ) {

      const fullPath =
        join(
          current,
          entry.name
        );


      if (
        entry.isFile()
        &&
        basename(
          fullPath
        ).toLowerCase() ===
        fileName.toLowerCase()
      ) {

        return fullPath;
      }


      if (
        entry.isDirectory()
      ) {

        stack.push(
          fullPath
        );
      }
    }
  }


  return null;
}


// ============================================================
// COLLECTION / TEXT
// ============================================================

function increment(
  map,
  key
) {

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


function mapToSortedObject(
  map
) {

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


function truncateText(
  value,
  maxLength
) {

  const text =
    String(
      value
      ??
      ''
    );


  return text.length <=
    maxLength
      ? text
      : `${text.slice(
          0,
          maxLength
        )}...[truncated]`;
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
    '# Midtown Resource-Context Resolution'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Question'
  );


  lines.push('');


  lines.push(
    'Determine whether `dl_midtown_pulse` is a separate gameplay-map package or an internal resource/context identifier associated with `dl_midtown`.'
  );


  lines.push('');


  lines.push(
    '## Local package evidence'
  );


  lines.push('');


  lines.push(
    `- dl_midtown.vpk exists: ${summary.localResources.localMidtownVpkExists}`
  );


  lines.push(
    `- dl_midtown_pulse.vpk exists: ${summary.localResources.localPulseVpkExists}`
  );


  lines.push(
    `- maps/dl_midtown.vmap_c in dl_midtown.vpk: ${summary.midtownVpkListing.midtownTopLevelVmap}`
  );


  lines.push(
    `- maps/dl_midtown_pulse.vmap_c in dl_midtown.vpk: ${summary.midtownVpkListing.pulseTopLevelVmap}`
  );


  lines.push('');


  lines.push(
    '## Cross-replay raw resource token replication'
  );


  lines.push('');


  for (
    const replay
    of summary.crossReplayRawTokens.results
  ) {

    lines.push(
      `- **${replay.replay}:** ${JSON.stringify(
        replay.tokenCounts
      )}`
    );
  }


  lines.push('');


  lines.push(
    '## Interpretation'
  );


  lines.push('');


  lines.push(
    `- Package: ${summary.interpretation.packageStatus}`
  );


  lines.push(
    `- Pulse token: ${summary.interpretation.pulseDisposition}`
  );


  lines.push('');


  lines.push(
    'No physics mesh or LOS classification is accepted by this script.'
  );


  lines.push('');


  lines.push(
    '## Next stage'
  );


  lines.push('');


  lines.push(
    summary.nextStage
  );


  lines.push('');


  return lines.join(
    '\n'
  );
}