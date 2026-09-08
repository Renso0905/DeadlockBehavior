import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import {
  basename,
  dirname,
  extname,
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
  deriveAttackSamples,
  flattenPrimitiveChanges,
  groupWeaponEventsByContext,
  indexAttackSamplesByTick,
  normalizeWeaponEvent,
} from '../src/player-state/slide-carrier-discovery.mjs';

import {
  createAttackTickGuard,
  resolvePawnForHero,
} from '../src/player-state/slide-carrier-controller-join.mjs';

import {
  COMPANION_CARRIERS,
  evaluateAttackRows,
  PRIMARY_SLIDE_AMMO_CARRIER,
  SLIDE_AMMO_VALIDATION_THRESHOLDS,
} from '../src/player-state/slide-infinite-ammo-validation.mjs';

const VERSION =
  'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_VALIDATION_V01';

const replayPath =
  resolve(
    process.argv[2]
    ?? 'replays/test.dem',
  );

const replayName =
  basename(
    replayPath,
    extname(replayPath),
  );

if (replayName !== 'test') {
  throw new Error(
    [
      'Script183 is single-replay semantic validation and must run on test.dem.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 until the carrier rule is frozen.',
    ].join('\n'),
  );
}

const PATHS = {
  replay:
    replayPath,

  script161Events:
    resolve(
      'output',
      'test',
      'effective_weapon_runtime_events_v01.jsonl',
    ),

  script182:
    resolve(
      'output',
      'test',
      'runtime_slide_carrier_discovery_v02.json',
    ),

  output:
    resolve(
      'output',
      'test',
      'slide_infinite_ammo_runtime_carrier_validation_v01.json',
    ),
};

for (
  const [name, path]
  of Object.entries(PATHS)
) {
  if (name === 'output') {
    continue;
  }

  if (!existsSync(path)) {
    throw new Error(
      `Missing ${name}:\n${path}`,
    );
  }
}

const script182 =
  JSON.parse(
    readFileSync(
      PATHS.script182,
      'utf8',
    ),
  );

const EXPECTED_182_STATUS =
  'RUNTIME_SLIDE_CARRIER_DISCOVERY_V02_READY_FOR_SEMANTIC_VALIDATION';

const EXPECTED_182_CLASSIFICATION =
  'UNIVERSAL_SLIDE_RUNTIME_CARRIER_CANDIDATE_DISCOVERED';

const EXPECTED_ATTACK_PARTITION = {
  POSITIVE: 30337,
  ZERO: 7221,
  NEGATIVE: 13,
  total: 37571,
};

const EXPECTED_PRIMARY = {
  field:
    'm_pModifierProp.m_bvEnabledPredictedStateMask.0002',
  kind:
    'BIT_SET',
  bit: 5,
  value: 32,
};

const discoveredPrimary =
  script182
    ?.candidateDiscovery
    ?.seriousCandidates
    ?.[0]
  ?? null;

const weaponEvents =
  [];

let weaponParseFailures =
  0;

for await (
  const line
  of readLines(
    PATHS.script161Events,
  )
) {
  if (!line.trim()) {
    continue;
  }

  try {
    weaponEvents.push(
      normalizeWeaponEvent(
        JSON.parse(line),
        weaponEvents.length,
      ),
    );
  } catch {
    weaponParseFailures++;
  }
}

const attackSamples =
  deriveAttackSamples(
    groupWeaponEventsByContext(
      weaponEvents,
    ),
  );

const attackByTick =
  indexAttackSamplesByTick(
    attackSamples,
  );

const attackTickGuard =
  createAttackTickGuard();

const pawnStateByEntity =
  new Map();

const evaluationRows =
  [];

let pawnEntityMutations =
  0;

let joined =
  0;

let joinFailures =
  0;

const joinFailureReasons =
  new Map();

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

      pawnEntityMutations++;

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

      Object.assign(
        state,
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

    if (
      !attackByTick.has(tick)
    ) {
      return;
    }

    if (
      !attackTickGuard
        .shouldProcess(tick)
    ) {
      return;
    }

    const samples =
      attackByTick.get(tick);

    const demo =
      parser.getDemo();

    const controllers =
      demo.getEntitiesByClassName(
        'CCitadelPlayerController',
      );

    for (const sample of samples) {
      const resolution =
        resolvePawnForHero({
          demo,
          controllers,
          heroId:
            sample.heroId,
        });

      if (!resolution.pawn) {
        joinFailures++;

        joinFailureReasons.set(
          resolution.provenance,
          (
            joinFailureReasons.get(
              resolution.provenance,
            )
            ?? 0
          ) + 1,
        );

        continue;
      }

      const state =
        pawnStateByEntity.get(
          resolution.pawn.index,
        );

      if (!state) {
        joinFailures++;

        joinFailureReasons.set(
          'RESOLVED_PAWN_STATE_NOT_AVAILABLE',
          (
            joinFailureReasons.get(
              'RESOLVED_PAWN_STATE_NOT_AVAILABLE',
            )
            ?? 0
          ) + 1,
        );

        continue;
      }

      joined++;

      evaluationRows.push({
        tick:
          sample.tick,
        heroId:
          sample.heroId,
        playerKey:
          sample.playerKey,
        label:
          sample.label,
        wholeDrop:
          sample.wholeDrop,
        shotAdvance:
          sample.shotAdvance,
        state:
          {
            [PRIMARY_SLIDE_AMMO_CARRIER.field]:
              state[
                PRIMARY_SLIDE_AMMO_CARRIER.field
              ],

            ...Object.fromEntries(
              COMPANION_CARRIERS.map(
                companion => [
                  companion.field,
                  state[
                    companion.field
                  ],
                ],
              ),
            ),

            m_fFlags:
              state.m_fFlags,

            m_nSuccessiveDucks:
              state.m_nSuccessiveDucks,
          },
      });
    }
  },
);

console.log('');
console.log(
  '========================================================',
);
console.log(
  'SLIDE INFINITE-AMMO RUNTIME CARRIER VALIDATION V0.1',
);
console.log(
  '========================================================',
);
console.log('');

console.log(
  `Replay: ${replayName}`,
);
console.log(
  `Primary carrier: ${PRIMARY_SLIDE_AMMO_CARRIER.field} bit=${PRIMARY_SLIDE_AMMO_CARRIER.bit}`,
);
console.log(
  'Canonical locomotion slide-state claim: NO',
);
console.log(
  'Replication cohort consumed: NO',
);
console.log('');

try {
  await parser.parse(
    createReadStream(
      PATHS.replay,
    ),
  );
} finally {
  await parser.dispose();
}

const evaluation =
  evaluateAttackRows(
    evaluationRows,
  );

const actualPartition =
  partition(
    attackSamples,
  );

const joinRate =
  attackSamples.length > 0
    ? joined / attackSamples.length
    : null;

const checks = {
  script182StatusExpected:
    check(
      script182?.status,
      EXPECTED_182_STATUS,
      script182?.status
        === EXPECTED_182_STATUS,
    ),

  script182ClassificationExpected:
    check(
      script182
        ?.candidateDiscovery
        ?.classification,
      EXPECTED_182_CLASSIFICATION,
      script182
        ?.candidateDiscovery
        ?.classification
        === EXPECTED_182_CLASSIFICATION,
    ),

  discoveredPrimaryFrozen:
    check(
      {
        field:
          discoveredPrimary?.field,
        kind:
          discoveredPrimary?.kind,
        bit:
          discoveredPrimary?.bit,
        value:
          discoveredPrimary?.value,
      },
      EXPECTED_PRIMARY,
      discoveredPrimary?.field
        === EXPECTED_PRIMARY.field
      && discoveredPrimary?.kind
        === EXPECTED_PRIMARY.kind
      && discoveredPrimary?.bit
        === EXPECTED_PRIMARY.bit
      && discoveredPrimary?.value
        === EXPECTED_PRIMARY.value,
    ),

  helperPrimaryMatchesFrozen:
    check(
      PRIMARY_SLIDE_AMMO_CARRIER,
      {
        field:
          EXPECTED_PRIMARY.field,
        bit:
          EXPECTED_PRIMARY.bit,
        mask:
          EXPECTED_PRIMARY.value,
      },
      PRIMARY_SLIDE_AMMO_CARRIER.field
        === EXPECTED_PRIMARY.field
      && PRIMARY_SLIDE_AMMO_CARRIER.bit
        === EXPECTED_PRIMARY.bit
      && PRIMARY_SLIDE_AMMO_CARRIER.mask
        === EXPECTED_PRIMARY.value,
    ),

  weaponParseClean:
    check(
      weaponParseFailures,
      0,
      weaponParseFailures === 0,
    ),

  attackPartitionFrozen:
    check(
      actualPartition,
      EXPECTED_ATTACK_PARTITION,
      JSON.stringify(
        actualPartition,
      ) === JSON.stringify(
        EXPECTED_ATTACK_PARTITION,
      ),
    ),

  attackJoinComplete:
    check(
      {
        joined,
        failures:
          joinFailures,
        total:
          attackSamples.length,
      },
      {
        joined: 37571,
        failures: 0,
        total: 37571,
      },
      joined === 37571
      && joinFailures === 0
      && attackSamples.length
        === 37571,
    ),

  attackTickProcessingOnePass:
    check(
      joined + joinFailures,
      attackSamples.length,
      joined + joinFailures
        === attackSamples.length,
    ),

  replicationCohortStillUnused:
    check(
      replayName,
      'test',
      replayName === 'test',
    ),
};

const integrityPass =
  Object.values(checks)
    .every(
      row => row.pass,
    );

const semanticPass =
  evaluation.semanticPass;

const result = {
  version:
    VERSION,

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  replay:
    replayName,

  status:
    integrityPass
    && semanticPass
      ? 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_VALIDATION_V01_READY_FOR_CROSS_REPLAY_VALIDATION'
      : (
        integrityPass
          ? 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_VALIDATION_V01_REQUIRES_DIAGNOSIS'
          : 'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_VALIDATION_V01_INTEGRITY_FAILURE'
      ),

  frozenCarrier: {
    primary:
      PRIMARY_SLIDE_AMMO_CARRIER,

    companions:
      COMPANION_CARRIERS,

    interpretation:
      'Narrow candidate carrier for the runtime state in which primary attacks do not consume whole clip ammunition, consistent with universal slide infinite-ammo behavior.',

    explicitlyNotClaimed: [
      'canonical locomotion sliding state for all movement analyses',
      'magazine capacity authority',
      'full effective weapon state',
    ],
  },

  thresholds:
    SLIDE_AMMO_VALIDATION_THRESHOLDS,

  replayJoin: {
    pawnEntityMutations,
    joined,
    joinFailures,
    joinRate,
    processedAttackTicks:
      attackTickGuard
        .processedTickCount,
    duplicateTargetPacketHits:
      attackTickGuard
        .duplicateDemoPacketHits,

    joinFailureReasons:
      [...joinFailureReasons.entries()]
        .map(
          ([reason, count]) => ({
            reason,
            count,
          }),
        )
        .sort(
          (a, b) =>
            b.count - a.count,
        ),
  },

  evaluation,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    pass:
      semanticPass,

    status:
      semanticPass
        ? 'STRONG_SINGLE_REPLAY_NARROW_CONSEQUENCE_SEMANTICS'
        : 'NOT_ESTABLISHED',

    replicationStatus:
      'single_replay_only',

    authorityPromotion:
      false,
  },

  nextStep:
    integrityPass
    && semanticPass
      ? 'FREEZE_RULE_UNCHANGED_AND_VALIDATE_ON_REP01_REP05;_REPLICATION_SCOPE_IS_SLIDE_INFINITE_AMMO_CONSEQUENCE_CARRIER_NOT_GENERAL_LOCOMOTION_SLIDE_STATE'
      : 'DIAGNOSE_CARRIER_DISAGREEMENTS_ON_TEST_ONLY',
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

function partition(samples) {
  return {
    POSITIVE:
      samples.filter(
        row =>
          row.label
          === 'POSITIVE',
      ).length,

    ZERO:
      samples.filter(
        row =>
          row.label
          === 'ZERO',
      ).length,

    NEGATIVE:
      samples.filter(
        row =>
          row.label
          === 'NEGATIVE',
      ).length,

    total:
      samples.length,
  };
}

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
  return Number.isFinite(
    value,
  )
    ? `${(
      value * 100
    ).toFixed(2)}%`
    : 'n/a';
}

function print(result) {
  console.log('');
  console.log(
    'REPLAY JOIN',
  );
  console.log(
    '-----------',
  );
  console.log(
    `joined:                               ${result.replayJoin.joined}/37571 (${percent(result.replayJoin.joinRate)})`,
  );
  console.log(
    `processed attack ticks:               ${result.replayJoin.processedAttackTicks}`,
  );
  console.log('');

  console.log(
    'PRIMARY CARRIER CONSEQUENCE',
  );
  console.log(
    '---------------------------',
  );

  for (
    const [name, metrics]
    of [
      [
        'pooled',
        result.evaluation.pooled,
      ],
      [
        'excluding Vyper',
        result.evaluation.nonVyper,
      ],
      [
        'Vyper',
        result.evaluation.vyper,
      ],
    ]
  ) {
    console.log(
      `${name}: present=${metrics.present.total} P(zero|present)=${percent(metrics.present.zeroRate)} absent=${metrics.absent.total} P(zero|absent)=${percent(metrics.absent.zeroRate)} zeroRecall=${percent(metrics.zeroRecall)} exposure=${percent(metrics.carrierPrevalence)}`,
    );
  }

  console.log('');
  console.log(
    'WITHIN-HERO SUPPORT',
  );
  console.log(
    '-------------------',
  );
  console.log(
    `supporting non-Vyper heroes:          ${result.evaluation.byHero.supportingNonVyperHeroCount}`,
  );
  console.log(
    `hero ids:                             ${JSON.stringify(result.evaluation.byHero.supportingNonVyperHeroes)}`,
  );
  console.log(
    `Vyper carrier exposure:               ${percent(result.evaluation.byHero.vyperExposure)}`,
  );
  console.log(
    `max non-Vyper carrier exposure:       ${percent(result.evaluation.byHero.maxNonVyperExposure)}`,
  );

  for (
    const hero
    of result.evaluation
      .byHero.heroes
  ) {
    console.log(
      `hero=${String(hero.heroId).padEnd(4)} present=${String(hero.present.total).padEnd(6)} P0present=${percent(hero.present.zeroRate).padEnd(8)} absent=${String(hero.absent.total).padEnd(6)} P0absent=${percent(hero.absent.zeroRate).padEnd(8)} recall=${percent(hero.zeroRecall).padEnd(8)} exposure=${percent(hero.carrierPrevalence)}`,
    );
  }

  console.log('');
  console.log(
    'RESIDUAL CLIP-COUNTER BEHAVIOR',
  );
  console.log(
    '------------------------------',
  );
  console.log(
    `carrier-absent transitions:           ${result.evaluation.residual.total}`,
  );
  console.log(
    `positive:                             ${result.evaluation.residual.POSITIVE} (${percent(result.evaluation.residual.positiveRate)})`,
  );
  console.log(
    `zero:                                 ${result.evaluation.residual.ZERO} (${percent(result.evaluation.residual.zeroRate)})`,
  );
  console.log(
    `negative:                             ${result.evaluation.residual.NEGATIVE} (${percent(result.evaluation.residual.negativeRate)})`,
  );

  console.log('');
  console.log(
    'COMPANION-CARRIER REDUNDANCY',
  );
  console.log(
    '----------------------------',
  );

  for (
    const row
    of result.evaluation
      .companions
  ) {
    console.log(
      `${row.name}: comparable=${row.comparable} primary=${row.primaryPresent} companion=${row.companionPresent} jaccard=${percent(row.jaccard)} disagreement=${row.disagreement} (${percent(row.disagreementRate)})`,
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
      `${name.padEnd(42)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log(
    'SEMANTIC VALIDATION',
  );
  console.log(
    '-------------------',
  );
  console.log(
    `pass: ${result.semanticValidation.pass}`,
  );
  console.log(
    `status: ${result.semanticValidation.status}`,
  );

  console.log('');
  console.log(
    'CLASSIFICATION',
  );
  console.log(
    '--------------',
  );
  console.log(
    result.evaluation
      .classification,
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
