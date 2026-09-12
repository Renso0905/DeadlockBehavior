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
// SCRIPT 222
// SCOREBOARD DENY-CREDIT VALIDATION V0.1
//
// Narrow construct under test:
//
//   CCitadelPlayerController.m_iDenies
//     = game-awarded per-player deny-credit counter.
//
// Independent outcome substrate:
//
//   output/<replay>/flying_soul_full_damage_hits_v01.jsonl
//
// A flying-soul orb episode may contain multiple observed hit
// messages, including competing SECURE_HIT and DENY_HIT rows.
// Therefore this script DOES NOT equate every DENY_HIT with a
// scored deny.
//
// Positive-control anchor:
//   final observed full-damage hit in an orb episode is DENY_HIT
//
// Negative/context control:
//   final observed full-damage hit in an orb episode is SECURE_HIT
//
// Outcome:
//   same-player positive m_iDenies credit observed immediately
//   after the terminal orb hit.
//
// PlayerState is sampled at 4 Hz (16 ticks). We report forward
// windows of 16, 24, and 32 ticks; the primary conservative
// validation window is 32 ticks (0.5 s / two sample intervals).
//
// Shifted controls:
//   +10 s and +30 s copies of terminal DENY_HIT anchors.
//
// IMPORTANT:
// - Terminal observed Damage order is an independent behavioral
//   anchor, not a claim about the game's hidden winner-adjudication
//   rule.
// - A pass does not establish every denyable object class,
//   projectile identity, or all deny eligibility rules.
// - No production promotion is performed here.
// ============================================================

const TICK_RATE = 64;

const WINDOWS = [
  16,
  24,
  32
];

const PRIMARY_WINDOW_TICKS = 32;

const PLACEBO_OFFSETS = {
  placebo10:
    10 * TICK_RATE,

  placebo30:
    30 * TICK_RATE
};

const DEFAULT_REPLAYS = [
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
    'player_scoreboard_deny_validation_batch_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('SCOREBOARD DENY-CREDIT VALIDATION V0.1');
console.log('========================================================');
console.log(`Replays: ${replayNames.join(', ')}`);
console.log('');

const replayResults =
  [];

for (
  const replayName
  of replayNames
) {
  const playerStatePath =
    resolve(
      'output',
      replayName,
      'player_state.jsonl'
    );

  const hitPath =
    resolve(
      'output',
      replayName,
      'flying_soul_full_damage_hits_v01.jsonl'
    );

  if (
    !existsSync(
      playerStatePath
    )
    ||
    !existsSync(
      hitPath
    )
  ) {
    replayResults.push({
      replayName,
      success:
        false,

      status:
        'REQUIRED_OUTPUT_MISSING',

      missing: [
        !existsSync(
          playerStatePath
        )
          ? playerStatePath
          : null,

        !existsSync(
          hitPath
        )
          ? hitPath
          : null
      ].filter(Boolean)
    });

    console.log(
      `${replayName.padEnd(10)} required output missing`
    );

    continue;
  }

  try {
    const counter =
      await collectDenyCounter(
        playerStatePath
      );

    const hitRows =
      await readJsonl(
        hitPath
      );

    const terminal =
      buildTerminalOrbAnchors(
        hitRows
      );

    const result =
      analyzeReplay({
        replayName,
        counter,
        terminal
      });

    replayResults.push(
      result
    );

    writeReplayResult(
      replayName,
      result
    );

    const primary =
      result
        .windows
        [String(PRIMARY_WINDOW_TICKS)];

    console.log(
      `${replayName.padEnd(10)} ` +
      `credits=${String(result.counts.denyCredits).padStart(3)} ` +
      `denyTerminal=${String(result.counts.terminalDenyAnchors).padStart(3)} ` +
      `match=${pct(primary.terminalDenyMatchRate).padStart(7)} ` +
      `secureCtl=${pct(primary.terminalSecureMatchRate).padStart(7)} ` +
      `p10=${pct(primary.placebo10Rate).padStart(7)} ` +
      `p30=${pct(primary.placebo30Rate).padStart(7)}`
    );

  } catch (error) {
    replayResults.push({
      replayName,
      success:
        false,

      status:
        'VALIDATION_EXCEPTION',

      error:
        error?.stack
        ??
        String(error)
    });

    console.log(
      `${replayName.padEnd(10)} ERROR`
    );

    console.error(
      error
    );
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

const primary =
  aggregate
    .windows
    [String(PRIMARY_WINDOW_TICKS)];

const thresholds = {
  allRequestedReplaysSucceeded:
    successful.length ===
      replayNames.length,

  counterIntegrityPass:
    aggregate
      .counterIntegrity
      .negativeTransitions ===
      0
    &&
    aggregate
      .counterIntegrity
      .nonIntegerValues ===
      0
    &&
    aggregate
      .counterIntegrity
      .negativeValues ===
      0
    &&
    aggregate
      .counterIntegrity
      .firstObservedNonzeroPlayers ===
      0
    &&
    aggregate
      .counterIntegrity
      .positiveCreditUnits ===
      aggregate
        .counterIntegrity
        .finalCounterTotal,

  positiveControlAggregateAtLeast80Percent:
    (
      primary
        ?.terminalDenyMatchRate
      ??
      0
    ) >=
      0.80,

  positiveControlEveryReplayAtLeast75Percent:
    successful.length >
      0
    &&
    successful.every(
      row =>
        (
          row
            .windows
            [String(PRIMARY_WINDOW_TICKS)]
            ?.terminalDenyMatchRate
          ??
          0
        ) >=
          0.75
    ),

  secureControlBelow5Percent:
    (
      primary
        ?.terminalSecureMatchRate
      ??
      1
    ) <
      0.05,

  placebo10Below5Percent:
    (
      primary
        ?.placebo10Rate
      ??
      1
    ) <
      0.05,

  placebo30Below5Percent:
    (
      primary
        ?.placebo30Rate
      ??
      1
    ) <
      0.05,

  positiveVsSecureLiftAtLeast10x:
    (
      primary
        ?.positiveVsSecureRiskRatio
      ??
      0
    ) >=
      10
};

const validationPass =
  Object.values(
    thresholds
  ).every(Boolean);

const output = {
  version:
    'PLAYER_SCOREBOARD_DENY_VALIDATION_BATCH_V01',

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

  field:
    'CCitadelPlayerController.m_iDenies',

  constructUnderTest:
    'game-awarded per-player deny-credit counter',

  design: {
    tickRate:
      TICK_RATE,

    playerStateSampleIntervalTicks:
      16,

    reportedForwardWindowsTicks:
      WINDOWS,

    primaryForwardWindowTicks:
      PRIMARY_WINDOW_TICKS,

    primaryForwardWindowSeconds:
      PRIMARY_WINDOW_TICKS /
      TICK_RATE,

    positiveControl:
      'The final observed flying-soul full-damage hit in an orb episode is DENY_HIT, and the same attacker player receives a positive m_iDenies credit within the forward observation window.',

    negativeControl:
      'The final observed flying-soul full-damage hit in an orb episode is SECURE_HIT, tested against the same player m_iDenies outcome.',

    shiftedControls:
      [
        '+10 seconds',
        '+30 seconds'
      ],

    relationSemantics:
      'DENY_HIT and SECURE_HIT are taken from the independent flying_soul_full_damage_hits_v01 artifact. This script does not derive those labels from m_iDenies.'
  },

  aggregate,

  thresholds,

  validationPass,

  recommendedStatusIfPass: {
    integrityValidation:
      'pass',

    semanticValidation:
      'pass',

    replicationStatus:
      'cross_replay_replicated'
  },

  authorityBoundary: {
    establishedIfPass:
      'm_iDenies is strongly supported as the game-awarded per-player deny-credit counter.',

    explicitlyNotEstablished: [
      'that every DENY_HIT damage message is a scored deny',
      'the hidden server winner-adjudication rule for contested orb races',
      'every denyable entity or object class',
      'all deny eligibility rules',
      'projectile causal identity for every deny',
      'economic recipient attribution',
      'Urn deny semantics unless separately validated'
    ],

    behavioralDistinction:
      'DENY_HIT rows are observed deny-side hit behavior. m_iDenies increments are game-awarded scoreboard outcomes. They must not be collapsed into the same construct.'
  },

  replays:
    replayResults
};

mkdirSync(
  dirname(
    batchPath
  ),
  {
    recursive:
      true
  }
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

printBatch(
  output
);

// ============================================================
// Counter collection
// ============================================================

async function collectDenyCounter(
  path
) {
  const playerState =
    new Map();

  const creditUnits =
    [];

  const integrity = {
    nonIntegerValues:
      0,

    negativeValues:
      0,

    negativeTransitions:
      0,

    firstObservedNonzeroPlayers:
      0,

    positiveCreditUnits:
      0,

    finalCounterTotal:
      0
  };

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

  for await (
    const line
    of rl
  ) {
    if (
      !line.trim()
    ) {
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

    const controller =
      row?.controller;

    if (
      !controller
      ||
      typeof controller !==
        'object'
    ) {
      continue;
    }

    const playerName =
      stringOrNull(
        controller.playerName
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

    const team =
      finite(
        controller.team
      );

    const denies =
      finite(
        controller.denies
      );

    if (
      tick ===
        null
      ||
      denies ===
        null
    ) {
      continue;
    }

    if (
      !Number.isInteger(
        denies
      )
    ) {
      integrity
        .nonIntegerValues++;
    }

    if (
      denies <
      0
    ) {
      integrity
        .negativeValues++;
    }

    const previous =
      playerState.get(
        playerName
      )
      ??
      null;

    if (
      !previous
      &&
      denies !==
        0
    ) {
      integrity
        .firstObservedNonzeroPlayers++;
    }

    if (
      previous
      &&
      denies !==
        previous.denies
    ) {
      const delta =
        denies -
        previous.denies;

      if (
        delta <
        0
      ) {
        integrity
          .negativeTransitions++;
      }

      if (
        delta >
        0
      ) {
        const units =
          Math.trunc(
            delta
          );

        integrity
          .positiveCreditUnits +=
          units;

        for (
          let ordinal =
            0;
          ordinal <
            units;
          ordinal++
        ) {
          creditUnits.push({
            id:
              `denyCredit|${playerName}|${tick}|${ordinal}`,

            tick,

            playerName,

            team,

            ordinalWithinTransition:
              ordinal +
              1
          });
        }
      }
    }

    playerState.set(
      playerName,
      {
        denies,
        tick,
        team
      }
    );
  }

  for (
    const row
    of playerState.values()
  ) {
    integrity
      .finalCounterTotal +=
      row.denies;
  }

  return {
    creditUnits,
    integrity
  };
}

// ============================================================
// Independent flying-soul anchors
// ============================================================

function buildTerminalOrbAnchors(
  hitRows
) {
  const byEpisode =
    new Map();

  for (
    const row
    of hitRows
  ) {
    const episodeId =
      stringOrNull(
        row.orbEpisodeId
      );

    const tick =
      finite(
        row.demoTick
      );

    const playerName =
      stringOrNull(
        row.attackerPlayerName
      );

    const relation =
      stringOrNull(
        row.relation
      );

    if (
      !episodeId
      ||
      tick ===
        null
      ||
      !playerName
      ||
      (
        relation !==
          'DENY_HIT'
        &&
        relation !==
          'SECURE_HIT'
      )
    ) {
      continue;
    }

    const normalized = {
      episodeId,

      eventId:
        row.eventId
        ??
        null,

      tick,

      serverTick:
        finite(
          row.serverTick
        ),

      orbEntityIndex:
        finite(
          row.orbEntityIndex
        ),

      orbTeam:
        finite(
          row.orbTeam
        ),

      attackerEntityIndex:
        finite(
          row.attackerEntityIndex
        ),

      attackerPlayerName:
        playerName,

      attackerTeam:
        finite(
          row.attackerTeam
        ),

      relation
    };

    const existing =
      byEpisode.get(
        episodeId
      );

    if (
      !existing
      ||
      compareHitOrder(
        normalized,
        existing
      ) >
        0
    ) {
      byEpisode.set(
        episodeId,
        normalized
      );
    }
  }

  const all =
    [...byEpisode.values()]
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
          ||
          String(
            a.episodeId
          ).localeCompare(
            String(
              b.episodeId
            )
          )
      );

  return {
    all,

    deny:
      all.filter(
        row =>
          row.relation ===
          'DENY_HIT'
      ),

    secure:
      all.filter(
        row =>
          row.relation ===
          'SECURE_HIT'
      )
  };
}

function compareHitOrder(
  a,
  b
) {
  if (
    a.tick !==
    b.tick
  ) {
    return a.tick -
      b.tick;
  }

  const as =
    a.serverTick;

  const bs =
    b.serverTick;

  if (
    Number.isFinite(
      as
    )
    &&
    Number.isFinite(
      bs
    )
    &&
    as !==
      bs
  ) {
    return as -
      bs;
  }

  return 0;
}

// ============================================================
// Replay analysis
// ============================================================

function analyzeReplay({
  replayName,
  counter,
  terminal
}) {
  const windows =
    {};

  for (
    const windowTicks
    of WINDOWS
  ) {
    const denyMatch =
      greedyForwardMatch({
        anchors:
          terminal.deny,

        credits:
          counter.creditUnits,

        maxForwardTicks:
          windowTicks
      });

    const secureMatch =
      greedyForwardMatch({
        anchors:
          terminal.secure,

        credits:
          counter.creditUnits,

        maxForwardTicks:
          windowTicks
      });

    const placebo10 =
      greedyForwardMatch({
        anchors:
          shiftAnchors(
            terminal.deny,
            PLACEBO_OFFSETS.placebo10
          ),

        credits:
          counter.creditUnits,

        maxForwardTicks:
          windowTicks
      });

    const placebo30 =
      greedyForwardMatch({
        anchors:
          shiftAnchors(
            terminal.deny,
            PLACEBO_OFFSETS.placebo30
          ),

        credits:
          counter.creditUnits,

        maxForwardTicks:
          windowTicks
      });

    windows[
      String(
        windowTicks
      )
    ] = {
      terminalDenyMatches:
        denyMatch.matches.length,

      terminalDenyMatchRate:
        safeDiv(
          denyMatch.matches.length,
          terminal.deny.length
        ),

      denyCreditsCovered:
        denyMatch.matches.length,

      denyCreditCoverageRate:
        safeDiv(
          denyMatch.matches.length,
          counter.creditUnits.length
        ),

      terminalSecureMatches:
        secureMatch.matches.length,

      terminalSecureMatchRate:
        safeDiv(
          secureMatch.matches.length,
          terminal.secure.length
        ),

      placebo10Matches:
        placebo10.matches.length,

      placebo10Rate:
        safeDiv(
          placebo10.matches.length,
          terminal.deny.length
        ),

      placebo30Matches:
        placebo30.matches.length,

      placebo30Rate:
        safeDiv(
          placebo30.matches.length,
          terminal.deny.length
        ),

      positiveVsSecureRiskRatio:
        riskRatio(
          safeDiv(
            denyMatch.matches.length,
            terminal.deny.length
          ),

          safeDiv(
            secureMatch.matches.length,
            terminal.secure.length
          )
        ),

      signedTickOffsets:
        sortNumericKeys(
          countBy(
            denyMatch.matches,
            row =>
              String(
                row.signedTickDelta
              )
          )
        )
    };
  }

  return {
    replayName,

    success:
      true,

    status:
      'SCOREBOARD_DENY_VALIDATION_COMPLETE',

    counts: {
      denyCredits:
        counter.creditUnits.length,

      terminalOrbAnchors:
        terminal.all.length,

      terminalDenyAnchors:
        terminal.deny.length,

      terminalSecureAnchors:
        terminal.secure.length
    },

    counterIntegrity:
      counter.integrity,

    windows,

    authorityBoundary:
      'Observed deny-side terminal orb hits are independent behavioral anchors. m_iDenies is the scoreboard outcome carrier. This validator does not equate all deny-side hits with scored denies.'
  };
}

// ============================================================
// Aggregate
// ============================================================

function aggregateResults(
  rows
) {
  const counts = {
    denyCredits:
      0,

    terminalOrbAnchors:
      0,

    terminalDenyAnchors:
      0,

    terminalSecureAnchors:
      0
  };

  const counterIntegrity = {
    nonIntegerValues:
      0,

    negativeValues:
      0,

    negativeTransitions:
      0,

    firstObservedNonzeroPlayers:
      0,

    positiveCreditUnits:
      0,

    finalCounterTotal:
      0
  };

  for (
    const row
    of rows
  ) {
    for (
      const key
      of Object.keys(
        counts
      )
    ) {
      counts[key] +=
        row
          .counts
          ?.[key]
        ??
        0;
    }

    for (
      const key
      of Object.keys(
        counterIntegrity
      )
    ) {
      counterIntegrity[key] +=
        row
          .counterIntegrity
          ?.[key]
        ??
        0;
    }
  }

  const windows =
    {};

  for (
    const windowTicks
    of WINDOWS
  ) {
    const key =
      String(
        windowTicks
      );

    const denyMatches =
      sumWindow(
        rows,
        key,
        'terminalDenyMatches'
      );

    const secureMatches =
      sumWindow(
        rows,
        key,
        'terminalSecureMatches'
      );

    const p10 =
      sumWindow(
        rows,
        key,
        'placebo10Matches'
      );

    const p30 =
      sumWindow(
        rows,
        key,
        'placebo30Matches'
      );

    windows[key] = {
      terminalDenyMatches:
        denyMatches,

      terminalDenyMatchRate:
        safeDiv(
          denyMatches,
          counts.terminalDenyAnchors
        ),

      denyCreditsCovered:
        denyMatches,

      denyCreditCoverageRate:
        safeDiv(
          denyMatches,
          counts.denyCredits
        ),

      terminalSecureMatches:
        secureMatches,

      terminalSecureMatchRate:
        safeDiv(
          secureMatches,
          counts.terminalSecureAnchors
        ),

      placebo10Matches:
        p10,

      placebo10Rate:
        safeDiv(
          p10,
          counts.terminalDenyAnchors
        ),

      placebo30Matches:
        p30,

      placebo30Rate:
        safeDiv(
          p30,
          counts.terminalDenyAnchors
        ),

      positiveVsSecureRiskRatio:
        riskRatio(
          safeDiv(
            denyMatches,
            counts.terminalDenyAnchors
          ),

          safeDiv(
            secureMatches,
            counts.terminalSecureAnchors
          )
        ),

      signedTickOffsets:
        mergeCountObjectsNumeric(
          rows.map(
            row =>
              row
                .windows
                ?.[key]
                ?.signedTickOffsets
            ??
            {}
          )
        )
    };
  }

  return {
    counts,

    counterIntegrity,

    windows,

    replayLevel: {
      primaryDenyMatchRates:
        rows.map(
          row => ({
            replayName:
              row.replayName,

            rate:
              row
                .windows
                [String(PRIMARY_WINDOW_TICKS)]
                .terminalDenyMatchRate
          })
        )
    }
  };
}

// ============================================================
// Matching
// ============================================================

function greedyForwardMatch({
  anchors,
  credits,
  maxForwardTicks
}) {
  const edges =
    [];

  for (
    let ai =
      0;
    ai <
      anchors.length;
    ai++
  ) {
    const anchor =
      anchors[ai];

    for (
      let ci =
        0;
      ci <
        credits.length;
      ci++
    ) {
      const credit =
        credits[ci];

      if (
        anchor
          .attackerPlayerName !==
        credit.playerName
      ) {
        continue;
      }

      const delta =
        credit.tick -
        anchor.tick;

      if (
        delta <
          0
        ||
        delta >
          maxForwardTicks
      ) {
        continue;
      }

      edges.push({
        ai,
        ci,
        signedTickDelta:
          delta
      });
    }
  }

  edges.sort(
    (
      a,
      b
    ) =>
      a.signedTickDelta -
      b.signedTickDelta
      ||
      a.ai -
      b.ai
      ||
      a.ci -
      b.ci
  );

  const usedAnchors =
    new Set();

  const usedCredits =
    new Set();

  const matches =
    [];

  for (
    const edge
    of edges
  ) {
    if (
      usedAnchors.has(
        edge.ai
      )
      ||
      usedCredits.has(
        edge.ci
      )
    ) {
      continue;
    }

    usedAnchors.add(
      edge.ai
    );

    usedCredits.add(
      edge.ci
    );

    matches.push({
      anchor:
        anchors[
          edge.ai
        ],

      credit:
        credits[
          edge.ci
        ],

      signedTickDelta:
        edge.signedTickDelta
    });
  }

  return {
    matches,

    unmatchedAnchors:
      anchors.filter(
        (
          _row,
          index
        ) =>
          !usedAnchors.has(
            index
          )
      ),

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

function shiftAnchors(
  anchors,
  ticks
) {
  return anchors.map(
    anchor => ({
      ...anchor,

      tick:
        anchor.tick +
        ticks
    })
  );
}

// ============================================================
// I/O / reporting
// ============================================================

async function readJsonl(
  path
) {
  const rows =
    [];

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

  for await (
    const line
    of rl
  ) {
    if (
      !line.trim()
    ) {
      continue;
    }

    try {
      rows.push(
        JSON.parse(
          line
        )
      );
    } catch {
      // Preserve the validator rather than failing on an unrelated
      // malformed diagnostic line.
    }
  }

  return rows;
}

function writeReplayResult(
  replayName,
  result
) {
  const path =
    resolve(
      'output',
      replayName,
      'player_scoreboard_deny_validation_v01.json'
    );

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
  );

  writeFileSync(
    path,
    JSON.stringify(
      result,
      null,
      2
    ),
    'utf8'
  );
}

function printBatch(
  output
) {
  const a =
    output.aggregate;

  console.log('');
  console.log('========================================================');
  console.log('CROSS-REPLAY DENY-CREDIT EVIDENCE');
  console.log('========================================================');
  console.log(
    `Successful replays: ${output.successCount}/${output.replayCount}`
  );
  console.log(
    `m_iDenies credit units: ${a.counts.denyCredits}`
  );
  console.log(
    `Final counter total: ${a.counterIntegrity.finalCounterTotal}`
  );
  console.log(
    `Terminal DENY_HIT anchors: ${a.counts.terminalDenyAnchors}`
  );
  console.log(
    `Terminal SECURE_HIT anchors: ${a.counts.terminalSecureAnchors}`
  );
  console.log('');

  for (
    const windowTicks
    of WINDOWS
  ) {
    const row =
      a
        .windows
        [String(windowTicks)];

    console.log(
      `0..+${windowTicks} ticks (${(windowTicks / TICK_RATE).toFixed(3)} s):`
    );

    console.log(
      `  terminal deny -> m_iDenies  ${row.terminalDenyMatches}/${a.counts.terminalDenyAnchors} = ${pct(row.terminalDenyMatchRate)}`
    );

    console.log(
      `  deny-counter coverage       ${row.denyCreditsCovered}/${a.counts.denyCredits} = ${pct(row.denyCreditCoverageRate)}`
    );

    console.log(
      `  terminal secure control     ${row.terminalSecureMatches}/${a.counts.terminalSecureAnchors} = ${pct(row.terminalSecureMatchRate)}`
    );

    console.log(
      `  +10 s placebo               ${row.placebo10Matches}/${a.counts.terminalDenyAnchors} = ${pct(row.placebo10Rate)}`
    );

    console.log(
      `  +30 s placebo               ${row.placebo30Matches}/${a.counts.terminalDenyAnchors} = ${pct(row.placebo30Rate)}`
    );

    console.log(
      `  positive/secure lift        ${formatRatio(row.positiveVsSecureRiskRatio)}`
    );

    console.log('');
  }

  console.log(
    'Primary 32-tick per-replay deny-anchor agreement:'
  );

  for (
    const row
    of a
      .replayLevel
      .primaryDenyMatchRates
  ) {
    console.log(
      `  ${row.replayName.padEnd(8)} ${pct(row.rate)}`
    );
  }

  console.log('');
  console.log(
    `VALIDATION: ${output.validationPass ? 'PASS' : 'DO NOT PROMOTE'}`
  );
  console.log('');
  console.log(
    `Output: ${batchPath}`
  );
  console.log('');
  console.log(
    'IMPORTANT: DENY_HIT is an observed deny-side hit anchor; m_iDenies is the scoreboard outcome. Do not collapse attempt/action with scored outcome.'
  );
  console.log('');
}

// ============================================================
// Utility
// ============================================================

function sumWindow(
  rows,
  windowKey,
  field
) {
  return rows.reduce(
    (
      total,
      row
    ) =>
      total +
      (
        row
          .windows
          ?.[windowKey]
          ?.[field]
        ??
        0
      ),
    0
  );
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

function mergeCountObjectsNumeric(
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

  return sortNumericKeys(
    merged
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

function riskRatio(
  positiveRate,
  controlRate
) {
  if (
    !Number.isFinite(
      positiveRate
    )
    ||
    !Number.isFinite(
      controlRate
    )
  ) {
    return null;
  }

  if (
    controlRate ===
      0
  ) {
    return positiveRate >
      0
      ? Infinity
      : null;
  }

  return positiveRate /
    controlRate;
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

function formatRatio(
  value
) {
  if (
    value ===
    Infinity
  ) {
    return '∞';
  }

  return Number.isFinite(
    value
  )
    ? `${value.toFixed(2)}x`
    : '—';
}
