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


// ============================================================
// PATHS
// ============================================================

const deathStreamPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_v01.jsonl'
  );

const script73SummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_validation_v01.json'
  );

const script73GroupsPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_exact_lasthit_groups_v01.jsonl'
  );

const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_lasthit_player_link_validation_v01.json'
  );

const outputGroupsPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_lasthit_player_link_groups_v01.jsonl'
  );

const outputCasesPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_lasthit_player_link_cases_v01.jsonl'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    deathStreamPath,
    script73SummaryPath,
    script73GroupsPath
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
// LOAD SCRIPT 73
// ============================================================

const script73Summary =
  JSON.parse(
    readFileSync(
      script73SummaryPath,
      'utf8'
    )
  );

if (
  script73Summary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 73 exact last-hit validation did not PASS.'
  );
}

const groups =
  await loadJsonl(
    script73GroupsPath
  );

console.log('');

console.log(
  `Loaded Script 73 tick-team groups: ${groups.length}`
);


// ============================================================
// LOAD FULL SCRIPT 55 DEATH ROWS
// ============================================================

const deathRows =
  await loadJsonl(
    deathStreamPath
  );

const deathByIndex =
  new Map();

for (
  const row
  of deathRows
) {
  const deathIndex =
    finite(
      row?.deathIndex
    );

  if (
    deathIndex !==
    null
  ) {
    deathByIndex.set(
      deathIndex,
      row
    );
  }
}

console.log(
  `Loaded Script 55 death rows: ${deathRows.length}`
);


// ============================================================
// ENRICH GROUPS
// ============================================================

const enrichedGroups =
  groups.map(
    enrichGroup
  );


// ============================================================
// COUNT-EQUIVALENCE PARTITIONS
// ============================================================

const countEquivalentGroups =
  enrichedGroups.filter(
    row =>
      row.countAccounting.exactCounterUnits ===
      row.countAccounting.matchedDeaths
  );

const residualGroups =
  enrichedGroups.filter(
    row =>
      row.countAccounting.residualCounterMinusMatched !==
      0
  );

const counterExcessGroups =
  residualGroups.filter(
    row =>
      row.countAccounting.residualCounterMinusMatched >
      0
  );

const counterDeficitGroups =
  residualGroups.filter(
    row =>
      row.countAccounting.residualCounterMinusMatched <
      0
  );


// ============================================================
// PLAYER-LEVEL LINK COHORTS
// ============================================================

const isolatedMatchedGroups =
  enrichedGroups.filter(
    row =>
      row.deathCount ===
      1
      &&
      row.matchedCount ===
      1
  );

const isolatedMatchedWithSingleCounterPlayer =
  isolatedMatchedGroups.filter(
    row =>
      row.playerAccounting.counterPlayerCount ===
      1
      &&
      row.countAccounting.exactCounterUnits ===
      1
  );

const isolatedMatchedResolvedTarget =
  isolatedMatchedWithSingleCounterPlayer.filter(
    row =>
      row.playerAccounting.resolvedVacuumTargetCount ===
      1
  );

const isolatedMatchedPlayerAgree =
  isolatedMatchedResolvedTarget.filter(
    row =>
      row.playerAccounting.playerMultisetExactMatch
  );

const isolatedMatchedPlayerDisagree =
  isolatedMatchedResolvedTarget.filter(
    row =>
      !row.playerAccounting.playerMultisetExactMatch
  );


// ============================================================
// ALL FULLY RESOLVED COUNT-EQUIVALENT GROUPS
// ============================================================

const fullyResolvedComparableGroups =
  countEquivalentGroups.filter(
    row =>
      row.matchedCount >
      0
      &&
      row.playerAccounting.allMatchedTargetsResolved
      &&
      row.playerAccounting.allCounterPlayersResolved
  );

const fullyResolvedPlayerAgree =
  fullyResolvedComparableGroups.filter(
    row =>
      row.playerAccounting.playerMultisetExactMatch
  );

const fullyResolvedPlayerDisagree =
  fullyResolvedComparableGroups.filter(
    row =>
      !row.playerAccounting.playerMultisetExactMatch
  );


// ============================================================
// MATCHED >45M CASES
// ============================================================

const matchedOutsideCases =
  [];

for (
  const group
  of enrichedGroups
) {
  for (
    const death
    of group.deaths
  ) {
    if (
      death.rangeGroup !==
      'MATCHED_OUTSIDE_45M'
    ) {
      continue;
    }

    matchedOutsideCases.push({
      deathIndex:
        death.deathIndex,

      clock:
        death.clock,

      baseType:
        death.baseType,

      tick:
        group.tick,

      isolated:
        group.deathCount ===
        1,

      groupDeathCount:
        group.deathCount,

      groupMatchedCount:
        group.matchedCount,

      exactCounterUnits:
        group.countAccounting.exactCounterUnits,

      counterPlayerUnits:
        group.playerAccounting.counterUnitsByPlayer,

      vacuumTargetPlayer:
        death.vacuumTargetPlayer,

      resolvedVacuumTarget:
        Boolean(
          death.vacuumTargetPlayer
        ),

      playerMultisetExactMatch:
        group.playerAccounting.playerMultisetExactMatch
    });
  }
}


// ============================================================
// RESIDUAL CLASSIFICATION
// ============================================================

const residualReasonCounts =
  countByObject(
    residualGroups,
    row =>
      row.residualClassification
  );


// ============================================================
// VALIDATION
// ============================================================

const expectedGroups =
  finite(
    script73Summary
      ?.sourceCounts
      ?.tickTeamGroups
  );

const expectedDeathCount =
  finite(
    script73Summary
      ?.sourceCounts
      ?.deaths
  );

const expectedCountEquivalentGroups =
  finite(
    script73Summary
      ?.tickTeamAccounting
      ?.groupsWhereExactCounterUnitsEqualMatchedDeaths
  );

const expectedIsolatedMatched =
  finite(
    script73Summary
      ?.sourceCounts
      ?.isolatedMatched
  );

const joinedDeathCount =
  enrichedGroups.reduce(
    (
      total,
      row
    ) =>
      total +
      row.deathCount,
    0
  );

const validationChecks = {
  script73Passed:
    check(
      script73Summary
        ?.validation
        ?.pass,
      true,
      script73Summary
        ?.validation
        ?.pass ===
      true
    ),

  groupCountPreserved:
    check(
      enrichedGroups.length,
      expectedGroups,
      expectedGroups ===
        null
        ? enrichedGroups.length >
          0
        : enrichedGroups.length ===
          expectedGroups
    ),

  deathCountPreserved:
    check(
      joinedDeathCount,
      expectedDeathCount,
      expectedDeathCount ===
        null
        ? joinedDeathCount >
          0
        : joinedDeathCount ===
          expectedDeathCount
    ),

  allGroupDeathsJoinedToScript55:
    check(
      enrichedGroups.reduce(
        (
          total,
          row
        ) =>
          total +
          row.joinedFullDeathRows,
        0
      ),
      joinedDeathCount,
      enrichedGroups.every(
        row =>
          row.joinedFullDeathRows ===
          row.deathCount
      )
    ),

  countEquivalentGroupsAgreeWith73:
    check(
      countEquivalentGroups.length,
      expectedCountEquivalentGroups,
      expectedCountEquivalentGroups ===
        null
        ? countEquivalentGroups.length >
          0
        : countEquivalentGroups.length ===
          expectedCountEquivalentGroups
    ),

  isolatedMatchedCountAgreesWith73:
    check(
      isolatedMatchedGroups.length,
      expectedIsolatedMatched,
      expectedIsolatedMatched ===
        null
        ? isolatedMatchedGroups.length >
          0
        : isolatedMatchedGroups.length ===
          expectedIsolatedMatched
    ),

  matchedOutsideCount:
    check(
      matchedOutsideCases.length,
      replayName ===
        'test'
        ? 15
        : '>0',
      replayName ===
        'test'
        ? matchedOutsideCases.length ===
          15
        : matchedOutsideCases.length >
          0
    ),

  residualPartitionExhaustive:
    check(
      counterExcessGroups.length +
        counterDeficitGroups.length,
      residualGroups.length,
      counterExcessGroups.length +
        counterDeficitGroups.length ===
        residualGroups.length
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
    'TROOPER_GROUND_SOUL_LASTHIT_PLAYER_LINK_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'LASTHIT_ASSIGNEDGOLD_LINKAGE_REFINED'
      : 'DIAGNOSTIC_PIPELINE_FAILURE',

  purpose: [
    'Refine Script 73 by inspecting the 13 tick-team groups where exact opposing m_iLastHits counter units do not equal matched AssignedGold deaths.',
    'Test whether the player receiving the exact m_iLastHits increment matches Script 55 m_hVacuumTarget-derived player identity when that target is resolved.',
    'Separate count equivalence from player-recipient equivalence.',
    'Do not promote m_hVacuumTarget to validated acquisition or recipient identity unless the comparison supports it.'
  ],

  semanticLimits: {
    lastHitCounter:
      'm_iLastHits is observed controller bookkeeping and remains non-target-attributed telemetry.',

    vacuumTarget:
      'm_hVacuumTarget is an observed magnetic target from Script 55 and is not assumed to be the player that caused or economically received the ground soul.',

    causalDirection:
      'This script tests correspondence only. It does not establish whether last-hit bookkeeping causes AssignedGold, AssignedGold causes bookkeeping, or both are emitted by a common kill-credit event.'
  },

  sourceCounts: {
    groups:
      enrichedGroups.length,

    deaths:
      joinedDeathCount,

    countEquivalentGroups:
      countEquivalentGroups.length,

    residualGroups:
      residualGroups.length,

    counterExcessGroups:
      counterExcessGroups.length,

    counterDeficitGroups:
      counterDeficitGroups.length,

    isolatedMatchedGroups:
      isolatedMatchedGroups.length,

    isolatedMatchedSingleCounterPlayer:
      isolatedMatchedWithSingleCounterPlayer.length,

    isolatedMatchedResolvedVacuumTarget:
      isolatedMatchedResolvedTarget.length,

    matchedOutside45mCases:
      matchedOutsideCases.length
  },

  countAccounting: {
    exactCounterUnitsEqualMatchedDeaths: {
      groups:
        countEquivalentGroups.length,

      totalGroups:
        enrichedGroups.length,

      rate:
        rate(
          countEquivalentGroups.length,
          enrichedGroups.length
        )
    },

    residualGroups: {
      total:
        residualGroups.length,

      counterExcess:
        counterExcessGroups.length,

      counterDeficit:
        counterDeficitGroups.length,

      reasonCounts:
        residualReasonCounts,

      residualDistribution:
        summarizeNumbers(
          residualGroups.map(
            row =>
              row
                .countAccounting
                .residualCounterMinusMatched
          )
        )
    }
  },

  playerLinkage: {
    isolatedMatchedResolvedTarget: {
      total:
        isolatedMatchedResolvedTarget.length,

      exactPlayerAgreement:
        isolatedMatchedPlayerAgree.length,

      disagreement:
        isolatedMatchedPlayerDisagree.length,

      agreementRate:
        rate(
          isolatedMatchedPlayerAgree.length,
          isolatedMatchedResolvedTarget.length
        )
    },

    allFullyResolvedCountEquivalentGroups: {
      total:
        fullyResolvedComparableGroups.length,

      exactPlayerMultisetAgreement:
        fullyResolvedPlayerAgree.length,

      disagreement:
        fullyResolvedPlayerDisagree.length,

      agreementRate:
        rate(
          fullyResolvedPlayerAgree.length,
          fullyResolvedComparableGroups.length
        )
    },

    interpretation:
      'High agreement would support m_hVacuumTarget as a useful player-link field. Low agreement would show that the field is stale, downstream, or semantically different from last-hit player credit.'
  },

  matchedOutside45m: {
    cases:
      matchedOutsideCases,

    resolvedVacuumTargets:
      matchedOutsideCases.filter(
        row =>
          row.resolvedVacuumTarget
      ).length,

    playerAgreementCases:
      matchedOutsideCases.filter(
        row =>
          row.playerMultisetExactMatch ===
          true
      ).length
  },

  residualGroups:
    residualGroups.map(
      compactResidualGroup
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

    groups:
      outputGroupsPath,

    cases:
      outputCasesPath
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
  outputGroupsPath,
  enrichedGroups
);

await writeJsonl(
  outputCasesPath,
  [
    ...residualGroups.map(
      row => ({
        category:
          'COUNT_RESIDUAL_GROUP',

        ...compactResidualGroup(
          row
        )
      })
    ),

    ...isolatedMatchedPlayerDisagree.map(
      row => ({
        category:
          'ISOLATED_PLAYER_LINK_DISAGREEMENT',

        ...compactPlayerMismatch(
          row
        )
      })
    ),

    ...fullyResolvedPlayerDisagree
      .filter(
        row =>
          row.deathCount >
          1
      )
      .map(
        row => ({
          category:
            'MULTIDEATH_PLAYER_MULTISET_DISAGREEMENT',

          ...compactPlayerMismatch(
            row
          )
        })
      ),

    ...matchedOutsideCases.map(
      row => ({
        category:
          'MATCHED_OUTSIDE_45M_PLAYER_LINK',

        ...row
      })
    )
  ]
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'ASSIGNEDGOLD / LAST-HIT PLAYER LINK VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'COUNT EQUIVALENCE'
);

console.log(
  '-----------------'
);

console.log(
  `Exact counter units == matched deaths: ${countEquivalentGroups.length}/${enrichedGroups.length} = ${formatPercent(rate(countEquivalentGroups.length, enrichedGroups.length))}`
);

console.log(
  `Residual groups: ${residualGroups.length}`
);

console.log(
  `  Counter excess:  ${counterExcessGroups.length}`
);

console.log(
  `  Counter deficit: ${counterDeficitGroups.length}`
);

console.log('');

console.log(
  'ISOLATED MATCHED PLAYER LINK'
);

console.log(
  '----------------------------'
);

console.log(
  `Isolated matched groups:             ${isolatedMatchedGroups.length}`
);

console.log(
  `Single exact counter-player groups:  ${isolatedMatchedWithSingleCounterPlayer.length}`
);

console.log(
  `Resolved vacuum targets:             ${isolatedMatchedResolvedTarget.length}`
);

console.log(
  `Exact player agreement:              ${isolatedMatchedPlayerAgree.length}/${isolatedMatchedResolvedTarget.length} = ${formatPercent(rate(isolatedMatchedPlayerAgree.length, isolatedMatchedResolvedTarget.length))}`
);

console.log('');

console.log(
  'ALL FULLY RESOLVED COUNT-EQUIVALENT GROUPS'
);

console.log(
  '------------------------------------------'
);

console.log(
  `Comparable groups:       ${fullyResolvedComparableGroups.length}`
);

console.log(
  `Player multiset matches: ${fullyResolvedPlayerAgree.length}/${fullyResolvedComparableGroups.length} = ${formatPercent(rate(fullyResolvedPlayerAgree.length, fullyResolvedComparableGroups.length))}`
);

console.log('');

console.log(
  '13 COUNT-RESIDUAL GROUPS'
);

console.log(
  '------------------------'
);

for (
  const row
  of residualGroups
) {
  console.log(
    `tick=${String(row.tick).padStart(6)} ` +
    `team=${row.trooperTeam} ` +
    `deaths=${row.deathCount} ` +
    `matched=${row.matchedCount} ` +
    `units=${row.countAccounting.exactCounterUnits} ` +
    `residual=${formatSignedInteger(row.countAccounting.residualCounterMinusMatched)} ` +
    `class=${row.residualClassification}`
  );
}

console.log('');

console.log(
  '15 MATCHED >45M PLAYER LINKS'
);

console.log(
  '---------------------------'
);

for (
  const row
  of matchedOutsideCases
) {
  console.log(
    `${String(row.deathIndex).padStart(4)}  ` +
    `${String(row.clock ?? '').padEnd(6)} ` +
    `${String(row.baseType ?? '').padEnd(7)} ` +
    `counter=${formatPlayerUnits(row.counterPlayerUnits).padEnd(32)} ` +
    `vacuum=${String(row.vacuumTargetPlayer ?? 'NONE').padEnd(24)} ` +
    `agree=${String(row.playerMultisetExactMatch)}`
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
    `${name.padEnd(40)} ` +
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
  `Groups:\n${outputGroupsPath}`
);

console.log('');

console.log(
  `Cases:\n${outputCasesPath}`
);

console.log('');


// ============================================================
// ENRICH ONE SCRIPT 73 GROUP
// ============================================================

function enrichGroup(
  group
) {
  const fullDeaths =
    [];

  let joinedFullDeathRows =
    0;

  for (
    const compactDeath
    of group?.deaths ?? []
  ) {
    const deathIndex =
      finite(
        compactDeath?.deathIndex
      );

    const full =
      deathIndex ===
      null
        ? null
        : deathByIndex.get(
          deathIndex
        ) ??
          null;

    if (
      full
    ) {
      joinedFullDeathRows++;
    }

    fullDeaths.push(
      enrichDeath(
        compactDeath,
        full
      )
    );
  }

  const exactEvents =
    group
      ?.exact
      ?.events ??
    [];

  const exactCounterUnits =
    finite(
      group
        ?.exact
        ?.lastHitUnits
    ) ??
    exactEvents.reduce(
      (
        total,
        row
      ) =>
        total +
        (
          finite(
            row?.delta
          ) ??
          0
        ),
      0
    );

  const counterUnitsByPlayer =
    sumUnitsByPlayer(
      exactEvents,

      row =>
        row?.playerName,

      row =>
        finite(
          row?.delta
        ) ??
        0
    );

  const matchedDeaths =
    fullDeaths.filter(
      row =>
        row.groundSoulMatched
    );

  const targetUnitsByPlayer =
    sumUnitsByPlayer(
      matchedDeaths.filter(
        row =>
          row.vacuumTargetPlayer
      ),

      row =>
        row.vacuumTargetPlayer,

      () =>
        1
    );

  const resolvedVacuumTargetCount =
    matchedDeaths.filter(
      row =>
        Boolean(
          row.vacuumTargetPlayer
        )
    ).length;

  const counterPlayerCount =
    Object.keys(
      counterUnitsByPlayer
    ).length;

  const allMatchedTargetsResolved =
    matchedDeaths.length >
      0
    &&
    resolvedVacuumTargetCount ===
      matchedDeaths.length;

  const allCounterPlayersResolved =
    exactEvents.every(
      row =>
        Boolean(
          row?.playerName
        )
    );

  const playerMultisetExactMatch =
    allMatchedTargetsResolved
    &&
    allCounterPlayersResolved
    &&
    mapsEqual(
      counterUnitsByPlayer,
      targetUnitsByPlayer
    );

  const residual =
    exactCounterUnits -
    matchedDeaths.length;

  return {
    schemaVersion:
      1,

    canonical:
      false,

    tick:
      finite(
        group?.tick
      ),

    trooperTeam:
      finite(
        group?.trooperTeam
      ),

    opposingTeam:
      finite(
        group?.opposingTeam
      ),

    deathCount:
      fullDeaths.length,

    matchedCount:
      matchedDeaths.length,

    unmatchedCount:
      fullDeaths.length -
      matchedDeaths.length,

    joinedFullDeathRows,

    deaths:
      fullDeaths,

    exactCounterEvents:
      exactEvents,

    countAccounting: {
      exactCounterUnits,

      matchedDeaths:
        matchedDeaths.length,

      totalEconomicDeaths:
        fullDeaths.length,

      residualCounterMinusMatched:
        residual,

      countEquivalent:
        residual ===
        0
    },

    playerAccounting: {
      counterPlayerCount,

      counterUnitsByPlayer,

      resolvedVacuumTargetCount,

      targetUnitsByPlayer,

      allMatchedTargetsResolved,

      allCounterPlayersResolved,

      playerMultisetExactMatch
    },

    residualClassification:
      classifyResidual({
        residual,
        matchedDeaths,
        fullDeaths,
        exactEvents
      })
  };
}


// ============================================================
// DEATH ENRICHMENT
// ============================================================

function enrichDeath(
  compact,
  full
) {
  const groundSoulMatched =
    compact
      ?.groundSoulMatched ===
    true
    ||
    full
      ?.match
      ?.status ===
      'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
    ||
    Boolean(
      full?.groundSoul
    );

  return {
    deathIndex:
      finite(
        compact?.deathIndex
      ) ??
      finite(
        full?.deathIndex
      ),

    deathKey:
      compact?.deathKey ??
      full?.deathKey ??
      null,

    entityIndex:
      finite(
        compact?.entityIndex
      ) ??
      finite(
        full
          ?.trooper
          ?.entityIndex
      ),

    baseType:
      compact?.baseType ??
      full
        ?.trooper
        ?.baseType ??
      'UNKNOWN',

    variantLabel:
      compact?.variantLabel ??
      full
        ?.trooper
        ?.variantLabel ??
      'UNKNOWN',

    team:
      finite(
        compact?.team
      ) ??
      finite(
        full
          ?.trooper
          ?.team
      ),

    clock:
      compact?.clock ??
      full
        ?.timing
        ?.clock ??
      null,

    rangeGroup:
      compact?.rangeGroup ??
      null,

    groundSoulMatched,

    groundSoulEntityIndex:
      firstFinite([
        full
          ?.groundSoul
          ?.entityIndex,

        full
          ?.groundSoul
          ?.activationEntityIndex
      ]),

    vacuumTargetPlayer:
      extractVacuumTargetPlayer(
        full
      ),

    vacuumTargetHandle:
      finite(
        full
          ?.groundSoul
          ?.vacuumTargetHandle
      )
  };
}


function extractVacuumTargetPlayer(
  row
) {
  const target =
    row
      ?.groundSoul
      ?.vacuumTargetPlayer ??
    null;

  if (
    typeof target ===
    'string'
  ) {
    return target;
  }

  return target
    ?.playerName ??
    target
      ?.name ??
    null;
}


// ============================================================
// RESIDUAL CLASSIFICATION
// ============================================================

function classifyResidual({
  residual,
  matchedDeaths,
  fullDeaths,
  exactEvents
}) {
  if (
    residual ===
    0
  ) {
    return 'COUNT_EQUIVALENT';
  }

  if (
    residual >
    0
  ) {
    if (
      fullDeaths.length ===
      0
    ) {
      return 'COUNTER_EXCESS_NO_ECONOMIC_DEATH';
    }

    if (
      exactEvents.some(
        row =>
          (
            finite(
              row?.delta
            ) ??
            0
          ) >
          1
      )
    ) {
      return 'COUNTER_EXCESS_BATCHED_DELTA_CANDIDATE';
    }

    return 'COUNTER_EXCESS_OTHER_LASTHIT_SOURCE_CANDIDATE';
  }

  if (
    matchedDeaths.length >
    0
  ) {
    return 'COUNTER_DEFICIT_MATCHED_ASSIGNEDGOLD_WITHOUT_EQUAL_EXACT_COUNTER_UNITS';
  }

  return 'COUNTER_DEFICIT_OTHER';
}


// ============================================================
// COMPACT OUTPUT
// ============================================================

function compactResidualGroup(
  row
) {
  return {
    tick:
      row.tick,

    trooperTeam:
      row.trooperTeam,

    deathCount:
      row.deathCount,

    matchedCount:
      row.matchedCount,

    unmatchedCount:
      row.unmatchedCount,

    exactCounterUnits:
      row.countAccounting.exactCounterUnits,

    residualCounterMinusMatched:
      row
        .countAccounting
        .residualCounterMinusMatched,

    residualClassification:
      row.residualClassification,

    counterUnitsByPlayer:
      row
        .playerAccounting
        .counterUnitsByPlayer,

    targetUnitsByPlayer:
      row
        .playerAccounting
        .targetUnitsByPlayer,

    deaths:
      row.deaths.map(
        death => ({
          deathIndex:
            death.deathIndex,

          clock:
            death.clock,

          baseType:
            death.baseType,

          groundSoulMatched:
            death.groundSoulMatched,

          rangeGroup:
            death.rangeGroup,

          vacuumTargetPlayer:
            death.vacuumTargetPlayer
        })
      )
  };
}


function compactPlayerMismatch(
  row
) {
  return {
    tick:
      row.tick,

    trooperTeam:
      row.trooperTeam,

    deathCount:
      row.deathCount,

    matchedCount:
      row.matchedCount,

    exactCounterUnits:
      row.countAccounting.exactCounterUnits,

    counterUnitsByPlayer:
      row
        .playerAccounting
        .counterUnitsByPlayer,

    targetUnitsByPlayer:
      row
        .playerAccounting
        .targetUnitsByPlayer,

    deaths:
      row.deaths
  };
}


// ============================================================
// MAP HELPERS
// ============================================================

function sumUnitsByPlayer(
  rows,
  playerSelector,
  unitSelector
) {
  const result =
    {};

  for (
    const row
    of rows
  ) {
    const player =
      playerSelector(
        row
      );

    if (
      !player
    ) {
      continue;
    }

    const units =
      finite(
        unitSelector(
          row
        )
      ) ??
      0;

    result[player] =
      (
        result[player] ??
        0
      ) +
      units;
  }

  return sortObjectKeys(
    result
  );
}


function mapsEqual(
  a,
  b
) {
  const aKeys =
    Object.keys(
      a
    ).sort();

  const bKeys =
    Object.keys(
      b
    ).sort();

  if (
    aKeys.length !==
    bKeys.length
  ) {
    return false;
  }

  for (
    let i =
      0;
    i <
    aKeys.length;
    i++
  ) {
    if (
      aKeys[i] !==
      bKeys[i]
    ) {
      return false;
    }

    if (
      a[aKeys[i]] !==
      b[bKeys[i]]
    ) {
      return false;
    }
  }

  return true;
}


function sortObjectKeys(
  object
) {
  return Object.fromEntries(
    Object
      .entries(
        object
      )
      .sort(
        (
          a,
          b
        ) =>
          a[0].localeCompare(
            b[0]
          )
      )
  );
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


function summarizeNumbers(
  values
) {
  const clean =
    values
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

      median:
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

    median:
      quantile(
        clean,
        0.5
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      clean.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
      clean.length
  };
}


function quantile(
  values,
  q
) {
  if (
    values.length ===
    1
  ) {
    return values[0];
  }

  const position =
    (
      values.length -
      1
    ) *
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
    return values[
      lower
    ];
  }

  const weight =
    position -
    lower;

  return values[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    values[
      upper
    ] *
    weight;
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


function formatPercent(
  value
) {
  return Number.isFinite(
    value
  )
    ? `${(
      value *
      100
    ).toFixed(2)}%`
    : 'n/a';
}


function formatSignedInteger(
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


function formatPlayerUnits(
  object
) {
  const entries =
    Object.entries(
      object ??
      {}
    );

  if (
    entries.length ===
    0
  ) {
    return 'NONE';
  }

  return entries
    .map(
      ([
        player,
        units
      ]) =>
        `${player}:${units}`
    )
    .join(
      ','
    );
}