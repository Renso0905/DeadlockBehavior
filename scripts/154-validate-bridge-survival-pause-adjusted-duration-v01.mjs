import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

const VERSION = 'BRIDGE_SURVIVAL_PAUSE_ADJUSTED_DURATION_VALIDATION_V01';
const TICKS_PER_SECOND = 64;
const DURATION_SECONDS = 160;
const DURATION_ACTIVE_TICKS = DURATION_SECONDS * TICKS_PER_SECOND;
const EXP_HALF_WINDOW_TICKS = 16; // preserve Script152 +/-0.25 s semantic window
const HP_SYMMETRY_TOLERANCE = 1;
const REGEN_SYMMETRY_TOLERANCE = 1e-3;

const SCRIPT152_PATH = resolve(
  'output',
  'cross_replay',
  'bridge_survival_runtime_duration_validation_v01.json'
);
const SCRIPT153_PATH = resolve(
  'output',
  'cross_replay',
  'bridge_survival_expiration_outlier_diagnostic_v01.json'
);
const OUTPUT_PATH = resolve(
  'output',
  'cross_replay',
  'bridge_survival_pause_adjusted_duration_validation_v01.json'
);

if (!existsSync(SCRIPT152_PATH)) {
  throw new Error(`Script152 artifact missing:\n${SCRIPT152_PATH}`);
}

const script152 = readJson(SCRIPT152_PATH);
if (script152?.status !== 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS') {
  throw new Error(`Script152 is not strongly validated. status=${script152?.status}`);
}

const script153 = existsSync(SCRIPT153_PATH) ? readJson(SCRIPT153_PATH) : null;

const replayAnchorGroups = [];
for (const replay of script152?.replays ?? []) {
  const anchors = (replay?.anchors ?? [])
    .filter(anchor => anchor?.expirationObservable === true)
    .filter(anchor => anchor?.deathBeforeExpectedExpiration !== true)
    .filter(anchor => Number.isFinite(anchor?.pickupTick))
    .filter(anchor => Number.isInteger(anchor?.controllerIndex))
    .map(anchor => ({
      replayName: replay.replayName,
      playerName: anchor.playerName,
      controllerIndex: anchor.controllerIndex,
      pickupTick: anchor.pickupTick,
      oldExpectedExpirationTick: anchor.expectedExpirationTick,
      matchClock: anchor.matchClock,
      healthMaxAcquisition: anchor?.healthMax?.acquisition ?? null,
      healthMaxOldExpiration: anchor?.healthMax?.expiration ?? null,
      healthMaxOldSymmetric: anchor?.healthMax?.symmetric === true,
      healthRegenAcquisition: anchor?.healthRegen?.acquisition ?? null,
      healthRegenOldExpiration: anchor?.healthRegen?.expiration ?? null,
      healthRegenOldSymmetric: anchor?.healthRegen?.symmetric === true,
    }));

  if (anchors.length > 0) replayAnchorGroups.push({ replayName: replay.replayName, anchors });
}

const totalNaturalAnchors = replayAnchorGroups.reduce((sum, row) => sum + row.anchors.length, 0);

console.log('');
console.log('========================================================');
console.log('BRIDGE SURVIVAL PAUSE-ADJUSTED DURATION VALIDATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Script152 natural anchors:      ${totalNaturalAnchors}`);
console.log(`Expected modifier duration:     ${DURATION_SECONDS}s active game time`);
console.log(`Old clock model:                pickup + ${DURATION_ACTIVE_TICKS} replay ticks`);
console.log('Corrected clock model:          add 160 active-game seconds, excluding native pause intervals');
console.log(`Expiration semantic window:     +/-${EXP_HALF_WINDOW_TICKS / TICKS_PER_SECOND}s (unchanged)`);
console.log(`Script153 outliers available:   ${script153?.counts?.failedNaturalAnchors ?? 0}`);
console.log('');

const replayResults = [];

for (let i = 0; i < replayAnchorGroups.length; i++) {
  const group = replayAnchorGroups[i];
  const replayPath = resolve('replays', `${group.replayName}.dem`);

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${replayAnchorGroups.length}] ${group.replayName}`);
  console.log('--------------------------------------------------------');

  if (!existsSync(replayPath)) {
    console.log('FAIL: replay missing.');
    replayResults.push({ replayName: group.replayName, processOk: false, anchors: [] });
    continue;
  }

  const scan = await scanReplay(replayPath, group.anchors);
  const corrected = group.anchors.map(anchor => analyzeAnchor(anchor, scan));

  const hpPass = corrected.filter(row => row.healthMax.correctedPass).length;
  const regenPass = corrected.filter(row => row.healthRegen.correctedPass).length;
  const shifted = corrected.filter(row => row.pauseShiftTicks > 0).length;
  const oldMisses = corrected.filter(row => !row.healthMax.oldPass);
  const oldMissesResolved = oldMisses.filter(row => row.healthMax.correctedPass).length;
  const oldPasses = corrected.filter(row => row.healthMax.oldPass);
  const oldPassesPreserved = oldPasses.filter(row => row.healthMax.correctedPass).length;

  console.log(
    `anchors=${corrected.length} pauses=${scan.pauseIntervals.length} `
    + `pauseShifted=${shifted} HPcorrected=${hpPass}/${corrected.length} `
    + `regenCorrected=${regenPass}/${corrected.length} oldMissResolved=${oldMissesResolved}/${oldMisses.length}`
  );

  for (const row of corrected.filter(anchor => anchor.pauseShiftTicks > 0 || !anchor.healthMax.oldPass)) {
    console.log(
      `  ${String(row.matchClock ?? '').padEnd(10)} ${String(row.playerName ?? '').padEnd(22)} `
      + `shift=${formatSigned(row.pauseShiftTicks / TICKS_PER_SECOND, 3)}s `
      + `oldHP=${formatTransition(row.healthMax.oldExpiration)} `
      + `newHP=${formatTransition(row.healthMax.correctedExpiration)} `
      + `symmetric=${row.healthMax.correctedSymmetric}`
    );
  }

  replayResults.push({
    replayName: group.replayName,
    processOk: true,
    pauseIntervals: scan.pauseIntervals,
    nativePauseTelemetry: scan.nativePauseTelemetry,
    counts: {
      anchors: corrected.length,
      pauseShiftedAnchors: shifted,
      healthMaxCorrectedPass: hpPass,
      healthRegenCorrectedPass: regenPass,
      oldHealthMaxMisses: oldMisses.length,
      oldHealthMaxMissesResolved: oldMissesResolved,
      oldHealthMaxPasses: oldPasses.length,
      oldHealthMaxPassesPreserved: oldPassesPreserved,
    },
    anchors: corrected,
  });
}

const allAnchors = replayResults.flatMap(row => row.anchors ?? []);
const hpCorrectedPass = allAnchors.filter(row => row.healthMax.correctedPass).length;
const regenCorrectedPass = allAnchors.filter(row => row.healthRegen.correctedPass).length;
const oldHpPass = allAnchors.filter(row => row.healthMax.oldPass).length;
const oldMisses = allAnchors.filter(row => !row.healthMax.oldPass);
const oldMissesResolved = oldMisses.filter(row => row.healthMax.correctedPass).length;
const oldPassesPreserved = allAnchors.filter(row => row.healthMax.oldPass && row.healthMax.correctedPass).length;
const shiftedAnchors = allAnchors.filter(row => row.pauseShiftTicks > 0);
const correctedTimingErrors = allAnchors
  .map(row => row.healthMax.correctedExpiration
    ? Math.abs(row.healthMax.correctedExpiration.dtTicks) / TICKS_PER_SECOND
    : null)
  .filter(Number.isFinite);

const checks = {
  script152StronglyValidated: check(
    script152.status,
    'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS',
    script152.status === 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS'
  ),
  naturalAnchorsPreserved: check(allAnchors.length, totalNaturalAnchors, allAnchors.length === totalNaturalAnchors),
  allReplayProcessesCompleted: check(
    replayResults.filter(row => row.processOk).length,
    replayAnchorGroups.length,
    replayResults.filter(row => row.processOk).length === replayAnchorGroups.length
  ),
  nativePauseTelemetryObserved: check(
    replayResults.some(row => (row.nativePauseTelemetry?.samplesWithPauseFields ?? 0) > 0),
    true,
    replayResults.some(row => (row.nativePauseTelemetry?.samplesWithPauseFields ?? 0) > 0)
  ),
  correctedHealthMaxExpirationStrong: check(
    ratio(hpCorrectedPass, allAnchors.length),
    '>=0.9',
    ratio(hpCorrectedPass, allAnchors.length) >= 0.9
  ),
  correctedHealthMaxSymmetryStrong: check(
    ratio(allAnchors.filter(row => row.healthMax.correctedSymmetric).length, allAnchors.length),
    '>=0.9',
    ratio(allAnchors.filter(row => row.healthMax.correctedSymmetric).length, allAnchors.length) >= 0.9
  ),
  correctedHealthRegenSupportStrong: check(
    ratio(regenCorrectedPass, allAnchors.length),
    '>=0.9',
    ratio(regenCorrectedPass, allAnchors.length) >= 0.9
  ),
  correctedTimingTight: check(
    median(correctedTimingErrors),
    '<=0.125s',
    Number.isFinite(median(correctedTimingErrors)) && median(correctedTimingErrors) <= 0.125
  ),
  oldPassesNotDegraded: check(
    oldPassesPreserved,
    oldHpPass,
    oldPassesPreserved === oldHpPass
  ),
  priorNaturalMissesResolved: check(
    oldMissesResolved,
    oldMisses.length,
    oldMisses.length === 0 || oldMissesResolved === oldMisses.length
  ),
};

const semanticPass = Object.values(checks).every(row => row.pass);
const status = semanticPass
  ? 'BRIDGE_SURVIVAL_PAUSE_ADJUSTED_DURATION_V01_STRONGLY_VALIDATED'
  : 'BRIDGE_SURVIVAL_PAUSE_ADJUSTED_DURATION_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  foundations: {
    script152Artifact: SCRIPT152_PATH,
    script152Status: script152.status,
    script153Artifact: existsSync(SCRIPT153_PATH) ? SCRIPT153_PATH : null,
  },
  methodologicalCorrection: {
    oldModel: 'Resource duration 160s was converted to 10,240 raw replay ticks.',
    correctedModel: 'Resource duration is evaluated in active game time by adding native pause intervals to the raw replay-tick target.',
    nativeFields: [
      'm_pGameRules.m_bGamePaused',
      'm_pGameRules.m_nTotalPausedTicks',
      'm_pGameRules.m_nPauseStartTick',
      'm_pGameRules.m_bServerPaused',
    ],
    semanticWindowRetuned: false,
    expirationHalfWindowTicks: EXP_HALF_WINDOW_TICKS,
  },
  aggregate: {
    naturalAnchors: allAnchors.length,
    pauseShiftedAnchors: shiftedAnchors.length,
    oldHealthMaxPass: oldHpPass,
    correctedHealthMaxPass: hpCorrectedPass,
    correctedHealthMaxPassRate: ratio(hpCorrectedPass, allAnchors.length),
    correctedHealthMaxSymmetry: allAnchors.filter(row => row.healthMax.correctedSymmetric).length,
    correctedHealthMaxSymmetryRate: ratio(
      allAnchors.filter(row => row.healthMax.correctedSymmetric).length,
      allAnchors.length
    ),
    correctedHealthRegenPass: regenCorrectedPass,
    correctedHealthRegenPassRate: ratio(regenCorrectedPass, allAnchors.length),
    oldNaturalMisses: oldMisses.length,
    oldNaturalMissesResolved: oldMissesResolved,
    oldPassesPreserved,
    medianCorrectedExpirationTimingErrorSeconds: median(correctedTimingErrors),
    pauseShiftSeconds: shiftedAnchors.map(row => row.pauseShiftTicks / TICKS_PER_SECOND),
  },
  replays: replayResults,
  semanticValidation: { pass: semanticPass, checks },
  interpretation: {
    supported: semanticPass
      ? 'Survival bridge duration is consistent with 160 seconds of active game time after accounting for native pause intervals; the frozen +/-0.25s consequence window is unchanged.'
      : 'Pause-aware duration correction was evaluated, but one or more pre-specified semantic gates remain unresolved.',
    historicalPreservation: 'Script152 remains valid evidence for the raw-tick model it tested. This script does not rewrite or retune Script152; it tests a corrected clock interpretation motivated by the independently networked pause state.',
    notYetSupported: 'This script does not by itself validate all non-Survival bridge stat consequences or exact match-time interpolation values.',
  },
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('PAUSE-ADJUSTED DURATION RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                          ${status}`);
console.log(`natural anchors:                 ${allAnchors.length}`);
console.log(`pause-shifted anchors:           ${shiftedAnchors.length}`);
console.log(`old HP pass:                     ${oldHpPass}/${allAnchors.length}`);
console.log(`corrected HP pass:               ${hpCorrectedPass}/${allAnchors.length} (${formatPercent(ratio(hpCorrectedPass, allAnchors.length))})`);
console.log(`corrected HP symmetry:           ${output.aggregate.correctedHealthMaxSymmetry}/${allAnchors.length} (${formatPercent(output.aggregate.correctedHealthMaxSymmetryRate)})`);
console.log(`corrected Regen pass:            ${regenCorrectedPass}/${allAnchors.length} (${formatPercent(ratio(regenCorrectedPass, allAnchors.length))})`);
console.log(`old natural misses resolved:     ${oldMissesResolved}/${oldMisses.length}`);
console.log(`old passes preserved:            ${oldPassesPreserved}/${oldHpPass}`);
console.log(`median corrected timing error:   ${fmt(output.aggregate.medianCorrectedExpirationTimingErrorSeconds, 4)}s`);
console.log('');
console.log('PAUSE-SHIFTED / PRIOR-MISS ANCHORS');
console.log('----------------------------------');
for (const row of allAnchors.filter(anchor => anchor.pauseShiftTicks > 0 || !anchor.healthMax.oldPass)) {
  console.log(
    `${row.replayName.padEnd(8)} ${String(row.matchClock ?? '').padEnd(10)} ${String(row.playerName ?? '').padEnd(24)} `
    + `pauseShift=${formatSigned(row.pauseShiftTicks / TICKS_PER_SECOND, 3)}s `
    + `HPold=${formatTransition(row.healthMax.oldExpiration)} `
    + `HPnew=${formatTransition(row.healthMax.correctedExpiration)} `
    + `symmetric=${row.healthMax.correctedSymmetric}`
  );
}
console.log('');
console.log('SEMANTIC VALIDATION');
console.log('-------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

async function scanReplay(replayPath, anchors) {
  const targetControllers = new Set(anchors.map(row => row.controllerIndex));
  const parser = new Parser(
    new ParserConfiguration({
      entityClasses: ['CCitadelPlayerController', 'CCitadelGameRulesProxy'],
    }),
    Logger.CONSOLE_INFO
  );

  const prior = new Map();
  const transitions = [];
  const pauseIntervals = [];
  const nativePauseChanges = [];
  let maxTick = -1;
  let lastPauseState = false;
  let pauseStartTick = null;
  let pauseStateInitialized = false;
  let samplesWithPauseFields = 0;
  let lastNative = null;

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
          for (const field of ['m_iHealthMax', 'm_flHealthRegen']) {
            const value = safeGetField(entity, field);
            if (value !== undefined) prior.set(`${index}|${field}`, safeValue(value));
          }
          continue;
        }
        if (event.operation !== EntityOperation.UPDATE || !Number.isFinite(tick)) continue;

        for (const field of ['m_iHealthMax', 'm_flHealthRegen']) {
          if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;
          const key = `${index}|${field}`;
          const before = prior.has(key) ? prior.get(key) : undefined;
          const after = safeValue(changes[field]);
          prior.set(key, after);

          if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
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
      const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
      if (!Number.isFinite(tick)) return;
      maxTick = Math.max(maxTick, tick);

      const rules = parser.getDemo().getEntitiesByClassName('CCitadelGameRulesProxy')?.[0] ?? null;
      if (!rules) return;

      const native = readNativePauseState(rules);
      if (native.anyFieldObserved) samplesWithPauseFields++;
      const paused = native.gamePaused ?? native.serverPaused ?? false;

      if (!pauseStateInitialized) {
        pauseStateInitialized = true;
        lastPauseState = Boolean(paused);
        if (lastPauseState) pauseStartTick = choosePauseStartTick(native.pauseStartTick, tick);
      } else if (Boolean(paused) !== lastPauseState) {
        if (Boolean(paused)) {
          pauseStartTick = choosePauseStartTick(native.pauseStartTick, tick);
        } else if (Number.isFinite(pauseStartTick)) {
          pauseIntervals.push({
            startTick: pauseStartTick,
            endTick: tick,
            durationTicks: Math.max(0, tick - pauseStartTick),
            durationSeconds: Math.max(0, tick - pauseStartTick) / TICKS_PER_SECOND,
          });
          pauseStartTick = null;
        }
        lastPauseState = Boolean(paused);
      }

      if (!nativeStateEqual(lastNative, native)) {
        nativePauseChanges.push({ tick, ...native });
        lastNative = native;
      }
    }
  );

  try {
    await parser.parse(createReadStream(replayPath));
  } finally {
    if (lastPauseState && Number.isFinite(pauseStartTick) && maxTick >= pauseStartTick) {
      pauseIntervals.push({
        startTick: pauseStartTick,
        endTick: maxTick,
        durationTicks: maxTick - pauseStartTick,
        durationSeconds: (maxTick - pauseStartTick) / TICKS_PER_SECOND,
        censoredByReplayEnd: true,
      });
    }
    await parser.dispose();
  }

  return {
    maxTick,
    transitions,
    pauseIntervals: mergeIntervals(pauseIntervals),
    nativePauseTelemetry: {
      samplesWithPauseFields,
      changes: nativePauseChanges,
    },
  };
}

function analyzeAnchor(anchor, scan) {
  const correctedExpectedExpirationTick = addActiveTicks(
    anchor.pickupTick,
    DURATION_ACTIVE_TICKS,
    scan.pauseIntervals
  );
  const pauseShiftTicks = correctedExpectedExpirationTick - anchor.oldExpectedExpirationTick;

  return {
    ...anchor,
    correctedExpectedExpirationTick,
    pauseShiftTicks,
    pauseShiftSeconds: pauseShiftTicks / TICKS_PER_SECOND,
    pauseIntervalsOverlappingLifetime: scan.pauseIntervals.filter(row =>
      row.endTick > anchor.pickupTick && row.startTick < correctedExpectedExpirationTick
    ),
    healthMax: analyzeField({
      anchor,
      correctedExpectedExpirationTick,
      scan,
      field: 'm_iHealthMax',
      acquisition: anchor.healthMaxAcquisition,
      oldExpiration: anchor.healthMaxOldExpiration,
      oldSymmetric: anchor.healthMaxOldSymmetric,
      tolerance: HP_SYMMETRY_TOLERANCE,
    }),
    healthRegen: analyzeField({
      anchor,
      correctedExpectedExpirationTick,
      scan,
      field: 'm_flHealthRegen',
      acquisition: anchor.healthRegenAcquisition,
      oldExpiration: anchor.healthRegenOldExpiration,
      oldSymmetric: anchor.healthRegenOldSymmetric,
      tolerance: REGEN_SYMMETRY_TOLERANCE,
    }),
  };
}

function analyzeField({ anchor, correctedExpectedExpirationTick, scan, field, acquisition, oldExpiration, oldSymmetric, tolerance }) {
  const rows = scan.transitions.filter(row =>
    row.controllerIndex === anchor.controllerIndex && row.field === field
  );
  const correctedExpiration = nearestDirectedTransition(
    rows,
    correctedExpectedExpirationTick,
    EXP_HALF_WINDOW_TICKS,
    'NEGATIVE'
  );
  const correctedSymmetric = acquisition && correctedExpiration
    ? Math.abs(acquisition.delta + correctedExpiration.delta) <= tolerance
    : false;
  const oldPass = Boolean(oldExpiration?.delta < 0) && oldSymmetric === true;
  const correctedPass = Boolean(acquisition?.delta > 0)
    && Boolean(correctedExpiration?.delta < 0)
    && correctedSymmetric;

  return {
    acquisition,
    oldExpiration,
    oldSymmetric,
    oldPass,
    correctedExpiration,
    correctedSymmetric,
    correctedPass,
  };
}

function addActiveTicks(startTick, activeTicks, pauseIntervals) {
  let target = startTick + activeTicks;
  const intervals = pauseIntervals
    .filter(row => row.endTick > startTick)
    .sort((a, b) => a.startTick - b.startTick);

  for (const interval of intervals) {
    if (interval.startTick >= target) break;
    const overlapStart = Math.max(startTick, interval.startTick);
    const overlapEnd = Math.min(target, interval.endTick);
    if (overlapEnd > overlapStart) {
      const extension = overlapEnd - overlapStart;
      target += extension;
    }
  }

  // A target extension can pull a later pause interval into scope. Iterate to
  // fixed point while retaining deterministic interval order.
  let changed = true;
  while (changed) {
    changed = false;
    let recomputed = startTick + activeTicks;
    for (const interval of intervals) {
      if (interval.startTick >= target) break;
      const overlapStart = Math.max(startTick, interval.startTick);
      const overlapEnd = Math.min(target, interval.endTick);
      if (overlapEnd > overlapStart) recomputed += overlapEnd - overlapStart;
    }
    if (recomputed > target) {
      target = recomputed;
      changed = true;
    }
  }

  return target;
}

function readNativePauseState(rules) {
  const gamePaused = firstDefined(
    safeGetField(rules, 'm_pGameRules.m_bGamePaused'),
    safeGetField(rules, 'm_bGamePaused')
  );
  const serverPaused = firstDefined(
    safeGetField(rules, 'm_pGameRules.m_bServerPaused'),
    safeGetField(rules, 'm_bServerPaused')
  );
  const totalPausedTicks = normalizeFinite(firstDefined(
    safeGetField(rules, 'm_pGameRules.m_nTotalPausedTicks'),
    safeGetField(rules, 'm_nTotalPausedTicks')
  ));
  const pauseStartTick = normalizeFinite(firstDefined(
    safeGetField(rules, 'm_pGameRules.m_nPauseStartTick'),
    safeGetField(rules, 'm_nPauseStartTick')
  ));

  return {
    gamePaused: typeof gamePaused === 'boolean' ? gamePaused : null,
    serverPaused: typeof serverPaused === 'boolean' ? serverPaused : null,
    totalPausedTicks,
    pauseStartTick,
    anyFieldObserved:
      typeof gamePaused === 'boolean'
      || typeof serverPaused === 'boolean'
      || Number.isFinite(totalPausedTicks)
      || Number.isFinite(pauseStartTick),
  };
}

function choosePauseStartTick(nativePauseStartTick, observedTick) {
  if (
    Number.isFinite(nativePauseStartTick)
    && nativePauseStartTick <= observedTick
    && observedTick - nativePauseStartTick <= TICKS_PER_SECOND * 2
  ) {
    return nativePauseStartTick;
  }
  return observedTick;
}

function mergeIntervals(rows) {
  const sorted = rows
    .filter(row => Number.isFinite(row.startTick) && Number.isFinite(row.endTick) && row.endTick >= row.startTick)
    .sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const out = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (!last || row.startTick > last.endTick) {
      out.push({ ...row });
      continue;
    }
    last.endTick = Math.max(last.endTick, row.endTick);
    last.durationTicks = last.endTick - last.startTick;
    last.durationSeconds = last.durationTicks / TICKS_PER_SECOND;
    last.censoredByReplayEnd = Boolean(last.censoredByReplayEnd || row.censoredByReplayEnd);
  }
  return out;
}

function nearestDirectedTransition(rows, centerTick, halfWindowTicks, direction) {
  return rows
    .filter(row => Math.abs(row.tick - centerTick) <= halfWindowTicks)
    .filter(row => Number.isFinite(row.delta))
    .filter(row => direction === 'NEGATIVE' ? row.delta < 0 : row.delta > 0)
    .map(row => ({ ...row, dtTicks: row.tick - centerTick }))
    .sort((a, b) => Math.abs(a.dtTicks) - Math.abs(b.dtTicks) || a.tick - b.tick)[0] ?? null;
}

function safeChanges(event) {
  try {
    return event?.getChanges?.() ?? {};
  } catch {
    return {};
  }
}

function safeGetField(entity, field) {
  try {
    return entity?.getField?.(field);
  } catch {
    return undefined;
  }
}

function safeValue(value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function normalizeFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nativeStateEqual(a, b) {
  if (!a || !b) return false;
  return a.gamePaused === b.gamePaused
    && a.serverPaused === b.serverPaused
    && a.totalPausedTicks === b.totalPausedTicks
    && a.pauseStartTick === b.pauseStartTick;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}

function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (rows.length === 0) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function formatTransition(row) {
  if (!row) return 'none';
  const dt = Number.isFinite(row.dtTicks) ? ` @ ${formatSigned(row.dtTicks / TICKS_PER_SECOND, 3)}s` : '';
  return `${fmt(row.delta, 3)}${dt}`;
}

function formatSigned(value, digits = 3) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'n/a';
}
