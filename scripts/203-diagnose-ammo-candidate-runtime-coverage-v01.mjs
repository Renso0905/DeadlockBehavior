import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import {
  createInterface,
} from 'node:readline';

import {
  dirname,
  resolve,
} from 'node:path';

import {
  buildCandidateUniverse,
  buildContextIndex,
  buildRestorationEvents,
  summarizeRuntimeCoverage,
} from '../src/player-state/ammo-candidate-runtime-coverage.mjs';

const VERSION =
  'AMMO_CANDIDATE_RUNTIME_COVERAGE_V01';

const PATHS = {
  script199:
    resolve(
      'output',
      'test',
      'ammo_restoration_context_discovery_v02.json',
    ),

  script202:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_ammo_mechanism_census_v03.json',
    ),

  substrate:
    resolve(
      'output',
      'test',
      'effective_weapon_state_substrate_v01.json',
    ),

  runtimeEvents:
    resolve(
      'output',
      'test',
      'effective_weapon_runtime_events_v01.jsonl',
    ),

  output:
    resolve(
      'output',
      'test',
      'ammo_candidate_runtime_coverage_v01.json',
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

const script199 =
  JSON.parse(
    readFileSync(
      PATHS.script199,
      'utf8',
    ),
  );

const script202 =
  JSON.parse(
    readFileSync(
      PATHS.script202,
      'utf8',
    ),
  );

const substrate =
  JSON.parse(
    readFileSync(
      PATHS.substrate,
      'utf8',
    ),
  );

const runtimeRows = [];
let jsonlParseFailures = 0;

const reader =
  createInterface({
    input:
      createReadStream(
        PATHS.runtimeEvents,
        { encoding: 'utf8' },
      ),
    crlfDelay: Infinity,
  });

for await (const line of reader) {
  if (!line.trim()) continue;

  try {
    runtimeRows.push(JSON.parse(line));
  } catch {
    jsonlParseFailures++;
  }
}

console.log('');
console.log('========================================================');
console.log('AMMO CANDIDATE RUNTIME COVERAGE V0.1');
console.log('========================================================');
console.log('');
console.log('Candidate universe: Script202 V03 complete 18-item census');
console.log('Runtime exposure: test.dem only');
console.log('Purpose: quantify candidate coverage, NOT causal exclusion');
console.log('Unobserved candidate == OPEN, not falsified');
console.log('Authority promotion: NO');
console.log('');

const candidates =
  buildCandidateUniverse(
    script202,
  );

const contextIndex =
  buildContextIndex(
    substrate,
  );

const restorationEvents =
  buildRestorationEvents(
    script199,
  );

const coverage =
  summarizeRuntimeCoverage({
    candidates,
    contextIndex,
    runtimeRows,
    restorationEvents,
  });

const checks = {
  script199Ready:
    check(
      script199?.status,
      'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION',
      script199?.status
        === 'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION',
    ),

  script202Ready:
    check(
      script202?.status,
      'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03_READY_FOR_INTERPRETATION',
      script202?.status
        === 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03_READY_FOR_INTERPRETATION',
    ),

  candidateUniverseExactly18:
    check(
      candidates.length,
      18,
      candidates.length === 18,
    ),

  restorationEventsExactly8:
    check(
      restorationEvents.length,
      8,
      restorationEvents.length === 8,
    ),

  contextIndexNonEmpty:
    check(
      contextIndex.size,
      '>0',
      contextIndex.size > 0,
    ),

  jsonlParseClean:
    check(
      jsonlParseFailures,
      0,
      jsonlParseFailures === 0,
    ),

  matrixCoversAllCandidates:
    check(
      coverage.rows.length,
      18,
      coverage.rows.length === 18,
    ),

  dispositionsPartitionUniverse:
    check(
      (
        coverage.observedWithRestorationCount
        + coverage.observedNegativeOnlyCount
        + coverage.notObservedCount
      ),
      18,
      (
        coverage.observedWithRestorationCount
        + coverage.observedNegativeOnlyCount
        + coverage.notObservedCount
      ) === 18,
    ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  replay: 'test',

  status:
    integrityPass
      ? 'AMMO_CANDIDATE_RUNTIME_COVERAGE_V01_READY_FOR_INTERPRETATION'
      : 'AMMO_CANDIDATE_RUNTIME_COVERAGE_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    candidateUniverse:
      'Script202 V03 complete 18-item resource candidate universe',

    runtimeReplay:
      'test',

    dispositionSemantics: {
      OBSERVED_WITH_RESTORATION:
        'candidate present in at least one coherent restoration context',
      OBSERVED_NEGATIVE_EXPOSURE_ONLY:
        'candidate had primary-attack exposure but no coherent restoration context; not causal falsification',
      NOT_OBSERVED_IN_TEST:
        'candidate had no primary-attack exposure; remains completely open on runtime evidence',
    },

    causalAttribution:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  telemetry: {
    runtimeRows: runtimeRows.length,
    jsonlParseFailures,
    contextCount: contextIndex.size,
  },

  coverage,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'COVERAGE_DIAGNOSTIC_ONLY',
    authorityPromotion:
      false,
    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    integrityPass
      ? 'INTERPRET_OBSERVED_VS_UNOBSERVED_CANDIDATE_COVERAGE;_DO_NOT_EXCLUDE_UNOBSERVED_ITEMS;_THEN_CHARACTERIZE_RESOURCE_SEMANTICS_FOR_ALL_OPEN_CANDIDATES'
      : 'STOP_AND_DIAGNOSE_CANDIDATE_COVERAGE_JOIN',
};

mkdirSync(
  dirname(PATHS.output),
  { recursive: true },
);

writeFileSync(
  PATHS.output,
  `${JSON.stringify(
    result,
    null,
    2,
  )}\n`,
  'utf8',
);

print(result);

function check(
  actual,
  expected,
  pass,
) {
  return {
    actual,
    expected,
    pass: Boolean(pass),
  };
}

function pct(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  const c =
    result.coverage;

  console.log('COVERAGE SUMMARY');
  console.log('----------------');
  console.log(
    `candidate universe:                  ${c.candidateCount}`,
  );
  console.log(
    `observed with restoration:           ${c.observedWithRestorationCount}`,
  );
  console.log(
    `observed negative exposure only:     ${c.observedNegativeOnlyCount}`,
  );
  console.log(
    `not observed in test:                ${c.notObservedCount}`,
  );
  console.log(
    `runtime-observed coverage:            ${pct(c.observedCoverageRate)}`,
  );
  console.log('');

  console.log('CANDIDATE DISPOSITIONS');
  console.log('----------------------');

  for (const row of c.rows) {
    console.log(
      `${row.recordKey.padEnd(40)} ${row.disposition.padEnd(32)} attacks=${String(row.attackExposure).padEnd(6)} heroes=${JSON.stringify(row.exposedHeroIds)} restor=${row.restorationEventCount} class=${row.resourceClassification}`,
    );

    for (const event of row.restorationEvents) {
      console.log(
        `  restoration hero=${event.heroId} tick=${event.tick} context=${event.effectContextId} net=${event.logicalGain} grossIfShot=${event.grossRestorationIfOneShotConsumed}`,
      );
    }
  }

  console.log('');
  console.log('RESTORATION EVENT CANDIDATE MATRIX');
  console.log('----------------------------------');

  for (const event of c.eventMatrix) {
    console.log(
      `hero=${String(event.heroId).padEnd(4)} tick=${String(event.tick).padEnd(7)} context=${event.effectContextId} net=${event.logicalGain} grossIfShot=${event.grossRestorationIfOneShotConsumed} candidates=${event.candidateCount}`,
    );

    for (const candidate of event.presentCandidates) {
      console.log(
        `  ${candidate.recordKey} (${candidate.resourceClassification})`,
      );
    }
  }

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
      `${name.padEnd(38)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log('CLASSIFICATION');
  console.log('--------------');
  console.log(c.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
