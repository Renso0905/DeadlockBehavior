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
  deriveDetailedAttackTransitions,
  groupDetailedWeaponEvents,
  normalizeDetailedWeaponEvent,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

import {
  BONUS_COMPOSITE_DIAGNOSTIC_THRESHOLDS,
  evaluateCompositeFormulas,
} from '../src/player-state/bonus-clip-composite-diagnostic.mjs';

const VERSION =
  'BONUS_CLIP_COMPOSITE_COUNTER_DIAGNOSTIC_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script185:
    resolve(
      'output',
      'cross_replay',
      'slide_carrier_absent_residual_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'bonus_clip_composite_counter_diagnostic_v01.json',
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

const script185 =
  JSON.parse(
    readFileSync(
      PATHS.script185,
      'utf8',
    ),
  );

const EXPECTED_185_STATUS =
  'SLIDE_CARRIER_ABSENT_RESIDUAL_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort,
  )
    ? manifest.selectedReplicationCohort
      .map(row => String(row.replayName))
    : [];

if (cohort.length !== 5) {
  throw new Error(
    `Expected five consumed replication replays, found ${cohort.length}.`,
  );
}

console.log('');
console.log(
  '========================================================',
);
console.log(
  'BONUS-CLIP COMPOSITE COUNTER DIAGNOSTIC V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Candidate formulas: Z+B and Z-B only',
);
console.log(
  'Carrier retuned: NO',
);
console.log(
  'Replication cohort fresh: NO',
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const allRows = [];
const replayIntegrity = [];

for (const replayName of cohort) {
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
    replayIntegrity.push({
      replayName,
      pass: false,
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
      byTick.set(row.tick, []);
    }

    byTick.get(row.tick).push(row);
  }

  const pawnStateByEntity =
    new Map();

  const tickGuard =
    createAttackTickGuard();

  let joined = 0;
  let joinFailures = 0;

  const replayRows = [];

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

  const pass =
    parseFailures === 0
    && joinFailures === 0
    && joined === transitions.length;

  replayIntegrity.push({
    replayName,
    pass,
    transitions:
      transitions.length,
    joined,
    joinFailures,
    parseFailures,
  });

  allRows.push(
    ...replayRows,
  );

  console.log(
    `${replayName}: transitions=${transitions.length} joined=${joined}/${transitions.length}`,
  );
}

const diagnostic =
  evaluateCompositeFormulas(
    allRows,
    BONUS_COMPOSITE_DIAGNOSTIC_THRESHOLDS,
  );

const checks = {
  script185Ready:
    check(
      script185?.status,
      EXPECTED_185_STATUS,
      script185?.status
        === EXPECTED_185_STATUS,
    ),

  carrierStillFrozen:
    check(
      PRIMARY_SLIDE_AMMO_CARRIER,
      {
        field:
          'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
        bit: 5,
        mask: 32,
      },
      PRIMARY_SLIDE_AMMO_CARRIER.field
        === 'm_pModifierProp.m_bvEnabledPredictedStateMask.0002'
      && PRIMARY_SLIDE_AMMO_CARRIER.bit === 5
      && PRIMARY_SLIDE_AMMO_CARRIER.mask === 32,
    ),

  allFiveIntegrityPass:
    check(
      replayIntegrity.filter(
        row => row.pass,
      ).length,
      5,
      replayIntegrity.length === 5
      && replayIntegrity.every(
        row => row.pass,
      ),
    ),

  cohortExplicitlyNotFresh:
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
      ? 'BONUS_CLIP_COMPOSITE_COUNTER_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'BONUS_CLIP_COMPOSITE_COUNTER_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    authorityPromotion:
      false,

    carrierRetuned:
      false,

    replicationCohortFresh:
      false,

    formulasPreSpecified: [
      'Z_PLUS_B',
      'Z_MINUS_B',
    ],

    purpose:
      'diagnose whether m_iBonusClip is a second runtime ammo-counter component that explains Script184 carrier-absent residuals',
  },

  thresholds:
    BONUS_COMPOSITE_DIAGNOSTIC_THRESHOLDS,

  replayIntegrity,

  diagnostic,

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
      'consumed_cohort_diagnostic',
  },

  nextStep:
    diagnostic.classification
      .includes(
        'STRONG_REPRESENTATION_CORRECTION_CANDIDATE',
      )
      ? 'FREEZE_THE_IDENTIFIED_COMPOSITE_AS_A_NEW_HYPOTHESIS_ON_TEST_OR_A_NEW_DISCOVERY_REPLAY;_DO_NOT_REUSE_REP01_REP05_AS_INDEPENDENT_VALIDATION'
      : 'KEEP_ZIGZAG_AND_BONUS_CLIP_SEPARATE;_NEXT_DIAGNOSE_HERO13_65_63_ZERO_MECHANISMS_AND_HERO35_27_NEGATIVE_REFILL_MECHANISMS',
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
  const d =
    result.diagnostic;

  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'BONUS-CLIP COMPOSITE SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `carrier-absent rows:                  ${d.totalCarrierAbsent}`,
  );
  console.log(
    `bonus-delta covered:                  ${d.bonusDeltaCovered} (${percent(d.bonusDeltaCoverageRate)})`,
  );
  console.log(
    `baseline residual:                    ${d.baselineResidual}`,
  );
  console.log(
    `residual with bonus change:           ${d.residualWithBonusChange}`,
  );
  console.log('');

  for (
    const formulaName
    of ['BASELINE_Z', 'Z_PLUS_B', 'Z_MINUS_B']
  ) {
    const row =
      d.results[formulaName];

    console.log(
      `${formulaName.padEnd(12)} total=${String(row.total).padEnd(7)} positive=${String(row.positive).padEnd(7)} (${percent(row.positiveRate)}) zero=${String(row.zero).padEnd(5)} negative=${String(row.negative).padEnd(5)} resolvedResidual=${String(row.resolvedResidual).padEnd(5)} resolution=${percent(row.residualResolutionRate).padEnd(8)} harmedPositive=${String(row.harmedPositive).padEnd(5)} harm=${percent(row.positiveControlHarmRate)}`,
    );
  }

  console.log('');
  console.log(
    'TOP HERO BONUS-COMPOSITE DIAGNOSTICS',
  );
  console.log(
    '------------------------------------',
  );

  for (
    const row
    of d.byHero.slice(0, 20)
  ) {
    console.log(
      `hero=${row.key.padEnd(4)} residual=${String(row.baselineResidual).padEnd(5)} bonusChanged=${String(row.residualWithBonusChange).padEnd(5)} plusResolved=${String(row.plusResolved).padEnd(5)} (${percent(row.plusResolutionRate)}) minusResolved=${String(row.minusResolved).padEnd(5)} (${percent(row.minusResolutionRate)})`,
    );
  }

  console.log('');
  console.log(
    'TOP RESIDUAL JOINT PATTERNS',
  );
  console.log(
    '---------------------------',
  );

  for (
    const row
    of d.topJointPatterns.slice(0, 30)
  ) {
    console.log(
      `${row.pattern} count=${row.count}`,
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
      result.integrityValidation.checks,
    )
  ) {
    console.log(
      `${name.padEnd(40)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
