import {
  createReadStream,
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
  Parser,
  InterceptorStage
} from 'deadem';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'REPLAY_MAP_IDENTIFICATION_V03';


// ============================================================
// PURPOSE
//
// V01:
//   CNETMsg_SignonState.mapName was empty.
//
// V02:
//   CDemoFileHeader.mapName existed, but all six replays said:
//
//       start
//
// "start" is therefore treated here as a GENERIC / NON-GAMEPLAY
// map marker, not authoritative gameplay-map identity.
//
// V03 searches the frozen discovery replay for map/resource
// evidence in:
//
//   A. decoded DEMO_PACKET payload strings
//   B. decoded MESSAGE_PACKET payload strings
//   C. raw replay ASCII strings
//
// We specifically look for:
//
//   dl_*
//   maps/dl_*/
//   world.vwrld
//   world_physics
//   .vmap / .vmap_c
//
// This is DISCOVERY ONLY.
//
// No map physics is extracted.
// No LOS is classified.
// No Script117 opportunity status changes.
//
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2]
  ??
  'test';


const MAX_RECORDED_EVIDENCE =
  500;


const MAX_STRING_DEPTH =
  12;


const RAW_ASCII_MIN_LENGTH =
  5;


const GENERIC_HEADER_MAP_NAMES =
  new Set(
    [
      'start',
      'background',
      'mainmenu',
      'menu',
      'loading',
      'unknown'
    ]
  );


// ============================================================
// PATHS
// ============================================================

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


const outputJsonPath =
  resolve(
    outputDirectory,
    'replay_map_identification_v03.json'
  );


const outputMarkdownPath =
  resolve(
    outputDirectory,
    'replay_map_identification_v03.md'
  );


// ============================================================
// INPUT
// ============================================================

if (
  !existsSync(
    replayPath
  )
) {

  throw new Error(
    `Replay not found:\n${replayPath}`
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
  'REPLAY MAP IDENTIFICATION V0.3'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Replay:                    ${replayName}`
);

console.log(
  'V02 "start" treatment:     GENERIC / NON-AUTHORITATIVE'
);

console.log(
  'Physics extraction:        NONE'
);

console.log(
  'LOS classification:        NONE'
);

console.log('');


// ============================================================
// STORAGE
// ============================================================

const demoPacketTypeCounts =
  new Map();


const messageTypeCounts =
  new Map();


const mapTokenCounts =
  new Map();


const resourcePathCounts =
  new Map();


const evidenceRows =
  [];


let decodedStringsExamined =
  0;


let decodedRelevantStrings =
  0;


let fileHeaderMapName =
  null;


let fileHeaderBuildNum =
  null;


let fileHeaderPatchVersion =
  null;


let fileHeaderGameDirectory =
  null;


// ============================================================
// PARSER
// ============================================================

const parser =
  new Parser();


// ------------------------------------------------------------
// DEMO_PACKET
// ------------------------------------------------------------

parser.registerPostInterceptor(

  InterceptorStage.DEMO_PACKET,

  (
    demoPacket
  ) => {

    const typeText =
      decodeTypeText(
        demoPacket?.type
      )
      ??
      'UNKNOWN';


    increment(
      demoPacketTypeCounts,
      typeText
    );


    const data =
      demoPacket?.data
      ??
      null;


    // --------------------------------------------------------
    // Preserve V02 header information, but explicitly reject
    // generic "start" as gameplay-map authority.
    // --------------------------------------------------------

    if (
      normalizeDemoType(
        typeText
      ) ===
      'DEM_FILE_HEADER'
    ) {

      fileHeaderMapName =
        firstNonEmptyString(
          [
            data?.mapName,
            data?.map_name
          ]
        );


      fileHeaderBuildNum =
        firstFinite(
          [
            data?.buildNum,
            data?.build_num
          ]
        );


      fileHeaderPatchVersion =
        firstFinite(
          [
            data?.patchVersion,
            data?.patch_version
          ]
        );


      fileHeaderGameDirectory =
        firstNonEmptyString(
          [
            data?.gameDirectory,
            data?.game_directory
          ]
        );
    }


    inspectDecodedObjectStrings({

      root:
        data,

      sourceLayer:
        'DEMO_PACKET',

      sourceType:
        typeText,

      tick:
        finite(
          demoPacket?.tick
        ),

      sequence:
        finite(
          demoPacket?.sequence
        )
    });
  }
);


// ------------------------------------------------------------
// MESSAGE_PACKET
// ------------------------------------------------------------

parser.registerPostInterceptor(

  InterceptorStage.MESSAGE_PACKET,

  (
    demoPacket,
    messagePacket
  ) => {

    const typeText =
      decodeTypeText(
        messagePacket?.type
      )
      ??
      'UNKNOWN';


    increment(
      messageTypeCounts,
      typeText
    );


    const data =
      getMessageData(
        messagePacket
      );


    inspectDecodedObjectStrings({

      root:
        data,

      sourceLayer:
        'MESSAGE_PACKET',

      sourceType:
        typeText,

      tick:
        finite(
          demoPacket?.tick
        ),

      sequence:
        finite(
          demoPacket?.sequence
        )
    });
  }
);


// ============================================================
// PARSE
// ============================================================

console.log(
  'Parsing decoded replay strings for map/resource evidence...'
);


console.log(
  `[${new Date().toISOString()}] Parse started`
);


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// RAW ASCII SCAN
// ============================================================

console.log('');

console.log(
  'Scanning raw replay bytes for printable map/resource strings...'
);


const rawScan =
  await scanRawAsciiStrings(
    replayPath
  );


for (
  const row
  of rawScan.evidence
) {

  recordEvidence({

    sourceLayer:
      'RAW_ASCII',

    sourceType:
      'RAW_REPLAY_BYTES',

    tick:
      null,

    sequence:
      null,

    path:
      null,

    value:
      row.value
  });
}


// ============================================================
// RESOLVE MAP CANDIDATES
// ============================================================

const rankedMapCandidates =
  [
    ...mapTokenCounts.entries()
  ]
    .map(
      ([
        mapName,
        count
      ]) =>
        ({
          mapName,

          count,

          localMapStyle:
            /^dl_[a-z0-9_]+$/i.test(
              mapName
            ),

          generic:
            GENERIC_HEADER_MAP_NAMES.has(
              mapName.toLowerCase()
            )
        })
    )
    .filter(
      row =>
        !row.generic
    )
    .sort(
      (
        a,
        b
      ) =>
        b.count -
        a.count
        ||
        a.mapName.localeCompare(
          b.mapName
        )
    );


const dlCandidates =
  rankedMapCandidates.filter(
    row =>
      /^dl_[a-z0-9_]+$/i.test(
        row.mapName
      )
  );


let resolvedMap =
  null;


let resolutionStatus =
  'MAP_UNRESOLVED';


if (
  dlCandidates.length ===
  1
) {

  resolvedMap =
    dlCandidates[0].mapName;


  resolutionStatus =
    'UNIQUE_DL_MAP_RESOURCE_CANDIDATE';

} else if (
  dlCandidates.length >
  1
) {

  const first =
    dlCandidates[0];


  const second =
    dlCandidates[1];


  if (
    first.count >=
    second.count *
    5
  ) {

    resolvedMap =
      first.mapName;


    resolutionStatus =
      'DOMINANT_DL_MAP_RESOURCE_CANDIDATE';

  } else {

    resolutionStatus =
      'MULTIPLE_DL_MAP_RESOURCE_CANDIDATES_REQUIRE_CONTEXT';
  }
}


// ============================================================
// SOURCE SUPPORT PER CANDIDATE
// ============================================================

const candidateSupport =
  dlCandidates.map(
    candidate => {

      const supportingRows =
        evidenceRows.filter(
          row =>
            row.mapTokens.includes(
              candidate.mapName
            )
        );


      const sourceLayers =
        [
          ...new Set(
            supportingRows.map(
              row =>
                row.sourceLayer
            )
          )
        ];


      const sourceTypes =
        [
          ...new Set(
            supportingRows.map(
              row =>
                row.sourceType
            )
          )
        ]
          .slice(
            0,
            50
          );


      const sampleEvidence =
        supportingRows
          .slice(
            0,
            25
          );


      return {
        mapName:
          candidate.mapName,

        count:
          candidate.count,

        sourceLayers,

        sourceTypes,

        sampleEvidence
      };
    }
  );


// ============================================================
// HEADER DISPOSITION
// ============================================================

const normalizedHeaderMap =
  normalizeMapToken(
    fileHeaderMapName
  );


const headerMapGeneric =
  normalizedHeaderMap
    ? GENERIC_HEADER_MAP_NAMES.has(
        normalizedHeaderMap
      )
    : false;


const headerDisposition =
  headerMapGeneric
    ? 'HEADER_MAP_NAME_GENERIC_NOT_GAMEPLAY_AUTHORITY'
    : normalizedHeaderMap
      ? 'HEADER_MAP_NAME_NON_GENERIC_REQUIRES_COMPARISON'
      : 'HEADER_MAP_NAME_EMPTY';


// ============================================================
// STATUS
// ============================================================

let status;


if (
  resolvedMap
) {

  const support =
    candidateSupport.find(
      row =>
        row.mapName ===
        resolvedMap
    );


  const independentLayers =
    support?.sourceLayers?.length
    ??
    0;


  if (
    independentLayers >=
    2
  ) {

    status =
      'REPLAY_GAMEPLAY_MAP_RESOURCE_IDENTITY_STRONGLY_SUPPORTED';

  } else {

    status =
      'REPLAY_GAMEPLAY_MAP_RESOURCE_IDENTITY_PROVISIONAL';
  }

} else {

  status =
    'REPLAY_GAMEPLAY_MAP_RESOURCE_IDENTITY_UNRESOLVED';
}


// ============================================================
// NEXT STAGE
// ============================================================

const nextStage =
  status ===
  'REPLAY_GAMEPLAY_MAP_RESOURCE_IDENTITY_STRONGLY_SUPPORTED'
    ? 'REPLICATE_MAP_RESOURCE_IDENTITY_ACROSS_REP01_TO_REP05'
    : status ===
      'REPLAY_GAMEPLAY_MAP_RESOURCE_IDENTITY_PROVISIONAL'
      ? 'REPLICATE_PROVISIONAL_MAP_IDENTITY_OR_INSPECT_RESOURCE_CONTEXT'
      : 'INSPECT_STRING_TABLE_AND_RESOURCE_EVIDENCE_DIAGNOSTIC';


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

    replay:
      replayName,

    status,


    priorV02Correction:
      {
        fileHeaderMapName,

        normalizedHeaderMap,

        headerMapGeneric,

        disposition:
          headerDisposition,

        interpretation:
          'The literal header value "start" is treated as a bootstrap/generic marker and not as the gameplay map.'
      },


    build:
      {
        buildNum:
          fileHeaderBuildNum,

        patchVersion:
          fileHeaderPatchVersion,

        gameDirectory:
          fileHeaderGameDirectory
      },


    decodedInspection:
      {
        stringsExamined:
          decodedStringsExamined,

        relevantStrings:
          decodedRelevantStrings,

        demoPacketTypeCounts:
          mapToSortedObject(
            demoPacketTypeCounts
          ),

        messageTypeCounts:
          mapToSortedObject(
            messageTypeCounts
          )
      },


    rawAsciiInspection:
      rawScan,


    mapCandidates:
      {
        ranked:
          rankedMapCandidates,

        dlCandidates,

        support:
          candidateSupport,

        resolvedMap,

        resolutionStatus
      },


    resourcePaths:
      mapToSortedObject(
        resourcePathCounts
      ),


    evidence:
      evidenceRows,


    interpretation:
      {
        strongestMapCandidate:
          resolvedMap,

        guardrail:
          'A dl_* token is not accepted merely because it exists somewhere in the replay. Resolution requires uniqueness/dominance and preferably support from multiple source layers.',

        script119:
          resolvedMap ===
          'dl_streets'
            ? 'The prior Script119 dl_streets extraction may correspond to the replay map, but still requires replication and collision validation.'
            : resolvedMap
              ? `The prior Script119 dl_streets extraction does not match the current strongest replay-resource candidate ${resolvedMap}.`
              : 'The Script119 map association remains unresolved.',

        los:
          'No line-of-sight classifications are produced.'
      },


    nextStage,


    outputs:
      {
        json:
          outputJsonPath,

        markdown:
          outputMarkdownPath
      }
  };


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
  buildMarkdown(
    summary
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
  'REPLAY MAP RESOURCE-EVIDENCE SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'HEADER'
);

console.log(
  '------'
);


console.log(
  `mapName:                    ${fileHeaderMapName ?? 'EMPTY'}`
);


console.log(
  `generic/non-authoritative:  ${headerMapGeneric}`
);


console.log(
  `buildNum:                   ${fileHeaderBuildNum ?? 'n/a'}`
);


console.log(
  `patchVersion:               ${fileHeaderPatchVersion ?? 'n/a'}`
);


console.log('');

console.log(
  'STRING INSPECTION'
);

console.log(
  '-----------------'
);


console.log(
  `Decoded strings examined:   ${decodedStringsExamined}`
);


console.log(
  `Decoded relevant strings:   ${decodedRelevantStrings}`
);


console.log(
  `Raw ASCII strings examined: ${rawScan.asciiStringsExamined}`
);


console.log(
  `Raw relevant strings:       ${rawScan.relevantStrings}`
);


console.log('');

console.log(
  'DL_* MAP CANDIDATES'
);

console.log(
  '-------------------'
);


if (
  dlCandidates.length ===
  0
) {

  console.log(
    'NONE'
  );

} else {

  for (
    const candidate
    of candidateSupport
  ) {

    console.log(
      `${candidate.mapName.padEnd(28)} ` +
      `count=${String(candidate.count).padEnd(7)} ` +
      `layers=${candidate.sourceLayers.join(',')}`
    );
  }
}


console.log('');

console.log(
  'RESOURCE PATH SAMPLES'
);

console.log(
  '---------------------'
);


for (
  const [
    path,
    count
  ]
  of [
    ...resourcePathCounts.entries()
  ]
    .sort(
      (
        a,
        b
      ) =>
        b[1] -
        a[1]
    )
    .slice(
      0,
      30
    )
) {

  console.log(
    `${String(count).padStart(5)}  ${path}`
  );
}


console.log('');

console.log(
  'MAP RESOLUTION'
);

console.log(
  '--------------'
);


console.log(
  `Resolved map:               ${resolvedMap ?? 'UNRESOLVED'}`
);


console.log(
  `Resolution status:          ${resolutionStatus}`
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
  `JSON:\n${outputJsonPath}`
);


console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);


console.log('');


// ============================================================
// DECODED STRING INSPECTION
// ============================================================

function inspectDecodedObjectStrings({

  root,

  sourceLayer,

  sourceType,

  tick,

  sequence
}) {

  const strings =
    collectStringsWithPaths(
      root,
      MAX_STRING_DEPTH
    );


  decodedStringsExamined +=
    strings.length;


  for (
    const row
    of strings
  ) {

    if (
      !isRelevantString(
        row.value
      )
    ) {

      continue;
    }


    decodedRelevantStrings++;


    recordEvidence({
      sourceLayer,
      sourceType,
      tick,
      sequence,
      path:
        row.path,
      value:
        row.value
    });
  }
}


// ============================================================
// EVIDENCE
// ============================================================

function recordEvidence({

  sourceLayer,

  sourceType,

  tick,

  sequence,

  path,

  value
}) {

  const text =
    String(
      value
      ??
      ''
    )
      .trim();


  if (
    !text
  ) {

    return;
  }


  const mapTokens =
    extractMapTokens(
      text
    );


  const resourcePaths =
    extractRelevantResourcePaths(
      text
    );


  if (
    mapTokens.length ===
    0
    &&
    resourcePaths.length ===
    0
  ) {

    return;
  }


  for (
    const token
    of mapTokens
  ) {

    increment(
      mapTokenCounts,
      token
    );
  }


  for (
    const resourcePath
    of resourcePaths
  ) {

    increment(
      resourcePathCounts,
      resourcePath
    );
  }


  if (
    evidenceRows.length <
    MAX_RECORDED_EVIDENCE
  ) {

    evidenceRows.push(
      {
        sourceLayer,

        sourceType,

        tick,

        sequence,

        path,

        value:
          truncateText(
            text,
            1000
          ),

        mapTokens,

        resourcePaths
      }
    );
  }
}


// ============================================================
// RELEVANT STRING DETECTION
// ============================================================

function isRelevantString(
  value
) {

  const text =
    String(
      value
      ??
      ''
    );


  return (
    /\bdl_[a-z0-9_]+\b/i.test(
      text
    )
    ||
    /(?:^|[\\/])maps[\\/]/i.test(
      text
    )
    ||
    /world_physics/i.test(
      text
    )
    ||
    /world\.vwrld/i.test(
      text
    )
    ||
    /\.vmap(?:_c)?\b/i.test(
      text
    )
  );
}


function extractMapTokens(
  value
) {

  const text =
    String(
      value
      ??
      ''
    );


  const output =
    new Set();


  for (
    const match
    of text.matchAll(
      /\bdl_[a-z0-9_]+\b/gi
    )
  ) {

    const token =
      normalizeMapToken(
        match[0]
      );


    if (
      token
    ) {

      output.add(
        token
      );
    }
  }


  // Also support map paths where the component might not have
  // been independently matched.
  for (
    const match
    of text.matchAll(
      /(?:^|[\\/])maps[\\/]([^\\/\s"'<>]+)/gi
    )
  ) {

    const token =
      normalizeMapToken(
        match[1]
      );


    if (
      token
      &&
      /^dl_/i.test(
        token
      )
    ) {

      output.add(
        token
      );
    }
  }


  return [
    ...output
  ];
}


function extractRelevantResourcePaths(
  value
) {

  const text =
    String(
      value
      ??
      ''
    )
      .replace(
        /\\/g,
        '/'
      );


  const output =
    new Set();


  const pathRegex =
    /(?:maps\/)?dl_[a-z0-9_]+(?:\/[a-z0-9_./-]+)?/gi;


  for (
    const match
    of text.matchAll(
      pathRegex
    )
  ) {

    output.add(
      match[0]
        .replace(
          /[),;\]}]+$/g,
          ''
        )
        .toLowerCase()
    );
  }


  return [
    ...output
  ];
}


// ============================================================
// DEEP STRING COLLECTION
// ============================================================

function collectStringsWithPaths(
  root,
  maximumDepth
) {

  const output =
    [];


  const seen =
    new Set();


  function visit(
    value,
    depth,
    path
  ) {

    if (
      value ===
      null
      ||
      value ===
      undefined
      ||
      depth >
      maximumDepth
    ) {

      return;
    }


    if (
      typeof value ===
      'string'
    ) {

      output.push(
        {
          path,

          value
        }
      );


      return;
    }


    if (
      typeof value ===
      'number'
      ||
      typeof value ===
      'boolean'
      ||
      typeof value ===
      'bigint'
    ) {

      return;
    }


    if (
      Buffer.isBuffer(
        value
      )
    ) {

      return;
    }


    if (
      typeof value !==
      'object'
      ||
      seen.has(
        value
      )
    ) {

      return;
    }


    seen.add(
      value
    );


    if (
      Array.isArray(
        value
      )
    ) {

      for (
        let index =
          0;

        index <
          value.length;

        index++
      ) {

        visit(
          value[index],
          depth +
          1,
          `${path}[${index}]`
        );
      }


      return;
    }


    for (
      const [
        key,
        child
      ]
      of Object.entries(
        value
      )
    ) {

      const childPath =
        path
          ? `${path}.${key}`
          : key;


      visit(
        child,
        depth +
        1,
        childPath
      );
    }
  }


  visit(
    root,
    0,
    ''
  );


  return output;
}


// ============================================================
// RAW ASCII SCAN
//
// Streaming scan. We retain only printable ASCII runs.
//
// This is independent of deadem decoding, though compressed
// packet content may not be visible here.
// ============================================================

async function scanRawAsciiStrings(
  path
) {

  let asciiStringsExamined =
    0;


  let relevantStrings =
    0;


  const mapCounts =
    new Map();


  const evidence =
    [];


  let current =
    '';


  function flush() {

    if (
      current.length <
      RAW_ASCII_MIN_LENGTH
    ) {

      current =
        '';

      return;
    }


    asciiStringsExamined++;


    if (
      isRelevantString(
        current
      )
    ) {

      relevantStrings++;


      const mapTokens =
        extractMapTokens(
          current
        );


      for (
        const token
        of mapTokens
      ) {

        increment(
          mapCounts,
          token
        );
      }


      if (
        evidence.length <
        200
      ) {

        evidence.push(
          {
            value:
              truncateText(
                current,
                1000
              ),

            mapTokens,

            resourcePaths:
              extractRelevantResourcePaths(
                current
              )
          }
        );
      }
    }


    current =
      '';
  }


  const stream =
    createReadStream(
      path
    );


  for await (
    const chunk
    of stream
  ) {

    for (
      let index =
        0;

      index <
        chunk.length;

      index++
    ) {

      const byte =
        chunk[index];


      if (
        byte >=
        32
        &&
        byte <=
        126
      ) {

        current +=
          String.fromCharCode(
            byte
          );


        // Prevent pathological memory growth if binary data
        // happens to form a very long printable run.
        if (
          current.length >
          16384
        ) {

          flush();
        }

      } else {

        flush();
      }
    }
  }


  flush();


  return {
    asciiStringsExamined,

    relevantStrings,

    mapTokenCounts:
      mapToSortedObject(
        mapCounts
      ),

    evidence
  };
}


// ============================================================
// TYPE HELPERS
// ============================================================

function decodeTypeText(
  type
) {

  if (
    type ===
    null
    ||
    type ===
    undefined
  ) {

    return null;
  }


  const candidates =
    [
      type?.code,
      type?._code,
      type?.name,
      type?._name,
      type?.typeName,
      type?.type_name,

      typeof type ===
      'string'
        ? type
        : null
    ];


  for (
    const candidate
    of candidates
  ) {

    if (
      candidate ===
      null
      ||
      candidate ===
      undefined
    ) {

      continue;
    }


    const text =
      String(
        candidate
      ).trim();


    if (
      text
      &&
      text !==
      '[object Object]'
    ) {

      return text;
    }
  }


  const fallback =
    String(
      type
    );


  return fallback ===
    '[object Object]'
      ? null
      : fallback;
}


function normalizeDemoType(
  value
) {

  const text =
    String(
      value
      ??
      ''
    )
      .trim()
      .toUpperCase();


  if (
    text ===
    'DEM_FILEHEADER'
  ) {

    return 'DEM_FILE_HEADER';
  }


  return text;
}


function getMessageData(
  packet
) {

  return packet?.data
    ??
    packet?.message
    ??
    packet?.payload
    ??
    packet?.body
    ??
    packet
    ??
    null;
}


// ============================================================
// MAP TOKEN NORMALIZATION
// ============================================================

function normalizeMapToken(
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


  let text =
    String(
      value
    )
      .trim()
      .replace(
        /\\/g,
        '/'
      )
      .toLowerCase();


  if (
    !text
  ) {

    return null;
  }


  text =
    text.replace(
      /\.(vmap_c|vmap|vwrld_c|vwrld|vpk|bsp)$/i,
      ''
    );


  const dlMatch =
    text.match(
      /\bdl_[a-z0-9_]+\b/i
    );


  if (
    dlMatch
  ) {

    return dlMatch[0].toLowerCase();
  }


  const pieces =
    text
      .split(
        '/'
      )
      .filter(
        Boolean
      );


  if (
    pieces.length >
    0
  ) {

    return pieces[
      pieces.length -
      1
    ];
  }


  return text;
}


// ============================================================
// SCALARS
// ============================================================

function firstNonEmptyString(
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
    ) {

      continue;
    }


    const text =
      String(
        value
      ).trim();


    if (
      text
    ) {

      return text;
    }
  }


  return null;
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


// ============================================================
// COLLECTION
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
          String(
            a[0]
          ).localeCompare(
            String(
              b[0]
            )
          )
      )
  );
}


// ============================================================
// TEXT
// ============================================================

function truncateText(
  value,
  maximumLength
) {

  const text =
    String(
      value
      ??
      ''
    );


  if (
    text.length <=
    maximumLength
  ) {

    return text;
  }


  return `${text.slice(
    0,
    maximumLength
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
    '# Replay Map Identification V03'
  );


  lines.push('');


  lines.push(
    `Replay: **${summary.replay}**`
  );


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## V02 correction'
  );


  lines.push('');


  lines.push(
    `The demo header reports \`${summary.priorV02Correction.fileHeaderMapName ?? 'EMPTY'}\`. This value is treated as a generic/bootstrap marker rather than gameplay-map identity.`
  );


  lines.push('');


  lines.push(
    '## Map-resource candidates'
  );


  lines.push('');


  if (
    summary.mapCandidates.dlCandidates.length ===
    0
  ) {

    lines.push(
      '- No `dl_*` resource candidate was observed.'
    );

  } else {

    for (
      const row
      of summary.mapCandidates.support
    ) {

      lines.push(
        `- **${row.mapName}** — count=${row.count}; source layers=${row.sourceLayers.join(', ')}`
      );
    }
  }


  lines.push('');


  lines.push(
    '## Resolution'
  );


  lines.push('');


  lines.push(
    `- Resolved map: ${summary.mapCandidates.resolvedMap ?? 'UNRESOLVED'}`
  );


  lines.push(
    `- Resolution status: ${summary.mapCandidates.resolutionStatus}`
  );


  lines.push('');


  lines.push(
    '## Guardrail'
  );


  lines.push('');


  lines.push(
    'Map identity is not inferred from replay date or from whichever map archives happen to exist in the current local installation.'
  );


  lines.push('');


  lines.push(
    'No LOS classifications or actionable-opportunity labels are produced.'
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