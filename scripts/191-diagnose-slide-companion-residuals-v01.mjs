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
  deepFindExactKey,
  normalizeDetailedWeaponEvent,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

import {
  deriveStrictAttackTransitions,
  groupStrictWeaponChronology,
} from '../src/player-state/strict-ammo-chronology-diagnostic.mjs';

import {
  COMPANIONS,
  PRIMARY,
  evaluateBitState,
  summarizeCompanionResiduals,
} from '../src/player-state/slide-companion-residual-diagnostic.mjs';

const VERSION =
  'SLIDE_COMPANION_STRICT_RESIDUAL_DIAGNOSTIC_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script190:
    resolve(
      'output',
      'cross_replay',
      'strict_ammo_chronology_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'slide_companion_strict_residual_diagnostic_v01.json',
    ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const manifest =
  JSON.parse(
    readFileSync(
      PATHS.manifest,
      'utf8',
    ),
  );

const script190 =
  JSON.parse(
    readFileSync(
      PATHS.script190,
      'utf8',
    ),
  );

const EXPECTED_190_STATUS =
  'STRICT_AMMO_CHRONOLOGY_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort,
  )
    ? manifest.selectedReplicationCohort
      .map(row => String(row.replayName))
    : [];

if (cohort.length !== 5) {
  throw new Error(
    `Expected five consumed cohort replays, found ${cohort.length}.`,
  );
}

console.log('');
console.log('========================================================');
console.log('SLIDE COMPANION STRICT-RESIDUAL DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log(`Primary unchanged: ${PRIMARY.field} bit=${PRIMARY.bit}`);
console.log(
  `Companions: ${COMPANIONS.map(c => `${c.field} bit=${c.bit}`).join(' ; ')}`,
);
console.log('Carrier union promotion: NO');
console.log('Consumed cohort treated as fresh validation: NO');
console.log('');

const allRows = [];
const replayIntegrity = [];

for (const replayName of cohort) {
  const replayPath =
    resolve('replays', `${replayName}.dem`);

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
      reason: 'MISSING_REQUIRED_INPUT',
    });
    continue;
  }

  const weaponEvents = [];
  let parseFailures = 0;

  for await (const line of readLines(weaponPath)) {
    if (!line.trim()) continue;

    try {
      const raw = JSON.parse(line);
      const base =
        normalizeDetailedWeaponEvent(
          raw,
          weaponEvents.length,
        );

      weaponEvents.push({
        ...base,
        reloadAvailableTime:
          finite(firstDefined(
            raw?.observedWeaponState
              ?.reloadAvailableTime,
            deepFindExactKey(
              raw,
              'm_flReloadAvailableTime',
            ),
          )),
        lastReloadStartTime:
          finite(firstDefined(
            raw?.observedWeaponState
              ?.lastReloadStartTime,
            deepFindExactKey(
              raw,
              'm_flLastReloadStartTime',
            ),
          )),
        reloadQueuedStartTime:
          finite(firstDefined(
            raw?.observedWeaponState
              ?.reloadQueuedStartTime,
            deepFindExactKey(
              raw,
              'm_reloadQueuedStartTime',
            ),
          )),
      });
    } catch {
      parseFailures++;
    }
  }

  const transitions =
    deriveStrictAttackTransitions(
      groupStrictWeaponChronology(
        weaponEvents,
      ),
    );

  const byTick = new Map();

  for (const row of transitions) {
    if (!byTick.has(row.tick)) {
      byTick.set(row.tick, []);
    }
    byTick.get(row.tick).push(row);
  }

  const pawnStateByEntity = new Map();
  const tickGuard = createAttackTickGuard();

  let joined = 0;
  let joinFailures = 0;
  const replayRows = [];

  const parser =
    new Parser(
      new ParserConfiguration({
        entityClasses: [
          'CCitadelPlayerController',
          'CCitadelPlayerPawn',
        ],
      }),
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

        const entity = event.entity;

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
      const tick = demoPacket.tick;

      if (!byTick.has(tick)) return;
      if (!tickGuard.shouldProcess(tick)) return;

      const demo = parser.getDemo();

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

        const primary =
          evaluateBitState(
            state,
            PRIMARY,
          );

        const companions = {};

        for (const companion of COMPANIONS) {
          companions[companion.id] =
            evaluateBitState(
              state,
              companion,
            );
        }

        replayRows.push({
          replayName,
          ...transition,
          primaryCovered:
            primary.covered,
          primaryPresent:
            primary.present,
          companions,
        });
      }
    },
  );

  try {
    await parser.parse(
      createReadStream(replayPath),
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

  allRows.push(...replayRows);

  console.log(
    `${replayName}: strictTransitions=${transitions.length} joined=${joined}/${transitions.length}`,
  );
}

const diagnostic =
  summarizeCompanionResiduals(
    allRows,
  );

const checks = {
  script190Ready:
    check(
      script190?.status,
      EXPECTED_190_STATUS,
      script190?.status
        === EXPECTED_190_STATUS,
    ),

  strictResidualFrozen:
    check(
      script190?.strict?.residual,
      252,
      script190?.strict?.residual === 252,
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

  primaryNotRetuned:
    check(
      PRIMARY,
      {
        field:
          'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
        bit: 5,
        mask: 32,
      },
      PRIMARY.bit === 5
      && PRIMARY.mask === 32,
    ),

  consumedCohortStillNotIndependent:
    check(false, false, true),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

let classification;

if (
  diagnostic.union.zeroCaptureRate !== null
  && diagnostic.union.zeroCaptureRate >= 0.50
  && diagnostic.union.positivePresentRate !== null
  && diagnostic.union.positivePresentRate <= 0.01
) {
  classification =
    'COMPANION_BITS_EXPLAIN_SUBSTANTIAL_PRIMARY_CARRIER_FALSE_NEGATIVES';
} else if (
  diagnostic.union.zeroCaptureRate !== null
  && diagnostic.union.zeroCaptureRate >= 0.10
) {
  classification =
    'COMPANION_BITS_EXPLAIN_MINOR_PRIMARY_CARRIER_FALSE_NEGATIVES';
} else {
  classification =
    'STRICT_ZERO_RESIDUALS_ARE_NOT_EXPLAINED_BY_KNOWN_COMPANION_BITS';
}

const result = {
  version:
    VERSION,
  canonical:
    false,
  createdAt:
    new Date().toISOString(),

  status:
    integrityPass
      ? 'SLIDE_COMPANION_STRICT_RESIDUAL_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'SLIDE_COMPANION_STRICT_RESIDUAL_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    primaryCarrier:
      PRIMARY,
    companions:
      COMPANIONS,
    carrierRetuned:
      false,
    unionPromoted:
      false,
    independentValidation:
      false,
    authorityPromotion:
      false,
  },

  replayIntegrity,
  diagnostic,
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
      'not_independent',
  },

  nextStep:
    classification
      === 'STRICT_ZERO_RESIDUALS_ARE_NOT_EXPLAINED_BY_KNOWN_COMPANION_BITS'
      ? 'DIAGNOSE_REMAINING_STRICT_ZERO_ATTACKS_BY_OTHER_RUNTIME_MODIFIER_BITS_AND_KNOWN_GAMEPLAY_MECHANICS_ON_TEST_OR_NEW_DISCOVERY_DATA'
      : 'CHARACTERIZE_COMPANION_ONLY_STATES_ON_TEST_BEFORE_ANY_CARRIER_UNION_HYPOTHESIS',
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
          { encoding: 'utf8' },
        ),
      crlfDelay: Infinity,
    });

  for await (const line of reader) {
    yield line;
  }
}

function firstDefined(...values) {
  return values.find(
    value =>
      value !== undefined
      && value !== null,
  );
}

function finite(value) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number)
    ? number
    : null;
}

function check(actual, expected, pass) {
  return {
    actual,
    expected,
    pass: Boolean(pass),
  };
}

function percent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  const d = result.diagnostic;

  console.log('');
  console.log('========================================================');
  console.log('COMPANION-BIT RESIDUAL SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `primary-absent strict attacks:       ${d.primaryAbsent}`,
  );
  console.log(
    `baseline positive/zero/negative:     ${d.baseline.positive}/${d.baseline.zero}/${d.baseline.negative}`,
  );
  console.log('');

  for (
    const [id, row]
    of Object.entries(d.companions)
  ) {
    console.log(`${id}`);
    console.log(
      `  zero captured:                     ${row.zeroCaptured} (${percent(row.zeroCaptureRate)})`,
    );
    console.log(
      `  negative captured:                 ${row.negativeCaptured} (${percent(row.negativeCaptureRate)})`,
    );
    console.log(
      `  positive controls present:         ${row.positivePresent} (${percent(row.positivePresentRate)})`,
    );
    console.log(
      `  P(zero | companion present):       ${percent(row.pZeroGivenPresent)}`,
    );
  }

  console.log('');
  console.log('UNION OF KNOWN COMPANIONS');
  console.log('-------------------------');
  console.log(
    `zero captured:                       ${d.union.zeroCaptured} (${percent(d.union.zeroCaptureRate)})`,
  );
  console.log(
    `negative captured:                   ${d.union.negativeCaptured} (${percent(d.union.negativeCaptureRate)})`,
  );
  console.log(
    `positive controls present:           ${d.union.positivePresent} (${percent(d.union.positivePresentRate)})`,
  );
  console.log(
    `P(zero | union present):             ${percent(d.union.pZeroGivenUnionPresent)}`,
  );

  console.log('');
  console.log('BY HERO');
  console.log('-------');

  for (const row of d.byHero.slice(0, 25)) {
    console.log(
      `hero=${row.heroId.padEnd(4)} zero=${String(row.zero).padEnd(4)} companionZero=${String(row.companionZero).padEnd(4)} capture=${percent(row.zeroCaptureRate)}`,
    );
  }

  console.log('');
  console.log('TOP COMPANION-ONLY PATTERNS');
  console.log('---------------------------');

  for (
    const row
    of d.topCompanionOnlyPatterns.slice(0, 30)
  ) {
    console.log(
      `${row.pattern} count=${row.count}`,
    );
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
  console.log(result.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
