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
  deepFindExactKey,
  groupDetailedWeaponEvents,
  normalizeDetailedWeaponEvent,
} from '../src/player-state/slide-carrier-residual-diagnostic.mjs';

import {
  summarizeResidualProvenance,
} from '../src/player-state/ammo-residual-provenance-diagnostic.mjs';

const VERSION =
  'COMBINED_AMMO_RESIDUAL_PROVENANCE_DIAGNOSTIC_V01';

const PATHS = {
  manifest:
    resolve(
      'output',
      'cross_replay',
      'replication_manifest_v01.json',
    ),

  script188:
    resolve(
      'output',
      'cross_replay',
      'combined_ammo_counter_consumed_cohort_diagnostic_v01.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'combined_ammo_residual_provenance_diagnostic_v01.json',
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

const manifest =
  JSON.parse(
    readFileSync(
      PATHS.manifest,
      'utf8',
    ),
  );

const script188 =
  JSON.parse(
    readFileSync(
      PATHS.script188,
      'utf8',
    ),
  );

const EXPECTED_188_STATUS =
  'COMBINED_AMMO_COUNTER_CONSUMED_COHORT_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION';

const EXPECTED_188_CLASSIFICATION =
  'BONUS_CLIP_ZIGZAG_GENERALIZES_ACROSS_MULTIPLE_HEROES_IN_CONSUMED_COHORT';

const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort,
  )
    ? manifest.selectedReplicationCohort
      .map(
        row => String(row.replayName),
      )
    : [];

if (cohort.length !== 5) {
  throw new Error(
    `Expected five consumed cohort replays, found ${cohort.length}.`,
  );
}

console.log('');
console.log(
  '========================================================',
);
console.log(
  'COMBINED AMMO RESIDUAL PROVENANCE DIAGNOSTIC V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  'Combined counter frozen from Script188 interpretation: Z(clip)+Z(bonusClip)',
);
console.log(
  'Slide carrier unchanged: mask0002 bit5',
);
console.log(
  'Consumed cohort treated as fresh validation: NO',
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

        reloadQueuedStartTime:
          finite(firstDefined(
            raw?.observedWeaponState
              ?.reloadQueuedStartTime,
            deepFindExactKey(
              raw,
              'm_reloadQueuedStartTime',
            ),
          )),

        canActiveReload:
          booleanOrNull(
            firstDefined(
              raw?.observedWeaponState
                ?.canActiveReload,
              deepFindExactKey(
                raw,
                'm_bCanActiveReload',
              ),
            ),
          ),

        singleShotReloadFirstBullet:
          booleanOrNull(
            firstDefined(
              raw?.observedWeaponState
                ?.singleShotReloadFirstBullet,
              deepFindExactKey(
                raw,
                'm_bSingleShotReloadFirstBullet',
              ),
            ),
          ),
      });
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

  let joined = 0;
  let joinFailures = 0;

  const replayRows = [];

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

      if (!byTick.has(tick)) {
        return;
      }

      if (!tickGuard.shouldProcess(tick)) {
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
      createReadStream(
        replayPath,
      ),
    );
  } finally {
    await parser.dispose();
  }

  const pass =
    parseFailures === 0
    && joinFailures === 0
    && joined
      === transitions.length;

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
  summarizeResidualProvenance(
    allRows,
  );

const checks = {
  script188Ready:
    check(
      script188?.status,
      EXPECTED_188_STATUS,
      script188?.status
        === EXPECTED_188_STATUS,
    ),

  script188ClassificationExpected:
    check(
      script188
        ?.diagnostic
        ?.classification,
      EXPECTED_188_CLASSIFICATION,
      script188
        ?.diagnostic
        ?.classification
        === EXPECTED_188_CLASSIFICATION,
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

  consumedCohortStillNotIndependent:
    check(
      false,
      false,
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

  status:
    integrityPass
      ? 'COMBINED_AMMO_RESIDUAL_PROVENANCE_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'COMBINED_AMMO_RESIDUAL_PROVENANCE_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    combinedCounter:
      'ZigZag(m_iClip) + ZigZag(m_iBonusClip)',

    slideCarrier:
      PRIMARY_SLIDE_AMMO_CARRIER,

    cohort:
      cohort,

    independentValidation:
      false,

    authorityPromotion:
      false,

    itemOrAbilityAttribution:
      false,
  },

  replayIntegrity,

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
      'not_independent',
  },

  nextStep:
    'INTERPRET_ZERO_SUPPRESSION_VS_ATTACK_COUPLED_AMMO_GAIN;_ONLY_THEN_FORM_SPECIFIC_ACTIVE_RELOAD_ABILITY_REFILL_OR_HERO_MECHANIC_HYPOTHESES',
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
          previous.rawClip,
        )
        || !Number.isFinite(
          current.rawClip,
        )
        || !Number.isFinite(
          previous.bonusClip,
        )
        || !Number.isFinite(
          current.bonusClip,
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

        previousRawClip:
          previous.rawClip,

        currentRawClip:
          current.rawClip,

        previousBonusClip:
          previous.bonusClip,

        currentBonusClip:
          current.bonusClip,

        reloadAvailableTimeChanged:
          changedFinite(
            previous.reloadAvailableTime,
            current.reloadAvailableTime,
          ),

        lastReloadStartTimeChanged:
          changedFinite(
            previous.lastReloadStartTime,
            current.lastReloadStartTime,
          ),

        reloadQueuedStartTimeChanged:
          changedFinite(
            previous.reloadQueuedStartTime,
            current.reloadQueuedStartTime,
          ),

        canActiveReload:
          current.canActiveReload,

        singleShotReloadFirstBullet:
          current.singleShotReloadFirstBullet,

        firedRecently:
          current.firedRecently,
      });
    }
  }

  return transitions;
}

function changedFinite(a, b) {
  if (
    !Number.isFinite(a)
    || !Number.isFinite(b)
  ) {
    return false;
  }

  return Math.abs(a - b) > 1e-9;
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
  const d =
    result.diagnostic;

  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'RESIDUAL PROVENANCE SUMMARY',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `carrier-absent transitions:          ${d.carrierAbsent}`,
  );
  console.log(
    `combined-positive:                   ${d.positive}`,
  );
  console.log(
    `combined residual:                   ${d.residual} (${percent(d.residualRate)})`,
  );
  console.log('');

  console.log(
    'RESIDUAL CLASSES',
  );
  console.log(
    '----------------',
  );

  for (const row of d.classes) {
    console.log(
      `${row.key.padEnd(46)} ${String(row.count).padEnd(6)} ${percent(row.rate)}`,
    );
  }

  console.log('');
  console.log(
    'BY HERO',
  );
  console.log(
    '-------',
  );

  for (
    const row
    of d.byHero.slice(0, 25)
  ) {
    console.log(
      `hero=${String(row.key).padEnd(4)} total=${String(row.total).padEnd(5)} zero=${String(row.zero).padEnd(4)} neg=${String(row.negative).padEnd(4)} multiZero=${String(row.multiShotZero).padEnd(4)} singleZero=${String(row.singleShotZero).padEnd(4)} mainGain=${String(row.mainGain).padEnd(4)} bonusGain=${String(row.bonusGain).padEnd(4)} bothGain=${row.bothGain}`,
    );
  }

  console.log('');
  console.log(
    'BY REPLAY',
  );
  console.log(
    '---------',
  );

  for (const row of d.byReplay) {
    console.log(
      `${row.key}: total=${row.total} zero=${row.zero} negative=${row.negative} multiZero=${row.multiShotZero} mainGain=${row.mainGain} bonusGain=${row.bonusGain}`,
    );
  }

  console.log('');
  console.log(
    'SHOT-ADVANCE DISTRIBUTIONS',
  );
  console.log(
    '--------------------------',
  );
  console.log(
    `all residuals: ${JSON.stringify(d.shotAdvance)}`,
  );
  console.log(
    `zero residuals: ${JSON.stringify(d.zeroShotAdvance)}`,
  );

  console.log('');
  console.log(
    'NEGATIVE AMMO-GAIN MAGNITUDE',
  );
  console.log(
    '----------------------------',
  );
  console.log(
    JSON.stringify(
      d.negativeGainMagnitude,
    ),
  );

  console.log('');
  console.log(
    'RELOAD-FIELD SIGNAL ENRICHMENT',
  );
  console.log(
    '------------------------------',
  );

  for (
    const [name, row]
    of Object.entries(
      d.reloadFieldSignals,
    )
  ) {
    console.log(
      `${name.padEnd(32)} residual=${percent(row.residualRate).padEnd(8)} positive=${percent(row.positiveRate).padEnd(8)} RD=${percent(row.riskDifference)} knownResidual=${row.residualKnown}`,
    );
  }

  console.log('');
  console.log(
    'TOP HERO × EFFECT CONTEXTS',
  );
  console.log(
    '--------------------------',
  );

  for (
    const row
    of d.byHeroEffectContext.slice(0, 25)
  ) {
    console.log(
      `${String(row.key).slice(0, 70).padEnd(70)} total=${String(row.total).padEnd(5)} zero=${String(row.zero).padEnd(4)} neg=${String(row.negative).padEnd(4)} multiZero=${String(row.multiShotZero).padEnd(4)} mainGain=${row.mainGain}`,
    );
  }

  console.log('');
  console.log(
    'TOP EXACT RESIDUAL PATTERNS',
  );
  console.log(
    '---------------------------',
  );

  for (
    const row
    of d.topPatterns.slice(0, 40)
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
