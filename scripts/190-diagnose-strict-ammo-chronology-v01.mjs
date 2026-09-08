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
  deepFindExactKey,
  normalizeDetailedWeaponEvent,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

import {
  compareLegacyAndStrict,
  deriveStrictAttackTransitions,
  groupStrictWeaponChronology,
  summarizeStrictChronology,
} from '../src/player-state/strict-ammo-chronology-diagnostic.mjs';

const VERSION =
  'STRICT_AMMO_CHRONOLOGY_DIAGNOSTIC_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script189:
    resolve(
      'output',
      'cross_replay',
      'combined_ammo_residual_provenance_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'strict_ammo_chronology_diagnostic_v01.json',
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

const script189 =
  JSON.parse(
    readFileSync(
      PATHS.script189,
      'utf8',
    ),
  );

const EXPECTED_189_STATUS =
  'COMBINED_AMMO_RESIDUAL_PROVENANCE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const LEGACY_RESIDUAL =
  Number(
    script189
      ?.diagnostic
      ?.residual,
  );

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
console.log('STRICT AMMO CHRONOLOGY DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log('Strict grouping: player + weapon entity only');
console.log('Effect-context re-entry comparisons: DISALLOWED');
console.log('Combined counter: Z(m_iClip) + Z(m_iBonusClip)');
console.log('Consumed cohort treated as fresh validation: NO');
console.log('Authority promotion: NO');
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
    weaponEvents:
      weaponEvents.length,
    transitions:
      transitions.length,
    joined,
    joinFailures,
    parseFailures,
  });

  allRows.push(...replayRows);

  console.log(
    `${replayName}: weaponEvents=${weaponEvents.length} strictTransitions=${transitions.length} joined=${joined}/${transitions.length}`,
  );
}

const strict =
  summarizeStrictChronology(allRows);

const comparison =
  compareLegacyAndStrict({
    legacyResidual:
      LEGACY_RESIDUAL,
    strictResidual:
      strict.residual,
  });

const checks = {
  script189Ready:
    check(
      script189?.status,
      EXPECTED_189_STATUS,
      script189?.status === EXPECTED_189_STATUS,
    ),

  legacyResidualFrozen:
    check(
      LEGACY_RESIDUAL,
      490,
      LEGACY_RESIDUAL === 490,
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

  consumedCohortStillNotIndependent:
    check(false, false, true),
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
      ? 'STRICT_AMMO_CHRONOLOGY_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'STRICT_AMMO_CHRONOLOGY_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    chronology:
      'strict consecutive final-per-tick states within player+weapon entity',

    effectContextGrouping:
      'not used for adjacency',

    combinedCounter:
      'ZigZag(m_iClip) + ZigZag(m_iBonusClip)',

    slideCarrier:
      PRIMARY_SLIDE_AMMO_CARRIER,

    independentValidation:
      false,

    authorityPromotion:
      false,
  },

  replayIntegrity,

  strict,
  comparison,

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
    comparison.classification
      === 'NONCONTIGUOUS_CONTEXT_GROUPING_EXPLAINS_SUBSTANTIAL_LEGACY_RESIDUALS'
      ? 'REBASE_AMMO_TRANSITION_SEMANTICS_ON_STRICT_WEAPON_CHRONOLOGY_BEFORE_ATTRIBUTING_REMAINING_RESIDUALS_TO_GAMEPLAY_MECHANICS'
      : 'STRICT_CHRONOLOGY_DOES_NOT_REMOVE_MOST_RESIDUALS;_CONTINUE_WITH_RELOAD_AND_HERO_MECHANIC_DIAGNOSIS',
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
            encoding: 'utf8',
          },
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
  const s = result.strict;
  const c = result.comparison;

  console.log('');
  console.log('========================================================');
  console.log('STRICT CHRONOLOGY SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `carrier-absent strict transitions:   ${s.total}`,
  );
  console.log(
    `positive:                            ${s.positive} (${percent(s.positiveRate)})`,
  );
  console.log(
    `zero:                                ${s.zero} (${percent(s.zeroRate)})`,
  );
  console.log(
    `negative:                            ${s.negative} (${percent(s.negativeRate)})`,
  );
  console.log(
    `strict residual:                     ${s.residual} (${percent(s.residualRate)})`,
  );
  console.log('');

  console.log('LEGACY VS STRICT');
  console.log('----------------');
  console.log(
    `legacy residual:                     ${c.legacyResidual}`,
  );
  console.log(
    `strict residual:                     ${c.strictResidual}`,
  );
  console.log(
    `residual reduction:                  ${percent(c.reduction)}`,
  );
  console.log('');

  console.log('SHOT ADVANCE');
  console.log('------------');
  console.log(
    `all strict:      ${JSON.stringify(s.shotAdvance)}`,
  );
  console.log(
    `strict residual: ${JSON.stringify(s.residualShotAdvance)}`,
  );
  console.log('');

  console.log('TICK GAP');
  console.log('--------');
  console.log(
    `all strict:      ${JSON.stringify(s.tickGap)}`,
  );
  console.log(
    `strict residual: ${JSON.stringify(s.residualTickGap)}`,
  );
  console.log('');

  console.log('STRICT RESIDUAL ENRICHMENT');
  console.log('--------------------------');

  for (
    const [name, row]
    of Object.entries({
      contextChanged:
        s.contextChanged,
      fireModeChanged:
        s.fireModeChanged,
      lastReloadStartTimeChanged:
        s.lastReloadStartTimeChanged,
      reloadAvailableTimeChanged:
        s.reloadAvailableTimeChanged,
    })
  ) {
    console.log(
      `${name.padEnd(30)} residual=${percent(row.residualRate).padEnd(8)} positive=${percent(row.positiveRate).padEnd(8)} RD=${percent(row.riskDifference)}`,
    );
  }

  console.log('');
  console.log('STRICT RESIDUALS BY HERO');
  console.log('------------------------');

  for (const row of s.byHero.slice(0, 25)) {
    console.log(
      `hero=${String(row.key).padEnd(4)} total=${String(row.total).padEnd(5)} zero=${String(row.zero).padEnd(4)} neg=${String(row.negative).padEnd(4)} multiShot=${String(row.multiShot).padEnd(4)} ctxChanged=${String(row.contextChanged).padEnd(4)} reloadStartChanged=${row.reloadStartChanged}`,
    );
  }

  console.log('');
  console.log('TOP STRICT RESIDUAL PATTERNS');
  console.log('----------------------------');

  for (
    const row
    of s.topResidualPatterns.slice(0, 40)
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
  console.log(c.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
