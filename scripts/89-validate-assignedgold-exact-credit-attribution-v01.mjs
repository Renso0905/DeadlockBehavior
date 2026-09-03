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


const TICK_RATE =
  64;


// ============================================================
// PATHS
// ============================================================

const script88SummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_economic_recipient_discovery_v01.json'
  );


const script88CasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_economic_recipient_cases_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_credit_attribution_validation_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_exact_credit_attribution_cases_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    script88SummaryPath,
    script88CasesPath
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
// LOAD SCRIPT 88
// ============================================================

const script88 =
  JSON.parse(
    readFileSync(
      script88SummaryPath,
      'utf8'
    )
  );


if (
  script88
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 88 did not PASS.'
  );
}


console.log('');

console.log(
  'Loading Script 88 economic-recipient cases...'
);


const allCases =
  await loadJsonl(
    script88CasesPath
  );


console.log(
  `Script 88 cases: ${allCases.length}`
);


// ============================================================
// DISCOVER SELECTED FIELD / WINDOW
// ============================================================

const selectedCandidate =
  script88
    ?.bestOverall
    ?.discovery
    ?.candidate ??
  null;


const selectedWindow =
  script88
    ?.bestOverall
    ?.discovery
    ?.window ??
  null;


if (
  !selectedCandidate
  ||
  !selectedWindow
) {

  throw new Error(
    'Script 88 best candidate/window unavailable.'
  );
}


console.log(
  `Selected field: ${selectedCandidate.id}`
);


console.log(
  `Selected window: ${selectedWindow.id}`
);


// ============================================================
// COHORTS
// ============================================================

const stableIsolated =
  allCases.filter(
    row =>
      row.lifecycleClass ===
        'TARGETED_STABLE_FLOOR'
      &&
      row.isolated16 ===
        true
      &&
      row.targetAssigned ===
        true
      &&
      row.measurement
      &&
      Number.isFinite(
        finite(
          row.measurement.anchorTick
        )
      )
  );


const stableMismatch =
  stableIsolated.filter(
    row =>
      row.targetDiffersFromCredited ===
      true
  );


const targetlessControls =
  allCases.filter(
    row =>
      row.lifecycleClass ===
        'TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE'
      &&
      row.isolated16 ===
        true
      &&
      row.measurement
      &&
      Number.isFinite(
        finite(
          row.measurement.anchorTick
        )
      )
  );


const allTargeted =
  allCases.filter(
    row =>
      row.targetAssigned ===
        true
      &&
      row.measurement
      &&
      Number.isFinite(
        finite(
          row.measurement.anchorTick
        )
      )
  );


console.log('');

console.log(
  `Stable isolated targeted: ${stableIsolated.length}`
);


console.log(
  `Stable target != credited: ${stableMismatch.length}`
);


console.log(
  `Isolated targetless controls: ${targetlessControls.length}`
);


// ============================================================
// OBSERVED TICK OFFSETS
// ============================================================

const observedOffsets =
  new Set();


for (
  const row
  of allCases
) {

  for (
    const event
    of row
      ?.measurement
      ?.deltaEvents ??
    []
  ) {

    const offset =
      finite(
        event.tickOffset
      );


    if (
      offset !==
      null
    ) {

      observedOffsets.add(
        offset
      );
    }
  }
}


observedOffsets.add(
  0
);


const offsets =
  [
    ...observedOffsets
  ]
  .sort(
    (
      a,
      b
    ) =>
      a -
      b
  );


console.log(
  `Observed offsets: ${offsets.join(', ')}`
);


// ============================================================
// EXACT-OFFSET SEARCH
// ============================================================

const offsetResults =
  [];


for (
  const offset
  of offsets
) {

  const stable =
    evaluateExactOffset(
      stableIsolated,
      offset
    );


  const mismatch =
    evaluateExactOffset(
      stableMismatch,
      offset
    );


  const controls =
    evaluateExactOffset(
      targetlessControls,
      offset
    );


  const creditedScore =
    (
      stable.creditedPositiveRate ??
      0
    )
    -
    (
      stable.opponentPositiveRate ??
      0
    )
    -
    (
      controls.sameTeamPositiveRate ??
      0
    );


  const targetScore =
    (
      stable.targetPositiveRate ??
      0
    )
    -
    (
      stable.opponentPositiveRate ??
      0
    )
    -
    (
      controls.sameTeamPositiveRate ??
      0
    );


  offsetResults.push({

    offset,

    seconds:
      offset /
      TICK_RATE,

    creditedScore,

    targetScore,

    stable,

    mismatch,

    controls
  });
}


// ============================================================
// BEST EXACT OFFSETS
// ============================================================

const bestCreditedOffset =
  offsetResults
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.creditedScore -
          a.creditedScore
        ||
        (
          b
            .stable
            .creditedPositiveRate ??
          0
        )
        -
        (
          a
            .stable
            .creditedPositiveRate ??
          0
        )
        ||
        Math.abs(
          a.offset
        )
        -
        Math.abs(
          b.offset
        )
    )[0]
  ??
  null;


const bestTargetOffset =
  offsetResults
    .slice()
    .sort(
      (
        a,
        b
      ) =>
        b.targetScore -
          a.targetScore
        ||
        (
          b
            .stable
            .targetPositiveRate ??
          0
        )
        -
        (
          a
            .stable
            .targetPositiveRate ??
          0
        )
        ||
        Math.abs(
          a.offset
        )
        -
        Math.abs(
          b.offset
        )
    )[0]
  ??
  null;


const zeroOffset =
  offsetResults.find(
    row =>
      row.offset ===
      0
  )
  ??
  null;


// ============================================================
// SELECT PRIMARY ATTRIBUTION OFFSET
//
// Prefer exact active=false tick if it is essentially as strong
// as the mathematically best offset.
//
// This prevents tiny incidental offset differences from replacing
// the semantically obvious transition tick.
// ============================================================

let primaryOffsetResult =
  bestCreditedOffset;


if (
  zeroOffset
  &&
  bestCreditedOffset
  &&
  zeroOffset.creditedScore >=
    bestCreditedOffset.creditedScore -
    0.02
) {

  primaryOffsetResult =
    zeroOffset;
}


const primaryOffset =
  primaryOffsetResult
    ?.offset ??
  0;


// ============================================================
// PRIMARY EXACT-TICK CASES
// ============================================================

const primaryStableRows =
  stableIsolated.map(
    row =>
      buildExactCase(
        row,
        primaryOffset
      )
  );


const primaryMismatchRows =
  primaryStableRows.filter(
    row =>
      row.targetDiffersFromCredited ===
      true
  );


const primaryControlRows =
  targetlessControls.map(
    row =>
      buildExactCase(
        row,
        primaryOffset
      )
  );


// ============================================================
// EXACT CREDIT RELATIONS
// ============================================================

const stableRelations =
  summarizeCreditRelations(
    primaryStableRows
  );


const mismatchRelations =
  summarizeCreditRelations(
    primaryMismatchRows
  );


const controlRelations =
  summarizeCreditRelations(
    primaryControlRows
  );


// ============================================================
// AMOUNT ANALYSIS
// ============================================================

const amountAnalysis =
  analyzeAmounts(
    primaryStableRows,
    primaryMismatchRows
  );


// ============================================================
// LIFECYCLE GENERALIZATION
//
// Immediate and early cases are secondary only because they may
// overlap the originating Trooper death / other economy.
//
// Stable floor remains the semantic discovery cohort.
// ============================================================

const lifecycleGeneralization =
  {};


for (
  const lifecycleClass
  of [
    'TARGETED_IMMEDIATE',
    'TARGETED_EARLY_FLOOR',
    'TARGETED_STABLE_FLOOR'
  ]
) {

  const cohort =
    allTargeted.filter(
      row =>
        row.lifecycleClass ===
        lifecycleClass
    );


  lifecycleGeneralization[
    lifecycleClass
  ] =
    evaluateExactOffset(
      cohort,
      primaryOffset
    );
}


// ============================================================
// INTERPRETIVE FLAGS
// ============================================================

const stableCreditedRate =
  stableRelations
    .creditedPositiveRate ??
  0;


const mismatchCreditedRate =
  mismatchRelations
    .creditedPositiveRate ??
  0;


const mismatchTargetRate =
  mismatchRelations
    .targetPositiveRate ??
  0;


const opponentRate =
  stableRelations
    .opponentPositiveRate ??
  0;


const timeoutTeamRate =
  controlRelations
    .sameTeamPositiveRate ??
  0;


const creditedAssignmentStrong =
  stableCreditedRate >=
    0.95
  &&
  mismatchCreditedRate >=
    0.95
  &&
  opponentRate <=
    0.10
  &&
  timeoutTeamRate <=
    0.10;


const physicalTargetNotExclusive =
  mismatchRelations.count >
    0
  &&
  (
    mismatchRelations.creditedOnly >
    0
    ||
    mismatchRelations.both >
    0
  );


const sharedCreditCandidate =
  stableRelations
    .multipleSameTeamPositiveRate >=
    0.20
  &&
  opponentRate <=
    0.10;


const targetlessNoPayoutSupported =
  timeoutTeamRate <=
  0.10;


// ============================================================
// OUTPUT CASES
// ============================================================

const outputCases =
  allCases.map(
    row => {

      const exact =
        buildExactCase(
          row,
          primaryOffset
        );


      return {

        schemaVersion:
          1,

        canonical:
          false,

        deathIndex:
          row.deathIndex,

        clock:
          row.clock,

        lifecycleClass:
          row.lifecycleClass,

        isolated16:
          row.isolated16,

        creditedPlayerName:
          row.creditedPlayerName,

        creditedTeam:
          row.creditedTeam,

        targetAssigned:
          row.targetAssigned,

        targetPlayerName:
          row.targetPlayerName,

        targetPlayerTeam:
          row.targetPlayerTeam,

        targetDiffersFromCredited:
          row.targetDiffersFromCredited,

        activeFalseTick:
          row.activeFalseTick,

        selectedField:
          selectedCandidate,

        selectedWindow:
          selectedWindow,

        exactOffsetTicks:
          primaryOffset,

        exactOffsetSeconds:
          primaryOffset /
          TICK_RATE,

        exactCredit:
          exact
      };
    }
  );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
  {

    script88Passed:
      check(
        script88
          ?.validation
          ?.pass,
        true,
        script88
          ?.validation
          ?.pass ===
        true
      ),


    sourceCaseCount:
      check(
        allCases.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? allCases.length ===
            991
          : allCases.length >
            0
      ),


    stableIsolatedCount:
      check(
        stableIsolated.length,
        replayName ===
          'test'
          ? 96
          : '>0',
        replayName ===
          'test'
          ? stableIsolated.length ===
            96
          : stableIsolated.length >
            0
      ),


    stableMismatchPresent:
      check(
        stableMismatch.length,
        '>0',
        stableMismatch.length >
        0
      ),


    targetlessControlsPresent:
      check(
        targetlessControls.length,
        '>0',
        targetlessControls.length >
        0
      ),


    selectedCandidatePresent:
      check(
        Boolean(
          selectedCandidate
        ),
        true,
        Boolean(
          selectedCandidate
        )
      ),


    selectedWindowPresent:
      check(
        Boolean(
          selectedWindow
        ),
        true,
        Boolean(
          selectedWindow
        )
      ),


    exactOffsetResultsPresent:
      check(
        offsetResults.length,
        '>0',
        offsetResults.length >
        0
      ),


    primaryOffsetResolved:
      check(
        Number.isFinite(
          primaryOffset
        ),
        true,
        Number.isFinite(
          primaryOffset
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
// SUMMARY
// ============================================================

const summary =
  {

    replay:
      replayName,

    version:
      'ASSIGNED_GOLD_EXACT_CREDIT_ATTRIBUTION_VALIDATION_V01',

    canonical:
      false,


    status:
      validationPass
        ? creditedAssignmentStrong
          ? 'CREDITED_PLAYER_EXACT_ECONOMIC_SIGNAL_STRONGLY_SUPPORTED'
          : 'EXACT_CREDIT_ATTRIBUTION_DIAGNOSTIC_COMPLETE'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Reduce Script 88 broad-window economic correlations to exact tick offsets.',

        'Determine whether the credited last-hitter or m_hVacuumTarget has the stronger time-locked economy signal.',

        'Use target != credited stable-floor cases to separate economic ownership from physical vacuum targeting.',

        'Use targetless timeout active=false cases as negative controls.',

        'Measure whether multiple allied players receive the same exact-tick economy event.',

        'Prepare exact ground-soul reward-value and sharing-rule analysis.'
      ],


    semanticLimits:
      {

        exactTick:
          'An exact-tick positive currency delta is substantially stronger attribution evidence than a broad temporal window, but remains replay telemetry rather than engine-source proof.',

        creditedPlayer:
          'A consistent credited-player delta establishes economic association with the credited last-hitter. It does not by itself prove whether that player receives the entire reward or an assigned component of a shared reward.',

        vacuumTarget:
          'm_hVacuumTarget remains the physical vacuum target. Economic credit may be independent of physical collection.',

        multiPlayer:
          'Simultaneous same-team deltas can indicate sharing, but exact reward decomposition still requires amount-pattern analysis.',

        immediateEarly:
          'Immediate and early lifecycle classes are secondary validation cohorts because their economy can overlap the originating Trooper death.'
      },


    selectedTelemetry:
      {

        candidate:
          selectedCandidate,

        script88Window:
          selectedWindow,

        primaryExactOffsetTicks:
          primaryOffset,

        primaryExactOffsetSeconds:
          primaryOffset /
          TICK_RATE
      },


    cohorts:
      {

        stableIsolated:
          stableIsolated.length,

        stableTargetDiffersFromCredited:
          stableMismatch.length,

        isolatedTargetlessControls:
          targetlessControls.length,

        allTargeted:
          allTargeted.length
      },


    exactOffsetSearch:
      offsetResults,


    bestOffsets:
      {

        credited:
          bestCreditedOffset,

        target:
          bestTargetOffset,

        zero:
          zeroOffset,

        primary:
          primaryOffsetResult
      },


    primaryAttribution:
      {

        stable:
          stableRelations,

        targetDiffersFromCredited:
          mismatchRelations,

        targetlessControls:
          controlRelations
      },


    amountAnalysis,


    lifecycleGeneralization,


    interpretation:
      {

        creditedAssignmentStrong,

        physicalTargetNotExclusive,

        sharedCreditCandidate,

        targetlessNoPayoutSupported,

        wording:
          creditedAssignmentStrong
            ? 'Within isolated stable-floor cases in this replay, the credited last-hitter has a highly specific exact-tick economic signal at AssignedGold resolution, including when another allied player is the physical vacuum target.'
            : 'Exact-tick attribution remains incomplete; inspect offset-specific credited, target, opponent, and targetless-control rates.',

        next:
          creditedAssignmentStrong
            ? 'Use Script 90 to decompose exact reward amounts and determine whether non-credited allies receive a shared component, while preserving credited last-hitter versus physical vacuum target as separate roles.'
            : 'Inspect the exact-offset table before attempting exact reward-value inference.'
      },


    validation:
      {

        pass:
          validationPass,

        checks:
          validationChecks
      },


    outputs:
      {

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
  of outputCases
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
  'ASSIGNED GOLD EXACT CREDIT ATTRIBUTION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'COHORT'
);

console.log(
  '------'
);


console.log(
  `Stable isolated:            ${stableIsolated.length}`
);


console.log(
  `Target != credited:         ${stableMismatch.length}`
);


console.log(
  `Targetless controls:        ${targetlessControls.length}`
);


console.log('');

console.log(
  'EXACT OFFSET SEARCH'
);

console.log(
  '-------------------'
);


for (
  const row
  of offsetResults
) {

  console.log(

    `${formatSigned(row.offset).padStart(4)} ticks ` +

    `credited=${formatPercent(row.stable.creditedPositiveRate).padStart(8)} ` +

    `target=${formatPercent(row.stable.targetPositiveRate).padStart(8)} ` +

    `sameTeam=${formatPercent(row.stable.sameTeamPositiveRate).padStart(8)} ` +

    `opponent=${formatPercent(row.stable.opponentPositiveRate).padStart(8)} ` +

    `timeoutTeam=${formatPercent(row.controls.sameTeamPositiveRate).padStart(8)} ` +

    `creditScore=${formatNumber(row.creditedScore).padStart(7)}`
  );
}


console.log('');

console.log(
  'BEST OFFSETS'
);

console.log(
  '------------'
);


console.log(
  `Best credited offset: ${formatOffset(bestCreditedOffset)}`
);


console.log(
  `Best target offset:   ${formatOffset(bestTargetOffset)}`
);


console.log(
  `Primary offset:       ${formatSigned(primaryOffset)} ticks (${formatNumber(primaryOffset / TICK_RATE)}s)`
);


console.log('');

console.log(
  'PRIMARY EXACT-TICK ATTRIBUTION'
);

console.log(
  '------------------------------'
);


printRelations(
  'Stable isolated',
  stableRelations
);


console.log('');


printRelations(
  'Target != credited',
  mismatchRelations
);


console.log('');


printRelations(
  'Targetless controls',
  controlRelations
);


console.log('');

console.log(
  'TARGET != CREDITED ARBITRATION'
);

console.log(
  '------------------------------'
);


console.log(
  `Cases:          ${mismatchRelations.count}`
);


console.log(
  `Credited only:  ${mismatchRelations.creditedOnly}`
);


console.log(
  `Target only:    ${mismatchRelations.targetOnly}`
);


console.log(
  `Both:           ${mismatchRelations.both}`
);


console.log(
  `Neither:        ${mismatchRelations.neither}`
);


console.log('');

console.log(
  'EXACT-TICK AMOUNTS'
);

console.log(
  '------------------'
);


console.log(
  `Credited delta:           ${formatDistribution(amountAnalysis.creditedDelta)}`
);


console.log(
  `Target delta:             ${formatDistribution(amountAnalysis.targetDelta)}`
);


console.log(
  `Same-team recipient cnt:  ${formatDistribution(amountAnalysis.sameTeamRecipientCount)}`
);


console.log(
  `Mismatch credited delta:  ${formatDistribution(amountAnalysis.mismatchCreditedDelta)}`
);


console.log(
  `Mismatch target delta:    ${formatDistribution(amountAnalysis.mismatchTargetDelta)}`
);


console.log(
  `Mismatch both positive:   ${amountAnalysis.mismatchBothPositive}`
);


console.log(
  `Equal target/credited:    ${amountAnalysis.mismatchEqualAmount}`
);


console.log(
  `Target < credited:        ${amountAnalysis.mismatchTargetLess}`
);


console.log(
  `Target > credited:        ${amountAnalysis.mismatchTargetGreater}`
);


console.log(
  `Target/credited ratio:    ${formatDistribution(amountAnalysis.mismatchTargetCreditedRatio)}`
);


console.log('');

console.log(
  'LIFECYCLE GENERALIZATION'
);

console.log(
  '------------------------'
);


for (
  const [
    lifecycleClass,
    result
  ]
  of Object.entries(
    lifecycleGeneralization
  )
) {

  console.log(

    `${lifecycleClass.padEnd(30)} ` +

    `n=${String(result.count).padStart(4)} ` +

    `credited=${formatPercent(result.creditedPositiveRate).padStart(8)} ` +

    `target=${formatPercent(result.targetPositiveRate).padStart(8)} ` +

    `sameTeam=${formatPercent(result.sameTeamPositiveRate).padStart(8)} ` +

    `opp=${formatPercent(result.opponentPositiveRate).padStart(8)}`
  );
}


console.log('');

console.log(
  'INTERPRETIVE FLAGS'
);

console.log(
  '------------------'
);


console.log(
  `Credited assignment strong:    ${creditedAssignmentStrong}`
);


console.log(
  `Physical target not exclusive: ${physicalTargetNotExclusive}`
);


console.log(
  `Shared credit candidate:       ${sharedCreditCandidate}`
);


console.log(
  `Targetless no-payout support:  ${targetlessNoPayoutSupported}`
);


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
// EXACT OFFSET EVALUATION
// ============================================================

function evaluateExactOffset(
  cohort,
  offset
) {

  if (
    cohort.length ===
    0
  ) {

    return emptyRelations();
  }


  const rows =
    cohort.map(
      row =>
        buildExactCase(
          row,
          offset
        )
    );


  return summarizeCreditRelations(
    rows
  );
}


// ============================================================
// BUILD EXACT CASE
// ============================================================

function buildExactCase(
  row,
  offset
) {

  const positiveByPlayer =
    new Map();


  const exactEvents =
    (
      row
        ?.measurement
        ?.deltaEvents ??
      []
    )
    .filter(
      event =>
        finite(
          event.tickOffset
        ) ===
          offset
        &&
        finite(
          event.delta
        ) !==
          null
    );


  for (
    const event
    of exactEvents
  ) {

    const delta =
      finite(
        event.delta
      );


    if (
      delta ===
      null
      ||
      delta <=
      0
    ) {

      continue;
    }


    const playerName =
      event.playerName ??
      null;


    if (
      !playerName
    ) {

      continue;
    }


    if (
      !positiveByPlayer.has(
        playerName
      )
    ) {

      positiveByPlayer.set(
        playerName,
        {

          playerName,

          team:
            finite(
              event.team
            ),

          positiveDelta:
            0,

          events:
            []
        }
      );
    }


    const player =
      positiveByPlayer.get(
        playerName
      );


    player.positiveDelta +=
      delta;


    player.events.push({

      tick:
        finite(
          event.tick
        ),

      tickOffset:
        finite(
          event.tickOffset
        ),

      delta
    });
  }


  const positivePlayers =
    [
      ...positiveByPlayer.values()
    ]
    .sort(
      (
        a,
        b
      ) =>
        b.positiveDelta -
          a.positiveDelta
        ||
        a.playerName.localeCompare(
          b.playerName
        )
    );


  const sameTeamPositivePlayers =
    positivePlayers.filter(
      player =>
        row.creditedTeam !==
          null
        &&
        finite(
          player.team
        ) ===
        finite(
          row.creditedTeam
        )
    );


  const opponentPositivePlayers =
    positivePlayers.filter(
      player =>
        row.creditedTeam !==
          null
        &&
        finite(
          player.team
        ) !==
        finite(
          row.creditedTeam
        )
    );


  const creditedPositiveDelta =
    row.creditedPlayerName
      ? positiveByPlayer.get(
          row.creditedPlayerName
        )
        ?.positiveDelta ??
        0
      : 0;


  const targetPositiveDelta =
    row.targetPlayerName
      ? positiveByPlayer.get(
          row.targetPlayerName
        )
        ?.positiveDelta ??
        0
      : 0;


  const creditedPositive =
    creditedPositiveDelta >
    0;


  const targetPositive =
    targetPositiveDelta >
    0;


  let arbitration =
    'NEITHER';


  if (
    creditedPositive
    &&
    targetPositive
  ) {

    arbitration =
      row.targetPlayerName ===
        row.creditedPlayerName
        ? 'SAME_PLAYER_POSITIVE'
        : 'BOTH';

  } else if (
    creditedPositive
  ) {

    arbitration =
      'CREDITED_ONLY';

  } else if (
    targetPositive
  ) {

    arbitration =
      'TARGET_ONLY';
  }


  return {

    deathIndex:
      row.deathIndex,

    clock:
      row.clock,

    lifecycleClass:
      row.lifecycleClass,

    isolated16:
      row.isolated16,

    targetAssigned:
      row.targetAssigned,

    targetDiffersFromCredited:
      row.targetDiffersFromCredited,

    creditedPlayerName:
      row.creditedPlayerName,

    creditedTeam:
      row.creditedTeam,

    targetPlayerName:
      row.targetPlayerName,

    targetPlayerTeam:
      row.targetPlayerTeam,

    offsetTicks:
      offset,

    offsetSeconds:
      offset /
      TICK_RATE,

    creditedPositive,

    targetPositive,

    creditedPositiveDelta,

    targetPositiveDelta,

    sameTeamPositivePlayers,

    opponentPositivePlayers,

    sameTeamPositiveDelta:
      sameTeamPositivePlayers.reduce(
        (
          sum,
          player
        ) =>
          sum +
          player.positiveDelta,
        0
      ),

    opponentPositiveDelta:
      opponentPositivePlayers.reduce(
        (
          sum,
          player
        ) =>
          sum +
          player.positiveDelta,
        0
      ),

    sameTeamPositiveCount:
      sameTeamPositivePlayers.length,

    opponentPositiveCount:
      opponentPositivePlayers.length,

    arbitration,

    exactEvents
  };
}


// ============================================================
// CREDIT RELATION SUMMARY
// ============================================================

function summarizeCreditRelations(
  rows
) {

  if (
    rows.length ===
    0
  ) {

    return emptyRelations();
  }


  let creditedPositive =
    0;


  let targetPositive =
    0;


  let sameTeamPositive =
    0;


  let opponentPositive =
    0;


  let multipleSameTeamPositive =
    0;


  let creditedOnly =
    0;


  let targetOnly =
    0;


  let both =
    0;


  let neither =
    0;


  for (
    const row
    of rows
  ) {

    if (
      row.creditedPositive
    ) {

      creditedPositive++;
    }


    if (
      row.targetPositive
    ) {

      targetPositive++;
    }


    if (
      row.sameTeamPositiveCount >
      0
    ) {

      sameTeamPositive++;
    }


    if (
      row.opponentPositiveCount >
      0
    ) {

      opponentPositive++;
    }


    if (
      row.sameTeamPositiveCount >
      1
    ) {

      multipleSameTeamPositive++;
    }


    if (
      row.targetDiffersFromCredited ===
      true
    ) {

      if (
        row.creditedPositive
        &&
        row.targetPositive
      ) {

        both++;

      } else if (
        row.creditedPositive
      ) {

        creditedOnly++;

      } else if (
        row.targetPositive
      ) {

        targetOnly++;

      } else {

        neither++;
      }
    }
  }


  return {

    count:
      rows.length,

    creditedPositive,

    creditedPositiveRate:
      rate(
        creditedPositive,
        rows.length
      ),

    targetPositive,

    targetPositiveRate:
      rate(
        targetPositive,
        rows.length
      ),

    sameTeamPositive,

    sameTeamPositiveRate:
      rate(
        sameTeamPositive,
        rows.length
      ),

    opponentPositive,

    opponentPositiveRate:
      rate(
        opponentPositive,
        rows.length
      ),

    multipleSameTeamPositive,

    multipleSameTeamPositiveRate:
      rate(
        multipleSameTeamPositive,
        rows.length
      ),

    creditedOnly,

    targetOnly,

    both,

    neither
  };
}


function emptyRelations() {

  return {

    count:
      0,

    creditedPositive:
      0,

    creditedPositiveRate:
      null,

    targetPositive:
      0,

    targetPositiveRate:
      null,

    sameTeamPositive:
      0,

    sameTeamPositiveRate:
      null,

    opponentPositive:
      0,

    opponentPositiveRate:
      null,

    multipleSameTeamPositive:
      0,

    multipleSameTeamPositiveRate:
      null,

    creditedOnly:
      0,

    targetOnly:
      0,

    both:
      0,

    neither:
      0
  };
}


// ============================================================
// AMOUNT ANALYSIS
// ============================================================

function analyzeAmounts(
  stableRows,
  mismatchRows
) {

  const creditedDelta =
    stableRows
      .filter(
        row =>
          row.creditedPositiveDelta >
          0
      )
      .map(
        row =>
          row.creditedPositiveDelta
      );


  const targetDelta =
    stableRows
      .filter(
        row =>
          row.targetPositiveDelta >
          0
      )
      .map(
        row =>
          row.targetPositiveDelta
      );


  const sameTeamRecipientCount =
    stableRows.map(
      row =>
        row.sameTeamPositiveCount
    );


  const mismatchCreditedDelta =
    mismatchRows
      .filter(
        row =>
          row.creditedPositiveDelta >
          0
      )
      .map(
        row =>
          row.creditedPositiveDelta
      );


  const mismatchTargetDelta =
    mismatchRows
      .filter(
        row =>
          row.targetPositiveDelta >
          0
      )
      .map(
        row =>
          row.targetPositiveDelta
      );


  const ratios =
    [];


  let mismatchBothPositive =
    0;


  let mismatchEqualAmount =
    0;


  let mismatchTargetLess =
    0;


  let mismatchTargetGreater =
    0;


  for (
    const row
    of mismatchRows
  ) {

    if (
      row.creditedPositiveDelta <=
        0
      ||
      row.targetPositiveDelta <=
        0
    ) {

      continue;
    }


    mismatchBothPositive++;


    if (
      row.targetPositiveDelta ===
      row.creditedPositiveDelta
    ) {

      mismatchEqualAmount++;

    } else if (
      row.targetPositiveDelta <
      row.creditedPositiveDelta
    ) {

      mismatchTargetLess++;

    } else {

      mismatchTargetGreater++;
    }


    ratios.push(
      row.targetPositiveDelta /
      row.creditedPositiveDelta
    );
  }


  const recipientCountGroups =
    {};


  for (
    const row
    of stableRows
  ) {

    const key =
      String(
        row.sameTeamPositiveCount
      );


    if (
      !recipientCountGroups[
        key
      ]
    ) {

      recipientCountGroups[
        key
      ] = {

        cases:
          0,

        creditedDeltas:
          [],

        targetDeltas:
          [],

        teamTotals:
          []
      };
    }


    const group =
      recipientCountGroups[
        key
      ];


    group.cases++;


    if (
      row.creditedPositiveDelta >
      0
    ) {

      group
        .creditedDeltas
        .push(
          row.creditedPositiveDelta
        );
    }


    if (
      row.targetPositiveDelta >
      0
    ) {

      group
        .targetDeltas
        .push(
          row.targetPositiveDelta
        );
    }


    group
      .teamTotals
      .push(
        row.sameTeamPositiveDelta
      );
  }


  for (
    const group
    of Object.values(
      recipientCountGroups
    )
  ) {

    group.creditedDelta =
      summarizeNumbers(
        group.creditedDeltas
      );


    group.targetDelta =
      summarizeNumbers(
        group.targetDeltas
      );


    group.teamTotal =
      summarizeNumbers(
        group.teamTotals
      );


    delete group.creditedDeltas;
    delete group.targetDeltas;
    delete group.teamTotals;
  }


  return {

    creditedDelta:
      summarizeNumbers(
        creditedDelta
      ),

    targetDelta:
      summarizeNumbers(
        targetDelta
      ),

    sameTeamRecipientCount:
      summarizeNumbers(
        sameTeamRecipientCount
      ),

    mismatchCreditedDelta:
      summarizeNumbers(
        mismatchCreditedDelta
      ),

    mismatchTargetDelta:
      summarizeNumbers(
        mismatchTargetDelta
      ),

    mismatchBothPositive,

    mismatchEqualAmount,

    mismatchTargetLess,

    mismatchTargetGreater,

    mismatchTargetCreditedRatio:
      summarizeNumbers(
        ratios
      ),

    recipientCountGroups
  };
}


// ============================================================
// PRINT
// ============================================================

function printRelations(
  label,
  row
) {

  console.log(
    label
  );


  console.log(
    `  Cases:                  ${row.count}`
  );


  console.log(
    `  Credited positive:      ${row.creditedPositive}/${row.count} (${formatPercent(row.creditedPositiveRate)})`
  );


  console.log(
    `  Target positive:        ${row.targetPositive}/${row.count} (${formatPercent(row.targetPositiveRate)})`
  );


  console.log(
    `  Same-team positive:     ${row.sameTeamPositive}/${row.count} (${formatPercent(row.sameTeamPositiveRate)})`
  );


  console.log(
    `  Opponent positive:      ${row.opponentPositive}/${row.count} (${formatPercent(row.opponentPositiveRate)})`
  );


  console.log(
    `  Multiple same-team:     ${row.multipleSameTeamPositive}/${row.count} (${formatPercent(row.multipleSameTeamPositiveRate)})`
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
// NUMERIC HELPERS
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
// DISTRIBUTIONS
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
    !sorted.length
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

function formatSigned(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'n/a';
  }


  if (
    value >
    0
  ) {

    return `+${value}`;
  }


  return String(
    value
  );
}


function formatOffset(
  row
) {

  if (
    !row
  ) {

    return 'n/a';
  }


  return (
    `${formatSigned(row.offset)} ticks ` +
    `creditScore=${formatNumber(row.creditedScore)} ` +
    `credited=${formatPercent(row.stable.creditedPositiveRate)}`
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