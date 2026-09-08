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
  EXPECTED_EFFECT_STATUS,
  buildCensusV03,
} from '../src/player-state/standard-shop-ammo-mechanism-census-v03.mjs';

const VERSION =
  'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03';

const PATHS = {
  v01:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_ammo_mechanism_census_v01.json',
    ),

  v02:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_ammo_mechanism_census_v02.json',
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
      'standard_shop_ammo_mechanism_census_v03.json',
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
      PATHS.v01,
      'utf8',
    ),
  );

const v02 =
  JSON.parse(
    readFileSync(
      PATHS.v02,
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
  'STANDARD SHOP AMMO MECHANISM CENSUS V0.3',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'V01/V02 adapter failures preserved: YES',
);
console.log(
  'Universe source: Script139 V03 exact items array',
);
console.log(
  'Expected Script139 status:',
  EXPECTED_EFFECT_STATUS,
);
console.log(
  'Expected item universe: 156 unique recordKeys',
);
console.log(
  'Replay purchase exposure required: NO',
);
console.log(
  'Runtime causal attribution: NO',
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const census =
  buildCensusV03(
    effects,
  );

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
  v01FailurePreserved:
    check(
      v01?.status,
      'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01_INTEGRITY_FAILURE',
      v01?.status
        === 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V01_INTEGRITY_FAILURE',
    ),

  v02FailurePreserved:
    check(
      v02?.status,
      'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V02_INTEGRITY_FAILURE',
      v02?.status
        === 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V02_INTEGRITY_FAILURE',
    ),

  script139StatusExpected:
    check(
      census.universe.status,
      EXPECTED_EFFECT_STATUS,
      census.universe.status
        === EXPECTED_EFFECT_STATUS,
    ),

  itemArrayExactly156:
    check(
      census.universe.itemCount,
      156,
      census.universe.itemCount === 156,
    ),

  allItemsHaveRecordKeys:
    check(
      census.universe.recordKeyCount,
      156,
      census.universe.recordKeyCount === 156,
    ),

  recordKeysUnique:
    check(
      census.universe.uniqueRecordKeyCount,
      156,
      census.universe.uniqueRecordKeyCount === 156
      && census.universe.duplicateRecordKeys.length === 0,
    ),

  quickSilverRetained:
    check(
      quickSilver
        ?.classification
        ?? null,
      'current-ammo candidate',
      quickSilver
        ?.currentAmmoCandidate === true,
    ),

  etherealRetained:
    check(
      ethereal
        ?.classification
        ?? null,
      'current-ammo candidate',
      ethereal
        ?.currentAmmoCandidate === true,
    ),

  candidateUniverseNonEmpty:
    check(
      census.currentAmmoCandidateCount,
      '>0',
      census.currentAmmoCandidateCount > 0,
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
      ? 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03_READY_FOR_INTERPRETATION'
      : 'STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V03_INTEGRITY_FAILURE',

  scientificBoundary: {
    successorReason:
      'Use Script139 V03 exact 156-item items array instead of re-deriving Script138 internal catalog schema',

    universeAuthority:
      'Script139 V03, itself derived from Script138 V02 validated standard catalog',

    universe:
      'all 156 validated standard-shop item effect records',

    purchaseExposureRequired:
      false,

    candidateMethod:
      'high-recall resource evidence using ammo/clip/magazine/reload fields plus explicitly separated non-direct semantics',

    genericFieldNames:
      'diagnostic candidate evidence only',

    currentAmmoCausality:
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
      ? 'INTERPRET_COMPLETE_156_ITEM_CANDIDATE_UNIVERSE;_COMPARE_SCRIPT201_PAIR_AGAINST_ALL_OTHER_RESOURCE_CANDIDATES'
      : 'STOP_AND_DIAGNOSE_SCRIPT139_UNIVERSE_OR_CLASSIFIER',
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

  console.log('UNIVERSE');
  console.log('--------');
  console.log(
    `Script139 status:                    ${c.universe.status}`,
  );
  console.log(
    `items:                               ${c.universe.itemCount}`,
  );
  console.log(
    `recordKeys:                          ${c.universe.recordKeyCount}`,
  );
  console.log(
    `unique recordKeys:                   ${c.universe.uniqueRecordKeyCount}`,
  );
  console.log(
    `duplicate recordKeys:                ${c.universe.duplicateRecordKeys.length}`,
  );
  console.log('');

  console.log('CENSUS SUMMARY');
  console.log('--------------');
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

  for (
    const row
    of c.byClassification
  ) {
    console.log(
      `${row.key.padEnd(52)} ${row.count}`,
    );
  }

  console.log('');
  console.log('CURRENT-AMMO CANDIDATE UNIVERSE');
  console.log('-------------------------------');

  for (
    const item
    of c.currentAmmoCandidates
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
  console.log('STATIC CAPACITY / RELOAD EFFECTS');
  console.log('--------------------------------');

  for (
    const item
    of c.staticOnly
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
