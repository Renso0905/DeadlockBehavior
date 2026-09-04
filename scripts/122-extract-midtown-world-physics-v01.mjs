import {
  createHash
} from 'node:crypto';

import {
  execFileSync
} from 'node:child_process';

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';

import {
  basename,
  dirname,
  join,
  resolve
} from 'node:path';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'DL_MIDTOWN_WORLD_PHYSICS_EXTRACTION_V01';


// ============================================================
// PURPOSE
//
// Script121 strongly supported dl_midtown as the top-level map
// package used by the replay cohort.
//
// Script119 previously extracted dl_streets and inspected only:
//
//   world_physics.glb
//
// ValveResourceFormat exports embedded VMDL physics separately
// as:
//
//   world_physics_physics.glb
//
// Script122 therefore:
//
//   1. requires Script121's Midtown package resolution
//   2. freezes the local dl_midtown.vpk by SHA-256
//   3. extracts the dedicated world_physics resources
//   4. exports world_physics.vmdl_c with Source2Viewer
//   5. inspects BOTH the ordinary GLB and the separate physics GLB
//
// No LOS classification is produced here.
// No opportunity classification is produced here.
// ============================================================


// ============================================================
// CONSTANTS
// ============================================================

const MAP_NAME =
  'dl_midtown';


const SCRIPT121_PATH =
  resolve(
    'output',
    'cross_replay',
    'midtown_resource_context_resolution_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_world_physics_extraction_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'dl_midtown_world_physics_extraction_v01.md'
  );


const RESOURCE_DIRECTORY =
  resolve(
    'resources',
    MAP_NAME,
    'world_physics_v01'
  );


const REQUIRED_ENTRY_SUFFIXES =
  [
    `maps/${MAP_NAME}.vmap_c`,
    `maps/${MAP_NAME}/world.vwrld_c`,
    `maps/${MAP_NAME}/world_physics.vrman_c`,
    `maps/${MAP_NAME}/world_physics.vmdl_c`
  ];


const EXTRACTION_ENTRIES =
  [
    `maps/${MAP_NAME}/world_physics.vrman_c`,
    `maps/${MAP_NAME}/world_physics.vmdl_c`,
    `maps/${MAP_NAME}/world.vwrld_c`
  ];


// ============================================================
// ARGUMENTS
// ============================================================

const args =
  parseArgs(
    process.argv.slice(2)
  );


// ============================================================
// SCRIPT121 GUARD
// ============================================================

if (
  !existsSync(
    SCRIPT121_PATH
  )
) {

  throw new Error(
    `Missing Script121 output:\n${SCRIPT121_PATH}`
  );
}


const script121 =
  JSON.parse(
    readFileSync(
      SCRIPT121_PATH,
      'utf8'
    )
  );


const script121Ready =
  script121?.status ===
  'REPLAY_MAP_PACKAGE_IDENTITY_DL_MIDTOWN_STRONGLY_SUPPORTED'
  &&
  script121?.localResources?.localMidtownVpkExists ===
  true
  &&
  script121?.midtownVpkListing?.midtownTopLevelVmap ===
  true
  &&
  script121?.midtownVpkListing?.pulseTopLevelVmap ===
  false
  &&
  script121?.crossReplayRawTokens?.allSixRawMidtown ===
  true;


if (
  !script121Ready
) {

  throw new Error(
    [
      'Script121 has not established the required Midtown package identity.',
      `Status: ${script121?.status}`
    ].join(
      '\n'
    )
  );
}


// ============================================================
// LOCATE SOURCE2VIEWER CLI
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
      'Source2Viewer-CLI.exe not found.',
      '',
      'Expected under:',
      resolve(
        'tools',
        'source2viewer'
      ),
      '',
      'Or pass:',
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


// ============================================================
// LOCATE MIDTOWN VPK
// ============================================================

const mapVpkPath =
  args.vpk
  ??
  script121?.localResources?.midtownVpkPath
  ??
  null;


if (
  !mapVpkPath
  ||
  !existsSync(
    mapVpkPath
  )
) {

  throw new Error(
    [
      'Script121 Midtown VPK path no longer exists.',
      `Path: ${mapVpkPath ?? 'UNRESOLVED'}`,
      '',
      'You may override with:',
      '  --vpk "G:\\...\\game\\citadel\\maps\\dl_midtown.vpk"'
    ].join(
      '\n'
    )
  );
}


if (
  basename(
    mapVpkPath
  ).toLowerCase() !==
  `${MAP_NAME}.vpk`
) {

  throw new Error(
    `Refusing non-Midtown VPK:\n${mapVpkPath}`
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
  'DL_MIDTOWN WORLD-PHYSICS EXTRACTION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'MAP PACKAGE AUTHORITY'
);

console.log(
  '---------------------'
);

console.log(
  'Script121: REPLAY_MAP_PACKAGE_IDENTITY_DL_MIDTOWN_STRONGLY_SUPPORTED'
);

console.log('');

console.log(
  `Map VPK:       ${mapVpkPath}`
);

console.log(
  `Source2Viewer: ${vrfCli}`
);

console.log(
  `CLI version:   ${firstNonEmptyLine(vrfVersion.stdout) ?? 'UNRESOLVED'}`
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
// HASH MAP VPK
// ============================================================

console.log(
  'Hashing dl_midtown.vpk...'
);


const mapVpkSha256 =
  await sha256File(
    mapVpkPath
  );


// ============================================================
// LIST / VERIFY VPK CONTENTS
// ============================================================

console.log(
  'Listing dl_midtown.vpk resources...'
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
        256 *
        1024 *
        1024
    }
  );


if (
  !listResult.ok
) {

  throw new Error(
    [
      'Source2Viewer failed to list dl_midtown.vpk.',
      listResult.stderr,
      listResult.stdout
    ].join(
      '\n'
    )
  );
}


const normalizedListing =
  normalizeSlashes(
    listResult.stdout
  ).toLowerCase();


const entryChecks =
  REQUIRED_ENTRY_SUFFIXES.map(
    entry =>
      ({
        entry,

        present:
          normalizedListing.includes(
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


const missingRequiredEntries =
  entryChecks.filter(
    row =>
      !row.present
  );


if (
  missingRequiredEntries.length >
  0
) {

  throw new Error(
    `Required Midtown map resources missing: ${missingRequiredEntries.map(row => row.entry).join(', ')}`
  );
}


// ============================================================
// EXTRACT DEDICATED WORLD-PHYSICS RESOURCES
// ============================================================

mkdirSync(
  RESOURCE_DIRECTORY,
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
        RESOURCE_DIRECTORY,
        '--vpk_filepath',
        entry
      ],
      {
        maxBuffer:
          128 *
          1024 *
          1024
      }
    );


  const extractedPath =
    findFirstFileNamed(
      RESOURCE_DIRECTORY,
      basename(
        entry
      )
    );


  extractionResults.push(
    {
      entry,

      commandOk:
        result.ok,

      extractedPath,

      exists:
        Boolean(
          extractedPath
          &&
          existsSync(
            extractedPath
          )
        ),

      stdout:
        truncateText(
          result.stdout,
          3000
        ),

      stderr:
        truncateText(
          result.stderr,
          3000
        )
    }
  );
}


const worldPhysicsVmdlPath =
  findFirstFileNamed(
    RESOURCE_DIRECTORY,
    'world_physics.vmdl_c'
  );


const worldPhysicsManifestPath =
  findFirstFileNamed(
    RESOURCE_DIRECTORY,
    'world_physics.vrman_c'
  );


const worldVwrldPath =
  findFirstFileNamed(
    RESOURCE_DIRECTORY,
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
    'Midtown world_physics.vmdl_c was not successfully extracted.'
  );
}


// ============================================================
// HASH WORLD PHYSICS
// ============================================================

console.log(
  'Hashing Midtown world_physics.vmdl_c...'
);


const worldPhysicsSha256 =
  await sha256File(
    worldPhysicsVmdlPath
  );


// ============================================================
// RESOURCE SUMMARY
// ============================================================

console.log(
  'Inspecting Midtown world_physics.vmdl_c resource...'
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
    RESOURCE_DIRECTORY,
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
// GLB EXPORT
//
// IMPORTANT:
//
// For an embedded-physics VMDL, VRF writes:
//
//   requested output:          world_physics.glb
//   embedded physics output:   world_physics_physics.glb
//
// Script119 inspected only the first file.
// ============================================================

const renderGlbPath =
  resolve(
    RESOURCE_DIRECTORY,
    'world_physics.glb'
  );


const physicsGlbPath =
  resolve(
    RESOURCE_DIRECTORY,
    'world_physics_physics.glb'
  );


console.log(
  'Exporting VMDL and embedded physics to GLB...'
);


const glbExport =
  safeExecCapture(
    vrfCli,
    [
      '-i',
      worldPhysicsVmdlPath,
      '-o',
      renderGlbPath,
      '-d',
      '--gltf_export_format',
      'glb',
      '--gltf_export_extras'
    ],
    {
      maxBuffer:
        256 *
        1024 *
        1024
    }
  );


const renderGlbExists =
  existsSync(
    renderGlbPath
  );


const physicsGlbExists =
  existsSync(
    physicsGlbPath
  );


const renderInspection =
  renderGlbExists
    ? inspectGlb(
        renderGlbPath
      )
    : null;


const physicsInspection =
  physicsGlbExists
    ? inspectGlb(
        physicsGlbPath
      )
    : null;


// ============================================================
// STATUS
// ============================================================

const physicsCandidateReady =
  physicsInspection?.valid ===
  true
  &&
  physicsInspection.meshCount >
  0
  &&
  physicsInspection.primitiveCount >
  0
  &&
  physicsInspection.positionVertexCount >
  0
  &&
  physicsInspection.trianglePrimitiveCount >
  0;


const status =
  physicsCandidateReady
    ? 'DL_MIDTOWN_WORLD_PHYSICS_GLB_CANDIDATE_READY'
    : 'DL_MIDTOWN_WORLD_PHYSICS_EXPORT_REQUIRES_DIAGNOSIS';


const nextStage =
  physicsCandidateReady
    ? 'VALIDATE_GLTF_TO_REPLAY_COORDINATE_TRANSFORM_AND_SUCCESSFUL_HIT_STATIC_RAYCASTS'
    : 'DIAGNOSE_MIDTOWN_EMBEDDED_PHYSICS_EXPORT';


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

    mapAuthority:
      {
        source:
          'Script121 top-level package/resource-context resolution',

        mapName:
          MAP_NAME,

        script121Status:
          script121.status
      },

    source2Viewer:
      {
        cliPath:
          vrfCli,

        versionOutput:
          truncateText(
            vrfVersion.stdout,
            1000
          )
      },

    mapVpk:
      {
        path:
          mapVpkPath,

        bytes:
          statSync(
            mapVpkPath
          ).size,

        sha256:
          mapVpkSha256,

        entryChecks
      },

    extraction:
      {
        resourceDirectory:
          RESOURCE_DIRECTORY,

        results:
          extractionResults,

        worldPhysicsVmdlPath,

        worldPhysicsManifestPath,

        worldVwrldPath,

        worldPhysicsBytes:
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

        requestedRenderGlb:
          {
            path:
              renderGlbPath,

            exists:
              renderGlbExists,

            inspection:
              renderInspection
          },

        embeddedPhysicsGlb:
          {
            path:
              physicsGlbPath,

            exists:
              physicsGlbExists,

            inspection:
              physicsInspection
          }
      },

    interpretation:
      {
        script119Correction:
          'A zero-mesh world_physics.glb does not establish that the embedded physics failed to export. ValveResourceFormat exports embedded VMDL physics to a separate *_physics.glb file.',

        staticWorldCandidate:
          physicsCandidateReady
            ? 'The separate Midtown physics GLB contains actual geometry and is now a candidate static-occlusion substrate.'
            : 'The expected separate Midtown physics GLB did not yet provide usable geometry.',

        coordinateGuardrail:
          'The GLB coordinate system and units are not yet assumed to equal replay Source coordinates. Coordinate transform validation comes next.',

        collisionGuardrail:
          'Even geometry exported from world_physics is not yet promoted to exact soul-projectile blocking semantics. Successful-hit raycasts are the positive-control validation.',

        dynamicGuardrail:
          'Static world physics does not replace replay-time dynamic occluders such as breakables, doors, temporary walls, or stateful props.'
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
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'MIDTOWN WORLD-PHYSICS SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Map VPK SHA256:             ${mapVpkSha256}`
);

console.log(
  `world_physics bytes:        ${statSync(worldPhysicsVmdlPath).size}`
);

console.log(
  `world_physics SHA256:       ${worldPhysicsSha256}`
);

console.log('');

console.log(
  'REQUESTED MODEL GLB'
);

console.log(
  '-------------------'
);

console.log(
  `exists:                     ${renderGlbExists}`
);

console.log(
  `valid:                      ${renderInspection?.valid ?? false}`
);

console.log(
  `meshes:                     ${renderInspection?.meshCount ?? 0}`
);

console.log(
  `primitives:                 ${renderInspection?.primitiveCount ?? 0}`
);

console.log(
  `POSITION vertices:          ${renderInspection?.positionVertexCount ?? 0}`
);

console.log('');

console.log(
  'SEPARATE EMBEDDED PHYSICS GLB'
);

console.log(
  '-----------------------------'
);

console.log(
  `path:                       ${physicsGlbPath}`
);

console.log(
  `exists:                     ${physicsGlbExists}`
);

console.log(
  `valid:                      ${physicsInspection?.valid ?? false}`
);

console.log(
  `meshes:                     ${physicsInspection?.meshCount ?? 0}`
);

console.log(
  `primitives:                 ${physicsInspection?.primitiveCount ?? 0}`
);

console.log(
  `POSITION vertices:          ${physicsInspection?.positionVertexCount ?? 0}`
);

console.log(
  `triangle primitives:        ${physicsInspection?.trianglePrimitiveCount ?? 0}`
);

console.log(
  `indexed triangles*:         ${physicsInspection?.indexedTriangleCount ?? 0}`
);

console.log(
  `non-indexed triangles*:     ${physicsInspection?.nonIndexedTriangleCount ?? 0}`
);

console.log(
  `position bounds:            ${formatBounds(physicsInspection?.positionBounds)}`
);

console.log('');

console.log(
  '*Triangle counts are GLB topology diagnostics, not yet LOS validation.'
);

console.log('');

console.log(
  'PHYSICS NODE / MESH SAMPLE'
);

console.log(
  '--------------------------'
);


for (
  const row
  of physicsInspection?.meshSamples ?? []
) {

  console.log(
    `mesh=${row.meshName ?? '(unnamed)'} primitives=${row.primitives} vertices=${row.positionVertices}`
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
          'INVALID_GLB_MAGIC'
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
          'JSON_CHUNK_NOT_FOUND'
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


    const nodes =
      Array.isArray(
        json.nodes
      )
        ? json.nodes
        : [];


    let primitiveCount =
      0;


    let positionVertexCount =
      0;


    let trianglePrimitiveCount =
      0;


    let indexedTriangleCount =
      0;


    let nonIndexedTriangleCount =
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


    const meshSamples =
      [];


    for (
      let meshIndex =
        0;

      meshIndex <
        meshes.length;

      meshIndex++
    ) {

      const mesh =
        meshes[
          meshIndex
        ];


      let meshPositionVertices =
        0;


      let meshPrimitives =
        0;


      for (
        const primitive
        of mesh.primitives ??
        []
      ) {

        primitiveCount++;

        meshPrimitives++;


        const mode =
          primitive.mode ??
          4;


        if (
          mode ===
          4
        ) {

          trianglePrimitiveCount++;
        }


        const positionAccessorIndex =
          primitive?.attributes?.POSITION;


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


            meshPositionVertices +=
              accessor.count;


            if (
              mode ===
              4
              &&
              !Number.isInteger(
                primitive.indices
              )
            ) {

              nonIndexedTriangleCount +=
                Math.floor(
                  accessor.count /
                  3
                );
            }
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
            mode ===
            4
            &&
            Number.isFinite(
              accessor?.count
            )
          ) {

            indexedTriangleCount +=
              Math.floor(
                accessor.count /
                3
              );
          }
        }
      }


      if (
        meshSamples.length <
        30
      ) {

        meshSamples.push(
          {
            meshIndex,

            meshName:
              mesh.name ??
              null,

            primitives:
              meshPrimitives,

            positionVertices:
              meshPositionVertices
          }
        );
      }
    }


    const nodeSamples =
      nodes
        .slice(
          0,
          30
        )
        .map(
          (
            node,
            index
          ) =>
            ({
              nodeIndex:
                index,

              name:
                node.name ??
                null,

              mesh:
                Number.isInteger(
                  node.mesh
                )
                  ? node.mesh
                  : null,

              extras:
                node.extras ??
                null
            })
        );


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
        nodes.length,

      meshCount:
        meshes.length,

      primitiveCount,

      accessorCount:
        accessors.length,

      positionVertexCount,

      trianglePrimitiveCount,

      indexedTriangleCount,

      nonIndexedTriangleCount,

      positionBounds:
        positionBounds.observed
          ? {
              min:
                positionBounds.min,

              max:
                positionBounds.max
            }
          : null,

      meshSamples,

      nodeSamples
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
          error?.stack ??
          error
        )
    };
  }
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
// PROCESS
// ============================================================

function safeExecCapture(
  executable,
  argv,
  options =
    {}
) {

  try {

    const stdout =
      execFileSync(
        executable,
        argv,
        {
          encoding:
            'utf8',

          windowsHide:
            true,

          maxBuffer:
            options.maxBuffer ??
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
        stdout ??
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
        bufferToText(
          error?.stdout
        ),

      stderr:
        bufferToText(
          error?.stderr
        )
        ||
        String(
          error?.message ??
          error
        )
    };
  }
}


function bufferToText(
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
// ARGS / FILE DISCOVERY
// ============================================================

function parseArgs(
  argv
) {

  const result =
    {
      vrf:
        null,

      vpk:
        null
    };


  for (
    let index =
      0;

    index <
      argv.length;

    index++
  ) {

    if (
      argv[index] ===
      '--vrf'
      &&
      argv[index + 1]
    ) {

      result.vrf =
        resolve(
          argv[++index]
        );

      continue;
    }


    if (
      argv[index] ===
      '--vpk'
      &&
      argv[index + 1]
    ) {

      result.vpk =
        resolve(
          argv[++index]
        );
    }
  }


  return result;
}


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
// TEXT / FORMAT
// ============================================================

function normalizeSlashes(
  value
) {

  return String(
    value ??
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
    text ??
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
  value,
  maximumLength
) {

  const text =
    String(
      value ??
      ''
    );


  return text.length <=
    maximumLength
      ? text
      : `${text.slice(0, maximumLength)}\n...[truncated]`;
}


function formatBounds(
  bounds
) {

  if (
    !bounds
    ||
    !Array.isArray(
      bounds.min
    )
    ||
    !Array.isArray(
      bounds.max
    )
  ) {

    return 'n/a';
  }


  const min =
    bounds.min.map(
      value =>
        Number(
          value.toFixed(
            4
          )
        )
    );


  const max =
    bounds.max.map(
      value =>
        Number(
          value.toFixed(
            4
          )
        )
    );


  return `min=${JSON.stringify(min)} max=${JSON.stringify(max)}`;
}


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const physics =
    summary
      .glbExport
      .embeddedPhysicsGlb
      .inspection;


  const lines =
    [];


  lines.push(
    '# dl_midtown World Physics Extraction'
  );


  lines.push('');


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Map authority'
  );


  lines.push('');


  lines.push(
    `Script121 strongly resolved the top-level replay map package as **${summary.mapAuthority.mapName}**.`
  );


  lines.push('');


  lines.push(
    '## Frozen local resources'
  );


  lines.push('');


  lines.push(
    `- dl_midtown.vpk SHA256: \`${summary.mapVpk.sha256}\``
  );


  lines.push(
    `- world_physics.vmdl_c SHA256: \`${summary.extraction.worldPhysicsSha256}\``
  );


  lines.push('');


  lines.push(
    '## Embedded physics GLB'
  );


  lines.push('');


  lines.push(
    `- Exists: ${summary.glbExport.embeddedPhysicsGlb.exists}`
  );


  lines.push(
    `- Valid: ${physics?.valid ?? false}`
  );


  lines.push(
    `- Meshes: ${physics?.meshCount ?? 0}`
  );


  lines.push(
    `- Primitives: ${physics?.primitiveCount ?? 0}`
  );


  lines.push(
    `- POSITION vertices: ${physics?.positionVertexCount ?? 0}`
  );


  lines.push(
    `- Indexed triangle diagnostic: ${physics?.indexedTriangleCount ?? 0}`
  );


  lines.push(
    `- Position bounds: ${formatBounds(physics?.positionBounds)}`
  );


  lines.push('');


  lines.push(
    '## Guardrails'
  );


  lines.push('');


  lines.push(
    '- The GLB coordinate system/units are not yet assumed to equal replay Source coordinates.'
  );


  lines.push(
    '- The static-world physics mesh still requires successful-hit raycast validation before it is used as authoritative LOS.'
  );


  lines.push(
    '- Dynamic replay-time occluders remain a separate later layer.'
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