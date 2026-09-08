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
  compareHeroTransformToStatic,
  diagnoseClipSignPattern,
  diagnoseShotTransitions,
  extractStaticWeaponAmmoProfiles,
  groupClipEvents,
  normalizeClipEvent,
  transformScript174Candidates,
  transformedOvershootPhase,
} from '../src/player-state/clip-integer-representation-diagnostic.mjs';

const VERSION =
  'WEAPON_CLIP_INTEGER_REPRESENTATION_DIAGNOSTIC_V01';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script177 is discovery-only and must run on test.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 until clip representation is frozen.',
    ].join('\n'),
  );
}

const PATHS = {
  script174: resolve(
    'output',
    'test',
    'runtime_magazine_capacity_carrier_discovery_v02.json',
  ),
  script176: resolve(
    'output',
    'test',
    'magazine_capacity_ceiling_outlier_diagnostic_v01.json',
  ),
  script161Events: resolve(
    'output',
    'test',
    'effective_weapon_runtime_events_v01.jsonl',
  ),
  script165: resolve(
    'output',
    'cross_replay',
    'primary_weapon_static_cadence_substrate_v02.json',
  ),
  output: resolve(
    'output',
    'test',
    'weapon_clip_integer_representation_diagnostic_v01.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;

  if (!existsSync(path)) {
    throw new Error(
      `Missing ${name}:\n${path}`,
    );
  }
}

const script174 =
  readJson(PATHS.script174);

const script176 =
  readJson(PATHS.script176);

const script165 =
  readJson(PATHS.script165);

const EXPECTED_174_STATUS =
  'RUNTIME_MAGAZINE_CAPACITY_CARRIER_DISCOVERY_V02_READY_FOR_SEMANTIC_VALIDATION';

const EXPECTED_176_STATUS =
  'MAGAZINE_CAPACITY_CEILING_OUTLIER_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

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
      normalizeClipEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped =
  groupClipEvents(events);

const signPattern =
  diagnoseClipSignPattern(events);

const transitionByContext =
  new Map();

for (const [key, rows] of grouped) {
  transitionByContext.set(
    key,
    diagnoseShotTransitions(rows),
  );
}

const pooled =
  summarizePooledTransitions(
    [...transitionByContext.values()],
  );

const candidates =
  transformScript174Candidates(
    script174,
  );

const staticProfiles =
  extractStaticWeaponAmmoProfiles(
    script165,
  );

const byHero =
  compareHeroTransformToStatic(
    candidates,
    transitionByContext,
    staticProfiles,
  );

const overshootPhases =
  candidates.map(candidate =>
    transformedOvershootPhase(
      candidate,
      grouped.get(
        candidate.contextKey,
      ) ?? [],
    )
  );

const totalTransformedOvershoots =
  overshootPhases.reduce(
    (sum, row) =>
      sum + row.overshoots,
    0,
  );

const overshootsBeforeFirstReload =
  overshootPhases.reduce(
    (sum, row) =>
      sum + row.beforeFirstReload,
    0,
  );

const overshootsAfterFirstReload =
  overshootPhases.reduce(
    (sum, row) =>
      sum + row.atOrAfterFirstReload,
    0,
  );

const thresholds = {
  minShotTransitions: 5000,
  minTransformedPositiveIntegerRate: 0.95,
  minAdvantageOverRawPositiveIntegerRate: 0.25,
};

const transformedStrong =
  pooled.observations
    >= thresholds.minShotTransitions
  && pooled.transformed
    .positiveIntegerPerShotRate
    >= thresholds
      .minTransformedPositiveIntegerRate;

const transformDominatesRaw =
  (
    pooled.transformed
      .positiveIntegerPerShotRate
    - pooled.raw
      .positiveIntegerPerShotRate
  ) >= thresholds
    .minAdvantageOverRawPositiveIntegerRate;

const classification =
  transformedStrong
  && transformDominatesRaw
    ? 'ZIGZAG_REENCODE_STRONGLY_RECOVERS_NONNEGATIVE_CLIP_COUNTER_DYNAMICS'
    : 'CLIP_INTEGER_REPRESENTATION_REMAINS_UNRESOLVED';

const checks = {
  script174V02Ready: check(
    script174?.status,
    EXPECTED_174_STATUS,
    script174?.status
      === EXPECTED_174_STATUS,
  ),

  script176Ready: check(
    script176?.status,
    EXPECTED_176_STATUS,
    script176?.status
      === EXPECTED_176_STATUS,
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

  candidateContextCountFrozen: check(
    candidates.length,
    54,
    candidates.length === 54,
  ),

  replicationCohortStillUnused: check(
    replayName,
    'test',
    replayName === 'test',
  ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt:
    new Date().toISOString(),

  status:
    integrityPass
      ? 'WEAPON_CLIP_INTEGER_REPRESENTATION_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'WEAPON_CLIP_INTEGER_REPRESENTATION_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  replay: replayName,

  preRegisteredHypothesis: {
    source:
      'Script176 observed alternating-sign shot transitions such as implied -17 -> +16 on a one-shot advance.',
    candidateTransform:
      'raw >= 0 ? 2*raw : -2*raw - 1',
    interpretation:
      'Test whether Script161 clip is a signed ZigZag-decoded representation of a non-negative internal clip counter.',
    gameplayAmmoMeaningClaimed: false,
    magazineCapacityClaimed: false,
    thresholds,
  },

  signPattern,

  pooledShotTransitions: pooled,

  candidateTransform: {
    contexts: candidates,
    byHero,
    transformedOvershootPhase: {
      total: totalTransformedOvershoots,
      beforeFirstReload:
        overshootsBeforeFirstReload,
      atOrAfterFirstReload:
        overshootsAfterFirstReload,
      contexts: overshootPhases,
    },
  },

  classification,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      classification
        === 'ZIGZAG_REENCODE_STRONGLY_RECOVERS_NONNEGATIVE_CLIP_COUNTER_DYNAMICS'
        ? 'REPRESENTATION_TRANSFORM_STRONGLY_SUPPORTED_SINGLE_REPLAY'
        : 'NOT_ESTABLISHED',
    replicationStatus:
      'single_replay_only',
    authorityPromotion: false,
  },

  nextStep:
    classification
      === 'ZIGZAG_REENCODE_STRONGLY_RECOVERS_NONNEGATIVE_CLIP_COUNTER_DYNAMICS'
      ? 'DETERMINE_ZERO_POINT_AND_RELATION_OF_TRANSFORMED_COUNTER_TO_USABLE_AMMO_AND_RELOAD_CAPACITY_ON_TEST_BEFORE_CROSS_REPLAY_VALIDATION'
      : 'DIAGNOSE_ALTERNATIVE_CLIP_ENCODING_OR_EVENT_SERIALIZATION_ON_TEST_ONLY',
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

function summarizePooledTransitions(
  contextSummaries,
) {
  const rows =
    contextSummaries.flatMap(
      summary => summary.rows,
    );

  const transformedPositiveInteger =
    rows.filter(
      row =>
        row.transformedPositiveIntegerPerShot,
    ).length;

  const rawPositiveInteger =
    rows.filter(
      row =>
        row.rawDropPerShot > 0
        && Number.isInteger(
          row.rawDropPerShot,
        ),
    ).length;

  const absPositiveInteger =
    rows.filter(
      row =>
        row.absDropPerShot > 0
        && Number.isInteger(
          row.absDropPerShot,
        ),
    ).length;

  return {
    observations: rows.length,

    transformed: {
      positiveIntegerPerShot:
        transformedPositiveInteger,
      positiveIntegerPerShotRate:
        rows.length > 0
          ? transformedPositiveInteger
            / rows.length
          : null,
      mode:
        modeValue(
          rows.map(
            row =>
              row.transformedDropPerShot,
          ),
        ),
      median:
        median(
          rows.map(
            row =>
              row.transformedDropPerShot,
          ),
        ),
    },

    raw: {
      positiveIntegerPerShot:
        rawPositiveInteger,
      positiveIntegerPerShotRate:
        rows.length > 0
          ? rawPositiveInteger
            / rows.length
          : null,
      mode:
        modeValue(
          rows.map(
            row =>
              row.rawDropPerShot,
          ),
        ),
      median:
        median(
          rows.map(
            row =>
              row.rawDropPerShot,
          ),
        ),
      negativeRate:
        rows.length > 0
          ? rows.filter(
            row =>
              row.rawDropPerShot < 0,
          ).length / rows.length
          : null,
    },

    absoluteValue: {
      positiveIntegerPerShot:
        absPositiveInteger,
      positiveIntegerPerShotRate:
        rows.length > 0
          ? absPositiveInteger
            / rows.length
          : null,
      mode:
        modeValue(
          rows.map(
            row =>
              row.absDropPerShot,
          ),
        ),
      median:
        median(
          rows.map(
            row =>
              row.absDropPerShot,
          ),
        ),
      negativeRate:
        rows.length > 0
          ? rows.filter(
            row =>
              row.absDropPerShot < 0,
          ).length / rows.length
          : null,
    },
  };
}

function modeValue(values) {
  const counts = new Map();

  for (
    const value
    of values.filter(Number.isFinite)
  ) {
    const key =
      Number(value.toFixed(6));

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  if (!counts.size) return null;

  return [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1]
        || a[0] - b[0],
    )[0][0];
}

function median(values) {
  const sorted =
    values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  if (!sorted.length) {
    return null;
  }

  const middle =
    Math.floor(
      sorted.length / 2,
    );

  return sorted.length % 2
    ? sorted[middle]
    : (
      sorted[middle - 1]
      + sorted[middle]
    ) / 2;
}

function print(result) {
  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'WEAPON CLIP INTEGER REPRESENTATION DIAGNOSTIC V0.1',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    'Replay:                              test',
  );
  console.log(
    'Replication cohort consumed:         NO',
  );
  console.log(
    'Transform:                           raw>=0 ? 2*raw : -2*raw-1',
  );
  console.log(
    'Gameplay ammo semantics claimed:      NO',
  );
  console.log('');

  console.log('RAW SIGN STRUCTURE');
  console.log('------------------');
  console.log(
    `clip rows:                           ${result.signPattern.clipRows}`,
  );
  console.log(
    `negative / zero / positive:          ${result.signPattern.negative} / ${result.signPattern.zero} / ${result.signPattern.positive}`,
  );
  console.log(
    `negative rate:                       ${percent(result.signPattern.negativeRate)}`,
  );
  console.log(
    `adjacent sign alternation:           ${result.signPattern.alternatingAdjacent}/${result.signPattern.signComparableAdjacent} (${percent(result.signPattern.alternatingAdjacentRate)})`,
  );
  console.log(
    `raw range:                           [${result.signPattern.rawMin}, ${result.signPattern.rawMax}]`,
  );
  console.log(
    `transformed range:                   [${result.signPattern.transformedMin}, ${result.signPattern.transformedMax}]`,
  );
  console.log('');

  console.log('SHOT-TRANSITION COMPARISON');
  console.log('--------------------------');

  const pooled =
    result.pooledShotTransitions;

  console.log(
    `comparisons:                         ${pooled.observations}`,
  );
  console.log(
    `ZigZag transformed +integer/shot:    ${pooled.transformed.positiveIntegerPerShot}/${pooled.observations} (${percent(pooled.transformed.positiveIntegerPerShotRate)}) mode=${pooled.transformed.mode} median=${pooled.transformed.median}`,
  );
  console.log(
    `raw +integer/shot:                   ${pooled.raw.positiveIntegerPerShot}/${pooled.observations} (${percent(pooled.raw.positiveIntegerPerShotRate)}) mode=${pooled.raw.mode} median=${pooled.raw.median} negative=${percent(pooled.raw.negativeRate)}`,
  );
  console.log(
    `abs(raw) +integer/shot:              ${pooled.absoluteValue.positiveIntegerPerShot}/${pooled.observations} (${percent(pooled.absoluteValue.positiveIntegerPerShotRate)}) mode=${pooled.absoluteValue.mode} median=${pooled.absoluteValue.median} negative=${percent(pooled.absoluteValue.negativeRate)}`,
  );
  console.log('');

  console.log(
    'TRANSFORMED CANDIDATE VS STATIC RESOURCE',
  );
  console.log(
    '----------------------------------------',
  );

  for (
    const hero
    of result.candidateTransform.byHero
  ) {
    console.log(
      `hero=${String(hero.heroId).padEnd(4)} rawCandidate=${JSON.stringify(hero.rawCandidates)} transformed=${JSON.stringify(hero.transformedCandidates)} min=${hero.minTransformedCandidate} shotMode=${hero.modalShotConsumption} staticClip=${hero.staticClipSize} staticAmmoPerShot=${hero.staticAmmoConsumedPerShot} min-static=${hero.minCandidateMinusStatic} (min-shot)-static=${hero.correctedBaseComparison}`,
    );
  }
  console.log('');

  console.log(
    'TRANSFORMED ABOVE-CANDIDATE PHASE',
  );
  console.log(
    '---------------------------------',
  );

  const overshoot =
    result.candidateTransform
      .transformedOvershootPhase;

  console.log(
    `above transformed candidate:          ${overshoot.total}`,
  );
  console.log(
    `before first reload exit:             ${overshoot.beforeFirstReload}`,
  );
  console.log(
    `at/after first reload exit:           ${overshoot.atOrAfterFirstReload}`,
  );
  console.log('');

  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');

  for (
    const [name, row]
    of Object.entries(
      result.integrityValidation.checks,
    )
  ) {
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

function readJson(path) {
  return JSON.parse(
    readFileSync(path, 'utf8'),
  );
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
