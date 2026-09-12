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

// ============================================================
// SCRIPT 224
// SCOREBOARD SAMPLED COUNTER-TIMELINE CONTRACT V0.1
//
// Authoritative timeline construct:
//
// For kills, assists, last hits, and denies, an event is the
// FIRST OBSERVED PlayerState sample where the validated controller
// counter is greater than its previous observed sample.
//
// Event shape:
//   metric
//   observedSampleTick
//   observedMatchTime
//   previous
//   current
//   delta
//
// IMPORTANT:
// - This is sampled observation timing, not the hidden exact
//   server award tick.
// - player_state.jsonl is the source stream; the production
//   inspector must not derive these events from its thinned ~1 Hz
//   display timeline.
// - A delta > 1 is one observed counter transition with a multi-unit
//   delta, not invented individual award timestamps.
//
// Validation:
// - first observed counters are zero
// - no negative transitions
// - positive deltas reconcile exactly to final counters
// - every event has finite tick/time and positive integer delta
// - replicated across test + rep01-rep05
// ============================================================

const METRICS = [
  {
    id: 'kills',
    field: 'kills'
  },
  {
    id: 'assists',
    field: 'assists'
  },
  {
    id: 'last_hits',
    field: 'lastHits'
  },
  {
    id: 'denies',
    field: 'denies'
  }
];

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

const outputPath =
  resolve(
    'output',
    'cross_replay',
    'scoreboard_sampled_counter_timeline_contract_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('SCOREBOARD SAMPLED COUNTER-TIMELINE CONTRACT V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const replayResults = [];

for (const replayName of replayNames) {
  const path =
    resolve(
      'output',
      replayName,
      'player_state.jsonl'
    );

  if (!existsSync(path)) {
    replayResults.push({
      replayName,
      success: false,
      status: 'PLAYER_STATE_MISSING',
      path
    });

    console.log(
      `${replayName.padEnd(10)} player_state.jsonl missing`
    );

    continue;
  }

  try {
    const result =
      await analyzeReplay(
        replayName,
        path
      );

    replayResults.push(result);

    const units =
      METRICS.map(
        metric =>
          `${metric.id}=${result.metrics[metric.id].positiveUnits}`
      ).join(' ');

    console.log(
      `${replayName.padEnd(10)} players=${String(result.playerCount).padStart(2)} ` +
      `${units} ` +
      `neg=${result.totalNegativeTransitions} invalid=${result.totalInvalidEvents}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success: false,
      status: 'ANALYSIS_EXCEPTION',
      error:
        error?.stack
        ??
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
  aggregateResults(
    successful
  );

const gates = {
  allRequestedReplaysSucceeded:
    successful.length ===
      replayNames.length,

  allPlayersBeginAtZero:
    aggregate.firstObservedNonzeroValues ===
      0,

  noNegativeCounterTransitions:
    aggregate.totalNegativeTransitions ===
      0,

  noInvalidEvents:
    aggregate.totalInvalidEvents ===
      0,

  noPositiveTransitionsBeforeMatchStart:
    aggregate.positiveTransitionsBeforeMatchStart ===
      0,

  allMetricDeltasReconcile:
    METRICS.every(
      metric => {
        const row =
          aggregate.metrics[metric.id];

        return (
          row.positiveUnits ===
            row.finalCounterTotal
          &&
          row.reconciliationDifference ===
            0
        );
      }
    ),

  everyReplayReconciles:
    successful.every(
      replay =>
        METRICS.every(
          metric =>
            replay
              .metrics
              [metric.id]
              .reconciliationDifference ===
              0
        )
    )
};

const timelineValidationPass =
  Object.values(
    gates
  ).every(Boolean);

const output = {
  version:
    'SCOREBOARD_SAMPLED_COUNTER_TIMELINE_CONTRACT_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  construct:
    'first observed PlayerState sample where an authoritative scoreboard counter increases',

  counters: [
    'kills',
    'assists',
    'last_hits',
    'denies'
  ],

  eventSchema: {
    metric:
      'counter identity',

    observedSampleTick:
      'demo tick of first observed sampled increased state',

    observedMatchTime:
      'match time of first observed sampled increased state',

    previous:
      'previous observed counter value',

    current:
      'current observed counter value',

    delta:
      'current - previous; positive integer'
  },

  timingSemantics: {
    source:
      'player_state.jsonl',

    observedSampling:
      'PlayerState source sampling, nominally 4 Hz in the current pipeline',

    exactServerAwardTick:
      false,

    rule:
      'Timestamp the first observed sample carrying the increased counter value. Never backdate or interpolate to an unobserved hidden award tick.',

    multiUnitDelta:
      'Preserve a delta greater than one as one sampled transition. Do not invent separate timestamps for individual credit units.'
  },

  aggregate,

  gates,

  timelineValidationPass,

  recommendedStatusIfPass: {
    integrityValidation:
      'pass',

    semanticValidation:
      'pass',

    replicationStatus:
      'cross_replay_replicated'
  },

  authorityBoundary: {
    establishedIfPromoted:
      'scoreboard_timelines is an observed-sample timeline of positive transitions in authoritative kill, assist, last-hit, and deny counters.',

    explicitlyNotEstablished: [
      'the hidden exact server award tick',
      'a causal event source for each credit',
      'individual timestamps for multiple credits serialized into one sampled delta',
      'death-counter timeline semantics',
      'rolling performance rates',
      'attempt timing for kills, assists, last hits, or denies'
    ]
  },

  replays:
    replayResults
};

mkdirSync(
  dirname(outputPath),
  {
    recursive: true
  }
);

writeFileSync(
  outputPath,
  JSON.stringify(
    output,
    null,
    2
  ),
  'utf8'
);

printSummary(
  output
);

// ------------------------------------------------------------
// Replay analysis
// ------------------------------------------------------------

async function analyzeReplay(
  replayName,
  path
) {
  const players =
    new Map();

  const rl =
    createInterface({
      input:
        createReadStream(
          path,
          {
            encoding:
              'utf8'
          }
        ),

      crlfDelay:
        Infinity
    });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let row;

    try {
      row =
        JSON.parse(
          line
        );
    } catch {
      continue;
    }

    const c =
      row?.controller;

    if (
      !c
      ||
      typeof c !==
        'object'
    ) {
      continue;
    }

    const playerName =
      text(
        c.playerName
      );

    if (
      !playerName
      ||
      playerName ===
        'SourceTV'
    ) {
      continue;
    }

    const tick =
      finite(
        row.demoTick
        ??
        row.tick
      );

    const matchTime =
      finite(
        row.matchTimeSeconds
      );

    if (
      tick === null
      ||
      matchTime === null
    ) {
      continue;
    }

    const state = {
      tick,
      matchTime
    };

    let allCountersValid =
      true;

    for (const metric of METRICS) {
      const value =
        finite(
          c[metric.field]
        );

      state[metric.field] =
        value;

      if (
        !isNonnegativeInteger(
          value
        )
      ) {
        allCountersValid =
          false;
      }
    }

    if (!allCountersValid) {
      continue;
    }

    let p =
      players.get(
        playerName
      );

    if (!p) {
      p = {
        playerName,

        first:
          state,

        previous:
          null,

        final:
          state,

        events:
          Object.fromEntries(
            METRICS.map(
              metric => [
                metric.id,
                []
              ]
            )
          ),

        negativeTransitions:
          Object.fromEntries(
            METRICS.map(
              metric => [
                metric.id,
                0
              ]
            )
          )
      };

      players.set(
        playerName,
        p
      );
    }

    if (p.previous) {
      for (const metric of METRICS) {
        const previous =
          p.previous[
            metric.field
          ];

        const current =
          state[
            metric.field
          ];

        const delta =
          current -
          previous;

        if (delta < 0) {
          p.negativeTransitions[
            metric.id
          ]++;
        }

        if (delta > 0) {
          p.events[
            metric.id
          ].push({
            metric:
              metric.id,

            observedSampleTick:
              tick,

            observedMatchTime:
              matchTime,

            previous,

            current,

            delta
          });
        }
      }
    }

    p.previous =
      state;

    p.final =
      state;
  }

  const metrics =
    {};

  let firstObservedNonzeroValues =
    0;

  let totalNegativeTransitions =
    0;

  let totalInvalidEvents =
    0;

  let positiveTransitionsBeforeMatchStart =
    0;

  for (const metric of METRICS) {
    let positiveTransitionEvents =
      0;

    let positiveUnits =
      0;

    let finalCounterTotal =
      0;

    let firstNonzero =
      0;

    let negativeTransitions =
      0;

    let invalidEvents =
      0;

    let beforeStart =
      0;

    let multiUnitTransitions =
      0;

    for (const p of players.values()) {
      if (
        p.first[
          metric.field
        ] !==
        0
      ) {
        firstNonzero++;
      }

      finalCounterTotal +=
        p.final[
          metric.field
        ];

      negativeTransitions +=
        p.negativeTransitions[
          metric.id
        ];

      for (
        const event
        of p.events[
          metric.id
        ]
      ) {
        positiveTransitionEvents++;

        positiveUnits +=
          event.delta;

        if (
          event.delta >
          1
        ) {
          multiUnitTransitions++;
        }

        if (
          event.observedMatchTime <
          0
        ) {
          beforeStart++;
        }

        if (
          !Number.isFinite(
            event.observedSampleTick
          )
          ||
          !Number.isFinite(
            event.observedMatchTime
          )
          ||
          !Number.isInteger(
            event.delta
          )
          ||
          event.delta <=
            0
          ||
          event.current -
            event.previous !==
            event.delta
        ) {
          invalidEvents++;
        }
      }
    }

    metrics[
      metric.id
    ] = {
      firstObservedNonzeroValues:
        firstNonzero,

      positiveTransitionEvents,

      positiveUnits,

      finalCounterTotal,

      reconciliationDifference:
        positiveUnits -
        finalCounterTotal,

      negativeTransitions,

      invalidEvents,

      positiveTransitionsBeforeMatchStart:
        beforeStart,

      multiUnitTransitions
    };

    firstObservedNonzeroValues +=
      firstNonzero;

    totalNegativeTransitions +=
      negativeTransitions;

    totalInvalidEvents +=
      invalidEvents;

    positiveTransitionsBeforeMatchStart +=
      beforeStart;
  }

  return {
    replayName,

    success:
      true,

    playerCount:
      players.size,

    firstObservedNonzeroValues,

    totalNegativeTransitions,

    totalInvalidEvents,

    positiveTransitionsBeforeMatchStart,

    metrics
  };
}

function aggregateResults(
  rows
) {
  const metrics =
    Object.fromEntries(
      METRICS.map(
        metric => [
          metric.id,
          {
            firstObservedNonzeroValues:
              0,

            positiveTransitionEvents:
              0,

            positiveUnits:
              0,

            finalCounterTotal:
              0,

            reconciliationDifference:
              0,

            negativeTransitions:
              0,

            invalidEvents:
              0,

            positiveTransitionsBeforeMatchStart:
              0,

            multiUnitTransitions:
              0
          }
        ]
      )
    );

  let playerReplayScoreboards =
    0;

  let firstObservedNonzeroValues =
    0;

  let totalNegativeTransitions =
    0;

  let totalInvalidEvents =
    0;

  let positiveTransitionsBeforeMatchStart =
    0;

  for (const row of rows) {
    playerReplayScoreboards +=
      row.playerCount;

    firstObservedNonzeroValues +=
      row.firstObservedNonzeroValues;

    totalNegativeTransitions +=
      row.totalNegativeTransitions;

    totalInvalidEvents +=
      row.totalInvalidEvents;

    positiveTransitionsBeforeMatchStart +=
      row.positiveTransitionsBeforeMatchStart;

    for (const metric of METRICS) {
      const target =
        metrics[
          metric.id
        ];

      const source =
        row
          .metrics
          [metric.id];

      for (
        const key
        of Object.keys(
          target
        )
      ) {
        target[key] +=
          source[key]
          ??
          0;
      }
    }
  }

  // Recompute rather than sum replay-level differences.
  for (const metric of METRICS) {
    const row =
      metrics[
        metric.id
      ];

    row.reconciliationDifference =
      row.positiveUnits -
      row.finalCounterTotal;
  }

  return {
    successfulReplays:
      rows.length,

    playerReplayScoreboards,

    firstObservedNonzeroValues,

    totalNegativeTransitions,

    totalInvalidEvents,

    positiveTransitionsBeforeMatchStart,

    metrics
  };
}

// ------------------------------------------------------------
// Reporting
// ------------------------------------------------------------

function printSummary(
  output
) {
  const a =
    output.aggregate;

  console.log('');
  console.log('========================================================');
  console.log('CROSS-REPLAY TIMELINE RECONCILIATION');
  console.log('========================================================');
  console.log(
    `Successful replays: ${a.successfulReplays}/${output.replays.length}`
  );
  console.log(
    `Player-replay scoreboards: ${a.playerReplayScoreboards}`
  );
  console.log(
    `First-observed nonzero counter values: ${a.firstObservedNonzeroValues}`
  );
  console.log(
    `Negative counter transitions: ${a.totalNegativeTransitions}`
  );
  console.log(
    `Invalid timeline events: ${a.totalInvalidEvents}`
  );
  console.log(
    `Positive transitions before match start: ${a.positiveTransitionsBeforeMatchStart}`
  );
  console.log('');

  for (const metric of METRICS) {
    const row =
      a
        .metrics
        [metric.id];

    console.log(
      `${metric.id.padEnd(12)} ` +
      `events=${String(row.positiveTransitionEvents).padStart(5)} ` +
      `units=${String(row.positiveUnits).padStart(6)} ` +
      `final=${String(row.finalCounterTotal).padStart(6)} ` +
      `diff=${String(row.reconciliationDifference).padStart(3)} ` +
      `multiDelta=${row.multiUnitTransitions}`
    );
  }

  console.log('');
  console.log(
    `TIMELINE VALIDATION: ${output.timelineValidationPass ? 'PASS' : 'DO NOT PROMOTE'}`
  );
  console.log('');
  console.log(
    'SEMANTIC BOUNDARY: event time = first observed PlayerState sample with increased counter; NOT hidden exact award tick.'
  );
  console.log('');
  console.log(
    `Output: ${outputPath}`
  );
  console.log('');
}

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------

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

function isNonnegativeInteger(
  value
) {
  return (
    Number.isFinite(
      value
    )
    &&
    Number.isInteger(
      value
    )
    &&
    value >=
      0
  );
}

function text(
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

  const result =
    String(
      value
    ).trim();

  return result
    ? result
    : null;
}
