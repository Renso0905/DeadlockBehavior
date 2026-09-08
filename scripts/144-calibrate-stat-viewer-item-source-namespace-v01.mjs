import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

import { requireClaim } from '../src/contracts/claim-registry.mjs';
import { murmurHash2 } from '../src/source2/murmurhash2.mjs';

const VERSION = 'STAT_VIEWER_ITEM_SOURCE_NAMESPACE_CALIBRATION_V01';
const TICKS_PER_SECOND = 64;
const WINDOWS = [1, 2, 4, 8, 16, 32];
const PLACEBO_SHIFTS = [-512, -256, -128, 128, 256, 512];

// ============================================================
// PURPOSE
//
// Script143 rejected the simple hypothesis that
// CCitadelPlayerController.m_vecStatViewerModifierValues.m_SourceModifierID
// directly hashes to Script136 permanent/bridge pickup record keys or
// modifier classes: test.dem exposed 18 runtime source IDs and none matched
// that candidate namespace.
//
// Script144 does NOT retune Script143. It uses the strongest independently
// validated runtime event currently available -- Script141 item acquisitions
// backed by same-player spend telemetry and exact catalog/component-credit
// amounts -- as a positive temporal calibration control.
//
// Questions:
//   1) Do stat-viewer row transitions cluster tightly around trusted item
//      acquisitions more than shifted-time placebo controls?
//   2) Which source IDs / value types move around those acquisitions?
//   3) Do observed source IDs hash to any item resource key, nested modifier
//      class, provided-property token, or non-direct MODIFIER_VALUE token from
//      the current Script139 V03 item-effect contract?
//   4) Are source IDs item-specific, or instead shared stat-source channels
//      that accumulate effects from many different items?
//
// This remains discovery/calibration. A temporal association or hash match is
// NOT by itself proof of exact runtime stacking/composition semantics.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));

const SCRIPT141_PATH = resolve('output', replayName, 'runtime_item_vector_semantic_validation_v02.json');
const ITEM_EFFECT_PATH = resolve('output', 'cross_replay', 'standard_shop_item_effect_substrate_v03.json');
const OUTPUT_PATH = resolve('output', replayName, 'stat_viewer_item_source_namespace_calibration_v01.json');

for (const requiredPath of [replayPath, SCRIPT141_PATH, ITEM_EFFECT_PATH]) {
  if (!existsSync(requiredPath)) throw new Error(`Required input missing:\n${requiredPath}`);
}

const ownershipClaim = requireClaim('runtime_item_ownership', {
  requireSemantic: true,
  requireReplication: true,
});
const effectClaim = requireClaim('shop_item_effect_contract', {
  requireSemantic: true,
});

const semantic = JSON.parse(readFileSync(SCRIPT141_PATH, 'utf8'));
const effects = JSON.parse(readFileSync(ITEM_EFFECT_PATH, 'utf8'));

if (semantic?.status !== 'RUNTIME_ITEM_VECTOR_V02_STRONG_SINGLE_REPLAY_OWNERSHIP_SEMANTICS') {
  throw new Error(`Script141 V02 is not STRONG for ${replayName}. status=${semantic?.status}`);
}
if (effects?.status !== 'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY') {
  throw new Error(`Script139 V03 effect substrate is not READY. status=${effects?.status}`);
}

const bestSpentBucket = semantic?.ownershipSemanticEvidence?.bestSpentBucket;
if (!Number.isInteger(bestSpentBucket)) {
  throw new Error('Script141 V02 does not expose a selected best spent-currency bucket.');
}

const itemRows = Array.isArray(effects.items) ? effects.items : [];
const itemByKey = new Map(itemRows.map(row => [row.recordKey, row]));
const tokenNamespace = buildItemTokenNamespace(itemRows);

const acquisitionTransitions = (semantic.transitions ?? [])
  .filter(row => Array.isArray(row.added) && row.added.length > 0);

const trustedAcquisitions = acquisitionTransitions
  .map(row => qualifyTrustedAcquisition(row, bestSpentBucket))
  .filter(Boolean);

const singleItemTrustedAcquisitions = trustedAcquisitions
  .filter(row => row.added.length === 1);

console.log('');
console.log('========================================================');
console.log('STAT-VIEWER ITEM SOURCE NAMESPACE CALIBRATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                    ${replayPath}`);
console.log(`Script141:                 ${SCRIPT141_PATH}`);
console.log(`Script139:                 ${ITEM_EFFECT_PATH}`);
console.log(`Best spent bucket:         ${bestSpentBucket}`);
console.log(`Item acquisition rows:     ${acquisitionTransitions.length}`);
console.log(`Trusted acquisitions:      ${trustedAcquisitions.length}`);
console.log(`Trusted single-item:       ${singleItemTrustedAcquisitions.length}`);
console.log(`Static source candidates:  ${tokenNamespace.candidates.length}`);
console.log(`Static hash collisions:    ${tokenNamespace.collisions.length}`);
console.log('');

const parser = new Parser(
  new ParserConfiguration({ entityClasses: ['CCitadelPlayerController', 'CCitadelGameRulesProxy'] }),
  Logger.CONSOLE_INFO
);

let matchClockOffsetSeconds = null;
let controllerMutationEvents = 0;
let statViewerRootMutations = 0;
let statViewerChildMutations = 0;

const controllers = new Map();
const statTransitions = [];

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;

    for (const event of events) {
      if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) continue;

      const entity = event.entity;
      const className = entity?.class?.name;

      if (className === 'CCitadelGameRulesProxy') {
        const gameStartTime = entity.getField('m_pGameRules.m_flGameStartTime');
        const gameStateStartTime = entity.getField('m_pGameRules.m_flGameStateStartTime');
        if (
          matchClockOffsetSeconds === null
          && Number.isFinite(gameStartTime)
          && Number.isFinite(gameStateStartTime)
        ) {
          matchClockOffsetSeconds = gameStartTime - gameStateStartTime;
        }
        continue;
      }

      if (className !== 'CCitadelPlayerController') continue;
      controllerMutationEvents++;

      const changes = safeChanges(event);
      const state = getControllerState(controllers, entity.index);
      refreshIdentity(state, entity);

      if (Object.prototype.hasOwnProperty.call(changes, 'm_vecStatViewerModifierValues')) {
        statViewerRootMutations++;
        const length = normalizeLength(changes.m_vecStatViewerModifierValues);
        if (length !== null) {
          state.declaredLength = length;
          for (const index of [...state.rows.keys()]) {
            if (index >= length) {
              const before = cloneRow(state.rows.get(index));
              state.rows.delete(index);
              recordStatTransition({ state, index, before, after: null, tick, cause: 'VECTOR_TRIM' });
            }
          }
        }
      }

      const touchedIndexes = new Set();
      for (const fieldName of Object.keys(changes)) {
        const match = /^m_vecStatViewerModifierValues\.(\d{4})\.(m_flValue|m_SourceModifierID|m_eValType)$/.exec(fieldName);
        if (!match) continue;
        statViewerChildMutations++;
        touchedIndexes.add(Number.parseInt(match[1], 10));
      }

      for (const index of touchedIndexes) {
        const before = cloneRow(state.rows.get(index) ?? null);
        const after = readStatViewerRow(entity, index, tick);

        if (after && after.sourceModifierId !== null) state.rows.set(index, after);
        else state.rows.delete(index);

        if (!rowsEqual(before, after)) {
          recordStatTransition({ state, index, before, after, tick, cause: 'ROW_MUTATION' });
        }
      }
    }
  }
);

console.log('[parse] starting replay scan...');
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

statTransitions.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
const statByController = indexEvents(statTransitions, row => String(row.controllerEntityIndex));

const calibratedAcquisitions = trustedAcquisitions.map(row =>
  decorateAcquisition(row, statByController.get(String(row.controllerEntityIndex)) ?? [])
);
const calibratedSingleItem = calibratedAcquisitions.filter(row => row.added.length === 1);

const temporalCalibration = buildTemporalCalibration(trustedAcquisitions, statByController);
const structuralTemporalCalibration = buildTemporalCalibration(
  trustedAcquisitions,
  statByController,
  row => row.transitionKind !== 'VALUE_CHANGE'
);

const pairCounts = buildItemSourcePairCounts(calibratedSingleItem);
const sourceSummary = buildSourceSummary(statTransitions, pairCounts, tokenNamespace);
const valueTypeSummary = buildValueTypeSummary(statTransitions, calibratedAcquisitions);

const observedSourceIds = [...new Set(
  statTransitions.map(row => row.sourceModifierId).filter(Number.isInteger)
)].sort((a, b) => a - b);
const observedExactHashMatches = observedSourceIds
  .map(sourceModifierId => ({
    sourceModifierId,
    candidates: tokenNamespace.byId.get(sourceModifierId) ?? [],
  }))
  .filter(row => row.candidates.length > 0);

const acquiredItemExactHashLinks = calibratedSingleItem.flatMap(acquisition => {
  const itemKey = acquisition.added[0]?.recordKey ?? null;
  if (!itemKey) return [];
  return acquisition.statTransitionsWithin8.flatMap(stat => {
    const candidates = (tokenNamespace.byId.get(stat.sourceModifierId) ?? [])
      .filter(candidate => candidate.itemKeys.includes(itemKey));
    return candidates.length > 0
      ? [{
          acquisitionTick: acquisition.tick,
          playerName: acquisition.playerName,
          itemKey,
          statTick: stat.tick,
          tickDelta: stat.tick - acquisition.tick,
          sourceModifierId: stat.sourceModifierId,
          valueType: stat.valueType,
          transitionKind: stat.transitionKind,
          candidates,
        }]
      : [];
  });
});

const checks = {
  registryRuntimeItemOwnershipReplicated: check(
    ownershipClaim.replicationStatus,
    'cross_replay_replicated',
    ownershipClaim.replicationStatus === 'cross_replay_replicated'
  ),
  registryItemEffectContractCurrent: check(
    effectClaim.authorityStatus,
    'current',
    effectClaim.authorityStatus === 'current'
  ),
  script141Strong: check(
    semantic.status,
    'RUNTIME_ITEM_VECTOR_V02_STRONG_SINGLE_REPLAY_OWNERSHIP_SEMANTICS',
    semantic.status === 'RUNTIME_ITEM_VECTOR_V02_STRONG_SINGLE_REPLAY_OWNERSHIP_SEMANTICS'
  ),
  script139Ready: check(
    effects.status,
    'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY',
    effects.status === 'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY'
  ),
  itemEffectRowsExpected: check(itemRows.length, 156, itemRows.length === 156),
  trustedAcquisitionsSubstantial: check(trustedAcquisitions.length, '>=50', trustedAcquisitions.length >= 50),
  trustedSingleItemSubstantial: check(singleItemTrustedAcquisitions.length, '>=40', singleItemTrustedAcquisitions.length >= 40),
  playerControllersObserved: check(
    [...controllers.values()].filter(row => row.playerName && row.playerName !== 'SourceTV').length,
    '>=10',
    [...controllers.values()].filter(row => row.playerName && row.playerName !== 'SourceTV').length >= 10
  ),
  statViewerChildMutationsObserved: check(statViewerChildMutations, '>0', statViewerChildMutations > 0),
  statTransitionsObserved: check(statTransitions.length, '>0', statTransitions.length > 0),
  placeboComparisonsProduced: check(
    temporalCalibration.placebo.shiftedComparisons,
    trustedAcquisitions.length * PLACEBO_SHIFTS.length,
    temporalCalibration.placebo.shiftedComparisons === trustedAcquisitions.length * PLACEBO_SHIFTS.length
  ),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'STAT_VIEWER_ITEM_SOURCE_NAMESPACE_CALIBRATION_V01_READY_FOR_INTERPRETATION'
  : 'STAT_VIEWER_ITEM_SOURCE_NAMESPACE_CALIBRATION_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: {
    replayName,
    replayPath,
    ticksPerSecond: TICKS_PER_SECOND,
    matchClockOffsetSeconds,
  },
  foundations: {
    runtimeItemOwnershipClaim: ownershipClaim.claimId,
    itemEffectContractClaim: effectClaim.claimId,
    script141Artifact: SCRIPT141_PATH,
    script139Artifact: ITEM_EFFECT_PATH,
    selectedSpentCurrencyBucket: bestSpentBucket,
  },
  calibrationPolicy: {
    unit: 'TRUSTED_ITEM_ACQUISITION_TRANSITION',
    trustedAcquisitionRule: 'Script141 addition with same-player selected-bucket spend within 8 ticks AND exact full-added-price or net-upgrade-price agreement.',
    itemSpecificRule: 'Item-to-source associations use only trusted transitions containing exactly one added standard-shop item.',
    temporalWindowsTicks: WINDOWS,
    placeboShiftTicks: PLACEBO_SHIFTS,
    placeboPolicy: 'Same player/controller, same acquisition event, shifted target time. No per-item or per-source threshold fitting.',
  },
  counts: {
    controllerMutationEvents,
    playerControllers: [...controllers.values()].filter(row => row.playerName && row.playerName !== 'SourceTV').length,
    statViewerRootMutations,
    statViewerChildMutations,
    statTransitions: statTransitions.length,
    distinctObservedSourceModifierIds: observedSourceIds.length,
    itemAcquisitionTransitions: acquisitionTransitions.length,
    trustedAcquisitions: trustedAcquisitions.length,
    trustedSingleItemAcquisitions: singleItemTrustedAcquisitions.length,
    staticHashCandidates: tokenNamespace.candidates.length,
    staticHashCollisions: tokenNamespace.collisions.length,
    observedSourceIdsWithAnyExactStaticTokenHashMatch: observedExactHashMatches.length,
    trustedSingleItemAcquisitionExactItemTokenHashLinksWithin8: acquiredItemExactHashLinks.length,
  },
  temporalCalibration,
  structuralTemporalCalibration,
  staticTokenNamespace: {
    method: 'MURMURHASH2_UTF8_SOURCE2_STRING_TOKEN',
    seedHex: '0x31415926',
    tokenKinds: [
      'ITEM_RECORD_KEY',
      'NESTED_MODIFIER_CLASS',
      'DIRECT_PROVIDED_PROPERTY_TYPE_DIAGNOSTIC',
      'NON_DIRECT_MODIFIER_VALUE_TYPE_DIAGNOSTIC',
    ],
    collisions: tokenNamespace.collisions,
    observedExactHashMatches,
  },
  acquiredItemExactHashLinksWithin8: acquiredItemExactHashLinks,
  itemSourcePairs: pairCounts,
  sourceSummary,
  valueTypeSummary,
  statTransitions,
  trustedAcquisitions: calibratedAcquisitions,
  interpretation: buildInterpretation({
    temporalCalibration,
    structuralTemporalCalibration,
    observedExactHashMatches,
    acquiredItemExactHashLinks,
    pairCounts,
  }),
  validation: { pass: validationPass, checks },
  nextStage: validationPass
    ? 'INTERPRET_TRUE_VS_PLACEBO_ENRICHMENT_AND_SOURCE_ITEM_SPECIFICITY_THEN_FORM_NARROW_SOURCE_ID_NAMESPACE_HYPOTHESIS'
    : 'DIAGNOSE_TRUSTED_ACQUISITION_SELECTION_OR_STAT_VIEWER_REPLAY_EXTRACTION_BEFORE_NAMESPACE_INFERENCE',
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('STAT-VIEWER ITEM SOURCE CALIBRATION RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                         ${status}`);
console.log(`trusted acquisitions:           ${trustedAcquisitions.length}`);
console.log(`trusted single-item:            ${singleItemTrustedAcquisitions.length}`);
console.log(`stat transitions:               ${statTransitions.length}`);
console.log(`distinct source IDs:            ${observedSourceIds.length}`);
console.log(`true any stat <=8t:             ${formatPercent(temporalCalibration.true.within8)}`);
console.log(`placebo any stat <=8t:          ${formatPercent(temporalCalibration.placebo.within8)}`);
console.log(`true-placebo advantage <=8t:    ${formatPercentagePoints(temporalCalibration.advantage.within8)}`);
console.log(`true structural <=8t:           ${formatPercent(structuralTemporalCalibration.true.within8)}`);
console.log(`placebo structural <=8t:        ${formatPercent(structuralTemporalCalibration.placebo.within8)}`);
console.log(`exact static source hash IDs:   ${observedExactHashMatches.length}`);
console.log(`exact acquired-item links <=8t: ${acquiredItemExactHashLinks.length}`);
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function qualifyTrustedAcquisition(row, bucket) {
  const evidence = row?.spentCurrencyEvidence?.[bucket] ?? row?.spentCurrencyEvidence?.[String(bucket)] ?? null;
  const nearest = evidence?.nearest ?? null;
  if (!evidence?.within8 || !nearest || !Number.isFinite(nearest.delta) || nearest.delta <= 0) return null;

  const full = row?.expectedSpend?.fullAddedPrice;
  const net = row?.expectedSpend?.netUpgradePrice;
  const fullMatch = Number.isFinite(full) && nearest.delta === full;
  const netMatch = Number.isFinite(net) && nearest.delta === net;
  if (!fullMatch && !netMatch) return null;

  return {
    tick: row.tick,
    demoSeconds: row.demoSeconds ?? (Number.isFinite(row.tick) ? row.tick / TICKS_PER_SECOND : null),
    matchTimeSeconds: row.matchTimeSeconds ?? null,
    controllerEntityIndex: row.controllerEntityIndex,
    playerName: row.playerName ?? null,
    steamId: row.steamId ?? null,
    heroId: row.heroId ?? null,
    team: row.team ?? null,
    added: row.added,
    removed: Array.isArray(row.removed) ? row.removed : [],
    spend: {
      bucket,
      spendTick: nearest.tick,
      tickDelta: nearest.tickDelta,
      delta: nearest.delta,
      exactFullAddedPrice: fullMatch,
      exactNetUpgradePrice: netMatch,
      fullAddedPrice: full,
      netUpgradePrice: net,
    },
  };
}

function recordStatTransition({ state, index, before, after, tick, cause }) {
  const sourceModifierId = after?.sourceModifierId ?? before?.sourceModifierId ?? null;
  const valueType = after?.valueType ?? before?.valueType ?? null;
  const transitionKind = classifyTransition(before, after);
  const beforeValue = before?.value ?? null;
  const afterValue = after?.value ?? null;
  const valueDelta = Number.isFinite(beforeValue) && Number.isFinite(afterValue)
    ? afterValue - beforeValue
    : null;

  statTransitions.push({
    tick,
    demoSeconds: Number.isFinite(tick) ? tick / TICKS_PER_SECOND : null,
    matchTimeSeconds: Number.isFinite(tick) && Number.isFinite(matchClockOffsetSeconds)
      ? tick / TICKS_PER_SECOND - matchClockOffsetSeconds
      : null,
    cause,
    transitionKind,
    controllerEntityIndex: state.entityIndex,
    playerName: state.playerName,
    steamId: state.steamId,
    heroId: state.heroId,
    team: state.team,
    vectorIndex: index,
    sourceModifierId,
    valueType,
    before,
    after,
    beforeValue,
    afterValue,
    valueDelta,
  });
}

function decorateAcquisition(acquisition, controllerStatTransitions) {
  const within = {};
  for (const window of WINDOWS) {
    within[window] = transitionsWithin(controllerStatTransitions, acquisition.tick, window);
  }
  const nearest = nearestTransition(controllerStatTransitions, acquisition.tick, Math.max(...WINDOWS));

  return {
    ...acquisition,
    nearestStatTransition: nearest ? decorateRelative(nearest, acquisition.tick) : null,
    statTransitionCountsByWindow: Object.fromEntries(
      WINDOWS.map(window => [window, within[window].length])
    ),
    statTransitionsWithin8: (within[8] ?? []).map(row => decorateRelative(row, acquisition.tick)),
    statTransitionsWithin32: (within[32] ?? []).map(row => decorateRelative(row, acquisition.tick)),
  };
}

function buildTemporalCalibration(acquisitions, statByController, filterFn = () => true) {
  const trueCounts = Object.fromEntries(WINDOWS.map(window => [window, 0]));
  const trueNearestDistances = [];
  const shiftedCounts = Object.fromEntries(WINDOWS.map(window => [window, 0]));
  let shiftedComparisons = 0;

  for (const acquisition of acquisitions) {
    const events = (statByController.get(String(acquisition.controllerEntityIndex)) ?? []).filter(filterFn);
    const nearest = nearestTransition(events, acquisition.tick, Math.max(...WINDOWS));
    if (nearest) {
      const distance = Math.abs(nearest.tick - acquisition.tick);
      trueNearestDistances.push(distance);
      for (const window of WINDOWS) {
        if (distance <= window) trueCounts[window]++;
      }
    }

    for (const shift of PLACEBO_SHIFTS) {
      shiftedComparisons++;
      const targetTick = acquisition.tick + shift;
      const placeboNearest = nearestTransition(events, targetTick, Math.max(...WINDOWS));
      if (!placeboNearest) continue;
      const distance = Math.abs(placeboNearest.tick - targetTick);
      for (const window of WINDOWS) {
        if (distance <= window) shiftedCounts[window]++;
      }
    }
  }

  const trueRates = Object.fromEntries(
    WINDOWS.map(window => [`within${window}`, safeRatio(trueCounts[window], acquisitions.length)])
  );
  const placeboRates = Object.fromEntries(
    WINDOWS.map(window => [`within${window}`, safeRatio(shiftedCounts[window], shiftedComparisons)])
  );
  const advantage = Object.fromEntries(
    WINDOWS.map(window => {
      const t = trueRates[`within${window}`];
      const p = placeboRates[`within${window}`];
      return [`within${window}`, Number.isFinite(t) && Number.isFinite(p) ? t - p : null];
    })
  );

  return {
    true: {
      comparisons: acquisitions.length,
      ...trueRates,
      medianAbsoluteNearestTickDistanceWithin32: median(trueNearestDistances.filter(value => value <= 32)),
    },
    placebo: {
      shiftedComparisons,
      ...placeboRates,
    },
    advantage,
  };
}

function buildItemSourcePairCounts(calibratedSingleItem) {
  const map = new Map();
  const itemAcquisitionCounts = new Map();

  for (const acquisition of calibratedSingleItem) {
    const itemKey = acquisition.added[0]?.recordKey ?? null;
    if (!itemKey) continue;
    increment(itemAcquisitionCounts, itemKey);
    const item = itemByKey.get(itemKey) ?? null;

    // Eight ticks is inherited from the strong transaction-calibration window.
    // Count one association per acquisition/source/valueType/kind tuple so a
    // packet that touches several child fields cannot inflate the pair count.
    const seenThisAcquisition = new Set();
    for (const stat of acquisition.statTransitionsWithin8) {
      if (!Number.isInteger(stat.sourceModifierId)) continue;
      const key = `${itemKey}|${stat.sourceModifierId}|${stat.valueType ?? 'null'}|${stat.transitionKind}`;
      if (seenThisAcquisition.has(key)) continue;
      seenThisAcquisition.add(key);

      if (!map.has(key)) {
        map.set(key, {
          itemKey,
          itemSlot: item?.slot ?? null,
          itemTier: item?.tier ?? null,
          sourceModifierId: stat.sourceModifierId,
          valueType: stat.valueType,
          transitionKind: stat.transitionKind,
          acquisitionAssociationsWithin8: 0,
          tickDeltas: [],
          valueDeltas: [],
        });
      }
      const row = map.get(key);
      row.acquisitionAssociationsWithin8++;
      row.tickDeltas.push(stat.tickDelta);
      if (Number.isFinite(stat.valueDelta)) row.valueDeltas.push(stat.valueDelta);
    }
  }

  return [...map.values()]
    .map(row => ({
      ...row,
      trustedSingleItemAcquisitions: itemAcquisitionCounts.get(row.itemKey) ?? 0,
      associationRateWithin8: safeRatio(
        row.acquisitionAssociationsWithin8,
        itemAcquisitionCounts.get(row.itemKey) ?? 0
      ),
      medianTickDelta: median(row.tickDeltas),
      medianValueDelta: median(row.valueDeltas),
      tickDeltas: undefined,
      valueDeltas: undefined,
    }))
    .sort((a, b) =>
      b.acquisitionAssociationsWithin8 - a.acquisitionAssociationsWithin8
      || a.itemKey.localeCompare(b.itemKey)
      || a.sourceModifierId - b.sourceModifierId
    );
}

function buildSourceSummary(transitions, pairs, namespace) {
  const map = new Map();

  for (const transition of transitions) {
    const sourceModifierId = transition.sourceModifierId;
    if (!Number.isInteger(sourceModifierId)) continue;
    if (!map.has(sourceModifierId)) {
      map.set(sourceModifierId, {
        sourceModifierId,
        transitionCount: 0,
        transitionKinds: new Map(),
        valueTypes: new Set(),
        valueDeltas: [],
      });
    }
    const row = map.get(sourceModifierId);
    row.transitionCount++;
    increment(row.transitionKinds, transition.transitionKind);
    if (Number.isInteger(transition.valueType)) row.valueTypes.add(transition.valueType);
    if (Number.isFinite(transition.valueDelta)) row.valueDeltas.push(transition.valueDelta);
  }

  const pairsBySource = indexEvents(pairs, row => String(row.sourceModifierId));

  return [...map.values()]
    .map(row => {
      const sourcePairs = pairsBySource.get(String(row.sourceModifierId)) ?? [];
      const itemCounts = new Map();
      for (const pair of sourcePairs) {
        itemCounts.set(pair.itemKey, (itemCounts.get(pair.itemKey) ?? 0) + pair.acquisitionAssociationsWithin8);
      }
      const topItems = [...itemCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([itemKey, acquisitionAssociationsWithin8]) => ({ itemKey, acquisitionAssociationsWithin8 }));

      return {
        sourceModifierId: row.sourceModifierId,
        transitionCount: row.transitionCount,
        transitionKinds: Object.fromEntries([...row.transitionKinds.entries()].sort()),
        valueTypes: [...row.valueTypes].sort((a, b) => a - b),
        valueTypeStable: row.valueTypes.size <= 1,
        medianValueDelta: median(row.valueDeltas),
        exactStaticHashCandidates: namespace.byId.get(row.sourceModifierId) ?? [],
        associatedDistinctSingleItemsWithin8: topItems.length,
        associatedSingleItemAcquisitionsWithin8: topItems.reduce((sum, item) => sum + item.acquisitionAssociationsWithin8, 0),
        topAssociatedItemsWithin8: topItems.slice(0, 20),
      };
    })
    .sort((a, b) => b.transitionCount - a.transitionCount || a.sourceModifierId - b.sourceModifierId);
}

function buildValueTypeSummary(transitions, acquisitions) {
  const map = new Map();
  for (const row of transitions) {
    if (!Number.isInteger(row.valueType)) continue;
    if (!map.has(row.valueType)) {
      map.set(row.valueType, {
        valueType: row.valueType,
        transitionCount: 0,
        sourceIds: new Set(),
      });
    }
    const out = map.get(row.valueType);
    out.transitionCount++;
    if (Number.isInteger(row.sourceModifierId)) out.sourceIds.add(row.sourceModifierId);
  }

  const acquisitionAssociations = new Map();
  for (const acquisition of acquisitions) {
    const seen = new Set();
    for (const stat of acquisition.statTransitionsWithin8) {
      if (!Number.isInteger(stat.valueType) || seen.has(stat.valueType)) continue;
      seen.add(stat.valueType);
      increment(acquisitionAssociations, stat.valueType);
    }
  }

  return [...map.values()]
    .map(row => ({
      valueType: row.valueType,
      transitionCount: row.transitionCount,
      distinctSourceIds: row.sourceIds.size,
      sourceIds: [...row.sourceIds].sort((a, b) => a - b),
      trustedAcquisitionsAssociatedWithin8: acquisitionAssociations.get(row.valueType) ?? 0,
    }))
    .sort((a, b) => b.transitionCount - a.transitionCount || a.valueType - b.valueType);
}

function buildItemTokenNamespace(items) {
  const candidates = [];

  for (const item of items) {
    const itemKey = item?.recordKey;
    if (!itemKey) continue;

    addCandidate(candidates, {
      token: itemKey,
      tokenKind: 'ITEM_RECORD_KEY',
      itemKeys: [itemKey],
    });

    for (const token of item?.nestedModifierClasses ?? []) {
      addCandidate(candidates, {
        token,
        tokenKind: 'NESTED_MODIFIER_CLASS',
        itemKeys: [itemKey],
      });
    }

    for (const stat of item?.meaningfulDirectProvidedStats ?? []) {
      const token = stat?.providedPropertyType;
      if (!token) continue;
      addCandidate(candidates, {
        token,
        tokenKind: 'DIRECT_PROVIDED_PROPERTY_TYPE_DIAGNOSTIC',
        itemKeys: [itemKey],
      });
    }

    for (const token of item?.nonDirectModifierTokens ?? []) {
      addCandidate(candidates, {
        token,
        tokenKind: 'NON_DIRECT_MODIFIER_VALUE_TYPE_DIAGNOSTIC',
        itemKeys: [itemKey],
      });
    }
  }

  // Merge identical token/kind rows across items before hashing so ubiquitous
  // modifier/property tokens are represented once with the complete item set.
  const merged = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.tokenKind}|${candidate.token}`;
    if (!merged.has(key)) merged.set(key, { ...candidate, itemKeys: new Set() });
    for (const itemKey of candidate.itemKeys) merged.get(key).itemKeys.add(itemKey);
  }

  const rows = [...merged.values()].map(row => ({
    token: row.token,
    tokenKind: row.tokenKind,
    itemKeys: [...row.itemKeys].sort(),
    sourceId: murmurHash2(row.token),
  }));

  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.sourceId)) byId.set(row.sourceId, []);
    byId.get(row.sourceId).push(row);
  }

  const collisions = [...byId.entries()]
    .filter(([, values]) => new Set(values.map(value => value.token)).size > 1)
    .map(([sourceId, values]) => ({
      sourceId,
      tokens: [...new Set(values.map(value => value.token))].sort(),
    }));

  return { candidates: rows, byId, collisions };
}

function addCandidate(array, candidate) {
  if (!candidate?.token || !candidate?.tokenKind) return;
  array.push(candidate);
}

function buildInterpretation({
  temporalCalibration,
  structuralTemporalCalibration,
  observedExactHashMatches,
  acquiredItemExactHashLinks,
  pairCounts,
}) {
  const timingAdvantage8 = temporalCalibration?.advantage?.within8 ?? null;
  const structuralAdvantage8 = structuralTemporalCalibration?.advantage?.within8 ?? null;
  const itemPairs = new Set(pairCounts.map(row => `${row.itemKey}|${row.sourceModifierId}`));

  return {
    supported: [
      'Script141 V02 exact-spend-backed item acquisitions are used as positive calibration events; item ownership semantics are not rediscovered or refit here.',
      'All stat-viewer row transitions are preserved, including source/value-type/value changes that Script143 intentionally omitted from its failed world-buff-token artifact.',
      'True acquisition-time association and same-controller shifted-time placebo association are reported separately.',
    ],
    diagnostics: {
      anyTransitionTemporalAdvantageWithin8: timingAdvantage8,
      structuralTransitionTemporalAdvantageWithin8: structuralAdvantage8,
      observedSourceIdsWithAnyExactStaticHashMatch: observedExactHashMatches.length,
      exactAcquiredItemHashLinksWithin8: acquiredItemExactHashLinks.length,
      distinctObservedItemSourcePairsWithin8: itemPairs.size,
    },
    inferenceGuide: [
      'If true acquisition-time association substantially exceeds shifted placebo, m_vecStatViewerModifierValues is temporally responsive to item transactions even if source IDs do not directly hash to item tokens.',
      'If exact source hashes map to the acquired item record/modifier tokens and are temporally enriched, an item/modifier token namespace becomes a direct candidate.',
      'If source IDs are value-type-stable but associate with many different items, prefer an aggregated stat-source/channel interpretation over one-source-ID-per-item.',
      'If true timing does not exceed placebo, do not use this vector as an item-effect or world-buff runtime composition substrate without a different independent calibration signal.',
    ],
    notClaimed: [
      'No SourceModifierID is labeled as an item, modifier, permanent pickup, bridge powerup, or effective stat solely from this discovery script.',
      'A stat-viewer value delta is not assumed to equal the final effective player-stat delta or establish stacking order.',
      'Single-replay calibration is not cross-replay semantic replication.',
    ],
  };
}

function classifyTransition(before, after) {
  if (!before && after) return 'ROW_ADD';
  if (before && !after) return 'ROW_REMOVE';
  if (!before && !after) return 'NO_ROW';
  if (before.sourceModifierId !== after.sourceModifierId) return 'SOURCE_CHANGE';
  if (before.valueType !== after.valueType) return 'VALUE_TYPE_CHANGE';
  if (before.value !== after.value) return 'VALUE_CHANGE';
  return 'OTHER_CHANGE';
}

function transitionsWithin(events, tick, window) {
  if (!Number.isFinite(tick)) return [];
  return events.filter(event => Number.isFinite(event.tick) && Math.abs(event.tick - tick) <= window);
}

function nearestTransition(events, tick, maxDistance) {
  if (!Number.isFinite(tick) || events.length === 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const event of events) {
    if (!Number.isFinite(event.tick)) continue;
    const distance = Math.abs(event.tick - tick);
    if (distance > maxDistance) continue;
    if (distance < bestDistance || (distance === bestDistance && event.tick < best.tick)) {
      best = event;
      bestDistance = distance;
    }
  }
  return best;
}

function decorateRelative(row, referenceTick) {
  return { ...row, tickDelta: Number.isFinite(row.tick) ? row.tick - referenceTick : null };
}

function readStatViewerRow(entity, index, tick) {
  const suffix = String(index).padStart(4, '0');
  const sourceModifierId = normalizeUnsignedId(entity.getField(`m_vecStatViewerModifierValues.${suffix}.m_SourceModifierID`));
  const valueType = normalizeInteger(entity.getField(`m_vecStatViewerModifierValues.${suffix}.m_eValType`));
  const value = normalizeNumber(entity.getField(`m_vecStatViewerModifierValues.${suffix}.m_flValue`));
  if (sourceModifierId === null && valueType === null && value === null) return null;
  return { sourceModifierId, valueType, value, lastTick: tick };
}

function getControllerState(map, entityIndex) {
  if (!map.has(entityIndex)) {
    map.set(entityIndex, {
      entityIndex,
      playerName: null,
      steamId: null,
      heroId: null,
      team: null,
      declaredLength: null,
      rows: new Map(),
    });
  }
  return map.get(entityIndex);
}

function refreshIdentity(state, entity) {
  const playerName = entity.getField('m_iszPlayerName');
  if (playerName !== undefined && playerName !== null) state.playerName = String(playerName);
  const steamId = entity.getField('m_steamID');
  if (steamId !== undefined && steamId !== null) state.steamId = safeValue(steamId);
  const heroId = entity.getField('m_nHeroID');
  if (heroId !== undefined && heroId !== null) state.heroId = heroId;
  const team = entity.getField('m_iTeamNum');
  if (team !== undefined && team !== null) state.team = team;
}

function rowsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.sourceModifierId === b.sourceModifierId
    && a.valueType === b.valueType
    && a.value === b.value;
}

function cloneRow(row) {
  return row ? { ...row } : null;
}

function indexEvents(events, keyFn) {
  const map = new Map();
  for (const event of events) {
    const key = keyFn(event);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
  }
  return map;
}

function normalizeLength(value) {
  const n = normalizeInteger(value);
  return n !== null && n >= 0 && n <= 128 ? n : null;
}

function normalizeUnsignedId(value) {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n >>> 0 : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value) >>> 0;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n >>> 0 : null;
  }
  return null;
}

function normalizeInteger(value) {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function safeChanges(event) {
  try {
    return event.getChanges() ?? {};
  } catch {
    return {};
  }
}

function safeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function formatPercentagePoints(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)} pp` : 'n/a';
}
