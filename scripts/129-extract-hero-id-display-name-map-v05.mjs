import {
  createHash
} from 'node:crypto';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_V05';


// ============================================================
// PURPOSE
//
// Script129 V01 successfully established hero identity from the
// locally installed Deadlock build:
//
//   heroId -> internalKey
//
// Examples:
//
//   1  -> inferno
//   2  -> gigawatt
//   67 -> bookworm
//   76 -> necro
//
// V02-V04 attempted to resolve player-facing names from the
// local pak01_dir.vpk localization subtree.
//
// Those attempts showed that the user's local pak01_dir.vpk does
// NOT contain the full English hero-name localization substrate.
//
// V05 therefore combines:
//
//   LOCAL BUILD:
//     heroId -> internalKey
//
// with a PINNED Deadlock asset localization snapshot:
//
//     internalKey -> English display name
//
// using tokens:
//
//     Steam_RP_hero_<internalKey>
//
// Example:
//
//     67
//       -> bookworm
//       -> Steam_RP_hero_bookworm
//       -> Paige
//
// The external localization source is PINNED TO A COMMIT.
// We do not use "main", a wiki, or a handwritten name table.
//
// heroId remains the durable join key.
//
// No replay parsing.
// No mechanic inference.
// ============================================================


// ============================================================
// PINNED LOCALIZATION SOURCE
// ============================================================

const LOCALIZATION_REPOSITORY =
  'deadlock-api/deadlock-api-assets';


const LOCALIZATION_COMMIT =
  'a23d360ef589f87c4d8b141f30d33752643994ca';


const LOCALIZATION_PATH =
  'res/localization/citadel_gc_english.json';


const LOCALIZATION_RAW_URL =
  (
    'https://raw.githubusercontent.com/' +
    LOCALIZATION_REPOSITORY +
    '/' +
    LOCALIZATION_COMMIT +
    '/' +
    LOCALIZATION_PATH
  );


// ============================================================
// INPUTS
// ============================================================

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


// ============================================================
// OUTPUTS
// ============================================================

const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v05.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_display_name_map_v05.md'
  );


// ============================================================
// INPUT GUARDS
// ============================================================

if (
  !existsSync(
    V01_PATH
  )
) {

  throw new Error(
    `Missing Script129 V01 output:\n${V01_PATH}`
  );
}


if (
  !existsSync(
    SCRIPT128_PATH
  )
) {

  throw new Error(
    `Missing Script128 output:\n${SCRIPT128_PATH}`
  );
}


// ============================================================
// LOAD LOCAL IDENTITY MAP
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
    `Script129 V01 is not ready. Status=${v01?.status}`
  );
}


// ============================================================
// LOAD OBSERVED HERO COHORT
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
    `Script128 is not ready. Status=${script128?.status}`
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
  'DEADLOCK HERO ID -> DISPLAY NAME MAP V0.5'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'Hero ID source:      local installed Deadlock build / V01'
);

console.log(
  'Display-name source: pinned English localization snapshot'
);

console.log(
  `Repository:          ${LOCALIZATION_REPOSITORY}`
);

console.log(
  `Commit:              ${LOCALIZATION_COMMIT}`
);

console.log(
  `Path:                ${LOCALIZATION_PATH}`
);

console.log(
  'Replay parsing:      NONE'
);

console.log(
  'Hardcoded name map:  NONE'
);

console.log('');


// ============================================================
// DOWNLOAD PINNED LOCALIZATION
// ============================================================

console.log(
  'Downloading pinned English hero localization...'
);


const response =
  await fetch(
    LOCALIZATION_RAW_URL,
    {
      headers:
        {
          'User-Agent':
            'DeadlockBehavior-hero-name-map-v05'
        }
    }
  );


if (
  !response.ok
) {

  throw new Error(
    [
      'Failed to download pinned localization source.',
      '',
      `HTTP status: ${response.status}`,
      `URL: ${LOCALIZATION_RAW_URL}`
    ].join(
      '\n'
    )
  );
}


const localizationText =
  await response.text();


const localizationSha256 =
  createHash(
    'sha256'
  )
    .update(
      localizationText,
      'utf8'
    )
    .digest(
      'hex'
    );


console.log(
  `Downloaded bytes:    ${Buffer.byteLength(localizationText, 'utf8')}`
);

console.log(
  `Localization SHA256: ${localizationSha256}`
);

console.log('');


// ============================================================
// PARSE LOCALIZATION JSON
// ============================================================

let localizationJson;


try {

  localizationJson =
    JSON.parse(
      localizationText
    );

} catch (
  error
) {

  throw new Error(
    `Pinned localization JSON could not be parsed:\n${error.message}`
  );
}


const tokens =
  localizationJson
    ?.lang
    ?.Tokens;


if (
  !tokens
  ||
  typeof tokens !==
  'object'
  ||
  Array.isArray(
    tokens
  )
) {

  throw new Error(
    'Pinned localization JSON does not contain lang.Tokens.'
  );
}


const tokenEntries =
  Object.entries(
    tokens
  );


console.log(
  `Localization tokens: ${tokenEntries.length}`
);

console.log('');


// ============================================================
// INDEX TOKENS CASE-INSENSITIVELY
// ============================================================

const tokenMap =
  new Map();


for (
  const [
    token,
    value
  ]
  of tokenEntries
) {

  const normalized =
    normalizeToken(
      token
    );


  if (
    !normalized
  ) {

    continue;
  }


  tokenMap.set(
    normalized,
    value
  );
}


const steamHeroTokens =
  tokenEntries.filter(
    ([
      token
    ]) =>
      normalizeToken(
        token
      )
        ?.startsWith(
          'steam_rp_hero_'
        )
  );


console.log(
  `Steam_RP hero tokens: ${steamHeroTokens.length}`
);

console.log('');


// ============================================================
// LOCAL V01 RECORDS
// ============================================================

const localRecords =
  Array.isArray(
    v01.records
  )
    ? v01.records
    : [];


// ============================================================
// RESOLVE DISPLAY NAMES
// ============================================================

const records =
  localRecords
    .map(
      row =>
        resolveDisplayName({
          row,
          tokenMap
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
// OBSERVED SCRIPT128 COHORT
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

        internalKey:
          null,

        internalName:
          null,

        localizationToken:
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
// DUPLICATE DISPLAY NAMES
// ============================================================

const duplicateObservedDisplayNames =
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

const validationChecks =
  {
    localV01HeroRecordsAvailable:
      check(
        localRecords.length,
        '>0',
        localRecords.length >
        0
      ),


    pinnedLocalizationDownloaded:
      check(
        localizationText.length,
        '>0',
        localizationText.length >
        0
      ),


    localizationTokensAvailable:
      check(
        tokenEntries.length,
        '>100',
        tokenEntries.length >
        100
      ),


    steamHeroTokensAvailable:
      check(
        steamHeroTokens.length,
        '>0',
        steamHeroTokens.length >
        0
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

    sources:
      {
        identity:
          {
            type:
              'LOCAL_DEADLOCK_BUILD',

            input:
              V01_PATH,

            semantics:
              'heroId -> internalKey/internalName'
          },

        displayNames:
          {
            type:
              'PINNED_GITHUB_LOCALIZATION_SNAPSHOT',

            repository:
              LOCALIZATION_REPOSITORY,

            commit:
              LOCALIZATION_COMMIT,

            path:
              LOCALIZATION_PATH,

            rawUrl:
              LOCALIZATION_RAW_URL,

            sha256:
              localizationSha256,

            semantics:
              'Steam_RP_hero_<internalKey> -> current English display name at pinned snapshot'
          }
      },

    counts:
      {
        localHeroRecords:
          localRecords.length,

        localizationTokens:
          tokenEntries.length,

        steamHeroTokens:
          steamHeroTokens.length,

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

    duplicateObservedDisplayNames,

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
        durableJoinKey:
          'heroId',

        internalKey:
          'Valve internal hero identity from local game resources.',

        displayName:
          'English presentation label resolved through a pinned localization snapshot.',

        recommendedHumanDisplay:
          'Display Name (heroId)',

        recommendedMachineRepresentation:
          'Retain heroId, displayName, internalKey, and internalName separately.',

        mechanicUse:
          'Display names are presentation metadata only and must never be used as mechanical identifiers.'
      },

    historicalAttempts:
      {
        v01:
          'PASS for internal IDs/codenames; not a player-facing display-name map.',

        v02:
          'Failed to locate required local English localization.',

        v03:
          'Only items_english.txt extracted; 0/31 display names resolved.',

        v04:
          'Broader resource extraction still yielded only sparse local localization; 0/31 display names resolved.'
      },

    nextStage:
      validationPass
        ? 'HERO_DISPLAY_NAME_IDENTITY_BRANCH_CLOSED_RETURN_TO_WEAPON_AND_TRAVEL_ANALYSIS_AS_SCRIPT130'
        : 'DIAGNOSE_ONLY_UNRESOLVED_PINNED_LOCALIZATION_KEYS',

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
// CONSOLE
// ============================================================

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
    `token=${row.localizationToken ?? 'UNRESOLVED'}`
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
      `key=${row.internalKey ?? 'UNKNOWN'} ` +
      `expectedToken=${row.localizationToken ?? 'UNKNOWN'}`
    );
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
// RESOLUTION
// ============================================================

function resolveDisplayName({
  row,
  tokenMap
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


  const expectedToken =
    internalKey
      ? `steam_rp_hero_${internalKey}`
      : null;


  const localizedValue =
    expectedToken
      ? tokenMap.get(
          expectedToken
        )
      : null;


  const displayName =
    cleanName(
      localizedValue
    );


  const resolved =
    isPlausibleDisplayName(
      displayName
    );


  return {
    heroId,

    displayName:
      resolved
        ? displayName
        : null,

    displayNameResolved:
      resolved,

    resolutionMethod:
      resolved
        ? 'PINNED_STEAM_RP_HERO_TOKEN'
        : 'UNRESOLVED',

    localizationToken:
      expectedToken,

    localizationValueRaw:
      localizedValue
      ??
      null,

    internalKey,

    internalName,

    v01SortToken:
      row.sortName
      ??
      null,

    v01SearchToken:
      row.searchName
      ??
      null
  };
}


// ============================================================
// HELPERS
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


function isPlausibleDisplayName(
  value
) {

  if (
    !value
  ) {

    return false;
  }


  if (
    value.startsWith(
      '#'
    )
    ||
    value.includes(
      '%'
    )
    ||
    value.includes(
      '{'
    )
    ||
    value.includes(
      '}'
    )
  ) {

    return false;
  }


  return (
    value.length <=
      60
    &&
    /[A-Za-z]/.test(
      value
    )
  );
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


function findDuplicates(
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
    '# Deadlock Hero ID → Display Name Map V05'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Identity sources'
  );

  lines.push('');

  lines.push(
    '- Hero IDs and internal keys come from the locally installed Deadlock build via Script129 V01.'
  );

  lines.push(
    '- Player-facing English names come from a pinned Deadlock localization snapshot.'
  );

  lines.push(
    `- Localization commit: \`${summary.sources.displayNames.commit}\`.`
  );

  lines.push(
    `- Localization SHA256: \`${summary.sources.displayNames.sha256}\`.`
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
      `- **${row.displayName ?? 'UNRESOLVED'} (${row.heroId})** — internal=${row.internalName ?? 'UNKNOWN'}, key=${row.internalKey ?? 'UNKNOWN'}`
    );
  }


  lines.push('');

  lines.push(
    '## Reporting convention'
  );

  lines.push('');

  lines.push(
    'Future human-readable output uses `Display Name (heroId)`. Machine-readable output retains the numeric ID and internal key.'
  );

  lines.push('');

  lines.push(
    '## Guardrail'
  );

  lines.push('');

  lines.push(
    'Display names are presentation metadata only. Mechanical joins continue to use numeric hero IDs and/or internal resource keys.'
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