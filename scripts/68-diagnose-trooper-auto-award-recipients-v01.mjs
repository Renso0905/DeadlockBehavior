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
const HU_PER_METER = 39.37;
const DOCUMENTED_RANGE_METERS = 45;
const DOCUMENTED_RANGE_HU = DOCUMENTED_RANGE_METERS * HU_PER_METER;
const MAX_INTERPOLATION_GAP_SECONDS = 0.30;
const MAX_NEAREST_SAMPLE_DELTA_SECONDS = 0.15;
const THRESHOLD_MIN_HU = 1200;
const THRESHOLD_MAX_HU = 2600;
const THRESHOLD_STEP_HU = 10;
const MAX_EXAMPLES = 40;

const outputDir = resolve('output', replayName);
const finalSummaryPath = resolve(outputDir, 'citemxp_final_outcome_validation_v01.json');
const finalOutcomesPath = resolve(outputDir, 'citemxp_final_outcomes_v01.jsonl');
const deathStreamPath = resolve(outputDir, 'trooper_ground_soul_one_to_one_v01.jsonl');
const playerStatePath = resolve(outputDir, 'player_state.jsonl');

const unitPath = resolve(outputDir, 'trooper_auto_award_recipient_units_v01.jsonl');
const playerPath = resolve(outputDir, 'trooper_auto_award_player_summary_v01.jsonl');
const summaryPath = resolve(outputDir, 'trooper_auto_award_recipient_validation_v01.json');

for (const path of [
  finalSummaryPath,
  finalOutcomesPath,
  deathStreamPath,
  playerStatePath
]) {
  if (!existsSync(path)) {
    throw new Error(`Missing required input:\n${path}`);
  }
}

const finalSummary = readJson(finalSummaryPath);

if (finalSummary?.validation?.pass !== true) {
  throw new Error('Script 65 final-outcome validation did not PASS.');
}

console.log('\nLoading automatic Trooper awards...');

const finalRows = await loadJsonl(finalOutcomesPath);

const autoRows = finalRows
  .filter(row =>
    row?.sourceType === 'TROOPER_DEATH' &&
    row?.finalOutcome?.label === 'AUTO_AWARD_SECURE'
  )
  .sort((a, b) => finite(a.anchorTick) - finite(b.anchorTick));

console.log(`Automatic Trooper awards: ${autoRows.length.toLocaleString()}`);

console.log('Loading one-to-one Trooper deaths...');

const deathRows = (await loadJsonl(deathStreamPath))
  .map(normalizeDeath)
  .filter(Boolean);

const deathByKey = uniqueIndex(
  deathRows,
  row => row.deathKey,
  'Trooper death'
);

console.log(`Trooper deaths: ${deathRows.length.toLocaleString()}`);
console.log('Loading player-state timelines...');

const {
  timelines,
  playerStateRows
} = await loadPlayerTimelines(playerStatePath);

const roster = [...timelines.values()]
  .map(timeline => ({
    playerName: timeline.playerName,
    team: timeline.team
  }))
  .sort((a, b) =>
    a.team - b.team ||
    a.playerName.localeCompare(b.playerName)
  );

console.log(`Player-state rows: ${playerStateRows.toLocaleString()}`);
console.log(`Player timelines: ${timelines.size}`);
console.log('Reconstructing death-time and resolution-time proximity...');

const units = [];
const missingDeathKeys = [];

for (const row of autoRows) {
  const sourceId = row?.sourceId ?? null;
  const death = sourceId
    ? deathByKey.get(sourceId) ?? null
    : null;

  if (!death) {
    missingDeathKeys.push(sourceId);
    units.push(buildMissingDeathUnit(row));
    continue;
  }

  units.push(
    buildUnit(
      row,
      death,
      timelines,
      roster
    )
  );
}

units.sort((a, b) =>
  a.event.anchorTick - b.event.anchorTick
);

const cleanUnits = units.filter(
  unit => unit.event.collisionWithin8Ticks === false
);

const cleanComparable = cleanUnits.filter(
  unit => unit.geometry.playersWithDeathState > 0
);

const documentedDeath = evaluateThreshold(
  cleanComparable,
  'death',
  DOCUMENTED_RANGE_HU
);

const documentedResolution = evaluateThreshold(
  cleanComparable,
  'resolution',
  DOCUMENTED_RANGE_HU
);

const thresholdSearchDeath = searchThresholds(
  cleanComparable,
  'death'
);

const thresholdSearchResolution = searchThresholds(
  cleanComparable,
  'resolution'
);

const bestDeath = thresholdSearchDeath[0] ?? null;
const bestResolution = thresholdSearchResolution[0] ?? null;

const preferredMoment = choosePreferredMoment(
  documentedDeath,
  documentedResolution
);

const preferredDocumented =
  preferredMoment === 'death'
    ? documentedDeath
    : documentedResolution;

const preferredBest =
  preferredMoment === 'death'
    ? bestDeath
    : bestResolution;

for (const unit of units) {
  unit.assessment = assessUnit(
    unit,
    preferredMoment
  );
}

const playerSummaries = buildPlayerSummaries(
  units,
  roster,
  preferredMoment
);

const structuralChecks = {
  script65Passed: check(
    finalSummary?.validation?.pass,
    true,
    finalSummary?.validation?.pass === true
  ),

  autoAwardCountPreserved: check(
    autoRows.length,
    finalSummary?.counts?.trooperAutoAwardSupported,
    autoRows.length ===
      finalSummary?.counts?.trooperAutoAwardSupported
  ),

  everyAutoAwardJoinedToDeath: check(
    autoRows.length - missingDeathKeys.length,
    autoRows.length,
    missingDeathKeys.length === 0
  ),

  everyAutoAwardHasWinnerTeamDelta: check(
    units.filter(
      unit =>
        unit.observedAward.observedWinnerTeamDelta > 0
    ).length,
    units.length,
    units.every(
      unit =>
        unit.observedAward.observedWinnerTeamDelta > 0
    )
  ),

  playerPositionCoverage: check(
    ratio(
      units.reduce(
        (sum, unit) =>
          sum + unit.geometry.playersWithDeathState,
        0
      ),
      units.reduce(
        (sum, unit) =>
          sum + unit.geometry.winnerTeamRosterSize,
        0
      )
    ),
    '>=0.95',
    ratio(
      units.reduce(
        (sum, unit) =>
          sum + unit.geometry.playersWithDeathState,
        0
      ),
      units.reduce(
        (sum, unit) =>
          sum + unit.geometry.winnerTeamRosterSize,
        0
      )
    ) >= 0.95
  ),

  outputsAccountForEveryPlayer: check(
    playerSummaries.length,
    roster.length,
    playerSummaries.length === roster.length
  )
};

const structuralPass = Object
  .values(structuralChecks)
  .every(row => row.pass);

const geometryStrong =
  preferredDocumented.precision >= 0.90 &&
  preferredDocumented.recall >= 0.90 &&
  preferredDocumented.f1 >= 0.90;

const exactUnits = units.filter(
  unit =>
    unit.assessment.label === 'EXACT_RANGE_MATCH'
);

const rangeSupportedCredits = units.reduce(
  (sum, unit) =>
    sum +
    unit.assessment.rangeSupportedObservedRecipients,
  0
);

const rangeSupportedDelta = units.reduce(
  (sum, unit) =>
    sum +
    unit.assessment.rangeSupportedObservedDelta,
  0
);

const summary = {
  replay: replayName,

  version:
    'TROOPER_AUTO_AWARD_RECIPIENT_VALIDATION_V01',

  canonical: false,

  status:
    structuralPass && geometryStrong
      ? 'INDIVIDUAL_AUTO_AWARD_RECIPIENT_SIGNAL_SUPPORTED'
      : 'DIAGNOSTIC_ONLY',

  purpose: [
    'Attribute automatic Trooper-orb net-worth increases to named players.',
    'Test whether observed recipients match the documented 45 meter sharing range.',
    'Compare player geometry at the originating Trooper death and at the later orb resolution.',
    'Keep collision-affected events separate from clean recipient evidence.',
    'Do not treat raw net-worth-window totals as exact orb souls until geometry and collision tests support them.'
  ],

  definitions: {
    automaticTrooperAward:
      'A Script 65 AUTO_AWARD_SECURE Trooper outcome with no player hit on the orb.',

    observedRecipient:
      'A winner-team player with a positive m_iGoldNetWorth delta in the validated P0_P8 award window.',

    rangeSupportedRecipient:
      `An observed recipient reconstructed within ${DOCUMENTED_RANGE_METERS} meters of the source position at the preferred geometry moment.`,

    exactRangeMatch:
      'A collision-free event where the observed-recipient set exactly equals the in-range player set.',

    observedDeltaWarning:
      'An observed net-worth delta can contain batched or unrelated economy. Treat the summed delta as telemetry evidence, not yet a canonical exact-souls total.'
  },

  inputs: {
    finalOutcomeSummary: finalSummaryPath,
    finalOutcomeStream: finalOutcomesPath,
    trooperDeathStream: deathStreamPath,
    playerStateStream: playerStatePath
  },

  outputs: {
    recipientUnits: unitPath,
    playerSummaries: playerPath
  },

  constants: {
    tickRate: TICK_RATE,
    hammerUnitsPerMeter: HU_PER_METER,
    documentedRangeMeters:
      DOCUMENTED_RANGE_METERS,
    documentedRangeHammerUnits:
      DOCUMENTED_RANGE_HU,
    maximumInterpolationGapSeconds:
      MAX_INTERPOLATION_GAP_SECONDS,
    maximumNearestSampleDeltaSeconds:
      MAX_NEAREST_SAMPLE_DELTA_SECONDS
  },

  counts: {
    automaticTrooperAwards:
      units.length,

    collisionFreeAwards:
      cleanUnits.length,

    collisionAffectedAwards:
      units.length - cleanUnits.length,

    awardsJoinedToSourceDeath:
      units.length - missingDeathKeys.length,

    awardsMissingSourceDeath:
      missingDeathKeys.length,

    awardsWithAnyObservedRecipient:
      units.filter(
        unit =>
          unit.observedAward.observedRecipientCount > 0
      ).length,

    observedPlayerCredits:
      units.reduce(
        (sum, unit) =>
          sum +
          unit.observedAward.observedRecipientCount,
        0
      ),

    observedWinnerTeamNetWorthDelta:
      units.reduce(
        (sum, unit) =>
          sum +
          unit.observedAward.observedWinnerTeamDelta,
        0
      ),

    exactRangeMatchAwards:
      exactUnits.length,

    rangeSupportedPlayerCredits:
      rangeSupportedCredits,

    rangeSupportedObservedNetWorthDelta:
      rangeSupportedDelta,

    players:
      playerSummaries.length
  },

  geometryComparison: {
    cohort:
      'COLLISION_FREE_AUTO_AWARD_SECURE_EVENTS_WITH_RECONSTRUCTED_PLAYER_STATE',

    events:
      cleanComparable.length,

    preferredMoment,

    documented45m: {
      death:
        documentedDeath,

      resolution:
        documentedResolution
    },

    bestThreshold: {
      death:
        bestDeath,

      resolution:
        bestResolution
    },

    bestFiveThresholds: {
      death:
        thresholdSearchDeath.slice(0, 5),

      resolution:
        thresholdSearchResolution.slice(0, 5)
    },

    interpretation:
      geometryInterpretation(
        preferredMoment,
        preferredDocumented,
        preferredBest
      )
  },

  playerSummaries,

  examples: {
    exactRangeMatches:
      exactUnits
        .slice(0, MAX_EXAMPLES)
        .map(compactUnit),

    observedOutsidePreferredRange:
      units
        .filter(
          unit =>
            unit.assessment
              .observedOutsideRangePlayers
              .length > 0
        )
        .slice(0, MAX_EXAMPLES)
        .map(compactUnit),

    inRangeWithoutObservedDelta:
      units
        .filter(
          unit =>
            unit.assessment
              .inRangeWithoutObservedDeltaPlayers
              .length > 0
        )
        .slice(0, MAX_EXAMPLES)
        .map(compactUnit),

    missingDeathKeys:
      missingDeathKeys.slice(0, MAX_EXAMPLES)
  },

  validation: {
    pass:
      structuralPass,

    checks:
      structuralChecks,

    geometryConclusionPass:
      geometryStrong
  },

  nextStep:
    geometryStrong
      ? 'Promote clean range-supported player credits into the behavioral metrics and inspector, while keeping collision-affected credits explicitly provisional.'
      : 'Inspect the geometry mismatch examples before publishing per-player automatic-orb counts.'
};

mkdirSync(
  dirname(unitPath),
  {
    recursive: true
  }
);

const unitWriter = createWriteStream(
  unitPath,
  {
    encoding: 'utf8'
  }
);

for (const unit of units) {
  unitWriter.write(
    `${JSON.stringify(unit)}\n`
  );
}

await finishWriter(unitWriter);

const playerWriter = createWriteStream(
  playerPath,
  {
    encoding: 'utf8'
  }
);

for (const player of playerSummaries) {
  playerWriter.write(
    `${JSON.stringify(player)}\n`
  );
}

await finishWriter(playerWriter);

writeFileSync(
  summaryPath,
  JSON.stringify(summary, null, 2),
  'utf8'
);

console.log('\n==============================================');
console.log('Trooper Auto-Award Recipient Diagnostic v01');
console.log('==============================================');
console.log(`Automatic awards:       ${units.length.toLocaleString()}`);
console.log(`Collision-free:         ${cleanUnits.length.toLocaleString()}`);
console.log(`Exact range matches:    ${exactUnits.length.toLocaleString()}`);
console.log(`Preferred geometry:     ${preferredMoment.toUpperCase()}`);
console.log(`45m precision:          ${formatPercent(preferredDocumented.precision)}`);
console.log(`45m recall:             ${formatPercent(preferredDocumented.recall)}`);
console.log(`45m F1:                 ${formatPercent(preferredDocumented.f1)}`);
console.log('');

console.log('Per-player conservative automatic-orb credits');
console.log('(collision-free + observed net-worth delta + preferred 45m range)');

for (const player of playerSummaries) {
  console.log(
    `${player.playerName.padEnd(28)} ` +
    `credits=${String(
      player.conservativeRangeSupportedCreditEvents
    ).padStart(4)} ` +
    `observedDelta=${String(
      player.conservativeRangeSupportedObservedDelta
    ).padStart(7)} ` +
    `exact=${String(
      player.exactRangeMatchCreditEvents
    ).padStart(4)}`
  );
}

console.log('');

for (const [name, result] of Object.entries(structuralChecks)) {
  console.log(
    `${result.pass ? 'PASS' : 'FAIL'} ${name}: ` +
    `actual=${JSON.stringify(result.actual)} ` +
    `expected=${JSON.stringify(result.expected)}`
  );
}

console.log(
  `\nSTRUCTURAL VALIDATION: ${
    structuralPass
      ? 'PASS'
      : 'FAIL'
  }`
);

console.log(
  `GEOMETRY CONCLUSION:   ${
    geometryStrong
      ? 'SUPPORTED'
      : 'DIAGNOSTIC ONLY'
  }`
);

console.log(`\nSummary:\n${summaryPath}`);
console.log(`\nRecipient units:\n${unitPath}`);
console.log(`\nPlayer summaries:\n${playerPath}\n`);

function buildUnit(
  row,
  death,
  timelines,
  roster
) {
  const winnerTeam =
    finite(
      row?.finalOutcome?.winnerTeam
    );

  const anchorTick =
    finite(
      row?.anchorTick
    );

  const resolutionTimeSeconds =
    death.timeSeconds +
    (
      anchorTick -
      death.tick
    ) /
    TICK_RATE;

  const observedByPlayer =
    groupObservedDeltas(
      row,
      winnerTeam
    );

  const teamRoster =
    roster.filter(
      player =>
        player.team === winnerTeam
    );

  const players = [];

  for (const player of teamRoster) {
    const timeline =
      timelines.get(
        timelineKey(
          player.playerName,
          player.team
        )
      );

    const atDeath =
      estimateStateAtTime(
        timeline?.rows ?? [],
        death.timeSeconds
      );

    const atResolution =
      estimateStateAtTime(
        timeline?.rows ?? [],
        resolutionTimeSeconds
      );

    const observed =
      observedByPlayer.get(
        player.playerName
      ) ?? null;

    players.push({
      playerName:
        player.playerName,

      team:
        player.team,

      observedNetWorthCredit:
        Boolean(observed),

      observedDelta:
        observed?.totalDelta ?? 0,

      observedDeltaEvents:
        observed?.events ?? [],

      groundSoulVacuumTarget:
        player.playerName ===
        death.groundSoulVacuumTargetPlayerName,

      atDeath:
        attachDistance(
          atDeath,
          death.position
        ),

      atResolution:
        attachDistance(
          atResolution,
          death.position
        )
    });
  }

  players.sort(
    (a, b) =>
      a.playerName.localeCompare(
        b.playerName
      )
  );

  const observedRecipients =
    players.filter(
      player =>
        player.observedNetWorthCredit
    );

  return {
    schemaVersion: 1,
    canonical: false,

    event: {
      sourceId:
        row.sourceId ?? null,

      episodeId:
        row.episodeId ?? null,

      orbEntityIndex:
        finite(row.entityIndex),

      orbTeam:
        finite(row.orbTeam),

      winnerTeam,

      finalOutcomeLabel:
        row?.finalOutcome?.label ?? null,

      anchorTick,

      anchorClock:
        row.anchorClock ?? null,

      anchorReason:
        row.anchorReason ?? null,

      collisionWithin8Ticks:
        row?.awardEvidence
          ?.collisionWithin8Ticks === true,

      nearestOtherAnchorTicks:
        finite(
          row?.awardEvidence
            ?.nearestOtherAnchorTicks
        )
    },

    sourceDeath: {
      deathKey:
        death.deathKey,

      entityIndex:
        death.entityIndex,

      trooperTeam:
        death.team,

      baseType:
        death.baseType,

      variantLabel:
        death.variantLabel,

      lane:
        death.lane,

      tick:
        death.tick,

      timeSeconds:
        death.timeSeconds,

      clock:
        death.clock,

      position:
        death.position,

      groundSoulVacuumTargetPlayerName:
        death.groundSoulVacuumTargetPlayerName
    },

    timing: {
      deathToResolutionTicks:
        anchorTick - death.tick,

      deathToResolutionSeconds:
        (
          anchorTick -
          death.tick
        ) /
        TICK_RATE,

      resolutionTimeSeconds
    },

    observedAward: {
      fieldName:
        row?.awardEvidence
          ?.fieldName ?? null,

      windowId:
        row?.awardEvidence
          ?.windowId ?? null,

      reportedWinnerTeamPositiveDelta:
        finite(
          row?.awardEvidence
            ?.winnerTeamPositiveDelta
        ),

      observedWinnerTeamDelta:
        sum(
          observedRecipients.map(
            player =>
              player.observedDelta
          )
        ),

      observedRecipientCount:
        observedRecipients.length,

      observedRecipientNames:
        observedRecipients.map(
          player =>
            player.playerName
        )
    },

    geometry: {
      documentedRangeMeters:
        DOCUMENTED_RANGE_METERS,

      documentedRangeHammerUnits:
        DOCUMENTED_RANGE_HU,

      winnerTeamRosterSize:
        teamRoster.length,

      playersWithDeathState:
        players.filter(
          player =>
            player.atDeath
        ).length,

      playersWithResolutionState:
        players.filter(
          player =>
            player.atResolution
        ).length,

      players
    },

    assessment:
      null
  };
}

function buildMissingDeathUnit(row) {
  const winnerTeam =
    finite(
      row?.finalOutcome?.winnerTeam
    );

  const observedByPlayer =
    groupObservedDeltas(
      row,
      winnerTeam
    );

  return {
    schemaVersion: 1,
    canonical: false,

    event: {
      sourceId:
        row.sourceId ?? null,

      episodeId:
        row.episodeId ?? null,

      orbEntityIndex:
        finite(row.entityIndex),

      orbTeam:
        finite(row.orbTeam),

      winnerTeam,

      finalOutcomeLabel:
        row?.finalOutcome?.label ?? null,

      anchorTick:
        finite(row.anchorTick),

      anchorClock:
        row.anchorClock ?? null,

      anchorReason:
        row.anchorReason ?? null,

      collisionWithin8Ticks:
        row?.awardEvidence
          ?.collisionWithin8Ticks === true,

      nearestOtherAnchorTicks:
        finite(
          row?.awardEvidence
            ?.nearestOtherAnchorTicks
        )
    },

    sourceDeath:
      null,

    timing:
      null,

    observedAward: {
      fieldName:
        row?.awardEvidence
          ?.fieldName ?? null,

      windowId:
        row?.awardEvidence
          ?.windowId ?? null,

      reportedWinnerTeamPositiveDelta:
        finite(
          row?.awardEvidence
            ?.winnerTeamPositiveDelta
        ),

      observedWinnerTeamDelta:
        sum(
          [...observedByPlayer.values()]
            .map(
              value =>
                value.totalDelta
            )
        ),

      observedRecipientCount:
        observedByPlayer.size,

      observedRecipientNames:
        [...observedByPlayer.keys()]
          .sort()
    },

    geometry: {
      documentedRangeMeters:
        DOCUMENTED_RANGE_METERS,

      documentedRangeHammerUnits:
        DOCUMENTED_RANGE_HU,

      winnerTeamRosterSize:
        0,

      playersWithDeathState:
        0,

      playersWithResolutionState:
        0,

      players:
        []
    },

    assessment:
      null
  };
}

function assessUnit(
  unit,
  moment
) {
  const field =
    moment === 'death'
      ? 'atDeath'
      : 'atResolution';

  const players =
    unit.geometry.players;

  const inRange =
    players.filter(
      player =>
        player[field]
          ?.withinDocumentedRange === true
    );

  const observed =
    players.filter(
      player =>
        player.observedNetWorthCredit
    );

  const supported =
    observed.filter(
      player =>
        player[field]
          ?.withinDocumentedRange === true
    );

  const outside =
    observed.filter(
      player =>
        player[field] &&
        player[field]
          .withinDocumentedRange === false
    );

  const missing =
    inRange.filter(
      player =>
        !player.observedNetWorthCredit
    );

  const exact =
    unit.event.collisionWithin8Ticks === false &&
    observed.length > 0 &&
    outside.length === 0 &&
    missing.length === 0;

  let label =
    'DIAGNOSTIC_ONLY';

  if (exact) {
    label =
      'EXACT_RANGE_MATCH';

  } else if (
    unit.event.collisionWithin8Ticks === false &&
    supported.length > 0 &&
    outside.length === 0
  ) {
    label =
      'RANGE_SUPPORTED_PARTIAL_MATCH';

  } else if (
    unit.event.collisionWithin8Ticks === true &&
    supported.length > 0
  ) {
    label =
      'COLLISION_AFFECTED_RANGE_SUPPORT';

  } else if (
    outside.length > 0
  ) {
    label =
      'OBSERVED_OUTSIDE_RANGE';
  }

  return {
    label,

    preferredGeometryMoment:
      moment,

    collisionFree:
      unit.event.collisionWithin8Ticks === false,

    exactObservedSetEqualsRangeSet:
      exact,

    inRangePlayers:
      inRange.map(
        player =>
          player.playerName
      ),

    observedRecipients:
      observed.map(
        player =>
          player.playerName
      ),

    rangeSupportedObservedRecipients:
      supported.length,

    rangeSupportedObservedDelta:
      sum(
        supported.map(
          player =>
            player.observedDelta
        )
      ),

    rangeSupportedObservedPlayers:
      supported.map(
        player =>
          player.playerName
      ),

    observedOutsideRangePlayers:
      outside.map(
        player =>
          player.playerName
      ),

    inRangeWithoutObservedDeltaPlayers:
      missing.map(
        player =>
          player.playerName
      )
  };
}

function buildPlayerSummaries(
  units,
  roster,
  preferredMoment
) {
  const field =
    preferredMoment === 'death'
      ? 'atDeath'
      : 'atResolution';

  return roster.map(
    rosterPlayer => {
      const opportunities = [];

      for (const unit of units) {
        if (
          unit.event.winnerTeam !==
          rosterPlayer.team
        ) {
          continue;
        }

        const player =
          unit.geometry.players.find(
            item =>
              item.playerName ===
              rosterPlayer.playerName
          );

        if (player) {
          opportunities.push({
            unit,
            player
          });
        }
      }

      const observed =
        opportunities.filter(
          ({ player }) =>
            player.observedNetWorthCredit
        );

      const inRange =
        opportunities.filter(
          ({ player }) =>
            player[field]
              ?.withinDocumentedRange === true
        );

      const supported =
        observed.filter(
          ({ player }) =>
            player[field]
              ?.withinDocumentedRange === true
        );

      const conservative =
        supported.filter(
          ({ unit }) =>
            unit.event
              .collisionWithin8Ticks === false
        );

      const exact =
        conservative.filter(
          ({ unit }) =>
            unit.assessment?.label ===
            'EXACT_RANGE_MATCH'
        );

      const outside =
        observed.filter(
          ({ player }) =>
            player[field] &&
            player[field]
              .withinDocumentedRange === false
        );

      const collisionAffected =
        observed.filter(
          ({ unit }) =>
            unit.event
              .collisionWithin8Ticks === true
        );

      return {
        schemaVersion: 1,
        canonical: false,

        playerName:
          rosterPlayer.playerName,

        team:
          rosterPlayer.team,

        preferredGeometryMoment:
          preferredMoment,

        teamAutomaticAwardEvents:
          opportunities.length,

        documentedRangeEligibleEvents:
          inRange.length,

        observedNetWorthCreditEvents:
          observed.length,

        observedNetWorthDelta:
          sum(
            observed.map(
              ({ player }) =>
                player.observedDelta
            )
          ),

        rangeSupportedCreditEvents:
          supported.length,

        rangeSupportedObservedDelta:
          sum(
            supported.map(
              ({ player }) =>
                player.observedDelta
            )
          ),

        conservativeRangeSupportedCreditEvents:
          conservative.length,

        conservativeRangeSupportedObservedDelta:
          sum(
            conservative.map(
              ({ player }) =>
                player.observedDelta
            )
          ),

        exactRangeMatchCreditEvents:
          exact.length,

        exactRangeMatchObservedDelta:
          sum(
            exact.map(
              ({ player }) =>
                player.observedDelta
            )
          ),

        collisionAffectedObservedCreditEvents:
          collisionAffected.length,

        observedOutsideRangeEvents:
          outside.length,

        groundSoulVacuumTargetEvents:
          opportunities.filter(
            ({ player }) =>
              player.groundSoulVacuumTarget
          ).length,

        firstObservedCreditClock:
          observed[0]
            ?.unit
            ?.event
            ?.anchorClock ?? null,

        lastObservedCreditClock:
          observed.at(-1)
            ?.unit
            ?.event
            ?.anchorClock ?? null,

        interpretation:
          'Counts are recipient-side automatic-orb payout observations. Net-worth sums remain diagnostic because unrelated economy can batch into the same update window.'
      };
    }
  );
}

function groupObservedDeltas(
  row,
  winnerTeam
) {
  const result =
    new Map();

  const examples =
    Array.isArray(
      row?.awardEvidence
        ?.positiveDeltaExamples
    )
      ? row.awardEvidence
          .positiveDeltaExamples
      : [];

  for (const event of examples) {
    const playerName =
      event?.playerName
        ? String(event.playerName)
        : null;

    const team =
      finite(event?.team);

    const delta =
      finite(event?.delta);

    const offsetTicks =
      finite(event?.offsetTicks);

    if (
      !playerName ||
      team !== winnerTeam ||
      !(delta > 0)
    ) {
      continue;
    }

    if (
      offsetTicks !== null &&
      (
        offsetTicks < 0 ||
        offsetTicks > 8
      )
    ) {
      continue;
    }

    if (!result.has(playerName)) {
      result.set(
        playerName,
        {
          totalDelta: 0,
          events: []
        }
      );
    }

    const entry =
      result.get(playerName);

    entry.totalDelta +=
      delta;

    entry.events.push({
      tick:
        finite(event?.tick),

      offsetTicks,

      previousValue:
        finite(event?.previousValue),

      currentValue:
        finite(event?.currentValue),

      delta
    });
  }

  return result;
}

function evaluateThreshold(
  units,
  moment,
  thresholdHu
) {
  const field =
    moment === 'death'
      ? 'atDeath'
      : 'atResolution';

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let comparisons = 0;

  for (const unit of units) {
    for (
      const player
      of unit.geometry.players
    ) {
      const distance =
        finite(
          player?.[field]?.distance3D
        );

      if (distance === null) {
        continue;
      }

      comparisons++;

      const predicted =
        distance <= thresholdHu;

      const observed =
        player.observedNetWorthCredit;

      if (
        predicted &&
        observed
      ) {
        truePositive++;

      } else if (
        predicted &&
        !observed
      ) {
        falsePositive++;

      } else if (
        !predicted &&
        observed
      ) {
        falseNegative++;

      } else {
        trueNegative++;
      }
    }
  }

  const precision =
    ratio(
      truePositive,
      truePositive + falsePositive
    );

  const recall =
    ratio(
      truePositive,
      truePositive + falseNegative
    );

  const specificity =
    ratio(
      trueNegative,
      trueNegative + falsePositive
    );

  const accuracy =
    ratio(
      truePositive + trueNegative,
      comparisons
    );

  const f1 =
    precision + recall > 0
      ? (
        2 *
        precision *
        recall
      ) /
      (
        precision +
        recall
      )
      : 0;

  return {
    moment,

    thresholdHammerUnits:
      thresholdHu,

    thresholdMeters:
      thresholdHu /
      HU_PER_METER,

    comparisons,

    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,

    precision,
    recall,
    specificity,
    accuracy,
    f1
  };
}

function searchThresholds(
  units,
  moment
) {
  const rows = [];

  for (
    let threshold =
      THRESHOLD_MIN_HU;

    threshold <=
      THRESHOLD_MAX_HU;

    threshold +=
      THRESHOLD_STEP_HU
  ) {
    rows.push(
      evaluateThreshold(
        units,
        moment,
        threshold
      )
    );
  }

  return rows.sort(
    (a, b) =>
      b.f1 - a.f1 ||
      b.accuracy - a.accuracy ||
      Math.abs(
        a.thresholdHammerUnits -
        DOCUMENTED_RANGE_HU
      ) -
      Math.abs(
        b.thresholdHammerUnits -
        DOCUMENTED_RANGE_HU
      )
  );
}

function choosePreferredMoment(
  death,
  resolution
) {
  if (death.f1 !== resolution.f1) {
    return death.f1 > resolution.f1
      ? 'death'
      : 'resolution';
  }

  if (death.accuracy !== resolution.accuracy) {
    return death.accuracy > resolution.accuracy
      ? 'death'
      : 'resolution';
  }

  return 'death';
}

function geometryInterpretation(
  moment,
  documented,
  best
) {
  const strength =
    documented.f1 >= 0.90
      ? 'strongly'
      : documented.f1 >= 0.75
        ? 'partially'
        : 'weakly';

  return (
    `Observed collision-free recipient deltas ${strength} ` +
    `match the documented 45m range at ${moment}. ` +
    `Best searched threshold: ${formatNumber(
      best?.thresholdMeters
    )}m (F1 ${formatPercent(best?.f1)}).`
  );
}

function compactUnit(unit) {
  return {
    sourceId:
      unit.event.sourceId,

    episodeId:
      unit.event.episodeId,

    anchorClock:
      unit.event.anchorClock,

    winnerTeam:
      unit.event.winnerTeam,

    collisionWithin8Ticks:
      unit.event.collisionWithin8Ticks,

    observedRecipientNames:
      unit.observedAward
        .observedRecipientNames,

    observedWinnerTeamDelta:
      unit.observedAward
        .observedWinnerTeamDelta,

    assessment:
      unit.assessment
  };
}

function attachDistance(
  state,
  targetPosition
) {
  if (
    !state ||
    !targetPosition
  ) {
    return null;
  }

  const distance3D =
    getDistance3D(
      state.position,
      targetPosition
    );

  const distanceXY =
    getDistanceXY(
      state.position,
      targetPosition
    );

  return {
    method:
      state.method,

    sourceTimeDelta:
      state.sourceTimeDelta,

    position:
      state.position,

    distance3D,

    distanceXY,

    distanceMeters:
      distance3D /
      HU_PER_METER,

    withinDocumentedRange:
      distance3D <=
      DOCUMENTED_RANGE_HU
  };
}

async function loadPlayerTimelines(path) {
  const timelines =
    new Map();

  let playerStateRows =
    0;

  const reader =
    createInterface({
      input:
        createReadStream(
          path,
          {
            encoding: 'utf8'
          }
        ),

      crlfDelay:
        Infinity
    });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }

    playerStateRows++;

    let row;

    try {
      row =
        JSON.parse(line);

    } catch {
      continue;
    }

    const timeSeconds =
      finite(
        row?.matchTimeSeconds
      );

    const playerName =
      row?.controller?.playerName
        ? String(
          row.controller.playerName
        )
        : null;

    const team =
      finite(
        row?.controller?.team
      );

    if (
      timeSeconds === null ||
      !playerName ||
      !isGameTeam(team)
    ) {
      continue;
    }

    const key =
      timelineKey(
        playerName,
        team
      );

    if (!timelines.has(key)) {
      timelines.set(
        key,
        {
          playerName,
          team,
          rows: []
        }
      );
    }

    timelines
      .get(key)
      .rows
      .push({
        timeSeconds,

        alive:
          row?.controller?.alive === true,

        movementValid:
          row?.pawn
            ?.positionValidForMovement === true,

        position:
          normalizePosition(
            row?.pawn?.positionWorld
          )
      });
  }

  for (
    const timeline
    of timelines.values()
  ) {
    timeline.rows.sort(
      (a, b) =>
        a.timeSeconds -
        b.timeSeconds
    );
  }

  return {
    timelines,
    playerStateRows
  };
}

function estimateStateAtTime(
  rows,
  timeSeconds
) {
  if (
    !rows.length ||
    !Number.isFinite(timeSeconds)
  ) {
    return null;
  }

  const index =
    lowerBoundTime(
      rows,
      timeSeconds
    );

  const before =
    index > 0
      ? rows[index - 1]
      : null;

  const after =
    index < rows.length
      ? rows[index]
      : null;

  if (
    after &&
    Math.abs(
      after.timeSeconds -
      timeSeconds
    ) < 1e-9
  ) {
    return isUsablePlayerState(after)
      ? {
        method:
          'EXACT_SAMPLE',

        sourceTimeDelta:
          0,

        position:
          after.position
      }
      : null;
  }

  if (
    before &&
    after &&
    isUsablePlayerState(before) &&
    isUsablePlayerState(after)
  ) {
    const gap =
      after.timeSeconds -
      before.timeSeconds;

    if (
      gap > 0 &&
      gap <=
        MAX_INTERPOLATION_GAP_SECONDS &&
      before.timeSeconds <=
        timeSeconds &&
      after.timeSeconds >=
        timeSeconds
    ) {
      const proportion =
        (
          timeSeconds -
          before.timeSeconds
        ) /
        gap;

      return {
        method:
          'LINEAR_INTERPOLATION',

        sourceTimeDelta:
          Math.min(
            Math.abs(
              timeSeconds -
              before.timeSeconds
            ),
            Math.abs(
              after.timeSeconds -
              timeSeconds
            )
          ),

        position: {
          x:
            interpolate(
              before.position.x,
              after.position.x,
              proportion
            ),

          y:
            interpolate(
              before.position.y,
              after.position.y,
              proportion
            ),

          z:
            interpolate(
              before.position.z,
              after.position.z,
              proportion
            )
        }
      };
    }
  }

  const nearest =
    [before, after]
      .filter(isUsablePlayerState)
      .map(row => ({
        row,

        delta:
          Math.abs(
            row.timeSeconds -
            timeSeconds
          )
      }))
      .sort(
        (a, b) =>
          a.delta - b.delta
      )[0] ?? null;

  return (
    nearest &&
    nearest.delta <=
      MAX_NEAREST_SAMPLE_DELTA_SECONDS
  )
    ? {
      method:
        'NEAREST_SAMPLE',

      sourceTimeDelta:
        nearest.delta,

      position:
        nearest.row.position
    }
    : null;
}

function normalizeDeath(row) {
  const deathKey =
    row?.deathKey
      ? String(row.deathKey)
      : null;

  const entityIndex =
    finite(
      row?.trooper?.entityIndex
    );

  const team =
    finite(
      row?.trooper?.team
    );

  const tick =
    finite(
      row?.timing?.tick
    );

  const timeSeconds =
    finite(
      row?.timing?.timeSeconds
    );

  const position =
    normalizePosition(
      row?.trooper?.position
    );

  if (
    !deathKey ||
    entityIndex === null ||
    !isGameTeam(team) ||
    tick === null ||
    timeSeconds === null ||
    !position
  ) {
    return null;
  }

  return {
    deathKey,
    entityIndex,
    team,

    baseType:
      row?.trooper?.baseType ??
      'UNKNOWN',

    variantLabel:
      row?.trooper?.variantLabel ??
      'UNKNOWN',

    lane:
      finite(
        row?.trooper?.lane
      ),

    tick,
    timeSeconds,

    clock:
      row?.timing?.clock ??
      formatClock(timeSeconds),

    position,

    groundSoulVacuumTargetPlayerName:
      row?.groundSoul
        ?.vacuumTargetPlayer
        ?.playerName
        ? String(
          row.groundSoul
            .vacuumTargetPlayer
            .playerName
        )
        : null
  };
}

async function loadJsonl(path) {
  const rows = [];

  const reader =
    createInterface({
      input:
        createReadStream(
          path,
          {
            encoding: 'utf8'
          }
        ),

      crlfDelay:
        Infinity
    });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(
        JSON.parse(line)
      );

    } catch {
      // Ignore malformed rows.
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

function uniqueIndex(
  rows,
  keyFunction,
  label
) {
  const map =
    new Map();

  for (const row of rows) {
    const key =
      keyFunction(row);

    if (!key) {
      continue;
    }

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

function lowerBoundTime(
  rows,
  timeSeconds
) {
  let low = 0;
  let high = rows.length;

  while (low < high) {
    const middle =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );

    if (
      rows[middle].timeSeconds <
      timeSeconds
    ) {
      low =
        middle + 1;

    } else {
      high =
        middle;
    }
  }

  return low;
}

function isUsablePlayerState(row) {
  return Boolean(
    row &&
    row.alive === true &&
    row.movementValid === true &&
    row.position
  );
}

function normalizePosition(value) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return null;
  }

  const x =
    finite(value.x);

  const y =
    finite(value.y);

  const z =
    finite(value.z) ?? 0;

  if (
    x === null ||
    y === null
  ) {
    return null;
  }

  return {
    x,
    y,
    z
  };
}

function getDistance3D(a, b) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y,
    a.z - b.z
  );
}

function getDistanceXY(a, b) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  );
}

function interpolate(
  a,
  b,
  proportion
) {
  return (
    a +
    (
      b -
      a
    ) *
    proportion
  );
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

function timelineKey(
  playerName,
  team
) {
  return `${playerName}|${team}`;
}

function sum(values) {
  return values.reduce(
    (total, value) =>
      total +
      (
        finite(value) ??
        0
      ),
    0
  );
}

function ratio(
  numerator,
  denominator
) {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function check(
  actual,
  expected,
  pass
) {
  return {
    actual,
    expected,
    pass: Boolean(pass)
  };
}

function formatNumber(
  value,
  digits = 2
) {
  return Number.isFinite(value)
    ? Number(
      value.toFixed(digits)
    ).toString()
    : 'n/a';
}

function formatPercent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : 'n/a';
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const whole =
    Math.max(
      0,
      Math.floor(seconds)
    );

  return (
    `${Math.floor(whole / 60)}:` +
    `${String(whole % 60).padStart(2, '0')}`
  );
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

      writer.on(
        'finish',
        resolvePromise
      );

      writer.end();
    }
  );
}