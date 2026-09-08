import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

import { getClaim, requireClaim } from '../src/contracts/claim-registry.mjs';
import { murmurHash2 } from '../src/source2/murmurhash2.mjs';
import {
  activeBridgeIntervalsAt,
  applyStateEvent,
  buildBridgeIntervals,
  emptyPlayerState,
} from '../src/player-state/runtime-state-timeline.mjs';

const VERSION = 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01';
const TICKS_PER_SECOND = 64;
const BRIDGE_DURATION_SECONDS = 160;
const GAME_STATE_POSTGAME = 8;

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));

const PATHS = {
  catalog: resolve('output', 'cross_replay', 'current_purchasable_item_catalog_v02.json'),
  effects: resolve('output', 'cross_replay', 'standard_shop_item_effect_substrate_v03.json'),
  worldBuffContract: resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json'),
  heroProgressionV01: resolve('output', 'cross_replay', 'hero_stat_progression_schema_discovery_v01.json'),
  heroProgressionV02: resolve('output', 'cross_replay', 'hero_stat_progression_schema_discovery_v02.json'),
  bridgeReplay: resolve('output', replayName, 'bridge_pvs_robust_lifecycle_discovery_v01.json'),
  bridgeAuthority: resolve('output', 'cross_replay', 'bridge_runtime_interval_authority_v01.json'),
  output: resolve('output', replayName, 'integrated_authoritative_player_state_substrate_v01.json'),
};

for (const path of [
  replayPath,
  PATHS.catalog,
  PATHS.effects,
  PATHS.worldBuffContract,
  PATHS.bridgeReplay,
  PATHS.bridgeAuthority,
]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const claims = {
  playerIdentity: requireClaim('player_controller_pawn_identity', { requireSemantic: true }),
  catalog: requireClaim('standard_shop_catalog_v02', { requireSemantic: true }),
  itemEffects: requireClaim('shop_item_effect_contract', { requireSemantic: true }),
  itemOwnership: requireClaim('runtime_item_ownership', { requireSemantic: true, requireReplication: true }),
  permanentOwnership: requireClaim('runtime_permanent_buff_ownership', { requireSemantic: true, requireReplication: true }),
  bridgeOwnership: requireClaim('runtime_bridge_buff_ownership', { requireSemantic: true, requireReplication: true }),
};
const playerStateClaim = getClaim('player_state_t_v1');
const effectiveWeaponClaim = getClaim('effective_weapon_state');

const catalogArtifact = readJson(PATHS.catalog);
const effectsArtifact = readJson(PATHS.effects);
const worldBuffContract = readJson(PATHS.worldBuffContract);
const bridgeReplayArtifact = readJson(PATHS.bridgeReplay);
const bridgeAuthorityArtifact = readJson(PATHS.bridgeAuthority);
const heroV01 = readJsonIfExists(PATHS.heroProgressionV01);
const heroV02 = readJsonIfExists(PATHS.heroProgressionV02);

if (catalogArtifact?.status !== 'CURRENT_PURCHASABLE_ITEM_CATALOG_V02_STANDARD_SHOP_RESOURCE_READY') {
  throw new Error(`Script138 catalog not ready: ${catalogArtifact?.status}`);
}
if (effectsArtifact?.status !== 'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY') {
  throw new Error(`Script139 effect substrate not ready: ${effectsArtifact?.status}`);
}
if (worldBuffContract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 world-buff contract not ready: ${worldBuffContract?.status}`);
}
if (bridgeReplayArtifact?.status !== 'BRIDGE_PVS_ROBUST_LIFECYCLE_V01_READY_FOR_INTERPRETATION') {
  throw new Error(`Script149 replay artifact not ready: ${bridgeReplayArtifact?.status}`);
}
if (bridgeAuthorityArtifact?.status !== 'BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01_READY') {
  throw new Error(`Script157 bridge authority not ready: ${bridgeAuthorityArtifact?.status}`);
}

const catalogRows = Array.isArray(catalogArtifact.catalog) ? catalogArtifact.catalog : [];
const catalogById = new Map(catalogRows.map(row => [murmurHash2(row.recordKey), { ...row, itemId: murmurHash2(row.recordKey) }]));
const effectsByKey = new Map((effectsArtifact.items ?? []).map(row => [row.recordKey, row]));
const permanentSourceById = buildPermanentCompoundSourceIndex(worldBuffContract);

const bridgeCollections = (bridgeReplayArtifact.activeDownEvents ?? [])
  .filter(row => Number.isFinite(row?.tick))
  .filter(row => Number.isFinite(row?.trueNearestDistanceHU) && row.trueNearestDistanceHU <= 300)
  .filter(row => row?.trueNearest?.playerName && row?.recordKey)
  .map((row, index) => ({
    intervalId: `${replayName}-bridge-${index + 1}`,
    tick: row.tick,
    playerName: row.trueNearest.playerName,
    buffType: row.recordKey,
    recordKey: row.recordKey,
    spawnerIndex: row.spawnerIndex ?? null,
    collectionDistanceHU: row.trueNearestDistanceHU,
    source: 'SCRIPT149_VALIDATED_COLLECTION_NEAREST_PLAYER',
  }));

console.log('');
console.log('========================================================');
console.log('INTEGRATED AUTHORITATIVE PLAYER-STATE SUBSTRATE V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayPath}`);
console.log('Runtime layers:                 observed controller state + shop ownership + permanent buffs + bridge intervals');
console.log('Resource layers:                hero progression + item effects + world-buff definitions (inputs only)');
console.log('Effective-stat policy:          NOT COMPOSED in Script158');
console.log('Timeline policy:                event-sourced deltas at authoritative state boundaries');
console.log('');

const parser = new Parser(
  new ParserConfiguration({
    entityClasses: ['CCitadelPlayerController', 'CCitadelGameRulesProxy'],
  }),
  Logger.CONSOLE_INFO
);

const controllers = new Map();
const playerEvents = new Map();
const deathEvents = [];
let replayEndTick = null;
let postGameTick = null;
let matchClockOffsetSeconds = null;
let controllerMutationEvents = 0;
let relevantRuntimeEvents = 0;
let itemTransitions = 0;
let permanentTransitions = 0;
let unknownObservedItemIds = 0;
const observedOwnedRecordKeys = new Set();
const observedHeroIds = new Set();
const observedPermanentFamilies = new Set();

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
    if (Number.isFinite(tick)) replayEndTick = tick;

    for (const event of events) {
      if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) continue;
      const entity = event.entity;
      const className = entity?.class?.name;

      if (className === 'CCitadelGameRulesProxy') {
        updateGameRules(entity, event, tick);
        continue;
      }
      if (className !== 'CCitadelPlayerController') continue;
      controllerMutationEvents++;
      processController(entity, event, tick);
    }
  }
);

console.log('[parse] assembling authoritative runtime layers...');
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

const bridgeIntervals = buildBridgeIntervals({
  collections: bridgeCollections,
  deaths: deathEvents,
  postGameTick,
  replayEndTick,
  durationSeconds: BRIDGE_DURATION_SECONDS,
  ticksPerSecond: TICKS_PER_SECOND,
});

for (const interval of bridgeIntervals) {
  addBridgeBoundaryEvent(interval.playerName, interval.startTick, 'BRIDGE_ACQUISITION');
  addBridgeBoundaryEvent(interval.playerName, interval.stateEndTick, interval.terminationReason);
}

const players = [];
for (const state of [...controllers.values()].filter(row => row.playerName && row.playerName !== 'SourceTV')) {
  const events = mergeEventsByTick(playerEvents.get(state.playerName) ?? [])
    .sort((a, b) => a.tick - b.tick)
    .map(event => ({
      ...event,
      activeBridgeBuffs: activeBridgeIntervalsAt(bridgeIntervals, state.playerName, event.tick).map(compactBridgeInterval),
    }));

  let current = emptyPlayerState(state.playerName);
  for (const event of events) current = applyStateEvent(current, event);

  players.push({
    playerKey: state.playerName,
    identity: {
      playerName: state.playerName,
      steamId: state.steamId,
      controllerEntityIndex: state.entityIndex,
      heroId: state.heroId,
      team: state.team,
    },
    heroResourceProfileRef: Number.isInteger(state.heroId) ? `hero:${state.heroId}` : null,
    eventCount: events.length,
    events,
    finalState: current,
  });
}
players.sort((a, b) => a.playerKey.localeCompare(b.playerKey));

const selectedItemEffectInputs = [...observedOwnedRecordKeys]
  .sort()
  .map(recordKey => compactItemEffectInput(effectsByKey.get(recordKey)))
  .filter(Boolean);

const heroResourceProfiles = [...observedHeroIds]
  .sort((a, b) => a - b)
  .map(heroId => buildHeroResourceProfile(heroId, heroV01, heroV02));

const terminationCounts = frequency(bridgeIntervals.map(row => row.terminationReason));
const totalTimelineEvents = players.reduce((sum, row) => sum + row.eventCount, 0);
const checks = {
  playerIdentityAuthorityCurrent: check(claims.playerIdentity.authorityStatus, 'current', claims.playerIdentity.authorityStatus === 'current'),
  itemOwnershipAuthorityCurrentReplicated: check(claims.itemOwnership.replicationStatus, 'cross_replay_replicated', claims.itemOwnership.authorityStatus === 'current' && claims.itemOwnership.replicationStatus === 'cross_replay_replicated'),
  permanentOwnershipAuthorityCurrentReplicated: check(claims.permanentOwnership.replicationStatus, 'cross_replay_replicated', claims.permanentOwnership.authorityStatus === 'current' && claims.permanentOwnership.replicationStatus === 'cross_replay_replicated'),
  bridgeOwnershipAuthorityCurrentReplicated: check(claims.bridgeOwnership.replicationStatus, 'cross_replay_replicated', claims.bridgeOwnership.authorityStatus === 'current' && claims.bridgeOwnership.replicationStatus === 'cross_replay_replicated'),
  bridgeAuthorityArtifactReady: check(bridgeAuthorityArtifact.status, 'BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01_READY', bridgeAuthorityArtifact.status === 'BRIDGE_RUNTIME_INTERVAL_AUTHORITY_V01_READY'),
  playerStateClaimStillMissing: check(playerStateClaim?.authorityStatus, 'missing', playerStateClaim?.authorityStatus === 'missing'),
  effectiveWeaponClaimStillMissing: check(effectiveWeaponClaim?.authorityStatus, 'missing', effectiveWeaponClaim?.authorityStatus === 'missing'),
  playerControllersObserved: check(players.length, '>=10', players.length >= 10),
  timelineEventsObserved: check(totalTimelineEvents, '>0', totalTimelineEvents > 0),
  shopTransitionsObserved: check(itemTransitions, '>0', itemTransitions > 0),
  allObservedShopIdsMapCurrentCatalog: check(unknownObservedItemIds, 0, unknownObservedItemIds === 0),
  permanentTransitionsObserved: check(permanentTransitions, '>0', permanentTransitions > 0),
  permanentFamiliesObserved: check(observedPermanentFamilies.size, 6, observedPermanentFamilies.size === 6),
  bridgeCollectionsIntegrated: check(bridgeIntervals.length, bridgeCollections.length, bridgeIntervals.length === bridgeCollections.length && bridgeIntervals.length > 0),
};
const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION'
  : 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: {
    replayName,
    replayPath,
    ticksPerSecond: TICKS_PER_SECOND,
    replayEndTick,
    postGameTick,
    matchClockOffsetSeconds,
  },
  authorityFoundations: {
    playerIdentity: summarizeClaim(claims.playerIdentity),
    standardShopCatalog: summarizeClaim(claims.catalog),
    shopItemEffects: summarizeClaim(claims.itemEffects),
    runtimeItemOwnership: summarizeClaim(claims.itemOwnership),
    runtimePermanentBuffOwnership: summarizeClaim(claims.permanentOwnership),
    runtimeBridgeBuffOwnership: summarizeClaim(claims.bridgeOwnership),
  },
  stateModel: {
    playerKeyWithinReplay: 'm_iszPlayerName, with steamId retained as identity metadata',
    observedRuntime:
      'Direct networked CCitadelPlayerController / PlayerDataGlobal_t fields. No resource formula is substituted for these observed values.',
    authoritativeOwnership:
      'Standard-shop m_vecUpgrades set membership + permanent m_vecStatViewerModifierValues accumulation + reconstructed bridge intervals under current claims.',
    bridgeInterval:
      'start=validated Script149 collection; natural duration=160s; death terminates early; PostGame/replay end censor the interval for gameplay-state use.',
    resourceEffectInputs:
      'Hero progression, item effects, and world-buff definitions are attached as resource metadata. They are NOT automatically applied to observed runtime fields in V01.',
    effectiveComposition:
      'UNRESOLVED. Conditional/passive/active item semantics, exact hero progression application order, and bridge 5→40 minute effect interpolation remain outside this substrate.',
  },
  counts: {
    controllerMutationEvents,
    players: players.length,
    relevantRuntimeEvents,
    timelineEvents: totalTimelineEvents,
    itemTransitions,
    permanentTransitions,
    permanentFamiliesObserved: observedPermanentFamilies.size,
    bridgeCollections: bridgeCollections.length,
    bridgeIntervals: bridgeIntervals.length,
    bridgeTerminationReasons: terminationCounts,
    selectedItemEffectInputs: selectedItemEffectInputs.length,
    heroResourceProfiles: heroResourceProfiles.length,
  },
  bridgeIntervals: bridgeIntervals.map(compactBridgeInterval),
  resourceEffectInputs: {
    policy: 'REFERENCE/INPUT_ONLY_NOT_EFFECTIVE_STATE',
    standardShopItems: selectedItemEffectInputs,
    heroProfiles: heroResourceProfiles,
    permanentWorldBuffFamilies: worldBuffContract?.permanentPickups?.families ?? [],
    bridgePowerups: worldBuffContract?.bridgePowerups?.powerups ?? [],
  },
  players,
  interpretation: {
    supported:
      'This artifact integrates currently authoritative runtime ownership layers and directly observed player fields into one event-sourced per-player state stream. A consumer can reconstruct state at arbitrary ticks without consulting Scripts140/145/149 independently.',
    notYetSupported:
      'The artifact is not yet a promoted PlayerState(t) authority and does not calculate unrestricted effective stats or effective weapon state. Resource effect inputs remain provenance-bearing inputs until composition semantics are validated.',
    next:
      'Validate the integrated event stream against directly observed state invariants across independent replays, then build effective weapon composition as a constrained derived layer.',
  },
  integrityValidation: checks,
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('INTEGRATED PLAYER-STATE SUBSTRATE RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                         ${status}`);
console.log(`players:                        ${players.length}`);
console.log(`timeline events:                ${totalTimelineEvents}`);
console.log(`shop ownership transitions:     ${itemTransitions}`);
console.log(`permanent-buff transitions:     ${permanentTransitions}`);
console.log(`permanent families observed:    ${observedPermanentFamilies.size}/6`);
console.log(`bridge intervals:               ${bridgeIntervals.length}`);
console.log(`bridge termination reasons:     ${JSON.stringify(terminationCounts)}`);
console.log(`owned item effect refs:         ${selectedItemEffectInputs.length}`);
console.log(`hero resource profiles:         ${heroResourceProfiles.length}`);
console.log('');
console.log('INTEGRITY VALIDATION');
console.log('--------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(47)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');

function processController(entity, event, tick) {
  if (!Number.isFinite(tick)) return;
  const state = getControllerState(entity.index);
  const changes = safeChanges(event);
  refreshIdentity(state, entity);
  if (!state.playerName || state.playerName === 'SourceTV') return;
  if (Number.isInteger(state.heroId)) observedHeroIds.add(state.heroId);

  const delta = {
    tick,
    playerKey: state.playerName,
    eventType: event.operation === EntityOperation.CREATE ? 'CONTROLLER_CREATE_STATE' : 'CONTROLLER_UPDATE_STATE',
    causes: [],
  };

  const identityPatch = {};
  for (const [field, key] of Object.entries({
    m_iszPlayerName: 'playerName',
    m_steamID: 'steamId',
    m_nHeroID: 'heroId',
    m_iTeamNum: 'team',
  })) {
    if (event.operation === EntityOperation.CREATE || Object.prototype.hasOwnProperty.call(changes, field)) {
      identityPatch[key] = safeValue(entity.getField(field));
    }
  }
  if (Object.keys(identityPatch).length > 0) {
    delta.identity = identityPatch;
    delta.causes.push('IDENTITY_OR_HERO_STATE');
  }

  const rawPatch = {};
  const rawFields = {
    m_iLevel: 'level',
    m_bAlive: 'alive',
    m_iHealth: 'health',
    m_iHealthMax: 'healthMax',
    m_flHealthRegen: 'healthRegen',
    m_iMaxAmmo: 'maxAmmo',
    m_iGoldNetWorth: 'goldNetWorth',
    m_iAPNetWorth: 'apNetWorth',
    m_flRespawnTime: 'respawnTime',
  };
  for (const [field, key] of Object.entries(rawFields)) {
    if (event.operation === EntityOperation.CREATE || Object.prototype.hasOwnProperty.call(changes, field)) {
      const value = safeValue(entity.getField(field));
      rawPatch[key] = value;
      if (key === 'alive' && state.lastAlive === true && value === false) {
        deathEvents.push({ tick, playerName: state.playerName });
      }
      if (key === 'alive' && typeof value === 'boolean') state.lastAlive = value;
    }
  }
  if (Object.keys(rawPatch).length > 0) {
    delta.observedRuntime = rawPatch;
    delta.causes.push('OBSERVED_RUNTIME_FIELD');
  }

  const beforeItems = currentItemSet(state);
  const vectorTouched = event.operation === EntityOperation.CREATE
    || Object.keys(changes).some(field => field === 'm_vecUpgrades' || /^m_vecUpgrades\.\d{4}$/.test(field));
  if (Object.prototype.hasOwnProperty.call(changes, 'm_vecUpgrades')) {
    const len = normalizeVectorLength(changes.m_vecUpgrades);
    if (len !== null) {
      state.itemLength = len;
      for (const slot of [...state.itemSlots.keys()]) if (slot >= len) state.itemSlots.delete(slot);
    }
  }
  for (const [field, raw] of Object.entries(changes)) {
    const match = /^m_vecUpgrades\.(\d{4})$/.exec(field);
    if (!match) continue;
    const slot = Number.parseInt(match[1], 10);
    const itemId = normalizeUnsigned(raw);
    if (!itemId) state.itemSlots.delete(slot);
    else state.itemSlots.set(slot, itemId);
  }
  if (vectorTouched) {
    const afterItems = currentItemSet(state);
    const added = difference(afterItems, beforeItems).map(resolveItem);
    const removed = difference(beforeItems, afterItems).map(resolveItem);
    if (added.length || removed.length) {
      delta.itemAdds = added;
      delta.itemRemoves = removed;
      delta.causes.push('STANDARD_SHOP_OWNERSHIP');
      itemTransitions += added.length + removed.length;
      for (const row of [...added, ...removed]) {
        if (row.mapped) observedOwnedRecordKeys.add(row.recordKey);
        else unknownObservedItemIds++;
      }
    }
  }

  const statTouchedIndexes = new Set();
  if (Object.prototype.hasOwnProperty.call(changes, 'm_vecStatViewerModifierValues')) {
    const len = normalizeVectorLength(changes.m_vecStatViewerModifierValues);
    if (len !== null) {
      state.statLength = len;
      for (const index of [...state.statRows.keys()]) if (index >= len) state.statRows.delete(index);
    }
  }
  for (const field of Object.keys(changes)) {
    const match = /^m_vecStatViewerModifierValues\.(\d{4})\.(m_flValue|m_SourceModifierID|m_eValType)$/.exec(field);
    if (match) statTouchedIndexes.add(Number.parseInt(match[1], 10));
  }
  if (event.operation === EntityOperation.CREATE && statTouchedIndexes.size === 0) {
    for (const field of Object.keys(changes)) {
      const match = /^m_vecStatViewerModifierValues\.(\d{4})\./.exec(field);
      if (match) statTouchedIndexes.add(Number.parseInt(match[1], 10));
    }
  }

  if (statTouchedIndexes.size > 0 || Object.prototype.hasOwnProperty.call(changes, 'm_vecStatViewerModifierValues')) {
    for (const index of statTouchedIndexes) {
      const prefix = `m_vecStatViewerModifierValues.${String(index).padStart(4, '0')}`;
      const sourceId = normalizeUnsigned(entity.getField(`${prefix}.m_SourceModifierID`));
      const valueType = normalizeInteger(entity.getField(`${prefix}.m_eValType`));
      const value = normalizeNumber(entity.getField(`${prefix}.m_flValue`));
      if (sourceId === null || value === null) state.statRows.delete(index);
      else state.statRows.set(index, { sourceId, valueType, value });
    }
    const permanentState = aggregatePermanentState(state.statRows);
    const signature = JSON.stringify(permanentState);
    if (signature !== state.lastPermanentSignature) {
      state.lastPermanentSignature = signature;
      delta.permanentBuffState = permanentState;
      delta.causes.push('PERMANENT_WORLD_BUFF_STATE');
      permanentTransitions++;
      for (const family of Object.keys(permanentState)) observedPermanentFamilies.add(family);
    }
  }

  if (delta.causes.length > 0) {
    relevantRuntimeEvents++;
    addPlayerEvent(state.playerName, delta);
  }
}

function updateGameRules(entity, event, tick) {
  if (!Number.isFinite(tick)) return;
  const gameStart = entity.getField('m_pGameRules.m_flGameStartTime');
  const stateStart = entity.getField('m_pGameRules.m_flGameStateStartTime');
  if (!Number.isFinite(matchClockOffsetSeconds) && Number.isFinite(gameStart) && Number.isFinite(stateStart)) {
    matchClockOffsetSeconds = gameStart - stateStart;
  }
  const changes = safeChanges(event);
  const stateField = 'm_pGameRules.m_eGameState';
  if (Object.prototype.hasOwnProperty.call(changes, stateField)) {
    const gameState = normalizeInteger(entity.getField(stateField));
    if (gameState === GAME_STATE_POSTGAME && !Number.isFinite(postGameTick)) postGameTick = tick;
  }
}

function getControllerState(entityIndex) {
  if (!controllers.has(entityIndex)) {
    controllers.set(entityIndex, {
      entityIndex,
      playerName: null,
      steamId: null,
      heroId: null,
      team: null,
      lastAlive: null,
      itemLength: null,
      itemSlots: new Map(),
      statLength: null,
      statRows: new Map(),
      lastPermanentSignature: null,
    });
  }
  return controllers.get(entityIndex);
}

function refreshIdentity(state, entity) {
  const playerName = entity.getField('m_iszPlayerName');
  if (playerName !== null && playerName !== undefined) state.playerName = String(playerName);
  const steamId = entity.getField('m_steamID');
  if (steamId !== null && steamId !== undefined) state.steamId = safeValue(steamId);
  const heroId = normalizeInteger(entity.getField('m_nHeroID'));
  if (heroId !== null) state.heroId = heroId;
  const team = normalizeInteger(entity.getField('m_iTeamNum'));
  if (team !== null) state.team = team;
}

function buildPermanentCompoundSourceIndex(contract) {
  const map = new Map();
  for (const family of contract?.permanentPickups?.families ?? []) {
    for (const tier of family?.tiers ?? []) {
      if (!tier?.found || !tier.recordKey || !tier.modifierClass) continue;
      const sourceId = murmurHash2(`${tier.recordKey}/${tier.modifierClass}`);
      const unitValue = firstFiniteEffectValue(tier.effects);
      map.set(sourceId, {
        sourceId,
        family: family.family,
        tier: tier.tier ?? null,
        recordKey: tier.recordKey,
        modifierClass: tier.modifierClass,
        unitValue,
      });
    }
  }
  return map;
}

function aggregatePermanentState(statRows) {
  const out = {};
  for (const [rowIndex, row] of statRows.entries()) {
    const source = permanentSourceById.get(row.sourceId);
    if (!source) continue;
    const family = source.family;
    if (!out[family]) out[family] = { totalValue: 0, inferredUnits: 0, rows: [] };
    const inferredUnits = Number.isFinite(source.unitValue) && source.unitValue !== 0
      ? row.value / source.unitValue
      : null;
    out[family].totalValue += row.value;
    if (Number.isFinite(inferredUnits)) out[family].inferredUnits += inferredUnits;
    out[family].rows.push({
      rowIndex,
      sourceModifierId: row.sourceId,
      valueType: row.valueType,
      value: row.value,
      tier: source.tier,
      recordKey: source.recordKey,
      unitValue: source.unitValue,
      inferredUnits,
    });
  }
  for (const value of Object.values(out)) {
    value.totalValue = round(value.totalValue, 6);
    value.inferredUnits = round(value.inferredUnits, 6);
    value.rows.sort((a, b) => a.rowIndex - b.rowIndex);
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])));
}

function addBridgeBoundaryEvent(playerName, tick, cause) {
  if (!playerName || !Number.isFinite(tick)) return;
  addPlayerEvent(playerName, {
    tick,
    playerKey: playerName,
    eventType: 'BRIDGE_INTERVAL_BOUNDARY',
    causes: [cause, 'BRIDGE_RUNTIME_INTERVAL'],
  });
}

function addPlayerEvent(playerName, event) {
  if (!playerEvents.has(playerName)) playerEvents.set(playerName, []);
  playerEvents.get(playerName).push(event);
}

function mergeEventsByTick(events) {
  const byTick = new Map();
  for (const event of events) {
    if (!Number.isFinite(event?.tick)) continue;
    if (!byTick.has(event.tick)) {
      byTick.set(event.tick, {
        tick: event.tick,
        playerKey: event.playerKey,
        eventType: 'INTEGRATED_STATE_BOUNDARY',
        causes: [],
        itemAdds: [],
        itemRemoves: [],
      });
    }
    const row = byTick.get(event.tick);
    row.causes.push(...(event.causes ?? []));
    if (event.identity) row.identity = { ...(row.identity ?? {}), ...event.identity };
    if (event.observedRuntime) row.observedRuntime = { ...(row.observedRuntime ?? {}), ...event.observedRuntime };
    if (event.permanentBuffState) row.permanentBuffState = event.permanentBuffState;
    row.itemAdds.push(...(event.itemAdds ?? []));
    row.itemRemoves.push(...(event.itemRemoves ?? []));
  }
  return [...byTick.values()].map(row => ({
    ...row,
    causes: [...new Set(row.causes)].sort(),
    itemAdds: dedupeItems(row.itemAdds),
    itemRemoves: dedupeItems(row.itemRemoves),
  }));
}

function currentItemSet(state) {
  return new Set([...state.itemSlots.values()].filter(Number.isInteger));
}

function difference(left, right) {
  return [...left].filter(value => !right.has(value)).sort((a, b) => a - b);
}

function resolveItem(itemId) {
  const row = catalogById.get(itemId);
  if (!row) {
    return { itemId, mapped: false, recordKey: null, itemSlot: null, itemTier: null, shopPrice: null, effectInputRef: null };
  }
  return {
    itemId,
    mapped: true,
    recordKey: row.recordKey,
    itemSlot: row.itemSlot ?? null,
    itemTier: row.itemTier ?? null,
    shopPrice: row.shopPrice ?? row.standardShopPrice ?? null,
    effectInputRef: `item-effect:${row.recordKey}`,
  };
}

function compactItemEffectInput(row) {
  if (!row?.recordKey) return null;
  return {
    ref: `item-effect:${row.recordKey}`,
    recordKey: row.recordKey,
    slot: row.slot ?? null,
    tier: row.tier ?? null,
    shopPrice: row.shopPrice ?? null,
    meaningfulDirectProvidedStats: row.meaningfulDirectProvidedStats ?? [],
    nonDirectModifierTokens: row.nonDirectModifierTokens ?? [],
    weaponStateRelevant: row.weaponStateRelevant ?? null,
    interpretation: row.interpretation ?? null,
  };
}

function buildHeroResourceProfile(heroId, v01, v02) {
  const rowV01 = findHeroRow(v01, heroId);
  const rowV02 = findHeroRow(v02, heroId);
  return {
    ref: `hero:${heroId}`,
    heroId,
    v01Status: v01?.status ?? null,
    v02Status: v02?.status ?? null,
    progressionSchemaV01: rowV01,
    categoryGoldThresholdSchemaV02: rowV02,
    interpretation: 'RESOURCE_METADATA_ONLY_NOT_EFFECTIVE_RUNTIME_STAT_COMPOSITION',
  };
}

function findHeroRow(artifact, heroId) {
  for (const key of ['heroes', 'selectableHeroes', 'heroRows']) {
    const rows = artifact?.[key];
    if (!Array.isArray(rows)) continue;
    const found = rows.find(row => normalizeInteger(row?.heroId ?? row?.id ?? row?.m_nHeroID) === heroId);
    if (found) return found;
  }
  return null;
}

function compactBridgeInterval(row) {
  return {
    intervalId: row.intervalId,
    playerName: row.playerName,
    buffType: row.buffType,
    recordKey: row.recordKey,
    startTick: row.startTick,
    nominalEndTick: row.nominalEndTick,
    stateEndTick: row.stateEndTick,
    terminationReason: row.terminationReason,
    terminationObserved: row.terminationObserved,
    collectionDistanceHU: row.collectionDistanceHU,
    spawnerIndex: row.spawnerIndex,
  };
}

function firstFiniteEffectValue(effects) {
  for (const row of effects ?? []) {
    const value = normalizeNumber(row?.value ?? row?.numericValue ?? row?.amount);
    if (value !== null) return value;
  }
  return null;
}

function dedupeItems(rows) {
  const map = new Map();
  for (const row of rows ?? []) if (row?.itemId !== undefined) map.set(row.itemId, row);
  return [...map.values()].sort((a, b) => String(a.recordKey ?? '').localeCompare(String(b.recordKey ?? '')) || a.itemId - b.itemId);
}

function normalizeVectorLength(value) {
  const n = normalizeInteger(value);
  return n !== null && n >= 0 && n <= 1024 ? n : null;
}

function normalizeUnsigned(value) {
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
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function safeChanges(event) {
  try { return event.getChanges() ?? {}; } catch { return {}; }
}

function safeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  try { return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)); }
  catch { return String(value); }
}

function summarizeClaim(claim) {
  return {
    claimId: claim.claimId,
    authorityStatus: claim.authorityStatus,
    integrityValidation: claim.integrityValidation,
    semanticValidation: claim.semanticValidation,
    replicationStatus: claim.replicationStatus,
  };
}

function frequency(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonIfExists(path) {
  return existsSync(path) ? readJson(path) : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
