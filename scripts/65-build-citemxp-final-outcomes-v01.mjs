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

const script62SummaryPath = resolve(
  'output', replayName, 'citemxp_race_resolution_validation_v01.json'
);
const script64SummaryPath = resolve(
  'output', replayName, 'citemxp_award_resolution_validation_v01.json'
);
const awardUnitsPath = resolve(
  'output', replayName, 'citemxp_award_resolution_units_v01.jsonl'
);
const finalOutcomesPath = resolve(
  'output', replayName, 'citemxp_final_outcomes_v01.jsonl'
);
const summaryPath = resolve(
  'output', replayName, 'citemxp_final_outcome_validation_v01.json'
);

for (const path of [script62SummaryPath, script64SummaryPath, awardUnitsPath]) {
  if (!existsSync(path)) throw new Error(`Missing required input:\n${path}`);
}

const script62 = JSON.parse(readFileSync(script62SummaryPath, 'utf8'));
const script64 = JSON.parse(readFileSync(script64SummaryPath, 'utf8'));

if (script62?.validation?.pass !== true) {
  throw new Error('Script 62 race-resolution validation did not PASS.');
}
if (script64?.validation?.pass !== true) {
  throw new Error('Script 64 award-resolution validation did not PASS.');
}

console.log('\nLoading Script 64 per-orb award units...');
const units = (await loadJsonl(awardUnitsPath)).map(normalizeUnit).filter(Boolean);

const controlRows = units.filter(row =>
  row.shotObserved &&
  !row.mixedTeamRace &&
  row.bestMeasurement?.fieldName === 'm_iGoldNetWorth' &&
  Number.isFinite(row.bestMeasurement?.expectedPositiveDelta) &&
  row.bestMeasurement.expectedPositiveDelta > 0
);

if (!controlRows.length) {
  throw new Error('No non-mixed known-shot controls with m_iGoldNetWorth evidence.');
}

// The weakest directly observed winning-team signal among the 100 clean shot
// controls becomes the conservative evidence floor for untouched orbs.
const awardTeamDeltaThreshold = Math.min(
  ...controlRows.map(row => row.bestMeasurement.expectedPositiveDelta)
);

const finalRows = units.map(row => classifyFinalOutcome(row, awardTeamDeltaThreshold));
const trooperRows = finalRows.filter(row => row.sourceType === 'TROOPER_DEATH');
const urnRows = finalRows.filter(row => row.sourceType === 'URN_DELIVERY');
const shotRows = finalRows.filter(row => row.shotObserved);
const noShotRows = finalRows.filter(row => !row.shotObserved);
const resolvedRows = finalRows.filter(row => row.finalOutcome.resolved);
const unresolvedRows = finalRows.filter(row => !row.finalOutcome.resolved);

mkdirSync(dirname(summaryPath), { recursive: true });
const writer = createWriteStream(finalOutcomesPath, { encoding: 'utf8' });
for (const row of finalRows) writer.write(`${JSON.stringify(row)}\n`);
await finishWriter(writer);

const trooperShotSame = shotRows.filter(row =>
  row.sourceType === 'TROOPER_DEATH' && row.firstHitTeam === row.orbTeam
);
const trooperShotOpposing = shotRows.filter(row =>
  row.sourceType === 'TROOPER_DEATH' && row.firstHitTeam !== row.orbTeam
);
const urnShotSame = shotRows.filter(row =>
  row.sourceType === 'URN_DELIVERY' && row.firstHitTeam === row.orbTeam
);
const urnShotOpposing = shotRows.filter(row =>
  row.sourceType === 'URN_DELIVERY' && row.firstHitTeam !== row.orbTeam
);
const mixedRows = shotRows.filter(row => row.mixedTeamRace);
const trooperNoShot = noShotRows.filter(row => row.sourceType === 'TROOPER_DEATH');
const urnNoShot = noShotRows.filter(row => row.sourceType === 'URN_DELIVERY');
const supportedTrooperAuto = trooperNoShot.filter(row => row.finalOutcome.resolved);
const supportedUrnAuto = urnNoShot.filter(row => row.finalOutcome.resolved);

const checks = {
  script62Passed: check(script62?.validation?.pass, true, script62?.validation?.pass === true),
  script64Passed: check(script64?.validation?.pass, true, script64?.validation?.pass === true),
  targetCountPreserved: check(
    finalRows.length,
    script64?.counts?.targets,
    finalRows.length === script64?.counts?.targets
  ),
  sourceCountsPreserved: check(
    { trooper: trooperRows.length, urn: urnRows.length },
    {
      trooper: script64?.counts?.trooperTargets,
      urn: script64?.counts?.urnTargets
    },
    trooperRows.length === script64?.counts?.trooperTargets &&
      urnRows.length === script64?.counts?.urnTargets
  ),
  shotCountsPreserved: check(
    { shot: shotRows.length, noShot: noShotRows.length },
    {
      shot: script64?.counts?.shotTargets,
      noShot: script64?.counts?.noShotTargets
    },
    shotRows.length === script64?.counts?.shotTargets &&
      noShotRows.length === script64?.counts?.noShotTargets
  ),
  selectedTelemetryPreserved: check(
    [...new Set(units.map(row =>
      `${row.selectedFingerprint?.fieldName ?? 'NONE'}:${row.selectedFingerprint?.window?.id ?? 'NONE'}`
    ))],
    ['m_iGoldNetWorth:P0_P8'],
    units.every(row =>
      row.selectedFingerprint?.fieldName === 'm_iGoldNetWorth' &&
      row.selectedFingerprint?.window?.id === 'P0_P8'
    )
  ),
  cleanControlsCalibrated: check(
    controlRows.length,
    script64?.counts?.highConfidenceKnownShotControls,
    controlRows.length === script64?.counts?.highConfidenceKnownShotControls
  ),
  everyShotWinnerHasNetWorthSignal: check(
    shotRows.filter(row => row.awardEvidence.shooterPositiveDelta > 0).length,
    shotRows.length,
    shotRows.every(row => row.awardEvidence.shooterPositiveDelta > 0)
  ),
  trooperSameTeamShotsIncrementDenies: check(
    trooperShotSame.filter(row => row.awardEvidence.shooterDenyDelta > 0).length,
    trooperShotSame.length,
    trooperShotSame.every(row => row.awardEvidence.shooterDenyDelta > 0)
  ),
  trooperOpposingTeamShotsDoNotIncrementDenies: check(
    trooperShotOpposing.filter(row => row.awardEvidence.shooterDenyDelta > 0).length,
    0,
    trooperShotOpposing.every(row => row.awardEvidence.shooterDenyDelta === 0)
  ),
  urnSameTeamShotsIncrementDenies: check(
    urnShotSame.filter(row => row.awardEvidence.shooterDenyDelta > 0).length,
    urnShotSame.length,
    urnShotSame.every(row => row.awardEvidence.shooterDenyDelta > 0)
  ),
  urnOpposingTeamShotsDoNotIncrementDenies: check(
    urnShotOpposing.filter(row => row.awardEvidence.shooterDenyDelta > 0).length,
    0,
    urnShotOpposing.every(row => row.awardEvidence.shooterDenyDelta === 0)
  ),
  mixedRacesPromoted: check(
    mixedRows.filter(row => !row.finalOutcome.label.startsWith('FIRST_HIT_PROVISIONAL')).length,
    mixedRows.length,
    mixedRows.every(row =>
      row.finalOutcome.resolved &&
      row.awardEvidence.shooterPositiveDelta > 0
    )
  ),
  noProvisionalLabelsRemain: check(
    finalRows.filter(row => row.finalOutcome.label.includes('PROVISIONAL')).length,
    0,
    finalRows.every(row => !row.finalOutcome.label.includes('PROVISIONAL'))
  ),
  allRowsAccountedFor: check(
    resolvedRows.length + unresolvedRows.length,
    finalRows.length,
    resolvedRows.length + unresolvedRows.length === finalRows.length
  )
};

const validationPass = Object.values(checks).every(row => row.pass);
const outcomeCounts = countBy(finalRows, row => row.finalOutcome.label);

const summary = {
  replay: replayName,
  version: 'CITEMXP_FINAL_OUTCOME_VALIDATION_V01',
  canonical: false,
  status: validationPass
    ? 'WORKING_FINAL_OUTCOME_STREAM_READY'
    : 'DIAGNOSTIC_ONLY',
  purpose: [
    'Convert Script 62 and Script 64 evidence into one corrected per-orb working outcome stream.',
    'Promote mixed-team Trooper races when direct winner economy telemetry confirms the first hit.',
    'Correct Soul Urn same-team/opposing-team semantics using m_iDenies plus winner net-worth telemetry.',
    'Promote untouched orbs only when their natural recipient team reaches the clean-control evidence floor.'
  ],
  inputs: {
    script62Summary: script62SummaryPath,
    script64Summary: script64SummaryPath,
    awardUnits: awardUnitsPath
  },
  evidenceRule: {
    fieldName: 'm_iGoldNetWorth',
    windowId: 'P0_P8',
    awardTeamDeltaThreshold,
    thresholdDerivation: 'Minimum winning-team positive delta among non-mixed known-shot controls.',
    cleanControlCount: controlRows.length,
    cleanControlWinningTeamDeltas: summarizeNumbers(
      controlRows.map(row => row.bestMeasurement.expectedPositiveDelta)
    )
  },
  correctedSemantics: {
    trooper: {
      shotSameOrbTeam: 'DENY',
      shotOpposingOrbTeam: 'SECURE',
      untouchedNaturalRecipient: 'OPPOSITE_ORB_TEAM',
      supportedUntouchedOutcome: 'AUTO_AWARD_SECURE'
    },
    urn: {
      correctionToScript62: 'Script 62 reversed Urn CLAIM/DENY labels.',
      shotSameOrbTeam: 'DENY',
      shotOpposingOrbTeam: 'CLAIM',
      untouchedNaturalRecipient: 'OPPOSITE_ORB_TEAM',
      supportedUntouchedOutcome: 'AUTO_AWARD_CLAIM'
    }
  },
  counts: {
    targets: finalRows.length,
    resolved: resolvedRows.length,
    unresolved: unresolvedRows.length,
    trooperTargets: trooperRows.length,
    urnTargets: urnRows.length,
    shotTargets: shotRows.length,
    noShotTargets: noShotRows.length,
    mixedTeamRacesPromoted: mixedRows.length,
    trooperAutoAwardSupported: supportedTrooperAuto.length,
    trooperAutoAwardUnresolved: trooperNoShot.length - supportedTrooperAuto.length,
    urnAutoAwardSupported: supportedUrnAuto.length,
    urnAutoAwardUnresolved: urnNoShot.length - supportedUrnAuto.length
  },
  outcomes: {
    all: mapToSortedObject(outcomeCounts),
    trooper: mapToSortedObject(countBy(trooperRows, row => row.finalOutcome.label)),
    urn: mapToSortedObject(countBy(urnRows, row => row.finalOutcome.label)),
    byPlayer: buildPlayerSummary(shotRows),
    byUrnBurst: buildUrnBurstSummary(urnRows)
  },
  directValidation: {
    shotWinnerTelemetry: {
      shotRows: shotRows.length,
      shooterPositiveNetWorth: shotRows.filter(row => row.awardEvidence.shooterPositiveDelta > 0).length
    },
    trooperShotSemantics: {
      sameOrbTeam: summarizeShotRelation(trooperShotSame),
      opposingOrbTeam: summarizeShotRelation(trooperShotOpposing)
    },
    urnShotSemantics: {
      sameOrbTeam: summarizeShotRelation(urnShotSame),
      opposingOrbTeam: summarizeShotRelation(urnShotOpposing)
    },
    mixedTeamRaces: mixedRows.map(compactEvidence),
    trooperNoShot: summarizeAutoRows(trooperNoShot),
    urnNoShot: summarizeAutoRows(urnNoShot)
  },
  unresolvedExamples: unresolvedRows.map(compactEvidence),
  validation: { pass: validationPass, checks },
  interpretation: validationPass
    ? `${resolvedRows.length} of ${finalRows.length} CItemXP episodes now have a directly supported working outcome. ` +
      `${unresolvedRows.length} remain unresolved. This is single-replay validation and is not yet canonical.`
    : 'Validation failed. Do not use the final outcome stream.',
  nextStep: validationPass
    ? 'Integrate this working outcome stream into behavioral metrics and inspector overlays while preserving canonical=false and the unresolved rows.'
    : 'Resolve failed checks before downstream integration.',
  outputs: {
    summary: summaryPath,
    finalOutcomes: finalOutcomesPath
  }
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

console.log('\n========================================');
console.log('CITEMXP FINAL OUTCOME VALIDATION V01');
console.log('========================================');
console.log(`\nTargets: ${finalRows.length}`);
console.log(`Resolved: ${resolvedRows.length}`);
console.log(`Unresolved: ${unresolvedRows.length}`);
console.log(`Evidence floor: ${awardTeamDeltaThreshold} net-worth delta in P0_P8`);
console.log(`Mixed-team races promoted: ${mixedRows.length}`);
console.log(`Trooper untouched supported: ${supportedTrooperAuto.length}/${trooperNoShot.length}`);
console.log(`Urn untouched supported: ${supportedUrnAuto.length}/${urnNoShot.length}`);
console.log('\nFINAL OUTCOMES');
for (const [key, value] of Object.entries(mapToSortedObject(outcomeCounts))) {
  console.log(`${key.padEnd(30)} ${value}`);
}
console.log('\nVALIDATION');
for (const [key, row] of Object.entries(checks)) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ${key.padEnd(44)} ` +
    `actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
  );
}
console.log(`\nOVERALL: ${validationPass ? 'PASS' : 'FAIL'}`);
console.log(`\nSummary:\n${summaryPath}`);
console.log(`\nFinal outcomes:\n${finalOutcomesPath}\n`);

function normalizeUnit(row) {
  if (!row || !['TROOPER_DEATH', 'URN_DELIVERY'].includes(row.sourceType)) return null;
  const entityIndex = finite(row.entityIndex);
  const anchorTick = finite(row.anchorTick);
  const orbTeam = finite(row.orbTeam);
  if (entityIndex === null || anchorTick === null || !isGameTeam(orbTeam)) return null;

  return {
    ...row,
    entityIndex,
    anchorTick,
    orbTeam,
    firstHitTeam: finite(row.firstHitTeam),
    shotObserved: row.shotObserved === true,
    mixedTeamRace: row.mixedTeamRace === true,
    bestMeasurement: row.bestMeasurement ?? null,
    selectedFingerprint: row.selectedFingerprint ?? null,
    nonzeroTargetFieldMeasurements: row.nonzeroTargetFieldMeasurements ?? {}
  };
}

function classifyFinalOutcome(row, threshold) {
  const measurement = row.bestMeasurement ?? {};
  const denyMeasurement = row.nonzeroTargetFieldMeasurements?.m_iDenies ?? null;
  const shooterDenyDelta = finite(denyMeasurement?.shooterPositiveDelta) ?? 0;

  let label = 'NO_SHOT_UNRESOLVED';
  let family = 'UNRESOLVED';
  let resolved = false;
  let winnerTeam = null;
  let winnerPlayerName = null;
  let relationToOrbTeam = 'UNKNOWN';
  let confidence = 'UNRESOLVED';
  let basis = 'NO_SUPPORTED_AWARD_SIGNAL';
  let winnerTeamPositiveDelta = 0;
  let losingTeamPositiveDelta = 0;
  let firstWinnerOffsetTicks = null;

  if (row.shotObserved && isGameTeam(row.firstHitTeam)) {
    winnerTeam = row.firstHitTeam;
    winnerPlayerName = row.firstHitPlayerName ?? null;
    relationToOrbTeam = winnerTeam === row.orbTeam
      ? 'SAME_ORB_TEAM'
      : 'OPPOSING_ORB_TEAM';

    label = relationToOrbTeam === 'SAME_ORB_TEAM'
      ? 'DENY'
      : (row.sourceType === 'URN_DELIVERY' ? 'CLAIM' : 'SECURE');

    family = 'SHOT';
    resolved = (finite(measurement.shooterPositiveDelta) ?? 0) > 0;
    confidence = resolved ? 'HIGH' : 'UNRESOLVED';

    basis = row.mixedTeamRace
      ? 'FIRST_HIT_WINNER_CONFIRMED_BY_SHOOTER_NET_WORTH_AND_DENY_COUNTER'
      : 'FIRST_HIT_WINNER_CONFIRMED_BY_SHOOTER_NET_WORTH';

    winnerTeamPositiveDelta = finite(measurement.expectedPositiveDelta) ?? 0;
    losingTeamPositiveDelta = finite(measurement.otherPositiveDelta) ?? 0;
    firstWinnerOffsetTicks = finite(measurement.firstExpectedOffsetTicks);
  } else {
    winnerTeam = oppositeTeam(row.orbTeam);
    relationToOrbTeam = 'OPPOSING_ORB_TEAM';

    // Script 64 oriented Trooper no-shot measurements toward the opposite team,
    // but oriented Urn no-shot measurements toward the same team. Flip the Urn
    // columns here so winner always means the natural opposite-orb team.
    if (row.sourceType === 'TROOPER_DEATH') {
      winnerTeamPositiveDelta = finite(measurement.expectedPositiveDelta) ?? 0;
      losingTeamPositiveDelta = finite(measurement.otherPositiveDelta) ?? 0;
      firstWinnerOffsetTicks = finite(measurement.firstExpectedOffsetTicks);
    } else {
      winnerTeamPositiveDelta = finite(measurement.otherPositiveDelta) ?? 0;
      losingTeamPositiveDelta = finite(measurement.expectedPositiveDelta) ?? 0;
      firstWinnerOffsetTicks = finite(measurement.firstOtherOffsetTicks);
    }

    if (winnerTeamPositiveDelta >= threshold) {
      label = row.sourceType === 'URN_DELIVERY'
        ? 'AUTO_AWARD_CLAIM'
        : 'AUTO_AWARD_SECURE';

      family = 'AUTO_AWARD';
      resolved = true;
      confidence = 'HIGH';
      basis = 'NATURAL_RECIPIENT_TEAM_NET_WORTH_MEETS_CLEAN_CONTROL_FLOOR';
    }
  }

  return {
    schemaVersion: 1,
    canonical: false,
    sourceType: row.sourceType,
    sourceId: row.sourceId ?? null,
    episodeId: row.episodeId ?? null,
    entityIndex: row.entityIndex,
    subclassId: row.subclassId ?? null,
    orbTeam: row.orbTeam,
    anchorTick: row.anchorTick,
    anchorClock: row.anchorClock ?? null,
    anchorReason: row.anchorReason ?? null,
    shotObserved: row.shotObserved,
    mixedTeamRace: row.mixedTeamRace,
    firstHitPlayerName: row.firstHitPlayerName ?? null,
    firstHitTeam: row.firstHitTeam,
    script62OutcomeLabel: row.correctedOutcomeLabel ?? null,
    finalOutcome: {
      label,
      family,
      resolved,
      winnerTeam,
      winnerPlayerName,
      relationToOrbTeam,
      confidence,
      basis
    },
    awardEvidence: {
      fieldName: 'm_iGoldNetWorth',
      windowId: row.selectedFingerprint?.window?.id ?? null,
      awardTeamDeltaThreshold: threshold,
      winnerTeamPositiveDelta,
      losingTeamPositiveDelta,
      firstWinnerOffsetTicks,
      shooterPositiveDelta: finite(measurement.shooterPositiveDelta) ?? 0,
      shooterDenyDelta,
      expectedVsOtherDirection: measurement.expectedVsOtherDirection ?? null,
      collisionWithin8Ticks: row.collisionWithin8Ticks === true,
      nearestOtherAnchorTicks: finite(row.nearestOtherAnchorTicks),
      positiveDeltaExamples: Array.isArray(measurement.positiveDeltaExamples)
        ? measurement.positiveDeltaExamples
        : []
    }
  };
}

function summarizeShotRelation(rows) {
  return {
    rows: rows.length,
    shooterPositiveNetWorth: rows.filter(
      row => row.awardEvidence.shooterPositiveDelta > 0
    ).length,
    shooterDenyIncrement: rows.filter(
      row => row.awardEvidence.shooterDenyDelta > 0
    ).length,
    outcomes: mapToSortedObject(countBy(rows, row => row.finalOutcome.label))
  };
}

function summarizeAutoRows(rows) {
  const supported = rows.filter(row => row.finalOutcome.resolved);
  const unresolved = rows.filter(row => !row.finalOutcome.resolved);

  return {
    rows: rows.length,
    supported: supported.length,
    unresolved: unresolved.length,
    supportRate: rate(supported.length, rows.length),
    winnerTeamPositiveDelta: summarizeNumbers(
      rows.map(row => row.awardEvidence.winnerTeamPositiveDelta)
    ),
    firstWinnerOffsetTicks: summarizeNumbers(
      supported.map(row => row.awardEvidence.firstWinnerOffsetTicks)
    ),
    collisionWithin8Ticks: rows.filter(
      row => row.awardEvidence.collisionWithin8Ticks
    ).length,
    unresolvedExamples: unresolved.map(compactEvidence)
  };
}

function compactEvidence(row) {
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    episodeId: row.episodeId,
    entityIndex: row.entityIndex,
    orbTeam: row.orbTeam,
    anchorTick: row.anchorTick,
    anchorClock: row.anchorClock,
    mixedTeamRace: row.mixedTeamRace,
    firstHitPlayerName: row.firstHitPlayerName,
    firstHitTeam: row.firstHitTeam,
    script62OutcomeLabel: row.script62OutcomeLabel,
    finalOutcome: row.finalOutcome,
    awardEvidence: {
      winnerTeamPositiveDelta: row.awardEvidence.winnerTeamPositiveDelta,
      losingTeamPositiveDelta: row.awardEvidence.losingTeamPositiveDelta,
      firstWinnerOffsetTicks: row.awardEvidence.firstWinnerOffsetTicks,
      shooterPositiveDelta: row.awardEvidence.shooterPositiveDelta,
      shooterDenyDelta: row.awardEvidence.shooterDenyDelta,
      collisionWithin8Ticks: row.awardEvidence.collisionWithin8Ticks
    }
  };
}

function buildPlayerSummary(rows) {
  const map = new Map();

  for (const row of rows) {
    const name = row.firstHitPlayerName;
    if (!name) continue;

    if (!map.has(name)) {
      map.set(name, {
        playerName: name,
        team: row.firstHitTeam,
        totalFirstHits: 0,
        outcomes: new Map()
      });
    }

    const player = map.get(name);
    player.totalFirstHits++;

    const label = row.finalOutcome.label;
    player.outcomes.set(label, (player.outcomes.get(label) ?? 0) + 1);
  }

  return [...map.values()]
    .map(player => ({
      playerName: player.playerName,
      team: player.team,
      totalFirstHits: player.totalFirstHits,
      outcomes: mapToSortedObject(player.outcomes)
    }))
    .sort((a, b) =>
      b.totalFirstHits - a.totalFirstHits ||
      a.playerName.localeCompare(b.playerName)
    );
}

function buildUrnBurstSummary(rows) {
  const map = new Map();

  for (const row of rows) {
    const id = row.sourceId ?? 'UNKNOWN';

    if (!map.has(id)) {
      map.set(id, {
        burstId: id,
        orbTeam: row.orbTeam,
        orbCount: 0,
        outcomes: new Map()
      });
    }

    const burst = map.get(id);
    burst.orbCount++;

    const label = row.finalOutcome.label;
    burst.outcomes.set(label, (burst.outcomes.get(label) ?? 0) + 1);
  }

  return [...map.values()]
    .map(burst => ({
      burstId: burst.burstId,
      orbTeam: burst.orbTeam,
      orbCount: burst.orbCount,
      outcomes: mapToSortedObject(burst.outcomes)
    }))
    .sort((a, b) => a.burstId.localeCompare(b.burstId));
}

async function loadJsonl(path) {
  const rows = [];

  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) continue;

    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSONL row in ${path}: ${error.message}`);
    }
  }

  return rows;
}

function countBy(rows, keyFn) {
  const map = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return map;
}

function mapToSortedObject(map) {
  return Object.fromEntries(
    [...map.entries()].sort(
      (a, b) =>
        b[1] - a[1] ||
        String(a[0]).localeCompare(String(b[0]))
    )
  );
}

function summarizeNumbers(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (!clean.length) {
    return {
      count: 0,
      min: null,
      p10: null,
      p25: null,
      median: null,
      p75: null,
      p90: null,
      max: null,
      mean: null
    };
  }

  return {
    count: clean.length,
    min: clean[0],
    p10: percentile(clean, 0.10),
    p25: percentile(clean, 0.25),
    median: percentile(clean, 0.50),
    p75: percentile(clean, 0.75),
    p90: percentile(clean, 0.90),
    max: clean.at(-1),
    mean: clean.reduce((sum, value) => sum + value, 0) / clean.length
  };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);

  if (low === high) return sorted[low];

  const weight = position - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isGameTeam(value) {
  return value === 2 || value === 3;
}

function oppositeTeam(team) {
  if (team === 2) return 3;
  if (team === 3) return 2;
  return null;
}

function rate(numerator, denominator) {
  return Number.isFinite(numerator) &&
    Number.isFinite(denominator) &&
    denominator !== 0
    ? numerator / denominator
    : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass };
}

function finishWriter(writer) {
  return new Promise((resolvePromise, rejectPromise) => {
    writer.on('error', rejectPromise);
    writer.end(resolvePromise);
  });
}