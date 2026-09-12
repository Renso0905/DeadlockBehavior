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
// SCRIPT 220
// SCOREBOARD DEATH-CREDIT SEMANTIC CLOSURE V0.1
//
// Narrow construct:
//   CCitadelPlayerController.m_iDeaths
//     = game-awarded per-player scored-death counter.
//
// Independent semantic carrier used here:
//   CCitadelPlayerController.m_bAlive true -> false transitions
//   from the sampled player-state stream.
//
// Important distinction:
//   m_iDeaths is NOT equated with every observed alive->dead
//   episode. Extra alive->dead episodes remain visible and are
//   characterized separately.
//
// Controls:
//   +10 s and +30 s shifted death-credit ticks.
//
// Research-only. No claim/contract modification.
// ============================================================

const TICK_RATE = 64;
const MATCH_WINDOW_TICKS = 16; // one 4-Hz player-state sample
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
    'player_scoreboard_death_semantic_closure_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('SCOREBOARD DEATH-CREDIT SEMANTIC CLOSURE V0.1');
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
    const collected =
      await collectReplay(path);

    const result =
      analyzeReplay(
        replayName,
        collected
      );

    replayResults.push(result);

    console.log(
      `${replayName.padEnd(10)} ` +
      `credits=${String(result.counts.deathCredits).padStart(3)} ` +
      `aliveDead=${String(result.counts.aliveToDeadTransitions).padStart(3)} ` +
      `match=${pct(result.semantic.creditToAliveDeathAgreementRate).padStart(7)} ` +
      `p10=${pct(result.controls.placebo10Rate).padStart(7)} ` +
      `p30=${pct(result.controls.placebo30Rate).padStart(7)} ` +
      `extra=${String(result.counts.unmatchedAliveToDead).padStart(2)}`
    );
  } catch (error) {
    replayResults.push({
      replayName,
      success: false,
      status: 'ANALYSIS_EXCEPTION',
      error: error?.stack ?? String(error)
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
  aggregateResults(successful);

const thresholds = {
  allRequestedReplaysSucceeded:
    successful.length === replayNames.length,

  counterIntegrityPass:
    aggregate.integrity.nonNumericValues === 0
    &&
    aggregate.integrity.nonIntegerValues === 0
    &&
    aggregate.integrity.negativeValues === 0
    &&
    aggregate.integrity.negativeTransitions === 0
    &&
    aggregate.integrity.playersStartingNonzero === 0
    &&
    aggregate.integrity.finalCounterTotal ===
      aggregate.counts.deathCredits,

  allCreditsMatchAliveToDead:
    aggregate.semantic.creditToAliveDeathAgreementRate === 1,

  everyReplayAllCreditsMatch:
    successful.every(
      row =>
        row.semantic.creditToAliveDeathAgreementRate === 1
    ),

  placebo10AtMostOnePercent:
    (
      aggregate.controls.placebo10Rate
      ??
      1
    ) <= 0.01,

  placebo30AtMostOnePercent:
    (
      aggregate.controls.placebo30Rate
      ??
      1
    ) <= 0.01,

  extraAliveToDeadEpisodesRemainDistinct:
    aggregate.counts.unmatchedAliveToDead > 0
};

const semanticClosurePass =
  Object.values(thresholds)
    .every(Boolean);

const output = {
  version:
    'PLAYER_SCOREBOARD_DEATH_SEMANTIC_CLOSURE_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  field:
    'CCitadelPlayerController.m_iDeaths',

  construct:
    'game-awarded per-player scored-death counter',

  design: {
    playerStateSampleRateHz: 4,
    tickRate: TICK_RATE,
    matchWindowTicks: MATCH_WINDOW_TICKS,
    matchWindowSeconds:
      MATCH_WINDOW_TICKS / TICK_RATE,
    positiveControl:
      'Observed m_bAlive true -> false transition for the same player.',
    placebo10:
      'Death-credit tick shifted +10 seconds, then matched to same-player alive->dead transitions.',
    placebo30:
      'Death-credit tick shifted +30 seconds, then matched to same-player alive->dead transitions.'
  },

  aggregate,

  thresholds,

  semanticClosurePass,

  recommendedValidationIfPromoted: {
    integrityValidation:
      semanticClosurePass
        ? 'pass'
        : 'pass',

    semanticValidation:
      semanticClosurePass
        ? 'pass'
        : 'provisional',

    replicationStatus:
      semanticClosurePass
        ? 'cross_replay_replicated'
        : 'multi_replay_supported'
  },

  authorityBoundary: {
    establishedIfPass:
      'm_iDeaths is the game-awarded per-player scored-death counter.',

    explicitlyNotEstablished: [
      'that every observed alive->dead episode increments the scoreboard counter',
      'killer identity or kill attribution',
      'damage source or lethal ability attribution',
      'death cause',
      'revive mechanics',
      'whether any particular unmatched short dead episode should be called a scored death'
    ],

    requiredDistinction:
      'death_count remains observed alive->dead state transitions; deaths_scoreboard is the game-awarded m_iDeaths counter. They must remain separate metrics.'
  },

  replays:
    replayResults
};

mkdirSync(
  dirname(batchPath),
  { recursive: true }
);

writeFileSync(
  batchPath,
  JSON.stringify(
    output,
    null,
    2
  ),
  'utf8'
);

printBatch(output);

async function collectReplay(path) {
  const players =
    new Map();

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
      row = JSON.parse(line);
    } catch {
      continue;
    }

    const c =
      row?.controller;

    if (!c || typeof c !== 'object') {
      continue;
    }

    const playerName =
      stringOrNull(c.playerName);

    if (
      !playerName ||
      playerName === 'SourceTV'
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

    if (tick === null) {
      continue;
    }

    let p =
      players.get(playerName);

    if (!p) {
      p = {
        playerName,
        values: [],
        prev: null,
        firstDeaths: null,
        finalDeaths: null,
        deathCreditTransitions: [],
        aliveToDead: [],
        deadToAlive: [],
        openDeadStart: null
      };

      players.set(
        playerName,
        p
      );
    }

    const deaths =
      finite(c.deaths);

    const alive =
      booleanOrNull(c.alive);

    const current = {
      tick,
      matchTime,
      deaths,
      alive
    };

    if (deaths !== null) {
      p.values.push(deaths);

      if (p.firstDeaths === null) {
        p.firstDeaths = deaths;
      }

      p.finalDeaths = deaths;
    }

    if (p.prev) {
      if (
        p.prev.deaths !== null
        &&
        deaths !== null
        &&
        deaths !== p.prev.deaths
      ) {
        p.deathCreditTransitions.push({
          tick,
          matchTime,
          previous:
            p.prev.deaths,
          current:
            deaths,
          delta:
            deaths - p.prev.deaths
        });
      }

      if (
        p.prev.alive === true
        &&
        alive === false
      ) {
        const transition = {
          id:
            `aliveDead|${playerName}|${tick}`,
          tick,
          matchTime,
          playerName,
          episodeDurationSeconds:
            null,
          censored:
            true
        };

        p.aliveToDead.push(
          transition
        );

        p.openDeadStart =
          transition;
      }

      if (
        p.prev.alive === false
        &&
        alive === true
      ) {
        p.deadToAlive.push({
          tick,
          matchTime,
          playerName
        });

        if (p.openDeadStart) {
          if (
            Number.isFinite(
              p.openDeadStart.matchTime
            )
            &&
            Number.isFinite(
              matchTime
            )
          ) {
            p.openDeadStart.episodeDurationSeconds =
              matchTime -
              p.openDeadStart.matchTime;
          }

          p.openDeadStart.censored =
            false;

          p.openDeadStart =
            null;
        }
      }
    }

    p.prev =
      current;
  }

  return {
    players:
      [...players.values()]
  };
}

function analyzeReplay(
  replayName,
  collected
) {
  const deathCredits =
    [];

  const aliveToDead =
    [];

  const integrity = {
    nonNumericValues: 0,
    nonIntegerValues: 0,
    negativeValues: 0,
    negativeTransitions: 0,
    playersStartingNonzero: 0,
    finalCounterTotal: 0
  };

  for (const p of collected.players) {
    for (const value of p.values) {
      if (!Number.isFinite(value)) {
        integrity.nonNumericValues++;
        continue;
      }

      if (!Number.isInteger(value)) {
        integrity.nonIntegerValues++;
      }

      if (value < 0) {
        integrity.negativeValues++;
      }
    }

    if (
      p.firstDeaths !== null
      &&
      p.firstDeaths !== 0
    ) {
      integrity.playersStartingNonzero++;
    }

    integrity.finalCounterTotal +=
      p.finalDeaths
      ??
      0;

    for (
      const transition
      of p.deathCreditTransitions
    ) {
      if (transition.delta < 0) {
        integrity.negativeTransitions++;
      }

      if (transition.delta > 0) {
        for (
          let i = 0;
          i < Math.trunc(transition.delta);
          i++
        ) {
          deathCredits.push({
            id:
              `deathCredit|${p.playerName}|${transition.tick}|${i}`,
            tick:
              transition.tick,
            matchTime:
              transition.matchTime,
            playerName:
              p.playerName,
            ordinalWithinTransition:
              i + 1
          });
        }
      }
    }

    aliveToDead.push(
      ...p.aliveToDead
    );
  }

  const actual =
    greedySamePlayerMatch({
      credits:
        deathCredits,
      transitions:
        aliveToDead,
      maxTicks:
        MATCH_WINDOW_TICKS
    });

  const placebo10Credits =
    deathCredits.map(
      credit => ({
        ...credit,
        tick:
          credit.tick +
          PLACEBO_10_TICKS
      })
    );

  const placebo30Credits =
    deathCredits.map(
      credit => ({
        ...credit,
        tick:
          credit.tick +
          PLACEBO_30_TICKS
      })
    );

  const placebo10 =
    greedySamePlayerMatch({
      credits:
        placebo10Credits,
      transitions:
        aliveToDead,
      maxTicks:
        MATCH_WINDOW_TICKS
    });

  const placebo30 =
    greedySamePlayerMatch({
      credits:
        placebo30Credits,
      transitions:
        aliveToDead,
      maxTicks:
        MATCH_WINDOW_TICKS
    });

  const matchedTransitionIds =
    new Set(
      actual.matches.map(
        row =>
          row.transition.id
      )
    );

  const unmatchedEpisodes =
    aliveToDead.filter(
      transition =>
        !matchedTransitionIds.has(
          transition.id
        )
    );

  const completedUnmatched =
    unmatchedEpisodes.filter(
      row =>
        row.censored !== true
        &&
        Number.isFinite(
          row.episodeDurationSeconds
        )
    );

  const durationCounts =
    countBy(
      completedUnmatched,
      row =>
        row
          .episodeDurationSeconds
          .toFixed(2)
    );

  return {
    replayName,

    success:
      true,

    counts: {
      players:
        collected.players.length,

      deathCredits:
        deathCredits.length,

      aliveToDeadTransitions:
        aliveToDead.length,

      matchedDeathCredits:
        actual.matches.length,

      unmatchedDeathCredits:
        actual.unmatchedCredits.length,

      unmatchedAliveToDead:
        unmatchedEpisodes.length,

      completedUnmatchedAliveToDead:
        completedUnmatched.length,

      censoredUnmatchedAliveToDead:
        unmatchedEpisodes.filter(
          row => row.censored === true
        ).length
    },

    integrity,

    semantic: {
      creditToAliveDeathAgreementRate:
        safeDiv(
          actual.matches.length,
          deathCredits.length
        ),

      signedTickOffsets:
        sortNumericKeys(
          countBy(
            actual.matches,
            row =>
              String(
                row.signedTickDelta
              )
          )
        )
    },

    controls: {
      placebo10Matches:
        placebo10.matches.length,

      placebo10Rate:
        safeDiv(
          placebo10.matches.length,
          deathCredits.length
        ),

      placebo30Matches:
        placebo30.matches.length,

      placebo30Rate:
        safeDiv(
          placebo30.matches.length,
          deathCredits.length
        )
    },

    unmatchedAliveToDeadEpisodes: {
      durationCounts:
        sortNumericKeys(
          durationCounts
        ),

      examples:
        unmatchedEpisodes
          .slice(0, 50)
          .map(
            row => ({
              playerName:
                row.playerName,
              tick:
                row.tick,
              matchTime:
                row.matchTime,
              episodeDurationSeconds:
                row.episodeDurationSeconds,
              censored:
                row.censored
            })
          )
    }
  };
}

function aggregateResults(rows) {
  const counts = {
    players: 0,
    deathCredits: 0,
    aliveToDeadTransitions: 0,
    matchedDeathCredits: 0,
    unmatchedDeathCredits: 0,
    unmatchedAliveToDead: 0,
    completedUnmatchedAliveToDead: 0,
    censoredUnmatchedAliveToDead: 0
  };

  const integrity = {
    nonNumericValues: 0,
    nonIntegerValues: 0,
    negativeValues: 0,
    negativeTransitions: 0,
    playersStartingNonzero: 0,
    finalCounterTotal: 0
  };

  let placebo10Matches = 0;
  let placebo30Matches = 0;

  const durationObjects = [];
  const offsetObjects = [];

  for (const row of rows) {
    for (const key of Object.keys(counts)) {
      counts[key] +=
        row.counts?.[key]
        ??
        0;
    }

    for (const key of Object.keys(integrity)) {
      integrity[key] +=
        row.integrity?.[key]
        ??
        0;
    }

    placebo10Matches +=
      row.controls?.placebo10Matches
      ??
      0;

    placebo30Matches +=
      row.controls?.placebo30Matches
      ??
      0;

    durationObjects.push(
      row
        .unmatchedAliveToDeadEpisodes
        ?.durationCounts
      ??
      {}
    );

    offsetObjects.push(
      row.semantic?.signedTickOffsets
      ??
      {}
    );
  }

  return {
    counts,

    integrity,

    semantic: {
      creditToAliveDeathAgreementRate:
        safeDiv(
          counts.matchedDeathCredits,
          counts.deathCredits
        ),

      signedTickOffsets:
        mergeCountObjectsNumeric(
          offsetObjects
        )
    },

    controls: {
      placebo10Matches,

      placebo10Rate:
        safeDiv(
          placebo10Matches,
          counts.deathCredits
        ),

      placebo30Matches,

      placebo30Rate:
        safeDiv(
          placebo30Matches,
          counts.deathCredits
        )
    },

    unmatchedAliveToDeadEpisodes: {
      durationCounts:
        mergeCountObjectsNumeric(
          durationObjects
        )
    }
  };
}

function greedySamePlayerMatch({
  credits,
  transitions,
  maxTicks
}) {
  const edges = [];

  for (
    let ci = 0;
    ci < credits.length;
    ci++
  ) {
    for (
      let ti = 0;
      ti < transitions.length;
      ti++
    ) {
      const credit =
        credits[ci];

      const transition =
        transitions[ti];

      if (
        credit.playerName !==
        transition.playerName
      ) {
        continue;
      }

      const signedTickDelta =
        transition.tick -
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
        ti,
        signedTickDelta,
        absoluteTickDelta
      });
    }
  }

  edges.sort(
    (a, b) =>
      a.absoluteTickDelta -
      b.absoluteTickDelta
      ||
      a.ci -
      b.ci
      ||
      a.ti -
      b.ti
  );

  const usedCredits =
    new Set();

  const usedTransitions =
    new Set();

  const matches = [];

  for (const edge of edges) {
    if (
      usedCredits.has(edge.ci)
      ||
      usedTransitions.has(edge.ti)
    ) {
      continue;
    }

    usedCredits.add(edge.ci);
    usedTransitions.add(edge.ti);

    matches.push({
      credit:
        credits[edge.ci],
      transition:
        transitions[edge.ti],
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
        (_row, index) =>
          !usedCredits.has(index)
      )
  };
}

function printBatch(output) {
  const a =
    output.aggregate;

  console.log('');
  console.log('========================================================');
  console.log('CROSS-REPLAY DEATH-CREDIT EVIDENCE');
  console.log('========================================================');
  console.log(
    `Successful replays: ${output.replays.filter(r=>r.success).length}/${output.replays.length}`
  );
  console.log(
    `Scoreboard death credits: ${a.counts.deathCredits}`
  );
  console.log(
    `Observed alive->dead transitions: ${a.counts.aliveToDeadTransitions}`
  );
  console.log(
    `Credit -> alive/dead agreement: ${a.counts.matchedDeathCredits}/${a.counts.deathCredits} = ${pct(a.semantic.creditToAliveDeathAgreementRate)}`
  );
  console.log(
    `Extra alive->dead transitions: ${a.counts.unmatchedAliveToDead}`
  );
  console.log(
    `Completed extra episodes: ${a.counts.completedUnmatchedAliveToDead}`
  );
  console.log(
    `Censored extra episodes: ${a.counts.censoredUnmatchedAliveToDead}`
  );
  console.log(
    `+10 s placebo: ${a.controls.placebo10Matches}/${a.counts.deathCredits} = ${pct(a.controls.placebo10Rate)}`
  );
  console.log(
    `+30 s placebo: ${a.controls.placebo30Matches}/${a.counts.deathCredits} = ${pct(a.controls.placebo30Rate)}`
  );
  console.log('');
  console.log('Extra alive->dead episode durations:');

  const durationEntries =
    Object.entries(
      a
        .unmatchedAliveToDeadEpisodes
        .durationCounts
      ??
      {}
    );

  if (!durationEntries.length) {
    console.log('  (none)');
  } else {
    for (
      const [duration, count]
      of durationEntries
    ) {
      console.log(
        `  ${duration.padStart(7)} s : ${count}`
      );
    }
  }

  console.log('');
  console.log(
    `SEMANTIC CLOSURE: ${output.semanticClosurePass ? 'PASS' : 'DO NOT PROMOTE'}`
  );
  console.log('');
  console.log(
    `Output: ${batchPath}`
  );
  console.log('');
  console.log(
    'IMPORTANT: deaths_scoreboard and death_count remain distinct constructs.'
  );
  console.log('');
}

function countBy(rows, keyFn) {
  const out = {};

  for (const row of rows) {
    const key =
      String(
        keyFn(row)
      );

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return out;
}

function mergeCountObjectsNumeric(objects) {
  const merged = {};

  for (const object of objects) {
    for (
      const [key, value]
      of Object.entries(object ?? {})
    ) {
      merged[key] =
        (merged[key] ?? 0) + value;
    }
  }

  return sortNumericKeys(merged);
}

function sortNumericKeys(object) {
  return Object.fromEntries(
    Object.entries(object)
      .sort(
        (a, b) =>
          Number(a[0]) -
          Number(b[0])
      )
  );
}

function safeDiv(a, b) {
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

function finite(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function booleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function stringOrNull(value) {
  if (
    value === null
    ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text || null;
}

function pct(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : '—';
}
