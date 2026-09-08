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
  summarizeFractionCoherence,
} from '../src/player-state/ammo-fraction-coherence-diagnostic.mjs';

const VERSION =
  'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V01';

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
      'ammo_fraction_coherence_diagnostic_v01.json',
    ),
};

if (
  !existsSync(
    PATHS.script197,
  )
) {
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

const EXPECTED_197_STATUS =
  'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_READY_FOR_INTERPRETATION';

console.log('');
console.log(
  '========================================================',
);
console.log(
  'AMMO FRACTION COHERENCE DIAGNOSTIC V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Input: Script197 exact 20-row audit',
);
console.log(
  'Replay parse: NO',
);
console.log(
  'New mechanic attribution: NO',
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const exactRows =
  script197
    ?.audit
    ?.exactRows;

if (
  !Array.isArray(exactRows)
) {
  throw new Error(
    'Script197 audit.exactRows is missing.',
  );
}

const diagnostic =
  summarizeFractionCoherence(
    exactRows,
  );

const checks = {
  script197Ready:
    check(
      script197?.status,
      EXPECTED_197_STATUS,
      script197?.status
        === EXPECTED_197_STATUS,
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

  testReplayOnly:
    check(
      script197?.replay,
      'test',
      script197?.replay === 'test',
    ),
};

const integrityPass =
  Object.values(checks)
    .every(
      row => row.pass,
    );

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
      ? 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    input:
      'Script197 exact residual audit',

    zeroQuestion:
      'does fraction move exactly one normalized ammo unit while whole counter remains flat, then roll back',

    negativeQuestion:
      'do fraction and whole counter move coherently upward together',

    itemOrAbilityAttribution:
      false,

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
    diagnostic.classification
      === 'RESIDUALS_SPLIT_INTO_FRACTION_PREDICTION_ROLLBACK_AND_COHERENT_AMMO_RESTORATION'
      ? 'FREEZE_THE_TWO_RESIDUAL_CLASSES;_ATTRIBUTE_COHERENT_RESTORATION_EVENTS_TO_ITEM_OR_ABILITY_CONTEXT;_KEEP_FRACTION_ROLLBACK_AS_SEPARATE_PREDICTION_PHASE_PHENOMENON'
      : 'INSPECT_FRACTION_COHERENCE_FAILURES_BEFORE_FORMING_NEW_MECHANISM_HYPOTHESES',
};

mkdirSync(
  dirname(
    PATHS.output,
  ),

  {
    recursive:
      true,
  },
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
    pass:
      Boolean(pass),
  };
}

function percent(value) {
  return Number.isFinite(value)
    ? `${(
      value * 100
    ).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  const d =
    result.diagnostic;

  console.log(
    'ZERO RESIDUALS',
  );
  console.log(
    '--------------',
  );

  console.log(
    `total:                               ${d.zero.total}`,
  );

  console.log(
    `one-unit fraction prediction:        ${d.zero.oneUnitFractionPrediction} (${percent(d.zero.oneUnitFractionPredictionRate)})`,
  );

  console.log(
    `immediate fraction rollback:         ${d.zero.immediateRollback} (${percent(d.zero.immediateRollbackRate)})`,
  );

  console.log('');

  for (
    const row
    of d.zero.rows
  ) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} cap=${String(row.previousCapacity).padEnd(4)} step=${Number.isFinite(row.previousStep) ? row.previousStep.toFixed(6) : 'n/a'} rollback=${String(row.immediateRollback).padEnd(5)} delay=${String(row.rollbackTickDelay).padEnd(4)} ${row.signature}`,
    );
  }

  console.log('');
  console.log(
    'NEGATIVE / AMMO-GAIN RESIDUALS',
  );
  console.log(
    '------------------------------',
  );

  console.log(
    `total:                               ${d.negative.total}`,
  );

  console.log(
    `coherent whole+fraction gain:        ${d.negative.coherentWholeAndFractionGain} (${percent(d.negative.coherentWholeAndFractionGainRate)})`,
  );

  console.log('');

  for (
    const row
    of d.negative.rows
  ) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} cap=${String(row.previousCapacity).padEnd(4)} netGain=${String(row.logicalGain).padEnd(4)} fractionGainUnits=${Number.isFinite(row.fractionGainUnits) ? row.fractionGainUnits.toFixed(6) : 'n/a'} grossIfShot=${String(row.grossRestorationIfOneShotConsumed).padEnd(4)} ${row.signature}`,
    );
  }

  console.log('');
  console.log(
    'GROSS RESTORATION CANDIDATES',
  );
  console.log(
    '----------------------------',
  );

  for (
    const row
    of d.negative
      .grossRestorationCandidates
  ) {
    console.log(
      `gross=${row.key.padEnd(4)} count=${row.count}`,
    );
  }

  console.log('');
  console.log(
    'INTEGRITY VALIDATION',
  );
  console.log(
    '--------------------',
  );

  for (
    const [name, row]
    of Object.entries(
      result
        .integrityValidation
        .checks,
    )
  ) {
    console.log(
      `${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log(
    'CLASSIFICATION',
  );
  console.log(
    '--------------',
  );
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
