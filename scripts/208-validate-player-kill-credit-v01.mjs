import {
  createReadStream,
  existsSync,
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Parser, InterceptorStage } from 'deadem';

const TICK_RATE = 64;
const ENTITY_INDEX_MASK = 0x3fff;
const MATCH_WINDOW_TICKS = 32; // 0.5 s; report observed residuals, do not infer from this window.
const PLACEBO_SHIFTS_TICKS = [10 * TICK_RATE, 30 * TICK_RATE];
const DEFAULT_REPLAYS = ['test', 'rep01', 'rep02', 'rep03', 'rep04', 'rep05'];

const requested = process.argv.slice(2).filter(Boolean);
const replayNames = requested.length > 0 ? requested : DEFAULT_REPLAYS;
const batchOutputPath = resolve(
  'output',
  'cross_replay',
  'player_kill_credit_validation_batch_v01.json'
);

console.log('');
console.log('========================================================');
console.log('PLAYER KILL CREDIT SEMANTIC VALIDATION V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const replayResults = [];

for (const replayName of replayNames) {
  const replayPath = resolve('replays', `${replayName}.dem`);

  if (!existsSync(replayPath)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'REPLAY_MISSING',
      replayPath
    });
    console.log(`${replayName.padEnd(10)} MISSING ${replayPath}`);
    continue;
  }

  try {
    const result = await validateReplay({ replayName, replayPath });
    replayResults.push(result);

    const evidence = result.evidence;
    console.log(
      `${replayName.padEnd(10)} ` +
      `kills=${String(result.counts.scoreboardKillCredits).padStart(3)} ` +
      `anchors=${String(result.counts.deathConfirmedDirectEnemyFatalAnchors).padStart(3)} ` +
      `killMatch=${formatPct(evidence.directFatalAnchorKillAgreement)} ` +
      `placebo10=${formatPct(evidence.placeboAgreement10s)}`
    );
  } catch (error) {
    replayResults.push({
      replayName,
      success: false,
      status: 'VALIDATION_EXCEPTION',
      error: error?.stack ?? String(error)
    });
    console.log(`${replayName.padEnd(10)} ERROR`);
    console.error(error);
  }
}

const successful = replayResults.filter(row => row.success);
const batch = buildBatchSummary(replayNames, replayResults, successful);
mkdirSync(dirname(batchOutputPath), { recursive: true });
writeFileSync(batchOutputPath, JSON.stringify(batch, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('BATCH EVIDENCE');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Direct fatal anchors: ${batch.aggregate.counts.deathConfirmedDirectEnemyFatalAnchors}`);
console.log(`Anchor -> kill agreement: ${formatPct(batch.aggregate.evidence.directFatalAnchorKillAgreement)}`);
console.log(`Anchor -> victim death agreement: ${formatPct(batch.aggregate.evidence.directFatalVictimDeathAgreement)}`);
console.log(`10 s placebo agreement: ${formatPct(batch.aggregate.evidence.placeboAgreement10s)}`);
console.log(`30 s placebo agreement: ${formatPct(batch.aggregate.evidence.placeboAgreement30s)}`);
console.log(`Output: ${batchOutputPath}`);
console.log('');
console.log('IMPORTANT: this script emits research evidence only. It does not promote a claim or metric.');
console.log('');

async function validateReplay({ replayName, replayPath }) {
  const parser = new Parser();

  const playerByPawnIndex = new Map();
  const playerByControllerIndex = new Map();
  const previousController = new Map();
  const firstCounterObservation = new Map();
  const finalCounterObservation = new Map();

  const killCounterEvents = [];
  const deathCounterEvents = [];
  const counterRegressions = [];
  const terminalDamageMessages = [];

  const telemetry = {
    entityPackets: 0,
    entityEvents: 0,
    controllerEvents: 0,
    messagePackets: 0,
    damageLikeMessages: 0,
    playerVictimTerminalDamageMessages: 0,
    unresolvedVictimTerminalDamageMessages: 0
  };

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, _messagePacket, events) => {
      const tick = finite(demoPacket?.tick);
      if (tick === null) return;
      telemetry.entityPackets++;

      for (const event of events ?? []) {
        telemetry.entityEvents++;
        const entity = event?.entity;
        if (!entity || getEntityClassName(entity) !== 'CCitadelPlayerController') continue;
        telemetry.controllerEvents++;

        processController({
          entity,
          tick,
          playerByPawnIndex,
          playerByControllerIndex,
          previousController,
          firstCounterObservation,
          finalCounterObservation,
          killCounterEvents,
          deathCounterEvents,
          counterRegressions
        });
      }
    }
  );

  parser.registerPostInterceptor(
    InterceptorStage.MESSAGE_PACKET,
    (demoPacket, messagePacket) => {
      const tick = finite(demoPacket?.tick);
      if (tick === null) return;
      telemetry.messagePackets++;

      const type = decodeMessageType(messagePacket?.type);
      if (!type || !/DAMAGE/i.test(type)) return;
      telemetry.damageLikeMessages++;

      const data = getMessageData(messagePacket);
      const victimIndex = normalizeEntityReference(
        findEntityReference(data, [
          /entindexvictim/i,
          /entindex_victim/i,
          /victimentityindex/i,
          /victimindex/i,
          /^victim$/i,
          /hvictim/i
        ])
      );

      if (victimIndex === null) return;

      const victimHealthNew = firstFinite([
        data?.victimHealthNew,
        data?.victim_health_new,
        findNumberByPatterns(data, [
          /^victimHealthNew$/i,
          /^victim_health_new$/i,
          /victim.*health.*new/i,
          /health.*new.*victim/i
        ])
      ]);

      if (victimHealthNew === null || victimHealthNew > 0) return;

      const attackerIndex = normalizeEntityReference(
        findEntityReference(data, [
          /entindexattacker/i,
          /entindex_attacker/i,
          /attackerentityindex/i,
          /attackerindex/i,
          /^attacker$/i,
          /hattacker/i
        ])
      );

      let victimPlayer = playerByPawnIndex.get(victimIndex) ?? null;
      if (!victimPlayer) {
        victimPlayer = findPlayerForPawnIndex(
          parser.getDemo(),
          victimIndex,
          playerByPawnIndex,
          playerByControllerIndex
        );
      }

      if (!victimPlayer) {
        telemetry.unresolvedVictimTerminalDamageMessages++;
        return;
      }

      telemetry.playerVictimTerminalDamageMessages++;

      let attackerPlayer = attackerIndex === null
        ? null
        : playerByPawnIndex.get(attackerIndex) ?? null;

      if (!attackerPlayer && attackerIndex !== null) {
        attackerPlayer = findPlayerForPawnIndex(
          parser.getDemo(),
          attackerIndex,
          playerByPawnIndex,
          playerByControllerIndex
        );
      }

      terminalDamageMessages.push({
        tick,
        messageType: type,
        victimIndex,
        attackerIndex,
        victimHealthNew,
        victimPlayer: compactPlayer(victimPlayer),
        attackerPlayer: compactPlayer(attackerPlayer),
        damage: firstFinite([
          data?.damage,
          data?.flDamage,
          data?.amount,
          data?.damageAmount,
          findNumberByPatterns(data, [/(^|_)damage$/i])
        ]),
        abilityId: firstFinite([data?.abilityId, data?.ability_id]),
        entindexAbility: normalizeEntityReference(data?.entindexAbility),
        entindexInflictor: normalizeEntityReference(data?.entindexInflictor)
      });
    }
  );

  try {
    await parser.parse(createReadStream(replayPath));
  } finally {
    await parser.dispose();
  }

  const killSlots = expandCounterSlots(killCounterEvents, 'kill');
  const deathSlots = expandCounterSlots(deathCounterEvents, 'death');
  const fatalGroups = groupTerminalDamageMessages(terminalDamageMessages);

  const directEnemyFatalGroups = fatalGroups.filter(row => row.classification === 'DIRECT_ENEMY_PLAYER');
  const deathMatch = matchOneToOne({
    observations: directEnemyFatalGroups,
    slots: deathSlots,
    observationOwner: row => row.victimPlayer?.controllerEntityIndex ?? null,
    slotOwner: row => row.controllerEntityIndex,
    observationTick: row => row.tick,
    slotTick: row => row.tick,
    maxTicks: MATCH_WINDOW_TICKS
  });

  const deathConfirmedAnchors = deathMatch.matches.map(match => ({
    ...match.observation,
    victimDeathMatch: compactMatch(match)
  }));

  const killMatch = matchOneToOne({
    observations: deathConfirmedAnchors,
    slots: killSlots,
    observationOwner: row => row.attackerPlayer?.controllerEntityIndex ?? null,
    slotOwner: row => row.controllerEntityIndex,
    observationTick: row => row.tick,
    slotTick: row => row.tick,
    maxTicks: MATCH_WINDOW_TICKS
  });

  const placebo10 = placeboMatch(deathConfirmedAnchors, killSlots, PLACEBO_SHIFTS_TICKS[0]);
  const placebo30 = placeboMatch(deathConfirmedAnchors, killSlots, PLACEBO_SHIFTS_TICKS[1]);

  const matchedAnchorIds = new Set(killMatch.matches.map(row => row.observation.id));
  const anchorAuditRows = deathConfirmedAnchors.map(anchor => {
    const match = killMatch.matches.find(row => row.observation.id === anchor.id) ?? null;
    return {
      ...anchor,
      attackerKillMatch: match ? compactMatch(match) : null,
      attackerKillMatched: Boolean(match)
    };
  });

  const initialCounterViolations = [...firstCounterObservation.values()].filter(row =>
    (Number.isFinite(row.kills) && row.kills !== 0) ||
    (Number.isFinite(row.deaths) && row.deaths !== 0)
  );

  const integrityPass = counterRegressions.length === 0 && initialCounterViolations.length === 0;
  const outputDir = resolve('output', replayName);
  const summaryPath = resolve(outputDir, 'player_kill_credit_validation_v01.json');
  const anchorsPath = resolve(outputDir, 'player_kill_credit_anchors_v01.jsonl');
  mkdirSync(outputDir, { recursive: true });

  const evidence = {
    directFatalVictimDeathAgreement: ratio(deathMatch.matches.length, directEnemyFatalGroups.length),
    directFatalAnchorKillAgreement: ratio(killMatch.matches.length, deathConfirmedAnchors.length),
    scoreboardKillCreditsSupportedByDirectFatalAnchor: ratio(killMatch.matches.length, killSlots.length),
    placeboAgreement10s: ratio(placebo10.matches.length, deathConfirmedAnchors.length),
    placeboAgreement30s: ratio(placebo30.matches.length, deathConfirmedAnchors.length),
    killMatchTickResiduals: summarizeResiduals(killMatch.matches),
    deathMatchTickResiduals: summarizeResiduals(deathMatch.matches)
  };

  const summary = {
    version: 'PLAYER_KILL_CREDIT_VALIDATION_V01',
    canonical: false,
    replay: replayName,
    success: true,
    status: 'RESEARCH_EVIDENCE_EXTRACTED',
    createdAt: new Date().toISOString(),
    purpose: [
      'Test whether CCitadelPlayerController.m_iPlayerKills behaves as player kill credit using independent terminal player-damage telemetry.',
      'Use the independently validated m_iDeaths counter only to confirm that a terminal damage observation belongs to a scored victim death before testing attacker kill credit.',
      'Treat direct enemy player-pawn attacker attribution as a high-specificity semantic subset; do not infer ownership for unresolved projectile, summon, pet, DoT, or environment attackers.',
      'Preserve unmatched evidence and shifted-time placebo rates rather than forcing a semantic interpretation.'
    ],
    policy: {
      matchWindowTicks: MATCH_WINDOW_TICKS,
      matchWindowSeconds: MATCH_WINDOW_TICKS / TICK_RATE,
      terminalDamageSignal: 'victimHealthNew <= 0',
      fatalGrouping: 'same victim pawn + exact replay tick',
      highConfidenceAttacker: 'exactly one resolved enemy player-pawn attacker and no conflicting resolved self/friendly/player attacker in the fatal group',
      victimDeathConfirmation: 'one-to-one nearest m_iDeaths positive counter credit within match window',
      killCreditTest: 'one-to-one nearest m_iPlayerKills positive counter credit for the resolved attacker within match window',
      batchedCounterDeltaPolicy: 'positive delta N expands to N same-tick credit slots',
      placeboShiftsSeconds: PLACEBO_SHIFTS_TICKS.map(value => value / TICK_RATE),
      promotionPolicy: 'NO_AUTOMATIC_PROMOTION_FROM_THIS_SCRIPT'
    },
    telemetry,
    integrityValidation: {
      status: integrityPass ? 'pass' : 'fail',
      counterRegressions: counterRegressions.length,
      nonZeroInitialCounterObservations: initialCounterViolations.length,
      examples: {
        counterRegressions: counterRegressions.slice(0, 20),
        nonZeroInitialCounterObservations: initialCounterViolations.slice(0, 20)
      }
    },
    counts: {
      playersObserved: playerByControllerIndex.size,
      killCounterTransitions: killCounterEvents.length,
      scoreboardKillCredits: killSlots.length,
      deathCounterTransitions: deathCounterEvents.length,
      scoreboardDeathCredits: deathSlots.length,
      terminalPlayerDamageMessages: terminalDamageMessages.length,
      fatalDamageGroups: fatalGroups.length,
      directEnemyFatalGroups: directEnemyFatalGroups.length,
      deathConfirmedDirectEnemyFatalAnchors: deathConfirmedAnchors.length,
      anchorsMatchedToAttackerKillCredit: killMatch.matches.length,
      anchorsUnmatchedToAttackerKillCredit: killMatch.unmatchedObservations.length,
      killCreditsNotSupportedByDirectFatalAnchor: killMatch.unmatchedSlots.length,
      placeboMatches10s: placebo10.matches.length,
      placeboMatches30s: placebo30.matches.length
    },
    fatalGroupClassification: countBy(fatalGroups, row => row.classification),
    evidence,
    unmatched: {
      directEnemyFatalWithoutVictimDeathCredit: deathMatch.unmatchedObservations.slice(0, 50),
      deathConfirmedAnchorWithoutAttackerKillCredit: killMatch.unmatchedObservations.slice(0, 50),
      killCreditsWithoutDirectFatalAnchor: killMatch.unmatchedSlots.slice(0, 50)
    },
    finalCounters: [...finalCounterObservation.values()].sort(comparePlayers),
    outputs: {
      summary: summaryPath,
      anchors: anchorsPath
    },
    interpretationBoundary: {
      supportedIfAgreementIsHigh: 'Direct enemy player-pawn terminal damage that produces a scored victim death is followed by kill-credit increments on the resolved attacker.',
      notEstablishedByThisScript: [
        'That every m_iPlayerKills credit is caused by a directly attributed player-pawn damage packet.',
        'Ownership attribution for projectile, summon, pet, DoT, reflected, environmental, or other indirect damage.',
        'Assist semantics.',
        'Last-hit or deny semantics.',
        'Production/A-tier status.'
      ]
    }
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(
    anchorsPath,
    anchorAuditRows.map(row => JSON.stringify(row)).join('\n') + (anchorAuditRows.length ? '\n' : ''),
    'utf8'
  );

  return {
    replayName,
    success: true,
    status: summary.status,
    counts: summary.counts,
    evidence: summary.evidence,
    integrityValidation: summary.integrityValidation,
    outputs: summary.outputs
  };

  function placeboMatch(anchors, slots, shiftTicks) {
    const shiftedSlots = slots.map(slot => ({ ...slot, tick: slot.tick + shiftTicks }));
    return matchOneToOne({
      observations: anchors,
      slots: shiftedSlots,
      observationOwner: row => row.attackerPlayer?.controllerEntityIndex ?? null,
      slotOwner: row => row.controllerEntityIndex,
      observationTick: row => row.tick,
      slotTick: row => row.tick,
      maxTicks: MATCH_WINDOW_TICKS
    });
  }
}

function processController({
  entity,
  tick,
  playerByPawnIndex,
  playerByControllerIndex,
  previousController,
  firstCounterObservation,
  finalCounterObservation,
  killCounterEvents,
  deathCounterEvents,
  counterRegressions
}) {
  const controllerEntityIndex = getEntityIndex(entity);
  if (controllerEntityIndex === null) return;

  const playerName = stringOrNull(safeGetField(entity, 'm_iszPlayerName'));
  if (!playerName || playerName === 'SourceTV') return;

  const pawnHandle = handleOrNull(safeGetField(entity, 'm_hHeroPawn'))
    ?? handleOrNull(safeGetField(entity, 'm_hPawn'));
  const pawnEntityIndex = decodeHandleEntityIndex(pawnHandle);
  const current = {
    controllerEntityIndex,
    pawnEntityIndex,
    playerName,
    team: finite(safeGetField(entity, 'm_iTeamNum')),
    heroId: finite(safeGetField(entity, 'm_nHeroID')),
    playerSlot: finite(safeGetField(entity, 'm_iPlayerSlot')),
    steamId: scalarStringOrNull(safeGetField(entity, 'm_steamID')),
    kills: finite(safeGetField(entity, 'm_iPlayerKills')),
    deaths: finite(safeGetField(entity, 'm_iDeaths'))
  };

  const player = compactPlayer(current);
  playerByControllerIndex.set(controllerEntityIndex, player);
  if (pawnEntityIndex !== null) playerByPawnIndex.set(pawnEntityIndex, player);

  const first = firstCounterObservation.get(controllerEntityIndex) ?? {
    ...player,
    kills: null,
    killTick: null,
    deaths: null,
    deathTick: null
  };
  if (first.kills === null && Number.isFinite(current.kills)) {
    first.kills = current.kills;
    first.killTick = tick;
  }
  if (first.deaths === null && Number.isFinite(current.deaths)) {
    first.deaths = current.deaths;
    first.deathTick = tick;
  }
  firstCounterObservation.set(controllerEntityIndex, first);
  finalCounterObservation.set(controllerEntityIndex, { ...player, kills: current.kills, deaths: current.deaths, tick });

  const previous = previousController.get(controllerEntityIndex) ?? null;
  if (previous) {
    recordCounterDelta('kill', 'kills', previous, current, tick, killCounterEvents, counterRegressions);
    recordCounterDelta('death', 'deaths', previous, current, tick, deathCounterEvents, counterRegressions);
  }

  previousController.set(controllerEntityIndex, current);
}

function recordCounterDelta(kind, field, previous, current, tick, positiveEvents, regressions) {
  if (!Number.isFinite(previous[field]) || !Number.isFinite(current[field])) return;
  const delta = current[field] - previous[field];
  if (delta === 0) return;

  const row = {
    kind,
    tick,
    controllerEntityIndex: current.controllerEntityIndex,
    pawnEntityIndex: current.pawnEntityIndex,
    playerName: current.playerName,
    team: current.team,
    heroId: current.heroId,
    previous: previous[field],
    current: current[field],
    delta
  };

  if (delta > 0) positiveEvents.push(row);
  else regressions.push(row);
}

function expandCounterSlots(events, kind) {
  const slots = [];
  for (const event of events) {
    const count = Math.max(0, Math.trunc(event.delta));
    for (let i = 0; i < count; i++) {
      slots.push({
        id: `${kind}|${event.controllerEntityIndex}|${event.tick}|${i}`,
        kind,
        tick: event.tick,
        controllerEntityIndex: event.controllerEntityIndex,
        pawnEntityIndex: event.pawnEntityIndex,
        playerName: event.playerName,
        team: event.team,
        heroId: event.heroId,
        transitionDelta: event.delta,
        ordinalWithinTransition: i + 1
      });
    }
  }
  return slots;
}

function groupTerminalDamageMessages(messages) {
  const groups = new Map();

  for (const row of messages) {
    const key = `${row.victimIndex}|${row.tick}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const first = rows[0];
      const resolvedAttackers = uniqueBy(
        rows.map(row => row.attackerPlayer).filter(Boolean),
        row => row.controllerEntityIndex
      );
      const enemyAttackers = resolvedAttackers.filter(row =>
        Number.isFinite(row.team) &&
        Number.isFinite(first.victimPlayer?.team) &&
        row.team !== first.victimPlayer.team &&
        row.controllerEntityIndex !== first.victimPlayer?.controllerEntityIndex
      );
      const conflictingResolved = resolvedAttackers.filter(row =>
        !enemyAttackers.some(enemy => enemy.controllerEntityIndex === row.controllerEntityIndex)
      );

      let classification = 'UNRESOLVED_ATTACKER';
      let attackerPlayer = null;

      if (enemyAttackers.length === 1 && conflictingResolved.length === 0) {
        classification = 'DIRECT_ENEMY_PLAYER';
        attackerPlayer = enemyAttackers[0];
      } else if (enemyAttackers.length > 1) {
        classification = 'AMBIGUOUS_MULTIPLE_ENEMY_PLAYERS';
      } else if (resolvedAttackers.length > 0) {
        const hasSelf = resolvedAttackers.some(row =>
          row.controllerEntityIndex === first.victimPlayer?.controllerEntityIndex
        );
        classification = hasSelf ? 'SELF_ATTRIBUTED' : 'FRIENDLY_OR_OTHER_PLAYER';
      }

      return {
        id: `fatal|${key}`,
        tick: first.tick,
        victimIndex: first.victimIndex,
        victimPlayer: first.victimPlayer,
        attackerPlayer,
        classification,
        terminalMessageCount: rows.length,
        unresolvedAttackerMessageCount: rows.filter(row => !row.attackerPlayer).length,
        resolvedAttackers,
        messages: rows
      };
    })
    .sort((a, b) => a.tick - b.tick);
}

function matchOneToOne({
  observations,
  slots,
  observationOwner,
  slotOwner,
  observationTick,
  slotTick,
  maxTicks
}) {
  const edges = [];

  for (let observationIndex = 0; observationIndex < observations.length; observationIndex++) {
    const observation = observations[observationIndex];
    const owner = observationOwner(observation);
    const tick = observationTick(observation);
    if (owner === null || owner === undefined || !Number.isFinite(tick)) continue;

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex];
      if (slotOwner(slot) !== owner) continue;
      const otherTick = slotTick(slot);
      if (!Number.isFinite(otherTick)) continue;
      const signedTickDelta = otherTick - tick;
      const absoluteTickDelta = Math.abs(signedTickDelta);
      if (absoluteTickDelta > maxTicks) continue;
      edges.push({ observationIndex, slotIndex, signedTickDelta, absoluteTickDelta });
    }
  }

  edges.sort((a, b) =>
    a.absoluteTickDelta - b.absoluteTickDelta ||
    Math.abs(a.signedTickDelta) - Math.abs(b.signedTickDelta) ||
    a.observationIndex - b.observationIndex ||
    a.slotIndex - b.slotIndex
  );

  const usedObservations = new Set();
  const usedSlots = new Set();
  const matches = [];

  for (const edge of edges) {
    if (usedObservations.has(edge.observationIndex) || usedSlots.has(edge.slotIndex)) continue;
    usedObservations.add(edge.observationIndex);
    usedSlots.add(edge.slotIndex);
    matches.push({
      observation: observations[edge.observationIndex],
      slot: slots[edge.slotIndex],
      signedTickDelta: edge.signedTickDelta,
      absoluteTickDelta: edge.absoluteTickDelta,
      signedSecondsDelta: edge.signedTickDelta / TICK_RATE,
      absoluteSecondsDelta: edge.absoluteTickDelta / TICK_RATE
    });
  }

  return {
    matches,
    unmatchedObservations: observations.filter((_, index) => !usedObservations.has(index)),
    unmatchedSlots: slots.filter((_, index) => !usedSlots.has(index))
  };
}

function compactMatch(match) {
  return {
    slotId: match.slot?.id ?? null,
    slotTick: match.slot?.tick ?? null,
    signedTickDelta: match.signedTickDelta,
    absoluteTickDelta: match.absoluteTickDelta,
    signedSecondsDelta: match.signedSecondsDelta,
    absoluteSecondsDelta: match.absoluteSecondsDelta
  };
}

function buildBatchSummary(requestedReplays, replayResults, successful) {
  const total = key => successful.reduce((sum, row) => sum + (row.counts?.[key] ?? 0), 0);
  const anchors = total('deathConfirmedDirectEnemyFatalAnchors');
  const matchedKills = total('anchorsMatchedToAttackerKillCredit');
  const directGroups = total('directEnemyFatalGroups');

  const placebo10Matches = total('placeboMatches10s');
  const placebo30Matches = total('placeboMatches30s');

  return {
    version: 'PLAYER_KILL_CREDIT_VALIDATION_BATCH_V01',
    canonical: false,
    createdAt: new Date().toISOString(),
    requestedReplays,
    successCount: successful.length,
    replayCount: replayResults.length,
    allRequestedReplaysSucceeded: successful.length === requestedReplays.length,
    researchQuestion: 'Does CCitadelPlayerController.m_iPlayerKills behave as player kill credit when tested against independently observed direct enemy player terminal-damage events that are confirmed by scored victim deaths?',
    validationTaxonomy: {
      integrityValidation: 'Counter monotonicity and zero-start are tested here.',
      semanticValidation: 'This script provides evidence only; promotion requires review of cross-replay agreement, residuals, placebos, and unresolved cases.',
      replicationStatus: 'Cross-replay only if independent rep01-rep05 all run successfully and support the same interpretation.'
    },
    aggregate: {
      counts: {
        scoreboardKillCredits: total('scoreboardKillCredits'),
        scoreboardDeathCredits: total('scoreboardDeathCredits'),
        directEnemyFatalGroups: directGroups,
        deathConfirmedDirectEnemyFatalAnchors: anchors,
        anchorsMatchedToAttackerKillCredit: matchedKills
      },
      evidence: {
        directFatalVictimDeathAgreement: ratio(anchors, directGroups),
        directFatalAnchorKillAgreement: ratio(matchedKills, anchors),
        scoreboardKillCreditsSupportedByDirectFatalAnchor: ratio(matchedKills, total('scoreboardKillCredits')),
        placeboAgreement10s: ratio(placebo10Matches, anchors),
        placeboAgreement30s: ratio(placebo30Matches, anchors)
      }
    },
    replayResults,
    decision: {
      promotionPerformed: false,
      nextAction: 'Review evidence. If direct-fatal attacker attribution shows near-deterministic cross-replay agreement with low placebo rates, create a separate claim-registry promotion and production/inspector patch. Otherwise diagnose residual cases before promotion.'
    }
  };
}

function findPlayerForPawnIndex(demo, pawnIndex, playerByPawnIndex, playerByControllerIndex) {
  const cached = playerByPawnIndex.get(pawnIndex) ?? null;
  if (cached) return cached;

  const controllers = demo?.getEntitiesByClassName?.('CCitadelPlayerController') ?? [];
  for (const controller of controllers) {
    const controllerEntityIndex = getEntityIndex(controller);
    const playerName = stringOrNull(safeGetField(controller, 'm_iszPlayerName'));
    if (!playerName || playerName === 'SourceTV' || controllerEntityIndex === null) continue;

    const pawnHandle = handleOrNull(safeGetField(controller, 'm_hHeroPawn'))
      ?? handleOrNull(safeGetField(controller, 'm_hPawn'));
    const decoded = decodeHandleEntityIndex(pawnHandle);
    if (decoded === null) continue;

    const player = compactPlayer({
      controllerEntityIndex,
      pawnEntityIndex: decoded,
      playerName,
      team: finite(safeGetField(controller, 'm_iTeamNum')),
      heroId: finite(safeGetField(controller, 'm_nHeroID')),
      playerSlot: finite(safeGetField(controller, 'm_iPlayerSlot')),
      steamId: scalarStringOrNull(safeGetField(controller, 'm_steamID'))
    });

    playerByControllerIndex.set(controllerEntityIndex, player);
    playerByPawnIndex.set(decoded, player);
    if (decoded === pawnIndex) return player;
  }
  return null;
}

function compactPlayer(player) {
  if (!player) return null;
  return {
    controllerEntityIndex: finite(player.controllerEntityIndex),
    pawnEntityIndex: finite(player.pawnEntityIndex),
    playerName: stringOrNull(player.playerName),
    team: finite(player.team),
    heroId: finite(player.heroId),
    playerSlot: finite(player.playerSlot),
    steamId: scalarStringOrNull(player.steamId)
  };
}

function decodeMessageType(type) {
  if (type === null || type === undefined) return null;
  const code = type?._code ?? type?.code ?? null;
  if (code !== null && code !== undefined) return String(code);
  const id = type?._id ?? type?.id ?? null;
  if (id !== null && id !== undefined) return `MESSAGE_ID_${id}`;
  return String(type);
}

function getMessageData(packet) {
  return packet?.data ?? packet?.message ?? packet?.payload ?? packet ?? null;
}

function findEntityReference(object, patterns) {
  return findValueByKeyPatterns(object, patterns, 4)?.value ?? null;
}

function findNumberByPatterns(object, patterns) {
  return finite(findValueByKeyPatterns(object, patterns, 4)?.value);
}

function findValueByKeyPatterns(root, patterns, maxDepth) {
  const seen = new Set();
  const queue = [{ value: root, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    const value = current.value;
    if (value === null || value === undefined || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);

    for (const [key, nested] of Object.entries(value)) {
      if (patterns.some(pattern => pattern.test(key))) return { key, value: nested };
      if (current.depth < maxDepth && nested !== null && typeof nested === 'object') {
        queue.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function getEntityClassName(entity) {
  try {
    if (typeof entity?.getClassName === 'function') {
      const value = entity.getClassName();
      if (value) return String(value);
    }
  } catch {}
  return entity?.className ?? entity?.class?.name ?? entity?._className ?? null;
}

function getEntityIndex(entity) {
  const direct = finite(entity?.index ?? entity?.entityIndex);
  if (direct !== null) return direct;
  try {
    return typeof entity?.getIndex === 'function' ? finite(entity.getIndex()) : null;
  } catch {
    return null;
  }
}

function safeGetField(entity, fieldName) {
  try {
    return typeof entity?.getField === 'function' ? entity.getField(fieldName) : undefined;
  } catch {
    return undefined;
  }
}

function handleOrNull(value) {
  if (value === null || value === undefined) return null;
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed === 16777215n) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeHandleEntityIndex(value) {
  if (value === null || value === undefined) return null;
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed === 16777215n) return null;
    return Number(parsed & BigInt(ENTITY_INDEX_MASK));
  } catch {
    return null;
  }
}

function normalizeEntityReference(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    for (const key of ['entityIndex', 'entindex', 'index', 'handle', 'value', 'id']) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const normalized = normalizeEntityReference(value[key]);
      if (normalized !== null) return normalized;
    }
    return null;
  }

  const number = finite(value);
  if (number === null) return null;
  const integer = Math.trunc(number);
  if (integer >= 0 && integer <= ENTITY_INDEX_MASK) return integer;
  const masked = integer & ENTITY_INDEX_MASK;
  return masked >= 0 && masked <= ENTITY_INDEX_MASK ? masked : null;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function scalarStringOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    try {
      return typeof value.toString === 'function' ? String(value.toString()) : null;
    } catch {
      return null;
    }
  }
  return String(value);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function formatPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function summarizeResiduals(matches) {
  const values = matches.map(row => row.signedTickDelta).filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length === 0) return { n: 0, minTicks: null, medianTicks: null, maxTicks: null, meanAbsTicks: null };
  const abs = values.map(Math.abs);
  return {
    n: values.length,
    minTicks: values[0],
    medianTicks: median(values),
    maxTicks: values[values.length - 1],
    meanAbsTicks: abs.reduce((sum, value) => sum + value, 0) / abs.length,
    medianAbsTicks: median(abs.sort((a, b) => a - b))
  };
}

function median(values) {
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows) {
    const key = String(keyFn(row) ?? 'UNKNOWN');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function comparePlayers(a, b) {
  return (a.team ?? 0) - (b.team ?? 0) ||
    (a.playerSlot ?? 0) - (b.playerSlot ?? 0) ||
    String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
}
