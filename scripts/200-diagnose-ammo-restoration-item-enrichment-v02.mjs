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
  annotateEnrichmentRows,
  murmurHash2,
  summarizeResolvedCandidates,
} from '../src/player-state/ammo-restoration-item-enrichment-v02.mjs';

const VERSION =
  'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V02';

const PATHS = {
  script200v01:
    resolve(
      'output',
      'test',
      'ammo_restoration_item_enrichment_diagnostic_v01.json',
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
      'test',
      'ammo_restoration_item_enrichment_diagnostic_v02.json',
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

const script200v01 =
  JSON.parse(
    readFileSync(
      PATHS.script200v01,
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
console.log(
  '========================================================',
);
console.log(
  'AMMO RESTORATION ITEM ENRICHMENT DIAGNOSTIC V0.2',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Successor reason: V01 attempted numeric-ID lookup against recordKey authorities',
);
console.log(
  'Join: MurmurHash2(recordKey, 0x31415926) -> runtime item ID',
);
console.log(
  'Hash fixture: upgrade_magic_reach -> 754480263',
);
console.log(
  'Scientific exposure analysis changed: NO',
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const enrichmentRows =
  script200v01
    ?.diagnostic
    ?.perHero
    ?? [];

const annotated =
  annotateEnrichmentRows({
    enrichmentRows,
    catalog,
    effects,
  });

const diagnostic =
  summarizeResolvedCandidates(
    annotated.rows,
  );

const candidateIds =
  [...new Set(
    enrichmentRows.map(
      row => Number(row.itemId),
    ),
  )];

const resolvedCount =
  annotated
    .resolution
    .resolved
    .length;

const unresolvedCount =
  annotated
    .resolution
    .unresolved
    .length;

const effectResolvedCount =
  annotated
    .resolution
    .resolved
    .filter(
      row =>
        row.effectMatchCount > 0,
    )
    .length;

const checks = {
  script200V01Ready:
    check(
      script200v01?.status,
      'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION',
      script200v01?.status
        === 'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION',
    ),

  hashFixture:
    check(
      murmurHash2(
        'upgrade_magic_reach',
      ),
      754480263,
      murmurHash2(
        'upgrade_magic_reach',
      ) === 754480263,
    ),

  candidateIdsObserved:
    check(
      candidateIds.length,
      '>0',
      candidateIds.length > 0,
    ),

  allCandidateIdsCatalogResolved:
    check(
      {
        candidates:
          candidateIds.length,
        resolved:
          resolvedCount,
        unresolved:
          unresolvedCount,
      },
      {
        resolved:
          candidateIds.length,
        unresolved: 0,
      },
      resolvedCount
        === candidateIds.length
      && unresolvedCount === 0,
    ),

  allResolvedItemsHaveEffectRecord:
    check(
      effectResolvedCount,
      resolvedCount,
      effectResolvedCount
        === resolvedCount,
    ),

  noCatalogHashCollisions:
    check(
      annotated
        .resolution
        .catalogHashCollisions
        .length,
      0,
      annotated
        .resolution
        .catalogHashCollisions
        .length === 0,
    ),

  testReplayOnly:
    check(
      script200v01?.replay,
      'test',
      script200v01?.replay
        === 'test',
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
      ? 'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V02_READY_FOR_INTERPRETATION'
      : 'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V02_INTEGRITY_FAILURE',

  scientificBoundary: {
    successorReason:
      'V01 catalog/effect join used runtime numeric IDs directly instead of MurmurHash2(recordKey)',

    exposureAnalysisSource:
      'Script200 V01 per-hero item enrichment counts',

    itemIdentityJoin:
      'MurmurHash2(recordKey, seed 0x31415926)',

    itemEffectJoin:
      'resolved recordKey -> Script139 V03',

    causalAttribution:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  resolution:
    annotated.resolution,

  diagnostic,

  integrityValidation: {
    pass:
      integrityPass,

    checks,
  },

  semanticValidation: {
    status:
      'DISCOVERY_ONLY',

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    !integrityPass
      ? 'STOP_AND_DIAGNOSE_ITEM_ID_OR_EFFECT_JOIN'
      : diagnostic.classification
        === 'RESOLVED_CROSS_HERO_ITEM_WITH_AMMO_EFFECT_EVIDENCE_AVAILABLE_FOR_SPECIFIC_HYPOTHESIS'
          ? 'FREEZE_TOP_RESOLVED_ITEM_MECHANISM_HYPOTHESIS_ON_TEST;_VERIFY_TRIGGER_STATE_AND_GAIN_MAGNITUDE_EVENT_BY_EVENT'
          : 'ITEM_IDENTITIES_RESOLVED_BUT_NO_SINGLE_CROSS_HERO_AMMO_EFFECT_CANDIDATE;_MOVE_TO_MULTI_MECHANISM_OR_HERO_ABILITY_ATTRIBUTION',
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

function pct(value) {
  return Number.isFinite(value)
    ? `${(
      value * 100
    ).toFixed(3)}%`
    : 'n/a';
}

function rr(value) {
  if (value === Infinity) {
    return 'Inf';
  }

  return Number.isFinite(value)
    ? value.toFixed(3)
    : 'n/a';
}

function print(result) {
  console.log(
    'ITEM RESOLUTION',
  );
  console.log(
    '---------------',
  );

  for (
    const row
    of result
      .resolution
      .resolved
  ) {
    console.log(
      `item=${String(row.itemId).padEnd(11)} recordKey=${row.recordKey} effectMatches=${row.effectMatchCount} ammoEvidence=${row.ammoEffectEvidence.length}`,
    );

    if (
      row.ammoEffectEvidence.length > 0
    ) {
      console.log(
        `  ammoEffectEvidence=${JSON.stringify(row.ammoEffectEvidence)}`,
      );
    }
  }

  if (
    result
      .resolution
      .unresolved
      .length > 0
  ) {
    console.log(
      `UNRESOLVED=${JSON.stringify(result.resolution.unresolved)}`,
    );
  }

  console.log('');
  console.log(
    'CROSS-HERO RESOLVED CANDIDATES',
  );
  console.log(
    '------------------------------',
  );

  for (
    const row
    of result
      .diagnostic
      .crossHero
  ) {
    console.log(
      `item=${String(row.itemId).padEnd(11)} recordKey=${row.recordKey.padEnd(36)} heroes=${JSON.stringify(row.heroIds)} support=${row.heroSupport} restor=${row.restorationPresent}/${row.restorationEvents} attacksWith=${row.attacksPresent} ammoEvidence=${row.ammoEffectEvidence.length}`,
    );

    if (
      row.ammoEffectEvidence.length > 0
    ) {
      console.log(
        `  ammoEffectEvidence=${JSON.stringify(row.ammoEffectEvidence)}`,
      );
    }
  }

  console.log('');
  console.log(
    'ORIGINAL PER-HERO EXPOSURE WITH RESOLVED IDENTITIES',
  );
  console.log(
    '-----------------------------------------------',
  );

  const byId =
    new Map(
      result
        .resolution
        .resolved
        .map(
          row => [
            row.itemId,
            row,
          ],
        ),
    );

  for (
    const row
    of script200v01
      ?.diagnostic
      ?.perHero
      ?? []
  ) {
    const resolved =
      byId.get(
        Number(row.itemId),
      );

    console.log(
      `hero=${String(row.heroId).padEnd(4)} item=${String(row.itemId).padEnd(11)} recordKey=${String(resolved?.recordKey ?? 'UNRESOLVED').padEnd(36)} restor=${row.restorationPresent}/${row.restorationEvents} rateWith=${pct(row.restorationRatePresent)} rateWithout=${pct(row.restorationRateAbsent)} RR=${rr(row.riskRatio)} ammoEvidence=${resolved?.ammoEffectEvidence?.length ?? 0}`,
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
    result
      .diagnostic
      .classification,
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
