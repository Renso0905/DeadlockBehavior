import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

const TICK_RATE = 64;
const MATCH_WINDOW_TICKS = 32;        // 0.5 s: same window as Script 208
const NEARBY_VICTIM_WINDOW_TICKS = 5 * TICK_RATE;

const requestedReplays =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['test', 'rep01', 'rep02', 'rep03', 'rep04', 'rep05'];

const outputPath = resolve(
  'output',
  'cross_replay',
  'player_kill_credit_residual_diagnostics_v01.json'
);

console.log('');
console.log('========================================================');
console.log('PLAYER KILL CREDIT RESIDUAL DIAGNOSTICS V0.1');
console.log('========================================================');
console.log(`Replays: ${requestedReplays.join(', ')}`);
console.log('');

const replayResults = [];

for (const replayName of requestedReplays) {
  const summaryPath = resolve(
    'output',
    replayName,
    'player_kill_credit_validation_v01.json'
  );

  const anchorsPath = resolve(
    'output',
    replayName,
    'player_kill_credit_anchors_v01.jsonl'
  );

  if (!existsSync(summaryPath) || !existsSync(anchorsPath)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'REQUIRED_SCRIPT208_OUTPUT_MISSING',
      missing: [
        ...(!existsSync(summaryPath) ? [summaryPath] : []),
        ...(!existsSync(anchorsPath) ? [anchorsPath] : [])
      ]
    });
    console.log(`${replayName.padEnd(10)} missing Script 208 outputs`);
    continue;
  }

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const anchors = readJsonl(anchorsPath);

  const unmatchedFatal =
    summary?.unmatched?.directEnemyFatalWithoutVictimDeathCredit ?? [];

  const unmatchedKill =
    summary?.unmatched?.killCreditsWithoutDirectFatalAnchor ?? [];

  const fatalToKill = matchOneToOne({
    observations: unmatchedFatal,
    slots: unmatchedKill,
    observationOwner: row => row?.attackerPlayer?.controllerEntityIndex ?? null,
    slotOwner: row => row?.controllerEntityIndex ?? null,
    observationTick: row => finite(row?.tick),
    slotTick: row => finite(row?.tick),
    maxTicks: MATCH_WINDOW_TICKS
  });

  const fatalDiagnostics = unmatchedFatal.map(fatal => {
    const pairedKill =
      fatalToKill.matches.find(row => row.observation === fatal) ?? null;

    const nearestVictimAnchor =
      nearestSameVictimAnchor(fatal, anchors);

    return {
      fatalId: fatal?.id ?? null,
      tick: fatal?.tick ?? null,
      attackerPlayer: fatal?.attackerPlayer ?? null,
      victimPlayer: fatal?.victimPlayer ?? null,
      terminalMessageCount: fatal?.terminalMessageCount ?? null,
      unresolvedAttackerMessageCount:
        fatal?.unresolvedAttackerMessageCount ?? null,

      pairedUnmatchedKillCredit: pairedKill
        ? {
            tick: pairedKill.slot?.tick ?? null,
            playerName: pairedKill.slot?.playerName ?? null,
            controllerEntityIndex:
              pairedKill.slot?.controllerEntityIndex ?? null,
            signedTickDelta: pairedKill.signedTickDelta,
            signedSecondsDelta: pairedKill.signedTickDelta / TICK_RATE
          }
        : null,

      nearestDeathConfirmedAnchorForSameVictim:
        nearestVictimAnchor
    };
  });

  const pairedFatalCount = fatalToKill.matches.length;
  const unpairedFatalCount = fatalToKill.unmatchedObservations.length;
  const unpairedKillCount = fatalToKill.unmatchedSlots.length;

  const nearExistingVictimAnchor = fatalDiagnostics.filter(row =>
    row.nearestDeathConfirmedAnchorForSameVictim &&
    row.nearestDeathConfirmedAnchorForSameVictim.absoluteTickDelta <=
      NEARBY_VICTIM_WINDOW_TICKS
  ).length;

  const result = {
    replayName,
    success: true,
    counts: {
      scoreboardKillCredits: summary?.counts?.scoreboardKillCredits ?? null,
      directEnemyFatalGroups: summary?.counts?.directEnemyFatalGroups ?? null,
      deathConfirmedDirectEnemyFatalAnchors:
        summary?.counts?.deathConfirmedDirectEnemyFatalAnchors ?? null,

      unmatchedDirectEnemyFatalWithoutVictimDeathCredit:
        unmatchedFatal.length,

      unmatchedKillCreditsWithoutDeathConfirmedDirectFatalAnchor:
        unmatchedKill.length,

      unmatchedFatalPairedToUnmatchedKillCredit:
        pairedFatalCount,

      unmatchedFatalStillUnpaired:
        unpairedFatalCount,

      unmatchedKillCreditsStillUnpaired:
        unpairedKillCount,

      unmatchedFatalNearExistingSameVictimDeathAnchorWithin5s:
        nearExistingVictimAnchor
    },
    fatalToKillResidualMatch: {
      windowTicks: MATCH_WINDOW_TICKS,
      windowSeconds: MATCH_WINDOW_TICKS / TICK_RATE,
      matches: fatalToKill.matches.map(compactMatch)
    },
    fatalDiagnostics,
    remainingUnpairedKillCredits: fatalToKill.unmatchedSlots
  };

  replayResults.push(result);

  console.log(
    `${replayName.padEnd(10)} ` +
    `fatalNoDeath=${String(unmatchedFatal.length).padStart(2)} ` +
    `killNoAnchor=${String(unmatchedKill.length).padStart(2)} ` +
    `fatal↔kill=${String(pairedFatalCount).padStart(2)} ` +
    `killRemain=${String(unpairedKillCount).padStart(2)}`
  );
}

const successful = replayResults.filter(row => row.success);

const total = key =>
  successful.reduce(
    (sum, row) => sum + (finite(row?.counts?.[key]) ?? 0),
    0
  );

const aggregate = {
  unmatchedDirectEnemyFatalWithoutVictimDeathCredit:
    total('unmatchedDirectEnemyFatalWithoutVictimDeathCredit'),

  unmatchedKillCreditsWithoutDeathConfirmedDirectFatalAnchor:
    total('unmatchedKillCreditsWithoutDeathConfirmedDirectFatalAnchor'),

  unmatchedFatalPairedToUnmatchedKillCredit:
    total('unmatchedFatalPairedToUnmatchedKillCredit'),

  unmatchedFatalStillUnpaired:
    total('unmatchedFatalStillUnpaired'),

  unmatchedKillCreditsStillUnpaired:
    total('unmatchedKillCreditsStillUnpaired'),

  unmatchedFatalNearExistingSameVictimDeathAnchorWithin5s:
    total('unmatchedFatalNearExistingSameVictimDeathAnchorWithin5s')
};

const batch = {
  version: 'PLAYER_KILL_CREDIT_RESIDUAL_DIAGNOSTICS_V01',
  canonical: false,
  createdAt: new Date().toISOString(),
  requestedReplays,
  successCount: successful.length,
  replayCount: replayResults.length,
  allRequestedReplaysSucceeded:
    successful.length === requestedReplays.length,

  purpose: [
    'Diagnose the residual cases left by Script 208 without reparsing raw replays.',
    'Test whether a direct enemy terminal-damage group that lacked a victim m_iDeaths credit nevertheless aligns with an otherwise-unmatched attacker m_iPlayerKills credit.',
    'Detect repeated/nearby terminal-damage groups around an already death-confirmed event for the same victim.',
    'Preserve remaining unmatched kill credits for a later raw-event attribution pass.'
  ],

  boundaries: {
    noNewSemanticClaim: true,
    noMetricPromotion: true,
    usesOnlyScript208Outputs: true,
    note:
      'This diagnostic cannot classify projectile/summon/DoT/environment kill credits because Script 208 V01 did not persist every unresolved fatal-damage group.'
  },

  aggregate,
  replays: replayResults,

  decisionGuide: {
    ifFatalNoDeathPairsToKill:
      'These cases show terminal enemy-player damage plus attacker kill credit without victim m_iDeaths credit; inspect them individually before treating m_iDeaths as a universal victim-death confirmation gate.',

    ifFatalNoDeathNearExistingVictimAnchor:
      'These are candidates for duplicate/repeated terminal-damage packets around one scored death.',

    remainingKillCredits:
      'Any kill credits still unmatched after this pass require a V02 raw-event extraction that persists unresolved/indirect fatal groups.'
  }
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(batch, null, 2), 'utf8');

console.log('');
console.log('========================================================');
console.log('AGGREGATE RESIDUALS');
console.log('========================================================');
console.log(
  `Direct fatal groups without victim death credit: ${aggregate.unmatchedDirectEnemyFatalWithoutVictimDeathCredit}`
);
console.log(
  `Kill credits without death-confirmed direct anchor: ${aggregate.unmatchedKillCreditsWithoutDeathConfirmedDirectFatalAnchor}`
);
console.log(
  `Residual fatal ↔ kill matches: ${aggregate.unmatchedFatalPairedToUnmatchedKillCredit}`
);
console.log(
  `Fatal residuals still unpaired: ${aggregate.unmatchedFatalStillUnpaired}`
);
console.log(
  `Kill credits still unpaired: ${aggregate.unmatchedKillCreditsStillUnpaired}`
);
console.log(
  `Fatal residuals near same-victim confirmed anchor (≤5 s): ${aggregate.unmatchedFatalNearExistingSameVictimDeathAnchorWithin5s}`
);
console.log(`Output: ${outputPath}`);
console.log('');

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function nearestSameVictimAnchor(fatal, anchors) {
  const victimController =
    fatal?.victimPlayer?.controllerEntityIndex ?? null;

  const victimPawn =
    fatal?.victimPlayer?.pawnEntityIndex ??
    fatal?.victimIndex ??
    null;

  const tick = finite(fatal?.tick);

  if (tick === null) return null;

  const candidates = anchors
    .filter(anchor => {
      const anchorController =
        anchor?.victimPlayer?.controllerEntityIndex ?? null;

      const anchorPawn =
        anchor?.victimPlayer?.pawnEntityIndex ??
        anchor?.victimIndex ??
        null;

      if (
        victimController !== null &&
        anchorController !== null
      ) {
        return victimController === anchorController;
      }

      return (
        victimPawn !== null &&
        anchorPawn !== null &&
        victimPawn === anchorPawn
      );
    })
    .map(anchor => {
      const anchorTick = finite(anchor?.tick);
      return {
        anchor,
        signedTickDelta:
          anchorTick === null ? null : anchorTick - tick,
        absoluteTickDelta:
          anchorTick === null ? null : Math.abs(anchorTick - tick)
      };
    })
    .filter(row => Number.isFinite(row.absoluteTickDelta))
    .sort((a, b) => a.absoluteTickDelta - b.absoluteTickDelta);

  if (candidates.length === 0) return null;

  const best = candidates[0];

  return {
    fatalTick: tick,
    anchorId: best.anchor?.id ?? null,
    anchorTick: best.anchor?.tick ?? null,
    signedTickDelta: best.signedTickDelta,
    absoluteTickDelta: best.absoluteTickDelta,
    signedSecondsDelta: best.signedTickDelta / TICK_RATE,
    absoluteSecondsDelta: best.absoluteTickDelta / TICK_RATE
  };
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

  for (
    let observationIndex = 0;
    observationIndex < observations.length;
    observationIndex++
  ) {
    const observation = observations[observationIndex];
    const owner = observationOwner(observation);
    const tick = observationTick(observation);

    if (
      owner === null ||
      owner === undefined ||
      !Number.isFinite(tick)
    ) continue;

    for (
      let slotIndex = 0;
      slotIndex < slots.length;
      slotIndex++
    ) {
      const slot = slots[slotIndex];

      if (slotOwner(slot) !== owner) continue;

      const otherTick = slotTick(slot);
      if (!Number.isFinite(otherTick)) continue;

      const signedTickDelta = otherTick - tick;
      const absoluteTickDelta = Math.abs(signedTickDelta);

      if (absoluteTickDelta > maxTicks) continue;

      edges.push({
        observationIndex,
        slotIndex,
        signedTickDelta,
        absoluteTickDelta
      });
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
    if (
      usedObservations.has(edge.observationIndex) ||
      usedSlots.has(edge.slotIndex)
    ) continue;

    usedObservations.add(edge.observationIndex);
    usedSlots.add(edge.slotIndex);

    matches.push({
      observation: observations[edge.observationIndex],
      slot: slots[edge.slotIndex],
      signedTickDelta: edge.signedTickDelta,
      absoluteTickDelta: edge.absoluteTickDelta
    });
  }

  return {
    matches,
    unmatchedObservations:
      observations.filter(
        (_, index) => !usedObservations.has(index)
      ),
    unmatchedSlots:
      slots.filter((_, index) => !usedSlots.has(index))
  };
}

function compactMatch(match) {
  return {
    fatalId: match?.observation?.id ?? null,
    fatalTick: match?.observation?.tick ?? null,
    attackerPlayer:
      match?.observation?.attackerPlayer ?? null,
    victimPlayer:
      match?.observation?.victimPlayer ?? null,
    killSlotId: match?.slot?.id ?? null,
    killSlotTick: match?.slot?.tick ?? null,
    killPlayerName: match?.slot?.playerName ?? null,
    signedTickDelta: match?.signedTickDelta ?? null,
    absoluteTickDelta: match?.absoluteTickDelta ?? null,
    signedSecondsDelta:
      Number.isFinite(match?.signedTickDelta)
        ? match.signedTickDelta / TICK_RATE
        : null
  };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
