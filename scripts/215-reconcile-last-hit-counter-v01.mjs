import {
  createReadStream,
  existsSync,
  mkdirSync,
  writeFileSync
} from 'node:fs';

import {
  createInterface
} from 'node:readline';

import {
  dirname,
  resolve
} from 'node:path';

import {
  Parser,
  InterceptorStage
} from 'deadem';

// ============================================================
// SCRIPT 215
// LAST-HIT COUNTER RECONCILIATION + GAMEPLAY-WINDOW VALIDATION V0.1
//
// Why this exists:
// Script213/214 observed 14,196 positive raw m_iLastHits units,
// while the established sampled player-state scoreboard substrate
// previously summed to materially fewer final last hits.
//
// Before explaining residuals with new victim classes, reconcile:
//   1. sampled/gameplay scoreboard counter,
//   2. raw controller mutation stream,
//   3. pregame / reset / regression effects,
//   4. eligible CNPC health->0 anchors.
//
// Research-only. No promotion.
// ============================================================

const TICK_RATE = 64;
const MATCH_WINDOWS = [0, 4, 8, 16, 32];
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
  requested.length
    ? requested
    : DEFAULT_REPLAYS;

const batchPath =
  resolve(
    'output',
    'cross_replay',
    'player_last_hit_counter_reconciliation_batch_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('LAST-HIT COUNTER RECONCILIATION V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const replayResults = [];

for (const replayName of replayNames) {
  const replayPath =
    resolve('replays', `${replayName}.dem`);

  const playerStatePath =
    resolve('output', replayName, 'player_state.jsonl');

  if (!existsSync(replayPath) || !existsSync(playerStatePath)) {
    replayResults.push({
      replayName,
      success: false,
      status:
        !existsSync(replayPath)
          ? 'REPLAY_MISSING'
          : 'PLAYER_STATE_MISSING'
    });

    console.log(
      `${replayName.padEnd(10)} missing replay/player-state input`
    );

    continue;
  }

  try {
    const sampled =
      await readSampledCounter(
        playerStatePath
      );

    const raw =
      await parseRawReplay({
        replayPath
      });

    const result =
      reconcileReplay({
        replayName,
        sampled,
        raw
      });

    replayResults.push(result);

    console.log(
      `${replayName.padEnd(10)} ` +
      `final=${String(result.counts.sampledFinalLastHits).padStart(5)} ` +
      `sampleΔ+=${String(result.counts.sampledPositiveCredits).padStart(5)} ` +
      `raw+=${String(result.counts.rawPositiveCreditsAll).padStart(5)} ` +
      `game+=${String(result.counts.rawPositiveCreditsGameplay).padStart(5)} ` +
      `rawReset=${String(result.counts.rawNegativeMagnitudeAll).padStart(4)} ` +
      `gameExact=${pct(result.gameplayNpcAgreement['0'].coverageRate).padStart(7)}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success: false,
      status: 'RECONCILIATION_EXCEPTION',
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
    row => row.success
  );

const aggregate =
  aggregateResults(
    successful
  );

const batch = {
  version:
    'PLAYER_LAST_HIT_COUNTER_RECONCILIATION_BATCH_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  requestedReplays:
    replayNames,

  replayCount:
    replayNames.length,

  successCount:
    successful.length,

  allRequestedReplaysSucceeded:
    successful.length === replayNames.length,

  question:
    'Are Script213/214 raw positive last-hit units inflated by counter epochs, pregame/reset activity, or raw regressions relative to the sampled gameplay scoreboard counter?',

  aggregate,

  replays:
    replayResults
};

mkdirSync(
  dirname(batchPath),
  { recursive: true }
);

writeFileSync(
  batchPath,
  JSON.stringify(batch, null, 2),
  'utf8'
);

console.log('');
console.log('========================================================');
console.log('BATCH RECONCILIATION');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Sampled final scoreboard last hits: ${aggregate.counts.sampledFinalLastHits}`);
console.log(`Sampled positive credit units:      ${aggregate.counts.sampledPositiveCredits}`);
console.log(`Sampled negative magnitude:         ${aggregate.counts.sampledNegativeMagnitude}`);
console.log(`Raw positive units, all replay:     ${aggregate.counts.rawPositiveCreditsAll}`);
console.log(`Raw negative magnitude, all replay: ${aggregate.counts.rawNegativeMagnitudeAll}`);
console.log(`Raw positive units, gameplay only:  ${aggregate.counts.rawPositiveCreditsGameplay}`);
console.log(`Raw negative magnitude, gameplay:   ${aggregate.counts.rawNegativeMagnitudeGameplay}`);
console.log(`Raw positive units outside gameplay:${aggregate.counts.rawPositiveCreditsOutsideGameplay}`);
console.log('');
console.log('Gameplay raw-credit -> eligible NPC death agreement:');

for (const window of MATCH_WINDOWS) {
  const row =
    aggregate.gameplayNpcAgreement[
      String(window)
    ];

  const label =
    window === 0
      ? 'exact'
      : `±${window} ticks`;

  console.log(
    `  ${label.padEnd(10)} ` +
    `${String(row.matchedCredits).padStart(5)} / ` +
    `${String(aggregate.counts.rawPositiveCreditsGameplay).padStart(5)} ` +
    `= ${pct(row.coverageRate)}`
  );
}

console.log('');
console.log('Raw regression/reset ticks by replay:');

for (const row of successful) {
  console.log(
    `  ${row.replayName.padEnd(10)} ` +
    `events=${String(row.counts.rawNegativeTransitionsAll).padStart(3)} ` +
    `magnitude=${String(row.counts.rawNegativeMagnitudeAll).padStart(5)}`
  );
}

console.log('');
console.log(`Output: ${batchPath}`);
console.log('');
console.log(
  'IMPORTANT: do not promote last_hits from this diagnostic alone. First reconcile the scored counter population.'
);
console.log('');

async function readSampledCounter(
  path
) {
  const byPlayer =
    new Map();

  let globalGameplayStartTick =
    Infinity;

  let globalGameplayEndTick =
    -Infinity;

  let rowCount =
    0;

  const rl =
    createInterface({
      input:
        createReadStream(
          path,
          { encoding: 'utf8' }
        ),

      crlfDelay:
        Infinity
    });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let row;

    try {
      row =
        JSON.parse(line);
    } catch {
      continue;
    }

    rowCount++;

    const controller =
      row?.controller;

    if (!controller) continue;

    const playerName =
      stringOrNull(
        controller.playerName
      );

    if (
      !playerName
      ||
      playerName === 'SourceTV'
    ) {
      continue;
    }

    const tick =
      firstFinite([
        row.demoTick,
        row.tick
      ]);

    const matchTime =
      firstFinite([
        row.matchTimeSeconds,
        row.matchTime
      ]);

    const lastHits =
      finite(
        controller.lastHits
      );

    const team =
      finite(
        controller.team
      );

    const controllerEntityIndex =
      finite(
        controller.entityIndex
      );

    if (
      tick === null
      ||
      lastHits === null
    ) {
      continue;
    }

    if (
      Number.isFinite(matchTime)
      &&
      matchTime >= 0
    ) {
      globalGameplayStartTick =
        Math.min(
          globalGameplayStartTick,
          tick
        );

      globalGameplayEndTick =
        Math.max(
          globalGameplayEndTick,
          tick
        );
    }

    let state =
      byPlayer.get(
        playerName
      );

    if (!state) {
      state = {
        playerName,
        team,
        controllerEntityIndexes:
          new Set(),

        firstObserved:
          null,

        firstGameplay:
          null,

        finalGameplay:
          null,

        previous:
          null,

        positiveTransitions:
          [],

        negativeTransitions:
          []
      };

      byPlayer.set(
        playerName,
        state
      );
    }

    if (
      controllerEntityIndex !== null
    ) {
      state.controllerEntityIndexes.add(
        controllerEntityIndex
      );
    }

    const current = {
      tick,
      matchTime,
      lastHits,
      team,
      controllerEntityIndex
    };

    if (!state.firstObserved) {
      state.firstObserved =
        current;
    }

    if (
      Number.isFinite(matchTime)
      &&
      matchTime >= 0
    ) {
      if (!state.firstGameplay) {
        state.firstGameplay =
          current;
      }

      state.finalGameplay =
        current;
    }

    if (state.previous) {
      const delta =
        current.lastHits -
        state.previous.lastHits;

      if (delta > 0) {
        state.positiveTransitions.push({
          tick,
          matchTime,
          previous:
            state.previous.lastHits,
          current:
            current.lastHits,
          delta
        });
      } else if (delta < 0) {
        state.negativeTransitions.push({
          tick,
          matchTime,
          previous:
            state.previous.lastHits,
          current:
            current.lastHits,
          delta
        });
      }
    }

    state.previous =
      current;
  }

  const players =
    [...byPlayer.values()]
      .map(
        row => ({
          ...row,
          controllerEntityIndexes:
            [...row.controllerEntityIndexes]
        })
      );

  return {
    rowCount,

    gameplayStartTick:
      Number.isFinite(
        globalGameplayStartTick
      )
        ? globalGameplayStartTick
        : null,

    gameplayEndTick:
      Number.isFinite(
        globalGameplayEndTick
      )
        ? globalGameplayEndTick
        : null,

    players
  };
}

async function parseRawReplay({
  replayPath
}) {
  const parser =
    new Parser();

  const previousController =
    new Map();

  const previousNpc =
    new Map();

  const controllerTransitions =
    [];

  const npcDeaths =
    [];

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

      if (tick === null) return;

      for (const event of events ?? []) {
        const entity =
          event?.entity;

        if (!entity) continue;

        const className =
          getEntityClassName(
            entity
          );

        const entityIndex =
          getEntityIndex(
            entity
          );

        if (
          !className
          ||
          entityIndex === null
        ) {
          continue;
        }

        if (
          className ===
          'CCitadelPlayerController'
        ) {
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
            playerName === 'SourceTV'
          ) {
            continue;
          }

          const current = {
            tick,

            entityIndex,

            playerName,

            team:
              finite(
                safeGetField(
                  entity,
                  'm_iTeamNum'
                )
              ),

            lastHits:
              finite(
                safeGetField(
                  entity,
                  'm_iLastHits'
                )
              )
          };

          const previous =
            previousController.get(
              entityIndex
            )
            ??
            null;

          if (
            previous
            &&
            Number.isFinite(
              previous.lastHits
            )
            &&
            Number.isFinite(
              current.lastHits
            )
            &&
            current.lastHits !==
              previous.lastHits
          ) {
            controllerTransitions.push({
              tick,

              entityIndex,

              playerName,

              team:
                current.team,

              previous:
                previous.lastHits,

              current:
                current.lastHits,

              delta:
                current.lastHits -
                previous.lastHits
            });
          }

          previousController.set(
            entityIndex,
            current
          );

          continue;
        }

        if (
          !className.startsWith(
            'CNPC_'
          )
        ) {
          continue;
        }

        const current = {
          tick,

          entityIndex,

          className,

          team:
            finite(
              safeGetField(
                entity,
                'm_iTeamNum'
              )
            ),

          health:
            finite(
              safeGetField(
                entity,
                'm_iHealth'
              )
            )
        };

        const previous =
          previousNpc.get(
            entityIndex
          )
          ??
          null;

        if (
          previous
          &&
          Number.isFinite(
            previous.health
          )
          &&
          Number.isFinite(
            current.health
          )
          &&
          previous.health > 0
          &&
          current.health <= 0
        ) {
          npcDeaths.push({
            id:
              `npcDeath|${entityIndex}|${tick}`,

            tick,

            entityIndex,

            className,

            team:
              current.team,

            previousHealth:
              previous.health,

            currentHealth:
              current.health
          });
        }

        previousNpc.set(
          entityIndex,
          current
        );
      }
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

  return {
    controllerTransitions,
    npcDeaths
  };
}

function reconcileReplay({
  replayName,
  sampled,
  raw
}) {
  const gameplayStartTick =
    sampled.gameplayStartTick;

  const gameplayEndTick =
    sampled.gameplayEndTick;

  const sampledPositiveCredits =
    sum(
      sampled.players.flatMap(
        player =>
          player.positiveTransitions
      ),
      row =>
        Math.max(
          0,
          row.delta
        )
    );

  const sampledNegativeMagnitude =
    sum(
      sampled.players.flatMap(
        player =>
          player.negativeTransitions
      ),
      row =>
        Math.max(
          0,
          -row.delta
        )
    );

  const sampledFinalLastHits =
    sum(
      sampled.players,
      player =>
        player.finalGameplay?.lastHits
        ??
        0
    );

  const rawPositiveTransitions =
    raw.controllerTransitions.filter(
      row =>
        row.delta > 0
    );

  const rawNegativeTransitions =
    raw.controllerTransitions.filter(
      row =>
        row.delta < 0
    );

  const inGameplay =
    row =>
      Number.isFinite(
        gameplayStartTick
      )
      &&
      Number.isFinite(
        gameplayEndTick
      )
      &&
      row.tick >=
        gameplayStartTick
      &&
      row.tick <=
        gameplayEndTick;

  const rawPositiveGameplay =
    rawPositiveTransitions.filter(
      inGameplay
    );

  const rawNegativeGameplay =
    rawNegativeTransitions.filter(
      inGameplay
    );

  const rawPositiveOutside =
    rawPositiveTransitions.filter(
      row =>
        !inGameplay(row)
    );

  const rawPositiveSlotsAll =
    expandRawPositiveSlots(
      rawPositiveTransitions
    );

  const rawPositiveSlotsGameplay =
    expandRawPositiveSlots(
      rawPositiveGameplay
    );

  const rawPositiveSlotsOutside =
    expandRawPositiveSlots(
      rawPositiveOutside
    );

  const gameplayNpcAgreement =
    {};

  for (const window of MATCH_WINDOWS) {
    const matched =
      matchCreditsToNpcDeaths({
        credits:
          rawPositiveSlotsGameplay,

        npcDeaths:
          raw.npcDeaths.filter(
            death =>
              inGameplay(death)
          ),

        maxTicks:
          window
      });

    gameplayNpcAgreement[
      String(window)
    ] = {
      matchedCredits:
        matched.matches.length,

      unmatchedCredits:
        matched.unmatchedCredits.length,

      coverageRate:
        safeDiv(
          matched.matches.length,
          rawPositiveSlotsGameplay.length
        ),

      classCounts:
        sortDescending(
          countBy(
            matched.matches,
            row =>
              row.death.className
          )
        )
    };
  }

  const outputDir =
    resolve(
      'output',
      replayName
    );

  mkdirSync(
    outputDir,
    { recursive: true }
  );

  const outputPath =
    resolve(
      outputDir,
      'player_last_hit_counter_reconciliation_v01.json'
    );

  const result = {
    replayName,

    success:
      true,

    status:
      'COUNTER_RECONCILIATION_COMPLETE',

    gameplayWindow: {
      startTick:
        gameplayStartTick,

      endTick:
        gameplayEndTick,

      durationSeconds:
        (
          Number.isFinite(
            gameplayStartTick
          )
          &&
          Number.isFinite(
            gameplayEndTick
          )
        )
          ? (
              gameplayEndTick -
              gameplayStartTick
            )
            /
            TICK_RATE
          : null
    },

    counts: {
      sampledPlayers:
        sampled.players.length,

      sampledFinalLastHits,

      sampledPositiveCredits,

      sampledNegativeTransitions:
        sampled.players.reduce(
          (
            total,
            player
          ) =>
            total +
            player
              .negativeTransitions
              .length,
          0
        ),

      sampledNegativeMagnitude,

      rawPositiveTransitionsAll:
        rawPositiveTransitions.length,

      rawPositiveCreditsAll:
        rawPositiveSlotsAll.length,

      rawNegativeTransitionsAll:
        rawNegativeTransitions.length,

      rawNegativeMagnitudeAll:
        sum(
          rawNegativeTransitions,
          row =>
            -row.delta
        ),

      rawPositiveTransitionsGameplay:
        rawPositiveGameplay.length,

      rawPositiveCreditsGameplay:
        rawPositiveSlotsGameplay.length,

      rawNegativeTransitionsGameplay:
        rawNegativeGameplay.length,

      rawNegativeMagnitudeGameplay:
        sum(
          rawNegativeGameplay,
          row =>
            -row.delta
        ),

      rawPositiveTransitionsOutsideGameplay:
        rawPositiveOutside.length,

      rawPositiveCreditsOutsideGameplay:
        rawPositiveSlotsOutside.length,

      npcDeathsAll:
        raw.npcDeaths.length,

      npcDeathsGameplay:
        raw.npcDeaths.filter(
          inGameplay
        ).length
    },

    reconciliation: {
      sampledPositiveMinusFinal:
        sampledPositiveCredits -
        sampledFinalLastHits,

      rawPositiveMinusSampledPositive:
        rawPositiveSlotsAll.length -
        sampledPositiveCredits,

      rawGameplayPositiveMinusSampledPositive:
        rawPositiveSlotsGameplay.length -
        sampledPositiveCredits,

      rawAllNetPositive:
        rawPositiveSlotsAll.length -
        sum(
          rawNegativeTransitions,
          row =>
            -row.delta
        ),

      rawGameplayNetPositive:
        rawPositiveSlotsGameplay.length -
        sum(
          rawNegativeGameplay,
          row =>
            -row.delta
        )
    },

    gameplayNpcAgreement,

    rawNegativeExamples:
      rawNegativeTransitions.slice(
        0,
        50
      ),

    sampledNegativeExamples:
      sampled.players.flatMap(
        player =>
          player
            .negativeTransitions
            .map(
              transition => ({
                playerName:
                  player.playerName,

                ...transition
              })
            )
      ).slice(
        0,
        50
      ),

    output:
      outputPath
  };

  writeFileSync(
    outputPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    'utf8'
  );

  return result;
}

function aggregateResults(
  successful
) {
  const countKeys = [
    'sampledFinalLastHits',
    'sampledPositiveCredits',
    'sampledNegativeMagnitude',
    'rawPositiveCreditsAll',
    'rawNegativeMagnitudeAll',
    'rawPositiveCreditsGameplay',
    'rawNegativeMagnitudeGameplay',
    'rawPositiveCreditsOutsideGameplay',
    'rawNegativeTransitionsAll'
  ];

  const counts =
    Object.fromEntries(
      countKeys.map(
        key => [
          key,
          successful.reduce(
            (
              total,
              row
            ) =>
              total +
              (
                row.counts?.[key]
                ??
                0
              ),
            0
          )
        ]
      )
    );

  const gameplayNpcAgreement =
    {};

  for (const window of MATCH_WINDOWS) {
    const key =
      String(window);

    const matched =
      successful.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row
              .gameplayNpcAgreement
              ?.[key]
              ?.matchedCredits
            ??
            0
          ),
        0
      );

    gameplayNpcAgreement[
      key
    ] = {
      matchedCredits:
        matched,

      unmatchedCredits:
        counts.rawPositiveCreditsGameplay -
        matched,

      coverageRate:
        safeDiv(
          matched,
          counts.rawPositiveCreditsGameplay
        )
    };
  }

  return {
    counts,

    gameplayNpcAgreement,

    reconciliation: {
      sampledPositiveMinusFinal:
        counts.sampledPositiveCredits -
        counts.sampledFinalLastHits,

      rawPositiveMinusSampledPositive:
        counts.rawPositiveCreditsAll -
        counts.sampledPositiveCredits,

      rawGameplayPositiveMinusSampledPositive:
        counts.rawPositiveCreditsGameplay -
        counts.sampledPositiveCredits,

      rawAllNetPositive:
        counts.rawPositiveCreditsAll -
        counts.rawNegativeMagnitudeAll,

      rawGameplayNetPositive:
        counts.rawPositiveCreditsGameplay -
        counts.rawNegativeMagnitudeGameplay
    }
  };
}

function expandRawPositiveSlots(
  events
) {
  const slots =
    [];

  for (const event of events) {
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
          `lastHit|${event.entityIndex}|${event.tick}|${i}`,

        tick:
          event.tick,

        controllerEntityIndex:
          event.entityIndex,

        playerName:
          event.playerName,

        team:
          event.team,

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

function matchCreditsToNpcDeaths({
  credits,
  npcDeaths,
  maxTicks
}) {
  const edges =
    [];

  for (
    let ci =
      0;
    ci <
      credits.length;
    ci++
  ) {
    const credit =
      credits[ci];

    for (
      let di =
        0;
      di <
        npcDeaths.length;
      di++
    ) {
      const death =
        npcDeaths[di];

      if (
        !isEligibleDeathForPlayer(
          death,
          credit.team
        )
      ) {
        continue;
      }

      const signedTickDelta =
        death.tick -
        credit.tick;

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
        ci,
        di,
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
      a.ci -
      b.ci
      ||
      a.di -
      b.di
  );

  const usedCredits =
    new Set();

  const usedDeaths =
    new Set();

  const matches =
    [];

  for (const edge of edges) {
    if (
      usedCredits.has(
        edge.ci
      )
      ||
      usedDeaths.has(
        edge.di
      )
    ) {
      continue;
    }

    usedCredits.add(
      edge.ci
    );

    usedDeaths.add(
      edge.di
    );

    matches.push({
      credit:
        credits[edge.ci],

      death:
        npcDeaths[edge.di],

      signedTickDelta:
        edge.signedTickDelta,

      absoluteTickDelta:
        edge.absoluteTickDelta
    });
  }

  return {
    matches,

    unmatchedCredits:
      credits.filter(
        (
          _,
          index
        ) =>
          !usedCredits.has(
            index
          )
      )
  };
}

function isEligibleDeathForPlayer(
  death,
  playerTeam
) {
  if (
    !Number.isFinite(
      playerTeam
    )
  ) {
    return true;
  }

  if (
    isCompetitiveTeam(
      death.team
    )
    &&
    isCompetitiveTeam(
      playerTeam
    )
  ) {
    return death.team !==
      playerTeam;
  }

  return true;
}

function isCompetitiveTeam(
  team
) {
  return (
    team === 2
    ||
    team === 3
  );
}

function countBy(
  rows,
  keyFn
) {
  const result =
    {};

  for (const row of rows) {
    const key =
      String(
        keyFn(row)
        ??
        'UNKNOWN'
      );

    result[key] =
      (
        result[key]
        ??
        0
      )
      +
      1;
  }

  return result;
}

function sortDescending(
  object
) {
  return Object.fromEntries(
    Object.entries(
      object
    )
      .sort(
        (
          a,
          b
        ) =>
          b[1] -
          a[1]
          ||
          a[0].localeCompare(
            b[0]
          )
      )
  );
}

function sum(
  rows,
  valueFn
) {
  return rows.reduce(
    (
      total,
      row
    ) =>
      total +
      (
        finite(
          valueFn(row)
        )
        ??
        0
      ),
    0
  );
}

function getEntityClassName(
  entity
) {
  try {
    if (
      typeof entity?.getClassName ===
      'function'
    ) {
      const value =
        entity.getClassName();

      if (value) {
        return String(value);
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

  if (direct !== null) {
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

function firstFinite(
  values
) {
  for (const value of values) {
    const number =
      finite(
        value
      );

    if (number !== null) {
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
    value === null
    ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(
      value
    ).trim();

  return text
    ? text
    : null;
}

function safeDiv(
  a,
  b
) {
  return (
    Number.isFinite(
      a
    )
    &&
    Number.isFinite(
      b
    )
    &&
    b !== 0
  )
    ? a /
      b
    : null;
}

function pct(
  value
) {
  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(2)}%`
    : '—';
}
