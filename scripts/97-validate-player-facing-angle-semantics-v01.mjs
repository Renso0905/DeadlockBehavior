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
    'player_facing_angle_semantics_validation_v01.json'
  );


// ============================================================
// MOVEMENT FILTERS
//
// player_state.jsonl is sampled every 16 ticks = 0.25 sec.
//
// We only use reasonably substantial displacement for the
// movement-heading comparison.
//
// This is NOT assumed to mean the player is moving forward.
// Strafing/backpedaling are expected.
//
// Movement is therefore only one external diagnostic.
// ============================================================

const NOMINAL_INTERVAL_SECONDS =
  0.25;


const MIN_DISPLACEMENT_HU =
  60;


const MAX_INTERVAL_SECONDS =
  0.40;


// ============================================================
// ANGLE COMPONENTS
//
// Existing telemetry usually serializes the angle values as:
//
//   {"0": ..., "1": ..., "2": ...}
//
// but this normalizer also accepts:
//
//   [a,b,c]
//
//   {x,y,z}
//
//   {pitch,yaw,roll}
//
// We do not assume component semantics beforehand.
// ============================================================

const ANGLE_FIELDS = [

  {
    id:
      'BODY_ROTATION',

    path:
      row =>
        row
          ?.pawn
          ?.bodyRotation
  },

  {
    id:
      'EYE_ANGLES',

    path:
      row =>
        row
          ?.pawn
          ?.eyeAngles
  },

  {
    id:
      'CAMERA_ANGLES',

    path:
      row =>
        row
          ?.pawn
          ?.cameraAngles
  }
];


// ============================================================
// POSSIBLE WORLD-YAW CONVENTIONS
//
// movementHeading is defined conventionally from world position:
//
//   atan2(dy, dx)
//
// We test:
//
//   heading = sign * rawYaw + offset
//
// sign:
//   +1 / -1
//
// offset:
//   0 / 90 / 180 / 270
//
// This covers the common axis/sign ambiguities without assuming
// Source/Deadlock's convention.
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

      sign,

      offset,

      id:
        `${sign === 1 ? 'PLUS' : 'MINUS'}_YAW_${offset}`
    });
  }
}


// ============================================================
// INPUT
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

const fieldStats =
  {};


for (
  const field
  of ANGLE_FIELDS
) {

  fieldStats[
    field.id
  ] = {

    rowsSeen:
      0,

    validTriples:
      0,

    components: [
      [],
      [],
      []
    ]
  };
}


const pairSamples = {

  BODY_ROTATION__EYE_ANGLES:
    [],

  BODY_ROTATION__CAMERA_ANGLES:
    [],

  EYE_ANGLES__CAMERA_ANGLES:
    []
};


const previousByPlayer =
  new Map();


const movementSamples =
  [];


let inputRows =
  0;


let pawnRows =
  0;


let aliveMovementRows =
  0;


// ============================================================
// STREAM PLAYER STATE
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


  const validMovement =
    row
      ?.pawn
      ?.positionValidForMovement ===
    true;


  const position =
    normalizePosition(
      row
        ?.pawn
        ?.positionWorld
    );


  const angles =
    {};


  // ----------------------------------------------------------
  // ANGLE EXTRACTION
  // ----------------------------------------------------------

  for (
    const field
    of ANGLE_FIELDS
  ) {

    fieldStats[
      field.id
    ].rowsSeen++;


    const triple =
      normalizeAngleTriple(
        field.path(
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


    fieldStats[
      field.id
    ].validTriples++;


    for (
      let component =
        0;

      component <
        3;

      component++
    ) {

      fieldStats[
        field.id
      ]
        .components[
          component
        ]
        .push(
          triple[
            component
          ]
        );
    }
  }


  // ----------------------------------------------------------
  // SAME-SAMPLE ANGLE PAIRS
  // ----------------------------------------------------------

  addPairSample(
    pairSamples
      .BODY_ROTATION__EYE_ANGLES,

    angles
      .BODY_ROTATION,

    angles
      .EYE_ANGLES
  );


  addPairSample(
    pairSamples
      .BODY_ROTATION__CAMERA_ANGLES,

    angles
      .BODY_ROTATION,

    angles
      .CAMERA_ANGLES
  );


  addPairSample(
    pairSamples
      .EYE_ANGLES__CAMERA_ANGLES,

    angles
      .EYE_ANGLES,

    angles
      .CAMERA_ANGLES
  );


  // ----------------------------------------------------------
  // MOVEMENT PAIRS
  // ----------------------------------------------------------

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
    !validMovement
    ||
    !position
  ) {

    continue;
  }


  aliveMovementRows++;


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

    dt,

    displacement,

    speedHUPerSecond:
      displacement /
      dt,

    movementHeading,

    angles:
      previous.angles
  });
}


// ============================================================
// BASIC FIELD STRUCTURE
// ============================================================

const fieldSummaries =
  {};


for (
  const field
  of ANGLE_FIELDS
) {

  const source =
    fieldStats[
      field.id
    ];


  const componentSummaries =
    source.components.map(
      (
        values,
        index
      ) => ({

        component:
          index,

        ...summarizeLinear(
          values
        ),

        circular:
          summarizeCircular(
            values
          )
      })
    );


  const inferred =
    inferComponents(
      componentSummaries
    );


  fieldSummaries[
    field.id
  ] = {

    rowsSeen:
      source.rowsSeen,

    validTriples:
      source.validTriples,

    coverage:
      rate(
        source.validTriples,
        source.rowsSeen
      ),

    components:
      componentSummaries,

    inferred
  };
}


// ============================================================
// CROSS-FIELD COMPONENT AGREEMENT
//
// We intentionally test every component permutation.
//
// If:
//
//   eye component 1 ≈ camera component 1
//
// overwhelmingly wins, that strongly supports a shared yaw-like
// component.
//
// ============================================================

const pairSummaries =
  {};


for (
  const [
    pairId,
    samples
  ]
  of Object.entries(
    pairSamples
  )
) {

  pairSummaries[
    pairId
  ] =
    analyzeAnglePair(
      samples
    );
}


// ============================================================
// MOVEMENT-HEADING TEST
//
// For every:
//
//   angle field
//   component
//   sign
//   90-degree axis offset
//
// calculate circular error relative to actual displacement.
//
// This does NOT assume the player always moves forward.
//
// Therefore:
//   low error is strong evidence,
//   high error is NOT evidence that an angle field is invalid.
// ============================================================

const movementResults =
  [];


for (
  const field
  of ANGLE_FIELDS
) {

  for (
    let component =
      0;

    component <
      3;

    component++
  ) {

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
              field.id
            ];


        if (
          !triple
        ) {

          continue;
        }


        const raw =
          triple[
            component
          ];


        if (
          !Number.isFinite(
            raw
          )
        ) {

          continue;
        }


        const transformed =
          normalizeDegrees(
            transform.sign *
              raw
            +
            transform.offset
          );


        errors.push(
          circularDifference(
            transformed,
            sample.movementHeading
          )
        );
      }


      movementResults.push({

        field:
          field.id,

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
  }
}


// ============================================================
// BEST MOVEMENT FITS
// ============================================================

const bestMovementByField =
  {};


for (
  const field
  of ANGLE_FIELDS
) {

  const candidates =
    movementResults
      .filter(
        row =>
          row.field ===
          field.id
        &&
          row.count >
          0
        &&
          Number.isFinite(
            row
              .error
              .median
          )
      )
      .sort(
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


  bestMovementByField[
    field.id
  ] =
    candidates[0]
    ??
    null;
}


// ============================================================
// INFER LIKELY YAW COMPONENT
//
// Priority:
//
// 1. eye-camera component agreement
// 2. component dynamic range / circular behavior
// 3. movement-fit evidence, if useful
//
// We keep this explicitly provisional.
// ============================================================

const eyeCamera =
  pairSummaries
    .EYE_ANGLES__CAMERA_ANGLES;


const eyeCameraBestMapping =
  eyeCamera
    ?.bestComponentMapping ??
  null;


const likelyYawComponents =
  {


    BODY_ROTATION:
      chooseLikelyYawComponent(
        'BODY_ROTATION',
        fieldSummaries,
        bestMovementByField,
        null
      ),


    EYE_ANGLES:
      chooseLikelyYawComponent(
        'EYE_ANGLES',
        fieldSummaries,
        bestMovementByField,
        eyeCameraBestMapping
          ?.aComponent ??
        null
      ),


    CAMERA_ANGLES:
      chooseLikelyYawComponent(
        'CAMERA_ANGLES',
        fieldSummaries,
        bestMovementByField,
        eyeCameraBestMapping
          ?.bComponent ??
        null
      )
  };


// ============================================================
// USING LIKELY YAW COMPONENTS, RECOMPUTE FIELD-TO-FIELD YAW
// AGREEMENT DIRECTLY.
// ============================================================

const likelyYawAgreement =
  {


    BODY_VS_EYE:
      compareChosenYaw(
        pairSamples
          .BODY_ROTATION__EYE_ANGLES,

        likelyYawComponents
          .BODY_ROTATION
          ?.component,

        likelyYawComponents
          .EYE_ANGLES
          ?.component
      ),


    BODY_VS_CAMERA:
      compareChosenYaw(
        pairSamples
          .BODY_ROTATION__CAMERA_ANGLES,

        likelyYawComponents
          .BODY_ROTATION
          ?.component,

        likelyYawComponents
          .CAMERA_ANGLES
          ?.component
      ),


    EYE_VS_CAMERA:
      compareChosenYaw(
        pairSamples
          .EYE_ANGLES__CAMERA_ANGLES,

        likelyYawComponents
          .EYE_ANGLES
          ?.component,

        likelyYawComponents
          .CAMERA_ANGLES
          ?.component
      )
  };


// ============================================================
// INTERPRETATION FLAGS
// ============================================================

const fullCoverage =
  ANGLE_FIELDS.every(
    field =>
      fieldSummaries[
        field.id
      ].coverage >=
      0.95
  );


const eyeCameraYawAgreement =
  likelyYawAgreement
    .EYE_VS_CAMERA;


const eyeCameraStronglyLinked =
  eyeCameraYawAgreement
  &&
  eyeCameraYawAgreement.count >=
    1000
  &&
  eyeCameraYawAgreement.error.median <=
    2
  &&
  eyeCameraYawAgreement.error.p95 <=
    10;


const bodyEyeYawAgreement =
  likelyYawAgreement
    .BODY_VS_EYE;


const bodyTracksViewCandidate =
  bodyEyeYawAgreement
  &&
  bodyEyeYawAgreement.count >=
    1000
  &&
  bodyEyeYawAgreement.error.median <=
    15;


const bestBodyMovement =
  bestMovementByField
    .BODY_ROTATION;


const movementAnchorsBody =
  bestBodyMovement
  &&
  bestBodyMovement.count >=
    1000
  &&
  bestBodyMovement.error.median <=
    30
  &&
  bestBodyMovement.within45 >=
    0.65;


const worldYawConventionCandidate =
  movementAnchorsBody
    ? {

      field:
        bestBodyMovement.field,

      component:
        bestBodyMovement.component,

      sign:
        bestBodyMovement.sign,

      offset:
        bestBodyMovement.offset,

      transform:
        bestBodyMovement.transform,

      semanticStatus:
        'PROVISIONAL_MOVEMENT_ANCHORED_WORLD_YAW_CONVENTION'
    }
    : null;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {


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


    bodyAnglesPresent:
      check(
        fieldSummaries
          .BODY_ROTATION
          .validTriples,
        '>0',
        fieldSummaries
          .BODY_ROTATION
          .validTriples >
        0
      ),


    eyeAnglesPresent:
      check(
        fieldSummaries
          .EYE_ANGLES
          .validTriples,
        '>0',
        fieldSummaries
          .EYE_ANGLES
          .validTriples >
        0
      ),


    cameraAnglesPresent:
      check(
        fieldSummaries
          .CAMERA_ANGLES
          .validTriples,
        '>0',
        fieldSummaries
          .CAMERA_ANGLES
          .validTriples >
        0
      ),


    movementSamplesPresent:
      check(
        movementSamples.length,
        '>1000',
        movementSamples.length >
        1000
      ),


    eyeCameraPairSamplesPresent:
      check(
        pairSamples
          .EYE_ANGLES__CAMERA_ANGLES
          .length,
        '>1000',
        pairSamples
          .EYE_ANGLES__CAMERA_ANGLES
          .length >
        1000
      ),


    yawCandidatesResolved:
      check(
        Object
          .values(
            likelyYawComponents
          )
          .every(
            Boolean
          ),
        true,
        Object
          .values(
            likelyYawComponents
          )
          .every(
            Boolean
          )
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
// SEMANTIC STATUS
// ============================================================

let status;


if (
  !validationPass
) {

  status =
    'PIPELINE_VALIDATION_FAILURE';

} else if (
  eyeCameraStronglyLinked
  &&
  movementAnchorsBody
) {

  status =
    'ANGLE_STRUCTURE_AND_WORLD_YAW_STRONGLY_SUPPORTED';

} else if (
  eyeCameraStronglyLinked
) {

  status =
    'VIEW_ANGLE_RELATION_STRONGLY_SUPPORTED_WORLD_YAW_STILL_PROVISIONAL';

} else {

  status =
    'ANGLE_FIELD_DIAGNOSTIC_COMPLETE';
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {


  replay:
    replayName,


  version:
    'PLAYER_FACING_ANGLE_SEMANTICS_VALIDATION_V01',


  canonical:
    false,


  status,


  purpose: [

    'Validate the structure of CBodyComponent.m_angRotation, m_angEyeAngles, and m_angClientCamera.',

    'Infer likely yaw, pitch, and roll components without assuming component ordering.',

    'Measure eye-angle versus camera-angle agreement.',

    'Measure body-rotation versus view-angle agreement.',

    'Use observed player displacement as an external diagnostic of possible world-yaw sign and axis convention.',

    'Determine which orientation semantics are strong enough for downstream behavioral-state reconstruction.'
  ],


  semanticLimits: {


    movement:
      'Movement heading is not equivalent to facing because players can strafe, backpedal, dash, slide, or move under ability effects. Poor movement agreement does not falsify an orientation field.',


    eyeAngles:
      'Field naming strongly suggests eye/view orientation, but this script treats that as a candidate semantic and tests cross-field structure rather than declaring engine semantics from the name alone.',


    cameraAngles:
      'Client camera can differ from aim in a third-person game. Strong eye-camera agreement supports a common view orientation but does not automatically prove weapon-ray direction.',


    bodyRotation:
      'Body rotation may reflect model facing, view facing, locomotor orientation, animation state, or a mixture depending on game state.',


    worldConvention:
      'A movement-derived yaw convention is promoted only when movement alignment is unusually strong despite expected strafing.',


    next:
      'If eye/camera relation is strong but physical aim remains unresolved, validate the chosen yaw/pitch convention against shot or attack telemetry rather than inferring exact aim from movement.'
  },


  input: {


    playerStatePath,


    inputRows,


    pawnRows,


    aliveMovementRows,


    movementSamples:
      movementSamples.length,


    nominalIntervalSeconds:
      NOMINAL_INTERVAL_SECONDS,


    minimumMovementDisplacementHU:
      MIN_DISPLACEMENT_HU
  },


  angleFields:
    fieldSummaries,


  likelyYawComponents,


  crossFieldComponentComparison:
    pairSummaries,


  likelyYawAgreement,


  movementHeadingComparison: {


    bestByField:
      bestMovementByField,


    allCandidates:
      movementResults
  },


  interpretation: {


    fullCoverage,


    eyeCameraStronglyLinked,


    bodyTracksViewCandidate,


    movementAnchorsBody,


    worldYawConventionCandidate
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
  'PLAYER FACING / ANGLE SEMANTICS V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'INPUT'
);

console.log(
  '-----'
);


console.log(
  `Rows:                 ${inputRows}`
);


console.log(
  `Pawn rows:            ${pawnRows}`
);


console.log(
  `Movement-valid rows:  ${aliveMovementRows}`
);


console.log(
  `Movement samples:     ${movementSamples.length}`
);


// ============================================================
// FIELD STRUCTURE
// ============================================================

console.log('');

console.log(
  'ANGLE FIELD STRUCTURE'
);

console.log(
  '---------------------'
);


for (
  const field
  of ANGLE_FIELDS
) {

  const row =
    fieldSummaries[
      field.id
    ];


  console.log('');

  console.log(
    field.id
  );


  console.log(
    `  valid=${row.validTriples}/${row.rowsSeen} (${formatPercent(row.coverage)})`
  );


  for (
    const component
    of row.components
  ) {

    console.log(

      `  component ${component.component}: ` +

      `n=${component.count} ` +

      `min=${formatNumber(component.min)} ` +

      `median=${formatNumber(component.median)} ` +

      `max=${formatNumber(component.max)} ` +

      `meanCirc=${formatNumber(component.circular.meanDegrees)} ` +

      `R=${formatNumber(component.circular.resultantLength)}`
    );
  }


  console.log(
    `  inferred yaw:   ${formatComponent(row.inferred.yaw)}`
  );


  console.log(
    `  inferred pitch: ${formatComponent(row.inferred.pitch)}`
  );


  console.log(
    `  inferred roll:  ${formatComponent(row.inferred.roll)}`
  );
}


// ============================================================
// CROSS FIELD
// ============================================================

console.log('');

console.log(
  'CROSS-FIELD COMPONENT AGREEMENT'
);

console.log(
  '-------------------------------'
);


for (
  const [
    pairId,
    pair
  ]
  of Object.entries(
    pairSummaries
  )
) {

  console.log('');

  console.log(
    pairId
  );


  const best =
    pair.bestComponentMapping;


  if (
    best
  ) {

    console.log(

      `  best mapping: ` +

      `${best.aComponent} -> ${best.bComponent} ` +

      `median=${formatNumber(best.error.median)}° ` +

      `p95=${formatNumber(best.error.p95)}°`
    );
  }
}


// ============================================================
// CHOSEN YAW
// ============================================================

console.log('');

console.log(
  'LIKELY YAW COMPONENTS'
);

console.log(
  '---------------------'
);


for (
  const [
    field,
    candidate
  ]
  of Object.entries(
    likelyYawComponents
  )
) {

  console.log(

    `${field.padEnd(18)} ` +

    (
      candidate
        ? `component=${candidate.component} source=${candidate.source}`
        : 'unresolved'
    )
  );
}


// ============================================================
// YAW AGREEMENT
// ============================================================

console.log('');

console.log(
  'LIKELY-YAW FIELD AGREEMENT'
);

console.log(
  '--------------------------'
);


for (
  const [
    label,
    row
  ]
  of Object.entries(
    likelyYawAgreement
  )
) {

  console.log(

    `${label.padEnd(18)} ` +

    (
      row
        ? `n=${row.count} median=${formatNumber(row.error.median)}° p75=${formatNumber(row.error.p75)}° p95=${formatNumber(row.error.p95)}°`
        : 'n/a'
    )
  );
}


// ============================================================
// MOVEMENT
// ============================================================

console.log('');

console.log(
  'BEST MOVEMENT-HEADING FIT'
);

console.log(
  '-------------------------'
);


for (
  const field
  of ANGLE_FIELDS
) {

  const row =
    bestMovementByField[
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

    `component=${row.component} ` +

    `${row.transform} ` +

    `n=${row.count} ` +

    `median=${formatNumber(row.error.median)}° ` +

    `p75=${formatNumber(row.error.p75)}° ` +

    `<=30=${formatPercent(row.within30)} ` +

    `<=45=${formatPercent(row.within45)}`
  );
}


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

console.log('');

console.log(
  'INTERPRETIVE FLAGS'
);

console.log(
  '------------------'
);


console.log(
  `Full angle-field coverage:       ${fullCoverage}`
);


console.log(
  `Eye-camera strongly linked:      ${eyeCameraStronglyLinked}`
);


console.log(
  `Body tracks view candidate:      ${bodyTracksViewCandidate}`
);


console.log(
  `Movement anchors body yaw:       ${movementAnchorsBody}`
);


if (
  worldYawConventionCandidate
) {

  console.log(
    `World yaw candidate:            component ${worldYawConventionCandidate.component}, sign=${worldYawConventionCandidate.sign}, offset=${worldYawConventionCandidate.offset}`
  );

} else {

  console.log(
    'World yaw candidate:            unresolved'
  );
}


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
        value.roll ?? 0
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
// PAIR SAMPLE
// ============================================================

function addPairSample(
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
// PAIR ANALYSIS
// ============================================================

function analyzeAnglePair(
  samples
) {

  const mappings =
    [];


  for (
    let aComponent =
      0;

    aComponent <
      3;

    aComponent++
  ) {

    for (
      let bComponent =
        0;

      bComponent <
        3;

      bComponent++
    ) {

      const errors =
        [];


      for (
        const sample
        of samples
      ) {

        const a =
          sample
            .a[
              aComponent
            ];


        const b =
          sample
            .b[
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
      }


      mappings.push({

        aComponent,

        bComponent,

        count:
          errors.length,

        error:
          summarizeLinear(
            errors
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
          )
      });
    }
  }


  const ranked =
    mappings
      .filter(
        row =>
          Number.isFinite(
            row
              .error
              .median
          )
      )
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a.error.median -
            b.error.median
        ||
          a.error.p95 -
            b.error.p95
        ||
          b.within5 -
            a.within5
      );


  return {

    samples:
      samples.length,

    bestComponentMapping:
      ranked[0]
      ??
      null,

    mappings
  };
}


// ============================================================
// DIRECT CHOSEN-YAW COMPARISON
// ============================================================

function compareChosenYaw(
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


  for (
    const sample
    of samples
  ) {

    const a =
      sample
        .a[
          aComponent
        ];


    const b =
      sample
        .b[
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
  }


  return {

    count:
      errors.length,

    error:
      summarizeLinear(
        errors
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
      )
  };
}


// ============================================================
// COMPONENT INFERENCE
// ============================================================

function inferComponents(
  summaries
) {

  // ----------------------------------------------------------
  // ROLL CANDIDATE
  //
  // Usually the least variable / most concentrated component.
  // ----------------------------------------------------------

  const rollRanked =
    summaries
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


  const roll =
    rollRanked[0]
    ??
    null;


  // ----------------------------------------------------------
  // YAW CANDIDATE
  //
  // Prefer the broadest circularly distributed non-roll
  // component.
  // ----------------------------------------------------------

  const yawRanked =
    summaries
      .filter(
        row =>
          row.component !==
          roll?.component
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
    yawRanked[0]
    ??
    null;


  const pitch =
    summaries.find(
      row =>
        row.component !==
          roll?.component
        &&
        row.component !==
          yaw?.component
    )
    ??
    null;


  return {

    yaw:
      yaw
        ? {
          component:
            yaw.component,

          confidence:
            'STRUCTURAL_HEURISTIC'
        }
        : null,

    pitch:
      pitch
        ? {
          component:
            pitch.component,

          confidence:
            'STRUCTURAL_HEURISTIC'
        }
        : null,

    roll:
      roll
        ? {
          component:
            roll.component,

          confidence:
            'STRUCTURAL_HEURISTIC'
        }
        : null
  };
}


// ============================================================
// FINAL YAW CHOICE
// ============================================================

function chooseLikelyYawComponent(
  fieldId,
  summaries,
  movement,
  crossFieldComponent
) {

  if (
    Number.isInteger(
      crossFieldComponent
    )
  ) {

    return {

      component:
        crossFieldComponent,

      source:
        'EYE_CAMERA_CROSS_FIELD_BEST_MAPPING'
    };
  }


  const movementCandidate =
    movement[
      fieldId
    ];


  if (
    movementCandidate
    &&
    movementCandidate.count >=
      1000
    &&
    movementCandidate.error.median <=
      35
  ) {

    return {

      component:
        movementCandidate.component,

      source:
        'MOVEMENT_HEADING_BEST_FIT'
    };
  }


  const structural =
    summaries[
      fieldId
    ]
      ?.inferred
      ?.yaw;


  if (
    structural
  ) {

    return {

      component:
        structural.component,

      source:
        'STRUCTURAL_HEURISTIC'
    };
  }


  return null;
}


// ============================================================
// LINEAR DISTRIBUTION
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
      ] -
      clean[0]
  };
}


// ============================================================
// CIRCULAR DISTRIBUTION
// ============================================================

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


  const meanAngle =
    Math.atan2(
      sumSin,
      sumCos
    );


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


  return {

    count:
      clean.length,

    meanDegrees:
      normalizeDegrees(
        radiansToDegrees(
          meanAngle
        )
      ),

    resultantLength
  };
}


// ============================================================
// CIRCULAR DIFFERENCE
// ============================================================

function circularDifference(
  a,
  b
) {

  const difference =
    Math.abs(
      normalizeDegrees(
        a
      )
      -
      normalizeDegrees(
        b
      )
    );


  return Math.min(
    difference,
    360 -
      difference
  );
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
    ] *
      (
        1 -
        weight
      )
    +
    sorted[
      upper
    ] *
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


function formatComponent(
  value
) {

  if (
    !value
  ) {

    return 'unresolved';
  }


  return (
    `component ${value.component}` +
    ` (${value.confidence})`
  );
}