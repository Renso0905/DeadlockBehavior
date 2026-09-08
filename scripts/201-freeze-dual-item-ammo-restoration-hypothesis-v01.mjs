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
  ETHEREAL_BULLETS_ID,
  ETHEREAL_BULLETS_KEY,
  QUICK_SILVER_ID,
  QUICK_SILVER_KEY,
  buildContextItemIndex,
  buildRestorationEventsFromScript199,
  buildRestorationPairMatrix,
  collectMechanismEvidenceForRecordKey,
  summarizeDualItemHypothesis,
  summarizePairAttackExposure,
} from '../src/player-state/dual-item-ammo-restoration-hypothesis.mjs';

const VERSION =
  'DUAL_ITEM_AMMO_RESTORATION_HYPOTHESIS_V01';

const PATHS = {
  script198v03:
    resolve(
      'output',
      'test',
      'ammo_fraction_coherence_diagnostic_v03.json',
    ),

  script199v02:
    resolve(
      'output',
      'test',
      'ammo_restoration_context_discovery_v02.json',
    ),

  script200v02:
    resolve(
      'output',
      'test',
      'ammo_restoration_item_enrichment_diagnostic_v02.json',
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
      'dual_item_ammo_restoration_hypothesis_v01.json',
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

const script198v03 =
  JSON.parse(
    readFileSync(
      PATHS.script198v03,
      'utf8',
    ),
  );

const script199v02 =
  JSON.parse(
    readFileSync(
      PATHS.script199v02,
      'utf8',
    ),
  );

const script200v02 =
  JSON.parse(
    readFileSync(
      PATHS.script200v02,
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
  'DUAL-ITEM AMMO RESTORATION HYPOTHESIS V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  `Quick Silver:      ${QUICK_SILVER_KEY} (${QUICK_SILVER_ID})`,
);
console.log(
  `Ethereal Bullets:  ${ETHEREAL_BULLETS_KEY} (${ETHEREAL_BULLETS_ID})`,
);
console.log(
  'Replay: test',
);
console.log(
  'Hypothesis formed after Script200 V02: YES',
);
console.log(
  'Replication status: discovery/calibration only',
);
console.log(
  'Authority promotion: NO',
);
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
    runtimeRows.push(
      JSON.parse(line),
    );
  } catch {
    jsonlParseFailures++;
  }
}

const contextIndex =
  buildContextItemIndex(
    substrate,
  );

const restorationEvents =
  buildRestorationEventsFromScript199(
    script199v02,
  );

const matrix =
  buildRestorationPairMatrix({
    restorationEvents,
    contextIndex,
    residualRows:
      script198v03
        ?.diagnostic
        ?.negative
        ?.rows
      ?? [],
  });

const exposureRows =
  summarizePairAttackExposure({
    runtimeRows,
    contextIndex,
    restorationMatrixRows:
      matrix.rows,
  });

const quickEvidence =
  collectMechanismEvidenceForRecordKey(
    effects,
    QUICK_SILVER_KEY,
  );

const etherealEvidence =
  collectMechanismEvidenceForRecordKey(
    effects,
    ETHEREAL_BULLETS_KEY,
  );

const diagnostic =
  summarizeDualItemHypothesis({
    matrix,
    exposureRows,
    quickEvidence,
    etherealEvidence,
  });

const checks = {
  script198V03Ready:
    check(
      script198v03?.status,
      'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V03_READY_FOR_INTERPRETATION',
      script198v03?.status
        === 'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V03_READY_FOR_INTERPRETATION',
    ),

  script199V02Ready:
    check(
      script199v02?.status,
      'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION',
      script199v02?.status
        === 'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION',
    ),

  script200V02Ready:
    check(
      script200v02?.status,
      'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V02_READY_FOR_INTERPRETATION',
      script200v02?.status
        === 'AMMO_RESTORATION_ITEM_ENRICHMENT_DIAGNOSTIC_V02_READY_FOR_INTERPRETATION',
    ),

  eightRestorationEventsFrozen:
    check(
      matrix.rows.length,
      8,
      matrix.rows.length === 8,
    ),

  allContextsResolved:
    check(
      matrix.rows.filter(
        row => row.contextResolved,
      ).length,
      8,
      matrix.rows.every(
        row => row.contextResolved,
      ),
    ),

  exactXorPartition:
    check(
      {
        xor: matrix.xor,
        both: matrix.both,
        neither: matrix.neither,
      },
      {
        xor: 8,
        both: 0,
        neither: 0,
      },
      matrix.xor === 8
      && matrix.both === 0
      && matrix.neither === 0,
    ),

  quickSilverCount:
    check(
      matrix.quickSilver,
      4,
      matrix.quickSilver === 4,
    ),

  etherealBulletsCount:
    check(
      matrix.etherealBullets,
      4,
      matrix.etherealBullets === 4,
    ),

  quickSilverStaticEffectResolved:
    check(
      quickEvidence.length,
      '>0',
      quickEvidence.length > 0,
    ),

  etherealStaticEffectResolved:
    check(
      etherealEvidence.length,
      '>0',
      etherealEvidence.length > 0,
    ),

  runtimeParseClean:
    check(
      jsonlParseFailures,
      0,
      jsonlParseFailures === 0,
    ),

  testReplayOnly:
    check(
      script198v03?.replay,
      'test',
      script198v03?.replay === 'test',
    ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),
  replay: 'test',

  status:
    integrityPass
      ? 'DUAL_ITEM_AMMO_RESTORATION_HYPOTHESIS_V01_READY_FOR_INTERPRETATION'
      : 'DUAL_ITEM_AMMO_RESTORATION_HYPOTHESIS_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    hypothesisFormedAfter:
      'Script200 V02',

    candidateItems: [
      {
        itemId:
          QUICK_SILVER_ID,
        recordKey:
          QUICK_SILVER_KEY,
      },
      {
        itemId:
          ETHEREAL_BULLETS_ID,
        recordKey:
          ETHEREAL_BULLETS_KEY,
      },
    ],

    purpose:
      'freeze and characterize exact dual-item partition on test',

    causalAttribution:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  telemetry: {
    runtimeRows:
      runtimeRows.length,
    jsonlParseFailures,
    contextCount:
      contextIndex.size,
  },

  restorationMatrix:
    matrix,

  diagnostic,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      diagnostic.classification
        === 'QUICK_SILVER_AND_ETHEREAL_BULLETS_EXACTLY_PARTITION_ALL_EIGHT_TEST_RESTORATIONS'
        ? 'STRONG_TEST_ONLY_HYPOTHESIS_SUPPORT'
        : 'NOT_ESTABLISHED',

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    integrityPass
    && diagnostic.classification
      === 'QUICK_SILVER_AND_ETHEREAL_BULLETS_EXACTLY_PARTITION_ALL_EIGHT_TEST_RESTORATIONS'
      ? 'CHARACTERIZE_EACH_ITEM_TRIGGER_AND_AMMO_RELOAD_PERCENT_VALUE_ON_TEST;_THEN_FREEZE_EVENT_LEVEL_MAGNITUDE_PREDICTIONS_BEFORE_NEW_INDEPENDENT_REPLAYS'
      : 'DIAGNOSE_DUAL_ITEM_PARTITION_FAILURE_ON_TEST',
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

function pct(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(3)}%`
    : 'n/a';
}

function print(result) {
  const d =
    result.diagnostic;

  console.log(
    'RESTORATION EVENT MATRIX',
  );
  console.log(
    '------------------------',
  );

  for (
    const row
    of result.restorationMatrix.rows
  ) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} tick=${String(row.tick).padEnd(7)} context=${String(row.effectContextId).padEnd(20)} pair=${row.pairState.padEnd(22)} net=${String(row.logicalGain).padEnd(4)} grossIfShot=${String(row.grossRestorationIfOneShotConsumed).padEnd(4)} prevCap=${String(row.previousCapacity).padEnd(4)} currCap=${String(row.currentCapacity).padEnd(4)}`,
    );
  }

  console.log('');
  console.log(
    'PAIR COVERAGE',
  );
  console.log(
    '-------------',
  );
  console.log(
    JSON.stringify(
      d.pairCoverage,
    ),
  );

  console.log('');
  console.log(
    'SAME-HERO ATTACK EXPOSURE BY PAIR STATE',
  );
  console.log(
    '---------------------------------------',
  );

  for (
    const row
    of d.exposureRows
  ) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} state=${row.pairState.padEnd(22)} attacks=${String(row.attacks).padEnd(6)} restorations=${String(row.restorations).padEnd(3)} rate=${pct(row.restorationRate)}`,
    );
  }

  console.log('');
  console.log(
    'QUICK SILVER STATIC MECHANISM EVIDENCE',
  );
  console.log(
    '--------------------------------------',
  );

  for (
    const block
    of d.staticMechanismEvidence.quickSilver
  ) {
    console.log(
      `record=${block.recordKey} path=${block.path}`,
    );

    for (
      const row
      of block.relevantScalars
    ) {
      console.log(
        `  ${row.path} = ${JSON.stringify(row.value)}`,
      );
    }
  }

  console.log('');
  console.log(
    'ETHEREAL BULLETS STATIC MECHANISM EVIDENCE',
  );
  console.log(
    '------------------------------------------',
  );

  for (
    const block
    of d.staticMechanismEvidence.etherealBullets
  ) {
    console.log(
      `record=${block.recordKey} path=${block.path}`,
    );

    for (
      const row
      of block.relevantScalars
    ) {
      console.log(
        `  ${row.path} = ${JSON.stringify(row.value)}`,
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
