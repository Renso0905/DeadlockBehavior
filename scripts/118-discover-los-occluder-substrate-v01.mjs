import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
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
  'LOS_OCCLUDER_SUBSTRATE_DISCOVERY_V01';


// ============================================================
// PURPOSE
//
// Script117 established:
//
//   player
//   + moving soul
//   + distance
//   + validated eye orientation
//
// But:
//
//   geometric alignment != line of sight
//
// Example:
//
//   PLAYER ---> BUILDING XXXXX SOUL
//
// A nearby player looking toward the soul may have absolutely
// no actionable opportunity.
//
// Script118 therefore DOES NOT attempt to classify LOS yet.
//
// Instead it answers:
//
//   What world / brush / prop / wall / building collision
//   information is actually present in replay telemetry?
//
// We specifically inspect:
//
//   - CWorld
//   - CFuncBrush
//   - dynamic/static-looking props
//   - fake walls
//   - doors / buildings
//   - collision / solid / bounds fields
//   - model handles
//   - world transforms
//
// This tells us whether:
//
//   A. replay telemetry contains usable primitive bounds,
//      potentially permitting replay-only raycasting
//
// or:
//
//   B. replay telemetry contains only transforms + model handles,
//      meaning we likely need to extract compiled map/model
//      collision geometry from the local Deadlock installation.
//
// IMPORTANT:
//
// No LOS classifications are produced.
//
// No candidate from Script117 is upgraded to an opportunity.
//
// Discovery replay only.
//
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2]
  ??
  'test';


const MAX_SAMPLE_ENTITIES_PER_CLASS =
  12;


const MAX_RELEVANT_FIELDS_PER_ENTITY =
  100;


// ============================================================
// OCCLUSION-RELEVANT CLASSES
//
// Broad pattern is diagnostic only.
//
// Inclusion does NOT mean the class actually blocks bullets.
// ============================================================

const EXPLICIT_CLASS_NAMES =
  new Set(
    [
      'CWorld',
      'CFuncBrush',
      'CDynamicProp',
      'CPhysicsProp',
      'CCitadel_BreakableProp',
      'CCitadel_Destroyable_Building',
      'CCitadelPassthroughFakeWall',
      'CTriggerPassthroughFakeWall'
    ]
  );


const CLASS_NAME_PATTERN =
  /(World|Brush|Prop|Wall|Door|Building|Occlud|Block|Collision)/i;


// ============================================================
// RELEVANT FIELD PATTERNS
// ============================================================

const RELEVANT_FIELD_PATTERN =
  /(collision|solid|bounds?|mins?|maxs?|box|obb|model|mesh|hull|radius|extent|occlud|block|move.?collide|move.?type|scale|rotation)/i;


// ============================================================
// KNOWN FIELD PROBES
//
// A field not being readable does not imply it is absent from
// the engine. These are network-state probes only.
// ============================================================

const MODEL_FIELDS =
  [
    'CBodyComponent.m_hModel',
    'm_hModel',
    'm_ModelName',
    'm_iszModel'
  ];


const ROTATION_FIELDS =
  [
    'CBodyComponent.m_angRotation',
    'm_angRotation',
    'm_angAbsRotation'
  ];


const SCALE_FIELDS =
  [
    'CBodyComponent.m_flScale',
    'm_flScale'
  ];


const COLLISION_FIELDS =
  [
    'm_MoveCollide',
    'm_MoveType',

    'm_nSolidType',
    'm_usSolidFlags',
    'm_CollisionGroup',

    'm_Collision.m_nSolidType',
    'm_Collision.m_usSolidFlags',
    'm_Collision.m_CollisionGroup',

    'CCollisionProperty.m_nSolidType',
    'CCollisionProperty.m_usSolidFlags',
    'CCollisionProperty.m_CollisionGroup'
  ];


const BOUNDS_PAIRS =
  [
    [
      'm_vBoxMins',
      'm_vBoxMaxs'
    ],

    [
      'm_vecMins',
      'm_vecMaxs'
    ],

    [
      'm_vecRenderMins',
      'm_vecRenderMaxs'
    ],

    [
      'CBodyComponent.m_vecRenderMins',
      'CBodyComponent.m_vecRenderMaxs'
    ],

    [
      'm_Collision.m_vecMins',
      'm_Collision.m_vecMaxs'
    ],

    [
      'm_Collision.m_vecMinsPreScaled',
      'm_Collision.m_vecMaxsPreScaled'
    ],

    [
      'CCollisionProperty.m_vecMins',
      'CCollisionProperty.m_vecMaxs'
    ],

    [
      'CCollisionProperty.m_vecMinsPreScaled',
      'CCollisionProperty.m_vecMaxsPreScaled'
    ]
  ];


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const outputDirectory =
  resolve(
    'output',
    replayName
  );


const outputSummaryPath =
  resolve(
    outputDirectory,
    'los_occluder_substrate_discovery_v01.json'
  );


const outputSamplesPath =
  resolve(
    outputDirectory,
    'los_occluder_entity_samples_v01.jsonl'
  );


const outputMarkdownPath =
  resolve(
    outputDirectory,
    'los_occluder_substrate_discovery_v01.md'
  );


// ============================================================
// INPUT
// ============================================================

if (
  !existsSync(
    replayPath
  )
) {

  throw new Error(
    `Replay not found:\n${replayPath}`
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
  'LOS / OCCLUDER SUBSTRATE DISCOVERY V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  `Replay:                    ${replayName}`
);


console.log(
  'Purpose:                   discover raycast-relevant world telemetry'
);


console.log(
  'LOS classification:        NONE'
);


console.log(
  'Opportunity classification:NONE'
);


console.log('');


// ============================================================
// STORAGE
// ============================================================

const entities =
  new Map();


const classEventCounts =
  new Map();


const allCandidateClassNames =
  new Set();


let totalEntityMutations =
  0;


let candidateEntityMutations =
  0;


// ============================================================
// PARSER
// ============================================================

const parser =
  new Parser();


parser.registerPostInterceptor(

  InterceptorStage.ENTITY_PACKET,

  (
    demoPacket,
    messagePacket,
    events
  ) => {

    const tick =
      finite(
        demoPacket?.tick
      );


    if (
      tick ===
      null
    ) {

      return;
    }


    for (
      const event
      of events ??
      []
    ) {

      totalEntityMutations++;


      const entity =
        event?.entity;


      if (
        !entity
      ) {

        continue;
      }


      const className =
        getEntityClassName(
          entity
        );


      if (
        !className
      ) {

        continue;
      }


      if (
        !isOcclusionRelevantClass(
          className
        )
      ) {

        continue;
      }


      candidateEntityMutations++;


      allCandidateClassNames.add(
        className
      );


      increment(
        classEventCounts,
        className
      );


      const entityIndex =
        getEntityIndex(
          entity
        );


      if (
        entityIndex ===
        null
      ) {

        continue;
      }


      const key =
        `${className}|${entityIndex}`;


      let record =
        entities.get(
          key
        );


      if (
        !record
      ) {

        record =
          createEntityRecord({
            replayName,
            className,
            entityIndex,
            tick
          });


        entities.set(
          key,
          record
        );
      }


      record.eventCount++;


      record.lastTick =
        tick;


      const operation =
        decodeOperation(
          event.operation
        );


      increment(
        record.operationCounts,
        operation
      );


      const changedFields =
        extractChangedFields(
          safeGetChanges(
            event
          )
        );


      for (
        const fieldName
        of changedFields
      ) {

        record
          .allObservedFieldNames
          .add(
            fieldName
          );


        if (
          RELEVANT_FIELD_PATTERN.test(
            fieldName
          )
        ) {

          record
            .relevantFieldNames
            .add(
              fieldName
            );


          increment(
            record.relevantFieldMentions,
            fieldName
          );


          if (
            record.relevantFieldValues.size <
            MAX_RELEVANT_FIELDS_PER_ENTITY
          ) {

            const value =
              serializeValue(
                safeGetField(
                  entity,
                  fieldName
                )
              );


            if (
              value !==
              null
            ) {

              record
                .relevantFieldValues
                .set(
                  fieldName,
                  value
                );
            }
          }
        }
      }


      // ------------------------------------------------------
      // TRANSFORM
      // ------------------------------------------------------

      const position =
        getBestPosition(
          entity
        );


      if (
        position
      ) {

        record.position =
          position;


        record.positionObserved =
          true;
      }


      const rotation =
        getFirstVectorField(
          entity,
          ROTATION_FIELDS
        );


      if (
        rotation
      ) {

        record.rotation =
          rotation;


        record.rotationObserved =
          true;
      }


      const scale =
        getFirstFiniteField(
          entity,
          SCALE_FIELDS
        );


      if (
        scale !==
        null
      ) {

        record.scale =
          scale;


        record.scaleObserved =
          true;
      }


      // ------------------------------------------------------
      // MODEL
      // ------------------------------------------------------

      const model =
        getFirstScalarField(
          entity,
          MODEL_FIELDS
        );


      if (
        model !==
        null
      ) {

        record.model =
          model;


        record.modelObserved =
          true;
      }


      // ------------------------------------------------------
      // COLLISION SIGNALS
      // ------------------------------------------------------

      for (
        const fieldName
        of COLLISION_FIELDS
      ) {

        const value =
          serializeValue(
            safeGetField(
              entity,
              fieldName
            )
          );


        if (
          value ===
          null
        ) {

          continue;
        }


        record.collisionFields[
          fieldName
        ] =
          value;


        record.collisionSignalObserved =
          true;
      }


      // ------------------------------------------------------
      // DIRECT BOUNDS PROBES
      // ------------------------------------------------------

      const bounds =
        findBounds(
          entity,
          changedFields
        );


      if (
        bounds
      ) {

        record.directBounds =
          bounds;


        record.directBoundsObserved =
          true;
      }
    }
  }
);


// ============================================================
// PARSE
// ============================================================

console.log(
  'Parsing replay for world / brush / prop / collision metadata...'
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


// ============================================================
// FINALIZE ENTITY RECORDS
// ============================================================

const entityRows =
  [
    ...entities.values()
  ]
    .map(
      finalizeEntityRecord
    )
    .sort(
      (
        a,
        b
      ) =>
        a.className.localeCompare(
          b.className
        )
        ||
        a.entityIndex -
        b.entityIndex
    );


// ============================================================
// CLASS SUMMARIES
// ============================================================

const classGroups =
  groupBy(
    entityRows,
    row =>
      row.className
  );


const classSummaries =
  [];


for (
  const [
    className,
    rows
  ]
  of classGroups.entries()
) {

  const withPosition =
    rows.filter(
      row =>
        row.geometry.positionObserved
    );


  const withRotation =
    rows.filter(
      row =>
        row.geometry.rotationObserved
    );


  const withScale =
    rows.filter(
      row =>
        row.geometry.scaleObserved
    );


  const withModel =
    rows.filter(
      row =>
        row.geometry.modelObserved
    );


  const withBounds =
    rows.filter(
      row =>
        row.geometry.directBoundsObserved
    );


  const withCollision =
    rows.filter(
      row =>
        row.geometry.collisionSignalObserved
    );


  const fieldCounts =
    new Map();


  for (
    const row
    of rows
  ) {

    for (
      const fieldName
      of row.relevantFieldNames
    ) {

      increment(
        fieldCounts,
        fieldName
      );
    }
  }


  const transformRate =
    rate(
      withPosition.length,
      rows.length
    );


  const modelRate =
    rate(
      withModel.length,
      rows.length
    );


  const boundsRate =
    rate(
      withBounds.length,
      rows.length
    );


  const collisionSignalRate =
    rate(
      withCollision.length,
      rows.length
    );


  const geometryProfile =
    classifyGeometryProfile({
      rows:
        rows.length,

      transformRate,

      modelRate,

      boundsRate,

      collisionSignalRate
    });


  const rankedSamples =
    [
      ...rows
    ]
      .sort(
        (
          a,
          b
        ) =>
          geometryEvidenceScore(
            b
          )
          -
          geometryEvidenceScore(
            a
          )
          ||
          b.relevantFieldNames.length -
          a.relevantFieldNames.length
      )
      .slice(
        0,
        MAX_SAMPLE_ENTITIES_PER_CLASS
      );


  classSummaries.push(
    {
      className,

      category:
        classifyClassCategory(
          className
        ),

      uniqueEntities:
        rows.length,

      eventCount:
        classEventCounts.get(
          className
        )
        ??
        0,

      coverage:
        {
          position:
            withPosition.length,

          positionRate:
            transformRate,

          rotation:
            withRotation.length,

          rotationRate:
            rate(
              withRotation.length,
              rows.length
            ),

          scale:
            withScale.length,

          scaleRate:
            rate(
              withScale.length,
              rows.length
            ),

          model:
            withModel.length,

          modelRate,

          directBounds:
            withBounds.length,

          directBoundsRate:
            boundsRate,

          collisionSignal:
            withCollision.length,

          collisionSignalRate
        },

      geometryProfile,

      relevantFieldCounts:
        mapToSortedObject(
          fieldCounts
        ),

      sampleEntities:
        rankedSamples
    }
  );
}


classSummaries.sort(
  (
    a,
    b
  ) =>
    relevanceRank(
      a.className
    )
    -
    relevanceRank(
      b.className
    )
    ||
    b.uniqueEntities -
    a.uniqueEntities
    ||
    a.className.localeCompare(
      b.className
    )
);


// ============================================================
// WORLD-GEOMETRY ASSESSMENT
// ============================================================

const primaryWorldClasses =
  new Set(
    [
      'CWorld',
      'CFuncBrush',
      'CDynamicProp',
      'CPhysicsProp',
      'CCitadelPassthroughFakeWall',
      'CCitadel_Destroyable_Building'
    ]
  );


const primaryRows =
  entityRows.filter(
    row =>
      primaryWorldClasses.has(
        row.className
      )
  );


const primaryWithPosition =
  primaryRows.filter(
    row =>
      row.geometry.positionObserved
  );


const primaryWithModel =
  primaryRows.filter(
    row =>
      row.geometry.modelObserved
  );


const primaryWithDirectBounds =
  primaryRows.filter(
    row =>
      row.geometry.directBoundsObserved
  );


const primaryWithCollisionSignal =
  primaryRows.filter(
    row =>
      row.geometry.collisionSignalObserved
  );


const cworld =
  classSummaries.find(
    row =>
      row.className ===
      'CWorld'
  )
  ??
  null;


const cfuncbrush =
  classSummaries.find(
    row =>
      row.className ===
      'CFuncBrush'
  )
  ??
  null;


let worldGeometryMode;


if (
  primaryWithDirectBounds.length >=
  10
) {

  worldGeometryMode =
    'DIRECT_BOUNDS_CANDIDATES_PRESENT_NEEDS_RAYCAST_VALIDATION';

} else if (
  primaryWithModel.length >
  0
  ||
  cworld
  ||
  cfuncbrush
) {

  worldGeometryMode =
    'MODEL_RESOURCE_COLLISION_EXTRACTION_LIKELY_REQUIRED';

} else {

  worldGeometryMode =
    'REPLAY_WORLD_GEOMETRY_INSUFFICIENT';
}


// ============================================================
// IMPORTANT INTERPRETATION
// ============================================================

const interpretation =
  {
    worldGeometryMode,


    ifDirectBounds:
      'Direct networked bounds are candidates only. Axis-aligned or render bounds must not automatically be treated as bullet-collision geometry.',


    ifModelResourcesRequired:
      'Replay telemetry provides entity/world metadata but apparently does not directly expose enough primitive geometry for trustworthy building-level raycasts. The next stage should recover compiled map/model collision resources from the local Deadlock installation.',


    positiveControlPlan:
      'Any future LOS implementation must be validated against Script116 successful-hit anchors. A large rate of supposedly blocked successful hits would invalidate the LOS reconstruction.',


    behavioralGuardrail:
      'Script117 geometry rows remain candidate context only. No row becomes an actionable secure/deny opportunity until occlusion and weapon constraints are incorporated.'
  };


// ============================================================
// STATUS
// ============================================================

const status =
  entityRows.length >
  0
    ? 'LOS_OCCLUDER_SUBSTRATE_DISCOVERY_COMPLETE'
    : 'LOS_OCCLUDER_SUBSTRATE_DISCOVERY_FAILED';


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

    replay:
      replayName,

    status,


    purpose:
      'Determine whether replay telemetry itself contains sufficient geometry for trustworthy world-occlusion raycasts.',


    parser:
      {
        totalEntityMutations,

        candidateEntityMutations,

        candidateClasses:
          allCandidateClassNames.size,

        uniqueCandidateEntities:
          entityRows.length
      },


    worldGeometryAssessment:
      {
        mode:
          worldGeometryMode,

        primaryCandidateEntities:
          primaryRows.length,

        primaryWithPosition:
          primaryWithPosition.length,

        primaryPositionRate:
          rate(
            primaryWithPosition.length,
            primaryRows.length
          ),

        primaryWithModel:
          primaryWithModel.length,

        primaryModelRate:
          rate(
            primaryWithModel.length,
            primaryRows.length
          ),

        primaryWithDirectBounds:
          primaryWithDirectBounds.length,

        primaryDirectBoundsRate:
          rate(
            primaryWithDirectBounds.length,
            primaryRows.length
          ),

        primaryWithCollisionSignal:
          primaryWithCollisionSignal.length,

        primaryCollisionSignalRate:
          rate(
            primaryWithCollisionSignal.length,
            primaryRows.length
          ),

        cworldPresent:
          Boolean(
            cworld
          ),

        cfuncBrushPresent:
          Boolean(
            cfuncbrush
          )
      },


    classes:
      classSummaries,


    interpretation,


    nextStage:
      worldGeometryMode ===
      'DIRECT_BOUNDS_CANDIDATES_PRESENT_NEEDS_RAYCAST_VALIDATION'

        ? 'VALIDATE_DIRECT_REPLAY_OCCLUDER_PRIMITIVES_AGAINST_SUCCESSFUL_HIT_POSITIVE_CONTROLS'

        : worldGeometryMode ===
          'MODEL_RESOURCE_COLLISION_EXTRACTION_LIKELY_REQUIRED'

          ? 'EXTRACT_COMPILED_MAP_AND_MODEL_COLLISION_FROM_LOCAL_DEADLOCK_RESOURCES'

          : 'LOCATE_ALTERNATIVE_WORLD_GEOMETRY_SOURCE',


    outputs:
      {
        summary:
          outputSummaryPath,

        samples:
          outputSamplesPath,

        markdown:
          outputMarkdownPath
      }
  };


// ============================================================
// WRITE OUTPUTS
// ============================================================

mkdirSync(
  dirname(
    outputSummaryPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputSummaryPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


await writeJsonl(
  outputSamplesPath,
  entityRows
);


writeFileSync(
  outputMarkdownPath,
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
  'LOS OCCLUDER SUBSTRATE SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'PRIMARY WORLD-GEOMETRY ASSESSMENT'
);

console.log(
  '---------------------------------'
);


console.log(
  `Candidate entities:          ${primaryRows.length}`
);


console.log(
  `With world position:         ${primaryWithPosition.length} (${formatPercent(
    rate(
      primaryWithPosition.length,
      primaryRows.length
    )
  )})`
);


console.log(
  `With model handle/reference: ${primaryWithModel.length} (${formatPercent(
    rate(
      primaryWithModel.length,
      primaryRows.length
    )
  )})`
);


console.log(
  `With direct bounds:          ${primaryWithDirectBounds.length} (${formatPercent(
    rate(
      primaryWithDirectBounds.length,
      primaryRows.length
    )
  )})`
);


console.log(
  `With collision signals:      ${primaryWithCollisionSignal.length} (${formatPercent(
    rate(
      primaryWithCollisionSignal.length,
      primaryRows.length
    )
  )})`
);


console.log(
  `CWorld present:              ${Boolean(cworld)}`
);


console.log(
  `CFuncBrush present:          ${Boolean(cfuncbrush)}`
);


console.log('');

console.log(
  'CLASS PROFILES'
);

console.log(
  '--------------'
);


for (
  const row
  of classSummaries
) {

  console.log(
    `${row.className.padEnd(42)} ` +
    `n=${String(row.uniqueEntities).padEnd(5)} ` +
    `pos=${formatPercent(row.coverage.positionRate).padEnd(8)} ` +
    `model=${formatPercent(row.coverage.modelRate).padEnd(8)} ` +
    `bounds=${formatPercent(row.coverage.directBoundsRate).padEnd(8)} ` +
    `${row.geometryProfile}`
  );
}


console.log('');

console.log(
  'WORLD GEOMETRY MODE'
);

console.log(
  '-------------------'
);


console.log(
  worldGeometryMode
);


console.log('');

console.log(
  'IMPORTANT'
);

console.log(
  '---------'
);


console.log(
  'No line-of-sight classifications were produced.'
);


console.log(
  'Script117 candidates remain geometry-only candidate relations.'
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
  `JSON:\n${outputSummaryPath}`
);


console.log('');

console.log(
  `Samples:\n${outputSamplesPath}`
);


console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);


console.log('');


// ============================================================
// ENTITY RECORD
// ============================================================

function createEntityRecord({

  replayName,

  className,

  entityIndex,

  tick
}) {

  return {
    replay:
      replayName,

    className,

    category:
      classifyClassCategory(
        className
      ),

    entityIndex,

    firstTick:
      tick,

    lastTick:
      tick,

    eventCount:
      0,

    operationCounts:
      new Map(),

    allObservedFieldNames:
      new Set(),

    relevantFieldNames:
      new Set(),

    relevantFieldMentions:
      new Map(),

    relevantFieldValues:
      new Map(),

    positionObserved:
      false,

    position:
      null,

    rotationObserved:
      false,

    rotation:
      null,

    scaleObserved:
      false,

    scale:
      null,

    modelObserved:
      false,

    model:
      null,

    collisionSignalObserved:
      false,

    collisionFields:
      {},

    directBoundsObserved:
      false,

    directBounds:
      null
  };
}


function finalizeEntityRecord(
  row
) {

  return {
    replay:
      row.replay,

    className:
      row.className,

    category:
      row.category,

    entityIndex:
      row.entityIndex,

    firstTick:
      row.firstTick,

    lastTick:
      row.lastTick,

    eventCount:
      row.eventCount,

    operationCounts:
      mapToSortedObject(
        row.operationCounts
      ),

    relevantFieldNames:
      [
        ...row.relevantFieldNames
      ].sort(),

    relevantFieldMentions:
      mapToSortedObject(
        row.relevantFieldMentions
      ),

    relevantFieldValues:
      Object.fromEntries(
        [
          ...row.relevantFieldValues.entries()
        ]
          .sort(
            (
              a,
              b
            ) =>
              a[0].localeCompare(
                b[0]
              )
          )
      ),

    geometry:
      {
        positionObserved:
          row.positionObserved,

        position:
          row.position,

        rotationObserved:
          row.rotationObserved,

        rotation:
          row.rotation,

        scaleObserved:
          row.scaleObserved,

        scale:
          row.scale,

        modelObserved:
          row.modelObserved,

        model:
          row.model,

        collisionSignalObserved:
          row.collisionSignalObserved,

        collisionFields:
          row.collisionFields,

        directBoundsObserved:
          row.directBoundsObserved,

        directBounds:
          row.directBounds
      }
  };
}


// ============================================================
// CLASS FILTER / CATEGORY
// ============================================================

function isOcclusionRelevantClass(
  className
) {

  return EXPLICIT_CLASS_NAMES.has(
    className
  )
  ||
  CLASS_NAME_PATTERN.test(
    className
  );
}


function classifyClassCategory(
  className
) {

  if (
    className ===
    'CWorld'
  ) {

    return 'WORLD_CONTAINER';
  }


  if (
    /Brush/i.test(
      className
    )
  ) {

    return 'BRUSH_CANDIDATE';
  }


  if (
    /Wall|Door|Building/i.test(
      className
    )
  ) {

    return 'WALL_OR_BUILDING_CANDIDATE';
  }


  if (
    /Prop/i.test(
      className
    )
  ) {

    return 'PROP_CANDIDATE';
  }


  if (
    /Trigger/i.test(
      className
    )
  ) {

    return 'TRIGGER_CONTROL';
  }


  return 'OTHER_OCCLUSION_RELATED';
}


function relevanceRank(
  className
) {

  const order =
    [
      'CWorld',
      'CFuncBrush',
      'CDynamicProp',
      'CPhysicsProp',
      'CCitadelPassthroughFakeWall',
      'CCitadel_Destroyable_Building',
      'CCitadel_BreakableProp',
      'CTriggerPassthroughFakeWall'
    ];


  const index =
    order.indexOf(
      className
    );


  return index ===
    -1
      ? 100
      : index;
}


// ============================================================
// GEOMETRY PROFILE
// ============================================================

function classifyGeometryProfile({

  rows,

  transformRate,

  modelRate,

  boundsRate,

  collisionSignalRate
}) {

  if (
    rows <=
    0
  ) {

    return 'NO_ENTITIES';
  }


  if (
    boundsRate >=
    0.50
    &&
    transformRate >=
    0.50
  ) {

    return 'DIRECT_BOUNDS_SUBSTRATE_PRESENT';
  }


  if (
    modelRate >=
    0.50
    &&
    transformRate >=
    0.50
  ) {

    return 'MODEL_REFERENCE_PLUS_TRANSFORM';
  }


  if (
    transformRate >=
    0.50
    &&
    collisionSignalRate >=
    0.50
  ) {

    return 'COLLISION_SIGNAL_PLUS_TRANSFORM_NO_DIRECT_BOUNDS';
  }


  if (
    transformRate >=
    0.50
  ) {

    return 'TRANSFORM_ONLY';
  }


  return 'SPARSE_GEOMETRY_METADATA';
}


function geometryEvidenceScore(
  row
) {

  return (
    (
      row.geometry.directBoundsObserved
        ? 8
        : 0
    )
    +
    (
      row.geometry.collisionSignalObserved
        ? 4
        : 0
    )
    +
    (
      row.geometry.modelObserved
        ? 2
        : 0
    )
    +
    (
      row.geometry.positionObserved
        ? 1
        : 0
    )
  );
}


// ============================================================
// DIRECT BOUNDS DISCOVERY
// ============================================================

function findBounds(
  entity,
  changedFields
) {

  // ----------------------------------------------------------
  // KNOWN PAIRS
  // ----------------------------------------------------------

  for (
    const [
      minField,
      maxField
    ]
    of BOUNDS_PAIRS
  ) {

    const mins =
      normalizeVectorRaw(
        safeGetField(
          entity,
          minField
        )
      );


    const maxs =
      normalizeVectorRaw(
        safeGetField(
          entity,
          maxField
        )
      );


    if (
      mins
      &&
      maxs
    ) {

      return {
        source:
          'KNOWN_FIELD_PAIR',

        minField,

        maxField,

        mins,

        maxs
      };
    }
  }


  // ----------------------------------------------------------
  // DISCOVER MIN/MAX FIELD PAIRS FROM ACTUAL CHANGES
  // ----------------------------------------------------------

  const relevant =
    changedFields.filter(
      fieldName =>
        /(mins?|maxs?|bounds?|box|obb)/i.test(
          fieldName
        )
    );


  const minFields =
    relevant.filter(
      fieldName =>
        /mins?/i.test(
          fieldName
        )
    );


  const maxFields =
    relevant.filter(
      fieldName =>
        /maxs?/i.test(
          fieldName
        )
    );


  for (
    const minField
    of minFields
  ) {

    const mins =
      normalizeVectorRaw(
        safeGetField(
          entity,
          minField
        )
      );


    if (
      !mins
    ) {

      continue;
    }


    for (
      const maxField
      of maxFields
    ) {

      const maxs =
        normalizeVectorRaw(
          safeGetField(
            entity,
            maxField
          )
        );


      if (
        !maxs
      ) {

        continue;
      }


      return {
        source:
          'DISCOVERED_CHANGED_FIELD_PAIR',

        minField,

        maxField,

        mins,

        maxs
      };
    }
  }


  return null;
}


// ============================================================
// TRANSFORM
// ============================================================

function getBestPosition(
  entity
) {

  const cell =
    getCellWorldPosition(
      entity
    );


  if (
    cell
  ) {

    return cell;
  }


  for (
    const fieldName
    of [
      'CGameSceneNode.m_vecOrigin',
      'CBodyComponent.m_vecAbsOrigin',
      'm_vecAbsOrigin',
      'm_vecOrigin'
    ]
  ) {

    const value =
      normalizeVectorRaw(
        safeGetField(
          entity,
          fieldName
        )
      );


    if (
      value
    ) {

      return value;
    }
  }


  return null;
}


function getCellWorldPosition(
  entity
) {

  const cellX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellX'
      )
    );


  const cellY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellY'
      )
    );


  const cellZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellZ'
      )
    );


  const vecX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecX'
      )
    );


  const vecY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecY'
      )
    );


  const vecZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecZ'
      )
    );


  if (
    cellX ===
    null
    ||
    cellY ===
    null
    ||
    vecX ===
    null
    ||
    vecY ===
    null
  ) {

    return null;
  }


  return {
    x:
      cellX *
      512
      -
      16384
      +
      vecX,

    y:
      cellY *
      512
      -
      16384
      +
      vecY,

    z:
      cellZ !==
      null
      &&
      vecZ !==
      null

        ? cellZ *
          512
          -
          16384
          +
          vecZ

        : 0
  };
}


// ============================================================
// FIELD HELPERS
// ============================================================

function getFirstVectorField(
  entity,
  fieldNames
) {

  for (
    const fieldName
    of fieldNames
  ) {

    const value =
      normalizeVectorRaw(
        safeGetField(
          entity,
          fieldName
        )
      );


    if (
      value
    ) {

      return {
        field:
          fieldName,

        value
      };
    }
  }


  return null;
}


function getFirstFiniteField(
  entity,
  fieldNames
) {

  for (
    const fieldName
    of fieldNames
  ) {

    const value =
      finite(
        safeGetField(
          entity,
          fieldName
        )
      );


    if (
      value !==
      null
    ) {

      return value;
    }
  }


  return null;
}


function getFirstScalarField(
  entity,
  fieldNames
) {

  for (
    const fieldName
    of fieldNames
  ) {

    const raw =
      safeGetField(
        entity,
        fieldName
      );


    const value =
      serializeScalar(
        raw
      );


    if (
      value !==
      null
    ) {

      return {
        field:
          fieldName,

        value
      };
    }
  }


  return null;
}


function safeGetField(
  entity,
  fieldName
) {

  try {

    return typeof entity?.getField ===
      'function'

      ? entity.getField(
          fieldName
        )

      : undefined;

  } catch {

    return undefined;
  }
}


function safeGetChanges(
  event
) {

  try {

    if (
      typeof event?.getChanges ===
      'function'
    ) {

      return event.getChanges();
    }

  } catch {}


  return event?.changes
    ??
    event?.changedFields
    ??
    event?.fields
    ??
    null;
}


function extractChangedFields(
  raw
) {

  if (
    raw ===
    null
    ||
    raw ===
    undefined
  ) {

    return [];
  }


  if (
    Array.isArray(
      raw
    )
  ) {

    return [
      ...new Set(
        raw
          .map(
            row => {

              if (
                typeof row ===
                'string'
              ) {

                return row;
              }


              if (
                Array.isArray(
                  row
                )
              ) {

                return row[0];
              }


              return row?.fieldName
                ??
                row?.name
                ??
                row?.key
                ??
                row?.path
                ??
                null;
            }
          )
          .filter(
            Boolean
          )
          .map(
            String
          )
      )
    ];
  }


  if (
    typeof raw ===
    'object'
  ) {

    return Object.keys(
      raw
    );
  }


  return [];
}


// ============================================================
// ENTITY HELPERS
// ============================================================

function getEntityClassName(
  entity
) {

  try {

    if (
      typeof entity?.getClassName ===
      'function'
    ) {

      const value =
        entity.getClassName();


      if (
        value
      ) {

        return String(
          value
        );
      }
    }

  } catch {}


  return entity?.className
    ??
    entity?.class?.name
    ??
    entity?._className
    ??
    null;
}


function getEntityIndex(
  entity
) {

  const direct =
    finite(
      entity?.index
      ??
      entity?.entityIndex
    );


  if (
    direct !==
    null
  ) {

    return direct;
  }


  try {

    return typeof entity?.getIndex ===
      'function'

      ? finite(
          entity.getIndex()
        )

      : null;

  } catch {

    return null;
  }
}


function decodeOperation(
  operation
) {

  const text =
    String(
      operation?._code
      ??
      operation?.code
      ??
      operation
      ??
      'UNKNOWN'
    ).toUpperCase();


  for (
    const name
    of [
      'CREATE',
      'UPDATE',
      'LEAVE',
      'DELETE'
    ]
  ) {

    if (
      text.includes(
        name
      )
    ) {

      return name;
    }
  }


  return text;
}


// ============================================================
// SERIALIZATION
// ============================================================

function serializeScalar(
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
    'bigint'
  ) {

    return value.toString();
  }


  if (
    [
      'string',
      'number',
      'boolean'
    ].includes(
      typeof value
    )
  ) {

    return value;
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
      value._id
      ??
      value.id
      ??
      null;


    if (
      candidate !==
      null
      &&
      candidate !==
      undefined
    ) {

      return serializeScalar(
        candidate
      );
    }
  }


  return null;
}


function serializeValue(
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


  const scalar =
    serializeScalar(
      value
    );


  if (
    scalar !==
    null
  ) {

    return scalar;
  }


  const vector =
    normalizeVectorRaw(
      value
    );


  if (
    vector
  ) {

    return vector;
  }


  if (
    typeof value ===
    'object'
  ) {

    try {

      return JSON.parse(
        JSON.stringify(
          value,
          (
            key,
            child
          ) =>
            typeof child ===
            'bigint'
              ? child.toString()
              : child
        )
      );

    } catch {

      return String(
        value
      );
    }
  }


  return String(
    value
  );
}


function normalizeVectorRaw(
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


  let x =
    null;


  let y =
    null;


  let z =
    null;


  if (
    Array.isArray(
      value
    )
  ) {

    x =
      finite(
        value[0]
      );


    y =
      finite(
        value[1]
      );


    z =
      finite(
        value[2]
      );

  } else if (
    typeof value ===
    'object'
  ) {

    x =
      firstFinite(
        [
          value.x,
          value.X,
          value[0],
          value['0'],
          value.c0
        ]
      );


    y =
      firstFinite(
        [
          value.y,
          value.Y,
          value[1],
          value['1'],
          value.c1
        ]
      );


    z =
      firstFinite(
        [
          value.z,
          value.Z,
          value[2],
          value['2'],
          value.c2
        ]
      );
  }


  if (
    x ===
    null
    ||
    y ===
    null
  ) {

    return null;
  }


  return {
    x,

    y,

    z:
      z
      ??
      0
  };
}


// ============================================================
// COLLECTION
// ============================================================

function groupBy(
  rows,
  selector
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      selector(
        row
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        []
      );
    }


    map.get(
      key
    ).push(
      row
    );
  }


  return map;
}


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
// FILE OUTPUT
// ============================================================

async function writeJsonl(
  path,
  rows
) {

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
  );


  const writer =
    createWriteStream(
      path,
      {
        encoding:
          'utf8'
      }
    );


  for (
    const row
    of rows
  ) {

    writer.write(
      `${JSON.stringify(row)}\n`
    );
  }


  await new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {

      writer.on(
        'error',
        rejectPromise
      );


      writer.on(
        'finish',
        resolvePromise
      );


      writer.end();
    }
  );
}


// ============================================================
// NUMERIC
// ============================================================

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


function rate(
  numerator,
  denominator
) {

  if (
    !Number.isFinite(
      numerator
    )
    ||
    !Number.isFinite(
      denominator
    )
    ||
    denominator <=
    0
  ) {

    return null;
  }


  return numerator /
    denominator;
}


// ============================================================
// FORMAT
// ============================================================

function formatPercent(
  value
) {

  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(
        2
      )}%`
    : 'n/a';
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
    '# LOS / Occluder Substrate Discovery'
  );


  lines.push('');


  lines.push(
    `Replay: **${summary.replay}**`
  );


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Purpose'
  );


  lines.push('');


  lines.push(
    'Determine whether replay network telemetry itself contains sufficient physical world geometry for trustworthy player-to-soul line-of-sight raycasts.'
  );


  lines.push('');


  lines.push(
    'No line-of-sight or opportunity labels are produced by this script.'
  );


  lines.push('');


  lines.push(
    '## World geometry assessment'
  );


  lines.push('');


  lines.push(
    `Mode: **${summary.worldGeometryAssessment.mode}**`
  );


  lines.push('');


  lines.push(
    `- Primary candidate entities: ${summary.worldGeometryAssessment.primaryCandidateEntities}`
  );


  lines.push(
    `- Position coverage: ${formatPercent(summary.worldGeometryAssessment.primaryPositionRate)}`
  );


  lines.push(
    `- Model-reference coverage: ${formatPercent(summary.worldGeometryAssessment.primaryModelRate)}`
  );


  lines.push(
    `- Direct-bounds coverage: ${formatPercent(summary.worldGeometryAssessment.primaryDirectBoundsRate)}`
  );


  lines.push(
    `- Collision-signal coverage: ${formatPercent(summary.worldGeometryAssessment.primaryCollisionSignalRate)}`
  );


  lines.push(
    `- CWorld present: ${summary.worldGeometryAssessment.cworldPresent}`
  );


  lines.push(
    `- CFuncBrush present: ${summary.worldGeometryAssessment.cfuncBrushPresent}`
  );


  lines.push('');


  lines.push(
    '## Class profiles'
  );


  lines.push('');


  for (
    const row
    of summary.classes
  ) {

    lines.push(
      `### ${row.className}`
    );


    lines.push('');


    lines.push(
      `- Unique entities: ${row.uniqueEntities}`
    );


    lines.push(
      `- Position: ${formatPercent(row.coverage.positionRate)}`
    );


    lines.push(
      `- Model: ${formatPercent(row.coverage.modelRate)}`
    );


    lines.push(
      `- Direct bounds: ${formatPercent(row.coverage.directBoundsRate)}`
    );


    lines.push(
      `- Collision signal: ${formatPercent(row.coverage.collisionSignalRate)}`
    );


    lines.push(
      `- Profile: \`${row.geometryProfile}\``
    );


    lines.push('');
  }


  lines.push(
    '## Guardrail'
  );


  lines.push('');


  lines.push(
    'Render bounds, fog-volume bounds, trigger bounds, or generic entity boxes must not automatically be interpreted as bullet-blocking world collision.'
  );


  lines.push('');


  lines.push(
    'Any later LOS model must be validated against known successful soul-hit paths.'
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