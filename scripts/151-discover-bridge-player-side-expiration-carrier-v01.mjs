import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

import { getClaim, requireClaim } from '../src/contracts/claim-registry.mjs';

const VERSION = 'BRIDGE_PLAYER_SIDE_EXPIRATION_CARRIER_DISCOVERY_V01';
const TICKS_PER_SECOND = 64;
const ACQUISITION_HALF_WINDOW_TICKS = 64;      // +/- 1 s
const EXPIRATION_HALF_WINDOW_TICKS = 128;      // +/- 2 s around +160 s
const PLACEBO_HALF_WINDOW_TICKS = 128;         // same width as expiration
const PLACEBO_OFFSETS_SECONDS = [120, 200];
const MAX_COLLECTOR_DISTANCE_HU = 300;
const EXPECTED_COLLECTION_REPLICATION_STATUS =
  'BRIDGE_WORLD_COLLECTION_V01_STRONGLY_REPLICATED_ACROSS_INDEPENDENT_REPLAYS';

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));
const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');
const SCRIPT149_PATH = resolve('output', replayName, 'bridge_pvs_robust_lifecycle_discovery_v01.json');
const SCRIPT150_PATH = resolve('output', 'cross_replay', 'bridge_world_collection_cross_replay_replication_v01.json');
const OUTPUT_PATH = resolve('output', replayName, 'bridge_player_side_expiration_carrier_discovery_v01.json');

for (const path of [replayPath, CONTRACT_PATH, SCRIPT149_PATH, SCRIPT150_PATH]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const bridgeResourceClaim = requireClaim('bridge_powerup_resource_contract', {
  requireSemantic: true,
  requireReplication: true,
});
const runtimeBridgeClaim = getClaim('runtime_bridge_buff_ownership');
if (runtimeBridgeClaim.authorityStatus !== 'missing') {
  throw new Error(
    'Script151 is discovery-only and expects runtime_bridge_buff_ownership to remain missing. '
    + `actual=${runtimeBridgeClaim.authorityStatus}`
  );
}

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
const script149 = JSON.parse(readFileSync(SCRIPT149_PATH, 'utf8'));
const script150 = JSON.parse(readFileSync(SCRIPT150_PATH, 'utf8'));

if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`World-buff contract not ready. status=${contract?.status}`);
}
if (script149?.version !== 'BRIDGE_PVS_ROBUST_LIFECYCLE_DISCOVERY_V01') {
  throw new Error(`Unexpected Script149 version: ${script149?.version}`);
}
if (script150?.status !== EXPECTED_COLLECTION_REPLICATION_STATUS) {
  throw new Error(
    'Script150 cross-replay bridge collection authority is not strong enough for Script151 discovery. '
    + `status=${script150?.status}`
  );
}

const bridgePowerups = new Map(
  (contract?.bridgePowerups?.powerups ?? []).map(row => [row.recordKey, row])
);
const durations = [...bridgePowerups.values()]
  .map(row => row.durationSeconds)
  .filter(Number.isFinite);
const distinctDurations = [...new Set(durations)];
if (distinctDurations.length !== 1 || distinctDurations[0] !== 160) {
  throw new Error(`Expected one shared 160 s bridge duration. actual=${JSON.stringify(distinctDurations)}`);
}
const EXPECTED_DURATION_SECONDS = distinctDurations[0];
const EXPECTED_DURATION_TICKS = EXPECTED_DURATION_SECONDS * TICKS_PER_SECOND;

// Script149's activeDownEvents already carries the geometry-based nearest-player
// attribution. Freeze only the high-confidence discovery events here.
const acquisitionAnchors = (script149?.activeDownEvents ?? [])
  .filter(row => Number.isFinite(row?.tick))
  .filter(row => Number.isFinite(row?.trueNearestDistanceHU))
  .filter(row => row.trueNearestDistanceHU <= MAX_COLLECTOR_DISTANCE_HU)
  .filter(row => row?.trueNearest?.controllerIndex !== null && row?.trueNearest?.controllerIndex !== undefined)
  .filter(row => row?.trueNearest?.pawnIndex !== null && row?.trueNearest?.pawnIndex !== undefined)
  .filter(row => bridgePowerups.has(row?.recordKey))
  .map((row, index) => ({
    anchorId: index,
    recordKey: row.recordKey,
    pickupTick: row.tick,
    matchTimeSeconds: row.matchTimeSeconds,
    matchClock: row.matchClock,
    spawnerIndex: row.spawnerIndex,
    collectorDistanceHU: row.trueNearestDistanceHU,
    playerName: row.trueNearest.playerName,
    steamId: row.trueNearest.steamId,
    heroId: row.trueNearest.heroId,
    controllerIndex: row.trueNearest.controllerIndex,
    pawnIndex: row.trueNearest.pawnIndex,
    expectedExpirationTick: row.tick + EXPECTED_DURATION_TICKS,
  }))
  .sort((a, b) => a.pickupTick - b.pickupTick);

if (acquisitionAnchors.length === 0) {
  throw new Error('No high-confidence Script149 bridge collection anchors found.');
}

console.log('');
console.log('========================================================');
console.log('BRIDGE PLAYER-SIDE EXPIRATION CARRIER DISCOVERY V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayPath}`);
console.log(`Collection anchors:             ${acquisitionAnchors.length}`);
console.log(`Expected resource duration:     ${EXPECTED_DURATION_SECONDS}s / ${EXPECTED_DURATION_TICKS} ticks`);
console.log(`Acquisition mutation window:    +/- ${ACQUISITION_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s`);
console.log(`Expiration mutation window:     +/- ${EXPIRATION_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s around +160s`);
console.log(`Placebo windows:                ${PLACEBO_OFFSETS_SECONDS.map(x => `+${x}s`).join(', ')}`);
console.log('CREATE policy:                  state initialization only; UPDATE required for transition evidence');
console.log('');

const targetWindowsByEntity = buildTargetWindows(acquisitionAnchors);
const parser = new Parser(
  new ParserConfiguration({
    entityClasses: [
      'CCitadelPlayerController',
      'CCitadelPlayerPawn',
    ],
  }),
  Logger.CONSOLE_INFO
);

let maxTick = -1;
let playerMutationEvents = 0;
let playerUpdateEvents = 0;
let candidateWindowMutations = 0;

const previousValueByEntityField = new Map();
const windowMutations = [];
const deathTransitions = [];

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
    if (Number.isFinite(tick)) maxTick = Math.max(maxTick, tick);

    for (const event of events ?? []) {
      const entity = event?.entity;
      if (!entity) continue;
      const className = entity?.class?.name;
      if (className !== 'CCitadelPlayerController' && className !== 'CCitadelPlayerPawn') continue;
      playerMutationEvents++;

      const entityIndex = Number.isInteger(entity.index) ? entity.index : null;
      if (entityIndex === null) continue;
      const changes = safeChanges(event);

      if (event.operation === EntityOperation.CREATE) {
        for (const [fieldName, value] of Object.entries(changes)) {
          previousValueByEntityField.set(stateKey(className, entityIndex, fieldName), safeValue(value));
        }
        continue;
      }
      if (event.operation !== EntityOperation.UPDATE) continue;
      playerUpdateEvents++;

      for (const [fieldName, rawAfter] of Object.entries(changes)) {
        const key = stateKey(className, entityIndex, fieldName);
        const before = previousValueByEntityField.has(key)
          ? previousValueByEntityField.get(key)
          : undefined;
        const after = safeValue(rawAfter);
        previousValueByEntityField.set(key, after);

        if (className === 'CCitadelPlayerController' && fieldName === 'm_bAlive') {
          if (before === true && after === false) {
            deathTransitions.push({ tick, controllerIndex: entityIndex });
          }
        }
        if (className === 'CCitadelPlayerPawn' && fieldName === 'm_lifeState') {
          if (before === 0 && after !== 0 && after !== undefined && after !== null) {
            deathTransitions.push({ tick, pawnIndex: entityIndex });
          }
        }

        const windows = targetWindowsByEntity.get(entityWindowKey(className, entityIndex));
        if (!windows || !Number.isFinite(tick)) continue;

        for (const window of windows) {
          if (tick < window.startTick || tick > window.endTick) continue;
          candidateWindowMutations++;
          windowMutations.push({
            anchorId: window.anchorId,
            phase: window.phase,
            phaseOffsetSeconds: window.phaseOffsetSeconds,
            centerTick: window.centerTick,
            tick,
            dtTicks: tick - window.centerTick,
            dtSeconds: (tick - window.centerTick) / TICKS_PER_SECOND,
            className,
            entityIndex,
            fieldName,
            before,
            after,
            noisyField: isObviousHighFrequencyNoise(fieldName),
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

console.log('[parse] scanning collector-side field transitions around acquisition and +160s...');
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

const anchors = acquisitionAnchors.map(anchor => decorateAnchorCensoring(anchor));
const eligibleExpirationAnchors = anchors.filter(row => row.expirationObservable && row.deathBeforeExpectedExpiration !== true);
const censoredAnchors = anchors.filter(row => !row.expirationObservable);
const deathConfoundedAnchors = anchors.filter(row => row.expirationObservable && row.deathBeforeExpectedExpiration === true);

const cleanMutations = windowMutations.filter(row => !row.noisyField);
const fieldCandidates = summarizeFieldCandidates(cleanMutations, anchors);
const byBuff = [...bridgePowerups.keys()].sort().map(recordKey => ({
  recordKey,
  anchors: anchors.filter(row => row.recordKey === recordKey).length,
  eligibleExpirationAnchors: eligibleExpirationAnchors.filter(row => row.recordKey === recordKey).length,
  topCandidates: fieldCandidates
    .filter(row => row.recordKey === recordKey)
    .slice(0, 20),
}));

const allBuffCandidates = summarizeCrossBuffCandidates(fieldCandidates);
const inversePairs = buildInversePairs(cleanMutations, anchors);

const checks = {
  bridgeResourceAuthorityCurrent: check(
    bridgeResourceClaim.authorityStatus,
    'current',
    bridgeResourceClaim.authorityStatus === 'current'
  ),
  runtimeBridgeClaimStillMissing: check(
    runtimeBridgeClaim.authorityStatus,
    'missing',
    runtimeBridgeClaim.authorityStatus === 'missing'
  ),
  script149Ready: check(
    script149?.status,
    'BRIDGE_PVS_ROBUST_LIFECYCLE_V01_READY_FOR_INTERPRETATION',
    script149?.status === 'BRIDGE_PVS_ROBUST_LIFECYCLE_V01_READY_FOR_INTERPRETATION'
  ),
  script150StronglyReplicated: check(
    script150?.status,
    EXPECTED_COLLECTION_REPLICATION_STATUS,
    script150?.status === EXPECTED_COLLECTION_REPLICATION_STATUS
  ),
  sharedDuration160Seconds: check(
    distinctDurations,
    [160],
    distinctDurations.length === 1 && distinctDurations[0] === 160
  ),
  highConfidenceCollectionAnchorsObserved: check(
    acquisitionAnchors.length,
    '>0',
    acquisitionAnchors.length > 0
  ),
  playerUpdatesObserved: check(playerUpdateEvents, '>0', playerUpdateEvents > 0),
  expirationEligibleAnchorsObserved: check(
    eligibleExpirationAnchors.length,
    '>0',
    eligibleExpirationAnchors.length > 0
  ),
};
const integrityPass = Object.values(checks).every(row => row.pass);

const strongCarrierCandidates = fieldCandidates.filter(row =>
  row.eligibleAnchors >= 2
  && row.acquisitionRate >= 0.5
  && row.expirationRate >= 0.5
  && row.bothRate >= 0.5
  && row.placeboRate <= 0.25
);

const status = strongCarrierCandidates.length > 0
  ? 'BRIDGE_PLAYER_SIDE_EXPIRATION_CARRIER_V01_CANDIDATES_FOUND'
  : 'BRIDGE_PLAYER_SIDE_EXPIRATION_CARRIER_V01_NO_STRONG_FIELD_CARRIER_FOUND';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: {
    replayName,
    replayPath,
    maxTick,
    ticksPerSecond: TICKS_PER_SECOND,
  },
  foundations: {
    bridgeResourceContract: CONTRACT_PATH,
    script149Artifact: SCRIPT149_PATH,
    script150Artifact: SCRIPT150_PATH,
    expectedDurationSeconds: EXPECTED_DURATION_SECONDS,
    expectedDurationTicks: EXPECTED_DURATION_TICKS,
  },
  frozenDiscoveryWindows: {
    acquisitionHalfWindowTicks: ACQUISITION_HALF_WINDOW_TICKS,
    expirationHalfWindowTicks: EXPIRATION_HALF_WINDOW_TICKS,
    placeboHalfWindowTicks: PLACEBO_HALF_WINDOW_TICKS,
    placeboOffsetsSeconds: PLACEBO_OFFSETS_SECONDS,
    maxCollectorDistanceHU: MAX_COLLECTOR_DISTANCE_HU,
  },
  counts: {
    collectionAnchors: anchors.length,
    expirationEligibleAnchors: eligibleExpirationAnchors.length,
    censoredAnchors: censoredAnchors.length,
    deathConfoundedAnchors: deathConfoundedAnchors.length,
    playerMutationEvents,
    playerUpdateEvents,
    candidateWindowMutations,
    cleanWindowMutations: cleanMutations.length,
    distinctFieldCandidates: fieldCandidates.length,
    strongCarrierCandidates: strongCarrierCandidates.length,
    inverseTransitionPairs: inversePairs.length,
  },
  anchors,
  byBuff,
  strongCarrierCandidates: strongCarrierCandidates.slice(0, 50),
  crossBuffCandidates: allBuffCandidates.slice(0, 50),
  inverseTransitionPairs: inversePairs.slice(0, 100),
  fieldCandidates,
  integrityValidation: {
    pass: integrityPass,
    checks,
  },
  interpretation: {
    supported: 'Script150 bridge collection events are used as replicated acquisition anchors; this script only discovers player-side fields whose UPDATE mutations cluster near acquisition and the resource-defined +160 s expiration time.',
    notYetSupported: [
      'Any candidate field is a validated bridge modifier carrier.',
      'A +160 s-correlated mutation proves natural modifier expiration without follow-up semantic controls.',
      'Death behavior for bridge modifiers.',
      'Exact match-time effect interpolation.',
      'runtime_bridge_buff_ownership registry promotion.',
    ],
    nullResultMeaning: 'If no strong field carrier is found, the replay may not serialize a direct player-side bridge-modifier identity. In that case the next validation should use effect-specific consequence fields and/or deterministic interval reconstruction from replicated collection plus the build-bound 160 s resource contract.',
  },
};

mkdirSync(resolve('output', replayName), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
printSummary(output);

function buildTargetWindows(anchors) {
  const map = new Map();
  for (const anchor of anchors) {
    const specs = [
      {
        phase: 'ACQUISITION',
        phaseOffsetSeconds: 0,
        centerTick: anchor.pickupTick,
        halfWindow: ACQUISITION_HALF_WINDOW_TICKS,
      },
      {
        phase: 'EXPECTED_EXPIRATION',
        phaseOffsetSeconds: EXPECTED_DURATION_SECONDS,
        centerTick: anchor.expectedExpirationTick,
        halfWindow: EXPIRATION_HALF_WINDOW_TICKS,
      },
      ...PLACEBO_OFFSETS_SECONDS.map(seconds => ({
        phase: `PLACEBO_${seconds}S`,
        phaseOffsetSeconds: seconds,
        centerTick: anchor.pickupTick + seconds * TICKS_PER_SECOND,
        halfWindow: PLACEBO_HALF_WINDOW_TICKS,
      })),
    ];

    for (const [className, entityIndex] of [
      ['CCitadelPlayerController', anchor.controllerIndex],
      ['CCitadelPlayerPawn', anchor.pawnIndex],
    ]) {
      const key = entityWindowKey(className, entityIndex);
      const rows = map.get(key) ?? [];
      for (const spec of specs) {
        rows.push({
          anchorId: anchor.anchorId,
          ...spec,
          startTick: spec.centerTick - spec.halfWindow,
          endTick: spec.centerTick + spec.halfWindow,
        });
      }
      map.set(key, rows);
    }
  }
  return map;
}

function decorateAnchorCensoring(anchor) {
  const expirationObservable = Number.isFinite(maxTick) && anchor.expectedExpirationTick <= maxTick;
  const relevantDeaths = deathTransitions
    .filter(row => Number.isFinite(row.tick))
    .filter(row => row.tick > anchor.pickupTick && row.tick <= anchor.expectedExpirationTick)
    .filter(row =>
      row.controllerIndex === anchor.controllerIndex
      || row.pawnIndex === anchor.pawnIndex
    )
    .sort((a, b) => a.tick - b.tick);

  return {
    ...anchor,
    expirationObservable,
    firstDeathBeforeExpectedExpirationTick: relevantDeaths[0]?.tick ?? null,
    secondsToFirstDeath: relevantDeaths[0]
      ? (relevantDeaths[0].tick - anchor.pickupTick) / TICKS_PER_SECOND
      : null,
    deathBeforeExpectedExpiration: relevantDeaths.length > 0,
  };
}

function summarizeFieldCandidates(mutations, anchors) {
  const anchorById = new Map(anchors.map(row => [row.anchorId, row]));
  const groups = new Map();

  for (const mutation of mutations) {
    const anchor = anchorById.get(mutation.anchorId);
    if (!anchor) continue;
    const key = [anchor.recordKey, mutation.className, mutation.fieldName].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        recordKey: anchor.recordKey,
        className: mutation.className,
        fieldName: mutation.fieldName,
        byAnchor: new Map(),
      };
      groups.set(key, group);
    }
    let perAnchor = group.byAnchor.get(anchor.anchorId);
    if (!perAnchor) {
      perAnchor = new Map();
      group.byAnchor.set(anchor.anchorId, perAnchor);
    }
    const rows = perAnchor.get(mutation.phase) ?? [];
    rows.push(mutation);
    perAnchor.set(mutation.phase, rows);
  }

  const results = [];
  for (const group of groups.values()) {
    const eligible = anchors.filter(a =>
      a.recordKey === group.recordKey
      && a.expirationObservable
      && a.deathBeforeExpectedExpiration !== true
    );
    if (eligible.length === 0) continue;

    let acquisitionCount = 0;
    let expirationCount = 0;
    let bothCount = 0;
    let placeboHits = 0;
    let placeboWindows = 0;
    let inverseCount = 0;
    let inverseComparable = 0;
    const expirationErrors = [];
    const examples = [];

    for (const anchor of eligible) {
      const phases = group.byAnchor.get(anchor.anchorId) ?? new Map();
      const acq = nearestMutation(phases.get('ACQUISITION') ?? [], anchor.pickupTick);
      const exp = nearestMutation(phases.get('EXPECTED_EXPIRATION') ?? [], anchor.expectedExpirationTick);
      if (acq) acquisitionCount++;
      if (exp) {
        expirationCount++;
        expirationErrors.push(Math.abs(exp.dtSeconds));
      }
      if (acq && exp) {
        bothCount++;
        if (isComparableTransition(acq) && isComparableTransition(exp)) {
          inverseComparable++;
          if (sameValue(acq.before, exp.after) && sameValue(acq.after, exp.before)) inverseCount++;
        }
        if (examples.length < 4) {
          examples.push({
            anchorId: anchor.anchorId,
            playerName: anchor.playerName,
            pickupClock: anchor.matchClock,
            acquisition: compactMutation(acq),
            expiration: compactMutation(exp),
          });
        }
      }
      for (const seconds of PLACEBO_OFFSETS_SECONDS) {
        placeboWindows++;
        const p = phases.get(`PLACEBO_${seconds}S`) ?? [];
        if (p.length > 0) placeboHits++;
      }
    }

    const acquisitionRate = ratio(acquisitionCount, eligible.length);
    const expirationRate = ratio(expirationCount, eligible.length);
    const bothRate = ratio(bothCount, eligible.length);
    const placeboRate = ratio(placeboHits, placeboWindows);
    const inverseRate = ratio(inverseCount, inverseComparable);
    const score =
      (acquisitionRate ?? 0)
      + (expirationRate ?? 0)
      + 1.5 * (bothRate ?? 0)
      + 0.5 * (inverseRate ?? 0)
      - 1.5 * (placeboRate ?? 0);

    results.push({
      recordKey: group.recordKey,
      className: group.className,
      fieldName: group.fieldName,
      eligibleAnchors: eligible.length,
      acquisitionCount,
      acquisitionRate,
      expirationCount,
      expirationRate,
      bothCount,
      bothRate,
      placeboHits,
      placeboWindows,
      placeboRate,
      inverseComparable,
      inverseCount,
      inverseRate,
      medianAbsoluteExpirationTimingErrorSeconds: median(expirationErrors),
      score,
      examples,
    });
  }

  return results.sort((a, b) =>
    b.score - a.score
    || b.bothCount - a.bothCount
    || a.placeboRate - b.placeboRate
    || a.fieldName.localeCompare(b.fieldName)
  );
}

function summarizeCrossBuffCandidates(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.className}|${row.fieldName}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [className, fieldName] = key.split('|');
    return {
      className,
      fieldName,
      buffTypesWithEvidence: list.filter(x => x.bothCount > 0).map(x => x.recordKey).sort(),
      buffTypeCount: list.filter(x => x.bothCount > 0).length,
      totalEligibleAnchors: sum(list.map(x => x.eligibleAnchors)),
      totalBothCount: sum(list.map(x => x.bothCount)),
      meanBothRate: mean(list.map(x => x.bothRate).filter(Number.isFinite)),
      meanPlaceboRate: mean(list.map(x => x.placeboRate).filter(Number.isFinite)),
      meanScore: mean(list.map(x => x.score).filter(Number.isFinite)),
    };
  }).sort((a, b) =>
    b.buffTypeCount - a.buffTypeCount
    || b.totalBothCount - a.totalBothCount
    || (b.meanScore ?? -Infinity) - (a.meanScore ?? -Infinity)
  );
}

function buildInversePairs(mutations, anchors) {
  const anchorById = new Map(anchors.map(row => [row.anchorId, row]));
  const grouped = new Map();
  for (const row of mutations) {
    if (row.phase !== 'ACQUISITION' && row.phase !== 'EXPECTED_EXPIRATION') continue;
    const key = `${row.anchorId}|${row.className}|${row.fieldName}`;
    const phases = grouped.get(key) ?? {};
    const existing = phases[row.phase];
    if (!existing || Math.abs(row.dtTicks) < Math.abs(existing.dtTicks)) phases[row.phase] = row;
    grouped.set(key, phases);
  }

  const results = [];
  for (const [key, phases] of grouped.entries()) {
    const [anchorIdText, className, fieldName] = key.split('|');
    const anchor = anchorById.get(Number(anchorIdText));
    if (!anchor || !anchor.expirationObservable || anchor.deathBeforeExpectedExpiration) continue;
    const acq = phases.ACQUISITION;
    const exp = phases.EXPECTED_EXPIRATION;
    if (!acq || !exp || !isComparableTransition(acq) || !isComparableTransition(exp)) continue;
    if (!sameValue(acq.before, exp.after) || !sameValue(acq.after, exp.before)) continue;
    results.push({
      anchorId: anchor.anchorId,
      recordKey: anchor.recordKey,
      playerName: anchor.playerName,
      className,
      fieldName,
      acquisition: compactMutation(acq),
      expiration: compactMutation(exp),
      expirationTimingErrorSeconds: exp.dtSeconds,
    });
  }
  return results.sort((a, b) =>
    Math.abs(a.expirationTimingErrorSeconds) - Math.abs(b.expirationTimingErrorSeconds)
  );
}

function nearestMutation(rows, centerTick) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return [...rows].sort((a, b) =>
    Math.abs(a.tick - centerTick) - Math.abs(b.tick - centerTick)
  )[0];
}

function compactMutation(row) {
  return {
    tick: row.tick,
    dtTicks: row.dtTicks,
    dtSeconds: row.dtSeconds,
    before: row.before,
    after: row.after,
  };
}

function isComparableTransition(row) {
  return row && row.before !== undefined && row.after !== undefined;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isObviousHighFrequencyNoise(name) {
  return name === 'm_flSimulationTime'
    || name === 'm_flAnimTime'
    || name === 'm_flCreateTime'
    || name === 'm_ubInterpolationFrame'
    || name.includes('serializedPoseRecipe')
    || name.startsWith('CBodyComponent.m_vec')
    || name.startsWith('CBodyComponent.m_cell')
    || name.startsWith('CBodyComponent.m_ang')
    || name.includes('m_angEyeAngles')
    || name.includes('m_angClientCamera');
}

function safeChanges(event) {
  try {
    return event?.getChanges?.() ?? {};
  } catch {
    return {};
  }
}

function safeValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(safeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = safeValue(v);
    return out;
  }
  return value;
}

function stateKey(className, entityIndex, fieldName) {
  return `${className}:${entityIndex}:${fieldName}`;
}

function entityWindowKey(className, entityIndex) {
  return `${className}:${entityIndex}`;
}

function ratio(n, d) {
  return d > 0 ? n / d : null;
}

function mean(values) {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (rows.length === 0) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function sum(values) {
  return values.filter(Number.isFinite).reduce((a, b) => a + b, 0);
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function fmtPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function printSummary(result) {
  console.log('');
  console.log('========================================================');
  console.log('BRIDGE PLAYER-SIDE EXPIRATION CARRIER RESULT');
  console.log('========================================================');
  console.log('');
  console.log(`status:                         ${result.status}`);
  console.log(`collection anchors:             ${result.counts.collectionAnchors}`);
  console.log(`expiration-eligible anchors:    ${result.counts.expirationEligibleAnchors}`);
  console.log(`censored by replay end:         ${result.counts.censoredAnchors}`);
  console.log(`death-confounded anchors:       ${result.counts.deathConfoundedAnchors}`);
  console.log(`candidate window mutations:     ${result.counts.candidateWindowMutations}`);
  console.log(`clean window mutations:         ${result.counts.cleanWindowMutations}`);
  console.log(`field candidates:               ${result.counts.distinctFieldCandidates}`);
  console.log(`strong carrier candidates:      ${result.counts.strongCarrierCandidates}`);
  console.log(`inverse transition pairs:       ${result.counts.inverseTransitionPairs}`);
  console.log('');
  console.log('TOP CANDIDATES BY BUFF');
  console.log('----------------------');
  for (const group of result.byBuff) {
    console.log(`${group.recordKey} anchors=${group.anchors} eligible=${group.eligibleExpirationAnchors}`);
    for (const row of group.topCandidates.slice(0, 8)) {
      console.log(
        `  ${row.className}.${row.fieldName} `
        + `acq=${fmtPct(row.acquisitionRate)} exp=${fmtPct(row.expirationRate)} `
        + `both=${fmtPct(row.bothRate)} placebo=${fmtPct(row.placeboRate)} `
        + `inverse=${fmtPct(row.inverseRate)} err=${fmt(row.medianAbsoluteExpirationTimingErrorSeconds)}s `
        + `score=${fmt(row.score, 2)}`
      );
    }
  }
  console.log('');
  console.log('CROSS-BUFF FIELD CANDIDATES');
  console.log('---------------------------');
  for (const row of result.crossBuffCandidates.slice(0, 15)) {
    console.log(
      `${row.className}.${row.fieldName} buffs=${row.buffTypeCount} `
      + `both=${row.totalBothCount}/${row.totalEligibleAnchors} `
      + `meanBoth=${fmtPct(row.meanBothRate)} placebo=${fmtPct(row.meanPlaceboRate)}`
    );
  }
  console.log('');
  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');
  for (const [name, row] of Object.entries(result.integrityValidation.checks)) {
    console.log(
      `${name.padEnd(44)} ${String(row.pass).padEnd(5)} `
      + `actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
    );
  }
  console.log('');
  console.log(`JSON:\n${OUTPUT_PATH}`);
  console.log('');
}
