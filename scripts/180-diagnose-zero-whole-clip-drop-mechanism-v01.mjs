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
  attachStaticProfiles,
  classifyZeroDropPattern,
  coalesceFinalStatePerTick,
  deriveShotTransitions,
  extractStaticMultiElementProfiles,
  groupByContext,
  normalizeZeroDropEvent,
  summarizeZeroDropMechanism,
} from '../src/player-state/zero-whole-clip-mechanism.mjs';

const VERSION =
  'ZERO_WHOLE_CLIP_DROP_MECHANISM_DIAGNOSTIC_V01';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script180 is test-only mechanism diagnosis.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 yet.',
    ].join('\n'),
  );
}

const PATHS = {
  script179: resolve(
    'output',
    'test',
    'weapon_clip_fractional_consumption_diagnostic_v02.json',
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
    'zero_whole_clip_drop_mechanism_diagnostic_v01.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script179 = readJson(PATHS.script179);
const script165 = readJson(PATHS.script165);

const EXPECTED_179_STATUS =
  'WEAPON_CLIP_FRACTIONAL_CONSUMPTION_DIAGNOSTIC_V02_READY_FOR_INTERPRETATION';

const EXPECTED_179_CLASSIFICATION =
  'AMMO_FRACTION_DOES_NOT_RESOLVE_ZERO_INTEGER_CLIP_SHOTS';

const EXPECTED_PARTITION = {
  positive: 30337,
  zero: 7221,
  negative: 13,
  total: 37571,
};

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
      normalizeZeroDropEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped = groupByContext(events);
const transitions = [];

for (const rows of grouped.values()) {
  const settled = coalesceFinalStatePerTick(rows);
  transitions.push(...deriveShotTransitions(settled));
}

const summary = summarizeZeroDropMechanism(transitions);
const staticProfiles = extractStaticMultiElementProfiles(script165);
const byHeroModeWithStatic = attachStaticProfiles(summary, staticProfiles);
const classification = classifyZeroDropPattern(
  summary,
  byHeroModeWithStatic,
);

const top = byHeroModeWithStatic[0] ?? null;

const checks = {
  script179V02Ready: check(
    script179?.status,
    EXPECTED_179_STATUS,
    script179?.status === EXPECTED_179_STATUS,
  ),

  script179ClassificationExpected: check(
    script179?.classification,
    EXPECTED_179_CLASSIFICATION,
    script179?.classification === EXPECTED_179_CLASSIFICATION,
  ),

  script179PartitionFrozen: check(
    {
      positive: script179?.pooled?.whole?.positive,
      zero: script179?.pooled?.whole?.zero,
      negative: script179?.pooled?.whole?.negative,
      total: script179?.pooled?.observations,
    },
    EXPECTED_PARTITION,
    script179?.pooled?.whole?.positive === EXPECTED_PARTITION.positive
      && script179?.pooled?.whole?.zero === EXPECTED_PARTITION.zero
      && script179?.pooled?.whole?.negative === EXPECTED_PARTITION.negative
      && script179?.pooled?.observations === EXPECTED_PARTITION.total,
  ),

  transitionPartitionReproduced: check(
    {
      positive: summary.positive,
      zero: summary.zero,
      negative: summary.negative,
      total: summary.observations,
    },
    EXPECTED_PARTITION,
    summary.positive === EXPECTED_PARTITION.positive
      && summary.zero === EXPECTED_PARTITION.zero
      && summary.negative === EXPECTED_PARTITION.negative
      && summary.observations === EXPECTED_PARTITION.total,
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

  staticProfilesSubstantial: check(
    staticProfiles.size,
    '>=42',
    staticProfiles.size >= 42,
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
      ? 'ZERO_WHOLE_CLIP_DROP_MECHANISM_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'ZERO_WHOLE_CLIP_DROP_MECHANISM_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  replay: replayName,

  frozenBoundary: {
    wholeTransform:
      'raw >= 0 ? 2*raw : -2*raw - 1',
    fractionalExplanationRejectedBy:
      'Script179 V02',
    signPartition: EXPECTED_PARTITION,
    replicationCohortConsumed: false,
    gameplaySemanticPromotion: false,
  },

  aggregate: {
    observations: summary.observations,
    positive: summary.positive,
    zero: summary.zero,
    negative: summary.negative,
    topZeroShare: summary.topZeroShare,
    zeroSignalProvenance: summary.zeroSignalProvenance,
  },

  byHeroMode: byHeroModeWithStatic,
  topZeroGroup: top,
  classification,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status: 'DIAGNOSTIC_ONLY_NOT_AUTHORITY_PROMOTION',
    replicationStatus: 'single_replay_only',
  },

  nextStep:
    classification
      === 'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_MULTI_ELEMENT_SHOT_MECHANIC'
      ? 'SEPARATE_SHOTNUMBER_SUBELEMENT_COUNT_FROM_AMMO_CONSUMING_ATTACK_UNIT_ON_TEST_THEN_REEVALUATE_CLIP_COUNTER'
      : classification
        === 'ZERO_WHOLE_DROPS_DOMINATED_BY_HERO_SPECIFIC_WEAPON_MECHANIC_STATIC_MAPPING_UNRESOLVED'
          ? 'DIAGNOSE_TOP_HERO_WEAPON_SHOTNUMBER_PERIODICITY_AGAINST_STATIC_PRIMARY_WEAPON_FIELDS_ON_TEST'
          : 'CLASSIFY_ZERO_DROP_TRANSITIONS_BY_SIGNAL_PROVENANCE_AND_CONTEXT_ON_TEST_ONLY',
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
  console.log('ZERO-WHOLE CLIP-DROP MECHANISM DIAGNOSTIC V0.1');
  console.log('========================================================');
  console.log('');

  console.log('Replay:                              test');
  console.log('Script179 integrity corrected:       V02');
  console.log('Fractional ammo explanation:         REJECTED');
  console.log('Replication cohort consumed:         NO');
  console.log('');

  console.log('FROZEN TRANSITION PARTITION');
  console.log('---------------------------');
  console.log(
    `positive / zero / negative:           ${result.aggregate.positive} / ${result.aggregate.zero} / ${result.aggregate.negative}`,
  );
  console.log(
    `total:                                ${result.aggregate.observations}`,
  );
  console.log('');

  console.log('ZERO-DROP SIGNAL PROVENANCE');
  console.log('---------------------------');
  console.log(
    `shotNumber + lastAttack:              ${result.aggregate.zeroSignalProvenance.shotNumberAndLastAttack} (${percent(result.aggregate.zeroSignalProvenance.shotNumberAndLastAttackRate)})`,
  );
  console.log(
    `shotNumber only:                      ${result.aggregate.zeroSignalProvenance.shotNumberOnly} (${percent(result.aggregate.zeroSignalProvenance.shotNumberOnlyRate)})`,
  );
  console.log('');

  console.log('BY HERO / FIRE MODE');
  console.log('-------------------');

  for (const row of result.byHeroMode) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} mode=${String(row.activeFireMode).padEnd(3)} n=${String(row.observations).padEnd(6)} zero=${String(row.zero).padEnd(6)} zeroRate=${percent(row.zeroRate).padEnd(7)} zeroShare=${result.aggregate.zero > 0 ? percent(row.zero / result.aggregate.zero).padEnd(7) : 'n/a'.padEnd(7)} lastAttack=${percent(row.zeroLastAttackConfirmedRate).padEnd(7)} shots/whole=${String(round3(row.shotAdvancePerPositiveWholeUnit)).padEnd(7)} zeroRunMode=${String(row.zeroRunLengths.mode).padEnd(5)} staticBullets=${String(row.static?.bullets).padEnd(5)} staticBurst=${String(row.static?.burstShotCount).padEnd(5)} staticAmmo=${String(row.static?.ammoConsumedPerShot).padEnd(5)} closest=${JSON.stringify(row.closestStaticMultiplicity)}`,
    );
  }

  console.log('');
  console.log('TOP ZERO-DROP GROUP');
  console.log('-------------------');

  if (result.topZeroGroup) {
    console.log(
      `hero/mode:                           ${result.topZeroGroup.heroId}/${result.topZeroGroup.activeFireMode}`,
    );
    console.log(
      `share of all zero drops:              ${percent(result.aggregate.topZeroShare)}`,
    );
    console.log(
      `within-group zero rate:               ${percent(result.topZeroGroup.zeroRate)}`,
    );
    console.log(
      `shot advances / positive whole unit:  ${round3(result.topZeroGroup.shotAdvancePerPositiveWholeUnit)}`,
    );
    console.log(
      `zero-run mode / median:               ${result.topZeroGroup.zeroRunLengths.mode} / ${result.topZeroGroup.zeroRunLengths.median}`,
    );
    console.log(
      `static m_iBullets:                    ${result.topZeroGroup.static?.bullets ?? null}`,
    );
    console.log(
      `static m_iBurstShotCount:             ${result.topZeroGroup.static?.burstShotCount ?? null}`,
    );
    console.log(
      `static m_iAmmoConsumedPerShot:        ${result.topZeroGroup.static?.ammoConsumedPerShot ?? null}`,
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

function round3(value) {
  return Number.isFinite(value)
    ? Number(value.toFixed(3))
    : null;
}
