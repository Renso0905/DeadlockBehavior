import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = 'BRIDGE_WORLD_COLLECTION_CROSS_REPLAY_REPLICATION_V01';
const SCRIPT147_VERSION = 'BRIDGE_POWERUP_RUNTIME_CARRIER_DISCOVERY_V01';
const SCRIPT148_VERSION = 'BRIDGE_SPAWNER_LIFECYCLE_DISCOVERY_V01';
const SCRIPT149_VERSION = 'BRIDGE_PVS_ROBUST_LIFECYCLE_DISCOVERY_V01';

const MANIFEST_PATH = resolve('output', 'cross_replay', 'replication_manifest_v01.json');
const DISCOVERY_PATH = resolve('output', 'test', 'bridge_pvs_robust_lifecycle_discovery_v01.json');
const SCRIPT147 = resolve('scripts', '147-discover-runtime-bridge-powerup-carrier-v01.mjs');
const SCRIPT148 = resolve('scripts', '148-discover-bridge-spawner-lifecycle-v01.mjs');
const SCRIPT149 = resolve('scripts', '149-discover-bridge-pvs-robust-lifecycle-v01.mjs');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'bridge_world_collection_cross_replay_replication_v01.json');
const FORCE = process.argv.includes('--force');

const EXPECTED_COHORT_SIZE = 5;
const EXPECTED_SPAWNERS = 2;
const EXPECTED_POWERUPS = 4;
const EXPECTED_CADENCE_SECONDS = 300;
const CADENCE_TOLERANCE_SECONDS = 1;

// Frozen from test.dem BEFORE independent replication.
const COLLECTOR_TRUE_THRESHOLD_HU = 300;
const COLLECTOR_PLACEBO_THRESHOLD_HU = 800;
const MIN_TRUE_WITHIN_300_RATE = 0.90;
const MAX_PLACEBO_WITHIN_800_RATE = 0.10;
const MAX_MEDIAN_TRUE_HU = 200;
const MIN_MEDIAN_PLACEBO_HU = 800;

// Descriptive selection-rule test. Not required for collection semantics.
const WAVE_TIME_TOLERANCE_SECONDS = 2;
const BLOCK_PERIOD_SECONDS = 600;
const FIRST_BLOCK_START_SECONDS = 300;

// ============================================================
// PURPOSE
//
// Script147 identified CCitadel_Pickup_Modifier.m_nSubclassID as the bridge
// world-pickup identity carrier using hash(recordKey), with zero exact placebo
// hits in the discovery replay.
//
// Script149 then corrected Script148's PVS/CREATE artifact and found:
//   - exactly two native CCitadel_PickupItemSpawner entities,
//   - ~300 s native next-drop cadence,
//   - pickup active false->true transitions at native spawn anchors,
//   - pickup active true->false transitions with very strong nearest-player
//     geometry versus +30 s shifted-time controls.
//
// Script150 freezes those discovery semantics and reruns Scripts147->149 on the
// five independent replication replays. It tests WORLD COLLECTION semantics:
// identity, topology, cadence, disappearance-at-player, and shifted-time
// separation. It does NOT yet claim player-side 160 s modifier expiration.
//
// The apparent two-wave four-buff deck rule is replicated descriptively and
// reported separately from the collection-semantic gate.
// ============================================================

for (const path of [MANIFEST_PATH, DISCOVERY_PATH, SCRIPT147, SCRIPT148, SCRIPT149]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const manifest = readJson(MANIFEST_PATH);
const discovery = readJson(DISCOVERY_PATH);
if (manifest?.readyToBeginReplication !== true) throw new Error('Replication manifest is not ready.');
if (discovery?.version !== SCRIPT149_VERSION || !String(discovery?.status ?? '').includes('READY')) {
  throw new Error(`Frozen discovery Script149 artifact not ready. version=${discovery?.version} status=${discovery?.status}`);
}

const cohort = Array.isArray(manifest.selectedReplicationCohort)
  ? manifest.selectedReplicationCohort
  : (Array.isArray(manifest.replayRows)
      ? manifest.replayRows.filter(row =>
          row?.role === 'INDEPENDENT_REPLICATION_CANDIDATE'
          && row?.sameAsDiscovery !== true
          && row?.duplicateOfAnotherReplay !== true)
      : []);
if (cohort.length === 0) throw new Error('No independent replication cohort found.');

console.log('');
console.log('========================================================');
console.log('BRIDGE WORLD COLLECTION CROSS-REPLAY REPLICATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Discovery replay excluded:      ${manifest.discoveryReplay ?? 'test'}`);
console.log(`Independent replays:            ${cohort.length}`);
console.log(`Force child reruns:             ${FORCE}`);
console.log(`Collector semantic gate:        true<=300HU >=90%; +30s placebo<=800HU <=10%`);
console.log(`Cadence gate:                   median 300s +/- ${CADENCE_TOLERANCE_SECONDS}s on both spawners`);
console.log(`Two-wave deck rule:             descriptive replication only`);
console.log('');

const replayResults = [];

for (let i = 0; i < cohort.length; i++) {
  const row = cohort[i];
  const replayName = String(row?.replayName ?? '').trim();
  const replayPath = resolve('replays', `${replayName}.dem`);
  const a147 = resolve('output', replayName, 'bridge_powerup_runtime_carrier_discovery_v01.json');
  const a148 = resolve('output', replayName, 'bridge_spawner_lifecycle_discovery_v01.json');
  const a149 = resolve('output', replayName, 'bridge_pvs_robust_lifecycle_discovery_v01.json');

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${cohort.length}] ${replayName}`);
  console.log('--------------------------------------------------------');

  if (!replayName || !existsSync(replayPath)) {
    console.log('FAIL: replay missing.');
    replayResults.push({ replayName, replayPath, processOk: false, semanticPass: false, failureStage: 'REPLAY_MISSING' });
    continue;
  }

  const pipeline = [
    { script: SCRIPT147, artifact: a147, version: SCRIPT147_VERSION, label: 'Script147' },
    { script: SCRIPT148, artifact: a148, version: SCRIPT148_VERSION, label: 'Script148' },
    { script: SCRIPT149, artifact: a149, version: SCRIPT149_VERSION, label: 'Script149' },
  ];

  let processOk = true;
  let failureStage = null;
  for (const child of pipeline) {
    const existing = readJsonIfExists(child.artifact);
    const reusable = existing?.version === child.version && !String(existing?.status ?? '').includes('REQUIRES_DIAGNOSIS');
    if (FORCE || !reusable) {
      console.log(`Running frozen ${child.label}...`);
      const run = runNodeScript(child.script, replayPath);
      if (!run.ok) {
        console.log(`FAIL: ${child.label} exit=${run.exitCode}`);
        processOk = false;
        failureStage = `${child.label.toUpperCase()}_PROCESS`;
        break;
      }
    } else {
      console.log(`Reusing ${child.label} artifact (status=${existing.status ?? 'missing'}).`);
    }
  }

  const art147 = readJsonIfExists(a147);
  const art149 = readJsonIfExists(a149);
  if (!processOk || art147?.version !== SCRIPT147_VERSION || art149?.version !== SCRIPT149_VERSION) {
    replayResults.push({
      replayName, replayPath, processOk: false, semanticPass: false,
      failureStage: failureStage ?? 'ARTIFACT_MISSING_OR_BAD_VERSION',
      artifact147: summarize147(art147), artifact149: summarize149(art149),
    });
    continue;
  }

  const evaluation = evaluateReplay(art147, art149);
  replayResults.push({
    replayName,
    replayPath,
    processOk: true,
    semanticPass: evaluation.semanticPass,
    failureStage: evaluation.semanticPass ? null : 'SEMANTIC_CONSISTENCY',
    checks: evaluation.checks,
    deck: evaluation.deck,
    artifact147: summarize147(art147),
    artifact149: summarize149(art149),
  });

  console.log(
    `semantic=${evaluation.semanticPass ? 'PASS' : 'FAIL'} `
    + `spawners=${art149?.counts?.spawnerIndexes ?? 'n/a'} `
    + `disappear=${art149?.collectorSummary?.events ?? 0} `
    + `true<=300=${fmtPct(thresholdRate(art149, 300, 'true'))} `
    + `placebo<=800=${fmtPct(thresholdRate(art149, 800, 'placebo'))} `
    + `deck=${evaluation.deck.exactComplementBlocks}/${evaluation.deck.completeBlocks}`
  );
  console.log('');
}

const completed = replayResults.filter(r => r.processOk);
const semanticPasses = replayResults.filter(r => r.semanticPass);
const totalDisappear = sum(replayResults.map(r => r.artifact149?.collectorEvents));
const totalTrue300 = sum(replayResults.map(r => r.artifact149?.trueWithin300Count));
const totalTrueRows = sum(replayResults.map(r => r.artifact149?.trueDistanceRows));
const totalPlacebo800 = sum(replayResults.map(r => r.artifact149?.placeboWithin800Count));
const totalPlaceboRows = sum(replayResults.map(r => r.artifact149?.placeboDistanceRows));
const aggregateTrue300Rate = ratio(totalTrue300, totalTrueRows);
const aggregatePlacebo800Rate = ratio(totalPlacebo800, totalPlaceboRows);
const totalDeckBlocks = sum(replayResults.map(r => r.deck?.completeBlocks));
const totalExactDeckBlocks = sum(replayResults.map(r => r.deck?.exactComplementBlocks));
const deckReplaysWithEvidence = replayResults.filter(r => (r.deck?.completeBlocks ?? 0) > 0).length;
const deckReplaysAllExact = replayResults.filter(r => (r.deck?.completeBlocks ?? 0) > 0 && r.deck?.allCompleteBlocksExact === true).length;

const aggregateChecks = {
  manifestReady: check(manifest.readyToBeginReplication, true, manifest.readyToBeginReplication === true),
  independentCohortExpected: check(cohort.length, EXPECTED_COHORT_SIZE, cohort.length === EXPECTED_COHORT_SIZE),
  allProcessesCompleted: check(completed.length, cohort.length, completed.length === cohort.length),
  allReplaysSemanticallyConsistent: check(semanticPasses.length, cohort.length, semanticPasses.length === cohort.length),
  aggregateDisappearancesObserved: check(totalDisappear, '>0', totalDisappear > 0),
  aggregateTrueCollectorGeometryStrong: check(
    aggregateTrue300Rate, `>=${MIN_TRUE_WITHIN_300_RATE}`,
    Number.isFinite(aggregateTrue300Rate) && aggregateTrue300Rate >= MIN_TRUE_WITHIN_300_RATE
  ),
  aggregateShiftedPlaceboSeparated: check(
    aggregatePlacebo800Rate, `<=${MAX_PLACEBO_WITHIN_800_RATE}`,
    Number.isFinite(aggregatePlacebo800Rate) && aggregatePlacebo800Rate <= MAX_PLACEBO_WITHIN_800_RATE
  ),
};
const aggregateSemanticPass = Object.values(aggregateChecks).every(x => x.pass);

let status;
if (aggregateSemanticPass) {
  status = 'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS';
} else {
  status = 'BRIDGE_WORLD_COLLECTION_V01_REPLICATION_REQUIRES_DIAGNOSIS';
}

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  discoveryReplayExcluded: manifest.discoveryReplay ?? 'test',
  frozenThresholds: {
    expectedSpawners: EXPECTED_SPAWNERS,
    expectedPowerups: EXPECTED_POWERUPS,
    cadenceSeconds: EXPECTED_CADENCE_SECONDS,
    cadenceToleranceSeconds: CADENCE_TOLERANCE_SECONDS,
    trueCollectorThresholdHU: COLLECTOR_TRUE_THRESHOLD_HU,
    minTrueWithin300Rate: MIN_TRUE_WITHIN_300_RATE,
    shiftedPlaceboThresholdHU: COLLECTOR_PLACEBO_THRESHOLD_HU,
    maxPlaceboWithin800Rate: MAX_PLACEBO_WITHIN_800_RATE,
    maxMedianTrueHU: MAX_MEDIAN_TRUE_HU,
    minMedianPlaceboHU: MIN_MEDIAN_PLACEBO_HU,
  },
  counts: {
    independentReplays: cohort.length,
    completedReplays: completed.length,
    semanticPassReplays: semanticPasses.length,
    disappearEvents: totalDisappear,
    trueDistanceRows: totalTrueRows,
    trueWithin300Count: totalTrue300,
    trueWithin300Rate: aggregateTrue300Rate,
    placeboDistanceRows: totalPlaceboRows,
    placeboWithin800Count: totalPlacebo800,
    placeboWithin800Rate: aggregatePlacebo800Rate,
  },
  deckReplication: {
    interpretation: 'DESCRIPTIVE_ONLY_NOT_PART_OF_COLLECTION_SEMANTIC_GATE',
    ruleTested: 'Within each 10-minute block beginning at 5:00, the two 5-minute waves collectively contain all four bridge powerups exactly once.',
    replaysWithCompleteBlocks: deckReplaysWithEvidence,
    replaysAllObservedBlocksExact: deckReplaysAllExact,
    completeBlocks: totalDeckBlocks,
    exactComplementBlocks: totalExactDeckBlocks,
    exactRate: ratio(totalExactDeckBlocks, totalDeckBlocks),
  },
  replayResults,
  semanticValidation: aggregateChecks,
  interpretation: {
    supported: aggregateSemanticPass
      ? 'The bridge world-pickup carrier, two-spawner topology, native ~300 s cadence, active true->false collection transition, and nearest-player collector attribution replicate across the independent cohort under frozen discovery thresholds.'
      : 'One or more frozen bridge world-collection semantics failed independent replication and require diagnosis.',
    notYetEstablished: [
      'Player-side bridge modifier carrier after collection.',
      'Replay-observed ~160 s expiration or any early-removal condition such as death.',
      'Exact 5-40 minute effect interpolation.',
      'runtime_bridge_buff_ownership registry promotion.',
    ],
  },
};

mkdirSync(resolve('output', 'cross_replay'), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
printSummary(output);

function evaluateReplay(art147, art149) {
  const collector = art149?.collectorSummary ?? {};
  const true300 = thresholdRate(art149, 300, 'true');
  const placebo800 = thresholdRate(art149, 800, 'placebo');
  const cadenceRows = Array.isArray(art149?.nextDropCadence) ? art149.nextDropCadence : [];
  const cadenceGood = cadenceRows.length === EXPECTED_SPAWNERS && cadenceRows.every(row =>
    Number.isFinite(row?.medianDeltaGameTime)
    && Math.abs(row.medianDeltaGameTime - EXPECTED_CADENCE_SECONDS) <= CADENCE_TOLERANCE_SECONDS
  );
  const powerupsObserved = new Set(
    (art149?.perSpawnerSequence ?? []).flatMap(row => row?.distinctTypes ?? [])
  );
  const deck = evaluateDeck(art149);

  const checks = {
    script147Ready: check(art147?.version, SCRIPT147_VERSION, art147?.version === SCRIPT147_VERSION),
    recordKeyCarrierObserved: check(art147?.counts?.recordKeyHits ?? 0, '>0', (art147?.counts?.recordKeyHits ?? 0) > 0),
    exactPlaceboTokenHitsAbsent: check(art147?.counts?.controlExactHits ?? null, 0, art147?.counts?.controlExactHits === 0),
    script149Ready: check(art149?.version, SCRIPT149_VERSION, art149?.version === SCRIPT149_VERSION && String(art149?.status ?? '').includes('READY')),
    exactlyTwoSpawners: check(art149?.counts?.spawnerIndexes ?? null, EXPECTED_SPAWNERS, art149?.counts?.spawnerIndexes === EXPECTED_SPAWNERS),
    allFourPowerupsObserved: check(powerupsObserved.size, EXPECTED_POWERUPS, powerupsObserved.size === EXPECTED_POWERUPS),
    nativeCadence300Seconds: check(cadenceRows.map(r => r?.medianDeltaGameTime), `all ${EXPECTED_CADENCE_SECONDS}+/-${CADENCE_TOLERANCE_SECONDS}`, cadenceGood),
    disappearancesObserved: check(collector?.events ?? 0, '>0', (collector?.events ?? 0) > 0),
    trueCollectorGeometryStrong: check(true300, `>=${MIN_TRUE_WITHIN_300_RATE}`, Number.isFinite(true300) && true300 >= MIN_TRUE_WITHIN_300_RATE),
    shiftedPlaceboSeparated: check(placebo800, `<=${MAX_PLACEBO_WITHIN_800_RATE}`, Number.isFinite(placebo800) && placebo800 <= MAX_PLACEBO_WITHIN_800_RATE),
    medianTrueNear: check(collector?.medianTrueNearestDistanceHU ?? null, `<=${MAX_MEDIAN_TRUE_HU}`, Number.isFinite(collector?.medianTrueNearestDistanceHU) && collector.medianTrueNearestDistanceHU <= MAX_MEDIAN_TRUE_HU),
    medianPlaceboFar: check(collector?.medianPlaceboNearestDistanceHU ?? null, `>=${MIN_MEDIAN_PLACEBO_HU}`, Number.isFinite(collector?.medianPlaceboNearestDistanceHU) && collector.medianPlaceboNearestDistanceHU >= MIN_MEDIAN_PLACEBO_HU),
  };
  return { semanticPass: Object.values(checks).every(x => x.pass), checks, deck };
}

function evaluateDeck(art149) {
  const sequences = Array.isArray(art149?.perSpawnerSequence) ? art149.perSpawnerSequence : [];
  const waveMap = new Map();
  for (const spawner of sequences) {
    for (const row of spawner?.sequence ?? []) {
      if (!Number.isFinite(row?.matchTimeSeconds) || !row?.recordKey) continue;
      const waveIndex = Math.round((row.matchTimeSeconds - FIRST_BLOCK_START_SECONDS) / EXPECTED_CADENCE_SECONDS);
      const expectedTime = FIRST_BLOCK_START_SECONDS + waveIndex * EXPECTED_CADENCE_SECONDS;
      if (Math.abs(row.matchTimeSeconds - expectedTime) > WAVE_TIME_TOLERANCE_SECONDS) continue;
      const list = waveMap.get(waveIndex) ?? [];
      list.push({ spawnerIndex: spawner.spawnerIndex, recordKey: row.recordKey, matchTimeSeconds: row.matchTimeSeconds });
      waveMap.set(waveIndex, list);
    }
  }
  const completeWaves = [...waveMap.entries()]
    .filter(([, rows]) => rows.length === EXPECTED_SPAWNERS && new Set(rows.map(r => r.spawnerIndex)).size === EXPECTED_SPAWNERS)
    .map(([waveIndex, rows]) => ({ waveIndex, rows }))
    .sort((a, b) => a.waveIndex - b.waveIndex);

  const blocks = [];
  const maxWave = completeWaves.length ? Math.max(...completeWaves.map(w => w.waveIndex)) : -1;
  for (let firstWave = 0; firstWave <= maxWave; firstWave += 2) {
    const a = completeWaves.find(w => w.waveIndex === firstWave);
    const b = completeWaves.find(w => w.waveIndex === firstWave + 1);
    if (!a || !b) continue;
    const keys = [...a.rows, ...b.rows].map(r => r.recordKey);
    const counts = frequency(keys);
    const exact = keys.length === 4 && Object.keys(counts).length === 4 && Object.values(counts).every(n => n === 1);
    blocks.push({
      blockIndex: firstWave / 2,
      startMatchSeconds: FIRST_BLOCK_START_SECONDS + firstWave * EXPECTED_CADENCE_SECONDS,
      firstWave: a.rows,
      secondWave: b.rows,
      powerupCounts: counts,
      exactAllFourOnce: exact,
    });
  }
  return {
    completeWaves: completeWaves.length,
    completeBlocks: blocks.length,
    exactComplementBlocks: blocks.filter(b => b.exactAllFourOnce).length,
    allCompleteBlocksExact: blocks.length > 0 ? blocks.every(b => b.exactAllFourOnce) : null,
    blocks,
  };
}

function summarize147(a) {
  if (!a) return null;
  return {
    status: a.status,
    recordKeyHits: a?.counts?.recordKeyHits ?? 0,
    controlExactHits: a?.counts?.controlExactHits ?? 0,
    primaryCompoundHits: a?.counts?.primaryCompoundHits ?? 0,
    modifierClassHits: a?.counts?.modifierClassHits ?? 0,
  };
}

function summarize149(a) {
  if (!a) return null;
  const c = a.collectorSummary ?? {};
  return {
    status: a.status,
    spawnerIndexes: a?.counts?.spawnerIndexes ?? 0,
    pickupActiveFalseToTrueUpdates: a?.counts?.pickupActiveFalseToTrueUpdates ?? 0,
    pickupActiveTrueToFalseUpdates: a?.counts?.pickupActiveTrueToFalseUpdates ?? 0,
    collectorEvents: c.events ?? 0,
    trueDistanceRows: c.trueDistanceRows ?? 0,
    placeboDistanceRows: c.placeboDistanceRows ?? 0,
    medianTrueNearestDistanceHU: c.medianTrueNearestDistanceHU ?? null,
    medianPlaceboNearestDistanceHU: c.medianPlaceboNearestDistanceHU ?? null,
    trueWithin300Count: thresholdCount(a, 300, 'true'),
    trueWithin300Rate: thresholdRate(a, 300, 'true'),
    placeboWithin800Count: thresholdCount(a, 800, 'placebo'),
    placeboWithin800Rate: thresholdRate(a, 800, 'placebo'),
    cadenceMedians: (a?.nextDropCadence ?? []).map(r => r?.medianDeltaGameTime ?? null),
  };
}

function thresholdRow(a, threshold) {
  return (a?.collectorSummary?.thresholds ?? []).find(r => r?.thresholdHU === threshold) ?? null;
}
function thresholdRate(a, threshold, kind) {
  const row = thresholdRow(a, threshold);
  return kind === 'true' ? row?.trueRate ?? null : row?.placeboRate ?? null;
}
function thresholdCount(a, threshold, kind) {
  const row = thresholdRow(a, threshold);
  return kind === 'true' ? row?.trueCount ?? 0 : row?.placeboCount ?? 0;
}

function runNodeScript(scriptPath, replayPath) {
  const r = spawnSync(process.execPath, [scriptPath, replayPath], { cwd: process.cwd(), encoding: 'utf8', stdio: 'inherit' });
  return { ok: r.status === 0, exitCode: r.status, signal: r.signal ?? null };
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readJsonIfExists(path) { try { return existsSync(path) ? readJson(path) : null; } catch { return null; } }
function check(actual, expected, pass) { return { pass: Boolean(pass), actual, expected }; }
function sum(values) { return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0); }
function ratio(a, b) { return b > 0 ? a / b : null; }
function frequency(values) { const o = {}; for (const v of values) o[v] = (o[v] ?? 0) + 1; return o; }
function fmtPct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a'; }

function printSummary(o) {
  console.log('========================================================');
  console.log('CROSS-REPLAY BRIDGE WORLD COLLECTION RESULT');
  console.log('========================================================');
  console.log('');
  console.log(`status:                          ${o.status}`);
  console.log(`independent replays:             ${o.counts.independentReplays}`);
  console.log(`semantic consistency:            ${o.counts.semanticPassReplays}/${o.counts.independentReplays}`);
  console.log(`disappear/collection events:     ${o.counts.disappearEvents}`);
  console.log(`true <=300 HU:                   ${o.counts.trueWithin300Count}/${o.counts.trueDistanceRows} (${fmtPct(o.counts.trueWithin300Rate)})`);
  console.log(`+30s placebo <=800 HU:           ${o.counts.placeboWithin800Count}/${o.counts.placeboDistanceRows} (${fmtPct(o.counts.placeboWithin800Rate)})`);
  console.log(`two-wave deck exact blocks:      ${o.deckReplication.exactComplementBlocks}/${o.deckReplication.completeBlocks} (${fmtPct(o.deckReplication.exactRate)})`);
  console.log('');
  console.log('REPLAY SUMMARY');
  console.log('--------------');
  for (const r of o.replayResults) {
    console.log(
      `${String(r.replayName).padEnd(8)} semantic=${r.semanticPass ? 'PASS' : 'FAIL'} `
      + `events=${String(r.artifact149?.collectorEvents ?? 0).padStart(3)} `
      + `true300=${fmtPct(r.artifact149?.trueWithin300Rate)} `
      + `pl800=${fmtPct(r.artifact149?.placeboWithin800Rate)} `
      + `deck=${r.deck?.exactComplementBlocks ?? 0}/${r.deck?.completeBlocks ?? 0}`
    );
  }
  console.log('');
  console.log('SEMANTIC VALIDATION');
  console.log('-------------------');
  for (const [name, row] of Object.entries(o.semanticValidation)) {
    console.log(`${name.padEnd(46)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
  }
  console.log('');
  console.log(`JSON:\n${OUTPUT_PATH}`);
  console.log('');
}
