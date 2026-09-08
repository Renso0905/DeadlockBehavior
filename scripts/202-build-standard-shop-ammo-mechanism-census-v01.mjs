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
  buildAmmoMechanismCensus,
} from '../src/player-state/standard-shop-ammo-mechanism-census.mjs';

const VERSION =
  'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01';

const PATHS = {
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
      'standard_shop_ammo_mechanism_census_v01.json',
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
console.log(
  '========================================================',
);
console.log(
  'STANDARD SHOP AMMO MECHANISM CENSUS V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Universe: all 156 validated standard-shop items',
);
console.log(
  'Replay purchase exposure required: NO',
);
console.log(
  'Input catalog: Script138 V02',
);
console.log(
  'Input effects: Script139 V03',
);
console.log(
  'Goal: define complete resource-level ammo candidate universe',
);
console.log(
  'Runtime causal attribution: NO',
);
console.log('');

const census =
  buildAmmoMechanismCensus({
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
  catalogRowsExactly156:
    check(
      census.catalogRows,
      156,
      census.catalogRows === 156,
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

  quickSilverIncluded:
    check(
      quickSilver
        ?.classification
        ?? null,
      'current ammo candidate',
      Boolean(
        quickSilver
        && quickSilver
          .evidence
          .currentAmmoRestore
          .length > 0,
      ),
    ),

  etherealBulletsIncluded:
    check(
      ethereal
        ?.classification
        ?? null,
      'current ammo candidate',
      Boolean(
        ethereal
        && ethereal
          .evidence
          .currentAmmoRestore
          .length > 0,
      ),
    ),

  candidateUniverseNonEmpty:
    check(
      census
        .restorationCandidateCount,
      '>0',
      census
        .restorationCandidateCount > 0,
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
      ? 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01_READY_FOR_INTERPRETATION'
      : 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    universe:
      'all 156 Script138 V02 standard-shop items',

    purchaseExposureRequired:
      false,

    resourceContract:
      'Script139 V03',

    purpose:
      'enumerate every standard-shop item with resource-level ammo/clip/reload evidence before runtime attribution',

    currentAmmoRestorationInference:
      'candidate only unless resource semantics are explicit',

    genericFieldNames:
      'diagnostic-only evidence tier',

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
      ? 'REVIEW_COMPLETE_RESTORATION_CANDIDATE_UNIVERSE;_THEN_COMPARE_SCRIPT201_QUICK_SILVER_ETHEREAL_HYPOTHESIS_AGAINST_ALL_OTHER_RESOURCE_PLAUSIBLE_ITEMS'
      : 'STOP_AND_DIAGNOSE_CATALOG_EFFECT_CENSUS_INTEGRITY',
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
  const c =
    result.census;

  console.log(
    'CENSUS SUMMARY',
  );
  console.log(
    '--------------',
  );
  console.log(
    `catalog rows:                        ${c.catalogRows}`,
  );
  console.log(
    `effect items:                        ${c.effectItems}`,
  );
  console.log(
    `joined items:                        ${c.joinedItems}`,
  );
  console.log(
    `restoration/unresolved candidates:   ${c.restorationCandidateCount}`,
  );
  console.log(
    `capacity/reload non-restore effects: ${c.capacityOrReloadButNotRestoreCount}`,
  );
  console.log(
    `no ammo evidence:                    ${c.noAmmoEvidenceCount}`,
  );
  console.log('');

  console.log(
    'BY CLASSIFICATION',
  );
  console.log(
    '-----------------',
  );

  for (
    const row
    of c.byClassification
  ) {
    console.log(
      `${row.key.padEnd(58)} ${row.count}`,
    );
  }

  console.log('');
  console.log(
    'RESTORATION / UNRESOLVED CANDIDATE UNIVERSE',
  );
  console.log(
    '-------------------------------------------',
  );

  for (
    const item
    of c.restorationCandidates
  ) {
    console.log(
      `${item.recordKey.padEnd(40)} ${item.classification}`,
    );

    for (
      const evidence
      of item.evidence.all
    ) {
      console.log(
        `  [${evidence.tier}] ${evidence.source}: ${evidence.value}`,
      );
    }
  }

  console.log('');
  console.log(
    'CAPACITY / RELOAD EFFECTS NOT YET CURRENT-AMMO RESTORE CANDIDATES',
  );
  console.log(
    '----------------------------------------------------------------',
  );

  for (
    const item
    of c.capacityOrReloadButNotRestore
  ) {
    console.log(
      `${item.recordKey.padEnd(40)} ${item.classification}`,
    );

    for (
      const evidence
      of item.evidence.all
    ) {
      console.log(
        `  [${evidence.tier}] ${evidence.source}: ${evidence.value}`,
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
    c.classification,
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
