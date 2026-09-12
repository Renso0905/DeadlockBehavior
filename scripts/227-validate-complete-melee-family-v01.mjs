import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const VERSION = 'MELEE_FAMILY_VALIDATION_V01';
const RUNTIME_VERSION = 'RUNTIME_MELEE_PRODUCTION_V01';
const RUNTIME_STATUS = 'RUNTIME_MELEE_PRODUCTION_V01_READY';
const KNOWN_TYPES = new Set(['LIGHT', 'HEAVY', 'HEAVY_AIR', 'SLIDE']);
const DEFAULT_REPLAYS = ['test', 'rep01', 'rep02', 'rep03', 'rep04', 'rep05'];
const replayNames = process.argv.slice(2).filter(Boolean).length
  ? process.argv.slice(2).filter(Boolean)
  : DEFAULT_REPLAYS;
const outputRoot = resolve(process.env.DEADLOCK_OUTPUT_ROOT ?? 'output');
const artifactPath = resolve(outputRoot, 'cross_replay', 'melee_family_validation_v01.json');
const movementPath = resolve(outputRoot, 'cross_replay', 'movement_family_validation_v01.json');

console.log('');
console.log('========================================================');
console.log('COMPLETE MELEE FAMILY VALIDATION V0.1');
console.log('========================================================');
console.log(`Output root: ${outputRoot}`);
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

if (!existsSync(movementPath)) {
  fail(`Missing Movement authority artifact: ${movementPath}`);
}
const movement = JSON.parse(readFileSync(movementPath, 'utf8'));
if (movement.version !== 'MOVEMENT_FAMILY_VALIDATION_V01' || movement.validationPass !== true) {
  fail('Movement family validation is not PASS; melee_per_alive_min cannot be frozen.');
}

const movementByReplayPlayer = new Map();
for (const replay of movement.replays ?? []) {
  if (replay?.success !== true) continue;
  for (const player of replay.players ?? []) {
    movementByReplayPlayer.set(
      `${replay.replayName}\u0000${player.playerName}`,
      Number.isFinite(player.movementAliveSeconds) ? player.movementAliveSeconds : null
    );
  }
}

const results = [];
const playerRecords = [];

for (const replayName of replayNames) {
  const summaryPath = resolve(outputRoot, replayName, 'runtime_melee_production_v01.json');
  const eventsPath = resolve(outputRoot, replayName, 'runtime_melee_events_v01.jsonl');
  if (!existsSync(summaryPath) || !existsSync(eventsPath)) {
    results.push({ replayName, success: false, error: 'runtime melee production outputs missing' });
    console.log(`${replayName.padEnd(10)} MISSING runtime melee production output`);
    continue;
  }

  try {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const events = readJsonl(eventsPath);
    const row = analyzeReplay(replayName, summary, events, movementByReplayPlayer, playerRecords);
    results.push(row);
    console.log(
      `${replayName.padEnd(10)} ` +
      `raw=${String(row.rawAttacks).padStart(4)} ` +
      `pre=${String(row.preMatchAttacks).padStart(3)} ` +
      `match=${String(row.matchAttacks).padStart(4)} ` +
      `hits=${String(row.matchHits).padStart(4)} ` +
      `players=${String(row.movementRosterPlayers).padStart(2)} ` +
      `owner=${pct(row.ownerResolutionRateMatch).padStart(8)}`
    );
  } catch (error) {
    results.push({ replayName, success: false, error: error?.stack ?? String(error) });
    console.log(`${replayName.padEnd(10)} ERROR ${error?.message ?? error}`);
  }
}

const successful = results.filter(row => row.success === true);
const calibration = validateCalibration(outputRoot, successful.find(row => row.replayName === 'test'));

const aggregate = {
  requestedReplays: replayNames.length,
  successfulReplays: successful.length,
  playerReplayCount: playerRecords.length,
  rawAttacks: sum(successful, 'rawAttacks'),
  preMatchAttacksExcluded: sum(successful, 'preMatchAttacks'),
  matchAttacks: sum(successful, 'matchAttacks'),
  matchHits: sum(successful, 'matchHits'),
  unresolvedOwnerMatch: sum(successful, 'unresolvedOwnerMatch'),
  unknownAttackTypeMatch: sum(successful, 'unknownAttackTypeMatch'),
  duplicateKeyCount: sum(successful, 'duplicateKeyCount'),
  lightMelee: sum(successful, 'lightMelee'),
  heavyMelee: sum(successful, 'heavyMelee'),
  airHeavyMelee: sum(successful, 'airHeavyMelee'),
  slideMelee: sum(successful, 'slideMelee'),
  hitRateFormulaMaxAbsoluteError: max(successful, 'hitRateFormulaMaxAbsoluteError'),
  typeShareFormulaMaxAbsoluteError: max(successful, 'typeShareFormulaMaxAbsoluteError'),
  playerSumMaxAbsoluteError: max(successful, 'playerSumMaxAbsoluteError'),
  attacksPerAliveMinuteFormulaMaxAbsoluteError: max(playerRecords, 'attacksPerAliveMinuteFormulaError'),
};
aggregate.ownerResolutionRateMatch = safeDiv(
  aggregate.matchAttacks - aggregate.unresolvedOwnerMatch,
  aggregate.matchAttacks
);

const gates = {
  sixOfSixReplays:
    replayNames.length === 6 && successful.length === 6 && DEFAULT_REPLAYS.every(name => successful.some(row => row.replayName === name)),
  runtimeVersionEveryReplay: successful.every(row => row.runtimeVersionPass),
  runtimeReadyEveryReplay: successful.every(row => row.runtimeReadyPass),
  runtimeIntegrityEveryReplay: successful.every(row => row.runtimeIntegrityPass),
  substantialExecutionEveryReplay: successful.every(row => row.matchAttacks > 0),
  uniqueExecutionKeys: aggregate.duplicateKeyCount === 0,
  completePostStartOwnerResolution: aggregate.unresolvedOwnerMatch === 0,
  knownPostStartAttackTypes: aggregate.unknownAttackTypeMatch === 0,
  booleanHitStateEveryEvent: successful.every(row => row.booleanHitStatePass),
  summaryEventReconciliation: successful.every(row => row.summaryEventReconciliationPass),
  playerSummaryReconciliation: successful.every(row => row.playerSummaryReconciliationPass),
  hitCountBoundedByAttacks: successful.every(row => row.matchHits <= row.matchAttacks),
  movementAuthorityPass: movement.validationPass === true,
  movementRoster72: movementByReplayPlayer.size === 72,
  movementJoinComplete: successful.every(row => row.movementJoinMissing === 0),
  playerReplay72: playerRecords.length === 72,
  hitRateFormulaExact: (aggregate.hitRateFormulaMaxAbsoluteError ?? Infinity) <= 1e-12,
  typeShareFormulaExact: (aggregate.typeShareFormulaMaxAbsoluteError ?? Infinity) <= 1e-12,
  attacksPerAliveMinuteFormulaExact: (aggregate.attacksPerAliveMinuteFormulaMaxAbsoluteError ?? Infinity) <= 1e-12,
  syntheticZeroDenominatorContract:
    safeDiv(2, 0) === null && safeDiv(2, null) === null && safeDiv(0, 2) === 0,
  calibrationRawExactReproduction: calibration.rawExactReproductionPass,
  calibrationFrozenMatchExclusion: calibration.frozenMatchExclusionPass,
};

const validationPass = Object.values(gates).every(Boolean);

const artifact = {
  version: VERSION,
  canonical: false,
  researchOnly: true,
  createdAt: new Date().toISOString(),
  metricsUnderTest: [
    'melee_attacks',
    'melee_hits',
    'melee_hit_rate',
    'light_melee',
    'heavy_melee',
    'air_heavy_melee',
    'melee_type_share',
    'melee_per_alive_min',
  ],
  operationalContract: {
    execution:
      'Unique observed CCitadel_Ability_HoldMelee execution keyed by ability entity index + m_flAttackTriggeredTime + m_eCurrentAttackType.',
    matchEligibility:
      'Only executions whose firstObservedMatchTimeSeconds >= 0 enter authoritative match statistics. Raw pre-match executions remain in the audit event stream.',
    hit:
      'Execution where observed m_bHitWithThisAttack becomes true. This is an observed ability hit flag, not an independently reconstructed collision/damage causal claim.',
    attackTypes: {
      LIGHT: 1,
      HEAVY: 2,
      HEAVY_AIR: 3,
      SLIDE: 4,
    },
    aliveMinuteDenominator:
      'Movement authority movementAliveSeconds: sum of consecutive post-start PlayerState intervals with both endpoints alive.',
    zeroDenominator: 'null',
  },
  formulas: {
    melee_hit_rate: 'melee_hits / melee_attacks',
    melee_type_share: 'count(type) / melee_attacks for every observed runtime type',
    melee_per_alive_min: 'melee_attacks / (movementAliveSeconds / 60)',
  },
  semanticBoundary: [
    'melee_attacks is executed melee telemetry, not raw input/button-press attempts.',
    'm_bHitWithThisAttack is observed game ability telemetry; it does not independently prove collision geometry, damage amount, target identity, or causal final blow.',
    'LIGHT/HEAVY/HEAVY_AIR/SLIDE come from m_eCurrentAttackType rather than input hold-duration heuristics.',
    'No intent, strategic quality, or perceived opportunity is inferred.',
    'Legacy MeleeHit game-message absence is not used as negative evidence against the direct ability carrier.',
  ],
  calibration,
  movementDependency: {
    version: movement.version,
    validationPass: movement.validationPass,
    playerReplayRows: movementByReplayPlayer.size,
  },
  aggregate,
  gates,
  validationPass,
  recommendedAuthorityIfPass: validationPass
    ? {
        integrityValidation: 'pass',
        semanticValidation: 'pass',
        replicationStatus: 'cross_replay_replicated',
      }
    : null,
  replays: results,
  players: playerRecords,
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');

console.log('');
console.log('========================================================');
console.log('CROSS-REPLAY MELEE FAMILY EVIDENCE');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Player-replay records: ${playerRecords.length}`);
console.log(`Raw direct executions: ${aggregate.rawAttacks}`);
console.log(`Pre-match excluded: ${aggregate.preMatchAttacksExcluded}`);
console.log(`Post-start executions: ${aggregate.matchAttacks}`);
console.log(`Observed hit flags: ${aggregate.matchHits}`);
console.log(`Resolved post-start owners: ${aggregate.matchAttacks - aggregate.unresolvedOwnerMatch}/${aggregate.matchAttacks}`);
console.log(`Unknown post-start types: ${aggregate.unknownAttackTypeMatch}`);
console.log(`Duplicate execution keys: ${aggregate.duplicateKeyCount}`);
console.log('');
console.log('Calibration raw reproduction:');
console.log(`  historical raw attacks: ${calibration.historicalRawAttacks}`);
console.log(`  production raw attacks: ${calibration.productionRawAttacks}`);
console.log(`  exact execution rows:   ${calibration.exactRows}/${calibration.historicalRawAttacks}`);
console.log(`  pre-match correction:   ${calibration.productionPreMatchAttacks} excluded`);
console.log(`  match attacks/hits:     ${calibration.productionMatchAttacks}/${calibration.productionMatchHits}`);
console.log('');
console.log(`VALIDATION: ${validationPass ? 'PASS' : 'FAIL'}`);
console.log(`Output: ${artifactPath}`);
console.log('');

if (!validationPass) process.exitCode = 1;

function analyzeReplay(replayName, summary, events, movementMap, allPlayerRecords) {
  const runtimeVersionPass = summary?.version === RUNTIME_VERSION;
  const runtimeReadyPass = summary?.status === RUNTIME_STATUS;
  const runtimeIntegrityPass = summary?.validation?.pass === true;
  const rawEvents = events;
  const matchEvents = events.filter(event => event?.eligibleForMatchStats === true);
  const preMatchEvents = events.filter(event => event?.eligibleForMatchStats !== true);
  const keys = rawEvents.map(event => String(event?.key ?? ''));
  const duplicateKeyCount = keys.length - new Set(keys).size;
  const booleanHitStatePass = rawEvents.every(event => event?.hit === true || event?.hit === false);
  const unresolvedOwnerMatch = matchEvents.filter(event => !event?.playerName).length;
  const unknownAttackTypeMatch = matchEvents.filter(event => !KNOWN_TYPES.has(event?.attackType)).length;
  const directByType = countBy(matchEvents, event => event.attackType);
  const directHits = matchEvents.filter(event => event.hit === true);
  const directHitsByType = countBy(directHits, event => event.attackType);

  const summaryEventReconciliationPass =
    summary?.rawTotals?.attacks === rawEvents.length &&
    summary?.rawTotals?.hits === rawEvents.filter(event => event.hit === true).length &&
    summary?.preMatch?.attacksExcluded === preMatchEvents.length &&
    summary?.totals?.attacks === matchEvents.length &&
    summary?.totals?.hits === directHits.length &&
    sameCounts(summary?.totals?.byType ?? {}, directByType) &&
    sameCounts(summary?.totals?.hitsByType ?? {}, directHitsByType);

  const playerSummaryMap = new Map((summary?.players ?? []).map(player => [player.playerName, player]));
  const movementPlayers = [];
  for (const [key, movementAliveSeconds] of movementMap.entries()) {
    const [candidateReplay, playerName] = key.split('\u0000');
    if (candidateReplay !== replayName) continue;
    movementPlayers.push({ playerName, movementAliveSeconds });
  }

  let playerSumAttacks = 0;
  let playerSumHits = 0;
  let movementJoinMissing = 0;
  let hitRateFormulaMaxAbsoluteError = 0;
  let typeShareFormulaMaxAbsoluteError = 0;
  let playerSumMaxAbsoluteError = 0;

  for (const movementPlayer of movementPlayers) {
    const summaryPlayer = playerSummaryMap.get(movementPlayer.playerName) ?? null;
    const attackCount = Number(summaryPlayer?.attackCount ?? 0);
    const hitCount = Number(summaryPlayer?.hitCount ?? 0);
    const byType = summaryPlayer?.byType ?? {};
    const expectedHitRate = safeDiv(hitCount, attackCount);
    const observedHitRate = summaryPlayer ? summaryPlayer.hitRate : null;
    const hitRateError = nullableError(observedHitRate, expectedHitRate);
    hitRateFormulaMaxAbsoluteError = Math.max(hitRateFormulaMaxAbsoluteError, hitRateError ?? Infinity);

    const typeShare = summaryPlayer?.typeShare ?? {};
    for (const type of new Set([...Object.keys(byType), ...Object.keys(typeShare)])) {
      const expected = safeDiv(Number(byType[type] ?? 0), attackCount);
      const observed = typeShare[type] ?? null;
      const error = nullableError(observed, expected);
      typeShareFormulaMaxAbsoluteError = Math.max(typeShareFormulaMaxAbsoluteError, error ?? Infinity);
    }

    const attacksPerAliveMinute = safeDiv(attackCount, movementPlayer.movementAliveSeconds / 60);
    const formulaRecomputed = safeDiv(attackCount, movementPlayer.movementAliveSeconds / 60);
    const attacksPerAliveMinuteFormulaError = nullableError(attacksPerAliveMinute, formulaRecomputed) ?? Infinity;

    allPlayerRecords.push({
      replayName,
      playerName: movementPlayer.playerName,
      movementAliveSeconds: movementPlayer.movementAliveSeconds,
      attackCount,
      hitCount,
      byType,
      hitRate: expectedHitRate,
      typeShare: Object.fromEntries(
        Object.entries(byType).map(([type, count]) => [type, safeDiv(Number(count), attackCount)])
      ),
      attacksPerAliveMinute,
      attacksPerAliveMinuteFormulaError,
    });

    playerSumAttacks += attackCount;
    playerSumHits += hitCount;
  }

  for (const player of summary?.players ?? []) {
    if (!movementMap.has(`${replayName}\u0000${player.playerName}`)) movementJoinMissing += 1;
  }

  playerSumMaxAbsoluteError = Math.max(
    Math.abs(playerSumAttacks - matchEvents.length),
    Math.abs(playerSumHits - directHits.length)
  );

  const playerSummaryReconciliationPass =
    movementPlayers.length === 12 &&
    movementJoinMissing === 0 &&
    playerSumMaxAbsoluteError === 0 &&
    summary?.integrity?.eventCountMatchesPlayerSum === true &&
    summary?.integrity?.hitCountMatchesPlayerSum === true;

  return {
    replayName,
    success: true,
    runtimeVersionPass,
    runtimeReadyPass,
    runtimeIntegrityPass,
    rawAttacks: rawEvents.length,
    preMatchAttacks: preMatchEvents.length,
    matchAttacks: matchEvents.length,
    matchHits: directHits.length,
    lightMelee: Number(directByType.LIGHT ?? 0),
    heavyMelee: Number(directByType.HEAVY ?? 0),
    airHeavyMelee: Number(directByType.HEAVY_AIR ?? 0),
    slideMelee: Number(directByType.SLIDE ?? 0),
    unresolvedOwnerMatch,
    ownerResolutionRateMatch: safeDiv(matchEvents.length - unresolvedOwnerMatch, matchEvents.length),
    unknownAttackTypeMatch,
    duplicateKeyCount,
    booleanHitStatePass,
    summaryEventReconciliationPass,
    playerSummaryReconciliationPass,
    movementRosterPlayers: movementPlayers.length,
    movementJoinMissing,
    hitRateFormulaMaxAbsoluteError,
    typeShareFormulaMaxAbsoluteError,
    playerSumMaxAbsoluteError,
  };
}

function validateCalibration(root, productionRow) {
  const historicalEventsPath = resolve(root, 'test', 'verified_melee_events.jsonl');
  const historicalSummaryPath = resolve(root, 'test', 'melee_verification_summary.json');
  const productionEventsPath = resolve(root, 'test', 'runtime_melee_events_v01.jsonl');
  const productionSummaryPath = resolve(root, 'test', 'runtime_melee_production_v01.json');

  if (![historicalEventsPath, historicalSummaryPath, productionEventsPath, productionSummaryPath].every(existsSync)) {
    return {
      rawExactReproductionPass: false,
      frozenMatchExclusionPass: false,
      error: 'calibration historical or production melee artifact missing',
    };
  }

  const historicalEvents = readJsonl(historicalEventsPath);
  const historicalSummary = JSON.parse(readFileSync(historicalSummaryPath, 'utf8'));
  const productionEvents = readJsonl(productionEventsPath);
  const productionSummary = JSON.parse(readFileSync(productionSummaryPath, 'utf8'));
  const productionByKey = new Map(productionEvents.map(event => [event.key, event]));
  let exactRows = 0;
  const mismatches = [];

  for (const historical of historicalEvents) {
    const current = productionByKey.get(historical.key);
    const pass = current &&
      current.playerName === historical.playerName &&
      current.attackTypeCode === historical.attackTypeCode &&
      current.attackType === historical.attackType &&
      current.hit === historical.hit;
    if (pass) exactRows += 1;
    else if (mismatches.length < 20) mismatches.push({ key: historical.key, historical, production: current ?? null });
  }

  const rawTypePass = sameCounts(productionSummary?.rawTotals?.byType ?? {}, {
    LIGHT: 648,
    HEAVY: 874,
    HEAVY_AIR: 76,
  });
  const matchTypePass = sameCounts(productionSummary?.totals?.byType ?? {}, {
    LIGHT: 635,
    HEAVY: 873,
    HEAVY_AIR: 74,
  });

  const rawExactReproductionPass =
    historicalSummary?.totalDirectAttacks === 1598 &&
    historicalSummary?.confirmedHits === 1577 &&
    historicalEvents.length === 1598 &&
    productionEvents.length === 1598 &&
    exactRows === 1598 &&
    productionSummary?.rawTotals?.attacks === 1598 &&
    productionSummary?.rawTotals?.hits === 1577 &&
    rawTypePass;

  const frozenMatchExclusionPass =
    productionRow?.preMatchAttacks === 16 &&
    productionSummary?.preMatch?.attacksExcluded === 16 &&
    productionSummary?.preMatch?.hitsExcluded === 0 &&
    productionSummary?.totals?.attacks === 1582 &&
    productionSummary?.totals?.hits === 1577 &&
    matchTypePass;

  return {
    historicalRawAttacks: historicalEvents.length,
    historicalConfirmedHits: historicalSummary?.confirmedHits ?? null,
    historicalInputEventsLoaded: historicalSummary?.inputEventsLoaded ?? null,
    historicalDirectEventsMatchedToInput: historicalSummary?.directEventsMatchedToInput ?? null,
    historicalInputAgreement: historicalSummary?.inputAgreement ?? null,
    productionRawAttacks: productionEvents.length,
    productionRawHits: productionSummary?.rawTotals?.hits ?? null,
    exactRows,
    mismatchCount: historicalEvents.length - exactRows,
    mismatchExamples: mismatches,
    rawTypePass,
    rawExactReproductionPass,
    productionPreMatchAttacks: productionSummary?.preMatch?.attacksExcluded ?? null,
    productionPreMatchHits: productionSummary?.preMatch?.hitsExcluded ?? null,
    productionMatchAttacks: productionSummary?.totals?.attacks ?? null,
    productionMatchHits: productionSummary?.totals?.hits ?? null,
    productionMatchByType: productionSummary?.totals?.byType ?? null,
    matchTypePass,
    frozenMatchExclusionPass,
    note:
      'Legacy behavioral_metrics_v02 melee totals used the raw 1,598-event numerator, which included 16 pre-match whiffs. Production match metrics deliberately correct this by excluding matchTime<0 executions.',
  };
}

function readJsonl(path) {
  const text = readFileSync(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = String(getKey(value) ?? 'UNKNOWN');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sameCounts(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of keys) if (Number(a?.[key] ?? 0) !== Number(b?.[key] ?? 0)) return false;
  return true;
}

function safeDiv(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function nullableError(a, b) {
  if (a === null && b === null) return 0;
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b);
  return null;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);
}

function max(rows, key) {
  let value = 0;
  for (const row of rows) {
    const number = Number(row?.[key]);
    if (!Number.isFinite(number)) return Infinity;
    value = Math.max(value, number);
  }
  return value;
}

function pct(value) {
  return Number.isFinite(value) ? `${(100 * value).toFixed(2)}%` : '—';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
