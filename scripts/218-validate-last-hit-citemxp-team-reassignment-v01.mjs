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
// SCRIPT 218
// LAST-HIT <-> CITEMXP TEAM-REASSIGNMENT VALIDATION V0.1
//
// Research-only.
//
// Prior evidence:
// - Script 215: m_iLastHits counter is internally exact across six replays.
// - Script 216: alternate death substrates do not explain residuals.
// - Script 217: later CItemXP.m_iTeamNum changes are strongly enriched at
//   exact residual last-hit ticks (~41% vs <1% shifted controls).
//
// This script asks:
//
// 1. Can CItemXP team changes be matched one-to-one to last-hit credits?
// 2. How much additional coverage do they provide after consuming exact
//    eligible CNPC health-death anchors first?
// 3. Does the CItemXP destination team equal the credited player's team?
// 4. What are the dominant fromTeam -> toTeam transition signatures?
// 5. Are the same CItemXP entities repeatedly reassigned, consistent with
//    an entity-reuse/pooling substrate?
// 6. Do shifted-time controls collapse?
//
// IMPORTANT:
// A CItemXP team reassignment is not automatically an economic recipient,
// collection event, or "soul awarded to player" event.
// No promotion occurs here.
// ============================================================

const TICK_RATE = 64;

const WINDOWS = [0, 1, 2, 4, 8];

const PLACEBO_OFFSETS = {
  placebo10: 10 * TICK_RATE,
  placebo30: 30 * TICK_RATE
};

const PLACEBO_COLLISION_RADIUS = 8;

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
    'player_last_hit_citemxp_team_reassignment_validation_batch_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('LAST-HIT <-> CITEMXP TEAM-REASSIGNMENT VALIDATION V0.1');
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

    console.log(
      `${replayName.padEnd(10)} replay missing`
    );

    continue;
  }

  try {
    const raw =
      await collectReplay(
        replayPath
      );

    const result =
      analyzeReplay({
        replayName,
        raw
      });

    replayResults.push(
      result
    );

    writeReplayResult(
      replayName,
      result
    );

    const exact =
      result.windows['0'];

    console.log(
      `${replayName.padEnd(10)} ` +
      `credits=${String(result.counts.lastHitCredits).padStart(5)} ` +
      `CNPC=${pct(result.counts.exactCnpcCoverageRate).padStart(7)} ` +
      `residual=${String(result.counts.exactCnpcResidualCredits).padStart(5)} ` +
      `XP1to1=${pct(exact.residualTeamChangeMatchRate).padStart(7)} ` +
      `union=${pct(exact.combinedCoverageRate).padStart(7)} ` +
      `toTeamSame=${pct(exact.destinationSameAsPlayerRate).padStart(7)}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success: false,
      status: 'VALIDATION_EXCEPTION',
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
    'PLAYER_LAST_HIT_CITEMXP_TEAM_REASSIGNMENT_VALIDATION_BATCH_V01',

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
    successful.length ===
      replayNames.length,

  question:
    'Do CItemXP numeric team-reassignment events provide a specific, one-to-one, player-team-consistent substrate for scored m_iLastHits credits not explained by exact eligible CNPC health-death transitions?',

  authorityBoundary: [
    'CItemXP team reassignment is not automatically economic recipient attribution.',
    'CItemXP team reassignment is not automatically player collection.',
    'CItemXP team reassignment is not automatically a Ground Soul creation event.',
    'This diagnostic does not promote last_hits.'
  ],

  design: {
    tickRate:
      TICK_RATE,

    windowsTicks:
      WINDOWS,

    firstAnchor:
      'Exact one-to-one eligible CNPC_* m_iHealth > 0 -> <= 0 transition.',

    secondAnchor:
      'One-to-one CItemXP numeric m_iTeamNum change applied only to credits left residual after exact CNPC matching.',

    controls:
      'Residual credit ticks shifted +10s and +30s, excluding shifted points within +/-8 ticks of any real scored last-hit credit.'
  },

  aggregate,

  replays:
    replayResults
};

mkdirSync(
  dirname(
    batchPath
  ),
  { recursive: true }
);

writeFileSync(
  batchPath,
  JSON.stringify(
    batch,
    null,
    2
  ),
  'utf8'
);

printBatch(
  batch
);

// ============================================================
// Replay collection
// ============================================================

async function collectReplay(
  replayPath
) {
  const parser =
    new Parser();

  const previousController =
    new Map();

  const previousNpc =
    new Map();

  const previousXp =
    new Map();

  const creditTransitions =
    [];

  const npcDeaths =
    [];

  const xpTeamChanges =
    [];

  const xpFirstObserved =
    new Map();

  let minTick =
    Infinity;

  let maxTick =
    -Infinity;

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

      minTick =
        Math.min(
          minTick,
          tick
        );

      maxTick =
        Math.max(
          maxTick,
          tick
        );

      for (const event of events ?? []) {
        const entity =
          event?.entity;

        if (!entity) {
          continue;
        }

        const className =
          getEntityClassName(
            entity
          );

        const entityIndex =
          getEntityIndex(
            entity
          );

        if (
          !className ||
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
            !playerName ||
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
            previous &&
            Number.isFinite(
              previous.lastHits
            ) &&
            Number.isFinite(
              current.lastHits
            ) &&
            current.lastHits >
              previous.lastHits
          ) {
            creditTransitions.push({
              tick,

              controllerEntityIndex:
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
          className.startsWith(
            'CNPC_'
          )
        ) {
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

          const key =
            `${className}|${entityIndex}`;

          const previous =
            previousNpc.get(
              key
            )
            ??
            null;

          if (
            previous &&
            Number.isFinite(
              previous.health
            ) &&
            Number.isFinite(
              current.health
            ) &&
            previous.health > 0 &&
            current.health <= 0
          ) {
            npcDeaths.push({
              id:
                `npcDeath|${className}|${entityIndex}|${tick}`,

              tick,
              entityIndex,
              className,

              team:
                current.team
            });
          }

          previousNpc.set(
            key,
            current
          );
        }

        if (
          className ===
          'CItemXP'
        ) {
          const team =
            finite(
              safeGetField(
                entity,
                'm_iTeamNum'
              )
            );

          const previous =
            previousXp.get(
              entityIndex
            )
            ??
            null;

          if (
            !xpFirstObserved.has(
              entityIndex
            )
          ) {
            xpFirstObserved.set(
              entityIndex,
              {
                tick,
                entityIndex,
                firstTeam:
                  team
              }
            );
          }

          if (
            previous &&
            previous.team !== null &&
            team !== null &&
            previous.team !== team
          ) {
            xpTeamChanges.push({
              id:
                `xpTeamChange|${entityIndex}|${tick}|${previous.team}->${team}`,

              tick,

              entityIndex,

              fromTeam:
                previous.team,

              toTeam:
                team,

              transition:
                `${previous.team}->${team}`,

              firstObservedTick:
                xpFirstObserved
                  .get(
                    entityIndex
                  )
                  ?.tick
                ??
                null,

              changesBefore:
                previous.changeCount
            });
          }

          previousXp.set(
            entityIndex,
            {
              tick,
              team,

              changeCount:
                (
                  previous?.changeCount
                  ??
                  0
                )
                +
                (
                  previous &&
                  previous.team !== null &&
                  team !== null &&
                  previous.team !== team
                    ? 1
                    : 0
                )
            }
          );
        }
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
    minTick:
      Number.isFinite(
        minTick
      )
        ? minTick
        : null,

    maxTick:
      Number.isFinite(
        maxTick
      )
        ? maxTick
        : null,

    credits:
      expandCredits(
        creditTransitions
      ),

    npcDeaths,

    xpTeamChanges,

    xpFirstObserved:
      [...xpFirstObserved.values()]
  };
}

// ============================================================
// Analysis
// ============================================================

function analyzeReplay({
  replayName,
  raw
}) {
  const exactCnpc =
    greedyMatch({
      credits:
        raw.credits,

      events:
        raw.npcDeaths,

      maxTicks:
        0,

      eligibility:
        (
          credit,
          death
        ) =>
          isEligibleDeathForPlayer(
            death,
            credit.team
          )
    });

  const residualCredits =
    exactCnpc.unmatchedCredits;

  const allCreditTicks =
    raw.credits
      .map(
        row => row.tick
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );

  const placebo10 =
    makePlaceboCredits({
      residualCredits,
      offsetTicks:
        PLACEBO_OFFSETS.placebo10,
      minTick:
        raw.minTick,
      maxTick:
        raw.maxTick,
      allCreditTicks
    });

  const placebo30 =
    makePlaceboCredits({
      residualCredits,
      offsetTicks:
        PLACEBO_OFFSETS.placebo30,
      minTick:
        raw.minTick,
      maxTick:
        raw.maxTick,
      allCreditTicks
    });

  const windows =
    {};

  for (const window of WINDOWS) {
    const residualMatch =
      greedyMatch({
        credits:
          residualCredits,

        events:
          raw.xpTeamChanges,

        maxTicks:
          window,

        eligibility:
          () => true
      });

    const placebo10Match =
      greedyMatch({
        credits:
          placebo10.credits,

        events:
          raw.xpTeamChanges,

        maxTicks:
          window,

        eligibility:
          () => true
      });

    const placebo30Match =
      greedyMatch({
        credits:
          placebo30.credits,

        events:
          raw.xpTeamChanges,

        maxTicks:
          window,

        eligibility:
          () => true
      });

    const destinationRelation =
      summarizeDestinationRelation(
        residualMatch.matches
      );

    const sourceRelation =
      summarizeSourceRelation(
        residualMatch.matches
      );

    const signatureCounts =
      countBy(
        residualMatch.matches,
        row =>
          `${row.event.fromTeam}->${row.event.toTeam}`
      );

    const signedOffsets =
      countBy(
        residualMatch.matches,
        row =>
          String(
            row.signedTickDelta
          )
      );

    windows[
      String(
        window
      )
    ] = {
      residualTeamChangeMatches:
        residualMatch.matches.length,

      residualTeamChangeMatchRate:
        safeDiv(
          residualMatch.matches.length,
          residualCredits.length
        ),

      unmatchedAfterCnpcAndTeamChange:
        residualMatch.unmatchedCredits.length,

      combinedCoverageRate:
        safeDiv(
          exactCnpc.matches.length +
          residualMatch.matches.length,
          raw.credits.length
        ),

      placebo10Matches:
        placebo10Match.matches.length,

      placebo10MatchRate:
        safeDiv(
          placebo10Match.matches.length,
          placebo10.credits.length
        ),

      placebo30Matches:
        placebo30Match.matches.length,

      placebo30MatchRate:
        safeDiv(
          placebo30Match.matches.length,
          placebo30.credits.length
        ),

      destinationSameAsPlayer:
        destinationRelation.same,

      destinationOpposingPlayer:
        destinationRelation.opposing,

      destinationOtherOrUnknown:
        destinationRelation.other,

      destinationSameAsPlayerRate:
        safeDiv(
          destinationRelation.same,
          residualMatch.matches.length
        ),

      destinationOpposingPlayerRate:
        safeDiv(
          destinationRelation.opposing,
          residualMatch.matches.length
        ),

      sourceSameAsPlayer:
        sourceRelation.same,

      sourceOpposingPlayer:
        sourceRelation.opposing,

      sourceOtherOrUnknown:
        sourceRelation.other,

      sourceSameAsPlayerRate:
        safeDiv(
          sourceRelation.same,
          residualMatch.matches.length
        ),

      sourceOpposingPlayerRate:
        safeDiv(
          sourceRelation.opposing,
          residualMatch.matches.length
        ),

      transitionSignatures:
        sortDescending(
          signatureCounts
        ),

      signedTickOffsets:
        sortNumericKeys(
          signedOffsets
        ),

      matchedExamples:
        residualMatch.matches
          .slice(
            0,
            40
          )
          .map(
            row => ({
              credit:
                row.credit,

              event:
                row.event,

              signedTickDelta:
                row.signedTickDelta
            })
          )
    };
  }

  const entityReuse =
    summarizeEntityReuse(
      raw.xpTeamChanges,
      raw.xpFirstObserved
    );

  return {
    replayName,

    success:
      true,

    status:
      'CITEMXP_TEAM_REASSIGNMENT_VALIDATION_COMPLETE',

    counts: {
      lastHitCredits:
        raw.credits.length,

      exactCnpcMatches:
        exactCnpc.matches.length,

      exactCnpcCoverageRate:
        safeDiv(
          exactCnpc.matches.length,
          raw.credits.length
        ),

      exactCnpcResidualCredits:
        residualCredits.length,

      citemxpFirstObservedEntities:
        raw.xpFirstObserved.length,

      citemxpTeamChanges:
        raw.xpTeamChanges.length,

      citemxpEntitiesWithTeamChanges:
        entityReuse.entitiesWithChanges
    },

    placeboEligibility: {
      sourceResidualCredits:
        residualCredits.length,

      placebo10Retained:
        placebo10.credits.length,

      placebo10OutsideReplay:
        placebo10.outsideReplay,

      placebo10CreditCollision:
        placebo10.creditCollision,

      placebo30Retained:
        placebo30.credits.length,

      placebo30OutsideReplay:
        placebo30.outsideReplay,

      placebo30CreditCollision:
        placebo30.creditCollision
    },

    entityReuse,

    windows,

    authorityBoundary:
      'CItemXP m_iTeamNum reassignment is candidate runtime substrate only. It is not yet economic-recipient, collection, or last-hit-mechanism authority.'
  };
}

// ============================================================
// Aggregate
// ============================================================

function aggregateResults(
  rows
) {
  const counts = {
    lastHitCredits:
      0,

    exactCnpcMatches:
      0,

    exactCnpcResidualCredits:
      0,

    citemxpFirstObservedEntities:
      0,

    citemxpTeamChanges:
      0,

    citemxpEntitiesWithTeamChanges:
      0
  };

  for (const row of rows) {
    for (
      const key
      of Object.keys(
        counts
      )
    ) {
      counts[key] +=
        row.counts?.[key]
        ??
        0;
    }
  }

  const windows =
    {};

  for (const window of WINDOWS) {
    const key =
      String(
        window
      );

    const residualMatches =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.residualTeamChangeMatches
            ??
            0
          ),
        0
      );

    const placebo10Matches =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.placebo10Matches
            ??
            0
          ),
        0
      );

    const placebo30Matches =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.placebo30Matches
            ??
            0
          ),
        0
      );

    const placebo10Denominator =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row
              .placeboEligibility
              ?.placebo10Retained
            ??
            0
          ),
        0
      );

    const placebo30Denominator =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row
              .placeboEligibility
              ?.placebo30Retained
            ??
            0
          ),
        0
      );

    const destinationSame =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.destinationSameAsPlayer
            ??
            0
          ),
        0
      );

    const destinationOpposing =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.destinationOpposingPlayer
            ??
            0
          ),
        0
      );

    const destinationOther =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.destinationOtherOrUnknown
            ??
            0
          ),
        0
      );

    const sourceSame =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.sourceSameAsPlayer
            ??
            0
          ),
        0
      );

    const sourceOpposing =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.sourceOpposingPlayer
            ??
            0
          ),
        0
      );

    const sourceOther =
      rows.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row.windows
              ?.[key]
              ?.sourceOtherOrUnknown
            ??
            0
          ),
        0
      );

    const transitionSignatures =
      mergeCountObjects(
        rows.map(
          row =>
            row.windows
              ?.[key]
              ?.transitionSignatures
        )
      );

    const signedTickOffsets =
      mergeCountObjectsNumeric(
        rows.map(
          row =>
            row.windows
              ?.[key]
              ?.signedTickOffsets
        )
      );

    windows[key] = {
      residualTeamChangeMatches:
        residualMatches,

      residualTeamChangeMatchRate:
        safeDiv(
          residualMatches,
          counts.exactCnpcResidualCredits
        ),

      combinedCoverageRate:
        safeDiv(
          counts.exactCnpcMatches +
          residualMatches,
          counts.lastHitCredits
        ),

      unmatchedAfterCnpcAndTeamChange:
        counts.exactCnpcResidualCredits -
        residualMatches,

      placebo10Matches,

      placebo10MatchRate:
        safeDiv(
          placebo10Matches,
          placebo10Denominator
        ),

      placebo30Matches,

      placebo30MatchRate:
        safeDiv(
          placebo30Matches,
          placebo30Denominator
        ),

      destinationSameAsPlayer:
        destinationSame,

      destinationOpposingPlayer:
        destinationOpposing,

      destinationOtherOrUnknown:
        destinationOther,

      destinationSameAsPlayerRate:
        safeDiv(
          destinationSame,
          residualMatches
        ),

      destinationOpposingPlayerRate:
        safeDiv(
          destinationOpposing,
          residualMatches
        ),

      sourceSameAsPlayer:
        sourceSame,

      sourceOpposingPlayer:
        sourceOpposing,

      sourceOtherOrUnknown:
        sourceOther,

      sourceSameAsPlayerRate:
        safeDiv(
          sourceSame,
          residualMatches
        ),

      sourceOpposingPlayerRate:
        safeDiv(
          sourceOpposing,
          residualMatches
        ),

      transitionSignatures,

      signedTickOffsets
    };
  }

  const replayLevel = {};

  for (const window of WINDOWS) {
    const key =
      String(
        window
      );

    replayLevel[key] = {
      residualTeamChangeMatchRates:
        summarizeNumbers(
          rows.map(
            row =>
              row.windows
                ?.[key]
                ?.residualTeamChangeMatchRate
          )
        ),

      combinedCoverageRates:
        summarizeNumbers(
          rows.map(
            row =>
              row.windows
                ?.[key]
                ?.combinedCoverageRate
          )
        ),

      destinationSameAsPlayerRates:
        summarizeNumbers(
          rows.map(
            row =>
              row.windows
                ?.[key]
                ?.destinationSameAsPlayerRate
          )
        )
    };
  }

  return {
    counts: {
      ...counts,

      exactCnpcCoverageRate:
        safeDiv(
          counts.exactCnpcMatches,
          counts.lastHitCredits
        )
    },

    windows,

    replayLevel
  };
}

// ============================================================
// Helpers
// ============================================================

function greedyMatch({
  credits,
  events,
  maxTicks,
  eligibility
}) {
  const edges =
    [];

  for (
    let ci = 0;
    ci < credits.length;
    ci++
  ) {
    const credit =
      credits[ci];

    for (
      let ei = 0;
      ei < events.length;
      ei++
    ) {
      const event =
        events[ei];

      if (
        eligibility &&
        !eligibility(
          credit,
          event
        )
      ) {
        continue;
      }

      const signedTickDelta =
        event.tick -
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
        ei,
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
      a.ei -
      b.ei
  );

  const usedCredits =
    new Set();

  const usedEvents =
    new Set();

  const matches =
    [];

  for (const edge of edges) {
    if (
      usedCredits.has(
        edge.ci
      )
      ||
      usedEvents.has(
        edge.ei
      )
    ) {
      continue;
    }

    usedCredits.add(
      edge.ci
    );

    usedEvents.add(
      edge.ei
    );

    matches.push({
      credit:
        credits[
          edge.ci
        ],

      event:
        events[
          edge.ei
        ],

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
          _row,
          index
        ) =>
          !usedCredits.has(
            index
          )
      )
  };
}

function makePlaceboCredits({
  residualCredits,
  offsetTicks,
  minTick,
  maxTick,
  allCreditTicks
}) {
  const credits =
    [];

  let outsideReplay =
    0;

  let creditCollision =
    0;

  for (
    let i = 0;
    i < residualCredits.length;
    i++
  ) {
    const source =
      residualCredits[i];

    const tick =
      source.tick +
      offsetTicks;

    if (
      !Number.isFinite(
        minTick
      )
      ||
      !Number.isFinite(
        maxTick
      )
      ||
      tick < minTick
      ||
      tick > maxTick
    ) {
      outsideReplay++;
      continue;
    }

    if (
      hasTickWithin(
        allCreditTicks,
        tick,
        PLACEBO_COLLISION_RADIUS
      )
    ) {
      creditCollision++;
      continue;
    }

    credits.push({
      id:
        `placebo|${offsetTicks}|${source.id}`,

      tick,

      team:
        source.team,

      playerName:
        source.playerName,

      sourceCreditId:
        source.id
    });
  }

  return {
    credits,
    outsideReplay,
    creditCollision
  };
}

function summarizeDestinationRelation(
  matches
) {
  const result = {
    same: 0,
    opposing: 0,
    other: 0
  };

  for (const row of matches) {
    const relation =
      teamRelation(
        row.credit.team,
        row.event.toTeam
      );

    result[
      relation
    ]++;
  }

  return result;
}

function summarizeSourceRelation(
  matches
) {
  const result = {
    same: 0,
    opposing: 0,
    other: 0
  };

  for (const row of matches) {
    const relation =
      teamRelation(
        row.credit.team,
        row.event.fromTeam
      );

    result[
      relation
    ]++;
  }

  return result;
}

function teamRelation(
  playerTeam,
  eventTeam
) {
  if (
    !isCompetitiveTeam(
      playerTeam
    )
    ||
    !isCompetitiveTeam(
      eventTeam
    )
  ) {
    return 'other';
  }

  return playerTeam === eventTeam
    ? 'same'
    : 'opposing';
}

function summarizeEntityReuse(
  xpTeamChanges,
  xpFirstObserved
) {
  const counts =
    new Map();

  for (const event of xpTeamChanges) {
    counts.set(
      event.entityIndex,
      (
        counts.get(
          event.entityIndex
        )
        ??
        0
      )
      +
      1
    );
  }

  const perEntity =
    [...counts.values()]
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );

  const repeatedEntities =
    perEntity.filter(
      count =>
        count > 1
    ).length;

  return {
    firstObservedEntities:
      xpFirstObserved.length,

    entitiesWithChanges:
      perEntity.length,

    totalTeamChanges:
      xpTeamChanges.length,

    entitiesWithMultipleChanges:
      repeatedEntities,

    repeatedEntityShare:
      safeDiv(
        repeatedEntities,
        perEntity.length
      ),

    changesPerChangedEntity: {
      min:
        perEntity.length
          ? perEntity[0]
          : null,

      median:
        quantile(
          perEntity,
          0.5
        ),

      mean:
        perEntity.length
          ? (
              perEntity.reduce(
                (
                  total,
                  value
                ) =>
                  total +
                  value,
                0
              )
              /
              perEntity.length
            )
          : null,

      max:
        perEntity.length
          ? perEntity[
              perEntity.length -
              1
            ]
          : null
    }
  };
}

function expandCredits(
  transitions
) {
  const result =
    [];

  for (const row of transitions) {
    const count =
      Math.max(
        0,
        Math.trunc(
          row.delta
        )
      );

    for (
      let ordinal = 0;
      ordinal < count;
      ordinal++
    ) {
      result.push({
        id:
          `lastHit|${row.controllerEntityIndex}|${row.tick}|${ordinal}`,

        tick:
          row.tick,

        controllerEntityIndex:
          row.controllerEntityIndex,

        playerName:
          row.playerName,

        team:
          row.team,

        ordinalWithinTransition:
          ordinal +
          1
      });
    }
  }

  return result;
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

function hasTickWithin(
  sortedTicks,
  targetTick,
  radius
) {
  let low =
    0;

  let high =
    sortedTicks.length;

  while (
    low <
    high
  ) {
    const mid =
      Math.floor(
        (
          low +
          high
        )
        /
        2
      );

    if (
      sortedTicks[mid] <
      targetTick -
        radius
    ) {
      low =
        mid +
        1;
    } else {
      high =
        mid;
    }
  }

  return (
    low <
      sortedTicks.length
    &&
    sortedTicks[low] <=
      targetTick +
        radius
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
        keyFn(
          row
        )
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

function sortNumericKeys(
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
          Number(
            a[0]
          )
          -
          Number(
            b[0]
          )
      )
  );
}

function mergeCountObjects(
  objects
) {
  const merged =
    {};

  for (const object of objects) {
    for (
      const [
        key,
        value
      ]
      of Object.entries(
        object
        ??
        {}
      )
    ) {
      merged[key] =
        (
          merged[key]
          ??
          0
        )
        +
        value;
    }
  }

  return sortDescending(
    merged
  );
}

function mergeCountObjectsNumeric(
  objects
) {
  const merged =
    {};

  for (const object of objects) {
    for (
      const [
        key,
        value
      ]
      of Object.entries(
        object
        ??
        {}
      )
    ) {
      merged[key] =
        (
          merged[key]
          ??
          0
        )
        +
        value;
    }
  }

  return sortNumericKeys(
    merged
  );
}

function summarizeNumbers(
  values
) {
  const finiteValues =
    values
      .filter(
        Number.isFinite
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );

  if (
    finiteValues.length ===
    0
  ) {
    return {
      n: 0,
      min: null,
      median: null,
      mean: null,
      max: null
    };
  }

  return {
    n:
      finiteValues.length,

    min:
      finiteValues[0],

    median:
      quantile(
        finiteValues,
        0.5
      ),

    mean:
      finiteValues.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      )
      /
      finiteValues.length,

    max:
      finiteValues[
        finiteValues.length -
        1
      ]
  };
}

function quantile(
  sorted,
  q
) {
  if (
    !sorted ||
    sorted.length ===
      0
  ) {
    return null;
  }

  const index =
    (
      sorted.length -
      1
    )
    *
    q;

  const lower =
    Math.floor(
      index
    );

  const upper =
    Math.ceil(
      index
    );

  if (
    lower ===
    upper
  ) {
    return sorted[
      lower
    ];
  }

  const fraction =
    index -
    lower;

  return (
    sorted[
      lower
    ]
    *
    (
      1 -
      fraction
    )
    +
    sorted[
      upper
    ]
    *
    fraction
  );
}

function writeReplayResult(
  replayName,
  result
) {
  const outputPath =
    resolve(
      'output',
      replayName,
      'player_last_hit_citemxp_team_reassignment_validation_v01.json'
    );

  mkdirSync(
    dirname(
      outputPath
    ),
    { recursive: true }
  );

  writeFileSync(
    outputPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    'utf8'
  );
}

function printBatch(
  batch
) {
  const a =
    batch.aggregate;

  console.log('');
  console.log('========================================================');
  console.log('BATCH TEAM-REASSIGNMENT VALIDATION');
  console.log('========================================================');
  console.log(
    `Successful replays: ${batch.successCount}/${batch.replayCount}`
  );
  console.log(
    `Last-hit credits: ${a.counts.lastHitCredits}`
  );
  console.log(
    `Exact CNPC matches: ${a.counts.exactCnpcMatches} (${pct(a.counts.exactCnpcCoverageRate)})`
  );
  console.log(
    `Exact CNPC residuals: ${a.counts.exactCnpcResidualCredits}`
  );
  console.log(
    `CItemXP first-observed entities: ${a.counts.citemxpFirstObservedEntities}`
  );
  console.log(
    `CItemXP team changes: ${a.counts.citemxpTeamChanges}`
  );
  console.log('');

  for (const window of WINDOWS) {
    const key =
      String(
        window
      );

    const label =
      window === 0
        ? 'exact'
        : `±${window} ticks`;

    const row =
      a.windows[
        key
      ];

    console.log(
      `${label}:`
    );

    console.log(
      `  residual -> XP team change  ${row.residualTeamChangeMatches}/${a.counts.exactCnpcResidualCredits} = ${pct(row.residualTeamChangeMatchRate)}`
    );

    console.log(
      `  combined CNPC + XP coverage ${pct(row.combinedCoverageRate)}`
    );

    console.log(
      `  destination team = player   ${pct(row.destinationSameAsPlayerRate)}`
    );

    console.log(
      `  destination team opposing   ${pct(row.destinationOpposingPlayerRate)}`
    );

    console.log(
      `  placebo +10 s               ${pct(row.placebo10MatchRate)}`
    );

    console.log(
      `  placebo +30 s               ${pct(row.placebo30MatchRate)}`
    );

    console.log('');
  }

  console.log(
    'Top exact transition signatures:'
  );

  for (
    const [
      signature,
      count
    ]
    of Object.entries(
      a.windows['0']
        .transitionSignatures
      ??
      {}
    )
      .slice(
        0,
        12
      )
  ) {
    console.log(
      `  ${signature.padEnd(16)} ${count}`
    );
  }

  console.log('');
  console.log(
    `Output: ${batchPath}`
  );
  console.log('');
  console.log(
    'IMPORTANT: research-only; CItemXP team reassignment is not yet economic-recipient or collection authority.'
  );
  console.log('');
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
  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(
        2
      )}%`
    : '—';
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
    ).trim();

  return text
    ? text
    : null;
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
