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
  FRACTION_TOLERANCE_V03,
  summarizeFractionCoherenceV03,
} from '../src/player-state/ammo-fraction-coherence-diagnostic-v03.mjs';

const VERSION =
  'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V03';

const PATHS = {
  script197:
    resolve(
      'output',
      'test',
      'phase_corrected_ammo_residual_audit_v01.json',
    ),

  script198v02:
    resolve(
      'output',
      'test',
      'ammo_fraction_coherence_diagnostic_v02.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'ammo_fraction_coherence_diagnostic_v03.json',
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

const script197 =
  JSON.parse(
    readFileSync(
      PATHS.script197,
      'utf8',
    ),
  );

const script198v02 =
  JSON.parse(
    readFileSync(
      PATHS.script198v02,
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
console.log(
  '========================================================',
);
console.log(
  'AMMO FRACTION COHERENCE DIAGNOSTIC V0.3',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Scientific question unchanged from V01/V02',
);
console.log(
  'V02 failure cause: Array.map index leaked into tolerance parameter',
);
console.log(
  `Frozen tolerance: ${FRACTION_TOLERANCE_V03}`,
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const diagnostic =
  summarizeFractionCoherenceV03(
    exactRows,
  );

const zero5806 =
  findRow(
    diagnostic.zero.rows,
    31,
    5806,
  );

const zero174961 =
  findRow(
    diagnostic.zero.rows,
    25,
    174961,
  );

const gain85449 =
  findRow(
    diagnostic.negative.rows,
    25,
    85449,
  );

const checks = {
  script197Ready:
    check(
      script197?.status,
      'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_READY_FOR_INTERPRETATION',
      script197?.status
        === 'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_READY_FOR_INTERPRETATION',
    ),

  script198V02IntegrityFailurePreserved:
    check(
      script198v02?.status,
      'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V02_INTEGRITY_FAILURE',
      script198v02?.status
        === 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V02_INTEGRITY_FAILURE',
    ),

  exactResidualCountFrozen:
    check(
      exactRows.length,
      20,
      exactRows.length === 20,
    ),

  callbackToleranceNotLeaked:
    check(
      diagnostic
        ?.callbackIntegrity
        ?.toleranceLeakCount,
      0,
      diagnostic
        ?.callbackIntegrity
        ?.toleranceLeakCount === 0
      && diagnostic
        ?.callbackIntegrity
        ?.observedTolerances
        ?.length === 1
      && diagnostic
        ?.callbackIntegrity
        ?.observedTolerances?.[0]
          === FRACTION_TOLERANCE_V03,
    ),

  zeroSelfConsistencyClean:
    check(
      diagnostic.zero.inconsistent,
      0,
      diagnostic.zero.inconsistent === 0,
    ),

  hero31Tick5806Capacity:
    check(
      zero5806?.capacity ?? null,
      29,
      zero5806?.capacity === 29,
    ),

  hero31Tick5806OneUnit:
    check(
      zero5806?.oneUnitStep ?? null,
      true,
      zero5806?.oneUnitStep === true,
    ),

  wardenTick174961ZeroOther:
    check(
      {
        capacity:
          zero174961?.capacity ?? null,
        stepUnits:
          zero174961?.stepUnits ?? null,
        oneUnitStep:
          zero174961?.oneUnitStep ?? null,
        signature:
          zero174961?.signature ?? null,
      },
      {
        capacity: 43,
        stepUnits: 0,
        oneUnitStep: false,
        signature: 'ZERO_RESIDUAL_OTHER',
      },
      zero174961?.capacity === 43
      && Number(zero174961?.stepUnits) === 0
      && zero174961?.oneUnitStep === false
      && zero174961?.signature
        === 'ZERO_RESIDUAL_OTHER',
    ),

  wardenTick85449Capacity:
    check(
      {
        previous:
          gain85449?.previousCapacity ?? null,
        current:
          gain85449?.currentCapacity ?? null,
      },
      {
        previous: 37,
        current: 37,
      },
      gain85449?.previousCapacity === 37
      && gain85449?.currentCapacity === 37,
    ),

  wardenTick85449Coherent:
    check(
      gain85449?.coherentGain ?? null,
      true,
      gain85449?.coherentGain === true,
    ),

  testReplayOnly:
    check(
      script197?.replay,
      'test',
      script197?.replay === 'test',
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
      ? 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V03_READY_FOR_INTERPRETATION'
      : 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V03_INTEGRITY_FAILURE',

  scientificBoundary: {
    successorReason:
      'V02 Array.map callback index overwrote tolerance parameter',
    scientificQuestionChanged:
      false,
    frozenTolerance:
      FRACTION_TOLERANCE_V03,
    explicitUnaryMapCallbacks:
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
      === 'FRACTION_ROLLBACK_AND_COHERENT_RESTORATION_PARTITION_SELF_CONSISTENT_V03'
      ? 'USE_V03_AS_CURRENT_FRACTION_COHERENCE_DIAGNOSTIC;_UPDATE_RESTORATION_CONTEXT_DISCOVERY_TO_CONSUME_V03_COHERENT_EVENTS'
      : 'STOP_AND_DIAGNOSE_V03_FAILURE',
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

function findRow(rows, heroId, tick) {
  return rows.find(
    row =>
      Number(row.heroId) === heroId
      && Number(row.tick) === tick,
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
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} cap=${String(row.capacity).padEnd(4)} step=${Number.isFinite(row.stepUnits) ? row.stepUnits.toFixed(6) : 'n/a'} tol=${row.selfConsistency.tolerance} oneUnit=${String(row.oneUnitStep).padEnd(5)} rollback=${String(row.rollback).padEnd(5)} ${row.signature}`,
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
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} prevCap=${String(row.previousCapacity).padEnd(4)} currCap=${String(row.currentCapacity).padEnd(4)} netGain=${String(row.logicalGain).padEnd(4)} fracGain=${Number.isFinite(row.fractionGainUnits) ? row.fractionGainUnits.toFixed(6) : 'n/a'} tol=${row.selfConsistency.tolerance} coherent=${String(row.coherentGain).padEnd(5)} grossIfShot=${String(row.grossRestorationIfOneShotConsumed)}`,
    );
  }

  console.log('');
  console.log('GROSS RESTORATION CANDIDATES');
  console.log('----------------------------');

  for (
    const row
    of d.negative.grossRestorationCandidates
  ) {
    console.log(
      `gross=${row.key.padEnd(4)} count=${row.count}`,
    );
  }

  console.log('');
  console.log('CALLBACK INTEGRITY');
  console.log('------------------');
  console.log(
    `expected tolerance:                  ${d.callbackIntegrity.expectedTolerance}`,
  );
  console.log(
    `tolerance leaks:                     ${d.callbackIntegrity.toleranceLeakCount}`,
  );
  console.log(
    `observed tolerances:                 ${JSON.stringify(d.callbackIntegrity.observedTolerances)}`,
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
      `${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
