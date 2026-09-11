import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

import {
  Parser,
  InterceptorStage
} from 'deadem';

// ============================================================
// SCRIPT 210
// PLAYER KILL INDIRECT-ATTRIBUTION DISCOVERY V0.1
//
// Purpose:
// - Start only from Script 208 kill credits that lacked a
//   death-confirmed direct player-pawn fatal anchor.
// - Reparse each replay and inspect damage packets near those
//   residual kill-credit ticks.
// - Preserve attacker / inflictor / ability entity snapshots.
// - Test only conservative direct or single-hop player-reference
//   candidates. Do NOT promote a semantic claim here.
//
// This is research evidence only.
// ============================================================

const TICK_RATE = 64;
const ENTITY_INDEX_MASK = 0x3fff;
const KILL_CONTEXT_WINDOW_TICKS = 64;      // +/- 1.0 s
const DEATH_CONFIRM_WINDOW_TICKS = 32;     // +/- 0.5 s
const DEFAULT_REPLAYS = [
  'test',
  'rep01',
  'rep02',
  'rep03',
  'rep04',
  'rep05'
];

const requested =
  process.argv.slice(2).filter(Boolean);

const replayNames =
  requested.length > 0
    ? requested
    : DEFAULT_REPLAYS;

const batchOutputPath =
  resolve(
    'output',
    'cross_replay',
    'player_kill_indirect_attribution_discovery_batch_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('PLAYER KILL INDIRECT-ATTRIBUTION DISCOVERY V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const replayResults = [];

for (const replayName of replayNames) {
  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`
    );

  const script208SummaryPath =
    resolve(
      'output',
      replayName,
      'player_kill_credit_validation_v01.json'
    );

  if (!existsSync(replayPath)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'REPLAY_MISSING',
      replayPath
    });

    console.log(
      `${replayName.padEnd(10)} replay missing`
    );

    continue;
  }

  if (!existsSync(script208SummaryPath)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'SCRIPT208_SUMMARY_MISSING',
      script208SummaryPath
    });

    console.log(
      `${replayName.padEnd(10)} Script 208 output missing`
    );

    continue;
  }

  const script208 =
    JSON.parse(
      readFileSync(
        script208SummaryPath,
        'utf8'
      )
    );

  const residualKillSlots =
    Array.isArray(
      script208
        ?.unmatched
        ?.killCreditsWithoutDirectFatalAnchor
    )
      ? script208.unmatched.killCreditsWithoutDirectFatalAnchor
      : [];

  const expectedResidualCount =
    finite(
      script208
        ?.counts
        ?.killCreditsNotSupportedByDirectFatalAnchor
    )
    ??
    residualKillSlots.length;

  if (
    expectedResidualCount !==
    residualKillSlots.length
  ) {
    replayResults.push({
      replayName,
      success: false,
      status: 'SCRIPT208_RESIDUAL_LIST_TRUNCATED',
      expectedResidualCount,
      availableResidualRows: residualKillSlots.length
    });

    console.log(
      `${replayName.padEnd(10)} residual list truncated`
    );

    continue;
  }

  try {
    const result =
      await inspectReplay({
        replayName,
        replayPath,
        residualKillSlots
      });

    replayResults.push(result);

    console.log(
      `${replayName.padEnd(10)} ` +
      `residualKills=${String(result.counts.residualKillCredits).padStart(2)} ` +
      `terminalCtx=${String(result.counts.residualKillsWithDeathConfirmedTerminalContext).padStart(2)} ` +
      `singleHop=${String(result.counts.residualKillsWithUniqueSingleHopOwnerMatch).padStart(2)} ` +
      `unresolved=${String(result.counts.residualKillsWithoutOwnerMatchedTerminalContext).padStart(2)}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success: false,
      status: 'DISCOVERY_EXCEPTION',
      error:
        error?.stack ??
        String(error)
    });

    console.log(
      `${replayName.padEnd(10)} ERROR`
    );

    console.error(error);
  }
}

const successful =
  replayResults.filter(
    row =>
      row.success
  );

const aggregate =
  aggregateResults(successful);

const batch = {
  version:
    'PLAYER_KILL_INDIRECT_ATTRIBUTION_DISCOVERY_BATCH_V01',

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  requestedReplays:
    replayNames,

  replayCount:
    replayNames.length,

  successCount:
    successful.length,

  allRequestedReplaysSucceeded:
    successful.length ===
      replayNames.length,

  purpose: [
    'Investigate Script 208 kill-credit residuals that were not explained by death-confirmed direct player-pawn fatal damage.',
    'Capture nearby player-victim damage messages and attacker / inflictor / ability entity snapshots.',
    'Identify conservative direct or single-hop player-reference ownership candidates without treating them as established game semantics.',
    'Preserve unresolved residuals for the next research step.'
  ],

  authorityBoundary: {
    researchOnly:
      true,

    promotesClaim:
      false,

    promotesMetric:
      false,

    ownerReferenceInterpretation:
      'DISCOVERY_CANDIDATE_ONLY',

    warning:
      'A field or entity reference that points to a player is not automatically a validated causal/ownership relation.'
  },

  windows: {
    killContextTicks:
      KILL_CONTEXT_WINDOW_TICKS,

    killContextSeconds:
      KILL_CONTEXT_WINDOW_TICKS /
      TICK_RATE,

    victimDeathConfirmationTicks:
      DEATH_CONFIRM_WINDOW_TICKS,

    victimDeathConfirmationSeconds:
      DEATH_CONFIRM_WINDOW_TICKS /
      TICK_RATE
  },

  aggregate,

  replays:
    replayResults
};

mkdirSync(
  dirname(
    batchOutputPath
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  batchOutputPath,
  JSON.stringify(
    batch,
    null,
    2
  ),
  'utf8'
);

console.log('');
console.log('========================================================');
console.log('BATCH RESIDUAL ATTRIBUTION');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Residual kill credits: ${aggregate.counts.residualKillCredits}`);
console.log(
  `With death-confirmed terminal context: ` +
  `${aggregate.counts.residualKillsWithDeathConfirmedTerminalContext}`
);
console.log(
  `With unique single-hop owner candidate matching killer: ` +
  `${aggregate.counts.residualKillsWithUniqueSingleHopOwnerMatch}`
);
console.log(
  `With direct known-player attacker matching killer: ` +
  `${aggregate.counts.residualKillsWithDirectKnownPlayerMatch}`
);
console.log(
  `Still without owner-matched terminal context: ` +
  `${aggregate.counts.residualKillsWithoutOwnerMatchedTerminalContext}`
);
console.log(`Output: ${batchOutputPath}`);
console.log('');
console.log(
  'IMPORTANT: owner references discovered here are candidates, not yet semantic authority.'
);
console.log('');

async function inspectReplay({
  replayName,
  replayPath,
  residualKillSlots
}) {
  const parser =
    new Parser();

  const playerByPawnIndex =
    new Map();

  const playerByControllerIndex =
    new Map();

  const previousController =
    new Map();

  const deathCounterEvents =
    [];

  const entityStateByIndex =
    new Map();

  const nearbyDamageMessages =
    [];

  const telemetry = {
    entityPackets:
      0,

    entityEvents:
      0,

    controllerEvents:
      0,

    messagePackets:
      0,

    damageLikeMessages:
      0,

    nearbyDamageLikeMessages:
      0,

    nearbyPlayerVictimDamageMessages:
      0,

    nearbyTerminalPlayerVictimDamageMessages:
      0
  };

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (
      demoPacket,
      _messagePacket,
      events
    ) => {
      const tick =
        finite(
          demoPacket?.tick
        );

      if (tick === null) {
        return;
      }

      telemetry.entityPackets++;

      for (
        const event
        of events ??
        []
      ) {
        telemetry.entityEvents++;

        const entity =
          event?.entity;

        if (!entity) {
          continue;
        }

        const entityIndex =
          getEntityIndex(
            entity
          );

        if (
          entityIndex !==
          null
        ) {
          updateEntitySnapshot({
            entityStateByIndex,
            event,
            entity,
            entityIndex,
            tick
          });
        }

        const className =
          getEntityClassName(
            entity
          );

        if (
          className ===
          'CCitadelPlayerController'
        ) {
          telemetry.controllerEvents++;

          processController({
            entity,
            tick,
            playerByPawnIndex,
            playerByControllerIndex,
            previousController,
            deathCounterEvents
          });
        }
      }
    }
  );

  parser.registerPostInterceptor(
    InterceptorStage.MESSAGE_PACKET,
    (
      demoPacket,
      messagePacket
    ) => {
      const tick =
        finite(
          demoPacket?.tick
        );

      if (tick === null) {
        return;
      }

      telemetry.messagePackets++;

      if (
        !isNearAnyKillSlot(
          tick,
          residualKillSlots,
          KILL_CONTEXT_WINDOW_TICKS
        )
      ) {
        return;
      }

      const type =
        decodeMessageType(
          messagePacket?.type
        );

      if (
        !type
        ||
        !/DAMAGE/i.test(type)
      ) {
        return;
      }

      telemetry.damageLikeMessages++;
      telemetry.nearbyDamageLikeMessages++;

      const data =
        getMessageData(
          messagePacket
        );

      const victimIndex =
        normalizeEntityReference(
          findEntityReference(
            data,
            [
              /entindexvictim/i,
              /entindex_victim/i,
              /victimentityindex/i,
              /victimindex/i,
              /^victim$/i,
              /hvictim/i
            ]
          )
        );

      if (
        victimIndex ===
        null
      ) {
        return;
      }

      let victimPlayer =
        resolveKnownPlayer(
          victimIndex,
          playerByPawnIndex,
          playerByControllerIndex
        );

      if (!victimPlayer) {
        victimPlayer =
          findPlayerForPawnIndex(
            parser.getDemo(),
            victimIndex,
            playerByPawnIndex,
            playerByControllerIndex
          );
      }

      if (!victimPlayer) {
        return;
      }

      telemetry
        .nearbyPlayerVictimDamageMessages++;

      const attackerIndex =
        normalizeEntityReference(
          findEntityReference(
            data,
            [
              /entindexattacker/i,
              /entindex_attacker/i,
              /attackerentityindex/i,
              /attackerindex/i,
              /^attacker$/i,
              /hattacker/i
            ]
          )
        );

      const entindexInflictor =
        normalizeEntityReference(
          firstPresent([
            data?.entindexInflictor,
            data?.entindex_inflictor,
            findEntityReference(
              data,
              [
                /entindexinflictor/i,
                /entindex_inflictor/i,
                /inflictorindex/i
              ]
            )
          ])
        );

      const entindexAbility =
        normalizeEntityReference(
          firstPresent([
            data?.entindexAbility,
            data?.entindex_ability,
            findEntityReference(
              data,
              [
                /entindexability/i,
                /entindex_ability/i,
                /abilityindex/i
              ]
            )
          ])
        );

      const victimHealthNew =
        firstFinite([
          data?.victimHealthNew,
          data?.victim_health_new,
          findNumberByPatterns(
            data,
            [
              /^victimHealthNew$/i,
              /^victim_health_new$/i,
              /victim.*health.*new/i,
              /health.*new.*victim/i
            ]
          )
        ]);

      const terminal =
        victimHealthNew !==
          null
        &&
        victimHealthNew <=
          0;

      if (terminal) {
        telemetry
          .nearbyTerminalPlayerVictimDamageMessages++;
      }

      const directAttackerPlayer =
        attackerIndex ===
          null
          ? null
          : (
              resolveKnownPlayer(
                attackerIndex,
                playerByPawnIndex,
                playerByControllerIndex
              )
              ??
              findPlayerForPawnIndex(
                parser.getDemo(),
                attackerIndex,
                playerByPawnIndex,
                playerByControllerIndex
              )
            );

      const attackerSnapshot =
        snapshotForOutput(
          entityStateByIndex.get(
            attackerIndex
          )
          ??
          null
        );

      const inflictorSnapshot =
        snapshotForOutput(
          entityStateByIndex.get(
            entindexInflictor
          )
          ??
          null
        );

      const abilitySnapshot =
        snapshotForOutput(
          entityStateByIndex.get(
            entindexAbility
          )
          ??
          null
        );

      const ownerCandidates =
        uniqueOwnerCandidates([
          ...discoverPlayerReferenceCandidates({
            role:
              'attacker',

            snapshot:
              attackerSnapshot,

            playerByPawnIndex,

            playerByControllerIndex
          }),

          ...discoverPlayerReferenceCandidates({
            role:
              'inflictor',

            snapshot:
              inflictorSnapshot,

            playerByPawnIndex,

            playerByControllerIndex
          }),

          ...discoverPlayerReferenceCandidates({
            role:
              'ability',

            snapshot:
              abilitySnapshot,

            playerByPawnIndex,

            playerByControllerIndex
          })
        ]);

      nearbyDamageMessages.push({
        tick,

        messageType:
          type,

        victimIndex,

        victimPlayer:
          compactPlayer(
            victimPlayer
          ),

        attackerIndex,

        directAttackerPlayer:
          compactPlayer(
            directAttackerPlayer
          ),

        entindexInflictor,

        entindexAbility,

        victimHealthNew,

        terminal,

        damage:
          firstFinite([
            data?.damage,
            data?.flDamage,
            data?.amount,
            data?.damageAmount,
            findNumberByPatterns(
              data,
              [
                /(^|_)damage$/i
              ]
            )
          ]),

        abilityId:
          firstFinite([
            data?.abilityId,
            data?.ability_id
          ]),

        attackerSnapshot,

        inflictorSnapshot,

        abilitySnapshot,

        ownerCandidates
      });
    }
  );

  try {
    await parser.parse(
      createReadStream(
        replayPath
      )
    );
  } finally {
    await parser.dispose();
  }

  const deathSlots =
    expandCounterSlots(
      deathCounterEvents,
      'death'
    );

  const terminalMessages =
    nearbyDamageMessages.filter(
      row =>
        row.terminal
    );

  const terminalGroups =
    groupTerminalMessages(
      terminalMessages
    );

  const deathMatch =
    matchOneToOne({
      observations:
        terminalGroups,

      slots:
        deathSlots,

      observationOwner:
        row =>
          row
            ?.victimPlayer
            ?.controllerEntityIndex
          ??
          null,

      slotOwner:
        row =>
          row.controllerEntityIndex,

      observationTick:
        row =>
          row.tick,

      slotTick:
        row =>
          row.tick,

      maxTicks:
        DEATH_CONFIRM_WINDOW_TICKS
    });

  const confirmedGroupIds =
    new Set(
      deathMatch.matches.map(
        row =>
          row.observation.id
      )
    );

  const deathConfirmedGroups =
    terminalGroups.map(
      group => ({
        ...group,

        victimDeathConfirmed:
          confirmedGroupIds.has(
            group.id
          ),

        victimDeathMatch:
          compactMatch(
            deathMatch.matches.find(
              row =>
                row
                  .observation
                  .id ===
                group.id
            )
            ??
            null
          )
      })
    );

  const residualDiagnostics =
    residualKillSlots.map(
      killSlot =>
        diagnoseResidualKill({
          killSlot,

          terminalGroups:
            deathConfirmedGroups,

          nearbyDamageMessages
        })
    );

  const outputDir =
    resolve(
      'output',
      replayName
    );

  mkdirSync(
    outputDir,
    {
      recursive:
        true
    }
  );

  const summaryPath =
    resolve(
      outputDir,
      'player_kill_indirect_attribution_discovery_v01.json'
    );

  const contextPath =
    resolve(
      outputDir,
      'player_kill_indirect_attribution_context_v01.jsonl'
    );

  const summary = {
    version:
      'PLAYER_KILL_INDIRECT_ATTRIBUTION_DISCOVERY_V01',

    canonical:
      false,

    replay:
      replayName,

    status:
      'RESEARCH_DISCOVERY_COMPLETE',

    authorityBoundary: {
      researchOnly:
        true,

      ownerReferenceInterpretation:
        'DISCOVERY_CANDIDATE_ONLY',

      warning:
        'Entity references are preserved as candidate ownership/causal evidence only.'
    },

    telemetry,

    counts:
      summarizeResiduals(
        residualDiagnostics,
        deathConfirmedGroups
      ),

    attackerEntityClassesNearResidualKills:
      countBy(
        terminalMessages,
        row =>
          row
            ?.attackerSnapshot
            ?.className
          ??
          (
            row
              ?.directAttackerPlayer
              ?.playerName
              ? 'DIRECT_PLAYER'
              : 'UNKNOWN'
          )
      ),

    inflictorEntityClassesNearResidualKills:
      countBy(
        terminalMessages,
        row =>
          row
            ?.inflictorSnapshot
            ?.className
          ??
          'UNKNOWN'
      ),

    abilityEntityClassesNearResidualKills:
      countBy(
        terminalMessages,
        row =>
          row
            ?.abilitySnapshot
            ?.className
          ??
          'UNKNOWN'
      ),

    ownerCandidateFieldNames:
      countBy(
        terminalMessages.flatMap(
          row =>
            row.ownerCandidates ??
            []
        ),
        row =>
          `${row.role}:${row.fieldName}`
      ),

    residualDiagnostics,

    output: {
      summary:
        summaryPath,

      context:
        contextPath
    }
  };

  writeFileSync(
    summaryPath,
    JSON.stringify(
      summary,
      null,
      2
    ),
    'utf8'
  );

  writeFileSync(
    contextPath,
    residualDiagnostics
      .map(
        row =>
          JSON.stringify(
            row
          )
      )
      .join('\n')
      +
      (
        residualDiagnostics.length >
        0
          ? '\n'
          : ''
      ),
    'utf8'
  );

  return {
    replayName,
    success:
      true,

    status:
      summary.status,

    counts:
      summary.counts,

    distributions: {
      attackerEntityClassesNearResidualKills:
        summary.attackerEntityClassesNearResidualKills,

      inflictorEntityClassesNearResidualKills:
        summary.inflictorEntityClassesNearResidualKills,

      ownerCandidateFieldNames:
        summary.ownerCandidateFieldNames
    },

    output:
      summary.output
  };
}

function diagnoseResidualKill({
  killSlot,
  terminalGroups,
  nearbyDamageMessages
}) {
  const killTick =
    finite(
      killSlot?.tick
    );

  const killerController =
    finite(
      killSlot
        ?.controllerEntityIndex
    );

  const killerTeam =
    finite(
      killSlot?.team
    );

  const groups =
    terminalGroups
      .filter(
        group =>
          killTick !==
            null
          &&
          Math.abs(
            group.tick -
            killTick
          ) <=
            KILL_CONTEXT_WINDOW_TICKS
      )
      .map(
        group => {
          const directMatch =
            group
              ?.directAttackers
              ?.some(
                player =>
                  player
                    ?.controllerEntityIndex ===
                  killerController
              )
            ??
            false;

          const matchingOwnerCandidates =
            (
              group
                ?.ownerCandidates
              ??
              []
            )
              .filter(
                candidate =>
                  candidate
                    ?.player
                    ?.controllerEntityIndex ===
                  killerController
              );

          const uniqueCandidatePlayers =
            uniqueBy(
              (
                group
                  ?.ownerCandidates
                ??
                []
              )
                .map(
                  row =>
                    row.player
                )
                .filter(Boolean),
              row =>
                row.controllerEntityIndex
            );

          const opponentVictim =
            Number.isFinite(
              killerTeam
            )
            &&
            Number.isFinite(
              group
                ?.victimPlayer
                ?.team
            )
              ? (
                  killerTeam !==
                  group
                    .victimPlayer
                    .team
                )
              : null;

          return {
            ...group,

            signedTickDelta:
              group.tick -
              killTick,

            absoluteTickDelta:
              Math.abs(
                group.tick -
                killTick
              ),

            signedSecondsDelta:
              (
                group.tick -
                killTick
              )
              /
              TICK_RATE,

            directKillerMatch:
              directMatch,

            matchingOwnerCandidates,

            uniqueCandidatePlayerCount:
              uniqueCandidatePlayers.length,

            uniqueCandidatePlayers,

            singleHopKillerMatch:
              !directMatch
              &&
              matchingOwnerCandidates.length >
                0
              &&
              uniqueCandidatePlayers.length ===
                1,

            opponentVictim
          };
        }
      )
      .sort(
        (
          a,
          b
        ) =>
          Number(
            b.victimDeathConfirmed
          )
          -
          Number(
            a.victimDeathConfirmed
          )
          ||
          Number(
            b.directKillerMatch
          )
          -
          Number(
            a.directKillerMatch
          )
          ||
          Number(
            b.singleHopKillerMatch
          )
          -
          Number(
            a.singleHopKillerMatch
          )
          ||
          a.absoluteTickDelta -
          b.absoluteTickDelta
      );

  const deathConfirmed =
    groups.filter(
      row =>
        row.victimDeathConfirmed
    );

  const directMatches =
    deathConfirmed.filter(
      row =>
        row.directKillerMatch
    );

  const singleHopMatches =
    deathConfirmed.filter(
      row =>
        row.singleHopKillerMatch
    );

  const nearbyMessages =
    nearbyDamageMessages
      .filter(
        row =>
          killTick !==
            null
          &&
          Math.abs(
            row.tick -
            killTick
          ) <=
            KILL_CONTEXT_WINDOW_TICKS
      )
      .length;

  let classification =
    'NO_OWNER_MATCHED_TERMINAL_CONTEXT';

  if (
    directMatches.length ===
    1
  ) {
    classification =
      'DIRECT_KNOWN_PLAYER_MATCH';
  } else if (
    directMatches.length >
    1
  ) {
    classification =
      'AMBIGUOUS_MULTIPLE_DIRECT_MATCHES';
  } else if (
    singleHopMatches.length ===
    1
  ) {
    classification =
      'UNIQUE_SINGLE_HOP_OWNER_MATCH';
  } else if (
    singleHopMatches.length >
    1
  ) {
    classification =
      'AMBIGUOUS_MULTIPLE_SINGLE_HOP_MATCHES';
  } else if (
    deathConfirmed.length >
    0
  ) {
    classification =
      'DEATH_CONFIRMED_TERMINAL_CONTEXT_NO_OWNER_MATCH';
  } else if (
    groups.length >
    0
  ) {
    classification =
      'TERMINAL_CONTEXT_WITHOUT_DEATH_CONFIRMATION';
  }

  return {
    killSlot,

    classification,

    nearbyDamageMessageCount:
      nearbyMessages,

    terminalGroupCount:
      groups.length,

    deathConfirmedTerminalGroupCount:
      deathConfirmed.length,

    directKillerMatchCount:
      directMatches.length,

    singleHopKillerMatchCount:
      singleHopMatches.length,

    terminalGroups:
      groups
  };
}

function groupTerminalMessages(
  messages
) {
  const groups =
    new Map();

  for (
    const row
    of messages
  ) {
    const key =
      `${row.victimIndex}|${row.tick}`;

    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(
        key
      )
      .push(
        row
      );
  }

  return [
    ...groups.entries()
  ]
    .map(
      (
        [
          key,
          rows
        ]
      ) => {
        const first =
          rows[0];

        const directAttackers =
          uniqueBy(
            rows
              .map(
                row =>
                  row.directAttackerPlayer
              )
              .filter(Boolean),
            row =>
              row.controllerEntityIndex
          );

        const ownerCandidates =
          uniqueOwnerCandidates(
            rows.flatMap(
              row =>
                row.ownerCandidates ??
                []
            )
          );

        return {
          id:
            `terminal|${key}`,

          tick:
            first.tick,

          victimIndex:
            first.victimIndex,

          victimPlayer:
            first.victimPlayer,

          terminalMessageCount:
            rows.length,

          directAttackers,

          ownerCandidates,

          attackerClasses:
            uniqueStrings(
              rows.map(
                row =>
                  row
                    ?.attackerSnapshot
                    ?.className
              )
            ),

          inflictorClasses:
            uniqueStrings(
              rows.map(
                row =>
                  row
                    ?.inflictorSnapshot
                    ?.className
              )
            ),

          abilityClasses:
            uniqueStrings(
              rows.map(
                row =>
                  row
                    ?.abilitySnapshot
                    ?.className
              )
            ),

          messages:
            rows
        };
      }
    )
    .sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );
}

function processController({
  entity,
  tick,
  playerByPawnIndex,
  playerByControllerIndex,
  previousController,
  deathCounterEvents
}) {
  const controllerEntityIndex =
    getEntityIndex(
      entity
    );

  if (
    controllerEntityIndex ===
    null
  ) {
    return;
  }

  const playerName =
    stringOrNull(
      safeGetField(
        entity,
        'm_iszPlayerName'
      )
    );

  if (
    !playerName
    ||
    playerName ===
      'SourceTV'
  ) {
    return;
  }

  const pawnHandle =
    handleOrNull(
      safeGetField(
        entity,
        'm_hHeroPawn'
      )
    )
    ??
    handleOrNull(
      safeGetField(
        entity,
        'm_hPawn'
      )
    );

  const pawnEntityIndex =
    decodeHandleEntityIndex(
      pawnHandle
    );

  const current = {
    controllerEntityIndex,

    pawnEntityIndex,

    playerName,

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    heroId:
      finite(
        safeGetField(
          entity,
          'm_nHeroID'
        )
      ),

    deaths:
      finite(
        safeGetField(
          entity,
          'm_iDeaths'
        )
      )
  };

  const player =
    compactPlayer(
      current
    );

  playerByControllerIndex.set(
    controllerEntityIndex,
    player
  );

  if (
    pawnEntityIndex !==
    null
  ) {
    playerByPawnIndex.set(
      pawnEntityIndex,
      player
    );
  }

  const previous =
    previousController.get(
      controllerEntityIndex
    )
    ??
    null;

  if (
    previous
    &&
    Number.isFinite(
      previous.deaths
    )
    &&
    Number.isFinite(
      current.deaths
    )
    &&
    current.deaths >
      previous.deaths
  ) {
    deathCounterEvents.push({
      kind:
        'death',

      tick,

      controllerEntityIndex,

      pawnEntityIndex,

      playerName,

      team:
        current.team,

      heroId:
        current.heroId,

      previous:
        previous.deaths,

      current:
        current.deaths,

      delta:
        current.deaths -
        previous.deaths
    });
  }

  previousController.set(
    controllerEntityIndex,
    current
  );
}

function updateEntitySnapshot({
  entityStateByIndex,
  event,
  entity,
  entityIndex,
  tick
}) {
  const existing =
    entityStateByIndex.get(
      entityIndex
    )
    ??
    {
      entityIndex,

      className:
        getEntityClassName(
          entity
        ),

      firstSeenTick:
        tick,

      lastSeenTick:
        tick,

      fields:
        {}
    };

  existing.className =
    getEntityClassName(
      entity
    )
    ??
    existing.className;

  existing.lastSeenTick =
    tick;

  let changes =
    {};

  try {
    changes =
      typeof event?.getChanges ===
        'function'
        ? (
            event.getChanges()
            ??
            {}
          )
        : {};
  } catch {
    changes =
      {};
  }

  for (
    const [
      fieldName,
      value
    ]
    of Object.entries(
      changes
    )
  ) {
    if (
      isInterestingEntityField(
        fieldName
      )
    ) {
      existing.fields[
        fieldName
      ] =
        safeValue(
          value
        );
    }
  }

  entityStateByIndex.set(
    entityIndex,
    existing
  );
}

function isInterestingEntityField(
  fieldName
) {
  return (
    /(owner|caster|source|creator|thrower|controller|player|pawn|hero|parent|attacker|inflictor|ability|team|subclass|name)/i
  ).test(
    String(
      fieldName
    )
  );
}

function discoverPlayerReferenceCandidates({
  role,
  snapshot,
  playerByPawnIndex,
  playerByControllerIndex
}) {
  if (
    !snapshot
    ||
    !snapshot.fields
  ) {
    return [];
  }

  const candidates =
    [];

  for (
    const [
      fieldName,
      rawValue
    ]
    of Object.entries(
      snapshot.fields
    )
  ) {
    if (
      !/(owner|caster|source|creator|thrower|controller|player|pawn|hero|parent|attacker)/i.test(
        fieldName
      )
    ) {
      continue;
    }

    for (
      const reference
      of extractEntityReferences(
        rawValue
      )
    ) {
      const player =
        resolveKnownPlayer(
          reference,
          playerByPawnIndex,
          playerByControllerIndex
        );

      if (!player) {
        continue;
      }

      candidates.push({
        role,

        sourceEntityIndex:
          snapshot.entityIndex,

        sourceEntityClass:
          snapshot.className,

        fieldName,

        rawValue,

        normalizedReference:
          reference,

        player:
          compactPlayer(
            player
          )
      });
    }
  }

  return candidates;
}

function extractEntityReferences(
  value,
  depth = 0
) {
  if (
    depth >
    3
  ) {
    return [];
  }

  if (
    value ===
    null
    ||
    value ===
    undefined
  ) {
    return [];
  }

  if (
    typeof value ===
      'string'
    ||
    typeof value ===
      'number'
    ||
    typeof value ===
      'bigint'
  ) {
    const normalized =
      normalizeEntityReference(
        value
      );

    return normalized ===
      null
      ? []
      : [
          normalized
        ];
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return uniqueNumbers(
      value.flatMap(
        nested =>
          extractEntityReferences(
            nested,
            depth +
              1
          )
      )
    );
  }

  if (
    typeof value ===
    'object'
  ) {
    return uniqueNumbers(
      Object.values(
        value
      )
        .flatMap(
          nested =>
            extractEntityReferences(
              nested,
              depth +
                1
            )
        )
    );
  }

  return [];
}

function resolveKnownPlayer(
  entityIndex,
  playerByPawnIndex,
  playerByControllerIndex
) {
  if (
    entityIndex ===
    null
    ||
    entityIndex ===
    undefined
  ) {
    return null;
  }

  return (
    playerByPawnIndex.get(
      entityIndex
    )
    ??
    playerByControllerIndex.get(
      entityIndex
    )
    ??
    null
  );
}

function findPlayerForPawnIndex(
  demo,
  pawnIndex,
  playerByPawnIndex,
  playerByControllerIndex
) {
  const cached =
    resolveKnownPlayer(
      pawnIndex,
      playerByPawnIndex,
      playerByControllerIndex
    );

  if (cached) {
    return cached;
  }

  const controllers =
    demo
      ?.getEntitiesByClassName
      ?.(
        'CCitadelPlayerController'
      )
    ??
    [];

  for (
    const controller
    of controllers
  ) {
    const playerName =
      stringOrNull(
        safeGetField(
          controller,
          'm_iszPlayerName'
        )
      );

    if (
      !playerName
      ||
      playerName ===
        'SourceTV'
    ) {
      continue;
    }

    const pawnHandle =
      handleOrNull(
        safeGetField(
          controller,
          'm_hHeroPawn'
        )
      )
      ??
      handleOrNull(
        safeGetField(
          controller,
          'm_hPawn'
        )
      );

    const decoded =
      decodeHandleEntityIndex(
        pawnHandle
      );

    const controllerEntityIndex =
      getEntityIndex(
        controller
      );

    const player = {
      playerName,

      team:
        finite(
          safeGetField(
            controller,
            'm_iTeamNum'
          )
        ),

      heroId:
        finite(
          safeGetField(
            controller,
            'm_nHeroID'
          )
        ),

      pawnEntityIndex:
        decoded,

      controllerEntityIndex
    };

    if (
      controllerEntityIndex !==
      null
    ) {
      playerByControllerIndex.set(
        controllerEntityIndex,
        player
      );
    }

    if (
      decoded !==
      null
    ) {
      playerByPawnIndex.set(
        decoded,
        player
      );
    }

    if (
      decoded ===
      pawnIndex
      ||
      controllerEntityIndex ===
      pawnIndex
    ) {
      return player;
    }
  }

  return null;
}

function expandCounterSlots(
  events,
  kind
) {
  const slots =
    [];

  for (
    const event
    of events
  ) {
    const count =
      Math.max(
        0,
        Math.trunc(
          event.delta
        )
      );

    for (
      let i =
        0;
      i <
        count;
      i++
    ) {
      slots.push({
        id:
          `${kind}|${event.controllerEntityIndex}|${event.tick}|${i}`,

        kind,

        tick:
          event.tick,

        controllerEntityIndex:
          event.controllerEntityIndex,

        pawnEntityIndex:
          event.pawnEntityIndex,

        playerName:
          event.playerName,

        team:
          event.team,

        heroId:
          event.heroId,

        transitionDelta:
          event.delta,

        ordinalWithinTransition:
          i +
          1
      });
    }
  }

  return slots;
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
  const edges =
    [];

  for (
    let observationIndex =
      0;
    observationIndex <
      observations.length;
    observationIndex++
  ) {
    const observation =
      observations[
        observationIndex
      ];

    const owner =
      observationOwner(
        observation
      );

    const tick =
      observationTick(
        observation
      );

    if (
      owner ===
        null
      ||
      owner ===
        undefined
      ||
      !Number.isFinite(
        tick
      )
    ) {
      continue;
    }

    for (
      let slotIndex =
        0;
      slotIndex <
        slots.length;
      slotIndex++
    ) {
      const slot =
        slots[
          slotIndex
        ];

      if (
        slotOwner(
          slot
        ) !==
        owner
      ) {
        continue;
      }

      const otherTick =
        slotTick(
          slot
        );

      if (
        !Number.isFinite(
          otherTick
        )
      ) {
        continue;
      }

      const signedTickDelta =
        otherTick -
        tick;

      const absoluteTickDelta =
        Math.abs(
          signedTickDelta
        );

      if (
        absoluteTickDelta >
        maxTicks
      ) {
        continue;
      }

      edges.push({
        observationIndex,
        slotIndex,
        signedTickDelta,
        absoluteTickDelta
      });
    }
  }

  edges.sort(
    (
      a,
      b
    ) =>
      a.absoluteTickDelta -
      b.absoluteTickDelta
      ||
      Math.abs(
        a.signedTickDelta
      )
      -
      Math.abs(
        b.signedTickDelta
      )
      ||
      a.observationIndex -
      b.observationIndex
      ||
      a.slotIndex -
      b.slotIndex
  );

  const usedObservations =
    new Set();

  const usedSlots =
    new Set();

  const matches =
    [];

  for (
    const edge
    of edges
  ) {
    if (
      usedObservations.has(
        edge.observationIndex
      )
      ||
      usedSlots.has(
        edge.slotIndex
      )
    ) {
      continue;
    }

    usedObservations.add(
      edge.observationIndex
    );

    usedSlots.add(
      edge.slotIndex
    );

    matches.push({
      observation:
        observations[
          edge.observationIndex
        ],

      slot:
        slots[
          edge.slotIndex
        ],

      signedTickDelta:
        edge.signedTickDelta,

      absoluteTickDelta:
        edge.absoluteTickDelta
    });
  }

  return {
    matches,

    unmatchedObservations:
      observations.filter(
        (
          _,
          index
        ) =>
          !usedObservations.has(
            index
          )
      ),

    unmatchedSlots:
      slots.filter(
        (
          _,
          index
        ) =>
          !usedSlots.has(
            index
          )
      )
  };
}

function summarizeResiduals(
  residualDiagnostics,
  deathConfirmedGroups
) {
  return {
    residualKillCredits:
      residualDiagnostics.length,

    terminalGroupsNearResidualKills:
      residualDiagnostics.reduce(
        (
          sum,
          row
        ) =>
          sum +
          row.terminalGroupCount,
        0
      ),

    deathConfirmedTerminalGroupsNearResidualKills:
      deathConfirmedGroups.filter(
        row =>
          row.victimDeathConfirmed
      ).length,

    residualKillsWithDeathConfirmedTerminalContext:
      residualDiagnostics.filter(
        row =>
          row.deathConfirmedTerminalGroupCount >
          0
      ).length,

    residualKillsWithDirectKnownPlayerMatch:
      residualDiagnostics.filter(
        row =>
          row.classification ===
          'DIRECT_KNOWN_PLAYER_MATCH'
      ).length,

    residualKillsWithUniqueSingleHopOwnerMatch:
      residualDiagnostics.filter(
        row =>
          row.classification ===
          'UNIQUE_SINGLE_HOP_OWNER_MATCH'
      ).length,

    residualKillsWithAmbiguousOwnerMatch:
      residualDiagnostics.filter(
        row =>
          row.classification ===
            'AMBIGUOUS_MULTIPLE_SINGLE_HOP_MATCHES'
          ||
          row.classification ===
            'AMBIGUOUS_MULTIPLE_DIRECT_MATCHES'
      ).length,

    residualKillsWithDeathConfirmedContextNoOwnerMatch:
      residualDiagnostics.filter(
        row =>
          row.classification ===
          'DEATH_CONFIRMED_TERMINAL_CONTEXT_NO_OWNER_MATCH'
      ).length,

    residualKillsWithoutOwnerMatchedTerminalContext:
      residualDiagnostics.filter(
        row =>
          ![
            'DIRECT_KNOWN_PLAYER_MATCH',
            'UNIQUE_SINGLE_HOP_OWNER_MATCH'
          ].includes(
            row.classification
          )
      ).length,

    classification:
      countBy(
        residualDiagnostics,
        row =>
          row.classification
      )
  };
}

function aggregateResults(
  successful
) {
  const sum =
    key =>
      successful.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            finite(
              row
                ?.counts
                ?.[
                  key
                ]
            )
            ??
            0
          ),
        0
      );

  return {
    counts: {
      residualKillCredits:
        sum(
          'residualKillCredits'
        ),

      residualKillsWithDeathConfirmedTerminalContext:
        sum(
          'residualKillsWithDeathConfirmedTerminalContext'
        ),

      residualKillsWithDirectKnownPlayerMatch:
        sum(
          'residualKillsWithDirectKnownPlayerMatch'
        ),

      residualKillsWithUniqueSingleHopOwnerMatch:
        sum(
          'residualKillsWithUniqueSingleHopOwnerMatch'
        ),

      residualKillsWithAmbiguousOwnerMatch:
        sum(
          'residualKillsWithAmbiguousOwnerMatch'
        ),

      residualKillsWithDeathConfirmedContextNoOwnerMatch:
        sum(
          'residualKillsWithDeathConfirmedContextNoOwnerMatch'
        ),

      residualKillsWithoutOwnerMatchedTerminalContext:
        sum(
          'residualKillsWithoutOwnerMatchedTerminalContext'
        )
    },

    classification:
      mergeCounts(
        successful.map(
          row =>
            row
              ?.counts
              ?.classification
            ??
            {}
        )
      ),

    attackerEntityClassesNearResidualKills:
      mergeCounts(
        successful.map(
          row =>
            row
              ?.distributions
              ?.attackerEntityClassesNearResidualKills
            ??
            {}
        )
      ),

    inflictorEntityClassesNearResidualKills:
      mergeCounts(
        successful.map(
          row =>
            row
              ?.distributions
              ?.inflictorEntityClassesNearResidualKills
            ??
            {}
        )
      ),

    ownerCandidateFieldNames:
      mergeCounts(
        successful.map(
          row =>
            row
              ?.distributions
              ?.ownerCandidateFieldNames
            ??
            {}
        )
      )
  };
}

function isNearAnyKillSlot(
  tick,
  killSlots,
  maxTicks
) {
  return killSlots.some(
    slot =>
      Number.isFinite(
        finite(
          slot?.tick
        )
      )
      &&
      Math.abs(
        tick -
        Number(
          slot.tick
        )
      ) <=
        maxTicks
  );
}

function compactMatch(
  match
) {
  if (!match) {
    return null;
  }

  return {
    observationId:
      match
        ?.observation
        ?.id
      ??
      null,

    slotId:
      match
        ?.slot
        ?.id
      ??
      null,

    signedTickDelta:
      match
        ?.signedTickDelta
      ??
      null,

    absoluteTickDelta:
      match
        ?.absoluteTickDelta
      ??
      null,

    signedSecondsDelta:
      Number.isFinite(
        match
          ?.signedTickDelta
      )
        ? (
            match.signedTickDelta /
            TICK_RATE
          )
        : null
  };
}

function snapshotForOutput(
  snapshot
) {
  if (!snapshot) {
    return null;
  }

  return {
    entityIndex:
      snapshot.entityIndex,

    className:
      snapshot.className,

    firstSeenTick:
      snapshot.firstSeenTick,

    lastSeenTick:
      snapshot.lastSeenTick,

    fields:
      snapshot.fields
  };
}

function uniqueOwnerCandidates(
  rows
) {
  return uniqueBy(
    rows,
    row =>
      [
        row.role,
        row.sourceEntityIndex,
        row.sourceEntityClass,
        row.fieldName,
        row.normalizedReference,
        row
          ?.player
          ?.controllerEntityIndex
      ]
        .join('|')
  );
}

function uniqueBy(
  rows,
  keyFn
) {
  const seen =
    new Set();

  const result =
    [];

  for (
    const row
    of rows
  ) {
    const key =
      keyFn(
        row
      );

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    result.push(
      row
    );
  }

  return result;
}

function uniqueNumbers(
  values
) {
  return [
    ...new Set(
      values.filter(
        value =>
          Number.isInteger(
            value
          )
      )
    )
  ];
}

function uniqueStrings(
  values
) {
  return [
    ...new Set(
      values
        .filter(
          value =>
            value !==
              null
            &&
            value !==
              undefined
        )
        .map(
          String
        )
    )
  ];
}

function countBy(
  rows,
  keyFn
) {
  const counts =
    {};

  for (
    const row
    of rows
  ) {
    const key =
      String(
        keyFn(
          row
        )
        ??
        'UNKNOWN'
      );

    counts[
      key
    ] =
      (
        counts[
          key
        ]
        ??
        0
      )
      +
      1;
  }

  return counts;
}

function mergeCounts(
  objects
) {
  const result =
    {};

  for (
    const object
    of objects
  ) {
    for (
      const [
        key,
        value
      ]
      of Object.entries(
        object
      )
    ) {
      result[
        key
      ] =
        (
          result[
            key
          ]
          ??
          0
        )
        +
        (
          finite(
            value
          )
          ??
          0
        );
    }
  }

  return result;
}

function compactPlayer(
  player
) {
  if (!player) {
    return null;
  }

  return {
    playerName:
      player.playerName
      ??
      null,

    team:
      finite(
        player.team
      ),

    heroId:
      finite(
        player.heroId
      ),

    pawnEntityIndex:
      finite(
        player.pawnEntityIndex
      ),

    controllerEntityIndex:
      finite(
        player.controllerEntityIndex
      )
  };
}

function decodeMessageType(
  type
) {
  if (
    type ===
      null
    ||
    type ===
      undefined
  ) {
    return null;
  }

  const code =
    type?._code
    ??
    type?.code
    ??
    null;

  if (
    code !==
      null
    &&
    code !==
      undefined
  ) {
    return String(
      code
    );
  }

  const id =
    type?._id
    ??
    type?.id
    ??
    null;

  if (
    id !==
      null
    &&
    id !==
      undefined
  ) {
    return `MESSAGE_ID_${id}`;
  }

  return String(
    type
  );
}

function getMessageData(
  packet
) {
  return (
    packet?.data
    ??
    packet?.message
    ??
    packet?.payload
    ??
    packet
    ??
    null
  );
}

function findEntityReference(
  object,
  patterns
) {
  return (
    findValueByKeyPatterns(
      object,
      patterns,
      4
    )
      ?.value
    ??
    null
  );
}

function findNumberByPatterns(
  object,
  patterns
) {
  return finite(
    findValueByKeyPatterns(
      object,
      patterns,
      4
    )
      ?.value
  );
}

function findValueByKeyPatterns(
  root,
  patterns,
  maxDepth
) {
  const seen =
    new Set();

  const queue = [
    {
      value:
        root,

      depth:
        0
    }
  ];

  while (
    queue.length >
    0
  ) {
    const current =
      queue.shift();

    const value =
      current.value;

    if (
      value ===
        null
      ||
      value ===
        undefined
      ||
      typeof value !==
        'object'
    ) {
      continue;
    }

    if (
      seen.has(
        value
      )
    ) {
      continue;
    }

    seen.add(
      value
    );

    for (
      const [
        key,
        nested
      ]
      of Object.entries(
        value
      )
    ) {
      if (
        patterns.some(
          pattern =>
            pattern.test(
              key
            )
        )
      ) {
        return {
          key,
          value:
            nested
        };
      }

      if (
        current.depth <
          maxDepth
        &&
        nested !==
          null
        &&
        typeof nested ===
          'object'
      ) {
        queue.push({
          value:
            nested,

          depth:
            current.depth +
            1
        });
      }
    }
  }

  return null;
}

function getEntityClassName(
  entity
) {
  try {
    if (
      typeof entity
        ?.getClassName ===
      'function'
    ) {
      const value =
        entity.getClassName();

      if (value) {
        return String(
          value
        );
      }
    }
  } catch {}

  return (
    entity?.className
    ??
    entity?.class?.name
    ??
    entity?._className
    ??
    null
  );
}

function getEntityIndex(
  entity
) {
  const direct =
    finite(
      entity?.index
      ??
      entity?.entityIndex
    );

  if (
    direct !==
    null
  ) {
    return direct;
  }

  try {
    return typeof entity?.getIndex ===
      'function'
      ? finite(
          entity.getIndex()
        )
      : null;
  } catch {
    return null;
  }
}

function safeGetField(
  entity,
  fieldName
) {
  try {
    return typeof entity?.getField ===
      'function'
      ? entity.getField(
          fieldName
        )
      : undefined;
  } catch {
    return undefined;
  }
}

function handleOrNull(
  value
) {
  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {
    return null;
  }

  try {
    const parsed =
      BigInt(
        value
      );

    if (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeHandleEntityIndex(
  value
) {
  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {
    return null;
  }

  try {
    const parsed =
      BigInt(
        value
      );

    if (
      parsed <=
        0n
      ||
      parsed ===
        16777215n
    ) {
      return null;
    }

    return Number(
      parsed
      &
      BigInt(
        ENTITY_INDEX_MASK
      )
    );
  } catch {
    return null;
  }
}

function normalizeEntityReference(
  value
) {
  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {
    return null;
  }

  if (
    typeof value ===
    'object'
  ) {
    for (
      const key
      of [
        'entityIndex',
        'entindex',
        'index',
        'handle',
        'value',
        'id'
      ]
    ) {
      if (
        Object
          .prototype
          .hasOwnProperty
          .call(
            value,
            key
          )
      ) {
        const normalized =
          normalizeEntityReference(
            value[
              key
            ]
          );

        if (
          normalized !==
          null
        ) {
          return normalized;
        }
      }
    }

    return null;
  }

  try {
    const parsed =
      BigInt(
        value
      );

    if (
      parsed < 0n
    ) {
      return null;
    }

    if (
      parsed <=
      BigInt(
        ENTITY_INDEX_MASK
      )
    ) {
      return Number(
        parsed
      );
    }

    return Number(
      parsed
      &
      BigInt(
        ENTITY_INDEX_MASK
      )
    );
  } catch {
    return null;
  }
}

function safeValue(
  value
) {
  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {
    return value;
  }

  if (
    typeof value ===
      'string'
    ||
    typeof value ===
      'number'
    ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return value.toString();
  }

  try {
    return JSON.parse(
      JSON.stringify(
        value,
        (
          _key,
          nested
        ) =>
          typeof nested ===
            'bigint'
            ? nested.toString()
            : nested
      )
    );
  } catch {
    return String(
      value
    );
  }
}

function firstPresent(
  values
) {
  for (
    const value
    of values
  ) {
    if (
      value !==
        null
      &&
      value !==
        undefined
    ) {
      return value;
    }
  }

  return null;
}

function firstFinite(
  values
) {
  for (
    const value
    of values
  ) {
    const number =
      finite(
        value
      );

    if (
      number !==
      null
    ) {
      return number;
    }
  }

  return null;
}

function finite(
  value
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function stringOrNull(
  value
) {
  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {
    return null;
  }

  const text =
    String(
      value
    )
      .trim();

  return text
    ? text
    : null;
}
