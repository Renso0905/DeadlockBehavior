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
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';


// ============================================================
// INPUTS
//
// These are the current authoritative checkpoints for the
// foundational semantics we need before cross-replay replication.
//
// Deliberately excluded:
//
// - Script97 V01
//   superseded by Script97 V02.
//
// - old ~45m ground-soul work
//   superseded by later lifecycle / proximity work.
//
// - exact 732 vs 735 HU tuning
//   intentionally deferred to replication.
//
// - Script94 comeback-model exploration
//   downstream reward work superseded it operationally.
// ============================================================

const inputs = {

  lifecycle:
    resolve(
      'output',
      replayName,
      'assigned_gold_lifecycle_classifier_v01.json'
    ),

  exactCredit:
    resolve(
      'output',
      replayName,
      'assigned_gold_exact_credit_attribution_validation_v01.json'
    ),

  sharingGeometry:
    resolve(
      'output',
      replayName,
      'assigned_gold_share_recipient_geometry_comparison_v01.json'
    ),

  integerAllocation:
    resolve(
      'output',
      replayName,
      'assigned_gold_final_integer_allocation_validation_v01.json'
    ),

  facingAngles:
    resolve(
      'output',
      replayName,
      'player_facing_angle_semantics_validation_v02.json'
    ),

  aimAngles:
    resolve(
      'output',
      replayName,
      'player_eye_angle_shot_direction_validation_v01.json'
    )
};


const outputJsonPath =
  resolve(
    'output',
    replayName,
    'foundational_discovery_checkpoint_v01.json'
  );


const outputMarkdownPath =
  resolve(
    'output',
    replayName,
    'foundational_discovery_checkpoint_v01.md'
  );


// ============================================================
// LOAD
// ============================================================

console.log('');

console.log(
  'Loading foundational validation summaries...'
);


const loaded =
  {};


for (
  const [
    key,
    path
  ]
  of Object.entries(
    inputs
  )
) {

  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing required foundational input:\n${path}`
    );
  }


  loaded[
    key
  ] =
    JSON.parse(
      readFileSync(
        path,
        'utf8'
      )
    );


  console.log(
    `${key.padEnd(20)} ${path}`
  );
}


// ============================================================
// VALIDATION STATUS
// ============================================================

const sourceStatus =
  {};


for (
  const [
    key,
    value
  ]
  of Object.entries(
    loaded
  )
) {

  sourceStatus[
    key
  ] = {

    validationPass:
      value
        ?.validation
        ?.pass ===
      true,

    version:
      value?.version ??
      null,

    status:
      value?.status ??
      null
  };
}


// ============================================================
// EXTRACT IMPORTANT BOOLEAN FLAGS
//
// deepFindValueByKey allows this checkpoint to tolerate minor
// differences in where previous scripts nested their
// interpretive flags.
// ============================================================

const evidenceFlags = {

  // ----------------------------------------------------------
  // SCRIPT 89
  // ----------------------------------------------------------

  creditedAssignmentStrong:
    findBoolean(
      loaded.exactCredit,
      'creditedAssignmentStrong'
    ),

  physicalTargetNotExclusive:
    findBoolean(
      loaded.exactCredit,
      'physicalTargetNotExclusive'
    ),

  sharedCreditCandidate:
    findBoolean(
      loaded.exactCredit,
      'sharedCreditCandidate'
    ),

  targetlessNoPayoutSupported:
    findBoolean(
      loaded.exactCredit,
      'targetlessNoPayoutSupported'
    ),


  // ----------------------------------------------------------
  // SCRIPT 96
  // ----------------------------------------------------------

  observedIntegerPartitionStrong:
    findBoolean(
      loaded.integerAllocation,
      'observedIntegerPartitionStrong'
    ),

  correctedRewardModelStrong:
    findBoolean(
      loaded.integerAllocation,
      'correctedRewardModelStrong'
    ),

  creditedPlayerAlwaysIncluded:
    firstBoolean([
      findBoolean(
        loaded.integerAllocation,
        'creditedPlayerAlwaysIncluded'
      ),

      findBoolean(
        loaded.integerAllocation,
        'creditedRecipientCoverage'
      )
    ]),

  creditedRemainderPriorityStrong:
    findBoolean(
      loaded.integerAllocation,
      'creditedRemainderPriorityStrong'
    ),

  modelConfirmedRemainderPriority:
    findBoolean(
      loaded.integerAllocation,
      'modelConfirmedRemainderPriority'
    ),

  physicalTargetRemainderPriority:
    findBoolean(
      loaded.integerAllocation,
      'physicalTargetRemainderPriority'
    ),


  // ----------------------------------------------------------
  // SCRIPT 97 V02
  // ----------------------------------------------------------

  yawComponentsNonconstant:
    findBoolean(
      loaded.facingAngles,
      'yawComponentsNonConstant'
    ),

  yawComponentsBroad:
    findBoolean(
      loaded.facingAngles,
      'yawComponentsBroad'
    ),

  worldYawConventionStrong:
    findBoolean(
      loaded.facingAngles,
      'worldYawConventionStrong'
    ),

  bodyWorldYawStrong:
    findBoolean(
      loaded.facingAngles,
      'bodyWorldYawStrong'
    ),

  eyeWorldYawStrong:
    findBoolean(
      loaded.facingAngles,
      'eyeWorldYawStrong'
    ),

  cameraWorldYawSupported:
    findBoolean(
      loaded.facingAngles,
      'cameraWorldYawSupported'
    ),


  // ----------------------------------------------------------
  // SCRIPT 98
  // ----------------------------------------------------------

  eyeNearWindowStrong:
    findBoolean(
      loaded.aimAngles,
      'eyeNearWindowStrong'
    ),

  eyeTemporalSpecificityStrong:
    findBoolean(
      loaded.aimAngles,
      'eyeTemporalSpecificityStrong'
    ),

  eyeAimOrientationStrong:
    findBoolean(
      loaded.aimAngles,
      'eyeAimOrientationStrong'
    ),

  eyeMoreDirectThanCamera:
    findBoolean(
      loaded.aimAngles,
      'eyeMoreDirectThanCamera'
    )
};


// ============================================================
// IMPORTANT NUMERIC EVIDENCE
//
// These are diagnostic convenience fields.
//
// Failure to find one does NOT fail the checkpoint because the
// source validation itself remains authoritative.
// ============================================================

const numericEvidence = {

  shareGeometryThresholdHU:
    findNumberNearKeys(
      loaded.sharingGeometry,
      [
        'threshold'
      ],
      [
        'overall',
        'best'
      ]
    ),

  shareGeometryMCC:
    findNumberNearKeys(
      loaded.sharingGeometry,
      [
        'mcc'
      ],
      [
        'overall',
        'best'
      ]
    ),

  eyePrimaryMedianErrorDegrees:
    findNestedNumber(
      loaded.aimAngles,
      [
        'eye',
        'primaryBestError',
        'median'
      ]
    ),

  eyePlaceboMedianErrorDegrees:
    findNestedNumber(
      loaded.aimAngles,
      [
        'eye',
        'placeboBestError',
        'median'
      ]
    ),

  eyePrimaryBeatsPlaceboRate:
    findNestedNumber(
      loaded.aimAngles,
      [
        'eye',
        'primaryBeatsPlaceboRate'
      ]
    ),

  eyeCameraWinRate:
    findNestedNumber(
      loaded.aimAngles,
      [
        'eyeVsCamera',
        'eyeWinRateAmongNonTies'
      ]
    )
};


// ============================================================
// AUTHORITATIVE OPERATIONAL CLAIMS
//
// These are intentionally framed as:
//
//   validated within test.dem
//
// NOT:
//
//   canonical Deadlock mechanics.
//
// Cross-replay replication is still required.
// ============================================================

const operationalClaims = [

  {
    id:
      'GROUND_SOUL_LIFECYCLE',

    state:
      'VALIDATED_WITHIN_TEST_DEM',

    claim:
      'Matched AssignedGold episodes can be exhaustively classified into targeted immediate, targeted early-floor, targeted stable-floor, targetless match-time-scaled timeout-candidate, and censored targetless lifecycle classes.',

    authority:
      'SCRIPT_87'
  },

  {
    id:
      'VACUUM_TARGET_NOT_ECONOMIC_OWNER',

    state:
      'STRONGLY_SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'm_hVacuumTarget represents physical vacuum targeting and is not the exclusive economic-recipient authority.',

    authority:
      'SCRIPT_89'
  },

  {
    id:
      'CREDITED_LAST_HITTER_ECONOMICALLY_INCLUDED',

    state:
      'STRONGLY_SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'The credited last-hitter is strongly associated with the AssignedGold economic recipient set and is consistently included in the validated exact-partition cohort.',

    authority:
      'SCRIPTS_89_96'
  },

  {
    id:
      'GROUND_SOUL_RECIPIENT_SET_GEOMETRY',

    state:
      'STRONGLY_SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'Economic-sharing membership is best explained in the validated cohort by death-time 3D distance from the Trooper, with an empirical ~2150 HU envelope.',

    authority:
      'SCRIPT_92',

    caution:
      '2150 HU is an empirical single-replay boundary and is not promoted to an exact canonical engine constant.'
  },

  {
    id:
      'GROUND_SOUL_INTEGER_ALLOCATION',

    state:
      'STRONGLY_SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'Observed AssignedGold team reward is distributed as an exact integer partition among recipients, with strong credited-last-hitter remainder priority.',

    authority:
      'SCRIPT_96'
  },

  {
    id:
      'TARGETLESS_NO_PAYOUT',

    state:
      'SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'Targetless lifecycle termination has strong exact-tick negative-control support for no AssignedGold payout.',

    authority:
      'SCRIPT_89',

    caution:
      'Use targetless lifecycle termination / timeout candidate rather than claiming canonical expiration semantics.'
  },

  {
    id:
      'WORLD_YAW',

    state:
      'STRONGLY_SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'Angle component 1 behaves as yaw for body, eye, and camera orientation, using PLUS_YAW_0 world convention: 0°=+X, 90°=+Y, 180°=-X, 270°=-Y.',

    authority:
      'SCRIPT_97_V02'
  },

  {
    id:
      'EYE_ANGLE_AIM_ORIENTATION',

    state:
      'STRONGLY_SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'm_angEyeAngles component 1 is operational shot/aim yaw and component 0 is pitch with negative Cartesian pitch sign.',

    authority:
      'SCRIPT_98'
  },

  {
    id:
      'CAMERA_DISTINCT_FROM_AIM',

    state:
      'SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'm_angClientCamera is a distinct third-person camera-orientation signal and should not replace m_angEyeAngles for aim-relative behavioral features.',

    authority:
      'SCRIPTS_97_V02_98'
  },

  {
    id:
      'BODY_FACING_PROXY',

    state:
      'SUPPORTED_WITHIN_TEST_DEM',

    claim:
      'CBodyComponent.m_angRotation component 1 is a movement-aligned body-facing yaw proxy.',

    authority:
      'SCRIPT_97_V02',

    caution:
      'Exact animation/model-facing semantics remain narrower than the operational body-yaw proxy.'
  }
];


// ============================================================
// REQUIRED FOUNDATION CHECKS
// ============================================================

const requiredSourcePass =
  Object
    .values(
      sourceStatus
    )
    .every(
      row =>
        row.validationPass
    );


const semanticChecks = {

  lifecyclePipeline:
    sourceStatus
      .lifecycle
      .validationPass,

  economicAttributionPipeline:
    sourceStatus
      .exactCredit
      .validationPass,

  recipientGeometryPipeline:
    sourceStatus
      .sharingGeometry
      .validationPass,

  integerAllocationPipeline:
    sourceStatus
      .integerAllocation
      .validationPass,

  facingPipeline:
    sourceStatus
      .facingAngles
      .validationPass,

  aimPipeline:
    sourceStatus
      .aimAngles
      .validationPass,

  creditedAssignment:
    evidenceFlags
      .creditedAssignmentStrong ===
    true,

  physicalTargetSeparate:
    evidenceFlags
      .physicalTargetNotExclusive ===
    true,

  integerPartition:
    evidenceFlags
      .observedIntegerPartitionStrong ===
    true,

  remainderPriority:
    evidenceFlags
      .creditedRemainderPriorityStrong ===
    true,

  worldYaw:
    evidenceFlags
      .worldYawConventionStrong ===
    true,

  aimOrientation:
    evidenceFlags
      .eyeAimOrientationStrong ===
    true
};


const semanticFoundationComplete =
  Object
    .values(
      semanticChecks
    )
    .every(
      Boolean
    );


const readyForCrossReplay =
  requiredSourcePass
  &&
  semanticFoundationComplete;


// ============================================================
// WHAT IS INTENTIONALLY NOT CLOSED
// ============================================================

const deferredToCrossReplay = [

  {
    id:
      'VACUUM_RADIUS_EXACT_CONSTANT',

    question:
      'Does the ~732-735 HU operational ground-soul vacuum envelope reproduce independently, and what is the true engine boundary?',

    priority:
      'SECONDARY',

    reason:
      'Operational opportunity labeling is already adequate in test.dem.'
  },

  {
    id:
      'RECIPIENT_SHARE_RADIUS_GENERALIZATION',

    question:
      'Does the ~2150 HU / 54.6 m death-time 3D recipient-set boundary reproduce across independent matches?',

    priority:
      'HIGH'
  },

  {
    id:
      'TARGET_SELECTION_ARBITRATION',

    question:
      'When multiple allies satisfy physical-vacuum proximity, what determines final m_hVacuumTarget?',

    priority:
      'MEDIUM'
  },

  {
    id:
      'TARGETLESS_TIMEOUT_SCALING',

    question:
      'Does the ~18 s -> +4 s/min -> ~40 s targetless lifecycle function reproduce across independent matches and game versions?',

    priority:
      'MEDIUM'
  },

  {
    id:
      'GROUND_SOUL_REWARD_SCALING',

    question:
      'Do match-time scaling, variant modifiers, comeback behavior, sharing schedule, and integer allocation reproduce independently?',

    priority:
      'HIGH'
  },

  {
    id:
      'TROOPER_VARIANT_ECONOMICS',

    question:
      'Do provisional Trooper variant multipliers and Super behavior reproduce across varied independent matches?',

    priority:
      'HIGH'
  },

  {
    id:
      'AIM_ORIENTATION_GENERALIZATION',

    question:
      'Does m_angEyeAngles preserve the same yaw/pitch and shot-direction relationship across players, heroes, matches, and versions?',

    priority:
      'HIGH'
  }
];


// ============================================================
// DO NOT REOPEN ON TEST.DEM
// ============================================================

const closedForSingleReplay = [

  'Exact 732 versus 735 HU ground-soul vacuum threshold tuning.',

  'Additional targetless-lifetime formula fitting.',

  'Additional AssignedGold reward residual fitting to eliminate remaining +/-1-3 soul errors.',

  'More m_angEyeAngles component-order discovery.',

  'More movement-only validation of yaw convention.',

  'Attempts to force m_hVacuumTarget to equal economic ownership.'
];


// ============================================================
// CROSS-REPLAY REPLICATION CONTRACT
//
// This is what the next stage should test.
//
// Important:
//
// We replicate RELATIONSHIPS and semantic contracts first,
// not exact test.dem counts.
// ============================================================

const replicationContract = [

  {
    order:
      1,

    id:
      'GROUND_SOUL_PRODUCTION_LAST_HIT_LINK',

    test:
      'Player-last-hit Trooper deaths should reproduce the near-deterministic AssignedGold production association.',

    compare:
      'association rate and controls'
  },

  {
    order:
      2,

    id:
      'GROUND_SOUL_LIFECYCLE',

    test:
      'Reconstruct AssignedGold lifecycle and verify targeted versus targetless classes remain coherent.',

    compare:
      'class distributions and transition timing'
  },

  {
    order:
      3,

    id:
      'VACUUM_PROXIMITY',

    test:
      'Test whether targeted episodes remain strongly associated with allied proximity to the physical soul.',

    compare:
      'threshold curves rather than one fixed hardcoded radius'
  },

  {
    order:
      4,

    id:
      'ECONOMIC_RECIPIENT_SET',

    test:
      'Verify credited last-hitter inclusion and distinguish economic recipients from physical vacuum target.',

    compare:
      'exact-tick currency attribution'
  },

  {
    order:
      5,

    id:
      'RECIPIENT_GEOMETRY',

    test:
      'Test whether death-time Trooper-centered 3D geometry continues to predict the recipient set.',

    compare:
      'MCC, sensitivity, specificity, exact-set accuracy, fitted threshold'
  },

  {
    order:
      6,

    id:
      'REWARD_ALLOCATION',

    test:
      'Verify sharing, reward scaling, integer partitions, and credited remainder priority.',

    compare:
      'exact allocation and residual distributions'
  },

  {
    order:
      7,

    id:
      'AIM_ORIENTATION',

    test:
      'Verify component-1 yaw, component-0 eye pitch, pitch sign, and eye-angle alignment to successful shot direction.',

    compare:
      'primary versus temporal-placebo angular error'
  }
];


// ============================================================
// CHECKPOINT STATUS
// ============================================================

let checkpointStatus;


if (
  !requiredSourcePass
) {

  checkpointStatus =
    'SOURCE_VALIDATION_FAILURE';

} else if (
  !semanticFoundationComplete
) {

  checkpointStatus =
    'FOUNDATIONAL_SEMANTICS_INCOMPLETE';

} else {

  checkpointStatus =
    'READY_FOR_COMPACT_CROSS_REPLAY_REPLICATION';
}


// ============================================================
// SUMMARY OBJECT
// ============================================================

const summary = {

  replay:
    replayName,

  version:
    'FOUNDATIONAL_DISCOVERY_CHECKPOINT_V01',

  canonical:
    false,

  checkpointStatus,

  readyForCrossReplay,


  authorityPolicy: {

    highestCurrentLevel:
      'VALIDATED_WITHIN_TEST_DEM',

    prohibitedPromotion:
      'Do not describe these single-replay relationships as canonical Deadlock mechanics until independent replay replication.',

    withdrawn: [

      'Script97 V01 semantic status',

      '45m as an exact or approximate validated ground-soul vacuum threshold',

      'm_hVacuumTarget as last-hit or sole economic-recipient authority'
    ]
  },


  sourceStatus,

  evidenceFlags,

  numericEvidence,

  semanticChecks,

  operationalClaims,

  deferredToCrossReplay,

  closedForSingleReplay,

  replicationContract,


  downstreamBehavioralStateContract: {

    resourceEvents: {

      production:
        'Distinguish Trooper death, player-last-hit credit, AssignedGold production, physical availability, vacuum targeting, economic recipient membership, payout, and targetless termination.',

      opportunity:
        'Physical floor-persistent AssignedGold can constitute a resource-access opportunity independently of who is economically assigned the reward.',

      physicalCollector:
        'm_hVacuumTarget is a physical-vacuum target candidate and must not be substituted for economic recipient identity.',

      economy:
        'Use validated AssignedGold recipient-set and allocation semantics when constructing resource-value consequences.'
    },


    orientation: {

      bodyYaw: {

        field:
          'CBodyComponent.m_angRotation',

        component:
          1,

        semantic:
          'BODY_FACING_YAW_PROXY'
      },

      aimPitch: {

        field:
          'm_angEyeAngles',

        component:
          0,

        cartesianSign:
          -1,

        semantic:
          'AIM_ORIENTATION_PITCH'
      },

      aimYaw: {

        field:
          'm_angEyeAngles',

        component:
          1,

        semantic:
          'AIM_ORIENTATION_YAW'
      },

      cameraPitch: {

        field:
          'm_angClientCamera',

        component:
          0,

        semantic:
          'THIRD_PERSON_CAMERA_PITCH'
      },

      cameraYaw: {

        field:
          'm_angClientCamera',

        component:
          1,

        semantic:
          'THIRD_PERSON_CAMERA_YAW'
      },

      worldYawConvention: {

        transform:
          'PLUS_YAW_0',

        yaw0:
          '+X',

        yaw90:
          '+Y',

        yaw180:
          '-X',

        yaw270:
          '-Y'
      }
    }
  },


  nextStage: {

    name:
      'COMPACT_CROSS_REPLAY_REPLICATION',

    goal:
      'Test whether the foundational semantic relationships reproduce across independent replays before promoting them beyond test.dem.',

    strategy:
      'Build one compact replication harness that reports the principal lifecycle, economic, geometry, reward, and orientation relationships for each replay rather than rerunning dozens of exploratory scripts manually.'
  }
};


// ============================================================
// MARKDOWN
// ============================================================

const markdown =
  buildMarkdown(
    summary
  );


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    outputJsonPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputJsonPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  outputMarkdownPath,
  markdown,
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
  'FOUNDATIONAL DISCOVERY CHECKPOINT V0.1'
);

console.log(
  '========================================================'
);


// ============================================================
// SOURCES
// ============================================================

console.log('');

console.log(
  'AUTHORITATIVE SOURCE STATUS'
);

console.log(
  '---------------------------'
);


for (
  const [
    key,
    row
  ]
  of Object.entries(
    sourceStatus
  )
) {

  console.log(

    `${key.padEnd(20)} ` +

    `${row.validationPass ? 'PASS' : 'FAIL'} ` +

    `${row.version ?? ''}`
  );
}


// ============================================================
// SEMANTIC CHECKS
// ============================================================

console.log('');

console.log(
  'FOUNDATIONAL SEMANTIC CHECKS'
);

console.log(
  '----------------------------'
);


for (
  const [
    key,
    value
  ]
  of Object.entries(
    semanticChecks
  )
) {

  console.log(

    `${value ? 'PASS' : 'FAIL'}  ` +

    key
  );
}


// ============================================================
// CURRENT OPERATIONAL SEMANTICS
// ============================================================

console.log('');

console.log(
  'OPERATIONAL SEMANTICS'
);

console.log(
  '---------------------'
);


for (
  const claim
  of operationalClaims
) {

  console.log('');

  console.log(
    `${claim.id}`
  );


  console.log(
    `  ${claim.state}`
  );


  console.log(
    `  ${claim.claim}`
  );


  if (
    claim.caution
  ) {

    console.log(
      `  CAUTION: ${claim.caution}`
    );
  }
}


// ============================================================
// REPLICATION CONTRACT
// ============================================================

console.log('');

console.log(
  'CROSS-REPLAY REPLICATION CONTRACT'
);

console.log(
  '---------------------------------'
);


for (
  const row
  of replicationContract
) {

  console.log(
    `${row.order}. ${row.id}`
  );
}


// ============================================================
// FINAL
// ============================================================

console.log('');

console.log(
  'CHECKPOINT'
);

console.log(
  '----------'
);


console.log(
  `All source pipelines pass:       ${requiredSourcePass}`
);


console.log(
  `Foundational semantics complete: ${semanticFoundationComplete}`
);


console.log(
  `Ready for cross-replay:          ${readyForCrossReplay}`
);


console.log(
  `Status: ${checkpointStatus}`
);


console.log('');

console.log(
  `JSON:\n${outputJsonPath}`
);


console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);


console.log('');


// ============================================================
// MARKDOWN BUILDER
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# DeadlockBehavior Foundational Discovery Checkpoint'
  );


  lines.push(
    ''
  );


  lines.push(
    `Replay: \`${summary.replay}\``
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.checkpointStatus}**`
  );


  lines.push(
    ''
  );


  lines.push(
    `Ready for cross-replay replication: **${summary.readyForCrossReplay}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Authority'
  );


  lines.push(
    ''
  );


  lines.push(
    'These mechanics are validated operationally within `test.dem`; they are not yet canonical Deadlock mechanics.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Source validation'
  );


  lines.push(
    ''
  );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      summary.sourceStatus
    )
  ) {

    lines.push(
      `- ${value.validationPass ? 'PASS' : 'FAIL'} — ${key}${value.version ? ` — ${value.version}` : ''}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Operational claims'
  );


  lines.push(
    ''
  );


  for (
    const claim
    of summary.operationalClaims
  ) {

    lines.push(
      `### ${claim.id}`
    );


    lines.push(
      ''
    );


    lines.push(
      `**${claim.state}**`
    );


    lines.push(
      ''
    );


    lines.push(
      claim.claim
    );


    if (
      claim.caution
    ) {

      lines.push(
        ''
      );


      lines.push(
        `Caution: ${claim.caution}`
      );
    }


    lines.push(
      ''
    );
  }


  lines.push(
    '## Intentionally deferred to cross-replay'
  );


  lines.push(
    ''
  );


  for (
    const item
    of summary.deferredToCrossReplay
  ) {

    lines.push(
      `- **${item.id}** — ${item.question}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Do not reopen on test.dem'
  );


  lines.push(
    ''
  );


  for (
    const item
    of summary.closedForSingleReplay
  ) {

    lines.push(
      `- ${item}`
    );
  }


  lines.push(
    ''
  );


  lines.push(
    '## Cross-replay replication order'
  );


  lines.push(
    ''
  );


  for (
    const item
    of summary.replicationContract
  ) {

    lines.push(
      `${item.order}. **${item.id}** — ${item.test}`
    );
  }


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}


// ============================================================
// DEEP SEARCH HELPERS
// ============================================================

function findBoolean(
  source,
  key
) {

  const value =
    deepFindValueByNormalizedKey(
      source,
      normalizeKey(
        key
      )
    );


  return typeof value ===
    'boolean'
    ? value
    : null;
}


function firstBoolean(
  values
) {

  for (
    const value
    of values
  ) {

    if (
      typeof value ===
      'boolean'
    ) {

      return value;
    }
  }


  return null;
}


function deepFindValueByNormalizedKey(
  source,
  wanted
) {

  if (
    !source
    ||
    typeof source !==
      'object'
  ) {

    return null;
  }


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      source
    )
  ) {

    if (
      normalizeKey(
        key
      ) ===
      wanted
    ) {

      return value;
    }
  }


  for (
    const value
    of Object.values(
      source
    )
  ) {

    if (
      value
      &&
      typeof value ===
        'object'
    ) {

      const found =
        deepFindValueByNormalizedKey(
          value,
          wanted
        );


      if (
        found !==
        null
        &&
        found !==
        undefined
      ) {

        return found;
      }
    }
  }


  return null;
}


function normalizeKey(
  value
) {

  return String(
    value
  )
    .replace(
      /[^a-z0-9]/gi,
      ''
    )
    .toLowerCase();
}


// ============================================================
// NESTED NUMBER
// ============================================================

function findNestedNumber(
  source,
  path
) {

  let current =
    source;


  for (
    const key
    of path
  ) {

    if (
      !current
      ||
      typeof current !==
        'object'
    ) {

      return null;
    }


    current =
      current[
        key
      ];
  }


  return Number.isFinite(
    Number(
      current
    )
  )
    ? Number(
        current
      )
    : null;
}


// ============================================================
// HEURISTIC NUMERIC SEARCH
//
// Convenience only.
//
// Finds numeric leaves whose path contains:
//
//   any target key
//
// and preferably:
//
//   all context strings.
//
// No checkpoint pass/fail decision relies on this helper.
// ============================================================

function findNumberNearKeys(
  source,
  targetKeys,
  contextKeys
) {

  const leaves =
    [];


  collectNumericLeaves(
    source,
    [],
    leaves
  );


  const normalizedTargets =
    targetKeys.map(
      normalizeKey
    );


  const normalizedContexts =
    contextKeys.map(
      normalizeKey
    );


  const scored =
    leaves
      .map(
        leaf => {

          const pathText =
            normalizeKey(
              leaf.path.join(
                '.'
              )
            );


          const targetMatch =
            normalizedTargets.some(
              key =>
                pathText.includes(
                  key
                )
            );


          const contextCount =
            normalizedContexts.filter(
              key =>
                pathText.includes(
                  key
                )
            ).length;


          return {

            ...leaf,

            targetMatch,

            contextCount
          };
        }
      )
      .filter(
        row =>
          row.targetMatch
      )
      .sort(
        (
          a,
          b
        ) =>
          b.contextCount -
            a.contextCount
        ||
          a.path.length -
            b.path.length
      );


  return scored[0]
    ?.value ??
  null;
}


function collectNumericLeaves(
  source,
  path,
  output
) {

  if (
    source ===
      null
    ||
    source ===
      undefined
  ) {

    return;
  }


  if (
    typeof source ===
      'number'
    &&
    Number.isFinite(
      source
    )
  ) {

    output.push({

      path,

      value:
        source
    });


    return;
  }


  if (
    typeof source !==
      'object'
  ) {

    return;
  }


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      source
    )
  ) {

    collectNumericLeaves(
      value,
      [
        ...path,
        key
      ],
      output
    );
  }
}