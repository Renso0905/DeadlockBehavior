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
  classifyBatching,
  coalesceFinalStatePerTick,
  collectHeroStaticEvidence,
  decomposeBatchedCycles,
  deriveTransitions,
  groupByContext,
  normalizeBatchEvent,
  summarizeCycles,
  summarizeGenericVsHero58,
  summarizePartition,
} from '../src/player-state/hero58-clip-batching-diagnostic.mjs';

const VERSION =
  'HERO58_CLIP_BATCHING_DIAGNOSTIC_V01';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script181 is test-only mechanism diagnosis.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 yet.',
    ].join('\n'),
  );
}

const PATHS = {
  script180: resolve(
    'output',
    'test',
    'zero_whole_clip_drop_mechanism_diagnostic_v01.json',
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
  script131: resolve(
    'output',
    'cross_replay',
    'hero_stat_progression_schema_discovery_v01.json',
  ),
  output: resolve(
    'output',
    'test',
    'hero58_clip_batching_diagnostic_v01.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;

  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script180 = readJson(PATHS.script180);
const script165 = readJson(PATHS.script165);
const script131 = readJson(PATHS.script131);

const EXPECTED_180_STATUS =
  'ZERO_WHOLE_CLIP_DROP_MECHANISM_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_180_CLASSIFICATION =
  'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_WEAPON_MECHANIC_STATIC_MAPPING_UNRESOLVED';

const EXPECTED_PARTITION = {
  positive: 30337,
  zero: 7221,
  negative: 13,
  total: 37571,
};

const EXPECTED_HERO58 = {
  observations: 9786,
  zero: 6535,
  zeroRate: 6535 / 9786,
};

const FROZEN_HERO58_RATIO = 3.013;

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
      normalizeBatchEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped = groupByContext(events);

const allTransitions = [];
const hero58Cycles = [];

for (const rows of grouped.values()) {
  const settled = coalesceFinalStatePerTick(rows);
  const transitions = deriveTransitions(settled);

  allTransitions.push(...transitions);

  if (
    transitions.length
    && transitions[0].heroId === 58
  ) {
    hero58Cycles.push(
      ...decomposeBatchedCycles(transitions),
    );
  }
}

const overall = summarizePartition(allTransitions);
const split = summarizeGenericVsHero58(allTransitions);
const cycleSummary = summarizeCycles(
  hero58Cycles,
  FROZEN_HERO58_RATIO,
);

const classification = classifyBatching({
  hero58Partition: split.hero58,
  genericPartition: split.excludingHero58,
  cycleSummary,
});

const staticEvidence = {
  script165:
    collectHeroStaticEvidence(
      script165,
      58,
    ),
  script131:
    collectHeroStaticEvidence(
      script131,
      58,
    ),
};

const checks = {
  script180StatusExpected: check(
    script180?.status,
    EXPECTED_180_STATUS,
    script180?.status === EXPECTED_180_STATUS,
  ),

  script180ClassificationExpected: check(
    script180?.classification,
    EXPECTED_180_CLASSIFICATION,
    script180?.classification
      === EXPECTED_180_CLASSIFICATION,
  ),

  overallPartitionFrozen: check(
    {
      positive: overall.positive,
      zero: overall.zero,
      negative: overall.negative,
      total: overall.total,
    },
    EXPECTED_PARTITION,
    overall.positive === EXPECTED_PARTITION.positive
      && overall.zero === EXPECTED_PARTITION.zero
      && overall.negative === EXPECTED_PARTITION.negative
      && overall.total === EXPECTED_PARTITION.total,
  ),

  hero58BaselineFrozen: check(
    {
      observations: split.hero58.total,
      zero: split.hero58.zero,
    },
    {
      observations: EXPECTED_HERO58.observations,
      zero: EXPECTED_HERO58.zero,
    },
    split.hero58.total === EXPECTED_HERO58.observations
      && split.hero58.zero === EXPECTED_HERO58.zero,
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

  hero58CyclesSubstantial: check(
    hero58Cycles.length,
    '>100',
    hero58Cycles.length > 100,
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
      ? 'HERO58_CLIP_BATCHING_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'HERO58_CLIP_BATCHING_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  replay: replayName,

  frozenBoundary: {
    zigzagTransform:
      'raw >= 0 ? 2*raw : -2*raw - 1',
    overallPartition: EXPECTED_PARTITION,
    hero58Baseline: EXPECTED_HERO58,
    hero58AggregateShotAdvancePerPositiveWholeUnit:
      FROZEN_HERO58_RATIO,
    replicationCohortConsumed: false,
    authorityPromotion: false,
  },

  overall,
  genericVsHero58: split,
  hero58CycleAnalysis: cycleSummary,
  hero58StaticEvidence: staticEvidence,

  classification,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status: 'DIAGNOSTIC_ONLY',
    replicationStatus: 'single_replay_only',
    authorityPromotion: false,
  },

  nextStep:
    classification
      === 'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_UPDATES_IN_BATCHED_MULTI_UNIT_STEPS'
      ? 'FREEZE_GENERIC_CLIP_REPRESENTATION_SCOPE_AND_SOLVE_HERO58_SPECIAL_WEAPON_SEPARATELY_BEFORE_MAGAZINE_CAPACITY_REPLICATION'
      : classification
        === 'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_BATCH_MECHANISM_REQUIRES_DIAGNOSIS'
          ? 'INSPECT_HERO58_STATIC_EVIDENCE_AND_TOP_JOINT_ZERO_RUN_POSITIVE_DROP_PATTERNS_ON_TEST'
          : 'KEEP_CLIP_REPRESENTATION_UNRESOLVED_AND_DIAGNOSE_NON_HERO58_FAILURES',
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

function round3(value) {
  return Number.isFinite(value)
    ? Number(value.toFixed(3))
    : null;
}

function print(result) {
  console.log('');
  console.log('========================================================');
  console.log('HERO58 CLIP BATCHING DIAGNOSTIC V0.1');
  console.log('========================================================');
  console.log('');

  console.log('Replay:                              test');
  console.log('ZigZag transform changed:            NO');
  console.log('Replication cohort consumed:         NO');
  console.log('Authority promotion:                 NO');
  console.log('');

  console.log('GENERIC VS HERO58');
  console.log('-----------------');

  const generic = result.genericVsHero58.excludingHero58;
  const hero58 = result.genericVsHero58.hero58;

  console.log(
    `excluding hero58:                     n=${generic.total} positive=${generic.positive} (${percent(generic.positiveRate)}) zero=${generic.zero} (${percent(generic.zeroRate)}) negative=${generic.negative} (${percent(generic.negativeRate)})`,
  );

  console.log(
    `hero58:                               n=${hero58.total} positive=${hero58.positive} (${percent(hero58.positiveRate)}) zero=${hero58.zero} (${percent(hero58.zeroRate)}) negative=${hero58.negative} (${percent(hero58.negativeRate)}) shots/whole=${round3(hero58.shotAdvancePerPositiveWholeUnit)}`,
  );
  console.log('');

  console.log('HERO58 BATCH CYCLES');
  console.log('-------------------');

  const cycles = result.hero58CycleAnalysis;

  console.log(
    `completed cycles:                      ${cycles.completedCycles}`,
  );
  console.log(
    `positive whole-drop mode/median:       ${cycles.positiveWholeDrop.mode} / ${cycles.positiveWholeDrop.median}`,
  );
  console.log(
    `zero-shot-advance mode/median:         ${cycles.zeroShotAdvance.mode} / ${cycles.zeroShotAdvance.median}`,
  );
  console.log(
    `total-shot-advance mode/median:        ${cycles.totalShotAdvance.mode} / ${cycles.totalShotAdvance.median}`,
  );
  console.log(
    `cycle shots/whole median/mean:         ${round3(cycles.shotAdvancePerWholeUnit.median)} / ${round3(cycles.shotAdvancePerWholeUnit.mean)}`,
  );
  console.log(
    `batched positive drops >1:             ${cycles.batchedPositiveDrops}/${cycles.completedCycles} (${percent(cycles.batchedPositiveDropRate)})`,
  );
  console.log(
    `cycles within ±0.25 of ratio 3.013:    ${cycles.closeToFrozenAggregateRatio}/${cycles.completedCycles} (${percent(cycles.closeToFrozenAggregateRatioRate)})`,
  );
  console.log('');

  console.log('TOP HERO58 ZERO-RUN / POSITIVE-DROP PATTERNS');
  console.log('--------------------------------------------');

  for (const row of cycles.topJointPatterns) {
    console.log(
      `zeroShots=${String(row.zeroShotAdvance).padEnd(4)} positiveDrop=${String(row.positiveWholeDrop).padEnd(4)} count=${String(row.count).padEnd(5)} impliedRatio=${round3(row.impliedRatio)}`,
    );
  }

  console.log('');
  console.log('HERO58 STATIC EVIDENCE');
  console.log('----------------------');
  console.log('Script165:');

  for (const row of result.hero58StaticEvidence.script165) {
    console.log(
      `  ${row.path} = ${JSON.stringify(row.value)}`,
    );
  }

  console.log('Script131:');

  for (const row of result.hero58StaticEvidence.script131) {
    console.log(
      `  ${row.path} = ${JSON.stringify(row.value)}`,
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
