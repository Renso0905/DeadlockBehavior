import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = 'RUNTIME_ITEM_OWNERSHIP_CROSS_REPLAY_REPLICATION_V02';
const MANIFEST_PATH = resolve('output', 'cross_replay', 'replication_manifest_v01.json');
const SCRIPT140 = resolve('scripts', '140-discover-runtime-item-ownership-substrate-v01.mjs');
const SCRIPT141 = resolve('scripts', '141-validate-runtime-item-vector-semantics-v02.mjs');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'runtime_item_ownership_cross_replay_replication_v02.json');
const FORCE = process.argv.includes('--force');

const EXPECTED_140_STATUS = 'RUNTIME_ITEM_VECTOR_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION';
const EXPECTED_141_STATUS = 'RUNTIME_ITEM_VECTOR_V02_STRONG_SINGLE_REPLAY_OWNERSHIP_SEMANTICS';

// ============================================================
// V01 CORRECTION
//
// V01 completed all child replay analyses but crashed while serializing the
// aggregate output because it referenced allBestSpentBucketZero instead of
// the defined allBestBucketZero variable. V02 changes no scientific logic or
// thresholds; it fixes only the aggregate serialization name and writes a V02
// artifact. Existing READY/STRONG child artifacts are reused unless --force.
// ============================================================

// ============================================================
// PURPOSE
//
// Scripts 140-141 established strong discovery-replay evidence that
// CCitadelPlayerController.m_vecUpgrades is the player's runtime standard
// shop item vector. Script 142 performs the predeclared next step: replay-
// level replication on the five independent replays frozen by Script100.
//
// The replication unit is the replay, NOT individual item transitions.
// We do not refit thresholds per replay. Script140 and Script141 V02 are run
// unchanged. A replay counts as a semantic replication only if Script141 V02
// independently earns its existing READY status.
//
// Strong replication additionally requires that:
//   - every replay resolves the same spent-currency bucket (bucket 0),
//   - installed-build item-ID mapping remains very high,
//   - weighted true spend association stays high,
//   - shifted-time placebo stays low,
//   - exact price/component-credit agreement stays high.
//
// Failure on one replay is evidence to diagnose (including build drift), not
// permission to tune thresholds to that replay.
// ============================================================

for (const path of [MANIFEST_PATH, SCRIPT140, SCRIPT141]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
if (manifest?.readyToBeginReplication !== true) {
  throw new Error('Script100 replication manifest is not ready.');
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
console.log('RUNTIME ITEM OWNERSHIP CROSS-REPLAY REPLICATION V0.2');
console.log('========================================================');
console.log('');
console.log(`Discovery replay excluded: ${manifest.discoveryReplay ?? 'test'}`);
console.log(`Independent replays:       ${cohort.length}`);
console.log(`Force child reruns:        ${FORCE}`);
console.log('');

const replayResults = [];

for (let i = 0; i < cohort.length; i++) {
  const row = cohort[i];
  const replayName = String(row.replayName ?? '').trim();
  const replayPath = resolve('replays', `${replayName}.dem`);
  const output140 = resolve('output', replayName, 'runtime_item_ownership_substrate_v01.json');
  const output141 = resolve('output', replayName, 'runtime_item_vector_semantic_validation_v02.json');

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${cohort.length}] ${replayName}`);
  console.log('--------------------------------------------------------');

  if (!replayName || !existsSync(replayPath)) {
    console.log('FAIL: replay missing.');
    replayResults.push({
      replayName,
      replayPath,
      success: false,
      failureStage: 'REPLAY_MISSING',
      script140: null,
      script141: null,
    });
    continue;
  }

  const run140 = FORCE || !artifactHasStatus(output140, EXPECTED_140_STATUS);
  if (run140) {
    console.log('Running Script140...');
    const child = runNodeScript(SCRIPT140, replayPath);
    if (!child.ok) {
      console.log(`FAIL: Script140 exit=${child.exitCode}`);
      replayResults.push({ replayName, replayPath, success: false, failureStage: 'SCRIPT140_PROCESS', child });
      continue;
    }
  } else {
    console.log('Reusing READY Script140 artifact.');
  }

  const artifact140 = readJsonIfExists(output140);
  if (artifact140?.status !== EXPECTED_140_STATUS) {
    console.log(`FAIL: Script140 status=${artifact140?.status ?? 'missing'}`);
    replayResults.push({
      replayName,
      replayPath,
      success: false,
      failureStage: 'SCRIPT140_SEMANTIC_GATE',
      script140: summarize140(artifact140),
      script141: null,
    });
    continue;
  }

  const run141 = FORCE || !artifactHasStatus(output141, EXPECTED_141_STATUS);
  if (run141) {
    console.log('Running Script141 V02...');
    const child = runNodeScript(SCRIPT141, replayPath);
    if (!child.ok) {
      console.log(`FAIL: Script141 exit=${child.exitCode}`);
      replayResults.push({
        replayName,
        replayPath,
        success: false,
        failureStage: 'SCRIPT141_PROCESS',
        script140: summarize140(artifact140),
        child,
      });
      continue;
    }
  } else {
    console.log('Reusing STRONG Script141 V02 artifact.');
  }

  const artifact141 = readJsonIfExists(output141);
  const result = {
    replayName,
    replayPath,
    success: artifact141?.status === EXPECTED_141_STATUS,
    failureStage: artifact141?.status === EXPECTED_141_STATUS ? null : 'SCRIPT141_SEMANTIC_GATE',
    script140: summarize140(artifact140),
    script141: summarize141(artifact141),
  };

  replayResults.push(result);

  const s141 = result.script141;
  console.log(
    `status=${s141?.status ?? 'missing'} `
    + `bucket=${s141?.bestSpentBucket ?? 'n/a'} `
    + `assoc8=${formatPercent(s141?.additionAssociationWithin8)} `
    + `placebo32=${formatPercent(s141?.shiftedPlaceboAssociationWithin32)} `
    + `exact=${formatPercent(s141?.exactAmountAgreementRateAmongAssociated)}`
  );
  console.log('');
}

const semanticReplications = replayResults.filter(row => row.script141?.status === EXPECTED_141_STATUS);
const substrateReady = replayResults.filter(row => row.script140?.status === EXPECTED_140_STATUS);
const allBestBucketZero = semanticReplications.length === cohort.length
  && semanticReplications.every(row => row.script141.bestSpentBucket === 0);

const weighted = aggregateWeighted(semanticReplications);
const minimumStandardMappingRate = minFinite(
  replayResults.map(row => row.script140?.standardCatalogObservationRate)
);
const minimumKnownMappingRate = minFinite(
  replayResults.map(row => row.script140?.knownResourceObservationRate)
);

const checks = {
  manifestReady: check(manifest.readyToBeginReplication, true, manifest.readyToBeginReplication === true),
  independentCohortExpected: check(cohort.length, 5, cohort.length === 5),
  allSubstratesReady: check(substrateReady.length, cohort.length, substrateReady.length === cohort.length),
  allSemanticReplicationsStrong: check(semanticReplications.length, cohort.length, semanticReplications.length === cohort.length),
  sameSpentBucketReplicates: check(
    semanticReplications.map(row => row.script141.bestSpentBucket),
    'all bucket 0',
    allBestBucketZero
  ),
  standardCatalogMappingReplicates: check(
    minimumStandardMappingRate,
    '>=0.95 in every replay',
    minimumStandardMappingRate !== null && minimumStandardMappingRate >= 0.95
  ),
  knownResourceMappingReplicates: check(
    minimumKnownMappingRate,
    '>=0.95 in every replay',
    minimumKnownMappingRate !== null && minimumKnownMappingRate >= 0.95
  ),
  weightedImmediateSpendAssociationStrong: check(
    weighted.additionAssociationWithin8,
    '>=0.90',
    weighted.additionAssociationWithin8 !== null && weighted.additionAssociationWithin8 >= 0.90
  ),
  weightedPlaceboLow: check(
    weighted.shiftedPlaceboAssociationWithin32,
    '<=0.10',
    weighted.shiftedPlaceboAssociationWithin32 !== null && weighted.shiftedPlaceboAssociationWithin32 <= 0.10
  ),
  weightedTemporalAdvantageStrong: check(
    weighted.temporalAdvantageWithin32,
    '>=0.75',
    weighted.temporalAdvantageWithin32 !== null && weighted.temporalAdvantageWithin32 >= 0.75
  ),
  weightedExactAmountAgreementStrong: check(
    weighted.exactAmountAgreementRateAmongAssociated,
    '>=0.75',
    weighted.exactAmountAgreementRateAmongAssociated !== null
      && weighted.exactAmountAgreementRateAmongAssociated >= 0.75
  ),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'RUNTIME_ITEM_OWNERSHIP_V02_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
  : 'RUNTIME_ITEM_OWNERSHIP_V02_REPLICATION_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  discoveryReplayExcluded: manifest.discoveryReplay ?? 'test',
  replicationPolicy: {
    unit: 'REPLAY',
    cohortSource: MANIFEST_PATH,
    childScripts: [SCRIPT140, SCRIPT141],
    thresholdPolicy: 'Use Script140 V01 and Script141 V02 unchanged. Do not refit thresholds per replay.',
    failurePolicy: 'Treat failures as replication evidence or possible replay/build drift requiring diagnosis before any model changes.',
  },
  counts: {
    independentReplays: cohort.length,
    substrateReadyReplays: substrateReady.length,
    strongSemanticReplicationReplays: semanticReplications.length,
    failedReplays: cohort.length - semanticReplications.length,
  },
  replayResults,
  crossReplayEvidence: {
    allBestSpentBucketZero: allBestBucketZero,
    minimumKnownResourceObservationRate: minimumKnownMappingRate,
    minimumStandardCatalogObservationRate: minimumStandardMappingRate,
    weighted,
  },
  interpretation: {
    supported: validationPass
      ? 'Across the frozen independent replay cohort, m_vecUpgrades strongly replicates as the standard-shop runtime item-ownership vector: IDs map to the installed standard catalog, additions align tightly with same-player item spending, shifted-time placebo remains low, and transaction amounts substantially agree with catalog/component-credit expectations.'
      : 'The discovery-replay ownership hypothesis was tested without per-replay refitting. One or more replication gates failed and must be diagnosed before runtime item ownership is promoted to cross-replay current authority.',
    notClaimed: [
      'A vector removal is not automatically classified as a sale.',
      'A mixed add/remove transition is not automatically classified as a component upgrade.',
      'Installed-build item resource effects are not assumed active continuously merely because an item is owned.',
      'Cross-replay validation does not establish compatibility with replays from materially different game builds.',
    ],
  },
  validation: {
    pass: validationPass,
    checks,
  },
};

mkdirSync(resolve('output', 'cross_replay'), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('CROSS-REPLAY ITEM OWNERSHIP RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                    ${status}`);
console.log(`replication replays:       ${cohort.length}`);
console.log(`substrate READY:           ${substrateReady.length}/${cohort.length}`);
console.log(`semantic strong:           ${semanticReplications.length}/${cohort.length}`);
console.log(`all spent bucket 0:        ${allBestBucketZero}`);
console.log(`min known mapping:         ${formatPercent(minimumKnownMappingRate)}`);
console.log(`min standard mapping:      ${formatPercent(minimumStandardMappingRate)}`);
console.log(`weighted assoc <=8t:       ${formatPercent(weighted.additionAssociationWithin8)}`);
console.log(`weighted placebo <=32t:    ${formatPercent(weighted.shiftedPlaceboAssociationWithin32)}`);
console.log(`weighted advantage <=32t:  ${formatPercentagePoints(weighted.temporalAdvantageWithin32)}`);
console.log(`weighted exact agreement:  ${formatPercent(weighted.exactAmountAgreementRateAmongAssociated)}`);
console.log('');
console.log('REPLAY SUMMARY');
console.log('--------------');
for (const row of replayResults) {
  console.log(
    `${String(row.replayName).padEnd(8)} `
    + `140=${shortStatus(row.script140?.status)} `
    + `141=${shortStatus(row.script141?.status)} `
    + `bucket=${String(row.script141?.bestSpentBucket ?? 'n/a').padEnd(3)} `
    + `assoc8=${formatPercent(row.script141?.additionAssociationWithin8).padStart(7)} `
    + `placebo32=${formatPercent(row.script141?.shiftedPlaceboAssociationWithin32).padStart(7)} `
    + `exact=${formatPercent(row.script141?.exactAmountAgreementRateAmongAssociated).padStart(7)}`
  );
}
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function runNodeScript(scriptPath, replayPath) {
  const child = spawnSync(process.execPath, [scriptPath, replayPath], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: false,
  });
  return {
    ok: !child.error && child.status === 0,
    exitCode: child.status,
    signal: child.signal,
    error: child.error?.message ?? null,
  };
}

function artifactHasStatus(path, status) {
  const artifact = readJsonIfExists(path);
  return artifact?.status === status;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function summarize140(x) {
  if (!x) return null;
  return {
    status: x.status ?? null,
    playerControllers: x?.counts?.playerControllers ?? null,
    distinctObservedUpgradeIds: x?.counts?.distinctObservedUpgradeIds ?? null,
    distinctUnknownUpgradeIds: x?.counts?.distinctUnknownUpgradeIds ?? null,
    vectorTransitions: x?.counts?.transitions ?? null,
    additions: x?.counts?.additions ?? null,
    removals: x?.counts?.removals ?? null,
    knownResourceObservationRate: x?.mapping?.knownResourceObservationRate ?? null,
    standardCatalogObservationRate: x?.mapping?.standardCatalogObservationRate ?? null,
  };
}

function summarize141(x) {
  if (!x) return null;
  return {
    status: x.status ?? null,
    controllersObserved: x?.counts?.controllersObserved ?? null,
    additionTransitions: x?.counts?.additionTransitions ?? null,
    mixedTransitions: x?.counts?.mixedTransitions ?? null,
    bestSpentBucket: x?.ownershipSemanticEvidence?.bestSpentBucket ?? null,
    additionAssociationWithin8: x?.ownershipSemanticEvidence?.additionAssociationWithin8 ?? null,
    additionAssociationWithin32: x?.ownershipSemanticEvidence?.additionAssociationWithin32 ?? null,
    shiftedPlaceboAssociationWithin32: x?.ownershipSemanticEvidence?.shiftedPlaceboAssociationWithin32 ?? null,
    temporalAdvantageWithin32: x?.ownershipSemanticEvidence?.temporalAdvantageWithin32 ?? null,
    exactAmountAgreementCountWithin32: x?.ownershipSemanticEvidence?.exactAmountAgreementCountWithin32 ?? null,
    associatedAdditionsWithin32: x?.ownershipSemanticEvidence?.associatedAdditionsWithin32 ?? null,
    exactAmountAgreementRateAmongAssociated: x?.ownershipSemanticEvidence?.exactAmountAgreementRateAmongAssociated ?? null,
  };
}

function aggregateWeighted(rows) {
  let additionTotal = 0;
  let assoc8Numerator = 0;
  let assoc32Numerator = 0;
  let placebo32Numerator = 0;
  let exactNumerator = 0;
  let exactDenominator = 0;

  for (const row of rows) {
    const x = row.script141;
    const additions = x?.additionTransitions;
    if (Number.isFinite(additions) && additions > 0) {
      additionTotal += additions;
      if (Number.isFinite(x.additionAssociationWithin8)) assoc8Numerator += additions * x.additionAssociationWithin8;
      if (Number.isFinite(x.additionAssociationWithin32)) assoc32Numerator += additions * x.additionAssociationWithin32;
      if (Number.isFinite(x.shiftedPlaceboAssociationWithin32)) placebo32Numerator += additions * x.shiftedPlaceboAssociationWithin32;
    }
    if (Number.isFinite(x?.exactAmountAgreementCountWithin32)) exactNumerator += x.exactAmountAgreementCountWithin32;
    if (Number.isFinite(x?.associatedAdditionsWithin32)) exactDenominator += x.associatedAdditionsWithin32;
  }

  const assoc8 = safeRatio(assoc8Numerator, additionTotal);
  const assoc32 = safeRatio(assoc32Numerator, additionTotal);
  const placebo32 = safeRatio(placebo32Numerator, additionTotal);

  return {
    additionTransitions: additionTotal,
    additionAssociationWithin8: assoc8,
    additionAssociationWithin32: assoc32,
    shiftedPlaceboAssociationWithin32: placebo32,
    temporalAdvantageWithin32: bothFinite(assoc32, placebo32) ? assoc32 - placebo32 : null,
    exactAmountAgreementCountWithin32: exactNumerator,
    associatedAdditionsWithin32: exactDenominator,
    exactAmountAgreementRateAmongAssociated: safeRatio(exactNumerator, exactDenominator),
  };
}

function minFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

function safeRatio(n, d) {
  return Number.isFinite(n) && Number.isFinite(d) && d > 0 ? n / d : null;
}

function bothFinite(a, b) {
  return Number.isFinite(a) && Number.isFinite(b);
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function formatPercentagePoints(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)} pp` : 'n/a';
}

function shortStatus(status) {
  if (!status) return 'MISSING';
  if (status === EXPECTED_140_STATUS) return 'READY';
  if (status === EXPECTED_141_STATUS) return 'STRONG';
  return 'FAIL';
}
