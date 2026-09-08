// Script205 helpers.
//
// Discovery-only raw resource audit.
//
// Goal:
//   Search the local repository's retained text/KV3/VData corpus for exact
//   standard-shop candidate item records and related nested modifier records,
//   then recover raw ammo/reload field values that Script139 V03 did not retain.
//
// Important:
//   - generated output/, replays/, node_modules/, .git/ are excluded;
//   - a lexical hit is not semantic authority;
//   - values are only reported when the field is found inside the balanced
//     record block for the exact item/modifier key;
//   - this is build-bound resource discovery, not runtime causal validation.

import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';

import {
  extname,
  join,
  relative,
  resolve,
} from 'node:path';

const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'output',
  'replays',
  'coverage',
  '.cache',
  'dist',
  'build',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.kv3',
  '.vdata',
  '.cfg',
  '.res',
  '.json',
  '.md',
  '.vdf',
  '.ini',
  '.js',
  '.mjs',
  '.ts',
]);

const MAX_FILE_BYTES = 64 * 1024 * 1024;

export function discoverTextFiles(
  root,
  {
    excludedDirs = DEFAULT_EXCLUDED_DIRS,
    maxFileBytes = MAX_FILE_BYTES,
  } = {},
) {
  const files = [];

  function walk(dir) {
    let entries;

    try {
      entries =
        readdirSync(
          dir,
          {
            withFileTypes: true,
          },
        );
    } catch {
      return;
    }

    for (const entry of entries) {
      const full =
        join(
          dir,
          entry.name,
        );

      if (entry.isDirectory()) {
        if (
          excludedDirs.has(
            entry.name,
          )
        ) {
          continue;
        }

        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;

      const extension =
        extname(entry.name)
          .toLowerCase();

      if (
        !TEXT_EXTENSIONS.has(extension)
      ) {
        continue;
      }

      let size;

      try {
        size =
          statSync(full).size;
      } catch {
        continue;
      }

      if (
        size <= 0
        || size > maxFileBytes
      ) {
        continue;
      }

      files.push(
        resolve(full),
      );
    }
  }

  walk(
    resolve(root),
  );

  return files.sort();
}

export function extractBalancedRecordBlock(
  text,
  recordKey,
) {
  const keyIndexes =
    findAllOccurrences(
      text,
      recordKey,
    );

  const candidates = [];

  for (const keyIndex of keyIndexes) {
    const open =
      findNextStructuralBrace(
        text,
        keyIndex
          + recordKey.length,
      );

    if (open < 0) continue;

    const close =
      findMatchingBrace(
        text,
        open,
      );

    if (close < 0) continue;

    candidates.push({
      recordKey,
      keyIndex,
      openIndex:
        open,
      closeIndex:
        close,
      text:
        text.slice(
          open,
          close + 1,
        ),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .sort(
      (a, b) =>
        a.text.length
        - b.text.length,
    )[0];
}

export function extractFieldAssignments(
  blockText,
  fieldNames,
) {
  const rows = [];

  for (const fieldName of fieldNames) {
    const occurrences =
      findAllOccurrences(
        blockText,
        fieldName,
      );

    for (const index of occurrences) {
      const lineStart =
        blockText
          .lastIndexOf(
            '\n',
            index,
          ) + 1;

      let lineEnd =
        blockText
          .indexOf(
            '\n',
            index,
          );

      if (lineEnd < 0) {
        lineEnd =
          blockText.length;
      }

      const line =
        blockText
          .slice(
            lineStart,
            lineEnd,
          )
          .trim();

      const parsed =
        parseAssignmentLine(
          line,
          fieldName,
        );

      rows.push({
        fieldName,
        index,
        line,
        parsedValue:
          parsed.value,
        parsedNumericValue:
          parsed.numericValue,
        assignmentRecognized:
          parsed.recognized,
        context:
          extractLineContext(
            blockText,
            lineStart,
            2,
          ),
      });
    }
  }

  return dedupe(
    rows,
    row =>
      `${row.fieldName}|${row.index}|${row.line}`,
  );
}

export function buildCandidateSpecs({
  script204,
  effects,
}) {
  const itemByKey =
    new Map(
      (
        Array.isArray(effects?.items)
          ? effects.items
          : []
      ).map(
        item => [
          item?.recordKey,
          item,
        ],
      ),
    );

  const rows =
    script204
      ?.audit
      ?.rows
      ?? [];

  return rows.map(row => {
    const item =
      itemByKey.get(
        row.recordKey,
      ) ?? null;

    const currentFields =
      new Set(
        (
          row.currentAmmoFieldNames
          ?? []
        )
          .map(
            field =>
              field?.value,
          )
          .filter(
            value =>
              typeof value
              === 'string',
          ),
      );

    const allAmmoFields =
      new Set([
        ...currentFields,

        ...(
          row.directAmmoStats
          ?? []
        )
          .map(
            stat =>
              stat?.propertyKey,
          )
          .filter(
            value =>
              typeof value
              === 'string',
          ),

        ...(
          row.fieldNameEvidence
          ?? []
        )
          .map(
            field =>
              field?.value,
          )
          .filter(
            value =>
              typeof value
              === 'string',
          ),
      ]);

    const relatedRecordKeys =
      new Set([
        row.recordKey,

        ...(
          Array.isArray(
            item?.nestedModifierClasses,
          )
            ? item.nestedModifierClasses
            : []
        )
          .filter(
            value =>
              typeof value
              === 'string',
          ),
      ]);

    return {
      recordKey:
        row.recordKey,

      runtimeDisposition:
        row?.runtimeCoverage
          ?.disposition
        ?? null,

      resourceClassification:
        row.resourceClassification,

      evidenceDepth:
        row.evidenceDepth,

      currentAmmoFieldNames:
        [...currentFields]
          .sort(),

      searchFieldNames:
        [...allAmmoFields]
          .sort(),

      relatedRecordKeys:
        [...relatedRecordKeys]
          .sort(),
    };
  });
}

export function scanRawResourceCorpus({
  root,
  candidateSpecs,
  files = null,
}) {
  const corpusFiles =
    files
    ?? discoverTextFiles(
      root,
    );

  const results =
    candidateSpecs.map(
      spec => ({
        ...spec,
        fileHits: [],
      }),
    );

  const candidateByProbe =
    new Map();

  for (const result of results) {
    for (
      const probe
      of result.relatedRecordKeys
    ) {
      if (
        !candidateByProbe.has(probe)
      ) {
        candidateByProbe.set(
          probe,
          [],
        );
      }

      candidateByProbe
        .get(probe)
        .push(result);
    }
  }

  let filesRead = 0;
  let readFailures = 0;

  for (const file of corpusFiles) {
    let text;

    try {
      text =
        readFileSync(
          file,
          'utf8',
        );
      filesRead++;
    } catch {
      readFailures++;
      continue;
    }

    for (
      const [probe, candidateRows]
      of candidateByProbe
    ) {
      if (
        !text.includes(probe)
      ) {
        continue;
      }

      const block =
        extractBalancedRecordBlock(
          text,
          probe,
        );

      for (const candidate of candidateRows) {
        const fieldAssignments =
          block
            ? extractFieldAssignments(
                block.text,
                candidate.searchFieldNames,
              )
            : [];

        candidate.fileHits.push({
          file:
            relative(
              resolve(root),
              file,
            ),

          probeRecordKey:
            probe,

          balancedBlockFound:
            Boolean(block),

          blockLength:
            block?.text.length
            ?? null,

          fieldAssignments,
        });
      }
    }
  }

  const normalized =
    results.map(row => {
      const allAssignments =
        row.fileHits.flatMap(
          hit =>
            hit.fieldAssignments.map(
              assignment => ({
                ...assignment,
                file:
                  hit.file,
                probeRecordKey:
                  hit.probeRecordKey,
              }),
            ),
        );

      const currentAssignments =
        allAssignments.filter(
          assignment =>
            row.currentAmmoFieldNames
              .includes(
                assignment.fieldName,
              ),
        );

      const parsedCurrentValues =
        currentAssignments.filter(
          assignment =>
            assignment
              .assignmentRecognized
            && assignment
              .parsedValue
              !== null,
        );

      return {
        ...row,

        fileHitCount:
          row.fileHits.length,

        balancedBlockHitCount:
          row.fileHits.filter(
            hit =>
              hit.balancedBlockFound,
          ).length,

        fieldAssignmentCount:
          allAssignments.length,

        currentFieldAssignmentCount:
          currentAssignments.length,

        parsedCurrentValueCount:
          parsedCurrentValues.length,

        parsedCurrentValues,

        allAssignments,
      };
    });

  return {
    root:
      resolve(root),

    filesConsidered:
      corpusFiles.length,

    filesRead,

    readFailures,

    candidateCount:
      normalized.length,

    candidatesWithFileHits:
      normalized.filter(
        row =>
          row.fileHitCount > 0,
      ).length,

    candidatesWithBalancedBlocks:
      normalized.filter(
        row =>
          row.balancedBlockHitCount > 0,
      ).length,

    candidatesWithCurrentFieldAssignments:
      normalized.filter(
        row =>
          row.currentFieldAssignmentCount > 0,
      ).length,

    candidatesWithParsedCurrentValues:
      normalized.filter(
        row =>
          row.parsedCurrentValueCount > 0,
      ).length,

    rows:
      normalized,
  };
}

function findAllOccurrences(
  text,
  needle,
) {
  const indexes = [];

  if (!needle) {
    return indexes;
  }

  let start = 0;

  while (start < text.length) {
    const index =
      text.indexOf(
        needle,
        start,
      );

    if (index < 0) break;

    indexes.push(index);
    start =
      index + needle.length;
  }

  return indexes;
}

function findNextStructuralBrace(
  text,
  start,
) {
  let inString = false;
  let escaped = false;

  // Reconstruct quote state from the start of the current line. The search
  // commonly begins inside a quoted record key such as:
  //   "upgrade_quick_silver"
  const lineStart =
    text.lastIndexOf(
      '\n',
      Math.max(
        0,
        start - 1,
      ),
    ) + 1;

  for (
    let i = lineStart;
    i < start;
    i++
  ) {
    const ch =
      text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
    }
  }

  escaped = false;

  for (
    let i = start;
    i < text.length;
    i++
  ) {
    const ch =
      text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }

      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      return i;
    }

    if (
      i - start > 2000
    ) {
      return -1;
    }
  }

  return -1;
}


function findMatchingBrace(
  text,
  openIndex,
) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = openIndex;
    i < text.length;
    i++
  ) {
    const ch =
      text[i];

    const next =
      text[i + 1];

    if (lineComment) {
      if (ch === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (
        ch === '*'
        && next === '/'
      ) {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }

      continue;
    }

    if (
      ch === '/'
      && next === '/'
    ) {
      lineComment = true;
      i++;
      continue;
    }

    if (
      ch === '/'
      && next === '*'
    ) {
      blockComment = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function parseAssignmentLine(
  line,
  fieldName,
) {
  const escaped =
    escapeRegex(
      fieldName,
    );

  const patterns = [
    new RegExp(
      `["']?${escaped}["']?\\s*=\\s*"?([^",}\\s]+)"?`,
      'i',
    ),

    new RegExp(
      `["']?${escaped}["']?\\s+["']([^"']+)["']`,
      'i',
    ),

    new RegExp(
      `["']?${escaped}["']?\\s*:\\s*"?([^",}\\s]+)"?`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match =
      line.match(pattern);

    if (!match) continue;

    const value =
      match[1];

    const numberMatch =
      String(value)
        .match(
          /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)/,
        );

    return {
      recognized:
        true,

      value,

      numericValue:
        numberMatch
          ? Number(numberMatch[0])
          : null,
    };
  }

  return {
    recognized:
      false,
    value:
      null,
    numericValue:
      null,
  };
}

function extractLineContext(
  text,
  lineStart,
  radius,
) {
  const before =
    text.slice(
      0,
      lineStart,
    );

  const previousLines =
    before
      .split(/\r?\n/)
      .slice(-radius);

  const after =
    text
      .slice(lineStart)
      .split(/\r?\n/)
      .slice(
        0,
        radius + 1,
      );

  return [
    ...previousLines,
    ...after,
  ].join('\n');
}

function escapeRegex(value) {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
}

function dedupe(
  rows,
  keyFn,
) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const key =
      keyFn(row);

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}
