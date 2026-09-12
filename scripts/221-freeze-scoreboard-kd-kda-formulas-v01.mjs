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
// SCRIPT 221
// SCOREBOARD K/D + KDA FORMULA CONTRACT V0.1
//
// Derived metrics:
//
//   kd  = kills / deaths_scoreboard
//   kda = (kills + assists) / deaths_scoreboard
//
// Zero-death convention:
//
//   if deaths_scoreboard === 0:
//     kd  = null
//     kda = null
//
// This is deliberate. We do not silently substitute 1 into the
// denominator and we do not emit Infinity into downstream data.
//
// Inputs are already separately authoritative:
//   m_iPlayerKills
//   m_iPlayerAssists
//   m_iDeaths
//
// This script inventories the six-replay final scoreboard state,
// exercises the frozen formulas, and writes a derivation artifact.
//
// Research/contract script only. No promotion here.
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

const outPath =
  resolve(
    'output',
    'cross_replay',
    'scoreboard_kd_kda_formula_contract_v01.json'
  );

console.log('');
console.log('========================================================');
console.log('SCOREBOARD K/D + KDA FORMULA CONTRACT V0.1');
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
    const finalByPlayer =
      await readFinalScoreboard(path);

    const rows =
      [...finalByPlayer.values()]
        .map(
          row =>
            deriveRow(row)
        );

    const zeroDeath =
      rows.filter(
        row =>
          row.deaths === 0
      );

    const positiveDeath =
      rows.filter(
        row =>
          row.deaths > 0
      );

    const result = {
      replayName,
      success: true,
      playerCount: rows.length,

      counts: {
        zeroDeathPlayers:
          zeroDeath.length,

        positiveDeathPlayers:
          positiveDeath.length,

        invalidRawInputs:
          rows.filter(
            row =>
              !row.inputValid
          ).length,

        invalidDerivedValues:
          rows.filter(
            row =>
              !row.derivedValid
          ).length
      },

      zeroDeathExamples:
        zeroDeath
          .slice(0, 20),

      positiveDeathExamples:
        positiveDeath
          .slice(0, 20)
    };

    replayResults.push(result);

    console.log(
      `${replayName.padEnd(10)} ` +
      `players=${String(rows.length).padStart(2)} ` +
      `zeroDeaths=${String(zeroDeath.length).padStart(2)} ` +
      `invalidInputs=${result.counts.invalidRawInputs} ` +
      `invalidDerived=${result.counts.invalidDerivedValues}`
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

const totals = {
  players:
    successful.reduce(
      (sum, row) =>
        sum + row.playerCount,
      0
    ),

  zeroDeathPlayers:
    successful.reduce(
      (sum, row) =>
        sum + row.counts.zeroDeathPlayers,
      0
    ),

  positiveDeathPlayers:
    successful.reduce(
      (sum, row) =>
        sum + row.counts.positiveDeathPlayers,
      0
    ),

  invalidRawInputs:
    successful.reduce(
      (sum, row) =>
        sum + row.counts.invalidRawInputs,
      0
    ),

  invalidDerivedValues:
    successful.reduce(
      (sum, row) =>
        sum + row.counts.invalidDerivedValues,
      0
    )
};

const formulaValidationPass =
  successful.length === replayNames.length
  &&
  totals.players > 0
  &&
  totals.invalidRawInputs === 0
  &&
  totals.invalidDerivedValues === 0;

const output = {
  version:
    'SCOREBOARD_KD_KDA_FORMULA_CONTRACT_V01',

  canonical:
    false,

  researchOnly:
    true,

  createdAt:
    new Date().toISOString(),

  inputs: {
    kills:
      'game-awarded per-player kill-credit counter',

    assists:
      'game-awarded per-player assist-credit counter',

    deaths:
      'game-awarded per-player scored-death counter'
  },

  formulas: {
    kd:
      'kills / deaths_scoreboard',

    kda:
      '(kills + assists) / deaths_scoreboard'
  },

  zeroDeathConvention: {
    denominator:
      'deaths_scoreboard',

    whenDeathsEqualZero: {
      kd:
        null,

      kda:
        null
    },

    presentation:
      'N/A · 0 deaths',

    rationale:
      'Literal division by zero is undefined. Do not substitute 1 and do not emit Infinity into authoritative or predictive data.'
  },

  totals,

  formulaValidationPass,

  replays:
    replayResults,

  authorityBoundary: {
    establishedIfPromoted:
      'K/D and KDA are deterministic derived scoreboard ratios using authoritative kills, assists, and scoreboard deaths.',

    explicitlyNotEstablished: [
      'smoothed ratios',
      'Bayesian or regularized combat rates',
      'per-minute combat rates',
      'observed-state death_count as denominator',
      'Infinity as a valid zero-death value'
    ]
  }
};

mkdirSync(
  dirname(outPath),
  { recursive: true }
);

writeFileSync(
  outPath,
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
console.log(`Players observed: ${totals.players}`);
console.log(`Zero-death players: ${totals.zeroDeathPlayers}`);
console.log(`Positive-death players: ${totals.positiveDeathPlayers}`);
console.log(`Invalid raw scoreboard inputs: ${totals.invalidRawInputs}`);
console.log(`Invalid derived values: ${totals.invalidDerivedValues}`);
console.log('');
console.log('Frozen formulas:');
console.log('  KD  = kills / deaths_scoreboard');
console.log('  KDA = (kills + assists) / deaths_scoreboard');
console.log('  deaths_scoreboard = 0 -> KD=null, KDA=null');
console.log('');
console.log(
  `FORMULA VALIDATION: ${formulaValidationPass ? 'PASS' : 'DO NOT PROMOTE'}`
);
console.log('');
console.log(`Output: ${outPath}`);
console.log('');

async function readFinalScoreboard(path) {
  const map =
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
      row =
        JSON.parse(line);
    } catch {
      continue;
    }

    const c =
      row?.controller;

    if (!c || typeof c !== 'object') {
      continue;
    }

    const playerName =
      text(c.playerName);

    if (
      !playerName
      ||
      playerName === 'SourceTV'
    ) {
      continue;
    }

    const matchTime =
      finite(row.matchTimeSeconds);

    if (
      matchTime !== null
      &&
      matchTime < 0
    ) {
      continue;
    }

    map.set(
      playerName,
      {
        playerName,

        kills:
          finite(c.kills),

        assists:
          finite(c.assists),

        deaths:
          finite(c.deaths)
      }
    );
  }

  return map;
}

function deriveRow(row) {
  const inputValid =
    isNonnegativeInteger(row.kills)
    &&
    isNonnegativeInteger(row.assists)
    &&
    isNonnegativeInteger(row.deaths);

  let kd =
    null;

  let kda =
    null;

  if (
    inputValid
    &&
    row.deaths > 0
  ) {
    kd =
      row.kills /
      row.deaths;

    kda =
      (
        row.kills +
        row.assists
      )
      /
      row.deaths;
  }

  const derivedValid =
    inputValid
    &&
    (
      row.deaths === 0
        ? kd === null
          && kda === null
        : Number.isFinite(kd)
          && Number.isFinite(kda)
    );

  return {
    ...row,
    inputValid,
    kd,
    kda,
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

  return result || null;
}
