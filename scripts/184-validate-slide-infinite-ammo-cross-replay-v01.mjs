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
  evaluateCarrierState,
  PRIMARY_SLIDE_AMMO_CARRIER,
} from '../src/player-state/slide-infinite-ammo-validation.mjs';

import {
  CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
  evaluateCrossReplayReplication,
  summarizeReplayRows,
} from '../src/player-state/slide-infinite-ammo-cross-replay.mjs';

const VERSION =
  'SLIDE_INFINITE_AMMO_CROSS_REPLAY_VALIDATION_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script183:
    resolve(
      'output',
      'test',
      'slide_infinite_ammo_runtime_carrier_validation_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'slide_infinite_ammo_cross_replay_validation_v01.json',
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

const manifest =
  JSON.parse(
    readFileSync(
      PATHS.manifest,
      'utf8',
    ),
  );

const script183 =
  JSON.parse(
    readFileSync(
      PATHS.script183,
      'utf8',
    ),
  );

const EXPECTED_183_STATUS =
  'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_VALIDATION_V01_READY_FOR_CROSS_REPLAY_VALIDATION';

const EXPECTED_183_CLASSIFICATION =
  'SLIDE_INFINITE_AMMO_RUNTIME_CARRIER_STRONGLY_SUPPORTED_SINGLE_REPLAY';

const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort,
  )
    ? manifest.selectedReplicationCohort
        .map(row => String(row.replayName))
    : [];

if (
  cohort.length
  !== CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS.expectedReplayCount
) {
  throw new Error(
    `Expected ${CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS.expectedReplayCount} frozen replication replays, found ${cohort.length}.`,
  );
}

console.log('');
console.log(
  '========================================================',
);
console.log(
  'SLIDE INFINITE-AMMO CROSS-REPLAY VALIDATION V0.1',
);
console.log(
  '========================================================',
);
console.log('');

console.log(
  `Frozen carrier: ${PRIMARY_SLIDE_AMMO_CARRIER.field} bit=${PRIMARY_SLIDE_AMMO_CARRIER.bit}`,
);
console.log(
  `Independent cohort: ${cohort.join(', ')}`,
);
console.log(
  'Discovery replay included: NO',
);
console.log(
  'Carrier retuned: NO',
);
console.log(
  'Semantic rule retuned: NO',
);
console.log('');

const replayResults = [];

for (
  let index = 0;
  index < cohort.length;
  index++
) {
  const replayName =
    cohort[index];

  console.log(
    `--------------------------------------------------------`,
  );
  console.log(
    `[${index + 1}/${cohort.length}] ${replayName}`,
  );
  console.log(
    `--------------------------------------------------------`,
  );

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

  const missing = [];

  if (!existsSync(replayPath)) {
    missing.push(replayPath);
  }

  if (!existsSync(weaponPath)) {
    missing.push(weaponPath);
  }

  if (missing.length) {
    replayResults.push({
      replayName,
      integrityPass: false,
      integrityFailure:
        'MISSING_REQUIRED_INPUT',
      missing,
      rows: [],
      summary: null,
      join: null,
    });

    console.log(
      `INTEGRITY FAILURE: missing ${missing.length} input(s).`,
    );
    console.log('');

    continue;
  }

  const weaponEvents = [];
  let parseFailures = 0;

  for await (
    const line
    of readLines(weaponPath)
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
      parseFailures++;
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

  const pawnStateByEntity =
    new Map();

  const attackTickGuard =
    createAttackTickGuard();

  const rows = [];

  let pawnEntityMutations = 0;
  let joined = 0;
  let joinFailures = 0;

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

        const entity =
          event.entity;

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

      if (!attackByTick.has(tick)) {
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
          replayName,
          tick:
            sample.tick,
          heroId:
            sample.heroId,
          label:
            sample.label,
          wholeDrop:
            sample.wholeDrop,
          shotAdvance:
            sample.shotAdvance,

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
        replayPath,
      ),
    );
  } finally {
    await parser.dispose();
  }

  const joinRate =
    attackSamples.length > 0
      ? joined / attackSamples.length
      : null;

  const integrityPass =
    parseFailures === 0
    && joined + joinFailures
      === attackSamples.length
    && Number.isFinite(joinRate)
    && joinRate >= 0.95
    && rows.length === joined;

  const summary =
    summarizeReplayRows(
      rows,
      CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
    );

  replayResults.push({
    replayName,

    integrityPass,

    inputs: {
      replayPath,
      weaponPath,
    },

    weaponEventRows:
      weaponEvents.length,

    attackSamples:
      attackSamples.length,

    rows,

    join: {
      joined,
      joinFailures,
      joinRate,
      processedAttackTicks:
        attackTickGuard.processedTickCount,
      duplicateTargetPacketHits:
        attackTickGuard.duplicateDemoPacketHits,
      pawnEntityMutations,
      parseFailures,
    },

    summary,
  });

  console.log(
    `attacks=${attackSamples.length} joined=${joined}/${attackSamples.length} (${percent(joinRate)}) carrier=${summary.present.total} P0|carrier=${percent(summary.present.zeroRate)} absent=${summary.absent.total} P0|absent=${percent(summary.absent.zeroRate)} residualPositive=${percent(summary.absent.positiveRate)} negative=${percent(summary.absent.negativeRate)} powered=${summary.sufficientlyPowered} pass=${summary.semanticPass}`,
  );
  console.log('');
}

const replication =
  evaluateCrossReplayReplication(
    replayResults,
    CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,
  );

const checks = {
  script183Ready:
    check(
      script183?.status,
      EXPECTED_183_STATUS,
      script183?.status
        === EXPECTED_183_STATUS,
    ),

  script183ClassificationFrozen:
    check(
      script183
        ?.evaluation
        ?.classification,
      EXPECTED_183_CLASSIFICATION,
      script183
        ?.evaluation
        ?.classification
        === EXPECTED_183_CLASSIFICATION,
    ),

  carrierFrozen:
    check(
      script183
        ?.frozenCarrier
        ?.primary,
      PRIMARY_SLIDE_AMMO_CARRIER,
      script183
        ?.frozenCarrier
        ?.primary
        ?.field
        === PRIMARY_SLIDE_AMMO_CARRIER.field
      && script183
        ?.frozenCarrier
        ?.primary
        ?.bit
        === PRIMARY_SLIDE_AMMO_CARRIER.bit
      && script183
        ?.frozenCarrier
        ?.primary
        ?.mask
        === PRIMARY_SLIDE_AMMO_CARRIER.mask,
    ),

  cohortExactlyFive:
    check(
      cohort.length,
      5,
      cohort.length === 5,
    ),

  discoveryReplayExcluded:
    check(
      cohort.includes('test'),
      false,
      !cohort.includes('test'),
    ),

  allReplayIntegrityPass:
    check(
      replayResults.filter(
        row => row.integrityPass,
      ).length,
      5,
      replayResults.length === 5
      && replayResults.every(
        row => row.integrityPass,
      ),
    ),
};

const integrityPass =
  Object.values(checks)
    .every(row => row.pass);

const replicationPass =
  replication.crossReplayReplicated;

const result = {
  version:
    VERSION,

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  frozenCarrier:
    PRIMARY_SLIDE_AMMO_CARRIER,

  frozenFrom:
    {
      discovery:
        'Script182 V02',
      semanticValidation:
        'Script183 V01',
    },

  validationBoundary: {
    discoveryReplayExcluded:
      true,

    cohort:
      cohort,

    semanticScope:
      'runtime carrier for primary-attack infinite-ammo consequence consistent with sliding',

    explicitlyNotPromoted: [
      'canonical locomotion slide state',
      'magazine capacity',
      'full effective weapon state',
    ],

    carrierRetuned:
      false,

    semanticRuleRetuned:
      false,
  },

  thresholds:
    CROSS_REPLAY_SLIDE_AMMO_THRESHOLDS,

  replays:
    replayResults.map(row => ({
      ...row,
      rows: undefined,
    })),

  pooled:
    replication.pooled,

  replication: {
    replayCount:
      replication.replayCount,
    replayNames:
      replication.replayNames,

    usableReplays:
      replication.usableReplays,
    poweredReplays:
      replication.poweredReplays,
    strongReplays:
      replication.strongReplays,
    contradictoryReplays:
      replication.contradictoryReplays,

    allFiveUsable:
      replication.allFiveUsable,
    allFivePowered:
      replication.allFivePowered,
    noContradictions:
      replication.noContradictions,
    allFiveStrong:
      replication.allFiveStrong,
    pooledPass:
      replication.pooledPass,

    crossReplayReplicated:
      replication.crossReplayReplicated,

    classification:
      replication.classification,
  },

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    pass:
      replicationPass,

    status:
      replicationPass
        ? 'PASS'
        : 'NOT_ESTABLISHED',
  },

  replicationStatus:
    replicationPass
      ? 'cross_replay_replicated'
      : (
        replication.contradictoryReplays.length > 0
          ? 'contradicted'
          : 'insufficient_replication'
      ),

  authorityPromotion:
    false,

  status:
    integrityPass
    && replicationPass
      ? 'SLIDE_INFINITE_AMMO_CROSS_REPLAY_VALIDATION_V01_READY_FOR_AUTHORITY_PROMOTION'
      : (
        integrityPass
          ? 'SLIDE_INFINITE_AMMO_CROSS_REPLAY_VALIDATION_V01_REQUIRES_DIAGNOSIS'
          : 'SLIDE_INFINITE_AMMO_CROSS_REPLAY_VALIDATION_V01_INTEGRITY_FAILURE'
      ),

  nextStep:
    integrityPass
    && replicationPass
      ? 'PROMOTE_NARROW_RUNTIME_SLIDE_INFINITE_AMMO_CARRIER_CLAIM_AND_REVISIT_MAGAZINE_CAPACITY_WITH_CARRIER_PRESENT_ATTACKS_EXCLUDED_FROM_CONSUMPTION_CONTROLS'
      : (
        replication.contradictoryReplays.length > 0
          ? 'DIAGNOSE_CONTRADICTORY_REPLAY_WITHOUT_RETUNING_CARRIER'
          : 'INSPECT_UNDERPOWERED_OR_FAILED_REPLAYS_WITHOUT_RETUNING_CARRIER'
      ),
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

printFinal(result);

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

function percent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : 'n/a';
}

function printFinal(result) {
  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'CROSS-REPLAY SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  for (const row of result.replays) {
    const s =
      row.summary;

    if (!s) {
      console.log(
        `${row.replayName}: INTEGRITY FAILURE`,
      );
      continue;
    }

    console.log(
      `${row.replayName}: attacks=${s.totalRows} carrier=${s.present.total} P0|carrier=${percent(s.present.zeroRate)} P0|absent=${percent(s.absent.zeroRate)} residualPositive=${percent(s.absent.positiveRate)} negative=${percent(s.absent.negativeRate)} powered=${s.sufficientlyPowered} pass=${s.semanticPass}`,
    );
  }

  console.log('');
  console.log(
    'POOLED INDEPENDENT EVIDENCE',
  );
  console.log(
    '---------------------------',
  );

  const pooled =
    result.pooled;

  console.log(
    `attacks:                              ${pooled.totalRows}`,
  );
  console.log(
    `carrier present:                      ${pooled.present.total}`,
  );
  console.log(
    `P(zero | carrier):                    ${percent(pooled.present.zeroRate)}`,
  );
  console.log(
    `carrier absent:                       ${pooled.absent.total}`,
  );
  console.log(
    `P(zero | absent):                     ${percent(pooled.absent.zeroRate)}`,
  );
  console.log(
    `residual positive:                    ${percent(pooled.absent.positiveRate)}`,
  );
  console.log(
    `residual negative:                    ${percent(pooled.absent.negativeRate)}`,
  );
  console.log(
    `supporting hero ids:                  ${JSON.stringify(pooled.heroSupport.supportingHeroes)}`,
  );
  console.log(
    `supporting hero count:                ${pooled.heroSupport.supportingHeroCount}`,
  );

  console.log('');
  console.log(
    'REPLICATION GATES',
  );
  console.log(
    '-----------------',
  );
  console.log(
    `all five usable:                      ${result.replication.allFiveUsable}`,
  );
  console.log(
    `all five powered:                     ${result.replication.allFivePowered}`,
  );
  console.log(
    `all five strong:                      ${result.replication.allFiveStrong}`,
  );
  console.log(
    `no contradictions:                    ${result.replication.noContradictions}`,
  );
  console.log(
    `pooled pass:                          ${result.replication.pooledPass}`,
  );
  console.log(
    `contradictory replays:                ${JSON.stringify(result.replication.contradictoryReplays)}`,
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
    result.replication.classification,
  );
  console.log('');
  console.log(
    `replicationStatus: ${result.replicationStatus}`,
  );
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
