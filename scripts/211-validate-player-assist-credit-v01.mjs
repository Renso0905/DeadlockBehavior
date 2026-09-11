import {
  createReadStream,
  existsSync,
  mkdirSync,
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
// SCRIPT 211
// SCOREBOARD ASSIST-CREDIT SEMANTIC VALIDATION V0.1
//
// Validates the narrow construct:
//   CCitadelPlayerController.m_iPlayerAssists
//     = game-awarded per-player assist credits.
//
// It does NOT attempt to establish the game's assist eligibility
// rule (damage/healing/debuff/proximity/time-window/etc.).
//
// Evidence:
// - raw assist-counter transitions
// - raw victim m_iDeaths transitions
// - raw player kill-credit transitions as a team-context control
// - temporal/team correspondence
// - +10 s and +30 s shifted placebo controls
//
// Research only. No claim/metric promotion.
// ============================================================

const TICK_RATE = 64;
const MATCH_WINDOW_TICKS = 32; // +/- 0.5 seconds
const PLACEBO_10_TICKS = 10 * TICK_RATE;
const PLACEBO_30_TICKS = 30 * TICK_RATE;

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
    'player_assist_credit_validation_batch_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('PLAYER ASSIST CREDIT SEMANTIC VALIDATION V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const replayResults = [];

for (const replayName of replayNames) {
  const replayPath =
    resolve('replays', `${replayName}.dem`);

  if (!existsSync(replayPath)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'REPLAY_MISSING',
      replayPath
    });

    console.log(`${replayName.padEnd(10)} replay missing`);
    continue;
  }

  try {
    const result =
      await validateReplay({
        replayName,
        replayPath
      });

    replayResults.push(result);

    console.log(
      `${replayName.padEnd(10)} ` +
      `assists=${String(result.counts.assistCredits).padStart(4)} ` +
      `enemyDeath=${pct(result.validation.enemyDeathAgreementRate).padStart(7)} ` +
      `sameTeamKill=${pct(result.validation.sameTeamKillContextRate).padStart(7)} ` +
      `placebo10=${pct(result.validation.placebo10EnemyDeathAgreementRate).padStart(7)}`
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

const successful =
  replayResults.filter(row => row.success);

const aggregate =
  aggregateResults(successful);

const batch = {
  version:
    'PLAYER_ASSIST_CREDIT_VALIDATION_BATCH_V01',

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
    successful.length === replayNames.length,

  construct:
    'game-awarded per-player assist credit counter',

  authorityBoundary: {
    researchOnly:
      true,

    promotesClaim:
      false,

    promotesMetric:
      false,

    establishedIfSupported:
      'm_iPlayerAssists behaves as a game-awarded assist-credit counter',

    explicitlyNotEstablished: [
      'assist eligibility rule',
      'required damage contribution',
      'required healing contribution',
      'required debuff contribution',
      'assist time window',
      'causal magnitude of assistance'
    ]
  },

  matching: {
    windowTicks:
      MATCH_WINDOW_TICKS,

    windowSeconds:
      MATCH_WINDOW_TICKS / TICK_RATE,

    placeboShift10SecondsTicks:
      PLACEBO_10_TICKS,

    placeboShift30SecondsTicks:
      PLACEBO_30_TICKS
  },

  aggregate,

  replays:
    replayResults
};

mkdirSync(
  dirname(batchOutputPath),
  { recursive: true }
);

writeFileSync(
  batchOutputPath,
  JSON.stringify(batch, null, 2),
  'utf8'
);

console.log('');
console.log('========================================================');
console.log('BATCH EVIDENCE');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Assist credits: ${aggregate.counts.assistCredits}`);
console.log(
  `Assist -> opposing scored death agreement: ${pct(aggregate.validation.enemyDeathAgreementRate)}`
);
console.log(
  `Assist -> same-team kill context: ${pct(aggregate.validation.sameTeamKillContextRate)}`
);
console.log(
  `Assist credited to victim team: ${pct(aggregate.validation.victimTeamConflictRate)}`
);
console.log(
  `10 s placebo opposing-death agreement: ${pct(aggregate.validation.placebo10EnemyDeathAgreementRate)}`
);
console.log(
  `30 s placebo opposing-death agreement: ${pct(aggregate.validation.placebo30EnemyDeathAgreementRate)}`
);
console.log(
  `Unmatched assist credits: ${aggregate.counts.unmatchedAssistCredits}`
);
console.log(`Output: ${batchOutputPath}`);
console.log('');
console.log(
  'IMPORTANT: this script validates scoreboard assist-credit timing/team semantics only; it does not infer the assist eligibility mechanic.'
);
console.log('');

async function validateReplay({
  replayName,
  replayPath
}) {
  const parser =
    new Parser();

  const previousController =
    new Map();

  const assistEvents =
    [];

  const deathEvents =
    [];

  const killEvents =
    [];

  const telemetry = {
    controllerEvents:
      0,

    assistTransitions:
      0,

    deathTransitions:
      0,

    killTransitions:
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
        finite(demoPacket?.tick);

      if (tick === null) return;

      for (const event of events ?? []) {
        const entity =
          event?.entity;

        if (!entity) continue;

        if (
          getEntityClassName(entity) !==
          'CCitadelPlayerController'
        ) {
          continue;
        }

        telemetry.controllerEvents++;

        const entityIndex =
          getEntityIndex(entity);

        if (entityIndex === null) continue;

        const playerName =
          stringOrNull(
            safeGetField(
              entity,
              'm_iszPlayerName'
            )
          );

        if (
          !playerName ||
          playerName === 'SourceTV'
        ) {
          continue;
        }

        const current = {
          controllerEntityIndex:
            entityIndex,

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

          assists:
            finite(
              safeGetField(
                entity,
                'm_iPlayerAssists'
              )
            ),

          deaths:
            finite(
              safeGetField(
                entity,
                'm_iDeaths'
              )
            ),

          kills:
            finite(
              safeGetField(
                entity,
                'm_iPlayerKills'
              )
            )
        };

        const previous =
          previousController.get(entityIndex) ?? null;

        if (previous) {
          capturePositiveTransition({
            previous,
            current,
            field: 'assists',
            kind: 'assist',
            tick,
            output: assistEvents,
            telemetryKey: 'assistTransitions',
            telemetry
          });

          capturePositiveTransition({
            previous,
            current,
            field: 'deaths',
            kind: 'death',
            tick,
            output: deathEvents,
            telemetryKey: 'deathTransitions',
            telemetry
          });

          capturePositiveTransition({
            previous,
            current,
            field: 'kills',
            kind: 'kill',
            tick,
            output: killEvents,
            telemetryKey: 'killTransitions',
            telemetry
          });
        }

        previousController.set(
          entityIndex,
          current
        );
      }
    }
  );

  try {
    await parser.parse(
      createReadStream(replayPath)
    );
  } finally {
    await parser.dispose();
  }

  const assistSlots =
    expandCounterSlots(
      assistEvents,
      'assist'
    );

  const deathSlots =
    expandCounterSlots(
      deathEvents,
      'death'
    );

  const killSlots =
    expandCounterSlots(
      killEvents,
      'kill'
    );

  const diagnostics =
    assistSlots.map(
      assist =>
        diagnoseAssist({
          assist,
          deathSlots,
          killSlots
        })
    );

  const placebo10 =
    assistSlots.map(
      assist =>
        diagnoseAssist({
          assist: {
            ...assist,
            tick:
              assist.tick +
              PLACEBO_10_TICKS
          },
          deathSlots,
          killSlots,
          placebo: true
        })
    );

  const placebo30 =
    assistSlots.map(
      assist =>
        diagnoseAssist({
          assist: {
            ...assist,
            tick:
              assist.tick +
              PLACEBO_30_TICKS
          },
          deathSlots,
          killSlots,
          placebo: true
        })
    );

  const matched =
    diagnostics.filter(
      row =>
        row.enemyDeathMatches.length >
        0
    );

  const sameTeamKill =
    diagnostics.filter(
      row =>
        row.enemyDeathMatches.some(
          death =>
            death.sameTeamKillMatches.length >
            0
        )
    );

  const victimTeamConflict =
    diagnostics.filter(
      row =>
        row.sameTeamDeathMatches.length >
        0
        &&
        row.enemyDeathMatches.length ===
          0
    );

  const unmatched =
    diagnostics.filter(
      row =>
        row.enemyDeathMatches.length ===
          0
    );

  const outputDir =
    resolve(
      'output',
      replayName
    );

  mkdirSync(
    outputDir,
    { recursive: true }
  );

  const summaryPath =
    resolve(
      outputDir,
      'player_assist_credit_validation_v01.json'
    );

  const eventsPath =
    resolve(
      outputDir,
      'player_assist_credit_events_v01.jsonl'
    );

  const validation = {
    enemyDeathAgreementRate:
      safeDiv(
        matched.length,
        assistSlots.length
      ),

    sameTeamKillContextRate:
      safeDiv(
        sameTeamKill.length,
        assistSlots.length
      ),

    victimTeamConflictRate:
      safeDiv(
        victimTeamConflict.length,
        assistSlots.length
      ),

    placebo10EnemyDeathAgreementRate:
      safeDiv(
        placebo10.filter(
          row =>
            row.enemyDeathMatches.length >
              0
        ).length,
        assistSlots.length
      ),

    placebo30EnemyDeathAgreementRate:
      safeDiv(
        placebo30.filter(
          row =>
            row.enemyDeathMatches.length >
              0
        ).length,
        assistSlots.length
      )
  };

  const summary = {
    version:
      'PLAYER_ASSIST_CREDIT_VALIDATION_V01',

    canonical:
      false,

    replay:
      replayName,

    construct:
      'game-awarded per-player assist credit counter',

    counts: {
      assistTransitions:
        assistEvents.length,

      assistCredits:
        assistSlots.length,

      deathCredits:
        deathSlots.length,

      killCredits:
        killSlots.length,

      assistCreditsWithEnemyDeath:
        matched.length,

      assistCreditsWithSameTeamKillContext:
        sameTeamKill.length,

      assistCreditsWithVictimTeamConflict:
        victimTeamConflict.length,

      unmatchedAssistCredits:
        unmatched.length
    },

    validation,

    distributions: {
      assistTransitionDelta:
        countBy(
          assistEvents,
          row => row.delta
        ),

      assistCreditsPerMatchedDeath:
        assistCreditsPerDeath(
          diagnostics
        )
    },

    unmatchedAssistCredits:
      unmatched,

    outputs: {
      summary:
        summaryPath,

      events:
        eventsPath
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
    eventsPath,
    diagnostics
      .map(row => JSON.stringify(row))
      .join('\n')
      +
      (
        diagnostics.length > 0
          ? '\n'
          : ''
      ),
    'utf8'
  );

  return {
    replayName,
    success: true,
    status: 'RESEARCH_VALIDATION_COMPLETE',
    telemetry,
    counts: summary.counts,
    validation,
    distributions: summary.distributions,
    outputs: summary.outputs
  };
}

function diagnoseAssist({
  assist,
  deathSlots,
  killSlots,
  placebo = false
}) {
  const nearbyDeaths =
    deathSlots
      .filter(
        death =>
          Math.abs(
            death.tick -
            assist.tick
          ) <=
            MATCH_WINDOW_TICKS
      )
      .map(
        death => {
          const enemy =
            teamsOpposed(
              assist.team,
              death.team
            );

          const sameTeam =
            teamsSame(
              assist.team,
              death.team
            );

          const sameTeamKillMatches =
            enemy
              ? killSlots
                  .filter(
                    kill =>
                      teamsSame(
                        kill.team,
                        assist.team
                      )
                      &&
                      kill.controllerEntityIndex !==
                        assist.controllerEntityIndex
                      &&
                      Math.abs(
                        kill.tick -
                        death.tick
                      ) <=
                        MATCH_WINDOW_TICKS
                  )
                  .map(
                    kill => ({
                      killSlotId:
                        kill.id,

                      tick:
                        kill.tick,

                      signedTickDeltaFromDeath:
                        kill.tick -
                        death.tick,

                      playerName:
                        kill.playerName,

                      controllerEntityIndex:
                        kill.controllerEntityIndex,

                      team:
                        kill.team
                    })
                  )
              : [];

          return {
            deathSlotId:
              death.id,

            tick:
              death.tick,

            signedTickDeltaFromAssist:
              death.tick -
              assist.tick,

            absoluteTickDeltaFromAssist:
              Math.abs(
                death.tick -
                assist.tick
              ),

            victimPlayerName:
              death.playerName,

            victimControllerEntityIndex:
              death.controllerEntityIndex,

            victimTeam:
              death.team,

            enemyToAssister:
              enemy,

            sameTeamAsAssister:
              sameTeam,

            sameTeamKillMatches
          };
        }
      )
      .sort(
        (a, b) =>
          a.absoluteTickDeltaFromAssist -
          b.absoluteTickDeltaFromAssist
      );

  return {
    assistSlotId:
      assist.id,

    placebo,

    tick:
      assist.tick,

    playerName:
      assist.playerName,

    controllerEntityIndex:
      assist.controllerEntityIndex,

    team:
      assist.team,

    transitionDelta:
      assist.transitionDelta,

    ordinalWithinTransition:
      assist.ordinalWithinTransition,

    enemyDeathMatches:
      nearbyDeaths.filter(
        row =>
          row.enemyToAssister
      ),

    sameTeamDeathMatches:
      nearbyDeaths.filter(
        row =>
          row.sameTeamAsAssister
      )
  };
}

function capturePositiveTransition({
  previous,
  current,
  field,
  kind,
  tick,
  output,
  telemetryKey,
  telemetry
}) {
  if (
    !Number.isFinite(
      previous[field]
    )
    ||
    !Number.isFinite(
      current[field]
    )
    ||
    current[field] <=
      previous[field]
  ) {
    return;
  }

  const delta =
    current[field] -
    previous[field];

  output.push({
    kind,
    tick,

    controllerEntityIndex:
      current.controllerEntityIndex,

    playerName:
      current.playerName,

    team:
      current.team,

    heroId:
      current.heroId,

    previous:
      previous[field],

    current:
      current[field],

    delta
  });

  telemetry[telemetryKey]++;
}

function expandCounterSlots(
  events,
  kind
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
      let i = 0;
      i < count;
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

        playerName:
          event.playerName,

        team:
          event.team,

        heroId:
          event.heroId,

        transitionDelta:
          event.delta,

        ordinalWithinTransition:
          i + 1
      });
    }
  }

  return slots;
}

function assistCreditsPerDeath(
  diagnostics
) {
  const counts =
    new Map();

  for (const row of diagnostics) {
    const unique =
      new Set(
        row.enemyDeathMatches.map(
          death => death.deathSlotId
        )
      );

    for (const deathId of unique) {
      counts.set(
        deathId,
        (counts.get(deathId) ?? 0) + 1
      );
    }
  }

  return countBy(
    [...counts.values()],
    value => value
  );
}

function aggregateResults(
  successful
) {
  const sum =
    key =>
      successful.reduce(
        (total, row) =>
          total +
          (
            finite(
              row?.counts?.[key]
            )
            ??
            0
          ),
        0
      );

  const assistCredits =
    sum('assistCredits');

  const matched =
    sum('assistCreditsWithEnemyDeath');

  const sameTeamKill =
    sum('assistCreditsWithSameTeamKillContext');

  const conflicts =
    sum('assistCreditsWithVictimTeamConflict');

  const placebo10Matches =
    successful.reduce(
      (total, row) =>
        total +
        (
          Math.round(
            (
              row.validation
                .placebo10EnemyDeathAgreementRate
              ??
              0
            )
            *
            row.counts.assistCredits
          )
        ),
      0
    );

  const placebo30Matches =
    successful.reduce(
      (total, row) =>
        total +
        (
          Math.round(
            (
              row.validation
                .placebo30EnemyDeathAgreementRate
              ??
              0
            )
            *
            row.counts.assistCredits
          )
        ),
      0
    );

  return {
    counts: {
      assistCredits,

      assistCreditsWithEnemyDeath:
        matched,

      assistCreditsWithSameTeamKillContext:
        sameTeamKill,

      assistCreditsWithVictimTeamConflict:
        conflicts,

      unmatchedAssistCredits:
        sum('unmatchedAssistCredits')
    },

    validation: {
      enemyDeathAgreementRate:
        safeDiv(
          matched,
          assistCredits
        ),

      sameTeamKillContextRate:
        safeDiv(
          sameTeamKill,
          assistCredits
        ),

      victimTeamConflictRate:
        safeDiv(
          conflicts,
          assistCredits
        ),

      placebo10EnemyDeathAgreementRate:
        safeDiv(
          placebo10Matches,
          assistCredits
        ),

      placebo30EnemyDeathAgreementRate:
        safeDiv(
          placebo30Matches,
          assistCredits
        )
    }
  };
}

function teamsSame(
  a,
  b
) {
  return (
    Number.isFinite(a)
    &&
    Number.isFinite(b)
    &&
    a === b
  );
}

function teamsOpposed(
  a,
  b
) {
  return (
    Number.isFinite(a)
    &&
    Number.isFinite(b)
    &&
    a !== b
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

      if (value) return String(value);
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
      ? finite(entity.getIndex())
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
      ? entity.getField(fieldName)
      : undefined;
  } catch {
    return undefined;
  }
}

function countBy(
  rows,
  keyFn
) {
  const counts =
    {};

  for (const row of rows) {
    const key =
      String(
        keyFn(row)
        ??
        'UNKNOWN'
      );

    counts[key] =
      (counts[key] ?? 0) + 1;
  }

  return counts;
}

function safeDiv(
  a,
  b
) {
  return (
    Number.isFinite(a)
    &&
    Number.isFinite(b)
    &&
    b !== 0
  )
    ? a / b
    : null;
}

function finite(
  value
) {
  const number =
    Number(value);

  return Number.isFinite(number)
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
    String(value).trim();

  return text
    ? text
    : null;
}

function pct(
  value
) {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return `${(value * 100).toFixed(2)}%`;
}
