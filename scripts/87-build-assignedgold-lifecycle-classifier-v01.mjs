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
// OPERATIONAL LIFECYCLE BOUNDARIES
//
// These timing categories are descriptive.
//
// They should NOT be interpreted as separate engine mechanics.
// ============================================================

const IMMEDIATE_MAX_SECONDS =
  0.25;


const STABLE_FLOOR_MIN_SECONDS =
  1.0;


// ============================================================
// PROXIMITY ENVELOPE
//
// Script 84:
//
//   best unified threshold = 732 HU
//
// Repeated independent work:
//
//   ~732-735 HU planar region
//
// We retain 735 HU as a convenient operational envelope.
//
// This is NOT claimed as an exact engine radius.
// ============================================================

const OPERATIONAL_PROXIMITY_HU =
  735;


// ============================================================
// TARGETLESS TIMEOUT MODEL
//
// Script 86:
//
//   clamp(
//     18,
//     4 * matchMinute - 18,
//     40
//   )
//
// Simple model:
//   RMSE   = 0.0239 s
//   maxErr = 0.0844 s
//
// Fitted 4-sec/min model:
//   all 43 observed terminations within one replay tick.
//
// We allow 0.125 seconds here so the classifier does not depend
// on sub-tick fitting precision.
//
// A match is called a:
//
//   MATCH_TIME_SCALED_TIMEOUT_CANDIDATE
//
// NOT canonical "expiration."
// ============================================================

const TIMEOUT_MODEL_TOLERANCE_SECONDS =
  0.125;


// ============================================================
// PATHS
// ============================================================

const summary84Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_unified_proximity_trigger_validation_v01.json'
  );


const cases84Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_unified_proximity_trigger_cases_v01.jsonl'
  );


const summary86Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_lifetime_scaling_validation_v01.json'
  );


const cases86Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_targetless_lifetime_scaling_cases_v01.jsonl'
  );


const episodes75Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_episodes_v02.jsonl'
  );


const episodes76Path =
  resolve(
    'output',
    replayName,
    'assigned_gold_vacuum_lifecycle_episodes_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classifier_v01.json'
  );


const outputCasesPath =
  resolve(
    'output',
    replayName,
    'assigned_gold_lifecycle_classified_v01.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    summary84Path,
    cases84Path,
    summary86Path,
    cases86Path,
    episodes75Path,
    episodes76Path
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
// LOAD VALIDATION SUMMARIES
// ============================================================

const summary84 =
  JSON.parse(
    readFileSync(
      summary84Path,
      'utf8'
    )
  );


const summary86 =
  JSON.parse(
    readFileSync(
      summary86Path,
      'utf8'
    )
  );


if (
  summary84
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 84 did not PASS.'
  );
}


if (
  summary86
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 86 did not PASS.'
  );
}


// ============================================================
// LOAD INPUT STREAMS
// ============================================================

console.log('');

console.log(
  'Loading Script 75 lifecycle episodes...'
);


const episodes75 =
  await loadJsonl(
    episodes75Path
  );


console.log(
  `Script 75 episodes: ${episodes75.length}`
);


console.log(
  'Loading Script 76 vacuum lifecycle episodes...'
);


const episodes76 =
  await loadJsonl(
    episodes76Path
  );


console.log(
  `Script 76 episodes: ${episodes76.length}`
);


console.log(
  'Loading Script 84 proximity cases...'
);


const cases84 =
  await loadJsonl(
    cases84Path
  );


console.log(
  `Script 84 cases: ${cases84.length}`
);


console.log(
  'Loading Script 86 targetless timeout cases...'
);


const cases86 =
  await loadJsonl(
    cases86Path
  );


console.log(
  `Script 86 cases: ${cases86.length}`
);


// ============================================================
// INDEX SOURCES
// ============================================================

const episode75ByDeathIndex =
  indexByDeathIndex(
    episodes75
  );


const episode76ByDeathIndex =
  indexByDeathIndex(
    episodes76
  );


const case84ByDeathIndex =
  indexByDeathIndex(
    cases84
  );


const case86ByDeathIndex =
  indexByDeathIndex(
    cases86
  );


// ============================================================
// CLEAN SCRIPT76 COHORT
//
// This preserves the strict 991-case cohort used throughout:
//
//   clean isolated Trooper death
//   exact one-unit m_iLastHits increment
//   resolved credited player
// ============================================================

const clean76 =
  episodes76.filter(
    row =>
      row
        ?.creditedPlayer
        ?.quality ===
      'CLEAN_ISOLATED_EXACT_LASTHIT_COUNTER'
  );


console.log('');

console.log(
  `Clean classified cohort source: ${clean76.length}`
);


// ============================================================
// BUILD CLASSIFIED STREAM
// ============================================================

const classified =
  [];


for (
  const source76
  of clean76
) {

  const deathIndex =
    finite(
      source76?.deathIndex
    );


  if (
    deathIndex ===
    null
  ) {

    continue;
  }


  const source75 =
    episode75ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  const source84 =
    case84ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  const source86 =
    case86ByDeathIndex.get(
      deathIndex
    )
    ??
    null;


  if (
    !source75
    ||
    !source84
  ) {

    continue;
  }


  classified.push(
    classifyEpisode({
      source75,
      source76,
      source84,
      source86
    })
  );
}


// ============================================================
// PARTITIONS
// ============================================================

const targetAssigned =
  classified.filter(
    row =>
      row
        .vacuum
        .targetAssigned ===
      true
  );


const targetless =
  classified.filter(
    row =>
      row
        .vacuum
        .targetAssigned ===
      false
  );


const immediate =
  classified.filter(
    row =>
      row.lifecycleClass ===
      'TARGETED_IMMEDIATE'
  );


const early =
  classified.filter(
    row =>
      row.lifecycleClass ===
      'TARGETED_EARLY_FLOOR'
  );


const stable =
  classified.filter(
    row =>
      row.lifecycleClass ===
      'TARGETED_STABLE_FLOOR'
  );


const timeoutCandidates =
  classified.filter(
    row =>
      row.lifecycleClass ===
      'TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE'
  );


const targetlessCensored =
  classified.filter(
    row =>
      row.lifecycleClass ===
      'TARGETLESS_CENSORED_NO_ACTIVE_FALSE'
  );


const unresolved =
  classified.filter(
    row =>
      row.lifecycleClass ===
      'UNRESOLVED'
      ||
      row.lifecycleClass ===
      'TARGETLESS_TERMINATION_OFF_TIMEOUT_MODEL'
  );


// ============================================================
// TARGET TERMINATION
// ============================================================

const targetWithInactive =
  targetAssigned.filter(
    row =>
      row
        .termination
        .activeFalseObserved ===
      true
  );


const targetToInactiveSeconds =
  values(
    targetAssigned,
    row =>
      row
        .termination
        .targetToInactiveSeconds
  );


// ============================================================
// PROXIMITY SUPPORT
// ============================================================

const targetWith735Entry =
  targetAssigned.filter(
    row =>
      row
        .proximity
        .everInsideOperationalEnvelope ===
      true
  );


const targetWithout735Entry =
  targetAssigned.filter(
    row =>
      row
        .proximity
        .everInsideOperationalEnvelope !==
      true
  );


const targetlessWith735Entry =
  targetless.filter(
    row =>
      row
        .proximity
        .everInsideOperationalEnvelope ===
      true
  );


const targetlessWithout735Entry =
  targetless.filter(
    row =>
      row
        .proximity
        .everInsideOperationalEnvelope !==
      true
  );


// ============================================================
// TARGET IDENTITY
// ============================================================

const targetIdentityComparable =
  targetAssigned.filter(
    row =>
      Boolean(
        row
          .creditedPlayer
          .playerName
      )
      &&
      Boolean(
        row
          .vacuum
          .targetPlayerName
      )
  );


const targetIsCredited =
  targetIdentityComparable.filter(
    row =>
      row
        .creditedPlayer
        .playerName ===
      row
        .vacuum
        .targetPlayerName
  );


const targetIsOtherAlly =
  targetIdentityComparable.filter(
    row =>
      row
        .creditedPlayer
        .playerName !==
      row
        .vacuum
        .targetPlayerName
      &&
      row
        .creditedPlayer
        .team ===
      row
        .vacuum
        .targetPlayerTeam
  );


const targetIsOpponent =
  targetIdentityComparable.filter(
    row =>
      Number.isFinite(
        row
          .creditedPlayer
          .team
      )
      &&
      Number.isFinite(
        row
          .vacuum
          .targetPlayerTeam
      )
      &&
      row
        .creditedPlayer
        .team !==
      row
        .vacuum
        .targetPlayerTeam
  );


// ============================================================
// FLOOR-WINDOW DISTRIBUTIONS
// ============================================================

const targetedPreTargetDurations =
  values(
    targetAssigned,
    row =>
      row
        .behavioralWindow
        .preTargetDurationSeconds
  );


const targetlessPersistenceDurations =
  values(
    targetless,
    row =>
      row
        .behavioralWindow
        .targetlessPersistenceSeconds
  );


// ============================================================
// CLASS COUNTS
// ============================================================

const lifecycleClassCounts =
  countBy(
    classified,
    row =>
      row.lifecycleClass
  );


const opportunityClassCounts =
  countBy(
    classified,
    row =>
      row
        .behavioralWindow
        .opportunityClass
  );


const proximityClassCounts =
  countBy(
    classified,
    row =>
      row
        .proximity
        .supportClass
  );


// ============================================================
// TIMEOUT MODEL RESIDUALS
// ============================================================

const timeoutResiduals =
  values(
    timeoutCandidates,
    row =>
      row
        .targetlessTimeout
        .simpleModelResidualSeconds
  );


const timeoutAbsoluteResiduals =
  timeoutResiduals.map(
    Math.abs
  );


// ============================================================
// VALIDATION
// ============================================================

const targetTimingPartitionCount =
  immediate.length +
  early.length +
  stable.length;


const targetlessPartitionCount =
  timeoutCandidates.length +
  targetlessCensored.length +
  unresolved.filter(
    row =>
      row
        .vacuum
        .targetAssigned ===
      false
  ).length;


const classificationExhaustive =
  (
    targetTimingPartitionCount +
    targetlessPartitionCount
  ) ===
  classified.length;


const validationChecks =
  {

    script84Passed:
      check(
        summary84
          ?.validation
          ?.pass,
        true,
        summary84
          ?.validation
          ?.pass ===
        true
      ),


    script86Passed:
      check(
        summary86
          ?.validation
          ?.pass,
        true,
        summary86
          ?.validation
          ?.pass ===
        true
      ),


    cleanSourceCount:
      check(
        clean76.length,
        replayName ===
          'test'
          ? 991
          : '>0',
        replayName ===
          'test'
          ? clean76.length ===
            991
          : clean76.length >
            0
      ),


    classifiedCount:
      check(
        classified.length,
        clean76.length,
        classified.length ===
        clean76.length
      ),


    targetAssignedCount:
      check(
        targetAssigned.length,
        replayName ===
          'test'
          ? 947
          : '>0',
        replayName ===
          'test'
          ? targetAssigned.length ===
            947
          : targetAssigned.length >
            0
      ),


    targetlessCount:
      check(
        targetless.length,
        replayName ===
          'test'
          ? 44
          : '>=0',
        replayName ===
          'test'
          ? targetless.length ===
            44
          : targetless.length >=
            0
      ),


    immediateCount:
      check(
        immediate.length,
        replayName ===
          'test'
          ? 489
          : '>=0',
        replayName ===
          'test'
          ? immediate.length ===
            489
          : immediate.length >=
            0
      ),


    earlyCount:
      check(
        early.length,
        replayName ===
          'test'
          ? 327
          : '>=0',
        replayName ===
          'test'
          ? early.length ===
            327
          : early.length >=
            0
      ),


    stableCount:
      check(
        stable.length,
        replayName ===
          'test'
          ? 131
          : '>=0',
        replayName ===
          'test'
          ? stable.length ===
            131
          : stable.length >=
            0
      ),


    timeoutCandidateCount:
      check(
        timeoutCandidates.length,
        replayName ===
          'test'
          ? 43
          : '>=0',
        replayName ===
          'test'
          ? timeoutCandidates.length ===
            43
          : timeoutCandidates.length >=
            0
      ),


    censoredTargetlessCount:
      check(
        targetlessCensored.length,
        replayName ===
          'test'
          ? 1
          : '>=0',
        replayName ===
          'test'
          ? targetlessCensored.length ===
            1
          : targetlessCensored.length >=
            0
      ),


    classificationExhaustive:
      check(
        classificationExhaustive,
        true,
        classificationExhaustive
      ),


    noUnresolvedLifecycle:
      check(
        unresolved.length,
        replayName ===
          'test'
          ? 0
          : '>=0',
        replayName ===
          'test'
          ? unresolved.length ===
            0
          : true
      ),


    targetPostInactiveCoverage:
      check(
        targetWithInactive.length,
        '>=99% of targeted cases',
        rate(
          targetWithInactive.length,
          targetAssigned.length
        ) >=
        0.99
      ),


    targetOpponentVacuumCount:
      check(
        targetIsOpponent.length,
        replayName ===
          'test'
          ? 0
          : '>=0',
        replayName ===
          'test'
          ? targetIsOpponent.length ===
            0
          : true
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
      'ASSIGNED_GOLD_LIFECYCLE_CLASSIFIER_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'FORMAL_SINGLE_REPLAY_LIFECYCLE_CLASSIFIER_READY'
        : 'PIPELINE_VALIDATION_FAILURE',


    purpose:
      [

        'Consolidate validated AssignedGold production, target acquisition, floor persistence, proximity, and targetless timeout telemetry into one downstream lifecycle stream.',

        'Create stable operational classes suitable for later resource-opportunity feature construction.',

        'Preserve distinctions between observed telemetry, strongly supported inference, and unresolved canonical engine semantics.'
      ],


    semanticAuthority:
      {

        production:
          'Player last-hit bookkeeping is strongly associated with AssignedGold production in the clean isolated cohort.',

        vacuumTarget:
          'm_hVacuumTarget assignment is observed downstream vacuum-lifecycle telemetry and is not a last-hitter field.',

        vacuumTargetTeam:
          'Observed clean player targets are allied with the credited-player team in test.dem.',

        proximity:
          'Approximately 732-735 HU planar allied proximity is strongly associated with target assignment within test.dem. 735 HU is retained only as an operational envelope.',

        postTargetInactive:
          'm_bActive=false after target assignment is a strong lifecycle-termination signal but is not independently labeled economic payout.',

        timeout:
          'Targetless active-to-inactive lifetime follows an extremely tight match-time-scaled function in test.dem. These events are labeled timeout candidates rather than canonical expiration.',

        collector:
          'm_hVacuumTarget is not automatically promoted to a canonical economic collector field.'
      },


    operationalDefinitions:
      {

        immediateTargetMaximumSeconds:
          IMMEDIATE_MAX_SECONDS,

        stableFloorMinimumSeconds:
          STABLE_FLOOR_MIN_SECONDS,

        proximityEnvelopeHU:
          OPERATIONAL_PROXIMITY_HU,

        targetlessTimeoutModel:
          'clamp(18, 4 * activationMatchMinute - 18, 40)',

        timeoutModelToleranceSeconds:
          TIMEOUT_MODEL_TOLERANCE_SECONDS
      },


    counts:
      {

        classified:
          classified.length,

        targetAssigned:
          targetAssigned.length,

        targetless:
          targetless.length,

        lifecycleClasses:
          lifecycleClassCounts,

        opportunityClasses:
          opportunityClassCounts,

        proximityClasses:
          proximityClassCounts
      },


    targetLifecycle:
      {

        immediate:
          immediate.length,

        earlyFloor:
          early.length,

        stableFloor:
          stable.length,

        activeFalseObservedAfterTarget:
          targetWithInactive.length,

        activeFalseObservedAfterTargetRate:
          rate(
            targetWithInactive.length,
            targetAssigned.length
          ),

        targetToInactiveSeconds:
          summarizeNumbers(
            targetToInactiveSeconds
          ),

        preTargetDurationSeconds:
          summarizeNumbers(
            targetedPreTargetDurations
          )
      },


    targetIdentity:
      {

        comparable:
          targetIdentityComparable.length,

        creditedPlayer:
          targetIsCredited.length,

        creditedPlayerRate:
          rate(
            targetIsCredited.length,
            targetIdentityComparable.length
          ),

        otherSameTeamPlayer:
          targetIsOtherAlly.length,

        otherSameTeamPlayerRate:
          rate(
            targetIsOtherAlly.length,
            targetIdentityComparable.length
          ),

        opposingTeamPlayer:
          targetIsOpponent.length
      },


    proximity:
      {

        targetedEverInside735:
          targetWith735Entry.length,

        targetedEverInside735Rate:
          rate(
            targetWith735Entry.length,
            targetAssigned.length
          ),

        targetedNeverInside735:
          targetWithout735Entry.length,

        targetlessEverInside735:
          targetlessWith735Entry.length,

        targetlessNeverInside735:
          targetlessWithout735Entry.length
      },


    targetlessLifecycle:
      {

        timeoutCandidates:
          timeoutCandidates.length,

        censoredNoActiveFalse:
          targetlessCensored.length,

        unresolved:
          unresolved.filter(
            row =>
              row
                .vacuum
                .targetAssigned ===
              false
          ).length,

        persistenceSeconds:
          summarizeNumbers(
            targetlessPersistenceDurations
          ),

        simpleTimeoutModelResidualSeconds:
          summarizeNumbers(
            timeoutResiduals
          ),

        simpleTimeoutModelAbsoluteResidualSeconds:
          summarizeNumbers(
            timeoutAbsoluteResiduals
          )
      },


    downstreamUse:
      {

        recommended:
          [

            'Use lifecycleClass as a stable descriptive AssignedGold lifecycle category.',

            'Use behavioralWindow.opportunityClass when constructing resource-opportunity windows.',

            'Use creditedPlayer separately from vacuum.targetPlayerName.',

            'Preserve proximity metrics rather than replacing them with a binary 735-HU truth value.',

            'Treat TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE as an unclaimed/untargeted termination candidate, not yet canonical expiration.'
          ],

        prohibited:
          [

            'Do not label m_hVacuumTarget as exact last-hitter identity.',

            'Do not label m_bActive=false alone as confirmed economic acquisition.',

            'Do not call 735 HU an exact canonical engine radius.',

            'Do not call the targetless timeout function globally canonical until independent replay replication.'
          ]
      },


    next:
      {

        step:
          'CROSS_REPLAY_REPLICATION',

        description:
          'Run the compact production/proximity/timeout contracts on independent replay files before promoting these AssignedGold mechanics beyond single-replay authority.'
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
  'ASSIGNED GOLD FORMAL LIFECYCLE CLASSIFIER V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'FORMAL LIFECYCLE CLASSES'
);

console.log(
  '------------------------'
);


printCounts(
  lifecycleClassCounts
);


console.log('');

console.log(
  'BEHAVIORAL OPPORTUNITY WINDOW CLASSES'
);

console.log(
  '-------------------------------------'
);


printCounts(
  opportunityClassCounts
);


console.log('');

console.log(
  'TARGET LIFECYCLE'
);

console.log(
  '----------------'
);


console.log(
  `Target assigned:                  ${targetAssigned.length}`
);


console.log(
  `Immediate <=0.25s:                ${immediate.length}`
);


console.log(
  `Early floor >0.25s <1s:           ${early.length}`
);


console.log(
  `Stable floor >=1s:                ${stable.length}`
);


console.log(
  `Post-target active=false:         ${targetWithInactive.length}/${targetAssigned.length}`
);


console.log(
  `Target -> inactive:               ${formatDistribution(
    summarizeNumbers(
      targetToInactiveSeconds
    )
  )}`
);


console.log('');

console.log(
  'TARGET IDENTITY'
);

console.log(
  '---------------'
);


console.log(
  `Comparable:                       ${targetIdentityComparable.length}`
);


console.log(
  `Target = credited player:         ${targetIsCredited.length} (${formatPercent(rate(targetIsCredited.length, targetIdentityComparable.length))})`
);


console.log(
  `Target = other same-team player:  ${targetIsOtherAlly.length} (${formatPercent(rate(targetIsOtherAlly.length, targetIdentityComparable.length))})`
);


console.log(
  `Target = opposing player:         ${targetIsOpponent.length}`
);


console.log('');

console.log(
  'PROXIMITY SUPPORT'
);

console.log(
  '-----------------'
);


console.log(
  `Targeted ever <=735:              ${targetWith735Entry.length}/${targetAssigned.length} (${formatPercent(rate(targetWith735Entry.length, targetAssigned.length))})`
);


console.log(
  `Targeted never <=735:             ${targetWithout735Entry.length}`
);


console.log(
  `Targetless ever <=735 XY:         ${targetlessWith735Entry.length}/${targetless.length}`
);


console.log('');

console.log(
  'TARGETLESS TIMEOUT'
);

console.log(
  '------------------'
);


console.log(
  `Scaled-timeout candidates:        ${timeoutCandidates.length}`
);


console.log(
  `Censored/no active=false:         ${targetlessCensored.length}`
);


console.log(
  `Unresolved targetless:            ${unresolved.filter(row => row.vacuum.targetAssigned === false).length}`
);


console.log(
  `Simple-model residual:            ${formatDistribution(
    summarizeNumbers(
      timeoutResiduals
    )
  )}`
);


console.log(
  `Absolute residual:                ${formatDistribution(
    summarizeNumbers(
      timeoutAbsoluteResiduals
    )
  )}`
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
    row
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(

    `${row.pass ? 'PASS' : 'FAIL'}  ` +

    `${name.padEnd(38)} ` +

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
  `Classified stream:\n${outputCasesPath}`
);


console.log('');


// ============================================================
// CLASSIFY ONE EPISODE
// ============================================================

function classifyEpisode({
  source75,
  source76,
  source84,
  source86
}) {

  const deathIndex =
    finite(
      source76?.deathIndex
    );


  const activationTick =
    firstFinite([
      source84
        ?.activationTick,

      source75
        ?.assignedGold
        ?.activationTick,

      source76
        ?.assignedGold
        ?.activationTick
    ]);


  const activationTimeSeconds =
    firstFinite([
      source75
        ?.assignedGold
        ?.activationTimeSeconds,

      source76
        ?.assignedGold
        ?.activationTimeSeconds
    ]);


  const targetOnsetType =
    source76
      ?.vacuum
      ?.targetOnsetType ??
    null;


  const targetAssigned =
    targetOnsetType ===
    'NULL_TO_PLAYER_TARGET_TRANSITION';


  const targetDelaySeconds =
    finite(
      source76
        ?.vacuum
        ?.targetDelaySeconds
    );


  const activeFalseObserved =
    source76
      ?.termination
      ?.activeFalseObserved ===
    true;


  const activeFalseTick =
    finite(
      source76
        ?.termination
        ?.activeFalseTick
    );


  const durationSeconds =
    finite(
      source76
        ?.termination
        ?.durationSeconds
    );


  const threshold735 =
    source84
      ?.thresholdStates
      ?.[
        String(
          OPERATIONAL_PROXIMITY_HU
        )
      ]
    ??
    {};


  const firstInside735Tick =
    finite(
      threshold735
        ?.firstInsideTick
    );


  const targetOnsetTick =
    firstFinite([
      source84
        ?.rawTargetOnsetTick,

      source76
        ?.vacuum
        ?.targetOnsetTick
    ]);


  const firstInside735ToTargetSeconds =
    firstInside735Tick !==
      null
    &&
    targetOnsetTick !==
      null
      ? (
        targetOnsetTick -
        firstInside735Tick
      )
      /
      TICK_RATE
      : null;


  const minimumNearestAllyXY =
    finite(
      source84
        ?.minimumNearestAllyXY
    );


  const minimumNearestAlly3D =
    finite(
      source84
        ?.minimumNearestAlly3D
    );


  const timeoutPrediction =
    source86
      ?.predictions
      ?.SIMPLE_ROUND_ACTIVATION
    ??
    null;


  const timeoutPredictedSeconds =
    finite(
      timeoutPrediction
        ?.predictedSeconds
    );


  const timeoutResidualSeconds =
    finite(
      timeoutPrediction
        ?.residualSeconds
    );


  const timeoutAbsoluteResidualSeconds =
    finite(
      timeoutPrediction
        ?.absoluteResidualSeconds
    );


  const timeoutModelMatch =
    !targetAssigned
    &&
    activeFalseObserved
    &&
    timeoutAbsoluteResidualSeconds !==
      null
    &&
    timeoutAbsoluteResidualSeconds <=
      TIMEOUT_MODEL_TOLERANCE_SECONDS;


  const lifecycleClass =
    determineLifecycleClass({
      targetAssigned,
      targetDelaySeconds,
      activeFalseObserved,
      timeoutModelMatch
    });


  const opportunityClass =
    determineOpportunityClass({
      lifecycleClass
    });


  const proximitySupportClass =
    determineProximitySupportClass({
      targetAssigned,
      firstInside735Tick
    });


  const preTargetDurationSeconds =
    targetAssigned
      ? targetDelaySeconds
      : null;


  const targetlessPersistenceSeconds =
    !targetAssigned
      ? (
        finite(
          source86
            ?.rawDurationSeconds
        )
        ??
        durationSeconds
      )
      : null;


  return {

    schemaVersion:
      1,

    canonical:
      false,

    replay:
      replayName,

    deathIndex,

    clock:
      source76?.clock ??
      source75
        ?.death
        ?.clock ??
      null,


    trooper: {

      entityIndex:
        firstFinite([
          source75
            ?.death
            ?.entityIndex,

          source75
            ?.trooper
            ?.entityIndex
        ]),

      baseType:
        source76?.baseType ??
        source75
          ?.death
          ?.baseType ??
        null,

      variantLabel:
        source75
          ?.death
          ?.variantLabel ??
        null,

      team:
        firstFinite([
          source75
            ?.death
            ?.team,

          source75
            ?.trooper
            ?.team
        ]),

      lane:
        firstFinite([
          source75
            ?.death
            ?.lane,

          source75
            ?.trooper
            ?.lane
        ])
    },


    death: {

      tick:
        finite(
          source75
            ?.death
            ?.tick
        ),

      timeSeconds:
        finite(
          source75
            ?.death
            ?.timeSeconds
        ),

      clock:
        source75
          ?.death
          ?.clock ??
        source76?.clock ??
        null
    },


    creditedPlayer: {

      playerName:
        source76
          ?.creditedPlayer
          ?.playerName ??
        null,

      team:
        finite(
          source76
            ?.creditedPlayer
            ?.team
        ),

      quality:
        source76
          ?.creditedPlayer
          ?.quality ??
        null
    },


    groundSoul: {

      entityIndex:
        firstFinite([
          source84
            ?.assignedGoldEntityIndex,

          source75
            ?.assignedGold
            ?.entityIndex,

          source76
            ?.assignedGold
            ?.entityIndex
        ]),

      activationTick,

      activationTimeSeconds,

      productionStatus:
        'STRONGLY_SUPPORTED_PLAYER_LASTHIT_ASSOCIATED_PRODUCTION'
    },


    vacuum: {

      targetAssigned,

      targetOnsetType,

      targetOnsetTick,

      targetDelaySeconds,

      targetPlayerName:
        source76
          ?.vacuum
          ?.targetPlayerName ??
        null,

      targetPlayerTeam:
        finite(
          source76
            ?.vacuum
            ?.targetPlayerTeam
        ),

      targetPawnEntityIndex:
        finite(
          source76
            ?.vacuum
            ?.targetPawnEntityIndex
        ),

      targetIdentityRelation:
        source84
          ?.targetIdentityRelation ??
        inferTargetIdentityRelation(
          source76
        ),

      semanticStatus:
        targetAssigned
          ? 'OBSERVED_VACUUM_LIFECYCLE_TARGET'
          : 'NO_PLAYER_TARGET_OBSERVED'
    },


    proximity: {

      operationalEnvelopeHU:
        OPERATIONAL_PROXIMITY_HU,

      everInsideOperationalEnvelope:
        firstInside735Tick !==
        null,

      firstInsideTick:
        firstInside735Tick,

      firstInsidePlayerName:
        threshold735
          ?.firstInsidePlayerName ??
        null,

      firstInsidePawnEntityIndex:
        finite(
          threshold735
            ?.firstInsidePawnEntityIndex
        ),

      firstInsideToTargetSeconds:
        firstInside735ToTargetSeconds,

      minimumNearestAllyXY,

      minimumNearestAlly3D,

      supportClass:
        proximitySupportClass,

      semanticStatus:
        'STRONGLY_SUPPORTED_SINGLE_REPLAY_PROXIMITY_ASSOCIATION'
    },


    termination: {

      activeFalseObserved,

      activeFalseTick,

      durationSeconds,

      targetToInactiveSeconds:
        finite(
          source76
            ?.vacuum
            ?.targetToInactiveSeconds
        ),

      endReason:
        source76
          ?.termination
          ?.endReason ??
        null,

      semanticStatus:
        activeFalseObserved
          ? 'OBSERVED_LIFECYCLE_TERMINATION_SIGNAL'
          : 'NO_ACTIVE_FALSE_OBSERVED'
    },


    targetlessTimeout: {

      applicable:
        !targetAssigned,

      simpleModel:
        'clamp(18, 4 * activationMatchMinute - 18, 40)',

      predictedSeconds:
        timeoutPredictedSeconds,

      observedSeconds:
        targetlessPersistenceSeconds,

      simpleModelResidualSeconds:
        timeoutResidualSeconds,

      simpleModelAbsoluteResidualSeconds:
        timeoutAbsoluteResidualSeconds,

      modelToleranceSeconds:
        TIMEOUT_MODEL_TOLERANCE_SECONDS,

      modelMatch:
        timeoutModelMatch,

      semanticStatus:
        timeoutModelMatch
          ? 'MATCH_TIME_SCALED_TIMEOUT_CANDIDATE'
          : !targetAssigned
            ? activeFalseObserved
              ? 'TARGETLESS_TERMINATION_NOT_MATCHED_TO_MODEL'
              : 'TARGETLESS_CENSORED_NO_TERMINATION'
            : 'NOT_APPLICABLE'
    },


    behavioralWindow: {

      opportunityClass,

      preTargetDurationSeconds,

      targetlessPersistenceSeconds,

      interpretation:
        describeOpportunityClass(
          opportunityClass
        )
    },


    lifecycleClass
  };
}


// ============================================================
// LIFECYCLE CLASS
// ============================================================

function determineLifecycleClass({
  targetAssigned,
  targetDelaySeconds,
  activeFalseObserved,
  timeoutModelMatch
}) {

  if (
    targetAssigned
  ) {

    if (
      !Number.isFinite(
        targetDelaySeconds
      )
    ) {

      return 'UNRESOLVED';
    }


    if (
      targetDelaySeconds <=
      IMMEDIATE_MAX_SECONDS
    ) {

      return 'TARGETED_IMMEDIATE';
    }


    if (
      targetDelaySeconds <
      STABLE_FLOOR_MIN_SECONDS
    ) {

      return 'TARGETED_EARLY_FLOOR';
    }


    return 'TARGETED_STABLE_FLOOR';
  }


  if (
    timeoutModelMatch
  ) {

    return 'TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE';
  }


  if (
    !activeFalseObserved
  ) {

    return 'TARGETLESS_CENSORED_NO_ACTIVE_FALSE';
  }


  return 'TARGETLESS_TERMINATION_OFF_TIMEOUT_MODEL';
}


// ============================================================
// OPPORTUNITY CLASS
// ============================================================

function determineOpportunityClass({
  lifecycleClass
}) {

  switch (
    lifecycleClass
  ) {

    case 'TARGETED_IMMEDIATE':

      return 'MINIMAL_OBSERVED_FLOOR_WINDOW';


    case 'TARGETED_EARLY_FLOOR':

      return 'SHORT_FLOOR_PERSISTENCE_WINDOW';


    case 'TARGETED_STABLE_FLOOR':

      return 'PERSISTENT_FLOOR_PICKUP_WINDOW';


    case 'TARGETLESS_MATCH_TIME_SCALED_TIMEOUT_CANDIDATE':

      return 'UNTARGETED_FLOOR_PERSISTENCE_TO_TIMEOUT_CANDIDATE';


    case 'TARGETLESS_CENSORED_NO_ACTIVE_FALSE':

      return 'UNTARGETED_FLOOR_PERSISTENCE_CENSORED';


    default:

      return 'UNRESOLVED_OPPORTUNITY_WINDOW';
  }
}


// ============================================================
// PROXIMITY SUPPORT CLASS
// ============================================================

function determineProximitySupportClass({
  targetAssigned,
  firstInside735Tick
}) {

  const inside =
    firstInside735Tick !==
    null;


  if (
    targetAssigned
    &&
    inside
  ) {

    return 'TARGET_WITH_OPERATIONAL_PROXIMITY_ENTRY';
  }


  if (
    targetAssigned
    &&
    !inside
  ) {

    return 'TARGET_WITHOUT_OBSERVED_OPERATIONAL_PROXIMITY_ENTRY';
  }


  if (
    !targetAssigned
    &&
    inside
  ) {

    return 'NO_TARGET_WITH_OPERATIONAL_XY_PROXIMITY_ENTRY';
  }


  return 'NO_TARGET_WITHOUT_OPERATIONAL_PROXIMITY_ENTRY';
}


// ============================================================
// TARGET IDENTITY RELATION
// ============================================================

function inferTargetIdentityRelation(
  source76
) {

  const creditedName =
    source76
      ?.creditedPlayer
      ?.playerName ??
    null;


  const creditedTeam =
    finite(
      source76
        ?.creditedPlayer
        ?.team
    );


  const targetName =
    source76
      ?.vacuum
      ?.targetPlayerName ??
    null;


  const targetTeam =
    finite(
      source76
        ?.vacuum
        ?.targetPlayerTeam
    );


  if (
    !targetName
  ) {

    return null;
  }


  if (
    targetName ===
    creditedName
  ) {

    return 'TARGET_IS_CREDITED_PLAYER';
  }


  if (
    creditedTeam !==
      null
    &&
    targetTeam !==
      null
    &&
    creditedTeam ===
      targetTeam
  ) {

    return 'TARGET_IS_OTHER_SAME_TEAM_PLAYER';
  }


  if (
    creditedTeam !==
      null
    &&
    targetTeam !==
      null
    &&
    creditedTeam !==
      targetTeam
  ) {

    return 'TARGET_IS_OTHER_TEAM_PLAYER';
  }


  return 'TARGET_IDENTITY_UNRESOLVED';
}


// ============================================================
// OPPORTUNITY DESCRIPTION
// ============================================================

function describeOpportunityClass(
  value
) {

  switch (
    value
  ) {

    case 'MINIMAL_OBSERVED_FLOOR_WINDOW':

      return 'Vacuum target appeared within 0.25 seconds of AssignedGold activation; little persistent floor-pickup window was observed.';


    case 'SHORT_FLOOR_PERSISTENCE_WINDOW':

      return 'AssignedGold remained without a player target for more than 0.25 but less than 1 second before target assignment.';


    case 'PERSISTENT_FLOOR_PICKUP_WINDOW':

      return 'AssignedGold remained without a player target for at least 1 second before target assignment, providing a clearly observable floor-persistence interval.';


    case 'UNTARGETED_FLOOR_PERSISTENCE_TO_TIMEOUT_CANDIDATE':

      return 'AssignedGold never acquired a player target and terminated at the match-time-scaled targetless lifetime predicted by the validated single-replay timer model.';


    case 'UNTARGETED_FLOOR_PERSISTENCE_CENSORED':

      return 'AssignedGold never acquired a player target and no active=false termination was observed within the available replay lifecycle.';


    default:

      return 'Lifecycle opportunity window remains unresolved.';
  }
}


// ============================================================
// INDEX
// ============================================================

function indexByDeathIndex(
  rows
) {

  const output =
    new Map();


  for (
    const row
    of rows
  ) {

    const deathIndex =
      firstFinite([
        row?.deathIndex,

        row
          ?.death
          ?.deathIndex
      ]);


    if (
      deathIndex !==
      null
    ) {

      output.set(
        deathIndex,
        row
      );
    }
  }


  return output;
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


function values(
  rows,
  selector
) {

  return rows
    .map(
      row =>
        finite(
          selector(
            row
          )
        )
    )
    .filter(
      Number.isFinite
    );
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


function countBy(
  rows,
  selector
) {

  const output =
    {};


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
        'NULL'
      );


    output[
      key
    ] =
      (
        output[
          key
        ]
        ??
        0
      )
      +
      1;
  }


  return output;
}


function printCounts(
  counts
) {

  for (
    const [
      key,
      count
    ]
    of Object
      .entries(
        counts
      )
      .sort(
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
  ) {

    console.log(
      `${key.padEnd(52)} ${count}`
    );
  }
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
    !Array.isArray(
      sorted
    )
    ||
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
// VALIDATION / FORMAT
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