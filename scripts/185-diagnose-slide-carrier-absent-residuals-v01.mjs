import {
  createReadStream,
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
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

import {
  flattenPrimitiveChanges,
} from '../src/player-state/slide-carrier-discovery.mjs';

import {
  createAttackTickGuard,
  resolvePawnForHero,
} from '../src/player-state/slide-carrier-controller-join.mjs';

import {
  evaluateCarrierState,
  PRIMARY_SLIDE_AMMO_CARRIER,
} from '../src/player-state/slide-infinite-ammo-validation.mjs';

import {
  classifyResidualConcentration,
  deriveDetailedAttackTransitions,
  groupDetailedWeaponEvents,
  normalizeDetailedWeaponEvent,
  summarizeCarrierAbsentResiduals,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

const VERSION =
  'SLIDE_CARRIER_ABSENT_RESIDUAL_DIAGNOSTIC_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script184:
    resolve(
      'output',
      'cross_replay',
      'slide_infinite_ammo_cross_replay_validation_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'slide_carrier_absent_residual_diagnostic_v01.json',
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

const manifest =
  JSON.parse(
    readFileSync(
      PATHS.manifest,
      'utf8',
    ),
  );

const script184 =
  JSON.parse(
    readFileSync(
      PATHS.script184,
      'utf8',
    ),
  );

const EXPECTED_184_STATUS =
  'SLIDE_INFINITE_AMMO_CROSS_REPLAY_VALIDATION_V01_REQUIRES_DIAGNOSIS';

const EXPECTED_184_CLASSIFICATION =
  'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_CONTRADICTED_IN_INDEPENDENT_REPLAY';

const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort,
  )
    ? manifest.selectedReplicationCohort
      .map(row => String(row.replayName))
    : [];

if (cohort.length !== 5) {
  throw new Error(
    `Expected five frozen replication replays, found ${cohort.length}.`,
  );
}

console.log('');
console.log(
  '========================================================',
);
console.log(
  'SLIDE-CARRIER ABSENT RESIDUAL DIAGNOSTIC V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  `Frozen carrier unchanged: ${PRIMARY_SLIDE_AMMO_CARRIER.field} bit=${PRIMARY_SLIDE_AMMO_CARRIER.bit}`,
);
console.log(
  'Purpose: diagnose Script184 composite contradiction',
);
console.log(
  'Authority promotion: NO',
);
console.log(
  'Replication cohort treated as fresh: NO',
);
console.log('');

const allRows = [];
const replayDiagnostics = [];

for (
  let index = 0;
  index < cohort.length;
  index++
) {
  const replayName =
    cohort[index];

  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`,
    );

  const weaponPath =
    resolve(
      'output',
      replayName,
      'effective_weapon_runtime_events_v01.jsonl',
    );

  if (
    !existsSync(replayPath)
    || !existsSync(weaponPath)
  ) {
    replayDiagnostics.push({
      replayName,
      integrityPass: false,
      reason:
        'MISSING_REQUIRED_INPUT',
    });
    continue;
  }

  const weaponEvents = [];
  let parseFailures = 0;

  for await (
    const line
    of readLines(weaponPath)
  ) {
    if (!line.trim()) continue;

    try {
      weaponEvents.push(
        normalizeDetailedWeaponEvent(
          JSON.parse(line),
          weaponEvents.length,
        ),
      );
    } catch {
      parseFailures++;
    }
  }

  const transitions =
    deriveDetailedAttackTransitions(
      groupDetailedWeaponEvents(
        weaponEvents,
      ),
    );

  const byTick =
    new Map();

  for (const row of transitions) {
    if (!byTick.has(row.tick)) {
      byTick.set(
        row.tick,
        [],
      );
    }

    byTick.get(row.tick)
      .push(row);
  }

  const pawnStateByEntity =
    new Map();

  const tickGuard =
    createAttackTickGuard();

  const replayRows = [];

  let joined = 0;
  let joinFailures = 0;

  const config =
    new ParserConfiguration({
      entityClasses: [
        'CCitadelPlayerController',
        'CCitadelPlayerPawn',
      ],
    });

  const parser =
    new Parser(
      config,
      Logger.CONSOLE_INFO,
    );

  parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (
      demoPacket,
      messagePacket,
      events,
    ) => {
      for (const event of events) {
        if (
          event.operation !== EntityOperation.CREATE
          && event.operation !== EntityOperation.UPDATE
        ) {
          continue;
        }

        const entity =
          event.entity;

        if (
          entity?.class?.name
          !== 'CCitadelPlayerPawn'
        ) {
          continue;
        }

        if (
          !pawnStateByEntity.has(
            entity.index,
          )
        ) {
          pawnStateByEntity.set(
            entity.index,
            {},
          );
        }

        Object.assign(
          pawnStateByEntity.get(
            entity.index,
          ),
          flattenPrimitiveChanges(
            event.getChanges(),
          ),
        );
      }
    },
  );

  parser.registerPostInterceptor(
    InterceptorStage.DEMO_PACKET,
    demoPacket => {
      const tick =
        demoPacket.tick;

      if (!byTick.has(tick)) {
        return;
      }

      if (!tickGuard.shouldProcess(tick)) {
        return;
      }

      const demo =
        parser.getDemo();

      const controllers =
        demo.getEntitiesByClassName(
          'CCitadelPlayerController',
        );

      for (const transition of byTick.get(tick)) {
        const resolution =
          resolvePawnForHero({
            demo,
            controllers,
            heroId:
              transition.heroId,
          });

        if (!resolution.pawn) {
          joinFailures++;
          continue;
        }

        const state =
          pawnStateByEntity.get(
            resolution.pawn.index,
          );

        if (!state) {
          joinFailures++;
          continue;
        }

        joined++;

        const carrier =
          evaluateCarrierState(
            state,
            PRIMARY_SLIDE_AMMO_CARRIER,
          );

        replayRows.push({
          replayName,
          ...transition,
          covered:
            carrier.covered,
          carrierPresent:
            carrier.present,
          carrierValue:
            carrier.value,
        });
      }
    },
  );

  try {
    await parser.parse(
      createReadStream(
        replayPath,
      ),
    );
  } finally {
    await parser.dispose();
  }

  const integrityPass =
    parseFailures === 0
    && joined + joinFailures
      === transitions.length
    && joined === transitions.length;

  const summary =
    summarizeCarrierAbsentResiduals(
      replayRows,
    );

  replayDiagnostics.push({
    replayName,
    integrityPass,
    parseFailures,
    transitions:
      transitions.length,
    joined,
    joinFailures,
    summary,
  });

  allRows.push(...replayRows);

  console.log(
    `${replayName}: transitions=${transitions.length} joined=${joined}/${transitions.length} absent=${summary.total} zero=${summary.partition.ZERO} negative=${summary.partition.NEGATIVE}`,
  );
}

const pooled =
  summarizeCarrierAbsentResiduals(
    allRows,
  );

const classification =
  classifyResidualConcentration(
    pooled,
  );

const checks = {
  script184StatusExpected:
    check(
      script184?.status,
      EXPECTED_184_STATUS,
      script184?.status
        === EXPECTED_184_STATUS,
    ),

  script184ClassificationExpected:
    check(
      script184
        ?.replication
        ?.classification,
      EXPECTED_184_CLASSIFICATION,
      script184
        ?.replication
        ?.classification
        === EXPECTED_184_CLASSIFICATION,
    ),

  carrierUnchanged:
    check(
      script184?.frozenCarrier,
      PRIMARY_SLIDE_AMMO_CARRIER,
      script184
        ?.frozenCarrier
        ?.field
        === PRIMARY_SLIDE_AMMO_CARRIER.field
      && script184
        ?.frozenCarrier
        ?.bit
        === PRIMARY_SLIDE_AMMO_CARRIER.bit
      && script184
        ?.frozenCarrier
        ?.mask
        === PRIMARY_SLIDE_AMMO_CARRIER.mask,
    ),

  allFiveReplaysDiagnosed:
    check(
      replayDiagnostics.length,
      5,
      replayDiagnostics.length === 5,
    ),

  allReplayIntegrityPass:
    check(
      replayDiagnostics.filter(
        row => row.integrityPass,
      ).length,
      5,
      replayDiagnostics.every(
        row => row.integrityPass,
      ),
    ),

  replicationCohortNotReclassifiedAsFresh:
    check(
      false,
      false,
      true,
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

  status:
    integrityPass
      ? 'SLIDE_CARRIER_ABSENT_RESIDUAL_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'SLIDE_CARRIER_ABSENT_RESIDUAL_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    script184CompositeResult:
      'contradicted',

    carrierRetuned:
      false,

    thresholdsRetuned:
      false,

    authorityPromotion:
      false,

    replicationCohortFreshForNewHypotheses:
      false,

    purpose:
      'diagnose carrier-absent residual ZERO and NEGATIVE whole-clip attack transitions only',
  },

  frozenCarrier:
    PRIMARY_SLIDE_AMMO_CARRIER,

  replays:
    replayDiagnostics,

  pooled,

  classification,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'DIAGNOSTIC_ONLY',
    authorityPromotion:
      false,
    replicationStatus:
      'replication_cohort_consumed_for_diagnosis',
  },

  nextStep:
    'INTERPRET_HERO_CONTEXT_AND_WEAPON_STATE_CONCENTRATION;_IF_A_NEW_MECHANISM_HYPOTHESIS_IS_FORMED_FREEZE_IT_ON_TEST_OR_A_NEW_DISCOVERY_REPLAY_BEFORE_ANY_NEW_INDEPENDENT_REPLICATION',
};

mkdirSync(
  dirname(PATHS.output),
  {
    recursive: true,
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

async function* readLines(path) {
  const {
    createInterface,
  } = await import(
    'node:readline'
  );

  const reader =
    createInterface({
      input:
        createReadStream(
          path,
          {
            encoding:
              'utf8',
          },
        ),
      crlfDelay:
        Infinity,
    });

  for await (const line of reader) {
    yield line;
  }
}

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
    ? `${(value * 100).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'POOLED CARRIER-ABSENT RESIDUALS',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `carrier-absent transitions:          ${result.pooled.total}`,
  );
  console.log(
    `positive:                            ${result.pooled.partition.POSITIVE}`,
  );
  console.log(
    `zero residual:                       ${result.pooled.partition.ZERO} (${percent(result.pooled.residual.zeroRate)})`,
  );
  console.log(
    `negative residual:                   ${result.pooled.partition.NEGATIVE} (${percent(result.pooled.residual.negativeRate)})`,
  );
  console.log('');

  console.log(
    'TOP HERO RESIDUAL CONCENTRATION',
  );
  console.log(
    '-------------------------------',
  );

  for (
    const row
    of result.pooled.byHero.slice(0, 20)
  ) {
    console.log(
      `hero=${row.key.padEnd(4)} total=${String(row.total).padEnd(7)} zero=${String(row.zero).padEnd(5)} negative=${String(row.negative).padEnd(4)} zeroRate=${percent(row.zeroRate).padEnd(8)} residualShare=${percent(row.residualShare)}`,
    );
  }

  console.log('');
  console.log(
    'TOP EFFECT-CONTEXT RESIDUAL CONCENTRATION',
  );
  console.log(
    '-----------------------------------------',
  );

  for (
    const row
    of result.pooled.byEffectContext.slice(0, 20)
  ) {
    console.log(
      `${String(row.key).slice(0, 64).padEnd(64)} total=${String(row.total).padEnd(7)} zero=${String(row.zero).padEnd(5)} negative=${String(row.negative).padEnd(4)} residualShare=${percent(row.residualShare)}`,
    );
  }

  console.log('');
  console.log(
    'TOP HERO × EFFECT-CONTEXT RESIDUALS',
  );
  console.log(
    '-----------------------------------',
  );

  for (
    const row
    of result.pooled.byHeroEffectContext.slice(0, 25)
  ) {
    console.log(
      `${String(row.key).slice(0, 72).padEnd(72)} total=${String(row.total).padEnd(7)} zero=${String(row.zero).padEnd(5)} negative=${String(row.negative).padEnd(4)} residualShare=${percent(row.residualShare)}`,
    );
  }

  console.log('');
  console.log(
    'WEAPON-STATE FEATURE ENRICHMENT',
  );
  console.log(
    '-------------------------------',
  );

  for (
    const [name, row]
    of Object.entries(
      result.pooled.features,
    )
  ) {
    console.log(
      `${name.padEnd(28)} residual=${percent(row.residualRate).padEnd(8)} positive=${percent(row.positiveRate).padEnd(8)} RD=${percent(row.riskDifference)}`,
    );
  }

  console.log('');
  console.log(
    'ZERO-RUN STRUCTURE',
  );
  console.log(
    '------------------',
  );
  console.log(
    JSON.stringify(
      result.pooled.zeroRuns,
    ),
  );

  console.log('');
  console.log(
    'NEGATIVE WHOLE-DROP MAGNITUDE',
  );
  console.log(
    '-----------------------------',
  );
  console.log(
    JSON.stringify(
      result.pooled.negativeWholeDrop,
    ),
  );

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
      `${name.padEnd(46)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
    result.classification,
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
