import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, extname, resolve } from 'node:path';
import { EntityOperation, InterceptorStage, Parser } from 'deadem';

const VERSION = 'RUNTIME_MELEE_PRODUCTION_V01';
const STATUS_READY = 'RUNTIME_MELEE_PRODUCTION_V01_READY';
const TICKS_PER_SECOND = 64;
const ENTITY_INDEX_MASK = 0x3fff;
const INVALID_ENTITY_INDEX = ENTITY_INDEX_MASK;

const ATTACK_TYPE = Object.freeze({
  0: 'NONE',
  1: 'LIGHT',
  2: 'HEAVY',
  3: 'HEAVY_AIR',
  4: 'SLIDE',
});

const ATTACK_STATE = Object.freeze({
  0: 'NONE',
  1: 'CHARGING',
  2: 'GROUND_DASHING',
  3: 'AIR_DASHING',
  4: 'ATTACKING',
  5: 'SLIDE_DASHING',
});

const replayArg = process.argv[2];
if (!replayArg) {
  throw new Error('Usage: node inspector-v04/production/extract-runtime-melee.mjs <replay.dem>');
}

const replayPath = resolve(replayArg);
const replayName = basename(replayPath, extname(replayPath));
const outputDir = resolve('output', replayName);
const playerStatePath = resolve(outputDir, 'player_state.jsonl');
const playerStateSummaryPath = resolve(outputDir, 'player_state_summary.json');
const eventsPath = resolve(outputDir, 'runtime_melee_events_v01.jsonl');
const summaryPath = resolve(outputDir, 'runtime_melee_production_v01.json');

for (const path of [replayPath, playerStatePath, playerStateSummaryPath]) {
  if (!existsSync(path)) throw new Error(`Required input missing: ${path}`);
}

mkdirSync(dirname(summaryPath), { recursive: true });
const playerStateSummary = JSON.parse(readFileSync(playerStateSummaryPath, 'utf8'));
const matchClockOffsetSeconds = finite(playerStateSummary?.matchClockOffsetSeconds);
if (matchClockOffsetSeconds === null) {
  throw new Error('player_state_summary.json does not contain a finite matchClockOffsetSeconds.');
}

const roster = await loadPlayerRoster(playerStatePath);
const playerByPawn = new Map();
for (const player of roster) {
  for (const pawnIndex of player.pawnEntityIndexes) playerByPawn.set(pawnIndex, player);
}

const parser = new Parser();
const directEvents = new Map();
let entityPacketsObserved = 0;
let meleeAbilityEntityEvents = 0;
let replayEndTick = 0;

parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET, (demoPacket, messagePacket, entityEvents) => {
  const tick = finite(demoPacket?.tick);
  if (tick === null || tick < 0) return;
  replayEndTick = Math.max(replayEndTick, tick);
  entityPacketsObserved += 1;

  for (const entityEvent of entityEvents ?? []) {
    const ability = entityEvent?.entity;
    if (!ability || ability?.class?.name !== 'CCitadel_Ability_HoldMelee') continue;
    if (entityEvent.operation === EntityOperation.DELETE) continue;
    if (entityEvent.operation !== EntityOperation.CREATE && entityEvent.operation !== EntityOperation.UPDATE) continue;
    meleeAbilityEntityEvents += 1;

    const attackTypeCode = numberField(ability, 'm_eCurrentAttackType');
    const attackStateCode = numberField(ability, 'm_eCurrentAttackState');
    const attackTriggeredTime = numberField(ability, 'm_flAttackTriggeredTime');
    const hit = booleanField(ability, 'm_bHitWithThisAttack');

    if (
      attackTriggeredTime === null ||
      attackTriggeredTime <= 0 ||
      attackTypeCode === null ||
      attackTypeCode <= 0
    ) continue;

    const key = [ability.index, attackTriggeredTime, attackTypeCode].join('|');
    const ownerHandleRaw = firstPresent(
      ability.getField('m_hOwnerEntity'),
      ability.getField('CBodyComponent.m_hParent')
    );
    const pawnEntityIndex = resolveEntityHandleIndex(ownerHandleRaw);
    const player = pawnEntityIndex === null ? null : playerByPawn.get(pawnEntityIndex) ?? null;

    if (!directEvents.has(key)) {
      const demoSeconds = tick / TICKS_PER_SECOND;
      directEvents.set(key, {
        schemaVersion: 'runtime_melee_event_v01',
        key,
        replay: replayName,
        abilityEntityIndex: ability.index,
        ownerHandleRaw: serializable(ownerHandleRaw),
        pawnEntityIndex,
        controllerEntityIndex: player?.controllerEntityIndex ?? null,
        playerName: player?.playerName ?? null,
        steamId: player?.steamId ?? null,
        heroId: player?.heroId ?? null,
        team: player?.team ?? null,
        attackTypeCode,
        attackType: ATTACK_TYPE[attackTypeCode] ?? `UNKNOWN_${attackTypeCode}`,
        firstAttackStateCode: attackStateCode,
        firstAttackState: ATTACK_STATE[attackStateCode] ?? `UNKNOWN_${attackStateCode}`,
        attackTriggeredTime,
        firstObservedTick: tick,
        firstObservedDemoTimeSeconds: demoSeconds,
        firstObservedMatchTimeSeconds: demoSeconds - matchClockOffsetSeconds,
        hit: false,
        hitObservedTick: null,
        hitObservedDemoTimeSeconds: null,
        hitObservedMatchTimeSeconds: null,
      });
    }

    const event = directEvents.get(key);

    // The owner field is the direct Source-2 handle carrier. If the first
    // packet was unresolved but a later packet resolves, fill identity once.
    if (!event.playerName && player) {
      event.ownerHandleRaw = serializable(ownerHandleRaw);
      event.pawnEntityIndex = pawnEntityIndex;
      event.controllerEntityIndex = player.controllerEntityIndex;
      event.playerName = player.playerName;
      event.steamId = player.steamId;
      event.heroId = player.heroId;
      event.team = player.team;
    }

    if (hit === true && event.hit !== true) {
      const demoSeconds = tick / TICKS_PER_SECOND;
      event.hit = true;
      event.hitObservedTick = tick;
      event.hitObservedDemoTimeSeconds = demoSeconds;
      event.hitObservedMatchTimeSeconds = demoSeconds - matchClockOffsetSeconds;
    }
  }
});

console.log('');
console.log('========================================================');
console.log('RUNTIME MELEE PRODUCTION V0.1');
console.log('========================================================');
console.log(`Replay: ${replayName}`);
console.log('Parsing direct CCitadel_Ability_HoldMelee execution state...');
console.log('');

try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

const rawEvents = [...directEvents.values()]
  .map(event => ({
    ...event,
    eligibleForMatchStats:
      Number.isFinite(event.firstObservedMatchTimeSeconds) && event.firstObservedMatchTimeSeconds >= 0,
  }))
  .sort((a, b) => a.firstObservedTick - b.firstObservedTick || a.abilityEntityIndex - b.abilityEntityIndex);

const matchEvents = rawEvents.filter(event => event.eligibleForMatchStats === true);
const players = summarizePlayers(roster, matchEvents);
const rawByType = countBy(rawEvents, event => event.attackType);
const matchByType = countBy(matchEvents, event => event.attackType);
const rawHitsByType = countBy(rawEvents.filter(event => event.hit === true), event => event.attackType);
const matchHitsByType = countBy(matchEvents.filter(event => event.hit === true), event => event.attackType);
const unresolvedOwnerRaw = rawEvents.filter(event => !event.playerName).length;
const unresolvedOwnerMatch = matchEvents.filter(event => !event.playerName).length;
const unknownTypeRaw = rawEvents.filter(event => !Object.hasOwn(ATTACK_TYPE, event.attackTypeCode)).length;
const unknownTypeMatch = matchEvents.filter(event => !Object.hasOwn(ATTACK_TYPE, event.attackTypeCode)).length;
const duplicateKeyCount = rawEvents.length - new Set(rawEvents.map(event => event.key)).size;
const matchHits = matchEvents.filter(event => event.hit === true).length;

const validationChecks = {
  twelvePlayerRoster: roster.length === 12,
  uniqueExecutionKeys: duplicateKeyCount === 0,
  allPostStartExecutionsPlayerLinked: unresolvedOwnerMatch === 0,
  allPostStartTypesKnown: unknownTypeMatch === 0,
  hitCountBoundedByExecutions: matchHits <= matchEvents.length,
  playerAttackSumReconciles: players.reduce((sum, row) => sum + row.attackCount, 0) === matchEvents.length,
  playerHitSumReconciles: players.reduce((sum, row) => sum + row.hitCount, 0) === matchHits,
};

const summary = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: STATUS_READY,
  replay: {
    replayName,
    replayPath,
    tickRate: TICKS_PER_SECOND,
    matchClockOffsetSeconds,
    replayEndTick,
  },
  source: {
    entityClass: 'CCitadel_Ability_HoldMelee',
    executionIdentity: 'abilityEntityIndex + m_flAttackTriggeredTime + m_eCurrentAttackType',
    attackTypeField: 'm_eCurrentAttackType',
    attackStateField: 'm_eCurrentAttackState',
    attackTriggeredTimeField: 'm_flAttackTriggeredTime',
    hitField: 'm_bHitWithThisAttack',
    ownerField: 'm_hOwnerEntity (CBodyComponent.m_hParent fallback)',
    ownerResolution: 'Source-2 entity handle -> player pawn index (0x3fff mask) -> player_state roster',
  },
  operationalContract: {
    rawEvent: 'Unique observed melee-ability execution keyed by ability entity, attack-trigger time, and attack type.',
    matchEligibility: 'firstObservedMatchTimeSeconds >= 0',
    hit: 'm_bHitWithThisAttack became true for the execution.',
    type: 'Observed m_eCurrentAttackType. LIGHT=1, HEAVY=2, HEAVY_AIR=3, SLIDE=4.',
    semanticBoundary: 'Executed melee telemetry, not raw input/attempt telemetry. Hit is the observed ability hit flag; it does not independently reconstruct collision, damage amount, target identity, final blow, or economic outcome.',
  },
  attackTypeEnum: ATTACK_TYPE,
  attackStateEnum: ATTACK_STATE,
  rawTotals: {
    attacks: rawEvents.length,
    hits: rawEvents.filter(event => event.hit === true).length,
    byType: rawByType,
    hitsByType: rawHitsByType,
    unresolvedOwner: unresolvedOwnerRaw,
    unknownAttackType: unknownTypeRaw,
  },
  preMatch: {
    attacksExcluded: rawEvents.length - matchEvents.length,
    hitsExcluded: rawEvents.filter(event => event.eligibleForMatchStats !== true && event.hit === true).length,
  },
  totals: {
    attacks: matchEvents.length,
    hits: matchHits,
    hitRate: safeDiv(matchHits, matchEvents.length),
    byType: matchByType,
    hitsByType: matchHitsByType,
    unresolvedOwner: unresolvedOwnerMatch,
    unknownAttackType: unknownTypeMatch,
  },
  players,
  integrity: {
    entityPacketsObserved,
    meleeAbilityEntityEvents,
    duplicateKeyCount,
    ownerResolutionRateRaw: safeDiv(rawEvents.length - unresolvedOwnerRaw, rawEvents.length),
    ownerResolutionRateMatch: safeDiv(matchEvents.length - unresolvedOwnerMatch, matchEvents.length),
    eventCountMatchesPlayerSum: validationChecks.playerAttackSumReconciles,
    hitCountMatchesPlayerSum: validationChecks.playerHitSumReconciles,
  },
  validation: {
    pass: Object.values(validationChecks).every(Boolean),
    checks: validationChecks,
  },
};

writeFileSync(eventsPath, rawEvents.map(event => JSON.stringify(event)).join('\n') + (rawEvents.length ? '\n' : ''), 'utf8');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(`Roster players:        ${roster.length}`);
console.log(`Raw direct executions: ${summary.rawTotals.attacks}`);
console.log(`Pre-match excluded:    ${summary.preMatch.attacksExcluded}`);
console.log(`Match executions:      ${summary.totals.attacks}`);
console.log(`Observed hit flags:    ${summary.totals.hits}`);
console.log(`Resolved match owners: ${summary.totals.attacks - summary.totals.unresolvedOwner}/${summary.totals.attacks}`);
console.log(`Types: ${JSON.stringify(summary.totals.byType)}`);
console.log(`Integrity: ${summary.validation.pass ? 'PASS' : 'FAIL'}`);
console.log(`Output: ${summaryPath}`);
console.log(`Events: ${eventsPath}`);
console.log('');

if (!summary.validation.pass) process.exitCode = 2;

async function loadPlayerRoster(path) {
  const players = new Map();
  const stream = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const controller = row?.controller ?? {};
    const pawn = row?.pawn ?? {};
    const playerName = controller.playerName;
    const controllerEntityIndex = finite(controller.entityIndex);
    if (!playerName || playerName === 'SourceTV' || controllerEntityIndex === null) continue;
    let player = players.get(controllerEntityIndex);
    if (!player) {
      player = {
        controllerEntityIndex,
        playerName,
        steamId: controller.steamId ?? null,
        heroId: controller.heroId ?? null,
        team: controller.team ?? null,
        pawnEntityIndexes: new Set(),
      };
      players.set(controllerEntityIndex, player);
    }
    player.playerName = playerName ?? player.playerName;
    player.steamId = controller.steamId ?? player.steamId;
    player.heroId = controller.heroId ?? player.heroId;
    player.team = controller.team ?? player.team;
    const pawnIndex = finite(pawn.entityIndex);
    if (pawnIndex !== null) player.pawnEntityIndexes.add(pawnIndex);
  }
  return [...players.values()].map(player => ({
    ...player,
    pawnEntityIndexes: [...player.pawnEntityIndexes].sort((a, b) => a - b),
  })).sort((a, b) => String(a.playerName).localeCompare(String(b.playerName)));
}

function summarizePlayers(roster, events) {
  const eventMap = new Map();
  for (const event of events) {
    if (!event.playerName) continue;
    if (!eventMap.has(event.playerName)) eventMap.set(event.playerName, []);
    eventMap.get(event.playerName).push(event);
  }

  return roster.map(player => {
    const rows = eventMap.get(player.playerName) ?? [];
    const attackCount = rows.length;
    const hitCount = rows.filter(row => row.hit === true).length;
    const byType = countBy(rows, row => row.attackType);
    const hitsByType = countBy(rows.filter(row => row.hit === true), row => row.attackType);
    return {
      controllerEntityIndex: player.controllerEntityIndex,
      pawnEntityIndexes: player.pawnEntityIndexes,
      playerName: player.playerName,
      steamId: player.steamId,
      heroId: player.heroId,
      team: player.team,
      attackCount,
      hitCount,
      hitRate: safeDiv(hitCount, attackCount),
      byType,
      hitsByType,
      typeShare: Object.fromEntries(
        Object.entries(byType).map(([type, count]) => [type, safeDiv(count, attackCount)])
      ),
    };
  });
}

function resolveEntityHandleIndex(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    for (const key of ['index', 'entityIndex', 'entryIndex', 'entIndex']) {
      const n = finite(value[key]);
      if (n !== null) return normalizeIndex(n);
    }
    for (const key of ['handle', 'value', 'raw']) {
      const n = finite(value[key]);
      if (n !== null) return normalizeHandleNumber(n);
    }
    return null;
  }
  const n = finite(value);
  return n === null ? null : normalizeHandleNumber(n);
}

function normalizeHandleNumber(number) {
  const raw = Math.trunc(number);
  if (raw < 0) return null;
  const direct = normalizeIndex(raw);
  if (raw <= ENTITY_INDEX_MASK && direct !== null) return direct;
  return normalizeIndex(raw & ENTITY_INDEX_MASK);
}

function normalizeIndex(number) {
  const index = Math.trunc(number);
  return index >= 0 && index < INVALID_ENTITY_INDEX ? index : null;
}

function numberField(entity, field) {
  return finite(entity?.getField?.(field));
}

function booleanField(entity, field) {
  const value = entity?.getField?.(field);
  return value === true || value === false ? value : null;
}

function firstPresent(...values) {
  for (const value of values) if (value !== null && value !== undefined) return value;
  return null;
}

function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = String(getKey(value) ?? 'UNKNOWN');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function safeDiv(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function serializable(value) {
  if (value === undefined || value === null) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
}
