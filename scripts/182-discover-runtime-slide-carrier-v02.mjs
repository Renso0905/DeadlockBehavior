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
  createCandidateAccumulator,
  deriveAttackSamples,
  finalizeCandidates,
  flattenPrimitiveChanges,
  groupWeaponEventsByContext,
  indexAttackSamplesByTick,
  normalizeWeaponEvent,
  observePawnSample,
  SLIDE_DISCOVERY_THRESHOLDS,
} from '../src/player-state/slide-carrier-discovery.mjs';

import {
  createAttackTickGuard,
  resolvePawnForHero,
} from '../src/player-state/slide-carrier-controller-join.mjs';

const VERSION =
  'RUNTIME_SLIDE_CARRIER_DISCOVERY_V02';

const replayPath =
  resolve(
    process.argv[2] ?? 'replays/test.dem',
  );

const replayName =
  basename(
    replayPath,
    extname(replayPath),
  );

if (replayName !== 'test') {
  throw new Error(
    [
      'Script182 is discovery-only and must run on test.dem.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 for slide-carrier discovery.',
    ].join('\n'),
  );
}

const PATHS = {
  replay: replayPath,

  script161Events: resolve(
    'output',
    'test',
    'effective_weapon_runtime_events_v01.jsonl',
  ),

  script181: resolve(
    'output',
    'test',
    'hero58_clip_batching_diagnostic_v01.json',
  ),

  output: resolve(
    'output',
    'test',
    'runtime_slide_carrier_discovery_v02.json',
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

const script181 =
  JSON.parse(
    readFileSync(
      PATHS.script181,
      'utf8',
    ),
  );

const EXPECTED_181_STATUS =
  'HERO58_CLIP_BATCHING_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_181_CLASSIFICATION =
  'GENERIC_ZIGZAG_CLIP_COUNTER_STRONG_OUTSIDE_HERO58_HERO58_BATCH_MECHANISM_REQUIRES_DIAGNOSIS';

const EXPECTED_ATTACK_PARTITION = {
  POSITIVE: 30337,
  ZERO: 7221,
  NEGATIVE: 13,
  total: 37571,
};

const weaponEvents = [];
let weaponEventParseFailures = 0;

for await (
  const line
  of readLines(PATHS.script161Events)
) {
  if (!line.trim()) continue;

  try {
    weaponEvents.push(
      normalizeWeaponEvent(
        JSON.parse(line),
        weaponEvents.length,
      ),
    );
  } catch {
    weaponEventParseFailures++;
  }
}

const attackSamples =
  deriveAttackSamples(
    groupWeaponEventsByContext(
      weaponEvents,
    ),
  );

const attackPartition =
  partitionAttackSamples(
    attackSamples,
  );

const attackByTick =
  indexAttackSamplesByTick(
    attackSamples,
  );

const candidateAccumulator =
  createCandidateAccumulator(
    SLIDE_DISCOVERY_THRESHOLDS,
  );

const pawnStateByEntity =
  new Map();

let pawnEntityMutations = 0;
let attackSamplesJoined = 0;
let attackSamplesWithoutPawn = 0;
let attackSamplesWithAmbiguousPawn = 0;

const joinFailureReasons =
  new Map();

const pawnHandleFieldCounts =
  new Map();

const attackTickGuard =
  createAttackTickGuard();

const heroJoinCounts =
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

      pawnEntityMutations++;

      if (!pawnStateByEntity.has(entity.index)) {
        pawnStateByEntity.set(
          entity.index,
          {},
        );
      }

      const state =
        pawnStateByEntity.get(entity.index);

      const flattened =
        flattenPrimitiveChanges(
          event.getChanges(),
        );

      Object.assign(
        state,
        flattened,
      );

      const heroId =
        entity.getField('m_nHeroID');

      if (
        heroId !== undefined
        && heroId !== null
      ) {
        state.m_nHeroID =
          Number(heroId);
      }

      const lifeState =
        entity.getField('m_lifeState');

      if (
        lifeState !== undefined
        && lifeState !== null
      ) {
        state.m_lifeState =
          Number(lifeState);
      }
    }
  },
);

parser.registerPostInterceptor(
  InterceptorStage.DEMO_PACKET,
  demoPacket => {
    const tick =
      demoPacket.tick;

    if (!attackByTick.has(tick)) {
      return;
    }

    if (!attackTickGuard.shouldProcess(tick)) {
      return;
    }

    const samples =
      attackByTick.get(tick);

    if (!samples?.length) return;

    const demo =
      parser.getDemo();

    const controllers =
      demo.getEntitiesByClassName(
        'CCitadelPlayerController',
      );

    for (const sample of samples) {
      const heroId =
        Number(sample.heroId);

      const resolution =
        resolvePawnForHero({
          demo,
          controllers,
          heroId,
        });

      const pawn =
        resolution.pawn;

      if (!pawn) {
        attackSamplesWithoutPawn++;

        joinFailureReasons.set(
          resolution.provenance,
          (
            joinFailureReasons.get(
              resolution.provenance,
            )
            ?? 0
          ) + 1,
        );

        if (
          resolution.provenance
          === 'AMBIGUOUS_CONTROLLERS_FOR_HERO'
        ) {
          attackSamplesWithAmbiguousPawn++;
        }

        continue;
      }

      if (resolution.pawnHandleField) {
        pawnHandleFieldCounts.set(
          resolution.pawnHandleField,
          (
            pawnHandleFieldCounts.get(
              resolution.pawnHandleField,
            )
            ?? 0
          ) + 1,
        );
      }

      const state =
        pawnStateByEntity.get(
          pawn.index,
        );

      if (!state) {
        attackSamplesWithoutPawn++;

        joinFailureReasons.set(
          'RESOLVED_PAWN_STATE_NOT_YET_AVAILABLE',
          (
            joinFailureReasons.get(
              'RESOLVED_PAWN_STATE_NOT_YET_AVAILABLE',
            )
            ?? 0
          ) + 1,
        );

        continue;
      }

      attackSamplesJoined++;

      heroJoinCounts.set(
        heroId,
        (
          heroJoinCounts.get(heroId)
          ?? 0
        ) + 1,
      );

      observePawnSample(
        candidateAccumulator,
        {
          heroId,
          label: sample.label,
          fields: state,
        },
      );
    }
  },
);

console.log('');
console.log(
  '========================================================',
);
console.log(
  'RUNTIME SLIDE CARRIER DISCOVERY V0.2',
);
console.log(
  '========================================================',
);
console.log('');

console.log(`Replay: ${replayName}`);
console.log(
  'Discovery target: universal slide-state carrier',
);
console.log(
  'Vyper role: positive-control exposure only',
);
console.log(
  'Replication cohort consumed: NO',
);
console.log('');

console.log(
  `Parsing replay:\n${PATHS.replay}`,
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

const candidates =
  finalizeCandidates(
    candidateAccumulator,
    SLIDE_DISCOVERY_THRESHOLDS,
  );

const joinRate =
  attackSamples.length > 0
    ? attackSamplesJoined
      / attackSamples.length
    : null;

const checks = {
  script181StatusExpected: check(
    script181?.status,
    EXPECTED_181_STATUS,
    script181?.status
      === EXPECTED_181_STATUS,
  ),

  script181ClassificationExpected: check(
    script181?.classification,
    EXPECTED_181_CLASSIFICATION,
    script181?.classification
      === EXPECTED_181_CLASSIFICATION,
  ),

  weaponEventParseClean: check(
    weaponEventParseFailures,
    0,
    weaponEventParseFailures === 0,
  ),

  attackPartitionFrozen: check(
    attackPartition,
    EXPECTED_ATTACK_PARTITION,
    deepEqual(
      attackPartition,
      EXPECTED_ATTACK_PARTITION,
    ),
  ),

  attackTickProcessingOnePass: check(
    attackSamplesJoined
      + attackSamplesWithoutPawn,
    attackSamples.length,
    attackSamplesJoined
      + attackSamplesWithoutPawn
      === attackSamples.length,
  ),

  attackPawnJoinStrong: check(
    joinRate,
    '>=0.95',
    Number.isFinite(joinRate)
      && joinRate >= 0.95,
  ),

  pawnMutationCoverageSubstantial: check(
    pawnEntityMutations,
    '>10000',
    pawnEntityMutations > 10000,
  ),

  nonVyperZeroControlsPresent: check(
    attackSamples.filter(
      row =>
        row.heroId !== 58
        && row.label === 'ZERO',
    ).length,
    '>500',
    attackSamples.filter(
      row =>
        row.heroId !== 58
        && row.label === 'ZERO',
    ).length > 500,
  ),

  replicationCohortStillUnused: check(
    replayName,
    'test',
    replayName === 'test',
  ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt:
    new Date().toISOString(),

  status:
    integrityPass
      ? (
        candidates.classification
          === 'UNIVERSAL_SLIDE_RUNTIME_CARRIER_CANDIDATE_DISCOVERED'
          ? 'RUNTIME_SLIDE_CARRIER_DISCOVERY_V02_READY_FOR_SEMANTIC_VALIDATION'
          : 'RUNTIME_SLIDE_CARRIER_DISCOVERY_V02_REQUIRES_DIAGNOSIS'
      )
      : 'RUNTIME_SLIDE_CARRIER_DISCOVERY_V02_INTEGRITY_FAILURE',

  replay: replayName,

  scientificBoundary: {
    consequenceProxy:
      'zero ZigZag-transformed whole-clip decrement on a real attack transition',
    controls:
      'positive transformed whole-clip decrement attack transitions',
    specialHero:
      {
        heroId: 58,
        role:
          'positive-control exposure only; cannot define universal candidate',
      },
    discovery:
      [
        'exact low-cardinality CCitadelPlayerPawn scalar states',
        'set bits of non-negative integer pawn fields',
        'descriptive numeric movement-field differences',
      ],
    semanticRequirement:
      'serious candidate must retain strong zero-consumption association outside hero58 and within multiple non-Vyper heroes',
    authorityPromotion: false,
    V02JoinCorrection:
      'V01 direct pawn.m_nHeroID join recovered 0/37,571. V02 uses controller.m_nHeroID -> m_hHeroPawn/m_hPawn and processes each target attack tick once.',
    replicationStatus:
      'single_replay_discovery_only',
  },

  thresholds:
    SLIDE_DISCOVERY_THRESHOLDS,

  attackEvidence: {
    eventRows:
      weaponEvents.length,
    attackSamples:
      attackSamples.length,
    partition:
      attackPartition,
    hero58: partitionAttackSamples(
      attackSamples.filter(
        row => row.heroId === 58,
      ),
    ),
    excludingHero58:
      partitionAttackSamples(
        attackSamples.filter(
          row => row.heroId !== 58,
        ),
      ),
  },

  replayJoin: {
    pawnEntityMutations,
    attackSamplesJoined,
    attackSamplesWithoutPawn,
    attackSamplesWithAmbiguousPawn,
    joinRate,

    attackTickGuard: {
      processedTickCount:
        attackTickGuard.processedTickCount,
      duplicateDemoPacketHits:
        attackTickGuard.duplicateDemoPacketHits,
    },

    joinFailureReasons:
      [...joinFailureReasons.entries()]
        .map(([reason, count]) => ({
          reason,
          count,
        }))
        .sort((a, b) =>
          b.count - a.count
        ),

    pawnHandleFieldCounts:
      [...pawnHandleFieldCounts.entries()]
        .map(([field, count]) => ({
          field,
          count,
        }))
        .sort((a, b) =>
          b.count - a.count
        ),

    heroJoinCounts:
      [...heroJoinCounts.entries()]
        .map(([heroId, count]) => ({
          heroId,
          count,
        }))
        .sort(
          (a, b) =>
            b.count - a.count,
        ),
  },

  candidateDiscovery: {
    classification:
      candidates.classification,

    seriousCandidates:
      candidates.serious.slice(0, 50),

    topRanked:
      candidates.ranked.slice(0, 100),

    topMovementNamed:
      candidates.ranked
        .filter(
          row =>
            row.movementNameHint,
        )
        .slice(0, 100),

    numericMovement:
      candidates.numericMovement.slice(
        0,
        100,
      ),
  },

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      candidates.classification
        === 'UNIVERSAL_SLIDE_RUNTIME_CARRIER_CANDIDATE_DISCOVERED'
        ? 'CANDIDATE_ONLY_REQUIRES_DIRECT_SLIDE_SEMANTIC_TEST'
        : 'NOT_ESTABLISHED',
    authorityPromotion: false,
    V02JoinCorrection:
      'V01 direct pawn.m_nHeroID join recovered 0/37,571. V02 uses controller.m_nHeroID -> m_hHeroPawn/m_hPawn and processes each target attack tick once.',
    replicationStatus:
      'single_replay_only',
  },

  nextStep:
    candidates.classification
      === 'UNIVERSAL_SLIDE_RUNTIME_CARRIER_CANDIDATE_DISCOVERED'
      ? 'FREEZE_TOP_SLIDE_CARRIER_CANDIDATE_AND_TEST_P_ZERO_CLIP_DROP_GIVEN_CARRIER_ACROSS_HEROES_ON_TEST_BEFORE_REPLICATION'
      : 'INSPECT_TOP_MOVEMENT_NAMED_AND_NUMERIC_CANDIDATES_AND_IF_NEEDED_DISCOVER_INPUT_OR_MOVEMENT_SUBCLASS_FIELDS_ON_TEST',
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

function partitionAttackSamples(samples) {
  return {
    POSITIVE:
      samples.filter(
        row => row.label === 'POSITIVE',
      ).length,
    ZERO:
      samples.filter(
        row => row.label === 'ZERO',
      ).length,
    NEGATIVE:
      samples.filter(
        row => row.label === 'NEGATIVE',
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

function check(actual, expected, pass) {
  return {
    actual,
    expected,
    pass: Boolean(pass),
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a)
    === JSON.stringify(b);
}

function percent(value) {
  return Number.isFinite(value)
    ? `${(
      value * 100
    ).toFixed(1)}%`
    : 'n/a';
}

function print(result) {
  console.log('');
  console.log('ATTACK CONSEQUENCE BASELINE');
  console.log('---------------------------');
  console.log(
    `attack samples:                       ${result.attackEvidence.attackSamples}`,
  );
  console.log(
    `positive / zero / negative:           ${result.attackEvidence.partition.POSITIVE} / ${result.attackEvidence.partition.ZERO} / ${result.attackEvidence.partition.NEGATIVE}`,
  );
  console.log(
    `non-Vyper zero controls:              ${result.attackEvidence.excludingHero58.ZERO}`,
  );
  console.log('');

  console.log('REPLAY JOIN');
  console.log('-----------');
  console.log(
    `pawn entity mutations:                ${result.replayJoin.pawnEntityMutations}`,
  );
  console.log(
    `attack samples joined to pawn:        ${result.replayJoin.attackSamplesJoined}/${result.attackEvidence.attackSamples} (${percent(result.replayJoin.joinRate)})`,
  );
  console.log(
    `without pawn:                         ${result.replayJoin.attackSamplesWithoutPawn}`,
  );
  console.log(
    `ambiguous controller join:            ${result.replayJoin.attackSamplesWithAmbiguousPawn}`,
  );
  console.log(
    `processed attack ticks:               ${result.replayJoin.attackTickGuard.processedTickCount}`,
  );
  console.log(
    `duplicate target demo-packet hits:     ${result.replayJoin.attackTickGuard.duplicateDemoPacketHits}`,
  );

  console.log(
    `pawn handle fields:                    ${JSON.stringify(result.replayJoin.pawnHandleFieldCounts)}`,
  );

  if (
    result.replayJoin
      .joinFailureReasons.length
  ) {
    console.log(
      `join failures:                        ${JSON.stringify(result.replayJoin.joinFailureReasons)}`,
    );
  }

  console.log('');

  console.log('SERIOUS UNIVERSAL CANDIDATES');
  console.log('----------------------------');

  if (
    result.candidateDiscovery
      .seriousCandidates.length === 0
  ) {
    console.log('NONE');
  } else {
    for (
      const row
      of result.candidateDiscovery
        .seriousCandidates
    ) {
      printCandidate(row);
    }
  }

  console.log('');
  console.log('TOP MOVEMENT-NAMED CANDIDATES');
  console.log('-----------------------------');

  for (
    const row
    of result.candidateDiscovery
      .topMovementNamed
      .slice(0, 30)
  ) {
    printCandidate(row);
  }

  console.log('');
  console.log('TOP NUMERIC MOVEMENT FIELDS');
  console.log('---------------------------');

  for (
    const row
    of result.candidateDiscovery
      .numericMovement
      .slice(0, 30)
  ) {
    console.log(
      `${row.field} zeroN=${row.zeroN} positiveN=${row.positiveN} zeroMedian=${row.zeroMedian} positiveMedian=${row.positiveMedian} stdDiff=${Number(row.standardizedMeanDifference).toFixed(3)}`,
    );
  }

  console.log('');
  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');

  for (
    const [name, row]
    of Object.entries(
      result.integrityValidation
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
    result.candidateDiscovery
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

function printCandidate(row) {
  const valueText =
    row.kind === 'BIT_SET'
      ? `bit=${row.bit} mask=${row.value}`
      : `value=${JSON.stringify(row.value)}`;

  console.log(
    `${row.field} [${row.kind} ${valueText}] nonVyperPresent=${row.nonVyperPresent} P0|present=${percent(row.nonVyper.presentZeroRate)} P0|absent=${percent(row.nonVyper.absentZeroRate)} RD=${percent(row.nonVyper.riskDifference)} heroes=${row.supportingNonVyperHeroCount} score=${row.score.toFixed(1)}`,
  );
}
