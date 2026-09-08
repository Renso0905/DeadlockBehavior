import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

const VERSION = 'BRIDGE_SURVIVAL_MATCH_END_OUTLIER_DIAGNOSTIC_V01';
const TICKS_PER_SECOND = 64;
const GAME_IN_PROGRESS = 7;
const POST_GAME = 8;
const SEMANTIC_WINDOW_TICKS = 16; // +/-0.25 s, same semantic scale as Script152

const SCRIPT152_PATH = resolve('output', 'cross_replay', 'bridge_survival_runtime_duration_validation_v01.json');
const SCRIPT153_PATH = resolve('output', 'cross_replay', 'bridge_survival_expiration_outlier_diagnostic_v01.json');
const SCRIPT155_PATH = resolve('output', 'cross_replay', 'bridge_survival_overlap_outlier_diagnostic_v01.json');
const OUTPUT_PATH = resolve('output', 'cross_replay', 'bridge_survival_match_end_outlier_diagnostic_v01.json');

for (const path of [SCRIPT152_PATH, SCRIPT153_PATH, SCRIPT155_PATH]) {
  if (!existsSync(path)) throw new Error(`Required artifact missing:\n${path}`);
}

const script152 = readJson(SCRIPT152_PATH);
const script153 = readJson(SCRIPT153_PATH);
const script155 = readJson(SCRIPT155_PATH);

if (script152?.status !== 'BRIDGE_SURVIVAL_RUNTIME_DURATION_V01_STRONGLY_VALIDATED_ACROSS_INDEPENDENT_REPLAYS') {
  throw new Error(`Unexpected Script152 status=${script152?.status}`);
}
if (script153?.status !== 'BRIDGE_SURVIVAL_EXPIRATION_OUTLIER_V01_DIAGNOSED') {
  throw new Error(`Unexpected Script153 status=${script153?.status}`);
}
if (script155?.status !== 'BRIDGE_SURVIVAL_OVERLAP_OUTLIER_V01_DIAGNOSED') {
  throw new Error(`Unexpected Script155 status=${script155?.status}`);
}

const failedNaturalAnchors = [];
for (const replay of script152?.replays ?? script152?.replayResults ?? []) {
  for (const anchor of replay?.anchors ?? []) {
    if (!anchor?.expirationObservable || anchor?.deathBeforeExpectedExpiration) continue;
    const hpPass = anchor?.healthMax?.expiration?.delta < 0 && anchor?.healthMax?.symmetric === true;
    if (hpPass) continue;
    failedNaturalAnchors.push({ replayName: replay.replayName, ...anchor });
  }
}

if (failedNaturalAnchors.length === 0) throw new Error('No failed natural-expiration anchors found in Script152.');

console.log('');
console.log('========================================================');
console.log('BRIDGE SURVIVAL MATCH-END OUTLIER DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Script152 natural misses:       ${failedNaturalAnchors.length}`);
console.log(`Native game state authority:    7=GameInProgress, 8=PostGame`);
console.log(`Question:                       did active gameplay end before/near expected expiry?`);
console.log('');

const diagnostics = [];

for (let i = 0; i < failedNaturalAnchors.length; i++) {
  const anchor = failedNaturalAnchors[i];
  const replayPath = resolve('replays', `${anchor.replayName}.dem`);
  if (!existsSync(replayPath)) throw new Error(`Replay missing: ${replayPath}`);

  console.log('--------------------------------------------------------');
  console.log(`[${i + 1}/${failedNaturalAnchors.length}] ${anchor.replayName} ${anchor.playerName}`);
  console.log('--------------------------------------------------------');

  const scan = await scanReplay(replayPath, anchor.controllerIndex);
  const postGame = scan.gameStateTransitions.find(row => row.before === GAME_IN_PROGRESS && row.after === POST_GAME) ?? null;
  const firstNonGameplayAfterPickup = scan.gameStateTransitions.find(row => row.tick > anchor.pickupTick && row.after !== GAME_IN_PROGRESS) ?? null;
  const finalGameState = scan.finalGameState;

  const expectedToPostGameSeconds = postGame
    ? (postGame.tick - anchor.expectedExpirationTick) / TICKS_PER_SECOND
    : null;
  const pickupToPostGameSeconds = postGame
    ? (postGame.tick - anchor.pickupTick) / TICKS_PER_SECOND
    : null;
  const gameplayTicksAfterExpectedExpiry = postGame
    ? Math.max(0, postGame.tick - anchor.expectedExpirationTick)
    : Math.max(0, scan.maxTick - anchor.expectedExpirationTick);

  const lastControllerUpdateAfterExpected = scan.lastControllerUpdateTick !== null
    ? (scan.lastControllerUpdateTick - anchor.expectedExpirationTick) / TICKS_PER_SECOND
    : null;
  const lastHpUpdateAfterExpected = scan.lastHealthMaxUpdateTick !== null
    ? (scan.lastHealthMaxUpdateTick - anchor.expectedExpirationTick) / TICKS_PER_SECOND
    : null;
  const lastRegenUpdateAfterExpected = scan.lastHealthRegenUpdateTick !== null
    ? (scan.lastHealthRegenUpdateTick - anchor.expectedExpirationTick) / TICKS_PER_SECOND
    : null;

  const classification = classify({
    postGame,
    expectedExpirationTick: anchor.expectedExpirationTick,
    maxTick: scan.maxTick,
    lastControllerUpdateTick: scan.lastControllerUpdateTick,
  });

  console.log(`Survival pickup:                 ${anchor.matchClock ?? 'n/a'} tick=${anchor.pickupTick}`);
  console.log(`Expected expiry:                 tick=${anchor.expectedExpirationTick}`);
  console.log(`PostGame transition:             ${postGame ? `tick=${postGame.tick} (${fmtSignedSeconds(expectedToPostGameSeconds)} vs expected expiry)` : 'not observed'}`);
  console.log(`Pickup -> PostGame:              ${pickupToPostGameSeconds === null ? 'n/a' : `${pickupToPostGameSeconds.toFixed(3)}s`}`);
  console.log(`Gameplay after expected expiry:  ${(gameplayTicksAfterExpectedExpiry / TICKS_PER_SECOND).toFixed(3)}s`);
  console.log(`Replay max tick:                 ${scan.maxTick} (${fmtSignedSeconds((scan.maxTick - anchor.expectedExpirationTick) / TICKS_PER_SECOND)} vs expected expiry)`);
  console.log(`Last controller UPDATE:          ${scan.lastControllerUpdateTick ?? 'n/a'} (${fmtNullableSeconds(lastControllerUpdateAfterExpected)} vs expected expiry)`);
  console.log(`Last MaxHP UPDATE:               ${scan.lastHealthMaxUpdateTick ?? 'n/a'} (${fmtNullableSeconds(lastHpUpdateAfterExpected)} vs expected expiry)`);
  console.log(`Last Regen UPDATE:               ${scan.lastHealthRegenUpdateTick ?? 'n/a'} (${fmtNullableSeconds(lastRegenUpdateAfterExpected)} vs expected expiry)`);
  console.log(`Winning-team transition:         ${scan.winningTeamTransitions.length > 0 ? JSON.stringify(scan.winningTeamTransitions[0]) : 'none observed'}`);
  console.log(`Final game state:                ${finalGameState ?? 'n/a'}`);
  console.log(`classification:                  ${classification}`);

  if (scan.gameStateTransitions.length > 0) {
    console.log('Game-state transitions:');
    for (const row of scan.gameStateTransitions) {
      const dtExpected = (row.tick - anchor.expectedExpirationTick) / TICKS_PER_SECOND;
      console.log(`  tick=${row.tick} ${row.before ?? 'null'} -> ${row.after}  dtExpected=${fmtSignedSeconds(dtExpected)}`);
    }
  }

  diagnostics.push({
    replayName: anchor.replayName,
    playerName: anchor.playerName,
    controllerIndex: anchor.controllerIndex,
    pickupTick: anchor.pickupTick,
    expectedExpirationTick: anchor.expectedExpirationTick,
    pickupMatchClock: anchor.matchClock ?? null,
    healthMaxAcquisition: anchor?.healthMax?.acquisition ?? null,
    postGameTransition: postGame,
    firstNonGameplayAfterPickup,
    expectedToPostGameSeconds,
    pickupToPostGameSeconds,
    gameplaySecondsAfterExpectedExpiry: gameplayTicksAfterExpectedExpiry / TICKS_PER_SECOND,
    replayMaxTick: scan.maxTick,
    replaySecondsAfterExpectedExpiry: (scan.maxTick - anchor.expectedExpirationTick) / TICKS_PER_SECOND,
    lastControllerUpdateTick: scan.lastControllerUpdateTick,
    lastControllerUpdateSecondsAfterExpectedExpiry: lastControllerUpdateAfterExpected,
    lastHealthMaxUpdateTick: scan.lastHealthMaxUpdateTick,
    lastHealthMaxUpdateSecondsAfterExpectedExpiry: lastHpUpdateAfterExpected,
    lastHealthRegenUpdateTick: scan.lastHealthRegenUpdateTick,
    lastHealthRegenUpdateSecondsAfterExpectedExpiry: lastRegenUpdateAfterExpected,
    finalGameState,
    gameStateTransitions: scan.gameStateTransitions,
    winningTeamTransitions: scan.winningTeamTransitions,
    freezeTransitions: scan.freezeTransitions,
    matchClockTransitionsNearExpected: scan.matchClockTransitions.filter(row => Math.abs(row.tick - anchor.expectedExpirationTick) <= 10 * TICKS_PER_SECOND),
    classification,
  });
}

const classifications = {};
for (const row of diagnostics) classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;

const output = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  status: 'BRIDGE_SURVIVAL_MATCH_END_OUTLIER_V01_DIAGNOSED',
  foundations: {
    script152: SCRIPT152_PATH,
    script153: SCRIPT153_PATH,
    script155: SCRIPT155_PATH,
  },
  methodologicalBoundary: {
    retunesNothing: true,
    purpose: 'Diagnose only pre-existing Script152 natural-expiration misses against native game-state/postgame boundaries.',
    eGameStateGameInProgress: GAME_IN_PROGRESS,
    eGameStatePostGame: POST_GAME,
  },
  counts: {
    failedNaturalAnchors: diagnostics.length,
    classifications,
  },
  diagnostics,
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('MATCH-END OUTLIER DIAGNOSTIC RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                  ${output.status}`);
console.log(`failed natural anchors:  ${diagnostics.length}`);
console.log(`classifications:         ${JSON.stringify(classifications)}`);
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

async function scanReplay(replayPath, controllerIndex) {
  const parser = new Parser(
    new ParserConfiguration({ entityClasses: ['CCitadelGameRulesProxy', 'CCitadelPlayerController'] }),
    Logger.CONSOLE_INFO
  );

  let maxTick = -1;
  let lastControllerUpdateTick = null;
  let lastHealthMaxUpdateTick = null;
  let lastHealthRegenUpdateTick = null;
  let finalGameState = null;

  const controllerState = { m_iHealthMax: undefined, m_flHealthRegen: undefined };
  const rulesState = {
    gameState: undefined,
    winningTeam: undefined,
    freezePeriod: undefined,
    matchClock: undefined,
  };

  const gameStateTransitions = [];
  const winningTeamTransitions = [];
  const freezeTransitions = [];
  const matchClockTransitions = [];

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, messagePacket, events) => {
      const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
      if (!Number.isFinite(tick)) return;
      maxTick = Math.max(maxTick, tick);

      for (const event of events) {
        if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) continue;
        const entity = event.entity;
        if (!entity) continue;
        const changes = safeChanges(event);

        if (entity.class?.name === 'CCitadelPlayerController' && entity.index === controllerIndex) {
          if (event.operation === EntityOperation.UPDATE) lastControllerUpdateTick = tick;

          if (Object.prototype.hasOwnProperty.call(changes, 'm_iHealthMax')) {
            const after = entity.getField('m_iHealthMax');
            if (event.operation === EntityOperation.UPDATE && controllerState.m_iHealthMax !== undefined && after !== controllerState.m_iHealthMax) {
              lastHealthMaxUpdateTick = tick;
            }
            controllerState.m_iHealthMax = after;
          }
          if (Object.prototype.hasOwnProperty.call(changes, 'm_flHealthRegen')) {
            const after = entity.getField('m_flHealthRegen');
            if (event.operation === EntityOperation.UPDATE && controllerState.m_flHealthRegen !== undefined && after !== controllerState.m_flHealthRegen) {
              lastHealthRegenUpdateTick = tick;
            }
            controllerState.m_flHealthRegen = after;
          }
          continue;
        }

        if (entity.class?.name !== 'CCitadelGameRulesProxy') continue;

        const gameState = entity.getField('m_pGameRules.m_eGameState');
        if (gameState !== undefined && gameState !== null) {
          const normalized = Number(gameState);
          if (event.operation === EntityOperation.UPDATE && rulesState.gameState !== undefined && normalized !== rulesState.gameState) {
            gameStateTransitions.push({ tick, before: rulesState.gameState, after: normalized });
          }
          rulesState.gameState = normalized;
          finalGameState = normalized;
        }

        const winningTeam = entity.getField('m_pGameRules.m_iWinningTeam');
        if (winningTeam !== undefined && winningTeam !== null) {
          const normalized = Number(winningTeam);
          if (event.operation === EntityOperation.UPDATE && rulesState.winningTeam !== undefined && normalized !== rulesState.winningTeam) {
            winningTeamTransitions.push({ tick, before: rulesState.winningTeam, after: normalized });
          }
          rulesState.winningTeam = normalized;
        }

        const freeze = entity.getField('m_pGameRules.m_bFreezePeriod');
        if (freeze !== undefined && freeze !== null) {
          const normalized = Boolean(freeze);
          if (event.operation === EntityOperation.UPDATE && rulesState.freezePeriod !== undefined && normalized !== rulesState.freezePeriod) {
            freezeTransitions.push({ tick, before: rulesState.freezePeriod, after: normalized });
          }
          rulesState.freezePeriod = normalized;
        }

        const matchClock = entity.getField('m_pGameRules.m_flMatchClockAtLastUpdate');
        if (Number.isFinite(matchClock)) {
          if (event.operation === EntityOperation.UPDATE && rulesState.matchClock !== undefined && matchClock !== rulesState.matchClock) {
            matchClockTransitions.push({ tick, before: rulesState.matchClock, after: matchClock });
          }
          rulesState.matchClock = matchClock;
        }
      }
    }
  );

  await parser.parse(createReadStream(replayPath));
  await parser.dispose();

  return {
    maxTick,
    lastControllerUpdateTick,
    lastHealthMaxUpdateTick,
    lastHealthRegenUpdateTick,
    finalGameState,
    gameStateTransitions,
    winningTeamTransitions,
    freezeTransitions,
    matchClockTransitions,
  };
}

function classify({ postGame, expectedExpirationTick, maxTick, lastControllerUpdateTick }) {
  if (postGame) {
    if (postGame.tick < expectedExpirationTick - SEMANTIC_WINDOW_TICKS) {
      return 'MATCH_ENDED_BEFORE_EXPECTED_EXPIRY_CENSORED';
    }
    if (Math.abs(postGame.tick - expectedExpirationTick) <= SEMANTIC_WINDOW_TICKS) {
      return 'MATCH_ENDED_AT_EXPECTED_EXPIRY_BOUNDARY_CENSORED';
    }
    const secondsAfter = (postGame.tick - expectedExpirationTick) / TICKS_PER_SECOND;
    if (secondsAfter < 5) return 'POSTGAME_WITHIN_5S_AFTER_EXPECTED_EXPIRY_POSSIBLE_ENDGAME_CONFOUND';
    return 'GAMEPLAY_CONTINUED_BEYOND_EXPECTED_EXPIRY_TRUE_EXCEPTION';
  }

  if (maxTick < expectedExpirationTick) return 'REPLAY_ENDED_BEFORE_EXPECTED_EXPIRY_CENSORED';
  if (lastControllerUpdateTick !== null && lastControllerUpdateTick < expectedExpirationTick) {
    return 'CONTROLLER_STOPPED_UPDATING_BEFORE_EXPECTED_EXPIRY_CENSORED';
  }
  return 'NO_POSTGAME_BOUNDARY_OBSERVED_UNRESOLVED';
}

function safeChanges(event) {
  try {
    return event?.changes ?? {};
  } catch {
    return {};
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fmtSignedSeconds(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}s`;
}

function fmtNullableSeconds(value) {
  return Number.isFinite(value) ? fmtSignedSeconds(value) : 'n/a';
}
