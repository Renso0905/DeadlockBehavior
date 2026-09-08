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
  compareMutationVsSettled,
  diagnoseSettledShotTransitions,
  groupByContext,
  normalizeSettlementEvent,
  summarizePhaseRows,
} from '../src/player-state/clip-tick-settlement-diagnostic.mjs';

const VERSION =
  'WEAPON_CLIP_TICK_SETTLEMENT_DIAGNOSTIC_V01';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script178 is test-only representation diagnosis.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 yet.',
    ].join('\n'),
  );
}

const PATHS = {
  script177: resolve(
    'output',
    'test',
    'weapon_clip_integer_representation_diagnostic_v01.json',
  ),
  script161Events: resolve(
    'output',
    'test',
    'effective_weapon_runtime_events_v01.jsonl',
  ),
  output: resolve(
    'output',
    'test',
    'weapon_clip_tick_settlement_diagnostic_v01.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script177 = readJson(PATHS.script177);

const EXPECTED_177_STATUS =
  'WEAPON_CLIP_INTEGER_REPRESENTATION_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_177_CLASSIFICATION =
  'CLIP_INTEGER_REPRESENTATION_REMAINS_UNRESOLVED';

const EXPECTED_MUTATION_COMPARABLE = 37571;
const EXPECTED_MUTATION_ALIGNED = 30335;

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
      normalizeSettlementEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped = groupByContext(events);

const settledByContext = new Map();
const allPhaseRows = [];
const allTransitionRows = [];

for (const [key, rows] of grouped) {
  const {
    settled,
    phaseRows,
  } = coalesceFinalStatePerTick(rows);

  settledByContext.set(key, settled);
  allPhaseRows.push(...phaseRows);

  const transition =
    diagnoseSettledShotTransitions(settled);

  allTransitionRows.push(...transition.rows);
}

const settledSummary =
  summarizeSettledRows(allTransitionRows);

const phaseSummary =
  summarizePhaseRows(allPhaseRows);

const comparison =
  compareMutationVsSettled(
    script177,
    settledSummary,
  );

const thresholds = {
  minSettledShotTransitions: 5000,
  minTransformedPositiveIntegerPerShotRate: 0.95,
  minAdvantageOverRawRate: 0.25,
};

const transformedStrong =
  settledSummary.observations
    >= thresholds.minSettledShotTransitions
  && settledSummary.transformed
    .positiveIntegerPerShotRate
    >= thresholds
      .minTransformedPositiveIntegerPerShotRate;

const transformedDominatesRaw =
  (
    settledSummary.transformed
      .positiveIntegerPerShotRate
    - settledSummary.raw
      .positiveIntegerPerShotRate
  ) >= thresholds
    .minAdvantageOverRawRate;

const classification =
  transformedStrong
  && transformedDominatesRaw
    ? 'TICK_SETTLED_ZIGZAG_CLIP_COUNTER_STRONGLY_SUPPORTED'
    : 'TICK_SETTLEMENT_DOES_NOT_FULLY_RESOLVE_CLIP_REPRESENTATION';

const checks = {
  script177StatusExpected: check(
    script177?.status,
    EXPECTED_177_STATUS,
    script177?.status === EXPECTED_177_STATUS,
  ),

  script177ClassificationExpected: check(
    script177?.classification,
    EXPECTED_177_CLASSIFICATION,
    script177?.classification === EXPECTED_177_CLASSIFICATION,
  ),

  script177MutationBaselineFrozen: check(
    {
      aligned:
        script177?.pooledShotTransitions
          ?.transformed?.positiveIntegerPerShot,
      comparable:
        script177?.pooledShotTransitions?.observations,
    },
    {
      aligned: EXPECTED_MUTATION_ALIGNED,
      comparable: EXPECTED_MUTATION_COMPARABLE,
    },
    script177?.pooledShotTransitions
      ?.transformed?.positiveIntegerPerShot
      === EXPECTED_MUTATION_ALIGNED
    && script177?.pooledShotTransitions?.observations
      === EXPECTED_MUTATION_COMPARABLE,
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

  contextCountSubstantial: check(
    grouped.size,
    '>100',
    grouped.size > 100,
  ),

  settledShotTransitionsSubstantial: check(
    settledSummary.observations,
    '>5000',
    settledSummary.observations > 5000,
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
      ? 'WEAPON_CLIP_TICK_SETTLEMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'WEAPON_CLIP_TICK_SETTLEMENT_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  replay: replayName,

  frozenHypothesis: {
    representationTransform:
      'raw >= 0 ? 2*raw : -2*raw - 1',
    Script177ThresholdRetuned: false,
    changedSamplingUnitOnly:
      'final weapon state per context per replay tick',
    rationale:
      'Intermediate Script161 mutations may serialize m_iClip and m_nShotNumber on different rows within the same replay tick.',
    thresholds,
  },

  mutationPhase: phaseSummary,

  tickSettledShotTransitions:
    settledSummary,

  mutationVsTickSettled: comparison,

  classification,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      classification
        === 'TICK_SETTLED_ZIGZAG_CLIP_COUNTER_STRONGLY_SUPPORTED'
        ? 'REPRESENTATION_TRANSFORM_SUPPORTED_AFTER_TICK_SETTLEMENT_SINGLE_REPLAY'
        : 'NOT_ESTABLISHED',
    replicationStatus: 'single_replay_only',
    authorityPromotion: false,
  },

  nextStep:
    classification
      === 'TICK_SETTLED_ZIGZAG_CLIP_COUNTER_STRONGLY_SUPPORTED'
      ? 'FREEZE_TICK_SETTLED_TRANSFORM_THEN_DIAGNOSE_ZERO_POINT_AND_RELOAD_CAPACITY_OFFSET_ON_TEST'
      : 'CLASSIFY_REMAINING_SETTLED_TRANSITION_FAILURES_BY_RELOAD_EFFECT_CONTEXT_AND_SHOT_NUMBER_BEHAVIOR_ON_TEST_ONLY',
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

function summarizeSettledRows(rows) {
  const positiveInteger = (key) =>
    rows.filter(row => row[key] === true).length;

  const representation = (
    valueKey,
    flagKey,
  ) => {
    const values = rows
      .map(row => row[valueKey])
      .filter(Number.isFinite);

    const aligned = positiveInteger(flagKey);

    return {
      positiveIntegerPerShot: aligned,
      positiveIntegerPerShotRate:
        rows.length > 0 ? aligned / rows.length : null,
      mode: mode(values),
      median: median(values),
      negativeRate:
        rows.length > 0
          ? rows.filter(row => row[valueKey] < 0).length
            / rows.length
          : null,
      zeroRate:
        rows.length > 0
          ? rows.filter(row => row[valueKey] === 0).length
            / rows.length
          : null,
    };
  };

  return {
    observations: rows.length,
    transformed: representation(
      'transformedDropPerShot',
      'transformedPositiveIntegerPerShot',
    ),
    raw: representation(
      'rawDropPerShot',
      'rawPositiveIntegerPerShot',
    ),
    absoluteValue: representation(
      'absDropPerShot',
      'absPositiveIntegerPerShot',
    ),
  };
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
  console.log('WEAPON CLIP TICK SETTLEMENT DIAGNOSTIC V0.1');
  console.log('========================================================');
  console.log('');

  console.log('Replay:                              test');
  console.log('Representation transform changed:    NO');
  console.log('Thresholds retuned:                  NO');
  console.log('Sampling change:                     FINAL STATE PER TICK');
  console.log('Replication cohort consumed:         NO');
  console.log('');

  console.log('WITHIN-TICK MUTATION PHASE');
  console.log('--------------------------');
  console.log(
    `ticks observed:                       ${result.mutationPhase.ticks}`,
  );
  console.log(
    `multi-mutation ticks:                 ${result.mutationPhase.multiMutationTicks}`,
  );
  console.log(
    `clip+shot changed same tick:          ${result.mutationPhase.bothFieldsChangedTicks}`,
  );
  console.log(
    `split across different mutation rows: ${result.mutationPhase.splitFieldMutationTicks} (${percent(result.mutationPhase.splitAmongBothRate)})`,
  );
  console.log(
    `any non-atomic clip/shot phase:        ${percent(result.mutationPhase.anyNonAtomicAmongBothRate)}`,
  );
  console.log('');

  console.log('MUTATION VS TICK-SETTLED');
  console.log('------------------------');
  console.log(
    `mutation transformed:                 ${result.mutationVsTickSettled.mutationLevel.aligned}/${result.mutationVsTickSettled.mutationLevel.comparable} (${percent(result.mutationVsTickSettled.mutationLevel.rate)})`,
  );
  console.log(
    `tick-settled transformed:             ${result.mutationVsTickSettled.tickSettled.aligned}/${result.mutationVsTickSettled.tickSettled.comparable} (${percent(result.mutationVsTickSettled.tickSettled.rate)})`,
  );
  console.log(
    `alignment change:                     ${percent(result.mutationVsTickSettled.rateDelta)}`,
  );
  console.log('');

  console.log('TICK-SETTLED REPRESENTATION COMPARISON');
  console.log('--------------------------------------');

  const settled = result.tickSettledShotTransitions;

  console.log(
    `comparisons:                          ${settled.observations}`,
  );
  console.log(
    `ZigZag +integer/shot:                 ${settled.transformed.positiveIntegerPerShot}/${settled.observations} (${percent(settled.transformed.positiveIntegerPerShotRate)}) mode=${settled.transformed.mode} median=${settled.transformed.median} negative=${percent(settled.transformed.negativeRate)} zero=${percent(settled.transformed.zeroRate)}`,
  );
  console.log(
    `raw +integer/shot:                    ${settled.raw.positiveIntegerPerShot}/${settled.observations} (${percent(settled.raw.positiveIntegerPerShotRate)}) mode=${settled.raw.mode} median=${settled.raw.median}`,
  );
  console.log(
    `abs(raw) +integer/shot:               ${settled.absoluteValue.positiveIntegerPerShot}/${settled.observations} (${percent(settled.absoluteValue.positiveIntegerPerShotRate)}) mode=${settled.absoluteValue.mode} median=${settled.absoluteValue.median}`,
  );
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
