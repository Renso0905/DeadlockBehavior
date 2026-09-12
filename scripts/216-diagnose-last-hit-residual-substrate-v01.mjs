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
// SCRIPT 216
// LAST-HIT RESIDUAL SUBSTRATE DIAGNOSTICS V0.1
//
// Research-only.
//
// Script215 established that m_iLastHits is internally clean:
// final sampled total == sampled positive deltas == raw positive
// deltas, with zero regressions and zero out-of-gameplay credits.
//
// The unresolved question is semantic/substrate:
// why do many scored last-hit credits lack an exact-tick eligible
// CNPC_* m_iHealth > 0 -> <= 0 transition?
//
// Design:
//   Pass 1
//     - collect scored m_iLastHits credit units
//     - collect CNPC_* health->0 anchors
//     - freeze exact one-to-one matched vs residual credits
//
//   Pass 2
//     - scan all entity classes for selected transition signals
//     - health >0 -> <=0
//     - m_lifeState changes
//     - CItemXP activity / selected field changes
//
// Controls:
//   - exact matched credits = positive-control points
//   - residual credits = target points
//   - residual tick +10 s = shifted-time placebo
//   - residual tick +30 s = shifted-time placebo
//
// Placebos colliding within +/-8 ticks of a real last-hit credit
// are excluded.
//
// IMPORTANT:
// Signal enrichment is discovery evidence only. This script does
// not promote last_hits and does not infer a new last-hit rule.
// ============================================================

const TICK_RATE = 64;

const WINDOWS = [
  0,
  4,
  8
];

const PLACEBO_OFFSETS = {
  placebo10:
    10 * TICK_RATE,

  placebo30:
    30 * TICK_RATE
};

const PLACEBO_COLLISION_WINDOW_TICKS =
  8;

const DEFAULT_REPLAYS = [
  'test',
  'rep01',
  'rep02',
  'rep03',
  'rep04',
  'rep05'
];

const CITEMXP_FIELDS = [
  'm_hVacuumTarget',
  'm_bActive',
  'm_bActivated',
  'm_iTeamNum',
  'm_iHealth',
  'm_nState',
  'm_eState'
];

const requested =
  process.argv.slice(2).filter(Boolean);

const replayNames =
  requested.length
    ? requested
    : DEFAULT_REPLAYS;

const batchOutputPath =
  resolve(
    'output',
    'cross_replay',
    'player_last_hit_residual_substrate_diagnostics_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('LAST-HIT RESIDUAL SUBSTRATE DIAGNOSTICS V0.1');
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
      success:
        false,
      status:
        'REPLAY_MISSING'
    });

    console.log(
      `${replayName.padEnd(10)} replay missing`
    );

    continue;
  }

  try {
    const pass1 =
      await collectCreditsAndNpcDeaths(
        replayPath
      );

    const frozen =
      freezeTargetPoints(
        pass1
      );

    const relevantTicks =
      buildRelevantTickSet(
        frozen
      );

    const pass2 =
      await collectSubstrateSignals(
        replayPath,
        relevantTicks
      );

    const result =
      analyzeReplay({
        replayName,
        pass1,
        frozen,
        pass2
      });

    replayResults.push(
      result
    );

    writeReplayOutput(
      replayName,
      result
    );

    const residualExact =
      result
        .groups
        .residual
        .windows
        ['0'];

    const residual8 =
      result
        .groups
        .residual
        .windows
        ['8'];

    console.log(
      `${replayName.padEnd(10)} ` +
      `credits=${String(result.counts.lastHitCredits).padStart(5)} ` +
      `residual=${String(result.counts.residualCredits).padStart(5)} ` +
      `health0=${pct(residualExact.withAnyHealthDeathRate).padStart(7)} ` +
      `nonCNPC0=${pct(residualExact.withNonCNPCHealthDeathRate).padStart(7)} ` +
      `life0=${pct(residualExact.withLifeStateTransitionRate).padStart(7)} ` +
      `xp0=${pct(residualExact.withCItemXPPacketRate).padStart(7)} ` +
      `health8=${pct(residual8.withAnyHealthDeathRate).padStart(7)}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success:
        false,
      status:
        'DIAGNOSTIC_EXCEPTION',
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
  aggregateReplayResults(
    successful
  );

const batch = {
  version:
    'PLAYER_LAST_HIT_RESIDUAL_SUBSTRATE_DIAGNOSTICS_BATCH_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  requestedReplays:
    replayNames,

  successCount:
    successful.length,

  replayCount:
    replayNames.length,

  allRequestedReplaysSucceeded:
    successful.length ===
      replayNames.length,

  question:
    'What entity/death/lifecycle signals distinguish exact-tick residual m_iLastHits credits from known exact CNPC death matches and shifted-time placebos?',

  authorityBoundary:
    'Discovery diagnostic only. Signal enrichment does not establish causation, last-hit eligibility, or a production-safe semantic rule.',

  design: {
    tickRate:
      TICK_RATE,

    windowsTicks:
      WINDOWS,

    placeboOffsetsTicks:
      PLACEBO_OFFSETS,

    placeboCollisionWindowTicks:
      PLACEBO_COLLISION_WINDOW_TICKS,

    exactPositiveControl:
      'Credits one-to-one matched to eligible same-tick CNPC_* health >0 -> <=0 transitions.',

    residualDefinition:
      'Scored m_iLastHits credit unit not used by the exact same-tick eligible CNPC_* one-to-one match.',

    placeboDefinition:
      'Residual credit tick shifted by +10s or +30s; candidate excluded when outside replay bounds or within +/-8 ticks of a real scored last-hit credit.'
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

printBatch(
  batch
);

async function collectCreditsAndNpcDeaths(
  replayPath
) {
  const parser =
    new Parser();

  const previousController =
    new Map();

  const previousNpc =
    new Map();

  const creditTransitions =
    [];

  const npcDeaths =
    [];

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

      for (
        const event
        of events ?? []
      ) {
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
            playerName ===
              'SourceTV'
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

        const key =
          `${className}|${entityIndex}`;

        const previous =
          previousNpc.get(
            key
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
              `npcDeath|${className}|${entityIndex}|${tick}`,

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
          key,
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
      expandCreditSlots(
        creditTransitions
      ),

    creditTransitions,

    npcDeaths
  };
}

function freezeTargetPoints(
  pass1
) {
  const exact =
    matchCreditsToNpcDeaths({
      credits:
        pass1.credits,

      npcDeaths:
        pass1.npcDeaths,

      maxTicks:
        0
    });

  const matchedPoints =
    exact.matches.map(
      (
        row,
        index
      ) => ({
        id:
          `matched|${index}|${row.credit.id}`,

        group:
          'matched',

        tick:
          row.credit.tick,

        playerName:
          row.credit.playerName,

        playerTeam:
          row.credit.team,

        sourceCreditId:
          row.credit.id,

        anchor:
          row.death
      })
    );

  const residualPoints =
    exact.unmatchedCredits.map(
      (
        credit,
        index
      ) => ({
        id:
          `residual|${index}|${credit.id}`,

        group:
          'residual',

        tick:
          credit.tick,

        playerName:
          credit.playerName,

        playerTeam:
          credit.team,

        sourceCreditId:
          credit.id
      })
    );

  const actualCreditTicks =
    pass1
      .credits
      .map(
        row =>
          row.tick
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
    buildPlaceboPoints({
      residualPoints,
      group:
        'placebo10',
      offsetTicks:
        PLACEBO_OFFSETS.placebo10,
      minTick:
        pass1.minTick,
      maxTick:
        pass1.maxTick,
      actualCreditTicks
    });

  const placebo30 =
    buildPlaceboPoints({
      residualPoints,
      group:
        'placebo30',
      offsetTicks:
        PLACEBO_OFFSETS.placebo30,
      minTick:
        pass1.minTick,
      maxTick:
        pass1.maxTick,
      actualCreditTicks
    });

  return {
    exactMatches:
      exact.matches,

    groups: {
      matched:
        matchedPoints,

      residual:
        residualPoints,

      placebo10:
        placebo10.points,

      placebo30:
        placebo30.points
    },

    placeboExclusions: {
      placebo10:
        placebo10.exclusions,

      placebo30:
        placebo30.exclusions
    }
  };
}

function buildPlaceboPoints({
  residualPoints,
  group,
  offsetTicks,
  minTick,
  maxTick,
  actualCreditTicks
}) {
  const points =
    [];

  let outsideReplay =
    0;

  let creditCollision =
    0;

  for (
    let index =
      0;
    index <
      residualPoints.length;
    index++
  ) {
    const source =
      residualPoints[index];

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
      tick <
        minTick
      ||
      tick >
        maxTick
    ) {
      outsideReplay++;
      continue;
    }

    if (
      hasTickWithin(
        actualCreditTicks,
        tick,
        PLACEBO_COLLISION_WINDOW_TICKS
      )
    ) {
      creditCollision++;
      continue;
    }

    points.push({
      id:
        `${group}|${index}|${source.sourceCreditId}`,

      group,

      tick,

      playerName:
        source.playerName,

      playerTeam:
        source.playerTeam,

      sourceCreditId:
        source.sourceCreditId,

      sourceResidualTick:
        source.tick,

      offsetTicks
    });
  }

  return {
    points,

    exclusions: {
      sourceResiduals:
        residualPoints.length,

      retained:
        points.length,

      outsideReplay,

      creditCollision
    }
  };
}

function buildRelevantTickSet(
  frozen
) {
  const result =
    new Set();

  for (
    const points
    of Object.values(
      frozen.groups
    )
  ) {
    for (const point of points) {
      for (
        let offset =
          -Math.max(
            ...WINDOWS
          );
        offset <=
          Math.max(
            ...WINDOWS
          );
        offset++
      ) {
        result.add(
          point.tick +
          offset
        );
      }
    }
  }

  return result;
}

async function collectSubstrateSignals(
  replayPath,
  relevantTicks
) {
  const parser =
    new Parser();

  const previousState =
    new Map();

  const healthDeathsByTick =
    new Map();

  const lifeTransitionsByTick =
    new Map();

  const citemxpPacketsByTick =
    new Map();

  const citemxpFieldTransitionsByTick =
    new Map();

  const operationMetadataByTick =
    new Map();

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

      const relevant =
        relevantTicks.has(
          tick
        );

      for (
        const event
        of events ?? []
      ) {
        if (relevant) {
          const operation =
            extractOperationMetadata(
              event
            );

          if (operation) {
            pushTickEvent(
              operationMetadataByTick,
              tick,
              operation
            );
          }
        }

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
          !className
          ||
          entityIndex === null
        ) {
          continue;
        }

        const key =
          `${className}|${entityIndex}`;

        const health =
          finite(
            safeGetField(
              entity,
              'm_iHealth'
            )
          );

        const lifeState =
          scalarOrNull(
            safeGetField(
              entity,
              'm_lifeState'
            )
          );

        const team =
          finite(
            safeGetField(
              entity,
              'm_iTeamNum'
            )
          );

        const current = {
          tick,
          entityIndex,
          className,
          health,
          lifeState,
          team
        };

        if (
          className ===
          'CItemXP'
        ) {
          current.citemxpFields =
            Object.fromEntries(
              CITEMXP_FIELDS.map(
                field => [
                  field,
                  scalarOrNull(
                    safeGetField(
                      entity,
                      field
                    )
                  )
                ]
              )
            );

          if (relevant) {
            pushTickEvent(
              citemxpPacketsByTick,
              tick,
              {
                tick,
                entityIndex,
                className,
                team,
                fields:
                  current.citemxpFields
              }
            );
          }
        }

        const previous =
          previousState.get(
            key
          )
          ??
          null;

        if (
          relevant
          &&
          previous
        ) {
          if (
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
            pushTickEvent(
              healthDeathsByTick,
              tick,
              {
                tick,
                entityIndex,
                className,
                team,
                previousHealth:
                  previous.health,
                currentHealth:
                  current.health
              }
            );
          }

          if (
            previous.lifeState !==
              null
            &&
            current.lifeState !==
              null
            &&
            !sameScalar(
              previous.lifeState,
              current.lifeState
            )
          ) {
            pushTickEvent(
              lifeTransitionsByTick,
              tick,
              {
                tick,
                entityIndex,
                className,
                team,
                from:
                  previous.lifeState,
                to:
                  current.lifeState
              }
            );
          }

          if (
            className ===
            'CItemXP'
          ) {
            const changes =
              [];

            for (
              const field
              of CITEMXP_FIELDS
            ) {
              const before =
                previous
                  .citemxpFields
                  ?.[field]
                ??
                null;

              const after =
                current
                  .citemxpFields
                  ?.[field]
                ??
                null;

              if (
                before !==
                  null
                &&
                after !==
                  null
                &&
                !sameScalar(
                  before,
                  after
                )
              ) {
                changes.push({
                  field,
                  from:
                    before,
                  to:
                    after
                });
              }
            }

            if (
              changes.length >
              0
            ) {
              pushTickEvent(
                citemxpFieldTransitionsByTick,
                tick,
                {
                  tick,
                  entityIndex,
                  changes
                }
              );
            }
          }
        }

        previousState.set(
          key,
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
    healthDeathsByTick,
    lifeTransitionsByTick,
    citemxpPacketsByTick,
    citemxpFieldTransitionsByTick,
    operationMetadataByTick
  };
}

function analyzeReplay({
  replayName,
  pass1,
  frozen,
  pass2
}) {
  const groups =
    {};

  for (
    const [
      groupName,
      points
    ]
    of Object.entries(
      frozen.groups
    )
  ) {
    groups[groupName] =
      analyzePointGroup({
        points,
        pass2
      });
  }

  const residualExamples =
    buildResidualExamples({
      points:
        frozen.groups.residual,
      pass2,
      limit:
        60
    });

  return {
    replayName,

    success:
      true,

    status:
      'RESIDUAL_SUBSTRATE_DIAGNOSTIC_COMPLETE',

    counts: {
      lastHitCredits:
        pass1.credits.length,

      exactMatchedCredits:
        frozen
          .groups
          .matched
          .length,

      residualCredits:
        frozen
          .groups
          .residual
          .length,

      exactCoverageRate:
        safeDiv(
          frozen
            .groups
            .matched
            .length,
          pass1.credits.length
        ),

      npcHealthDeaths:
        pass1.npcDeaths.length,

      placebo10Points:
        frozen
          .groups
          .placebo10
          .length,

      placebo30Points:
        frozen
          .groups
          .placebo30
          .length
    },

    placeboExclusions:
      frozen.placeboExclusions,

    groups,

    contrasts:
      buildContrasts(
        groups
      ),

    residualExamples,

    interpretationBoundary:
      'Presence/enrichment of a signal around residual credits is not a production rule. Any candidate mechanism requires dedicated validation and cross-replay replication.'
  };
}

function analyzePointGroup({
  points,
  pass2
}) {
  const windows =
    {};

  for (
    const window
    of WINDOWS
  ) {
    const rows =
      points.map(
        point =>
          characterizePoint({
            point,
            maxTicks:
              window,
            pass2
          })
      );

    windows[
      String(window)
    ] =
      summarizeCharacterizedPoints(
        rows
      );
  }

  return {
    pointCount:
      points.length,

    windows
  };
}

function characterizePoint({
  point,
  maxTicks,
  pass2
}) {
  const healthDeaths =
    collectEventsAroundTick(
      pass2.healthDeathsByTick,
      point.tick,
      maxTicks
    );

  const lifeTransitions =
    collectEventsAroundTick(
      pass2.lifeTransitionsByTick,
      point.tick,
      maxTicks
    );

  const citemxpPackets =
    collectEventsAroundTick(
      pass2.citemxpPacketsByTick,
      point.tick,
      maxTicks
    );

  const citemxpFieldTransitions =
    collectEventsAroundTick(
      pass2.citemxpFieldTransitionsByTick,
      point.tick,
      maxTicks
    );

  const operationMetadata =
    collectEventsAroundTick(
      pass2.operationMetadataByTick,
      point.tick,
      maxTicks
    );

  const cnpcHealthDeaths =
    healthDeaths.filter(
      row =>
        row.className.startsWith(
          'CNPC_'
        )
    );

  const nonCNPCHealthDeaths =
    healthDeaths.filter(
      row =>
        !row.className.startsWith(
          'CNPC_'
        )
    );

  const eligibleHealthDeaths =
    healthDeaths.filter(
      row =>
        isEligibleDeathForPlayer(
          row,
          point.playerTeam
        )
    );

  const eligibleNonCNPCHealthDeaths =
    nonCNPCHealthDeaths.filter(
      row =>
        isEligibleDeathForPlayer(
          row,
          point.playerTeam
        )
    );

  const citemxpChangedFields =
    citemxpFieldTransitions.flatMap(
      row =>
        row.changes.map(
          change => ({
            ...change,
            entityIndex:
              row.entityIndex,
            tick:
              row.tick
          })
        )
    );

  return {
    point,

    healthDeaths,

    cnpcHealthDeaths,

    nonCNPCHealthDeaths,

    eligibleHealthDeaths,

    eligibleNonCNPCHealthDeaths,

    lifeTransitions,

    citemxpPackets,

    citemxpFieldTransitions,

    citemxpChangedFields,

    operationMetadata
  };
}

function summarizeCharacterizedPoints(
  rows
) {
  const pointCount =
    rows.length;

  const countPoints =
    predicate =>
      rows.filter(
        predicate
      ).length;

  const withAnyHealthDeath =
    countPoints(
      row =>
        row.healthDeaths.length >
        0
    );

  const withCNPCHealthDeath =
    countPoints(
      row =>
        row.cnpcHealthDeaths.length >
        0
    );

  const withNonCNPCHealthDeath =
    countPoints(
      row =>
        row.nonCNPCHealthDeaths.length >
        0
    );

  const withEligibleHealthDeath =
    countPoints(
      row =>
        row.eligibleHealthDeaths.length >
        0
    );

  const withEligibleNonCNPCHealthDeath =
    countPoints(
      row =>
        row
          .eligibleNonCNPCHealthDeaths
          .length >
        0
    );

  const withLifeStateTransition =
    countPoints(
      row =>
        row.lifeTransitions.length >
        0
    );

  const withCItemXPPacket =
    countPoints(
      row =>
        row.citemxpPackets.length >
        0
    );

  const withCItemXPFieldTransition =
    countPoints(
      row =>
        row
          .citemxpFieldTransitions
          .length >
        0
    );

  const withVacuumTargetTransition =
    countPoints(
      row =>
        row
          .citemxpChangedFields
          .some(
            change =>
              change.field ===
              'm_hVacuumTarget'
          )
    );

  const healthClassCounts =
    countBy(
      rows.flatMap(
        row =>
          row.healthDeaths
      ),
      row =>
        row.className
    );

  const nonCNPCHealthClassCounts =
    countBy(
      rows.flatMap(
        row =>
          row
            .nonCNPCHealthDeaths
      ),
      row =>
        row.className
    );

  const lifeClassCounts =
    countBy(
      rows.flatMap(
        row =>
          row.lifeTransitions
      ),
      row =>
        row.className
    );

  const lifeTransitionSignatures =
    countBy(
      rows.flatMap(
        row =>
          row.lifeTransitions
      ),
      row =>
        `${row.className}|${String(row.from)}->${String(row.to)}`
    );

  const citemxpFieldCounts =
    countBy(
      rows.flatMap(
        row =>
          row.citemxpChangedFields
      ),
      row =>
        row.field
    );

  const operationMetadataCounts =
    countBy(
      rows.flatMap(
        row =>
          row.operationMetadata
      ),
      row =>
        row.signature
    );

  return {
    pointCount,

    withAnyHealthDeath,
    withAnyHealthDeathRate:
      safeDiv(
        withAnyHealthDeath,
        pointCount
      ),

    withCNPCHealthDeath,
    withCNPCHealthDeathRate:
      safeDiv(
        withCNPCHealthDeath,
        pointCount
      ),

    withNonCNPCHealthDeath,
    withNonCNPCHealthDeathRate:
      safeDiv(
        withNonCNPCHealthDeath,
        pointCount
      ),

    withEligibleHealthDeath,
    withEligibleHealthDeathRate:
      safeDiv(
        withEligibleHealthDeath,
        pointCount
      ),

    withEligibleNonCNPCHealthDeath,
    withEligibleNonCNPCHealthDeathRate:
      safeDiv(
        withEligibleNonCNPCHealthDeath,
        pointCount
      ),

    withLifeStateTransition,
    withLifeStateTransitionRate:
      safeDiv(
        withLifeStateTransition,
        pointCount
      ),

    withCItemXPPacket,
    withCItemXPPacketRate:
      safeDiv(
        withCItemXPPacket,
        pointCount
      ),

    withCItemXPFieldTransition,
    withCItemXPFieldTransitionRate:
      safeDiv(
        withCItemXPFieldTransition,
        pointCount
      ),

    withVacuumTargetTransition,
    withVacuumTargetTransitionRate:
      safeDiv(
        withVacuumTargetTransition,
        pointCount
      ),

    eventCounts: {
      healthDeaths:
        rows.reduce(
          (
            total,
            row
          ) =>
            total +
            row.healthDeaths.length,
          0
        ),

      lifeStateTransitions:
        rows.reduce(
          (
            total,
            row
          ) =>
            total +
            row.lifeTransitions.length,
          0
        ),

      citemxpPackets:
        rows.reduce(
          (
            total,
            row
          ) =>
            total +
            row.citemxpPackets.length,
          0
        ),

      citemxpFieldTransitions:
        rows.reduce(
          (
            total,
            row
          ) =>
            total +
            row
              .citemxpFieldTransitions
              .length,
          0
        )
    },

    healthClassCounts:
      sortDescending(
        healthClassCounts
      ),

    nonCNPCHealthClassCounts:
      sortDescending(
        nonCNPCHealthClassCounts
      ),

    lifeClassCounts:
      sortDescending(
        lifeClassCounts
      ),

    lifeTransitionSignatures:
      sortDescending(
        lifeTransitionSignatures
      ),

    citemxpFieldCounts:
      sortDescending(
        citemxpFieldCounts
      ),

    operationMetadataCounts:
      sortDescending(
        operationMetadataCounts
      )
  };
}

function buildContrasts(
  groups
) {
  const contrasts =
    {};

  for (
    const window
    of WINDOWS
  ) {
    const key =
      String(
        window
      );

    const matched =
      groups
        .matched
        .windows
        [key];

    const residual =
      groups
        .residual
        .windows
        [key];

    const placebo10 =
      groups
        .placebo10
        .windows
        [key];

    const placebo30 =
      groups
        .placebo30
        .windows
        [key];

    contrasts[key] = {
      residualVsPlacebo10: {
        anyHealthDeathRateDifference:
          difference(
            residual.withAnyHealthDeathRate,
            placebo10.withAnyHealthDeathRate
          ),

        nonCNPCHealthDeathRateDifference:
          difference(
            residual.withNonCNPCHealthDeathRate,
            placebo10.withNonCNPCHealthDeathRate
          ),

        lifeStateTransitionRateDifference:
          difference(
            residual.withLifeStateTransitionRate,
            placebo10.withLifeStateTransitionRate
          ),

        citemxpPacketRateDifference:
          difference(
            residual.withCItemXPPacketRate,
            placebo10.withCItemXPPacketRate
          ),

        citemxpFieldTransitionRateDifference:
          difference(
            residual.withCItemXPFieldTransitionRate,
            placebo10.withCItemXPFieldTransitionRate
          ),

        vacuumTargetTransitionRateDifference:
          difference(
            residual.withVacuumTargetTransitionRate,
            placebo10.withVacuumTargetTransitionRate
          )
      },

      residualVsPlacebo30: {
        anyHealthDeathRateDifference:
          difference(
            residual.withAnyHealthDeathRate,
            placebo30.withAnyHealthDeathRate
          ),

        nonCNPCHealthDeathRateDifference:
          difference(
            residual.withNonCNPCHealthDeathRate,
            placebo30.withNonCNPCHealthDeathRate
          ),

        lifeStateTransitionRateDifference:
          difference(
            residual.withLifeStateTransitionRate,
            placebo30.withLifeStateTransitionRate
          ),

        citemxpPacketRateDifference:
          difference(
            residual.withCItemXPPacketRate,
            placebo30.withCItemXPPacketRate
          )
      },

      residualVsMatched: {
        anyHealthDeathRateDifference:
          difference(
            residual.withAnyHealthDeathRate,
            matched.withAnyHealthDeathRate
          ),

        lifeStateTransitionRateDifference:
          difference(
            residual.withLifeStateTransitionRate,
            matched.withLifeStateTransitionRate
          ),

        citemxpPacketRateDifference:
          difference(
            residual.withCItemXPPacketRate,
            matched.withCItemXPPacketRate
          )
      }
    };
  }

  return contrasts;
}

function buildResidualExamples({
  points,
  pass2,
  limit
}) {
  return points
    .slice(
      0,
      limit
    )
    .map(
      point => {
        const row =
          characterizePoint({
            point,
            maxTicks:
              8,
            pass2
          });

        return {
          tick:
            point.tick,

          playerName:
            point.playerName,

          playerTeam:
            point.playerTeam,

          healthDeaths:
            row.healthDeaths.slice(
              0,
              20
            ),

          lifeTransitions:
            row.lifeTransitions.slice(
              0,
              20
            ),

          citemxpPackets:
            row.citemxpPackets.slice(
              0,
              20
            ),

          citemxpFieldTransitions:
            row
              .citemxpFieldTransitions
              .slice(
                0,
                20
              ),

          operationMetadata:
            row.operationMetadata.slice(
              0,
              20
            )
        };
      }
    );
}

function aggregateReplayResults(
  replayResults
) {
  const counts = {
    lastHitCredits:
      0,

    exactMatchedCredits:
      0,

    residualCredits:
      0,

    placebo10Points:
      0,

    placebo30Points:
      0
  };

  for (const row of replayResults) {
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

  const groups =
    {};

  for (
    const groupName
    of [
      'matched',
      'residual',
      'placebo10',
      'placebo30'
    ]
  ) {
    groups[groupName] = {
      pointCount:
        replayResults.reduce(
          (
            total,
            row
          ) =>
            total +
            (
              row
                .groups
                ?.[groupName]
                ?.pointCount
              ??
              0
            ),
          0
        ),

      windows:
        {}
    };

    for (
      const window
      of WINDOWS
    ) {
      const key =
        String(
          window
        );

      groups[
        groupName
      ].windows[key] =
        aggregateWindowSummaries(
          replayResults.map(
            row =>
              row
                .groups
                ?.[groupName]
                ?.windows
                ?.[key]
          ).filter(Boolean)
        );
    }
  }

  return {
    counts: {
      ...counts,

      exactCoverageRate:
        safeDiv(
          counts.exactMatchedCredits,
          counts.lastHitCredits
        )
    },

    groups,

    contrasts:
      buildContrasts(
        groups
      ),

    replayLevelResidualExactRates: {
      anyHealthDeath:
        summarizeNumbers(
          replayResults.map(
            row =>
              row
                .groups
                .residual
                .windows
                ['0']
                .withAnyHealthDeathRate
          )
        ),

      nonCNPCHealthDeath:
        summarizeNumbers(
          replayResults.map(
            row =>
              row
                .groups
                .residual
                .windows
                ['0']
                .withNonCNPCHealthDeathRate
          )
        ),

      lifeStateTransition:
        summarizeNumbers(
          replayResults.map(
            row =>
              row
                .groups
                .residual
                .windows
                ['0']
                .withLifeStateTransitionRate
          )
        ),

      citemxpPacket:
        summarizeNumbers(
          replayResults.map(
            row =>
              row
                .groups
                .residual
                .windows
                ['0']
                .withCItemXPPacketRate
          )
        )
    }
  };
}

function aggregateWindowSummaries(
  summaries
) {
  const pointCount =
    summaries.reduce(
      (
        total,
        row
      ) =>
        total +
        row.pointCount,
      0
    );

  const countFields = [
    'withAnyHealthDeath',
    'withCNPCHealthDeath',
    'withNonCNPCHealthDeath',
    'withEligibleHealthDeath',
    'withEligibleNonCNPCHealthDeath',
    'withLifeStateTransition',
    'withCItemXPPacket',
    'withCItemXPFieldTransition',
    'withVacuumTargetTransition'
  ];

  const result = {
    pointCount
  };

  for (
    const field
    of countFields
  ) {
    const count =
      summaries.reduce(
        (
          total,
          row
        ) =>
          total +
          (
            row[field]
            ??
            0
          ),
        0
      );

    result[field] =
      count;

    result[
      `${field}Rate`
    ] =
      safeDiv(
        count,
        pointCount
      );
  }

  result.eventCounts = {
    healthDeaths:
      sumNested(
        summaries,
        'eventCounts',
        'healthDeaths'
      ),

    lifeStateTransitions:
      sumNested(
        summaries,
        'eventCounts',
        'lifeStateTransitions'
      ),

    citemxpPackets:
      sumNested(
        summaries,
        'eventCounts',
        'citemxpPackets'
      ),

    citemxpFieldTransitions:
      sumNested(
        summaries,
        'eventCounts',
        'citemxpFieldTransitions'
      )
  };

  result.healthClassCounts =
    mergeCountObjects(
      summaries.map(
        row =>
          row.healthClassCounts
      )
    );

  result.nonCNPCHealthClassCounts =
    mergeCountObjects(
      summaries.map(
        row =>
          row.nonCNPCHealthClassCounts
      )
    );

  result.lifeClassCounts =
    mergeCountObjects(
      summaries.map(
        row =>
          row.lifeClassCounts
      )
    );

  result.lifeTransitionSignatures =
    mergeCountObjects(
      summaries.map(
        row =>
          row.lifeTransitionSignatures
      )
    );

  result.citemxpFieldCounts =
    mergeCountObjects(
      summaries.map(
        row =>
          row.citemxpFieldCounts
      )
    );

  result.operationMetadataCounts =
    mergeCountObjects(
      summaries.map(
        row =>
          row.operationMetadataCounts
      )
    );

  return result;
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

function expandCreditSlots(
  transitions
) {
  const result =
    [];

  for (
    const transition
    of transitions
  ) {
    const count =
      Math.max(
        0,
        Math.trunc(
          transition.delta
        )
      );

    for (
      let ordinal =
        0;
      ordinal <
        count;
      ordinal++
    ) {
      result.push({
        id:
          `lastHit|${transition.controllerEntityIndex}|${transition.tick}|${ordinal}`,

        tick:
          transition.tick,

        controllerEntityIndex:
          transition.controllerEntityIndex,

        playerName:
          transition.playerName,

        team:
          transition.team,

        transitionDelta:
          transition.delta,

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

function collectEventsAroundTick(
  map,
  tick,
  radius
) {
  const result =
    [];

  for (
    let offset =
      -radius;
    offset <=
      radius;
    offset++
  ) {
    const rows =
      map.get(
        tick +
        offset
      );

    if (
      Array.isArray(
        rows
      )
    ) {
      result.push(
        ...rows
      );
    }
  }

  return result;
}

function pushTickEvent(
  map,
  tick,
  row
) {
  let list =
    map.get(
      tick
    );

  if (!list) {
    list =
      [];

    map.set(
      tick,
      list
    );
  }

  list.push(
    row
  );
}

function extractOperationMetadata(
  event
) {
  const entries =
    [];

  for (
    const key
    of [
      'type',
      'eventType',
      'kind',
      'operation',
      'op'
    ]
  ) {
    const value =
      scalarOrNull(
        event?.[key]
      );

    if (
      value !==
      null
    ) {
      entries.push(
        [
          key,
          value
        ]
      );
    }
  }

  if (
    entries.length ===
    0
  ) {
    return null;
  }

  return {
    signature:
      entries
        .map(
          (
            [
              key,
              value
            ]
          ) =>
            `${key}=${String(value)}`
        )
        .join('|')
  };
}

function writeReplayOutput(
  replayName,
  result
) {
  const outputPath =
    resolve(
      'output',
      replayName,
      'player_last_hit_residual_substrate_diagnostics_v01.json'
    );

  mkdirSync(
    dirname(
      outputPath
    ),
    {
      recursive:
        true
    }
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
  console.log('');
  console.log('========================================================');
  console.log('BATCH RESIDUAL SUBSTRATE DIAGNOSTICS');
  console.log('========================================================');
  console.log(
    `Successful replays: ${batch.successCount}/${batch.replayCount}`
  );

  console.log(
    `Last-hit credits: ${batch.aggregate.counts.lastHitCredits}`
  );

  console.log(
    `Exact matched:    ${batch.aggregate.counts.exactMatchedCredits} (${pct(batch.aggregate.counts.exactCoverageRate)})`
  );

  console.log(
    `Exact residual:   ${batch.aggregate.counts.residualCredits}`
  );

  console.log('');

  for (
    const window
    of WINDOWS
  ) {
    const key =
      String(
        window
      );

    const label =
      window ===
        0
        ? 'exact'
        : `±${window} ticks`;

    const residual =
      batch
        .aggregate
        .groups
        .residual
        .windows
        [key];

    const placebo10 =
      batch
        .aggregate
        .groups
        .placebo10
        .windows
        [key];

    const placebo30 =
      batch
        .aggregate
        .groups
        .placebo30
        .windows
        [key];

    console.log(
      `${label}:`
    );

    console.log(
      `  residual any-health     ${pct(residual.withAnyHealthDeathRate)} | p10 ${pct(placebo10.withAnyHealthDeathRate)} | p30 ${pct(placebo30.withAnyHealthDeathRate)}`
    );

    console.log(
      `  residual non-CNPC death ${pct(residual.withNonCNPCHealthDeathRate)} | p10 ${pct(placebo10.withNonCNPCHealthDeathRate)} | p30 ${pct(placebo30.withNonCNPCHealthDeathRate)}`
    );

    console.log(
      `  residual life-state     ${pct(residual.withLifeStateTransitionRate)} | p10 ${pct(placebo10.withLifeStateTransitionRate)} | p30 ${pct(placebo30.withLifeStateTransitionRate)}`
    );

    console.log(
      `  residual CItemXP packet ${pct(residual.withCItemXPPacketRate)} | p10 ${pct(placebo10.withCItemXPPacketRate)} | p30 ${pct(placebo30.withCItemXPPacketRate)}`
    );

    console.log('');
  }

  console.log(
    'Top exact-tick residual non-CNPC health-death classes:'
  );

  const nonCNPC =
    Object.entries(
      batch
        .aggregate
        .groups
        .residual
        .windows
        ['0']
        .nonCNPCHealthClassCounts
      ??
      {}
    )
      .slice(
        0,
        15
      );

  if (
    nonCNPC.length ===
    0
  ) {
    console.log(
      '  (none)'
    );
  } else {
    for (
      const [
        className,
        count
      ]
      of nonCNPC
    ) {
      console.log(
        `  ${className.padEnd(40)} ${count}`
      );
    }
  }

  console.log('');

  console.log(
    'Top exact-tick residual life-state signatures:'
  );

  const life =
    Object.entries(
      batch
        .aggregate
        .groups
        .residual
        .windows
        ['0']
        .lifeTransitionSignatures
      ??
      {}
    )
      .slice(
        0,
        15
      );

  if (
    life.length ===
    0
  ) {
    console.log(
      '  (none)'
    );
  } else {
    for (
      const [
        signature,
        count
      ]
      of life
    ) {
      console.log(
        `  ${signature.padEnd(58)} ${count}`
      );
    }
  }

  console.log('');

  console.log(
    'CItemXP exact residual field transitions:'
  );

  const xpFields =
    Object.entries(
      batch
        .aggregate
        .groups
        .residual
        .windows
        ['0']
        .citemxpFieldCounts
      ??
      {}
    );

  if (
    xpFields.length ===
    0
  ) {
    console.log(
      '  (none)'
    );
  } else {
    for (
      const [
        field,
        count
      ]
      of xpFields
    ) {
      console.log(
        `  ${field.padEnd(32)} ${count}`
      );
    }
  }

  console.log('');

  console.log(
    `Output: ${batchOutputPath}`
  );

  console.log('');

  console.log(
    'IMPORTANT: discovery diagnostic only; no last-hit semantic promotion.'
  );

  console.log('');
}

function countBy(
  rows,
  keyFn
) {
  const result =
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

function mergeCountObjects(
  objects
) {
  const merged =
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

function sumNested(
  rows,
  outer,
  inner
) {
  return rows.reduce(
    (
      total,
      row
    ) =>
      total +
      (
        row
          ?.[outer]
          ?.[inner]
        ??
        0
      ),
    0
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
      n:
        0,
      min:
        null,
      median:
        null,
      mean:
        null,
      max:
        null
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
    sorted[lower] *
      (
        1 -
        fraction
      )
    +
    sorted[upper] *
      fraction
  );
}

function difference(
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
  )
    ? a -
      b
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

function scalarOrNull(
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
      'number'
    ||
    typeof value ===
      'string'
    ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  try {
    return String(
      value
    );
  } catch {
    return null;
  }
}

function stringOrNull(
  value
) {
  const scalar =
    scalarOrNull(
      value
    );

  if (
    scalar ===
      null
  ) {
    return null;
  }

  const text =
    String(
      scalar
    ).trim();

  return text
    ? text
    : null;
}

function sameScalar(
  a,
  b
) {
  return (
    typeof a ===
      typeof b
    &&
    a ===
      b
  )
  ||
  String(
    a
  ) ===
  String(
    b
  );
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
