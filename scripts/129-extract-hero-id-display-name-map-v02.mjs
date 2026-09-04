import {
  createHash
} from 'node:crypto';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';

import {
  tmpdir
} from 'node:os';

import {
  dirname,
  join,
  resolve
} from 'node:path';

import {
  spawnSync
} from 'node:child_process';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_V02';


// ============================================================
// PURPOSE
//
// Script129 V01 successfully recovered:
//
//   heroId
//   internal hero key
//   internal/codename identity
//
// But its "heroName" field was often an INTERNAL hero name:
//
//   inferno   -> Inferno
//   gigawatt  -> Gigawatt
//   ghost     -> Ghost
//   bookworm  -> Bookworm
//
// Those are not necessarily the player-facing Deadlock names.
//
// V02 resolves the CURRENT ENGLISH LOCALIZATION from the local
// installed Deadlock build.
//
// Desired result:
//
//   heroId:       67
//   internalKey:  bookworm
//   internalName: Bookworm
//   displayName:  Paige
//
// Numeric heroId remains the durable join key.
//
// No web lookup.
// No replay parsing.
// No handwritten hero-name table.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const SOURCE2VIEWER_PATH =
  resolve(
    'tools',
    'source2viewer',
    'Source2Viewer-CLI.exe'
  );


const V01_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_name_map_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v02.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v02.md'
  );


// ============================================================
// DEADLOCK INSTALL CANDIDATES
// ============================================================

const installCandidates =
  [
    process.env.DEADLOCK_CITADEL_DIR
      ? resolve(
          process.env.DEADLOCK_CITADEL_DIR,
          'pak01_dir.vpk'
        )
      : null,

    'G:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

    'C:\\Program Files\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

    'D:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

    'E:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

    'F:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk'
  ]
    .filter(
      Boolean
    );


// ============================================================
// GUARDS
// ============================================================

if (
  !existsSync(
    SOURCE2VIEWER_PATH
  )
) {

  throw new Error(
    `Source2Viewer CLI not found:\n${SOURCE2VIEWER_PATH}`
  );
}


if (
  !existsSync(
    V01_PATH
  )
) {

  throw new Error(
    `Script129 V01 output not found:\n${V01_PATH}`
  );
}


const pakPath =
  installCandidates.find(
    path =>
      existsSync(
        path
      )
  )
  ??
  null;


if (
  !pakPath
) {

  throw new Error(
    [
      'Could not locate Deadlock pak01_dir.vpk.',
      '',
      'Checked:',
      ...installCandidates.map(
        path =>
          `  ${path}`
      ),
      '',
      'If needed, set:',
      '  DEADLOCK_CITADEL_DIR=<path to game\\citadel>'
    ].join(
      '\n'
    )
  );
}


// ============================================================
// LOAD V01
// ============================================================

const v01 =
  JSON.parse(
    readFileSync(
      V01_PATH,
      'utf8'
    )
  );


if (
  v01?.status !==
  'DEADLOCK_HERO_ID_NAME_MAP_READY'
) {

  throw new Error(
    `Script129 V01 not ready. Status=${v01?.status}`
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
  'DEADLOCK HERO ID -> DISPLAY NAME MAP V0.2'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Source2Viewer: ${SOURCE2VIEWER_PATH}`
);

console.log(
  `Deadlock VPK:  ${pakPath}`
);

console.log(
  'V01 identity:  internal hero IDs / keys'
);

console.log(
  'V02 identity:  English localized display names'
);

console.log(
  'Replay parse:  NONE'
);

console.log(
  'Web lookup:    NONE'
);

console.log('');


// ============================================================
// SOURCE2VIEWER VERSION
// ============================================================

const versionResult =
  spawnSync(
    SOURCE2VIEWER_PATH,
    [
      '--version'
    ],
    {
      encoding:
        'utf8',

      windowsHide:
        true
    }
  );


const source2ViewerVersion =
  [
    versionResult.stdout,
    versionResult.stderr
  ]
    .filter(
      Boolean
    )
    .join(
      '\n'
    )
    .trim()
    ||
    null;


console.log(
  `Source2Viewer version: ${source2ViewerVersion ?? 'UNRESOLVED'}`
);

console.log('');


// ============================================================
// DISCOVER LOCALIZATION FILES IN VPK
// ============================================================

console.log(
  'Discovering English localization files in VPK...'
);


const listResult =
  spawnSync(
    SOURCE2VIEWER_PATH,
    [
      '--input',
      pakPath,

      '--vpk_list',

      '--vpk_filepath',
      'resource/localization/'
    ],
    {
      encoding:
        'utf8',

      windowsHide:
        true,

      maxBuffer:
        128 *
        1024 *
        1024
    }
  );


const listText =
  [
    listResult.stdout,
    listResult.stderr
  ]
    .filter(
      Boolean
    )
    .join(
      '\n'
    );


const discoveredLocalizationPaths =
  discoverEnglishLocalizationPaths(
    listText
  );


const knownLocalizationCandidates =
  [
    'resource/localization/citadel_english.txt',
    'resource/localization/citadel_common_english.txt'
  ];


const localizationCandidates =
  [
    ...new Set(
      [
        ...knownLocalizationCandidates,
        ...discoveredLocalizationPaths
      ]
    )
  ];


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
  mkdtempSync(
    join(
      tmpdir(),
      'deadlock-localization-'
    )
  );


const extractedLocalizationFiles =
  [];


for (
  const vpkResourcePath
  of localizationCandidates
) {

  const extracted =
    tryExtractVpkTextFile({
      source2ViewerPath:
        SOURCE2VIEWER_PATH,

      pakPath,

      vpkResourcePath,

      temporaryDirectory
    });


  if (
    !extracted
  ) {

    continue;
  }


  const buffer =
    readFileSync(
      extracted.path
    );


  const text =
    decodeValveText(
      buffer
    );


  if (
    !text
    ||
    text.length <
    10
  ) {

    continue;
  }


  extractedLocalizationFiles.push(
    {
      vpkResourcePath,

      localPath:
        extracted.path,

      bytes:
        buffer.length,

      sha256:
        sha256Buffer(
          buffer
        ),

      text
    }
  );
}


if (
  extractedLocalizationFiles.length ===
  0
) {

  rmSync(
    temporaryDirectory,
    {
      recursive:
        true,

      force:
        true
    }
  );


  throw new Error(
    [
      'Could not extract any English localization resources.',
      '',
      'Discovered paths:',
      ...discoveredLocalizationPaths.map(
        path =>
          `  ${path}`
      )
    ].join(
      '\n'
    )
  );
}


console.log(
  `English localization files extracted: ${extractedLocalizationFiles.length}`
);


for (
  const file
  of extractedLocalizationFiles
) {

  console.log(
    `  ${file.vpkResourcePath} bytes=${file.bytes}`
  );
}


console.log('');


// ============================================================
// BUILD LOCALIZATION TOKEN MAP
// ============================================================

const localization =
  new Map();


const localizationSources =
  new Map();


for (
  const file
  of extractedLocalizationFiles
) {

  const tokenPairs =
    parseLocalizationTokens(
      file.text
    );


  console.log(
    `Parsed ${tokenPairs.size} token pairs from ${file.vpkResourcePath}`
  );


  for (
    const [
      token,
      value
    ]
    of tokenPairs
  ) {

    const normalizedToken =
      normalizeToken(
        token
      );


    if (
      !normalizedToken
      ||
      !value
    ) {

      continue;
    }


    // Prefer first occurrence.
    if (
      !localization.has(
        normalizedToken
      )
    ) {

      localization.set(
        normalizedToken,
        value
      );


      localizationSources.set(
        normalizedToken,
        file.vpkResourcePath
      );
    }
  }
}


console.log('');

console.log(
  `Combined localization tokens: ${localization.size}`
);

console.log('');


// ============================================================
// RESOLVE HERO DISPLAY NAMES
// ============================================================

const v01Records =
  Array.isArray(
    v01.records
  )
    ? v01.records
    : [];


const records =
  v01Records
    .map(
      row =>
        resolveHeroDisplayIdentity({
          row,
          localization,
          localizationSources
        })
    )
    .sort(
      (
        a,
        b
      ) =>
        a.heroId -
        b.heroId
    );


// ============================================================
// OBSERVED COHORT
// ============================================================

const observedHeroIds =
  Array.isArray(
    v01.observedCrosswalk
  )
    ? v01.observedCrosswalk
        .map(
          row =>
            finite(
              row.heroId
            )
        )
        .filter(
          Number.isFinite
        )
    : [];


const recordById =
  new Map(
    records.map(
      row => [
        row.heroId,
        row
      ]
    )
  );


const observedCrosswalk =
  observedHeroIds
    .map(
      heroId =>
        recordById.get(
          heroId
        )
        ??
        {
          heroId,

          displayName:
            null,

          internalName:
            null,

          internalKey:
            null,

          displayNameResolved:
            false,

          displayNameSource:
            'UNRESOLVED'
        }
    );


const unresolvedObserved =
  observedCrosswalk.filter(
    row =>
      !row.displayNameResolved
      ||
      !row.displayName
  );


// ============================================================
// LOOKUP MAPS
// ============================================================

const heroIdToDisplayName =
  Object.fromEntries(
    records
      .filter(
        row =>
          row.displayName
      )
      .map(
        row => [
          String(
            row.heroId
          ),

          row.displayName
        ]
      )
  );


const heroIdToInternalName =
  Object.fromEntries(
    records
      .filter(
        row =>
          row.internalName
      )
      .map(
        row => [
          String(
            row.heroId
          ),

          row.internalName
        ]
      )
  );


const displayNameToHeroId =
  Object.fromEntries(
    records
      .filter(
        row =>
          row.displayName
      )
      .sort(
        (
          a,
          b
        ) =>
          a.displayName.localeCompare(
            b.displayName
          )
      )
      .map(
        row => [
          row.displayName,
          row.heroId
        ]
      )
  );


// ============================================================
// VALIDATION
// ============================================================

const suspiciousInternalFallbacks =
  observedCrosswalk.filter(
    row =>
      row.displayNameSource ===
      'INTERNAL_NAME_FALLBACK'
  );


const validationChecks =
  {
    v01RecordsAvailable:
      check(
        records.length,
        '>0',
        records.length >
        0
      ),


    localizationFilesExtracted:
      check(
        extractedLocalizationFiles.length,
        '>0',
        extractedLocalizationFiles.length >
        0
      ),


    localizationTokensParsed:
      check(
        localization.size,
        '>0',
        localization.size >
        0
      ),


    observedHeroIdsAvailable:
      check(
        observedHeroIds.length,
        '>0',
        observedHeroIds.length >
        0
      ),


    everyObservedHeroGetsDisplayName:
      check(
        observedCrosswalk.filter(
          row =>
            row.displayNameResolved
            &&
            row.displayName
        ).length,
        observedHeroIds.length,
        unresolvedObserved.length ===
        0
      ),


    noObservedInternalFallbacks:
      check(
        suspiciousInternalFallbacks.length,
        0,
        suspiciousInternalFallbacks.length ===
        0
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


const status =
  validationPass
    ? 'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY'
    : 'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_REQUIRES_DIAGNOSIS';


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

    source:
      {
        method:
          'LOCAL_DEADLOCK_ENGLISH_LOCALIZATION',

        pakPath,

        pakBytes:
          statSync(
            pakPath
          ).size,

        source2ViewerPath:
          SOURCE2VIEWER_PATH,

        source2ViewerVersion,

        localizationFiles:
          extractedLocalizationFiles.map(
            file => ({
              vpkResourcePath:
                file.vpkResourcePath,

              bytes:
                file.bytes,

              sha256:
                file.sha256
            })
          ),

        temporaryLocalizationFilesDeletedAfterParsing:
          true
      },

    counts:
      {
        heroRecords:
          records.length,

        localizationTokens:
          localization.size,

        observedHeroIds:
          observedHeroIds.length,

        observedDisplayNamesResolved:
          observedHeroIds.length -
          unresolvedObserved.length,

        observedDisplayNamesUnresolved:
          unresolvedObserved.length,

        observedInternalFallbacks:
          suspiciousInternalFallbacks.length
      },

    observedCrosswalk,

    unresolvedObserved,

    heroIdToDisplayName,

    heroIdToInternalName,

    displayNameToHeroId,

    records,

    validation:
      {
        pass:
          validationPass,

        checks:
          validationChecks
      },

    semantics:
      {
        durableJoinKey:
          'heroId',

        internalIdentity:
          'internalKey / internalName preserve Valve asset/codename identity',

        presentationIdentity:
          'displayName is resolved from current installed English localization',

        recommendedDisplay:
          'Display Name (heroId)',

        futureReports:
          'Use displayName for console/report presentation while retaining heroId in every machine-readable row.'
      },

    nextStage:
      validationPass
        ? 'USE_DISPLAY_NAMES_IN_ALL_FUTURE REPORTS_AND_RETURN_TO_SHOT_TRAVEL_AUDIT_AS_SCRIPT130'
        : 'DIAGNOSE_LOCALIZATION_TOKEN_RESOLUTION',

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
// DELETE TEMP RESOURCES
// ============================================================

rmSync(
  temporaryDirectory,
  {
    recursive:
      true,

    force:
      true
  }
);


// ============================================================
// CONSOLE
// ============================================================

console.log(
  '========================================================'
);

console.log(
  'HERO DISPLAY NAME CROSSWALK'
);

console.log(
  '========================================================'
);

console.log('');


for (
  const row
  of observedCrosswalk
) {

  console.log(
    `${String(row.heroId).padStart(3)}  ` +
    `${String(row.displayName ?? 'UNRESOLVED').padEnd(22)} ` +
    `internal=${String(row.internalName ?? 'UNKNOWN').padEnd(16)} ` +
    `key=${String(row.internalKey ?? 'UNKNOWN').padEnd(14)} ` +
    `source=${row.displayNameSource}`
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
    `${name.padEnd(42)} ${row.pass} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}


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
// HERO RESOLUTION
// ============================================================

function resolveHeroDisplayIdentity({
  row,
  localization,
  localizationSources
}) {

  const heroId =
    finite(
      row.heroId
    );


  const internalKey =
    normalizeInternalKeyRaw(
      row.internalKey
    );


  const internalName =
    row.heroName
    ??
    internalKey
    ??
    null;


  const sortToken =
    normalizeToken(
      row.sortName
    );


  const searchToken =
    normalizeToken(
      row.searchName
    );


  const steamPresenceToken =
    internalKey
      ? normalizeToken(
          `Steam_RP_hero_${internalKey}`
        )
      : null;


  const candidates =
    [
      {
        token:
          steamPresenceToken,

        source:
          'STEAM_RP_LOCALIZATION'
      },

      {
        token:
          sortToken,

        source:
          'HERO_SORT_LOCALIZATION'
      },

      {
        token:
          searchToken,

        source:
          'HERO_SEARCH_LOCALIZATION'
      }
    ];


  for (
    const candidate
    of candidates
  ) {

    if (
      !candidate.token
    ) {

      continue;
    }


    const localized =
      localization.get(
        candidate.token
      );


    if (
      !isUsableDisplayName(
        localized
      )
    ) {

      continue;
    }


    return {
      heroId,

      displayName:
        normalizeDisplayName(
          localized
        ),

      displayNameResolved:
        true,

      displayNameSource:
        candidate.source,

      displayNameToken:
        candidate.token,

      displayNameLocalizationResource:
        localizationSources.get(
          candidate.token
        )
        ??
        null,

      internalName,

      internalKey,

      sortToken:
        sortToken
          ? `#${sortToken}`
          : null,

      searchToken:
        searchToken
          ? `#${searchToken}`
          : null,

      steamPresenceToken:
        steamPresenceToken
    };
  }


  // Diagnostic search for other hero-specific localization keys.
  const relatedLocalizationCandidates =
    internalKey
      ? [
          ...localization.entries()
        ]
          .filter(
            ([
              token,
              value
            ]) =>
              token.includes(
                `hero_${internalKey}`
              )
              &&
              isUsableDisplayName(
                value
              )
          )
          .slice(
            0,
            20
          )
          .map(
            ([
              token,
              value
            ]) => ({
              token,
              value
            })
          )
      : [];


  return {
    heroId,

    displayName:
      internalName,

    displayNameResolved:
      false,

    displayNameSource:
      'INTERNAL_NAME_FALLBACK',

    displayNameToken:
      null,

    displayNameLocalizationResource:
      null,

    internalName,

    internalKey,

    sortToken:
      sortToken
        ? `#${sortToken}`
        : null,

    searchToken:
      searchToken
        ? `#${searchToken}`
        : null,

    steamPresenceToken,

    relatedLocalizationCandidates
  };
}


// ============================================================
// LOCALIZATION DISCOVERY / EXTRACTION
// ============================================================

function discoverEnglishLocalizationPaths(
  text
) {

  const paths =
    new Set();


  const normalized =
    String(
      text
    ).replace(
      /\\/g,
      '/'
    );


  const regex =
    /resource\/localization\/[A-Za-z0-9_.\-\/]*english\.txt/gi;


  for (
    const match
    of normalized.matchAll(
      regex
    )
  ) {

    paths.add(
      match[0]
    );
  }


  return [
    ...paths
  ]
    .filter(
      path =>
        /citadel/i.test(
          path
        )
    )
    .sort();
}


function tryExtractVpkTextFile({
  source2ViewerPath,
  pakPath,
  vpkResourcePath,
  temporaryDirectory
}) {

  const safeName =
    vpkResourcePath
      .replace(
        /[\\/:*?"<>|]/g,
        '_'
      );


  const desiredOutput =
    join(
      temporaryDirectory,
      safeName
    );


  const result =
    spawnSync(
      source2ViewerPath,
      [
        '--input',
        pakPath,

        '--vpk_filepath',
        vpkResourcePath,

        '--output',
        desiredOutput
      ],
      {
        encoding:
          'utf8',

        windowsHide:
          true,

        maxBuffer:
          64 *
          1024 *
          1024
      }
    );


  if (
    result.status !==
    0
  ) {

    return null;
  }


  if (
    existsSync(
      desiredOutput
    )
  ) {

    return {
      path:
        desiredOutput
    };
  }


  const basenameLower =
    vpkResourcePath
      .split(
        '/'
      )
      .pop()
      .toLowerCase();


  const found =
    findFileRecursive(
      temporaryDirectory,
      fileName =>
        fileName.toLowerCase() ===
        basenameLower
    );


  return found
    ? {
        path:
          found
      }
    : null;
}


// ============================================================
// LOCALIZATION PARSER
// ============================================================

function parseLocalizationTokens(
  text
) {

  const map =
    new Map();


  // Valve localization format generally contains:
  //
  // "TokenName" "Localized value"
  //
  // Structural entries such as "lang" { ... } do not match
  // because the second term is not quoted.

  const pairRegex =
    /"((?:\\.|[^"\\])*)"\s+"((?:\\.|[^"\\])*)"/g;


  for (
    const match
    of text.matchAll(
      pairRegex
    )
  ) {

    const token =
      normalizeToken(
        decodeEscapedString(
          match[1]
        )
      );


    const value =
      normalizeDisplayName(
        decodeEscapedString(
          match[2]
        )
      );


    if (
      !token
      ||
      !value
    ) {

      continue;
    }


    if (
      !map.has(
        token
      )
    ) {

      map.set(
        token,
        value
      );
    }
  }


  return map;
}


function decodeValveText(
  buffer
) {

  if (
    buffer.length >=
    2
    &&
    buffer[0] ===
    0xff
    &&
    buffer[1] ===
    0xfe
  ) {

    return buffer
      .subarray(
        2
      )
      .toString(
        'utf16le'
      );
  }


  if (
    buffer.length >=
    2
    &&
    buffer[0] ===
    0xfe
    &&
    buffer[1] ===
    0xff
  ) {

    const source =
      buffer.subarray(
        2
      );


    const swapped =
      Buffer.alloc(
        source.length
      );


    for (
      let index =
        0;

      index +
      1 <
        source.length;

      index +=
        2
    ) {

      swapped[index] =
        source[
          index +
          1
        ];


      swapped[
        index +
        1
      ] =
        source[
          index
        ];
    }


    return swapped.toString(
      'utf16le'
    );
  }


  // Some Valve text resources may be UTF-16LE without BOM.
  let zeroOdd =
    0;


  const sampleLength =
    Math.min(
      buffer.length,
      4096
    );


  for (
    let index =
      1;

    index <
      sampleLength;

    index +=
      2
  ) {

    if (
      buffer[index] ===
      0
    ) {

      zeroOdd++;
    }
  }


  const oddSamples =
    Math.floor(
      sampleLength /
      2
    );


  if (
    oddSamples >
    0
    &&
    zeroOdd /
    oddSamples >
    0.30
  ) {

    return buffer.toString(
      'utf16le'
    );
  }


  return buffer
    .toString(
      'utf8'
    )
    .replace(
      /^\uFEFF/,
      ''
    );
}


function decodeEscapedString(
  value
) {

  return String(
    value
  )
    .replace(
      /\\"/g,
      '"'
    )
    .replace(
      /\\\\/g,
      '\\'
    )
    .replace(
      /\\n/g,
      '\n'
    )
    .replace(
      /\\t/g,
      '\t'
    );
}


// ============================================================
// TOKEN / NAME HELPERS
// ============================================================

function normalizeToken(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const token =
    String(
      value
    )
      .trim()
      .replace(
        /^#/,
        ''
      )
      .toLowerCase();


  return token.length >
    0
      ? token
      : null;
}


function normalizeInternalKeyRaw(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  return String(
    value
  )
    .trim()
    .toLowerCase()
    .replace(
      /^(hero_|npc_dota_hero_|citadel_hero_)/,
      ''
    );
}


function normalizeDisplayName(
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


  return String(
    value
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}


function isUsableDisplayName(
  value
) {

  if (
    !value
  ) {

    return false;
  }


  const text =
    normalizeDisplayName(
      value
    );


  if (
    !text
  ) {

    return false;
  }


  if (
    text.startsWith(
      '#'
    )
  ) {

    return false;
  }


  if (
    /^hero_/i.test(
      text
    )
  ) {

    return false;
  }


  if (
    /^citadel_/i.test(
      text
    )
  ) {

    return false;
  }


  return /[A-Za-z]/.test(
    text
  );
}


// ============================================================
// FILE HELPERS
// ============================================================

function findFileRecursive(
  directory,
  predicate
) {

  for (
    const entry
    of readdirSync(
      directory,
      {
        withFileTypes:
          true
      }
    )
  ) {

    const path =
      join(
        directory,
        entry.name
      );


    if (
      entry.isDirectory()
    ) {

      const nested =
        findFileRecursive(
          path,
          predicate
        );


      if (
        nested
      ) {

        return nested;
      }


      continue;
    }


    if (
      predicate(
        entry.name,
        path
      )
    ) {

      return path;
    }
  }


  return null;
}


function sha256Buffer(
  buffer
) {

  return createHash(
    'sha256'
  )
    .update(
      buffer
    )
    .digest(
      'hex'
    );
}


// ============================================================
// GENERIC HELPERS
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
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Deadlock Hero ID → Display Name Map V02'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Identity distinction'
  );

  lines.push('');

  lines.push(
    'The numeric `heroId` is the durable telemetry join key.'
  );

  lines.push('');

  lines.push(
    'Valve internal hero identities/codenames are retained separately from the player-facing English display name.'
  );

  lines.push('');

  lines.push(
    '## Observed project heroes'
  );

  lines.push('');


  for (
    const row
    of summary.observedCrosswalk
  ) {

    lines.push(
      `- **${row.displayName ?? 'UNRESOLVED'} (${row.heroId})** — internal: ${row.internalName ?? 'UNKNOWN'} / ${row.internalKey ?? 'UNKNOWN'}`
    );
  }


  lines.push('');

  lines.push(
    '## Reporting convention'
  );

  lines.push('');

  lines.push(
    'Future console output and human-readable reports should use `Display Name (heroId)`, while machine-readable data retains `heroId`, `displayName`, and `internalKey`.'
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