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
  indexObjectsByScalar,
  mergeCoherentRestorationRows,
  summarizeRestorationContextsV02,
} from '../src/player-state/ammo-restoration-context-discovery-v02.mjs';

const VERSION =
  'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02';

const PATHS = {
  script197:
    resolve(
      'output',
      'test',
      'phase_corrected_ammo_residual_audit_v01.json',
    ),

  script198v03:
    resolve(
      'output',
      'test',
      'ammo_fraction_coherence_diagnostic_v03.json',
    ),

  weaponSubstrate:
    resolve(
      'output',
      'test',
      'effective_weapon_state_substrate_v01.json',
    ),

  weaponEvents:
    resolve(
      'output',
      'test',
      'effective_weapon_runtime_events_v01.jsonl',
    ),

  output:
    resolve(
      'output',
      'test',
      'ammo_restoration_context_discovery_v02.json',
    ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;

  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script197 =
  JSON.parse(
    readFileSync(
      PATHS.script197,
      'utf8',
    ),
  );

const script198v03 =
  JSON.parse(
    readFileSync(
      PATHS.script198v03,
      'utf8',
    ),
  );

const substrate =
  JSON.parse(
    readFileSync(
      PATHS.weaponSubstrate,
      'utf8',
    ),
  );

const EXPECTED_V03_STATUS =
  'AMMO_FRACTION_COHERENCE_DIAGNOSTIC_V03_READY_FOR_INTERPRETATION';

const EXPECTED_V03_CLASSIFICATION =
  'FRACTION_ROLLBACK_AND_COHERENT_RESTORATION_PARTITION_SELF_CONSISTENT_V03';

console.log('');
console.log('========================================================');
console.log('AMMO RESTORATION CONTEXT DISCOVERY V0.2');
console.log('========================================================');
console.log('');
console.log('Replay: test');
console.log('Input fraction diagnostic: Script198 V03');
console.log('Expected coherent restoration events: 8');
console.log('Automatic item attribution: NO');
console.log('Automatic ability attribution: NO');
console.log('Authority promotion: NO');
console.log('');

const merge =
  mergeCoherentRestorationRows({
    script197Rows:
      script197?.audit?.exactRows ?? [],

    script198v03Rows:
      script198v03?.diagnostic?.negative?.rows ?? [],
  });

const coherentRows = merge.merged;

const coherentKeys =
  new Set(
    coherentRows.map(
      row =>
        `${Number(row.heroId)}|${Number(row.tick)}`,
    ),
  );

const contextIds =
  new Set(
    coherentRows
      .map(row => row.effectContextId)
      .filter(
        value =>
          value !== null
          && value !== undefined,
      ),
  );

const contextMatches =
  indexObjectsByScalar(
    substrate,
    contextIds,
  );

const rawEventMatches = [];

const reader =
  createInterface({
    input:
      createReadStream(
        PATHS.weaponEvents,
        { encoding: 'utf8' },
      ),
    crlfDelay: Infinity,
  });

let jsonlParseFailures = 0;

for await (const line of reader) {
  if (!line.trim()) continue;

  try {
    const raw = JSON.parse(line);

    const tick =
      Number(
        raw?.tick
        ?? raw?.demoTick
        ?? raw?.gameTick,
      );

    if (!Number.isFinite(tick)) continue;

    const heroId =
      Number(
        raw?.heroId
        ?? raw?.playerState?.heroId
        ?? raw?.observedRuntime?.heroId
        ?? deepFindFirstKey(raw, 'heroId'),
      );

    const key =
      `${heroId}|${tick}`;

    if (!coherentKeys.has(key)) {
      continue;
    }

    rawEventMatches.push({
      tick,
      heroId,
      raw,
    });
  } catch {
    jsonlParseFailures++;
  }
}

const diagnostic =
  summarizeRestorationContextsV02({
    coherentRows,
    contextMatches,
    rawEventMatches,
  });

const checks = {
  script198V03Ready:
    check(
      script198v03?.status,
      EXPECTED_V03_STATUS,
      script198v03?.status === EXPECTED_V03_STATUS,
    ),

  script198V03ClassificationExpected:
    check(
      script198v03?.diagnostic?.classification,
      EXPECTED_V03_CLASSIFICATION,
      script198v03?.diagnostic?.classification
        === EXPECTED_V03_CLASSIFICATION,
    ),

  script198V03IntegrityPass:
    check(
      script198v03?.integrityValidation?.pass,
      true,
      script198v03?.integrityValidation?.pass === true,
    ),

  coherentEventCountFrozen:
    check(
      merge.coherentCount,
      8,
      merge.coherentCount === 8,
    ),

  allCoherentEventsMerged:
    check(
      {
        coherent: merge.coherentCount,
        merged: merge.mergedCount,
        missing: merge.missingCount,
      },
      {
        coherent: 8,
        merged: 8,
        missing: 0,
      },
      merge.coherentCount === 8
      && merge.mergedCount === 8
      && merge.missingCount === 0,
    ),

  jsonlParseClean:
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
      ? 'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_READY_FOR_INTERPRETATION'
      : 'AMMO_RESTORATION_CONTEXT_DISCOVERY_V02_INTEGRITY_FAILURE',

  scientificBoundary: {
    inputFractionDiagnostic:
      'Script198 V03',
    coherentRestorationEventCount: 8,
    automaticItemAttribution: false,
    automaticAbilityAttribution: false,
    authorityPromotion: false,
    replicationStatus:
      'discovery_calibration_only',
  },

  merge,

  telemetry: {
    contextIds: [...contextIds],
    rawEventMatches: rawEventMatches.length,
    jsonlParseFailures,
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
      === 'REPEATED_RESTORATION_CONTEXTS_AVAILABLE_FOR_ATTRIBUTION_V02'
      ? 'INTERPRET_REPEATED_CONTEXT_PAYLOADS;_FREEZE_SPECIFIC_ITEM_OR_ABILITY_ATTRIBUTION_ONLY_WHEN_REPEATED_EVENTS_SHARE_THE_SAME_MECHANISTIC_CONTEXT'
      : 'TRACE_EXACT_HERO_ABILITY_AND_ITEM_OWNERSHIP_STATE_AT_EACH_RESTORATION_TICK',
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

function deepFindFirstKey(
  root,
  wantedKey,
) {
  const seen = new WeakSet();
  let found;

  function visit(value) {
    if (
      found !== undefined
      || value === null
      || typeof value !== 'object'
    ) {
      return;
    }

    if (seen.has(value)) return;
    seen.add(value);

    if (
      !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(
        value,
        wantedKey,
      )
    ) {
      found = value[wantedKey];
      return;
    }

    for (
      const child
      of Array.isArray(value)
        ? value
        : Object.values(value)
    ) {
      visit(child);
    }
  }

  visit(root);
  return found;
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

function print(result) {
  const d = result.diagnostic;

  console.log('');
  console.log('========================================================');
  console.log('RESTORATION CONTEXT SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `coherent restoration events:         ${d.coherentEventCount}`,
  );
  console.log(
    `distinct effect contexts:            ${d.contextCount}`,
  );
  console.log(
    `repeated contexts:                   ${d.repeatedContextCount}`,
  );
  console.log('');

  for (const row of d.contexts) {
    console.log(
      `context=${row.effectContextId} events=${row.eventCount} heroes=${JSON.stringify(row.heroes)} ticks=${JSON.stringify(row.ticks)} net=${JSON.stringify(row.netGains)} grossIfShot=${JSON.stringify(row.grossRestorationCandidates)}`,
    );
    console.log(
      `  staticMatches=${row.staticMatchCount} rawMatches=${row.rawEventMatchCount}`,
    );
    console.log(
      `  strings=${JSON.stringify(row.interestingStrings)}`,
    );

    for (const match of row.staticProjections) {
      console.log(
        `  static ${match.path}: ${JSON.stringify(match.projection)}`,
      );
    }

    for (const match of row.rawEventProjections) {
      console.log(
        `  raw tick=${match.tick} hero=${match.heroId}: ${JSON.stringify(match.projection)}`,
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
      `${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
