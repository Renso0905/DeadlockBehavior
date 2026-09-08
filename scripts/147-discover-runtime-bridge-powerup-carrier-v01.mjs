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
import { buildWorldBuffRuntimeSubclassMap } from '../src/resources/world-buff-runtime-subclass-map.mjs';

const VERSION = 'BRIDGE_POWERUP_RUNTIME_CARRIER_DISCOVERY_V01';
const TICKS_PER_SECOND = 64;
const CONTRACT_PATH = resolve('output', 'cross_replay', 'world_stat_buff_resource_contract_v02.json');
const MAX_RECURSIVE_DEPTH = 5;
const MAX_CONTAINER_CHILDREN = 256;

// ============================================================
// PURPOSE
//
// Script145/146 established m_vecStatViewerModifierValues as a strongly
// replicated runtime substrate for permanent world-buff accumulation. Across
// discovery + five independent replication replays, however, none of the four
// bridge-powerup compound subclass IDs appeared in that vector.
//
// Script147 therefore does NOT assume that bridge powerups use the permanent
// stat-viewer carrier. Instead it searches every decoded entity mutation for
// exact numeric serialization of three independently resource-defined identity
// forms for each of the four bridge powerups:
//
//   1) ENTITY_SUBCLASS_PATH: MurmurHash2(<recordKey>/<modifierClass>)
//   2) RECORD_KEY:           MurmurHash2(<recordKey>)
//   3) MODIFIER_CLASS:       MurmurHash2(<modifierClass>)
//
// Exact hits are carrier CANDIDATES only. For each hit we preserve class,
// field, entity, operation, time, owner chain, player attachment, and a bounded
// entity snapshot. Deterministic unrelated 32-bit token hashes are scanned as
// exact-match negative controls.
//
// A zero-hit result is also informative: it rejects direct numeric entity-field
// serialization of all three tested bridge identity forms in this replay. It
// does NOT prove bridge state is absent from replay telemetry; bridge state may
// be represented by handles, modifier masks, transient events, string-table
// indexes, or behavior that must be inferred from acquisition/expiration.
//
// This script is discovery only. It must not promote runtime_bridge_buff_ownership.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));
const OUTPUT_PATH = resolve('output', replayName, 'bridge_powerup_runtime_carrier_discovery_v01.json');

if (!existsSync(replayPath)) throw new Error(`Replay not found:\n${replayPath}`);
if (!existsSync(CONTRACT_PATH)) throw new Error(`Script136 V02 contract missing:\n${CONTRACT_PATH}`);

const bridgeContractClaim = requireClaim('bridge_powerup_resource_contract', {
  requireSemantic: true,
  requireReplication: true,
});
const unresolvedRuntimeClaim = getClaim('runtime_bridge_buff_ownership');
if (unresolvedRuntimeClaim.authorityStatus !== 'missing') {
  throw new Error(
    'Script147 is a discovery script and expects runtime_bridge_buff_ownership to remain missing. '
    + `actual=${unresolvedRuntimeClaim.authorityStatus}`
  );
}

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
  throw new Error(`Script136 V02 world-buff contract is not ready. status=${contract?.status}`);
}

const subclassMap = buildWorldBuffRuntimeSubclassMap(contract);
const bridgeCandidates = subclassMap.bridgeCandidates;
const identityUniverse = buildIdentityUniverse(bridgeCandidates);
const placeboUniverse = buildPlaceboUniverse(identityUniverse);
const allIdentityById = buildIdentityIndex([...identityUniverse, ...placeboUniverse]);
const identityCollisions = summarizeIdentityCollisions(allIdentityById);

console.log('');
console.log('========================================================');
console.log('BRIDGE POWERUP RUNTIME CARRIER DISCOVERY V0.1');
console.log('========================================================');
console.log('');
console.log(`Replay:                         ${replayPath}`);
console.log(`Resource contract:              ${CONTRACT_PATH}`);
console.log(`Bridge powerups:                ${bridgeCandidates.length}`);
console.log(`Primary compound IDs:           ${identityUniverse.filter(row => row.tokenKind === 'ENTITY_SUBCLASS_PATH').length}`);
console.log(`Secondary record IDs:           ${identityUniverse.filter(row => row.tokenKind === 'RECORD_KEY').length}`);
console.log(`Secondary modifier-class IDs:   ${identityUniverse.filter(row => row.tokenKind === 'MODIFIER_CLASS').length}`);
console.log(`Exact-match placebo IDs:        ${placeboUniverse.length}`);
console.log(`Identity collisions:            ${identityCollisions.length}`);
console.log('Entity filter:                   ALL decoded entity classes');
console.log('');

const parser = new Parser(
  new ParserConfiguration({ entityClasses: null }),
  Logger.CONSOLE_INFO
);

let matchClockOffsetSeconds = null;
let totalEntityMutationEvents = 0;
let scannedCreateEvents = 0;
let scannedUpdateEvents = 0;
let scalarValuesInspected = 0;
let numeric32ValuesInspected = 0;
let containersInspected = 0;
let containersTruncated = 0;
let binaryValuesSkipped = 0;
let createSnapshotsScanned = 0;
let controllerMutationEvents = 0;
let progressAt = 1_000_000;

const hits = [];
const hitByKey = new Map();
const controllerStates = new Map();
const controllerByPawnIndex = new Map();
const observedClasses = new Set();
const fieldsScanned = new Set();

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;

    for (const event of events ?? []) {
      const entity = event?.entity;
      if (!entity) continue;

      totalEntityMutationEvents++;
      if (totalEntityMutationEvents >= progressAt) {
        console.log(
          `[scan] entity mutations=${totalEntityMutationEvents.toLocaleString()} `
          + `numeric32=${numeric32ValuesInspected.toLocaleString()} `
          + `candidate hits=${hits.filter(row => row.control !== true).length} `
          + `controls=${hits.filter(row => row.control === true).length}`
        );
        progressAt += 1_000_000;
      }

      const className = entity?.class?.name ?? 'UNKNOWN_CLASS';
      observedClasses.add(className);

      if (className === 'CCitadelGameRulesProxy') {
        updateClockOffset(entity);
      }

      if (className === 'CCitadelPlayerController') {
        controllerMutationEvents++;
        refreshControllerIdentity(entity, tick);
      }

      if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) {
        continue;
      }

      if (event.operation === EntityOperation.CREATE) scannedCreateEvents++;
      if (event.operation === EntityOperation.UPDATE) scannedUpdateEvents++;

      const changes = safeChanges(event);
      const changedFields = Object.keys(changes);

      for (const [fieldName, value] of Object.entries(changes)) {
        fieldsScanned.add(`${className}.${fieldName}`);
        inspectValue({
          value,
          valuePath: fieldName,
          entity,
          className,
          operation: operationName(event.operation),
          tick,
          changedFields,
          scanSource: 'EVENT_CHANGE',
          depth: 0,
        });
      }

      // CREATE changes normally contain initial fields, but a full bounded
      // fieldEntries() scan protects against fields materialized in entity
      // state without appearing in event.getChanges(). Exact hit de-duplication
      // prevents double-counting the same field at the same tick.
      if (event.operation === EntityOperation.CREATE) {
        scanCreateSnapshot({ entity, className, tick, changedFields });
      }
    }
  }
);

console.log('[parse] starting full replay carrier scan...');
try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

hits.sort((a, b) =>
  (a.tick ?? 0) - (b.tick ?? 0)
  || a.className.localeCompare(b.className)
  || String(a.fieldName).localeCompare(String(b.fieldName))
);

const candidateHits = hits.filter(row => row.control !== true);
const controlHits = hits.filter(row => row.control === true);
const primaryHits = candidateHits.filter(row => row.tokenKind === 'ENTITY_SUBCLASS_PATH');
const recordHits = candidateHits.filter(row => row.tokenKind === 'RECORD_KEY');
const modifierClassHits = candidateHits.filter(row => row.tokenKind === 'MODIFIER_CLASS');
const statViewerBridgeHits = candidateHits.filter(row =>
  row.className === 'CCitadelPlayerController'
  && String(row.fieldName).startsWith('m_vecStatViewerModifierValues.')
);

const distinctCandidateSites = distinctSites(candidateHits);
const distinctControlSites = distinctSites(controlHits);
const powerupSummary = summarizeByPowerup(identityUniverse, candidateHits);
const classFieldSummary = summarizeClassFields(candidateHits);
const controlClassFieldSummary = summarizeClassFields(controlHits);

const status = primaryHits.length > 0
  ? 'BRIDGE_POWERUP_RUNTIME_CARRIER_V01_PRIMARY_SUBCLASS_CANDIDATES_FOUND'
  : (recordHits.length > 0 || modifierClassHits.length > 0)
      ? 'BRIDGE_POWERUP_RUNTIME_CARRIER_V01_SECONDARY_TOKEN_CANDIDATES_FOUND'
      : 'BRIDGE_POWERUP_RUNTIME_CARRIER_V01_NO_DIRECT_TOKEN_CARRIER_FOUND';

const checks = {
  registryBridgeResourceContractCurrent: check(
    bridgeContractClaim.authorityStatus,
    'current',
    bridgeContractClaim.authorityStatus === 'current'
  ),
  runtimeBridgeClaimStillMissing: check(
    unresolvedRuntimeClaim.authorityStatus,
    'missing',
    unresolvedRuntimeClaim.authorityStatus === 'missing'
  ),
  script136ContractReady: check(
    contract?.status,
    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',
    contract?.status === 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'
  ),
  bridgePowerupsExpected: check(bridgeCandidates.length, 4, bridgeCandidates.length === 4),
  primaryCompoundIdsExpected: check(
    identityUniverse.filter(row => row.tokenKind === 'ENTITY_SUBCLASS_PATH').length,
    4,
    identityUniverse.filter(row => row.tokenKind === 'ENTITY_SUBCLASS_PATH').length === 4
  ),
  candidateIdentityCollisionsAbsent: check(identityCollisions.length, 0, identityCollisions.length === 0),
  exactMatchControlsProduced: check(placeboUniverse.length, 12, placeboUniverse.length === 12),
  entityMutationsObserved: check(totalEntityMutationEvents, '>0', totalEntityMutationEvents > 0),
  createOrUpdateEventsScanned: check(
    scannedCreateEvents + scannedUpdateEvents,
    '>0',
    scannedCreateEvents + scannedUpdateEvents > 0
  ),
  numeric32ValuesInspected: check(numeric32ValuesInspected, '>0', numeric32ValuesInspected > 0),
};
const integrityPass = Object.values(checks).every(row => row.pass);

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  replay: replayName,
  replayPath,
  status,
  purpose: [
    'Locate the runtime carrier, if any, for the four resource-validated bridge powerup identities.',
    'Search exact compound subclass, record-key, and modifier-class hash forms without assuming m_vecStatViewerModifierValues.',
    'Preserve owner/player/timing context for every exact candidate hit.',
    'Use deterministic unrelated 32-bit exact-match hashes as negative controls.',
  ],
  foundations: {
    bridgePowerupResourceContract: bridgeContractClaim.claimId,
    resourceContractPath: CONTRACT_PATH,
    resourceContractStatus: contract.status,
    priorPermanentRuntimeAuthority: getClaim('runtime_permanent_buff_ownership').replicationStatus,
    priorNegativeObservation: 'Scripts145-146 observed zero bridge compound subclass IDs in CCitadelPlayerController.m_vecStatViewerModifierValues across discovery + five independent replication replays.',
  },
  searchPolicy: {
    entityClasses: 'ALL',
    operations: ['CREATE', 'UPDATE'],
    identityForms: [
      'MurmurHash2(<recordKey>/<modifierClass>, 0x31415926)',
      'MurmurHash2(<recordKey>, 0x31415926)',
      'MurmurHash2(<modifierClass>, 0x31415926)',
    ],
    signedInt32Normalization: 'Signed 32-bit numeric values are compared by identical uint32 bit pattern.',
    createSnapshotPolicy: 'Scan event changes plus bounded entity.fieldEntries() on CREATE; exact same tick/entity/field/id hits are deduplicated.',
    negativeControlPolicy: 'Twelve deterministic unrelated MurmurHash2 token IDs are scanned identically. Controls are diagnostics, not fitted thresholds.',
  },
  counts: {
    totalEntityMutationEvents,
    scannedCreateEvents,
    scannedUpdateEvents,
    observedEntityClasses: observedClasses.size,
    distinctClassFieldsScanned: fieldsScanned.size,
    scalarValuesInspected,
    numeric32ValuesInspected,
    containersInspected,
    containersTruncated,
    binaryValuesSkipped,
    createSnapshotsScanned,
    controllerMutationEvents,
    candidateExactHits: candidateHits.length,
    candidateDistinctSites: distinctCandidateSites.length,
    primaryCompoundHits: primaryHits.length,
    recordKeyHits: recordHits.length,
    modifierClassHits: modifierClassHits.length,
    statViewerBridgeHits: statViewerBridgeHits.length,
    controlExactHits: controlHits.length,
    controlDistinctSites: distinctControlSites.length,
  },
  identityUniverse,
  placeboUniverse,
  identityCollisions,
  powerupSummary,
  classFieldSummary,
  controlClassFieldSummary,
  candidateHits,
  controlHits,
  interpretation: {
    supported: primaryHits.length > 0
      ? 'At least one exact resource-defined bridge compound EntitySubclassID_t was serialized in replay entity telemetry. The hit locations are candidate runtime carriers that require lifecycle/acquisition/expiration validation before ownership semantics.'
      : (recordHits.length > 0 || modifierClassHits.length > 0)
          ? 'No compound bridge EntitySubclassID_t was observed, but at least one bridge record-key or modifier-class token was serialized. These are secondary carrier candidates requiring semantic validation.'
          : 'No exact numeric serialization of the tested bridge compound subclass, record-key, or modifier-class token forms was observed in this replay. This rejects those direct-token carrier hypotheses for the scanned entity fields but does not establish absence of bridge telemetry.',
    notClaimed: [
      'An exact token hit is not automatically bridge acquisition, ownership, activation, or expiration.',
      'Owner/entity attachment is not automatically causal acquisition attribution.',
      'The 160-second resource duration is not validated by this discovery script.',
      'A zero direct-token result does not exclude modifier masks, handles, events, string-table indexes, or indirectly observable state.',
      'runtime_bridge_buff_ownership remains missing until a separate semantic validation and independent replication succeed.',
    ],
    nextExperiment: primaryHits.length > 0 || recordHits.length > 0 || modifierClassHits.length > 0
      ? 'Freeze the discovered carrier field/class hypothesis and validate player acquisition plus ~160-second expiration against same-player lifecycle controls.'
      : 'Discover bridge pickup/spawner entities and align physical pickup acquisition timestamps with player pawn/controller field transitions to identify an indirect runtime state carrier.',
  },
  integrityValidation: {
    pass: integrityPass,
    checks,
  },
  semanticValidation: {
    status: 'DISCOVERY_ONLY_NOT_ESTABLISHED',
  },
  replicationStatus: 'DISCOVERY_REPLAY_ONLY',
};

mkdirSync(resolve('output', replayName), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('BRIDGE POWERUP RUNTIME CARRIER RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                         ${status}`);
console.log(`entity mutations:               ${totalEntityMutationEvents.toLocaleString()}`);
console.log(`numeric32 values inspected:     ${numeric32ValuesInspected.toLocaleString()}`);
console.log(`candidate exact hits:           ${candidateHits.length}`);
console.log(`candidate distinct sites:       ${distinctCandidateSites.length}`);
console.log(`primary compound hits:          ${primaryHits.length}`);
console.log(`record-key hits:                ${recordHits.length}`);
console.log(`modifier-class hits:            ${modifierClassHits.length}`);
console.log(`stat-viewer bridge hits:        ${statViewerBridgeHits.length}`);
console.log(`placebo exact hits:             ${controlHits.length}`);
console.log(`placebo distinct sites:         ${distinctControlSites.length}`);
console.log('');
console.log('POWERUP SUMMARY');
console.log('---------------');
for (const row of powerupSummary) {
  console.log(
    `${row.recordKey.padEnd(28)} `
    + `compound=${String(row.hitsByKind.ENTITY_SUBCLASS_PATH ?? 0).padStart(4)} `
    + `record=${String(row.hitsByKind.RECORD_KEY ?? 0).padStart(4)} `
    + `modifier=${String(row.hitsByKind.MODIFIER_CLASS ?? 0).padStart(4)} `
    + `sites=${String(row.distinctSites).padStart(3)}`
  );
}

if (classFieldSummary.length > 0) {
  console.log('');
  console.log('CANDIDATE CARRIER SITES');
  console.log('-----------------------');
  for (const row of classFieldSummary.slice(0, 30)) {
    console.log(
      `${row.className}.${row.fieldName} `
      + `hits=${row.hits} ids=${row.distinctIds} `
      + `kinds=${row.tokenKinds.join(',')}`
    );
  }
}

console.log('');
console.log('INTEGRITY VALIDATION');
console.log('--------------------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

// ============================================================
// SCANNING
// ============================================================

function inspectValue({
  value,
  valuePath,
  entity,
  className,
  operation,
  tick,
  changedFields,
  scanSource,
  depth,
}) {
  if (value === null || value === undefined) return;

  if (isBinary(value)) {
    binaryValuesSkipped++;
    return;
  }

  if (isScalar(value)) {
    scalarValuesInspected++;
    const uint32 = normalizeComparableUint32(value);
    if (uint32 === null) return;
    numeric32ValuesInspected++;
    const matches = allIdentityById.get(uint32);
    if (!matches?.length) return;

    for (const match of matches) {
      recordHit({
        match,
        observedValue: safeValue(value),
        uint32,
        fieldName: valuePath,
        entity,
        className,
        operation,
        tick,
        changedFields,
        scanSource,
      });
    }
    return;
  }

  if (depth >= MAX_RECURSIVE_DEPTH || typeof value !== 'object') return;
  containersInspected++;

  let entries;
  if (Array.isArray(value)) {
    entries = value.map((child, index) => [String(index), child]);
  } else {
    try {
      entries = Object.entries(value);
    } catch {
      return;
    }
  }

  if (entries.length > MAX_CONTAINER_CHILDREN) {
    containersTruncated++;
    entries = entries.slice(0, MAX_CONTAINER_CHILDREN);
  }

  for (const [childKey, child] of entries) {
    inspectValue({
      value: child,
      valuePath: `${valuePath}.${childKey}`,
      entity,
      className,
      operation,
      tick,
      changedFields,
      scanSource,
      depth: depth + 1,
    });
  }
}

function scanCreateSnapshot({ entity, className, tick, changedFields }) {
  if (typeof entity?.fieldEntries !== 'function') return;
  createSnapshotsScanned++;
  let entries;
  try {
    entries = [...entity.fieldEntries()];
  } catch {
    return;
  }

  for (const [fieldName, value] of entries) {
    fieldsScanned.add(`${className}.${fieldName}`);
    inspectValue({
      value,
      valuePath: fieldName,
      entity,
      className,
      operation: 'CREATE',
      tick,
      changedFields,
      scanSource: 'CREATE_SNAPSHOT',
      depth: 0,
    });
  }
}

function recordHit({
  match,
  observedValue,
  uint32,
  fieldName,
  entity,
  className,
  operation,
  tick,
  changedFields,
  scanSource,
}) {
  const entityIndex = getEntityIndex(entity);
  const key = [
    tick ?? 'na',
    entityIndex ?? 'na',
    className,
    fieldName,
    uint32,
    match.tokenKind,
    match.token,
  ].join('|');

  const existing = hitByKey.get(key);
  if (existing) {
    if (!existing.observedVia.includes(scanSource)) existing.observedVia.push(scanSource);
    return;
  }

  const ownerChain = buildOwnerChain(entity, 4);
  const attachedPlayer = resolvePlayerAttachment(entity, ownerChain);
  const hit = {
    control: match.control === true,
    tokenKind: match.tokenKind,
    token: match.token,
    tokenId: match.tokenId,
    recordKey: match.recordKey ?? null,
    modifierClass: match.modifierClass ?? null,
    buffClass: match.buffClass ?? null,
    observedValue,
    observedUint32: uint32,
    tick,
    demoTimeSeconds: Number.isFinite(tick) ? tick / TICKS_PER_SECOND : null,
    matchTimeSeconds: Number.isFinite(tick) && Number.isFinite(matchClockOffsetSeconds)
      ? tick / TICKS_PER_SECOND - matchClockOffsetSeconds
      : null,
    matchClock: Number.isFinite(tick) && Number.isFinite(matchClockOffsetSeconds)
      ? formatClock(tick / TICKS_PER_SECOND - matchClockOffsetSeconds)
      : null,
    operation,
    className,
    entityIndex,
    fieldName,
    observedVia: [scanSource],
    changedFields: [...new Set(changedFields)].slice(0, 100),
    entityContext: snapshotInterestingEntityFields(entity),
    ownerChain,
    attachedPlayer,
  };

  hitByKey.set(key, hit);
  hits.push(hit);
}

// ============================================================
// IDENTITY UNIVERSE
// ============================================================

function buildIdentityUniverse(candidates) {
  return candidates.flatMap(candidate => [
    {
      control: false,
      buffClass: 'BRIDGE_POWERUP',
      tokenKind: 'ENTITY_SUBCLASS_PATH',
      token: candidate.token,
      tokenId: candidate.sourceId,
      recordKey: candidate.recordKey,
      modifierClass: candidate.modifierClass,
      durationSeconds: candidate.durationSeconds,
    },
    {
      control: false,
      buffClass: 'BRIDGE_POWERUP',
      tokenKind: 'RECORD_KEY',
      token: candidate.recordKey,
      tokenId: murmurHash2(candidate.recordKey),
      recordKey: candidate.recordKey,
      modifierClass: candidate.modifierClass,
      durationSeconds: candidate.durationSeconds,
    },
    {
      control: false,
      buffClass: 'BRIDGE_POWERUP',
      tokenKind: 'MODIFIER_CLASS',
      token: candidate.modifierClass,
      tokenId: murmurHash2(candidate.modifierClass),
      recordKey: candidate.recordKey,
      modifierClass: candidate.modifierClass,
      durationSeconds: candidate.durationSeconds,
    },
  ]);
}

function buildPlaceboUniverse(candidateRows) {
  const occupied = new Set(candidateRows.map(row => row.tokenId));
  const controls = [];
  let i = 0;
  while (controls.length < 12) {
    const token = `deadlockbehavior_bridge_runtime_placebo_${String(i).padStart(2, '0')}`;
    const tokenId = murmurHash2(token);
    i++;
    if (occupied.has(tokenId) || controls.some(row => row.tokenId === tokenId)) continue;
    controls.push({
      control: true,
      buffClass: 'NEGATIVE_CONTROL',
      tokenKind: 'PLACEBO_CONTROL',
      token,
      tokenId,
      recordKey: null,
      modifierClass: null,
      durationSeconds: null,
    });
  }
  return controls;
}

function buildIdentityIndex(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.tokenId)) byId.set(row.tokenId, []);
    byId.get(row.tokenId).push(row);
  }
  return byId;
}

function summarizeIdentityCollisions(byId) {
  return [...byId.entries()]
    .filter(([, rows]) => new Set(rows.map(row => `${row.tokenKind}:${row.token}`)).size > 1)
    .map(([tokenId, rows]) => ({
      tokenId,
      identities: rows.map(row => ({ tokenKind: row.tokenKind, token: row.token, control: row.control })),
    }));
}

// ============================================================
// PLAYER / OWNER CONTEXT
// ============================================================

function refreshControllerIdentity(entity, tick) {
  const controllerEntityIndex = getEntityIndex(entity);
  if (controllerEntityIndex === null) return;

  const prior = controllerStates.get(controllerEntityIndex) ?? {
    controllerEntityIndex,
    playerName: null,
    steamId: null,
    heroId: null,
    team: null,
    pawnEntityIndex: null,
    lastTick: null,
  };

  const playerName = firstField(entity, ['m_iszPlayerName', 'm_sPlayerName', 'm_playerName', 'm_strPlayerName']);
  const steamId = firstField(entity, ['m_steamID', 'm_steamId']);
  const heroId = firstField(entity, ['m_nHeroID', 'm_nHeroId', 'm_eHeroID', 'm_iHeroID']);
  const team = safeGetField(entity, 'm_iTeamNum');
  const pawnHandle = firstField(entity, ['m_hHeroPawn', 'm_hPawn', 'm_hPlayerPawn', 'm_hAssignedHero']);
  const pawnEntity = safeResolveEntityHandle(pawnHandle);
  const pawnEntityIndex = getEntityIndex(pawnEntity);

  if (playerName !== null) prior.playerName = String(playerName);
  if (steamId !== null) prior.steamId = safeValue(steamId);
  if (heroId !== null) prior.heroId = safeValue(heroId);
  if (team !== null && team !== undefined) prior.team = safeValue(team);
  if (pawnEntityIndex !== null) {
    prior.pawnEntityIndex = pawnEntityIndex;
    controllerByPawnIndex.set(pawnEntityIndex, controllerEntityIndex);
  }
  prior.lastTick = tick;
  controllerStates.set(controllerEntityIndex, prior);
}

function resolvePlayerAttachment(entity, ownerChain) {
  const directClass = entity?.class?.name ?? null;
  const directIndex = getEntityIndex(entity);

  if (directClass === 'CCitadelPlayerController' && directIndex !== null) {
    return clonePlayer(controllerStates.get(directIndex));
  }
  if (directClass === 'CCitadelPlayerPawn' && directIndex !== null) {
    return playerFromPawnIndex(directIndex);
  }

  for (const node of ownerChain) {
    if (node.className === 'CCitadelPlayerController' && node.entityIndex !== null) {
      return clonePlayer(controllerStates.get(node.entityIndex));
    }
    if (node.className === 'CCitadelPlayerPawn' && node.entityIndex !== null) {
      const player = playerFromPawnIndex(node.entityIndex);
      if (player) return player;
    }
  }
  return null;
}

function playerFromPawnIndex(pawnEntityIndex) {
  const controllerIndex = controllerByPawnIndex.get(pawnEntityIndex);
  if (controllerIndex === undefined) return null;
  return clonePlayer(controllerStates.get(controllerIndex));
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

function buildOwnerChain(entity, maxDepth) {
  const rows = [];
  const visited = new Set();
  let current = entity;

  for (let depth = 0; depth < maxDepth; depth++) {
    const currentIndex = getEntityIndex(current);
    if (currentIndex !== null) {
      if (visited.has(currentIndex)) break;
      visited.add(currentIndex);
    }

    const ownerCandidates = [
      ['m_hOwnerEntity', safeGetField(current, 'm_hOwnerEntity')],
      ['m_hOwner', safeGetField(current, 'm_hOwner')],
      ['CBodyComponent.m_hParent', safeGetField(current, 'CBodyComponent.m_hParent')],
    ];

    let resolved = null;
    let viaField = null;
    let rawHandle = null;
    for (const [fieldName, handle] of ownerCandidates) {
      const candidate = safeResolveEntityHandle(handle);
      if (!candidate) continue;
      resolved = candidate;
      viaField = fieldName;
      rawHandle = safeValue(handle);
      break;
    }
    if (!resolved) break;

    rows.push({
      depth: depth + 1,
      viaField,
      rawHandle,
      entityIndex: getEntityIndex(resolved),
      className: resolved?.class?.name ?? null,
      context: snapshotInterestingEntityFields(resolved),
    });
    current = resolved;
  }

  return rows;
}

function snapshotInterestingEntityFields(entity) {
  const fields = [
    'm_nSubclassID',
    'm_hOwnerEntity',
    'm_hOwner',
    'CBodyComponent.m_hParent',
    'm_iTeamNum',
    'm_bActive',
    'm_bInteractive',
    'm_flCreateTime',
    'm_hEffectEntity',
    'm_nUpgradeInfo',
    'm_iBucketID',
    'm_lifeState',
    'm_iHealth',
    'm_iMaxHealth',
  ];
  const out = {};
  for (const field of fields) {
    const value = safeGetField(entity, field);
    if (value !== undefined && value !== null) out[field] = safeValue(value);
  }
  return out;
}

// ============================================================
// SUMMARIES
// ============================================================

function summarizeByPowerup(universe, rows) {
  const recordKeys = [...new Set(universe.map(row => row.recordKey).filter(Boolean))].sort();
  return recordKeys.map(recordKey => {
    const identityRows = universe.filter(row => row.recordKey === recordKey);
    const hitRows = rows.filter(row => row.recordKey === recordKey);
    const hitsByKind = {};
    for (const kind of ['ENTITY_SUBCLASS_PATH', 'RECORD_KEY', 'MODIFIER_CLASS']) {
      hitsByKind[kind] = hitRows.filter(row => row.tokenKind === kind).length;
    }
    return {
      recordKey,
      modifierClass: identityRows[0]?.modifierClass ?? null,
      durationSeconds: identityRows[0]?.durationSeconds ?? null,
      identityIds: Object.fromEntries(identityRows.map(row => [row.tokenKind, row.tokenId])),
      hitsByKind,
      distinctSites: distinctSites(hitRows).length,
      attachedPlayers: [...new Set(hitRows.map(row => row.attachedPlayer?.playerName).filter(Boolean))].sort(),
      classes: [...new Set(hitRows.map(row => row.className))].sort(),
      fields: [...new Set(hitRows.map(row => row.fieldName))].sort(),
    };
  });
}

function summarizeClassFields(rows) {
  const by = new Map();
  for (const row of rows) {
    const key = `${row.className}\u0000${row.fieldName}`;
    if (!by.has(key)) {
      by.set(key, {
        className: row.className,
        fieldName: row.fieldName,
        hits: 0,
        ids: new Set(),
        tokenKinds: new Set(),
        recordKeys: new Set(),
        players: new Set(),
      });
    }
    const out = by.get(key);
    out.hits++;
    out.ids.add(row.tokenId);
    out.tokenKinds.add(row.tokenKind);
    if (row.recordKey) out.recordKeys.add(row.recordKey);
    if (row.attachedPlayer?.playerName) out.players.add(row.attachedPlayer.playerName);
  }

  return [...by.values()]
    .map(row => ({
      className: row.className,
      fieldName: row.fieldName,
      hits: row.hits,
      distinctIds: row.ids.size,
      tokenKinds: [...row.tokenKinds].sort(),
      recordKeys: [...row.recordKeys].sort(),
      attachedPlayers: [...row.players].sort(),
    }))
    .sort((a, b) => b.hits - a.hits || a.className.localeCompare(b.className) || a.fieldName.localeCompare(b.fieldName));
}

function distinctSites(rows) {
  return [...new Set(rows.map(row => [
    row.className,
    row.fieldName,
    row.entityIndex ?? 'na',
    row.tokenId,
  ].join('|')))];
}

// ============================================================
// UTILITIES
// ============================================================

function updateClockOffset(entity) {
  if (matchClockOffsetSeconds !== null) return;
  const gameStartTime = safeGetField(entity, 'm_pGameRules.m_flGameStartTime');
  const gameStateStartTime = safeGetField(entity, 'm_pGameRules.m_flGameStateStartTime');
  if (Number.isFinite(gameStartTime) && Number.isFinite(gameStateStartTime)) {
    matchClockOffsetSeconds = gameStartTime - gameStateStartTime;
  }
}

function isScalar(value) {
  return typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'string'
    || typeof value === 'boolean';
}

function isBinary(value) {
  return value instanceof Uint8Array
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value);
}

function normalizeComparableUint32(value) {
  if (typeof value === 'boolean') return null;

  let n;
  if (typeof value === 'bigint') {
    if (value < -2147483648n || value > 4294967295n) return null;
    n = Number(value);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    if (value < -2147483648 || value > 4294967295) return null;
    n = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < -2147483648 || parsed > 4294967295) return null;
    n = parsed;
  } else {
    return null;
  }

  return n >>> 0;
}

function safeChanges(event) {
  try {
    return event.getChanges() ?? {};
  } catch {
    return {};
  }
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
  if (isBinary(value)) return { type: value.constructor?.name ?? 'binary', byteLength: value.byteLength ?? null };
  try {
    return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const sign = seconds < 0 ? '-' : '';
  const total = Math.max(0, Math.floor(Math.abs(seconds)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${sign}${minutes}:${String(secs).padStart(2, '0')}`;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}
