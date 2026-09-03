import {
  createReadStream,
  existsSync,
  mkdirSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

import {
  createInterface
} from 'node:readline';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );


const outputPath =
  resolve(
    'output',
    replayName,
    'player_facing_angle_semantics_validation_v02.json'
  );


// ============================================================
// MOVEMENT SETTINGS
// ============================================================

const MIN_DISPLACEMENT_HU =
  60;


const MAX_INTERVAL_SECONDS =
  0.40;


// ============================================================
// COMPONENT-SEMANTIC SETTINGS
//
// V01 BUG:
//
// Cross-field mapping was allowed to select invariant components.
//
// Because:
//
//   eye component 2    = 0
//   camera component 2 = 0
//
// the optimizer found a mathematically perfect:
//
//   2 -> 2
//
// mapping and incorrectly promoted component 2 as yaw.
//
// V02 explicitly separates:
//
//   VARIABLE COMPONENTS
//
// from:
//
//   CONSTANT / DEGENERATE COMPONENTS
//
// before doing any semantic selection.
// ============================================================

const CONSTANT_RANGE_EPSILON_DEG =
  0.5;


const YAW_MIN_RANGE_DEG =
  90;


// ============================================================
// ANGLE FIELDS
// ============================================================

const ANGLE_FIELDS = [

  {
    id:
      'BODY_ROTATION',

    get:
      row =>
        row
          ?.pawn
          ?.bodyRotation
  },

  {
    id:
      'EYE_ANGLES',

    get:
      row =>
        row
          ?.pawn
          ?.eyeAngles
  },

  {
    id:
      'CAMERA_ANGLES',

    get:
      row =>
        row
          ?.pawn
          ?.cameraAngles
  }
];


// ============================================================
// WORLD-YAW TRANSFORMS
//
// movementHeading:
//
//   atan2(dy, dx)
//
// Candidate relation:
//
//   heading = sign * yaw + offset
// ============================================================

const YAW_TRANSFORMS =
  [];


for (
  const sign
  of [
    1,
    -1
  ]
) {

  for (
    const offset
    of [
      0,
      90,
      180,
      270
    ]
  ) {

    YAW_TRANSFORMS.push({

      id:
        `${sign === 1 ? 'PLUS' : 'MINUS'}_YAW_${offset}`,

      sign,

      offset
    });
  }
}


// ============================================================
// INPUT CHECK
// ============================================================

if (
  !existsSync(
    playerStatePath
  )
) {

  throw new Error(
    `Missing required input:\n${playerStatePath}`
  );
}


// ============================================================
// TRACKING
// ============================================================

let inputRows =
  0;


let pawnRows =
  0;


let movementValidRows =
  0;


const componentValues =
  {};


for (
  const field
  of ANGLE_FIELDS
) {

  componentValues[
    field.id
  ] = [

    [],
    [],
    []
  ];
}


const pairSamples = {

  BODY_EYE:
    [],

  BODY_CAMERA:
    [],

  EYE_CAMERA:
    []
};


const previousByPlayer =
  new Map();


const movementSamples =
  [];


// ============================================================
// LOAD
// ============================================================

console.log('');

console.log(
  'Loading player_state.jsonl...'
);


const reader =
  createInterface({

    input:
      createReadStream(
        playerStatePath,
        {
          encoding:
            'utf8'
        }
      ),

    crlfDelay:
      Infinity
  });


for await (
  const line
  of reader
) {

  if (
    !line.trim()
  ) {

    continue;
  }


  let row;


  try {

    row =
      JSON.parse(
        line
      );

  } catch {

    continue;
  }


  inputRows++;


  if (
    !row?.pawn
  ) {

    continue;
  }


  pawnRows++;


  const angles =
    {};


  // ----------------------------------------------------------
  // ANGLES
  // ----------------------------------------------------------

  for (
    const field
    of ANGLE_FIELDS
  ) {

    const triple =
      normalizeAngleTriple(
        field.get(
          row
        )
      );


    angles[
      field.id
    ] =
      triple;


    if (
      !triple
    ) {

      continue;
    }


    for (
      let component =
        0;

      component <
        3;

      component++
    ) {

      componentValues[
        field.id
      ][
        component
      ].push(
        triple[
          component
        ]
      );
    }
  }


  // ----------------------------------------------------------
  // CROSS-FIELD PAIRS
  // ----------------------------------------------------------

  addPair(
    pairSamples.BODY_EYE,
    angles.BODY_ROTATION,
    angles.EYE_ANGLES
  );


  addPair(
    pairSamples.BODY_CAMERA,
    angles.BODY_ROTATION,
    angles.CAMERA_ANGLES
  );


  addPair(
    pairSamples.EYE_CAMERA,
    angles.EYE_ANGLES,
    angles.CAMERA_ANGLES
  );


  // ----------------------------------------------------------
  // MOVEMENT
  // ----------------------------------------------------------

  const playerName =
    row
      ?.controller
      ?.playerName ??
    null;


  const team =
    finite(
      row
        ?.controller
        ?.team
    );


  const tick =
    finite(
      row?.demoTick
    );


  const time =
    finite(
      row
        ?.matchTimeSeconds
    );


  const position =
    normalizePosition(
      row
        ?.pawn
        ?.positionWorld
    );


  const validMovement =
    row
      ?.pawn
      ?.positionValidForMovement ===
    true;


  if (
    !playerName
    ||
    team ===
      null
    ||
    tick ===
      null
    ||
    time ===
      null
    ||
    !position
    ||
    !validMovement
  ) {

    continue;
  }


  movementValidRows++;


  const key =
    `${playerName}|${team}`;


  const previous =
    previousByPlayer.get(
      key
    )
    ??
    null;


  previousByPlayer.set(
    key,
    {

      tick,

      time,

      position,

      angles
    }
  );


  if (
    !previous
  ) {

    continue;
  }


  const dt =
    time -
    previous.time;


  if (
    !Number.isFinite(
      dt
    )
    ||
    dt <=
      0
    ||
    dt >
      MAX_INTERVAL_SECONDS
  ) {

    continue;
  }


  const dx =
    position.x -
    previous.position.x;


  const dy =
    position.y -
    previous.position.y;


  const displacement =
    Math.sqrt(
      dx *
        dx
      +
      dy *
        dy
    );


  if (
    displacement <
    MIN_DISPLACEMENT_HU
  ) {

    continue;
  }


  const movementHeading =
    normalizeDegrees(
      radiansToDegrees(
        Math.atan2(
          dy,
          dx
        )
      )
    );


  movementSamples.push({

    playerName,

    team,

    tick,

    time,

    displacement,

    movementHeading,

    angles:
      previous.angles
  });
}


// ============================================================
// FIELD STRUCTURE
// ============================================================

const fieldStructure =
  {};


for (
  const field
  of ANGLE_FIELDS
) {

  const components =
    componentValues[
      field.id
    ]
    .map(
      (
        values,
        component
      ) => {

        const linear =
          summarizeLinear(
            values
          );


        const circular =
          summarizeCircular(
            values
          );


        const constant =
          Number.isFinite(
            linear.range
          )
          &&
          linear.range <=
          CONSTANT_RANGE_EPSILON_DEG;


        return {

          component,

          ...linear,

          circular,

          constant,

          variable:
            !constant
        };
      }
    );


  const semanticInference =
    inferFieldSemantics(
      components
    );


  fieldStructure[
    field.id
  ] = {

    components,

    semanticInference
  };
}


// ============================================================
// RESOLVED STRUCTURAL COMPONENTS
// ============================================================

const yawComponents = {};


const pitchComponents = {};


for (
  const field
  of ANGLE_FIELDS
) {

  yawComponents[
    field.id
  ] =
    fieldStructure[
      field.id
    ]
      .semanticInference
      .yaw
      ?.component ??
    null;


  pitchComponents[
    field.id
  ] =
    fieldStructure[
      field.id
    ]
      .semanticInference
      .pitch
      ?.component ??
    null;
}


// ============================================================
// DIRECT YAW COMPARISONS
//
// No optimizer is permitted to substitute a constant component.
//
// We compare:
//
//   inferred yaw ↔ inferred yaw
//
// directly.
// ============================================================

const yawAgreement = {

  BODY_VS_EYE:
    compareComponents(
      pairSamples.BODY_EYE,
      yawComponents.BODY_ROTATION,
      yawComponents.EYE_ANGLES
    ),


  BODY_VS_CAMERA:
    compareComponents(
      pairSamples.BODY_CAMERA,
      yawComponents.BODY_ROTATION,
      yawComponents.CAMERA_ANGLES
    ),


  EYE_VS_CAMERA:
    compareComponents(
      pairSamples.EYE_CAMERA,
      yawComponents.EYE_ANGLES,
      yawComponents.CAMERA_ANGLES
    )
};


// ============================================================
// DIRECT PITCH COMPARISON
//
// Body pitch may legitimately remain unresolved because its
// non-yaw components are constant.
//
// Eye/camera pitch is independently useful.
// ============================================================

const pitchAgreement = {

  EYE_VS_CAMERA:
    compareComponents(
      pairSamples.EYE_CAMERA,
      pitchComponents.EYE_ANGLES,
      pitchComponents.CAMERA_ANGLES
    )
};


// ============================================================
// NON-DEGENERATE CROSS-FIELD SEARCH
//
// Diagnostic only.
//
// Searches VARIABLE components only.
//
// This exists to verify that yaw-to-yaw wins once constant fields
// cannot cheat the optimizer.
// ============================================================

const variablePairSearch = {

  BODY_EYE:
    analyzeVariableComponentMappings(
      pairSamples.BODY_EYE,
      fieldStructure.BODY_ROTATION.components,
      fieldStructure.EYE_ANGLES.components
    ),


  BODY_CAMERA:
    analyzeVariableComponentMappings(
      pairSamples.BODY_CAMERA,
      fieldStructure.BODY_ROTATION.components,
      fieldStructure.CAMERA_ANGLES.components
    ),


  EYE_CAMERA:
    analyzeVariableComponentMappings(
      pairSamples.EYE_CAMERA,
      fieldStructure.EYE_ANGLES.components,
      fieldStructure.CAMERA_ANGLES.components
    )
};


// ============================================================
// MOVEMENT-HEADING FIT
//
// ONLY the structurally inferred yaw component is tested.
//
// V01 searched all components, which was useful diagnostically,
// but V02 deliberately separates:
//
//   component discovery
//
// from:
//
//   world-coordinate anchoring.
// ============================================================

const movementFit =
  {};


for (
  const field
  of ANGLE_FIELDS
) {

  const yawComponent =
    yawComponents[
      field.id
    ];


  movementFit[
    field.id
  ] =
    evaluateMovementTransforms(
      field.id,
      yawComponent
    );
}


// ============================================================
// WORLD-YAW CONSISTENCY
// ============================================================

const validMovementFits =
  Object
    .values(
      movementFit
    )
    .filter(
      row =>
        row
        &&
        row.count >=
        1000
    );


const transformIds =
  new Set(
    validMovementFits.map(
      row =>
        row.transform
    )
  );


const allFieldsSameWorldTransform =
  validMovementFits.length ===
    3
  &&
  transformIds.size ===
    1;


const bodyMovementFit =
  movementFit
    .BODY_ROTATION;


const eyeMovementFit =
  movementFit
    .EYE_ANGLES;


const cameraMovementFit =
  movementFit
    .CAMERA_ANGLES;


const bodyWorldYawStrong =
  bodyMovementFit
  &&
  bodyMovementFit.count >=
    1000
  &&
  bodyMovementFit.error.median <=
    20
  &&
  bodyMovementFit.within45 >=
    0.70;


const eyeWorldYawStrong =
  eyeMovementFit
  &&
  eyeMovementFit.count >=
    1000
  &&
  eyeMovementFit.error.median <=
    20
  &&
  eyeMovementFit.within45 >=
    0.70;


const cameraWorldYawSupported =
  cameraMovementFit
  &&
  cameraMovementFit.count >=
    1000
  &&
  cameraMovementFit.error.median <=
    25
  &&
  cameraMovementFit.within45 >=
    0.65;


const worldYawConventionStrong =
  allFieldsSameWorldTransform
  &&
  bodyWorldYawStrong
  &&
  eyeWorldYawStrong
  &&
  cameraWorldYawSupported;


// ============================================================
// FIELD-RELATION FLAGS
// ============================================================

const eyeCameraYaw =
  yawAgreement
    .EYE_VS_CAMERA;


const bodyEyeYaw =
  yawAgreement
    .BODY_VS_EYE;


const bodyCameraYaw =
  yawAgreement
    .BODY_VS_CAMERA;


const eyeCameraPitch =
  pitchAgreement
    .EYE_VS_CAMERA;


// "Strongly linked" deliberately requires much more than merely
// sharing a yaw component.

const eyeCameraYawStronglyLinked =
  eyeCameraYaw
  &&
  eyeCameraYaw.count >=
    1000
  &&
  eyeCameraYaw.error.median <=
    10
  &&
  eyeCameraYaw.error.p95 <=
    45;


const bodyEyeYawStronglyLinked =
  bodyEyeYaw
  &&
  bodyEyeYaw.count >=
    1000
  &&
  bodyEyeYaw.error.median <=
    15;


const bodyCameraYawStronglyLinked =
  bodyCameraYaw
  &&
  bodyCameraYaw.count >=
    1000
  &&
  bodyCameraYaw.error.median <=
    20;


const eyeCameraPitchStronglyLinked =
  eyeCameraPitch
  &&
  eyeCameraPitch.count >=
    1000
  &&
  eyeCameraPitch.error.median <=
    10;


// ============================================================
// DEGENERACY CHECKS
// ============================================================

const yawComponentsNonConstant =
  ANGLE_FIELDS.every(
    field => {

      const yaw =
        yawComponents[
          field.id
        ];


      if (
        !Number.isInteger(
          yaw
        )
      ) {

        return false;
      }


      return fieldStructure[
        field.id
      ]
        .components[
          yaw
        ]
        .constant ===
        false;
    }
  );


const yawComponentsBroad =
  ANGLE_FIELDS.every(
    field => {

      const yaw =
        yawComponents[
          field.id
        ];


      if (
        !Number.isInteger(
          yaw
        )
      ) {

        return false;
      }


      return fieldStructure[
        field.id
      ]
        .components[
          yaw
        ]
        .range >=
        YAW_MIN_RANGE_DEG;
    }
  );


// ============================================================
// AIM / VIEW STATUS
//
// Even if m_angEyeAngles clearly behaves like a world yaw/pitch
// orientation, we are NOT yet calling it weapon aim.
//
// The appropriate next validation is against attack/shot
// telemetry.
//
// ============================================================

const viewOrientationStructurallyResolved =
  Number.isInteger(
    yawComponents.EYE_ANGLES
  )
  &&
  Number.isInteger(
    pitchComponents.EYE_ANGLES
  )
  &&
  worldYawConventionStrong;


const readyForShotLinkedValidation =
  viewOrientationStructurallyResolved;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks = {

  inputRowsPresent:
    check(
      inputRows,
      '>0',
      inputRows >
      0
    ),


  pawnRowsPresent:
    check(
      pawnRows,
      '>0',
      pawnRows >
      0
    ),


  movementSamplesPresent:
    check(
      movementSamples.length,
      '>1000',
      movementSamples.length >
      1000
    ),


  bodyYawResolved:
    check(
      yawComponents
        .BODY_ROTATION,
      'resolved',
      Number.isInteger(
        yawComponents
          .BODY_ROTATION
      )
    ),


  eyeYawResolved:
    check(
      yawComponents
        .EYE_ANGLES,
      'resolved',
      Number.isInteger(
        yawComponents
          .EYE_ANGLES
      )
    ),


  cameraYawResolved:
    check(
      yawComponents
        .CAMERA_ANGLES,
      'resolved',
      Number.isInteger(
        yawComponents
          .CAMERA_ANGLES
      )
    ),


  yawComponentsNonConstant:
    check(
      yawComponentsNonConstant,
      true,
      yawComponentsNonConstant
    ),


  yawComponentsBroad:
    check(
      yawComponentsBroad,
      true,
      yawComponentsBroad
    ),


  directYawComparisonsPresent:
    check(
      Boolean(
        bodyEyeYaw
        &&
        bodyCameraYaw
        &&
        eyeCameraYaw
      ),
      true,
      Boolean(
        bodyEyeYaw
        &&
        bodyCameraYaw
        &&
        eyeCameraYaw
      )
    ),


  movementFitsResolved:
    check(
      validMovementFits.length,
      3,
      validMovementFits.length ===
      3
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


// ============================================================
// STATUS
// ============================================================

let status;


if (
  !validationPass
) {

  status =
    'PIPELINE_VALIDATION_FAILURE';

} else if (
  worldYawConventionStrong
  &&
  viewOrientationStructurallyResolved
) {

  status =
    'YAW_COMPONENT_AND_WORLD_CONVENTION_STRONGLY_SUPPORTED';

} else if (
  yawComponentsNonConstant
  &&
  yawComponentsBroad
) {

  status =
    'ANGLE_COMPONENT_STRUCTURE_SUPPORTED_WORLD_CONVENTION_PROVISIONAL';

} else {

  status =
    'ANGLE_SEMANTICS_UNRESOLVED';
}


// ============================================================
// WORLD CONVENTION
// ============================================================

const bestWorldTransform =
  worldYawConventionStrong
    ? bodyMovementFit
    : null;


const worldYawConvention =
  bestWorldTransform
    ? {

      yawComponentByField:
        yawComponents,

      sign:
        bestWorldTransform.sign,

      offsetDegrees:
        bestWorldTransform.offset,

      transform:
        bestWorldTransform.transform,

      coordinateInterpretation:
        bestWorldTransform.sign ===
          1
        &&
        bestWorldTransform.offset ===
          0
          ? {

            yaw0:
              '+X',

            yaw90:
              '+Y',

            yaw180:
              '-X',

            yaw270:
              '-Y'
          }
          : null,

      semanticStatus:
        'MOVEMENT_ANCHORED_SINGLE_REPLAY_WORLD_YAW_CONVENTION'
    }
    : null;


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  replay:
    replayName,

  version:
    'PLAYER_FACING_ANGLE_SEMANTICS_VALIDATION_V02',

  supersedes:
    'PLAYER_FACING_ANGLE_SEMANTICS_VALIDATION_V01',

  canonical:
    false,

  status,


  v01Correction: {

    issue:
      'V01 allowed invariant angle components to win cross-field component matching.',

    concreteFailure:
      'EYE_ANGLES component 2 and CAMERA_ANGLES component 2 were constant zero, producing a trivial 0-degree pair error and being incorrectly selected as yaw.',

    correction:
      'V02 excludes constant components from semantic mapping and independently infers yaw from non-degenerate circular structure before cross-field comparison.',

    v01SemanticStatusWithdrawn:
      true
  },


  purpose: [

    'Correct V01 constant-component degeneracy.',

    'Identify yaw-like components from non-degenerate angular structure.',

    'Identify eye/camera pitch candidates separately from yaw.',

    'Compare body, eye, and camera yaw directly rather than optimizing over arbitrary component pairs.',

    'Anchor the world-yaw sign and axis convention using observed movement heading.',

    'Determine whether m_angEyeAngles is ready for direct attack/shot-linked semantic validation.'
  ],


  semanticLimits: {

    yaw:
      'Yaw-like behavior and world-coordinate alignment do not by themselves prove weapon-ray or targeting semantics.',

    movement:
      'Movement heading is an imperfect external anchor because Deadlock permits strafing, backpedaling, dashing, sliding, knockback, and movement abilities.',

    body:
      'Body rotation is interpreted only as an orientation field whose yaw is movement-aligned; exact animation/model-facing semantics remain separate.',

    eye:
      'm_angEyeAngles is a strong candidate for player view/aim orientation but exact weapon-aim semantics require attack-linked validation.',

    camera:
      'm_angClientCamera can legitimately diverge from eye/aim orientation because Deadlock uses a third-person camera.',

    pitch:
      'Eye/camera pitch component identification is structural until validated against a 3D target or shot direction.',

    canonical:
      'All results remain single-replay operational validation.'
  },


  input: {

    playerStatePath,

    inputRows,

    pawnRows,

    movementValidRows,

    movementSamples:
      movementSamples.length,

    minimumDisplacementHU:
      MIN_DISPLACEMENT_HU
  },


  fieldStructure,


  resolvedComponents: {

    yaw:
      yawComponents,

    pitch:
      pitchComponents
  },


  directYawAgreement:
    yawAgreement,


  directPitchAgreement:
    pitchAgreement,


  nonDegenerateCrossFieldSearch:
    variablePairSearch,


  movementHeadingFit:
    movementFit,


  worldYawConvention,


  interpretation: {

    yawComponentsNonConstant,

    yawComponentsBroad,

    allFieldsSameWorldTransform,

    bodyWorldYawStrong,

    eyeWorldYawStrong,

    cameraWorldYawSupported,

    worldYawConventionStrong,

    eyeCameraYawStronglyLinked,

    bodyEyeYawStronglyLinked,

    bodyCameraYawStronglyLinked,

    eyeCameraPitchStronglyLinked,

    viewOrientationStructurallyResolved,

    readyForShotLinkedValidation
  },


  interpretationGuide: {

    component1:
      'If all three fields resolve component 1 as yaw and all three movement fits prefer PLUS_YAW_0, component 1 is strongly supported as world yaw.',

    bodyEye:
      'Small body-eye yaw error would imply the body orientation usually tracks view direction; large error would establish a useful distinction between body facing and view orientation.',

    eyeCamera:
      'Small eye-camera yaw/pitch error would support camera alignment with view. Larger systematic differences would be expected from independent third-person camera control.',

    shotValidation:
      'The next semantic test should compare eye yaw/pitch against attack or projectile direction. That is the appropriate point to promote m_angEyeAngles from view-orientation candidate to aim-orientation telemetry.'
  },


  validation: {

    pass:
      validationPass,

    checks:
      validationChecks
  },


  outputs: {

    summary:
      outputPath
  }
};


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    outputPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputPath,
  JSON.stringify(
    summary,
    null,
    2
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
  'PLAYER FACING / ANGLE SEMANTICS V0.2'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'V01 CORRECTION'
);

console.log(
  '--------------'
);


console.log(
  'V01 semantic status withdrawn.'
);


console.log(
  'Reason: constant zero components were allowed to win cross-field matching.'
);


// ============================================================
// FIELD STRUCTURE
// ============================================================

console.log('');

console.log(
  'NON-DEGENERATE FIELD STRUCTURE'
);

console.log(
  '------------------------------'
);


for (
  const field
  of ANGLE_FIELDS
) {

  const row =
    fieldStructure[
      field.id
    ];


  console.log('');

  console.log(
    field.id
  );


  for (
    const component
    of row.components
  ) {

    console.log(

      `  component ${component.component}: ` +

      `range=${formatNumber(component.range)}° ` +

      `R=${formatNumber(component.circular.resultantLength)} ` +

      `constant=${component.constant}`
    );
  }


  console.log(
    `  yaw candidate:   ${formatSemanticComponent(row.semanticInference.yaw)}`
  );


  console.log(
    `  pitch candidate: ${formatSemanticComponent(row.semanticInference.pitch)}`
  );


  console.log(
    `  constant comps:  [${row.semanticInference.constantComponents.join(', ')}]`
  );
}


// ============================================================
// DIRECT YAW
// ============================================================

console.log('');

console.log(
  'DIRECT YAW AGREEMENT'
);

console.log(
  '--------------------'
);


for (
  const [
    key,
    row
  ]
  of Object.entries(
    yawAgreement
  )
) {

  printAgreement(
    key,
    row
  );
}


// ============================================================
// PITCH
// ============================================================

console.log('');

console.log(
  'DIRECT PITCH AGREEMENT'
);

console.log(
  '----------------------'
);


for (
  const [
    key,
    row
  ]
  of Object.entries(
    pitchAgreement
  )
) {

  printAgreement(
    key,
    row
  );
}


// ============================================================
// VARIABLE-ONLY SEARCH
// ============================================================

console.log('');

console.log(
  'VARIABLE-ONLY CROSS-FIELD SEARCH'
);

console.log(
  '--------------------------------'
);


for (
  const [
    key,
    row
  ]
  of Object.entries(
    variablePairSearch
  )
) {

  console.log('');

  console.log(
    key
  );


  if (
    !row.best
  ) {

    console.log(
      '  no valid mapping'
    );

    continue;
  }


  console.log(

    `  best: ${row.best.aComponent} -> ${row.best.bComponent} ` +

    `median=${formatNumber(row.best.error.median)}° ` +

    `p95=${formatNumber(row.best.error.p95)}°`
  );
}


// ============================================================
// MOVEMENT
// ============================================================

console.log('');

console.log(
  'WORLD-YAW MOVEMENT ANCHOR'
);

console.log(
  '-------------------------'
);


for (
  const field
  of ANGLE_FIELDS
) {

  const row =
    movementFit[
      field.id
    ];


  if (
    !row
  ) {

    console.log(
      `${field.id.padEnd(18)} n/a`
    );

    continue;
  }


  console.log(

    `${field.id.padEnd(18)} ` +

    `yawComp=${row.component} ` +

    `${row.transform} ` +

    `median=${formatNumber(row.error.median)}° ` +

    `p75=${formatNumber(row.error.p75)}° ` +

    `<=30=${formatPercent(row.within30)} ` +

    `<=45=${formatPercent(row.within45)}`
  );
}


// ============================================================
// WORLD CONVENTION
// ============================================================

console.log('');

console.log(
  'WORLD YAW CONVENTION'
);

console.log(
  '--------------------'
);


if (
  worldYawConvention
) {

  console.log(
    `Transform: ${worldYawConvention.transform}`
  );


  console.log(
    `Sign:      ${worldYawConvention.sign}`
  );


  console.log(
    `Offset:    ${worldYawConvention.offsetDegrees}°`
  );


  if (
    worldYawConvention.coordinateInterpretation
  ) {

    console.log(
      'Interpretation:'
    );


    console.log(
      `  0°   -> ${worldYawConvention.coordinateInterpretation.yaw0}`
    );


    console.log(
      `  90°  -> ${worldYawConvention.coordinateInterpretation.yaw90}`
    );


    console.log(
      `  180° -> ${worldYawConvention.coordinateInterpretation.yaw180}`
    );


    console.log(
      `  270° -> ${worldYawConvention.coordinateInterpretation.yaw270}`
    );
  }

} else {

  console.log(
    'Unresolved.'
  );
}


// ============================================================
// FLAGS
// ============================================================

console.log('');

console.log(
  'INTERPRETIVE FLAGS'
);

console.log(
  '------------------'
);


console.log(
  `Yaw components nonconstant:          ${yawComponentsNonConstant}`
);


console.log(
  `Yaw components broad:                ${yawComponentsBroad}`
);


console.log(
  `All fields same world transform:     ${allFieldsSameWorldTransform}`
);


console.log(
  `Body world yaw strong:               ${bodyWorldYawStrong}`
);


console.log(
  `Eye world yaw strong:                ${eyeWorldYawStrong}`
);


console.log(
  `Camera world yaw supported:          ${cameraWorldYawSupported}`
);


console.log(
  `World yaw convention strong:         ${worldYawConventionStrong}`
);


console.log(
  `Body-eye yaw strongly linked:        ${bodyEyeYawStronglyLinked}`
);


console.log(
  `Eye-camera yaw strongly linked:      ${eyeCameraYawStronglyLinked}`
);


console.log(
  `Eye-camera pitch strongly linked:    ${eyeCameraPitchStronglyLinked}`
);


console.log(
  `Ready for shot-linked validation:    ${readyForShotLinkedValidation}`
);


// ============================================================
// VALIDATION
// ============================================================

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
    result
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(

    `${result.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(36)} ` +

    `actual=${JSON.stringify(result.actual)} ` +

    `expected=${JSON.stringify(result.expected)}`
  );
}


console.log('');

console.log(
  `OVERALL PIPELINE: ${validationPass ? 'PASS' : 'FAIL'}`
);


console.log(
  `SEMANTIC STATUS:  ${status}`
);


console.log('');

console.log(
  `Summary:\n${outputPath}`
);


console.log('');


// ============================================================
// FIELD INFERENCE
// ============================================================

function inferFieldSemantics(
  components
) {

  const constants =
    components.filter(
      row =>
        row.constant
    );


  const variable =
    components.filter(
      row =>
        !row.constant
    );


  // ----------------------------------------------------------
  // YAW
  //
  // Yaw should generally traverse a broad circular range.
  //
  // The lowest resultant length identifies the least
  // directionally concentrated variable component.
  // ----------------------------------------------------------

  const yawCandidates =
    variable
      .filter(
        row =>
          Number.isFinite(
            row.range
          )
          &&
          row.range >=
          YAW_MIN_RANGE_DEG
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a.circular.resultantLength -
            b.circular.resultantLength
        ||
          b.range -
            a.range
      );


  const yaw =
    yawCandidates[0]
    ??
    null;


  // ----------------------------------------------------------
  // PITCH
  //
  // Among remaining variable components, pitch generally remains
  // much more concentrated than yaw.
  //
  // Body rotation may have no variable pitch component at all.
  // ----------------------------------------------------------

  const pitchCandidates =
    variable
      .filter(
        row =>
          row.component !==
          yaw?.component
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          b.circular.resultantLength -
            a.circular.resultantLength
        ||
          a.range -
            b.range
      );


  const pitch =
    pitchCandidates[0]
    ??
    null;


  return {

    yaw:
      yaw
        ? {

          component:
            yaw.component,

          range:
            yaw.range,

          resultantLength:
            yaw.circular.resultantLength,

          basis:
            'BROAD_NONDEGENERATE_CIRCULAR_COMPONENT'
        }
        : null,

    pitch:
      pitch
        ? {

          component:
            pitch.component,

          range:
            pitch.range,

          resultantLength:
            pitch.circular.resultantLength,

          basis:
            'REMAINING_VARIABLE_CONCENTRATED_COMPONENT'
        }
        : null,

    constantComponents:
      constants.map(
        row =>
          row.component
      )
  };
}


// ============================================================
// VARIABLE-ONLY MAPPING
// ============================================================

function analyzeVariableComponentMappings(
  samples,
  aComponents,
  bComponents
) {

  const validA =
    aComponents.filter(
      row =>
        !row.constant
    );


  const validB =
    bComponents.filter(
      row =>
        !row.constant
    );


  const mappings =
    [];


  for (
    const a
    of validA
  ) {

    for (
      const b
      of validB
    ) {

      const comparison =
        compareComponents(
          samples,
          a.component,
          b.component
        );


      if (
        !comparison
      ) {

        continue;
      }


      mappings.push({

        aComponent:
          a.component,

        bComponent:
          b.component,

        ...comparison
      });
    }
  }


  mappings.sort(
    (
      a,
      b
    ) =>
      a.error.median -
        b.error.median
    ||
      a.error.p95 -
        b.error.p95
  );


  return {

    mappings,

    best:
      mappings[0]
      ??
      null
  };
}


// ============================================================
// MOVEMENT FIT
// ============================================================

function evaluateMovementTransforms(
  fieldId,
  component
) {

  if (
    !Number.isInteger(
      component
    )
  ) {

    return null;
  }


  const candidates =
    [];


  for (
    const transform
    of YAW_TRANSFORMS
  ) {

    const errors =
      [];


    for (
      const sample
      of movementSamples
    ) {

      const triple =
        sample
          .angles[
            fieldId
          ];


      if (
        !triple
      ) {

        continue;
      }


      const rawYaw =
        triple[
          component
        ];


      if (
        !Number.isFinite(
          rawYaw
        )
      ) {

        continue;
      }


      const transformedYaw =
        normalizeDegrees(
          transform.sign *
            rawYaw
          +
          transform.offset
        );


      errors.push(
        circularDifference(
          transformedYaw,
          sample.movementHeading
        )
      );
    }


    candidates.push({

      field:
        fieldId,

      component,

      transform:
        transform.id,

      sign:
        transform.sign,

      offset:
        transform.offset,

      count:
        errors.length,

      error:
        summarizeLinear(
          errors
        ),

      within15:
        rate(
          errors.filter(
            value =>
              value <=
              15
          ).length,
          errors.length
        ),

      within30:
        rate(
          errors.filter(
            value =>
              value <=
              30
          ).length,
          errors.length
        ),

      within45:
        rate(
          errors.filter(
            value =>
              value <=
              45
          ).length,
          errors.length
        )
    });
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      a.error.median -
        b.error.median
    ||
      a.error.p75 -
        b.error.p75
    ||
      b.within30 -
        a.within30
  );


  return candidates[0]
  ??
  null;
}


// ============================================================
// COMPONENT COMPARISON
// ============================================================

function compareComponents(
  samples,
  aComponent,
  bComponent
) {

  if (
    !Number.isInteger(
      aComponent
    )
    ||
    !Number.isInteger(
      bComponent
    )
  ) {

    return null;
  }


  const errors =
    [];


  const signedDifferences =
    [];


  for (
    const sample
    of samples
  ) {

    const a =
      sample
        ?.a[
          aComponent
        ];


    const b =
      sample
        ?.b[
          bComponent
        ];


    if (
      !Number.isFinite(
        a
      )
      ||
      !Number.isFinite(
        b
      )
    ) {

      continue;
    }


    errors.push(
      circularDifference(
        a,
        b
      )
    );


    signedDifferences.push(
      signedCircularDifference(
        a,
        b
      )
    );
  }


  if (
    errors.length ===
    0
  ) {

    return null;
  }


  return {

    count:
      errors.length,

    error:
      summarizeLinear(
        errors
      ),

    signedDifference:
      summarizeLinear(
        signedDifferences
      ),

    within1:
      rate(
        errors.filter(
          value =>
            value <=
            1
        ).length,
        errors.length
      ),

    within5:
      rate(
        errors.filter(
          value =>
            value <=
            5
        ).length,
        errors.length
      ),

    within10:
      rate(
        errors.filter(
          value =>
            value <=
            10
        ).length,
        errors.length
      ),

    within30:
      rate(
        errors.filter(
          value =>
            value <=
            30
        ).length,
        errors.length
      )
  };
}


// ============================================================
// PAIR
// ============================================================

function addPair(
  target,
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return;
  }


  target.push({

    a,

    b
  });
}


// ============================================================
// ANGLE NORMALIZATION
// ============================================================

function normalizeAngleTriple(
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


  let candidates;


  if (
    Array.isArray(
      value
    )
  ) {

    candidates = [

      value[0],
      value[1],
      value[2]
    ];

  } else if (
    typeof value ===
    'object'
  ) {

    if (
      Object.hasOwn(
        value,
        '0'
      )
      &&
      Object.hasOwn(
        value,
        '1'
      )
      &&
      Object.hasOwn(
        value,
        '2'
      )
    ) {

      candidates = [

        value[0],
        value[1],
        value[2]
      ];

    } else if (
      Object.hasOwn(
        value,
        'x'
      )
      &&
      Object.hasOwn(
        value,
        'y'
      )
      &&
      Object.hasOwn(
        value,
        'z'
      )
    ) {

      candidates = [

        value.x,
        value.y,
        value.z
      ];

    } else if (
      Object.hasOwn(
        value,
        'pitch'
      )
      &&
      Object.hasOwn(
        value,
        'yaw'
      )
    ) {

      candidates = [

        value.pitch,
        value.yaw,
        value.roll ??
          0
      ];

    } else {

      return null;
    }

  } else {

    return null;
  }


  const output =
    candidates.map(
      finite
    );


  if (
    output.some(
      value =>
        value ===
        null
    )
  ) {

    return null;
  }


  return output;
}


// ============================================================
// POSITION
// ============================================================

function normalizePosition(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const x =
    finite(
      value.x
    );


  const y =
    finite(
      value.y
    );


  const z =
    finite(
      value.z
    );


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
    z
  };
}


// ============================================================
// CIRCULAR
// ============================================================

function circularDifference(
  a,
  b
) {

  return Math.abs(
    signedCircularDifference(
      a,
      b
    )
  );
}


function signedCircularDifference(
  a,
  b
) {

  let difference =
    normalizeDegrees(
      a
    )
    -
    normalizeDegrees(
      b
    );


  if (
    difference >
    180
  ) {

    difference -=
      360;
  }


  if (
    difference <
    -180
  ) {

    difference +=
      360;
  }


  return difference;
}


function summarizeCircular(
  source
) {

  const clean =
    source.filter(
      Number.isFinite
    );


  if (
    clean.length ===
    0
  ) {

    return {

      count:
        0,

      meanDegrees:
        null,

      resultantLength:
        null
    };
  }


  let sumSin =
    0;


  let sumCos =
    0;


  for (
    const value
    of clean
  ) {

    const radians =
      degreesToRadians(
        normalizeDegrees(
          value
        )
      );


    sumSin +=
      Math.sin(
        radians
      );


    sumCos +=
      Math.cos(
        radians
      );
  }


  const resultantLength =
    Math.sqrt(
      sumSin *
        sumSin
      +
      sumCos *
        sumCos
    )
    /
    clean.length;


  const meanRadians =
    Math.atan2(
      sumSin,
      sumCos
    );


  return {

    count:
      clean.length,

    meanDegrees:
      normalizeDegrees(
        radiansToDegrees(
          meanRadians
        )
      ),

    resultantLength
  };
}


// ============================================================
// LINEAR SUMMARY
// ============================================================

function summarizeLinear(
  source
) {

  const clean =
    source
      .filter(
        Number.isFinite
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  if (
    clean.length ===
    0
  ) {

    return {

      count:
        0,

      min:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p95:
        null,

      p99:
        null,

      max:
        null,

      mean:
        null,

      range:
        null
    };
  }


  return {

    count:
      clean.length,

    min:
      clean[0],

    p25:
      quantile(
        clean,
        0.25
      ),

    median:
      quantile(
        clean,
        0.50
      ),

    p75:
      quantile(
        clean,
        0.75
      ),

    p95:
      quantile(
        clean,
        0.95
      ),

    p99:
      quantile(
        clean,
        0.99
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      mean(
        clean
      ),

    range:
      clean[
        clean.length -
        1
      ]
      -
      clean[0]
  };
}


// ============================================================
// DEGREE HELPERS
// ============================================================

function normalizeDegrees(
  value
) {

  const result =
    value %
    360;


  return result <
    0
      ? result +
        360
      : result;
}


function radiansToDegrees(
  radians
) {

  return radians *
    180 /
    Math.PI;
}


function degreesToRadians(
  degrees
) {

  return degrees *
    Math.PI /
    180;
}


// ============================================================
// NUMERIC
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


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    clean.length ===
    0
  ) {

    return null;
  }


  return clean.reduce(
    (
      sum,
      value
    ) =>
      sum +
      value,
    0
  )
  /
  clean.length;
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
// QUANTILE
// ============================================================

function quantile(
  sorted,
  q
) {

  if (
    sorted.length ===
    0
  ) {

    return null;
  }


  if (
    sorted.length ===
    1
  ) {

    return sorted[0];
  }


  const position =
    (
      sorted.length -
      1
    )
    *
    q;


  const lower =
    Math.floor(
      position
    );


  const upper =
    Math.ceil(
      position
    );


  if (
    lower ===
    upper
  ) {

    return sorted[
      lower
    ];
  }


  const weight =
    position -
    lower;


  return (
    sorted[
      lower
    ]
    *
    (
      1 -
      weight
    )
    +
    sorted[
      upper
    ]
    *
    weight
  );
}


// ============================================================
// VALIDATION
// ============================================================

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
// FORMAT
// ============================================================

function printAgreement(
  label,
  row
) {

  if (
    !row
  ) {

    console.log(
      `${label.padEnd(20)} n/a`
    );

    return;
  }


  console.log(

    `${label.padEnd(20)} ` +

    `n=${row.count} ` +

    `median=${formatNumber(row.error.median)}° ` +

    `p75=${formatNumber(row.error.p75)}° ` +

    `p95=${formatNumber(row.error.p95)}° ` +

    `<=10=${formatPercent(row.within10)} ` +

    `<=30=${formatPercent(row.within30)}`
  );
}


function formatSemanticComponent(
  value
) {

  if (
    !value
  ) {

    return 'unresolved';
  }


  return (
    `component ${value.component} ` +
    `range=${formatNumber(value.range)}° ` +
    `R=${formatNumber(value.resultantLength)}`
  );
}


function formatNumber(
  value
) {

  return Number.isFinite(
    value
  )
    ? Number(
      value.toFixed(
        4
      )
    ).toString()
    : 'n/a';
}


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