import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

import {
  createInterface
} from 'node:readline';

import {
  Parser,
  InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// SHOT-LINK WINDOW
//
// Deadlock bullets/projectiles can take time to reach a target.
//
// Therefore:
//
//   impact tick != necessarily firing tick
//
// PRIMARY WINDOW:
//
//   impact - 0..48 ticks
//
//   0.00 - 0.75 seconds before impact
//
// PLACEBO WINDOW:
//
//   impact - 128..176 ticks
//
//   2.00 - 2.75 seconds before impact
//
// The placebo asks whether a good angular match is specific to
// the actual shot period rather than merely common because the
// player happened to face the same general direction.
// ============================================================

const PRIMARY_MIN_LAG_TICKS =
  0;


const PRIMARY_MAX_LAG_TICKS =
  48;


const PLACEBO_MIN_LAG_TICKS =
  128;


const PLACEBO_MAX_LAG_TICKS =
  176;


// ============================================================
// ANGLE COMPONENT SEMANTICS FROM SCRIPT97 V02
//
// Validated within test.dem:
//
// body:
//   yaw   = component 1
//
// eye:
//   pitch = component 0
//   yaw   = component 1
//
// camera:
//   pitch = component 0
//   yaw   = component 1
//
// world yaw:
//
//   PLUS_YAW_0
//
//   0   -> +X
//   90  -> +Y
//   180 -> -X
//   270 -> -Y
//
// Script98 does NOT assume pitch sign.
//
// It tests:
//
//   +pitch
//   -pitch
//
// against observed shot direction.
// ============================================================

const YAW_COMPONENT =
  1;


const PITCH_COMPONENT =
  0;


// ============================================================
// DIRECTION CONVENTIONS
//
// We do not assume whether damageDirection points:
//
//   attacker -> victim
//
// or:
//
//   victim -> attacker
//
// Therefore:
//
//   directionSign = +1
//   directionSign = -1
//
// are tested.
//
// Pitch sign is separately tested because Source-like QAngles
// commonly encode positive pitch differently from Cartesian
// elevation.
// ============================================================

const DIRECTION_SIGNS = [
  1,
  -1
];


const PITCH_SIGNS = [
  1,
  -1
];


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const angleValidationPath =
  resolve(
    'output',
    replayName,
    'player_facing_angle_semantics_validation_v02.json'
  );


const shotOutcomePath =
  resolve(
    'output',
    replayName,
    'citemxp_shot_outcomes_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'player_eye_angle_shot_direction_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'player_eye_angle_shot_direction_cases_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    replayPath,
    angleValidationPath,
    shotOutcomePath
  ]
) {

  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing required input:\n${path}`
    );
  }
}


// ============================================================
// LOAD SCRIPT97 V02
// ============================================================

const angleValidation =
  JSON.parse(
    readFileSync(
      angleValidationPath,
      'utf8'
    )
  );


if (
  angleValidation
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 97 V02 did not PASS.'
  );
}


if (
  angleValidation
    ?.resolvedComponents
    ?.yaw
    ?.BODY_ROTATION !==
    YAW_COMPONENT
  ||
  angleValidation
    ?.resolvedComponents
    ?.yaw
    ?.EYE_ANGLES !==
    YAW_COMPONENT
  ||
  angleValidation
    ?.resolvedComponents
    ?.yaw
    ?.CAMERA_ANGLES !==
    YAW_COMPONENT
) {

  throw new Error(
    'Script97 V02 yaw semantics do not match expected component 1.'
  );
}


// ============================================================
// LOAD SCRIPT61 OUTCOMES
// ============================================================

console.log('');

console.log(
  'Loading Script 61 CItemXP shot outcomes...'
);


const outcomeRows =
  await loadJsonl(
    shotOutcomePath
  );


console.log(
  `Script 61 outcome rows: ${outcomeRows.length}`
);


// ============================================================
// BUILD FIRST-PLAYER-SHOT CASES
// ============================================================

const cases =
  [];


for (
  const row
  of outcomeRows
) {

  const damage =
    row?.firstPlayerDamage;


  if (
    !damage
    ||
    !damage?.attackerPlayer
  ) {

    continue;
  }


  const hitTick =
    finite(
      damage.tick
    );


  const victimIndex =
    finite(
      damage.victimIndex
    );


  const attackerIndex =
    finite(
      damage.attackerIndex
    );


  const shooterName =
    damage
      ?.attackerPlayer
      ?.playerName ??
    null;


  const shooterTeam =
    finite(
      damage
        ?.attackerPlayer
        ?.team
    );


  if (
    hitTick ===
      null
    ||
    victimIndex ===
      null
    ||
    attackerIndex ===
      null
    ||
    !shooterName
  ) {

    continue;
  }


  cases.push({

    schemaVersion:
      1,

    canonical:
      false,

    caseIndex:
      cases.length,

    episodeId:
      row?.episodeId ??
      null,

    sourceType:
      row?.sourceType ??
      null,

    outcome:
      row?.outcome ??
      row?.classification ??
      null,

    hitTick,

    victimIndex,

    attackerIndex,

    shooterName,

    shooterTeam,

    hitMessage:
      null,

    snapshots:
      new Map()
  });
}


console.log(
  `Player-attributed first-shot cases: ${cases.length}`
);


// ============================================================
// INDEX HIT KEYS
// ============================================================

const casesByHitTick =
  new Map();


const casesByMessageKey =
  new Map();


for (
  const row
  of cases
) {

  pushMapArray(
    casesByHitTick,
    row.hitTick,
    row
  );


  const key =
    messageKey(
      row.hitTick,
      row.victimIndex,
      row.attackerIndex
    );


  pushMapArray(
    casesByMessageKey,
    key,
    row
  );
}


// ============================================================
// REQUESTED SNAPSHOT TICKS
//
// Only inspect player state at ticks actually needed.
//
// Each requested tick points to one or more:
//
//   case
//   lag
//
// pairs.
// ============================================================

const requestsByTick =
  new Map();


for (
  const row
  of cases
) {

  for (
    let lag =
      PRIMARY_MIN_LAG_TICKS;

    lag <=
      PRIMARY_MAX_LAG_TICKS;

    lag++
  ) {

    addSnapshotRequest(
      row.hitTick -
      lag,
      row,
      lag,
      'PRIMARY'
    );
  }


  for (
    let lag =
      PLACEBO_MIN_LAG_TICKS;

    lag <=
      PLACEBO_MAX_LAG_TICKS;

    lag++
  ) {

    addSnapshotRequest(
      row.hitTick -
      lag,
      row,
      lag,
      'PLACEBO'
    );
  }
}


function addSnapshotRequest(
  tick,
  row,
  lag,
  window
) {

  if (
    tick <
    0
  ) {

    return;
  }


  if (
    !requestsByTick.has(
      tick
    )
  ) {

    requestsByTick.set(
      tick,
      []
    );
  }


  requestsByTick
    .get(
      tick
    )
    .push({

      row,

      lag,

      window
    });
}


// ============================================================
// PARSER TELEMETRY
// ============================================================

let demoPackets =
  0;


let relevantDemoPackets =
  0;


let requestedSnapshots =
  0;


let capturedSnapshots =
  0;


let messagePackets =
  0;


let relevantMessagePackets =
  0;


let matchedDamageMessages =
  0;


// ============================================================
// PARSER
// ============================================================

console.log('');

console.log(
  'Rescanning replay for exact shot directions and per-tick orientation...'
);

console.log('');


const parser =
  new Parser();


// ============================================================
// MESSAGE PACKETS
//
// We only care about Script61's already-validated first-player
// damage events.
//
// The message is used to recover:
//
//   damageDirection
//   origin
//
// which Script61 discovered but did not retain in every compact
// outcome row.
// ============================================================

parser.registerPostInterceptor(

  InterceptorStage.MESSAGE_PACKET,

  (
    demoPacket,
    messagePacket
  ) => {

    const tick =
      finite(
        demoPacket?.tick
      );


    if (
      tick ===
      null
      ||
      !casesByHitTick.has(
        tick
      )
    ) {

      return;
    }


    messagePackets++;


    const data =
      getMessageData(
        messagePacket
      );


    if (
      !data
      ||
      typeof data !==
      'object'
    ) {

      return;
    }


    const victimIndex =
      normalizeEntityReference(
        firstFinite([
          data.entindexVictim,
          data.entindex_victim,
          data.victimEntityIndex,
          data.victimIndex
        ])
      );


    const attackerIndex =
      normalizeEntityReference(
        firstFinite([
          data.entindexAttacker,
          data.entindex_attacker,
          data.attackerEntityIndex,
          data.attackerIndex
        ])
      );


    if (
      victimIndex ===
        null
      ||
      attackerIndex ===
        null
    ) {

      return;
    }


    relevantMessagePackets++;


    const key =
      messageKey(
        tick,
        victimIndex,
        attackerIndex
      );


    const targets =
      casesByMessageKey.get(
        key
      );


    if (
      !targets
      ||
      targets.length ===
        0
    ) {

      return;
    }


    const damageDirection =
      normalizeVector(
        data.damageDirection
      );


    const origin =
      normalizeVector(
        data.origin
      );


    if (
      !damageDirection
    ) {

      return;
    }


    for (
      const row
      of targets
    ) {

      if (
        row.hitMessage
      ) {

        continue;
      }


      row.hitMessage = {

        tick,

        damageDirection:

          normalizeUnitVector(
            damageDirection
          ),

        rawDamageDirection:
          damageDirection,

        origin,

        abilityId:
          finite(
            data.abilityId
          ),

        entindexAbility:
          normalizeEntityReference(
            data.entindexAbility
          ),

        entindexInflictor:
          normalizeEntityReference(
            data.entindexInflictor
          ),

        attackerClass:
          finite(
            data.attackerClass
          ),

        victimClass:
          finite(
            data.victimClass
          ),

        type:
          finite(
            data.type
          ),

        flags:
          serializeSimple(
            data.flags
          )
      };


      matchedDamageMessages++;
    }
  }
);


// ============================================================
// DEMO PACKETS
//
// Capture exact per-tick raw player:
//
//   position
//   body rotation
//   eye angles
//   camera angles
//
// for the requested near-shot and placebo windows.
// ============================================================

parser.registerPostInterceptor(

  InterceptorStage.DEMO_PACKET,

  demoPacket => {

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


    demoPackets++;


    const requests =
      requestsByTick.get(
        tick
      );


    if (
      !requests
      ||
      requests.length ===
        0
    ) {

      return;
    }


    relevantDemoPackets++;


    const demo =
      parser.getDemo();


    const requestedNames =
      new Set(
        requests.map(
          request =>
            request.row.shooterName
        )
      );


    const players =
      collectPlayerSnapshots(
        demo,
        requestedNames
      );


    for (
      const request
      of requests
    ) {

      requestedSnapshots++;


      const player =
        players.get(
          request.row.shooterName
        );


      if (
        !player
      ) {

        continue;
      }


      request
        .row
        .snapshots
        .set(
          request.lag,
          {

            tick,

            lagTicks:
              request.lag,

            window:
              request.window,

            ...player
          }
        );


      capturedSnapshots++;
    }
  }
);


await parser.parse(
  createReadStream(
    replayPath
  )
);


await parser.dispose();


// ============================================================
// RAW COVERAGE
// ============================================================

const casesWithDirection =
  cases.filter(
    row =>
      Boolean(
        row.hitMessage
        ?.damageDirection
      )
  );


const casesWithPrimarySnapshot =
  cases.filter(
    row =>
      hasSnapshotInRange(
        row,
        PRIMARY_MIN_LAG_TICKS,
        PRIMARY_MAX_LAG_TICKS
      )
  );


const casesWithPlaceboSnapshot =
  cases.filter(
    row =>
      hasSnapshotInRange(
        row,
        PLACEBO_MIN_LAG_TICKS,
        PLACEBO_MAX_LAG_TICKS
      )
  );


const comparableCases =
  cases.filter(
    row =>
      Boolean(
        row.hitMessage
        ?.damageDirection
      )
      &&
      hasSnapshotInRange(
        row,
        PRIMARY_MIN_LAG_TICKS,
        PRIMARY_MAX_LAG_TICKS
      )
      &&
      hasSnapshotInRange(
        row,
        PLACEBO_MIN_LAG_TICKS,
        PLACEBO_MAX_LAG_TICKS
      )
  );


console.log('');

console.log(
  `Cases with damageDirection: ${casesWithDirection.length}/${cases.length}`
);


console.log(
  `Cases with primary snapshots: ${casesWithPrimarySnapshot.length}/${cases.length}`
);


console.log(
  `Cases with placebo snapshots: ${casesWithPlaceboSnapshot.length}/${cases.length}`
);


// ============================================================
// DAMAGE-DIRECTION SIGN GEOMETRY DIAGNOSTIC
//
// At the impact tick, compare:
//
//   shooter current position -> damage origin
//
// against:
//
//   damageDirection
//   -damageDirection
//
// This is not the primary aim validation because the shooter may
// have moved after firing.
//
// It is simply an independent clue about damageDirection sign.
// ============================================================

const originDirectionRows =
  [];


for (
  const row
  of comparableCases
) {

  const origin =
    row.hitMessage
      ?.origin;


  const direction =
    row.hitMessage
      ?.damageDirection;


  const hitSnapshot =
    row.snapshots.get(
      0
    );


  if (
    !origin
    ||
    !direction
    ||
    !hitSnapshot
      ?.position
  ) {

    continue;
  }


  const geometric =
    normalizeUnitVector({

      x:
        origin.x -
        hitSnapshot.position.x,

      y:
        origin.y -
        hitSnapshot.position.y,

      z:
        (
          Number.isFinite(
            origin.z
          )
          &&
          Number.isFinite(
            hitSnapshot.position.z
          )
        )
          ? origin.z -
            hitSnapshot.position.z
          : 0
    });


  if (
    !geometric
  ) {

    continue;
  }


  originDirectionRows.push({

    caseIndex:
      row.caseIndex,

    directError:
      vectorAngleDegrees(
        geometric,
        direction
      ),

    reverseError:
      vectorAngleDegrees(
        geometric,
        scaleVector(
          direction,
          -1
        )
      )
  });
}


const originDirectionDiagnostic = {

  comparable:
    originDirectionRows.length,

  direct:
    summarizeNumbers(
      originDirectionRows.map(
        row =>
          row.directError
      )
    ),

  reverse:
    summarizeNumbers(
      originDirectionRows.map(
        row =>
          row.reverseError
      )
    )
};


// ============================================================
// GLOBAL EYE CONVENTION SEARCH
//
// For each:
//
//   damageDirection sign
//   eye pitch sign
//
// find each event's BEST angular match within the actual
// 0..48-tick shot window.
//
// We then rank convention candidates by the distribution across
// EVENTS, not by pooling thousands of individual snapshots.
//
// This prevents long windows from overweighting individual cases.
// ============================================================

const eyeConventionCandidates =
  [];


for (
  const directionSign
  of DIRECTION_SIGNS
) {

  for (
    const pitchSign
    of PITCH_SIGNS
  ) {

    const eventRows =
      [];


    for (
      const row
      of comparableCases
    ) {

      const best =
        findBest3DMatch(
          row,
          'eyeAngles',
          directionSign,
          pitchSign,
          PRIMARY_MIN_LAG_TICKS,
          PRIMARY_MAX_LAG_TICKS
        );


      if (
        best
      ) {

        eventRows.push(
          best
        );
      }
    }


    const errors =
      eventRows.map(
        row =>
          row.errorDegrees
      );


    eyeConventionCandidates.push({

      directionSign,

      pitchSign,

      count:
        eventRows.length,

      error:
        summarizeNumbers(
          errors
        ),

      within2:
        rate(
          errors.filter(
            value =>
              value <=
              2
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

      within15:
        rate(
          errors.filter(
            value =>
              value <=
              15
          ).length,
          errors.length
        ),

      lagTicks:
        summarizeNumbers(
          eventRows.map(
            row =>
              row.lagTicks
          )
        )
    });
  }
}


eyeConventionCandidates.sort(
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
    b.within5 -
      a.within5
);


const bestEyeConvention =
  eyeConventionCandidates[0]
  ??
  null;


// ============================================================
// APPLY WINNING CONVENTION
// ============================================================

const directionSign =
  bestEyeConvention
    ?.directionSign ??
  1;


const pitchSign =
  bestEyeConvention
    ?.pitchSign ??
  1;


// ============================================================
// PER-CASE EVALUATION
// ============================================================

const caseResults =
  [];


for (
  const row
  of comparableCases
) {

  const eyePrimary =
    findBest3DMatch(
      row,
      'eyeAngles',
      directionSign,
      pitchSign,
      PRIMARY_MIN_LAG_TICKS,
      PRIMARY_MAX_LAG_TICKS
    );


  const eyePlacebo =
    findBest3DMatch(
      row,
      'eyeAngles',
      directionSign,
      pitchSign,
      PLACEBO_MIN_LAG_TICKS,
      PLACEBO_MAX_LAG_TICKS
    );


  const cameraPrimary =
    findBest3DMatch(
      row,
      'cameraAngles',
      directionSign,
      pitchSign,
      PRIMARY_MIN_LAG_TICKS,
      PRIMARY_MAX_LAG_TICKS
    );


  const cameraPlacebo =
    findBest3DMatch(
      row,
      'cameraAngles',
      directionSign,
      pitchSign,
      PLACEBO_MIN_LAG_TICKS,
      PLACEBO_MAX_LAG_TICKS
    );


  const bodyPrimary =
    findBestYawMatch(
      row,
      'bodyRotation',
      directionSign,
      PRIMARY_MIN_LAG_TICKS,
      PRIMARY_MAX_LAG_TICKS
    );


  const bodyPlacebo =
    findBestYawMatch(
      row,
      'bodyRotation',
      directionSign,
      PLACEBO_MIN_LAG_TICKS,
      PLACEBO_MAX_LAG_TICKS
    );


  const eyeHitTick =
    evaluateExact3DAtLag(
      row,
      'eyeAngles',
      directionSign,
      pitchSign,
      0
    );


  const cameraHitTick =
    evaluateExact3DAtLag(
      row,
      'cameraAngles',
      directionSign,
      pitchSign,
      0
    );


  const bodyHitTick =
    evaluateExactYawAtLag(
      row,
      'bodyRotation',
      directionSign,
      0
    );


  caseResults.push({

    schemaVersion:
      1,

    canonical:
      false,

    caseIndex:
      row.caseIndex,

    episodeId:
      row.episodeId,

    sourceType:
      row.sourceType,

    outcome:
      row.outcome,

    hitTick:
      row.hitTick,

    victimIndex:
      row.victimIndex,

    attackerIndex:
      row.attackerIndex,

    shooterName:
      row.shooterName,

    shooterTeam:
      row.shooterTeam,

    damageDirection:
      row.hitMessage
        ?.damageDirection ??
      null,

    damageOrigin:
      row.hitMessage
        ?.origin ??
      null,

    abilityId:
      row.hitMessage
        ?.abilityId ??
      null,

    convention: {

      directionSign,

      pitchSign
    },

    eye: {

      primary:
        eyePrimary,

      placebo:
        eyePlacebo,

      hitTick:
        eyeHitTick,

      primaryImprovementVsPlacebo:
        eyePrimary
        &&
        eyePlacebo
          ? eyePlacebo.errorDegrees -
            eyePrimary.errorDegrees
          : null
    },

    camera: {

      primary:
        cameraPrimary,

      placebo:
        cameraPlacebo,

      hitTick:
        cameraHitTick,

      primaryImprovementVsPlacebo:
        cameraPrimary
        &&
        cameraPlacebo
          ? cameraPlacebo.errorDegrees -
            cameraPrimary.errorDegrees
          : null
    },

    bodyYaw: {

      primary:
        bodyPrimary,

      placebo:
        bodyPlacebo,

      hitTick:
        bodyHitTick,

      primaryImprovementVsPlacebo:
        bodyPrimary
        &&
        bodyPlacebo
          ? bodyPlacebo.errorDegrees -
            bodyPrimary.errorDegrees
          : null
    }
  });
}


// ============================================================
// SUMMARY DISTRIBUTIONS
// ============================================================

const eyePrimaryErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.eye
        ?.primary
        ?.errorDegrees
  );


const eyePlaceboErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.eye
        ?.placebo
        ?.errorDegrees
  );


const eyeHitErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.eye
        ?.hitTick
        ?.errorDegrees
  );


const eyeBestLags =
  numericValues(
    caseResults,
    row =>
      row
        ?.eye
        ?.primary
        ?.lagTicks
  );


const eyeImprovement =
  numericValues(
    caseResults,
    row =>
      row
        ?.eye
        ?.primaryImprovementVsPlacebo
  );


const cameraPrimaryErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.camera
        ?.primary
        ?.errorDegrees
  );


const cameraPlaceboErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.camera
        ?.placebo
        ?.errorDegrees
  );


const cameraHitErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.camera
        ?.hitTick
        ?.errorDegrees
  );


const cameraBestLags =
  numericValues(
    caseResults,
    row =>
      row
        ?.camera
        ?.primary
        ?.lagTicks
  );


const bodyPrimaryErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.bodyYaw
        ?.primary
        ?.errorDegrees
  );


const bodyPlaceboErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.bodyYaw
        ?.placebo
        ?.errorDegrees
  );


const bodyHitErrors =
  numericValues(
    caseResults,
    row =>
      row
        ?.bodyYaw
        ?.hitTick
        ?.errorDegrees
  );


const bodyBestLags =
  numericValues(
    caseResults,
    row =>
      row
        ?.bodyYaw
        ?.primary
        ?.lagTicks
  );


// ============================================================
// PRIMARY VS PLACEBO PAIRWISE TEST
//
// Count how often the actual shot window is closer than the
// distant placebo window for the SAME shot direction.
//
// This is particularly robust because every event acts as its own
// control.
// ============================================================

const eyePrimaryWins =
  caseResults.filter(
    row =>
      Number.isFinite(
        row
          ?.eye
          ?.primary
          ?.errorDegrees
      )
      &&
      Number.isFinite(
        row
          ?.eye
          ?.placebo
          ?.errorDegrees
      )
      &&
      row.eye.primary.errorDegrees <
      row.eye.placebo.errorDegrees
  ).length;


const cameraPrimaryWins =
  caseResults.filter(
    row =>
      Number.isFinite(
        row
          ?.camera
          ?.primary
          ?.errorDegrees
      )
      &&
      Number.isFinite(
        row
          ?.camera
          ?.placebo
          ?.errorDegrees
      )
      &&
      row.camera.primary.errorDegrees <
      row.camera.placebo.errorDegrees
  ).length;


const bodyPrimaryWins =
  caseResults.filter(
    row =>
      Number.isFinite(
        row
          ?.bodyYaw
          ?.primary
          ?.errorDegrees
      )
      &&
      Number.isFinite(
        row
          ?.bodyYaw
          ?.placebo
          ?.errorDegrees
      )
      &&
      row.bodyYaw.primary.errorDegrees <
      row.bodyYaw.placebo.errorDegrees
  ).length;


// ============================================================
// FIELD HEAD-TO-HEAD
//
// Because body only has yaw, its error is not directly identical
// to full 3D eye/camera error.
//
// Eye vs camera IS directly comparable.
//
// We therefore compare eye and camera event-by-event.
// ============================================================

const eyeBeatsCamera =
  caseResults.filter(
    row =>
      Number.isFinite(
        row
          ?.eye
          ?.primary
          ?.errorDegrees
      )
      &&
      Number.isFinite(
        row
          ?.camera
          ?.primary
          ?.errorDegrees
      )
      &&
      row.eye.primary.errorDegrees <
      row.camera.primary.errorDegrees
  ).length;


const cameraBeatsEye =
  caseResults.filter(
    row =>
      Number.isFinite(
        row
          ?.eye
          ?.primary
          ?.errorDegrees
      )
      &&
      Number.isFinite(
        row
          ?.camera
          ?.primary
          ?.errorDegrees
      )
      &&
      row.camera.primary.errorDegrees <
      row.eye.primary.errorDegrees
  ).length;


const eyeCameraTies =
  caseResults.length -
  eyeBeatsCamera -
  cameraBeatsEye;


// ============================================================
// SOURCE-TYPE SUMMARIES
// ============================================================

const bySourceType =
  summarizeCaseGroups(
    caseResults,
    row =>
      row.sourceType ??
      'UNKNOWN'
  );


const byShooter =
  summarizeCaseGroups(
    caseResults,
    row =>
      row.shooterName ??
      'UNKNOWN'
  );


// ============================================================
// INTERPRETIVE FLAGS
//
// Thresholds deliberately require both:
//
//   low primary error
//
// and:
//
//   temporal specificity vs placebo.
//
// We do not want to call m_angEyeAngles "aim" merely because a
// character happened to face in approximately the right direction.
// ============================================================

const eyePrimarySummary =
  summarizeNumbers(
    eyePrimaryErrors
  );


const eyePlaceboSummary =
  summarizeNumbers(
    eyePlaceboErrors
  );


const eyeNearWindowStrong =
  eyePrimaryErrors.length >=
    50
  &&
  eyePrimarySummary.median <=
    7.5
  &&
  rate(
    eyePrimaryErrors.filter(
      value =>
        value <=
        15
    ).length,
    eyePrimaryErrors.length
  ) >=
    0.75;


const eyeTemporalSpecificityStrong =
  eyePrimaryErrors.length >=
    50
  &&
  eyePlaceboErrors.length >=
    50
  &&
  eyePlaceboSummary.median -
    eyePrimarySummary.median >=
    10
  &&
  rate(
    eyePrimaryWins,
    caseResults.length
  ) >=
    0.70;


const eyeAimOrientationStrong =
  eyeNearWindowStrong
  &&
  eyeTemporalSpecificityStrong;


const cameraPrimarySummary =
  summarizeNumbers(
    cameraPrimaryErrors
  );


const cameraAimCandidate =
  cameraPrimaryErrors.length >=
    50
  &&
  cameraPrimarySummary.median <=
    7.5;


const eyeMoreDirectThanCamera =
  eyeBeatsCamera >
    cameraBeatsEye
  &&
  rate(
    eyeBeatsCamera,
    eyeBeatsCamera +
    cameraBeatsEye
  ) >=
    0.60;


// ============================================================
// VALIDATION
// ============================================================

const validationChecks = {

  script97V02Passed:
    check(
      angleValidation
        ?.validation
        ?.pass,
      true,
      angleValidation
        ?.validation
        ?.pass ===
      true
    ),


  script61OutcomesPresent:
    check(
      outcomeRows.length,
      '>0',
      outcomeRows.length >
      0
    ),


  shotCasesPresent:
    check(
      cases.length,
      replayName ===
        'test'
        ? 105
        : '>0',
      replayName ===
        'test'
        ? cases.length ===
          105
        : cases.length >
          0
    ),


  damageDirectionCoverage:
    check(
      casesWithDirection.length,
      cases.length,
      casesWithDirection.length ===
      cases.length
    ),


  primarySnapshotCoverage:
    check(
      casesWithPrimarySnapshot.length,
      cases.length,
      casesWithPrimarySnapshot.length ===
      cases.length
    ),


  placeboSnapshotCoverage:
    check(
      casesWithPlaceboSnapshot.length,
      '>=90%',
      rate(
        casesWithPlaceboSnapshot.length,
        cases.length
      ) >=
      0.90
    ),


  comparableCasesPresent:
    check(
      comparableCases.length,
      '>=90',
      comparableCases.length >=
      90
    ),


  eyeConventionResolved:
    check(
      Boolean(
        bestEyeConvention
      ),
      true,
      Boolean(
        bestEyeConvention
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
// STATUS
// ============================================================

let status;


if (
  !validationPass
) {

  status =
    'PIPELINE_VALIDATION_FAILURE';

} else if (
  eyeAimOrientationStrong
) {

  status =
    'EYE_ANGLES_SHOT_DIRECTION_STRONGLY_SUPPORTED';

} else if (
  eyeNearWindowStrong
) {

  status =
    'EYE_ANGLES_DIRECTIONALLY_SUPPORTED_TEMPORAL_SPECIFICITY_WEAK';

} else {

  status =
    'SHOT_LINKED_ANGLE_DIAGNOSTIC_COMPLETE';
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  replay:
    replayName,

  version:
    'PLAYER_EYE_ANGLE_SHOT_DIRECTION_VALIDATION_V01',

  canonical:
    false,

  status,


  purpose: [

    'Validate m_angEyeAngles against independently observed player-shot direction.',

    'Use Script61 player-attributed CItemXP hits as positive-control attacks.',

    'Recover damageDirection from the original k_EUserMsg_Damage telemetry.',

    'Account for projectile travel time by searching the 0-48 ticks preceding impact.',

    'Use a 128-176 tick pre-impact placebo window to test temporal specificity.',

    'Determine the sign semantics of damageDirection and eye pitch.',

    'Compare eye orientation with third-person camera orientation and body yaw.'
  ],


  semanticLimits: {

    hitTelemetry:
      'CItemXP damage messages establish that the player hit the orb, providing a strong positive-control aiming event.',

    firingTime:
      'Exact projectile firing time is not directly observed here. The primary window searches up to 48 ticks before impact to accommodate travel time.',

    bestLag:
      'Per-event best lag is descriptive and should not be interpreted as exact projectile flight time without projectile-speed validation.',

    body:
      'Body orientation is evaluated only in yaw because Script97 V02 found no variable body pitch component.',

    camera:
      'Camera orientation may intentionally diverge from weapon/view orientation in Deadlock third-person camera behavior.',

    aim:
      'm_angEyeAngles is promoted to aim-orientation telemetry only if its shot-window error is both small and materially better than the same direction during the temporal placebo window.',

    canonical:
      'All conclusions remain validated within test.dem until cross-replay replication.'
  },


  inputs: {

    replayPath,

    angleValidationPath,

    shotOutcomePath
  },


  cohort: {

    script61Rows:
      outcomeRows.length,

    shotCases:
      cases.length,

    damageDirectionCases:
      casesWithDirection.length,

    primarySnapshotCases:
      casesWithPrimarySnapshot.length,

    placeboSnapshotCases:
      casesWithPlaceboSnapshot.length,

    comparableCases:
      comparableCases.length
  },


  telemetry: {

    demoPackets,

    relevantDemoPackets,

    requestedSnapshots,

    capturedSnapshots,

    messagePackets,

    relevantMessagePackets,

    matchedDamageMessages
  },


  originDirectionDiagnostic,


  eyeConventionSearch:
    eyeConventionCandidates,


  selectedConvention: {

    damageDirectionSign:
      directionSign,

    eyePitchSign:
      pitchSign,

    meaning:
      directionSign ===
        1
        ? 'USE_DAMAGE_DIRECTION_AS_REPORTED'
        : 'REVERSE_DAMAGE_DIRECTION'
  },


  eye: {

    primaryBestError:
      eyePrimarySummary,

    placeboBestError:
      eyePlaceboSummary,

    hitTickError:
      summarizeNumbers(
        eyeHitErrors
      ),

    bestLagTicks:
      summarizeNumbers(
        eyeBestLags
      ),

    bestLagSeconds:
      summarizeNumbers(
        eyeBestLags.map(
          ticks =>
            ticks /
            64
        )
      ),

    improvementVsPlacebo:
      summarizeNumbers(
        eyeImprovement
      ),

    primaryBeatsPlacebo:
      eyePrimaryWins,

    primaryBeatsPlaceboRate:
      rate(
        eyePrimaryWins,
        caseResults.length
      ),

    within2Primary:
      rate(
        eyePrimaryErrors.filter(
          value =>
            value <=
            2
        ).length,
        eyePrimaryErrors.length
      ),

    within5Primary:
      rate(
        eyePrimaryErrors.filter(
          value =>
            value <=
            5
        ).length,
        eyePrimaryErrors.length
      ),

    within10Primary:
      rate(
        eyePrimaryErrors.filter(
          value =>
            value <=
            10
        ).length,
        eyePrimaryErrors.length
      ),

    within15Primary:
      rate(
        eyePrimaryErrors.filter(
          value =>
            value <=
            15
        ).length,
        eyePrimaryErrors.length
      )
  },


  camera: {

    primaryBestError:
      cameraPrimarySummary,

    placeboBestError:
      summarizeNumbers(
        cameraPlaceboErrors
      ),

    hitTickError:
      summarizeNumbers(
        cameraHitErrors
      ),

    bestLagTicks:
      summarizeNumbers(
        cameraBestLags
      ),

    primaryBeatsPlacebo:
      cameraPrimaryWins,

    primaryBeatsPlaceboRate:
      rate(
        cameraPrimaryWins,
        caseResults.length
      )
  },


  bodyYaw: {

    primaryBestError:
      summarizeNumbers(
        bodyPrimaryErrors
      ),

    placeboBestError:
      summarizeNumbers(
        bodyPlaceboErrors
      ),

    hitTickError:
      summarizeNumbers(
        bodyHitErrors
      ),

    bestLagTicks:
      summarizeNumbers(
        bodyBestLags
      ),

    primaryBeatsPlacebo:
      bodyPrimaryWins,

    primaryBeatsPlaceboRate:
      rate(
        bodyPrimaryWins,
        caseResults.length
      )
  },


  eyeVsCamera: {

    eyeBeatsCamera,

    cameraBeatsEye,

    ties:
      eyeCameraTies,

    eyeWinRateAmongNonTies:
      rate(
        eyeBeatsCamera,
        eyeBeatsCamera +
        cameraBeatsEye
      )
  },


  groupedResults: {

    bySourceType,

    byShooter
  },


  interpretation: {

    eyeNearWindowStrong,

    eyeTemporalSpecificityStrong,

    eyeAimOrientationStrong,

    cameraAimCandidate,

    eyeMoreDirectThanCamera
  },


  interpretationGuide: {

    directionSign:
      'The selected damageDirection sign determines whether the raw message vector points along the projectile travel direction or opposite it.',

    pitchSign:
      'The selected pitch sign determines how m_angEyeAngles component 0 maps onto Cartesian vertical elevation.',

    shotWindow:
      'A low eye-angle error in the 0-48 tick pre-impact window supports m_angEyeAngles as the direction from which the successful shot was launched.',

    placebo:
      'A substantially worse 128-176 tick placebo error demonstrates that alignment is specific to the attack period rather than generic facing direction.',

    camera:
      'If eye angles outperform camera angles, m_angEyeAngles should be preferred for aim-relative behavioral features while m_angClientCamera remains a separate camera-state variable.',

    body:
      'Body yaw can remain useful as physical facing even if eye angles are superior for shot direction.',

    next:
      eyeAimOrientationStrong
        ? 'Promote m_angEyeAngles to operational aim-orientation telemetry within test.dem and run the foundational discovery checkpoint before compact cross-replay replication.'
        : 'Inspect shot-linked lag and error structure before deciding whether another aim semantic test is necessary.'
  },


  validation: {

    pass:
      validationPass,

    checks:
      validationChecks
  },


  outputs: {

    summary:
      outputSummaryPath,

    cases:
      outputCasesPath
  }
};


// ============================================================
// WRITE
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


const writer =
  createWriteStream(
    outputCasesPath,
    {
      encoding:
        'utf8'
    }
  );


for (
  const row
  of caseResults
) {

  writer.write(
    `${JSON.stringify(row)}\n`
  );
}


await finishWriter(
  writer
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'PLAYER EYE ANGLES VS SHOT DIRECTION V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// COHORT
// ============================================================

console.log('');

console.log(
  'COHORT / COVERAGE'
);

console.log(
  '-----------------'
);


console.log(
  `Script61 shot cases:        ${cases.length}`
);


console.log(
  `damageDirection recovered:  ${casesWithDirection.length}/${cases.length}`
);


console.log(
  `Primary-window snapshots:   ${casesWithPrimarySnapshot.length}/${cases.length}`
);


console.log(
  `Placebo-window snapshots:   ${casesWithPlaceboSnapshot.length}/${cases.length}`
);


console.log(
  `Fully comparable cases:     ${comparableCases.length}`
);


// ============================================================
// DAMAGE DIRECTION SIGN
// ============================================================

console.log('');

console.log(
  'DAMAGE-DIRECTION ORIGIN DIAGNOSTIC'
);

console.log(
  '----------------------------------'
);


console.log(
  `Comparable origin cases: ${originDirectionDiagnostic.comparable}`
);


console.log(
  `Direct vector error:     ${formatDistribution(originDirectionDiagnostic.direct)}`
);


console.log(
  `Reverse vector error:    ${formatDistribution(originDirectionDiagnostic.reverse)}`
);


// ============================================================
// CONVENTION SEARCH
// ============================================================

console.log('');

console.log(
  'EYE DIRECTION CONVENTION SEARCH'
);

console.log(
  '-------------------------------'
);


for (
  const row
  of eyeConventionCandidates
) {

  console.log(

    `directionSign=${String(row.directionSign).padStart(2)} ` +

    `pitchSign=${String(row.pitchSign).padStart(2)} ` +

    `n=${String(row.count).padStart(3)} ` +

    `median=${formatNumber(row.error.median).padStart(8)}° ` +

    `p75=${formatNumber(row.error.p75).padStart(8)}° ` +

    `p95=${formatNumber(row.error.p95).padStart(8)}° ` +

    `<=5=${formatPercent(row.within5).padStart(8)} ` +

    `<=10=${formatPercent(row.within10).padStart(8)}`
  );
}


console.log('');

console.log(
  `Selected damageDirection sign: ${directionSign}`
);


console.log(
  `Selected eye pitch sign:       ${pitchSign}`
);


// ============================================================
// EYE
// ============================================================

console.log('');

console.log(
  'EYE ANGLES'
);

console.log(
  '----------'
);


console.log(
  `Primary best error:   ${formatDistribution(eyePrimarySummary)}`
);


console.log(
  `Placebo best error:   ${formatDistribution(eyePlaceboSummary)}`
);


console.log(
  `Impact-tick error:    ${formatDistribution(
    summarizeNumbers(
      eyeHitErrors
    )
  )}`
);


console.log(
  `Best lag ticks:       ${formatDistribution(
    summarizeNumbers(
      eyeBestLags
    )
  )}`
);


console.log(
  `Best lag seconds:     ${formatDistribution(
    summarizeNumbers(
      eyeBestLags.map(
        ticks =>
          ticks /
          64
      )
    )
  )}`
);


console.log(
  `Primary beats placebo:${eyePrimaryWins}/${caseResults.length} (${formatPercent(
    rate(
      eyePrimaryWins,
      caseResults.length
    )
  )})`
);


console.log(
  `Primary <=2°:         ${formatPercent(
    rate(
      eyePrimaryErrors.filter(
        value =>
          value <=
          2
      ).length,
      eyePrimaryErrors.length
    )
  )}`
);


console.log(
  `Primary <=5°:         ${formatPercent(
    rate(
      eyePrimaryErrors.filter(
        value =>
          value <=
          5
      ).length,
      eyePrimaryErrors.length
    )
  )}`
);


console.log(
  `Primary <=10°:        ${formatPercent(
    rate(
      eyePrimaryErrors.filter(
        value =>
          value <=
          10
      ).length,
      eyePrimaryErrors.length
    )
  )}`
);


console.log(
  `Primary <=15°:        ${formatPercent(
    rate(
      eyePrimaryErrors.filter(
        value =>
          value <=
          15
      ).length,
      eyePrimaryErrors.length
    )
  )}`
);


// ============================================================
// CAMERA
// ============================================================

console.log('');

console.log(
  'CAMERA ANGLES'
);

console.log(
  '-------------'
);


console.log(
  `Primary best error:   ${formatDistribution(cameraPrimarySummary)}`
);


console.log(
  `Placebo best error:   ${formatDistribution(
    summarizeNumbers(
      cameraPlaceboErrors
    )
  )}`
);


console.log(
  `Impact-tick error:    ${formatDistribution(
    summarizeNumbers(
      cameraHitErrors
    )
  )}`
);


console.log(
  `Primary beats placebo:${cameraPrimaryWins}/${caseResults.length} (${formatPercent(
    rate(
      cameraPrimaryWins,
      caseResults.length
    )
  )})`
);


// ============================================================
// BODY YAW
// ============================================================

console.log('');

console.log(
  'BODY YAW'
);

console.log(
  '--------'
);


console.log(
  `Primary best error:   ${formatDistribution(
    summarizeNumbers(
      bodyPrimaryErrors
    )
  )}`
);


console.log(
  `Placebo best error:   ${formatDistribution(
    summarizeNumbers(
      bodyPlaceboErrors
    )
  )}`
);


console.log(
  `Impact-tick error:    ${formatDistribution(
    summarizeNumbers(
      bodyHitErrors
    )
  )}`
);


console.log(
  `Primary beats placebo:${bodyPrimaryWins}/${caseResults.length} (${formatPercent(
    rate(
      bodyPrimaryWins,
      caseResults.length
    )
  )})`
);


// ============================================================
// EYE VS CAMERA
// ============================================================

console.log('');

console.log(
  'EYE VS CAMERA'
);

console.log(
  '-------------'
);


console.log(
  `Eye better:      ${eyeBeatsCamera}`
);


console.log(
  `Camera better:   ${cameraBeatsEye}`
);


console.log(
  `Ties:            ${eyeCameraTies}`
);


console.log(
  `Eye win rate:    ${formatPercent(
    rate(
      eyeBeatsCamera,
      eyeBeatsCamera +
      cameraBeatsEye
    )
  )}`
);


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
  `Eye near-window strong:        ${eyeNearWindowStrong}`
);


console.log(
  `Eye temporal specificity:      ${eyeTemporalSpecificityStrong}`
);


console.log(
  `Eye aim orientation strong:    ${eyeAimOrientationStrong}`
);


console.log(
  `Camera aim candidate:          ${cameraAimCandidate}`
);


console.log(
  `Eye more direct than camera:   ${eyeMoreDirectThanCamera}`
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
  `Summary:\n${outputSummaryPath}`
);


console.log('');

console.log(
  `Cases:\n${outputCasesPath}`
);


console.log('');


// ============================================================
// PLAYER SNAPSHOT
// ============================================================

function collectPlayerSnapshots(
  demo,
  requestedNames
) {

  const output =
    new Map();


  const controllers =
    demo.getEntitiesByClassName(
      'CCitadelPlayerController'
    )
    ??
    [];


  for (
    const controller
    of controllers
  ) {

    const playerName =
      safeGetField(
        controller,
        'm_iszPlayerName'
      );


    if (
      !playerName
      ||
      !requestedNames.has(
        String(
          playerName
        )
      )
    ) {

      continue;
    }


    let pawnHandle =
      safeGetField(
        controller,
        'm_hHeroPawn'
      );


    if (
      isInvalidHandle(
        pawnHandle
      )
    ) {

      pawnHandle =
        safeGetField(
          controller,
          'm_hPawn'
        );
    }


    if (
      isInvalidHandle(
        pawnHandle
      )
    ) {

      continue;
    }


    let pawn;


    try {

      pawn =
        demo.getEntityByHandle(
          pawnHandle
        );

    } catch {

      pawn =
        null;
    }


    if (
      !pawn
    ) {

      continue;
    }


    const bodyRotation =
      normalizeAngleTriple(
        safeGetField(
          pawn,
          'CBodyComponent.m_angRotation'
        )
      );


    const eyeAngles =
      normalizeAngleTriple(
        safeGetField(
          pawn,
          'm_angEyeAngles'
        )
      );


    const cameraAngles =
      normalizeAngleTriple(
        safeGetField(
          pawn,
          'm_angClientCamera'
        )
      );


    const position =
      getWorldPositionDetailed(
        pawn
      );


    output.set(
      String(
        playerName
      ),
      {

        pawnEntityIndex:
          getEntityIndex(
            pawn
          ),

        position,

        bodyRotation,

        eyeAngles,

        cameraAngles
      }
    );
  }


  return output;
}


// ============================================================
// BEST 3D MATCH
// ============================================================

function findBest3DMatch(
  row,
  field,
  directionSign,
  pitchSign,
  minLag,
  maxLag
) {

  const direction =
    row.hitMessage
      ?.damageDirection;


  if (
    !direction
  ) {

    return null;
  }


  const targetDirection =
    normalizeUnitVector(
      scaleVector(
        direction,
        directionSign
      )
    );


  if (
    !targetDirection
  ) {

    return null;
  }


  let best =
    null;


  for (
    let lag =
      minLag;

    lag <=
      maxLag;

    lag++
  ) {

    const snapshot =
      row.snapshots.get(
        lag
      );


    const angles =
      snapshot?.[
        field
      ];


    if (
      !angles
    ) {

      continue;
    }


    const pitch =
      angles[
        PITCH_COMPONENT
      ];


    const yaw =
      angles[
        YAW_COMPONENT
      ];


    if (
      !Number.isFinite(
        pitch
      )
      ||
      !Number.isFinite(
        yaw
      )
    ) {

      continue;
    }


    const forward =
      anglesToForwardVector(
        yaw,
        pitch,
        pitchSign
      );


    const error =
      vectorAngleDegrees(
        forward,
        targetDirection
      );


    if (
      !Number.isFinite(
        error
      )
    ) {

      continue;
    }


    if (
      !best
      ||
      error <
      best.errorDegrees
    ) {

      best = {

        lagTicks:
          lag,

        lagSeconds:
          lag /
          64,

        tick:
          row.hitTick -
          lag,

        yaw,

        pitch,

        errorDegrees:
          error
      };
    }
  }


  return best;
}


// ============================================================
// EXACT 3D MATCH AT ONE LAG
// ============================================================

function evaluateExact3DAtLag(
  row,
  field,
  directionSign,
  pitchSign,
  lag
) {

  const direction =
    row.hitMessage
      ?.damageDirection;


  const snapshot =
    row.snapshots.get(
      lag
    );


  const angles =
    snapshot?.[
      field
    ];


  if (
    !direction
    ||
    !angles
  ) {

    return null;
  }


  const yaw =
    angles[
      YAW_COMPONENT
    ];


  const pitch =
    angles[
      PITCH_COMPONENT
    ];


  if (
    !Number.isFinite(
      yaw
    )
    ||
    !Number.isFinite(
      pitch
    )
  ) {

    return null;
  }


  const targetDirection =
    normalizeUnitVector(
      scaleVector(
        direction,
        directionSign
      )
    );


  const forward =
    anglesToForwardVector(
      yaw,
      pitch,
      pitchSign
    );


  return {

    lagTicks:
      lag,

    tick:
      row.hitTick -
      lag,

    yaw,

    pitch,

    errorDegrees:
      vectorAngleDegrees(
        forward,
        targetDirection
      )
  };
}


// ============================================================
// BEST YAW MATCH
// ============================================================

function findBestYawMatch(
  row,
  field,
  directionSign,
  minLag,
  maxLag
) {

  const direction =
    row.hitMessage
      ?.damageDirection;


  if (
    !direction
  ) {

    return null;
  }


  const signedDirection =
    scaleVector(
      direction,
      directionSign
    );


  const targetYaw =
    normalizeDegrees(
      radiansToDegrees(
        Math.atan2(
          signedDirection.y,
          signedDirection.x
        )
      )
    );


  let best =
    null;


  for (
    let lag =
      minLag;

    lag <=
      maxLag;

    lag++
  ) {

    const snapshot =
      row.snapshots.get(
        lag
      );


    const angles =
      snapshot?.[
        field
      ];


    if (
      !angles
    ) {

      continue;
    }


    const yaw =
      angles[
        YAW_COMPONENT
      ];


    if (
      !Number.isFinite(
        yaw
      )
    ) {

      continue;
    }


    const error =
      circularDifference(
        yaw,
        targetYaw
      );


    if (
      !best
      ||
      error <
      best.errorDegrees
    ) {

      best = {

        lagTicks:
          lag,

        lagSeconds:
          lag /
          64,

        tick:
          row.hitTick -
          lag,

        yaw,

        targetYaw,

        errorDegrees:
          error
      };
    }
  }


  return best;
}


// ============================================================
// EXACT YAW
// ============================================================

function evaluateExactYawAtLag(
  row,
  field,
  directionSign,
  lag
) {

  const direction =
    row.hitMessage
      ?.damageDirection;


  const snapshot =
    row.snapshots.get(
      lag
    );


  const angles =
    snapshot?.[
      field
    ];


  if (
    !direction
    ||
    !angles
  ) {

    return null;
  }


  const yaw =
    angles[
      YAW_COMPONENT
    ];


  if (
    !Number.isFinite(
      yaw
    )
  ) {

    return null;
  }


  const signedDirection =
    scaleVector(
      direction,
      directionSign
    );


  const targetYaw =
    normalizeDegrees(
      radiansToDegrees(
        Math.atan2(
          signedDirection.y,
          signedDirection.x
        )
      )
    );


  return {

    lagTicks:
      lag,

    tick:
      row.hitTick -
      lag,

    yaw,

    targetYaw,

    errorDegrees:
      circularDifference(
        yaw,
        targetYaw
      )
  };
}


// ============================================================
// ANGLES -> FORWARD VECTOR
//
// Validated yaw convention:
//
//   x = cos(yaw)
//   y = sin(yaw)
//
// Pitch sign remains empirical.
//
// pitchSign = +1:
//
//   positive pitch -> positive Z
//
// pitchSign = -1:
//
//   positive pitch -> negative Z
// ============================================================

function anglesToForwardVector(
  yawDegrees,
  pitchDegrees,
  pitchSign
) {

  const yaw =
    degreesToRadians(
      normalizeDegrees(
        yawDegrees
      )
    );


  const signedPitchDegrees =
    signedAngleDegrees(
      pitchDegrees
    )
    *
    pitchSign;


  const pitch =
    degreesToRadians(
      signedPitchDegrees
    );


  const cosPitch =
    Math.cos(
      pitch
    );


  return normalizeUnitVector({

    x:
      cosPitch *
      Math.cos(
        yaw
      ),

    y:
      cosPitch *
      Math.sin(
        yaw
      ),

    z:
      Math.sin(
        pitch
      )
  });
}


// ============================================================
// SNAPSHOT COVERAGE
// ============================================================

function hasSnapshotInRange(
  row,
  minLag,
  maxLag
) {

  for (
    let lag =
      minLag;

    lag <=
      maxLag;

    lag++
  ) {

    if (
      row.snapshots.has(
        lag
      )
    ) {

      return true;
    }
  }


  return false;
}


// ============================================================
// WORLD POSITION
// ============================================================

function getWorldPositionDetailed(
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
      512 -
      16384 +
      vecX,

    y:
      cellY *
      512 -
      16384 +
      vecY,

    z:
      (
        cellZ !==
          null
        &&
        vecZ !==
          null
      )
        ? cellZ *
          512 -
          16384 +
          vecZ
        : null
  };
}


// ============================================================
// VECTOR
// ============================================================

function normalizeVector(
  value
) {

  if (
    !value
    ||
    typeof value !==
      'object'
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
    ||
    z ===
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


function normalizeUnitVector(
  vector
) {

  if (
    !vector
  ) {

    return null;
  }


  const magnitude =
    Math.sqrt(
      vector.x *
        vector.x
      +
      vector.y *
        vector.y
      +
      vector.z *
        vector.z
    );


  if (
    !Number.isFinite(
      magnitude
    )
    ||
    magnitude <=
      1e-9
  ) {

    return null;
  }


  return {

    x:
      vector.x /
      magnitude,

    y:
      vector.y /
      magnitude,

    z:
      vector.z /
      magnitude
  };
}


function scaleVector(
  vector,
  scale
) {

  return {

    x:
      vector.x *
      scale,

    y:
      vector.y *
      scale,

    z:
      vector.z *
      scale
  };
}


function vectorAngleDegrees(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return null;
  }


  const ua =
    normalizeUnitVector(
      a
    );


  const ub =
    normalizeUnitVector(
      b
    );


  if (
    !ua
    ||
    !ub
  ) {

    return null;
  }


  const dot =
    clamp(
      ua.x *
        ub.x
      +
      ua.y *
        ub.y
      +
      ua.z *
        ub.z,
      -1,
      1
    );


  return radiansToDegrees(
    Math.acos(
      dot
    )
  );
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


  let values;


  if (
    Array.isArray(
      value
    )
  ) {

    values = [

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

      values = [

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

      values = [

        value.x,
        value.y,
        value.z
      ];

    } else {

      return null;
    }

  } else {

    return null;
  }


  const numeric =
    values.map(
      finite
    );


  if (
    numeric.some(
      value =>
        value ===
        null
    )
  ) {

    return null;
  }


  return numeric;
}


// ============================================================
// MESSAGE DATA
// ============================================================

function getMessageData(
  packet
) {

  return packet?.data ??
    packet?.message ??
    packet?.payload ??
    null;
}


// ============================================================
// ENTITY REFERENCE
// ============================================================

function normalizeEntityReference(
  value
) {

  const number =
    finite(
      value
    );


  if (
    number ===
      null
  ) {

    return null;
  }


  const integer =
    Math.trunc(
      number
    );


  if (
    integer <
    0
  ) {

    return null;
  }


  if (
    integer <=
    ENTITY_INDEX_MASK
  ) {

    return integer;
  }


  return integer &
    ENTITY_INDEX_MASK;
}


// ============================================================
// RAW ENTITY HELPERS
// ============================================================

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


function getEntityIndex(
  entity
) {

  const direct =
    finite(
      entity?.index ??
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


function isInvalidHandle(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return true;
  }


  try {

    const parsed =
      BigInt(
        value
      );


    return (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    );

  } catch {

    return true;
  }
}


// ============================================================
// KEYS / MAPS
// ============================================================

function messageKey(
  tick,
  victimIndex,
  attackerIndex
) {

  return `${tick}|${victimIndex}|${attackerIndex}`;
}


function pushMapArray(
  map,
  key,
  value
) {

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


  map
    .get(
      key
    )
    .push(
      value
    );
}


// ============================================================
// CASE GROUP SUMMARY
// ============================================================

function summarizeCaseGroups(
  rows,
  selector
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      String(
        selector(
          row
        )
        ??
        'UNKNOWN'
      );


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );
    }


    groups
      .get(
        key
      )
      .push(
        row
      );
  }


  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          group,
          groupRows
        ]
      ) => ({

        group,

        count:
          groupRows.length,

        eyePrimary:
          summarizeNumbers(
            numericValues(
              groupRows,
              row =>
                row
                  ?.eye
                  ?.primary
                  ?.errorDegrees
            )
          ),

        eyePlacebo:
          summarizeNumbers(
            numericValues(
              groupRows,
              row =>
                row
                  ?.eye
                  ?.placebo
                  ?.errorDegrees
            )
          ),

        cameraPrimary:
          summarizeNumbers(
            numericValues(
              groupRows,
              row =>
                row
                  ?.camera
                  ?.primary
                  ?.errorDegrees
            )
          ),

        bodyYawPrimary:
          summarizeNumbers(
            numericValues(
              groupRows,
              row =>
                row
                  ?.bodyYaw
                  ?.primary
                  ?.errorDegrees
            )
          )
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        b.count -
          a.count
        ||
        a.group.localeCompare(
          b.group
        )
    );
}


// ============================================================
// NUMERIC VALUES
// ============================================================

function numericValues(
  rows,
  selector
) {

  return rows
    .map(
      selector
    )
    .filter(
      Number.isFinite
    );
}


// ============================================================
// FILE HELPERS
// ============================================================

async function loadJsonl(
  path
) {

  const rows =
    [];


  const reader =
    createInterface({

      input:
        createReadStream(
          path,
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


    try {

      rows.push(
        JSON.parse(
          line
        )
      );

    } catch {}
  }


  return rows;
}


async function finishWriter(
  writer
) {

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


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );
}


// ============================================================
// ANGLES
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


function signedAngleDegrees(
  value
) {

  let output =
    normalizeDegrees(
      value
    );


  if (
    output >
    180
  ) {

    output -=
      360;
  }


  return output;
}


function circularDifference(
  a,
  b
) {

  let difference =
    Math.abs(
      normalizeDegrees(
        a
      )
      -
      normalizeDegrees(
        b
      )
    );


  if (
    difference >
    180
  ) {

    difference =
      360 -
      difference;
  }


  return difference;
}


function degreesToRadians(
  degrees
) {

  return degrees *
    Math.PI /
    180;
}


function radiansToDegrees(
  radians
) {

  return radians *
    180 /
    Math.PI;
}


// ============================================================
// DISTRIBUTION
// ============================================================

function summarizeNumbers(
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
      clean.reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      )
      /
      clean.length
  };
}


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
// SIMPLE SERIALIZATION
// ============================================================

function serializeSimple(
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


  try {

    return JSON.parse(
      JSON.stringify(
        value,
        (
          key,
          item
        ) =>
          typeof item ===
          'bigint'
            ? item.toString()
            : item
      )
    );

  } catch {

    return String(
      value
    );
  }
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


function formatDistribution(
  row
) {

  if (
    !row
    ||
    row.count ===
      0
  ) {

    return 'n=0';
  }


  return (
    `n=${row.count} ` +
    `min=${formatNumber(row.min)} ` +
    `p25=${formatNumber(row.p25)} ` +
    `median=${formatNumber(row.median)} ` +
    `p75=${formatNumber(row.p75)} ` +
    `p95=${formatNumber(row.p95)} ` +
    `p99=${formatNumber(row.p99)} ` +
    `max=${formatNumber(row.max)}`
  );
}