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
  annotateCandidates,
  buildContextIndex,
  buildRestorationEvents,
  computeItemEnrichment,
  summarizeAttackExposure,
  summarizeCandidates,
} from '../src/player-state/ammo-restoration-item-enrichment.mjs';

const VERSION =
  'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V01';

const PATHS = {
  script199:
    resolve(
      'output',
      'test',
      'ammo_restoration_context_discovery_v02.json',
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
      'ammo_restoration_item_enrichment_diagnostic_v01.json',
    ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script199 =
  JSON.parse(
    readFileSync(
      PATHS.script199,
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
console.log('AMMO RESTORATION ITEM ENRICHMENT DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log('Replay: test');
console.log('Restoration source: Script198 V03 via Script199 V02');
console.log('Controls: same-hero attack exposure across item-present/absent contexts');
console.log('Static item effects: Script139 V03');
console.log('Causal attribution: NO');
console.log('Authority promotion: NO');
console.log('');

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

const contextIndex =
  buildContextIndex(substrate);

const attackExposure =
  summarizeAttackExposure(runtimeRows);

const restorationEvents =
  buildRestorationEvents(script199);

const enrichment =
  computeItemEnrichment({
    restorationEvents,
    contextIndex,
    attackExposure,
  });

const annotated =
  annotateCandidates({
    enrichmentRows: enrichment,
    catalog,
    effects,
  });

const diagnostic =
  summarizeCandidates(annotated);

const restorationContextsResolved =
  restorationEvents.filter(
    event =>
      contextIndex.has(event.effectContextId),
  ).length;

const checks = {
  script199Ready:
    check(
      script199?.status,
      'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION',
      script199?.status
        === 'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION',
    ),

  restorationEventCountFrozen:
    check(
      restorationEvents.length,
      8,
      restorationEvents.length === 8,
    ),

  allRestorationContextsResolved:
    check(
      restorationContextsResolved,
      8,
      restorationContextsResolved === 8,
    ),

  contextIndexNonEmpty:
    check(
      contextIndex.size,
      '>0',
      contextIndex.size > 0,
    ),

  attackExposureNonEmpty:
    check(
      attackExposure.size,
      '>0',
      attackExposure.size > 0,
    ),

  jsonlParseClean:
    check(
      jsonlParseFailures,
      0,
      jsonlParseFailures === 0,
    ),

  testReplayOnly:
    check(
      script199?.replay,
      'test',
      script199?.replay === 'test',
    ),
};

const integrityPass =
  Object.values(checks).every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  replay: 'test',

  status:
    integrityPass
      ? 'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    comparison:
      'same-hero attack exposure with item present versus absent',
    restorationSource:
      'Script198 V03 via Script199 V02',
    catalogAuthority:
      'Script138 V02',
    itemEffectAuthority:
      'Script139 V03 resource contract',
    causalAttribution: false,
    authorityPromotion: false,
    replicationStatus:
      'discovery_calibration_only',
  },

  telemetry: {
    runtimeRows: runtimeRows.length,
    jsonlParseFailures,
    contextCount: contextIndex.size,
    attackContextCount: attackExposure.size,
    restorationEvents: restorationEvents.length,
    restorationContextsResolved,
  },

  diagnostic,

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status: 'DISCOVERY_ONLY',
    authorityPromotion: false,
    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    diagnostic.classification
      === 'CROSS_HERO_ITEM_WITH_AMMO_EFFECT_EVIDENCE_AVAILABLE_FOR_SPECIFIC_HYPOTHESIS'
      ? 'FREEZE_TOP_ITEM_MECHANISM_HYPOTHESIS_ON_TEST;_VERIFY_EVENT_LEVEL_TRIGGER_STATE_AND_GAIN_MAGNITUDE_BEFORE_ANY_NEW_REPLAY_VALIDATION'
      : 'NO_SINGLE_ITEM_EXPLAINS_THE_RESTORATIONS;_MOVE_TO_HERO_ABILITY_OR_MULTI_MECHANISM_ATTRIBUTION_ON_TEST',
};

mkdirSync(
  dirname(PATHS.output),
  { recursive: true },
);

writeFileSync(
  PATHS.output,
  `${JSON.stringify(result, null, 2)}\n`,
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
    ? `${(value * 100).toFixed(3)}%`
    : 'n/a';
}

function rr(value) {
  if (value === Infinity) return 'Inf';
  return Number.isFinite(value)
    ? value.toFixed(3)
    : 'n/a';
}

function identity(row) {
  const value =
    row.catalogIdentity ?? {};

  return (
    value.recordKey
    ?? value.itemName
    ?? value.displayName
    ?? value.name
    ?? value.className
    ?? `item:${row.itemId}`
  );
}

function print(result) {
  const d = result.diagnostic;

  console.log('');
  console.log('========================================================');
  console.log('PER-HERO ITEM ENRICHMENT');
  console.log('========================================================');
  console.log('');

  for (const row of d.perHero) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} item=${String(row.itemId).padEnd(11)} name=${identity(row)} restor=${row.restorationPresent}/${row.restorationEvents} (${pct(row.restorationPresenceRate)}) attacksWith=${String(row.attacksPresent).padEnd(6)} attacksWithout=${String(row.attacksAbsent).padEnd(6)} rateWith=${pct(row.restorationRatePresent)} rateWithout=${pct(row.restorationRateAbsent)} RR=${rr(row.riskRatio)} ammoEvidence=${row.ammoEffectEvidence.length}`,
    );

    if (row.ammoEffectEvidence.length > 0) {
      console.log(
        `  ammoEffectEvidence=${JSON.stringify(row.ammoEffectEvidence)}`,
      );
    }
  }

  console.log('');
  console.log('========================================================');
  console.log('CROSS-HERO CANDIDATES');
  console.log('========================================================');
  console.log('');

  for (const row of d.crossHero) {
    const name =
      row.catalogIdentity?.recordKey
      ?? row.catalogIdentity?.itemName
      ?? row.catalogIdentity?.displayName
      ?? row.catalogIdentity?.name
      ?? `item:${row.itemId}`;

    console.log(
      `item=${String(row.itemId).padEnd(11)} name=${name} heroes=${JSON.stringify(row.heroIds)} heroSupport=${row.heroSupport} restorationPresent=${row.restorationPresent}/${row.restorationEvents} attacksPresent=${row.attacksPresent} ammoEvidence=${row.ammoEffectEvidence.length}`,
    );

    if (row.ammoEffectEvidence.length > 0) {
      console.log(
        `  ammoEffectEvidence=${JSON.stringify(row.ammoEffectEvidence)}`,
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
  console.log(d.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
