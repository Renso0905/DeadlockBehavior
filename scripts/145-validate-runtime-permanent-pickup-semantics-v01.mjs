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
import {
  buildWorldBuffRuntimeSubclassMap,
  summarizeWorldBuffSubclassResolution,
} from '../src/resources/world-buff-runtime-subclass-map.mjs';

const VERSION = 'RUNTIME_PERMANENT_PICKUP_SEMANTIC_VALIDATION_V01';
const TICKS_PER_SECOND = 64;
const EPSILON = 1e-5;

// ============================================================
// PURPOSE
//
// Script143 discovered 18 m_vecStatViewerModifierValues source IDs but failed
// to resolve them by hashing pickup record keys and modifier class names as
// separate Source2 tokens.
//
// Script144 independently showed that trusted standard-shop item acquisitions
// do not temporally drive this vector, rejecting an item-purchase composition
// interpretation for the observed rows.
//
// Source2 schema identifies m_SourceModifierID as EntitySubclassID_t. The
// corrected candidate namespace is therefore the compound subclass path:
//
//   <recordKey>/<modifierClass>
//
// For the Script136 V02 permanent world-buff contract this yields exactly 18
// candidates (6 stat families x 3 tiers). Script145 validates whether replay
// rows resolve to those compound IDs and whether their runtime values behave
// like accumulated permanent-pickup effects:
//
//   - source IDs resolve without collisions,
//   - each family uses one stable m_eValType and families remain distinct,
//   - positive row additions/value increases are integer multiples of the
//     static per-pickup effect for that exact record/tier,
//   - in-place values never decrease,
//   - final retained values are integer multiples of the static unit effect.
//
// This is single-replay semantic validation only. It does NOT yet promote the
// global runtime_permanent_buff_ownership claim; independent replay replication
// is required first.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));

const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');
const OUTPUT_PATH = resolve('output', replayName, 'runtime_permanent_pickup_semantic_validation_v01.json');

if (!existsSync(replayPath)) throw new Error(`Replay not found:\n${replayPath}`);
if (!existsSync(CONTRACT_PATH)) throw new Error(`Script136 V02 contract missing:\n${CONTRACT_PATH}`);

const permanentClaim = requireClaim('permanent_world_buff_resource_contract', { requireSemantic: true });
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 V02 world-buff contract is not ready. status=${contract?.status}`);
}

const subclassMap = buildWorldBuffRuntimeSubclassMap(contract);
const permanentCandidates = subclassMap.permanentCandidates;

console.log('');
console.log('========================================================');
console.log('RUNTIME PERMANENT PICKUP SEMANTIC VALIDATION V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                       ${replayPath}`);
console.log(`Resource contract:            ${CONTRACT_PATH}`);
console.log(`Permanent subclass candidates:${permanentCandidates.length}`);
console.log(`Bridge subclass candidates:   ${subclassMap.bridgeCandidates.length}`);
console.log(`Subclass hash collisions:     ${subclassMap.collisions.length}`);
console.log('Replay field:                  CCitadelPlayerController.m_vecStatViewerModifierValues');
console.log('');

const parser = new Parser(
  new ParserConfiguration({
    entityClasses: ['CCitadelPlayerController', 'CCitadelGameRulesProxy'],
  }),
  Logger.CONSOLE_INFO
);

let matchClockOffsetSeconds = null;
let controllerMutationEvents = 0;
let statViewerRootMutations = 0;
let statViewerChildMutations = 0;

const controllers = new Map();
const transitions = [];

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
              recordTransition({ state, index, before, after: null, tick, cause: 'VECTOR_TRIM' });
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
          recordTransition({ state, index, before, after, tick, cause: 'ROW_MUTATION' });
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

transitions.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));

const playerStates = [...controllers.entries()]
  .filter(([, state]) => state.playerName && state.playerName !== 'SourceTV')
  .map(([controllerEntityIndex, state]) => ({
    controllerEntityIndex,
    playerName: state.playerName,
    steamId: state.steamId,
    heroId: state.heroId,
    team: state.team,
    finalRows: [...state.rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([vectorIndex, row]) => ({ vectorIndex, ...decorateRow(row, subclassMap) })),
  }));

const observedSourceIds = [...new Set(
  transitions.flatMap(row => [row.before?.sourceModifierId, row.after?.sourceModifierId])
    .filter(Number.isInteger)
)].sort((a, b) => a - b);

const observedResolutions = observedSourceIds.map(sourceModifierId => ({
  sourceModifierId,
  resolution: summarizeWorldBuffSubclassResolution(sourceModifierId, subclassMap),
}));

const observedPermanentSourceIds = observedResolutions
  .filter(row => row.resolution.buffClasses.includes('PERMANENT_PICKUP'))
  .map(row => row.sourceModifierId);
const observedBridgeSourceIds = observedResolutions
  .filter(row => row.resolution.buffClasses.includes('BRIDGE_POWERUP'))
  .map(row => row.sourceModifierId);
const unresolvedObservedSourceIds = observedResolutions
  .filter(row => !row.resolution.matched)
  .map(row => row.sourceModifierId);

const permanentSourceIdSet = new Set(observedPermanentSourceIds);
const transitionContributions = transitions.flatMap(row => buildContributions(row, subclassMap));
const permanentContributions = transitionContributions.filter(row => row.buffClass === 'PERMANENT_PICKUP');
const positivePermanentContributions = permanentContributions.filter(row => Number.isFinite(row.delta) && row.delta > EPSILON);
const negativeInPlacePermanentContributions = permanentContributions.filter(row =>
  row.contributionKind === 'IN_PLACE_VALUE_DELTA'
  && Number.isFinite(row.delta)
  && row.delta < -EPSILON
);
const permanentRemovalContributions = permanentContributions.filter(row => row.contributionKind === 'ROW_REMOVE');

const exactPositiveAmountEvents = positivePermanentContributions.filter(row => row.exactPositiveUnitMultiple).length;
const positiveAmountMatchRate = safeRatio(exactPositiveAmountEvents, positivePermanentContributions.length);
const inferredAcquisitionUnits = positivePermanentContributions.reduce(
  (sum, row) => sum + (Number.isInteger(row.inferredUnitCount) ? row.inferredUnitCount : 0),
  0
);

const familyValueTypes = summarizeFamilyValueTypes(transitions, subclassMap);
const familiesWithStableSingleValueType = familyValueTypes.filter(row => row.stableSingleValueType).length;
const stableFamilyValueTypeIds = familyValueTypes
  .filter(row => row.stableSingleValueType)
  .map(row => row.valueTypes[0]);
const distinctStableFamilyValueTypes = new Set(stableFamilyValueTypeIds).size;

const permanentRecordSummary = summarizePermanentRecords({
  candidates: permanentCandidates,
  transitions,
  contributions: permanentContributions,
  playerStates,
  subclassMap,
});

const finalPermanentRows = playerStates.flatMap(player =>
  player.finalRows
    .filter(row => row.resolution?.buffClasses?.includes('PERMANENT_PICKUP'))
    .map(row => {
      const candidate = soleCandidate(row.resolution);
      const expectedUnitValue = expectedUnit(candidate);
      const ratio = Number.isFinite(row.value) && Number.isFinite(expectedUnitValue) && Math.abs(expectedUnitValue) > EPSILON
        ? row.value / expectedUnitValue
        : null;
      return {
        controllerEntityIndex: player.controllerEntityIndex,
        playerName: player.playerName,
        sourceModifierId: row.sourceModifierId,
        recordKey: candidate?.recordKey ?? null,
        family: candidate?.family ?? null,
        tier: candidate?.tier ?? null,
        valueType: row.valueType,
        value: row.value,
        expectedUnitValue,
        inferredCount: nearlyInteger(ratio) && ratio >= -EPSILON ? Math.round(ratio) : null,
        exactUnitMultiple: nearlyInteger(ratio),
      };
    })
);
const finalRowsWithResolvedUnit = finalPermanentRows.filter(row => Number.isFinite(row.expectedUnitValue));
const finalRowsExactUnitMultiple = finalRowsWithResolvedUnit.filter(row => row.exactUnitMultiple).length;
const finalUnitMultipleRate = safeRatio(finalRowsExactUnitMultiple, finalRowsWithResolvedUnit.length);

const permanentCandidatesObserved = permanentCandidates.filter(row => permanentSourceIdSet.has(row.sourceId)).length;
const sourceIdMappingCoverage = safeRatio(observedPermanentSourceIds.length, observedSourceIds.length);
const permanentCandidateCoverage = safeRatio(permanentCandidatesObserved, permanentCandidates.length);

const checks = {
  registryPermanentResourceContractCurrent: check(
    permanentClaim.authorityStatus,
    'current',
    permanentClaim.authorityStatus === 'current'
  ),
  script136ContractReady: check(
    contract.status,
    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',
    contract.status === 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'
  ),
  subclassHashCollisionsAbsent: check(subclassMap.collisions.length, 0, subclassMap.collisions.length === 0),
  permanentSubclassCandidatesExpected: check(permanentCandidates.length, 18, permanentCandidates.length === 18),
  playerControllersObserved: check(playerStates.length, '>=10', playerStates.length >= 10),
  statViewerChildMutationsObserved: check(statViewerChildMutations, '>0', statViewerChildMutations > 0),
  permanentSubclassSourcesObserved: check(observedPermanentSourceIds.length, '>0', observedPermanentSourceIds.length > 0),
  permanentFamiliesObserved: check(familyValueTypes.length, 6, familyValueTypes.length === 6),
  familyValueTypesStable: check(
    familiesWithStableSingleValueType,
    familyValueTypes.length,
    familyValueTypes.length > 0 && familiesWithStableSingleValueType === familyValueTypes.length
  ),
  familyValueTypesDistinct: check(
    distinctStableFamilyValueTypes,
    familyValueTypes.length,
    familyValueTypes.length > 0 && distinctStableFamilyValueTypes === familyValueTypes.length
  ),
  positivePermanentAccumulationObserved: check(
    positivePermanentContributions.length,
    '>0',
    positivePermanentContributions.length > 0
  ),
  positiveAmountsMatchStaticUnitMultiples: check(
    exactPositiveAmountEvents,
    positivePermanentContributions.length,
    positivePermanentContributions.length > 0 && exactPositiveAmountEvents === positivePermanentContributions.length
  ),
  noNegativeInPlacePermanentValueDeltas: check(
    negativeInPlacePermanentContributions.length,
    0,
    negativeInPlacePermanentContributions.length === 0
  ),
  finalPermanentValuesMatchStaticUnitMultiples: check(
    finalRowsExactUnitMultiple,
    finalRowsWithResolvedUnit.length,
    finalRowsWithResolvedUnit.length > 0 && finalRowsExactUnitMultiple === finalRowsWithResolvedUnit.length
  ),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'RUNTIME_PERMANENT_PICKUP_V01_STRONG_SINGLE_REPLAY_SEMANTICS'
  : 'RUNTIME_PERMANENT_PICKUP_V01_SEMANTIC_VALIDATION_REQUIRES_DIAGNOSIS';

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
    permanentWorldBuffClaim: permanentClaim.claimId,
    resourceContractArtifact: CONTRACT_PATH,
    sourceNamespace: subclassMap.namespace,
    sourceNamespaceTokenFormat: '<recordKey>/<modifierClass>',
  },
  counts: {
    controllerMutationEvents,
    playerControllers: playerStates.length,
    statViewerRootMutations,
    statViewerChildMutations,
    rowTransitions: transitions.length,
    distinctObservedSourceIds: observedSourceIds.length,
    observedPermanentSourceIds: observedPermanentSourceIds.length,
    observedBridgeSourceIds: observedBridgeSourceIds.length,
    unresolvedObservedSourceIds: unresolvedObservedSourceIds.length,
    permanentSubclassCandidates: permanentCandidates.length,
    permanentSubclassCandidatesObserved: permanentCandidatesObserved,
    positivePermanentAccumulationEvents: positivePermanentContributions.length,
    exactPositiveAmountEvents,
    inferredPermanentPickupUnits: inferredAcquisitionUnits,
    negativeInPlacePermanentValueDeltas: negativeInPlacePermanentContributions.length,
    permanentRowRemovals: permanentRemovalContributions.length,
    finalPermanentRows: finalPermanentRows.length,
  },
  sourceNamespaceEvidence: {
    observedSourceIds,
    observedResolutions,
    observedPermanentSourceIds,
    observedBridgeSourceIds,
    unresolvedObservedSourceIds,
    sourceIdMappingCoverage,
    permanentCandidateCoverage,
    permanentCandidates: permanentCandidates.map(row => ({
      sourceModifierId: row.sourceId,
      token: row.token,
      recordKey: row.recordKey,
      modifierClass: row.modifierClass,
      family: row.family,
      tier: row.tier,
      effects: row.effects,
      observed: permanentSourceIdSet.has(row.sourceId),
    })),
  },
  familyValueTypeEvidence: {
    families: familyValueTypes,
    familiesWithStableSingleValueType,
    distinctStableFamilyValueTypes,
    interpretation: 'Numeric m_eValType IDs are not hard-coded into this artifact. Semantic alignment is tested internally: all three tier records within a static family must share one replay value type, and the six static families must remain distinct.',
  },
  amountEvidence: {
    positivePermanentAccumulationEvents: positivePermanentContributions.length,
    exactPositiveAmountEvents,
    exactPositiveAmountRate: positiveAmountMatchRate,
    inferredPermanentPickupUnits: inferredAcquisitionUnits,
    negativeInPlaceValueDeltas: negativeInPlacePermanentContributions.length,
    rowRemovals: permanentRemovalContributions.length,
    finalRowsWithResolvedUnit: finalRowsWithResolvedUnit.length,
    finalRowsExactUnitMultiple,
    finalUnitMultipleRate,
    interpretation: 'For each resolved record/tier, positive runtime additions or increases are tested against integer multiples of that exact Script136 V02 per-pickup effect. In-place decreases are treated as contradictory evidence; vector row removals are reported separately because end-of-life/vector maintenance can remove rows without proving semantic loss.',
  },
  permanentRecordSummary,
  acquisitionEvents: positivePermanentContributions,
  negativeInPlaceEvents: negativeInPlacePermanentContributions,
  removalEvents: permanentRemovalContributions,
  finalPermanentRows,
  players: playerStates,
  interpretation: {
    supported: validationPass
      ? 'In this replay, m_vecStatViewerModifierValues exposes runtime permanent-pickup accumulation keyed by the Source2 compound EntitySubclassID_t namespace <recordKey>/<modifierClass>. Resolved source rows are family-stable, positive changes match exact static per-tier effect multiples, retained values remain exact unit multiples, and no in-place decreases contradict permanence.'
      : 'The corrected compound subclass namespace is measured directly, but one or more mapping/value-behavior gates require diagnosis before treating stat-viewer rows as permanent-pickup runtime authority.',
    ownershipMeaning: validationPass
      ? 'For a resolved permanent pickup record, row value / static per-pickup effect yields an inferred cumulative pickup count for that tier at that replay time. Positive integral count deltas are candidate acquisition events.'
      : 'Do not convert row values into permanent-pickup counts until failed semantic gates are explained.',
    notYetSupported: 'Single-replay support does not establish cross-replay replication. This script does not establish the physical producer/object that granted each pickup, bridge powerup semantics, exact effective downstream stat composition with items/hero scaling, or a Golden Statue/Lion Statue causal link.',
  },
  validation: { pass: validationPass, checks },
  nextStage: validationPass
    ? 'FREEZE_RULES_AND_REPLICATE_RUNTIME_PERMANENT_PICKUP_SEMANTICS_ACROSS_REP01_REP05'
    : 'DIAGNOSE_ONLY_FAILED_SOURCE_VALUE_TYPE_OR_AMOUNT_GATES_BEFORE_REPLICATION',
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('RUNTIME PERMANENT PICKUP RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                         ${status}`);
console.log(`players:                        ${playerStates.length}`);
console.log(`stat transitions:               ${transitions.length}`);
console.log(`observed source IDs:            ${observedSourceIds.length}`);
console.log(`mapped permanent source IDs:    ${observedPermanentSourceIds.length}`);
console.log(`mapped bridge source IDs:       ${observedBridgeSourceIds.length}`);
console.log(`unresolved observed source IDs: ${unresolvedObservedSourceIds.length}`);
console.log(`permanent candidates observed:  ${permanentCandidatesObserved}/${permanentCandidates.length} (${formatPercent(permanentCandidateCoverage)})`);
console.log(`stable family value types:      ${familiesWithStableSingleValueType}/${familyValueTypes.length}`);
console.log(`distinct family value types:    ${distinctStableFamilyValueTypes}/${familyValueTypes.length}`);
console.log(`positive accumulation events:   ${positivePermanentContributions.length}`);
console.log(`exact amount events:            ${exactPositiveAmountEvents}/${positivePermanentContributions.length} (${formatPercent(positiveAmountMatchRate)})`);
console.log(`inferred pickup units:          ${inferredAcquisitionUnits}`);
console.log(`negative in-place deltas:       ${negativeInPlacePermanentContributions.length}`);
console.log(`row removals*:                  ${permanentRemovalContributions.length}`);
console.log(`final exact unit multiples:     ${finalRowsExactUnitMultiple}/${finalRowsWithResolvedUnit.length} (${formatPercent(finalUnitMultipleRate)})`);
console.log('* diagnostic only; row removal is not automatically semantic loss');
console.log('');
console.log('FAMILY VALUE TYPES');
console.log('------------------');
for (const row of familyValueTypes) {
  console.log(`${String(row.family).padEnd(28)} expected=${String(row.expectedModifierValue).padEnd(44)} observed=${JSON.stringify(row.valueTypes)} stable=${row.stableSingleValueType}`);
}
console.log('');
console.log('SOURCE ID MAP');
console.log('-------------');
for (const row of permanentCandidates.sort((a, b) => a.sourceId - b.sourceId)) {
  console.log(`${String(row.sourceId).padStart(10)}  tier=${String(row.tier).padEnd(2)} ${row.recordKey}`);
}
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(45)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function recordTransition({ state, index, before, after, tick, cause }) {
  transitions.push({
    tick,
    demoSeconds: Number.isFinite(tick) ? tick / TICKS_PER_SECOND : null,
    matchTimeSeconds: Number.isFinite(tick) && Number.isFinite(matchClockOffsetSeconds)
      ? tick / TICKS_PER_SECOND - matchClockOffsetSeconds
      : null,
    cause,
    transitionKind: classifyTransition(before, after),
    controllerEntityIndex: state.entityIndex,
    playerName: state.playerName,
    steamId: state.steamId,
    heroId: state.heroId,
    team: state.team,
    vectorIndex: index,
    before: decorateRow(before, subclassMap),
    after: decorateRow(after, subclassMap),
  });
}

function buildContributions(transition, map) {
  const before = transition.before;
  const after = transition.after;
  const rows = [];

  if (before && after && before.sourceModifierId === after.sourceModifierId) {
    if (Number.isFinite(before.value) && Number.isFinite(after.value) && !nearlyEqual(before.value, after.value)) {
      rows.push(buildContribution({
        transition,
        sourceModifierId: after.sourceModifierId,
        valueType: after.valueType ?? before.valueType ?? null,
        beforeValue: before.value,
        afterValue: after.value,
        delta: after.value - before.value,
        contributionKind: 'IN_PLACE_VALUE_DELTA',
        map,
      }));
    }
    return rows;
  }

  if (before) {
    rows.push(buildContribution({
      transition,
      sourceModifierId: before.sourceModifierId,
      valueType: before.valueType,
      beforeValue: before.value,
      afterValue: null,
      delta: Number.isFinite(before.value) ? -before.value : null,
      contributionKind: 'ROW_REMOVE',
      map,
    }));
  }

  if (after) {
    rows.push(buildContribution({
      transition,
      sourceModifierId: after.sourceModifierId,
      valueType: after.valueType,
      beforeValue: null,
      afterValue: after.value,
      delta: Number.isFinite(after.value) ? after.value : null,
      contributionKind: 'ROW_ADD',
      map,
    }));
  }

  return rows;
}

function buildContribution({
  transition,
  sourceModifierId,
  valueType,
  beforeValue,
  afterValue,
  delta,
  contributionKind,
  map,
}) {
  const resolution = summarizeWorldBuffSubclassResolution(sourceModifierId, map);
  const candidate = soleCandidate(resolution);
  const unit = expectedUnit(candidate);
  const ratio = Number.isFinite(delta) && Number.isFinite(unit) && Math.abs(unit) > EPSILON
    ? delta / unit
    : null;
  const exactPositiveUnitMultiple = Number.isFinite(delta)
    && delta > EPSILON
    && nearlyInteger(ratio)
    && ratio > 0;

  return {
    tick: transition.tick,
    demoSeconds: transition.demoSeconds,
    matchTimeSeconds: transition.matchTimeSeconds,
    controllerEntityIndex: transition.controllerEntityIndex,
    playerName: transition.playerName,
    steamId: transition.steamId,
    heroId: transition.heroId,
    team: transition.team,
    vectorIndex: transition.vectorIndex,
    transitionKind: transition.transitionKind,
    transitionCause: transition.cause,
    contributionKind,
    sourceModifierId,
    valueType,
    beforeValue,
    afterValue,
    delta,
    resolution,
    buffClass: candidate?.buffClass ?? null,
    family: candidate?.family ?? null,
    tier: candidate?.tier ?? null,
    recordKey: candidate?.recordKey ?? null,
    modifierClass: candidate?.modifierClass ?? null,
    sourceToken: candidate?.token ?? null,
    expectedModifierValue: candidate?.effects?.[0]?.modifierValue ?? null,
    expectedUnitValue: unit,
    exactPositiveUnitMultiple,
    inferredUnitCount: exactPositiveUnitMultiple ? Math.round(ratio) : null,
  };
}

function summarizeFamilyValueTypes(allTransitions, map) {
  const byFamily = new Map();

  for (const transition of allTransitions) {
    for (const row of [transition.before, transition.after]) {
      if (!row || !Number.isInteger(row.sourceModifierId)) continue;
      const resolution = summarizeWorldBuffSubclassResolution(row.sourceModifierId, map);
      const candidate = soleCandidate(resolution);
      if (candidate?.buffClass !== 'PERMANENT_PICKUP' || !candidate.family) continue;

      if (!byFamily.has(candidate.family)) {
        byFamily.set(candidate.family, {
          family: candidate.family,
          expectedModifierValues: new Set(),
          valueTypes: new Set(),
          sourceIds: new Set(),
          tiers: new Set(),
          observations: 0,
        });
      }
      const out = byFamily.get(candidate.family);
      out.observations++;
      out.sourceIds.add(row.sourceModifierId);
      if (Number.isInteger(candidate.tier)) out.tiers.add(candidate.tier);
      for (const effect of candidate.effects ?? []) {
        if (effect?.modifierValue) out.expectedModifierValues.add(effect.modifierValue);
      }
      if (Number.isInteger(row.valueType)) out.valueTypes.add(row.valueType);
    }
  }

  return [...byFamily.values()]
    .map(row => ({
      family: row.family,
      expectedModifierValue: row.expectedModifierValues.size === 1 ? [...row.expectedModifierValues][0] : null,
      expectedModifierValues: [...row.expectedModifierValues].sort(),
      valueTypes: [...row.valueTypes].sort((a, b) => a - b),
      stableSingleValueType: row.valueTypes.size === 1,
      sourceIds: [...row.sourceIds].sort((a, b) => a - b),
      tiersObserved: [...row.tiers].sort((a, b) => a - b),
      observations: row.observations,
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

function summarizePermanentRecords({ candidates, transitions: allTransitions, contributions, playerStates: players }) {
  const contributionsBySource = indexRows(contributions, row => String(row.sourceModifierId));
  const transitionRows = [];
  for (const transition of allTransitions) {
    for (const row of [transition.before, transition.after]) {
      if (!row || !Number.isInteger(row.sourceModifierId)) continue;
      transitionRows.push({ sourceModifierId: row.sourceModifierId, valueType: row.valueType });
    }
  }
  const transitionRowsBySource = indexRows(transitionRows, row => String(row.sourceModifierId));

  const finalRows = players.flatMap(player => player.finalRows.map(row => ({
    controllerEntityIndex: player.controllerEntityIndex,
    playerName: player.playerName,
    ...row,
  })));
  const finalRowsBySource = indexRows(finalRows, row => String(row.sourceModifierId));

  return candidates
    .map(candidate => {
      const sourceContributions = contributionsBySource.get(String(candidate.sourceId)) ?? [];
      const sourceTransitionRows = transitionRowsBySource.get(String(candidate.sourceId)) ?? [];
      const sourceFinalRows = finalRowsBySource.get(String(candidate.sourceId)) ?? [];
      const unit = expectedUnit(candidate);
      const positive = sourceContributions.filter(row => Number.isFinite(row.delta) && row.delta > EPSILON);
      const exactPositive = positive.filter(row => row.exactPositiveUnitMultiple);
      const negativeInPlace = sourceContributions.filter(row =>
        row.contributionKind === 'IN_PLACE_VALUE_DELTA'
        && Number.isFinite(row.delta)
        && row.delta < -EPSILON
      );

      return {
        sourceModifierId: candidate.sourceId,
        token: candidate.token,
        family: candidate.family,
        tier: candidate.tier,
        recordKey: candidate.recordKey,
        modifierClass: candidate.modifierClass,
        expectedModifierValue: candidate.effects?.[0]?.modifierValue ?? null,
        expectedUnitValue: unit,
        observed: sourceContributions.length > 0 || sourceFinalRows.length > 0,
        valueTypes: [...new Set(sourceTransitionRows.map(row => row.valueType).filter(Number.isInteger))].sort((a, b) => a - b),
        positiveAccumulationEvents: positive.length,
        exactPositiveAmountEvents: exactPositive.length,
        exactPositiveAmountRate: safeRatio(exactPositive.length, positive.length),
        inferredPickupUnits: positive.reduce(
          (sum, row) => sum + (Number.isInteger(row.inferredUnitCount) ? row.inferredUnitCount : 0),
          0
        ),
        negativeInPlaceValueDeltas: negativeInPlace.length,
        finalPlayersWithRow: sourceFinalRows.length,
        finalValues: sourceFinalRows.map(row => ({
          controllerEntityIndex: row.controllerEntityIndex,
          playerName: row.playerName,
          valueType: row.valueType,
          value: row.value,
          inferredCount: Number.isFinite(row.value) && Number.isFinite(unit) && Math.abs(unit) > EPSILON && nearlyInteger(row.value / unit)
            ? Math.round(row.value / unit)
            : null,
        })),
      };
    })
    .sort((a, b) => a.sourceModifierId - b.sourceModifierId);
}

function expectedUnit(candidate) {
  if (!candidate || candidate.buffClass !== 'PERMANENT_PICKUP') return null;
  const numeric = (candidate.effects ?? []).map(effect => effect?.value).filter(Number.isFinite);
  return numeric.length === 1 ? numeric[0] : null;
}

function soleCandidate(resolution) {
  return resolution?.matched && resolution?.candidates?.length === 1
    ? resolution.candidates[0]
    : null;
}

function decorateRow(row, map) {
  if (!row) return null;
  return {
    ...row,
    resolution: summarizeWorldBuffSubclassResolution(row.sourceModifierId, map),
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

function cloneRow(row) {
  return row ? { ...row } : null;
}

function rowsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.sourceModifierId === b.sourceModifierId
    && a.valueType === b.valueType
    && a.value === b.value;
}

function indexRows(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
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

function nearlyEqual(a, b, epsilon = EPSILON) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}

function nearlyInteger(value, epsilon = EPSILON) {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) <= epsilon;
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
