import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

import { getClaim, requireClaim } from '../src/contracts/claim-registry.mjs';

const VERSION = 'BRIDGE_SURVIVAL_RUNTIME_DURATION_VALIDATION_V01';
const TICKS_PER_SECOND = 64;
const SURVIVAL_KEY = 'survival_powerup_pickup';
const MAX_COLLECTOR_DISTANCE_HU = 300;

// Frozen after Script151 discovery on test.dem, before inspecting expiration
// behavior in the independent replication cohort.
const ACQ_HALF_WINDOW_TICKS = 16;       // +/- 0.25 s
const EXP_HALF_WINDOW_TICKS = 16;       // +/- 0.25 s
const DEATH_HALF_WINDOW_TICKS = 128;    // +/- 2 s (descriptive)
const PLACEBO_OFFSETS_SECONDS = [120, 200];

const HP_SYMMETRY_TOLERANCE = 1;
const REGEN_SYMMETRY_TOLERANCE = 1e-3;

const MANIFEST_PATH = resolve('output', 'cross_replay', 'replication_manifest_v01.json');
const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');
const SCRIPT150_PATH = resolve('output', 'cross_replay', 'bridge_world_collection_cross_replay_replication_v01.json');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'bridge_survival_runtime_duration_validation_v01.json');

for (const path of [MANIFEST_PATH, CONTRACT_PATH, SCRIPT150_PATH]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const bridgeResourceClaim = requireClaim('bridge_powerup_resource_contract', {
  requireSemantic: true,
  requireReplication: true,
});
const runtimeBridgeClaim = getClaim('runtime_bridge_buff_ownership');
const manifest = readJson(MANIFEST_PATH);
const contract = readJson(CONTRACT_PATH);
const script150 = readJson(SCRIPT150_PATH);

if (manifest?.readyToBeginReplication !== true) {
  throw new Error('Replication manifest is not ready.');
}
if (script150?.status !== 'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS') {
  throw new Error(`Script150 is not strongly replicated. status=${script150?.status}`);
}

const survival = (contract?.bridgePowerups?.powerups ?? []).find(row => row?.recordKey === SURVIVAL_KEY);
if (!survival) throw new Error('Survival bridge powerup missing from Script136 contract.');
if (survival.durationSeconds !== 160) {
  throw new Error(`Unexpected Survival duration. actual=${survival.durationSeconds}`);
}

const hpEffect = (survival.effects ?? []).find(row => row?.modifierValue === 'MODIFIER_VALUE_HEALTH_MAX');
const regenEffect = (survival.effects ?? []).find(row => row?.modifierValue === 'MODIFIER_VALUE_HEALTH_REGEN_PER_SECOND');
if (!hpEffect || !regenEffect) throw new Error('Survival HP/Regen effects missing from resource contract.');

const cohort = Array.isArray(manifest.selectedReplicationCohort)
  ? manifest.selectedReplicationCohort
  : (Array.isArray(manifest.replayRows)
      ? manifest.replayRows.filter(row =>
          row?.role === 'INDEPENDENT_REPLICATION_CANDIDATE'
          && row?.sameAsDiscovery !== true
          && row?.duplicateOfAnotherReplay !== true)
      : []);

if (cohort.length === 0) throw new Error('No independent replication cohort found.');

const EXPECTED_DURATION_TICKS = survival.durationSeconds * TICKS_PER_SECOND;

console.log('');
console.log('========================================================');
console.log('BRIDGE SURVIVAL RUNTIME DURATION VALIDATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Discovery replay excluded:       ${manifest.discoveryReplay ?? 'test'}`);
console.log(`Independent replays:             ${cohort.length}`);
console.log(`Collection anchor:               Script149 true->false, nearest player <=${MAX_COLLECTOR_DISTANCE_HU} HU`);
console.log(`Runtime consequence fields:      m_iHealthMax + m_flHealthRegen`);
console.log(`Expected duration:                ${survival.durationSeconds}s / ${EXPECTED_DURATION_TICKS} ticks`);
console.log(`Acquisition/expiration windows:  +/- ${ACQ_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s / +/- ${EXP_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s`);
console.log(`Primary invariant:               +MaxHP at acquisition, equal-magnitude -MaxHP at natural expiry`);
console.log('');

const replayResults = [];

for (let i = 0; i < cohort.length; i++) {
  const replayName = String(cohort[i]?.replayName ?? '').trim();
  const replayPath = resolve('replays', `${replayName}.dem`);
  const script149Path = resolve('output', replayName, 'bridge_pvs_robust_lifecycle_discovery_v01.json');

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${cohort.length}] ${replayName}`);
  console.log('--------------------------------------------------------');

  if (!replayName || !existsSync(replayPath) || !existsSync(script149Path)) {
    console.log('FAIL: replay or Script149 artifact missing.');
    replayResults.push({ replayName, processOk: false, semanticPass: false, failureStage: 'INPUT_MISSING' });
    continue;
  }

  const script149 = readJson(script149Path);
  if (script149?.version !== 'BRIDGE_PVS_ROBUST_LIFECYCLE_DISCOVERY_V01') {
    console.log(`FAIL: unexpected Script149 version=${script149?.version}`);
    replayResults.push({ replayName, processOk: false, semanticPass: false, failureStage: 'SCRIPT149_VERSION' });
    continue;
  }

  const anchors = (script149?.activeDownEvents ?? [])
    .filter(row => row?.recordKey === SURVIVAL_KEY)
    .filter(row => Number.isFinite(row?.tick))
    .filter(row => Number.isFinite(row?.trueNearestDistanceHU) && row.trueNearestDistanceHU <= MAX_COLLECTOR_DISTANCE_HU)
    .filter(row => Number.isInteger(row?.trueNearest?.controllerIndex))
    .map((row, index) => ({
      anchorId: index,
      replayName,
      pickupTick: row.tick,
      expectedExpirationTick: row.tick + EXPECTED_DURATION_TICKS,
      matchTimeSeconds: row.matchTimeSeconds,
      matchClock: row.matchClock,
      playerName: row.trueNearest.playerName,
      steamId: row.trueNearest.steamId,
      heroId: row.trueNearest.heroId,
      controllerIndex: row.trueNearest.controllerIndex,
      collectorDistanceHU: row.trueNearestDistanceHU,
      spawnerIndex: row.spawnerIndex,
    }))
    .sort((a, b) => a.pickupTick - b.pickupTick);

  if (anchors.length === 0) {
    console.log('No high-confidence Survival collection anchors.');
    replayResults.push({ replayName, processOk: true, semanticPass: false, anchors: [], failureStage: 'NO_SURVIVAL_ANCHORS' });
    continue;
  }

  const scan = await scanReplay(replayPath, anchors);
  const decorated = anchors.map(anchor => analyzeAnchor(anchor, scan));
  const natural = decorated.filter(row => row.expirationObservable && !row.deathBeforeExpectedExpiration);
  const deathConfounded = decorated.filter(row => row.expirationObservable && row.deathBeforeExpectedExpiration);
  const censored = decorated.filter(row => !row.expirationObservable);

  const hpAcqPositive = natural.filter(row => row.healthMax.acquisition?.delta > 0).length;
  const hpExpNegative = natural.filter(row => row.healthMax.expiration?.delta < 0).length;
  const hpSymmetric = natural.filter(row => row.healthMax.symmetric).length;
  const hpRange = natural.filter(row => row.healthMax.acquisitionInResourceRange).length;
  const hpPlaceboNegative = natural.filter(row => row.healthMax.placeboNegative).length;

  const regenAcqPositive = natural.filter(row => row.healthRegen.acquisition?.delta > 0).length;
  const regenExpNegative = natural.filter(row => row.healthRegen.expiration?.delta < 0).length;
  const regenSymmetric = natural.filter(row => row.healthRegen.symmetric).length;

  const summary = {
    replayName,
    processOk: true,
    survivalAnchors: decorated.length,
    naturalExpirationEligible: natural.length,
    deathConfounded: deathConfounded.length,
    censored: censored.length,
    healthMax: {
      acquisitionPositive: hpAcqPositive,
      expirationNegative: hpExpNegative,
      symmetric: hpSymmetric,
      acquisitionInResourceRange: hpRange,
      placeboNegative: hpPlaceboNegative,
      acquisitionPositiveRate: ratio(hpAcqPositive, natural.length),
      expirationNegativeRate: ratio(hpExpNegative, natural.length),
      symmetryRate: ratio(hpSymmetric, natural.length),
      rangeRate: ratio(hpRange, natural.length),
      placeboNegativeRate: ratio(hpPlaceboNegative, natural.length),
      medianExpirationTimingErrorSeconds: median(
        natural
          .map(row => row.healthMax.expiration ? Math.abs(row.healthMax.expiration.dtTicks) / TICKS_PER_SECOND : null)
          .filter(Number.isFinite)
      ),
    },
    healthRegen: {
      acquisitionPositive: regenAcqPositive,
      expirationNegative: regenExpNegative,
      symmetric: regenSymmetric,
      acquisitionPositiveRate: ratio(regenAcqPositive, natural.length),
      expirationNegativeRate: ratio(regenExpNegative, natural.length),
      symmetryRate: ratio(regenSymmetric, natural.length),
    },
    deathBehavior: summarizeDeathBehavior(deathConfounded),
    anchors: decorated,
  };

  // Per-replay semantic pass is deliberately modest: if a replay contains at
  // least one clean Survival episode, every clean episode must show the primary
  // MaxHP acquisition + natural-expiry consequence. Aggregate gates below carry
  // the actual replication decision.
  summary.semanticPass = natural.length > 0
    && hpAcqPositive === natural.length
    && hpExpNegative === natural.length;

  console.log(
    `anchors=${decorated.length} natural=${natural.length} death=${deathConfounded.length} censored=${censored.length} `
    + `HP +acq=${formatPercent(summary.healthMax.acquisitionPositiveRate)} `
    + `-exp=${formatPercent(summary.healthMax.expirationNegativeRate)} `
    + `symmetric=${formatPercent(summary.healthMax.symmetryRate)} `
    + `placebo=${formatPercent(summary.healthMax.placeboNegativeRate)}`
  );

  replayResults.push(summary);
}

const successful = replayResults.filter(row => row.processOk);
const allNatural = successful.flatMap(row => (row.anchors ?? []).filter(a => a.expirationObservable && !a.deathBeforeExpectedExpiration));
const allDeath = successful.flatMap(row => (row.anchors ?? []).filter(a => a.expirationObservable && a.deathBeforeExpectedExpiration));

const replaysWithNaturalEvidence = successful.filter(row => row.naturalExpirationEligible > 0).length;
const hpAcqPositive = allNatural.filter(row => row.healthMax.acquisition?.delta > 0).length;
const hpExpNegative = allNatural.filter(row => row.healthMax.expiration?.delta < 0).length;
const hpSymmetric = allNatural.filter(row => row.healthMax.symmetric).length;
const hpRange = allNatural.filter(row => row.healthMax.acquisitionInResourceRange).length;
const hpPlaceboNegative = allNatural.filter(row => row.healthMax.placeboNegative).length;
const regenAcqPositive = allNatural.filter(row => row.healthRegen.acquisition?.delta > 0).length;
const regenExpNegative = allNatural.filter(row => row.healthRegen.expiration?.delta < 0).length;
const regenSymmetric = allNatural.filter(row => row.healthRegen.symmetric).length;

const aggregate = {
  independentReplays: cohort.length,
  processesCompleted: successful.length,
  replaysWithNaturalEvidence,
  totalSurvivalAnchors: successful.reduce((sum, row) => sum + (row.survivalAnchors ?? 0), 0),
  naturalExpirationEligible: allNatural.length,
  deathConfounded: allDeath.length,
  censored: successful.reduce((sum, row) => sum + (row.censored ?? 0), 0),
  healthMax: {
    acquisitionPositive: hpAcqPositive,
    expirationNegative: hpExpNegative,
    symmetric: hpSymmetric,
    acquisitionInResourceRange: hpRange,
    placeboNegative: hpPlaceboNegative,
    acquisitionPositiveRate: ratio(hpAcqPositive, allNatural.length),
    expirationNegativeRate: ratio(hpExpNegative, allNatural.length),
    symmetryRate: ratio(hpSymmetric, allNatural.length),
    rangeRate: ratio(hpRange, allNatural.length),
    placeboNegativeRate: ratio(hpPlaceboNegative, allNatural.length),
    medianAcquisitionTimingErrorSeconds: median(
      allNatural
        .map(row => row.healthMax.acquisition ? Math.abs(row.healthMax.acquisition.dtTicks) / TICKS_PER_SECOND : null)
        .filter(Number.isFinite)
    ),
    medianExpirationTimingErrorSeconds: median(
      allNatural
        .map(row => row.healthMax.expiration ? Math.abs(row.healthMax.expiration.dtTicks) / TICKS_PER_SECOND : null)
        .filter(Number.isFinite)
    ),
    observedAcquisitionDeltas: allNatural
      .map(row => row.healthMax.acquisition?.delta)
      .filter(Number.isFinite),
    observedExpirationDeltas: allNatural
      .map(row => row.healthMax.expiration?.delta)
      .filter(Number.isFinite),
  },
  healthRegen: {
    acquisitionPositive: regenAcqPositive,
    expirationNegative: regenExpNegative,
    symmetric: regenSymmetric,
    acquisitionPositiveRate: ratio(regenAcqPositive, allNatural.length),
    expirationNegativeRate: ratio(regenExpNegative, allNatural.length),
    symmetryRate: ratio(regenSymmetric, allNatural.length),
  },
  deathBehavior: summarizeDeathBehavior(allDeath),
};

const checks = {
  manifestReady: check(manifest.readyToBeginReplication, true, manifest.readyToBeginReplication === true),
  independentCohortExpected: check(cohort.length, 5, cohort.length === 5),
  allProcessesCompleted: check(successful.length, cohort.length, successful.length === cohort.length),
  script150StronglyReplicated: check(
    script150.status,
    'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS',
    script150.status === 'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS'
  ),
  survivalResourceDuration160: check(survival.durationSeconds, 160, survival.durationSeconds === 160),
  naturalExpirationEvidenceAcrossAtLeastThreeReplays: check(replaysWithNaturalEvidence, '>=3', replaysWithNaturalEvidence >= 3),
  naturalExpirationAnchorsSufficient: check(allNatural.length, '>=5', allNatural.length >= 5),
  healthMaxAcquisitionPositiveStrong: check(aggregate.healthMax.acquisitionPositiveRate, '>=0.9', aggregate.healthMax.acquisitionPositiveRate >= 0.9),
  healthMaxExpirationNegativeStrong: check(aggregate.healthMax.expirationNegativeRate, '>=0.9', aggregate.healthMax.expirationNegativeRate >= 0.9),
  healthMaxDeltaSymmetryStrong: check(aggregate.healthMax.symmetryRate, '>=0.9', aggregate.healthMax.symmetryRate >= 0.9),
  healthMaxAcquisitionMagnitudeWithinResourceRange: check(aggregate.healthMax.rangeRate, '>=0.9', aggregate.healthMax.rangeRate >= 0.9),
  healthMaxExpirationTimingTight: check(
    aggregate.healthMax.medianExpirationTimingErrorSeconds,
    '<=0.125s',
    Number.isFinite(aggregate.healthMax.medianExpirationTimingErrorSeconds)
      && aggregate.healthMax.medianExpirationTimingErrorSeconds <= 0.125
  ),
  healthMaxPlaceboSeparated: check(aggregate.healthMax.placeboNegativeRate, '<=0.1', aggregate.healthMax.placeboNegativeRate <= 0.1),
};

const semanticPass = Object.values(checks).every(row => row.pass);
const status = semanticPass
  ? 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS'
  : 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  discoveryReplayExcluded: manifest.discoveryReplay ?? 'test',
  foundations: {
    bridgeResourceClaim: bridgeResourceClaim.claimId,
    runtimeBridgeClaimCurrentStatus: runtimeBridgeClaim.authorityStatus,
    worldCollectionReplicationArtifact: SCRIPT150_PATH,
    resourceContractArtifact: CONTRACT_PATH,
  },
  frozenValidationDesign: {
    recordKey: SURVIVAL_KEY,
    collectionMaxDistanceHU: MAX_COLLECTOR_DISTANCE_HU,
    durationSeconds: survival.durationSeconds,
    durationTicks: EXPECTED_DURATION_TICKS,
    acquisitionHalfWindowTicks: ACQ_HALF_WINDOW_TICKS,
    expirationHalfWindowTicks: EXP_HALF_WINDOW_TICKS,
    placeboOffsetsSeconds: PLACEBO_OFFSETS_SECONDS,
    primaryField: 'CCitadelPlayerController.m_iHealthMax',
    supportiveField: 'CCitadelPlayerController.m_flHealthRegen',
    primaryInvariant: 'Positive MaxHP delta at collection and equal-magnitude negative delta at natural +160s expiration; absolute baseline may drift between events.',
    deathPolicy: 'Death-before-160s anchors excluded from natural-expiration gate and analyzed separately.',
  },
  staticSurvivalContract: {
    durationSeconds: survival.durationSeconds,
    healthMax: hpEffect,
    healthRegen: regenEffect,
  },
  aggregate,
  replays: replayResults,
  semanticValidation: { pass: semanticPass, checks },
  interpretation: {
    supported: semanticPass
      ? 'Independent replays support Survival bridge collection producing a networked MaxHP increase that reverses at the resource-defined 160-second natural expiration, with delta symmetry robust to baseline drift.'
      : 'The targeted Survival consequence test did not yet satisfy all frozen cross-replay semantic gates.',
    supportive: 'Health regen is tracked as a second mechanistically expected consequence but is not required for the primary validation decision in V01.',
    notYetSupported: 'This test alone does not establish death behavior or independently observe all four bridge modifiers on the player. Other bridge types still rely on the shared resource-duration contract plus the replicated world-side acquisition chain unless separately validated.',
  },
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('BRIDGE SURVIVAL RUNTIME DURATION RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                          ${status}`);
console.log(`replays with natural evidence:   ${replaysWithNaturalEvidence}/${cohort.length}`);
console.log(`natural expiration anchors:      ${allNatural.length}`);
console.log(`death-confounded anchors:        ${allDeath.length}`);
console.log(`HP acquisition positive:         ${hpAcqPositive}/${allNatural.length} (${formatPercent(aggregate.healthMax.acquisitionPositiveRate)})`);
console.log(`HP expiration negative:          ${hpExpNegative}/${allNatural.length} (${formatPercent(aggregate.healthMax.expirationNegativeRate)})`);
console.log(`HP delta symmetry:               ${hpSymmetric}/${allNatural.length} (${formatPercent(aggregate.healthMax.symmetryRate)})`);
console.log(`HP resource-range acquisition:   ${hpRange}/${allNatural.length} (${formatPercent(aggregate.healthMax.rangeRate)})`);
console.log(`HP placebo negative:             ${hpPlaceboNegative}/${allNatural.length} (${formatPercent(aggregate.healthMax.placeboNegativeRate)})`);
console.log(`median HP expiry timing error:   ${fmt(aggregate.healthMax.medianExpirationTimingErrorSeconds, 4)}s`);
console.log(`Regen acquisition positive:      ${regenAcqPositive}/${allNatural.length} (${formatPercent(aggregate.healthRegen.acquisitionPositiveRate)})`);
console.log(`Regen expiration negative:       ${regenExpNegative}/${allNatural.length} (${formatPercent(aggregate.healthRegen.expirationNegativeRate)})`);
console.log(`Regen delta symmetry:            ${regenSymmetric}/${allNatural.length} (${formatPercent(aggregate.healthRegen.symmetryRate)})`);
console.log('');
console.log('DEATH-CONFOUNDED SURVIVAL ANCHORS');
console.log('---------------------------------');
for (const row of allDeath) {
  const death = row.deathTick;
  const hpDeath = row.healthMax.death;
  console.log(
    `${row.replayName.padEnd(8)} ${String(row.matchClock ?? '').padEnd(10)} ${String(row.playerName ?? '').padEnd(24)} `
    + `death+${fmt((death - row.pickupTick) / TICKS_PER_SECOND, 2)}s `
    + `HPdeath=${hpDeath ? `${fmt(hpDeath.delta, 3)} @ ${fmt(hpDeath.dtTicks / TICKS_PER_SECOND, 3)}s` : 'none'}`
  );
}
console.log('');
console.log('SEMANTIC VALIDATION');
console.log('-------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(52)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

async function scanReplay(replayPath, anchors) {
  const targetControllers = new Set(anchors.map(row => row.controllerIndex));
  const parser = new Parser(
    new ParserConfiguration({ entityClasses: ['CCitadelPlayerController'] }),
    Logger.CONSOLE_INFO
  );

  let maxTick = -1;
  const prior = new Map();
  const transitions = [];
  const deaths = [];

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, messagePacket, events) => {
      const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
      if (Number.isFinite(tick)) maxTick = Math.max(maxTick, tick);

      for (const event of events ?? []) {
        const entity = event?.entity;
        if (!entity || entity.class?.name !== 'CCitadelPlayerController') continue;
        const index = Number.isInteger(entity.index) ? entity.index : null;
        if (index === null || !targetControllers.has(index)) continue;
        const changes = safeChanges(event);

        if (event.operation === EntityOperation.CREATE) {
          for (const field of ['m_iHealthMax', 'm_flHealthRegen', 'm_bAlive']) {
            const value = entity.getField(field);
            if (value !== undefined) prior.set(`${index}|${field}`, safeValue(value));
          }
          continue;
        }
        if (event.operation !== EntityOperation.UPDATE || !Number.isFinite(tick)) continue;

        for (const field of ['m_iHealthMax', 'm_flHealthRegen', 'm_bAlive']) {
          if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;
          const key = `${index}|${field}`;
          const before = prior.has(key) ? prior.get(key) : undefined;
          const after = safeValue(changes[field]);
          prior.set(key, after);

          if (field === 'm_bAlive' && before === true && after === false) {
            deaths.push({ controllerIndex: index, tick });
          }

          if ((field === 'm_iHealthMax' || field === 'm_flHealthRegen')
              && Number.isFinite(before) && Number.isFinite(after) && before !== after) {
            transitions.push({
              controllerIndex: index,
              field,
              tick,
              before,
              after,
              delta: after - before,
            });
          }
        }
      }
    }
  );

  parser.registerPostInterceptor(
    InterceptorStage.DEMO_PACKET,
    demoPacket => {
      if (Number.isFinite(demoPacket?.tick)) maxTick = Math.max(maxTick, demoPacket.tick);
    }
  );

  try {
    await parser.parse(createReadStream(replayPath));
  } finally {
    await parser.dispose();
  }

  return { maxTick, transitions, deaths };
}

function analyzeAnchor(anchor, scan) {
  const deathTick = scan.deaths
    .filter(row => row.controllerIndex === anchor.controllerIndex)
    .map(row => row.tick)
    .filter(tick => tick > anchor.pickupTick && tick <= anchor.expectedExpirationTick)
    .sort((a, b) => a - b)[0] ?? null;

  const expirationObservable = scan.maxTick >= anchor.expectedExpirationTick + EXP_HALF_WINDOW_TICKS;
  const deathBeforeExpectedExpiration = Number.isFinite(deathTick);

  return {
    ...anchor,
    replayEndTick: scan.maxTick,
    expirationObservable,
    deathBeforeExpectedExpiration,
    deathTick,
    healthMax: analyzeField({
      anchor,
      scan,
      field: 'm_iHealthMax',
      minValue: hpEffect.valueMin,
      maxValue: hpEffect.valueMax,
      symmetryTolerance: HP_SYMMETRY_TOLERANCE,
      deathTick,
    }),
    healthRegen: analyzeField({
      anchor,
      scan,
      field: 'm_flHealthRegen',
      minValue: regenEffect.valueMin,
      maxValue: regenEffect.valueMax,
      symmetryTolerance: REGEN_SYMMETRY_TOLERANCE,
      deathTick,
    }),
  };
}

function analyzeField({ anchor, scan, field, minValue, maxValue, symmetryTolerance, deathTick }) {
  const rows = scan.transitions.filter(row => row.controllerIndex === anchor.controllerIndex && row.field === field);
  const acquisition = nearestDirectedTransition(rows, anchor.pickupTick, ACQ_HALF_WINDOW_TICKS, 'POSITIVE');
  const expiration = nearestDirectedTransition(rows, anchor.expectedExpirationTick, EXP_HALF_WINDOW_TICKS, 'NEGATIVE');
  const death = Number.isFinite(deathTick)
    ? nearestDirectedTransition(rows, deathTick, DEATH_HALF_WINDOW_TICKS, 'NEGATIVE')
    : null;

  const placeboTransitions = PLACEBO_OFFSETS_SECONDS.map(offsetSeconds => {
    const centerTick = anchor.pickupTick + offsetSeconds * TICKS_PER_SECOND;
    return {
      offsetSeconds,
      transition: nearestDirectedTransition(rows, centerTick, EXP_HALF_WINDOW_TICKS, 'NEGATIVE'),
    };
  });

  const symmetric = acquisition && expiration
    ? Math.abs(acquisition.delta + expiration.delta) <= symmetryTolerance
    : false;

  const acquisitionInResourceRange = acquisition
    ? acquisition.delta >= minValue - symmetryTolerance && acquisition.delta <= maxValue + symmetryTolerance
    : false;

  return {
    acquisition,
    expiration,
    death,
    symmetric,
    symmetryError: acquisition && expiration ? Math.abs(acquisition.delta + expiration.delta) : null,
    acquisitionInResourceRange,
    resourceRange: [minValue, maxValue],
    placeboTransitions,
    placeboNegative: placeboTransitions.some(row => row.transition !== null),
  };
}

function nearestDirectedTransition(rows, centerTick, halfWindowTicks, direction) {
  const filtered = rows
    .filter(row => Math.abs(row.tick - centerTick) <= halfWindowTicks)
    .filter(row => direction === 'POSITIVE' ? row.delta > 0 : row.delta < 0)
    .sort((a, b) => {
      const da = Math.abs(a.tick - centerTick);
      const db = Math.abs(b.tick - centerTick);
      if (da !== db) return da - db;
      return a.tick - b.tick;
    });
  if (filtered.length === 0) return null;
  const row = filtered[0];
  return { ...row, dtTicks: row.tick - centerTick, dtSeconds: (row.tick - centerTick) / TICKS_PER_SECOND };
}

function summarizeDeathBehavior(rows) {
  const hpNegativeNearDeath = rows.filter(row => row.healthMax?.death?.delta < 0).length;
  const hpSymmetricToAcquisitionAtDeath = rows.filter(row => {
    const acq = row.healthMax?.acquisition;
    const death = row.healthMax?.death;
    return acq && death && Math.abs(acq.delta + death.delta) <= HP_SYMMETRY_TOLERANCE;
  }).length;
  return {
    anchors: rows.length,
    healthMaxNegativeNearDeath: hpNegativeNearDeath,
    healthMaxNegativeNearDeathRate: ratio(hpNegativeNearDeath, rows.length),
    healthMaxSymmetricToAcquisitionAtDeath: hpSymmetricToAcquisitionAtDeath,
    healthMaxSymmetricToAcquisitionAtDeathRate: ratio(hpSymmetricToAcquisitionAtDeath, rows.length),
    interpretation: 'DESCRIPTIVE_ONLY_IN_V01',
  };
}

function safeChanges(event) {
  try {
    const value = event.getChanges?.();
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function safeValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = safeValue(child);
    return out;
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (rows.length === 0) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 === 1 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}
