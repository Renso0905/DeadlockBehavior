import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  createReadStream
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

import {
  createHash
} from 'node:crypto';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'DEADLOCK_WORLD_PHYSICS_RESOURCE_EXTRACTION_V01';


// ============================================================
// PURPOSE
//
// Script118 showed that replay entities expose transforms,
// model references, bounds, and collision flags. That is useful
// for entity-level occluders, but it does not prove that the
// internal static architecture of the map is represented by
// replay entity boxes.
//
// Deadlock's current main map archive contains dedicated world
// physics resources. Script119 locates the installed map archive,
// uses Source 2 Viewer / ValveResourceFormat CLI to extract the
// world-physics resources, and attempts a glTF export of the
// dedicated world_physics.vmdl_c.
//
// This script DOES NOT perform LOS classification.
// It only prepares / validates the static-world collision source.
// ============================================================


// ============================================================
// CONSTANTS
// ============================================================

const MAP_NAME =
  'dl_streets';


const REQUIRED_VPK_ENTRIES =
  [
    `maps/${MAP_NAME}.vmap_c`,
    `maps/${MAP_NAME}/world.vwrld_c`,
    `maps/${MAP_NAME}/world_physics.vrman_c`,
    `maps/${MAP_NAME}/world_physics.vmdl_c`,
    `maps/${MAP_NAME}/world_visibility.vvis_c`
  ];


const EXTRACTION_ENTRIES =
  [
    `maps/${MAP_NAME}/world_physics.vrman_c`,
    `maps/${MAP_NAME}/world_physics.vmdl_c`,
    `maps/${MAP_NAME}/world.vwrld_c`
  ];


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'world_physics_resource_extraction_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'world_physics_resource_extraction_v01.md'
  );


const RESOURCE_OUTPUT_DIRECTORY =
  resolve(
    'resources',
    MAP_NAME,
    'world_physics_v01'
  );


// ============================================================
// ARGUMENTS
// ============================================================

const args =
  parseArgs(
    process.argv.slice(2)
  );


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'DEADLOCK WORLD-PHYSICS RESOURCE EXTRACTION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'PURPOSE'
);

console.log(
  '-------'
);

console.log(
  'Recover the dedicated static-world physics resource for'
);

console.log(
  'future player -> flying-soul line-of-sight raycasts.'
);

console.log('');

console.log(
  'LOS classification:         NONE'
);

console.log(
  'Opportunity classification: NONE'
);

console.log('');


// ============================================================
// LOCATE SOURCE 2 VIEWER CLI
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
    [
      'Source2Viewer-CLI.exe was not found.',
      '',
      'Expected under:',
      resolve(
        'tools',
        'source2viewer'
      ),
      '',
      'Install the official Windows x64 CLI first, then rerun Script119.',
      '',
      'You may also provide:',
      '  --vrf "C:\\path\\to\\Source2Viewer-CLI.exe"'
    ].join(
      '\n'
    )
  );
}


const vrfVersion =
  safeExecCapture(
    vrfCli,
    [
      '--version'
    ]
  );


console.log(
  `Source2Viewer CLI: ${vrfCli}`
);


console.log(
  `CLI version:       ${firstNonEmptyLine(
    vrfVersion.stdout
  ) ?? 'unresolved'}`
);


console.log('');


// ============================================================
// LOCATE DEADLOCK INSTALLATION
// ============================================================

const deadlockRoot =
  args.deadlock
  ??
  findDeadlockRoot();


if (
  !deadlockRoot
  ||
  !existsSync(
    deadlockRoot
  )
) {

  throw new Error(
    [
      'Deadlock installation was not found automatically.',
      '',
      'Provide the installation root explicitly, for example:',
      '  --deadlock "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock"'
    ].join(
      '\n'
    )
  );
}


const gameInfoPath =
  resolve(
    deadlockRoot,
    'game',
    'citadel',
    'gameinfo.gi'
  );


const pak01Path =
  resolve(
    deadlockRoot,
    'game',
    'citadel',
    'pak01_dir.vpk'
  );


const mapVpkPath =
  resolve(
    deadlockRoot,
    'game',
    'citadel',
    'maps',
    `${MAP_NAME}.vpk`
  );


if (
  !existsSync(
    gameInfoPath
  )
) {

  throw new Error(
    `Deadlock gameinfo.gi not found:\n${gameInfoPath}`
  );
}


if (
  !existsSync(
    mapVpkPath
  )
) {

  throw new Error(
    `Deadlock map VPK not found:\n${mapVpkPath}`
  );
}


console.log(
  `Deadlock root:      ${deadlockRoot}`
);


console.log(
  `Map VPK:            ${mapVpkPath}`
);


console.log('');


// ============================================================
// HASH MAP ARCHIVE
//
// Freeze the exact local map resource used for LOS validation.
// If Deadlock later patches the map, this hash changes.
// ============================================================

console.log(
  'Hashing map archive...'
);


const mapVpkSha256 =
  await sha256File(
    mapVpkPath
  );


// ============================================================
// LIST VPK
// ============================================================

console.log(
  'Listing map VPK resources...'
);


const listResult =
  safeExecCapture(
    vrfCli,
    [
      '-i',
      mapVpkPath,
      '--vpk_list'
    ],
    {
      maxBuffer:
        128 *
        1024 *
        1024
    }
  );


if (
  !listResult.ok
) {

  throw new Error(
    [
      'Source2Viewer failed to list the map VPK.',
      '',
      listResult.stderr,
      listResult.stdout
    ].join(
      '\n'
    )
  );
}


const normalizedVpkListing =
  normalizeSlashes(
    listResult.stdout
  ).toLowerCase();


const entryChecks =
  REQUIRED_VPK_ENTRIES.map(
    entry =>
      ({
        entry,

        present:
          normalizedVpkListing.includes(
            entry.toLowerCase()
          )
      })
  );


for (
  const row
  of entryChecks
) {

  console.log(
    `${row.present ? '[FOUND]' : '[MISS] '} ${row.entry}`
  );
}


const worldPhysicsEntryPresent =
  entryChecks.find(
    row =>
      row.entry.endsWith(
        '/world_physics.vmdl_c'
      )
  )?.present
  ===
  true;


if (
  !worldPhysicsEntryPresent
) {

  throw new Error(
    'Dedicated world_physics.vmdl_c was not found in the local map VPK.'
  );
}


// ============================================================
// EXTRACT TARGET RESOURCES
// ============================================================

mkdirSync(
  RESOURCE_OUTPUT_DIRECTORY,
  {
    recursive:
      true
  }
);


const extractionResults =
  [];


for (
  const entry
  of EXTRACTION_ENTRIES
) {

  console.log(
    `Extracting ${entry} ...`
  );


  const result =
    safeExecCapture(
      vrfCli,
      [
        '-i',
        mapVpkPath,
        '--output',
        RESOURCE_OUTPUT_DIRECTORY,
        '--vpk_filepath',
        entry
      ],
      {
        maxBuffer:
          64 *
          1024 *
          1024
      }
    );


  const extractedPath =
    findFirstFileNamed(
      RESOURCE_OUTPUT_DIRECTORY,
      basename(
        entry
      )
    );


  extractionResults.push(
    {
      entry,

      commandOk:
        result.ok,

      stdout:
        truncateText(
          result.stdout,
          4000
        ),

      stderr:
        truncateText(
          result.stderr,
          4000
        ),

      extractedPath,

      exists:
        Boolean(
          extractedPath
          &&
          existsSync(
            extractedPath
          )
        )
    }
  );
}


const worldPhysicsVmdlPath =
  findFirstFileNamed(
    RESOURCE_OUTPUT_DIRECTORY,
    'world_physics.vmdl_c'
  );


const worldPhysicsManifestPath =
  findFirstFileNamed(
    RESOURCE_OUTPUT_DIRECTORY,
    'world_physics.vrman_c'
  );


const worldVwrldPath =
  findFirstFileNamed(
    RESOURCE_OUTPUT_DIRECTORY,
    'world.vwrld_c'
  );


if (
  !worldPhysicsVmdlPath
  ||
  !existsSync(
    worldPhysicsVmdlPath
  )
) {

  throw new Error(
    [
      'world_physics.vmdl_c was present in the archive but was not recovered.',
      '',
      'Inspect the extraction diagnostics in the console/output JSON.'
    ].join(
      '\n'
    )
  );
}


// ============================================================
// HASH EXTRACTED WORLD PHYSICS
// ============================================================

console.log(
  'Hashing extracted world physics...'
);


const worldPhysicsSha256 =
  await sha256File(
    worldPhysicsVmdlPath
  );


// ============================================================
// RESOURCE SUMMARY
// ============================================================

console.log(
  'Inspecting world_physics.vmdl_c resource...'
);


const resourceSummary =
  safeExecCapture(
    vrfCli,
    [
      '-i',
      worldPhysicsVmdlPath
    ],
    {
      maxBuffer:
        64 *
        1024 *
        1024
    }
  );


const resourceSummaryPath =
  resolve(
    RESOURCE_OUTPUT_DIRECTORY,
    'world_physics_resource_summary.txt'
  );


writeFileSync(
  resourceSummaryPath,
  [
    resourceSummary.stdout,
    resourceSummary.stderr
  ].join(
    '\n'
  ),
  'utf8'
);


// ============================================================
// ATTEMPT GLB EXPORT
//
// Candidate collision mesh because the source itself is the
// dedicated world_physics model.
//
// We still validate coordinates and ray behavior before treating
// it as authoritative bullet-blocking geometry.
// ============================================================

const glbPath =
  resolve(
    RESOURCE_OUTPUT_DIRECTORY,
    'world_physics.glb'
  );


console.log(
  'Attempting world-physics glTF/GLB export...'
);


const glbExport =
  safeExecCapture(
    vrfCli,
    [
      '-i',
      worldPhysicsVmdlPath,
      '-o',
      glbPath,
      '-d',
      '--gltf_export_format',
      'glb'
    ],
    {
      maxBuffer:
        128 *
        1024 *
        1024
    }
  );


const glbExists =
  existsSync(
    glbPath
  );


let glbInspection =
  null;


if (
  glbExists
) {

  glbInspection =
    inspectGlb(
      glbPath
    );
}


// ============================================================
// ATTRIBUTION CHECK
// ============================================================

const readmePath =
  resolve(
    'README.md'
  );


const readmeText =
  existsSync(
    readmePath
  )
    ? readFileSync(
        readmePath,
        'utf8'
      )
    : '';


const source2ViewerAttributionPresent =
  /Source 2 Viewer|ValveResourceFormat/i.test(
    readmeText
  );


// ============================================================
// STATUS
// ============================================================

let status;


if (
  glbInspection?.valid
  &&
  glbInspection.positionVertexCount >
  0
  &&
  glbInspection.primitiveCount >
  0
) {

  status =
    'WORLD_PHYSICS_COLLISION_EXPORT_CANDIDATE_READY';

} else {

  status =
    'WORLD_PHYSICS_RESOURCE_EXTRACTED_CUSTOM_PHYSICS_MESH_EXTRACTION_REQUIRED';
}


const nextStage =
  status ===
  'WORLD_PHYSICS_COLLISION_EXPORT_CANDIDATE_READY'
    ? 'VALIDATE_WORLD_PHYSICS_MESH_COORDINATES_AND_SUCCESSFUL_HIT_RAYCASTS'
    : 'BUILD_DIRECT_PHYSAGGREGATE_EXTRACTION_FROM_WORLD_PHYSICS_VMDL';


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


    map:
      {
        name:
          MAP_NAME,

        deadlockRoot,

        gameInfoPath,

        pak01Path:
          existsSync(
            pak01Path
          )
            ? pak01Path
            : null,

        mapVpkPath,

        mapVpkBytes:
          statSync(
            mapVpkPath
          ).size,

        mapVpkSha256
      },


    source2Viewer:
      {
        cliPath:
          vrfCli,

        versionOutput:
          truncateText(
            vrfVersion.stdout,
            2000
          ),

        attributionPresent:
          source2ViewerAttributionPresent,

        attributionRequiredBeforeNextRepositoryPush:
          !source2ViewerAttributionPresent
      },


    vpkEntries:
      entryChecks,


    extraction:
      {
        outputDirectory:
          RESOURCE_OUTPUT_DIRECTORY,

        results:
          extractionResults,

        worldPhysicsVmdlPath,

        worldPhysicsManifestPath,

        worldVwrldPath,

        worldPhysicsVmdlBytes:
          statSync(
            worldPhysicsVmdlPath
          ).size,

        worldPhysicsSha256,

        resourceSummaryPath
      },


    glbExport:
      {
        commandOk:
          glbExport.ok,

        stdout:
          truncateText(
            glbExport.stdout,
            4000
          ),

        stderr:
          truncateText(
            glbExport.stderr,
            4000
          ),

        glbPath,

        exists:
          glbExists,

        inspection:
          glbInspection
      },


    interpretation:
      {
        replayBounds:
          'Script118 entity bounds remain useful candidates for dynamic/entity occluders, but a single CWorld bounds primitive cannot represent internal walls, rooms, corners, bridges, or other static architecture.',

        staticWorld:
          'The dedicated map world-physics resource is the appropriate candidate source for static building-level occlusion.',

        validationGuardrail:
          'No exported mesh is accepted as LOS collision merely because it came from world_physics.vmdl_c. Its coordinates and raycast behavior must be validated against replay positions and observed successful soul hits.',

        opportunityGuardrail:
          'Script117 rows remain geometry-only candidate relations. No actionable-opportunity labels are produced here.'
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
// WRITE OUTPUT
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
  'WORLD-PHYSICS EXTRACTION SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Map VPK SHA256:          ${mapVpkSha256}`
);


console.log(
  `world_physics bytes:     ${statSync(
    worldPhysicsVmdlPath
  ).size}`
);


console.log(
  `world_physics SHA256:    ${worldPhysicsSha256}`
);


console.log(
  `GLB export command:      ${glbExport.ok}`
);


console.log(
  `GLB exists:              ${glbExists}`
);


console.log(
  `GLB valid:               ${glbInspection?.valid ?? false}`
);


console.log(
  `GLB meshes:              ${glbInspection?.meshCount ?? 0}`
);


console.log(
  `GLB primitives:          ${glbInspection?.primitiveCount ?? 0}`
);


console.log(
  `GLB POSITION vertices:   ${glbInspection?.positionVertexCount ?? 0}`
);


console.log(
  `GLB indexed triangles*:  ${glbInspection?.indexedTriangleCount ?? 0}`
);


console.log('');

console.log(
  '*Triangle count is an index-count/3 diagnostic only.'
);


console.log('');

console.log(
  'ATTRIBUTION'
);

console.log(
  '-----------'
);


console.log(
  `Source 2 Viewer README attribution present: ${source2ViewerAttributionPresent}`
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
// ARG PARSER
// ============================================================

function parseArgs(
  argv
) {

  const result =
    {
      deadlock:
        null,

      vrf:
        null
    };


  for (
    let i =
      0;

    i <
      argv.length;

    i++
  ) {

    if (
      argv[i] ===
      '--deadlock'
      &&
      argv[i + 1]
    ) {

      result.deadlock =
        resolve(
          argv[++i]
        );

      continue;
    }


    if (
      argv[i] ===
      '--vrf'
      &&
      argv[i + 1]
    ) {

      result.vrf =
        resolve(
          argv[++i]
        );
    }
  }


  return result;
}


// ============================================================
// DEADLOCK / STEAM DISCOVERY
// ============================================================

function findDeadlockRoot() {

  const steamRoots =
    new Set();


  for (
    const candidate
    of [
      process.env['PROGRAMFILES(X86)']
        ? join(
            process.env['PROGRAMFILES(X86)'],
            'Steam'
          )
        : null,

      process.env.PROGRAMFILES
        ? join(
            process.env.PROGRAMFILES,
            'Steam'
          )
        : null,

      'C:\\Program Files (x86)\\Steam',

      'C:\\Program Files\\Steam'
    ]
  ) {

    if (
      candidate
      &&
      existsSync(
        candidate
      )
    ) {

      steamRoots.add(
        candidate
      );
    }
  }


  const libraryRoots =
    new Set(
      steamRoots
    );


  for (
    const steamRoot
    of steamRoots
  ) {

    const libraryFoldersPath =
      join(
        steamRoot,
        'steamapps',
        'libraryfolders.vdf'
      );


    if (
      !existsSync(
        libraryFoldersPath
      )
    ) {

      continue;
    }


    let text;


    try {

      text =
        readFileSync(
          libraryFoldersPath,
          'utf8'
        );

    } catch {

      continue;
    }


    for (
      const match
      of text.matchAll(
        /"path"\s+"([^"]+)"/g
      )
    ) {

      const path =
        match[1]
          .replace(
            /\\\\/g,
            '\\'
          );


      if (
        existsSync(
          path
        )
      ) {

        libraryRoots.add(
          path
        );
      }
    }
  }


  for (
    const letter
    of 'CDEFGHIJKLMNOPQRSTUVWXYZ'
  ) {

    const candidate =
      `${letter}:\\SteamLibrary`;


    if (
      existsSync(
        candidate
      )
    ) {

      libraryRoots.add(
        candidate
      );
    }
  }


  for (
    const libraryRoot
    of libraryRoots
  ) {

    const candidate =
      join(
        libraryRoot,
        'steamapps',
        'common',
        'Deadlock'
      );


    if (
      existsSync(
        join(
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


// ============================================================
// FILE DISCOVERY
// ============================================================

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


  let rootStat;


  try {

    rootStat =
      statSync(
        root
      );

  } catch {

    return null;
  }


  if (
    rootStat.isFile()
  ) {

    return basename(
      root
    ).toLowerCase() ===
    fileName.toLowerCase()
      ? root
      : null;
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
        entry.name.toLowerCase() ===
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
// PROCESS EXECUTION
// ============================================================

function safeExecCapture(
  executable,
  args,
  options =
    {}
) {

  try {

    const stdout =
      execFileSync(
        executable,
        args,
        {
          encoding:
            'utf8',

          windowsHide:
            true,

          maxBuffer:
            options.maxBuffer
            ??
            32 *
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
        bufferOrStringToText(
          error?.stdout
        ),

      stderr:
        bufferOrStringToText(
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


function bufferOrStringToText(
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
// HASH
// ============================================================

async function sha256File(
  path
) {

  const hash =
    createHash(
      'sha256'
    );


  const stream =
    createReadStream(
      path
    );


  for await (
    const chunk
    of stream
  ) {

    hash.update(
      chunk
    );
  }


  return hash.digest(
    'hex'
  );
}


// ============================================================
// GLB INSPECTION
// ============================================================

function inspectGlb(
  path
) {

  try {

    const buffer =
      readFileSync(
        path
      );


    if (
      buffer.length <
      20
    ) {

      return {
        valid:
          false,

        reason:
          'FILE_TOO_SMALL'
      };
    }


    const magic =
      buffer.readUInt32LE(
        0
      );


    const version =
      buffer.readUInt32LE(
        4
      );


    const declaredLength =
      buffer.readUInt32LE(
        8
      );


    if (
      magic !==
      0x46546c67
    ) {

      return {
        valid:
          false,

        reason:
          'INVALID_GLB_MAGIC',

        magic
      };
    }


    let offset =
      12;


    let json =
      null;


    const chunks =
      [];


    while (
      offset +
      8 <=
      buffer.length
    ) {

      const chunkLength =
        buffer.readUInt32LE(
          offset
        );


      const chunkType =
        buffer.readUInt32LE(
          offset +
          4
        );


      const dataStart =
        offset +
        8;


      const dataEnd =
        dataStart +
        chunkLength;


      if (
        dataEnd >
        buffer.length
      ) {

        break;
      }


      chunks.push(
        {
          chunkLength,
          chunkType
        }
      );


      if (
        chunkType ===
        0x4e4f534a
      ) {

        const text =
          buffer
            .subarray(
              dataStart,
              dataEnd
            )
            .toString(
              'utf8'
            )
            .replace(
              /\u0000+$/g,
              ''
            )
            .trim();


        json =
          JSON.parse(
            text
          );
      }


      offset =
        dataEnd;
    }


    if (
      !json
    ) {

      return {
        valid:
          false,

        reason:
          'JSON_CHUNK_NOT_FOUND',

        version,

        declaredLength,

        actualLength:
          buffer.length,

        chunks
      };
    }


    const meshes =
      Array.isArray(
        json.meshes
      )
        ? json.meshes
        : [];


    const accessors =
      Array.isArray(
        json.accessors
      )
        ? json.accessors
        : [];


    let primitiveCount =
      0;


    let positionVertexCount =
      0;


    let indexCount =
      0;


    let indexedTriangleCount =
      0;


    const positionBounds =
      {
        min:
          [
            Infinity,
            Infinity,
            Infinity
          ],

        max:
          [
            -Infinity,
            -Infinity,
            -Infinity
          ],

        observed:
          false
      };


    for (
      const mesh
      of meshes
    ) {

      for (
        const primitive
        of mesh.primitives
        ??
        []
      ) {

        primitiveCount++;


        const positionAccessorIndex =
          primitive
            ?.attributes
            ?.POSITION;


        if (
          Number.isInteger(
            positionAccessorIndex
          )
        ) {

          const accessor =
            accessors[
              positionAccessorIndex
            ];


          if (
            Number.isFinite(
              accessor?.count
            )
          ) {

            positionVertexCount +=
              accessor.count;
          }


          if (
            Array.isArray(
              accessor?.min
            )
            &&
            Array.isArray(
              accessor?.max
            )
            &&
            accessor.min.length >=
            3
            &&
            accessor.max.length >=
            3
          ) {

            positionBounds.observed =
              true;


            for (
              let axis =
                0;

              axis <
                3;

              axis++
            ) {

              positionBounds.min[
                axis
              ] =
                Math.min(
                  positionBounds.min[
                    axis
                  ],
                  accessor.min[
                    axis
                  ]
                );


              positionBounds.max[
                axis
              ] =
                Math.max(
                  positionBounds.max[
                    axis
                  ],
                  accessor.max[
                    axis
                  ]
                );
            }
          }
        }


        if (
          Number.isInteger(
            primitive.indices
          )
        ) {

          const accessor =
            accessors[
              primitive.indices
            ];


          if (
            Number.isFinite(
              accessor?.count
            )
          ) {

            indexCount +=
              accessor.count;


            const mode =
              primitive.mode
              ??
              4;


            if (
              mode ===
              4
            ) {

              indexedTriangleCount +=
                Math.floor(
                  accessor.count /
                  3
                );
            }
          }
        }
      }
    }


    return {
      valid:
        true,

      version,

      declaredLength,

      actualLength:
        buffer.length,

      chunks,

      sceneCount:
        Array.isArray(
          json.scenes
        )
          ? json.scenes.length
          : 0,

      nodeCount:
        Array.isArray(
          json.nodes
        )
          ? json.nodes.length
          : 0,

      meshCount:
        meshes.length,

      primitiveCount,

      accessorCount:
        accessors.length,

      positionVertexCount,

      indexCount,

      indexedTriangleCount,

      positionBounds:
        positionBounds.observed
          ? {
              min:
                positionBounds.min,

              max:
                positionBounds.max
            }
          : null
    };

  } catch (
    error
  ) {

    return {
      valid:
        false,

      reason:
        'GLB_INSPECTION_EXCEPTION',

      error:
        String(
          error?.stack
          ??
          error
        )
    };
  }
}


// ============================================================
// TEXT HELPERS
// ============================================================

function normalizeSlashes(
  text
) {

  return String(
    text
    ??
    ''
  ).replace(
    /\\/g,
    '/'
  );
}


function firstNonEmptyLine(
  text
) {

  return String(
    text
    ??
    ''
  )
    .split(
      /\r?\n/
    )
    .map(
      line =>
        line.trim()
    )
    .find(
      Boolean
    )
    ??
    null;
}


function truncateText(
  text,
  maximumCharacters
) {

  const value =
    String(
      text
      ??
      ''
    );


  if (
    value.length <=
    maximumCharacters
  ) {

    return value;
  }


  return `${value.slice(
    0,
    maximumCharacters
  )}\n...[truncated]`;
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
    '# Deadlock World-Physics Resource Extraction'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Purpose'
  );


  lines.push('');


  lines.push(
    'Prepare the dedicated static-world physics resource needed to distinguish genuine player-to-soul line of sight from proximity/orientation cases blocked by buildings or other map architecture.'
  );


  lines.push('');


  lines.push(
    'No LOS or opportunity classifications are produced by this script.'
  );


  lines.push('');


  lines.push(
    '## Frozen map resource'
  );


  lines.push('');


  lines.push(
    `- Map: ${summary.map.name}`
  );


  lines.push(
    `- VPK: \`${summary.map.mapVpkPath}\``
  );


  lines.push(
    `- VPK SHA256: \`${summary.map.mapVpkSha256}\``
  );


  lines.push(
    `- world_physics SHA256: \`${summary.extraction.worldPhysicsSha256}\``
  );


  lines.push('');


  lines.push(
    '## World physics export'
  );


  lines.push('');


  lines.push(
    `- GLB exists: ${summary.glbExport.exists}`
  );


  lines.push(
    `- GLB valid: ${summary.glbExport.inspection?.valid ?? false}`
  );


  lines.push(
    `- Meshes: ${summary.glbExport.inspection?.meshCount ?? 0}`
  );


  lines.push(
    `- Primitives: ${summary.glbExport.inspection?.primitiveCount ?? 0}`
  );


  lines.push(
    `- POSITION vertices: ${summary.glbExport.inspection?.positionVertexCount ?? 0}`
  );


  lines.push(
    `- Indexed-triangle diagnostic: ${summary.glbExport.inspection?.indexedTriangleCount ?? 0}`
  );


  lines.push('');


  lines.push(
    '## Interpretation'
  );


  lines.push('');


  lines.push(
    summary.interpretation.staticWorld
  );


  lines.push('');


  lines.push(
    summary.interpretation.validationGuardrail
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