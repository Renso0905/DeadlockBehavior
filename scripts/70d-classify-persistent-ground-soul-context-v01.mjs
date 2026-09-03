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


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';

const WINDOWS_SECONDS = [
  0.125,
  0.250,
  0.500,
  1.000,
  2.000
];


// ============================================================
// PATHS
// ============================================================

const script70cSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_persistent_range_diagnostic_v01.json'
  );

const script70cCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_persistent_range_cases_v01.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_persistent_context_v01.json'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_persistent_context_cases_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    script70cSummaryPath,
    script70cCasesPath
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
// LOAD
// ============================================================

const script70cSummary =
  JSON.parse(
    readFileSync(
      script70cSummaryPath,
      'utf8'
    )
  );

if (
  script70cSummary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 70c did not PASS validation.'
  );
}

const documentedRangeHU =
  finite(
    script70cSummary
      ?.documentedMechanicTarget
      ?.rangeInternalUnits
  );

const documentedRangeMeters =
  finite(
    script70cSummary
      ?.documentedMechanicTarget
      ?.rangeMeters
  ) ??
  45;

if (
  documentedRangeHU ===
  null
) {
  throw new Error(
    'Could not recover documented 45m threshold.'
  );
}

const rawCases =
  await loadJsonl(
    script70cCasesPath
  );

const cases =
  rawCases.filter(
    row =>
      row?.valid ===
      true
  );

console.log('');
console.log(
  `Loaded valid Script 70c cases: ${cases.length}`
);

console.log(
  `Documented threshold: ${documentedRangeHU.toFixed(3)} HU (${documentedRangeMeters}m)`
);


// ============================================================
// CLASSIFY
// ============================================================

const classified =
  cases.map(
    classifyCase
  );


// ============================================================
// PARTITIONS
// ============================================================

const anyTeamOnly =
  classified.filter(
    row =>
      row.script70cCategory ===
      'ANY_TEAM_ONLY_AT_ACTIVATION'
  );

const persistent =
  classified.filter(
    row =>
      row.script70cCategory ===
      'STILL_PERSISTENT_AFTER_ASSIGNEDGOLD_ANCHOR_TEST'
  );

const opposingInside2s =
  classified.filter(
    row =>
      row
        ?.opposingResolutionThrough2s
        ?.resolved ===
      true
  );

const opposingInside2sPreActivation =
  opposingInside2s.filter(
    row =>
      row
        .opposingResolutionThrough2s
        .timingDirection ===
      'PRE_ACTIVATION'
  );

const opposingInside2sPostActivation =
  opposingInside2s.filter(
    row =>
      row
        .opposingResolutionThrough2s
        .timingDirection ===
      'POST_ACTIVATION'
  );

const opposingInside2sExact =
  opposingInside2s.filter(
    row =>
      row
        .opposingResolutionThrough2s
        .timingDirection ===
      'EXACT_ACTIVATION'
  );

const vacuumTargetKnownAtActivation =
  classified.filter(
    row =>
      row
        ?.vacuumTarget
        ?.observedAtActivation ===
      true
  );

const vacuumTargetInside45m =
  vacuumTargetKnownAtActivation.filter(
    row =>
      row
        ?.vacuumTarget
        ?.within45m3D ===
      true
  );

const anyOnlySameTrooperTeam =
  anyTeamOnly.filter(
    row =>
      row
        ?.nearestAnyAtActivation
        ?.teamRelationToTrooper ===
      'SAME_AS_TROOPER'
  );

const anyOnlyOpposingTrooperTeam =
  anyTeamOnly.filter(
    row =>
      row
        ?.nearestAnyAtActivation
        ?.teamRelationToTrooper ===
      'OPPOSING_TROOPER'
  );


// ============================================================
// PLAYER COUNTS
// ============================================================

const anyTeamOnlyPlayerCounts =
  countByObject(
    anyTeamOnly,
    row =>
      row
        ?.nearestAnyAtActivation
        ?.playerName ??
      'UNKNOWN'
  );

const vacuumTargetPlayerCounts =
  countByObject(
    vacuumTargetKnownAtActivation,
    row =>
      row
        ?.vacuumTarget
        ?.playerName ??
      'UNKNOWN'
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedInputCount =
  finite(
    script70cSummary
      ?.counts
      ?.persistentCasesInput
  );

const expectedPersistentCount =
  finite(
    script70cSummary
      ?.counts
      ?.stillPersistent
  );

const expectedAnyTeamCount =
  finite(
    script70cSummary
      ?.counts
      ?.anyTeamOnlyResolved
  );

const validationChecks = {
  script70cPassed:
    check(
      script70cSummary
        ?.validation
        ?.pass,
      true,
      script70cSummary
        ?.validation
        ?.pass ===
        true
    ),

  validCaseCountPreserved:
    check(
      classified.length,
      expectedInputCount,
      expectedInputCount ===
        null
        ? classified.length >
          0
        : classified.length ===
          expectedInputCount
    ),

  persistentCountPreserved:
    check(
      persistent.length,
      expectedPersistentCount,
      expectedPersistentCount ===
        null
        ? persistent.length >=
          0
        : persistent.length ===
          expectedPersistentCount
    ),

  anyTeamOnlyCountPreserved:
    check(
      anyTeamOnly.length,
      expectedAnyTeamCount,
      expectedAnyTeamCount ===
        null
        ? anyTeamOnly.length >=
          0
        : anyTeamOnly.length ===
          expectedAnyTeamCount
    ),

  expectedTestReplayInputCount:
    check(
      classified.length,
      replayName ===
        'test'
        ? 7
        : '>0',
      replayName ===
        'test'
        ? classified.length ===
          7
        : classified.length >
          0
    ),

  everyCaseHasExactActivationGeometry:
    check(
      classified.filter(
        row =>
          Number.isFinite(
            row
              ?.nearestOpposingAtActivation
              ?.distance3D
          )
      ).length,
      classified.length,
      classified.every(
        row =>
          Number.isFinite(
            row
              ?.nearestOpposingAtActivation
              ?.distance3D
          )
      )
    ),

  everyCaseHasTwoSecondGeometry:
    check(
      classified.filter(
        row =>
          Number.isFinite(
            row
              ?.twoSecondOpposing
              ?.distance3D
          )
      ).length,
      classified.length,
      classified.every(
        row =>
          Number.isFinite(
            row
              ?.twoSecondOpposing
              ?.distance3D
          )
      )
    ),

  partitionPreserved:
    check(
      anyTeamOnly.length +
        persistent.length,
      classified.length,
      anyTeamOnly.length +
        persistent.length ===
        classified.length
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
// SUMMARY
// ============================================================

const summary = {
  replay:
    replayName,

  version:
    'TROOPER_GROUND_SOUL_PERSISTENT_CONTEXT_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'PERSISTENT_RANGE_CONTEXT_CLASSIFIED'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',

  purpose: [
    'Inspect the seven Script 70c persistent-range cases without another replay rescan.',
    'Determine whether the +/-2 second opposing-player crossings occur before or after AssignedGold activation.',
    'Identify which team supplies the three any-team-only exact-range cases.',
    'Inspect the observed vacuum-target player at activation when available.',
    'Avoid treating post-spawn player movement as evidence for the eligibility condition.'
  ],

  documentedMechanicTarget: {
    rangeMeters:
      documentedRangeMeters,

    rangeInternalUnits:
      documentedRangeHU
  },

  counts: {
    cases:
      classified.length,

    script70cAnyTeamOnly:
      anyTeamOnly.length,

    script70cPersistent:
      persistent.length,

    anyTeamOnlySameTrooperTeam:
      anyOnlySameTrooperTeam.length,

    anyTeamOnlyOpposingTrooperTeam:
      anyOnlyOpposingTrooperTeam.length,

    opposingWithin45mThrough2s:
      opposingInside2s.length,

    opposingWithin45mThrough2sPreActivation:
      opposingInside2sPreActivation.length,

    opposingWithin45mThrough2sExactActivation:
      opposingInside2sExact.length,

    opposingWithin45mThrough2sPostActivation:
      opposingInside2sPostActivation.length,

    vacuumTargetKnownAtActivation:
      vacuumTargetKnownAtActivation.length,

    vacuumTargetInside45mAtActivation:
      vacuumTargetInside45m.length
  },

  anyTeamOnlyPlayerCounts,

  vacuumTargetPlayerCounts,

  interpretation: {
    twoSecondTiming:
      'A pre-activation crossing can plausibly indicate an earlier range-check time. A post-activation crossing cannot explain why the AssignedGold object already existed and should not be counted as eligibility evidence.',

    anyTeam:
      'The three any-team-only cases are selected outliers and are not independent evidence for an any-team mechanic, especially if they share the same nearby player or temporal cluster.',

    vacuumTarget:
      'The vacuum target is retained as observed targeting telemetry. It is not automatically treated as the eligibility-causing player.',

    next:
      'If the large persistent cases remain outside range before activation and their vacuum targets are also outside, the next investigation should focus on the 45m documentation/conversion and on whether a different engine-space metric or source entity determines eligibility.'
  },

  anyTeamOnlyCases:
    anyTeamOnly.map(
      compactCase
    ),

  persistentCases:
    persistent.map(
      compactCase
    ),

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

await writeJsonl(
  outputCasesPath,
  classified
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'PERSISTENT GROUND-SOUL CONTEXT V0.1'
);
console.log(
  '========================================================'
);
console.log('');

console.log(
  `Cases: ${classified.length}`
);
console.log(
  `Any-team-only: ${anyTeamOnly.length}`
);
console.log(
  `Still persistent: ${persistent.length}`
);

console.log('');
console.log(
  'ANY-TEAM-ONLY CASES'
);
console.log(
  '-------------------'
);

if (
  anyTeamOnly.length ===
  0
) {
  console.log(
    'None.'
  );
} else {
  for (
    const row
    of anyTeamOnly
  ) {
    console.log(
      `${String(row.deathIndex).padStart(4)}  ` +
      `${String(row.clock ?? '').padEnd(6)} ` +
      `${String(row.baseType ?? '').padEnd(7)} ` +
      `player=${String(row.nearestAnyAtActivation?.playerName ?? 'UNKNOWN')} ` +
      `team=${String(row.nearestAnyAtActivation?.team ?? 'n/a')} ` +
      `relation=${String(row.nearestAnyAtActivation?.teamRelationToTrooper ?? 'UNKNOWN')} ` +
      `dist=${formatNumber(row.nearestAnyAtActivation?.distance3D)}`
    );
  }
}

console.log('');
console.log(
  'ANY-TEAM-ONLY PLAYER COUNTS'
);
console.log(
  '---------------------------'
);

for (
  const [
    playerName,
    count
  ]
  of Object.entries(
    anyTeamOnlyPlayerCounts
  )
) {
  console.log(
    `${playerName.padEnd(28)} ${count}`
  );
}

console.log('');
console.log(
  'OPPOSING 2-SECOND CROSSINGS'
);
console.log(
  '---------------------------'
);

for (
  const row
  of classified
) {
  const resolution =
    row.opposingResolutionThrough2s;

  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `${resolution?.resolved ? 'RESOLVED' : 'NO'.padEnd(8)} ` +
    `window=${String(resolution?.label ?? 'NONE').padEnd(13)} ` +
    `dt=${formatSignedNumber(resolution?.activationTickDelta)}ticks ` +
    `direction=${String(resolution?.timingDirection ?? 'NONE').padEnd(16)} ` +
    `dist=${formatNumber(resolution?.distance3D)}`
  );
}

console.log('');
console.log(
  'VACUUM TARGET AT ACTIVATION'
);
console.log(
  '---------------------------'
);

for (
  const row
  of classified
) {
  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `target=${String(row.vacuumTarget?.playerName ?? 'NONE')} ` +
    `team=${String(row.vacuumTarget?.team ?? 'n/a')} ` +
    `relation=${String(row.vacuumTarget?.teamRelationToTrooper ?? 'UNKNOWN')} ` +
    `dist=${formatNumber(row.vacuumTarget?.distance3D)} ` +
    `inside45=${String(row.vacuumTarget?.within45m3D ?? false)}`
  );
}

console.log('');
console.log(
  'PERSISTENT CASES'
);
console.log(
  '----------------'
);

for (
  const row
  of persistent
) {
  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `${String(row.baseType ?? '').padEnd(7)} ` +
    `oppExact=${formatNumber(row.nearestOpposingAtActivation?.distance3D)} ` +
    `opp2s=${formatNumber(row.twoSecondOpposing?.distance3D)}`
  );
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
    `${row.pass ? 'PASS' : 'FAIL'}  ` +
    `${name.padEnd(42)} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');
console.log(
  `OVERALL PIPELINE: ${validationPass ? 'PASS' : 'FAIL'}`
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
// CASE CLASSIFIER
// ============================================================

function classifyCase(
  row
) {
  const deathIndex =
    finite(
      row
        ?.death
        ?.deathIndex
    );

  const trooperTeam =
    finite(
      row
        ?.death
        ?.team
    );

  const opposingTeam =
    oppositeTeam(
      trooperTeam
    );

  const exactOpposing =
    row
      ?.exactAssignedGoldActivationTick
      ?.opposingAlive
      ?.nearestToAssignedGold3D ??
    null;

  const exactAny =
    row
      ?.exactAssignedGoldActivationTick
      ?.anyAlive
      ?.nearestToAssignedGold3D ??
    null;

  const twoSecondOpposing =
    row
      ?.windowsAroundAssignedGoldActivation
      ?.['2']
      ?.opposingAlive
      ?.nearestToAssignedGold3D ??
    null;

  const opposingResolutionThrough2s =
    findFirstOpposingResolution(
      row
    );

  const nearestAnyAtActivation =
    exactAny
      ? {
        playerName:
          exactAny.playerName,

        team:
          finite(
            exactAny.team
          ),

        distance3D:
          finite(
            exactAny.distance3D
          ),

        teamRelationToTrooper:
          teamRelation(
            finite(
              exactAny.team
            ),
            trooperTeam,
            opposingTeam
          ),

        within45m3D:
          within45m(
            finite(
              exactAny.distance3D
            )
          )
      }
      : null;

  const nearestOpposingAtActivation =
    exactOpposing
      ? {
        playerName:
          exactOpposing.playerName,

        team:
          finite(
            exactOpposing.team
          ),

        distance3D:
          finite(
            exactOpposing.distance3D
          ),

        within45m3D:
          within45m(
            finite(
              exactOpposing.distance3D
            )
          )
      }
      : null;

  const vacuumSource =
    row
      ?.vacuumTargetAtActivation ??
    null;

  const vacuumTarget =
    vacuumSource
      ? {
        observedAtActivation:
          true,

        playerName:
          vacuumSource.playerName ??
          null,

        team:
          finite(
            vacuumSource.team
          ),

        distance3D:
          finite(
            vacuumSource.distanceToAssignedGold3D
          ),

        distanceXY:
          finite(
            vacuumSource.distanceToAssignedGoldXY
          ),

        teamRelationToTrooper:
          teamRelation(
            finite(
              vacuumSource.team
            ),
            trooperTeam,
            opposingTeam
          ),

        within45m3D:
          within45m(
            finite(
              vacuumSource.distanceToAssignedGold3D
            )
          ),

        within45mXY:
          within45m(
            finite(
              vacuumSource.distanceToAssignedGoldXY
            )
          )
      }
      : {
        observedAtActivation:
          false,

        playerName:
          row
            ?.assignedGold
            ?.vacuumTargetPlayer
            ?.playerName ??
          null,

        team:
          null,

        distance3D:
          null,

        distanceXY:
          null,

        teamRelationToTrooper:
          'UNKNOWN',

        within45m3D:
          false,

        within45mXY:
          false
      };

  return {
    schemaVersion:
      1,

    canonical:
      false,

    deathIndex,

    deathKey:
      row
        ?.death
        ?.deathKey ??
      null,

    clock:
      row
        ?.death
        ?.clock ??
      null,

    baseType:
      row
        ?.death
        ?.baseType ??
      null,

    trooperTeam,

    opposingTeam,

    assignedGoldTeam:
      finite(
        row
          ?.assignedGold
          ?.team
      ),

    assignedGoldTeamRelationToTrooper:
      teamRelation(
        finite(
          row
            ?.assignedGold
            ?.team
        ),
        trooperTeam,
        opposingTeam
      ),

    script70cCategory:
      row
        ?.resolution
        ?.primaryCategory ??
      null,

    nearestOpposingAtActivation,

    nearestAnyAtActivation,

    twoSecondOpposing:
      twoSecondOpposing
        ? {
          playerName:
            twoSecondOpposing.playerName,

          team:
            finite(
              twoSecondOpposing.team
            ),

          distance3D:
            finite(
              twoSecondOpposing.distance3D
            ),

          activationTickDelta:
            finite(
              twoSecondOpposing.activationTickDelta
            ),

          timingDirection:
            timingDirection(
              finite(
                twoSecondOpposing.activationTickDelta
              )
            )
        }
        : null,

    opposingResolutionThrough2s,

    vacuumTarget,

    assignedGold: {
      activationTick:
        finite(
          row
            ?.assignedGold
            ?.activationTick
        ),

      deathToActivationTickDelta:
        finite(
          row
            ?.assignedGold
            ?.deathToActivationTickDelta
        ),

      deathToActivationPositionDistance3D:
        finite(
          row
            ?.assignedGold
            ?.deathToActivationPositionDistance3D
        )
    }
  };
}


// ============================================================
// FIRST OPPOSING RANGE CROSSING
//
// IMPORTANT:
// This reports the nearest observed player WITHIN each symmetric
// window. It retains the sign of activationTickDelta so we can
// distinguish whether the qualifying observation happened
// before or after AssignedGold activation.
// ============================================================

function findFirstOpposingResolution(
  row
) {
  const exact =
    row
      ?.exactAssignedGoldActivationTick
      ?.opposingAlive
      ?.nearestToAssignedGold3D ??
    null;

  const exactDistance =
    finite(
      exact?.distance3D
    );

  if (
    within45m(
      exactDistance
    )
  ) {
    return {
      resolved:
        true,

      label:
        'EXACT',

      windowSeconds:
        0,

      playerName:
        exact.playerName ??
        null,

      team:
        finite(
          exact.team
        ),

      distance3D:
        exactDistance,

      activationTickDelta:
        0,

      timingDirection:
        'EXACT_ACTIVATION'
    };
  }

  for (
    const seconds
    of WINDOWS_SECONDS
  ) {
    const candidate =
      row
        ?.windowsAroundAssignedGoldActivation
        ?.[
          String(
            seconds
          )
        ]
        ?.opposingAlive
        ?.nearestToAssignedGold3D ??
      null;

    const distance =
      finite(
        candidate?.distance3D
      );

    if (
      !within45m(
        distance
      )
    ) {
      continue;
    }

    const delta =
      finite(
        candidate?.activationTickDelta
      );

    return {
      resolved:
        true,

      label:
        `WITHIN_${Math.round(seconds * 1000)}MS`,

      windowSeconds:
        seconds,

      playerName:
        candidate?.playerName ??
        null,

      team:
        finite(
          candidate?.team
        ),

      distance3D:
        distance,

      activationTickDelta:
        delta,

      timingDirection:
        timingDirection(
          delta
        )
    };
  }

  const twoSecond =
    row
      ?.windowsAroundAssignedGoldActivation
      ?.['2']
      ?.opposingAlive
      ?.nearestToAssignedGold3D ??
    null;

  return {
    resolved:
      false,

    label:
      null,

    windowSeconds:
      null,

    playerName:
      twoSecond?.playerName ??
      null,

    team:
      finite(
        twoSecond?.team
      ),

    distance3D:
      finite(
        twoSecond?.distance3D
      ),

    activationTickDelta:
      finite(
        twoSecond?.activationTickDelta
      ),

    timingDirection:
      timingDirection(
        finite(
          twoSecond?.activationTickDelta
        )
      )
  };
}


// ============================================================
// TEAM / TIME HELPERS
// ============================================================

function teamRelation(
  team,
  trooperTeam,
  opposingTeam
) {
  if (
    !Number.isFinite(
      team
    )
  ) {
    return 'UNKNOWN';
  }

  if (
    team ===
    trooperTeam
  ) {
    return 'SAME_AS_TROOPER';
  }

  if (
    team ===
    opposingTeam
  ) {
    return 'OPPOSING_TROOPER';
  }

  return 'OTHER_TEAM';
}


function timingDirection(
  tickDelta
) {
  if (
    !Number.isFinite(
      tickDelta
    )
  ) {
    return 'UNKNOWN';
  }

  if (
    tickDelta <
    0
  ) {
    return 'PRE_ACTIVATION';
  }

  if (
    tickDelta >
    0
  ) {
    return 'POST_ACTIVATION';
  }

  return 'EXACT_ACTIVATION';
}


function oppositeTeam(
  team
) {
  if (
    team ===
    2
  ) {
    return 3;
  }

  if (
    team ===
    3
  ) {
    return 2;
  }

  return null;
}


function within45m(
  value
) {
  return Number.isFinite(
    value
  )
  &&
  value <=
    documentedRangeHU;
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


async function writeJsonl(
  path,
  rows
) {
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
      accept,
      reject
    ) => {
      writer.on(
        'error',
        reject
      );

      writer.end(
        accept
      );
    }
  );
}


// ============================================================
// GENERIC
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


function countByObject(
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
      String(
        selector(
          row
        )
      );

    map.set(
      key,
      (
        map.get(
          key
        ) ??
        0
      ) +
      1
    );
  }

  return Object.fromEntries(
    [
      ...map.entries()
    ].sort(
      (
        a,
        b
      ) =>
        b[1] -
        a[1]
        ||
        a[0].localeCompare(
          b[0]
        )
    )
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


function compactCase(
  row
) {
  return {
    deathIndex:
      row.deathIndex,

    clock:
      row.clock,

    baseType:
      row.baseType,

    trooperTeam:
      row.trooperTeam,

    assignedGoldTeam:
      row.assignedGoldTeam,

    script70cCategory:
      row.script70cCategory,

    nearestOpposingAtActivation:
      row.nearestOpposingAtActivation,

    nearestAnyAtActivation:
      row.nearestAnyAtActivation,

    opposingResolutionThrough2s:
      row.opposingResolutionThrough2s,

    vacuumTarget:
      row.vacuumTarget
  };
}


function formatNumber(
  value
) {
  return Number.isFinite(
    value
  )
    ? Number(
      value.toFixed(
        3
      )
    ).toString()
    : 'n/a';
}


function formatSignedNumber(
  value
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 'n/a';
  }

  return value >
    0
    ? `+${value}`
    : String(
      value
    );
}