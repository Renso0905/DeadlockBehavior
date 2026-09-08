import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { once } from 'node:events';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
} from 'deadem';

import { getClaim, requireClaim } from '../src/contracts/claim-registry.mjs';
import {
  buildWeaponEffectContext,
  clipCapacityDiagnostic,
  compareObservedWeaponState,
  classifyReloadTransition,
  joinWeaponEventsToIntegratedState,
} from '../src/player-state/effective-weapon-substrate.mjs';

const VERSION = 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01';
const TICKS_PER_SECOND = 64;

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));

const PATHS = {
  integratedPlayerState: resolve('output', replayName, 'integrated_authoritative_player_state_substrate_v01.json'),
  itemEffects: resolve('output', 'cross_replay', 'standard_shop_item_effect_substrate_v03.json'),
  worldBuffContract: resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json'),
  shotTravelAudit: resolve('output', 'cross_replay', 'shot_travel_cross_replay_audit_v02.json'),
  output: resolve('output', replayName, 'effective_weapon_state_substrate_v01.json'),
  events: resolve('output', replayName, 'effective_weapon_runtime_events_v01.jsonl'),
};

for (const path of [replayPath, PATHS.integratedPlayerState, PATHS.itemEffects, PATHS.worldBuffContract]) {
  if (!existsSync(path)) throw new Error(`Required input missing:\n${path}`);
}

const playerStateClaim = requireClaim('player_state_t_v1', { requireSemantic: true, requireReplication: true });
const itemEffectClaim = requireClaim('shop_item_effect_contract', { requireSemantic: true });
const itemOwnershipClaim = requireClaim('runtime_item_ownership', { requireSemantic: true, requireReplication: true });
const permanentClaim = requireClaim('runtime_permanent_buff_ownership', { requireSemantic: true, requireReplication: true });
const bridgeClaim = requireClaim('runtime_bridge_buff_ownership', { requireSemantic: true, requireReplication: true });
const effectiveWeaponClaim = getClaim('effective_weapon_state');

const integrated = readJson(PATHS.integratedPlayerState);
const effectsArtifact = readJson(PATHS.itemEffects);
const worldBuffContract = readJson(PATHS.worldBuffContract);
const shotTravelAudit = readJsonIfExists(PATHS.shotTravelAudit);

if (integrated?.status !== 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION') {
  throw new Error(`Script158 artifact not ready for replay ${replayName}: ${integrated?.status}`);
}
if (effectsArtifact?.status !== 'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY') {
  throw new Error(`Script139 effect substrate not ready: ${effectsArtifact?.status}`);
}
if (worldBuffContract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 world-buff contract not ready: ${worldBuffContract?.status}`);
}

const playerArtifactByName = new Map((integrated.players ?? []).map(row => [row.playerKey, row]));
const playerByControllerIndex = new Map(
  (integrated.players ?? [])
    .filter(row => Number.isInteger(row?.identity?.controllerEntityIndex))
    .map(row => [row.identity.controllerEntityIndex, row.identity])
);
const effectsByKey = new Map((effectsArtifact.items ?? []).map(row => [row.recordKey, row]));

console.log('');
console.log('========================================================');
console.log('EFFECTIVE WEAPON STATE SUBSTRATE V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayPath}`);
console.log('PlayerState authority:          current / cross-replay replicated');
console.log('Observed weapon fields:         clip + reload + shot/cadence readiness telemetry');
console.log('Composition policy:             attach authoritative effect inputs; DO NOT apply unresolved formulas');
console.log('Projectile policy:              prior empirical travel models remain non-canonical inputs');
console.log('Promotion policy:               NO effective_weapon_state registry mutation');
console.log('');
console.log('[parse] recovering player-linked primary-weapon runtime state...');

const parser = new Parser();
const weaponStateByEntity = new Map();
const weaponMetadataByEntity = new Map();
const rawEventsByPlayer = new Map();
const observedFieldCounts = new Map();
const weaponClassCounts = new Map();
const weaponSubclassCounts = new Map();
const uniqueWeaponEntities = new Set();
const playerLinkedWeaponEntities = new Set();
const unlinkedWeaponEntities = new Set();

let candidateEntityEvents = 0;
let primaryWeaponEvents = 0;
let interestingWeaponUpdates = 0;
let dischargeEvents = 0;
let highConfidenceDischarges = 0;
let reloadTransitions = 0;

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = finite(demoPacket?.tick);
    if (tick === null) return;
    const demo = parser.getDemo();

    for (const event of events ?? []) {
      if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) continue;
      const entity = event.entity;
      if (!entity) continue;
      const className = getEntityClassName(entity);
      if (!isPrimaryWeaponCandidate(entity, className)) continue;
      candidateEntityEvents++;

      const entityIndex = getEntityIndex(entity);
      if (entityIndex === null) continue;
      primaryWeaponEvents++;
      uniqueWeaponEntities.add(entityIndex);
      increment(weaponClassCounts, className ?? 'UNKNOWN');

      const changes = safeChanges(event);
      const changedFields = Object.keys(changes).filter(isInterestingWeaponField);
      if (event.operation === EntityOperation.UPDATE && changedFields.length === 0) continue;
      interestingWeaponUpdates++;
      for (const field of changedFields) increment(observedFieldCounts, field);

      const current = readWeaponState(entity);
      if (current.subclassId !== null) increment(weaponSubclassCounts, String(current.subclassId));
      const previous = weaponStateByEntity.get(entityIndex) ?? null;
      const signal = compareObservedWeaponState(previous, current);
      const reloadTransition = classifyReloadTransition(previous, current);
      weaponStateByEntity.set(entityIndex, current);

      const identity = resolveWeaponPlayer({ demo, weaponEntity: entity });
      if (identity) playerLinkedWeaponEntities.add(entityIndex);
      else unlinkedWeaponEntities.add(entityIndex);

      if (!weaponMetadataByEntity.has(entityIndex)) {
        weaponMetadataByEntity.set(entityIndex, {
          weaponEntityIndex: entityIndex,
          className,
          subclassId: current.subclassId,
          player: identity,
        });
      } else if (identity) {
        const meta = weaponMetadataByEntity.get(entityIndex);
        meta.player = meta.player ?? identity;
        meta.subclassId = meta.subclassId ?? current.subclassId;
      }

      if (!identity?.playerName || !playerArtifactByName.has(identity.playerName)) continue;

      if (signal.actualDischargeSignal) {
        dischargeEvents++;
        if (signal.shotNumberDelta > 0 || (signal.lastAttackTimeAdvanced && signal.clipDelta < 0)) {
          highConfidenceDischarges++;
        }
      }
      if (reloadTransition) reloadTransitions++;

      const row = {
        tick,
        demoSeconds: tick / TICKS_PER_SECOND,
        playerKey: identity.playerName,
        heroId: identity.heroId ?? null,
        weaponEntityIndex: entityIndex,
        weaponClass: className,
        weaponSubclassId: current.subclassId,
        changedFields,
        observedWeaponState: current,
        transition: {
          ...signal,
          reloadTransition,
        },
      };
      if (!rawEventsByPlayer.has(identity.playerName)) rawEventsByPlayer.set(identity.playerName, []);
      rawEventsByPlayer.get(identity.playerName).push(row);
    }
  }
);

try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

console.log('[join] attaching authoritative PlayerState(t) context and effect-input signatures...');

mkdirSync(dirname(PATHS.events), { recursive: true });
const eventWriter = createWriteStream(PATHS.events, { encoding: 'utf8' });
const effectContextBySignature = new Map();
const effectContextRows = [];
const weaponRelevantItemKeys = new Set();
const readyDelayCandidates = [];
const shotSpacingTicks = [];
const lastDischargeTickByWeapon = new Map();
const perHero = new Map();
const reloadCounts = new Map();

let emittedEvents = 0;
let joinedEvents = 0;
let missingStateJoins = 0;
let unresolvedItemEffectRefs = 0;
let clipCapacityComparable = 0;
let clipCapacityWithin = 0;
let gunBridgeContextEvents = 0;
let permanentWeaponBuffContextEvents = 0;
let itemWeaponEffectContextEvents = 0;
let dischargeEventsWithReadyDelay = 0;
let dischargeEventsJoined = 0;

for (const [playerName, rawRows] of rawEventsByPlayer.entries()) {
  const playerArtifact = playerArtifactByName.get(playerName);
  if (!playerArtifact) continue;
  const joined = joinWeaponEventsToIntegratedState(rawRows, playerArtifact);

  for (const joinedRow of joined) {
    const playerState = joinedRow.integratedPlayerState;
    if (!playerState) {
      missingStateJoins++;
      continue;
    }
    joinedEvents++;

    const effectContext = buildWeaponEffectContext(playerState, effectsByKey);
    unresolvedItemEffectRefs += effectContext.unresolvedItemEffectRefs;
    for (const item of effectContext.itemInputs) weaponRelevantItemKeys.add(item.recordKey);
    if (effectContext.itemInputs.length > 0) itemWeaponEffectContextEvents++;
    if (Object.keys(effectContext.permanentWeaponBuffs).length > 0) permanentWeaponBuffContextEvents++;
    if (effectContext.gunBridge.length > 0) gunBridgeContextEvents++;

    const effectContextId = internEffectContext(effectContext);
    const capacity = clipCapacityDiagnostic(joinedRow.observedWeaponState, playerState);
    if (capacity.comparable) {
      clipCapacityComparable++;
      if (capacity.withinObservedCapacity) clipCapacityWithin++;
    }

    const isDischarge = joinedRow.transition.actualDischargeSignal === true;
    if (isDischarge) {
      dischargeEventsJoined++;
      const delay = joinedRow.transition.readyDelayCandidateSeconds;
      if (Number.isFinite(delay) && delay >= 0 && delay <= 5) {
        readyDelayCandidates.push(delay);
        dischargeEventsWithReadyDelay++;
      }
      const previousTick = lastDischargeTickByWeapon.get(joinedRow.weaponEntityIndex);
      if (Number.isFinite(previousTick) && joinedRow.tick > previousTick) {
        shotSpacingTicks.push(joinedRow.tick - previousTick);
      }
      lastDischargeTickByWeapon.set(joinedRow.weaponEntityIndex, joinedRow.tick);
    }

    if (joinedRow.transition.reloadTransition) increment(reloadCounts, joinedRow.transition.reloadTransition);
    summarizeHeroEvent(perHero, joinedRow, playerState, effectContext);

    const outputRow = {
      schemaVersion: 1,
      replay: replayName,
      tick: joinedRow.tick,
      demoSeconds: joinedRow.demoSeconds,
      playerKey: joinedRow.playerKey,
      heroId: playerState?.identity?.heroId ?? joinedRow.heroId ?? null,
      weaponEntityIndex: joinedRow.weaponEntityIndex,
      weaponClass: joinedRow.weaponClass,
      weaponSubclassId: joinedRow.weaponSubclassId,
      changedFields: joinedRow.changedFields,
      observedWeaponState: joinedRow.observedWeaponState,
      transition: joinedRow.transition,
      integratedStateTick: playerState.tick,
      observedPlayerWeaponContext: {
        level: playerState?.observedRuntime?.level ?? null,
        alive: playerState?.observedRuntime?.alive ?? null,
        maxAmmo: playerState?.observedRuntime?.maxAmmo ?? null,
      },
      effectContextId,
      clipCapacityDiagnostic: capacity,
      semanticStatus: 'OBSERVED_WEAPON_STATE_PLUS_AUTHORITATIVE_PLAYERSTATE_EFFECT_INPUTS_NOT_YET_COMPOSED',
    };

    if (!eventWriter.write(`${JSON.stringify(outputRow)}\n`)) await once(eventWriter, 'drain');
    emittedEvents++;
  }
}

eventWriter.end();
await once(eventWriter, 'finish');

const allWeaponRelevantEffects = (effectsArtifact.items ?? [])
  .filter(row => row?.weaponStateRelevant?.hasMechanicEffectEvidence)
  .map(compactWeaponEffectResource)
  .sort((a, b) => a.recordKey.localeCompare(b.recordKey));

const weaponPermanentFamilies = (worldBuffContract?.permanentPickups?.families ?? [])
  .filter(row => /(fire.?rate|ammo|clip|weapon.*damage|bullet)/i.test(String(row?.family ?? '')));
const gunBridgeResource = (worldBuffContract?.bridgePowerups?.powerups ?? [])
  .find(row => row?.recordKey === 'gun_powerup_pickup') ?? null;

const stateJoinRate = ratio(joinedEvents, joinedEvents + missingStateJoins);
const clipCapacityRate = ratio(clipCapacityWithin, clipCapacityComparable);
const readyDelayCoverage = ratio(dischargeEventsWithReadyDelay, dischargeEventsJoined);
const playerLinkedEntityRate = ratio(playerLinkedWeaponEntities.size, uniqueWeaponEntities.size);

const checks = {
  playerStateAuthorityCurrentReplicated: check(playerStateClaim.replicationStatus, 'cross_replay_replicated', playerStateClaim.authorityStatus === 'current' && playerStateClaim.semanticValidation === 'pass' && playerStateClaim.replicationStatus === 'cross_replay_replicated'),
  itemEffectsResourceAuthorityCurrent: check(itemEffectClaim.authorityStatus, 'current', itemEffectClaim.authorityStatus === 'current'),
  runtimeItemOwnershipReplicated: check(itemOwnershipClaim.replicationStatus, 'cross_replay_replicated', itemOwnershipClaim.replicationStatus === 'cross_replay_replicated'),
  runtimePermanentOwnershipReplicated: check(permanentClaim.replicationStatus, 'cross_replay_replicated', permanentClaim.replicationStatus === 'cross_replay_replicated'),
  runtimeBridgeOwnershipReplicated: check(bridgeClaim.replicationStatus, 'cross_replay_replicated', bridgeClaim.replicationStatus === 'cross_replay_replicated'),
  effectiveWeaponClaimStillMissing: check(effectiveWeaponClaim?.authorityStatus, 'missing', effectiveWeaponClaim?.authorityStatus === 'missing'),
  integratedReplayArtifactReady: check(integrated.status, 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION', integrated.status === 'INTEGRATED_AUTHORITATIVE_PLAYER_STATE_SUBSTRATE_V01_READY_FOR_VALIDATION'),
  primaryWeaponEntitiesObserved: check(uniqueWeaponEntities.size, '>=10', uniqueWeaponEntities.size >= 10),
  playerLinkedWeaponEntitiesObserved: check(playerLinkedWeaponEntities.size, '>=10', playerLinkedWeaponEntities.size >= 10),
  playerStateJoinStrong: check(stateJoinRate, '>=0.99', Number.isFinite(stateJoinRate) && stateJoinRate >= 0.99),
  observedDischargesSubstantial: check(dischargeEventsJoined, '>=100', dischargeEventsJoined >= 100),
  clipTelemetryObserved: check(observedFieldCounts.get('m_iClip') ?? 0, '>0', (observedFieldCounts.get('m_iClip') ?? 0) > 0),
  shotNumberTelemetryObserved: check(observedFieldCounts.get('m_nShotNumber') ?? 0, '>0', (observedFieldCounts.get('m_nShotNumber') ?? 0) > 0),
  lastAttackTelemetryObserved: check(observedFieldCounts.get('m_flLastAttackTime') ?? 0, '>0', (observedFieldCounts.get('m_flLastAttackTime') ?? 0) > 0),
  nextPrimaryTelemetryObserved: check(observedFieldCounts.get('m_flNextPrimaryAttack') ?? 0, '>0', (observedFieldCounts.get('m_flNextPrimaryAttack') ?? 0) > 0),
  reloadTelemetryObserved: check(reloadTransitions, '>0', reloadTransitions > 0),
  itemEffectReferencesResolve: check(unresolvedItemEffectRefs, 0, unresolvedItemEffectRefs === 0),
  weaponRelevantOwnedItemsObserved: check(weaponRelevantItemKeys.size, '>0', weaponRelevantItemKeys.size > 0),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION'
  : 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: {
    replayName,
    replayPath,
    ticksPerSecond: TICKS_PER_SECOND,
  },
  authorityFoundations: {
    playerState: summarizeClaim(playerStateClaim),
    itemEffects: summarizeClaim(itemEffectClaim),
    runtimeItemOwnership: summarizeClaim(itemOwnershipClaim),
    runtimePermanentBuffOwnership: summarizeClaim(permanentClaim),
    runtimeBridgeBuffOwnership: summarizeClaim(bridgeClaim),
  },
  stateModel: {
    observedRuntimeWeaponState:
      'Primary-weapon entity fields are retained directly: current clip/bonus clip/ammo fraction, reload state/times, shot number, continuous/burst counters, last/next attack timing, fired-recently and active fire mode.',
    playerStateJoin:
      'Each emitted weapon boundary is joined backward in time to the latest authoritative PlayerState(t) event; future PlayerState events are never used.',
    effectComposition:
      'Owned item effects, permanent weapon-relevant buffs, and active Gun bridge intervals are provenance-bearing INPUTS. Script161 does not choose stacking order or apply unresolved conditional/passive/active item semantics.',
    cadence:
      'nextPrimaryAttack-lastAttackTime is retained as an engine-ready-delay candidate diagnostic. It is not yet promoted as canonical effective fire interval until validated against discharge behavior and context changes.',
    projectile:
      'Script128/130 empirical shot-travel models remain prior timing evidence only. They are explicitly loadout-sensitive and are not treated as hero-fixed projectile velocity.',
  },
  counts: {
    candidateEntityEvents,
    primaryWeaponEvents,
    interestingWeaponUpdates,
    uniqueWeaponEntities: uniqueWeaponEntities.size,
    playerLinkedWeaponEntities: playerLinkedWeaponEntities.size,
    unlinkedWeaponEntities: unlinkedWeaponEntities.size,
    emittedWeaponEvents: emittedEvents,
    dischargeEvents,
    highConfidenceDischarges,
    dischargeEventsJoined,
    reloadTransitions,
    effectContextSignatures: effectContextRows.length,
    distinctWeaponRelevantOwnedItems: weaponRelevantItemKeys.size,
    itemWeaponEffectContextEvents,
    permanentWeaponBuffContextEvents,
    gunBridgeContextEvents,
  },
  diagnostics: {
    playerLinkedWeaponEntityRate: playerLinkedEntityRate,
    playerStateJoinRate: stateJoinRate,
    clipCapacityComparable,
    clipCapacityWithin,
    clipCapacityWithinRate: clipCapacityRate,
    dischargeReadyDelayCandidateCoverage: readyDelayCoverage,
    readyDelayCandidateSeconds: summarizeNumbers(readyDelayCandidates),
    observedInterDischargeTicksBehavioral: summarizeNumbers(shotSpacingTicks),
    observedInterDischargeSecondsBehavioral: summarizeNumbers(shotSpacingTicks.map(value => value / TICKS_PER_SECOND)),
    reloadTransitionCounts: mapToObject(reloadCounts),
    observedWeaponFieldCounts: mapToObject(observedFieldCounts),
    weaponClassCounts: mapToObject(weaponClassCounts),
    weaponSubclassCounts: mapToObject(weaponSubclassCounts),
  },
  effectContextSignatures: effectContextRows,
  resourceEffectInputs: {
    standardShopWeaponRelevantItems: allWeaponRelevantEffects,
    permanentWeaponRelevantFamilies: weaponPermanentFamilies,
    gunBridgePowerup: gunBridgeResource,
    heroProfiles: integrated?.resourceEffectInputs?.heroProfiles ?? [],
  },
  projectileTimingPrior: shotTravelAudit
    ? {
        source: PATHS.shotTravelAudit,
        status: shotTravelAudit.status ?? null,
        classificationCounts: shotTravelAudit.classificationCounts ?? null,
        semanticLimit: 'PRIOR_EMPIRICAL_TIMING_STRUCTURE_NOT_EFFECTIVE_PROJECTILE_VELOCITY',
      }
    : {
        source: PATHS.shotTravelAudit,
        status: 'NOT_PRESENT_FOR_SCRIPT161',
        semanticLimit: 'OPTIONAL_INPUT_ONLY',
      },
  byHero: [...perHero.values()].sort((a, b) => b.events - a.events || Number(a.heroId ?? 0) - Number(b.heroId ?? 0)),
  integrityValidation: checks,
  interpretation: {
    supported:
      'Direct primary-weapon runtime state can be joined to current authoritative PlayerState(t), with active item/permanent/bridge weapon-effect inputs attached without inventing composition semantics.',
    notYetSupported:
      'No canonical fire-rate formula, reload formula, projectile velocity, weapon damage, item stacking order, or conditional modifier activation is established by Script161.',
    next:
      'Validate ammo/reload/cadence candidates against observed runtime transitions, especially max-ammo changes, reload completion, and next-primary-attack timing under stable versus changing loadout/buff contexts.',
  },
  outputs: {
    summary: PATHS.output,
    events: PATHS.events,
  },
};

mkdirSync(dirname(PATHS.output), { recursive: true });
writeFileSync(PATHS.output, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('EFFECTIVE WEAPON STATE SUBSTRATE RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                         ${status}`);
console.log(`weapon entities:                ${uniqueWeaponEntities.size}`);
console.log(`player-linked weapon entities:  ${playerLinkedWeaponEntities.size}`);
console.log(`weapon events emitted:          ${emittedEvents}`);
console.log(`discharge events joined:        ${dischargeEventsJoined}`);
console.log(`reload transitions:             ${reloadTransitions}`);
console.log(`PlayerState join rate:          ${formatPercent(stateJoinRate)}`);
console.log(`clip <= observed capacity:      ${clipCapacityWithin}/${clipCapacityComparable} (${formatPercent(clipCapacityRate)})`);
console.log(`ready-delay candidate coverage: ${dischargeEventsWithReadyDelay}/${dischargeEventsJoined} (${formatPercent(readyDelayCoverage)})`);
console.log(`ready-delay candidate median:   ${formatNumber(summarizeNumbers(readyDelayCandidates).median)}s`);
console.log(`weapon-relevant owned items:    ${weaponRelevantItemKeys.size}`);
console.log(`effect-context signatures:      ${effectContextRows.length}`);
console.log(`Gun bridge context events:      ${gunBridgeContextEvents}`);
console.log('');
console.log('INTEGRITY VALIDATION');
console.log('--------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(48)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${PATHS.output}`);
console.log('');
console.log(`Events:\n${PATHS.events}`);
console.log('');

function internEffectContext(context) {
  const signatureObject = {
    heroId: context.heroId,
    itemInputs: context.itemInputs,
    permanentWeaponBuffs: context.permanentWeaponBuffs,
    gunBridge: context.gunBridge,
  };
  const signature = JSON.stringify(signatureObject);
  const existing = effectContextBySignature.get(signature);
  if (existing) return existing;
  const id = `weapon-context-${effectContextRows.length + 1}`;
  effectContextBySignature.set(signature, id);
  effectContextRows.push({ id, ...signatureObject, heroProfileRef: context.heroProfileRef });
  return id;
}

function summarizeHeroEvent(map, row, playerState, context) {
  const heroId = playerState?.identity?.heroId ?? row.heroId ?? null;
  const key = String(heroId ?? 'UNKNOWN');
  if (!map.has(key)) {
    map.set(key, {
      heroId,
      events: 0,
      discharges: 0,
      reloadTransitions: 0,
      readyDelayCandidates: 0,
      weaponRelevantItemContextEvents: 0,
      permanentWeaponBuffContextEvents: 0,
      gunBridgeContextEvents: 0,
    });
  }
  const out = map.get(key);
  out.events++;
  if (row.transition.actualDischargeSignal) out.discharges++;
  if (row.transition.reloadTransition) out.reloadTransitions++;
  if (Number.isFinite(row.transition.readyDelayCandidateSeconds)) out.readyDelayCandidates++;
  if (context.itemInputs.length > 0) out.weaponRelevantItemContextEvents++;
  if (Object.keys(context.permanentWeaponBuffs).length > 0) out.permanentWeaponBuffContextEvents++;
  if (context.gunBridge.length > 0) out.gunBridgeContextEvents++;
}

function isPrimaryWeaponCandidate(entity, className) {
  if (/PrimaryWeapon/i.test(className ?? '')) return true;
  return hasField(entity, 'm_nShotNumber') && hasField(entity, 'm_flLastAttackTime') && hasField(entity, 'm_iClip');
}

function readWeaponState(entity) {
  return {
    subclassId: finite(safeGetField(entity, 'm_nSubclassID')),
    clip: finite(safeGetField(entity, 'm_iClip')),
    bonusClip: finite(safeGetField(entity, 'm_iBonusClip')),
    ammoFraction: finite(safeGetField(entity, 'm_flAmmoFrac')),
    inReload: booleanOrNull(safeGetField(entity, 'm_bInReload')),
    shotNumber: finite(safeGetField(entity, 'm_nShotNumber')),
    continuousShots: finite(safeGetField(entity, 'm_nNumContinuousShots')),
    burstShotsRemaining: finite(safeGetField(entity, 'm_nBurstShotsRemaining')),
    lastAttackTime: finite(safeGetField(entity, 'm_flLastAttackTime')),
    nextPrimaryAttack: finite(safeGetField(entity, 'm_flNextPrimaryAttack')),
    nextAttackDelayStart: finite(safeGetField(entity, 'm_flNextAttackDelayStartTime')),
    nextAttackDelayEnd: finite(safeGetField(entity, 'm_flNextAttackDelayEndTime')),
    reloadAvailableTime: finite(safeGetField(entity, 'm_flReloadAvailableTime')),
    lastReloadStartTime: finite(safeGetField(entity, 'm_flLastReloadStartTime')),
    reloadQueuedStartTime: finite(safeGetField(entity, 'm_reloadQueuedStartTime')),
    firedRecently: booleanOrNull(safeGetField(entity, 'm_bFiredRecently')),
    activeFireMode: finite(safeGetField(entity, 'm_eActiveFireMode')),
  };
}

function isInterestingWeaponField(fieldName) {
  return /(^|\.)(m_nSubclassID|m_iClip|m_iBonusClip|m_flAmmoFrac|m_bInReload|m_nShotNumber|m_nNumContinuousShots|m_nBurstShotsRemaining|m_flLastAttackTime|m_flNextPrimaryAttack|m_flNextAttackDelayStartTime|m_flNextAttackDelayEndTime|m_flReloadAvailableTime|m_flLastReloadStartTime|m_reloadQueuedStartTime|m_bFiredRecently|m_eActiveFireMode)$/.test(fieldName);
}

function resolveWeaponPlayer({ demo, weaponEntity }) {
  const ownerHandle = firstFinite([safeGetField(weaponEntity, 'm_hOwnerEntity'), safeGetField(weaponEntity, 'm_hOwner')]);
  if (ownerHandle === null) return null;
  let owner = resolveHandle(demo, ownerHandle);
  for (let depth = 0; depth < 4 && owner; depth++) {
    const identity = resolveIdentityFromEntity(demo, owner);
    if (identity) return identity;
    const nextHandle = firstFinite([safeGetField(owner, 'm_hOwnerEntity'), safeGetField(owner, 'm_hOwner')]);
    if (nextHandle === null) break;
    owner = resolveHandle(demo, nextHandle);
  }
  return null;
}

function resolveIdentityFromEntity(demo, entity) {
  const index = getEntityIndex(entity);
  if (index !== null && playerByControllerIndex.has(index)) return playerByControllerIndex.get(index);
  if (getEntityClassName(entity) === 'CCitadelPlayerPawn') {
    const handle = firstFinite([safeGetField(entity, 'm_hController'), safeGetField(entity, 'm_hDefaultController')]);
    const controller = handle === null ? null : resolveHandle(demo, handle);
    const controllerIndex = controller ? getEntityIndex(controller) : null;
    if (controllerIndex !== null && playerByControllerIndex.has(controllerIndex)) return playerByControllerIndex.get(controllerIndex);
    const name = controller ? scalarString(safeGetField(controller, 'm_iszPlayerName')) : null;
    if (name && playerArtifactByName.has(name)) return playerArtifactByName.get(name).identity;
  }
  return null;
}

function resolveHandle(demo, handle) {
  try { return demo.getEntityByHandle(handle) ?? null; } catch { return null; }
}

function getEntityClassName(entity) {
  return entity?.class?.name ?? entity?.className ?? entity?.constructor?.name ?? null;
}

function getEntityIndex(entity) {
  return Number.isInteger(entity?.index) ? entity.index : Number.isInteger(entity?.entityIndex) ? entity.entityIndex : null;
}

function hasField(entity, fieldName) {
  const value = safeGetField(entity, fieldName);
  return value !== undefined && value !== null;
}

function safeGetField(entity, fieldName) {
  try { return entity.getField(fieldName); } catch { return undefined; }
}

function safeChanges(event) {
  try { return event.getChanges() ?? {}; } catch { return {}; }
}

function finite(value) {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return Number.isFinite(value) ? value : null;
}

function firstFinite(values) {
  for (const value of values) {
    const n = finite(value);
    if (n !== null) return n;
  }
  return null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : value === 0 ? false : value === 1 ? true : null;
}

function scalarString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function compactWeaponEffectResource(row) {
  return {
    recordKey: row.recordKey,
    slot: row.slot ?? null,
    tier: row.tier ?? null,
    shopPrice: row.shopPrice ?? null,
    directProvidedStats: (row?.weaponStateRelevant?.directProvidedStats ?? []).map(stat => ({
      providedPropertyType: stat?.providedPropertyType ?? null,
      value: stat?.value ?? null,
      numericValue: Number.isFinite(stat?.numericValue) ? stat.numericValue : null,
    })),
    nonDirectModifierTokens: row?.weaponStateRelevant?.nonDirectModifierTokens ?? [],
    operationRelevant: Boolean(row?.weaponStateRelevant?.operation?.hasEffectEvidence),
    damageOrPowerRelevant: Boolean(row?.weaponStateRelevant?.damageOrPower?.hasEffectEvidence),
  };
}

function summarizeNumbers(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, min: null, p25: null, median: null, p75: null, max: null, mean: null };
  return {
    n: xs.length,
    min: xs[0],
    p25: quantile(xs, 0.25),
    median: quantile(xs, 0.5),
    p75: quantile(xs, 0.75),
    max: xs[xs.length - 1],
    mean: xs.reduce((sum, x) => sum + x, 0) / xs.length,
  };
}

function quantile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function ratio(a, b) { return b > 0 ? a / b : null; }
function increment(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }
function mapToObject(map) { return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))); }
function check(actual, expected, pass) { return { actual, expected, pass: Boolean(pass) }; }
function formatPercent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a'; }
function formatNumber(value) { return Number.isFinite(value) ? value.toFixed(4) : 'n/a'; }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function readJsonIfExists(path) { return existsSync(path) ? readJson(path) : null; }
function summarizeClaim(claim) {
  return {
    claimId: claim.claimId,
    authorityStatus: claim.authorityStatus,
    integrityValidation: claim.integrityValidation,
    semanticValidation: claim.semanticValidation,
    replicationStatus: claim.replicationStatus,
  };
}
