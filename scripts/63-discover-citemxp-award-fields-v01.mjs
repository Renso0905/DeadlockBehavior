import {
  createReadStream,
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
  process.argv[2] ?? 'test';

const TICK_RATE = 64;

const SEARCH_BEFORE_TICKS = 16;  // 0.25 sec
const SEARCH_AFTER_TICKS = 32;   // 0.50 sec
const WIDE_SEARCH_TICKS = 64;    // 1.00 sec diagnostic

const FIELD_NAME_PRIORITY_REGEX =
  /(soul|gold|currency|net.?worth|worth|money|xp|experience|cash|credit)/i;

const MAX_FIELD_EXAMPLES = 20;
const MAX_ANCHOR_EXAMPLES = 100;
const MAX_RAW_DELTA_EXAMPLES = 200;


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );

const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );

const shotOutcomePath =
  resolve(
    'output',
    replayName,
    'citemxp_shot_outcomes_v01.jsonl'
  );

const raceSummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_race_resolution_validation_v01.json'
  );

const summaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_award_field_discovery_v01.json'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    replayPath,
    playerStatePath,
    shotOutcomePath,
    raceSummaryPath
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
// LOAD SCRIPT 62 SUMMARY
// ============================================================

const raceSummary =
  JSON.parse(
    readFileSync(
      raceSummaryPath,
      'utf8'
    )
  );

if (
  raceSummary
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 62 race-resolution validation did not PASS.'
  );
}


// ============================================================
// LOAD PLAYER CONTROLLER IDENTITIES
// ============================================================

console.log('');

console.log(
  'Loading player/controller identities...'
);

const playerIdentity =
  await loadPlayerIdentity(
    playerStatePath
  );

const playerByControllerIndex =
  playerIdentity.playerByControllerIndex;

console.log(
  `Players: ${playerIdentity.players.length}`
);

console.log(
  `Controller indexes: ${playerByControllerIndex.size}`
);


// ============================================================
// LOAD SCRIPT 61 ORB OUTCOMES
// ============================================================

console.log('');

console.log(
  'Loading CItemXP orb outcomes...'
);

const rawOutcomeRows =
  await loadJsonl(
    shotOutcomePath
  );

const targets =
  rawOutcomeRows
    .map(
      normalizeOutcomeRow
    )
    .filter(
      Boolean
    );

console.log(
  `Targets: ${targets.length}`
);


// ============================================================
// BUILD RESOLUTION ANCHORS
// ============================================================

const anchors =
  targets
    .map(
      buildResolutionAnchor
    )
    .filter(
      Boolean
    )
    .sort(
      (
        a,
        b
      ) =>
        a.anchorTick -
        b.anchorTick
    );

for (
  let i = 0;
  i < anchors.length;
  i++
) {
  anchors[i].anchorIndex = i;
}

const shotAnchors =
  anchors.filter(
    row =>
      row.shotObserved
  );

const noShotAnchors =
  anchors.filter(
    row =>
      !row.shotObserved
  );

const mixedTeamAnchors =
  anchors.filter(
    row =>
      row.mixedTeamRace
  );

console.log(
  `Shot anchors: ${shotAnchors.length}`
);

console.log(
  `No-shot anchors: ${noShotAnchors.length}`
);

console.log(
  `Mixed-team anchors: ${mixedTeamAnchors.length}`
);


// ============================================================
// MERGED REPLAY SCAN RANGES
// ============================================================

const replayRanges =
  mergeTickRanges(
    anchors.map(
      anchor => ({
        min:
          anchor.anchorTick -
          WIDE_SEARCH_TICKS,

        max:
          anchor.anchorTick +
          WIDE_SEARCH_TICKS
      })
    )
  );

console.log(
  `Merged scan ranges: ${replayRanges.length}`
);


// ============================================================
// CONTROLLER FIELD TRACKING
// ============================================================

const previousValueByControllerField =
  new Map();

const controllerFieldNames =
  new Set();

const fieldChangeCounts =
  new Map();

const numericDeltaEvents = [];

const rawDeltaExamples = [];

let controllerEntityEvents = 0;
let controllerEventsInsideRanges = 0;
let numericFieldObservations = 0;
let numericDeltaCount = 0;
let positiveDeltaCount = 0;
let negativeDeltaCount = 0;


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

    if (
      !tickInsideAnyRange(
        tick,
        replayRanges
      )
    ) {
      return;
    }

    for (
      const event
      of events ?? []
    ) {
      const entity =
        event.entity;

      if (
        !entity
      ) {
        continue;
      }

      const entityIndex =
        getEntityIndex(
          entity
        );

      if (
        entityIndex ===
        null
        ||
        !playerByControllerIndex.has(
          entityIndex
        )
      ) {
        continue;
      }

      controllerEntityEvents++;
      controllerEventsInsideRanges++;

      const player =
        playerByControllerIndex.get(
          entityIndex
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
        controllerFieldNames.add(
          fieldName
        );

        increment(
          fieldChangeCounts,
          fieldName
        );

        const currentValue =
          finite(
            safeGetField(
              entity,
              fieldName
            )
          );

        if (
          currentValue ===
          null
        ) {
          continue;
        }

        numericFieldObservations++;

        const key =
          `${entityIndex}|${fieldName}`;

        const previous =
          previousValueByControllerField.get(
            key
          ) ??
          null;

        previousValueByControllerField.set(
          key,
          {
            tick,

            value:
              currentValue
          }
        );

        if (
          !previous
          ||
          !Number.isFinite(
            previous.value
          )
        ) {
          continue;
        }

        const delta =
          currentValue -
          previous.value;

        if (
          delta ===
          0
        ) {
          continue;
        }

        numericDeltaCount++;

        if (
          delta >
          0
        ) {
          positiveDeltaCount++;

        } else {
          negativeDeltaCount++;
        }

        const deltaEvent = {
          tick,

          controllerEntityIndex:
            entityIndex,

          playerName:
            player.playerName,

          team:
            player.team,

          heroId:
            player.heroId,

          fieldName,

          previousTick:
            previous.tick,

          previousValue:
            previous.value,

          currentValue,

          delta,

          priorityNameMatch:
            FIELD_NAME_PRIORITY_REGEX.test(
              fieldName
            )
        };

        numericDeltaEvents.push(
          deltaEvent
        );

        if (
          rawDeltaExamples.length <
          MAX_RAW_DELTA_EXAMPLES
          &&
          (
            deltaEvent.priorityNameMatch
            ||
            delta >
            0
          )
        ) {
          rawDeltaExamples.push(
            deltaEvent
          );
        }
      }
    }
  }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
  '========================================='
);

console.log(
  'CITEMXP AWARD FIELD DISCOVERY V0.1'
);

console.log(
  '========================================='
);

console.log('');

await parser.parse(
  createReadStream(
    replayPath
  )
);

await parser.dispose();


// ============================================================
// INDEX DELTAS BY TICK
// ============================================================

numericDeltaEvents.sort(
  (
    a,
    b
  ) =>
    a.tick -
    b.tick
);

const deltaEventsByTick =
  new Map();

for (
  let i = 0;
  i < numericDeltaEvents.length;
  i++
) {
  pushMapArray(
    deltaEventsByTick,
    numericDeltaEvents[i].tick,
    i
  );
}


// ============================================================
// CORRELATE EACH ORB ANCHOR WITH CONTROLLER DELTAS
// ============================================================

for (
  const anchor
  of anchors
) {
  const nearby =
    collectNearbyDeltaEvents(
      anchor.anchorTick,
      SEARCH_BEFORE_TICKS,
      SEARCH_AFTER_TICKS
    );

  const wide =
    collectNearbyDeltaEvents(
      anchor.anchorTick,
      WIDE_SEARCH_TICKS,
      WIDE_SEARCH_TICKS
    );

  anchor.nearbyDeltaCount =
    nearby.length;

  anchor.nearbyPositiveDeltaCount =
    nearby.filter(
      row =>
        row.delta >
        0
    ).length;

  anchor.priorityNearbyDeltas =
    nearby
      .filter(
        row =>
          row.priorityNameMatch
      )
      .map(
        row =>
          compactDelta(
            row,
            anchor.anchorTick
          )
      );

  anchor.topNearbyPositiveDeltas =
    nearby
      .filter(
        row =>
          row.delta >
          0
      )
      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a.tick -
            anchor.anchorTick
          ) -
          Math.abs(
            b.tick -
            anchor.anchorTick
          )
          ||
          b.delta -
          a.delta
      )
      .slice(
        0,
        20
      )
      .map(
        row =>
          compactDelta(
            row,
            anchor.anchorTick
          )
      );

  anchor.widePriorityDeltaCount =
    wide.filter(
      row =>
        row.priorityNameMatch
    ).length;
}


// ============================================================
// FIELD CORRELATION SUMMARY
// ============================================================

const fieldStats =
  new Map();

for (
  const anchor
  of anchors
) {
  const nearby =
    collectNearbyDeltaEvents(
      anchor.anchorTick,
      SEARCH_BEFORE_TICKS,
      SEARCH_AFTER_TICKS
    );

  const seenFieldForAnchor =
    new Set();

  for (
    const deltaEvent
    of nearby
  ) {
    const key =
      deltaEvent.fieldName;

    if (
      !fieldStats.has(
        key
      )
    ) {
      fieldStats.set(
        key,
        createFieldStats(
          key
        )
      );
    }

    const stats =
      fieldStats.get(
        key
      );

    stats.deltaEvents++;

    if (
      deltaEvent.delta >
      0
    ) {
      stats.positiveDeltaEvents++;

    } else {
      stats.negativeDeltaEvents++;
    }

    stats.deltaValues.push(
      deltaEvent.delta
    );

    stats.tickOffsets.push(
      deltaEvent.tick -
      anchor.anchorTick
    );

    increment(
      stats.sourceTypes,
      anchor.sourceType
    );

    increment(
      stats.anchorLabels,
      anchor.correctedOutcomeLabel
    );

    increment(
      stats.playerTeams,
      String(
        deltaEvent.team ??
        'UNKNOWN'
      )
    );

    const relation =
      getDeltaTeamRelation(
        anchor,
        deltaEvent.team
      );

    increment(
      stats.teamRelations,
      relation
    );

    if (
      !seenFieldForAnchor.has(
        key
      )
    ) {
      seenFieldForAnchor.add(
        key
      );

      stats.anchorsWithField++;

      if (
        anchor.shotObserved
      ) {
        stats.shotAnchorsWithField++;

      } else {
        stats.noShotAnchorsWithField++;
      }
    }

    if (
      stats.examples.length <
      MAX_FIELD_EXAMPLES
    ) {
      stats.examples.push({
        episodeId:
          anchor.episodeId,

        sourceType:
          anchor.sourceType,

        correctedOutcomeLabel:
          anchor.correctedOutcomeLabel,

        anchorClock:
          anchor.startClock,

        anchorTick:
          anchor.anchorTick,

        anchorReason:
          anchor.anchorReason,

        orbTeam:
          anchor.orbTeam,

        provisionalWinnerTeam:
          anchor.provisionalWinnerTeam,

        expectedNoShotBeneficiaryTeam:
          anchor.expectedNoShotBeneficiaryTeam,

        delta:
          compactDelta(
            deltaEvent,
            anchor.anchorTick
          )
      });
    }
  }
}


// ============================================================
// CONVERT FIELD STATS
// ============================================================

const fieldSummaries =
  [
    ...fieldStats.values()
  ]
    .map(
      finalizeFieldStats
    )
    .sort(
      compareFieldSummaries
    );

const priorityNamedFields =
  fieldSummaries.filter(
    row =>
      row.priorityNameMatch
  );

const topPositiveCorrelatedFields =
  fieldSummaries
    .filter(
      row =>
        row.positiveDeltaEvents >
        0
    )
    .slice(
      0,
      100
    );


// ============================================================
// RESOLUTION-LEVEL TEAM DELTA DIAGNOSTICS
// ============================================================

const anchorTeamDiagnostics =
  anchors.map(
    anchor =>
      summarizeAnchorTeamDeltas(
        anchor
      )
  );

const shotSingleTeamDiagnostics =
  anchorTeamDiagnostics.filter(
    row =>
      row.shotObserved
      &&
      !row.mixedTeamRace
  );

const noShotTrooperDiagnostics =
  anchorTeamDiagnostics.filter(
    row =>
      !row.shotObserved
      &&
      row.sourceType ===
      'TROOPER_DEATH'
  );

const noShotUrnDiagnostics =
  anchorTeamDiagnostics.filter(
    row =>
      !row.shotObserved
      &&
      row.sourceType ===
      'URN_DELIVERY'
  );


// ============================================================
// VALIDATION
// ============================================================

const validation = {
  script62Passed:
    check(
      raceSummary
        ?.validation
        ?.pass,
      true,
      raceSummary
        ?.validation
        ?.pass ===
      true
    ),

  targetCountPreserved:
    check(
      targets.length,
      replayName ===
        'test'
        ? 1239
        : '>0',
      replayName ===
        'test'
        ? targets.length ===
          1239
        : targets.length >
          0
    ),

  shotCountPreserved:
    check(
      shotAnchors.length,
      replayName ===
        'test'
        ? 105
        : '>0',
      replayName ===
        'test'
        ? shotAnchors.length ===
          105
        : shotAnchors.length >
          0
    ),

  noShotCountPreserved:
    check(
      noShotAnchors.length,
      replayName ===
        'test'
        ? 1134
        : '>0',
      replayName ===
        'test'
        ? noShotAnchors.length ===
          1134
        : noShotAnchors.length >
          0
    ),

  controllerIdentitiesLoaded:
    check(
      playerByControllerIndex.size,
      '>=10',
      playerByControllerIndex.size >=
      10
    ),

  controllerEventsObserved:
    check(
      controllerEventsInsideRanges,
      '>0',
      controllerEventsInsideRanges >
      0
    ),

  numericControllerDeltasObserved:
    check(
      numericDeltaCount,
      '>0',
      numericDeltaCount >
      0
    )
};

const validationPass =
  Object
    .values(
      validation
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// INTERPRETATION
// ============================================================

const leadingNamedField =
  priorityNamedFields[0] ??
  null;

const interpretation =
  leadingNamedField
    ? 'CONTROLLER_CURRENCY_LIKE_FIELD_CANDIDATES_FOUND_FOR_DIRECT_AWARD_VALIDATION'
    : 'NO_OBVIOUSLY_NAMED_CURRENCY_FIELD_FOUND_USE_TOP_RESOLUTION_CORRELATED_NUMERIC_FIELDS';


// ============================================================
// SUMMARY
// ============================================================

const summary = {
  replay:
    replayName,

  version:
    'CITEMXP_AWARD_FIELD_DISCOVERY_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'AWARD_FIELD_DISCOVERY_COMPLETE'
      : 'DIAGNOSTIC_ONLY',

  purpose:
    [
      'Use Script 62 resolution timing to search player-controller telemetry for direct soul/currency/net-worth field changes.',
      'Do not assume a raw field name in advance.',
      'Keep shot outcomes, mixed-team races, and untouched expiry separate.',
      'Identify the strongest field candidate before calculating AUTO_AWARD or per-orb soul value.'
    ],

  raceModelInput:
    {
      script62Status:
        raceSummary?.status ??
        null,

      targets:
        anchors.length,

      shotAnchors:
        shotAnchors.length,

      noShotAnchors:
        noShotAnchors.length,

      mixedTeamAnchors:
        mixedTeamAnchors.length,

      anchorRule:
        {
          shot:
            'First CItemXP LEAVE/DELETE at or after first player-hit telemetry; falls back to first hit if needed.',

          noShot:
            'First CItemXP LEAVE/DELETE at or after attackable-end; falls back to attackable-end if needed.'
        }
    },

  controllerTelemetry:
    {
      players:
        playerIdentity.players,

      controllerEntityEvents,

      controllerEventsInsideRanges,

      discoveredChangedFields:
        controllerFieldNames.size,

      numericFieldObservations,

      numericDeltaCount,

      positiveDeltaCount,

      negativeDeltaCount,

      priorityNameRegex:
        String(
          FIELD_NAME_PRIORITY_REGEX
        ),

      changedFieldCounts:
        mapToSortedObject(
          fieldChangeCounts
        )
    },

  fieldDiscovery:
    {
      interpretation,

      leadingPriorityNamedField:
        leadingNamedField,

      priorityNamedFields,

      topPositiveCorrelatedFields
    },

  resolutionTeamDiagnostics:
    {
      note:
        'These diagnostics aggregate all numeric controller deltas in the local window. They are discovery evidence only until a specific currency field is identified.',

      shotSingleTeam:
        summarizeTeamDiagnosticSet(
          shotSingleTeamDiagnostics
        ),

      noShotTrooper:
        summarizeTeamDiagnosticSet(
          noShotTrooperDiagnostics
        ),

      noShotUrn:
        summarizeTeamDiagnosticSet(
          noShotUrnDiagnostics
        )
    },

  anchorExamples:
    {
      shot:
        anchors
          .filter(
            row =>
              row.shotObserved
          )
          .slice(
            0,
            MAX_ANCHOR_EXAMPLES
          )
          .map(
            compactAnchor
          ),

      noShot:
        anchors
          .filter(
            row =>
              !row.shotObserved
          )
          .slice(
            0,
            MAX_ANCHOR_EXAMPLES
          )
          .map(
            compactAnchor
          )
    },

  rawDeltaExamples,

  validation:
    {
      pass:
        validationPass,

      checks:
        validation
    },

  nextStep:
    leadingNamedField
      ? `Inspect ${leadingNamedField.fieldName} first. If its positive deltas align with orb resolution timing and expected team direction, build one-to-one/clustered award attribution from that exact field.`
      : 'Inspect topPositiveCorrelatedFields to identify the raw soul/net-worth field, then build exact award attribution.',

  output:
    summaryPath
};


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    summaryPath
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  summaryPath,
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
  'AWARD FIELD DISCOVERY RESULTS'
);

console.log(
  '-----------------------------'
);

console.log(
  `Controller events in ranges: ${controllerEventsInsideRanges.toLocaleString()}`
);

console.log(
  `Numeric deltas: ${numericDeltaCount.toLocaleString()}`
);

console.log(
  `Priority-named candidate fields: ${priorityNamedFields.length}`
);

console.log('');

if (
  priorityNamedFields.length >
  0
) {
  console.log(
    'PRIORITY-NAMED FIELDS'
  );

  console.log(
    '---------------------'
  );

  for (
    const row
    of priorityNamedFields.slice(
      0,
      30
    )
  ) {
    console.log(
      `${row.fieldName.padEnd(55)} anchors=${String(row.anchorsWithField).padStart(4)} +events=${String(row.positiveDeltaEvents).padStart(5)} medianDelta=${formatNumber(row.positiveDeltaValueSummary.median).padStart(10)} medianTickOffset=${formatNumber(row.tickOffsetSummary.median).padStart(7)}`
    );
  }

  console.log('');
}

console.log(
  'TOP POSITIVE CORRELATED FIELDS'
);

console.log(
  '------------------------------'
);

for (
  const row
  of topPositiveCorrelatedFields.slice(
    0,
    30
  )
) {
  console.log(
    `${row.fieldName.padEnd(55)} priority=${row.priorityNameMatch ? 'YES' : 'NO '} anchors=${String(row.anchorsWithField).padStart(4)} +events=${String(row.positiveDeltaEvents).padStart(5)} medianDelta=${formatNumber(row.positiveDeltaValueSummary.median).padStart(10)} medianTickOffset=${formatNumber(row.tickOffsetSummary.median).padStart(7)}`
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
    key,
    row
  ]
  of Object.entries(
    validation
  )
) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ${key.padEnd(38)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');

console.log(
  `OVERALL: ${validationPass ? 'PASS' : 'FAIL'}`
);

console.log(
  `Interpretation: ${interpretation}`
);

console.log('');

console.log(
  `Summary:\n${summaryPath}`
);

console.log('');


// ============================================================
// TARGET NORMALIZATION
// ============================================================

function normalizeOutcomeRow(
  row
) {
  const episode =
    row?.episode;

  if (
    !episode
  ) {
    return null;
  }

  const entityIndex =
    finite(
      episode.entityIndex
    );

  const startTick =
    finite(
      episode.startTick
    );

  const attackableEndTick =
    finite(
      episode.attackableEndTick
    );

  if (
    entityIndex ===
    null
    ||
    startTick ===
    null
    ||
    attackableEndTick ===
    null
  ) {
    return null;
  }

  return {
    sourceType:
      row.sourceType ??
      null,

    sourceId:
      row.sourceId ??
      null,

    episodeId:
      episode.episodeId ??
      null,

    entityIndex,

    subclassId:
      String(
        episode.subclassId ??
        'UNKNOWN'
      ),

    orbTeam:
      finite(
        episode.orbTeam
      ),

    startTick,

    startClock:
      episode.startClock ??
      null,

    attackableStartTick:
      finite(
        episode.attackableStartTick
      ),

    attackableEndTick,

    firstLeaveTick:
      finite(
        episode.firstLeaveTick
      ),

    firstPlayerDamage:
      normalizeDamageEvent(
        row.firstPlayerDamage
      ),

    allDamageEvents:
      (
        row.allDamageEvents ??
        []
      )
        .map(
          normalizeDamageEvent
        )
        .filter(
          Boolean
        ),

    lifecycleEvents:
      (
        row.lifecycleEvents ??
        []
      )
        .map(
          normalizeLifecycleEvent
        )
        .filter(
          Boolean
        ),

    urnBurst:
      row.urnBurst ??
      null
  };
}


function normalizeDamageEvent(
  row
) {
  if (
    !row
  ) {
    return null;
  }

  const tick =
    finite(
      row.tick
    );

  if (
    tick ===
    null
  ) {
    return null;
  }

  return {
    tick,

    attackerIndex:
      finite(
        row.attackerIndex
      ),

    attackerPlayer:
      row.attackerPlayer
        ? {
          playerName:
            row.attackerPlayer.playerName ??
            null,

          team:
            finite(
              row.attackerPlayer.team
            ),

          heroId:
            finite(
              row.attackerPlayer.heroId
            ),

          pawnEntityIndex:
            finite(
              row.attackerPlayer.pawnEntityIndex
            )
        }
        : null
  };
}


function normalizeLifecycleEvent(
  row
) {
  if (
    !row
  ) {
    return null;
  }

  const tick =
    finite(
      row.tick
    );

  if (
    tick ===
    null
  ) {
    return null;
  }

  return {
    tick,

    operation:
      String(
        row.operation ??
        'UNKNOWN'
      ).toUpperCase(),

    team:
      finite(
        row.team
      ),

    ownerEntity:
      serializeScalar(
        row.ownerEntity
      )
  };
}


// ============================================================
// RESOLUTION ANCHOR
// ============================================================

function buildResolutionAnchor(
  target
) {
  const playerDamageEvents =
    target.allDamageEvents.filter(
      row =>
        row.attackerPlayer
    );

  const shotObserved =
    playerDamageEvents.length >
    0;

  const distinctTeams =
    [
      ...new Set(
        playerDamageEvents
          .map(
            row =>
              finite(
                row
                  ?.attackerPlayer
                  ?.team
              )
          )
          .filter(
            isGameTeam
          )
      )
    ];

  const mixedTeamRace =
    distinctTeams.length >
    1;

  const firstHit =
    playerDamageEvents
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
      )[0] ??
    null;

  const firstHitTeam =
    finite(
      firstHit
        ?.attackerPlayer
        ?.team
    );

  const endEvents =
    target.lifecycleEvents
      .filter(
        row =>
          [
            'LEAVE',
            'DELETE'
          ].includes(
            row.operation
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
      );

  let anchorTick =
    null;

  let anchorReason =
    null;

  let lifecycleEndTick =
    null;

  if (
    shotObserved
  ) {
    const endAfterHit =
      endEvents.find(
        row =>
          row.tick >=
          firstHit.tick
      ) ??
      null;

    lifecycleEndTick =
      endAfterHit?.tick ??
      null;

    if (
      lifecycleEndTick !==
      null
    ) {
      anchorTick =
        lifecycleEndTick;

      anchorReason =
        'SHOT_THEN_LIFECYCLE_END';

    } else {
      anchorTick =
        firstHit.tick;

      anchorReason =
        'FIRST_PLAYER_HIT_FALLBACK';
    }

  } else {
    const endAfterAttackable =
      endEvents.find(
        row =>
          row.tick >=
          target.attackableEndTick
      ) ??
      null;

    lifecycleEndTick =
      endAfterAttackable?.tick ??
      null;

    if (
      lifecycleEndTick !==
      null
    ) {
      anchorTick =
        lifecycleEndTick;

      anchorReason =
        'NO_SHOT_POST_ATTACKABLE_LIFECYCLE_END';

    } else {
      anchorTick =
        target.attackableEndTick;

      anchorReason =
        'ATTACKABLE_END_FALLBACK';
    }
  }

  if (
    anchorTick ===
    null
  ) {
    return null;
  }

  const correctedOutcomeLabel =
    classifyCorrectedOutcome(
      target.sourceType,
      target.orbTeam,
      shotObserved,
      mixedTeamRace,
      firstHitTeam
    );

  let expectedNoShotBeneficiaryTeam =
    null;

  if (
    !shotObserved
    &&
    isGameTeam(
      target.orbTeam
    )
  ) {
    if (
      target.sourceType ===
      'TROOPER_DEATH'
    ) {
      expectedNoShotBeneficiaryTeam =
        oppositeTeam(
          target.orbTeam
        );

    } else if (
      target.sourceType ===
      'URN_DELIVERY'
    ) {
      expectedNoShotBeneficiaryTeam =
        target.orbTeam;
    }
  }

  return {
    sourceType:
      target.sourceType,

    sourceId:
      target.sourceId,

    episodeId:
      target.episodeId,

    entityIndex:
      target.entityIndex,

    subclassId:
      target.subclassId,

    orbTeam:
      target.orbTeam,

    startTick:
      target.startTick,

    startClock:
      target.startClock,

    attackableStartTick:
      target.attackableStartTick,

    attackableEndTick:
      target.attackableEndTick,

    shotObserved,

    mixedTeamRace,

    firstHitTick:
      firstHit?.tick ??
      null,

    firstHitPlayerName:
      firstHit
        ?.attackerPlayer
        ?.playerName ??
      null,

    firstHitTeam,

    lifecycleEndTick,

    anchorTick,

    anchorReason,

    correctedOutcomeLabel,

    provisionalWinnerTeam:
      shotObserved
        ? firstHitTeam
        : null,

    expectedNoShotBeneficiaryTeam,

    nearbyDeltaCount:
      0,

    nearbyPositiveDeltaCount:
      0,

    priorityNearbyDeltas:
      [],

    topNearbyPositiveDeltas:
      [],

    widePriorityDeltaCount:
      0
  };
}


function classifyCorrectedOutcome(
  sourceType,
  orbTeam,
  shotObserved,
  mixedTeamRace,
  firstHitTeam
) {
  if (
    !shotObserved
  ) {
    return 'NO_SHOT_UNRESOLVED';
  }

  if (
    !isGameTeam(
      orbTeam
    )
    ||
    !isGameTeam(
      firstHitTeam
    )
  ) {
    return 'SHOT_TEAM_UNRESOLVED';
  }

  const sameTeam =
    firstHitTeam ===
    orbTeam;

  let base =
    'SHOT_TEAM_UNRESOLVED';

  if (
    sourceType ===
    'TROOPER_DEATH'
  ) {
    base =
      sameTeam
        ? 'DENY'
        : 'SECURE';

  } else if (
    sourceType ===
    'URN_DELIVERY'
  ) {
    base =
      sameTeam
        ? 'CLAIM'
        : 'DENY';
  }

  return mixedTeamRace
    ? `FIRST_HIT_PROVISIONAL_${base}`
    : base;
}


// ============================================================
// PLAYER IDENTITY
// ============================================================

async function loadPlayerIdentity(
  path
) {
  const playerByControllerIndex =
    new Map();

  const playerByName =
    new Map();

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

    let row;

    try {
      row =
        JSON.parse(
          line
        );

    } catch {
      continue;
    }

    const controllerIndex =
      finite(
        row
          ?.controller
          ?.entityIndex
      );

    const playerName =
      row
        ?.controller
        ?.playerName ??
      null;

    if (
      controllerIndex ===
      null
      ||
      !playerName
    ) {
      continue;
    }

    const identity = {
      playerName,

      team:
        finite(
          row
            ?.controller
            ?.team
        ),

      heroId:
        finite(
          row
            ?.controller
            ?.heroId
        ),

      controllerEntityIndex:
        controllerIndex,

      pawnEntityIndex:
        finite(
          row
            ?.pawn
            ?.entityIndex
        )
    };

    if (
      !playerByControllerIndex.has(
        controllerIndex
      )
    ) {
      playerByControllerIndex.set(
        controllerIndex,
        identity
      );
    }

    if (
      !playerByName.has(
        playerName
      )
    ) {
      playerByName.set(
        playerName,
        identity
      );
    }
  }

  return {
    playerByControllerIndex,

    playerByName,

    players:
      [
        ...playerByName.values()
      ]
        .sort(
          (
            a,
            b
          ) =>
            a.team -
            b.team
            ||
            a.playerName.localeCompare(
              b.playerName
            )
        )
  };
}


// ============================================================
// FIELD STATS
// ============================================================

function createFieldStats(
  fieldName
) {
  return {
    fieldName,

    priorityNameMatch:
      FIELD_NAME_PRIORITY_REGEX.test(
        fieldName
      ),

    deltaEvents:
      0,

    positiveDeltaEvents:
      0,

    negativeDeltaEvents:
      0,

    anchorsWithField:
      0,

    shotAnchorsWithField:
      0,

    noShotAnchorsWithField:
      0,

    deltaValues:
      [],

    tickOffsets:
      [],

    sourceTypes:
      new Map(),

    anchorLabels:
      new Map(),

    playerTeams:
      new Map(),

    teamRelations:
      new Map(),

    examples:
      []
  };
}


function finalizeFieldStats(
  stats
) {
  return {
    fieldName:
      stats.fieldName,

    priorityNameMatch:
      stats.priorityNameMatch,

    deltaEvents:
      stats.deltaEvents,

    positiveDeltaEvents:
      stats.positiveDeltaEvents,

    negativeDeltaEvents:
      stats.negativeDeltaEvents,

    positiveRate:
      rate(
        stats.positiveDeltaEvents,
        stats.deltaEvents
      ),

    anchorsWithField:
      stats.anchorsWithField,

    anchorCoverage:
      rate(
        stats.anchorsWithField,
        anchors.length
      ),

    shotAnchorsWithField:
      stats.shotAnchorsWithField,

    shotAnchorCoverage:
      rate(
        stats.shotAnchorsWithField,
        shotAnchors.length
      ),

    noShotAnchorsWithField:
      stats.noShotAnchorsWithField,

    noShotAnchorCoverage:
      rate(
        stats.noShotAnchorsWithField,
        noShotAnchors.length
      ),

    deltaValueSummary:
      summarizeNumbers(
        stats.deltaValues
      ),

    positiveDeltaValueSummary:
      summarizeNumbers(
        stats.deltaValues.filter(
          value =>
            value >
            0
        )
      ),

    tickOffsetSummary:
      summarizeNumbers(
        stats.tickOffsets
      ),

    sourceTypes:
      mapToSortedObject(
        stats.sourceTypes
      ),

    anchorLabels:
      mapToSortedObject(
        stats.anchorLabels
      ),

    playerTeams:
      mapToSortedObject(
        stats.playerTeams
      ),

    teamRelations:
      mapToSortedObject(
        stats.teamRelations
      ),

    examples:
      stats.examples
  };
}


function compareFieldSummaries(
  a,
  b
) {
  if (
    a.priorityNameMatch !==
    b.priorityNameMatch
  ) {
    return a.priorityNameMatch
      ? -1
      : 1;
  }

  if (
    a.anchorsWithField !==
    b.anchorsWithField
  ) {
    return b.anchorsWithField -
      a.anchorsWithField;
  }

  if (
    a.positiveDeltaEvents !==
    b.positiveDeltaEvents
  ) {
    return b.positiveDeltaEvents -
      a.positiveDeltaEvents;
  }

  return a.fieldName.localeCompare(
    b.fieldName
  );
}


// ============================================================
// ANCHOR TEAM DIAGNOSTICS
// ============================================================

function summarizeAnchorTeamDeltas(
  anchor
) {
  const nearby =
    collectNearbyDeltaEvents(
      anchor.anchorTick,
      SEARCH_BEFORE_TICKS,
      SEARCH_AFTER_TICKS
    );

  const positive =
    nearby.filter(
      row =>
        row.delta >
        0
    );

  const byTeam =
    new Map();

  for (
    const row
    of positive
  ) {
    const team =
      String(
        row.team ??
        'UNKNOWN'
      );

    if (
      !byTeam.has(
        team
      )
    ) {
      byTeam.set(
        team,
        {
          eventCount:
            0,

          deltaSum:
            0,

          priorityNamedEventCount:
            0,

          priorityNamedDeltaSum:
            0
        }
      );
    }

    const bucket =
      byTeam.get(
        team
      );

    bucket.eventCount++;
    bucket.deltaSum +=
      row.delta;

    if (
      row.priorityNameMatch
    ) {
      bucket.priorityNamedEventCount++;
      bucket.priorityNamedDeltaSum +=
        row.delta;
    }
  }

  return {
    sourceType:
      anchor.sourceType,

    episodeId:
      anchor.episodeId,

    startClock:
      anchor.startClock,

    shotObserved:
      anchor.shotObserved,

    mixedTeamRace:
      anchor.mixedTeamRace,

    correctedOutcomeLabel:
      anchor.correctedOutcomeLabel,

    orbTeam:
      anchor.orbTeam,

    provisionalWinnerTeam:
      anchor.provisionalWinnerTeam,

    expectedNoShotBeneficiaryTeam:
      anchor.expectedNoShotBeneficiaryTeam,

    anchorTick:
      anchor.anchorTick,

    positiveDeltaEvents:
      positive.length,

    priorityNamedPositiveDeltaEvents:
      positive.filter(
        row =>
          row.priorityNameMatch
      ).length,

    byTeam:
      Object.fromEntries(
        byTeam
      )
  };
}


function summarizeTeamDiagnosticSet(
  rows
) {
  const withAnyPositive =
    rows.filter(
      row =>
        row.positiveDeltaEvents >
        0
    );

  const withPriorityPositive =
    rows.filter(
      row =>
        row.priorityNamedPositiveDeltaEvents >
        0
    );

  return {
    anchors:
      rows.length,

    anchorsWithAnyPositiveControllerDelta:
      withAnyPositive.length,

    anyPositiveCoverage:
      rate(
        withAnyPositive.length,
        rows.length
      ),

    anchorsWithPriorityNamedPositiveDelta:
      withPriorityPositive.length,

    priorityNamedPositiveCoverage:
      rate(
        withPriorityPositive.length,
        rows.length
      ),

    examples:
      rows
        .filter(
          row =>
            row.priorityNamedPositiveDeltaEvents >
            0
        )
        .slice(
          0,
          50
        )
  };
}


function getDeltaTeamRelation(
  anchor,
  deltaTeam
) {
  if (
    !isGameTeam(
      deltaTeam
    )
  ) {
    return 'DELTA_TEAM_UNKNOWN';
  }

  if (
    anchor.shotObserved
    &&
    isGameTeam(
      anchor.provisionalWinnerTeam
    )
  ) {
    return deltaTeam ===
      anchor.provisionalWinnerTeam
      ? 'DELTA_ON_SHOOTER_FIRST_HIT_TEAM'
      : 'DELTA_ON_OTHER_TEAM';
  }

  if (
    !anchor.shotObserved
    &&
    isGameTeam(
      anchor.expectedNoShotBeneficiaryTeam
    )
  ) {
    return deltaTeam ===
      anchor.expectedNoShotBeneficiaryTeam
      ? 'DELTA_ON_EXPECTED_AUTO_BENEFICIARY_TEAM'
      : 'DELTA_ON_OTHER_TEAM';
  }

  return 'DELTA_TEAM_RELATION_UNRESOLVED';
}


// ============================================================
// NEARBY DELTA COLLECTION
// ============================================================

function collectNearbyDeltaEvents(
  anchorTick,
  beforeTicks,
  afterTicks
) {
  const result = [];

  for (
    let tick =
      anchorTick -
      beforeTicks;

    tick <=
      anchorTick +
      afterTicks;

    tick++
  ) {
    for (
      const eventIndex
      of deltaEventsByTick.get(
        tick
      ) ?? []
    ) {
      result.push(
        numericDeltaEvents[
          eventIndex
        ]
      );
    }
  }

  return result;
}


function compactDelta(
  row,
  anchorTick
) {
  return {
    tick:
      row.tick,

    tickOffset:
      row.tick -
      anchorTick,

    secondsOffset:
      (
        row.tick -
        anchorTick
      ) /
      TICK_RATE,

    playerName:
      row.playerName,

    team:
      row.team,

    controllerEntityIndex:
      row.controllerEntityIndex,

    fieldName:
      row.fieldName,

    previousValue:
      row.previousValue,

    currentValue:
      row.currentValue,

    delta:
      row.delta,

    priorityNameMatch:
      row.priorityNameMatch
  };
}


function compactAnchor(
  anchor
) {
  return {
    sourceType:
      anchor.sourceType,

    sourceId:
      anchor.sourceId,

    episodeId:
      anchor.episodeId,

    startClock:
      anchor.startClock,

    orbTeam:
      anchor.orbTeam,

    correctedOutcomeLabel:
      anchor.correctedOutcomeLabel,

    shotObserved:
      anchor.shotObserved,

    mixedTeamRace:
      anchor.mixedTeamRace,

    firstHitPlayerName:
      anchor.firstHitPlayerName,

    firstHitTeam:
      anchor.firstHitTeam,

    attackableEndTick:
      anchor.attackableEndTick,

    lifecycleEndTick:
      anchor.lifecycleEndTick,

    anchorTick:
      anchor.anchorTick,

    anchorReason:
      anchor.anchorReason,

    expectedNoShotBeneficiaryTeam:
      anchor.expectedNoShotBeneficiaryTeam,

    nearbyDeltaCount:
      anchor.nearbyDeltaCount,

    nearbyPositiveDeltaCount:
      anchor.nearbyPositiveDeltaCount,

    priorityNearbyDeltas:
      anchor.priorityNearbyDeltas,

    topNearbyPositiveDeltas:
      anchor.topNearbyPositiveDeltas,

    widePriorityDeltaCount:
      anchor.widePriorityDeltaCount
  };
}


// ============================================================
// ENTITY HELPERS
// ============================================================

function safeGetChanges(
  event
) {
  try {
    return typeof event.getChanges ===
      'function'
      ? event.getChanges()
      : null;

  } catch {
    return null;
  }
}


function extractChangedFields(
  raw
) {
  if (
    raw ==
    null
  ) {
    return [];
  }

  if (
    raw instanceof Map
  ) {
    return [
      ...raw.keys()
    ].map(
      String
    );
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
            row =>
              Array.isArray(
                row
              )
                ? row[0]
                : row?.fieldName ??
                  row?.name ??
                  row?.key ??
                  row?.path
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

  return typeof raw ===
    'object'
    ? Object.keys(
      raw
    )
    : [];
}


function safeGetField(
  entity,
  fieldName
) {
  try {
    return typeof entity.getField ===
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
    return typeof entity.getIndex ===
      'function'
      ? finite(
        entity.getIndex()
      )
      : null;

  } catch {
    return null;
  }
}


// ============================================================
// RANGE HELPERS
// ============================================================

function mergeTickRanges(
  ranges
) {
  const sorted =
    ranges
      .filter(
        row =>
          Number.isFinite(
            row.min
          )
          &&
          Number.isFinite(
            row.max
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          a.min -
          b.min
      );

  if (
    sorted.length ===
    0
  ) {
    return [];
  }

  const merged = [
    {
      min:
        sorted[0].min,

      max:
        sorted[0].max
    }
  ];

  for (
    let i = 1;
    i < sorted.length;
    i++
  ) {
    const current =
      sorted[i];

    const last =
      merged[
        merged.length -
        1
      ];

    if (
      current.min <=
      last.max +
      1
    ) {
      last.max =
        Math.max(
          last.max,
          current.max
        );

    } else {
      merged.push({
        min:
          current.min,

        max:
          current.max
      });
    }
  }

  return merged;
}


function tickInsideAnyRange(
  tick,
  ranges
) {
  let low = 0;
  let high =
    ranges.length -
    1;

  while (
    low <=
    high
  ) {
    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );

    const range =
      ranges[mid];

    if (
      tick <
      range.min
    ) {
      high =
        mid -
        1;

    } else if (
      tick >
      range.max
    ) {
      low =
        mid +
        1;

    } else {
      return true;
    }
  }

  return false;
}


// ============================================================
// FILE HELPERS
// ============================================================

async function loadJsonl(
  path
) {
  const rows = [];

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

  return String(
    value
  );
}


function isGameTeam(
  value
) {
  return value ===
    2
    ||
    value ===
    3;
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


function increment(
  map,
  key
) {
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


function mapToSortedObject(
  map
) {
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
    )
  );
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

      p10:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p90:
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

    p10:
      percentile(
        clean,
        0.10
      ),

    p25:
      percentile(
        clean,
        0.25
      ),

    median:
      percentile(
        clean,
        0.50
      ),

    p75:
      percentile(
        clean,
        0.75
      ),

    p90:
      percentile(
        clean,
        0.90
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
      ) /
      clean.length
  };
}


function percentile(
  sorted,
  proportion
) {
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
    ) *
    proportion;

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
    return sorted[lower];
  }

  const weight =
    position -
    lower;

  return sorted[lower] *
    (
      1 -
      weight
    ) +
    sorted[upper] *
    weight;
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
    denominator ===
      0
  ) {
    return null;
  }

  return numerator /
    denominator;
}


function check(
  actual,
  expected,
  pass
) {
  return {
    actual,
    expected,
    pass
  };
}


function formatNumber(
  value
) {
  return Number.isFinite(
    value
  )
    ? value.toFixed(
      3
    )
    : 'n/a';
}