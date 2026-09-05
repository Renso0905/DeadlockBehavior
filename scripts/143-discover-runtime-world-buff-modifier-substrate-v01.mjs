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
  buildWorldBuffRuntimeSourceMap,
  summarizeWorldBuffSourceResolution,
} from '../src/resources/world-buff-runtime-source-map.mjs';

const VERSION = 'RUNTIME_WORLD_BUFF_MODIFIER_SUBSTRATE_V01';
const TICKS_PER_SECOND = 64;

// ============================================================
// PURPOSE
//
// Script136 V02 froze the installed-build resource definitions for:
//   - 18 permanent pickup records (6 stat families x 3 tiers)
//   - 4 temporary bridge powerups
//
// Scripts140-142 established the pattern for bridging resource IDs to
// replay runtime state without guessing semantics.
//
// Script143 asks a deliberately narrower discovery question:
//
//   Does CCitadelPlayerController.m_vecStatViewerModifierValues expose
//   Source2 source-modifier IDs that map to the known permanent/bridge
//   world-buff resource records or modifier classes?
//
// We preserve m_eValType and m_flValue exactly as replay evidence, but
// DO NOT yet claim that a matched row is a validated pickup acquisition,
// stack count, bridge start time, bridge expiration, or effective stat.
// Those require temporal/amount controls in later scripts.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));

const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');
const OUTPUT_PATH = resolve('output', replayName, 'runtime_world_buff_modifier_substrate_v01.json');

if (!existsSync(replayPath)) throw new Error(`Replay not found:\n${replayPath}`);
if (!existsSync(CONTRACT_PATH)) throw new Error(`Script136 V02 contract missing:\n${CONTRACT_PATH}`);

const permanentClaim = requireClaim('permanent_world_buff_resource_contract', { requireSemantic: true });
const bridgeClaim = requireClaim('bridge_powerup_resource_contract', { requireSemantic: true });
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));

if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 V02 world-buff contract is not ready. status=${contract?.status}`);
}

const sourceMap = buildWorldBuffRuntimeSourceMap(contract);
const expectedPermanentIncrements = buildExpectedPermanentIncrements(contract);

console.log('');
console.log('========================================================');
console.log('RUNTIME WORLD-BUFF MODIFIER SUBSTRATE V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:          ${replayPath}`);
console.log(`Resource contract:${CONTRACT_PATH}`);
console.log(`Source candidates:${sourceMap.candidates.length}`);
console.log(`Hash collisions: ${sourceMap.collisions.length}`);
console.log('Replay field:     CCitadelPlayerController.m_vecStatViewerModifierValues');
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
let validRowSnapshots = 0;
let matchedRowSnapshots = 0;
let matchedPermanentSnapshots = 0;
let matchedBridgeSnapshots = 0;

const controllers = new Map();
const sourceIdCounts = new Map();
const valueTypeCounts = new Map();
const matchedSourceIdCounts = new Map();
const transitions = [];
const matchedTransitions = [];
const positivePermanentDeltas = [];

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

      const touchedIndexes = new Set();

      if (Object.prototype.hasOwnProperty.call(changes, 'm_vecStatViewerModifierValues')) {
        statViewerRootMutations++;
        const length = normalizeLength(changes.m_vecStatViewerModifierValues);
        if (length !== null) {
          state.declaredLength = length;
          for (const index of [...state.rows.keys()]) {
            if (index >= length) {
              const before = state.rows.get(index);
              state.rows.delete(index);
              recordTransition({ state, index, before, after: null, tick, cause: 'VECTOR_TRIM' });
            }
          }
        }
      }

      for (const fieldName of Object.keys(changes)) {
        const match = /^m_vecStatViewerModifierValues\.(\d{4})\.(m_flValue|m_SourceModifierID|m_eValType)$/.exec(fieldName);
        if (!match) continue;
        statViewerChildMutations++;
        touchedIndexes.add(Number.parseInt(match[1], 10));
      }

      for (const index of touchedIndexes) {
        const before = cloneRow(state.rows.get(index) ?? null);
        const after = readStatViewerRow(entity, index, tick);

        if (after && after.sourceModifierId !== null) {
          state.rows.set(index, after);
          validRowSnapshots++;
          increment(sourceIdCounts, after.sourceModifierId);
          if (after.valueType !== null) increment(valueTypeCounts, after.valueType);

          const resolution = summarizeWorldBuffSourceResolution(after.sourceModifierId, sourceMap);
          if (resolution.matched) {
            matchedRowSnapshots++;
            increment(matchedSourceIdCounts, after.sourceModifierId);
            if (resolution.buffClasses.includes('PERMANENT_PICKUP')) matchedPermanentSnapshots++;
            if (resolution.buffClasses.includes('BRIDGE_POWERUP')) matchedBridgeSnapshots++;
          }
        } else {
          state.rows.delete(index);
        }

        if (!rowsEqual(before, after)) {
          recordTransition({ state, index, before, after, tick, cause: 'ROW_MUTATION' });
        }
      }
    }
  }
);

console.log('[parse] starting replay scan...');
await parser.parse(createReadStream(replayPath));
await parser.dispose();

const playerStates = [...controllers.entries()]
  .filter(([, state]) => state.playerName && state.playerName !== 'SourceTV')
  .map(([entityIndex, state]) => ({
    controllerEntityIndex: entityIndex,
    playerName: state.playerName,
    steamId: state.steamId,
    heroId: state.heroId,
    team: state.team,
    finalRows: [...state.rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, row]) => ({ index, ...decorateRow(row) })),
  }));

const distinctSourceIds = [...sourceIdCounts.keys()].sort((a, b) => a - b);
const matchedDistinctSourceIds = [...matchedSourceIdCounts.keys()].sort((a, b) => a - b);
const permanentMatchedTransitions = matchedTransitions.filter(row => row.resolution?.buffClasses?.includes('PERMANENT_PICKUP'));
const bridgeMatchedTransitions = matchedTransitions.filter(row => row.resolution?.buffClasses?.includes('BRIDGE_POWERUP'));
const permanentValueTypes = [...new Set(
  permanentMatchedTransitions
    .map(row => row.after?.valueType ?? row.before?.valueType ?? null)
    .filter(Number.isInteger)
)].sort((a, b) => a - b);
const bridgeValueTypes = [...new Set(
  bridgeMatchedTransitions
    .map(row => row.after?.valueType ?? row.before?.valueType ?? null)
    .filter(Number.isInteger)
)].sort((a, b) => a - b);

const exactAllowedPermanentPositiveDeltas = positivePermanentDeltas.filter(row => row.matchesAnyExpectedIncrement).length;
const permanentDeltaMatchRate = safeRatio(exactAllowedPermanentPositiveDeltas, positivePermanentDeltas.length);

const checks = {
  registryPermanentResourceContractCurrent: check(permanentClaim.authorityStatus, 'current', permanentClaim.authorityStatus === 'current'),
  registryBridgeResourceContractCurrent: check(bridgeClaim.authorityStatus, 'current', bridgeClaim.authorityStatus === 'current'),
  script136ContractReady: check(contract.status, 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY', contract.status === 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'),
  candidateHashCollisionsAbsent: check(sourceMap.collisions.length, 0, sourceMap.collisions.length === 0),
  playerControllersObserved: check(playerStates.length, '>=10', playerStates.length >= 10),
  statViewerChildMutationsObserved: check(statViewerChildMutations, '>0', statViewerChildMutations > 0),
  sourceModifierIdsObserved: check(distinctSourceIds.length, '>0', distinctSourceIds.length > 0),
  worldBuffCandidateSourceMatchObserved: check(matchedDistinctSourceIds.length, '>0', matchedDistinctSourceIds.length > 0),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'RUNTIME_WORLD_BUFF_MODIFIER_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION'
  : 'RUNTIME_WORLD_BUFF_MODIFIER_SUBSTRATE_V01_REQUIRES_DIAGNOSIS';

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
    bridgePowerupClaim: bridgeClaim.claimId,
    resourceContractArtifact: CONTRACT_PATH,
  },
  runtimeField: {
    entityClass: 'CCitadelPlayerController',
    vector: 'm_vecStatViewerModifierValues',
    rowFields: ['m_SourceModifierID', 'm_eValType', 'm_flValue'],
    interpretation: 'DISCOVERY_SUBSTRATE_ONLY',
  },
  sourceTokenResolution: {
    method: 'MURMURHASH2_UTF8_SOURCE2_STRING_TOKEN',
    seedHex: '0x31415926',
    candidates: sourceMap.candidates,
    collisions: sourceMap.collisions,
  },
  counts: {
    controllerMutationEvents,
    playerControllers: playerStates.length,
    statViewerRootMutations,
    statViewerChildMutations,
    validRowSnapshots,
    distinctSourceModifierIds: distinctSourceIds.length,
    matchedDistinctWorldBuffSourceIds: matchedDistinctSourceIds.length,
    matchedRowSnapshots,
    matchedPermanentSnapshots,
    matchedBridgeSnapshots,
    rowTransitions: transitions.length,
    matchedWorldBuffTransitions: matchedTransitions.length,
    matchedPermanentTransitions: permanentMatchedTransitions.length,
    matchedBridgeTransitions: bridgeMatchedTransitions.length,
    permanentPositiveValueDeltas: positivePermanentDeltas.length,
    permanentPositiveDeltasMatchingAnyResourceIncrement: exactAllowedPermanentPositiveDeltas,
  },
  sourceSummary: summarizeSourceIds(sourceIdCounts),
  valueTypeSummary: [...valueTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([valueType, observations]) => ({ valueType, observations })),
  matchedSourceSummary: summarizeSourceIds(matchedSourceIdCounts),
  permanentCandidateDiagnostics: {
    observedValueTypes: permanentValueTypes,
    expectedResourceIncrements: expectedPermanentIncrements,
    positiveDeltas: positivePermanentDeltas,
    exactAnyIncrementMatchRate: permanentDeltaMatchRate,
  },
  bridgeCandidateDiagnostics: {
    observedValueTypes: bridgeValueTypes,
    staticDurationSeconds: contract?.bridgePowerups?.powerups?.[0]?.durationSeconds ?? 160,
    note: 'Presence/absence and value transitions are preserved, but Script143 does not yet validate 160 s lifetime or match-time interpolation.',
  },
  players: playerStates,
  matchedTransitions,
  interpretation: {
    supported: validationPass
      ? 'At least one replay m_vecStatViewerModifierValues source ID maps exactly, through the established Source2 string-token hash convention, to a Script136 V02 permanent/bridge pickup resource key or modifier class.'
      : 'The replay stat-viewer vector was inspected, but no known world-buff source-token match has yet been established.',
    notYetSupported: 'A source-token match alone does not prove pickup acquisition time, permanent stack count, bridge activation/expiration, bridge interpolation, or effective composed PlayerState(t) values.',
    permanentNext: 'Validate positive value changes/persistence against Script136 permanent resource increments and independent pickup/producer telemetry.',
    bridgeNext: 'If bridge source matches exist, validate onset, 160-second lifetime, disappearance, and match-time-dependent effect magnitude.',
  },
  validation: { pass: validationPass, checks },
  nextStage: validationPass
    ? 'SEPARATE_AND_SEMANTICALLY_VALIDATE_PERMANENT_PICKUP_AND_BRIDGE_POWERUP_RUNTIME_TRANSITIONS'
    : 'DIAGNOSE_SOURCE_MODIFIER_ID_NAMESPACE_USING_OBSERVED_SOURCE_IDS_AND_KNOWN_ITEM_MODIFIER_CALIBRATION',
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('RUNTIME WORLD-BUFF MODIFIER RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                       ${status}`);
console.log(`players:                      ${playerStates.length}`);
console.log(`stat-viewer child mutations:  ${statViewerChildMutations}`);
console.log(`distinct source modifier IDs: ${distinctSourceIds.length}`);
console.log(`matched world-buff source IDs:${String(matchedDistinctSourceIds.length).padStart(4)}`);
console.log(`matched row snapshots:        ${matchedRowSnapshots}`);
console.log(`permanent matched snapshots:  ${matchedPermanentSnapshots}`);
console.log(`bridge matched snapshots:     ${matchedBridgeSnapshots}`);
console.log(`matched transitions:          ${matchedTransitions.length}`);
console.log(`permanent value types:        ${JSON.stringify(permanentValueTypes)}`);
console.log(`bridge value types:           ${JSON.stringify(bridgeValueTypes)}`);
console.log(`permanent +delta match rate:  ${formatPercent(permanentDeltaMatchRate)}`);
console.log('');
console.log('KNOWN SOURCE TOKEN CANDIDATES');
console.log('-----------------------------');
for (const row of uniqueSourceCandidates(sourceMap.candidates)) {
  console.log(`${String(row.sourceId).padStart(10)}  ${row.tokenKind.padEnd(17)} ${row.buffClass.padEnd(16)} ${row.token}`);
}
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function recordTransition({ state, index, before, after, tick, cause }) {
  const sourceId = after?.sourceModifierId ?? before?.sourceModifierId ?? null;
  const resolution = sourceId === null
    ? { matched: false, sourceId: null, candidates: [], buffClasses: [] }
    : summarizeWorldBuffSourceResolution(sourceId, sourceMap);

  const row = {
    tick,
    demoSeconds: Number.isFinite(tick) ? tick / TICKS_PER_SECOND : null,
    matchTimeSeconds: Number.isFinite(tick) && Number.isFinite(matchClockOffsetSeconds)
      ? tick / TICKS_PER_SECOND - matchClockOffsetSeconds
      : null,
    cause,
    controllerEntityIndex: state.entityIndex,
    playerName: state.playerName,
    steamId: state.steamId,
    heroId: state.heroId,
    team: state.team,
    vectorIndex: index,
    before: decorateRow(before),
    after: decorateRow(after),
    resolution,
  };

  transitions.push(row);
  if (resolution.matched) matchedTransitions.push(row);

  if (
    resolution.buffClasses.includes('PERMANENT_PICKUP')
    && before
    && after
    && before.sourceModifierId === after.sourceModifierId
    && before.valueType === after.valueType
    && Number.isFinite(before.value)
    && Number.isFinite(after.value)
    && after.value > before.value
  ) {
    const delta = after.value - before.value;
    positivePermanentDeltas.push({
      tick,
      playerName: state.playerName,
      vectorIndex: index,
      valueType: after.valueType,
      beforeValue: before.value,
      afterValue: after.value,
      delta,
      matchesAnyExpectedIncrement: expectedPermanentIncrements.some(value => nearlyEqual(value, delta)),
    });
  }
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

function readStatViewerRow(entity, index, tick) {
  const suffix = String(index).padStart(4, '0');
  const sourceModifierId = normalizeUnsignedId(entity.getField(`m_vecStatViewerModifierValues.${suffix}.m_SourceModifierID`));
  const valueType = normalizeInteger(entity.getField(`m_vecStatViewerModifierValues.${suffix}.m_eValType`));
  const value = normalizeNumber(entity.getField(`m_vecStatViewerModifierValues.${suffix}.m_flValue`));

  if (sourceModifierId === null && valueType === null && value === null) return null;
  return { sourceModifierId, valueType, value, lastTick: tick };
}

function decorateRow(row) {
  if (!row) return null;
  const resolution = row.sourceModifierId === null
    ? { matched: false, sourceId: null, candidates: [], buffClasses: [] }
    : summarizeWorldBuffSourceResolution(row.sourceModifierId, sourceMap);
  return { ...row, resolution };
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

function buildExpectedPermanentIncrements(resourceContract) {
  const values = [];
  for (const family of resourceContract?.permanentPickups?.families ?? []) {
    for (const tier of family?.tiers ?? []) {
      for (const effect of tier?.effects ?? []) {
        if (Number.isFinite(effect?.value)) values.push(effect.value);
      }
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueSourceCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const row of candidates) {
    const key = `${row.sourceId}|${row.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, sourceId: row.sourceId });
  }
  return out.sort((a, b) => a.sourceId - b.sourceId || a.token.localeCompare(b.token));
}

function summarizeSourceIds(counts) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sourceModifierId, observations]) => ({
      sourceModifierId,
      observations,
      resolution: summarizeWorldBuffSourceResolution(sourceModifierId, sourceMap),
    }));
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

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function nearlyEqual(a, b, epsilon = 1e-5) {
  return Math.abs(a - b) <= epsilon;
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
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}
