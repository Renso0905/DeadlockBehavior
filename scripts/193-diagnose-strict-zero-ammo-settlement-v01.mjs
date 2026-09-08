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
  PRIMARY,
  evaluateBitState,
} from '../src/player-state/slide-companion-residual-diagnostic.mjs';

import {
  deepFindExactKey,
  normalizeDetailedWeaponEvent,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

import {
  strictWeaponKey,
} from '../src/player-state/strict-ammo-chronology-diagnostic.mjs';

import {
  ZERO_SETTLEMENT_HORIZONS,
  deriveStrictAttackTransitionsWithIndex,
  summarizeZeroSettlements,
} from '../src/player-state/strict-zero-settlement-diagnostic.mjs';

const VERSION =
  'STRICT_ZERO_AMMO_SETTLEMENT_DIAGNOSTIC_V01';

const PATHS = {
  replay:
    resolve(
      'replays',
      'test.dem',
    ),

  weapon:
    resolve(
      'output',
      'test',
      'effective_weapon_runtime_events_v01.jsonl',
    ),

  script192:
    resolve(
      'output',
      'test',
      'strict_zero_ammo_modifier_bit_discovery_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'strict_zero_ammo_settlement_diagnostic_v01.json',
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

const script192 =
  JSON.parse(
    readFileSync(
      PATHS.script192,
      'utf8',
    ),
  );

const EXPECTED_192_CLASSIFICATION =
  'NO_STRONG_OTHER_RUNTIME_MODIFIER_BIT_CANDIDATE_ON_TEST';

console.log('');
console.log('========================================================');
console.log('STRICT ZERO-AMMO SETTLEMENT DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log('Replay: test');
console.log('Strict chronology: YES');
console.log('Combined counter: Z(m_iClip)+Z(m_iBonusClip)');
console.log(
  `Settlement horizons: ${ZERO_SETTLEMENT_HORIZONS.join(', ')} ticks`,
);
console.log('No new shot allowed during settlement window');
console.log('Reload state terminates settlement window');
console.log('Authority promotion: NO');
console.log('');

const weaponEvents = [];
let parseFailures = 0;

for await (
  const line
  of readLines(
    PATHS.weapon,
  )
) {
  if (!line.trim()) continue;

  try {
    const raw =
      JSON.parse(line);

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
    });
  } catch {
    parseFailures++;
  }
}

const groups =
  new Map();

for (const row of weaponEvents) {
  const key =
    strictWeaponKey(row);

  if (!groups.has(key)) {
    groups.set(key, []);
  }

  groups.get(key).push(row);
}

for (const rows of groups.values()) {
  rows.sort(
    (a, b) =>
      a.tick - b.tick
      || a.sourceIndex - b.sourceIndex,
  );
}

const transitions =
  deriveStrictAttackTransitionsWithIndex(
    groups,
  );

const byTick =
  new Map();

for (const row of transitions) {
  if (!byTick.has(row.tick)) {
    byTick.set(row.tick, []);
  }

  byTick.get(row.tick)
    .push(row);
}

const pawnStateByEntity =
  new Map();

const tickGuard =
  createAttackTickGuard();

const joinedRows = [];

let joined = 0;
let joinFailures = 0;
let pawnMutations = 0;

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
        event.operation
          !== EntityOperation.CREATE
        && event.operation
          !== EntityOperation.UPDATE
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

      pawnMutations++;

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

    if (
      !tickGuard.shouldProcess(tick)
    ) {
      return;
    }

    const demo =
      parser.getDemo();

    const controllers =
      demo.getEntitiesByClassName(
        'CCitadelPlayerController',
      );

    for (
      const transition
      of byTick.get(tick)
    ) {
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

      joinedRows.push({
        ...transition,

        primaryCovered:
          primary.covered,

        primaryPresent:
          primary.present,
      });
    }
  },
);

try {
  await parser.parse(
    createReadStream(
      PATHS.replay,
    ),
  );
} finally {
  await parser.dispose();
}

const diagnostic =
  summarizeZeroSettlements(
    joinedRows,
    ZERO_SETTLEMENT_HORIZONS,
  );

const checks = {
  script192ClassificationExpected:
    check(
      script192
        ?.discovery
        ?.classification,
      EXPECTED_192_CLASSIFICATION,
      script192
        ?.discovery
        ?.classification
        === EXPECTED_192_CLASSIFICATION,
    ),

  strictZeroCountExpected:
    check(
      diagnostic.zeroSamples,
      68,
      diagnostic.zeroSamples === 68,
    ),

  weaponParseClean:
    check(
      parseFailures,
      0,
      parseFailures === 0,
    ),

  attackJoinComplete:
    check(
      {
        joined,
        joinFailures,
        total:
          transitions.length,
      },
      {
        joined:
          transitions.length,
        joinFailures: 0,
        total:
          transitions.length,
      },
      joinFailures === 0
      && joined === transitions.length,
    ),

  testReplayOnly:
    check(
      'test',
      'test',
      true,
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
      ? 'STRICT_ZERO_AMMO_SETTLEMENT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'STRICT_ZERO_AMMO_SETTLEMENT_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    discoveryReplay:
      'test',

    strictChronology:
      true,

    combinedCounter:
      'ZigZag(m_iClip)+ZigZag(m_iBonusClip)',

    primarySlideCarrierExcluded:
      true,

    newShotTerminatesSettlementWindow:
      true,

    reloadTerminatesSettlementWindow:
      true,

    horizonsTicks:
      ZERO_SETTLEMENT_HORIZONS,

    authorityPromotion:
      false,
  },

  telemetry: {
    weaponEvents:
      weaponEvents.length,
    strictTransitions:
      transitions.length,
    joined,
    joinFailures,
    pawnMutations,
    processedAttackTicks:
      tickGuard.processedTickCount,
  },

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
      'discovery_calibration_only',
  },

  nextStep:
    diagnostic.classification
      === 'SHORT_HORIZON_SETTLEMENT_EXPLAINS_SUBSTANTIAL_STRICT_ZEROS'
      ? 'INCORPORATE_SHORT_HORIZON_SETTLEMENT_INTO_CANDIDATE_CURRENT_AMMO_TRANSITION_RULE_ON_TEST_BEFORE_NEW_REPLICATION'
      : 'SETTLEMENT_TIMING_DOES_NOT_EXPLAIN_MOST_STRICT_ZEROS;_NEXT_DIAGNOSE_AMMO_FRACTION_AND_WEAPON_MODE_HERO_MECHANICS_ON_TEST',
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
      crlfDelay:
        Infinity,
    });

  for await (
    const line
    of reader
  ) {
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

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
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
    ? `${(
      value * 100
    ).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  const d =
    result.diagnostic;

  console.log('');
  console.log('========================================================');
  console.log('STRICT ZERO SETTLEMENT SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `strict zero samples:                 ${d.zeroSamples}`,
  );
  console.log(
    `positive controls:                   ${d.positiveControls}`,
  );
  console.log('');

  console.log('SETTLEMENT BY HORIZON');
  console.log('---------------------');

  for (
    const row
    of Object.values(d.byHorizon)
  ) {
    console.log(
      `${String(row.horizonTicks).padStart(2)} ticks: resolved=${String(row.resolved).padEnd(4)} rate=${percent(row.resolutionRate)}`,
    );
  }

  console.log('');
  console.log(
    `any positive settlement:             ${d.anyPositiveSettlement} (${percent(d.anyPositiveSettlementRate)})`,
  );
  console.log(
    `ammoFraction changed at attack:      ${d.attackAmmoFractionChanged} (${percent(d.attackAmmoFractionChangedRate)})`,
  );
  console.log(
    `ammoFraction changed after attack:   ${d.futureAmmoFractionChanged} (${percent(d.futureAmmoFractionChangedRate)})`,
  );
  console.log(
    `positive-control fraction changes:   ${d.positiveControlAmmoFractionChangedAtAttack} (${percent(d.positiveControlAmmoFractionChangedRate)})`,
  );

  console.log('');
  console.log('BY HERO');
  console.log('-------');

  for (
    const row
    of d.byHero.slice(0, 25)
  ) {
    console.log(
      `hero=${row.heroId.padEnd(4)} zero=${String(row.zero).padEnd(4)} settled=${String(row.settled).padEnd(4)} settlementRate=${percent(row.settlementRate).padEnd(8)} fracAtAttack=${String(row.attackFractionChanged).padEnd(4)} fracRate=${percent(row.attackFractionChangedRate)}`,
    );
  }

  console.log('');
  console.log('SETTLEMENT DELAY');
  console.log('----------------');
  console.log(
    JSON.stringify(
      d.delayDistribution,
    ),
  );

  console.log('');
  console.log('SETTLEMENT DROP');
  console.log('---------------');
  console.log(
    JSON.stringify(
      d.settlementDropDistribution,
    ),
  );

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
