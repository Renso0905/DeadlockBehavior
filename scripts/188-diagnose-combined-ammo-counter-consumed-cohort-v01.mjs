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
  COMBINED_AMMO_DIAGNOSTIC_THRESHOLDS,
  summarizeCombinedAmmoRows,
  zigzagReencode,
} from '../src/player-state/combined-ammo-counter-consumed-cohort.mjs';

const VERSION =
  'COMBINED_AMMO_COUNTER_CONSUMED_COHORT_DIAGNOSTIC_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script187:
    resolve(
      'output',
      'test',
      'bonus_clip_zigzag_representation_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'combined_ammo_counter_consumed_cohort_diagnostic_v01.json',
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

const script187 =
  JSON.parse(
    readFileSync(
      PATHS.script187,
      'utf8',
    ),
  );

const EXPECTED_187_STATUS =
  'BONUS_CLIP_ZIGZAG_REPRESENTATION_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_187_CLASSIFICATION =
  'BONUS_CLIP_ZIGZAG_IS_STRONG_SECOND_LOGICAL_AMMO_COUNTER_CANDIDATE';

const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort,
  )
    ? manifest.selectedReplicationCohort
      .map(row => String(row.replayName))
    : [];

if (cohort.length !== 5) {
  throw new Error(
    `Expected five consumed replays, found ${cohort.length}.`,
  );
}

console.log('');
console.log(
  '========================================================',
);
console.log(
  'COMBINED AMMO COUNTER — CONSUMED COHORT DIAGNOSTIC V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Frozen hypothesis: Z(m_iClip) + Z(m_iBonusClip)',
);
console.log(
  'rep01-rep05 treated as independent validation: NO',
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const allRows = [];
const replayIntegrity = [];

for (const replayName of cohort) {
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

  if (
    !existsSync(replayPath)
    || !existsSync(weaponPath)
  ) {
    replayIntegrity.push({
      replayName,
      pass: false,
      reason:
        'MISSING_REQUIRED_INPUT',
    });
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
        normalizeDetailedWeaponEvent(
          JSON.parse(line),
          weaponEvents.length,
        ),
      );
    } catch {
      parseFailures++;
    }
  }

  const transitions =
    deriveTransitions(
      groupDetailedWeaponEvents(
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

  const pawnStateByEntity = new Map();
  const tickGuard = createAttackTickGuard();

  const replayRows = [];
  let joined = 0;
  let joinFailures = 0;

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

      if (!byTick.has(tick)) return;

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

        replayRows.push({
          replayName,
          ...transition,
          covered:
            carrier.covered,
          carrierPresent:
            carrier.present,
        });
      }
    },
  );

  try {
    await parser.parse(
      createReadStream(replayPath),
    );
  } finally {
    await parser.dispose();
  }

  const pass =
    parseFailures === 0
    && joinFailures === 0
    && joined === transitions.length;

  replayIntegrity.push({
    replayName,
    pass,
    transitions:
      transitions.length,
    joined,
    joinFailures,
    parseFailures,
  });

  allRows.push(...replayRows);

  console.log(
    `${replayName}: transitions=${transitions.length} joined=${joined}/${transitions.length}`,
  );
}

const diagnostic =
  summarizeCombinedAmmoRows(
    allRows,
    COMBINED_AMMO_DIAGNOSTIC_THRESHOLDS,
  );

const checks = {
  script187Ready:
    check(
      script187?.status,
      EXPECTED_187_STATUS,
      script187?.status
        === EXPECTED_187_STATUS,
    ),

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

  bonusZigzagFrozen:
    check(
      {
        negative5:
          zigzagReencode(-5),
        positive4:
          zigzagReencode(4),
      },
      {
        negative5: 9,
        positive4: 8,
      },
      zigzagReencode(-5) === 9
      && zigzagReencode(4) === 8,
    ),

  allFiveIntegrityPass:
    check(
      replayIntegrity.filter(
        row => row.pass,
      ).length,
      5,
      replayIntegrity.length === 5
      && replayIntegrity.every(
        row => row.pass,
      ),
    ),

  consumedCohortExplicitlyNotIndependent:
    check(
      false,
      false,
      true,
    ),
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

  status:
    integrityPass
      ? 'COMBINED_AMMO_COUNTER_CONSUMED_COHORT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'COMBINED_AMMO_COUNTER_CONSUMED_COHORT_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    hypothesis:
      'drop(Z(m_iClip)) + drop(Z(m_iBonusClip))',

    cohort:
      cohort,

    independentValidation:
      false,

    reason:
      'rep01-rep05 contributed to formation of the bonus-ZigZag hypothesis through Scripts185-186',

    authorityPromotion:
      false,
  },

  thresholds:
    COMBINED_AMMO_DIAGNOSTIC_THRESHOLDS,

  replayIntegrity,

  diagnostic,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      'CONSUMED_COHORT_DIAGNOSTIC_ONLY',
    authorityPromotion:
      false,
    replicationStatus:
      'not_independent',
  },

  nextStep:
    diagnostic.classification
      === 'BONUS_CLIP_ZIGZAG_GENERALIZES_ACROSS_MULTIPLE_HEROES_IN_CONSUMED_COHORT'
      ? 'FREEZE_COMBINED_LOGICAL_AMMO_COUNTER_AS_CANDIDATE;_NEW_INDEPENDENT_REPLAYS_ARE_REQUIRED_FOR_REPLICATION;_DIAGNOSE_REMAINING_COMBINED_ZERO_NEGATIVE_TRANSITIONS_SEPARATELY'
      : 'KEEP_BONUS_ZIGZAG_HERO_SCOPED_OR_UNRESOLVED_AND_DIAGNOSE_FAILURES_BEFORE_NEW_REPLICATION',
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

function deriveTransitions(grouped) {
  const transitions = [];

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

  return transitions;
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
    'COMBINED LOGICAL AMMO SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `carrier-absent transitions:          ${d.carrierAbsent}`,
  );
  console.log(
    `main-zero bonus-changing:            ${d.mainZeroBonusChanging}`,
  );
  console.log(
    `bonus logical positive:              ${d.bonusLogicalPositive} (${percent(d.bonusLogicalPositiveRate)})`,
  );
  console.log(
    `bonus logical exactly one:           ${d.bonusLogicalOne} (${percent(d.bonusLogicalOneUnitRate)})`,
  );
  console.log('');

  console.log(
    'BASELINE MAIN COUNTER',
  );
  console.log(
    '---------------------',
  );
  console.log(
    `positive=${d.baseline.positive} (${percent(d.baseline.positiveRate)}) zero=${d.baseline.zero} (${percent(d.baseline.zeroRate)}) negative=${d.baseline.negative} (${percent(d.baseline.negativeRate)}) residual=${d.baselineResidual}`,
  );
  console.log('');

  console.log(
    'COMBINED MAIN + BONUS COUNTER',
  );
  console.log(
    '-----------------------------',
  );
  console.log(
    `positive=${d.combined.positive} (${percent(d.combined.positiveRate)}) zero=${d.combined.zero} (${percent(d.combined.zeroRate)}) negative=${d.combined.negative} (${percent(d.combined.negativeRate)}) residual=${d.combinedResidual}`,
  );
  console.log(
    `positive-rate gain:                   ${percent(d.positiveRateGain)}`,
  );
  console.log(
    `residual reduction:                   ${percent(d.residualReduction)}`,
  );
  console.log('');

  console.log(
    'BY REPLAY',
  );
  console.log(
    '---------',
  );

  for (const row of d.byReplay) {
    console.log(
      `${row.replayName}: baselinePositive=${percent(row.baseline.positiveRate)} combinedPositive=${percent(row.combined.positiveRate)} combinedZero=${percent(row.combined.zeroRate)} combinedNegative=${percent(row.combined.negativeRate)}`,
    );
  }

  console.log('');
  console.log(
    'BY HERO — BONUS ZIGZAG SUPPORT',
  );
  console.log(
    '------------------------------',
  );

  for (
    const row
    of d.byHero.slice(0, 25)
  ) {
    console.log(
      `hero=${String(row.heroId).padEnd(4)} informative=${String(row.informative).padEnd(5)} positive=${percent(row.positiveRate).padEnd(8)} oneUnit=${percent(row.oneRate).padEnd(8)} support=${row.support}`,
    );
  }

  console.log('');
  console.log(
    `supporting heroes:                    ${JSON.stringify(d.supportingHeroes)}`,
  );
  console.log(
    `supporting hero count:                ${d.supportingHeroCount}`,
  );

  console.log('');
  console.log(
    'REMAINING COMBINED RESIDUALS BY HERO',
  );
  console.log(
    '------------------------------------',
  );

  for (
    const row
    of d.remainingResidualByHero.slice(0, 20)
  ) {
    console.log(
      `hero=${String(row.key).padEnd(4)} total=${String(row.total).padEnd(5)} zero=${String(row.zero).padEnd(5)} negative=${row.negative}`,
    );
  }

  console.log('');
  console.log(
    'TOP REMAINING PATTERNS',
  );
  console.log(
    '----------------------',
  );

  for (
    const row
    of d.topRemainingPatterns.slice(0, 30)
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
      result.integrityValidation.checks,
    )
  ) {
    console.log(
      `${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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
