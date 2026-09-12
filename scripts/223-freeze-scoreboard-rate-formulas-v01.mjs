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
// SCRIPT 223
// SCOREBOARD PER-MINUTE RATE FORMULA CONTRACT V0.1
//
// Derived metrics:
//
//   kills_rate     = kills     / match_duration_minutes
//   assists_rate   = assists   / match_duration_minutes
//   last_hits_rate = last_hits / match_duration_minutes
//   denies_rate    = denies    / match_duration_minutes
//
// Zero/nonpositive duration convention:
//
//   if match_duration_seconds <= 0:
//     all four rate values = null
//
// Inputs are already separately authoritative:
//   m_iPlayerKills
//   m_iPlayerAssists
//   m_iLastHits
//   m_iDenies
//   match_duration / PlayerState timing substrate
//
// This script inventories six replay outputs and validates the
// frozen formula contract. No production promotion occurs here.
// ============================================================

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
    'scoreboard_per_minute_rate_formula_contract_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('SCOREBOARD PER-MINUTE RATE FORMULA CONTRACT V0.1');
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
    const raw =
      await readReplay(path);

    const durationSeconds =
      raw.maxMatchTimeSeconds;

    const durationMinutes =
      Number.isFinite(durationSeconds)
      &&
      durationSeconds > 0
        ? durationSeconds / 60
        : null;

    const rows =
      [...raw.finalByPlayer.values()]
        .map(
          player =>
            derivePlayer(
              player,
              durationMinutes
            )
        );

    const invalidInputs =
      rows.filter(
        row =>
          !row.inputValid
      ).length;

    const invalidDerived =
      rows.filter(
        row =>
          !row.derivedValid
      ).length;

    const result = {
      replayName,
      success: true,

      matchDurationSeconds:
        durationSeconds,

      matchDurationMinutes:
        durationMinutes,

      playerCount:
        rows.length,

      durationPositive:
        Number.isFinite(durationMinutes)
        &&
        durationMinutes > 0,

      counts: {
        invalidInputs,
        invalidDerived
      },

      sample:
        rows.slice(0, 12)
    };

    replayResults.push(result);

    console.log(
      `${replayName.padEnd(10)} ` +
      `players=${String(rows.length).padStart(2)} ` +
      `minutes=${formatNumber(durationMinutes).padStart(8)} ` +
      `invalidInputs=${invalidInputs} ` +
      `invalidDerived=${invalidDerived}`
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

const totals = {
  replays:
    successful.length,

  playerReplayScoreboards:
    successful.reduce(
      (sum, row) =>
        sum + row.playerCount,
      0
    ),

  positiveDurationReplays:
    successful.filter(
      row =>
        row.durationPositive
    ).length,

  invalidInputs:
    successful.reduce(
      (sum, row) =>
        sum + row.counts.invalidInputs,
      0
    ),

  invalidDerivedValues:
    successful.reduce(
      (sum, row) =>
        sum + row.counts.invalidDerived,
      0
    )
};

const formulaValidationPass =
  successful.length === replayNames.length
  &&
  totals.playerReplayScoreboards > 0
  &&
  totals.positiveDurationReplays === successful.length
  &&
  totals.invalidInputs === 0
  &&
  totals.invalidDerivedValues === 0;

const output = {
  version:
    'SCOREBOARD_PER_MINUTE_RATE_FORMULA_CONTRACT_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  formulas: {
    kills_rate:
      'kills / match_duration_minutes',

    assists_rate:
      'assists / match_duration_minutes',

    last_hits_rate:
      'last_hits / match_duration_minutes',

    denies_rate:
      'denies / match_duration_minutes'
  },

  denominator: {
    metric:
      'match_duration',

    unit:
      'minutes',

    derivation:
      'match_duration_seconds / 60',

    zeroOrNonpositiveConvention:
      'null',

    rationale:
      'A per-minute rate is undefined for a zero/nonpositive observation duration. Do not replace duration with an epsilon and do not emit extreme artificial rates.'
  },

  authoritativeInputs: {
    kills:
      'scoreboard_kill_credit_counter',

    assists:
      'scoreboard_assist_credit_counter',

    last_hits:
      'scoreboard_last_hit_credit_counter',

    denies:
      'scoreboard_deny_credit_counter',

    match_duration:
      'player_state_t_v1 timing substrate'
  },

  totals,

  formulaValidationPass,

  replays:
    replayResults,

  authorityBoundary: {
    establishedIfPromoted:
      'The four scoreboard rate metrics are deterministic final scoreboard counters divided by authoritative observed match duration in minutes.',

    explicitlyNotEstablished: [
      'alive-minute-normalized rates',
      'lane-phase rates',
      'rolling or interval rates',
      'smoothed or regularized rates',
      'per-minute causal performance estimates',
      'any denominator other than observed match duration'
    ]
  }
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

console.log('');
console.log('========================================================');
console.log('FORMULA CONTRACT');
console.log('========================================================');
console.log(
  `Successful replays: ${successful.length}/${replayNames.length}`
);
console.log(
  `Player-replay scoreboards: ${totals.playerReplayScoreboards}`
);
console.log(
  `Positive-duration replays: ${totals.positiveDurationReplays}/${successful.length}`
);
console.log(
  `Invalid raw inputs: ${totals.invalidInputs}`
);
console.log(
  `Invalid derived values: ${totals.invalidDerivedValues}`
);
console.log('');
console.log('Frozen formulas:');
console.log('  kills_rate     = kills / match_duration_minutes');
console.log('  assists_rate   = assists / match_duration_minutes');
console.log('  last_hits_rate = last_hits / match_duration_minutes');
console.log('  denies_rate    = denies / match_duration_minutes');
console.log('  duration <= 0  -> all four rates = null');
console.log('');
console.log(
  `FORMULA VALIDATION: ${formulaValidationPass ? 'PASS' : 'DO NOT PROMOTE'}`
);
console.log('');
console.log(
  `Output: ${outputPath}`
);
console.log('');

async function readReplay(path) {
  const finalByPlayer =
    new Map();

  let maxMatchTimeSeconds =
    0;

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
        JSON.parse(line);
    } catch {
      continue;
    }

    const matchTime =
      finite(
        row.matchTimeSeconds
      );

    if (
      matchTime !== null
      &&
      matchTime >= 0
    ) {
      maxMatchTimeSeconds =
        Math.max(
          maxMatchTimeSeconds,
          matchTime
        );
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

    if (
      matchTime !== null
      &&
      matchTime < 0
    ) {
      continue;
    }

    finalByPlayer.set(
      playerName,
      {
        playerName,

        kills:
          finite(c.kills),

        assists:
          finite(c.assists),

        lastHits:
          finite(c.lastHits),

        denies:
          finite(c.denies)
      }
    );
  }

  return {
    finalByPlayer,
    maxMatchTimeSeconds
  };
}

function derivePlayer(
  row,
  durationMinutes
) {
  const inputValid =
    isNonnegativeInteger(
      row.kills
    )
    &&
    isNonnegativeInteger(
      row.assists
    )
    &&
    isNonnegativeInteger(
      row.lastHits
    )
    &&
    isNonnegativeInteger(
      row.denies
    );

  const durationValid =
    Number.isFinite(
      durationMinutes
    )
    &&
    durationMinutes > 0;

  const killsRate =
    inputValid
    &&
    durationValid
      ? row.kills /
        durationMinutes
      : null;

  const assistsRate =
    inputValid
    &&
    durationValid
      ? row.assists /
        durationMinutes
      : null;

  const lastHitsRate =
    inputValid
    &&
    durationValid
      ? row.lastHits /
        durationMinutes
      : null;

  const deniesRate =
    inputValid
    &&
    durationValid
      ? row.denies /
        durationMinutes
      : null;

  const derivedValid =
    inputValid
    &&
    (
      durationValid
        ? [
            killsRate,
            assistsRate,
            lastHitsRate,
            deniesRate
          ].every(
            Number.isFinite
          )
        : [
            killsRate,
            assistsRate,
            lastHitsRate,
            deniesRate
          ].every(
            value =>
              value === null
          )
    );

  return {
    ...row,

    inputValid,

    matchDurationMinutes:
      durationMinutes,

    killsRate,
    assistsRate,
    lastHitsRate,
    deniesRate,

    derivedValid
  };
}

function isNonnegativeInteger(value) {
  return (
    Number.isFinite(value)
    &&
    Number.isInteger(value)
    &&
    value >= 0
  );
}

function finite(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function text(value) {
  if (
    value === null
    ||
    value === undefined
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result
    ? result
    : null;
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? value.toFixed(3)
    : '—';
}
