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

const VERSION = 'BRIDGE_PVS_ROBUST_LIFECYCLE_DISCOVERY_V01';
const TICKS_PER_SECOND = 64;
const SAMPLE_EVERY_TICKS = 16;
const CELL_SIZE = 512;
const WORLD_OFFSET = 16384;
const INVALID_EHANDLE = 16777215;
const SPAWN_ASSOCIATION_TICKS = 128; // +/- 2 s around a native spawner anchor.
const SPAWNER_ASSIGNMENT_MAX_HU = 1600;
const PLACEBO_SHIFT_TICKS = 30 * TICKS_PER_SECOND;
const PLAYER_SAMPLE_MAX_GAP_TICKS = SAMPLE_EVERY_TICKS;

const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');

// ============================================================
// PURPOSE
//
// Script148 established a clean two-spawner topology but treated CREATE-active
// observations as pickup appearances. The replay has only two spawner indexes
// yet many CREATE operations, proving that CREATE is frequently PVS/network
// re-entry rather than genuine world spawn.
//
// Script149 therefore freezes a PVS-robust discovery policy:
//   - CREATE is an observation, never by itself a spawn/deactivation event.
//   - Native UPDATE transitions on spawner fields are the primary spawn anchors.
//   - Pickup active false->true UPDATEs are strong appearance candidates.
//   - Pickup active true->false UPDATEs are disappearance/collection candidates.
//   - Pickup identity is CCitadel_Pickup_Modifier.m_nSubclassID = hash(recordKey).
//   - Pickup world position assigns it to the nearest of exactly two spawners.
//   - Nearest-player geometry at true->false events is compared with a +30 s
//     shifted-time control before any collector interpretation is promoted.
//
// This script is discovery-only. It does NOT promote runtime bridge ownership.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));
const SCRIPT147_PATH = resolve('output', replayName, 'bridge_powerup_runtime_carrier_discovery_v01.json');
const SCRIPT148_PATH = resolve('output', replayName, 'bridge_spawner_lifecycle_discovery_v01.json');
const OUTPUT_PATH = resolve('output', replayName, 'bridge_pvs_robust_lifecycle_discovery_v01.json');

for (const required of [replayPath, CONTRACT_PATH, SCRIPT147_PATH, SCRIPT148_PATH]) {
  if (!existsSync(required)) throw new Error(`Required input missing:\n${required}`);
}

const bridgeContractClaim = requireClaim('bridge_powerup_resource_contract', {
  requireSemantic: true,
  requireReplication: true,
});
const runtimeBridgeClaim = getClaim('runtime_bridge_buff_ownership');
if (runtimeBridgeClaim.authorityStatus !== 'missing') {
  throw new Error(
    'Script149 is discovery-only and expects runtime_bridge_buff_ownership to remain missing. '
    + `actual=${runtimeBridgeClaim.authorityStatus}`
  );
}

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
const script147 = JSON.parse(readFileSync(SCRIPT147_PATH, 'utf8'));
const script148 = JSON.parse(readFileSync(SCRIPT148_PATH, 'utf8'));

if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 contract not ready. status=${contract?.status}`);
}
if (script147?.version !== 'BRIDGE_POWERUP_RUNTIME_CARRIER_DISCOVERY_V01') {
  throw new Error(`Unexpected Script147 version: ${script147?.version}`);
}
if (script148?.version !== 'BRIDGE_SPAWNER_LIFECYCLE_DISCOVERY_V01') {
  throw new Error(`Unexpected Script148 version: ${script148?.version}`);
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
console.log('BRIDGE PVS-ROBUST LIFECYCLE DISCOVERY V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayPath}`);
console.log('CREATE policy:                  observation only (never automatic spawn)');
console.log('Spawn anchors:                  spawner UPDATE transitions + pickup active false->true');
console.log('Disappear candidates:           pickup active true->false UPDATE');
console.log('Collector control:              nearest player at event vs +30 s shifted time');
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
let entityMutations = 0;
let spawnerMutations = 0;
let pickupMutations = 0;
let lastSampleTick = null;

// Persistent-by-index state deliberately survives CREATE/PVS re-entry.
const spawnerStateByIndex = new Map();
const pickupStateByIndex = new Map();

const spawnerObservations = [];
const spawnerNextDropUpdates = [];
const spawnerActiveUpdates = [];
const pickupObservations = [];
const pickupActiveUpUpdates = [];
const pickupActiveDownUpdates = [];
const pickupInteractiveUpdates = [];
const playerSamples = [];

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;

    for (const event of events ?? []) {
      const entity = event?.entity;
      if (!entity) continue;
      entityMutations++;
      const className = entity?.class?.name ?? 'UNKNOWN_CLASS';

      if (className === 'CCitadelGameRulesProxy') {
        updateClockOffset(entity);
        continue;
      }
      if (className === 'CCitadel_PickupItemSpawner') {
        spawnerMutations++;
        processSpawner(event, entity, tick);
        continue;
      }
      if (className === 'CCitadel_Pickup_Modifier') {
        pickupMutations++;
        processPickup(event, entity, tick);
      }
    }
  }
);

parser.registerPostInterceptor(
  InterceptorStage.DEMO_PACKET,
  (demoPacket) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
    if (!Number.isFinite(tick) || tick < 0) return;
    if (lastSampleTick === tick) return;
    if (tick % SAMPLE_EVERY_TICKS !== 0) return;
    lastSampleTick = tick;
    const snapshot = samplePlayers(tick);
    if (snapshot.players.length > 0) playerSamples.push(snapshot);
  }
);

console.log('[parse] scanning PVS-robust bridge lifecycle...');
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

// ============================================================
// POST-PARSE
// ============================================================

const spawners = summarizeSpawners();
const pickupEventsWithSpawner = [
  ...pickupActiveUpUpdates.map(row => ({ ...row, kind: 'ACTIVE_FALSE_TO_TRUE_UPDATE' })),
  ...pickupActiveDownUpdates.map(row => ({ ...row, kind: 'ACTIVE_TRUE_TO_FALSE_UPDATE' })),
].map(row => attachNearestSpawner(row, spawners));

const activeUps = pickupEventsWithSpawner.filter(row => row.kind === 'ACTIVE_FALSE_TO_TRUE_UPDATE');
const activeDowns = pickupEventsWithSpawner.filter(row => row.kind === 'ACTIVE_TRUE_TO_FALSE_UPDATE');

const spawnAnchors = buildSpawnerSpawnAnchors(spawners);
const associatedSpawnAnchors = associateSpawnAnchorsToPickups(spawnAnchors, activeUps, pickupObservations, spawners);
const perSpawnerSequence = summarizePerSpawnerSequence(associatedSpawnAnchors, spawners);
const nextDropCadence = summarizeNextDropCadence(spawners);
const collectorGeometry = activeDowns.map(row => attachCollectorGeometry(row));
const collectorSummary = summarizeCollectorGeometry(collectorGeometry);
const disappearanceTiming = summarizeDisappearanceTiming(collectorGeometry, spawnAnchors);

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
  script147CarrierReady: check(
    script147?.status,
    'carrier discovery completed',
    String(script147?.status ?? '').includes('FOUND') || String(script147?.status ?? '').includes('READY')
  ),
  script148Ready: check(
    script148?.status,
    'BRIDGE_SPAWNER_LIFECYCLE_V01_READY_FOR_INTERPRETATION',
    script148?.status === 'BRIDGE_SPAWNER_LIFECYCLE_V01_READY_FOR_INTERPRETATION'
  ),
  allFourBridgePowerupsExpected: check(bridgePowerups.length, 4, bridgePowerups.length === 4),
  exactlyTwoSpawnerIndexes: check(spawners.length, 2, spawners.length === 2),
  spawnerUpdatesObserved: check(
    spawnerNextDropUpdates.length + spawnerActiveUpdates.length,
    '>0',
    spawnerNextDropUpdates.length + spawnerActiveUpdates.length > 0
  ),
  pickupActiveTransitionsObserved: check(
    activeUps.length + activeDowns.length,
    '>0',
    activeUps.length + activeDowns.length > 0
  ),
  playerSamplesObserved: check(playerSamples.length, '>0', playerSamples.length > 0),
};
const integrityPass = Object.values(checks).every(row => row.pass);

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  replay: replayName,
  replayPath,
  status: integrityPass
    ? 'BRIDGE_PVS_ROBUST_LIFECYCLE_V01_READY_FOR_INTERPRETATION'
    : 'BRIDGE_PVS_ROBUST_LIFECYCLE_V01_REQUIRES_DIAGNOSIS',
  methodologicalCorrection: {
    script148CreateActiveWasNotSemanticSpawn: true,
    reason: 'Repeated CREATE operations on the same two spawner indexes demonstrate PVS/network re-entry. CREATE is retained only as state observation.',
  },
  counts: {
    entityMutations,
    spawnerMutations,
    pickupMutations,
    playerSamples: playerSamples.length,
    spawnerIndexes: spawners.length,
    spawnerNextDropUpdateTransitions: spawnerNextDropUpdates.length,
    spawnerActiveUpdateTransitions: spawnerActiveUpdates.length,
    pickupActiveFalseToTrueUpdates: activeUps.length,
    pickupActiveTrueToFalseUpdates: activeDowns.length,
  },
  spawners,
  nextDropCadence,
  spawnAnchors: associatedSpawnAnchors,
  perSpawnerSequence,
  activeDownEvents: collectorGeometry,
  collectorSummary,
  disappearanceTiming,
  integrityValidation: checks,
};

mkdirSync(resolve('output', replayName), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
printSummary(output);

// ============================================================
// PROCESSING
// ============================================================

function processSpawner(event, entity, tick) {
  const entityIndex = getEntityIndex(entity);
  if (entityIndex === null) return;
  let state = spawnerStateByIndex.get(entityIndex);
  if (!state) {
    state = {
      entityIndex,
      firstTick: tick,
      lastTick: tick,
      firstPosition: null,
      lastPosition: null,
      lastActive: undefined,
      lastNextDrop: undefined,
      createObservations: 0,
      updateObservations: 0,
      leaveObservations: 0,
      deleteObservations: 0,
      activeUpdates: [],
      nextDropUpdates: [],
      nextDropObservedValues: [],
    };
    spawnerStateByIndex.set(entityIndex, state);
  }
  state.lastTick = tick;

  const operation = operationName(event.operation);
  if (event.operation === EntityOperation.CREATE) state.createObservations++;
  if (event.operation === EntityOperation.UPDATE) state.updateObservations++;
  if (event.operation === EntityOperation.LEAVE) state.leaveObservations++;
  if (event.operation === EntityOperation.DELETE) state.deleteObservations++;

  const position = getPosition(entity);
  if (hasWorldPosition(position)) {
    state.firstPosition ??= position.world;
    state.lastPosition = position.world;
  }

  if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) return;

  const active = safeGetField(entity, 'm_bPowerupActive');
  const nextDrop = safeGetField(entity, 'm_tNextDropTime');

  spawnerObservations.push({
    tick,
    matchTimeSeconds: toMatchTime(tick),
    operation,
    entityIndex,
    position: state.lastPosition,
    m_bPowerupActive: safeValue(active),
    m_tNextDropTime: safeValue(nextDrop),
  });

  if (Number.isFinite(nextDrop)) {
    const lastObserved = state.nextDropObservedValues.at(-1);
    if (!lastObserved || lastObserved.value !== nextDrop) {
      state.nextDropObservedValues.push({ tick, operation, value: nextDrop });
    }
  }

  // CREATE may refresh the persistent observed state, but is never counted as
  // a transition. Only UPDATE creates a semantic transition candidate.
  if (event.operation === EntityOperation.UPDATE) {
    if (typeof active === 'boolean' && typeof state.lastActive === 'boolean' && active !== state.lastActive) {
      const row = transitionRow(tick, entityIndex, 'm_bPowerupActive', state.lastActive, active);
      state.activeUpdates.push(row);
      spawnerActiveUpdates.push(row);
    }
    if (Number.isFinite(nextDrop) && Number.isFinite(state.lastNextDrop) && nextDrop !== state.lastNextDrop) {
      const row = {
        ...transitionRow(tick, entityIndex, 'm_tNextDropTime', state.lastNextDrop, nextDrop),
        deltaGameTime: nextDrop - state.lastNextDrop,
        priorScheduledMatchTimeSeconds: state.lastNextDrop - (matchClockOffsetSeconds ?? 0),
        nextScheduledMatchTimeSeconds: nextDrop - (matchClockOffsetSeconds ?? 0),
      };
      state.nextDropUpdates.push(row);
      spawnerNextDropUpdates.push(row);
    }
  }

  if (typeof active === 'boolean') state.lastActive = active;
  if (Number.isFinite(nextDrop)) state.lastNextDrop = nextDrop;
}

function processPickup(event, entity, tick) {
  const entityIndex = getEntityIndex(entity);
  if (entityIndex === null) return;
  let state = pickupStateByIndex.get(entityIndex);
  if (!state) {
    state = {
      entityIndex,
      lastTick: tick,
      lastRecordId: null,
      lastRecordKey: null,
      lastActive: undefined,
      lastInteractive: undefined,
      lastPosition: null,
      createObservations: 0,
    };
    pickupStateByIndex.set(entityIndex, state);
  }
  state.lastTick = tick;
  if (event.operation === EntityOperation.CREATE) state.createObservations++;

  const recordId = normalizeUint32(safeGetField(entity, 'm_nSubclassID'));
  const identity = recordId === null ? null : bridgeByRecordId.get(recordId) ?? null;
  const position = getPosition(entity);
  if (hasWorldPosition(position)) state.lastPosition = position.world;

  if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) return;

  const active = safeGetField(entity, 'm_bActive');
  const interactive = safeGetField(entity, 'm_bInteractive');

  if (identity) {
    pickupObservations.push({
      tick,
      matchTimeSeconds: toMatchTime(tick),
      operation: operationName(event.operation),
      entityIndex,
      recordId,
      recordKey: identity.recordKey,
      position: state.lastPosition,
      active: safeValue(active),
      interactive: safeValue(interactive),
    });
  }

  if (event.operation === EntityOperation.UPDATE && identity) {
    if (typeof active === 'boolean' && typeof state.lastActive === 'boolean' && active !== state.lastActive) {
      const row = {
        ...transitionRow(tick, entityIndex, 'm_bActive', state.lastActive, active),
        recordId,
        recordKey: identity.recordKey,
        position: state.lastPosition,
        interactive: safeValue(interactive),
      };
      if (state.lastActive === false && active === true) pickupActiveUpUpdates.push(row);
      if (state.lastActive === true && active === false) pickupActiveDownUpdates.push(row);
    }
    if (
      typeof interactive === 'boolean'
      && typeof state.lastInteractive === 'boolean'
      && interactive !== state.lastInteractive
    ) {
      pickupInteractiveUpdates.push({
        ...transitionRow(tick, entityIndex, 'm_bInteractive', state.lastInteractive, interactive),
        recordId,
        recordKey: identity.recordKey,
        position: state.lastPosition,
      });
    }
  }

  // Retain the latest observed state across CREATE/PVS re-entry.
  if (identity) {
    state.lastRecordId = recordId;
    state.lastRecordKey = identity.recordKey;
  }
  if (typeof active === 'boolean') state.lastActive = active;
  if (typeof interactive === 'boolean') state.lastInteractive = interactive;
}

function samplePlayers(tick) {
  const demo = parser.getDemo();
  const controllers = demo.getEntitiesByClassName('CCitadelPlayerController') ?? [];
  const players = [];

  for (const controller of controllers) {
    const playerName = safeGetField(controller, 'm_iszPlayerName');
    if (!playerName || playerName === 'SourceTV') continue;
    const steamId = safeValue(safeGetField(controller, 'm_steamID'));
    const heroId = safeGetField(controller, 'm_nHeroID');
    const alive = safeGetField(controller, 'm_bAlive');

    let pawnHandle = safeGetField(controller, 'm_hHeroPawn');
    if (!isValidHandleLike(pawnHandle)) pawnHandle = safeGetField(controller, 'm_hPawn');
    const pawn = resolveEntityHandle(demo, pawnHandle);
    if (!pawn) continue;
    const position = getPosition(pawn);
    if (!hasWorldPosition(position)) continue;

    players.push({
      controllerIndex: getEntityIndex(controller),
      pawnIndex: getEntityIndex(pawn),
      playerName,
      steamId,
      heroId,
      alive,
      position: position.world,
    });
  }

  return { tick, matchTimeSeconds: toMatchTime(tick), players };
}

// ============================================================
// SUMMARIES / ASSOCIATIONS
// ============================================================

function summarizeSpawners() {
  return [...spawnerStateByIndex.values()]
    .map(state => ({
      entityIndex: state.entityIndex,
      position: state.firstPosition ?? state.lastPosition,
      createObservations: state.createObservations,
      updateObservations: state.updateObservations,
      leaveObservations: state.leaveObservations,
      deleteObservations: state.deleteObservations,
      strongActiveUpdateTransitions: state.activeUpdates.length,
      strongNextDropUpdateTransitions: state.nextDropUpdates.length,
      activeUpdates: state.activeUpdates,
      nextDropUpdates: state.nextDropUpdates,
      nextDropObservedValues: state.nextDropObservedValues,
    }))
    .sort((a, b) => a.entityIndex - b.entityIndex);
}

function buildSpawnerSpawnAnchors(spawners) {
  const anchors = [];
  for (const spawner of spawners) {
    // A next-drop UPDATE is a strong timer-cycle anchor. The transition tick is
    // when the previous scheduled drop has just been consumed by the spawner.
    for (const row of spawner.nextDropUpdates) {
      anchors.push({
        tick: row.tick,
        matchTimeSeconds: row.matchTimeSeconds,
        matchClock: row.matchClock,
        spawnerIndex: spawner.entityIndex,
        spawnerPosition: spawner.position,
        anchorKind: 'NEXT_DROP_UPDATE',
        beforeNextDrop: row.before,
        afterNextDrop: row.after,
        deltaGameTime: row.deltaGameTime,
      });
    }
  }
  return dedupeAnchors(anchors).sort((a, b) => a.tick - b.tick || a.spawnerIndex - b.spawnerIndex);
}

function dedupeAnchors(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.spawnerIndex}:${row.tick}:${row.afterNextDrop}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function associateSpawnAnchorsToPickups(anchors, activeUps, observations, spawners) {
  return anchors.map(anchor => {
    const candidates = [];

    for (const event of activeUps) {
      if (event.spawnerIndex !== anchor.spawnerIndex) continue;
      const dt = Math.abs(event.tick - anchor.tick);
      if (dt <= SPAWN_ASSOCIATION_TICKS) {
        candidates.push({
          source: 'ACTIVE_FALSE_TO_TRUE_UPDATE',
          tick: event.tick,
          dtTicks: event.tick - anchor.tick,
          recordKey: event.recordKey,
          entityIndex: event.entityIndex,
          distanceToSpawnerHU: event.distanceToSpawnerHU,
          position: event.position,
        });
      }
    }

    // Fallback: CREATE/UPDATE observations may reveal identity at the anchor,
    // but they are evidence of observed state only, never standalone spawn proof.
    if (candidates.length === 0) {
      for (const obs of observations) {
        if (obs.active !== true) continue;
        const attached = attachNearestSpawner(obs, spawners);
        if (attached.spawnerIndex !== anchor.spawnerIndex) continue;
        const dt = Math.abs(obs.tick - anchor.tick);
        if (dt <= SPAWN_ASSOCIATION_TICKS) {
          candidates.push({
            source: 'ACTIVE_OBSERVATION_NEAR_NATIVE_ANCHOR',
            tick: obs.tick,
            dtTicks: obs.tick - anchor.tick,
            recordKey: obs.recordKey,
            entityIndex: obs.entityIndex,
            distanceToSpawnerHU: attached.distanceToSpawnerHU,
            position: obs.position,
          });
        }
      }
    }

    candidates.sort((a, b) => {
      const sourceRankA = a.source === 'ACTIVE_FALSE_TO_TRUE_UPDATE' ? 0 : 1;
      const sourceRankB = b.source === 'ACTIVE_FALSE_TO_TRUE_UPDATE' ? 0 : 1;
      return sourceRankA - sourceRankB
        || Math.abs(a.dtTicks) - Math.abs(b.dtTicks)
        || (a.distanceToSpawnerHU ?? Infinity) - (b.distanceToSpawnerHU ?? Infinity);
    });

    const uniqueByIdentity = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const key = `${candidate.recordKey}:${candidate.entityIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueByIdentity.push(candidate);
    }

    return {
      ...anchor,
      candidates: uniqueByIdentity,
      selectedCandidate: uniqueByIdentity[0] ?? null,
      candidateCount: uniqueByIdentity.length,
      ambiguous: uniqueByIdentity.length > 1,
    };
  });
}

function summarizePerSpawnerSequence(anchors, spawners) {
  return spawners.map(spawner => {
    const rows = anchors
      .filter(row => row.spawnerIndex === spawner.entityIndex)
      .filter(row => row.selectedCandidate)
      .sort((a, b) => a.tick - b.tick)
      .map(row => ({
        tick: row.tick,
        matchTimeSeconds: row.matchTimeSeconds,
        matchClock: row.matchClock,
        recordKey: row.selectedCandidate.recordKey,
        source: row.selectedCandidate.source,
        dtTicks: row.selectedCandidate.dtTicks,
        ambiguous: row.ambiguous,
      }));

    const transitionCounts = {};
    let repeats = 0;
    let changes = 0;
    for (let i = 1; i < rows.length; i++) {
      const from = rows[i - 1].recordKey;
      const to = rows[i].recordKey;
      const key = `${from} -> ${to}`;
      transitionCounts[key] = (transitionCounts[key] ?? 0) + 1;
      if (from === to) repeats++;
      else changes++;
    }

    const distinctTypes = [...new Set(rows.map(row => row.recordKey))].sort();
    return {
      spawnerIndex: spawner.entityIndex,
      position: spawner.position,
      resolvedAnchors: rows.length,
      distinctTypes,
      distinctTypeCount: distinctTypes.length,
      adjacentComparisons: Math.max(0, rows.length - 1),
      sameTypeRepeats: repeats,
      typeChanges: changes,
      strictNoImmediateRepeat: rows.length <= 1 ? null : repeats === 0,
      exactlyTwoTypesObserved: distinctTypes.length === 2,
      transitionCounts,
      sequence: rows,
    };
  });
}

function summarizeNextDropCadence(spawners) {
  return spawners.map(spawner => {
    const updates = spawner.nextDropUpdates;
    const deltas = updates
      .map(row => row.deltaGameTime)
      .filter(Number.isFinite);
    const frequency = frequencyTable(deltas.map(value => round(value, 3)));
    return {
      spawnerIndex: spawner.entityIndex,
      transitionCount: updates.length,
      deltaFrequency: frequency,
      medianDeltaGameTime: median(deltas),
      updates,
    };
  });
}

function attachCollectorGeometry(event) {
  const trueSnapshot = nearestPlayerSnapshot(event.tick);
  const placeboSnapshot = nearestPlayerSnapshot(event.tick + PLACEBO_SHIFT_TICKS);
  const trueGeometry = nearestPlayersToPosition(event.position, trueSnapshot);
  const placeboGeometry = nearestPlayersToPosition(event.position, placeboSnapshot);

  return {
    ...event,
    truePlayerSnapshotTick: trueSnapshot?.tick ?? null,
    truePlayerSnapshotGapTicks: trueSnapshot ? trueSnapshot.tick - event.tick : null,
    trueNearest: trueGeometry.nearest,
    trueSecondNearest: trueGeometry.secondNearest,
    trueNearestDistanceHU: trueGeometry.nearest?.distanceHU ?? null,
    trueSecondNearestDistanceHU: trueGeometry.secondNearest?.distanceHU ?? null,
    trueNearestDominanceHU:
      Number.isFinite(trueGeometry.nearest?.distanceHU) && Number.isFinite(trueGeometry.secondNearest?.distanceHU)
        ? trueGeometry.secondNearest.distanceHU - trueGeometry.nearest.distanceHU
        : null,
    placeboShiftSeconds: PLACEBO_SHIFT_TICKS / TICKS_PER_SECOND,
    placeboPlayerSnapshotTick: placeboSnapshot?.tick ?? null,
    placeboNearest: placeboGeometry.nearest,
    placeboNearestDistanceHU: placeboGeometry.nearest?.distanceHU ?? null,
  };
}

function summarizeCollectorGeometry(rows) {
  const thresholds = [100, 150, 200, 300, 500, 800];
  const trueDistances = rows.map(row => row.trueNearestDistanceHU).filter(Number.isFinite);
  const placeboDistances = rows.map(row => row.placeboNearestDistanceHU).filter(Number.isFinite);
  const byThreshold = thresholds.map(thresholdHU => ({
    thresholdHU,
    trueCount: trueDistances.filter(value => value <= thresholdHU).length,
    trueRate: rate(trueDistances.filter(value => value <= thresholdHU).length, trueDistances.length),
    placeboCount: placeboDistances.filter(value => value <= thresholdHU).length,
    placeboRate: rate(placeboDistances.filter(value => value <= thresholdHU).length, placeboDistances.length),
  }));

  const nearestPlayerCounts = {};
  for (const row of rows) {
    const name = row.trueNearest?.playerName;
    if (!name) continue;
    nearestPlayerCounts[name] = (nearestPlayerCounts[name] ?? 0) + 1;
  }

  return {
    events: rows.length,
    trueDistanceRows: trueDistances.length,
    placeboDistanceRows: placeboDistances.length,
    medianTrueNearestDistanceHU: median(trueDistances),
    medianPlaceboNearestDistanceHU: median(placeboDistances),
    thresholds: byThreshold,
    nearestPlayerCounts,
  };
}

function summarizeDisappearanceTiming(rows, spawnAnchors) {
  return rows.map(row => {
    const sameSpawnerAnchors = spawnAnchors
      .filter(anchor => anchor.spawnerIndex === row.spawnerIndex)
      .sort((a, b) => Math.abs(a.tick - row.tick) - Math.abs(b.tick - row.tick));
    const nearestAnchor = sameSpawnerAnchors[0] ?? null;
    return {
      tick: row.tick,
      matchClock: row.matchClock,
      spawnerIndex: row.spawnerIndex,
      recordKey: row.recordKey,
      nearestPlayer: row.trueNearest,
      nearestPlayerDistanceHU: row.trueNearestDistanceHU,
      nearestSpawnerAnchorTick: nearestAnchor?.tick ?? null,
      secondsFromNearestSpawnerAnchor: nearestAnchor
        ? (row.tick - nearestAnchor.tick) / TICKS_PER_SECOND
        : null,
    };
  });
}

function attachNearestSpawner(row, spawners) {
  if (!row?.position || spawners.length === 0) {
    return { ...row, spawnerIndex: null, distanceToSpawnerHU: null, spatiallyAssigned: false };
  }
  let best = null;
  for (const spawner of spawners) {
    if (!spawner.position) continue;
    const distanceHU = distance3(row.position, spawner.position);
    if (!best || distanceHU < best.distanceHU) best = { spawnerIndex: spawner.entityIndex, distanceHU };
  }
  return {
    ...row,
    spawnerIndex: best?.spawnerIndex ?? null,
    distanceToSpawnerHU: best?.distanceHU ?? null,
    spatiallyAssigned: Number.isFinite(best?.distanceHU) && best.distanceHU <= SPAWNER_ASSIGNMENT_MAX_HU,
  };
}

function nearestPlayerSnapshot(targetTick) {
  if (!Number.isFinite(targetTick) || playerSamples.length === 0) return null;
  let lo = 0;
  let hi = playerSamples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (playerSamples[mid].tick < targetTick) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [playerSamples[lo], playerSamples[lo - 1]].filter(Boolean);
  candidates.sort((a, b) => Math.abs(a.tick - targetTick) - Math.abs(b.tick - targetTick));
  const best = candidates[0] ?? null;
  if (!best) return null;
  return Math.abs(best.tick - targetTick) <= PLAYER_SAMPLE_MAX_GAP_TICKS ? best : null;
}

function nearestPlayersToPosition(position, snapshot) {
  if (!position || !snapshot) return { nearest: null, secondNearest: null };
  const rows = snapshot.players
    .filter(player => player.position)
    .map(player => ({ ...player, distanceHU: distance3(position, player.position) }))
    .sort((a, b) => a.distanceHU - b.distanceHU);
  return { nearest: rows[0] ?? null, secondNearest: rows[1] ?? null };
}

// ============================================================
// CLOCK / POSITION
// ============================================================

function updateClockOffset(rules) {
  if (Number.isFinite(matchClockOffsetSeconds)) return;
  const gameStart = safeGetField(rules, 'm_pGameRules.m_flGameStartTime');
  const stateStart = safeGetField(rules, 'm_pGameRules.m_flGameStateStartTime');
  if (Number.isFinite(gameStart) && Number.isFinite(stateStart)) {
    matchClockOffsetSeconds = gameStart - stateStart;
  }
}

function toMatchTime(tick) {
  if (!Number.isFinite(tick)) return null;
  const demoSeconds = tick / TICKS_PER_SECOND;
  return Number.isFinite(matchClockOffsetSeconds)
    ? demoSeconds - matchClockOffsetSeconds
    : null;
}

function getPosition(entity) {
  const cellX = safeGetField(entity, 'CBodyComponent.m_cellX');
  const cellY = safeGetField(entity, 'CBodyComponent.m_cellY');
  const cellZ = safeGetField(entity, 'CBodyComponent.m_cellZ');
  const vecX = safeGetField(entity, 'CBodyComponent.m_vecX');
  const vecY = safeGetField(entity, 'CBodyComponent.m_vecY');
  const vecZ = safeGetField(entity, 'CBodyComponent.m_vecZ');
  return {
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
  return Number.isFinite(position?.world?.x)
    && Number.isFinite(position?.world?.y)
    && Number.isFinite(position?.world?.z);
}

function distance3(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ============================================================
// HELPERS
// ============================================================

function transitionRow(tick, entityIndex, fieldName, before, after) {
  return {
    tick,
    matchTimeSeconds: toMatchTime(tick),
    matchClock: formatClock(toMatchTime(tick)),
    entityIndex,
    fieldName,
    before: safeValue(before),
    after: safeValue(after),
  };
}

function getEntityIndex(entity) {
  return Number.isInteger(entity?.index) ? entity.index : null;
}

function safeGetField(entity, name) {
  try {
    return entity?.getField?.(name);
  } catch {
    return undefined;
  }
}

function resolveEntityHandle(demo, handle) {
  if (!isValidHandleLike(handle)) return null;
  try {
    return demo.getEntityByHandle(handle) ?? null;
  } catch {
    return null;
  }
}

function isValidHandleLike(value) {
  return Number.isInteger(value) && value >= 0 && value !== INVALID_EHANDLE;
}

function normalizeUint32(value) {
  if (typeof value === 'bigint') return Number(BigInt.asUintN(32, value));
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) return value >>> 0;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    try { return Number(BigInt.asUintN(32, BigInt(value.trim()))); } catch { return null; }
  }
  return null;
}

function safeValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return null;
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return value.map(safeValue);
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = safeValue(item);
    return result;
  }
  return value;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const sign = seconds < 0 ? '-' : '';
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute - minutes * 60;
  return `${sign}${minutes}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function operationName(operation) {
  if (operation === EntityOperation.CREATE) return 'CREATE';
  if (operation === EntityOperation.UPDATE) return 'UPDATE';
  if (operation === EntityOperation.DELETE) return 'DELETE';
  if (operation === EntityOperation.LEAVE) return 'LEAVE';
  return String(operation);
}

function frequencyTable(values) {
  const counts = new Map();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || a.value - b.value);
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

// ============================================================
// PRINT
// ============================================================

function printSummary(result) {
  console.log('');
  console.log('========================================================');
  console.log('BRIDGE PVS-ROBUST LIFECYCLE RESULT');
  console.log('========================================================');
  console.log('');
  console.log(`status:                         ${result.status}`);
  console.log(`unique spawner indexes:         ${result.counts.spawnerIndexes}`);
  console.log(`spawner nextDrop UPDATEs:       ${result.counts.spawnerNextDropUpdateTransitions}`);
  console.log(`spawner active UPDATEs:         ${result.counts.spawnerActiveUpdateTransitions}`);
  console.log(`pickup active false->true:      ${result.counts.pickupActiveFalseToTrueUpdates}`);
  console.log(`pickup active true->false:      ${result.counts.pickupActiveTrueToFalseUpdates}`);
  console.log(`player snapshots:               ${result.counts.playerSamples}`);
  console.log('');

  console.log('SPAWNER CADENCE');
  console.log('---------------');
  for (const row of result.nextDropCadence) {
    const top = row.deltaFrequency.slice(0, 5).map(item => `${item.value}s×${item.count}`).join(', ');
    console.log(`spawner=${String(row.spawnerIndex).padStart(4)} transitions=${String(row.transitionCount).padStart(3)} medianDelta=${fmt(row.medianDeltaGameTime)} top=[${top}]`);
  }
  console.log('');

  console.log('PVS-ROBUST PER-SPAWNER SEQUENCE');
  console.log('-------------------------------');
  for (const row of result.perSpawnerSequence) {
    console.log(`spawner=${row.spawnerIndex} resolved=${row.resolvedAnchors} types=${row.distinctTypeCount} repeats=${row.sameTypeRepeats} noImmediateRepeat=${row.strictNoImmediateRepeat}`);
    for (const item of row.sequence) {
      console.log(`  ${String(item.matchClock ?? 'n/a').padEnd(10)} ${item.recordKey} source=${item.source} dt=${item.dtTicks}t ambiguous=${item.ambiguous}`);
    }
  }
  console.log('');

  console.log('COLLECTOR GEOMETRY');
  console.log('------------------');
  console.log(`disappear events:               ${result.collectorSummary.events}`);
  console.log(`median nearest true:            ${fmt(result.collectorSummary.medianTrueNearestDistanceHU)} HU`);
  console.log(`median nearest +30s placebo:    ${fmt(result.collectorSummary.medianPlaceboNearestDistanceHU)} HU`);
  for (const row of result.collectorSummary.thresholds) {
    console.log(`<=${String(row.thresholdHU).padStart(3)} HU  true=${pct(row.trueRate)} (${row.trueCount})  placebo=${pct(row.placeboRate)} (${row.placeboCount})`);
  }
  console.log('');

  console.log('DISAPPEARANCE EVENTS');
  console.log('--------------------');
  for (const row of result.activeDownEvents) {
    const player = row.trueNearest?.playerName ?? 'n/a';
    console.log(`${String(row.matchClock ?? 'n/a').padEnd(10)} spawner=${String(row.spawnerIndex ?? 'n/a').padStart(4)} ${String(row.recordKey).padEnd(28)} nearest=${String(player).padEnd(24)} dist=${fmt(row.trueNearestDistanceHU)}HU placebo=${fmt(row.placeboNearestDistanceHU)}HU`);
  }
  console.log('');

  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');
  for (const [name, row] of Object.entries(result.integrityValidation)) {
    console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
  }
  console.log('');
  console.log(`JSON:\n${OUTPUT_PATH}`);
  console.log('');
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}
