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
  buildSemanticAuditV02,
} from '../src/player-state/ammo-candidate-resource-semantics-v02.mjs';

const VERSION =
  'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V02';

const PATHS = {
  script204v01:
    resolve(
      'output',
      'cross_replay',
      'ammo_candidate_resource_semantics_audit_v01.json',
    ),

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
      'ammo_candidate_resource_semantics_audit_v02.json',
    ),
};

for (
  const [name, path]
  of Object.entries(PATHS)
) {
  if (name === 'output') continue;

  if (!existsSync(path)) {
    throw new Error(
      `Missing ${name}:\n${path}`,
    );
  }
}

const v01 =
  JSON.parse(
    readFileSync(
      PATHS.script204v01,
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
console.log(
  '========================================================',
);
console.log(
  'AMMO CANDIDATE RESOURCE SEMANTICS AUDIT V0.2',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'V01 integrity result preserved: YES',
);
console.log(
  'V01 semantic-depth classification authority: NO',
);
console.log(
  'Value-bearing requirement: actual numericValue/value/raw scalar',
);
console.log(
  'propertyKey / providedPropertyType / token / icon / recordKey == value: NO',
);
console.log(
  'Candidate universe: 18',
);
console.log(
  'Runtime causality: NO',
);
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
  buildSemanticAuditV02({
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

const quickSilver =
  rows.find(
    row =>
      row.recordKey
      === 'upgrade_quick_silver',
  );

const ethereal =
  rows.find(
    row =>
      row.recordKey
      === 'upgrade_ethereal_bullets',
  );

const blitz =
  rows.find(
    row =>
      row.recordKey
      === 'upgrade_blitz_bullets',
  );

const express =
  rows.find(
    row =>
      row.recordKey
      === 'upgrade_express_shot',
  );

const glass =
  rows.find(
    row =>
      row.recordKey
      === 'upgrade_glass_cannon',
  );

const surging =
  rows.find(
    row =>
      row.recordKey
      === 'upgrade_surging_power',
  );

const checks = {
  v01ReadyButSuperseded:
    check(
      v01?.status,
      'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V01_READY_FOR_INTERPRETATION',
      v01?.status
        === 'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V01_READY_FOR_INTERPRETATION',
    ),

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

  exactly18:
    check(
      audit.candidateCount,
      18,
      audit.candidateCount === 18,
    ),

  allRecordsFound:
    check(
      audit.missingItemCount,
      0,
      audit.missingItemCount === 0,
    ),

  quickSilverNotPromotedByIcon:
    check(
      {
        currentValues:
          quickSilver?.currentAmmoValueCount,
        currentFieldNames:
          quickSilver?.currentAmmoFieldNameCount,
        depth:
          quickSilver?.evidenceDepth,
      },
      'no explicit current-ammo value unless one is actually present',
      quickSilver
        && !(
          quickSilver.currentAmmoValueCount === 0
          && quickSilver.evidenceDepth
            === 'EXPLICIT_CURRENT_AMMO_VALUE_PRESENT'
        ),
    ),

  expressFieldRetained:
    check(
      express?.currentAmmoFieldNameCount ?? 0,
      '>0',
      (express?.currentAmmoFieldNameCount ?? 0) > 0,
    ),

  glassFieldRetained:
    check(
      glass?.currentAmmoFieldNameCount ?? 0,
      '>0',
      (glass?.currentAmmoFieldNameCount ?? 0) > 0,
    ),

  surgingFieldRetained:
    check(
      surging?.currentAmmoFieldNameCount ?? 0,
      '>0',
      (surging?.currentAmmoFieldNameCount ?? 0) > 0,
    ),

  knownObservedCandidatesPresent:
    check(
      [
        Boolean(quickSilver),
        Boolean(ethereal),
        Boolean(blitz),
      ],
      [true, true, true],
      Boolean(
        quickSilver
        && ethereal
        && blitz,
      ),
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

  status:
    integrityPass
      ? 'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V02_READY_FOR_INTERPRETATION'
      : 'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V02_INTEGRITY_FAILURE',

  scientificBoundary: {
    successorReason:
      'V01 conflated semantic/name declarations with actual supplied resource values',

    candidateUniverse:
      'Script202 V03 complete 18-item candidate universe',

    strictValueDefinition: [
      'finite numericValue',
      'nonempty value on an ammo/reload direct-stat record',
      'raw scalar whose key itself is ammo/reload semantic',
    ],

    explicitlyNotValueBearing: [
      'recordKey',
      'icons/CSS metadata',
      'propertyKey declaration',
      'providedPropertyType declaration',
      'modifierValueTokens',
      'generic field-name arrays',
      'nested modifier class names',
    ],

    runtimeCoverageAnnotation:
      'Script203 V01',

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
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'STRICT_RESOURCE_VALUE_DISCRIMINATION_ONLY',

    authorityPromotion:
      false,

    replicationStatus:
      'resource_build_bound',
  },

  nextStep:
    integrityPass
      ? 'INTERPRET_WHICH_OF_18_HAVE_EXPLICIT_CURRENT_AMMO_VALUES_VS_FIELD_NAMES_ONLY;_THEN_PRIORITIZE_TARGETED_CALIBRATION_FOR_UNOBSERVED_CURRENT_AMMO_FIELDS'
      : 'STOP_AND_DIAGNOSE_V02_STRICT_VALUE_CLASSIFIER',
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

function print(result) {
  const a =
    result.audit;

  console.log(
    'STRICT VALUE SUMMARY',
  );
  console.log(
    '--------------------',
  );
  console.log(
    `candidate count:                     ${a.candidateCount}`,
  );
  console.log(
    `explicit current-ammo value items:   ${a.explicitCurrentAmmoValueCount}`,
  );
  console.log(
    `current-ammo field/no-value items:   ${a.currentAmmoFieldNoValueCount}`,
  );
  console.log('');

  console.log(
    'BY EVIDENCE DEPTH',
  );
  console.log(
    '-----------------',
  );

  for (
    const row
    of a.byDepth
  ) {
    console.log(
      `${row.key.padEnd(48)} ${row.count}`,
    );
  }

  console.log('');
  console.log(
    'CANDIDATE STRICT SEMANTICS',
  );
  console.log(
    '--------------------------',
  );

  for (
    const row
    of a.rows
  ) {
    const coverage =
      row.runtimeCoverage;

    console.log(
      `${row.recordKey.padEnd(40)} depth=${row.evidenceDepth.padEnd(42)} runtime=${String(coverage?.disposition ?? 'n/a').padEnd(32)} attacks=${String(coverage?.attackExposure ?? 0).padEnd(6)} restor=${coverage?.restorationEventCount ?? 0}`,
    );

    console.log(
      `  currentValues=${row.currentAmmoValueCount} currentFieldNames=${row.currentAmmoFieldNameCount} staticCapacityValues=${row.staticCapacityValueCount} staticReloadValues=${row.staticReloadValueCount} directDecl=${row.directAmmoDeclarationCount} directValues=${row.directAmmoValueCount} rawScalars=${row.rawAmmoScalarCount} triggerHints=${row.triggerHintCount}`,
    );

    for (
      const value
      of row.currentAmmoValues
    ) {
      console.log(
        `  CURRENT_VALUE ${JSON.stringify(value)}`,
      );
    }

    for (
      const field
      of row.currentAmmoFieldNames
    ) {
      console.log(
        `  CURRENT_FIELD ${field.source}[${field.index}] = ${field.value}`,
      );
    }

    for (
      const value
      of row.staticCapacityValues
    ) {
      console.log(
        `  STATIC_CAPACITY ${JSON.stringify(value)}`,
      );
    }

    for (
      const value
      of row.staticReloadValues
    ) {
      console.log(
        `  STATIC_RELOAD ${JSON.stringify(value)}`,
      );
    }

    if (
      row.triggerHints.length > 0
    ) {
      console.log(
        `  TRIGGER_HINTS ${JSON.stringify(row.triggerHints)}`,
      );
    }
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
      result.integrityValidation.checks,
    )
  ) {
    console.log(
      `${name.padEnd(38)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
    a.classification,
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
