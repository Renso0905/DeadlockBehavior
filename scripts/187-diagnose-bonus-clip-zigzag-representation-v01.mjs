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
  groupDetailedWeaponEvents,
  normalizeDetailedWeaponEvent,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

import {
  BONUS_ZIGZAG_THRESHOLDS,
  evaluateBonusZigzag,
  zigzagReencode,
} from '../src/player-state/bonus-clip-zigzag-diagnostic.mjs';

const VERSION =
  'BONUS_CLIP_ZIGZAG_REPRESENTATION_DIAGNOSTIC_V01';

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

  script183:
    resolve(
      'output',
      'test',
      'slide_infinite_ammo_runtime_carrier_validation_v01.json',
    ),

  script186:
    resolve(
      'output',
      'cross_replay',
      'bonus_clip_composite_counter_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'bonus_clip_zigzag_representation_diagnostic_v01.json',
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

const script183 =
  JSON.parse(
    readFileSync(
      PATHS.script183,
      'utf8',
    ),
  );

const script186 =
  JSON.parse(
    readFileSync(
      PATHS.script186,
      'utf8',
    ),
  );

const EXPECTED_183_STATUS =
  'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_VALIDATION_V01_READY_FOR_CROSS_REPLAY_VALIDATION';

const EXPECTED_186_STATUS =
  'BONUS_CLIP_COMPOSITE_COUNTER_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_186_CLASSIFICATION =
  'BONUS_CLIP_COMPOSITE_COUNTER_REMAINS_UNRESOLVED';

console.log('');
console.log(
  '========================================================',
);
console.log(
  'BONUS-CLIP ZIGZAG REPRESENTATION DIAGNOSTIC V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Replay: test',
);
console.log(
  'Replication cohort consumed: NO',
);
console.log(
  'Frozen new hypothesis: ZigZag(m_iBonusClip)',
);
console.log(
  'Candidate combined consumption: drop(Z(m_iClip)) + drop(Z(m_iBonusClip))',
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

const grouped =
  groupDetailedWeaponEvents(
    weaponEvents,
  );

const transitions =
  [];

for (
  const contextRows
  of grouped.values()
) {
  const byTick =
    new Map();

  for (const row of contextRows) {
    if (Number.isFinite(row.tick)) {
      byTick.set(
        row.tick,
        row,
      );
    }
  }

  const settled =
    [...byTick.values()]
      .sort(
        (a, b) =>
          a.tick - b.tick
          || a.sourceIndex
          - b.sourceIndex,
      );

  for (
    let index = 1;
    index < settled.length;
    index++
  ) {
    const previous =
      settled[index - 1];

    const current =
      settled[index];

    if (
      previous.inReload === true
      || current.inReload === true
      || !Number.isFinite(
        previous.shotNumber,
      )
      || !Number.isFinite(
        current.shotNumber,
      )
      || !Number.isFinite(
        previous.wholeClip,
      )
      || !Number.isFinite(
        current.wholeClip,
      )
    ) {
      continue;
    }

    const shotAdvance =
      current.shotNumber
      - previous.shotNumber;

    if (shotAdvance <= 0) {
      continue;
    }

    const wholeDrop =
      previous.wholeClip
      - current.wholeClip;

    const previousBonusClip =
      previous.bonusClip;

    const currentBonusClip =
      current.bonusClip;

    const bonusClipDelta =
      Number.isFinite(
        previousBonusClip,
      )
      && Number.isFinite(
        currentBonusClip,
      )
        ? currentBonusClip
          - previousBonusClip
        : null;

    transitions.push({
      tick:
        current.tick,

      previousTick:
        previous.tick,

      heroId:
        current.heroId,

      playerKey:
        current.playerKey,

      weaponEntityIndex:
        current.weaponEntityIndex,

      effectContextId:
        current.effectContextId,

      activeFireMode:
        current.activeFireMode,

      shotAdvance,
      wholeDrop,

      label:
        wholeDrop > 0
          ? 'POSITIVE'
          : wholeDrop < 0
            ? 'NEGATIVE'
            : 'ZERO',

      previousBonusClip,
      currentBonusClip,
      bonusClipDelta,
    });
  }
}

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

const rows = [];
let joined = 0;
let joinFailures = 0;
let pawnMutations = 0;

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

      const carrier =
        evaluateCarrierState(
          state,
          PRIMARY_SLIDE_AMMO_CARRIER,
        );

      rows.push({
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
      PATHS.replay,
    ),
  );
} finally {
  await parser.dispose();
}

const diagnostic =
  evaluateBonusZigzag(
    rows,
    BONUS_ZIGZAG_THRESHOLDS,
  );

const checks = {
  script183Ready:
    check(
      script183?.status,
      EXPECTED_183_STATUS,
      script183?.status
        === EXPECTED_183_STATUS,
    ),

  script186Ready:
    check(
      script186?.status,
      EXPECTED_186_STATUS,
      script186?.status
        === EXPECTED_186_STATUS,
    ),

  script186ClassificationExpected:
    check(
      script186
        ?.diagnostic
        ?.classification,
      EXPECTED_186_CLASSIFICATION,
      script186
        ?.diagnostic
        ?.classification
        === EXPECTED_186_CLASSIFICATION,
    ),

  mainZigzagStillFrozen:
    check(
      {
        negative17:
          zigzagReencode(-17),
        positive16:
          zigzagReencode(16),
      },
      {
        negative17: 33,
        positive16: 32,
      },
      zigzagReencode(-17) === 33
      && zigzagReencode(16) === 32,
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
      ? (
        diagnostic
          .sufficientlyPowered
          ? 'BONUS_CLIP_ZIGZAG_REPRESENTATION_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
          : 'BONUS_CLIP_ZIGZAG_REPRESENTATION_DIAGNOSTIC_V01_UNDERPOWERED_ON_TEST'
      )
      : 'BONUS_CLIP_ZIGZAG_REPRESENTATION_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    newHypothesis:
      'ZigZag(m_iBonusClip) is a second logical ammo counter',

    combinedTransitionHypothesis:
      'drop(Z(m_iClip)) + drop(Z(m_iBonusClip))',

    absoluteCapacityClaim:
      false,

    sentinelResolved:
      false,

    authorityPromotion:
      false,

    replicationCohortConsumed:
      false,
  },

  thresholds:
    BONUS_ZIGZAG_THRESHOLDS,

  replayJoin: {
    transitions:
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
      diagnostic.strongCandidate
        ? 'STRONG_TEST_REPLAY_DIAGNOSTIC_SUPPORT'
        : (
          diagnostic.sufficientlyPowered
            ? 'NOT_ESTABLISHED'
            : 'UNDERPOWERED'
        ),

    authorityPromotion:
      false,

    replicationStatus:
      'discovery_calibration_only',
  },

  nextStep:
    diagnostic.strongCandidate
      ? 'FREEZE_BONUS_ZIGZAG_AS_CANDIDATE_AMMO_COMPONENT;_OBTAIN_NEW_INDEPENDENT_REPLAYS_FOR_VALIDATION_BEFORE_PROMOTION'
      : (
        diagnostic.sufficientlyPowered
          ? 'DIAGNOSE_BONUS_ZIGZAG_FAILURES_ON_TEST_ONLY'
          : 'TEST_IS_UNDERPOWERED_FOR_THIS_NEW_HYPOTHESIS;_USE_A_NEW_DISCOVERY_REPLAY_WITH_HERO13_63_OR_65_OR_OTHER_SUBSTANTIAL_BONUS_CLIP_ACTIVITY_BEFORE_NEW_REPLICATION'
      ),
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
            encoding:
              'utf8',
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
    'BONUS-CLIP ZIGZAG SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `carrier-absent transitions:          ${d.carrierAbsent}`,
  );
  console.log(
    `evaluable bonus state:               ${d.evaluable}`,
  );
  console.log(
    `bonus-changing transitions:          ${d.bonusChanging}`,
  );
  console.log(
    `main-zero + bonus-changing:          ${d.mainZeroBonusChanging}`,
  );
  console.log(
    `bonus logical drop positive:         ${d.bonusLogicalPositive} (${percent(d.bonusLogicalPositiveRate)})`,
  );
  console.log(
    `bonus logical drop exactly 1:        ${d.bonusLogicalOneUnit} (${percent(d.bonusLogicalOneUnitRate)})`,
  );
  console.log('');

  console.log(
    'BASELINE MAIN COUNTER',
  );
  console.log(
    '---------------------',
  );
  console.log(
    `positive=${d.baseline.positive} (${percent(d.baseline.positiveRate)}) zero=${d.baseline.zero} (${percent(d.baseline.zeroRate)}) negative=${d.baseline.negative} (${percent(d.baseline.negativeRate)})`,
  );
  console.log('');

  console.log(
    'COMBINED MAIN + BONUS LOGICAL COUNTER',
  );
  console.log(
    '-------------------------------------',
  );
  console.log(
    `positive=${d.combined.positive} (${percent(d.combined.positiveRate)}) zero=${d.combined.zero} (${percent(d.combined.zeroRate)}) negative=${d.combined.negative} (${percent(d.combined.negativeRate)})`,
  );
  console.log('');

  console.log(
    'BY HERO',
  );
  console.log(
    '-------',
  );

  for (
    const row
    of d.byHero.slice(0, 20)
  ) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} total=${String(row.total).padEnd(6)} bonusChanging=${String(row.bonusChanging).padEnd(5)} mainZeroBonus=${String(row.mainZeroBonusChanging).padEnd(5)} logicalPositive=${percent(row.bonusLogicalPositiveRate).padEnd(8)} logicalOne=${percent(row.bonusLogicalOneUnitRate)}`,
    );
  }

  console.log('');
  console.log(
    'TOP RAW BONUS-DELTA PATTERNS',
  );
  console.log(
    '----------------------------',
  );

  for (
    const row
    of d.topRawDeltaPatterns.slice(0, 30)
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
      result
        .integrityValidation
        .checks,
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
