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
  'REPLAY_MAP_IDENTIFICATION_V01';


// ============================================================
// PURPOSE
//
// Script119 extracted dl_streets world physics before the replay
// map itself had been directly verified.
//
// Script120 fixes that ordering.
//
// Source 2 exposes the actual map name in:
//
//   CNETMsg_SignonState.mapName
//
// We inspect:
//
//   test.dem
//   rep01.dem
//   rep02.dem
//   rep03.dem
//   rep04.dem
//   rep05.dem
//
// and independently report the map declared inside each replay.
//
// Secondary evidence:
//
//   CNETMsg_SpawnGroup_Load.worldname
//
// is collected when available.
//
// NO map resource is extracted here.
// NO LOS is classified here.
// NO prior replay telemetry is modified.
//
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
    'replay_map_identification_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'replay_map_identification_v01.md'
  );


// ============================================================
// REQUIRED INPUT
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
// REPLAY LIST
//
// test = frozen discovery replay
// repXX = independent replication cohort
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
  'REPLAY MAP IDENTIFICATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'PRIMARY SOURCE'
);

console.log(
  '--------------'
);


console.log(
  'CNETMsg_SignonState.mapName'
);


console.log('');

console.log(
  'SECONDARY SOURCE'
);

console.log(
  '----------------'
);


console.log(
  'CNETMsg_SpawnGroup_Load.worldname'
);


console.log('');

console.log(
  `Replays: ${uniqueReplayNames.length}`
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
// CROSS-REPLAY AGREEMENT
// ============================================================

const resolvedResults =
  results.filter(
    row =>
      row.primaryMapName
  );


const primaryMapNames =
  [
    ...new Set(
      resolvedResults.map(
        row =>
          normalizeMapName(
            row.primaryMapName
          )
      )
    )
  ];


const allResolved =
  resolvedResults.length ===
  results.length;


const allPrimaryMapsAgree =
  allResolved
  &&
  primaryMapNames.length ===
  1;


const frozenDiscoveryMap =
  results.find(
    row =>
      row.replay ===
      'test'
  )?.primaryMapName
  ??
  null;


const replicationMaps =
  results.filter(
    row =>
      row.replay !==
      'test'
  );


const replicationMapNames =
  [
    ...new Set(
      replicationMaps
        .map(
          row =>
            row.primaryMapName
        )
        .filter(
          Boolean
        )
        .map(
          normalizeMapName
        )
    )
  ];


const allReplicationMapsResolved =
  replicationMaps.every(
    row =>
      Boolean(
        row.primaryMapName
      )
  );


const replicationCohortAgrees =
  allReplicationMapsResolved
  &&
  replicationMapNames.length ===
  1;


// ============================================================
// SECONDARY CONSISTENCY
// ============================================================

const secondaryAgreement =
  results.map(
    row => {

      const primary =
        normalizeMapName(
          row.primaryMapName
        );


      const secondaryCandidates =
        row.spawnGroupWorldNames
          .map(
            extractMapNameCandidate
          )
          .filter(
            Boolean
          );


      const secondaryMatchesPrimary =
        primary
        &&
        secondaryCandidates.some(
          name =>
            normalizeMapName(
              name
            ) ===
            primary
        );


      return {
        replay:
          row.replay,

        primaryMapName:
          row.primaryMapName,

        secondaryCandidates:
          [
            ...new Set(
              secondaryCandidates
            )
          ],

        secondaryMatchesPrimary
      };
    }
  );


// ============================================================
// STATUS
// ============================================================

let status;


if (
  allPrimaryMapsAgree
) {

  status =
    'REPLAY_MAP_STRONGLY_RESOLVED_ALL_REPLAYS_AGREE';

} else if (
  replicationCohortAgrees
) {

  status =
    'REPLICATION_MAP_RESOLVED_DISCOVERY_REPLAY_DIFFERS_OR_UNRESOLVED';

} else if (
  resolvedResults.length >
  0
) {

  status =
    'REPLAY_MAPS_MIXED_OR_PARTIALLY_RESOLVED';

} else {

  status =
    'REPLAY_MAP_UNRESOLVED';
}


// ============================================================
// CORRECT MAP TARGET
// ============================================================

const authoritativeReplicationMap =
  replicationCohortAgrees
    ? replicationMapNames[0]
    : null;


const authoritativeAllReplayMap =
  allPrimaryMapsAgree
    ? primaryMapNames[0]
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
    'SCRIPT119_MAP_TARGET_CONFIRMED_FOR_REPLICATION_COHORT';

} else if (
  script119MatchesReplicationMap ===
  false
) {

  script119Disposition =
    'SCRIPT119_MAP_TARGET_WRONG_FOR_REPLICATION_COHORT_KEEP_AS_TOOL_DIAGNOSTIC_ONLY';

} else {

  script119Disposition =
    'SCRIPT119_MAP_ASSOCIATION_REMAINS_UNRESOLVED';
}


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
        primaryReplayMapSource:
          'CNETMsg_SignonState.mapName',

        secondaryReplayMapSource:
          'CNETMsg_SpawnGroup_Load.worldname',

        rawReplayParsing:
          true,

        physicsExtraction:
          false,

        losClassification:
          false
      },


    replayCounts:
      {
        total:
          results.length,

        resolvedPrimary:
          resolvedResults.length,

        allResolved,

        allPrimaryMapsAgree,

        replicationTotal:
          replicationMaps.length,

        replicationResolved:
          replicationMaps.filter(
            row =>
              row.primaryMapName
          ).length,

        replicationCohortAgrees
      },


    mapResolution:
      {
        frozenDiscoveryMap,

        uniqueAllReplayMaps:
          primaryMapNames,

        uniqueReplicationMaps:
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

        guardrail:
          'The existing Script119 extraction must not be used for replay LOS unless its hardcoded map is directly confirmed by Script120.'
      },


    secondaryAgreement,

    replays:
      results,


    interpretation:
      {
        mapIdentity:
          allPrimaryMapsAgree
            ? `All analyzed replays explicitly declare the same map: ${authoritativeAllReplayMap}.`
            : replicationCohortAgrees
              ? `The five independent replication replays explicitly agree on ${authoritativeReplicationMap}; test.dem differs or is unresolved.`
              : 'The replay cohort does not yet support one common authoritative map.',

        nextRule:
          authoritativeReplicationMap
            ? `Future world-physics extraction must target ${authoritativeReplicationMap}, not a hardcoded historical map name.`
            : 'Do not perform authoritative world-physics extraction until the replication map is resolved.',

        staticLosGuardrail:
          'Map identity is necessary but not sufficient. The matching world-physics resource still requires coordinate/raycast validation against known successful soul-hit paths.'
      },


    nextStage:
      authoritativeReplicationMap
        ? 'EXTRACT_WORLD_PHYSICS_FOR_REPLAY_DECLARED_MAP'
        : 'DIAGNOSE_REPLAY_MAP_METADATA',


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
  'REPLAY MAP CROSS-REPLAY SUMMARY'
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
    `signonMsgs=${String(
      row.signonStateMessages
    ).padEnd(5)} ` +
    `spawnGroups=${row.spawnGroupWorldNames.length}`
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
  `test.dem:                   ${frozenDiscoveryMap ?? 'UNRESOLVED'}`
);


console.log(
  `Replication map(s):         ${replicationMapNames.join(', ') || 'UNRESOLVED'}`
);


console.log(
  `Replication cohort agrees: ${replicationCohortAgrees}`
);


console.log(
  `All six agree:              ${allPrimaryMapsAgree}`
);


console.log('');

console.log(
  'SCRIPT119 AUDIT'
);

console.log(
  '---------------'
);


console.log(
  `Script119 hardcoded map:    ${script119HardcodedMap}`
);


console.log(
  `Matches replication map:   ${
    script119MatchesReplicationMap ===
    null
      ? 'UNRESOLVED'
      : script119MatchesReplicationMap
  }`
);


console.log(
  `Disposition:                ${script119Disposition}`
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
  summary.nextStage
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


  const signonMapNames =
    [];


  const spawnGroupWorldNames =
    [];


  const relevantMessageTypes =
    new Map();


  let messagePackets =
    0;


  let signonStateMessages =
    0;


  let spawnGroupLoadMessages =
    0;


  parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
      demoPacket,
      messagePacket
    ) => {

      messagePackets++;


      const typeText =
        decodeMessageTypeText(
          messagePacket?.type
        );


      if (
        !typeText
      ) {

        return;
      }


      const data =
        getMessageData(
          messagePacket
        );


      // ------------------------------------------------------
      // PRIMARY:
      // CNETMsg_SignonState.mapName
      // ------------------------------------------------------

      if (
        /CNETMsg_SignonState/i.test(
          typeText
        )
        ||
        /SignonState/i.test(
          typeText
        )
      ) {

        signonStateMessages++;


        increment(
          relevantMessageTypes,
          typeText
        );


        const mapName =
          firstNonEmptyString(
            [
              data?.mapName,
              data?.map_name,
              findStringByKeyPatterns(
                data,
                [
                  /^mapName$/i,
                  /^map_name$/i
                ]
              )
            ]
          );


        if (
          mapName
        ) {

          signonMapNames.push(
            mapName
          );
        }
      }


      // ------------------------------------------------------
      // SECONDARY:
      // CNETMsg_SpawnGroup_Load.worldname
      // ------------------------------------------------------

      if (
        /CNETMsg_SpawnGroup_Load/i.test(
          typeText
        )
        ||
        /SpawnGroup.*Load/i.test(
          typeText
        )
      ) {

        spawnGroupLoadMessages++;


        increment(
          relevantMessageTypes,
          typeText
        );


        const worldName =
          firstNonEmptyString(
            [
              data?.worldname,
              data?.worldName,
              findStringByKeyPatterns(
                data,
                [
                  /^worldname$/i,
                  /^worldName$/i
                ]
              )
            ]
          );


        if (
          worldName
        ) {

          spawnGroupWorldNames.push(
            worldName
          );
        }
      }
    }
  );


  console.log(
    'Parsing replay signon/spawn-group metadata...'
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


  const uniqueSignonMapNames =
    [
      ...new Set(
        signonMapNames
          .map(
            cleanMapName
          )
          .filter(
            Boolean
          )
      )
    ];


  const uniqueSpawnGroupWorldNames =
    [
      ...new Set(
        spawnGroupWorldNames
          .map(
            value =>
              String(
                value
              ).trim()
          )
          .filter(
            Boolean
          )
      )
    ];


  const normalizedPrimaryCandidates =
    [
      ...new Set(
        uniqueSignonMapNames
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
    normalizedPrimaryCandidates.length ===
    1
  ) {

    primaryMapName =
      normalizedPrimaryCandidates[0];


    primaryStatus =
      'PRIMARY_SIGNON_MAP_RESOLVED';

  } else if (
    normalizedPrimaryCandidates.length >
    1
  ) {

    primaryStatus =
      'PRIMARY_SIGNON_MAP_CONFLICT';

  } else {

    primaryStatus =
      'PRIMARY_SIGNON_MAP_UNRESOLVED';
  }


  return {
    replay:
      replayName,

    replayPath,

    messagePackets,

    signonStateMessages,

    spawnGroupLoadMessages,

    rawSignonMapNames:
      signonMapNames,

    uniqueSignonMapNames,

    primaryMapName,

    primaryStatus,

    spawnGroupWorldNames:
      uniqueSpawnGroupWorldNames,

    spawnGroupMapCandidates:
      [
        ...new Set(
          uniqueSpawnGroupWorldNames
            .map(
              extractMapNameCandidate
            )
            .filter(
              Boolean
            )
        )
      ],

    relevantMessageTypes:
      mapToSortedObject(
        relevantMessageTypes
      )
  };
}


// ============================================================
// MESSAGE HELPERS
// ============================================================

function decodeMessageTypeText(
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
      type?._code,
      type?.code,
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
      candidate !==
      null
      &&
      candidate !==
      undefined
    ) {

      const text =
        String(
          candidate
        );


      if (
        text
        &&
        text !==
        '[object Object]'
      ) {

        return text;
      }
    }
  }


  const text =
    String(
      type
    );


  return text ===
    '[object Object]'
      ? null
      : text;
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
// DEEP STRING SEARCH
// ============================================================

function findStringByKeyPatterns(
  root,
  patterns,
  maximumDepth =
    4
) {

  if (
    !root
    ||
    typeof root !==
    'object'
  ) {

    return null;
  }


  const queue =
    [
      {
        value:
          root,

        depth:
          0
      }
    ];


  const seen =
    new Set();


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

        const stringValue =
          scalarString(
            child
          );


        if (
          stringValue
        ) {

          return stringValue;
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


  return null;
}


// ============================================================
// MAP NAME NORMALIZATION
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


  // Remove map file extensions.
  text =
    text.replace(
      /\.(vmap_c|vmap|bsp)$/i,
      ''
    );


  // Strip any leading map directory.
  const pieces =
    text.split(
      '/'
    );


  text =
    pieces[
      pieces.length -
      1
    ];


  return text
    ||
    null;
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


function extractMapNameCandidate(
  worldName
) {

  if (
    !worldName
  ) {

    return null;
  }


  const normalized =
    String(
      worldName
    )
      .trim()
      .replace(
        /\\/g,
        '/'
      );


  // Common forms:
  //
  // maps/dl_midtown/world
  // maps/dl_streets/world
  // dl_midtown
  // dl_midtown/world
  //
  const mapPathMatch =
    normalized.match(
      /(?:^|\/)maps\/([^/]+)/i
    );


  if (
    mapPathMatch
  ) {

    return normalizeMapName(
      mapPathMatch[1]
    );
  }


  const directMatch =
    normalized.match(
      /(dl_[a-z0-9_]+)/i
    );


  if (
    directMatch
  ) {

    return normalizeMapName(
      directMatch[1]
    );
  }


  return null;
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


// ============================================================
// COLLECTION HELPERS
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
    'MAP METADATA'
  );


  console.log(
    `  SignonState messages:      ${row.signonStateMessages}`
  );


  console.log(
    `  Signon map candidates:     ${JSON.stringify(
      row.uniqueSignonMapNames
    )}`
  );


  console.log(
    `  PRIMARY MAP:               ${row.primaryMapName ?? 'UNRESOLVED'}`
  );


  console.log(
    `  primary status:            ${row.primaryStatus}`
  );


  console.log('');

  console.log(
    'SPAWN-GROUP SECONDARY EVIDENCE'
  );


  console.log(
    `  SpawnGroup_Load messages:  ${row.spawnGroupLoadMessages}`
  );


  console.log(
    `  world names:               ${row.spawnGroupWorldNames.length}`
  );


  console.log(
    `  map candidates:            ${JSON.stringify(
      row.spawnGroupMapCandidates
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
    '# Replay Map Identification'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Primary authority'
  );


  lines.push('');


  lines.push(
    '`CNETMsg_SignonState.mapName` from each replay.'
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
      `- **${replay.replay}:** ${replay.primaryMapName ?? 'UNRESOLVED'}`
    );
  }


  lines.push('');


  lines.push(
    '## Replication cohort'
  );


  lines.push('');


  lines.push(
    `- Common replication map: ${summary.mapResolution.authoritativeReplicationMap ?? 'UNRESOLVED'}`
  );


  lines.push(
    `- Five-replay agreement: ${summary.replayCounts.replicationCohortAgrees}`
  );


  lines.push(
    `- All six replay agreement: ${summary.replayCounts.allPrimaryMapsAgree}`
  );


  lines.push('');


  lines.push(
    '## Script119 audit'
  );


  lines.push('');


  lines.push(
    `- Hardcoded Script119 map: ${summary.script119Audit.hardcodedMap}`
  );


  lines.push(
    `- Matches replication replay map: ${summary.script119Audit.matchesReplicationMap}`
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
    'No map physics resource should be used for LOS simply because it exists in the local Deadlock installation. It must correspond to the map declared by the replay.'
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