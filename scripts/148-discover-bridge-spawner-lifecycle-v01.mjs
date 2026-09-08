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
import { murmurHash2 } from '../src/source2/murmurhash2.mjs';

const VERSION = 'BRIDGE_SPAWNER_LIFECYCLE_DISCOVERY_V01';
const TICKS_PER_SECOND = 64;
const CELL_SIZE = 512;
const WORLD_OFFSET = 16384;
const INVALID_EHANDLE = 16777215;
const PAIRING_TICK_TOLERANCE = 64; // 1 s; descriptive grouping only, not a semantic gate.

const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');

// ============================================================
// PURPOSE
//
// Script147 found a clean world-object carrier for all four bridge powerup
// record-key hashes:
//
//   CCitadel_Pickup_Modifier.m_nSubclassID
//
// with zero exact-hash placebo hits. Script148 now studies the native pickup
// and spawner lifecycle without assuming runtime player ownership semantics.
//
// Current Source2 schema exposes:
//   CCitadel_PickupItemSpawner.m_tNextDropTime
//   CCitadel_PickupItemSpawner.m_bPowerupActive
//   CCitadel_Pickup.m_bActive
//   CCitadel_Pickup.m_bInteractive
//   CCitadel_Pickup.m_hVacuumTarget
//
// This script therefore asks:
//   1) Are there exactly two replay spawner entities and where are they?
//   2) Which bridge pickup record appears at each spawner/location over time?
//   3) Which pickup/spawner fields mark availability and collection?
//   4) Does m_hVacuumTarget resolve to a player/pawn at collection candidates?
//   5) Do simultaneous two-spawner appearances form a stable alternating pair
//      sequence, allowing either observed pair to occur first?
//
// Pairing/alternation output is descriptive discovery. It is NOT a gate for
// runtime_bridge_buff_ownership, because the game mechanic was supplied as a
// behavioral prior and has not yet been frozen from independent replay data.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));
const SCRIPT147_PATH = resolve('output', replayName, 'bridge_powerup_runtime_carrier_discovery_v01.json');
const OUTPUT_PATH = resolve('output', replayName, 'bridge_spawner_lifecycle_discovery_v01.json');

if (!existsSync(replayPath)) throw new Error(`Replay not found:\n${replayPath}`);
if (!existsSync(CONTRACT_PATH)) throw new Error(`Script136 V02 contract missing:\n${CONTRACT_PATH}`);
if (!existsSync(SCRIPT147_PATH)) throw new Error(`Script147 V01 artifact missing:\n${SCRIPT147_PATH}`);

const bridgeContractClaim = requireClaim('bridge_powerup_resource_contract', {
  requireSemantic: true,
  requireReplication: true,
});
const runtimeBridgeClaim = getClaim('runtime_bridge_buff_ownership');
if (runtimeBridgeClaim.authorityStatus !== 'missing') {
  throw new Error(
    'Script148 is discovery-only and expects runtime_bridge_buff_ownership to remain missing. '
    + `actual=${runtimeBridgeClaim.authorityStatus}`
  );
}

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
const carrier = JSON.parse(readFileSync(SCRIPT147_PATH, 'utf8'));

if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 V02 contract not ready. status=${contract?.status}`);
}
if (carrier?.version !== 'BRIDGE_POWERUP_RUNTIME_CARRIER_DISCOVERY_V01') {
  throw new Error(`Unexpected Script147 version: ${carrier?.version}`);
}

const bridgePowerups = (contract?.bridgePowerups?.powerups ?? []).map(row => ({
  recordKey: row.recordKey,
  modifierClass: row.modifierClass,
  durationSeconds: row.durationSeconds,
  recordId: murmurHash2(row.recordKey),
}));
const bridgeByRecordId = new Map(bridgePowerups.map(row => [row.recordId, row]));

console.log('');
console.log('========================================================');
console.log('BRIDGE SPAWNER / PICKUP LIFECYCLE DISCOVERY V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayPath}`);
console.log(`Script147 carrier artifact:     ${SCRIPT147_PATH}`);
console.log(`Bridge powerups:                ${bridgePowerups.length}`);
console.log('Pickup carrier:                 CCitadel_Pickup_Modifier.m_nSubclassID');
console.log('Spawner carrier:                CCitadel_PickupItemSpawner');
console.log('Pair grouping tolerance:        64 ticks / 1.0 s (descriptive only)');
console.log('');

const parser = new Parser(
  new ParserConfiguration({
    entityClasses: [
      'CCitadelGameRulesProxy',
      'CCitadel_PickupItemSpawner',
      'CCitadel_Pickup_Modifier',
      'CCitadelPlayerController',
      'CCitadelPlayerPawn',
    ],
  }),
  Logger.CONSOLE_INFO
);

let matchClockOffsetSeconds = null;
let entityMutationEvents = 0;
let spawnerMutationEvents = 0;
let pickupModifierMutationEvents = 0;
let controllerMutationEvents = 0;
let pawnMutationEvents = 0;

const generationByClassIndex = new Map();
const spawnerStates = new Map();
const pickupStates = new Map();
const controllerStates = new Map();
const controllerByPawnIndex = new Map();

const spawnerLifecycleEvents = [];
const pickupLifecycleEvents = [];
const pickupAppearanceEvents = [];
const vacuumTargetEvents = [];
const allRelevantFieldTransitions = [];

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;

    for (const event of events ?? []) {
      const entity = event?.entity;
      if (!entity) continue;
      entityMutationEvents++;

      const className = entity?.class?.name ?? 'UNKNOWN_CLASS';

      if (className === 'CCitadelGameRulesProxy') {
        updateClockOffset(entity);
        continue;
      }

      if (className === 'CCitadelPlayerController') {
        controllerMutationEvents++;
        refreshControllerIdentity(entity, tick);
        continue;
      }

      if (className === 'CCitadelPlayerPawn') {
        pawnMutationEvents++;
        refreshPawnIdentity(entity);
        continue;
      }

      if (className === 'CCitadel_PickupItemSpawner') {
        spawnerMutationEvents++;
        processSpawnerEvent(event, entity, tick);
        continue;
      }

      if (className === 'CCitadel_Pickup_Modifier') {
        pickupModifierMutationEvents++;
        processPickupEvent(event, entity, tick);
      }
    }
  }
);

console.log('[parse] scanning spawner/pickup lifecycle...');
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

// ============================================================
// POST-PARSE SUMMARIES
// ============================================================

const spawnerSummary = summarizeSpawners();
const bridgePickupGenerations = [...pickupStates.values()].filter(row => row.recordKey !== null);
const pickupSummary = summarizeBridgePickups(bridgePickupGenerations);
const spatialAssociation = associatePickupsToSpawners(bridgePickupGenerations, spawnerSummary);
const appearanceWithSpawner = attachSpawnerToAppearances(pickupAppearanceEvents, spatialAssociation);
const vacuumWithSpawner = attachSpawnerToVacuumEvents(vacuumTargetEvents, spatialAssociation);
const cycleSummary = inferTwoSpawnerCycles(appearanceWithSpawner, spawnerSummary);
const alternationSummary = summarizeAlternation(cycleSummary.cycles);
const fieldTransitionSummary = summarizeFieldTransitions(allRelevantFieldTransitions);
const nextDropSummary = summarizeNextDropTimes(spawnerLifecycleEvents);
const vacuumSummary = summarizeVacuumEvents(vacuumWithSpawner);

const checks = {
  registryBridgeResourceContractCurrent: check(
    bridgeContractClaim.authorityStatus,
    'current',
    bridgeContractClaim.authorityStatus === 'current'
  ),
  runtimeBridgeClaimStillMissing: check(
    runtimeBridgeClaim.authorityStatus,
    'missing',
    runtimeBridgeClaim.authorityStatus === 'missing'
  ),
  script136ContractReady: check(
    contract?.status,
    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',
    contract?.status === 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'
  ),
  script147CarrierArtifactReady: check(
    carrier?.version,
    'BRIDGE_POWERUP_RUNTIME_CARRIER_DISCOVERY_V01',
    carrier?.version === 'BRIDGE_POWERUP_RUNTIME_CARRIER_DISCOVERY_V01'
  ),
  script147RecordKeyCarrierObserved: check(
    carrier?.counts?.recordKeyHits ?? 0,
    '>0',
    (carrier?.counts?.recordKeyHits ?? 0) > 0
  ),
  script147PlaceboHitsAbsent: check(
    carrier?.counts?.controlExactHits ?? null,
    0,
    carrier?.counts?.controlExactHits === 0
  ),
  bridgePowerupsExpected: check(bridgePowerups.length, 4, bridgePowerups.length === 4),
  spawnerMutationsObserved: check(spawnerMutationEvents, '>0', spawnerMutationEvents > 0),
  pickupModifierMutationsObserved: check(pickupModifierMutationEvents, '>0', pickupModifierMutationEvents > 0),
  allFourBridgeRecordKeysObserved: check(
    pickupSummary.filter(row => row.generations > 0).length,
    4,
    pickupSummary.filter(row => row.generations > 0).length === 4
  ),
};
const integrityPass = Object.values(checks).every(row => row.pass);

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  replay: replayName,
  replayPath,
  status: integrityPass
    ? 'BRIDGE_SPAWNER_LIFECYCLE_V01_READY_FOR_INTERPRETATION'
    : 'BRIDGE_SPAWNER_LIFECYCLE_V01_REQUIRES_DIAGNOSIS',
  purpose: [
    'Characterize the two bridge powerup spawners and bridge pickup lifecycle using native replay fields.',
    'Resolve bridge pickup appearances, active/interactive state, vacuum-target collection candidates, and spatial relation to spawners.',
    'Describe observed two-spawner buff-pair and alternation structure without using it as a semantic promotion gate.',
  ],
  foundations: {
    bridgePowerupResourceContract: bridgeContractClaim.claimId,
    resourceContractPath: CONTRACT_PATH,
    carrierArtifactPath: SCRIPT147_PATH,
    carrierField: 'CCitadel_Pickup_Modifier.m_nSubclassID',
    carrierTokenForm: 'MurmurHash2(recordKey, 0x31415926)',
    runtimeBridgeClaimStatus: runtimeBridgeClaim.authorityStatus,
  },
  hypothesesFromGameplayPrior: {
    note: 'These are user-supplied gameplay priors used to organize diagnostics, not validation gates.',
    twoBridgeLocations: true,
    buffsAppearInPairs: true,
    pairSequenceAlternatesAfterAnInitiallyVariableStartingPair: true,
    exactPairMembership: 'NOT_PRESET; inferred from replay if possible',
  },
  schemaTargets: {
    spawner: [
      'CCitadel_PickupItemSpawner.m_bPowerupActive',
      'CCitadel_PickupItemSpawner.m_tNextDropTime',
    ],
    pickup: [
      'CCitadel_Pickup_Modifier.m_nSubclassID',
      'CCitadel_Pickup.m_bActive',
      'CCitadel_Pickup.m_bInteractive',
      'CCitadel_Pickup.m_hVacuumTarget',
    ],
  },
  counts: {
    entityMutationEvents,
    spawnerMutationEvents,
    pickupModifierMutationEvents,
    controllerMutationEvents,
    pawnMutationEvents,
    uniqueSpawnerIndexes: spawnerSummary.length,
    bridgePickupGenerations: bridgePickupGenerations.length,
    bridgePickupAppearanceEvents: pickupAppearanceEvents.length,
    vacuumTargetCandidateEvents: vacuumTargetEvents.length,
    playerResolvedVacuumEvents: vacuumWithSpawner.filter(row => row.resolvedPlayer !== null).length,
    inferredTwoSpawnerCycles: cycleSummary.cycles.length,
    completeTwoSpawnerCycles: cycleSummary.cycles.filter(row => row.complete).length,
  },
  bridgePowerups,
  spawnerSummary,
  pickupSummary,
  spatialAssociation,
  nextDropSummary,
  vacuumSummary,
  cycleSummary,
  alternationSummary,
  fieldTransitionSummary,
  spawnerLifecycleEvents,
  pickupAppearanceEvents: appearanceWithSpawner,
  vacuumTargetEvents: vacuumWithSpawner,
  integrityValidation: {
    pass: integrityPass,
    checks,
  },
  semanticValidation: {
    status: 'DISCOVERY_ONLY_NOT_ESTABLISHED',
    supportedIfObserved: [
      'Native replay entities expose bridge pickup world identity and a two-spawner lifecycle substrate.',
      'm_hVacuumTarget events can be evaluated as candidate collector attribution when they resolve to player pawns/controllers.',
      'Observed pair/alternation structure can be frozen in a subsequent validation script if sufficiently clean.',
    ],
    notClaimed: [
      'm_bActive, m_bInteractive, m_bPowerupActive, or m_hVacuumTarget are not assigned final semantics solely because of field names.',
      'A vacuum target is not yet a validated bridge-buff ownership interval.',
      'The 160-second player-buff duration is not validated here.',
      'Pair membership and alternation are descriptive outputs, not authority until separately validated and replicated.',
      'runtime_bridge_buff_ownership remains missing.',
    ],
  },
  replicationStatus: 'DISCOVERY_REPLAY_ONLY',
};

mkdirSync(resolve('output', replayName), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

printSummary(output);

// ============================================================
// EVENT PROCESSING
// ============================================================

function processSpawnerEvent(event, entity, tick) {
  const entityIndex = getEntityIndex(entity);
  if (entityIndex === null) return;
  const generation = generationForEvent('SPAWNER', entityIndex, event.operation);
  const key = `SPAWNER:${entityIndex}:${generation}`;

  let state = spawnerStates.get(key);
  if (!state) {
    state = {
      key,
      entityIndex,
      generation,
      createTick: null,
      deleteTick: null,
      positionSamples: [],
      firstPosition: null,
      lastPosition: null,
      lastValues: {},
      activeTransitions: [],
      nextDropTransitions: [],
    };
    spawnerStates.set(key, state);
  }

  const position = getPosition(entity);
  if (hasWorldPosition(position)) {
    state.positionSamples.push(position.world);
    state.firstPosition ??= position.world;
    state.lastPosition = position.world;
  }

  if (event.operation === EntityOperation.CREATE) state.createTick = tick;
  if (event.operation === EntityOperation.DELETE || event.operation === EntityOperation.LEAVE) state.deleteTick = tick;

  if (event.operation === EntityOperation.CREATE || event.operation === EntityOperation.UPDATE) {
    observeFieldTransition({
      state,
      fieldName: 'm_bPowerupActive',
      value: safeGetField(entity, 'm_bPowerupActive'),
      tick,
      className: 'CCitadel_PickupItemSpawner',
      entityIndex,
      generation,
      sink: state.activeTransitions,
      eventOperation: operationName(event.operation),
    });
    observeFieldTransition({
      state,
      fieldName: 'm_tNextDropTime',
      value: safeGetField(entity, 'm_tNextDropTime'),
      tick,
      className: 'CCitadel_PickupItemSpawner',
      entityIndex,
      generation,
      sink: state.nextDropTransitions,
      eventOperation: operationName(event.operation),
    });
  }

  spawnerLifecycleEvents.push({
    tick,
    matchTimeSeconds: toMatchTime(tick),
    matchClock: formatClock(toMatchTime(tick)),
    operation: operationName(event.operation),
    entityIndex,
    generation,
    position: hasWorldPosition(position) ? position.world : null,
    m_bPowerupActive: safeValue(safeGetField(entity, 'm_bPowerupActive')),
    m_tNextDropTime: safeValue(safeGetField(entity, 'm_tNextDropTime')),
  });
}

function processPickupEvent(event, entity, tick) {
  const entityIndex = getEntityIndex(entity);
  if (entityIndex === null) return;
  const generation = generationForEvent('PICKUP', entityIndex, event.operation);
  const key = `PICKUP:${entityIndex}:${generation}`;

  let state = pickupStates.get(key);
  if (!state) {
    state = {
      key,
      entityIndex,
      generation,
      createTick: null,
      deleteTick: null,
      recordKey: null,
      recordId: null,
      modifierClass: null,
      durationSeconds: null,
      identityTick: null,
      firstPosition: null,
      lastPosition: null,
      positionSamples: [],
      lastValues: {},
      activeTransitions: [],
      interactiveTransitions: [],
      vacuumTransitions: [],
      ownerTransitions: [],
    };
    pickupStates.set(key, state);
  }

  if (event.operation === EntityOperation.CREATE) state.createTick = tick;
  if (event.operation === EntityOperation.DELETE || event.operation === EntityOperation.LEAVE) state.deleteTick = tick;

  const recordId = normalizeUint32(safeGetField(entity, 'm_nSubclassID'));
  const identity = recordId === null ? null : bridgeByRecordId.get(recordId) ?? null;
  if (identity) {
    if (state.recordKey !== null && state.recordKey !== identity.recordKey) {
      // Keep the first bridge identity for this generation, but record the transition.
      allRelevantFieldTransitions.push({
        className: 'CCitadel_Pickup_Modifier',
        fieldName: 'm_nSubclassID',
        tick,
        entityIndex,
        generation,
        before: state.recordId,
        after: recordId,
        note: 'BRIDGE_IDENTITY_CHANGED_WITHIN_GENERATION',
      });
    } else if (state.recordKey === null) {
      state.recordKey = identity.recordKey;
      state.recordId = recordId;
      state.modifierClass = identity.modifierClass;
      state.durationSeconds = identity.durationSeconds;
      state.identityTick = tick;
    }
  }

  const position = getPosition(entity);
  if (hasWorldPosition(position)) {
    state.positionSamples.push(position.world);
    state.firstPosition ??= position.world;
    state.lastPosition = position.world;
  }

  if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) return;

  const activeTransition = observeFieldTransition({
    state,
    fieldName: 'm_bActive',
    value: safeGetField(entity, 'm_bActive'),
    tick,
    className: 'CCitadel_Pickup_Modifier',
    entityIndex,
    generation,
    sink: state.activeTransitions,
    eventOperation: operationName(event.operation),
  });

  observeFieldTransition({
    state,
    fieldName: 'm_bInteractive',
    value: safeGetField(entity, 'm_bInteractive'),
    tick,
    className: 'CCitadel_Pickup_Modifier',
    entityIndex,
    generation,
    sink: state.interactiveTransitions,
    eventOperation: operationName(event.operation),
  });

  const vacuumRaw = safeGetField(entity, 'm_hVacuumTarget');
  const vacuumTransition = observeFieldTransition({
    state,
    fieldName: 'm_hVacuumTarget',
    value: vacuumRaw,
    tick,
    className: 'CCitadel_Pickup_Modifier',
    entityIndex,
    generation,
    sink: state.vacuumTransitions,
    eventOperation: operationName(event.operation),
  });

  observeFieldTransition({
    state,
    fieldName: 'm_hOwnerEntity',
    value: safeGetField(entity, 'm_hOwnerEntity'),
    tick,
    className: 'CCitadel_Pickup_Modifier',
    entityIndex,
    generation,
    sink: state.ownerTransitions,
    eventOperation: operationName(event.operation),
  });

  if (state.recordKey) {
    const isAppearance = event.operation === EntityOperation.CREATE
      ? safeGetField(entity, 'm_bActive') === true
      : activeTransition?.before === false && activeTransition?.after === true;

    if (isAppearance) {
      pickupAppearanceEvents.push({
        tick,
        matchTimeSeconds: toMatchTime(tick),
        matchClock: formatClock(toMatchTime(tick)),
        eventKind: event.operation === EntityOperation.CREATE ? 'CREATE_ACTIVE' : 'ACTIVE_FALSE_TO_TRUE',
        entityIndex,
        generation,
        recordKey: state.recordKey,
        recordId: state.recordId,
        position: state.lastPosition,
        active: safeValue(safeGetField(entity, 'm_bActive')),
        interactive: safeValue(safeGetField(entity, 'm_bInteractive')),
      });
    }

    if (vacuumTransition && isValidHandleLike(vacuumTransition.after)) {
      const resolved = resolveHandleContext(vacuumRaw);
      vacuumTargetEvents.push({
        tick,
        matchTimeSeconds: toMatchTime(tick),
        matchClock: formatClock(toMatchTime(tick)),
        entityIndex,
        generation,
        recordKey: state.recordKey,
        recordId: state.recordId,
        position: state.lastPosition,
        priorVacuumTarget: vacuumTransition.before,
        vacuumTarget: vacuumTransition.after,
        targetEntity: resolved?.entity ?? null,
        resolvedPlayer: resolved?.player ?? null,
        active: safeValue(safeGetField(entity, 'm_bActive')),
        interactive: safeValue(safeGetField(entity, 'm_bInteractive')),
      });
    }
  }
}

function generationForEvent(kind, entityIndex, operation) {
  const key = `${kind}:${entityIndex}`;
  let generation = generationByClassIndex.get(key) ?? 0;
  if (operation === EntityOperation.CREATE) {
    generation += 1;
    generationByClassIndex.set(key, generation);
  } else if (!generationByClassIndex.has(key)) {
    generation = 1;
    generationByClassIndex.set(key, generation);
  }
  return generation;
}

function observeFieldTransition({
  state,
  fieldName,
  value,
  tick,
  className,
  entityIndex,
  generation,
  sink,
  eventOperation,
}) {
  const normalized = safeValue(value);
  const hadBefore = Object.prototype.hasOwnProperty.call(state.lastValues, fieldName);
  const before = hadBefore ? state.lastValues[fieldName] : undefined;
  const changed = !hadBefore || stableKey(before) !== stableKey(normalized);
  if (!changed) return null;

  state.lastValues[fieldName] = normalized;
  const transition = {
    tick,
    matchTimeSeconds: toMatchTime(tick),
    matchClock: formatClock(toMatchTime(tick)),
    operation: eventOperation,
    className,
    fieldName,
    entityIndex,
    generation,
    before: hadBefore ? before : null,
    after: normalized,
    firstObservation: !hadBefore,
  };
  sink.push(transition);
  allRelevantFieldTransitions.push(transition);
  return transition;
}

// ============================================================
// PLAYER / HANDLE RESOLUTION
// ============================================================

function refreshControllerIdentity(entity, tick) {
  const controllerEntityIndex = getEntityIndex(entity);
  if (controllerEntityIndex === null) return;

  const prior = controllerStates.get(controllerEntityIndex) ?? {
    controllerEntityIndex,
    pawnEntityIndex: null,
    playerName: null,
    steamId: null,
    heroId: null,
    team: null,
    lastTick: null,
  };

  const playerName = firstField(entity, ['m_iszPlayerName', 'm_sPlayerName', 'm_playerName', 'm_strPlayerName']);
  const steamId = firstField(entity, ['m_steamID', 'm_steamId']);
  const heroId = firstField(entity, ['m_nHeroID', 'm_nHeroId', 'm_eHeroID', 'm_iHeroID']);
  const team = safeGetField(entity, 'm_iTeamNum');
  const pawnHandle = firstField(entity, ['m_hHeroPawn', 'm_hPawn', 'm_hPlayerPawn', 'm_hAssignedHero']);
  const pawnEntity = safeResolveEntityHandle(pawnHandle);
  const pawnEntityIndex = getEntityIndex(pawnEntity);

  if (playerName !== null && playerName !== undefined) prior.playerName = String(playerName);
  if (steamId !== null && steamId !== undefined) prior.steamId = safeValue(steamId);
  if (heroId !== null && heroId !== undefined) prior.heroId = safeValue(heroId);
  if (team !== null && team !== undefined) prior.team = safeValue(team);
  if (pawnEntityIndex !== null) {
    prior.pawnEntityIndex = pawnEntityIndex;
    controllerByPawnIndex.set(pawnEntityIndex, controllerEntityIndex);
  }
  prior.lastTick = tick;
  controllerStates.set(controllerEntityIndex, prior);
}

function refreshPawnIdentity(entity) {
  const pawnEntityIndex = getEntityIndex(entity);
  if (pawnEntityIndex === null) return;
  if (controllerByPawnIndex.has(pawnEntityIndex)) return;

  const owner = safeResolveEntityHandle(safeGetField(entity, 'm_hOwnerEntity'));
  if (owner?.class?.name === 'CCitadelPlayerController') {
    const controllerIndex = getEntityIndex(owner);
    if (controllerIndex !== null) controllerByPawnIndex.set(pawnEntityIndex, controllerIndex);
  }
}

function resolveHandleContext(handle) {
  const entity = safeResolveEntityHandle(handle);
  if (!entity) return null;
  const entityIndex = getEntityIndex(entity);
  const className = entity?.class?.name ?? null;

  let player = null;
  if (className === 'CCitadelPlayerController' && entityIndex !== null) {
    player = clonePlayer(controllerStates.get(entityIndex));
  } else if (className === 'CCitadelPlayerPawn' && entityIndex !== null) {
    const controllerIndex = controllerByPawnIndex.get(entityIndex);
    if (controllerIndex !== undefined) player = clonePlayer(controllerStates.get(controllerIndex));
  }

  return {
    entity: {
      entityIndex,
      className,
      position: getPosition(entity)?.world ?? null,
    },
    player,
  };
}

function clonePlayer(player) {
  if (!player) return null;
  return {
    controllerEntityIndex: player.controllerEntityIndex,
    pawnEntityIndex: player.pawnEntityIndex,
    playerName: player.playerName,
    steamId: player.steamId,
    heroId: player.heroId,
    team: player.team,
  };
}

// ============================================================
// SUMMARIES
// ============================================================

function summarizeSpawners() {
  const byIndex = new Map();
  for (const state of spawnerStates.values()) {
    if (!byIndex.has(state.entityIndex)) {
      byIndex.set(state.entityIndex, {
        entityIndex: state.entityIndex,
        generations: 0,
        positions: [],
        activeTransitions: [],
        nextDropTransitions: [],
      });
    }
    const out = byIndex.get(state.entityIndex);
    out.generations++;
    if (state.firstPosition) out.positions.push(state.firstPosition);
    out.activeTransitions.push(...state.activeTransitions);
    out.nextDropTransitions.push(...state.nextDropTransitions);
  }

  return [...byIndex.values()]
    .map(row => ({
      entityIndex: row.entityIndex,
      generations: row.generations,
      representativePosition: representativePosition(row.positions),
      activeTransitions: dedupeTransitions(row.activeTransitions),
      nextDropTransitions: dedupeTransitions(row.nextDropTransitions),
    }))
    .sort((a, b) => a.entityIndex - b.entityIndex);
}

function summarizeBridgePickups(states) {
  return bridgePowerups.map(powerup => {
    const rows = states.filter(state => state.recordKey === powerup.recordKey);
    const entityIndexes = [...new Set(rows.map(row => row.entityIndex))].sort((a, b) => a - b);
    const positions = rows.map(row => row.firstPosition).filter(Boolean);
    const activeTransitions = rows.flatMap(row => row.activeTransitions);
    const interactiveTransitions = rows.flatMap(row => row.interactiveTransitions);
    const vacuumTransitions = rows.flatMap(row => row.vacuumTransitions);
    return {
      recordKey: powerup.recordKey,
      recordId: powerup.recordId,
      modifierClass: powerup.modifierClass,
      durationSeconds: powerup.durationSeconds,
      generations: rows.length,
      entityIndexes,
      representativePositions: uniquePositions(positions),
      activeFalseToTrue: activeTransitions.filter(row => row.before === false && row.after === true).length,
      activeTrueToFalse: activeTransitions.filter(row => row.before === true && row.after === false).length,
      interactiveFalseToTrue: interactiveTransitions.filter(row => row.before === false && row.after === true).length,
      interactiveTrueToFalse: interactiveTransitions.filter(row => row.before === true && row.after === false).length,
      vacuumTargetTransitions: vacuumTransitions.length,
      validVacuumTargetTransitions: vacuumTransitions.filter(row => isValidHandleLike(row.after)).length,
    };
  });
}

function associatePickupsToSpawners(states, spawners) {
  const spawnerPositions = spawners
    .filter(row => hasWorldPosition({ world: row.representativePosition }))
    .map(row => ({ entityIndex: row.entityIndex, position: row.representativePosition }));

  return states.map(state => {
    const position = state.firstPosition ?? state.lastPosition;
    const distances = position
      ? spawnerPositions.map(spawner => ({
          spawnerEntityIndex: spawner.entityIndex,
          distance2D: distance2D(position, spawner.position),
          distance3D: distance3D(position, spawner.position),
        })).sort((a, b) => a.distance2D - b.distance2D)
      : [];

    return {
      pickupKey: state.key,
      entityIndex: state.entityIndex,
      generation: state.generation,
      recordKey: state.recordKey,
      createTick: state.createTick,
      identityTick: state.identityTick,
      position,
      nearestSpawnerEntityIndex: distances[0]?.spawnerEntityIndex ?? null,
      nearestSpawnerDistance2D: distances[0]?.distance2D ?? null,
      secondSpawnerDistance2D: distances[1]?.distance2D ?? null,
      nearestSpawnerAdvantage2D: distances.length >= 2
        ? distances[1].distance2D - distances[0].distance2D
        : null,
      allSpawnerDistances: distances,
    };
  });
}

function attachSpawnerToAppearances(events, spatial) {
  const byKey = new Map(spatial.map(row => [row.pickupKey, row]));
  return events.map(event => {
    const key = `PICKUP:${event.entityIndex}:${event.generation}`;
    const association = byKey.get(key);
    return {
      ...event,
      nearestSpawnerEntityIndex: association?.nearestSpawnerEntityIndex ?? null,
      nearestSpawnerDistance2D: association?.nearestSpawnerDistance2D ?? null,
      nearestSpawnerAdvantage2D: association?.nearestSpawnerAdvantage2D ?? null,
    };
  }).sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
}

function attachSpawnerToVacuumEvents(events, spatial) {
  const byKey = new Map(spatial.map(row => [row.pickupKey, row]));
  return events.map(event => {
    const key = `PICKUP:${event.entityIndex}:${event.generation}`;
    const association = byKey.get(key);
    return {
      ...event,
      nearestSpawnerEntityIndex: association?.nearestSpawnerEntityIndex ?? null,
      nearestSpawnerDistance2D: association?.nearestSpawnerDistance2D ?? null,
      nearestSpawnerAdvantage2D: association?.nearestSpawnerAdvantage2D ?? null,
    };
  }).sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
}

function inferTwoSpawnerCycles(appearances, spawners) {
  const spawnerIds = spawners.map(row => row.entityIndex).sort((a, b) => a - b);
  if (spawnerIds.length !== 2) {
    return {
      policy: `Requires exactly two observed spawner indexes; actual=${spawnerIds.length}`,
      spawnerIds,
      cycles: [],
    };
  }

  const eligible = appearances
    .filter(row => spawnerIds.includes(row.nearestSpawnerEntityIndex))
    .sort((a, b) => a.tick - b.tick);

  const cycles = [];
  const used = new Set();
  for (let i = 0; i < eligible.length; i++) {
    if (used.has(i)) continue;
    const anchor = eligible[i];
    const otherSpawner = spawnerIds.find(id => id !== anchor.nearestSpawnerEntityIndex);
    let bestJ = null;
    let bestDt = Infinity;
    for (let j = 0; j < eligible.length; j++) {
      if (j === i || used.has(j)) continue;
      const candidate = eligible[j];
      if (candidate.nearestSpawnerEntityIndex !== otherSpawner) continue;
      const dt = Math.abs(candidate.tick - anchor.tick);
      if (dt <= PAIRING_TICK_TOLERANCE && dt < bestDt) {
        bestDt = dt;
        bestJ = j;
      }
    }

    const members = [anchor];
    used.add(i);
    if (bestJ !== null) {
      members.push(eligible[bestJ]);
      used.add(bestJ);
    }
    members.sort((a, b) => a.nearestSpawnerEntityIndex - b.nearestSpawnerEntityIndex);

    const pair = members.map(row => row.recordKey).sort();
    cycles.push({
      cycleIndex: cycles.length,
      anchorTick: Math.min(...members.map(row => row.tick)),
      maxTick: Math.max(...members.map(row => row.tick)),
      withinTicks: members.length === 2 ? Math.abs(members[0].tick - members[1].tick) : null,
      matchTimeSeconds: members.reduce((sum, row) => sum + (row.matchTimeSeconds ?? 0), 0) / members.length,
      matchClock: formatClock(members.reduce((sum, row) => sum + (row.matchTimeSeconds ?? 0), 0) / members.length),
      complete: members.length === 2,
      pair,
      pairKey: pair.join(' + '),
      bySpawner: Object.fromEntries(members.map(row => [row.nearestSpawnerEntityIndex, row.recordKey])),
      members,
    });
  }

  cycles.sort((a, b) => a.anchorTick - b.anchorTick);
  cycles.forEach((row, index) => { row.cycleIndex = index; });
  return {
    policy: `Pair appearance events from the two nearest-spawner assignments within ${PAIRING_TICK_TOLERANCE} ticks. Descriptive only.`,
    spawnerIds,
    cycles,
  };
}

function summarizeAlternation(cycles) {
  const complete = cycles.filter(row => row.complete);
  const pairCounts = new Map();
  for (const row of complete) pairCounts.set(row.pairKey, (pairCounts.get(row.pairKey) ?? 0) + 1);
  const distinctPairs = [...pairCounts.entries()]
    .map(([pairKey, count]) => ({ pairKey, count }))
    .sort((a, b) => b.count - a.count || a.pairKey.localeCompare(b.pairKey));

  let adjacentComparisons = 0;
  let adjacentAlternations = 0;
  let samePairRepeats = 0;
  for (let i = 1; i < complete.length; i++) {
    adjacentComparisons++;
    if (complete[i].pairKey !== complete[i - 1].pairKey) adjacentAlternations++;
    else samePairRepeats++;
  }

  const topTwoPairKeys = distinctPairs.slice(0, 2).map(row => row.pairKey);
  const topTwoOnly = complete.length > 0 && complete.every(row => topTwoPairKeys.includes(row.pairKey));
  const strictAlternationAmongTopTwo = complete.length >= 2
    && topTwoPairKeys.length === 2
    && topTwoOnly
    && samePairRepeats === 0;

  return {
    completeCycles: complete.length,
    distinctPairCount: distinctPairs.length,
    distinctPairs,
    sequence: complete.map(row => ({
      cycleIndex: row.cycleIndex,
      matchClock: row.matchClock,
      pairKey: row.pairKey,
    })),
    adjacentComparisons,
    adjacentAlternations,
    samePairRepeats,
    topTwoPairKeys,
    topTwoOnly,
    strictAlternationAmongTopTwo,
    interpretation: strictAlternationAmongTopTwo
      ? 'Observed complete cycles are consistent with two alternating unordered buff pairs in this replay. Starting pair is not constrained.'
      : 'Observed cycles do not yet establish a strict two-pair alternating sequence under the current appearance grouping rule.',
  };
}

function summarizeFieldTransitions(rows) {
  const by = new Map();
  for (const row of rows) {
    const key = `${row.className}.${row.fieldName}`;
    if (!by.has(key)) by.set(key, { className: row.className, fieldName: row.fieldName, rows: [] });
    by.get(key).rows.push(row);
  }
  return [...by.values()].map(group => ({
    className: group.className,
    fieldName: group.fieldName,
    transitions: group.rows.length,
    entities: new Set(group.rows.map(row => row.entityIndex)).size,
    firstTick: Math.min(...group.rows.map(row => row.tick).filter(Number.isFinite)),
    lastTick: Math.max(...group.rows.map(row => row.tick).filter(Number.isFinite)),
    distinctAfterValues: [...new Map(group.rows.map(row => [stableKey(row.after), row.after])).values()].slice(0, 30),
  })).sort((a, b) => b.transitions - a.transitions || a.className.localeCompare(b.className) || a.fieldName.localeCompare(b.fieldName));
}

function summarizeNextDropTimes(events) {
  const bySpawner = new Map();
  for (const row of events) {
    if (!Number.isFinite(row.m_tNextDropTime)) continue;
    if (!bySpawner.has(row.entityIndex)) bySpawner.set(row.entityIndex, []);
    const arr = bySpawner.get(row.entityIndex);
    if (arr.length === 0 || arr[arr.length - 1].value !== row.m_tNextDropTime) {
      arr.push({ tick: row.tick, matchClock: row.matchClock, value: row.m_tNextDropTime });
    }
  }
  return [...bySpawner.entries()].map(([entityIndex, rows]) => ({
    entityIndex,
    transitions: rows,
    successiveValueDeltas: rows.slice(1).map((row, i) => row.value - rows[i].value),
  })).sort((a, b) => a.entityIndex - b.entityIndex);
}

function summarizeVacuumEvents(events) {
  const byRecord = new Map();
  for (const powerup of bridgePowerups) byRecord.set(powerup.recordKey, []);
  for (const event of events) byRecord.get(event.recordKey)?.push(event);
  return [...byRecord.entries()].map(([recordKey, rows]) => ({
    recordKey,
    candidateEvents: rows.length,
    resolvedTargetEntities: rows.filter(row => row.targetEntity !== null).length,
    resolvedPlayers: rows.filter(row => row.resolvedPlayer !== null).length,
    targetClasses: [...new Set(rows.map(row => row.targetEntity?.className).filter(Boolean))].sort(),
    playerNames: [...new Set(rows.map(row => row.resolvedPlayer?.playerName).filter(Boolean))].sort(),
  }));
}

// ============================================================
// POSITION / CLOCK / UTILITIES
// ============================================================

function getPosition(entity) {
  const cellX = safeGetField(entity, 'CBodyComponent.m_cellX');
  const cellY = safeGetField(entity, 'CBodyComponent.m_cellY');
  const cellZ = safeGetField(entity, 'CBodyComponent.m_cellZ');
  const vecX = safeGetField(entity, 'CBodyComponent.m_vecX');
  const vecY = safeGetField(entity, 'CBodyComponent.m_vecY');
  const vecZ = safeGetField(entity, 'CBodyComponent.m_vecZ');
  return {
    raw: { cellX, cellY, cellZ, vecX, vecY, vecZ },
    world: {
      x: decodeCoordinate(cellX, vecX),
      y: decodeCoordinate(cellY, vecY),
      z: decodeCoordinate(cellZ, vecZ),
    },
  };
}

function decodeCoordinate(cell, local) {
  if (!Number.isFinite(cell) || !Number.isFinite(local)) return null;
  return cell * CELL_SIZE - WORLD_OFFSET + local;
}

function hasWorldPosition(position) {
  return Number.isFinite(position?.world?.x) && Number.isFinite(position?.world?.y) && Number.isFinite(position?.world?.z);
}

function representativePosition(positions) {
  if (!positions.length) return null;
  return {
    x: median(positions.map(row => row.x).filter(Number.isFinite)),
    y: median(positions.map(row => row.y).filter(Number.isFinite)),
    z: median(positions.map(row => row.z).filter(Number.isFinite)),
  };
}

function uniquePositions(positions) {
  const by = new Map();
  for (const row of positions) {
    if (!row) continue;
    const key = `${round(row.x, 1)}|${round(row.y, 1)}|${round(row.z, 1)}`;
    if (!by.has(key)) by.set(key, { x: round(row.x, 1), y: round(row.y, 1), z: round(row.z, 1) });
  }
  return [...by.values()];
}

function distance2D(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3D(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function updateClockOffset(entity) {
  if (Number.isFinite(matchClockOffsetSeconds)) return;
  const gameStart = safeGetField(entity, 'm_pGameRules.m_flGameStartTime');
  const stateStart = safeGetField(entity, 'm_pGameRules.m_flGameStateStartTime');
  if (Number.isFinite(gameStart) && Number.isFinite(stateStart)) {
    matchClockOffsetSeconds = gameStart - stateStart;
  }
}

function toMatchTime(tick) {
  if (!Number.isFinite(tick) || !Number.isFinite(matchClockOffsetSeconds)) return null;
  return tick / TICKS_PER_SECOND - matchClockOffsetSeconds;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const minutes = Math.floor(abs / 60);
  const secs = Math.floor(abs % 60);
  const millis = Math.round((abs - Math.floor(abs)) * 1000);
  return `${sign}${minutes}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function safeGetField(entity, fieldName) {
  try {
    return entity?.getField?.(fieldName);
  } catch {
    return null;
  }
}

function firstField(entity, fields) {
  for (const field of fields) {
    const value = safeGetField(entity, field);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function safeResolveEntityHandle(handle) {
  if (handle === null || handle === undefined) return null;
  try {
    return parser.getDemo().getEntityByHandle(handle) ?? null;
  } catch {
    return null;
  }
}

function getEntityIndex(entity) {
  const n = entity?.index;
  return Number.isInteger(n) ? n : null;
}

function normalizeUint32(value) {
  if (typeof value === 'bigint') {
    if (value < -2147483648n || value > 4294967295n) return null;
    return Number(value) >>> 0;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 4294967295) {
    return value >>> 0;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 4294967295) return parsed >>> 0;
  }
  return null;
}

function isValidHandleLike(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isInteger(value) && value !== INVALID_EHANDLE && value !== 0;
  if (typeof value === 'bigint') return value !== BigInt(INVALID_EHANDLE) && value !== 0n;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n !== INVALID_EHANDLE && n !== 0;
  }
  // Object handle representations are allowed through if they serialize non-null;
  // safeResolveEntityHandle will determine whether they resolve.
  return typeof value === 'object';
}

function operationName(operation) {
  if (operation === EntityOperation.CREATE) return 'CREATE';
  if (operation === EntityOperation.UPDATE) return 'UPDATE';
  if (operation === EntityOperation.DELETE) return 'DELETE';
  if (operation === EntityOperation.LEAVE) return 'LEAVE';
  return `OP_${operation?._code ?? operation ?? 'UNKNOWN'}`;
}

function safeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.parse(JSON.stringify(value, (_, child) => typeof child === 'bigint' ? child.toString() : child));
  } catch {
    return String(value);
  }
}

function stableKey(value) {
  try {
    return JSON.stringify(value, Object.keys(value ?? {}).sort());
  } catch {
    return String(value);
  }
}

function dedupeTransitions(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0))) {
    const key = `${row.tick}|${row.entityIndex}|${row.fieldName}|${stableKey(row.before)}|${stableKey(row.after)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function check(actual, expected, pass) {
  return { pass: Boolean(pass), actual, expected };
}

function printSummary(result) {
  console.log('');
  console.log('========================================================');
  console.log('BRIDGE SPAWNER / PICKUP LIFECYCLE RESULT');
  console.log('========================================================');
  console.log('');
  console.log(`status:                         ${result.status}`);
  console.log(`unique spawner indexes:         ${result.counts.uniqueSpawnerIndexes}`);
  console.log(`bridge pickup generations:      ${result.counts.bridgePickupGenerations}`);
  console.log(`bridge appearance events:       ${result.counts.bridgePickupAppearanceEvents}`);
  console.log(`vacuum target candidates:       ${result.counts.vacuumTargetCandidateEvents}`);
  console.log(`player-resolved vacuum events:  ${result.counts.playerResolvedVacuumEvents}`);
  console.log(`two-spawner cycles inferred:    ${result.counts.inferredTwoSpawnerCycles}`);
  console.log(`complete two-spawner cycles:    ${result.counts.completeTwoSpawnerCycles}`);

  console.log('');
  console.log('SPAWNERS');
  console.log('--------');
  for (const row of result.spawnerSummary) {
    const p = row.representativePosition;
    console.log(
      `spawner=${String(row.entityIndex).padStart(4)} `
      + `gens=${String(row.generations).padStart(3)} `
      + `pos=${p ? `(${round(p.x, 1)}, ${round(p.y, 1)}, ${round(p.z, 1)})` : 'null'} `
      + `activeTransitions=${row.activeTransitions.length} nextDropTransitions=${row.nextDropTransitions.length}`
    );
  }

  console.log('');
  console.log('BRIDGE PICKUPS');
  console.log('--------------');
  for (const row of result.pickupSummary) {
    console.log(
      `${row.recordKey.padEnd(28)} gens=${String(row.generations).padStart(3)} `
      + `active+=${String(row.activeFalseToTrue).padStart(3)} `
      + `active-=${String(row.activeTrueToFalse).padStart(3)} `
      + `vacuumValid=${String(row.validVacuumTargetTransitions).padStart(3)}`
    );
  }

  console.log('');
  console.log('PAIR / ALTERNATION DISCOVERY');
  console.log('----------------------------');
  console.log(`distinct complete pairs:         ${result.alternationSummary.distinctPairCount}`);
  console.log(`adjacent pair comparisons:       ${result.alternationSummary.adjacentComparisons}`);
  console.log(`adjacent alternations:           ${result.alternationSummary.adjacentAlternations}`);
  console.log(`same-pair repeats:               ${result.alternationSummary.samePairRepeats}`);
  console.log(`strict top-two alternation:      ${result.alternationSummary.strictAlternationAmongTopTwo}`);
  for (const row of result.alternationSummary.distinctPairs.slice(0, 10)) {
    console.log(`  ${row.pairKey}  count=${row.count}`);
  }

  if (result.alternationSummary.sequence.length > 0) {
    console.log('');
    console.log('PAIR SEQUENCE');
    console.log('-------------');
    for (const row of result.alternationSummary.sequence.slice(0, 40)) {
      console.log(`${String(row.cycleIndex).padStart(2)}  ${String(row.matchClock).padEnd(12)} ${row.pairKey}`);
    }
  }

  console.log('');
  console.log('VACUUM / COLLECTOR SUMMARY');
  console.log('--------------------------');
  for (const row of result.vacuumSummary) {
    console.log(
      `${row.recordKey.padEnd(28)} events=${String(row.candidateEvents).padStart(3)} `
      + `resolvedEntities=${String(row.resolvedTargetEntities).padStart(3)} `
      + `resolvedPlayers=${String(row.resolvedPlayers).padStart(3)} `
      + `targetClasses=[${row.targetClasses.join(',')}]`
    );
  }

  console.log('');
  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');
  for (const [name, row] of Object.entries(result.integrityValidation.checks)) {
    console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
  }
  console.log('');
  console.log(`JSON:\n${OUTPUT_PATH}`);
  console.log('');
}
