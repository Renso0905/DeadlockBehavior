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
  basename,
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
  'DEADLOCK_HERO_ID_NAME_MAP_V01';


// ============================================================
// PURPOSE
//
// Build a reusable:
//
//     heroId -> hero name
//
// mapping directly from the locally installed Deadlock build.
//
// Source:
//
//     game/citadel/pak01_dir.vpk
//       -> scripts/heroes.vdata_c
//       -> Source2Viewer decompile
//
// Primary fields:
//
//     m_HeroID
//     m_strHeroSortName
//     m_strHeroSearchName
//
// This avoids maintaining a handwritten hero-ID table.
//
// Script128 is used only as a VALIDATION COHORT:
// every hero ID observed in our successful-hit analysis should
// resolve to a human-readable name.
//
// No replay parsing.
// No web lookup.
// No game resource is retained in the repository.
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
    'hero_id_name_map_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'hero_id_name_map_v01.md'
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
    SCRIPT128_PATH
  )
) {

  throw new Error(
    `Script128 summary not found:\n${SCRIPT128_PATH}`
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
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'DEADLOCK HERO ID -> NAME MAP V0.1'
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
  'Resource:      scripts/heroes.vdata_c'
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
// TEMPORARY RESOURCE EXTRACTION
// ============================================================

const temporaryDirectory =
  mkdtempSync(
    join(
      tmpdir(),
      'deadlock-hero-map-'
    )
  );


const desiredOutputPath =
  join(
    temporaryDirectory,
    'heroes.vdata'
  );


console.log(
  'Decompiling scripts/heroes.vdata_c...'
);


const extraction =
  spawnSync(
    SOURCE2VIEWER_PATH,
    [
      '--input',
      pakPath,

      '--vpk_filepath',
      'scripts/heroes.vdata_c',

      '--output',
      desiredOutputPath,

      '--vpk_decompile'
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
  extraction.status !==
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
      'Source2Viewer extraction failed.',
      '',
      `Exit code: ${extraction.status}`,
      '',
      'STDOUT:',
      extraction.stdout
      ??
      '',
      '',
      'STDERR:',
      extraction.stderr
      ??
      ''
    ].join(
      '\n'
    )
  );
}


// ============================================================
// FIND ACTUAL DECOMPILED FILE
//
// Source2Viewer normally respects the exact output filename when
// --vpk_filepath identifies one file. A recursive fallback is
// retained in case CLI behavior differs by version.
// ============================================================

let heroesVdataPath =
  existsSync(
    desiredOutputPath
  )
    ? desiredOutputPath
    : findFileRecursive(
        temporaryDirectory,
        fileName =>
          fileName.toLowerCase() ===
          'heroes.vdata'
          ||
          fileName.toLowerCase() ===
          'heroes.vdata_c'
      );


if (
  !heroesVdataPath
) {

  const tempListing =
    listFilesRecursive(
      temporaryDirectory
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
      'Source2Viewer completed but heroes.vdata was not found.',
      '',
      'Temporary output files:',
      ...tempListing.map(
        path =>
          `  ${path}`
      )
    ].join(
      '\n'
    )
  );
}


// ============================================================
// READ + HASH EXTRACTED HERO DATA
// ============================================================

const heroTextBuffer =
  readFileSync(
    heroesVdataPath
  );


const heroText =
  heroTextBuffer.toString(
    'utf8'
  );


const heroesVdataSha256 =
  createHash(
    'sha256'
  )
    .update(
      heroTextBuffer
    )
    .digest(
      'hex'
    );


console.log(
  `Decompiled bytes: ${heroTextBuffer.length}`
);

console.log(
  `Decompiled SHA256: ${heroesVdataSha256}`
);

console.log('');


// ============================================================
// PARSE HERO RECORDS
// ============================================================

const heroRecords =
  parseHeroRecords(
    heroText
  );


if (
  heroRecords.length ===
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
    'No m_HeroID records could be parsed from heroes.vdata.'
  );
}


// ============================================================
// UNIQUE ID VALIDATION
// ============================================================

const recordsById =
  new Map();


const duplicateIds =
  [];


for (
  const row
  of heroRecords
) {

  if (
    recordsById.has(
      row.heroId
    )
  ) {

    duplicateIds.push(
      row.heroId
    );

    continue;
  }


  recordsById.set(
    row.heroId,
    row
  );
}


// ============================================================
// LOAD OBSERVED HERO IDS FROM SCRIPT128
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
    `Script128 not ready. Status=${script128?.status}`
  );
}


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


// ============================================================
// OBSERVED COHORT CROSSWALK
// ============================================================

const observedCrosswalk =
  observedHeroIds.map(
    heroId => {

      const record =
        recordsById.get(
          heroId
        )
        ??
        null;


      return {
        heroId,

        resolved:
          Boolean(
            record
          ),

        heroName:
          record?.heroName
          ??
          null,

        sortName:
          record?.sortName
          ??
          null,

        searchName:
          record?.searchName
          ??
          null,

        internalKey:
          record?.internalKey
          ??
          null,

        nameSource:
          record?.nameSource
          ??
          null
      };
    }
  );


const unresolvedObserved =
  observedCrosswalk.filter(
    row =>
      !row.resolved
      ||
      !row.heroName
  );


// ============================================================
// MAP OUTPUTS
// ============================================================

const heroIdToName =
  Object.fromEntries(
    [
      ...recordsById.values()
    ]
      .filter(
        row =>
          row.heroName
      )
      .sort(
        (
          a,
          b
        ) =>
          a.heroId -
          b.heroId
      )
      .map(
        row => [
          String(
            row.heroId
          ),

          row.heroName
        ]
      )
  );


const heroNameToId =
  Object.fromEntries(
    [
      ...recordsById.values()
    ]
      .filter(
        row =>
          row.heroName
      )
      .sort(
        (
          a,
          b
        ) =>
          a.heroName.localeCompare(
            b.heroName
          )
      )
      .map(
        row => [
          row.heroName,

          row.heroId
        ]
      )
  );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {
    heroRecordsParsed:
      check(
        heroRecords.length,
        '>0',
        heroRecords.length >
        0
      ),


    noDuplicateHeroIds:
      check(
        duplicateIds.length,
        0,
        duplicateIds.length ===
        0
      ),


    observedHeroIdsAvailable:
      check(
        observedHeroIds.length,
        '>0',
        observedHeroIds.length >
        0
      ),


    everyObservedHeroIdResolved:
      check(
        observedCrosswalk.filter(
          row =>
            row.resolved
            &&
            row.heroName
        ).length,
        observedHeroIds.length,
        unresolvedObserved.length ===
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
    ? 'DEADLOCK_HERO_ID_NAME_MAP_READY'
    : 'DEADLOCK_HERO_ID_NAME_MAP_REQUIRES_DIAGNOSIS';


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
          'LOCAL_DEADLOCK_VPK_SOURCE2VIEWER_DECOMPILE',

        pakPath,

        pakBytes:
          statSync(
            pakPath
          ).size,

        resourcePath:
          'scripts/heroes.vdata_c',

        source2ViewerPath:
          SOURCE2VIEWER_PATH,

        source2ViewerVersion,

        heroesVdataSha256,

        temporaryResourceDeletedAfterParsing:
          true
      },

    counts:
      {
        parsedHeroRecords:
          heroRecords.length,

        uniqueHeroIds:
          recordsById.size,

        namedHeroIds:
          Object.keys(
            heroIdToName
          ).length,

        observedHeroIds:
          observedHeroIds.length,

        observedHeroIdsResolved:
          observedCrosswalk.length -
          unresolvedObserved.length,

        observedHeroIdsUnresolved:
          unresolvedObserved.length
      },

    observedCrosswalk,

    unresolvedObserved,

    heroIdToName,

    heroNameToId,

    records:
      [
        ...recordsById.values()
      ].sort(
        (
          a,
          b
        ) =>
          a.heroId -
          b.heroId
      ),

    validation:
      {
        pass:
          validationPass,

        checks:
          validationChecks
      },

    usage:
      {
        durableJoinKey:
          'heroId',

        presentationField:
          'heroName',

        recommendedDisplay:
          'Hero Name (heroId)',

        example:
          observedCrosswalk.length >
          0
            ? `${observedCrosswalk[0].heroName ?? 'UNKNOWN'} (${observedCrosswalk[0].heroId})`
            : null
      },

    nextStage:
      validationPass
        ? 'USE_THIS_LOOKUP_IN_ALL_SUBSEQUENT_REPORTS_THEN_RETURN_TO_SHOT_TRAVEL_CROSS_REPLAY_AUDIT'
        : 'DIAGNOSE_UNRESOLVED_OR_DUPLICATE_HERO_IDENTITIES',

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
// DELETE TEMPORARY GAME RESOURCE
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
  'HERO ID -> NAME MAP'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Parsed hero records:       ${heroRecords.length}`
);

console.log(
  `Unique hero IDs:           ${recordsById.size}`
);

console.log(
  `Observed project hero IDs: ${observedHeroIds.length}`
);

console.log(
  `Observed IDs resolved:     ${observedHeroIds.length - unresolvedObserved.length}/${observedHeroIds.length}`
);

console.log('');

console.log(
  'OBSERVED HERO CROSSWALK'
);

console.log(
  '-----------------------'
);


for (
  const row
  of observedCrosswalk
) {

  console.log(
    `${String(row.heroId).padStart(3)}  ` +
    `${String(row.heroName ?? 'UNRESOLVED').padEnd(24)} ` +
    `sort=${JSON.stringify(row.sortName)} ` +
    `search=${JSON.stringify(row.searchName)}`
  );
}


if (
  unresolvedObserved.length >
  0
) {

  console.log('');

  console.log(
    'UNRESOLVED OBSERVED IDS'
  );

  console.log(
    '-----------------------'
  );


  for (
    const row
    of unresolvedObserved
  ) {

    console.log(
      `heroId=${row.heroId}`
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
    `${name.padEnd(38)} ${row.pass} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
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
// HERO PARSER
// ============================================================

function parseHeroRecords(
  text
) {

  const heroIdRegex =
    /m_HeroID\s*=\s*(-?\d+)/g;


  const heroIdMatches =
    [
      ...text.matchAll(
        heroIdRegex
      )
    ];


  const rows =
    [];


  for (
    let index =
      0;

    index <
      heroIdMatches.length;

    index++
  ) {

    const match =
      heroIdMatches[
        index
      ];


    const heroId =
      finite(
        match[1]
      );


    if (
      heroId ===
      null
      ||
      heroId <=
      0
    ) {

      continue;
    }


    const segmentStart =
      match.index;


    const segmentEnd =
      index +
      1 <
      heroIdMatches.length
        ? heroIdMatches[
            index +
            1
          ].index
        : Math.min(
            text.length,
            segmentStart +
            20000
          );


    const segment =
      text.slice(
        segmentStart,
        segmentEnd
      );


    const sortName =
      captureQuotedField(
        segment,
        'm_strHeroSortName'
      );


    const searchName =
      captureQuotedField(
        segment,
        'm_strHeroSearchName'
      );


    const internalKey =
      findInternalKeyBeforePosition(
        text,
        segmentStart
      );


    const selected =
      chooseHeroName({
        sortName,
        searchName,
        internalKey
      });


    rows.push(
      {
        heroId,

        heroName:
          selected.name,

        nameSource:
          selected.source,

        sortName,

        searchName,

        internalKey
      }
    );
  }


  return rows;
}


function captureQuotedField(
  text,
  fieldName
) {

  const escaped =
    escapeRegex(
      fieldName
    );


  const regex =
    new RegExp(
      `${escaped}\\s*=\\s*"([^"]*)"`,
      'm'
    );


  const match =
    text.match(
      regex
    );


  const value =
    match?.[1]
      ?.trim()
    ??
    '';


  return value.length >
    0
      ? value
      : null;
}


function findInternalKeyBeforePosition(
  text,
  position
) {

  const start =
    Math.max(
      0,
      position -
      5000
    );


  const before =
    text.slice(
      start,
      position
    );


  const matches =
    [
      ...before.matchAll(
        /^\s*([A-Za-z0-9_]+)\s*=\s*\{\s*$/gm
      )
    ];


  if (
    matches.length ===
    0
  ) {

    return null;
  }


  return matches[
    matches.length -
    1
  ][1];
}


function chooseHeroName({
  sortName,
  searchName,
  internalKey
}) {

  if (
    isHumanReadableName(
      sortName
    )
  ) {

    return {
      name:
        normalizeDisplayName(
          sortName
        ),

      source:
        'm_strHeroSortName'
    };
  }


  if (
    isHumanReadableName(
      searchName
    )
  ) {

    return {
      name:
        normalizeDisplayName(
          searchName
        ),

      source:
        'm_strHeroSearchName'
    };
  }


  if (
    internalKey
  ) {

    return {
      name:
        normalizeInternalKey(
          internalKey
        ),

      source:
        'INTERNAL_KEY_FALLBACK'
    };
  }


  return {
    name:
      null,

    source:
      'UNRESOLVED'
  };
}


function isHumanReadableName(
  value
) {

  if (
    !value
  ) {

    return false;
  }


  const lower =
    value.toLowerCase();


  if (
    lower.startsWith(
      '#'
    )
    ||
    lower.startsWith(
      'citadel_'
    )
    ||
    lower.includes(
      'localization'
    )
  ) {

    return false;
  }


  return /[a-z]/i.test(
    value
  );
}


function normalizeDisplayName(
  value
) {

  return String(
    value
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}


function normalizeInternalKey(
  value
) {

  return String(
    value
  )
    .replace(
      /^(hero_|npc_dota_hero_|citadel_hero_)/i,
      ''
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


// ============================================================
// FILE SEARCH HELPERS
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

      const result =
        findFileRecursive(
          path,
          predicate
        );


      if (
        result
      ) {

        return result;
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


function listFilesRecursive(
  directory
) {

  const rows =
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

      rows.push(
        ...listFilesRecursive(
          path
        )
      );

    } else {

      rows.push(
        path
      );
    }
  }


  return rows;
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


function escapeRegex(
  value
) {

  return String(
    value
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
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
    '# Deadlock Hero ID → Name Map V01'
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
    '- `scripts/heroes.vdata_c` decompiled with Source2Viewer.'
  );

  lines.push(
    '- Temporary decompiled game resource deleted after parsing.'
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
      `- ${row.heroName ?? 'UNRESOLVED'} (${row.heroId})`
    );
  }


  lines.push('');

  lines.push(
    '## Usage'
  );

  lines.push('');

  lines.push(
    'Keep the numeric `heroId` as the durable join key. Use `heroName` for human-readable reports and console output.'
  );

  lines.push('');

  lines.push(
    'Recommended display form: `Hero Name (ID)`.'
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