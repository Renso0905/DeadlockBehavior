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
  summarizeFractionCoherenceV02,
} from '../src/player-state/ammo-fraction-coherence-diagnostic-v02.mjs';

const VERSION =
  'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V02';

const PATHS = {
  script197:
    resolve(
      'output',
      'test',
      'phase_corrected_ammo_residual_audit_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'ammo_fraction_coherence_diagnostic_v02.json',
    ),
};

if (!existsSync(PATHS.script197)) {
  throw new Error(
    `Missing Script197 audit:\n${PATHS.script197}`,
  );
}

const script197 =
  JSON.parse(
    readFileSync(
      PATHS.script197,
      'utf8',
    ),
  );

const exactRows =
  script197
    ?.audit
    ?.exactRows;

if (!Array.isArray(exactRows)) {
  throw new Error(
    'Script197 audit.exactRows missing.',
  );
}

console.log('');
console.log('========================================================');
console.log('AMMO FRACTION COHERENCE DIAGNOSTIC V0.2');
console.log('========================================================');
console.log('');
console.log('Scientific question unchanged from V01');
console.log('Self-consistency guards: REQUIRED');
console.log('Float32 capacity tolerance: 1e-4');
console.log('Authority promotion: NO');
console.log('');

const diagnostic =
  summarizeFractionCoherenceV02(
    exactRows,
  );

const checks = {
  script197Ready:
    check(
      script197?.status,
      'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_READY_FOR_INTERPRETATION',
      script197?.status
        === 'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_READY_FOR_INTERPRETATION',
    ),

  exactResidualCountFrozen:
    check(
      exactRows.length,
      20,
      exactRows.length === 20,
    ),

  zeroCountFrozen:
    check(
      diagnostic.zero.total,
      12,
      diagnostic.zero.total === 12,
    ),

  negativeCountFrozen:
    check(
      diagnostic.negative.total,
      8,
      diagnostic.negative.total === 8,
    ),

  selfConsistencyClean:
    check(
      diagnostic.zero.inconsistent,
      0,
      diagnostic.zero.inconsistent === 0,
    ),

  fingerprintHero31Capacity:
    fingerprintCapacity(
      diagnostic.zero.rows,
      31,
      5806,
      29,
    ),

  fingerprintHero25ZeroStep:
    fingerprintStep(
      diagnostic.zero.rows,
      25,
      174961,
      0,
    ),

  fingerprintWardenGainCapacity:
    fingerprintNegativeCapacity(
      diagnostic.negative.rows,
      25,
      85449,
      37,
    ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const result = {
  version:
    VERSION,
  canonical:
    false,
  createdAt:
    new Date().toISOString(),
  replay:
    'test',

  status:
    integrityPass
      ? 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V02_READY_FOR_INTERPRETATION'
      : 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V02_INTEGRITY_FAILURE',

  scientificBoundary: {
    successorReason:
      'V01 pasted output contained impossible numeric/signature mismatch',
    scientificQuestionChanged:
      false,
    selfConsistencyRequired:
      true,
    authorityPromotion:
      false,
    replicationStatus:
      'discovery_calibration_only',
  },

  diagnostic,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'DESCRIPTIVE_DIAGNOSTIC_ONLY',
    authorityPromotion:
      false,
    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    integrityPass
    && diagnostic.classification
      === 'FRACTION_ROLLBACK_AND_COHERENT_RESTORATION_PARTITION_SELF_CONSISTENT_V02'
      ? 'PROCEED_TO_RESTORATION_CONTEXT_ATTRIBUTION;_DO_NOT_USE_V01_COUNTS_AS_AUTHORITY'
      : 'STOP_AND_DIAGNOSE_V02_INTEGRITY_OR_SEMANTIC_FAILURE',
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

function fingerprintCapacity(
  rows,
  heroId,
  tick,
  expected,
) {
  const row =
    rows.find(
      candidate =>
        Number(candidate.heroId) === heroId
        && Number(candidate.tick) === tick,
    );

  return check(
    row?.capacity ?? null,
    expected,
    row?.capacity === expected,
  );
}

function fingerprintStep(
  rows,
  heroId,
  tick,
  expected,
) {
  const row =
    rows.find(
      candidate =>
        Number(candidate.heroId) === heroId
        && Number(candidate.tick) === tick,
    );

  const actual =
    row?.stepUnits;

  return check(
    actual,
    expected,
    Number.isFinite(actual)
      && Math.abs(actual - expected) <= 1e-4
      && row?.oneUnitStep === false
      && row?.signature === 'ZERO_RESIDUAL_OTHER',
  );
}

function fingerprintNegativeCapacity(
  rows,
  heroId,
  tick,
  expected,
) {
  const row =
    rows.find(
      candidate =>
        Number(candidate.heroId) === heroId
        && Number(candidate.tick) === tick,
    );

  return check(
    row?.previousCapacity ?? null,
    expected,
    row?.previousCapacity === expected,
  );
}

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

function percent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  const d = result.diagnostic;

  console.log('ZERO RESIDUALS');
  console.log('--------------');
  console.log(
    `total:                               ${d.zero.total}`,
  );
  console.log(
    `one-unit fraction prediction:        ${d.zero.oneUnit} (${percent(d.zero.oneUnitRate)})`,
  );
  console.log(
    `immediate rollback:                  ${d.zero.rollback} (${percent(d.zero.rollbackRate)})`,
  );
  console.log(
    `self-consistency failures:           ${d.zero.inconsistent}`,
  );
  console.log('');

  for (const row of d.zero.rows) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} cap=${String(row.capacity).padEnd(4)} step=${Number.isFinite(row.stepUnits) ? row.stepUnits.toFixed(6) : 'n/a'} oneUnit=${String(row.oneUnitStep).padEnd(5)} rollback=${String(row.rollback).padEnd(5)} ${row.signature}`,
    );
  }

  console.log('');
  console.log('NEGATIVE / AMMO-GAIN RESIDUALS');
  console.log('------------------------------');
  console.log(
    `total:                               ${d.negative.total}`,
  );
  console.log(
    `coherent whole+fraction gain:        ${d.negative.coherent} (${percent(d.negative.coherentRate)})`,
  );
  console.log('');

  for (const row of d.negative.rows) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} prevCap=${String(row.previousCapacity).padEnd(4)} currCap=${String(row.currentCapacity).padEnd(4)} netGain=${String(row.logicalGain).padEnd(4)} fracGain=${Number.isFinite(row.fractionGainUnits) ? row.fractionGainUnits.toFixed(6) : 'n/a'} coherent=${String(row.coherentGain).padEnd(5)} grossIfShot=${String(row.grossRestorationIfOneShotConsumed)}`,
    );
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
      `${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log('CLASSIFICATION');
  console.log('--------------');
  console.log(
    d.classification,
  );
  console.log('');
  console.log(
    `status: ${result.status}`,
  );
  console.log(
    `NEXT STAGE: ${result.nextStep}`,
  );
  console.log('');
  console.log(
    `JSON:\n${PATHS.output}`,
  );
}
