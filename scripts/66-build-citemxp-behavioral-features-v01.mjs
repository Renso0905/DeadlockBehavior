import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const replayName = process.argv[2] ?? 'test';
const TICK_RATE = 64;
const DEFAULT_MATCH_CLOCK_OFFSET_SECONDS = 30;
const TIME_BIN_SECONDS = 300;

const outputDir = resolve('output', replayName);
const inspectorDataDir = resolve('inspector', 'data', replayName);

const finalSummaryPath = resolve(
  outputDir,
  'citemxp_final_outcome_validation_v01.json'
);

const finalOutcomesPath = resolve(
  outputDir,
  'citemxp_final_outcomes_v01.jsonl'
);

const raceOutcomesPath = resolve(
  outputDir,
  'citemxp_corrected_shot_outcomes_v01.jsonl'
);

const playerStateSummaryPath = resolve(
  outputDir,
  'player_state_summary.json'
);

const behavioralV01Path = resolve(
  outputDir,
  'behavioral_metrics_v01.json'
);

const inspectorBasePath = resolve(
  'inspector',
  'data',
  `${replayName}.json`
);

const overlayV02Path = resolve(
  inspectorDataDir,
  'v02_overlays.json'
);

const actionStreamPath = resolve(
  outputDir,
  'citemxp_player_actions_v01.jsonl'
);

const metricsPath = resolve(
  outputDir,
  'citemxp_behavioral_metrics_v01.json'
);

const behavioralV02Path = resolve(
  outputDir,
  'behavioral_metrics_v02.json'
);

const inspectorEventsPath = resolve(
  outputDir,
  'citemxp_inspector_events_v01.json'
);

const overlayV03Path = resolve(
  inspectorDataDir,
  'v03_overlays.json'
);

for (const path of [
  finalSummaryPath,
  finalOutcomesPath,
  raceOutcomesPath
]) {
  if (!existsSync(path)) {
    throw new Error(`Missing required input:\n${path}`);
  }
}

const finalSummary = readJson(finalSummaryPath);

if (finalSummary?.validation?.pass !== true) {
  throw new Error(
    'Script 65 final-outcome validation did not PASS.'
  );
}

console.log(
  '\nLoading final CItemXP outcomes and shot-action telemetry...'
);

const finalRows = (
  await loadJsonl(finalOutcomesPath)
)
  .map(normalizeFinalRow)
  .filter(Boolean);

const raceRows = (
  await loadJsonl(raceOutcomesPath)
)
  .map(normalizeRaceRow)
  .filter(Boolean);

const finalByKey = uniqueIndex(
  finalRows,
  finalKey,
  'final outcome'
);

const raceByKey = uniqueIndex(
  raceRows,
  raceKey,
  'race outcome'
);

const playerStateSummary = existsSync(playerStateSummaryPath)
  ? readJson(playerStateSummaryPath)
  : null;

const baseBehavioral = existsSync(behavioralV01Path)
  ? readJson(behavioralV01Path)
  : null;

const inspectorBase = existsSync(inspectorBasePath)
  ? readJson(inspectorBasePath)
  : null;

const overlayV02 = existsSync(overlayV02Path)
  ? readJson(overlayV02Path)
  : null;

const matchClockOffsetSeconds = firstFinite(
  playerStateSummary?.matchClockOffsetSeconds,
  inspectorBase?.meta?.matchClockOffsetSeconds,
  DEFAULT_MATCH_CLOCK_OFFSET_SECONDS
);

const matchDurationSeconds = firstFinite(
  playerStateSummary?.finalMatchTimeSeconds,
  inspectorBase?.meta?.durationSeconds,
  overlayV02?.match?.durationSeconds,
  Math.max(
    ...finalRows.map(row =>
      demoTickToMatchSeconds(
        row.anchorTick,
        matchClockOffsetSeconds
      )
    )
  )
);

const roster = buildRoster(
  baseBehavioral,
  inspectorBase,
  raceRows
);

const actions = [];
const unmatchedFinalKeys = [];
const unmatchedRaceKeys = [];

for (const finalRow of finalRows) {
  const key = finalKey(finalRow);
  const raceRow = raceByKey.get(key);

  if (!raceRow) {
    unmatchedFinalKeys.push(key);
    continue;
  }

  const orderedHits =
    raceRow.raceAnalysis.orderedHits;

  const playerHitGroups =
    groupHitsByPlayer(orderedHits);

  for (const group of playerHitGroups) {
    actions.push(
      buildAction(
        finalRow,
        raceRow,
        group,
        matchClockOffsetSeconds
      )
    );
  }
}

for (const raceRow of raceRows) {
  const key = raceKey(raceRow);

  if (!finalByKey.has(key)) {
    unmatchedRaceKeys.push(key);
  }
}

actions.sort(
  (a, b) =>
    a.firstHitTick - b.firstHitTick ||
    a.playerName.localeCompare(b.playerName)
);

const events = finalRows
  .map(row =>
    buildInspectorEvent(
      row,
      matchClockOffsetSeconds
    )
  )
  .sort(
    (a, b) =>
      a.timeSeconds - b.timeSeconds ||
      a.entityIndex - b.entityIndex
  );

mkdirSync(outputDir, {
  recursive: true
});

mkdirSync(inspectorDataDir, {
  recursive: true
});

const actionWriter = createWriteStream(
  actionStreamPath,
  {
    encoding: 'utf8'
  }
);

for (const action of actions) {
  actionWriter.write(
    `${JSON.stringify(action)}\n`
  );
}

await finishWriter(actionWriter);

const actionsByPlayer = groupBy(
  actions,
  action => action.playerName
);

const playerMetrics = roster.map(player =>
  buildPlayerMetrics(
    player,
    actionsByPlayer.get(player.playerName) ?? [],
    matchDurationSeconds
  )
);

for (const [playerName, playerActions] of actionsByPlayer.entries()) {
  if (
    roster.some(
      player => player.playerName === playerName
    )
  ) {
    continue;
  }

  const firstAction = playerActions[0];

  playerMetrics.push(
    buildPlayerMetrics(
      {
        playerName,
        team: firstAction?.playerTeam ?? null,
        heroId: firstAction?.heroId ?? null,
        aliveSeconds: null,
        source: 'ACTION_STREAM_ONLY'
      },
      playerActions,
      matchDurationSeconds
    )
  );
}

playerMetrics.sort(
  (a, b) =>
    a.playerName.localeCompare(b.playerName)
);

const shotRows = finalRows.filter(
  row => row.shotObserved
);

const noShotRows = finalRows.filter(
  row => !row.shotObserved
);

const mixedFinalRows = finalRows.filter(
  row => row.mixedTeamRace
);

const winnerActions = actions.filter(
  action => action.resolutionCredit
);

const opposingRaceLosses = actions.filter(
  action => action.competingRaceLoss
);

const sameTeamFollowups = actions.filter(
  action => action.sameTeamFollowup
);

const resolvedFinalRows = finalRows.filter(
  row => row.finalOutcome.resolved
);

const unresolvedFinalRows = finalRows.filter(
  row => !row.finalOutcome.resolved
);

const checks = {
  script65Passed: check(
    finalSummary?.validation?.pass,
    true,
    finalSummary?.validation?.pass === true
  ),

  finalCountPreserved: check(
    finalRows.length,
    finalSummary?.counts?.targets,
    finalRows.length === finalSummary?.counts?.targets
  ),

  finalResolvedCountPreserved: check(
    resolvedFinalRows.length,
    finalSummary?.counts?.resolved,
    resolvedFinalRows.length ===
      finalSummary?.counts?.resolved
  ),

  raceRowsCoverFinalRows: check(
    raceRows.length - unmatchedRaceKeys.length,
    finalRows.length,
    unmatchedFinalKeys.length === 0 &&
      unmatchedRaceKeys.length === 0
  ),

  shotRowsHavePlayerActions: check(
    shotRows.filter(row =>
      actions.some(
        action =>
          action.episodeKey === finalKey(row)
      )
    ).length,
    shotRows.length,
    shotRows.every(row =>
      actions.some(
        action =>
          action.episodeKey === finalKey(row)
      )
    )
  ),

  noShotRowsHaveNoPlayerActions: check(
    noShotRows.filter(row =>
      actions.some(
        action =>
          action.episodeKey === finalKey(row)
      )
    ).length,
    0,
    noShotRows.every(row =>
      !actions.some(
        action =>
          action.episodeKey === finalKey(row)
      )
    )
  ),

  oneWinnerActionPerShot: check(
    winnerActions.length,
    shotRows.length,
    winnerActions.length === shotRows.length &&
      shotRows.every(
        row =>
          actions.filter(
            action =>
              action.episodeKey === finalKey(row) &&
              action.resolutionCredit
          ).length === 1
      )
  ),

  mixedTeamRaceCountPreserved: check(
    mixedFinalRows.length,
    finalSummary?.counts?.mixedTeamRacesPromoted,
    mixedFinalRows.length ===
      finalSummary?.counts?.mixedTeamRacesPromoted
  ),

  mixedRacesContainBothTeams: check(
    mixedFinalRows.filter(row => {
      const teams = new Set(
        actions
          .filter(
            action =>
              action.episodeKey === finalKey(row)
          )
          .map(action => action.playerTeam)
          .filter(isGameTeam)
      );

      return teams.size > 1;
    }).length,
    mixedFinalRows.length,
    mixedFinalRows.every(row => {
      const teams = new Set(
        actions
          .filter(
            action =>
              action.episodeKey === finalKey(row)
          )
          .map(action => action.playerTeam)
          .filter(isGameTeam)
      );

      return teams.size > 1;
    })
  ),

  eventCountPreserved: check(
    events.length,
    finalRows.length,
    events.length === finalRows.length
  ),

  eventTimesFinite: check(
    events.filter(
      event => Number.isFinite(event.timeSeconds)
    ).length,
    events.length,
    events.every(
      event => Number.isFinite(event.timeSeconds)
    )
  ),

  allActionPlayersInMetrics: check(
    [...actionsByPlayer.keys()].filter(name =>
      playerMetrics.some(
        player => player.playerName === name
      )
    ).length,
    actionsByPlayer.size,
    [...actionsByPlayer.keys()].every(name =>
      playerMetrics.some(
        player => player.playerName === name
      )
    )
  )
};

const validationPass = Object.values(checks).every(
  row => row.pass
);

const metrics = {
  replay: replayName,
  version: 'CITEMXP_BEHAVIORAL_METRICS_V01',
  canonical: false,

  status: validationPass
    ? 'DESCRIPTIVE_ACTION_FEATURES_READY'
    : 'DIAGNOSTIC_ONLY',

  interpretation: {
    scope:
      'Observed player attacks on validated Trooper and Soul Urn CItemXP episodes.',

    attemptDefinition:
      'One player-orb engagement, deduplicated across repeated damage messages from the same player.',

    resolutionCreditDefinition:
      'The player whose first observed hit received the validated shot outcome.',

    competingRaceLossDefinition:
      'A later hitter from the opposing team in a mixed-team race.',

    sameTeamFollowupDefinition:
      'A later hitter on the winning team; not treated as a competitive loss.',

    importantCaution:
      'No-shot episodes are team economy outcomes, not player choices. They are excluded from player action counts.',

    doNotInferYet: [
      'missed soul opportunity',
      'orb awareness',
      'decision quality',
      'attempt probability when an orb was visible',
      'secure or deny efficiency conditional on a true opportunity'
    ],

    reason:
      'Player-specific visibility, distance, line of sight, and competing action demands have not yet been joined to each orb window.'
  },

  sources: {
    finalOutcomeSummary: finalSummaryPath,
    finalOutcomes: finalOutcomesPath,
    raceOutcomes: raceOutcomesPath,

    playerStateSummary:
      existsSync(playerStateSummaryPath)
        ? playerStateSummaryPath
        : null,

    behavioralMetricsV01:
      existsSync(behavioralV01Path)
        ? behavioralV01Path
        : null,

    inspectorBase:
      existsSync(inspectorBasePath)
        ? inspectorBasePath
        : null,

    overlayV02:
      existsSync(overlayV02Path)
        ? overlayV02Path
        : null
  },

  timeModel: {
    tickRate: TICK_RATE,
    matchClockOffsetSeconds,
    matchDurationSeconds,
    timeBinSeconds: TIME_BIN_SECONDS
  },

  counts: {
    finalEpisodes: finalRows.length,
    resolvedEpisodes: resolvedFinalRows.length,
    unresolvedEpisodes: unresolvedFinalRows.length,
    shotEpisodes: shotRows.length,
    noShotEpisodes: noShotRows.length,
    playerActionRows: actions.length,

    damageMessages: actions.reduce(
      (sum, action) =>
        sum + action.damageMessageCount,
      0
    ),

    creditedFirstHits: winnerActions.length,
    competingRaceLosses: opposingRaceLosses.length,
    sameTeamFollowups: sameTeamFollowups.length,
    mixedTeamRaces: mixedFinalRows.length,
    players: playerMetrics.length
  },

  outcomeContext: {
    allFinalOutcomes: countObject(
      finalRows,
      row => row.finalOutcome.label
    ),

    shotOutcomes: countObject(
      shotRows,
      row => row.finalOutcome.label
    ),

    noShotOutcomes: countObject(
      noShotRows,
      row => row.finalOutcome.label
    ),

    finalOutcomesByWinnerTeam:
      buildTeamOutcomeSummary(finalRows),

    playerActionTypes: countObject(
      actions,
      action => action.actionType
    )
  },

  players: playerMetrics,

  validation: {
    pass: validationPass,
    checks,
    unmatchedFinalKeys:
      unmatchedFinalKeys.slice(0, 50),
    unmatchedRaceKeys:
      unmatchedRaceKeys.slice(0, 50)
  },

  nextStep: validationPass
    ? 'Load v03_overlays.json in the inspector and add CItemXP timeline filters, event panels, and player soul-action summaries.'
    : 'Resolve validation failures before using the action stream.',

  outputs: {
    metrics: metricsPath,
    playerActions: actionStreamPath,
    inspectorEvents: inspectorEventsPath,

    behavioralMetricsV02:
      baseBehavioral?.validation?.pass === true
        ? behavioralV02Path
        : null,

    overlayV03:
      overlayV02
        ? overlayV03Path
        : null
  }
};

writeFileSync(
  metricsPath,
  JSON.stringify(metrics, null, 2),
  'utf8'
);

const inspectorEventsDocument = {
  replay: replayName,
  version: 'CITEMXP_INSPECTOR_EVENTS_V01',
  canonical: false,
  matchClockOffsetSeconds,

  summary: {
    events: events.length,

    resolved: events.filter(
      event => event.resolved
    ).length,

    unresolved: events.filter(
      event => !event.resolved
    ).length,

    byOutcome: countObject(
      events,
      event => event.outcomeLabel
    ),

    bySource: countObject(
      events,
      event => event.sourceType
    )
  },

  events
};

writeFileSync(
  inspectorEventsPath,
  JSON.stringify(
    inspectorEventsDocument,
    null,
    2
  ),
  'utf8'
);

if (
  baseBehavioral?.validation?.pass === true &&
  Array.isArray(baseBehavioral.players)
) {
  const playerMetricByName = new Map(
    playerMetrics.map(
      player => [
        player.playerName,
        player
      ]
    )
  );

  const integrated = {
    ...baseBehavioral,

    version:
      'BEHAVIORAL_METRICS_V02',

    canonical:
      false,

    sources: {
      ...(baseBehavioral.sources ?? {}),

      citemxpFinalOutcomes:
        finalOutcomesPath,

      citemxpPlayerActions:
        actionStreamPath
    },

    citemxp: {
      status:
        metrics.status,

      counts:
        metrics.counts,

      outcomeContext:
        metrics.outcomeContext,

      interpretation:
        metrics.interpretation
    },

    validation: {
      pass:
        baseBehavioral.validation.pass &&
        validationPass,

      checks: {
        ...(
          baseBehavioral.validation.checks
          ?? {}
        ),

        citemxpBehavioralFeatures:
          check(
            validationPass,
            true,
            validationPass
          )
      }
    },

    players:
      baseBehavioral.players.map(
        player => ({
          ...player,

          soulOrbBehavior:
            playerMetricByName.get(
              player.playerName
            )
            ??
            emptyPlayerMetrics(player)
        })
      )
  };

  writeFileSync(
    behavioralV02Path,
    JSON.stringify(
      integrated,
      null,
      2
    ),
    'utf8'
  );
}

if (overlayV02) {
  const overlayV03 = {
    ...overlayV02,

    schemaVersion:
      3,

    inspectorVersion:
      '0.3',

    generatedFrom: {
      ...(overlayV02.generatedFrom ?? {}),

      citemxpFinalOutcomes:
        finalOutcomesPath,

      citemxpPlayerActions:
        actionStreamPath,

      citemxpBehavioralMetrics:
        metricsPath
    },

    summary: {
      ...(overlayV02.summary ?? {}),

      citemxp: {
        events:
          events.length,

        resolved:
          resolvedFinalRows.length,

        unresolved:
          unresolvedFinalRows.length,

        playerActionRows:
          actions.length,

        creditedFirstHits:
          winnerActions.length,

        byOutcome:
          countObject(
            finalRows,
            row => row.finalOutcome.label
          )
      }
    },

    citemxpEvents:
      events,

    citemxpPlayers:
      playerMetrics,

    validation: {
      ...(overlayV02.validation ?? {}),

      citemxpFeatureValidationPass:
        validationPass,

      citemxpEventCount:
        events.length,

      expectedCitemxpEventCount:
        finalRows.length,

      citemxpEventCountPass:
        events.length === finalRows.length
    }
  };

  writeFileSync(
    overlayV03Path,
    JSON.stringify(
      overlayV03,
      null,
      2
    ),
    'utf8'
  );
}

console.log('\n========================================');
console.log('CITEMXP BEHAVIORAL FEATURES V01');
console.log('========================================');

console.log(`\nFinal episodes: ${finalRows.length}`);
console.log(`Player action rows: ${actions.length}`);
console.log(`Damage messages: ${metrics.counts.damageMessages}`);
console.log(`Credited first hits: ${winnerActions.length}`);
console.log(`Competing race losses: ${opposingRaceLosses.length}`);
console.log(`Same-team followups: ${sameTeamFollowups.length}`);
console.log(`Players summarized: ${playerMetrics.length}`);

console.log('\nPLAYER CREDITED OUTCOMES');

for (const player of playerMetrics) {
  console.log(
    `${player.playerName.padEnd(28)} ` +
    `engagements=${String(player.totalOrbEngagements).padStart(3)} ` +
    `credited=${String(player.creditedFirstHits).padStart(3)} ` +
    `secure=${String(player.creditedOutcomes.SECURE ?? 0).padStart(2)} ` +
    `deny=${String(player.creditedOutcomes.DENY ?? 0).padStart(2)} ` +
    `claim=${String(player.creditedOutcomes.CLAIM ?? 0).padStart(2)}`
  );
}

console.log('\nVALIDATION');

for (const [key, row] of Object.entries(checks)) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ` +
    `${key.padEnd(38)} ` +
    `actual=${JSON.stringify(row.actual)} ` +
    `expected=${JSON.stringify(row.expected)}`
  );
}

console.log(
  `\nOVERALL: ${validationPass ? 'PASS' : 'FAIL'}`
);

console.log(
  `\nSummary:\n${metricsPath}`
);

console.log(
  `\nPlayer action stream:\n${actionStreamPath}`
);

console.log(
  `\nInspector event data:\n${inspectorEventsPath}`
);

if (baseBehavioral?.validation?.pass === true) {
  console.log(
    `\nIntegrated behavioral metrics:\n${behavioralV02Path}`
  );
} else {
  console.log(
    '\nIntegrated behavioral_metrics_v02.json skipped: ' +
    'behavioral_metrics_v01.json was absent or not PASS.'
  );
}

if (overlayV02) {
  console.log(
    `\nInspector v0.3 overlay data:\n${overlayV03Path}`
  );
} else {
  console.log(
    '\nInspector v0.3 overlay skipped: ' +
    'v02_overlays.json was not found.'
  );
}

console.log('');

function normalizeFinalRow(row) {
  const entityIndex =
    finite(row?.entityIndex);

  const anchorTick =
    finite(row?.anchorTick);

  if (
    !row ||
    entityIndex === null ||
    anchorTick === null
  ) {
    return null;
  }

  return {
    ...row,
    entityIndex,
    anchorTick,

    orbTeam:
      finite(row.orbTeam),

    firstHitTeam:
      finite(row.firstHitTeam),

    shotObserved:
      row.shotObserved === true,

    mixedTeamRace:
      row.mixedTeamRace === true,

    finalOutcome:
      row.finalOutcome
      ??
      {
        label: 'UNKNOWN',
        resolved: false,
        winnerTeam: null,
        winnerPlayerName: null
      },

    awardEvidence:
      row.awardEvidence
      ?? {}
  };
}

function normalizeRaceRow(row) {
  const episode =
    row?.episode;

  const entityIndex =
    finite(episode?.entityIndex);

  if (
    !row ||
    !episode ||
    entityIndex === null
  ) {
    return null;
  }

  return {
    ...row,

    episode: {
      ...episode,
      entityIndex
    },

    raceAnalysis: {
      ...(row.raceAnalysis ?? {}),

      orderedHits: (
        Array.isArray(
          row?.raceAnalysis?.orderedHits
        )
          ? row.raceAnalysis.orderedHits
          : []
      )
        .map(normalizeHit)
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.tick - b.tick
        )
    }
  };
}

function normalizeHit(hit) {
  const tick =
    finite(hit?.tick);

  const name =
    hit?.attackerPlayer?.playerName;

  if (
    tick === null ||
    !name
  ) {
    return null;
  }

  return {
    ...hit,
    tick,

    attackerPlayer: {
      ...hit.attackerPlayer,

      playerName:
        String(name),

      team:
        finite(
          hit.attackerPlayer.team
        ),

      heroId:
        finite(
          hit.attackerPlayer.heroId
        ),

      pawnEntityIndex:
        finite(
          hit.attackerPlayer.pawnEntityIndex
        )
    }
  };
}

function finalKey(row) {
  return [
    row.sourceType ?? 'UNKNOWN',
    row.sourceId ?? 'UNKNOWN',
    row.episodeId ?? 'UNKNOWN',
    row.entityIndex ?? 'UNKNOWN'
  ].join('|');
}

function raceKey(row) {
  return [
    row.sourceType ?? 'UNKNOWN',
    row.sourceId ?? 'UNKNOWN',
    row.episode?.episodeId ?? 'UNKNOWN',
    row.episode?.entityIndex ?? 'UNKNOWN'
  ].join('|');
}

function uniqueIndex(
  rows,
  keyFunction,
  label
) {
  const map = new Map();

  for (const row of rows) {
    const key =
      keyFunction(row);

    if (map.has(key)) {
      throw new Error(
        `Duplicate ${label} key: ${key}`
      );
    }

    map.set(
      key,
      row
    );
  }

  return map;
}

function groupHitsByPlayer(hits) {
  const map = new Map();

  hits.forEach(
    (hit, messageIndex) => {
      const name =
        hit.attackerPlayer.playerName;

      if (!map.has(name)) {
        map.set(
          name,
          {
            playerName:
              name,

            playerTeam:
              hit.attackerPlayer.team,

            heroId:
              hit.attackerPlayer.heroId,

            pawnEntityIndex:
              hit.attackerPlayer.pawnEntityIndex,

            firstMessageIndex:
              messageIndex,

            hits:
              []
          }
        );
      }

      map.get(name).hits.push(hit);
    }
  );

  return [...map.values()]
    .sort(
      (a, b) =>
        a.firstMessageIndex -
          b.firstMessageIndex
        ||
        a.playerName.localeCompare(
          b.playerName
        )
    );
}

function buildAction(
  finalRow,
  raceRow,
  group,
  offsetSeconds
) {
  const firstHit =
    group.hits[0];

  const lastHit =
    group.hits.at(-1);

  const resolutionCredit =
    group.playerName ===
    finalRow.finalOutcome.winnerPlayerName;

  const playerTeamWon =
    group.playerTeam ===
    finalRow.finalOutcome.winnerTeam;

  const competingRaceLoss =
    finalRow.mixedTeamRace &&
    !playerTeamWon;

  const sameTeamFollowup =
    !resolutionCredit &&
    playerTeamWon;

  const relationToOrbTeam =
    group.playerTeam === finalRow.orbTeam
      ? 'SAME_ORB_TEAM'
      : 'OPPOSING_ORB_TEAM';

  const actionType =
    actionTypeFor(
      finalRow.sourceType,
      relationToOrbTeam
    );

  const matchTimeSeconds =
    demoTickToMatchSeconds(
      firstHit.tick,
      offsetSeconds
    );

  return {
    schemaVersion: 1,
    canonical: false,

    episodeKey:
      finalKey(finalRow),

    sourceType:
      finalRow.sourceType,

    sourceId:
      finalRow.sourceId,

    episodeId:
      finalRow.episodeId,

    entityIndex:
      finalRow.entityIndex,

    orbTeam:
      finalRow.orbTeam,

    playerName:
      group.playerName,

    playerTeam:
      group.playerTeam,

    heroId:
      group.heroId,

    pawnEntityIndex:
      group.pawnEntityIndex,

    relationToOrbTeam,
    actionType,

    firstHitTick:
      firstHit.tick,

    lastHitTick:
      lastHit.tick,

    matchTimeSeconds,

    matchClock:
      formatClock(matchTimeSeconds),

    damageMessageCount:
      group.hits.length,

    firstMessageIndex:
      group.firstMessageIndex,

    resolutionCredit,
    playerTeamWon,
    competingRaceLoss,
    sameTeamFollowup,

    mixedTeamRace:
      finalRow.mixedTeamRace,

    creditedOutcome:
      resolutionCredit
        ? finalRow.finalOutcome.label
        : null,

    finalWinnerPlayerName:
      finalRow.finalOutcome.winnerPlayerName,

    finalWinnerTeam:
      finalRow.finalOutcome.winnerTeam,

    finalOutcomeLabel:
      finalRow.finalOutcome.label,

    finalOutcomeResolved:
      finalRow.finalOutcome.resolved === true,

    race: {
      distinctPlayers:
        finite(
          raceRow.raceAnalysis.distinctPlayers
        ),

      distinctTeams:
        finite(
          raceRow.raceAnalysis.distinctTeams
        ),

      damageMessageCount:
        finite(
          raceRow.raceAnalysis.damageMessageCount
        ),

      hitSpanTicks:
        finite(
          raceRow.raceAnalysis.hitSpanTicks
        ),

      hitSpanSeconds:
        finite(
          raceRow.raceAnalysis.hitSpanSeconds
        )
    }
  };
}

function actionTypeFor(
  sourceType,
  relation
) {
  if (sourceType === 'TROOPER_DEATH') {
    return relation === 'SAME_ORB_TEAM'
      ? 'TROOPER_DENY_ATTEMPT'
      : 'TROOPER_SECURE_ATTEMPT';
  }

  if (sourceType === 'URN_DELIVERY') {
    return relation === 'SAME_ORB_TEAM'
      ? 'URN_DENY_ATTEMPT'
      : 'URN_CLAIM_ATTEMPT';
  }

  return 'UNKNOWN_CITEMXP_ATTEMPT';
}

function buildInspectorEvent(
  row,
  offsetSeconds
) {
  const timeSeconds =
    demoTickToMatchSeconds(
      row.anchorTick,
      offsetSeconds
    );

  return {
    timeSeconds,

    matchClock:
      formatClock(timeSeconds),

    demoTick:
      row.anchorTick,

    demoClock:
      row.anchorClock ?? null,

    sourceType:
      row.sourceType,

    sourceId:
      row.sourceId,

    episodeId:
      row.episodeId,

    entityIndex:
      row.entityIndex,

    orbTeam:
      row.orbTeam,

    outcomeLabel:
      row.finalOutcome.label,

    outcomeFamily:
      row.finalOutcome.family,

    resolved:
      row.finalOutcome.resolved === true,

    winnerTeam:
      row.finalOutcome.winnerTeam,

    winnerPlayerName:
      row.finalOutcome.winnerPlayerName,

    confidence:
      row.finalOutcome.confidence,

    shotObserved:
      row.shotObserved,

    mixedTeamRace:
      row.mixedTeamRace,

    firstHitPlayerName:
      row.firstHitPlayerName,

    firstHitTeam:
      row.firstHitTeam,

    collisionWithin8Ticks:
      row.awardEvidence
        ?.collisionWithin8Ticks === true,

    winnerTeamPositiveDelta:
      finite(
        row.awardEvidence
          ?.winnerTeamPositiveDelta
      )
      ??
      0
  };
}

function buildRoster(
  base,
  inspector,
  races
) {
  const map = new Map();

  for (const player of base?.players ?? []) {
    if (!player?.playerName) {
      continue;
    }

    map.set(
      player.playerName,
      {
        playerName:
          player.playerName,

        team:
          finite(player.team),

        heroId:
          finite(player.heroId),

        aliveSeconds:
          finite(player.aliveSeconds),

        source:
          'BEHAVIORAL_METRICS_V01'
      }
    );
  }

  for (const frame of inspector?.frames ?? []) {
    for (const player of frame?.players ?? []) {
      if (
        !player?.name ||
        map.has(player.name)
      ) {
        continue;
      }

      map.set(
        player.name,
        {
          playerName:
            player.name,

          team:
            finite(player.team),

          heroId:
            finite(player.heroId),

          aliveSeconds:
            null,

          source:
            'INSPECTOR_BASE'
        }
      );
    }
  }

  for (const race of races) {
    for (
      const hit
      of race.raceAnalysis.orderedHits
    ) {
      const player =
        hit.attackerPlayer;

      if (
        !player?.playerName ||
        map.has(player.playerName)
      ) {
        continue;
      }

      map.set(
        player.playerName,
        {
          playerName:
            player.playerName,

          team:
            player.team,

          heroId:
            player.heroId,

          aliveSeconds:
            null,

          source:
            'RACE_ACTION_STREAM'
        }
      );
    }
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        a.playerName.localeCompare(
          b.playerName
        )
    );
}

function buildPlayerMetrics(
  player,
  rows,
  durationSeconds
) {
  const credited = rows.filter(
    row => row.resolutionCredit
  );

  const mixed = rows.filter(
    row => row.mixedTeamRace
  );

  const activeMinutes =
    Number.isFinite(player.aliveSeconds)
      ? player.aliveSeconds / 60
      : (
        Number.isFinite(durationSeconds)
          ? durationSeconds / 60
          : null
      );

  return {
    playerName:
      player.playerName,

    team:
      player.team,

    heroId:
      player.heroId,

    rosterSource:
      player.source,

    denominator: {
      activeMinutes,

      basis:
        Number.isFinite(player.aliveSeconds)
          ? 'ALIVE_MINUTES_FROM_BEHAVIORAL_METRICS_V01'
          : 'MATCH_DURATION_MINUTES_FALLBACK'
    },

    totalOrbEngagements:
      rows.length,

    totalDamageMessages:
      rows.reduce(
        (sum, row) =>
          sum + row.damageMessageCount,
        0
      ),

    creditedFirstHits:
      credited.length,

    creditedFirstHitsPerActiveMinute:
      rate(
        credited.length,
        activeMinutes
      ),

    resolutionCreditRateAmongEngagements:
      rate(
        credited.length,
        rows.length
      ),

    competingRaceLosses:
      rows.filter(
        row => row.competingRaceLoss
      ).length,

    sameTeamFollowups:
      rows.filter(
        row => row.sameTeamFollowup
      ).length,

    mixedTeamRaceEngagements:
      mixed.length,

    mixedTeamRaceWins:
      mixed.filter(
        row => row.resolutionCredit
      ).length,

    mixedTeamRaceLosses:
      mixed.filter(
        row => row.competingRaceLoss
      ).length,

    actionTypes:
      countObject(
        rows,
        row => row.actionType
      ),

    creditedOutcomes:
      countObject(
        credited,
        row => row.creditedOutcome
      ),

    sourceTypes:
      countObject(
        rows,
        row => row.sourceType
      ),

    timing: {
      firstActionSeconds:
        rows.length
          ? Math.min(
            ...rows.map(
              row => row.matchTimeSeconds
            )
          )
          : null,

      lastActionSeconds:
        rows.length
          ? Math.max(
            ...rows.map(
              row => row.matchTimeSeconds
            )
          )
          : null,

      timeBins:
        buildTimeBins(rows)
    }
  };
}

function emptyPlayerMetrics(player) {
  return buildPlayerMetrics(
    {
      playerName:
        player.playerName,

      team:
        finite(player.team),

      heroId:
        finite(player.heroId),

      aliveSeconds:
        finite(player.aliveSeconds),

      source:
        'BEHAVIORAL_METRICS_V01'
    },
    [],
    null
  );
}

function buildTimeBins(rows) {
  const bins = new Map();

  for (const row of rows) {
    const index =
      Math.max(
        0,
        Math.floor(
          row.matchTimeSeconds /
          TIME_BIN_SECONDS
        )
      );

    if (!bins.has(index)) {
      bins.set(
        index,
        []
      );
    }

    bins.get(index).push(row);
  }

  return [...bins.entries()]
    .sort(
      (a, b) =>
        a[0] - b[0]
    )
    .map(
      ([index, binRows]) => ({
        binIndex:
          index,

        startSeconds:
          index * TIME_BIN_SECONDS,

        endSeconds:
          (index + 1) * TIME_BIN_SECONDS,

        startClock:
          formatClock(
            index * TIME_BIN_SECONDS
          ),

        endClock:
          formatClock(
            (index + 1) * TIME_BIN_SECONDS
          ),

        engagements:
          binRows.length,

        creditedFirstHits:
          binRows.filter(
            row => row.resolutionCredit
          ).length,

        actionTypes:
          countObject(
            binRows,
            row => row.actionType
          ),

        creditedOutcomes:
          countObject(
            binRows.filter(
              row => row.resolutionCredit
            ),
            row => row.creditedOutcome
          )
      })
    );
}

function buildTeamOutcomeSummary(rows) {
  const teams = new Map();

  for (const row of rows) {
    const team =
      finite(
        row.finalOutcome.winnerTeam
      );

    const key =
      isGameTeam(team)
        ? String(team)
        : 'UNRESOLVED';

    if (!teams.has(key)) {
      teams.set(
        key,
        []
      );
    }

    teams.get(key).push(row);
  }

  return Object.fromEntries(
    [...teams.entries()]
      .map(
        ([team, teamRows]) => [
          team,
          {
            total:
              teamRows.length,

            outcomes:
              countObject(
                teamRows,
                row => row.finalOutcome.label
              ),

            shot:
              teamRows.filter(
                row => row.shotObserved
              ).length,

            automatic:
              teamRows.filter(
                row =>
                  row.finalOutcome.family ===
                  'AUTO_AWARD'
              ).length
          }
        ]
      )
  );
}

function groupBy(
  rows,
  keyFunction
) {
  const map = new Map();

  for (const row of rows) {
    const key =
      keyFunction(row);

    if (!map.has(key)) {
      map.set(
        key,
        []
      );
    }

    map.get(key).push(row);
  }

  return map;
}

function countObject(
  rows,
  keyFunction
) {
  const map = new Map();

  for (const row of rows) {
    const key =
      keyFunction(row)
      ??
      'UNKNOWN';

    map.set(
      key,
      (map.get(key) ?? 0) + 1
    );
  }

  return Object.fromEntries(
    [...map.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
          ||
          String(a[0]).localeCompare(
            String(b[0])
          )
      )
  );
}

async function loadJsonl(path) {
  const rows = [];

  const reader = createInterface({
    input: createReadStream(
      path,
      {
        encoding: 'utf8'
      }
    ),

    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(
        JSON.parse(line)
      );
    } catch (error) {
      throw new Error(
        `Invalid JSONL row in ${path}: ${error.message}`
      );
    }
  }

  return rows;
}

function readJson(path) {
  return JSON.parse(
    readFileSync(
      path,
      'utf8'
    )
  );
}

function demoTickToMatchSeconds(
  tick,
  offsetSeconds
) {
  return (
    tick / TICK_RATE
  ) - offsetSeconds;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const sign =
    seconds < 0
      ? '-'
      : '';

  const absolute =
    Math.abs(
      Math.floor(seconds)
    );

  const minutes =
    Math.floor(
      absolute / 60
    );

  const remainder =
    absolute % 60;

  return (
    `${sign}${minutes}:` +
    `${String(remainder).padStart(2, '0')}`
  );
}

function firstFinite(...values) {
  for (const value of values) {
    const number =
      finite(value);

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function finite(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function isGameTeam(value) {
  return (
    value === 2 ||
    value === 3
  );
}

function rate(
  numerator,
  denominator
) {
  return (
    Number.isFinite(numerator) &&
    Number.isFinite(denominator) &&
    denominator > 0
  )
    ? numerator / denominator
    : null;
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

function finishWriter(writer) {
  return new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {
      writer.on(
        'error',
        rejectPromise
      );

      writer.end(
        resolvePromise
      );
    }
  );
}