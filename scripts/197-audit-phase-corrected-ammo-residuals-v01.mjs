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
  auditPhaseCorrectedResiduals,
  buildChronologicalAttackTransitions,
} from '../src/player-state/phase-corrected-ammo-residual-audit.mjs';

const VERSION =
  'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01';

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

  script196:
    resolve(
      'output',
      'test',
      'phase_corrected_slide_carrier_candidate_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'phase_corrected_ammo_residual_audit_v01.json',
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

const script196 =
  JSON.parse(
    readFileSync(
      PATHS.script196,
      'utf8',
    ),
  );

const EXPECTED_196_CLASSIFICATION =
  'PRE_TRANSITION_CARRIER_ATTACK_TICK_PHASE_RULE_STRONGLY_SUPPORTED_ON_TEST';

console.log('');
console.log(
  '========================================================',
);
console.log(
  'PHASE-CORRECTED AMMO RESIDUAL AUDIT V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Replay: test',
);
console.log(
  'Purpose: exact descriptive audit of remaining 12 zero + 8 negative attacks',
);
console.log(
  'New semantic rule formation: NO',
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

      rawClip:
        finite(
          firstDefined(
            base.rawClip,
            raw?.observedWeaponState?.clip,
            deepFindExactKey(
              raw,
              'm_iClip',
            ),
          ),
        ),

      bonusClip:
        finite(
          firstDefined(
            base.bonusClip,
            raw?.observedWeaponState?.bonusClip,
            deepFindExactKey(
              raw,
              'm_iBonusClip',
            ),
          ),
        ),

      ammoFraction:
        finite(
          firstDefined(
            base.ammoFraction,
            raw?.observedWeaponState?.ammoFraction,
            deepFindExactKey(
              raw,
              'm_flAmmoFrac',
            ),
          ),
        ),

      inReload:
        booleanOrNull(
          firstDefined(
            base.inReload,
            raw?.observedWeaponState?.inReload,
            deepFindExactKey(
              raw,
              'm_bInReload',
            ),
          ),
        ),

      shotNumber:
        finite(
          firstDefined(
            base.shotNumber,
            raw?.observedWeaponState?.shotNumber,
            deepFindExactKey(
              raw,
              'm_nShotNumber',
            ),
          ),
        ),

      continuousShots:
        finite(
          firstDefined(
            base.continuousShots,
            raw?.observedWeaponState
              ?.numContinuousShots,
            deepFindExactKey(
              raw,
              'm_nNumContinuousShots',
            ),
          ),
        ),

      burstRemaining:
        finite(
          firstDefined(
            base.burstRemaining,
            raw?.observedWeaponState
              ?.burstShotsRemaining,
            deepFindExactKey(
              raw,
              'm_nBurstShotsRemaining',
            ),
          ),
        ),

      activeFireMode:
        finite(
          firstDefined(
            base.activeFireMode,
            raw?.observedWeaponState
              ?.activeFireMode,
            deepFindExactKey(
              raw,
              'm_eActiveFireMode',
            ),
          ),
        ),

      lastAttackTime:
        finite(
          firstDefined(
            base.lastAttackTime,
            raw?.observedWeaponState
              ?.lastAttackTime,
            deepFindExactKey(
              raw,
              'm_flLastAttackTime',
            ),
          ),
        ),

      nextPrimaryAttack:
        finite(
          firstDefined(
            base.nextPrimaryAttack,
            raw?.observedWeaponState
              ?.nextPrimaryAttack,
            deepFindExactKey(
              raw,
              'm_flNextPrimaryAttack',
            ),
          ),
        ),

      reloadAvailableTime:
        finite(
          firstDefined(
            base.reloadAvailableTime,
            raw?.observedWeaponState
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
            base.lastReloadStartTime,
            raw?.observedWeaponState
              ?.lastReloadStartTime,
            deepFindExactKey(
              raw,
              'm_flLastReloadStartTime',
            ),
          ),
        ),

      reloadQueuedStartTime:
        finite(
          firstDefined(
            base.reloadQueuedStartTime,
            raw?.observedWeaponState
              ?.reloadQueuedStartTime,
            deepFindExactKey(
              raw,
              'm_reloadQueuedStartTime',
            ),
          ),
        ),

      firedRecently:
        booleanOrNull(
          firstDefined(
            base.firedRecently,
            raw?.observedWeaponState
              ?.firedRecently,
            deepFindExactKey(
              raw,
              'm_bFiredRecently',
            ),
          ),
        ),
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
    groups.set(
      key,
      [],
    );
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
  buildChronologicalAttackTransitions(
    groups,
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
        replayName:
          'test',

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

const audit =
  auditPhaseCorrectedResiduals(
    joinedRows,
    {
      neighborhoodRadius: 4,
      reloadWindowTicks: 64,
    },
  );

const checks = {
  script196ClassificationExpected:
    check(
      script196
        ?.diagnostic
        ?.classification,

      EXPECTED_196_CLASSIFICATION,

      script196
        ?.diagnostic
        ?.classification
        === EXPECTED_196_CLASSIFICATION,
    ),

  remainingZeroFrozen:
    check(
      audit.zero,
      12,
      audit.zero === 12,
    ),

  remainingNegativeFrozen:
    check(
      audit.negative,
      8,
      audit.negative === 8,
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
      ? 'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_READY_FOR_INTERPRETATION'
      : 'PHASE_CORRECTED_AMMO_RESIDUAL_AUDIT_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    purpose:
      'exact descriptive audit only',

    strictChronology:
      true,

    combinedAmmoCounter:
      'ZigZag(m_iClip)+ZigZag(m_iBonusClip)',

    phaseCorrectedCarrier:
      'current bit5 present OR exact present-to-absent transition on attack tick',

    newMechanicHypothesis:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  telemetry: {
    weaponEvents:
      weaponEvents.length,

    transitions:
      transitions.length,

    joined,
    joinFailures,
    pawnMutations,
  },

  audit,

  integrityValidation: {
    pass:
      integrityPass,

    checks,
  },

  semanticValidation: {
    status:
      'DESCRIPTIVE_DIAGNOSTIC_ONLY',

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    'INTERPRET_THE_20_EXACT_RESIDUAL_NEIGHBORHOODS;_ONLY_THEN_FORM_A_SPECIFIC_MECHANISM_HYPOTHESIS_IF_SUPPORTED',
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

function booleanOrNull(value) {
  if (
    value === true
    || value === false
  ) {
    return value;
  }

  if (
    value === 1
    || value === '1'
    || value === 'true'
  ) {
    return true;
  }

  if (
    value === 0
    || value === '0'
    || value === 'false'
  ) {
    return false;
  }

  return null;
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
  const a =
    result.audit;

  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'EXACT RESIDUAL AUDIT SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `phase-corrected carrier-absent:      ${a.correctedAbsent}`,
  );
  console.log(
    `residual total:                      ${a.residual}`,
  );
  console.log(
    `zero:                                ${a.zero}`,
  );
  console.log(
    `negative:                            ${a.negative}`,
  );
  console.log('');

  console.log(
    'ZERO BY HERO',
  );
  console.log(
    '------------',
  );

  for (
    const row
    of a.zeroByHero
  ) {
    console.log(
      `hero=${row.key.padEnd(4)} count=${row.count}`,
    );
  }

  console.log('');
  console.log(
    'NEGATIVE BY HERO',
  );
  console.log(
    '----------------',
  );

  for (
    const row
    of a.negativeByHero
  ) {
    console.log(
      `hero=${row.key.padEnd(4)} count=${row.count}`,
    );
  }

  console.log('');
  console.log(
    'NEGATIVE GAIN MAGNITUDE',
  );
  console.log(
    '-----------------------',
  );

  console.log(
    JSON.stringify(
      a.negativeGainDistribution,
    ),
  );

  console.log('');
  console.log(
    'ZERO FEATURE SUMMARY',
  );
  console.log(
    '--------------------',
  );

  printFlags(
    a.featureSummary.zero,
  );

  console.log('');
  console.log(
    'NEGATIVE FEATURE SUMMARY',
  );
  console.log(
    '------------------------',
  );

  printFlags(
    a.featureSummary.negative,
  );

  console.log('');
  console.log(
    'EXACT RESIDUAL ROWS',
  );
  console.log(
    '-------------------',
  );

  for (
    let index = 0;
    index < a.exactRows.length;
    index++
  ) {
    const row =
      a.exactRows[index];

    console.log('');
    console.log(
      `[${index + 1}/${a.exactRows.length}] class=${row.residualClass} hero=${row.heroId} tick=${row.tick} context=${row.effectContextId} fireMode=${row.activeFireMode} drop=${row.combinedDrop} tickGap=${row.tickGap}`,
    );

    console.log(
      `  fractionChanged=${row.ammoFractionChangedAtAttack} nearbyReload=${row.nearbyReload} reloadStartChange=${row.nearbyReloadStartChange} contextChange=${row.nearbyEffectContextChange} fireModeChange=${row.nearbyFireModeChange} ticksSinceExit=${row.ticksSinceExit}`,
    );

    console.log(
      `  prev=${JSON.stringify(row.previous)}`,
    );

    console.log(
      `  curr=${JSON.stringify(row.current)}`,
    );

    console.log(
      '  neighborhood:',
    );

    for (
      const state
      of row.neighborhood
    ) {
      console.log(
        `    ${JSON.stringify(state)}`,
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
    a.classification,
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

function printFlags(summary) {
  for (
    const [name, row]
    of Object.entries(summary)
  ) {
    if (name === 'total') continue;

    console.log(
      `${name.padEnd(30)} ${String(row.count).padEnd(4)} ${percent(row.rate)}`,
    );
  }
}
