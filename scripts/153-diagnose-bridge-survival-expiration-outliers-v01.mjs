import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

const VERSION = 'BRIDGE_SURVIVAL_EXPIRATION_OUTLIER_DIAGNOSTIC_V01';
const TICKS_PER_SECOND = 64;
const PRIMARY_HALF_WINDOW_TICKS = 16;      // frozen Script152 semantic window +/-0.25s
const DIAGNOSTIC_HALF_WINDOW_TICKS = 320;  // +/-5s, diagnostic only

const SCRIPT152_PATH = resolve(
  'output',
  'cross_replay',
  'bridge_survival_runtime_duration_validation_v01.json'
);
const OUTPUT_PATH = resolve(
  'output',
  'cross_replay',
  'bridge_survival_expiration_outlier_diagnostic_v01.json'
);

if (!existsSync(SCRIPT152_PATH)) {
  throw new Error(`Script152 artifact missing:\n${SCRIPT152_PATH}`);
}

const script152 = JSON.parse(readFileSync(SCRIPT152_PATH, 'utf8'));
if (script152?.status !== 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS') {
  throw new Error(`Script152 is not strongly validated. status=${script152?.status}`);
}

const failedAnchors = [];
for (const replay of script152?.replays ?? []) {
  for (const anchor of replay?.anchors ?? []) {
    const natural = anchor?.expirationObservable === true && anchor?.deathBeforeExpectedExpiration !== true;
    if (!natural) continue;

    const hpPass = Boolean(anchor?.healthMax?.expiration?.delta < 0) && anchor?.healthMax?.symmetric === true;
    const regenPass = Boolean(anchor?.healthRegen?.expiration?.delta < 0) && anchor?.healthRegen?.symmetric === true;
    if (hpPass && regenPass) continue;

    failedAnchors.push({
      replayName: replay.replayName,
      playerName: anchor.playerName,
      controllerIndex: anchor.controllerIndex,
      pickupTick: anchor.pickupTick,
      expectedExpirationTick: anchor.expectedExpirationTick,
      matchClock: anchor.matchClock,
      healthMax: anchor.healthMax,
      healthRegen: anchor.healthRegen,
    });
  }
}

console.log('');
console.log('========================================================');
console.log('BRIDGE SURVIVAL EXPIRATION OUTLIER DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Script152 status:              ${script152.status}`);
console.log(`Natural anchors in Script152: ${script152?.aggregate?.naturalExpirationEligible ?? 'n/a'}`);
console.log(`Failed natural anchors:        ${failedAnchors.length}`);
console.log(`Primary semantic window:       +/-${PRIMARY_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s`);
console.log(`Diagnostic window:             +/-${DIAGNOSTIC_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s`);
console.log('');

const diagnostics = [];

for (let i = 0; i < failedAnchors.length; i++) {
  const anchor = failedAnchors[i];
  const replayPath = resolve('replays', `${anchor.replayName}.dem`);
  if (!existsSync(replayPath)) {
    diagnostics.push({ ...anchor, processOk: false, error: 'REPLAY_MISSING' });
    continue;
  }

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${failedAnchors.length}] ${anchor.replayName} ${anchor.playerName}`);
  console.log('--------------------------------------------------------');

  const scan = await scanOutlier(replayPath, anchor);
  const result = analyzeOutlier(anchor, scan);
  diagnostics.push(result);

  console.log(`expected expiry: tick=${anchor.expectedExpirationTick}`);
  console.log(`HP acquisition:  ${formatTransition(anchor.healthMax?.acquisition)}`);
  console.log(`HP Script152 exp:${formatTransition(anchor.healthMax?.expiration)}`);
  console.log(`nearest HP -delta within 5s: ${formatTransition(result.nearestNegativeHealthMax)}`);
  console.log(`nearest regen -delta within 5s: ${formatTransition(result.nearestNegativeHealthRegen)}`);
  console.log(`concurrent confounds: ${result.confoundSummary.length ? result.confoundSummary.join(', ') : 'none detected'}`);
  console.log('relevant transitions around expected expiry:');
  for (const row of result.relevantTransitions.slice(0, 40)) {
    console.log(`  dt=${formatSigned(row.dtSeconds, 3)}s ${row.field} ${formatValue(row.before)} -> ${formatValue(row.after)}${Number.isFinite(row.delta) ? ` delta=${formatSigned(row.delta, 3)}` : ''}`);
  }
}

const classifications = diagnostics.reduce((acc, row) => {
  const key = row.classification ?? 'UNKNOWN';
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: failedAnchors.length === 0
    ? 'BRIDGE_SURVIVAL_EXPIRATION_OUTLIER_V01_NO_OUTLIERS'
    : 'BRIDGE_SURVIVAL_EXPIRATION_OUTLIER_V01_DIAGNOSED',
  foundations: {
    script152Artifact: SCRIPT152_PATH,
    script152Status: script152.status,
  },
  frozenPolicy: {
    noRetuning: true,
    primarySemanticHalfWindowTicks: PRIMARY_HALF_WINDOW_TICKS,
    diagnosticHalfWindowTicks: DIAGNOSTIC_HALF_WINDOW_TICKS,
    diagnosticOnly: true,
  },
  counts: {
    naturalAnchors: script152?.aggregate?.naturalExpirationEligible ?? null,
    failedNaturalAnchors: failedAnchors.length,
    classifications,
  },
  diagnostics,
  interpretation: {
    supported: 'This script explains Script152 natural-expiration misses without changing Script152 frozen validation thresholds.',
    notSupported: 'Diagnostic evidence does not retroactively convert a Script152 miss into a pass or alter the frozen 11/12 semantic result.',
  },
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('OUTLIER DIAGNOSTIC RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                  ${output.status}`);
console.log(`failed natural anchors:  ${failedAnchors.length}`);
console.log(`classifications:         ${JSON.stringify(classifications)}`);
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

async function scanOutlier(replayPath, anchor) {
  const parser = new Parser(
    new ParserConfiguration({ entityClasses: ['CCitadelPlayerController'] }),
    Logger.CONSOLE_INFO
  );

  const prior = new Map();
  const transitions = [];
  const startTick = anchor.expectedExpirationTick - DIAGNOSTIC_HALF_WINDOW_TICKS;
  const endTick = anchor.expectedExpirationTick + DIAGNOSTIC_HALF_WINDOW_TICKS;

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, messagePacket, events) => {
      const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
      if (!Number.isFinite(tick)) return;

      for (const event of events ?? []) {
        const entity = event?.entity;
        if (!entity || entity.class?.name !== 'CCitadelPlayerController') continue;
        if (entity.index !== anchor.controllerIndex) continue;
        const changes = safeChanges(event);

        if (event.operation === EntityOperation.CREATE) {
          for (const [field, value] of Object.entries(changes)) {
            prior.set(field, safeValue(value));
          }
          for (const field of importantSnapshotFields()) {
            const value = entity.getField(field);
            if (value !== undefined) prior.set(field, safeValue(value));
          }
          continue;
        }

        if (event.operation !== EntityOperation.UPDATE) continue;

        for (const [field, rawAfter] of Object.entries(changes)) {
          const after = safeValue(rawAfter);
          const before = prior.has(field) ? prior.get(field) : undefined;
          prior.set(field, after);

          if (tick < startTick || tick > endTick) continue;
          if (!isRelevantField(field)) continue;

          transitions.push({
            tick,
            dtTicks: tick - anchor.expectedExpirationTick,
            dtSeconds: (tick - anchor.expectedExpirationTick) / TICKS_PER_SECOND,
            field,
            before,
            after,
            delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null,
          });
        }
      }
    }
  );

  try {
    await parser.parse(createReadStream(replayPath));
  } finally {
    await parser.dispose();
  }

  return { transitions };
}

function analyzeOutlier(anchor, scan) {
  const rows = scan.transitions ?? [];
  const hp = rows.filter(row => row.field === 'm_iHealthMax');
  const regen = rows.filter(row => row.field === 'm_flHealthRegen');

  const nearestNegativeHealthMax = nearestDirected(hp, 'NEGATIVE');
  const nearestNegativeHealthRegen = nearestDirected(regen, 'NEGATIVE');

  const primaryWindowRows = rows.filter(row => Math.abs(row.dtTicks) <= PRIMARY_HALF_WINDOW_TICKS);
  const confoundSummary = [];

  if (primaryWindowRows.some(row => row.field === 'm_iLevel')) confoundSummary.push('LEVEL_CHANGE_NEAR_EXPIRY');
  if (primaryWindowRows.some(row => row.field === 'm_vecUpgrades' || row.field.startsWith('m_vecUpgrades.'))) confoundSummary.push('SHOP_VECTOR_CHANGE_NEAR_EXPIRY');
  if (primaryWindowRows.some(row => row.field === 'm_vecStatViewerModifierValues' || row.field.startsWith('m_vecStatViewerModifierValues.'))) confoundSummary.push('STAT_VIEWER_CHANGE_NEAR_EXPIRY');
  if (primaryWindowRows.some(row => row.field === 'm_bAlive')) confoundSummary.push('ALIVE_STATE_CHANGE_NEAR_EXPIRY');
  if (primaryWindowRows.some(row => row.field === 'm_iMaxAmmo')) confoundSummary.push('MAX_AMMO_CHANGE_NEAR_EXPIRY');

  let classification = 'NO_CLEAR_CONFOUND';
  if (confoundSummary.length > 0) classification = 'CONCURRENT_PLAYER_STATE_CHANGE';
  else if (nearestNegativeHealthMax && Math.abs(nearestNegativeHealthMax.dtTicks) > PRIMARY_HALF_WINDOW_TICKS) {
    classification = 'DELAYED_HP_REVERSAL_OUTSIDE_FROZEN_WINDOW';
  } else if (!nearestNegativeHealthMax && !nearestNegativeHealthRegen) {
    classification = 'NO_NEGATIVE_CONSEQUENCE_WITHIN_5S';
  }

  return {
    ...anchor,
    processOk: true,
    classification,
    confoundSummary,
    nearestNegativeHealthMax,
    nearestNegativeHealthRegen,
    primaryWindowTransitions: primaryWindowRows,
    relevantTransitions: rows.sort((a, b) => Math.abs(a.dtTicks) - Math.abs(b.dtTicks) || a.tick - b.tick),
  };
}

function nearestDirected(rows, direction) {
  const filtered = rows
    .filter(row => Number.isFinite(row.delta))
    .filter(row => direction === 'NEGATIVE' ? row.delta < 0 : row.delta > 0)
    .sort((a, b) => Math.abs(a.dtTicks) - Math.abs(b.dtTicks) || a.tick - b.tick);
  return filtered[0] ?? null;
}

function importantSnapshotFields() {
  return [
    'm_iHealthMax',
    'm_flHealthRegen',
    'm_iLevel',
    'm_iMaxAmmo',
    'm_bAlive',
    'm_iHealth',
    'm_vecUpgrades',
    'm_vecStatViewerModifierValues',
  ];
}

function isRelevantField(field) {
  if (field === 'm_iHealthMax') return true;
  if (field === 'm_flHealthRegen') return true;
  if (field === 'm_iLevel') return true;
  if (field === 'm_iMaxAmmo') return true;
  if (field === 'm_bAlive') return true;
  if (field === 'm_iHealth') return true;
  if (field === 'm_vecUpgrades' || field.startsWith('m_vecUpgrades.')) return true;
  if (field === 'm_vecStatViewerModifierValues' || field.startsWith('m_vecStatViewerModifierValues.')) return true;
  if (/bonus|upgrade|modifier|health|maxammo|regen/i.test(field)) return true;
  return false;
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

function formatTransition(row) {
  if (!row) return 'none';
  return `${formatValue(row.before)} -> ${formatValue(row.after)} delta=${formatSigned(row.delta, 3)} dt=${formatSigned(row.dtSeconds ?? (row.dtTicks / TICKS_PER_SECOND), 3)}s`;
}

function formatValue(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  const text = JSON.stringify(value);
  return text && text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

function formatSigned(value, digits = 3) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}
