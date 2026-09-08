import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

const VERSION = 'BRIDGE_SURVIVAL_OVERLAP_OUTLIER_DIAGNOSTIC_V01';
const TICKS_PER_SECOND = 64;
const MAX_COLLECTOR_DISTANCE_HU = 300;
const MATCH_TOLERANCE_HP = 1;
const EVENT_WINDOW_TICKS = 16; // +/-0.25s descriptive alignment only
const FOLLOWUP_SECONDS = 300;

const SCRIPT152_PATH = resolve('output', 'cross_replay', 'bridge_survival_runtime_duration_validation_v01.json');
const SCRIPT153_PATH = resolve('output', 'cross_replay', 'bridge_survival_expiration_outlier_diagnostic_v01.json');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'bridge_survival_overlap_outlier_diagnostic_v01.json');

if (!existsSync(SCRIPT152_PATH)) throw new Error(`Script152 artifact missing:\n${SCRIPT152_PATH}`);
if (!existsSync(SCRIPT153_PATH)) throw new Error(`Script153 artifact missing:\n${SCRIPT153_PATH}`);

const script152 = readJson(SCRIPT152_PATH);
const script153 = readJson(SCRIPT153_PATH);

if (script152?.status !== 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS') {
  throw new Error(`Unexpected Script152 status=${script152?.status}`);
}
if (script153?.status !== 'BRIDGE_SURVIVAL_EXPIRATION_OUTLIER_V01_DIAGNOSED') {
  throw new Error(`Unexpected Script153 status=${script153?.status}`);
}

const failedNaturalAnchors = [];
for (const replay of script152?.replays ?? script152?.replayResults ?? []) {
  for (const anchor of replay?.anchors ?? []) {
    if (!anchor?.expirationObservable || anchor?.deathBeforeExpectedExpiration) continue;
    const hpPass = anchor?.healthMax?.expiration?.delta < 0 && anchor?.healthMax?.symmetric === true;
    if (hpPass) continue;
    failedNaturalAnchors.push({ replayName: replay.replayName, ...anchor });
  }
}

if (failedNaturalAnchors.length === 0) {
  throw new Error('No failed natural-expiration anchors found in Script152.');
}

console.log('');
console.log('========================================================');
console.log('BRIDGE SURVIVAL OVERLAP OUTLIER DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Script152 natural misses:       ${failedNaturalAnchors.length}`);
console.log(`Follow-up horizon:              ${FOLLOWUP_SECONDS}s after Survival collection`);
console.log(`Question:                       another bridge pickup before expected expiry?`);
console.log(`Secondary question:             when does the Survival-sized HP contribution disappear?`);
console.log('');

const diagnostics = [];

for (let i = 0; i < failedNaturalAnchors.length; i++) {
  const anchor = failedNaturalAnchors[i];
  const replayName = anchor.replayName;
  const replayPath = resolve('replays', `${replayName}.dem`);
  const script149Path = resolve('output', replayName, 'bridge_pvs_robust_lifecycle_discovery_v01.json');

  if (!existsSync(replayPath)) throw new Error(`Replay missing: ${replayPath}`);
  if (!existsSync(script149Path)) throw new Error(`Script149 artifact missing: ${script149Path}`);

  const script149 = readJson(script149Path);
  const allBridgeCollections = (script149?.activeDownEvents ?? [])
    .filter(row => Number.isFinite(row?.tick))
    .filter(row => Number.isFinite(row?.trueNearestDistanceHU) && row.trueNearestDistanceHU <= MAX_COLLECTOR_DISTANCE_HU)
    .filter(row => Number.isInteger(row?.trueNearest?.controllerIndex));

  const samePlayerCollections = allBridgeCollections
    .filter(row => row.trueNearest.controllerIndex === anchor.controllerIndex)
    .filter(row => row.tick > anchor.pickupTick)
    .filter(row => row.tick <= anchor.pickupTick + FOLLOWUP_SECONDS * TICKS_PER_SECOND)
    .sort((a, b) => a.tick - b.tick)
    .map(row => ({
      tick: row.tick,
      dtFromSurvivalSeconds: (row.tick - anchor.pickupTick) / TICKS_PER_SECOND,
      recordKey: row.recordKey,
      matchClock: row.matchClock,
      spawnerIndex: row.spawnerIndex,
      collectorDistanceHU: row.trueNearestDistanceHU,
      beforeExpectedExpiry: row.tick < anchor.expectedExpirationTick,
    }));

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${failedNaturalAnchors.length}] ${replayName} ${anchor.playerName}`);
  console.log('--------------------------------------------------------');
  console.log(`Survival pickup:                 ${anchor.matchClock ?? 'n/a'} tick=${anchor.pickupTick}`);
  console.log(`Expected expiry:                 tick=${anchor.expectedExpirationTick}`);
  console.log(`HP acquisition delta:            ${fmtSigned(anchor?.healthMax?.acquisition?.delta)}`);
  console.log(`Later bridge collections <=300s:${samePlayerCollections.length}`);
  for (const row of samePlayerCollections) {
    console.log(`  +${row.dtFromSurvivalSeconds.toFixed(3)}s ${String(row.recordKey).padEnd(28)} beforeExpiry=${row.beforeExpectedExpiry}`);
  }

  const scan = await scanReplay(replayPath, anchor.controllerIndex);
  const horizonEndTick = Math.min(
    scan.maxTick,
    anchor.pickupTick + FOLLOWUP_SECONDS * TICKS_PER_SECOND
  );

  const hpRows = scan.healthMaxTransitions
    .filter(row => row.tick > anchor.pickupTick && row.tick <= horizonEndTick)
    .sort((a, b) => a.tick - b.tick);
  const regenRows = scan.regenTransitions
    .filter(row => row.tick > anchor.pickupTick && row.tick <= horizonEndTick)
    .sort((a, b) => a.tick - b.tick);
  const deathRows = scan.deaths
    .filter(row => row.tick > anchor.pickupTick && row.tick <= horizonEndTick)
    .sort((a, b) => a.tick - b.tick);

  const targetHpDelta = Math.abs(anchor?.healthMax?.acquisition?.delta ?? NaN);
  const targetRegenDelta = Math.abs(anchor?.healthRegen?.acquisition?.delta ?? NaN);

  const firstAnyHpNegative = hpRows.find(row => row.delta < 0) ?? null;
  const firstMatchingHpNegative = Number.isFinite(targetHpDelta)
    ? hpRows.find(row => row.delta < 0 && Math.abs(Math.abs(row.delta) - targetHpDelta) <= MATCH_TOLERANCE_HP) ?? null
    : null;
  const firstMatchingRegenNegative = Number.isFinite(targetRegenDelta)
    ? regenRows.find(row => row.delta < 0 && Math.abs(Math.abs(row.delta) - targetRegenDelta) <= 1e-3) ?? null
    : null;

  const bridgeBeforeExpectedExpiry = samePlayerCollections.filter(row => row.beforeExpectedExpiry);
  const overlapAlignedHp = [];
  for (const bridge of bridgeBeforeExpectedExpiry) {
    const row = nearestTransition(hpRows, bridge.tick, EVENT_WINDOW_TICKS, r => r.delta < 0);
    overlapAlignedHp.push({ bridge, hpNegativeNearBridge: row });
  }

  const nextDeath = deathRows[0] ?? null;
  const classification = classify({
    bridgeBeforeExpectedExpiry,
    overlapAlignedHp,
    firstMatchingHpNegative,
    nextDeath,
    anchor,
  });

  console.log(`First HP negative:               ${describeTransition(firstAnyHpNegative, anchor.pickupTick)}`);
  console.log(`First matching HP -delta:        ${describeTransition(firstMatchingHpNegative, anchor.pickupTick)}`);
  console.log(`First matching regen -delta:     ${describeTransition(firstMatchingRegenNegative, anchor.pickupTick)}`);
  console.log(`Next death:                      ${nextDeath ? `+${((nextDeath.tick - anchor.pickupTick) / TICKS_PER_SECOND).toFixed(3)}s` : 'none in horizon'}`);
  console.log(`classification:                  ${classification}`);

  if (overlapAlignedHp.length > 0) {
    console.log('HP around pre-expiry bridge pickups:');
    for (const row of overlapAlignedHp) {
      console.log(`  ${row.bridge.recordKey} +${row.bridge.dtFromSurvivalSeconds.toFixed(3)}s HPneg=${describeTransition(row.hpNegativeNearBridge, anchor.pickupTick)}`);
    }
  }

  diagnostics.push({
    replayName,
    playerName: anchor.playerName,
    controllerIndex: anchor.controllerIndex,
    pickupTick: anchor.pickupTick,
    expectedExpirationTick: anchor.expectedExpirationTick,
    matchClock: anchor.matchClock,
    survivalHealthMaxAcquisition: anchor?.healthMax?.acquisition ?? null,
    survivalHealthRegenAcquisition: anchor?.healthRegen?.acquisition ?? null,
    samePlayerBridgeCollectionsWithinFollowup: samePlayerCollections,
    bridgeCollectionsBeforeExpectedExpiry: bridgeBeforeExpectedExpiry,
    hpNegativeNearPreExpiryBridgeCollections: overlapAlignedHp,
    firstAnyHealthMaxNegative: decorateDt(firstAnyHpNegative, anchor.pickupTick),
    firstMatchingHealthMaxNegative: decorateDt(firstMatchingHpNegative, anchor.pickupTick),
    firstMatchingHealthRegenNegative: decorateDt(firstMatchingRegenNegative, anchor.pickupTick),
    nextDeath: decorateDt(nextDeath, anchor.pickupTick),
    classification,
    healthMaxTransitionsWithinFollowup: hpRows.map(row => decorateDt(row, anchor.pickupTick)),
    healthRegenTransitionsWithinFollowup: regenRows.map(row => decorateDt(row, anchor.pickupTick)),
  });
}

const classifications = {};
for (const row of diagnostics) classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: 'BRIDGE_SURVIVAL_OVERLAP_OUTLIER_V01_DIAGNOSED',
  foundations: {
    script152: SCRIPT152_PATH,
    script153: SCRIPT153_PATH,
  },
  methodologicalBoundary: {
    script152ThresholdsUnchanged: true,
    thisScriptRetunesNothing: true,
    purpose: 'Diagnose only pre-existing natural-expiration misses by testing later bridge collections and long-horizon HP/Regen reversal timing.',
  },
  counts: {
    failedNaturalAnchors: diagnostics.length,
    classifications,
  },
  diagnostics,
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('OVERLAP OUTLIER DIAGNOSTIC RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                  ${output.status}`);
console.log(`failed natural anchors:  ${diagnostics.length}`);
console.log(`classifications:         ${JSON.stringify(classifications)}`);
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

async function scanReplay(replayPath, controllerIndex) {
  const parser = new Parser(
    new ParserConfiguration({ entityClasses: ['CCitadelPlayerController'] }),
    Logger.CONSOLE_INFO
  );

  const state = new Map();
  const healthMaxTransitions = [];
  const regenTransitions = [];
  const deaths = [];
  let maxTick = -1;

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, messagePacket, events) => {
      const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
      if (!Number.isFinite(tick)) return;
      maxTick = Math.max(maxTick, tick);

      for (const event of events) {
        if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) continue;
        const entity = event.entity;
        if (!entity || entity.class?.name !== 'CCitadelPlayerController' || entity.index !== controllerIndex) continue;

        const changes = safeChanges(event);
        let s = state.get(controllerIndex);
        if (!s) {
          s = { m_iHealthMax: undefined, m_flHealthRegen: undefined, m_bAlive: undefined };
          state.set(controllerIndex, s);
        }

        for (const field of ['m_iHealthMax', 'm_flHealthRegen', 'm_bAlive']) {
          if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;
          const after = entity.getField(field);
          const before = s[field];

          if (event.operation === EntityOperation.UPDATE && before !== undefined && before !== after) {
            if (field === 'm_iHealthMax' && Number.isFinite(before) && Number.isFinite(after)) {
              healthMaxTransitions.push({ tick, before, after, delta: after - before });
            }
            if (field === 'm_flHealthRegen' && Number.isFinite(before) && Number.isFinite(after)) {
              regenTransitions.push({ tick, before, after, delta: after - before });
            }
            if (field === 'm_bAlive' && before === true && after === false) {
              deaths.push({ tick });
            }
          }
          s[field] = after;
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

  return { maxTick, healthMaxTransitions, regenTransitions, deaths };
}

function classify({ bridgeBeforeExpectedExpiry, overlapAlignedHp, firstMatchingHpNegative, nextDeath, anchor }) {
  if (bridgeBeforeExpectedExpiry.length > 0) {
    if (overlapAlignedHp.some(row => row.hpNegativeNearBridge)) {
      return 'PRE_EXPIRY_BRIDGE_OVERLAP_WITH_HP_REMOVAL';
    }
    if (firstMatchingHpNegative && firstMatchingHpNegative.tick < anchor.expectedExpirationTick) {
      return 'PRE_EXPIRY_BRIDGE_OVERLAP_AND_EARLY_MATCHING_HP_REMOVAL';
    }
    return 'PRE_EXPIRY_BRIDGE_OVERLAP_WITHOUT_OBSERVED_HP_REMOVAL';
  }
  if (firstMatchingHpNegative) {
    if (firstMatchingHpNegative.tick > anchor.expectedExpirationTick) {
      return 'DELAYED_MATCHING_HP_REMOVAL_WITHOUT_BRIDGE_OVERLAP';
    }
    return 'EARLY_MATCHING_HP_REMOVAL_WITHOUT_BRIDGE_OVERLAP';
  }
  if (nextDeath) return 'NO_MATCHING_HP_REMOVAL_BEFORE_LATER_DEATH';
  return 'NO_MATCHING_HP_REMOVAL_WITHIN_FOLLOWUP';
}

function nearestTransition(rows, centerTick, halfWindowTicks, predicate) {
  const hits = rows
    .filter(row => Math.abs(row.tick - centerTick) <= halfWindowTicks)
    .filter(predicate)
    .sort((a, b) => Math.abs(a.tick - centerTick) - Math.abs(b.tick - centerTick));
  return hits[0] ?? null;
}

function decorateDt(row, originTick) {
  if (!row) return null;
  return { ...row, dtFromSurvivalTicks: row.tick - originTick, dtFromSurvivalSeconds: (row.tick - originTick) / TICKS_PER_SECOND };
}

function describeTransition(row, originTick) {
  if (!row) return 'none';
  const dt = (row.tick - originTick) / TICKS_PER_SECOND;
  return `${fmtSigned(row.delta)} @ +${dt.toFixed(3)}s (${row.before} -> ${row.after})`;
}

function safeChanges(event) {
  try {
    const value = event.getChanges?.();
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function fmtSigned(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
