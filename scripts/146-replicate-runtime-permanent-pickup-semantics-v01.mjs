import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = 'RUNTIME_PERMANENT_PICKUP_CROSS_REPLAY_REPLICATION_V01';
const CHILD_VERSION = 'RUNTIME_PERMANENT_PICKUP_SEMANTIC_VALIDATION_V01';
const STRONG_CHILD_STATUS = 'RUNTIME_PERMANENT_PICKUP_V01_STRONG_SINGLE_REPLAY_SEMANTICS';

const MANIFEST_PATH = resolve('output', 'cross_replay', 'replication_manifest_v01.json');
const SCRIPT145 = resolve('scripts', '145-validate-runtime-permanent-pickup-semantics-v01.mjs');
const DISCOVERY_ARTIFACT_PATH = resolve('output', 'test', 'runtime_permanent_pickup_semantic_validation_v01.json');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'runtime_permanent_pickup_cross_replay_replication_v01.json');
const FORCE = process.argv.includes('--force');

const EXPECTED_COHORT_SIZE = 5;
const EXPECTED_FAMILIES = 6;
const MIN_INDEPENDENT_REPLAYS_PER_FAMILY_FOR_STRONG_COVERAGE = 2;

// ============================================================
// PURPOSE
//
// Script145 V01 established strong single-replay semantics for
// CCitadelPlayerController.m_vecStatViewerModifierValues as a runtime
// permanent-pickup accumulation substrate. It resolved m_SourceModifierID
// through the Source2 compound EntitySubclassID_t token namespace:
//
//   <recordKey>/<modifierClass>
//
// Script146 freezes Script145 unchanged and tests those semantics on the five
// independent replays selected by Script100's replication manifest.
//
// IMPORTANT REPLICATION DISTINCTION
// ---------------------------------
// A replay is NOT required to observe all 18 pickup tiers or all six stat
// families. Failure to encounter a possible pickup is coverage, not semantic
// contradiction. Script145's discovery status intentionally required complete
// six-family coverage because test.dem was the calibration replay. Script146
// therefore reads the unchanged child artifact and separates:
//
//   1. FOUNDATION / INTEGRITY readiness,
//   2. SEMANTIC CONSISTENCY for the permanent rows actually observed,
//   3. CROSS-REPLAY COVERAGE strength.
//
// A replay is semantically consistent when observed permanent rows:
//   - use family-stable and family-distinct value types,
//   - match the discovery replay's frozen family -> m_eValType mapping,
//   - have positive changes that are exact multiples of the exact static
//     tier value from Script136 V02,
//   - show no negative in-place value deltas,
//   - and retain final values that are exact static-unit multiples.
//
// Unresolved or bridge source IDs are reported but are not automatically a
// contradiction to the permanent-pickup claim: m_vecStatViewerModifierValues
// may contain additional stat-UI modifier classes outside this claim's scope.
//
// Strong cross-replay replication additionally requires all six permanent
// families to appear across the independent cohort, with each family observed
// in at least two independent replays. This is explicitly a COVERAGE gate,
// not a per-replay semantic gate.
//
// No thresholds are fitted from rep01-rep05. A contradiction is diagnostic
// evidence and must not be repaired by tuning Script145 after inspection.
// ============================================================

for (const path of [MANIFEST_PATH, SCRIPT145, DISCOVERY_ARTIFACT_PATH]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const manifest = readJson(MANIFEST_PATH);
const discovery = readJson(DISCOVERY_ARTIFACT_PATH);

if (manifest?.readyToBeginReplication !== true) {
  throw new Error('Script100 replication manifest is not ready.');
}
if (discovery?.version !== CHILD_VERSION || discovery?.status !== STRONG_CHILD_STATUS) {
  throw new Error(
    `Discovery Script145 artifact is not frozen STRONG V01. version=${discovery?.version} status=${discovery?.status}`
  );
}

const discoveryFamilyMap = buildFamilyValueTypeMap(discovery);
if (discoveryFamilyMap.size !== EXPECTED_FAMILIES) {
  throw new Error(`Discovery family/value-type map is incomplete: ${discoveryFamilyMap.size}/${EXPECTED_FAMILIES}`);
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
console.log('RUNTIME PERMANENT PICKUP CROSS-REPLAY REPLICATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Discovery replay excluded:      ${manifest.discoveryReplay ?? 'test'}`);
console.log(`Independent replays:            ${cohort.length}`);
console.log(`Frozen child script:            ${SCRIPT145}`);
console.log(`Force child reruns:             ${FORCE}`);
console.log(`Strong family coverage rule:    all 6 families, >=${MIN_INDEPENDENT_REPLAYS_PER_FAMILY_FOR_STRONG_COVERAGE} independent replays each`);
console.log('');

const replayResults = [];

for (let i = 0; i < cohort.length; i++) {
  const cohortRow = cohort[i];
  const replayName = String(cohortRow?.replayName ?? '').trim();
  const replayPath = resolve('replays', `${replayName}.dem`);
  const artifactPath = resolve('output', replayName, 'runtime_permanent_pickup_semantic_validation_v01.json');

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${cohort.length}] ${replayName}`);
  console.log('--------------------------------------------------------');

  if (!replayName || !existsSync(replayPath)) {
    console.log('FAIL: replay missing.');
    replayResults.push({
      replayName,
      replayPath,
      artifactPath,
      processOk: false,
      failureStage: 'REPLAY_MISSING',
      semanticConsistencyPass: false,
      artifact: null,
      semanticChecks: {},
    });
    continue;
  }

  const existing = readJsonIfExists(artifactPath);
  const reusable = existing?.version === CHILD_VERSION;

  if (FORCE || !reusable) {
    console.log('Running frozen Script145 V01...');
    const child = runNodeScript(SCRIPT145, replayPath);
    if (!child.ok) {
      console.log(`FAIL: Script145 process exit=${child.exitCode}`);
      replayResults.push({
        replayName,
        replayPath,
        artifactPath,
        processOk: false,
        failureStage: 'SCRIPT145_PROCESS',
        child,
        semanticConsistencyPass: false,
        artifact: summarize145(readJsonIfExists(artifactPath)),
        semanticChecks: {},
      });
      continue;
    }
  } else {
    console.log(`Reusing Script145 V01 artifact (status=${existing.status ?? 'missing'}).`);
  }

  const artifact = readJsonIfExists(artifactPath);
  const evaluation = evaluateReplay(artifact, discoveryFamilyMap);
  const result = {
    replayName,
    replayPath,
    artifactPath,
    processOk: true,
    failureStage: evaluation.semanticConsistencyPass ? null : 'SEMANTIC_CONSISTENCY',
    semanticConsistencyPass: evaluation.semanticConsistencyPass,
    fullDiscoveryCoverageStatus: artifact?.status === STRONG_CHILD_STATUS,
    semanticChecks: evaluation.checks,
    familyEvidence: evaluation.familyEvidence,
    failedScript145Checks: failedValidationChecks(artifact),
    artifact: summarize145(artifact),
  };
  replayResults.push(result);

  console.log(
    `child=${shortStatus(artifact?.status)} `
    + `semantic=${evaluation.semanticConsistencyPass ? 'PASS' : 'FAIL'} `
    + `families=${evaluation.familyEvidence.length} `
    + `sources=${artifact?.counts?.observedPermanentSourceIds ?? 0} `
    + `+events=${artifact?.counts?.positivePermanentAccumulationEvents ?? 0} `
    + `exact=${formatPercent(artifact?.amountEvidence?.exactPositiveAmountRate)} `
    + `neg=${artifact?.counts?.negativeInPlacePermanentValueDeltas ?? 'n/a'}`
  );
  console.log('');
}

const semanticReplications = replayResults.filter(row => row.semanticConsistencyPass);
const fullDiscoveryCoverageChildren = replayResults.filter(row => row.fullDiscoveryCoverageStatus);

const familyReplication = buildFamilyReplication(replayResults, discoveryFamilyMap);
const sourceReplication = buildSourceReplication(replayResults, discovery);

const totalPositiveEvents = sumFinite(replayResults.map(row => row.artifact?.positivePermanentAccumulationEvents));
const totalExactPositiveEvents = sumFinite(replayResults.map(row => row.artifact?.exactPositiveAmountEvents));
const totalInferredPickupUnits = sumFinite(replayResults.map(row => row.artifact?.inferredPermanentPickupUnits));
const totalNegativeInPlace = sumFinite(replayResults.map(row => row.artifact?.negativeInPlacePermanentValueDeltas));
const totalFinalRowsWithResolvedUnit = sumFinite(replayResults.map(row => row.artifact?.finalRowsWithResolvedUnit));
const totalFinalExactUnitMultiples = sumFinite(replayResults.map(row => row.artifact?.finalRowsExactUnitMultiple));

const aggregateExactPositiveRate = safeRatio(totalExactPositiveEvents, totalPositiveEvents);
const aggregateFinalExactRate = safeRatio(totalFinalExactUnitMultiples, totalFinalRowsWithResolvedUnit);

const familiesObservedAcrossCohort = familyReplication.filter(row => row.replaysObserved > 0).length;
const familiesReplicatedAtLeastTwice = familyReplication.filter(
  row => row.replaysObserved >= MIN_INDEPENDENT_REPLAYS_PER_FAMILY_FOR_STRONG_COVERAGE
).length;
const observedPermanentSourceIdsAcrossCohort = sourceReplication.filter(row => row.replaysObserved > 0).length;

const semanticChecks = {
  manifestReady: check(manifest.readyToBeginReplication, true, manifest.readyToBeginReplication === true),
  independentCohortExpected: check(cohort.length, EXPECTED_COHORT_SIZE, cohort.length === EXPECTED_COHORT_SIZE),
  discoveryArtifactFrozenStrong: check(discovery.status, STRONG_CHILD_STATUS, discovery.status === STRONG_CHILD_STATUS),
  allReplayProcessesCompleted: check(
    replayResults.filter(row => row.processOk).length,
    cohort.length,
    replayResults.length === cohort.length && replayResults.every(row => row.processOk)
  ),
  allIndependentReplaysSemanticallyConsistent: check(
    semanticReplications.length,
    cohort.length,
    semanticReplications.length === cohort.length
  ),
  aggregatePositiveEvidenceObserved: check(totalPositiveEvents, '>0', totalPositiveEvents > 0),
  aggregatePositiveAmountsExact: check(
    totalExactPositiveEvents,
    totalPositiveEvents,
    totalPositiveEvents > 0 && totalExactPositiveEvents === totalPositiveEvents
  ),
  noNegativeInPlaceDeltasAcrossCohort: check(totalNegativeInPlace, 0, totalNegativeInPlace === 0),
  aggregateFinalValuesExact: check(
    totalFinalExactUnitMultiples,
    totalFinalRowsWithResolvedUnit,
    totalFinalRowsWithResolvedUnit > 0 && totalFinalExactUnitMultiples === totalFinalRowsWithResolvedUnit
  ),
};

const coverageChecks = {
  allSixFamiliesObservedAcrossCohort: check(
    familiesObservedAcrossCohort,
    EXPECTED_FAMILIES,
    familiesObservedAcrossCohort === EXPECTED_FAMILIES
  ),
  everyFamilyObservedInAtLeastTwoIndependentReplays: check(
    familiesReplicatedAtLeastTwice,
    EXPECTED_FAMILIES,
    familiesReplicatedAtLeastTwice === EXPECTED_FAMILIES
  ),
};

const semanticReplicationPass = Object.values(semanticChecks).every(row => row.pass);
const strongCoveragePass = Object.values(coverageChecks).every(row => row.pass);

const status = semanticReplicationPass && strongCoveragePass
  ? 'RUNTIME_PERMANENT_PICKUP_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
  : semanticReplicationPass
    ? 'RUNTIME_PERMANENT_PICKUP_V01_REPLICATED_CONSISTENT_COVERAGE_LIMITED'
    : 'RUNTIME_PERMANENT_PICKUP_V01_REPLICATION_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  discoveryReplayExcluded: manifest.discoveryReplay ?? 'test',
  foundations: {
    replicationManifest: MANIFEST_PATH,
    frozenDiscoveryArtifact: DISCOVERY_ARTIFACT_PATH,
    frozenChildScript: SCRIPT145,
    childVersion: CHILD_VERSION,
    childStrongStatus: STRONG_CHILD_STATUS,
    discoveryFamilyValueTypes: Object.fromEntries(discoveryFamilyMap),
  },
  replicationPolicy: {
    unit: 'REPLAY',
    cohortSource: MANIFEST_PATH,
    discoveryReplayExcluded: true,
    childScriptFrozen: true,
    thresholdPolicy: 'Run Script145 V01 unchanged. Do not refit Source IDs, family/value-type mappings, amount rules, or permanence rules on rep01-rep05.',
    coveragePolicy: 'Absence of an unobserved family/tier is coverage, not contradiction. Semantic consistency is judged only on permanent rows actually observed. Strong replication additionally requires all six families across the cohort and each family in at least two independent replays.',
    outOfScopeSourcePolicy: 'Bridge or unresolved stat-viewer source IDs are reported but do not automatically contradict the permanent-pickup claim.',
    failurePolicy: 'Any mapped permanent row with family-instability, discovery-value-type disagreement, non-integral static-unit amount behavior, or negative in-place delta is contradictory evidence requiring diagnosis rather than threshold tuning.',
  },
  counts: {
    independentReplays: cohort.length,
    processCompleteReplays: replayResults.filter(row => row.processOk).length,
    semanticallyConsistentReplays: semanticReplications.length,
    fullDiscoveryCoverageChildStatuses: fullDiscoveryCoverageChildren.length,
    failedSemanticReplays: cohort.length - semanticReplications.length,
    familiesObservedAcrossCohort,
    familiesReplicatedAtLeastTwice,
    permanentSourceCandidatesObservedAcrossCohort: observedPermanentSourceIdsAcrossCohort,
    permanentSourceCandidatesPossible: sourceReplication.length,
    totalPositivePermanentAccumulationEvents: totalPositiveEvents,
    totalExactPositiveAmountEvents: totalExactPositiveEvents,
    totalInferredPermanentPickupUnits: totalInferredPickupUnits,
    totalNegativeInPlacePermanentValueDeltas: totalNegativeInPlace,
    totalFinalRowsWithResolvedUnit,
    totalFinalExactUnitMultiples,
  },
  aggregateEvidence: {
    exactPositiveAmountRate: aggregateExactPositiveRate,
    finalExactUnitMultipleRate: aggregateFinalExactRate,
    familyReplication,
    sourceReplication,
  },
  replayResults,
  interpretation: {
    supported: semanticReplicationPass && strongCoveragePass
      ? 'Across the frozen independent replay cohort, the compound Source2 subclass namespace and value behavior strongly replicate m_vecStatViewerModifierValues as runtime permanent-pickup accumulation evidence. Observed permanent rows preserve the discovery family/value-type mapping, positive changes are exact static-tier unit multiples, retained values are exact unit multiples, and no negative in-place deltas contradict permanence.'
      : semanticReplicationPass
        ? 'Observed permanent-pickup rows are semantically consistent across all independent replays tested, but the predeclared cross-replay family-coverage criterion was not fully met. This is coverage-limited replication rather than contradictory evidence.'
        : 'One or more independent replays contradict or fail the frozen permanent-pickup semantic rules. Diagnose the specific replay/check before promoting runtime permanent-buff ownership.',
    ownershipMeaning: semanticReplicationPass
      ? 'For an observed resolved permanent pickup record/tier, m_flValue divided by the exact Script136 V02 per-pickup effect is supported as cumulative pickup count, and positive integral count deltas are supported as runtime acquisition increments subject to the stated scope.'
      : 'Do not promote cumulative pickup counts or acquisition increments to cross-replay authority until failed semantic checks are explained.',
    notClaimed: [
      'Physical producer/object attribution for each pickup.',
      'A Golden Statue/Lion Statue causal link.',
      'Bridge powerup activation, expiration, or 160-second lifetime semantics.',
      'Exact downstream effective-stat composition with items, hero scaling, or conditional modifiers.',
      'Compatibility across materially different game builds.',
      'Row removal as semantic loss of a permanent pickup.',
    ],
  },
  validation: {
    pass: semanticReplicationPass && strongCoveragePass,
    semanticReplicationPass,
    strongCoveragePass,
    semanticChecks,
    coverageChecks,
  },
  nextStage: semanticReplicationPass && strongCoveragePass
    ? 'PROMOTE_RUNTIME_PERMANENT_BUFF_OWNERSHIP_CLAIM_THEN_VALIDATE_BRIDGE_POWERUP_RUNTIME_SEMANTICS'
    : semanticReplicationPass
      ? 'COLLECT_ADDITIONAL_INDEPENDENT_REPLAY_COVERAGE_WITHOUT_RETUNING_SEMANTICS'
      : 'DIAGNOSE_ONLY_FAILED_REPLAY_SEMANTIC_CHECKS_BEFORE_ANY_MODEL_CHANGE',
};

mkdirSync(resolve('output', 'cross_replay'), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('CROSS-REPLAY PERMANENT PICKUP RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                          ${status}`);
console.log(`independent replays:             ${cohort.length}`);
console.log(`semantic consistency:            ${semanticReplications.length}/${cohort.length}`);
console.log(`full Script145 STRONG statuses:  ${fullDiscoveryCoverageChildren.length}/${cohort.length}`);
console.log(`families observed cohort:        ${familiesObservedAcrossCohort}/${EXPECTED_FAMILIES}`);
console.log(`families observed >=2 replays:   ${familiesReplicatedAtLeastTwice}/${EXPECTED_FAMILIES}`);
console.log(`source candidates observed:      ${observedPermanentSourceIdsAcrossCohort}/${sourceReplication.length}`);
console.log(`positive accumulation events:    ${totalPositiveEvents}`);
console.log(`exact amount events:             ${totalExactPositiveEvents}/${totalPositiveEvents} (${formatPercent(aggregateExactPositiveRate)})`);
console.log(`inferred pickup units:           ${totalInferredPickupUnits}`);
console.log(`negative in-place deltas:        ${totalNegativeInPlace}`);
console.log(`final exact unit multiples:      ${totalFinalExactUnitMultiples}/${totalFinalRowsWithResolvedUnit} (${formatPercent(aggregateFinalExactRate)})`);
console.log('');
console.log('REPLAY SUMMARY');
console.log('--------------');
for (const row of replayResults) {
  console.log(
    `${String(row.replayName).padEnd(8)} `
    + `semantic=${row.semanticConsistencyPass ? 'PASS' : 'FAIL'} `
    + `child=${shortStatus(row.artifact?.status)} `
    + `families=${String(row.artifact?.familiesObserved ?? 0).padStart(1)} `
    + `sources=${String(row.artifact?.observedPermanentSourceIds ?? 0).padStart(2)} `
    + `events=${String(row.artifact?.positivePermanentAccumulationEvents ?? 0).padStart(3)} `
    + `exact=${formatPercent(row.artifact?.exactPositiveAmountRate).padStart(7)} `
    + `neg=${String(row.artifact?.negativeInPlacePermanentValueDeltas ?? 'n/a').padStart(3)}`
  );
}
console.log('');
console.log('FAMILY REPLICATION');
console.log('------------------');
for (const row of familyReplication) {
  console.log(
    `${row.family.padEnd(28)} `
    + `valueType=${String(row.discoveryValueType).padStart(3)} `
    + `replays=${row.replaysObserved}/${cohort.length} `
    + `events=${row.positiveAccumulationEvents}`
  );
}
console.log('');
console.log('SEMANTIC VALIDATION');
console.log('-------------------');
for (const [name, row] of Object.entries(semanticChecks)) {
  console.log(`${name.padEnd(50)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log('COVERAGE VALIDATION');
console.log('-------------------');
for (const [name, row] of Object.entries(coverageChecks)) {
  console.log(`${name.padEnd(50)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function evaluateReplay(artifact, discoveryMap) {
  const foundationNames = [
    'registryPermanentResourceContractCurrent',
    'script136ContractReady',
    'subclassHashCollisionsAbsent',
    'permanentSubclassCandidatesExpected',
    'playerControllersObserved',
    'statViewerChildMutationsObserved',
  ];

  const foundationPass = artifact?.version === CHILD_VERSION
    && foundationNames.every(name => artifact?.validation?.checks?.[name]?.pass === true);

  const familyEvidence = Array.isArray(artifact?.familyValueTypeEvidence?.families)
    ? artifact.familyValueTypeEvidence.families
    : [];

  const stableObservedFamilies = familyEvidence.length > 0
    && familyEvidence.every(row => row?.stableSingleValueType === true && row?.valueTypes?.length === 1);

  const observedValueTypes = familyEvidence
    .map(row => row?.valueTypes?.length === 1 ? row.valueTypes[0] : null)
    .filter(Number.isInteger);
  const distinctObservedFamilies = observedValueTypes.length === familyEvidence.length
    && new Set(observedValueTypes).size === observedValueTypes.length;

  const discoveryAgreement = familyEvidence.length > 0 && familyEvidence.every(row => {
    const expected = discoveryMap.get(row.family);
    return Number.isInteger(expected)
      && row?.valueTypes?.length === 1
      && row.valueTypes[0] === expected;
  });

  const positiveEvents = artifact?.counts?.positivePermanentAccumulationEvents ?? 0;
  const exactPositiveEvents = artifact?.counts?.exactPositiveAmountEvents ?? 0;
  const finalRowsWithResolvedUnit = artifact?.amountEvidence?.finalRowsWithResolvedUnit ?? 0;
  const finalRowsExactUnitMultiple = artifact?.amountEvidence?.finalRowsExactUnitMultiple ?? 0;

  const checks = {
    childArtifactVersionCorrect: check(artifact?.version ?? null, CHILD_VERSION, artifact?.version === CHILD_VERSION),
    foundationIntegrityReady: check(foundationPass, true, foundationPass),
    permanentEvidenceObserved: check(artifact?.counts?.observedPermanentSourceIds ?? 0, '>0', (artifact?.counts?.observedPermanentSourceIds ?? 0) > 0),
    observedFamiliesStable: check(
      familyEvidence.filter(row => row?.stableSingleValueType === true).length,
      familyEvidence.length,
      stableObservedFamilies
    ),
    observedFamiliesDistinct: check(new Set(observedValueTypes).size, familyEvidence.length, distinctObservedFamilies),
    discoveryFamilyValueTypesReplicate: check(
      familyEvidence.map(row => ({ family: row.family, valueTypes: row.valueTypes })),
      Object.fromEntries(discoveryMap),
      discoveryAgreement
    ),
    positiveAccumulationObserved: check(positiveEvents, '>0', positiveEvents > 0),
    allPositiveAmountsExactStaticMultiples: check(
      exactPositiveEvents,
      positiveEvents,
      positiveEvents > 0 && exactPositiveEvents === positiveEvents
    ),
    noNegativeInPlaceDeltas: check(
      artifact?.counts?.negativeInPlacePermanentValueDeltas ?? null,
      0,
      artifact?.counts?.negativeInPlacePermanentValueDeltas === 0
    ),
    finalValuesExactStaticMultiples: check(
      finalRowsExactUnitMultiple,
      finalRowsWithResolvedUnit,
      finalRowsWithResolvedUnit > 0 && finalRowsExactUnitMultiple === finalRowsWithResolvedUnit
    ),
  };

  return {
    semanticConsistencyPass: Object.values(checks).every(row => row.pass),
    checks,
    familyEvidence,
  };
}

function buildFamilyValueTypeMap(artifact) {
  const out = new Map();
  for (const row of artifact?.familyValueTypeEvidence?.families ?? []) {
    if (typeof row?.family !== 'string' || row?.valueTypes?.length !== 1 || !Number.isInteger(row.valueTypes[0])) continue;
    out.set(row.family, row.valueTypes[0]);
  }
  return out;
}

function buildFamilyReplication(results, discoveryMap) {
  const out = [];
  for (const [family, discoveryValueType] of [...discoveryMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const observedRows = [];
    let positiveAccumulationEvents = 0;
    let inferredPickupUnits = 0;

    for (const replay of results) {
      const familyRow = replay.familyEvidence?.find(row => row.family === family);
      if (familyRow) observedRows.push({ replayName: replay.replayName, valueTypes: familyRow.valueTypes, tiersObserved: familyRow.tiersObserved });

      for (const record of replay?.artifact?.permanentRecordSummary ?? []) {
        if (record?.family !== family) continue;
        positiveAccumulationEvents += finiteOrZero(record?.positiveAccumulationEvents);
        inferredPickupUnits += finiteOrZero(record?.inferredPickupUnits);
      }
    }

    out.push({
      family,
      discoveryValueType,
      replaysObserved: observedRows.length,
      replayEvidence: observedRows,
      positiveAccumulationEvents,
      inferredPickupUnits,
    });
  }
  return out;
}

function buildSourceReplication(results, discovery) {
  const candidates = discovery?.sourceNamespaceEvidence?.permanentCandidates ?? [];
  return candidates.map(candidate => {
    const replayEvidence = [];
    let positiveAccumulationEvents = 0;
    let inferredPickupUnits = 0;

    for (const replay of results) {
      const record = replay?.artifact?.permanentRecordSummary?.find(
        row => row?.sourceModifierId === candidate?.sourceModifierId
      );
      if (!record?.observed) continue;
      replayEvidence.push({
        replayName: replay.replayName,
        positiveAccumulationEvents: record.positiveAccumulationEvents ?? 0,
        inferredPickupUnits: record.inferredPickupUnits ?? 0,
        valueTypes: record.valueTypes ?? [],
      });
      positiveAccumulationEvents += finiteOrZero(record.positiveAccumulationEvents);
      inferredPickupUnits += finiteOrZero(record.inferredPickupUnits);
    }

    return {
      sourceModifierId: candidate.sourceModifierId,
      recordKey: candidate.recordKey,
      family: candidate.family,
      tier: candidate.tier,
      expectedUnitValue: candidate.effects?.[0]?.value ?? null,
      replaysObserved: replayEvidence.length,
      replayEvidence,
      positiveAccumulationEvents,
      inferredPickupUnits,
    };
  }).sort((a, b) => a.sourceModifierId - b.sourceModifierId);
}

function summarize145(x) {
  if (!x) return null;
  return {
    version: x.version ?? null,
    status: x.status ?? null,
    playerControllers: x?.counts?.playerControllers ?? null,
    rowTransitions: x?.counts?.rowTransitions ?? null,
    distinctObservedSourceIds: x?.counts?.distinctObservedSourceIds ?? null,
    observedPermanentSourceIds: x?.counts?.observedPermanentSourceIds ?? null,
    observedBridgeSourceIds: x?.counts?.observedBridgeSourceIds ?? null,
    unresolvedObservedSourceIds: x?.counts?.unresolvedObservedSourceIds ?? null,
    permanentSubclassCandidatesObserved: x?.counts?.permanentSubclassCandidatesObserved ?? null,
    familiesObserved: x?.familyValueTypeEvidence?.families?.length ?? 0,
    stableFamilies: x?.familyValueTypeEvidence?.familiesWithStableSingleValueType ?? null,
    distinctStableFamilyValueTypes: x?.familyValueTypeEvidence?.distinctStableFamilyValueTypes ?? null,
    positivePermanentAccumulationEvents: x?.counts?.positivePermanentAccumulationEvents ?? null,
    exactPositiveAmountEvents: x?.counts?.exactPositiveAmountEvents ?? null,
    exactPositiveAmountRate: x?.amountEvidence?.exactPositiveAmountRate ?? null,
    inferredPermanentPickupUnits: x?.counts?.inferredPermanentPickupUnits ?? null,
    negativeInPlacePermanentValueDeltas: x?.counts?.negativeInPlacePermanentValueDeltas ?? null,
    permanentRowRemovals: x?.counts?.permanentRowRemovals ?? null,
    finalPermanentRows: x?.counts?.finalPermanentRows ?? null,
    finalRowsWithResolvedUnit: x?.amountEvidence?.finalRowsWithResolvedUnit ?? null,
    finalRowsExactUnitMultiple: x?.amountEvidence?.finalRowsExactUnitMultiple ?? null,
    finalUnitMultipleRate: x?.amountEvidence?.finalUnitMultipleRate ?? null,
    permanentRecordSummary: x?.permanentRecordSummary ?? [],
  };
}

function failedValidationChecks(artifact) {
  if (!artifact?.validation?.checks) return [];
  return Object.entries(artifact.validation.checks)
    .filter(([, row]) => row?.pass !== true)
    .map(([name, row]) => ({ name, actual: row?.actual ?? null, expected: row?.expected ?? null }));
}

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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function sumFinite(values) {
  return values.reduce((sum, value) => sum + finiteOrZero(value), 0);
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function shortStatus(status) {
  if (!status) return 'missing';
  if (status === STRONG_CHILD_STATUS) return 'STRONG';
  if (status.includes('REQUIRES_DIAGNOSIS')) return 'DIAG';
  return status.slice(0, 18);
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}
