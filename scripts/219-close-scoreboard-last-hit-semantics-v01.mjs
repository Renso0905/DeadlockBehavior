import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  createInterface
} from 'node:readline';

import {
  dirname,
  resolve
} from 'node:path';

// ============================================================
// SCRIPT 219
// SCOREBOARD LAST-HIT SEMANTIC CLOSURE V0.1
//
// Research-only semantic closure.
//
// Narrow construct under test:
//   CCitadelPlayerController.m_iLastHits
//     = game-awarded per-player last-hit credit counter.
//
// Evidence layers:
// A) Script 215 counter integrity:
//    - sampled final = sampled positive = raw positive
//    - zero regressions
//    - zero outside-gameplay positive credits
//
// B) Independent replication Trooper-death positive control:
//    - economic Trooper death
//    - AssignedGold candidate present
//    - opposing-player exact-tick m_iLastHits evidence
//
// Negative/context controls:
//    - economic Trooper death without AssignedGold candidate
//    - non-economic Trooper death
//
// IMPORTANT:
// Passing this closure does NOT establish:
// - exact victim attribution for every counter increment
// - all last-hit eligibility rules
// - damage source / final blow mechanics
// - soul collection / economic recipient mechanics
//
// No contract or claim registry is modified by this script.
// ============================================================

const DEFAULT_REPLAYS = [
  'rep01',
  'rep02',
  'rep03',
  'rep04',
  'rep05'
];

const replayNames =
  process.argv.slice(2).filter(Boolean).length
    ? process.argv.slice(2).filter(Boolean)
    : DEFAULT_REPLAYS;

const COUNTER_INTEGRITY_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_last_hit_counter_reconciliation_batch_v01.json'
  );

const OUTPUT_PATH =
  resolve(
    'output',
    'cross_replay',
    'player_last_hit_semantic_closure_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('SCOREBOARD LAST-HIT SEMANTIC CLOSURE V0.1');
console.log('========================================================');
console.log(`Replication replays: ${replayNames.join(', ')}`);
console.log('');

const integrity =
  loadCounterIntegrity();

const replayResults =
  [];

for (const replayName of replayNames) {
  const path =
    resolve(
      'output',
      replayName,
      'replication_trooper_deaths_v01.jsonl'
    );

  if (!existsSync(path)) {
    replayResults.push({
      replayName,
      success:
        false,
      status:
        'REPLICATION_TROOPER_DEATHS_MISSING',
      path
    });

    console.log(
      `${replayName.padEnd(10)} replication_trooper_deaths_v01.jsonl missing`
    );

    continue;
  }

  try {
    const rows =
      await readJsonl(path);

    const result =
      analyzeReplay({
        replayName,
        rows
      });

    replayResults.push(
      result
    );

    console.log(
      `${replayName.padEnd(10)} ` +
      `positive=${String(result.positiveControl.total).padStart(4)} ` +
      `oppLH=${pct(result.positiveControl.exactOpposingRate).padStart(7)} ` +
      `unique=${pct(result.positiveControl.uniqueExactOpposingRate).padStart(7)} ` +
      `econNoAG=${pct(result.controls.economicNoAssignedGold.exactOpposingRate).padStart(7)} ` +
      `nonEcon=${pct(result.controls.nonEconomic.exactOpposingRate).padStart(7)}`
    );
  } catch (error) {
    replayResults.push({
      replayName,
      success:
        false,
      status:
        'ANALYSIS_EXCEPTION',
      error:
        error?.stack ??
        String(error)
    });

    console.log(
      `${replayName.padEnd(10)} ERROR`
    );

    console.error(error);
  }
}

const successful =
  replayResults.filter(
    row =>
      row.success
  );

const aggregate =
  aggregateResults(
    successful
  );

const thresholds = {
  allReplicationReplaysPresent:
    successful.length ===
    replayNames.length,

  counterIntegrityPass:
    Boolean(
      integrity.pass
    ),

  positiveControlAggregateAtLeast99Percent:
    (
      aggregate
        .positiveControl
        .exactOpposingRate
      ??
      0
    ) >=
      0.99,

  positiveControlEveryReplayAtLeast99Percent:
    successful.length >
      0
    &&
    successful.every(
      row =>
        (
          row
            .positiveControl
            .exactOpposingRate
          ??
          0
        ) >=
          0.99
    ),

  uniquePositiveControlAggregateAtLeast98Percent:
    (
      aggregate
        .positiveControl
        .uniqueExactOpposingRate
      ??
      0
    ) >=
      0.98,

  economicNoAssignedGoldControlBelow15Percent:
    (
      aggregate
        .controls
        .economicNoAssignedGold
        .exactOpposingRate
      ??
      1
    ) <
      0.15,

  nonEconomicControlBelow10Percent:
    (
      aggregate
        .controls
        .nonEconomic
        .exactOpposingRate
      ??
      1
    ) <
      0.10
};

const semanticClosurePass =
  Object.values(
    thresholds
  ).every(Boolean);

const output = {
  version:
    'PLAYER_LAST_HIT_SEMANTIC_CLOSURE_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  construct:
    'game-awarded per-player last-hit credit counter',

  field:
    'CCitadelPlayerController.m_iLastHits',

  requestedReplicationReplays:
    replayNames,

  successfulReplicationReplays:
    successful.length,

  evidenceLayers: {
    counterIntegrity:
      integrity,

    independentTrooperDeathReplication: {
      positiveControlDefinition:
        'Economic Trooper death with assignedGoldCandidateCount > 0.',

      outcomeDefinition:
        'At least one exact-tick opposing-player m_iLastHits signal in replication_trooper_deaths_v01.jsonl.',

      strictOutcomeDefinition:
        'uniqueExactOpposing is non-null: a unique exact-tick opposing-player last-hit signal.',

      contextControls: [
        'Economic Trooper death with assignedGoldCandidateCount = 0.',
        'Non-economic Trooper death.'
      ],

      aggregate,

      replays:
        replayResults
    }
  },

  thresholds,

  semanticClosurePass,

  recommendedValidationIfPromoted: {
    integrityValidation:
      semanticClosurePass
        ? 'pass'
        : 'pass',

    semanticValidation:
      semanticClosurePass
        ? 'pass'
        : 'provisional',

    replicationStatus:
      semanticClosurePass
        ? 'cross_replay_replicated'
        : 'multi_replay_supported'
  },

  authorityBoundary: {
    establishedIfPass:
      'm_iLastHits is a game-awarded per-player last-hit credit counter.',

    explicitlyNotEstablished: [
      'specific victim identity for every m_iLastHits increment',
      'all target classes eligible for last-hit credit',
      'all distance or economic eligibility rules',
      'direct damage ownership or final-blow mechanics',
      'Ground Soul collection',
      'economic recipient attribution',
      'deny semantics'
    ]
  },

  residualMechanismStatus: {
    fullyReverseEngineered:
      false,

    statement:
      'Semantic validation of the scoreboard carrier does not require complete reverse engineering of every last-hit eligibility mechanism. Scripts 213-218 retain the unresolved event-substrate work separately.'
  }
};

mkdirSync(
  dirname(
    OUTPUT_PATH
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(
    output,
    null,
    2
  ),
  'utf8'
);

console.log('');
console.log('========================================================');
console.log('CROSS-REPLAY SEMANTIC EVIDENCE');
console.log('========================================================');
console.log(
  `Counter integrity: ${integrity.pass ? 'PASS' : 'NOT ESTABLISHED'}`
);
console.log(
  `Positive control: ${aggregate.positiveControl.exactOpposing}/${aggregate.positiveControl.total} = ${pct(aggregate.positiveControl.exactOpposingRate)}`
);
console.log(
  `Unique opposing signal: ${aggregate.positiveControl.uniqueExactOpposing}/${aggregate.positiveControl.total} = ${pct(aggregate.positiveControl.uniqueExactOpposingRate)}`
);
console.log(
  `Economic / no AssignedGold control: ${aggregate.controls.economicNoAssignedGold.exactOpposing}/${aggregate.controls.economicNoAssignedGold.total} = ${pct(aggregate.controls.economicNoAssignedGold.exactOpposingRate)}`
);
console.log(
  `Non-economic control: ${aggregate.controls.nonEconomic.exactOpposing}/${aggregate.controls.nonEconomic.total} = ${pct(aggregate.controls.nonEconomic.exactOpposingRate)}`
);
console.log(
  `Positive vs econ/no-AG lift: ${formatNumber(aggregate.contrasts.positiveVsEconomicNoAssignedGoldRiskRatio)}x`
);
console.log(
  `Positive vs non-economic lift: ${formatNumber(aggregate.contrasts.positiveVsNonEconomicRiskRatio)}x`
);
console.log('');
console.log(
  `SEMANTIC CLOSURE: ${semanticClosurePass ? 'PASS' : 'DO NOT PROMOTE'}`
);
console.log('');
console.log(
  `Output: ${OUTPUT_PATH}`
);
console.log('');
console.log(
  'IMPORTANT: PASS establishes the narrow scoreboard-counter construct only; it does not establish universal victim attribution or last-hit eligibility mechanics.'
);
console.log('');

// ------------------------------------------------------------

function loadCounterIntegrity() {
  if (
    !existsSync(
      COUNTER_INTEGRITY_PATH
    )
  ) {
    return {
      available:
        false,
      pass:
        false,
      path:
        COUNTER_INTEGRITY_PATH,
      reason:
        'Script 215 batch output missing.'
    };
  }

  let source;

  try {
    source =
      JSON.parse(
        readFileSync(
          COUNTER_INTEGRITY_PATH,
          'utf8'
        )
      );
  } catch (error) {
    return {
      available:
        false,
      pass:
        false,
      path:
        COUNTER_INTEGRITY_PATH,
      reason:
        error?.message ??
        String(error)
    };
  }

  const counts =
    source?.aggregate?.counts
    ??
    {};

  const final =
    finite(
      counts.sampledFinalLastHits
    );

  const sampledPositive =
    finite(
      counts.sampledPositiveCredits
    );

  const rawPositive =
    finite(
      counts.rawPositiveCreditsAll
    );

  const gameplayPositive =
    finite(
      counts.rawPositiveCreditsGameplay
    );

  const sampledNegative =
    finite(
      counts.sampledNegativeMagnitude
    );

  const rawNegative =
    finite(
      counts.rawNegativeMagnitudeAll
    );

  const gameplayNegative =
    finite(
      counts.rawNegativeMagnitudeGameplay
    );

  const outsideGameplay =
    finite(
      counts.rawPositiveCreditsOutsideGameplay
    );

  const successCount =
    finite(
      source.successCount
    );

  const replayCount =
    finite(
      source.replayCount
    );

  const pass =
    Number.isFinite(final)
    &&
    final >
      0
    &&
    final ===
      sampledPositive
    &&
    final ===
      rawPositive
    &&
    final ===
      gameplayPositive
    &&
    sampledNegative ===
      0
    &&
    rawNegative ===
      0
    &&
    gameplayNegative ===
      0
    &&
    outsideGameplay ===
      0
    &&
    successCount ===
      replayCount;

  return {
    available:
      true,

    pass,

    path:
      COUNTER_INTEGRITY_PATH,

    replayCount,

    successCount,

    sampledFinalLastHits:
      final,

    sampledPositiveCredits:
      sampledPositive,

    rawPositiveCreditsAll:
      rawPositive,

    rawPositiveCreditsGameplay:
      gameplayPositive,

    sampledNegativeMagnitude:
      sampledNegative,

    rawNegativeMagnitudeAll:
      rawNegative,

    rawNegativeMagnitudeGameplay:
      gameplayNegative,

    rawPositiveCreditsOutsideGameplay:
      outsideGameplay
  };
}

async function readJsonl(
  path
) {
  const rows =
    [];

  const rl =
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
    of rl
  ) {
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(
        JSON.parse(
          line
        )
      );
    } catch {
      // Ignore malformed line.
    }
  }

  return rows;
}

function analyzeReplay({
  replayName,
  rows
}) {
  const economic =
    rows.filter(
      row =>
        row.economicBaseType ===
          true
    );

  const positive =
    economic.filter(
      row =>
        (
          finite(
            row.assignedGoldCandidateCount
          )
          ??
          0
        ) >
          0
    );

  const economicNoAssigned =
    economic.filter(
      row =>
        (
          finite(
            row.assignedGoldCandidateCount
          )
          ??
          0
        ) ===
          0
    );

  const nonEconomic =
    rows.filter(
      row =>
        row.economicBaseType !==
          true
    );

  return {
    replayName,

    success:
      true,

    totalTrooperDeaths:
      rows.length,

    economicTrooperDeaths:
      economic.length,

    positiveControl:
      summarizeGroup(
        positive
      ),

    controls: {
      economicNoAssignedGold:
        summarizeGroup(
          economicNoAssigned
        ),

      nonEconomic:
        summarizeGroup(
          nonEconomic
        )
    },

    positiveControlMismatchExamples:
      positive
        .filter(
          row =>
            !hasExactOpposing(
              row
            )
        )
        .slice(
          0,
          20
        )
        .map(
          compactDeathRow
        )
  };
}

function summarizeGroup(
  rows
) {
  const anyExact =
    rows.filter(
      row =>
        Array.isArray(
          row
            ?.lastHitEvidence
            ?.exactTick
        )
        &&
        row
          .lastHitEvidence
          .exactTick
          .length >
          0
    ).length;

  const exactOpposing =
    rows.filter(
      hasExactOpposing
    ).length;

  const uniqueExactOpposing =
    rows.filter(
      row =>
        row
          ?.lastHitEvidence
          ?.uniqueExactOpposing !==
          null
        &&
        row
          ?.lastHitEvidence
          ?.uniqueExactOpposing !==
          undefined
    ).length;

  return {
    total:
      rows.length,

    anyExact,

    anyExactRate:
      safeDiv(
        anyExact,
        rows.length
      ),

    exactOpposing,

    exactOpposingRate:
      safeDiv(
        exactOpposing,
        rows.length
      ),

    uniqueExactOpposing,

    uniqueExactOpposingRate:
      safeDiv(
        uniqueExactOpposing,
        rows.length
      )
  };
}

function hasExactOpposing(
  row
) {
  return (
    Array.isArray(
      row
        ?.lastHitEvidence
        ?.exactOpposing
    )
    &&
    row
      .lastHitEvidence
      .exactOpposing
      .length >
      0
  );
}

function compactDeathRow(
  row
) {
  return {
    entityIndex:
      row.entityIndex,

    tick:
      row.tick,

    clock:
      row.clock,

    team:
      row.team,

    lane:
      row.lane,

    subclassId:
      row.subclassId,

    baseType:
      row.baseType,

    assignedGoldCandidateCount:
      row.assignedGoldCandidateCount,

    lastHitEvidence:
      row.lastHitEvidence
  };
}

function aggregateResults(
  rows
) {
  const positiveControl =
    aggregateGroup(
      rows.map(
        row =>
          row.positiveControl
      )
    );

  const economicNoAssignedGold =
    aggregateGroup(
      rows.map(
        row =>
          row
            .controls
            .economicNoAssignedGold
      )
    );

  const nonEconomic =
    aggregateGroup(
      rows.map(
        row =>
          row
            .controls
            .nonEconomic
      )
    );

  return {
    positiveControl,

    controls: {
      economicNoAssignedGold,
      nonEconomic
    },

    contrasts: {
      positiveVsEconomicNoAssignedGoldRateDifference:
        difference(
          positiveControl
            .exactOpposingRate,
          economicNoAssignedGold
            .exactOpposingRate
        ),

      positiveVsEconomicNoAssignedGoldRiskRatio:
        ratio(
          positiveControl
            .exactOpposingRate,
          economicNoAssignedGold
            .exactOpposingRate
        ),

      positiveVsNonEconomicRateDifference:
        difference(
          positiveControl
            .exactOpposingRate,
          nonEconomic
            .exactOpposingRate
        ),

      positiveVsNonEconomicRiskRatio:
        ratio(
          positiveControl
            .exactOpposingRate,
          nonEconomic
            .exactOpposingRate
        )
    }
  };
}

function aggregateGroup(
  groups
) {
  const total =
    groups.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.total
          ??
          0
        ),
      0
    );

  const anyExact =
    groups.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.anyExact
          ??
          0
        ),
      0
    );

  const exactOpposing =
    groups.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.exactOpposing
          ??
          0
        ),
      0
    );

  const uniqueExactOpposing =
    groups.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.uniqueExactOpposing
          ??
          0
        ),
      0
    );

  return {
    total,

    anyExact,

    anyExactRate:
      safeDiv(
        anyExact,
        total
      ),

    exactOpposing,

    exactOpposingRate:
      safeDiv(
        exactOpposing,
        total
      ),

    uniqueExactOpposing,

    uniqueExactOpposingRate:
      safeDiv(
        uniqueExactOpposing,
        total
      )
  };
}

function difference(
  a,
  b
) {
  return (
    Number.isFinite(a)
    &&
    Number.isFinite(b)
  )
    ? a - b
    : null;
}

function ratio(
  a,
  b
) {
  return (
    Number.isFinite(a)
    &&
    Number.isFinite(b)
    &&
    b !== 0
  )
    ? a / b
    : null;
}

function safeDiv(
  a,
  b
) {
  return (
    Number.isFinite(a)
    &&
    Number.isFinite(b)
    &&
    b !== 0
  )
    ? a / b
    : null;
}

function finite(
  value
) {
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

function pct(
  value
) {
  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(2)}%`
    : '—';
}

function formatNumber(
  value
) {
  return Number.isFinite(
    value
  )
    ? value.toFixed(2)
    : '—';
}
