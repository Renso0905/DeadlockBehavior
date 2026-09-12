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
// SCRIPT 213
// SCOREBOARD LAST-HIT CREDIT SEMANTIC VALIDATION V0.1
//
// Narrow construct under test:
//   CCitadelPlayerController.m_iLastHits
//     = game-awarded NPC last-hit credits.
//
// Independent anchor:
// - positive NPC m_iHealth -> <=0 transitions on CNPC_* entities.
//
// This script deliberately does NOT claim victim identity on
// collision ticks, nor does it infer damage ownership.
//
// Research only. No promotion.
// ============================================================

const TICK_RATE = 64;
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

const replayNames =
  process.argv.slice(2).filter(Boolean).length
    ? process.argv.slice(2).filter(Boolean)
    : DEFAULT_REPLAYS;

const batchPath =
  resolve(
    'output',
    'cross_replay',
    'player_last_hit_credit_validation_batch_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('PLAYER LAST-HIT CREDIT SEMANTIC VALIDATION V0.1');
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

  if (!existsSync(replayPath)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'REPLAY_MISSING'
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
      `LH=${String(result.counts.lastHitCredits).padStart(5)} ` +
      `exact=${pct(result.validation.exactNpcDeathAgreementRate).padStart(7)} ` +
      `isolated=${String(result.counts.isolatedExactMatches).padStart(4)} ` +
      `sameTeam=${pct(result.validation.sameTeamConflictRate).padStart(7)} ` +
      `placebo10=${pct(result.validation.placebo10AgreementRate).padStart(7)}`
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
  replayResults.filter(
    row => row.success
  );

const aggregate =
  aggregateResults(
    successful
  );

const batch = {
  version:
    'PLAYER_LAST_HIT_CREDIT_VALIDATION_BATCH_V01',

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
    'game-awarded NPC last-hit credit counter',

  authorityBoundary: {
    researchOnly:
      true,

    promotesClaim:
      false,

    promotesMetric:
      false,

    establishedIfSupported:
      'm_iLastHits behaves as a game-awarded NPC last-hit credit counter',

    explicitlyNotEstablished: [
      'victim identity on multi-death collision ticks',
      'damage source ownership',
      'exact game eligibility rules for every NPC class',
      'deny semantics'
    ]
  },

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
console.log('BATCH EVIDENCE');
console.log('========================================================');
console.log(`Successful replays: ${successful.length}/${replayNames.length}`);
console.log(`Last-hit credits: ${aggregate.counts.lastHitCredits}`);
console.log(`NPC health->0 transitions: ${aggregate.counts.npcDeathTransitions}`);
console.log(
  `Last-hit -> exact eligible NPC death agreement: ` +
  `${pct(aggregate.validation.exactNpcDeathAgreementRate)}`
);
console.log(
  `Same-team NPC death conflicts: ` +
  `${pct(aggregate.validation.sameTeamConflictRate)}`
);
console.log(
  `Isolated exact one-credit/one-death anchors: ` +
  `${aggregate.counts.isolatedExactMatches}`
);
console.log(
  `10 s placebo agreement: ${pct(aggregate.validation.placebo10AgreementRate)}`
);
console.log(
  `30 s placebo agreement: ${pct(aggregate.validation.placebo30AgreementRate)}`
);
console.log(
  `Unmatched last-hit credits: ${aggregate.counts.unmatchedLastHitCredits}`
);
console.log('');
console.log('Matched NPC classes:');
for (const [className, count] of Object.entries(aggregate.matchedNpcClasses)) {
  console.log(`  ${className.padEnd(34)} ${count}`);
}
console.log('');
console.log(`Output: ${batchPath}`);
console.log('');
console.log(
  'IMPORTANT: exact-tick NPC death correspondence validates scoreboard-credit semantics; multi-death ticks are not forced into victim-level attribution.'
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

  const previousNpc =
    new Map();

  const lastHitEvents =
    [];

  const npcDeaths =
    [];

  const counterRegressions =
    [];

  const telemetry = {
    controllerEntityUpdates: 0,
    npcEntityUpdates: 0
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
          telemetry.controllerEntityUpdates++;

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
          ) {
            if (
              current.lastHits >
              previous.lastHits
            ) {
              lastHitEvents.push({
                tick,

                controllerEntityIndex:
                  entityIndex,

                playerName,

                team:
                  current.team,

                heroId:
                  current.heroId,

                previous:
                  previous.lastHits,

                current:
                  current.lastHits,

                delta:
                  current.lastHits -
                  previous.lastHits
              });
            } else if (
              current.lastHits <
              previous.lastHits
            ) {
              counterRegressions.push({
                tick,

                controllerEntityIndex:
                  entityIndex,

                playerName,

                previous:
                  previous.lastHits,

                current:
                  current.lastHits
              });
            }
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

        telemetry.npcEntityUpdates++;

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
            ),

          maxHealth:
            finite(
              safeGetField(
                entity,
                'm_iMaxHealth'
              )
            ),

          subclassId:
            stringOrNull(
              safeGetField(
                entity,
                'm_nEntitySubclassID'
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
          previous.health >
            0
          &&
          current.health <=
            0
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
              current.health,

            maxHealth:
              current.maxHealth,

            subclassId:
              current.subclassId
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

  const creditSlots =
    expandCounterSlots(
      lastHitEvents
    );

  const exact =
    classifyCredits({
      credits:
        creditSlots,

      npcDeaths
    });

  const placebo10 =
    classifyCredits({
      credits:
        creditSlots.map(
          row => ({
            ...row,
            tick:
              row.tick +
              PLACEBO_10_TICKS
          })
        ),

      npcDeaths
    });

  const placebo30 =
    classifyCredits({
      credits:
        creditSlots.map(
          row => ({
            ...row,
            tick:
              row.tick +
              PLACEBO_30_TICKS
          })
        ),

      npcDeaths
    });

  const exactMatched =
    exact.filter(
      row =>
        row.eligibleDeaths.length >
        0
    );

  const exactSameTeamOnly =
    exact.filter(
      row =>
        row.eligibleDeaths.length ===
          0
        &&
        row.sameTeamDeaths.length >
          0
    );

  const isolatedExact =
    exact.filter(
      row =>
        row.eligibleDeaths.length ===
          1
        &&
        row.allEligibleCreditUnitsAtTick ===
          1
        &&
        row.transitionDelta ===
          1
    );

  const unmatched =
    exact.filter(
      row =>
        row.eligibleDeaths.length ===
          0
    );

  const matchedNpcClasses =
    {};

  for (const row of isolatedExact) {
    const className =
      row.eligibleDeaths[0]
        ?.className
      ??
      'UNKNOWN';

    matchedNpcClasses[className] =
      (
        matchedNpcClasses[
          className
        ]
        ??
        0
      )
      +
      1;
  }

  const allExactClassEvidence =
    {};

  for (const row of exactMatched) {
    for (const death of row.eligibleDeaths) {
      const className =
        death.className
        ??
        'UNKNOWN';

      allExactClassEvidence[className] =
        (
          allExactClassEvidence[
            className
          ]
          ??
          0
        )
        +
        1;
    }
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

  const summaryPath =
    resolve(
      outputDir,
      'player_last_hit_credit_validation_v01.json'
    );

  const eventPath =
    resolve(
      outputDir,
      'player_last_hit_credit_events_v01.jsonl'
    );

  const validation = {
    exactNpcDeathAgreementRate:
      safeDiv(
        exactMatched.length,
        creditSlots.length
      ),

    sameTeamConflictRate:
      safeDiv(
        exactSameTeamOnly.length,
        creditSlots.length
      ),

    placebo10AgreementRate:
      safeDiv(
        placebo10.filter(
          row =>
            row.eligibleDeaths.length >
              0
        ).length,
        creditSlots.length
      ),

    placebo30AgreementRate:
      safeDiv(
        placebo30.filter(
          row =>
            row.eligibleDeaths.length >
              0
        ).length,
        creditSlots.length
      ),

    counterRegressionCount:
      counterRegressions.length
  };

  const summary = {
    version:
      'PLAYER_LAST_HIT_CREDIT_VALIDATION_V01',

    canonical:
      false,

    replay:
      replayName,

    construct:
      'game-awarded NPC last-hit credit counter',

    telemetry,

    counts: {
      lastHitTransitions:
        lastHitEvents.length,

      lastHitCredits:
        creditSlots.length,

      npcDeathTransitions:
        npcDeaths.length,

      exactCreditsWithEligibleNpcDeath:
        exactMatched.length,

      isolatedExactMatches:
        isolatedExact.length,

      sameTeamOnlyConflicts:
        exactSameTeamOnly.length,

      unmatchedLastHitCredits:
        unmatched.length,

      counterRegressions:
        counterRegressions.length
    },

    validation,

    matchedNpcClasses,

    allExactClassEvidence,

    unmatchedExamples:
      unmatched.slice(
        0,
        50
      ),

    counterRegressions,

    outputs: {
      summary:
        summaryPath,

      events:
        eventPath
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
    eventPath,
    exact
      .map(
        row =>
          JSON.stringify(
            row
          )
      )
      .join('\n')
      +
      (
        exact.length >
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
      'RESEARCH_VALIDATION_COMPLETE',

    counts:
      summary.counts,

    validation,

    matchedNpcClasses,

    allExactClassEvidence,

    outputs:
      summary.outputs
  };
}

function classifyCredits({
  credits,
  npcDeaths
}) {
  const creditUnitsByTick =
    new Map();

  for (const credit of credits) {
    creditUnitsByTick.set(
      credit.tick,
      (
        creditUnitsByTick.get(
          credit.tick
        )
        ??
        0
      )
      +
      1
    );
  }

  const deathsByTick =
    new Map();

  for (const death of npcDeaths) {
    if (
      !deathsByTick.has(
        death.tick
      )
    ) {
      deathsByTick.set(
        death.tick,
        []
      );
    }

    deathsByTick
      .get(
        death.tick
      )
      .push(
        death
      );
  }

  return credits.map(
    credit => {
      const deaths =
        deathsByTick.get(
          credit.tick
        )
        ??
        [];

      const eligibleDeaths =
        deaths.filter(
          death =>
            isEligibleDeathForPlayer(
              death,
              credit.team
            )
        );

      const sameTeamDeaths =
        deaths.filter(
          death =>
            isSameCompetitiveTeam(
              death.team,
              credit.team
            )
        );

      return {
        ...credit,

        allEligibleCreditUnitsAtTick:
          creditUnitsByTick.get(
            credit.tick
          )
          ??
          0,

        allNpcDeathsAtTick:
          deaths,

        eligibleDeaths,

        sameTeamDeaths
      };
    }
  );
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

  // Neutral / non-team NPC classes remain eligible candidates.
  return true;
}

function isSameCompetitiveTeam(
  npcTeam,
  playerTeam
) {
  return (
    isCompetitiveTeam(
      npcTeam
    )
    &&
    isCompetitiveTeam(
      playerTeam
    )
    &&
    npcTeam ===
      playerTeam
  );
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

function expandCounterSlots(
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
          `lastHit|${event.controllerEntityIndex}|${event.tick}|${i}`,

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
          i +
          1
      });
    }
  }

  return slots;
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
                ?.[key]
            )
            ??
            0
          ),
        0
      );

  const lastHitCredits =
    sum(
      'lastHitCredits'
    );

  const exact =
    sum(
      'exactCreditsWithEligibleNpcDeath'
    );

  const sameTeam =
    sum(
      'sameTeamOnlyConflicts'
    );

  const placebo10 =
    successful.reduce(
      (
        total,
        row
      ) =>
        total +
        Math.round(
          (
            row
              ?.validation
              ?.placebo10AgreementRate
            ??
            0
          )
          *
          (
            row
              ?.counts
              ?.lastHitCredits
            ??
            0
          )
        ),
      0
    );

  const placebo30 =
    successful.reduce(
      (
        total,
        row
      ) =>
        total +
        Math.round(
          (
            row
              ?.validation
              ?.placebo30AgreementRate
            ??
            0
          )
          *
          (
            row
              ?.counts
              ?.lastHitCredits
            ??
            0
          )
        ),
      0
    );

  const matchedNpcClasses =
    {};

  for (const row of successful) {
    for (
      const [
        className,
        count
      ]
      of Object.entries(
        row.matchedNpcClasses
        ??
        {}
      )
    ) {
      matchedNpcClasses[className] =
        (
          matchedNpcClasses[
            className
          ]
          ??
          0
        )
        +
        count;
    }
  }

  return {
    counts: {
      lastHitCredits,

      npcDeathTransitions:
        sum(
          'npcDeathTransitions'
        ),

      exactCreditsWithEligibleNpcDeath:
        exact,

      isolatedExactMatches:
        sum(
          'isolatedExactMatches'
        ),

      sameTeamOnlyConflicts:
        sameTeam,

      unmatchedLastHitCredits:
        sum(
          'unmatchedLastHitCredits'
        ),

      counterRegressions:
        sum(
          'counterRegressions'
        )
    },

    validation: {
      exactNpcDeathAgreementRate:
        safeDiv(
          exact,
          lastHitCredits
        ),

      sameTeamConflictRate:
        safeDiv(
          sameTeam,
          lastHitCredits
        ),

      placebo10AgreementRate:
        safeDiv(
          placebo10,
          lastHitCredits
        ),

      placebo30AgreementRate:
        safeDiv(
          placebo30,
          lastHitCredits
        )
    },

    matchedNpcClasses:
      sortObjectDescending(
        matchedNpcClasses
      )
  };
}

function sortObjectDescending(
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
    )
      .trim();

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
    b !==
      0
  )
    ? a /
      b
    : null;
}

function pct(
  value
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return '—';
  }

  return `${(
    value *
    100
  ).toFixed(2)}%`;
}
