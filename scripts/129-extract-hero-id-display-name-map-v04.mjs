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
  'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_V04';


// ============================================================
// PURPOSE
//
// Script129 V01 correctly established:
//
//   heroId
//   internalKey
//   internal/codename identity
//
// Examples:
//
//   inferno
//   gigawatt
//   ghost
//   bookworm
//   necro
//
// V02/V03 did NOT successfully resolve current player-facing
// names because they filtered too narrowly at:
//
//   resource/localization
//
// before Source2Viewer decompilation.
//
// Known Deadlock extraction workflows instead decompile:
//
//   -f resource
//
// and only THEN consume generated nested directories:
//
//   resource/localization/citadel_gc/
//   resource/localization/citadel_heroes/
//   resource/localization/citadel_main/
//   resource/localization/citadel_gc_hero_names/
//   ...
//
// V04 follows that model exactly.
//
// No replay parsing.
// No web-derived name table.
// No handwritten hero-name mapping.
//
// heroId remains the durable telemetry join key.
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


const SCRIPT128_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_specific_shot_travel_candidate_models_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v04.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v04.md'
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


if (
  !existsSync(
    SCRIPT128_PATH
  )
) {

  throw new Error(
    `Script128 output not found:\n${SCRIPT128_PATH}`
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
// LOAD SCRIPT128 HERO COHORT
// ============================================================

const script128 =
  JSON.parse(
    readFileSync(
      SCRIPT128_PATH,
      'utf8'
    )
  );


if (
  script128?.status !==
  'HERO_SPECIFIC_SHOT_TRAVEL_CANDIDATE_MODELS_READY_FOR_INTERPRETATION'
) {

  throw new Error(
    `Script128 not ready. Status=${script128?.status}`
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
  'DEADLOCK HERO ID -> DISPLAY NAME MAP V0.4'
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
  'VPK filter:    resource'
);

console.log(
  'Identity base: Script129 V01'
);

console.log(
  'Replay parse:  NONE'
);

console.log(
  'Web name map:  NONE'
);

console.log(
  'Hardcoded map: NONE'
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
// TEMPORARY RESOURCE EXTRACTION
// ============================================================

const temporaryDirectory =
  mkdtempSync(
    join(
      tmpdir(),
      'deadlock-resource-v04-'
    )
  );


console.log(
  `Temporary extraction:\n${temporaryDirectory}`
);

console.log('');

console.log(
  'Decompiling Deadlock resource subtree...'
);


const extraction =
  spawnSync(
    SOURCE2VIEWER_PATH,
    [
      '--input',
      pakPath,

      '--vpk_decompile',

      '--threads',
      '4',

      '--output',
      temporaryDirectory,

      '--vpk_filepath',
      'resource'
    ],
    {
      encoding:
        'utf8',

      windowsHide:
        true,

      maxBuffer:
        256 *
        1024 *
        1024
    }
  );


if (
  extraction.status !==
  0
) {

  const stdout =
    extraction.stdout
    ??
    '';


  const stderr =
    extraction.stderr
    ??
    '';


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
      'Source2Viewer resource extraction failed.',
      '',
      `Exit code: ${extraction.status}`,
      '',
      'STDOUT:',
      stdout.slice(
        0,
        12000
      ),
      '',
      'STDERR:',
      stderr.slice(
        0,
        12000
      )
    ].join(
      '\n'
    )
  );
}


// ============================================================
// DISCOVER OUTPUT FILES
// ============================================================

const allFiles =
  listFilesRecursive(
    temporaryDirectory
  );


const localizationFilesAll =
  allFiles.filter(
    path =>
      normalizePath(
        path
      ).includes(
        '/resource/localization/'
      )
  );


const englishFiles =
  localizationFilesAll
    .filter(
      isEnglishLocalizationFile
    )
    .sort(
      (
        a,
        b
      ) => {

        const aPriority =
          localizationPriority(
            a
          );


        const bPriority =
          localizationPriority(
            b
          );


        return aPriority -
          bPriority
          ||
          a.localeCompare(
            b
          );
      }
    );


console.log('');

console.log(
  'RESOURCE EXTRACTION'
);

console.log(
  '-------------------'
);

console.log(
  `Extracted files total:       ${allFiles.length}`
);

console.log(
  `Localization files total:    ${localizationFilesAll.length}`
);

console.log(
  `English localization files:  ${englishFiles.length}`
);

console.log('');


// ============================================================
// PRINT LOCALIZATION DIRECTORY BREAKDOWN
// ============================================================

const localizationDirectoryCounts =
  new Map();


for (
  const path
  of localizationFilesAll
) {

  const relative =
    relativeFromRoot(
      temporaryDirectory,
      path
    );


  const normalized =
    relative.replace(
      /\\/g,
      '/'
    );


  const parts =
    normalized.split(
      '/'
    );


  const localizationIndex =
    parts.findIndex(
      part =>
        part.toLowerCase() ===
        'localization'
    );


  const group =
    localizationIndex >=
    0
    &&
    parts[
      localizationIndex +
      1
    ]
      ? parts[
          localizationIndex +
          1
        ]
      : 'ROOT';


  increment(
    localizationDirectoryCounts,
    group
  );
}


console.log(
  'LOCALIZATION GROUPS'
);

console.log(
  '-------------------'
);


for (
  const [
    group,
    count
  ]
  of [
    ...localizationDirectoryCounts.entries()
  ]
    .sort(
      (
        a,
        b
      ) =>
        b[1] -
        a[1]
    )
) {

  console.log(
    `${String(count).padStart(5)}  ${group}`
  );
}


console.log('');


// ============================================================
// ENGLISH FILES
// ============================================================

if (
  englishFiles.length ===
  0
) {

  const sample =
    localizationFilesAll.slice(
      0,
      100
    );


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
      'No English localization files were generated after full resource extraction.',
      '',
      'Sample localization files:',
      ...sample.map(
        path =>
          `  ${path}`
      )
    ].join(
      '\n'
    )
  );
}


console.log(
  'ENGLISH LOCALIZATION FILES'
);

console.log(
  '--------------------------'
);


for (
  const path
  of englishFiles
) {

  console.log(
    `  ${relativeFromRoot(
      temporaryDirectory,
      path
    )}`
  );
}


console.log('');


// ============================================================
// BUILD COMBINED LOCALIZATION TOKEN MAP
// ============================================================

const localization =
  new Map();


const localizationSources =
  new Map();


const localizationFileMetadata =
  [];


for (
  const path
  of englishFiles
) {

  const buffer =
    readFileSync(
      path
    );


  const text =
    decodeValveText(
      buffer
    );


  const pairs =
    parseLocalizationTokens(
      text
    );


  const relative =
    relativeFromRoot(
      temporaryDirectory,
      path
    );


  localizationFileMetadata.push(
    {
      path:
        relative,

      bytes:
        buffer.length,

      sha256:
        sha256Buffer(
          buffer
        ),

      parsedTokens:
        pairs.size
    }
  );


  console.log(
    `Parsed ${String(pairs.size).padStart(6)} tokens  ${relative}`
  );


  for (
    const [
      token,
      value
    ]
    of pairs
  ) {

    if (
      !localization.has(
        token
      )
    ) {

      localization.set(
        token,
        value
      );


      localizationSources.set(
        token,
        relative
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
// DIAGNOSTIC: STEAM_RP HERO TOKENS
// ============================================================

const steamHeroTokens =
  [
    ...localization.entries()
  ]
    .filter(
      ([
        token
      ]) =>
        token.startsWith(
          'steam_rp_hero_'
        )
    )
    .sort(
      (
        a,
        b
      ) =>
        a[0].localeCompare(
          b[0]
        )
    );


console.log(
  `Steam_RP hero-name tokens: ${steamHeroTokens.length}`
);

console.log('');


// ============================================================
// RESOLVE ALL V01 HERO RECORDS
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
        resolveHeroIdentity({
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
// OBSERVED SCRIPT128 HERO IDS
// ============================================================

const observedHeroIds =
  [
    ...new Set(
      (
        script128.heroModels
        ??
        []
      )
        .map(
          row =>
            finite(
              row?.heroId
            )
        )
        .filter(
          Number.isFinite
        )
    )
  ]
    .sort(
      (
        a,
        b
      ) =>
        a -
        b
    );


const recordByHeroId =
  new Map(
    records.map(
      row => [
        row.heroId,
        row
      ]
    )
  );


const observedCrosswalk =
  observedHeroIds.map(
    heroId =>
      recordByHeroId.get(
        heroId
      )
      ??
      {
        heroId,

        displayName:
          null,

        displayNameResolved:
          false,

        internalName:
          null,

        internalKey:
          null,

        localizationToken:
          null,

        localizationSource:
          null,

        resolutionMethod:
          'HERO_ID_NOT_FOUND'
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
// LOOKUP OBJECTS
// ============================================================

const heroIdToDisplayName =
  Object.fromEntries(
    records
      .filter(
        row =>
          row.displayNameResolved
          &&
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


const heroIdToInternalKey =
  Object.fromEntries(
    records
      .filter(
        row =>
          row.internalKey
      )
      .map(
        row => [
          String(
            row.heroId
          ),

          row.internalKey
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
          row.displayNameResolved
          &&
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

const observedInternalFallbacks =
  observedCrosswalk.filter(
    row =>
      row.resolutionMethod ===
      'INTERNAL_NAME_FALLBACK'
  );


const duplicateDisplayNames =
  findDuplicates(
    observedCrosswalk
      .filter(
        row =>
          row.displayNameResolved
          &&
          row.displayName
      )
      .map(
        row =>
          row.displayName
      )
  );


const validationChecks =
  {
    resourceExtractionProducedFiles:
      check(
        allFiles.length,
        '>0',
        allFiles.length >
        0
      ),


    localizationTreePresent:
      check(
        localizationFilesAll.length,
        '>0',
        localizationFilesAll.length >
        0
      ),


    englishLocalizationAvailable:
      check(
        englishFiles.length,
        '>0',
        englishFiles.length >
        0
      ),


    localizationTokensParsed:
      check(
        localization.size,
        '>100',
        localization.size >
        100
      ),


    steamHeroTokensAvailable:
      check(
        steamHeroTokens.length,
        '>0',
        steamHeroTokens.length >
        0
      ),


    v01HeroRecordsPreserved:
      check(
        records.length,
        v01Records.length,
        records.length ===
        v01Records.length
      ),


    observedHeroCohortPreserved:
      check(
        observedHeroIds.length,
        31,
        observedHeroIds.length ===
        31
      ),


    everyObservedHeroDisplayNameResolved:
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
        observedInternalFallbacks.length,
        0,
        observedInternalFallbacks.length ===
        0
      ),


    noDuplicateObservedDisplayNames:
      check(
        duplicateDisplayNames.length,
        0,
        duplicateDisplayNames.length ===
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
          'LOCAL_DEADLOCK_RESOURCE_SUBTREE_DECOMPILE',

        pakPath,

        pakBytes:
          statSync(
            pakPath
          ).size,

        vpkFilter:
          'resource',

        source2ViewerPath:
          SOURCE2VIEWER_PATH,

        source2ViewerVersion,

        temporaryExtractionDeleted:
          true,

        localizationFiles:
          localizationFileMetadata
      },

    counts:
      {
        extractedFiles:
          allFiles.length,

        localizationFiles:
          localizationFilesAll.length,

        englishLocalizationFiles:
          englishFiles.length,

        localizationTokens:
          localization.size,

        steamHeroTokens:
          steamHeroTokens.length,

        v01HeroRecords:
          v01Records.length,

        observedHeroIds:
          observedHeroIds.length,

        observedResolved:
          observedHeroIds.length -
          unresolvedObserved.length,

        observedUnresolved:
          unresolvedObserved.length
      },

    observedCrosswalk,

    unresolvedObserved,

    duplicateDisplayNames,

    heroIdToDisplayName,

    heroIdToInternalKey,

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
        heroId:
          'Durable replay/resource join key.',

        internalKey:
          'Valve internal hero identifier/codename used for resource joins.',

        internalName:
          'Humanized internal/codename identity retained from Script129 V01.',

        displayName:
          'Current English player-facing hero name resolved from installed Deadlock localization.',

        reportingConvention:
          'Display Name (heroId)',

        machineReadableConvention:
          'Retain heroId, displayName, internalKey, and internalName separately.'
      },

    nextStage:
      validationPass
        ? 'RETURN_TO_SHOT_TRAVEL_AUDIT_AS_SCRIPT130_USING_DISPLAY_NAME_HERO_ID'
        : 'DIAGNOSE_ONLY_UNRESOLVED_HERO_DISPLAY_NAMES',

    outputs:
      {
        json:
          OUTPUT_JSON_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE OUTPUTS
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
// CLEAN TEMPORARY RESOURCE EXTRACTION
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

console.log('');

console.log(
  '========================================================'
);

console.log(
  'OBSERVED HERO DISPLAY-NAME CROSSWALK'
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
    `${String(row.displayName ?? 'UNRESOLVED').padEnd(24)} ` +
    `internal=${String(row.internalName ?? 'UNKNOWN').padEnd(16)} ` +
    `key=${String(row.internalKey ?? 'UNKNOWN').padEnd(14)} ` +
    `method=${row.resolutionMethod}`
  );
}


if (
  unresolvedObserved.length >
  0
) {

  console.log('');

  console.log(
    'UNRESOLVED OBSERVED HEROES'
  );

  console.log(
    '--------------------------'
  );


  for (
    const row
    of unresolvedObserved
  ) {

    console.log(
      `heroId=${row.heroId} ` +
      `internal=${row.internalName ?? 'UNKNOWN'} ` +
      `key=${row.internalKey ?? 'UNKNOWN'}`
    );


    for (
      const candidate
      of row.relatedLocalizationCandidates
      ??
      []
    ) {

      console.log(
        `    score=${String(candidate.score).padStart(4)} ` +
        `token=${candidate.token} ` +
        `value=${JSON.stringify(candidate.value)}`
      );
    }
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
    `${name.padEnd(46)} ${row.pass} ` +
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

function resolveHeroIdentity({
  row,
  localization,
  localizationSources
}) {

  const heroId =
    finite(
      row.heroId
    );


  const internalKey =
    normalizeInternalKey(
      row.internalKey
    );


  const internalName =
    row.heroName
    ??
    humanizeInternalKey(
      internalKey
    )
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


  // Highest-confidence mapping:
  //
  // Steam_RP_hero_<internalKey>
  //
  // This is explicitly designed to convert an internal hero
  // identifier into the user-facing name.
  const directCandidates =
    [
      {
        token:
          internalKey
            ? `steam_rp_hero_${internalKey}`
            : null,

        method:
          'STEAM_RP_HERO_TOKEN',

        confidence:
          'HIGH'
      },

      {
        token:
          sortToken,

        method:
          'HERO_SORT_TOKEN',

        confidence:
          'HIGH'
      },

      {
        token:
          searchToken,

        method:
          'HERO_SEARCH_TOKEN',

        confidence:
          'HIGH'
      },

      {
        token:
          internalKey
            ? `hero_${internalKey}_name`
            : null,

        method:
          'HERO_NAME_TOKEN',

        confidence:
          'HIGH'
      },

      {
        token:
          internalKey
            ? `citadel_hero_${internalKey}_name`
            : null,

        method:
          'CITADEL_HERO_NAME_TOKEN',

        confidence:
          'HIGH'
      }
    ];


  for (
    const candidate
    of directCandidates
  ) {

    if (
      !candidate.token
    ) {

      continue;
    }


    const value =
      localization.get(
        candidate.token
      );


    if (
      !isPlausibleHeroName(
        value
      )
    ) {

      continue;
    }


    return {
      heroId,

      displayName:
        cleanName(
          value
        ),

      displayNameResolved:
        true,

      resolutionMethod:
        candidate.method,

      resolutionConfidence:
        candidate.confidence,

      localizationToken:
        candidate.token,

      localizationSource:
        localizationSources.get(
          candidate.token
        )
        ??
        null,

      internalName,

      internalKey,

      originalSortToken:
        sortToken,

      originalSearchToken:
        searchToken,

      relatedLocalizationCandidates:
        []
    };
  }


  // ==========================================================
  // FALLBACK LOCALIZATION DISCOVERY
  //
  // Still only uses local localization evidence.
  // ==========================================================

  const related =
    [];


  if (
    internalKey
  ) {

    for (
      const [
        token,
        value
      ]
      of localization
    ) {

      if (
        !token.includes(
          internalKey
        )
      ) {

        continue;
      }


      if (
        !isPlausibleHeroName(
          value
        )
      ) {

        continue;
      }


      const score =
        scoreCandidate({
          token,
          value,
          internalKey
        });


      if (
        score <=
        0
      ) {

        continue;
      }


      related.push(
        {
          token,

          value:
            cleanName(
              value
            ),

          score,

          source:
            localizationSources.get(
              token
            )
            ??
            null
        }
      );
    }
  }


  related.sort(
    (
      a,
      b
    ) =>
      b.score -
      a.score
      ||
      a.token.localeCompare(
        b.token
      )
  );


  const best =
    related[0]
    ??
    null;


  if (
    best
    &&
    best.score >=
    80
  ) {

    return {
      heroId,

      displayName:
        best.value,

      displayNameResolved:
        true,

      resolutionMethod:
        'RELATED_LOCALIZATION_TOKEN',

      resolutionConfidence:
        'MODERATE',

      localizationToken:
        best.token,

      localizationSource:
        best.source,

      internalName,

      internalKey,

      originalSortToken:
        sortToken,

      originalSearchToken:
        searchToken,

      relatedLocalizationCandidates:
        related.slice(
          0,
          20
        )
    };
  }


  return {
    heroId,

    displayName:
      internalName,

    displayNameResolved:
      false,

    resolutionMethod:
      'INTERNAL_NAME_FALLBACK',

    resolutionConfidence:
      'UNRESOLVED',

    localizationToken:
      null,

    localizationSource:
      null,

    internalName,

    internalKey,

    originalSortToken:
      sortToken,

    originalSearchToken:
      searchToken,

    relatedLocalizationCandidates:
      related.slice(
        0,
        20
      )
  };
}


// ============================================================
// LOCALIZATION FALLBACK SCORING
// ============================================================

function scoreCandidate({
  token,
  value,
  internalKey
}) {

  let score =
    0;


  if (
    token ===
    `steam_rp_hero_${internalKey}`
  ) {

    score +=
      300;
  }


  if (
    token.includes(
      'hero'
    )
  ) {

    score +=
      20;
  }


  if (
    token.includes(
      'name'
    )
  ) {

    score +=
      80;
  }


  if (
    token.includes(
      'sort'
    )
  ) {

    score +=
      70;
  }


  if (
    token.includes(
      'search'
    )
  ) {

    score +=
      40;
  }


  if (
    token.includes(
      internalKey
    )
  ) {

    score +=
      30;
  }


  if (
    token.includes(
      'description'
    )
    ||
    token.includes(
      'tooltip'
    )
    ||
    token.includes(
      'ability'
    )
    ||
    token.includes(
      'lore'
    )
    ||
    token.includes(
      'upgrade'
    )
  ) {

    score -=
      150;
  }


  const clean =
    cleanName(
      value
    );


  const words =
    clean
      .split(
        /\s+/
      )
      .filter(
        Boolean
      );


  if (
    words.length >=
    1
    &&
    words.length <=
    4
  ) {

    score +=
      20;
  }


  if (
    clean.length <=
    30
  ) {

    score +=
      10;
  }


  return score;
}


// ============================================================
// LOCALIZATION FILE DETECTION
// ============================================================

function isEnglishLocalizationFile(
  path
) {

  const normalized =
    normalizePath(
      path
    );


  const fileName =
    normalized
      .split(
        '/'
      )
      .pop();


  return (
    fileName.endsWith(
      '_english.txt'
    )
    ||
    fileName ===
    'english.txt'
  );
}


function localizationPriority(
  path
) {

  const normalized =
    normalizePath(
      path
    );


  if (
    normalized.includes(
      '/citadel_gc_hero_names/'
    )
  ) {

    return 0;
  }


  if (
    normalized.includes(
      '/citadel_gc/'
    )
  ) {

    return 1;
  }


  if (
    normalized.includes(
      '/citadel_heroes/'
    )
  ) {

    return 2;
  }


  if (
    normalized.includes(
      '/citadel_main/'
    )
  ) {

    return 3;
  }


  if (
    normalized.includes(
      '/citadel_attributes/'
    )
  ) {

    return 4;
  }


  if (
    normalized.includes(
      '/citadel_mods/'
    )
  ) {

    return 5;
  }


  return 20;
}


// ============================================================
// VALVE LOCALIZATION PARSER
// ============================================================

function parseLocalizationTokens(
  text
) {

  const map =
    new Map();


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
      cleanName(
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


// ============================================================
// TEXT ENCODING
// ============================================================

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
        source[index];
    }


    return swapped.toString(
      'utf16le'
    );
  }


  // Detect UTF-16LE without BOM.
  const sampleLength =
    Math.min(
      buffer.length,
      4096
    );


  let oddZeroCount =
    0;


  let oddSamples =
    0;


  for (
    let index =
      1;

    index <
      sampleLength;

    index +=
      2
  ) {

    oddSamples++;


    if (
      buffer[index] ===
      0
    ) {

      oddZeroCount++;
    }
  }


  if (
    oddSamples >
    0
    &&
    oddZeroCount /
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
// FILE HELPERS
// ============================================================

function listFilesRecursive(
  directory
) {

  if (
    !existsSync(
      directory
    )
  ) {

    return [];
  }


  const result =
    [];


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

      result.push(
        ...listFilesRecursive(
          path
        )
      );

    } else {

      result.push(
        path
      );
    }
  }


  return result;
}


function relativeFromRoot(
  root,
  path
) {

  const fullRoot =
    resolve(
      root
    );


  const fullPath =
    resolve(
      path
    );


  return fullPath
    .slice(
      fullRoot.length
    )
    .replace(
      /^[\\/]+/,
      ''
    )
    .replace(
      /\\/g,
      '/'
    );
}


function normalizePath(
  path
) {

  return String(
    path
  )
    .replace(
      /\\/g,
      '/'
    )
    .toLowerCase();
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
// NAME HELPERS
// ============================================================

function normalizeToken(
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


function normalizeInternalKey(
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


function humanizeInternalKey(
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
    .split(
      '_'
    )
    .filter(
      Boolean
    )
    .map(
      token =>
        token.length >
        0
          ? token[0].toUpperCase() +
            token.slice(
              1
            )
          : token
    )
    .join(
      ' '
    );
}


function cleanName(
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


function isPlausibleHeroName(
  value
) {

  if (
    !value
  ) {

    return false;
  }


  const text =
    cleanName(
      value
    );


  if (
    !text
    ||
    text.startsWith(
      '#'
    )
    ||
    text.includes(
      '%'
    )
    ||
    text.includes(
      '{'
    )
    ||
    text.includes(
      '}'
    )
  ) {

    return false;
  }


  if (
    text.length >
    50
  ) {

    return false;
  }


  const words =
    text
      .split(
        /\s+/
      )
      .filter(
        Boolean
      );


  if (
    words.length >
    6
  ) {

    return false;
  }


  return /[A-Za-z]/.test(
    text
  );
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
    ) +
    1
  );
}


function findDuplicates(
  values
) {

  const counts =
    new Map();


  for (
    const value
    of values
  ) {

    increment(
      counts,
      value
    );
  }


  return [
    ...counts.entries()
  ]
    .filter(
      ([
        ,
        count
      ]) =>
        count >
        1
    )
    .map(
      ([
        value,
        count
      ]) => ({
        value,
        count
      })
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
    '# Deadlock Hero ID → Display Name Map V04'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Source'
  );

  lines.push('');

  lines.push(
    '- Local installed Deadlock `pak01_dir.vpk`.'
  );

  lines.push(
    '- Entire `resource` subtree temporarily decompiled with Source2Viewer.'
  );

  lines.push(
    '- English localization files discovered recursively after decompilation.'
  );

  lines.push(
    '- Temporary extracted resources deleted after parsing.'
  );

  lines.push('');

  lines.push(
    '## Identity semantics'
  );

  lines.push('');

  lines.push(
    '- `heroId` = durable telemetry join key.'
  );

  lines.push(
    '- `internalKey` = Valve internal/codename resource identity.'
  );

  lines.push(
    '- `internalName` = human-readable internal identity.'
  );

  lines.push(
    '- `displayName` = current player-facing English localization.'
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
      `- **${row.displayName ?? 'UNRESOLVED'} (${row.heroId})** — internal=${row.internalName ?? 'UNKNOWN'}, key=${row.internalKey ?? 'UNKNOWN'}, source=${row.localizationToken ?? 'UNRESOLVED'}`
    );
  }


  lines.push('');

  lines.push(
    '## Reporting convention'
  );

  lines.push('');

  lines.push(
    'All future human-readable analyses should use `Display Name (heroId)` while preserving the numeric ID and internal key in machine-readable output.'
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