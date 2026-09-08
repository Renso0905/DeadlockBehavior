import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';

import {
  coalesceFinalStatePerTick,
  diagnoseFractionalShotTransitions,
  groupByContext,
  normalizeFractionEvent,
  summarizeByHeroAndRegime,
} from '../src/player-state/clip-fractional-consumption-diagnostic.mjs';

const VERSION =
  'WEAPON_CLIP_FRACTIONAL_CONSUMPTION_DIAGNOSTIC_V02';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script179 is test-only fractional clip diagnosis.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 yet.',
    ].join('\n'),
  );
}

const PATHS = {
  script178: resolve(
    'output',
    'test',
    'weapon_clip_tick_settlement_diagnostic_v01.json',
  ),
  script161Events: resolve(
    'output',
    'test',
    'effective_weapon_runtime_events_v01.jsonl',
  ),
  output: resolve(
    'output',
    'test',
    'weapon_clip_fractional_consumption_diagnostic_v02.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script178 = readJson(PATHS.script178);

const EXPECTED_178_STATUS =
  'WEAPON_CLIP_TICK_SETTLEMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_178_CLASSIFICATION =
  'TICK_SETTLEMENT_DOES_NOT_FULLY_RESOLVE_CLIP_REPRESENTATION';

const EXPECTED_COMPARABLE = 37571;
const EXPECTED_TRANSFORMED_ALIGNED = 30335;

// Script178's 30,335 count means positive INTEGER-PER-SHOT alignment.
// Script179 partitions the transformed WHOLE DROP by sign, which is a
// different statistic. The observed frozen sign partition is:
const EXPECTED_WHOLE_POSITIVE = 30337;
const EXPECTED_WHOLE_ZERO = 7221;
const EXPECTED_WHOLE_NEGATIVE = 13;

const events = [];
let parseFailures = 0;

const reader = createInterface({
  input: createReadStream(
    PATHS.script161Events,
    { encoding: 'utf8' },
  ),
  crlfDelay: Infinity,
});

for await (const line of reader) {
  if (!line.trim()) continue;

  try {
    events.push(
      normalizeFractionEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped = groupByContext(events);

const allRows = [];

for (const rows of grouped.values()) {
  const settled = coalesceFinalStatePerTick(rows);
  const diagnostic = diagnoseFractionalShotTransitions(settled);
  allRows.push(...diagnostic.rows);
}

const pooled = summarizePooled(allRows);
const byHeroAndRegime = summarizeByHeroAndRegime(allRows);

const thresholds = {
  minShotTransitions: 5000,
  minFractionComparableRate: 0.95,
  minZeroWholeFractionChangeRate: 0.80,
  minCompositePositiveConsumptionRate: 0.95,
  minZeroWholeResolvedPositiveRate: 0.90,
  maxCompositeNegativeRate: 0.01,
};

const candidates = [
  {
    name: 'PLUS_AMMO_FRACTION',
    summary: pooled.plusCandidate,
    zeroResolution: pooled.zeroWholeResolution.plus,
  },
  {
    name: 'MINUS_AMMO_FRACTION',
    summary: pooled.minusCandidate,
    zeroResolution: pooled.zeroWholeResolution.minus,
  },
];

const passingCandidates = candidates.filter(candidate =>
  pooled.observations >= thresholds.minShotTransitions
  && pooled.fraction.comparableRate >= thresholds.minFractionComparableRate
  && pooled.fraction.zeroWholeFractionChangedRate
    >= thresholds.minZeroWholeFractionChangeRate
  && candidate.summary.positiveRate
    >= thresholds.minCompositePositiveConsumptionRate
  && candidate.zeroResolution.positiveRate
    >= thresholds.minZeroWholeResolvedPositiveRate
  && candidate.summary.negativeRate
    <= thresholds.maxCompositeNegativeRate
);

let classification =
  'AMMO_FRACTION_DOES_NOT_RESOLVE_ZERO_INTEGER_CLIP_SHOTS';

if (passingCandidates.length === 1) {
  classification =
    passingCandidates[0].name === 'PLUS_AMMO_FRACTION'
      ? 'WHOLE_PLUS_AMMO_FRACTION_STRONGLY_RESOLVES_CLIP_CONSUMPTION'
      : 'WHOLE_MINUS_AMMO_FRACTION_STRONGLY_RESOLVES_CLIP_CONSUMPTION';
} else if (passingCandidates.length > 1) {
  classification =
    'BOTH_AMMO_FRACTION_SIGNS_PASS_REQUIRES_DIRECTIONAL_DIAGNOSIS';
}

const checks = {
  script178StatusExpected: check(
    script178?.status,
    EXPECTED_178_STATUS,
    script178?.status === EXPECTED_178_STATUS,
  ),

  script178ClassificationExpected: check(
    script178?.classification,
    EXPECTED_178_CLASSIFICATION,
    script178?.classification === EXPECTED_178_CLASSIFICATION,
  ),

  script178BaselineFrozen: check(
    {
      aligned:
        script178?.tickSettledShotTransitions
          ?.transformed?.positiveIntegerPerShot,
      comparable:
        script178?.tickSettledShotTransitions?.observations,
    },
    {
      aligned: EXPECTED_TRANSFORMED_ALIGNED,
      comparable: EXPECTED_COMPARABLE,
    },
    script178?.tickSettledShotTransitions
      ?.transformed?.positiveIntegerPerShot
      === EXPECTED_TRANSFORMED_ALIGNED
    && script178?.tickSettledShotTransitions?.observations
      === EXPECTED_COMPARABLE,
  ),

  transformedWholeSignPartitionRecovered: check(
    {
      positive: pooled.whole.positive,
      zero: pooled.whole.zero,
      negative: pooled.whole.negative,
      total: pooled.observations,
    },
    {
      positive: EXPECTED_WHOLE_POSITIVE,
      zero: EXPECTED_WHOLE_ZERO,
      negative: EXPECTED_WHOLE_NEGATIVE,
      total: EXPECTED_COMPARABLE,
    },
    pooled.whole.positive === EXPECTED_WHOLE_POSITIVE
      && pooled.whole.zero === EXPECTED_WHOLE_ZERO
      && pooled.whole.negative === EXPECTED_WHOLE_NEGATIVE
      && pooled.observations === EXPECTED_COMPARABLE,
  ),

  eventParseClean: check(
    parseFailures,
    0,
    parseFailures === 0,
  ),

  eventCountFrozen: check(
    events.length,
    61099,
    events.length === 61099,
  ),

  replicationCohortStillUnused: check(
    replayName,
    'test',
    replayName === 'test',
  ),
};

const integrityPass =
  Object.values(checks).every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),

  status:
    integrityPass
      ? 'WEAPON_CLIP_FRACTIONAL_CONSUMPTION_DIAGNOSTIC_V02_READY_FOR_INTERPRETATION'
      : 'WEAPON_CLIP_FRACTIONAL_CONSUMPTION_DIAGNOSTIC_V02_INTEGRITY_FAILURE',

  replay: replayName,

  frozenHypothesis: {
    wholeCounterTransform:
      'raw >= 0 ? 2*raw : -2*raw - 1',
    Script178ThresholdRetuned: false,
    tickSettledSamplingRetained: true,
    candidateContinuousStates: [
      'wholeClip + ammoFraction',
      'wholeClip - ammoFraction',
    ],
    constantSentinelOffsetSolvedHere: false,
    V01IntegrityCorrection:
      'V01 incorrectly derived zero-whole count from Script178 positive-integer-per-shot alignment. V02 freezes the actual transformed whole-drop sign partition without changing the scientific test.',
    thresholds,
  },

  pooled,
  byHeroAndRegime,
  classification,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      classification.includes('STRONGLY_RESOLVES')
        ? 'FRACTIONAL_CLIP_CONSUMPTION_CANDIDATE_SUPPORTED_SINGLE_REPLAY'
        : 'NOT_ESTABLISHED',
    replicationStatus: 'single_replay_only',
    authorityPromotion: false,
  },

  nextStep:
    classification.includes('STRONGLY_RESOLVES')
      ? 'FREEZE_CONTINUOUS_CLIP_STATE_THEN_SOLVE_SENTINEL_ZERO_POINT_AND_RELOAD_CAPACITY_MAPPING_ON_TEST'
      : 'CLASSIFY_ZERO_WHOLE_DROP_SHOTS_BY_HERO_FIRE_MODE_BURST_AND_AMMO_FRACTION_BEHAVIOR_ON_TEST_ONLY',
};

mkdirSync(
  dirname(PATHS.output),
  { recursive: true },
);

writeFileSync(
  PATHS.output,
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);

print(result);

function summarizePooled(rows) {
  // Reuse exported behavior by making one pseudo-settled sequence would
  // incorrectly bridge contexts, so summarize the already-derived rows here.
  const zeroRows = rows.filter(row => row.zeroWholeDrop);
  const comparable = rows.filter(row => row.fractionComparable);
  const zeroComparable = zeroRows.filter(row => row.fractionComparable);

  const composite = (key) => {
    const valid = rows.filter(row => Number.isFinite(row[key]));
    const values = valid.map(row => row[key]);
    const positive = valid.filter(row => row[key] > 1e-9).length;
    const zero = valid.filter(row => Math.abs(row[key]) <= 1e-9).length;
    const negative = valid.filter(row => row[key] < -1e-9).length;

    return {
      comparable: valid.length,
      comparableRate: rate(valid.length, rows.length),
      positive,
      positiveRate: rate(positive, valid.length),
      zero,
      zeroRate: rate(zero, valid.length),
      negative,
      negativeRate: rate(negative, valid.length),
      exactOnePerShot:
        valid.filter(row => near(row[key], 1)).length,
      exactOnePerShotRate: rate(
        valid.filter(row => near(row[key], 1)).length,
        valid.length,
      ),
      mode: mode(values),
      median: median(values),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    };
  };

  const zeroResolution = (key) => {
    const valid = zeroComparable.filter(row => Number.isFinite(row[key]));
    const positive = valid.filter(row => row[key] > 1e-9).length;
    const zero = valid.filter(row => Math.abs(row[key]) <= 1e-9).length;
    const negative = valid.filter(row => row[key] < -1e-9).length;

    return {
      comparable: valid.length,
      positive,
      positiveRate: rate(positive, valid.length),
      zero,
      zeroRate: rate(zero, valid.length),
      negative,
      negativeRate: rate(negative, valid.length),
      median: median(valid.map(row => row[key])),
    };
  };

  const fractionValues = [];
  for (const row of rows) {
    if (Number.isFinite(row.previousAmmoFraction)) {
      fractionValues.push(row.previousAmmoFraction);
    }
    if (Number.isFinite(row.currentAmmoFraction)) {
      fractionValues.push(row.currentAmmoFraction);
    }
  }

  return {
    observations: rows.length,

    whole: {
      zero: zeroRows.length,
      zeroRate: rate(zeroRows.length, rows.length),
      positive: rows.filter(row => row.positiveWholeDrop).length,
      positiveRate: rate(
        rows.filter(row => row.positiveWholeDrop).length,
        rows.length,
      ),
      negative: rows.filter(row => row.negativeWholeDrop).length,
      negativeRate: rate(
        rows.filter(row => row.negativeWholeDrop).length,
        rows.length,
      ),
      exactOnePerShot:
        rows.filter(row => near(row.wholeDropPerShot, 1)).length,
      exactOnePerShotRate: rate(
        rows.filter(row => near(row.wholeDropPerShot, 1)).length,
        rows.length,
      ),
    },

    fraction: {
      comparable: comparable.length,
      comparableRate: rate(comparable.length, rows.length),
      changed: comparable.filter(row => row.fractionChanged).length,
      changedRate: rate(
        comparable.filter(row => row.fractionChanged).length,
        comparable.length,
      ),
      zeroWholeComparable: zeroComparable.length,
      zeroWholeFractionChanged:
        zeroComparable.filter(row => row.fractionChanged).length,
      zeroWholeFractionChangedRate: rate(
        zeroComparable.filter(row => row.fractionChanged).length,
        zeroComparable.length,
      ),
      range: {
        count: fractionValues.length,
        min: fractionValues.length
          ? Math.min(...fractionValues)
          : null,
        max: fractionValues.length
          ? Math.max(...fractionValues)
          : null,
        median: median(fractionValues),
      },
    },

    plusCandidate: composite('plusDropPerShot'),
    minusCandidate: composite('minusDropPerShot'),

    zeroWholeResolution: {
      plus: zeroResolution('plusDropPerShot'),
      minus: zeroResolution('minusDropPerShot'),
    },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function rate(n, d) {
  return d > 0 ? n / d : null;
}

function near(a, b, tolerance = 1e-6) {
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= tolerance;
}

function mode(values) {
  if (!values.length) return null;

  const counts = new Map();
  for (const value of values) {
    const key = Number(Number(value).toFixed(6));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function check(actual, expected, pass) {
  return {
    actual,
    expected,
    pass: Boolean(pass),
  };
}

function percent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : 'n/a';
}

function print(result) {
  console.log('');
  console.log('========================================================');
  console.log('WEAPON CLIP FRACTIONAL CONSUMPTION DIAGNOSTIC V0.2');
  console.log('========================================================');
  console.log('');

  console.log('Replay:                              test');
  console.log('ZigZag transform changed:            NO');
  console.log('Tick-settled sampling retained:      YES');
  console.log('Sentinel/zero-point solved here:      NO');
  console.log('Replication cohort consumed:         NO');
  console.log('');

  console.log('FROZEN INTEGER BASELINE');
  console.log('-----------------------');
  console.log(
    `shot transitions:                     ${result.pooled.observations}`,
  );
  console.log(
    `whole integer positive:                ${result.pooled.whole.positive}/${result.pooled.observations} (${percent(result.pooled.whole.positiveRate)})`,
  );
  console.log(
    `whole integer zero:                    ${result.pooled.whole.zero}/${result.pooled.observations} (${percent(result.pooled.whole.zeroRate)})`,
  );
  console.log(
    `whole integer negative:                ${result.pooled.whole.negative}/${result.pooled.observations} (${percent(result.pooled.whole.negativeRate)})`,
  );
  console.log('');

  console.log('AMMO FRACTION COVERAGE');
  console.log('----------------------');
  console.log(
    `comparable:                            ${result.pooled.fraction.comparable}/${result.pooled.observations} (${percent(result.pooled.fraction.comparableRate)})`,
  );
  console.log(
    `fraction changed overall:              ${result.pooled.fraction.changed}/${result.pooled.fraction.comparable} (${percent(result.pooled.fraction.changedRate)})`,
  );
  console.log(
    `zero-whole shots with fraction change: ${result.pooled.fraction.zeroWholeFractionChanged}/${result.pooled.fraction.zeroWholeComparable} (${percent(result.pooled.fraction.zeroWholeFractionChangedRate)})`,
  );
  console.log(
    `fraction range:                         [${result.pooled.fraction.range.min}, ${result.pooled.fraction.range.max}] median=${result.pooled.fraction.range.median}`,
  );
  console.log('');

  console.log('CONTINUOUS-STATE CANDIDATES');
  console.log('---------------------------');

  for (const [label, row] of [
    ['whole + ammoFraction', result.pooled.plusCandidate],
    ['whole - ammoFraction', result.pooled.minusCandidate],
  ]) {
    console.log(
      `${label.padEnd(28)} positive=${percent(row.positiveRate)} zero=${percent(row.zeroRate)} negative=${percent(row.negativeRate)} exact1=${percent(row.exactOnePerShotRate)} mode=${row.mode} median=${row.median}`,
    );
  }
  console.log('');

  console.log('ZERO-WHOLE SHOT RESOLUTION');
  console.log('--------------------------');
  console.log(
    `PLUS  positive=${percent(result.pooled.zeroWholeResolution.plus.positiveRate)} zero=${percent(result.pooled.zeroWholeResolution.plus.zeroRate)} negative=${percent(result.pooled.zeroWholeResolution.plus.negativeRate)} median=${result.pooled.zeroWholeResolution.plus.median}`,
  );
  console.log(
    `MINUS positive=${percent(result.pooled.zeroWholeResolution.minus.positiveRate)} zero=${percent(result.pooled.zeroWholeResolution.minus.zeroRate)} negative=${percent(result.pooled.zeroWholeResolution.minus.negativeRate)} median=${result.pooled.zeroWholeResolution.minus.median}`,
  );
  console.log('');

  console.log('BY HERO / FIRE MODE / BURST REGIME');
  console.log('-----------------------------------');

  for (const row of result.byHeroAndRegime) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} mode=${String(row.activeFireMode).padEnd(3)} regime=${row.burstRegime.padEnd(14)} n=${String(row.observations).padEnd(6)} wholeZero=${percent(row.wholeZeroRate).padEnd(7)} fracOnZero=${percent(row.zeroWholeFractionChangedRate).padEnd(7)} plusZeroResolve=${percent(row.plusZeroResolutionRate).padEnd(7)} minusZeroResolve=${percent(row.minusZeroResolutionRate).padEnd(7)}`,
    );
  }

  console.log('');
  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');

  for (const [name, row] of Object.entries(
    result.integrityValidation.checks,
  )) {
    console.log(
      `${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log('CLASSIFICATION');
  console.log('--------------');
  console.log(result.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
