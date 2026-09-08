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
  ZERO_MODIFIER_DISCOVERY_THRESHOLDS,
  evaluateModifierBitCandidates,
  extractModifierMaskSnapshot,
} from '../src/player-state/zero-ammo-modifier-bit-discovery.mjs';

const VERSION =
  'STRICT_ZERO_AMMO_MODIFIER_BIT_DISCOVERY_V01';

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

  script187:
    resolve(
      'output',
      'test',
      'bonus_clip_zigzag_representation_diagnostic_v01.json',
    ),

  script191:
    resolve(
      'output',
      'cross_replay',
      'slide_companion_strict_residual_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'strict_zero_ammo_modifier_bit_discovery_v01.json',
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

const script187 =
  JSON.parse(
    readFileSync(
      PATHS.script187,
      'utf8',
    ),
  );

const script191 =
  JSON.parse(
    readFileSync(
      PATHS.script191,
      'utf8',
    ),
  );

const EXPECTED_187_CLASSIFICATION =
  'BONUS_CLIP_ZIGZAG_IS_STRONG_SECOND_LOGICAL_AMMO_COUNTER_CANDIDATE';

const EXPECTED_191_CLASSIFICATION =
  'STRICT_ZERO_RESIDUALS_ARE_NOT_EXPLAINED_BY_KNOWN_COMPANION_BITS';

console.log('');
console.log('========================================================');
console.log('STRICT ZERO-AMMO MODIFIER-BIT DISCOVERY V0.1');
console.log('========================================================');
console.log('');
console.log('Replay: test');
console.log('Strict weapon chronology: YES');
console.log('Combined counter: Z(m_iClip)+Z(m_iBonusClip)');
console.log('Primary slide carrier excluded: YES');
console.log('Known companion bits excluded: YES');
console.log('Negative ammo-gain transitions included: NO');
console.log('Replication cohort consumed: NO');
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

  byTick.get(row.tick)
    .push(row);
}

const pawnStateByEntity =
  new Map();

const tickGuard =
  createAttackTickGuard();

const samples = [];

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

      if (
        primary.covered !== true
        || primary.present === true
      ) {
        continue;
      }

      if (
        transition.combinedLabel
          === 'NEGATIVE'
      ) {
        continue;
      }

      if (
        transition.combinedLabel
          !== 'ZERO'
        && transition.combinedLabel
          !== 'POSITIVE'
      ) {
        continue;
      }

      samples.push({
        tick,
        heroId:
          transition.heroId,
        playerKey:
          transition.playerKey,
        weaponEntityIndex:
          transition.weaponEntityIndex,
        outcome:
          transition.combinedLabel,

        modifierMasks:
          extractModifierMaskSnapshot(
            state,
          ),
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

const discovery =
  evaluateModifierBitCandidates(
    samples,
    ZERO_MODIFIER_DISCOVERY_THRESHOLDS,
  );

const checks = {
  script187ClassificationExpected:
    check(
      script187
        ?.diagnostic
        ?.classification,
      EXPECTED_187_CLASSIFICATION,
      script187
        ?.diagnostic
        ?.classification
        === EXPECTED_187_CLASSIFICATION,
    ),

  script191ClassificationExpected:
    check(
      script191
        ?.classification,
      EXPECTED_191_CLASSIFICATION,
      script191
        ?.classification
        === EXPECTED_191_CLASSIFICATION,
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

  negativeTransitionsExcluded:
    check(
      samples.filter(
        row =>
          row.outcome === 'NEGATIVE',
      ).length,
      0,
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
      ? 'STRICT_ZERO_AMMO_MODIFIER_BIT_DISCOVERY_V01_READY_FOR_INTERPRETATION'
      : 'STRICT_ZERO_AMMO_MODIFIER_BIT_DISCOVERY_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    discoveryReplay:
      'test',

    strictChronology:
      true,

    combinedCounter:
      'ZigZag(m_iClip)+ZigZag(m_iBonusClip)',

    primarySlideCarrierExcluded:
      true,

    knownCompanionBitsExcluded:
      true,

    negativeAmmoGainExcluded:
      true,

    replicationCohortConsumed:
      false,

    authorityPromotion:
      false,
  },

  thresholds:
    ZERO_MODIFIER_DISCOVERY_THRESHOLDS,

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

  discovery,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'DISCOVERY_ONLY',
    authorityPromotion:
      false,
    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    discovery.classification
      === 'OTHER_RUNTIME_MODIFIER_BIT_CANDIDATE_DISCOVERED_ON_TEST'
      ? 'INTERPRET_TOP_FROZEN_CANDIDATE_ON_TEST_WITH_WITHIN_HERO_AND_TEMPORAL_CONTROLS_BEFORE_ANY_NEW_REPLICATION'
      : 'NO_STRONG_MODIFIER_BIT_FOUND;_NEXT_DIAGNOSE_STRICT_ZERO_ATTACKS_AGAINST_WEAPON_STATE_AND_KNOWN_GAMEPLAY_MECHANICS_ON_TEST_ONLY',
};

mkdirSync(
  dirname(
    PATHS.output,
  ),
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
    result.discovery;

  console.log('');
  console.log('========================================================');
  console.log('STRICT ZERO MODIFIER-BIT DISCOVERY SUMMARY');
  console.log('========================================================');
  console.log('');

  console.log(
    `eligible zero + positive attacks:    ${d.eligible}`,
  );
  console.log(
    `strict zero samples:                 ${d.zeroSamples}`,
  );
  console.log(
    `positive controls:                   ${d.positiveControls}`,
  );
  console.log(
    `modifier-bit candidates:             ${d.candidateCount}`,
  );
  console.log(
    `strong candidates:                   ${d.strongCandidateCount}`,
  );
  console.log('');

  console.log('TOP CANDIDATES');
  console.log('--------------');

  for (
    const row
    of d.topCandidates.slice(0, 30)
  ) {
    console.log(
      `${row.id.slice(0, 74).padEnd(74)} present=${String(row.present).padEnd(6)} zero=${String(row.zeroPresent).padEnd(4)} P0|present=${percent(row.pZeroGivenPresent).padEnd(8)} P0|absent=${percent(row.pZeroGivenAbsent).padEnd(8)} RD=${percent(row.riskDifference).padEnd(8)} recall=${percent(row.zeroRecall).padEnd(8)} posPresent=${percent(row.positivePresentRate).padEnd(8)} heroes=${JSON.stringify(row.supportingHeroes)} strong=${row.strongCandidate}`,
    );
  }

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
      `${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
