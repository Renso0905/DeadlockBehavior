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
  'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_V03';


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
//   1  -> Inferno
//   2  -> Gigawatt
//   67 -> Bookworm
//   76 -> Necro
//
// These are Valve INTERNAL identities and are not necessarily
// current player-facing hero names.
//
// V02 attempted to guess flat localization file paths and failed
// because current Deadlock localization is organized beneath
// nested resource/localization subdirectories.
//
// V03:
//
//   1. extracts the ENTIRE resource/localization subtree from the
//      locally installed pak01_dir.vpk into a TEMP directory;
//
//   2. finds every English localization text file recursively;
//
//   3. builds one combined localization token map;
//
//   4. resolves each V01 internal identity to the current
//      player-facing English display name;
//
//   5. validates all hero IDs observed in Script128;
//
//   6. deletes the temporary extracted game resources.
//
// No replay parsing.
// No web-based hero-name mapping.
// No handwritten hero-name table.
//
// heroId remains the durable join key.
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
    'hero_id_display_name_map_v03.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v03.md'
  );


// ============================================================
// LOCAL DEADLOCK INSTALL CANDIDATES
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
// INPUT GUARDS
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
      'If Deadlock is installed elsewhere, set:',
      '  DEADLOCK_CITADEL_DIR=<path to game\\citadel>'
    ].join(
      '\n'
    )
  );
}


// ============================================================
// LOAD PRIOR IDENTITY SUBSTRATES
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
  'DEADLOCK HERO ID -> DISPLAY NAME MAP V0.3'
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
  'Extraction:    entire resource/localization subtree'
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
// TEMPORARY EXTRACTION DIRECTORY
// ============================================================

const temporaryDirectory =
  mkdtempSync(
    join(
      tmpdir(),
      'deadlock-hero-localization-v03-'
    )
  );


console.log(
  `Temporary extraction directory:\n${temporaryDirectory}`
);

console.log('');


// ============================================================
// EXTRACT LOCALIZATION SUBTREE
//
// Primary attempt:
//
//   -f resource/localization
//
// This mirrors Source2Viewer's supported VPK folder-filter
// behavior.
//
// If that unexpectedly yields no English files, automatically
// fall back to extracting the broader "resource" subtree.
//
// Both extractions are TEMPORARY.
// ============================================================

console.log(
  'Extracting resource/localization from Deadlock VPK...'
);


let extractionMode =
  'RESOURCE_LOCALIZATION_SUBTREE';


let extractionResult =
  extractVpkFolder({
    source2ViewerPath:
      SOURCE2VIEWER_PATH,

    pakPath,

    filter:
      'resource/localization',

    outputDirectory:
      temporaryDirectory
  });


let allExtractedFiles =
  listFilesRecursive(
    temporaryDirectory
  );


let englishFiles =
  selectEnglishLocalizationFiles(
    allExtractedFiles
  );


if (
  englishFiles.length ===
  0
) {

  console.log('');

  console.log(
    'No English localization files found from narrow extraction.'
  );

  console.log(
    'Falling back to temporary extraction of the broader resource subtree...'
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


  mkdirSync(
    temporaryDirectory,
    {
      recursive:
        true
    }
  );


  extractionMode =
    'RESOURCE_SUBTREE_FALLBACK';


  extractionResult =
    extractVpkFolder({
      source2ViewerPath:
        SOURCE2VIEWER_PATH,

      pakPath,

      filter:
        'resource',

      outputDirectory:
        temporaryDirectory
    });


  allExtractedFiles =
    listFilesRecursive(
      temporaryDirectory
    );


  englishFiles =
    selectEnglishLocalizationFiles(
      allExtractedFiles
    );
}


// ============================================================
// EXTRACTION DIAGNOSTIC
// ============================================================

console.log('');

console.log(
  'LOCALIZATION EXTRACTION'
);

console.log(
  '-----------------------'
);

console.log(
  `Mode:                  ${extractionMode}`
);

console.log(
  `CLI exit code:         ${extractionResult.status}`
);

console.log(
  `Extracted files total: ${allExtractedFiles.length}`
);

console.log(
  `English files found:   ${englishFiles.length}`
);

console.log('');


if (
  englishFiles.length ===
  0
) {

  const sampleFiles =
    allExtractedFiles.slice(
      0,
      100
    );


  const stdout =
    extractionResult.stdout
    ??
    '';


  const stderr =
    extractionResult.stderr
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
      'Localization subtree extraction completed without any recognizable English localization files.',
      '',
      `Extraction mode: ${extractionMode}`,
      `Exit code: ${extractionResult.status}`,
      '',
      'Sample extracted files:',
      ...sampleFiles.map(
        path =>
          `  ${path}`
      ),
      '',
      'STDOUT:',
      stdout.slice(
        0,
        8000
      ),
      '',
      'STDERR:',
      stderr.slice(
        0,
        8000
      )
    ].join(
      '\n'
    )
  );
}


// ============================================================
// PRINT ENGLISH FILES
// ============================================================

for (
  const path
  of englishFiles
) {

  console.log(
    `  ${relativeFromTemporary(
      temporaryDirectory,
      path
    )}`
  );
}


console.log('');


// ============================================================
// PARSE ALL ENGLISH LOCALIZATION FILES
// ============================================================

const localization =
  new Map();


const localizationSources =
  new Map();


const localizationFiles =
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


  const relativePath =
    relativeFromTemporary(
      temporaryDirectory,
      path
    );


  localizationFiles.push(
    {
      path:
        relativePath,

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
    `Parsed ${String(pairs.size).padStart(6)} tokens  ${relativePath}`
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
        relativePath
      );
    }
  }
}


console.log('');

console.log(
  `Combined unique localization tokens: ${localization.size}`
);

console.log('');


// ============================================================
// V01 HERO RECORDS
// ============================================================

const v01Records =
  Array.isArray(
    v01.records
  )
    ? v01.records
    : [];


const resolvedRecords =
  v01Records
    .map(
      row =>
        resolveHeroDisplayName({
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
// SCRIPT128 OBSERVED HERO COHORT
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


const recordById =
  new Map(
    resolvedRecords.map(
      row => [
        row.heroId,
        row
      ]
    )
  );


const observedCrosswalk =
  observedHeroIds.map(
    heroId =>
      recordById.get(
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
    resolvedRecords
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
    resolvedRecords
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


const heroIdToInternalKey =
  Object.fromEntries(
    resolvedRecords
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


const displayNameToHeroId =
  Object.fromEntries(
    resolvedRecords
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

const observedFallbacks =
  observedCrosswalk.filter(
    row =>
      row.resolutionMethod ===
      'INTERNAL_NAME_FALLBACK'
  );


const duplicateObservedDisplayNames =
  findDuplicateValues(
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
    localizationFilesExtracted:
      check(
        englishFiles.length,
        '>0',
        englishFiles.length >
        0
      ),


    localizationTokensParsed:
      check(
        localization.size,
        '>0',
        localization.size >
        0
      ),


    v01HeroRecordsPreserved:
      check(
        resolvedRecords.length,
        v01Records.length,
        resolvedRecords.length ===
        v01Records.length
      ),


    observedHeroIdsAvailable:
      check(
        observedHeroIds.length,
        31,
        observedHeroIds.length ===
        31
      ),


    allObservedHeroIdsResolved:
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
        observedFallbacks.length,
        0,
        observedFallbacks.length ===
        0
      ),


    noDuplicateObservedDisplayNames:
      check(
        duplicateObservedDisplayNames.length,
        0,
        duplicateObservedDisplayNames.length ===
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
          'LOCAL_INSTALLED_DEADLOCK_ENGLISH_LOCALIZATION',

        pakPath,

        pakBytes:
          statSync(
            pakPath
          ).size,

        source2ViewerPath:
          SOURCE2VIEWER_PATH,

        source2ViewerVersion,

        extractionMode,

        extractionFilter:
          extractionMode ===
          'RESOURCE_LOCALIZATION_SUBTREE'
            ? 'resource/localization'
            : 'resource',

        localizationFiles,

        temporaryExtractionDeleted:
          true
      },

    counts:
      {
        v01HeroRecords:
          v01Records.length,

        resolvedRecords:
          resolvedRecords.length,

        englishLocalizationFiles:
          englishFiles.length,

        combinedLocalizationTokens:
          localization.size,

        observedHeroIds:
          observedHeroIds.length,

        observedHeroIdsResolved:
          observedHeroIds.length -
          unresolvedObserved.length,

        observedHeroIdsUnresolved:
          unresolvedObserved.length,

        observedInternalFallbacks:
          observedFallbacks.length
      },

    observedCrosswalk,

    unresolvedObserved,

    duplicateObservedDisplayNames,

    heroIdToDisplayName,

    heroIdToInternalName,

    heroIdToInternalKey,

    displayNameToHeroId,

    records:
      resolvedRecords,

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

        internalKey:
          'Valve internal/codename identity used for resource joins',

        internalName:
          'Humanized Valve internal/codename identity from Script129 V01',

        displayName:
          'Current player-facing English localization resolved from the installed Deadlock build',

        reportingConvention:
          'Display Name (heroId)',

        machineReadableConvention:
          'Retain heroId, displayName, internalKey, and internalName separately.'
      },

    nextStage:
      validationPass
        ? 'RETURN_TO_SHOT_TRAVEL_CROSS_REPLAY_AUDIT_AS_SCRIPT130_WITH_DISPLAY_NAMES'
        : 'DIAGNOSE_ONLY_UNRESOLVED_HERO_LOCALIZATION_ROWS',

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
// DELETE TEMPORARY GAME RESOURCES
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
        `    score=${String(candidate.score).padStart(3)} ` +
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
// VPK EXTRACTION
// ============================================================

function extractVpkFolder({
  source2ViewerPath,
  pakPath,
  filter,
  outputDirectory
}) {

  return spawnSync(
    source2ViewerPath,
    [
      '--input',
      pakPath,

      '--vpk_filepath',
      filter,

      '--vpk_decompile',

      '--output',
      outputDirectory,

      '--threads',
      '4'
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
}


// ============================================================
// HERO DISPLAY-NAME RESOLUTION
// ============================================================

function resolveHeroDisplayName({
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


  const directCandidates =
    [
      {
        token:
          internalKey
            ? `steam_rp_hero_${internalKey}`
            : null,

        method:
          'STEAM_RP_HERO_TOKEN'
      },

      {
        token:
          sortToken,

        method:
          'HERO_SORT_TOKEN'
      },

      {
        token:
          searchToken,

        method:
          'HERO_SEARCH_TOKEN'
      },

      {
        token:
          internalKey
            ? `hero_${internalKey}_name`
            : null,

        method:
          'HERO_NAME_TOKEN'
      },

      {
        token:
          internalKey
            ? `citadel_hero_${internalKey}_name`
            : null,

        method:
          'CITADEL_HERO_NAME_TOKEN'
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
      !isPlausibleHeroDisplayName(
        value
      )
    ) {

      continue;
    }


    return {
      heroId,

      displayName:
        cleanDisplayName(
          value
        ),

      displayNameResolved:
        true,

      resolutionMethod:
        candidate.method,

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


  // ----------------------------------------------------------
  // FALLBACK DISCOVERY
  //
  // Search localization tokens related to the internal key.
  // This remains local-resource evidence.
  //
  // We score likely HERO-NAME tokens substantially above generic
  // descriptions, ability names, search keywords, etc.
  // ----------------------------------------------------------

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
        !isPlausibleHeroDisplayName(
          value
        )
      ) {

        continue;
      }


      const score =
        scoreHeroLocalizationCandidate({
          token,
          value,
          internalKey,
          internalName
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
            cleanDisplayName(
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


  // Require a reasonably hero-name-like token. Do not silently
  // accept an arbitrary localization value merely because it
  // contains the internal key.
  if (
    best
    &&
    best.score >=
    70
  ) {

    return {
      heroId,

      displayName:
        best.value,

      displayNameResolved:
        true,

      resolutionMethod:
        'RELATED_LOCALIZATION_TOKEN',

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
// LOCALIZATION CANDIDATE SCORING
// ============================================================

function scoreHeroLocalizationCandidate({
  token,
  value,
  internalKey,
  internalName
}) {

  let score =
    0;


  if (
    token ===
    `steam_rp_hero_${internalKey}`
  ) {

    score +=
      200;
  }


  if (
    token.includes(
      'hero_name'
    )
    ||
    token.includes(
      'heroname'
    )
  ) {

    score +=
      120;
  }


  if (
    token.includes(
      'gc_hero'
    )
    &&
    token.includes(
      'name'
    )
  ) {

    score +=
      110;
  }


  if (
    token.startsWith(
      'hero_'
    )
    &&
    token.endsWith(
      '_name'
    )
  ) {

    score +=
      100;
  }


  if (
    token.startsWith(
      'steam_rp_hero_'
    )
  ) {

    score +=
      100;
  }


  if (
    token.includes(
      internalKey
    )
  ) {

    score +=
      25;
  }


  if (
    token.includes(
      'sort'
    )
  ) {

    score +=
      60;
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
      'description'
    )
    ||
    token.includes(
      'desc'
    )
    ||
    token.includes(
      'ability'
    )
    ||
    token.includes(
      'tooltip'
    )
    ||
    token.includes(
      'lore'
    )
  ) {

    score -=
      100;
  }


  const clean =
    cleanDisplayName(
      value
    );


  const wordCount =
    clean
      .split(
        /\s+/
      )
      .filter(
        Boolean
      )
      .length;


  if (
    wordCount >=
    1
    &&
    wordCount <=
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


  if (
    internalName
    &&
    clean.toLowerCase() ===
    String(
      internalName
    ).toLowerCase()
  ) {

    // Internal-name equality is not proof of failure because
    // some heroes legitimately use the same internal/display
    // identity (e.g. Viscous, Haze, Dynamo).
    score +=
      5;
  }


  return score;
}


// ============================================================
// LOCALIZATION FILE DISCOVERY
// ============================================================

function selectEnglishLocalizationFiles(
  files
) {

  return files
    .filter(
      path => {

        const normalized =
          path
            .replace(
              /\\/g,
              '/'
            )
            .toLowerCase();


        if (
          !normalized.includes(
            '/resource/localization/'
          )
          &&
          !normalized.includes(
            '/localization/'
          )
        ) {

          return false;
        }


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
    )
    .sort(
      (
        a,
        b
      ) => {

        const aPriority =
          localizationPathPriority(
            a
          );


        const bPriority =
          localizationPathPriority(
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
}


function localizationPathPriority(
  path
) {

  const lower =
    path.toLowerCase();


  if (
    lower.includes(
      'citadel_gc_hero_names'
    )
  ) {

    return 0;
  }


  if (
    lower.includes(
      'citadel_gc'
    )
  ) {

    return 1;
  }


  if (
    lower.includes(
      'citadel_heroes'
    )
  ) {

    return 2;
  }


  if (
    lower.includes(
      'citadel_main'
    )
  ) {

    return 3;
  }


  return 10;
}


// ============================================================
// VALVE LOCALIZATION PARSER
// ============================================================

function parseLocalizationTokens(
  text
) {

  const output =
    new Map();


  const regex =
    /"((?:\\.|[^"\\])*)"\s+"((?:\\.|[^"\\])*)"/g;


  for (
    const match
    of text.matchAll(
      regex
    )
  ) {

    const token =
      normalizeToken(
        decodeEscapedString(
          match[1]
        )
      );


    const value =
      cleanDisplayName(
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
      !output.has(
        token
      )
    ) {

      output.set(
        token,
        value
      );
    }
  }


  return output;
}


// ============================================================
// ENCODING
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

      swapped[
        index
      ] =
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
      buffer[
        index
      ] ===
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
// NAME / TOKEN HELPERS
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


function cleanDisplayName(
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


function isPlausibleHeroDisplayName(
  value
) {

  if (
    !value
  ) {

    return false;
  }


  const text =
    cleanDisplayName(
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


function relativeFromTemporary(
  root,
  path
) {

  const normalizedRoot =
    resolve(
      root
    );


  const normalizedPath =
    resolve(
      path
    );


  let relative =
    normalizedPath.slice(
      normalizedRoot.length
    );


  relative =
    relative.replace(
      /^[\\/]+/,
      ''
    );


  return relative.replace(
    /\\/g,
    '/'
  );
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


function findDuplicateValues(
  values
) {

  const counts =
    new Map();


  for (
    const value
    of values
  ) {

    counts.set(
      value,
      (
        counts.get(
          value
        )
        ??
        0
      ) +
      1
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
    '# Deadlock Hero ID → Display Name Map V03'
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
    '- Installed local Deadlock `pak01_dir.vpk`.'
  );

  lines.push(
    '- English files extracted temporarily from the `resource/localization` subtree with Source2Viewer.'
  );

  lines.push(
    '- Temporary extracted localization resources are deleted after parsing.'
  );

  lines.push('');

  lines.push(
    '## Identity semantics'
  );

  lines.push('');

  lines.push(
    '- `heroId`: durable telemetry join key.'
  );

  lines.push(
    '- `internalKey`: Valve internal/codename identity.'
  );

  lines.push(
    '- `internalName`: human-readable internal identity.'
  );

  lines.push(
    '- `displayName`: current English player-facing localization.'
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
      `- **${row.displayName ?? 'UNRESOLVED'} (${row.heroId})** — internal=${row.internalName ?? 'UNKNOWN'}, key=${row.internalKey ?? 'UNKNOWN'}, method=${row.resolutionMethod}`
    );
  }


  lines.push('');

  lines.push(
    '## Reporting convention'
  );

  lines.push('');

  lines.push(
    'Future reports should display `Display Name (heroId)` while retaining the numeric ID and internal key in machine-readable data.'
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