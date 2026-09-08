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
  STANDARD_CLASS,
  buildCensusV02,
} from '../src/player-state/standard-shop-ammo-mechanism-census-v02.mjs';

const VERSION =
  'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V02';

const PATHS = {
  v01:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_ammo_mechanism_census_v01.json',
    ),

  catalog:
    resolve(
      'output',
      'cross_replay',
      'current_purchasable_item_catalog_v02.json',
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
      'standard_shop_ammo_mechanism_census_v02.json',
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

const v01 =
  JSON.parse(
    readFileSync(
      PATHS.v01,
      'utf8',
    ),
  );

const catalog =
  JSON.parse(
    readFileSync(
      PATHS.catalog,
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
console.log('STANDARD SHOP AMMO MECHANISM CENSUS V0.2');
console.log('========================================================');
console.log('');
console.log('V01 integrity failure preserved: YES');
console.log(
  `Catalog selector: classification == ${STANDARD_CLASS}`,
);
console.log('Expected standard universe: 156');
console.log(
  'recordModifierTokens alone promote dynamic semantics: NO',
);
console.log('Replay purchase exposure required: NO');
console.log('Authority promotion: NO');
console.log('');

const census =
  buildCensusV02({
    catalog,
    effects,
  });

const quickSilver =
  census.items.find(
    row =>
      row.recordKey
      === 'upgrade_quick_silver',
  );

const ethereal =
  census.items.find(
    row =>
      row.recordKey
      === 'upgrade_ethereal_bullets',
  );

const checks = {
  v01IntegrityFailurePreserved:
    check(
      v01?.status,
      'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01_INTEGRITY_FAILURE',
      v01?.status
        === 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01_INTEGRITY_FAILURE',
    ),

  standardCatalogRowsExactly156:
    check(
      census.standardCatalogRows,
      156,
      census.standardCatalogRows === 156,
    ),

  effectItemsExactly156:
    check(
      census.effectItems,
      156,
      census.effectItems === 156,
    ),

  joinedItemsExactly156:
    check(
      census.joinedItems,
      156,
      census.joinedItems === 156,
    ),

  noDuplicateEffectKeys:
    check(
      census
        .duplicateEffectRecordKeys
        .length,
      0,
      census
        .duplicateEffectRecordKeys
        .length === 0,
    ),

  noMissingEffects:
    check(
      census
        .missingEffects
        .length,
      0,
      census
        .missingEffects
        .length === 0,
    ),

  noExtraEffects:
    check(
      census
        .extraEffects
        .length,
      0,
      census
        .extraEffects
        .length === 0,
    ),

  quickSilverRetained:
    check(
      quickSilver
        ?.classification
        ?? null,
      'current-ammo candidate',
      Boolean(
        quickSilver
        ?.currentAmmoCandidate,
      ),
    ),

  etherealRetained:
    check(
      ethereal
        ?.classification
        ?? null,
      'current-ammo candidate',
      Boolean(
        ethereal
        ?.currentAmmoCandidate,
      ),
    ),

  candidateUniverseNonEmpty:
    check(
      census
        .currentAmmoCandidateCount,
      '>0',
      census
        .currentAmmoCandidateCount > 0,
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
      ? 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V02_READY_FOR_INTERPRETATION'
      : 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V02_INTEGRITY_FAILURE',

  scientificBoundary: {
    successorReason: [
      'V01 traversed all 285 Script138 structural records instead of exact standard-shop classification',
      'V01 allowed generic recordModifierTokens to promote non-direct semantics',
    ],

    catalogSelector:
      STANDARD_CLASS,

    universe:
      'all 156 validated Script138 V02 standard-shop items',

    purchaseExposureRequired:
      false,

    resourceContract:
      'Script139 V03',

    recordModifierTokenPolicy:
      'corroboration-only',

    genericFieldNames:
      'diagnostic-only candidate evidence',

    runtimeCausality:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'resource_build_bound',
  },

  census,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'RESOURCE_CENSUS_ONLY',

    authorityPromotion:
      false,

    replicationStatus:
      'resource_build_bound',
  },

  nextStep:
    integrityPass
      ? 'INTERPRET_COMPLETE_156_ITEM_CURRENT_AMMO_CANDIDATE_UNIVERSE;_COMPARE_SCRIPT201_PAIR_AGAINST_ALL_OTHER_CANDIDATES_BEFORE_TRIGGER_CHARACTERIZATION'
      : 'STOP_AND_DIAGNOSE_V02_CATALOG_OR_EFFECT_ADAPTER',
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
  const c = result.census;

  console.log('CENSUS SUMMARY');
  console.log('--------------');
  console.log(
    `standard catalog rows:               ${c.standardCatalogRows}`,
  );
  console.log(
    `effect items:                        ${c.effectItems}`,
  );
  console.log(
    `joined items:                        ${c.joinedItems}`,
  );
  console.log(
    `current-ammo candidates:             ${c.currentAmmoCandidateCount}`,
  );
  console.log(
    `static capacity/reload only:          ${c.staticOnlyCount}`,
  );
  console.log(
    `no ammo evidence:                    ${c.noAmmoEvidenceCount}`,
  );
  console.log('');

  console.log('BY CLASSIFICATION');
  console.log('-----------------');

  for (const row of c.byClassification) {
    console.log(
      `${row.key.padEnd(58)} ${row.count}`,
    );
  }

  console.log('');
  console.log('CURRENT-AMMO CANDIDATE UNIVERSE');
  console.log('-------------------------------');

  for (const item of c.currentAmmoCandidates) {
    console.log(
      `${item.recordKey.padEnd(40)} ${item.classification}`,
    );

    for (const evidence of item.evidence.all) {
      console.log(
        `  [${evidence.tier}] ${evidence.source}: ${evidence.value}`,
      );
    }
  }

  console.log('');
  console.log('STATIC CAPACITY / RELOAD EFFECTS');
  console.log('--------------------------------');

  for (const item of c.staticOnly) {
    console.log(
      `${item.recordKey.padEnd(40)} ${item.classification}`,
    );

    for (const evidence of item.evidence.all) {
      console.log(
        `  [${evidence.tier}] ${evidence.source}: ${evidence.value}`,
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
      `${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
