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
  summarizePhaseCorrectedCarrier,
} from '../src/player-state/phase-corrected-slide-carrier.mjs';

const VERSION =
  'PHASE_CORRECTED_SLIDE_CARRIER_CANDIDATE_V01';

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

  script195:
    resolve(
      'output',
      'test',
      'slide_carrier_exit_phase_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'phase_corrected_slide_carrier_candidate_v01.json',
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

const script195 =
  JSON.parse(
    readFileSync(
      PATHS.script195,
      'utf8',
    ),
  );

const EXPECTED_195_CLASSIFICATION =
  'EXACT_CARRIER_EXIT_TICK_STRONGLY_EXPLAINS_STRICT_ZERO_PHASE';

console.log('');
console.log(
  '========================================================',
);
console.log(
  'PHASE-CORRECTED SLIDE CARRIER CANDIDATE V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Replay: test',
);
console.log(
  `Frozen primary: ${PRIMARY.field} bit=${PRIMARY.bit}`,
);
console.log(
  'Frozen phase rule: current present OR exact present->absent transition on attack tick',
);
console.log(
  'Grace window: NONE',
);
console.log(
  'Strict chronology: YES',
);
console.log(
  'Combined ammo counter: Z(clip)+Z(bonusClip)',
);
console.log(
  'Authority promotion: NO',
);
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
        finite(
          firstDefined(
            raw
              ?.observedWeaponState
              ?.reloadAvailableTime,
            deepFindExactKey(
              raw,
              'm_flReloadAvailableTime',
            ),
          ),
        ),

      lastReloadStartTime:
        finite(
          firstDefined(
            raw
              ?.observedWeaponState
              ?.lastReloadStartTime,
            deepFindExactKey(
              raw,
              'm_flLastReloadStartTime',
            ),
          ),
        ),
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
        && before.present
          !== after.present
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
    createReadStream(
      PATHS.replay,
    ),
  );
} finally {
  await parser.dispose();
}

const diagnostic =
  summarizePhaseCorrectedCarrier(
    joinedRows,
  );

const checks = {
  script195ClassificationExpected:
    check(
      script195
        ?.diagnostic
        ?.classification,

      EXPECTED_195_CLASSIFICATION,

      script195
        ?.diagnostic
        ?.classification
        === EXPECTED_195_CLASSIFICATION,
    ),

  exactExitZeroFrozen:
    check(
      diagnostic
        ?.exactExit
        ?.zero,

      56,

      diagnostic
        ?.exactExit
        ?.zero === 56,
    ),

  exactExitPositiveFrozen:
    check(
      diagnostic
        ?.exactExit
        ?.positive,

      0,

      diagnostic
        ?.exactExit
        ?.positive === 0,
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
      && joined
        === transitions.length,
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
      ? 'PHASE_CORRECTED_SLIDE_CARRIER_CANDIDATE_V01_READY_FOR_INTERPRETATION'
      : 'PHASE_CORRECTED_SLIDE_CARRIER_CANDIDATE_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    discoveryReplay:
      'test',

    frozenPrimaryCarrier:
      PRIMARY,

    attackTickPhaseRule:
      'current carrier present OR exact present-to-absent carrier transition on attack tick',

    graceWindowTicks:
      0,

    strictChronology:
      true,

    combinedAmmoCounter:
      'ZigZag(m_iClip)+ZigZag(m_iBonusClip)',

    carrierAuthorityPromotion:
      false,

    effectiveWeaponStatePromotion:
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
      diagnostic.classification
        === 'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_STRONGLY_SUPPORTED_ON_TEST'
        ? 'STRONG_SINGLE_REPLAY_DIAGNOSTIC_SUPPORT'
        : 'NOT_ESTABLISHED',

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    diagnostic.classification
      === 'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_STRONGLY_SUPPORTED_ON_TEST'
      ? 'FREEZE_PHASE_CORRECTED_CARRIER_AS_CANDIDATE_ATTACK_TICK_RULE;_DIAGNOSE_REMAINING_TEST_ZEROS_AND_NEGATIVES_SEPARATELY;_NEW_INDEPENDENT_REPLAYS_REQUIRED_BEFORE_PROMOTION'
      : 'DIAGNOSE_PHASE_RULE_FAILURES_ON_TEST_ONLY',
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
  console.log(
    '========================================================',
  );
  console.log(
    'PHASE-CORRECTED CARRIER SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `evaluable strict attacks:            ${d.evaluable}`,
  );
  console.log(
    `raw carrier-absent:                  ${d.rawAbsent}`,
  );
  console.log(
    `phase-corrected carrier-absent:      ${d.correctedAbsent}`,
  );
  console.log('');

  console.log(
    'EXACT EXIT-TICK EVENTS',
  );
  console.log(
    '----------------------',
  );
  console.log(
    `total:                               ${d.exactExit.total}`,
  );
  console.log(
    `zero:                                ${d.exactExit.zero}`,
  );
  console.log(
    `positive:                            ${d.exactExit.positive}`,
  );
  console.log(
    `negative:                            ${d.exactExit.negative}`,
  );
  console.log(
    `P(zero | exact exit):                ${percent(d.exactExit.pZeroGivenExactExit)}`,
  );
  console.log(
    `zero recall:                         ${percent(d.exactExit.zeroRecallAmongRawAbsentZeros)}`,
  );
  console.log('');

  console.log(
    'RAW CURRENT-STATE CARRIER',
  );
  console.log(
    '-------------------------',
  );
  console.log(
    `positive=${d.rawPartition.positive} (${percent(d.rawPartition.positiveRate)}) zero=${d.rawPartition.zero} (${percent(d.rawPartition.zeroRate)}) negative=${d.rawPartition.negative} (${percent(d.rawPartition.negativeRate)}) residual=${d.rawPartition.residual}`,
  );
  console.log('');

  console.log(
    'PHASE-CORRECTED CARRIER',
  );
  console.log(
    '-----------------------',
  );
  console.log(
    `positive=${d.correctedPartition.positive} (${percent(d.correctedPartition.positiveRate)}) zero=${d.correctedPartition.zero} (${percent(d.correctedPartition.zeroRate)}) negative=${d.correctedPartition.negative} (${percent(d.correctedPartition.negativeRate)}) residual=${d.correctedPartition.residual}`,
  );
  console.log(
    `zero reduction:                      ${percent(d.zeroReduction)}`,
  );
  console.log(
    `total residual reduction:            ${percent(d.residualReduction)}`,
  );
  console.log('');

  console.log(
    'REMAINING ZEROS BY HERO',
  );
  console.log(
    '-----------------------',
  );

  for (
    const row
    of d.remainingZerosByHero
  ) {
    console.log(
      `hero=${row.heroId.padEnd(4)} count=${row.count}`,
    );
  }

  console.log('');
  console.log(
    'REMAINING NEGATIVES BY HERO',
  );
  console.log(
    '---------------------------',
  );

  for (
    const row
    of d.remainingNegativesByHero
  ) {
    console.log(
      `hero=${row.heroId.padEnd(4)} count=${row.count}`,
    );
  }

  console.log('');
  console.log(
    `remaining zero rows:                 ${d.remainingZeros.length}`,
  );
  console.log(
    `remaining negative rows:             ${d.remainingNegatives.length}`,
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
