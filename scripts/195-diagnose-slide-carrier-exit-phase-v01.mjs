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
  summarizeExitPhase,
} from '../src/player-state/slide-carrier-exit-phase-diagnostic.mjs';

const VERSION =
  'SLIDE_CARRIER_EXIT_PHASE_DIAGNOSTIC_V01';

const PATHS = {
  replay:
    resolve('replays', 'test.dem'),

  weapon:
    resolve(
      'output',
      'test',
      'effective_weapon_runtime_events_v01.jsonl',
    ),

  script194:
    resolve(
      'output',
      'test',
      'slide_carrier_boundary_timing_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'slide_carrier_exit_phase_diagnostic_v01.json',
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

const script194 =
  JSON.parse(
    readFileSync(
      PATHS.script194,
      'utf8',
    ),
  );

const EXPECTED_194_CLASSIFICATION =
  'SLIDE_CARRIER_BOUNDARY_PHASE_EXPLAINS_SUBSTANTIAL_STRICT_ZEROS';

console.log('');
console.log('========================================================');
console.log('SLIDE-CARRIER EXIT-PHASE DIAGNOSTIC V0.1');
console.log('========================================================');
console.log('');
console.log('Replay: test');
console.log(
  `Frozen primary: ${PRIMARY.field} bit=${PRIMARY.bit}`,
);
console.log('Question: present -> absent on exact attack tick?');
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

const transitions =
  deriveStrictAttackTransitions(
    groupStrictWeaponChronology(
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

const lastCarrierTransitionByPawn =
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

      const state =
        pawnStateByEntity.get(
          entity.index,
        );

      const before =
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

      const after =
        evaluateBitState(
          state,
          PRIMARY,
        );

      if (
        before.covered === true
        && after.covered === true
        && before.present !== after.present
      ) {
        lastCarrierTransitionByPawn.set(
          entity.index,
          {
            tick:
              demoPacket.tick,
            fromPresent:
              before.present,
            toPresent:
              after.present,
            beforeValue:
              before.value,
            afterValue:
              after.value,
          },
        );
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

      const lastTransition =
        lastCarrierTransitionByPawn.get(
          resolution.pawn.index,
        ) ?? null;

      const exactExitAtAttack =
        lastTransition !== null
        && lastTransition.tick === tick
        && lastTransition.fromPresent === true
        && lastTransition.toPresent === false;

      const ticksSinceExit =
        lastTransition !== null
        && lastTransition.fromPresent === true
        && lastTransition.toPresent === false
          ? tick - lastTransition.tick
          : null;

      joinedRows.push({
        ...transition,

        pawnEntityIndex:
          resolution.pawn.index,

        primaryCovered:
          primary.covered,

        primaryPresent:
          primary.present,

        exactExitAtAttack,

        ticksSinceExit,

        lastCarrierTransition:
          lastTransition,
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

const diagnostic =
  summarizeExitPhase(
    joinedRows,
  );

const checks = {
  script194ClassificationExpected:
    check(
      script194
        ?.diagnostic
        ?.classification,
      EXPECTED_194_CLASSIFICATION,
      script194
        ?.diagnostic
        ?.classification
        === EXPECTED_194_CLASSIFICATION,
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
      ? 'SLIDE_CARRIER_EXIT_PHASE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'SLIDE_CARRIER_EXIT_PHASE_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    discoveryReplay:
      'test',

    primaryCarrier:
      PRIMARY,

    exactQuestion:
      'present-to-absent carrier transition occurs on exact attack tick',

    carrierRetuned:
      false,

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
      === 'EXACT_CARRIER_EXIT_TICK_STRONGLY_EXPLAINS_STRICT_ZERO_PHASE'
      ? 'FREEZE_PRE_TRANSITION_CARRIER_STATE_AS_ATTACK_TICK_PHASE_HYPOTHESIS;_CHARACTERIZE_THE_FEW POSITIVE EXIT-TICK CONTROLS_AND_REMAINING_ZEROS_ON_TEST_BEFORE_NEW_VALIDATION'
      : 'EXACT_EXIT_TICK_IS_NOT_SUFFICIENT;_CONTINUE_VYPER_AND_OTHER_HERO_SPECIFIC_ZERO_MECHANIC_DISCOVERY_ON_TEST',
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
  console.log('EXACT EXIT-PHASE SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `strict zero samples:                 ${d.zeroSamples}`,
  );
  console.log(
    `positive controls:                   ${d.positiveControls}`,
  );
  console.log('');

  console.log('EXACT PRESENT -> ABSENT ON ATTACK TICK');
  console.log('--------------------------------------');
  console.log(
    `zero:                                ${d.exactExit.zero}`,
  );
  console.log(
    `positive:                            ${d.exactExit.positive}`,
  );
  console.log(
    `P(zero | exact exit):                ${percent(d.exactExit.pZeroGivenExactExit)}`,
  );
  console.log(
    `zero recall:                         ${percent(d.exactExit.zeroRecall)}`,
  );
  console.log(
    `positive-control exact-exit rate:    ${percent(d.exactExit.positiveControlRate)}`,
  );

  console.log('');
  console.log('BY HERO');
  console.log('-------');

  for (
    const row
    of d.byHero.slice(0, 25)
  ) {
    console.log(
      `hero=${row.heroId.padEnd(4)} zero=${String(row.zero).padEnd(4)} zeroExact=${String(row.zeroExactExit).padEnd(4)} zeroExactRate=${percent(row.zeroExactExitRate).padEnd(8)} positiveExact=${String(row.positiveExactExit).padEnd(4)} positiveExactRate=${percent(row.positiveExactExitRate)}`,
    );
  }

  console.log('');
  console.log('EXIT AGE — ZERO');
  console.log('---------------');
  console.log(
    JSON.stringify(
      d.exitAgeZero,
    ),
  );

  console.log('');
  console.log('EXIT AGE — POSITIVE');
  console.log('-------------------');
  console.log(
    JSON.stringify(
      d.exitAgePositive,
    ),
  );

  console.log('');
  console.log(
    `remaining non-exact-exit zeros:      ${d.remainingZeros.length}`,
  );

  console.log('');
  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');

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
