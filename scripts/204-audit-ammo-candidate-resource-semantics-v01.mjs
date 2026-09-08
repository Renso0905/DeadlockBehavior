import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import {
  dirname,
  resolve,
} from 'node:path';

import {
  buildSemanticAudit,
} from '../src/player-state/ammo-candidate-resource-semantics.mjs';

const VERSION =
  'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V01';

const PATHS = {
  script202:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_ammo_mechanism_census_v03.json',
    ),

  script203:
    resolve(
      'output',
      'test',
      'ammo_candidate_runtime_coverage_v01.json',
    ),

  effects:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_item_effect_substrate_v03.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'ammo_candidate_resource_semantics_audit_v01.json',
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

const script202 =
  JSON.parse(
    readFileSync(
      PATHS.script202,
      'utf8',
    ),
  );

const script203 =
  JSON.parse(
    readFileSync(
      PATHS.script203,
      'utf8',
    ),
  );

const effects =
  JSON.parse(
    readFileSync(
      PATHS.effects,
      'utf8',
    ),
  );

console.log('');
console.log('========================================================');
console.log('AMMO CANDIDATE RESOURCE SEMANTICS AUDIT V0.1');
console.log('========================================================');
console.log('');
console.log('Universe: Script202 V03 complete 18 candidates');
console.log('Runtime coverage: Script203 V01 retained as annotation only');
console.log('Goal: separate value-bearing semantics from field-name-only evidence');
console.log('Replay purchase exposure required: NO');
console.log('Runtime causal attribution: NO');
console.log('Authority promotion: NO');
console.log('');

const candidates =
  script203
    ?.coverage
    ?.rows
    ?.map(
      row => ({
        recordKey:
          row.recordKey,
        runtimeItemId:
          row.runtimeItemId,
        resourceClassification:
          row.resourceClassification,
      }),
    )
    ?? [];

const audit =
  buildSemanticAudit({
    candidates,
    effects,
  });

const coverageByKey =
  new Map(
    script203
      ?.coverage
      ?.rows
      ?.map(
        row => [
          row.recordKey,
          row,
        ],
      )
      ?? [],
  );

const rows =
  audit.rows.map(
    row => ({
      ...row,
      runtimeCoverage:
        coverageByKey.get(
          row.recordKey,
        ) ?? null,
    }),
  );

const checks = {
  script202Ready:
    check(
      script202?.status,
      'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03_READY_FOR_INTERPRETATION',
      script202?.status
        === 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03_READY_FOR_INTERPRETATION',
    ),

  script203Ready:
    check(
      script203?.status,
      'AMMO_CANDIDATE_RUNTIME_COVERAGE_V01_READY_FOR_INTERPRETATION',
      script203?.status
        === 'AMMO_CANDIDATE_RUNTIME_COVERAGE_V01_READY_FOR_INTERPRETATION',
    ),

  candidateCountExactly18:
    check(
      audit.candidateCount,
      18,
      audit.candidateCount === 18,
    ),

  allCandidateRecordsFound:
    check(
      audit.missingItemCount,
      0,
      audit.missingItemCount === 0,
    ),

  script139Still156:
    check(
      Array.isArray(effects?.items)
        ? effects.items.length
        : null,
      156,
      Array.isArray(effects?.items)
      && effects.items.length === 156,
    ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),

  status:
    integrityPass
      ? 'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V01_READY_FOR_INTERPRETATION'
      : 'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    candidateUniverse:
      'Script202 V03 18-item resource candidate universe',

    runtimeCoverageAnnotation:
      'Script203 V01',

    purpose:
      'separate actual value-bearing ammo resource semantics from diagnostic field-name-only evidence',

    genericFieldNames:
      'diagnostic-only',

    replayPurchaseExposureRequired:
      false,

    runtimeCausality:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'resource_build_bound',
  },

  audit: {
    ...audit,
    rows,
  },

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'RESOURCE_SEMANTIC_DEPTH_AUDIT_ONLY',
    authorityPromotion:
      false,
    replicationStatus:
      'resource_build_bound',
  },

  nextStep:
    integrityPass
      ? 'USE_SEMANTIC_DEPTH_PLUS_RUNTIME_COVERAGE_TO_DESIGN_TARGETED_CALIBRATION_REPLAYS_FOR_UNOBSERVED_HIGH_PRIORITY_CANDIDATES'
      : 'STOP_AND_DIAGNOSE_SCRIPT139_CANDIDATE_RECORD_JOIN',
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

function print(result) {
  const a =
    result.audit;

  console.log('AUDIT SUMMARY');
  console.log('-------------');
  console.log(
    `candidate count:                     ${a.candidateCount}`,
  );
  console.log(
    `missing Script139 records:           ${a.missingItemCount}`,
  );
  console.log('');

  console.log('BY EVIDENCE DEPTH');
  console.log('-----------------');

  for (const row of a.byDepth) {
    console.log(
      `${row.key.padEnd(40)} ${row.count}`,
    );
  }

  console.log('');
  console.log('CANDIDATE SEMANTIC DEPTH');
  console.log('------------------------');

  for (const row of a.rows) {
    const coverage =
      row.runtimeCoverage;

    console.log(
      `${row.recordKey.padEnd(40)} depth=${row.evidenceDepth.padEnd(34)} runtime=${String(coverage?.disposition ?? 'n/a').padEnd(32)} attacks=${String(coverage?.attackExposure ?? 0).padEnd(6)} restor=${coverage?.restorationEventCount ?? 0}`,
    );

    for (const scalar of row.primaryAmmoRows) {
      console.log(
        `  AMMO ${scalar.path} = ${JSON.stringify(scalar.value)} valueBearing=${scalar.valueBearing} diagnosticOnly=${scalar.diagnosticFieldNameOnly}`,
      );
    }

    for (const scalar of row.triggerContext) {
      console.log(
        `  CTX  ${scalar.path} = ${JSON.stringify(scalar.value)}`,
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
      `${name.padEnd(36)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log('CLASSIFICATION');
  console.log('--------------');
  console.log(a.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
