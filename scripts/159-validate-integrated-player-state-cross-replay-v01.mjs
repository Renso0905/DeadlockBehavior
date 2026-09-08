import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { getClaim } from '../src/contracts/claim-registry.mjs';
import { validateIntegratedPlayerStateArtifact } from '../src/player-state/integrated-state-validation.mjs';

const VERSION = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_CROSS_REPLAY_VALIDATION_V01';
const SCRIPT158_VERSION = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01';
const SCRIPT158_READY = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION';
const SCRIPT158_DIAGNOSIS = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_REQUIRES_DIAGNOSIS';
const STRONG_STATUS = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS';
const FORCE = process.argv.includes('--force');

const SCRIPT158_SIMPLE_COVERAGE_CHECKS = new Set([
  'playerControllersObserved',
  'timelineEventsObserved',
  'shopTransitionsObserved',
  'permanentTransitionsObserved',
  'permanentFamiliesObserved',
]);

const MANIFEST_PATH = resolve('output', 'cross_replay', 'replication_manifest_v01.json');
const SCRIPT158_PATH = resolve('scripts', '158-build-integrated-authoritative-player-state-substrate-v01.mjs');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'integrated_authoritative_player_state_cross_replay_validation_v01.json');

if (!existsSync(MANIFEST_PATH)) throw new Error(`Missing Script100 replication manifest:\n${MANIFEST_PATH}`);
if (!existsSync(SCRIPT158_PATH)) throw new Error(`Missing Script158:\n${SCRIPT158_PATH}`);

const manifest = readJson(MANIFEST_PATH);
if (manifest?.readyToBeginReplication !== true) {
  throw new Error('Script100 replication manifest is not readyToBeginReplication=true.');
}
const cohort = Array.isArray(manifest?.selectedReplicationCohort) ? manifest.selectedReplicationCohort : [];
if (cohort.length === 0) throw new Error('Script100 replication cohort is empty.');

const playerStateClaim = getClaim('player_state_t_v1');
const effectiveWeaponClaim = getClaim('effective_weapon_state');

console.log('');
console.log('========================================================');
console.log('INTEGRATED PLAYER-STATE CROSS-REPLAY VALIDATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Independent replay cohort:       ${cohort.length}`);
console.log(`Force Script158 regeneration:    ${FORCE}`);
console.log('Validation policy:               coverage is diagnostic; contradictions are semantic');
console.log('Promotion policy:                NO registry mutation in Script159');
console.log('');

const replayResults = [];

for (let index = 0; index < cohort.length; index++) {
  const replayName = String(cohort[index]?.replayName ?? '').trim();
  if (!replayName) {
    replayResults.push({
      replayName: null,
      integrityValidation: { pass: false, reason: 'MANIFEST_REPLAY_NAME_MISSING' },
      semanticValidation: { pass: false, contradictions: [{ code: 'MANIFEST_REPLAY_NAME_MISSING' }] },
      coverageDiagnostics: { complete: false },
    });
    continue;
  }

  const replayPath = resolve('replays', `${replayName}.dem`);
  const artifactPath = resolve('output', replayName, 'integrated_authoritative_player_state_substrate_v01.json');

  console.log('--------------------------------------------------------');
  console.log(`[${index + 1}/${cohort.length}] ${replayName}`);
  console.log('--------------------------------------------------------');

  if (!existsSync(replayPath)) {
    console.log('integrity: FAIL — replay file missing');
    replayResults.push({
      replayName,
      replayPath,
      artifactPath,
      generated: false,
      integrityValidation: { pass: false, reason: 'REPLAY_FILE_MISSING' },
      semanticValidation: { pass: false, contradictions: [{ code: 'REPLAY_FILE_MISSING' }] },
      coverageDiagnostics: { complete: false },
    });
    continue;
  }

  const reusable = !FORCE && isReusableScript158Artifact(artifactPath);
  if (!reusable) {
    console.log('[build] running Script158...');
    const child = spawnSync(
      process.execPath,
      [SCRIPT158_PATH, replayPath],
      { stdio: 'inherit' },
    );
    if (child.status !== 0) {
      console.log(`integrity: FAIL — Script158 exit=${child.status}`);
      replayResults.push({
        replayName,
        replayPath,
        artifactPath,
        generated: true,
        integrityValidation: { pass: false, reason: 'SCRIPT158_EXECUTION_FAILED', exitCode: child.status },
        semanticValidation: { pass: false, contradictions: [{ code: 'SCRIPT158_EXECUTION_FAILED' }] },
        coverageDiagnostics: { complete: false },
      });
      continue;
    }
  } else {
    console.log('[reuse] Script158 V01 artifact');
  }

  if (!existsSync(artifactPath)) {
    console.log('integrity: FAIL — Script158 output missing');
    replayResults.push({
      replayName,
      replayPath,
      artifactPath,
      generated: !reusable,
      integrityValidation: { pass: false, reason: 'SCRIPT158_OUTPUT_MISSING' },
      semanticValidation: { pass: false, contradictions: [{ code: 'SCRIPT158_OUTPUT_MISSING' }] },
      coverageDiagnostics: { complete: false },
    });
    continue;
  }

  const artifact = readJson(artifactPath);
  const failedScript158Rows = Object.entries(artifact?.integrityValidation ?? {})
    .filter(([, row]) => row?.pass !== true);
  const failedScript158Checks = failedScript158Rows.map(([name]) => name);
  const coverageLikeScript158Failures = failedScript158Rows
    .filter(([name, row]) => isScript158CoverageOnlyFailure(name, row))
    .map(([name]) => name);
  const hardIntegrityFailures = failedScript158Rows
    .filter(([name, row]) => !isScript158CoverageOnlyFailure(name, row))
    .map(([name]) => name);
  const script158StatusUsable = [SCRIPT158_READY, SCRIPT158_DIAGNOSIS].includes(artifact?.status);

  const integrityChecks = {
    script158VersionExpected: check(artifact?.version, SCRIPT158_VERSION, artifact?.version === SCRIPT158_VERSION),
    script158StatusRecognized: check(artifact?.status, `${SCRIPT158_READY} or ${SCRIPT158_DIAGNOSIS}`, script158StatusUsable),
    noHardScript158IntegrityFailures: check(hardIntegrityFailures.length, 0, hardIntegrityFailures.length === 0),
    replayNameMatches: check(artifact?.replay?.replayName, replayName, artifact?.replay?.replayName === replayName),
    playerStateClaimStillMissing: check(playerStateClaim?.authorityStatus, 'missing', playerStateClaim?.authorityStatus === 'missing'),
    effectiveWeaponClaimStillMissing: check(effectiveWeaponClaim?.authorityStatus, 'missing', effectiveWeaponClaim?.authorityStatus === 'missing'),
  };
  const integrityPass = Object.values(integrityChecks).every(row => row.pass);

  const validation = validateIntegratedPlayerStateArtifact(artifact);
  const semanticPass = integrityPass && validation.semanticValidation.pass;

  const result = {
    replayName,
    replayPath,
    artifactPath,
    generated: !reusable,
    script158Status: artifact?.status ?? null,
    failedScript158Checks,
    coverageLikeScript158Failures,
    hardIntegrityFailures,
    integrityValidation: {
      pass: integrityPass,
      checks: integrityChecks,
    },
    semanticValidation: {
      ...validation.semanticValidation,
      pass: semanticPass,
    },
    coverageDiagnostics: validation.coverageDiagnostics,
    metrics: validation.metrics,
  };
  replayResults.push(result);

  console.log(`integrity:                        ${integrityPass ? 'PASS' : 'FAIL'}`);
  console.log(`semantic:                         ${semanticPass ? 'PASS' : 'FAIL'}`);
  console.log(`coverage complete:                ${validation.coverageDiagnostics.complete}`);
  console.log(`players / events:                 ${validation.metrics.players} / ${validation.metrics.timelineEvents}`);
  console.log(`item transitions:                 ${validation.metrics.itemTransitions}`);
  console.log(`permanent families:               ${validation.metrics.permanentFamiliesObserved.length}/6`);
  console.log(`bridge intervals:                 ${validation.metrics.bridgeIntervals}`);
  if (validation.semanticValidation.contradictions.length > 0) {
    console.log(`contradictions:                   ${validation.semanticValidation.contradictions.length}`);
    for (const row of validation.semanticValidation.contradictions.slice(0, 5)) {
      console.log(`  - ${row.code}`);
    }
  }
  console.log('');
}

const integrityPassReplays = replayResults.filter(row => row?.integrityValidation?.pass === true).length;
const semanticPassReplays = replayResults.filter(row => row?.semanticValidation?.pass === true).length;
const coverageCompleteReplays = replayResults.filter(row => row?.coverageDiagnostics?.complete === true).length;
const totalPlayers = sum(replayResults.map(row => row?.metrics?.players));
const totalTimelineEvents = sum(replayResults.map(row => row?.metrics?.timelineEvents));
const totalItemTransitions = sum(replayResults.map(row => row?.metrics?.itemTransitions));
const totalBridgeIntervals = sum(replayResults.map(row => row?.metrics?.bridgeIntervals));
const cohortPermanentFamilies = new Set(
  replayResults.flatMap(row => row?.metrics?.permanentFamiliesObserved ?? []),
);
const totalContradictions = sum(replayResults.map(row => row?.semanticValidation?.contradictions?.length));

const cohortCoverageChecks = {
  independentCohortExactlyFive: check(cohort.length, 5, cohort.length === 5),
  allReplaysContainPlayers: check(replayResults.filter(row => (row?.metrics?.players ?? 0) >= 10).length, cohort.length, replayResults.every(row => (row?.metrics?.players ?? 0) >= 10)),
  shopLayerExercisedEveryReplay: check(replayResults.filter(row => (row?.metrics?.itemTransitions ?? 0) > 0).length, cohort.length, replayResults.every(row => (row?.metrics?.itemTransitions ?? 0) > 0)),
  permanentLayerExercisedEveryReplay: check(replayResults.filter(row => (row?.metrics?.permanentStateEvents ?? 0) > 0).length, cohort.length, replayResults.every(row => (row?.metrics?.permanentStateEvents ?? 0) > 0)),
  bridgeLayerExercisedEveryReplay: check(replayResults.filter(row => (row?.metrics?.bridgeIntervals ?? 0) > 0).length, cohort.length, replayResults.every(row => (row?.metrics?.bridgeIntervals ?? 0) > 0)),
  sixPermanentFamiliesAcrossCohort: check(cohortPermanentFamilies.size, 6, cohortPermanentFamilies.size === 6),
};
const cohortCoverageAdequate = Object.values(cohortCoverageChecks).every(row => row.pass);

const integrityValidationPass = cohort.length === 5 && replayResults.length === cohort.length && integrityPassReplays === cohort.length;
const semanticValidationPass = integrityValidationPass && semanticPassReplays === cohort.length && totalContradictions === 0;
const replicationStatus = semanticValidationPass && cohortCoverageAdequate
  ? 'cross_replay_replicated'
  : semanticValidationPass
    ? 'multi_replay_supported'
    : 'not_replicated';
const status = replicationStatus === 'cross_replay_replicated'
  ? STRONG_STATUS
  : semanticValidationPass
    ? 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_V01_SEMANTICALLY_CONSISTENT_WITH_COVERAGE_GAPS'
    : 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  foundations: {
    replicationManifest: MANIFEST_PATH,
    script158: SCRIPT158_PATH,
    script158Version: SCRIPT158_VERSION,
    playerStateClaim: {
      claimId: playerStateClaim?.claimId ?? 'player_state_t_v1',
      authorityStatus: playerStateClaim?.authorityStatus ?? null,
    },
    effectiveWeaponClaim: {
      claimId: effectiveWeaponClaim?.claimId ?? 'effective_weapon_state',
      authorityStatus: effectiveWeaponClaim?.authorityStatus ?? null,
    },
  },
  validationPolicy: {
    frozenBeforeReplicationInspection: true,
    coverageVsSemantics:
      'Missing layer exposure is reported as coverage. Contradictions require a structural inconsistency in the integrated event stream or its authoritative ownership projections.',
    semanticGates: [
      'strictly increasing per-player event ticks',
      'deterministic final-state reconstruction from event stream',
      'coherent standard-shop add/remove set mutations',
      'all item effectInputRef values resolve to Script139-derived top-level inputs',
      'stable resolved player identity',
      'finite nonnegative and monotonic permanent-buff accumulation',
      'well-formed 160-second/death/censor bridge intervals',
      'bridge acquisition/end boundary events present',
      'active bridge interval projection exact at every saved player event',
    ],
    noRegistryPromotion: true,
  },
  cohort: {
    requestedReplays: cohort.length,
    integrityPassReplays,
    semanticPassReplays,
    coverageCompleteReplays,
    totalContradictions,
    totalPlayers,
    totalTimelineEvents,
    totalItemTransitions,
    totalBridgeIntervals,
    permanentFamiliesAcrossCohort: [...cohortPermanentFamilies].sort(),
  },
  integrityValidation: {
    pass: integrityValidationPass,
    expectedIndependentReplays: 5,
    actualIndependentReplays: cohort.length,
    integrityPassReplays,
  },
  semanticValidation: {
    pass: semanticValidationPass,
    semanticPassReplays,
    totalContradictions,
  },
  replicationStatus,
  coverageDiagnostics: {
    adequateForCrossReplayReplication: cohortCoverageAdequate,
    checks: cohortCoverageChecks,
  },
  replays: replayResults,
  interpretation: {
    supported:
      replicationStatus === 'cross_replay_replicated'
        ? 'The integrated PlayerState substrate preserved its event-sourced ownership/state semantics across the five frozen independent replications with all required runtime layers exercised.'
        : 'See validation and coverage diagnostics; semantic consistency and coverage are intentionally reported separately.',
    notYetPromoted:
      'Script159 does not mutate the claim registry. player_state_t_v1 remains missing until a dedicated promotion/freeze step reviews this cross-replay artifact.',
    effectiveWeapon:
      'Effective weapon composition remains unresolved and is not implied by successful PlayerState substrate validation.',
  },
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('CROSS-REPLAY INTEGRATED PLAYER-STATE RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                           ${status}`);
console.log(`integrity:                        ${integrityPassReplays}/${cohort.length}`);
console.log(`semantic:                         ${semanticPassReplays}/${cohort.length}`);
console.log(`coverage complete:                ${coverageCompleteReplays}/${cohort.length}`);
console.log(`contradictions:                   ${totalContradictions}`);
console.log(`players:                          ${totalPlayers}`);
console.log(`timeline events:                  ${totalTimelineEvents}`);
console.log(`item transitions:                 ${totalItemTransitions}`);
console.log(`bridge intervals:                 ${totalBridgeIntervals}`);
console.log(`permanent families cohort:        ${cohortPermanentFamilies.size}/6`);
console.log(`replicationStatus:                ${replicationStatus}`);
console.log('');
console.log('COHORT COVERAGE');
console.log('---------------');
for (const [name, row] of Object.entries(cohortCoverageChecks)) {
  console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function isReusableScript158Artifact(path) {
  if (!existsSync(path)) return false;
  try {
    const artifact = readJson(path);
    return artifact?.version === SCRIPT158_VERSION
      && [SCRIPT158_READY, SCRIPT158_DIAGNOSIS].includes(artifact?.status);
  } catch {
    return false;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function isScript158CoverageOnlyFailure(name, row) {
  if (SCRIPT158_SIMPLE_COVERAGE_CHECKS.has(name)) return true;
  if (name === 'bridgeCollectionsIntegrated') {
    // Script158 encodes both coverage and equality in this one check.
    // 0/0 means the layer was simply unexercised; unequal counts are a hard inconsistency.
    return Number(row?.actual) === 0 && Number(row?.expected) === 0;
  }
  return false;
}
