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
  deriveStrictAttackTransitions,
  groupStrictWeaponChronology,
} from '../src/player-state/strict-ammo-chronology-diagnostic.mjs';

import {
  BOUNDARY_HORIZONS,
  summarizeBoundaryTiming,
} from '../src/player-state/slide-carrier-boundary-diagnostic.mjs';

const VERSION =
  'SLIDE_CARRIER_BOUNDARY_TIMING_DIAGNOSTIC_V01';

const PATHS = {
  replay:
    resolve('replays', 'test.dem'),

  weapon:
    resolve(
      'output',
      'test',
      'effective_weapon_runtime_events_v01.jsonl',
    ),

  script193:
    resolve(
      'output',
      'test',
      'strict_zero_ammo_settlement_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'slide_carrier_boundary_timing_diagnostic_v01.json',
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

const script193 =
  JSON.parse(
    readFileSync(
      PATHS.script193,
      'utf8',
    ),
  );

const EXPECTED_193_CLASSIFICATION =
  'SHORT_HORIZON_SETTLEMENT_DOES_NOT_EXPLAIN_MOST_STRICT_ZEROS';

console.log('');
console.log('========================================================');
console.log('SLIDE-CARRIER BOUNDARY TIMING DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log('Replay: test');
console.log(
  `Frozen primary: ${PRIMARY.field} bit=${PRIMARY.bit}`,
);
console.log(
  `Boundary horizons: ${BOUNDARY_HORIZONS.join(', ')} ticks`,
);
console.log('Combined ammo counter: Z(clip)+Z(bonusClip)');
console.log('Carrier retuned: NO');
console.log('Authority promotion: NO');
console.log('');

const weaponEvents = [];
let parseFailures = 0;

for await (
  const line
  of readLines(PATHS.weapon)
) {
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

const pawnStateByEntity =
  new Map();

const timelineByPawn =
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
        !pawnStateByEntity.has(entity.index)
      ) {
        pawnStateByEntity.set(
          entity.index,
          {},
        );
      }

      const state =
        pawnStateByEntity.get(
          entity.index,
        );

      const previous =
        evaluateBitState(
          state,
          PRIMARY,
        );

      Object.assign(
        state,
        flattenPrimitiveChanges(
          event.getChanges(),
        ),
      );

      const current =
        evaluateBitState(
          state,
          PRIMARY,
        );

      if (
        previous.covered !== current.covered
        || previous.present !== current.present
      ) {
        if (
          !timelineByPawn.has(
            entity.index,
          )
        ) {
          timelineByPawn.set(
            entity.index,
            [],
          );
        }

        timelineByPawn
          .get(entity.index)
          .push({
            tick:
              demoPacket.tick,
            covered:
              current.covered,
            present:
              current.present,
            value:
              current.value,
          });
      }
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

        pawnEntityIndex:
          resolution.pawn.index,

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
    createReadStream(PATHS.replay),
  );
} finally {
  await parser.dispose();
}

for (const rows of timelineByPawn.values()) {
  rows.sort(
    (a, b) => a.tick - b.tick,
  );
}

const diagnostic =
  summarizeBoundaryTiming(
    joinedRows,
    timelineByPawn,
    BOUNDARY_HORIZONS,
  );

const checks = {
  script193ClassificationExpected:
    check(
      script193
        ?.diagnostic
        ?.classification,
      EXPECTED_193_CLASSIFICATION,
      script193
        ?.diagnostic
        ?.classification
        === EXPECTED_193_CLASSIFICATION,
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
    check('test', 'test', true),
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

  replay:
    'test',

  status:
    integrityPass
      ? 'SLIDE_CARRIER_BOUNDARY_TIMING_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'SLIDE_CARRIER_BOUNDARY_TIMING_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    discoveryReplay:
      'test',

    primaryCarrier:
      PRIMARY,

    carrierRetuned:
      false,

    combinedCounter:
      'ZigZag(m_iClip)+ZigZag(m_iBonusClip)',

    horizonsTicks:
      BOUNDARY_HORIZONS,

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
    pawnTimelines:
      timelineByPawn.size,
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
      === 'STRICT_ZEROS_ARE_NOT_EXPLAINED_BY_PRIMARY_CARRIER_BOUNDARY_TIMING'
      ? 'MOVE_TO_HERO_SPECIFIC_ZERO_CONSUMPTION_DISCOVERY_ON_TEST;_VYPER_IS_PRIMARY_TARGET'
      : 'CHARACTERIZE_BOUNDARY_PHASE_RULE_ON_TEST_BEFORE_ANY_NEW_VALIDATION',
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
  console.log('CARRIER BOUNDARY SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `strict zero samples:                 ${d.zeroSamples}`,
  );
  console.log(
    `positive controls:                   ${d.positiveControls}`,
  );
  console.log('');

  console.log('BOUNDARY PROXIMITY');
  console.log('------------------');

  for (
    const [key, row]
    of Object.entries(d.byHorizon)
  ) {
    console.log(
      `${key.padStart(2)} ticks: zero=${String(row.zeroTrue).padEnd(4)} (${percent(row.zeroRate)}) positive=${String(row.positiveTrue).padEnd(6)} (${percent(row.positiveRate)}) RD=${percent(row.riskDifference)} before=${row.zeroBefore.count} after=${row.zeroAfter.count} both=${row.zeroBoth.count}`,
    );
  }

  console.log('');
  console.log('BY HERO');
  console.log('-------');

  for (
    const row
    of d.byHero.slice(0, 25)
  ) {
    console.log(
      `hero=${row.heroId.padEnd(4)} zero=${String(row.zero).padEnd(4)} within1=${String(row.within1).padEnd(4)} (${percent(row.within1Rate)}) within2=${String(row.within2).padEnd(4)} (${percent(row.within2Rate)}) within4=${String(row.within4).padEnd(4)} (${percent(row.within4Rate)}) within8=${String(row.within8).padEnd(4)} (${percent(row.within8Rate)})`,
    );
  }

  console.log('');
  console.log('TOP ZERO BOUNDARY PATTERNS');
  console.log('--------------------------');

  for (
    const row
    of d.topZeroBoundaryPatterns.slice(0, 30)
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
  console.log(d.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}
