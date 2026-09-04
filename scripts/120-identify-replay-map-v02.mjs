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
  'REPLAY_MAP_IDENTIFICATION_V02';


// ============================================================
// V01 CORRECTION
//
// V01 inspected:
//
//   CNETMsg_SignonState.mapName
//
// through MESSAGE_PACKET.
//
// Those messages were present in every replay, but the mapName
// field was empty.
//
// deadem separately exposes:
//
//   DEM_FILE_HEADER
//
// through:
//
//   InterceptorStage.DEMO_PACKET
//
// Its decoded CDemoFileHeader contains:
//
//   mapName
//   gameDirectory
//   serverName
//   patchVersion
//   buildNum
//   game
//
// V02 therefore makes DEM_FILE_HEADER.mapName the primary map
// authority.
//
// We retain several independent diagnostics:
//
//   1. direct header mapName
//   2. recursive map-like strings anywhere in header
//   3. header field names / values for inspection
//   4. demo packet type counts
//
// NO map resource extraction.
// NO LOS classification.
// NO prior outputs are modified.
// ============================================================


// ============================================================
// PATHS
// ============================================================

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
    'replay_map_identification_v02.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'replay_map_identification_v02.md'
  );


// ============================================================
// INPUT
// ============================================================

if (
  !existsSync(
    MANIFEST_PATH
  )
) {

  throw new Error(
    `Missing replication manifest:\n${MANIFEST_PATH}`
  );
}


const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


const replicationCohort =
  Array.isArray(
    manifest?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  replicationCohort.length ===
  0
) {

  throw new Error(
    'Replication manifest contains no selected cohort.'
  );
}


// ============================================================
// REPLAYS
// ============================================================

const replayNames =
  [
    'test',

    ...replicationCohort.map(
      row =>
        String(
          row.replayName
        )
    )
  ];


const uniqueReplayNames =
  [
    ...new Set(
      replayNames
    )
  ];


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'REPLAY MAP IDENTIFICATION V0.2'
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
  'SignonState mapName was empty in Deadlock replay messages.'
);


console.log(
  'V02 reads DEM_FILE_HEADER.mapName at DEMO_PACKET stage.'
);


console.log('');

console.log(
  'PRIMARY AUTHORITY'
);

console.log(
  '-----------------'
);


console.log(
  'CDemoFileHeader.mapName'
);


console.log('');

console.log(
  `Replays:                 ${uniqueReplayNames.length}`
);


console.log(
  'Map resource extraction: NONE'
);


console.log(
  'LOS classification:      NONE'
);


console.log('');


// ============================================================
// ANALYZE
// ============================================================

const results =
  [];


for (
  let index =
    0;

  index <
    uniqueReplayNames.length;

  index++
) {

  const replayName =
    uniqueReplayNames[
      index
    ];


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${index + 1}/${uniqueReplayNames.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await identifyReplayMap(
      replayName
    );


  results.push(
    result
  );


  printReplayResult(
    result
  );


  console.log('');
}


// ============================================================
// RESOLUTION
// ============================================================

const resolved =
  results.filter(
    row =>
      row.primaryMapName
  );


const unresolved =
  results.filter(
    row =>
      !row.primaryMapName
  );


const allMapNames =
  [
    ...new Set(
      resolved
        .map(
          row =>
            normalizeMapName(
              row.primaryMapName
            )
        )
        .filter(
          Boolean
        )
    )
  ];


const replicationResults =
  results.filter(
    row =>
      row.replay !==
      'test'
  );


const replicationResolved =
  replicationResults.filter(
    row =>
      row.primaryMapName
  );


const replicationMapNames =
  [
    ...new Set(
      replicationResolved
        .map(
          row =>
            normalizeMapName(
              row.primaryMapName
            )
        )
        .filter(
          Boolean
        )
    )
  ];


const allResolved =
  resolved.length ===
  results.length;


const allAgree =
  allResolved
  &&
  allMapNames.length ===
  1;


const replicationAllResolved =
  replicationResolved.length ===
  replicationResults.length;


const replicationAgrees =
  replicationAllResolved
  &&
  replicationMapNames.length ===
  1;


const discoveryMap =
  results.find(
    row =>
      row.replay ===
      'test'
  )?.primaryMapName
  ??
  null;


const authoritativeReplicationMap =
  replicationAgrees
    ? replicationMapNames[0]
    : null;


const authoritativeAllReplayMap =
  allAgree
    ? allMapNames[0]
    : null;


// ============================================================
// SCRIPT119 AUDIT
// ============================================================

const script119HardcodedMap =
  'dl_streets';


const script119MatchesReplicationMap =
  authoritativeReplicationMap
    ? normalizeMapName(
        script119HardcodedMap
      )
      ===
      normalizeMapName(
        authoritativeReplicationMap
      )
    : null;


let script119Disposition;


if (
  script119MatchesReplicationMap ===
  true
) {

  script119Disposition =
    'SCRIPT119_MAP_TARGET_CONFIRMED';

} else if (
  script119MatchesReplicationMap ===
  false
) {

  script119Disposition =
    'SCRIPT119_WRONG_MAP_FOR_REPLICATION_COHORT_DIAGNOSTIC_ONLY';

} else {

  script119Disposition =
    'SCRIPT119_MAP_ASSOCIATION_UNRESOLVED';
}


// ============================================================
// STATUS
// ============================================================

let status;


if (
  allAgree
) {

  status =
    'REPLAY_MAP_STRONGLY_RESOLVED_ALL_SIX_AGREE';

} else if (
  replicationAgrees
) {

  status =
    'REPLICATION_MAP_STRONGLY_RESOLVED_DISCOVERY_REPLAY_DIFFERS_OR_UNRESOLVED';

} else if (
  resolved.length >
  0
) {

  status =
    'REPLAY_MAP_PARTIALLY_RESOLVED_OR_MIXED';

} else {

  status =
    'REPLAY_MAP_STILL_UNRESOLVED';
}


// ============================================================
// NEXT STAGE
// ============================================================

const nextStage =
  authoritativeReplicationMap
    ? 'EXTRACT_WORLD_PHYSICS_FOR_REPLAY_DECLARED_MAP'
    : 'DIAGNOSE_RAW_DEMO_HEADER_IF_MAP_NAME_EMPTY';


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


    methodology:
      {

        primarySource:
          'DEM_FILE_HEADER / CDemoFileHeader.mapName',

        interceptorStage:
          'DEMO_PACKET',

        rawReplayParsing:
          true,

        resourceExtraction:
          false,

        losClassification:
          false
      },


    resolution:
      {

        totalReplays:
          results.length,

        resolved:
          resolved.length,

        unresolved:
          unresolved.length,

        allResolved,

        allAgree,

        allReplayMapNames:
          allMapNames,

        discoveryMap,

        replicationReplays:
          replicationResults.length,

        replicationResolved:
          replicationResolved.length,

        replicationAllResolved,

        replicationAgrees,

        replicationMapNames,

        authoritativeAllReplayMap,

        authoritativeReplicationMap
      },


    script119Audit:
      {

        hardcodedMap:
          script119HardcodedMap,

        matchesReplicationMap:
          script119MatchesReplicationMap,

        disposition:
          script119Disposition,

        priorExtractionStatus:
          'Keep existing dl_streets extraction files; do not use for replay LOS unless map identity matches.'
      },


    replays:
      results,


    interpretation:
      {

        primaryAuthority:
          'The replay demo file header is stronger map identity evidence than inferring map version from replay date or from which VPKs happen to exist locally.',

        script119:
          script119Disposition,

        losGuardrail:
          'Even after map identity is resolved, the matching physics resource still requires coordinate and raycast validation against successful soul-hit positive controls.'
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
// FINAL CONSOLE
// ============================================================

console.log(
  '========================================================'
);

console.log(
  'REPLAY MAP CROSS-REPLAY SUMMARY V0.2'
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
  of results
) {

  console.log(
    `${row.replay.padEnd(10)} ` +

    `map=${String(
      row.primaryMapName
      ??
      'UNRESOLVED'
    ).padEnd(24)} ` +

    `header=${String(
      row.fileHeaderFound
    ).padEnd(5)} ` +

    `patch=${String(
      row.header.patchVersion
      ??
      'n/a'
    ).padEnd(8)} ` +

    `build=${String(
      row.header.buildNum
      ??
      'n/a'
    )}`
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
  `test.dem:                    ${discoveryMap ?? 'UNRESOLVED'}`
);


console.log(
  `Replication map(s):          ${replicationMapNames.join(', ') || 'UNRESOLVED'}`
);


console.log(
  `Replication cohort resolved: ${replicationAllResolved}`
);


console.log(
  `Replication cohort agrees:   ${replicationAgrees}`
);


console.log(
  `All six agree:               ${allAgree}`
);


console.log('');

console.log(
  'SCRIPT119 AUDIT'
);

console.log(
  '---------------'
);


console.log(
  `Script119 hardcoded map:     ${script119HardcodedMap}`
);


console.log(
  `Matches replication map:    ${
    script119MatchesReplicationMap ===
    null
      ? 'UNRESOLVED'
      : script119MatchesReplicationMap
  }`
);


console.log(
  `Disposition:                 ${script119Disposition}`
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
// IDENTIFY ONE REPLAY
// ============================================================

async function identifyReplayMap(
  replayName
) {

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
      `${replayName}: replay not found:\n${replayPath}`
    );
  }


  const parser =
    new Parser();


  let fileHeaderFound =
    false;


  let fileHeaderCount =
    0;


  let fileHeaderTick =
    null;


  let fileHeaderSequence =
    null;


  let fileHeaderData =
    null;


  const demoPacketTypeCounts =
    new Map();


  const headerMapCandidates =
    new Set();


  // ----------------------------------------------------------
  // DEMO_PACKET INTERCEPTOR
  // ----------------------------------------------------------

  parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    (
      demoPacket
    ) => {

      const typeText =
        decodeDemoPacketType(
          demoPacket?.type
        );


      increment(
        demoPacketTypeCounts,
        typeText
        ??
        'UNKNOWN'
      );


      if (
        typeText !==
        'DEM_FILE_HEADER'
      ) {

        return;
      }


      fileHeaderFound =
        true;


      fileHeaderCount++;


      fileHeaderTick =
        finite(
          demoPacket?.tick
        );


      fileHeaderSequence =
        finite(
          demoPacket?.sequence
        );


      const data =
        demoPacket?.data
        ??
        null;


      fileHeaderData =
        serializeObject(
          data
        );


      // ------------------------------------------------------
      // DIRECT PRIMARY FIELD
      // ------------------------------------------------------

      const directMapName =
        firstNonEmptyString(
          [
            data?.mapName,
            data?.map_name
          ]
        );


      if (
        directMapName
      ) {

        headerMapCandidates.add(
          cleanMapName(
            directMapName
          )
        );
      }


      // ------------------------------------------------------
      // DEEP MAP-NAME KEY SEARCH
      // ------------------------------------------------------

      for (
        const candidate
        of findStringsByKeyPatterns(
          data,
          [
            /^mapName$/i,
            /^map_name$/i
          ],
          6
        )
      ) {

        const cleaned =
          cleanMapName(
            candidate
          );


        if (
          cleaned
        ) {

          headerMapCandidates.add(
            cleaned
          );
        }
      }


      // ------------------------------------------------------
      // FALLBACK:
      // ANY HEADER STRING CONTAINING dl_*
      // ------------------------------------------------------

      for (
        const text
        of collectAllStrings(
          data,
          6
        )
      ) {

        for (
          const candidate
          of extractDlMapNames(
            text
          )
        ) {

          headerMapCandidates.add(
            candidate
          );
        }
      }
    }
  );


  console.log(
    'Parsing DEM_FILE_HEADER metadata...'
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


  // ----------------------------------------------------------
  // NORMALIZE HEADER
  // ----------------------------------------------------------

  const header =
    {

      demoFileStamp:
        firstNonEmptyString(
          [
            fileHeaderData?.demoFileStamp,
            fileHeaderData?.demo_file_stamp
          ]
        ),

      patchVersion:
        firstFinite(
          [
            fileHeaderData?.patchVersion,
            fileHeaderData?.patch_version
          ]
        ),

      serverName:
        firstNonEmptyString(
          [
            fileHeaderData?.serverName,
            fileHeaderData?.server_name
          ]
        ),

      clientName:
        firstNonEmptyString(
          [
            fileHeaderData?.clientName,
            fileHeaderData?.client_name
          ]
        ),

      mapName:
        firstNonEmptyString(
          [
            fileHeaderData?.mapName,
            fileHeaderData?.map_name
          ]
        ),

      gameDirectory:
        firstNonEmptyString(
          [
            fileHeaderData?.gameDirectory,
            fileHeaderData?.game_directory
          ]
        ),

      fullpacketsVersion:
        firstFinite(
          [
            fileHeaderData?.fullpacketsVersion,
            fileHeaderData?.fullpackets_version
          ]
        ),

      addons:
        firstNonEmptyString(
          [
            fileHeaderData?.addons
          ]
        ),

      demoVersionName:
        firstNonEmptyString(
          [
            fileHeaderData?.demoVersionName,
            fileHeaderData?.demo_version_name
          ]
        ),

      demoVersionGuid:
        firstNonEmptyString(
          [
            fileHeaderData?.demoVersionGuid,
            fileHeaderData?.demo_version_guid
          ]
        ),

      buildNum:
        firstFinite(
          [
            fileHeaderData?.buildNum,
            fileHeaderData?.build_num
          ]
        ),

      game:
        firstNonEmptyString(
          [
            fileHeaderData?.game
          ]
        ),

      serverStartTick:
        firstFinite(
          [
            fileHeaderData?.serverStartTick,
            fileHeaderData?.server_start_tick
          ]
        )
    };


  // ----------------------------------------------------------
  // PRIMARY MAP RESOLUTION
  //
  // Direct header mapName has priority.
  // Fallback dl_* candidate is retained only when unique.
  // ----------------------------------------------------------

  const directMap =
    normalizeMapName(
      header.mapName
    );


  const normalizedCandidates =
    [
      ...new Set(
        [
          ...headerMapCandidates
        ]
          .map(
            normalizeMapName
          )
          .filter(
            Boolean
          )
      )
    ];


  let primaryMapName =
    null;


  let primaryStatus;


  if (
    directMap
  ) {

    primaryMapName =
      directMap;


    primaryStatus =
      'DIRECT_DEMO_FILE_HEADER_MAP_NAME';

  } else if (
    normalizedCandidates.length ===
    1
  ) {

    primaryMapName =
      normalizedCandidates[0];


    primaryStatus =
      'UNIQUE_DEMO_FILE_HEADER_STRING_FALLBACK';

  } else if (
    normalizedCandidates.length >
    1
  ) {

    primaryStatus =
      'HEADER_MAP_CANDIDATES_CONFLICT';

  } else if (
    fileHeaderFound
  ) {

    primaryStatus =
      'DEMO_FILE_HEADER_PRESENT_MAP_NAME_EMPTY';

  } else {

    primaryStatus =
      'DEMO_FILE_HEADER_NOT_OBSERVED';
  }


  return {

    replay:
      replayName,

    replayPath,

    fileHeaderFound,

    fileHeaderCount,

    fileHeaderTick,

    fileHeaderSequence,

    primaryMapName,

    primaryStatus,

    header,

    headerMapCandidates:
      normalizedCandidates,

    rawHeaderKeys:
      fileHeaderData
        &&
        typeof fileHeaderData ===
        'object'
        ? Object.keys(
            fileHeaderData
          ).sort()
        : [],

    rawHeader:
      fileHeaderData,

    demoPacketTypeCounts:
      mapToSortedObject(
        demoPacketTypeCounts
      )
  };
}


// ============================================================
// DEMO PACKET TYPE
// ============================================================

function decodeDemoPacketType(
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
      candidate !==
      null
      &&
      candidate !==
      undefined
    ) {

      const normalized =
        normalizeDemoTypeText(
          candidate
        );


      if (
        normalized
      ) {

        return normalized;
      }
    }
  }


  return normalizeDemoTypeText(
    String(
      type
    )
  );
}


function normalizeDemoTypeText(
  value
) {

  const text =
    String(
      value
      ??
      ''
    )
      .trim();


  if (
    !text
    ||
    text ===
    '[object Object]'
  ) {

    return null;
  }


  const upper =
    text.toUpperCase();


  if (
    upper ===
    'DEM_FILEHEADER'
  ) {

    return 'DEM_FILE_HEADER';
  }


  if (
    upper ===
    'DEM_FILE_HEADER'
  ) {

    return 'DEM_FILE_HEADER';
  }


  return upper;
}


// ============================================================
// MAP NORMALIZATION
// ============================================================

function cleanMapName(
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
      );


  if (
    !text
  ) {

    return null;
  }


  text =
    text.replace(
      /\.(vmap_c|vmap|bsp)$/i,
      ''
    );


  if (
    text.includes(
      '/'
    )
  ) {

    const pieces =
      text
        .split(
          '/'
        )
        .filter(
          Boolean
        );


    const directDlPiece =
      pieces.find(
        piece =>
          /^dl_[a-z0-9_]+$/i.test(
            piece
          )
      );


    if (
      directDlPiece
    ) {

      return directDlPiece;
    }


    text =
      pieces[
        pieces.length -
        1
      ];
  }


  const match =
    text.match(
      /(dl_[a-z0-9_]+)/i
    );


  if (
    match
  ) {

    return match[1];
  }


  return text;
}


function normalizeMapName(
  value
) {

  const cleaned =
    cleanMapName(
      value
    );


  return cleaned
    ? cleaned.toLowerCase()
    : null;
}


function extractDlMapNames(
  value
) {

  const text =
    String(
      value
      ??
      ''
    );


  const result =
    [];


  for (
    const match
    of text.matchAll(
      /\bdl_[a-z0-9_]+\b/gi
    )
  ) {

    const normalized =
      normalizeMapName(
        match[0]
      );


    if (
      normalized
    ) {

      result.push(
        normalized
      );
    }
  }


  return [
    ...new Set(
      result
    )
  ];
}


// ============================================================
// DEEP SEARCH
// ============================================================

function findStringsByKeyPatterns(
  root,
  patterns,
  maximumDepth =
    5
) {

  const output =
    [];


  if (
    !root
    ||
    typeof root !==
    'object'
  ) {

    return output;
  }


  const seen =
    new Set();


  const queue =
    [
      {
        value:
          root,

        depth:
          0
      }
    ];


  while (
    queue.length >
    0
  ) {

    const current =
      queue.shift();


    const value =
      current.value;


    if (
      !value
      ||
      typeof value !==
      'object'
      ||
      seen.has(
        value
      )
    ) {

      continue;
    }


    seen.add(
      value
    );


    for (
      const [
        key,
        child
      ]
      of Object.entries(
        value
      )
    ) {

      if (
        patterns.some(
          pattern =>
            pattern.test(
              key
            )
        )
      ) {

        const text =
          scalarString(
            child
          );


        if (
          text
        ) {

          output.push(
            text
          );
        }
      }


      if (
        current.depth <
        maximumDepth
        &&
        child
        &&
        typeof child ===
        'object'
      ) {

        queue.push(
          {
            value:
              child,

            depth:
              current.depth +
              1
          }
        );
      }
    }
  }


  return output;
}


function collectAllStrings(
  root,
  maximumDepth =
    5
) {

  const output =
    [];


  const seen =
    new Set();


  function visit(
    value,
    depth
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
        value
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
        const child
        of value
      ) {

        visit(
          child,
          depth +
          1
        );
      }


      return;
    }


    for (
      const child
      of Object.values(
        value
      )
    ) {

      visit(
        child,
        depth +
        1
      );
    }
  }


  visit(
    root,
    0
  );


  return output;
}


// ============================================================
// SAFE SERIALIZATION
// ============================================================

function serializeObject(
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

    return JSON.parse(
      JSON.stringify(
        value,
        (
          key,
          child
        ) => {

          if (
            typeof child ===
            'bigint'
          ) {

            return child.toString();
          }


          if (
            Buffer.isBuffer(
              child
            )
          ) {

            return {
              type:
                'Buffer',

              length:
                child.length
            };
          }


          return child;
        }
      )
    );

  } catch {

    return null;
  }
}


// ============================================================
// SCALAR HELPERS
// ============================================================

function firstNonEmptyString(
  values
) {

  for (
    const value
    of values
  ) {

    const text =
      scalarString(
        value
      );


    if (
      text
      &&
      text.trim()
    ) {

      return text.trim();
    }
  }


  return null;
}


function scalarString(
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
    'string'
    ||
    typeof value ===
    'number'
    ||
    typeof value ===
    'bigint'
  ) {

    return String(
      value
    );
  }


  if (
    typeof value ===
    'object'
  ) {

    const candidate =
      value._value
      ??
      value.value
      ??
      value._code
      ??
      value.code
      ??
      value._name
      ??
      value.name
      ??
      null;


    if (
      candidate !==
      null
      &&
      candidate !==
      undefined
    ) {

      return String(
        candidate
      );
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
// CONSOLE
// ============================================================

function printReplayResult(
  row
) {

  console.log('');

  console.log(
    'DEMO FILE HEADER'
  );


  console.log(
    `  observed:                  ${row.fileHeaderFound}`
  );


  console.log(
    `  count:                     ${row.fileHeaderCount}`
  );


  console.log(
    `  tick:                      ${row.fileHeaderTick ?? 'n/a'}`
  );


  console.log(
    `  mapName:                   ${row.header.mapName ?? 'EMPTY'}`
  );


  console.log(
    `  normalized PRIMARY MAP:    ${row.primaryMapName ?? 'UNRESOLVED'}`
  );


  console.log(
    `  resolution status:         ${row.primaryStatus}`
  );


  console.log(
    `  gameDirectory:             ${row.header.gameDirectory ?? 'n/a'}`
  );


  console.log(
    `  game:                      ${row.header.game ?? 'n/a'}`
  );


  console.log(
    `  patchVersion:              ${row.header.patchVersion ?? 'n/a'}`
  );


  console.log(
    `  buildNum:                  ${row.header.buildNum ?? 'n/a'}`
  );


  console.log(
    `  fallback dl_* candidates:  ${JSON.stringify(
      row.headerMapCandidates
    )}`
  );


  console.log(
    `  header keys:               ${JSON.stringify(
      row.rawHeaderKeys
    )}`
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
    '# Replay Map Identification V02'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## V01 correction'
  );


  lines.push('');


  lines.push(
    'V01 inspected `CNETMsg_SignonState.mapName`, but the Deadlock replay SignonState messages contained no map-name value.'
  );


  lines.push('');


  lines.push(
    'V02 uses `DEM_FILE_HEADER / CDemoFileHeader.mapName` through the DEMO_PACKET interceptor as the primary replay map authority.'
  );


  lines.push('');


  lines.push(
    '## Results'
  );


  lines.push('');


  for (
    const replay
    of summary.replays
  ) {

    lines.push(
      `- **${replay.replay}:** ${replay.primaryMapName ?? 'UNRESOLVED'} — ${replay.primaryStatus}`
    );
  }


  lines.push('');


  lines.push(
    '## Replication cohort'
  );


  lines.push('');


  lines.push(
    `- Resolved: ${summary.resolution.replicationAllResolved}`
  );


  lines.push(
    `- Agreement: ${summary.resolution.replicationAgrees}`
  );


  lines.push(
    `- Authoritative replication map: ${summary.resolution.authoritativeReplicationMap ?? 'UNRESOLVED'}`
  );


  lines.push('');


  lines.push(
    '## Script119 audit'
  );


  lines.push('');


  lines.push(
    `- Hardcoded map: ${summary.script119Audit.hardcodedMap}`
  );


  lines.push(
    `- Matches replication map: ${summary.script119Audit.matchesReplicationMap}`
  );


  lines.push(
    `- Disposition: **${summary.script119Audit.disposition}**`
  );


  lines.push('');


  lines.push(
    '## Guardrail'
  );


  lines.push('');


  lines.push(
    'The existence of a local VPK is not evidence that the replay used that map. Future LOS physics extraction must use the map identity declared by the replay header.'
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